/**
 * Publish Calendar Service
 * Handles publish calendars for scheduling content at specific weekly time slots
 */

const { ObjectId } = require('mongodb');

/**
 * Calendar statuses
 */
const CALENDAR_STATUSES = {
  ACTIVE: 'active',
  INACTIVE: 'inactive'
};

/**
 * Days of week (follows JavaScript Date convention)
 */
const DAYS_OF_WEEK = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Create a new publish calendar
 * @param {Object} data - Calendar data
 * @param {Object} db - Database connection
 * @returns {Object} Created calendar
 */
async function createCalendar(data, db) {
  const {
    userId,
    characterId = null,
    name,
    description = '',
    timezone = 'UTC',
    slots = []
  } = data;

  if (!name || name.trim().length === 0) {
    throw new Error('Calendar name is required');
  }

  // Validate and format slots
  const formattedSlots = slots.map(slot => ({
    _id: new ObjectId(),
    dayOfWeek: parseInt(slot.dayOfWeek),
    hour: parseInt(slot.hour),
    minute: parseInt(slot.minute) || 0,
    isEnabled: slot.isEnabled !== false
  }));

  // Validate slot values
  for (const slot of formattedSlots) {
    if (slot.dayOfWeek < 0 || slot.dayOfWeek > 6) {
      throw new Error('Invalid day of week. Must be 0-6 (Sunday-Saturday)');
    }
    if (slot.hour < 0 || slot.hour > 23) {
      throw new Error('Invalid hour. Must be 0-23');
    }
    if (slot.minute < 0 || slot.minute > 59) {
      throw new Error('Invalid minute. Must be 0-59');
    }
  }

  const calendar = {
    userId: new ObjectId(userId),
    characterId: characterId ? new ObjectId(characterId) : null,
    name: name.trim(),
    description: description.trim(),
    isActive: true,
    timezone,
    slots: formattedSlots,
    totalPublished: 0,
    lastPublishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('publishCalendars').insertOne(calendar);
  return { _id: result.insertedId, ...calendar };
}

/**
 * Get user's calendars
 * @param {Object} db - Database connection
 * @param {string} userId - User ID
 * @param {Object} filters - Filter options
 * @returns {Object} Calendars and pagination
 */
async function getUserCalendars(db, userId, filters = {}) {
  const {
    isActive,
    characterId,
    page = 1,
    limit = 20
  } = filters;

  const query = { userId: new ObjectId(userId) };

  if (isActive !== undefined) {
    query.isActive = isActive;
  }

  if (characterId) {
    query.characterId = new ObjectId(characterId);
  } else if (characterId === null) {
    // Explicitly looking for calendars without a character (if needed)
    // or we can treat undefined as "all"
  }

  const skip = (page - 1) * limit;

  const calendars = await db.collection('publishCalendars')
    .find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  const total = await db.collection('publishCalendars').countDocuments(query);

  return {
    calendars,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Get calendar by ID
 * @param {string} calendarId - Calendar ID
 * @param {Object} db - Database connection
 * @returns {Object} Calendar
 */
async function getCalendarById(calendarId, db) {
  if (!ObjectId.isValid(calendarId)) {
    return null;
  }
  return await db.collection('publishCalendars').findOne({
    _id: new ObjectId(calendarId)
  });
}

/**
 * Update calendar
 * @param {string} calendarId - Calendar ID
 * @param {string} userId - User ID (for ownership verification)
 * @param {Object} updates - Updates
 * @param {Object} db - Database connection
 */
async function updateCalendar(calendarId, userId, updates, db) {
  const allowedUpdates = {
    updatedAt: new Date()
  };

  if (updates.name !== undefined) {
    if (!updates.name || updates.name.trim().length === 0) {
      throw new Error('Calendar name is required');
    }
    allowedUpdates.name = updates.name.trim();
  }

  if (updates.description !== undefined) {
    allowedUpdates.description = updates.description.trim();
  }

  if (updates.isActive !== undefined) {
    allowedUpdates.isActive = Boolean(updates.isActive);
  }

  if (updates.timezone !== undefined) {
    allowedUpdates.timezone = updates.timezone;
  }

  if (updates.slots !== undefined) {
    // Validate and format slots
    const formattedSlots = updates.slots.map(slot => ({
      _id: slot._id ? new ObjectId(slot._id) : new ObjectId(),
      dayOfWeek: parseInt(slot.dayOfWeek),
      hour: parseInt(slot.hour),
      minute: parseInt(slot.minute) || 0,
      isEnabled: slot.isEnabled !== false
    }));

    // Validate slot values
    for (const slot of formattedSlots) {
      if (slot.dayOfWeek < 0 || slot.dayOfWeek > 6) {
        throw new Error('Invalid day of week. Must be 0-6 (Sunday-Saturday)');
      }
      if (slot.hour < 0 || slot.hour > 23) {
        throw new Error('Invalid hour. Must be 0-23');
      }
      if (slot.minute < 0 || slot.minute > 59) {
        throw new Error('Invalid minute. Must be 0-59');
      }
    }

    allowedUpdates.slots = formattedSlots;
  }

  const result = await db.collection('publishCalendars').updateOne(
    {
      _id: new ObjectId(calendarId),
      userId: new ObjectId(userId)
    },
    { $set: allowedUpdates }
  );

  return result.modifiedCount > 0;
}

/**
 * Delete calendar and cancel its queue
 * @param {string} calendarId - Calendar ID
 * @param {string} userId - User ID (for ownership verification)
 * @param {Object} db - Database connection
 * @returns {Object} Result with deleted calendar and cancelled queue count
 */
async function deleteCalendar(calendarId, userId, db) {
  // First, cancel all queued items for this calendar
  const cancelResult = await db.collection('calendarQueue').updateMany(
    {
      calendarId: new ObjectId(calendarId),
      status: { $in: ['queued', 'processing'] }
    },
    {
      $set: {
        status: 'cancelled',
        updatedAt: new Date()
      }
    }
  );

  // Delete the calendar
  const deleteResult = await db.collection('publishCalendars').deleteOne({
    _id: new ObjectId(calendarId),
    userId: new ObjectId(userId)
  });

  return {
    deleted: deleteResult.deletedCount > 0,
    cancelledQueueItems: cancelResult.modifiedCount
  };
}

/**
 * Add a slot to calendar
 * @param {string} calendarId - Calendar ID
 * @param {string} userId - User ID
 * @param {Object} slotData - Slot data
 * @param {Object} db - Database connection
 */
async function addSlot(calendarId, userId, slotData, db) {
  const { dayOfWeek, hour, minute = 0, isEnabled = true } = slotData;

  // Validate slot values
  if (dayOfWeek < 0 || dayOfWeek > 6) {
    throw new Error('Invalid day of week. Must be 0-6 (Sunday-Saturday)');
  }
  if (hour < 0 || hour > 23) {
    throw new Error('Invalid hour. Must be 0-23');
  }
  if (minute < 0 || minute > 59) {
    throw new Error('Invalid minute. Must be 0-59');
  }

  const slot = {
    _id: new ObjectId(),
    dayOfWeek: parseInt(dayOfWeek),
    hour: parseInt(hour),
    minute: parseInt(minute),
    isEnabled: Boolean(isEnabled)
  };

  const result = await db.collection('publishCalendars').updateOne(
    {
      _id: new ObjectId(calendarId),
      userId: new ObjectId(userId)
    },
    {
      $push: { slots: slot },
      $set: { updatedAt: new Date() }
    }
  );

  if (result.modifiedCount === 0) {
    throw new Error('Calendar not found or not authorized');
  }

  return slot;
}

/**
 * Remove a slot from calendar
 * @param {string} calendarId - Calendar ID
 * @param {string} userId - User ID
 * @param {string} slotId - Slot ID
 * @param {Object} db - Database connection
 */
async function removeSlot(calendarId, userId, slotId, db) {
  const result = await db.collection('publishCalendars').updateOne(
    {
      _id: new ObjectId(calendarId),
      userId: new ObjectId(userId)
    },
    {
      $pull: { slots: { _id: new ObjectId(slotId) } },
      $set: { updatedAt: new Date() }
    }
  );

  return result.modifiedCount > 0;
}

/**
 * Update a slot
 * @param {string} calendarId - Calendar ID
 * @param {string} userId - User ID
 * @param {string} slotId - Slot ID
 * @param {Object} updates - Updates
 * @param {Object} db - Database connection
 */
async function updateSlot(calendarId, userId, slotId, updates, db) {
  const setUpdates = { updatedAt: new Date() };

  if (updates.dayOfWeek !== undefined) {
    if (updates.dayOfWeek < 0 || updates.dayOfWeek > 6) {
      throw new Error('Invalid day of week. Must be 0-6 (Sunday-Saturday)');
    }
    setUpdates['slots.$.dayOfWeek'] = parseInt(updates.dayOfWeek);
  }

  if (updates.hour !== undefined) {
    if (updates.hour < 0 || updates.hour > 23) {
      throw new Error('Invalid hour. Must be 0-23');
    }
    setUpdates['slots.$.hour'] = parseInt(updates.hour);
  }

  if (updates.minute !== undefined) {
    if (updates.minute < 0 || updates.minute > 59) {
      throw new Error('Invalid minute. Must be 0-59');
    }
    setUpdates['slots.$.minute'] = parseInt(updates.minute);
  }

  if (updates.isEnabled !== undefined) {
    setUpdates['slots.$.isEnabled'] = Boolean(updates.isEnabled);
  }

  const result = await db.collection('publishCalendars').updateOne(
    {
      _id: new ObjectId(calendarId),
      userId: new ObjectId(userId),
      'slots._id': new ObjectId(slotId)
    },
    { $set: setUpdates }
  );

  return result.modifiedCount > 0;
}

/**
 * Get calendar statistics for user
 * @param {string} userId - User ID
 * @param {Object} db - Database connection
 */
async function getUserCalendarStats(userId, db) {
  const userIdObj = new ObjectId(userId);

  // Get calendar counts
  const calendars = await db.collection('publishCalendars').aggregate([
    { $match: { userId: userIdObj } },
    {
      $group: {
        _id: '$isActive',
        count: { $sum: 1 },
        totalSlots: { $sum: { $size: '$slots' } }
      }
    }
  ]).toArray();

  // Get queue counts
  const queueCounts = await db.collection('calendarQueue').aggregate([
    { $match: { userId: userIdObj } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]).toArray();

  // Get published this week
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const publishedThisWeek = await db.collection('calendarQueue').countDocuments({
    userId: userIdObj,
    status: 'published',
    publishedAt: { $gte: weekAgo }
  });

  const stats = {
    totalCalendars: 0,
    activeCalendars: 0,
    inactiveCalendars: 0,
    totalSlots: 0,
    queuedItems: 0,
    processingItems: 0,
    publishedItems: 0,
    failedItems: 0,
    publishedThisWeek
  };

  calendars.forEach(cal => {
    if (cal._id === true) {
      stats.activeCalendars = cal.count;
    } else {
      stats.inactiveCalendars = cal.count;
    }
    stats.totalCalendars += cal.count;
    stats.totalSlots += cal.totalSlots;
  });

  queueCounts.forEach(q => {
    switch (q._id) {
      case 'queued': stats.queuedItems = q.count; break;
      case 'processing': stats.processingItems = q.count; break;
      case 'published': stats.publishedItems = q.count; break;
      case 'failed': stats.failedItems = q.count; break;
    }
  });

  return stats;
}

/**
 * Increment calendar publish count
 * @param {string} calendarId - Calendar ID
 * @param {Object} db - Database connection
 */
async function incrementPublishCount(calendarId, db) {
  await db.collection('publishCalendars').updateOne(
    { _id: new ObjectId(calendarId) },
    {
      $inc: { totalPublished: 1 },
      $set: { lastPublishedAt: new Date() }
    }
  );
}

/**
 * Format slot for display
 * @param {Object} slot - Slot object
 * @returns {string} Formatted string
 */
function formatSlot(slot) {
  const dayName = DAY_NAMES[slot.dayOfWeek];
  const hour = slot.hour.toString().padStart(2, '0');
  const minute = slot.minute.toString().padStart(2, '0');
  return `${dayName} at ${hour}:${minute}`;
}

/**
 * Get active calendars with enabled slots (for processor)
 * @param {Object} db - Database connection
 * @returns {Array} Active calendars
 */
async function getActiveCalendarsWithSlots(db) {
  return await db.collection('publishCalendars')
    .find({
      isActive: true,
      'slots.isEnabled': true
    })
    .toArray();
}

module.exports = {
  CALENDAR_STATUSES,
  DAYS_OF_WEEK,
  DAY_NAMES,
  createCalendar,
  getUserCalendars,
  getCalendarById,
  updateCalendar,
  deleteCalendar,
  addSlot,
  removeSlot,
  updateSlot,
  getUserCalendarStats,
  incrementPublishCount,
  formatSlot,
  getActiveCalendarsWithSlots
};
