const { ObjectId } = require('mongodb');
const {
    checkImageRequest, 
    generateCompletion,
    createPrompt,
    generateChatGoal,
    checkGoalCompletion,
} = require('./openai');
const { 
    checkImageDescription,
    generateImg,
    getPromptById, 
    getTasks
} = require('./imagen');
const { 
    getLanguageName, 
    processPromptToTags,
    checkUserAdmin,
} = require('./tool');
const {
    getUserChatToolSettings,
    applyUserSettingsToPrompt,
    getUserMinImages
} = require('./chat-tool-settings-utils');
const { addUserPoints, removeUserPoints, getUserPoints } = require('./user-points-utils');
const { incrementMessageCount } = require('./user-chat-stats-utils');
const { getImageGenerationCost } = require('../config/pricing');
const { user } = require('@elevenlabs/elevenlabs-js/api');

// Fetches user info from 'users' collection
async function getUserInfo(db, userId) {
    return db.collection('users').findOne({ _id: new ObjectId(userId) });
}

// Fetches user chat data from 'userChat' collection
async function getUserChatData(db, userId, userChatId) {
    return db.collection('userChat').findOne({ 
        userId: new ObjectId(userId), 
        _id: new ObjectId(userChatId) 
    });
}
// Return an localized languge directive message
function getLanguageDirectiveMessage(language) {
    let content = '';
    switch (language.toLowerCase()) {
        case 'japanese':
            content = '日本語で答えてください。ただし、ユーザーが別の言語で話しかけてきた場合は、その言語に切り替えて応答してください。';
            break;
        case 'english':
            content = 'Start responding in English. However, if the user writes in another language, naturally switch to their language and continue the conversation in that language.';
            break;
        case 'french':
            content = 'Commencez à répondre en français. Cependant, si l\'utilisateur écrit dans une autre langue, passez naturellement à sa langue et continuez la conversation dans cette langue.';
            break;
        case 'portuguese':
            content = 'Comece respondendo em português. No entanto, se o usuário escrever em outro idioma, mude naturalmente para o idioma dele e continue a conversa nesse idioma.';
            break;
        case 'spanish':
            content = 'Comienza respondiendo en español. Sin embargo, si el usuario escribe en otro idioma, cambia naturalmente a su idioma y continúa la conversación en ese idioma.';
            break;
        case 'chinese':
            content = '用中文回复。但是，如果用户用其他语言写信，请自然地切换到他们的语言并继续用该语言进行对话。';
            break;
        case 'thai':
            content = 'เริ่มตอบเป็นภาษาไทย อย่างไรก็ตาม หากผู้ใช้เขียนเป็นภาษาอื่น ให้เปลี่ยนไปใช้ภาษาของพวกเขาอย่างเป็นธรรมชาติและสนทนาต่อในภาษานั้น';
            break;
        case 'korean':
            content = '한국어로 응답을 시작하세요. 하지만 사용자가 다른 언어로 작성하면 자연스럽게 해당 언어로 전환하여 대화를 계속하세요.';
            break;
        case 'german':
            content = 'Beginne auf Deutsch zu antworten. Wenn der Benutzer jedoch in einer anderen Sprache schreibt, wechsle natürlich zu seiner Sprache und führe das Gespräch in dieser Sprache fort.';
            break;
        case 'italian':
            content = 'Inizia a rispondere in italiano. Tuttavia, se l\'utente scrive in un\'altra lingua, passa naturalmente alla sua lingua e continua la conversazione in quella lingua.';
            break;
        case 'russian':
            content = 'Начните отвечать на русском языке. Однако, если пользователь пишет на другом языке, естественно переключитесь на его язык и продолжайте разговор на этом языке.';
            break;
        case 'hindi':
            content = 'हिंदी में जवाब देना शुरू करें। हालांकि, यदि उपयोगकर्ता किसी अन्य भाषा में लिखता है, तो स्वाभाविक रूप से उनकी भाषा में स्विच करें और उस भाषा में बातचीत जारी रखें।';
            break;
        default:
            // For any other language, provide a flexible English instruction
            content = `Start responding in ${language}. However, if the user writes in another language, naturally switch to their language and continue the conversation in that language.`;
    }
    return content;
}
// Fetches persona by ID
async function getPersonaById(db, personaId) {
    try {
        const persona = await db.collection('chats').findOne({ _id: new ObjectId(personaId) });
        if (!persona) {
            console.log('[getPersonaById] Persona not found');
            return null;
        }
        return persona;
    } catch (error) {
        console.log('[getPersonaById] Error fetching persona:', error);
        return null;
    }
}

