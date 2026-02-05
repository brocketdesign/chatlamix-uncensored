const { ObjectId } = require('mongodb');
const { getLanguageName } = require('./tool');
const { 
  sequenceCharacters, 
  rotateCharacterImages,
  getColdStartPool,
  getUserPreferencesFromCache
} = require('./content-sequencing-utils');
const { getUserInteractionState } = require('./user-interaction-utils');

/**
 * Build search pipeline for images
 */
function buildSearchPipeline(queryStr, language, requestLang, skip, limit) {
  // Prepare search words
  const queryWords = queryStr.split(' ').filter(word => word.replace(/[^\w\s]/gi, '').trim() !== '');
  const hasQuery = queryWords.length > 0;

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
          { 'chat.language': requestLang }
        ]
      }
    }
  ];

  // Build pipeline based on whether we have a query
  const pipeline = [
    { $unwind: '$images' },
    { $match: baseMatch },
    ...chatLanguageMatch
  ];

  if (hasQuery) {
    // Score expressions for relevance
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

    pipeline.push({
      $addFields: {
        matchScore: { $sum: scoreExpressions }
      }
    });
    pipeline.push({ $match: { matchScore: { $gt: 0 } } });
    pipeline.push({ $sort: { matchScore: -1, _id: -1 } });
  } else {
    // No query: just sort by date
    pipeline.push({ $sort: { _id: -1 } });
  }

  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });
  pipeline.push({
    $project: {
      _id: 0,
      image: '$images',
      chatId: 1,
      chat: 1,
      matchScore: 1
    }
  });

  return pipeline;
}

/**
 * Build count pipeline for images
 */
function buildCountPipeline(queryStr, language, requestLang) {
  const queryWords = queryStr.split(' ').filter(word => word.replace(/[^\w\s]/gi, '').trim() !== '');
  const hasQuery = queryWords.length > 0;

  const baseMatch = {
    'images.imageUrl': { $exists: true, $ne: null }
  };

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
          { 'chat.language': requestLang }
        ]
      }
    }
  ];

  const pipeline = [
    { $unwind: '$images' },
    { $match: baseMatch },
    ...chatLanguageMatch
  ];

  if (hasQuery) {
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

    pipeline.push({
      $addFields: {
        matchScore: { $sum: scoreExpressions }
      }
    });
    pipeline.push({ $match: { matchScore: { $gt: 0 } } });
  }

  pipeline.push({ $count: 'total' });

  return pipeline;
}

/**
 * Build search pipeline for videos
 */
function buildVideoSearchPipeline(queryStr, language, requestLang, skip, limit) {
  const queryWords = queryStr.split(' ').filter(word => word.replace(/[^\w\s]/gi, '').trim() !== '');
  const hasQuery = queryWords.length > 0;

  // Match only entries with video URLs
  const baseMatch = {
    'videos.videoUrl': { $exists: true, $ne: null }
  };

  // Language filter
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
          { 'chat.language': requestLang }
        ]
      }
    }
  ];

  const pipeline = [
    { $unwind: '$videos' },
    { $match: baseMatch },
    ...chatLanguageMatch
  ];

  if (hasQuery) {
    // Score expressions for relevance
    const scoreExpressions = queryWords.map(word => ({
      $cond: [
        { $eq: [{ $type: "$videos.prompt" }, "string"] },
        {
          $cond: [
            { $regexMatch: { input: "$videos.prompt", regex: new RegExp(word, "i") } },
            1,
            0
          ]
        },
        0
      ]
    }));

    pipeline.push({
      $addFields: {
        matchScore: { $sum: scoreExpressions }
      }
    });
    pipeline.push({ $match: { matchScore: { $gt: 0 } } });
    pipeline.push({ $sort: { matchScore: -1, _id: -1 } });
  } else {
    // No query: just sort by date
    pipeline.push({ $sort: { _id: -1 } });
  }

  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });
  pipeline.push({
    $project: {
      _id: 0,
      video: '$videos',
      chatId: 1,
      chat: 1,
      matchScore: 1
    }
  });

  return pipeline;
}

