/**
 * Admin Image Model Testing Utilities
 * Supports testing multiple Novita AI image generation models:
 * - Z Image Turbo
 * - Flux 2 Flex
 * - Hunyuan Image 3
 * - Seedream 4.5
 */

const axios = require('axios');
const { ObjectId } = require('mongodb');
const { createHash } = require('crypto');
const { uploadImage } = require('./tool');

// NSFW keywords for content detection
const NSFW_KEYWORDS = [
  'nsfw', 'nude', 'naked', 'nudity', 'explicit', 'sexual', 'erotic', 'erotica',
  'porn', 'xxx', 'adult', 'hentai', 'lewd', 'topless', 'bottomless',
  'breast', 'breasts', 'boob', 'boobs', 'nipple', 'nipples',
  'pussy', 'vagina', 'penis', 'cock', 'dick', 'ass', 'butt',
  'sex', 'intercourse', 'penetration', 'orgasm', 'cum', 'cumshot',
  'masturbat', 'fingering', 'blowjob', 'oral', 'anal', 'dildo', 'vibrator',
  'bondage', 'bdsm', 'fetish', 'dominat', 'submissive',
  'uncensored', 'exposed', 'revealing', 'spread', 'spreading'
];

/**
 * Check if a prompt contains NSFW content
 * @param {string} prompt - The prompt text to check
 * @returns {boolean} - True if NSFW content detected
 */
function isNSFWPrompt(prompt) {
  if (!prompt) return false;
  const lowerPrompt = prompt.toLowerCase();
  return NSFW_KEYWORDS.some(keyword => lowerPrompt.includes(keyword));
}

/**
 * Build image model list for selection UIs (dashboard/chat).
 * Includes system models plus active SD models from DB.
 * @param {import('mongodb').Db} db
 * @returns {Promise<Array>} image models list
 */
async function buildImageModelsList(db) {
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
    supportedParams: MODEL_CONFIGS['sd-txt2img'].supportedParams,
    defaultParams: MODEL_CONFIGS['sd-txt2img'].defaultParams
  }));

  return [
    ...Object.entries(MODEL_CONFIGS)
      .filter(([id, config]) => !config.requiresModel)
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
        sizeFormat: config.sizeFormat || '*'
      })),
    ...sdModelsForSelection
  ];
}

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

// Model configurations with their API endpoints and parameters
const MODEL_CONFIGS = {
  'z-image-turbo': {
    name: 'Z Image Turbo',
    endpoint: 'https://api.novita.ai/v3/async/z-image-turbo',
    async: true,
    category: 'txt2img',
    defaultParams: {
      size: '1024*1024',
      seed: -1,
      enable_base64_output: false
    },
    supportedParams: ['prompt', 'size', 'seed', 'enable_base64_output'],
    description: 'High-speed image generation model for rapid, high-quality images'
  },
  'flux-2-flex': {
    name: 'Flux 2 Flex',
    endpoint: 'https://api.novita.ai/v3/async/flux-2-flex',
    async: true,
    category: 'txt2img',
    supportsImg2Img: true,
    defaultParams: {
      size: '1024*1024',
      seed: -1
    },
    supportedParams: ['prompt', 'size', 'seed', 'images'],
    description: 'FLUX.2 model family for fast, flexible text-to-image and image-to-image generation'
  },
  'flux-2-dev': {
    name: 'Flux 2 Dev',
    endpoint: 'https://api.novita.ai/v3/async/flux-2-dev',
    async: true,
    category: 'txt2img',
    supportsImg2Img: true,
    defaultParams: {
      size: '1024*1024',
      seed: -1,
      steps: 28,
      guidance_scale: 3.5
    },
    supportedParams: ['prompt', 'size', 'seed', 'steps', 'guidance_scale', 'images'],
    description: 'FLUX.2 Dev model with advanced generation controls and img2img support'
  },
  'hunyuan-image-3': {
    name: 'Hunyuan Image 3',
    endpoint: 'https://api.novita.ai/v3/async/hunyuan-image-3',
    async: true,
    category: 'txt2img',
    defaultParams: {
      size: '1024*1024',
      seed: -1
    },
    supportedParams: ['prompt', 'size', 'seed'],
    description: 'Tencent Hunyuan model for high-quality image generation'
  },
  'seedream-4.0': {
    name: 'Seedream 4.0',
    endpoint: 'https://api.novita.ai/v3/seedream-4.0',
    async: false, // Synchronous API
    category: 'txt2img',
    supportsImg2Img: true,
    defaultParams: {
      size: '2048x2048', // Seedream uses 'x' separator and min 3.6M pixels
      watermark: false,
      sequential_image_generation: 'disabled'
    },
    supportedParams: ['prompt', 'size', 'watermark', 'image', 'sequential_image_generation'],
    sizeFormat: 'x', // Uses 'x' instead of '*'
    description: 'ByteDance Seedream 4.0 model for high-quality text-to-image and image editing'
  },
  'seedream-4.5': {
    name: 'Seedream 4.5',
    endpoint: 'https://api.novita.ai/v3/seedream-4.5',
    async: false, // Synchronous API
    category: 'txt2img',
    supportsImg2Img: true,
    defaultParams: {
      size: '2048x2048', // Seedream uses 'x' separator and min 3.6M pixels
      watermark: false,
      sequential_image_generation: 'disabled'
    },
    supportedParams: ['prompt', 'size', 'watermark', 'image', 'sequential_image_generation'],
    sizeFormat: 'x', // Uses 'x' instead of '*'
    description: 'ByteDance Seedream 4.5 model supporting text-to-image and image editing'
  },
  'flux-kontext-dev': {
    name: 'FLUX.1 Kontext Dev',
    endpoint: 'https://api.novita.ai/v3/async/flux-1-kontext-dev',
    async: true,
    category: 'img2img',
    supportsImg2Img: true,
    requiresImage: true,
    defaultParams: {
      seed: -1,
      guidance_scale: 2.5,
      steps: 28
    },
    supportedParams: ['prompt', 'images', 'seed', 'guidance_scale', 'num_inference_steps', 'size', 'output_format'],
    description: 'FLUX.1 Kontext Dev for advanced image editing and transformation'
  },
  'flux-kontext-pro': {
    name: 'FLUX.1 Kontext Pro',
    endpoint: 'https://api.novita.ai/v3/async/flux-1-kontext-pro',
    async: true,
    category: 'img2img',
    supportsImg2Img: true,
    requiresImage: true,
    defaultParams: {
      seed: -1,
      guidance_scale: 3.5
    },
    supportedParams: ['prompt', 'images', 'seed', 'guidance_scale', 'aspect_ratio', 'safety_tolerance'],
    description: 'FLUX.1 Kontext Pro for professional-grade image editing'
  },
  'flux-kontext-max': {
    name: 'FLUX.1 Kontext Max',
    endpoint: 'https://api.novita.ai/v3/async/flux-1-kontext-max',
    async: true,
    category: 'img2img',
    supportsImg2Img: true,
    requiresImage: true,
    defaultParams: {
      seed: -1,
      guidance_scale: 3.5
    },
    supportedParams: ['prompt', 'images', 'seed', 'guidance_scale', 'aspect_ratio', 'safety_tolerance'],
    description: 'FLUX.1 Kontext Max for maximum quality image editing'
  },

  'sd-txt2img': {
    name: 'SD Text to Image',
    endpoint: 'https://api.novita.ai/v3/async/txt2img',
    async: true,
    category: 'txt2img',
    defaultParams: {
      width: 1024,
      height: 1024,
      image_num: 1,
      steps: 30,
      guidance_scale: 7.5,
      sampler_name: 'Euler a',
      seed: -1
    },
    supportedParams: ['model_name', 'prompt', 'negative_prompt', 'width', 'height', 'image_num', 'steps', 'guidance_scale', 'sampler_name', 'seed', 'loras', 'sd_vae'],
    requiresModel: true, // This model requires a model_name from active models
    description: 'Stable Diffusion text-to-image with custom models'
  },

  'qwen-image-2512': {
    name: 'Qwen Image 2512',
    endpoint: 'https://api.segmind.com/v1/qwen-image-2512',
    async: false, // Synchronous API - returns binary image directly
    provider: 'segmind', // Use Segmind API authentication
    category: 'txt2img',
    supportsImg2Img: false,
    requiresImage: false,
    defaultParams: {
      steps: 6,
      seed: -1,
      height: 1024,
      width: 1024,
      image_format: 'webp',
      quality: 90,
      base_64: false
    },
    supportedParams: ['prompt', 'steps', 'seed', 'height', 'width', 'image_format', 'quality', 'base_64'],
    description: 'Qwen-Image-2512 generates highly realistic images from text descriptions, excelling in human depiction and environmental detail'
  },
  'merge-face-segmind': {
    name: 'Merge Face',
    alias: 'merge-face', // Alias for backward compatibility
    endpoint: 'https://api.segmind.com/v1/faceswap-v5',
    async: false, // Synchronous API
    provider: 'segmind', // Use Segmind API authentication
    category: 'face',
    supportsImg2Img: false,
    requiresImage: true,
    requiresTwoImages: true,
    defaultParams: {
      image_format: 'png',
      quality: 95
    },
    supportedParams: ['source_image', 'target_image', 'seed', 'image_format', 'quality'],
    description: 'FaceSwap V5 - Advanced face swapping using Segmind API'
  }
};

