const { createHash } = require('crypto');
const { ObjectId } = require('mongodb');
const sharp = require('sharp');
const axios = require('axios');
const crypto = require('crypto');
const stream = require('stream');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function checkUserAdmin(fastify, userId) {
    const usersCollection = fastify.mongo.db.collection('users');
    const user = await usersCollection.findOne({_id: new ObjectId(userId)});
    if (!user) {
        return false;
    }
    return user.role === 'admin';
}
// add  role: 'admin'  to an array of admin emails
async function addAdminEmails(fastify, emails) {
    const usersCollection = fastify.mongo.db.collection('users');
    const result = await usersCollection.updateMany({ email: { $in: emails } }, { $set: { role: 'admin' } });
    return result;
}

// Configure Supabase Storage
const { createClient } = require('@supabase/supabase-js');
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'images';

// Configure AWS S3
const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });  

const getS3Stream = (bucket, key) => {
    return s3.getObject({ Bucket: bucket, Key: key }).createReadStream();
};
// Function to get the current counter value from the database
async function getCounter(db) {
  const counterDoc = await db.collection('counters').findOne({ _id: 'storyCounter' });
  return counterDoc && !isNaN(counterDoc.value) ? counterDoc.value : 0;
}

  // Function to update the counter value in the database
  async function updateCounter(db, value) {
    await db.collection('counters').updateOne({ _id: 'storyCounter' }, { $set: { value: value } }, { upsert: true });
  }
  async function deleteObjectFromUrl(url) {
    const bucket = url.split('.')[0].split('//')[1];  // Extract bucket from URL
    const key = url.split('.com/')[1];  // Extract key from URL

    const params = {
        Bucket: bucket,
        Key: key
    };

    try {
        await s3.deleteObject(params).promise();
        return 'Object deleted successfully';
    } catch (error) {
        throw new Error(`Error deleting object: ${error.message}`);
    }
};

const uploadToS3 = async (buffer, hash, filename) => {
    const key = `${hash}_${filename}`;
    const params = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ACL: 'public-read', // Ensures the file is publicly accessible
        ContentType: 'application/octet-stream', // Set default content type for binary files
    };

    try {
        const command = new PutObjectCommand(params);
        await s3.send(command);
        const location = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
        return location;
    } catch (error) {
        console.error("S3 Upload Error:", error.message);
        throw new Error("Failed to upload file to S3. Please try again.");
    }
};

