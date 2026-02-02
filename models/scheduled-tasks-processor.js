/**
 * Scheduled Tasks Processor
 * Executes scheduled single tasks and recurring cron jobs
 */

const { ObjectId } = require('mongodb');

const {
  getPendingSingleSchedules,
  getActiveRecurringSchedules,
  markSingleScheduleExecuted,
  markRecurringScheduleExecuted,
  ACTION_TYPES
} = require('./scheduling-utils');

const {
  createPostFromImage,
  createPostFromVideo,
  updatePostStatus,
  POST_STATUSES
} = require('./unified-post-utils');

const {
  mutatePrompt,
  applyTemplate
} = require('./prompt-mutation-utils');

/**
 * Wait for a task to complete by polling the database
 * @param {string} taskId - Task ID to wait for
 * @param {Object} db - Database instance
 * @param {number} maxWaitMs - Maximum wait time in milliseconds (default: 5 minutes)
 * @param {number} pollIntervalMs - Poll interval in milliseconds (default: 3 seconds)
 * @returns {Object|null} Completed task data with images or null if timeout/failed
 */
async function waitForTaskCompletion(taskId, db, maxWaitMs = 300000, pollIntervalMs = 3000) {
  const tasksCollection = db.collection('tasks');
  const startTime = Date.now();

  console.log(`[waitForTaskCompletion] Waiting for task ${taskId} to complete (max ${maxWaitMs / 1000}s)`);

  while (Date.now() - startTime < maxWaitMs) {
    const task = await tasksCollection.findOne({ taskId });

    if (!task) {
      console.log(`[waitForTaskCompletion] Task ${taskId} not found in database`);
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      continue;
    }

    // Check if task completed successfully
    if (task.status === 'completed' && task.result?.images?.length > 0) {
      console.log(`[waitForTaskCompletion] Task ${taskId} completed with ${task.result.images.length} image(s)`);
      return task;
    }

    // Check if task failed
    if (task.status === 'failed') {
      console.log(`[waitForTaskCompletion] Task ${taskId} failed: ${task.result?.error || 'Unknown error'}`);
      return null;
    }

    // Check for webhook-processed images even if status isn't 'completed'
    if (task.webhookProcessed && task.result?.images?.length > 0) {
      console.log(`[waitForTaskCompletion] Task ${taskId} has webhook-processed images`);
      return task;
    }

    // Still processing, wait and poll again
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[waitForTaskCompletion] Task ${taskId} still processing (${elapsed}s elapsed)...`);
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  console.log(`[waitForTaskCompletion] Timeout waiting for task ${taskId}`);
  return null;
}

/**
 * Execute a scheduled action
 * @param {Object} schedule - Schedule object
 * @param {Object} fastify - Fastify instance
 * @returns {Object} Execution result
 */
async function executeScheduledAction(schedule, fastify) {
  const db = fastify.mongo.db;
  
  try {
    console.log(`[Scheduled Tasks] Executing ${schedule.actionType} for schedule ${schedule._id}`);
    
    let result;
    
    switch (schedule.actionType) {
      case ACTION_TYPES.GENERATE_IMAGE:
        result = await executeImageGeneration(schedule, fastify);
        break;
        
      case ACTION_TYPES.GENERATE_VIDEO:
        result = await executeVideoGeneration(schedule, fastify);
        break;
        
      case ACTION_TYPES.PUBLISH_POST:
        result = await executePostPublishing(schedule, fastify);
        break;
        
      default:
        throw new Error(`Unknown action type: ${schedule.actionType}`);
    }
    
    return {
      success: true,
      data: result
    };
    
  } catch (error) {
    console.error(`[Scheduled Tasks] Error executing schedule ${schedule._id}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Execute image generation task
 * @param {Object} schedule - Schedule object
 * @param {Object} fastify - Fastify instance
 * @returns {Object} Generation result
 */
async function executeImageGeneration(schedule, fastify) {
  const db = fastify.mongo.db;
  const { actionData } = schedule;
  
  // Handle custom prompts if selected
  let basePrompt = actionData.prompt || '';
  let customPromptId = null;
  let characterData = null;
  
  // If using custom prompts, randomly select one from the list
  if (actionData.useCustomPrompts && actionData.customPromptIds && actionData.customPromptIds.length > 0) {
    const randomIndex = Math.floor(Math.random() * actionData.customPromptIds.length);
    customPromptId = actionData.customPromptIds[randomIndex];
    
    // Fetch the custom prompt to get its details
    const customPrompt = await db.collection('prompts').findOne({ _id: new ObjectId(customPromptId) });
    if (customPrompt) {
      // Use custom prompt description if user prompt is not provided
      if (!basePrompt || basePrompt.trim() === '') {
        basePrompt = customPrompt.prompt || '';
      }
    }
  }
  
  // If character is selected, fetch character data and combine with prompt
  if (actionData.characterId) {
    characterData = await db.collection('chats').findOne({ _id: new ObjectId(actionData.characterId) });
    if (characterData) {
      console.log(`[Scheduled Tasks] Using character: ${characterData.name} for image generation`);

      // Build character description from available fields
      const characterDescription = characterData.enhancedPrompt || characterData.characterPrompt || '';
      const characterName = characterData.name || '';
      const characterGender = characterData.gender || '';

      // Build additional details if available
      let appearanceDetails = '';
      if (characterData.details?.appearance) {
        const app = characterData.details.appearance;
        const detailParts = [];
        if (app.age) detailParts.push(`${app.age} years old`);
        if (app.ethnicity) detailParts.push(app.ethnicity);
        if (app.bodyType) detailParts.push(`${app.bodyType} body`);
        if (detailParts.length > 0) {
          appearanceDetails = detailParts.join(', ');
        }
      }

      // Combine character details with the base prompt
      // The user's custom/manual prompt describes the scene/action, character details describe who
      if (characterDescription || characterName) {
        const characterContext = [];
        if (characterName) characterContext.push(characterName);
        if (characterGender) characterContext.push(characterGender);
        if (appearanceDetails) characterContext.push(appearanceDetails);
        if (characterDescription) characterContext.push(characterDescription);

        const characterPart = characterContext.join(', ');

        // If there's a base prompt (custom/manual), combine it with character details
        // Format: "[character details], [user's action/scene prompt]"
        if (basePrompt && basePrompt.trim() !== '') {
          basePrompt = `${characterPart}, ${basePrompt}`;
          console.log(`[Scheduled Tasks] Combined prompt with character details: ${basePrompt.substring(0, 100)}...`);
        } else {
          // No custom prompt, use just the character description
          basePrompt = characterPart;
          console.log(`[Scheduled Tasks] Using character description as prompt: ${basePrompt.substring(0, 100)}...`);
        }
      }
    }
  }
  
  // Apply prompt mutation if enabled
  let finalPrompt = basePrompt;
  let mutationData = null;
  
  if (schedule.mutationEnabled || actionData.mutationEnabled) {
    if (actionData.templateId) {
      // Apply template
      const templateResult = await applyTemplate(actionData.templateId, db, actionData.mutationOptions || {});
      finalPrompt = templateResult.mutatedPrompt;
      mutationData = {
        templateId: actionData.templateId,
        templateName: templateResult.templateName,
        mutations: templateResult.mutations,
        seed: templateResult.seed
      };
    } else {
      // Direct mutation
      const mutationResult = mutatePrompt(basePrompt, actionData.mutationOptions || {});
      finalPrompt = mutationResult.mutatedPrompt;
      mutationData = {
        mutations: mutationResult.mutations,
        seed: mutationResult.seed
      };
    }
  }
  
  // Use central image generator in imagen.js
  const { generateImg } = require('./imagen');

  // Prepare generation options
  const generationOptions = {
    prompt: finalPrompt,
    negativePrompt: actionData.negativePrompt,
    modelId: actionData.model,
    parameters: actionData.parameters || {},
    userId: schedule.userId.toString(),
    chatId: actionData.characterId || null, // Use characterId as chatId for character context
    imageType: actionData.imageType || (actionData.nsfw ? 'nsfw' : 'sfw'),
    customPromptId: customPromptId, // Pass custom prompt ID if selected
    fastify
  };

  // Generate image using the main generator. Pass fastify so it has access to DB and services.
  const generationResultRaw = await generateImg(generationOptions);

  // Normalize various possible return shapes to get an image URL
  let imageUrl = null;
  let completedTask = null;

  if (generationResultRaw) {
    // First, try to get immediate image URL (for sync responses)
    imageUrl = generationResultRaw.imageUrl || generationResultRaw.image_url || generationResultRaw.images?.[0]?.imageUrl || generationResultRaw.images?.[0]?.image_url || generationResultRaw.images?.[0];

    // If no immediate URL but we have a taskId, wait for async completion
    if (!imageUrl && generationResultRaw.taskId) {
      console.log(`[Scheduled Tasks] Image generation returned taskId ${generationResultRaw.taskId}, waiting for completion...`);

      completedTask = await waitForTaskCompletion(generationResultRaw.taskId, db);

      if (completedTask && completedTask.result?.images?.length > 0) {
        // Get the image URL from the completed task
        const firstImage = completedTask.result.images[0];
        imageUrl = firstImage.imageUrl || firstImage.image_url || firstImage;
        console.log(`[Scheduled Tasks] Task completed, got image URL: ${imageUrl?.substring(0, 60)}...`);
      }
    }
  }

  if (!imageUrl) {
    throw new Error('Image generation did not return an image URL');
  }

  // Create unified post
  const post = await createPostFromImage({
    userId: schedule.userId.toString(),
    testId: generationResultRaw._id || null,
    imageUrl,
    prompt: finalPrompt,
    negativePrompt: actionData.negativePrompt,
    model: actionData.model,
    parameters: actionData.parameters,
    nsfw: actionData.nsfw || false,
    mutationData,
    autoPublish: actionData.autoPublish || false,
    socialPlatforms: actionData.socialPlatforms || []
  }, db);
  
  // If auto-publish is enabled, publish to social media
  if (actionData.autoPublish && actionData.socialPlatforms && actionData.socialPlatforms.length > 0) {
    await publishToSocial(post, fastify);
  }
  
  return {
    postId: post._id,
    imageUrl: imageUrl,
    mutationData
  };
}

/**
 * Execute video generation task
 * @param {Object} schedule - Schedule object
 * @param {Object} fastify - Fastify instance
 * @returns {Object} Generation result
 */
async function executeVideoGeneration(schedule, fastify) {
  const db = fastify.mongo.db;
  const { actionData } = schedule;
  
  // Apply prompt mutation if enabled
  let prompt = actionData.prompt;
  let mutationData = null;
  
  if (schedule.mutationEnabled || actionData.mutationEnabled) {
    if (actionData.templateId) {
      // Apply template
      const templateResult = await applyTemplate(actionData.templateId, db, actionData.mutationOptions || {});
      prompt = templateResult.mutatedPrompt;
      mutationData = {
        templateId: actionData.templateId,
        templateName: templateResult.templateName,
        mutations: templateResult.mutations,
        seed: templateResult.seed
      };
    } else {
      // Direct mutation
      const mutationResult = mutatePrompt(prompt, actionData.mutationOptions || {});
      prompt = mutationResult.mutatedPrompt;
      mutationData = {
        mutations: mutationResult.mutations,
        seed: mutationResult.seed
      };
    }
  }
  
  // Import video generation utilities
  const { generateVideo } = require('./dashboard-video-utils');
  
  // Generate video
  const generationResult = await generateVideo({
    inputImageUrl: actionData.inputImageUrl,
    prompt,
    model: actionData.model,
    parameters: actionData.parameters,
    userId: schedule.userId.toString()
  }, db, fastify);
  
  // Create unified post
  const post = await createPostFromVideo({
    userId: schedule.userId.toString(),
    testId: generationResult._id,
    videoUrl: generationResult.videoUrl,
    thumbnailUrl: generationResult.thumbnailUrl,
    prompt,
    inputImageUrl: actionData.inputImageUrl,
    model: actionData.model,
    parameters: actionData.parameters,
    nsfw: actionData.nsfw || false,
    mutationData,
    autoPublish: actionData.autoPublish || false,
    socialPlatforms: actionData.socialPlatforms || []
  }, db);
  
  // If auto-publish is enabled, publish to social media
  if (actionData.autoPublish && actionData.socialPlatforms && actionData.socialPlatforms.length > 0) {
    await publishToSocial(post, fastify);
  }
  
  return {
    postId: post._id,
    videoUrl: generationResult.videoUrl,
    mutationData
  };
}

/**
 * Execute post publishing task
 * @param {Object} schedule - Schedule object
 * @param {Object} fastify - Fastify instance
 * @returns {Object} Publishing result
 */
async function executePostPublishing(schedule, fastify) {
  const db = fastify.mongo.db;
  const { postId } = schedule.actionData;
  
  // Get post
  const { getPostById } = require('./unified-post-utils');
  const post = await getPostById(postId, db);
  
  if (!post) {
    throw new Error('Post not found');
  }
  
  // Publish to social media
  const result = await publishToSocial(post, fastify);
  
  // Update post status
  await updatePostStatus(postId, POST_STATUSES.PUBLISHED, db);
  
  return result;
}

/**
 * Publish post to social media using Late.dev
 * @param {Object} post - Unified post object
 * @param {Object} fastify - Fastify instance
 * @returns {Object} Publishing result
 */
async function publishToSocial(post, fastify) {
  const db = fastify.mongo.db;
  
  if (!post.socialPlatforms || post.socialPlatforms.length === 0) {
    console.log('[Scheduled Tasks] No social platforms configured for post');
    return { published: false, reason: 'no_platforms' };
  }
  
  // Get user data
  const { ObjectId } = require('mongodb');
  const userData = await db.collection('users').findOne(
    { _id: new ObjectId(post.userId) },
    { projection: { snsConnections: 1, lateProfileId: 1 } }
  );
  
  if (!userData || !userData.lateProfileId) {
    console.log('[Scheduled Tasks] No Late.dev profile found for user');
    return { published: false, reason: 'no_profile' };
  }
  
  // Prepare media URLs
  const mediaUrls = [];
  if (post.type === 'image' && post.content.imageUrl) {
    mediaUrls.push(post.content.imageUrl);
  } else if (post.type === 'video' && post.content.videoUrl) {
    mediaUrls.push(post.content.videoUrl);
  }
  
  // Generate caption if not provided
  let caption = post.content.prompt || '';
  
  // Check NSFW and filter platforms
  const allowedPlatforms = post.socialPlatforms.filter(platform => {
    // Instagram doesn't allow NSFW content
    if (post.metadata.nsfw && platform === 'instagram') {
      return false;
    }
    return true;
  });
  
  if (allowedPlatforms.length === 0) {
    console.log('[Scheduled Tasks] No allowed platforms after NSFW filtering');
    return { published: false, reason: 'nsfw_filtered' };
  }
  
  try {
    // Use social-api to publish
    const lateApiRequest = require('../routes/social-api').lateApiRequest;
    
    // Resolve platform connections
    const connections = userData.snsConnections || [];
    const targetConnections = connections.filter(c => allowedPlatforms.includes(c.platform));
    
    if (targetConnections.length === 0) {
      console.log('[Scheduled Tasks] No connected accounts for selected platforms');
      return { published: false, reason: 'no_connections' };
    }
    
    // Prepare platforms data
    const platformsData = targetConnections.map(conn => ({
      platform: conn.platform,
      accountId: conn.lateAccountId,
      platformSpecificData: {}
    }));
    
    // Create post via Late.dev
    const postData = {
      content: caption,
      mediaItems: mediaUrls.map(url => ({
        url,
        type: post.type === 'video' ? 'video' : 'image'
      })),
      platforms: platformsData
    };
    
    // Make API request
    const LATE_API_BASE_URL = 'https://getlate.dev/api/v1';
    const LATE_API_KEY = process.env.LATE_API_KEY;
    
    const response = await fetch(`${LATE_API_BASE_URL}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LATE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(postData)
    });
    
    const responseData = await response.json();
    
    if (!response.ok) {
      throw new Error(responseData.message || `Late.dev API error: ${response.status}`);
    }
    
    const latePostId = responseData.id || responseData._id || responseData.postId;
    
    // Log social post
    await db.collection('socialPosts').insertOne({
      userId: new ObjectId(post.userId),
      unifiedPostId: post._id,
      text: caption,
      mediaUrls,
      platforms: platformsData,
      latePostId,
      status: 'published',
      createdAt: new Date()
    });
    
    // Update unified post with social post ID
    const { addSocialPostId } = require('./unified-post-utils');
    for (const platform of allowedPlatforms) {
      await addSocialPostId(post._id.toString(), platform, latePostId, db);
    }
    
    console.log(`[Scheduled Tasks] Published post ${post._id} to social media`);
    
    return {
      published: true,
      latePostId,
      platforms: allowedPlatforms
    };
    
  } catch (error) {
    console.error('[Scheduled Tasks] Error publishing to social:', error);
    return {
      published: false,
      error: error.message
    };
  }
}

/**
 * Process pending single schedules
 * @param {Object} fastify - Fastify instance
 */
async function processPendingSchedules(fastify) {
  const db = fastify.mongo.db;
  
  try {
    const pendingSchedules = await getPendingSingleSchedules(db);
    
    if (pendingSchedules.length === 0) {
      return;
    }
    
    console.log(`[Scheduled Tasks] Processing ${pendingSchedules.length} pending schedules`);
    
    for (const schedule of pendingSchedules) {
      const result = await executeScheduledAction(schedule, fastify);
      await markSingleScheduleExecuted(schedule._id.toString(), result, db);
    }
    
  } catch (error) {
    console.error('[Scheduled Tasks] Error processing pending schedules:', error);
  }
}

/**
 * Process active recurring schedules
 * @param {Object} fastify - Fastify instance
 */
async function processRecurringSchedules(fastify) {
  const db = fastify.mongo.db;
  
  try {
    const activeSchedules = await getActiveRecurringSchedules(db);
    
    if (activeSchedules.length === 0) {
      return;
    }
    
    console.log(`[Scheduled Tasks] Processing ${activeSchedules.length} recurring schedules`);
    
    for (const schedule of activeSchedules) {
      const result = await executeScheduledAction(schedule, fastify);
      await markRecurringScheduleExecuted(schedule._id.toString(), result, db);
    }
    
  } catch (error) {
    console.error('[Scheduled Tasks] Error processing recurring schedules:', error);
  }
}

/**
 * Main task processor - runs every minute
 * @param {Object} fastify - Fastify instance
 */
const createScheduledTasksProcessor = (fastify) => {
  return async () => {
    //console.log('[Scheduled Tasks] Running task processor...');
    
    try {
      // Process both pending and recurring schedules
      await Promise.all([
        processPendingSchedules(fastify),
        processRecurringSchedules(fastify)
      ]);
      
      //console.log('[Scheduled Tasks] Task processor completed');
    } catch (error) {
      console.error('[Scheduled Tasks] Task processor error:', error);
    }
  };
};

module.exports = {
  executeScheduledAction,
  executeImageGeneration,
  executeVideoGeneration,
  executePostPublishing,
  publishToSocial,
  processPendingSchedules,
  processRecurringSchedules,
  createScheduledTasksProcessor
};
