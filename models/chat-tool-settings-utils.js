const { ObjectId } = require('mongodb');
const DEFAULT_CHAT_SETTINGS = require('../config/default-chat-settings.json');

/**
 * Get user's chat tool settings with fallback to defaults
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} chatId - Optional chat ID for chat-specific settings
 * @returns {Object} User settings or default settings
 */
async function getUserChatToolSettings(db, userId, chatId = null) {
    try {
        if (!userId || !ObjectId.isValid(userId)) {
            console.warn('[getUserChatToolSettings] Invalid userId provided:', userId);
            return DEFAULT_CHAT_SETTINGS;
        }

        const collection = db.collection('chatToolSettings');
        
        // If chatId is provided, try to get chat-specific settings first
        if (chatId && ObjectId.isValid(chatId)) {
            const chatSettings = await collection.findOne({ 
                userId: new ObjectId(userId),
                chatId: new ObjectId(chatId)
            });

            if (chatSettings) {
                const { _id, userId: userIdField, chatId: chatIdField, createdAt, updatedAt, ...settings } = chatSettings;
                return { ...DEFAULT_CHAT_SETTINGS, ...settings };
            }
        }
        
        // Fallback to user default settings
        const userSettings = await collection.findOne({ 
            userId: new ObjectId(userId),
            chatId: { $exists: false }
        });

        if (userSettings) {
            const { _id, userId: userIdField, createdAt, updatedAt, ...settings } = userSettings;
            return { ...DEFAULT_CHAT_SETTINGS, ...settings };
        }
        
        return DEFAULT_CHAT_SETTINGS;
        
    } catch (error) {
        console.error('[getUserChatToolSettings] Error fetching settings:', error);
        return DEFAULT_CHAT_SETTINGS;
    }
}

/**
 * Apply user settings and character data to system prompt generation
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} chatId - Optional chat ID
 * @param {string} basePrompt - Base system prompt
 * @param {Object} chatDocument - Chat document containing character data
 * @param {Object} userChatCustomizations - Optional user-specific customizations from userChat document
 * @returns {string} Enhanced system prompt with user preferences and character context
 */
async function applyUserSettingsToPrompt(db, userId, chatId, basePrompt, chatDocument = null, userChatCustomizations = null) {
    try {
        let enhancedPrompt = basePrompt;
        
        // Get character gender from chat document
        const characterGender = chatDocument?.gender || 'female';
        
        // Use user customizations if available, otherwise fall back to character defaults
        const relationshipType = userChatCustomizations?.relationship || chatDocument?.relationship || 'companion';
        const personality = userChatCustomizations?.personality || chatDocument?.characterPersonality;
        const occupation = userChatCustomizations?.occupation || chatDocument?.characterOccupation;
        const preferences = userChatCustomizations?.preferences || chatDocument?.characterPreferences;
        const customInstructions = userChatCustomizations?.customInstructions;
        
        // Apply relationship type from character creation - handle both new gender-based and legacy formats
        const { relationshipInstructions } = require('./relashionshipInstructions');
        const genderKey = characterGender?.toLowerCase() === 'male' ? 'male' : 'female';
        
        if (relationshipInstructions[genderKey] && relationshipInstructions[genderKey][relationshipType]) {
            enhancedPrompt += `\n# Relationship Context:\n${relationshipInstructions[genderKey][relationshipType]}`;
        } else if (relationshipInstructions[genderKey] && relationshipInstructions[genderKey].companion) {
            enhancedPrompt += `\n# Relationship Context:\n${relationshipInstructions[genderKey].companion}`;
        }
        
        // Add instructions for NSFW relationships if applicable
        const nsfw_relationships = ['lover', 'submissive', 'dominant', 'playmate', 'intimate'];
        if (nsfw_relationships.includes(relationshipType)) {
            enhancedPrompt += `\n# NSFW Relationship Context:\nYou are in a ${relationshipType} relationship. Use explicit, sensual language and describe intimate acts in detail.`;
        }
        
        // Add character personality context (using user customizations or character defaults)
        let characterContext = '\n# Character Context:';
        
        if (personality) {
            characterContext += `\nPersonality: You have a ${personality} personality. Embody this trait in your responses.`;
        }
        
        if (occupation) {
            characterContext += `\nOccupation: You work as a ${occupation}. Reference this naturally in conversations when relevant.`;
        }
        
        if (preferences) {
            characterContext += `\nPreferences: You are into ${preferences}. Express this naturally when the conversation leads there.`;
        }
        
        // Add character's original chat purpose if available
        if (chatDocument?.chatPurpose) {
            characterContext += `\nCharacter Background: ${chatDocument.chatPurpose}`;
        }
        
        // Add user's custom instructions (this is user-specific for this chat session)
        if (customInstructions && customInstructions.trim()) {
            characterContext += `\nUser's Special Instructions: ${customInstructions}`;
        }
        
        // Only add character context section if we have any character data
        if (characterContext !== '\n# Character Context:') {
            enhancedPrompt += characterContext;
        }
        
        return enhancedPrompt;
        
    } catch (error) {
        console.error('[applyUserSettingsToPrompt] Error applying settings:', error);
        return basePrompt;
    }
}

