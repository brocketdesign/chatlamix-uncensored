/**
 * Predefined Guided Scenarios
 * 
 * Fast, pre-built scenarios with goals, thresholds, and engaging storylines.
 * These scenarios are designed to be immersive and guide users through
 * interactive conversations with clear objectives.
 */

const { ObjectId } = require('mongodb');

/**
 * Scenario categories
 */
const SCENARIO_CATEGORIES = {
    EMOTIONAL: 'emotional',
    ADVENTURE: 'adventure',
    MYSTERY: 'mystery',
    ROMANTIC: 'romantic',
    SUPPORTIVE: 'supportive',
    ALERT: 'alert' // Premium only
};

/**
 * Predefined scenarios with goals and thresholds
 * Each scenario includes:
 * - id: Unique identifier
 * - title: Catchy title
 * - description: Brief scenario description
 * - category: Scenario type
 * - initialSituation: The starting context
 * - goal: What the user should accomplish
 * - thresholds: Milestones in the conversation (progress points)
 * - finalQuote: Memorable quote when goal is achieved
 * - emotionalTone: The emotional atmosphere
 * - conversationDirection: How the conversation should flow
 * - isPremiumOnly: Whether this requires premium subscription
 * - isAlertOriented: Whether this is an alert/urgent scenario
 * - icon: Emoji icon for the scenario
 */