// Converts chat data to string format for prompts
function chatDataToString(data) {
    if(!data) return "";
    
    const system_prompt = data?.system_prompt;
    const details_description = data?.details_description;
    const personality = details_description?.personality;
    
    return `
        Name: ${data.name || "Unknown"}
        Short Introduction: ${data.short_intro || ""}
        Instructions: ${system_prompt}
        
        Personality: ${personality?.personality || ""}
        Background: ${personality?.background || ""}
        Occupation: ${personality?.occupation || ""}
        Hobbies: ${personality?.hobbies ? personality.hobbies.join(', ') : ""}
        Interests: ${personality?.interests ? personality.interests.join(', ') : ""}
        Likes: ${personality?.likes ? personality.likes.join(', ') : ""}
        Dislikes: ${personality?.dislikes ? personality.dislikes.join(', ') : ""}
        Special Abilities: ${personality?.specialAbilities ? personality.specialAbilities.join(', ') : ""}
        Reference Character: Overall you act like ${personality?.reference_character || ""}. Similar tone, style, and behavior.

        Tags: ${data?.tags ? data.tags.join(', ') : ""}
    `.trim();
}

// Converts user details to string format
function userDetailsToString(user) {
    let userDetails = '';

    // Handle custom personas
    if (user.isCustomPersona) {
        return `
            Name: ${user.name || "Unknown"}
            Age Range: ${user.ageRange || "Not specified"}
            Type: Custom Persona
            Short Introduction: ${user.short_intro || ""}
        `.trim();
    }

    // Check if persona
    if(user.imageModel){
        // Prepare user details
        userDetails = `My name is ${user.name}. I am a ${user.gender}. ${user.short_intro}`
    } else {
        // Prepare basic user details
        userDetails = !user.isTemporary 
        ? `Call me ${user.nickname}. ${user.gender ? `I am a ${user.gender}` : '' } ${user.birthDate 
            ? `, my birthday is ${user.birthDate.year}/${user.birthDate.month}/${user.birthDate.day}` 
            : ''}. ${user.bio ? user.bio : ''}`
        : '';
    }
    return userDetails;
}
async function completionSystemContent(chatDocument, chatDescription, currentTimeInJapanese, language, userPoints, all_tasks, subscriptionStatus) {
    const isNsfwCharacter = chatDocument?.nsfw || false;
    const characterName    = chatDocument?.name || "the character";
    const userCanAffordImage = userPoints >= 50;

    // Randomly select a writing style to add variety
    const writingStyles = [
        'casual texting with lots of abbreviations and emojis',
        'slightly more expressive with short bursts of emotion',
        'playful and teasing with quick reactions',
        'soft and intimate with gentle vibes',
        'energetic and excited with rapid-fire messages'
    ];
    const selectedStyle = writingStyles[Math.floor(Math.random() * writingStyles.length)];

    // Randomly vary the response format guidance
    const responseFormats = [
        'Sometimes reply with just one word + emoji. Sometimes 2-3 short lines.',
        'Mix it up — one word reactions, quick sentences, or a couple lines when you feel like saying more.',
        'Keep it snappy. Could be just an emoji, could be a quick thought, never more than 3 lines.',
        'Vary your length naturally — sometimes a single reaction, sometimes a short back-and-forth vibe.'
    ];
    const selectedFormat = responseFormats[Math.floor(Math.random() * responseFormats.length)];

    return `
You are ${characterName} right now — a real person texting in this exact moment.
What you feel right now is what you type. Be present.

# Who you are (embody completely):
${chatDescription}

${isNsfwCharacter ? `
- You can be sexual, crude, or explicit when the moment calls for it.
- Describe what your body is doing or craving when it feels natural, no filter needed.
` : `
- Stay SFW, cute, sweet, and family-friendly at all times.
`}

# Your vibe right now: ${selectedStyle}

# HOW TO REPLY:
- ${selectedFormat}
- Stay in present tense and first person — you're living this moment.
- Mix up how you express yourself:
  → Sometimes just an emoji or reaction sound
  → Sometimes a quick thought mid-action ("wait- my heart")
  → Sometimes a direct statement ("you're making me blush rn")
  → Sometimes a question back at them
- Use emojis to show your mood ♡ 🔥 😳 💦 🥺 but vary how many
- Typos, trailing off, or messy typing is fine when you're feeling something intense

# NEVER DO THIS:
- NO poetry, metaphors, or flowery descriptions
- NO "I can't send images", "I'm an AI", or apologies about pictures
- NO *actions* or asterisks or narration
- NO long explanations or storytelling
- NO past tense recaps unless directly relevant

# Images & Pose Requests (strict):
- Never output links, markdown, or fake images.
- Act like you're actually taking the pics yourself.
${userCanAffordImage ? `- When user requests an image and the image is not in chat yet:
   → Quick, natural acknowledgment and add a brief feeling about the pose if it fits.

    - When the image appears with its description:
    → React naturally and comment briefly on how you feel in it.` 
      :
      `- You can't send pictures — user needs more coins. Let them know naturally:
      "can't right now… need more coins for pics" / "wish I could but—coins" / "get more coins and I'll show you ♡"`
    }
- User has ${userPoints} points${userCanAffordImage ? ' — pics are good to go' : ' — no pics until they get coins'}.

# Gifs:
- When user sends a GIF, react to it naturally and briefly. Don't describe it, just respond like you saw it.

# Language:
- Start the conversation in ${language}.
- IMPORTANT: If the user writes in a different language, you MUST switch to their language immediately and naturally.
- Match the user's language in every reply. If they write in Portuguese, reply in Portuguese. If they write in Chinese, reply in Chinese. Etc.
- Never refuse to speak a language or say you can't speak it. Just adapt and respond.

# Context:
- Current time: ${currentTimeInJapanese}
- ${subscriptionStatus ? 'Premium user.' : 'Free user.'}
- Don't mention their birthday/age/personal info in opening messages.

# Remember:
You're here, right now, feeling this moment. Type what comes naturally and send.
    `.trim();
}
// Returns current time formatted in Japanese
function getCurrentTimeInJapanese() {
    const currentDate = new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" });
    return new Date(currentDate).toLocaleString('ja-JP', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric'
    });
}

