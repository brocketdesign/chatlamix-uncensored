/**
 * Scheduling Service
 * Handles single and recurring scheduled executions for dashboard content generation
 */

const { ObjectId } = require('mongodb');
const cron = require('node-cron');
const parser = require('cron-parser');

/**
 * Schedule types
 */
const SCHEDULE_TYPES = {
  SINGLE: 'single',
  RECURRING: 'recurring'
};

/**
 * Schedule statuses
 */
const SCHEDULE_STATUSES = {
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  PAUSED: 'paused'
};

/**
 * Action types (what to generate)
 */
const ACTION_TYPES = {
  GENERATE_IMAGE: 'generate_image',
  GENERATE_VIDEO: 'generate_video',
  PUBLISH_POST: 'publish_post'
};

/**
 * Create a single scheduled task
 * @param {Object} data - Schedule data
 * @param {Object} db - Database connection
 * @returns {Object} Created schedule
 */
async function createSingleSchedule(data, db) {
  const {
    userId,
    characterId = null,
    actionType,
    scheduledFor,
    actionData, // Contains generation parameters
    postId = null,
    description = ''
  } = data;

  if (!scheduledFor || new Date(scheduledFor) <= new Date()) {
    throw new Error('Scheduled time must be in the future');
  }

  const schedule = {
    userId: new ObjectId(userId),
    characterId: characterId ? new ObjectId(characterId) : null,
    type: SCHEDULE_TYPES.SINGLE,
    actionType,
    scheduledFor: new Date(scheduledFor),
    actionData,
    postId: postId ? new ObjectId(postId) : null,
    description,
    status: SCHEDULE_STATUSES.PENDING,
    executedAt: null,
    result: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('schedules').insertOne(schedule);
  return { _id: result.insertedId, ...schedule };
}

/**
 * Create a recurring scheduled task (cron job or calendar-based)
 * @param {Object} data - Schedule data
 * @param {Object} db - Database connection
 * @returns {Object} Created schedule
 */
async function createRecurringSchedule(data, db) {
  const {
    userId,
    characterId = null,
    actionType,
    cronExpression,
    calendarId,
    useCalendar = false,
    calendarName = '',
    actionData,
    description = '',
    maxExecutions = null,
    endDate = null,
    mutationEnabled = false
  } = data;

  let nextExecutionAt = null;

  // Handle calendar-based or cron-based scheduling
  if (useCalendar && calendarId) {
    // Calendar-based recurring schedule
    // The next execution time will be determined by the calendar slots
    const { getNextAvailableSlot } = require('./calendar-queue-utils');
    const calendar = await db.collection('calendars').findOne({ _id: new ObjectId(calendarId) });
    
    if (!calendar) {
      throw new Error('Calendar not found');
    }
    
    const nextSlot = await getNextAvailableSlot(calendar, db);
    if (nextSlot) {
      nextExecutionAt = new Date(nextSlot.publishAt);
    }
  } else if (cronExpression) {
    // Traditional cron-based schedule
    // Validate cron expression
    try {
      parser.parseExpression(cronExpression);
    } catch (error) {
      throw new Error(`Invalid cron expression: ${error.message}`);
    }
    nextExecutionAt = getNextExecutionTime(cronExpression);
  } else {
    throw new Error('Either a cron expression or calendar must be specified');
  }

  const schedule = {
    userId: new ObjectId(userId),
    characterId: characterId ? new ObjectId(characterId) : null,
    type: SCHEDULE_TYPES.RECURRING,
    actionType,
    cronExpression: cronExpression || null,
    calendarId: calendarId ? new ObjectId(calendarId) : null,
    useCalendar,
    calendarName,
    actionData,
    description,
    mutationEnabled, // Whether to apply prompt mutations on each run
    maxExecutions,
    endDate: endDate ? new Date(endDate) : null,
    executionCount: 0,
    lastExecutedAt: null,
    nextExecutionAt,
    status: SCHEDULE_STATUSES.ACTIVE,
    generatedPostIds: [],
    error: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('schedules').insertOne(schedule);
  return { _id: result.insertedId, ...schedule };
}

/**
 * Get next execution time from cron expression
 * @param {string} cronExpression - Cron expression
 * @returns {Date} Next execution time
 */
function getNextExecutionTime(cronExpression) {
  try {
    const interval = parser.parseExpression(cronExpression);
    return interval.next().toDate();
  } catch (error) {
    console.error('[Scheduling] Error parsing cron expression:', error);
    return null;
  }
}

/**
 * Get pending single schedules ready to execute
 * @param {Object} db - Database connection
 * @returns {Array} Schedules ready to execute
 */
async function getPendingSingleSchedules(db) {
  return await db.collection('schedules')
    .find({
      type: SCHEDULE_TYPES.SINGLE,
      status: SCHEDULE_STATUSES.PENDING,
      scheduledFor: { $lte: new Date() }
    })
    .toArray();
}

/**
 * Get active recurring schedules ready to execute
 * @param {Object} db - Database connection
 * @returns {Array} Schedules ready to execute
 */
async function getActiveRecurringSchedules(db) {
  const now = new Date();
  
  return await db.collection('schedules')
    .find({
      type: SCHEDULE_TYPES.RECURRING,
      status: SCHEDULE_STATUSES.ACTIVE,
      nextExecutionAt: { $lte: now },
      $or: [
        { endDate: null },
        { endDate: { $gte: now } }
      ],
      $or: [
        { maxExecutions: null },
        { $expr: { $lt: ['$executionCount', '$maxExecutions'] } }
      ]
    })
    .toArray();
}

/**
 * Get user's schedules
 * @param {Object} db - Database connection
 * @param {string} userId - User ID
 * @param {Object} filters - Filter options
 * @returns {Object} Schedules and pagination
 */
async function getUserSchedules(db, userId, filters = {}) {
  const {
    type,
    status,
    actionType,
    page = 1,
    limit = 20
  } = filters;

  const query = { userId: new ObjectId(userId) };
  
  if (type) query.type = type;
  if (status) query.status = status;
  if (actionType) query.actionType = actionType;

  const skip = (page - 1) * limit;

  const schedules = await db.collection('schedules')
    .find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  const total = await db.collection('schedules').countDocuments(query);

  return {
    schedules,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Update schedule status
 * @param {string} scheduleId - Schedule ID
 * @param {string} status - New status
 * @param {Object} db - Database connection
 */
async function updateScheduleStatus(scheduleId, status, db) {
  await db.collection('schedules').updateOne(
    { _id: new ObjectId(scheduleId) },
    {
      $set: {
        status,
        updatedAt: new Date()
      }
    }
  );
}

/**
 * Mark single schedule as executed
 * @param {string} scheduleId - Schedule ID
 * @param {Object} result - Execution result
 * @param {Object} db - Database connection
 */
async function markSingleScheduleExecuted(scheduleId, result, db) {
  const update = {
    status: result.success ? SCHEDULE_STATUSES.COMPLETED : SCHEDULE_STATUSES.FAILED,
    executedAt: new Date(),
    result: result.data || null,
    error: result.error || null,
    updatedAt: new Date()
  };

  await db.collection('schedules').updateOne(
    { _id: new ObjectId(scheduleId) },
    { $set: update }
  );
}

/**
 * Mark recurring schedule as executed
 * @param {string} scheduleId - Schedule ID
 * @param {Object} result - Execution result
 * @param {Object} db - Database connection
 */
async function markRecurringScheduleExecuted(scheduleId, result, db) {
  const schedule = await db.collection('schedules').findOne({
    _id: new ObjectId(scheduleId)
  });

  if (!schedule) {
    throw new Error('Schedule not found');
  }

  const newExecutionCount = schedule.executionCount + 1;
  
  // Calculate next execution time based on calendar or cron
  let nextExecutionAt = null;
  if (schedule.useCalendar && schedule.calendarId) {
    // Calendar-based: get next available slot
    const { getNextAvailableSlot } = require('./calendar-queue-utils');
    const calendar = await db.collection('calendars').findOne({ _id: schedule.calendarId });
    if (calendar) {
      const nextSlot = await getNextAvailableSlot(calendar, db);
      if (nextSlot) {
        nextExecutionAt = new Date(nextSlot.publishAt);
      }
    }
  } else if (schedule.cronExpression) {
    // Cron-based
    nextExecutionAt = getNextExecutionTime(schedule.cronExpression);
  }
  
  // Check if should be completed
  let newStatus = schedule.status;
  if (schedule.maxExecutions && newExecutionCount >= schedule.maxExecutions) {
    newStatus = SCHEDULE_STATUSES.COMPLETED;
  } else if (schedule.endDate && new Date() >= schedule.endDate) {
    newStatus = SCHEDULE_STATUSES.COMPLETED;
  } else if (result.error) {
    newStatus = SCHEDULE_STATUSES.FAILED;
  } else if (!nextExecutionAt) {
    // No next execution available (calendar has no more slots)
    newStatus = SCHEDULE_STATUSES.COMPLETED;
  }
  const update = {
    executionCount: newExecutionCount,
    lastExecutedAt: new Date(),
    nextExecutionAt: newStatus === SCHEDULE_STATUSES.ACTIVE ? nextExecutionAt : null,
    status: newStatus,
    updatedAt: new Date()
  };

  // Add generated post ID if successful
  if (result.postId) {
    update.$push = {
      generatedPostIds: new ObjectId(result.postId)
    };
  }

  if (result.error) {
    update.error = result.error;
  }

  await db.collection('schedules').updateOne(
    { _id: new ObjectId(scheduleId) },
    { $set: update, ...(update.$push && { $push: update.$push }) }
  );
}

/**
 * Pause a recurring schedule
 * @param {string} scheduleId - Schedule ID
 * @param {Object} db - Database connection
 */
async function pauseSchedule(scheduleId, db) {
  await db.collection('schedules').updateOne(
    { _id: new ObjectId(scheduleId), type: SCHEDULE_TYPES.RECURRING },
    {
      $set: {
        status: SCHEDULE_STATUSES.PAUSED,
        updatedAt: new Date()
      }
    }
  );
}

/**
 * Resume a paused schedule
 * @param {string} scheduleId - Schedule ID
 * @param {Object} db - Database connection
 */
async function resumeSchedule(scheduleId, db) {
  const schedule = await db.collection('schedules').findOne({
    _id: new ObjectId(scheduleId)
  });

  if (!schedule || schedule.type !== SCHEDULE_TYPES.RECURRING) {
    throw new Error('Schedule not found or not recurring');
  }

  // Calculate next execution time based on calendar or cron
  let nextExecutionAt = null;
  if (schedule.useCalendar && schedule.calendarId) {
    // Calendar-based: get next available slot
    const { getNextAvailableSlot } = require('./calendar-queue-utils');
    const calendar = await db.collection('calendars').findOne({ _id: schedule.calendarId });
    if (calendar) {
      const nextSlot = await getNextAvailableSlot(calendar, db);
      if (nextSlot) {
        nextExecutionAt = new Date(nextSlot.publishAt);
      }
    }
  } else if (schedule.cronExpression) {
    // Cron-based
    nextExecutionAt = getNextExecutionTime(schedule.cronExpression);
  }

  await db.collection('schedules').updateOne(
    { _id: new ObjectId(scheduleId) },
    {
      $set: {
        status: SCHEDULE_STATUSES.ACTIVE,
        nextExecutionAt,
        updatedAt: new Date()
      }
    }
  );
}

/**
 * Cancel a schedule
 * @param {string} scheduleId - Schedule ID
 * @param {string} userId - User ID (for ownership verification)
 * @param {Object} db - Database connection
 */
async function cancelSchedule(scheduleId, userId, db) {
  const result = await db.collection('schedules').updateOne(
    { 
      _id: new ObjectId(scheduleId),
      userId: new ObjectId(userId)
    },
    {
      $set: {
        status: SCHEDULE_STATUSES.CANCELLED,
        updatedAt: new Date()
      }
    }
  );

  return result.modifiedCount > 0;
}

/**
 * Delete a schedule
 * @param {string} scheduleId - Schedule ID
 * @param {string} userId - User ID (for ownership verification)
 * @param {Object} db - Database connection
 */
async function deleteSchedule(scheduleId, userId, db) {
  const result = await db.collection('schedules').deleteOne({
    _id: new ObjectId(scheduleId),
    userId: new ObjectId(userId)
  });

  return result.deletedCount > 0;
}

/**
 * Get schedule by ID
 * @param {string} scheduleId - Schedule ID
 * @param {Object} db - Database connection
 */
async function getScheduleById(scheduleId, db) {
  return await db.collection('schedules').findOne({
    _id: new ObjectId(scheduleId)
  });
}

/**
 * Update schedule
 * @param {string} scheduleId - Schedule ID
 * @param {Object} updates - Updates
 * @param {Object} db - Database connection
 */
async function updateSchedule(scheduleId, updates, db) {
  const allowedUpdates = {
    description: updates.description,
    actionData: updates.actionData,
    mutationEnabled: updates.mutationEnabled,
    updatedAt: new Date()
  };

  // Handle calendar-based vs cron-based recurring schedules
  if (updates.useCalendar !== undefined) {
    allowedUpdates.useCalendar = updates.useCalendar;
  }
  
  if (updates.calendarId !== undefined) {
    allowedUpdates.calendarId = updates.calendarId ? new ObjectId(updates.calendarId) : null;
    allowedUpdates.calendarName = updates.calendarName || '';
    
    // If switching to calendar-based, calculate next slot
    if (updates.useCalendar && updates.calendarId) {
      const { getNextAvailableSlot } = require('./calendar-queue-utils');
      const calendar = await db.collection('calendars').findOne({ _id: new ObjectId(updates.calendarId) });
      if (calendar) {
        const nextSlot = await getNextAvailableSlot(calendar, db);
        if (nextSlot) {
          allowedUpdates.nextExecutionAt = new Date(nextSlot.publishAt);
        }
      }
      // Clear cron expression when using calendar
      allowedUpdates.cronExpression = null;
    }
  }

  // For recurring schedules, allow updating cron expression
  if (updates.cronExpression) {
    try {
      parser.parseExpression(updates.cronExpression);
      allowedUpdates.cronExpression = updates.cronExpression;
      allowedUpdates.nextExecutionAt = getNextExecutionTime(updates.cronExpression);
      // Clear calendar when using cron
      allowedUpdates.useCalendar = false;
      allowedUpdates.calendarId = null;
      allowedUpdates.calendarName = '';
    } catch (error) {
      throw new Error(`Invalid cron expression: ${error.message}`);
    }
  }

  // For single schedules, allow updating scheduled time
  if (updates.scheduledFor) {
    if (new Date(updates.scheduledFor) <= new Date()) {
      throw new Error('Scheduled time must be in the future');
    }
    allowedUpdates.scheduledFor = new Date(updates.scheduledFor);
  }

  // Remove undefined values
  Object.keys(allowedUpdates).forEach(key => {
    if (allowedUpdates[key] === undefined) {
      delete allowedUpdates[key];
    }
  });

  await db.collection('schedules').updateOne(
    { _id: new ObjectId(scheduleId) },
    { $set: allowedUpdates }
  );
}

/**
 * Get schedule statistics for user
 * @param {string} userId - User ID
 * @param {Object} db - Database connection
 */
async function getUserScheduleStats(userId, db) {
  const stats = await db.collection('schedules').aggregate([
    { $match: { userId: new ObjectId(userId) } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]).toArray();

  const statsObj = {
    total: 0,
    pending: 0,
    active: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    paused: 0
  };

  stats.forEach(stat => {
    statsObj[stat._id] = stat.count;
    statsObj.total += stat.count;
  });

  return statsObj;
}

module.exports = {
  SCHEDULE_TYPES,
  SCHEDULE_STATUSES,
  ACTION_TYPES,
  createSingleSchedule,
  createRecurringSchedule,
  getPendingSingleSchedules,
  getActiveRecurringSchedules,
  getUserSchedules,
  updateScheduleStatus,
  markSingleScheduleExecuted,
  markRecurringScheduleExecuted,
  pauseSchedule,
  resumeSchedule,
  cancelSchedule,
  deleteSchedule,
  getScheduleById,
  updateSchedule,
  getUserScheduleStats,
  getNextExecutionTime
};
