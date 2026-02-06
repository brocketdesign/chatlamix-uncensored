const { ObjectId } = require('mongodb');
const { getLanguageName } = require('../models/tool');
const { removeUserPoints, awardLikeMilestoneReward, awardLikeActionReward } = require('../models/user-points-utils');
const { hasUserChattedWithCharacter } = require('../models/chat-tool-settings-utils');
const { buildQueryTagsIndex } = require('../models/query-tags-utils');
const {
  getGalleryImageById,
  buildChatImageMessage,
  appendMessageToUserChat,
  getUserChatForUser,
  toObjectId
} = require('../models/gallery-utils');
const { generatePromptTitle } = require('../models/openai');


async function routes(fastify, options) {
  fastify.post('/gallery/:imageId/like-toggle', async (request, reply) => { 
    try {
      const imageId = new fastify.mongo.ObjectId(request.params.imageId);
      const { action, userChatId } = request.body; // 'like' or 'unlike'
      const user = request.user;
      const userId = new fastify.mongo.ObjectId(user._id);

      const db = fastify.mongo.db;
      const galleryCollection = db.collection('gallery');
      const imagesLikesCollection = db.collection('images_likes');
      const usersCollection = db.collection('users'); // Collection to update user's imageLikeCount
      const collectionUserChat = db.collection('userChat');

      const addUserToImageIfMissing = async () => {
        const updateOps = {
          $addToSet: { 'images.$.likedBy': userId },
          $inc: { 'images.$.likes': 1 }
        };

        let result = await galleryCollection.updateOne(
          { 'images._id': imageId, 'images.likedBy': { $ne: userId } },
          updateOps
        );

        if (result.matchedCount === 0) {
          await galleryCollection.updateOne(
            { 'images.mergeId': imageId.toString(), 'images.likedBy': { $ne: userId } },
            updateOps
          );
        }
      };

      const removeUserFromGalleryImage = async ({ decrementLikes = false } = {}) => {
        const updateOps = {
          $pull: { 'images.$.likedBy': userId }
        };

        if (decrementLikes) {
          updateOps.$inc = { 'images.$.likes': -1 };
        }

        let result = await galleryCollection.updateOne(
          { 'images._id': imageId },
          updateOps
        );

        if (result.matchedCount === 0) {
          result = await galleryCollection.updateOne(
            { 'images.mergeId': imageId.toString() },
            updateOps
          );
        }

        return result;
      };

      // Declare a function that will find the object with content that starts with [Image] or [image] followed by a space and then the imageId and update it with the like action field
      const findImageMessageandUpdateLikeAction = async (userChatId, userChatMessages, imageId, action) => {
        if (!userChatMessages || !userChatMessages.messages) {
          return;
        }
        
        const messageIndex = userChatMessages.messages.findIndex(msg => {
          const content = msg.content || '';
          const isMatch = (msg.type == "image" && msg.imageId == imageId) || 
                         content.startsWith('[Image] ' + imageId.toString()) || 
                         content.startsWith('[image] ' + imageId.toString());
          return isMatch;
        });
        
        if (messageIndex !== -1) {
          const message = userChatMessages.messages[messageIndex];
          
          // Initialize actions array if it doesn't exist
          if (!message.actions) {
            message.actions = [];
          }
          
          if (action === 'like') {
            // Check if like action already exists
            const existingLikeAction = message.actions.find(action => action.type === 'like');
            
            if (!existingLikeAction) {
              // Add like action to the actions array
              message.actions.push({
                type: 'like',
                date: new Date()
              });
            }
          } else if (action === 'unlike') {
            // Remove like action from actions array
            message.actions = message.actions.filter(action => action.type !== 'like');
          }
          
          // Update the userChatMessages in the database
          await collectionUserChat.updateOne(
            { _id: new fastify.mongo.ObjectId(userChatId) },
            { $set: { messages: userChatMessages.messages } }
          );
        }
      }

      if (action === 'like') {
        // Check if the user already liked the image
        const existingLike = await imagesLikesCollection.findOne({ imageId, userId });

        if (existingLike) {
          await addUserToImageIfMissing();
          return reply.send({ message: 'Image already liked', alreadyLiked: true });
        }

        // Try to find and update by _id first (regular images)
        let result = await galleryCollection.updateOne(
          { 'images._id': imageId },
          {
            $inc: { 'images.$.likes': 1 },
            $addToSet: { 'images.$.likedBy': userId }
          }
        );

        // If no match by _id, try by mergeId (for merged images)
        if (result.matchedCount === 0) {
          result = await galleryCollection.updateOne(
            { 'images.mergeId': imageId.toString() },
            {
              $inc: { 'images.$.likes': 1 },
              $addToSet: { 'images.$.likedBy': userId }
            }
          );
        }

        if (result.matchedCount === 0) {
          return reply.code(404).send({ error: 'Image not found' });
        }

        // Add like to the images_likes collection
        const likeDoc = {
          imageId,
          userId,
          likedAt: new Date(),
        };
        await imagesLikesCollection.insertOne(likeDoc);

        // Increment user's imageLikeCount
        await usersCollection.updateOne(
          { _id: userId },
          { $inc: { imageLikeCount: 1 } }
        );

        // Award points for like action and check for milestones
        try {
          await Promise.all([
            awardLikeActionReward(db, userId, fastify),
            awardLikeMilestoneReward(db, userId, fastify)
          ]);
        } catch (rewardError) {
          console.error('Error awarding like rewards:', rewardError);
          // Don't fail the like action if reward fails
        }

        if(userChatId && userChatId.trim() != ''){
          const userChatMessages = await collectionUserChat.findOne({ _id: new fastify.mongo.ObjectId(userChatId) });
          await findImageMessageandUpdateLikeAction(userChatId, userChatMessages, imageId, 'like');
        }

        return reply.send({ message: 'Image liked successfully' });

      } else if (action === 'unlike') {
        // Check if the user has already liked the image
        const existingLike = await imagesLikesCollection.findOne({ imageId, userId });

        if (!existingLike) {
          await removeUserFromGalleryImage();
          return reply.send({ message: 'Image already unliked', alreadyUnliked: true });
        }

        // Try to find image by _id first (regular images)
        let image = await galleryCollection.findOne({ 'images._id': imageId });
        
        // If not found by _id, try by mergeId (for merged images)
        if (!image) {
          image = await galleryCollection.findOne({ 'images.mergeId': imageId.toString() });
        }
        
        const likes = image ? image.images.find(img => 
          img._id.equals(imageId) || img.mergeId === imageId.toString()
        )?.likes : 0;

        const shouldDecrementLikes = likes > 0;

        const result = await removeUserFromGalleryImage({ decrementLikes: shouldDecrementLikes });

        if (result.matchedCount === 0) {
          return reply.code(404).send({ error: 'Image not found' });
        }

        // Remove like from the images_likes collection
        await imagesLikesCollection.deleteOne({ imageId, userId });

        // Decrement user's imageLikeCount, ensuring it doesn't go below 0
        const userDoc = await usersCollection.findOne({ _id: userId });
        
        if (userDoc.imageLikeCount > 0) {
          await usersCollection.updateOne(
            { _id: userId },
            { $inc: { imageLikeCount: -1 } }
          );
        }

        const cost = 1; // Cost for unliking an image (removing 1 point)
        console.log(`[gallery-like-toggle] Deducting ${cost} point for unliking image: ${imageId}`);
        try {
          await removeUserPoints(db, userId, cost, request.userPointsTranslations.points?.deduction_reasons?.unlike_image || 'Unlike image', 'unlike_image', fastify);
        } catch (error) {
          console.error('[gallery-like-toggle] Failed to deduct point for unlike:', error);
          // Optionally handle if you want to revert the unlike action or notify the user
        }

        if(userChatId && userChatId.trim() != ''){
          const userChatMessages = await collectionUserChat.findOne({ _id: new fastify.mongo.ObjectId(userChatId) });
          await findImageMessageandUpdateLikeAction(userChatId, userChatMessages, imageId, 'unlike');
        }

        return reply.send({ message: 'Image unliked successfully' });
      } else {
        return reply.code(400).send({ error: 'Invalid action' });
      }
    } catch (err) {
      console.error('Error in like-toggle endpoint:', err);
      reply.code(500).send('Internal Server Error');
    }
  });

  fastify.post('/gallery/:imageId/add-to-chat', async (request, reply) => {
    try {
      const { imageId } = request.params;
      const { chatId, userChatId } = request.body || {};
      const user = request.user;
      const lang = request.translations.lang // en, fr, ja
      console.log(`Language for this request: ${lang}`);

      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (!chatId || !userChatId) {
        return reply.code(400).send({ error: 'chatId and userChatId are required' });
      }

      const db = fastify.mongo.db;
      const currentUserId = toObjectId(user._id);
      let targetChatId;
      let targetUserChatId;

      try {
        targetChatId = toObjectId(chatId);
        targetUserChatId = toObjectId(userChatId);
      } catch (conversionError) {
        return reply.code(400).send({ error: 'Invalid identifier format' });
      }

      const [userChat, galleryImage] = await Promise.all([
        getUserChatForUser(db, targetUserChatId, currentUserId),
        getGalleryImageById(db, imageId)
      ]);

      if (!userChat) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }

      const userChatTargetId = userChat.chatId instanceof ObjectId ? userChat.chatId : toObjectId(userChat.chatId);
      if (userChatTargetId.toString() !== targetChatId.toString()) {
        return reply.code(403).send({ error: 'Chat mismatch' });
      }

      if (!galleryImage || !galleryImage.image || !galleryImage.image.imageUrl) {
        return reply.code(404).send({ error: 'Image not found' });
      }

      const { image, chatId: sourceChatId, chatSlug } = galleryImage;

      const existingTitle = image.title || {};
      if (!existingTitle[lang]) {
        const fullLang = { en: 'english', fr: 'french', ja: 'japanese', hi: 'hindi' }[lang] || 'english';
        existingTitle[lang] = await generatePromptTitle(image.prompt, fullLang);
        // Update the database asynchronously
        db.collection('gallery').updateOne(
          { 'images._id': new ObjectId(imageId) },
          { $set: { 'images.$.title': existingTitle } }
        ).catch(err => console.error('Failed to update title:', err));
      }

      const chatMessage = buildChatImageMessage(image, { fromGallery: true });
      chatMessage.targetChatId = targetChatId.toString();

      const updateResult = await appendMessageToUserChat(db, targetUserChatId, chatMessage);

      if (!updateResult.modifiedCount) {
        return reply.code(500).send({ error: 'Failed to add image to chat' });
      }

      const isLiked = Array.isArray(image.likedBy)
        ? image.likedBy.some(likedUserId => likedUserId.toString() === currentUserId.toString())
        : false;

      const responsePayload = {
        _id: image._id.toString(),
        imageUrl: image.imageUrl || image.url,
        prompt: image.prompt || '',
        title: existingTitle,
        nsfw: !!image.nsfw,
        slug: image.slug || null,
        aspectRatio: image.aspectRatio || null,
        seed: typeof image.seed !== 'undefined' ? image.seed : null,
        isUpscaled: !!image.isUpscaled,
        actions: chatMessage.actions,
        chatId: targetChatId.toString(),
        sourceChatId: sourceChatId ? sourceChatId.toString() : null,
        chatSlug: chatSlug || image.chatSlug || null,
        isLiked,
        mergeId: image.mergeId || null,
        isMergeFace: !!(image.isMerged || image.type === 'mergeFace'),
        originalImageUrl: image.originalImageUrl || null,
      };

      return reply.send({
        success: true,
        message: 'Image added to chat',
        image: responsePayload
      });

    } catch (error) {
      console.error('Error in /gallery/:imageId/add-to-chat:', error);
      return reply.code(500).send({ error: 'Internal Server Error' });
    }
  });
  
  fastify.get('/user/:userId/liked-images', async (request, reply) => {
    try {
      const userId = new ObjectId(request.params.userId);
      const page = parseInt(request.query.page) || 1;
      const contentType = request.query.content_type; // Optional content_type filter (SFW/NSFW)
      const limit = 12; // Number of images per page
      const skip = (page - 1) * limit;

      const db = fastify.mongo.db;
      const imagesLikesCollection = db.collection('images_likes');
      const chatsGalleryCollection = db.collection('gallery');
      const chatsCollection = db.collection('chats');

      // Get ALL liked imageIds (without pagination yet - we'll paginate after filtering)
      const allLikedImageIds = await imagesLikesCollection
        .find({ userId })
        .sort({ _id: -1 })
        .map(doc => doc.imageId)
        .toArray();

      // If no images liked by user
      if (!allLikedImageIds.length) {
        return reply.send({ images: [], page, totalPages: 0 });
      }

      console.log(`[DEBUG] User liked images - Total liked images: ${allLikedImageIds.length}`);

      // Build aggregation pipeline with content_type filter
      const aggregatePipeline = [
        { $match: { 'images._id': { $in: allLikedImageIds } } },  // Match only documents where the liked image IDs exist
        { $unwind: '$images' },  // Unwind to get individual images
        { $match: { 'images._id': { $in: allLikedImageIds } } }  // Match the images specifically with the liked IDs
      ];

      // Add content_type filter if provided (BEFORE pagination)
      if (contentType) {
        const normalizedContentType = contentType.toUpperCase();
        console.log(`[DEBUG] User liked images - Filtering by content_type: ${normalizedContentType} (userId: ${userId}, page ${page})`);
        if (normalizedContentType === 'SFW') {
          // SFW: only images where nsfw is not true
          aggregatePipeline.push({
            $match: {
              'images.nsfw': { $ne: true }
            }
          });
        } else if (normalizedContentType === 'NSFW') {
          // NSFW: only images where nsfw is true
          aggregatePipeline.push({
            $match: {
              'images.nsfw': true
            }
          });
        }
      } else {
        console.log(`[DEBUG] User liked images - No content_type filter (userId: ${userId}, page ${page})`);
      }

      // Add sorting to maintain liked order, then apply pagination
      aggregatePipeline.push(
        { $addFields: {
          likeOrder: {
            $indexOfArray: [allLikedImageIds.map(id => id.toString()), { $toString: '$images._id' }]
          }
        }},
        { $sort: { likeOrder: 1 } },  // Sort by original like order
        { $skip: skip },               // Apply pagination AFTER filtering
        { $limit: limit },
        { $project: { image: '$images', chatId: 1, _id: 0 } }  // Project image and chatId
      );

      // Fetch the documents that contain the liked images from the gallery collection
      const likedImagesDocs = await chatsGalleryCollection
        .aggregate(aggregatePipeline)
        .toArray();

      console.log(`[DEBUG] User liked images - Found ${likedImagesDocs.length} images after filtering and pagination (content_type: ${contentType || 'none'})`);

      // Extract chatIds from the liked images
      const chatIds = likedImagesDocs.map(doc => doc.chatId);
  
      // Fetch the chat data from the chats collection
      const chats = await chatsCollection
        .find({ _id: { $in: chatIds } })
        .toArray();
  
      // Map the chat data to the images
      const imagesWithChatData = likedImagesDocs.map(doc => {
        const image = doc.image;
        const chat = chats.find(c => c._id.equals(doc.chatId));
        image.chatSlug =  chat?.slug || ''

        const imageData = {
          ...image,
          chatId: chat?._id,
          chatName: chat ? chat.name : 'Unknown Chat',
          thumbnail: chat ? chat?.chatImageUrl || chat?.thumbnail || chat?.thumbnailUrl : '/img/default-thumbnail.png'
        };

        // DEBUG: Log each image's NSFW status
        console.log(`[DEBUG]   - Image ${imageData._id}: ${imageData.nsfw ? 'NSFW' : 'SFW'} (nsfw=${imageData.nsfw})`);

        return imageData;
      });
  
      // Total liked images by user (filtered by content_type if specified)
      let totalLikedCount;
      if (contentType) {
        // If filtering by content type, count filtered images using the same pipeline
        const countPipeline = [
          { $match: { 'images._id': { $in: allLikedImageIds } } },
          { $unwind: '$images' },
          { $match: { 'images._id': { $in: allLikedImageIds } } }
        ];

        const normalizedContentType = contentType.toUpperCase();
        if (normalizedContentType === 'SFW') {
          countPipeline.push({ $match: { 'images.nsfw': { $ne: true } } });
        } else if (normalizedContentType === 'NSFW') {
          countPipeline.push({ $match: { 'images.nsfw': true } });
        }

        countPipeline.push({ $count: 'total' });

        const countResult = await chatsGalleryCollection.aggregate(countPipeline).toArray();
        totalLikedCount = countResult.length > 0 ? countResult[0].total : 0;
        console.log(`[DEBUG] User liked images - Total ${normalizedContentType} images: ${totalLikedCount}`);
      } else {
        // No filter, count all liked images
        totalLikedCount = allLikedImageIds.length;
      }
      const totalPages = Math.ceil(totalLikedCount / limit);

      return reply.send({
        images: imagesWithChatData,
        page,
        totalPages
      });
  
    } catch (err) {
      console.error(err);
      reply.code(500).send('Internal Server Error');
    }
  });

