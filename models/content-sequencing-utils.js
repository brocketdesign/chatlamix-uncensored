/**
 * Content Sequencing & Discovery Engine
 * 
 * Implements TikTok-style content discovery with:
 * - Weighted randomness (not pure random)
 * - Seen state tracking
 * - Tag-based personalization
 * - Time-based decay
 * - Fresh content boosting
 * - Diversity-aware selection (gender, age, NSFW/SFW)
 * - User preference personalization (from nightly analysis)
 */

const { ObjectId } = require('mongodb');

/**
 * Time constants for decay logic (in milliseconds)
 */
const TIME_CONSTANTS = {
  RECENTLY_SEEN: 24 * 60 * 60 * 1000,      // 1 day - avoid completely
  SHORT_TERM: 7 * 24 * 60 * 60 * 1000,     // 1 week - reduce weight
  MEDIUM_TERM: 30 * 24 * 60 * 60 * 1000,   // 1 month - neutral
  FRESH_CONTENT: 7 * 24 * 60 * 60 * 1000,  // Content from last week is "fresh"
  OLD_CONTENT: 90 * 24 * 60 * 60 * 1000,   // Content older than 3 months
  MIDDLE_CONTENT: 30 * 24 * 60 * 60 * 1000, // Content between 1-3 months
};

/**
 * Weight multipliers for scoring
 */
const WEIGHTS = {
  TAG_MATCH: 2.0,           // Boost for matching user's preferred tags
  FRESH_CONTENT: 1.5,       // Boost for recently created content
  POPULAR: 1.2,             // Slight boost for popular content
  RECENTLY_SEEN: 0.1,       // Heavy penalty for recently seen
  SHORT_TERM_SEEN: 0.5,     // Medium penalty for seen this week
  NEW_IMAGES: 1.3,          // Boost for characters with new images
  USER_PREFERENCE_MATCH: 1.8, // Boost for matching user's analyzed preferences
};

/**
 * Diversity distribution configuration
 * Defines target percentages for content diversity in the explore gallery
 */
const DIVERSITY_CONFIG = {
  // Gender distribution (percentages, should sum to 1.0)
  gender: {
    female: 0.45,      // 45% female characters
    male: 0.35,        // 35% male characters
    nonbinary: 0.15,   // 15% non-binary/other characters
    unknown: 0.05,     // 5% unspecified gender
  },
  // Content age distribution (percentages, should sum to 1.0)
  contentAge: {
    recent: 0.40,      // 40% recent content (< 1 week)
    middle: 0.35,      // 35% middle-aged content (1 week - 3 months)
    old: 0.25,         // 25% older content (> 3 months)
  },
  // NSFW/SFW distribution (percentages for users with NSFW enabled)
  contentRating: {
    sfw: 0.70,         // 70% SFW content
    nsfw: 0.30,        // 30% NSFW content
  },
};

/**
 * Calculate time-based decay multiplier
 * Content seen longer ago has less penalty
 */
function getDecayMultiplier(lastSeenTimestamp, timeConstants = TIME_CONSTANTS) {
  if (!lastSeenTimestamp) return 1.0;
  
  const now = Date.now();
  const timeSince = now - lastSeenTimestamp;
  
  if (timeSince < timeConstants.RECENTLY_SEEN) {
    return WEIGHTS.RECENTLY_SEEN; // Heavy penalty
  } else if (timeSince < timeConstants.SHORT_TERM) {
    return WEIGHTS.SHORT_TERM_SEEN; // Medium penalty
  } else if (timeSince < timeConstants.MEDIUM_TERM) {
    return 0.8; // Light penalty
  }
  
  return 1.0; // No penalty after a month
}

/**
 * Calculate freshness boost for new content
 */
function getFreshnessBoost(createdAt) {
  if (!createdAt) return 1.0;
  
  const now = Date.now();
  const contentAge = now - new Date(createdAt).getTime();
  
  if (contentAge < TIME_CONSTANTS.FRESH_CONTENT) {
    return WEIGHTS.FRESH_CONTENT;
  }
  
  return 1.0;
}

