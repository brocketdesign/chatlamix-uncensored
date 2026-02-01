const { ObjectId } = require('mongodb');
const axios = require('axios');
const { createHash } = require('crypto');
const { uploadToS3 } = require('../models/tool');
const { awardVideoGenerationReward, awardCharacterVideoMilestoneReward } = require('./user-points-utils');
const { Translations } = require('openai/resources/audio/translations.mjs');
const { VIDEO_MODEL_CONFIGS } = require('./dashboard-video-utils');

/**
 * Get webhook URL for Novita tasks
 */
function getWebhookUrl() {
  if (process.env.NOVITA_WEBHOOK_URL) {
    return process.env.NOVITA_WEBHOOK_URL;
  }
  if (process.env.MODE === 'local') {
    if (process.env.LOCAL_WEBHOOK_URL) {
      return process.env.LOCAL_WEBHOOK_URL;
    }
    return 'http://localhost:3000/novita/webhook';
  } else {
    const baseDomain = process.env.PUBLIC_BASE_DOMAIN || 'chatlamix.com';
    return `https://app.${baseDomain}/novita/webhook`;
  }
}

/**
 * Count runes (Unicode code points) in a string
 * @param {string} str - String to count runes in
 * @returns {number} Number of runes
 */
function countRunes(str) {
  if (!str || typeof str !== 'string') return 0;
  // Use Array.from to properly count Unicode code points (runes)
  return Array.from(str).length;
}

/**
 * Validate and truncate prompt to meet Novita API requirements
 * Prompt must be between 1 and 2000 runes (Unicode code points)
 * @param {string} prompt - Original prompt
 * @param {string} defaultPrompt - Default prompt to use if original is invalid
 * @returns {string} Validated and truncated prompt
 */
function validateAndTruncatePrompt(prompt, defaultPrompt = 'Generate a dynamic video from this image') {
  // Use default if prompt is empty or invalid
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    prompt = defaultPrompt;
  }
  
  // Trim whitespace
  prompt = prompt.trim();
  
  // Count runes
  const runeCount = countRunes(prompt);
  
  // If prompt is too long, truncate it to 2000 runes
  if (runeCount > 2000) {
    // Convert to array of runes, take first 2000, then join back
    const runes = Array.from(prompt);
    prompt = runes.slice(0, 2000).join('').trim();
    console.warn(`[validateAndTruncatePrompt] Prompt truncated from ${runeCount} to ${countRunes(prompt)} runes`);
  }
  
  // Ensure prompt is at least 1 rune (should always be true after trimming, but double-check)
  if (countRunes(prompt) < 1) {
    prompt = defaultPrompt;
  }
  
  return prompt;
}
/**
 * Generate video from image using Novita AI
 * @param {Object} params - Parameters for video generation
 * @param {string} params.imageUrl - Base64 encoded image or image URL
 * @param {string} params.prompt - Text prompt for video generation
 * @param {string} params.modelId - Model ID to use for generation
 * @param {string} params.userId - User ID
 * @param {string} params.chatId - Chat ID
 * @param {string} params.placeholderId - Placeholder ID for tracking
 * @returns {Object} Task result from Novita API or Segmind API
 */