/**
 * Get user customizations from userChat document
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} chatId - Chat ID (character ID)
 * @returns {Object|null} User customizations object or null if not found
 */
async function getUserChatCustomizations(db, userId, chatId) {
    try {
        if (!userId || !ObjectId.isValid(userId) || !chatId || !ObjectId.isValid(chatId)) {
            return null;
        }

        const userChatCollection = db.collection('userChat');
        // Handle both ObjectId and string formats for chatId
        const userChat = await userChatCollection.findOne({
            $or: [
                { userId: new ObjectId(userId), chatId: new ObjectId(chatId) },
                { userId: new ObjectId(userId), chatId: chatId.toString() }
            ]
        });

        return userChat?.userCustomizations || null;
        
    } catch (error) {
        console.error('[getUserChatCustomizations] Error:', error.message);
        return null;
    }
}
//getUserVideoPrompt
/**
 * Get user-specific video prompt or default if not set
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} chatId - Optional chat ID
 * @returns {string} Video prompt for the user
 */
async function getUserVideoPrompt(db, userId, chatId = null) {
    try {
        const settings = await getUserChatToolSettings(db, userId, chatId);
        
        // Return user-specific video prompt or default if not set
        return settings.videoPrompt || DEFAULT_CHAT_SETTINGS.videoPrompt;
        
    } catch (error) {
        console.error('[getUserVideoPrompt] Error getting video prompt:', error);
        return DEFAULT_CHAT_SETTINGS.videoPrompt;
    }
}
/**
 * Get voice settings for TTS generation
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} chatId - Optional chat ID
 * @returns {Object} Voice configuration with provider info
 */
async function getVoiceSettings(db, userId, chatId = null) {
    try {
        const settings = await getUserChatToolSettings(db, userId, chatId);
        
        const voiceProviderRaw = settings.voiceProvider || 'standard';
        const normalizedProvider = String(voiceProviderRaw).toLowerCase();

        if (normalizedProvider === 'premium' || normalizedProvider === 'minimax' || normalizedProvider === 'evenlab') {
            const minimaxVoice = settings.minimaxVoice || settings.evenLabVoice || DEFAULT_CHAT_SETTINGS.minimaxVoice;
            return {
                provider: 'minimax',
                voice: minimaxVoice,
                voiceName: minimaxVoice
            };
        }

        const selectedVoice = settings.selectedVoice || 'nova';

        const voiceConfig = {
            alloy: { voice: 'alloy', gender: 'neutral' },
            fable: { voice: 'fable', gender: 'neutral' },
            nova: { voice: 'nova', gender: 'female' },
            shimmer: { voice: 'shimmer', gender: 'female' }
        };

        const voiceConfigEntry = voiceConfig[selectedVoice] || voiceConfig.nova;

        return {
            provider: 'openai',
            ...voiceConfigEntry
        };
        
    } catch (error) {
        console.error('[getVoiceSettings] Error getting voice settings:', error);
        return { 
            provider: 'openai',
            voice: 'nova', 
            gender: 'female' 
        };
    }
}
/*
    * Get minimum number of images setting
    * @param {Object} db - MongoDB database instance
    * @param {string} userId - User ID
    * @param {string} chatId - Optional chat ID
    * @returns {number} Minimum number of images
    */      
