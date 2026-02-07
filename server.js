const fastify = require('fastify')({ logger: false });
require('dotenv').config();
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const ip = require('ip');
const handlebars = require('handlebars');
const fastifyMultipart = require('@fastify/multipart');
const { generatePromptTitle } = require('./models/openai');
const {
  cleanupNonRegisteredUsers,
  deleteTemporaryChats,
} = require('./models/databasemanagement');
const { checkUserAdmin, getUserData, updateCounter, fetchTags, generateSeoMetadata } = require('./models/tool');
const { deleteOldTasks } = require('./models/imagen');
const { buildImageModelsList } = require('./models/admin-image-test-utils');
const { 
  cronJobs, 
  configureCronJob, 
  initializeCronJobs, 
  initializeDayPassExpirationCheck } = require('./models/cronManager');
// Expose cron jobs and configuration to routes
fastify.decorate('cronJobs', cronJobs);
fastify.decorate('configureCronJob', configureCronJob);

fastify.register(require('@fastify/mongodb'), {
  forceClose: true,
  url: process.env.MONGODB_URI,
  database: process.env.MONGODB_NAME,
}, (err) => {
  if (err) {
    console.log('Failed to connect to database:', err);
    process.exit(1); // Exit the process if the database connection fails
  }
});

fastify.register(require('@fastify/cookie'), {
  secret: process.env.JWT_SECRET,
  parseOptions: {},
});


// Wait for the database connection to be established 
fastify.ready(async () => { 
  const awsimages = fastify.mongo.db.collection('awsimages');
  awsimages.deleteMany({}, function(err, obj) {
    if (err) throw err;
    if(obj?.result){
      console.log(obj.result.n + " document(s) deleted");
    }
  });
  
  // Create indexes for better performance on slug queries
  try {
    const chatsCollection = fastify.mongo.db.collection('chats');
    const galleryCollection = fastify.mongo.db.collection('gallery');
    const scenarioTranslationsCollection = fastify.mongo.db.collection('scenarioTranslations');
    
    // Index on slug field for fast character lookups
    await chatsCollection.createIndex({ slug: 1 }, { unique: true, sparse: true }).catch(() => {
      // Index might already exist, ignore error
      console.log('[Database] Slug index may already exist on chats collection');
    });
    
    // Index on images.slug for fast image lookups
    await galleryCollection.createIndex({ 'images.slug': 1 }, { sparse: true }).catch(() => {
      // Index might already exist, ignore error
      console.log('[Database] Slug index may already exist on gallery.images collection');
    });
    
    // Compound index for chat lookup with slug
    await chatsCollection.createIndex({ slug: 1, chatImageUrl: 1 }, { sparse: true }).catch(() => {
      console.log('[Database] Compound slug index may already exist on chats collection');
    });
    
    // Compound index for scenario translations cache (unique scenarioId + language)
    await scenarioTranslationsCollection.createIndex({ scenarioId: 1, language: 1 }, { unique: true }).catch(() => {
      console.log('[Database] Compound index may already exist on scenarioTranslations collection');
    });
    
    console.log('[Database] Slug indexes initialized');
  } catch (err) {
    console.error('[Database] Error creating slug indexes:', err);
  }
  
  // Initialize configured cron jobs
  initializeCronJobs(fastify);

  // Initialize day pass expiration check cron job
  // Import checkExpiredDayPasses from plan.js routes
  const planRoutes = require('./routes/plan');
  initializeDayPassExpirationCheck(fastify, planRoutes.checkExpiredDayPasses);

});

// Every 3 cron jobs for cleanup and maintenance
cron.schedule('0 0 * * *', async () => {
  const db = fastify.mongo.db; // Access the database object after plugin registration
  try {
    // Check if the database is accessible
    await db.command({ ping: 1 });
    console.log('Database connection is healthy.');

    // Call your cleanup and update functions
    cleanupNonRegisteredUsers(db);
    deleteTemporaryChats(db);
    deleteOldTasks(db);
    updateCounter(db, 0);

  } catch (err) {
    console.log('Failed to execute cron tasks or access database:', err);
  }
});

fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/',
});

// Create partials for Handlebars
const partials = [
  'dashboard-header',
  'dashboard-nav',
  'dashboard-footer',
  'dashboard-avatar',
  'chat-header',
  'chat-footer',
  'chat-list',
  'dashboard-modals',
  'translations',
  'footer-toolbar',
  'onboarding-modals'
];

partials.forEach(partial => {
  const partialPath = path.join(__dirname, 'views', 'partials', `${partial}.hbs`);
  const partialContent = fs.readFileSync(partialPath, 'utf8');
  handlebars.registerPartial(partial, partialContent);
});

fastify.register(require('@fastify/view'), {
  engine: { handlebars: require('handlebars') },
  root: path.join(__dirname, 'views'),
});

const registerHelpers = require('./plugins/handlebars-helpers');
fastify.after(() => {
  registerHelpers();
});

fastify.register(require('@fastify/cors'), {
  origin: (origin, cb) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return cb(null, true);
    // In local development, you might want to allow your specific local frontend origin
    // For production, you'd list your allowed frontend domains
    const allowedOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      `http://${ip.address()}:3000`,
      'https://app.chatlamix.com',
      'https://chat.lamixapp.com',
      'https://chatlamix.com',
      'https://en.chatlamix.com',
      'https://fr.chatlamix.com',
      'https://ja.chatlamix.com',
      'https://jp.chatlamix.com',
      'https://www.chatlamix.com'
    ];
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.MODE === 'local') {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'), false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
});
fastify.register(fastifyMultipart, {
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB to match OpenAI Whisper API limit
  },
});

const slugify = require('slugify');
const { generateUniqueSlug, generateImageSlug } = require('./models/slug-utils');
fastify.register(require('fastify-sse'));
fastify.register(require('@fastify/formbody'));

// Register WebSocket plugin BEFORE loading other plugins that depend on it
const websocketPlugin = require('@fastify/websocket');
fastify.register(websocketPlugin);
fastify.register(require('./plugins/websocket')); // Add this line

// Load global plugins
const fastifyPluginGlobals = require('./plugins/globals');
const { title } = require('process');
fastify.register(fastifyPluginGlobals);

// Register all routes from the routes plugin
fastify.register(require('./plugins/routes'));

// SEO: Redirect www and language subdomains to app.chatlamix.com for domain consolidation
fastify.addHook('onRequest', (request, reply, done) => {
  const host = request.hostname;
  const isLocalHost = host.includes('localhost') || host.includes('127.0.0.1') || host.includes('0.0.0.0');
  
  // Skip redirects for localhost
  if (isLocalHost) {
    return done();
  }
  
  // Redirect www to app
  if (host === 'www.chatlamix.com') {
    const newUrl = `https://app.chatlamix.com${request.raw.url}`;
    console.log(`[SEO] Redirecting www to app: ${host} → app.chatlamix.com`);
    return reply.code(301).redirect(newUrl);
  }
  
  // Redirect language subdomains (fr, en, ja, hi) to app.chatlamix.com with ?lang= parameter
  const subdomain = host.split('.')[0];
  if (['en', 'fr', 'ja', 'hi'].includes(subdomain)) {
    const baseDomain = host.split('.').slice(-2).join('.'); // Get chatlamix.com
    if (baseDomain === 'chatlamix.com') {
      const currentUrl = request.raw.url;
      const urlObj = new URL(currentUrl, `https://${host}`);
      // Preserve existing query parameters and add lang parameter
      urlObj.searchParams.set('lang', subdomain);
      const newUrl = `https://app.chatlamix.com${urlObj.pathname}${urlObj.search}`;
      console.log(`[SEO] Redirecting language subdomain to app: ${host} → app.chatlamix.com?lang=${subdomain}`);
      return reply.code(301).redirect(newUrl);
    }
  }
  
  done();
});