async function generateVideoFromImage({ imageUrl, nsfw, prompt, modelId = 'wan-2.2-i2v-fast', userId, chatId, placeholderId }) {
  const novitaApiKey = process.env.NOVITA_API_KEY;
  const segmindApiKey = process.env.SEGMIND_API_KEY;
  const webhookUrl = getWebhookUrl();

  // Get model configuration
  const modelConfig = VIDEO_MODEL_CONFIGS[modelId];
  if (!modelConfig) {
    console.error(`[generateVideoFromImage] Unknown model: ${modelId}, falling back to wan-2.2-i2v-fast`);
    modelId = 'wan-2.2-i2v-fast';
  }
  
  const config = VIDEO_MODEL_CONFIGS[modelId];
  const apiUrl = config.endpoint;

  // Validate and truncate prompt to meet API requirements (1-2000 runes)
  const validatedPrompt = validateAndTruncatePrompt(prompt, 'Generate a dynamic video from this image');
  
  // Log the prompt for debugging
  console.log('[generateVideoFromImage] Model:', modelId);
  console.log('[generateVideoFromImage] Original prompt:', prompt);
  console.log('[generateVideoFromImage] Validated prompt:', validatedPrompt);
  console.log('[generateVideoFromImage] Prompt rune count:', countRunes(validatedPrompt));
  console.log('[generateVideoFromImage] Prompt char length:', validatedPrompt?.length);

  // Build request body based on model type
  let requestData = {};
  
  if (modelId === 'wan-2.2-i2v-fast') {
    // Wan 2.2 I2V Fast via Segmind - use go_fast mode for chat video generation
    requestData = {
      image: imageUrl,
      prompt: validatedPrompt,
      go_fast: true, // Always use go_fast for chat video generation
      num_frames: 81,
      resolution: '480p',
      aspect_ratio: '16:9',
      sample_shift: 12,
      frames_per_second: 16,
      high_noise_lora_scale: 1,
      low_noise_lora_scale: 1,
      high_noise_lora_scale_2: 1,
      low_noise_lora_scale_2: 1,
      high_noise_lora_scale_3: 1,
      low_noise_lora_scale_3: 1
    };
    
    // Handle Segmind API call separately (synchronous)
    console.log('[generateVideoFromImage] Using Segmind API for wan-2.2-i2v-fast');
    console.log('[generateVideoFromImage] Request data:', JSON.stringify({
      ...requestData,
      image: requestData.image ? `[${requestData.image.length} chars]` : undefined
    }, null, 2));
    
    try {
      const axios = require('axios');
      // Segmind returns raw video binary data, not a URL
      const response = await axios.post(apiUrl, requestData, {
        headers: {
          'x-api-key': segmindApiKey,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer', // Expect binary data
        timeout: 300000 // 5 minutes timeout for video generation
      });
      
      console.log('[generateVideoFromImage] Segmind response status:', response.status);
      console.log('[generateVideoFromImage] Segmind response content-type:', response.headers['content-type']);
      console.log('[generateVideoFromImage] Segmind response size:', response.data?.byteLength || response.data?.length, 'bytes');
      
      if (response.status === 200) {
        // Segmind returns raw video binary data directly
        const videoBuffer = Buffer.from(response.data);
        
        // Check if it's actually video data (MP4 starts with 'ftyp' signature)
        const headerStr = videoBuffer.slice(0, 12).toString('utf-8');
        const isVideo = headerStr.includes('ftyp') || headerStr.includes('moov');
        
        if (!isVideo && videoBuffer.length < 1000) {
          // Small response might be an error message
          const responseText = videoBuffer.toString('utf-8');
          console.error('[generateVideoFromImage] Unexpected Segmind response:', responseText.substring(0, 500));
          throw new Error('Unexpected response from Segmind API: ' + responseText.substring(0, 200));
        }
        
        console.log('[generateVideoFromImage] Video size:', videoBuffer.length, 'bytes, Is video:', isVideo);
        
        // Upload video binary directly to S3
        const hash = createHash('md5').update(videoBuffer).digest('hex');
        const s3VideoUrl = await uploadToS3(videoBuffer, hash, 'segmind_video.mp4');
        
        console.log('[generateVideoFromImage] Video uploaded to S3:', s3VideoUrl);
        
        // Return with synchronous completed status
        return {
          success: true,
          taskId: `segmind_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          modelId: modelId,
          videoUrl: s3VideoUrl,
          status: 'completed',
          message: 'Video generated successfully'
        };
      } else {
        // Try to parse error message from response
        let errorMsg = `Segmind API returned status ${response.status}`;
        try {
          const errorText = Buffer.from(response.data).toString('utf-8');
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.message || errorJson.error || errorMsg;
        } catch (e) {
          // Ignore parsing errors
        }
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error('[generateVideoFromImage] Segmind API error:', error.message);
      if (error.response?.data) {
        try {
          const errorText = Buffer.from(error.response.data).toString('utf-8');
          console.error('[generateVideoFromImage] Segmind error response:', errorText.substring(0, 500));
        } catch (e) {
          console.error('[generateVideoFromImage] Segmind error response:', error.response.data);
        }
      }
      throw new Error('Failed to generate video with Segmind API: ' + error.message);
    }
  } else if (modelId === 'wan-i2v') {
    // Wan 2.1 uses flat structure with image_url parameter
    requestData = {
      image_url: imageUrl,
      prompt: validatedPrompt,
      width: 1280,
      height: 720
    };
  } else if (modelId === 'wan-2.2-i2v' || modelId === 'wan-2.5-i2v-preview' || modelId === 'wan2.6-i2v') {
    // Wan 2.2, 2.5, 2.6 use nested input/parameters structure
    requestData = {
      input: {
        img_url: imageUrl,
        prompt: validatedPrompt
      },
      parameters: {
        resolution: '720P',
        duration: 5
      }
    };
  } else if (modelId === 'minimax-i2v') {
    // Minimax uses image_url parameter
    requestData = {
      prompt: validatedPrompt,
      image_url: imageUrl,
      enable_prompt_expansion: true
    };
  } else if (modelId === 'vidu-i2v') {
    // Vidu Q1 uses image parameter
    requestData = {
      image: imageUrl,
      prompt: validatedPrompt,
      style: 'general',
      resolution: '1080p',
      aspect_ratio: '16:9',
      movement_amplitude: 'auto',
      duration: 5
    };
  } else if (modelId === 'pixverse-i2v') {
    // PixVerse uses image parameter
    requestData = {
      image: imageUrl,
      prompt: validatedPrompt,
      resolution: '540p',
      fast_mode: false
    };
  } else if (modelId === 'seedance-i2v') {
    // Seedance uses image parameter
    requestData = {
      image: imageUrl,
      prompt: validatedPrompt,
      duration: 5,
      resolution: '720p',
      ratio: 'adaptive',
      fps: 24,
      generate_audio: true,
      camera_fixed: false
    };
  } else if (modelId === 'luma-i2v') {
    // Luma Dream Machine uses keyframes structure
    requestData = {
      prompt: validatedPrompt,
      keyframes: {
        frame0: {
          type: 'image',
          url: imageUrl
        }
      },
      model: 'ray-2',
      resolution: '720p',
      duration: '5s',
      aspect_ratio: '16:9'
    };
  } else {
    // Kling and other generic I2V models - use image parameter
    requestData = {
      image: imageUrl,
      prompt: validatedPrompt,
      mode: "Standard",
      duration: "5",
      guidance_scale: 0.5,
      negative_prompt: 'blurry, low quality, distorted'
    };
  }
  
  // Add webhook for async processing
  requestData.extra = {
    webhook: {
      url: webhookUrl
    }
  };
  
  console.log('[generateVideoFromImage] Request data:', JSON.stringify(requestData, null, 2));
  
  try {
    const response = await axios.post(apiUrl, requestData, {
      headers: {
        'Authorization': `Bearer ${novitaApiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.task_id) {
      return {
        success: true,
        taskId: response.data.task_id,
        modelId: modelId,
        message: 'Video generation started'
      };
    } else {
      throw new Error('Invalid response from Novita API');
    }
  } catch (error) {
    console.error('Error calling Novita img2video API:', error);
    
    // Log more detailed error information if available
    if (error.response && error.response.data) {
      console.error('Novita API error response:', JSON.stringify(error.response.data, null, 2));
    }
    
    // Provide more specific error message if it's a validation error
    if (error.response && error.response.data && error.response.data.message) {
      const errorMessage = error.response.data.message;
      if (errorMessage.includes('Prompt') || errorMessage.includes('runes')) {
        throw new Error(`Invalid prompt: ${errorMessage}`);
      }
    }
    
    throw new Error('Failed to start video generation');
  }
}

/**
 * Check video generation task status
 * @param {string} taskId - Task ID from Novita
 * @returns {Object} Task status information
 */
async function checkVideoTaskStatus(taskId) {
  const novitaApiKey = process.env.NOVITA_API_KEY;
  const apiUrl = `https://api.novita.ai/v3/async/task-result?task_id=${taskId}`;

  try {
    const response = await axios.get(apiUrl, {
      headers: {
        'Authorization': `Bearer ${novitaApiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const data = response.data;
    
    if (data.task.status === 'TASK_STATUS_SUCCEED') {
      console.log(data);
      console.log(data.videos);
      
      // Download video from Novita and upload to S3
      const novitaVideoUrl = data.videos?.[0]?.video_url;
      if (novitaVideoUrl) {
        try {
          // Download the video
          const videoResponse = await axios.get(novitaVideoUrl, { 
            responseType: 'arraybuffer',
            timeout: 120000 // 2 minutes timeout for video download
          });
          const videoBuffer = Buffer.from(videoResponse.data);
          
          // Create hash for unique filename
          const hash = createHash('md5').update(videoBuffer).digest('hex');
          
          // Upload to S3 with .mp4 extension
          const s3VideoUrl = await uploadToS3(videoBuffer, hash, 'novita_result_video.mp4');
          
          console.log(`[checkVideoTaskStatus] Video uploaded to S3: ${s3VideoUrl}`);
          
          return {
            status: 'completed',
            result: {
              videoUrl: s3VideoUrl, // Use S3 URL instead of Novita URL
              duration: data.videos?.[0]?.duration
            }
          };
        } catch (uploadError) {
          console.error('[checkVideoTaskStatus] Error uploading video to S3:', uploadError);
          // Fallback to original URL if S3 upload fails
          return {
            status: 'completed',
            result: {
              videoUrl: novitaVideoUrl,
              duration: data.videos?.[0]?.duration
            }
          };
        }
      } else {
        return {
          status: 'failed',
          error: 'No video URL in response'
        };
      }
    } else if (data.task.status === 'TASK_STATUS_PROCESSING') {
      return {
        status: 'processing',
        progress: data.task.progress || 0
      };
    } else if (data.task.status === 'TASK_STATUS_FAILED') {
      return {
        status: 'failed',
        error: data.task.reason || 'Video generation failed'
      };
    } else {
      return {
        status: 'pending',
        progress: 0
      };
    }
  } catch (error) {
    console.error('Error checking video task status:', error);
    return {
      status: 'failed',
      error: 'Failed to check task status'
    };
  }
}

/**
 * Save video generation task to database
 * @param {Object} params - Task parameters
 * @param {Object} fastify - Fastify instance
 * @returns {Object} Saved task
 */
async function saveVideoTask({
  taskId,
  userId,
  chatId,
  userChatId,
  imageId,
  imageUrl,
  prompt,
  nsfw,
  placeholderId,
  fastify,
  status = 'pending',
  result
}) {
  const db = fastify.mongo.db;
  const tasksCollection = db.collection('tasks');

  const taskData = {
    taskId,
    task_type: 'img2video',
    type: 'img2video',
    userId: new ObjectId(userId),
    chatId: new ObjectId(chatId),
    userChatId,
    imageId: new ObjectId(imageId),
    imageUrl,
    prompt,
    nsfw,
    placeholderId,
    status: status,
    result: result || null,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const dbResult = await tasksCollection.insertOne(taskData);
  return { ...taskData, _id: dbResult.insertedId };
}

/**
 * Find and update image message with video generation action
 * @param {string} userChatId - User chat ID
 * @param {Object} userChatMessages - User chat messages object
 * @param {string} imageId - Image ID that was used to generate video
 * @param {string} videoId - Generated video ID
 * @param {Object} fastify - Fastify instance
 */
const findImageMessageAndUpdateWithVideoAction = async (userChatId, userChatMessages, imageId, videoId, fastify) => {
  if (!userChatMessages || !userChatMessages.messages) return;
  
  const messageIndex = userChatMessages.messages.findIndex(msg => {
    const content = msg.content || '';
    return (msg.type == "image" && msg.imageId == imageId) || content.startsWith('[Image] ' + imageId.toString()) || content.startsWith('[image] ' + imageId.toString());
  });
  
  if (messageIndex !== -1) {
    const message = userChatMessages.messages[messageIndex];
    
    // Initialize actions array if it doesn't exist
    if (!message.actions) {
      message.actions = [];
    }
    
    // Check if video action already exists
    const existingVideoAction = message.actions.find(action => action.type === 'video_generated');
    if (!existingVideoAction) {
      // Add video generation action to the actions array
      message.actions.push({
        type: 'video_generated',
        videoId: videoId,
        date: new Date()
      });
      
      // Update the userChatMessages in the database
      const collectionUserChat = fastify.mongo.db.collection('userChat');
      await collectionUserChat.updateOne(
        { _id: new fastify.mongo.ObjectId(userChatId) },
        { $set: { messages: userChatMessages.messages } }
      );
      console.log(`User chat messages updated with video action for imageId: ${imageId}, videoId: ${videoId}`);
    } else {
      console.log(`Video action already exists for imageId: ${imageId}`);
    }
  }
};

/**
 * Save completed video to database
 * @param {Object} params - Video data parameters
 * @param {Object} fastify - Fastify instance
 * @returns {Object} Saved video data
 */
async function saveVideoToDB({
  taskId,
  userId,
  chatId,
  userChatId,
  imageId,
  videoUrl,
  duration,
  prompt,
  nsfw,
  fastify
}) {
  const db = fastify.mongo.db;
  const videosCollection = db.collection('videos');

  // Check multiple conditions to prevent duplicates
  const existingVideo = await videosCollection.findOne({
    $or: [
      { taskId: taskId },
      { 
        userId: new ObjectId(userId),
        imageId: new ObjectId(imageId),
        videoUrl: videoUrl
      }
    ]
  });
  
  console.log(`[saveVideoToDB] Checking for existing video with taskId ${taskId} or matching user/image/url`);
  if (existingVideo) {
    console.log(`[saveVideoToDB] Video already exists with ID ${existingVideo._id}, returning existing video`);
    return existingVideo;
  }

  const videoData = {
    taskId,
    userId: new ObjectId(userId),
    chatId: new ObjectId(chatId),
    userChatId,
    imageId: new ObjectId(imageId),
    videoUrl,
    duration,
    prompt,
    nsfw: !!nsfw,
    createdAt: new Date()
  };

  // Insert the video document first
  const result = await videosCollection.insertOne(videoData);
  console.log(`[saveVideoToDB] Video saved with ID: ${result.insertedId}`);

  // Add video message to userChat with atomic duplicate check
  const userDataCollection = db.collection('userChat');
  
  const videoMessage = { 
    role: "assistant", 
    content: prompt, 
    hidden: true, 
    type: "video", 
    videoId: result.insertedId.toString(), 
    videoUrl, 
    duration, 
    prompt,
    createdAt: new Date() 
  };
  
  // CRITICAL FIX: Use atomic operation to check and insert in one step
  // IMPORTANT: Must use $not + $elemMatch for array field checks, NOT $ne!
  // $ne on arrays matches if ANY element doesn't match, which is always true for arrays
  const updateResult = await userDataCollection.updateOne(
    { 
      userId: new ObjectId(userId), 
      _id: new ObjectId(userChatId),
      messages: { $not: { $elemMatch: { videoId: result.insertedId.toString() } } }  // Only update if no message has this videoId
    },
    { 
      $push: { messages: videoMessage }, 
      $set: { updatedAt: new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }) } 
    }
  );
  
  if (updateResult.modifiedCount > 0) {
    console.log(`[saveVideoToDB] Video message added to userChat for videoId ${result.insertedId}`);
  } else {
    console.log(`[saveVideoToDB] Video message already exists or chat not found for videoId ${result.insertedId}`);
  }

  // Update the original image message with video generation action
  if (userChatId) {
    const userChatMessages = await userDataCollection.findOne({ _id: new ObjectId(userChatId) });
    await findImageMessageAndUpdateWithVideoAction(userChatId, userChatMessages, imageId, result.insertedId, fastify);
  }


  // Update counts only if this is a new video
  const chatsCollection = db.collection('chats');
  await chatsCollection.updateOne(
    { _id: new ObjectId(chatId) },
    { $inc: { videoCount: 1 } }
  );

  const usersCollection = db.collection('users');
  await usersCollection.updateOne(
    { _id: new ObjectId(userId) },
    { $inc: { videoCount: 1 } }
  );

  // Award video generation milestone rewards
  try {
    // Check global milestones (no base points, higher thresholds)
    await awardVideoGenerationReward(db, userId, fastify);
    
    // Check character-specific milestones (lower thresholds, per chat)
    await awardCharacterVideoMilestoneReward(db, userId, chatId, fastify);
  } catch (error) {
    console.error('Error awarding video generation milestones:', error);
  }

  return { ...videoData, _id: result.insertedId };
}

/**
 * Set video task to background status for cron job processing
 * @param {string} taskId - Task ID
 * @param {Object} fastify - Fastify instance
 * @param {Object} options - Additional options for completion handling
 */
async function pollVideoTaskStatus(taskId, fastify, options = {}) {
  console.log(`[pollVideoTaskStatus] Setting task ${taskId} to background status for cron job processing`);
  
  const db = fastify.mongo.db;
  
  try {
    // Update task status to 'background' so the cron job will pick it up
    const updateResult = await db.collection('tasks').updateOne(
      { taskId },
      { 
        $set: { 
          status: 'background',
          updatedAt: new Date()
        } 
      }
    );
    
    console.log(`[pollVideoTaskStatus] Task ${taskId} set to background status.`);
    
    if (updateResult.matchedCount === 0) {
      console.warn(`[pollVideoTaskStatus] No task found with taskId: ${taskId}`);
    }
    
  } catch (error) {
    console.error(`[pollVideoTaskStatus] Error setting task ${taskId} to background:`, error);
    
    // Mark task as failed if we can't set it to background
    await db.collection('tasks').updateOne(
      { taskId },
      { 
        $set: { 
          status: 'failed', 
          result: { error: 'Failed to set task to background' },
          updatedAt: new Date() 
        } 
      }
    );
    
    // Notify user of error via WebSocket
    if (options.userId) {
      console.log(`[pollVideoTaskStatus] Notifying user ${options.userId} of background setup failure`);
      fastify.sendNotificationToUser(options.userId, 'handleVideoLoader', { 
        videoId: options.placeholderId, 
        action: 'remove' 
      });
      const img2videoTranslations = fastify.getImg2videoTranslations(fastify.request?.lang || 'en');
      fastify.sendNotificationToUser(options.userId, 'showNotification', {
        message: img2videoTranslations?.notifications?.generationFailed || 'Video generation failed to start',
        icon: 'error'
      });
    }
  }
}

/**
 * Handle video task completion
 * @param {Object} taskStatus - Task status result
 * @param {Object} fastify - Fastify instance
 * @param {Object} options - Additional options
 */
async function handleVideoTaskCompletion(taskStatus, fastify, options = {}) {
  const { userId, chatId, userChatId, placeholderId, imageId, prompt, nsfw } = options;
  
  console.log(`[handleVideoTaskCompletion] Starting completion handler for task ${taskStatus.taskId} and placeholderId ${placeholderId}`);
  console.log(`[handleVideoTaskCompletion] Options:`, JSON.stringify(options, null, 2));
  console.log(`[handleVideoTaskCompletion] Task status:`, JSON.stringify(taskStatus, null, 2));

  if (typeof fastify.sendNotificationToUser !== 'function') {
    console.error('[handleVideoTaskCompletion] fastify.sendNotificationToUser is not a function');
  }
  
  if (taskStatus.result && taskStatus.result.videoUrl) {
    console.log(`[handleVideoTaskCompletion] Video URL found, saving to database for task ${taskStatus.taskId || placeholderId}`);
    
    try {
        const db = fastify.mongo.db;
        // Check if already processed to prevent duplicate notifications
        const existingTask = await db.collection('tasks').findOne({ 
            $or: [
                { taskId: taskStatus.taskId, status: 'completed' },
                { placeholderId: placeholderId, status: 'completed' }
            ]
        });
        
        if (existingTask) {
            console.log(`Task ${taskStatus.taskId || placeholderId} already completed, skipping duplicate processing`);
            return;
        }

      // Save video to database
      const savedVideo = await saveVideoToDB({
        taskId: taskStatus.taskId || placeholderId,
        userId,
        chatId,
        userChatId,
        imageId,
        videoUrl: taskStatus.result.videoUrl,
        duration: taskStatus.result.duration,
        prompt,
        nsfw: options.nsfw,
        fastify
      });

      console.log(`[handleVideoTaskCompletion] Video saved to database with ID: ${savedVideo._id}`);

      // Update task as completed in database using both taskId and placeholderId
      const taskUpdateResult = await db.collection('tasks').updateOne(
        { 
          $or: [
            { taskId: taskStatus.taskId },
            { placeholderId: placeholderId }
          ]
        },
        { 
          $set: { 
            status: 'completed', 
            result: { 
              videoUrl: taskStatus.result.videoUrl, 
              videoId: savedVideo._id,
              duration: taskStatus.result.duration
            },
            updatedAt: new Date() 
          } 
        }
      );

      console.log(`[handleVideoTaskCompletion] Task updated in database. Update result:`, taskUpdateResult);

      // Remove loader via WebSocket using placeholderId
      console.log(`[handleVideoTaskCompletion] Sending handleVideoLoader notification to user ${userId}`);
      fastify.sendNotificationToUser(userId, 'handleVideoLoader', { 
        placeholderId: placeholderId, 
        action: 'remove' 
      });

      // Notify user of successful video generation via WebSocket
      console.log(`[handleVideoTaskCompletion] Sending videoGenerated notification to user ${userId}`);
      const videoNotificationData = {
        videoId: savedVideo._id,
        videoUrl: taskStatus.result.videoUrl,
        duration: taskStatus.result.duration,
        userChatId,
        placeholderId,
        nsfw: !!options.nsfw,
        taskId: taskStatus.taskId
      };
      console.log(`[handleVideoTaskCompletion] Video notification data:`, JSON.stringify(videoNotificationData, null, 2));
      
      fastify.sendNotificationToUser(userId, 'videoGenerated', videoNotificationData);

      console.log(`[handleVideoTaskCompletion] Video completion handling finished successfully for task ${taskStatus.taskId}`);

      // Send additional notifications so frontend updates video counts/goals
      try {
        const db = fastify.mongo.db;
        const chatsCollection = db.collection('chats');
        const usersCollection = db.collection('users');

        const chatDoc = chatId ? await chatsCollection.findOne({ _id: new ObjectId(chatId) }) : null;
        const userDoc = await usersCollection.findOne({ _id: new ObjectId(userId) });

        const totalVideos = userDoc?.videoCount || 0;
        const totalChatVideos = chatDoc?.videoCount || 0;

        // Refresh goals / live-goals widget
        fastify.sendNotificationToUser(userId, 'refreshGoals', {
          userId,
          chatId,
          type: 'video',
          totalImages: null,
          totalVideos: totalVideos,
          totalChatVideos: totalChatVideos
        });

        // Trigger character video milestone UI update (non-milestone payload so UI refreshes counts)
        fastify.sendNotificationToUser(userId, 'characterVideoMilestone', {
          userId,
          points: 0,
          reason: 'Video generated',
          source: 'video_generation',
          milestone: null,
          totalVideos: totalVideos,
          chatId,
          isMilestone: false
        });
      } catch (notifyErr) {
        console.error('[handleVideoTaskCompletion] Error sending post-video notifications:', notifyErr);
      }

    } catch (error) {
      console.error(`[handleVideoTaskCompletion] Error saving video for task ${taskStatus.taskId}:`, error);
      
      // Remove loader and show error
      console.log(`[handleVideoTaskCompletion] Sending error notifications to user ${userId}`);
      fastify.sendNotificationToUser(userId, 'handleVideoLoader', { 
        placeholderId: placeholderId, 
        action: 'remove' 
      });
      const img2videoTranslations = fastify.getImg2videoTranslations(fastify.request?.lang || 'en');
      fastify.sendNotificationToUser(userId, 'showNotification', {
        message: img2videoTranslations?.notifications?.videoSaveFailed || 'Video generated but failed to save',
        icon: 'error'
      });
    }
  } else {
    console.log('[handleVideoTaskCompletion] No video URL in task result:', taskStatus);
    
    // Remove loader and show error
    console.log(`[handleVideoTaskCompletion] Sending no-video-URL error notifications to user ${userId}`);
    fastify.sendNotificationToUser(userId, 'handleVideoLoader', { 
      placeholderId: placeholderId, 
      action: 'remove' 
    });
    const img2videoTranslations = fastify.getImg2videoTranslations(fastify.request?.lang || 'en');
    fastify.sendNotificationToUser(userId, 'showNotification', {
      message: img2videoTranslations?.notifications?.noVideoUrl || 'Video generation completed but no video URL received',
      icon: 'error'
    });
  }
}

/**
 * Resume polling for incomplete video tasks on server startup
 * @param {Object} fastify - Fastify instance
 */
async function resumeIncompleteVideoTasks(fastify) {
  console.log('[resumeIncompleteVideoTasks] Starting resume process for incomplete video tasks');
  
  try {
    const db = fastify.mongo.db;
    const incompleteTasks = await db.collection('tasks').find({
      type: 'img2video',
      status: { $in: ['pending', 'processing'] }
    }).toArray();

    console.log(`[resumeIncompleteVideoTasks] Found ${incompleteTasks.length} incomplete video tasks to resume`);

    if (incompleteTasks.length === 0) {
      console.log('[resumeIncompleteVideoTasks] No incomplete tasks found');
      return 0;
    }

    for (const task of incompleteTasks) {
      console.log(`[resumeIncompleteVideoTasks] Setting task ${task.taskId} to background status`);
      
      // Set tasks to background status so cron job will pick them up
      await db.collection('tasks').updateOne(
        { _id: task._id },
        { 
          $set: { 
            status: 'background',
            updatedAt: new Date()
          }
        }
      );
      
      console.log(`[resumeIncompleteVideoTasks] Task ${task.taskId} set to background for cron processing (user: ${task.userId})`);
    }

    console.log(`[resumeIncompleteVideoTasks] Successfully set ${incompleteTasks.length} tasks to background status`);
    return incompleteTasks.length;
    
  } catch (error) {
    console.error('[resumeIncompleteVideoTasks] Error resuming incomplete video tasks:', error);
    return 0;
  }
}

module.exports = {
  generateVideoFromImage,
  checkVideoTaskStatus,
  saveVideoTask,
  saveVideoToDB,
  pollVideoTaskStatus,
  handleVideoTaskCompletion,
  resumeIncompleteVideoTasks,
  findImageMessageAndUpdateWithVideoAction
};