async function getUserMinImages(db, userId, chatId = null) {
    try {
        const settings = await getUserChatToolSettings(db, userId, chatId);
        return settings.minImages || DEFAULT_CHAT_SETTINGS.minImages;
    } catch (error) {
        console.error('[getUserMinImages] Error getting minimum images:', error);
        return DEFAULT_CHAT_SETTINGS.minImages;
    }
}

/**
 * Get default image ratio setting
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} chatId - Optional chat ID
 * @returns {string} Default image ratio (e.g., '1:1', '9:16', '16:9')
 */
async function getDefaultImageRatio(db, userId, chatId = null) {
    try {
        const settings = await getUserChatToolSettings(db, userId, chatId);
        return settings.defaultImageRatio || DEFAULT_CHAT_SETTINGS.defaultImageRatio || '9:16';
    } catch (error) {
        console.error('[getDefaultImageRatio] Error getting default image ratio:', error);
        return DEFAULT_CHAT_SETTINGS.defaultImageRatio || '9:16';
    }
}

/**
 * Get auto merge face setting
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} chatId - Optional chat ID
 * @returns {boolean} Auto merge face enabled
 */
async function getAutoMergeFaceSetting(db, userId, chatId = null) {
    try {
        const settings = await getUserChatToolSettings(db, userId, chatId);
        return settings.autoMergeFace !== undefined ? settings.autoMergeFace : DEFAULT_CHAT_SETTINGS.autoMergeFace;
    } catch (error) {
        console.error('[getAutoMergeFaceSetting] Error getting auto merge face setting:', error);
        return DEFAULT_CHAT_SETTINGS.autoMergeFace;
    }
}

/**
 * Get user's selected model setting
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} chatId - Optional chat ID for chat-specific settings
 * @returns {string} Selected model key
 */
async function getUserSelectedModel(db, userId, chatId = null) {
    try {
        const settings = await getUserChatToolSettings(db, userId, chatId);
        let selectedModel = settings.selectedModel;
        
        // If no model selected, try to get a default from available models
        if (!selectedModel) {
            try {
                const { getAvailableModelsFormatted } = require('./chat-model-utils');
                const dbModels = await getAvailableModelsFormatted();
                
                if (dbModels && Object.keys(dbModels).length > 0) {
                    // Get first available free model as default
                    const freeModels = Object.entries(dbModels).filter(([key, model]) => model.category !== 'premium');
                    if (freeModels.length > 0) {
                        selectedModel = freeModels[0][0];
                    }
                }
            } catch (dbError) {
                console.log('[getUserSelectedModel] Database not available, using legacy default');
            }
            
            // Final fallback to legacy default
            selectedModel = selectedModel || 'openai';
        }
        
        return selectedModel;
    } catch (error) {
        console.error('[getUserSelectedModel] Error getting selected model:', error);
        return 'openai'; // Changed default to openai as it's more commonly available
    }
}

/**
 * Check if user has premium subscription
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @returns {boolean} Whether user has premium subscription
 */
async function getUserPremiumStatus(db, userId) {
    try {
        if (!userId || !ObjectId.isValid(userId)) {
            return false;
        }

        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ 
            _id: new ObjectId(userId) 
        });
        
        return user?.subscriptionStatus === 'active';
        
    } catch (error) {
        console.error('[getUserPremiumStatus] Error checking premium status:', error);
        return false;
    }
}

/**
 * Check if auto image generation is enabled for user
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} chatId - Optional chat ID for chat-specific settings
 * @returns {boolean} Whether auto image generation is enabled
 */
async function getAutoImageGenerationSetting(db, userId, chatId = null) {
    try {
        const settings = await getUserChatToolSettings(db, userId, chatId);
        return settings.autoImageGeneration !== undefined ? settings.autoImageGeneration : DEFAULT_CHAT_SETTINGS.autoImageGeneration;
    } catch (error) {
        console.error('[getAutoImageGenerationSetting] Error getting auto image generation setting:', error);
        return DEFAULT_CHAT_SETTINGS.autoImageGeneration;
    }
}

