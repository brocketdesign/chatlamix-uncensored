const { generatePromptTitle, moderateImage } = require('./openai')
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { ObjectId } = require('mongodb');
const axios = require('axios');
const { createHash } = require('crypto');
const { saveChatImageToDB, getLanguageName, uploadImage } = require('../models/tool')
const { getAutoMergeFaceSetting, getPreferredChatLanguage } = require('../models/chat-tool-settings-utils')
const { awardImageGenerationReward, awardCharacterImageMilestoneReward } = require('./user-points-utils');
const slugify = require('slugify');
const { generateImageSlug } = require('./slug-utils');
const sharp = require('sharp');
const { time } = require('console');
const { MODEL_CONFIGS, modelRequiresSequentialGeneration } = require('./admin-image-test-utils');

// ===== SAFEGUARDS FOR IMAGE MESSAGE HANDLING =====
// Maximum number of image messages allowed per chat to prevent database bloat
const MAX_IMAGE_MESSAGES_PER_CHAT = 500;

// NOTE: In-memory locks were removed and replaced with database-level locks
// in addImageMessageToChatHelper using the 'messageLocks' collection.
// This ensures locks work across multiple Node.js workers/processes.


const default_prompt = {
    sdxl: {
      sfw: {
        sampler_name: "Euler a",
        prompt: `score_9, score_8_up, masterpiece, best quality, (sfw), clothed, `,
        negative_prompt: `nipple, topless, nsfw, naked, nude, sex, young, child, dick, exposed breasts, cleavage, bikini, revealing clothing, lower body`,
        width: 1024,
        height: 1360,
        seed: -1,
        loras: []
      },
      nsfw: {
        sampler_name: "Euler a",
        prompt: `score_9, score_8_up, masterpiece, best quality, nsfw, uncensored, explicit,`,
        negative_prompt: `child,censored`,
        width: 1024,
        height: 1360,
        seed: -1,
        loras: []
      }
    },
    sd: {
      sfw: {
        sampler_name: "DPM++ 2M Karras",
        prompt: `best quality, ultra high res, (photorealistic:1.4), masterpiece, (sfw), dressed, clothe on, natural lighting, `,
        negative_prompt: `BraV4Neg,paintings,sketches,(worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)),logo, nsfw, nude, topless, exposed breasts, cleavage, bikini, revealing clothing, worst quality, low quality, disform, weird body, multiple hands, young, child, dick, bad quality, worst quality, worst detail, sketch, lower body, full body`,
        loras: [{"model_name":"more_details_59655.safetensors","strength":0.2},{ model_name: 'JapaneseDollLikeness_v15_28382.safetensors', strength: 0.7 }],
        seed: -1,
      },
      nsfw: {
        sampler_name: "DPM++ 2M Karras",
        prompt: `best quality, ultra high res, (photorealistic:1.4), masterpiece, (nsfw),uncensored, `,
        negative_prompt: `BraV4Neg,paintings,sketches,(worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)),logo,disform,weird body,multiple hands,child,bad quality,worst quality,worst detail,sketch`,
        loras: [{"model_name":"more_details_59655.safetensors","strength":0.2},{ model_name: 'JapaneseDollLikeness_v15_28382.safetensors', strength: 0.7 },{"model_name":"PerfectFullBreasts-fCV3_59759.safetensors","strength":0.7}],
        seed: -1,
      }
    },
  };    
  
const params = {
  model_name: "prefectPonyXL_v50_1128833.safetensors",
  prompt: '',
  negative_prompt: '',
  width: 1024,
  height: 1360,
  sampler_name: "Euler a",
  guidance_scale: 7,
  steps: 30,
  image_num: 1,
  clip_skip: 0,
  strength: 0.65,
  loras: [],
} 

function getTitleForLang(title, lang = 'en') {
  if (!title) return '';
  if (typeof title === 'string') return title;
  const map = {
    english: 'en',
    japanese: 'ja',
    french: 'fr'
  };
  const key = (lang && typeof lang === 'string') ? (map[lang.toLowerCase()] || lang.toLowerCase()) : 'en';
  return title[key] || title.en || title.ja || title.fr || Object.values(title).find(v => !!v) || '';
}

