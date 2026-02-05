const { ObjectId } = require('mongodb');

/**
 * Get chat scenario data for a specific user chat
 * @param {Object} db - MongoDB database instance
 * @param {string} userChatId - User chat ID
 * @returns {Object} Scenario data including current and available scenarios
 */
async function getChatScenarioData(db, userChatId) {
    try {
        const userChatCollection = db.collection('userChat');
        
        const userData = await userChatCollection.findOne(
            { _id: new ObjectId(userChatId) },
            { 
                projection: { 
                    currentScenario: 1, 
                    availableScenarios: 1, 
                    scenarioHistory: 1,
                    scenarioCreatedAt: 1,
                    scenarioProgress: 1  // Track progress through thresholds
                } 
            }
        );

        if (!userData) {
            throw new Error('User chat not found');
        }

        return {
            currentScenario: userData.currentScenario || null,
            availableScenarios: userData.availableScenarios || [],
            scenarioHistory: userData.scenarioHistory || [],
            scenarioCreatedAt: userData.scenarioCreatedAt || null,
            scenarioProgress: userData.scenarioProgress || 0
        };
    } catch (error) {
        console.error('Error getting chat scenario data:', error);
        throw error;
    }
}

/**
 * Get user's scenario statistics across all chats
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @returns {Object} Scenario statistics
 */
async function getUserScenariosStats(db, userId) {
    try {
        const userChatCollection = db.collection('userChat');
        
        const pipeline = [
            { $match: { userId: new ObjectId(userId) } },
            {
                $group: {
                    _id: null,
                    totalUsedScenarios: {
                        $sum: { $size: { $ifNull: ['$scenarioHistory', []] } }
                    },
                    chatsWithScenarios: { $sum: 1 }
                }
            }
        ];

        const stats = await userChatCollection.aggregate(pipeline).toArray();
        
        return stats[0] || {
            totalUsedScenarios: 0,
            chatsWithScenarios: 0
        };
    } catch (error) {
        console.error('Error getting user scenarios stats:', error);
        throw error;
    }
}

/**
 * Get scenario history for a user
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID
 * @param {number} limit - Maximum number of recent scenarios to return
 * @returns {Array} Array of scenarios with chat info
 */
async function getUserScenariosHistory(db, userId, limit = 20) {
    try {
        const userChatCollection = db.collection('userChat');
        
        const pipeline = [
            { $match: { userId: new ObjectId(userId) } },
            { $unwind: { path: '$scenarioHistory', preserveNullAndEmptyArrays: false } },
            {
                $lookup: {
                    from: 'chats',
                    localField: 'chatId',
                    foreignField: '_id',
                    as: 'chatInfo'
                }
            },
            {
                $addFields: {
                    chatInfo: { $arrayElemAt: ['$chatInfo', 0] }
                }
            },
            {
                $project: {
                    scenario: '$scenarioHistory',
                    chatName: '$chatInfo.name',
                    chatId: '$chatId',
                    userChatId: '$_id'
                }
            },
            { $sort: { 'scenario.selectedAt': -1 } },
            { $limit: limit }
        ];

        const history = await userChatCollection.aggregate(pipeline).toArray();
        return history;
    } catch (error) {
        console.error('Error getting user scenarios history:', error);
        throw error;
    }
}

/**
 * Update scenario selection and add to history
 * @param {Object} db - MongoDB database instance
 * @param {string} userChatId - User chat ID
 * @param {Object} selectedScenario - The selected scenario object
 */
async function selectScenario(db, userChatId, selectedScenario) {
    try {
        const userChatCollection = db.collection('userChat');
        
        const scenarioWithMetadata = {
            ...selectedScenario,
            selectedAt: new Date(),
            _id: new ObjectId()
        };

        await userChatCollection.updateOne(
            { _id: new ObjectId(userChatId) },
            { 
                $set: { currentScenario: selectedScenario },
                $push: { scenarioHistory: scenarioWithMetadata },
                $unset: { availableScenarios: "" }
            }
        );

        return true;
    } catch (error) {
        console.error('Error selecting scenario:', error);
        throw error;
    }
}

/**
 * Check if scenarios should be regenerated (only on new chats or when explicitly requested)
 * @param {number} messageCount - Total message count in the chat
 * @returns {boolean} True if scenarios should be generated
 */
function shouldGenerateScenarios(messageCount) {
    // Only generate scenarios at the very start of a chat (0-2 messages)
    return messageCount <= 2;
}

/**
 * Format scenario for display in UI
 * @param {Object} scenario - Scenario object (character name already replaced by generation function)
 * @returns {Object} Formatted scenario
 */
function formatScenarioForUI(scenario) {
    return {
        id: scenario._id || scenario.id,
        title: scenario.scenario_title,
        description: scenario.scenario_description,
        emotionalTone: scenario.emotional_tone,
        conversationDirection: scenario.conversation_direction,
        systemPromptAddition: scenario.system_prompt_addition,
        // New guided scenario fields
        initialSituation: scenario.initial_situation || null,
        goal: scenario.goal || null,
        thresholds: scenario.thresholds || null,
        finalQuote: scenario.final_quote || null,
        isPremiumOnly: scenario.is_premium_only || false,
        isAlertOriented: scenario.is_alert_oriented || false,
        icon: scenario.icon || null,
        category: scenario.category || null
    };
}

/**
 * Update scenario progress for a user chat
 * @param {Object} db - MongoDB database instance
 * @param {string} userChatId - User chat ID
 * @param {number} progress - Progress value (0-100)
 */
async function updateScenarioProgress(db, userChatId, progress) {
    try {
        const userChatCollection = db.collection('userChat');
        
        await userChatCollection.updateOne(
            { _id: new ObjectId(userChatId) },
            { $set: { scenarioProgress: Math.min(100, Math.max(0, progress)) } }
        );
        
        return true;
    } catch (error) {
        console.error('Error updating scenario progress:', error);
        throw error;
    }
}

/**
 * Get current scenario progress
 * @param {Object} db - MongoDB database instance
 * @param {string} userChatId - User chat ID
 * @returns {number} Progress value (0-100)
 */
async function getScenarioProgress(db, userChatId) {
    try {
        const userChatCollection = db.collection('userChat');
        
        const userData = await userChatCollection.findOne(
            { _id: new ObjectId(userChatId) },
            { projection: { scenarioProgress: 1 } }
        );
        
        return userData?.scenarioProgress || 0;
    } catch (error) {
        console.error('Error getting scenario progress:', error);
        return 0;
    }
}

module.exports = {
    getChatScenarioData,
    getUserScenariosStats,
    getUserScenariosHistory,
    selectScenario,
    shouldGenerateScenarios,
    formatScenarioForUI,
    updateScenarioProgress,
    getScenarioProgress
};
