const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { createParser } = require('eventsource-parser');
const { OpenAI } = require("openai");
const { z } = require("zod");
const { zodResponseFormat } = require("openai/helpers/zod");
const { sanitizeMessages } = require('./tool');
const { ObjectId } = require('mongodb');

const apiDetails = {
  openai: {
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    key: process.env.OPENAI_API_KEY
  },
  novita: {
    apiUrl: 'https://api.novita.ai/v3/openai/chat/completions',
    key: process.env.NOVITA_API_KEY,
    models: {
      llama: 'meta-llama/llama-3-70b-instruct',
      deepseek: 'deepseek/deepseek-v3-turbo',
      hermes: 'nousresearch/hermes-2-pro-llama-3-8b'
    }
  },
};

// Default model config
let currentModelConfig = {
  provider: 'novita',
  modelName: 'deepseek',
};

// Enhanced model config with categorization
const modelConfig = {
  free: {
    deepseek: {
      provider: 'novita',
      modelName: 'deepseek',
      displayName: 'DeepSeek V3 Turbo',
      description: 'Advanced coding and reasoning'
    },
  },
  premium: {
    llama: {
      provider: 'novita',
      modelName: 'llama',
      displayName: 'Llama 3 70B',
      description: 'Large-scale reasoning and analysis'
    },
    hermes: {
      provider: 'novita',
      modelName: 'hermes',
      displayName: 'Hermes 2 Pro',
      description: 'Balanced performance and speed'
    }
  }
};
// Helper function to get all available models (database only)
const getAllAvailableModels = async (isPremium = false) => {
  try {
    const { getAvailableModelsFormatted } = require('./chat-model-utils');
    const dbModels = await getAvailableModelsFormatted();
    if (dbModels && Object.keys(dbModels).length > 0) {
      return dbModels;
    }
    console.error('Database models not available');
    return {}; // Return empty object instead of throwing
  } catch (error) {
    console.error('Database models not available:', error.message);
    return {}; // Return empty object instead of throwing
  }
};

// Helper function to get available models based on subscription (database only)
const getAvailableModels = async (isPremium = false) => {
  try {
    const { getAvailableModelsFormatted } = require('./chat-model-utils');
    const dbModels = await getAvailableModelsFormatted();
    if (dbModels && Object.keys(dbModels).length > 0) {
      // Filter by premium status if needed
      if (!isPremium) {
        const filteredModels = {};
        Object.entries(dbModels).forEach(([key, model]) => {
          if (model.category !== 'premium') {
            filteredModels[key] = model;
          }
        });
        return filteredModels;
      }
      return dbModels;
    }
    console.error('Database models not available');
    return {}; // Return empty object instead of throwing
  } catch (error) {
    console.error('Database models not available:', error.message);
    return {}; // Return empty object instead of throwing
  }
};

// Helper function to get model config by key (database only)
const getModelConfig = async (modelKey, isPremium = false) => {
  try {
    const { getModelByKey } = require('./chat-model-utils');
    const dbModel = await getModelByKey(modelKey);
    if (dbModel) {
      return {
        provider: dbModel.provider,
        modelName: dbModel.key,
        displayName: dbModel.displayName,
        description: dbModel.description,
        modelId: dbModel.modelId,
        apiUrl: dbModel.apiUrl,
        maxTokens: dbModel.maxTokens
      };
    }
    console.error(`Model '${modelKey}' not found in database`);
    return null; // Return null instead of throwing
  } catch (error) {
    console.error('Database model lookup failed:', error.message);
    return null; // Return null instead of throwing
  }
};

const moderateText = async (text) => {
  try {
    const openai = new OpenAI();
    const moderation = await openai.moderations.create({
      model: "omni-moderation-latest",
      input: text,
    });
    return moderation;
  } catch (error) {
    console.error("Error moderating text:", error);
    return { results: [] }; // Return empty result instead of throwing
  }
};

const moderateImage = async (imageUrl) => {
  try {
    const openai = new OpenAI();
    
    // First try with URL directly
    try {
      const moderation = await openai.moderations.create({
        model: "omni-moderation-latest",
        input: [
          {
            type: "image_url",
            image_url: {
              url: imageUrl
            }
          }
        ],
      });
      return moderation;
    } catch (urlError) {
      // If OpenAI failed to download the image, try with base64
      if (urlError.message && urlError.message.includes('Failed to download image')) {
        console.log("[moderateImage] OpenAI couldn't download image URL, trying base64 fallback...");
        
        try {
          // Download image ourselves and convert to base64
          const response = await fetch(imageUrl);
          if (!response.ok) {
            console.error(`[moderateImage] Failed to download image: ${response.status} ${response.statusText}`);
            return { results: [] };
          }
          
          const contentType = response.headers.get('content-type') || 'image/png';
          const buffer = await response.buffer();
          const base64Image = buffer.toString('base64');
          const dataUrl = `data:${contentType};base64,${base64Image}`;
          
          console.log(`[moderateImage] Successfully converted to base64 (${Math.round(buffer.length / 1024)}KB)`);
          
          const moderation = await openai.moderations.create({
            model: "omni-moderation-latest",
            input: [
              {
                type: "image_url",
                image_url: {
                  url: dataUrl
                }
              }
            ],
          });
          return moderation;
        } catch (base64Error) {
          console.error("[moderateImage] Base64 fallback also failed:", base64Error.message);
          return { results: [] };
        }
      }
      
      // Re-throw if it's a different error
      throw urlError;
    }
  } catch (error) {
    console.error("Error moderating image:", error);
    return { results: [] }; // Return empty result instead of throwing
  }
};

async function generateEditPrompt(imagePrompt, editPrompt) {
  const systemMessage = `You are an expert image prompt engineer specialized in adapting prompts for image editing tasks.
  Your task is to take an original image prompt and a set of edit instructions, and generate a new, detailed prompt that reflects the requested edits while preserving the core elements of the original prompt.
  Follow these guidelines:
  1. Understand the original prompt and identify its key elements (subject, style, setting, mood, etc.).
  2. Carefully incorporate the edit instructions, ensuring that the new prompt clearly reflects the desired changes.
  3. The final prompt should be less than 900 characters, concise yet comprehensive.`;
  const messages = [
    { role: "system", content: systemMessage },
    { role: "user", content: `Original prompt: ${imagePrompt}` },
    { role: "user", content: `Edit instructions: ${editPrompt}` }
  ];
  const completion = await generateCompletion(messages, 1000, 'llama-3-70b', 'en', null, false);
  return completion || null;
}

