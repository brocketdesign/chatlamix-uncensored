const { ObjectId } = require('mongodb');
const slugify = require('slugify');
const {
    checkImageRequest, 
    generateCompletion,
    generateEditPrompt,
    generatePromptSuggestions,
    createPrompt,
    generateChatGoal,
    checkGoalCompletion,
} = require('../models/openai')
const { 
    checkImageDescription,
    generateImg,
    getPromptById, 
    getTasks
} = require('../models/imagen');
const { 
    getLanguageName, 
    handleFileUpload,
    convertImageUrlToBase64, 
    sanitizeMessages,
    fetchTags,
    processPromptToTags,
    saveChatImageToDB,
    saveUserChatBackgroundImageToDB,
    checkUserAdmin,
    getApiUrl
} = require('../models/tool');
const {
    getUserChatToolSettings,
    applyUserSettingsToPrompt,
    getVoiceSettings,
    getUserMinImages
} = require('../models/chat-tool-settings-utils');
const { getActiveSystemPrompt } = require('../models/system-prompt-utils');
const { addUserPoints, removeUserPoints, getUserPoints, awardCharacterMessageMilestoneReward } = require('../models/user-points-utils');
const { getGalleryImageById, toObjectId } = require('../models/gallery-utils');

const axios = require('axios');
const sharp = require('sharp');

const free_models = false // ['293564']; // [DEBUG] Disable temporary


    // -------------------- Helper functions --------------------

    // Helper function to tokenize a prompt string (can be moved to a shared utility if used elsewhere)
    function tokenizePrompt(promptText) {
        if (!promptText || typeof promptText !== 'string') {
            return new Set();
        }
        return new Set(
            promptText
            .toLowerCase()
            .split(/\W+/) // Split by non-alphanumeric characters
            .filter(token => token.length > 0) // Remove empty tokens
        );
    }
    // Fetches user info from 'users' collection
    async function getUserInfo(db, userId, fastify) {
        return db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });
    }

    // Fetches user chat data from 'userChat' collection
    async function getUserChatData(db, userId, userChatId, fastify) {
        return db.collection('userChat').findOne({ 
            userId: new fastify.mongo.ObjectId(userId), 
            _id: new fastify.mongo.ObjectId(userChatId) 
        });
    }

    // Fetches chat document from 'chats' collection
    async function getChatDocument(request, db, chatId, fastify) {
        const getChatDocStartTime = Date.now();
        
        try {
            let chatdoc = await db.collection('chats').findOne({ _id: new ObjectId(chatId)});
            
            if (!chatdoc) {
                throw new Error(`Chat not found for chatId: ${chatId}`);
            }
            
            // Check if chatdoc is updated to the new format
            const hasSystemPrompt = !!chatdoc?.system_prompt;
            const hasDetailsDescription = !!chatdoc?.details_description;
            const hasReferenceCharacter = !!chatdoc?.details_description?.personality?.reference_character;
            
            if(!hasSystemPrompt || !hasDetailsDescription || !hasReferenceCharacter) {
                console.log(`[getChatDocument] Incomplete chat detected - triggering regeneration for chatId: ${chatId}`);
                
                // Check if we have the required fields to regenerate
                if (!chatdoc.characterPrompt || chatdoc.characterPrompt.trim() === '') {
                    console.warn(`[getChatDocument] Cannot regenerate - characterPrompt is empty. Returning incomplete document.`);
                    return chatdoc;
                }

                const apiUrl = getApiUrl(request);
                const purpose = chatdoc?.chatPurpose || 'character';
                const language = chatdoc?.language || 'en';
                
                try {
                    console.log(`[getChatDocument] Calling /api/generate-character-comprehensive for chatId: ${chatId}`);
                    
                    const response = await axios.post(apiUrl+'/api/generate-character-comprehensive', {
                        userId: request.user._id,
                        chatId,
                        name: chatdoc.name,
                        prompt: chatdoc.characterPrompt,
                        gender: chatdoc.gender,
                        nsfw: chatdoc.nsfw,
                        chatPurpose: purpose,
                        language
                    }, { timeout: 120000 }); // 2 minute timeout
                    
                    if (!response.data.chatData) {
                        throw new Error('Response missing chatData field');
                    }
                    
                    chatdoc = response.data.chatData;
                    
                    // Quick validation
                    if (!chatdoc?.system_prompt || !chatdoc?.details_description?.personality?.reference_character) {
                        throw new Error('Regenerated data still missing critical fields');
                    }
                    
                    const regenTime = Date.now() - getChatDocStartTime;
                    console.log(`[getChatDocument] ✅ Regenerated in ${regenTime}ms for chatId: ${chatId}`);
                    
                } catch (regenerationError) {
                    console.error(`[getChatDocument] ❌ Regeneration failed: ${regenerationError.message}`);
                    
                    if (regenerationError.response?.status) {
                        console.error(`[getChatDocument] Response status: ${regenerationError.response.status}`);
                    }
                    
                    console.warn(`[getChatDocument] Returning incomplete document - chat may not function properly`);
                    return chatdoc; // Return incomplete document instead of throwing
                }
            }

            return chatdoc;
            
        } catch (error) {
            console.error(`[getChatDocument] ❌ Fatal error: ${error.message}`);
            throw error;
        }
    }

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
    