/**
 * Check if a model supports batch image generation (multiple images in a single API call)
 * Models that support batch generation have 'images' or 'image_num' in their supportedParams
 * Models without batch support require separate API calls for each image (sequential generation)
 * 
 * Known models WITHOUT batch support (require sequential generation):
 * - hunyuan-image-3: No image_num or images parameter
 * - z-image-turbo: No image_num or images parameter
 * - seedream-4.0, seedream-4.5: Use sequential_image_generation: 'disabled'
 * - qwen-image-2512: No batch parameters
 * 
 * Known models WITH batch support:
 * - flux-2-flex, flux-2-dev: Support 'images' parameter
 * - flux-kontext-*: Support 'images' parameter
 * - sd-txt2img: Support 'image_num' parameter
 * 
 * @param {string} modelId - The model identifier from MODEL_CONFIGS
 * @returns {boolean} - True if model supports batch generation, false if requires sequential.
 *                      Returns false for unknown models (safer assumption - treats them as sequential)
 */
function modelSupportsBatchGeneration(modelId) {
  const config = MODEL_CONFIGS[modelId];
  if (!config) {
    // Unknown models default to not supporting batch generation.
    // This is a conservative approach - if we don't know the model's capabilities,
    // we assume it doesn't support batch and make separate API calls.
    // This may result in more API calls but ensures images are generated correctly.
    return false;
  }
  
  const supportedParams = config.supportedParams || [];
  // Check if model supports 'images' (batch output) or 'image_num' (batch count parameter)
  return supportedParams.includes('images') || supportedParams.includes('image_num');
}

/**
 * Check if a model requires sequential generation for multiple images
 * This is the inverse of modelSupportsBatchGeneration
 * 
 * Sequential generation means making separate API calls for each image requested,
 * rather than a single API call with image_num parameter.
 * 
 * @param {string} modelId - The model identifier from MODEL_CONFIGS
 * @returns {boolean} - True if model requires sequential generation (separate API calls per image),
 *                      false if model supports batch generation (single API call for multiple images)
 */
function modelRequiresSequentialGeneration(modelId) {
  return !modelSupportsBatchGeneration(modelId);
}

// Size options for different models
const SIZE_OPTIONS = [
  { value: '512*512', label: '512x512 (Square)', minPixels: 0 },
  { value: '768*768', label: '768x768 (Square)', minPixels: 0 },
  { value: '1024*1024', label: '1024x1024 (Square)', minPixels: 0 },
  { value: '768*1024', label: '768x1024 (Portrait)', minPixels: 0 },
  { value: '1024*768', label: '1024x768 (Landscape)', minPixels: 0 },
  { value: '1024*1360', label: '1024x1360 (Portrait HD)', minPixels: 0 },
  { value: '1360*1024', label: '1360x1024 (Landscape HD)', minPixels: 0 },
  { value: '1920*1920', label: '1920x1920 (Square - Seedream min)', minPixels: 3686400 },
  { value: '2048*2048', label: '2048x2048 (Square HD - Seedream)', minPixels: 3686400 },
  { value: '1536*2048', label: '1536x2048 (Portrait - Seedream)', minPixels: 3686400 },
  { value: '2048*1536', label: '2048x1536 (Landscape - Seedream)', minPixels: 3686400 }
];

