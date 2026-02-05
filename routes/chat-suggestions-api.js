const { ObjectId } = require('mongodb');
const { 
    generateChatSuggestions, 
    shouldShowSuggestions 
} = require('../models/chat-suggestions-utils');
const { 
    getUserInfo,
    getUserChatData,
    getPersonaById 
} = require('../models/chat-completion-utils');
const { getUserChatToolSettings, getPreferredChatLanguage } = require('../models/chat-tool-settings-utils');
const { getLanguageName } = require('../models/tool');
const { detectConversationLanguage } = require('../models/openai');
const { 
    awardCharacterMessageMilestoneReward 
} = require('../models/user-points-utils');

async function routes(fastify, options) {
    const db = fastify.mongo.db;

    /**
     * Generate chat suggestions for the current conversation
     * POST /api/chat-suggestions
     */
    fastify.post('/api/chat-suggestions', async (request, reply) => {
        try {
            const { userId, chatId, userChatId, suggestionPreset } = request.body;

            // Validate required parameters
            if (!userId || !chatId || !userChatId) {
                return reply.status(400).send({
                    success: false,
                    error: 'Missing required parameters: userId, chatId, userChatId'
                });
            }

            // Validate ObjectId format
            if (!ObjectId.isValid(userId) || !ObjectId.isValid(chatId) || !ObjectId.isValid(userChatId)) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid ObjectId format'
                });
            }

            // Get user information
            const userInfo = await getUserInfo(db, userId);
            if (!userInfo) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found'
                });
            }

            // Get chat document (character data)
            const chatDocument = await getPersonaById(db, chatId);
            if (!chatDocument) {
                return reply.status(404).send({
                    success: false,
                    error: 'Chat/Character not found'
                });
            }

            // Get user chat data (conversation history)
            const userChatData = await getUserChatData(db, userId, userChatId);
            if (!userChatData) {
                return reply.status(404).send({
                    success: false,
                    error: 'User chat not found'
                });
            }

            // Get user settings
            const userSettings = await getUserChatToolSettings(db, userId, chatId);

            // Check if suggestions should be shown
            if (!shouldShowSuggestions(userChatData.messages, userSettings)) {
                return reply.send({
                    success: true,
                    showSuggestions: false,
                    suggestions: []
                });
            }

            // Get user's default language preference from chat settings (falls back to user profile)
            const defaultLanguage = await getPreferredChatLanguage(db, userId, chatId) || getLanguageName(userInfo.lang) || 'japanese';
            
            // Debug: Log language detection for suggestions
            console.log(`🌐 [chat-suggestions] LANGUAGE DEBUG:`);
            console.log(`   - preferredChatLanguage (from settings): "${await getPreferredChatLanguage(db, userId, chatId) || 'NOT SET'}"`);
            console.log(`   - userInfo.lang (user profile): "${userInfo?.lang || 'NOT SET'}"`);
            console.log(`   - getLanguageName(userInfo.lang): "${getLanguageName(userInfo?.lang) || 'NOT SET'}"`);
            console.log(`   - defaultLanguage resolved: "${defaultLanguage}"`);
            
            // Detect actual conversation language (adapts to what user is actually speaking)
            // Only detect after the first user message (exactly 1 user message) to avoid repeated API calls
            let language = defaultLanguage;
            const userMessages = userChatData.messages?.filter(m => m.role === 'user') || [];
            if (userMessages.length === 1) {
                const detectedLang = await detectConversationLanguage(userChatData.messages, defaultLanguage);
                // Use detected language if confidence is high enough
                if (detectedLang.confidence >= 60) {
                    language = detectedLang.language.toLowerCase();
                    console.log(`   - detectConversationLanguage result: "${language}" (confidence: ${detectedLang.confidence}%)`);
                } else {
                    console.log(`   - detectConversationLanguage skipped (confidence ${detectedLang.confidence}% < 60%)`);
                }
            } else {
                console.log(`   - detectConversationLanguage skipped (${userMessages.length} user messages, only runs on first)`);
            }
            console.log(`   - FINAL language used for suggestions: "${language}"`);

            // Generate suggestions
            const suggestions = await generateChatSuggestions(
                db,
                chatDocument,
                userChatData.messages,
                userInfo,
                language,
                suggestionPreset || userChatData.suggestionPreset || userSettings?.suggestionPreset || 'neutral'
            );

            return reply.send({
                success: true,
                showSuggestions: true,
                suggestions: suggestions,
                relationshipType: userSettings?.relationshipType || 'companion',
                suggestionPreset: suggestionPreset || userChatData.suggestionPreset || userSettings?.suggestionPreset || 'neutral'
            });

        } catch (error) {
            console.error('[POST /api/chat-suggestions] Error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Internal server error while generating suggestions'
            });
        }
    });

    /**
     * Send a suggested message (marks it as suggestion: true)
     * POST /api/chat-suggestions/send
     */
    fastify.post('/api/chat-suggestions/send', async (request, reply) => {
        try {
            const { userId, chatId, userChatId, message } = request.body;

            // Validate required parameters
            if (!userId || !chatId || !userChatId || !message) {
                return reply.status(400).send({
                    success: false,
                    error: 'Missing required parameters: userId, chatId, userChatId, message'
                });
            }

            // Validate ObjectId format
            if (!ObjectId.isValid(userId) || !ObjectId.isValid(chatId) || !ObjectId.isValid(userChatId)) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid ObjectId format'
                });
            }

            // Get user chat data
            const userChatData = await getUserChatData(db, userId, userChatId);
            if (!userChatData) {
                return reply.status(404).send({
                    success: false,
                    error: 'User chat not found'
                });
            }

            // Create new message with suggestion flag
            const newMessage = {
                role: 'user',
                content: message.trim(),
                timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }),
                suggestion: true // Flag to indicate this was a suggested message
            };

            // Add message to conversation
            userChatData.messages.push(newMessage);
            userChatData.updatedAt = new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' });

            // Update the user chat document
            await db.collection('userChat').updateOne(
                { _id: new ObjectId(userChatId) },
                {
                    $set: {
                        messages: userChatData.messages,
                        updatedAt: userChatData.updatedAt
                    }
                }
            );

            // Check for character message milestones (same as regular messages)
            try {
                await awardCharacterMessageMilestoneReward(
                    fastify.mongo.db,
                    new ObjectId(userId),
                    new ObjectId(chatId),
                    fastify
                );
            } catch (milestoneError) {
                console.error('🚨 [MILESTONE ERROR] Error in suggestion milestone check:', milestoneError);
            }

            return reply.send({
                success: true,
                message: 'Suggested message sent successfully',
                messageData: newMessage
            });

        } catch (error) {
            console.error('[POST /api/chat-suggestions/send] Error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Internal server error while sending suggestion'
            });
        }
    });

    /**
     * Update user preference for suggestions
     * POST /api/chat-suggestions/preferences
     */
    fastify.post('/api/chat-suggestions/preferences', async (request, reply) => {
        try {
            const { userId, chatId, disableSuggestions } = request.body;

            // Validate required parameters
            if (!userId || typeof disableSuggestions !== 'boolean') {
                return reply.status(400).send({
                    success: false,
                    error: 'Missing required parameters: userId, disableSuggestions (boolean)'
                });
            }

            // Validate ObjectId format
            if (!ObjectId.isValid(userId) || (chatId && !ObjectId.isValid(chatId))) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid ObjectId format'
                });
            }

            // Update user's chat tool settings
            const updateData = {
                disableSuggestions: disableSuggestions,
                updatedAt: new Date()
            };

            const filter = {
                userId: new ObjectId(userId)
            };

            // If chatId is provided, update chat-specific settings
            if (chatId) {
                filter.chatId = new ObjectId(chatId);
            } else {
                // Update global user settings
                filter.chatId = { $exists: false };
            }

            await db.collection('chatToolSettings').updateOne(
                filter,
                { $set: updateData },
                { upsert: true }
            );

            return reply.send({
                success: true,
                message: 'Suggestion preferences updated successfully'
            });

        } catch (error) {
            console.error('[POST /api/chat-suggestions/preferences] Error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Internal server error while updating preferences'
            });
        }
    });
}

module.exports = routes;