// Landing page route (previously the index page)
fastify.get('/landing', async (request, reply) => {
  const db = fastify.mongo.db;
  let { translations, lang, user } = request;
  const userId = user._id;
  if (userId && !user.isTemporary) {
    user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });
  }

  let bannerNumber = parseInt(request.query.banner) || 0;
  bannerNumber = Math.min(bannerNumber, 3);
  const seoMetadata = generateSeoMetadata(request, '/landing', lang);
  return reply.renderWithGtm(`index.hbs`, {
    title: translations.seo.title,
    canonicalUrl: seoMetadata.canonicalUrl,
    alternates: seoMetadata.alternates,
    seo: [
      { name: 'description', content: translations.seo.description },
      { name: 'keywords', content: translations.seo.keywords },
      { property: 'og:title', content: translations.seo.title },
      { property: 'og:description', content: translations.seo.description },
      { property: 'og:image', content: '/img/share.png' },
      { property: 'og:url', content: seoMetadata.canonicalUrl },
      { property: 'og:locale', content: lang },
      { property: 'og:locale:alternate', content: 'en' },
      { property: 'og:locale:alternate', content: 'fr' },
      { property: 'og:locale:alternate', content: 'ja' },
    ],
    bannerNumber
  });
});

// Top page now redirects to dashboard
fastify.get('/', async (request, reply) => {
  // Check for any special query params that need to be preserved
  const queryParams = new URLSearchParams();
  
  if (request.query.signIn === 'true') {
    queryParams.set('signIn', 'true');
  }
  if (request.query.signOut === 'true') {
    queryParams.set('signOut', 'true');
  }
  if (request.query.newSubscription) {
    queryParams.set('newSubscription', request.query.newSubscription);
  }
  
  const queryString = queryParams.toString();
  const redirectUrl = queryString ? `/dashboard?${queryString}` : '/dashboard';
  
  return reply.redirect(redirectUrl);
});

fastify.get('/signin-redirection', async (request, reply) => {
  const db = fastify.mongo.db;
  let { translations, lang, user } = request;
  const userId = user._id;
  user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });

  return reply.renderWithGtm(`signin.hbs`, {
    title: 'Sign In - AI Image Generation | ChatLamix',
    signingInTitle: translations.auth?.signingIn || 'Signing In...',
    redirectingMessage: translations.auth?.redirectingMessage || 'Please wait while we redirect you',
  });
});

fastify.get('/signout-redirection', async (request, reply) => {
  console.log('signout-redirection')
  const db = fastify.mongo.db;
  let { translations, lang, user } = request;
  const userId = user._id;
  user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });

  return reply.renderWithGtm(`signout.hbs`, {
    title: 'Sign Out - AI Image Generation | ChatLamix',
    signingOutTitle: translations.auth?.signingOut || 'Signing Out...',
    seeYouSoon: translations.auth?.seeYouSoon || 'See you soon! Taking you back...',
  });
});

// Cold onboarding - character creation for new users from ads/SNS
fastify.get('/create-character', async (request, reply) => {
  let { coldOnboardingTranslations, clerkTranslations, translations, lang, user } = request;
  
  // If user is already logged in and has completed onboarding, redirect to chat
  if (user && !user.isTemporary && user.onboardingCompleted) {
    return reply.redirect('/chat');
  }
  
  return reply.renderWithGtm(`cold-onboarding.hbs`, {
    title: coldOnboardingTranslations.meta?.title || 'Create Your AI Character | ChatLamix',
    seo: [
      { name: 'description', content: coldOnboardingTranslations.meta?.description || 'Create your perfect AI companion with custom style, personality, and voice.' },
      { name: 'keywords', content: coldOnboardingTranslations.meta?.keywords || 'AI character, AI companion, custom AI, chatbot, AI girlfriend, AI boyfriend' },
      { property: 'og:title', content: coldOnboardingTranslations.meta?.title || 'Create Your AI Character | ChatLamix' },
      { property: 'og:description', content: coldOnboardingTranslations.meta?.description || 'Create your perfect AI companion with custom style, personality, and voice.' },
      { property: 'og:image', content: '/img/cold-onboarding-share.png' },
      { property: 'og:url', content: 'https://chatlamix/create-character' },
    ],
    coldOnboardingTranslations: coldOnboardingTranslations,
    clerkTranslations: clerkTranslations,
    mode: process.env.MODE || 'development'
  });
});

// Chat onboarding - for users arriving from social media links with a specific chat/character
fastify.get('/chat-onboarding/:chatId', async (request, reply) => {
  const db = fastify.mongo.db;
  let { clerkTranslations, translations, lang, user } = request;
  const chatId = request.params.chatId;
  
  // Support ?lang= parameter to override display language for this page
  const langParam = request.query?.lang;
  const validLangs = ['en', 'fr', 'ja', 'hi'];
  const displayLang = (langParam && validLangs.includes(langParam)) ? langParam : lang;
  
  // Reload translations if lang was overridden
  let chatOnboardingTranslations = request.chatOnboardingTranslations;
  if (displayLang !== lang) {
    chatOnboardingTranslations = fastify.getChatOnboardingTranslations(displayLang);
    clerkTranslations = fastify.getClerkTranslations(displayLang);
  }
  
  // If user is already logged in and not temporary, redirect directly to the chat
  if (user && !user.isTemporary && user.onboardingCompleted) {
    return reply.redirect(`/chat/${chatId}`);
  }
  
  // Fetch the target chat/character data
  let chat;
  try {
    chat = await db.collection('chats').findOne({ _id: new fastify.mongo.ObjectId(chatId) });
  } catch (e) {
    // Try by slug
    chat = await db.collection('chats').findOne({ slug: chatId });
  }
  
  if (!chat) {
    return reply.redirect('/create-character');
  }
  
  const characterName = chat.name || 'AI Character';
  const characterThumbnail = chat.thumbnailUrl || chat.chatImageUrl || '/img/default-avatar.png';
  const characterIntro = chat.short_intro || '';
  const characterTags = chat.tags || [];
  
  // Replace {{name}} placeholders in translation strings
  const processedTranslations = JSON.parse(
    JSON.stringify(chatOnboardingTranslations).replace(/\{\{name\}\}/g, characterName)
  );
  
  return reply.renderWithGtm('chat-onboarding.hbs', {
    title: `Chat with ${characterName} | ChatLamix`,
    seo: [
      { name: 'description', content: `Start chatting with ${characterName} on ChatLamix. Create your free account and dive right in!` },
      { property: 'og:title', content: `Chat with ${characterName} | ChatLamix` },
      { property: 'og:description', content: characterIntro || `Start chatting with ${characterName} on ChatLamix.` },
      { property: 'og:image', content: characterThumbnail },
      { property: 'og:url', content: `https://chatlamix.com/chat-onboarding/${chatId}` },
    ],
    chatId,
    characterName,
    characterThumbnail,
    characterIntro,
    characterTags,
    lang: displayLang,
    chatOnboardingTranslations: processedTranslations,
    clerkTranslations,
    mode: process.env.MODE || 'development'
  });
});

// old login
fastify.get('/login', async (request, reply) => {
  const db = fastify.mongo.db;
  let { translations, lang, user } = request;
  const userId = user._id;
  user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });

  return reply.renderWithGtm(`login.hbs`, {
    title: 'Login - AI Image Generation | ChatLamix',
  });
});

fastify.get('/my-plan', async (request, reply) => {
  const db = fastify.mongo.db;
  let { translations, lang, user } = request;
  const userId = user._id;
  user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });

  const seoMetadata = generateSeoMetadata(request, '/my-plan', lang);
  return reply.renderWithGtm(`plan.hbs`, {
    title: 'Premium Plan - AI Image Generation | ChatLamix',
    canonicalUrl: seoMetadata.canonicalUrl,
    alternates: seoMetadata.alternates,
    seo: [
      { name: 'description', content: translations.seo.description_plan },
      { name: 'keywords', content: translations.seo.keywords },
      { property: 'og:title', content: translations.seo.title_plan },
      { property: 'og:description', content: translations.seo.description_plan },
      { property: 'og:image', content: '/img/share.png' },
      { property: 'og:url', content: seoMetadata.canonicalUrl },
      { property: 'og:locale', content: lang },
      { property: 'og:locale:alternate', content: 'en' },
      { property: 'og:locale:alternate', content: 'fr' },
      { property: 'og:locale:alternate', content: 'ja' },
    ],
  });
});