// Style presets for character creation
const STYLE_PRESETS = {
  anime: {
    name: 'Anime',
    promptPrefix: 'anime style, illustration, ',
    promptSuffix: ', high quality, detailed'
  },
  photorealistic: {
    name: 'Photorealistic',
    promptPrefix: 'photorealistic, ultra detailed, ',
    promptSuffix: ', professional photography, 8k resolution'
  }
};

/**
 * Initialize a test for a specific model
 * @param {string} modelId - The model identifier
 * @param {Object} params - Generation parameters
 * @returns {Object} - Task info with taskId and startTime
 */
async function initializeModelTest(modelId, params) {
  const config = MODEL_CONFIGS[modelId];
  if (!config) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const startTime = Date.now();
  console.log(`[AdminImageTest] 🚀 Starting ${config.name} generation`);
  console.log(`[AdminImageTest] Prompt: ${params.prompt?.substring(0, 100)}...`);

  // Validate image requirements
  if (config.requiresImage && !params.image && !params.image_base64 && !params.image_file) {
    throw new Error(`${config.name} requires an image input`);
  }
  
  if (config.requiresTwoImages && (!params.image_file || !params.face_image_file)) {
    throw new Error(`${config.name} requires two images (face image and target image)`);
  }

  try {
    let requestBody;
    
    // Get webhook URL for async APIs
    const webhookUrl = config.async ? getWebhookUrl() : null;
    
    // Handle SD txt2img
    if (modelId === 'sd-txt2img') {
      if (!params.model_name) {
        throw new Error('SD txt2img requires a model_name parameter');
      }
      
      // Parse size from string format (e.g., "1024*1024") to width/height
      const size = params.size || '1024*1024';
      const [width, height] = size.split('*').map(Number);
      
      requestBody = {
        extra: {
          response_image_type: 'jpeg',
          enable_nsfw_detection: false,
          ...(webhookUrl ? { webhook: { url: webhookUrl } } : {})
        },
        request: {
          model_name: params.model_name,
          prompt: params.prompt,
          negative_prompt: params.negative_prompt || '',
          width: width || config.defaultParams.width,
          height: height || config.defaultParams.height,
          image_num: params.image_num || config.defaultParams.image_num,
          steps: params.steps || config.defaultParams.steps,
          guidance_scale: params.guidance_scale || config.defaultParams.guidance_scale,
          sampler_name: params.sampler_name || config.defaultParams.sampler_name,
          seed: params.seed !== undefined ? params.seed : config.defaultParams.seed
        }
      };
      
      // Add optional params if provided
      if (params.sd_vae) requestBody.request.sd_vae = params.sd_vae;
      if (params.loras && Array.isArray(params.loras)) requestBody.request.loras = params.loras;
    }

    // Handle Qwen Image 2512 (Segmind text-to-image)
    else if (modelId === 'qwen-image-2512') {
      requestBody = {
        prompt: params.prompt,
        steps: params.steps !== undefined ? params.steps : config.defaultParams.steps,
        seed: params.seed !== undefined ? params.seed : config.defaultParams.seed,
        height: params.height || config.defaultParams.height,
        width: params.width || config.defaultParams.width,
        image_format: params.image_format || config.defaultParams.image_format,
        quality: params.quality || config.defaultParams.quality,
        base_64: params.base_64 !== undefined ? params.base_64 : config.defaultParams.base_64
      };
    }
    // Handle Merge Face Segmind (requires two images)
    else if (modelId === 'merge-face-segmind' || modelId === 'merge-face') {
      // Segmind API requires image URLs, not base64 data
      // We need to upload the images to S3 first
      let sourceImage = params.face_image_file;
      let targetImage = params.image_file;
      
      // Upload images to S3 and get URLs
      console.log(`[AdminImageTest] 📤 Uploading source image to S3 for Segmind...`);
      const sourceImageUrl = await uploadTestImageToS3(sourceImage, 'face_source');
      console.log(`[AdminImageTest] ✅ Source image uploaded: ${sourceImageUrl.substring(0, 50)}...`);
      
      console.log(`[AdminImageTest] 📤 Uploading target image to S3 for Segmind...`);
      const targetImageUrl = await uploadTestImageToS3(targetImage, 'face_target');
      console.log(`[AdminImageTest] ✅ Target image uploaded: ${targetImageUrl.substring(0, 50)}...`);
      
      requestBody = {
        source_image: sourceImageUrl,
        target_image: targetImageUrl,
        seed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
        image_format: 'png',
        quality: 95
      };
    }
    // Handle Kontext models (img2img focused)
    // Novita API requires 'images' as an array of strings (URLs or base64)
    else if (modelId.startsWith('flux-kontext')) {
      // Get the image - can be URL or base64 string
      const inputImage = params.image || params.image_base64;
      
      requestBody = {
        prompt: params.prompt,
        images: inputImage ? [inputImage] : [], // API requires array format
        seed: params.seed !== undefined ? params.seed : config.defaultParams.seed,
        guidance_scale: params.guidance_scale || config.defaultParams.guidance_scale
      };
      
      // Add num_inference_steps for dev model (API uses this name, not 'steps')
      if (modelId === 'flux-kontext-dev') {
        requestBody.num_inference_steps = params.steps || config.defaultParams.steps || 28;
      }
      
      // Add aspect_ratio if provided
      if (params.aspect_ratio) {
        requestBody.aspect_ratio = params.aspect_ratio;
      }
      
      // Add output_format for pro/max
      if (params.output_format) {
        requestBody.output_format = params.output_format;
      }
      
      // Add safety_tolerance for pro/max (1=strict, 5=permissive)
      if (modelId === 'flux-kontext-pro' || modelId === 'flux-kontext-max') {
        requestBody.safety_tolerance = params.safety_tolerance || '5'; // Most permissive by default
      }
      
      if (webhookUrl) {
        requestBody.extra = {
          webhook: { url: webhookUrl }
        };
      }
    }
    // Handle Flux 2 models with potential img2img
    // Novita API requires 'images' as an array for img2img
    else if (modelId === 'flux-2-flex' || modelId === 'flux-2-dev') {
      requestBody = {
        prompt: params.prompt,
        size: params.size || config.defaultParams.size,
        seed: params.seed !== undefined ? params.seed : config.defaultParams.seed
      };
      
      // Add img2img params if image is provided - use 'images' array format
      if (params.image || params.image_base64) {
        const inputImage = params.image || params.image_base64;
        requestBody.images = [inputImage]; // API requires array format
        
        // Note: Flux 2 Flex doesn't support strength parameter according to API docs
        // It's a text-guided editing model, not strength-based
      }
      
      // Add advanced params for flux-2-dev
      if (modelId === 'flux-2-dev') {
        if (params.steps) requestBody.steps = params.steps;
        if (params.guidance_scale) requestBody.guidance_scale = params.guidance_scale;
      }
      
      if (webhookUrl) {
        requestBody.extra = {
          webhook: { url: webhookUrl }
        };
      }
    }
    // Handle Seedream models (txt2img and img2img)
    // Novita API requires 'image' as an array for Seedream 4.5
    else if (modelId.startsWith('seedream')) {
      requestBody = {
        prompt: params.prompt,
        ...config.defaultParams
      };
      
      // Handle size format conversion for Seedream (uses 'x' instead of '*')
      const size = params.size || config.defaultParams.size || '2048x2048';
      const sizeStr = size.replace('*', 'x');
      const [width, height] = sizeStr.split('x').map(Number);
      const totalPixels = width * height;
      
      // Seedream requires min 3,686,400 pixels (about 1920x1920)
      if (totalPixels < 3686400) {
        const scale = Math.ceil(Math.sqrt(3686400 / totalPixels));
        const newWidth = width * scale;
        const newHeight = height * scale;
        requestBody.size = `${newWidth}x${newHeight}`;
        console.log(`[AdminImageTest] Seedream size scaled: ${width}x${height} -> ${newWidth}x${newHeight}`);
      } else {
        requestBody.size = sizeStr;
      }
      
      // Add img2img params if image is provided - use 'image' as array format per API docs
      if (params.image || params.image_base64) {
        const inputImage = params.image || params.image_base64;
        requestBody.image = [inputImage]; // API requires array format for Seedream
        console.log(`[AdminImageTest] Seedream img2img mode - image array with 1 item`);
      }
      
      // Add watermark setting
      requestBody.watermark = params.watermark !== undefined ? params.watermark : false;
      
      // Add sequential_image_generation setting
      requestBody.sequential_image_generation = params.sequential_image_generation || 'disabled';
    }
    // Standard format for other models
    else {
      requestBody = {
        prompt: params.prompt,
        ...config.defaultParams,
        ...params
      };
      
      // Add webhook for async models
      if (config.async && webhookUrl) {
        requestBody.extra = {
          ...(requestBody.extra || {}),
          webhook: {
            url: webhookUrl
          }
        };
      }

      // Handle size format conversion for any model with sizeFormat
      if (config.sizeFormat === 'x' && requestBody.size) {
        const sizeStr = requestBody.size.replace('*', 'x');
        const [width, height] = sizeStr.split('x').map(Number);
        const totalPixels = width * height;
        
        if (totalPixels < 3686400) {
          const scale = Math.ceil(Math.sqrt(3686400 / totalPixels));
          const newWidth = width * scale;
          const newHeight = height * scale;
          requestBody.size = `${newWidth}x${newHeight}`;
          console.log(`[AdminImageTest] Size scaled: ${width}x${height} -> ${newWidth}x${newHeight}`);
        } else {
          requestBody.size = sizeStr;
        }
      }

      // Remove non-supported params
      Object.keys(requestBody).forEach(key => {
        if (!config.supportedParams.includes(key) && key !== 'prompt' && key !== 'extra') {
          delete requestBody[key];
        }
      });
    }

    console.log(`[AdminImageTest] Request body:`, JSON.stringify(requestBody, null, 2));

    // Sync APIs like Seedream and Merge Face need longer timeout (up to 5 minutes)
    const timeout = config.async ? 120000 : 300000;
    
    // Determine headers based on model provider
    let headers;
    const isSegmindModel = config.provider === 'segmind';
    if (isSegmindModel) {
      headers = {
        'x-api-key': process.env.SEGMIND_API_KEY,
        'Content-Type': 'application/json'
      };
    } else {
      headers = {
        'Authorization': `Bearer ${process.env.NOVITA_API_KEY}`,
        'Content-Type': 'application/json'
      };
    }
    
    // Segmind returns image as arraybuffer
    const responseConfig = {
      headers,
      timeout
    };
    
    // Segmind models return binary data
    if (isSegmindModel) {
      responseConfig.responseType = 'arraybuffer';
    }
    
    // Add response validation
    responseConfig.validateStatus = (status) => status < 500; // Don't throw on 4xx errors
    
    const response = await axios.post(config.endpoint, requestBody, responseConfig);

    console.log(`[AdminImageTest] Response status: ${response.status}`);
    
    // Check for non-JSON responses (only for non-Segmind models)
    if (!isSegmindModel && (typeof response.data !== 'object' || response.data === null)) {
      console.error(`[AdminImageTest] ❌ ${config.name} returned non-JSON response:`, typeof response.data === 'string' ? response.data.substring(0, 200) : response.data);
      throw new Error('API returned non-JSON response. Please check your API key and model configuration.');
    }
    
    // Don't log arraybuffer data
    if (!isSegmindModel) {
      console.log(`[AdminImageTest] Response data:`, JSON.stringify(response.data, null, 2));
    }

    if (response.status !== 200) {
      const errorMsg = response.data?.message || response.data?.error || `API returned status ${response.status}`;
      throw new Error(errorMsg);
    }

    // Handle synchronous vs async responses
    if (config.async) {
      // Async API returns task_id (check multiple possible locations)
      const taskId = response.data.task_id || response.data.data?.task_id || response.data.id;
      
      if (!taskId) {
        console.error(`[AdminImageTest] No task_id found in response:`, JSON.stringify(response.data, null, 2));
        throw new Error('No task_id returned from API. Response: ' + JSON.stringify(response.data));
      }
      
      console.log(`[AdminImageTest] ✅ Task created with ID: ${taskId}`);
      
      return {
        modelId,
        modelName: config.name,
        taskId,
        startTime,
        status: 'processing',
        async: true
      };
    } else {
      // Sync API returns images directly
      // Handle different response formats for different sync APIs
      let images = [];
      
      // Segmind models return image as arraybuffer
      if (isSegmindModel) {
        console.log(`[AdminImageTest] 🔍 ${config.name} - processing arraybuffer response`);
        if (response.data && response.data.byteLength > 0) {
          const imageBuffer = Buffer.from(response.data);
          const base64Image = imageBuffer.toString('base64');
          
          // Determine image format from params, config defaults, or fallback
          const imageFormat = params.image_format || config.defaultParams?.image_format || 'png';
          
          // Determine prefix for S3 filename based on model
          const s3Prefix = modelId.replace(/-/g, '_');
          
          // Upload to S3 immediately so the URL persists
          console.log(`[AdminImageTest] 📤 Uploading ${config.name} result to S3...`);
          try {
            const s3Url = await uploadTestImageToS3(`data:image/${imageFormat};base64,${base64Image}`, s3Prefix);
            images = [s3Url];
            console.log(`[AdminImageTest] ✅ ${config.name} image uploaded to S3: ${s3Url.substring(0, 60)}...`);
          } catch (uploadError) {
            console.error(`[AdminImageTest] ⚠️ S3 upload failed, using base64:`, uploadError.message);
            const dataUrl = `data:image/${imageFormat};base64,${base64Image}`;
            images = [dataUrl];
          }
          console.log(`[AdminImageTest] ✅ ${config.name} image processed (${imageBuffer.length} bytes)`);
        } else {
          console.log(`[AdminImageTest] ⚠️ No image data in ${config.name} response`);
        }
      }
      // Seedream returns images array
      else if (response.data.images) {
        images = response.data.images;
      }
      // Some APIs return image_file
      else if (response.data.image_file) {
        images = [response.data.image_file];
      }
      
      const endTime = Date.now();
      const generationTime = endTime - startTime;

      console.log(`[AdminImageTest] ✅ ${config.name} completed in ${generationTime}ms`);
      console.log(`[AdminImageTest] 📊 Returning ${images.length} images for ${modelId}`);

      const result = {
        modelId,
        modelName: config.name,
        taskId: `sync-${Date.now()}`,
        startTime,
        endTime,
        generationTime,
        status: 'completed',
        async: false,
        images: images.map(img => ({
          imageUrl: img,
          isBase64: typeof img === 'string' && img.startsWith('data:')
        }))
      };
      
      console.log(`[AdminImageTest] 📤 Result images array length: ${result.images.length}`);
      if (result.images.length > 0) {
        console.log(`[AdminImageTest] 📤 First image isBase64: ${result.images[0].isBase64}, URL length: ${result.images[0].imageUrl?.length || 0}`);
      }
      
      return result;
    }
  } catch (error) {
    console.error(`[AdminImageTest] ❌ Error with ${config.name}:`, error.message);
    
    let errorMessage = error.message;
    
    if (error.response) {
      console.error(`[AdminImageTest] Response status:`, error.response.status);
      console.error(`[AdminImageTest] Response data:`, JSON.stringify(error.response.data, null, 2));
      
      // Extract error message from various response formats
      const data = error.response.data;
      if (data?.message) {
        errorMessage = data.message;
      } else if (data?.error) {
        errorMessage = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
      } else if (data?.errors && Array.isArray(data.errors)) {
        errorMessage = data.errors.map(e => e.message || e).join(', ');
      } else if (data?.reason) {
        errorMessage = data.reason;
      }
    }
    
    const enhancedError = new Error(errorMessage);
    enhancedError.originalError = error;
    enhancedError.modelId = modelId;
    throw enhancedError;
  }
}

