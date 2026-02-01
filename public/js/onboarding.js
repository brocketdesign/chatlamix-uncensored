/**
 * Interactive Onboarding Funnel System
 * Guides new users through 7 key steps to maximize conversion
 */
class OnboardingFunnel {
    constructor() {
        this.currentStep = 0;
        this.totalSteps = 3; // Reduced from 4 to 3 (removed completion step)
        this.userData = {};
        this.translations = window.onboardingTranslations || {};
        this.userId = window.user?._id || window.userId;
        
        // If no translations loaded, try to load them
        if (Object.keys(this.translations).length === 0) {
            this.loadTranslations();
        }
    }

    // Load translations if not already available
    async loadTranslations() {
        try {
            // Get user's language preference or default to English
            const lang = window.user?.language || document.documentElement.lang || 'en';
            
            const response = await fetch(`/locales/onboarding-${lang}.json`);
            if (response.ok) {
                this.translations = await response.json();
                window.onboardingTranslations = this.translations;
            } else {
                this.translations = this.getFallbackTranslations();
            }
        } catch (error) {
            this.translations = this.getFallbackTranslations();
        }
    }

    // Fallback translations in case loading fails
    getFallbackTranslations() {
        return {
            welcome: "Welcome to Your AI Companion!",
            step1_intro: "Let's personalize your experience in just a few steps",
            create_persona: "Tell Us About Yourself",
            step2_intro: "Help us create your personal profile",
            character_preferences: "Your Character Preferences",
            step3_intro: "What kind of companions do you prefer?",
            select_character: "Choose Your First Companion",
            step4_intro: "Pick a character to start your adventure",
            onboarding_complete_notification: "Welcome! Your setup is complete and you're ready to start chatting!",
            continue: "Continue",
            back: "Back",
            start_chatting: "Start Chatting",
            nickname: "Nickname",
            nickname_placeholder: "How would you like to be called?",
            gender: "Gender",
            male: "Male",
            female: "Female",
            other: "Other",
            birthdate: "Birth Date"
        };
    }

    // Translation helper - simplified like chat-tool-settings.js
    t(key, fallback = key) {
        return this.translations[key] || fallback;
    }

    async start() {
        if (!this.userId) {
            return;
        }

        // Ensure translations are loaded before starting
        if (Object.keys(this.translations).length === 0) {
            await this.loadTranslations();
        }

        // Check if user has already completed onboarding
        const hasCompleted = localStorage.getItem(`onboarding_${this.userId}`);
        if (hasCompleted) {
            return;
        }

        this.showStep(0);
    }

    showStep(stepIndex) {
        this.currentStep = stepIndex;

        // Get the Bootstrap modal
        const modal = document.getElementById('onboardingModal');
        
        // Update progress bar
        this.updateProgressBar(stepIndex);
        
        // Generate step content
        const stepContent = this.getStepContent(stepIndex);
        
        // Update modal content
        this.updateModalContent(stepIndex, stepContent);
        
        // Add event listeners for this step
        this.bindStepEvents(stepIndex);
        
        // Show modal using Bootstrap
        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    }

    // Add new method to update progress bar
    updateProgressBar(stepIndex) {
        const progressBar = document.getElementById('onboardingProgressBar');
        if (!progressBar) {
            return;
        }

        // Calculate progress percentage (step 0 = 25%, step 1 = 50%, step 2 = 75%, step 3 = 100%)
        const progressPercentage = ((stepIndex + 1) / this.totalSteps) * 100;
        
        progressBar.style.width = progressPercentage + '%';
    }

    getStepContent(stepIndex) {
        // Get template from DOM
        const template = document.getElementById(`onboarding-step-${stepIndex}`);
        
        if (template) {
            // Use innerHTML directly since Handlebars placeholders get processed differently
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = template.innerHTML;
            
            // Replace translation placeholders with actual translations
            this.replaceTranslationsInHTML(tempDiv);
            
            const result = tempDiv.innerHTML;
            return result;
        }
        
        // If template not found, show error
        return `
            <div class="onboarding-content">
                <div class="text-center">
                    <p class="text-danger">Template not found for step ${stepIndex}</p>
                    <p>Make sure the onboarding-modals.hbs partial is included.</p>
                    <button class="btn btn-info" onclick="window.onboardingDebug.showDebugModal()">Debug Info</button>
                </div>
            </div>
        `;
    }

