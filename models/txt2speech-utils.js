const fetch = require('node-fetch');

const MINIMAX_ENDPOINT = 'https://api.novita.ai/v3/minimax-speech-2.6-turbo';
const DEFAULT_MINIMAX_VOICE_KEY = 'Wise_Woman';

const DEFAULT_AUDIO_SETTINGS = {
    format: 'mp3',
    sample_rate: 24000,
    bitrate: 128000,
    channel: 1
};

const MINIMAX_VOICES = {
    [DEFAULT_MINIMAX_VOICE_KEY]: {
        key: DEFAULT_MINIMAX_VOICE_KEY,
        voice_id: DEFAULT_MINIMAX_VOICE_KEY,
        gender: 'female',
        language: 'en',
        name: 'Wise Woman',
        description: 'Warm, expressive female voice suited for companion chats.'
    },
    Friendly_Person: {
        key: 'Friendly_Person',
        voice_id: 'Friendly_Person',
        gender: 'male',
        language: 'en',
        name: 'Friendly Person',
        description: 'Upbeat and approachable tone with clear articulation.'
    },
    Inspirational_girl: {
        key: 'Inspirational_girl',
        voice_id: 'Inspirational_girl',
        gender: 'female',
        language: 'en',
        name: 'Inspirational Girl',
        description: 'Encouraging youthful voice with bright delivery.'
    },
    Deep_Voice_Man: {
        key: 'Deep_Voice_Man',
        voice_id: 'Deep_Voice_Man',
        gender: 'male',
        language: 'en',
        name: 'Deep Voice Man',
        description: 'Resonant baritone with steady pacing.'
    },
    Calm_Woman: {
        key: 'Calm_Woman',
        voice_id: 'Calm_Woman',
        gender: 'female',
        language: 'en',
        name: 'Calm Woman',
        description: 'Soothing, measured delivery ideal for relaxed chats.'
    },
    Casual_Guy: {
        key: 'Casual_Guy',
        voice_id: 'Casual_Guy',
        gender: 'male',
        language: 'en',
        name: 'Casual Guy',
        description: 'Easygoing conversational tone with friendly inflection.'
    },
    Lively_Girl: {
        key: 'Lively_Girl',
        voice_id: 'Lively_Girl',
        gender: 'female',
        language: 'en',
        name: 'Lively Girl',
        description: 'Animated and energetic delivery with quick cadence.'
    },
    Patient_Man: {
        key: 'Patient_Man',
        voice_id: 'Patient_Man',
        gender: 'male',
        language: 'en',
        name: 'Patient Man',
        description: 'Steady, reassuring tone suited for supportive dialogue.'
    },
    Young_Knight: {
        key: 'Young_Knight',
        voice_id: 'Young_Knight',
        gender: 'male',
        language: 'en',
        name: 'Young Knight',
        description: 'Confident youthful voice with heroic flair.'
    },
    Determined_Man: {
        key: 'Determined_Man',
        voice_id: 'Determined_Man',
        gender: 'male',
        language: 'en',
        name: 'Determined Man',
        description: 'Driven tone with purposeful emphasis.'
    },
    Lovely_Girl: {
        key: 'Lovely_Girl',
        voice_id: 'Lovely_Girl',
        gender: 'female',
        language: 'en',
        name: 'Lovely Girl',
        description: 'Gentle and charming voice with soft intonation.'
    },
    Decent_Boy: {
        key: 'Decent_Boy',
        voice_id: 'Decent_Boy',
        gender: 'male',
        language: 'en',
        name: 'Decent Boy',
        description: 'Warm adolescent voice with polite expression.'
    },
    Imposing_Manner: {
        key: 'Imposing_Manner',
        voice_id: 'Imposing_Manner',
        gender: 'male',
        language: 'en',
        name: 'Imposing Manner',
        description: 'Commanding presence with deep projection.'
    },
    Elegant_Man: {
        key: 'Elegant_Man',
        voice_id: 'Elegant_Man',
        gender: 'male',
        language: 'en',
        name: 'Elegant Man',
        description: 'Refined delivery with sophisticated nuance.'
    },
    Abbess: {
        key: 'Abbess',
        voice_id: 'Abbess',
        gender: 'female',
        language: 'en',
        name: 'Abbess',
        description: 'Serene and dignified tone with gentle authority.'
    },
    Sweet_Girl_2: {
        key: 'Sweet_Girl_2',
        voice_id: 'Sweet_Girl_2',
        gender: 'female',
        language: 'en',
        name: 'Sweet Girl 2',
        description: 'Bright youthful voice with affectionate warmth.'
    },
    Exuberant_Girl: {
        key: 'Exuberant_Girl',
        voice_id: 'Exuberant_Girl',
        gender: 'female',
        language: 'en',
        name: 'Exuberant Girl',
        description: 'High-energy delivery bursting with enthusiasm.'
    }
};

function sanitizeMessage(text = '') {
    return text
        .replace(/(\[.*?\]|\*.*?\*)/g, '')
        .replace(/[\uD83C-\uDBFF\uDC00-\uDFFF]/g, '')
        .trim();
}

function getVoiceEntriesWithTranslations(fastify) {
    const translations = fastify.getTranslations(fastify.request?.lang || 'en');
    const voiceTranslations = translations?.voices || {};

    return Object.entries(MINIMAX_VOICES).reduce((acc, [key, config]) => {
        const translated = voiceTranslations[key] || {};
        acc[key] = {
            ...config,
            name: translated.name || config.name,
            description: translated.description || config.description
        };
        return acc;
    }, {});
}