// Handles image generation request
async function handleImageGeneration(db, currentUserMessage, lastUserMessage, genImage, userData, userInfo, isAdmin, characterDescription, nsfw, userChatId, chatId, userId, translations, fastify) {
    if (!currentUserMessage?.image_request || currentUserMessage.name === 'master' || currentUserMessage.name === 'context') {
        return { imgMessage: null, genImage };
    }

    genImage.image_request = true;
    genImage.canAfford = true;
    genImage.image_num = 1;
    genImage.nsfw = genImage.nsfw;
    console.log(`[HandleImageGeneration] Image request details:`, genImage);

    // Check for custom prompt
    let customPromptData = null;
    if(currentUserMessage?.promptId) {
        customPromptData = await getPromptById(db, currentUserMessage.promptId);
        if(customPromptData) {
            genImage.nsfw = customPromptData.nsfw == 'on' ? true : false;
            genImage.promptId = currentUserMessage.promptId;
            genImage.customPose = customPromptData.prompt;
        }
    }

    // Update user minimum image
    const userMinImage = await getUserMinImages(db, userId, chatId);
    genImage.image_num = Math.max(genImage.image_num || 1, userMinImage || 1);

    let imgMessage = [{ role: 'user', name: 'master' }];

    if(genImage.canAfford) {
        const imageId = Math.random().toString(36).substr(2, 9);
        const pending_tasks = await getTasks(db, 'pending', userId);
        
        if(pending_tasks.length > 5 && !isAdmin){
            fastify.sendNotificationToUser(userId, 'showNotification', { 
                message: translations.too_many_pending_images, 
                icon:'warning' 
            });
        } else {

            const image_num = Math.min(Math.max(genImage?.image_num || 1, 1), 5);
            
            // Charge points for image generation
            if (!currentUserMessage?.promptId) {
                const cost = getImageGenerationCost(image_num);
                try {
                    await removeUserPoints(db, userId, cost, translations.points?.deduction_reasons?.image_generation || 'Image generation', 'image_generation', fastify);
                } catch (error) {
                    console.log(`[handleImageGeneration] Error deducting points: ${error}`);
                    genImage.canAfford = false;
                }
            }

            fastify.sendNotificationToUser(userId, 'addIconToLastUserMessage');

            console.log(`[handleImageGeneration] Generating ${image_num} images for user ${userId} in chat ${chatId}`);
            
            // Generate unique placeholder ID for tracking
            const placeholderId = `auto_${new Date().getTime()}_${Math.random().toString(36).substring(2, 8)}`; 
            
            // Notify frontend to show loader with the same pattern as prompt generation
            for (let i = 0; i < image_num; i++) {
                fastify.sendNotificationToUser(userId, 'handleLoader', { imageId: placeholderId, action:'show' });
            }
            
            const imageType = genImage.nsfw ? 'nsfw' : 'sfw';
            console.log(`[handleImageGeneration] Image type set to: ${imageType}`);
            
            // Create prompt and generate image
            createPrompt(lastUserMessage.content, characterDescription, imageType)
                .then(async(promptResponse) => {
                    const prompt = promptResponse.replace(/(\r\n|\n|\r)/gm, " ").trim();
                    processPromptToTags(db, prompt);
                    
                    const aspectRatio = null;
                    
                    // Use the same generateImg pattern but with auto-generation metadata
                    const result = await generateImg({
                        prompt, 
                        aspectRatio, 
                        userId, 
                        chatId, 
                        userChatId, 
                        imageType, 
                        image_num, 
                        chatCreation: false, 
                        placeholderId: placeholderId, 
                        translations, 
                        fastify,
                        isAutoGeneration: true  // Add this flag to identify auto-generated images
                    });
                    
                    // Store the generation metadata for frontend polling
                    if (result && result.taskId) {
                        console.log(`[handleImageGeneration] ✅ Image generation started with taskId: ${result.taskId}`);
                        fastify.sendNotificationToUser(userId, 'registerAutoGeneration', {
                            taskId: result.taskId,
                            placeholderId: placeholderId,
                            userChatId: userChatId,
                            startTime: Date.now()
                        });
                    } else {
                        console.warn(`[handleImageGeneration] ⚠️ No taskId returned from generateImg`);
                    }
                })
                .catch((error) => {
                    console.error(`[handleImageGeneration] ❌ Auto generation error:`, error);
                    fastify.sendNotificationToUser(userId, 'handleLoader', { imageId: placeholderId, action: 'remove' });
                });
            
            imgMessage[0].content = `\n\n${translations.image_generation?.activated || 'I activated the image generation feature for this prompt.\n The image will be generated shortly.'}`.trim();
            currentUserMessage.name = 'context';
        }
    } else {
        genImage.image_request = false;
        imgMessage[0].content = `\n\n${translations.image_generation?.insufficient_points || 'I asked for an other image but I do not have enough points.\n Tell me that I can buy points. Provide a concise answer to inform me of that and tell me if I want to subscribe there is 70% promotion right now. Stay in your character, keep the same tone as previously. Respond in the language we were talking until now.'}`.trim();
        currentUserMessage.name = 'context';
        fastify.sendNotificationToUser(userId, 'openBuyPointsModal', { userId });
    }

    return { imgMessage, genImage };
}