/**
 * Check if user has ever chatted with a specific character
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} chatId - Chat ID (character ID)
 * @returns {boolean} True if user has chatted with this character (has messages), false otherwise
 */
async function hasUserChattedWithCharacter(db, userId, chatId) {
    try {
        if (!userId || !ObjectId.isValid(userId) || !chatId || !ObjectId.isValid(chatId)) {
            return false;
        }

        const userChatCollection = db.collection('userChat');
        
        // Convert to ObjectId for proper query
        const userIdObj = new ObjectId(userId);
        const chatIdObj = new ObjectId(chatId);
        
        // Query using both ObjectId and string formats (like gallery.js)
        const query = {
            $or: [
                { userId: userIdObj, chatId: chatIdObj },
                { userId: userIdObj, chatId: chatId.toString() },
                { userId: userId.toString(), chatId: chatIdObj }
            ]
        };
        
        const userChat = await userChatCollection.findOne(query);
        
        if (userChat) {
            // Check if userChat has actual messages
            const messageCount = userChat.messages ? userChat.messages.length : 0;
            
            // Only consider it as "chatted" if there are actual messages
            if (messageCount === 0) {
                return false;
            }
        } else {
            return false;
        }
        
        return !!userChat && userChat.messages && userChat.messages.length > 0;
        
    } catch (error) {
        console.error('[hasUserChattedWithCharacter] Error:', error.message);
        return false;
    }
}

/**
 * Get available relationships for a given gender
 * @param {string} gender - 'male' or 'female'
 * @returns {Object} { free: [...], premium: [...] }
 */
function getAvailableRelationshipsByGender(gender = 'female') {
    const { relationshipInstructions, relationshipTiers } = require('./relashionshipInstructions');
    const key = gender && String(gender).toLowerCase() === 'male' ? 'male' : 'female';
    const rels = relationshipInstructions[key] || {};
    // SFW relationships (not NSFW/premium)
    const free = Object.keys(rels).filter(r => relationshipTiers.free.includes(r));
    // Premium/NSFW relationships
    const premium = Object.keys(rels).filter(r => relationshipTiers.premium.includes(r));
    return { free, premium };
}

/**
 * Get user's preferred chat language
 * Checks chatToolSettings first, then falls back to user profile's preferredChatLanguage
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} chatId - Optional chat ID for chat-specific settings
 * @returns {string} Preferred chat language or empty string if not set
 */
async function getPreferredChatLanguage(db, userId, chatId = null) {
    try {
        // First check chat tool settings
        const settings = await getUserChatToolSettings(db, userId, chatId);
        if (settings.preferredChatLanguage) {
            console.log(`🌐 [getPreferredChatLanguage] Found in chatToolSettings: "${settings.preferredChatLanguage}" (userId: ${userId}, chatId: ${chatId})`);
            return settings.preferredChatLanguage;
        }
        
        // Fall back to user profile's preferredChatLanguage (set during onboarding)
        if (userId && ObjectId.isValid(userId)) {
            const usersCollection = db.collection('users');
            const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
            if (user?.preferredChatLanguage) {
                console.log(`🌐 [getPreferredChatLanguage] Found in user profile: "${user.preferredChatLanguage}" (userId: ${userId})`);
                return user.preferredChatLanguage;
            }
        }
        
        console.log(`🌐 [getPreferredChatLanguage] No preference found (userId: ${userId}, chatId: ${chatId})`);
        return '';
    } catch (error) {
        console.error('[getPreferredChatLanguage] Error getting preferred chat language:', error);
        return '';
    }
}

module.exports = {
    DEFAULT_CHAT_SETTINGS,
    getUserChatToolSettings,
    applyUserSettingsToPrompt,
    getUserVideoPrompt,
    getVoiceSettings,
    getUserMinImages,
    getDefaultImageRatio,
    getAutoMergeFaceSetting,
    getUserSelectedModel,
    getUserPremiumStatus,
    getAutoImageGenerationSetting,
    hasUserChattedWithCharacter,
    getAvailableRelationshipsByGender,
    getUserChatCustomizations,
    getPreferredChatLanguage
};
