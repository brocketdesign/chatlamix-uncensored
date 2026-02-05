const { generateCompletion } = require('./openai');
const { getLanguageName } = require('./tool');
const { getUserChatToolSettings } = require('./chat-tool-settings-utils');
const { chatDataToString, userDetailsToString } = require('./chat-completion-utils');
const { OpenAI } = require("openai");
const { z } = require("zod");
const { zodResponseFormat } = require("openai/helpers/zod");

// Define the schema for chat suggestions
const chatSuggestionsSchema = {
  type: "json_schema",
  json_schema: {
    name: "chat_suggestions",
    schema: {
      type: "object",
      properties: {
        suggestions: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 3
        }
      },
      required: ["suggestions"]
    }
  }
};

/**
 * Generate chat suggestions based on current conversation context
 * @param {Object} db - MongoDB database instance
 * @param {Object} chatDocument - Chat character data
 * @param {Array} userMessages - Array of recent user/assistant messages
 * @param {Object} userInfo - User information
 * @param {string} language - User's language preference
 * @param {string} suggestionPreset - Preferred suggestion preset
 * @returns {Promise<Array>} Array of 3 suggestion strings
 */
async function generateChatSuggestions(db, chatDocument, userMessages, userInfo, language, suggestionPreset = 'neutral') {
    try {
        // Get user's chat settings including relationship type
        const userSettings = await getUserChatToolSettings(db, userInfo._id, chatDocument._id);
        const relationshipType = userSettings?.relationshipType || 'companion';
        
        // Get relationship instructions - handle both new gender-based and legacy formats
        const { relationshipInstructions } = require('./relashionshipInstructions');
        let relationshipDescription = ''
        
        // Determine gender from character (default to female if not specified)
        const characterGender = chatDocument?.gender?.toLowerCase() || 'female';
        const genderKey = characterGender === 'male' ? 'male' : 'female';
        
        // Get the appropriate relationship instruction
        if (relationshipInstructions[genderKey] && relationshipInstructions[genderKey][relationshipType]) {
            relationshipDescription = relationshipInstructions[genderKey][relationshipType];
        } else if (relationshipInstructions[genderKey] && relationshipInstructions[genderKey].companion) {
            relationshipDescription = relationshipInstructions[genderKey].companion;
        }
        
        // Get character description
        const characterDescription = chatDataToString(chatDocument);
        const userDetails = userDetailsToString(userInfo);
        
        // Get the last few messages for context (max 6 messages)
        const recentMessages = userMessages.slice(-6);
        const conversationContext = recentMessages
            .map(msg => `${msg.role}: ${msg.content}`)
            .join('\n');

        const preset = String(suggestionPreset || 'neutral').toLowerCase();
        const suggestionStyleDirectives = {
            flirty: 'Keep the suggestions playful, flirty, and slightly teasing with light emoji accents.',
            romantic: 'Make the suggestions soft, affectionate, and romantic with gentle warmth.',
            dominant: 'Use a confident, teasing, and slightly dominant tone with bold phrasing.',
            innocent: 'Keep the suggestions shy, sweet, and a little timid with bashful wording.',
            humorous: 'Make the suggestions witty, lighthearted, and playful with fun energy.',
            nsfw: 'Make the suggestions explicitly hot and direct, sexual, focusing on adult intimacy. Use bold and provocative language.',
            neutral: 'Keep the suggestions conversational, balanced, and low-pressure.'
        };
        const suggestionStyleInstruction = suggestionStyleDirectives[preset] || suggestionStyleDirectives.neutral;

        // Create system prompt for suggestion generation
        const systemPrompt = `You are a helpful assistant that generates natural conversation suggestions for users chatting with an AI character.

        Character Information:
        ${characterDescription}

        User Information:
        ${userDetails}

        Suggestion Style: ${preset}. ${suggestionStyleInstruction}

        Based on the recent conversation context, generate exactly 3 short, natural response suggestions that the user might want to send. Each suggestion should:
        1. Be contextually relevant to the conversation
        2. Match the relationship dynamic (${relationshipType}) and the suggestion style (${preset})
        3. Be appropriate for the character's personality
        4. Be conversational and engaging
        5. Be brief (max 15 words each)
        6. Feel natural and human-like
        7. Avoid generric and boring responses; focus on being specific and interesting.
        8. IMPORTANT: Generate suggestions in ${language} language only. Do NOT use any other language.

        Recent conversation:
        ${conversationContext}

        Generate 3 conversation suggestions in ${language}. IMPORTANT: All suggestions MUST be written in ${language}.`;
        
        console.log(`🌐 [generateChatSuggestions] Generating suggestions with language: "${language}"`);
        
        // Map language names to native language names for better AI understanding
        const languageNativeNames = {
            'french': 'français',
            'japanese': '日本語',
            'spanish': 'español',
            'portuguese': 'português',
            'german': 'Deutsch',
            'italian': 'italiano',
            'chinese': '中文',
            'korean': '한국어',
            'thai': 'ไทย',
            'russian': 'русский',
            'hindi': 'हिन्दी',
            'english': 'English'
        };
        const nativeLanguageName = languageNativeNames[language?.toLowerCase()] || language;

        // Create user prompt - STRONGLY emphasize language requirement
        const userPrompt = `CRITICAL: Write ONLY in ${nativeLanguageName}.

Generate exactly 3 short conversation suggestions in ${nativeLanguageName}.
Output format: {"suggestions": ["suggestion1 in ${nativeLanguageName}", "suggestion2 in ${nativeLanguageName}", "suggestion3 in ${nativeLanguageName}"]}`;

        // Use DeepSeek for better multilingual support (Llama doesn't follow language instructions well)
        const openai = new OpenAI({
            apiKey: process.env.NOVITA_API_KEY,
            baseURL: "https://api.novita.ai/openai",
        });        
        const response = await openai.chat.completions.create({
            model: "deepseek/deepseek-v3.2",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            max_tokens: 300,
            temperature: 0.8,
            top_p: 0.9,
            response_format: chatSuggestionsSchema,
        });
        
        const parsedResponse = JSON.parse(response.choices[0].message.content);
        console.log(`🌐 [generateChatSuggestions] AI returned suggestions:`, parsedResponse.suggestions);
        return parsedResponse.suggestions;

    } catch (error) {
        console.error('[generateChatSuggestions] Error generating suggestions:', error);
        return;
    }
}