fastify.get('/affiliation-plan', async (request, reply) => {
  const db = fastify.mongo.db;
  let { translations, lang, user } = request;
  const userId = user._id;
  user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });

  const seoMetadata = generateSeoMetadata(request, '/affiliation-plan', lang);
  return reply.renderWithGtm(`plan-affiliation.hbs`, {
    title: translations.plan_page.affiliation_title || 'Affiliate Program - Premium Plan AI Image Generation',
    canonicalUrl: seoMetadata.canonicalUrl,
    alternates: seoMetadata.alternates,
    seo: [
      { name: 'description', content: translations.seo.description_plan },
      { name: 'keywords', content: translations.seo.keywords },
      { property: 'og:title', content: translations.seo.title_plan },
      { property: 'og:description', content: translations.seo.description_plan },
      { property: 'og:image', content: '/img/share.png' },
      { property: 'og:url', content: seoMetadata.canonicalUrl },
      { property: 'og:locale', content: lang },
      { property: 'og:locale:alternate', content: 'en' },
      { property: 'og:locale:alternate', content: 'fr' },
      { property: 'og:locale:alternate', content: 'ja' },
    ],
  });
});

fastify.get('/chat', async (request, reply) => {
  const db = fastify.mongo.db;
  
  let { translations, lang, user } = request;
  const userId = user._id;

  // Redirect non-logged-in (temporary) users to search page
  if (user.isTemporary) {
    return reply.redirect('/search');
  }

  const collectionChat = db.collection('chats');
  const collectionUser = db.collection('users');
  const userData = await getUserData(userId, collectionUser, collectionChat, user);

  const signIn = request.query.signIn == 'true' || false;
  const signOut = request.query.signOut == 'true' || false;

  if (!signIn && (signOut || user.isTemporary || !userData)) {
    //return reply.redirect('/');
  }

  const isAdmin = await checkUserAdmin(fastify, userId);
  const imageType = request.query.type || false;
  const newSubscription = request.query.newSubscription || false;

  const promptData = await db.collection('prompts').find({}).sort({order: 1}).toArray();
  const giftData = await db.collection('gifts').find({}).sort({order: 1}).toArray();

  // Normalize nsfw field to consistent 'on'/null values for Handlebars template
  const normalizedPromptData = promptData.map(prompt => ({
    ...prompt,
    nsfw: (prompt.nsfw === 'on' || prompt.nsfw === true || prompt.nsfw === 'true') ? 'on' : null
  }));

  const seoMetadata = generateSeoMetadata(request, `/chat/`, lang);
  const imageModels = await buildImageModelsList(db);
  
  // Flag to indicate URL should be updated client-side to /chat/
  const shouldUpdateUrl = true;
  
  return reply.view('chat.hbs', {
    title: translations.seo.title,
    canonicalUrl: seoMetadata.canonicalUrl,
    alternates: seoMetadata.alternates,
    isAdmin,
    imageType,
    user,
    newSubscription,
    userId,
    chatId: undefined,
    userData,
    imageModels,
    promptData: normalizedPromptData,
    giftData,
    isTemporaryOrGuest: !user || user.isTemporary,
    shouldUpdateUrl,
    seo: [
      { name: 'description', content: translations.seo.description },
      { name: 'keywords', content: translations.seo.keywords },
      { property: 'og:title', content: translations.seo.title },
      { property: 'og:description', content: translations.seo.description },
      { property: 'og:image', content: '/img/share.png' },
      { property: 'og:url', content: seoMetadata.canonicalUrl },
      { property: 'og:locale', content: lang },
      { property: 'og:locale:alternate', content: 'en' },
      { property: 'og:locale:alternate', content: 'fr' },
      { property: 'og:locale:alternate', content: 'ja' },
    ],
  });
});
 
fastify.get('/chat/:chatId', async (request, reply) => {
  const db = fastify.mongo.db;
  
  let { translations, lang, user } = request;
  const userId = user._id;

  // Redirect non-logged-in (temporary) users to search page
  if (user.isTemporary) {
    return reply.redirect('/search');
  }

  const collectionChat = db.collection('chats');
  const collectionUser = db.collection('users');
  const userData = await getUserData(userId, collectionUser, collectionChat, user);

  const signIn = request.query.signIn == 'true' || false;
  const signOut = request.query.signOut == 'true' || false;

  if (!signIn && (signOut || !userData)) {
    //return reply.redirect('/');
  }

  const isAdmin = await checkUserAdmin(fastify, userId);
  const chatId = request.params.chatId;
  const imageType = request.query.type || false;
  const newSubscription = request.query.newSubscription || false;

  const promptData = await db.collection('prompts').find({}).sort({order: 1}).toArray();
  const giftData = await db.collection('gifts').find({}).sort({order: 1}).toArray();

  // Normalize nsfw field to consistent 'on'/null values for Handlebars template
  const normalizedPromptData = promptData.map(prompt => ({
    ...prompt,
    nsfw: (prompt.nsfw === 'on' || prompt.nsfw === true || prompt.nsfw === 'true') ? 'on' : null
  }));

  const seoMetadata = generateSeoMetadata(request, `/chat/${chatId}`, lang);
  const imageModels = await buildImageModelsList(db);
  return reply.view('chat.hbs', {
    title: translations.seo.title,
    canonicalUrl: seoMetadata.canonicalUrl,
    alternates: seoMetadata.alternates,
    isAdmin,
    imageType,
    user,
    newSubscription,
    userId,
    chatId,
    userData,
    imageModels,
    promptData: normalizedPromptData,
    giftData,
    isTemporaryOrGuest: !user || user.isTemporary,
    seo: [
      { name: 'description', content: translations.seo.description },
      { name: 'keywords', content: translations.seo.keywords },
      { property: 'og:title', content: translations.seo.title },
      { property: 'og:description', content: translations.seo.description },
      { property: 'og:image', content: '/img/share.png' },
      { property: 'og:url', content: seoMetadata.canonicalUrl },
      { property: 'og:locale', content: lang },
      { property: 'og:locale:alternate', content: 'en' },
      { property: 'og:locale:alternate', content: 'fr' },
      { property: 'og:locale:alternate', content: 'ja' },
    ],
  });
});

fastify.get('/chat/edit/:chatId', async (request, reply) => {
  try {
    const db = fastify.mongo.db;

    const usersCollection = db.collection('users');
    const chatsCollection = db.collection('chats');

    let { translations, lang, user } = request;
    const userId = user._id;

    user = await usersCollection.findOne({ _id: new fastify.mongo.ObjectId(userId) });

    const chats = await chatsCollection.distinct('chatImageUrl', { userId });

    if((user && user.subscriptionStatus !== 'active') && chats.length > 0){
      return false;
    }

    let chatId = request.params.chatId || null;
    const chatImage = request.query.chatImage;
    const isTemporaryChat = !request.params.chatId;

    request.query.limit = 20;
    request.query.page = 'random';
    const { tags, page, totalPages } = await fetchTags(db,request);
    // Assure that tags are unique by first converting them to lowercasing and then to a set then back to an array
    const uniqueTags = [...new Set(tags.map(tag => tag.toLowerCase()))];
    

    return reply.view('character-creation.hbs', {
      title: 'Create Character - AI Image Generation | ChatLamix',
      tags,
      chatId,
      modelId: request.query.modelId,
      isTemporaryChat,
      translations,
      lang,
      user
    });
  } catch (error) {
    console.log(error);
    return reply.status(500).send({ error: 'Failed to retrieve chatId' });
  }
});

fastify.get('/character-update/:chatId', async (request, reply) => {
  try {
    const db = fastify.mongo.db;
    let { translations, lang, user } = request;
    const userId = user._id;
    const { chatId } = request.params;
    console.log(`[/character-update/:chatId] User ID: ${userId}, Chat ID: ${chatId}`);
    if (!fastify.mongo.ObjectId.isValid(chatId)) {
      return reply.status(400).send({ error: 'Invalid chat ID' });
    }

    // Check if user owns this character
    const chat = await db.collection('chats').findOne({
      _id: new fastify.mongo.ObjectId(chatId),
      userId: new fastify.mongo.ObjectId(userId)
    });

    if (!chat) {
      return reply.status(404).send({ error: 'Character not found or access denied' });
    }

    return reply.view('character-update.hbs', {
      title: `${translations.characterUpdate?.updateCharacter || 'Update Character'} - ${chat.name}`,
      chatId,
      chat
    });
  } catch (error) {
    console.error('Error loading character update page:', error);
    return reply.status(500).send({ error: 'Failed to load character update page' });
  }
});