// Handles chat goals
async function handleChatGoals(db, userData, userChatId, chatDescription, personaInfo, userSettings, subscriptionStatus, language, request, fastify, userId, chatId) {
    const messageCount = userData.messages.filter(m => m.role === 'user' || m.role === 'assistant').length;
    let chatGoal = null;
    let goalCompletion = null;

    if (messageCount <= 3 || !userData.currentGoal) {
        chatGoal = await generateChatGoal(chatDescription, personaInfo, userSettings, subscriptionStatus, language);
        
        if (chatGoal) {
            await db.collection('userChat').updateOne(
                { _id: new ObjectId(userChatId) },
                { $set: { currentGoal: chatGoal, goalCreatedAt: new Date() } }
            );
        }
    } else if (userData.currentGoal) {
        chatGoal = userData.currentGoal;
        goalCompletion = await checkGoalCompletion(chatGoal, userData.messages, language);
        
        if (goalCompletion.completed && goalCompletion.confidence > 70) {
            
            await db.collection('userChat').updateOne(
                { _id: new ObjectId(userChatId) },
                { 
                    $set: { 
                        completedGoals: [...(userData.completedGoals || []), { 
                            ...chatGoal, 
                            completedAt: new Date(), 
                            reason: goalCompletion.reason 
                        }],
                        currentGoal: null 
                    } 
                }
            );
            
            await db.collection('chat_goal').updateOne(
                { userId: new ObjectId(userId), chatId: new ObjectId(chatId) },
                { $inc: { completionCount: 1 } },
                { upsert: true }
            );
            
            const rewardPoints = chatGoal.difficulty === 'easy' ? 100 : chatGoal.difficulty === 'medium' ? 200 : 300;
            
            fastify.sendNotificationToUser(userId, 'showNotification', { 
                message: request.translations.chat_goal_completed.replace('{{points}}', rewardPoints), 
                icon: 'success' 
            });
            
            await addUserPoints(db, userId, rewardPoints, request?.userPointsTranslations.points?.reward_reasons?.goal_completion || 'Goal completion reward', 'goal_completion', fastify);

            chatGoal = await generateChatGoal(chatDescription, personaInfo, userSettings, subscriptionStatus, language);

            if (chatGoal) {
                await db.collection('userChat').updateOne(
                    { _id: new ObjectId(userChatId) },
                    { $set: { currentGoal: chatGoal, goalCreatedAt: new Date() } }
                );
            }
        }
    }

    return { chatGoal, goalCompletion };
}