/**
 * Calculate tag relevance score
 * Higher score for tags that match user's interaction history
 */
function getTagRelevanceScore(characterTags, userPreferredTags) {
  if (!characterTags || characterTags.length === 0) return 1.0;
  if (!userPreferredTags || userPreferredTags.length === 0) return 1.0;
  
  const matchCount = characterTags.filter(tag => 
    userPreferredTags.some(userTag => 
      userTag.toLowerCase() === tag.toLowerCase()
    )
  ).length;
  
  if (matchCount === 0) return 1.0;
  
  // More matches = higher boost (but capped)
  return 1.0 + (matchCount * (WEIGHTS.TAG_MATCH - 1.0) / characterTags.length);
}

/**
 * Calculate weighted score for a character
 */
function calculateCharacterScore(character, userState, timeConstants = TIME_CONSTANTS) {
  const {
    seenCharacters = {},
    preferredTags = [],
  } = userState || {};
  
  let score = 1.0;
  
  // 1. Apply time-based decay for seen characters
  const lastSeen = seenCharacters[character.chatId?.toString()];
  if (lastSeen) {
    score *= getDecayMultiplier(lastSeen, timeConstants);
  }
  
  // 2. Apply freshness boost
  score *= getFreshnessBoost(character.latestImage || character.createdAt);
  
  // 3. Apply tag relevance
  score *= getTagRelevanceScore(character.chatTags, preferredTags);
  
  // 4. Apply popularity boost (based on image count as proxy)
  if (character.imageCount > 10) {
    score *= WEIGHTS.POPULAR;
  }
  
  // 5. Boost for characters with new images
  if (character.hasNewImages) {
    score *= WEIGHTS.NEW_IMAGES;
  }
  
  // Add small random factor to prevent complete determinism
  score *= (0.9 + Math.random() * 0.2);
  
  return score;
}

/**
 * Select top N characters from scored pool
 * Uses weighted random selection from top candidates
 */
function selectTopCharacters(scoredCharacters, count) {
  if (scoredCharacters.length === 0) return [];
  
  // Sort by score descending
  scoredCharacters.sort((a, b) => b.score - a.score);
  
  // Take top 3x the requested count as candidate pool
  const poolSize = Math.min(scoredCharacters.length, count * 3);
  const candidatePool = scoredCharacters.slice(0, poolSize);
  
  // Weighted random selection from pool
  const selected = [];
  const remaining = [...candidatePool];
  
  for (let i = 0; i < count && remaining.length > 0; i++) {
    // Calculate total score once per iteration
    const totalScore = remaining.reduce((sum, char) => sum + char.score, 0);
    
    // Random weighted selection
    let random = Math.random() * totalScore;
    let selectedIndex = 0;
    
    for (let j = 0; j < remaining.length; j++) {
      random -= remaining[j].score;
      if (random <= 0) {
        selectedIndex = j;
        break;
      }
    }
    
    selected.push(remaining[selectedIndex]);
    remaining.splice(selectedIndex, 1);
  }
  
  return selected.map(char => char.character);
}

/**
 * Rotate images within a character to show fresh ones first
 */
function rotateCharacterImages(character, seenImages = {}) {
  if (!character.images || character.images.length === 0) {
    return character;
  }
  
  const chatIdStr = character.chatId?.toString();
  const seenImageIds = seenImages[chatIdStr] || [];
  
  // Split into seen and unseen
  const unseenImages = [];
  const seenImagesList = [];
  
  character.images.forEach(image => {
    const imageId = image._id?.toString() || image.imageUrl;
    if (seenImageIds.includes(imageId)) {
      seenImagesList.push(image);
    } else {
      unseenImages.push(image);
    }
  });
  
  // Sort unseen by newest first
  unseenImages.sort((a, b) => {
    const dateA = new Date(a.createdAt || 0).getTime();
    const dateB = new Date(b.createdAt || 0).getTime();
    return dateB - dateA;
  });
  
  // Sort seen by oldest first (to re-show old ones before recent ones)
  seenImagesList.sort((a, b) => {
    const dateA = new Date(a.createdAt || 0).getTime();
    const dateB = new Date(b.createdAt || 0).getTime();
    return dateA - dateB;
  });
  
  // Combine: unseen first, then seen
  character.images = [...unseenImages, ...seenImagesList];
  
  return character;
}