const PREDEFINED_SCENARIOS = [
    // === FREE SCENARIOS ===
    {
        id: 'lost-in-woods',
        title: '❄️ Lost in the Freezing Woods',
        description: 'A young person is stranded in the freezing cold woods, desperate for warmth and help. Will you be their savior?',
        category: SCENARIO_CATEGORIES.EMOTIONAL,
        initialSituation: 'You come across someone shivering in the freezing woods. They\'re barely dressed for the cold, their lips are turning blue, and they\'re asking for a blanket or any warmth you can provide.',
        goal: 'Help them survive the cold and earn their trust',
        thresholds: [
            { id: 1, name: 'First Contact', description: 'Acknowledge their situation', progress: 20 },
            { id: 2, name: 'Provide Comfort', description: 'Offer warmth or shelter', progress: 40 },
            { id: 3, name: 'Build Trust', description: 'They start to open up to you', progress: 60 },
            { id: 4, name: 'Deep Connection', description: 'Share a meaningful moment together', progress: 80 },
            { id: 5, name: 'Safe Haven', description: 'They feel completely safe with you', progress: 100 }
        ],
        finalQuote: '"Thank you for not leaving me alone in the cold. You saved more than just my body tonight... you warmed my heart."',
        emotionalTone: 'Vulnerable, grateful, intimate',
        conversationDirection: 'The character starts desperate and cold, gradually warming up (emotionally and physically) as you help them',
        isPremiumOnly: false,
        isAlertOriented: false,
        icon: '❄️'
    },
    {
        id: 'midnight-confession',
        title: '🌙 Midnight Confession',
        description: 'Late at night, they knock on your door with something important to say. The confession that follows could change everything.',
        category: SCENARIO_CATEGORIES.ROMANTIC,
        initialSituation: 'It\'s past midnight. There\'s a soft knock at your door. When you open it, you find them standing there, looking nervous and vulnerable, saying they couldn\'t sleep because there\'s something they need to tell you.',
        goal: 'Discover their secret and respond with understanding',
        thresholds: [
            { id: 1, name: 'Open Door', description: 'Invite them in', progress: 20 },
            { id: 2, name: 'Create Comfort', description: 'Make them feel safe to speak', progress: 40 },
            { id: 3, name: 'The Confession', description: 'They reveal what\'s on their mind', progress: 60 },
            { id: 4, name: 'Your Response', description: 'Show them your feelings', progress: 80 },
            { id: 5, name: 'New Beginning', description: 'Start something new together', progress: 100 }
        ],
        finalQuote: '"I\'ve been carrying these feelings for so long. Tonight, I finally feel free."',
        emotionalTone: 'Nervous, hopeful, passionate',
        conversationDirection: 'Starts with tension and nervousness, builds to an emotional climax as feelings are revealed',
        isPremiumOnly: false,
        isAlertOriented: false,
        icon: '🌙'
    },
    {
        id: 'rainy-day-shelter',
        title: '🌧️ Rainy Day Shelter',
        description: 'A sudden downpour traps you both under a small shelter. With nowhere to go, you have nothing but time and each other.',
        category: SCENARIO_CATEGORIES.ROMANTIC,
        initialSituation: 'Heavy rain suddenly pours down. You both scramble to a small bus shelter, pressed close together. The rain shows no signs of stopping, and you\'re stuck here... together.',
        goal: 'Turn an awkward situation into a memorable connection',
        thresholds: [
            { id: 1, name: 'Awkward Start', description: 'Break the initial silence', progress: 20 },
            { id: 2, name: 'Small Talk', description: 'Find common ground', progress: 40 },
            { id: 3, name: 'Getting Closer', description: 'Physical proximity leads to tension', progress: 60 },
            { id: 4, name: 'Heart to Heart', description: 'Share something personal', progress: 80 },
            { id: 5, name: 'Perfect Moment', description: 'Create a memory worth keeping', progress: 100 }
        ],
        finalQuote: '"I used to hate rainy days. But this one... I\'ll remember forever."',
        emotionalTone: 'Playful, intimate, serendipitous',
        conversationDirection: 'From awkward proximity to comfortable intimacy as the rain continues',
        isPremiumOnly: false,
        isAlertOriented: false,
        icon: '🌧️'
    },
    {
        id: 'broken-heart',
        title: '💔 Picking Up the Pieces',
        description: 'You find them crying alone, heartbroken from a recent breakup. They need someone to listen, to care, to help them heal.',
        category: SCENARIO_CATEGORIES.SUPPORTIVE,
        initialSituation: 'You find them sitting alone, tears streaming down their face. They\'ve just gone through a painful breakup and feel completely lost. They look up at you with red, puffy eyes.',
        goal: 'Help them heal and show them they\'re not alone',
        thresholds: [
            { id: 1, name: 'Be Present', description: 'Simply be there for them', progress: 20 },
            { id: 2, name: 'Listen', description: 'Let them express their pain', progress: 40 },
            { id: 3, name: 'Comfort', description: 'Offer words of support', progress: 60 },
            { id: 4, name: 'Hope', description: 'Help them see the light', progress: 80 },
            { id: 5, name: 'New Chapter', description: 'They start to smile again', progress: 100 }
        ],
        finalQuote: '"I thought no one would understand. But you... you made me believe in people again."',
        emotionalTone: 'Sad, healing, hopeful',
        conversationDirection: 'From deep sadness to gradual emotional recovery through compassion',
        isPremiumOnly: false,
        isAlertOriented: false,
        icon: '💔'
    },
    {
        id: 'secret-admirer',
        title: '💌 Secret Admirer Revealed',
        description: 'They\'ve been leaving you mysterious notes and gifts. Tonight, they finally reveal themselves. The question is: how will you react?',
        category: SCENARIO_CATEGORIES.MYSTERY,
        initialSituation: 'For weeks, you\'ve received anonymous love notes and small gifts. Tonight, you finally catch them in the act of leaving another note. They freeze when they see you, their identity finally revealed.',
        goal: 'Discover why they kept their feelings secret and what happens next',
        thresholds: [
            { id: 1, name: 'Caught', description: 'Confront them about the notes', progress: 20 },
            { id: 2, name: 'Explanation', description: 'Learn why they stayed anonymous', progress: 40 },
            { id: 3, name: 'True Feelings', description: 'They confess everything', progress: 60 },
            { id: 4, name: 'Your Move', description: 'Express how you feel', progress: 80 },
            { id: 5, name: 'No More Secrets', description: 'Start an open, honest connection', progress: 100 }
        ],
        finalQuote: '"I wrote a hundred notes trying to find the perfect words. Now, standing here with you, I realize I just needed to say three."',
        emotionalTone: 'Nervous, romantic, revealing',
        conversationDirection: 'Mystery transforms into romance as secrets are unveiled',
        isPremiumOnly: false,
        isAlertOriented: false,
        icon: '💌'
    },
    {
        id: 'old-flame',
        title: '🔥 Rekindling Old Flames',
        description: 'Years after you parted ways, you unexpectedly meet again. The chemistry is still there, but so is the history.',
        category: SCENARIO_CATEGORIES.ROMANTIC,
        initialSituation: 'You spot each other across a crowded café. Years have passed since you last spoke. They hesitate, then walk over with that familiar smile you never forgot.',
        goal: 'Navigate the past and decide if there\'s a future',
        thresholds: [
            { id: 1, name: 'Reunion', description: 'Break the ice after years apart', progress: 20 },
            { id: 2, name: 'Catching Up', description: 'Learn what life has been like', progress: 40 },
            { id: 3, name: 'Old Memories', description: 'Remember the good times', progress: 60 },
            { id: 4, name: 'Unfinished Business', description: 'Address what went wrong', progress: 80 },
            { id: 5, name: 'Second Chance', description: 'Decide what comes next', progress: 100 }
        ],
        finalQuote: '"We\'ve both changed so much. But the way I feel when I\'m with you? That hasn\'t changed at all."',
        emotionalTone: 'Nostalgic, hopeful, passionate',
        conversationDirection: 'From awkward reunion to emotional reconciliation',
        isPremiumOnly: false,
        isAlertOriented: false,
        icon: '🔥'
    },

    // === PREMIUM-ONLY SCENARIOS ===
    {
        id: 'late-night-call',
        title: '📞 The 3 AM Call',
        description: 'Your phone rings at 3 AM. It\'s them, and they sound different. Something is wrong, and they need you.',
        category: SCENARIO_CATEGORIES.ALERT,
        initialSituation: 'Your phone jolts you awake at 3 AM. It\'s them. Their voice is shaky, barely above a whisper. "I didn\'t know who else to call... I just needed to hear your voice."',
        goal: 'Be their anchor during a vulnerable moment',
        thresholds: [
            { id: 1, name: 'Answer', description: 'Pick up and listen', progress: 20 },
            { id: 2, name: 'Assess', description: 'Understand what\'s happening', progress: 40 },
            { id: 3, name: 'Reassure', description: 'Let them know they\'re not alone', progress: 60 },
            { id: 4, name: 'Support', description: 'Help them through the moment', progress: 80 },
            { id: 5, name: 'Dawn', description: 'Stay until they feel better', progress: 100 }
        ],
        finalQuote: '"You stayed on the line all night. You have no idea how much that meant to me."',
        emotionalTone: 'Urgent, vulnerable, protective',
        conversationDirection: 'From urgent concern to calm reassurance through the night',
        isPremiumOnly: true,
        isAlertOriented: true,
        icon: '📞'
    },
    {
        id: 'emergency-shelter',
        title: '🚨 Emergency Shelter',
        description: 'A sudden emergency forces them to seek shelter with you. Time is critical, and they\'re depending on you.',
        category: SCENARIO_CATEGORIES.ALERT,
        initialSituation: 'There\'s frantic knocking at your door. You open it to find them, breathless and scared. "Please, I didn\'t have anywhere else to go. Something happened and I... I need help."',
        goal: 'Protect them and provide safety during a crisis',
        thresholds: [
            { id: 1, name: 'Open Door', description: 'Let them in immediately', progress: 20 },
            { id: 2, name: 'Secure', description: 'Make sure they\'re physically safe', progress: 40 },
            { id: 3, name: 'Calm', description: 'Help them breathe and relax', progress: 60 },
            { id: 4, name: 'Listen', description: 'Understand what happened', progress: 80 },
            { id: 5, name: 'Safe Haven', description: 'They know they\'re protected', progress: 100 }
        ],
        finalQuote: '"When everything felt like it was falling apart, you were my safe place. I\'ll never forget that."',
        emotionalTone: 'Urgent, protective, trusting',
        conversationDirection: 'From panic and fear to safety and trust',
        isPremiumOnly: true,
        isAlertOriented: true,
        icon: '🚨'
    },
    {
        id: 'dangerous-secret',
        title: '🔒 The Dangerous Secret',
        description: 'They\'ve discovered something they shouldn\'t have, and now they\'re in danger. You\'re the only one they can trust.',
        category: SCENARIO_CATEGORIES.ALERT,
        initialSituation: 'They pull you into a private corner, eyes darting around nervously. "I found something. Something big. And now... I think someone knows that I know. I don\'t know who else to turn to."',
        goal: 'Help them decide what to do while keeping them safe',
        thresholds: [
            { id: 1, name: 'Trust', description: 'Convince them you can be trusted', progress: 20 },
            { id: 2, name: 'The Secret', description: 'Learn what they discovered', progress: 40 },
            { id: 3, name: 'Plan', description: 'Strategize together', progress: 60 },
            { id: 4, name: 'Action', description: 'Take steps to protect them', progress: 80 },
            { id: 5, name: 'Resolution', description: 'Find a way forward together', progress: 100 }
        ],
        finalQuote: '"I was terrified to tell anyone. But with you by my side, I feel like I can face anything."',
        emotionalTone: 'Tense, trusting, determined',
        conversationDirection: 'From paranoia and fear to strategic partnership',
        isPremiumOnly: true,
        isAlertOriented: true,
        icon: '🔒'
    },
    {
        id: 'forbidden-meeting',
        title: '🗝️ Forbidden Meeting',
        description: 'Meeting them is forbidden, but neither of you can stay away. Tonight, you risk everything just to be together.',
        category: SCENARIO_CATEGORIES.ROMANTIC,
        initialSituation: 'You meet in secret, in a place where no one will find you. The risk of being caught makes every moment more intense. They whisper, "We shouldn\'t be doing this... but I couldn\'t stay away from you."',
        goal: 'Share a forbidden moment and decide if the risk is worth it',
        thresholds: [
            { id: 1, name: 'Secret Meeting', description: 'Find each other in the shadows', progress: 20 },
            { id: 2, name: 'Confession', description: 'Admit why you both keep coming back', progress: 40 },
            { id: 3, name: 'The Risk', description: 'Acknowledge what you\'re risking', progress: 60 },
            { id: 4, name: 'Stolen Moment', description: 'Share something unforgettable', progress: 80 },
            { id: 5, name: 'Worth It', description: 'Decide what this means for you both', progress: 100 }
        ],
        finalQuote: '"They can forbid us from meeting. They can\'t forbid what I feel for you."',
        emotionalTone: 'Forbidden, passionate, daring',
        conversationDirection: 'Building tension and passion in stolen moments',
        isPremiumOnly: true,
        isAlertOriented: false,
        icon: '🗝️'
    },
    {
        id: 'last-chance',
        title: '⏰ Last Chance',
        description: 'One of you is leaving tomorrow, maybe forever. This is your last night together. Make it count.',
        category: SCENARIO_CATEGORIES.EMOTIONAL,
        initialSituation: 'Tomorrow, everything changes. One of you is leaving for a new life far away. You sit together in the quiet of the night, both knowing this might be the last time.',
        goal: 'Say everything that needs to be said before it\'s too late',
        thresholds: [
            { id: 1, name: 'Acknowledge', description: 'Face the reality of tomorrow', progress: 20 },
            { id: 2, name: 'Memories', description: 'Reflect on your time together', progress: 40 },
            { id: 3, name: 'Regrets', description: 'Share what you wish you\'d said sooner', progress: 60 },
            { id: 4, name: 'Promises', description: 'Make commitments for the future', progress: 80 },
            { id: 5, name: 'Goodbye', description: 'Find a way to say it', progress: 100 }
        ],
        finalQuote: '"No matter where I go, a part of me will always stay here with you."',
        emotionalTone: 'Bittersweet, loving, urgent',
        conversationDirection: 'From denial to acceptance to meaningful farewell',
        isPremiumOnly: true,
        isAlertOriented: false,
        icon: '⏰'
    }
];