    // New method specifically for handling HTML with Handlebars-style placeholders
    replaceTranslationsInHTML(element) {
        // Get the HTML as string and replace placeholders
        let html = element.innerHTML;
        
        // Replace {{window.onboardingTranslations.key}} patterns in the HTML string
        html = html.replace(/\{\{window\.onboardingTranslations\.(\w+)\}\}/g, (match, key) => {
            const translation = this.t(key, `[MISSING: ${key}]`);
            return translation;
        });
        
        element.innerHTML = html;
        
        // Also handle any remaining text nodes that might have been missed
        this.replaceTranslations(element);
    }

    // Helper method to replace translation placeholders in DOM elements
    replaceTranslations(element) {
        // Handle text content in all elements including the root
        const allElements = [element, ...element.querySelectorAll('*')];
        
        allElements.forEach((el, index) => {
            // Process text content
            if (el.childNodes) {
                el.childNodes.forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        let text = node.textContent;
                        const originalText = text;
                        
                        // Replace {{window.onboardingTranslations.key}} patterns
                        text = text.replace(/\{\{window\.onboardingTranslations\.(\w+)\}\}/g, (match, key) => {
                            const translation = this.t(key, `[MISSING: ${key}]`);
                            return translation;
                        });
                        
                        if (originalText !== text) {
                            node.textContent = text;
                        }
                    }
                });
            }
            