/**
 * Check the status of an async task (for SD txt2img and other async APIs)
 * @param {string} taskId - The task ID to check
 * @returns {Object} - Task status and results
 */
async function checkTaskResult(taskId) {
  try {
    const response = await axios.get(
      `https://api.novita.ai/v3/async/task-result?task_id=${taskId}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.NOVITA_API_KEY}`
        },
        timeout: 10000, // 10 second timeout for status checks
        validateStatus: (status) => status < 500 // Don't throw on 4xx errors
      }
    );

    // Check if response is valid JSON
    if (typeof response.data !== 'object' || response.data === null) {
      console.error(`[AdminImageTest] ❌ Task ${taskId} returned non-JSON response:`, typeof response.data === 'string' ? response.data.substring(0, 200) : response.data);
      throw new Error('API returned non-JSON response. Please check your API key and model configuration.');
    }

    // Handle different response formats
    const taskData = response.data.task || response.data.data?.task || {};
    const taskStatus = taskData.status || response.data.status;
    const progressPercent = taskData.progress_percent || response.data.progress_percent || 0;

    console.log(`[AdminImageTest] Task ${taskId} status: ${taskStatus}, progress: ${progressPercent}%`);

    // Handle all possible task statuses
    if (taskStatus === 'TASK_STATUS_SUCCEED' || taskStatus === 'succeed') {
      // Task completed successfully - extract images
      const images = response.data.images || response.data.data?.images || [];
      
      console.log(`[AdminImageTest] ✅ Task ${taskId} completed with ${images.length} image(s)`);

      // Download from Novita and upload to Supabase/S3 for permanent URLs
      const uploadedImages = await Promise.all(images.map(async (img, idx) => {
        const originalUrl = img.image_url || img.url;
        console.log(`[AdminImageTest] 🖼️ Image ${idx + 1} original URL: ${originalUrl}`);
        try {
          const imageResponse = await axios.get(originalUrl, { responseType: 'arraybuffer', timeout: 120000 });
          const buffer = Buffer.from(imageResponse.data, 'binary');
          const hash = createHash('md5').update(buffer).digest('hex');
          const permanentUrl = await uploadImage(buffer, hash, 'novita_result_image.png');
          console.log(`[AdminImageTest] ✅ Image ${idx + 1} uploaded: ${permanentUrl.substring(0, 60)}...`);
          return {
            imageUrl: permanentUrl,
            image_type: img.image_type
          };
        } catch (err) {
          console.error(`[AdminImageTest] ❌ Failed to upload image ${idx + 1}: ${err.message}`);
          return {
            imageUrl: originalUrl,
            image_type: img.image_type
          };
        }
      }));

      return {
        status: 'completed',
        progress: 100,
        images: uploadedImages,
        seed: response.data.extra?.seed || null
      };
    } else if (taskStatus === 'TASK_STATUS_FAILED' || taskStatus === 'failed') {
      // Task failed
      const reason = taskData.reason || response.data.reason || response.data.error || 'Unknown error';
      console.error(`[AdminImageTest] ❌ Task ${taskId} failed: ${reason}`);
      
      return {
        status: 'failed',
        error: reason,
        progress: 0
      };
    } else if (taskStatus === 'TASK_STATUS_QUEUED' || taskStatus === 'TASK_STATUS_PROCESSING' || taskStatus === 'queued' || taskStatus === 'processing') {
      // Task is still processing
      return {
        status: 'processing',
        progress: progressPercent,
        eta: taskData.eta || null
      };
    } else {
      // Unknown status - default to processing
      console.warn(`[AdminImageTest] ⚠️ Unknown task status: ${taskStatus} for task ${taskId}`);
      return {
        status: 'processing',
        progress: progressPercent
      };
    }
  } catch (error) {
    console.error(`[AdminImageTest] ❌ Error checking task ${taskId}:`, error.message);
    if (error.response) {
      console.error(`[AdminImageTest] Response status:`, error.response.status);
      console.error(`[AdminImageTest] Response data:`, JSON.stringify(error.response.data, null, 2));
    }
    
    // Return error status instead of throwing to allow retry
    return {
      status: 'error',
      error: error.message || 'Failed to check task status',
      progress: 0
    };
  }
}

