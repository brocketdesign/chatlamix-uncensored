/**
 * Social Media API Routes - Late.dev Integration
 * Handles SNS connections (Instagram, X/Twitter) and post publishing
 */

const { ObjectId } = require('mongodb');
const { generateCompletion } = require('../models/openai');
const { createProfilePost } = require('../models/unified-post-utils');

// Late.dev API Configuration
const LATE_API_BASE_URL = 'https://getlate.dev/api/v1';
const LATE_API_KEY = process.env.LATE_API_KEY;

// Supported platforms
const SUPPORTED_PLATFORMS = ['twitter', 'instagram'];

// Account limits based on subscription
const ACCOUNT_LIMITS = {
  free: 1,
  premium: 5
};

/**
 * Helper: Make Late.dev API request
 */
async function lateApiRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  console.log(`[Social API] ${method} ${LATE_API_BASE_URL}${endpoint}`);
  
  try {
    const response = await fetch(`${LATE_API_BASE_URL}${endpoint}`, options);
    
    // Get the response text first to check if it's valid JSON
    const responseText = await response.text();
    
    // Check if response is HTML (error page) instead of JSON
    if (responseText.startsWith('<!DOCTYPE') || responseText.startsWith('<html')) {
      console.error(`[Social API] Late.dev returned HTML instead of JSON for ${endpoint}`);
      throw new Error(`Late.dev API returned error page (status ${response.status}). The endpoint may be unavailable or the profileId may be invalid.`);
    }
    
    // Try to parse as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error(`[Social API] Failed to parse response as JSON:`, responseText.substring(0, 200));
      throw new Error(`Late.dev API returned invalid JSON (status ${response.status})`);
    }
    
    if (!response.ok) {
      console.error(`[Social API] Late.dev error:`, data);
      throw new Error(data.message || data.error || `Late.dev API error: ${response.status}`);
    }
    
    return data;
  } catch (error) {
    console.error(`[Social API] Request failed:`, error);
    throw error;
  }
}

/**
 * Helper: Get user's connected accounts count
 */
async function getUserAccountsCount(db, userId) {
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(userId) },
    { projection: { snsConnections: 1 } }
  );
  return user?.snsConnections?.length || 0;
}

/**
 * Helper: Check if user can connect more accounts
 */
function canConnectMoreAccounts(user, currentCount) {
  const isPremium = user?.subscriptionStatus === 'active';
  const limit = isPremium ? ACCOUNT_LIMITS.premium : ACCOUNT_LIMITS.free;
  return currentCount < limit;
}

/**
 * Helper: Get or create Late.dev profile for user
 */
async function getOrCreateProfile(db, userId, userEmail, userName) {
  // Check if user already has a Late profile ID stored
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(userId) },
    { projection: { lateProfileId: 1 } }
  );

  if (user?.lateProfileId) {
    return user.lateProfileId;
  }

  // Create a new profile in Late.dev
  try {
    console.log(`[Social API] Creating Late.dev profile for user ${userId}`);
    const profileData = {
      name: userName || `User ${userId}`,
      description: `Profile for user ${userId}`,
      color: '#6E20F4' // Match app's primary color
    };

    const response = await lateApiRequest('/profiles', 'POST', profileData);
    
    // Response format: { message: "...", profile: { _id: "...", ... } }
    const profileId = response.profile?._id || response.profile?.id;

    if (!profileId) {
      console.error(`[Social API] Unexpected response format:`, response);
      throw new Error('Profile ID not returned from Late.dev');
    }

    // Store profile ID in user document
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { lateProfileId: profileId } }
    );

    console.log(`[Social API] Created Late.dev profile: ${profileId}`);
    return profileId;
  } catch (error) {
    console.error(`[Social API] Error creating profile:`, error);
    // Try to list existing profiles as fallback
    try {
      const profilesResponse = await lateApiRequest('/profiles');
      // Response format: { profiles: [{ _id: "...", ... }, ...] }
      const profiles = profilesResponse.profiles || [];
      
      if (profiles.length > 0) {
        const defaultProfileId = profiles[0]._id || profiles[0].id;
        if (defaultProfileId) {
          await db.collection('users').updateOne(
            { _id: new ObjectId(userId) },
            { $set: { lateProfileId: defaultProfileId } }
          );
          console.log(`[Social API] Using existing Late.dev profile: ${defaultProfileId}`);
          return defaultProfileId;
        }
      }
    } catch (fallbackError) {
      console.error(`[Social API] Fallback profile fetch failed:`, fallbackError);
    }
    throw error;
  }
}

