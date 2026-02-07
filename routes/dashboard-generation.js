/**
 * Unified Generation Dashboard Routes
 * Mobile-first dashboard for image and video generation
 */

const { ObjectId } = require('mongodb');
const { checkUserAdmin } = require('../models/tool');
const { getUserPoints } = require('../models/user-points-utils');
const { PRICING_CONFIG } = require('../config/pricing');

// Import model configurations
const { buildImageModelsList } = require('../models/admin-image-test-utils');
const { VIDEO_MODEL_CONFIGS } = require('../models/dashboard-video-utils');

async function routes(fastify, options) {
  
  /**
   * GET /dashboard/generation
   * Render the unified generation dashboard
   */
  fastify.get('/dashboard/generation', async (request, reply) => {
    try {
      const user = request.user;
      
      if (!user) {
        return reply.redirect('/login');
      }

      const db = fastify.mongo.db;
      const translations = request.translations;
      const { characterId, mode } = request.query;
      const initialMode = (mode === 'video') ? 'video' : 'image';
      
      // Check if user is admin
      const isAdmin = await checkUserAdmin(fastify, user._id);

      // Get user's current points
      const userPoints = await getUserPoints(db, user._id);

      // Fetch user's characters for the character selector
      // Characters are chats that have a chatImageUrl (profile image) and a name set
      const userCharacters = await db.collection('chats')
        .find({ 
          userId: new ObjectId(user._id),
          chatImageUrl: { $exists: true, $nin: [null, ''] },
          name: { $exists: true, $nin: [null, ''] }
        })
        .project({
          _id: 1,
          name: 1,
          chatImageUrl: 1,
          faceImageUrl: 1,
          basePromptForImageGeneration: 1,
          nsfw: 1
        })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();

      // If characterId is provided, fetch that character's details
      let selectedCharacter = null;
      if (characterId && ObjectId.isValid(characterId)) {
        selectedCharacter = await db.collection('chats').findOne({
          _id: new ObjectId(characterId),
          userId: new ObjectId(user._id)
        });
      }

      // Prepare image models list with complete configuration
      const imageModels = await buildImageModelsList(db);

      // Prepare video models list with complete configuration
      const videoModels = Object.entries(VIDEO_MODEL_CONFIGS).map(([id, config]) => ({
        id,
        name: config.name,
        description: config.description || '',
        async: config.async || false,
        category: config.category || 'i2v',
        supportedParams: config.supportedParams || [],
        defaultParams: config.defaultParams || {},
        provider: config.provider || 'novita', // novita or segmind
        requiresImage: config.category === 'i2v' || config.category === 'face',
        requiresFaceImage: config.category === 'face'
      }));

      return reply.view('/dashboard/generation', {
        title: 'AI Generation Dashboard',
        user,
        translations,
        isAdmin,
        userPoints,
        imageCostPerUnit: PRICING_CONFIG.IMAGE_GENERATION?.BASE_COST_PER_IMAGE || 10,
        videoCostPerUnit: PRICING_CONFIG.VIDEO_GENERATION?.COST || 100,
        faceMergeCost: PRICING_CONFIG.FACE_MERGE?.COST || 20,
        imageModels,
        videoModels,
        userCharacters,
        selectedCharacter,
        selectedCharacterId: characterId || null,
        initialMode
      });
    } catch (error) {
      console.error('[GenerationDashboard] Error loading dashboard:', error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}

module.exports = routes;
