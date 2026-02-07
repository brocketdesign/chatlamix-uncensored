/**
 * Admin Image Model Test Routes
 * Dashboard for testing multiple Novita AI image generation models
 */

const { ObjectId } = require('mongodb');
const { checkUserAdmin } = require('../models/tool');
const {
  MODEL_CONFIGS,
  SIZE_OPTIONS,
  STYLE_PRESETS,
  initializeModelTest,
  checkTaskResult,
  saveTestResult,
  getModelStats,
  getRecentTests,
  getDefaultCharacterModels,
  setDefaultCharacterModel,
  uploadTestImageToS3,
  saveImageRating,
  getImageRating
} = require('../models/admin-image-test-utils');
const { removeUserPoints, getUserPoints } = require('../models/user-points-utils');
const { PRICING_CONFIG, getImageGenerationCost, getFaceMergeCost } = require('../config/pricing');
const { moderateImage } = require('../models/openai');
const { createPostFromImage, POST_STATUSES, POST_VISIBILITY } = require('../models/unified-post-utils');

/**
 * Check if an image is NSFW using OpenAI Content Moderation API
 * @param {string} imageUrl - URL of the image to check
 * @returns {Promise<boolean>} - true if NSFW, false otherwise
 */
async function checkImageNSFW(imageUrl) {
  try {
    const moderation = await moderateImage(imageUrl);
    if (moderation.results && moderation.results.length > 0) {
      const result = moderation.results[0];
      // Check if flagged or if sexual content score is high
      if (result.flagged) {
        console.log('[NSFW Check] Image flagged as NSFW');
        return true;
      }
      // Also check specific categories
      if (result.categories?.sexual || result.categories?.['sexual/minors']) {
        console.log('[NSFW Check] Image has sexual content');
        return true;
      }
      // Check scores with threshold
      if (result.category_scores?.sexual > 0.5) {
        console.log('[NSFW Check] Image sexual score above threshold:', result.category_scores.sexual);
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('[NSFW Check] Error checking image:', error);
    return false; // Default to safe on error
  }
}

async function routes(fastify, options) {
  
  /**
   * GET /dashboard/image
   * Render the image model test dashboard (accessible to all authenticated users)
   */
  fastify.get('/dashboard/image', async (request, reply) => {
    try {
      const user = request.user;
      
      if (!user) {
        return reply.redirect('/login');
      }

      const db = fastify.mongo.db;
      const translations = request.translations;
      
      // Check if user is admin
      const isAdmin = await checkUserAdmin(fastify, user._id);

      // Get model statistics (only for admins)
      const modelStats = isAdmin ? await getModelStats(db) : [];
      
      // Get recent tests - filter by user if not admin
      const userId = isAdmin ? null : user._id.toString();
      const recentTests = await getRecentTests(db, 20, null, userId);
      
      // Get default character creation models (only for admins)
      const defaultModels = isAdmin ? await getDefaultCharacterModels(db) : {};
      
      // Get active SD models from database
      const activeSDModels = await db.collection('myModels').find({}).toArray();

      // Group SD models by style
      const sdModelsByStyle = {
        anime: [],
        photorealistic: [],
        other: []
      };

      activeSDModels.forEach(model => {
        const style = model.style || '';
        if (style === 'anime') {
          sdModelsByStyle.anime.push(model);
        } else if (style === 'photorealistic') {
          sdModelsByStyle.photorealistic.push(model);
        } else {
          sdModelsByStyle.other.push(model);
        }
      });

      // Prepare model list for view
      const models = Object.entries(MODEL_CONFIGS).map(([id, config]) => {
        const stats = modelStats.find(s => s.modelId === id) || {};
        return {
          id,
          name: config.name,
          description: config.description,
          async: config.async,
          requiresModel: config.requiresModel || false,
          category: config.category || 'txt2img',
          supportsImg2Img: config.supportsImg2Img || false,
          requiresImage: config.requiresImage || false,
          requiresTwoImages: config.requiresTwoImages || false,
          totalTests: stats.totalTests || 0,
          averageTime: stats.averageTime || 0,
          recentAverageTime: stats.recentAverageTime || 0,
          lastTested: stats.lastTested,
          minTime: stats.minTime || 0,
          maxTime: stats.maxTime || 0,
          averageRating: stats.averageRating || null,
          totalRatings: stats.totalRatings || 0
        };
      });

      // Get user's current points
      const userPoints = await getUserPoints(db, user._id);

      // Get subscription status for NSFW blur handling
      const subscriptionStatus = user.subscriptionStatus === 'active';
      const isTemporary = !!user.isTemporary;

      return reply.view('/admin/image-test', {
        title: 'Image Dashboard',
        user,
        translations,
        models,
        activeSDModels,
        sdModelsByStyle,
        sizeOptions: SIZE_OPTIONS,
        stylePresets: STYLE_PRESETS,
        recentTests,
        defaultModels,
        modelConfigs: MODEL_CONFIGS,
        userPoints,
        imageCostPerUnit: PRICING_CONFIG.IMAGE_GENERATION.BASE_COST_PER_IMAGE,
        faceMergeCost: PRICING_CONFIG.FACE_MERGE.COST,
        isAdmin,
        subscriptionStatus,
        isTemporary
      });
    } catch (error) {
      console.error('[AdminImageTest] Error loading dashboard:', error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  /**
   * POST /dashboard/image/generate
   * Start image generation test for selected models
   */
  fastify.post('/dashboard/image/generate', {
    // Increase body limit to 10MB to handle base64 image uploads
    bodyLimit: 10 * 1024 * 1024
  }, async (request, reply) => {
    try {
      const user = request.user;
      
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const db = fastify.mongo.db;
      const { 
        models, selectedSDModels, prompt, basePrompt, size, style, skipStyleApplication, 
        negativePrompt, steps, guidanceScale, samplerName, imagesPerModel,
        generationMode, editStrength, image_base64, face_image_file, image_file
      } = request.body;

      if ((!models || !Array.isArray(models) || models.length === 0) && 
          (!selectedSDModels || !Array.isArray(selectedSDModels) || selectedSDModels.length === 0)) {
        return reply.status(400).send({ error: 'No models selected' });
      }

      // For face tools like merge-face, prompt may not be required
      const requiresPrompt = generationMode !== 'face' || 
        (models && models.some(m => m !== 'merge-face' && m !== 'merge-face-segmind'));
      
      if (requiresPrompt && (!prompt || prompt.trim() === '')) {
        return reply.status(400).send({ error: 'Prompt is required' });
      }

      // Calculate total cost
      const numImages = Math.max(1, Math.min(4, parseInt(imagesPerModel) || 1));
      const standardModelCount = models?.length || 0;
      const sdModelCount = selectedSDModels?.length || 0;
      const totalModels = standardModelCount + sdModelCount;
      const totalImages = totalModels * numImages;
      const totalCost = getImageGenerationCost(totalImages);

      // Check user points
      const userPoints = await getUserPoints(db, user._id);
      if (userPoints < totalCost) {
        return reply.status(402).send({ 
          error: 'Insufficient points', 
          required: totalCost, 
          available: userPoints,
          message: `You need ${totalCost} points but only have ${userPoints} points.`
        });
      }

      // Deduct points before starting generation
      try {
        await removeUserPoints(
          db, 
          user._id, 
          totalCost, 
          request.translations?.points?.deduction_reasons?.image_generation || 'Image generation', 
          'image_generation', 
          fastify
        );
        console.log(`[AdminImageTest] Deducted ${totalCost} points from user ${user._id} for ${totalImages} images`);
      } catch (pointsError) {
        console.error('[AdminImageTest] Error deducting points:', pointsError);
        return reply.status(402).send({ error: 'Error deducting points for image generation.' });
      }

      console.log(`[AdminImageTest] Starting generation for ${models?.length || 0} standard models and ${selectedSDModels?.length || 0} SD models`);
      console.log(`[AdminImageTest] Mode: ${generationMode || 'txt2img'}`);
      console.log(`[AdminImageTest] Prompt: ${prompt}`);
      console.log(`[AdminImageTest] Base Prompt: ${basePrompt || 'N/A'}`);
      console.log(`[AdminImageTest] Size: ${size}`);
      console.log(`[AdminImageTest] Style: ${style}`);
      console.log(`[AdminImageTest] Edit Strength: ${editStrength || 'medium'}`);
      console.log(`[AdminImageTest] Has image_base64: ${!!image_base64}`);
      console.log(`[AdminImageTest] Has face_image_file: ${!!face_image_file}`);
      console.log(`[AdminImageTest] Has image_file: ${!!image_file}`);

      // Use prompt directly if style was already applied on frontend
      // Otherwise apply style preset if selected
      let finalPrompt = prompt || '';
      if (!skipStyleApplication && style && STYLE_PRESETS[style]) {
        const preset = STYLE_PRESETS[style];
        finalPrompt = preset.promptPrefix + prompt + preset.promptSuffix;
      }

      // Start generation for each selected model
      const tasks = [];
      
      // Process standard models
      if (models && Array.isArray(models)) {
        for (const modelId of models) {
          try {
            const numImages = Math.max(1, Math.min(4, parseInt(imagesPerModel) || 1));
            const config = MODEL_CONFIGS[modelId];
            
            // Build base params
            const baseParams = {
              prompt: finalPrompt,
              size: size || '1024*1024'
            };
            
            // Add img2img parameters
            if (generationMode === 'img2img' && image_base64) {
              baseParams.image = image_base64;
              baseParams.image_base64 = image_base64;
              baseParams.editStrength = editStrength || 'medium';
            }
            
            // Add face tool parameters
            if (generationMode === 'face') {
              if (modelId === 'merge-face-segmind' || modelId === 'merge-face') {
                // Normalize merge-face to merge-face-segmind
                baseParams.face_image_file = face_image_file;
                baseParams.image_file = image_file;
              } else {
                // Other face tools that need an image
                baseParams.image = face_image_file || image_file;
                baseParams.image_base64 = face_image_file || image_file;
              }
            }
            
            // For models that support multiple images natively, pass the parameter
            // Note: flux-2-flex does NOT support image_num - it only generates one image per request
            if (numImages > 1 && config) {
              // For all models that don't support native batch generation, create multiple tasks
              for (let i = 0; i < numImages; i++) {
                const params = { ...baseParams };

                const task = await initializeModelTest(modelId, params);
                task.originalPrompt = basePrompt || prompt;
                task.finalPrompt = finalPrompt;
                task.size = size;
                task.style = style;
                task.userId = user._id.toString();
                task.generationMode = generationMode || 'txt2img';
                // Add index suffix to model name for multiple generations
                if (numImages > 1) {
                  task.modelName = `${config?.name || modelId} (#${i + 1})`;
                  task.cardId = `${modelId}-${i}`;
                }
                tasks.push(task);
              }
            } else {
              // Single image generation
              const params = { ...baseParams };

              const task = await initializeModelTest(modelId, params);
              task.originalPrompt = basePrompt || prompt;
              task.finalPrompt = finalPrompt;
              task.size = size;
              task.style = style;
              task.userId = user._id.toString();
              task.generationMode = generationMode || 'txt2img';
              tasks.push(task);
            }
          } catch (error) {
            console.error(`[AdminImageTest] Error starting ${modelId}:`, error.message);
            tasks.push({
              modelId,
              modelName: MODEL_CONFIGS[modelId]?.name || modelId,
              status: 'failed',
              error: error.message,
              startTime: Date.now()
            });
          }
        }
      }
      
      // Process SD models
      if (selectedSDModels && Array.isArray(selectedSDModels)) {
        for (const sdModel of selectedSDModels) {
          try {
            const numImages = Math.max(1, Math.min(4, parseInt(imagesPerModel) || 1));
            
            // Determine if this is img2img or txt2img for SD models
            const isImg2Img = generationMode === 'img2img' && image_base64;
            const sdModelType = isImg2Img ? 'sd-img2img' : 'sd-txt2img';
            
            const params = {
              prompt: finalPrompt,
              model_name: sdModel.model || sdModel.model_name,
              size: size || '1024*1024',
              negative_prompt: negativePrompt || '',
              steps: steps ? parseInt(steps) : undefined,
              guidance_scale: guidanceScale ? parseFloat(guidanceScale) : undefined,
              sampler_name: samplerName || undefined,
              image_num: numImages // SD models support image_num parameter
            };
            
            // Add img2img parameters for SD models
            if (isImg2Img) {
              params.image_base64 = image_base64;
              params.editStrength = editStrength || 'medium';
            }

            const task = await initializeModelTest(sdModelType, params);
            task.originalPrompt = basePrompt || prompt;
            task.finalPrompt = finalPrompt;
            task.size = size;
            task.style = style;
            task.modelName = `${MODEL_CONFIGS[sdModelType].name} - ${sdModel.name || sdModel.model}`;
            task.sdModelName = sdModel.name || sdModel.model;
            task.userId = user._id.toString();
            task.generationMode = generationMode || 'txt2img';
            tasks.push(task);
          } catch (error) {
            console.error(`[AdminImageTest] Error starting SD model ${sdModel.model}:`, error.message);
            tasks.push({
              modelId: generationMode === 'img2img' ? 'sd-img2img' : 'sd-txt2img',
              modelName: `SD ${generationMode === 'img2img' ? 'Image to Image' : 'Text to Image'} - ${sdModel.name || sdModel.model}`,
              status: 'failed',
              error: error.message,
              startTime: Date.now()
            });
          }
        }
      }

      // Check if user is premium
      const isPremium = user.subscriptionStatus === 'active';

      // Log the response being sent to frontend and check NSFW for non-premium users
      console.log(`[AdminImageTest] 📤 Sending response with ${tasks.length} tasks:`);
      for (let idx = 0; idx < tasks.length; idx++) {
        const task = tasks[idx];
        console.log(`[AdminImageTest] 📤 Task ${idx + 1}: ${task.modelId}, status: ${task.status}, async: ${task.async}, images: ${task.images?.length || 0}`);

        if (task.images && task.images.length > 0) {
          for (let imgIdx = 0; imgIdx < task.images.length; imgIdx++) {
            const img = task.images[imgIdx];
            const url = img.imageUrl || img.url || img;
            console.log(`[AdminImageTest] 📤   Image ${imgIdx + 1}: ${typeof url === 'string' ? url.substring(0, 80) + '...' : 'N/A'}`);

            // For non-premium users with completed sync tasks, check NSFW
            if (!isPremium && task.status === 'completed' && typeof url === 'string' && url.startsWith('http')) {
              try {
                const isNSFW = await checkImageNSFW(url);
                task.images[imgIdx].nsfw = isNSFW;
                if (isNSFW) {
                  console.log(`[AdminImageTest] 🔞 Task ${idx + 1} Image ${imgIdx + 1} flagged as NSFW for non-premium user`);
                }
              } catch (nsfwError) {
                console.error(`[AdminImageTest] Error checking NSFW:`, nsfwError);
                task.images[imgIdx].nsfw = false;
              }
            } else {
              if (typeof img === 'object') {
                task.images[imgIdx].nsfw = false;
              }
            }
          }
        }
      }

      return reply.send({
        success: true,
        tasks
      });
    } catch (error) {
      console.error('[AdminImageTest] Error starting generation:', error);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /dashboard/image/status/:taskId
   * Check status of an async generation task
   */
  fastify.get('/dashboard/image/status/:taskId', async (request, reply) => {
    try {
      const user = request.user;
      
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { taskId } = request.params;

      if (!taskId || taskId.startsWith('sync-')) {
        return reply.send({ status: 'completed', sync: true });
      }

      const result = await checkTaskResult(taskId);

      // Log the status result being sent to frontend
      if (result.status === 'completed') {
        console.log(`[ImageDashboard] 📤 Sending completed result for task ${taskId}:`);
        console.log(`[ImageDashboard] 📤 Images count: ${result.images?.length || 0}`);

        // Check NSFW for non-premium users
        const isPremium = user.subscriptionStatus === 'active';

        if (result.images && result.images.length > 0) {
          for (let i = 0; i < result.images.length; i++) {
            const img = result.images[i];
            const imageUrl = img.imageUrl || img.url;
            console.log(`[ImageDashboard] 📤 Image ${i + 1} URL: ${imageUrl}`);

            // For non-premium users, check if image is NSFW
            if (!isPremium && imageUrl) {
              try {
                const isNSFW = await checkImageNSFW(imageUrl);
                result.images[i].nsfw = isNSFW;
                if (isNSFW) {
                  console.log(`[ImageDashboard] 🔞 Image ${i + 1} flagged as NSFW for non-premium user`);
                }
              } catch (nsfwError) {
                console.error(`[ImageDashboard] Error checking NSFW for image ${i + 1}:`, nsfwError);
                result.images[i].nsfw = false;
              }
            } else {
              result.images[i].nsfw = false;
            }
          }
        }
      }

      return reply.send(result);
    } catch (error) {
      console.error('[ImageDashboard] Error checking status:', error);
      return reply.status(500).send({ 
        status: 'error', 
        error: error.message 
      });
    }
  });

  /**
   * POST /dashboard/image/save-result
   * Save a completed test result
   */
  fastify.post('/dashboard/image/save-result', async (request, reply) => {
    try {
      const user = request.user;
      
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const db = fastify.mongo.db;
      const result = request.body;

      console.log(`[ImageDashboard] 📥 Save request for ${result.modelName}, images: ${result.images?.length || 0}`);
      if (result.images && result.images.length > 0) {
        console.log(`[ImageDashboard] 📥 First image keys: ${Object.keys(result.images[0]).join(', ')}`);
      }

      // Optionally upload images to S3
      if (result.images && Array.isArray(result.images)) {
        for (let i = 0; i < result.images.length; i++) {
          const img = result.images[i];
          // Only upload if imageUrl is a base64 data URL and no s3Url exists
          // Skip if imageUrl is already an S3 URL (https://)
          if (img.imageUrl && !img.s3Url && img.imageUrl.startsWith('data:')) {
            try {
              const s3Url = await uploadTestImageToS3(img.imageUrl, result.modelId);
              result.images[i].s3Url = s3Url;
            } catch (err) {
              console.error(`[ImageDashboard] Failed to upload to S3:`, err.message);
            }
          } else if (img.imageUrl && img.imageUrl.startsWith('https://')) {
            // imageUrl is already an S3 URL, use it as s3Url
            result.images[i].s3Url = img.imageUrl;
          }
        }
      }

      result.userId = user._id.toString();
      const testId = await saveTestResult(db, result);

      return reply.send({ success: true, testId });
    } catch (error) {
      console.error('[ImageDashboard] Error saving result:', error);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /dashboard/image/stats
   * Get model statistics
   */
  fastify.get('/dashboard/image/stats', async (request, reply) => {
    try {
      const user = request.user;
      
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const db = fastify.mongo.db;
      const stats = await getModelStats(db);

      return reply.send({ stats });
    } catch (error) {
      console.error('[ImageDashboard] Error getting stats:', error);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /dashboard/image/history
   * Get recent test history
   */
  fastify.get('/dashboard/image/history', async (request, reply) => {
    try {
      const user = request.user;
      
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const db = fastify.mongo.db;
      const limit = parseInt(request.query.limit) || 50;
      const modelId = request.query.modelId || null;
      
      // Check if user is admin - non-admins can only see their own history
      const isAdmin = await checkUserAdmin(fastify, user._id);
      const userId = isAdmin ? null : user._id.toString();
      
      const history = await getRecentTests(db, limit, modelId, userId);

      return reply.send({ history });
    } catch (error) {
      console.error('[ImageDashboard] Error getting history:', error);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /dashboard/image/default-model
   * Set the default character creation model for a style
   */
  fastify.put('/dashboard/image/default-model', async (request, reply) => {
    try {
      const user = request.user;
      const isAdmin = await checkUserAdmin(fastify, user._id);
      
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied. Admin only.' });
      }

      const { style, modelId } = request.body;

      if (!style || !['anime', 'photorealistic'].includes(style)) {
        return reply.status(400).send({ error: 'Invalid style' });
      }

      if (!modelId || !MODEL_CONFIGS[modelId]) {
        return reply.status(400).send({ error: 'Invalid model' });
      }

      const db = fastify.mongo.db;
      await setDefaultCharacterModel(db, style, modelId);

      return reply.send({ 
        success: true, 
        message: `Default ${style} model set to ${MODEL_CONFIGS[modelId].name}` 
      });
    } catch (error) {
      console.error('[ImageDashboard] Error setting default model:', error);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /dashboard/image/default-models
   * Get default character creation models
   */
  fastify.get('/dashboard/image/default-models', async (request, reply) => {
    try {
      const user = request.user;
      
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const db = fastify.mongo.db;
      const defaultModels = await getDefaultCharacterModels(db);

      return reply.send({ defaultModels });
    } catch (error) {
      console.error('[ImageDashboard] Error getting default models:', error);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /dashboard/image/stats/reset
   * Reset model statistics (admin only)
   */
  fastify.delete('/dashboard/image/stats/reset', async (request, reply) => {
    try {
      const user = request.user;
      const isAdmin = await checkUserAdmin(fastify, user._id);
      
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied. Admin only.' });
      }

      const db = fastify.mongo.db;
      const { modelId } = request.query;

      if (modelId) {
        await db.collection('imageModelStats').deleteOne({ modelId });
        await db.collection('imageModelTests').deleteMany({ modelId });
      } else {
        await db.collection('imageModelStats').deleteMany({});
        await db.collection('imageModelTests').deleteMany({});
      }

      return reply.send({ 
        success: true, 
        message: modelId ? `Stats reset for ${modelId}` : 'All stats reset' 
      });
    } catch (error) {
      console.error('[ImageDashboard] Error resetting stats:', error);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /dashboard/image/rate-image
   * Save an image rating
   */
  fastify.post('/dashboard/image/rate-image', async (request, reply) => {
    try {
      const user = request.user;
      
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const db = fastify.mongo.db;
      const { modelId, modelName, imageUrl, rating, testId } = request.body;

      if (!modelId || !imageUrl || !rating) {
        return reply.status(400).send({ error: 'Missing required fields' });
      }

      if (rating < 1 || rating > 5) {
        return reply.status(400).send({ error: 'Rating must be between 1 and 5' });
      }

      await saveImageRating(db, modelId, imageUrl, rating, testId, user._id.toString());

      return reply.send({ success: true });
    } catch (error) {
      console.error('[ImageDashboard] Error saving rating:', error);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /dashboard/image/rating/:testId
   * Get rating for a test
   */
  fastify.get('/dashboard/image/rating/:testId', async (request, reply) => {
    try {
      const user = request.user;
      
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const db = fastify.mongo.db;
      const { testId } = request.params;

      const rating = await getImageRating(db, testId);

      if (rating) {
        return reply.send({ success: true, rating: rating.rating });
      } else {
        return reply.send({ success: false, rating: null });
      }
    } catch (error) {
      console.error('[ImageDashboard] Error getting rating:', error);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /dashboard/image/save-as-post
   * Save a generated image as a pending post for a character
   */
  fastify.post('/dashboard/image/save-as-post', async (request, reply) => {
    try {
      const user = request.user;
      
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const db = fastify.mongo.db;
      const { 
        characterId, 
        imageUrl, 
        prompt, 
        negativePrompt,
        model,
        parameters,
        nsfw = false,
        caption = ''
      } = request.body;

      if (!characterId || !imageUrl) {
        return reply.status(400).send({ error: 'Character ID and image URL are required' });
      }

      // Verify user owns this character
      const character = await db.collection('chats').findOne({
        _id: new ObjectId(characterId),
        userId: new ObjectId(user._id)
      });

      if (!character) {
        return reply.status(403).send({ error: 'Character not found or you do not have permission' });
      }

      // Create the post as draft (pending)
      const postData = {
        userId: user._id.toString(),
        characterId: characterId,
        imageUrl: imageUrl,
        prompt: prompt || '',
        negativePrompt: negativePrompt || '',
        model: model || 'unknown',
        parameters: parameters || {},
        nsfw: nsfw,
        caption: caption,
        visibility: POST_VISIBILITY.PRIVATE // Start as private/draft
      };

      const post = await createPostFromImage(postData, db);

      console.log(`[ImageDashboard] Created pending post ${post._id} for character ${characterId}`);

      return reply.send({ 
        success: true, 
        postId: post._id,
        message: 'Image saved as pending post'
      });
    } catch (error) {
      console.error('[ImageDashboard] Error saving as post:', error);
      return reply.status(500).send({ error: error.message });
    }
  });
}

module.exports = routes;