async function routes(fastify, options) {
  const db = fastify.mongo.db;

  /**
   * GET /api/social/status
   * Get user's SNS connection status
   */
  fastify.get('/api/social/status', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const userId = user._id;
      const userData = await db.collection('users').findOne(
        { _id: new ObjectId(userId) },
        { projection: { snsConnections: 1, subscriptionStatus: 1 } }
      );

      const connections = userData?.snsConnections || [];
      const isPremium = userData?.subscriptionStatus === 'active';
      const limit = isPremium ? ACCOUNT_LIMITS.premium : ACCOUNT_LIMITS.free;

      console.log(`[Social API] Status check for user ${userId}: ${connections.length}/${limit} connections`);

      return reply.send({
        success: true,
        connections: connections.map(conn => ({
          id: conn.id,
          platform: conn.platform,
          username: conn.username,
          profileUrl: conn.profileUrl,
          connectedAt: conn.connectedAt
        })),
        limits: {
          current: connections.length,
          max: limit,
          isPremium
        }
      });
    } catch (error) {
      console.error('[Social API] Error getting status:', error);
      return reply.code(500).send({ error: 'Failed to get connection status' });
    }
  });

  /**
   * GET /api/social/connect/:platform
   * Get OAuth URL to connect a platform
   */
  fastify.get('/api/social/connect/:platform', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { platform } = request.params;
      if (!SUPPORTED_PLATFORMS.includes(platform)) {
        return reply.code(400).send({ error: `Platform '${platform}' is not supported` });
      }

      // Check account limits
      const currentCount = await getUserAccountsCount(db, user._id);
      if (!canConnectMoreAccounts(user, currentCount)) {
        return reply.code(403).send({ 
          error: 'Account limit reached',
          message: 'Upgrade to premium to connect more accounts',
          needsUpgrade: true
        });
      }

      // Get or create profile for this user
      const profileId = await getOrCreateProfile(db, user._id, user.email, user.nickname || user.username);
      
      // Get OAuth URL from Late.dev (profileId is required)
      const callbackUrl = `${request.protocol}://${request.hostname}/api/social/callback/${platform}`;
      const queryParams = new URLSearchParams({
        profileId: profileId,
        redirect_url: callbackUrl
      });
      
      const response = await lateApiRequest(`/connect/${platform}?${queryParams.toString()}`);

      console.log(`[Social API] OAuth URL generated for ${platform} with profileId: ${profileId}`);

      return reply.send({
        success: true,
        authUrl: response.url || response.authUrl || response.auth_url,
        platform
      });
    } catch (error) {
      console.error(`[Social API] Error getting connect URL:`, error);
      return reply.code(500).send({ error: 'Failed to initiate connection' });
    }
  });

  /**
   * GET /api/social/callback/:platform
   * OAuth callback handler
   * Late.dev redirects with: connected=platform&profileId=PROFILE_ID&username=USERNAME
   */
  fastify.get('/api/social/callback/:platform', async (request, reply) => {
    const { platform } = request.params;
    
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.type('text/html').send(getCallbackHtml('error', platform, null, 'auth_required'));
      }

      const { connected, username, profileId, error: oauthError, tempToken, userProfile, connect_token } = request.query;

      // Check for OAuth errors
      if (oauthError || !connected) {
        const errorMsg = oauthError || 'connection_failed';
        console.error(`[Social API] OAuth error for ${platform}:`, errorMsg);
        return reply.type('text/html').send(getCallbackHtml('error', platform, null, errorMsg));
      }

      // Verify the connected platform matches
      if (connected !== platform) {
        console.error(`[Social API] Platform mismatch: expected ${platform}, got ${connected}`);
        return reply.type('text/html').send(getCallbackHtml('error', platform, null, 'platform_mismatch'));
      }

      // For headless mode, we might get tempToken and need to finalize connection
      // For now, we'll use the standard flow where Late.dev returns the connection info directly
      
      const profileIdForConnection = profileId || user.lateProfileId;
      
      if (!profileIdForConnection) {
        console.error(`[Social API] No profileId in callback for user ${user._id}`);
        return reply.type('text/html').send(getCallbackHtml('error', platform, null, 'missing_profile'));
      }

      // Fetch connected accounts from Late.dev to get the actual account ID
      let lateAccountId = null;
      try {
        const accountsResponse = await lateApiRequest(`/accounts?profileId=${profileIdForConnection}`);
        const accounts = accountsResponse.accounts || accountsResponse || [];
        
        // Find the account that matches the platform and username
        const matchingAccount = accounts.find(acc => 
          acc.platform === platform && 
          (acc.username === username || acc.handle === username || acc.name === username)
        );
        
        if (matchingAccount) {
          lateAccountId = matchingAccount._id || matchingAccount.id || matchingAccount.accountId;
          console.log(`[Social API] Found Late.dev account ID: ${lateAccountId} for ${platform}/@${username}`);
        } else if (accounts.length > 0) {
          // If no exact match, try to find any account for this platform
          const platformAccount = accounts.find(acc => acc.platform === platform);
          if (platformAccount) {
            lateAccountId = platformAccount._id || platformAccount.id || platformAccount.accountId;
            console.log(`[Social API] Using platform account ID: ${lateAccountId} for ${platform}`);
          }
        }
      } catch (fetchError) {
        console.warn(`[Social API] Could not fetch accounts from Late.dev:`, fetchError.message);
        // Don't use username as fallback - it will cause posting to fail
        // The lateAccountId will be resolved on first post attempt
      }
      
      // If we couldn't get the account ID, we'll try to resolve it later when posting
      if (!lateAccountId) {
        console.warn(`[Social API] Could not resolve Late.dev account ID for ${platform}/@${username}, will retry on post`);
        lateAccountId = `pending_${username}`; // Mark as pending resolution
      }

      const connection = {
        id: `${platform}_${username}_${Date.now()}`,
        platform,
        username: username || 'Unknown',
        profileUrl: null, // Can be fetched later if needed
        connectedAt: new Date(),
        lateAccountId: lateAccountId,
        lateProfileId: profileIdForConnection
      };

      // Add connection to user (avoid duplicates)
      await db.collection('users').updateOne(
        { _id: new ObjectId(user._id) },
        { 
          $pull: { snsConnections: { platform } }
        }
      );

      await db.collection('users').updateOne(
        { _id: new ObjectId(user._id) },
        { 
          $push: { snsConnections: connection }
        }
      );

      console.log(`[Social API] Successfully connected ${platform} (@${connection.username}) for user ${user._id}`);

      // Return HTML that closes the popup and notifies the parent window
      return reply.type('text/html').send(getCallbackHtml('success', platform, connection.username));
    } catch (error) {
      console.error(`[Social API] Callback error:`, error);
      return reply.type('text/html').send(getCallbackHtml('error', request.params.platform, null, 'connection_failed'));
    }
  });

  /**
   * Generate HTML for OAuth callback popup
   */
  function getCallbackHtml(status, platform, username, errorCode) {
    const isSuccess = status === 'success';
    const title = isSuccess ? 'Connected!' : 'Connection Failed';
    const message = isSuccess 
      ? `Successfully connected @${username} on ${platform}` 
      : `Failed to connect ${platform}: ${errorCode}`;
    const icon = isSuccess ? '✓' : '✕';
    const color = isSuccess ? '#28a745' : '#dc3545';

    return `
<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 40px;
    }
    .icon {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: ${color};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      font-size: 40px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 24px;
    }
    p {
      margin: 0 0 20px;
      opacity: 0.8;
    }
    .closing {
      font-size: 14px;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="closing">This window will close automatically...</p>
  </div>
  <script>
    // Notify parent window and close popup
    (function() {
      const result = {
        status: '${status}',
        platform: '${platform}',
        username: '${username || ''}',
        error: '${errorCode || ''}'
      };
      
      // Try to notify parent window
      if (window.opener) {
        try {
          // Call parent's callback function if exists
          if (window.opener.SocialConnections) {
            window.opener.SocialConnections.loadConnections();
          }
          
          // Show notification in parent
          if (window.opener.showNotification) {
            const msg = result.status === 'success' 
              ? 'Successfully connected to ${platform}!' 
              : 'Failed to connect: ${errorCode}';
            window.opener.showNotification(msg, result.status === 'success' ? 'success' : 'error');
          }
        } catch (e) {
          console.error('Could not communicate with parent:', e);
        }
      }
      
      // Close popup after short delay
      setTimeout(function() {
        window.close();
        // If popup doesn't close (e.g., opened directly), redirect to chat
        setTimeout(function() {
          window.location.href = '/chat/';
        }, 500);
      }, 1500);
    })();
  </script>
</body>
</html>
    `;
  }

  /**
   * DELETE /api/social/disconnect/:platform/:accountId
   * Disconnect a platform account
   */
  fastify.delete('/api/social/disconnect/:platform/:accountId', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { platform, accountId } = request.params;

      const result = await db.collection('users').updateOne(
        { _id: new ObjectId(user._id) },
        { 
          $pull: { 
            snsConnections: { 
              platform,
              $or: [{ id: accountId }, { lateAccountId: accountId }]
            }
          }
        }
      );

      if (result.modifiedCount === 0) {
        return reply.code(404).send({ error: 'Connection not found' });
      }

      console.log(`[Social API] Disconnected ${platform}/${accountId} for user ${user._id}`);

      return reply.send({
        success: true,
        message: `Disconnected from ${platform}`
      });
    } catch (error) {
      console.error(`[Social API] Disconnect error:`, error);
      return reply.code(500).send({ error: 'Failed to disconnect account' });
    }
  });

  /**
   * POST /api/social/post
   * Create a post on connected platforms and/or user profile
   */
  fastify.post('/api/social/post', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { text, mediaUrls, platforms, scheduledFor, postToProfile, imageId } = request.body;

      // Check if posting to profile only (no SNS platforms)
      const hasSnsPosting = platforms && platforms.length > 0;
      
      if (!text || (!hasSnsPosting && !postToProfile)) {
        return reply.code(400).send({ error: 'Text and at least one destination are required' });
      }

      let profilePostResult = null;
      let snsPostResult = null;

      // Handle profile post if requested
      if (postToProfile) {
        console.log(`[Social API] Creating profile post for user ${user._id}`);
        try {
          const imageUrl = mediaUrls && mediaUrls.length > 0 ? mediaUrls[0] : null;
          
          profilePostResult = await createProfilePost({
            userId: user._id,
            imageUrl,
            videoUrl: null,
            thumbnailUrl: imageUrl,
            caption: text,
            visibility: 'public',
            requiredTier: null,
            nsfw: false
          }, db);
          
          console.log(`[Social API] Profile post created: ${profilePostResult._id}`);
        } catch (profileError) {
          console.error(`[Social API] Profile post error:`, profileError);
          // Continue with SNS posting even if profile post fails
        }
      }

      // Handle SNS posting if platforms are selected
      if (hasSnsPosting) {
        // Get user's connections and profile
        const userData = await db.collection('users').findOne(
          { _id: new ObjectId(user._id) },
          { projection: { snsConnections: 1, lateProfileId: 1 } }
        );

        const connections = userData?.snsConnections || [];
        const profileId = userData?.lateProfileId;
        
        if (!profileId) {
          // Only return error if we didn't successfully create a profile post
          if (!profilePostResult) {
            return reply.code(400).send({ 
              error: 'No profile found. Please connect an account first.',
              needsConnection: true
            });
          }
          // Otherwise continue - SNS posting will be skipped but profile post succeeded
        } else {
          // Filter to requested platforms
          const targetConnections = connections.filter(c => platforms.includes(c.platform));
          
          if (targetConnections.length === 0 && !profilePostResult) {
            return reply.code(400).send({ 
              error: 'No connected accounts for selected platforms',
              needsConnection: true
            });
          }

          if (targetConnections.length > 0) {
            // Resolve Late.dev account IDs for each connection
            const resolvedPlatforms = [];
            const failedPlatforms = [];
            
            for (const conn of targetConnections) {
              let accountId = conn.lateAccountId;
              
              const needsResolution = !accountId || 
                                     accountId.startsWith('pending_') || 
                                     !accountId.match(/^[a-f0-9]{24}$/i);
              
              if (needsResolution && profileId) {
                try {
                  console.log(`[Social API] Attempting to resolve account ID for ${conn.platform}/@${conn.username}`);
                  const accountsResponse = await lateApiRequest(`/accounts?profileId=${profileId}`);
                  const accounts = accountsResponse.accounts || accountsResponse || [];
                  
                  const matchingAccount = accounts.find(acc => 
                    acc.platform === conn.platform && 
                    (acc.username === conn.username || acc.handle === conn.username || acc.name === conn.username)
                  ) || accounts.find(acc => acc.platform === conn.platform);
                  
                  if (matchingAccount) {
                    accountId = matchingAccount._id || matchingAccount.id || matchingAccount.accountId;
                    
                    if (accountId && accountId.match(/^[a-f0-9]{24}$/i)) {
                      await db.collection('users').updateOne(
                        { _id: new ObjectId(user._id), 'snsConnections.platform': conn.platform },
                        { $set: { 'snsConnections.$.lateAccountId': accountId } }
                      );
                    } else {
                      accountId = null;
                    }
                  } else {
                    accountId = null;
                  }
                } catch (resolveError) {
                  console.error(`[Social API] Could not resolve account ID for ${conn.platform}:`, resolveError.message);
                  accountId = null;
                }
              }
              
              if (accountId && accountId.match(/^[a-f0-9]{24}$/i)) {
                resolvedPlatforms.push({
                  platform: conn.platform,
                  accountId: accountId,
                  platformSpecificData: {}
                });
              } else {
                failedPlatforms.push(conn.platform);
              }
            }
            
            // Post to SNS if we have resolved platforms
            if (resolvedPlatforms.length > 0) {
              const postData = {
                content: text,
                mediaItems: (mediaUrls || []).map(url => ({
                  url,
                  type: 'image'
                })),
                platforms: resolvedPlatforms
              };

              if (scheduledFor) {
                postData.scheduledAt = new Date(scheduledFor).toISOString();
              }

              console.log(`[Social API] Creating SNS post for user ${user._id}:`, {
                platforms: postData.platforms,
                mediaItems: postData.mediaItems?.length || 0
              });

              const response = await lateApiRequest('/posts', 'POST', postData);
              const postId = response.id || response._id || response.postId || response.post?.id;
              const postStatus = response.status || response.post?.status || 'pending';

              await db.collection('socialPosts').insertOne({
                userId: new ObjectId(user._id),
                text,
                mediaUrls,
                platforms: postData.platforms,
                latePostId: postId,
                status: postStatus,
                scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
                createdAt: new Date()
              });

              snsPostResult = { postId, status: postStatus };
              console.log(`[Social API] SNS post created: ${postId}`);
            } else if (failedPlatforms.length > 0 && !profilePostResult) {
              return reply.code(400).send({ 
                error: 'Could not resolve account IDs. Please try reconnecting.',
                failedPlatforms,
                needsReconnect: true
              });
            }
          }
        }
      }

      // Build response message
      let message = '';
      if (profilePostResult && snsPostResult) {
        message = scheduledFor ? 'Post scheduled to profile and social media' : 'Post published to profile and social media';
      } else if (profilePostResult) {
        message = 'Post published to profile';
      } else if (snsPostResult) {
        message = scheduledFor ? 'Post scheduled to social media' : 'Post published to social media';
      }

      return reply.send({
        success: true,
        profilePostId: profilePostResult?._id,
        snsPostId: snsPostResult?.postId,
        status: snsPostResult?.status || 'published',
        message
      });
    } catch (error) {
      console.error(`[Social API] Post error:`, error);
      return reply.code(500).send({ error: 'Failed to create post' });
    }
  });

  /**
   * POST /api/social/generate-caption
   * Generate AI caption for social media post
   */
  fastify.post('/api/social/generate-caption', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { imagePrompt, imageUrl, platform, style, language, existingCaption } = request.body;

      if (!imagePrompt && !imageUrl) {
        return reply.code(400).send({ error: 'Image prompt or URL is required' });
      }

      // Map language names to language codes
      const languageMap = {
        'english': 'en',
        'japanese': 'ja',
        'french': 'fr',
        'portuguese': 'pt',
        'spanish': 'es',
        'chinese': 'zh',
        'korean': 'ko',
        'thai': 'th',
        'german': 'de',
        'italian': 'it',
        'russian': 'ru',
        'hindi': 'hi'
      };

      const languageCode = languageMap[language] || language || request.lang || 'en';
      const targetPlatform = platform || 'general';
      const captionStyle = style || 'engaging';

      // Language names for system prompt
      const languageNames = {
        'en': 'English',
        'ja': 'Japanese',
        'fr': 'French',
        'pt': 'Portuguese',
        'es': 'Spanish',
        'zh': 'Chinese',
        'ko': 'Korean',
        'th': 'Thai',
        'de': 'German',
        'it': 'Italian',
        'ru': 'Russian',
        'hi': 'Hindi'
      };

      const languageName = languageNames[languageCode] || 'English';

      // Build prompt for caption generation
      let systemPrompt;
      if (existingCaption) {
        systemPrompt = `You are a social media expert improving captions for ${targetPlatform}. 
Enhance the existing caption to be more ${captionStyle} while keeping it in ${languageName}.

Guidelines:
- Keep the core message and meaning from the existing caption
- Make it more ${captionStyle} in tone and style
- Keep it concise and engaging
- Include 3-5 relevant hashtags at the end
- Match the tone to the platform (${targetPlatform === 'instagram' ? 'visual, aesthetic' : 'conversational, witty'})
- If the image seems to be AI-generated art, subtly reference that
- Make it shareable and engaging

Existing caption: ${existingCaption}

Image context: ${imagePrompt || 'An interesting AI-generated image'}

Return ONLY the improved caption text with hashtags, nothing else.`;
      } else {
        systemPrompt = `You are a social media expert creating captions for ${targetPlatform}. 
Create a ${captionStyle} caption in ${languageName}.

Guidelines:
- Keep it concise and engaging
- Include 3-5 relevant hashtags at the end
- Match the tone to the platform (${targetPlatform === 'instagram' ? 'visual, aesthetic' : 'conversational, witty'})
- If the image seems to be AI-generated art, subtly reference that
- Make it shareable and engaging

Image context: ${imagePrompt || 'An interesting AI-generated image'}

Return ONLY the caption text with hashtags, nothing else.`;
      }

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: existingCaption ? 'Improve this caption.' : 'Generate a social media caption for this image.' }
      ];

      console.log(`[Social API] Generating caption for ${targetPlatform} in ${languageName} (${languageCode})`);

      const caption = await generateCompletion(messages, 200, 'gpt-4o-mini', languageCode);

      return reply.send({
        success: true,
        caption: caption?.trim() || '',
        platform: targetPlatform,
        language: languageCode
      });
    } catch (error) {
      console.error(`[Social API] Caption generation error:`, error);
      return reply.code(500).send({ error: 'Failed to generate caption' });
    }
  });

  /**
   * GET /api/social/posts
   * Get user's post history
   */
  fastify.get('/api/social/posts', async (request, reply) => {
    try {
      const user = request.user;
      if (!user || user.isTemporary) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const page = parseInt(request.query.page) || 1;
      const limit = parseInt(request.query.limit) || 20;
      const skip = (page - 1) * limit;

      const posts = await db.collection('socialPosts')
        .find({ userId: new ObjectId(user._id) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      const total = await db.collection('socialPosts')
        .countDocuments({ userId: new ObjectId(user._id) });

      return reply.send({
        success: true,
        posts,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error(`[Social API] Get posts error:`, error);
      return reply.code(500).send({ error: 'Failed to get posts' });
    }
  });
}

module.exports = routes;