/**
 * Build count pipeline for videos
 */
function buildVideoCountPipeline(queryStr, language, requestLang) {
  const queryWords = queryStr.split(' ').filter(word => word.replace(/[^\w\s]/gi, '').trim() !== '');
  const hasQuery = queryWords.length > 0;

  const baseMatch = {
    'videos.videoUrl': { $exists: true, $ne: null }
  };

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
          { 'chat.language': requestLang }
        ]
      }
    }
  ];

  const pipeline = [
    { $unwind: '$videos' },
    { $match: baseMatch },
    ...chatLanguageMatch
  ];

  if (hasQuery) {
    const scoreExpressions = queryWords.map(word => ({
      $cond: [
        { $eq: [{ $type: "$videos.prompt" }, "string"] },
        {
          $cond: [
            { $regexMatch: { input: "$videos.prompt", regex: new RegExp(word, "i") } },
            1,
            0
          ]
        },
        0
      ]
    }));

    pipeline.push({
      $addFields: {
        matchScore: { $sum: scoreExpressions }
      }
    });
    pipeline.push({ $match: { matchScore: { $gt: 0 } } });
  }

  pipeline.push({ $count: 'total' });

  return pipeline;
}

/**
 * Process image results with chat data
 */
function processImageResults(docs, limit = 3) {
  // Group and limit images per chat
  const grouped = {};
  const limitedDocs = [];
  
  for (const doc of docs) {
    const chatIdStr = String(doc.chatId);
    if (!grouped[chatIdStr]) grouped[chatIdStr] = 0;
    if (grouped[chatIdStr] < limit) {
      limitedDocs.push(doc);
      grouped[chatIdStr]++;
    }
  }

  return limitedDocs.map(doc => {
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
}

/**
 * Process video results with chat data
 */
function processVideoResults(docs, limit = 3) {
  // Group and limit videos per chat
  const grouped = {};
  const limitedDocs = [];
  
  for (const doc of docs) {
    const chatIdStr = String(doc.chatId);
    if (!grouped[chatIdStr]) grouped[chatIdStr] = 0;
    if (grouped[chatIdStr] < limit) {
      limitedDocs.push(doc);
      grouped[chatIdStr]++;
    }
  }

  return limitedDocs.map(doc => {
    const chat = doc.chat || {};
    return {
      ...doc.video,
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
}

/**
 * Search images with pagination
 */
async function searchImages(db, user, queryStr, page = 1, limit = 24) {
  const language = getLanguageName(user?.lang);
  const skip = (page - 1) * limit;
  const chatsGalleryCollection = db.collection('gallery');
  
  const requestLang = user?.lang || 'en';

  const pipeline = buildSearchPipeline(queryStr, language, requestLang, skip, limit);
  const countPipeline = buildCountPipeline(queryStr, language, requestLang);

  const [allChatImagesDocs, totalCountDocs] = await Promise.all([
    chatsGalleryCollection.aggregate(pipeline).toArray(),
    chatsGalleryCollection.aggregate(countPipeline).toArray()
  ]);

  const totalImages = totalCountDocs.length ? totalCountDocs[0].total : 0;
  const totalPages = Math.ceil(totalImages / limit);

  const processedImages = processImageResults(allChatImagesDocs);

  return {
    images: processedImages,
    page,
    totalPages,
    totalCount: totalImages
  };
}

/**
 * Search videos with pagination
 */
async function searchVideos(db, user, queryStr, page = 1, limit = 24) {
  const skip = (page - 1) * limit;
  const videosCollection = db.collection('videos');
  
  const queryWords = queryStr.split(' ').filter(word => word.replace(/[^\w\s]/gi, '').trim() !== '');
  const hasQuery = queryWords.length > 0;

  // Build base match for videos collection
  let matchStage = {
    videoUrl: { $exists: true, $ne: null }
  };

  // Add search filter if query exists
  if (hasQuery) {
    matchStage = {
      ...matchStage,
      $or: [
        { prompt: { $regex: queryWords[0], $options: 'i' } }
      ]
    };
  }

  // Aggregation pipeline to get videos with chat info and image URL for blurred thumbnails
  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'chats',
        localField: 'chatId',
        foreignField: '_id',
        as: 'chat'
      }
    },
    { $unwind: { path: '$chat', preserveNullAndEmptyArrays: true } },
    // Lookup image URL from gallery collection using imageId
    {
      $lookup: {
        from: 'gallery',
        let: { imageId: '$imageId' },
        pipeline: [
          { $unwind: '$images' },
          { $match: { $expr: { $eq: ['$images._id', '$$imageId'] } } },
          { $project: { imageUrl: '$images.imageUrl', _id: 0 } }
        ],
        as: 'imageData'
      }
    },
    { $unwind: { path: '$imageData', preserveNullAndEmptyArrays: true } },
    { $sort: hasQuery ? { createdAt: -1 } : { createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        videoUrl: 1,
        imageUrl: { $ifNull: ['$imageData.imageUrl', null] },
        videoId: '$_id',
        duration: 1,
        prompt: 1,
        title: { $cond: [{ $gt: [{ $strLenCP: '$prompt' }, 0] }, { $substr: ['$prompt', 0, 100] }, 'Video'] },
        nsfw: 1,
        createdAt: 1,
        chatId: 1,
        chatName: '$chat.name',
        chatImageUrl: { $ifNull: ['$chat.chatImageUrl', '/img/default-thumbnail.png'] },
        chatTags: { $ifNull: ['$chat.tags', []] },
        chatSlug: { $ifNull: ['$chat.slug', ''] },
        slug: { $toString: '$_id' }
      }
    }
  ];

  // Count total for pagination
  const countPipeline = [
    { $match: matchStage },
    { $count: 'total' }
  ];

  const [processedVideos, countResult] = await Promise.all([
    videosCollection.aggregate(pipeline).toArray(),
    videosCollection.aggregate(countPipeline).toArray()
  ]);

  const totalVideos = countResult.length ? countResult[0].total : 0;
  const totalPages = Math.ceil(totalVideos / limit);

  return {
    videos: processedVideos,
    page,
    totalPages,
    totalCount: totalVideos
  };
}

/**
 * Search images grouped by character for explore gallery
 * Returns characters with their images for swipe navigation
 * Now with TikTok-style sequencing: weighted randomness + personalization
 */

// Helper to check NSFW value (server-side version)
function isNsfwValue(value) {
  return value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
}

async function searchImagesGroupedByCharacter(db, user, queryStr = '', page = 1, limit = 20, showNSFW = false, userState = null) {
  const language = getLanguageName(user?.lang);
  const requestLang = user?.lang || 'en';
  const chatsGalleryCollection = db.collection('gallery');
  const chatsCollection = db.collection('chats');

  console.log(`[gallery-search-utils] searchImagesGroupedByCharacter - language: ${language}, requestLang: ${requestLang}, query: "${queryStr}", page: ${page}, showNSFW: ${showNSFW}`);

  // Prepare search words
  const queryWords = queryStr.split(' ').filter(word => word.replace(/[^\w\s]/gi, '').trim() !== '');
  const hasQuery = queryWords.length > 0;
  
  // Get user interaction state for personalization
  let interactionState = userState;
  if (!interactionState && user && !user.isTemporary) {
    interactionState = await getUserInteractionState(db, user._id);
  }

  // Build exclusion list from seen characters to prevent repeats
  const seenEntries = interactionState?.seenCharacters
    ? Object.entries(interactionState.seenCharacters)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 500)
    : [];
  const seenIdsForExclusion = seenEntries
    .map(([id]) => id)
    .filter(id => ObjectId.isValid(id))
    .map(id => new ObjectId(id));
  
  console.log(`[gallery-search-utils] Excluding ${seenIdsForExclusion.length} seen characters, showNSFW: ${showNSFW}`);

  // Use smart sequencing for all pages when no query
  // Query results still use traditional pagination for relevance
  const useSmartSequencing = !hasQuery;
  
  // Fetch MORE characters than needed if using smart sequencing (for better selection pool)
  const fetchLimit = useSmartSequencing ? limit * 3 : limit;
  const skip = useSmartSequencing ? 0 : (page - 1) * limit;

  // Build the aggregation pipeline to group images by character
  const pipeline = [
    // Unwind images
    { $unwind: '$images' },
    
    // Match images with URLs
    { 
      $match: { 
        'images.imageUrl': { $exists: true, $ne: null }
      } 
    },

    // Lookup chat information
    {
      $lookup: {
        from: 'chats',
        localField: 'chatId',
        foreignField: '_id',
        as: 'chat'
      }
    },
    { $unwind: '$chat' },

    // Filter by public visibility - include chats with no visibility set (legacy) or public
    {
      $match: {
        $or: [
          { 'chat.visibility': 'public' },
          { 'chat.visibility': { $exists: false } },
          { 'chat.visibility': null }
        ]
      }
    }
  ];

  // Apply optional language filter - but don't be too strict
  // Include chats that match language OR have no language set
  pipeline.push({
    $match: {
      $or: [
        { 'chat.language': language },
        { 'chat.language': requestLang },
        { 'chat.language': { $exists: false } },
        { 'chat.language': null },
        { 'chat.language': '' }
      ]
    }
  });

  // NSFW filtering at the image level - if user doesn't want NSFW, filter out NSFW images early
  // This ensures characters with only NSFW content are not returned to SFW users
  if (!showNSFW) {
    pipeline.push({
      $match: {
        $or: [
          { 'images.nsfw': { $exists: false } },
          { 'images.nsfw': null },
          { 'images.nsfw': false },
          { 'images.nsfw': 'false' },
          { 'images.nsfw': '' }
        ]
      }
    });
  }

  if (seenIdsForExclusion.length > 0) {
    pipeline.push({
      $match: { chatId: { $nin: seenIdsForExclusion } }
    });
  }

  // Add search scoring if query exists
  if (hasQuery) {
    const scoreExpressions = queryWords.map(word => ({
      $cond: [
        {
          $or: [
            { $regexMatch: { input: { $ifNull: ['$images.prompt', ''] }, regex: new RegExp(word, 'i') } },
            { $regexMatch: { input: { $ifNull: ['$chat.name', ''] }, regex: new RegExp(word, 'i') } },
            { $regexMatch: { input: { $ifNull: ['$chat.description', ''] }, regex: new RegExp(word, 'i') } },
            { $regexMatch: { input: { $ifNull: ['$chat.first_message', ''] }, regex: new RegExp(word, 'i') } },
            { $regexMatch: { input: { $ifNull: ['$chat.nickname', ''] }, regex: new RegExp(word, 'i') } },
            {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: { $ifNull: ['$chat.tags', []] },
                      cond: { $regexMatch: { input: '$$this', regex: new RegExp(word, 'i') } }
                    }
                  }
                },
                0
              ]
            }
          ]
        },
        1,
        0
      ]
    }));

    pipeline.push({
      $addFields: {
        matchScore: { $sum: scoreExpressions }
      }
    });
    pipeline.push({ $match: { matchScore: { $gt: 0 } } });
  }

  // Group by character
  pipeline.push({
    $group: {
      _id: '$chatId',
      chatId: { $first: '$chatId' },
      chatName: { $first: '$chat.name' },
      chatSlug: { $first: '$chat.slug' },
      chatImageUrl: { $first: '$chat.chatImageUrl' },
      chatTags: { $first: '$chat.tags' },
      description: { $first: '$chat.description' },
      gender: { $first: '$chat.gender' },
      chatCreatedAt: { $first: '$chat.createdAt' },
      images: {
        $push: {
          _id: '$images._id',
          imageUrl: '$images.imageUrl',
          thumbnailUrl: '$images.thumbnailUrl',
          prompt: '$images.prompt',
          title: '$images.title',
          nsfw: '$images.nsfw',
          createdAt: '$images.createdAt',
          imageModelId: '$images.imageModelId'
        }
      },
      imageCount: { $sum: 1 },
      latestImage: { $max: '$images.createdAt' },
      totalScore: { $sum: { $ifNull: ['$matchScore', 0] } }
    }
  });

  // Sort by relevance (if query) or by randomized order for diversity
  if (hasQuery) {
    pipeline.push({ $sort: { totalScore: -1, latestImage: -1 } });
  } else {
    pipeline.push({ $addFields: { rand: { $rand: {} } } });
    pipeline.push({ $sort: { rand: 1, latestImage: -1 } });
  }

  // Pagination
  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: fetchLimit });

  // Filter images based on NSFW preference
  // If showNSFW is false, only return SFW images
  // If showNSFW is true, return both SFW and NSFW images
  pipeline.push({
    $addFields: {
      sfwImages: {
        $filter: {
          input: '$images',
          cond: { $not: { $in: ['$$this.nsfw', [true, 'true', 'on']] } }
        }
      },
      nsfwImages: {
        $filter: {
          input: '$images',
          cond: { $in: ['$$this.nsfw', [true, 'true', 'on']] }
        }
      }
    }
  });

  // Final projection: filter images based on NSFW preference
  // SFW mode: only SFW images (up to 20)
  // NSFW mode: mix of SFW and NSFW images (up to 10 each)
  pipeline.push({
    $project: {
      _id: 0,
      chatId: 1,
      chatName: 1,
      chatSlug: 1,
      chatImageUrl: { $ifNull: ['$chatImageUrl', '/img/default-thumbnail.png'] },
      chatTags: { $ifNull: ['$chatTags', []] },
      description: 1,
      gender: { $ifNull: ['$gender', 'unknown'] },
      chatCreatedAt: 1,
      imageCount: 1,
      images: showNSFW 
        ? { $concatArrays: [{ $slice: ['$sfwImages', 10] }, { $slice: ['$nsfwImages', 10] }] }
        : { $slice: ['$sfwImages', 20] },
      latestImage: 1
    }
  });

  // Filter out characters with no images after NSFW filtering
  pipeline.push({
    $match: {
      'images.0': { $exists: true }
    }
  });

  // Count total characters for pagination - mirrors the main pipeline for accuracy
  const countPipeline = [
    { $unwind: '$images' },
    { $match: { 'images.imageUrl': { $exists: true, $ne: null } } },
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
          { 'chat.visibility': 'public' },
          { 'chat.visibility': { $exists: false } },
          { 'chat.visibility': null }
        ]
      }
    },
    // Match language filter same as main pipeline
    {
      $match: {
        $or: [
          { 'chat.language': language },
          { 'chat.language': requestLang },
          { 'chat.language': { $exists: false } },
          { 'chat.language': null },
          { 'chat.language': '' }
        ]
      }
    }
  ];

  // NSFW filtering for count pipeline - must match main pipeline
  if (!showNSFW) {
    countPipeline.push({
      $match: {
        $or: [
          { 'images.nsfw': { $exists: false } },
          { 'images.nsfw': null },
          { 'images.nsfw': false },
          { 'images.nsfw': 'false' },
          { 'images.nsfw': '' }
        ]
      }
    });
  }

  if (seenIdsForExclusion.length > 0) {
    countPipeline.push({
      $match: { chatId: { $nin: seenIdsForExclusion } }
    });
  }

  // Add search scoring to count pipeline if query exists
  if (hasQuery) {
    const scoreExpressions = queryWords.map(word => ({
      $cond: [
        {
          $or: [
            { $regexMatch: { input: { $ifNull: ['$images.prompt', ''] }, regex: new RegExp(word, 'i') } },
            { $regexMatch: { input: { $ifNull: ['$chat.name', ''] }, regex: new RegExp(word, 'i') } },
            { $regexMatch: { input: { $ifNull: ['$chat.description', ''] }, regex: new RegExp(word, 'i') } },
            { $regexMatch: { input: { $ifNull: ['$chat.first_message', ''] }, regex: new RegExp(word, 'i') } },
            { $regexMatch: { input: { $ifNull: ['$chat.nickname', ''] }, regex: new RegExp(word, 'i') } },
            {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: { $ifNull: ['$chat.tags', []] },
                      cond: { $regexMatch: { input: '$$this', regex: new RegExp(word, 'i') } }
                    }
                  }
                },
                0
              ]
            }
          ]
        },
        1,
        0
      ]
    }));

    countPipeline.push({
      $addFields: {
        matchScore: { $sum: scoreExpressions }
      }
    });
    countPipeline.push({ $match: { matchScore: { $gt: 0 } } });
  }

  countPipeline.push({ $group: { _id: '$chatId' } });
  countPipeline.push({ $count: 'total' });

  // Helper function to run the pipeline with optional fallback
  async function runPipelineWithFallback(mainPipeline, countPipeline, excludedSeenChars) {
    let [characters, countResult] = await Promise.all([
      chatsGalleryCollection.aggregate(mainPipeline).toArray(),
      chatsGalleryCollection.aggregate(countPipeline).toArray()
    ]);

    // FALLBACK: If no results found and we excluded seen characters, try again without exclusion
    if (characters.length === 0 && excludedSeenChars) {
      console.log('[gallery-search-utils] No results with seen exclusion, retrying without exclusion filter');
      
      // Remove the $nin exclusion stage from both pipelines
      const pipelineWithoutExclusion = mainPipeline.filter(stage => {
        if (stage.$match && stage.$match.chatId && stage.$match.chatId.$nin) {
          return false;
        }
        return true;
      });
      const countPipelineWithoutExclusion = countPipeline.filter(stage => {
        if (stage.$match && stage.$match.chatId && stage.$match.chatId.$nin) {
          return false;
        }
        return true;
      });
      
      [characters, countResult] = await Promise.all([
        chatsGalleryCollection.aggregate(pipelineWithoutExclusion).toArray(),
        chatsGalleryCollection.aggregate(countPipelineWithoutExclusion).toArray()
      ]);
      console.log(`[gallery-search-utils] Fallback query returned ${characters.length} characters`);
    }

    return { characters, countResult };
  }

  try {
    const { characters, countResult } = await runPipelineWithFallback(
      pipeline, 
      countPipeline, 
      seenIdsForExclusion.length > 0
    );

    console.log(`[gallery-search-utils] Query returned ${characters.length} characters, totalCount: ${countResult.length ? countResult[0].total : 0}`);

    // ADDITIONAL FALLBACK: If still no results, try without language filter at all
    let finalCharacters = characters;
    let finalTotalCharacters = countResult.length ? countResult[0].total : 0;
    
    if (characters.length === 0) {
      console.log('[gallery-search-utils] No results even after fallback, trying without language filter');
      
      // Build a minimal pipeline without language restrictions and permissive visibility
      const minimalPipeline = [
        { $unwind: '$images' },
        { $match: { 'images.imageUrl': { $exists: true, $ne: null } } }
      ];
      
      // NSFW filtering in minimal pipeline - respect user preference
      if (!showNSFW) {
        minimalPipeline.push({
          $match: {
            $or: [
              { 'images.nsfw': { $exists: false } },
              { 'images.nsfw': null },
              { 'images.nsfw': false },
              { 'images.nsfw': 'false' },
              { 'images.nsfw': '' }
            ]
          }
        });
      }
      
      minimalPipeline.push(
        {
          $lookup: {
            from: 'chats',
            localField: 'chatId',
            foreignField: '_id',
            as: 'chat'
          }
        },
        { $unwind: '$chat' },
        // Accept public visibility OR no visibility field (legacy chats)
        { 
          $match: { 
            $or: [
              { 'chat.visibility': 'public' },
              { 'chat.visibility': { $exists: false } },
              { 'chat.visibility': null }
            ]
          } 
        },
        {
          $group: {
            _id: '$chatId',
            chatId: { $first: '$chatId' },
            chatName: { $first: '$chat.name' },
            chatSlug: { $first: '$chat.slug' },
            chatImageUrl: { $first: '$chat.chatImageUrl' },
            chatTags: { $first: '$chat.tags' },
            description: { $first: '$chat.description' },
            gender: { $first: '$chat.gender' },
            chatCreatedAt: { $first: '$chat.createdAt' },
            images: {
              $push: {
                _id: '$images._id',
                imageUrl: '$images.imageUrl',
                thumbnailUrl: '$images.thumbnailUrl',
                prompt: '$images.prompt',
                title: '$images.title',
                nsfw: '$images.nsfw',
                createdAt: '$images.createdAt',
                imageModelId: '$images.imageModelId'
              }
            },
            imageCount: { $sum: 1 },
            latestImage: { $max: '$images.createdAt' }
          }
        },
        { $addFields: { rand: { $rand: {} } } },
        { $sort: { rand: 1, latestImage: -1 } },
        { $limit: limit * 3 },
        {
          $project: {
            _id: 0,
            chatId: 1,
            chatName: 1,
            chatSlug: 1,
            chatImageUrl: { $ifNull: ['$chatImageUrl', '/img/default-thumbnail.png'] },
            chatTags: { $ifNull: ['$chatTags', []] },
            description: 1,
            gender: { $ifNull: ['$gender', 'unknown'] },
            chatCreatedAt: 1,
            imageCount: 1,
            images: { $slice: ['$images', 20] },
            latestImage: 1
          }
        }
      );
      
      const minimalResults = await chatsGalleryCollection.aggregate(minimalPipeline).toArray();
      console.log(`[gallery-search-utils] Minimal pipeline (no language filter) returned ${minimalResults.length} characters`);
      
      if (minimalResults.length > 0) {
        finalCharacters = minimalResults.slice(0, limit);
        finalTotalCharacters = minimalResults.length;
      }
    }

    const totalCharacters = finalTotalCharacters;
    
    // Apply smart sequencing for page 1 without query
    if (useSmartSequencing && finalCharacters.length > 0) {
      // Get user preferences from nightly analysis cache (for logged-in users)
      let userPreferences = null;
      if (user && !user.isTemporary) {
        userPreferences = await getUserPreferencesFromCache(db, user._id);
      }
      
      // Apply weighted randomness, diversity, and personalization
      const sequencingTimeConstants = user && user.isTemporary ? {
        RECENTLY_SEEN: 30 * 60 * 1000,      // 30 minutes
        SHORT_TERM: 6 * 60 * 60 * 1000,     // 6 hours
        MEDIUM_TERM: 7 * 24 * 60 * 60 * 1000, // 1 week
        FRESH_CONTENT: 7 * 24 * 60 * 60 * 1000,
        OLD_CONTENT: 90 * 24 * 60 * 60 * 1000,
        MIDDLE_CONTENT: 30 * 24 * 60 * 60 * 1000,
      } : undefined;

      finalCharacters = await sequenceCharacters(finalCharacters, interactionState, {
        limit,
        excludeRecent: true,
        useDiversity: true,
        userPreferences,
        timeConstants: sequencingTimeConstants
      });
    }
    
    const hasMore = (page * limit) < totalCharacters;

    return {
      characters: finalCharacters,
      page,
      totalCharacters,
      hasMore
    };
  } catch (err) {
    console.error('[gallery-search-utils] Error in searchImagesGroupedByCharacter:', err);
    throw err;
  }
}

module.exports = {
  buildSearchPipeline,
  buildCountPipeline,
  buildVideoSearchPipeline,
  buildVideoCountPipeline,
  processImageResults,
  processVideoResults,
  searchImages,
  searchVideos,
  searchImagesGroupedByCharacter
};
