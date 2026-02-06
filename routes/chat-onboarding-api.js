/**
 * Chat Onboarding API Routes
 * Handles API endpoints for the social-media-linked chat onboarding flow.
 * Saves user data for analytics and tracks onboarding progress.
 */

const { ObjectId } = require('mongodb');

async function routes(fastify) {
    
    /**
     * Save onboarding progress (for users who leave mid-flow)
     * POST /api/chat-onboarding/save-progress
     */
    fastify.post('/api/chat-onboarding/save-progress', async (request, reply) => {
        try {
            const { userData, currentStep, chatId, sessionId } = request.body;
            
            if (!sessionId) {
                return reply.status(400).send({ error: 'Session ID required' });
            }
            
            const db = fastify.mongo.db;
            
            await db.collection('chatOnboardingProgress').updateOne(
                { sessionId },
                {
                    $set: {
                        userData,
                        currentStep,
                        chatId,
                        updatedAt: new Date()
                    },
                    $setOnInsert: {
                        createdAt: new Date()
                    }
                },
                { upsert: true }
            );
            
            return reply.send({ success: true });
        } catch (error) {
            console.error('[chat-onboarding] Save progress error:', error);
            return reply.status(500).send({ error: 'Failed to save progress' });
        }
    });
    
    /**
     * Save user data after authentication (for analytics dashboard)
     * POST /api/chat-onboarding/save-user-data
     */
    fastify.post('/api/chat-onboarding/save-user-data', async (request, reply) => {
        try {
            const { userData, chatId } = request.body;
            const { user } = request;
            
            if (!user || user.isTemporary) {
                return reply.status(401).send({ error: 'Authentication required' });
            }
            
            const db = fastify.mongo.db;
            const userId = new ObjectId(user._id);
            
            // Update user record with onboarding data
            const updateData = {
                firstTime: false,
                onboardingCompleted: true,
                onboardingSource: 'chat-onboarding',
                onboardingChatId: chatId
            };
            
            // Save analytics-relevant user data
            if (userData.nickname) updateData.nickname = userData.nickname;
            if (userData.gender) updateData.gender = userData.gender;
            if (userData.ageRange) updateData.ageRange = userData.ageRange;
            if (userData.chatLanguage) updateData.preferredChatLanguage = userData.chatLanguage;
            if (userData.interests?.length) updateData.interests = userData.interests;
            
            await db.collection('users').updateOne(
                { _id: userId },
                { $set: updateData }
            );
            
            // Also log to analytics collection for the admin dashboard
            await db.collection('onboardingAnalytics').insertOne({
                userId,
                chatId,
                source: 'chat-onboarding',
                userData: {
                    nickname: userData.nickname,
                    gender: userData.gender,
                    ageRange: userData.ageRange,
                    chatLanguage: userData.chatLanguage,
                    interests: userData.interests
                },
                completedAt: new Date(),
                createdAt: new Date()
            });
            
            return reply.send({ success: true });
        } catch (error) {
            console.error('[chat-onboarding] Save user data error:', error);
            return reply.status(500).send({ error: 'Failed to save user data' });
        }
    });
}

module.exports = routes;
