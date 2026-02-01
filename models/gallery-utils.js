const { ObjectId } = require('mongodb');

const TOKYO_TIMEZONE = 'Asia/Tokyo';

function toObjectId(id) {
  if (id instanceof ObjectId) {
    return id;
  }
  return new ObjectId(id);
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleString('en-US', { timeZone: TOKYO_TIMEZONE });
}

async function getGalleryImageById(db, imageId) {
  const imageObjectId = toObjectId(imageId);

  const galleryDocument = await db.collection('gallery').findOne(
    { 'images._id': imageObjectId },
    {
      projection: {
        images: { $elemMatch: { _id: imageObjectId } },
        chatId: 1,
        chatSlug: 1
      }
    }
  );

  if (!galleryDocument || !galleryDocument.images || !galleryDocument.images.length) {
    return null;
  }

  const image = galleryDocument.images[0];
  const chatId = galleryDocument.chatId || image.chatId;

  return {
    image,
    chatId,
    chatSlug: galleryDocument.chatSlug || image.chatSlug || null
  };
}

function buildChatImageMessage(image, { fromGallery = true } = {}) {
  if (!image || !image._id) {
    throw new Error('Invalid image payload: missing _id field');
  }

  const messageDate = new Date();
  const imageId = image._id instanceof ObjectId ? image._id.toString() : String(image._id);
  const actionHistory = Array.isArray(image.actions)
    ? image.actions.map(action => ({ ...action }))
    : [];

  if (!actionHistory.some(action => action && action.type === 'added_to_chat')) {
    actionHistory.push({
      type: 'added_to_chat',
      date: messageDate
    });
  }

  // Generate unique debug ID to trace message source
  const debugId = `gallery_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  console.log(`🆔 [buildChatImageMessage] Creating message with debugId: ${debugId}`);

  const baseMessage = {
    role: 'assistant',
    content: `[Image] ${imageId}`,
    type: image?.type || 'image',
    imageId,
    imageUrl: image.imageUrl || image.url,
    prompt: image.prompt || '',
    title: image.title || null,
    slug: image.slug || null,
    aspectRatio: image.aspectRatio || null,
    seed: typeof image.seed !== 'undefined' ? image.seed : null,
    nsfw: !!image.nsfw,
    hidden: true,
    actions: actionHistory,
    isUpscaled: !!image.isUpscaled,
    createdAt: messageDate,
    timestamp: formatTimestamp(messageDate),
    addedFromGallery: fromGallery,
    _debugSource: 'buildChatImageMessage',
    _debugId: debugId,
  };

  if (image.chatId) {
    baseMessage.sourceChatId = image.chatId;
  }

  if (image.chatSlug) {
    baseMessage.sourceChatSlug = image.chatSlug;
  }

  if (image.isMerged || image.type === 'mergeFace') {
    baseMessage.isMerged = true;
    baseMessage.mergeId = image.mergeId || image._id.toString();
    if (image.originalImageUrl) {
      baseMessage.originalImageUrl = image.originalImageUrl;
    }
    if (image.originalImageId) {
      baseMessage.originalImageId = image.originalImageId;
    }
  }

  return baseMessage;
}

async function appendMessageToUserChat(db, userChatId, message) {
  const userChatObjectId = toObjectId(userChatId);
  const collection = db.collection('userChat');

  console.log(`\n🟢🟢🟢 [appendMessageToUserChat] ═══════════════════════════════════════════════════════════`);
  console.log(`📝 [appendMessageToUserChat] Starting for userChatId: ${userChatId}`);
  console.log(`   message.mergeId: ${message.mergeId || 'none'}`);
  console.log(`   message.imageId: ${message.imageId || 'none'}`);
  console.log(`   message.type: ${message.type || 'unknown'}`);

  // Get current message count BEFORE operation
  const chatDocBefore = await collection.findOne({ _id: userChatObjectId });
  const messageCountBefore = chatDocBefore?.messages?.length || 0;
  console.log(`📊 [appendMessageToUserChat] BEFORE - Total messages: ${messageCountBefore}`);

  // Build atomic filter to prevent duplicate messages
  // Check for duplicates based on message type
  // IMPORTANT: Must use $not + $elemMatch for array field checks, NOT $ne!
  // $ne on arrays matches if ANY element doesn't match, which is always true for arrays
  let filter = { _id: userChatObjectId };
  
  if (message.mergeId) {
    // For merged images, use mergeId as the primary deduplication key
    filter.messages = { $not: { $elemMatch: { mergeId: message.mergeId } } };
    const existingMerge = chatDocBefore?.messages?.filter(m => m.mergeId === message.mergeId).length || 0;
    console.log(`   Existing messages with mergeId=${message.mergeId}: ${existingMerge}`);
  } else if (message.imageId) {
    // For regular images, use imageId
    const imageIdStr = typeof message.imageId === 'object' ? message.imageId.toString() : message.imageId;
    filter.messages = { $not: { $elemMatch: { imageId: imageIdStr } } };
    const existingImage = chatDocBefore?.messages?.filter(m => m.imageId === imageIdStr).length || 0;
    console.log(`   Existing messages with imageId=${imageIdStr}: ${existingImage}`);
  }

  console.log(`🔒 [appendMessageToUserChat] Executing atomic updateOne with $not+$elemMatch filter...`);

  const updateResult = await collection.updateOne(
    filter,
    {
      $push: { messages: message },
      $set: { updatedAt: message.timestamp || formatTimestamp() }
    }
  );

  console.log(`🔒 [appendMessageToUserChat] UpdateOne result: matchedCount=${updateResult.matchedCount}, modifiedCount=${updateResult.modifiedCount}`);

  if (updateResult.matchedCount === 0) {
    console.log(`⚠️  [appendMessageToUserChat] DUPLICATE PREVENTED - Message already exists`);
  } else if (updateResult.modifiedCount > 0) {
    // Verify message count after
    const chatDocAfter = await collection.findOne({ _id: userChatObjectId });
    const messageCountAfter = chatDocAfter?.messages?.length || 0;
    console.log(`✅ [appendMessageToUserChat] SUCCESS! New total messages: ${messageCountAfter} (+${messageCountAfter - messageCountBefore})`);
  }
  
  console.log(`🟢🟢🟢 [appendMessageToUserChat] END ═══════════════════════════════════════════════════════════\n`);

  return updateResult;
}

async function getUserChatForUser(db, userChatId, userId) {
  const userChatObjectId = toObjectId(userChatId);
  const userObjectId = toObjectId(userId);

  return db.collection('userChat').findOne({
    _id: userChatObjectId,
    userId: userObjectId
  });
}

module.exports = {
  getGalleryImageById,
  buildChatImageMessage,
  appendMessageToUserChat,
  getUserChatForUser,
  formatTimestamp,
  toObjectId
};
