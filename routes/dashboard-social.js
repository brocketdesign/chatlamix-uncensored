/**
 * Character Social Dashboard Route
 * Dedicated "Command Center" for managing a single character's social presence.
 */

const { ObjectId } = require('mongodb');

async function routes(fastify, options) {
  const db = fastify.mongo.db;

  /**
   * GET /dashboard/social/:characterId
   * Main social management dashboard for a specific character
   */
  fastify.get('/dashboard/social/:characterId', async (request, reply) => {
    try {
      const user = request.user;
      const { characterId } = request.params;
      
      if (!user || user.isTemporary) {
        return reply.redirect('/login');
      }

      // Validate characterId
      if (!ObjectId.isValid(characterId)) {
        return reply.code(400).send('Invalid Character ID');
      }

      // Fetch character details from chats collection
      // (Characters are stored in 'chats' collection in this codebase)
      const character = await db.collection('chats').findOne({
        _id: new ObjectId(characterId),
        userId: new ObjectId(user._id) // Ensure ownership
      });

      if (!character) {
        return reply.code(404).send('Character not found or access denied');
      }

      const lang = request.lang || 'en';
      const translations = request.translations;

      const characterObjectId = new ObjectId(characterId);

      // Get stats (reuse logic from existing dashboards where possible or simple counts)
      // 1. Total Posts - posts collection uses chatId for character
      const totalPosts = await db.collection('posts').countDocuments({
        userId: new ObjectId(user._id),
        chatId: characterObjectId
      });

      // 2. Upcoming Schedules - schedules collection uses characterId
      const upcomingSchedules = await db.collection('schedules').countDocuments({
        userId: new ObjectId(user._id),
        characterId: characterObjectId,
        status: { $in: ['pending', 'active'] }
      });

      // 3. Last Post Time
      const lastPost = await db.collection('posts').findOne(
        { userId: new ObjectId(user._id), chatId: characterObjectId },
        { sort: { createdAt: -1 }, projection: { createdAt: 1 } }
      );
      const lastPostTime = lastPost ? lastPost.createdAt : null;

      return reply.view('dashboard/social-manager', {
        user,
        translations,
        lang,
        title: `${character.name} - Social Manager`,
        pageType: 'dashboard',
        character,
        stats: {
            totalPosts,
            upcomingSchedules,
            lastPostTime
        },
        canonical: `${request.protocol}://${request.hostname}/dashboard/social/${characterId}`
      });
    } catch (error) {
      console.error('[Dashboard Social] Error loading page:', error);
      return reply.code(500).send('Internal Server Error');
    }
  });
}

module.exports = routes;
