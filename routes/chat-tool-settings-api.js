const { ObjectId } = require('mongodb');
const { getVoiceSettings, hasUserChattedWithCharacter } = require('../models/chat-tool-settings-utils');
const { getUserChatToolSettings } = require('../models/chat-tool-settings-utils');

const DEFAULT_CHAT_SETTINGS = require('../config/default-chat-settings.json');


async function routes(fastify, options) {
    // Get available relationships based on gender
    fastify.get('/api/chat-tool-settings/relationships/:gender', async (request, reply) => {
        try {
            const { gender } = request.params;
            const { getAvailableRelationshipsByGender } = require('../models/chat-tool-settings-utils');
            const rels = getAvailableRelationshipsByGender(gender);
            reply.send({ success: true, relationships: rels });
        } catch (error) {
            console.error('Error fetching relationships:', error);
            reply.status(500).send({ error: 'Internal server error' });
        }
    });
    
    // Get user's chat tool settings
    fastify.get('/api/chat-tool-settings/:userId', async (request, reply) => {
        try {
            const { userId } = request.params;
            
            if (!userId || !ObjectId.isValid(userId)) {
                return reply.status(400).send({ error: 'Invalid user ID' });
            }

            // Check user subscription status and get preferredChatLanguage from user profile
            const usersCollection = fastify.mongo.db.collection('users');
            const user = await usersCollection.findOne({ 
                _id: new ObjectId(userId) 
            });
            const isPremium = user?.subscriptionStatus === 'active';
            const userPreferredChatLanguage = user?.preferredChatLanguage || '';

            const collection = fastify.mongo.db.collection('chatToolSettings');
            const settings = await collection.findOne({ 
                userId: new ObjectId(userId),
                chatId: { $exists: false }
            });
            
            if (!settings) {
                // Return default settings with user's preferredChatLanguage from profile
                const defaultWithUserLang = { 
                    ...DEFAULT_CHAT_SETTINGS, 
                    preferredChatLanguage: userPreferredChatLanguage 
                };
                return reply.send({ success: true, settings: defaultWithUserLang, isPremium });
            }

            // Remove MongoDB specific fields from response
            const { _id, userId: userIdField, createdAt, updatedAt, ...userSettings } = settings;

            if (!userSettings.minimaxVoice && userSettings.evenLabVoice) {
                userSettings.minimaxVoice = userSettings.evenLabVoice;
            }
            delete userSettings.evenLabVoice;

            if (!userSettings.voiceProvider) {
                userSettings.voiceProvider = 'standard';
            }
            
            // Initialize preferredChatLanguage from user profile if not set in settings
            if (!userSettings.preferredChatLanguage && userPreferredChatLanguage) {
                userSettings.preferredChatLanguage = userPreferredChatLanguage;
            }
            
            // Override autoImageGeneration for non-premium users
            if (!isPremium) {
                userSettings.autoImageGeneration = false;
            }
            
            reply.send({ success: true, settings: userSettings, isPremium });
            
        } catch (error) {
            console.error('Error fetching chat tool settings:', error);
            reply.status(500).send({ error: 'Internal server error' });
        }
    });

    // Save/Update user's chat tool settings (supports both global and chat-specific)
    fastify.post('/api/chat-tool-settings/:userId', async (request, reply) => {
        try {
            const { userId } = request.params;
            const { settings, chatId, userChatId } = request.body;
            
            if (!userId || !ObjectId.isValid(userId)) {
                return reply.status(400).send({ error: 'Invalid user ID' });
            }

            if (!settings || typeof settings !== 'object') {
                return reply.status(400).send({ error: 'Settings object is required' });
            }

            // Validate chatId if provided
            if (chatId && !ObjectId.isValid(chatId)) {
                return reply.status(400).send({ error: 'Invalid chat ID' });
            }

            // Check user subscription status
            const usersCollection = fastify.mongo.db.collection('users');
            const user = await usersCollection.findOne({ 
                _id: new ObjectId(userId) 
            });
            const isPremium = user?.subscriptionStatus === 'active';

            // Validate settings structure
            const requestedProvider = String(settings.voiceProvider || 'standard').toLowerCase();
            const normalizedProvider = ['premium', 'minimax', 'evenlab'].includes(requestedProvider) ? 'premium' : 'standard';

            const validSettings = {
                minImages: Number(settings.minImages) || 3,
                videoPrompt: String(settings.videoPrompt || 'Generate a short, engaging video with smooth transitions and vibrant colors.'),
                characterTone: String(settings.characterTone || 'casual'),
                relationshipType: String(settings.relationshipType || 'companion'),
                selectedVoice: String(settings.selectedVoice || 'nova'),
                voiceProvider: normalizedProvider,
                minimaxVoice: String(settings.minimaxVoice || settings.evenLabVoice || 'Wise_Woman'),
                autoMergeFace: Boolean(settings.autoMergeFace !== undefined ? settings.autoMergeFace : true),
                selectedModel: String(settings.selectedModel || 'openai'),
                suggestionsEnabled: Boolean(settings.suggestionsEnabled !== undefined ? settings.suggestionsEnabled : true),
                autoImageGeneration: isPremium ? Boolean(settings.autoImageGeneration !== undefined ? settings.autoImageGeneration : false) : false,
                speechRecognitionEnabled: Boolean(settings.speechRecognitionEnabled !== undefined ? settings.speechRecognitionEnabled : true),
                speechAutoSend: Boolean(settings.speechAutoSend !== undefined ? settings.speechAutoSend : false),
                scenariosEnabled: Boolean(settings.scenariosEnabled !== undefined ? settings.scenariosEnabled : false),
                customPromptEnabled: Boolean(settings.customPromptEnabled !== undefined ? settings.customPromptEnabled : true),
                defaultDescriptionEnabled: Boolean(settings.defaultDescriptionEnabled !== undefined ? settings.defaultDescriptionEnabled : false),
                defaultDescription: String(settings.defaultDescription || ''),
                preferredChatLanguage: String(settings.preferredChatLanguage || '')
            };

            // Only keep the field that exists in the incoming settings
            Object.keys(validSettings).forEach(key => {
                if (!(key in settings)) {
                    delete validSettings[key];
                }
            });

            // Validate ranges and constraints
            if (validSettings.minImages !== undefined && (validSettings.minImages < 1 || validSettings.minImages > 20)) {
                return reply.status(400).send({ error: 'minImages must be between 1 and 20' });
            }

            if (validSettings.videoPrompt !== undefined && validSettings.videoPrompt.length > 500) {
                return reply.status(400).send({ error: 'videoPrompt must be less than 500 characters' });
            }
            const collection = fastify.mongo.db.collection('chatToolSettings');
            const now = new Date();

            // Build query for upsert
            const query = { userId: new ObjectId(userId) };
            if (chatId) {
                query.chatId = new ObjectId(chatId);
            } else {
                query.chatId = { $exists: false };
            }

            const updateDoc = {
                $set: {
                    ...validSettings,
                    updatedAt: now
                },
                $setOnInsert: {
                    userId: new ObjectId(userId),
                    createdAt: now
                }
            };

            if (chatId) {
                updateDoc.$setOnInsert.chatId = new ObjectId(chatId);
            }

            const result = await collection.updateOne(query, updateDoc, { upsert: true });

            // If userChatId is provided and preferredChatLanguage is set, also update the userChat collection
            if (userChatId && ObjectId.isValid(userChatId) && validSettings.preferredChatLanguage !== undefined) {
                try {
                    const userChatCollection = fastify.mongo.db.collection('userChat');
                    await userChatCollection.updateOne(
                        { 
                            _id: new ObjectId(userChatId),
                            userId: new ObjectId(userId)
                        },
                        { 
                            $set: { 
                                preferredChatLanguage: validSettings.preferredChatLanguage,
                                updatedAt: now
                            } 
                        }
                    );
                } catch (userChatError) {
                    console.error('Error updating userChat preferredChatLanguage:', userChatError);
                    // Don't fail the whole request if userChat update fails
                }
            }

            reply.send({ 
                success: true, 
                message: chatId ? 'Chat-specific settings saved successfully' : 'Settings saved successfully',
                settings: validSettings,
                isChatSpecific: !!chatId,
                isPremium
            });
            
        } catch (error) {
            console.error('Error saving chat tool settings:', error);
            reply.status(500).send({ error: 'Internal server error' });
        }
    });

    // Reset user's chat tool settings to default
    fastify.delete('/api/chat-tool-settings/:userId', async (request, reply) => {
        try {
            const { userId } = request.params;
            const { chatId } = request.query;
            
            if (!userId || !ObjectId.isValid(userId)) {
                return reply.status(400).send({ error: 'Invalid user ID' });
            }

            if (chatId && !ObjectId.isValid(chatId)) {
                return reply.status(400).send({ error: 'Invalid chat ID' });
            }

            // Check user subscription status
            const usersCollection = fastify.mongo.db.collection('users');
            const user = await usersCollection.findOne({ 
                _id: new ObjectId(userId) 
            });
            const isPremium = user?.subscriptionStatus === 'active';

            const collection = fastify.mongo.db.collection('chatToolSettings');
            const query = { userId: new ObjectId(userId) };
            
            if (chatId) {
                query.chatId = new ObjectId(chatId);
            } else {
                query.chatId = { $exists: false };
            }

            await collection.deleteOne(query);

            reply.send({ 
                success: true, 
                message: chatId ? 'Chat-specific settings reset to default' : 'Settings reset to default',
                settings: DEFAULT_CHAT_SETTINGS,
                isChatSpecific: !!chatId,
                isPremium
            });
            
        } catch (error) {
            console.error('Error resetting chat tool settings:', error);
            reply.status(500).send({ error: 'Internal server error' });
        }
    });

    // Get settings for specific chat/userChat (with user defaults as fallback)
    fastify.get('/api/chat-tool-settings/:userId/:chatId', async (request, reply) => {
        try {
            
            const { userId, chatId } = request.params;
            
            if (!userId || !ObjectId.isValid(userId) || !chatId || !ObjectId.isValid(chatId)) {
                return reply.status(400).send({ error: 'Invalid user ID or chat ID' });
            }

            // Check user subscription status
            const usersCollection = fastify.mongo.db.collection('users');
            const user = await usersCollection.findOne({ 
                _id: new ObjectId(userId) 
            });
            const isPremium = user?.subscriptionStatus === 'active';

            // Use utility function to get settings with fallback
            const settings = await getUserChatToolSettings(fastify.mongo.db, userId, chatId);
            
            // Override autoImageGeneration for non-premium users
            if (!isPremium) {
                settings.autoImageGeneration = false;
            }

            reply.send({ success: true, settings, isPremium });
            
        } catch (error) {
            console.error('Error fetching chat-specific settings:', error);
            reply.status(500).send({ error: 'Internal server error' });
        }
    });

    // Get available models based on user subscription status
    fastify.get('/api/chat-tool-settings/models/:userId', async (request, reply) => {
        try {
            const { userId } = request.params;
            
            if (!userId || !ObjectId.isValid(userId)) {
                return reply.status(400).send({ error: 'Invalid user ID' });
            }

            // Check user subscription status
            const usersCollection = fastify.mongo.db.collection('users');
            const user = await usersCollection.findOne({ 
                _id: new ObjectId(userId) 
            });
            
            const isPremium = user?.subscriptionStatus === 'active';
            
            try {
                // Try to use database models first
                const { getAvailableModelsFormatted } = require('../models/chat-model-utils');
                const dbModels = await getAvailableModelsFormatted();
                
                if (dbModels && Object.keys(dbModels).length > 0) {
                    // Return ALL models to all users (premium and non-premium can see all models)
                    // Non-premium users will see premium models as disabled on the frontend
                    const availableModels = dbModels;
                                        
                    return reply.send({ 
                        success: true, 
                        models: availableModels,
                        isPremium: isPremium
                    });
                }
            } catch (dbError) {
                console.log('[chat-tool-settings] Database models not available, falling back to legacy system:', dbError.message);
            }
            
            // Fallback to legacy system
            const { getAllAvailableModels } = require('../models/openai');
            const availableModels = await getAllAvailableModels(isPremium);
                        
            reply.send({ 
                success: true, 
                models: availableModels,
                isPremium: isPremium
            });
            
        } catch (error) {
            console.error('Error fetching available models:', error);
            reply.status(500).send({ error: 'Internal server error' });
        }
    });

    // Check if user has ever chatted with a specific character
    fastify.get('/api/chat-tool-settings/has-chatted/:userId/:chatId', async (request, reply) => {
        try {
            const { userId, chatId } = request.params;

            if (!userId || !ObjectId.isValid(userId) || !chatId || !ObjectId.isValid(chatId)) {
                return reply.status(400).send({ error: 'Invalid userId or chatId' });
            }

            const db = fastify.mongo.db;
            
            const hasChatted = await hasUserChattedWithCharacter(db, userId, chatId);

            reply.send({ 
                success: true, 
                hasChatted
            });
            
        } catch (error) {
            console.error('[API /has-chatted] Error:', error.message);
            reply.status(500).send({ error: 'Internal server error' });
        }
    });
}

module.exports = routes;
