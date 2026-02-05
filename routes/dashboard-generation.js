/**
 * Unified Generation Dashboard Routes
 * Mobile-first dashboard for image and video generation
 */

const { checkUserAdmin } = require('../models/tool');
const { getUserPoints } = require('../models/user-points-utils');
const { PRICING_CONFIG } = require('../config/pricing');

// Import model configurations
const { MODEL_CONFIGS: IMAGE_MODEL_CONFIGS } = require('../models/admin-image-test-utils');
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
      
      // Check if user is admin
      const isAdmin = await checkUserAdmin(fastify, user._id);

      // Get user's current points
      const userPoints = await getUserPoints(db, user._id);

      // Load active SD models from database for txt2img
      const activeSDModels = await db.collection('myModels').find({}).toArray();
      const sdModelsForSelection = activeSDModels.map(model => ({
        id: `sd-txt2img-${model.modelId}`,
        modelId: model.modelId,
        name: model.name || model.model,
        sdName: model.model,
        description: `Stable Diffusion ${model.style || ''} model`,
        async: true,
        category: 'txt2img',
        isSDModel: true,
        requiresModel: true,
        modelName: model.model,
        style: model.style,
        baseModel: model.base_model || 'SD 1.5',
        supportedParams: IMAGE_MODEL_CONFIGS['sd-txt2img'].supportedParams,
        defaultParams: IMAGE_MODEL_CONFIGS['sd-txt2img'].defaultParams
      }));

      // Prepare image models list with complete configuration
      const imageModels = [
        // Include all non-SD models
        ...Object.entries(IMAGE_MODEL_CONFIGS)
          .filter(([id, config]) => !config.requiresModel && id !== 'reimagine')
          .map(([id, config]) => ({
            id,
            name: config.name,
            description: config.description || '',
            async: config.async || false,
            category: config.category || 'txt2img',
            supportsImg2Img: config.supportsImg2Img || false,
            requiresImage: config.requiresImage || false,
            requiresTwoImages: config.requiresTwoImages || false,
            supportedParams: config.supportedParams || [],
            defaultParams: config.defaultParams || {},
            sizeFormat: config.sizeFormat || '*' // 'x' for Seedream, '*' for others
          })),
        // Add active SD models
        ...sdModelsForSelection
      ];

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
        videoModels
      });
    } catch (error) {
      console.error('[GenerationDashboard] Error loading dashboard:', error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}

module.exports = routes;