            // Process attributes that might contain translations
            ['placeholder', 'title', 'alt'].forEach(attr => {
                if (el.hasAttribute && el.hasAttribute(attr)) {
                    let attrValue = el.getAttribute(attr);
                    const originalValue = attrValue;
                    
                    attrValue = attrValue.replace(/\{\{window\.onboardingTranslations\.(\w+)\}\}/g, (match, key) => {
                        const translation = this.t(key, `[MISSING: ${key}]`);
                        return translation;
                    });
                    
                    if (originalValue !== attrValue) {
                        el.setAttribute(attr, attrValue);
                    }
                }
            });
        });
    }

    updateModalContent(stepIndex, stepContent) {
        const contentContainer = document.getElementById('onboardingModalContent');
        const footerContainer = document.getElementById('onboardingModalFooter');
        
        if (!contentContainer || !footerContainer) {
            return;
        }

        // Clear previous content
        contentContainer.innerHTML = '';
        footerContainer.innerHTML = '';

        // Parse the step content to extract different sections
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = stepContent;
        
        // Extract footer buttons first
        const footerButtons = tempDiv.querySelector('.onboarding-footer-buttons');
        if (footerButtons) {
            // Move footer buttons to actual modal footer
            footerButtons.classList.remove('d-none');
            footerContainer.appendChild(footerButtons.cloneNode(true));
        }
        
        // For step 0 (welcome + personal info), handle it like other steps but with different structure
        if (stepIndex === 0) {
            // Step 0 has everything in .onboarding-welcome, treat it as the main content
            const welcomeContent = tempDiv.querySelector('.onboarding-welcome');
            if (welcomeContent) {
                // Remove footer buttons from content since they're now in modal footer
                const contentFooter = welcomeContent.querySelector('.onboarding-footer-buttons');
                if (contentFooter) {
                    contentFooter.remove();
                }
                contentContainer.innerHTML = welcomeContent.outerHTML;
            } else {
                contentContainer.innerHTML = stepContent;
            }
            return;
        }

        // For other steps (1, 2, 3), handle header/content structure
        const header = tempDiv.querySelector('.onboarding-header');
        const content = tempDiv.querySelector('.onboarding-content');

        // Add header if present
        if (header) {
            contentContainer.appendChild(header.cloneNode(true));
        }

        // Add content if present
        if (content) {
            contentContainer.appendChild(content.cloneNode(true));
        }
    }

    hideCurrentStep(callback) {
        const modal = document.getElementById('onboardingModal');
        if (modal) {
            const bootstrapModal = bootstrap.Modal.getInstance(modal);
            if (bootstrapModal) {
                bootstrapModal.hide();
            }
            // Wait for modal to hide before callback
            modal.addEventListener('hidden.bs.modal', function handler() {
                modal.removeEventListener('hidden.bs.modal', handler);
                if (callback) callback();
            });
        }
    }

    close() {
        const modal = document.getElementById('onboardingModal');
        if (modal) {
            const bootstrapModal = bootstrap.Modal.getInstance(modal);
            if (bootstrapModal) {
                bootstrapModal.hide();
            }
        }
    }

    bindStepEvents(stepIndex) {
        // Bind events specific to each step
        switch (stepIndex) {
            case 0:
                this.bindWelcomePersonalInfoEvents();
                break;
            case 1:
                this.bindPreferencesEvents();
                break;
            case 2:
                this.loadCharacterRecommendations();
                break;
        }
    }

    bindWelcomePersonalInfoEvents() {
        // Add small delay to ensure DOM is ready
        setTimeout(() => {
            // Nickname input
            const nicknameInput = document.getElementById('userNickname');
            if (nicknameInput) {
                nicknameInput.addEventListener('input', async (e) => {
                    this.userData.nickname = e.target.value.trim();
                    
                    // Update user in database if nickname is not empty
                    if (this.userData.nickname) {
                        await this.updateUserData({ nickname: this.userData.nickname });
                    }
                    this.validateStep0();
                });
            }

            // Gender selection (simplified to male/female only)
            document.querySelectorAll('.option-btn[data-gender]').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    document.querySelectorAll('.option-btn[data-gender]').forEach(b => b.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                    this.userData.gender = e.currentTarget.dataset.gender;
                    
                    // Update user in database
                    await this.updateUserData({ gender: this.userData.gender });
                    this.validateStep0();
                });
            });

            // Age selection
            document.querySelectorAll('.age-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    document.querySelectorAll('.age-btn').forEach(b => b.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                    this.userData.age = e.currentTarget.dataset.age;
                    
                    // Update user in database
                    await this.updateUserData({ ageRange: this.userData.age });
                    this.validateStep0();
                });
            });

            // Chat language selection
            document.querySelectorAll('.lang-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                    this.userData.preferredChatLanguage = e.currentTarget.dataset.lang;
                    
                    // Update user in database
                    await this.updateUserData({ preferredChatLanguage: this.userData.preferredChatLanguage });
                    this.validateStep0();
                });
            });
        }, 100);
    }

    bindPreferencesEvents() {
        // Add small delay to ensure DOM is ready
        setTimeout(() => {
            // Style selection
            document.querySelectorAll('.style-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    this.userData.preferredStyle = e.target.dataset.style;

                    // Update user in database
                    await this.updateUserData({ preferredImageStyle: this.userData.preferredStyle });
                    this.validateStep1();
                });
            });

            // Character gender selection
            document.querySelectorAll('.char-gender-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    document.querySelectorAll('.char-gender-btn').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    this.userData.preferredCharacterGender = e.target.dataset.charGender;

                    // Update user in database
                    await this.updateUserData({ preferredCharacterGender: this.userData.preferredCharacterGender });
                    this.validateStep1();
                });
            });

            // Character tags selection (multi-select)
            this.userData.selectedTags = this.userData.selectedTags || [];
            document.querySelectorAll('.tag-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const tag = e.target.dataset.tag;

                    if (e.target.classList.contains('active')) {
                        // Remove tag
                        e.target.classList.remove('active');
                        this.userData.selectedTags = this.userData.selectedTags.filter(t => t !== tag);
                    } else {
                        // Add tag
                        e.target.classList.add('active');
                        this.userData.selectedTags.push(tag);
                    }

                    // Update user in database
                    await this.updateUserData({ preferredTags: this.userData.selectedTags });
                });
            });
        }, 100);
    }

    // Add validation methods
    validateStep0() {
        const hasRequiredFields = this.userData.nickname && 
                                  this.userData.nickname.trim().length > 0 && 
                                  this.userData.gender && 
                                  this.userData.age &&
                                  this.userData.preferredChatLanguage;
        const continueBtn = document.querySelector('.btn-continue');
        if (continueBtn) {
            continueBtn.disabled = !hasRequiredFields;
        }
    }

    validateStep1() {
        const hasRequiredFields = this.userData.preferredStyle && this.userData.preferredCharacterGender;
        const continueBtn = document.querySelector('.btn-continue');
        if (continueBtn) {
            continueBtn.disabled = !hasRequiredFields;
        }
    }

    // Add real-time user update method
    async updateUserData(data) {
        if (!this.userId) {
            return;
        }

        try {
            const response = await fetch(`/user/onboarding-update/${this.userId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();
            if (result.success) {
                // User data updated successfully
            } else {
                // Failed to update user data
            }
        } catch (error) {
            // Error updating user data
        }
    }

    async loadCharacterRecommendations() {
        const container = document.getElementById('character-recommendations');
        if (!container) return;

        // Show loading spinner
        container.innerHTML = `
            <div class="loading-spinner d-flex justify-content-center align-items-center w-100" style="height: 200px;">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">${this.t('loading', 'Loading...')}</span>
                </div>
            </div>
        `;

        try {
            const params = new URLSearchParams({
                style: this.userData.preferredStyle || 'anime',
                gender: this.userData.preferredCharacterGender || 'female',
                limit: 10
            });

            // Add interests/tags if selected
            if (this.userData.selectedTags && this.userData.selectedTags.length > 0) {
                params.append('interests', this.userData.selectedTags.join(','));
            }

            console.log('Loading character recommendations with params:', params.toString());

            const response = await fetch(`/api/character-recommendations?${params}`);
            const data = await response.json();

            console.log('Character recommendations response:', data);

            if (data.success && data.characters && data.characters.length > 0) {
                this.renderCharacterRecommendations(data.characters);
            } else {
                // Show fallback message if no characters found
                container.innerHTML = `
                    <div class="text-center w-100 py-4">
                        <p class="text-muted">${this.t('no_characters_found', 'No characters found. Please try different preferences.')}</p>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error loading character recommendations:', error);
            container.innerHTML = `
                <div class="text-center w-100 py-4">
                    <p class="text-muted">${this.t('loading_error', 'Error loading characters. Please try again.')}</p>
                </div>
            `;
        }
    }

    renderCharacterRecommendations(characters) {
        const container = document.getElementById('character-recommendations');
        if (!container) return;

        // Clear existing content
        container.innerHTML = '';

        // Always use custom rendering to ensure proper click handling for onboarding
        // This avoids conflicts with displayChats which redirects to /character/ instead of /chat/
        characters.forEach(character => {
            const card = document.createElement('div');
            card.className = 'gallery-card onboarding-character-card';
            card.dataset.id = character._id;
            card.innerHTML = `
                <div class="card onboarding-character-card-inner">
                    <img src="${character.chatImageUrl || '/images/default-avatar.png'}"
                         class="onboarding-character-img"
                         alt="${character.name}"
                         onerror="this.src='/images/default-avatar.png'">
                    <div class="onboarding-character-overlay">
                        <h6 class="onboarding-character-name">${character.name}</h6>
                    </div>
                </div>
            `;
            card.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.selectCharacter(character._id);
            });
            container.appendChild(card);
        });
    }

    selectCharacter(characterId) {
        this.userData.selectedCharacter = characterId;

        // Remove selected class from all cards
        const container = document.getElementById('character-recommendations');
        if (container) {
            container.querySelectorAll('.gallery-card').forEach(card => {
                card.classList.remove('selected');
            });

            // Add selected class to the chosen card
            const selectedCard = container.querySelector(`[data-id="${characterId}"]`);
            if (selectedCard) {
                selectedCard.classList.add('selected');
            }
        }

        // Complete onboarding and redirect to chat
        this.completeAndStartChat(characterId);
    }

    nextStep() {
        // Collect data from current step
        this.collectStepData();
        
        if (this.currentStep < this.totalSteps - 1) {
            this.hideCurrentStep(() => {
                this.showStep(this.currentStep + 1);
            });
        } else {
            this.complete();
        }
    }

    prevStep() {
        if (this.currentStep > 0) {
            this.hideCurrentStep(() => {
                this.showStep(this.currentStep - 1);
            });
        }
    }

    collectStepData() {
        switch (this.currentStep) {
            case 0:
                // Data is already collected via event handlers
                break;
        }
    }

    async completeAndStartChat(characterId) {
        try {
            // Save onboarding data
            const response = await fetch('/user/onboarding-complete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId: this.userId,
                    onboardingData: this.userData,
                    completedAt: new Date().toISOString()
                })
            });

            if (response.ok) {
                // Mark as completed in localStorage
                localStorage.setItem(`onboarding_${this.userId}`, 'completed');

                // Close onboarding modal
                this.close();

                // Show brief notification
                if (typeof showNotification === 'function') {
                    showNotification(this.t('character_selected', 'Character selected! Starting your chat...'), 'success');
                }

                // Track chat start event
                if (typeof UserTracking !== 'undefined' && UserTracking.trackStartChat) {
                    UserTracking.trackStartChat(characterId, 'cold_onboarding', {
                        sourceElementId: null,
                        sourceElementClass: 'onboarding-character-select'
                    });
                }

                // Redirect to chat page with the selected character
                window.location.href = `/chat/${characterId}`;
            }
        } catch (error) {
            console.error('Error completing onboarding:', error);
            // Even if API fails, still redirect to chat
            localStorage.setItem(`onboarding_${this.userId}`, 'completed');
            // Track chat start event even on error
            if (typeof UserTracking !== 'undefined' && UserTracking.trackStartChat) {
                UserTracking.trackStartChat(characterId, 'cold_onboarding', {
                    sourceElementId: null,
                    sourceElementClass: 'onboarding-character-select'
                });
            }
            window.location.href = `/chat/${characterId}`;
        }
    }

    async complete() {
        try {
            // Save onboarding data
            const response = await fetch('/user/onboarding-complete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId: this.userId,
                    onboardingData: this.userData,
                    completedAt: new Date().toISOString()
                })
            });

            if (response.ok) {
                // Mark as completed in localStorage
                localStorage.setItem(`onboarding_${this.userId}`, 'completed');

                // Close onboarding
                this.close();

                // Show completion notification
                if (typeof showNotification === 'function') {
                    showNotification(this.t('onboarding_complete_notification', 'Welcome! Your setup is complete and you\'re ready to start chatting!'), 'success');
                }
            }
        } catch (error) {
            console.error('Error completing onboarding:', error);
        }
    }

    // Debug methods for testing from console
    debug = {
        // Test specific step
        showStep: (stepIndex) => {
            this.showStep(stepIndex);
        },
        
        // Show debug modal with translation info
        showDebugModal: () => {
            const debugContent = `
                <div class="debug-info">
                    <h5>Debug Information</h5>
                    <div class="mb-3">
                        <strong>Translations Available:</strong> ${Object.keys(this.translations).length > 0 ? 'Yes' : 'No'}<br>
                        <strong>Translation Keys:</strong> ${Object.keys(this.translations).length}<br>
                        <strong>User ID:</strong> ${this.userId}<br>
                        <strong>Current Step:</strong> ${this.currentStep}
                    </div>
                    
                    <div class="mb-3">
                        <strong>Sample Translations:</strong><br>
                        <code>welcome: "${this.t('welcome', 'NOT_FOUND')}"</code><br>
                        <code>continue: "${this.t('continue', 'NOT_FOUND')}"</code><br>
                        <code>skip: "${this.t('skip', 'NOT_FOUND')}"</code>
                    </div>
                    
                    <div class="mb-3">
                        <strong>Templates Found:</strong><br>
                        ${Array.from({length: 5}, (_, i) => {
                            const template = document.getElementById(`onboarding-step-${i}`);
                            return `<code>Step ${i}: ${template ? 'Found' : 'Missing'}</code><br>`;
                        }).join('')}
                    </div>
                    
                    <div class="mb-3">
                        <strong>Window Objects:</strong><br>
                        <code>window.onboardingTranslations: ${window.onboardingTranslations ? 'Available' : 'Missing'}</code><br>
                        <code>window.user: ${window.user ? 'Available' : 'Missing'}</code>
                    </div>
                    
                    <button class="btn btn-primary" onclick="window.onboardingDebug.testTranslations()">Test Translations</button>
                    <button class="btn btn-secondary" onclick="window.onboardingDebug.testTemplate(0)">Test Template 0</button>
                </div>
            `;
            
            // Update modal with debug content
            document.getElementById('onboardingModalLabel').textContent = 'Debug Information';
            document.getElementById('onboardingModalSubtitle').textContent = 'Onboarding System Debug';
            document.getElementById('onboardingModalContent').innerHTML = debugContent;
            document.getElementById('onboardingModalFooter').innerHTML = `
                <button type="button" class="btn btn-secondary" onclick="window.onboardingDebug.reset()">Reset</button>
                <button type="button" class="btn btn-primary" onclick="window.onboardingFunnel.close()">Close</button>
            `;
            
            // Show modal
            const modal = document.getElementById('onboardingModal');
            const bootstrapModal = new bootstrap.Modal(modal);
            bootstrapModal.show();
        },
        
        // Test template extraction with more details
        testTemplate: (stepIndex) => {
            const template = document.getElementById(`onboarding-step-${stepIndex}`);
            
            if (template) {
                // Test raw HTML replacement
                const testDiv = document.createElement('div');
                testDiv.innerHTML = template.innerHTML;
                
                // Test our replacement function
                const testHtml = testDiv.innerHTML.replace(/\{\{window\.onboardingTranslations\.(\w+)\}\}/g, (match, key) => {
                    const translation = this.t(key, `[MISSING: ${key}]`);
                    return translation;
                });
            }
            
            const content = this.getStepContent(stepIndex);
            return content;
        },
        
        // Test all steps sequentially
        testAllSteps: () => {
            for (let i = 0; i < this.totalSteps; i++) {
                setTimeout(() => {
                    this.close();
                    setTimeout(() => this.showStep(i), 100);
                }, i * 2000);
            }
        },
        
        // Force start onboarding
        forceStart: async () => {
            localStorage.removeItem(`onboarding_${this.userId}`);
            await this.start();
        },
        
        // Check current state
        getState: () => {
            return {
                currentStep: this.currentStep,
                totalSteps: this.totalSteps,
                userData: this.userData,
                userId: this.userId,
                translations: Object.keys(this.translations).length > 0 ? 'loaded' : 'empty',
                translationKeys: Object.keys(this.translations),
                windowTranslations: window.onboardingTranslations ? 'available' : 'missing',
                templatesFound: Array.from({length: 5}, (_, i) => {
                    return document.getElementById(`onboarding-step-${i}`) ? `step-${i}` : null;
                }).filter(Boolean)
            };
        },
        
        // Test translation function
        testTranslations: () => {
            const testKeys = ['welcome', 'continue', 'back', 'onboarding_complete', 'create_persona'];
            testKeys.forEach(key => {
                this.t(key);
            });
            
            // Log template content for debugging
            const template0 = document.getElementById('onboarding-step-0');
            if (template0) {
                // template0.innerHTML is available
            }
        },
        
        // Force reload translations
        async reloadTranslations() {
            await this.loadTranslations();
        },
        
        // Reset onboarding state
        reset: () => {
            localStorage.removeItem(`onboarding_${this.userId}`);
            this.close();
            this.currentStep = 0;
            this.userData = {};
        }
    };
}

