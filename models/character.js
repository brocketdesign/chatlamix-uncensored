/**
 * Character/Persona Management Service
 * Handles multi-character architecture for users
 */

const { ObjectId } = require('mongodb');

/**
 * Character statuses
 */
const CHARACTER_STATUSES = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived'
};

/**
 * Create a new character
 * @param {Object} data - Character data
 * @param {Object} db - Database connection
 * @returns {Object} Created character
 */
async function createCharacter(data, db) {
  const {
    userId,
    name,
    bio = '',
    instagram = {},
    voiceId = '',
    avatarModel = '',
    status = CHARACTER_STATUSES.ACTIVE
  } = data;

  if (!userId) {
    throw new Error('User ID is required');
  }

  if (!name || name.trim().length === 0) {
    throw new Error('Character name is required');
  }

  const character = {
    userId: new ObjectId(userId),
    name: name.trim(),
    bio: bio.trim(),
    instagram: {
      username: instagram.username || '',
      accountId: instagram.accountId || '',
      accessToken: instagram.accessToken || '',
      tokenExpiresAt: instagram.tokenExpiresAt ? new Date(instagram.tokenExpiresAt) : null
    },
    voiceId: voiceId || '',
    avatarModel: avatarModel || '',
    status: status || CHARACTER_STATUSES.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('characters').insertOne(character);
  return { _id: result.insertedId, ...character };
}

/**
 * Get user's characters
 * @param {string} userId - User ID
 * @param {Object} db - Database connection
 * @param {Object} filters - Filter options
 * @returns {Array} Characters
 */
async function getUserCharacters(userId, db, filters = {}) {
  const query = { userId: new ObjectId(userId) };

  if (filters.status) {
    query.status = filters.status;
  }

  return await db.collection('characters')
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();
}

/**
 * Get character by ID
 * @param {string} characterId - Character ID
 * @param {Object} db - Database connection
 * @returns {Object} Character
 */
async function getCharacterById(characterId, db) {
  if (!characterId || !ObjectId.isValid(characterId)) {
    return null;
  }
  return await db.collection('characters').findOne({
    _id: new ObjectId(characterId)
  });
}

/**
 * Update character
 * @param {string} characterId - Character ID
 * @param {string} userId - User ID (for ownership verification)
 * @param {Object} updates - Updates
 * @param {Object} db - Database connection
 */
async function updateCharacter(characterId, userId, updates, db) {
  const allowedUpdates = {
    updatedAt: new Date()
  };

  if (updates.name !== undefined) allowedUpdates.name = updates.name.trim();
  if (updates.bio !== undefined) allowedUpdates.bio = updates.bio.trim();
  if (updates.voiceId !== undefined) allowedUpdates.voiceId = updates.voiceId;
  if (updates.avatarModel !== undefined) allowedUpdates.avatarModel = updates.avatarModel;
  if (updates.status !== undefined) allowedUpdates.status = updates.status;
  
  // Instagram updates should probably be handled carefully, but allowing direct update here for now
  if (updates.instagram) {
    allowedUpdates.instagram = updates.instagram;
  }

  const result = await db.collection('characters').updateOne(
    {
      _id: new ObjectId(characterId),
      userId: new ObjectId(userId)
    },
    { $set: allowedUpdates }
  );

  return result.modifiedCount > 0;
}

/**
 * Delete character
 * @param {string} characterId - Character ID
 * @param {string} userId - User ID
 * @param {Object} db - Database connection
 */
async function deleteCharacter(characterId, userId, db) {
  // Logic to handle dependent data (posts, calendars) should likely go here
  // or be handled by the caller. For now, just delete the character record.
  
  const result = await db.collection('characters').deleteOne({
    _id: new ObjectId(characterId),
    userId: new ObjectId(userId)
  });

  return result.deletedCount > 0;
}

module.exports = {
  CHARACTER_STATUSES,
  createCharacter,
  getUserCharacters,
  getCharacterById,
  updateCharacter,
  deleteCharacter
};