fastify.get('/post', async (request, reply) => {
  try {
    const db = fastify.mongo.db;
    let { translations, lang, user } = request;
    const userId = user._id;
    if (!user.isTemporary && userId) user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });
    
    return reply.view('post.hbs', {
      title: translations.seo.title_post,
      seo: [
        { name: 'description', content: translations.seo.description_post },
        { name: 'keywords', content: translations.seo.keywords },
        { property: 'og:title', content: translations.seo.title_post },
        { property: 'og:description', content: translations.seo.description_post },
        { property: 'og:image', content: '/img/share.png' },
        { property: 'og:url', content: 'https://chatlamix/' },
      ],
    });
  } catch (error) {
    console.log(error);
  }
});

fastify.get('/post/:postId', async (request, reply) => {
  try {
    const db = fastify.mongo.db;
    let { translations, lang, user } = request;
    
    const userId = user._id;
    const postId = request.params.postId;

    if (!user.isTemporary && userId) user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });
    const post = await db.collection('posts').findOne({ _id: new fastify.mongo.ObjectId(postId) });

    if (!post) {
      return reply.code(404).send({ error: 'Post not found' });
    }

    const postUserId = post.userId;
    const postUser = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(postUserId) });

    const seoMetadata = generateSeoMetadata(request, `/post/${postId}`, lang);
    return reply.renderWithGtm('post.hbs', {
      title: translations.seo.title_post,
      canonicalUrl: seoMetadata.canonicalUrl,
      alternates: seoMetadata.alternates,
      postUser,
      userId,
      post,
      seo: [
        { name: 'description', content: translations.seo.description_post },
        { name: 'keywords', content: translations.seo.keywords },
        { property: 'og:title', content: translations.seo.title_post },
        { property: 'og:description', content: translations.seo.description_post },
        { property: 'og:image', content: '/img/share.png' },
        { property: 'og:url', content: seoMetadata.canonicalUrl },
        { property: 'og:locale', content: lang },
        { property: 'og:locale:alternate', content: 'en' },
        { property: 'og:locale:alternate', content: 'fr' },
        { property: 'og:locale:alternate', content: 'ja' },
      ],
    });
  } catch (err) {
    console.log(err);
    return reply.code(500).send('Internal Server Error');
  }
});

fastify.get('/character', async (request, reply) => {
  try {
    const db = fastify.mongo.db;
    let { translations, lang, user } = request;
    
    const userId = user._id;
    user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });

    const seoMetadata = generateSeoMetadata(request, '/character', lang);
    return reply.renderWithGtm('character.hbs', {
      title: translations.seo.title_character || 'Ai images generator & Ai chat',
      canonicalUrl: seoMetadata.canonicalUrl,
      alternates: seoMetadata.alternates,
      seo: [
        { name: 'description', content: translations.seo.description_character },
        { name: 'keywords', content: translations.seo.keywords },
        { property: 'og:title', content: translations.seo.title_character },
        { property: 'og:description', content: translations.seo.description_character },
        { property: 'og:image', content: '/img/share.png' },
        { property: 'og:url', content: seoMetadata.canonicalUrl },
        { property: 'og:locale', content: lang },
        { property: 'og:locale:alternate', content: 'en' },
        { property: 'og:locale:alternate', content: 'fr' },
        { property: 'og:locale:alternate', content: 'ja' },
      ],
    });
  } catch (error) {
    console.log(error);
    return reply.code(500).send('Internal Server Error');
  }
});

fastify.get('/landingpage/:pageid', async (request, reply) => {
  try {
    const { pageid } = request.params;

    // Redirect creator-related landing pages to coming soon
    if (pageid === 'become-creator-en') {
      return reply.redirect('/creators/coming-soon');
    }

    return reply.view(`landingpages/${pageid}.hbs`, {
      bannerNumber: 0,
      title: 'Landing Page',
    });
  } catch (error) {
    console.log(error);
    return reply.code(500).send('Internal Server Error');
  }
});

// Helper function to tokenize a prompt string
function tokenizePrompt(promptText) {
  if (!promptText || typeof promptText !== 'string') {
    return new Set();
  }
  return new Set(
    promptText
      .toLowerCase()
      .split(/\W+/) // Split by non-alphanumeric characters
      .filter(token => token.length > 0) // Remove empty tokens
  );
}

// Route to handle character slug
fastify.get('/character/slug/:slug', async (request, reply) => {
  const startTime = Date.now();
  
  try {
    const db = fastify.mongo.db;
    const { translations, lang, user } = request;
    const currentUserId = user._id; 
    const { slug } = request.params;
    const imageSlug = request.query.imageSlug || null;
    const isModal = request.query.modal === 'true';

    console.time(`character-slug-${slug}`);

    // Parallel query execution for independent data
    const [chat, currentUserData, isAdmin] = await Promise.all([
      db.collection('chats').findOne({ 
        slug,
        chatImageUrl: { $exists: true, $ne: null },
      }),
      !user.isTemporary && currentUserId ? 
        db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(currentUserId) }) : 
        Promise.resolve(user),
      checkUserAdmin(fastify, currentUserId)
    ]);

    if (!chat) {
      console.warn(`[/character/:slug] Chat not found for slug: ${slug}`);
      return reply.code(404).send({ error: 'Chat not found' });
    }

    let chatIdObjectId = chat._id;
    let chatIdParam = chat._id.toString();
    try {
      chatIdObjectId = new fastify.mongo.ObjectId(chatIdParam);
    } catch (e) {
      console.error(`[/character/:slug] Invalid Chat ID format: ${chatIdParam}`);
      return reply.code(400).send({ error: 'Invalid Chat ID format' });
    }

    // Determine subscription status
    let subscriptionStatus = false;
    if (currentUserData && !currentUserData.isTemporary) {
      subscriptionStatus = currentUserData.subscriptionStatus === 'active';
    }

    // Optimized image lookup
    let image = null;
    let isBlur = false;
    let imageId = null;
    
    if (imageSlug) {
      // More efficient image query using findOne with array filtering
      const gallery = await db.collection('gallery').findOne(
        { 
          chatId: chatIdObjectId,
          'images.slug': imageSlug 
        },
        { 
          projection: { 
            'images.$': 1 // This returns only the matching image
          } 
        }
      );

      if (gallery?.images?.[0]) {
        image = gallery.images[0];
        imageId = image._id;

        try {
          imageId = new fastify.mongo.ObjectId(imageId);
        } catch (e) {
          console.error(`[/character/:slug] Invalid Image ID format: ${imageId}`);
          return reply.code(400).send({ error: 'Invalid Image ID format' });
        }

        // Check if this is an upscaled image with an originalImageId
        if (image.isUpscaled && image.originalImageId) {
          try {
            const originalImageId = new fastify.mongo.ObjectId(image.originalImageId);
            
            // Find the original image in the gallery
            const originalGallery = await db.collection('gallery').findOne(
              { 
                chatId: chatIdObjectId,
                'images._id': originalImageId 
              },
              { 
                projection: { 
                  'images.$': 1
                } 
              }
            );
            
            if (originalGallery?.images?.[0]?.slug) {
              // Redirect to the original image with the same query parameters
              // Use 301 (permanent) redirect for SEO
              const { modal } = request.query;
              let queryString = `?imageSlug=${encodeURIComponent(originalGallery.images[0].slug)}`;
              if (modal) {
                queryString += `&modal=${modal}`;
              }
              
              return reply.code(301).redirect(`/character/slug/${encodeURIComponent(chat.slug)}${queryString}`);
            }
          } catch (err) {
            console.error(`[/character/:slug] Error processing originalImageId: ${image.originalImageId}`, err);
            // Continue with the upscaled image if we can't find the original
          }
        }

        // Async title generation (non-blocking)
        if (
          !image.title ||
          typeof image.title !== 'object' ||
          !image.title.en ||
          !image.title.ja ||
          !image.title.fr
        ) {
          const existingTitle = image.title || {};
          const generateTitles = async () => {
            const title = { ...existingTitle };
            if (!title.en) title.en = await generatePromptTitle(image.prompt, 'english');
            if (!title.ja) title.ja = await generatePromptTitle(image.prompt, 'japanese');  
            if (!title.fr) title.fr = await generatePromptTitle(image.prompt, 'french');
            return title;
          };

          // Don't await this - let it run in background
          generateTitles().then((title) => {
            db.collection('gallery').updateOne(
              { 'images._id': imageId },
              { $set: { 'images.$.title': title } }
            );

          }).catch((err) => {
            console.error('[SimilarChats] Failed to generate titles for image:', err);
          });
        }
        
        const unlockedItem = currentUserData?.unlockedItems?.map((id) => id.toString()).includes(imageId.toString());
        isBlur = unlockedItem ? false : image?.nsfw && !subscriptionStatus;
      } else {
        console.warn(`[SimilarChats] Image not found for slug: ${imageSlug} in chat ${chatIdParam}`);
      }
    }

    // Build canonical and alternate URLs for SEO using helper function
    const encodedSlug = encodeURIComponent(chat.slug);
    const characterPath = `/character/slug/${encodedSlug}`;
    const seoMetadata = generateSeoMetadata(request, characterPath, lang);
    const { canonicalUrl, alternates } = seoMetadata;

    // Get protocol and host from request for ogImage
    const forwardedProto = request.headers['x-forwarded-proto'];
    const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || request.protocol || 'https';
    const host = request.hostname;
    const isLocalHost = host.includes('localhost') || host.includes('127.0.0.1') || host.includes('0.0.0.0');
    const baseUrl = isLocalHost ? `${protocol}://${host}` : `https://app.chatlamix.com`;

    const imageSource = image?.imageUrl || chat.chatImageUrl || '/img/share.png';
    const ogImage = /^https?:\/\//i.test(imageSource)
      ? imageSource
      : `${baseUrl}${imageSource.startsWith('/') ? imageSource : `/${imageSource}`}`;

    // Determine if current user is the owner of this character
    const isOwner = !user.isTemporary && currentUserId && chat.userId && 
      (chat.userId.toString() === currentUserId.toString());

    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: chat.name,
      url: canonicalUrl,
      image: ogImage,
      description: image?.title?.[lang] || chat.description || chat.short_intro,
      inLanguage: lang,
      alternateName: chat.slug,
      keywords: Array.isArray(chat.tags) && chat.tags.length ? chat.tags.join(', ') : undefined,
      gender: chat.gender || undefined,
      dateModified: chat.updatedAt || undefined,
      dateCreated: chat.createdAt || undefined
    };

    // Render immediately
    const template = isModal ? 'character-modal.hbs' : 'character.hbs';
    const response = reply.renderWithGtm(template, {
      title: `${chat.name} | ${translations.seo.title_character}`,
      chat,
      image,
      chatId: chatIdParam,
      isBlur,
      isAdmin,
      isOwner,
      similarChats: [], // Will be populated via websocket
      user: currentUserData,
      canonicalUrl,
      alternates,
      structuredData: JSON.stringify(structuredData, null, 2),
      seo: [
        { name: 'description', content: ` ${image?.title?.[request.lang] ?? chat.description ?? ''} | ${translations.seo.description_character}` },
        { name: 'keywords', content: translations.seo.keywords },
        { property: 'og:title', content: `${chat.name} | ${translations.seo.title_character}` },
        { property: 'og:description', content: `${image?.title?.[request.lang] ?? chat.description ?? ''} | ${translations.seo.description_character}` },
        { property: 'og:image', content: ogImage },
        { property: 'og:url', content: canonicalUrl },
        { property: 'og:locale', content: lang },
        { property: 'og:locale:alternate', content: 'en' },
        { property: 'og:locale:alternate', content: 'fr' },
        { property: 'og:locale:alternate', content: 'ja' },
      ],
    });
    
    return response;

  } catch (err) {
    console.log(`[/character/slug/:slug] Request failed after: ${Date.now() - startTime}ms`);
    console.error(`[SimilarChats] Error in /character/slug/:slug route for ${request.params.slug}:`, err);
    reply.code(500).send('Internal Server Error');
  }
});