/**
 * Save test results to database
 * @param {Object} db - Database instance
 * @param {Object} result - Test result data
 */
async function saveTestResult(db, result) {
  try {
    const collection = db.collection('imageModelTests');
    
    // Check for duplicate saves within the last 30 seconds
    // This prevents duplicate saves from race conditions or multiple calls
    // Increased window to handle network delays and async operations
    const now = new Date();
    const thirtySecondsAgo = new Date(now.getTime() - 30000);
    
    // Normalize prompt for comparison (trim whitespace)
    const normalizedPrompt = (result.prompt || '').trim();
    
    // Check for duplicates with multiple criteria to catch race conditions
    const duplicateCheck = await collection.findOne({
      userId: result.userId,
      modelId: result.modelId,
      prompt: normalizedPrompt,
      testedAt: { $gte: thirtySecondsAgo }
    }, {
      sort: { testedAt: -1 } // Get the most recent one
    });
    
    if (duplicateCheck) {
      console.log(`[AdminImageTest] ⚠️ Duplicate save prevented for ${result.modelName} (found existing test ${duplicateCheck._id} from ${duplicateCheck.testedAt})`);
      return duplicateCheck._id.toString();
    }
    
    // Normalize images array to ensure consistent structure
    let normalizedImages = [];
    console.log(`[AdminImageTest] 📥 saveTestResult received ${result.images?.length || 0} images for ${result.modelName}`);
    if (result.images && Array.isArray(result.images)) {
      result.images.forEach((img, idx) => {
        console.log(`[AdminImageTest] 📥 Image ${idx}: type=${typeof img}, keys=${typeof img === 'object' ? Object.keys(img).join(',') : 'N/A'}`);
        if (typeof img === 'object' && img.imageUrl) {
          console.log(`[AdminImageTest] 📥 Image ${idx} imageUrl length: ${img.imageUrl?.length || 0}, isBase64: ${img.isBase64}`);
        }
      });
      normalizedImages = result.images.map(img => {
        if (typeof img === 'string') {
          return { imageUrl: img };
        }
        return {
          imageUrl: img.s3Url || img.imageUrl || img.image_url || img.url || null,
          originalUrl: img.imageUrl || img.image_url || null,
          isBase64: img.isBase64 || false
        };
      }).filter(img => img.imageUrl); // Only keep images with valid URLs
    }
    
    // Check if prompt contains NSFW content
    const isNSFW = isNSFWPrompt(normalizedPrompt);
    
    const testRecord = {
      modelId: result.modelId,
      modelName: result.modelName,
      prompt: normalizedPrompt,
      params: result.params,
      generationTime: result.generationTime,
      status: result.status,
      images: normalizedImages,
      error: result.error,
      testedAt: now,
      userId: result.userId,
      isNSFW: isNSFW
    };

    const insertResult = await collection.insertOne(testRecord);

    // Update model average time
    await updateModelAverage(db, result.modelId, result.generationTime);

    console.log(`[AdminImageTest] 💾 Saved test result for ${result.modelName} with ${normalizedImages.length} images`);
    
    return insertResult.insertedId.toString();
  } catch (error) {
    console.error(`[AdminImageTest] Error saving test result:`, error.message);
    throw error;
  }
}

