const { ObjectId } = require('mongodb');
const https = require('https');
const http = require('http');

/**
 * User Behavior Tracking Utilities
 * 
 * This module handles tracking of user behaviors for analytics:
 * - Start Chat: When a user initiates a chat
 * - Message Sent: When a user sends a message
 * - Premium View: When the premium modal is displayed
 * - User Location: Geographic location based on IP
 */

// Collection name for behavior tracking
const TRACKING_COLLECTION = 'user_behavior_tracking';
const USER_LOCATIONS_COLLECTION = 'user_locations';

/**
 * Track event types enum
 */
const TrackingEventTypes = {
  START_CHAT: 'start_chat',
  MESSAGE_SENT: 'message_sent',
  PREMIUM_VIEW: 'premium_view',
  EARLY_NSFW_UPSELL: 'early_nsfw_upsell',
  PAGE_VIEW: 'page_view'
};

/**
 * Chat start source identifiers
 */
const ChatStartSources = {
  CHARACTER_INTRO_MODAL: 'character_intro_modal',
  CHARACTER_PAGE: 'character_page',
  CHAT_LIST: 'chat_list',
  HOME_FEATURED: 'home_featured',
  HOME_CAROUSEL: 'home_carousel',
  EXPLORE_CARD: 'explore_card',
  SEARCH_RESULTS: 'search_results',
  RECOMMENDATION: 'recommendation',
  COLD_ONBOARDING: 'cold_onboarding',
  CHARACTER_CREATION: 'character_creation',
  PAYMENT_SUCCESS: 'payment_success',
  DIRECT_URL: 'direct_url',
  UNKNOWN: 'unknown'
};

/**
 * Premium view source identifiers
 */
const PremiumViewSources = {
  CHAT_TOOL_SETTINGS: 'chat_tool_settings',
  IMAGE_GENERATION: 'image_generation',
  DASHBOARD_GENERATION: 'dashboard_generation',
  SETTINGS_PAGE: 'settings_page',
  CHARACTER_CREATION: 'character_creation',
  CREATOR_APPLICATION: 'creator_application',
  AFFILIATION_DASHBOARD: 'affiliation_dashboard',
  CIVITAI_SEARCH: 'civitai_search',
  EARLY_NSFW_UPSELL: 'early_nsfw_upsell',
  WEBSOCKET_TRIGGER: 'websocket_trigger',
  MENU_UPGRADE: 'menu_upgrade',
  UNKNOWN: 'unknown'
};

/**
 * Initialize the tracking collections with proper indexes
 * @param {Object} db - MongoDB database instance
 */
async function initializeTrackingCollections(db) {
  try {
    const trackingCollection = db.collection(TRACKING_COLLECTION);
    const locationsCollection = db.collection(USER_LOCATIONS_COLLECTION);

    // Create indexes for tracking collection
    await trackingCollection.createIndex({ userId: 1 });
    await trackingCollection.createIndex({ eventType: 1 });
    await trackingCollection.createIndex({ createdAt: 1 });
    await trackingCollection.createIndex({ userId: 1, eventType: 1 });
    await trackingCollection.createIndex({ 'metadata.source': 1 });

    // Create indexes for user locations collection
    await locationsCollection.createIndex({ userId: 1 }, { unique: true });
    await locationsCollection.createIndex({ country: 1 });
    await locationsCollection.createIndex({ city: 1 });
    await locationsCollection.createIndex({ updatedAt: 1 });

    console.log('✅ [Tracking] Collections and indexes initialized successfully');
  } catch (error) {
    console.error('❌ [Tracking] Error initializing collections:', error);
  }
}

/**
 * Track a "Start Chat" event
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} chatId - Chat ID being started
 * @param {string} source - Source identifier (where the user clicked)
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} The created tracking record
 */