// Simplified generateImg function
async function generateImg({
    title, 
    prompt, 
    negativePrompt, 
    aspectRatio, 
    imageSeed, 
    modelId, 
    regenerate, 
    userId, 
    chatId, 
    userChatId, 
    imageType, 
    image_num = 1,
    image_base64, 
    chatCreation, 
    placeholderId, 
    translations, 
    fastify,
    hunyuan = false,
    customPromptId = null, 
    customGiftId = null, 
    enableMergeFace = false,
    editStrength = 'medium'
}) {
    const db = fastify.mongo.db;
    
    // Validate required parameters (prompt)
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
        fastify.sendNotificationToUser(userId, 'showNotification', {
            message: translations.newCharacter.prompt_missing,
            icon: 'error'
        });
        return;
    }

    console.log('\x1b[36m🔧 [generateImg] ===== STARTING IMAGE GENERATION =====\x1b[0m');
    console.log(`\x1b[33m[generateImg] Input modelId: ${modelId || 'NOT PROVIDED'}\x1b[0m`);

    // Fetch the user
    let user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
    if (!user) {
      userId = await db.collection('chats').findOne({ _id: new ObjectId(chatId) }).then(chat => chat.userId);
      user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
    }
    
    // Fetch user subscription status
    const isSubscribed = user?.subscriptionStatus === 'active' || false;
  
    // Fetch imageVersion from chat or use default
    const chat = await db.collection('chats').findOne({ _id: new ObjectId(chatId) });
    console.log(`\x1b[33m[generateImg] Chat model data: modelId=${chat?.modelId}, imageModel=${chat?.imageModel}, imageVersion=${chat?.imageVersion}\x1b[0m`);
    
    const imageVersion = chat?.imageVersion || 'sdxl';
    const selectedStyle = default_prompt[imageVersion] || default_prompt['sdxl'];
    const resolvedImageType = (imageType === 'nsfw' || imageType === 'sfw')
      ? imageType
      : (chat?.nsfw ? 'nsfw' : 'sfw');
    
    // Priority: 1) modelId param, 2) chat.modelId, 3) default
    let effectiveModelId = modelId || chat?.modelId || null;
    let imageModel = chat?.imageModel || 'prefectPonyXL_v50_1128833';
    let modelData = null;
    let isBuiltInModel = false; // Flag to indicate if using built-in model type
    
    console.log(`\x1b[33m[generateImg] Effective modelId: ${effectiveModelId || 'NONE - using default'}\x1b[0m`);
    console.log(`\x1b[33m[generateImg] Initial imageModel: ${imageModel}\x1b[0m`);
    
    try {
      // Check if effectiveModelId is a built-in model type (from MODEL_CONFIGS)
      if (effectiveModelId && MODEL_CONFIGS[effectiveModelId]) {
        console.log(`\x1b[32m[generateImg] ✓ Found built-in model: ${effectiveModelId}\x1b[0m`);
        // For built-in models, we don't need to look up imageModel in database
        // The effectiveModelId itself is the model type
        isBuiltInModel = true;
        imageModel = effectiveModelId;
        modelData = { model: effectiveModelId, isBuiltIn: true };
      } else {
        // First try to find by modelId in database
        if (effectiveModelId) {
          modelData = await db.collection('myModels').findOne({ modelId: effectiveModelId.toString() });
          console.log(`\x1b[33m[generateImg] Found model by modelId: ${modelData ? modelData.model : 'NOT FOUND'}\x1b[0m`);
        }
        // If not found by modelId, try by model name
        if (!modelData && imageModel) {
          modelData = await db.collection('myModels').findOne({ model: imageModel });
          console.log(`\x1b[33m[generateImg] Found model by name: ${modelData ? modelData.model : 'NOT FOUND'}\x1b[0m`);
        }
      }
    } catch (error) {
      console.error('[generateImg] Error fetching modelData:', error);
      modelData = null;
    }

    // Update imageModel if we found model data
    if (modelData) {
        imageModel = modelData.model;
        console.log(`\x1b[32m[generateImg] ✓ Using model: ${imageModel}\x1b[0m`);
    } else {
        console.log(`\x1b[33m[generateImg] ⚠️ No model data found, using default: ${imageModel}\x1b[0m`);
    }

    // Set default model if not found
    if(modelId && regenerate){
      try {
          imageModel = modelData?.model || imageModel;
      } catch (error) {
        console.error('Error fetching model data:', error);
      }
    }

    const gender = chat?.gender
    console.log(`\x1b[33m[generateImg] Gender: ${gender || 'not set'}\x1b[0m`);

    // Custom negative prompt by gender
    let genderNegativePrompt = '';
    if(gender == 'female'){
      genderNegativePrompt = 'muscular,manly,'
    }
    if(gender == 'male'){
      genderNegativePrompt = 'feminine,womanly,'
    }
    if(gender == 'nonBinary'){
      genderNegativePrompt = 'manly,womanly,'
    }

    // Prepare task based on imageType and model
    console.log(`\x1b[36m[generateImg] Preparing image generation request for user ${userId} (Type: ${resolvedImageType.toUpperCase()}, BuiltInModel: ${isBuiltInModel})\x1b[0m`);
    let image_request;
    if (isBuiltInModel) {
        // Built-in model (z-image-turbo, etc.) - use simpler request structure
        const modelConfig = MODEL_CONFIGS[imageModel];
        const defaultSize = modelConfig?.defaultParams?.size || '1024*1024';
        const sizeFormat = modelConfig?.sizeFormat || '*'; // 'x' for Seedream, '*' for others
        
        image_request = {
            type: resolvedImageType,
            prompt: prompt.replace(/^\s+/gm, '').trim(),
            negative_prompt: negativePrompt || '',
            size: defaultSize, // Use model's default size
            seed: imageSeed || modelConfig?.defaultParams?.seed || -1,
            enable_base64_output: modelConfig?.defaultParams?.enable_base64_output || false,
            blur: false
        };
        
        console.log(`\x1b[33m[generateImg] Built-in model request for ${imageModel}:`, JSON.stringify(image_request, null, 2));
    } else {
        // Regular model request structure (Stable Diffusion custom models)
        let modelNegativePrompt = modelData?.negativePrompt || '';
        let finalNegativePrompt = resolvedImageType === 'sfw'
          ? modelNegativePrompt +','+ selectedStyle.sfw.negative_prompt
          : modelNegativePrompt +','+ selectedStyle.nsfw.negative_prompt;
        finalNegativePrompt = ((negativePrompt || finalNegativePrompt) ? (negativePrompt || finalNegativePrompt)  + ',' : '') + genderNegativePrompt;
        finalNegativePrompt = finalNegativePrompt.replace(/,+/g, ',').replace(/^\s*,|\s*,\s*$/g, '').trim();

        const modelSampler = modelData?.defaultSampler || selectedStyle[resolvedImageType]?.sampler_name;
        // Determine LoRAs: For character creation with SFW, remove feminine-only LoRAs and handle gender-specific ones
        let selectedLoras = resolvedImageType === 'sfw' ? [...selectedStyle.sfw.loras] : [...selectedStyle.nsfw.loras];
        
        // For character creation SFW images, exclude feminine-specific LoRAs
        if (chatCreation && resolvedImageType === 'sfw') {
            selectedLoras = selectedLoras.filter(lora => 
                !lora.model_name.toLowerCase().includes('breast') && 
                !lora.model_name.toLowerCase().includes('feminine')
            );
            
            // For male characters in SFW character creation, further restrict feminine LoRAs
            if (gender === 'male') {
                selectedLoras = selectedLoras.filter(lora => 
                    !lora.model_name.toLowerCase().includes('doll') && 
                    !lora.model_name.toLowerCase().includes('japan')
                );
            }
        }
        
        if (resolvedImageType === 'sfw') {
          image_request = {
            type: 'sfw',
            model_name: imageModel.replace('.safetensors', '') + '.safetensors',
            sampler_name: modelSampler || selectedStyle.sfw.sampler_name || '',
            loras: selectedLoras,
            prompt: (selectedStyle.sfw.prompt ? selectedStyle.sfw.prompt + prompt : prompt).replace(/^\s+/gm, '').trim(),
            negative_prompt: finalNegativePrompt,
            width: selectedStyle.sfw.width || params.width,
            height: selectedStyle.sfw.height || params.height,
            blur: false,
            seed: imageSeed || selectedStyle.sfw.seed,
            steps: regenerate ? params.steps + 10 : params.steps,
          };
        } else {
          image_request = {
            type: 'nsfw',
            model_name: imageModel.replace('.safetensors', '') + '.safetensors',
            sampler_name: modelSampler || selectedStyle.nsfw.sampler_name || '',
            loras: selectedLoras,
            prompt: (selectedStyle.nsfw.prompt ? selectedStyle.nsfw.prompt + prompt : prompt).replace(/^\s+/gm, '').trim(),
            negative_prompt: finalNegativePrompt,
            width: selectedStyle.nsfw.width || params.width,
            height: selectedStyle.nsfw.height || params.height,
            blur: !isSubscribed,
            seed: imageSeed || selectedStyle.nsfw.seed,
            steps: regenerate ? params.steps + 10 : params.steps,
          };
        }
    }

    if(image_base64 && !isBuiltInModel){
      // Get target dimensions from the selected style
      const targetWidth = image_request.width;
      const targetHeight = image_request.height;
      
      // Center crop the image to match the target aspect ratio
      const croppedImage = await centerCropImage(image_base64, targetWidth, targetHeight);
      image_request.image_base64 = croppedImage;

      // [TEST] Remove negative prompt when uploading image & use prompt only
      image_request.negative_prompt = '';
      // Set guidance_scale based on edit strength
      let guidance_scale = 8.5; // default medium
      if (editStrength === 'low') guidance_scale = 5;
      else if (editStrength === 'high') guidance_scale = 12;
      image_request.guidance_scale = guidance_scale;
      // End [TEST]
    } else if(image_base64 && isBuiltInModel) {
      // For built-in models, just pass the base64 directly
      image_request.image_base64 = image_base64;
    }
    // Prepare params
    // Validate and ensure prompt length is within API limits (1-1024 characters)
    if (!image_request.prompt || image_request.prompt.trim() === '') {
        fastify.sendNotificationToUser(userId, 'showNotification', {
            message: translations.newCharacter.prompt_missing || 'Prompt cannot be empty',
            icon: 'error'
        });
        return;
    }
    
    // Trim the prompt and ensure it's within the 1024 character limit
    image_request.prompt = image_request.prompt.trim();
    if (image_request.prompt.length > 1024) {
      image_request.prompt = image_request.prompt.substring(0, 1024).trim();
    }
    
    // Final validation: ensure prompt is not empty after trimming
    if (image_request.prompt.length === 0) {
        fastify.sendNotificationToUser(userId, 'showNotification', {
            message: translations.newCharacter.prompt_missing || 'Prompt cannot be empty',
            icon: 'error'
        });
        return;
    }
    let requestData = { ...params, ...image_request, image_num };
    
    if(process.env.MODE !== 'production'){
      // Log prompt & negative prompt
      console.log(`\x1b[36m=== 🎨 Image Generation Details ===\x1b[0m`);
      console.log(`📝 \x1b[32mPrompt:\x1b[0m ${image_request.prompt}`);
      console.log(`🚫 \x1b[33mNegative Prompt:\x1b[0m ${image_request.negative_prompt}`);
      console.log(`📸 \x1b[35mImage Base64 Present:\x1b[0m ${!!image_request.image_base64 ? '✅ Yes' : '❌ No'}`);
      console.log(`\x1b[36m===================================\x1b[0m`);
    }
    // Find modelId style
    const imageStyle = modelData ? modelData.style : 'anime';
    chat.imageStyle = chat.imageStyle || imageStyle; // Use chat image style or default to model style

    // Check if auto merge should be applied
    const autoMergeFaceEnabled = await getAutoMergeFaceSetting(db, userId.toString(), chatId.toString());
    const isPhotorealistic = chat && chat.imageStyle === 'photorealistic' || chat && chat.imageStyle !== 'anime';
    
    // For character creation, use enableMergeFace setting if provided, otherwise use auto merge logic
    const shouldAutoMerge = chatCreation 
        ? (enableMergeFace && image_base64) // Only merge on character creation if explicitly enabled and has uploaded image
        : (!chatCreation && autoMergeFaceEnabled && isPhotorealistic && chat?.chatImageUrl?.length > 0); // Regular auto merge logic for non-character creation
    
    // Generate title if not provided
    let newTitle = title;
    if (!title) {
      // Get preferred chat language: settings > user profile > interface language > default english
      const preferredChatLang = await getPreferredChatLanguage(db, userId, chatId) || getLanguageName(user?.lang || 'en') || 'english';
      const userLangTitle = await generatePromptTitle(requestData.prompt, preferredChatLang);
      console.log(`\x1b[33m[generateImg] Generated title in preferred language (${preferredChatLang}): ${userLangTitle}\x1b[0m`);
      // Create title object with the preferred language and english fallback
      newTitle = {
        en: preferredChatLang === 'english' ? userLangTitle : '',
        [preferredChatLang]: userLangTitle // Store title in the preferred language key
      };
    }

    // Generate a slug from the prompt or title
    let taskSlug = '';
    if (newTitle && typeof newTitle === 'object') {
      // If title is an object with language keys, use the first available title
      const firstAvailableTitle = newTitle.en || Object.values(newTitle).find(v => !!v) || '';
      taskSlug = slugify(firstAvailableTitle.substring(0, 50), { lower: true, strict: true });
    } else if (newTitle) {
      // If title is a string
      taskSlug = slugify(newTitle.substring(0, 50), { lower: true, strict: true });
    } else {
      // Use the first 50 chars of the prompt if no title
      taskSlug = slugify(prompt.substring(0, 50), { lower: true, strict: true });
    }
    
    if(chat.slug){
      taskSlug = chat.slug + '-' + taskSlug;
    }
    
    // Ensure slug is unique by appending random string if needed
    const existingTask = await db.collection('tasks').findOne({ slug: taskSlug });
    if (existingTask) {
      const randomStr = Math.random().toString(36).substring(2, 6);
      taskSlug = `${taskSlug}-${randomStr}`;
    }

    // Send request to Novita and get taskId
    // Determine if model requires sequential generation (separate API calls for each image)
    // Check both the hunyuan flag (for backward compatibility) and the model config
    const requiresSequentialGen = hunyuan || (isBuiltInModel && modelRequiresSequentialGeneration(imageModel));
    const sequentialImageCount = requiresSequentialGen ? (image_num || 1) : 1;
    let novitaResult;
    let sequentialTaskIds = [];
    
    if (requiresSequentialGen && sequentialImageCount > 1) {
      // Model doesn't support image_num, so make multiple API calls
      console.log(`[generateImg] Sequential generation: Making ${sequentialImageCount} separate API calls for model ${imageModel || 'hunyuan'}`);
      for (let i = 0; i < sequentialImageCount; i++) {
        // Use different seeds for each image to get variety
        const seedForCall = requestData.seed === -1 ? -1 : (requestData.seed || 0) + i;
        const callData = { ...requestData, seed: seedForCall };
        // Note: hunyuan param is still passed for backward compatibility with fetchNovitaMagic
        // which uses it to determine the API endpoint for legacy Hunyuan calls
        const taskId = await fetchNovitaMagic(callData, hunyuan, isBuiltInModel ? imageModel : null);
        if (taskId) {
          sequentialTaskIds.push(taskId);
          console.log(`[generateImg] Sequential image ${i + 1}/${sequentialImageCount} task started: ${taskId}`);
        } else {
          console.error(`[generateImg] Sequential image ${i + 1}/${sequentialImageCount} failed to start`);
        }
      }
      
      if (sequentialTaskIds.length === 0) {
        fastify.sendNotificationToUser(userId, 'showNotification', {
          message: 'Failed to initiate image generation',
          icon: 'error'
        });
        return;
      }
      
      // Use the first task ID as the primary result
      novitaResult = sequentialTaskIds[0];
    } else {
      console.log(`[generateImg] 📤 Calling fetchNovitaMagic with isBuiltInModel=${isBuiltInModel}, imageModel=${imageModel}`);
      // Note: hunyuan param is still passed for backward compatibility with fetchNovitaMagic
      novitaResult = await fetchNovitaMagic(requestData, hunyuan, isBuiltInModel ? imageModel : null);
      console.log(`[generateImg] 📥 fetchNovitaMagic result:`, novitaResult);
    }

    if (!novitaResult) {
        console.error(`[generateImg] ❌ novitaResult is falsy - API call failed`);
        fastify.sendNotificationToUser(userId, 'showNotification', {
            message: 'Failed to initiate image generation',
            icon: 'error'
        });
        return;
    }

    const novitaTaskId = typeof novitaResult === 'string' ? novitaResult : novitaResult.taskId;
    console.log(`[generateImg] 📋 Extracted taskId: ${novitaTaskId} (isBuiltInModel=${isBuiltInModel}, imageModel=${imageModel})`);
    
    // Store task details in DB with title and slug
    const taskData = {
        taskId: novitaTaskId,
        type: imageType,
        task_type: 'txt2img',
        status: 'pending',
        prompt: prompt,
        title: newTitle,
        slug: taskSlug,
        negative_prompt: image_request.negative_prompt,
        aspectRatio: aspectRatio,
        userId: new ObjectId(userId),
        chatId: new ObjectId(chatId),
        userChatId: userChatId ? new ObjectId(userChatId) : null,
        blur: image_request.blur,
        chatCreation,
        placeholderId,
        createdAt: new Date(),
        updatedAt: new Date(),
        shouldAutoMerge,
        enableMergeFace: enableMergeFace || false,
        requiresSequentialGeneration: requiresSequentialGen || false,  // Flag for models without batch support
        isBuiltInModel: isBuiltInModel || false,  // Store model type flag
        imageModelId: imageModel || null,  // Store the model ID for reference
        translations: translations || null  // Store translations for webhook/polling handlers
    };
    
    // For models requiring sequential generation with multiple images, store all task IDs
    if (requiresSequentialGen && sequentialTaskIds.length > 1) {
        taskData.sequentialTaskIds = sequentialTaskIds;
        taskData.sequentialExpectedCount = sequentialTaskIds.length;
        taskData.sequentialCompletedCount = 0;
    }
    
    // Store original request data for character creation tasks with merge face enabled
    if (chatCreation && enableMergeFace && image_base64) {
        taskData.originalRequestData = {
            image_base64: image_base64
        };
    }
    
    // Add custom prompt ID if provided
    if (customPromptId) {
        taskData.customPromptId = customPromptId;
    }
    
    // Add custom gift ID if provided
    if (customGiftId) {
        taskData.customGiftId = customGiftId;
    }

    console.log(`[generateImg] 💾 Storing task in database: taskId=${novitaTaskId}, chatCreation=${chatCreation}, isBuiltInModel=${isBuiltInModel}`);
    await db.collection('tasks').insertOne(taskData);
    console.log(`[generateImg] ✅ Task stored in database successfully`);
    
    // For models requiring sequential generation, create task records for additional task IDs
    // so the webhook handler can process them individually
    if (requiresSequentialGen && sequentialTaskIds.length > 1) {
        for (let i = 1; i < sequentialTaskIds.length; i++) {
            const additionalTaskData = {
                taskId: sequentialTaskIds[i],
                type: imageType,
                task_type: 'txt2img',
                status: 'pending',
                prompt: prompt,
                title: newTitle,
                slug: `${taskSlug}-${i + 1}`,
                negative_prompt: image_request.negative_prompt,
                aspectRatio: aspectRatio,
                userId: new ObjectId(userId),
                chatId: new ObjectId(chatId),
                userChatId: userChatId ? new ObjectId(userChatId) : null,
                blur: image_request.blur,
                chatCreation,
                placeholderId,
                createdAt: new Date(),
                updatedAt: new Date(),
                shouldAutoMerge,
                enableMergeFace: enableMergeFace || false,
                requiresSequentialGeneration: true,
                sequentialParentTaskId: novitaTaskId, // Link to the primary task
                sequentialImageIndex: i + 1,
                translations: translations || null  // Store translations for webhook/polling handlers
            };
            
            // Store original request data for character creation tasks with merge face enabled
            if (chatCreation && enableMergeFace && image_base64) {
                additionalTaskData.originalRequestData = {
                    image_base64: image_base64
                };
            }
            
            await db.collection('tasks').insertOne(additionalTaskData);
            console.log(`[generateImg] Created task record for sequential image ${i + 1}: ${sequentialTaskIds[i]}`);
        }
    }

    // Start fallback polling for all models (regardless of context)
    // This ensures images are processed even if webhooks fail
    // Works for: character creation, in-chat generation, any model
    const allTaskIds = requiresSequentialGen ? (sequentialTaskIds.length > 0 ? sequentialTaskIds : [novitaTaskId]) : [novitaTaskId];
    const modelName = imageModel || 'built-in';
    console.log(`[generateImg] 🚀 Starting fallback polling for ${allTaskIds.length} ${modelName} task(s): ${allTaskIds.join(', ')} (chatCreation=${chatCreation})`);
    
    // Don't await - let it run in background
    pollSequentialTasksWithFallback(novitaTaskId, allTaskIds, fastify, {
      chatCreation: chatCreation,  // Pass actual value, not hardcoded
      translations,
      userId,
      chatId,
      placeholderId
    }).then(success => {
      console.log(`[generateImg] ✅ ${modelName} fallback polling completed: ${success ? 'success' : 'partial/failed'}`);
    }).catch(error => {
      console.error(`[generateImg] ❌ ${modelName} fallback polling error:`, error.message);
    });

    console.log(`[generateImg] 🎉 Returning taskId: ${novitaTaskId}`);
    return { taskId: novitaTaskId, sequentialTaskIds: requiresSequentialGen && sequentialTaskIds.length > 1 ? sequentialTaskIds : undefined };
}

// Add this function to your code
async function centerCropImage(base64Image, targetWidth, targetHeight) {
  try {
    // Decode base64 image
    const imageBuffer = Buffer.from(base64Image.split(',')[1], 'base64');
    
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    
    // Calculate target aspect ratio
    const targetRatio = targetWidth / targetHeight;
    const sourceRatio = metadata.width / metadata.height;
    
    let extractWidth, extractHeight, left, top;
    
    if (sourceRatio > targetRatio) {
      // Source image is wider than target, crop width
      extractHeight = metadata.height;
      extractWidth = Math.round(metadata.height * targetRatio);
      top = 0;
      left = Math.round((metadata.width - extractWidth) / 2);
    } else {
      // Source image is taller than target, crop height
      extractWidth = metadata.width;
      extractHeight = Math.round(metadata.width / targetRatio);
      left = 0;
      top = Math.round((metadata.height - extractHeight) / 2);
    }
    
    // Extract the center portion and resize to target dimensions
    const croppedImageBuffer = await sharp(imageBuffer)
      .extract({ left, top, width: extractWidth, height: extractHeight })
      .resize(targetWidth, targetHeight)
      .toBuffer();
    
    // Convert back to base64
    return `data:image/${metadata.format};base64,${croppedImageBuffer.toString('base64')}`;
  } catch (error) {
    console.error('Error cropping image:', error);
    return base64Image; // Return original if error occurs
  }
}

/**
 * Fetch original task data including uploaded image base64
 * @param {string} taskId - Task ID
 * @param {Object} db - Database instance
 * @returns {Object} Original task request data or null
 */
async function fetchOriginalTaskData(taskId, db) {
  try {
    const task = await db.collection('tasks').findOne({ taskId });
    
    if (!task || !task.originalRequestData) {
      return null;
    }

    return task.originalRequestData;
  } catch (error) {
    console.error('[fetchOriginalTaskData] Error fetching original task data:', error);
    return null;
  }
}

/**
 * Perform auto merge face with chat image (standalone function)
 * @param {Object} originalImage - Original generated image object
 * @param {string} chatImageUrl - Chat character image URL
 * @param {Object} fastify - Fastify instance
 * @returns {Object} Merged image object or null if failed
 */
