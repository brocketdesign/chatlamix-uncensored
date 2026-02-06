/**
 * Chat Onboarding System
 * For users arriving from social media links with a specific character/chat ID.
 * Collects user info, preferences, then authenticates via Clerk before redirecting to chat.
 */

class ChatOnboarding {
    constructor() {
        this.currentStep = 1;
        this.totalSteps = 4;
        this.translations = window.chatOnboardingTranslations || {};
        this.lang = window.lang || 'en';
        this.chatData = window.chatOnboardingData || {};
        
        // Map short lang codes to full language names
        const langCodeMap = {
            'en': 'english', 'fr': 'french', 'ja': 'japanese', 'hi': 'hindi',
            'pt': 'portuguese', 'es': 'spanish', 'zh': 'chinese', 'ko': 'korean',
            'th': 'thai', 'de': 'german', 'it': 'italian', 'ru': 'russian'
        };
        
        // User data collected throughout the flow
        this.userData = {
            nickname: '',
            gender: '',
            ageRange: '',
            chatLanguage: langCodeMap[this.lang] || 'english',
            interests: [],
            source: 'chat-onboarding',
            sourceChatId: this.chatData.chatId
        };
        
        // Clerk instance
        this.clerk = null;
        
        this.init();
    }
    
    /**
     * Initialize the onboarding flow
     */
    async init() {
        this.loadSavedData();
        
        // If this is an SSO callback, skip to step 4 so the mounted sign-up component
        // can process the #/sso-callback hash and complete the OAuth flow
        const isSSOCallback = window.location.hash.includes('/sso-callback');
        if (isSSOCallback) {
            console.log('[ChatOnboarding] SSO callback detected, jumping to auth step');
            this.currentStep = 4;
        }
        
        this.bindEvents();
        this.preselectDefaults();
        this.updateUI();
        
        // Mount Clerk sign-up on step 4 (handles SSO callback automatically)
        if (this.currentStep === 4) {
            await this.initAuthStep();
        }
        
        console.log('[ChatOnboarding] Initialized for chat:', this.chatData.chatId);
    }
    
    /**
     * Pre-select default values in the UI (e.g., language based on browser lang)
     */
    preselectDefaults() {
        // Pre-select default language button if none selected yet
        if (this.userData.chatLanguage) {
            const langBtn = document.querySelector(`#chatLanguagePills .lang-btn[data-lang="${this.userData.chatLanguage}"]`);
            if (langBtn && !document.querySelector('#chatLanguagePills .lang-btn.selected')) {
                langBtn.classList.add('selected');
            }
        }
    }
    