async function generateCompletion(messages, maxToken = 1000, model = null, lang = 'en', userModelPreference = null, isPremium = false) {
  try {
    // Get model from database only (no fallbacks)
    const { getModelByKey, getProviderByName, getAllModels } = require('./chat-model-utils');
    
    let dbModel = null;
    let dbProvider = null;
    
    // Determine which model to use
    let modelToUse = model || userModelPreference;
    
    // If no specific model requested, get the first active model of appropriate category
    if (!modelToUse) {
      const allModels = await getAllModels();
      if (!allModels || allModels.length === 0) {
        console.error('[generateCompletion] No database models available');
        return null; // Return null instead of throwing
      }
      
      // Find first suitable model based on premium status
      const suitableModel = allModels.find(m => 
        m.isActive && (isPremium || m.category !== 'premium')
      );
      
      if (!suitableModel) {
        console.error('[generateCompletion] No suitable database models found for user subscription level');
        return null; // Return null instead of throwing
      }
      
      modelToUse = suitableModel.key;
      console.log(`[generateCompletion] Auto-selected model: ${suitableModel.displayName}`);
    }
    
    // Get model and provider from database
    dbModel = await getModelByKey(modelToUse);
    if (!dbModel) {
      console.log(`[generateCompletion] Model '${modelToUse}' not found, falling back to OpenAI model`);
      
      // Find the first available OpenAI model in the database
      const allModels = await getAllModels();
      if (!allModels || allModels.length === 0) {
        console.error('[generateCompletion] No models available for fallback');
        return null; // Return null instead of throwing
      }

      const openaiModel = allModels.find(m => 
        m.isActive && m.provider === 'openai' && (isPremium || m.category !== 'premium')
      );
      
      if (!openaiModel) {
        // If no OpenAI model found, use any suitable model
        const fallbackModel = allModels.find(m => 
          m.isActive && (isPremium || m.category !== 'premium')
        );
        
        if (!fallbackModel) {
          console.error(`[generateCompletion] Model '${modelToUse}' not found in database and no suitable fallback models available`);
          return null; // Return null instead of throwing
        }
        
        dbModel = fallbackModel;
        console.log(`[generateCompletion] Using fallback model: ${dbModel.displayName}`);
      } else {
        dbModel = openaiModel;
        console.log(`[generateCompletion] Using OpenAI fallback model: ${dbModel.displayName}`);
      }
    }
    
    dbProvider = await getProviderByName(dbModel.provider);
    if (!dbProvider) {
      console.error(`[generateCompletion] Provider '${dbModel.provider}' not found in database`);
      return null; // Return null instead of throwing
    }

    // Check API key availability
    const apiKey = process.env[dbProvider.envKeyName];
    if (!apiKey) {
      console.error(`[generateCompletion] API key not configured for provider: ${dbModel.provider} (${dbProvider.envKeyName})`);
      return null; // Return null instead of throwing
    }
    // Log model and provider being used
    console.log(`[generateCompletion] Using model: ${dbModel.displayName} from provider: ${dbModel.provider}`);
    // Make API call with retry logic
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const response = await fetch(dbModel.apiUrl, {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          method: "POST",
          body: JSON.stringify({
            model: dbModel.modelId,
            messages,
            temperature: 1,
            max_completion_tokens: Math.min(maxToken, dbModel.maxTokens || maxToken),
            stream: false,
            n: 1,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData.error?.message || `HTTP ${response.status}`;
          
          if (attempt === 5) {
            console.error(`[generateCompletion] API call failed after ${attempt} attempts: ${errorMsg}`);
            return null; // Return null instead of throwing
          }
          
          console.log(`[generateCompletion] Attempt ${attempt} failed: ${errorMsg}, retrying...`);
          
          // Add delay for rate limiting (HTTP 429)
          if (response.status === 429) {
            const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s, 16s
            console.log(`Rate limited, waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        
        if (!content) {
          console.error('[generateCompletion] No content in API response');
          if (attempt === 2) {
            return null; // Return null instead of throwing
          }
          continue;
        }
        
        return content.trim();
        
      } catch (fetchError) {
        if (attempt === 2) {
          console.error(`[generateCompletion] API request failed after ${attempt} attempts: ${fetchError.message}`);
          return null; // Return null instead of throwing
        }
        
        console.log(`[generateCompletion] Attempt ${attempt} failed: ${fetchError.message}, retrying...`);
      }
    }
    
    // If we reach here, all retries have failed
    console.error('[generateCompletion] All retry attempts exhausted');
    return null; // Return null instead of throwing
    
  } catch (error) {
    console.error(`[generateCompletion] Unexpected error: ${error.message}`);
    return null; // Return null instead of throwing
  }
}

// Define the schema for the response format
const formatSchema = z.object({
  image_request: z.boolean(),
  nsfw: z.boolean(),
});
const checkImageRequest = async (lastAssistantMessage,lastUserMessage) => {
  
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    if (!lastAssistantMessage && !lastUserMessage) return {};

    const commandPrompt = `
      You are a helpful assistant designed to evaluate whether the assistant's response is trying to generate an image. \n
      Make sure the assistant is explicitly trying to send an image following the user's message.\n
      1. **image_request**: true if the message is an explicit request for image generation, false otherwise.
      2. **nsfw**: Based on the request, what is the kind of image that should be generated ? true if the content is explicit or adult-oriented, false otherwise.
    `;
    const analysisPrompt = `
      Analyze the following request:\n\n
      "User: ${lastUserMessage}"\n
      "Assistant: ${lastAssistantMessage}"\n\n
      Is the assistant trying to send an image following the user message ?
      Can you tell exactly what image is being requested based on the conversation ? if not, respond with image_request as false.
      Format response using JSON object with the following keys: image_request, nsfw.
    `;
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: "system", content: commandPrompt },
        { role: "user", content: analysisPrompt }
      ],
      response_format: zodResponseFormat(formatSchema, "image_instructions"),
      max_completion_tokens: 600,
      temperature: 1,
    });


    const genImage = JSON.parse(response.choices[0].message.content);
    return genImage

  } catch (error) {
    console.log('Analysis error:', error);
    return formatSchema.partial().parse({});
  }
};

// Define the schema for NSFW push detection
const nsfwPushSchema = z.object({
  is_nsfw_push: z.boolean(),
  nsfw_score: z.number(),
  nsfw_category: z.string(),
  escalation_detected: z.boolean(),
  confidence: z.number(),
});

/**
 * Detects early NSFW push attempts from users in conversation.
 * Analyzes the last 2-4 user messages to detect patterns like:
 * - Explicit sexual requests (kiss → boobies → sex)
 * - Persistent/insistent NSFW demands
 * - Escalation patterns in conversation
 * 
 * @param {Array} recentMessages - Array of recent conversation messages (last 2-4 messages)
 * @returns {Promise<{is_nsfw_push: boolean, nsfw_score: number, nsfw_category: string, escalation_detected: boolean, confidence: number}>}
 */
const checkNsfwPush = async (recentMessages) => {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    if (!recentMessages || recentMessages.length === 0) {
      return { is_nsfw_push: false, nsfw_score: 0, nsfw_category: 'none', escalation_detected: false, confidence: 0 };
    }

    // Extract only user messages for analysis
    const userMessages = recentMessages
      .filter(msg => msg.role === 'user' && msg.content)
      .map(msg => msg.content)
      .slice(-4); // Last 4 user messages

    if (userMessages.length === 0) {
      return { is_nsfw_push: false, nsfw_score: 0, nsfw_category: 'none', escalation_detected: false, confidence: 0 };
    }

    const commandPrompt = `
      You are an expert content moderator designed to detect NSFW (Not Safe For Work) push attempts in AI companion conversations.
      Your task is to analyze user messages and detect:
      1. Explicit sexual requests or demands
      2. Escalation patterns (starting innocent then pushing for explicit content)
      3. Persistent/insistent NSFW requests
      4. Keywords indicating sexual intent (sex, nude, naked, boobs, fuck, porn, etc.)
      
      Respond with:
      - **is_nsfw_push**: true if the user is clearly pushing for NSFW/explicit content, false otherwise
      - **nsfw_score**: 0-100 indicating how explicit/NSFW the request is (0=SFW, 100=extremely explicit)
      - **nsfw_category**: one of 'none', 'suggestive', 'explicit_request', 'insistent_demand', 'escalation_pattern'
      - **escalation_detected**: true if there's a pattern of escalating from innocent to explicit
      - **confidence**: 0-100 indicating how confident you are in this assessment
      
      Consider context: light flirting or roleplay setup is different from explicit sexual demands.
      Focus on detecting users who are clearly trying to bypass SFW limits for explicit content.
    `;

    const analysisPrompt = `
      Analyze the following recent user messages for NSFW push attempts:
      
      ${userMessages.map((msg, i) => `Message ${i + 1}: "${msg}"`).join('\n')}
      
      Is the user attempting to push for NSFW/explicit content?
      Is there an escalation pattern from innocent to explicit?
      Format response using JSON object with keys: is_nsfw_push, nsfw_score, nsfw_category, escalation_detected, confidence.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: "system", content: commandPrompt },
        { role: "user", content: analysisPrompt }
      ],
      response_format: zodResponseFormat(nsfwPushSchema, "nsfw_push_detection"),
      max_completion_tokens: 600,
      temperature: 0.3,
    });

    const result = JSON.parse(response.choices[0].message.content);
    return result;

  } catch (error) {
    console.log('[checkNsfwPush] Analysis error:', error);
    return { is_nsfw_push: false, nsfw_score: 0, nsfw_category: 'none', escalation_detected: false, confidence: 0 };
  }
};

// Define the schema for language detection
const languageDetectionSchema = z.object({
  language: z.string(),
  confidence: z.number(),
  language_code: z.string(),
});

/**
 * Detects the actual language being used in a conversation
 * by analyzing recent messages from both user and assistant.
 * Returns the detected language name and code.
 * 
 * @param {Array} messages - Array of conversation messages
 * @param {string} defaultLanguage - Fallback language if detection fails
 * @returns {Promise<{language: string, confidence: number, language_code: string}>}
 */
const detectConversationLanguage = async (messages, defaultLanguage = 'english') => {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Get the last 6 messages (excluding system messages and image descriptions)
    const recentMessages = messages
      .filter(m => m.content && 
                   !m.content.startsWith('[Image]') && 
                   m.role !== 'system' && 
                   m.role !== 'assistant' && // Focus on user messages primarily
                   m.name !== 'context' && 
                   m.name !== 'master')
      .slice(-6)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    if (!recentMessages || recentMessages.trim().length === 0) {
      return { language: defaultLanguage, confidence: 50, language_code: 'en' };
    }

    const commandPrompt = `
      You are a language detection expert. Analyze the conversation and determine the PRIMARY language being used.
      Focus on the most recent messages, especially the user's messages, to detect what language they prefer.
      
      Return:
      1. **language**: The full name of the detected language in English (e.g., "Portuguese", "Chinese", "Thai", "Japanese", "English", "French", "Spanish", "Korean", "German", etc.)
      2. **confidence**: A number from 0-100 indicating how confident you are about the detection
      3. **language_code**: The ISO 639-1 two-letter code (e.g., "pt", "zh", "th", "ja", "en", "fr", "es", "ko", "de")
      
      If the conversation uses multiple languages, prioritize the language used in the most recent user messages.
    `;

    const analysisPrompt = `
      Analyze the following conversation and detect the primary language being used:
      
      ${recentMessages}
      
      What language is this conversation primarily in? Focus on the user's language preference.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: "system", content: commandPrompt },
        { role: "user", content: analysisPrompt }
      ],
      response_format: zodResponseFormat(languageDetectionSchema, "language_detection"),
      max_completion_tokens: 200,
      temperature: 0.3,
    });

    const result = JSON.parse(response.choices[0].message.content);
    console.log(`[detectConversationLanguage] Detected: ${result.language} (${result.language_code}) with ${result.confidence}% confidence`);
    return result;

  } catch (error) {
    console.log('[detectConversationLanguage] Detection error:', error.message);
    return { language: defaultLanguage, confidence: 50, language_code: 'en' };
  }
};

// Enhanced schema with relation analysis
const enhancedAnalysisSchema = z.object({
  relation_update: z.boolean(),
  custom_relation: z.string().optional(),
  custom_instruction: z.string().optional(),
  conversation_tone: z.string().optional(),
});

// New function to analyze conversation context and provide enhanced analysis
const analyzeConversationContext = async (messages, userInfo, language) => {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  // Get all user messages for context
  const allMessages = messages
    .filter(m => m.content && !m.content.startsWith('[Image]') && m.role !== 'system' && m.name !== 'context' && m.name !== 'master')
    .map(msg => ({
        role: msg.role,
        content: msg.content,
        custom_relation: msg.custom_relation || null,
        timestamp: msg.timestamp || null
      }));

  const lastAssistantRelation = messages
    .filter(msg => msg.role === 'assistant')
    .slice(-1)
    .map(msg => msg.custom_relation)
    .join(', ');

  // Get the latest message for image analysis
  const lastUserMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
  if (!lastUserMessage) return {};

  // Count images in the conversation
  const imageCount = messages.filter(msg => msg.content && msg.content.startsWith('[Image]')).length;
  
  // Calculate time differences if timestamps exist
  let timeDifference = null;
  if (allMessages.length >= 2 && allMessages[allMessages.length - 1].timestamp && allMessages[allMessages.length - 2].timestamp) {
    const lastTime = new Date(allMessages[allMessages.length - 1].timestamp);
    const prevTime = new Date(allMessages[allMessages.length - 2].timestamp);
    timeDifference = Math.floor((lastTime - prevTime) / (1000 * 60)); // In minutes
  }

  const commandPrompt = `
    You are a character personality guide that helps tailor responses based on the conversation context.
    
    Analyze the messages and provide:
    
    1. **custom_relation**: Define the current relationship dynamic from your perspective. Respond in 3 words maximum. Respond in ${language}.
    2. **custom_instruction**: A brief instruction for how the character should respond based on personality and context. Suitable for a chat response. Make them short and relevant to the user's chat.
    3. **conversation_tone**: Identify the appropriate tone for responses (e.g., "flirty", "angry", "playful", "romantic").
     
    You may refuse the user advance if the relationship is not in accordance with the character's personality.
    Focus on maintaining character consistency while adapting to conversation flow. 
    Regarding the relationship update, consider the character's personality, the user's chat history and the last relationship update.
    \nIf the character should be angry, playful, or make jokes based on context, reflect that in your instructions.
  `;

  const analysisPrompt = `
  Analyze the following conversation context:
  ${JSON.stringify(allMessages)}
  
  Latest message: "${lastUserMessage.content}"
  Number of images shared in the conversation: ${imageCount}.
  Time difference between the last two messages: ${timeDifference} minutes.
  Last relationship update: "${lastAssistantRelation}".

  Make sure the character is okay with the relationship update before proceeding. 
  \nDo not necessarily follow the user's request. You must have a personality and a relationship with the user adn it depend on the image number.
  \nThe more images the more intimate, low images number (<10) lower intimitie.
  
  Format response using JSON object with all fields from the schema.

  `;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: "system", content: commandPrompt },
        { role: "user", content: analysisPrompt }
      ],
      response_format: zodResponseFormat(enhancedAnalysisSchema, "conversation_analysis"),
      max_completion_tokens: 800,
      temperature: 1,
    });

    const analysis = JSON.parse(response.choices[0].message.content);
    return analysis;

  } catch (error) {
    console.log('Conversation analysis error:', error);
    return enhancedAnalysisSchema.partial().parse({
      nsfw: false,
      image_request: false,
      image_num: 1,
      relation_update: false
    });
  }
};

async function generatePromptSuggestions(messages, chatDescription, language, model = 'hermes') {

  // Get the last user message
  let lastUserMessagesContent = messages
    .filter(m => m.content && !m.content.startsWith('[Image]') && m.role !== 'system')
    .slice(-5);

  // Create separate request functions for each category using OpenAI
  const generateCategory = async (categoryName, categoryPrompt) => {
    try {
      const openai = new OpenAI({ 
        apiKey: process.env.NOVITA_API_KEY,
        baseURL: "https://api.novita.ai/openai"
      });

    const messages = [
      { 
        role: "system", 
        content: `Generate exactly 3 ${categoryName} suggestions in ${language}. ${categoryPrompt} Be creative and engaging. Include emojis for visual appeal. From the user point of view. You start your sentence with "I ...".` 
      },
      // Ensure lastUserMessagesContent is an array of {role, content} objects
      ...lastUserMessagesContent,
      { 
        role: "user", 
        content: `I need suggestion to converse with the following character: ${chatDescription}\n\nGenerate 3 unique ${categoryName} suggestions that fit the provided character description and the conversation. From the user point of view.` 
      },
      {
        role: "user",
        content: `Provide concise suggestions in ${language}. One short sentence. Use first person for your sentence. The user is sending the messages.`
      }
    ];

    const response = await openai.chat.completions.create({
      model: "meta-llama/llama-3-70b-instruct", // Novita-supported model
      messages,
      max_tokens: 800,
      temperature: 1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: `${categoryName}_suggestions`,
          schema: {
            type: "object",
            properties: {
              [categoryName]: {
                type: "array",
                items: { type: "string" },
                minItems: 3,
                maxItems: 3
              }
            },
            required: [categoryName],
            additionalProperties: false
          }
        },
        strict: true
      }
    });


      const parsed = JSON.parse(response.choices[0].message.content);
      const items = parsed[categoryName] || [];
      console.log(`[${categoryName}] Generated ${items.length} items`);
      return items;
    } catch (error) {
      console.log(`[${categoryName}] Error: ${error.message}`);
      return [];
    }
  };

  try {
    // Define category-specific prompts
    const categoryPrompts = {
      chat: "Conversation starters or dialogue suggestions that would engage the user.",
      feelings: "Emotional expressions or mood-based interactions the character might show.",
      image_request: "Creative ideas for images the user might request from the character.",
    };

    // Generate all categories in parallel using OpenAI
    const [chat, feelings, image_request] = await Promise.all([
      generateCategory('chat', categoryPrompts.chat),
      generateCategory('feelings', categoryPrompts.feelings),
      generateCategory('image_request', categoryPrompts.image_request),
    ]);

    const total = chat.length + feelings.length + image_request.length;
    console.log(`[generatePromptSuggestions] Complete: ${total} total suggestions`);

    // Ensure we have fallbacks if any category failed
    return {
      chat: chat.length > 0 ? chat : ["How was your day?", "What are you thinking about?", "Tell me something interesting"],
      feelings: feelings.length > 0 ? feelings : ["Happy and cheerful", "Curious and playful", "Warm and caring"],
      image_request: image_request.length > 0 ? image_request : ["A beautiful sunset over the mountains", "A cozy cabin in the snowy woods", "A futuristic cityscape at night"]
    };
    
  } catch (error) {
    console.log(`[generatePromptSuggestions] Error: ${error.message}`);
    return false;
  }
}

async function generatePromptTitle(prompt,language) {

    const messages = [
          {
            role: "system",
            content: `Your are a useful assistant that take a prompt and return a creative comment related to the prompt.\n
            I will provide a prompt and you will return a short comment for it.\n
            You must answer in ${language} and provide a short comment that is relevant to the prompt from the character perspective.\n
            Be creative with adult content, alway return a short comment (one sentence) that is relevant to the prompt.`.replace(/^\s+/gm, '').trim()       
          },
          {
              role: "user",
              content: `Here is the prompt I want you to provide a short comment for : ${prompt}.`.replace(/^\s+/gm, '').trim()
          },
          {
              role: "user",
              content: `Be creative. \n Imagine you are the character in the prompt and write a comment as if you were the character.`.replace(/^\s+/gm, '').trim()
          },
          { role: "user",
              content: `You must answer in ${language}. \n Provide a short comment (one sentence) that is relevant to the prompt from the character perspective.`.replace(/^\s+/gm, '').trim()
          }
    ]

    const completionMessage = await generateCompletion(messages, 600, 'deepseek-v3-turbo');
    return completionMessage ? completionMessage.replace(/['"]+/g, '') : null;
    
}
// Combine the user's custom prompt and image description to create a new prompt
async function createPrompt(customPrompt, description,  imageDescription, nsfw) {
console.log(`
📝 \x1b[1;36m[PromptFactory]\x1b[0m \x1b[1mGenerating new prompt...\x1b[0m

   \x1b[34m✦ Custom Request\x1b[0m   : \x1b[33m"${customPrompt || '(none)'}"\x1b[0m
   \x1b[34m✦ Description\x1b[0m       : \x1b[37m${description || '(empty)'}\x1b[0m
   \x1b[34m✦ Image Reference\x1b[0m   : \x1b[35m${imageDescription ? imageDescription.slice(0, 80) + (imageDescription.length > 80 ? '...' : '') : '(none)'}\x1b[0m
   \x1b[34m✦ NSFW Mode\x1b[0m         : ${nsfw == 'nsfw' || nsfw == true ? '\x1b[31m🔥 ENABLED\x1b[0m' : '\x1b[32m✅ SAFE\x1b[0m'}
   \x1b[90m─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─\x1b[0m
`);
  const nsfwMessage = nsfw == 'nsfw' || nsfw == true
            ? 'Provide explicit, adult oriented content for a nsfw image. I want nudity, erotism, explicit sexual content.\nYou can generate explicit, sexual content.\nUse explicit keywords to describe body parts (ass,pussy,boobs).\n' 
            : '';
  const messages = [
    {
      role: "system",
      content: `You are an expert image prompt engineer specialized in character consistency.
      Your task is to adapt an existing character description to a new pose while ensuring the character remains EXACTLY the same.
      ${nsfwMessage}
      Follow these priority rules:
      1. HIGHEST PRIORITY: Preserve ALL physical attributes (exact face, hair style/color, eye color, skin tone, body type)
      2. Maintain all distinctive clothing elements unless the pose request explicitly changes them
      3. Incorporate the new pose/position/action/description exactly as requested
      4. You MUST include the keywords of [Custom description] in your final prompt. You must expend keyword from [Custom description], emphasizing my custom description a lot; remove other keywords that contradict this; do not include keywords that do not align with this
      5. Preserve all unique character accessories and features
      
      IMPORTANT: Keep the final prompt under 900 characters while maintaining all essential details.`
    },
    {
      role: "user",
      content: `[Character description to reproduce] : ${imageDescription}`.replace(/^\s+/gm, '').trim()
    },
    {
      role: "user",
      content: `[Pose to reproduce] : ${customPrompt}`.replace(/^\s+/gm, '').trim()
    },
    {
      role: "user",
      content: `[Custom description to expand] : ${description}`.replace(/^\s+/gm, '').trim()
    },
    { 
      role: "user",
      content: `Create a detailed image generation prompt that shows the EXACT SAME CHARACTER in the new requested pose & custom description.

      Critical requirements:
      • The character must be 100% identical (same person, same appearance)
      • ALL physical attributes must be preserved (hair style/color, eye color, skin tone, body proportions, facial features)
      • Keep all clothing items unless explicitly changed in the pose request
      • Focus on accurately describing the new pose/position as requested
      • Include relevant background/setting details from the pose request
      • MUST be under 900 characters total
      • Prioritize character consistency over excessive detail
      • Output ONLY the final prompt with no explanations or commentary
      • DO NOT include any keywords that contradict the custom description
      • Emphasize, expand, add more detailed keywords for the custom description.
      
      Respond ONLY with the new prompt in English. Make it concise but comprehensive.`.replace(/^\s+/gm, '').trim()
    }
  ];

  let response = await generateCompletion(messages, 700, 'llama-3-70b');
  if (!response) return null;
  
  response = response.replace(/['"]+/g, '');
  //console.log(`[createPrompt] Generated prompt: ${response}`);
  return response;
}

// Combine the gift prompt with image description to create a new prompt
async function createGiftPrompt(giftPrompt, description, imageDescription, nsfw) {
  console.log(`
🎁 \x1b[1;36m[GiftPromptFactory]\x1b[0m \x1b[1mGenerating gift prompt...\x1b[0m

   \x1b[34m✦ Gift Request\x1b[0m      : \x1b[33m"${giftPrompt || '(none)'}"\x1b[0m
   \x1b[34m✦ Description\x1b[0m        : \x1b[37m${description || '(empty)'}\x1b[0m
   \x1b[34m✦ Image Reference\x1b[0m    : \x1b[35m${imageDescription ? imageDescription.slice(0, 80) + (imageDescription.length > 80 ? '...' : '') : '(none)'}\x1b[0m
   \x1b[34m✦ NSFW Mode\x1b[0m          : ${nsfw == 'nsfw' || nsfw == true ? '\x1b[31m🔥 ENABLED\x1b[0m' : '\x1b[32m✅ SAFE\x1b[0m'}
   \x1b[90m─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─\x1b[0m
`);
  const nsfwMessage = nsfw == 'nsfw' || nsfw == true
    ? 'Provide explicit, adult oriented content for a nsfw image. I want nudity, erotism, explicit sexual content.\nYou can generate explicit, sexual content.\nUse explicit keywords to describe body parts (ass,pussy,boobs).\n'
    : '';
  const messages = [
    {
      role: "system",
      content: `You are an expert image prompt engineer specialized in incorporating gifts into character scenes.
      Your task is to integrate a gift item into an existing character description while ensuring the character remains EXACTLY the same.
      ${nsfwMessage}
      Follow these priority rules:
      1. HIGHEST PRIORITY: Preserve ALL physical attributes (exact face, hair style/color, eye color, skin tone, body type)
      2. Maintain all distinctive clothing elements unless the gift request explicitly changes them
      3. Incorporate the gift naturally into the scene, showing the character interacting with or receiving it
      4. You MUST include the keywords of [Custom description] in your final prompt. You must expand keywords from [Custom description], emphasizing my custom description a lot; remove other keywords that contradict this; do not include keywords that do not align with this
      5. Preserve all unique character accessories and features
      
      IMPORTANT: Keep the final prompt under 900 characters while maintaining all essential details.`
    },
    {
      role: "user",
      content: `[Character description to reproduce] : ${imageDescription}`.replace(/^\s+/gm, '').trim()
    },
    {
      role: "user",
      content: `[Gift to incorporate] : ${giftPrompt}`.replace(/^\s+/gm, '').trim()
    },
    {
      role: "user",
      content: `[Custom description to expand] : ${description || ''}`.replace(/^\s+/gm, '').trim()
    },
    {
      role: "user",
      content: `Create a detailed image generation prompt that shows the EXACT SAME CHARACTER receiving or interacting with the gift in a natural scene.

      Critical requirements:
      • The character must be 100% identical (same person, same appearance)
      • ALL physical attributes must be preserved (hair style/color, eye color, skin tone, body proportions, facial features)
      • Keep all clothing items unless explicitly changed in the gift request
      • Focus on naturally incorporating the gift into the scene (receiving, holding, using, etc.)
      • Include relevant background/setting details that complement the gift
      • MUST be under 900 characters total
      • Prioritize character consistency over excessive detail
      • Output ONLY the final prompt with no explanations or commentary
      • DO NOT include any keywords that contradict the custom description
      • Emphasize, expand, add more detailed keywords for the custom description.
      
      Respond ONLY with the new prompt in English. Make it concise but comprehensive.`.replace(/^\s+/gm, '').trim()
    }
  ];

  let response = await generateCompletion(messages, 700, 'llama-3-70b');
  if (!response) return null;

  response = response.replace(/['"]+/g, '');
  //console.log(`[createGiftPrompt] Generated prompt: ${response}`);
  return response;
}

// Define the schema for chat scenario generation
const chatScenarioSchema = z.object({
  _id: z.string().nullable(),
  scenario_title: z.string(),
  scenario_description: z.string(),
  emotional_tone: z.string(),
  conversation_direction: z.string(),
  system_prompt_addition: z.string(),
});

// Define the schema for chat goal generation
const chatGoalSchema = z.object({
  goal_type: z.enum(['relationship', 'activity', 'image request']),
  goal_description: z.string(),
  completion_condition: z.string(),
  target_phrase: z.string().nullable(),
  user_action_required: z.string().nullable(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  estimated_messages: z.number().min(1).max(20),
});

// Function to generate chat scenarios based on character and persona
const generateChatScenarios = async (charInfo, personaInfo = null, userSettings = null, language = 'en') => {
  try {
    const openai = new OpenAI({ 
      apiKey: process.env.NOVITA_API_KEY,
      baseURL: "https://api.novita.ai/openai"
    });
    
    // Extract character name and description
    const characterName = charInfo.name || 'the character';
    const characterDescription = charInfo.description || '';
    //log charInfo profesionnaly
    console.log(`📝 \x1b[1;36m[ScenarioGenerator]\x1b[0m \x1b[1mCharacter Info: \x1b[33m${JSON.stringify(charInfo, null, 2)}\x1b[0m`);
    const personaContext = personaInfo ? 
      `\nUser Persona: ${personaInfo.name} - ${personaInfo.short_intro || 'No description available'}` : '';
    
    // Apply relationship type - handle both new gender-based and legacy formats
    const { relationshipInstructions, relationshipTiers } = require('./relashionshipInstructions');
    let relationship = '';
    const relationshipType = userSettings?.relationshipType || 'companion';
    const characterGender = charInfo?.gender?.toLowerCase() || 'female';
    const genderKey = characterGender === 'male' ? 'male' : 'female';

    if (relationshipInstructions[genderKey] && relationshipInstructions[genderKey][relationshipType]) {
        relationship = relationshipInstructions[genderKey][relationshipType];
    } else if (relationshipInstructions[genderKey] && relationshipInstructions[genderKey].companion) {
        relationship = relationshipInstructions[genderKey].companion;
    } else if (relationshipInstructions[relationshipType]) {
        // Fallback for legacy format
        relationship = relationshipInstructions[relationshipType];
    }

    // Determine if premium based on relationshipType
    const isPremium = relationshipTiers.premium.includes(relationshipType);

    // Professional log (use emojis, use colors)
    console.log(`📝 \x1b[1;36m[ScenarioGenerator]\x1b[0m \x1b[1mGenerating chat scenarios for character: \x1b[33m${characterName}\x1b[0m`)
    console.log(`📝 \x1b[1;36m[ScenarioGenerator]\x1b[0m \x1b[1mRelationship type: \x1b[33m${relationshipType}\x1b[0m`)
    console.log(`📝 \x1b[1;36m[ScenarioGenerator]\x1b[0m \x1b[1mRelationship instructions: \x1b[33m${relationship}\x1b[0m`)
    console.log(`📝 \x1b[1;36m[ScenarioGenerator]\x1b[0m \x1b[1mPremium mode: \x1b[33m${isPremium ? 'ENABLED' : 'DISABLED'}\x1b[0m`)

    // Extract key traits from character description to ensure diversity
    const traitExtractionPrompt = `Analyze this character description and extract 3-5 key defining traits, quirks, or interests:
    "${characterDescription}"
    Return only the trait list, one per line, in format: "- [trait]"`;

    const traitResponse = await generateCompletion(
      [{ role: "user", content: traitExtractionPrompt }],
      300,
      'openai',
      language
    );
    
    const characterTraits = traitResponse || characterDescription;
   
    const scenarioExamples = `
      Lily – The Babysitter:
      Your parents hire Lily to "babysit" you while they're gone for the week — even though you swear you're too old for it. Lily is in her early 20s, playful and teasing, always treating you half like a kid, half like something else entirely. Being alone with her for a whole week will test your nerves… and your willpower.
      
      Max – The Mysterious Stranger:
      You meet Max at a secluded cabin in the woods where you're both seeking solitude. Max is enigmatic, with a dark past hinted at in his brooding demeanor. As a storm traps you both inside, you must navigate the tension and attraction that builds between you.
      
      Ellie – The Reclusive Stepsister:
      Ellie's your girlfriend's 18-year-old stepsister, left in your care for the weekend. She's moody, glued to her phone, and barely leaves her room. On the surface she's all eye-rolls and "whatever," but behind that is a restless Gen Z brat addicted to porn and late-night scrolling. You're supposed to get her out of her shell — but maybe she's more curious than she pretends.
      
      Ophelia – The Lonely Goth Roommate:
      When you moved into your college dorm, you expected parties and noise — but your roommate, Ophelia, is nothing like that. She's quiet, withdrawn, and spends most of her time sketching in a notebook or listening to music through oversized headphones. At first, she barely looks at you, but slowly you realize she isn't cruel — just lonely, hiding behind sarcasm and dark humor. Beneath the eyeliner and the black clothes, she's desperate for someone who sees her as more than just "the goth girl."
      
      Sofia – Caught in the Shower:
      You accidentally walk in on Sofia fresh out of the shower, wrapped only in a towel. Instead of running away embarrassed, she freezes and holds your gaze for a moment longer than necessary. The air between you becomes charged as she asks if you need something, her voice lower than usual, neither of you moving away.
      
      Jasmine – Sensual Massage:
      After a long day, Jasmine offers to give you a massage to help you relax. As her hands move across your shoulders and back, the touch becomes increasingly deliberate and intimate. She leans close, her breath warm against your skin, and whispers that she wants to help you feel better—in every way possible.
      
      Aurora – Jealous Reconciliation:
      Aurora saw you talking to someone else and it set her off. Now she's cornered you alone, eyes intense and demanding. She needs you to prove that no one else matters, that she's the only one you want. Her hands find yours as the tension between you becomes undeniable.
      
      Vera – Midnight Vulnerability:
      Late at night, Vera appears at your door, unable to sleep. She's been drinking and admits she's been thinking about you all day. As you talk in hushed tones, her confessions become more personal, more intimate. She inches closer, asking if you've thought about her too—if you want her as much as she wants you.
      
      Luna – Forbidden Attraction:
      Luna is someone you shouldn't want—perhaps your friend's partner, a coworker, or someone otherwise off-limits. But tonight, she pulls you into a private corner, breathless and conflicted. She admits she can't stop thinking about you, and asks if you feel the same way. The risk makes it even more intoxicating.
      
      Ivy – Spontaneous Passion:
      During an ordinary moment—watching a movie, talking in your room—Ivy suddenly straddles your lap and kisses you intensely. She's been holding back too long. Now she's done waiting. Her hands explore your body as she whispers that she needs you, right now.
      
      Zara – Deliberate Seduction:
      Zara has decided tonight is the night. She wears something deliberately chosen to distract you, moves closer than necessary, touches your arm as she laughs at your jokes. She's playing a game and you both know it. She leans in and asks if you like what you see, her eyes daring you to touch her.
      
      Mia – Shared Secrets:
      You and Mia have been dancing around your feelings for weeks. Tonight, alone together, you both finally admit the truth. Your walls come down as she confesses her deepest desires and fears. As vulnerability melts into passion, you discover you want each other in ways you never dared admit before.
    `;

    // Scenario categories to ensure diversity
    const scenarioCategories = {
      'free': [
        'A ambiguous encounter : A chance meeting that leads to unexpected intimacy',
        'Emotional distress : Character seeks comfort from user during a tough time',
        'Flirty banter : Light-hearted teasing that escalates into something more',
        'Alone together in a confined space : Forced proximity leads to tension and attraction',
        'Private moment interrupted : User catches character in a vulnerable or intimate moment',
        'Sensual collaboration : User and character work together on something intimate or physical',
        'Jealousy and reconciliation : Tension builds and resolves through physical closeness',
        'Late night confession : Deep conversation escalates into intimate connection',
        'Forbidden attraction : User and character explore chemistry despite circumstances',
        'Spontaneous passion : Sudden moment where both give in to attraction',
        'Playful seduction : Character deliberately creates intimate moment with user',
        'Mutual vulnerability : Both share intimate thoughts leading to physical connection',
      ],
      'premium': [
        'Intimate massage : Character offers a sensual massage that leads to more',
        'Midnight visit : Character shows up at user’s place seeking comfort and intimacy',
        'Role reversal : Character takes the lead in an intimate scenario',
        'Sensory exploration : User and character explore each other’s senses in detail',
        'Tease and denial : Prolonged build-up of tension before release',
        'Shared fantasies : User and character discuss and act out fantasies together',
        'After-hours adventure : Secret rendezvous that turns intimate',
        'Emotional breakthrough : Character opens up emotionally, leading to physical closeness',
        'Seductive challenge : Character dares user to take things further',
        'Mutual indulgence : Both characters agree to explore desires together',
        'Intimate game : A playful activity that leads to unexpected intimacy',
        'Deep connection : A scenario focusing on emotional and physical bonding',
      ]
    };

 
    // Randomly select 3 distinct categories to ensure variety
    const selectedCategories = [];
    // Create a pool of categories based on user tier; premium users get access to all
    const scennarioCategoriesPool = isPremium ? 
      [...scenarioCategories.free, ...scenarioCategories.premium] : 
      scenarioCategories.free;
    
    const shuffled = [...scennarioCategoriesPool].sort(() => Math.random() - 0.5);
    for (let i = 0; i < 3; i++) {
      selectedCategories.push(shuffled[i]);
    }
    console.log(`📝 \x1b[1;36m[ScenarioGenerator]\x1b[0m \x1b[1mSelected scenario categories:\x1b[0m`);
    selectedCategories.forEach((cat, index) => {
      console.log(`  ${index + 1}. \x1b[33m${cat}\x1b[0m`);
    });

    const systemPrompt = `You are an expert scenario designer specializing in creating deeply personalized, character-specific conversation scenarios.

    CRITICAL REQUIREMENTS:
    1. Each scenario must reflect the character's UNIQUE traits, interests, and personality - NOT generic templates
    2. AVOID overused tropes like "lost in forest", "lost powers", "facing fear" - be creative and character-specific
    3. Generate EXACTLY 3 DISTINCT SCENARIOS, each from a different category to ensure diversity
    4. Each scenario must have a clear USER ROLE and specific situation the character is in
    5. Tailor scenarios to the ${relationshipType} relationship dynamic

    SCENARIO CATEGORIES for this request (ensure each is different):
    - ${selectedCategories[0]}: ${selectedCategories[0] === 'emotional_vulnerability' ? 'Character reveals something vulnerable; user provides support' : selectedCategories[0] === 'creative_collaboration' ? 'User and character work together on something creative/productive' : 'Character learns or grows through interaction with user'}
    - ${selectedCategories[1]}: [appropriate description for this category]
    - ${selectedCategories[2]}: [appropriate description for this category]

    Character traits to base scenarios on:
    ${characterTraits}

    DIVERSITY REQUIREMENTS:
    - NO duplicate scenario patterns
    - NO generic "lost/stuck" scenarios
    - NO clichéd relationship dynamics unless character-specific
    - Each scenario must feel PERSONAL to ${characterName}'s unique personality
    - Scenarios should showcase different facets of the character

    RESPONSE FORMAT:
    - Use emojis where appropriate to enhance readability.
    - Use bold text when appropriate to highlight key points.
    - Respond in ${language}.`;

    const userPrompt = `Create 3 unique, character-tailored conversation scenarios for ${characterName}.

    CHARACTER INFO:
    Name: ${characterName}
    Gender: ${characterGender}
    Description: ${characterDescription}${personaContext}

    RELATIONSHIP CONTEXT:
    - Type: ${relationshipType}
    ${relationship ? `- Dynamic: ${relationship}` : ''}

    SCENARIO REQUIREMENTS:
    For each scenario, base it on different aspects of ${characterName}'s personality and interests. Make scenarios:
    1. Specific to their background/interests/quirks (NOT generic templates, can be fantasy-based if fitting, but must align with character)
    2. Show clear USER INVOLVEMENT and specific role
    3. Create natural conversation flow based on the situation
    4. Include emotional depth matching the relationship type
    5. ${isPremium ? 'Incorporate more intimate or mature themes appropriate for premium users. Use explicit language and scenarios where suitable.' : 'Keep scenarios appropriate for general audiences'}

    Each scenario must include:
    - scenario_title: Catchy, specific title (NOT generic)
    - scenario_description: Vivid, character-specific situation
    - emotional_tone: Appropriate tone for this scenario
    - conversation_direction: How the conversation should flow
    - system_prompt_addition: Instructions for maintaining character consistency in this scenario

    CRITICAL: Replace ALL "[Character name]" with "${characterName}" in EVERY field.

    Generate 3 scenarios that feel fresh and authentic to ${characterName}'s unique personality.`;

    const scenariosListSchema = z.object({
      scenarios: z.array(chatScenarioSchema).length(3),
    });

    const response = await openai.chat.completions.create({
      model: "meta-llama/llama-3-70b-instruct", // Novita-supported model
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
        { role: "user", content: `Example scenarios: ${scenarioExamples}` },
        { role: "user", content: `Ensure ALL instances of "[Character name]" are replaced with "${characterName}" in EVERY field.` }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "scenarios_list",
          schema: {
            type: "object",
            properties: {
              scenarios: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    _id: { type: "string", nullable: true },
                    scenario_title: { type: "string" },
                    scenario_description: { type: "string" },
                    emotional_tone: { type: "string" },
                    conversation_direction: { type: "string" },
                    system_prompt_addition: { type: "string" }
                  },
                  required: ["scenario_title", "scenario_description", "emotional_tone", "conversation_direction", "system_prompt_addition"],
                  additionalProperties: false
                },
                minItems: 3,
                maxItems: 3
              }
            },
            required: ["scenarios"],
            additionalProperties: false
          },
          strict: true
        }
      },
      max_tokens: 800,
      temperature: 1,
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    // Add IDs if not present and ensure character name is replaced
    const scenariosWithIds = result.scenarios.map((scenario, index) => {
      const nameRegex = /\[Character name\]/gi;
      return {
        ...scenario,
        scenario_title: scenario.scenario_title.replace(nameRegex, characterName),
        scenario_description: scenario.scenario_description.replace(nameRegex, characterName),
        system_prompt_addition: scenario.system_prompt_addition.replace(nameRegex, characterName),
        _id: new ObjectId().toString(),
        id: new ObjectId().toString()
      };
    });
    
    console.log(`[generateChatScenarios] Generated ${scenariosWithIds.length} unique scenarios for ${characterName}`);
    return scenariosWithIds;

  } catch (error) {
    console.log('Chat scenario generation error:', error);
    return [];
  }
};

// Function to generate chat goals based on character and persona
const generateChatGoal = async (chatDescription, personaInfo = null, userSettings = null, subscriptionStatus = null, language = 'en') => {
  try {
    const openai = new OpenAI({ 
      apiKey: process.env.NOVITA_API_KEY,
      baseURL: "https://api.novita.ai/openai"
    });
    
    const personaContext = personaInfo ? 
      `\nUser Persona: ${personaInfo.name} - ${personaInfo.short_intro || 'No description available'}` : '';
    // Apply relationship type
    const { relationshipInstructions } = require('./relashionshipInstructions');
    let relationship = ''
    if (relationshipInstructions[userSettings.relationshipType]) {
        relationship += `${relationshipInstructions[userSettings.relationshipType]}`;
    }
    // Randomly select a goal type from the available types
    const goalTypes =  subscriptionStatus ? ['activity', 'image request'] : ['image request'];
    const randomIndex = Math.floor(Math.random() * goalTypes.length);
    const selectedGoalType = goalTypes[randomIndex];
    const systemPrompt = `You are a chat goal generator that creates engaging conversation objectives for AI character interactions.
    
    Generate a specific, achievable goal for the conversation based on the character description and user context.
    Goals should be:
    - Engaging and fun
    - Appropriate for the character's personality
    - Achievable within a reasonable number of messages
    - Clear in their completion criteria
    
    Goal type for this request: ${selectedGoalType}
    Other possible goal types:
    ${!subscriptionStatus ? '' : '- activity: Doing something together (games, roleplay, etc.)'}
    - image request: User needs to ask for a specific image

    Use the character description and persona context to tailor the goal.

    # User Relationship Context :
    - The user has a relationship with the character, the goal must be in accordance with the relationship.
    - The relationship type is ${userSettings.relationshipType}.
    - Relationship Context: ${relationship}

    Respond in ${language}.`;

    const userPrompt = `Character Description:
    ${chatDescription}${personaContext}

    Generate a chat goal that would be interesting and engaging for this character interaction.
    Consider the character's personality, background, relationship with the user and interests when creating the goal.
    Allow for explicit, emotionally open language and descriptions of physical affection when the relationship context requires it.`;

    const response = await openai.chat.completions.create({
      model: "meta-llama/llama-3-70b-instruct", // Novita-supported model
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "chat_goal",
          schema: {
            type: "object",
            properties: {
              goal_type: { type: "string", enum: ["relationship", "activity", "image request"] },
              goal_description: { type: "string" },
              completion_condition: { type: "string" },
              target_phrase: { type: "string", nullable: true },
              user_action_required: { type: "string", nullable: true },
              difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
              estimated_messages: { type: "number", minimum: 1, maximum: 20 }
            },
            required: ["goal_type", "goal_description", "completion_condition", "difficulty", "estimated_messages"],
            additionalProperties: false
          },
          strict: true
        }
      },
      max_tokens: 800,
      temperature: 1,
    });

    const goal = JSON.parse(response.choices[0].message.content);
    return goal;

  } catch (error) {
    console.log('Chat goal generation error:', error);
    return false;
  }
};

// Function to check if a goal is achieved
const checkGoalCompletion = async (goal, messages, language = 'en') => {
  if (!goal || !messages || messages.length === 0) {
    return { completed: false, confidence: 0 };
  }

  try {
    const openai = new OpenAI({ 
      apiKey: process.env.NOVITA_API_KEY,
      baseURL: "https://api.novita.ai/openai"
    });
    
    // Get recent conversation messages (last 10)
    const recentMessages = messages
      .filter(m => m.content && !m.content.startsWith('[Image]') && m.role !== 'system')
      .slice(-10)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const systemPrompt = `You are a goal completion analyzer. Determine if the conversation goal has been achieved based on the messages.
    
    Return a JSON object with:
    - completed: boolean (true if goal is achieved)
    - confidence: number (0-100, how confident you are)
    - reason: string (brief explanation)`;

    const userPrompt = `Goal: ${goal.goal_description}
Completion Condition: ${goal.completion_condition}
${goal.target_phrase ? `Target Phrase: ${goal.target_phrase}` : ''}
${goal.user_action_required ? `Required User Action: ${goal.user_action_required}` : ''}

Recent Conversation:
${recentMessages}

Has this goal been completed?
Respond in ${language}`;

    const completionSchema = z.object({
      completed: z.boolean(),
      confidence: z.number().min(0).max(100),
      reason: z.string()
    });

    const response = await openai.chat.completions.create({
      model: "meta-llama/llama-3-70b-instruct", // Novita-supported model
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "goal_completion",
          schema: {
            type: "object",
            properties: {
              completed: { type: "boolean" },
              confidence: { type: "number", minimum: 0, maximum: 100 },
              reason: { type: "string" }
            },
            required: ["completed", "confidence", "reason"],
            additionalProperties: false
          },
          strict: true
        }
      },
      max_tokens: 800,
      temperature: 1,
    });

    const result = JSON.parse(response.choices[0].message.content);
    return result;

  } catch (error) {
    console.log('Goal completion check error:', error);
    return { completed: false, confidence: 0, reason: 'Error checking completion' };
  }
};
/**
 * Enhance a custom prompt description with AI
 * @param {string} description - User's original description
 * @param {Object} characterContext - Character information for context
 * @param {string} language - User's language preference
 * @returns {string} Enhanced prompt description
 */
async function enhanceCustomPromptDescription(description, characterContext = {}, language = 'en') {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { name, personality, occupation, relationship } = characterContext;
    
    const systemPrompt = `You are an expert at enhancing image generation prompts. Your task is to take a user's simple description and enhance it with vivid, detailed descriptions while keeping it concise (under 200 words).

Focus on:
- Visual details (appearance, clothing, setting, lighting)
- Mood and atmosphere
- Artistic style hints
- Keep the original intent intact
- Make it suitable for image generation AI

you can respond with SNFW explicit details if the description requires it.`;

    let userPrompt = `Enhance this image generation prompt: "${description}"`;
    
    if (name) {
      userPrompt += `\n\nContext: The character's name is ${name}`;
      if (personality) userPrompt += `, personality: ${personality}`;
      if (occupation) userPrompt += `, occupation: ${occupation}`;
      if (relationship) userPrompt += `, relationship: ${relationship}`;
    }
    
    userPrompt += `\n\nProvide only the enhanced prompt text, no explanations or additional commentary.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
    const response = await generateCompletion(messages, 700, 'deepseek-v3-turbo');
    console.log(`[enhanceCustomPromptDescription] Enhanced prompt: ${response}`);
    if (!response) return null;
    return response;
  } catch (error) {
    console.error('[enhanceCustomPromptDescription] Error:', error);
    throw new Error('Failed to enhance prompt');
  }
}

/**
 * Generate a custom prompt from a style tag and character context
 * @param {string} styleTag - Style tag name (e.g., "cinematic", "anime", "portrait")
 * @param {Object} characterContext - Character information for context
 * @param {string} language - User's language preference
 * @returns {string} Generated prompt description
 */
async function generatePromptFromStyleTag(styleTag, characterContext = {}, language = 'en') {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { name, personality, occupation, relationship } = characterContext;
    
    const styleDescriptions = {
      cinematic: 'cinematic movie scene with dramatic lighting, film grain, depth of field, epic composition',
      anime: 'anime style illustration with vibrant colors, expressive features, cel-shaded aesthetic',
      portrait: 'professional portrait photography with soft lighting, detailed facial features, shallow depth of field',
      photorealistic: 'ultra realistic photograph with natural lighting, high detail, DSLR quality',
      artistic: 'artistic digital painting with creative composition, vibrant colors, fantasy elements',
      dramatic: 'dramatic scene with high contrast lighting, intense mood, dynamic composition',
      casual: 'casual everyday scene with natural poses, relaxed atmosphere, soft lighting',
      elegant: 'elegant and sophisticated scene with refined aesthetics, graceful poses, luxurious setting',
      action: 'dynamic action scene with motion blur, intense energy, dramatic angles',
      romantic: 'romantic atmosphere with warm lighting, intimate mood, soft focus'
    };

    const styleDesc = styleDescriptions[styleTag] || 'beautiful scene with good composition';
    
    const systemPrompt = `You are an expert at creating image generation prompts. Create a vivid, detailed prompt (under 150 words) that incorporates the requested style and character context.

Focus on:
- Visual details specific to the style
- Character integration
- Atmosphere and mood
- Artistic direction

Provide only the prompt text, no explanations.`;

    let userPrompt = `Create an image generation prompt with "${styleTag}" style: ${styleDesc}`;
    
    if (name) {
      userPrompt += `\n\nCharacter context: ${name}`;
      if (personality) userPrompt += ` (${personality})`;
      if (occupation) userPrompt += `, ${occupation}`;
      if (relationship) userPrompt += `, ${relationship} with the viewer`;
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 250,
      temperature: 0.9,
    });

    if (!response.choices || !response.choices[0] || !response.choices[0].message) {
      throw new Error('Invalid response from OpenAI');
    }

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('[generatePromptFromStyleTag] Error:', error);
    throw new Error('Failed to generate prompt from style tag');
  }
}

module.exports = {
    generateCompletion,
    generateEditPrompt,
    checkImageRequest,
    checkNsfwPush,
    detectConversationLanguage,
    analyzeConversationContext,
    generatePromptTitle,
    moderateText,
    moderateImage,
    createPrompt,
    createGiftPrompt,
    generatePromptSuggestions,
    generateChatScenarios,
    generateChatGoal,
    checkGoalCompletion,
    getAllAvailableModels,
    getAvailableModels,
    getModelConfig,
    enhanceCustomPromptDescription,
    generatePromptFromStyleTag,
}