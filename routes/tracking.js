const { ObjectId } = require('mongodb');
const {
  trackStartChat,
  trackMessageSent,
  trackPremiumView,
  saveUserLocation,
  saveUserLocationDirect,
  getUserLocation,
  getUserTrackingStats,
  getAggregateTrackingStats,
  getDailyTrackingTrends,
  initializeTrackingCollections,
  ChatStartSources,
  PremiumViewSources
} = require('../models/user-behavior-tracking-utils');
const { checkUserAdmin } = require('../models/tool');

/**
 * User Behavior Tracking Routes
 * 
 * API endpoints for tracking user behavior:
 * - POST /api/tracking/start-chat - Track when a user starts a chat
 * - POST /api/tracking/message-sent - Track when a user sends a message  
 * - POST /api/tracking/premium-view - Track when premium modal is shown
 * - POST /api/tracking/location - Save/update user location from IP
 * - GET /api/tracking/user/:userId - Get tracking stats for a user
 * - GET /api/tracking/admin/stats - Get aggregate stats for admin dashboard
 * - GET /api/tracking/admin/trends - Get daily trends for admin dashboard
 */

async function trackingRoutes(fastify, options) {
  const db = fastify.mongo.db;
  
  // Initialize tracking collections on startup
  await initializeTrackingCollections(db);

  /**
   * Get client IP address from request
   */
  function getClientIP(request) {
    // Check various headers for the real IP
    const forwarded = request.headers['x-forwarded-for'];
    const realIP = request.headers['x-real-ip'];
    const cfConnectingIP = request.headers['cf-connecting-ip']; // Cloudflare
    
    if (cfConnectingIP) {
      return cfConnectingIP;
    }
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    if (realIP) {
      return realIP;
    }
    return request.ip;
  }

  // ============================================
  // Public Tracking Endpoints (requires auth)
  // ============================================

  /**
   * Track a "Start Chat" event
   * POST /api/tracking/start-chat
   */
  fastify.post('/api/tracking/start-chat', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || !user._id) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { chatId, source, sourceElementId, sourceElementClass, pageUrl, referrer } = request.body;

      const result = await trackStartChat(db, user._id.toString(), chatId, source, {
        sourceElementId,
        sourceElementClass,
        pageUrl,
        referrer
      });

      return reply.send(result);
    } catch (error) {
      console.error('Error in /api/tracking/start-chat:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * Track a "Message Sent" event
   * POST /api/tracking/message-sent
   */
  fastify.post('/api/tracking/message-sent', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || !user._id) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { chatId, messageType, hasImage } = request.body;

      const result = await trackMessageSent(db, user._id.toString(), chatId, {
        messageType,
        hasImage
      });

      return reply.send(result);
    } catch (error) {
      console.error('Error in /api/tracking/message-sent:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * Track a "Premium View" event (when premium modal is shown)
   * POST /api/tracking/premium-view
   */
  fastify.post('/api/tracking/premium-view', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || !user._id) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { source, triggerAction, pageUrl } = request.body;

      const result = await trackPremiumView(db, user._id.toString(), source, {
        triggerAction,
        pageUrl
      });

      return reply.send(result);
    } catch (error) {
      console.error('Error in /api/tracking/premium-view:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * Save/update user location based on IP
   * POST /api/tracking/location
   * Accepts optional clientDetectedLocation in body for client-side fallback
   */
  fastify.post('/api/tracking/location', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || !user._id) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      // Check if client sent a detected location (fallback for localhost)
      const clientLocation = request.body?.clientDetectedLocation;
      if (clientLocation && clientLocation.ip && !clientLocation.isLocal) {
        // Use client-detected location directly
        const result = await saveUserLocationDirect(db, user._id.toString(), clientLocation);
        return reply.send(result);
      }

      const ipAddress = getClientIP(request);
      
      if (!ipAddress) {
        // Return success with local/unknown location instead of error
        // This handles development environments where IP cannot be determined
        return reply.send({ 
          success: true, 
          location: {
            ip: 'unknown',
            country: 'Unknown',
            countryCode: 'XX',
            region: 'Unknown',
            city: 'Unknown',
            latitude: 0,
            longitude: 0,
            timezone: 'UTC',
            isLocal: true
          }
        });
      }
      
      const result = await saveUserLocation(db, user._id.toString(), ipAddress);
      return reply.send(result);
    } catch (error) {
      console.error('Error in /api/tracking/location:', error);
      return reply.status(500).send({ error: 'Internal server error', details: error.message });
    }
  });

  /**
   * Get user's saved location
   * GET /api/tracking/location
   */
  fastify.get('/api/tracking/location', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || !user._id) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const location = await getUserLocation(db, user._id.toString());
      
      if (!location) {
        // Try to get and save location
        const ipAddress = getClientIP(request);
        const result = await saveUserLocation(db, user._id.toString(), ipAddress);
        return reply.send(result.location || null);
      }

      return reply.send(location);
    } catch (error) {
      console.error('Error in GET /api/tracking/location:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * Get tracking stats for current user
   * GET /api/tracking/my-stats
   */
  fastify.get('/api/tracking/my-stats', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || !user._id) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const stats = await getUserTrackingStats(db, user._id.toString());
      return reply.send(stats);
    } catch (error) {
      console.error('Error in /api/tracking/my-stats:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ============================================
  // Admin Endpoints (requires admin auth)
  // ============================================

  /**
   * Check if user is admin using shared checkUserAdmin function
   */
  async function checkAdmin(request, reply) {
    const user = request.user;
    if (!user || !user._id) {
      await reply.status(401).send({ error: 'Unauthorized' });
      return false;
    }
    
    try {
      const isAdmin = await checkUserAdmin(fastify, user._id);
      
      if (!isAdmin) {
        await reply.status(403).send({ error: 'Access denied - admin privileges required' });
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('Error checking admin status:', error);
      await reply.status(500).send({ error: 'Internal server error' });
      return false;
    }
  }

  /**
   * Get tracking stats for a specific user (admin only)
   * GET /api/tracking/admin/user/:userId
   */
  fastify.get('/api/tracking/admin/user/:userId', async (request, reply) => {
    try {
      if (!(await checkAdmin(request, reply))) return;

      const { userId } = request.params;
      
      const [stats, location] = await Promise.all([
        getUserTrackingStats(db, userId),
        getUserLocation(db, userId)
      ]);

      return reply.send({ stats, location });
    } catch (error) {
      console.error('Error in /api/tracking/admin/user/:userId:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * Get aggregate tracking stats (admin only)
   * GET /api/tracking/admin/stats
   */
  fastify.get('/api/tracking/admin/stats', async (request, reply) => {
    try {
      const isAdmin = await checkAdmin(request, reply);
      if (!isAdmin) return;

      const { startDate, endDate } = request.query;
      
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;

      const stats = await getAggregateTrackingStats(db, start, end);
      return reply.send(stats);
    } catch (error) {
      console.error('Error in /api/tracking/admin/stats:', error);
      return reply.status(500).send({ error: 'Internal server error', details: error.message });
    }
  });

  /**
   * Get daily tracking trends (admin only)
   * GET /api/tracking/admin/trends
   */
  fastify.get('/api/tracking/admin/trends', async (request, reply) => {
    try {
      const isAdmin = await checkAdmin(request, reply);
      if (!isAdmin) return;

      const days = parseInt(request.query.days) || 7;
      const trends = await getDailyTrackingTrends(db, days);
      
      return reply.send(trends);
    } catch (error) {
      console.error('Error in /api/tracking/admin/trends:', error);
      return reply.status(500).send({ error: 'Internal server error', details: error.message });
    }
  });

  /**
   * Get available tracking sources (for reference)
   * GET /api/tracking/sources
   */
  fastify.get('/api/tracking/sources', async (request, reply) => {
    return reply.send({
      chatStartSources: ChatStartSources,
      premiumViewSources: PremiumViewSources
    });
  });
}

module.exports = trackingRoutes;
