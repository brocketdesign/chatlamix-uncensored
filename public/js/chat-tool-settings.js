class ChatToolSettings {
    constructor() {
        this.settings = {};
        this.isLoading = false;
        this.userId = window.userId || window.user?.id;
        this.minimaxVoices = [];
        this.premiumVoices = [];
        this.availableModels = {};
        this.isPremium = false;
        this.translations = window.chatToolSettingsTranslations || {};
        this.onFirstTimeClose = null;
        this.normalCloseCallback = null;
        this.speechToTextTranslations = window.speechToTextTranslations || {};
        
        // Voice samples
        this.voiceSamples = null;
        this.audioPlayer = null;
        this.currentPlayingVoice = null;
        this.lang = window.lang || 'en';
        
        this.init();
    }

    // Add speech-to-text translation method
    speechT(key, fallback = key) {
        if (key.includes('.')) {
            const keys = key.split('.');
            let value = this.speechToTextTranslations;
            
            for (const k of keys) {
                if (value && typeof value === 'object' && k in value) {
                    value = value[k];
                } else {
                    return fallback;
                }
            }
            
            return value || fallback;
        }
        
        return this.speechToTextTranslations[key] || fallback;
    }   
    // Translation method
    t(key, fallback = key) {
        if (key.includes('.')) {
            const keys = key.split('.');
            let value = this.translations;
            
            for (const k of keys) {
                if (value && typeof value === 'object' && k in value) {
                    value = value[k];
                } else {
                    return fallback;
                }
            }
            
            return value || fallback;
        }
        
        return this.translations[key] || fallback;
    }

    async init() {
        this.bindEvents();
        this.setupRangeSliders();
        
        // Initialize audio player
        this.audioPlayer = document.getElementById('voiceSamplePlayer');
        if (this.audioPlayer) {
            this.audioPlayer.addEventListener('ended', () => this.onAudioEnded());
            this.audioPlayer.addEventListener('error', () => this.onAudioEnded());
        }
        
        // Load voice samples manifest
        await this.loadVoiceSamples();
    }

    bindEvents() {
        // Settings toggle button
        const settingsToggle = document.getElementById('settings-toggle');
        if (settingsToggle) {
            settingsToggle.addEventListener('click', () => this.openModal());
        }

        // Close modal events
        const closeBtn = document.getElementById('settings-close-btn');
        const overlay = document.getElementById('settings-modal-overlay');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeModal());
        }
        
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.closeModal();
                }
            });
        }

        // Save settings button
        const saveBtn = document.getElementById('settings-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSettings());
        }

        // Quick navigation buttons
        document.addEventListener('click', (e) => {
            const navBtn = e.target.closest('.settings-quick-nav-btn');
            if (!navBtn) {
                return;
            }

            e.preventDefault();

            const targetSelector = navBtn.dataset.target;
            const modalBody = document.querySelector('.settings-modal-body');
            if (!modalBody || !targetSelector) {
                return;
            }

            const targetSection = modalBody.querySelector(targetSelector);
            if (!targetSection) {
                return;
            }

            document.querySelectorAll('.settings-quick-nav-btn').forEach(btn => btn.classList.remove('active'));
            navBtn.classList.add('active');

            modalBody.scrollTo({
                top: targetSection.offsetTop - 12,
                behavior: 'smooth'
            });
        });

        // Voice selection - Use event delegation for voice cards
        document.addEventListener('click', (e) => {
            const voiceCard = e.target.closest('.voice-card');
            if (voiceCard && !e.target.closest('.play-sample-btn')) {
                if (voiceCard.classList.contains('settings-premium-voice-option')) {
                    this.selectPremiumVoice(voiceCard);
                } else {
                    this.selectVoice(voiceCard);
                }
            }
        });

        // Play sample button - Use event delegation
        document.addEventListener('click', (e) => {
            const playBtn = e.target.closest('.play-sample-btn');
            if (playBtn) {
                e.stopPropagation();
                const voiceKey = playBtn.dataset.voice;
                const provider = playBtn.dataset.provider || 'minimax';
                this.playVoiceSample(voiceKey, provider);
            }
        });

        // Dynamic model selection - Use event delegation
        document.addEventListener('click', (e) => {
            if (e.target.closest('.settings-model-option')) {
                this.selectModel(e.target.closest('.settings-model-option'));
            }
        });


        // Voice provider switch - Allow switching for all users
        const voiceProviderSwitch = document.getElementById('voice-provider-switch');
        if (voiceProviderSwitch) {
            voiceProviderSwitch.addEventListener('change', (e) => {
                const user = window.user || {};
                const subscriptionStatus = user.subscriptionStatus === 'active';
                const isSwitchingToPremium = e.target.checked;
                
                this.settings.voiceProvider = isSwitchingToPremium ? 'premium' : 'standard';
                
                // If free user is switching to premium, clear any premium voice selection
                // This prevents auto-selection of the first voice
                if (isSwitchingToPremium && !subscriptionStatus) {
                    // Clear premium voice selection for free users
                    if (this.settings.minimaxVoice) {
                        this.settings.minimaxVoice = null;
                    }
                    if (this.settings.premiumVoice) {
                        this.settings.premiumVoice = null;
                    }
                }
                
                this.toggleVoiceProviderUI();
                this.updateSwitchLabels();
            });
        }

        // Auto merge face switch
        const autoMergeFaceSwitch = document.getElementById('auto-merge-face-switch');
        if (autoMergeFaceSwitch) {
            autoMergeFaceSwitch.addEventListener('change', (e) => {
                const user = window.user || {};
                const subscriptionStatus = user.subscriptionStatus === 'active';
                
                // Check if user is trying to enable auto merge face without subscription
                if (!subscriptionStatus && e.target.checked) {
                    // Reset to false and show upgrade popup
                    e.target.checked = false;
                    this.settings.autoMergeFace = false;
                    
                    // Show plan page for upgrade
                    if (typeof loadPlanPage === 'function') {
                        loadPlanPage();
                    } else {
                        window.location.href = '/plan';
                    }
                    return;
                }
                
                this.settings.autoMergeFace = e.target.checked;
            });
        }

        // Auto image generation switch
        const autoImageGenerationSwitch = document.getElementById('auto-image-generation-switch');
        if (autoImageGenerationSwitch) {
            autoImageGenerationSwitch.addEventListener('change', (e) => {
                const user = window.user || {};
                const subscriptionStatus = user.subscriptionStatus === 'active';
                
                // Check if user is trying to enable auto image generation without subscription
                if (!subscriptionStatus && e.target.checked) {
                    // Reset to false and show upgrade popup
                    e.target.checked = false;
                    this.settings.autoImageGeneration = false;
                    
                    // Show plan page for upgrade
                    if (typeof loadPlanPage === 'function') {
                        loadPlanPage();
                    } else {
                        window.location.href = '/plan';
                    }
                    return;
                }
                
                this.settings.autoImageGeneration = e.target.checked;
            });
        }

        // Video prompt textarea - disable for non-premium users
        const videoPrompt = document.getElementById('video-prompt');
        if (videoPrompt) {
            const user = window.user || {};
            const subscriptionStatus = user.subscriptionStatus === 'active';
            
            if (!subscriptionStatus) {
                videoPrompt.disabled = true;
                videoPrompt.addEventListener('click', () => {
                    if (typeof loadPlanPage === 'function') {
                        loadPlanPage();
                    } else {
                        window.location.href = '/plan';
                    }
                });
            } else {
                videoPrompt.addEventListener('input', (e) => {
                    this.settings.videoPrompt = e.target.value;
                });
            }
        }

        // Suggestions enable switch
        const suggestionsEnableSwitch = document.getElementById('suggestions-enable-switch');
        if (suggestionsEnableSwitch) {
            suggestionsEnableSwitch.addEventListener('change', (e) => {
                this.settings.suggestionsEnabled = e.target.checked;
            });
        }

        const suggestionPresetRadios = document.querySelectorAll('input[name="suggestion-preset"]');
        if (suggestionPresetRadios.length > 0) {
            suggestionPresetRadios.forEach((radio) => {
                radio.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        this.settings.suggestionPreset = e.target.value;
                        this.updateSuggestionPresetUI();
                    }
                });
            });
        }

        // Scenarios enable switch
        const scenariosEnableSwitch = document.getElementById('scenarios-enable-switch');
        if (scenariosEnableSwitch) {
            scenariosEnableSwitch.addEventListener('change', (e) => {
                this.settings.scenariosEnabled = e.target.checked;
            });
        }
        
        // Speech recognition enable switch
        const speechRecognitionEnableSwitch = document.getElementById('speech-recognition-enable-switch');
        if (speechRecognitionEnableSwitch) {
            speechRecognitionEnableSwitch.addEventListener('change', (e) => {
                this.settings.speechRecognitionEnabled = e.target.checked;
                this.toggleSpeechButton();
            });
        }

        // Speech auto-send switch
        const speechAutoSendSwitch = document.getElementById('speech-auto-send-switch');
        if (speechAutoSendSwitch) {
            speechAutoSendSwitch.addEventListener('change', (e) => {
                this.settings.speechAutoSend = e.target.checked;
                this.updateAutoSendFeedback();
            });
        }

        // Custom prompt enabled switch
        const customPromptEnabledSwitch = document.getElementById('custom-prompt-enabled-switch');
        if (customPromptEnabledSwitch) {
            customPromptEnabledSwitch.addEventListener('change', (e) => {
                this.settings.customPromptEnabled = e.target.checked;
            });
        }

        // Default description enabled switch
        const defaultDescriptionEnabledSwitch = document.getElementById('default-description-enabled-switch');
        if (defaultDescriptionEnabledSwitch) {
            defaultDescriptionEnabledSwitch.addEventListener('change', (e) => {
                this.settings.defaultDescriptionEnabled = e.target.checked;
            });
        }

        // Default description textarea
        const defaultDescriptionTextarea = document.getElementById('default-description-textarea');
        if (defaultDescriptionTextarea) {
            defaultDescriptionTextarea.addEventListener('input', (e) => {
                this.settings.defaultDescription = e.target.value;
                const charCount = document.getElementById('default-desc-char-count');
                if (charCount) {
                    charCount.textContent = e.target.value.length;
                }
            });
        }

        // Language selection - Use event delegation for language options
        document.addEventListener('click', (e) => {
            const langOption = e.target.closest('.language-option');
            if (langOption && langOption.closest('#chat-language-grid')) {
                this.selectLanguage(langOption);
            }
        });

        // Image ratio selection - Use event delegation for ratio options
        document.addEventListener('click', (e) => {
            const ratioOption = e.target.closest('.ratio-option');
            if (ratioOption && ratioOption.closest('#image-ratio-grid')) {
                this.selectImageRatio(ratioOption);
            }
        });
    }

    selectLanguage(option) {
        const lang = option.dataset.lang;
        if (!lang) return;

        // Update selection UI
        document.querySelectorAll('#chat-language-grid .language-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        option.classList.add('selected');

        // Update settings
        this.settings.preferredChatLanguage = lang;
        
        // Save to localStorage for immediate access by other components (e.g., NSFW upsell modal)
        localStorage.setItem('preferredChatLanguage', lang);
        
        // Clear NSFW upsell modal translation cache so it reloads with the new language
        if (typeof window.clearNsfwUpsellTranslationCache === 'function') {
            window.clearNsfwUpsellTranslationCache();
        }
    }

    selectImageRatio(option) {
        const ratio = option.dataset.ratio;
        if (!ratio) return;

        // Update selection UI
        document.querySelectorAll('#image-ratio-grid .ratio-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        option.classList.add('selected');

        // Update settings
        this.settings.defaultImageRatio = ratio;
        
        // Save to localStorage for immediate access
        localStorage.setItem('defaultImageRatio', ratio);
    }

    toggleSpeechButton() {
        const speechBtn = document.getElementById('voice-input-toggle');
        if (speechBtn) {
            if (this.settings.speechRecognitionEnabled) {
                speechBtn.style.display = 'inline-block';
                speechBtn.disabled = false;
            } else {
                speechBtn.style.display = 'none';
                speechBtn.disabled = true;
            }
        }
    }

    updateAutoSendFeedback() {
        // Show a brief notification about auto-send status
        const message = this.settings.speechAutoSend ? 
            this.speechT('autoSendEnabled') : 
            this.speechT('autoSendDisabled');
        
        if (typeof showNotification === 'function') {
            showNotification(message, 'info');
        }
    }

    // Getter methods for speech settings
    getSpeechRecognitionEnabled() {
        return this.settings.speechRecognitionEnabled !== undefined ? 
            this.settings.speechRecognitionEnabled : true;
    }

    getSpeechAutoSend() {
        return this.settings.speechAutoSend !== undefined ? 
            this.settings.speechAutoSend : true;
    }
    
    // Model selection method
    selectModel(selectedOption) {
        // Check if this is a premium model and user is not premium
        const isPremiumModel = selectedOption.classList.contains('premium-model');
        
        if (isPremiumModel && !this.isPremium) {
            // Show premium upgrade message instead of blocking
            loadPlanPage();
            return;
        }
        
        // Remove selected class from all model options
        document.querySelectorAll('.settings-model-option').forEach(option => {
            option.classList.remove('selected');
        });
        
        // Add selected class to clicked option
        selectedOption.classList.add('selected');
        
        // Update settings
        const modelKey = selectedOption.dataset.model;
        this.settings.selectedModel = modelKey;
        
        // Show selection feedback
        this.showModelSelectionFeedback(selectedOption, modelKey);
    }

    showModelSelectionFeedback(selectedOption, modelKey) {
        // Add a brief animation to show selection
        selectedOption.style.transform = 'scale(1.02)';
        setTimeout(() => {
            selectedOption.style.transform = '';
        }, 200);

        // Optional: Show a brief notification
        const modelName = this.availableModels[modelKey]?.displayName || modelKey;
    }

    // First time settings check
    // Check if user has ever chatted with this character
    async hasUserChatted(chatId, callback) {
        if (!this.userId || !chatId) {
            if (callback) callback();
            return;
        }

        try {
            const endpoint = `/api/chat-tool-settings/has-chatted/${this.userId}/${chatId}`;
            
            const response = await fetch(endpoint, {
                method: 'GET',
                credentials: 'include'
            });

            if (!response.ok) {
                if (callback) callback();
                return;
            }

            const data = await response.json();
            const hasChatted = data.hasChatted;

            // If user has never chatted with this character, show settings modal
            if (!hasChatted) {
                this.openModalForFirstTime(callback);
            } else {
                if (callback) callback(false);
            }
        } catch (error) {
            console.error('[hasUserChatted] Error:', error.message);
            // On error, proceed normally without showing modal
            if (callback) callback(false);
        }
    }

    // Legacy function for backwards compatibility
    checkFirstTimeSettings(callback) {
        if (!this.userId) {
            if (callback) callback();
            return;
        }
        
        const storageKey = `chat_settings_opened_${this.userId}`;
        const hasOpenedSettings = localStorage.getItem(storageKey);
        
        // If user has never opened settings before, show them automatically
        if (!hasOpenedSettings) {
            // Show settings with callback to continue chat generation
            this.openModalForFirstTime(callback);
        } else if (callback) {
            // User has seen settings before, continue normally
            callback();
        }
    }

    // Special method for first-time opening with welcome message and callback
    openModalForFirstTime(callback) {
        
        // Mark that user has now seen the settings
        this.markSettingsAsOpened();
        
        // Open the modal
        this.openModal();
        
        // Add a welcome message
        // [DEBUG] Temporary disable welcome message need localization & check
        // this.showFirstTimeWelcome();
        
        // Set up callback for when modal is closed
        if (callback) {
            this.onFirstTimeClose = callback;
        }
    }

    // Mark settings as opened in localStorage
    markSettingsAsOpened() {
        if (!this.userId) return;
        
        const storageKey = `chat_settings_opened_${this.userId}`;
        localStorage.setItem(storageKey, 'true');
    }

    // Show a welcome message for first-time users
    showFirstTimeWelcome() {
        // Add a welcome message at the top of the modal
        setTimeout(() => {
            const modalContent = document.querySelector('#settings-modal-overlay .settings-modal-container');
            if (modalContent && !modalContent.querySelector('.first-time-welcome')) {
                const welcomeMessage = document.createElement('div');
                welcomeMessage.className = 'first-time-welcome alert alert-info mb-3 animate__animated animate__fadeIn';
                welcomeMessage.innerHTML = `
                    <i class="bi bi-info-circle me-2"></i>
                    <strong>${this.t('welcomeToSettings', 'Welcome to Chat Settings!')}</strong><br>
                    <small>${this.t('settingsWelcomeMessage', 'Customize your chat experience before we start. You can change these settings anytime later.')}</small>
                    <hr class="my-2">
                    <small class="text-muted">${this.t('settingsCloseToStart', 'Close this dialog to start chatting with your character.')}</small>
                `;
                
                // Insert at the beginning of the modal content
                const firstChild = modalContent.firstChild;
                modalContent.insertBefore(welcomeMessage, firstChild);
                
                // Auto-remove the welcome message after 12 seconds
                setTimeout(() => {
                    if (welcomeMessage.parentNode) {
                        welcomeMessage.classList.add('animate__fadeOut');
                        setTimeout(() => {
                            welcomeMessage.remove();
                        }, 500);
                    }
                }, 12000);
            }
        }, 300);
    }

    setupRangeSliders() {
        const minImagesRange = document.getElementById('min-images-range');
        const minImagesValue = document.getElementById('min-images-value');
        const user = window.user || {};
        const subscriptionStatus = user.subscriptionStatus === 'active';

        if (minImagesRange && minImagesValue) {
            // Set initial value based on subscription status
            if (!subscriptionStatus) {
                // Auto-correct non-premium users who have minImages > 1
                if (this.settings.minImages && parseInt(this.settings.minImages) > 1) {
                    this.settings.minImages = 1;
                }

                // Non-premium users are limited to 1 image
                this.settings.minImages = 1;
                minImagesRange.value = 1;
                minImagesValue.textContent = 1;
                minImagesRange.disabled = true;
                minImagesRange.style.opacity = '0.6';
                
                // Add premium indicator
                const rangeContainer = minImagesRange.closest('.settings-field');
                if (rangeContainer && !rangeContainer.querySelector('.premium-feature-indicator')) {
                    const premiumIndicator = document.createElement('small');
                    premiumIndicator.className = 'premium-feature-indicator text-muted d-block mt-1';
                    premiumIndicator.innerHTML = '<i class="bi bi-star-fill text-warning"></i> ' + (this.t('minImagesPremiumFeature') || 'Premium feature required for more images');
                    rangeContainer.appendChild(premiumIndicator);
                }

            } else {
                // Premium users can use any value
                minImagesRange.disabled = false;
                minImagesRange.style.opacity = '1';
            }

            minImagesRange.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                
                // Check if user is trying to set value > 1 without subscription
                if (!subscriptionStatus && value > 1) {
                    // Reset to 1 and show upgrade popup
                    e.target.value = 1;
                    minImagesValue.textContent = 1;
                    this.settings.minImages = 1;
                    
                    // Show plan page for upgrade
                    if (typeof loadPlanPage === 'function') {
                        loadPlanPage();
                    } else {
                        window.location.href = '/plan';
                    }
                    return;
                }
                
                // Update value for premium users or when value is 1
                minImagesValue.textContent = value;
                this.settings.minImages = value;
            });
        }

        // Setup premium indicators based on subscription status
        this.setupPremiumIndicators(subscriptionStatus);
    }

    setupPremiumIndicators(subscriptionStatus) {
        // Auto Merge Face premium indicator
        const autoMergeIcon = document.getElementById('auto-merge-premium-icon');
        const autoMergeIndicator = document.getElementById('auto-merge-premium-indicator');
        const autoMergeFaceSwitch = document.getElementById('auto-merge-face-switch');

        if (!subscriptionStatus) {
            if (autoMergeIcon) autoMergeIcon.style.display = 'inline';
            if (autoMergeIndicator) autoMergeIndicator.style.display = 'block';
            
            if (autoMergeFaceSwitch) {
                // Only update if not already false (preserve user setting)
                if (this.settings.autoMergeFace) {
                    this.settings.autoMergeFace = false;
                }
                autoMergeFaceSwitch.checked = this.settings.autoMergeFace;
                autoMergeFaceSwitch.disabled = true;
                autoMergeFaceSwitch.style.opacity = '0.6';
            }
            // Save corrected settings after UI is set up (only if not loading)
            if (!this.isLoading) {
                this.autoSaveCorrection();
            }
        } else {
            if (autoMergeIcon) autoMergeIcon.style.display = 'none';
            if (autoMergeIndicator) autoMergeIndicator.style.display = 'none';
            
            if (autoMergeFaceSwitch) {
                autoMergeFaceSwitch.disabled = false;
                autoMergeFaceSwitch.style.opacity = '1';
            }
        }

        // Auto Image Generation premium indicator
        const autoImageIcon = document.getElementById('auto-image-premium-icon');
        const autoImageIndicator = document.getElementById('auto-image-premium-indicator');
        const autoImageGenerationSwitch = document.getElementById('auto-image-generation-switch');

        if (!subscriptionStatus) {
            if (autoImageIcon) autoImageIcon.style.display = 'inline';
            if (autoImageIndicator) autoImageIndicator.style.display = 'block';
            
            if (autoImageGenerationSwitch) {
                // Only update if not already false (preserve user setting)
                if (this.settings.autoImageGeneration) {
                    this.settings.autoImageGeneration = false;
                }
                autoImageGenerationSwitch.checked = this.settings.autoImageGeneration;
                autoImageGenerationSwitch.disabled = true;
                autoImageGenerationSwitch.style.opacity = '0.6';
            }
            
        } else {
            if (autoImageIcon) autoImageIcon.style.display = 'none';
            if (autoImageIndicator) autoImageIndicator.style.display = 'none';
            
            if (autoImageGenerationSwitch) {
                autoImageGenerationSwitch.disabled = false;
                autoImageGenerationSwitch.style.opacity = '1';
            }
        }

        // Video settings premium indicator
        const videoIndicator = document.getElementById('video-premium-indicator');
        const videoPrompt = document.getElementById('video-prompt');
        
        if (!subscriptionStatus) {
            if (videoIndicator) videoIndicator.style.display = 'block';
            if (videoPrompt) {
                videoPrompt.disabled = true;
                videoPrompt.style.opacity = '0.6';
                videoPrompt.style.cursor = 'pointer';
            }
        } else {
            if (videoIndicator) videoIndicator.style.display = 'none';
            if (videoPrompt) {
                videoPrompt.disabled = false;
                videoPrompt.style.opacity = '1';
                videoPrompt.style.cursor = 'text';
            }
        }

        // Premium voices indicator
        const premiumVoicesIndicator = document.getElementById('premium-voices-indicator');
        if (!subscriptionStatus) {
            if (premiumVoicesIndicator) premiumVoicesIndicator.style.display = 'block';
        } else {
            if (premiumVoicesIndicator) premiumVoicesIndicator.style.display = 'none';
        }

        // Premium models indicator
        const premiumModelsIndicator = document.getElementById('premium-models-indicator');
        if (!subscriptionStatus) {
            if (premiumModelsIndicator) premiumModelsIndicator.style.display = 'block';
        } else {
            if (premiumModelsIndicator) premiumModelsIndicator.style.display = 'none';
        }
    }

    // Auto save correction for non-premium users
    autoSaveCorrection() {
        if (!this.userId) return;

        // Save the corrected settings silently in the background
        const requestBody = { 
            settings: this.settings,
            autoCorrection: true // Flag to indicate this is an automatic correction
        };

        // Include chatId if available
        const chatId = sessionStorage.getItem('lastChatId') || sessionStorage.getItem('chatId');
        if (chatId && chatId !== 'null' && chatId !== 'undefined') {
            requestBody.chatId = chatId;
        }
        fetch(`/api/chat-tool-settings/${this.userId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Silent success
            }
        })
        .catch(error => {
            console.error('Error auto-correcting settings:', error);
        });
    }
    
    openModal(callback) {
        const overlay = document.getElementById('settings-modal-overlay');
        if (overlay) {
            overlay.classList.add('show');
            document.body.style.overflow = 'hidden';
            
            // Load models when modal opens if not already loaded
            if (Object.keys(this.availableModels).length === 0) {
                this.loadAvailableModels();
            }
            
            // Focus trap for accessibility
            const firstFocusable = overlay.querySelector('button, input, select, textarea');
            if (firstFocusable) {
                setTimeout(() => firstFocusable.focus(), 100);
            }
            
            // Mark settings as opened when manually opened
            this.markSettingsAsOpened();

            // Set up normal close callback if provided
            if (callback) {
                this.normalCloseCallback = callback;
            }
        }
    }

    closeModal() {
        
        const overlay = document.getElementById('settings-modal-overlay');
        if (overlay) {
            overlay.classList.remove('show');
            document.body.style.overflow = '';
            
            // Remove welcome message if it exists
            const welcomeMessage = overlay.querySelector('.first-time-welcome');
            if (welcomeMessage) {
                welcomeMessage.remove();
            }
            
            // Execute callback if this was a first-time opening
            if (this.onFirstTimeClose) {
                const callback = this.onFirstTimeClose;
                this.onFirstTimeClose = null; // Clear the callback
                setTimeout(() => {
                    callback(true);
                }, 300); // Small delay to ensure modal is fully closed
            } else {
                // Normal close, no special action needed
                const callback = this.normalCloseCallback;
                this.normalCloseCallback = null; // Clear the callback
                if (callback) callback(false);
            }
        }
    }

    // Utility methods
    resetFirstTimeFlag() {
        if (!this.userId) return;
        
        const storageKey = `chat_settings_opened_${this.userId}`;
        localStorage.removeItem(storageKey);
    }

    isFirstTimeUser() {
        if (!this.userId) return false;
        
        const storageKey = `chat_settings_opened_${this.userId}`;
        return !localStorage.getItem(storageKey);
    }

    // Selection methods
    selectVoice(selectedOption) {
        // Remove selected class from all standard voice options
        document.querySelectorAll('#standard-voices .voice-card').forEach(option => {
            option.classList.remove('selected');
        });
        
        // Add selected class to clicked option
        selectedOption.classList.add('selected');
        
        // Update settings
        this.settings.selectedVoice = selectedOption.dataset.voice;
    }

    selectPremiumVoice(selectedOption) {
        const user = window.user || {};
        const subscriptionStatus = user.subscriptionStatus === 'active';
        
        if (!subscriptionStatus) {
            // Show upgrade popup for non-premium users
            if (typeof loadPlanPage === 'function') {
                loadPlanPage();
            } else {
                window.location.href = '/plan';
            }
            return;
        }
        
        // Remove selected class from all premium voice options
        document.querySelectorAll('#premium-voices-grid .voice-card').forEach(option => {
            option.classList.remove('selected');
        });
        
        // Add selected class to clicked option
        selectedOption.classList.add('selected');
        
        // Update settings
        this.settings.minimaxVoice = selectedOption.dataset.voice;
        this.settings.premiumVoice = selectedOption.dataset.voice;
    }

    async loadPremiumVoices() {
        const storageKey = 'premiumVoices';
        try {
            // Check localStorage first
            const cachedVoices = localStorage.getItem(storageKey);
            if (cachedVoices) {
                this.premiumVoices = JSON.parse(cachedVoices);
                this.renderPremiumVoices();
                return;
            }

            // If not in localStorage, make the API request
            const response = await fetch('/api/minimax-voices');
            const data = await response.json();
            if (response.ok && data.success) {
                this.premiumVoices = data.voices;
                // Save to localStorage
                localStorage.setItem(storageKey, JSON.stringify(this.premiumVoices));
                this.renderPremiumVoices();
            } else {
                console.error('Failed to load Premium voices:', data.error);
                this.showPremiumVoicesError();
            }
        } catch (error) {
            console.error('Error loading Premium voices:', error);
            this.showPremiumVoicesError();
        }
    }

    renderPremiumVoices() {
        const grid = document.getElementById('premium-voices-grid');
        if (!grid || !this.premiumVoices.length) return;

        const characterGender = $('.settings-modal-body').attr('data-genre') || 'female';
        const user = window.user || {};
        const subscriptionStatus = user.subscriptionStatus === 'active';

        grid.innerHTML = '';

        const filteredVoices = this.premiumVoices.filter(voice => voice.gender === characterGender);
        filteredVoices.forEach(voice => {
            // Only mark as selected if user is premium AND has this voice selected
            // Free users should never have a premium voice selected
            const isSelected = subscriptionStatus && voice.key === this.settings.minimaxVoice;
            const voiceTranslation = this.translations.voices?.[voice.key] || {};
            
            const voiceCard = document.createElement('div');
            voiceCard.className = `voice-card settings-premium-voice-option settings-voice-option col-12 col-md-6 ${isSelected ? 'selected' : ''}`;
            voiceCard.setAttribute('data-voice', voice.key);

            // Disable for non-premium users
            if (!subscriptionStatus) {
                voiceCard.classList.add('disabled');
                voiceCard.style.opacity = '0.5';
                voiceCard.style.cursor = 'pointer';
            }

            voiceCard.innerHTML = `
                <div class="voice-card-content">
                    <div class="voice-icon">
                        <i class="bi bi-soundwave"></i>
                    </div>
                    <div class="voice-info">
                        <span class="voice-name">${voiceTranslation.name || voice.name || voice.key.replace(/_/g, ' ')}</span>
                        <span class="voice-description">${voiceTranslation.description || ''}</span>
                    </div>
                </div>
                <button type="button" class="play-sample-btn" data-voice="${voice.key}" data-provider="minimax">
                    <i class="bi bi-play-fill"></i>
                    <span>${this.t('playSample', 'Play Sample')}</span>
                </button>
                <div class="check-badge"><i class="bi bi-check"></i></div>
            `;
            
            grid.appendChild(voiceCard);
        });
    }

    showPremiumVoicesError() {
        const grid = document.getElementById('premium-voices-grid');
        if (!grid) return;
        
        grid.innerHTML = `
            <div class="voice-error text-center text-muted">
                <i class="bi bi-exclamation-triangle"></i>
                <div>${this.t('failedToLoadPremiumVoices')}</div>
                <button type="button" class="btn btn-sm btn-outline-primary mt-2" onclick="window.chatToolSettings.loadPremiumVoices()">
                    ${this.t('retry')}
                </button>
            </div>
        `;
    }

    /**
     * Load voice samples manifest
     */
    async loadVoiceSamples() {
        try {
            // Load premium voice samples (minimax)
            const response = await fetch('/audio/voice-samples/manifest.json');
            if (response.ok) {
                this.voiceSamples = await response.json();
                console.log('[ChatToolSettings] Premium voice samples loaded:', this.voiceSamples.voices?.length || 0);
            } else {
                console.warn('[ChatToolSettings] Failed to load premium voice samples manifest');
                this.voiceSamples = null;
            }
            
            // Load OpenAI voice samples
            try {
                const openaiResponse = await fetch('/audio/voice-samples/openai/manifest.json');
                if (openaiResponse.ok) {
                    this.openaiVoiceSamples = await openaiResponse.json();
                } else {
                    console.warn('[ChatToolSettings] Failed to load OpenAI voice samples manifest');
                    this.openaiVoiceSamples = null;
                }
            } catch (error) {
                console.warn('[ChatToolSettings] Error loading OpenAI voice samples:', error);
                this.openaiVoiceSamples = null;
            }
        } catch (error) {
            console.error('[ChatToolSettings] Failed to load voice samples:', error);
            this.voiceSamples = null;
            this.openaiVoiceSamples = null;
        }
    }

    /**
     * Play a voice sample
     */
    async playVoiceSample(voiceKey, provider = 'minimax') {
        if (!this.audioPlayer) return;
        
        // If clicking the same voice that's currently playing, pause it
        if (this.currentPlayingVoice === voiceKey && !this.audioPlayer.paused) {
            this.pauseVoiceSample();
            return;
        }
        
        // If clicking the same voice that's currently paused, resume it
        if (this.currentPlayingVoice === voiceKey && this.audioPlayer.paused) {
            this.resumeVoiceSample();
            return;
        }
        
        // Stop current playback if different voice
        if (this.currentPlayingVoice && this.currentPlayingVoice !== voiceKey) {
            this.stopVoiceSample();
        }
        
        // Find the sample URL based on provider
        let sampleUrl;
        if (provider === 'openai') {
            // OpenAI voice samples are in openai subdirectory
            sampleUrl = `/audio/voice-samples/openai/${this.lang}/${voiceKey}_${this.lang}.mp3`;
        } else {
            // Premium voice samples (minimax)
            sampleUrl = `/audio/voice-samples/${this.lang}/${voiceKey}_${this.lang}.mp3`;
        }
        
        // Update UI to show playing state
        const btn = document.querySelector(`.play-sample-btn[data-voice="${voiceKey}"][data-provider="${provider}"]`);
        if (btn) {
            btn.innerHTML = `<i class="bi bi-pause-fill"></i><span>${this.t('playing', 'Playing...')}</span>`;
            btn.classList.add('playing');
        }
        
        this.currentPlayingVoice = voiceKey;
        
        try {
            this.audioPlayer.src = sampleUrl;
            await this.audioPlayer.play();
        } catch (error) {
            console.error('[ChatToolSettings] Failed to play voice sample:', error);
            this.onAudioEnded();
        }
    }
    
    /**
     * Pause voice sample playback
     */
    pauseVoiceSample() {
        if (this.audioPlayer && !this.audioPlayer.paused) {
            this.audioPlayer.pause();
            
            const btn = document.querySelector(`.play-sample-btn[data-voice="${this.currentPlayingVoice}"]`);
            if (btn) {
                btn.innerHTML = `<i class="bi bi-play-fill"></i><span>${this.t('playSample', 'Play Sample')}</span>`;
                btn.classList.remove('playing');
            }
        }
    }
    
    /**
     * Resume voice sample playback
     */
    resumeVoiceSample() {
        if (this.audioPlayer && this.audioPlayer.paused) {
            this.audioPlayer.play().catch(error => {
                console.error('[ChatToolSettings] Failed to resume voice sample:', error);
                this.onAudioEnded();
            });
            
            const btn = document.querySelector(`.play-sample-btn[data-voice="${this.currentPlayingVoice}"]`);
            if (btn) {
                btn.innerHTML = `<i class="bi bi-pause-fill"></i><span>${this.t('playing', 'Playing...')}</span>`;
                btn.classList.add('playing');
            }
        }
    }

    /**
     * Stop voice sample playback
     */
    stopVoiceSample() {
        if (this.audioPlayer) {
            this.audioPlayer.pause();
            this.audioPlayer.currentTime = 0;
        }
        this.onAudioEnded();
    }

    /**
     * Handle audio ended event
     */
    onAudioEnded() {
        if (this.currentPlayingVoice) {
            // Try to find button with any provider (openai or minimax)
            let btn = document.querySelector(`.play-sample-btn[data-voice="${this.currentPlayingVoice}"]`);
            if (btn) {
                btn.innerHTML = `<i class="bi bi-play-fill"></i><span>${this.t('playSample', 'Play Sample')}</span>`;
                btn.classList.remove('playing');
            }
        }
        this.currentPlayingVoice = null;
    }

    toggleVoiceProviderUI() {
        const standardVoices = document.getElementById('standard-voices');
        const premiumVoices = document.getElementById('premium-voices');
        const user = window.user || {};
        const subscriptionStatus = user.subscriptionStatus === 'active';
        
        if (this.settings.voiceProvider === 'premium') {
            if (standardVoices) standardVoices.style.display = 'none';
            if (premiumVoices) premiumVoices.style.display = 'block';
            
            // Always load Premium voices when switching to Premium provider
            this.loadPremiumVoices();
            
            // If free user switched to premium, ensure no voice is selected
            if (!subscriptionStatus) {
                // Clear any premium voice selection for free users
                if (this.settings.minimaxVoice) {
                    this.settings.minimaxVoice = null;
                }
                if (this.settings.premiumVoice) {
                    this.settings.premiumVoice = null;
                }
            }
            
        } else {
            if (standardVoices) standardVoices.style.display = 'block';
            if (premiumVoices) premiumVoices.style.display = 'none';
        }
    }

    updateSwitchLabels() {
        const standardLabel = document.querySelector('.standard-label');
        const premiumLabel = document.querySelector('.premium-label');
        
        if (this.settings.voiceProvider === 'premium') {
            if (standardLabel) standardLabel.style.color = '#666';
            if (premiumLabel) premiumLabel.style.color = '#28a745';
        } else {
            if (standardLabel) standardLabel.style.color = '#6E20F4';
            if (premiumLabel) premiumLabel.style.color = '#666';
        }
    }

    // Settings persistence methods
    async saveSettings() {
        if (this.isLoading || !this.userId) {
            return;
        }

        try {
            this.isLoading = true;
            this.showSavingState();
            
            // Get chatId and userChatId from session storage
            const chatId = sessionStorage.getItem('lastChatId') || sessionStorage.getItem('chatId');
            const userChatId = sessionStorage.getItem('userChatId');

            const requestBody = { 
                settings: this.settings 
            };

            // Include chatId if available for chat-specific settings
            if (chatId && chatId !== 'null' && chatId !== 'undefined') {
                requestBody.chatId = chatId;
            }

            // Include userChatId to save preferredChatLanguage to userChat collection
            if (userChatId && userChatId !== 'null' && userChatId !== 'undefined') {
                requestBody.userChatId = userChatId;
            }
            const response = await fetch(`/api/chat-tool-settings/${this.userId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to save settings');
            }

            // Update local settings with validated server response
            this.settings = { ...this.settings, ...data.settings };
            
            // Show success feedback with chat-specific info
            const successMessage = data.isChatSpecific ? 
                this.t('chatSpecificSettingsSaved') : 
                this.t('globalSettingsSaved');
            this.showSaveSuccess(successMessage);
            
            // Apply settings to the application
            this.applySettings();
            
            // Close modal after short delay
            setTimeout(() => {
                this.closeModal();
            }, 1000);
            
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showSaveError(error.message);
        } finally {
            this.isLoading = false;
        }
    }

    async loadSettings() {
        if (!this.userId) {
            console.warn('No user ID available, using default settings');
            return;
        }

        try {
            // Try to load chat-specific settings first if we have a chatId
            const chatId = sessionStorage.getItem('lastChatId') || sessionStorage.getItem('chatId');
            let response;
            if (chatId && chatId !== 'null' && chatId !== 'undefined') {
                // Try to get chat-specific settings
                response = await fetch(`/api/chat-tool-settings/${this.userId}/${chatId}`);
            } else {
                // Get global user settings
                response = await fetch(`/api/chat-tool-settings/${this.userId}`);
            }

            const data = await response.json();
            if (response.ok && data.success) {
                this.settings = { ...this.settings, ...data.settings };
                // Skip auto-correction when applying loaded settings to preserve user's choices
                this.applySettingsToUI(true);
                
                // Dispatch event to notify other components that settings are loaded
                document.dispatchEvent(new CustomEvent('chatToolSettingsLoaded', {
                    detail: { settings: this.settings }
                }));
            } else {
                console.warn('Failed to load settings, using defaults');
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            // Fall back to localStorage if API fails
            this.loadFromLocalStorage();
        }
    }

    async resetSettings() {
        if (this.isLoading || !this.userId) {
            return;
        }

        try {
            const chatId = sessionStorage.getItem('lastChatId') || sessionStorage.getItem('chatId');
            const isCurrentlyInChat = chatId && chatId !== 'null' && chatId !== 'undefined';
            
            const result = await Swal.fire({
                title: this.t('resetSettingsTitle'),
                text: isCurrentlyInChat ? 
                    this.t('resetChatSettingsText') :
                    this.t('resetGlobalSettingsText'),
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: this.t('reset'),
                cancelButtonText: this.t('cancel'),
                confirmButtonColor: '#dc3545'
            });

            if (!result.isConfirmed) {
                return;
            }

            this.isLoading = true;
            this.showSavingState();

            let url = `/api/chat-tool-settings/${this.userId}`;
            if (isCurrentlyInChat) {
                url += `?chatId=${chatId}`;
            }

            const response = await fetch(url, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to reset settings');
            }

            // Update local settings with default values
            this.settings = { ...data.settings };
            this.applySettingsToUI();
            this.showResetSuccess();

        } catch (error) {
            console.error('Error resetting settings:', error);
            this.showSaveError(this.t('errorResettingSettings'));
        } finally {
            this.isLoading = false;
        }
    }

    loadFromLocalStorage() {
        try {
            const savedSettings = localStorage.getItem('chatToolSettings');
            if (savedSettings) {
                this.settings = { ...this.settings, ...JSON.parse(savedSettings) };
                // Skip auto-correction when applying loaded settings to preserve user's choices
                this.applySettingsToUI(true);
                
                // Dispatch event to notify other components that settings are loaded
                document.dispatchEvent(new CustomEvent('chatToolSettingsLoaded', {
                    detail: { settings: this.settings }
                }));
            }
        } catch (error) {
            console.error('Error loading settings from localStorage:', error);
        }
    }

    applySettingsToUI(skipAutoCorrection = false) {
        const user = window.user || {};
        const subscriptionStatus = user.subscriptionStatus === 'active';
        
        if (!this.settings.minimaxVoice && this.settings.premiumVoice) {
            this.settings.minimaxVoice = this.settings.premiumVoice;
        }

        if (!this.settings.voiceProvider) {
            this.settings.voiceProvider = 'standard';
        } else {
            const provider = String(this.settings.voiceProvider).toLowerCase();
            if (provider === 'openai') {
                this.settings.voiceProvider = 'standard';
            } else if (provider === 'evenlab') {
                this.settings.voiceProvider = 'premium';
            }
        }

        // Auto-correct ONLY premium-exclusive settings for non-premium users
        // SKIP auto-correction if skipAutoCorrection is true to preserve user-set values
        // NOTE: We only auto-correct premium features (minImages, autoMergeFace, autoImageGeneration)
        // Non-premium users CAN use other features like scenarios, suggestions, speech recognition, etc.
        if (!subscriptionStatus && !skipAutoCorrection) {
            // Only reset premium features
            if (this.settings.minImages && parseInt(this.settings.minImages) > 1) {
                this.settings.minImages = 1;
            }
            if (this.settings.autoMergeFace) {
                this.settings.autoMergeFace = false;
            }
            if (this.settings.autoImageGeneration) {
                this.settings.autoImageGeneration = false;
            }
            // Auto-correct premium models
            const premiumModels = ['llama-3-70b', 'gemma', 'deepseek'];
            if (premiumModels.includes(this.settings.selectedModel)) {
                this.settings.selectedModel = 'openai'; // Default to free model
            }
        }

        // Update range slider
        const minImagesRange = document.getElementById('min-images-range');
        const minImagesValue = document.getElementById('min-images-value');
        if (minImagesRange && minImagesValue) {
            minImagesRange.value = this.settings.minImages;
            minImagesValue.textContent = this.settings.minImages;
            
            // Ensure non-premium users can't have values > 1
            if (!subscriptionStatus) {
                minImagesRange.disabled = true;
                minImagesRange.style.opacity = '0.6';
            }
        }

        // Update video prompt
        const videoPrompt = document.getElementById('video-prompt');
        if (videoPrompt) {
            videoPrompt.value = this.settings.videoPrompt;
            
            // Disable for non-premium users
            if (!subscriptionStatus) {
                videoPrompt.disabled = true;
                videoPrompt.style.opacity = '0.6';
                videoPrompt.style.cursor = 'pointer';
            } else {
                videoPrompt.disabled = false;
                videoPrompt.style.opacity = '1';
                videoPrompt.style.cursor = 'text';
            }
        }

        // Update voice selection
        document.querySelectorAll('.settings-voice-option').forEach(option => {
            option.classList.toggle('selected', option.dataset.voice === this.settings.selectedVoice);
        });

        // Update premium voice selection
        // Only allow selection if user is premium
        const activePremiumVoice = subscriptionStatus ? (this.settings.minimaxVoice || this.settings.premiumVoice) : null;
        document.querySelectorAll('.settings-premium-voice-option').forEach(option => {
            // Only mark as selected if user is premium
            option.classList.toggle('selected', subscriptionStatus && option.dataset.voice === activePremiumVoice);
            
            // Disable for non-premium users
            if (!subscriptionStatus) {
                option.classList.add('disabled');
                option.style.opacity = '0.5';
                option.style.cursor = 'pointer';
                // Clear selection for free users
                option.classList.remove('selected');
            } else {
                option.classList.remove('disabled');
                option.style.opacity = '1';
                option.style.cursor = 'pointer';
            }
        });

        // Update model selection with premium check
        document.querySelectorAll('.settings-model-option').forEach(option => {
            const isSelected = option.dataset.model === this.settings.selectedModel;
            const isPremiumModel = option.classList.contains('premium-model');
            
            // Apply selection state
            option.classList.toggle('selected', isSelected);
            
            // Disable premium models for non-premium users
            if (isPremiumModel && !subscriptionStatus) {
                option.classList.add('disabled');
            } else {
                option.classList.remove('disabled');
            }
        });

        // Update voice provider switch - Allow both users to switch
        const voiceProviderSwitch = document.getElementById('voice-provider-switch');
        if (voiceProviderSwitch) {
            voiceProviderSwitch.checked = this.settings.voiceProvider === 'premium';
            this.toggleVoiceProviderUI();
            this.updateSwitchLabels();
        }

        // Update auto merge face switch
        const autoMergeFaceSwitch = document.getElementById('auto-merge-face-switch');
        if (autoMergeFaceSwitch) {
            autoMergeFaceSwitch.checked = this.settings.autoMergeFace !== undefined ? this.settings.autoMergeFace : true;
            
            // Disable for non-premium users
            if (!subscriptionStatus) {
                autoMergeFaceSwitch.disabled = true;
                autoMergeFaceSwitch.style.opacity = '0.6';
            } else {
                autoMergeFaceSwitch.disabled = false;
                autoMergeFaceSwitch.style.opacity = '1';
            }
        }

        // Update auto image generation switch
        const autoImageGenerationSwitch = document.getElementById('auto-image-generation-switch');
        if (autoImageGenerationSwitch) {
            autoImageGenerationSwitch.checked = this.settings.autoImageGeneration !== undefined ? this.settings.autoImageGeneration : !subscriptionStatus;
            
            // Disable for non-premium users
            if (!subscriptionStatus) {
                autoImageGenerationSwitch.disabled = true;
                autoImageGenerationSwitch.style.opacity = '0.6';
            } else {
                autoImageGenerationSwitch.disabled = false;
                autoImageGenerationSwitch.style.opacity = '1';
            }
        }

        // Update custom prompt enabled switch
        const customPromptEnabledSwitch = document.getElementById('custom-prompt-enabled-switch');
        if (customPromptEnabledSwitch) {
            customPromptEnabledSwitch.checked = this.getCustomPromptEnabled();
        }

        // Update default description enabled switch
        const defaultDescriptionEnabledSwitch = document.getElementById('default-description-enabled-switch');
        if (defaultDescriptionEnabledSwitch) {
            defaultDescriptionEnabledSwitch.checked = this.getDefaultDescriptionEnabled();
        }

        // Update default description textarea
        const defaultDescriptionTextarea = document.getElementById('default-description-textarea');
        if (defaultDescriptionTextarea) {
            defaultDescriptionTextarea.value = this.getDefaultDescription();
            const charCount = document.getElementById('default-desc-char-count');
            if (charCount) {
                charCount.textContent = this.getDefaultDescription().length;
            }
        }

        // Update suggestions enable switch
        const suggestionsEnableSwitch = document.getElementById('suggestions-enable-switch');
        if (suggestionsEnableSwitch) {
            suggestionsEnableSwitch.checked = this.settings.suggestionsEnabled !== undefined ? this.settings.suggestionsEnabled : true;
        }

        this.updateSuggestionPresetUI();

        // Update scenarios enable switch
        const scenariosEnableSwitch = document.getElementById('scenarios-enable-switch');
        if (scenariosEnableSwitch) {
            scenariosEnableSwitch.checked = this.settings.scenariosEnabled !== undefined ? this.settings.scenariosEnabled : false;
        }

        // Update speech recognition enable switch
        const speechRecognitionEnableSwitch = document.getElementById('speech-recognition-enable-switch');
        if (speechRecognitionEnableSwitch) {
            speechRecognitionEnableSwitch.checked = this.settings.speechRecognitionEnabled !== undefined ? 
                this.settings.speechRecognitionEnabled : true;
        }

        // Update speech auto-send switch
        const speechAutoSendSwitch = document.getElementById('speech-auto-send-switch');
        if (speechAutoSendSwitch) {
            speechAutoSendSwitch.checked = this.settings.speechAutoSend !== undefined ? 
                this.settings.speechAutoSend : true;
        }

        // Apply initial speech button state
        this.toggleSpeechButton();

        // Update language selection
        const selectedLang = this.settings.preferredChatLanguage;
        if (selectedLang) {
            document.querySelectorAll('#chat-language-grid .language-option').forEach(opt => {
                opt.classList.toggle('selected', opt.dataset.lang === selectedLang);
            });
            // Sync to localStorage for immediate access by other components
            localStorage.setItem('preferredChatLanguage', selectedLang);
            
            // Clear NSFW upsell modal translation cache
            if (typeof window.clearNsfwUpsellTranslationCache === 'function') {
                window.clearNsfwUpsellTranslationCache();
            }
        }

        // Update image ratio selection
        const selectedRatio = this.settings.defaultImageRatio || '9:16';
        document.querySelectorAll('#image-ratio-grid .ratio-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.ratio === selectedRatio);
        });
        // Sync to localStorage for immediate access
        localStorage.setItem('defaultImageRatio', selectedRatio);

        // Update premium indicators
        this.setupPremiumIndicators(subscriptionStatus);
    }

    updateSuggestionPresetUI() {
        const selectedPreset = this.settings.suggestionPreset || 'neutral';
        document.querySelectorAll('input[name="suggestion-preset"]').forEach((radio) => {
            radio.checked = radio.value === selectedPreset;
        });
    }

    applySettings() {
        // Save to localStorage as backup
        try {
            localStorage.setItem('chatToolSettings', JSON.stringify(this.settings));
        } catch (error) {
            console.warn('Failed to save to localStorage:', error);
        }

        // Dispatch custom event with settings for other components to listen
        const settingsEvent = new CustomEvent('chatSettingsUpdated', {
            detail: { ...this.settings }
        });
        document.dispatchEvent(settingsEvent);
    }

    // UI feedback methods
    showSavingState() {
        const saveBtn = document.getElementById('settings-save-btn');
        if (saveBtn) {
            saveBtn.innerHTML = `<i class="bi bi-arrow-clockwise spin"></i> ${this.t('saving')}`;
            saveBtn.disabled = true;
        }
    }

    showSaveSuccess(message = null) {
        const saveBtn = document.getElementById('settings-save-btn');
        if (saveBtn) {
            const successMessage = message || this.t('settingsSaved');
            saveBtn.innerHTML = `<i class="bi bi-check-circle-fill"></i> ${successMessage}`;
            saveBtn.style.background = 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';
            saveBtn.disabled = false;
            
            setTimeout(() => {
                saveBtn.innerHTML = `<i class="bi bi-gear-fill"></i> ${this.t('saveSettings')}`;
                saveBtn.style.background = 'linear-gradient(135deg, #6E20F4 0%, #8B4CF8 100%)';
            }, 2000);
        }
    }

    showResetSuccess() {
        const resetBtn = document.getElementById('settings-reset-btn');
        if (resetBtn) {
            const originalText = resetBtn.innerHTML;
            resetBtn.innerHTML = `<i class="bi bi-check-circle-fill"></i> ${this.t('resetComplete')}`;
            resetBtn.style.background = 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';
            
            setTimeout(() => {
                resetBtn.innerHTML = originalText;
                resetBtn.style.background = '';
            }, 2000);
        }
    }

    showSaveError(message = null) {
        const saveBtn = document.getElementById('settings-save-btn');
        if (saveBtn) {
            const errorMessage = message || this.t('errorSavingSettings');
            saveBtn.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${this.t('errorSaving')}`;
            saveBtn.style.background = 'linear-gradient(135deg, #dc3545 0%, #e74c3c 100%)';
            saveBtn.disabled = false;
            
            setTimeout(() => {
                saveBtn.innerHTML = `<i class="bi bi-gear-fill"></i> ${this.t('saveSettings')}`;
                saveBtn.style.background = 'linear-gradient(135deg, #6E20F4 0%, #8B4CF8 100%)';
            }, 3000);
        }

        // Show error notification if available
        if (window.showNotification) {
            window.showNotification(errorMessage, 'error');
        } else {
            console.error('Settings error:', errorMessage);
        }
    }

    // Public getter methods
    getMinImages() {
        return this.settings.minImages;
    }

    getVideoPrompt() {
        return this.settings.videoPrompt;
    }

    getSelectedVoice() {
        return this.settings.selectedVoice;
    }

    getVoiceProvider() {
        return this.settings.voiceProvider;
    }

    getMinimaxVoice() {
        if (!this.settings.minimaxVoice && this.settings.premiumVoice) {
            this.settings.minimaxVoice = this.settings.premiumVoice;
        }
        return this.settings.minimaxVoice || 'Wise_Woman';
    }

    getAutoMergeFace() {
        return this.settings.autoMergeFace;
    }

    getSelectedModel() {
        return this.settings.selectedModel;
    }

    getAutoImageGeneration() {
        return this.settings.autoImageGeneration;
    }

    getCustomPromptEnabled() {
        return this.settings.customPromptEnabled !== undefined ? this.settings.customPromptEnabled : true;
    }

    getDefaultDescriptionEnabled() {
        return this.settings.defaultDescriptionEnabled !== undefined ? this.settings.defaultDescriptionEnabled : false;
    }

    getDefaultDescription() {
        return this.settings.defaultDescription || '';
    }

    getScenariosEnabled() {
        return this.settings.scenariosEnabled !== undefined ? 
            this.settings.scenariosEnabled : false;
    }
    
    getPreferredChatLanguage() {
        return this.settings.preferredChatLanguage || '';
    }

    getDefaultImageRatio() {
        return this.settings.defaultImageRatio || '9:16';
    }

    // Chat-specific methods
    async loadChatSettings(chatId) {
        if (!this.userId || !chatId) {
            return this.settings;
        }

        try {
            const url = `/api/chat-tool-settings/${this.userId}/${chatId}`;
            const response = await fetch(url);
            const data = await response.json();

            if (response.ok && data.success) {
                return data.settings;
            } else {
                return this.settings;
            }
        } catch (error) {
            console.error('[ChatToolSettings] Error loading chat-specific settings:', error);
            return this.settings;
        }
    }

    // Load and apply chat-specific settings (called after chatId becomes available)
    async loadAndApplyChatSettings(chatId) {
        if (!this.userId || !chatId) {
            return;
        }

        try {
            this.isLoading = true;  // Prevent auto-saves during load
            const settings = await this.loadChatSettings(chatId);
            
            // Always apply the settings if they were fetched, regardless of object comparison
            if (settings) {
                this.settings = { ...this.settings, ...settings };
                // Skip auto-correction when applying loaded settings to preserve user's choices
                this.applySettingsToUI(true);
            }
        } catch (error) {
            console.error('[ChatToolSettings] Error loading and applying chat-specific settings:', error);
        } finally {
            this.isLoading = false;  // Allow auto-saves after load complete
        }
    }

    // Admin utility method
    async correctAllNonPremiumUsers() {
        if (!this.userId) return;

        try {
            const response = await fetch('/api/chat-tool-settings/correct-non-premium', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const data = await response.json();
            
            if (data.success) {
                if (window.showNotification) {
                    showNotification(`Corrected ${data.correctedCount} non-premium users' settings`, 'success');
                }
            }
        } catch (error) {
            console.error('Error correcting non-premium users:', error);
        }
    }

    // Enhanced Model loading and selection methods
    async loadAvailableModels() {
        if (!this.userId) {
            console.warn('No user ID available for loading models');
            this.showModelError('User ID not available');
            return;
        }

        try {
            const response = await fetch(`/api/chat-tool-settings/models/${this.userId}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to load models');
            }

            this.availableModels = data.models;
            this.isPremium = data.isPremium;
            this.renderModels();

        } catch (error) {
            console.error('Error loading available models:', error);
            this.showModelError(error.message);
        }
    }

    renderModels() {
        const container = document.getElementById('models-container');
        if (!container) return;

        if (Object.keys(this.availableModels).length === 0) {
            this.showModelError('No models available');
            return;
        }

        // Separate free and premium models based on category
        const freeModels = {};
        const premiumModels = {};

        Object.entries(this.availableModels).forEach(([key, model]) => {
            if (model.category === 'premium') {
                premiumModels[key] = model;
            } else {
                // All non-premium models are considered free
                freeModels[key] = model;
            }
        });

        let html = '<div class="settings-model-sections">';

        // Render free models section
        if (Object.keys(freeModels).length > 0) {
            html += `
                <div class="settings-subsection">
                    <h6 class="settings-subsection-title fw-semibold mb-3">
                        <i class="bi bi-cpu me-2"></i>
                        ${this.t('freeModels')}
                    </h6>
                    <div class="settings-description text-muted mb-3">
                        ${this.t('freeModelsDescription')}
                    </div>
                    <div class="settings-model-grid">
                        ${this.renderModelOptions(freeModels, false)}
                    </div>
                </div>
            `;
        }

        // Render premium models section
        if (Object.keys(premiumModels).length > 0) {
            html += `
                <div class="settings-subsection">
                    <h6 class="settings-subsection-title fw-semibold mb-3">
                        <i class="bi bi-crown-fill premium-icon me-2 text-warning"></i>
                        ${this.t('premiumModels')}
                    </h6>
                    <div class="settings-description text-muted mb-3">
                        ${this.t('premiumModelsDescription')}
                    </div>
                    <div class="settings-model-grid settings-model-grid--premium">
                        ${this.renderModelOptions(premiumModels, true)}
                    </div>
                    ${!this.isPremium ? `
                        <div class="premium-feature-indicator mt-3">
                            <small class="text-warning d-block">
                                <i class="bi bi-star-fill me-1"></i> 
                                ${this.t('premiumModelsPremiumFeature')}
                            </small>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        html += '</div>';
        container.innerHTML = html;
    }

    renderModelOptions(models, isPremium) {
        return Object.entries(models).map(([key, model]) => {
            const isSelected = key === this.settings.selectedModel;
            const isDisabled = isPremium && !this.isPremium; // Disable premium models for non-premium users
            
            const modelTranslations = this.t(`models.${key}`, {});
            const modelName = modelTranslations.name || model.displayName || model.modelName;
            const modelDescription = modelTranslations.description || model.description;
            const provider = modelTranslations.provider || this.getProviderName(model.provider);
            const speed = modelTranslations.speed || this.getSpeedLabel(key);
            const quality = modelTranslations.quality || this.getQualityLabel(key);

            return `
                <div class="settings-model-option ${isSelected ? 'selected' : ''} ${isPremium ? 'premium-model' : ''} ${isDisabled ? 'disabled' : ''}" 
                     data-model="${key}"
                     style="${isDisabled ? 'opacity: 0.6;' : ''}">
                    ${isPremium ? '<div class="premium-model-badge"><i class="bi bi-crown-fill"></i> Premium</div>' : ''}
                    ${isDisabled ? '<div class="model-lock-overlay"><i class="bi bi-lock-fill"></i> Premium Only</div>' : ''}
                    
                    <div class="settings-model-header">
                        <div class="settings-model-info">
                            <div class="settings-model-name">${modelName}</div>
                            <div class="settings-model-description">${modelDescription}</div>
                            <div class="settings-model-provider">via ${provider}</div>
                        </div>
                    </div>
                    
                    <div class="settings-model-stats">
                        <div class="settings-model-stat">
                            <div class="settings-model-stat-label">Speed</div>
                            <div class="settings-model-stat-value">
                                <span class="speed-indicator speed-${speed.toLowerCase().replace(' ', '-')}">
                                    <span class="speed-dot"></span>
                                    <span class="speed-dot"></span>
                                    <span class="speed-dot"></span>
                                    <span class="speed-dot"></span>
                                </span>
                                ${speed}
                            </div>
                        </div>
                        <div class="settings-model-stat">
                            <div class="settings-model-stat-label">Quality</div>
                            <div class="settings-model-stat-value">${quality}</div>
                        </div>
                        ${isPremium ? `
                            <div class="settings-model-stat">
                                <div class="settings-model-stat-label">Type</div>
                                <div class="settings-model-stat-value">
                                    <i class="bi bi-crown-fill text-warning"></i> Premium
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    getProviderName(provider) {
        const providerNames = {
            'openai': 'OpenAI',
            'novita': 'Novita AI',
            'anthropic': 'Anthropic',
            'google': 'Google AI'
        };
        return providerNames[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
    }

    getSpeedLabel(modelKey) {
        // Check if model has specific speed info
        const model = this.availableModels[modelKey];
        if (model && model.speed) {
            return model.speed;
        }
        
        const speedMap = {
            'deepseek': 'Very Fast',
            'gemma': 'Fast',
            'openai': 'Medium',
            'llama': 'Medium',
            'gpt-4o': 'Fast',
            'claude': 'Fast',
            'gemini': 'Very Fast'
        };
        return speedMap[modelKey] || 'Medium';
    }

    getQualityLabel(modelKey) {
        // Check if model has specific quality info
        const model = this.availableModels[modelKey];
        if (model && model.quality) {
            return model.quality;
        }
        
        const qualityMap = {
            'openai': 'Excellent',
            'llama': 'Excellent',
            'deepseek': 'Excellent',
            'gemma': 'Very Good',
            'gpt-4o': 'Excellent',
            'claude': 'Excellent',
            'gemini': 'Very Good'
        };
        return qualityMap[modelKey] || 'Good';
    }

    showModelError(message) {
        const container = document.getElementById('models-container');
        if (!container) return;

        container.innerHTML = `
            <div class="model-error-container">
                <i class="bi bi-exclamation-triangle fs-3 text-muted mb-3"></i>
                <div class="fw-semibold mb-2">Failed to Load AI Models</div>
                <div class="text-muted mb-3">${message}</div>
                <button type="button" class="model-retry-btn" onclick="window.chatToolSettings.loadAvailableModels()">
                    <i class="bi bi-arrow-clockwise me-1"></i>
                    Retry
                </button>
            </div>
        `;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.chatToolSettings = new ChatToolSettings();
});
