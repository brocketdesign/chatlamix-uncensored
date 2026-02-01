/**
 * Analytics Utilities
 * Comprehensive analytics calculations for creator dashboard
 * Phase 5: Content & Traffic Features
 */

const { ObjectId } = require('mongodb');

/**
 * Time period constants
 */
const TIME_PERIODS = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  LAST_7_DAYS: 'last_7_days',
  LAST_30_DAYS: 'last_30_days',
  LAST_90_DAYS: 'last_90_days',
  THIS_MONTH: 'this_month',
  LAST_MONTH: 'last_month',
  THIS_YEAR: 'this_year',
  ALL_TIME: 'all_time'
};

/**
 * Get date range for a time period
 * @param {string} period - Time period constant
 * @param {string} timezone - User's timezone (default: UTC)
 * @returns {Object} { startDate, endDate }
 */
function getDateRange(period, timezone = 'UTC') {
  const now = new Date();
  let startDate, endDate;

  switch (period) {
    case TIME_PERIODS.TODAY:
      startDate = new Date(now.setHours(0, 0, 0, 0));
      endDate = new Date();
      break;
    case TIME_PERIODS.YESTERDAY:
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setHours(23, 59, 59, 999);
      break;
    case TIME_PERIODS.LAST_7_DAYS:
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      break;
    case TIME_PERIODS.LAST_30_DAYS:
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      break;
    case TIME_PERIODS.LAST_90_DAYS:
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 90);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      break;
    case TIME_PERIODS.THIS_MONTH:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date();
      break;
    case TIME_PERIODS.LAST_MONTH:
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      break;
    case TIME_PERIODS.THIS_YEAR:
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date();
      break;
    case TIME_PERIODS.ALL_TIME:
    default:
      startDate = new Date(2020, 0, 1); // Platform start date
      endDate = new Date();
      break;
  }

  return { startDate, endDate };
}

/**
 * Get post performance metrics
 * @param {Object} db - Database connection
 * @param {string} userId - User ID
 * @param {Object} options - Filter options
 * @returns {Object} Post performance metrics
 */
async function getPostMetrics(db, userId, options = {}) {
  const { period = TIME_PERIODS.LAST_30_DAYS, postType } = options;
  const { startDate, endDate } = getDateRange(period);

  const matchQuery = {
    userId: new ObjectId(userId),
    createdAt: { $gte: startDate, $lte: endDate }
  };

  if (postType) {
    matchQuery.type = postType;
  }

  // Get unified posts metrics
  const unifiedPostsMetrics = await db.collection('unifiedPosts').aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: null,
        totalPosts: { $sum: 1 },
        totalViews: { $sum: { $ifNull: ['$views', 0] } },
        totalLikes: { $sum: { $ifNull: ['$likes', 0] } },
        totalComments: { $sum: { $size: { $ifNull: ['$comments', []] } } },
        avgViews: { $avg: { $ifNull: ['$views', 0] } },
        avgLikes: { $avg: { $ifNull: ['$likes', 0] } },
        publishedPosts: {
          $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] }
        },
        scheduledPosts: {
          $sum: { $cond: [{ $eq: ['$status', 'scheduled'] }, 1, 0] }
        },
        draftPosts: {
          $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] }
        }
      }
    }
  ]).toArray();

  // Get social posts metrics
  const socialPostsMetrics = await db.collection('socialPosts').aggregate([
    {
      $match: {
        userId: new ObjectId(userId),
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalSocialPosts: { $sum: 1 },
        publishedSocialPosts: {
          $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] }
        }
      }
    }
  ]).toArray();

  const unified = unifiedPostsMetrics[0] || {
    totalPosts: 0,
    totalViews: 0,
    totalLikes: 0,
    totalComments: 0,
    avgViews: 0,
    avgLikes: 0,
    publishedPosts: 0,
    scheduledPosts: 0,
    draftPosts: 0
  };

  const social = socialPostsMetrics[0] || {
    totalSocialPosts: 0,
    publishedSocialPosts: 0
  };

  return {
    ...unified,
    ...social,
    engagementRate: unified.totalViews > 0 
      ? ((unified.totalLikes + unified.totalComments) / unified.totalViews * 100).toFixed(2)
      : 0
  };
}

/**
 * Get post performance over time (for charts)
 * @param {Object} db - Database connection
 * @param {string} userId - User ID
 * @param {Object} options - Filter options
 * @returns {Array} Daily post metrics
 */
