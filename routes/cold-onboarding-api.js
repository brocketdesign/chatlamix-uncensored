/**
 * Cold Onboarding API Routes
 * Handles API endpoints for cold user onboarding flow
 */

const { ObjectId } = require('mongodb');
const { generateCompletion } = require('../models/openai');

// Name generation prompts by ethnicity
const NAME_PROMPTS = {
    caucasian: 'Generate a single feminine Western/European name that sounds attractive and modern. Just the name, nothing else.',
    asian: 'Generate a single feminine East Asian name (Chinese, Vietnamese, Thai) that sounds elegant. Just the name, nothing else.',
    black: 'Generate a single feminine African or African-American name that sounds beautiful. Just the name, nothing else.',
    latina: 'Generate a single feminine Latin/Hispanic name that sounds passionate. Just the name, nothing else.',
    arab: 'Generate a single feminine Arabic/Middle Eastern name that sounds elegant. Just the name, nothing else.',
    indian: 'Generate a single feminine Indian name that sounds beautiful. Just the name, nothing else.',
    japanese: 'Generate a single feminine Japanese name that sounds cute and modern. Just the name, nothing else.',
    korean: 'Generate a single feminine Korean name that sounds sweet and modern. Just the name, nothing else.',
    mixed: 'Generate a single unique feminine name that could be from any culture, sounding modern and attractive. Just the name, nothing else.'
};

// Fallback names by ethnicity
const FALLBACK_NAMES = {
    caucasian: ['Emma', 'Sophie', 'Olivia', 'Isabella', 'Mia', 'Charlotte', 'Ava', 'Luna'],
    asian: ['Mei', 'Lin', 'Ying', 'Xia', 'An', 'Linh', 'Mai', 'Hua'],
    black: ['Aisha', 'Imani', 'Zara', 'Amara', 'Nia', 'Kaya', 'Zuri', 'Amani'],
    latina: ['Maria', 'Sofia', 'Isabella', 'Camila', 'Valentina', 'Luna', 'Victoria', 'Elena'],
    arab: ['Fatima', 'Leila', 'Yasmin', 'Amira', 'Nadia', 'Layla', 'Sara', 'Hana'],
    indian: ['Priya', 'Ananya', 'Aisha', 'Maya', 'Sana', 'Diya', 'Ishita', 'Kavya'],
    japanese: ['Yuki', 'Sakura', 'Hana', 'Mika', 'Rin', 'Aoi', 'Mei', 'Yui'],
    korean: ['Ji-yeon', 'Min-ji', 'Soo-yeon', 'Hae-won', 'Yuna', 'Da-hee', 'Seo-yeon', 'Ha-na'],
    mixed: ['Aria', 'Nova', 'Zara', 'Maya', 'Luna', 'Kira', 'Naia', 'Leia']
};

/**
 * Build character prompt from cold onboarding data
 */
function buildCharacterPrompt(data) {
    const {
        style, gender, ethnicity, age, hairStyle, hairColor,
        bodyType, breastSize, buttSize, name, personality,
        relationship, occupation, kinks, voice
    } = data;
    
    // Build physical description
    const physical = [
        `${age} year old ${ethnicity} ${gender}`,
        `${hairColor} ${hairStyle} hair`,
        `${bodyType} body type`,
        gender === 'female' && breastSize ? `${breastSize} breasts` : null,
        buttSize ? `${buttSize} butt` : null
    ].filter(Boolean).join(', ');
    
    // Build personality description
    const personalityDesc = [
        personality,
        occupation ? `works as a ${occupation}` : null
    ].filter(Boolean).join(', ');
    
    return {
        prompt: `${physical}. Personality: ${personalityDesc}`,
        details: {
            appearance: {
                age: age.toString(),
                gender: gender,
                ethnicity: ethnicity,
                bodyType: bodyType
            },
            face: {
                skinColor: ethnicity,
                eyeColor: 'default',
                eyeShape: 'default'
            },
            hair: {
                hairColor: hairColor,
                hairStyle: hairStyle
            },
            body: {
                breastSize: breastSize,
                assSize: buttSize,
                bodyCurves: bodyType === 'curvy' || bodyType === 'voluptuous' ? 'pronounced' : 'subtle'
            },
            personality: {
                personality: personality,
                occupation: occupation,
                relationship: relationship,
                kinks: kinks
            },
            voice: {
                voiceKey: voice,
                provider: 'minimax'
            }
        }
    };
}