/**
 * Get scenarios filtered by premium status
 * @param {boolean} isPremium - Whether user has premium access
 * @returns {Array} Filtered scenarios
 */
function getFilteredScenarios(isPremium = false) {
    if (isPremium) {
        return PREDEFINED_SCENARIOS;
    }
    return PREDEFINED_SCENARIOS.filter(s => !s.isPremiumOnly);
}

/**
 * Get a random selection of scenarios
 * @param {boolean} isPremium - Whether user has premium access
 * @param {number} count - Number of scenarios to return (default 3)
 * @returns {Array} Random selection of scenarios
 */
function getRandomScenarios(isPremium = false, count = 3) {
    const available = getFilteredScenarios(isPremium);
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Get scenarios by category
 * @param {string} category - Category to filter by
 * @param {boolean} isPremium - Whether user has premium access
 * @returns {Array} Filtered scenarios
 */
function getScenariosByCategory(category, isPremium = false) {
    return getFilteredScenarios(isPremium).filter(s => s.category === category);
}

/**
 * Get only alert-oriented scenarios (premium only)
 * @returns {Array} Alert scenarios
 */
function getAlertScenarios() {
    return PREDEFINED_SCENARIOS.filter(s => s.isAlertOriented);
}

/**
 * Personalize a scenario with character name
 * @param {Object} scenario - The scenario to personalize
 * @param {string} characterName - The character's name
 * @returns {Object} Personalized scenario
 */
function personalizeScenario(scenario, characterName) {
    const nameRegex = /\[Character name\]|\[character\]|they|them|their/gi;
    
    return {
        ...scenario,
        _id: new ObjectId().toString(),
        scenario_title: scenario.title,
        scenario_description: scenario.description,
        initial_situation: scenario.initialSituation,
        goal: scenario.goal,
        thresholds: scenario.thresholds,
        final_quote: scenario.finalQuote,
        emotional_tone: scenario.emotionalTone,
        conversation_direction: scenario.conversationDirection,
        is_premium_only: scenario.isPremiumOnly,
        is_alert_oriented: scenario.isAlertOriented,
        icon: scenario.icon,
        category: scenario.category,
        // Create a system prompt that incorporates the scenario
        system_prompt_addition: `
SCENARIO CONTEXT:
${scenario.initialSituation}

CHARACTER GOAL: ${scenario.goal}

Play out this scenario naturally. The character (${characterName}) should:
- Start from the initial situation described
- Respond authentically to the user's choices
- Progress through the emotional journey of the scenario
- Reference the scenario's emotional tone: ${scenario.emotionalTone}

Remember: This is a guided scenario. Help create memorable moments while staying true to ${characterName}'s personality.
        `.trim()
    };
}

/**
 * Get prepared scenarios for a character (fast, no AI generation needed)
 * @param {Object} charInfo - Character information
 * @param {boolean} isPremium - Whether user has premium access
 * @param {number} count - Number of scenarios to return
 * @returns {Array} Prepared scenarios
 */
function getPreparedScenarios(charInfo, isPremium = false, count = 3) {
    const characterName = charInfo?.name || 'the character';
    const randomScenarios = getRandomScenarios(isPremium, count);
    
    return randomScenarios.map(scenario => personalizeScenario(scenario, characterName));
}

/**
 * Get a specific scenario by ID and personalize it
 * @param {string} scenarioId - The scenario ID
 * @param {string} characterName - The character's name
 * @param {boolean} isPremium - Whether user has premium access
 * @returns {Object|null} The personalized scenario or null if not found/not accessible
 */
function getScenarioById(scenarioId, characterName, isPremium = false) {
    const scenario = PREDEFINED_SCENARIOS.find(s => s.id === scenarioId);
    
    if (!scenario) {
        return null;
    }
    
    // Check premium access
    if (scenario.isPremiumOnly && !isPremium) {
        return null;
    }
    
    return personalizeScenario(scenario, characterName);
}

module.exports = {
    PREDEFINED_SCENARIOS,
    SCENARIO_CATEGORIES,
    getFilteredScenarios,
    getRandomScenarios,
    getScenariosByCategory,
    getAlertScenarios,
    personalizeScenario,
    getPreparedScenarios,
    getScenarioById
};
