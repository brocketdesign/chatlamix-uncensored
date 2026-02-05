/**
 * Cron Job Manager utility for handling system cron jobs
 */
const cron = require('node-cron');
const { fetchRandomCivitaiPrompt, createModelChat } = require('./civitai-utils');
const parser = require('cron-parser');
// Note: checkTaskStatus is no longer needed for polling - webhooks handle task completion
const { ObjectId } = require('mongodb');
const fs = require('fs');
const { cacheSitemapData } = require('./sitemap-utils'); // <-- import sitemap utils
const { updateAnalyticsCache } = require('./cronUserAnalytics'); // <-- import analytics cache function
const { persistQueryTags } = require('./query-tags-utils');
const { createScheduledTasksProcessor } = require('./scheduled-tasks-processor'); // <-- import scheduled tasks processor
const { recoverUnfinishedTasks } = require('./task-recovery-utils'); // <-- import task recovery utils
const { runNightlyPreferencesAnalysis } = require('./user-preferences-analyzer'); // <-- import user preferences analyzer
// Store active cron jobs
const cronJobs = {};

/**
 * Configure a cron job
 * 
 * @param {string} jobName - Unique name for the job
 * @param {string} schedule - Cron schedule expression
 * @param {boolean} enabled - Whether the job should be enabled
 * @param {Function} task - The task function to execute
 * @returns {boolean} - Whether the job was successfully configured
 */
const configureCronJob = (jobName, schedule, enabled, task) => {
  // Stop existing job if it exists
  if (cronJobs[jobName]) {
    // Access the actual cron job object's stop method
    if (cronJobs[jobName].job) {
      cronJobs[jobName].job.stop();
    }
    delete cronJobs[jobName];
  }
  
  // Create new job if enabled
  if (enabled && schedule && task) {
    try {
      // Validate the schedule
      parser.parseExpression(schedule);
      
      const job = cron.schedule(schedule, task, { scheduled: true });
      cronJobs[jobName] = {
        job,
        schedule,
        enabled: true
      };
      console.log(`⏰ [CRON] ✅ Job configured: '${jobName}' | Schedule: ${schedule}`);
      return true;
    } catch (error) {
      console.error(`⏰ [CRON] ❌ Error configuring cron job '${jobName}':`, error);
      return false;
    }
  }
  
  return false; 
};

/**
 * Clean up expired audio files that weren't deleted by the setTimeout
 * @param {Object} fastify - Fastify instance
 */
const cleanupExpiredAudioFiles = (fastify) => async () => {
  const db = fastify.mongo.db;
  const cleanupCollection = db.collection('audioFileCleanup');
  
  try {
    // Find all expired files
    const expiredFiles = await cleanupCollection.find({
      expiresAt: { $lt: new Date() }
    }).toArray();
        
    // Delete each expired file
    for (const fileRecord of expiredFiles) {
      try {
        const filePath = fileRecord.filePath;
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
          console.log(`🗑️  [CRON] Deleted expired audio: ${fileRecord.filename}`);
        }
        
        // Remove from the tracking collection
        await cleanupCollection.deleteOne({ _id: fileRecord._id });
      } catch (err) {
        console.error(`🗑️  [CRON] ❌ Error deleting file ${fileRecord.filename}:`, err);
        // If the file doesn't exist, still remove from tracking
        if (err.code === 'ENOENT') {
          await cleanupCollection.deleteOne({ _id: fileRecord._id });
        }
      }
    }
    if (expiredFiles.length > 0) {
      console.log(`🗑️  [CRON] ✅ Audio cleanup complete | Deleted: ${expiredFiles.length} files`);
    }
  } catch (err) {
    console.error('🗑️  [CRON] ❌ Error cleaning up expired audio files:', err);
  }
};

/**
 * Create a model chat generation task
 * 
 * @param {Object} fastify - Fastify instance
 * @returns {Function} The task function to execute
 */
