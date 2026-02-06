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
            const { userData, chatId, clerkId } = request.body;
            let { user } = request;
            
            console.log(`[chat-onboarding] save-user-data called. JWT user: ${user?._id || 'none'}, isTemp: ${user?.isTemporary}, clerkId: ${clerkId || 'none'}`);
            
            // Primary auth: JWT cookie. Fallback: clerkId from request body.
            // The clerkId fallback is needed because the JWT cookie set by /user/clerk-auth
            // may not be available in the same browser session immediately.
            if ((!user || user.isTemporary) && clerkId) {
                const db = fastify.mongo.db;
                user = await db.collection('users').findOne({ clerkId });
                console.log(`[chat-onboarding] Fallback clerkId lookup: ${user ? 'found user ' + user._id : 'not found'}`);
                if (!user) {
                    return reply.status(401).send({ error: 'User not found' });
                }
            }
            
            if (!user || user.isTemporary) {
                console.log(`[chat-onboarding] Auth failed - no valid user`);
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
            
            const updateResult = await db.collection('users').updateOne(
                { _id: userId },
                { $set: updateData }
            );
            
            console.log(`[chat-onboarding] User ${userId} updated:`, JSON.stringify(updateData), `matched: ${updateResult.matchedCount}, modified: ${updateResult.modifiedCount}`);
            
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
