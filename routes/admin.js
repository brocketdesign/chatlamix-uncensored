const { ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const  { checkUserAdmin } = require('../models/tool')
const cleanupNonRegisteredUsers = require('../models/databasemanagement');
const { getUsersForExport, formatUsersForCsv, getUserExportStats } = require('../models/user-analytics-utils');
const axios = require('axios');
const hbs = require('handlebars');

async function routes(fastify, options) {

  fastify.get('/admin/notifications', async (request, reply) => {
    const user = request.user;
    const isAdmin = await checkUserAdmin(fastify, user._id);
    if (!isAdmin) return reply.status(403).send({ error: 'Access denied' });

    const db = fastify.mongo.db;
    const notificationsCollection = db.collection('notifications');

    const notifications = await notificationsCollection.aggregate([
      {
        $group: {
          _id: {_id:"$_id", title: "$title", message: "$message", type: "$type", sticky: "$sticky", createdAt: "$createdAt" },
          viewedCount: { $sum: { $cond: ["$viewed", 1, 0] } },
          total: { $sum: 1 }
        }
      },
      { $sort: { "_id.createdAt": -1 } }
    ]).toArray();

    const formattedNotifications = notifications.map(n => ({
      _id: n._id._id,
      title : n._id.title,
      message: n._id.message,
      type: n._id.type,
      sticky : n._id.sticky,
      createdAt: n._id.createdAt,
      viewedCount: n.viewedCount
    }));

    return reply.view('/admin/notifications', { notifications: formattedNotifications });
  });
  
  fastify.get('/admin/users', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      } 
      const usersCollection = fastify.mongo.db.collection('users');
      const chatsCollection = fastify.mongo.db.collection('userChat');
      
      // Pagination parameters
      const page = Math.max(1, parseInt(request.query.page) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(request.query.limit) || 10)); // Max 50 per page
      const skip = (page - 1) * limit;
         
      const getUniqueUsers = async () => {
        try {
          // Get the unique userId's from the chats collection
          const userIds = await usersCollection.distinct('_id');
  
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const yesterday = new Date(today);
          yesterday.setDate(today.getDate() - 1);
          
          today.toLocaleDateString('ja-JP');
          yesterday.toLocaleDateString('ja-JP');                    
  
          // Count total users
          const totalUsers = await usersCollection.countDocuments({
            _id: { $in: userIds },
            createdAt: { $gte: yesterday, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
          });

          // Query the users collection to get the user details for the unique userIds with pagination
          const users = await usersCollection.find({
            _id: { $in: userIds },
            createdAt: { $gte: yesterday, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
          })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();
  
          return { users, totalUsers };
        } catch (error) {
          console.error('Error fetching unique users:', error);
          throw error;
        }
      };
            
      const { users, totalUsers } = await getUniqueUsers();
      const totalPages = Math.ceil(totalUsers / limit);
      const translations = request.translations;
      
      return reply.view('/admin/users',{
        user: request.user,
        users,
        title: translations.admin_user.recent_users, 
        translations,
        pagination: {
          page,
          limit,
          totalUsers,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      });
    } catch (error) {
      return reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/admin/users/analytics', async (request, reply) => {
    const user = request.user;
    const isAdmin = await checkUserAdmin(fastify, user._id);
    if (!isAdmin) return reply.status(403).send({ error: 'Access denied' });

    const db = fastify.mongo.db;
    const analyticsCollection = db.collection('userAnalytics');

    const analyticsData = await analyticsCollection.find().toArray();

    return reply.view('/admin/users-analytics', { analytics: analyticsData });
  });

  // NSFW Monetization Analytics Dashboard
  fastify.get('/admin/nsfw-analytics', async (request, reply) => {
    const user = request.user;
    const isAdmin = await checkUserAdmin(fastify, user._id);
    if (!isAdmin) return reply.status(403).send({ error: 'Access denied' });

    return reply.view('/admin/nsfw-analytics', {});
  });

  fastify.put('/admin/users/:userId/subscription', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const userId = request.params.userId;
      const usersCollection = fastify.mongo.db.collection('users');

      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const subscriptionStatus = user.subscriptionStatus === 'active' ? 'inactive' : 'active';
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { subscriptionStatus } }
      );
      console.log(`Updating subscription status for user ${userId} to ${subscriptionStatus}`);
      if (result.matchedCount === 0) {
        return reply.status(404).send({ error: 'User not found' });
      }

      return reply.status(200).send({ message: 'Subscription updated successfully', subscriptionStatus });
    } catch (error) {
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.delete('/admin/users/:id', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }
      const userId = request.params.id;
      const usersCollection = fastify.mongo.db.collection('users');
      const userDataStoryCollection = fastify.mongo.db.collection('userData');

      const result = await usersCollection.deleteOne({ _id: new ObjectId(userId) });
      if (result.deletedCount === 0) {
        return reply.status(404).send({ error: 'User not found' });
      }
      return reply.status(200).send({ message: 'User deleted successfully' });
    } catch (error) {
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.get('/admin/users/registered', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Pagination parameters
      const page = Math.max(1, parseInt(request.query.page) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(request.query.limit) || 10)); // Max 50 per page
      const skip = (page - 1) * limit;

      const usersCollection = fastify.mongo.db.collection('users');        
      
      // Count total users
      const totalUsers = await usersCollection.countDocuments({
        email: { $exists: true }
      });

      // Get paginated users
      const users = await usersCollection.find({
        email: { $exists: true }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
      
      const femaleCount = users.filter(user => user.gender === 'female').length;
      const maleCount = users.filter(user => user.gender === 'male').length;
      
      const femalePercentage = totalUsers > 0 ? parseInt((femaleCount / totalUsers) * 100) : 0;
      const malePercentage = totalUsers > 0 ? parseInt((maleCount / totalUsers) * 100) : 0;
      const translations = request.translations;
      
      const totalPages = Math.ceil(totalUsers / limit);

      return reply.view('/admin/users',{
        user: request.user,
        users,
        translations,
        mode: process.env.MODE,
        apiurl: process.env.API_URL,
        femaleCount, 
        femalePercentage, 
        maleCount,
        malePercentage,
        title: translations.admin_user.registered_users,
        pagination: {
          page,
          limit,
          totalUsers,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      });
    } catch (error) {
      return reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/admin/users/csv', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) return reply.status(403).send({ error: 'Access denied' });
      
      let fields = request.query.fields ? request.query.fields.split(',') : [];
      const userType = request.query.userType || 'registered'; // 'registered', 'recent', or 'all'
      
      // Default fields if none specified
      if (!fields.length) fields = ['createdAt', 'email', 'nickname', 'gender', 'subscriptionStatus'];
      
      // Use the enhanced export utility
      const users = await getUsersForExport(fastify.mongo.db, {
        userType,
        fields,
        sortBy: 'createdAt',
        sortOrder: -1
      });
      
      // Format data for CSV
      const { csv } = formatUsersForCsv(users, fields);
      
      const filename = `users_${userType}_${new Date().toISOString().split('T')[0]}.csv`;
      
      reply.header('Content-Type', 'text/csv; charset=utf-8')
           .header('Content-Disposition', `attachment; filename="${filename}"`)
           .send('\ufeff' + csv); // Add BOM for Excel compatibility
    } catch (error) {
      console.error('CSV export error:', error);
      reply.status(500).send({ error: error.message });
    }
  });

  // Enhanced CSV export with analytics data
  fastify.get('/admin/users/csv/enhanced', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) return reply.status(403).send({ error: 'Access denied' });
      
      let fields = request.query.fields ? request.query.fields.split(',') : [];
      const userType = request.query.userType || 'registered';
      const includeStats = request.query.includeStats === 'true';
      const batchSize = parseInt(request.query.batchSize) || 100; // Process in batches for large datasets
      
      // Default fields if none specified
      if (!fields.length) fields = ['createdAt', 'email', 'nickname', 'gender', 'subscriptionStatus'];
      
      // If including stats, add analytics fields
      if (includeStats) {
        fields = [...fields, 'totalImages', 'totalMessages', 'totalChats'];
      }
      
      // Get users count first to warn about large exports
      const userCount = await fastify.mongo.db.collection('users').countDocuments(
        userType === 'registered' ? { email: { $exists: true }, isTemporary: { $ne: true } } :
        userType === 'recent' ? { 
          createdAt: { 
            $gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
            $lt: new Date() 
          }, 
          isTemporary: { $ne: true } 
        } : { isTemporary: { $ne: true } }
      );

      console.log(`Starting enhanced CSV export for ${userCount} users with analytics: ${includeStats}`);
      
      // Get users
      const users = await getUsersForExport(fastify.mongo.db, {
        userType,
        fields: fields.filter(f => !['totalImages', 'totalMessages', 'totalChats'].includes(f)),
        sortBy: 'createdAt',
        sortOrder: -1
      });
      
      // Add analytics data if requested (process in batches to avoid memory issues)
      if (includeStats && users.length > 0) {
        console.log(`Processing analytics for ${users.length} users in batches of ${batchSize}`);
        
        for (let i = 0; i < users.length; i += batchSize) {
          const batch = users.slice(i, i + batchSize);
          
          await Promise.all(batch.map(async (user) => {
            try {
              const stats = await getUserExportStats(fastify.mongo.db, user._id);
              user.totalImages = stats.totalImages;
              user.totalMessages = stats.totalMessages;
              user.totalChats = stats.totalChats;
            } catch (error) {
              console.error(`Error getting stats for user ${user._id}:`, error);
              user.totalImages = 0;
              user.totalMessages = 0;
              user.totalChats = 0;
            }
          }));
          
          console.log(`Processed analytics for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(users.length / batchSize)}`);
        }
      }
      
      // Format data for CSV
      const { csv, totalRecords } = formatUsersForCsv(users, fields);
      
      const filename = `users_${userType}${includeStats ? '_with_stats' : ''}_${new Date().toISOString().split('T')[0]}.csv`;
      
      console.log(`Generated CSV with ${totalRecords} records`);
      
      reply.header('Content-Type', 'text/csv; charset=utf-8')
           .header('Content-Disposition', `attachment; filename="${filename}"`)
           .send('\ufeff' + csv);
    } catch (error) {
      console.error('Enhanced CSV export error:', error);
      reply.status(500).send({ error: error.message });
    }
  });

  // Bulk export route for very large datasets (streaming)
  fastify.get('/admin/users/csv/bulk', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) return reply.status(403).send({ error: 'Access denied' });
      
      let fields = request.query.fields ? request.query.fields.split(',') : [];
      const userType = request.query.userType || 'registered';
      
      // Default fields if none specified
      if (!fields.length) fields = ['createdAt', 'email', 'nickname', 'gender', 'subscriptionStatus'];
      
      const filename = `users_bulk_${userType}_${new Date().toISOString().split('T')[0]}.csv`;
      
      // Set headers for streaming CSV
      reply.header('Content-Type', 'text/csv; charset=utf-8')
           .header('Content-Disposition', `attachment; filename="${filename}"`);
      
      // Send BOM and header
      reply.raw.write('\ufeff');
      reply.raw.write(fields.join(',') + '\n');
      
      // Build query
      let userQuery = {};
      if (userType === 'registered') {
        userQuery = { email: { $exists: true }, isTemporary: { $ne: true } };
      } else if (userType === 'recent') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        userQuery = {
          createdAt: { $gte: yesterday, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) },
          isTemporary: { $ne: true }
        };
      } else {
        userQuery = { isTemporary: { $ne: true } };
      }
      
      // Stream users in batches
      const cursor = fastify.mongo.db.collection('users')
        .find(userQuery)
        .sort({ createdAt: -1 })
        .batchSize(100);
      
      let count = 0;
      await cursor.forEach(user => {
        const row = fields.map(field => {
          let value = user[field];
          if (field === 'createdAt' && value instanceof Date) {
            value = value.toISOString().split('T')[0];
          }
          if (field === 'birthDate' && value && typeof value === 'object') {
            value = `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
          }
          // Escape CSV field
          const str = String(value || '');
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        });
        
        reply.raw.write(row.join(',') + '\n');
        count++;
      });
      
      console.log(`Bulk export completed: ${count} users`);
      reply.raw.end();
    } catch (error) {
      console.error('Bulk CSV export error:', error);
      if (!reply.sent) {
        reply.status(500).send({ error: error.message });
      }
    }
  });
    
  fastify.get('/admin/chat/:userId', async (request, reply) => {
    try {
      // Check if the user is an admin
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }
  
      // Convert the userId from the route parameter to ObjectId
      const userId = new fastify.mongo.ObjectId(request.params.userId);
  
      // Access the userChat collection
      const collectionChat = fastify.mongo.db.collection('userChat');
  
      // Fetch userChat documents
      const userChats = await collectionChat.find({ userId }).toArray();

      // Extract unique chatIds
      const chatIds = userChats.map(chat => chat.chatId);

      // Fetch corresponding chat names
      const collectionChats = fastify.mongo.db.collection('chats');
      const chatsDetails = await collectionChats.find({ _id: { $in: chatIds } }).toArray();

      // Create a map of chatId to chatName
      const chatMap = {};
      chatsDetails.forEach(chat => {
        chatMap[chat._id.toString()] = chat.name;
      });

      // Attach chatName to each userChat
      const enrichedChats = userChats.map(chat => ({
        ...chat,
        name: chatMap[chat.chatId.toString()] || 'Unknown Chat'
      }));

      return reply.view('/admin/chats', { 
        user: request.user,
        chats: enrichedChats 
      });
    } catch (error) {
      console.error('Error fetching chats:', error);
      return reply.status(500).send({ error: error.message });
    }
  });
      
  fastify.get('/admin/users/cleanup', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const db = fastify.mongo.db;
      const resultMessage = await cleanupNonRegisteredUsers(db);

      return reply.send({ message: resultMessage });
    } catch (error) {
      console.log(error);
      return reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/admin/prompts', async (request, reply) => {
    try {
      let user = request.user;
      const userId = user._id;
      const isAdmin = await checkUserAdmin(fastify, userId);
      if (!isAdmin) {
          return reply.status(403).send({ error: 'Access denied' });
      }
      const db = fastify.mongo.db;
      user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });
      const translations = request.translations

      const prompts = await db.collection('prompts').find().toArray();

      return reply.view('/admin/prompts', {
        title: 'コミュニティからの最新投稿 | LAMIX | 日本語 | 無料AI画像生成 | 無料AIチャット',
        user,
        prompts,
        translations
      });
    } catch (error) {
      console.log(error)
    }
  });
  fastify.get('/admin/system-prompts', async (request, reply) => {
    try {
      let user = request.user;
      const userId = user._id;
      const isAdmin = await checkUserAdmin(fastify, userId);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }
      
      const db = fastify.mongo.db;
      user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });
      const translations = request.translations;

      // Get system prompts from database
      const systemPrompts = await db.collection('systemPrompts').find().sort({ createdAt: -1 }).toArray();

      return reply.view('/admin/system-prompt', {
        title: translations.system_prompt?.title || 'System Prompt Management',
        user,
        systemPrompts,
        translations
      });
    } catch (error) {
      console.error('Error loading system prompts:', error);
      return reply.status(500).send({ error: error.message });
    }
  });
  fastify.post('/api/prompts/create', async (request, reply) => {
      try {
        const db = fastify.mongo.db;
        const collection = db.collection('prompts');
        const parts = request.parts();
        let title = '';
        let promptText = '';
        let nsfw = false; // Default to false
        let gender = '';
        let cost = 0; // Default cost to 0
        let imageUrl = '';
        
        // Calculate order for the new prompt
        const order = await collection.countDocuments({});

        for await (const part of parts) {
          if (part.file && part.fieldname === 'image') {
            imageUrl = await handleFileUpload(part, db);
          } else if (part.fieldname === 'title') {
            title = part.value;
          } else if (part.fieldname === 'prompt') {
            promptText = part.value;
          } else if (part.fieldname === 'nsfw') {
            nsfw = true; // Checkbox was checked
          } else if (part.fieldname === 'gender') {
            gender = part.value;
          } else if (part.fieldname === 'cost') {
            cost = parseFloat(part.value) || 0;
          }
        }
        
        if (!title || !promptText || !imageUrl) {
          return reply.status(400).send({ success: false, message: 'Title, prompt, and image are required.' });
        }

        await collection.insertOne({
          title,
          prompt: promptText,
          nsfw,
          gender,
          cost,
          image: imageUrl,
          order, // Add order field
          createdAt: new Date(),
        });
        
        reply.send({ success: true, message: 'Prompt created successfully' });
      } catch (error) {
        console.error('Error creating prompt:', error);
        reply.status(500).send({ success: false, message: 'Error creating prompt' });
      }
    });
    
    // Get All Prompts (Optional)
    fastify.get('/api/prompts', async (request, reply) => {
        try {
        const db = fastify.mongo.db;
        // Sort by order, then by _id for consistent ordering if order numbers are not unique (though they should be)
        const prompts = await db.collection('prompts').find({}).sort({order: 1, _id: -1}).toArray();
        reply.send(prompts);
        } catch (error) {
        console.error('Error fetching prompts:', error);
        reply.status(500).send({ success: false, message: 'Error fetching prompts' });
        }
    });
    
    // Get Single Prompt
    fastify.get('/api/prompts/:id', async (request, reply) => {
        try {
        const db = fastify.mongo.db;
        const { id } = request.params;
        // Assuming getPromptById is a simple findOne
        const prompt = await db.collection('prompts').findOne({ _id: new fastify.mongo.ObjectId(id) });
        if (!prompt) {
            return reply.status(404).send({ success: false, message: 'Prompt not found' });
        }
        reply.send(prompt);
        } catch (error) {
        console.error('Error fetching prompt:', error);
        reply.status(500).send({ success: false, message: 'Error fetching prompt' });
        }
    });
    
    // Update Prompt
    fastify.put('/api/prompts/:id', async (request, reply) => {
        try {
            const db = fastify.mongo.db;
            const { id } = request.params;
            const parts = request.parts();
            
            const updatePayload = { $set: { updatedAt: new Date() } };
            let nsfwFromPayload = false; // Assume false unless checkbox is checked
            let imageFieldPresent = false;

            for await (const part of parts) {
                if (part.file) {
                    if (part.fieldname === 'image' && part.file.filename) {
                        const imageUrl = await handleFileUpload(part, db);
                        if (imageUrl) updatePayload.$set.image = imageUrl;
                        imageFieldPresent = true;
                    }
                } else {
                    // Non-file parts
                    if (part.fieldname === 'title') updatePayload.$set.title = part.value;
                    if (part.fieldname === 'prompt') updatePayload.$set.prompt = part.value;
                    if (part.fieldname === 'gender') updatePayload.$set.gender = part.value;
                    if (part.fieldname === 'cost') updatePayload.$set.cost = parseFloat(part.value) || 0;
                    if (part.fieldname === 'nsfw') nsfwFromPayload = true; // 'on' if checked
                }
            }
            updatePayload.$set.nsfw = nsfwFromPayload;

            // If 'image' was not part of the form data at all, don't try to update it (even to null)
            // The logic with handleFileUpload should ensure image is only set if a file is uploaded.
            // If no image is sent, updatePayload.$set.image will not be set, preserving the old one.

            const result = await db.collection('prompts').updateOne(
                { _id: new fastify.mongo.ObjectId(id) },
                updatePayload
            );
    
            if (result.matchedCount === 0) {
                return reply.status(404).send({ success: false, message: 'Prompt not found' });
            }
    
            reply.send({ success: true, message: 'Prompt updated successfully' });
        } catch (error) {
            console.error('Error updating prompt:', error);
            reply.status(500).send({ success: false, message: 'Error updating prompt' });
        }
    });

    // Update individual field (for inline editing)
    fastify.patch('/api/prompts/:id/field', async (request, reply) => {
        try {
            const db = fastify.mongo.db;
            const { id } = request.params;
            const updateData = request.body;
            
            // Validate the field being updated
            const allowedFields = ['title', 'prompt', 'cost', 'nsfw'];
            const fieldName = Object.keys(updateData)[0];
            
            if (!allowedFields.includes(fieldName)) {
                return reply.status(400).send({ success: false, message: 'Invalid field name' });
            }
            
            let fieldValue = updateData[fieldName];
            
            // Type conversion and validation
            if (fieldName === 'cost') {
                fieldValue = parseFloat(fieldValue);
                if (isNaN(fieldValue) || fieldValue < 0) {
                    return reply.status(400).send({ success: false, message: 'Invalid cost value' });
                }
            } else if (fieldName === 'nsfw') {
                fieldValue = Boolean(fieldValue);
            }
            
            const updatePayload = {
                $set: {
                    [fieldName]: fieldValue,
                    updatedAt: new Date()
                }
            };
            
            const result = await db.collection('prompts').findOneAndUpdate(
                { _id: new fastify.mongo.ObjectId(id) },
                updatePayload,
                { returnDocument: 'after' }
            );
            
            if (!result.value) {
                return reply.status(404).send({ success: false, message: 'Prompt not found' });
            }
            
            reply.send(result.value);
        } catch (error) {
            console.error('Error updating prompt field:', error);
            reply.status(500).send({ success: false, message: 'Error updating prompt field' });
        }
    });

    fastify.delete('/api/prompts/:id', async (request, reply) => {
        try {
        const db = fastify.mongo.db;
        const { id } = request.params;
        const result = await db.collection('prompts').deleteOne({ _id: new fastify.mongo.ObjectId(id) });
        if (result.deletedCount === 0) {
            return reply.status(404).send({ success: false, message: 'Prompt not found' });
        }
        reply.send({ success: true, message: 'Prompt deleted successfully' });
        } catch (error) {
        console.error('Error deleting prompt:', error);
        reply.status(500).send({ success: false, message: 'Error deleting prompt' });
        }
    });

    fastify.post('/api/prompts/reorder', async (request, reply) => {
      try {
        const db = fastify.mongo.db;
        const { orderedIds } = request.body; // Changed from promptIds to orderedIds

        if (!Array.isArray(orderedIds)) { // Changed from promptIds to orderedIds
          return reply.status(400).send({ success: false, message: 'Invalid payload: orderedIds must be an array.' });
        }

        const collection = db.collection('prompts');
        const operations = orderedIds.map((id, index) => { // Changed from promptIds to orderedIds
          return {
            updateOne: {
              filter: { _id: new fastify.mongo.ObjectId(id) },
              update: { $set: { order: index } }
            }
          };
        });

        if (operations.length > 0) {
          await collection.bulkWrite(operations);
        }

        reply.send({ success: true, message: 'Prompts reordered successfully.' });
      } catch (error) {
        console.error('Error reordering prompts:', error);
        reply.status(500).send({ success: false, message: 'Error reordering prompts.' });
      }
    });

  fastify.get('/admin/civitai', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const db = fastify.mongo.db;
      const chatsCollection = db.collection('chats');
      const modelsCollection = db.collection('myModels');
      const settingsCollection = db.collection('systemSettings');
      const translations = request.translations;

      // Get cron settings
      const cronSettings = await settingsCollection.findOne({ type: 'modelChatCron' }) || {
        schedule: '0 */2 * * *',
        enabled: false,
        nsfw: false
      };
      
      // If the cronManager module is available and job exists, get next run time
      if (fastify.cronJobs && cronSettings.enabled && cronSettings.schedule) {
        const { getNextRunTime } = require('../models/cronManager');
        cronSettings.nextRun = getNextRunTime('modelChatGenerator');
      }

      // Get all models
      const models = await modelsCollection.find({}).toArray();
      
      // Get system generated chats from the past week
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      

      // Get system generated chats without date filtering first
      const recentChats = await chatsCollection.find({
        systemGenerated: true,
        chatImageUrl: { $exists: true },
        // Remove the createdAt filter for now
      }).sort({ _id: -1 }).limit(100).toArray(); // Get more results for filtering

      // Filter in JavaScript to handle both date formats
      const filteredChats = recentChats.filter(chat => {
        if (!chat.createdAt) return false;
        
        // Handle if createdAt is a string
        if (typeof chat.createdAt === 'string') {
          try {
            const chatDate = new Date(chat.createdAt);
            return chatDate >= oneWeekAgo;
          } catch (e) {
            console.error('Error parsing date:', chat.createdAt, e);
            return false;
          }
        }
        
        // Handle if createdAt is already a Date
        return chat.createdAt >= oneWeekAgo;
      }).slice(0, 20); // Limit to 20 after filtering

      // Group chats by model
      const chatsByModel = {};
      for (const chat of filteredChats) {
        if (!chatsByModel[chat.imageModel]) {
          chatsByModel[chat.imageModel] = [];
        }
        chatsByModel[chat.imageModel].push(chat);
      }

      // Add model data
      const modelsWithChats = models.map(model => {
        return {
          ...model,
          chats: chatsByModel[model.model] || [],
          hasRecentChat: (chatsByModel[model.model] || []).some(chat => {
            const chatDate = new Date(chat.createdAt);
            const today = new Date();
            return chatDate.toDateString() === today.toDateString();
          })
        };
      });

      return reply.view('/admin/civitai', {
        title: translations.admin_model_chats?.title || 'Model Chats',
        user: request.user,
        models: modelsWithChats,
        recentChats: filteredChats,
        cronSettings,
        translations
      });
    } catch (error) {
      console.error('Error loading model chats:', error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });


  // Add new route to check if a user exists in Clerk
  fastify.get('/admin/clerk/check-user', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }
      
      const { email } = request.query;
      if (!email) {
        return reply.status(400).send({ error: 'Email is required' });
      }
      
      // Fetch user data from Clerk API
      const clerkApiUrl = 'https://api.clerk.com/v1/users';
      const clerkSecretKey = process.env.CLERK_SECRET_KEY;
      
      if (!clerkSecretKey) {
        return reply.status(500).send({ error: 'Clerk secret key not configured' });
      }
      
      const response = await axios.get(`${clerkApiUrl}?email_address=${encodeURIComponent(email)}`, {
        headers: {
          'Authorization': `Bearer ${clerkSecretKey}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.data && response.data.data && response.data.data.length > 0) {
        // User exists in Clerk
        return reply.send({ 
          exists: true, 
          clerkId: response.data.data[0].id 
        });
      } else {
        // User does not exist in Clerk
        return reply.send({ exists: false });
      }
    } catch (error) {
      console.error('Error checking Clerk user:', error);
      return reply.status(500).send({ error: 'Failed to check user in Clerk' });
    }
  });
  
  // Add new route to add a user to Clerk
  fastify.post('/admin/clerk/add-user', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }
      
      const { userId, sendEmailInvite, skipPasswordCreation } = request.body;
      if (!userId) {
        return reply.status(400).send({ error: 'User ID is required' });
      }
      
      // Get user details from database
      const usersCollection = fastify.mongo.db.collection('users');
      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
      
      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }
      
      if (!user.email) {
        return reply.status(400).send({ error: 'User does not have an email address' });
      }
      
      // Create user in Clerk API
      const clerkApiUrl = 'https://api.clerk.com/v1/users';
      const clerkSecretKey = process.env.CLERK_SECRET_KEY;
      
      if (!clerkSecretKey) {
        return reply.status(500).send({ error: 'Clerk secret key not configured' });
      }
      
      console.log('User data being sent to Clerk:', user);
      
      // Create the payload for Clerk API
      const payload = {
        email_addresses: [{ 
          email_address: user.email 
        }],
        first_name: user.firstName || user.nickname || '',
        last_name: user.lastName || '',
        username: user.username || user.nickname
      };
      
      // Add password if available, or handle password requirement based on skipPasswordCreation
      if (user.password) {
        // Use a temporary password if user has a hashed password in our database
        // Note: Since we can't unhash the password, we'll need to use a temporary one
        const tempPassword = Math.random().toString(36).slice(-8);
        payload.password = tempPassword;
      } else if (!skipPasswordCreation) {
        // If not skipping password creation and no password exists, use a random one
        const tempPassword = Math.random().toString(36).slice(-8);
        payload.password = tempPassword;
      } else {
        // If skipping password creation
        payload.password_enabled = false;
        payload.skip_password_requirement = true;
        payload.skip_password_checks = true;
      }
      
      // Add email invitation option
      if (sendEmailInvite) {
        payload.send_email_invitation = true;
      }
      
      console.log('Sending payload to Clerk:', JSON.stringify(payload));
      const response = await axios.post(clerkApiUrl, payload, {
        headers: {
          'Authorization': `Bearer ${clerkSecretKey}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.data && response.data.id) {
        // Update user record with Clerk ID
        await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { clerkId: response.data.id } }
        );
        
        return reply.send({ 
          success: true, 
          clerkId: response.data.id 
        });
      } else {
        return reply.status(500).send({ error: 'Failed to create user in Clerk' });
      }
    } catch (error) {
      console.error('Error adding user to Clerk:', error);
      let errorMessage = 'Failed to add user to Clerk';
       
      // Extract detailed error message from Clerk API response
      if (error.response && error.response.data) {
        console.log('Clerk API error response:', JSON.stringify(error.response.data));
        
        if (error.response.data.errors && error.response.data.errors.length > 0) {
          errorMessage = error.response.data.errors.map(e => e.message || e.long_message || JSON.stringify(e)).join(', ');
        }
      }
      
      return reply.status(500).send({ error: errorMessage });
    }
  });

  // Add new route for bulk adding users to Clerk
  fastify.post('/admin/clerk/bulk-add-users', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }
      
      const { users, sendEmailInvite, skipPasswordCreation } = request.body;
      if (!users || !Array.isArray(users) || users.length === 0) {
        return reply.status(400).send({ error: 'No users provided' });
      }
      
      // Set progress tracking in a global variable
      fastify.bulkClerkProgress = {
        total: users.length,
        processed: 0,
        added: 0,
        existing: 0,
        failed: 0,
        results: []
      };
      
      // Process users in batches to avoid overwhelming the Clerk API
      const batchSize = 5;
      const results = [];
      
      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        
        // Process each user in the batch concurrently
        const promises = batch.map(async (user) => {
          try {
            if (!user.email) {
              fastify.bulkClerkProgress.processed++;
              fastify.bulkClerkProgress.failed++;
              return { userId: user.userId, error: 'No email address', added: false };
            }
            
            // Check if user already has a clerkId in our database
            const dbUser = await fastify.mongo.db.collection('users').findOne({ _id: new ObjectId(user.userId) });
            if (!dbUser) {
              fastify.bulkClerkProgress.processed++;
              fastify.bulkClerkProgress.failed++;
              return { userId: user.userId, error: 'User not found in database', added: false };
            }
            
            if (dbUser.clerkId) {
              fastify.bulkClerkProgress.processed++;
              fastify.bulkClerkProgress.existing++;
              return { userId: user.userId, clerkId: dbUser.clerkId, added: false, existing: true };
            }
            
            // Check if user already exists in Clerk by email
            const checkResponse = await axios.get(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(user.email)}`, {
              headers: {
                'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`,
                'Content-Type': 'application/json',
              },
            });
            
            if (checkResponse.data && checkResponse.data.data && checkResponse.data.data.length > 0) {
              // User already exists in Clerk
              const clerkId = checkResponse.data.data[0].id;
              
              // Update user record with Clerk ID if needed
              await fastify.mongo.db.collection('users').updateOne(
                { _id: new ObjectId(user.userId) },
                { $set: { clerkId } }
              );
              
              fastify.bulkClerkProgress.processed++;
              fastify.bulkClerkProgress.existing++;
              return { userId: user.userId, clerkId, added: false, existing: true };
            }
            
            // Create user in Clerk API
            const payload = {
              email_addresses: [{ email_address: dbUser.email }],
              first_name: dbUser.firstName || dbUser.nickname || '',
              last_name: dbUser.lastName || '',
              username: dbUser.username || dbUser.nickname,
              password_enabled: !skipPasswordCreation,
              skip_password_requirement: skipPasswordCreation,
              skip_password_checks: skipPasswordCreation,
              send_email_invitation: sendEmailInvite
            };
            
            const response = await axios.post('https://api.clerk.com/v1/users', payload, {
              headers: {
                'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`,
                'Content-Type': 'application/json',
              },
            });
            
            if (response.data && response.data.id) {
              // Update user record with Clerk ID
              await fastify.mongo.db.collection('users').updateOne(
                { _id: new ObjectId(user.userId) },
                { $set: { clerkId: response.data.id } }
              );
              
              fastify.bulkClerkProgress.processed++;
              fastify.bulkClerkProgress.added++;
              return { userId: user.userId, clerkId: response.data.id, added: true };
            } else {
              fastify.bulkClerkProgress.processed++;
              fastify.bulkClerkProgress.failed++;
              return { userId: user.userId, error: 'Failed to create user in Clerk', added: false };
            }
          } catch (error) {
            console.error(`Error processing user ${user.userId}:`, error);
            let errorMessage = 'Failed to add user to Clerk';
            if (error.response && error.response.data && error.response.data.errors) {
              errorMessage = error.response.data.errors.map(e => e.message).join(', ');
            }
            
            fastify.bulkClerkProgress.processed++;
            fastify.bulkClerkProgress.failed++;
            return { userId: user.userId, error: errorMessage, added: false };
          }
        });
        
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
        fastify.bulkClerkProgress.results = results;
        
        // Add a small delay between batches to avoid rate limiting
        if (i + batchSize < users.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      return reply.send({ 
        success: true, 
        total: users.length,
        added: fastify.bulkClerkProgress.added,
        existing: fastify.bulkClerkProgress.existing,
        failed: fastify.bulkClerkProgress.failed,
        results
      });
    } catch (error) {
      console.error('Error in bulk add to Clerk:', error);
      return reply.status(500).send({ error: 'Failed to process bulk add to Clerk' });
    }
  });

  // Get bulk progress
  fastify.get('/admin/clerk/bulk-progress', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }
      
      const progress = fastify.bulkClerkProgress || {
        total: 0,
        processed: 0,
        progress: 0
      };
      
      const progressPercent = progress.total > 0 
        ? Math.floor((progress.processed / progress.total) * 100) 
        : 0;
      
      return reply.send({
        total: progress.total,
        processed: progress.processed,
        progress: progressPercent
      });
    } catch (error) {
      console.error('Error getting bulk progress:', error);
      return reply.status(500).send({ error: 'Failed to get bulk progress' });
    }
  });
  
  fastify.get('/admin/gifts', async (request, reply) => {
    try {
      let user = request.user;
      const userId = user._id;
      const isAdmin = await checkUserAdmin(fastify, userId);
      if (!isAdmin) {
          return reply.status(403).send({ error: 'Access denied' });
      }
      const db = fastify.mongo.db;
      user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });
      const translations = request.translations

      const gifts = await db.collection('gifts').find().toArray();

      return reply.view('/admin/gifts', {
        title: 'ギフト管理 | LAMIX | 日本語 | 無料AI画像生成 | 無料AIチャット',
        user,
        gifts,
        translations
      });
    } catch (error) {
      console.log(error)
    }
  });

  // Admin API: Set SFW image as character thumbnail
  // This finds a non-NSFW image from the character's gallery and sets it as the chatImageUrl
  fastify.post('/api/admin/character/:chatId/set-sfw-thumbnail', async (request, reply) => {
    try {
      const user = request.user;
      const isAdmin = await checkUserAdmin(fastify, user._id);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const { chatId } = request.params;
      
      if (!ObjectId.isValid(chatId)) {
        return reply.status(400).send({ error: 'Invalid chat ID' });
      }

      const db = fastify.mongo.db;
      const chatsCollection = db.collection('chats');
      const galleryCollection = db.collection('gallery');

      // Check if chat exists
      const chat = await chatsCollection.findOne({ _id: new ObjectId(chatId) });
      if (!chat) {
        return reply.status(404).send({ error: 'Character not found' });
      }

      // Find a SFW (non-NSFW) image from the character's gallery
      const galleryDoc = await galleryCollection.findOne({ chatId: new ObjectId(chatId) });
      
      if (!galleryDoc || !galleryDoc.images || galleryDoc.images.length === 0) {
        return reply.status(404).send({ error: 'No images found in character gallery' });
      }

      // Find the first SFW image (nsfw is false or undefined)
      const sfwImage = galleryDoc.images.find(img => 
        img.imageUrl && (img.nsfw === false || img.nsfw === undefined || img.nsfw === null)
      );

      if (!sfwImage) {
        return reply.status(404).send({ error: 'No SFW images found in character gallery' });
      }

      // Update the character's chatImageUrl with the SFW image
      const updateResult = await chatsCollection.updateOne(
        { _id: new ObjectId(chatId) },
        { 
          $set: { 
            chatImageUrl: sfwImage.imageUrl,
            updatedAt: new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })
          } 
        }
      );

      if (updateResult.matchedCount === 0) {
        return reply.status(500).send({ error: 'Failed to update character thumbnail' });
      }

      console.log(`[Admin] Set SFW thumbnail for character ${chatId}: ${sfwImage.imageUrl}`);

      return reply.send({
        success: true,
        message: 'Character thumbnail updated to SFW image',
        newImageUrl: sfwImage.imageUrl
      });

    } catch (error) {
      console.error('[Admin] Error setting SFW thumbnail:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // API endpoint for fetching paginated users data
  fastify.get('/api/admin/users/paginated', async (request, reply) => {
    try {
      const isAdmin = await checkUserAdmin(fastify, request.user._id);
      if (!isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const page = Math.max(1, parseInt(request.query.page) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(request.query.limit) || 10));
      const skip = (page - 1) * limit;
      const userType = request.query.userType || 'registered'; // 'registered' or 'recent'

      const usersCollection = fastify.mongo.db.collection('users');

      let query = {};
      if (userType === 'registered') {
        query = { email: { $exists: true } };
      } else if (userType === 'recent') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        query = {
          createdAt: { $gte: yesterday, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
        };
      }

      const totalUsers = await usersCollection.countDocuments(query);
      const users = await usersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      const totalPages = Math.ceil(totalUsers / limit);

      return reply.send({
        success: true,
        data: users,
        pagination: {
          page,
          limit,
          totalUsers,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      });
    } catch (error) {
      console.error('Error fetching paginated users:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

module.exports = routes;
