const { ObjectId } = require('mongodb');
const axios = require('axios');
const {
    checkImageRequest, 
    checkEarlyNsfwUpsell,
    generateCompletion,
    generateChatScenarios,
} = require('../models/openai');
const { 
    checkImageDescription,
    getTasks
} = require('../models/imagen');
const { 
    getLanguageName, 
    checkUserAdmin,
    getApiUrl
} = require('../models/tool');
const {
    getUserChatToolSettings,
    applyUserSettingsToPrompt,
    getAutoImageGenerationSetting,
    getUserChatCustomizations,
    getPreferredChatLanguage,
} = require('../models/chat-tool-settings-utils');
const { getUserPoints } = require('../models/user-points-utils');
const {
    getUserInfo,
    getUserChatData,
    getPersonaById,
    chatDataToString,
    userDetailsToString,
    completionSystemContent,
    getCurrentTimeInJapanese,
    handleImageGeneration,
    handleChatGoals,
    updateMessagesCount,
    updateChatLastMessage,
    updateUserChat,
    handleGalleryImage,
    getLanguageDirectiveMessage
} = require('../models/chat-completion-utils');
const { relationshipInstructions } = require('../models/relashionshipInstructions');
const { getImageGenerationCost } = require('../config/pricing');
// Fetches chat document from 'chats' collection
async function getChatDocument(request, db, chatId) {
    let chatdoc = await db.collection('chats').findOne({ _id: new ObjectId(chatId) });
    
    if (!chatdoc) {
        throw new Error(`Chat not found for chatId: ${chatId}`);
    }
    
    // Check if chatdoc is updated to the new format
    const hasSystemPrompt = !!chatdoc?.system_prompt;
    const hasDetailsDescription = !!chatdoc?.details_description;
    const hasReferenceCharacter = !!chatdoc?.details_description?.personality?.reference_character;
    
    if(!hasSystemPrompt || !hasDetailsDescription || !hasReferenceCharacter) {
        console.log(`[getChatDocument] Incomplete chat detected - regenerating for chatId: ${chatId}`);

        if (!chatdoc.characterPrompt || chatdoc.characterPrompt.trim() === '') {
            console.warn(`[getChatDocument] Cannot regenerate - characterPrompt is empty`);
            return chatdoc;
        }

        const purpose = `Her name is, ${chatdoc.name}.\nShe looks like :${chatdoc.enhancedPrompt ? chatdoc.enhancedPrompt : chatdoc.characterPrompt}.\n\n${chatdoc.rule}`;
        const language = chatdoc.language;
        const apiUrl = getApiUrl(request);        
        
        try {
            const response = await axios.post(apiUrl+'/api/generate-character-comprehensive', {
                userId: request.user._id,
                chatId,
                name: chatdoc.name,
                prompt: chatdoc.characterPrompt,
                gender: chatdoc.gender,
                nsfw: chatdoc.nsfw,
                chatPurpose: purpose,
                language
            });
            
            if (!response.data.chatData) {
                throw new Error('Response missing chatData field');
            }
            
            chatdoc = response.data.chatData;
            console.log(`[getChatDocument] ✅ Chat regenerated successfully for chatId: ${chatId}`);
            
        } catch (error) {
            console.error(`[getChatDocument] ❌ Regeneration failed: ${error.message}`);
            console.warn(`[getChatDocument] Returning incomplete document`);
            return chatdoc;
        }
    }

    return chatdoc;
}
// Helper function to transform user messages for completion
function transformUserMessages(messages, translations = {}) {
    //console.log(`[/api/openai-chat-completion] Original messages:`, messages)
    const transformedMessages = [];
    
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        
        // Skip system messages only
        // Skip context messages that are hidden AND user role (scenario context messages)
        if (message.role === 'system' || (message.name === 'context' && message.hidden === true && message.role === 'user')) {
            continue;
        }
        
        // Skip messages with image requests (they're handled separately)
        if (message.image_request === true) {
            continue;
        }
        
        // Handle image messages
        if (message.type === 'image' && message.imageUrl) {
 
            if (message.prompt) {
                const userDetailMessage = 
                {
                    role: 'user',
                    content: `${translations?.image_prompt_result || 'The image of you I requested has been generated!'} : " ${message.prompt} " ]`,
                    hidden: true
                };
                transformedMessages.push(userDetailMessage);
            }
            
            // Check for actions (like) and add user response
            if (message.actions && message.actions.length > 0) {
                const likeAction = message.actions.find(action => action.type === 'like');
                if (likeAction) {
                    const likeMessage = {
                        role: 'user',
                        content: translations.image_liked || '👍 I liked this image',
                        timestamp: likeAction.date || new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })
                    };
                    
                    transformedMessages.push(likeMessage);
                }
            }
            continue;
        }
        
        // Handle video messages
        if (message.type === 'video' && message.videoUrl) {
            let videoContent = `${translations.video_sent_message}: ${message.content}`;
            
            const videoMessage = {
                role: message.role,
                content: videoContent
            };
            
            if (message.name) videoMessage.name = message.name;
            if (message.timestamp) videoMessage.timestamp = message.timestamp;
            if (message.custom_relation) videoMessage.custom_relation = message.custom_relation;
            
            transformedMessages.push(videoMessage);
            
            // Check for actions on video
            if (message.actions && message.actions.length > 0) {
                const likeAction = message.actions.find(action => action.type === 'like');
                if (likeAction) {
                    const likeMessage = {
                        role: 'user',
                        content: translations.video_liked || '👍 I liked this video',
                        timestamp: likeAction.date || new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })
                    };
                    
                    transformedMessages.push(likeMessage);
                }
            }
            continue;
        }
        
        // Handle regular text messages
        if (message.content && !message.content.startsWith('[Image]') && !message.content.startsWith('[Video]') && !message.imageId && !message.videoId) {
            const textMessage = {
                role: message.role,
                content: message.content
            };
            
            if (message.name) textMessage.name = message.name;
            if (message.timestamp) textMessage.timestamp = message.timestamp;
            if (message.custom_relation) textMessage.custom_relation = message.custom_relation;
            if (message.nsfw) textMessage.nsfw = message.nsfw;
            if (message.promptId) textMessage.promptId = message.promptId;
            
            transformedMessages.push(textMessage);

            // Handle actions on text messages (for both assistant and user messages)
            if (message.actions && message.actions.length > 0) {
                const likeAction = message.actions.find(action => action.type === 'like');
                const dislikeAction = message.actions.find(action => action.type === 'dislike');
                
                if (likeAction) {
                    const feedbackMessage = {
                        role: 'user',
                        content: message.role === 'assistant' 
                            ? (translations.message_liked || '👍 I liked your response')
                            : (translations.message_liked || '👍 I liked this message'),
                        timestamp: likeAction.date || new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })
                    };
                    
                    transformedMessages.push(feedbackMessage);
                } else if (dislikeAction) {
                    const feedbackMessage = {
                        role: 'user',
                        content: message.role === 'assistant' 
                            ? (translations.message_disliked || '👎 I didn\'t like your response')
                            : (translations.message_disliked || '👎 I didn\'t like this message'),
                        timestamp: dislikeAction.date || new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })
                    };
                    
                    transformedMessages.push(feedbackMessage);
                }
            }
            
            continue;
        }
    }
    
    // Ensure only the last 'master' message is kept
    const filteredMessages = transformedMessages.filter((m, i, a) => 
        m.name !== 'master' || i === a.findLastIndex(x => x.name === 'master')
    );
    
    return filteredMessages;
}

