const { ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const { createHash } = require('crypto');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const { checkLimits, checkUserAdmin, getUserData, updateUserLang, listFiles, uploadToS3, getApiUrl } = require('../models/tool');
const { moderateImage } = require('../models/openai');
const { refreshAccessToken, addContactToCampaign } = require('../models/zohomail');
const { trackConversion } = require('../models/affiliation-utils');
const { 
  getCreatorProfile, 
  updateCreatorProfile, 
  formatCreatorForDisplay,
  getCreatorCategories 
} = require('../models/creator-utils');

async function routes(fastify, options) {

  fastify.get('/user/clerk-auth', async (request, reply) => {
    try {
      const clerkId = request.headers['x-clerk-user-id'];
  
      if (!clerkId) {
        console.warn('[/user/clerk-auth] No clerkId found in header');
        return reply.status(401).send({ error: 'Unauthorized' });
      }
  
      // Fetch user data from Clerk
      const clerkApiUrl = `https://api.clerk.com/v1/users/${clerkId}`;
      const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  
      if (!clerkSecretKey) {
        console.error('[/user/clerk-auth] CLERK_SECRET_KEY is not set in environment variables.');
        return reply.status(500).send({ error: 'Clerk secret key not configured' });
      }
  
      let clerkUserData;
      try {
        const response = await axios.get(clerkApiUrl, {
          headers: {
            'Authorization': `Bearer ${clerkSecretKey}`,
            'Content-Type': 'application/json',
          },
        });
  
        if (response.status !== 200) {
          console.error(`[/user/clerk-auth] Failed to fetch user data from Clerk API. Status: ${response.status}`);
          return reply.status(500).send({ error: 'Failed to fetch user data from Clerk' });
        }
  
        clerkUserData = response.data;
      } catch (axiosError) {
        console.error('[/user/clerk-auth] Error fetching user data from Clerk:', axiosError.message);
        return reply.status(500).send({ error: 'Failed to fetch user data from Clerk' });
      }
  
      const usersCollection = fastify.mongo.db.collection('users');
      let user = await usersCollection.findOne({ clerkId });
      console.log(`[/user/clerk-auth] User found with clerkId ${clerkId}: ${!!user}`);
  
      if (!user) {
        // Check for referrer from cookies or localStorage
        const referrerSlug = request.cookies.referrer;
        let referrerId = null;
        
        if (referrerSlug) {
          try {
            referrerId = await trackConversion(fastify.mongo.db, referrerSlug);
            console.log(`[/user/clerk-auth] Referrer found: ${referrerSlug}, Referrer ID: ${referrerId}`);
          } catch (error) {
            console.error('[/user/clerk-auth] Error tracking referral:', error);
          }
        }

        // Create a new user with Clerk data
        user = {
          clerkId,
          createdAt: new Date(),
          coins: 100,
          points: 100,
          lang: request.lang,
          username: clerkUserData.username,
          nickname: clerkUserData.username,
          firstName: clerkUserData.first_name,
          lastName: clerkUserData.last_name,
          fullName: clerkUserData.full_name,
          email: clerkUserData.email_addresses[0]?.email_address,
          subscriptionStatus: 'inactive',
          ...(referrerId && { referrer: new ObjectId(referrerId) })
        };
        const result = await usersCollection.insertOne(user);
        user._id = result.insertedId;
        console.log(`New user created with clerkId ${clerkId} and _id ${user._id}`);

        // Clear referrer cookie after successful registration
        if (referrerSlug) {
          reply.clearCookie('referrer');
        }
      } else {
        // Check if database username matches Clerk username
        if (user.username !== clerkUserData.username || user.nickname !== clerkUserData.username) {
          // Update database user with Clerk data
          const updateData = {
            username: clerkUserData.username,
            nickname: clerkUserData.username,
            firstName: clerkUserData.first_name,
            lastName: clerkUserData.last_name,
            fullName: clerkUserData.full_name,
            email: clerkUserData.email_addresses[0]?.email_address,
          };
  
          await usersCollection.updateOne(
            { clerkId },
            { $set: updateData }
          );
  
          // Update the user object with the new data
          Object.assign(user, updateData);
          console.log(`[/user/clerk-auth] Updated user with clerkId ${clerkId} to match Clerk data`);
        }
  
        // Initialize points if not present
        if (user.points === undefined) {
          await usersCollection.updateOne(
            { clerkId },
            { $set: { points: 100 } }
          );
          user.points = 100;
        }
  
        // Check for subscription status if not present
        if (!user.subscriptionStatus) {
          const subscriptionInfo = await fastify.mongo.db.collection('subscriptions').findOne({
            _id: new fastify.mongo.ObjectId(user._id)
          });
  
          if (subscriptionInfo && subscriptionInfo.subscriptionStatus === 'active') {
            await usersCollection.updateOne(
              { _id: user._id },
              { $set: { subscriptionStatus: 'active' } }
            );
            user.subscriptionStatus = 'active';
          } else {
            await usersCollection.updateOne(
              { _id: user._id },
              { $set: { subscriptionStatus: 'inactive' } }
            );
            user.subscriptionStatus = 'inactive';
          }
        }
      }
  
      await updateUserLang(fastify.mongo.db, user._id, request.lang);
      const token = jwt.sign({ _id: user._id, clerkId: user.clerkId }, process.env.JWT_SECRET, { expiresIn: '24h' });
      console.log(`[user] JWT token created for user ${user._id}`);
  
      // Set the cookie and redirect
      reply.setCookie('token', token, { path: '/', httpOnly: true });
      console.log('Redirect to /dashboard')
      return reply.send({ redirectUrl: '/dashboard' });
  
    } catch (err) {
      console.log(`Error in /user/clerk-auth: ${err.message}`, err);
      return reply.status(500).send({ error: 'Server error' });
    }
  });

  fastify.post('/user/clerk-update', async (request, reply) => {
    try {
      const clerkUser = request.body;
      if(!clerkUser){
        return reply.send({error:`User not founded`})
      }
      const clerkId = clerkUser.id;

      if (!clerkId) {
        console.warn('No clerkId found in request body');
        return reply.status(400).send({ error: 'clerkId is required' });
      }

      // Fetch user data from Clerk
      const clerkApiUrl = `https://api.clerk.com/v1/users/${clerkId}`;
      const clerkSecretKey = process.env.CLERK_SECRET_KEY;

      if (!clerkSecretKey) {
        console.error('CLERK_SECRET_KEY is not set in environment variables.');
        return reply.status(500).send({ error: 'Clerk secret key not configured' });
      }

      try {
        const response = await axios.get(clerkApiUrl, {
          headers: {
            'Authorization': `Bearer ${clerkSecretKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.status !== 200) {
          console.error(`Failed to fetch user data from Clerk API. Status: ${response.status}`);
          return reply.status(500).send({ error: 'Failed to fetch user data from Clerk' });
        }

        const clerkUserData = response.data;

        const usersCollection = fastify.mongo.db.collection('users');
        const user = await usersCollection.findOne({ clerkId });

        if (!user) {
          console.warn(`No user found with clerkId ${clerkId}`);
          return reply.status(404).send({ error: 'User not found' });
        }

        // Update user data in database
        const updateData = {
          username: clerkUserData.username,
          nickname: clerkUserData.username,
          firstName: clerkUserData.first_name,
          lastName: clerkUserData.last_name,
          fullName: clerkUserData.full_name,
          email: clerkUserData.email_addresses[0]?.email_address,
        };
         
        // Check for subscription status
        const subscriptionInfo = await fastify.mongo.db.collection('users').findOne({
          _id: new ObjectId(user._id)
        });
        if (subscriptionInfo && subscriptionInfo.subscriptionStatus === 'active') {
          updateData.subscriptionStatus = 'active';
        } else {
          updateData.subscriptionStatus = 'inactive';
        }

        const result = await usersCollection.updateOne(
          { clerkId },
          { $set: updateData }
        );

        // If user has updated their nickname in our system, update it in Clerk too
        if (user.nickname && user.nickname !== clerkUserData.username) {
          await updateClerkUsername(clerkId, user.nickname, clerkSecretKey);
        }

        return reply.send({ status: 'User information successfully updated' });
      } catch (axiosError) {
        console.error('Error fetching user data from Clerk:', axiosError.message);
        return reply.status(500).send({ error: 'Failed to fetch user data from Clerk' });
      }
    } catch (err) {
      console.error(`Error in /user/clerk-update: ${err.message}`, err);
      return reply.status(500).send({ error: 'Server error' });
    }
  });

  // Helper function to update Clerk username
  async function updateClerkUsername(clerkId, username, clerkSecretKey) {
    try {
      const clerkApiUrl = `https://api.clerk.com/v1/users/${clerkId}`;
      
      const response = await axios.patch(clerkApiUrl, 
        { username },
        {
          headers: {
            'Authorization': `Bearer ${clerkSecretKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.status !== 200) {
        console.error(`Failed to update username in Clerk. Status: ${response.status}`);
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('Error updating Clerk username:', error.message);
      return false;
    }
  }
  fastify.post('/user/update-nsfw-preference/:userId', async (request, reply) => {
    try {
      const userId = request.params.userId;
      const { showNSFW } = request.body;

      if (!userId) {
        return reply.status(400).send({ error: 'User ID is required' });
      }

      const usersCollection = fastify.mongo.db.collection('users');
      
      // Build query - check if userId is a valid ObjectId, otherwise try clerkId
      let query;
      if (ObjectId.isValid(userId) && String(new ObjectId(userId)) === userId) {
        query = { _id: new ObjectId(userId) };
      } else {
        // userId might be a clerkId (starts with "user_" from Clerk)
        query = { clerkId: userId };
      }

      const updateResult = await usersCollection.updateOne(
        query,
        { $set: { showNSFW: showNSFW } }
      );

      if (updateResult.modifiedCount === 0) {
        const findUser = await usersCollection.findOne(query);
        if (!findUser) {
          return reply.status(404).send({ error: 'User not found' });
        }
        if (findUser.showNSFW === showNSFW) {
          console.log('User already has the requested NSFW preference');
          return reply.send({ status: 'NSFW preference already set' });
        }
        return reply.status(404).send({ error: 'NSFW preference not updated' });
      }

      return reply.send({ status: 'NSFW preference updated successfully' });
    } catch (error) {
      console.error('Error updating NSFW preference:', error);
      return reply.status(500).send({ error: 'Failed to update NSFW preference' });
    }
  });
  fastify.post('/user/update-info/:currentUserId', async (request, reply) => {
    try {

      if (!request.isMultipart?.()) {
        console.error('Request is not multipart/form-data');
        return reply.status(400).send({ error: 'Request must be multipart/form-data' });
      }

      const currentUserId = request.params.currentUserId;
      const formData = {
        email: null,
        nickname: null,
        bio: null,
        birthYear: null,
        birthMonth: null,
        birthDay: null,
        gender: null,
        profileUrl: null,
        ageVerification: null
      };

      async function processImage(url, onSuccess) {
        const moderation = await moderateImage(url);
        if (!moderation.results[0].flagged) {
          await onSuccess(url);
          fastify.sendNotificationToUser(request.user._id, 'imageModerationFlagged', { flagged: false, currentUserId });
        } else {
          fastify.sendNotificationToUser(request.user._id, 'imageModerationFlagged', { flagged: true, currentUserId });
        }
      }

      // Process each part as it arrives.
      for await (const part of request.parts()) {
        if (part.fieldname && part.value) {
          formData[part.fieldname] = part.value;
        } else if (part.fieldname === 'profile' && part.file) {
          // Consume file stream immediately.
          const chunks = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);
          const hash = createHash('sha256').update(buffer).digest('hex');
          const awsimages = fastify.mongo.db.collection('awsimages');

          const existingFile = await awsimages.findOne({ hash });
          if (existingFile) {
            const imageUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${existingFile.key}`;
            console.log('Profile image already exists in DB');
            await processImage(imageUrl, async (url) => { formData.profileUrl = url; });
            continue;
          }

          let existingFiles;
          try {
            existingFiles = await listFiles(hash);
          } catch (error) {
            console.error('Failed to list objects in S3:', error);
            return reply.status(500).send({ error: 'Failed to check existing profile images' });
          }

          if (existingFiles.Contents?.length > 0) {
            const imageUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${existingFiles.Contents[0].Key}`;
            console.log('Profile image already exists in S3');
            await processImage(imageUrl, async (url) => { formData.profileUrl = url; });
          } else {
            const key = `${hash}_${part.filename}`;
            let uploadUrl;
            try {
              uploadUrl = await uploadToS3(buffer, hash, part.filename || 'uploaded_file');
            } catch (error) {
              console.error('Failed to upload profile image:', error);
              return reply.status(500).send({ error: 'Failed to upload profile image' });
            }
            await processImage(uploadUrl, async (url) => {
              formData.profileUrl = url;
              await awsimages.insertOne({ key, hash });
            });
          }
        }
      }

      console.log('All parts processed');

      if (!currentUserId) {
        console.error('Missing currentUserId');
        return reply.status(400).send({ error: 'Missing currentUserId' });
      }
      console.log('currentUserId:', currentUserId);

      const { token } = request.cookies;
      if (!token) {
        return reply.status(401).send({ error: 'Authentication token is missing' });
      }

      const updateData = {};
      if (formData.email) updateData.email = formData.email;
      if (formData.nickname) updateData.nickname = formData.nickname;
      if (formData.bio) updateData.bio = formData.bio;
      if (formData.birthYear && formData.birthMonth && formData.birthDay) {
        updateData.birthDate = {
          year: formData.birthYear,
          month: formData.birthMonth,
          day: formData.birthDay
        };
      }
      if (formData.gender) updateData.gender = formData.gender;
      if (formData.profileUrl) updateData.profileUrl = formData.profileUrl;
      if (formData.ageVerification) updateData.ageVerification = formData.ageVerification === 'true';
      if (formData.showNSFW !== undefined) {
        updateData.showNSFW = formData.showNSFW === 'true';
      }
      if (Object.keys(updateData).length === 0) {
        return reply.status(400).send({ error: 'No data to update' });
      }

      const usersCollection = fastify.mongo.db.collection('users');
      const updateResult = await usersCollection.updateOne(
        { _id: new fastify.mongo.ObjectId(currentUserId) },
        { $set: updateData }
      );

      if (updateResult.modifiedCount === 0) {
        console.warn('User info update failed');
      }
      const user = await usersCollection.findOne({ _id: new fastify.mongo.ObjectId(currentUserId) });
      delete user.password;
      delete user.purchasedItems;

      return reply.send({ user, status: 'User information successfully updated' });
    } catch (error) {
      console.error('Error in update-info route:', error);
      return reply.status(500).send({ error: 'An internal server error occurred' });
    }
  });


  // Keep the old update-password route
  fastify.post('/user/update-password', async (request, reply) => {
    try {
      const { oldPassword, newPassword } = request.body;
      const { token } = request.cookies;

      if (!token) {
        return reply.status(401).send({ error: '認証トークンがありません' });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded._id;

      const usersCollection = fastify.mongo.db.collection('users');

      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

      if (!user || !(await bcrypt.compare(oldPassword, user.password))) {
        return reply.status(401).send({ error: '無効な古いパスワード' });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      const updateResult = await usersCollection.updateOne(
        { _id: new fastify.mongo.ObjectId(userId) },
        { $set: { password: hashedPassword } }
      );

      if (updateResult.modifiedCount === 0) {
        return reply.status(500).send({ error: 'パスワードの更新に失敗しました' });
      }

      return reply.send({ status: 'パスワードが正常に更新されました' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'サーバーエラーが発生しました' });
    }
  });

  fastify.get('/user/plan/:id', async (request, reply) => {
    try {
      const userId = request.params.id;
      console.log(`[GET] /user/plan/:id - [user/plan] called with userId: ${userId}`);
      if (!userId) {
        console.warn('[user/plan] No userId provided in request params');
        return reply.send({ error: `Plan not founded` });
      }
      // Fetch the user from the database using their ObjectId
      console.log(`[user/plan] Looking up subscription for userId: ${userId}`);
      const existingSubscription = await fastify.mongo.db.collection('subscriptions').findOne({
        userId: new fastify.mongo.ObjectId(userId),
        subscriptionStatus: 'active',
      });
      if (!existingSubscription) {
        console.warn(`[user/plan] No active subscription found for userId: ${userId}`);
      } else {
        console.log(`[user/plan] Active subscription found for userId: ${userId}`);
        //console.log(`[user/plan] Subscription details:`, existingSubscription);
      }
      // Show the user object from request.user
      //console.log(`[user/plan] User object from request.user:`, request.user);
      return reply.send({ plan: existingSubscription });
    } catch (error) {
      console.error(`[user/plan] Error in /user/plan/:id:`, error);
      return reply.send({ error: `Plan not founded` });
    }
  });

  fastify.get('/user/limit/:id', async (request, reply) => {
    try {
      const userId = request.params.id;
      const limits = await checkLimits(fastify, userId)
      return reply.send({limits})
    } catch (error) {
      reply.send({error:`Limit not founded`})
      console.log(error)
    }
  });
 
  fastify.get('/user/:userId', async (request, reply) => {
    const { userId } = request.params;
    const db = fastify.mongo.db
    const collectionChat = db.collection('chats');
    const collectionUser = db.collection('users');

    try {
      let currentUser = request.user;
      const currentUserId = currentUser?._id;
      if (!currentUser?.isTemporary && currentUserId) currentUser = await collectionUser.findOne({ _id: new fastify.mongo.ObjectId(currentUserId) });

      const userData = await getUserData(userId, collectionUser, collectionChat, currentUser);

      if (!userData) {
        return reply.redirect('/my-plan');
      }
      let isMyProfile =  userId.toString() === currentUser?._id.toString();
      let isAdmin = false;
      if(!userData.isTemporary){
       isAdmin = await checkUserAdmin(fastify, currentUser._id);
      }

      // Get creator profile data if user is a creator
      let creatorData = null;
      if (userData.isCreator && userData.creatorProfile) {
        creatorData = formatCreatorForDisplay(userData);
      }

      const translations = request.translations;
      // Add onboarding translations
      const onboardingTranslations = request.translations.onboarding || {};
      const categories = getCreatorCategories();

      // Check if user has premium subscription
      const isPremium = currentUser?.subscriptionStatus === 'active';

      return reply.renderWithGtm('/user-profile.hbs', {
        title: translations.userProfileTitle.replace('{nickname}', userData.nickname),
        translations,
        onboardingTranslations,
        mode: process.env.MODE,
        apiurl: getApiUrl(request),
        isAdmin,
        isMyProfile,
        user: request.user,
        userData,
        creatorData,
        isCreator: userData.isCreator || false,
        categories,
        isPremium
      });
    } catch (error) {
      console.log(error);
      return reply.status(500).send({ error: 'An error occurred' });
    }
  });

  // Get user's creator profile data (API endpoint)
  fastify.get('/api/user/:userId/creator-profile', async (request, reply) => {
    try {
      const { userId } = request.params;
      const db = fastify.mongo.db;

      if (!ObjectId.isValid(userId)) {
        return reply.status(400).send({ success: false, error: 'Invalid user ID' });
      }

      const result = await getCreatorProfile(db, userId);
      return reply.send(result);
    } catch (error) {
      console.error('Error fetching creator profile:', error);
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // Update creator profile settings
  fastify.put('/api/user/creator-profile', async (request, reply) => {
    try {
      if (!request.user || request.user.isTemporary) {
        return reply.status(401).send({ success: false, error: 'Authentication required' });
      }

      const db = fastify.mongo.db;
      const userId = request.user._id;
      const profileData = request.body;

      const result = await updateCreatorProfile(db, userId, profileData);
      return reply.send(result);
    } catch (error) {
      console.error('Error updating creator profile:', error);
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });


  fastify.get('/user/chat-data/:userId', async (request, reply) => {
    const { userId } = request.params;
    const db = fastify.mongo.db
    const collectionChat = db.collection('chats');
    const collectionUser = db.collection('users');

    try {
      let currentUser = request.user
      const currentUserId = currentUser?._id
      if (!currentUser?.isTemporary && currentUserId) await collectionUser.findOne({ _id: new fastify.mongo.ObjectId(currrentUserId) });
      const user = await collectionUser.findOne({ _id: new fastify.mongo.ObjectId(userId) });
      if (!user) return reply.status(404).send({ error: 'User not found' });

      let personas = user.personas || [];
      const validPersonaIds = (await collectionChat.find({ _id: { $in: personas.map(id => new fastify.mongo.ObjectId(id)) } }).toArray()).map(p => p._id.toString());

      if (user.persona && !validPersonaIds.includes(user.persona.toString())) user.persona = null;
      if (user.persona) validPersonaIds.push(user.persona.toString());

      personas = await collectionChat.find({ _id: { $in: [...new Set(validPersonaIds)].map(id => new fastify.mongo.ObjectId(id)) } }).toArray();

      await collectionUser.updateOne(
        { _id: new fastify.mongo.ObjectId(userId) },
        { $set: { personas: validPersonaIds, persona: user.persona || validPersonaIds[0] || null } }
      );

      const chatQuery = {
        $or: [{ userId }, { userId: new fastify.mongo.ObjectId(userId) }],
        visibility: currentUser?._id.toString() === userId ? { $in: ["public", "private"] } : "public"
      };

      const userChats = await collectionChat.find(chatQuery).sort({_id:-1}).toArray();
      const [publicChatCount, privateChatCount] = await Promise.all([
        collectionChat.countDocuments({ ...chatQuery, visibility: "public" }),
        collectionChat.countDocuments({ ...chatQuery, visibility: "private" })
      ]);

      return reply.send({
        isAdmin: currentUser?._id.toString() === userId,
        user: currentUser,
        userData: {
          profileUrl: user.profileUrl,
          nickname: user.nickname,
          coins: user.coins,
        },
        userChats: userChats.map(chat => ({
          _id: chat._id,
          name: chat.name,
          description: chat.description,
          chatImageUrl: chat.chatImageUrl || chat.thumbnailUrl || '',
          tags: chat.tags || [],
          visibility: chat.visibility
        })),
        publicChatCount,
        privateChatCount,
        personas
      });
    } catch (error) {
      console.log(error);
      return reply.status(500).send({ error: 'An error occurred' });
    }
  });
  fastify.post('/user/:userId/follow-toggle', async (request, reply) => {
    const db = fastify.mongo.db
    const usersCollection = db.collection('users');
    const translations = request.translations

    let currentUser = request.user;
    const currentUserId = new fastify.mongo.ObjectId(currentUser?._id);
    const targetUserId = new fastify.mongo.ObjectId(request.params.userId);
    const action = request.body.action == 'true';

    try {
      if (action) {
        await usersCollection.updateOne(
          { _id: currentUserId },
          { $addToSet: { following: targetUserId }, $inc: { followCount: 1 } }
        );
        await usersCollection.updateOne(
          { _id: targetUserId },
          { $addToSet: { followers: currentUserId }, $inc: { followerCount: 1 } }
        );


        // Create a notification for the target user
        const message = `${currentUser?.nickname} ${translations.startFollow} `;
        await fastify.sendNotificationToUser(targetUserId, message, 'info', { followerId: currentUserId });

        reply.send({ message: 'フォローしました！' });
      } else {
        // Check current follow count before decrementing
        let currentUserData = await usersCollection.findOne({ _id: currentUserId });
        let targetUserData = await usersCollection.findOne({ _id: targetUserId });

        if (currentUserData.followCount > 0) {
          await usersCollection.updateOne(
            { _id: currentUserId },
            { $pull: { following: targetUserId }, $inc: { followCount: -1 } }
          );
        }
        if (targetUserData.followerCount > 0) {
          await usersCollection.updateOne(
            { _id: targetUserId },
            { $pull: { followers: currentUserId }, $inc: { followerCount: -1 } }
          );
        }

        reply.send({ message: 'フォローを解除しました！' });
      }
    } catch (err) {
      console.log(err);
      reply.code(500).send({ error: 'リクエストに失敗しました。' });
    }
  });
  fastify.get('/user/:userId/followers-or-followings', async (request, reply) => {
    try {
      const { userId } = request.params;
      const type = request.query.type || 'followers'; // 'followers' or 'following'
      const page = parseInt(request.query.page) || 1;
      const limit = 12; // Number of users per page
      const skip = (page - 1) * limit;

      const db = fastify.mongo.db
      const usersCollection = db.collection('users');

      // Find the user and either get their followers or following list
      const user = await usersCollection.findOne({ _id: new fastify.mongo.ObjectId(userId) });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const list = type === 'followers' ? user.followers : user.following;
      const totalItems = list ? list.length : 0;

      if (!list || totalItems === 0) {
        return reply.send({ users: [], page, totalPages: 0 });
      }

      // Get paginated followers or following
      const paginatedUserIds = list.slice(skip, skip + limit);
      const paginatedUsers = await usersCollection
        .find({ _id: { $in: paginatedUserIds.map(id => new fastify.mongo.ObjectId(id)) } })
        .toArray();

      // Format users for response
      const formattedUsers = paginatedUsers.map(user => ({
        userId: user._id,
        userName: user.nickname || 'Unknown User',
        profilePicture: user.profileUrl || '/img/avatar.png',
        userBio: user.bio || '',
      }));

      const totalPages = Math.ceil(totalItems / limit);

      // Send paginated response
      reply.send({
        users: formattedUsers,
        page,
        totalPages,
      });
    } catch (err) {
      console.log('Error: ', err);
      reply.code(500).send('Internal Server Error');
    }
  });
  fastify.get('/follower/:userId', async (request, reply) => {
    try {
      // Get current user
      let currentUser = request.user;
      const currentUserId = currentUser?._id;

      const db = fastify.mongo.db
      if (!currentUser?.isTemporary && currentUserId) currentUser = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(currentUserId) });

      const { userId } = request.params;
      const type = request.query.type || 'followers'; // Default to 'followers' if type not provided

      // Find the specified user
      const user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Determine which list to return (followers or following)
      let list = type === 'followers' ? user.followers : user.following;

      if (!list || list.length === 0) {
        list = []; // Ensure it's an empty array if there are no followers or following
      }

      // Fetch the users in the followers or following list
      const users = await db.collection('users')
      .find({ _id: { $in: list.map(id => new fastify.mongo.ObjectId(id)) } })
      .toArray() || [];

      const formattedUsers = users.map(user => ({
        userId: user._id.toString(),
        userName: user.nickname || 'Unknown User',
        profilePicture: user.profileUrl || '/img/avatar.png',
      }));

      const isFollowing = currentUser?.following && currentUser?.following.some(followingId => followingId.toString() === user._id.toString());
      const isFollowedBy = user.following && user.following.some(followingId => followingId.toString() === currentUserId.toString());
      const title = `${user.nickname} ${type === 'followers' ? translations.followers.followersListTitleFollowers : translations.followers.followingListTitle}`;

      const translations = request.translations;
      return reply.view('follower.hbs', {
        title,translations,
      mode: process.env.MODE,
      apiurl: getApiUrl(request),
        currentUser: {
          userId: currentUserId,
          userName: currentUser?.nickname,
          profilePicture: currentUser?.profileUrl || '/img/avatar.png',
          postCount: currentUser?.postCount || 0,
          imageLikeCount: currentUser?.imageLikeCount || 0,
          followCount: currentUser?.followCount || 0,
          followerCount: currentUser?.followerCount || 0,
          coins: currentUser?.coins || 0,
        },
        requestedUser: {
          userId: userId,
          userName: user.nickname,
          profilePicture: user.profileUrl || '/img/avatar.png',
          postCount: user.postCount || 0,
          imageLikeCount: user.imageLikeCount || 0,
          followCount: user.followCount || 0,
          followerCount: user.followerCount || 0,
          coins: user.coins || 0,
          follow: isFollowing,
          followedBy: isFollowedBy
        },
        type: type,
        users: formattedUsers,
      });
    } catch (err) {
      console.error('Error:', err);
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  });
  fastify.get('/users/', async (request, reply) => {
    try {
      const page = parseInt(request.query.page, 10) || 1;
      const limit = 5;
      const skip = (page - 1) * limit;

      const db = fastify.mongo.db
      const usersCollection = db.collection('users');

      const usersCursor = await usersCollection
        .find({isTemporary: {$exists:false},nickname: {$exists:true},profileUrl: {$exists:true}})
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      if (!usersCursor.length) {
        return reply.code(404).send({ users: [], page, totalPages: 0 });
      }

      const usersData = usersCursor.map(user => ({
        userId: user._id,
        userName: user.nickname || 'Unknown User',
        profilePicture: user.profileUrl || '/img/avatar.png',
      }));

      const totalUsersCount = await usersCollection.countDocuments({});
      const totalPages = Math.ceil(totalUsersCount / limit);

      reply.send({
        users: usersData,
        page,
        totalPages
      });
    } catch (err) {
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.get('/user/is-admin/:userId', async (req, reply) => {
    try {
      let user = req.user;
      if (user.isTemporary){
        return reply.send({ isAdmin : false });
      }
      const isAdmin = await checkUserAdmin(fastify, req.params.userId);
      return reply.send({ isAdmin });
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.get('/users/:userId/notifications', async (request, reply) => {
    const user = request.user;
    const targetUserId = new ObjectId(request.params.userId);
    const viewed = request.query.viewed;
    const orConditions = [
        { userId: targetUserId },
        { sticky: true, dismissedBy: { $ne: targetUserId } }
    ];

    if (viewed !== undefined) {
        orConditions[0].viewed = viewed === 'true';
    }

    const filter = { $or: orConditions };

    const db = fastify.mongo.db
    const notificationsCollection = db.collection('notifications');
    const notifications = await notificationsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

      reply.send(notifications);
  });
  // Logout route clears the token cookie and other cookies
  fastify.post('/user/logout', async (request, reply) => {
    try {
      const cookies = request.cookies;

      for (const cookieName in cookies) {
        reply.clearCookie(cookieName, { path: '/' });
      }

      // Ensure we're not sending any redirect headers
      return reply.code(200).send({ success: true, message: 'Logout successful' });
    } catch (error) {
      console.log('Logout error:', error);
      return reply.code(500).send({ error: 'Logout failed', message: error.message });
    }
  });

  // Login route to authenticate users with email and password
  fastify.post('/user/login', async (request, reply) => {
    try {
        const { email, password, rememberMe } = request.body;
        const translations = request.translations;
        if (!email || !password) {
            return reply.status(400).send({ error: translations.old_login.missing_credentials });
        }
        
        const usersCollection = fastify.mongo.db.collection('users');
        const user = await usersCollection.findOne({ email });
        
        if (!user) {
            return reply.status(401).send({ error: translations.old_login.invalid_credentials });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
            return reply.status(401).send({ error: translations.old_login.invalid_credentials });
        }
        
        // Update user's language preference
        await updateUserLang(fastify.mongo.db, user._id, request.lang);
        
        // Set token expiration based on rememberMe
        const expiresIn = rememberMe ? '7d' : '24h';
        
        // Generate JWT token
        const token = jwt.sign(
            { _id: user._id }, 
            process.env.JWT_SECRET, 
            { expiresIn }
        );
        
        // Set cookie and return success response without redirect
        reply.setCookie('token', token, { 
            path: '/', 
            httpOnly: true,
            maxAge: rememberMe ? 7 * 24 * 60 * 60 : 24 * 60 * 60 // in seconds
        });
        
        return reply.send({ 
            success: true,
            user: {
                _id: user._id,
                nickname: user.nickname,
                email: user.email
            }
        });
            
    } catch (err) {
        console.error(`Error in /user/login: ${err.message}`, err);
        return reply.status(500).send({ error: translations.old_login.server_error });
    }
  });
    
  // Affiliate page route
  fastify.get('/affiliation', async (request, reply) => {
    try {
      if (!request.user || request.user.isTemporary) {
        return reply.redirect('/login');
      }

      const translations = request.translations;
      const isPremium = request.user?.subscriptionStatus === 'active';
      
      return reply.renderWithGtm('/affiliation/dashboard.hbs', {
        title: 'Affiliate Program - Earn Money with Referrals',
        translations,
        mode: process.env.MODE,
        apiurl: getApiUrl(request),
        user: request.user,
        isPremium
      });
    } catch (error) {
      console.error('Error rendering affiliate page:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Affiliate banking page route
  fastify.get('/affiliation/banking', async (request, reply) => {
    try {
      if (!request.user || request.user.isTemporary) {
        return reply.redirect('/login');
      }

      const translations = request.translations;
      
      return reply.renderWithGtm('/affiliation/banking.hbs', {
        title: 'Banking Information - Affiliate Program',
        translations,
        mode: process.env.MODE,
        apiurl: getApiUrl(request),
        user: request.user,
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY
      });
    } catch (error) {
      console.error('Error rendering banking page:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Add onboarding completion endpoint
  fastify.post('/user/onboarding-complete', async (req, res) => {
    try {
        const { userId, onboardingData, completedAt } = req.body;
        
        if (!userId) {
            return res.status(400).send({ success: false, error: 'User ID required' });
        }

        // Update user with onboarding data
        const updateData = {
            onboardingCompleted: true,
            firstTime: false,
            onboardingData: onboardingData,
            onboardingCompletedAt: completedAt || new Date().toISOString()
        };

        // Apply basic user data if provided
        if (onboardingData.nickname) updateData.nickname = onboardingData.nickname;
        if (onboardingData.gender) updateData.gender = onboardingData.gender;
        if (onboardingData.birthdate) {
            const birthDate = new Date(onboardingData.birthdate);
            updateData.birthDate = birthDate;
        }

        const result = await fastify.mongo.db.collection('users').findOneAndUpdate(
          { _id: new ObjectId(userId) },
          { $set: updateData },
          { new: true }
        );
        
        if (!result.value) {
            return res.status(404).send({ success: false, error: 'User not found' });
        }

        res.send({ 
            success: true, 
            message: 'Onboarding completed successfully',
            user: result.value 
        });

    } catch (error) {
        console.error('Error completing onboarding:', error);
        res.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // Add onboarding reset endpoint
  fastify.post('/user/:userId/reset-onboarding', async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({ success: false, error: 'User ID required' });
        }

        // Reset user onboarding status
        const result = await fastify.mongo.db.collection('users').findOneAndUpdate(
          { _id: new ObjectId(userId) },
          { 
            $set: { 
              onboardingCompleted: false,
              firstTime: true
            },
            $unset: {
              onboardingData: "",
              onboardingCompletedAt: ""
            }
          },
          { new: true }
        );
        
        if (!result.value) {
            return res.status(404).send({ success: false, error: 'User not found' });
        }

        res.send({ 
            success: true, 
            message: 'Onboarding reset successfully'
        });

    } catch (error) {
        console.error('Error resetting onboarding:', error);
        res.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // Add character recommendations endpoint
  fastify.get('/api/character-recommendations', async (req, res) => {
    try {
        const { style = 'anime', interests = '', limit = 4 } = req.query;
        const lang = req.lang || 'en';
        console.log(`[Recommendations] Style: ${style}, Language: ${lang}, Interests: ${interests}`);
        
        // Build query based on preferences
        // Filter for characters with valid chatImageUrl (must be a non-empty string starting with http)
        const query = {
            $and: [
                { chatImageUrl: { $exists: true } },
                { chatImageUrl: { $ne: null } },
                { chatImageUrl: { $ne: '' } },
                { chatImageUrl: { $type: 'string' } },
                { chatImageUrl: { $regex: /^https?:\/\// } }
            ]
        };
        
        // Style is mandatory - always filter by image style
        if (style && style !== 'any') {
            console.log(`[Recommendations] Filtering by imageStyle: ${style}`);
            query.$and.push({ imageStyle: style });
        }

        // Add interest-based filtering if available (but style takes priority)
        if (interests) {
            const interestKeywords = interests.split(',').map(i => i.trim().toLowerCase());
            query.$and.push({
                $or: [
                    { tags: { $in: interestKeywords } },
                    { name: { $regex: interestKeywords.join('|'), $options: 'i' } },
                    { first_message: { $regex: interestKeywords.join('|'), $options: 'i' } }
                ]
            });
        }

        console.log(`[Recommendations] Query:`, JSON.stringify(query));

        // Get recommended characters (with valid image URLs and matching style)
        let characters = await fastify.mongo.db.collection('chats').find(query)
            .project({ _id: 1, name: 1, chatImageUrl: 1, first_message: 1, tags: 1, gender: 1, imageStyle: 1 })
            .limit(parseInt(limit) * 2) // Fetch extra in case some need to be filtered
            .sort({ popularity: -1, createdAt: -1 })
            .toArray();

        // Double-check: Filter out any characters with invalid image URLs
        characters = characters.filter(c => 
            c.chatImageUrl && 
            typeof c.chatImageUrl === 'string' && 
            c.chatImageUrl.trim() !== '' &&
            (c.chatImageUrl.startsWith('http://') || c.chatImageUrl.startsWith('https://'))
        );

        // If not enough characters found, get more with same style (fallback without interests)
        if (characters.length < parseInt(limit)) {
            const existingIds = characters.map(c => c._id);
            const fallbackQuery = {
                $and: [
                    { chatImageUrl: { $exists: true } },
                    { chatImageUrl: { $ne: null } },
                    { chatImageUrl: { $ne: '' } },
                    { chatImageUrl: { $type: 'string' } },
                    { chatImageUrl: { $regex: /^https?:\/\// } },
                    { _id: { $nin: existingIds } }
                ]
            };
            
            // Still respect the style preference in fallback
            if (style && style !== 'any') {
                fallbackQuery.$and.push({ imageStyle: style });
            }
            
            let fallbackCharacters = await fastify.mongo.db.collection('chats').find(fallbackQuery)
                .project({ _id: 1, name: 1, chatImageUrl: 1, first_message: 1, tags: 1, gender: 1, imageStyle: 1 })
                .limit(parseInt(limit) - characters.length)
                .sort({ popularity: -1 })
                .toArray();
            
            // Double-check fallback results too
            fallbackCharacters = fallbackCharacters.filter(c => 
                c.chatImageUrl && 
                typeof c.chatImageUrl === 'string' && 
                c.chatImageUrl.trim() !== '' &&
                (c.chatImageUrl.startsWith('http://') || c.chatImageUrl.startsWith('https://'))
            );
            
            characters.push(...fallbackCharacters);
        }

        console.log(`[Recommendations] Returning ${characters.length} characters`);

        res.send({ 
            success: true, 
            characters: characters.slice(0, parseInt(limit))
        });

    } catch (error) {
        console.error('Error getting character recommendations:', error);
        res.status(500).send({ success: false, error: 'Failed to get recommendations' });
    }
});
  // Add onboarding real-time update endpoint
  fastify.post('/user/onboarding-update/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const updateData = req.body;
        
        if (!userId) {
            return res.status(400).send({ success: false, error: 'User ID required' });
        }

        console.log(`[debug] Onboarding update for user ${userId}:`, updateData);

        // Prepare the update object
        const userUpdate = {
            ...updateData,
            lastOnboardingUpdate: new Date().toISOString()
        };

        const result = await fastify.mongo.db.collection('users').findOneAndUpdate(
          { _id: new ObjectId(userId) },
          { $set: userUpdate },
          { new: true }
        );
        
        if (!result.value) {
            console.log(`[debug] User not found for ID: ${userId}`);
            return res.status(404).send({ success: false, error: 'User not found' });
        }

        console.log(`[debug] Successfully updated user ${userId} with:`, updateData);
        res.send({ 
            success: true, 
            message: 'User data updated successfully',
            updatedFields: Object.keys(updateData)
        });

    } catch (error) {
        console.error('[debug] Error updating user onboarding data:', error);
        res.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // Settings page route
  fastify.get('/settings', async (request, reply) => {
    try {
        const user = request.user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const translations = request.translations;
        const isAdmin = await checkUserAdmin(fastify, user._id);

        return reply.view('settings', {
            user,
            translations,
            isAdmin,
            userData: user
        });
    } catch (error) {
        console.error('[Settings] Error loading settings page:', error);
        return reply.status(500).send({ error: 'Failed to load settings' });
    }
  });

  // History gallery route - API endpoint
  fastify.get('/api/user/history', async (request, reply) => {
    try {
      const user = await fastify.getUser(request, reply);
      const userId = new ObjectId(user._id);
      const page = parseInt(request.query.page) || 1;
      const limit = parseInt(request.query.limit) || 24;
      const skip = (page - 1) * limit;
      const characterFilter = request.query.character; // Optional filter by chatId

      const db = fastify.mongo.db;
      const galleryCollection = db.collection('gallery');
      const videosCollection = db.collection('videos');
      const chatsCollection = db.collection('chats');

      // Build aggregation pipeline for images
      const galleryPipeline = [
        { $match: characterFilter ? { userId: userId, chatId: new ObjectId(characterFilter) } : { userId: userId } },
        { $unwind: '$images' },
        {
          $project: {
            _id: '$images._id',
            imageUrl: { $ifNull: ['$images.imageUrl', '$images.url'] },
            thumbnailUrl: '$images.thumbnailUrl',
            url: '$images.url',
            prompt: '$images.prompt',
            title: '$images.title',
            slug: '$images.slug',
            aspectRatio: '$images.aspectRatio',
            seed: '$images.seed',
            nsfw: '$images.nsfw',
            type: { $ifNull: ['$images.type', 'image'] },
            contentType: { $literal: 'image' },
            isMerged: '$images.isMerged',
            mergeId: '$images.mergeId',
            originalImageUrl: '$images.originalImageUrl',
            isUpscaled: '$images.isUpscaled',
            likes: '$images.likes',
            likedBy: '$images.likedBy',
            actions: '$images.actions',
            createdAt: { $ifNull: ['$images.createdAt', '$images.timestamp', new Date()] },
            chatId: '$chatId',
            chatSlug: '$chatSlug'
          }
        },
        { $sort: { createdAt: -1 } }
      ];

      // Fetch images
      const images = await galleryCollection.aggregate(galleryPipeline).toArray();

      // Fetch user's videos
      const videoQuery = { userId: userId };
      if (characterFilter) {
        videoQuery.chatId = new ObjectId(characterFilter);
      }

      const videos = await videosCollection
        .find(videoQuery)
        .sort({ createdAt: -1 })
        .toArray();

      // Combine and format videos
      const formattedVideos = videos.map(video => ({
        _id: video._id,
        videoUrl: video.videoUrl,
        imageUrl: video.imageUrl,
        prompt: video.prompt,
        chatId: video.chatId,
        type: 'video',
        contentType: 'video',
        duration: video.duration,
        aspectRatio: video.aspectRatio,
        createdAt: video.createdAt || new Date()
      }));

      // Combine images and videos
      let allContent = [...images, ...formattedVideos];

      // Sort all content by creation date (most recent first)
      allContent.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Total count before pagination
      const totalCount = allContent.length;

      // Paginate
      const paginatedContent = allContent.slice(skip, skip + limit);

      // Get unique chatIds to fetch character info
      const chatIds = [...new Set(allContent.map(item => item.chatId).filter(Boolean))];
      const chats = await chatsCollection
        .find({ _id: { $in: chatIds } })
        .project({ _id: 1, name: 1, slug: 1, chatImageUrl: 1, thumbnail: 1 })
        .toArray();

      // Create a map of chatId to chat info
      const chatMap = {};
      chats.forEach(chat => {
        chatMap[chat._id.toString()] = {
          name: chat.name,
          slug: chat.slug,
          thumbnail: chat.chatImageUrl || chat.thumbnail || '/img/default-thumbnail.png'
        };
      });

      // Enrich content with character info
      const enrichedContent = paginatedContent.map(item => ({
        ...item,
        characterName: item.chatId ? chatMap[item.chatId.toString()]?.name : 'Unknown',
        characterSlug: item.chatId ? chatMap[item.chatId.toString()]?.slug : null,
        characterThumbnail: item.chatId ? chatMap[item.chatId.toString()]?.thumbnail : '/img/default-thumbnail.png'
      }));

      // Group content by character for the response
      const groupedByCharacter = {};
      allContent.forEach(item => {
        const chatIdStr = item.chatId ? item.chatId.toString() : 'unknown';
        if (!groupedByCharacter[chatIdStr]) {
          groupedByCharacter[chatIdStr] = {
            chatId: item.chatId,
            characterName: chatMap[chatIdStr]?.name || 'Unknown',
            characterSlug: chatMap[chatIdStr]?.slug || null,
            characterThumbnail: chatMap[chatIdStr]?.thumbnail || '/img/default-thumbnail.png',
            count: 0,
            items: []
          };
        }
        groupedByCharacter[chatIdStr].count++;
      });

      const totalPages = Math.ceil(totalCount / limit);

      return reply.send({
        content: enrichedContent,
        groupedByCharacter,
        page,
        totalPages,
        totalCount
      });

    } catch (err) {
      console.error('[History] Error fetching user history:', err);
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  });

  // History gallery page route
  fastify.get('/history', async (request, reply) => {
    try {
      const user = await fastify.getUser(request, reply);
      const { translations, lang } = request;

      return reply.renderWithGtm('history.hbs', {
        title: translations?.history_page?.page_title || 'History - Generated Content',
        user,
        translations,
        lang
      });
    } catch (err) {
      console.error('[History] Error rendering history page:', err);
      reply.code(500).send('Internal Server Error');
    }
  });
}

module.exports = routes;