/**
 * Get curated pool for cold start (new users)
 */
async function getColdStartPool(db, limit = 20) {
  const chatsGalleryCollection = db.collection('gallery');
  
  // Get popular characters with diverse content
  const pipeline = [
    { $unwind: '$images' },
    { 
      $match: { 
        'images.imageUrl': { $exists: true, $ne: null }
      } 
    },
    {
      $lookup: {
        from: 'chats',
        localField: 'chatId',
        foreignField: '_id',
        as: 'chat'
      }
    },
    { $unwind: '$chat' },
    {
      $match: {
        'chat.visibility': 'public'
      }
    },
    {
      $group: {
        _id: '$chatId',
        imageCount: { $sum: 1 },
        latestImage: { $max: '$images.createdAt' }
      }
    },
    // Mix of popular and recent
    { $sort: { imageCount: -1, latestImage: -1 } },
    { $limit: limit * 2 } // Get 2x to ensure diversity
  ];
  
  const characters = await chatsGalleryCollection.aggregate(pipeline).toArray();
  
  // Randomly shuffle to create diversity
  for (let i = characters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  
  return characters.slice(0, limit).map(c => c._id);
}

/**
 * Main sequencing function - applies weighted randomness to character list
 * Now with diversity-aware selection for balanced content distribution
 * @param {Array} characters - Raw character array from database
 * @param {Object} userState - User interaction state (seen characters, tags, etc.)
 * @param {Object} options - Sequencing options
 * @param {number} options.limit - Number of characters to return (default: 20)
 * @param {boolean} options.excludeRecent - Exclude recently seen characters (default: true)
 * @param {boolean} options.useDiversity - Use diversity-aware selection (default: true)
 * @param {Object} options.userPreferences - User preferences from nightly analysis
 * @returns {Array} Sequenced and diversified character array
 */
async function sequenceCharacters(characters, userState, options = {}) {
  const {
    limit = 20,
    excludeRecent = true,
    useDiversity = true,
    userPreferences = null,
    timeConstants = TIME_CONSTANTS,
  } = options;
  
  // Score each character
  const scoredCharacters = characters.map(character => {
    let score = calculateCharacterScore(character, userState, timeConstants);
    
    // Apply user preference boost from nightly analysis
    if (userPreferences) {
      score *= applyUserPreferenceBoost(character, userPreferences);
    }
    
    return { character, score };
  });
  
  // Filter out very recently seen if requested
  let filteredCharacters = scoredCharacters;
  if (excludeRecent && userState?.seenCharacters) {
    const recentThreshold = Date.now() - timeConstants.RECENTLY_SEEN;
    filteredCharacters = scoredCharacters.filter(({ character }) => {
      const lastSeen = userState.seenCharacters[character.chatId?.toString()];
      return !lastSeen || lastSeen < recentThreshold;
    });
  }
  
  // If we filtered too much, include some recent ones with low scores
  if (filteredCharacters.length < limit && filteredCharacters.length < scoredCharacters.length) {
    const filteredSet = new Set(filteredCharacters.map(c => c.character.chatId?.toString()));
    const remaining = scoredCharacters
      .filter(c => !filteredSet.has(c.character.chatId?.toString()))
      .sort((a, b) => {
        const lastSeenA = userState?.seenCharacters?.[a.character.chatId?.toString()] || 0;
        const lastSeenB = userState?.seenCharacters?.[b.character.chatId?.toString()] || 0;
        return lastSeenA - lastSeenB; // older first
      });
    const needed = limit - filteredCharacters.length;
    filteredCharacters = filteredCharacters.concat(remaining.slice(0, needed));
  }
  
  // Select characters using diversity-aware selection or simple weighted selection
  let selectedCharacters;
  if (useDiversity) {
    selectedCharacters = selectWithDiversity(filteredCharacters, limit, userPreferences);
  } else {
    selectedCharacters = selectTopCharacters(filteredCharacters, limit);
  }
  
  // Rotate images within each character
  if (userState?.seenImages) {
    selectedCharacters.forEach(character => {
      rotateCharacterImages(character, userState.seenImages);
    });
  }
  
  return selectedCharacters;
}

/**
 * Parse user state from browser storage or database
 */
function parseUserState(storageData) {
  try {
    if (typeof storageData === 'string') {
      return JSON.parse(storageData);
    }
    return storageData || {};
  } catch (error) {
    console.error('[ContentSequencing] Error parsing user state:', error);
    return {};
  }
}

/**
 * Update user's seen state
 */
function updateSeenState(userState, characterId, imageIds = [], timeConstants = TIME_CONSTANTS) {
  const state = userState || {};
  const now = Date.now();
  
  // Update seen characters
  if (!state.seenCharacters) state.seenCharacters = {};
  state.seenCharacters[characterId.toString()] = now;
  
  // Update seen images
  if (imageIds.length > 0) {
    if (!state.seenImages) state.seenImages = {};
    const chatIdStr = characterId.toString();
    if (!state.seenImages[chatIdStr]) state.seenImages[chatIdStr] = [];
    
    // Use Set for faster lookups
    const seenSet = new Set(state.seenImages[chatIdStr]);
    imageIds.forEach(imageId => {
      seenSet.add(imageId.toString());
    });
    state.seenImages[chatIdStr] = Array.from(seenSet);
    
    // Limit stored images per character to prevent bloat (keep last 50)
    if (state.seenImages[chatIdStr].length > 50) {
      state.seenImages[chatIdStr] = state.seenImages[chatIdStr].slice(-50);
    }
  }
  
  // Clean up old seen data (remove entries older than MEDIUM_TERM)
  const cleanupThreshold = now - timeConstants.MEDIUM_TERM;
  Object.keys(state.seenCharacters).forEach(charId => {
    if (state.seenCharacters[charId] < cleanupThreshold) {
      delete state.seenCharacters[charId];
      if (state.seenImages && state.seenImages[charId]) {
        delete state.seenImages[charId];
      }
    }
  });
  
  return state;
}

/**
 * Update user's tag preferences based on interaction
 */
function updateTagPreferences(userState, tags, interactionStrength = 1.0) {
  const state = userState || {};
  if (!state.tagPreferences) state.tagPreferences = {};
  if (!state.preferredTags) state.preferredTags = [];
  
  tags.forEach(tag => {
    const tagLower = tag.toLowerCase();
    
    // Increase tag score
    if (!state.tagPreferences[tagLower]) {
      state.tagPreferences[tagLower] = 0;
    }
    state.tagPreferences[tagLower] += interactionStrength;
  });
  
  // Update preferred tags list (top 10 tags)
  const sortedTags = Object.entries(state.tagPreferences)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);
  
  state.preferredTags = sortedTags;
  
  // Decay old tag preferences over time
  Object.keys(state.tagPreferences).forEach(tag => {
    state.tagPreferences[tag] *= 0.95; // 5% decay
    if (state.tagPreferences[tag] < 0.1) {
      delete state.tagPreferences[tag];
    }
  });
  
  return state;
}