/**
 * Update model average generation time
 * @param {Object} db - Database instance
 * @param {string} modelId - Model identifier
 * @param {number} generationTime - Generation time in ms
 */
async function updateModelAverage(db, modelId, generationTime) {
  try {
    if (!generationTime || generationTime <= 0) return;

    const collection = db.collection('imageModelStats');
    
    await collection.updateOne(
      { modelId },
      {
        $inc: { 
          totalTests: 1, 
          totalTime: generationTime 
        },
        $set: { 
          modelName: MODEL_CONFIGS[modelId]?.name || modelId,
          lastTested: new Date()
        },
        $push: {
          recentTimes: {
            $each: [generationTime],
            $slice: -100 // Keep last 100 times
          }
        }
      },
      { upsert: true }
    );
  } catch (error) {
    console.error(`[AdminImageTest] Error updating model average:`, error.message);
  }
}

/**
 * Get model statistics
 * @param {Object} db - Database instance
 * @param {string} modelId - Optional model ID filter
 * @returns {Array} - Model statistics
 */
async function getModelStats(db, modelId = null) {
  try {
    const collection = db.collection('imageModelStats');
    const query = modelId ? { modelId } : {};
    
    const stats = await collection.find(query).toArray();
    
    // Separate SD models from other models
    // SD models can have modelId 'sd-txt2img' or prefixed IDs like 'sd-someModelId'
    const sdStats = stats.filter(stat => stat.modelId === 'sd-txt2img' || stat.modelId.startsWith('sd-'));
    const otherStats = stats.filter(stat => stat.modelId !== 'sd-txt2img' && !stat.modelId.startsWith('sd-'));
    
    // Combine all SD model statistics
    let combinedSDStat = null;
    if (sdStats.length > 0) {
      const combinedTotalTests = sdStats.reduce((sum, stat) => sum + (stat.totalTests || 0), 0);
      const combinedTotalTime = sdStats.reduce((sum, stat) => sum + (stat.totalTime || 0), 0);
      const allRecentTimes = sdStats.reduce((arr, stat) => {
        if (stat.recentTimes && Array.isArray(stat.recentTimes)) {
          return arr.concat(stat.recentTimes);
        }
        return arr;
      }, []);
      
      const avgTime = combinedTotalTests > 0 ? Math.round(combinedTotalTime / combinedTotalTests) : 0;
      const recentAvg = allRecentTimes.length > 0 
        ? Math.round(allRecentTimes.reduce((a, b) => a + b, 0) / allRecentTimes.length)
        : avgTime;
      
      // Get the most recent lastTested date
      const lastTested = sdStats.reduce((latest, stat) => {
        if (!latest) return stat.lastTested;
        if (!stat.lastTested) return latest;
        return stat.lastTested > latest ? stat.lastTested : latest;
      }, null);
      
      // Get combined rating stats for SD models (match both exact and prefixed IDs)
      const ratingsCollection = db.collection('imageRatings');
      const sdRatings = await ratingsCollection.find({ 
        $or: [
          { modelId: 'sd-txt2img' },
          { modelId: { $regex: /^sd-/ } }
        ]
      }).toArray();
      const sdTotalRatings = sdRatings.length;
      const sdAverageRating = sdTotalRatings > 0 
        ? Math.round((sdRatings.reduce((sum, r) => sum + r.rating, 0) / sdTotalRatings) * 10) / 10
        : null;

      combinedSDStat = {
        modelId: 'sd-txt2img',
        modelName: 'SD Text to Image',
        totalTests: combinedTotalTests,
        averageTime: avgTime,
        recentAverageTime: recentAvg,
        lastTested: lastTested,
        minTime: allRecentTimes.length > 0 ? Math.min(...allRecentTimes) : 0,
        maxTime: allRecentTimes.length > 0 ? Math.max(...allRecentTimes) : 0,
        averageRating: sdAverageRating,
        totalRatings: sdTotalRatings
      };
    }
    
    // Get all ratings to calculate averages
    const ratingsCollection = db.collection('imageRatings');
    const allRatings = await ratingsCollection.find({}).toArray();
    const ratingsByModel = {};
    allRatings.forEach(rating => {
      if (!ratingsByModel[rating.modelId]) {
        ratingsByModel[rating.modelId] = [];
      }
      ratingsByModel[rating.modelId].push(rating.rating);
    });

    // Process other stats normally
    const processedOtherStats = otherStats.map(stat => {
      const avgTime = stat.totalTests > 0 ? Math.round(stat.totalTime / stat.totalTests) : 0;
      const recentAvg = stat.recentTimes?.length > 0 
        ? Math.round(stat.recentTimes.reduce((a, b) => a + b, 0) / stat.recentTimes.length)
        : avgTime;
      
      // Calculate rating stats from ratings collection
      const modelRatings = ratingsByModel[stat.modelId] || [];
      const totalRatings = modelRatings.length;
      const averageRating = totalRatings > 0 
        ? Math.round((modelRatings.reduce((sum, r) => sum + r, 0) / totalRatings) * 10) / 10
        : null;
      
      return {
        modelId: stat.modelId,
        modelName: stat.modelName,
        totalTests: stat.totalTests || 0,
        averageTime: avgTime,
        recentAverageTime: recentAvg,
        lastTested: stat.lastTested,
        minTime: stat.recentTimes?.length > 0 ? Math.min(...stat.recentTimes) : 0,
        maxTime: stat.recentTimes?.length > 0 ? Math.max(...stat.recentTimes) : 0,
        averageRating: averageRating,
        totalRatings: totalRatings
      };
    });
    
    // Combine results: other stats first, then combined SD stat if it exists
    const result = [...processedOtherStats];
    if (combinedSDStat) {
      result.push(combinedSDStat);
    }
    
    return result;
  } catch (error) {
    console.error(`[AdminImageTest] Error getting model stats:`, error.message);
    return [];
  }
}