const createModelChatGenerationTask = (fastify) => {
  return async () => {
    console.log('🤖 [CRON] ▶️  Starting model chat generation task...');
    const db = fastify.mongo.db;
    
    try {
      // Check if the database is accessible
      await db.command({ ping: 1 });
      
      // Get current settings
      const settingsCollection = db.collection('systemSettings');
      const modelChatCronSettings = await settingsCollection.findOne({ type: 'modelChatCron' });
      
      if (!modelChatCronSettings || !modelChatCronSettings.enabled) {
        console.log('🤖 [CRON] ⏭️  Model chat generation is disabled. Skipping.');
        return;
      }
      
      // Get all available models
      const modelsCollection = db.collection('myModels');
      const models = await modelsCollection.find({}).toArray();
      
      console.log(`🤖 [CRON] 📊 Found ${models.length} models to process`);
      
      // Find an admin user to use for image generation
      const usersCollection = db.collection('users');
      const adminUser = await usersCollection.findOne({ role: 'admin' });
      
      if (!adminUser) {
        console.log('🤖 [CRON] ⚠️  No admin user found for automated chat generation');
        return;
      }
      
      // Update last run time
      await settingsCollection.updateOne(
        { type: 'modelChatCron' },
        { $set: { lastRun: new Date() } }
      );
      
      // Create chat for each model
      for (const model of models) {
        try {
          console.log(`🤖 [CRON] 🔄 Processing model: ${model.model}`);
          
          // Get prompt from Civitai with strict exclusion of used/skipped prompts and forbidden words filtering
          const prompt = await fetchRandomCivitaiPrompt(
            model, 
            modelChatCronSettings.nsfw, 
            1, // Start from page 1
            0, // Start from index 0
            true, // excludeUsed = true (critical for cron jobs - strictly exclude used/skipped prompts)
            db
          );
          
          if (!prompt) {
            console.log(`🤖 [CRON] ⚠️  No suitable prompt found for model ${model.model}. Skipping.`);
            continue;
          }
          
          // Create a new chat - Pass admin user for image generation
          const createdChat = await createModelChat(db, model, prompt, 'en', fastify, adminUser, modelChatCronSettings.nsfw);
          
          if (createdChat) {
            console.log(`🤖 [CRON] ✅ Chat created for ${model.model} | ID: ${createdChat._id}`);
          } else {
            console.log(`🤖 [CRON] ❌ Failed to create chat for ${model.model}`);
          }
          
          // Wait a bit between requests to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (modelError) {
          console.error(`🤖 [CRON] ❌ Error processing model ${model.model}:`, modelError);
          // Continue with next model
        }
      }
      
      console.log('🤖 [CRON] ✅ Model chat generation completed');
    } catch (err) {
      console.error('🤖 [CRON] ❌ Failed to execute model chat generation:', err);
    }
  };
};

/**
 * Process background image generation tasks
 * Note: Polling has been removed - tasks are now completed via webhooks
 * This function is kept for backward compatibility but is essentially a no-op
 * @param {Object} fastify - Fastify instance
 */
const processBackgroundTasks = (fastify) => async () => {
  // Webhooks handle task completion now - no polling needed
  // This function is kept to avoid breaking existing cron configurations
  // but can be removed or used for cleanup tasks in the future
  return;
};

/**
 * Process background video generation tasks
 * Note: Polling has been removed - tasks are now completed via webhooks
 * This function is kept for backward compatibility but is essentially a no-op
 * @param {Object} fastify - Fastify instance
 */
const processBackgroundVideoTasks = (fastify) => async () => {
  // Webhooks handle task completion now - no polling needed
  // This function is kept to avoid breaking existing cron configurations
  // but can be removed or used for cleanup tasks in the future
  return;
};

/**
 * Cache popular chats task
 * Fetches top popular chats and stores them in a cache collection, including up to 5 non-NSFW sample images per chat.
 * @param {Object} fastify - Fastify instance
 */