async function trackStartChat(db, userId, chatId, source, metadata = {}) {
  try {
    const trackingCollection = db.collection(TRACKING_COLLECTION);
    
    const record = {
      userId: new ObjectId(userId),
      eventType: TrackingEventTypes.START_CHAT,
      chatId: chatId ? new ObjectId(chatId) : null,
      metadata: {
        source: source || ChatStartSources.UNKNOWN,
        sourceElementId: metadata.sourceElementId || null,
        sourceElementClass: metadata.sourceElementClass || null,
        pageUrl: metadata.pageUrl || null,
        referrer: metadata.referrer || null,
        ...metadata
      },
      createdAt: new Date()
    };

    const result = await trackingCollection.insertOne(record);
    console.log(`📊 [Tracking] Start Chat tracked: User ${userId}, Source: ${source}`);
    
    return { success: true, insertedId: result.insertedId };
  } catch (error) {
    console.error('❌ [Tracking] Error tracking start chat:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Track a "Message Sent" event
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} chatId - Chat ID where message was sent
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} The created tracking record
 */
async function trackMessageSent(db, userId, chatId, metadata = {}) {
  try {
    const trackingCollection = db.collection(TRACKING_COLLECTION);
    
    const record = {
      userId: new ObjectId(userId),
      eventType: TrackingEventTypes.MESSAGE_SENT,
      chatId: chatId ? new ObjectId(chatId) : null,
      metadata: {
        messageType: metadata.messageType || 'text',
        hasImage: metadata.hasImage || false,
        ...metadata
      },
      createdAt: new Date()
    };

    const result = await trackingCollection.insertOne(record);
    
    return { success: true, insertedId: result.insertedId };
  } catch (error) {
    console.error('❌ [Tracking] Error tracking message sent:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Track a "Premium View" event (when premium modal is shown)
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} source - Source that triggered the premium modal
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} The created tracking record
 */
async function trackPremiumView(db, userId, source, metadata = {}) {
  try {
    const trackingCollection = db.collection(TRACKING_COLLECTION);
    
    const record = {
      userId: new ObjectId(userId),
      eventType: TrackingEventTypes.PREMIUM_VIEW,
      metadata: {
        source: source || PremiumViewSources.UNKNOWN,
        triggerAction: metadata.triggerAction || null,
        pageUrl: metadata.pageUrl || null,
        ...metadata
      },
      createdAt: new Date()
    };

    const result = await trackingCollection.insertOne(record);
    console.log(`📊 [Tracking] Premium View tracked: User ${userId}, Source: ${source}`);
    
    return { success: true, insertedId: result.insertedId };
  } catch (error) {
    console.error('❌ [Tracking] Error tracking premium view:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Track an early NSFW upsell trigger event
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} The created tracking record
 */
async function trackEarlyNsfwUpsell(db, userId, metadata = {}) {
  try {
    const trackingCollection = db.collection(TRACKING_COLLECTION);

    const record = {
      userId: new ObjectId(userId),
      eventType: TrackingEventTypes.EARLY_NSFW_UPSELL,
      metadata: {
        chatId: metadata.chatId ? new ObjectId(metadata.chatId) : null,
        userChatId: metadata.userChatId ? new ObjectId(metadata.userChatId) : null,
        severity: metadata.severity || 'none',
        confidence: metadata.confidence ?? null,
        reason: metadata.reason || null,
        userIntent: metadata.userIntent || null,
        ...metadata
      },
      createdAt: new Date()
    };

    const result = await trackingCollection.insertOne(record);
    console.log(`📊 [Tracking] Early NSFW upsell tracked: User ${userId}, severity: ${record.metadata.severity}`);

    return { success: true, insertedId: result.insertedId };
  } catch (error) {
    console.error('❌ [Tracking] Error tracking early NSFW upsell:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get user location from IP address using free IP geolocation service
 * @param {string} ipAddress - User's IP address
 * @returns {Promise<Object>} Location data
 */
async function getLocationFromIP(ipAddress) {
  return new Promise((resolve, reject) => {
    // Clean the IP address
    let cleanIP = ipAddress;
    if (cleanIP.startsWith('::ffff:')) {
      cleanIP = cleanIP.substring(7);
    }
    
    // Handle localhost/private IPs
    if (cleanIP === '127.0.0.1' || cleanIP === '::1' || cleanIP.startsWith('192.168.') || cleanIP.startsWith('10.')) {
      resolve({
        ip: cleanIP,
        country: 'Local',
        countryCode: 'LO',
        region: 'Local',
        city: 'Local',
        latitude: 0,
        longitude: 0,
        timezone: 'UTC',
        isLocal: true
      });
      return;
    }

    // Use ip-api.com (free, no API key required, 45 requests/minute)
    const options = {
      hostname: 'ip-api.com',
      path: `/json/${cleanIP}?fields=status,message,country,countryCode,region,regionName,city,lat,lon,timezone,isp`,
      method: 'GET',
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          
          if (parsed.status === 'success') {
            resolve({
              ip: cleanIP,
              country: parsed.country,
              countryCode: parsed.countryCode,
              region: parsed.regionName,
              city: parsed.city,
              latitude: parsed.lat,
              longitude: parsed.lon,
              timezone: parsed.timezone,
              isp: parsed.isp,
              isLocal: false
            });
          } else {
            resolve({
              ip: cleanIP,
              country: 'Unknown',
              countryCode: 'XX',
              region: 'Unknown',
              city: 'Unknown',
              latitude: 0,
              longitude: 0,
              timezone: 'UTC',
              isLocal: false,
              error: parsed.message
            });
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ [Tracking] IP geolocation error:', error);
      resolve({
        ip: cleanIP,
        country: 'Unknown',
        countryCode: 'XX',
        region: 'Unknown',
        city: 'Unknown',
        latitude: 0,
        longitude: 0,
        timezone: 'UTC',
        isLocal: false,
        error: error.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        ip: cleanIP,
        country: 'Unknown',
        countryCode: 'XX',
        region: 'Unknown',
        city: 'Unknown',
        latitude: 0,
        longitude: 0,
        timezone: 'UTC',
        isLocal: false,
        error: 'Request timeout'
      });
    });

    req.end();
  });
}

/**
 * Save or update user location
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {string} ipAddress - User's IP address
 * @returns {Promise<Object>} Location data
 */
async function saveUserLocation(db, userId, ipAddress) {
  try {
    const locationsCollection = db.collection(USER_LOCATIONS_COLLECTION);
    
    // Get location from IP
    const locationData = await getLocationFromIP(ipAddress);
    
    const record = {
      userId: new ObjectId(userId),
      ...locationData,
      lastIpAddress: ipAddress,
      updatedAt: new Date()
    };

    // Upsert: update if exists, insert if not
    const result = await locationsCollection.updateOne(
      { userId: new ObjectId(userId) },
      { 
        $set: record,
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );

    console.log(`📍 [Tracking] User location saved: ${userId} - ${locationData.city}, ${locationData.country}`);
    
    return { success: true, location: locationData };
  } catch (error) {
    console.error('❌ [Tracking] Error saving user location:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Save or update user location with pre-detected location data
 * Used when client-side detection provides location (fallback for localhost)
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {Object} locationData - Pre-detected location data from client
 * @returns {Promise<Object>} Location data
 */
async function saveUserLocationDirect(db, userId, locationData) {
  try {
    const locationsCollection = db.collection(USER_LOCATIONS_COLLECTION);
    
    const record = {
      userId: new ObjectId(userId),
      ip: locationData.ip,
      country: locationData.country || 'Unknown',
      countryCode: locationData.countryCode || 'XX',
      region: locationData.region || 'Unknown',
      city: locationData.city || 'Unknown',
      latitude: locationData.latitude || 0,
      longitude: locationData.longitude || 0,
      timezone: locationData.timezone || 'UTC',
      isp: locationData.isp || 'Unknown',
      isLocal: false,
      detectedBy: 'client', // Mark as client-detected
      lastIpAddress: locationData.ip,
      updatedAt: new Date()
    };

    // Upsert: update if exists, insert if not
    await locationsCollection.updateOne(
      { userId: new ObjectId(userId) },
      { 
        $set: record,
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );

    console.log(`📍 [Tracking] User location saved (client-detected): ${userId} - ${locationData.city}, ${locationData.country}`);
    
    return { success: true, location: record };
  } catch (error) {
    console.error('❌ [Tracking] Error saving user location (direct):', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get user's saved location
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Location data or null
 */
async function getUserLocation(db, userId) {
  try {
    const locationsCollection = db.collection(USER_LOCATIONS_COLLECTION);
    return await locationsCollection.findOne({ userId: new ObjectId(userId) });
  } catch (error) {
    console.error('❌ [Tracking] Error getting user location:', error);
    return null;
  }
}

/**
 * Get tracking statistics for a user
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User tracking statistics
 */
async function getUserTrackingStats(db, userId) {
  try {
    const trackingCollection = db.collection(TRACKING_COLLECTION);
    
    const stats = await trackingCollection.aggregate([
      { $match: { userId: new ObjectId(userId) } },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 },
          lastOccurrence: { $max: '$createdAt' }
        }
      }
    ]).toArray();

    const result = {
      startChatCount: 0,
      messageSentCount: 0,
      premiumViewCount: 0,
      lastStartChat: null,
      lastMessageSent: null,
      lastPremiumView: null
    };

    stats.forEach(stat => {
      switch (stat._id) {
        case TrackingEventTypes.START_CHAT:
          result.startChatCount = stat.count;
          result.lastStartChat = stat.lastOccurrence;
          break;
        case TrackingEventTypes.MESSAGE_SENT:
          result.messageSentCount = stat.count;
          result.lastMessageSent = stat.lastOccurrence;
          break;
        case TrackingEventTypes.PREMIUM_VIEW:
          result.premiumViewCount = stat.count;
          result.lastPremiumView = stat.lastOccurrence;
          break;
      }
    });

    return result;
  } catch (error) {
    console.error('❌ [Tracking] Error getting user tracking stats:', error);
    return null;
  }
}

/**
 * Get aggregate tracking statistics for admin dashboard
 * Queries the userChat collection for chat sessions and messages
 * Only for users created in the last 7 days
 * Excludes admin users (role: 'admin') from all statistics
 * @param {Object} db - MongoDB database instance
 * @param {Date} startDate - Start date for filtering (optional)
 * @param {Date} endDate - End date for filtering (optional)
 * @returns {Promise<Object>} Aggregate tracking statistics
 */
async function getAggregateTrackingStats(db, startDate = null, endDate = null) {
  try {
    const trackingCollection = db.collection(TRACKING_COLLECTION);
    const locationsCollection = db.collection(USER_LOCATIONS_COLLECTION);
    const usersCollection = db.collection('users');
    const userChatCollection = db.collection('userChat');
    
    // Calculate date range (last 7 days for users created)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Get users created in the last 7 days, excluding admin users
    const recentUsers = await usersCollection.find({
      createdAt: { $gte: sevenDaysAgo },
      role: { $ne: 'admin' }  // Exclude admin users
    }, { projection: { _id: 1 } }).toArray();
    
    const recentUserIds = recentUsers.map(u => u._id);
    
    // Get chat sessions and messages for recent users
    let chatSessionsCount = 0;
    let messagesCount = 0;
    let uniqueChatUsers = new Set();
    let uniqueMessageUsers = new Set();
    
    if (recentUserIds.length > 0) {
      // Get chat sessions started (userChat documents) for recent users
      // Use computedDate to handle docs that might not have createdAt field
      const chatSessionsData = await userChatCollection.aggregate([
        { 
          $match: { 
            userId: { $in: recentUserIds }
          } 
        },
        {
          $addFields: {
            computedDate: {
              $ifNull: ['$createdAt', { $toDate: '$_id' }]
            }
          }
        },
        {
          $match: {
            computedDate: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' }
          }
        }
      ]).toArray();
      
      if (chatSessionsData.length > 0) {
        chatSessionsCount = chatSessionsData[0].count;
        chatSessionsData[0].uniqueUsers.forEach(u => uniqueChatUsers.add(u.toString()));
      }
      
      // Get messages sent (from messages array) for recent users
      // Note: messages.timestamp is stored as a string (toLocaleString format), not a Date
      // So we count all user messages from userChat docs created in last 7 days
      const messagesData = await userChatCollection.aggregate([
        { 
          $match: { 
            userId: { $in: recentUserIds }
          } 
        },
        {
          $addFields: {
            computedDate: {
              $ifNull: ['$createdAt', { $toDate: '$_id' }]
            }
          }
        },
        {
          $match: {
            computedDate: { $gte: sevenDaysAgo }
          }
        },
        { $unwind: { path: '$messages', preserveNullAndEmptyArrays: false } },
        { 
          $match: { 
            'messages.role': 'user'  // Only count user messages, not assistant messages
          } 
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' }
          }
        }
      ]).toArray();
      
      if (messagesData.length > 0) {
        messagesCount = messagesData[0].count;
        messagesData[0].uniqueUsers.forEach(u => uniqueMessageUsers.add(u.toString()));
      }
    }
    
    const matchStage = {};
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = startDate;
      if (endDate) matchStage.createdAt.$lte = endDate;
    }

    // Get start chat sources distribution (from tracking collection, filtered by recent users)
    // Note: userId is stored as ObjectId in tracking collection
    const startChatSources = await trackingCollection.aggregate([
      { 
        $match: { 
          eventType: TrackingEventTypes.START_CHAT,
          userId: { $in: recentUserIds },
          createdAt: { $gte: sevenDaysAgo }
        } 
      },
      {
        $group: {
          _id: '$metadata.source',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();

    // Get premium view sources distribution (filtered by recent users)
    // Note: userId is stored as ObjectId in tracking collection
    const premiumViewSources = await trackingCollection.aggregate([
      { 
        $match: { 
          eventType: TrackingEventTypes.PREMIUM_VIEW,
          userId: { $in: recentUserIds },
          createdAt: { $gte: sevenDaysAgo }
        } 
      },
      {
        $group: {
          _id: '$metadata.source',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();

    // Get premium view count from tracking collection (filtered by recent users)
    // Note: userId is stored as ObjectId in tracking collection
    const premiumViewStats = await trackingCollection.aggregate([
      { 
        $match: { 
          eventType: TrackingEventTypes.PREMIUM_VIEW,
          userId: { $in: recentUserIds },
          createdAt: { $gte: sevenDaysAgo }
        } 
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' }
        }
      }
    ]).toArray();

    // Get early NSFW upsell counts
    const earlyNsfwUpsellMatch = {
      eventType: TrackingEventTypes.EARLY_NSFW_UPSELL,
      createdAt: { $gte: sevenDaysAgo }
    };
    if (recentUserIds.length > 0) {
      earlyNsfwUpsellMatch.userId = { $in: recentUserIds };
    }

    const earlyNsfwUpsellStats = await trackingCollection.aggregate([
      {
        $match: earlyNsfwUpsellMatch
      },
      {
        $group: {
          _id: '$metadata.severity',
          count: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();

    const earlyNsfwUpsellTotal = earlyNsfwUpsellStats.reduce((sum, item) => sum + item.count, 0);
    const earlyNsfwUpsellUniqueUsers = new Set();
    earlyNsfwUpsellStats.forEach(item => {
      (item.uniqueUsers || []).forEach(userId => earlyNsfwUpsellUniqueUsers.add(userId.toString()));
    });

    // Get location distribution (filtered by recent users)
    const locationStats = await locationsCollection.aggregate([
      {
        $match: {
          userId: { $in: recentUserIds }
        }
      },
      {
        $group: {
          _id: '$country',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]).toArray();

    // Get city distribution (filtered by recent users)
    const cityStats = await locationsCollection.aggregate([
      {
        $match: {
          userId: { $in: recentUserIds }
        }
      },
      {
        $group: {
          _id: { city: '$city', country: '$country' },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]).toArray();

    // Format results - using userChat collection for chat sessions and messages
    const result = {
      events: {
        startChat: { 
          count: chatSessionsCount, 
          uniqueUsers: uniqueChatUsers.size 
        },
        messageSent: { 
          count: messagesCount, 
          uniqueUsers: uniqueMessageUsers.size 
        },
        premiumView: { 
          count: premiumViewStats[0]?.count || 0, 
          uniqueUsers: premiumViewStats[0]?.uniqueUsers?.length || 0 
        },
        earlyNsfwUpsell: {
          count: earlyNsfwUpsellTotal,
          uniqueUsers: earlyNsfwUpsellUniqueUsers.size
        }
      },
      startChatSources: startChatSources.map(s => ({
        source: s._id || 'unknown',
        count: s.count
      })),
      premiumViewSources: premiumViewSources.map(s => ({
        source: s._id || 'unknown',
        count: s.count
      })),
      earlyNsfwUpsell: {
        total: earlyNsfwUpsellTotal,
        bySeverity: earlyNsfwUpsellStats.map(s => ({
          severity: s._id || 'unknown',
          count: s.count
        }))
      },
      locations: {
        byCountry: locationStats.map(l => ({
          country: l._id || 'Unknown',
          count: l.count
        })),
        byCity: cityStats.map(c => ({
          city: c._id.city || 'Unknown',
          country: c._id.country || 'Unknown',
          count: c.count
        }))
      },
      // Add metadata about the query
      metadata: {
        period: '7 days',
        recentUsersCount: recentUserIds.length,
        queryDate: new Date()
      }
    };

    return result;
  } catch (error) {
    console.error('❌ [Tracking] Error getting aggregate tracking stats:', error);
    return null;
  }
}

/**
 * Get daily tracking trends from userChat collection
 * Only for users created in the last 7 days
 * Excludes admin users from all statistics
 * @param {Object} db - MongoDB database instance
 * @param {number} days - Number of days to look back
 * @returns {Promise<Object>} Daily tracking trends
 */
async function getDailyTrackingTrends(db, days = 7) {
  try {
    const trackingCollection = db.collection(TRACKING_COLLECTION);
    const usersCollection = db.collection('users');
    const userChatCollection = db.collection('userChat');
    
    // Use the same date calculation as getAggregateTrackingStats
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Get users created in the last 7 days, excluding admin users
    const recentUsers = await usersCollection.find({
      createdAt: { $gte: startDate },
      role: { $ne: 'admin' }  // Exclude admin users
    }, { projection: { _id: 1 } }).toArray();
    
    const recentUserIds = recentUsers.map(u => u._id);
    
    console.log(`[getDailyTrackingTrends] Found ${recentUserIds.length} users (excluding admins) created since ${startDate.toISOString()}`);
    
    // Initialize result object with all dates
    const result = {};
    for (let i = 0; i <= days; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      result[dateStr] = {
        date: dateStr,
        startChat: 0,
        messageSent: 0,
        premiumView: 0,
        earlyNsfwUpsell: 0
      };
    }

    console.log(`[getDailyTrackingTrends] Date range:`, Object.keys(result));

    if (recentUserIds.length > 0) {
      // Get chat sessions (userChat documents) created per day for recent users
      const chatTrends = await userChatCollection.aggregate([
        { 
          $match: { 
            userId: { $in: recentUserIds }
          } 
        },
        {
          $addFields: {
            computedDate: {
              $ifNull: ['$createdAt', { $toDate: '$_id' }]
            }
          }
        },
        {
          $match: {
            computedDate: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$computedDate' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]).toArray();

      console.log(`[getDailyTrackingTrends] Chat trends from DB:`, chatTrends);

      chatTrends.forEach(t => {
        if (result[t._id]) {
          result[t._id].startChat = t.count;
        } else {
          console.log(`[getDailyTrackingTrends] Date ${t._id} not in result, adding...`);
          result[t._id] = {
            date: t._id,
            startChat: t.count,
            messageSent: 0,
            premiumView: 0
          };
        }
      });

      // Get messages sent per day for recent users
      const messageTrends = await userChatCollection.aggregate([
        { 
          $match: { 
            userId: { $in: recentUserIds }
          } 
        },
        {
          $addFields: {
            computedDate: {
              $ifNull: ['$createdAt', { $toDate: '$_id' }]
            }
          }
        },
        {
          $match: {
            computedDate: { $gte: startDate }
          }
        },
        { $unwind: { path: '$messages', preserveNullAndEmptyArrays: false } },
        { 
          $match: { 
            'messages.role': 'user'
          } 
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$computedDate' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]).toArray();

      console.log(`[getDailyTrackingTrends] Message trends from DB:`, messageTrends);

      messageTrends.forEach(t => {
        if (result[t._id]) {
          result[t._id].messageSent = t.count;
        } else {
          result[t._id] = {
            date: t._id,
            startChat: result[t._id]?.startChat || 0,
            messageSent: t.count,
            premiumView: 0
          };
        }
      });

      // Get premium view trends from tracking collection (filtered by recent users)
      // Note: userId is stored as ObjectId in tracking collection
    const premiumTrends = await trackingCollection.aggregate([
        { 
          $match: { 
            createdAt: { $gte: startDate },
            eventType: TrackingEventTypes.PREMIUM_VIEW,
            userId: { $in: recentUserIds }
          } 
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
    ]).toArray();

      console.log(`[getDailyTrackingTrends] Premium trends from DB:`, premiumTrends);

    premiumTrends.forEach(t => {
        if (result[t._id]) {
          result[t._id].premiumView = t.count;
        } else {
        result[t._id] = {
          date: t._id,
          startChat: result[t._id]?.startChat || 0,
          messageSent: result[t._id]?.messageSent || 0,
          premiumView: t.count,
          earlyNsfwUpsell: 0
        };
      }
    });

    const earlyNsfwUpsellTrendMatch = {
      eventType: TrackingEventTypes.EARLY_NSFW_UPSELL,
      createdAt: { $gte: startDate }
    };
    if (recentUserIds.length > 0) {
      earlyNsfwUpsellTrendMatch.userId = { $in: recentUserIds };
    }

    const earlyNsfwUpsellTrends = await trackingCollection.aggregate([
      {
        $match: earlyNsfwUpsellTrendMatch
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]).toArray();

    earlyNsfwUpsellTrends.forEach(t => {
      if (result[t._id]) {
        result[t._id].earlyNsfwUpsell = t.count;
      } else {
        result[t._id] = {
          date: t._id,
          startChat: result[t._id]?.startChat || 0,
          messageSent: result[t._id]?.messageSent || 0,
          premiumView: result[t._id]?.premiumView || 0,
          earlyNsfwUpsell: t.count
        };
      }
    });
    }

    // Sort by date and return
    const sortedResult = Object.values(result).map(item => ({
      ...item,
      earlyNsfwUpsell: item.earlyNsfwUpsell || 0
    })).sort((a, b) => a.date.localeCompare(b.date));
    console.log(`[getDailyTrackingTrends] Final result:`, JSON.stringify(sortedResult, null, 2));
    return sortedResult;
  } catch (error) {
    console.error('❌ [Tracking] Error getting daily tracking trends:', error);
    return [];
  }
}

module.exports = {
  // Constants
  TrackingEventTypes,
  ChatStartSources,
  PremiumViewSources,
  TRACKING_COLLECTION,
  USER_LOCATIONS_COLLECTION,
  
  // Initialization
  initializeTrackingCollections,
  
  // Tracking functions
  trackStartChat,
  trackMessageSent,
  trackPremiumView,
  trackEarlyNsfwUpsell,
  
  // Location functions
  getLocationFromIP,
  saveUserLocation,
  saveUserLocationDirect,
  getUserLocation,
  
  // Statistics functions
  getUserTrackingStats,
  getAggregateTrackingStats,
  getDailyTrackingTrends
};
