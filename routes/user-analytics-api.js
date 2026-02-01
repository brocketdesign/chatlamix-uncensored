const { ObjectId } = require('mongodb');
const { 
  getUserImageGenerationStats,
  getUserImageGenerationStatsByChat,
  getUserImageLikeStats,
  getUserImageLikeStatsByChat,
  debugUserImageStats,
  debugUserLikeStats
} = require('../models/user-analytics-utils');

async function routes(fastify, options) {

fastify.get('/user/:userId/image-stats', async (request, reply) => {
  try {
    const userId = new ObjectId(request.params.userId);
    const chatId = request.query.chatId; // Optional query parameter
    
    const db = fastify.mongo.db;
    const imagesGeneratedCollection = db.collection('images_generated');
    
    // Build the match filter
    let matchFilter = {
      userId: userId
    };
    
    // Add chatId filter if provided
    if (chatId && ObjectId.isValid(chatId)) {
      matchFilter.chatId = new ObjectId(chatId);
    }
    
    // Aggregate to sum generation counts
    const result = await imagesGeneratedCollection.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          totalImages: { $sum: '$generationCount' },
          totalEntries: { $sum: 1 } // Number of unique images
        }
      }
    ]).toArray();
    
    // If no images found
    if (result.length === 0) {
      return reply.send({
        userId,
        chatId: chatId || null,
        totalImages: 0,
        totalEntries: 0
      });
    }
    
    const stats = result[0];
    
    return reply.send({
      userId,
      chatId: chatId || null,
      totalImages: stats.totalImages, // Total generation count across all images
      totalEntries: stats.totalEntries // Number of unique images generated
    });
    
  } catch (err) {
    console.error('Error getting user image stats:', err);
    reply.code(500).send({ error: 'Internal Server Error' });
  }
});

  fastify.get('/user/:userId/analytics/images', async (request, reply) => {
    try {
      const userId = new ObjectId(request.params.userId);
      const db = fastify.mongo.db;
      
      const [totalStats, statsByChat] = await Promise.all([
        getUserImageGenerationStats(db, userId),
        getUserImageGenerationStatsByChat(db, userId)
      ]);
      
      return reply.send({
        userId,
        total: totalStats,
        byChat: statsByChat
      });
    } catch (err) {
      console.error('Error getting user image analytics:', err);
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.get('/user/:userId/analytics/likes', async (request, reply) => {
    try {
      const userId = new ObjectId(request.params.userId);
      const db = fastify.mongo.db;
      
      const [totalStats, statsByChat] = await Promise.all([
        getUserImageLikeStats(db, userId),
        getUserImageLikeStatsByChat(db, userId)
      ]);
      
      return reply.send({
        userId,
        total: totalStats,
        byChat: statsByChat
      });
    } catch (err) {
      console.error('Error getting user like analytics:', err);
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.post('/user/:userId/debug/image-stats', async (request, reply) => {
    try {
      const userId = new ObjectId(request.params.userId);
      const db = fastify.mongo.db;
      
      // Extract debug context from request body if available
      const debugContext = request.body || {};
      
      const debugData = await debugUserImageStats(db, userId, fastify, debugContext);
      
      return reply.send({
        message: 'Debug data logged successfully',
        data: debugData
      });
    } catch (err) {
      console.error('Error debugging user image stats:', err);
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.post('/user/:userId/debug/like-stats', async (request, reply) => {
    try {
      const userId = new ObjectId(request.params.userId);
      const db = fastify.mongo.db;
      
      // Extract debug context from request body if available
      const debugContext = request.body || {};
      
      const debugData = await debugUserLikeStats(db, userId, fastify, debugContext);
      
      return reply.send({
        message: 'Debug data logged successfully',
        data: debugData
      });
    } catch (err) {
      console.error('Error debugging user like stats:', err);
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  });
  
  fastify.get('/user/analytics/leaderboard/images', async (request, reply) => {
    try {
      const db = fastify.mongo.db;
      const usersCollection = db.collection('users');
      const imagesGeneratedCollection = db.collection('images_generated');
      const limit = Math.min(parseInt(request.query.limit) || 10, 50); // Default 10, max 50
      
      // Aggregate image generation stats by user
      const imageStats = await imagesGeneratedCollection.aggregate([
        {
          $group: {
            _id: '$userId',
            totalImages: { $sum: '$generationCount' },
            totalEntries: { $sum: 1 }
          }
        },
        {
          $sort: { totalImages: -1 }
        },
        {
          $limit: limit
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $unwind: '$user'
        },
        {
          $match: {
            'user.isTemporary': { $ne: true }
          }
        },
        {
          $project: {
            _id: '$user._id',
            nickname: '$user.nickname',
            profileUrl: '$user.profileUrl',
            totalImages: 1,
            totalEntries: 1,
            joinedDate: '$user.createdAt'
          }
        }
      ]).toArray();
      
      return reply.send({
        success: true,
        leaderboard: imageStats,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error getting image generation leaderboard:', err);
      reply.code(500).send({ 
        success: false,
        error: 'Internal Server Error' 
      });
    }
  });
  
  fastify.get('/admin/api/analytics/dashboard', async (request, reply) => {
    try {
      const db = fastify.mongo.db;
      const forceRefresh = request.query.refresh === 'true';
      const period = request.query.period || 'last_7_days';
      
      // Fetch analytics data from cache collection (unless force refresh)
      const analyticsCache = db.collection('analytics_cache');
      
      if (!forceRefresh) {
        const cachedData = await analyticsCache.findOne({ type: `dashboard_${period}` });
        
        if (cachedData && cachedData.data) {
          return reply.send({
            success: true,
            ...cachedData.data,
            lastUpdated: cachedData.updatedAt
          });
        }
      }
      
      console.log('[Dashboard Analytics] Calculating fresh data (forceRefresh:', forceRefresh, ', period:', period, ')');
      
      // Calculate fresh data
      const [stats, userGrowth, genderDist, nationalityDist, contentTrends, onboardingPreferences] = await Promise.all([
        calculateDashboardStats(db, period),
        calculateUserGrowth(db, period),
        calculateGenderDistribution(db, period),
        calculateNationalityDistribution(db, period),
        calculateContentTrends(db, period),
        calculateOnboardingPreferences(db, period)
      ]);
      
      const responseData = {
        success: true,
        stats,
        userGrowth,
        genderDistribution: genderDist,
        nationalityDistribution: nationalityDist,
        contentTrends,
        onboardingPreferences,
        lastUpdated: new Date().toISOString()
      };
      
      // Update cache with fresh data
      await analyticsCache.updateOne(
        { type: `dashboard_${period}` },
        { 
          $set: { 
            type: `dashboard_${period}`,
            data: responseData,
            updatedAt: new Date().toISOString()
          } 
        },
        { upsert: true }
      );
      
      return reply.send(responseData);
    } catch (err) {
      console.error('Error getting dashboard analytics:', err);
      reply.code(500).send({ 
        success: false,
        error: 'Internal Server Error' 
      });
    }
  });
}

// Helper functions for analytics calculations
async function calculateDashboardStats(db, period = 'last_7_days') {
  const usersCollection = db.collection('users');
  const subscriptionsCollection = db.collection('subscriptions');
  const imagesCollection = db.collection('images_generated');
  const userChatCollection = db.collection('userChat'); // Messages are in userChat, not a separate collection
  const likesCollection = db.collection('images_likes');
  
  const { startDate } = getDateRange(period);
  
  console.log('Calculating dashboard stats...');
  
  // Get admin user IDs to exclude from stats
  const adminUsers = await usersCollection.find({ role: 'admin' }).project({ _id: 1 }).toArray();
  const adminUserIds = adminUsers.map(u => u._id);
  console.log(`[calculateDashboardStats] Excluding ${adminUserIds.length} admin user(s) from stats`);
  
  // Count total messages from userChat collection (excluding admin users)
  const totalMessagesResult = await userChatCollection.aggregate([
    { $match: { userId: { $nin: adminUserIds } } }, // Exclude admin users
    { $unwind: '$messages' },
    { $count: 'total' }
  ]).toArray();
  
  const totalMessages = totalMessagesResult[0]?.total || 0;
  
  console.log('Total messages found:', totalMessages);
  
  const [
    totalUsers,
    newUsersLastWeek,
    totalImages,
    newImagesLastWeek,
    premiumUsers,
    totalLikes,
    usersWithImages
  ] = await Promise.all([
    usersCollection.countDocuments({ isTemporary: { $ne: true }, role: { $ne: 'admin' } }), // Exclude admins
    usersCollection.countDocuments({ createdAt: { $gte: startDate }, isTemporary: { $ne: true }, role: { $ne: 'admin' } }), // Exclude admins
    imagesCollection.aggregate([
      { $match: { userId: { $nin: adminUserIds } } }, // Exclude admin users
      { $group: { _id: null, total: { $sum: '$generationCount' } } }
    ]).toArray(),
    imagesCollection.aggregate([
      { $match: { createdAt: { $gte: startDate }, userId: { $nin: adminUserIds } } }, // Exclude admin users
      { $group: { _id: null, total: { $sum: '$generationCount' } } }
    ]).toArray(),
    subscriptionsCollection.countDocuments({ 
      subscriptionStatus: 'active', 
      subscriptionType: 'subscription' // Only count subscription type, not day-pass
    }),
    likesCollection.countDocuments({ userId: { $nin: adminUserIds } }), // Exclude admin users from likes
    imagesCollection.distinct('userId', { userId: { $nin: adminUserIds } }).then(arr => arr.length) // Exclude admin users from image generators
  ]);
  
  const totalImagesCount = totalImages[0]?.total || 0;
  const newImagesCount = newImagesLastWeek[0]?.total || 0;
  const prevTotalUsers = totalUsers - newUsersLastWeek;
  const prevTotalImages = totalImagesCount - newImagesCount;
  
  console.log('Message stats:', {
    totalMessages,
    totalUsers,
    avgMessagesPerUser: totalUsers > 0 ? (totalMessages / totalUsers) : 0
  });
  
  return {
    totalUsers,
    userGrowth: prevTotalUsers > 0 ? ((newUsersLastWeek / prevTotalUsers) * 100) : 0,
    totalImages: totalImagesCount,
    imageGrowth: prevTotalImages > 0 ? ((newImagesCount / prevTotalImages) * 100) : 0,
    totalMessages,
    messageGrowth: 0, // Cannot calculate growth without reliable timestamp
    avgMessagesPerUser: totalUsers > 0 ? (totalMessages / totalUsers) : 0,
    premiumUsers,
    totalLikes,
    activeImageGenerators: usersWithImages
  };
}

async function calculateUserGrowth(db, period = 'last_7_days') {
  const usersCollection = db.collection('users');
  const labels = [];
  const values = [];

  const { endDate } = getDateRange(period);
  const days = getPeriodDays(period);
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(endDate);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    
    const count = await usersCollection.countDocuments({
      createdAt: { $gte: date, $lt: nextDate },
      isTemporary: { $ne: true },
      role: { $ne: 'admin' }
    });
    
    labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    values.push(count);
  }
  
  return { labels, values };
}

async function calculateGenderDistribution(db, period = 'last_7_days') {
  const usersCollection = db.collection('users');
  const { startDate, endDate } = getDateRange(period);
  
  const distribution = await usersCollection.aggregate([
    { $match: { isTemporary: { $ne: true }, role: { $ne: 'admin' }, createdAt: { $gte: startDate, $lte: endDate } } },
    { $group: { _id: '$gender', count: { $sum: 1 } } }
  ]).toArray();
  
  const labels = [];
  const values = [];
  
  distribution.forEach(item => {
    labels.push(item._id || 'Unknown');
    values.push(item.count);
  });
  
  return { labels, values };
}

async function calculateNationalityDistribution(db, period = 'last_7_days') {
  const usersCollection = db.collection('users');
  const { startDate, endDate } = getDateRange(period);
  
  const distribution = await usersCollection.aggregate([
    { $match: { isTemporary: { $ne: true }, role: { $ne: 'admin' }, createdAt: { $gte: startDate, $lte: endDate } } },
    { $group: { _id: '$preferredChatLanguage', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]).toArray();
  
  const labels = [];
  const values = [];
  
  distribution.forEach(item => {
    labels.push(item._id || 'Unknown');
    values.push(item.count);
  });
  
  return { labels, values };
}

async function calculateContentTrends(db, period = 'last_7_days') {
  const galleryCollection = db.collection('gallery');
  const userChatCollection = db.collection('userChat');
  const usersCollection = db.collection('users');
  
  const labels = [];
  const images = [];
  const messages = [];
  
  // Get admin user IDs to exclude from stats
  const adminUsers = await usersCollection.find({ role: 'admin' }).project({ _id: 1 }).toArray();
  const adminUserIds = adminUsers.map(u => u._id);
  console.log(`[calculateContentTrends] Excluding ${adminUserIds.length} admin user(s) from stats`);
  
  // First, let's check what fields exist in messages
  const sampleChat = await userChatCollection.findOne({ 'messages.0': { $exists: true } });
  if (sampleChat && sampleChat.messages && sampleChat.messages.length > 0) {
    console.log('[calculateContentTrends] Sample message fields:', Object.keys(sampleChat.messages[0]));
    console.log('[calculateContentTrends] Sample message:', JSON.stringify(sampleChat.messages[sampleChat.messages.length - 1], null, 2));
  }
  
  const { endDate } = getDateRange(period);
  const days = getPeriodDays(period);

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(endDate);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    
    // Count images from gallery collection (excluding admin users)
    const imageCount = await galleryCollection.aggregate([
      { $match: { userId: { $nin: adminUserIds } } }, // Exclude admin users
      { $unwind: '$images' },
      { 
        $match: { 
          'images.createdAt': { $gte: date, $lt: nextDate }
        } 
      },
      { $count: 'total' }
    ]).toArray();
    
    // Count messages - try multiple approaches (excluding admin users)
    let messageCountValue = 0;
    
    // Try with createdAt field first (for new messages)
    const messageCountWithCreatedAt = await userChatCollection.aggregate([
      { $match: { userId: { $nin: adminUserIds } } }, // Exclude admin users
      { $unwind: '$messages' },
      { 
        $match: { 
          'messages.role': { $in: ['user', 'assistant'] },
          'messages.createdAt': { $exists: true, $gte: date, $lt: nextDate }
        } 
      },
      { $count: 'total' }
    ]).toArray();
    
    if (messageCountWithCreatedAt[0]?.total > 0) {
      messageCountValue = messageCountWithCreatedAt[0].total;
      console.log(`[calculateContentTrends] Found ${messageCountValue} messages with createdAt for ${date.toDateString()}`);
    }
    
    labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    images.push(imageCount[0]?.total || 0);
    messages.push(messageCountValue);
  }
  
  console.log('[calculateContentTrends] Final trend data:', { labels, images, messages });
  
  return { labels, images, messages };
}

function getPeriodDays(period) {
  switch (period) {
    case 'last_30_days':
      return 30;
    case 'last_90_days':
      return 90;
    case 'last_7_days':
    default:
      return 7;
  }
}

function getDateRange(period) {
  const now = new Date();
  const endDate = new Date(now);
  let startDate;

  switch (period) {
    case 'last_90_days':
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 90);
      break;
    case 'last_30_days':
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
      break;
    case 'last_7_days':
    default:
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      break;
  }

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  return { startDate, endDate };
}

async function calculateOnboardingPreferences(db, period = 'last_7_days') {
  const usersCollection = db.collection('users');
  const { startDate, endDate } = getDateRange(period);

  const matchUsers = {
    isTemporary: { $ne: true },
    role: { $ne: 'admin' },
    createdAt: { $gte: startDate, $lte: endDate }
  };

  const [byAgeRange, byLanguage, byVisualStyle, byCharacterGender, byCharacterTags] = await Promise.all([
    usersCollection.aggregate([
      { $match: matchUsers },
      { $group: { _id: { $ifNull: ['$ageRange', 'unknown'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray(),
    usersCollection.aggregate([
      { $match: matchUsers },
      { $group: { _id: { $ifNull: ['$preferredChatLanguage', 'unknown'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray(),
    usersCollection.aggregate([
      { $match: matchUsers },
      { $group: { _id: { $ifNull: ['$preferredImageStyle', 'unknown'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray(),
    usersCollection.aggregate([
      { $match: matchUsers },
      { $group: { _id: { $ifNull: ['$preferredCharacterGender', 'unknown'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray(),
    usersCollection.aggregate([
      { $match: { ...matchUsers, preferredTags: { $exists: true, $ne: [] } } },
      { $unwind: '$preferredTags' },
      { $match: { preferredTags: { $nin: [null, ''] } } },
      { $group: { _id: { $toLower: '$preferredTags' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]).toArray()
  ]);

  return {
    byAgeRange: byAgeRange.map(a => ({ range: a._id, count: a.count })),
    byLanguage: byLanguage.map(l => ({ language: l._id, count: l.count })),
    byVisualStyle: byVisualStyle.map(s => ({ style: s._id, count: s.count })),
    byCharacterGender: byCharacterGender.map(g => ({ gender: g._id, count: g.count })),
    byCharacterTags: byCharacterTags.map(t => ({ tag: t._id, count: t.count }))
  };
}

module.exports = routes;