/**
 * Categorize character by age (based on creation date)
 * @param {Date|string} createdAt - Character creation date
 * @returns {string} 'recent', 'middle', or 'old'
 */
function categorizeContentAge(createdAt) {
  if (!createdAt) return 'old';
  
  const now = Date.now();
  const contentAge = now - new Date(createdAt).getTime();
  
  if (contentAge < TIME_CONSTANTS.SHORT_TERM) {
    return 'recent';
  } else if (contentAge < TIME_CONSTANTS.OLD_CONTENT) {
    return 'middle';
  }
  return 'old';
}

/**
 * Normalize gender value to standard categories
 * @param {string} gender - Raw gender value from database
 * @returns {string} 'female', 'male', 'nonbinary', or 'unknown'
 */
function normalizeGender(gender) {
  if (!gender) return 'unknown';
  
  const genderLower = gender.toLowerCase().trim();
  
  // Female variations
  if (['female', 'woman', 'girl', 'feminine', 'f'].includes(genderLower)) {
    return 'female';
  }
  
  // Male variations
  if (['male', 'man', 'boy', 'masculine', 'm'].includes(genderLower)) {
    return 'male';
  }
  
  // Non-binary variations
  if (['non-binary', 'nonbinary', 'non binary', 'enby', 'genderqueer', 
       'genderfluid', 'agender', 'other', 'nb', 'trans', 'transgender'].includes(genderLower)) {
    return 'nonbinary';
  }
  
  return 'unknown';
}