async function routes(fastify, options) {

// ========== NEW: Scenario-Focused Init Chat Route ==========
fastify.post('/api/init-chat', async (request, reply) => {
    try {
      // Mongo collections
      const usersCollection = fastify.mongo.db.collection('users');
      const collectionChat = fastify.mongo.db.collection('chats');
      const collectionUserChat = fastify.mongo.db.collection('userChat');
      

      // Extract and normalize request data
      let { message, chatId, userChatId, isNew } = request.body;
      let userId = request.body.userId;
      if (!userId) {
        const authenticatedUser = request.user;
        userId = authenticatedUser._id;
      }

            const user = request.user;
            let language = getLanguageName(user?.lang);
      
            const now = new Date();
            const nowIsoString = now.toISOString();

      // Retrieve chat and user-chat documents
      let userChatDocument = await collectionUserChat.findOne({ 
        userId: new fastify.mongo.ObjectId(userId), 
        _id: new fastify.mongo.ObjectId(userChatId) 
      });

    if (!userChatDocument || isNew) {
        // Initialize new userChat document
        // Scenario will be selected separately via /api/chat-scenarios/:userChatId/select
        // Once scenario is selected, it will be stored in currentScenario field
        // and used in chat-completion for generating scenario-aware responses
        
        userChatDocument = {
            userId: new fastify.mongo.ObjectId(userId),
            chatId: new fastify.mongo.ObjectId(chatId),
            createdAt: now,
            updatedAt: now,
            messages: [],
            // Scenario fields - populated after user selects a scenario
            availableScenarios: null,
            currentScenario: null,
            scenarioCreatedAt: null
        };
    }

      let result = await collectionUserChat.insertOne(userChatDocument);
      let documentId = result.insertedId;

      // Reply with summary
      return reply.send({ 
        userChatId: documentId, 
        chatId
      });
  
    } catch (error) {
      console.log(error);
      return reply.status(403).send({ error: error.message });
    }
});

// ========== DEPRECATED: Old Init Chat Route (Image-Focused) ==========
// DEPRECATED: November 9, 2025
// PURPOSE: Legacy route for old image-based initialization
// NOTE: This route is deprecated. Use /api/init-chat for scenario-focused experience.
// To reactivate: Change endpoint from /api/deprecated/init-chat to /api/init-chat
fastify.post('/api/deprecated/init-chat', async (request, reply) => {
    try {
      // Mongo collections
      const usersCollection = fastify.mongo.db.collection('users');
      const collectionChat = fastify.mongo.db.collection('chats');
      const collectionUserChat = fastify.mongo.db.collection('userChat');
      

      // Extract and normalize request data
      let { message, chatId, userChatId, isNew } = request.body;
      let userId = request.body.userId;
      if (!userId) {
        const authenticatedUser = request.user;
        userId = authenticatedUser._id;
      }

            const user = request.user;
            let language = getLanguageName(user?.lang);
      
            const now = new Date();
            const nowIsoString = now.toISOString();

      // Retrieve chat and user-chat documents
      let userChatDocument = await collectionUserChat.findOne({ 
        userId: new fastify.mongo.ObjectId(userId), 
        _id: new fastify.mongo.ObjectId(userChatId) 
      });

    if (!userChatDocument || isNew) {
        const isLoggedIn = user && !user.isTemporary;
        let startMessage = { role: 'user', name: 'master' };

        // Helper function to get localized messages (ORIGINAL - Image-focused)
        const getLocalizedMessages = (lang) => {
            const messages = {
                'french': {
                    welcomeBack: "Commence en me souhaitant la bienvenue. Informe-moi que tu apprécies nos conversations et demande-moi si j'aimerais voir une autre image.",
                    firstMeetingWithSub: "Commence par me saluer, dis que c'est agréable de me rencontrer pour la première fois, présente-toi. Parle de notre relation actuelle et informe-moi que nous pourrions devenir plus intimes si je m'abonne.",
                    firstMeetingNoSub: "Commence par me saluer, dis que c'est agréable de me rencontrer pour la première fois, présente-toi. Parle de notre relation actuelle.",
                    firstMeetingWithImageSub: "Commence par me saluer, dis que c'est agréable de me rencontrer, présente-toi et informe-moi que tu veux envoyer une image, mais demande quelle image je préfère.",
                    firstMeetingWithImageNoSub: "Commence par me saluer, dis que c'est agréable de me rencontrer, présente-toi et informe-moi que tu veux envoyer une image (la conversation est temporaire car je ne suis pas abonné), demande quelle image je préfère, et exprime ton espoir que j'apprécierai la conversation et deviendrai un utilisateur permanent."
                },
                'english': {
                    welcomeBack: "Start by welcoming me back. Inform me that you enjoy our chats and ask if I would like to see another image.",
                    firstMeetingWithSub: "Start by greeting me, say it's nice to meet me for the first time, introduce yourself. Tell about the current relationship with me, and inform me that we could get more intimate if I enroll in a subscription.",
                    firstMeetingNoSub: "Start by greeting me, say it's nice to meet me for the first time, introduce yourself. Tell about the current relationship with me.",
                    firstMeetingWithImageSub: "Start by greeting me, say it's nice to meet me, introduce yourself and inform me that you want to send an image, but ask which image I prefer.",
                    firstMeetingWithImageNoSub: "Start by greeting me, say it's nice to meet me, introduce yourself and inform me that you want to send an image (the chat is temporary because I'm not subscribed), ask which image I prefer, and express your hope that I'll enjoy the chat and become a permanent user."
                },
                'japanese': {
                    welcomeBack: "お帰りなさいと挨拶することから始めてください。私たちのチャットを楽しんでいることを伝え、別の画像を見たいかどうか尋ねてください。",
                    firstMeetingWithSub: "挨拶から始めて、初めてお会いできて嬉しいと言い、自己紹介をしてください。現在の私との関係について話し、サブスクリプションに登録すればより親密になれることを伝えてください。",
                    firstMeetingNoSub: "挨拶から始めて、初めてお会いできて嬉しいと言い、自己紹介をしてください。現在の私との関係について話してください。",
                    firstMeetingWithImageSub: "挨拶から始めて、初めてお会いできて嬉しいと言い、自己紹介をして、画像を送りたいと伝えますが、どの画像が好みか尋ねてください。",
                    firstMeetingWithImageNoSub: "挨拶から始めて、初めてお会いできて嬉しいと言い、自己紹介をして、画像を送りたいと伝えてください（サブスクリプションに登録していないためチャットは一時的です）。どの画像が好みか尋ね、チャットを楽しんで永続的なユーザーになってくれることを願っていると表現してください。"
                }
            };
            
            // Default to English if language not found
            return messages[lang] || messages['english'];
        };

        const localizedMessages = getLocalizedMessages(language);

        if (!isLoggedIn) {
            // [DEBUG] Disable temporary
            /*
            startMessage.content = localizedMessages.loginPrompt;
            */
        } else {
            const subscriptionActive = user?.subscriptionStatus === 'active';
            const userChat = await collectionUserChat
            .find({
                userId: new fastify.mongo.ObjectId(userId),
                chatId: new fastify.mongo.ObjectId(chatId),
            })
            .toArray();

            if (userChat.length > 0) {
                startMessage.sendImage = true;
                startMessage.content = localizedMessages.welcomeBack;
            } else {
                startMessage.sendImage = true;
                if (!subscriptionActive) {
                    startMessage.content = localizedMessages.firstMeetingWithSub;
                } else {
                    startMessage.content = localizedMessages.firstMeetingNoSub;
                }
                const chatsGalleryCollection = fastify.mongo.db.collection('gallery');
                const gallery = await chatsGalleryCollection.findOne({
                    chatId: new fastify.mongo.ObjectId(chatId),
                });
                if (!gallery?.images || gallery.images.length === 0) {
                    if (subscriptionActive) {
                    startMessage.content = localizedMessages.firstMeetingWithImageSub;
                    } else {
                    startMessage.content = localizedMessages.firstMeetingWithImageNoSub;
                    }
                    startMessage.sendImage = false;
                }
            }
        }
        startMessage.createdAt = nowIsoString;
        startMessage.timestamp = nowIsoString;
        
        userChatDocument = {
            userId: new fastify.mongo.ObjectId(userId),
            chatId: new fastify.mongo.ObjectId(chatId),
            createdAt: now,
            updatedAt: now,
            messages: [startMessage],
        };
    }

      let result = await collectionUserChat.insertOne(userChatDocument);
      let documentId = result.insertedId;

      // Reply with summary
      return reply.send({ 
        userChatId: documentId, 
        chatId
      });
  
    } catch (error) {
      console.log(error);
      return reply.status(403).send({ error: error.message });
    }
});

    fastify.post('/api/check-chat', async (request, reply) => {
      try {
        let chatId = request?.body?.chatId 
        chatId = chatId !== undefined && chatId !== null && chatId !== ''
        ? new fastify.mongo.ObjectId(request.body.chatId) 
        : new fastify.mongo.ObjectId(); 
        
        const userId = new fastify.mongo.ObjectId(request.user._id);
        const chatsCollection = fastify.mongo.db.collection('chats');
        const isAdmin = await checkUserAdmin(fastify, userId);
        const existingChat = await chatsCollection.findOne({ _id: chatId });
        
        if (existingChat) {
        if (existingChat?.userId?.equals(userId) || isAdmin) {
            return reply.code(200).send({ message: 'Chat exists', chat: existingChat });
        } else {
          // Create a new chat if the current userId is not the chat userId
          console.log('[api/check-chat] Creating new chat for user:', userId);
          const newChatId = new fastify.mongo.ObjectId();
          await chatsCollection.insertOne({
            _id: newChatId,
            userId,
            language: request.lang,
            isTemporary: false,
          });
          return reply.code(201).send({ message: 'New chat created', chatId: newChatId });
        }
        }
        console.log('[api/check-chat] Creating new chat for user:', userId);
        await chatsCollection.insertOne({
        _id: chatId,
        userId,
        language: request.lang,
        isTemporary: false,
        });
        
        return reply.code(201).send({ message: 'Chat created', chatId });
      } catch (error) {
        console.error('Error in /api/check-chat:', error);
        return reply.code(500).send({ message: 'Internal Server Error', error: error.message });
      }
    });
      
      
   
    
    fastify.delete('/api/delete-chat/:id', async (request, reply) => {
        try {
            const chatId = request.params.id;
            const user = request.user;
            const userId = new fastify.mongo.ObjectId(user._id);

            // Access the MongoDB collection
            const chatCollection = fastify.mongo.db.collection('chats');
            const chat = await chatCollection.findOne(
                { 
                    _id: new fastify.mongo.ObjectId(chatId)
                 }
            );

            if (!chat) {
                return reply.status(404).send({ error: 'Chat not found' });
            }

            // Delete the chat from MongoDB
            await chatCollection.deleteOne({ _id: new fastify.mongo.ObjectId(chatId) });

            return reply.send({ message: 'Chat deleted successfully' });
        } catch (error) {
            // Handle potential errors
            console.error('Failed to delete chat:', error);
            return reply.status(500).send({ error: 'Failed to delete chat' });
        }
    });

    // Admin: Delete a specific image from a character's gallery
    fastify.delete('/api/admin/delete-image/:chatId/:imageId', async (request, reply) => {
        try {
            const { chatId, imageId } = request.params;
            const user = request.user;
            const userId = new fastify.mongo.ObjectId(user._id);

            const isAdmin = await checkUserAdmin(fastify, userId);
            if (!isAdmin) {
                return reply.status(403).send({ error: 'Forbidden' });
            }

            const db = fastify.mongo.db;
            const galleryCollection = db.collection('gallery');

            // Remove the image from the gallery document's images array
            const result = await galleryCollection.updateOne(
                { chatId: new fastify.mongo.ObjectId(chatId) },
                { $pull: { images: { _id: new fastify.mongo.ObjectId(imageId) } } }
            );

            if (result.modifiedCount === 0) {
                return reply.status(404).send({ error: 'Image not found' });
            }

            return reply.send({ success: true });
        } catch (error) {
            console.error('Failed to delete image:', error);
            return reply.status(500).send({ error: 'Failed to delete image' });
        }
    });

    // This route handles updating the NSFW status of a chat
    fastify.put('/api/chat/:chatId/nsfw', async (request, reply) => {
        try {
          const { chatId } = request.params;
          const { nsfw } = request.body;
          const user = request.user;
          const userId = new fastify.mongo.ObjectId(user._id);
      
          // Check admin rights
          const isAdmin = await checkUserAdmin(fastify, userId);
          if (!isAdmin) {
            return reply.status(403).send({ error: 'Forbidden' });
          }
      
          const chatsCollection = fastify.mongo.db.collection('chats');
          const result = await chatsCollection.updateOne(
            { _id: new fastify.mongo.ObjectId(chatId) },
            { $set: { nsfw: !!nsfw } }
          );

          if (result.modifiedCount === 1) {
            reply.send({ success: true });
          } else {
            console.error('Chat not found or not updated:', chatId);
            const findChat = await chatsCollection.findOne({ _id: new fastify.mongo.ObjectId(chatId) });
            if(findChat.nsfw === !!nsfw) {
                console.log('Chat already has the requested NSFW status');
                return reply.send({ success: true, message: 'Chat already has the requested NSFW status' });
            }
            reply.status(404).send({ error: 'Chat not found or not updated' });
          }
        } catch (error) {
          reply.status(500).send({ error: 'Failed to update NSFW status' });
        }
    });

    fastify.post('/api/chat/', async (request, reply) => {
        let { userId, chatId, userChatId } = request.body;
        const collection = fastify.mongo.db.collection('chats');
        const collectionUserChat = fastify.mongo.db.collection('userChat');
        const collectionCharacters = fastify.mongo.db.collection('characters');

        let response = {
            isNew: true,
        };

        try {
            
            let userChatDocument = await collectionUserChat.findOne({
                userId: new fastify.mongo.ObjectId(userId),
                _id: new fastify.mongo.ObjectId(userChatId),
                chatId: new fastify.mongo.ObjectId(chatId)
            });

            if (userChatDocument) {
                const now = new Date();
                const nowIsoString = now.toISOString();
                await collectionUserChat.updateOne(
                    {
                        _id: userChatDocument._id
                    },
                    {
                        $set: {
                            updatedAt: now
                        }
                    }
                );
                await collection.updateOne(
                    {
                        _id: new fastify.mongo.ObjectId(chatId)
                    },
                    {
                        $set: {
                            updatedAt: now
                        }
                    }
                );
                userChatDocument.updatedAt = now;
                response.userChat = userChatDocument;
                response.isNew = false;
                
                // check for a persona id
                try {
                    if(userChatDocument.persona){
                        const persona = await collection.findOne({ _id: new fastify.mongo.ObjectId(userChatDocument.persona) });
                        if (persona) {
                            response.userChat.persona = persona;
                        } else {
                            response.userChat.persona = null;
                        }
                    }
                } catch (error) {
                    console.error('Error fetching persona:', error);
                }
            }
        } catch (error) {
            // Log error if necessary, or handle it silently
        }
        try {
            const chat = await collection.findOne({ _id: new fastify.mongo.ObjectId(chatId) });
            if (!chat) {
                response.chat = false;
                return reply.send(response);  // Chat not found, but no error is thrown or logged
            }
            response.chat = chat;
            if(chat.chatImageUrl){
                const image_url = new URL(chat.chatImageUrl);
                const path = image_url.pathname;

                const character = await collectionCharacters.findOne({
                    image: { $regex: path }
                });
                if (character) {
                    response.character = character;
                } else {
                    response.character = null;
                }
            }
            // ===========================
            // == User Chat Message Image Debug ==
            // ===========================
            if (false && response.userChat?.messages) {
                console.log('\n==============================');
                console.log(`== User Chat Message (${userChatId}) Image Debug ==`);
                console.log('==============================');
                response.userChat.messages.forEach(msg => {
                    if (msg.imageId || msg.mergeId) {
                        console.log(
                            '🕒 createdAt:', msg.createdAt, '\n' +
                            '⚙️ type:', msg.type || 'N/A', '\n' +
                            '🖼️ imageId:', msg.imageId || '', '\n' +
                            '🔗 mergeId:', msg.mergeId || '', '\n' +
                            '🌐 imageUrl:', msg.imageUrl || '', '\n' +
                            '🏷️ originalImageUrl:', msg.originalImageUrl || ''
                        );
                        console.log('------------------------------');
                    }
                });
                console.log(`== End of User Chat Message (${userChatId}) Image Debug ==\n`);
            }
            // ===========================
            // == End Section ==
            // ===========================
            return reply.send(response);
        } catch (error) {
            console.error('Failed to retrieve chat or character:', error);
            return reply.status(500).send({ error: 'Failed to retrieve chat or character' });
        }
    });
    fastify.put('/chat/:chatId/image', async (request, reply) => {
        const { chatId } = request.params;
        const { imageUrl } = request.body;
        await saveChatImageToDB(fastify.mongo.db, chatId, imageUrl);
        reply.send({ success: true });
    });
      
    fastify.put('/api/user-chat/:userChatId/background-image', async (request, reply) => {
        const { userChatId } = request.params;
        const { imageId, imageUrl } = request.body;
        await saveUserChatBackgroundImageToDB(fastify.mongo.db, userChatId, imageId, imageUrl);
        reply.send({ success: true });
    });
      
    fastify.post('/api/chat/add-message', async (request, reply) => {
        const { chatId, userChatId, role, message, image_request, name, hidden, imageUrl } = request.body;
        
        const messageType = image_request ? 'IMAGE_REQUEST' : (name ? `SUGGESTION_${name.toUpperCase()}` : 'TEXT');

        console.log(`\n📨📨📨 [/api/chat/add-message] ═══════════════════════════════════════════════════════════`);
        console.log(`📨 [/api/chat/add-message] START - Adding ${messageType} message to userChatId: ${userChatId}`);

        try {
            const collectionUserChat = fastify.mongo.db.collection('userChat');
            let userData = await collectionUserChat.findOne({ _id: new fastify.mongo.ObjectId(userChatId) });
    
            if (!userData) {
                console.log(`📨📨📨 [/api/chat/add-message] END (user not found) ═══════════════════════════════════\n`);
                return reply.status(404).send({ error: 'User data not found' });
            }
            
            // DEBUG: Log current state BEFORE modification
            const messageCountBefore = userData.messages?.length || 0;
            const imageMessagesBefore = userData.messages?.filter(m => m.imageId || m.type === 'image' || m.type === 'mergeFace') || [];
            console.log(`📊 [/api/chat/add-message] FETCHED STATE:`);
            console.log(`   Total messages fetched: ${messageCountBefore}`);
            console.log(`   Image messages: ${imageMessagesBefore.length}`);
            
            // Check for any duplicates in fetched data
            const debugIdCounts = {};
            userData.messages?.forEach(m => {
                if (m._debugId) {
                    debugIdCounts[m._debugId] = (debugIdCounts[m._debugId] || 0) + 1;
                }
            });
            const duplicateDebugIds = Object.entries(debugIdCounts).filter(([k, v]) => v > 1);
            if (duplicateDebugIds.length > 0) {
                console.error(`🚨🚨🚨 [/api/chat/add-message] CRITICAL: DUPLICATES ALREADY IN FETCHED DATA!`);
                duplicateDebugIds.forEach(([debugId, count]) => {
                    console.error(`🚨 _debugId ${debugId} appears ${count} times`);
                    const dupes = userData.messages.filter(m => m._debugId === debugId);
                    dupes.forEach((d, i) => {
                        console.error(`   [${i}] index=${userData.messages.indexOf(d)}, imageId=${d.imageId}, createdAt=${d.createdAt}`);
                    });
                });
            }
            
            // Log image messages for debugging
            imageMessagesBefore.forEach((img, i) => {
                console.log(`   [${i}] imageId=${img.imageId}, _debugId=${img._debugId || 'none'}, batchId=${img.batchId || 'none'}`);
            });
            
            let newMessage = { role: role };    
            newMessage.content = message
            newMessage.name = name || null;
            newMessage.hidden = hidden || false;
            newMessage.image_request = image_request || false;
            newMessage.imageUrl = imageUrl || null;
            const now = new Date();
            const nowIsoString = now.toISOString();
            newMessage.timestamp = nowIsoString;
            newMessage.createdAt = nowIsoString;
            userData.messages.push(newMessage);
            userData.updatedAt = now;
            
            console.log(`📊 [/api/chat/add-message] AFTER LOCAL PUSH: ${userData.messages.length} messages`);

            const result = await collectionUserChat.updateOne(
                { _id: new fastify.mongo.ObjectId(userChatId) },
                { $set: { messages: userData.messages, updatedAt: now } }
            );
            
            console.log(`🔒 [/api/chat/add-message] UpdateOne ($set) result: matchedCount=${result.matchedCount}, modifiedCount=${result.modifiedCount}`);
            
            // VERIFY: Check actual DB state after update
            const verifyDoc = await collectionUserChat.findOne({ _id: new fastify.mongo.ObjectId(userChatId) });
            const messageCountAfter = verifyDoc?.messages?.length || 0;
            const imageMessagesAfter = verifyDoc?.messages?.filter(m => m.imageId || m.type === 'image' || m.type === 'mergeFace') || [];
            console.log(`📊 [/api/chat/add-message] VERIFIED DB STATE:`);
            console.log(`   Total messages in DB: ${messageCountAfter}`);
            console.log(`   Image messages: ${imageMessagesAfter.length}`);
            
            // Check for duplicates after save
            const debugIdCountsAfter = {};
            verifyDoc?.messages?.forEach(m => {
                if (m._debugId) {
                    debugIdCountsAfter[m._debugId] = (debugIdCountsAfter[m._debugId] || 0) + 1;
                }
            });
            const duplicateDebugIdsAfter = Object.entries(debugIdCountsAfter).filter(([k, v]) => v > 1);
            if (duplicateDebugIdsAfter.length > 0) {
                console.error(`🚨🚨🚨 [/api/chat/add-message] CRITICAL: DUPLICATES AFTER $set!`);
                duplicateDebugIdsAfter.forEach(([debugId, count]) => {
                    console.error(`🚨 _debugId ${debugId} appears ${count} times`);
                });
            }

            try {
                const chatsCollection = fastify.mongo.db.collection('chats');
                await chatsCollection.updateOne(
                    { _id: new fastify.mongo.ObjectId(chatId) },
                    { $set: { updatedAt: now } }
                );
            } catch (chatUpdateError) {
                console.warn('Failed to update chat updatedAt timestamp:', chatUpdateError);
            }
    
            if (result.modifiedCount === 1) {
                // Award message milestone rewards for user messages only
                if (role === 'user') {
                    const totalUserMessages = userData.messages.filter(m => m.role === 'user').length;
                    
                    try {
                        const userIdString = userData.userId.toString();
                        
                        const milestoneResult = await awardCharacterMessageMilestoneReward(fastify.mongo.db, userIdString, chatId, fastify);
                        
                    } catch (error) {
                        console.error('❌ [MILESTONE ERROR]', error.message);
                    }
                }
                
                console.log(`✅ [/api/chat/add-message] SUCCESS - Message added`);
                console.log(`📨📨📨 [/api/chat/add-message] END (success) ═══════════════════════════════════════════\n`);
                reply.send({ success: true, message: 'Message added successfully' });
            } else {
                console.log(`❌ [/api/chat/add-message] FAILED - modifiedCount=0`);
                console.log(`📨📨📨 [/api/chat/add-message] END (failed) ═══════════════════════════════════════════\n`);
                reply.status(500).send({ error: 'Failed to add message' });
            }
        } catch (error) {
            console.log(error);
            console.log(`📨📨📨 [/api/chat/add-message] END (error) ═══════════════════════════════════════════\n`);
            reply.status(500).send({ error: 'Error adding message to chat' });
        }
    });

    fastify.get('/api/chat-history/:chatId', async (request, reply) => {
        try {
            const chatId = request.params.chatId;
            const userId = request.user._id;

            if (!chatId || !userId) {
                return reply.status(400).send({ error: 'Chat ID and User ID are required' });
            }
            const collectionUserChat = fastify.mongo.db.collection('userChat');
            const collectionChat = fastify.mongo.db.collection('chats');

            
            let userChat = await collectionUserChat.find({
                $and: [
                    { chatId: new fastify.mongo.ObjectId(chatId) },
                    { userId: new fastify.mongo.ObjectId(userId) },
                    { $expr: { $gte: [ { $size: "$messages" }, 1 ] } }
                ]
                
            }).sort({ _id: -1 }).toArray();

            if (!userChat || userChat.length === 0) {
                return reply.send([]);
            }
        
            return reply.send(userChat);
        } catch (error) {
            console.log(error)
        }
    });
    
      
    fastify.delete('/api/delete-chat-history/:chatId', async (request, reply) => {
        const chatId = request.params.chatId;
    
        if (!chatId) {
          throw new Error('Chat ID is required');
        }
    
        if (!isNewObjectId(chatId)) {
          throw new Error('Invalid Chat ID');
        }
    
        const collectionUserChat = fastify.mongo.db.collection('userChat');
        const userChat = await collectionUserChat.findOne({ _id: new fastify.mongo.ObjectId(chatId) });
    
        if (!userChat) {
          throw new Error('User chat data not found');
        }
    
        await collectionUserChat.deleteOne({ _id: new fastify.mongo.ObjectId(chatId) });
    
        reply.send({ message: 'Chat history deleted successfully' });
    });

    fastify.get('/api/chat-data/:chatId', async (request, reply) => {
        const { chatId } = request.params;
        try {
            const user = request.user;
            const userId = user._id;
    
            const collectionChat = fastify.mongo.db.collection('chats');
            const collectionChatLastMessage = fastify.mongo.db.collection('chatLastMessage');
            
            const chat = await collectionChat.findOne({ _id: new fastify.mongo.ObjectId(chatId) });
            if (!chat) return reply.status(404).send({ error: 'Chat not found' });
    
            const lastMessageDoc = await collectionChatLastMessage.findOne({
                chatId: new fastify.mongo.ObjectId(chatId),
                userId: new fastify.mongo.ObjectId(userId),
            });
    
            chat.lastMessage = lastMessageDoc?.lastMessage || null;            
            return reply.send(chat);
        } catch (error) {
            console.log('chatId:', chatId);
            console.error('Error fetching chat data:', error);
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    });
    
    fastify.get('/api/chat-list/:userId', async (request, reply) => {
        try {
            let userIdParam = request.params.userId || request.user._id;
            const page = Math.max(1, parseInt(request.query.page || '1', 10));
            const limit = parseInt(request.query.limit || '10', 10);
            const skip = (page - 1) * limit;

            if (!fastify.mongo.ObjectId.isValid(userIdParam)) {
                userIdParam = request.user._id;
            }
            const userObjectId = new fastify.mongo.ObjectId(userIdParam);

            const userChatColl = fastify.mongo.db.collection('userChat');
            const chatLastMessageColl = fastify.mongo.db.collection('chatLastMessage');
            
            const pipeline = [
                // Match chats for this user
                { $match: { userId: userObjectId } },

                // Sort by user's last interaction (most recent first)
                { $sort: { updatedAt: -1, _id: -1 } },

                // Join with the chats collection
                {
                    $lookup: {
                        from: 'chats',
                        localField: 'chatId',
                        foreignField: '_id',
                        as: 'chat'
                    }
                },
                { $unwind: '$chat' },

                // Merge chat fields with userChat metadata
                {
                    $replaceRoot: {
                        newRoot: {
                            $mergeObjects: [
                                '$chat',
                                {
                                    userChatId: '$_id',
                                    userChatUpdatedAt: '$updatedAt',
                                    userChatCreatedAt: '$createdAt'
                                }
                            ]
                        }
                    }
                },

                {
                    $set: {
                        userChatUpdatedAt: {
                            $ifNull: [
                                '$userChatUpdatedAt',
                                '$updatedAt',
                                '$createdAt'
                            ]
                        },
                        updatedAt: {
                            $ifNull: [
                                '$updatedAt',
                                '$userChatUpdatedAt',
                                '$createdAt'
                            ]
                        },
                        createdAt: {
                            $ifNull: [
                                '$userChatCreatedAt',
                                '$createdAt'
                            ]
                        }
                    }
                },

                {
                    $set: {
                        _sortCandidates: [
                            {
                                $let: {
                                    vars: {
                                        value: '$userChatUpdatedAt',
                                        valueType: { $type: '$userChatUpdatedAt' }
                                    },
                                    in: {
                                        $cond: [
                                            { $in: ['$$valueType', ['date', 'timestamp']] },
                                            { $toLong: '$$value' },
                                            {
                                                $cond: [
                                                    { $eq: ['$$valueType', 'string'] },
                                                    {
                                                        $let: {
                                                            vars: {
                                                                parsedIso: {
                                                                    $dateFromString: {
                                                                        dateString: '$$value',
                                                                        onError: null,
                                                                        onNull: null
                                                                    }
                                                                },
                                                                parsedIsoSpace: {
                                                                    $dateFromString: {
                                                                        dateString: '$$value',
                                                                        format: '%Y-%m-%d %H:%M:%S',
                                                                        onError: null,
                                                                        onNull: null
                                                                    }
                                                                },
                                                                parsedUs: {
                                                                    $dateFromString: {
                                                                        dateString: '$$value',
                                                                        format: '%m/%d/%Y',
                                                                        onError: null,
                                                                        onNull: null
                                                                    }
                                                                }
                                                            },
                                                            in: {
                                                                $cond: [
                                                                    { $ne: ['$$parsedIso', null] },
                                                                    { $toLong: '$$parsedIso' },
                                                                    {
                                                                        $cond: [
                                                                                { $ne: ['$$parsedIsoSpace', null] },
                                                                                { $toLong: '$$parsedIsoSpace' },
                                                                                {
                                                                                    $cond: [
                                                                                        { $ne: ['$$parsedUs', null] },
                                                                                        { $toLong: '$$parsedUs' },
                                                                                        null
                                                                                    ]
                                                                                }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        }
                                                    },
                                                    null
                                                ]
                                            }
                                        ]
                                    }
                                }
                            },
                            {
                                $let: {
                                    vars: {
                                        value: '$updatedAt',
                                        valueType: { $type: '$updatedAt' }
                                    },
                                    in: {
                                        $cond: [
                                            { $in: ['$$valueType', ['date', 'timestamp']] },
                                            { $toLong: '$$value' },
                                            {
                                                $cond: [
                                                    { $eq: ['$$valueType', 'string'] },
                                                    {
                                                        $let: {
                                                            vars: {
                                                                parsedIso: {
                                                                    $dateFromString: {
                                                                        dateString: '$$value',
                                                                        onError: null,
                                                                        onNull: null
                                                                    }
                                                                },
                                                                parsedIsoSpace: {
                                                                    $dateFromString: {
                                                                        dateString: '$$value',
                                                                        format: '%Y-%m-%d %H:%M:%S',
                                                                        onError: null,
                                                                        onNull: null
                                                                    }
                                                                },
                                                                parsedUs: {
                                                                    $dateFromString: {
                                                                        dateString: '$$value',
                                                                        format: '%m/%d/%Y',
                                                                        onError: null,
                                                                        onNull: null
                                                                    }
                                                                }
                                                            },
                                                            in: {
                                                                $cond: [
                                                                    { $ne: ['$$parsedIso', null] },
                                                                    { $toLong: '$$parsedIso' },
                                                                    {
                                                                        $cond: [
                                                                                { $ne: ['$$parsedIsoSpace', null] },
                                                                                { $toLong: '$$parsedIsoSpace' },
                                                                                {
                                                                                    $cond: [
                                                                                        { $ne: ['$$parsedUs', null] },
                                                                                        { $toLong: '$$parsedUs' },
                                                                                        null
                                                                                    ]
                                                                                }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        }
                                                    },
                                                    null
                                                ]
                                            }
                                        ]
                                    }
                                }
                            },
                            {
                                $let: {
                                    vars: {
                                        value: '$userChatCreatedAt',
                                        valueType: { $type: '$userChatCreatedAt' }
                                    },
                                    in: {
                                        $cond: [
                                            { $in: ['$$valueType', ['date', 'timestamp']] },
                                            { $toLong: '$$value' },
                                            {
                                                $cond: [
                                                    { $eq: ['$$valueType', 'string'] },
                                                    {
                                                        $let: {
                                                            vars: {
                                                                parsedIso: {
                                                                    $dateFromString: {
                                                                        dateString: '$$value',
                                                                        onError: null,
                                                                        onNull: null
                                                                    }
                                                                },
                                                                parsedIsoSpace: {
                                                                    $dateFromString: {
                                                                        dateString: '$$value',
                                                                        format: '%Y-%m-%d %H:%M:%S',
                                                                        onError: null,
                                                                        onNull: null
                                                                    }
                                                                },
                                                                parsedUs: {
                                                                    $dateFromString: {
                                                                        dateString: '$$value',
                                                                        format: '%m/%d/%Y',
                                                                        onError: null,
                                                                        onNull: null
                                                                    }
                                                                }
                                                            },
                                                            in: {
                                                                $cond: [
                                                                    { $ne: ['$$parsedIso', null] },
                                                                    { $toLong: '$$parsedIso' },
                                                                    {
                                                                        $cond: [
                                                                                { $ne: ['$$parsedIsoSpace', null] },
                                                                                { $toLong: '$$parsedIsoSpace' },
                                                                                {
                                                                                    $cond: [
                                                                                        { $ne: ['$$parsedUs', null] },
                                                                                        { $toLong: '$$parsedUs' },
                                                                                        null
                                                                                    ]
                                                                                }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        }
                                                    },
                                                    null
                                                ]
                                            }
                                        ]
                                    }
                                }
                            },
                            {
                                $let: {
                                    vars: {
                                        value: '$createdAt',
                                        valueType: { $type: '$createdAt' }
                                    },
                                    in: {
                                        $cond: [
                                            { $in: ['$$valueType', ['date', 'timestamp']] },
                                            { $toLong: '$$value' },
                                            {
                                                $cond: [
                                                    { $eq: ['$$valueType', 'string'] },
                                                    {
                                                        $let: {
                                                            vars: {
                                                                parsedIso: {
                                                                    $dateFromString: {
                                                                        dateString: '$$value',
                                                                        onError: null,
                                                                        onNull: null
                                                                    }
                                                                },
                                                                parsedIsoSpace: {
                                                                    $dateFromString: {
                                                                        dateString: '$$value',
                                                                        format: '%Y-%m-%d %H:%M:%S',
                                                                        onError: null,
                                                                        onNull: null
                                                                    }
                                                                },
                                                                parsedUs: {
                                                                    $dateFromString: {
                                                                        dateString: '$$value',
                                                                        format: '%m/%d/%Y',
                                                                        onError: null,
                                                                        onNull: null
                                                                    }
                                                                }
                                                            },
                                                            in: {
                                                                $cond: [
                                                                    { $ne: ['$$parsedIso', null] },
                                                                    { $toLong: '$$parsedIso' },
                                                                    {
                                                                        $cond: [
                                                                                { $ne: ['$$parsedIsoSpace', null] },
                                                                                { $toLong: '$$parsedIsoSpace' },
                                                                                {
                                                                                    $cond: [
                                                                                        { $ne: ['$$parsedUs', null] },
                                                                                        { $toLong: '$$parsedUs' },
                                                                                        null
                                                                                    ]
                                                                                }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        }
                                                    },
                                                    null
                                                ]
                                            }
                                        ]
                                    }
                                }
                            }
                        ]
                    }
                },

                // Only include chats that have a name
                { $match: { name: { $exists: true, $ne: '' } } },

                // Deduplicate by chat._id, keeping the most recent userChat (first after filter)
                {
                    $group: {
                        _id: '$_id', // Group by chat._id
                        doc: { $first: '$$ROOT' }
                    }
                },
                { $replaceRoot: { newRoot: '$doc' } },

                // Re-sort after deduplication to maintain order
                {
                    $set: {
                        _chatSortKey: {
                            $max: {
                                $filter: {
                                    input: '$_sortCandidates',
                                    as: 'candidate',
                                    cond: { $ne: ['$$candidate', null] }
                                }
                            }
                        }
                    }
                },
                { $project: { _sortCandidates: 0 } },
                // Sort by creation date first (latest first), then by activity, then by _id
                { 
                    $sort: { 
                        createdAt: -1,  // Latest created first
                        _chatSortKey: -1, 
                        _id: -1 
                    } 
                },
                { $project: { _chatSortKey: 0 } },

                // Pagination
                { $skip: skip },
                { $limit: limit }
            ];

            const chats = await userChatColl.aggregate(pipeline, { allowDiskUse: true }).toArray();

            const chatIds = chats.map(chat => chat._id);
            const lastMessages = await chatLastMessageColl.find({
                chatId: { $in: chatIds },
                userId: userObjectId
            }).toArray();

            const lastMessageMap = {};
            lastMessages.forEach(msg => {
                lastMessageMap[msg.chatId.toString()] = msg.lastMessage;
            });

            const normalizeDateValue = (value) => {
                if (!value) {
                    return null;
                }
                if (value instanceof Date) {
                    return value.toISOString();
                }
                if (typeof value === 'string') {
                    const parsed = Date.parse(value);
                    if (!Number.isNaN(parsed)) {
                        return new Date(parsed).toISOString();
                    }
                    return value;
                }
                return value;
            };

            const normalizeObjectIdValue = (value) => {
                if (!value) {
                    return value;
                }

                if (typeof value === 'string') {
                    return value;
                }

                if (value instanceof fastify.mongo.ObjectId) {
                    return value.toHexString();
                }

                if (typeof value === 'object') {
                    if (typeof value.toHexString === 'function') {
                        return value.toHexString();
                    }
                    if (typeof value.$oid === 'string') {
                        return value.$oid;
                    }
                }

                return value;
            };

            // Convert ObjectIds to strings for front-end
            const chatsWithStrings = chats.map(chat => ({
                ...chat,
                _id: chat._id.toString(),
                userChatId: chat.userChatId.toString(),
                userId: normalizeObjectIdValue(chat.userId),
                lastMessage: lastMessageMap[chat._id.toString()] || null,
                updatedAt: normalizeDateValue(chat.updatedAt),
                createdAt: normalizeDateValue(chat.createdAt),
                userChatUpdatedAt: normalizeDateValue(chat.userChatUpdatedAt),
                userChatCreatedAt: normalizeDateValue(chat.userChatCreatedAt)
            }));

            const totalChats = await userChatColl.countDocuments({ userId: userObjectId });

            return reply.send({
                chats: chatsWithStrings,
                userId: userIdParam.toString(),
                pagination: {
                    total: totalChats,
                    page,
                    limit,
                    totalPages: Math.ceil(totalChats / limit)
                }
            });
        } catch (error) {
            console.error('Error in /api/chat-list/:userId', error);
            return reply.code(500).send({ error: 'An error occurred' });
        }
    });

    fastify.post('/api/feedback', async (request, reply) => {
        const { reason, userId } = request.body;

        if (!userId || !reason) {
            return reply.status(400).send({ error: 'UserId and reason are required' });
        }

        const collection = fastify.mongo.db.collection('userData');

        const query = { userId: userId };
        const update = { $set: { reason: reason } };

        try {
            await collection.updateOne(query, update);

            console.log('User reason updated:', { userId: userId, reason: reason });

            return reply.send({ message: 'Feedback saved successfully' });
        } catch (error) {
            console.error('Failed to save user feedback:', error);
            return reply.status(500).send({ error: 'Failed to save user feedback' });
        }
    });

    fastify.post('/api/display-suggestions', async (request, reply) => {
        try {
            const { userChatId } = request.body;
            
            if (!userChatId) {
                return reply.status(400).send({ error: 'userChatId is required' });
            }
            
            const db = fastify.mongo.db;
            
            // Get the user from the request
            const user = request.user;
            const userId = user._id;
            
            // Fetch user information
            const userInfo = await getUserInfo(db, userId, fastify);
            const subscriptionStatus = userInfo.subscriptionStatus === 'active';
            
            // Fetch the user chat data
            const userData = await getUserChatData(db, userId, userChatId, fastify);
            
            if (!userData) {
                return reply.status(404).send({ error: 'User chat not found' });
            }
            
            // Get chat document for character description
            const chatId = userData.chatId;
            const chatDocument = await getChatDocument(request, db, chatId, fastify);
            const chatDescription = chatDataToString(chatDocument);
            
            // Get user language preference
            const language = getLanguageName(userInfo.lang);
            
            // Generate prompt suggestions
            const suggestions = await generatePromptSuggestions(userData.messages, chatDescription, language);
            
            return reply.send({ 
                success: true, 
                suggestions
            });
            
        } catch (error) {
            console.error('Error generating suggestions:', error);
            return reply.status(500).send({ error: 'Failed to generate suggestions' });
        }
    });
    // Add new API endpoint to get current goal
    fastify.get('/api/chat-goal/:userChatId', async (request, reply) => {
        try {
            const { userChatId } = request.params;
            const userId = request.user._id;
            
            const userData = await getUserChatData(fastify.mongo.db, userId, userChatId, fastify);
            if (!userData) {
                return reply.status(404).send({ error: 'User chat not found' });
            }
            
            const currentGoal = userData.currentGoal || null;
            const completedGoals = userData.completedGoals || [];
            
            // Check completion status if there's a current goal
            let goalStatus = null;
            if (currentGoal) {
                goalStatus = await checkGoalCompletion(currentGoal, userData.messages, getLanguageName(request.user.lang));
            }
            
            return reply.send({
                currentGoal,
                completedGoals,
                goalStatus
            });
        } catch (error) {
            console.error('Error fetching chat goal:', error);
            return reply.status(500).send({ error: 'Failed to fetch chat goal' });
        }
    });

    fastify.post('/api/edit-prompt', async (request, reply) => {
        const { imagePrompt, editPrompt } = request.body;
        try {
            console.log(`✏️ [EditPrompt] Generating edited prompt...`);
            const newPrompt = await generateEditPrompt(imagePrompt, editPrompt);
            if (!newPrompt) {
                return reply.status(500).send({ error: 'Failed to generate edited prompt' });
            }
            return reply.send({ newPrompt });
        } catch (error) {
            return reply.status(500).send({ error: 'Error editing prompt' });
        }
    });

    fastify.post('/api/generate-completion', async (request, reply) => {
        const { systemPrompt, userMessage } = request.body;
        try {
            const completion = await generateCompletion(systemPrompt, userMessage, 'mistral');
            return reply.send({ completion });
        } catch (error) {
            return reply.status(500).send({ error: 'Error generating completion' });
        }
    });      

    fastify.get('/api/chats', async (request, reply) => {
    try {
        // -------------------------------
        // 1. Query parameter extraction & sanitization
        // -------------------------------
        const {
        page: rawPage = '1',
        style,
        model,
        q: rawQ,
        userId,
        skipDeduplication = false, // useful for debugging / seeing all matches
        } = request.query;

        const page = Math.max(1, parseInt(rawPage, 10) || 1);
        const limit = 12;
        const skip = (page - 1) * limit;
        const language = request.lang;

        // Normalize search query
        const searchQuery = rawQ && rawQ !== 'false' ? String(rawQ).trim() : null;

        // Validate userId if provided
        const hasValidUserId = userId && fastify.mongo.ObjectId.isValid(userId);
        const userObjectId = hasValidUserId ? new fastify.mongo.ObjectId(userId) : null;
        console.log(`/API/chats called with page=${page}, style=${style}, model=${model}, q=${searchQuery}, userId=${userId}`);
        // -------------------------------
        // 2. Base filters (always applied)
        // -------------------------------
        const filters = [];
        
        // Only require chatImageUrl when NOT filtering by specific user
        // Require profile images for public browsing to maintain quality, but allow all characters for user-specific views
        if (!hasValidUserId) {
            filters.push({ chatImageUrl: { $exists: true, $ne: '' } }); // must have at least one image
        }
        
        filters.push({
            $or: [
            { characterPrompt: { $exists: true, $ne: '' } },
            { enhancedPrompt: { $exists: true, $ne: '' } },
            ],
        }); // must have some prompt

        // Language filter (only if not filtering by specific user)
        if (language && !hasValidUserId) {
        filters.push({ language });
        }

        // Specific user filter
        if (hasValidUserId) {
        filters.push({ userId: userObjectId });
        }

        // -------------------------------
        // 3. Style filter – more forgiving
        // -------------------------------
        if (style) {
        const normalizedStyle = String(style).trim().toLowerCase();
        // Map common aliases
        const finalStyle =
            normalizedStyle === 'realistic' ? 'photorealistic' : normalizedStyle;

        // Partial match, case-insensitive (not ^...$)
        
        }

        // -------------------------------
        // 4. Model filter – remove .safetensors and allow partial
        // -------------------------------
        if (model) {
        const cleanModel = String(model).replace(/\.safetensors$/i, '').trim();
        filters.push({
            imageModel: { $regex: escapeRegex(cleanModel), $options: 'i' },
        });
        }

        // -------------------------------
        // 5. Free-text search – MUCH BROADER than before
        // -------------------------------
        if (searchQuery) {
        const words = searchQuery
            .toLowerCase()
            .split(/\s+/)
            .map((w) => w.replace(/[^\w]/g, '').trim())
            .filter(Boolean);

        if (words.length > 0) {
        const orConditions = words.flatMap((word) => [
            // Search in prompt fields (full text)
            { characterPrompt: { $regex: word, $options: 'i' } },
            { enhancedPrompt: { $regex: word, $options: 'i' } },
            { negativePrompt: { $regex: word, $options: 'i' } },
            { imageDescription: { $regex: word, $options: 'i' } },

            // Tags – if stored as string
            { tags: { $regex: word, $options: 'i' } },

            // Tags – if stored as array (more common)
            { tags: { $in: [new RegExp(word, 'i')] } },

            // Extra safety: search in raw prompt fields too
            { prompt: { $regex: word, $options: 'i' } },
            { fullPrompt: { $regex: word, $options: 'i' } },
        ]);

            filters.push({ $or: orConditions });
        }
        }

        // -------------------------------
        // 6. Aggregation pipeline
        // -------------------------------
        let pipeline = [
        { $match: { $and: filters } },

        // Join with gallery to count images
        {
            $lookup: {
            from: 'gallery',
            localField: '_id',
            foreignField: 'chatId',
            as: 'gallery',
            },
        },

        // Compute image count from gallery
        {
            $addFields: {
            imageCount: {
                $cond: [
                { $gt: [{ $size: '$gallery' }, 0] },
                {
                    $size: {
                    $ifNull: [{ $arrayElemAt: ['$gallery.images', 0] }, []],
                    },
                },
                0,
                ],
            },
            },
        },
        ];

        // Optional deduplication by model (keeps the one with most images)
        // Skip deduplication when viewing a specific user's characters
        if (!skipDeduplication && !hasValidUserId) {
        pipeline.push(
            { $sort: { imageModel: 1, imageCount: -1, _id: -1 } },
            { $group: { _id: '$imageModel', doc: { $first: '$$ROOT' } } },
            { $replaceRoot: { newRoot: '$doc' } }
        );
        }

        // Final sorting, pagination
        // When viewing a specific user's characters, sort by _id descending (newest first)
        // MongoDB ObjectId contains timestamp in the first 4 bytes, so sorting by _id is equivalent to sorting by creation date
        // Otherwise sort by imageCount
        if (hasValidUserId) {
            pipeline.push(
                { $sort: { _id: -1 } },
                { $skip: skip },
                { $limit: limit }
            );
        } else {
            pipeline.push(
                { $sort: { imageCount: -1, _id: -1 } },
                { $skip: skip },
                { $limit: limit }
            );
        }

        // Execute main query
        const chats = await fastify.mongo.db
        .collection('chats')
        .aggregate(pipeline, { allowDiskUse: true })
        .toArray();

        if (chats.length === 0) {
        return reply.code(404).send({ recent: [], page, totalPages: 0 });
        }

        // -------------------------------
        // 7. Enrich results with user info + safe sample images
        // -------------------------------
        const usersColl = fastify.mongo.db.collection('users');
        const galleryColl = fastify.mongo.db.collection('gallery');

        const recentWithUserAndSamples = await Promise.all(
        chats.map(async (chat) => {
            const chatUserId = chat.userId;

            const userDoc = chatUserId && fastify.mongo.ObjectId.isValid(chatUserId)
            ? await usersColl.findOne({ _id: new fastify.mongo.ObjectId(chatUserId) })
            : null;

            const galleryDoc = await galleryColl.findOne({ chatId: chat._id });

            const sampleImages = galleryDoc?.images
            ? galleryDoc.images
                .filter((img) => !img?.nsfw)
                .slice(0, 5)
            : [];

            return {
            ...chat,
            nickname: userDoc?.nickname || null,
            profileUrl: userDoc?.profileUrl || null,
            sampleImages,
            };
        })
        );

        // -------------------------------
        // 8. Count total pages (respecting deduplication)
        // Skip deduplication count when viewing a specific user's characters
        // -------------------------------
        const countPipeline = [{ $match: { $and: filters } }];

        if (!skipDeduplication && !hasValidUserId) {
        countPipeline.push(
            { $group: { _id: '$imageModel' } },
            { $count: 'total' }
        );
        } else {
        countPipeline.push({ $count: 'total' });
        }

        const totalCountResult = await fastify.mongo.db
        .collection('chats')
        .aggregate(countPipeline, { allowDiskUse: true })
        .toArray();

        const totalCount = totalCountResult[0]?.total || 0;
        const totalPages = Math.ceil(totalCount / limit);

        // -------------------------------
        // 9. Send response
        // -------------------------------
        // Disable caching for user-specific character lists to ensure fresh data
        if (hasValidUserId) {
            reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            reply.header('Pragma', 'no-cache');
            reply.header('Expires', '0');
        }
        
        reply.send({
        recent: recentWithUserAndSamples,
        page,
        totalPages,
        });
    } catch (err) {
        console.error('Error in /api/chats:', err);
        reply.code(500).send({ error: 'Internal Server Error' });
    }
    });

    // Helper: escape regex special chars
    function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Route to get translations
    fastify.post('/api/user/translations', async (request, reply) => {
        try {
            const { lang } = request.body;
            const userLang = lang || 'ja';
            const translations = request.translations;
            return reply.send({ success: true, translations });
        } catch (error) {
            console.log(error);
            return reply.status(500).send({ error: 'An error occurred while fetching translations.' });
        }
    });

    // Route to update user language
    fastify.post('/api/user/update-language', async (request, reply) => {
        try {
            const { lang } = request.body;
            const mode = process.env.MODE || 'local';
            const user = request.user;
            const userLang = lang || 'en';
            
            // Set language cookie for SEO-friendly language switching
            reply.setCookie('lang', userLang, {
                path: '/',
                httpOnly: false, // Allow client-side access for language switching
                sameSite: mode === 'heroku' ? 'None' : 'Lax',
                secure: mode === 'heroku',
                maxAge: 60 * 60 * 24 * 365 // 1 year
            });
            
            if (user.isTemporary) {
                // Update tempUser lang
                user.lang = userLang;
                reply.setCookie('tempUser', JSON.stringify(user), {
                    path: '/',
                    httpOnly: true,
                    sameSite: mode === 'heroku' ? 'None' : 'Lax',
                    secure: mode === 'heroku',
                    maxAge: 3600
                });

            } else {
                await fastify.mongo.db.collection('users').updateOne(
                    { _id: user._id },
                    { $set: { lang: userLang } }
                );           
            }

            return reply.send({ success: true, lang: userLang });
        } catch (error) {
            console.log(error)
            return reply.status(500).send({ error: 'An error occurred while updating the language.' });
        }
    });


    fastify.get('/api/user', async (request, reply) => {
        try {
            let user = request.user;
            const userId = user._id;
            if (userId && !user.isTemporary) {
                const collection = fastify.mongo.db.collection('users');
                user = await collection.findOne({ _id: new fastify.mongo.ObjectId(userId) });
            }
            return reply.send({ user });
        } catch (error) {
            console.error('[GET /api/user] Error:', error);
            return reply.status(500).send({ error: 'Failed to fetch user', details: error.message });
        }
    });

    fastify.get('/api/mode', async (request,reply) => {
        return {mode:process.env.MODE}
    })
      
    // Function to check if a string is a valid ObjectId
    function isNewObjectId(userId) {
        try {
        const objectId = new fastify.mongo.ObjectId(userId);
    
        // Check if the userId is a valid ObjectId
        if (objectId.toString() === userId) {
            return true;
        } else {
            return false;
        }
        } catch (err) {
        // If an error is thrown, it means the userId is not a valid ObjectId
        return false;
        }
    }
    fastify.post('/api/upload-image', async function (request, reply) {
        const db = await fastify.mongo.db;
        const parts = request.parts();
        let imageUrl = null;
        
        for await (const part of parts) {
            if (part.file) {
                imageUrl = await handleFileUpload(part, db);
            }
        }
    
        if (!imageUrl) {
            return reply.status(400).send({ error: 'File upload failed' });
        }
        reply.send({ imageUrl });
    });
    // route to convert an url to base64
    fastify.post('/api/convert-url-to-base64', async (request, reply) => {
        try {
            const { url } = request.body;
            if (!url) {
                return reply.status(400).send({ error: 'URL is required' });
            }
            const base64Image = await convertImageUrlToBase64(url);
            reply.send({ base64Image });
        } catch (error) {
            console.error('Error converting URL to Base64:', error);
            reply.status(500).send({ error: 'Failed to convert URL to Base64' });
        }
    });

    fastify.get('/blur-image', async (request, reply) => {
        const imageUrl = request.query.url;
        try {
            const response = await axios({ url: imageUrl, responseType: 'arraybuffer' });
            const blurredImage = await sharp(response.data).blur(25).toBuffer();
            reply.type('image/jpeg').send(blurredImage);
        } catch {
            reply.status(500).send('Error processing image');
        }
    });

    /**
     * Blur video preview image
     * Takes a videoId, retrieves the associated image, and returns blurred version
     * Used for NSFW video content on character profile pages
     */
    fastify.get('/blur-video-preview', async (request, reply) => {
        const { videoId } = request.query;
        
        if (!videoId) {
            return reply.status(400).send('videoId is required');
        }

        try {
            const db = fastify.mongo.db;
            const videosCollection = db.collection('videos');
            
            // Find the video to get its imageId
            const video = await videosCollection.findOne({ 
                _id: toObjectId(videoId) 
            });
            
            if (!video || !video.imageId) {
                return reply.status(404).send('Video or associated image not found');
            }
            
            // Get the image using getGalleryImageById
            const galleryImage = await getGalleryImageById(db, video.imageId);
            
            if (!galleryImage || !galleryImage.image || !galleryImage.image.imageUrl) {
                return reply.status(404).send('Gallery image not found');
            }
            
            const imageUrl = galleryImage.image.imageUrl;
            
            // Fetch and blur the image
            const response = await axios({ url: imageUrl, responseType: 'arraybuffer' });
            const blurredImage = await sharp(response.data).blur(25).toBuffer();
            
            reply.type('image/jpeg').send(blurredImage);
        } catch (error) {
            console.error('Error blurring video preview:', error);
            reply.status(500).send('Error processing video preview');
        }
    });


        fastify.get('/api/tags', async (request, reply) => {
            try {
            const db = fastify.mongo.db;
            const { tags, page, totalPages } = await fetchTags(db,request);
            reply.send({ tags, page, totalPages });
            } catch (error) {
            console.error('Error fetching tags:', error);
            reply.status(500).send({ error: 'Failed to fetch tags' });
            }
        });

    fastify.get('/api/models', async (req, reply) => {
        const { id, userId } = req.query;
        //if userId is provided, search for the chats of new ObjectId(userId) only 
        try {
            const db = fastify.mongo.db;
            const modelsCollection = db.collection('myModels');
    
            // Build query for models
            let query = id ? { model: id } : {};
            const userIdMatch = userId ? [{ $match: { userId: new ObjectId(userId) } }] : [];
            const langMatch = [{ $match: { language: req.lang } }];

            const models = await modelsCollection.aggregate([
                { $match: query },
                {
                    $lookup: {
                      from: 'chats',
                      let: { model: '$model' },
                      pipeline: [
                        { $match: { $expr: { $eq: ['$imageModel', '$$model'] } } },
                        ...userIdMatch,
                        ...langMatch
                      ],
                      as: 'chats'
                    }
                },
                {
                    $addFields: {
                        chatCount: { $size: '$chats' },
                    }
                },
                {
                    $sort: { chatCount: -1 } // Sort by chatCount in descending order
                },
                {
                    $project: {
                        chats: 0 // Exclude chat details if not needed
                    }
                }
            ]).toArray();

            return reply.send({ success: true, models });
        } catch (error) {
            console.error(error);
            return reply.code(500).send({ success: false, message: 'Error fetching models', error });
        }
    });
    fastify.post('/api/models/averageTime', async (req, reply) => {
        const { id, time } = req.body;
        if (!id || !time) return reply.code(400).send({ success: false, message: 'Missing parameters' });
        try {
          const db = fastify.mongo.db;
          const models = db.collection('myModels');
          const result = await models.findOneAndUpdate(
            { model: id },
            [{
              $set: {
                imageGenerationTimeCount: { $add: [{ $ifNull: ['$imageGenerationTimeCount', 0] }, 1] },
                imageGenerationTimeAvg: {
                  $divide: [
                    {
                      $add: [
                        { $multiply: [{ $ifNull: ['$imageGenerationTimeAvg', 0] }, { $ifNull: ['$imageGenerationTimeCount', 0] }] },
                        time
                      ]
                    },
                    { $add: [{ $ifNull: ['$imageGenerationTimeCount', 0] }, 1] }
                  ]
                }
              }
            }],
            { returnDocument: 'after' }
          );
          return reply.send({ success: true, model: result.value });
        } catch (error) {
          return reply.code(500).send({ success: false, message: 'Error updating average time', error });
        }
      });
    // --- New: Popular Chats Route ---
    fastify.post('/api/popular-chats/reset-cache', async (request, reply) => {
        try {
            const db = fastify.mongo.db;
            await db.collection('popularChatsCache').deleteMany({});
            reply.send({ success: true });
        } catch (err) {
            reply.code(500).send('Failed to reset cache');
        }
    });
    fastify.get('/api/popular-chats', async (request, reply) => {
        try {
            const reloadCache = request.query.reloadCache === 'true'; // Check if cache reload is requested
            const page = Math.max(1, parseInt(request.query.page, 10) || 1); // Default to page 1
            const limit = 50; // Keep this consistent with caching logic
            const skip = (page - 1) * limit;
            const language = request.lang; // Get language from request

            const pagesToCache = 100; // Must match the value in cronManager.js
            const cacheLimit = pagesToCache * limit;

            const db = fastify.mongo.db;
            const cacheCollection = db.collection('popularChatsCache');
            const chatsCollection = db.collection('chats'); // Keep for fallback

            let chats = [];
            let totalCount = 0;
            let totalPages = 0;
            let usingCache = false;

            // Check if the requested page is within the cached range
            if (page <= pagesToCache && !reloadCache) {
                // Try fetching from cache first, filtering by language
                const cacheQuery = { language: language }; // Filter cache by language
                totalCount = await cacheCollection.countDocuments(cacheQuery);

                if (totalCount > 0) {
                    chats = await cacheCollection.find(cacheQuery)
                        .sort({ cacheRank: 1 }) // Sort by the rank assigned during caching
                        .skip(skip)
                        .limit(limit)
                        .toArray();

                    if (chats.length > 0) {
                        totalPages = Math.ceil(totalCount / limit);
                        usingCache = true;
                    } 
                } 
            } 


            // Fallback to direct DB query if not using cache or cache fetch failed
            if (!usingCache) {
                const pipeline = [
                    // Match language and basic requirements
                    { $match: { chatImageUrl: { $exists: true, $ne: '' }, name: { $exists: true, $ne: '' }, language, imageStyle: { $exists: true, $ne: '' } } },
                    {
                        $lookup: {
                            from: 'gallery',
                            localField: '_id',
                            foreignField: 'chatId',
                            as: 'gallery'
                        }
                    },
                    { $sort: { imageCount: -1, _id: -1 } },
                    { $skip: skip },
                    { $limit: limit },
                    // Add user lookup directly in aggregation
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'userId',
                            foreignField: '_id',
                            as: 'userInfo'
                        }
                    },
                    {
                        $addFields: {
                            userInfo: { $arrayElemAt: ['$userInfo', 0] }
                        }
                    },
                    {
                        $addFields: {
                            nickname: '$userInfo.nickname',
                            profileUrl: '$userInfo.profileUrl'
                        }
                    },
                    // Add a field sampleImages to get the first 5 non-NSFW images from the gallery
                    {
                        $addFields: {
                            sampleImages: {
                                $slice: [
                                    {
                                        $filter: {
                                            input: {
                                                $ifNull: [
                                                    { $arrayElemAt: ['$gallery.images', 0] },
                                                    []
                                                ]
                                            },
                                            as: 'image',
                                            cond: { $and: [
                                                { $ne: ['$$image', null] },
                                                { $ne: ['$$image.nsfw', true] },
                                                { $ne: ['$$image.nsfw', 'true'] },
                                                { $ne: ['$$image.nsfw', 'on'] }
                                            ]}
                                        }
                                    },
                                    5
                                ]
                            }
                        }
                    },
                    {
                        $project: { // Project necessary fields
                            _id: 1, name: 1, nsfw: 1, moderation: 1, chatImageUrl: 1, sampleImages: 1, first_message: 1, tags: 1, imageStyle: 1, gender: 1, userId: 1, nickname: 1, profileUrl: 1, language: 1,
                        }
                    }
                ];

                chats = await chatsCollection.aggregate(pipeline).toArray();
                // Count total for pagination (only if fallback is used)
                totalCount = await chatsCollection.countDocuments({ chatImageUrl: { $exists: true, $ne: '' }, name: { $exists: true, $ne: '' }, language });
                totalPages = Math.ceil(totalCount / limit);
            }

            reply.send({ chats, page, totalPages, usingCache }); // Add usingCache flag for debugging/info
        } catch (err) {
            console.error('[API /popular-chats] Error:', err); // Log the error
            reply.code(500).send('Internal Server Error');
        }
    });

    fastify.get('/api/similar-chats/:chatId', async (request, reply) => {
        try {
            const db = fastify.mongo.db;
            const chatsCollection = db.collection('chats');
            const similarChatsCache = db.collection('similarChatsCache');
            const similarityMatrixCollection = db.collection('similarityMatrix');
            const chatIdParam = request.params.chatId;
            const language = request.lang || 'en'; // Get language from request
            
            // Pagination parameters with validation
            const requestedPage = parseInt(request.query.page);
            const requestedLimit = parseInt(request.query.limit);
            const page = Math.max(1, Math.min(isNaN(requestedPage) ? 1 : requestedPage, 100)); // Limit to 1-100
            const limit = Math.max(1, Math.min(isNaN(requestedLimit) ? 10 : requestedLimit, 50)); // Limit to 1-50
            const skip = (page - 1) * limit;
            
            let chatIdObjectId;

            try {
            chatIdObjectId = new fastify.mongo.ObjectId(chatIdParam);
            } catch (e) {
            console.error(`[API/SimilarChats] Invalid Chat ID format: ${chatIdParam}`);
            return reply.code(400).send({ error: 'Invalid Chat ID format' });
            }

            // Check result cache first (24-hour expiry) - include language in cache key
            const cacheKey = `${chatIdParam}_${language}`;
            const cacheExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
                        
            const cachedResult = await similarChatsCache.findOne({
                chatId: cacheKey,
                createdAt: { $gte: cacheExpiry }
            });

            if (cachedResult && cachedResult.similarChats && cachedResult.similarChats.length > 0) {
                console.log(`[API/SimilarChats] Using cached results for ${chatIdParam} (language: ${language}), page: ${page}`);
                // Filter cached results by language to ensure consistency
                const filteredResults = cachedResult.similarChats.filter(chat => chat.language === language);
                if (filteredResults.length > 0) {
                    // Apply pagination to cached results
                    const paginatedResults = filteredResults.slice(skip, skip + limit);
                    const totalResults = filteredResults.length;
                    const totalPages = Math.ceil(totalResults / limit);
                    
                    return reply.send({
                        similarChats: paginatedResults,
                        pagination: {
                            currentPage: page,
                            totalPages: totalPages,
                            totalResults: totalResults,
                            limit: limit,
                            hasMore: page < totalPages
                        }
                    });
                }
            }

                
            const chat = await chatsCollection.findOne({ _id: chatIdObjectId });

            if (!chat) {
            console.warn(`[API/SimilarChats] Chat not found for ID: ${chatIdParam}`);
            return reply.code(404).send({ error: 'Chat not found' });
            }

            let similarChats = [];
            const characterPrompt = chat.enhancedPrompt || chat.characterPrompt;

            if (characterPrompt) {
            const mainPromptTokens = tokenizePrompt(characterPrompt);
            
            // Check similarity matrix for cached comparisons (7-day expiry) - include language
            const matrixExpiry = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const existingMatrix = await similarityMatrixCollection.findOne({
                sourceChatId: chatIdObjectId,
                language: language,
                updatedAt: { $gte: matrixExpiry }
            });

            let scoredChats = [];
            let fromMatrix = false;

            if (existingMatrix && existingMatrix.similarities && existingMatrix.similarities.length > 0) {
                // Use cached similarity matrix entries
                console.log(`[API/SimilarChats] Using similarity matrix for ${chatIdParam} with ${existingMatrix.similarities.length} entries`);
                
                // Get chat details for matrix entries and filter by minimum score
                const minScore = 0.08;
                const matrixEntries = existingMatrix.similarities.filter(s => s.score >= minScore);
                
                if (matrixEntries.length > 0) {
                    const matrixChatIds = matrixEntries
                        .map(s => s.targetChatId)
                        .filter(id => id.toString() !== chatIdParam); // Exclude current character
                    const matrixChats = await chatsCollection.find(
                        { 
                            _id: { $in: matrixChatIds },
                            language: language // Filter by language
                        },
                        {
                            projection: {
                                _id: 1, slug: 1, name: 1, modelId: 1, chatImageUrl: 1,
                                nsfw: 1, userId: 1, gender: 1, imageStyle: 1, language: 1
                            }
                        }
                    ).toArray();

                    scoredChats = matrixEntries.map(entry => {
                        const chatDoc = matrixChats.find(c => c._id.toString() === entry.targetChatId.toString());
                        return {
                            ...entry,
                            chatDoc
                        };
                    }).filter(s => s.chatDoc && s.chatDoc.language === language);

                    fromMatrix = true;
                }
            }

            // If not enough results from matrix, perform fresh search
            if (scoredChats.length < 3) {
                console.log(`[API/SimilarChats] Insufficient matrix results (${scoredChats.length}), performing fresh search for ${chatIdParam}`);
                
                const galleryCollection = db.collection('gallery');
                
                // Find gallery documents with at least 4 images and valid image prompts
                // First, get chat IDs that match the language
                const languageChatIds = await chatsCollection.find(
                    { 
                        language: language,
                        _id: { $ne: chatIdObjectId },
                        chatImageUrl: { $exists: true, $ne: '' }
                    },
                    { projection: { _id: 1 } }
                ).toArray();
                
                const languageChatIdsArray = languageChatIds.map(c => c._id);
                
                // Find gallery documents with at least 4 images and valid image prompts, filtered by language
                const galleryDocs = await galleryCollection.aggregate([
                    {
                        $match: {
                            'images.0': { $exists: true },
                            'chatId': { 
                                $ne: chatIdObjectId,
                                $in: languageChatIdsArray // Filter by language
                            }
                        }
                    },
                    {
                        $addFields: {
                            imageCount: { $size: '$images' }
                        }
                    },
                    {
                        $match: {
                            imageCount: { $gte: 4 }
                        }
                    },
                    {
                        $project: {
                            chatId: 1,
                            imageCount: 1,
                            images: {
                                $filter: {
                                    input: '$images',
                                    as: 'image',
                                    cond: { 
                                        $and: [
                                            { $ne: ['$$image.prompt', null] },
                                            { $ne: ['$$image.prompt', ''] }
                                        ]
                                    }
                                }
                            }
                        }
                    },
                    {
                        $match: {
                            'images.0': { $exists: true }
                        }
                    }
                ]).toArray();

                // Score each gallery based on image prompt similarity
                const freshScoredChats = [];
                
                for (const galleryDoc of galleryDocs) {
                    let totalScore = 0;
                    let validImages = 0;

                    for (const image of galleryDoc.images) {
                        if (image.prompt) {
                            const imagePromptTokens = tokenizePrompt(image.prompt);
                            const intersection = new Set([...mainPromptTokens].filter(x => imagePromptTokens.has(x)));
                            const union = new Set([...mainPromptTokens, ...imagePromptTokens]);
                            const jaccardScore = union.size > 0 ? intersection.size / union.size : 0;
                            
                            if (jaccardScore > 0.05) {
                                totalScore += jaccardScore;
                                validImages++;
                            }
                        }
                    }

                    const avgScore = validImages > 0 ? totalScore / validImages : 0;
                    
                    if (avgScore > 0.08) {
                        freshScoredChats.push({
                            targetChatId: galleryDoc.chatId,
                            imageCount: galleryDoc.imageCount,
                            score: avgScore,
                            matchedImagesCount: validImages
                        });
                    }
                }

                // Sort by composite score: 60% similarity, 40% image count
                freshScoredChats.sort((a, b) => {
                    const maxImages = Math.max(...freshScoredChats.map(c => c.imageCount), 1);
                    const scoreA = (a.score * 0.6) + ((a.imageCount / maxImages) * 0.4);
                    const scoreB = (b.score * 0.6) + ((b.imageCount / maxImages) * 0.4);
                    return scoreB - scoreA;
                });

                // Store in similarity matrix for future use (include language in key)
                if (freshScoredChats.length > 0) {
                    await similarityMatrixCollection.updateOne(
                        { sourceChatId: chatIdObjectId, language: language },
                        {
                            $set: {
                                sourceChatId: chatIdObjectId,
                                language: language,
                                similarities: freshScoredChats.slice(0, 50), // Store top 50 for pagination support
                                updatedAt: new Date(),
                                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
                            }
                        },
                        { upsert: true }
                    );
                }

                // Get top results for pagination (up to 50)
                const diverseChatIds = [];
                if (freshScoredChats.length > 0) {
                    // Take top scored chats, up to 50 for pagination support
                    const topScored = freshScoredChats.slice(0, 50);
                    const uniqueChatIds = [...new Set(topScored.map(c => c.targetChatId.toString()))];
                    diverseChatIds.push(...uniqueChatIds.map(id => new fastify.mongo.ObjectId(id)));
                }
                
                if (diverseChatIds.length > 0) {
                    const topChats = await chatsCollection.find(
                        { 
                            _id: { $in: diverseChatIds },
                            language: language // Ensure language filter
                        },
                        {
                            projection: {
                                _id: 1, slug: 1, name: 1, modelId: 1, chatImageUrl: 1,
                                nsfw: 1, userId: 1, gender: 1, imageStyle: 1, language: 1
                            }
                        }
                    ).toArray();

                    // Preserve order from diverseChatIds
                    similarChats = diverseChatIds.map(chatId => 
                        topChats.find(c => c._id.toString() === chatId.toString())
                    ).filter(Boolean);
                }
            } else {
                // Use matrix results (up to 50 for pagination support)
                similarChats = scoredChats.slice(0, 50).map(s => s.chatDoc).filter(c => c && c.language === language);
            }

            } else {
                console.log(`[API/SimilarChats] No prompt found for current character ${chatIdParam}. Skipping similar chat search.`);
            }

            // Filter final results to ensure language consistency and exclude current character
            similarChats = similarChats.filter(chat => 
                chat && 
                chat.language === language && 
                chat._id.toString() !== chatIdParam
            );

            // Cache the final result (upsert to handle updates) - include language in cache key
            const cacheDocument = {
            chatId: cacheKey,
            language: language,
            similarChats: similarChats,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
            };

            await similarChatsCache.updateOne(
            { chatId: cacheKey },
            { $set: cacheDocument },
            { upsert: true }
            );

            // Apply pagination to final results
            const totalResults = similarChats.length;
            const totalPages = Math.ceil(totalResults / limit);
            const paginatedResults = similarChats.slice(skip, skip + limit);
             
            reply.send({
                similarChats: paginatedResults,
                pagination: {
                    currentPage: page,
                    totalPages: totalPages,
                    totalResults: totalResults,
                    limit: limit,
                    hasMore: page < totalPages
                }
            });

        } catch (err) {
            console.error(`[API/SimilarChats] Error in /api/similar-chats/:chatId route for ${request.params.chatId}:`, err);
            reply.code(500).send({ error: 'Internal Server Error' });
        }
        });

    fastify.get('/api/latest-video-chats', async (request, reply) => {
        const db = fastify.mongo.db;
        const page = parseInt(request.query.page) || 1;
        const limit = parseInt(request.query.limit) || 10;
        const skip = (page - 1) * limit;

        try {
            console.log(`[latest-video-chats] page=${page} limit=${limit} skip=${skip}`);
            
            const videosCollection = db.collection('videos');
            const chatsCollection = db.collection('chats');

            // First, get the latest videos with their chat info
            const latestVideos = await videosCollection.aggregate([
                {
                    $lookup: {
                        from: 'chats',
                        localField: 'chatId',
                        foreignField: '_id',
                        as: 'chat'
                    }
                },
                {
                    $unwind: '$chat'
                },
                {
                    $match: {
                        'chat.language': request.lang,
                        'chat.name': { $exists: true, $ne: '' },
                        'chat.chatImageUrl': { $exists: true, $ne: '' }
                    }
                },
                {
                    $sort: { createdAt: -1 }
                },
                {
                    $group: {
                        _id: '$chatId',
                        latestVideo: { $first: '$$ROOT' }
                    }
                },
                {
                    $sort: { 'latestVideo.createdAt': -1 }
                },
                {
                    $skip: skip
                },
                {
                    $limit: limit
                },
                {
                    $project: {
                        _id: '$latestVideo._id',
                        videoUrl: '$latestVideo.videoUrl',
                        duration: '$latestVideo.duration',
                        prompt: '$latestVideo.prompt',
                        createdAt: '$latestVideo.createdAt',
                        chatId: '$latestVideo.chatId',
                        userId: '$latestVideo.userId',
                        nsfw: '$latestVideo.nsfw',
                        chat: {
                            _id: '$latestVideo.chat._id',
                            name: '$latestVideo.chat.name',
                            chatImageUrl: '$latestVideo.chat.chatImageUrl',
                            thumbnailUrl: '$latestVideo.chat.thumbnailUrl',
                            gender: '$latestVideo.chat.gender',
                            imageStyle: '$latestVideo.chat.imageStyle',
                            nsfw: '$latestVideo.chat.nsfw'
                        }
                    }
                }
            ]).toArray();
            // Function to check if video fetch was successful   
            async function checkIfVideoFetchWasSuccessful(videoUrl) {
                try {
                    const response = await axios.head(videoUrl);
                    return response.status === 200; // Check if the video URL is accessible
                } catch (error) {
                    return false; // Return false if there's an error fetching the video URL
                }
            }
            // Get user info for each video
            const usersCollection = db.collection('users');
            let formattedVideoChats = await Promise.all(
                latestVideos.map(async (video) => {
                    const videoFetch = await checkIfVideoFetchWasSuccessful(video.videoUrl);
                    if (!videoFetch) {
                        return null;
                    }
                    const user = await usersCollection.findOne(
                        { _id: video.userId },
                        { projection: { nickname: 1, profileUrl: 1 } }
                    );

                    return {
                        _id: video._id,
                        videoUrl: video.videoUrl,
                        duration: video.duration,
                        prompt: video.prompt,
                        createdAt: video.createdAt,
                        chatId: video.chatId,
                        nsfw: video.nsfw || false,
                        chat: {
                            _id: video.chat._id,
                            name: video.chat.name,
                            chatImageUrl: video.chat.chatImageUrl || video.chat.thumbnailUrl,
                            gender: video.chat.gender,
                            imageStyle: video.chat.imageStyle,
                            nsfw: video.chat.nsfw || false
                        },
                        user: {
                            nickname: user?.nickname,
                            profileUrl: user?.profileUrl
                        }
                    };
                })
            );
            // Filter out any null values (failed video fetches)
            formattedVideoChats = formattedVideoChats.filter(video => video !== null);

            // Count total unique chats with videos for pagination
            const totalChatsWithVideos = await videosCollection.aggregate([
                {
                    $lookup: {
                        from: 'chats',
                        localField: 'chatId',
                        foreignField: '_id',
                        as: 'chat'
                    }
                },
                {
                    $unwind: '$chat'
                },
                {
                    $match: {
                        'chat.language': request.lang,
                        'chat.name': { $exists: true, $ne: '' },
                        'chat.chatImageUrl': { $exists: true, $ne: '' }
                    }
                },
                {
                    $group: {
                        _id: '$chatId'
                    }
                },
                {
                    $count: 'total'
                }
            ]).toArray();

            const totalCount = totalChatsWithVideos[0]?.total || 0;
            const totalPages = Math.ceil(totalCount / limit);

            reply.send({
                videoChats: formattedVideoChats,
                currentPage: page,
                totalPages: totalPages,
                totalCount: totalCount
            });

        } catch (error) {
            console.log({ msg: 'Error fetching latest video chats', error: error.message, stack: error.stack });
            reply.status(500).send({ message: 'Error fetching latest video chats' });
        }
    });

    fastify.get('/api/latest-chats', async (request, reply) => {
        const db = fastify.mongo.db;
        const page = parseInt(request.query.page) || 1;
        const limit = parseInt(request.query.limit) || 18;
        const skip = (page - 1) * limit;
        const nsfwLimit = Math.floor(limit / 2);
        const sfwLimit = limit - nsfwLimit;

        try {
        
        console.log(`[latest-chats] page=${page} limit=${limit} skip=${skip}`);
        const chatsCollection = db.collection('chats');
        const baseQuery = {
            chatImageUrl: { $exists: true, $ne: '' },
            name: { $exists: true, $ne: '' },
            language: request.lang,
        };

        // Query for NSFW chats - handle boolean, string 'true', and string 'on' values
        const nsfwQuery = { 
            ...baseQuery, 
            $or: [
                { nsfw: true },
                { nsfw: 'true' },
                { nsfw: 'on' }
            ] 
        };
        const nsfwChats = await chatsCollection.find(nsfwQuery)
            .sort({ _id: -1 })
            .skip(skip)
            .limit(nsfwLimit)
            .project({
            modelId: 1,
            name: 1,
            first_message: 1,
            chatImageUrl: 1,
            thumbnailUrl: 1,
            nsfw: 1,
            gender: 1,
            tags: 1,
            imageStyle: 1,
            userId: 1,
            createdAt: 1
            })
            .toArray();

        // Query for SFW chats
        // Query for SFW chats - handle both boolean and string values
        const sfwQuery = { 
            ...baseQuery, 
            $or: [
                { nsfw: false },
                { nsfw: 'false' },
                { nsfw: { $exists: false } } // Include chats without the nsfw field
            ] 
        };
        const sfwChats = await chatsCollection.find(sfwQuery)
            .sort({ _id: -1 })
            .skip(skip)
            .limit(sfwLimit)
            .project({
            modelId: 1,
            name: 1,
            first_message: 1,
            chatImageUrl: 1,
            thumbnailUrl: 1,
            nsfw: 1,
            gender: 1,
            tags: 1,
            imageStyle: 1,
            userId: 1,
            createdAt: 1
            })
            .toArray();
            
        // Combine and sort by _id descending (latest first)
        const combinedChats = [...sfwChats, ...nsfwChats].sort((a, b) => b._id - a._id);

        const formattedChats = combinedChats.map(chat => ({
            _id: chat._id,
            name: chat.name || 'Unnamed Chat',
            chatImageUrl: chat.chatImageUrl || chat.thumbnailUrl || '/img/default_chat_avatar.png',
            thumbnailUrl: chat.thumbnailUrl,
            nsfw: chat.nsfw || false,
            gender: chat.gender,
            imageStyle: chat.imageStyle,
            userId: chat.userId,
            first_message: chat.first_message,
            tags: chat.tags || [],
        }));

        // For pagination info, count total chats matching baseQuery
        const totalChats = await chatsCollection.countDocuments(baseQuery);
        const totalPages = Math.ceil(totalChats / limit);

        reply.send({
            chats: formattedChats,
            currentPage: page,
            totalPages: totalPages,
            totalChats: totalChats
        });

        } catch (error) {
        console.log({ msg: 'Error fetching latest chats', error: error.message, stack: error.stack });
        reply.status(500).send({ message: 'Error fetching latest chats' });
        }
    });

    fastify.get('/api/custom-prompts/:userId', async (request, reply) => {
        try {
            const { userId } = request.params;

            if (!fastify.mongo.ObjectId.isValid(userId)) {
                return reply.status(400).send({ error: 'Invalid user ID format' });
            }

            // Use the imported getUserPoints utility function
            const userPoints = await getUserPoints(fastify.mongo.db, userId);

            // Get all custom prompts from the database
            const customPrompts = await fastify.mongo.db.collection('prompts')
                .find({})
                .sort({ order: 1 })
                .toArray();

            // Determine which prompts the user can afford
            const promptsWithAccess = customPrompts.map(prompt => {
                const cost = prompt.cost || 0; // Default cost to 0 if not set
                const canAfford = userPoints >= cost;

                return {
                    promptId: prompt._id.toString(),
                    cost: cost,
                    canAfford: canAfford
                };
            });

            return reply.send({
                userPoints: userPoints,
                prompts: promptsWithAccess
            });

        } catch (error) {
            console.error('Error fetching custom prompts:', error);
            return reply.status(500).send({ error: 'Internal server error while fetching custom prompts' });
        }
    });

    fastify.post('/api/log-conversation/:chatId/:userChatId', async (request, reply) => {
        try {
            const { chatId, userChatId } = request.params;
            const user = request.user;
            const userId = user._id;

            // Check if user is admin
            const isAdmin = await checkUserAdmin(fastify, new fastify.mongo.ObjectId(userId));
            if (!isAdmin) {
                return reply.status(403).send({ error: 'Unauthorized: Admin access required' });
            }

            if (!fastify.mongo.ObjectId.isValid(chatId)) {
                return reply.status(400).send({ error: 'Invalid chat ID format' });
            }

            const db = fastify.mongo.db;
            const chatsCollection = db.collection('chats');
            const userChatCollection = db.collection('userChat');

            // Fetch chat document
            const chat = await chatsCollection.findOne({ 
                _id: new fastify.mongo.ObjectId(chatId) 
            });

            if (!chat) {
                return reply.status(404).send({ error: 'Chat not found' });
            }

            // Fetch all user chats for this chat
            const userChats = await userChatCollection.find({
                _id: new fastify.mongo.ObjectId(userChatId)
            }).toArray();

            // Log to server console
            console.log('\n=================================');
            console.log('FULL CONVERSATION LOG');
            console.log('=================================');
            console.log('Chat ID:', chatId);
            console.log('Chat Name:', chat.name);
            console.log('Created At:', chat.createdAt);
            console.log('User ID:', chat.userId);
            console.log('Language:', chat.language);
            console.log('=================================');
            console.log('CHAT DETAILS:');
            console.log(JSON.stringify({
                name: chat.name,
                system_prompt: chat.system_prompt,
                details_description: chat.details_description,
                tags: chat.tags,
                gender: chat.gender,
                nsfw: chat.nsfw
            }, null, 2));
            console.log('=================================');
            console.log(`TOTAL USER CHATS: ${userChats.length}`);
            console.log('=================================\n');

            userChats.forEach((userChat, index) => {
                console.log(`\n--- User Chat #${index + 1} ---`);
                console.log('User Chat ID:', userChat._id);
                console.log('User ID:', userChat.userId);
                console.log('Created At:', userChat.createdAt);
                console.log('Updated At:', userChat.updatedAt);
                console.log(`Messages (${userChat.messages?.length || 0}):`);
                
                if (userChat.messages && userChat.messages.length > 0) {
                    userChat.messages.forEach((msg, msgIndex) => {
                        console.log(`\n  Message #${msgIndex + 1}:`);
                        console.log(`  Role: ${msg.role}`);
                        console.log(`  Name: ${msg.name || 'N/A'}`);
                        console.log(`  Content: ${msg.content}`);
                        console.log(`  Timestamp: ${msg.timestamp || msg.createdAt || 'N/A'}`);
                        console.log(`  Hidden: ${msg.hidden || false}`);
                        console.log(`  Image Request: ${msg.image_request || false}`);
                    });
                } else {
                    console.log('  No messages in this chat');
                }
                console.log('\n' + '-'.repeat(50));
            });

            console.log('\n=================================');
            console.log('END OF CONVERSATION LOG');
            console.log('=================================\n');

            return reply.send({
                success: true,
                message: 'Conversation logged to server console',
                chatId: chatId,
                totalUserChats: userChats.length,
                totalMessages: userChats.reduce((sum, uc) => sum + (uc.messages?.length || 0), 0)
            });

        } catch (error) {
            console.error('Error logging conversation:', error);
            return reply.status(500).send({ 
                error: 'Failed to log conversation',
                details: error.message 
            });
        }
    });
}

module.exports = routes;