const uploadToSupabase = async (buffer, hash, filename) => {
    if (!supabase) {
        throw new Error('Supabase is not configured');
    }
    const key = `${hash}_${filename}`;
    const { data, error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(key, buffer, {
            contentType: 'application/octet-stream',
            upsert: true,
        });

    if (error) {
        console.error("Supabase Upload Error:", error.message);
        throw new Error("Failed to upload file to Supabase.");
    }

    const { data: publicUrlData } = supabase.storage
        .from(SUPABASE_BUCKET)
        .getPublicUrl(key);

    return publicUrlData.publicUrl;
};

const uploadImage = async (buffer, hash, filename) => {
    // Try Supabase first
    try {
        const url = await uploadToSupabase(buffer, hash, filename);
        console.log(`[Upload] Saved to Supabase: ${url}`);
        return url;
    } catch (err) {
        console.warn(`[Upload] Supabase failed (${err.message}), falling back to S3`);
    }
    // Fallback to S3
    const url = await uploadToS3(buffer, hash, filename);
    console.log(`[Upload] Saved to S3: ${url}`);
    return url;
};

/**
 * Thumbnail configuration
 * - Small: 400px width, quality 70 - for grids and gallery thumbnails
 */
const THUMBNAIL_CONFIG = {
    small: { width: 400, quality: 70 }
};

/**
 * Generate a thumbnail from a buffer and upload to S3
 * @param {Buffer} originalBuffer - The original image buffer
 * @param {string} hash - The hash of the original image
 * @param {string} filename - The original filename
 * @returns {Promise<{thumbnailUrl: string}>} Object with thumbnail URL
 */
const generateThumbnailFromBuffer = async (originalBuffer, hash, filename) => {
    try {
        const { width, quality } = THUMBNAIL_CONFIG.small;
        
        // Generate thumbnail using sharp
        const thumbnailBuffer = await sharp(originalBuffer)
            .resize(width, null, { 
                fit: 'inside',
                withoutEnlargement: true 
            })
            .jpeg({ quality, progressive: true })
            .toBuffer();
        
        // Create thumbnail filename with prefix
        const thumbnailFilename = `thumb_${filename.replace(/\.[^/.]+$/, '')}.jpg`;
        const thumbnailKey = `thumbnails/${hash}_${thumbnailFilename}`;
        
        const params = {
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: thumbnailKey,
            Body: thumbnailBuffer,
            ACL: 'public-read',
            ContentType: 'image/jpeg',
        };
        
        const command = new PutObjectCommand(params);
        await s3.send(command);
        
        const thumbnailUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${thumbnailKey}`;
        
        return { thumbnailUrl };
    } catch (error) {
        console.error("Thumbnail generation error:", error.message);
        // Return null instead of throwing - thumbnails are optional optimization
        return { thumbnailUrl: null };
    }
};

/**
 * Generate a thumbnail from an existing S3 image URL
 * @param {string} imageUrl - The S3 URL of the original image
 * @returns {Promise<{thumbnailUrl: string}>} Object with thumbnail URL
 */
const generateThumbnailFromUrl = async (imageUrl) => {
    try {
        // Validate URL
        if (!imageUrl || !isValidUrl(imageUrl)) {
            console.error('Invalid image URL for thumbnail generation');
            return { thumbnailUrl: null };
        }
        
        // Fetch the original image
        const response = await axios.get(imageUrl, { 
            responseType: 'arraybuffer',
            timeout: 30000 // 30 second timeout
        });
        const originalBuffer = Buffer.from(response.data, 'binary');
        
        // Extract hash and filename from the URL
        const urlParts = imageUrl.split('/');
        const fullKey = urlParts[urlParts.length - 1];
        
        // Parse the key - format is typically: hash_filename or just filename
        let hash, filename;
        const underscoreIndex = fullKey.indexOf('_');
        if (underscoreIndex > 0 && underscoreIndex < 65) { // SHA256 hash is 64 chars
            hash = fullKey.substring(0, underscoreIndex);
            filename = fullKey.substring(underscoreIndex + 1);
        } else {
            // Generate hash from buffer if not available in URL
            hash = createHash('sha256').update(originalBuffer).digest('hex');
            filename = fullKey;
        }
        
        // Generate thumbnail
        const result = await generateThumbnailFromBuffer(originalBuffer, hash, filename);
        
        return result;
    } catch (error) {
        console.error('Error generating thumbnail from URL:', error.message);
        return { thumbnailUrl: null };
    }
};

/**
 * Upload an image and automatically generate a thumbnail
 * @param {Buffer} buffer - The original image buffer
 * @param {string} hash - The hash of the image
 * @param {string} filename - The filename
 * @returns {Promise<{imageUrl: string, thumbnailUrl: string}>} Object with both URLs
 */
const uploadImageWithThumbnail = async (buffer, hash, filename) => {
    try {
        // Upload original image
        const imageUrl = await uploadToS3(buffer, hash, filename);
        
        // Generate and upload thumbnail (don't fail if thumbnail fails)
        const { thumbnailUrl } = await generateThumbnailFromBuffer(buffer, hash, filename);
        
        return { imageUrl, thumbnailUrl };
    } catch (error) {
        console.error('Error in uploadImageWithThumbnail:', error.message);
        throw error;
    }
};

const isValidUrl = (string) => {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
};
async function checkLimits(fastify,userId) {
    const today = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Tokyo' });

    const userDataCollection = fastify.mongo.db.collection('users');
    const user = await userDataCollection.findOne({ _id: new fastify.mongo.ObjectId(userId) });

    const messageCountCollection = fastify.mongo.db.collection('MessageCount');
    const messageCountDoc = await messageCountCollection.findOne({ userId: new fastify.mongo.ObjectId(userId), date: today });

    const chatCollection = fastify.mongo.db.collection('chats');
    const chatCount = await chatCollection.countDocuments({ userId: new fastify.mongo.ObjectId(userId) });

    const imageCountCollection = fastify.mongo.db.collection('ImageCount');
    const imageCountDoc = await imageCountCollection.findOne({ userId: new fastify.mongo.ObjectId(userId), date: today });

    const messageIdeasCountCollection = fastify.mongo.db.collection('MessageIdeasCount');
    const messageIdeasCountDoc = await messageIdeasCountCollection.findOne({ userId: new fastify.mongo.ObjectId(userId), date: today });

    const isTemporary = user.isTemporary;
    let messageLimit = isTemporary ? 10 : '無制限';
    let chatLimit = isTemporary ? 1 : '無制限';
    let imageLimit = isTemporary ? 1 : '無制限';
    let messageIdeasLimit = isTemporary ? 3 : 10;

    if (!isTemporary) {
        const existingSubscription = await fastify.mongo.db.collection('subscriptions').findOne({
            _id: new fastify.mongo.ObjectId(userId),
            subscriptionStatus: 'active',
        });

        if (false && existingSubscription) {
            const billingCycle = existingSubscription.billingCycle;
            const currentPlanId = existingSubscription.currentPlanId;
            const plansFromDb = await fastify.mongo.db.collection('plans').findOne();
            const plans = plansFromDb.plans;
            const plan = plans.find((plan) => plan[`${billingCycle}_id`] === currentPlanId);

            messageLimit = plan?.messageLimit || messageLimit;
            chatLimit = plan?.chatLimit || chatLimit;
            imageLimit = plan?.imageLimit || imageLimit;
            messageIdeasLimit = plan?.messageIdeasLimit || messageIdeasLimit;
        }
    }

    const limitIds = [];

    if (messageCountDoc && messageCountDoc.count >= messageLimit) {
        limitIds.push(1);
    }

    if (chatLimit && chatCount >= chatLimit) {
        limitIds.push(2);
    }

    if (imageCountDoc && imageCountDoc.count >= imageLimit) {
        limitIds.push(3);
    }

    if (messageIdeasCountDoc && messageIdeasCountDoc.count >= messageIdeasLimit) {
        limitIds.push(4);
    }

    if (limitIds.length > 0) {
        return { limitIds, messageCountDoc, chatCount, imageCountDoc, messageIdeasCountDoc, messageLimit, chatLimit, imageLimit, messageIdeasLimit };
    }

    return { messageCountDoc, chatCount, imageCountDoc, messageIdeasCountDoc, messageLimit, chatLimit, imageLimit, messageIdeasLimit };
}


async function convertImageUrlToBase64(imageUrl) {
    try {
        let buffer;

        // Check if it's a URL or file path
        if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer'
            });
            buffer = Buffer.from(response.data, 'binary');
        } else {
            buffer = await fs.readFile(path.resolve(imageUrl));
        }

        // Compress and resize the image using sharp
        const compressedBuffer = await sharp(buffer)
            .resize(800, 800, { 
                fit: sharp.fit.inside,
                withoutEnlargement: true
            })
            .jpeg({ quality: 70 })
            .toBuffer();

        const base64Image = compressedBuffer.toString('base64');
        return `data:image/jpeg;base64,${base64Image}`;
    } catch (error) {
        throw new Error('Failed to convert and compress image to Base64');
    }
}


// Utility to convert a stream to a buffer
const streamToBuffer = async (readableStream) => {
    const chunks = [];
    for await (const chunk of readableStream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
};

async function listFiles(prefix = '') {
    try {
        // Create the command with the required parameters
        const command = new ListObjectsV2Command({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Prefix: prefix,
        });

        // Send the command and wait for the response
        const existingFiles = await s3.send(command);

        return existingFiles;
    } catch (err) {
        console.error('Error listing objects:', err);
        throw err;
    }
}

const handleFileUpload = async (part, db) => {
    let buffer;
    if (part.file) {
        const chunks = [];
        for await (const chunk of part.file) {
            chunks.push(chunk);
        }
        buffer = Buffer.concat(chunks);
    } else if (part.value && isValidUrl(part.value)) {
        const response = await axios.get(part.value, { responseType: 'arraybuffer' });
        buffer = Buffer.from(response.data, 'binary');
    } else {
        throw new Error('No valid file or URL provided');
    }

    const hash = createHash('sha256').update(buffer).digest('hex');
    
    const existingFiles = await listFiles();
    const foundFile = existingFiles.Contents.find(item => item.Key.includes(hash));
    if (foundFile) {
      return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${foundFile.Key}`;
    } else {
      const uploadUrl = await uploadToS3(buffer, hash, part.filename || 'uploaded_file');
      return uploadUrl;
    }
    
};

const createBlurredImage = async (imageUrl, db) => {
    try {
        const blurLevel = 50;
        const urlParts = imageUrl.split('/');
        const s3Key = decodeURIComponent(urlParts.slice(3).join('/'));

        const awsimages = db.collection('awsimages');

        // Get the original image as a stream from S3
        const imageStream = getS3Stream(process.env.AWS_S3_BUCKET_NAME, s3Key);
        const imageBuffer = await streamToBuffer(imageStream);

        // Process the image using sharp (blur and resize)
        const processedImageBuffer = await sharp(imageBuffer)
            .blur(blurLevel)
            .toBuffer();

        // Generate a hash for the processed (blurred) image buffer
        const hash = crypto.createHash('md5').update(processedImageBuffer).digest('hex');

        // Check if the blurred image already exists in the database
        const existingFile = await awsimages.findOne({ hash });
        if (existingFile) {
            const existingFileUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${existingFile.key}`;
            
            // Check if the image is accessible
            const checkDbImage = await fetch(existingFileUrl, { method: 'HEAD' });
            if (checkDbImage.ok) {
                console.log(`Blurred image already exists in DB and is accessible`);
                return existingFileUrl;
            } else {
                console.warn(`Blurred image found in DB but not accessible (status: ${checkDbImage.status})`);
            }
        }

        // Check if the blurred image already exists in S3
        const existingFiles = await s3.listObjectsV2({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Prefix: hash,
        }).promise();

        if (existingFiles.Contents.length > 0) {
            const blurredKey = existingFiles.Contents[0].Key;
            const blurredImageUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${blurredKey}`;
            
            // Check if the image is accessible
            const checkS3Image = await fetch(blurredImageUrl, { method: 'HEAD' });
            if (checkS3Image.ok) {
                console.log(`Blurred image already exists in S3 and is accessible`);
                await awsimages.insertOne({ key: blurredKey, hash });
                return blurredImageUrl;
            } else {
                console.warn(`Blurred image found in S3 but not accessible (status: ${checkS3Image.status})`);
            }
        }

        // Upload the blurred image to S3
        const filename = `blurred_${urlParts[urlParts.length - 1]}`;
        const uploadUrl = await uploadToS3(processedImageBuffer, hash, filename);

        // Save the blurred image key and hash in the database
        await awsimages.insertOne({ key: `${hash}_${filename}`, hash });

        return uploadUrl;
    } catch (error) {
        console.error('Error creating blurred image:', error.message);
        throw new Error('Failed to process the image.');
    }
};
async function getUserData(userId, collectionUser, collectionChat, currentUser) {
    try {
        const user = await collectionUser.findOne({ _id: new ObjectId(userId) });
        if (!user) return null;

        const isFollowing = currentUser?.following && currentUser?.following.some(followingId => followingId.toString() === user._id.toString());
        // Count ALL characters created by user, not just those with images
        const chatCount = await collectionChat.countDocuments({ userId: new ObjectId(userId), isTemporary: false });

        return {
            _id: user._id,
            profileUrl: user.profileUrl,
            nickname: user.nickname,
            bio: user.bio,
            coins: user.coins,
            follow: isFollowing,
            followCount: user.followCount,
            followerCount: user.followerCount,
            imageLikeCount: user.imageLikeCount,
            postCount: user.postCount,
            chatCount: chatCount,
            subscriptionStatus: user.subscriptionStatus
        };
    } catch (error) {
        console.error("Error fetching user data:", error);
    }
}

  async function initializeImageStyle() {
    try {
      const db = fastify.mongo.db; // Use fastify's MongoDB connection
      const chatsCollection = db.collection('chats');
  
      // Filter for chats where 'imageStyle' does not exist or is an empty string
      const filter = { 
        $or: [
          { imageStyle: { $exists: false } }, 
          { imageStyle: '' }
        ]
      };
      const update = { $set: { imageStyle: 'anime' } };
  
      // Update all matching documents
      const result = await chatsCollection.updateMany(filter, update);
      console.log(`Updated ${result.modifiedCount} chats with 'imageStyle' set to 'anime'.`);
    } catch (err) {
      console.error('An error occurred while initializing imageStyle:', err);
    }
  }
  async function addTags(tags, db) {
    const tagsCollection = db.collection('tags');

    const bulkOps = tags.map(tag => ({
      updateOne: {
        filter: { name: tag },
        update: { $setOnInsert: { name: tag.name, language: tag.language, fromPrompt: tag.fromPrompt || false } },
        upsert: true
      }
    }));
    await tagsCollection.bulkWrite(bulkOps);
  };
  const logImageTags = async (fastify) => {
    try {
      const db = fastify.mongo.db;
      const galleryCollection = db.collection('gallery');
        
      // Retrieve all images with their prompts
      const cursor = galleryCollection.aggregate([
        { $unwind: '$images' },
        { $project: { _id: 0, imageId: '$images._id', prompt: '$images.prompt' } }
      ]);
    
    let index = 0;
    await cursor.forEach(image => {
        if (index < 100) {
            const prompt = image.prompt || '';
            const tags = prompt.split(',').map(tag => tag.trim()).map(tag => ({ name:tag.replace(/[^\w\s]/gi, ''), language: 'en', fromPrompt:true }));
            console.log({ index, tags });
            addTags(tags, db)
            index++;
        }
    });

      return { message: 'Tags logged successfully' };
    } catch (err) {
      console.error(err);
      throw new Error('Internal Server Error');
    }
  };
async function fetchTags(db, request) {
    const user = request.user;
    let language = getLanguageName(user?.lang);
    const tagsCollection = db.collection('tags');
    const chatsCollection = db.collection('chats');

    let page = request.query.page;
    const limit = parseInt(request.query.limit) || 200;

    // Efficient random fetch using aggregation for 'random' page
    if (page === 'random') {
        // Use aggregation with $sample for random selection
        const randomTags = await tagsCollection.aggregate([
            { $match: { $or: [{ language }, { language: request.lang }] } },
            { $sample: { size: limit } },
            { $project: { name: 1, _id: 0 } }
        ]).toArray();

        // If not enough tags, try to populate from chats
        if (randomTags.length < limit) {
            let tagsFromChats = await chatsCollection.distinct('tags', { $or: [{ language }, { language: request.lang }] });
            tagsFromChats = tagsFromChats.flat().filter(Boolean);
            // Insert missing tags
            const newTags = tagsFromChats.map(tag => ({ name: tag, language: request.lang }));
            if (newTags.length) {
                await tagsCollection.insertMany(newTags, { ordered: false }).catch(() => {});
            }
            // Try again
            const retryTags = await tagsCollection.aggregate([
                { $match: { $or: [{ language }, { language: request.lang }] } },
                { $sample: { size: limit } },
                { $project: { name: 1, _id: 0 } }
            ]).toArray();
            return { tags: retryTags.map(t => t.name), page: 'random', totalPages: 1 };
        }
        return { tags: randomTags.map(t => t.name), page: 'random', totalPages: 1 };
    } else {
        // For paged fetch, use skip/limit and count only
        page = parseInt(page) || 1;
        const query = { $or: [{ language }, { language: request.lang }] };
        const totalTags = await tagsCollection.countDocuments(query);
        const totalPages = Math.ceil(totalTags / limit);
        const tags = await tagsCollection
            .find(query)
            .project({ name: 1, _id: 0 })
            .skip((page - 1) * limit)
            .limit(limit)
            .toArray();
        return { tags: tags.map(t => t.name), page, totalPages };
    }
}
const processPromptToTags = async (db, prompt) => {
    if (!prompt) {
        throw new Error('Prompt is required');
    }

    const tags = prompt.split(',').map(tag => tag.trim()).map(tag => ({ name: tag.replace(/[^\w\s]/gi, ''), language: 'en', fromPrompt:true }));
    await addTags(tags, db);
};

  
  function getLanguageName(langCode) {

    const langMap = {
        en: "english",
        fr: "french",
        ja: "japanese"
    };
    return langMap[langCode] || langCode || "english";
}
async function updateUserLang(db, userId, lang) {
    if (!userId || !lang) {
        throw new Error('Need a userId and the language');
    }

    const usersCollection = db.collection('users');
    try {
        const result = await usersCollection.updateOne(
            { _id: new ObjectId(userId) },
            { $set: { lang } }
        );

        if (result.matchedCount === 0) {
            throw new Error('User not found');
        }

        return result;
    } catch (error) {
        throw new Error(`Failed to update user language: ${error.message}`);
    }
}
function sanitizeMessages(messagesForCompletion) {
    try {
        return messagesForCompletion.map(message => ({
            ...message,
            content: message.content.replace(/\s+/g, ' ').trim()
        }));
    } catch (error) {
        console.log(messagesForCompletion)
        console.error('Error sanitizing messages:', error);
        throw new Error('Failed to sanitize messages');
    }
}

// Module to add a notification
async function addNotification(fastify, userId, data) {
    const { title, message, link, ico } = data;
    const db = fastify.mongo.db;
    const notificationsCollection = db.collection('notifications');

    const notification = {
        title,
        message,
        type: ico || 'info',
        data: { link },
        userId: new ObjectId(userId),
        viewed: false,
        createdAt: new Date(),
        sticky: false,
    };

    await notificationsCollection.insertOne(notification);
}


async function saveChatImageToDB(db, chatId, imageUrl) {
    const collectionChats = db.collection('chats'); // Replace 'chats' with your actual collection name

    // Convert chatId string to ObjectId
    let chatObjectId;
    try {
        chatObjectId = new ObjectId(chatId);
    } catch (error) {
        return { error: '無効なchatIdです。' };
    }

    // Update the 'chats' collection with chatImageUrl and thumbnail
    const updateResult = await collectionChats.updateOne(
        { _id: chatObjectId },
        { 
            $set: { 
                chatImageUrl: imageUrl
            } 
        }
    );

    if (updateResult.matchedCount === 0) {
        return { error: '指定されたチャットが見つかりませんでした。' };
    }

    return updateResult;
}

async function saveUserChatBackgroundImageToDB(db, userChatId, imageId, imageUrl) {
    const collectionUserChat = db.collection('userChat');

    // Convert userChatId string to ObjectId
    let userChatObjectId;
    try {
        userChatObjectId = new ObjectId(userChatId);
    } catch (error) {
        throw new Error('Invalid userChatId');
    }

    // Update the 'userChat' collection with backgroundImageId and backgroundImageUrl
    const updateResult = await collectionUserChat.updateOne(
        { _id: userChatObjectId },
        { 
            $set: { 
                backgroundImageId: imageId,
                backgroundImageUrl: imageUrl
            } 
        }
    );

    if (updateResult.matchedCount === 0) {
        throw new Error('UserChat not found');
    }

    return updateResult;
}
    const getApiUrl = (req) => {
        if (process.env.MODE === 'local') {
            // Get the host from the request or use default local IP detection
            if (req && req.headers && req.headers.host) {
                const host = req.headers.host;
                return `http://${host}`;
            } else {
                // Fallback to dynamically getting the local IP address
                const interfaces = os.networkInterfaces();
                let ip = 'localhost';
                for (const name of Object.keys(interfaces)) {
                    for (const iface of interfaces[name]) {
                        if (iface.family === 'IPv4' && !iface.internal) {
                            ip = iface.address;
                            break;
                        }
                    }
                    if (ip !== 'localhost') break;
                }
                return `http://${ip}:3000`;
            }
        } else {
            if (req && req.headers && req.headers.host) {
                const host = req.headers.host;
                return `https://${host}`;
            } else {
                return 'https://app.chatlamix.com';
            }
        }
    };
/**
 * Generate SEO metadata with hreflang tags for multi-language support
 * @param {Object} request - Fastify request object
 * @param {string} path - URL path (e.g., '/character/slug/example')
 * @param {string} currentLang - Current language code (en, fr, ja)
 * @returns {Object} SEO metadata object with canonicalUrl, alternates, and lang attribute
 */
function generateSeoMetadata(request, path = '', currentLang = 'en') {
    const forwardedProto = request.headers['x-forwarded-proto'];
    const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || request.protocol || 'https';
    const host = request.hostname;
    const isLocalHost = host.includes('localhost') || host.includes('127.0.0.1') || host.includes('0.0.0.0');
    const baseDomain = process.env.PUBLIC_BASE_DOMAIN || (isLocalHost ? host : host.split('.').slice(-2).join('.')) || 'chatlamix.com';
    
    // Always use app.chatlamix.com for canonical URL (single domain for SEO)
    const canonicalHost = isLocalHost ? host : 'app.chatlamix.com';
    const canonicalUrl = `${isLocalHost ? `${protocol}://${canonicalHost}` : `https://${canonicalHost}`}${path}`;
    
    // Generate alternate language URLs with ?lang= parameter
    const alternates = [];
    const supportedLangs = ['en', 'fr', 'ja', 'hi'];
    
    supportedLangs.forEach(lang => {
        const langUrl = new URL(canonicalUrl);
        langUrl.searchParams.set('lang', lang);
        alternates.push({
            hreflang: lang,
            href: langUrl.toString()
        });
    });
    
    // Add x-default pointing to current language
    const defaultUrl = new URL(canonicalUrl);
    defaultUrl.searchParams.set('lang', currentLang);
    alternates.push({
        hreflang: 'x-default',
        href: defaultUrl.toString()
    });
    
    return {
        canonicalUrl,
        alternates,
        lang: currentLang
    };
}

module.exports = {
    getCounter,
    updateCounter,
    handleFileUpload,
    uploadToS3,
    uploadToSupabase,
    uploadImage,
    checkLimits,
    checkUserAdmin,
    convertImageUrlToBase64,
    createBlurredImage,
    deleteObjectFromUrl,
    getUserData,
    addTags,
    logImageTags,
    getLanguageName,
    updateUserLang,
    sanitizeMessages,
    processPromptToTags,
    processPromptToTags,
    fetchTags,
    listFiles,
    addNotification,
    saveChatImageToDB,
    saveUserChatBackgroundImageToDB,
    addAdminEmails,
    getApiUrl,
    generateSeoMetadata,
    // Thumbnail functions
    generateThumbnailFromBuffer,
    generateThumbnailFromUrl,
    uploadImageWithThumbnail,
    THUMBNAIL_CONFIG
};