fastify.get('/character/:chatId', async (request, reply) => {
  const db = fastify.mongo.db;
  let chatId = request.params.chatId;
  let chat;
  let chatIdObjectId;
  
  try {
    chatIdObjectId = new fastify.mongo.ObjectId(chatId);
    chat = await db.collection('chats').findOne({ _id: chatIdObjectId });
  } catch (e) {
    // If not a valid ObjectId, check if it might be a slug (to avoid unnecessary redirects)
    const slugChat = await db.collection('chats').findOne({ slug: chatId });
    if (slugChat) {
      // It's actually a slug, redirect properly
      const queryString = request.url.split('?')[1] || '';
      const redirectUrl = `/character/slug/${chatId}${queryString ? `?${queryString}` : ''}`;
      return reply.code(301).redirect(redirectUrl);
    }
    console.error(`[character/:chatId] Invalid Chat ID format: ${chatId}. Error:`, e);
    return reply.code(301).redirect(`/character/`);
  }
  
  if (!chat) {
    console.warn(`[character/:chatId] No chat found for chatId: ${chatId}. Redirecting to /character/`);
    return reply.code(301).redirect(`/character/`);
  }
  
  // Ensure chat has a slug; generate enhanced slug if missing
  if (!chat.slug || chat.slug.length < 15) {
    try {
      const slug = await generateUniqueSlug(chat.name || 'character', chatIdObjectId, db, 'chats');
      await db.collection('chats').updateOne(
        { _id: chatIdObjectId }, 
        { $set: { slug } }
      );
      chat.slug = slug;
    } catch (err) {
      console.error(`[character/:chatId] Error generating slug for chat ${chatId}:`, err);
      // Fallback to basic slug if enhanced generation fails
      if (!chat.slug) {
        const fallbackSlug = slugify(chat.name || `character-${chatId}`, { lower: true, strict: true });
        const randomStr = Math.random().toString(36).substring(2, 8);
        chat.slug = `${fallbackSlug}-${randomStr}`;
        await db.collection('chats').updateOne(
          { _id: chatIdObjectId }, 
          { $set: { slug: chat.slug } }
        );
      }
    }
  }

  let imageId = request.query.imageId ? request.query.imageId : null;
  let imageSlug;
  
  if (imageId) {
    try {
      const imageIdObjectId = new fastify.mongo.ObjectId(imageId);
      const galleryCollection = db.collection('gallery');
      
      // Find the image in the gallery
      const imageDoc = await galleryCollection.aggregate([
        { $match: { chatId: chatIdObjectId } },
        { $unwind: '$images' },
        { $match: { 'images._id': imageIdObjectId } },
        { $project: { image: '$images', _id: 0 } }
      ]).toArray();

      if (imageDoc.length > 0 && imageDoc[0].image) {
        // Check if image already has a slug
        if (!imageDoc[0].image.slug || imageDoc[0].image.slug.length < 10) {
          // Get a title to use for the slug
          const imageTitle = typeof imageDoc[0].image.title === 'string'
            ? imageDoc[0].image.title
            : (imageDoc[0].image.title?.en || imageDoc[0].image.title?.ja || imageDoc[0].image.title?.fr || '');

          try {
            // Use enhanced image slug generation
            imageSlug = generateImageSlug(imageTitle, chat.slug, imageIdObjectId);
            
            // Check if this image slug already exists
            const slugExists = await galleryCollection.findOne({
              'images.slug': imageSlug,
              'images._id': { $ne: imageIdObjectId }
            });
            
            if (slugExists) {
              // Shouldn't happen with ObjectId, but handle edge case
              const timestamp = Date.now().toString(36).substring(7);
              imageSlug = `${imageSlug}-${timestamp}`;
            }
            
            await galleryCollection.updateOne(
              { 'images._id': imageIdObjectId },
              { $set: { 'images.$.slug': imageSlug } }
            );
          } catch (err) {
            console.error(`[character/:chatId] Error generating image slug:`, err);
            // Fallback slug
            if (!imageSlug) {
              const titleSlug = imageTitle 
                ? slugify(imageTitle, { lower: true, strict: true }).substring(0, 30)
                : imageIdObjectId.toString().substring(18);
              imageSlug = `${chat.slug}-${titleSlug}-${imageIdObjectId.toString()}`;
              await galleryCollection.updateOne(
                { 'images._id': imageIdObjectId },
                { $set: { 'images.$.slug': imageSlug } }
              );
            }
          }
        } else {
          imageSlug = imageDoc[0].image.slug;
        }
      }
    } catch (err) {
      console.error(`[character/:chatId] Error processing imageId: ${imageId}`, err);
      // Continue without imageSlug if there's an error
    }
  }
  
  // Preserve original query parameters
  const { modal } = request.query;
  let queryString = '';
  if (imageSlug) {
    queryString = `?imageSlug=${encodeURIComponent(imageSlug)}`;
    if (modal) {
      queryString += `&modal=${modal}`;
    }
  } else if (modal) {
    queryString = `?modal=${modal}`;
  }

  // Ensure chat.slug exists before redirecting
  if (!chat.slug) {
    console.error(`[character/:chatId] Chat ${chatId} has no slug, cannot redirect`);
    return reply.code(500).send({ error: 'Character slug missing' });
  }

  // Use 301 (permanent) redirect for SEO - indicates this is the canonical URL
  const redirectUrl = `/character/slug/${encodeURIComponent(chat.slug)}${queryString}`;
  return reply.code(301).redirect(redirectUrl);
});