async function performAutoMergeFace(originalImage, chatImageUrl, fastify) {
  try {
    
    const db = fastify.mongo.db;
    const originalGeneratedImageUrl = originalImage.imageUrl;
    const startTs = Date.now();
    console.log(`🧬 [Merge] ${new Date().toISOString()} Start auto-merge for original=${originalGeneratedImageUrl}`);

    // Idempotent cache: reuse if a merged result already exists for this original
    const mergedStore = db.collection('mergedResults');
    try { await mergedStore.createIndex({ originalImageUrl: 1 }, { unique: true }); } catch (e) {}
    const cached = await mergedStore.findOne({ originalImageUrl: originalGeneratedImageUrl });
    if (cached && cached.mergedImageUrl && cached.mergeId) {
      console.log(`🗂️  [MergeCache] ${new Date().toISOString()} Cache hit, reuse merged result ⏱️ ${Date.now() - startTs}ms`);
      return {
        ...originalImage,
        imageUrl: cached.mergedImageUrl,
        mergeId: cached.mergeId,
        originalImageUrl: originalGeneratedImageUrl,
        isMerged: true
      };
    }

    // Acquire per-original lock to prevent concurrent duplicate merges
    const locks = db.collection('mergeLocks');
    try { await locks.createIndex({ key: 1 }, { unique: true }); } catch (e) {}
    const lockKey = `merge:${originalGeneratedImageUrl}`;
    try {
      await locks.insertOne({ key: lockKey, createdAt: new Date() });
    } catch (e) {
      if (e && e.code === 11000) {
        // Another worker is merging this original; wait briefly for result and reuse
        for (let i = 0; i < 20; i++) {
          // Check idempotent cache first
          const cachedWhileWaiting = await mergedStore.findOne({ originalImageUrl: originalGeneratedImageUrl });
          if (cachedWhileWaiting && cachedWhileWaiting.mergedImageUrl && cachedWhileWaiting.mergeId) {
            console.log(`🗂️  [MergeCache] ${new Date().toISOString()} Cache hit during wait ⏱️ ${Date.now() - startTs}ms`);
            return {
              ...originalImage,
              imageUrl: cachedWhileWaiting.mergedImageUrl,
              mergeId: cachedWhileWaiting.mergeId,
              originalImageUrl: originalGeneratedImageUrl,
              isMerged: true
            };
          }
          const existingMergeWait = await db.collection('gallery').findOne({
            'images.originalImageUrl': originalGeneratedImageUrl,
            'images.isMerged': true
          });
          if (existingMergeWait) {
            const mergedImage = existingMergeWait.images.find(img => img.originalImageUrl === originalGeneratedImageUrl && img.isMerged === true);
            if (mergedImage) {
              return {
                ...originalImage,
                imageUrl: mergedImage.imageUrl,
                mergeId: mergedImage.mergeId,
                originalImageUrl: originalGeneratedImageUrl,
                isMerged: true
              };
            }
          }
          await new Promise(r => setTimeout(r, 250));
        }
        return null;
      }
      throw e;
    }
    console.log(`🔒 [MergeLock] ${new Date().toISOString()} Acquired lock ⏱️ ${Date.now() - startTs}ms`);

    // ⭐ CRITICAL: Check if a merge already exists for this original image URL
    // This prevents duplicate Novita API calls for the same original
    const existingMerge = await db.collection('gallery').findOne({
      'images.originalImageUrl': originalGeneratedImageUrl,
      'images.isMerged': true
    });

    if (existingMerge) {
      const mergedImage = existingMerge.images.find(img => 
        img.originalImageUrl === originalGeneratedImageUrl && img.isMerged === true
      );
      
      if (mergedImage) {
        try {
          await mergedStore.updateOne(
            { originalImageUrl: originalGeneratedImageUrl },
            { $set: { mergedImageUrl: mergedImage.imageUrl, mergeId: mergedImage.mergeId, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
            { upsert: true }
          );
        } catch (_) {}
        await db.collection('mergeLocks').deleteOne({ key: lockKey });
        console.log(`🔁 [MergeReuse] ${new Date().toISOString()} Reused from gallery ⏱️ ${Date.now() - startTs}ms`);
        return {
          ...originalImage,
          imageUrl: mergedImage.imageUrl,
          mergeId: mergedImage.mergeId,
          originalImageUrl: originalGeneratedImageUrl,
          isMerged: true
        };
      }
    }

    const {
      mergeFaceWithSegmind,
      optimizeImageForMerge,
      saveMergedImageToS3
    } = require('./merge-face-utils');

    // Convert chat image URL to base64 (face image)
    const axios = require('axios');
    const chatImageResponse = await axios.get(chatImageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    });
    const chatImageBuffer = Buffer.from(chatImageResponse.data);
    const optimizedChatImage = await optimizeImageForMerge(chatImageBuffer, 2048);
    const faceImageBase64 = optimizedChatImage.base64Image;

    // Convert generated image URL to base64 (original image)
    const generatedImageResponse = await axios.get(originalImage.imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    });
    const generatedImageBuffer = Buffer.from(generatedImageResponse.data);

    const optimizedGeneratedImage = await optimizeImageForMerge(generatedImageBuffer, 2048);
    const originalImageBase64 = optimizedGeneratedImage.base64Image;

    // Merge the faces using Segmind API (higher quality than Novita)
    const mergeResult = await mergeFaceWithSegmind({
      faceImageBase64,
      originalImageBase64
    });

    if (!mergeResult || !mergeResult.success) {
      console.error('[performAutoMergeFace] Face merge failed:', mergeResult?.error || 'Unknown error');
      return null;
    }
    

    // Generate unique merge ID
    const mergeId = new ObjectId();

    // Save merged image to S3 add upload emoji at the beginning
    console.log(`🚀 [performAutoMergeFace] ${new Date().toISOString()} Saving merged image to S3 with mergeId:`, mergeId.toString());
    let mergedImageUrl;
    try {
      mergedImageUrl = await saveMergedImageToS3(
        `data:image/${mergeResult.imageType};base64,${mergeResult.imageBase64}`,
        mergeId.toString(),
        fastify
      );
      // Save to idempotent cache BEFORE releasing lock
      try {
        await mergedStore.updateOne(
          { originalImageUrl: originalGeneratedImageUrl },
          { $set: { mergedImageUrl, mergeId: mergeId.toString(), updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true }
        );
        console.log(`🗂️  [MergeCache] ${new Date().toISOString()} Saved idempotent entry ⏱️ ${Date.now() - startTs}ms`);
      } catch (e) {}
    } finally {
      await db.collection('mergeLocks').deleteOne({ key: lockKey });
      console.log(`🔓 [MergeLock] ${new Date().toISOString()} Released lock ⏱️ ${Date.now() - startTs}ms`);
    }


    // Return merged image data with ALL original fields preserved
    const returnData = {
      ...originalImage,
      imageUrl: mergedImageUrl,
      mergeId: mergeId.toString(),
      originalImageUrl: originalGeneratedImageUrl,
      isMerged: true
    };
    console.log(`✅ [Merge] ${new Date().toISOString()} Completed ⏱️ ${Date.now() - startTs}ms`);
    
    return returnData;

  } catch (error) {
    console.error('[performAutoMergeFace] Error in auto merge:', error);
    return null;
  }
}

/**
 * Perform auto merge face with base64 image data (for character creation)
 * @param {Object} originalImage - Original generated image object
 * @param {string} faceImageBase64 - Base64 face image data
 * @param {Object} fastify - Fastify instance
 * @returns {Object} Merged image object or null if failed
 */
async function performAutoMergeFaceWithBase64(originalImage, faceImageBase64, fastify) {
  try {
    
    const db = fastify.mongo.db;
    const originalGeneratedImageUrl = originalImage.imageUrl;
    const startTs = Date.now();
    console.log(`🧬 [Merge] ${new Date().toISOString()} Start auto-merge (base64) for original=${originalGeneratedImageUrl}`);

    // Idempotent cache: reuse if a merged result already exists for this original
    const mergedStore = db.collection('mergedResults');
    try { await mergedStore.createIndex({ originalImageUrl: 1 }, { unique: true }); } catch (e) {}
    const cached = await mergedStore.findOne({ originalImageUrl: originalGeneratedImageUrl });
    if (cached && cached.mergedImageUrl && cached.mergeId) {
      console.log(`🗂️  [MergeCache] ${new Date().toISOString()} Cache hit, reuse merged result ⏱️ ${Date.now() - startTs}ms`);
      return {
        ...originalImage,
        imageUrl: cached.mergedImageUrl,
        mergeId: cached.mergeId,
        originalImageUrl: originalGeneratedImageUrl,
        isMerged: true
      };
    }

    // Acquire per-original lock to prevent concurrent duplicate merges
    const locks = db.collection('mergeLocks');
    try { await locks.createIndex({ key: 1 }, { unique: true }); } catch (e) {}
    const lockKey = `merge:${originalGeneratedImageUrl}`;
    try {
      await locks.insertOne({ key: lockKey, createdAt: new Date() });
    } catch (e) {
      if (e && e.code === 11000) {
        // Another worker is merging this original; wait briefly for result and reuse
        for (let i = 0; i < 20; i++) {
          // Check idempotent cache first
          const cachedWhileWaiting = await mergedStore.findOne({ originalImageUrl: originalGeneratedImageUrl });
          if (cachedWhileWaiting && cachedWhileWaiting.mergedImageUrl && cachedWhileWaiting.mergeId) {
            console.log(`🗂️  [MergeCache] ${new Date().toISOString()} Cache hit during wait ⏱️ ${Date.now() - startTs}ms`);
            return {
              ...originalImage,
              imageUrl: cachedWhileWaiting.mergedImageUrl,
              mergeId: cachedWhileWaiting.mergeId,
              originalImageUrl: originalGeneratedImageUrl,
              isMerged: true
            };
          }
          const existingMergeWait = await db.collection('gallery').findOne({
            'images.originalImageUrl': originalGeneratedImageUrl,
            'images.isMerged': true
          });
          if (existingMergeWait) {
            const mergedImage = existingMergeWait.images.find(img => img.originalImageUrl === originalGeneratedImageUrl && img.isMerged === true);
            if (mergedImage) {
              return {
                ...originalImage,
                imageUrl: mergedImage.imageUrl,
                mergeId: mergedImage.mergeId,
                originalImageUrl: originalGeneratedImageUrl,
                isMerged: true
              };
            }
          }
          await new Promise(r => setTimeout(r, 250));
        }
        return null;
      }
      throw e;
    }
    console.log(`🔒 [MergeLock] ${new Date().toISOString()} Acquired lock ⏱️ ${Date.now() - startTs}ms`);

    // ⭐ CRITICAL: Check if a merge already exists for this original image URL
    const existingMerge = await db.collection('gallery').findOne({
      'images.originalImageUrl': originalGeneratedImageUrl,
      'images.isMerged': true
    });

    if (existingMerge) {
      const mergedImage = existingMerge.images.find(img => 
        img.originalImageUrl === originalGeneratedImageUrl && img.isMerged === true
      );
      
      if (mergedImage) {
        try {
          await mergedStore.updateOne(
            { originalImageUrl: originalGeneratedImageUrl },
            { $set: { mergedImageUrl: mergedImage.imageUrl, mergeId: mergedImage.mergeId, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
            { upsert: true }
          );
        } catch (_) {}
        await db.collection('mergeLocks').deleteOne({ key: lockKey });
        console.log(`🔁 [MergeReuse] ${new Date().toISOString()} Reused from gallery ⏱️ ${Date.now() - startTs}ms`);
        return {
          ...originalImage,
          imageUrl: mergedImage.imageUrl,
          mergeId: mergedImage.mergeId,
          originalImageUrl: originalGeneratedImageUrl,
          isMerged: true
        };
      }
    }

    const {
      mergeFaceWithSegmind,
      optimizeImageForMerge,
      saveMergedImageToS3
    } = require('./merge-face-utils');

    // Convert generated image URL to base64
    const axios = require('axios');
    const generatedImageResponse = await axios.get(originalImage.imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    });
    const generatedImageBuffer = Buffer.from(generatedImageResponse.data);

    const optimizedGeneratedImage = await optimizeImageForMerge(generatedImageBuffer, 2048);
    const originalImageBase64 = optimizedGeneratedImage.base64Image;

    // Merge the faces using Segmind API (higher quality than Novita)
    const mergeResult = await mergeFaceWithSegmind({
      faceImageBase64,
      originalImageBase64
    });

    if (!mergeResult || !mergeResult.success) {
      console.error('[performAutoMergeFaceWithBase64] Face merge failed:', mergeResult?.error || 'Unknown error');
      return null;
    }
    


    // Generate unique merge ID
    const mergeId = new ObjectId();

    // Save merged image to S3
    console.log(`🚀 [performAutoMergeFaceWithBase64] ${new Date().toISOString()} Saving merged image to S3 with mergeId:`, mergeId.toString());
    let mergedImageUrl;
    try {
      mergedImageUrl = await saveMergedImageToS3(
        `data:image/${mergeResult.imageType};base64,${mergeResult.imageBase64}`,
        mergeId.toString(),
        fastify
      );
      // Save to idempotent cache BEFORE releasing lock
      try {
        await mergedStore.updateOne(
          { originalImageUrl: originalGeneratedImageUrl },
          { $set: { mergedImageUrl, mergeId: mergeId.toString(), updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true }
        );
        console.log(`🗂️  [MergeCache] ${new Date().toISOString()} Saved idempotent entry ⏱️ ${Date.now() - startTs}ms`);
      } catch (e) {}
    } finally {
      await db.collection('mergeLocks').deleteOne({ key: lockKey });
      console.log(`🔓 [MergeLock] ${new Date().toISOString()} Released lock ⏱️ ${Date.now() - startTs}ms`);
    }


    // Return merged image data with ALL original fields preserved
    const returnData = {
      ...originalImage,
      imageUrl: mergedImageUrl,
      mergeId: mergeId.toString(),
      originalImageUrl: originalGeneratedImageUrl,
      isMerged: true
    };
    
    console.log(`✅ [Merge] ${new Date().toISOString()} Completed ⏱️ ${Date.now() - startTs}ms`);
    return returnData;

  } catch (error) {
    console.error('[performAutoMergeFaceWithBase64] Error in auto merge:', error);
    return null;
  }
}

// Add this helper function before saveImageToDB
function getTitleString(title) {
  if (!title) return '';
  if (typeof title === 'string') return title;
  if (typeof title === 'object') {
    return title.en || title.ja || title.fr || Object.values(title).find(v => !!v) || '';
  }
  return '';
}

// Add this helper function before saveImageToDB
async function addImageMessageToChatHelper(userDataCollection, userId, userChatId, imageUrl, imageId, prompt, title, nsfw, isMerged, mergeId, originalImageUrl, batchId = null, batchIndex = null, batchSize = null) {
  const titleString = getTitleString(title);
  const imageIdStr = imageId.toString();

  // Validate critical inputs
  if (!imageUrl) {
    console.error(`❌ [addImageMessageToChatHelper] VALIDATION FAILED: imageUrl is ${imageUrl}`);
    return false;
  }
  if (!userChatId) {
    console.error(`❌ [addImageMessageToChatHelper] VALIDATION FAILED: userChatId is ${userChatId}`);
    return false;
  }

  // Generate a unique lock key for this specific message
  // CRITICAL FIX: Include mergeId in lock key for merged images to prevent duplicate merges
  let lockKey;
  if (isMerged && mergeId) {
    // For merged images, use mergeId as the primary deduplication key
    lockKey = `msg:${userChatId}:merge:${mergeId}`;
  } else if (batchId && batchIndex !== null) {
    lockKey = `msg:${userChatId}:batch:${batchId}:${batchIndex}`;
  } else {
    lockKey = `msg:${userChatId}:image:${imageIdStr}`;
  }

  try {
    console.log(`📝 [addImageMessageToChatHelper] START:`);
    console.log(`   imageId=${imageIdStr}`);
    console.log(`   batchId=${batchId}, batchIndex=${batchIndex}/${batchSize}`);
    console.log(`   isMerged=${isMerged}, mergeId=${mergeId || 'none'}`);
    console.log(`   imageUrl=${imageUrl?.substring(0, 60)}...`);

    // ===== SAFEGUARD 1: Database-level lock using MongoDB =====
    // This works across multiple processes/workers unlike in-memory locks
    const db = userDataCollection.s.db;
    const locksCollection = db.collection('messageLocks');

    // Try to acquire distributed lock
    try {
      // Ensure indexes exist (only runs once, MongoDB ignores if already exists)
      // 1. Unique index on key for atomic lock acquisition
      // 2. TTL index for auto-cleanup of expired locks after 60 seconds
      await locksCollection.createIndex({ key: 1 }, { unique: true }).catch(() => {});
      await locksCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 }).catch(() => {});

      // Atomic lock acquisition - only succeeds if no lock exists (due to unique index)
      await locksCollection.insertOne({
        key: lockKey,
        createdAt: new Date()
      });
      console.log(`🔒 [addImageMessageToChatHelper] Acquired DB lock for ${lockKey}`);
    } catch (lockError) {
      if (lockError.code === 11000) {
        // Duplicate key error = lock already exists = another process is handling this
        console.log(`🔒 [addImageMessageToChatHelper] Lock already exists for ${lockKey}, skipping duplicate`);
        return true; // Return success - message is being/was added by another process
      }
      // Other errors - log but continue (fail open to avoid blocking)
      console.warn(`⚠️ [addImageMessageToChatHelper] Lock acquisition warning:`, lockError.message);
    }

    // ===== SAFEGUARD 2: Check image message count limit =====
    const chatDoc = await userDataCollection.findOne({
      userId: new ObjectId(userId),
      _id: new ObjectId(userChatId)
    });

    if (chatDoc && chatDoc.messages) {
      const imageMessageCount = chatDoc.messages.filter(m =>
        m.type === 'image' || m.type === 'mergeFace' || m.type === 'bot-image-slider'
      ).length;

      if (imageMessageCount >= MAX_IMAGE_MESSAGES_PER_CHAT) {
        console.warn(`⚠️ [addImageMessageToChatHelper] Chat ${userChatId} has reached max image limit (${imageMessageCount}/${MAX_IMAGE_MESSAGES_PER_CHAT}), skipping`);
        await locksCollection.deleteOne({ key: lockKey }).catch(() => {});
        return false;
      }

      // ===== SAFEGUARD 3: Early duplicate check before building message =====
      // Check if message already exists with same mergeId, batchId+batchIndex, or imageId
      // CRITICAL FIX: Always check mergeId first for merged images to catch duplicates
      // regardless of batch metadata differences
      let existingMessage;
      
      // For merged images, ALWAYS check mergeId first - this is the primary key
      if (isMerged && mergeId) {
        existingMessage = chatDoc.messages.find(m => m.mergeId === mergeId);
        if (existingMessage) {
          console.log(`💾 [addImageMessageToChatHelper] Message already exists (early check) for mergeId=${mergeId}, skipping duplicate`);
          await locksCollection.deleteOne({ key: lockKey }).catch(() => {});
          return true;
        }
      }
      
      // Also check batch or imageId as secondary deduplication
      if (batchId && batchIndex !== null) {
        existingMessage = chatDoc.messages.find(m =>
          m.batchId === batchId && m.batchIndex === batchIndex
        );
      } else {
        existingMessage = chatDoc.messages.find(m => m.imageId === imageIdStr);
      }

      if (existingMessage) {
        console.log(`💾 [addImageMessageToChatHelper] Message already exists (early check) for ${batchId ? `batchIndex=${batchIndex}` : `imageId=${imageIdStr}`}, skipping duplicate`);
        await locksCollection.deleteOne({ key: lockKey }).catch(() => {});
        return true;
      }
    }

    // Ensure we have valid content - never save undefined content
    const messageContent = titleString || prompt || 'Generated Image';
    const messageTitle = titleString || '';
    const messagePrompt = prompt || '';

    const imageMessage = {
      role: "assistant",
      content: messageContent,
      imageUrl,
      imageId: imageIdStr,
      type: isMerged ? "mergeFace" : "image",
      hidden: true,
      prompt: messagePrompt,
      title: messageTitle,
      nsfw,
      isMerged: isMerged || false,
      createdAt: new Date(),
      timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }),
    };

    // Store batch metadata for slider reconstruction
    if (batchId !== null && batchIndex !== null && batchSize !== null) {
      imageMessage.batchId = batchId;
      imageMessage.batchIndex = batchIndex;
      imageMessage.batchSize = batchSize;
      console.log(`📦 [addImageMessageToChatHelper] Adding batch metadata: batchId=${batchId}, batchIndex=${batchIndex}, batchSize=${batchSize}`);
    }

    if (isMerged) {
      imageMessage.mergeId = mergeId;
      imageMessage.originalImageUrl = originalImageUrl;
    }

    // ===== SAFEGUARD 4: Atomic duplicate check + insert using updateOne =====
    // Build the filter to check for duplicates atomically
    // CRITICAL FIX: For merged images, always include mergeId check to prevent duplicates
    // IMPORTANT: Must use $not + $elemMatch for array field checks, NOT $ne!
    // $ne on arrays matches if ANY element doesn't match, which is always true for arrays
    // $not + $elemMatch correctly checks if NO element matches
    let atomicFilter;
    
    if (isMerged && mergeId) {
      // For merged images: ensure no message with same mergeId exists
      // CRITICAL: Use $not + $elemMatch instead of $ne for proper array checking
      atomicFilter = {
        userId: new ObjectId(userId),
        _id: new ObjectId(userChatId),
        messages: { $not: { $elemMatch: { mergeId: mergeId } } }
      };
    } else if (batchId && batchIndex !== null) {
      // For batched images: ensure no message with same batchId+batchIndex exists
      atomicFilter = {
        userId: new ObjectId(userId),
        _id: new ObjectId(userChatId),
        messages: { $not: { $elemMatch: { batchId: batchId, batchIndex: batchIndex } } }
      };
    } else {
      // For non-batched: ensure no message with same imageId exists
      // CRITICAL: Use $not + $elemMatch instead of $ne for proper array checking
      atomicFilter = {
        userId: new ObjectId(userId),
        _id: new ObjectId(userChatId),
        messages: { $not: { $elemMatch: { imageId: imageIdStr } } }
      };
    }

    // Atomic update: only adds if filter matches (no duplicate exists)
    const result = await userDataCollection.updateOne(
      atomicFilter,
      { $push: { messages: imageMessage } }
    );

    // Release the lock after operation completes
    await locksCollection.deleteOne({ key: lockKey }).catch(() => {});

    if (result.matchedCount === 0) {
      console.log(`💾 [addImageMessageToChatHelper] Message already exists (atomic check) for ${isMerged ? `mergeId=${mergeId}` : batchId ? `batchIndex=${batchIndex}` : `imageId=${imageIdStr}`}, skipping duplicate`);
      return true;
    }

    if (result.modifiedCount === 0) {
      console.error(`❌ [addImageMessageToChatHelper] Failed to add message - document not found for userChatId: ${userChatId}`);
      return false;
    }

    console.log(`💾 [addImageMessageToChatHelper] Successfully added message for imageId: ${imageIdStr}, batchIndex=${batchIndex}/${batchSize}`);
    return true;
  } catch (error) {
    console.error(`❌ [addImageMessageToChatHelper] Error adding image message (batchIndex=${batchIndex}):`, error.message);
    // Try to release lock on error
    try {
      const db = userDataCollection.s.db;
      await db.collection('messageLocks').deleteOne({ key: lockKey }).catch(() => {});
    } catch (e) {}
    return false;
  }
}