const cachePopularChatsTask = (fastify) => async () => {
  console.log('\n⭐ [CRON] ▶️  Starting popular chats caching task...');
  const db = fastify.mongo.db;
  const chatsCollection = db.collection('chats');
  const cacheCollection = db.collection('popularChatsCache');
  const usersCollection = db.collection('users');
  const galleryCollection = db.collection('gallery');

  const pagesToCache = 100;
  const limitPerPage = 50;
  const totalToCache = pagesToCache * limitPerPage;

  try {
    // Get all distinct languages in the database
    const languages = await chatsCollection.distinct('language', {
      chatImageUrl: { $exists: true, $ne: '' },
      name: { $exists: true, $ne: '' }
    });

    console.log(`⭐ [CRON] Found ${languages.length} languages to cache:`, languages);

    // Clear the entire cache collection first
    await cacheCollection.deleteMany({});

    let totalCached = 0;

    // Build cache for each language separately
    for (const language of languages) {
      console.log(`⭐ [CRON] Building cache for language: ${language}`);

      const pipeline = [
        { $match: { chatImageUrl: { $exists: true, $ne: '' }, name: { $exists: true, $ne: '' }, language } },
        {
          $lookup: {
            from: 'gallery',
            localField: '_id',
            foreignField: 'chatId',
            as: 'gallery'
          }
        },
        {
          $addFields: {
            imageCount: {
              $cond: [
                { $gt: [ { $size: '$gallery' }, 0 ] },
                { $size: { $ifNull: [ { $arrayElemAt: [ '$gallery.images', 0 ] }, [] ] } },
                0
              ]
            }
          }
        },
        { $sort: { imageCount: -1, _id: -1 } },
        { $limit: totalToCache },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'userInfo'
          }
        },
        {
          $addFields: {
            userInfo: { $arrayElemAt: ['$userInfo', 0] }
          }
        },
        {
          $addFields: {
            nickname: '$userInfo.nickname',
            profileUrl: '$userInfo.profileUrl',
            premium: '$userInfo.subscriptionStatus',
          }
        },
        {
          $project: {
            _id: 1,
            name: 1,
            chatImageUrl: 1,
            imageCount: 1,
            imageStyle: 1,
            userId: 1,
            nickname: 1,
            gender: 1,
            profileUrl: 1,
            tags: 1,
            chatTags: 1,
            messagesCount: 1,
            premium: { $cond: [ { $eq: ['$premium', 'active'] }, true, false ] },
            nsfw: 1,
            moderation: 1,
            language: 1
          }
        }
      ];

      const popularChats = await chatsCollection.aggregate(pipeline).toArray();

      if (popularChats.length > 0) {
        // For each chat, fetch up to 5 non-NSFW sample images from the gallery
        const chatsWithSamples = await Promise.all(popularChats.map(async (chat) => {
          const galleryDoc = await galleryCollection.findOne({ chatId: chat._id });
          let sampleImages = [];
          if (galleryDoc && Array.isArray(galleryDoc.images)) {
            // Filter out NSFW images (assuming each image has an 'nsfw' boolean property)
            sampleImages = galleryDoc.images.filter(img => !img.nsfw).slice(0, 5);
          }
          return {
            ...chat,
            sampleImages,
          };
        }));

        // Create cache entries with language-specific ranking
        const chatsToInsert = chatsWithSamples.map((chat, index) => ({
          ...chat,
          cacheRank: index, // Rank within this language
          language: language, // Ensure language is set
          cachedAt: new Date()
        }));

        await cacheCollection.insertMany(chatsToInsert);
        console.log(`⭐ [CRON] ✅ Cached ${chatsWithSamples.length} popular chats for language: ${language}`);
        totalCached += chatsWithSamples.length;
      } else {
        console.log(`⭐ [CRON] ℹ️  No popular chats found for language: ${language}`);
      }
    }

    console.log(`⭐ [CRON] ✅ Total chats cached across all languages: ${totalCached}`);

  } catch (err) {
    console.error('⭐ [CRON] ❌ Error caching popular chats:', err.message);
  }
};

/**
 * Cache sitemap data task (characters and tags for SEO)
 * @param {Object} fastify - Fastify instance
 */
const cacheSitemapDataTask = (fastify) => async () => {
  console.log('\n🗺️  [CRON] ▶️  Starting sitemap data caching task...');
  const db = fastify.mongo.db;
  
  try {
    // Check if the database is accessible
    await db.command({ ping: 1 });
    
    await cacheSitemapData(db);
    console.log('🗺️  [CRON] ✅ Sitemap data caching completed successfully');
  } catch (err) {
    console.error('🗺️  [CRON] ❌ Error caching sitemap data:', err.message);
  }
};

/**
 * Cache query tags task
 * Builds and persists a ranked list of query tags (min length 10, top 50)
 */
const cacheQueryTagsTask = (fastify) => async () => {
  console.log('\n🏷️  [CRON] ▶️  Starting query tags caching task...');
  const db = fastify.mongo.db;
  try {
    await db.command({ ping: 1 });
    const docs = await persistQueryTags(db, 10, 50);
    if (docs && docs.length) {
      console.log(`🏷️  [CRON] ✅ Persisted ${docs.length} query tags`);
    } else {
      console.log('🏷️  [CRON] ℹ️  No query tags found to persist');
    }
  } catch (err) {
    console.error('🏷️  [CRON] ❌ Error caching query tags:', err.message || err);
  }
};

/**
 * Analytics cache update task
 * Fetches and caches dashboard analytics data
 * @param {Object} fastify - Fastify instance
 */