/**
 * Share Image Route - Provides clean URLs with proper meta tags for social media sharing
 * This route serves a page with OpenGraph/Twitter Card meta tags, then redirects to the character page
 */
fastify.get('/share/image/:imageId', async (request, reply) => {
  const db = fastify.mongo.db;
  const { imageId } = request.params;
  const { translations, lang } = request;
  
  try {
    // Validate imageId format
    let imageIdObjectId;
    try {
      imageIdObjectId = new fastify.mongo.ObjectId(imageId);
    } catch (e) {
      console.error(`[share/image] Invalid image ID format: ${imageId}`);
      return reply.code(400).send({ error: 'Invalid image ID format' });
    }

    // Find the image in the gallery collection
    const galleryDoc = await db.collection('gallery').aggregate([
      { $unwind: '$images' },
      { $match: { 'images._id': imageIdObjectId } },
      { $project: { 
        image: '$images', 
        chatId: 1,
        _id: 0 
      }}
    ]).toArray();

    if (!galleryDoc.length || !galleryDoc[0].image) {
      console.warn(`[share/image] Image not found: ${imageId}`);
      return reply.code(404).send({ error: 'Image not found' });
    }

    const image = galleryDoc[0].image;
    const chatId = galleryDoc[0].chatId;

    // Fetch associated chat for character info
    const chat = await db.collection('chats').findOne({ _id: chatId });
    if (!chat) {
      console.warn(`[share/image] Chat not found for image: ${imageId}`);
      return reply.code(404).send({ error: 'Character not found' });
    }

    // Build the image title
    const imageTitle = typeof image.title === 'string' 
      ? image.title 
      : (image.title?.[lang] || image.title?.en || image.title?.ja || image.title?.fr || '');
    
    // Always use production domain for share URLs and meta tags
    const baseUrl = 'https://app.chatlamix.com';
    
    const imageUrl = image.imageUrl || image.url;
    const ogImageUrl = /^https?:\/\//i.test(imageUrl) 
      ? imageUrl 
      : `${baseUrl}${imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`}`;

    // Build the canonical/redirect URL to the character page
    const characterSlug = chat.slug || chat._id.toString();
    const imageSlug = image.slug || imageId;
    const canonicalUrl = `${baseUrl}/character/slug/${encodeURIComponent(characterSlug)}?imageSlug=${encodeURIComponent(imageSlug)}`;
    const sharePageUrl = `${baseUrl}/share/image/${imageId}`;

    // Get page title and description
    const pageTitle = imageTitle 
      ? `${imageTitle} | ${chat.name} | ${translations?.seo?.title_character || 'ChatLamix'}`
      : `${chat.name} | ${translations?.seo?.title_character || 'ChatLamix'}`;
    
    const pageDescription = imageTitle || chat.description || chat.short_intro || 
      translations?.seo?.description_character || 'Check out this AI-generated image';

    // Check if this is a social media crawler/bot by User-Agent
    const userAgent = (request.headers['user-agent'] || '').toLowerCase();
    const isSocialBot = userAgent.includes('twitterbot') || 
                        userAgent.includes('facebookexternalhit') || 
                        userAgent.includes('linkedinbot') ||
                        userAgent.includes('discordbot') ||
                        userAgent.includes('slackbot') ||
                        userAgent.includes('telegrambot') ||
                        userAgent.includes('whatsapp');

    // For social media bots, serve the meta tags page
    // For regular browsers, redirect immediately
    if (!isSocialBot) {
      return reply.code(302).redirect(canonicalUrl);
    }

    // Serve the share page with meta tags for social media crawlers
    return reply.renderWithGtm('share-image.hbs', {
      title: pageTitle,
      chatName: chat.name,
      imageTitle: imageTitle,
      imageUrl: ogImageUrl,
      canonicalUrl: canonicalUrl,
      sharePageUrl: sharePageUrl,
      chatSlug: characterSlug,
      imageSlug: imageSlug,
      description: pageDescription,
      lang: lang,
      seo: [
        // Basic meta tags
        { name: 'description', content: pageDescription },
        { name: 'robots', content: 'noindex' }, // Don't index share pages
        
        // OpenGraph tags
        { property: 'og:title', content: pageTitle },
        { property: 'og:description', content: pageDescription },
        { property: 'og:image', content: ogImageUrl },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:url', content: sharePageUrl },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'ChatLamix' },
        { property: 'og:locale', content: lang || 'en' },
        
        // Twitter Card tags - summary_large_image shows the image prominently
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: pageTitle },
        { name: 'twitter:description', content: pageDescription },
        { name: 'twitter:image', content: ogImageUrl },
        { name: 'twitter:image:alt', content: imageTitle || `Image from ${chat.name}` },
      ],
    });

  } catch (err) {
    console.error(`[share/image] Error processing share for image ${imageId}:`, err);
    return reply.code(500).send({ error: 'Internal server error' });
  }
});

// feature
fastify.get('/features', async (request, reply) => {
  const db = fastify.mongo.db;
  let { translations, lang, user } = request;
  const userId = user._id;
  user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });

  const features = [
    //features list
    { title: translations.features_page.feature1_title, description: translations.features_page.feature1_description, icon: 'fas fa-robot', link: 'landingpage/features-en' },
    // ai influencer  
    { title: translations.features_page.ai_influencer_title, description: translations.features_page.ai_influencer_description, icon: 'fas fa-user-astronaut', link: '/landingpage/influencer-en'  },
    // NSFW video generator
    { title: translations.features_page.nsfw_video_generator_title, description: translations.features_page.nsfw_video_generator_description, icon: 'fas fa-video', link: '/landingpage/nsfw-video-generator-en'  },
    // Become a Creator
    { title: translations.features_page.become_creator_title || 'Become a Creator', description: translations.features_page.become_creator_description || 'Monetize your content by becoming a creator', icon: 'fas fa-dollar-sign', link: '/landingpage/become-creator-en'  },
    // Landing page
    { title: translations.features_page.landing_page_title || 'Welcome', description: translations.features_page.landing_page_description || 'Learn more about our platform', icon: 'fas fa-home', link: '/landing'  },
  ]
  return reply.renderWithGtm('features.hbs', {
    title: translations.seo.title_features || 'Ai images generator & Ai chat',
    features,
    user,
    seo: [
      { name: 'description', content: translations.seo.description_features },
      { name: 'keywords', content: translations.seo.keywords },
      { property: 'og:title', content: translations.seo.title_features },
      { property: 'og:description', content: translations.seo.description_features },
      { property: 'og:image', content: '/img/share.png' },
      { property: 'og:url', content: 'https://chatlamix/' },
    ],
  });
});
fastify.get('/tags', async (request, reply) => {
  try {
    const db = fastify.mongo.db;
    const { translations, lang, user } = request;
    const { tags, page, totalPages } = await fetchTags(db,request);
    return reply.renderWithGtm('tags.hbs', {
      title: `${translations.seo.title_tags} ${translations.seo.page} ${page}`,
      
      tags,
      page,
      totalPages,
      
      
      seo: [
        { name: 'description', content: translations.seo.description_tags },
        { name: 'keywords', content: `${translations.seo.keywords}` },
        { property: 'og:title', content: translations.seo.title_tags },
        { property: 'og:description', content: translations.seo.description_tags },
        { property: 'og:image', content: '/img/share.png' },
      ],
    });
  } catch (error) {
  console.error('Error displaying tags:', error);
  reply.status(500).send({ error: 'Failed to display tags' });
  }
});

fastify.get('/search', async (request, reply) => {
  try {
    const db = fastify.mongo.db;
    let { translations, lang, user } = request;
    const userId = user._id;

    user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) }) || request.user;

    const query = request.query.q || request.query.query || '';

    let seoTitle = translations.seo_title_default; 
    let seoDescription = translations.seo_description_default;
    if (query) {
      seoTitle = translations.seo_title_query.replace('${query}', query);
      seoDescription = translations.seo_description_query.replace('${query}', query);
    }

    // Determine NSFW setting - only show if user is premium and has enabled it
    // Handle both boolean true and string 'true' from database
    const showNSFW = user.subscriptionStatus === 'active' && (user.showNSFW === true || user.showNSFW === 'true');
    const isAdmin = await checkUserAdmin(fastify, userId);

    return reply.renderWithGtm('search.hbs', {
      title: seoTitle,
      query,
      user,
      showNSFW,
      isAdmin,
      translations,
      seo: [
        { name: 'description', content: seoDescription },
        { name: 'keywords', content: `${query ? query + ', ' : ''}${translations.seo.keywords}` },
        { property: 'og:title', content: seoTitle },
        { property: 'og:description', content: seoDescription },
        { property: 'og:image', content: '/img/share.png' },
      ],
    });
  } catch (error) {
    console.error('[SEARCH] Error occurred:', error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});
fastify.get('/about', async (request, reply) => {
  const db = fastify.mongo.db;
  let { user } = request;
  
  const collectionChats = db.collection('chats');
  const chats = await collectionChats
    .find({ visibility: { $exists: true, $eq: 'public' } })
    .sort({ _id: -1 })
    .limit(10)
    .toArray();

  return reply.renderWithGtm('chat.hbs', {
    title: translations.seo.title,
   
    
    
    chats,
    isTemporaryOrGuest: !user || user.isTemporary,
    seo: [
      { name: 'description', content: translations.seo.description },
      { name: 'keywords', content: translations.seo.keywords },
      { property: 'og:title', content: translations.seo.title },
      { property: 'og:description', content: translations.seo.description },
      { property: 'og:image', content: '/img/share.png' },
      { property: 'og:url', content: 'https://chatlamix/' },
    ],
  });
});


fastify.get('/discover', async (request, reply) => {
  const db = fastify.mongo.db;
  let { translations, lang, user } = request;
  const userId = user._id;
  user = await db.collection('users').findOne({ _id: new fastify.mongo.ObjectId(userId) });
  

  return reply.renderWithGtm('discover.hbs', {
    title: translations.seo.titl,
   
    
    
    
    seo: [
      { name: 'description', content: translations.seo.description },
      { name: 'keywords', content: translations.seo.keywords },
      { property: 'og:title', content: translations.seo.title },
      { property: 'og:description', content: translations.seo.description },
      { property: 'og:image', content: '/img/share.png' },
      { property: 'og:url', content: 'https://chatlamix/' },
    ],
  });
});



fastify.get('/users', (request, reply) => {
  if (process.env.MODE === 'local') {
    reply.view('user-list.hbs', { title: 'Users - AI Image Generation | ChatLamix' });
  } else {
    reply.redirect('/');
  }
});

fastify.get('/generate/:userid', (request, reply) => {
  const userId = request.params.userid;
  reply.view('generate.hbs', { title: 'Generate - AI Image Generation | ChatLamix', userId });
});

fastify.get('/dashboard', async (request, reply) => {
  try {
    const db = fastify.mongo.db;
    let { translations, lang, user } = request;
    const userId = user._id;

    // Redirect non-logged-in (temporary) users to search page
    if (user.isTemporary) {
      return reply.redirect('/search');
    }

    const collectionChat = db.collection('chats');
    const collectionUser = db.collection('users');
    const { getUserData } = require('./models/tool');
    const userData = await getUserData(userId, collectionUser, collectionChat, user);

    const isAdmin = await checkUserAdmin(fastify, userId);
    const promptData = await db.collection('prompts').find({}).sort({order: 1}).toArray();
    const giftData = await db.collection('gifts').find({}).sort({order: 1}).toArray();

    // Normalize nsfw field to consistent 'on'/null values for Handlebars template
    const normalizedPromptData = promptData.map(prompt => ({
      ...prompt,
      nsfw: (prompt.nsfw === 'on' || prompt.nsfw === true || prompt.nsfw === 'true') ? 'on' : null
    }));

    const seoMetadata = generateSeoMetadata(request, '/dashboard', lang);
    return reply.view('dashboard.hbs', {
      title: translations.dashboard?.title || 'Dashboard',
      canonicalUrl: seoMetadata.canonicalUrl,
      alternates: seoMetadata.alternates,
      isAdmin,
      user,
      userId,
      userData,
      promptData: normalizedPromptData,
      giftData,
      isTemporaryOrGuest: !user || user.isTemporary,
      seo: [
        { name: 'description', content: translations.seo?.description || '' },
        { name: 'keywords', content: translations.seo?.keywords || '' },
        { property: 'og:title', content: translations.dashboard?.title || translations.seo?.title || 'Dashboard' },
        { property: 'og:description', content: translations.seo?.description || '' },
        { property: 'og:image', content: '/img/share.png' },
        { property: 'og:url', content: seoMetadata.canonicalUrl },
        { property: 'og:locale', content: lang },
      ],
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    return reply.status(500).send({ error: 'Unable to render the dashboard' });
  }
});

// Dashboard Stats API
fastify.get('/api/dashboard/stats', async (request, reply) => {
  try {
    const db = fastify.mongo.db;
    const user = request.user;
    
    if (!user || !user._id) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    
    const userId = new fastify.mongo.ObjectId(user._id);
    
    // Count characters created by user
    const charactersCount = await db.collection('chats').countDocuments({ userId });
    
    // Count user's chat conversations
    const chatsCount = await db.collection('userChat').countDocuments({ userId });
    
    // Count images generated by user - aggregate across all gallery documents for user's chats
    const userChats = await db.collection('chats').find({ userId }, { projection: { _id: 1 } }).toArray();
    const userChatIds = userChats.map(c => c._id);
    
    let imagesCount = 0;
    if (userChatIds.length > 0) {
      const imageAggregation = await db.collection('gallery').aggregate([
        { $match: { chatId: { $in: userChatIds } } },
        { $project: { imageCount: { $size: { $ifNull: ['$images', []] } } } },
        { $group: { _id: null, total: { $sum: '$imageCount' } } }
      ]).toArray();
      imagesCount = imageAggregation[0]?.total || 0;
    }
    
    // Count videos generated by user
    const videosCount = await db.collection('videos').countDocuments({ userId });
    
    return reply.send({
      characters: charactersCount,
      chats: chatsCount,
      images: imagesCount,
      videos: videosCount
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return reply.code(500).send({ error: 'Internal Server Error' });
  }
});

// Recent Chats API
fastify.get('/api/recent-chats', async (request, reply) => {
  try {
    const db = fastify.mongo.db;
    const user = request.user;
    
    if (!user || !user._id) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    
    const userId = new fastify.mongo.ObjectId(user._id);
    const limit = parseInt(request.query.limit) || 10;
    
    // Use aggregation to get only the latest chat per character (chatId)
    const userChats = await db.collection('userChat').aggregate([
      { $match: { userId } },
      { $sort: { updatedAt: -1, createdAt: -1 } },
      // Group by chatId (character) and keep only the first (latest) document
      {
        $group: {
          _id: '$chatId',
          doc: { $first: '$$ROOT' }
        }
      },
      // Restore the document structure
      { $replaceRoot: { newRoot: '$doc' } },
      // Sort again after grouping
      { $sort: { updatedAt: -1, createdAt: -1 } },
      { $limit: limit }
    ]).toArray();
    
    // Get chat details for each userChat
    const chatIds = [...new Set(userChats.map(uc => uc.chatId))];
    const chats = await db.collection('chats')
      .find({ _id: { $in: chatIds.map(id => new fastify.mongo.ObjectId(id)) } })
      .toArray();
    
    const chatMap = {};
    chats.forEach(chat => {
      chatMap[chat._id.toString()] = chat;
    });
    
    // Get favorites status for all chat IDs
    const favoritesMap = {};
    if (chatIds.length > 0) {
      const favorites = await db.collection('user_favorites')
        .find({
          userId: userId,
          chatId: { $in: chatIds.map(id => new fastify.mongo.ObjectId(id)) }
        })
        .toArray();
      
      favorites.forEach(fav => {
        favoritesMap[fav.chatId.toString()] = true;
      });
    }
    
    // Combine data
    const recentChats = userChats.map(uc => {
      const chat = chatMap[uc.chatId?.toString()] || {};
      const chatIdStr = (chat._id || uc.chatId)?.toString();
      return {
        _id: chat._id || uc.chatId,
        name: chat.name || 'Unknown',
        chatImageUrl: chat.chatImageUrl || '/img/default-avatar.webp',
        description: chat.characterPrompt || chat.description || '',
        lastMessage: uc.messages?.[uc.messages.length - 1]?.content || '',
        updatedAt: uc.updatedAt || uc.createdAt,
        createdAt: uc.createdAt,
        userChatId: uc._id,
        isFavorite: !!favoritesMap[chatIdStr]
      };
    }).filter(c => c._id);
    
    return reply.send({ chats: recentChats });
  } catch (error) {
    console.error('Error fetching recent chats:', error);
    return reply.code(500).send({ error: 'Internal Server Error' });
  }
});

fastify.get('/debug/tasks-status', async (request, reply) => {
  const db = fastify.mongo.db;
  
  const recentTasks = await db.collection('tasks').find({
    createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) } // Last 30 minutes
  }).sort({ createdAt: -1 }).toArray();
  
  const pendingTasks = await db.collection('tasks').find({ status: 'pending' }).toArray();
  const backgroundTasks = await db.collection('tasks').find({ status: 'background' }).toArray();
  
  return {
    recentTasks: recentTasks.length,
    pendingTasks: pendingTasks.length,
    backgroundTasks: backgroundTasks.length,
    tasks: recentTasks.map(task => ({
      taskId: task.taskId,
      status: task.status,
      chatCreation: task.chatCreation,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      processedAt: task.processedAt
    }))
  };
});

// Settings route moved to routes/user.js

// Add sitemap route before the existing routes
fastify.get('/sitemap', async (request, reply) => {
  try {
    const db = fastify.mongo.db;
    const { getCachedSitemapData } = require('./models/sitemap-utils');
    let { translations, lang, user } = request;
    
    // Get cached sitemap data (this will generate if not found)
    let sitemapData = await getCachedSitemapData(db);
    
    // If still no cached data after generation attempt, provide fallback
    if (!sitemapData) {
      console.log('[/sitemap] No cached data available, using empty fallback');
      sitemapData = {
        characters: {},
        tags: [],
        totalCharacters: 0,
        totalTags: 0,
        lastUpdated: new Date()
      };
    }
    
    const seoMetadata = generateSeoMetadata(request, '/sitemap', lang);
    return reply.renderWithGtm('sitemap.hbs', {
      title: `${translations.sitemap?.title || 'Sitemap'} | ${translations.seo.title}`,
      canonicalUrl: seoMetadata.canonicalUrl,
      alternates: seoMetadata.alternates,
      characters: sitemapData.characters,
      tags: sitemapData.tags,
      totalCharacters: sitemapData.totalCharacters,
      totalTags: sitemapData.totalTags,
      lastUpdated: sitemapData.lastUpdated,
      seo: [
        { name: 'description', content: translations.sitemap?.description || 'Complete sitemap of all characters and tags' },
        { name: 'keywords', content: `sitemap, characters, tags, ${translations.seo.keywords}` },
        { property: 'og:title', content: `${translations.sitemap?.title || 'Sitemap'} | ${translations.seo.title}` },
        { property: 'og:description', content: translations.sitemap?.description || 'Complete sitemap of all characters and tags' },
        { property: 'og:image', content: '/img/share.png' },
        { property: 'og:url', content: seoMetadata.canonicalUrl },
        { property: 'og:locale', content: lang },
        { property: 'og:locale:alternate', content: 'en' },
        { property: 'og:locale:alternate', content: 'fr' },
        { property: 'og:locale:alternate', content: 'ja' },
      ],
    });
  } catch (error) {
    console.error('[/sitemap] Error:', error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});

// Add robots.txt route before the existing routes
fastify.get('/robots.txt', async (request, reply) => {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || request.protocol || 'https';
  const baseUrl = `${protocol}://${request.hostname}`;
  
  const robotsTxt = `User-agent: *
Disallow: /api/
Disallow: /admin/
Disallow: /dashboard/
Disallow: /settings/
Disallow: /generate/
Disallow: /search
Disallow: /tags
Allow: /

Sitemap: ${baseUrl}/sitemap.xml`;

  reply.type('text/plain');
  return reply.send(robotsTxt);
});