// Initialization and style injection
document.addEventListener('DOMContentLoaded', () => {
    // Check if user should see onboarding
    const user = window.user;
    if (user && !user.isTemporary && user.firstTime !== false) {
        window.onboardingFunnel = new OnboardingFunnel();
        // Auto-start onboarding for first-time users
        setTimeout(() => {
            window.onboardingFunnel.start();
        }, 1000);
    } else {
        // Initialize for manual restart
        window.onboardingFunnel = new OnboardingFunnel();
    }
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OnboardingFunnel;
}

// Make debug methods available globally
window.onboardingDebug = {
    showStep: (stepIndex) => window.onboardingFunnel?.debug.showStep(stepIndex),
    showDebugModal: () => window.onboardingFunnel?.debug.showDebugModal(),
    testTemplate: (stepIndex) => window.onboardingFunnel?.debug.testTemplate(stepIndex),
    testAllSteps: () => window.onboardingFunnel?.debug.testAllSteps(),
    forceStart: () => window.onboardingFunnel?.debug.forceStart(),
    getState: () => window.onboardingFunnel?.debug.getState(),
    testTranslations: () => window.onboardingFunnel?.debug.testTranslations(),
    reloadTranslations: () => window.onboardingFunnel?.debug.reloadTranslations(),
    reset: () => window.onboardingFunnel?.debug.reset(),
    help: () => {
        console.log(`
🛠️ ONBOARDING DEBUG COMMANDS

Test individual steps:
  onboardingDebug.showStep(0)      // Show welcome step
  onboardingDebug.testTemplate(0)  // Test template extraction for step 0
  onboardingDebug.showDebugModal() // Show debug information modal

Test all steps automatically:
  onboardingDebug.testAllSteps()   // Cycles through all steps with 2s delays

Force start onboarding (ignores completion status):
  onboardingDebug.forceStart()     // Removes localStorage flag and starts

Check current state:
  onboardingDebug.getState()       // Returns current step, userData, etc.

Test translations:
  onboardingDebug.testTranslations() // Shows translated text for key elements

Reset everything:
  onboardingDebug.reset()          // Clears localStorage, closes modal, resets state

💡 TIP: Try "onboardingDebug.showDebugModal()" to see all debug info in a modal
        `);
    }
};