function getMinimaxVoiceConfig(voiceKey = DEFAULT_MINIMAX_VOICE_KEY, fastify) {
    const entries = getVoiceEntriesWithTranslations(fastify);
    return entries[voiceKey] || entries.default;
}

function getMinimaxVoices(fastify) {
    const entries = getVoiceEntriesWithTranslations(fastify);
    return Object.values(entries).filter(entry => entry.key !== 'default');
}

function hexToBuffer(hexString) {
    if (!hexString || typeof hexString !== 'string') {
        return Buffer.alloc(0);
    }
    const cleaned = hexString.replace(/\s+/g, '').toLowerCase();
    if (cleaned.length % 2 !== 0) {
        throw new Error('Hex string has an invalid length');
    }
    return Buffer.from(cleaned, 'hex');
}

function mapLanguageBoost(language) {
    if (!language) {
        return 'Japanese';
    }

    const normalized = String(language).trim().toLowerCase();

    switch (normalized) {
        case 'ja':
        case 'jp':
        case 'japanese':
            return 'Japanese';
        case 'en':
        case 'english':
            return 'English';
        case 'fr':
        case 'french':
            return 'French';
        default:
            return 'auto';
    }
}

function buildRequestBody({ text, voiceConfig, options }) {
    const voiceSetting = {
        voice_id: voiceConfig.voice_id,
        ...(options.voice_setting || {})
    };

    const audioSetting = {
        ...DEFAULT_AUDIO_SETTINGS,
        ...(options.audio_setting || {})
    };

    const requestBody = {
        text,
        stream: options.stream !== undefined ? options.stream : false,
        voice_setting: voiceSetting,
        audio_setting: audioSetting
    };

    if (options.output_format) {
        requestBody.output_format = options.output_format;
    } else if (!requestBody.stream) {
        requestBody.output_format = 'hex';
    }

    const languageBoost = options.language_boost || mapLanguageBoost(options.language);
    if (languageBoost) {
        requestBody.language_boost = languageBoost;
    }

    if (Array.isArray(options.timbre_weights) && options.timbre_weights.length > 0) {
        requestBody.timbre_weights = options.timbre_weights;
    }

    if (options.pronunciation_dict) {
        requestBody.pronunciation_dict = options.pronunciation_dict;
    }

    return requestBody;
}

async function generateMinimaxSpeech(text, voiceKey = DEFAULT_MINIMAX_VOICE_KEY, rawOptions = {}, fastify) {
    const apiKey = process.env.NOVITA_API_KEY;

    if (!apiKey) {
        throw new Error('NOVITA_API_KEY is not configured');
    }

    const sanitizedText = sanitizeMessage(text);
    if (!sanitizedText) {
        throw new Error('Text is required for text-to-speech generation');
    }

    const voiceConfig = getMinimaxVoiceConfig(voiceKey, fastify);
    const requestBody = buildRequestBody({
        text: sanitizedText,
        voiceConfig,
        options: rawOptions || {}
    });

    const response = await fetch(MINIMAX_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        let errorDetail = await response.text().catch(() => '');
        if (errorDetail) {
            try {
                const parsed = JSON.parse(errorDetail);
                errorDetail = parsed.message || parsed.error || errorDetail;
            } catch (error) {
                // Keep original errorDetail string when parsing fails
            }
        }
        throw new Error(`Minimax API error (${response.status}): ${errorDetail}`);
    }

    if (requestBody.stream) {
        throw new Error('Streaming mode is currently disabled for Minimax TTS requests.');
    }

    const contentType = response.headers.get('content-type') || '';
    const audioFormat = requestBody.audio_setting?.format || DEFAULT_AUDIO_SETTINGS.format;
    let audioBuffer = Buffer.alloc(0);

    if (contentType.includes('application/json')) {
        let payload;
        try {
            payload = await response.json();
        } catch (parseError) {
            throw new Error(`Unable to parse Minimax response JSON: ${parseError.message}`);
        }

        if (!payload) {
            throw new Error('Minimax API returned an empty response payload.');
        }

        if (payload.error) {
            const errMessage = payload.error.message || payload.error || 'Unknown Minimax API error';
            throw new Error(errMessage);
        }

        const audioField = payload.audio || payload.data?.audio;
        if (!audioField) {
            throw new Error('Minimax API response does not include an audio payload.');
        }

        const isUrl = /^https?:\/\//i.test(audioField);
        if (isUrl || requestBody.output_format === 'url') {
            const audioResponse = await fetch(audioField);
            if (!audioResponse.ok) {
                throw new Error(`Failed to download Minimax audio from URL (${audioResponse.status}).`);
            }
            const arrayBuffer = await audioResponse.arrayBuffer();
            audioBuffer = Buffer.from(arrayBuffer);
        } else {
            const normalizedHex = String(audioField).trim();
            try {
                audioBuffer = hexToBuffer(normalizedHex);
            } catch (decodeError) {
                throw new Error(`Failed to decode Minimax audio hex payload: ${decodeError.message}`);
            }
        }
    } else {
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer = Buffer.from(arrayBuffer);
    }

    if (!audioBuffer.length) {
        throw new Error('Minimax API did not return any audio data.');
    }

    return {
        audioBuffer,
        audioFormat
    };
}

module.exports = {
    DEFAULT_AUDIO_SETTINGS,
    sanitizeMessage,
    getMinimaxVoices,
    getMinimaxVoiceConfig,
    generateMinimaxSpeech
};
