const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const fastifyPlugin = require('fastify-plugin');
const { ObjectId } = require('mongodb');
const  { checkUserAdmin, getApiUrl } = require('../models/tool');
const ip = require('ip');
const { user } = require('@elevenlabs/elevenlabs-js/api');



module.exports = fastifyPlugin(async function (fastify, opts) {
    // Decorate Fastify with a render function that includes GTM
    fastify.decorateReply('renderWithGtm', function (template, data) {
        data = data || {};
        data.gtmId = process.env.GTM_ID;
        return this.view(template, data);
    });

    // Cache translations to avoid redundant file reads
    const translationsCache = {};
    const clerkTranslationsCache = {}; // Add cache for clerk translations
    const img2videoTranslationsCache = {}; // Add cache for img2video translations
    const mergeFaceTranslationsCache = {}; // Add cache for merge face translations
    const userPointsTranslationsCache = {}; // Add cache for user points translations
    const userAnalyticsTranslationsCache = {}; // Add cache for user analytics translations
    const affiliationTranslationsCache = {}; // Add cache for affiliation translations
    const chatToolSettingsTranslationsCache = {}; // Add cache for chat tool settings translations
    const chatSuggestionsTranslationsCache = {}; // Add cache for chat suggestions translations
    const chatScenariosTranslationsCache = {}; // Add cache for chat scenarios translations
    const onboardingTranslationsCache = {}; // Add cache for onboarding translations
    const legalTranslationsCache = {}; // Add cache for legal translations
    const speechToTextTranslationsCache = {}; // Add cache for speech-to-text translations
    const buyPointsTranslationsCache = {}; // Add cache for buy-points translations
    const chatModelTestTranslationsCache = {}; // Add cache for chat model test translations
    const coldOnboardingTranslationsCache = {}; // Add cache for cold onboarding translations
    const chatOnboardingTranslationsCache = {}; // Add cache for chat onboarding translations
    const creatorTranslationsCache = {}; // Add cache for creator translations
    
    // Decorate Fastify with user, lang, and translations functions
    fastify.decorate('getUser', getUser);
    fastify.decorate('getLang', getLang);
    fastify.decorate('getTranslations', getTranslations);
    fastify.decorate('getClerkTranslations', getClerkTranslations); // Add clerk translations decorator
    fastify.decorate('getPaymentTranslations', getPaymentTranslations); // Add payment translations decorator
    fastify.decorate('getImg2videoTranslations', getImg2videoTranslations); // Add img2video translations decorator
    fastify.decorate('getMergeFaceTranslations', getMergeFaceTranslations); // Add merge face translations decorator
    fastify.decorate('getUserPointsTranslations', getUserPointsTranslations); // Add user points translations decorator
    fastify.decorate('getUserAnalyticsTranslations', getUserAnalyticsTranslations); // Add user analytics translations decorator
    fastify.decorate('getAffiliationTranslations', getAffiliationTranslations); // Add affiliation translations decorator
    fastify.decorate('getChatToolSettingsTranslations', getChatToolSettingsTranslations); // Add chat tool settings translations decorator
    fastify.decorate('getChatSuggestionsTranslations', getChatSuggestionsTranslations); // Add chat suggestions translations decorator
    fastify.decorate('getChatScenariosTranslations', getChatScenariosTranslations); // Add chat scenarios translations decorator
    fastify.decorate('getOnboardingTranslations', getOnboardingTranslations); // Add onboarding translations decorator
    fastify.decorate('getLegalTranslations', getLegalTranslations); // Add legal translations decorator
    fastify.decorate('getSpeechToTextTranslations', getSpeechToTextTranslations); // Add speech-to-text translations decorator
    fastify.decorate('getBuyPointsTranslations', getBuyPointsTranslations); // Add buy-points translations decorator
    fastify.decorate('getChatModelTestTranslations', getChatModelTestTranslations); // Add chat model test translations decorator
    fastify.decorate('getColdOnboardingTranslations', getColdOnboardingTranslations); // Add cold onboarding translations decorator
    fastify.decorate('getChatOnboardingTranslations', getChatOnboardingTranslations); // Add chat onboarding translations decorator
    fastify.decorate('getCreatorTranslations', getCreatorTranslations); // Add creator translations decorator
    
    // Attach `lang` and `user` dynamically
    Object.defineProperty(fastify, 'lang', {
        get() {
            return fastify.request?.lang || 'en';
        }
    });

    Object.defineProperty(fastify, 'user', {
        get() {
            return fastify.request?.user || {};
        }
    });

    // Decorate request
    fastify.decorateRequest('lang', 'en'); // Default language
    fastify.decorateRequest('translations', null);
    fastify.decorateRequest('clerkTranslations', null); // Add clerk translations to request
    fastify.decorateRequest('paymentTranslations', null); // Add payment translations to request
    fastify.decorateRequest('img2videoTranslations', null); // Add img2video translations to request
    fastify.decorateRequest('mergeFaceTranslations', null); // Add merge face translations to request
    fastify.decorateRequest('userPointsTranslations', null); // Add user points translations to request
    fastify.decorateRequest('userAnalyticsTranslations', null); // Add user analytics translations to request
    fastify.decorateRequest('affiliationTranslations', null); // Add affiliation translations to request
    fastify.decorateRequest('chatToolSettingsTranslations', null); // Add chat tool settings translations to request
    fastify.decorateRequest('chatSuggestionsTranslations', null); // Add chat suggestions translations to request
    fastify.decorateRequest('chatScenariosTranslations', null); // Add chat scenarios translations to request
    fastify.decorateRequest('onboardingTranslations', null); // Add onboarding translations to request
    fastify.decorateRequest('legalTranslations', null); // Add legal translations to request
    fastify.decorateRequest('speechToTextTranslations', null); // Add speech-to-text translations to request
    fastify.decorateRequest('buyPointsTranslations', null); // Add buy-points translations to request
    fastify.decorateRequest('chatModelTestTranslations', null); // Add chat model test translations to request
    fastify.decorateRequest('coldOnboardingTranslations', null); // Add cold onboarding translations to request
    fastify.decorateRequest('chatOnboardingTranslations', null); // Add chat onboarding translations to request
    fastify.decorateRequest('creatorTranslations', null); // Add creator translations to request

    // Pre-handler to set user, lang, and translations
    fastify.addHook('preHandler', async (request, reply) => {
        const apiUrl = getApiUrl(request);

        // Load translations based on the determined language
        request.translations = getTranslations(request.lang);
        request.clerkTranslations = getClerkTranslations(request.lang); // Load clerk translations
        request.paymentTranslations = getPaymentTranslations(request.lang); // Load payment translations
        request.img2videoTranslations = getImg2videoTranslations(request.lang); // Load img2video translations
        request.mergeFaceTranslations = getMergeFaceTranslations(request.lang); // Load merge face translations
        request.userPointsTranslations = getUserPointsTranslations(request.lang); // Load user points translations
        request.userAnalyticsTranslations = getUserAnalyticsTranslations(request.lang); // Load user analytics translations
        request.affiliationTranslations = getAffiliationTranslations(request.lang); // Load affiliation translations
        request.chatToolSettingsTranslations = getChatToolSettingsTranslations(request.lang); // Load chat tool settings translations
        request.chatSuggestionsTranslations = getChatSuggestionsTranslations(request.lang); // Load chat suggestions translations
        request.chatScenariosTranslations = getChatScenariosTranslations(request.lang); // Load chat scenarios translations
        request.onboardingTranslations = getOnboardingTranslations(request.lang); // Load onboarding translations
        request.legalTranslations = getLegalTranslations(request.lang); // Load legal translations
        request.speechToTextTranslations = getSpeechToTextTranslations(request.lang); // Load speech-to-text translations
        request.buyPointsTranslations = getBuyPointsTranslations(request.lang); // Load buy-points translations
        request.chatModelTestTranslations = getChatModelTestTranslations(request.lang); // Load chat model test translations
        request.coldOnboardingTranslations = getColdOnboardingTranslations(request.lang); // Load cold onboarding translations
        request.chatOnboardingTranslations = getChatOnboardingTranslations(request.lang); // Load chat onboarding translations
        request.creatorTranslations = getCreatorTranslations(request.lang); // Load creator translations
   
        // Make translations available in Handlebars templates
        reply.locals = {
            lang: request.lang,
            translations: request.translations,
            clerkTranslations: request.clerkTranslations, // Make clerk translations available
            paymentTranslations: request.paymentTranslations, // Make payment translations available
            img2videoTranslations: request.img2videoTranslations, // Make img2video translations available
            mergeFaceTranslations: request.mergeFaceTranslations, // Make merge face translations available
            userPointsTranslations: request.userPointsTranslations, // Make user points translations available
            userAnalyticsTranslations: request.userAnalyticsTranslations, // Make user analytics translations available
            affiliationTranslations: request.affiliationTranslations, // Make affiliation translations available
            chatToolSettingsTranslations: request.chatToolSettingsTranslations, // Make chat tool settings translations available
            chatSuggestionsTranslations: request.chatSuggestionsTranslations, // Make chat suggestions translations available
            chatScenariosTranslations: request.chatScenariosTranslations, // Make chat scenarios translations available
            onboardingTranslations: request.onboardingTranslations, // Make onboarding translations available
            legalTranslations: request.legalTranslations, // Make legal translations available
            speechToTextTranslations: request.speechToTextTranslations, // Make speech-to-text translations available
            buyPointsTranslations: request.buyPointsTranslations, // Make buy-points translations available
            chatModelTestTranslations: request.chatModelTestTranslations, // Make chat model test translations available
            coldOnboardingTranslations: request.coldOnboardingTranslations, // Make cold onboarding translations available
            chatOnboardingTranslations: request.chatOnboardingTranslations, // Make chat onboarding translations available
            creatorTranslations: request.creatorTranslations, // Make creator translations available
            user: request.user, // Make user available
            isUserAdmin: request.isUserAdmin, // Make admin status available
            mode: process.env.MODE,
            apiurl: apiUrl
        };
    });

    // Hooks to handle language and user settings
    fastify.addHook('onRequest', setRequestLangAndUser);
    fastify.addHook('preHandler', setReplyLocals);

    // PreHandler to refresh user data for critical subscription-dependent routes
    fastify.addHook('preHandler', async (request, reply) => {
    // Get the current URL path without query parameters
    const currentPath = request.raw.url.split('?')[0];
    
    // Only refresh data for specific endpoints that need fresh subscription info
    const refreshRoutes = [
        '/novita/generate-img',
        '/api/generate-img',
        '/chat',
        '/chat/',
        '/api/chat/',
        '/api/openai-chat-completion',
        '/chat/edit/'
    ];
        
    // Check if the current path starts with any of the refresh routes
    const needsRefresh = refreshRoutes.some(route => currentPath === route || currentPath.startsWith(`${route}/`));

    if (needsRefresh && request.user && !request.user.isTemporary) {
        try {      
        // Get fresh user data
        const refreshedUser = await fastify.mongo.db.collection('users').findOne(
            { _id: new fastify.mongo.ObjectId(request.user._id) }
        );

        if (refreshedUser) {
            // Update the request.user with fresh data
            request.user = refreshedUser;
            
            // Also update reply.locals to ensure templates get fresh data
            if (reply.locals) {
            reply.locals.user = refreshedUser;
            }
        }
        } catch (error) {
        console.error('[PreHandler] Error refreshing user data:', error);
        }
    }
    });
    // Redirect to HTTPS in production
    fastify.addHook('onRequest', async (req, reply) => {
        if (process.env.MODE !== 'local' && req.headers['x-forwarded-proto'] !== 'https') {
          reply.redirect(`https://${req.headers['host']}${req.raw.url}`);
        }
    });

    /** Get authenticated user or create a temporary one */
    async function getUser(request, reply) {
        const userCollection = fastify.mongo.client.db(process.env.MONGODB_NAME).collection('users');
        const user = await getAuthenticatedUser(request, userCollection);
        return user || await getOrCreateTempUser(request, reply, userCollection);
    }

    /** Get language from URL parameter, cookie, or fallback to user lang */
    async function getLang(request, reply) {
        // Priority 1: Check URL parameter (for SEO-friendly language switching)
        const langParam = request.query?.lang;
        if (langParam && ['en', 'fr', 'ja', 'hi'].includes(langParam)) {
            return langParam;
        }
        
        // Priority 2: Check language cookie (set when user changes language)
        const langCookie = request.cookies?.lang;
        if (langCookie && ['en', 'fr', 'ja', 'hi'].includes(langCookie)) {
            return langCookie;
        }
        
        // Priority 3: Check subdomain (for backward compatibility during transition)
        const subdomain = request.hostname.split('.')[0];
        if (['en', 'fr', 'ja', 'hi'].includes(subdomain)) {
            return subdomain;
        }
        
        // Priority 4: Fallback to user lang if available
        if (request.user && request.user.lang) {
            return request.user.lang;
        }
        
        // Priority 5: Default to English
        return 'en';
    }

    /** Load translations for a specific language (cached for performance) */
    function getTranslations(currentLang) {
        // Ensure currentLang is a valid language code (e.g., 'en', 'ja', 'fr')
        if (!currentLang) currentLang = 'en';

        if (!translationsCache[currentLang]) {
            // Load English as base for fallback
            const englishFile = path.join(__dirname, '..', 'locales', 'en.json');
            let englishTranslations = {};
            if (fs.existsSync(englishFile)) {
                try {
                    englishTranslations = JSON.parse(fs.readFileSync(englishFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading English translations:`, e);
                }
            }

            if (currentLang === 'en') {
                translationsCache[currentLang] = englishTranslations;
            } else {
                const translationFile = path.join(__dirname, '..', 'locales', `${currentLang}.json`);
                if (fs.existsSync(translationFile)) {
                    try {
                        const langTranslations = JSON.parse(fs.readFileSync(translationFile, 'utf-8'));
                        // Merge English with the current language (current language takes precedence)
                        translationsCache[currentLang] = { ...englishTranslations, ...langTranslations };

                        // Deep merge for objects like 'seo', 'auth', etc. (one level deep)
                        for (const key in englishTranslations) {
                            if (typeof englishTranslations[key] === 'object' &&
                                englishTranslations[key] !== null &&
                                !Array.isArray(englishTranslations[key]) &&
                                langTranslations[key]) {
                                translationsCache[currentLang][key] = { ...englishTranslations[key], ...langTranslations[key] };
                            }
                        }
                    } catch (e) {
                        fastify.log.error(`Error reading translations for ${currentLang}:`, e);
                        translationsCache[currentLang] = englishTranslations;
                    }
                } else {
                    translationsCache[currentLang] = englishTranslations;
                }
            }
        }
        return translationsCache[currentLang];
    }
    
    /** Load PaymentTranslations for a specific language (cached for performance) */
    function getPaymentTranslations(currentLang) {
        const paymentTranslationsCache = {};
        if (!paymentTranslationsCache[currentLang]) {
            const translationFile = path.join(__dirname, `../locales/payment_${currentLang}.json`);
            try {
                if (fs.existsSync(translationFile)) {
                    paymentTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(translationFile, 'utf-8'));
                } else {
                    // Fallback to English if the language file doesn't exist
                    const fallbackFile = path.join(__dirname, `../locales/payment_en.json`);
                    paymentTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(fallbackFile, 'utf-8'));
                }
            } catch (error) {
                console.error(`Error loading payment translations for ${currentLang}:`, error);
                paymentTranslationsCache[currentLang] = {}; // Fallback to empty object on error
            }
        }
        return paymentTranslationsCache[currentLang];
    }
    /** Load Clerk translations for a specific language (cached for performance) */
    function getClerkTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!clerkTranslationsCache[currentLang]) {
            const clerkTranslationFile = path.join(__dirname, '..', 'locales', `clerk_${currentLang}.ts`);
            if (fs.existsSync(clerkTranslationFile)) {
                try {
                    // Use require to import the TypeScript file
                    const translationModule = require(clerkTranslationFile);
                    // Assuming the translation is the default export
                    clerkTranslationsCache[currentLang] = translationModule.default || translationModule;
                } catch (e) {
                    fastify.log.error(`Error reading Clerk translations for ${currentLang}:`, e);
                    clerkTranslationsCache[currentLang] = {};
                }
            } else {
                clerkTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return clerkTranslationsCache[currentLang];
    }

    /** Load Img2video translations for a specific language (cached for performance) */
    function getImg2videoTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!img2videoTranslationsCache[currentLang]) {
            const img2videoTranslationFile = path.join(__dirname, '..', 'locales', `img2video_${currentLang}.json`);
            if (fs.existsSync(img2videoTranslationFile)) {
                try {
                    img2videoTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(img2videoTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading img2video translations for ${currentLang}:`, e);
                    img2videoTranslationsCache[currentLang] = {};
                }
            } else {
                img2videoTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return img2videoTranslationsCache[currentLang];
    }

    /** Load MergeFace translations for a specific language (cached for performance) */
    function getMergeFaceTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!mergeFaceTranslationsCache[currentLang]) {
            const mergeFaceTranslationFile = path.join(__dirname, '..', 'locales', `merge_face_${currentLang}.json`);
            if (fs.existsSync(mergeFaceTranslationFile)) {
                try {
                    mergeFaceTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(mergeFaceTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading merge face translations for ${currentLang}:`, e);
                    mergeFaceTranslationsCache[currentLang] = {};
                }
            } else {
                mergeFaceTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return mergeFaceTranslationsCache[currentLang];
    }

    /** Load UserPointsTranslations for a specific language (cached for performance) */
    function getUserPointsTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!userPointsTranslationsCache[currentLang]) {
            const userPointsTranslationFile = path.join(__dirname, '..', 'locales', `user-points-${currentLang}.json`);
            if (fs.existsSync(userPointsTranslationFile)) {
                try {
                    userPointsTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(userPointsTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading user points translations for ${currentLang}:`, e);
                    userPointsTranslationsCache[currentLang] = {};
                }
            } else {
                userPointsTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return userPointsTranslationsCache[currentLang];
    }

    /** Load UserAnalyticsTranslations for a specific language (cached for performance) */
    function getUserAnalyticsTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!userAnalyticsTranslationsCache[currentLang]) {
            const userAnalyticsTranslationFile = path.join(__dirname, '..', 'locales', `user-analytics-${currentLang}.json`);
            if (fs.existsSync(userAnalyticsTranslationFile)) {
                try {
                    userAnalyticsTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(userAnalyticsTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading user analytics translations for ${currentLang}:`, e);
                    userAnalyticsTranslationsCache[currentLang] = {};
                }
            } else {
                userAnalyticsTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return userAnalyticsTranslationsCache[currentLang];
    }

    /** Load AffiliationTranslations for a specific language (cached for performance) */
    function getAffiliationTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!affiliationTranslationsCache[currentLang]) {
            const affiliationTranslationFile = path.join(__dirname, '..', 'locales', `affiliation_${currentLang}.json`);
            if (fs.existsSync(affiliationTranslationFile)) {
                try {
                    affiliationTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(affiliationTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading affiliation translations for ${currentLang}:`, e);
                    affiliationTranslationsCache[currentLang] = {};
                }
            } else {
                affiliationTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return affiliationTranslationsCache[currentLang];
    }

    /** Load ChatToolSettingsTranslations for a specific language (cached for performance) */
    function getChatToolSettingsTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!chatToolSettingsTranslationsCache[currentLang]) {
            const chatToolSettingsTranslationFile = path.join(__dirname, '..', 'locales', `chat-tool-settings-${currentLang}.json`);
            if (fs.existsSync(chatToolSettingsTranslationFile)) {
                try {
                    chatToolSettingsTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(chatToolSettingsTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading chat tool settings translations for ${currentLang}:`, e);
                    chatToolSettingsTranslationsCache[currentLang] = {};
                }
            } else {
                chatToolSettingsTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return chatToolSettingsTranslationsCache[currentLang];
    }

    /** Load ChatSuggestionsTranslations for a specific language (cached for performance) */
    function getChatSuggestionsTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!chatSuggestionsTranslationsCache[currentLang]) {
            const chatSuggestionsTranslationFile = path.join(__dirname, '..', 'locales', `chat-suggestions-${currentLang}.json`);
            if (fs.existsSync(chatSuggestionsTranslationFile)) {
                try {
                    chatSuggestionsTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(chatSuggestionsTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading chat suggestions translations for ${currentLang}:`, e);
                    chatSuggestionsTranslationsCache[currentLang] = {};
                }
            } else {
                chatSuggestionsTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return chatSuggestionsTranslationsCache[currentLang];
    }

    /** Load ChatScenariosTranslations for a specific language (cached for performance) */
    function getChatScenariosTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!chatScenariosTranslationsCache[currentLang]) {
            const chatScenariosTranslationFile = path.join(__dirname, '..', 'locales', `chat-scenarios-${currentLang}.json`);
            if (fs.existsSync(chatScenariosTranslationFile)) {
                try {
                    chatScenariosTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(chatScenariosTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading chat scenarios translations for ${currentLang}:`, e);
                    chatScenariosTranslationsCache[currentLang] = {};
                }
            } else {
                chatScenariosTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return chatScenariosTranslationsCache[currentLang];
    }

    /** Load OnboardingTranslations for a specific language (cached for performance) */
    function getOnboardingTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!onboardingTranslationsCache[currentLang]) {
            const onboardingTranslationFile = path.join(__dirname, '..', 'locales', `onboarding-${currentLang}.json`);
            if (fs.existsSync(onboardingTranslationFile)) {
                try {
                    onboardingTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(onboardingTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading onboarding translations for ${currentLang}:`, e);
                    onboardingTranslationsCache[currentLang] = {};
                }
            } else {
                onboardingTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return onboardingTranslationsCache[currentLang];
    }

    /** Load LegalTranslations for a specific language (cached for performance) */
    function getLegalTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!legalTranslationsCache[currentLang]) {
            const legalTranslationFile = path.join(__dirname, '..', 'locales', `legal-${currentLang}.json`);
            if (fs.existsSync(legalTranslationFile)) {
                try {
                    legalTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(legalTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading legal translations for ${currentLang}:`, e);
                    legalTranslationsCache[currentLang] = {};
                }
            } else {
                legalTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return legalTranslationsCache[currentLang];
    }

    /** Load SpeechToTextTranslations for a specific language (cached for performance) */
    function getSpeechToTextTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!speechToTextTranslationsCache[currentLang]) {
            const speechToTextTranslationFile = path.join(__dirname, '..', 'locales', `speech-to-text-${currentLang}.json`);
            if (fs.existsSync(speechToTextTranslationFile)) {
                try {
                    speechToTextTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(speechToTextTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading speech-to-text translations for ${currentLang}:`, e);
                    speechToTextTranslationsCache[currentLang] = {};
                }
            } else {
                speechToTextTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return speechToTextTranslationsCache[currentLang];
    }

    /** Middleware: Set request language and user */
    async function setRequestLangAndUser(request, reply) {
        request.user = await fastify.getUser(request, reply);
        request.lang = request.user.lang || await fastify.getLang(request, reply);
        request.translations = fastify.getTranslations(request.lang);
        request.clerkTranslations = fastify.getClerkTranslations(request.lang);
        request.paymentTranslations = fastify.getPaymentTranslations(request.lang);
        request.img2videoTranslations = fastify.getImg2videoTranslations(request.lang);
        request.mergeFaceTranslations = fastify.getMergeFaceTranslations(request.lang);
        request.userPointsTranslations = fastify.getUserPointsTranslations(request.lang);
        request.userAnalyticsTranslations = fastify.getUserAnalyticsTranslations(request.lang);
        request.affiliationTranslations = fastify.getAffiliationTranslations(request.lang);
        request.chatToolSettingsTranslations = fastify.getChatToolSettingsTranslations(request.lang);
        request.chatSuggestionsTranslations = fastify.getChatSuggestionsTranslations(request.lang);
        request.chatScenariosTranslations = fastify.getChatScenariosTranslations(request.lang);
        request.onboardingTranslations = fastify.getOnboardingTranslations(request.lang);
        request.legalTranslations = fastify.getLegalTranslations(request.lang);
        request.speechToTextTranslations = fastify.getSpeechToTextTranslations(request.lang);
        request.isAdmin = await checkUserAdmin(fastify, request.user._id) || false;

        // Add onboarding status check
        if (request.user && !request.user.isTemporary) {
            // Check if user should see onboarding
            request.user.firstTime = request.user.onboardingCompleted !== true;
        }
    }

    /** Middleware: Set reply.locals */
    async function setReplyLocals(request, reply) {
        const apiUrl = getApiUrl(request);
        
        reply.locals = {
            mode: process.env.MODE,
            apiurl: apiUrl,
            translations: request.translations,
            clerkTranslations: request.clerkTranslations, // Add clerk translations to locals
            paymentTranslations: request.paymentTranslations, // Add payment translations to locals
            img2videoTranslations: request.img2videoTranslations, // Add img2video translations to locals
            mergeFaceTranslations: request.mergeFaceTranslations, // Add merge face translations to locals
            userPointsTranslations: request.userPointsTranslations, // Add user points translations to locals
            userAnalyticsTranslations: request.userAnalyticsTranslations, // Add user analytics translations to locals
            affiliationTranslations: request.affiliationTranslations, // Add affiliation translations to locals
            chatToolSettingsTranslations: request.chatToolSettingsTranslations, // Add chat tool settings translations to locals
            chatSuggestionsTranslations: request.chatSuggestionsTranslations, // Add chat suggestions translations to locals
            chatScenariosTranslations: request.chatScenariosTranslations, // Add chat scenarios translations to locals
            onboardingTranslations: request.onboardingTranslations, // Add onboarding translations to locals
            legalTranslations: request.legalTranslations, // Add legal translations to locals
            speechToTextTranslations: request.speechToTextTranslations, // Add speech-to-text translations to locals
            buyPointsTranslations: request.buyPointsTranslations, // Add buy-points translations to locals
            chatModelTestTranslations: request.chatModelTestTranslations, // Add chat model test translations to locals
            coldOnboardingTranslations: request.coldOnboardingTranslations, // Add cold onboarding translations to locals
            chatOnboardingTranslations: request.chatOnboardingTranslations, // Add chat onboarding translations to locals
            creatorTranslations: request.creatorTranslations, // Add creator translations to locals
            lang: request.lang,
            user: request.user,
            isAdmin: request.isAdmin
        };
    }

    /** Authenticate user via JWT */
    async function getAuthenticatedUser(request, userCollection) {
        const token = request?.cookies?.token;

        if (!token) {
            return null;
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded && decoded._id) {
                return await userCollection.findOne({ _id: new fastify.mongo.ObjectId(decoded._id) });
            }
        } catch (err) {
            fastify.log.error('JWT verification failed:', err);
            return null;
        }
        return null;
    }

    /** Create or retrieve a temporary user */
    async function getOrCreateTempUser(request, reply, userCollection) {
        // Skip temporary user creation for static resources
        const path = request.raw.url;
        if (path.match(/\.(png|jpg|jpeg|gif|webp|ico|css|js|svg|woff|woff2|ttf|eot|map)(\?.*)?$/i)) {
            // Return a minimal anonymous user for static resources without setting cookies
           return true;
        }
        const mode = process.env.MODE || 'local';
        let tempUser = request?.cookies?.tempUser;
        if (!tempUser) {

            const lang = await fastify.getLang(request, reply);
            const tempUserId = new ObjectId().toString();

            tempUser = {
                _id: tempUserId,
                isTemporary: true,
                role: 'guest',
                lang,
                createdAt: new Date(),
                session: getSessionIdentifier(request)
            };

            reply.setCookie('tempUser', JSON.stringify(tempUser), {
                path: '/',
                httpOnly: true,
                maxAge: 60 * 60 * 24,
                sameSite: mode === 'heroku' ? 'None' : 'Lax',
                secure: mode === 'heroku'
            });
        } else {
            tempUser = JSON.parse(tempUser);
        }

        return tempUser;
    }

    /** Generate session identifier */
    function getSessionIdentifier(request) {
        const ip = request.ip;
        const userAgent = request.headers['user-agent'] || 'unknown';
        return `${ip}-${userAgent}`;
    }

    /** Load BuyPointsTranslations for a specific language (cached for performance) */
    function getBuyPointsTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!buyPointsTranslationsCache[currentLang]) {
            const buyPointsTranslationFile = path.join(__dirname, '..', 'locales', `buy-points-${currentLang}.json`);
            if (fs.existsSync(buyPointsTranslationFile)) {
                try {
                    buyPointsTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(buyPointsTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading buy-points translations for ${currentLang}:`, e);
                    buyPointsTranslationsCache[currentLang] = {};
                }
            } else {
                buyPointsTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return buyPointsTranslationsCache[currentLang];
    }

    /** Load ChatModelTest translations for a specific language (cached for performance) */
    function getChatModelTestTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!chatModelTestTranslationsCache[currentLang]) {
            const chatModelTestTranslationFile = path.join(__dirname, '..', 'locales', `chat-model-test-${currentLang}.json`);
            if (fs.existsSync(chatModelTestTranslationFile)) {
                try {
                    chatModelTestTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(chatModelTestTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading chat model test translations for ${currentLang}:`, e);
                    chatModelTestTranslationsCache[currentLang] = {};
                }
            } else {
                chatModelTestTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return chatModelTestTranslationsCache[currentLang];
    }

    /** Load ColdOnboardingTranslations for a specific language (cached for performance) */
    function getColdOnboardingTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!coldOnboardingTranslationsCache[currentLang]) {
            const coldOnboardingTranslationFile = path.join(__dirname, '..', 'locales', `cold-onboarding-${currentLang}.json`);
            if (fs.existsSync(coldOnboardingTranslationFile)) {
                try {
                    coldOnboardingTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(coldOnboardingTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading cold onboarding translations for ${currentLang}:`, e);
                    coldOnboardingTranslationsCache[currentLang] = {};
                }
            } else {
                coldOnboardingTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return coldOnboardingTranslationsCache[currentLang];
    }

    /** Load ChatOnboardingTranslations for a specific language (cached for performance) */
    function getChatOnboardingTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!chatOnboardingTranslationsCache[currentLang]) {
            const chatOnboardingTranslationFile = path.join(__dirname, '..', 'locales', `chat-onboarding-${currentLang}.json`);
            if (fs.existsSync(chatOnboardingTranslationFile)) {
                try {
                    chatOnboardingTranslationsCache[currentLang] = JSON.parse(fs.readFileSync(chatOnboardingTranslationFile, 'utf-8'));
                } catch (e) {
                    fastify.log.error(`Error reading chat onboarding translations for ${currentLang}:`, e);
                    chatOnboardingTranslationsCache[currentLang] = {};
                }
            } else {
                chatOnboardingTranslationsCache[currentLang] = {}; // Fallback to empty object if translation file is missing
            }
        }
        return chatOnboardingTranslationsCache[currentLang];
    }

    /** Load CreatorTranslations for a specific language (from main locale file) */
    function getCreatorTranslations(currentLang) {
        if (!currentLang) currentLang = 'en';
        
        if (!creatorTranslationsCache[currentLang]) {
            // Creator translations are stored in the main locale files under the "creators" key
            const translations = getTranslations(currentLang);
            creatorTranslationsCache[currentLang] = translations.creators || {};
        }
        return creatorTranslationsCache[currentLang];
    }
});