/**
 * Generate default suggestions based on relationship type and language
 * @param {string} relationshipType - Type of relationship (companion, romantic, friend, etc.)
 * @param {string} language - User's language preference
 * @param {string} gender - Character gender (male/female)
 * @returns {Array} Array of 3 default suggestion strings
 */
function getDefaultSuggestions(relationshipType, language, gender = 'female') {
    const suggestions = {
        ja: {
            companion: [
                "それについてもっと教えて",
                "興味深いですね",
                "あなたの意見は？"
            ],
            friend: [
                "面白い話だね！",
                "今度一緒にやろう",
                "他に何かある？"
            ],
            wife: [
                "君のことが大好き",
                "一緒にいると幸せ",
                "今日はどうだった？"
            ],
            husband: [
                "君のことが大好き",
                "一緒にいると幸せ",
                "何か手伝えることある？"
            ],
            stepmom: [
                "ありがとう",
                "心配してくれてありがとう",
                "今日は楽しかった"
            ],
            first_date: [
                "これ面白いね",
                "もっと教えてほしい",
                "一緒にいると楽しい"
            ]
        },
        en: {
            companion: [
                "Tell me more about that",
                "That's interesting",
                "What's your opinion?"
            ],
            friend: [
                "That's a fun story!",
                "Let's do that together",
                "What else is going on?"
            ],
            wife: [
                "I love you so much",
                "You make me happy",
                "How was your day?"
            ],
            husband: [
                "I love you so much",
                "You mean everything to me",
                "Can I help with anything?"
            ],
            stepmom: [
                "Thank you so much",
                "I appreciate you caring",
                "That was a great day"
            ],
            first_date: [
                "That's really interesting",
                "Tell me more",
                "I'm having a great time"
            ]
        },
        fr: {
            companion: [
                "Raconte-moi en plus",
                "C'est intéressant",
                "Qu'en penses-tu ?"
            ],
            friend: [
                "C'est une histoire amusante !",
                "Faisons ça ensemble",
                "Quoi d'autre se passe ?"
            ],
            wife: [
                "Je t'aime tellement",
                "Tu me rends heureuse",
                "Comment s'est passée ta journée ?"
            ],
            husband: [
                "Je t'aime tellement",
                "Tu es tout pour moi",
                "Je peux t'aider ?"
            ],
            stepmom: [
                "Merci beaucoup",
                "J'apprécie ton soutien",
                "C'était une belle journée"
            ],
            first_date: [
                "C'est vraiment intéressant",
                "Raconte-moi plus",
                "Je m'amuse beaucoup"
            ]
        }
    };

    // Get language code (convert if needed)
    const langCode = getLanguageName(language) === 'japanese' ? 'ja' : 
                     getLanguageName(language) === 'french' ? 'fr' : 'en';
    
    // Get suggestions for the relationship type, fallback to companion
    const langSuggestions = suggestions[langCode] || suggestions.en;
    return langSuggestions[relationshipType] || langSuggestions.companion;
}

/**
 * Check if suggestions should be shown (based on last message timing and user preferences)
 * @param {Array} userMessages - Array of user messages
 * @param {Object} userSettings - User's chat tool settings
 * @returns {boolean} Whether to show suggestions
 */
function shouldShowSuggestions(userMessages, userSettings) {
    // Don't show suggestions if disabled in user settings
    if (userSettings?.disableSuggestions === true) {
        return false;
    }

    // Don't show suggestions if conversation is too short
    if (userMessages.length < 2) {
        return false;
    }

    // Only show suggestions after assistant messages
    const lastMessage = userMessages[userMessages.length - 1];
    if (lastMessage?.role !== 'assistant') {
        return false;
    }

    return true;
}

module.exports = {
    generateChatSuggestions,
    getDefaultSuggestions,
    shouldShowSuggestions
};
