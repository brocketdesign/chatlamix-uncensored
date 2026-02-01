const { ObjectId } = require('mongodb');
const axios = require('axios');
const fs = require('fs');
const { processPromptToTags, saveChatImageToDB } = require('../models/tool')
const { generateImg, getPromptById, getImageSeed, checkImageDescription, getTasks } = require('../models/imagen');
const { createPrompt, createGiftPrompt, moderateText } = require('../models/openai');
const { upscaleImg } = require('../models/upscale-utils');
const { removeUserPoints } = require('../models/user-points-utils');
const { getUserMinImages } = require('../models/chat-tool-settings-utils');
const { getImageGenerationCost, getImageUpscaleCost, getCustomPromptCost, getGiftCost } = require('../config/pricing');
const { MODEL_CONFIGS: IMAGE_MODEL_CONFIGS } = require('../models/admin-image-test-utils');

async function routes(fastify, options) {

  // Endpoint to initiate generate-img for selected image type
  fastify.post('/novita/generate-img', {
    // Increase body limit to 10MB to handle base64 image uploads
    bodyLimit: 10 * 1024 * 1024
  }, async (request, reply) => {
    const { title, prompt, aspectRatio, userId, chatId, userChatId, placeholderId, promptId, giftId, customPrompt, image_base64, chatCreation, modelId, regenerate, enableMergeFace, description, editStrength } = request.body;
    let imageType = request.body.imageType
    const db = fastify.mongo.db;
    const translations = request.translations
    const userPointsTranslations = request.userPointsTranslations

    try {
      // Get fresh user data from database to check subscription
      const freshUserData = await db.collection('users').findOne(
        { _id: new fastify.mongo.ObjectId(userId) },
        { projection: { subscriptionStatus: 1 } }
      );
      
      const subscriptionStatus = freshUserData?.subscriptionStatus;

      const pending_taks =  await getTasks(db, 'pending', userId)
      if(pending_taks.length > 10){
        fastify.sendNotificationToUser(userId, 'showNotification', { message:request.translations.too_many_pending_images , icon:'warning' })
        return reply.status(500).send({ error: 'You have too many pending images, please wait for them to finish' });
      }
    
      // Add number of images to request
      let image_num = chatCreation ? 4 : 1;
      const userMinImage = await getUserMinImages(db, userId, chatId);
      image_num = Math.max(image_num || 1, userMinImage || 1); // Ensure at least 1 image is requested and respect user setting


      let newPrompt = prompt
      if(customPrompt && promptId){
        const promptData = await getPromptById(db,promptId);

        // Remove prompt cost from user points
        const promptCost = getCustomPromptCost(promptData);
        try {
          await removeUserPoints(db, userId, promptCost, translations.points?.deduction_reasons?.custom_prompt || 'Prompt', 'prompt', fastify);
        } catch (error) {
          return reply.status(500).send({ error: `${userPointsTranslations?.need_coins?.replace('{coins}', promptCost) || `Need: ${promptCost}`}` });
        }

        savePromptIdtoChat(db, chatId, userChatId, promptId)
        .then((response) => {
          if(subscriptionStatus !== 'active'){
            // [DEPRECIATED] All prompt are available with points now
            //fastify.sendNotificationToUser(userId, 'updateCustomPrompt', { promptId: promptId })
          }
        })
        const customPromptText = promptData.prompt
        // Check for NSFW: handle 'on' (checkbox), boolean true, and string 'true'
        const nsfw = promptData.nsfw === 'on' || promptData.nsfw === true || promptData.nsfw === 'true';
        imageType = nsfw ? 'nsfw' : 'sfw';
        processPromptToTags(db, customPromptText);
        
        const imageDescription = await checkImageDescription(db, chatId);
        newPrompt = await createPrompt(customPromptText, description,  imageDescription, nsfw);
      } else if( giftId ) {
        // New gift handling logic
        const giftData = await getGiftById(db, giftId);
        if (!giftData) {
          return reply.status(404).send({ error: 'Gift not found' });
        }
        // Remove gift cost from user points
        const giftCost = getGiftCost(giftData);
        console.log(`[generate-img] Cost for gift: ${giftCost} points`);
        try {
          await removeUserPoints(db, userId, giftCost, translations.points?.deduction_reasons?.gift || 'Gift', 'gift', fastify);
        } catch (error) {
          return reply.status(500).send({ error: `${userPointsTranslations?.need_coins?.replace('{coins}', giftCost) || `Need: ${giftCost}`}` });
        }
        saveGiftIdToChat(db, chatId, userChatId, giftId)
        .then((response) => {
          if(subscriptionStatus !== 'active'){
            fastify.sendNotificationToUser(userId, 'updateCustomGift', { giftId: giftId })
          }
        })
        const giftPrompt = giftData.prompt || giftData.description || '';
        const giftNsfw = (giftData.category && typeof giftData.category === 'string') ? giftData.category.toUpperCase().includes('NSFW') : false;
        if (giftPrompt) {
          processPromptToTags(db, giftPrompt);
        }
        const imageDescription = await checkImageDescription(db, chatId);
        newPrompt = await createGiftPrompt( giftPrompt, null, imageDescription, giftNsfw);
        console.log('Generated prompt from gift:', newPrompt);
      } else {
        // Charge points for image generation
        const cost = getImageGenerationCost(image_num);
        console.log(`[generate-img] Cost for image generation: ${cost} points`);
        try {
          await removeUserPoints(db, userId, cost, translations.points?.deduction_reasons?.image_generation || 'Image generation', 'image_generation', fastify);
        } catch (error) {
          return reply.status(500).send({ error: `${userPointsTranslations?.need_coins?.replace('{coins}', cost) || `Need: ${cost}`}`});
        }
      }
      let imageSeed = -1;
      if(regenerate){
        imageSeed = await getImageSeed(db, placeholderId);
      }

      const result = generateImg({
          title, 
          prompt: newPrompt, 
          aspectRatio, 
          imageSeed, 
          regenerate, 
          modelId,
          userId,
          chatId, 
          userChatId, 
          imageType, 
          image_num, 
          image_base64, 
          chatCreation, 
          placeholderId, 
          translations: request.translations, 
          fastify,
          customPromptId: promptId,
          enableMergeFace: enableMergeFace || false,
          editStrength: editStrength || 'medium'
      })      
      .then((response) => {
      })
      .catch((error) => {
        console.log('error:', error);
        return reply.status(500).send({ error: 'Error generating image.' });
      });
      reply.send(result);
    } catch (err) {
      console.error(err);
      reply.status(500).send({ error: 'Error initiating image generation.' });
    }
  });

    fastify.post('/novita/upscale-img', {
        // Increase body limit to 10MB to handle base64 image uploads
        bodyLimit: 10 * 1024 * 1024
    }, async (request, reply) => {
        try {
            const { userId, chatId, userChatId, originalImageId, image_base64, originalImageUrl, placeholderId, scale_factor, model_name } = request.body;
            
            const db = fastify.mongo.db;
            const cost = getImageUpscaleCost();
            console.log(`[upscale-img] Cost for upscale image: ${cost} points`);
            try {
              await removeUserPoints(db, userId, cost, request.translations?.points?.deduction_reasons?.upscale_image || 'Upscale image', 'upscale_image', fastify);
            } catch (error) {
              console.error('Error deducting points:', error);
            }
            
            // console.log('Upscale request received on backend:', request.body);
            const data = await upscaleImg({
                userId,
                chatId,
                userChatId,
                originalImageId,
                image_base64,
                originalImageUrl,
                placeholderId,
                scale_factor,
                model_name,
                fastify
            });
            reply.send(data);
        } catch (error) {
            console.error('Error in /novita/upscale-img:', error);
            reply.status(500).send({ message: error.message || 'Internal Server Error' });
        }
    });
  fastify.get('/image/:imageId', async (request, reply) => {
    try {
      const { imageId } = request.params;
      const db = fastify.mongo.db;
      const galleryCollection = db.collection('gallery');
      const chatsCollection = db.collection('chats');

      let imageDocument = null;
      
      // First, try to find by image ID
      try {
        const objectId = new fastify.mongo.ObjectId(imageId);
        imageDocument = await galleryCollection.findOne(
          { "images._id": objectId },
          { projection: { "images.$": 1, chatId: 1 } }
        );
      } catch (err) {
        // Invalid ObjectId format, continue to mergeId search
      }

      // If not found by imageId, try to find by mergeId
      if (!imageDocument) {
        imageDocument = await galleryCollection.findOne(
          { "images.mergeId": imageId },
          { projection: { "images.$": 1, chatId: 1 } }
        );
      }

      if (!imageDocument || !imageDocument.images?.length) {
        return reply.status(404).send({ error: 'Image not found' });
      }

      const image = imageDocument.images[0];
      const { imageUrl, originalImageUrl, prompt: imagePrompt, isUpscaled, title, nsfw, likedBy = [], actions, isMerged, mergeId } = image;
      const { chatId } = imageDocument;
      // Include gallery image _id for thumbnail deduplication (prevents duplicates when using mergeId vs _id)
      const galleryImageId = image._id ? image._id.toString() : null;

      let chatData = {};
      if (chatId) {
        chatData = await chatsCollection.findOne(
          { _id: chatId },
          { projection: { imageModel: 1, imageStyle: 1, imageVersion: 1 } }
        ) || {};
      }

      return reply.status(200).send({ imageUrl, originalImageUrl, imagePrompt, isUpscaled, title, likedBy, nsfw, actions, isMerged, mergeId, galleryImageId, ...chatData });
    } catch (error) {
      console.error('Error fetching image details:', error);
      return reply.status(500).send({ error: 'An error occurred while fetching the image details' });
    }
  });

  fastify.post('/novita/save-image-model', async (request, reply) => {
    const { chatId, modelId, imageModel, imageStyle, imageVersion } = request.body;

    if (!chatId || !modelId || !imageModel || !imageStyle || !imageVersion) {
      return reply.status(400).send({ error: 'chatId, imageModel, imageStyle, and imageVersion are required' });
    }

    try {
      const db = fastify.mongo.db
      await saveImageModel(db, chatId, { modelId, imageModel, imageStyle, imageVersion });
      return reply.status(200).send({ message: 'Image model saved successfully' });
    } catch (error) {
      console.error('Error saving image model:', error);
      return reply.status(500).send({ error: 'Failed to save image model to database' });
    }
  });

  // API endpoint to fetch available text-to-image models
  fastify.get('/api/txt2img-models', async (request, reply) => {
    try {
      const db = fastify.mongo.db;

      // Load active SD models from database
      const activeSDModels = await db.collection('myModels').find({}).toArray();
      const sdModelsForSelection = activeSDModels.map(model => ({
        id: `sd-txt2img-${model.modelId}`,
        modelId: model.modelId,
        name: model.name || model.model,
        sdName: model.model,
        description: `Stable Diffusion ${model.style || ''} model`,
        category: 'txt2img',
        isSDModel: true,
        modelName: model.model,
        style: model.style,
        baseModel: model.base_model || 'SD 1.5'
      }));

      // Get built-in txt2img models (non-SD models that don't require a model)
      const builtInModels = Object.entries(IMAGE_MODEL_CONFIGS)
        .filter(([id, config]) => !config.requiresModel && config.category === 'txt2img')
        .map(([id, config]) => ({
          id,
          name: config.name,
          description: config.description || '',
          category: 'txt2img',
          isSDModel: false
        }));

      // Combine all txt2img models
      const allModels = [...builtInModels, ...sdModelsForSelection];

      return reply.send({
        success: true,
        models: allModels
      });
    } catch (error) {
      console.error('Error fetching txt2img models:', error);
      return reply.status(500).send({ error: 'Failed to fetch models' });
    }
  });

  fastify.post('/novita/save-image', async (request, reply) => {
    const { imageUrl, chatId } = request.body;

    if (!imageUrl || !chatId) {
      return reply.status(400).send({ error: 'imageId, imageUrl, and chatId are required' });
    }

    try {
      const db = fastify.mongo.db
      await saveChatImageToDB(db, chatId, imageUrl);
      return reply.status(200).send({ message: 'Image saved successfully' });
    } catch (error) {
      console.error('Error saving image:', error);
      return reply.status(500).send({ error: 'Failed to save image to database' });
    }
  });

  fastify.post('/novita/moderate', async (request, reply) => {
    try {
    const { chatId, content } = request.body;

    if (!content) {
        return reply.status(400).send({ error: 'Text is required' });
    }

    const moderationResult = await moderateText(content);

    const db = fastify.mongo.db
    await saveModerationToDB(db, chatId, moderationResult, content);

    reply.send(moderationResult);
    } catch (error) {
    console.error("Error moderating text:", error);
    reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

// Add helper functions
async function getGiftById(db, id) {
  try {
    if (!fastify.mongo.ObjectId.isValid(id)) {
      throw new Error('Invalid ID format');
    }

    const gift = await db.collection('gifts').findOne({ _id: new fastify.mongo.ObjectId(id) });

    if (!gift) {
      return { success: false, message: 'Gift not found', data: null };
    }

    return gift;
  } catch (error) {
    console.error('Error fetching gift:', error);
    throw new Error('Error fetching gift');
  }
}

async function saveGiftIdToChat(db, chatId, userChatId, giftId) {
  const collectionUserChats = db.collection('userChat');

  let userChatObjectId;
  try {
      userChatObjectId = new ObjectId(userChatId);
  } catch (error) {
      console.error('[saveGiftIdToChat] Invalid userChatId:', userChatId, error);
      throw new Error(`Invalid ID format (userChatId: ${userChatId})`);
  }

  try {
    const userChatUpdateResult = await collectionUserChats.updateOne(
        { _id: userChatObjectId },
        { $addToSet: { giftId } }
    );

    if (userChatUpdateResult.matchedCount === 0) {
        const errorMessage = `User chat not found (userChatId: ${userChatId})`;
        console.error(`[saveGiftIdToChat] ${errorMessage}`);
        throw new Error(errorMessage);
    }
    
    return { userChatUpdateResult };

  } catch (err) {
    console.error('[saveGiftIdToChat] Error during database update:', err.message);
    throw err; 
  }
}
  async function savePromptIdtoChat(db, chatId, userChatId, promptId) {
    const collectionUserChats = db.collection('userChat');

    let userChatObjectId;
    try {
        userChatObjectId = new ObjectId(userChatId);
    } catch (error) {
        console.error('[savePromptIdtoChat] Invalid userChatId:', userChatId, error);
        throw new Error(`無効なID形式です (userChatId: ${userChatId})`);
    }

    try {
      const userChatUpdateResult = await collectionUserChats.updateOne(
          { _id: userChatObjectId },
          { $addToSet: { customPromptIds: promptId } }
      );

      if (userChatUpdateResult.matchedCount === 0) {
          const errorMessage = `指定されたユーザーチャットが見つかりませんでした (userChatId: ${userChatId})`;
          console.error(`[savePromptIdtoChat] ${errorMessage}`);
          throw new Error(errorMessage);
      }
      
      return { userChatUpdateResult };

    } catch (err) {
      console.error('[savePromptIdtoChat] Error during database update:', err.message);
      throw err; 
    }
  }

    async function saveModerationToDB(db, chatId, moderation, characterPrompt){
      const collectionChats = db.collection('chats'); // Replace 'chats' with your actual collection name

      // Convert chatId string to ObjectId
      let chatObjectId;
      try {
          chatObjectId = new ObjectId(chatId);
      } catch (error) {
          throw new Error('無効なchatIdです。');
      }

      // Update the 'chats' collection with chatImageUrl and thumbnail
      const updateResult = await collectionChats.updateOne(
          { _id: chatObjectId },
          { 
              $set: { moderation, characterPrompt } 
          }
      );

      if (updateResult.matchedCount === 0) {
          throw new Error('指定されたチャットが見つかりませんでした。');
      }

      return updateResult;
    }

    async function saveImageModel(db, chatId, option) {
      const collectionChats = db.collection('chats');
      const { modelId, imageModel, imageStyle, imageVersion } = option;
      // Convert chatId string to ObjectId
      let chatObjectId;
      try {
          chatObjectId = new ObjectId(chatId);
      } catch (error) {
          throw new Error('無効なchatIdです。');
      }
      const updateResult = await collectionChats.updateOne(
          { _id: chatObjectId },
          { 
              $set: { modelId, imageModel, imageStyle, imageVersion } 
          }
      );

      if (updateResult.matchedCount === 0) {
          throw new Error('指定されたチャットが見つかりませんでした。');
      }

      return updateResult;
    }

  fastify.get('/api/background-tasks/:userChatId', async (request, reply) => {
      try {
          const { userChatId } = request.params;
          const db = fastify.mongo.db;
          
          if (!userChatId || !ObjectId.isValid(userChatId)) {
              return reply.status(400).send({ error: 'Invalid userChatId' });
          }
          
          // Find completed tasks for this user chat
          const tasks = await db.collection('tasks').find({
              userChatId: new fastify.mongo.ObjectId(userChatId),
              status: 'completed',
              createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }
          }).sort({ createdAt: -1 }).limit(50).toArray();
          
          // Just return the tasks with their existing customPromptId
          const tasksWithPrompts = tasks.map(task => {
              return {
                  ...task,
                  customPromptId: task.customPromptId || null
              };
          });
            
          reply.send({ tasks: tasksWithPrompts });
      } catch (error) {
          console.error('Error fetching background tasks:', error);
          reply.status(500).send({ error: 'Internal Server Error' });
      }
  });

  fastify.get('/api/task-status/:taskId', async (request, reply) => {
      try {
          const { taskId } = request.params;
          const db = fastify.mongo.db;
          
          
          const task = await db.collection('tasks').findOne({ taskId });
          
          if (!task) {
              return reply.status(404).send({ error: 'Task not found' });
          }
          
          
          if (task.status === 'completed' && task.result && task.result.images) {

              return reply.send({
                  status: 'completed',
                  userChatId: task.userChatId,
                  images: task.result.images
              });
          }
          
          reply.send({ 
              status: task.status,
              taskId: task.taskId,
              userChatId: task.userChatId
          });
      } catch (error) {
          console.error('Error fetching task status:', error);
          reply.status(500).send({ error: 'Internal Server Error' });
      }
  });
}

module.exports = routes;