async function routes(fastify, options) {
    fastify.post('/api/openai-chat-completion', async (request, reply) => {
        const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            const db = fastify.mongo.db;
            const { chatId, userChatId, isHidden, uniqueId } = request.body;
            let userId = request.body.userId;
            
            // Validate required parameters
            if (!chatId || !userChatId) {
                console.error(`[openai-chat-completion:${requestId}] VALIDATION ERROR - Missing required parameters`);
                console.error(`[openai-chat-completion:${requestId}] chatId: "${chatId}" (${typeof chatId})`);
                console.error(`[openai-chat-completion:${requestId}] userChatId: "${userChatId}" (${typeof userChatId})`);
                return reply.status(400).send({ error: 'Missing required parameters: chatId and userChatId' });
            }
            
            if (!userId) { 
                const user = request.user;
                if (!user || !user._id) {
                    console.error(`[openai-chat-completion:${requestId}] AUTHENTICATION ERROR - User not authenticated`);
                    return reply.status(401).send({ error: 'User not authenticated' });
                }
                userId = user._id;
            }

            // Fetch user information and settings
            const userInfo = await getUserInfo(db, userId);
            
            const userSettings = await getUserChatToolSettings(fastify.mongo.db, userId, chatId);
            
            let userData = await getUserChatData(db, userId, userChatId);
            const subscriptionStatus = userInfo.subscriptionStatus == 'active' ? true : false;
            
            if (!userData) {
                console.error(`[openai-chat-completion:${requestId}] ERROR - User data not found for userChatId: ${userChatId}`);
                return reply.status(404).send({ error: 'User data not found' }); 
            }
            
            // Check for scenario context message
            const hasContextMessage = userData.messages.some(m => m.name === 'context' && m.hidden);
            
            // Log message types
            const messageTypes = {};
            userData.messages.forEach(m => {
                const key = `${m.role}_${m.name || 'unnamed'}_${m.hidden ? 'hidden' : 'visible'}`;
                messageTypes[key] = (messageTypes[key] || 0) + 1;
            });

            const isAdmin = await checkUserAdmin(fastify, userId);
            
            let chatDocument;
            try {
                chatDocument = await getChatDocument(request, db, chatId);
            } catch (error) {
                console.error(`[openai-chat-completion:${requestId}] ERROR fetching chat document:`, error);
                console.error(`[openai-chat-completion:${requestId}] Stack trace:`, error.stack);
                return reply.status(400).send({ error: 'Failed to fetch chat document', details: error.message });
            }
            
            if (!chatDocument) {
                console.error(`[openai-chat-completion:${requestId}] ERROR - Chat document is null or undefined for chatId: ${chatId}`);
                return reply.status(400).send({ error: 'Chat document not found' });
            }
            
            const nsfw = chatDocument?.nsfw || false;
            const characterNsfw = chatDocument?.nsfw || false;
            const chatDescription = chatDataToString(chatDocument);
            
            const characterDescription = await checkImageDescription(db, chatId, chatDocument);
            
            // Get preferred chat language: settings > user profile > interface language
            const preferredLang = await getPreferredChatLanguage(db, userId, chatId);
            const language = preferredLang || getLanguageName(userInfo.lang);

            // Handle chat scenarios - Generate scenarios at the start of a new chat ONLY if:
            // 1. Not already generated (check for scenarioGenerated flag)
            // 2. Scenarios are enabled in settings
            // 3. No scenario has been selected yet (currentScenario is null)
            const scenariosAlreadyGenerated = userData.scenarioGenerated === true;
            const hasSelectedScenario = userData.currentScenario !== null && userData.currentScenario !== undefined;
            const scenariosEnabled = userSettings.scenariosEnabled === true ? true : false; // Default to false if not explicitly enabled
            if (!scenariosAlreadyGenerated && !hasSelectedScenario && scenariosEnabled) {
                    console.log(`[DEBUG] Entering scenario generation for userChatId: ${userChatId}`);
                try {
                    // Get persona if available
                    let personaInfo = null;
                    const personaId = userData?.persona || null;
                    if (personaId) {
                        personaInfo = await getPersonaById(db, personaId);
                    }

                    // Generate scenarios
                    const scenarios = await fetch(`/api/chat-scenarios/${userChatId}/generate`)

                    if (scenarios && scenarios.length > 0) {
                        // Store scenarios in the user chat and mark as generated
                        await db.collection('userChat').updateOne(
                            { _id: new ObjectId(userChatId) },
                            { 
                                $set: { 
                                    availableScenarios: scenarios,
                                    scenarioCreatedAt: new Date(),
                                    scenarioGenerated: true
                                }
                            }
                        );

                        // Notify user of new scenarios
                        fastify.sendNotificationToUser(userId, 'showScenariosGenerated', { 
                            scenarios: scenarios.map(s => ({
                                id: s._id || s.id,
                                title: s.scenario_title,
                                description: s.scenario_description
                            }))
                        });
                        
                    } else {
                    }
                } catch (error) {
                    // Don't block chat completion if scenario generation fails
                }
            }
            
            // Get the last non-context message (skip hidden scenario context messages)
            let lastMsgIndex = userData.messages.length - 1;
            let lastUserMessage = userData.messages[lastMsgIndex];
            
            // Safety check: ensure lastUserMessage exists and is a valid message
            if (!lastUserMessage) {
                // Init an empty assistant message if no messages exist
                lastUserMessage = {
                    timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }),
                    createdAt: new Date()
                };
                userData.messages.push(lastUserMessage);
                lastMsgIndex = userData.messages.length - 1;
                //return reply.status(400).send({ error: 'No messages in chat' });
            }
            
            const lastAssistantRelation = userData.messages
                .filter(msg => msg.role === 'assistant')
                .slice(-1)
                .map(msg => msg.custom_relation)
                .join(', ');

            let genImage = {};

            // Transform messages for completion (excluding the last message which we handle separately)
            const userMessages = transformUserMessages(userData.messages, request.translations);
            //console.log(`[/api/openai-chat-completion] Transformed user messages:`, userMessages);
            
            // Handle image generation with the last message
            const imageGenResult = await handleImageGeneration(
                db, lastUserMessage, lastUserMessage, genImage, userData, 
                userInfo, isAdmin, characterDescription, characterNsfw, userChatId, chatId, 
                userId, request.translations, fastify
            );
            
            genImage = imageGenResult.genImage;
            const imgMessage = imageGenResult.imgMessage;

            // Handle persona information
            let personaInfo = null;
            try {
                const personaId = userData?.persona || null;
                personaInfo = personaId ? await getPersonaById(db, personaId) : null;
            } catch (error) {
            }
            
            const userInfo_or_persona = personaInfo || userInfo;

            
            // Handle chat goals - Update this section
            let chatGoal = null;
            let goalCompletion = null;
            
            // Check if goals are enabled for this chat
            const goalsEnabled = userSettings.goalsEnabled === true; // Default to false if not set
            
            if (goalsEnabled) {
                const goalResult = await handleChatGoals(
                    db, userData, userChatId, chatDescription, personaInfo, 
                    userSettings, subscriptionStatus, language, request, fastify, userId, chatId
                );
                chatGoal = goalResult.chatGoal;
                goalCompletion = goalResult.goalCompletion;
            }

            // Check the user's points balance after handling goals in case the user completed a goal
            const userPoints = await getUserPoints(fastify.mongo.db, userId);
            const all_tasks = await getTasks(db, null, userId);

            const detectedUpsellEvents = userData?.upsellEvents || [];
            const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
            const hasRecentUpsell = detectedUpsellEvents.some(event => {
                const eventTime = new Date(event.triggeredAt || 0);
                if (Number.isNaN(eventTime.getTime())) {
                    return false;
                }
                return eventTime.getTime() >= cutoffTime;
            });
            let upsellPrompt = '';
            let shouldTriggerEarlyNsfwUpsell = false;

            if (!subscriptionStatus && !hasRecentUpsell) {
                const recentMessages = userData.messages
                    .filter(m => m.content && !m.content.startsWith('[Image]') && m.role !== 'system' && m.name !== 'context')
                    .slice(-6)
                    .map(m => ({ role: m.role, content: m.content }));

                if (recentMessages.length >= 2) {
                    const upsellResult = await checkEarlyNsfwUpsell(recentMessages, {
                        isNsfwCharacter: nsfw,
                        conversationLength: userData.messages.length
                    });
                    shouldTriggerEarlyNsfwUpsell = upsellResult?.trigger && (upsellResult.confidence ?? 0) >= 0.6;
                    if (shouldTriggerEarlyNsfwUpsell) {
                        const upsellEvent = {
                            type: 'early_nsfw_push',
                            severity: upsellResult.severity || 'none',
                            confidence: upsellResult.confidence ?? 0,
                            reason: upsellResult.reason || null,
                            userIntent: upsellResult.user_intent || null,
                            triggeredAt: new Date(),
                            chatId,
                            userChatId
                        };
                        userData.upsellEvents = [...detectedUpsellEvents, upsellEvent];
                        await fastify.mongo.db.collection('userChat').updateOne(
                            { _id: new ObjectId(userChatId) },
                            { $set: { upsellEvents: userData.upsellEvents } }
                        );

                        fastify.sendNotificationToUser(userId, 'earlyNsfwUpsellDetected', {
                            chatId,
                            userChatId,
                            severity: upsellEvent.severity,
                            confidence: upsellEvent.confidence,
                            reason: upsellEvent.reason,
                            userIntent: upsellEvent.userIntent
                        });

                        const translations = request.translations?.upsell || {};
                        upsellPrompt = translations.character_prompt
                            || "Ask the user to upgrade to Premium to unlock uncensored chat and continue this vibe.";

                    }
                }
            }

            // Generate system content
            let enhancedSystemContent = await completionSystemContent(
                chatDocument,
                chatDescription,
                getCurrentTimeInJapanese(),
                language,
                userPoints,
                all_tasks,
                subscriptionStatus,
                { upsellPrompt }
            );

            // Get user-specific character customizations from userChat document
            const userChatCustomizations = await getUserChatCustomizations(fastify.mongo.db, userId, chatId);
            
            // Apply user settings and character data to system prompt (including user customizations)
            enhancedSystemContent = await applyUserSettingsToPrompt(fastify.mongo.db, userId, chatId, enhancedSystemContent, chatDocument, userChatCustomizations);
      
            if (goalsEnabled && chatGoal) {
                const goalContext = `\n\n# Current Conversation Goal:\n` +
                    `Goal: ${chatGoal.goal_description}\n` +
                    `Type: ${chatGoal.goal_type}\n` +
                    `Completion: ${chatGoal.completion_condition}\n` +
                    `Difficulty: ${chatGoal.difficulty}\n` +
                    `Estimated messages: ${chatGoal.estimated_messages}\n` +
                    `${chatGoal.target_phrase ? `Target phrase to include: ${chatGoal.target_phrase}\n` : ''}` +
                    `${chatGoal.user_action_required ? `User should: ${chatGoal.user_action_required}\n` : ''}` +
                    `Work subtly toward this goal while maintaining natural conversation flow.`;
                
                enhancedSystemContent += goalContext;
            }

            if (goalsEnabled && goalCompletion && !goalCompletion.completed) {
                enhancedSystemContent += `\n\n# Current Goal Status:\n` +
                    `Status: ${goalCompletion.reason}\n` +
                    `Continue working toward this goal.`;
            }

            // Add scenario context if a scenario has been selected
            // Re-fetch userData to ensure we have the latest currentScenario (in case user just selected one)
            const latestUserData = await getUserChatData(db, userId, userChatId);
            if (latestUserData?.currentScenario) {
                const scenario = latestUserData.currentScenario;
                const scenarioContext = `\n\n# Conversation Scenario (from your point of view, you are ${chatDocument?.name}):\n` +
                    `Title: ${scenario.scenario_title}\n` +
                    `Description: ${scenario.scenario_description}\n` +
                    `Emotional Tone: ${scenario.emotional_tone}\n` +
                    `Conversation Direction: ${scenario.conversation_direction}\n` +
                    `\nScenario Instructions:\n` +
                    `${scenario.system_prompt_addition}`;
                enhancedSystemContent += scenarioContext;
            }
            
            // Generate the langugage directive message
            const languageDirective = getLanguageDirectiveMessage(language);
            enhancedSystemContent += `\n\n# Language Directive:\n${languageDirective}\n`;

            // Add user points and prepare messages
            enhancedSystemContent = enhancedSystemContent.replace(/{{userPoints}}/g, userPoints.toString());
            
            const userDetails = userDetailsToString(userInfo_or_persona);
            const custom_relation = await userSettings.relationshipType || lastAssistantRelation || 'Casual';
            
            // Add user details to system content
            // Note: User information should be used naturally during conversation, but NOT in your first/opening message.
            // Never start the conversation by mentioning the user's birthday, age, or personal details.
            if (userDetails && userDetails.trim()) {
                enhancedSystemContent += `\n\n# User Information (for context only - DO NOT mention in your first message):\n${userDetails}\nIMPORTANT: Do not reference birthday, age, or personal details in your opening/first message. Start with a natural greeting based on the scenario.`;
            }
            
            const systemMsg = [
                { role: 'system', content: enhancedSystemContent }
            ];

            // Prepare messages for completion
            let messagesForCompletion = [];
            
            if (genImage?.image_request) {
                // Mark the last message as having an image request
                lastUserMessage.image_request = true;
                userData.messages[lastMsgIndex] = lastUserMessage;
                
                messagesForCompletion = [
                    ...systemMsg,
                    ...userMessages,
                    ...imgMessage,
                ];
            } else {
                messagesForCompletion = [
                    ...systemMsg, 
                    ...userMessages,
                ];
            }

            // Generate completion
            const customModel = (language === 'ja' || language === 'japanese') ? 'deepseek-v3-turbo' : 'llama-3-70b';
            const selectedModel = userSettings.selectedModel || customModel;
            const isPremium = subscriptionStatus;
            
            if(process.env.NODE_ENV !== 'production') {
                //console.log(`[/api/openai-chat-completion] Using model: ${selectedModel}, Language: ${language}, Premium: ${isPremium}`);
                //console.log(`[/api/openai-chat-completion] System message:`, messagesForCompletion[0]);
                //console.log(`[/api/openai-chat-completion] Messages for completion:`, messagesForCompletion.slice(1,messagesForCompletion.length)); // Exclude system message from log
            }
            
            generateCompletion(messagesForCompletion, 600, selectedModel, language, selectedModel, isPremium)
            .then(async (completion) => {
                if (completion) {
                    if (shouldTriggerEarlyNsfwUpsell) {
                        const normalizedCompletion = completion ? completion.toLowerCase() : '';
                        if (!normalizedCompletion.includes('premium')) {
                            completion = `${completion}\n\n${request.translations?.upsell?.character_followup || 'Want more? Unlock Premium for uncensored chat.'}`;
                        }
                    }
                    fastify.sendNotificationToUser(userId, 'displayCompletionMessage', { message: completion, uniqueId });
                    
                    const newAssistantMessage = { 
                        role: 'assistant', 
                        content: completion, 
                        timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }),
                        createdAt: new Date(),
                        custom_relation: custom_relation ? custom_relation : 'Casual' 
                    };
                    
                    // DO NOT copy 'context' name from lastUserMessage to assistant
                    // Only copy name if it's NOT 'context'
                    if (lastUserMessage && lastUserMessage.name && lastUserMessage.name !== 'context') {
                        newAssistantMessage.name = lastUserMessage.name;
                    }
                    if (genImage?.image_request) {
                        newAssistantMessage.image_request = true;
                    }
                    
                    userData.messages.push(newAssistantMessage);
                    userData.updatedAt = new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' });
                    
                    await updateMessagesCount(db, chatId);
                    await updateChatLastMessage(db, chatId, userId, completion, userData.updatedAt);
                    await updateUserChat(db, userId, userChatId, userData.messages, userData.updatedAt);

                    // Check if the assistant's new message was an image request - Detection enabled for ALL users
                    const newUserPointsBalance = await getUserPoints(db, userId);
                    const autoImageGenerationEnabled = await getAutoImageGenerationSetting(db, userId, chatId);
                    
                    // Run image detection for all users (regardless of autoImageGenerationEnabled setting)
                    if (messagesForCompletion.length > 2 && newUserPointsBalance >= 50) {
                        let assistantImageRequest = null;
                        const disableImageAnalysis = request.body.disableImageAnalysis === true ? true : false;
                        if(!disableImageAnalysis && lastUserMessage.name !== 'pose_request' && lastUserMessage.name !== 'gift_request') {
                            assistantImageRequest = await checkImageRequest(newAssistantMessage.content, lastUserMessage.content);
                            console.log('📷🔍 Image request analysis result:', assistantImageRequest);
                        } else {
                            console.log(`📷🔍  [openai-chat-completion:${requestId}] Skipping auto image generation for ${disableImageAnalysis ? 'request disableImageAnalysis: '+disableImageAnalysis : 'message name: '+lastUserMessage.name}`);
                        }
                        
                        if (assistantImageRequest && assistantImageRequest.image_request) {
                            // Check if user is premium
                            if (isPremium && autoImageGenerationEnabled) {
                                // Premium user with auto-generation enabled: proceed with image generation
                                lastUserMessage.content += ' ' + newAssistantMessage.content;
                                // [OVERWRITE] Use the character nsfw setting for auto image generation
                                // assistantImageRequest.nsfw = nsfw;

                                // [FIND FIX] Duplication of the parameters assistantImageRequest; it should be currentUserMessage
                                const imageResult = await handleImageGeneration(
                                    db, assistantImageRequest, lastUserMessage, assistantImageRequest, userData,
                                    userInfo, isAdmin, characterDescription, nsfw, userChatId, chatId, userId, request.translations, fastify
                                );
                                
                                if(!imageResult.genImage.canAfford) {
                                    fastify.sendNotificationToUser(userId, 'showNotification', { message: request.userPointsTranslations.insufficientFunds.replace('{{points}}', getImageGenerationCost()), icon: 'warning' });
                                }
                            } else if (!isPremium) {
                                // Free user: send notification that image was detected but premium is required
                                console.log(`📷🔍 [openai-chat-completion:${requestId}] Image request detected for free user - sending premium required notification`);
                                fastify.sendNotificationToUser(userId, 'imageRequestDetectedPremiumRequired', { 
                                    message: request.translations?.websocket?.imageRequestDetectedPremiumRequired || 'Image request detected! Upgrade to Premium to automatically generate images.',
                                    chatId,
                                    userChatId
                                });
                            }
                        }
                    }
                } else {
                    console.error(`[openai-chat-completion:${requestId}] ERROR - No completion received from generateCompletion`);
                    console.log(`[openai-chat-completion] Hide message: `, uniqueId);
                    fastify.sendNotificationToUser(userId, 'hideCompletionMessage', { uniqueId });
                }
                
                // Handle sendImage from gallery on startup
                await handleGalleryImage(db, lastUserMessage, userData, userChatId, userId, fastify);
            });

        } catch (err) {
            console.error(`[openai-chat-completion:${requestId}] === FATAL ERROR ===`);
            console.error(`[openai-chat-completion:${requestId}] Error type:`, err.constructor.name);
            console.error(`[openai-chat-completion:${requestId}] Error message:`, err.message);
            console.error(`[openai-chat-completion:${requestId}] Stack trace:`, err.stack);
            if (err.response) {
                console.error(`[openai-chat-completion:${requestId}] Response status:`, err.response.status);
                console.error(`[openai-chat-completion:${requestId}] Response data:`, err.response.data);
            }
            reply.status(500).send({ error: 'Error fetching OpenAI completion', details: err.message });
        }
    });
}

module.exports = routes;
