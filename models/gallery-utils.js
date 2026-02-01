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

  // Build atomic filter to prevent duplicate messages
  // Check for duplicates based on message type
  let filter = { _id: userChatObjectId };
  
  if (message.mergeId) {
    // For merged images, use mergeId as the primary deduplication key
    filter['messages.mergeId'] = { $ne: message.mergeId };
  } else if (message.imageId) {
    // For regular images, use imageId
    const imageIdStr = typeof message.imageId === 'object' ? message.imageId.toString() : message.imageId;
    filter['messages.imageId'] = { $ne: imageIdStr };
  }

  const updateResult = await collection.updateOne(
    filter,
    {
      $push: { messages: message },
      $set: { updatedAt: message.timestamp || formatTimestamp() }
    }
  );

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