async function getPostMetricsOverTime(db, userId, options = {}) {
  const { period = TIME_PERIODS.LAST_30_DAYS, granularity = 'day' } = options;
  const { startDate, endDate } = getDateRange(period);

  let dateFormat;
  switch (granularity) {
    case 'hour':
      dateFormat = { $dateToString: { format: '%Y-%m-%d %H:00', date: '$createdAt' } };
      break;
    case 'week':
      dateFormat = { $dateToString: { format: '%Y-W%V', date: '$createdAt' } };
      break;
    case 'month':
      dateFormat = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
      break;
    case 'day':
    default:
      dateFormat = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
      break;
  }

  const metrics = await db.collection('unifiedPosts').aggregate([
    {
      $match: {
        userId: new ObjectId(userId),
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: dateFormat,
        posts: { $sum: 1 },
        views: { $sum: { $ifNull: ['$views', 0] } },
        likes: { $sum: { $ifNull: ['$likes', 0] } },
        comments: { $sum: { $size: { $ifNull: ['$comments', []] } } }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  return metrics.map(m => ({
    date: m._id,
    posts: m.posts,
    views: m.views,
    likes: m.likes,
    comments: m.comments
  }));
}

/**
 * Get top performing posts
 * @param {Object} db - Database connection
 * @param {string} userId - User ID
 * @param {Object} options - Filter options
 * @returns {Array} Top performing posts
 */
async function getTopPerformingPosts(db, userId, options = {}) {
  const { period = TIME_PERIODS.LAST_30_DAYS, limit = 10, sortBy = 'views' } = options;
  const { startDate, endDate } = getDateRange(period);

  const sortField = sortBy === 'likes' ? 'likes' 
    : sortBy === 'engagement' ? 'engagementScore'
    : 'views';

  const posts = await db.collection('unifiedPosts').aggregate([
    {
      $match: {
        userId: new ObjectId(userId),
        createdAt: { $gte: startDate, $lte: endDate },
        status: 'published'
      }
    },
    {
      $addFields: {
        engagementScore: {
          $add: [
            { $ifNull: ['$likes', 0] },
            { $multiply: [{ $size: { $ifNull: ['$comments', []] } }, 2] }
          ]
        }
      }
    },
    { $sort: { [sortField]: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        type: 1,
        content: 1,
        views: { $ifNull: ['$views', 0] },
        likes: { $ifNull: ['$likes', 0] },
        comments: { $size: { $ifNull: ['$comments', []] } },
        engagementScore: 1,
        createdAt: 1,
        publishedAt: 1
      }
    }
  ]).toArray();

  return posts;
}

/**
 * Get subscriber growth metrics
 * @param {Object} db - Database connection
 * @param {string} creatorId - Creator user ID
 * @param {Object} options - Filter options
 * @returns {Object} Subscriber metrics
 */
async function getSubscriberMetrics(db, creatorId, options = {}) {
  const { period = TIME_PERIODS.LAST_30_DAYS } = options;
  const { startDate, endDate } = getDateRange(period);

  // Get current subscribers count
  const totalSubscribers = await db.collection('subscriptions').countDocuments({
    creatorId: new ObjectId(creatorId),
    status: 'active'
  });

  // Get new subscribers in period
  const newSubscribers = await db.collection('subscriptions').countDocuments({
    creatorId: new ObjectId(creatorId),
    startDate: { $gte: startDate, $lte: endDate }
  });

  // Get churned subscribers in period
  const churnedSubscribers = await db.collection('subscriptions').countDocuments({
    creatorId: new ObjectId(creatorId),
    cancelledAt: { $gte: startDate, $lte: endDate },
    status: { $in: ['cancelled', 'expired'] }
  });

  // Get subscribers by tier
  const subscribersByTier = await db.collection('subscriptions').aggregate([
    {
      $match: {
        creatorId: new ObjectId(creatorId),
        status: 'active'
      }
    },
    {
      $group: {
        _id: '$tierId',
        count: { $sum: 1 }
      }
    },
    {
      $lookup: {
        from: 'creatorTiers',
        localField: '_id',
        foreignField: '_id',
        as: 'tier'
      }
    },
    { $unwind: { path: '$tier', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        tierId: '$_id',
        tierName: { $ifNull: ['$tier.name', 'Free'] },
        tierPrice: { $ifNull: ['$tier.price', 0] },
        count: 1
      }
    }
  ]).toArray();

  // Calculate churn rate
  const startingSubscribers = totalSubscribers - newSubscribers + churnedSubscribers;
  const churnRate = startingSubscribers > 0 
    ? ((churnedSubscribers / startingSubscribers) * 100).toFixed(2) 
    : 0;

  return {
    totalSubscribers,
    newSubscribers,
    churnedSubscribers,
    churnRate,
    netGrowth: newSubscribers - churnedSubscribers,
    subscribersByTier
  };
}

/**
 * Get subscriber growth over time (for charts)
 * @param {Object} db - Database connection
 * @param {string} creatorId - Creator user ID
 * @param {Object} options - Filter options
 * @returns {Array} Daily subscriber metrics
 */
async function getSubscriberGrowthOverTime(db, creatorId, options = {}) {
  const { period = TIME_PERIODS.LAST_30_DAYS } = options;
  const { startDate, endDate } = getDateRange(period);

  const growth = await db.collection('subscriptions').aggregate([
    {
      $match: {
        creatorId: new ObjectId(creatorId),
        startDate: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$startDate' } },
        newSubscribers: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  // Get cancellations
  const cancellations = await db.collection('subscriptions').aggregate([
    {
      $match: {
        creatorId: new ObjectId(creatorId),
        cancelledAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$cancelledAt' } },
        cancellations: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  // Merge data
  const dateMap = new Map();
  
  growth.forEach(g => {
    dateMap.set(g._id, { date: g._id, newSubscribers: g.newSubscribers, cancellations: 0 });
  });

  cancellations.forEach(c => {
    if (dateMap.has(c._id)) {
      dateMap.get(c._id).cancellations = c.cancellations;
    } else {
      dateMap.set(c._id, { date: c._id, newSubscribers: 0, cancellations: c.cancellations });
    }
  });

  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get revenue metrics
 * @param {Object} db - Database connection
 * @param {string} creatorId - Creator user ID
 * @param {Object} options - Filter options
 * @returns {Object} Revenue metrics
 */
async function getRevenueMetrics(db, creatorId, options = {}) {
  const { period = TIME_PERIODS.LAST_30_DAYS } = options;
  const { startDate, endDate } = getDateRange(period);

  // Get earnings for the period
  const earnings = await db.collection('creatorEarnings').aggregate([
    {
      $match: {
        creatorId: new ObjectId(creatorId),
        periodStart: { $gte: startDate },
        periodEnd: { $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalGross: { $sum: '$grossRevenue' },
        totalNet: { $sum: '$netRevenue' },
        totalSubscriptions: { $sum: '$subscriptionRevenue' },
        totalTips: { $sum: '$tipsRevenue' },
        totalFees: { $sum: '$platformFee' }
      }
    }
  ]).toArray();

  const result = earnings[0] || {
    totalGross: 0,
    totalNet: 0,
    totalSubscriptions: 0,
    totalTips: 0,
    totalFees: 0
  };

  // Get pending payouts
  const pendingPayouts = await db.collection('creatorEarnings').aggregate([
    {
      $match: {
        creatorId: new ObjectId(creatorId),
        status: 'pending'
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$netRevenue' }
      }
    }
  ]).toArray();

  result.pendingPayouts = pendingPayouts[0]?.total || 0;

  return result;
}

/**
 * Get revenue over time (for charts)
 * @param {Object} db - Database connection
 * @param {string} creatorId - Creator user ID
 * @param {Object} options - Filter options
 * @returns {Array} Daily revenue metrics
 */
async function getRevenueOverTime(db, creatorId, options = {}) {
  const { period = TIME_PERIODS.LAST_30_DAYS, granularity = 'day' } = options;
  const { startDate, endDate } = getDateRange(period);

  let dateFormat;
  switch (granularity) {
    case 'week':
      dateFormat = { $dateToString: { format: '%Y-W%V', date: '$periodStart' } };
      break;
    case 'month':
      dateFormat = { $dateToString: { format: '%Y-%m', date: '$periodStart' } };
      break;
    case 'day':
    default:
      dateFormat = { $dateToString: { format: '%Y-%m-%d', date: '$periodStart' } };
      break;
  }

  const revenue = await db.collection('creatorEarnings').aggregate([
    {
      $match: {
        creatorId: new ObjectId(creatorId),
        periodStart: { $gte: startDate },
        periodEnd: { $lte: endDate }
      }
    },
    {
      $group: {
        _id: dateFormat,
        gross: { $sum: '$grossRevenue' },
        net: { $sum: '$netRevenue' },
        subscriptions: { $sum: '$subscriptionRevenue' },
        tips: { $sum: '$tipsRevenue' }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  return revenue.map(r => ({
    date: r._id,
    gross: r.gross,
    net: r.net,
    subscriptions: r.subscriptions,
    tips: r.tips
  }));
}

/**
 * Get follower metrics
 * @param {Object} db - Database connection
 * @param {string} userId - User ID
 * @param {Object} options - Filter options
 * @returns {Object} Follower metrics
 */
async function getFollowerMetrics(db, userId, options = {}) {
  const { period = TIME_PERIODS.LAST_30_DAYS } = options;
  const { startDate, endDate } = getDateRange(period);

  // Get total followers
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(userId) },
    { projection: { followers: 1 } }
  );

  const totalFollowers = user?.followers?.length || 0;

  // Get new followers in period (if we track follow dates)
  // This would require a separate follows collection with timestamps
  // For now, we'll estimate based on user creation dates of followers
  let newFollowers = 0;
  if (user?.followers?.length > 0) {
    const followerIds = user.followers.map(f => 
      f instanceof ObjectId ? f : new ObjectId(f)
    );
    
    newFollowers = await db.collection('users').countDocuments({
      _id: { $in: followerIds },
      createdAt: { $gte: startDate, $lte: endDate }
    });
  }

  // Get following count
  const following = user?.following?.length || 0;

  return {
    totalFollowers,
    newFollowers,
    following,
    followerRatio: following > 0 ? (totalFollowers / following).toFixed(2) : totalFollowers
  };
}

/**
 * Get audience demographics
 * @param {Object} db - Database connection
 * @param {string} creatorId - Creator user ID
 * @returns {Object} Audience demographics
 */
async function getAudienceDemographics(db, creatorId) {
  // Get subscriber user IDs
  const subscriptions = await db.collection('subscriptions').find({
    creatorId: new ObjectId(creatorId),
    status: 'active'
  }, { projection: { subscriberId: 1 } }).toArray();

  const subscriberIds = subscriptions.map(s => s.subscriberId);

  if (subscriberIds.length === 0) {
    return {
      total: 0,
      byGender: [],
      byCountry: [],
      byAge: []
    };
  }

  // Get gender distribution
  const byGender = await db.collection('users').aggregate([
    { $match: { _id: { $in: subscriberIds } } },
    {
      $group: {
        _id: { $ifNull: ['$gender', 'unknown'] },
        count: { $sum: 1 }
      }
    }
  ]).toArray();

  // Get country distribution (if available)
  const byCountry = await db.collection('users').aggregate([
    { $match: { _id: { $in: subscriberIds } } },
    {
      $group: {
        _id: { $ifNull: ['$country', 'unknown'] },
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]).toArray();

  // Get age distribution (if birth year available)
  const currentYear = new Date().getFullYear();
  const byAge = await db.collection('users').aggregate([
    { $match: { _id: { $in: subscriberIds }, 'birthDate.year': { $exists: true } } },
    {
      $addFields: {
        age: { $subtract: [currentYear, '$birthDate.year'] }
      }
    },
    {
      $bucket: {
        groupBy: '$age',
        boundaries: [0, 18, 25, 35, 45, 55, 65, 100],
        default: 'unknown',
        output: { count: { $sum: 1 } }
      }
    }
  ]).toArray();

  return {
    total: subscriberIds.length,
    byGender: byGender.map(g => ({ gender: g._id, count: g.count })),
    byCountry: byCountry.map(c => ({ country: c._id, count: c.count })),
    byAge: byAge.map(a => ({ 
      range: a._id === 'unknown' ? 'Unknown' : `${a._id}-${a._id + 9}`,
      count: a.count 
    }))
  };
}


/**
 * Get comprehensive creator analytics dashboard data
 * @param {Object} db - Database connection
 * @param {string} creatorId - Creator user ID
 * @param {Object} options - Filter options
 * @returns {Object} Complete analytics data
 */
async function getCreatorDashboardAnalytics(db, creatorId, options = {}) {
  const { period = TIME_PERIODS.LAST_30_DAYS } = options;

  try {
    const [
      postMetrics,
      postMetricsOverTime,
      topPosts,
      subscriberMetrics,
      subscriberGrowth,
      revenueMetrics,
      revenueOverTime,
      followerMetrics,
      demographics
    ] = await Promise.all([
      getPostMetrics(db, creatorId, { period }),
      getPostMetricsOverTime(db, creatorId, { period }),
      getTopPerformingPosts(db, creatorId, { period, limit: 5 }),
      getSubscriberMetrics(db, creatorId, { period }),
      getSubscriberGrowthOverTime(db, creatorId, { period }),
      getRevenueMetrics(db, creatorId, { period }),
      getRevenueOverTime(db, creatorId, { period }),
      getFollowerMetrics(db, creatorId, { period }),
      getAudienceDemographics(db, creatorId)
    ]);

    return {
      period,
      posts: postMetrics,
      postsOverTime: postMetricsOverTime,
      topPosts,
      subscribers: subscriberMetrics,
      subscriberGrowth,
      revenue: revenueMetrics,
      revenueOverTime,
      followers: followerMetrics,
      demographics,
      generatedAt: new Date()
    };
  } catch (error) {
    console.error('[Analytics] Error getting dashboard analytics:', error);
    throw error;
  }
}

/**
 * Track post view
 * @param {Object} db - Database connection
 * @param {string} postId - Post ID
 * @param {string} viewerId - Viewer user ID (optional)
 */
async function trackPostView(db, postId, viewerId = null) {
  try {
    // Increment view count on the post
    await db.collection('unifiedPosts').updateOne(
      { _id: new ObjectId(postId) },
      { $inc: { views: 1 } }
    );

    // Log the view for detailed analytics (optional)
    await db.collection('postViews').insertOne({
      postId: new ObjectId(postId),
      viewerId: viewerId ? new ObjectId(viewerId) : null,
      viewedAt: new Date()
    });
  } catch (error) {
    console.error('[Analytics] Error tracking post view:', error);
  }
}

/**
 * Get schedule statistics
 * @param {Object} db - Database connection
 * @param {string} userId - User ID
 * @param {Object} options - Filter options
 * @returns {Object} Schedule metrics
 */
async function getScheduleMetrics(db, userId, options = {}) {
  const { period = TIME_PERIODS.LAST_30_DAYS } = options;
  const { startDate, endDate } = getDateRange(period);

  const stats = await db.collection('schedules').aggregate([
    {
      $match: {
        userId: new ObjectId(userId),
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]).toArray();

  const result = {
    total: 0,
    pending: 0,
    active: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    paused: 0
  };

  stats.forEach(s => {
    result[s._id] = s.count;
    result.total += s.count;
  });

  // Get success rate
  const totalExecuted = result.completed + result.failed;
  result.successRate = totalExecuted > 0 
    ? ((result.completed / totalExecuted) * 100).toFixed(2)
    : 100;

  return result;
}

/**
 * Get content type distribution
 * @param {Object} db - Database connection
 * @param {string} userId - User ID
 * @param {Object} options - Filter options
 * @returns {Array} Content type distribution
 */
async function getContentTypeDistribution(db, userId, options = {}) {
  const { period = TIME_PERIODS.LAST_30_DAYS } = options;
  const { startDate, endDate } = getDateRange(period);

  const distribution = await db.collection('unifiedPosts').aggregate([
    {
      $match: {
        userId: new ObjectId(userId),
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        views: { $sum: { $ifNull: ['$views', 0] } },
        likes: { $sum: { $ifNull: ['$likes', 0] } }
      }
    }
  ]).toArray();

  return distribution.map(d => ({
    type: d._id,
    count: d.count,
    views: d.views,
    likes: d.likes,
    avgEngagement: d.count > 0 ? ((d.likes / d.count)).toFixed(2) : 0
  }));
}

module.exports = {
  TIME_PERIODS,
  getDateRange,
  getPostMetrics,
  getPostMetricsOverTime,
  getTopPerformingPosts,
  getSubscriberMetrics,
  getSubscriberGrowthOverTime,
  getRevenueMetrics,
  getRevenueOverTime,
  getFollowerMetrics,
  getAudienceDemographics,
  getCreatorDashboardAnalytics,
  trackPostView,
  getScheduleMetrics,
  getContentTypeDistribution
};