fastify.get('/chats/images/search', async (request, reply) => {
  try {
    const user = request.user;
    const language = getLanguageName(user?.lang);
    const queryStr = request.query.query || '';
    const page = parseInt(request.query.page) || 1;
    const limit = parseInt(request.query.limit) || 24;
    const skip = (page - 1) * limit;
    const db = fastify.mongo.db;
    const chatsGalleryCollection = db.collection('gallery');

    // Prepare search words
    const queryWords = queryStr.split(' ').filter(word => word.replace(/[^\w\s]/gi, '').trim() !== '');

    // Match only entries with image URLs
    const baseMatch = {
      'images.imageUrl': { $exists: true, $ne: null }
    };

    // Language filter (via $lookup)
    const chatLanguageMatch = [
      {
        $lookup: {
          from: 'chats',
          localField: 'chatId',
          foreignField: '_id',
          as: 'chat'
        }
      },
      { $unwind: '$chat' },
      {
        $match: {
          $or: [
            { 'chat.language': language },
            { 'chat.language': request.lang }
          ]
        }
      }
    ];

    // Score expressions
    const scoreExpressions = queryWords.map(word => ({
      $cond: [
        { $eq: [{ $type: "$images.prompt" }, "string"] },
        {
          $cond: [
            { $regexMatch: { input: "$images.prompt", regex: new RegExp(word, "i") } },
            1,
            0
          ]
        },
        0
      ]
    }));

    const scoringStage = {
      $addFields: {
        matchScore: { $sum: scoreExpressions }
      }
    };

    const pipeline = [
      { $unwind: '$images' },
      { $match: baseMatch },
      ...chatLanguageMatch,
      scoringStage,
      { $match: queryWords.length > 0 ? { matchScore: { $gt: 0 } } : {} },
      { $sort: { matchScore: -1, _id: -1 } }, // Secondary sort by _id for stability
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          image: '$images',
          chatId: 1,
          chat: 1,
          matchScore: 1
        }
      }
    ];

    const [allChatImagesDocs, totalCountDocs] = await Promise.all([
      chatsGalleryCollection.aggregate(pipeline).toArray(),
      chatsGalleryCollection.aggregate([
        { $unwind: '$images' },
        { $match: baseMatch },
        ...chatLanguageMatch,
        scoringStage,
        { $match: queryWords.length > 0 ? { matchScore: { $gt: 0 } } : {} },
        { $count: 'total' }
      ]).toArray()
    ]);

    // Group and limit 3 images per chat
    const grouped = {};
    const limitedDocs = [];
    for (const doc of allChatImagesDocs) {
      const chatIdStr = String(doc.chatId);
      if (!grouped[chatIdStr]) grouped[chatIdStr] = 0;
      if (grouped[chatIdStr] < 3) {
        limitedDocs.push(doc);
        grouped[chatIdStr]++;
      }
    }

    const totalImages = totalCountDocs.length ? totalCountDocs[0].total : 0;
    const totalPages = Math.ceil(totalImages / limit);
    if (!totalImages) {
      return reply.code(404).send({ images: [], page, totalPages: 0 });
    }

    const imagesWithChatData = limitedDocs.map(doc => {
      const chat = doc.chat || {};
      return {
        ...doc.image,
        chatId: doc.chatId,
        chatName: chat.name,
        chatImageUrl: chat.chatImageUrl || '/img/default-thumbnail.png',
        chatTags: chat.tags || [],
        chatSlug: chat.slug || '',
        messagesCount: chat.messagesCount || 0,
        first_message: chat.first_message || '',
        description: chat.description || '',
        galleries: chat.galleries || [],
        nickname: chat.nickname || '',
        imageCount: chat.imageCount,
        matchScore: doc.matchScore
      };
    });

    reply.send({
      images: imagesWithChatData,
      page,
      totalPages
    });

  } catch (err) {
    console.error('Error in /chats/images/search:', err);
    reply.code(500).send('Internal Server Error');
  }
});


  fastify.get('/chats/images', async (request, reply) => {
    try {
      const user = request.user;
      let language = getLanguageName(user?.lang);
      const page = parseInt(request.query.page) || 1;
      const limit = 12;
      const skip = (page - 1) * limit;
  
      const db = fastify.mongo.db;
      const chatsGalleryCollection = db.collection('gallery');
      const chatsCollection = db.collection('chats');
  
      const chatIds = await chatsCollection
        .find({ 
          $or: [
          { language },
          { language: request.lang }
          ]
        })
        .project({ _id: 1 })
        .toArray()
        .then(chats => chats.map(c => c._id));
  
      const [allChatImagesDocs, totalCountDocs] = await Promise.all([
        chatsGalleryCollection.aggregate([
          { $unwind: '$images' },
          { $match: { 'images.imageUrl': { $exists: true, $ne: null }, chatId: { $in: chatIds } } },
          { $sort: { _id: -1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: { _id: 0, image: '$images', chatId: 1 } }
        ]).toArray(),
        chatsGalleryCollection.aggregate([
          { $unwind: '$images' },
          { $match: { 'images.imageUrl': { $exists: true, $ne: null }, chatId: { $in: chatIds } } },
          { $count: 'total' }
        ]).toArray()
      ]);
  
      const totalImages = totalCountDocs.length ? totalCountDocs[0].total : 0;
      if (!totalImages) {
        return reply.code(404).send({ images: [], page, totalPages: 0 });
      }
      const totalPages = Math.ceil(totalImages / limit);
  
      const chatsData = await chatsCollection
        .find({ _id: { $in: chatIds } })
        .toArray();
  
      const images = allChatImagesDocs.map(doc => {
        const chat = chatsData.find(c => c._id.equals(doc.chatId));
        return {
          ...doc.image,
          chatId: doc.chatId,
          chatName: chat?.name,
          thumbnail: chat?.thumbnail || chat?.thumbnailUrl || '/img/default-thumbnail.png'
        };
      });
  
      reply.send({ images, page, totalPages });
    } catch (err) {
      reply.code(500).send('Internal Server Error');
    }
  });  
fastify.get('/chats/horizontal-gallery', async (request, reply) => {
  try {
    const db = fastify.mongo.db;
    const chatsGalleryCollection = db.collection('gallery');
    const chatsCollection = db.collection('chats');
    const userId = request.user?._id;

    // Pagination parameters
    const page = parseInt(request.query.page) || 1; // Default to page 1
    const limit = parseInt(request.query.limit) || 10; // Default limit of 10
    const skip = (page - 1) * limit;

    // Search query parameter
    const queryStr = request.query.query || '';
    const queryWords = queryStr.split(' ').filter(word => word.replace(/[^\w\s]/gi, '').trim() !== '');

    // Get the requested language
    const language = getLanguageName(request.user?.lang);
    const requestLang = request.lang; // Language inferred from the request

    // Build match filter for images
    const imageMatch = { 'images.1': { $exists: true } }; // Only chats with at least 2 images

    // Fetch chat IDs that have images (and style if provided)
    const chatsWithImages = await chatsGalleryCollection
      .aggregate([
      { $match: imageMatch },
      { $sort: { _id: -1 } }, // Sort by _id in descending order for latest first
      { $project: { chatId: 1 } }
      ])
      .toArray();

    const chatIdsWithImages = chatsWithImages.map(c => c.chatId);

    // Build search filter for chat metadata
    let searchFilter = {
      _id: { $in: chatIdsWithImages },
      $or: [
        { language: language },
        { language: requestLang }
      ]
    };

    // Add search functionality if query is provided
    if (queryWords.length > 0) {
      const searchConditions = queryWords.map(word => ({
        $or: [
          { name: { $regex: new RegExp(word, 'i') } },
          { description: { $regex: new RegExp(word, 'i') } },
          { first_message: { $regex: new RegExp(word, 'i') } },
          { tags: { $regex: new RegExp(word, 'i') } },
          { nickname: { $regex: new RegExp(word, 'i') } }
        ]
      }));

      searchFilter.$and = searchConditions;
    }

    // Fetch chat metadata with search filter and pagination
    const chats = await chatsCollection
      .find(searchFilter)
      .project({
        _id: 1,
        name: 1,
        thumbnail: 1,
        thumbnailUrl: 1,
        language: 1,
        description: 1,
        first_message: 1,
        slug: 1,
        tags: 1,
        nickname: 1,
        nsfw: 1
      })
      .sort({ _id: -1 }) // Sort by _id in descending order for latest first
      .skip(skip)
      .limit(limit)
      .toArray();

    const totalChatsCount = await chatsCollection.countDocuments(searchFilter);
    const totalPages = Math.ceil(totalChatsCount / limit);

    // Fetch images for the filtered chats
    const imagesByChat = await chatsGalleryCollection
      .find({ chatId: { $in: chats.map(chat => chat._id) } })
      .project({
        chatId: 1,
        images: 1,
        imageCount: { $size: '$images' }
      })
      .toArray();

    // Fetch user chat history for the current user to determine if they've chatted with each character
    // Using the same hasUserChattedWithCharacter utility function for consistency
    const result = [];
    for (const chat of chats) {
      const imageInfo = imagesByChat.find(image => image.chatId.equals(chat._id));
      const hasChatted = userId ? await hasUserChattedWithCharacter(db, userId, chat._id.toString()) : false;
      
      result.push({
        ...chat,
        images: imageInfo?.images || [],
        imageCount: imageInfo?.imageCount || 0,
        thumbnail: chat.thumbnail || chat.thumbnailUrl || '/img/default-thumbnail.png',
        hasUserChatted: hasChatted
      });
    }

    // Send response with pagination metadata
    reply.send({
      chats: result,
      page,
      limit,
      totalPages,
      totalChatsCount,
      query: queryStr,
      message: queryStr ? 'Search results retrieved successfully.' : 'Chats with images retrieved successfully.'
    });
  } catch (err) {
    console.error(err);
    reply.code(500).send({ error: 'Internal Server Error' });
  }
});
  fastify.get('/chat/:chatId/images', async (request, reply) => {
    const { chatId } = request.params;
    const userChatId = request.query.userChatId; // Optional userChatId filter
    const contentType = request.query.content_type; // Optional content_type filter (SFW/NSFW)
    const page = parseInt(request.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;

    try {
      const db = fastify.mongo.db;
      const chatsGalleryCollection = db.collection('gallery');
      const chatsCollection = db.collection('chats');
      const userChatCollection = db.collection('userChat');

      // Get user information for filtering
      const user = request.user;
      const subscriptionStatus = user?.subscriptionStatus === 'active';
      const isTemporary = !!user?.isTemporary;

      // Fetch the chat data (chatName and thumbnail)
      const chat = await chatsCollection.findOne({ _id: new ObjectId(chatId) });
      if (!chat) {
        return reply.code(404).send({ error: 'Chat not found' });
      }

      // If userChatId is provided, filter images by those referenced in userChat messages
      let imageIdsFilter = null;
      if (userChatId && ObjectId.isValid(userChatId)) {
        const userChatDoc = await userChatCollection.findOne({ 
          _id: new ObjectId(userChatId),
          chatId: new ObjectId(chatId)
        });
        
        if (userChatDoc && Array.isArray(userChatDoc.messages)) {
          // Extract all imageIds from messages
          const imageIds = [];
          userChatDoc.messages.forEach(msg => {
            if (msg.imageId && (msg.type === 'image' || msg.type === 'mergeFace' || msg.imageUrl)) {
              try {
                // Handle both string and ObjectId formats
                const imageId = msg.imageId instanceof ObjectId 
                  ? msg.imageId 
                  : new ObjectId(msg.imageId);
                imageIds.push(imageId);
              } catch (err) {
                // Skip invalid imageIds
                console.warn(`[DEBUG] Invalid imageId in message: ${msg.imageId}`, err);
              }
            }
          });
          
          imageIdsFilter = imageIds.length > 0 ? imageIds : [];
          console.log(`[DEBUG] Filtering images for userChatId: ${userChatId}, found ${imageIds.length} imageIds`);
        } else {
          console.log(`[DEBUG] userChatId ${userChatId} not found or has no messages`);
          imageIdsFilter = []; // No images for this userChat
        }
      }

      // Build the aggregation pipeline
      const matchStage = { chatId: new ObjectId(chatId) };
      
      // If filtering by userChatId, add imageIds filter
      const aggregatePipeline = [
        { $match: matchStage },
        { $unwind: '$images' },
        { $match: { 
            'images.imageUrl': { $exists: true, $ne: null },
            'images.isUpscaled': { $ne: true }
          } 
        }
      ];

      // Add content_type filter if provided
      if (contentType) {
        const normalizedContentType = contentType.toUpperCase();
        if (normalizedContentType === 'SFW') {
          // SFW: only images where nsfw is not true
          aggregatePipeline.push({
            $match: {
              'images.nsfw': { $ne: true }
            }
          });
        } else if (normalizedContentType === 'NSFW') {
          // NSFW: only images where nsfw is true
          aggregatePipeline.push({
            $match: {
              'images.nsfw': true
            }
          });
        }
      }

      // Add userChatId filter if provided
      if (imageIdsFilter !== null) {
        if (imageIdsFilter.length === 0) {
          // No images for this userChat, return empty result
          return reply.send({
            images: [],
            page,
            totalPages: 0,
            totalImages: 0
          });
        }
        aggregatePipeline.push({
          $match: {
            'images._id': { $in: imageIdsFilter }
          }
        });
      }

      // Continue with sorting and pagination
      aggregatePipeline.push(
        { $sort: { 'images.createdAt': -1 } },
        { $skip: skip },
        { $limit: limit },
        { $project: { _id: 0, image: '$images', chatId: 1 } }
      );

      const chatImagesDocs = await chatsGalleryCollection
        .aggregate(aggregatePipeline)
        .toArray();

      // Get total image count for pagination
      const countPipeline = [
        { $match: matchStage },
        { $unwind: '$images' },
        { $match: { 
            'images.imageUrl': { $exists: true, $ne: null },
            'images.isUpscaled': { $ne: true }
          } 
        }
      ];

      // Add content_type filter to count pipeline if provided
      if (contentType) {
        const normalizedContentType = contentType.toUpperCase();
        if (normalizedContentType === 'SFW') {
          countPipeline.push({
            $match: {
              'images.nsfw': { $ne: true }
            }
          });
        } else if (normalizedContentType === 'NSFW') {
          countPipeline.push({
            $match: {
              'images.nsfw': true
            }
          });
        }
      }

      if (imageIdsFilter !== null && imageIdsFilter.length > 0) {
        countPipeline.push({
          $match: {
            'images._id': { $in: imageIdsFilter }
          }
        });
      }

      countPipeline.push({ $count: 'total' });

      const totalImagesCount = await chatsGalleryCollection
        .aggregate(countPipeline)
        .toArray();

      const totalImages = totalImagesCount.length > 0 ? totalImagesCount[0].total : 0;
      const totalPages = Math.ceil(totalImages / limit);

      // If no images found
      if (chatImagesDocs.length === 0) {
        return reply.send({ images: [], page, totalPages: 0, totalImages: 0 });
      }

      // Get user ID for checking if images are liked
      const currentUserId = user ? new ObjectId(user._id) : null;

      // Map the chat data to the images
      const imagesWithChatData = chatImagesDocs.map(doc => {
        // Check if current user has liked this image
        const isLiked = currentUserId && Array.isArray(doc.image.likedBy)
          ? doc.image.likedBy.some(likedUserId => likedUserId.toString() === currentUserId.toString())
          : false;

        return {
          ...doc.image,
          chatId: chat._id,
          chatSlug: chat.slug,
          chatName: chat.name,
          thumbnail: chat?.thumbnail || chat?.thumbnailUrl || '/img/default-thumbnail.png',
          isLiked: isLiked
        };
      });

      // Send the paginated images response
      return reply.send({
        images: imagesWithChatData,
        page,
        totalPages,
        totalImages
      });
    } catch (err) {
      console.error('Error in /chat/:chatId/images:', err);
      reply.code(500).send('Internal Server Error');
    }
  });  
  
  fastify.get('/chat/:chatId/users', async (request, reply) => {
    try {
      // Extract chatId from URL parameters and validate it
      const chatIdParam = request.params.chatId;
      let chatId;
      try {
        chatId = new fastify.mongo.ObjectId(chatIdParam);
      } catch (e) {
        return reply.code(400).send({ error: 'Invalid chatId format' });
      }
  
      // Handle pagination parameters
      const page = parseInt(request.query.page, 10) || 1;
      const limit = 20; // Number of users per page
      const skip = (page - 1) * limit;
  
      const db = fastify.mongo.db;
      const userChatCollection = db.collection('userChat');
      const usersCollection = db.collection('users');
      const chatsCollection = db.collection('chats');
  
      // Verify that the chat exists
      const chat = await chatsCollection.findOne({ _id: chatId });
      if (!chat) {
        return reply.code(404).send({ error: 'Chat not found' });
      }
  
      // Find userChat documents for the chat
      const userChatDocs = await userChatCollection
      .find({ 
        $or: [
            { chatId: chatId.toString() },
            { chatId: new fastify.mongo.ObjectId(chatId) }
        ] })
      .skip(skip).limit(limit).toArray();

      if (userChatDocs.length === 0) {
        return reply.code(200).send({
          users: [],
          page,
          totalPages: 0
        });
      }
  
      // Extract userIds and exclude temporary users
      const userIds = userChatDocs.map(doc => new fastify.mongo.ObjectId(doc.userId));
  
      // Fetch user details from usersCollection
      const users = await usersCollection.find({
        _id: { $in: userIds },
        isTemporary: { $ne: true }
      }).toArray();
  
      // Get total users count excluding temporary users
      const totalUsers = await userChatCollection.countDocuments({
        chatId: chatId
        // Note: This count does not exclude temporary users. To exclude, use aggregation or adjust accordingly.
      });
  
      const totalPages = Math.ceil(totalUsers / limit);
  
      // Format the response data
      const formattedUsers = users.map(user => ({
        userId: user._id,
        nickname: user.nickname,
        email: user.email,
        profileUrl: user.profileUrl || '/img/avatar.png',
        createdAt: user.createdAt,
      }));

      return reply.send({
        users: formattedUsers,
        page,
        totalPages
      });
    } catch (err) {
      console.error('Error fetching users for chat:', err);
      return reply.code(500).send({ error: 'Internal Server Error' });
    }
  });
  
  
  fastify.put('/images/:imageId/nsfw', async (request, reply) => {
    try {
      const imageId = new fastify.mongo.ObjectId(request.params.imageId);
      const { nsfw } = request.body;

      if (typeof nsfw !== 'boolean') {
        return reply.code(400).send({ error: 'Invalid NSFW value. It must be a boolean.' });
      }
  
      const db = fastify.mongo.db;
      const galleryCollection = db.collection('gallery');
  
      // Update the nsfw field of the specific image in the gallery
      const result = await galleryCollection.updateOne(
        { 'images._id': imageId },       // Match the specific image by imageId
        { $set: { 'images.$.nsfw': nsfw } }  // Update the nsfw field
      );
  
      if (result.matchedCount === 0) {
        return reply.code(404).send({ error: 'Image not found.' });
      }
  
      reply.send({ message: 'NSFW status updated successfully.' });
    } catch (err) {
      console.error(err);
      reply.code(500).send('Internal Server Error');
    }
  });

  fastify.get('/categories/images', async (request, reply) => {
    try {
      const db = fastify.mongo.db;
      const chatsGalleryCollection = db.collection('gallery');
      const chatsCollection = db.collection('chats');

      // Get translations for categories
      const translations = request.translations || {};
      const categoryTranslations = translations.categories || {};

      // Define 6 categories with their associated tags/keywords
      const categories = [
        { 
          nameKey: 'maid',
          name: categoryTranslations.maid || 'Maid', 
          tags: ['maid', 'maid dress', 'maid outfit', 'maid costume'], 
          icon: 'bi-bucket' 
        },
        { 
          nameKey: 'princess',
          name: categoryTranslations.princess || 'Princess', 
          tags: ['princess', 'zelda', 'royalty', 'crown', 'castle'], 
          icon: 'bi-gem' 
        },
        { 
          nameKey: 'fantasy',
          name: categoryTranslations.fantasy || 'Fantasy', 
          tags: ['forest elfe', 'forest elf', 'fantasy', 'magical', 'elfe', 'elf', 'fairy'], 
          icon: 'bi-emoji-smile' 
        },
        { 
          nameKey: 'ninja',
          name: categoryTranslations.ninja || 'Ninja', 
          tags: ['ninja', 'shinobi', 'stealth', 'assassin', 'kunai'], 
          icon: 'bi-person-dash' 
        },
        {
          nameKey: 'Schoolgirl',
          name: categoryTranslations.schoolgirl || 'Schoolgirl',
          tags: ['schoolgirl', 'uniform', 'student', 'school', 'teen', 'academy'],
          icon: 'bi-mortarboard'
        },
        { 
          nameKey: 'demon',
          name: categoryTranslations.demon || 'Demon', 
          tags: ['demon', 'devil', 'fiend', 'satanic', 'succubus', 'imp', 'hell', 'tails'], 
          icon: 'bi-emoji-angry' 
        }
      ];

      const categoryResults = [];

      // Get user language for filtering
      const user = request.user;
      const language = getLanguageName(user?.lang);
      const requestLang = request.lang;

      for (const category of categories) {
        try {
          // Create regex patterns for each tag
          const tagRegexes = category.tags.map(tag => new RegExp(tag, 'i'));
          
          // Find images that match category tags and are SFW
          const pipeline = [
            { $unwind: '$images' },
            {
              $match: {
                'images.imageUrl': { $exists: true, $ne: null },
                // Only SFW content - exclude all NSFW values (boolean true, string 'true', string 'on')
                'images.nsfw': { $nin: [true, 'true', 'on'] },
                $or: [
                  { 'images.prompt': { $in: tagRegexes } },
                  { 'images.style': { $in: category.tags } }
                ]
              }
            },
            {
              $lookup: {
                from: 'chats',
                localField: 'chatId',
                foreignField: '_id',
                as: 'chat'
              }
            },
            { $unwind: '$chat' },
            {
              $match: {
                $or: [
                  { 'chat.language': language },
                  { 'chat.language': requestLang }
                ],
                // Only SFW chats
                'chat.nsfw': { $nin: [true, 'true', 'on'] }
              }
            },
            { $sample: { size: 1 } }, // Get random image
            {
              $project: {
                image: '$images',
                chatId: '$chatId',
                chatName: '$chat.name',
                chatSlug: '$chat.slug',
                thumbnail: '$chat.thumbnail'
              }
            }
          ];

          const result = await chatsGalleryCollection.aggregate(pipeline).toArray();
          
          if (result.length > 0) {
            const imageData = result[0];
            categoryResults.push({
              category: category.name,
              icon: category.icon,
              image: {
                ...imageData.image,
                chatId: imageData.chatId,
                chatName: imageData.chatName,
                chatSlug: imageData.chatSlug,
                thumbnail: imageData.thumbnail || '/img/default-thumbnail.png'
              }
            });
          } else {
            // Fallback: get any SFW image if no tagged images found
            const fallbackPipeline = [
              { $unwind: '$images' },
              {
                $match: {
                  'images.imageUrl': { $exists: true, $ne: null },
                  // Only SFW content - exclude all NSFW values
                  'images.nsfw': { $nin: [true, 'true', 'on'] }
                }
              },
              {
                $lookup: {
                  from: 'chats',
                  localField: 'chatId',
                  foreignField: '_id',
                  as: 'chat'
                }
              },
              { $unwind: '$chat' },
              {
                $match: {
                  $or: [
                    { 'chat.language': language },
                    { 'chat.language': requestLang }
                  ],
                  // Only SFW chats
                  'chat.nsfw': { $nin: [true, 'true', 'on'] }
                }
              },
              { $sample: { size: 1 } },
              {
                $project: {
                  image: '$images',
                  chatId: '$chatId',
                  chatName: '$chat.name',
                  chatSlug: '$chat.slug',
                  thumbnail: '$chat.thumbnail'
                }
              }
            ];

            const fallbackResult = await chatsGalleryCollection.aggregate(fallbackPipeline).toArray();
            
            if (fallbackResult.length > 0) {
              const imageData = fallbackResult[0];
              categoryResults.push({
                category: category.name,
                icon: category.icon,
                image: {
                  ...imageData.image,
                  chatId: imageData.chatId,
                  chatName: imageData.chatName,
                  chatSlug: imageData.chatSlug,
                  thumbnail: imageData.thumbnail || '/img/default-thumbnail.png'
                }
              });
            }
          }
        } catch (categoryError) {
          console.error(`Error fetching category ${category.name}:`, categoryError);
        }
      }

      reply.send({
        categories: categoryResults,
        success: true
      });

    } catch (err) {
      console.error('Error in /categories/images:', err);
      reply.code(500).send('Internal Server Error');
    }
  });

fastify.get('/api/query-tags', async (request, reply) => {
    try {
        const db = fastify.mongo.db;
        const tagsColl = db.collection('queryTags');

        // If a language is requested, compute tags filtered by chat.language
        const lang = request.query.lang || request.query.language || null;
        if (lang) {
          // Compute on the fly for the requested language (minLength 10, limit 50)
          const results = await buildQueryTagsIndex(db, 10, 50, lang);
          const tags = (results || []).map(r => r.tag).filter(Boolean);
          return reply.send({ tags, success: true, lang });
        }

        // No language provided: try to read persisted ranked tags first
        const persisted = await tagsColl.find({}).sort({ rank: 1 }).toArray();
        let tags = [];

        if (persisted && persisted.length) {
          tags = persisted.map(t => t.tag).filter(Boolean);
        } else {
          // Fallback: compute on the fly (length >= 10, top 50) without language filter
          const chatsCollection = db.collection('chats');
          const pipeline = [
            {
              $lookup: {
                from: 'gallery',
                localField: '_id',
                foreignField: 'chatId',
                as: 'gallery'
              }
            },
            { $match: { 'gallery.0': { $exists: true }, tags: { $exists: true, $ne: [] } } },
            { $unwind: '$tags' },
            { $match: { 'tags': { $type: 'string' } } },
            { $addFields: { tagLength: { $strLenCP: '$tags' } } },
            { $match: { tagLength: { $gte: 10 } } },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 50 },
            { $project: { _id: 0, tag: '$_id', count: 1 } }
          ];

          const results = await chatsCollection.aggregate(pipeline).toArray();
          tags = results.map(r => r.tag).filter(Boolean);
        }

        reply.send({ tags, success: true });
        
    } catch (err) {
        console.error('Error in /api/query-tags:', err);
        reply.code(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.get('/gallery/:imageId/info', async (request, reply) => {
    try {
      const imageId = request.params.imageId;
      let objectId;
      try {
        objectId = new fastify.mongo.ObjectId(imageId);
      } catch (e) {
        return reply.code(400).send({ error: 'Invalid imageId format' });
      }

      const db = fastify.mongo.db;
      const galleryCollection = db.collection('gallery');
      const tasksCollection = db.collection('tasks');
      const chatsCollection = db.collection('chats');

      // Aggregate to fetch image details with joins
      const pipeline = [
        { $unwind: '$images' },
        { $match: { 'images._id': objectId } },
        {
          $lookup: {
            from: 'tasks',
            localField: 'images.taskId',
            foreignField: 'taskId',
            as: 'task'
          }
        },
        { $unwind: { path: '$task', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'chats',
            localField: 'chatId',
            foreignField: '_id',
            as: 'chat'
          }
        },
        { $unwind: { path: '$chat', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            image: {
              _id: '$images._id',
              prompt: '$images.prompt',
              title: '$images.title',
              slug: '$images.slug',
              imageUrl: '$images.imageUrl',
              aspectRatio: '$images.aspectRatio',
              seed: '$images.seed',
              nsfw: '$images.nsfw',
              isMerged: '$images.isMerged',
              mergeId: '$images.mergeId',
              originalImageUrl: '$images.originalImageUrl',
              createdAt: '$images.createdAt',
              likes: '$images.likes',
              likedBy: '$images.likedBy'
            },
            request: {
              model_name: '$task.model_name',
              width: '$task.width',
              height: '$task.height',
              sampler_name: '$task.sampler_name',
              guidance_scale: '$task.guidance_scale',
              steps: '$task.steps',
              negative_prompt: '$task.negative_prompt',
              blur: '$task.blur',
              chatCreation: '$task.chatCreation'
            },
            chat: {
              name: '$chat.name',
              slug: '$chat.slug',
              language: '$chat.language'
            }
          }
        }
      ];

      const result = await galleryCollection.aggregate(pipeline).toArray();

      if (result.length === 0) {
        return reply.code(404).send({ error: 'Image not found' });
      }

      const imageInfo = result[0];
      return reply.send({ success: true, data: imageInfo });

    } catch (error) {
      console.error('Error in /gallery/:imageId/info:', error);
      return reply.code(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get video details for modal view
  fastify.get('/gallery/video/:videoId/info', async (request, reply) => {
    try {
      const videoId = request.params.videoId;
      let objectId;
      try {
        objectId = new fastify.mongo.ObjectId(videoId);
      } catch (e) {
        return reply.code(400).send({ error: 'Invalid videoId format' });
      }

      const db = fastify.mongo.db;
      const videosCollection = db.collection('videos');
      const chatsCollection = db.collection('chats');

      // Find the video
      const video = await videosCollection.findOne({ _id: objectId });

      if (!video) {
        return reply.code(404).send({ error: 'Video not found' });
      }

      // Get chat info if available
      let chatInfo = null;
      if (video.chatId) {
        const chat = await chatsCollection.findOne(
          { _id: video.chatId },
          { projection: { name: 1, slug: 1, language: 1, chatImageUrl: 1 } }
        );
        if (chat) {
          chatInfo = {
            name: chat.name,
            slug: chat.slug,
            language: chat.language,
            thumbnail: chat.chatImageUrl
          };
        }
      }

      const videoInfo = {
        video: {
          _id: video._id,
          videoUrl: video.videoUrl,
          imageUrl: video.imageUrl,
          prompt: video.prompt,
          duration: video.duration,
          aspectRatio: video.aspectRatio,
          createdAt: video.createdAt
        },
        chat: chatInfo
      };

      return reply.send({ success: true, data: videoInfo });

    } catch (error) {
      console.error('Error in /gallery/video/:videoId/info:', error);
      return reply.code(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get content details (unified endpoint for images and videos)
  fastify.get('/gallery/content/:contentId/info', async (request, reply) => {
    try {
      const contentId = request.params.contentId;
      const contentType = request.query.type || 'image'; // 'image' or 'video'
      
      let objectId;
      try {
        objectId = new fastify.mongo.ObjectId(contentId);
      } catch (e) {
        return reply.code(400).send({ error: 'Invalid contentId format' });
      }

      const db = fastify.mongo.db;
      const chatsCollection = db.collection('chats');

      if (contentType === 'video') {
        const videosCollection = db.collection('videos');
        const video = await videosCollection.findOne({ _id: objectId });

        if (!video) {
          return reply.code(404).send({ error: 'Video not found' });
        }

        let chatInfo = null;
        if (video.chatId) {
          const chat = await chatsCollection.findOne(
            { _id: video.chatId },
            { projection: { name: 1, slug: 1, language: 1, chatImageUrl: 1 } }
          );
          if (chat) {
            chatInfo = {
              name: chat.name,
              slug: chat.slug,
              language: chat.language,
              thumbnail: chat.chatImageUrl
            };
          }
        }

        return reply.send({
          success: true,
          contentType: 'video',
          data: {
            content: {
              _id: video._id,
              videoUrl: video.videoUrl,
              imageUrl: video.imageUrl,
              prompt: video.prompt,
              duration: video.duration,
              aspectRatio: video.aspectRatio,
              createdAt: video.createdAt
            },
            chat: chatInfo
          }
        });
      } else {
        // Image content
        const galleryCollection = db.collection('gallery');
        const tasksCollection = db.collection('tasks');

        const pipeline = [
          { $unwind: '$images' },
          { $match: { 'images._id': objectId } },
          {
            $lookup: {
              from: 'tasks',
              localField: 'images.taskId',
              foreignField: 'taskId',
              as: 'task'
            }
          },
          { $unwind: { path: '$task', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'chats',
              localField: 'chatId',
              foreignField: '_id',
              as: 'chat'
            }
          },
          { $unwind: { path: '$chat', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              content: {
                _id: '$images._id',
                prompt: '$images.prompt',
                title: '$images.title',
                slug: '$images.slug',
                imageUrl: '$images.imageUrl',
                aspectRatio: '$images.aspectRatio',
                seed: '$images.seed',
                nsfw: '$images.nsfw',
                isMerged: '$images.isMerged',
                mergeId: '$images.mergeId',
                originalImageUrl: '$images.originalImageUrl',
                createdAt: '$images.createdAt',
                likes: '$images.likes',
                likedBy: '$images.likedBy'
              },
              request: {
                model_name: '$task.model_name',
                width: '$task.width',
                height: '$task.height',
                sampler_name: '$task.sampler_name',
                guidance_scale: '$task.guidance_scale',
                steps: '$task.steps',
                negative_prompt: '$task.negative_prompt',
                blur: '$task.blur',
                chatCreation: '$task.chatCreation'
              },
              chat: {
                name: '$chat.name',
                slug: '$chat.slug',
                language: '$chat.language',
                thumbnail: '$chat.chatImageUrl'
              }
            }
          }
        ];

        const result = await galleryCollection.aggregate(pipeline).toArray();

        if (result.length === 0) {
          return reply.code(404).send({ error: 'Image not found' });
        }

        return reply.send({
          success: true,
          contentType: 'image',
          data: result[0]
        });
      }

    } catch (error) {
      console.error('Error in /gallery/content/:contentId/info:', error);
      return reply.code(500).send({ error: 'Internal Server Error' });
    }
  });
}

module.exports = routes;
