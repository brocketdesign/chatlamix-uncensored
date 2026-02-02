const fetch = require('node-fetch');

/**
 * Default EvenLab voice settings
 */
const DEFAULT_VOICE_SETTINGS = {
    stability: 0.5,
    similarity_boost: 0.5,
    style: 0.0,
    use_speaker_boost: true
};

/**
 * Get voice configuration mapping for EvenLab voices with translations
 * @param {Object} fastify - Fastify instance
 * @returns {Object} Voice configuration mapping
 */
function getVoiceConfig(fastify) {
    const translations = fastify.getTranslations(fastify.request?.lang || 'en');
    
    return {
        default: { 
            voice_id: 'RBnMinrYKeccY3vaUxlZ', 
            gender: 'female', 
            language: 'en', 
            name: translations?.voices?.Sophia?.name || 'Sophia', 
            description: translations?.voices?.Sophia?.description || 'Japanese Female Voice' 
        },
        Thandiwe: { 
            voice_id: 'hWg8YNuo5PLOL69ByIl6', 
            gender: 'female', 
            language: 'en', 
            name: translations?.voices?.ThandiweDlamini?.name || 'Thandiwe Dlamini', 
            description: translations?.voices?.ThandiweDlamini?.description || 'A South African strategic brand leader' 
        },
        Miranda: { 
            voice_id: 'PoHUWWWMHFrA8z7Q88pu', 
            gender: 'female', 
            language: 'pt', 
            name: translations?.voices?.Miranda?.name || 'Miranda', 
            description: translations?.voices?.Miranda?.description || 'A sweet and bubbly young woman' 
        },
        Nana: { 
            voice_id: 'uyfkySFC5J00qZ6iLAdh', 
            gender: 'female', 
            language: 'en', 
            name: translations?.voices?.NanaChan?.name || 'Nana-chan', 
            description: translations?.voices?.NanaChan?.description || 'A youthful female voice, cute and' 
        },
        Sophia: { 
            voice_id: 'Qy12wuGOtvKPVgCREzXh', 
            gender: 'female', 
            language: 'en', 
            name: translations?.voices?.Sophia?.name || 'Sophia', 
            description: translations?.voices?.Sophia?.description || 'An American girl talking softly with a' 
        },
        Fena: { 
            voice_id: 'BlgEcC0TfWpBak7FmvHW', 
            gender: 'female', 
            language: 'en', 
            name: translations?.voices?.FenaCharacter?.name || 'Fena - Character', 
            description: translations?.voices?.FenaCharacter?.description || 'Young, sassy girl character' 
        }
    };
}

/**
 * Get EvenLab voice configuration
 * @param {string} voiceName - Voice name from user settings
 * @param {Object} fastify - Fastify instance
 * @returns {Object} Voice configuration
 */
function getEvenLabVoiceConfig(voiceName = 'Sophia', fastify) {
    const VOICE_CONFIG = getVoiceConfig(fastify);
    return VOICE_CONFIG[voiceName] || VOICE_CONFIG.default;
}

/**
 * Generate speech using EvenLab API
 * @param {string} text - Text to convert to speech
 * @param {string} voiceName - Voice name to use
 * @param {Object} options - Additional options
 * @param {Object} fastify - Fastify instance
 * @returns {Promise<Buffer>} Audio buffer
 */
async function generateSpeech(text, voiceName = 'Sophia', options = {}, fastify) {
    try {
        const voiceConfig = getEvenLabVoiceConfig(voiceName, fastify);
        console.log('[eventlab generateSpeech] Using voice config:', voiceConfig);
        const apiKey = process.env.EVENTLAB_API_KEY;
        
        if (!apiKey) {
            throw new Error('EVENTLAB_API_KEY is not configured');
        }
            
        const sanitizedMessage = text.replace(/(\[.*?\]|\*.*?\*)/g, '').replace(/[\uD83C-\uDBFF\uDC00-\uDFFF]/g, '').trim();

        const requestBody = {
            text: sanitizedMessage,
            model_id: options.model_id || 'eleven_multilingual_v2',
            voice_settings: {
                ...DEFAULT_VOICE_SETTINGS,
                ...options.voice_settings
            }
        };

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceConfig.voice_id}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': apiKey
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`EvenLab API error: ${response.status} - ${errorText}`);
        }

        return await response.buffer();
        
    } catch (error) {
        console.error('[generateSpeech] Error:', error);
        throw error;
    }
}

/**
 * Get available voices from EvenLab
 * @returns {Promise<Array>} List of available voices
 */
async function getAvailableVoices() {
    try {
        const apiKey = process.env.EVENTLAB_API_KEY;
        
        if (!apiKey) {
            throw new Error('EVENTLAB_API_KEY is not configured');
        }

        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
            method: 'GET',
            headers: {
                'xi-api-key': apiKey
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch voices: ${response.status}`);
        }

        const data = await response.json();
        return data.voices || [];
        
    } catch (error) {
        console.error('[getAvailableVoices] Error:', error);
        throw error;
    }
}

/**
 * Validate EvenLab API key
 * @returns {Promise<boolean>} True if API key is valid
 */
async function validateApiKey() {
    try {
        const apiKey = process.env.EVENTLAB_API_KEY;
        
        if (!apiKey) {
            return false;
        }

        const response = await fetch('https://api.elevenlabs.io/v1/user', {
            method: 'GET',
            headers: {
                'xi-api-key': apiKey
            }
        });

        return response.ok;
        
    } catch (error) {
        console.error('[validateApiKey] Error:', error);
        return false;
    }
}

module.exports = {
    DEFAULT_VOICE_SETTINGS,
    getVoiceConfig,
    getEvenLabVoiceConfig,
    generateSpeech,
    getAvailableVoices,
    validateApiKey
};
