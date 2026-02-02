const { ObjectId } = require('mongodb');
const { checkUserAdmin } = require('../models/tool');
const {
  recordNsfwUpsellDismissal,
  recordNsfwUpsellConversion,
  getNsfwAnalytics,
  getTopNsfwPushUsers
} = require('../models/nsfw-analytics-utils');

async function routes(fastify, options) {
  
  /**
   * Record when user dismisses the NSFW upsell modal
   * POST /api/nsfw-upsell/dismiss
   */
  fastify.post('/api/nsfw-upsell/dismiss', async (request, reply) => {
    try {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }
      
      const { action } = request.body; // 'dismissed' or 'stay_sfw'
      const db = fastify.mongo.db;
      
      await recordNsfwUpsellDismissal(db, user._id, action || 'dismissed');
      
      return reply.send({ success: true });
    } catch (error) {
      console.error('[nsfw-upsell/dismiss] Error:', error);
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
  
  /**
   * Record when user converts to premium after NSFW upsell
   * This should be called after successful subscription
   * POST /api/nsfw-upsell/conversion
   */
  fastify.post('/api/nsfw-upsell/conversion', async (request, reply) => {
    try {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }
      
      const db = fastify.mongo.db;
      
      await recordNsfwUpsellConversion(db, user._id);
      
      return reply.send({ success: true });
    } catch (error) {
      console.error('[nsfw-upsell/conversion] Error:', error);
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
  
  /**
   * Get NSFW analytics for admin dashboard
   * GET /api/admin/nsfw-analytics
   */
  fastify.get('/api/admin/nsfw-analytics', async (request, reply) => {
    try {
      const user = request.user;
      
      if (!user || !await checkUserAdmin(fastify, user._id)) {
        return reply.status(403).send({ success: false, error: 'Admin access required' });
      }
      
      const db = fastify.mongo.db;
      const period = request.query.period || 'last_7_days';
      
      const analytics = await getNsfwAnalytics(db, period);
      const topUsers = await getTopNsfwPushUsers(db, 10, period);
      
      return reply.send({
        success: true,
        analytics,
        topUsers,
        period
      });
    } catch (error) {
      console.error('[admin/nsfw-analytics] Error:', error);
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
  
  /**
   * Get NSFW analytics summary for dashboard widget
   * GET /api/admin/nsfw-analytics/summary
   */
  fastify.get('/api/admin/nsfw-analytics/summary', async (request, reply) => {
    try {
      const user = request.user;
      
      if (!user || !await checkUserAdmin(fastify, user._id)) {
        return reply.status(403).send({ success: false, error: 'Admin access required' });
      }
      
      const db = fastify.mongo.db;
      
      const analytics = await getNsfwAnalytics(db, 'last_7_days');
      
      return reply.send({
        success: true,
        summary: {
          totalEvents: analytics.totalEvents,
          uniqueUsers: analytics.uniqueUsers,
          conversionRate: analytics.conversionRate,
          conversions: analytics.conversions
        }
      });
    } catch (error) {
      console.error('[admin/nsfw-analytics/summary] Error:', error);
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
}

module.exports = routes;