// Legal routes - serve at both /legal/* and /* for backwards compatibility
const renderTermsPage = async (request, reply) => {
  try {
    const { translations, legalTranslations, lang } = request;
    
    return reply.renderWithGtm('legal/terms.hbs', {
      title: `${legalTranslations.terms?.title || 'Terms of Service'} | ${translations.seo.title}`,
      seo: [
        { name: 'description', content: `${legalTranslations.terms?.title || 'Terms of Service'} - ${translations.seo.description}` },
        { name: 'keywords', content: `terms, service, legal, ${translations.seo.keywords}` },
        { property: 'og:title', content: `${legalTranslations.terms?.title || 'Terms of Service'} | ${translations.seo.title}` },
        { property: 'og:description', content: `${legalTranslations.terms?.title || 'Terms of Service'} - ${translations.seo.description}` },
        { property: 'og:image', content: '/img/share.png' },
        { property: 'og:url', content: 'https://chatlamix/legal/terms' },
      ],
      translations,
      legalTranslations,
      lang,
      user: request.user,
      mode: process.env.MODE,
    });
  } catch (error) {
    console.error('[/legal/terms] Error:', error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
};

const renderPrivacyPage = async (request, reply) => {
  try {
    const { translations, legalTranslations, lang } = request;
    
    return reply.renderWithGtm('legal/privacy.hbs', {
      title: `${legalTranslations.privacy?.title || 'Privacy Policy'} | ${translations.seo.title}`,
      seo: [
        { name: 'description', content: `${legalTranslations.privacy?.title || 'Privacy Policy'} - ${translations.seo.description}` },
        { name: 'keywords', content: `privacy, policy, legal, ${translations.seo.keywords}` },
        { property: 'og:title', content: `${legalTranslations.privacy?.title || 'Privacy Policy'} | ${translations.seo.title}` },
        { property: 'og:description', content: `${legalTranslations.privacy?.title || 'Privacy Policy'} - ${translations.seo.description}` },
        { property: 'og:image', content: '/img/share.png' },
        { property: 'og:url', content: 'https://chatlamix/legal/privacy' },
      ],
      translations,
      legalTranslations,
      lang,
      user: request.user,
      mode: process.env.MODE,
    });
  } catch (error) {
    console.error('[/legal/privacy] Error:', error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
};

// Primary routes at /legal/*
fastify.get('/legal/terms', renderTermsPage);
fastify.get('/legal/privacy', renderPrivacyPage);

// Legacy routes at /* for backwards compatibility
fastify.get('/terms', renderTermsPage);
fastify.get('/privacy', renderPrivacyPage);

// 404 Not Found Handler - Custom error page
fastify.setNotFoundHandler(async (request, reply) => {
  try {
    const { translations, lang } = request;
    
    return reply.status(404).renderWithGtm('404.hbs', {
      title: `404 - ${translations.error_page?.title || 'Page Not Found'} | ${translations.seo?.title || 'Chatlamix'}`,
      seo: [
        { name: 'description', content: translations.error_page?.description || 'The page you are looking for could not be found.' },
        { name: 'robots', content: 'noindex, nofollow' },
        { property: 'og:title', content: `404 - ${translations.error_page?.title || 'Page Not Found'}` },
        { property: 'og:description', content: translations.error_page?.description || 'The page you are looking for could not be found.' },
        { property: 'og:image', content: '/img/share.png' },
      ],
      translations,
      lang,
      user: request.user,
      mode: process.env.MODE,
    });
  } catch (error) {
    console.error('[404 Handler] Error:', error);
    return reply.status(404).send({ error: 'Page not found' });
  }
});

const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    fastify.listen({ port, host: '0.0.0.0' }, (err, address) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      // Wait for cronjon logs to finish
      setTimeout(() => {
        console.log(`Fastify running → PORT http://${ip.address()}:${port}`);
      }, 3000);
    });
  } catch (err) {
    console.log(err);
    process.exit(1);
  }
};

start();