/**
 * Check if character has any NSFW images
 * @param {Object} character - Character with images array
 * @returns {boolean}
 */
function hasNsfwContent(character) {
  if (!character.images || character.images.length === 0) return false;
  
  return character.images.some(img => 
    img.nsfw === true || img.nsfw === 'true' || img.nsfw === 'on'
  );
}

/**
 * Check if character has SFW images
 * @param {Object} character - Character with images array
 * @returns {boolean}
 */
function hasSfwContent(character) {
  if (!character.images || character.images.length === 0) return false;
  
  return character.images.some(img => 
    img.nsfw !== true && img.nsfw !== 'true' && img.nsfw !== 'on'
  );
}

/**
 * Group characters by diversity categories
 * @param {Array} characters - Array of character objects
 * @returns {Object} Grouped characters by gender, age, and NSFW status
 */
function groupCharactersByDiversity(characters) {
  const groups = {
    byGender: {
      female: [],
      male: [],
      nonbinary: [],
      unknown: [],
    },
    byAge: {
      recent: [],
      middle: [],
      old: [],
    },
    byRating: {
      sfw: [],
      nsfw: [],
    }
  };
  
  characters.forEach(char => {
    // Group by gender
    const gender = normalizeGender(char.character?.gender || char.gender);
    if (groups.byGender[gender]) {
      groups.byGender[gender].push(char);
    }
    
    // Group by content age (using chatCreatedAt or latestImage)
    const contentDate = char.character?.chatCreatedAt || char.character?.latestImage || 
                       char.chatCreatedAt || char.latestImage;
    const ageCategory = categorizeContentAge(contentDate);
    groups.byAge[ageCategory].push(char);
    
    // Group by content rating
    const charObj = char.character || char;
    if (hasNsfwContent(charObj)) {
      groups.byRating.nsfw.push(char);
    }
    if (hasSfwContent(charObj)) {
      groups.byRating.sfw.push(char);
    }
  });
  
  return groups;
}

/**
 * Select characters with diversity-aware distribution
 * Ensures a balanced mix of genders, content ages, and NSFW/SFW content
 * @param {Array} scoredCharacters - Array of {character, score} objects or raw character objects
 * @param {number} count - Number of characters to select
 * @param {Object} userPreferences - Optional user preferences from nightly analysis
 * @returns {Array} Selected characters with diversity balance
 */