/**
 * Get recent test history
 * @param {Object} db - Database instance
 * @param {number} limit - Number of records to return
 * @param {string} modelId - Optional model ID filter
 * @param {string} userId - Optional user ID filter (for non-admin users to see only their own images)
 * @returns {Array} - Recent test records
 */
async function getRecentTests(db, limit = 50, modelId = null, userId = null) {
  try {
    const collection = db.collection('imageModelTests');
    const query = {};
    
    // Add user filter if provided (for non-admin users)
    if (userId) {
      query.userId = userId;
    }
    
    // Add model filter if provided
    if (modelId) {
      // For SD models, filter by modelId that starts with 'sd-' or equals 'sd-txt2img'
      // and also check modelName for SD model patterns
      if (modelId === 'sd-txt2img') {
        if (userId) {
          // Combine userId with SD model filter
          query.$and = [
            { userId },
            {
              $or: [
                { modelId: 'sd-txt2img' },
                { modelId: { $regex: /^sd-/ } },
                { modelName: { $regex: /^SD Text to Image/ } }
              ]
            }
          ];
          delete query.userId; // Remove top-level userId since it's in $and
        } else {
          query.$or = [
            { modelId: 'sd-txt2img' },
            { modelId: { $regex: /^sd-/ } },
            { modelName: { $regex: /^SD Text to Image/ } }
          ];
        }
      } else {
        query.modelId = modelId;
      }
    }
    
    return await collection
      .find(query)
      .sort({ testedAt: -1 })
      .limit(limit)
      .toArray();
  } catch (error) {
    console.error(`[AdminImageTest] Error getting recent tests:`, error.message);
    return [];
  }
}