// Add this helper function before saveImageToDB
async function updateOriginalMessageWithMerge(userDataCollection, taskId, userId, userChatId, mergeMessage) {
  try {
    // Idempotency: if a merged message with this mergeId already exists, do nothing
    const existing = await userDataCollection.findOne({
      userId: new ObjectId(userId),
      _id: new ObjectId(userChatId),
      'messages.mergeId': mergeMessage.mergeId
    });
    if (existing) {
      console.log(`🧩 mergeId ${mergeMessage.mergeId} already present in chat ${userChatId}`);
      return true;
    }
    //  ===========================
    // DEBUG LOGGING START
    //  ===========================
    console.log(`🧩 [MergeUpdate] ${new Date().toISOString()} === START: Logging userDataCollection messages ===`);
    const chatDoc = await userDataCollection.findOne({ userId: new ObjectId(userId), _id: new ObjectId(userChatId) });
    if (!chatDoc) {
      console.log(`🧩 [MergeUpdate] ${new Date().toISOString()} Chat ${userChatId} not found for user ${userId}`);
      console.log(`🧩 [MergeUpdate] ${new Date().toISOString()} === END: Logging userDataCollection messages ===`);
      return false;
    }
    console.log(`🧩 [MergeUpdate] ${new Date().toISOString()} Searching messages in chat ${userChatId} for originalImageUrl=${mergeMessage.originalImageUrl}`);
    const matchingMessages = chatDoc.messages.filter(m => m.imageUrl === mergeMessage.originalImageUrl && m.isMerged !== true);
    console.log(`🧩 [MergeUpdate] ${new Date().toISOString()} Found ${matchingMessages.length} matching messages for originalImageUrl=${mergeMessage.originalImageUrl}`);
    // Only log image details for messages with imageId or mergeId
    chatDoc.messages.forEach(msg => {
      if (msg.imageId || msg.mergeId) {
      console.log(
      '🕒 createdAt:', msg.createdAt, '\n' +
      '⚙️ type:', msg.type || 'N/A', '\n' +
      '🖼️ imageId:', msg.imageId || '', '\n' +
      '🔗 mergeId:', msg.mergeId || '', '\n' +
      '🌐 imageUrl:', msg.imageUrl || '', '\n' +
      '🏷️ originalImageUrl:', msg.originalImageUrl || ''
      );
      console.log('------------------------------');
      }
    });
    console.log(`🧩 [MergeUpdate] ${new Date().toISOString()} === END: Logging userDataCollection messages ===`);
    //  ===========================
    // DEBUG LOGGING END
    //  ===========================

    // Update the specific original message by matching its imageUrl (the original, unmerged URL)
    const updateResult = await userDataCollection.updateOne(
      { userId: new ObjectId(userId), _id: new ObjectId(userChatId) },
      {
        $set: {
          'messages.$[m].imageUrl': mergeMessage.imageUrl,
          'messages.$[m].type': 'mergeFace',
          'messages.$[m].isMerged': true,
          'messages.$[m].mergeId': mergeMessage.mergeId,
          'messages.$[m].originalImageUrl': mergeMessage.originalImageUrl
        }
      },
      {
        arrayFilters: [
          { 'm.imageUrl': mergeMessage.originalImageUrl, 'm.isMerged': { $ne: true } }
        ]
      }
    );

    if (updateResult.modifiedCount > 0) {
      console.log(`🧩 Updated original message → merged (mergeId ${mergeMessage.mergeId})`);
      return true;
    }
    console.log(`🧩 No original message matched imageUrl=${mergeMessage.originalImageUrl} to update`);
    return false;
  } catch (error) {
    console.error(`Error updating message:`, error.message);
    return false;
  }
}

