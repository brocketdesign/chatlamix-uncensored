/**
 * Unified Post Model
 * Converts all dashboard outputs (images, videos) to a unified Post format
 * 
 * Phase 1: Clean Up In-App Posts
 * - Added visibility system (public, followers, subscribers, private)
 * - Added tier gating for subscriber-only content
 * - Added isProfilePost flag for profile display
 */

const { ObjectId } = require('mongodb');

/**
 * Post types
 */
const POST_TYPES = {
  IMAGE: 'image',
  VIDEO: 'video',
  GALLERY_IMAGE: 'gallery_image' // Legacy from gallery
};

/**
 * Post sources (where it was generated)
 */
const POST_SOURCES = {
  IMAGE_DASHBOARD: 'image_dashboard',
  VIDEO_DASHBOARD: 'video_dashboard',
  GALLERY: 'gallery',
  CRON_JOB: 'cron_job',
  API: 'api',
  CHAT: 'chat', // Posts created in chat
  PROFILE: 'profile' // Posts created directly on profile
};

/**
 * Post statuses
 */
const POST_STATUSES = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  FAILED: 'failed',
  PROCESSING: 'processing'
};

/**
 * Post visibility levels
 */
const POST_VISIBILITY = {
  PUBLIC: 'public',           // Anyone can see
  FOLLOWERS: 'followers',     // Only followers can see
  SUBSCRIBERS: 'subscribers', // Only subscribers can see
  PRIVATE: 'private'          // Only the creator can see
};

/**
 * Create a unified post from image dashboard generation
 * @param {Object} data - Image generation data
 * @param {Object} db - Database connection
 * @returns {Object} Created post
 */
