const { ObjectId } = require('mongodb');

// Time constants for conversion tracking and rate limiting
const CONVERSION_WINDOW_MS = 24 * 60 * 60 * 1000;  // 24 hours - window to attribute conversion to upsell
const ONE_HOUR_MS = 60 * 60 * 1000;                 // 1 hour - for rate limiting upsell displays
const THIRTY_MINUTES_MS = 30 * 60 * 1000;           // 30 minutes - cooldown after dismissal

/**
 * Records an NSFW push detection event for analytics
 * @param {Object} db - MongoDB database instance
 * @param {ObjectId} userId - User ID
 * @param {ObjectId} chatId - Chat ID
 * @param {Object} nsfwResult - Result from checkNsfwPush
 * @param {boolean} isPremium - Whether the user is premium
 * @param {boolean} upsellShown - Whether the upsell was shown
 */
async function recordNsfwPushEvent(db, userId, chatId, nsfwResult, isPremium, upsellShown = false) {
  try {
    const collection = db.collection('nsfw_push_events');
    
    await collection.insertOne({
      userId: new ObjectId(userId),
      chatId: chatId ? new ObjectId(chatId) : null,
      isPremium,
      upsellShown,
      nsfwScore: nsfwResult.nsfw_score,
      nsfwCategory: nsfwResult.nsfw_category,
      escalationDetected: nsfwResult.escalation_detected,
      confidence: nsfwResult.confidence,
      createdAt: new Date(),
      convertedToPremium: false
    });
    
    return true;
  } catch (error) {
    console.error('[recordNsfwPushEvent] Error:', error);
    return false;
  }
}

/**
 * Records when a user converts to premium after NSFW upsell
 * @param {Object} db - MongoDB database instance
 * @param {ObjectId} userId - User ID
 */
async function recordNsfwUpsellConversion(db, userId) {
  try {
    const collection = db.collection('nsfw_push_events');
    
    // Find the most recent upsell shown for this user and mark as converted
    // Only attribute conversions within the conversion window
    await collection.updateMany(
      { 
        userId: new ObjectId(userId),
        upsellShown: true,
        convertedToPremium: false,
        createdAt: { $gte: new Date(Date.now() - CONVERSION_WINDOW_MS) }
      },
      { 
        $set: { 
          convertedToPremium: true,
          convertedAt: new Date()
        }
      }
    );
    
    return true;
  } catch (error) {
    console.error('[recordNsfwUpsellConversion] Error:', error);
    return false;
  }
}

/**
 * Records when a user dismisses the NSFW upsell modal
 * @param {Object} db - MongoDB database instance
 * @param {ObjectId} userId - User ID
 * @param {string} action - 'dismissed' or 'stay_sfw'
 */
async function recordNsfwUpsellDismissal(db, userId, action = 'dismissed') {
  try {
    const collection = db.collection('nsfw_upsell_dismissals');
    
    await collection.insertOne({
      userId: new ObjectId(userId),
      action,
      createdAt: new Date()
    });
    
    return true;
  } catch (error) {
    console.error('[recordNsfwUpsellDismissal] Error:', error);
    return false;
  }
}

/**
 * Checks how many times user has been shown upsell in current session
 * Used to avoid showing upsell too frequently
 * @param {Object} db - MongoDB database instance
 * @param {ObjectId} userId - User ID
 * @param {number} hoursBack - Number of hours to look back (default 1 hour)
 */
async function getRecentUpsellCount(db, userId, hoursBack = 1) {
  try {
    const collection = db.collection('nsfw_push_events');
    
    const count = await collection.countDocuments({
      userId: new ObjectId(userId),
      upsellShown: true,
      createdAt: { $gte: new Date(Date.now() - hoursBack * 60 * 60 * 1000) }
    });
    
    return count;
  } catch (error) {
    console.error('[getRecentUpsellCount] Error:', error);
    return 0;
  }
}

/**
 * Checks if user has dismissed upsell recently
 * @param {Object} db - MongoDB database instance
 * @param {ObjectId} userId - User ID
 * @param {number} minutesBack - Minutes to look back (default 30)
 */
async function hasRecentDismissal(db, userId, minutesBack = 30) {
  try {
    const collection = db.collection('nsfw_upsell_dismissals');
    
    const recent = await collection.findOne({
      userId: new ObjectId(userId),
      createdAt: { $gte: new Date(Date.now() - minutesBack * 60 * 1000) }
    });
    
    return !!recent;
  } catch (error) {
    console.error('[hasRecentDismissal] Error:', error);
    return false;
  }
}

/**
 * Get NSFW push analytics for dashboard
 * @param {Object} db - MongoDB database instance
 * @param {string} period - 'last_7_days', 'last_30_days', 'last_90_days'
 */
