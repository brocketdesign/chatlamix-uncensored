/**
 * Unified Posts API Routes
 * 
 * Phase 1: Clean Up In-App Posts
 * - Added public posts endpoint for profile viewing
 * - Added profile post creation endpoint
 * - Added visibility update endpoint
 * - Added like/comment endpoints for unified posts
 */

const { ObjectId } = require('mongodb');
const { MODEL_CONFIGS } = require('../models/admin-image-test-utils');

const {
  POST_TYPES,
  POST_SOURCES,
  POST_STATUSES,
  POST_VISIBILITY,
  createPostFromImage,
  createPostFromVideo,
  linkTestToPost,
  getUserPosts,
  getCombinedUserPosts,
  getPublicUserPosts,
  createDraftPostFromImage,
  createProfilePost,
  updatePostStatus,
  schedulePost,
  cancelScheduledPost,
  deletePost,
  getPostById,
  updatePost,
  updatePostVisibility,
  togglePostLike,
  addPostComment,
  checkPostAccess
} = require('../models/unified-post-utils');

const { generateCompletion } = require('../models/openai');

const {
  createSingleSchedule,
  createRecurringSchedule,
  getUserSchedules,
  pauseSchedule,
  resumeSchedule,
  cancelSchedule,
  deleteSchedule,
  getScheduleById,
  updateSchedule,
  getUserScheduleStats,
  ACTION_TYPES,
  SCHEDULE_STATUSES
} = require('../models/scheduling-utils');