const createAnalyticsCacheTask = (fastify) => {
  return async () => {
    console.log('\n📊 [CRON] ▶️  Starting analytics cache update...');
    const db = fastify.mongo.db;
    
    try {
      // Check if the database is accessible
      await db.command({ ping: 1 });
      
      await updateAnalyticsCache(db);
      console.log('📊 [CRON] ✅ Analytics cache updated successfully\n');
    } catch (err) {
      console.error('📊 [CRON] ❌ Error updating analytics cache:', err.message);
    }
  };
};

/**
 * Check and process expired day passes
 * Note: The checkExpiredDayPasses function itself is defined in plan.js
 * This wrapper imports and executes it with proper logging
 * @param {Function} checkExpiredDayPasses - The function from plan.js
 * @param {Object} fastify - Fastify instance
 */
const checkExpiredDayPassesTask = (checkExpiredDayPasses, fastify) => async () => {
  console.log('\n💳 [CRON] ▶️  Starting day pass expiration check...');
  try {
    await checkExpiredDayPasses(fastify);
    console.log('💳 [CRON] ✅ Day pass expiration check completed');
  } catch (err) {
    console.error('💳 [CRON] ❌ Error checking expired day passes:', err.message);
  }
};

/**
 * User preferences analyzer task
 * Analyzes user behavior (likes, chats, favorites) to personalize explore gallery
 * @param {Object} fastify - Fastify instance
 */
const createUserPreferencesAnalyzerTask = (fastify) => {
  return async () => {
    console.log('\n🔍 [CRON] ▶️  Starting user preferences analyzer...');
    const db = fastify.mongo.db;
    
    try {
      // Check if the database is accessible
      await db.command({ ping: 1 });
      
      await runNightlyPreferencesAnalysis(db);
      console.log('🔍 [CRON] ✅ User preferences analysis completed\n');
    } catch (err) {
      console.error('🔍 [CRON] ❌ Error analyzing user preferences:', err.message);
    }
  };
};

/**
 * Initialize day pass expiration check cron job
 * @param {Object} fastify - Fastify instance
 * @param {Function} checkExpiredDayPasses - The function from plan.js
 */
const initializeDayPassExpirationCheck = (fastify, checkExpiredDayPasses) => {
  try {
    // Add day pass expiration check (every hour)
    configureCronJob(
      'dayPassExpirationCheck',
      '0 * * * *', // Runs every hour
      true,
      checkExpiredDayPassesTask(checkExpiredDayPasses, fastify)
    );
    console.log('💳 [CRON] ✅ Day pass expiration check job configured');
  } catch (error) {
    console.error('💳 [CRON] ❌ Error initializing day pass expiration check:', error);
  }
};

/**
 * Run task recovery on server startup
 * Recovers unfinished image and video generation tasks
 * 
 * @param {Object} fastify - Fastify instance
 */
const runStartupTaskRecovery = async (fastify) => {
  try {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║      🔄 RUNNING STARTUP TASK RECOVERY                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    
    // Run task recovery
    const stats = await recoverUnfinishedTasks(fastify);
    
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║      ✅ STARTUP TASK RECOVERY COMPLETED                  ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    
  } catch (error) {
    console.error('🔄 [STARTUP RECOVERY] ❌ Error during startup task recovery:', error);
  }
};

/**
 * Initialize cron jobs from database settings
 * 
 * @param {Object} fastify - Fastify instance
 */