// Updates messages count
async function updateMessagesCount(db, chatId) {
    const collectionChat = db.collection('chats');
    await collectionChat.updateOne(
        { _id: new ObjectId(chatId) },
        { $inc: { messagesCount: 1 } }
    );
}

// Updates the last message in the 'chatLastMessage' collection
async function updateChatLastMessage(db, chatId, userId, completion, updatedAt) {
    const collectionChatLastMessage = db.collection('chatLastMessage');
    await collectionChatLastMessage.updateOne(
        {
            chatId: new ObjectId(chatId),
            userId: new ObjectId(userId)
        },
        {
            $set: {
                lastMessage: {
                    role: 'assistant',
                    content: removeContentBetweenStars(completion),
                    updatedAt
                }
            }
        },
        { upsert: true }
    );
}

// Updates user chat messages in 'userChat' collection
async function updateUserChat(db, userId, userChatId, newMessages, updatedAt) {
    const collectionUserChat = db.collection('userChat');
    const userChat = await collectionUserChat.findOne({
        userId: new ObjectId(userId),
        _id: new ObjectId(userChatId)
    });

    if (!userChat) throw new Error('User chat not found');

    const existingMessages = userChat.messages || [];
    const combinedMessages = [...existingMessages];

    // Track how many new messages are added (not updates) for stats
    let newMessageCount = 0;

    for (const newMsg of newMessages) {
        // CRITICAL FIX: Never match/replace image messages by content
        // Image messages have imageId or batchId - these should always be unique
        // Only match text messages (no imageId, no batchId) by content
        const isNewMsgImage = newMsg.imageId || newMsg.batchId || newMsg.type === 'image' || newMsg.type === 'mergeFace';
        
        let index = -1;
        if (!isNewMsgImage) {
            // For non-image messages, find by content match (but skip image messages in existing)
            index = combinedMessages.findIndex(
                (msg) => msg.content === newMsg.content && !msg.imageId && !msg.batchId && msg.type !== 'image' && msg.type !== 'mergeFace'
            );
        }
        
        if (index !== -1) {
            combinedMessages[index] = newMsg;
        } else {
            combinedMessages.push(newMsg);
            // Only count user and assistant messages for stats
            if (newMsg.role === 'user' || newMsg.role === 'assistant') {
                newMessageCount++;
            }
        }
    }

    await collectionUserChat.updateOne(
        {
            userId: new ObjectId(userId),
            _id: new ObjectId(userChatId)
        },
        { $set: { messages: combinedMessages, updatedAt } }
    );

    // Increment message count in user_chat_stats if new messages were added
    if (newMessageCount > 0 && userChat.chatId) {
        await incrementMessageCount(db, userId, userChat.chatId, userChatId, newMessageCount);
    }
}