async function getNsfwAnalytics(db, period = 'last_7_days') {
  try {
    const collection = db.collection('nsfw_push_events');
    const usersCollection = db.collection('users');
    
    const { startDate, endDate } = getDateRange(period);
    
    // Get admin user IDs to exclude
    const adminUsers = await usersCollection.find({ role: 'admin' }).project({ _id: 1 }).toArray();
    const adminUserIds = adminUsers.map(u => u._id);
    
    const matchFilter = {
      createdAt: { $gte: startDate, $lte: endDate },
      userId: { $nin: adminUserIds }
    };
    
    // Total NSFW push events
    const totalEvents = await collection.countDocuments(matchFilter);
    
    // Unique users with NSFW push
    const uniqueUsers = await collection.distinct('userId', matchFilter);
    
    // Events where upsell was shown
    const upsellShownCount = await collection.countDocuments({
      ...matchFilter,
      upsellShown: true
    });
    
    // Conversions after upsell
    const conversions = await collection.countDocuments({
      ...matchFilter,
      upsellShown: true,
      convertedToPremium: true
    });
    
    // Events by category
    const byCategory = await collection.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$nsfwCategory', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    
    // Events by day for trends
    const dailyTrends = await collection.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          total: { $sum: 1 },
          upsellShown: { $sum: { $cond: ['$upsellShown', 1, 0] } },
          conversions: { $sum: { $cond: ['$convertedToPremium', 1, 0] } }
        }
      },
      { $sort: { '_id': 1 } }
    ]).toArray();
    
    // Average NSFW score
    const avgScoreResult = await collection.aggregate([
      { $match: matchFilter },
      { $group: { _id: null, avgScore: { $avg: '$nsfwScore' } } }
    ]).toArray();
    const avgScore = avgScoreResult[0]?.avgScore || 0;
    
    // Free vs Premium users with NSFW push
    const premiumVsFree = await collection.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$isPremium', count: { $sum: 1 } } }
    ]).toArray();
    
    // Conversion rate
    const conversionRate = upsellShownCount > 0 ? (conversions / upsellShownCount * 100) : 0;
    
    return {
      totalEvents,
      uniqueUsers: uniqueUsers.length,
      upsellShownCount,
      conversions,
      conversionRate: conversionRate.toFixed(2),
      avgScore: avgScore.toFixed(1),
      byCategory: byCategory.map(c => ({ category: c._id || 'unknown', count: c.count })),
      dailyTrends: dailyTrends.map(d => ({
        date: d._id,
        total: d.total,
        upsellShown: d.upsellShown,
        conversions: d.conversions
      })),
      premiumVsFree: premiumVsFree.reduce((acc, p) => {
        acc[p._id ? 'premium' : 'free'] = p.count;
        return acc;
      }, { premium: 0, free: 0 })
    };
  } catch (error) {
    console.error('[getNsfwAnalytics] Error:', error);
    return {
      totalEvents: 0,
      uniqueUsers: 0,
      upsellShownCount: 0,
      conversions: 0,
      conversionRate: '0.00',
      avgScore: '0.0',
      byCategory: [],
      dailyTrends: [],
      premiumVsFree: { premium: 0, free: 0 }
    };
  }
}

/**
 * Get top users with NSFW push attempts
 * @param {Object} db - MongoDB database instance
 * @param {number} limit - Number of users to return
 * @param {string} period - Time period filter
 */
async function getTopNsfwPushUsers(db, limit = 10, period = 'last_7_days') {
  try {
    const collection = db.collection('nsfw_push_events');
    const usersCollection = db.collection('users');
    
    const { startDate, endDate } = getDateRange(period);
    
    // Get admin user IDs to exclude
    const adminUsers = await usersCollection.find({ role: 'admin' }).project({ _id: 1 }).toArray();
    const adminUserIds = adminUsers.map(u => u._id);
    
    const topUsers = await collection.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startDate, $lte: endDate },
          userId: { $nin: adminUserIds }
        } 
      },
      {
        $group: {
          _id: '$userId',
          count: { $sum: 1 },
          avgScore: { $avg: '$nsfwScore' },
          upsellShown: { $sum: { $cond: ['$upsellShown', 1, 0] } },
          converted: { $max: { $cond: ['$convertedToPremium', 1, 0] } }
        }
      },
      { $sort: { count: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          userId: '$_id',
          nickname: '$user.nickname',
          email: '$user.email',
          count: 1,
          avgScore: { $round: ['$avgScore', 1] },
          upsellShown: 1,
          converted: 1,
          isPremium: { $eq: ['$user.subscriptionStatus', 'active'] }
        }
      }
    ]).toArray();
    
    return topUsers;
  } catch (error) {
    console.error('[getTopNsfwPushUsers] Error:', error);
    return [];
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

module.exports = {
  recordNsfwPushEvent,
  recordNsfwUpsellConversion,
  recordNsfwUpsellDismissal,
  getRecentUpsellCount,
  hasRecentDismissal,
  getNsfwAnalytics,
  getTopNsfwPushUsers
};