    /**
     * Translation helper with nested key support
     */
    t(key, fallback) {
        const keys = key.split('.');
        let value = this.translations;
        
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return fallback || key;
            }
        }
        
        return value || fallback || key;
    }
    
    /**
     * Wait for and initialize Clerk
     */
    async initClerk() {
        try {
            await this.waitForClerk();
            
            if (window.Clerk) {
                this.clerk = window.Clerk;
                console.log('[ChatOnboarding] Clerk ready');
            } else {
                console.warn('[ChatOnboarding] Clerk not available');
            }
        } catch (error) {
            console.error('[ChatOnboarding] Clerk init failed:', error);
        }
    }
    
    /**
     * Wait for Clerk to be available
     */
    async waitForClerk() {
        return new Promise((resolve) => {
            if (window.Clerk) { resolve(); return; }
            
            const maxWait = 10000;
            const startTime = Date.now();
            
            const checkClerk = setInterval(() => {
                if (window.Clerk) {
                    clearInterval(checkClerk);
                    resolve();
                } else if (Date.now() - startTime > maxWait) {
                    clearInterval(checkClerk);
                    resolve();
                }
            }, 100);
        });
    }
    
    /**
     * Bind all event listeners
     */
    bindEvents() {
        // Navigation
        document.getElementById('beginBtn')?.addEventListener('click', () => this.nextStep());
        document.getElementById('nextBtn')?.addEventListener('click', () => this.nextStep());
        document.getElementById('backBtn')?.addEventListener('click', () => this.prevStep());
        
        // Step 2: About You
        document.getElementById('userNickname')?.addEventListener('input', (e) => {
            this.userData.nickname = e.target.value.trim();
            this.saveData();
        });
        
        // Gender pills
        document.querySelectorAll('#genderPills .option-pill').forEach(pill => {
            pill.addEventListener('click', (e) => {
                document.querySelectorAll('#genderPills .option-pill').forEach(p => p.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                this.userData.gender = e.currentTarget.dataset.value;
                this.saveData();
            });
        });
        
        // Age pills
        document.querySelectorAll('#agePills .option-pill').forEach(pill => {
            pill.addEventListener('click', (e) => {
                document.querySelectorAll('#agePills .option-pill').forEach(p => p.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                this.userData.ageRange = e.currentTarget.dataset.value;
                this.saveData();
            });
        });
        
        // Language flag buttons
        document.querySelectorAll('#chatLanguagePills .lang-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('#chatLanguagePills .lang-btn').forEach(b => b.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                this.userData.chatLanguage = e.currentTarget.dataset.lang;
                this.saveData();
            });
        });
        
        // Step 3: Interest tags (multi-select)
        document.querySelectorAll('#interestTags .tag-pill').forEach(tag => {
            tag.addEventListener('click', (e) => {
                e.currentTarget.classList.toggle('selected');
                this.updateInterests();
                this.saveData();
            });
        });
        
        // Step 4: Fallback auth
        document.getElementById('emailSignupForm')?.addEventListener('submit', (e) => this.handleEmailSignup(e));
        document.getElementById('googleSignInBtn')?.addEventListener('click', () => this.handleGoogleSignIn());
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.currentStep > 1 && this.currentStep < 4) {
                this.nextStep();
            }
        });
    }
    
    /**
     * Update interests array from selected tags
     */
    updateInterests() {
        this.userData.interests = [];
        document.querySelectorAll('#interestTags .tag-pill.selected').forEach(tag => {
            this.userData.interests.push(tag.dataset.tag);
        });
    }
    
    /**
     * Navigate to next step
     */
    nextStep() {
        if (!this.validateCurrentStep()) return;
        
        if (this.currentStep < this.totalSteps) {
            this.currentStep++;
            this.updateUI();
            this.saveData();
            
            // Auto-save user data to server at step transitions
            this.saveProgressToServer();
            
            // Mount Clerk on step 4
            if (this.currentStep === 4) {
                this.initAuthStep();
            }
        }
    }
    
    /**
     * Navigate to previous step
     */
    prevStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.updateUI();
        }
    }
    
    /**
     * Validate current step
     */
    validateCurrentStep() {
        switch (this.currentStep) {
            case 1:
                return true; // Welcome step, always valid
            case 2:
                if (!this.userData.nickname?.trim()) {
                    this.showError(this.t('errors.enter_nickname'));
                    document.getElementById('userNickname')?.focus();
                    return false;
                }
                if (!this.userData.gender) {
                    this.showError(this.t('errors.select_gender'));
                    return false;
                }
                if (!this.userData.ageRange) {
                    this.showError(this.t('errors.select_age'));
                    return false;
                }
                return true;
            case 3:
                return true; // Preferences are optional
            default:
                return true;
        }
    }
    
    /**
     * Update the UI for the current step
     */
    updateUI() {
        // Progress bar
        const progress = (this.currentStep / this.totalSteps) * 100;
        document.getElementById('progressBar').style.width = `${progress}%`;
        
        // Step indicator
        document.querySelector('.current-step').textContent = this.currentStep;
        
        // Show/hide steps with animation
        document.querySelectorAll('.step-slide').forEach(slide => {
            const stepNum = parseInt(slide.dataset.step);
            slide.classList.remove('active', 'prev', 'next');
            
            if (stepNum === this.currentStep) {
                slide.classList.add('active');
            } else if (stepNum < this.currentStep) {
                slide.classList.add('prev');
            } else {
                slide.classList.add('next');
            }
        });
        
        // Navigation buttons
        const backBtn = document.getElementById('backBtn');
        const nextBtn = document.getElementById('nextBtn');
        const footer = document.getElementById('onboardingFooter');
        
        // Step 1: hide footer (has its own begin button)
        if (this.currentStep === 1) {
            footer.style.display = 'none';
        } else {
            footer.style.display = 'flex';
        }
        
        backBtn.style.visibility = this.currentStep > 1 ? 'visible' : 'hidden';
        
        // Hide next button on auth step
        if (this.currentStep === this.totalSteps) {
            nextBtn.style.display = 'none';
        } else {
            nextBtn.style.display = 'flex';
        }
        
        // Scroll to top
        document.querySelector('.step-slide.active .step-content')?.scrollTo(0, 0);
    }
    
    /**
     * Initialize the authentication step (Step 4)
     */
    async initAuthStep() {
        await this.waitForClerk();
        
        const clerk = this.clerk || window.Clerk;
        
        if (clerk) {
            const container = document.getElementById('clerk-auth-container');
            const chatId = this.chatData.chatId;
            
            // Bind direct Google OAuth button
            document.getElementById('directGoogleBtn')?.addEventListener('click', () => {
                this.startOAuth('oauth_google');
            });
            
            try {
                await clerk.mountSignUp(container, {
                    afterSignUpUrl: `/chat/${chatId}?source=chat-onboarding&status=success`,
                    afterSignInUrl: `/chat/${chatId}?source=chat-onboarding&status=success`,
                    redirectUrl: `/chat/${chatId}?source=chat-onboarding&status=success`,
                    signInUrl: '/login',
                    appearance: {
                        variables: {
                            colorPrimary: '#8240FF',
                            colorBackground: 'rgba(26, 26, 26, 0.9)',
                            colorText: '#ffffff',
                            colorTextSecondary: '#aeb0b4',
                            colorInputBackground: 'rgba(255, 255, 255, 0.05)',
                            colorInputText: '#ffffff',
                            borderRadius: '12px'
                        },
                        elements: {
                            card: {
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                backdropFilter: 'blur(10px)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '15px',
                                boxShadow: '0 8px 32px rgba(110, 32, 244, 0.15)'
                            },
                            formButtonPrimary: {
                                background: 'linear-gradient(90.9deg, #D2B8FF 2.74%, #8240FF 102.92%)',
                                border: 'none',
                                fontWeight: '600'
                            },
                            formFieldInput: {
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '12px'
                            },
                            // Hide the built-in social buttons since we have our own
                            socialButtons: {
                                display: 'none'
                            },
                            socialButtonsBlockButton: {
                                display: 'none'
                            },
                            socialButtonsProviderIcon: {
                                display: 'none'
                            },
                            dividerRow: {
                                display: 'none'
                            },
                            footer: {
                                display: 'none'
                            }
                        }
                    }
                });
                
                // Listen for auth completion
                clerk.addListener(({ user }) => {
                    if (user) {
                        this.onAuthComplete(user);
                    }
                });
            } catch (error) {
                console.error('[ChatOnboarding] Failed to mount Clerk:', error);
                if (window.showFallbackAuth) window.showFallbackAuth();
            }
        } else {
            if (window.showFallbackAuth) window.showFallbackAuth();
        }
    }
    
    /**
     * Handle Google sign-in (fallback)
     */
    handleGoogleSignIn() {
        this.startOAuth('oauth_google');
    }
    
    /**
     * Start OAuth flow directly (single click)
     */
    async startOAuth(strategy) {
        const clerk = this.clerk || window.Clerk;
        if (!clerk) {
            this.showError(this.t('errors.auth_failed'));
            return;
        }
        
        // Disable the button and show spinner to prevent double clicks
        const btn = document.getElementById('directGoogleBtn');
        if (btn) {
            btn.disabled = true;
            btn.classList.add('loading');
            const label = btn.querySelector('span');
            if (label) label.textContent = '';
        }
        
        try {
            // Save onboarding data before leaving the page for OAuth
            this.saveData();
            await this.saveProgressToServer();
            
            // Both redirectUrl and redirectUrlComplete point back to THIS page.
            // After OAuth completes, user lands here with Clerk session active,
            // handleClerkAuth() fires → onAuthComplete() syncs data → redirects to chat.
            const currentUrl = window.location.origin + window.location.pathname;
            
            await clerk.client.signUp.authenticateWithRedirect({
                strategy: strategy,
                redirectUrl: currentUrl,
                redirectUrlComplete: currentUrl
            });
        } catch (error) {
            console.error('[ChatOnboarding] OAuth signUp error:', error);
            // If signUp fails (user already exists), try signIn
            try {
                const currentUrl = window.location.origin + window.location.pathname;
                await clerk.client.signIn.authenticateWithRedirect({
                    strategy: strategy,
                    redirectUrl: currentUrl,
                    redirectUrlComplete: currentUrl
                });
            } catch (signInError) {
                console.error('[ChatOnboarding] OAuth signIn fallback error:', signInError);
                // Re-enable button on error
                if (btn) {
                    btn.disabled = false;
                    btn.classList.remove('loading');
                    const label = btn.querySelector('span');
                    if (label) label.textContent = this.t('step4.google_button', 'Continue with Google');
                }
                this.showError(this.t('errors.auth_failed'));
            }
        }
    }
    
    /**
     * Handle email sign-up (fallback)
     */
    async handleEmailSignup(e) {
        e.preventDefault();
        
        const email = document.getElementById('signupEmail').value;
        const password = document.getElementById('signupPassword').value;
        const termsAgree = document.getElementById('termsAgree').checked;
        
        if (!termsAgree) {
            this.showError(this.t('errors.agree_terms'));
            return;
        }
        
        if (password.length < 8) {
            this.showError(this.t('errors.password_short'));
            return;
        }
        
        this.showLoading();
        
        const clerk = this.clerk || window.Clerk;
        
        try {
            if (clerk) {
                const result = await clerk.client.signUp.create({
                    emailAddress: email,
                    password: password
                });
                
                if (result.status === 'complete') {
                    await clerk.setActive({ session: result.createdSessionId });
                    this.onAuthComplete(clerk.user);
                } else {
                    console.log('[ChatOnboarding] Additional verification needed');
                    this.hideLoading();
                }
            } else {
                this.hideLoading();
                this.showError(this.t('errors.auth_failed'));
            }
        } catch (error) {
            console.error('[ChatOnboarding] Registration error:', error);
            this.hideLoading();
            this.showError(error.message || this.t('errors.auth_failed'));
        }
    }
    
    /**
     * Called after successful authentication
     * Saves user data and redirects to the target chat
     */
    async onAuthComplete(user) {
        // Prevent double execution (can be called from multiple listeners)
        if (this._authCompleting) return;
        this._authCompleting = true;
        
        console.log('[ChatOnboarding] Auth complete, saving user data...');
        this.showLoading();
        
        const chatId = this.chatData.chatId;
        const clerkUser = window.Clerk?.user;
        const clerkId = clerkUser?.id;
        
        if (!clerkId) {
            console.error('[ChatOnboarding] No Clerk user ID available');
            this.hideLoading();
            return;
        }
        
        try {
            // 1. Sync Clerk user data — this creates the user if new AND sets the JWT cookie
            const authResponse = await fetch('/user/clerk-auth', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'x-clerk-user-id': clerkId,
                },
                credentials: 'include',
            });
            
            if (!authResponse.ok) {
                const errText = await authResponse.text();
                console.error('[ChatOnboarding] clerk-auth failed:', authResponse.status, errText);
            } else {
                const authData = await authResponse.json();
                console.log('[ChatOnboarding] User synced successfully:', authData);
            }
            
            // 2. Save onboarding user data (nickname, gender, language, interests)
            // Send clerkId as fallback in case JWT cookie isn't available yet
            const saveResponse = await fetch('/api/chat-onboarding/save-user-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    userData: this.userData,
                    chatId: chatId,
                    clerkId: clerkId
                })
            });
            
            if (!saveResponse.ok) {
                const errText = await saveResponse.text();
                console.error('[ChatOnboarding] save-user-data failed:', saveResponse.status, errText);
            } else {
                const saveData = await saveResponse.json();
                console.log('[ChatOnboarding] Onboarding data saved successfully:', saveData);
            }
            
            // 3. Clear saved data
            this.clearSavedData();
            
            // 4. Redirect to the chat
            window.location.href = `/chat/${chatId}?source=chat-onboarding&status=success`;
            
        } catch (error) {
            console.error('[ChatOnboarding] Error saving data:', error);
            // Redirect anyway - user is authenticated
            this.clearSavedData();
            window.location.href = `/chat/${chatId}`;
        }
    }
    
    /**
     * Save onboarding progress to server
     */
    async saveProgressToServer() {
        try {
            await fetch('/api/chat-onboarding/save-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    userData: this.userData,
                    currentStep: this.currentStep,
                    chatId: this.chatData.chatId,
                    sessionId: this.getSessionId()
                })
            });
        } catch (error) {
            console.error('[ChatOnboarding] Failed to save progress:', error);
        }
    }
    
    /**
     * Get or create a session ID for tracking
     */
    getSessionId() {
        let sessionId = sessionStorage.getItem('chatOnboardingSessionId');
        if (!sessionId) {
            sessionId = 'co_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
            sessionStorage.setItem('chatOnboardingSessionId', sessionId);
        }
        return sessionId;
    }
    
    /**
     * Show error toast
     */
    showError(message) {
        const toast = document.createElement('div');
        toast.className = 'error-toast';
        toast.innerHTML = `<i class="bi bi-exclamation-circle"></i><span>${message}</span>`;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    /**
     * Show loading overlay
     */
    showLoading() {
        document.getElementById('loadingOverlay').style.display = 'flex';
    }
    
    /**
     * Hide loading overlay
     */
    hideLoading() {
        document.getElementById('loadingOverlay').style.display = 'none';
    }
    
    /**
     * Save data to sessionStorage
     */
    saveData() {
        sessionStorage.setItem('chatOnboarding', JSON.stringify({
            userData: this.userData,
            currentStep: this.currentStep
        }));
    }
    
    /**
     * Load saved data from sessionStorage
     */
    loadSavedData() {
        try {
            const saved = sessionStorage.getItem('chatOnboarding');
            if (saved) {
                const data = JSON.parse(saved);
                // Only restore if same chat
                if (data.userData?.sourceChatId === this.chatData.chatId) {
                    this.userData = { ...this.userData, ...data.userData };
                    this.currentStep = data.currentStep || 1;
                    this.restoreUIState();
                }
            }
        } catch (error) {
            console.error('[ChatOnboarding] Failed to load saved data:', error);
        }
    }
    
    /**
     * Restore UI state from saved data
     */
    restoreUIState() {
        // Nickname
        const nicknameInput = document.getElementById('userNickname');
        if (nicknameInput && this.userData.nickname) {
            nicknameInput.value = this.userData.nickname;
        }
        
        // Gender
        if (this.userData.gender) {
            const genderPill = document.querySelector(`#genderPills .option-pill[data-value="${this.userData.gender}"]`);
            if (genderPill) {
                document.querySelectorAll('#genderPills .option-pill').forEach(p => p.classList.remove('selected'));
                genderPill.classList.add('selected');
            }
        }
        
        // Age
        if (this.userData.ageRange) {
            const agePill = document.querySelector(`#agePills .option-pill[data-value="${this.userData.ageRange}"]`);
            if (agePill) {
                document.querySelectorAll('#agePills .option-pill').forEach(p => p.classList.remove('selected'));
                agePill.classList.add('selected');
            }
        }
        
        // Language
        if (this.userData.chatLanguage) {
            const langBtn = document.querySelector(`#chatLanguagePills .lang-btn[data-lang="${this.userData.chatLanguage}"]`);
            if (langBtn) {
                document.querySelectorAll('#chatLanguagePills .lang-btn').forEach(b => b.classList.remove('selected'));
                langBtn.classList.add('selected');
            }
        }
        
        // Interests
        if (this.userData.interests?.length) {
            this.userData.interests.forEach(tag => {
                const tagPill = document.querySelector(`#interestTags .tag-pill[data-tag="${tag}"]`);
                if (tagPill) tagPill.classList.add('selected');
            });
        }
        
        console.log('[ChatOnboarding] UI state restored');
    }
    
    /**
     * Clear saved data
     */
    clearSavedData() {
        sessionStorage.removeItem('chatOnboarding');
        sessionStorage.removeItem('chatOnboardingSessionId');
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    window.chatOnboarding = new ChatOnboarding();
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatOnboarding;
}