async function createPostFromImage(data, db) {
  const {
    userId,
    characterId = null,
    testId, // From imageModelTests
    imageUrl,
    prompt,
    negativePrompt,
    model,
    parameters,
    rating,
    nsfw = false,
    mutationData = null,
    scheduledFor = null,
    autoPublish = false,
    socialPlatforms = [],
    // New Phase 1 fields
    visibility = POST_VISIBILITY.PRIVATE,
    requiredTier = null,
    isProfilePost = false,
    caption = ''
  } = data;

  const post = {
    userId: new ObjectId(userId),
    characterId: characterId ? new ObjectId(characterId) : null,
    type: POST_TYPES.IMAGE,
    source: POST_SOURCES.IMAGE_DASHBOARD,
    
    // Content
    content: {
      imageUrl,
      thumbnailUrl: imageUrl, // Could be optimized later
      prompt,
      negativePrompt,
      caption,
      model,
      parameters: parameters || {}
    },
    
    // Metadata
    metadata: {
      sourceId: testId ? new ObjectId(testId) : null,
      rating: rating || null,
      nsfw,
      mutationData,
      width: parameters?.width || null,
      height: parameters?.height || null,
      seed: parameters?.seed || null
    },
    
    // Visibility and access control (Phase 1)
    visibility,
    requiredTier: requiredTier ? new ObjectId(requiredTier) : null,
    isProfilePost,
    
    // Status and publishing
    status: scheduledFor ? POST_STATUSES.SCHEDULED : POST_STATUSES.DRAFT,
    scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    publishedAt: null,
    
    // Social media
    autoPublish,
    socialPlatforms,
    socialPostIds: [],
    
    // Engagement
    likes: 0,
    likedBy: [],
    comments: [],
    views: 0,
    
    // Timestamps
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('unifiedPosts').insertOne(post);
  
  // Update user's post count
  await db.collection('users').updateOne(
    { _id: new ObjectId(userId) },
    { $inc: { postCount: 1 } }
  );

  return { _id: result.insertedId, ...post };
}

/**
 * Create a unified post from video dashboard generation
 * @param {Object} data - Video generation data
 * @param {Object} db - Database connection
 * @returns {Object} Created post
 */
async function createPostFromVideo(data, db) {
  const {
    userId,
    characterId = null,
    testId, // From videoModelTests
    videoUrl,
    thumbnailUrl,
    prompt,
    inputImageUrl,
    model,
    parameters,
    rating,
    nsfw = false,
    mutationData = null,
    scheduledFor = null,
    autoPublish = false,
    socialPlatforms = [],
    // New Phase 1 fields
    visibility = POST_VISIBILITY.PRIVATE,
    requiredTier = null,
    isProfilePost = false,
    caption = ''
  } = data;

  const post = {
    userId: new ObjectId(userId),
    characterId: characterId ? new ObjectId(characterId) : null,
    type: POST_TYPES.VIDEO,
    source: POST_SOURCES.VIDEO_DASHBOARD,
    
    // Content
    content: {
      videoUrl,
      thumbnailUrl,
      inputImageUrl,
      prompt,
      caption,
      model,
      parameters: parameters || {}
    },
    
    // Metadata
    metadata: {
      sourceId: testId ? new ObjectId(testId) : null,
      rating: rating || null,
      nsfw,
      mutationData,
      duration: parameters?.duration || null,
      aspectRatio: parameters?.aspectRatio || null
    },
    
    // Visibility and access control (Phase 1)
    visibility,
    requiredTier: requiredTier ? new ObjectId(requiredTier) : null,
    isProfilePost,
    
    // Status and publishing
    status: scheduledFor ? POST_STATUSES.SCHEDULED : POST_STATUSES.DRAFT,
    scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    publishedAt: null,
    
    // Social media
    autoPublish,
    socialPlatforms,
    socialPostIds: [],
    
    // Engagement
    likes: 0,
    likedBy: [],
    comments: [],
    views: 0,
    
    // Timestamps
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('unifiedPosts').insertOne(post);
  
  // Update user's post count
  await db.collection('users').updateOne(
    { _id: new ObjectId(userId) },
    { $inc: { postCount: 1 } }
  );

  return { _id: result.insertedId, ...post };
}

/**
 * Link an existing test result to a unified post
 * @param {string} testId - Test ID
 * @param {string} testType - 'image' or 'video'
 * @param {Object} db - Database connection
 * @returns {Object} Created post
 */
async function linkTestToPost(testId, testType, db) {
  const collection = testType === 'image' ? 'imageModelTests' : 'videoModelTests';
  const test = await db.collection(collection).findOne({ _id: new ObjectId(testId) });
  
  if (!test) {
    throw new Error(`Test not found: ${testId}`);
  }

  // Check if already linked
  const existingPost = await db.collection('unifiedPosts').findOne({
    'metadata.sourceId': new ObjectId(testId),
    source: testType === 'image' ? POST_SOURCES.IMAGE_DASHBOARD : POST_SOURCES.VIDEO_DASHBOARD
  });

  if (existingPost) {
    return existingPost;
  }

  // Create post based on type
  if (testType === 'image') {
    return await createPostFromImage({
      userId: test.userId,
      testId: test._id,
      imageUrl: test.imageUrl,
      prompt: test.prompt,
      negativePrompt: test.negativePrompt,
      model: test.model,
      parameters: test.parameters,
      rating: test.rating,
      nsfw: test.nsfw || false
    }, db);
  } else {
    return await createPostFromVideo({
      userId: test.userId,
      testId: test._id,
      videoUrl: test.videoUrl,
      thumbnailUrl: test.thumbnailUrl,
      prompt: test.prompt,
      inputImageUrl: test.inputImageUrl,
      model: test.model,
      parameters: test.parameters,
      rating: test.rating,
      nsfw: test.nsfw || false
    }, db);
  }
}

/**
 * Get user's posts with filters
 * @param {Object} db - Database connection
 * @param {string} userId - User ID
 * @param {Object} filters - Filter options
 * @returns {Object} Posts and pagination
 */
async function getUserPosts(db, userId, filters = {}) {
  const {
    type,
    source,
    status,
    nsfw,
    scheduledOnly = false,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = -1
  } = filters;

  const query = { userId: new ObjectId(userId) };
  
  if (type) query.type = type;
  if (source) query.source = source;
  if (status) query.status = status;
  if (typeof nsfw === 'boolean') query['metadata.nsfw'] = nsfw;
  if (scheduledOnly) {
    query.scheduledFor = { $exists: true, $ne: null };
  }

  const skip = (page - 1) * limit;

  const posts = await db.collection('unifiedPosts')
    .find(query)
    .sort({ [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit)
    .toArray();

  const total = await db.collection('unifiedPosts').countDocuments(query);

  return {
    posts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Update post status
 * @param {string} postId - Post ID
 * @param {string} status - New status
 * @param {Object} db - Database connection
 */
async function updatePostStatus(postId, status, db) {
  const update = {
    status,
    updatedAt: new Date()
  };

  if (status === POST_STATUSES.PUBLISHED) {
    update.publishedAt = new Date();
  }

  await db.collection('unifiedPosts').updateOne(
    { _id: new ObjectId(postId) },
    { $set: update }
  );
}

/**
 * Schedule a post
 * @param {string} postId - Post ID
 * @param {Date} scheduledFor - Scheduled time
 * @param {Object} db - Database connection
 */
async function schedulePost(postId, scheduledFor, db) {
  await db.collection('unifiedPosts').updateOne(
    { _id: new ObjectId(postId) },
    {
      $set: {
        scheduledFor: new Date(scheduledFor),
        status: POST_STATUSES.SCHEDULED,
        updatedAt: new Date()
      }
    }
  );
}

/**
 * Cancel scheduled post
 * @param {string} postId - Post ID
 * @param {Object} db - Database connection
 */
async function cancelScheduledPost(postId, db) {
  await db.collection('unifiedPosts').updateOne(
    { _id: new ObjectId(postId) },
    {
      $set: {
        scheduledFor: null,
        status: POST_STATUSES.DRAFT,
        updatedAt: new Date()
      }
    }
  );
}

/**
 * Get scheduled posts ready to publish
 * @param {Object} db - Database connection
 * @returns {Array} Posts ready to publish
 */
async function getScheduledPostsToPublish(db) {
  return await db.collection('unifiedPosts')
    .find({
      status: POST_STATUSES.SCHEDULED,
      scheduledFor: { $lte: new Date() }
    })
    .toArray();
}

/**
 * Add social post ID to unified post
 * @param {string} postId - Post ID
 * @param {string} platform - Platform name
 * @param {string} socialPostId - Social media post ID
 * @param {Object} db - Database connection
 */
async function addSocialPostId(postId, platform, socialPostId, db) {
  await db.collection('unifiedPosts').updateOne(
    { _id: new ObjectId(postId) },
    {
      $push: {
        socialPostIds: {
          platform,
          postId: socialPostId,
          publishedAt: new Date()
        }
      },
      $set: { updatedAt: new Date() }
    }
  );
}

/**
 * Delete a post
 * @param {string} postId - Post ID
 * @param {string} userId - User ID (for ownership verification)
 * @param {Object} db - Database connection
 */
async function deletePost(postId, userId, db) {
  const result = await db.collection('unifiedPosts').deleteOne({
    _id: new ObjectId(postId),
    userId: new ObjectId(userId)
  });

  if (result.deletedCount > 0) {
    // Decrement user's post count
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $inc: { postCount: -1 } }
    );
  }

  return result.deletedCount > 0;
}

/**
 * Get post by ID
 * @param {string} postId - Post ID
 * @param {Object} db - Database connection
 */
async function getPostById(postId, db) {
  return await db.collection('unifiedPosts').findOne({
    _id: new ObjectId(postId)
  });
}

/**
 * Update post content
 * @param {string} postId - Post ID
 * @param {Object} updates - Content updates
 * @param {Object} db - Database connection
 */
async function updatePost(postId, updates, db) {
  const allowedUpdates = {
    'content.prompt': updates.prompt,
    'content.caption': updates.caption,
    'metadata.nsfw': updates.nsfw,
    autoPublish: updates.autoPublish,
    socialPlatforms: updates.socialPlatforms,
    // Phase 1: visibility updates
    visibility: updates.visibility,
    requiredTier: updates.requiredTier ? new ObjectId(updates.requiredTier) : updates.requiredTier,
    isProfilePost: updates.isProfilePost,
    updatedAt: new Date()
  };

  // Remove undefined values
  Object.keys(allowedUpdates).forEach(key => {
    if (allowedUpdates[key] === undefined) {
      delete allowedUpdates[key];
    }
  });

  await db.collection('unifiedPosts').updateOne(
    { _id: new ObjectId(postId) },
    { $set: allowedUpdates }
  );
}

/**
 * Update post visibility (Phase 1)
 * @param {string} postId - Post ID
 * @param {string} userId - User ID (for ownership verification)
 * @param {string} visibility - New visibility level
 * @param {string|null} requiredTier - Required tier ID for subscribers visibility
 * @param {Object} db - Database connection
 */
async function updatePostVisibility(postId, userId, visibility, requiredTier, db) {
  // Validate visibility value
  if (!Object.values(POST_VISIBILITY).includes(visibility)) {
    throw new Error(`Invalid visibility: ${visibility}`);
  }

  const update = {
    visibility,
    updatedAt: new Date()
  };

  // Only set requiredTier if visibility is 'subscribers'
  if (visibility === POST_VISIBILITY.SUBSCRIBERS && requiredTier) {
    update.requiredTier = new ObjectId(requiredTier);
  } else {
    update.requiredTier = null;
  }

  const result = await db.collection('unifiedPosts').updateOne(
    { _id: new ObjectId(postId), userId: new ObjectId(userId) },
    { $set: update }
  );

  return result.modifiedCount > 0;
}

/**
 * Create a profile post (Phase 1)
 * Posts created directly on the user's profile
 * @param {Object} data - Post data
 * @param {Object} db - Database connection
 * @returns {Object} Created post
 */
async function createProfilePost(data, db) {
  const {
    userId,
    imageUrl,
    videoUrl,
    thumbnailUrl,
    caption = '',
    visibility = POST_VISIBILITY.PUBLIC,
    requiredTier = null,
    nsfw = false
  } = data;

  const isVideo = !!videoUrl;
  
  const post = {
    userId: new ObjectId(userId),
    type: isVideo ? POST_TYPES.VIDEO : POST_TYPES.IMAGE,
    source: POST_SOURCES.PROFILE,
    
    // Content
    content: {
      imageUrl: imageUrl || null,
      videoUrl: videoUrl || null,
      thumbnailUrl: thumbnailUrl || imageUrl,
      caption
    },
    
    // Metadata
    metadata: {
      nsfw
    },
    
    // Visibility and access control (Phase 1)
    visibility,
    requiredTier: requiredTier ? new ObjectId(requiredTier) : null,
    isProfilePost: true,
    
    // Status - profile posts are published immediately
    status: POST_STATUSES.PUBLISHED,
    scheduledFor: null,
    publishedAt: new Date(),
    
    // Social media (not auto-published)
    autoPublish: false,
    socialPlatforms: [],
    socialPostIds: [],
    
    // Engagement
    likes: 0,
    likedBy: [],
    comments: [],
    views: 0,
    
    // Timestamps
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('unifiedPosts').insertOne(post);
  
  // Update user's post count
  await db.collection('users').updateOne(
    { _id: new ObjectId(userId) },
    { $inc: { postCount: 1 } }
  );

  return { _id: result.insertedId, ...post };
}

/**
 * Check if a user can access a post based on visibility rules (Phase 1)
 * @param {Object} post - The post to check
 * @param {string|null} viewerId - The user trying to view (null = anonymous)
 * @param {Object} db - Database connection
 * @returns {Object} { canAccess: boolean, reason: string }
 */
async function checkPostAccess(post, viewerId, db) {
  const postOwnerId = post.userId.toString();
  const viewerIdStr = viewerId ? viewerId.toString() : null;

  // Owner can always access their own posts
  if (viewerIdStr && viewerIdStr === postOwnerId) {
    return { canAccess: true, reason: 'owner' };
  }

  // Check visibility level
  switch (post.visibility) {
    case POST_VISIBILITY.PUBLIC:
      return { canAccess: true, reason: 'public' };

    case POST_VISIBILITY.FOLLOWERS:
      if (!viewerIdStr) {
        return { canAccess: false, reason: 'login_required' };
      }
      // Check if viewer follows the post owner
      const followDoc = await db.collection('followers').findOne({
        followerId: new ObjectId(viewerIdStr),
        followedId: new ObjectId(postOwnerId)
      });
      if (followDoc) {
        return { canAccess: true, reason: 'follower' };
      }
      return { canAccess: false, reason: 'followers_only' };

    case POST_VISIBILITY.SUBSCRIBERS:
      if (!viewerIdStr) {
        return { canAccess: false, reason: 'login_required' };
      }
      // Check if viewer has an active subscription to the creator
      const subscription = await db.collection('subscriptions').findOne({
        subscriberId: new ObjectId(viewerIdStr),
        creatorId: new ObjectId(postOwnerId),
        status: 'active'
      });
      if (subscription) {
        // If post requires specific tier, check tier level
        if (post.requiredTier) {
          const subTier = await db.collection('creatorTiers').findOne({ _id: subscription.tierId });
          const reqTier = await db.collection('creatorTiers').findOne({ _id: post.requiredTier });
          if (subTier && reqTier && subTier.order >= reqTier.order) {
            return { canAccess: true, reason: 'subscriber' };
          }
          return { canAccess: false, reason: 'higher_tier_required' };
        }
        return { canAccess: true, reason: 'subscriber' };
      }
      return { canAccess: false, reason: 'subscribers_only' };

    case POST_VISIBILITY.PRIVATE:
    default:
      return { canAccess: false, reason: 'private' };
  }
}

/**
 * Get public posts for a user's profile (Phase 1)
 * Returns posts that the viewer is allowed to see
 * @param {Object} db - Database connection
 * @param {string} profileUserId - The profile owner's user ID
 * @param {string|null} viewerId - The viewing user's ID (null for anonymous)
 * @param {Object} filters - Filter options
 * @returns {Object} Posts and pagination
 */
async function getPublicUserPosts(db, profileUserId, viewerId, filters = {}) {
  const {
    type,
    nsfw = false,
    page = 1,
    limit = 12,
    sortBy = 'createdAt',
    sortOrder = -1
  } = filters;

  const profileUserObjId = new ObjectId(profileUserId);
  const viewerObjId = viewerId ? new ObjectId(viewerId) : null;
  const isOwner = viewerObjId && viewerObjId.toString() === profileUserObjId.toString();

  // Build visibility query based on viewer's relationship to profile owner
  let visibilityQuery;
  
  if (isOwner) {
    // Owner sees all their posts
    visibilityQuery = {};
  } else if (viewerObjId) {
    // Logged-in user - check follow/subscription status
    const [isFollowing, subscription] = await Promise.all([
      db.collection('followers').findOne({
        followerId: viewerObjId,
        followedId: profileUserObjId
      }),
      db.collection('subscriptions').findOne({
        subscriberId: viewerObjId,
        creatorId: profileUserObjId,
        status: 'active'
      })
    ]);

    if (subscription) {
      // Subscriber can see public, followers, and subscribers posts
      visibilityQuery = {
        visibility: { $in: [POST_VISIBILITY.PUBLIC, POST_VISIBILITY.FOLLOWERS, POST_VISIBILITY.SUBSCRIBERS] }
      };
    } else if (isFollowing) {
      // Follower can see public and followers posts
      visibilityQuery = {
        visibility: { $in: [POST_VISIBILITY.PUBLIC, POST_VISIBILITY.FOLLOWERS] }
      };
    } else {
      // Non-follower sees only public posts
      visibilityQuery = { visibility: POST_VISIBILITY.PUBLIC };
    }
  } else {
    // Anonymous user sees only public posts
    visibilityQuery = { visibility: POST_VISIBILITY.PUBLIC };
  }

  // Build the main query
  const query = {
    userId: profileUserObjId,
    isProfilePost: true,
    status: POST_STATUSES.PUBLISHED,
    ...visibilityQuery
  };

  if (type) query.type = type;
  if (!nsfw) query['metadata.nsfw'] = { $ne: true };

  const skip = (page - 1) * limit;

  // Get posts with user info
  const posts = await db.collection('unifiedPosts')
    .find(query)
    .sort({ [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit)
    .toArray();

  const total = await db.collection('unifiedPosts').countDocuments(query);

  // Add access info to each post for UI hints
  const postsWithAccess = posts.map(post => ({
    ...post,
    _accessInfo: {
      canView: true,
      isOwner,
      visibility: post.visibility
    }
  }));

  return {
    posts: postsWithAccess,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Toggle like on a post (Phase 1)
 * @param {string} postId - Post ID
 * @param {string} userId - User ID
 * @param {string} action - 'like' or 'unlike'
 * @param {Object} db - Database connection
 */
async function togglePostLike(postId, userId, action, db) {
  const postObjId = new ObjectId(postId);
  const userObjId = new ObjectId(userId);

  if (action === 'like') {
    // Check if already liked
    const post = await db.collection('unifiedPosts').findOne({
      _id: postObjId,
      likedBy: userObjId
    });

    if (post) {
      return { success: false, error: 'Already liked' };
    }

    await db.collection('unifiedPosts').updateOne(
      { _id: postObjId },
      {
        $inc: { likes: 1 },
        $addToSet: { likedBy: userObjId },
        $set: { updatedAt: new Date() }
      }
    );

    // Also add to posts_likes collection for tracking
    await db.collection('posts_likes').insertOne({
      postId: postObjId,
      userId: userObjId,
      likedAt: new Date()
    });

    return { success: true, action: 'liked' };
  } else if (action === 'unlike') {
    await db.collection('unifiedPosts').updateOne(
      { _id: postObjId, likes: { $gt: 0 } },
      {
        $inc: { likes: -1 },
        $pull: { likedBy: userObjId },
        $set: { updatedAt: new Date() }
      }
    );

    await db.collection('posts_likes').deleteOne({
      postId: postObjId,
      userId: userObjId
    });

    return { success: true, action: 'unliked' };
  }

  return { success: false, error: 'Invalid action' };
}

/**
 * Add comment to a post (Phase 1)
 * @param {string} postId - Post ID
 * @param {string} userId - User ID
 * @param {string} comment - Comment text
 * @param {Object} db - Database connection
 */
async function addPostComment(postId, userId, comment, db) {
  const commentData = {
    _id: new ObjectId(),
    userId: new ObjectId(userId),
    comment,
    createdAt: new Date()
  };

  await db.collection('unifiedPosts').updateOne(
    { _id: new ObjectId(postId) },
    {
      $push: { comments: commentData },
      $set: { updatedAt: new Date() }
    }
  );

  return commentData;
}

/**
 * Get user's social posts from late.dev API (stored in socialPosts collection)
 * This is the primary function for the My Posts dashboard
 * @param {Object} db - Database connection
 * @param {string} userId - User ID
 * @param {Object} filters - Filter options
 * @returns {Object} Social posts and pagination
 */
async function getCombinedUserPosts(db, userId, filters = {}) {
  const {
    type,
    source,
    status,
    nsfw,
    characterId, // Filter by character
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = -1
  } = filters;

  const userObjId = new ObjectId(userId);
  
  // Query for social posts (posted via late.dev API)
  const socialQuery = { userId: userObjId };
  if (status) socialQuery.status = status;
  if (characterId) socialQuery.characterId = new ObjectId(characterId);
  
  // Get social posts
  const socialPosts = await db.collection('socialPosts')
    .find(socialQuery)
    .sort({ [sortBy]: sortOrder })
    .toArray();

  // Transform social posts to unified format for display
  const transformedSocialPosts = socialPosts.map(post => ({
    _id: post._id,
    userId: post.userId,
    characterId: post.characterId || null,
    type: POST_TYPES.IMAGE,
    source: POST_SOURCES.API,
    content: {
      imageUrl: post.mediaUrls?.[0] || '',
      thumbnailUrl: post.mediaUrls?.[0] || '',
      prompt: '',
      caption: post.text || ''
    },
    metadata: {
      nsfw: false,
      latePostId: post.latePostId
    },
    status: post.status === 'published' ? POST_STATUSES.PUBLISHED : 
            post.scheduledFor ? POST_STATUSES.SCHEDULED : POST_STATUSES.DRAFT,
    scheduledFor: post.scheduledFor || null,
    publishedAt: post.createdAt,
    autoPublish: true,
    socialPlatforms: post.platforms?.map(p => p.platform) || [],
    socialPostIds: [{ platform: post.platforms?.[0]?.platform, postId: post.latePostId }],
    likes: 0,
    comments: [],
    views: 0,
    createdAt: post.createdAt,
    updatedAt: post.createdAt,
    _isSocialPost: true
  }));

  // Also include unified posts that have been scheduled for social publishing
  const unifiedQuery = { userId: userObjId };
  if (type) unifiedQuery.type = type;
  if (source && source !== 'api') unifiedQuery.source = source;
  if (status) unifiedQuery.status = status;
  if (characterId) unifiedQuery.characterId = new ObjectId(characterId);
  if (typeof nsfw === 'boolean') unifiedQuery['metadata.nsfw'] = nsfw;
  
  const unifiedPosts = await db.collection('unifiedPosts')
    .find(unifiedQuery)
    .toArray();

  // Combine social posts and unified posts
  let combinedPosts = [...transformedSocialPosts, ...unifiedPosts];
  
  // Remove duplicates (same image might be in both)
  const seenIds = new Set();
  combinedPosts = combinedPosts.filter(post => {
    const id = post._id.toString();
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
  
  // Sort combined posts
  combinedPosts.sort((a, b) => {
    const aVal = a[sortBy] || a.createdAt;
    const bVal = b[sortBy] || b.createdAt;
    return sortOrder === -1 
      ? new Date(bVal) - new Date(aVal)
      : new Date(aVal) - new Date(bVal);
  });

  // Apply pagination
  const total = combinedPosts.length;
  const skip = (page - 1) * limit;
  const paginatedPosts = combinedPosts.slice(skip, skip + limit);

  return {
    posts: paginatedPosts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Create a draft post from image dashboard
 * @param {Object} data - Post data with image info
 * @param {Object} db - Database connection
 * @returns {Object} Created post
 */
async function createDraftPostFromImage(data, db) {
  const {
    userId,
    testId,
    imageUrl,
    prompt,
    negativePrompt,
    caption = '',
    model,
    parameters,
    nsfw = false
  } = data;

  const post = {
    userId: new ObjectId(userId),
    type: POST_TYPES.IMAGE,
    source: POST_SOURCES.IMAGE_DASHBOARD,
    
    content: {
      imageUrl,
      thumbnailUrl: imageUrl,
      prompt,
      negativePrompt,
      caption,
      model,
      parameters: parameters || {}
    },
    
    metadata: {
      sourceId: testId ? new ObjectId(testId) : null,
      nsfw,
      width: parameters?.width || null,
      height: parameters?.height || null,
      seed: parameters?.seed || null
    },
    
    status: POST_STATUSES.DRAFT,
    scheduledFor: null,
    publishedAt: null,
    
    autoPublish: false,
    socialPlatforms: [],
    socialPostIds: [],
    
    likes: 0,
    comments: [],
    views: 0,
    
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('unifiedPosts').insertOne(post);
  
  return { _id: result.insertedId, ...post };
}

module.exports = {
  // Constants
  POST_TYPES,
  POST_SOURCES,
  POST_STATUSES,
  POST_VISIBILITY,
  
  // Post creation
  createPostFromImage,
  createPostFromVideo,
  createDraftPostFromImage,
  createProfilePost,
  linkTestToPost,
  
  // Post retrieval
  getPostById,
  getUserPosts,
  getCombinedUserPosts,
  getPublicUserPosts,
  getScheduledPostsToPublish,
  
  // Post updates
  updatePost,
  updatePostStatus,
  updatePostVisibility,
  
  // Scheduling
  schedulePost,
  cancelScheduledPost,
  
  // Social
  addSocialPostId,
  
  // Engagement (Phase 1)
  togglePostLike,
  addPostComment,
  checkPostAccess,
  
  // Delete
  deletePost
};