async function routes(fastify) {
    
    /**
     * Generate a character name based on ethnicity
     * POST /api/cold-onboarding/generate-name
     */
    fastify.post('/api/cold-onboarding/generate-name', async (request, reply) => {
        try {
            const { ethnicity = 'caucasian', gender = 'female', language = 'en' } = request.body;
            
            const prompt = NAME_PROMPTS[ethnicity] || NAME_PROMPTS.caucasian;
            
            try {
                const messages = [
                    { role: 'system', content: 'You are a name generator. Respond with only the name, no punctuation or explanation.' },
                    { role: 'user', content: prompt }
                ];
                
                const name = await generateCompletion(messages, 20, 'gpt-4o-mini');
                
                // Clean up the name
                const cleanName = name.trim().replace(/['".,!?]/g, '').split(' ')[0];
                
                return reply.send({ success: true, name: cleanName });
            } catch (error) {
                console.error('[cold-onboarding] Name generation error:', error);
                // Use fallback
                const names = FALLBACK_NAMES[ethnicity] || FALLBACK_NAMES.caucasian;
                const randomName = names[Math.floor(Math.random() * names.length)];
                return reply.send({ success: true, name: randomName });
            }
        } catch (error) {
            console.error('[cold-onboarding] Generate name error:', error);
            return reply.status(500).send({ error: 'Failed to generate name' });
        }
    });
    
    /**
     * Create a character after registration
     * POST /api/cold-onboarding/create-character
     */
    fastify.post('/api/cold-onboarding/create-character', async (request, reply) => {
        try {
            const { characterData, language = 'en' } = request.body;
            const { user, translations } = request;
            
            if (!user || user.isTemporary) {
                return reply.status(401).send({ error: 'Authentication required' });
            }
            
            const db = fastify.mongo.db;
            const userId = new ObjectId(user._id);
            
            // Build the character data
            const { prompt, details } = buildCharacterPrompt(characterData);
            
            // Generate character using existing character creation logic
            const characterPayload = {
                name: characterData.name,
                gender: characterData.gender,
                purpose: `${characterData.relationship} - ${characterData.personality}`,
                characterPrompt: prompt,
                details: details,
                imageType: characterData.style === 'anime' ? 'anime' : 'photorealistic',
                nsfw: false // Default to SFW for cold users
            };
            
            // Create system prompt and other details using AI
            const systemMessages = [
                {
                    role: 'system',
                    content: `You are creating an AI companion character. Generate a compelling character based on the provided details. Respond in ${language}.`
                },
                {
                    role: 'user',
                    content: `Create a character with these details:
                    Name: ${characterData.name}
                    Gender: ${characterData.gender}
                    Age: ${characterData.age}
                    Ethnicity: ${characterData.ethnicity}
                    Personality: ${characterData.personality}
                    Occupation: ${characterData.occupation}
                    Relationship to user: ${characterData.relationship}
                    
                    Generate:
                    1. A short intro (1 sentence)
                    2. A system prompt starting with "I want you to act as..."
                    3. A first message from the character
                    4. 5 relevant tags
                    
                    Format as JSON with keys: short_intro, system_prompt, first_message, tags`
                }
            ];
            
            let generatedContent;
            try {
                const completion = await generateCompletion(systemMessages, 800, 'gpt-4o-mini');
                generatedContent = JSON.parse(completion);
            } catch (error) {
                console.error('[cold-onboarding] AI generation error:', error);
                // Use defaults
                generatedContent = {
                    short_intro: `${characterData.name} is your ${characterData.relationship} with a ${characterData.personality} personality.`,
                    system_prompt: `I want you to act as ${characterData.name}, a ${characterData.age} year old ${characterData.gender} who is ${characterData.personality}. I am your ${characterData.relationship}.`,
                    first_message: `*${characterData.name} looks at you with a warm smile* Hey there! I'm so glad to meet you.`,
                    tags: [characterData.personality, characterData.occupation, characterData.relationship, 'companion', 'chat']
                };
            }
            
            // Set default model based on style
            const isAnime = characterData.style === 'anime';
            const defaultImageModel = isAnime 
                ? 'prefectPonyXL_v50_1128833.safetensors'
                : 'juggernautXL_v9Rdphoto2Lightning_285361.safetensors';
            const imageStyle = isAnime ? 'anime' : 'photorealistic';
            
            // Create the chat document
            const chatDoc = {
                userId: userId,
                name: characterData.name,
                short_intro: generatedContent.short_intro,
                systemPrompt: generatedContent.system_prompt,
                firstMessage: generatedContent.first_message,
                tags: generatedContent.tags,
                characterPrompt: prompt,
                details: details,
                gender: characterData.gender,
                purpose: `${characterData.relationship} - ${characterData.personality}`,
                imageStyle: imageStyle,
                imageModel: defaultImageModel,
                imageVersion: 'sdxl',
                nsfw: false,
                isPublic: false,
                isTemporary: false,
                source: 'cold-onboarding',
                voiceSettings: {
                    provider: 'minimax',
                    voice: characterData.voice
                },
                createdAt: new Date(),
                updatedAt: new Date()
            };
            
            // Insert the chat
            const result = await db.collection('chats').insertOne(chatDoc);
            const chatId = result.insertedId.toString();
            
            // Trigger image generation in background (non-blocking)
            fastify.inject({
                method: 'POST',
                url: '/novita/generate-img',
                payload: {
                    chatId: chatId,
                    prompt: prompt,
                    gender: characterData.gender,
                    imageType: characterData.style === 'anime' ? 'anime' : 'photorealistic',
                    nsfw: false
                }
            }).catch(err => console.error('[cold-onboarding] Image generation error:', err));
            
            // Update user's firstTime flag if needed
            await db.collection('users').updateOne(
                { _id: userId },
                { 
                    $set: { 
                        firstTime: false,
                        onboardingCompleted: true,
                        onboardingSource: 'cold-onboarding'
                    }
                }
            );
            
            return reply.send({
                success: true,
                chatId: chatId,
                message: 'Character created successfully'
            });
            
        } catch (error) {
            console.error('[cold-onboarding] Create character error:', error);
            return reply.status(500).send({ error: 'Failed to create character' });
        }
    });
    
    /**
     * Get voice samples manifest
     * GET /api/cold-onboarding/voice-samples
     */
    fastify.get('/api/cold-onboarding/voice-samples', async (request, reply) => {
        try {
            const fs = require('fs').promises;
            const path = require('path');
            
            const manifestPath = path.join(process.cwd(), 'public', 'audio', 'voice-samples', 'manifest.json');
            
            try {
                const manifest = await fs.readFile(manifestPath, 'utf8');
                return reply.send(JSON.parse(manifest));
            } catch (error) {
                // Return fallback data if manifest doesn't exist
                return reply.send({
                    generated: null,
                    voices: [
                        { key: 'Wise_Woman', gender: 'female', languages: ['en', 'fr', 'ja', 'hi'] },
                        { key: 'Friendly_Person', gender: 'female', languages: ['en', 'fr', 'ja', 'hi'] },
                        { key: 'Inspirational_girl', gender: 'female', languages: ['en', 'fr', 'ja', 'hi'] },
                        { key: 'Calm_Woman', gender: 'female', languages: ['en', 'fr', 'ja', 'hi'] },
                        { key: 'Lively_Girl', gender: 'female', languages: ['en', 'fr', 'ja', 'hi'] },
                        { key: 'Lovely_Girl', gender: 'female', languages: ['en', 'fr', 'ja', 'hi'] },
                        { key: 'Abbess', gender: 'female', languages: ['en', 'fr', 'ja', 'hi'] },
                        { key: 'Sweet_Girl_2', gender: 'female', languages: ['en', 'fr', 'ja', 'hi'] },
                        { key: 'Exuberant_Girl', gender: 'female', languages: ['en', 'fr', 'ja', 'hi'] }
                    ],
                    files: []
                });
            }
        } catch (error) {
            console.error('[cold-onboarding] Voice samples error:', error);
            return reply.status(500).send({ error: 'Failed to get voice samples' });
        }
    });
    
    /**
     * Save cold onboarding progress (for users who leave mid-flow)
     * POST /api/cold-onboarding/save-progress
     */
    fastify.post('/api/cold-onboarding/save-progress', async (request, reply) => {
        try {
            const { characterData, currentStep, sessionId } = request.body;
            
            const db = fastify.mongo.db;
            
            // Store in a temporary collection
            await db.collection('coldOnboardingProgress').updateOne(
                { sessionId: sessionId },
                {
                    $set: {
                        characterData: characterData,
                        currentStep: currentStep,
                        updatedAt: new Date()
                    },
                    $setOnInsert: {
                        createdAt: new Date()
                    }
                },
                { upsert: true }
            );
            
            return reply.send({ success: true });
        } catch (error) {
            console.error('[cold-onboarding] Save progress error:', error);
            return reply.status(500).send({ error: 'Failed to save progress' });
        }
    });
    
    /**
     * Load cold onboarding progress
     * GET /api/cold-onboarding/load-progress/:sessionId
     */
    fastify.get('/api/cold-onboarding/load-progress/:sessionId', async (request, reply) => {
        try {
            const { sessionId } = request.params;
            
            const db = fastify.mongo.db;
            
            const progress = await db.collection('coldOnboardingProgress').findOne({ sessionId });
            
            if (progress) {
                return reply.send({
                    success: true,
                    characterData: progress.characterData,
                    currentStep: progress.currentStep
                });
            } else {
                return reply.send({ success: false, message: 'No progress found' });
            }
        } catch (error) {
            console.error('[cold-onboarding] Load progress error:', error);
            return reply.status(500).send({ error: 'Failed to load progress' });
        }
    });
}

module.exports = routes;