/**
 * Get default character creation model setting
 * @param {Object} db - Database instance
 * @returns {Object} - Default model settings
 */
async function getDefaultCharacterModels(db) {
  try {
    const collection = db.collection('systemSettings');
    const settings = await collection.findOne({ type: 'defaultCharacterModels' });
    
    return settings || {
      anime: 'z-image-turbo',
      photorealistic: 'flux-2-flex'
    };
  } catch (error) {
    console.error(`[AdminImageTest] Error getting default character models:`, error.message);
    return {
      anime: 'z-image-turbo',
      photorealistic: 'flux-2-flex'
    };
  }
}

/**
 * Set default character creation model
 * @param {Object} db - Database instance
 * @param {string} style - 'anime' or 'photorealistic'
 * @param {string} modelId - Model identifier
 */
async function setDefaultCharacterModel(db, style, modelId) {
  try {
    const collection = db.collection('systemSettings');
    
    await collection.updateOne(
      { type: 'defaultCharacterModels' },
      {
        $set: {
          [style]: modelId,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    console.log(`[AdminImageTest] ✅ Set default ${style} model to ${modelId}`);
  } catch (error) {
    console.error(`[AdminImageTest] Error setting default character model:`, error.message);
    throw error;
  }
}

/**
 * Upload image to S3 and return URL
 * @param {string} imageUrl - Original image URL or base64
 * @param {string} prefix - Filename prefix
 * @returns {string} - S3 URL
 */
async function uploadTestImageToS3(imageUrl, prefix = 'test') {
  try {
    let buffer;
    
    if (imageUrl.startsWith('data:')) {
      // Handle base64
      const base64Data = imageUrl.split(',')[1];
      buffer = Buffer.from(base64Data, 'base64');
    } else {
      // Download from URL
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      buffer = Buffer.from(response.data, 'binary');
    }

    const hash = createHash('md5').update(buffer).digest('hex');
    const s3Url = await uploadImage(buffer, hash, `${prefix}_${hash}.png`);
    
    return s3Url;
  } catch (error) {
    console.error(`[AdminImageTest] Error uploading to S3:`, error.message);
    return imageUrl; // Return original URL as fallback
  }
}

/**
 * Save image rating
 * @param {Object} db - Database instance
 * @param {string} modelId - Model identifier
 * @param {string} imageUrl - Image URL
 * @param {number} rating - Rating from 1 to 5
 * @param {string} testId - Optional test ID
 * @param {string} userId - User ID
 */
async function saveImageRating(db, modelId, imageUrl, rating, testId = null, userId = null) {
  try {
    if (rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    const collection = db.collection('imageRatings');
    
    // Check if rating already exists for this image
    const existingRating = await collection.findOne({
      imageUrl: imageUrl,
      modelId: modelId
    });

    if (existingRating) {
      // Update existing rating
      await collection.updateOne(
        { _id: existingRating._id },
        {
          $set: {
            rating: rating,
            testId: testId,
            userId: userId,
            updatedAt: new Date()
          }
        }
      );
    } else {
      // Create new rating
      await collection.insertOne({
        modelId: modelId,
        imageUrl: imageUrl,
        rating: rating,
        testId: testId,
        userId: userId,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    // Update model rating statistics
    await updateModelRatingStats(db, modelId);

    console.log(`[AdminImageTest] 💾 Saved rating ${rating} for ${modelId}`);
  } catch (error) {
    console.error(`[AdminImageTest] Error saving image rating:`, error.message);
    throw error;
  }
}

/**
 * Get image rating
 * @param {Object} db - Database instance
 * @param {string} testId - Test ID
 * @returns {Object|null} - Rating object or null
 */
async function getImageRating(db, testId) {
  try {
    const collection = db.collection('imageRatings');
    const rating = await collection.findOne({ testId: testId });
    return rating;
  } catch (error) {
    console.error(`[AdminImageTest] Error getting image rating:`, error.message);
    return null;
  }
}

/**
 * Update model rating statistics
 * @param {Object} db - Database instance
 * @param {string} modelId - Model identifier
 */
async function updateModelRatingStats(db, modelId) {
  try {
    const ratingsCollection = db.collection('imageRatings');
    const statsCollection = db.collection('imageModelStats');
    
    // Get all ratings for this model
    const ratings = await ratingsCollection.find({ modelId: modelId }).toArray();
    
    if (ratings.length === 0) {
      return;
    }

    const totalRatings = ratings.length;
    const sumRatings = ratings.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = sumRatings / totalRatings;

    // Update statistics
    await statsCollection.updateOne(
      { modelId: modelId },
      {
        $set: {
          averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
          totalRatings: totalRatings
        }
      },
      { upsert: true }
    );

    console.log(`[AdminImageTest] 📊 Updated rating stats for ${modelId}: ${averageRating.toFixed(1)} (${totalRatings} ratings)`);
  } catch (error) {
    console.error(`[AdminImageTest] Error updating model rating stats:`, error.message);
  }
}

module.exports = {
  buildImageModelsList,
  MODEL_CONFIGS,
  SIZE_OPTIONS,
  STYLE_PRESETS,
  NSFW_KEYWORDS,
  isNSFWPrompt,
  modelSupportsBatchGeneration,
  modelRequiresSequentialGeneration,
  initializeModelTest,
  checkTaskResult,
  saveTestResult,
  updateModelAverage,
  getModelStats,
  getRecentTests,
  getDefaultCharacterModels,
  setDefaultCharacterModel,
  uploadTestImageToS3,
  saveImageRating,
  getImageRating,
  updateModelRatingStats
};