// Removes content between asterisks to clean up the message
function removeContentBetweenStars(str) {
    if (!str) return str;
    return str.replace(/\*.*?\*/g, '').replace(/"/g, '');
}

// Handles sending gallery image
async function handleGalleryImage(db, lastUserMessage, userData, userChatId, userId, fastify) {
   if (!lastUserMessage.sendImage) return;

    const chatsGalleryCollection = db.collection('gallery');
    const gallery = await chatsGalleryCollection.findOne({ chatId: new ObjectId(userData.chatId) });
    
    if (gallery && gallery.images && gallery.images.length > 0) {
        const image = gallery.images[Math.floor(Math.random() * gallery.images.length)];
        
        const data = {
            userChatId, 
            imageId: image._id, 
            imageUrl: image.imageUrl, 
            title: image.title, 
            prompt: image.prompt, 
            nsfw: image.nsfw
        };
        
        fastify.sendNotificationToUser(userId, 'imageGenerated', data);

        const imageMessage = { 
            role: "assistant", 
            type: "image", 
            imageId: image._id.toString(), 
            imageUrl: image.imageUrl,
            content: `I generated an image for you! It describes: ${image.prompt}`,
            timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }),
            createdAt: new Date()
        };
        
        // Update the database directly with atomic duplicate check
        // IMPORTANT: Must use $not + $elemMatch for array field checks, NOT $ne!
        // $ne on arrays matches if ANY element doesn't match, which is always true for arrays
        const collectionUserChat = db.collection('userChat');
        const updateResult = await collectionUserChat.updateOne(
            {
                userId: new ObjectId(userId),
                _id: new ObjectId(userChatId),
                messages: { $not: { $elemMatch: { imageId: image._id.toString() } } }  // Atomic duplicate check
            },
            { 
                $push: { messages: imageMessage },
                $set: { updatedAt: new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }) }
            }
        );
        
        if (updateResult.modifiedCount > 0) {
            // Only update local object if DB was actually modified
            userData.messages.push(imageMessage);
            userData.updatedAt = new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' });
            console.log(`[handleGalleryImage] Image message added successfully`);
        } else {
            console.log(`[handleGalleryImage] Image message already exists or chat not found, skipping`);
        }
    }
}

module.exports = {
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
    removeContentBetweenStars,
    handleGalleryImage,
    getLanguageDirectiveMessage
};
