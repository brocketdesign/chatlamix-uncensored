/**
 * Language Utilities
 * Shared utilities for language mapping and conversion
 */

/**
 * Map language names to language codes
 * Used for caption generation and other AI features
 */
const LANGUAGE_MAP = {
  'english': 'en',
  'japanese': 'ja',
  'french': 'fr',
  'portuguese': 'pt',
  'spanish': 'es',
  'chinese': 'zh',
  'korean': 'ko',
  'thai': 'th',
  'german': 'de',
  'italian': 'it',
  'russian': 'ru',
  'hindi': 'hi'
};

/**
 * Map language codes to human-readable names
 * Used for display and AI prompts
 */
const LANGUAGE_NAMES = {
  'en': 'English',
  'ja': 'Japanese',
  'fr': 'French',
  'pt': 'Portuguese',
  'es': 'Spanish',
  'zh': 'Chinese',
  'ko': 'Korean',
  'th': 'Thai',
  'de': 'German',
  'it': 'Italian',
  'ru': 'Russian',
  'hi': 'Hindi'
};

/**
 * Convert a language name or code to a language code
 * @param {string} language - Language name or code
 * @param {string} fallback - Fallback language code (default: 'en')
 * @returns {string} Language code
 */
function getLanguageCode(language, fallback = 'en') {
  if (!language) return fallback;
  
  // Check if it's already a valid language code
  if (LANGUAGE_NAMES[language]) {
    return language;
  }
  
  // Convert language name to code
  return LANGUAGE_MAP[language.toLowerCase()] || fallback;
}

/**
 * Get the human-readable name for a language code
 * @param {string} languageCode - Language code
 * @param {string} fallback - Fallback language name (default: 'English')
 * @returns {string} Language name
 */
function getLanguageName(languageCode, fallback = 'English') {
  return LANGUAGE_NAMES[languageCode] || fallback;
}

module.exports = {
  LANGUAGE_MAP,
  LANGUAGE_NAMES,
  getLanguageCode,
  getLanguageName
};
