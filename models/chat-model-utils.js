const { ObjectId } = require('mongodb');
const { connect } = require('./db');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Default providers configuration
const DEFAULT_PROVIDERS = [
  {
    _id: new ObjectId(),
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    description: 'OpenAI GPT models',
    requiresApiKey: true,
    envKeyName: 'OPENAI_API_KEY',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: new ObjectId(),
    name: 'novita',
    displayName: 'Novita AI',
    baseUrl: 'https://api.novita.ai/v3/openai/chat/completions',
    description: 'Novita AI models with OpenAI compatibility',
    requiresApiKey: true,
    envKeyName: 'NOVITA_API_KEY',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: new ObjectId(),
    name: 'anthropic',
    displayName: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    description: 'Anthropic Claude models',
    requiresApiKey: true,
    envKeyName: 'ANTHROPIC_API_KEY',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: new ObjectId(),
    name: 'google',
    displayName: 'Google AI',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    description: 'Google Gemini models',
    requiresApiKey: true,
    envKeyName: 'GOOGLE_AI_API_KEY',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: new ObjectId(),
    name: 'segmind',
    displayName: 'Segmind',
    baseUrl: 'https://api.segmind.com/v1',
    description: 'Segmind AI models including Grok 2 Vision',
    requiresApiKey: true,
    envKeyName: 'SEGMIND_API_KEY',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

// Template system prompts for chat and roleplay testing
const TEMPLATE_SYSTEM_PROMPTS = {
  chat_assistant: {
    name: 'Chat Assistant',
    prompt: 'You are a helpful, friendly, and engaging AI assistant designed for casual conversation. Respond naturally like you would in a chat app (WhatsApp, etc.). Keep responses conversational, warm, and appropriately brief unless more detail is requested. Use emojis sparingly but naturally. Be supportive, curious about the user, and maintain a friendly tone throughout the conversation.',
    description: 'Tests natural conversation ability and chat-like responses'
  },
  roleplay_character: {
    name: 'Roleplay Character',
    prompt: 'You are roleplaying as a character. Stay in character throughout the conversation. Respond based on your character\'s personality, background, and motivations. Be immersive and authentic to the role you\'re playing. Follow the character instructions given by the user and maintain consistency in your responses.',
    description: 'Tests ability to maintain character consistency and roleplay scenarios'
  },
  instruction_follower: {
    name: 'Instruction Follower',
    prompt: 'You are an AI that excels at following specific instructions precisely. Pay close attention to any formatting requirements, constraints, or specific behaviors requested by the user. Always confirm understanding of complex instructions and execute them accurately.',
    description: 'Tests ability to follow detailed instructions and maintain specified behavior'
  },
  emotional_support: {
    name: 'Emotional Support',
    prompt: 'You are a compassionate and empathetic AI companion. Provide emotional support and understanding. Listen actively, validate feelings, and offer appropriate comfort or encouragement. Be sensitive to emotional cues and respond with warmth and care.',
    description: 'Tests emotional intelligence and supportive conversation abilities'
  },
  creative_partner: {
    name: 'Creative Partner',
    prompt: 'You are a creative collaborative partner. Help brainstorm ideas, develop stories, create scenarios, and engage in imaginative conversations. Be inspiring, original, and build upon the user\'s creative ideas while adding your own unique contributions.',
    description: 'Tests creativity and collaborative conversation skills'
  }
};

// Template questions for different chat scenarios
const TEMPLATE_QUESTIONS = {
  casual_conversation: [
    "Hey! How's your day going? 😊",
    "What's something interesting you learned recently?",
    "If you could have dinner with anyone, who would it be and why?",
    "What's your favorite way to relax after a long day?",
    "Tell me about something that made you smile today"
  ],
  roleplay_scenarios: [
    "You're a medieval knight who just discovered a mysterious artifact. What do you do?",
    "You're a café owner in a small town. A regular customer seems upset today. How do you approach them?",
    "You're a detective investigating a strange case. Describe what you're thinking.",
    "You're a space explorer who just landed on an unknown planet. What's your first move?",
    "You're a wise wizard giving advice to a young apprentice. What wisdom do you share?"
  ],
  instruction_following: [
    "Please respond with exactly 3 sentences, each starting with a different letter of the alphabet in order.",
    "Format your response as a haiku about technology, then explain each line.",
    "Answer this question using only questions: What is the meaning of life?",
    "Respond as if you're writing a text message to a best friend, including appropriate abbreviations and emojis.",
    "Provide a response that includes exactly 2 facts, 1 opinion, and 1 question, clearly labeled."
  ],
  emotional_scenarios: [
    "I'm feeling really overwhelmed with work lately and don't know how to manage everything.",
    "I just got some amazing news and I'm so excited I could burst! Want to celebrate with me?",
    "I'm going through a tough breakup and could really use someone to talk to.",
    "I'm nervous about a big presentation tomorrow. Any advice for calming my nerves?",
    "I've been feeling disconnected from my friends lately. How do I reach out without seeming needy?"
  ],
  creative_collaboration: [
    "Let's create a story together! I'll start: 'The old bookshop had been closed for decades, but tonight, a light was flickering inside...'",
    "Help me brainstorm a unique birthday party theme for my friend who loves both science and art.",
    "I want to write a song about overcoming challenges. Can you help me with some verses?",
    "Let's design an imaginary world together. What kind of place should it be?",
    "I need ideas for a creative writing prompt that would challenge and inspire writers."
  ]
};

/**
 * Initialize default providers in the database
 */
const initializeDefaultProviders = async () => {
  try {
    const db = await connect();
    const collection = db.collection('chatProviders');
    
    // Check if providers already exist
    const existingCount = await collection.countDocuments();
    if (existingCount > 0) {
      console.log('Chat providers already initialized');
      return;
    }

    const result = await collection.insertMany(DEFAULT_PROVIDERS);
    console.log(`Initialized ${result.insertedCount} default chat providers`);
    return result;
  } catch (error) {
    console.error('Error initializing default providers:', error);
    throw error;
  }
};

/**
 * Get all providers from database
 * @param {boolean} includeInactive - Whether to include inactive providers
 * @returns {Promise<Array>} Array of provider objects
 */
const getAllProviders = async (includeInactive = false) => {
  try {
    const db = await connect();
    const collection = db.collection('chatProviders');
    
    const filter = includeInactive ? {} : { isActive: true };
    const providers = await collection.find(filter).sort({ displayName: 1 }).toArray();
    
    return providers;
  } catch (error) {
    console.error('Error getting providers:', error);
    throw error;
  }
};

/**
 * Get provider by name
 * @param {string} providerName - Provider name
 * @returns {Promise<Object|null>} Provider object or null
 */
const getProviderByName = async (providerName) => {
  try {
    const db = await connect();
    const collection = db.collection('chatProviders');
    
    const provider = await collection.findOne({ name: providerName, isActive: true });
    return provider;
  } catch (error) {
    console.error('Error getting provider by name:', error);
    throw error;
  }
};

/**
 * Initialize default models in the database
 * This should be run once to set up the initial model collection
 */
const initializeDefaultModels = async () => {
  try {
    // Initialize providers first
    await initializeDefaultProviders();
    
    const db = await connect();
    const collection = db.collection('chatModels');
    
    // Check if models already exist
    const existingCount = await collection.countDocuments();
    if (existingCount > 0) {
      console.log('Chat models already initialized');
      return;
    }

    // Default models from the existing configuration
    const defaultModels = [
      {
        _id: new ObjectId(),
        key: 'deepseek-v3-turbo',
        displayName: 'OpenAI GPT-4o',
        description: 'Advanced reasoning and creativity',
        provider: 'openai',
        modelId: 'gpt-4o',
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        isActive: true,
        category: 'premium',
        maxTokens: 4096,
        supportedLanguages: ['en', 'fr', 'ja', 'hi'],
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        _id: new ObjectId(),
        key: 'llama-3-70b',
        displayName: 'Llama 3 70B',
        description: 'Large-scale reasoning and analysis',
        provider: 'novita',
        modelId: 'meta-llama/llama-3-70b-instruct',
        apiUrl: 'https://api.novita.ai/v3/openai/chat/completions',
        isActive: true,
        category: 'premium',
        maxTokens: 4096,
        supportedLanguages: ['en', 'fr', 'ja', 'hi'],
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        _id: new ObjectId(),
        key: 'deepseek-v3-turbo',
        displayName: 'DeepSeek V3 Turbo',
        description: 'Advanced coding and reasoning',
        provider: 'novita',
        modelId: 'deepseek/deepseek-v3-turbo',
        apiUrl: 'https://api.novita.ai/v3/openai/chat/completions',
        isActive: true,
        category: 'premium',
        maxTokens: 4096,
        supportedLanguages: ['en', 'fr', 'ja', 'hi'],
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        _id: new ObjectId(),
        key: 'hermes-2-pro',
        displayName: 'Hermes 2 Pro',
        description: 'Balanced performance and speed',
        provider: 'novita',
        modelId: 'nousresearch/hermes-2-pro-llama-3-8b',
        apiUrl: 'https://api.novita.ai/v3/openai/chat/completions',
        isActive: true,
        category: 'free',
        maxTokens: 2048,
        supportedLanguages: ['en', 'fr', 'ja', 'hi'],
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        _id: new ObjectId(),
        key: 'mistral-nemo',
        displayName: 'Mistral Nemo',
        description: 'Fast and efficient responses',
        provider: 'novita',
        modelId: 'mistralai/mistral-nemo',
        apiUrl: 'https://api.novita.ai/v3/openai/chat/completions',
        isActive: true,
        category: 'free',
        maxTokens: 2048,
        supportedLanguages: ['en', 'fr', 'ja', 'hi'],
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        _id: new ObjectId(),
        key: 'grok-2-vision',
        displayName: 'Grok 2 Vision',
        description: 'Advanced vision-enabled AI with excellent reasoning',
        provider: 'segmind',
        modelId: 'grok-2-vision',
        apiUrl: 'https://api.segmind.com/v1/grok-2-vision',
        isActive: true,
        category: 'free',
        maxTokens: 4096,
        supportedLanguages: ['en', 'fr', 'ja', 'hi'],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    const result = await collection.insertMany(defaultModels);
    console.log(`Initialized ${result.insertedCount} default chat models`);
    return result;
  } catch (error) {
    console.error('Error initializing default models:', error);
    throw error;
  }
};

/**
 * Get all available chat models from database
 * @param {boolean} includeInactive - Whether to include inactive models
 * @returns {Promise<Array>} Array of model objects
 */
const getAllModels = async (includeInactive = false) => {
  try {
    const db = await connect();
    const collection = db.collection('chatModels');
    
    const filter = includeInactive ? {} : { isActive: true };
    const models = await collection.find(filter).sort({ displayName: 1 }).toArray();
    
    return models;
  } catch (error) {
    console.error('Error getting models:', error);
    throw error;
  }
};

/**
 * Get models formatted for the frontend
 * @param {boolean} includeInactive - Whether to include inactive models
 * @returns {Promise<Object>} Models formatted as key-value object
 */
const getAvailableModelsFormatted = async (includeInactive = false) => {
  try {
    const models = await getAllModels(includeInactive);
    const formatted = {};
    
    models.forEach(model => {
      formatted[model.key] = {
        _id: model._id,
        key: model.key,
        displayName: model.displayName,
        description: model.description,
        provider: model.provider,
        modelId: model.modelId,
        apiUrl: model.apiUrl,
        category: model.category,
        maxTokens: model.maxTokens,
        isActive: model.isActive,
        supportedLanguages: model.supportedLanguages,
        createdAt: model.createdAt,
        updatedAt: model.updatedAt
      };
    });
    
    return formatted;
  } catch (error) {
    console.error('Error formatting models:', error);
    throw error;
  }
};

/**
 * Add a new chat model to the database
 * @param {Object} modelData - Model data object
 * @returns {Promise<Object>} Inserted model object
 */
const addModel = async (modelData) => {
  try {
    const db = await connect();
    const collection = db.collection('chatModels');
    
    // Validate required fields
    const requiredFields = ['key', 'displayName', 'description', 'provider', 'modelId', 'apiUrl'];
    for (const field of requiredFields) {
      if (!modelData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    // Check if key already exists
    const existingModel = await collection.findOne({ key: modelData.key });
    if (existingModel) {
      throw new Error(`Model with key '${modelData.key}' already exists`);
    }
    
    const model = {
      _id: new ObjectId(),
      key: modelData.key,
      displayName: modelData.displayName,
      description: modelData.description,
      provider: modelData.provider,
      modelId: modelData.modelId,
      apiUrl: modelData.apiUrl,
      isActive: modelData.isActive !== undefined ? modelData.isActive : true,
      category: modelData.category || 'free',
      maxTokens: modelData.maxTokens || 2048,
      supportedLanguages: modelData.supportedLanguages || ['en'],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await collection.insertOne(model);
    return { ...model, _id: result.insertedId };
  } catch (error) {
    console.error('Error adding model:', error);
    throw error;
  }
};

/**
 * Update an existing chat model
 * @param {string} modelId - Model ID
 * @param {Object} updates - Updates object
 * @returns {Promise<Object>} Updated model object
 */
const updateModel = async (modelId, updates) => {
  try {
    const db = await connect();
    const collection = db.collection('chatModels');
    
    // Validate ObjectId
    if (!ObjectId.isValid(modelId)) {
      throw new Error('Invalid model ID format');
    }
    
    const updateData = {
      ...updates,
      updatedAt: new Date()
    };
    
    // Remove _id from updates if present
    delete updateData._id;
    
    const result = await collection.updateOne(
      { _id: new ObjectId(modelId) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      throw new Error('Model not found');
    }
    
    // Retrieve and return the updated document
    const updatedModel = await collection.findOne({ _id: new ObjectId(modelId) });
    return updatedModel;
  } catch (error) {
    console.error('Error updating model:', error);
    throw error;
  }
};

/**
 * Update an existing chat model by key
 * @param {string} modelKey - Model key
 * @param {Object} updates - Updates object
 * @returns {Promise<Object>} Updated model object
 */
const updateModelByKey = async (modelKey, updates) => {
  try {
    const db = await connect();
    const collection = db.collection('chatModels');
    
    const updateData = {
      ...updates,
      updatedAt: new Date()
    };
    
    // Remove _id from updates if present
    delete updateData._id;
    
    const result = await collection.updateOne(
      { key: modelKey },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      throw new Error('Model not found');
    }
    
    // Retrieve and return the updated document
    const updatedModel = await collection.findOne({ key: modelKey });
    return updatedModel;
  } catch (error) {
    console.error('Error updating model by key:', error);
    throw error;
  }
};

/**
 * Delete a chat model
 * @param {string} modelId - Model ID
 * @returns {Promise<boolean>} Success status
 */
const deleteModel = async (modelId) => {
  try {
    const db = await connect();
    const collection = db.collection('chatModels');
    
    // Validate ObjectId
    if (!ObjectId.isValid(modelId)) {
      throw new Error('Invalid model ID format');
    }
    
    const result = await collection.deleteOne({ _id: new ObjectId(modelId) });
    return result.deletedCount > 0;
  } catch (error) {
    console.error('Error deleting model:', error);
    throw error;
  }
};

/**
 * Delete a chat model by key
 * @param {string} modelKey - Model key
 * @returns {Promise<boolean>} Success status
 */
const deleteModelByKey = async (modelKey) => {
  try {
    const db = await connect();
    const collection = db.collection('chatModels');
    
    const result = await collection.deleteOne({ key: modelKey });
    return result.deletedCount > 0;
  } catch (error) {
    console.error('Error deleting model by key:', error);
    throw error;
  }
};

/**
 * Get a single model by key
 * @param {string} modelKey - Model key
 * @returns {Promise<Object|null>} Model object or null
 */
const getModelByKey = async (modelKey) => {
  try {
    const db = await connect();
    const collection = db.collection('chatModels');
    
    const model = await collection.findOne({ key: modelKey, isActive: true });
    return model;
  } catch (error) {
    console.error('Error getting model by key:', error);
    throw error;
  }
};

/**
 * Test a single model with a question
 * @param {string} modelKey - Model key
 * @param {string} question - Question to test
 * @param {string} systemPrompt - System prompt for the model
 * @param {string} language - Language code (en, fr, ja)
 * @param {number} maxTokens - Maximum tokens for response
 * @returns {Promise<Object>} Model response and metadata
 */
const testSingleModel = async (modelKey, question, systemPrompt, language, maxTokens = 1000) => {
  try {
    const model = await getModelByKey(modelKey);
    
    if (!model) {
      throw new Error(`Unknown or inactive model: ${modelKey}`);
    }

    // Get provider information
    const provider = await getProviderByName(model.provider);
    if (!provider) {
      throw new Error(`Unknown provider: ${model.provider}`);
    }

    // Get API key from environment using provider configuration
    const apiKey = process.env[provider.envKeyName];
    if (!apiKey) {
      throw new Error(`API key not configured for provider: ${model.provider} (${provider.envKeyName})`);
    }

    const startTime = Date.now();

    const requestBody = {
      model: model.modelId,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: question
        }
      ],
      temperature: 1,
      max_completion_tokens: Math.min(maxTokens, model.maxTokens),
      stream: false,
      n: 1
    };

    console.log(`[Model Test] Testing ${modelKey} (${model.displayName}) with language ${language}`);

    // Build headers based on provider (Segmind uses x-api-key, others use Authorization Bearer)
    const headers = {
      'Content-Type': 'application/json'
    };
    if (model.provider === 'segmind') {
      headers['x-api-key'] = apiKey;
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(model.apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`[Model Test] API Error for ${modelKey}:`, {
        status: response.status,
        error: errorData.error?.message,
        responseTime
      });
      return {
        success: false,
        error: errorData.error?.message || `HTTP ${response.status}`,
        responseTime,
        tokens: { total: 0, prompt: 0, completion: 0 },
        modelName: model.displayName,
        provider: model.provider
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || 'No response';
    const usage = data.usage || { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };

    // Encode response content as base64 for safe storage
    const base64Content = Buffer.from(content, 'utf-8').toString('base64');

    return {
      success: true,
      content: base64Content,
      responseTime,
      tokens: {
        total: usage.total_tokens,
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens
      },
      modelName: model.displayName,
      provider: model.provider,
      rawResponse: content
    };

  } catch (error) {
    console.error(`[Model Test] Error testing ${modelKey}:`, error);
    return {
      success: false,
      error: error.message,
      responseTime: 0,
      tokens: { total: 0, prompt: 0, completion: 0 },
      modelName: modelKey,
      provider: 'unknown'
    };
  }
};

/**
 * Test multiple models with multiple questions
 * @param {Array} modelKeys - Array of model keys to test
 * @param {Array} questions - Array of questions to test
 * @param {string} baseSystemPrompt - Base system prompt
 * @param {Array} languages - Array of language codes
 * @param {number} maxTokens - Maximum tokens per response
 * @returns {Promise<Object>} Test results organized by language and question
 */
const testMultipleModels = async (modelKeys, questions, baseSystemPrompt, languages, maxTokens = 1000) => {
  const results = {};
  
  console.log(`[Test Suite] Starting test with ${modelKeys.length} models, ${questions.length} questions, ${languages.length} languages`);
  
  for (const language of languages) {
    results[language] = {};
    
    // Build language-specific system prompt
    const languageDirectives = {
      'en': 'Respond in English only.',
      'fr': 'Répondez uniquement en français.',
      'ja': '日本語でのみ答えてください。'
    };
    
    const directive = languageDirectives[language] || languageDirectives['en'];
    const systemPrompt = `${baseSystemPrompt}\n\n[LANGUAGE DIRECTIVE] ${directive}`;
    
    for (const question of questions) {
      results[language][question] = {};
      
      console.log(`[Test Suite] Testing question "${question.substring(0, 50)}..." in ${language}`);
      
      // Test all models for this question/language combination
      const modelPromises = modelKeys.map(modelKey =>
        testSingleModel(modelKey, question, systemPrompt, language, maxTokens)
          .then(result => ({ modelKey, result }))
      );
      
      const modelResults = await Promise.all(modelPromises);
      
      modelResults.forEach(({ modelKey, result }) => {
        results[language][question][modelKey] = result;
      });
    }
  }
  
  console.log('[Test Suite] Test completed');
  return results;
};

/**
 * Save test results to database
 * @param {Object} testData - Test configuration and results
 * @returns {Promise<Object>} Saved test record
 */
const saveTestResults = async (testData) => {
  try {
    const db = await connect();
    const collection = db.collection('chatModelTestResults');
    
    const testRecord = {
      _id: new ObjectId(),
      models: testData.models,
      questions: testData.questions,
      systemPrompt: testData.systemPrompt,
      languages: testData.languages,
      maxTokens: testData.maxTokens,
      results: testData.results,
      createdAt: new Date(),
      summary: generateResultsSummary(testData.results)
    };
    
    const result = await collection.insertOne(testRecord);
    return { ...testRecord, _id: result.insertedId };
  } catch (error) {
    console.error('Error saving test results:', error);
    throw error;
  }
};

/**
 * Get test results history
 * @param {number} limit - Maximum number of results to return
 * @param {number} offset - Number of results to skip
 * @returns {Promise<Object>} Test results and pagination info
 */
const getTestResults = async (limit = 20, offset = 0) => {
  try {
    const db = await connect();
    const collection = db.collection('chatModelTestResults');
    
    const total = await collection.countDocuments();
    const results = await collection
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(offset)
      .toArray();
    
    return {
      results,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    };
  } catch (error) {
    console.error('Error getting test results:', error);
    throw error;
  }
};

/**
 * Get a specific test result by ID
 * @param {string} testId - Test result ID
 * @returns {Promise<Object|null>} Test result or null
 */
const getTestResultById = async (testId) => {
  try {
    const db = await connect();
    const collection = db.collection('chatModelTestResults');
    
    const result = await collection.findOne({ _id: new ObjectId(testId) });
    return result;
  } catch (error) {
    console.error('Error getting test result by ID:', error);
    throw error;
  }
};

/**
 * Delete test results
 * @param {string} testId - Test result ID
 * @returns {Promise<boolean>} Success status
 */
const deleteTestResults = async (testId) => {
  try {
    const db = await connect();
    const collection = db.collection('chatModelTestResults');
    
    const result = await collection.deleteOne({ _id: new ObjectId(testId) });
    return result.deletedCount > 0;
  } catch (error) {
    console.error('Error deleting test results:', error);
    throw error;
  }
};

/**
 * Generate summary statistics for test results
 * @param {Object} results - Test results object
 * @returns {Object} Summary statistics
 */
const generateResultsSummary = (results) => {
  let totalTests = 0;
  let successfulTests = 0;
  const modelStats = {};
  const languageStats = {};
  
  Object.entries(results).forEach(([language, questions]) => {
    languageStats[language] = { total: 0, successful: 0 };
    
    Object.entries(questions).forEach(([question, models]) => {
      Object.entries(models).forEach(([modelKey, result]) => {
        totalTests++;
        languageStats[language].total++;
        
        if (!modelStats[modelKey]) {
          modelStats[modelKey] = { total: 0, successful: 0, totalResponseTime: 0 };
        }
        modelStats[modelKey].total++;
        modelStats[modelKey].totalResponseTime += result.responseTime || 0;
        
        if (result.success) {
          successfulTests++;
          languageStats[language].successful++;
          modelStats[modelKey].successful++;
        }
      });
    });
  });
  
  // Calculate average response times
  Object.keys(modelStats).forEach(modelKey => {
    const stats = modelStats[modelKey];
    stats.averageResponseTime = stats.total > 0 ? Math.round(stats.totalResponseTime / stats.total) : 0;
    stats.successRate = stats.total > 0 ? Math.round((stats.successful / stats.total) * 100) : 0;
  });
  
  return {
    totalTests,
    successfulTests,
    overallSuccessRate: totalTests > 0 ? Math.round((successfulTests / totalTests) * 100) : 0,
    modelStats,
    languageStats
  };
};

/**
 * Get template system prompts
 * @returns {Object} Template system prompts
 */
const getTemplateSystemPrompts = () => {
  return TEMPLATE_SYSTEM_PROMPTS;
};

/**
 * Get template questions
 * @returns {Object} Template questions organized by category
 */
const getTemplateQuestions = () => {
  return TEMPLATE_QUESTIONS;
};

module.exports = {
  initializeDefaultModels,
  initializeDefaultProviders,
  getAllModels,
  getAllProviders,
  getProviderByName,
  getAvailableModelsFormatted,
  addModel,
  updateModel,
  updateModelByKey,
  deleteModel,
  deleteModelByKey,
  getModelByKey,
  testSingleModel,
  testMultipleModels,
  saveTestResults,
  getTestResults,
  getTestResultById,
  deleteTestResults,
  generateResultsSummary,
  getTemplateSystemPrompts,
  getTemplateQuestions
};