async function routes(fastify, options) {
  const db = fastify.mongo.db;

  /**
   * POST /api/posts
   * Create a unified post from dashboard generation
   */
  fastify.post('/api/posts', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { type, ...postData } = request.body;

      if (!type) {
        return reply.code(400).send({ error: 'Post type is required' });
      }

      let post;
      if (type === POST_TYPES.IMAGE) {
        post = await createPostFromImage({ ...postData, userId: user._id }, db);
      } else if (type === POST_TYPES.VIDEO) {
        post = await createPostFromVideo({ ...postData, userId: user._id }, db);
      } else {
        return reply.code(400).send({ error: 'Invalid post type' });
      }

      return reply.code(201).send({
        success: true,
        post
      });
    } catch (error) {
      console.error('[Posts API] Create error:', error);
      return reply.code(500).send({ error: 'Failed to create post' });
    }
  });

  /**
   * POST /api/posts/link
   * Link existing test result to unified post
   */
  fastify.post('/api/posts/link', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { testId, testType } = request.body;

      if (!testId || !testType) {
        return reply.code(400).send({ error: 'testId and testType are required' });
      }

      const post = await linkTestToPost(testId, testType, db);

      return reply.send({
        success: true,
        post
      });
    } catch (error) {
      console.error('[Posts API] Link error:', error);
      return reply.code(500).send({ error: error.message || 'Failed to link test to post' });
    }
  });

  /**
   * GET /api/posts
   * Get user's posts with filters (includes both unified posts and chat posts)
   */
  fastify.get('/api/posts', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const filters = {
        type: request.query.type,
        source: request.query.source,
        status: request.query.status,
        nsfw: request.query.nsfw === 'true' ? true : request.query.nsfw === 'false' ? false : undefined,
        scheduledOnly: request.query.scheduledOnly === 'true',
        page: parseInt(request.query.page) || 1,
        limit: parseInt(request.query.limit) || 20,
        sortBy: request.query.sortBy || 'createdAt',
        sortOrder: request.query.sortOrder === 'asc' ? 1 : -1
      };

      // Use combined posts function to include both unified posts and chat posts
      const result = await getCombinedUserPosts(db, user._id, filters);

      return reply.send({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('[Posts API] Get posts error:', error);
      return reply.code(500).send({ error: 'Failed to get posts' });
    }
  });

  /**
   * POST /api/posts/draft
   * Create a draft post from image dashboard with AI-generated caption
   */
  fastify.post('/api/posts/draft', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { imageUrl, prompt, negativePrompt, model, parameters, testId, generateCaption = true, language } = request.body;

      if (!imageUrl) {
        return reply.code(400).send({ error: 'Image URL is required' });
      }

      let caption = '';
      
      // Generate caption using GPT-4o mini if requested
      if (generateCaption && prompt) {
        try {
          const lang = language || request.lang || 'en';
          const systemPrompt = `You are a social media expert creating engaging captions for AI-generated art.
Create a captivating caption in ${lang === 'ja' ? 'Japanese' : lang === 'fr' ? 'French' : 'English'}.

Guidelines:
- Keep it concise (2-3 sentences max)
- Make it engaging and shareable
- Include 3-5 relevant hashtags at the end
- Reference the artistic/creative nature subtly
- Match the mood and style of the image

Image description: ${prompt}

Return ONLY the caption text with hashtags, nothing else.`;

          const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Generate a social media caption for this AI-generated image.' }
          ];

          caption = await generateCompletion(messages, 200, 'gpt-4o-mini', lang);
          caption = caption?.trim() || '';
          
          console.log(`[Posts API] Generated caption for draft post: ${caption.substring(0, 50)}...`);
        } catch (captionError) {
          console.error('[Posts API] Error generating caption:', captionError);
          // Continue without caption
        }
      }

      // Create draft post
      const post = await createDraftPostFromImage({
        userId: user._id,
        testId,
        imageUrl,
        prompt,
        negativePrompt,
        caption,
        model,
        parameters,
        nsfw: false
      }, db);

      return reply.code(201).send({
        success: true,
        post,
        caption
      });
    } catch (error) {
      console.error('[Posts API] Create draft error:', error);
      return reply.code(500).send({ error: 'Failed to create draft post' });
    }
  });

  /**
   * POST /api/posts/generate-caption
   * Generate caption for an existing post
   */
  fastify.post('/api/posts/generate-caption', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { prompt, platform = 'general', style = 'engaging', language, existingCaption } = request.body;

      if (!prompt) {
        return reply.code(400).send({ error: 'Prompt/image description is required' });
      }

      // Map language names to language codes
      const languageMap = {
        'english': 'en',
        'japanese': 'ja',
        'french': 'fr',
        'portuguese': 'pt',
        'spanish': 'es',
        'chinese': 'zh',
        'korean': 'ko',
        'thai': 'th',
        'german': 'de',
        'italian': 'it',
        'russian': 'ru',
        'hindi': 'hi'
      };

      const languageCode = languageMap[language] || language || request.lang || 'en';
      
      // Language names for system prompt
      const languageNames = {
        'en': 'English',
        'ja': 'Japanese',
        'fr': 'French',
        'pt': 'Portuguese',
        'es': 'Spanish',
        'zh': 'Chinese',
        'ko': 'Korean',
        'th': 'Thai',
        'de': 'German',
        'it': 'Italian',
        'ru': 'Russian',
        'hi': 'Hindi'
      };

      const languageName = languageNames[languageCode] || 'English';
      
      // Build system prompt based on whether we have an existing caption
      let systemPrompt;
      if (existingCaption) {
        systemPrompt = `You are a social media expert improving captions for ${platform === 'instagram' ? 'Instagram' : platform === 'twitter' ? 'X/Twitter' : 'social media'}.
Enhance the existing caption to be more ${style} while keeping it in ${languageName}.

Guidelines:
- Keep the core message and meaning from the existing caption
- Make it more ${style} in tone and style
- Keep it concise and engaging
- Include 3-5 relevant hashtags at the end
- Match the tone to the platform${platform === 'instagram' ? ' (visual, aesthetic, longer captions OK)' : platform === 'twitter' ? ' (witty, conversational, under 280 chars)' : ''}
- Make it shareable

Existing caption: ${existingCaption}

Image context: ${prompt}

Return ONLY the improved caption text with hashtags, nothing else.`;
      } else {
        systemPrompt = `You are a social media expert creating captions for ${platform === 'instagram' ? 'Instagram' : platform === 'twitter' ? 'X/Twitter' : 'social media'}.
Create a ${style} caption in ${languageName}.

Guidelines:
- Keep it concise and engaging
- Include 3-5 relevant hashtags at the end
- Match the tone to the platform${platform === 'instagram' ? ' (visual, aesthetic, longer captions OK)' : platform === 'twitter' ? ' (witty, conversational, under 280 chars)' : ''}
- Reference AI-generated art subtly
- Make it shareable

Image context: ${prompt}

Return ONLY the caption text with hashtags, nothing else.`;
      }

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: existingCaption ? 'Improve this caption.' : 'Generate a social media caption for this image.' }
      ];

      const caption = await generateCompletion(messages, 200, 'gpt-4o-mini', languageCode);

      return reply.send({
        success: true,
        caption: caption?.trim() || '',
        platform,
        language: languageCode
      });
    } catch (error) {
      console.error('[Posts API] Caption generation error:', error);
      return reply.code(500).send({ error: 'Failed to generate caption' });
    }
  });

  /**
   * GET /api/posts/:postId
   * Get a single post by ID
   */
  fastify.get('/api/posts/:postId', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { postId } = request.params;
      const post = await getPostById(postId, db);

      if (!post) {
        return reply.code(404).send({ error: 'Post not found' });
      }

      // Verify ownership
      if (post.userId.toString() !== user._id.toString()) {
        return reply.code(403).send({ error: 'Not authorized' });
      }

      return reply.send({
        success: true,
        post
      });
    } catch (error) {
      console.error('[Posts API] Get post error:', error);
      return reply.code(500).send({ error: 'Failed to get post' });
    }
  });

  /**
   * PUT /api/posts/:postId
   * Update a post
   */
  fastify.put('/api/posts/:postId', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { postId } = request.params;
      
      // Verify ownership
      const post = await getPostById(postId, db);
      if (!post) {
        return reply.code(404).send({ error: 'Post not found' });
      }
      if (post.userId.toString() !== user._id.toString()) {
        return reply.code(403).send({ error: 'Not authorized' });
      }

      await updatePost(postId, request.body, db);

      return reply.send({
        success: true,
        message: 'Post updated'
      });
    } catch (error) {
      console.error('[Posts API] Update error:', error);
      return reply.code(500).send({ error: 'Failed to update post' });
    }
  });

  /**
   * DELETE /api/posts/:postId
   * Delete a post
   */
  fastify.delete('/api/posts/:postId', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { postId } = request.params;
      const deleted = await deletePost(postId, user._id, db);

      if (!deleted) {
        return reply.code(404).send({ error: 'Post not found or not authorized' });
      }

      return reply.send({
        success: true,
        message: 'Post deleted'
      });
    } catch (error) {
      console.error('[Posts API] Delete error:', error);
      return reply.code(500).send({ error: 'Failed to delete post' });
    }
  });

  /**
   * POST /api/posts/:postId/schedule
   * Schedule a post for publishing
   */
  fastify.post('/api/posts/:postId/schedule', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { postId } = request.params;
      const { scheduledFor } = request.body;

      if (!scheduledFor) {
        return reply.code(400).send({ error: 'scheduledFor is required' });
      }

      // Verify ownership
      const post = await getPostById(postId, db);
      if (!post) {
        return reply.code(404).send({ error: 'Post not found' });
      }
      if (post.userId.toString() !== user._id.toString()) {
        return reply.code(403).send({ error: 'Not authorized' });
      }

      await schedulePost(postId, scheduledFor, db);

      return reply.send({
        success: true,
        message: 'Post scheduled'
      });
    } catch (error) {
      console.error('[Posts API] Schedule error:', error);
      return reply.code(500).send({ error: 'Failed to schedule post' });
    }
  });

  /**
   * POST /api/posts/:postId/publish
   * Publish a post immediately
   */
  fastify.post('/api/posts/:postId/publish', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { postId } = request.params;

      // Verify ownership
      const post = await getPostById(postId, db);
      if (!post) {
        return reply.code(404).send({ error: 'Post not found' });
      }
      if (post.userId.toString() !== user._id.toString()) {
        return reply.code(403).send({ error: 'Not authorized' });
      }

      // Update post status to published
      await updatePostStatus(postId, POST_STATUSES.PUBLISHED, db);

      return reply.send({
        success: true,
        message: 'Post published'
      });
    } catch (error) {
      console.error('[Posts API] Publish error:', error);
      return reply.code(500).send({ error: 'Failed to publish post' });
    }
  });

  /**
   * POST /api/posts/:postId/cancel-schedule
   * Cancel scheduled post
   */
  fastify.post('/api/posts/:postId/cancel-schedule', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { postId } = request.params;

      // Verify ownership
      const post = await getPostById(postId, db);
      if (!post) {
        return reply.code(404).send({ error: 'Post not found' });
      }
      if (post.userId.toString() !== user._id.toString()) {
        return reply.code(403).send({ error: 'Not authorized' });
      }

      await cancelScheduledPost(postId, db);

      return reply.send({
        success: true,
        message: 'Schedule cancelled'
      });
    } catch (error) {
      console.error('[Posts API] Cancel schedule error:', error);
      return reply.code(500).send({ error: 'Failed to cancel schedule' });
    }
  });

  /**
   * POST /api/schedules
   * Create a new schedule (single or recurring)
   */
  fastify.post('/api/schedules', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { type, ...scheduleData } = request.body;

      if (!type) {
        return reply.code(400).send({ error: 'Schedule type is required' });
      }

      let schedule;
      if (type === 'single') {
        schedule = await createSingleSchedule({ ...scheduleData, userId: user._id }, db);
      } else if (type === 'recurring') {
        schedule = await createRecurringSchedule({ ...scheduleData, userId: user._id }, db);
      } else {
        return reply.code(400).send({ error: 'Invalid schedule type' });
      }

      return reply.code(201).send({
        success: true,
        schedule
      });
    } catch (error) {
      console.error('[Schedules API] Create error:', error);
      return reply.code(500).send({ error: error.message || 'Failed to create schedule' });
    }
  });

  /**
   * GET /api/schedules
   * Get user's schedules
   */
  fastify.get('/api/schedules', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }

      const filters = {
        type: request.query.type,
        status: request.query.status,
        actionType: request.query.actionType,
        page: parseInt(request.query.page) || 1,
        limit: parseInt(request.query.limit) || 20
      };

      const result = await getUserSchedules(db, user._id, filters);

      return reply.send({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('[Schedules API] Get schedules error:', error);
      return reply.code(500).send({ success: false, error: 'Failed to get schedules' });
    }
  });

  /**
   * GET /api/schedules/stats
   * Get schedule statistics
   */
  fastify.get('/api/schedules/stats', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }

      const stats = await getUserScheduleStats(user._id, db);

      return reply.send({
        success: true,
        stats
      });
    } catch (error) {
      console.error('[Schedules API] Get stats error:', error);
      return reply.code(500).send({ success: false, error: 'Failed to get statistics' });
    }
  });

  /**
   * GET /api/schedules/:scheduleId
   * Get a single schedule
   */
  fastify.get('/api/schedules/:scheduleId', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }

      const { scheduleId } = request.params;

      // Validate scheduleId is a valid ObjectId
      if (!ObjectId.isValid(scheduleId)) {
        return reply.code(400).send({ success: false, error: 'Invalid schedule ID' });
      }

      const schedule = await getScheduleById(scheduleId, db);

      if (!schedule) {
        return reply.code(404).send({ success: false, error: 'Schedule not found' });
      }

      // Verify ownership
      if (schedule.userId.toString() !== user._id.toString()) {
        return reply.code(403).send({ success: false, error: 'Not authorized' });
      }

      return reply.send({
        success: true,
        schedule
      });
    } catch (error) {
      console.error('[Schedules API] Get schedule error:', error);
      return reply.code(500).send({ success: false, error: 'Failed to get schedule' });
    }
  });

  /**
   * PUT /api/schedules/:scheduleId
   * Update a schedule
   */
  fastify.put('/api/schedules/:scheduleId', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }

      const { scheduleId } = request.params;

      // Validate scheduleId is a valid ObjectId
      if (!ObjectId.isValid(scheduleId)) {
        return reply.code(400).send({ success: false, error: 'Invalid schedule ID' });
      }

      // Verify ownership
      const schedule = await getScheduleById(scheduleId, db);
      if (!schedule) {
        return reply.code(404).send({ success: false, error: 'Schedule not found' });
      }
      if (schedule.userId.toString() !== user._id.toString()) {
        return reply.code(403).send({ success: false, error: 'Not authorized' });
      }

      await updateSchedule(scheduleId, request.body, db);

      return reply.send({
        success: true,
        message: 'Schedule updated'
      });
    } catch (error) {
      console.error('[Schedules API] Update error:', error);
      return reply.code(500).send({ success: false, error: error.message || 'Failed to update schedule' });
    }
  });

  /**
   * POST /api/schedules/:scheduleId/pause
   * Pause a recurring schedule
   */
  fastify.post('/api/schedules/:scheduleId/pause', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }

      const { scheduleId } = request.params;

      // Validate scheduleId is a valid ObjectId
      if (!ObjectId.isValid(scheduleId)) {
        return reply.code(400).send({ success: false, error: 'Invalid schedule ID' });
      }

      // Verify ownership
      const schedule = await getScheduleById(scheduleId, db);
      if (!schedule) {
        return reply.code(404).send({ success: false, error: 'Schedule not found' });
      }
      if (schedule.userId.toString() !== user._id.toString()) {
        return reply.code(403).send({ success: false, error: 'Not authorized' });
      }

      await pauseSchedule(scheduleId, db);

      return reply.send({
        success: true,
        message: 'Schedule paused'
      });
    } catch (error) {
      console.error('[Schedules API] Pause error:', error);
      return reply.code(500).send({ success: false, error: 'Failed to pause schedule' });
    }
  });

  /**
   * POST /api/schedules/:scheduleId/resume
   * Resume a paused schedule
   */
  fastify.post('/api/schedules/:scheduleId/resume', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }

      const { scheduleId } = request.params;

      // Validate scheduleId is a valid ObjectId
      if (!ObjectId.isValid(scheduleId)) {
        return reply.code(400).send({ success: false, error: 'Invalid schedule ID' });
      }

      // Verify ownership
      const schedule = await getScheduleById(scheduleId, db);
      if (!schedule) {
        return reply.code(404).send({ success: false, error: 'Schedule not found' });
      }
      if (schedule.userId.toString() !== user._id.toString()) {
        return reply.code(403).send({ success: false, error: 'Not authorized' });
      }

      await resumeSchedule(scheduleId, db);

      return reply.send({
        success: true,
        message: 'Schedule resumed'
      });
    } catch (error) {
      console.error('[Schedules API] Resume error:', error);
      return reply.code(500).send({ success: false, error: error.message || 'Failed to resume schedule' });
    }
  });

  /**
   * POST /api/schedules/:scheduleId/cancel
   * Cancel a schedule
   */
  fastify.post('/api/schedules/:scheduleId/cancel', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }

      const { scheduleId } = request.params;

      // Validate scheduleId is a valid ObjectId
      if (!ObjectId.isValid(scheduleId)) {
        return reply.code(400).send({ success: false, error: 'Invalid schedule ID' });
      }

      const cancelled = await cancelSchedule(scheduleId, user._id, db);

      if (!cancelled) {
        return reply.code(404).send({ success: false, error: 'Schedule not found or not authorized' });
      }

      return reply.send({
        success: true,
        message: 'Schedule cancelled'
      });
    } catch (error) {
      console.error('[Schedules API] Cancel error:', error);
      return reply.code(500).send({ success: false, error: 'Failed to cancel schedule' });
    }
  });

  /**
   * DELETE /api/schedules/:scheduleId
   * Delete a schedule
   */
  fastify.delete('/api/schedules/:scheduleId', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }

      const { scheduleId } = request.params;

      // Validate scheduleId is a valid ObjectId
      if (!ObjectId.isValid(scheduleId)) {
        return reply.code(400).send({ success: false, error: 'Invalid schedule ID' });
      }

      const deleted = await deleteSchedule(scheduleId, user._id, db);

      if (!deleted) {
        return reply.code(404).send({ success: false, error: 'Schedule not found or not authorized' });
      }

      return reply.send({
        success: true,
        message: 'Schedule deleted'
      });
    } catch (error) {
      console.error('[Schedules API] Delete error:', error);
      return reply.code(500).send({ success: false, error: 'Failed to delete schedule' });
    }
  });

  /**
   * POST /api/schedules/test-run
   * Execute a test run of schedule settings without creating a schedule
   * Generates one image with the given parameters and saves it to posts
   */
  fastify.post('/api/schedules/test-run', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { prompt, model, actionType, useCustomPrompts, customPromptIds, characterId } = request.body;

      // Handle custom prompts if selected
      let finalPrompt = prompt || '';
      let selectedCustomPromptId = null;

      if (useCustomPrompts && customPromptIds && customPromptIds.length > 0) {
        // Validate custom prompt IDs
        const validIds = customPromptIds.filter(id => ObjectId.isValid(id));
        if (validIds.length === 0) {
          return reply.code(400).send({ error: 'Invalid custom prompt IDs' });
        }

        // Randomly select one custom prompt from the valid list
        const randomIndex = Math.floor(Math.random() * validIds.length);
        selectedCustomPromptId = validIds[randomIndex];

        // Fetch the custom prompt
        const customPrompt = await db.collection('prompts').findOne({ _id: new ObjectId(selectedCustomPromptId) });
        if (customPrompt) {
          // Use custom prompt - override manual prompt if not provided
          if (!finalPrompt || finalPrompt.trim() === '') {
            finalPrompt = customPrompt.prompt || '';
          }
        }
      }

      // If character is selected, combine character details with prompt
      if (characterId && ObjectId.isValid(characterId)) {
        const characterData = await db.collection('chats').findOne({ _id: new ObjectId(characterId) });
        if (characterData) {
          console.log(`[Schedules API] Test run using character: ${characterData.name}`);

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

          // Combine character details with the prompt
          if (characterDescription || characterName) {
            const characterContext = [];
            if (characterName) characterContext.push(characterName);
            if (characterGender) characterContext.push(characterGender);
            if (appearanceDetails) characterContext.push(appearanceDetails);
            if (characterDescription) characterContext.push(characterDescription);

            const characterPart = characterContext.join(', ');

            // Combine character details with user's prompt
            if (finalPrompt && finalPrompt.trim() !== '') {
              finalPrompt = `${characterPart}, ${finalPrompt}`;
              console.log(`[Schedules API] Combined test prompt with character: ${finalPrompt.substring(0, 100)}...`);
            } else {
              finalPrompt = characterPart;
              console.log(`[Schedules API] Using character description as test prompt: ${finalPrompt.substring(0, 100)}...`);
            }
          }
        }
      }

      if (!finalPrompt || !model) {
        return reply.code(400).send({ error: 'Prompt and model are required' });
      }

      // Only support image generation for now
      if (actionType && actionType !== 'generate_image') {
        return reply.code(400).send({ error: 'Only image generation is supported for test runs' });
      }

      console.log(`[Schedules API] Test run for user ${user._id}: model=${model}, prompt=${finalPrompt.substring(0, 50)}...${useCustomPrompts ? ' (using custom prompt)' : ''}`);

      // Import image generation utilities
      const { initializeModelTest, checkTaskResult, MODEL_CONFIGS } = require('../models/admin-image-test-utils');
      const { createPostFromImage } = require('../models/unified-post-utils');
      const { removeUserPoints, getUserPoints } = require('../models/user-points-utils');
      const { PRICING_CONFIG, getImageGenerationCost } = require('../config/pricing');

      // Check user has enough points
      const userPoints = await getUserPoints(db, user._id);
      const cost = getImageGenerationCost(1);
      
      if (userPoints < cost) {
        return reply.code(402).send({ 
          error: 'Insufficient points',
          required: cost,
          available: userPoints
        });
      }

      // Determine if this is an SD model
      const isSDModel = model.startsWith('sd-');
      let modelName = null;
      let effectiveModelId = model;

      if (isSDModel) {
        // Get the SD model name from database
        const modelId = model.replace('sd-', '');
        const sdModel = await db.collection('myModels').findOne({ modelId: modelId });
        if (!sdModel) {
          return reply.code(400).send({ error: 'SD model not found' });
        }
        modelName = sdModel.model;
        effectiveModelId = 'sd-txt2img';
      }

      // Get model config
      const modelConfig = MODEL_CONFIGS[effectiveModelId];
      if (!modelConfig) {
        return reply.code(400).send({ error: 'Invalid model' });
      }

      // Prepare parameters
      const params = {
        prompt: finalPrompt,
        size: '1024*1024',
        imagesPerModel: 1
      };

      if (modelName) {
        params.model_name = modelName;
      }

      // Initialize the test
      const taskInfo = await initializeModelTest(effectiveModelId, params);

      if (!taskInfo || !taskInfo.taskId) {
        return reply.code(500).send({ error: 'Failed to start image generation' });
      }

      // For async models, poll for result
      let result;
      if (modelConfig.async) {
        // Poll for result (max 60 seconds)
        const maxWaitTime = 60000;
        const pollInterval = 2000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
          result = await checkTaskResult(taskInfo.taskId);
          
          if (result && result.status === 'completed') {
            break;
          }
          
          if (result && result.status === 'failed') {
            return reply.code(500).send({ error: result.error || 'Image generation failed' });
          }

          // Wait before polling again
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        if (!result || result.status !== 'completed') {
          return reply.code(504).send({ error: 'Image generation timed out' });
        }
      } else {
        // Synchronous model - result is already available
        result = taskInfo;
      }

      // Get the image URL - handle both object format {imageUrl: '...'} and direct URL string
      let imageUrl = result.images?.[0];
      if (imageUrl && typeof imageUrl === 'object') {
        imageUrl = imageUrl.imageUrl || imageUrl.image_url || imageUrl.url;
      }
      if (!imageUrl) {
        imageUrl = result.imageUrl;
      }
      
      if (!imageUrl) {
        return reply.code(500).send({ error: 'No image generated' });
      }

      // Deduct points
      await removeUserPoints(db, user._id, cost, 'schedule_test_run');

      // Create a unified post for the generated image
      const post = await createPostFromImage({
        userId: user._id.toString(),
        imageUrl,
        prompt: finalPrompt,
        model: model,
        parameters: params,
        nsfw: false, // Could add NSFW detection here
        visibility: 'private',
        source: 'schedule_test'
      }, db);

      const generationTime = Date.now() - (taskInfo.startTime || Date.now());

      return reply.send({
        success: true,
        imageUrl,
        postId: post._id,
        model,
        generationTimeMs: generationTime,
        pointsUsed: cost,
        pointsRemaining: userPoints - cost
      });

    } catch (error) {
      console.error('[Schedules API] Test run error:', error);
      return reply.code(500).send({ error: error.message || 'Failed to run test' });
    }
  });

  // ============================================
  // Phase 1: Public Posts & Profile Posts APIs
  // ============================================

  /**
   * GET /api/user/:userId/public-posts
   * Get public posts for a user's profile (respects visibility rules)
   * Can be accessed by anyone (logged in or not)
   */
  fastify.get('/api/user/:userId/public-posts', async (request, reply) => {
    try {
      const { userId } = request.params;
      const viewerId = request.user?._id || null;

      const filters = {
        type: request.query.type,
        nsfw: request.query.nsfw === 'true',
        page: parseInt(request.query.page) || 1,
        limit: parseInt(request.query.limit) || 12,
        sortBy: request.query.sortBy || 'createdAt',
        sortOrder: request.query.sortOrder === 'asc' ? 1 : -1
      };

      const result = await getPublicUserPosts(db, userId, viewerId, filters);

      return reply.send({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('[Posts API] Get public posts error:', error);
      return reply.code(500).send({ error: 'Failed to get posts' });
    }
  });

  /**
   * POST /api/posts/create-profile-post
   * Create a new post directly on user's profile
   */
  fastify.post('/api/posts/create-profile-post', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const {
        imageUrl,
        videoUrl,
        thumbnailUrl,
        caption,
        visibility = 'public',
        requiredTier,
        nsfw = false
      } = request.body;

      // Validate that at least one media is provided
      if (!imageUrl && !videoUrl) {
        return reply.code(400).send({ error: 'Either imageUrl or videoUrl is required' });
      }

      // Validate visibility
      if (!Object.values(POST_VISIBILITY).includes(visibility)) {
        return reply.code(400).send({ error: 'Invalid visibility value' });
      }

      const post = await createProfilePost({
        userId: user._id,
        imageUrl,
        videoUrl,
        thumbnailUrl,
        caption,
        visibility,
        requiredTier,
        nsfw
      }, db);

      return reply.code(201).send({
        success: true,
        post
      });
    } catch (error) {
      console.error('[Posts API] Create profile post error:', error);
      return reply.code(500).send({ error: 'Failed to create post' });
    }
  });

  /**
   * PUT /api/posts/:postId/visibility
   * Update post visibility settings
   */
  fastify.put('/api/posts/:postId/visibility', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { postId } = request.params;
      const { visibility, requiredTier } = request.body;

      if (!visibility) {
        return reply.code(400).send({ error: 'Visibility is required' });
      }

      if (!Object.values(POST_VISIBILITY).includes(visibility)) {
        return reply.code(400).send({ error: 'Invalid visibility value' });
      }

      const updated = await updatePostVisibility(postId, user._id, visibility, requiredTier, db);

      if (!updated) {
        return reply.code(404).send({ error: 'Post not found or not authorized' });
      }

      return reply.send({
        success: true,
        message: 'Visibility updated'
      });
    } catch (error) {
      console.error('[Posts API] Update visibility error:', error);
      return reply.code(500).send({ error: error.message || 'Failed to update visibility' });
    }
  });

  /**
   * POST /api/posts/:postId/like
   * Toggle like on a post
   */
  fastify.post('/api/posts/:postId/like', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { postId } = request.params;
      const { action } = request.body; // 'like' or 'unlike'

      if (!action || !['like', 'unlike'].includes(action)) {
        return reply.code(400).send({ error: 'Valid action (like/unlike) is required' });
      }

      // Check if user has access to the post
      const post = await getPostById(postId, db);
      if (!post) {
        return reply.code(404).send({ error: 'Post not found' });
      }

      const access = await checkPostAccess(post, user._id, db);
      if (!access.canAccess) {
        return reply.code(403).send({ error: 'You do not have access to this post' });
      }

      const result = await togglePostLike(postId, user._id, action, db);

      if (!result.success) {
        return reply.code(400).send({ error: result.error });
      }

      return reply.send({
        success: true,
        action: result.action
      });
    } catch (error) {
      console.error('[Posts API] Like toggle error:', error);
      return reply.code(500).send({ error: 'Failed to update like' });
    }
  });

  /**
   * POST /api/posts/:postId/comment
   * Add comment to a post
   */
  fastify.post('/api/posts/:postId/comment', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { postId } = request.params;
      const { comment } = request.body;

      if (!comment || comment.trim().length === 0) {
        return reply.code(400).send({ error: 'Comment is required' });
      }

      // Check if user has access to the post
      const post = await getPostById(postId, db);
      if (!post) {
        return reply.code(404).send({ error: 'Post not found' });
      }

      const access = await checkPostAccess(post, user._id, db);
      if (!access.canAccess) {
        return reply.code(403).send({ error: 'You do not have access to this post' });
      }

      const commentData = await addPostComment(postId, user._id, comment.trim(), db);

      return reply.send({
        success: true,
        comment: commentData
      });
    } catch (error) {
      console.error('[Posts API] Add comment error:', error);
      return reply.code(500).send({ error: 'Failed to add comment' });
    }
  });

  /**
   * PUT /api/posts/:postId/profile-status
   * Toggle whether a post appears on the profile
   */
  fastify.put('/api/posts/:postId/profile-status', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { postId } = request.params;
      const { isProfilePost } = request.body;

      if (typeof isProfilePost !== 'boolean') {
        return reply.code(400).send({ error: 'isProfilePost must be a boolean' });
      }

      // Verify ownership
      const post = await getPostById(postId, db);
      if (!post) {
        return reply.code(404).send({ error: 'Post not found' });
      }
      if (post.userId.toString() !== user._id.toString()) {
        return reply.code(403).send({ error: 'Not authorized' });
      }

      await updatePost(postId, { isProfilePost }, db);

      return reply.send({
        success: true,
        message: isProfilePost ? 'Post added to profile' : 'Post removed from profile'
      });
    } catch (error) {
      console.error('[Posts API] Profile status error:', error);
      return reply.code(500).send({ error: 'Failed to update profile status' });
    }
  });

  /**
   * GET /api/posts/visibility-options
   * Get available visibility options (for UI)
   */
  fastify.get('/api/posts/visibility-options', async (request, reply) => {
    return reply.send({
      success: true,
      options: [
        { value: POST_VISIBILITY.PUBLIC, label: 'Public', description: 'Anyone can see this post' },
        { value: POST_VISIBILITY.FOLLOWERS, label: 'Followers', description: 'Only your followers can see this post' },
        { value: POST_VISIBILITY.SUBSCRIBERS, label: 'Subscribers', description: 'Only your subscribers can see this post' },
        { value: POST_VISIBILITY.PRIVATE, label: 'Private', description: 'Only you can see this post' }
      ]
    });
  });

  /**
   * GET /api/schedules/user-characters
   * Get user's characters for schedule form
   */
  fastify.get('/api/schedules/user-characters', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { ObjectId } = fastify.mongo;
      const userId = user._id.toString();
      const userIdObj = new ObjectId(userId);

      // Pagination and search parameters
      const skip = parseInt(request.query.skip) || 0;
      const limit = Math.min(parseInt(request.query.limit) || 50, 100); // Max 100 per request
      const search = request.query.search ? request.query.search.trim() : '';

      // Fetch user's favorites - check both ObjectId and string formats
      const userFavorites = await db.collection('user_favorites')
        .find({
          $or: [
            { userId: userIdObj },
            { userId: userId }
          ]
        })
        .project({ chatId: 1 })
        .toArray();

      // Create a set of favorite chat IDs (as strings for comparison)
      const favoriteIds = new Set(userFavorites.map(f => f.chatId.toString()));

      // Build query for user's characters
      const baseQuery = {
        $or: [
          { userId: new ObjectId(userId) },
          { userId: userId },
          { creatorId: new ObjectId(userId) },
          { creatorId: userId }
        ]
      };

      // Add search filter if provided
      if (search) {
        baseQuery.name = { $regex: search, $options: 'i' };
      }

      // Get total count for pagination
      const totalCount = await db.collection('chats').countDocuments(baseQuery);

      // Fetch user's characters from chats collection with pagination
      const characters = await db.collection('chats')
        .find(baseQuery)
        .project({
          _id: 1,
          name: 1,
          chatImageUrl: 1,
          imageStyle: 1,
          gender: 1,
          modelId: 1,
          imageModel: 1
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      // Collect unique modelIds that need name lookup
      const modelIdsToLookup = new Set();
      characters.forEach(char => {
        const modelId = char.modelId || char.imageModel;
        if (modelId && !MODEL_CONFIGS[modelId]) {
          modelIdsToLookup.add(modelId);
        }
      });

      // Look up custom model names from myModels collection
      let customModelNames = {};
      if (modelIdsToLookup.size > 0) {
        const customModels = await db.collection('myModels')
          .find({ modelId: { $in: Array.from(modelIdsToLookup) } })
          .project({ modelId: 1, name: 1 })
          .toArray();
        customModels.forEach(m => {
          customModelNames[m.modelId] = m.name;
        });
      }

      // Helper to get model name
      const getModelName = (modelId) => {
        if (!modelId) return null;
        // First check MODEL_CONFIGS
        if (MODEL_CONFIGS[modelId]) {
          return MODEL_CONFIGS[modelId].name;
        }
        // Then check custom models from DB
        if (customModelNames[modelId]) {
          return customModelNames[modelId];
        }
        // Fallback to modelId itself
        return modelId;
      };

      // Map characters and add isFavorite flag
      const mappedCharacters = characters.map(char => {
        const modelId = char.modelId || null;
        // imageModel is the model name, use it directly if available
        // Otherwise look up the name from modelId
        const modelName = char.imageModel || getModelName(modelId);
        return {
          id: char._id.toString(),
          name: char.name || 'Unnamed Character',
          imageUrl: char.chatImageUrl || null,
          imageStyle: char.imageStyle || null,
          gender: char.gender || null,
          modelId: modelId,
          modelName: modelName,
          isFavorite: favoriteIds.has(char._id.toString())
        };
      });
      
      // Sort: favorites first, then by name (only for first page without search)
      // For subsequent pages or search results, maintain database order for consistency
      if (skip === 0 && !search) {
        mappedCharacters.sort((a, b) => {
          if (a.isFavorite && !b.isFavorite) return -1;
          if (!a.isFavorite && b.isFavorite) return 1;
          return (a.name || '').localeCompare(b.name || '');
        });
      }

      return reply.send({
        success: true,
        characters: mappedCharacters,
        pagination: {
          skip: skip,
          limit: limit,
          total: totalCount,
          hasMore: skip + characters.length < totalCount
        }
      });
    } catch (error) {
      console.error('[Schedules API] Get characters error:', error);
      return reply.code(500).send({ error: 'Failed to get characters' });
    }
  });

  /**
   * GET /api/schedules/custom-prompts
   * Get all custom prompts for schedule form
   */
  fastify.get('/api/schedules/custom-prompts', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Fetch custom prompts with a reasonable limit
      const limit = parseInt(request.query.limit) || 100;
      const customPrompts = await db.collection('prompts')
        .find({})
        .project({
          _id: 1,
          prompt: 1,
          title: 1,
          cost: 1,
          order: 1,
          image: 1,
          imagePreview: 1,
          nsfw: 1
        })
        .sort({ order: 1 })
        .limit(Math.min(limit, 200)) // Cap at 200 to prevent excessive queries
        .toArray();

      return reply.send({
        success: true,
        prompts: customPrompts.map(prompt => ({
          id: prompt._id.toString(),
          description: prompt.prompt,
          title: prompt.title,
          cost: prompt.cost || 0,
          // Use 'image' field (the actual field name in DB), fallback to imagePreview for compatibility
          imagePreview: prompt.image || prompt.imagePreview,
          nsfw: prompt.nsfw || false
        }))
      });
    } catch (error) {
      console.error('[Schedules API] Get custom prompts error:', error);
      return reply.code(500).send({ error: 'Failed to get custom prompts' });
    }
  });
}

module.exports = routes;