// Module to check the status of a task
async function getTasks(db, status, userId) {
  try {
    await deleteOldPendingAndFailedTasks(db) // Delete old tasks before fetching
    const tasksCollection = db.collection('tasks');
    const query = {};
    if (status) query.status = status;
    if (userId) query.userId = new ObjectId(userId);
    const tasks = await tasksCollection.find(query).toArray();
    return tasks;
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
};

// Module to save the average task time
async function saveAverageTaskTime(db, time, modelName) {
  try {
    const models = db.collection('myModels');
    const result = await models.findOneAndUpdate(
      { model: modelName },
      [{
        $set: {
          taskTimeCount: { $add: [{ $ifNull: ['$taskTimeCount', 0] }, 1] },
          taskTimeAvg: {
            $divide: [
              {
                $add: [
                  { $multiply: [{ $ifNull: ['$taskTimeAvg', 0] }, { $ifNull: ['$taskTimeCount', 0] }] },
                  time
                ]
              },
              { $add: [{ $ifNull: ['$taskTimeCount', 0] }, 1] }
            ]
          }
        }
      }],
      { returnDocument: 'after' }
    );
    return result.value;
  } catch (error) {
    console.error('Error saving average task time:', error);
  }
}

// Module to delete tasks older than 5 minutes
async function deleteOldPendingAndFailedTasks(db) {
  try {
    const tasksCollection = db.collection('tasks');
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const result = await tasksCollection.deleteMany({ createdAt: { $lt: fiveMinutesAgo }, status: { $in: ['pending', 'failed'] } });
  } catch (error) {
    console.error('Error deleting old pending or failed tasks:', error);
  }
}

// Module to delete tasks older than 24 hours
async function deleteOldTasks(db) {
  try {
    const tasksCollection = db.collection('tasks');
    const aDayAgo = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 hour ago
    const result = await tasksCollection.deleteMany({ createdAt: { $lt: aDayAgo } });

  } catch (error) {
    console.error('Error deleting old tasks:', error);
  }
}
// Delete all tasks
async function deleteAllTasks(db) {
  try {
    const tasksCollection = db.collection('tasks');
    const result = await tasksCollection.deleteMany({});
  } catch (error) {
    console.error('Error deleting tasks:', error);
  }
}

async function checkTaskStatus(taskId, fastify) {
  const db = fastify.mongo.db;
  const tasksCollection = db.collection('tasks');
  const task = await tasksCollection.findOne({ taskId });

  if (!task) {
    return false;
  }

  const chat = await db.collection('chats').findOne({ _id: task.chatId });

  // CRITICAL: Check if already completed FIRST, before any processing
  if (task?.status === 'completed' || task?.completionNotificationSent === true && task?.result?.images?.length > 0) {
    console.log(`[checkTaskStatus] Task ${taskId} is already completed or notification sent.`);
    return {
      taskId: task.taskId,
      userId: task.userId,
      userChatId: task.userChatId,
      status: task.status,
      images: task.result?.images || [],
      result: task.result || { images: [] },
      fromCache: true  // Already processed, don't send notifications again
    };
  }

  if (task.status === 'failed') {
    console.log(`[checkTaskStatus] Task ${taskId} has failed status`);
    return task;
  }

  // ===== CRITICAL FIX: Acquire lock EARLY before any processing =====
  // This prevents race conditions where multiple handlers process the same task
  const lockResult = await tasksCollection.findOneAndUpdate(
    {
      taskId: task.taskId,
      completionNotificationSent: { $ne: true },  // Only lock if not already locked
      status: { $ne: 'completed' }  // Also check status for extra safety
    },
    {
      $set: {
        completionNotificationSent: true,
        processingStartedAt: new Date(),
        updatedAt: new Date()
      }
    },
    { returnDocument: 'before' }
  );

  if (!lockResult || !lockResult.value) {
    // Another process is already handling this task - return cached result with flag
    // IMPORTANT: Callers should NOT call handleTaskCompletion() when fromCache is true
    // to prevent duplicate WebSocket notifications
    console.log(`🔒 [checkTaskStatus] Task ${task.taskId} already being processed by another worker, returning cached result`);

    // Wait briefly for the other worker to finish, then return their result
    await new Promise(resolve => setTimeout(resolve, 500));
    const lockedTask = await tasksCollection.findOne({ taskId: task.taskId });
    return {
      taskId: lockedTask?.taskId || task.taskId,
      userId: lockedTask?.userId || task.userId,
      userChatId: lockedTask?.userChatId || task.userChatId,
      status: lockedTask?.status || 'completed',
      images: lockedTask?.result?.images || [],
      result: lockedTask?.result || { images: [] },
      fromCache: true  // Flag to indicate this is a cached result, not freshly processed
    };
  }

  console.log(`🔓 [checkTaskStatus] Acquired lock for task ${task.taskId}, proceeding with processing`);

  let processingPercent = 0;

  // Check if webhook already provided the result (skip polling)
  let images;
  if (task.webhookProcessed && task.result?.images) {
    console.log(`[checkTaskStatus] Using webhook-provided images for task ${task.taskId}`);
    // Use images from webhook, convert to array format expected below
    images = Array.isArray(task.result.images) ? task.result.images : [task.result.images];
  } else {
    // Poll Novita for status (legacy/fallback path)
    const result = await fetchNovitaResult(task.taskId);
    console.log(`[checkTaskStatus fetchNovitaResult] Result for task ${task.taskId}:`, result);

    if (result && result.status === 'processing') {
      processingPercent = result.progress;
      // Release lock since task is still processing
      await tasksCollection.updateOne(
        { taskId: task.taskId },
        { $set: { completionNotificationSent: false, updatedAt: new Date() } }
      );
      return { taskId: task.taskId, status: 'processing', progress: processingPercent};
    }

    if(result.error){
      console.log(`[checkTaskStatus] Task ${taskId} returned error: ${result.error}`);
      await tasksCollection.updateOne(
        { taskId: task.taskId },
        { $set: { status: 'failed', result: { error: result.error }, updatedAt: new Date() } }
      );
      return false
    }

    images = Array.isArray(result) ? result : [result];
  }


  // Process auto merge for ALL images if enabled
  let processedImages = images;
  if (task.shouldAutoMerge) {
    // For character creation with merge face, we need to get the uploaded image data
    if (task.chatCreation && task.enableMergeFace) {
      // Get the original task data to access the uploaded image
      const originalTaskRequest = await fetchOriginalTaskData(task.taskId, db);
      
      if (originalTaskRequest && originalTaskRequest.image_base64) {
        // Use the uploaded image as the face source for merging
        const mergedImages = [];
        
        for (const imageData of images) {
          try {
            const mergedResult = await performAutoMergeFaceWithBase64(
              {
                imageUrl: imageData.imageUrl,
                imageId: null,
                seed: imageData.seed
              },
              originalTaskRequest.image_base64,
              fastify
            );
            
            if (mergedResult && mergedResult.imageUrl) {
              // Only keep the merged image
              mergedImages.push({
                ...mergedResult,
                isMerged: true,
                originalImageUrl: imageData.imageUrl // Keep reference to original
              });
            } else {
              // If merge fails, fall back to original
              mergedImages.push({ ...imageData, isMerged: false });
            }
          } catch (error) {
            console.error(`Character creation merge error:`, error.message);
            // If merge fails, fall back to original
            mergedImages.push({ ...imageData, isMerged: false });
          }
        }
        
        processedImages = mergedImages; // Only use merged images
      } else {
        processedImages = images.map(imageData => ({ ...imageData, isMerged: false }));
      }
    } else {
      // Regular auto merge logic for existing chats
      // Prioritize baseFaceUrl over chatImageUrl for face merging
      const faceImageUrl = chat.baseFaceUrl || chat.chatImageUrl;
      
      if (!faceImageUrl || faceImageUrl.length === 0) {
        console.log(`[imagen] No face URL available for auto merge (baseFaceUrl: ${chat.baseFaceUrl ? 'yes' : 'no'}, chatImageUrl: ${chat.chatImageUrl ? 'yes' : 'no'})`);
        processedImages = images.map(imageData => ({ ...imageData, isMerged: false }));
      } else {
        console.log(`[imagen] Using ${chat.baseFaceUrl ? 'baseFaceUrl' : 'chatImageUrl'} for auto merge`);
        processedImages = await Promise.all(images.map(async (imageData, arrayIndex) => {
          console.log(`🧬 [checkTaskStatus] Starting auto-merge for arrayIndex=${arrayIndex}, originalUrl=${imageData.imageUrl?.substring(0, 60)}...`);
          try {
            const mergedResult = await performAutoMergeFace(
              {
                imageUrl: imageData.imageUrl,
                imageId: null,
                seed: imageData.seed
              },
              faceImageUrl,
              fastify
            );
            
            if (mergedResult && mergedResult.imageUrl) {
              console.log(`✅ [checkTaskStatus] Merge SUCCESS for arrayIndex=${arrayIndex}, mergedUrl=${mergedResult.imageUrl?.substring(0, 60)}...`);
              return {
                ...imageData, // Preserve original data
                ...mergedResult, // Apply merge updates
                isMerged: true,
                _originalArrayIndex: arrayIndex  // Track original position
              };
            } else {
              console.log(`⚠️ [checkTaskStatus] Merge returned null for arrayIndex=${arrayIndex}, using original`);
              return { ...imageData, isMerged: false, _originalArrayIndex: arrayIndex };
            }
          } catch (error) {
            console.error(`❌ [checkTaskStatus] Auto merge error for arrayIndex=${arrayIndex}:`, error.message);
            return { ...imageData, isMerged: false, _originalArrayIndex: arrayIndex };
          }
        }));
      }
    }
  } else {
    // Ensure all images have isMerged flag set to false when no auto merge
    processedImages = images.map(imageData => ({ ...imageData, isMerged: false }));
  }

  // Save processed images to database with timeout to prevent overlapping
  const savedImages = [];
  console.log(`🔄 [checkTaskStatus] Starting to save ${processedImages.length} processed images for taskId=${task.taskId}`);
  for (let arrayIndex = 0; arrayIndex < processedImages.length; arrayIndex++) {
    const imageData = processedImages[arrayIndex];
    console.log(`🖼️  [checkTaskStatus] Processing arrayIndex=${arrayIndex}/${processedImages.length}, imageUrl=${imageData.imageUrl?.substring(0, 60)}..., mergeId=${imageData.mergeId}`);
    
    let nsfw = task.type === 'nsfw';

    // === OPENAI CONTENT MODERATION ===
    console.log(`[NSFW-CHECK] Task ${task.taskId} - Image ${arrayIndex + 1}:`);
    console.log(`[NSFW-CHECK]   - Task type: ${task.type}`);
    console.log(`[NSFW-CHECK]   - Initial NSFW flag (from task.type): ${nsfw}`);

    // Use OpenAI Content Moderation API for accurate NSFW detection
    try {
      const moderationResult = await moderateImage(imageData.imageUrl);
      console.log(`[NSFW-CHECK]   - OpenAI moderation result:`, JSON.stringify(moderationResult, null, 2));

      if (moderationResult && moderationResult.results && moderationResult.results.length > 0) {
        const result = moderationResult.results[0];

        // OpenAI moderation is authoritative - trust its result over task.type
        if (result.flagged) {
          console.log(`[NSFW-CHECK]   - ⚠️ FLAGGED by OpenAI moderation`);
          nsfw = true;

          // Log specific categories that were flagged
          const flaggedCategories = Object.entries(result.categories || {})
            .filter(([_, flagged]) => flagged)
            .map(([category]) => category);
          console.log(`[NSFW-CHECK]   - Flagged categories: ${flaggedCategories.join(', ') || 'none'}`);

          // Log category scores for debugging
          if (result.category_scores) {
            const highScores = Object.entries(result.category_scores)
              .filter(([_, score]) => score > 0.5)
              .map(([category, score]) => `${category}: ${(score * 100).toFixed(1)}%`);
            if (highScores.length > 0) {
              console.log(`[NSFW-CHECK]   - High scores: ${highScores.join(', ')}`);
            }
          }
        } else {
          // OpenAI says it's safe - trust OpenAI over task.type
          console.log(`[NSFW-CHECK]   - ✅ PASSED OpenAI moderation - marking as safe`);
          nsfw = false;
        }
      } else {
        console.log(`[NSFW-CHECK]   - ℹ️ No valid OpenAI moderation result`);
      }
    } catch (moderationError) {
      console.error(`[NSFW-CHECK]   - ❌ OpenAI moderation error:`, moderationError.message);
      // On error, keep the initial nsfw flag based on task.type
    }
    console.log(`[NSFW-CHECK]   - Final NSFW flag: ${nsfw}`);
    // === END OPENAI CONTENT MODERATION ===
    
    let uniqueSlug = task.slug;
    if (processedImages.length > 1) {
      uniqueSlug = `${task.slug}-${arrayIndex + 1}`;
    }

    // NOTE: When auto-merge succeeds, we only save the merged image (not the original).
    // The original image URL is preserved in the merged image's `originalImageUrl` field.
    // This prevents duplicate images from appearing in the chat after page refresh.
    // If merge fails, the original image is saved as a fallback (handled in the merge error catches above).

    // Calculate proper batch metadata for sequential tasks
    // Sequential tasks generate one image per task, but they should be grouped as a batch
    let batchId = task.placeholderId || task.taskId;
    let batchIndex = arrayIndex;
    let batchSize = processedImages.length;
    
    if (task.requiresSequentialGeneration || task.sequentialParentTaskId) {
      // This is a sequential task - get proper batch info
      if (task.sequentialExpectedCount) {
        // Parent task (batchIndex 0)
        batchSize = task.sequentialExpectedCount;
        batchIndex = 0;
        console.log(`📦 [checkTaskStatus] Sequential parent task - batchId=${batchId}, batchIndex=${batchIndex}, batchSize=${batchSize}`);
      } else if (task.sequentialParentTaskId && typeof task.sequentialImageIndex === 'number') {
        // Child task - use parent's placeholderId as batchId
        const db = fastify.mongo.db;
        const parentTask = await db.collection('tasks').findOne({ taskId: task.sequentialParentTaskId });
        if (parentTask) {
          batchId = parentTask.placeholderId || task.sequentialParentTaskId;
          batchSize = parentTask.sequentialExpectedCount || 1;
          batchIndex = task.sequentialImageIndex - 1; // Convert to 0-based (2->1, 3->2, etc.)
          console.log(`📦 [checkTaskStatus] Sequential child task - batchId=${batchId}, batchIndex=${batchIndex}, batchSize=${batchSize}`);
        }
      }
    }

    // Save the merged/processed image (or original if merge failed)
    const imageResult = await saveImageToDB({
      taskId: task.taskId,
      userId: task.userId,
      chatId: task.chatId,
      userChatId: task.userChatId,
      prompt: task.prompt,
      title: task.title,
      slug: uniqueSlug,
      imageUrl: imageData.imageUrl,
      aspectRatio: task.aspectRatio,
      seed: imageData.seed,
      blurredImageUrl: imageData.blurredImageUrl,
      nsfw: nsfw,
      fastify,
      isMerged: imageData.isMerged,
      originalImageUrl: imageData.originalImageUrl,
      mergeId: imageData.mergeId,
      shouldAutoMerge: task.shouldAutoMerge,
      // Pass batch metadata for slider reconstruction on refresh
      batchId: batchId,
      batchIndex: batchIndex,
      batchSize: batchSize,
      imageModelId: task.imageModelId || null
    });

    // When saving auto-merged results, make sure to create the relationship
    if (task.shouldAutoMerge && imageData.isMerged && imageData.mergeId) {
      try {
        const { saveMergedFaceToDB } = require('./merge-face-utils');
        
        await saveMergedFaceToDB({
          originalImageId: imageResult.imageId,
          mergedImageUrl: imageData.imageUrl,
          userId: task.userId,
          chatId: task.chatId,
          userChatId: task.userChatId,
          fastify
        });
        
      } catch (error) {
        console.error(`[checkTaskStatus] Error creating merge relationship:`, error);
      }
    }

    savedImages.push({
      ...imageResult,
      status: 'completed'
    });

    // Add small delay between saves to prevent overlapping (except for the last image)
    if (arrayIndex < processedImages.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // CRITICAL DEBUG: Verify all messages were saved correctly BEFORE returning
  const verifyDb = fastify.mongo.db;
  const verifyCollection = verifyDb.collection('userChat');
  const verifyDoc = await verifyCollection.findOne({ 
    userId: new ObjectId(task.userId), 
    _id: new ObjectId(task.userChatId) 
  });
  if (verifyDoc && verifyDoc.messages) {
    const batchId = task.placeholderId || task.taskId;
    const batchMessages = verifyDoc.messages.filter(m => m.batchId === batchId);
    console.log(`🔍 [checkTaskStatus] FINAL VERIFICATION after all saves - batchId=${batchId}:`);
    batchMessages.forEach((m, idx) => {
      console.log(`   [${idx}] imageId=${m.imageId}, batchIndex=${m.batchIndex}`);
    });
    console.log(`🔍 [checkTaskStatus] Total batch messages: ${batchMessages.length} (expected ${processedImages.length})`);
  }

  // Update task status to completed with proper merge information
  const updateResult = await tasksCollection.findOneAndUpdate(
    { 
      taskId: task.taskId
    },
    { 
      $set: { 
        status: 'completed', 
        result: { images: savedImages },
        updatedAt: new Date() 
      } 
    },
    { returnDocument: 'after' }
  );

  const finalResult = { 
    taskId: task.taskId, 
    userId: task.userId, 
    userChatId: task.userChatId, 
    status: 'completed', 
    images: savedImages,
    result: { images: savedImages }
  };

  return finalResult;
}
/**
 * Get webhook URL for Novita tasks
 * Uses environment variable or constructs from base domain
 */
function getWebhookUrl() {
  // Check for explicit webhook URL in environment
  if (process.env.NOVITA_WEBHOOK_URL) {
    return process.env.NOVITA_WEBHOOK_URL;
  }
  
  // Construct from base URL
  if (process.env.MODE === 'local') {
    // For local development, use ngrok or local tunnel URL if provided
    if (process.env.LOCAL_WEBHOOK_URL) {
      return process.env.LOCAL_WEBHOOK_URL;
    }
    // Fallback: localhost (may not work - webhook should be publicly accessible)
    return 'http://localhost:3000/novita/webhook';
  } else {
    // Production: use the main domain
    const baseDomain = process.env.PUBLIC_BASE_DOMAIN || 'chatlamix.com';
    return `https://app.${baseDomain}/novita/webhook`;
  }
}

// Function to trigger the Novita API for text-to-image generation
async function fetchNovitaMagic(data, hunyuan = false, builtInModelId = null) {
  try {
    // Validate prompt before sending to API (must be 1-1024 characters)
    if (!data.prompt || typeof data.prompt !== 'string') {
      console.error('[fetchNovitaMagic] Invalid prompt: prompt is missing or not a string');
      return false;
    }
    
    const trimmedPrompt = data.prompt.trim();
    if (trimmedPrompt.length === 0 || trimmedPrompt.length > 1024) {
      console.error(`[fetchNovitaMagic] Invalid prompt length: ${trimmedPrompt.length} (must be 1-1024 characters)`);
      return false;
    }
    
    // Ensure prompt is trimmed and within limits
    data.prompt = trimmedPrompt.length > 1024 ? trimmedPrompt.substring(0, 1024).trim() : trimmedPrompt;
    
    let apiUrl = 'https://api.novita.ai/v3/async/txt2img';
    if (data.image_base64) {
      apiUrl = 'https://api.novita.ai/v3/async/img2img';
    }
    if (hunyuan) {
      apiUrl = 'https://api.novita.ai/v3/async/hunyuan-image-3';
      console.log('[fetchNovitaMagic] Using Hunyuan Image 3 for photorealistic generation');
    }
    // Check if using a built-in model type (z-image-turbo, etc.)
    if (builtInModelId && MODEL_CONFIGS[builtInModelId]) {
      const modelConfig = MODEL_CONFIGS[builtInModelId];
      apiUrl = modelConfig.endpoint;
      console.log(`[fetchNovitaMagic] Using built-in model: ${builtInModelId}, endpoint: ${apiUrl}`);
    }
    
    // Get webhook URL
    const webhookUrl = getWebhookUrl();
    console.log(`[fetchNovitaMagic] 🔗 Webhook URL: ${webhookUrl}`);
    if (webhookUrl.includes('localhost')) {
      console.warn(`[fetchNovitaMagic] ⚠️ WARNING: Using localhost webhook URL - Novita cannot reach this! Set LOCAL_WEBHOOK_URL env variable with ngrok URL.`);
    }
    
    let requestBody = {
      headers: {
        Authorization: `Bearer ${process.env.NOVITA_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
    if (hunyuan) {
      // Hunyuan Image 3 uses a different request format
      // Note: Hunyuan does NOT support image_num - only generates 1 image per call
      requestBody.data = {
        prompt: data.prompt,
        size: '768*1024', // Portrait orientation for character creation
        seed: data.seed || -1,
        extra: {
          webhook: {
            url: webhookUrl
          }
        }
      };
    } else if (builtInModelId && MODEL_CONFIGS[builtInModelId]) {
      // Built-in model (z-image-turbo, etc.) - use flat request structure
      // Only include supported parameters from MODEL_CONFIGS
      const modelConfig = MODEL_CONFIGS[builtInModelId];
      const supportedParams = modelConfig.supportedParams || [];
      
      requestBody.data = {
        prompt: data.prompt
      };
      
      // Add only supported parameters
      if (supportedParams.includes('size') && data.size) {
        requestBody.data.size = data.size;
      }
      if (supportedParams.includes('seed') && data.seed !== undefined) {
        requestBody.data.seed = data.seed;
      }
      if (supportedParams.includes('enable_base64_output') && data.enable_base64_output !== undefined) {
        requestBody.data.enable_base64_output = data.enable_base64_output;
      }
      if (supportedParams.includes('negative_prompt') && data.negative_prompt) {
        requestBody.data.negative_prompt = data.negative_prompt;
      }
      
      // Add webhook to extra if supported
      if (webhookUrl) {
        requestBody.data.extra = {
          webhook: {
            url: webhookUrl
          }
        };
      }
      
      console.log(`[fetchNovitaMagic] Built-in model request body:`, JSON.stringify(requestBody.data, null, 2));
    } else {
      requestBody.data = {
        extra: {
          response_image_type: 'jpeg',
          webhook: {
            url: webhookUrl
          }
        },
        request: data,
      }
    }

    console.log(`[fetchNovitaMagic] 📤 Sending request to: ${apiUrl}`);
    
    const response = await axios.post(apiUrl, requestBody.data, {
      headers: requestBody.headers,
    });
    
    console.log(`[fetchNovitaMagic] 📥 Response status: ${response.status}`);
    console.log(`[fetchNovitaMagic] 📥 Response data:`, JSON.stringify(response.data, null, 2));
    
    if (response.status !== 200) {
      console.error(`[fetchNovitaMagic] ❌ Error - ${response.data.reason || response.data.message || 'Unknown error'}`);
      return false;
    }
    
    // For built-in async models (z-image-turbo, flux-2-flex, etc.), extract task_id
    if (builtInModelId && MODEL_CONFIGS[builtInModelId] && MODEL_CONFIGS[builtInModelId].async) {
      // Task ID can be in multiple locations depending on API version
      const taskId = response.data.task_id || response.data.data?.task_id || response.data.id;
      if (!taskId) {
        console.error(`[fetchNovitaMagic] ❌ No task_id found in response for ${builtInModelId}:`, JSON.stringify(response.data, null, 2));
        return false;
      }
      console.log(`[fetchNovitaMagic] ✅ Built-in model ${builtInModelId} task created with ID: ${taskId}`);
      return taskId;
    }
    
    // For Hunyuan Image 3, return task_id for polling
    if (hunyuan) {
      const taskId = response.data.task_id;
      console.log(`[fetchNovitaMagic] ✅ Hunyuan Image 3 task started with ID: ${taskId}`);
      return taskId;
    }
        
    // Return the task ID for polling
    const taskId = response.data.task_id;
    return taskId;
    
  } catch (error) {
    console.error('Error fetching Novita image:', error.message);
    console.log(error)
    return false;
  }
}
  
// Function to fetch Novita's task result (single check)
async function fetchNovitaResult(task_id) {
    try {
    const response = await axios.get(`https://api.novita.ai/v3/async/task-result?task_id=${task_id}`, {
        headers: {
        Authorization: `Bearer ${process.env.NOVITA_API_KEY}`,
        },
    });

    if (response.status !== 200) {
        throw new Error(`Non-200 response: ${await response.text()}`);
    }

    const taskStatus = response.data.task.status;
    const progressPercent = response.data.task.progress_percent;

    if (taskStatus === 'TASK_STATUS_SUCCEED') {
        const images = response.data.images;
        if (!images || images.length === 0) {
        throw new Error('No images returned from Novita API');
        }

        // Safely get seed from extra (may not exist for Hunyuan)
        const seed = response.data.extra?.seed || 0;

        const s3Urls = await Promise.all(images.map(async (image, index) => {
          const imageUrl = image.image_url;
          const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
          const buffer = Buffer.from(imageResponse.data, 'binary');
          const hash = createHash('md5').update(buffer).digest('hex');
          const uploadedUrl = await uploadImage(buffer, hash, 'novita_result_image.png');
          console.log(`🚀 [fetchNovitaResult] Uploaded image ${index + 1} with hash: ${hash}`);
          return {
            imageId: hash,
            imageUrl: uploadedUrl,
            seed: seed,
            index
          };
          }));

        return s3Urls.length === 1 ? s3Urls[0] : s3Urls;
    } else if (taskStatus === 'TASK_STATUS_FAILED') {
        console.log(`Task failed with reason: ${response.data.task.reason}`);
        return { error: response.data.task.reason, status: 'failed' };
    } else {
        return {status: 'processing', progress: progressPercent};
    }

    } catch (error) {
      console.error("Error fetching Novita result:", error.message);
      return { error: error.message, status: 'failed' };
    }
}

// Function to update the slug of a task
async function updateSlug({ taskId, taskSlug, fastify, userId, chatId, placeholderId }) {
  const db = fastify.mongo.db; 
  const tasksCollection = db.collection('tasks');
  const galleryCollection = db.collection('gallery');

  const task = await tasksCollection.findOne({ taskId });
  if (task && task.status !== 'completed') {
    await tasksCollection.updateOne(
      { taskId },
      { $set: { slug: taskSlug, updatedAt: new Date() } }
    );
  } else {
    await galleryCollection.updateOne(
      { userId: new ObjectId(userId), chatId: new ObjectId(chatId), "images.taskId": taskId },
      { $set: { "images.$.slug": taskSlug } }
    );
  }
}
// Function to update the title of a task
async function updateTitle({ taskId, newTitle, fastify, userId, chatId, placeholderId }) {
  const db = fastify.mongo.db; 
  const tasksCollection = db.collection('tasks');
  const galleryCollection = db.collection('gallery');

  const task = await tasksCollection.findOne({ taskId });
  if (task && task.status !== 'completed') {
    await tasksCollection.updateOne(
      { taskId },
      { $set: { title: newTitle, updatedAt: new Date() } }
    );
  } else {
    await galleryCollection.updateOne(
      { userId: new ObjectId(userId), chatId: new ObjectId(chatId), "images.taskId": taskId },
      { $set: { "images.$.title": newTitle } }
    );
  }
}

// Function to get a prompt by its ID
async function getPromptById(db, id) {
  try {
    // Validate and parse the id
    if (!ObjectId.isValid(id)) {
      throw new Error('Invalid ID format');
    }

    const prompt = await db.collection('prompts').findOne({ _id: new ObjectId(id) });

    if (!prompt) {
      return { success: false, message: 'Prompt not found', data: null };
    }

    return prompt;
  } catch (error) {
    console.error('Error fetching prompt:', error);
    throw new Error('Error fetching prompt'); // Re-throw error to be handled by the caller
  }
}

function characterDescriptionToString(data) {
    if(!data) return "";
    
    const details = data?.details_description;
    const appearance = details?.appearance;
    const face = details?.face;
    const hair = details?.hair;
    const body = details?.body;
    const style = details?.style;
    
    // Build physical description string
    let description = [];
    
    // Basic appearance
    if (appearance?.age) description.push(`Age: ${appearance.age}`);
    if (appearance?.gender) description.push(`Gender: ${appearance.gender}`);
    if (appearance?.ethnicity) description.push(`Ethnicity: ${appearance.ethnicity}`);
    if (appearance?.height) description.push(`Height: ${appearance.height}`);
    if (appearance?.weight) description.push(`Weight: ${appearance.weight}`);
    if (appearance?.bodyType) description.push(`Body Type: ${appearance.bodyType}`);
    
    // Face features
    if (face?.faceShape) description.push(`Face Shape: ${face.faceShape}`);
    if (face?.skinColor) description.push(`Skin: ${face.skinColor}`);
    if (face?.eyeColor) description.push(`Eyes: ${face.eyeColor}`);
    if (face?.eyeShape) description.push(`Eye Shape: ${face.eyeShape}`);
    if (face?.eyeSize) description.push(`Eye Size: ${face.eyeSize}`);
    if (face?.facialFeatures) description.push(`Facial Features: ${face.facialFeatures}`);
    
    // Hair
    if (hair?.hairColor) description.push(`Hair Color: ${hair.hairColor}`);
    if (hair?.hairLength) description.push(`Hair Length: ${hair.hairLength}`);
    if (hair?.hairStyle) description.push(`Hair Style: ${hair.hairStyle}`);
    if (hair?.hairTexture) description.push(`Hair Texture: ${hair.hairTexture}`);
    
    // Body details
    if (body?.breastSize) description.push(`Breast Size: ${body.breastSize}`);
    if (body?.assSize) description.push(`Ass Size: ${body.assSize}`);
    if (body?.bodyCurves) description.push(`Body Curves: ${body.bodyCurves}`);
    if (body?.chestBuild) description.push(`Chest Build: ${body.chestBuild}`);
    if (body?.shoulderWidth) description.push(`Shoulders: ${body.shoulderWidth}`);
    if (body?.absDefinition) description.push(`Abs: ${body.absDefinition}`);
    if (body?.armMuscles) description.push(`Arms: ${body.armMuscles}`);
    
    // Style and accessories
    if (style?.clothingStyle) description.push(`Clothing Style: ${style.clothingStyle}`);
    if (style?.accessories) description.push(`Accessories: ${style.accessories}`);
    if (style?.tattoos && style.tattoos !== 'none') description.push(`Tattoos: ${style.tattoos}`);
    if (style?.piercings && style.piercings !== 'none') description.push(`Piercings: ${style.piercings}`);
    if (style?.scars && style.scars !== 'none') description.push(`Scars: ${style.scars}`);
    
    // Fallback to existing description fields if no structured data
    if (description.length === 0) {
        const fallbackDescription = data?.enhancedPrompt || data?.imageDescription || data?.characterPrompt || "";
        return fallbackDescription;
    }
    
    return description.join(', ');
}
async function checkImageDescription(db, chatId = null, chatRawData = null) {
  try {
    let chatData = chatRawData;
    if (!chatData) {
      chatData = await db.collection('chats').findOne({ _id: new ObjectId(chatId) });
    }
    const characterPrompt = chatData?.enhancedPrompt || chatData?.imageDescription || chatData?.characterPrompt || null;
    const characterDescriptionString = characterDescriptionToString(chatData);
    characterDescription = (characterPrompt ? ` ${characterPrompt}` : '') +' '+ (characterDescriptionString ? ` ${characterDescriptionString}` : '');
    
    return characterDescription;

  } catch (error) {
    console.error('Error checking image description:', error);
    return { imageDescription: null };
    
  }
}

async function getImageSeed(db, imageId) {
  // Always return -1
  return -1;
  
  // Original logic kept inside unreachable code block
  if (false) {
    if (!ObjectId.isValid(imageId)) {
      throw new Error('Invalid imageId format');
    }
    try {
      const objectId = new ObjectId(imageId);
      const imageDocument = await db.collection('gallery').findOne(
        { "images._id": objectId },
        { projection: { "images.$": 1 } }
      );

      if (!imageDocument || !imageDocument.images?.length) {
        return null;
      }

      const image = imageDocument.images[0];
      return Number.isInteger(image.seed) ? image.seed : parseInt(image.seed, 10);
    }
    catch (error) {
      return null;
    }
  }
}
async function saveImageToDB({taskId, userId, chatId, userChatId, prompt, title, slug, imageUrl, aspectRatio, seed, blurredImageUrl = null, nsfw = false, fastify, isMerged = false, originalImageUrl = null, mergeId = null, shouldAutoMerge = false, thumbnailUrl = null, batchId = null, batchIndex = null, batchSize = null, imageModelId = null}) {

  console.log(`🖼️ [saveImageToDB] START: batchIndex=${batchIndex}/${batchSize}, batchId=${batchId}, taskId=${taskId}, imageUrl=${imageUrl?.substring(0, 60)}...`);

  // CRITICAL VALIDATION: Ensure we have all required data before saving
  if (!imageUrl || !taskId || !userId || !chatId) {
    console.error(`❌ [saveImageToDB] CRITICAL: Missing required data - imageUrl=${!!imageUrl}, taskId=${!!taskId}, userId=${!!userId}, chatId=${!!chatId}`);
    console.error(`❌ [saveImageToDB] Refusing to save incomplete image to prevent database corruption`);
    return false;
  }

  // Validate imageUrl is a proper URL or data URI
  if (!imageUrl.startsWith('http') && !imageUrl.startsWith('data:image/')) {
    console.error(`❌ [saveImageToDB] CRITICAL: Invalid imageUrl format: ${imageUrl?.substring(0, 60)}...`);
    return false;
  }

  // Validate ObjectId formats
  if (!ObjectId.isValid(userId) || !ObjectId.isValid(chatId)) {
    console.error(`❌ [saveImageToDB] CRITICAL: Invalid ObjectId - userId=${userId}, chatId=${chatId}`);
    return false;
  }

  const db = fastify.mongo.db;
  const { generateThumbnailFromUrl } = require('../models/tool');
  try {
    const chatsGalleryCollection = db.collection('gallery');

    // More flexible duplicate check for character creation and merged images
    let existingImage;
    
    if (isMerged && mergeId) {
      console.log(`🔍 [saveImageToDB] Checking for existing merged image with mergeId=${mergeId}, batchIndex=${batchIndex}`);
      existingImage = await chatsGalleryCollection.findOne({
        userId: new ObjectId(userId),
        chatId: new ObjectId(chatId),
        'images.taskId': taskId,
        'images.mergeId': mergeId
      });
      
      if (existingImage) {
        const image = existingImage.images.find(img => img.mergeId === mergeId);
        if (image) {
          console.log(`⚠️  [saveImageToDB] Found existing merged image in gallery for mergeId=${mergeId}, imageId=${image._id}, will check for message`);
          // CRITICAL FIX: Even if image exists in gallery, ensure chat message exists
          if (userChatId && ObjectId.isValid(userChatId)) {
            const userDataCollection = db.collection('userChat');
            
            // CRITICAL FIX: For merged images, ALWAYS check by mergeId first
            // This is the primary deduplication key for merged images
            let existingMessage = await userDataCollection.findOne({
              userId: new ObjectId(userId),
              _id: new ObjectId(userChatId),
              'messages.mergeId': mergeId
            });
            
            if (!existingMessage) {
              console.log(`💾 [saveImageToDB] Adding message for mergeId: ${mergeId}, batchIndex=${batchIndex}`);
              // Add the merged message with batch metadata
              await addImageMessageToChatHelper(
                userDataCollection,
                userId,
                userChatId,
                image.imageUrl,
                image._id,
                image.prompt,
                image.title,
                image.nsfw,
                true,  // isMerged
                mergeId,
                image.originalImageUrl,
                batchId,
                batchIndex,
                batchSize
              );
            } else {
              console.log(`💾 [saveImageToDB] Message already exists for mergeId: ${mergeId}, skipping`);
            }
          }
          return { 
            imageId: image._id, 
            imageUrl: image.imageUrl,
            thumbnailUrl: image.thumbnailUrl || null,
            prompt: image.prompt,
            title: image.title,
            nsfw: image.nsfw,
            isMerged: image.isMerged || false
          };
        }
      } 
    } else {
      existingImage = await chatsGalleryCollection.findOne({
        userId: new ObjectId(userId),
        chatId: new ObjectId(chatId),
        'images.taskId': taskId,
        'images.imageUrl': imageUrl
      });

      if (existingImage) {
        const image = existingImage.images.find(img => 
          img.imageUrl === imageUrl && img.taskId === taskId
        );
        if (image) {
          // CRITICAL FIX: Even if image exists in gallery, ensure chat message exists
          if (userChatId && ObjectId.isValid(userChatId)) {
            const userDataCollection = db.collection('userChat');
            
            // For batched images, check for this specific batchIndex
            // CRITICAL FIX: Use $elemMatch to ensure both conditions match on the SAME array element
            let existingMessage;
            if (batchId && batchIndex !== null) {
              existingMessage = await userDataCollection.findOne({
                userId: new ObjectId(userId),
                _id: new ObjectId(userChatId),
                messages: { $elemMatch: { batchId: batchId, batchIndex: batchIndex } }
              });
            } else {
              existingMessage = await userDataCollection.findOne({
                userId: new ObjectId(userId),
                _id: new ObjectId(userChatId),
                'messages.imageId': image._id.toString()
              });
            }
            
            if (!existingMessage) {
              console.log(`💾 [saveImageToDB] Image exists in gallery but message missing - adding message for imageId: ${image._id}, batchIndex=${batchIndex}`);
              await addImageMessageToChatHelper(
                userDataCollection,
                userId, 
                userChatId, 
                image.imageUrl, 
                image._id, 
                image.prompt, 
                image.title,
                image.nsfw,
                false,
                null,
                null,
                batchId,
                batchIndex,
                batchSize
              );
            }
          }
          return { 
            imageId: image._id, 
            imageUrl: image.imageUrl,
            thumbnailUrl: image.thumbnailUrl || null,
            prompt: image.prompt,
            title: image.title,
            nsfw: image.nsfw,
            isMerged: image.isMerged || false
          };
        }
      } 
    }

    // Generate imageId first (needed for slug generation)
    const imageId = new ObjectId();
    
    // Generate enhanced slug if not provided
    if (!slug) {
      try {
        // Get chat to access its slug for enhanced image slug generation
        const chat = await db.collection('chats').findOne({ _id: new ObjectId(chatId) });
        const chatSlug = chat?.slug || '';
        
        // Get title for slug
        const imageTitle = title && typeof title === 'object' 
          ? (title.en || title.ja || title.fr || '')
          : (title || '');
        
        // Generate enhanced image slug using the actual imageId
        slug = generateImageSlug(imageTitle || prompt.substring(0, 50), chatSlug, imageId);
        
        // Double-check for duplicates (shouldn't happen with ObjectId, but be safe)
        const existingImage_check = await chatsGalleryCollection.findOne({
          "images.slug": slug
        });
        
        if (existingImage_check) {
          // Edge case: append timestamp if somehow duplicate
          const timestamp = Date.now().toString(36).substring(7);
          slug = `${slug}-${timestamp}`;
        }
      } catch (err) {
        console.error('[saveImageToDB] Error generating enhanced image slug, using fallback:', err);
        // Fallback to basic slug generation
        if (title && typeof title === 'object') {
          const firstAvailableTitle = title.en || title.ja || title.fr || '';
          slug = slugify(firstAvailableTitle.substring(0, 50), { lower: true, strict: true });
        } else {
          slug = slugify(prompt.substring(0, 50), { lower: true, strict: true });
        }
        
        const existingImage_check = await chatsGalleryCollection.findOne({
          "images.slug": slug
        });
        
        if (existingImage_check) {
          const randomStr = Math.random().toString(36).substring(2, 8);
          slug = `${slug}-${randomStr}`;
        }
      }
    }
    // Generate thumbnail if not provided
    let finalThumbnailUrl = thumbnailUrl;
    if (!finalThumbnailUrl && imageUrl) {
      try {
        console.log(`[saveImageToDB] Generating thumbnail for image: ${imageUrl.substring(0, 80)}...`);
        const thumbResult = await generateThumbnailFromUrl(imageUrl);
        finalThumbnailUrl = thumbResult.thumbnailUrl;
        if (finalThumbnailUrl) {
          console.log(`[saveImageToDB] Thumbnail generated successfully`);
        }
      } catch (thumbError) {
        console.error('[saveImageToDB] Failed to generate thumbnail:', thumbError.message);
        // Continue without thumbnail - it's an optimization, not required
      }
    }

    // Ensure we never save undefined values for prompt and title
    const safePrompt = prompt || '';
    const safeTitle = title || '';

    const imageDocument = {
      _id: imageId,
      taskId,
      prompt: safePrompt,
      title: safeTitle,
      slug,
      imageUrl,
      thumbnailUrl: finalThumbnailUrl,
      originalImageUrl: imageUrl,
      blurredImageUrl,
      aspectRatio,
      seed,
      isBlurred: !!blurredImageUrl,
      nsfw,
      imageModelId: imageModelId || null,
      createdAt: new Date()
    };

    // Add merge-specific fields if this is a merged image
    if (isMerged) {
      imageDocument.isMerged = true;
      imageDocument.originalImageUrl = originalImageUrl;
      if (mergeId) {
        imageDocument.mergeId = mergeId;
      }
    } else {
      imageDocument.isMerged = false;
    }
    

    const updateResult = await chatsGalleryCollection.updateOne(
      { 
        userId: new ObjectId(userId),
        chatId: new ObjectId(chatId),
      },
      { 
        $push: { 
          images: imageDocument
        },
      },
      { upsert: true }
    );
    
  
    // Update counters
    const chatsCollection = db.collection('chats');
    const chatUpdateResult = await chatsCollection.updateOne(
      { _id: new ObjectId(chatId) },
      { $inc: { imageCount: 1 } }
    );

    const usersCollection = db.collection('users');
    const userUpdateResult = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $inc: { imageCount: 1 } }
    );
    
    try {
      await awardImageGenerationReward(db, userId, fastify);
      await awardCharacterImageMilestoneReward(db, userId, chatId, fastify);
    } catch (error) {
      console.error('Error awarding image generation milestones:', error);
    }
    
    if (!userChatId || !ObjectId.isValid(userChatId)) {
      console.warn(`⚠️  [saveImageToDB] Invalid or missing userChatId: ${userChatId}, image saved to gallery but NOT to chat messages. This may cause undefined images in chat!`);
      console.warn(`⚠️  [saveImageToDB] imageId=${imageId}, taskId=${taskId}, batchId=${batchId}, batchIndex=${batchIndex}`);
      return {
        imageId,
        imageUrl,
        thumbnailUrl: finalThumbnailUrl,
        prompt,
        title,
        nsfw,
        isMerged: isMerged || false
      };
    }
    
    const userDataCollection = db.collection('userChat');
    const userData = await userDataCollection.findOne({ 
      userId: new ObjectId(userId), 
      _id: new ObjectId(userChatId) 
    });
    

    if (!userData) {
      throw new Error('User data not found');
    }

    const titleString = getTitleString(title);

    // ALWAYS ensure message is added with batch metadata
    if (isMerged && mergeId) {
      const mergeMessage = {
        imageUrl,
        mergeId: mergeId,
        originalImageUrl: originalImageUrl
      };

      const wasUpdated = await updateOriginalMessageWithMerge(userDataCollection, taskId, userId, userChatId, mergeMessage);
      console.log(`updateOriginalMessageWithMerge returned: ${wasUpdated}`);
      
      // If no original message was found to update, create a new message for the merged image
      if (!wasUpdated) {
        console.log(`💾 No original message to update, adding merged image as new message for userChatId: ${userChatId}`);
        await addImageMessageToChatHelper(
          userDataCollection,
          userId, 
          userChatId, 
          imageUrl, 
          imageId, 
          prompt, 
          title,
          nsfw,
          true,  // isMerged
          mergeId,
          originalImageUrl,
          batchId,
          batchIndex,
          batchSize
        );
      }
   
    } else if (userChatId) {
      console.log(`💾 Adding image (non merged) message to chat for userChatId: ${userChatId}`)
      await addImageMessageToChatHelper(
        userDataCollection,
        userId, 
        userChatId, 
        imageUrl, 
        imageId, 
        prompt, 
        title,
        nsfw,
        false,
        null,
        null,
        batchId,
        batchIndex,
        batchSize
      );
      
    }

    return { 
      imageId, 
      imageUrl,
      thumbnailUrl: finalThumbnailUrl,
      prompt,
      title,
      nsfw,
      isMerged: isMerged || false
    };
    
  } catch (error) {
    return false;
  }
}

// Handle task completion: send notifications and save images as needed
async function handleTaskCompletion(taskStatus, fastify, options = {}) {
  const { chatCreation, translations, userId, chatId, placeholderId, sequentialBatchInfo } = options;
  let images = [];
  let characterImageUrls = [];
  // Try multiple ways to get the correct images with merge data
  if (taskStatus.result && Array.isArray(taskStatus.result.images)) {
    images = taskStatus.result.images;
  } else if (Array.isArray(taskStatus.images)) {
    images = taskStatus.images;
  } else if (taskStatus.result && taskStatus.result.images && !Array.isArray(taskStatus.result.images)) {
    images = [taskStatus.result.images];
  }
  if (typeof fastify.sendNotificationToUser !== 'function') {
    console.error('fastify.sendNotificationToUser is not a function');
    return;
  }
  
  fastify.sendNotificationToUser(userId, 'handleLoader', { imageId: placeholderId, action: 'remove' });
  fastify.sendNotificationToUser(userId, 'handleRegenSpin', { imageId: placeholderId, spin: false });
  fastify.sendNotificationToUser(userId, 'updateImageCount', { chatId, count: images.length });

  if (images || Array.isArray(images)) {

    try {
      // Increment image generation count once per task, not per image
      await fastify.mongo.db.collection('images_generated').updateOne(
        { userId: new ObjectId(taskStatus.userId), chatId: chatId ? new ObjectId(chatId) : null },
        { $inc: { generationCount: images.length } }, // Increment by the number of images
        { upsert: true }
      );
    } catch (error) {
      console.error('[handleTaskCompletion] Error incrementing image generation count:', error);
    }

    // Note: Using characterImageUrls declared at the top of the function (line 2349)

    for (let index = 0; index < images.length; index++) {
      const image = images[index];
      const { imageId, imageUrl, thumbnailUrl, prompt, title, nsfw, isMerged } = image;
      const { userId: taskUserId, userChatId } = taskStatus;
            
      if (chatCreation) {
        fastify.sendNotificationToUser(userId, 'characterImageGenerated', { imageUrl, thumbnailUrl, nsfw, chatId });
        characterImageUrls.push(imageUrl);
      } else {
        // Calculate batch info: use sequentialBatchInfo for models without batch support,
        // otherwise use the default index/images.length
        const { batchIndex = index, batchSize = images.length } = sequentialBatchInfo || {};
        
        const notificationData = {
          id: imageId?.toString(),
          imageId: imageId?.toString(),
          imageUrl,
          thumbnailUrl,
          userChatId,
          title: getTitleString(title),
          prompt,
          nsfw,
          isMergeFace: isMerged || false,
          isAutoMerge: isMerged || false,
          url: imageUrl,
          // Batch info for grouping multiple images into a slider
          batchId: placeholderId || taskStatus.taskId,
          batchIndex,
          batchSize
        };

        fastify.sendNotificationToUser(userId, 'imageGenerated', notificationData);
      
        // ===========================
        // == User Chat Message Image Debug ==
        // ===========================
        const userChatCollection = fastify.mongo.db.collection('userChat');
        try {
          const userChatData = await userChatCollection.findOne({ userId: new ObjectId(userId), _id: new ObjectId(userChatId) });
        } catch (error) {
          console.error(`[handleTaskCompletion] Error fetching UserChat data for logging:`, error);
        }
        // ===========================
        // == End Section ==
        // ===========================
      }
    }
  }

  // For character creation, update the chat with all image URLs
  if (chatCreation && characterImageUrls.length > 0) {
    const collectionChats = fastify.mongo.db.collection('chats');
    await collectionChats.updateOne(
      { _id: new ObjectId(chatId) },
      { 
        $set: { 
          chatImageUrl: characterImageUrls
        } 
      }
    );
  }

  if (chatCreation) {
    fastify.sendNotificationToUser(userId, 'resetCharacterForm');
    fastify.sendNotificationToUser(userId, 'showNotification', {
      message: translations?.newCharacter?.imageCompletionDone_message || 'Your image has been generated successfully.',
      icon: 'success'
    });
  }

  // DEBUG: Final check of messages in database after handleTaskCompletion
  const { userChatId } = taskStatus;
  if (userChatId && placeholderId) {
    const debugCollection = fastify.mongo.db.collection('userChat');
    const debugDoc = await debugCollection.findOne({ _id: new ObjectId(userChatId) });
    if (debugDoc && debugDoc.messages) {
      const batchMessages = debugDoc.messages.filter(m => m.batchId === placeholderId);
      console.log(`🔍 [handleTaskCompletion] END - batch messages for batchId=${placeholderId}:`);
      batchMessages.forEach((m, idx) => {
        console.log(`   [${idx}] imageId=${m.imageId}, batchIndex=${m.batchIndex}`);
      });
    }
  }
}

/**
 * Poll for Hunyuan task completion as a fallback when webhooks don't arrive
 * This runs server-side and ensures images are processed even if Novita doesn't send webhooks
 * @param {string} taskId - Primary task ID
 * @param {string[]} allTaskIds - All task IDs to poll (for models requiring sequential generation)
 * @param {Object} fastify - Fastify instance
 * @param {Object} options - Additional options
 */
async function pollSequentialTasksWithFallback(taskId, allTaskIds, fastify, options = {}) {
  const { chatCreation, translations, userId, chatId, placeholderId } = options;
  const db = fastify.mongo.db;
  const tasksCollection = db.collection('tasks');
  
  const maxAttempts = 60; // 5 minutes max (60 * 5 seconds)
  const pollInterval = 5000; // 5 seconds
  const taskIds = allTaskIds && allTaskIds.length > 0 ? allTaskIds : [taskId];
  
  console.log(`[pollSequentialTasks] Starting fallback polling for ${taskIds.length} tasks`);
  
  let attempts = 0;
  const completedTasks = new Map(); // Track completed tasks and their images
  
  const pollOnce = async () => {
    attempts++;
    console.log(`[pollSequentialTasks] Poll attempt ${attempts}/${maxAttempts} for ${taskIds.length} tasks`);
    
    let allComplete = true;
    
    for (const tid of taskIds) {
      // Skip if already completed
      if (completedTasks.has(tid)) {
        continue;
      }

      // Check if webhook already processed this task OR is currently processing
      const taskDoc = await tasksCollection.findOne({ taskId: tid });
      if (taskDoc && (taskDoc.status === 'completed' || taskDoc.webhookProcessed || taskDoc.completionNotificationSent)) {
        console.log(`[pollSequentialTasks] Task ${tid} already processed (webhook arrived or completed)`);
        completedTasks.set(tid, taskDoc.result?.images || []);
        continue;
      }

      // ===== CRITICAL FIX: Skip if webhook is currently processing this task =====
      if (taskDoc && taskDoc.webhookProcessing) {
        console.log(`[pollSequentialTasks] Task ${tid} is being processed by webhook, skipping`);
        allComplete = false;  // Don't mark as complete yet, wait for webhook to finish
        continue;
      }

      // Poll Novita for status
      try {
        const result = await fetchNovitaResult(tid);
        
        if (result && result.status === 'processing') {
          console.log(`[pollSequentialTasks] Task ${tid} still processing (${result.progress || 0}%)`);
          allComplete = false;
          continue;
        }
        
        if (result && result.error) {
          console.error(`[pollSequentialTasks] Task ${tid} failed: ${result.error}`);
          await tasksCollection.updateOne(
            { taskId: tid },
            { $set: { status: 'failed', result: { error: result.error }, updatedAt: new Date() } }
          );
          completedTasks.set(tid, []);
          continue;
        }
        
        // Task completed - process it
        if (result) {
          console.log(`[pollSequentialTasks] Task ${tid} completed, processing images`);
          
          // Convert result to array format
          const images = Array.isArray(result) ? result : [result];
          
          // Update task as webhook processed (so checkTaskStatus uses these images)
          await tasksCollection.updateOne(
            { taskId: tid },
            { 
              $set: { 
                'result.images': images.map(img => ({
                  imageUrl: img.imageUrl,
                  seed: img.seed || 0,
                  imageId: img.imageId
                })),
                'webhookProcessed': true,
                updatedAt: new Date() 
              } 
            }
          );
          
          // Process using checkTaskStatus (handles merge face, saving, etc.)
          const taskStatus = await checkTaskStatus(tid, fastify);
          
          if (taskStatus && taskStatus.status === 'completed' && taskStatus.images && taskStatus.images.length > 0) {
            completedTasks.set(tid, taskStatus.images);

            // IMPORTANT: Skip handleTaskCompletion if fromCache is true
            // Another worker is processing this task and will send the notifications
            // Sending from cached result would cause duplicate notifications
            if (taskStatus.fromCache) {
              console.log(`[pollSequentialTasks] Task ${tid} returned cached result, skipping handleTaskCompletion`);
            } else {
              // Get the task document for options
              const taskDocAfter = await tasksCollection.findOne({ taskId: tid });

              // Call handleTaskCompletion to send notifications
              if (taskDocAfter) {
                // Build sequentialBatchInfo for proper batch grouping in carousel
                // Models without batch support generate each image as a separate task
                // We need to tell the frontend the correct batch size and index
                let sequentialBatchInfo = null;
                let effectivePlaceholderId = taskDocAfter.placeholderId;

                if (taskIds.length > 1) {
                  // This is part of a sequential multi-image batch
                  const taskIndex = taskIds.indexOf(tid);
                  sequentialBatchInfo = {
                    batchIndex: taskIndex >= 0 ? taskIndex : 0,
                    batchSize: taskIds.length
                  };

                  // For child tasks (not the first task), use the parent's placeholderId
                  if (taskIndex > 0 && taskDocAfter.sequentialParentTaskId) {
                    const parentTask = await tasksCollection.findOne({ taskId: taskDocAfter.sequentialParentTaskId });
                    if (parentTask) {
                      effectivePlaceholderId = parentTask.placeholderId || taskDocAfter.sequentialParentTaskId;
                    }
                  }

                  console.log(`[pollSequentialTasks] Sequential batch info for task ${tid}: index=${sequentialBatchInfo.batchIndex}, size=${sequentialBatchInfo.batchSize}, placeholderId=${effectivePlaceholderId}`);
                }

                await handleTaskCompletion(taskStatus, fastify, {
                  chatCreation: taskDocAfter.chatCreation || false,
                  translations: taskDocAfter.translations || translations,
                  userId: taskStatus.userId?.toString() || taskDocAfter.userId?.toString(),
                  chatId: taskDocAfter.chatId?.toString(),
                  placeholderId: effectivePlaceholderId,
                  sequentialBatchInfo
                });
              }
            }
          } else {
            completedTasks.set(tid, []);
          }
        }
      } catch (error) {
        console.error(`[pollSequentialTasks] Error polling task ${tid}:`, error.message);
        allComplete = false;
      }
    }
    
    // Check if all tasks are complete
    if (completedTasks.size === taskIds.length) {
      console.log(`[pollSequentialTasks] All ${taskIds.length} tasks completed`);
      return true;
    }
    
    // Continue polling if not all complete and not at max attempts
    if (attempts < maxAttempts && !allComplete) {
      return new Promise(resolve => {
        setTimeout(async () => {
          resolve(await pollOnce());
        }, pollInterval);
      });
    }
    
    // Timeout - some tasks didn't complete
    if (attempts >= maxAttempts) {
      console.warn(`[pollSequentialTasks] Timeout: ${completedTasks.size}/${taskIds.length} tasks completed after ${maxAttempts} attempts`);
      
      // Send notification about timeout if this is character creation
      if (chatCreation && typeof fastify.sendNotificationToUser === 'function') {
        fastify.sendNotificationToUser(userId, 'showNotification', {
          message: translations?.newCharacter?.image_generation_timeout || 'Image generation timed out. Please try again.',
          icon: 'error'
        });
      }
    }
    
    return completedTasks.size > 0;
  };
  
  // Start polling after a short delay to give webhooks a chance
  console.log(`[pollSequentialTasks] Waiting 10 seconds before starting fallback polling...`);
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Check if webhook already completed all tasks
  let allAlreadyComplete = true;
  for (const tid of taskIds) {
    const taskDoc = await tasksCollection.findOne({ taskId: tid });
    if (!taskDoc || (taskDoc.status !== 'completed' && !taskDoc.webhookProcessed)) {
      allAlreadyComplete = false;
      break;
    }
  }
  
  if (allAlreadyComplete) {
    console.log(`[pollSequentialTasks] All tasks already completed via webhook, skipping fallback polling`);
    return true;
  }
  
  return await pollOnce();
}

module.exports = {
  generateImg,
  getPromptById,
  getImageSeed,
  checkImageDescription,
  characterDescriptionToString,
  getTasks,
  deleteOldTasks,
  deleteAllTasks,
  handleTaskCompletion,
  checkTaskStatus,
  performAutoMergeFace,
  performAutoMergeFaceWithBase64,
  centerCropImage,
  saveImageToDB,
  updateSlug,
  updateTitle,
  fetchNovitaMagic,
  fetchNovitaResult,
  fetchOriginalTaskData,
  getTitleString,
  pollSequentialTasksWithFallback
};