function selectWithDiversity(scoredCharacters, count, userPreferences = null) {
  if (scoredCharacters.length === 0) return [];
  if (scoredCharacters.length <= count) {
    return scoredCharacters.map(c => c.character || c);
  }
  
  const groups = groupCharactersByDiversity(scoredCharacters);
  const selected = [];
  const selectedIds = new Set();
  
  // Calculate target counts based on diversity config
  // Adjust based on user preferences if available
  let genderConfig = { ...DIVERSITY_CONFIG.gender };
  let ageConfig = { ...DIVERSITY_CONFIG.contentAge };
  
  if (userPreferences?.preferredGenders) {
    // Boost preferred genders slightly while maintaining some diversity
    Object.keys(genderConfig).forEach(gender => {
      if (userPreferences.preferredGenders[gender] && userPreferences.preferredGenders[gender] > 0) {
        genderConfig[gender] = Math.min(0.6, genderConfig[gender] * 1.3);
      }
    });
    // Normalize to sum to 1 (with safety check for zero total)
    const total = Object.values(genderConfig).reduce((a, b) => a + b, 0);
    if (total > 0) {
      Object.keys(genderConfig).forEach(key => {
        genderConfig[key] /= total;
      });
    }
  }
  
  // Use floor instead of ceil to avoid exceeding count, then distribute remainder
  const calculateTargets = (config, total) => {
    const targets = {};
    let sum = 0;
    const keys = Object.keys(config);
    
    keys.forEach(key => {
      targets[key] = Math.floor(total * config[key]);
      sum += targets[key];
    });
    
    // Distribute remainder to largest categories first
    let remainder = total - sum;
    const sortedKeys = [...keys].sort((a, b) => config[b] - config[a]);
    for (let i = 0; remainder > 0 && i < sortedKeys.length; i++) {
      targets[sortedKeys[i]]++;
      remainder--;
    }
    
    return targets;
  };
  
  const targetCounts = {
    gender: calculateTargets(genderConfig, count),
    age: calculateTargets(ageConfig, count),
  };
  
  /**
   * Helper to pick from a group using weighted random selection
   * @param {Array} group - Group of characters to pick from
   * @param {number} targetCount - Number of characters to pick
   * @param {number} maxTotal - Maximum total selections allowed (to prevent exceeding count)
   */
  const pickFromGroup = (group, targetCount, maxTotal) => {
    const picked = [];
    // Sort by score descending
    const sortedGroup = [...group].sort((a, b) => (b.score || 0) - (a.score || 0));
    
    // Take top candidates as pool
    const poolSize = Math.min(sortedGroup.length, targetCount * 3);
    const pool = sortedGroup.slice(0, poolSize);
    
    let attempts = 0;
    const maxAttempts = targetCount * 2; // Prevent infinite loops
    
    while (picked.length < targetCount && pool.length > 0 && attempts < maxAttempts) {
      attempts++;
      
      // Check if we would exceed the maximum allowed
      if (maxTotal !== undefined && (selected.length + picked.length) >= maxTotal) {
        break;
      }
      
      const totalScore = pool.reduce((sum, c) => sum + (c.score || 1), 0);
      let random = Math.random() * totalScore;
      let selectedIndex = 0;
      
      for (let j = 0; j < pool.length; j++) {
        random -= (pool[j].score || 1);
        if (random <= 0) {
          selectedIndex = j;
          break;
        }
      }
      
      const char = pool[selectedIndex];
      const charId = (char.character?.chatId || char.chatId)?.toString();
      
      // Remove from pool regardless of selection
      pool.splice(selectedIndex, 1);
      
      // Only add if not already selected
      if (charId && !selectedIds.has(charId)) {
        picked.push(char.character || char);
        selectedIds.add(charId);
      }
      // Don't increment loop counter for duplicates - the while loop handles this
    }
    
    return picked;
  };
  
  // Phase 1: Pick by gender distribution (respecting count limit)
  Object.keys(targetCounts.gender).forEach(gender => {
    if (selected.length >= count) return;
    
    const genderGroup = groups.byGender[gender] || [];
    const target = Math.min(targetCounts.gender[gender], count - selected.length);
    const picks = pickFromGroup(genderGroup, target, count);
    selected.push(...picks);
  });
  
  // Phase 2: Ensure age distribution by adding missing categories (respecting count limit)
  if (selected.length < count) {
    Object.keys(targetCounts.age).forEach(ageCategory => {
      if (selected.length >= count) return;
      
      const current = selected.filter(char => {
        const date = char.chatCreatedAt || char.latestImage;
        return categorizeContentAge(date) === ageCategory;
      }).length;
      
      if (current < targetCounts.age[ageCategory]) {
        const deficit = Math.min(
          targetCounts.age[ageCategory] - current,
          count - selected.length
        );
        const ageGroup = groups.byAge[ageCategory].filter(c => {
          const charId = (c.character?.chatId || c.chatId)?.toString();
          return !selectedIds.has(charId);
        });
        
        const additionalPicks = pickFromGroup(ageGroup, deficit, count);
        selected.push(...additionalPicks);
      }
    });
  }
  
  // Phase 3: Fill remaining slots with highest scored unselected characters
  if (selected.length < count) {
    const remaining = scoredCharacters
      .filter(c => {
        const charId = (c.character?.chatId || c.chatId)?.toString();
        return !selectedIds.has(charId);
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    
    for (const item of remaining) {
      if (selected.length >= count) break;
      const charId = (item.character?.chatId || item.chatId)?.toString();
      if (charId && !selectedIds.has(charId)) {
        selected.push(item.character || item);
        selectedIds.add(charId);
      }
    }
  }
  
  // Shuffle the final selection to avoid predictable ordering
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }
  
  return selected.slice(0, count);
}

/**
 * Apply user preferences from nightly analysis to scoring
 * @param {Object} character - Character object
 * @param {Object} userPreferences - User preferences from database
 * @returns {number} Additional score multiplier
 */
function applyUserPreferenceBoost(character, userPreferences) {
  if (!userPreferences) return 1.0;
  
  let boost = 1.0;
  
  // Boost for preferred gender
  if (userPreferences.preferredGenders) {
    const charGender = normalizeGender(character.gender);
    const genderScore = userPreferences.preferredGenders[charGender] || 0;
    if (genderScore > 0.3) { // Only boost if strong preference (>30%)
      // Apply full boost for strong matches, scaled boost for moderate matches
      const boostFactor = genderScore > 0.5 ? WEIGHTS.USER_PREFERENCE_MATCH : 1 + (genderScore * (WEIGHTS.USER_PREFERENCE_MATCH - 1));
      boost *= boostFactor;
    }
  }
  
  // Boost for preferred character types (based on tags)
  // Cap at 2.0x maximum boost to prevent tag count from dominating
  if (userPreferences.preferredCharacterTypes && character.chatTags) {
    const matchingTypes = character.chatTags.filter(tag => 
      userPreferences.preferredCharacterTypes.some(
        pref => pref.toLowerCase() === tag.toLowerCase()
      )
    ).length;
    
    if (matchingTypes > 0) {
      // Logarithmic scale to diminish returns for many matching tags
      // Cap at 2.0x maximum boost
      const tagBoost = Math.min(2.0, 1 + (Math.log2(matchingTypes + 1) * 0.3));
      boost *= tagBoost;
    }
  }
  
  // Boost for preferred content rating
  if (userPreferences.nsfwPreference !== undefined) {
    const charHasNsfw = hasNsfwContent(character);
    if (userPreferences.nsfwPreference > 0.5 && charHasNsfw) {
      boost *= 1.2;
    } else if (userPreferences.nsfwPreference < 0.3 && !charHasNsfw) {
      boost *= 1.2;
    }
  }
  
  return boost;
}

/**
 * Get user preferences from the nightly analysis cache
 * @param {Object} db - Database instance
 * @param {string|ObjectId} userId - User ID
 * @returns {Object|null} User preferences or null
 */
async function getUserPreferencesFromCache(db, userId) {
  if (!userId) return null;
  
  try {
    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId;
    const preferencesCollection = db.collection('userPreferencesCache');
    
    const preferences = await preferencesCollection.findOne({ userId: userIdObj });
    return preferences;
  } catch (error) {
    console.error('[ContentSequencing] Error fetching user preferences:', error);
    return null;
  }
}

module.exports = {
  sequenceCharacters,
  rotateCharacterImages,
  getColdStartPool,
  parseUserState,
  updateSeenState,
  updateTagPreferences,
  calculateCharacterScore,
  selectWithDiversity,
  groupCharactersByDiversity,
  normalizeGender,
  categorizeContentAge,
  hasNsfwContent,
  hasSfwContent,
  applyUserPreferenceBoost,
  getUserPreferencesFromCache,
  TIME_CONSTANTS,
  WEIGHTS,
  DIVERSITY_CONFIG,
};