const initializeCronJobs = async (fastify) => {
  try {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║          🚀 INITIALIZING CRON JOBS                       ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    
    const db = fastify.mongo.db;
    const settingsCollection = db.collection('systemSettings');
     
    // Initialize model chat generation cron job
    let modelChatCronSettings = await settingsCollection.findOne({ type: 'modelChatCron' });
    
    if (!modelChatCronSettings) {
      // Create default settings if they don't exist
      modelChatCronSettings = {
        type: 'modelChatCron',
        schedule: '0 */2 * * *', // Every 2 hours
        enabled: false,
        nsfw: false,
        createdAt: new Date()
      };
      
      await settingsCollection.insertOne(modelChatCronSettings);
      console.log('⚙️  [CRON] Created default model chat cron settings');
    }
    
    // Configure the cron job if enabled
    const modelChatGenerationTask = createModelChatGenerationTask(fastify);
    
    configureCronJob(
      'modelChatGenerator', 
      modelChatCronSettings.schedule, 
      modelChatCronSettings.enabled,
      modelChatGenerationTask
    );

    // Background task processors disabled - webhooks handle task completion
    // Keeping functions defined but not scheduling them
    // configureCronJob(
    //   'backgroundTaskProcessor',
    //   '*/10 * * * * *',
    //   false, // Disabled - webhooks handle completion
    //   processBackgroundTasks(fastify)
    // );

    // configureCronJob(
    //   'videoBackgroundTaskProcessor',
    //   '*/20 * * * * *',
    //   false, // Disabled - webhooks handle completion
    //   processBackgroundVideoTasks(fastify)
    // );

    // Add popular chats caching task (daily at 1 AM)
    configureCronJob(
        'popularChatsCacher',
        '0 1 * * *', // Runs every day at 1:00 AM
        true, // Enable this job
        cachePopularChatsTask(fastify)
    );
    // Add query tags caching task (daily at 3 AM)
    configureCronJob(
      'queryTagsCacher',
      '0 3 * * *', // Runs every day at 3:00 AM
      true, // Enable
      cacheQueryTagsTask(fastify)
    );
    // Add audio files cleanup task (runs every 15 minutes)
    configureCronJob(
        'audioFilesCleanup',
        '*/15 * * * *', // Runs every 15 minutes
        true,
        cleanupExpiredAudioFiles(fastify)
    );
    
    // Add sitemap caching task (daily at 2 AM)
    configureCronJob(
        'sitemapDataCacher',
        '0 2 * * *', // Runs every day at 2:00 AM
        true, // Enable this job
        cacheSitemapDataTask(fastify)
    );
    
    // Add analytics cache update task (every hour)
    const analyticsCacheTask = createAnalyticsCacheTask(fastify);
    configureCronJob(
        'analyticsCacheUpdater',
        '0 */5 * * *', // Runs every 5 hours
        true, // Enable this job
        analyticsCacheTask
    );
    
    // Add scheduled tasks processor (every minute)
    const scheduledTasksProcessor = createScheduledTasksProcessor(fastify);
    configureCronJob(
        'scheduledTasksProcessor',
        '* * * * *', // Runs every minute
        true, // Enable this job
        scheduledTasksProcessor
    );
    
    // Add user preferences analyzer task (nightly at 4 AM)
    // Analyzes user likes, chats, and favorites to personalize explore gallery
    const userPreferencesAnalyzerTask = createUserPreferencesAnalyzerTask(fastify);
    configureCronJob(
        'userPreferencesAnalyzer',
        '0 4 * * *', // Runs every day at 4:00 AM
        true, // Enable this job
        userPreferencesAnalyzerTask
    );
    
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║          ✅ ALL CRON JOBS INITIALIZED SUCCESSFULLY       ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    
    // Run task recovery on startup (after all cron jobs are initialized)
    // This runs once immediately to recover any tasks that were interrupted
    // by a server restart
    // Disable to see if duplicates disappear
    await runStartupTaskRecovery(fastify);
    
  } catch (error) {
    console.error('❌ [CRON] Error initializing cron jobs:', error);
  }
};

/**
 * Get the next run time for a job
 * 
 * @param {string} jobName - Name of the job
 * @returns {string|null} - Next run time as a string or null if job not found or disabled
 */
const getNextRunTime = (jobName) => {
  const cronInfo = cronJobs[jobName];
  if (!cronInfo || !cronInfo.enabled || !cronInfo.schedule) return null;
  
  try {
    const interval = parser.parseExpression(cronInfo.schedule);
    return interval.next().toDate().toLocaleString();
  } catch (error) {
    console.error(`[getNextRunTime] Error getting next run time for job '${jobName}':`, error);
    return null;
  }
};

/**
 * Get information about a job
 * 
 * @param {string} jobName - Name of the job
 * @returns {Object|null} - Information about the job or null if not found
 */
const getJobInfo = (jobName) => {
  const cronInfo = cronJobs[jobName];
  if (!cronInfo) return null;
  
  return {
    schedule: cronInfo.schedule,
    enabled: cronInfo.enabled,
    nextRun: getNextRunTime(jobName),
    isRunning: cronInfo.job ? cronInfo.job.running : false
  };
};

module.exports = {
  cronJobs,
  configureCronJob,
  initializeCronJobs,
  initializeDayPassExpirationCheck,
  createModelChatGenerationTask,
  processBackgroundTasks,
  processBackgroundVideoTasks,
  cachePopularChatsTask,
  cacheSitemapDataTask,
  createUserPreferencesAnalyzerTask,
  getJobInfo,
  getNextRunTime,
  runStartupTaskRecovery
};
