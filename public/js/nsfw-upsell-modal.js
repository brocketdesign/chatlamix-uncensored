/**
 * NSFW Premium Upsell Modal
 * Handles showing the premium upgrade modal when NSFW content is detected
 */

(function() {
    'use strict';
    
    // Track NSFW upsell trigger count (show modal only on second+ trigger)
    let nsfwUpsellTriggerCount = 0;
    
    // Translations cache
    let modalTranslations = null;
    
    /**
     * Get the user's preferred chat language from localStorage or window.lang
     * @returns {string} Language name (english, french, japanese, etc.)
     */
    function getPreferredLanguage() {
        // First check localStorage (set by chat-tool-settings.js)
        const storedLang = localStorage.getItem('preferredChatLanguage');
        if (storedLang) {
            return storedLang.toLowerCase();
        }
        
        // Fallback to window.lang (global site language)
        if (window.lang) {
            const siteLangMap = {
                'en': 'english',
                'fr': 'french',
                'ja': 'japanese',
                'pt': 'portuguese',
                'es': 'spanish',
                'zh': 'chinese',
                'ko': 'korean',
                'th': 'thai',
                'de': 'german',
                'it': 'italian',
                'ru': 'russian',
                'hi': 'hindi'
            };
            return siteLangMap[window.lang] || 'english';
        }
        
        // Default to English
        return 'english';
    }
    
    /**
     * Load translations for the modal
     * @returns {Promise<Object>} Translations object for the specific language
     */
    async function loadTranslations() {
        if (modalTranslations) {
            return modalTranslations;
        }
        
        const lang = getPreferredLanguage();
        
        try {
            const response = await fetch('/locales/nsfw-upsell-modal.json');
            if (response.ok) {
                const allTranslations = await response.json();
                // Return specific language or fallback to english
                modalTranslations = allTranslations[lang] || allTranslations['english'];
                return modalTranslations;
            }
        } catch (error) {
            console.error('[NSFW Upsell] Error loading translations:', error);
        }
        
        // Return default English translations if loading fails
        return getDefaultTranslations();
    }
    
    /**
     * Get default English translations (fallback)
     */
    function getDefaultTranslations() {
        return {
            modalTitle: "Unlock Uncensored Mode",
            headline: "Go All The Way 💋",
            defaultMessage: "Ready for conversations without limits? Premium unlocks uncensored mode for unlimited intimate experiences.",
            messages: {
                suggestive: "Things are getting interesting 😏 Premium unlocks the full experience with no restrictions.",
                explicit_request: "Ready to go further? 🔥 Premium gives you uncensored conversations without limits.",
                insistent_demand: "I see you want more... 💋 Upgrade to Premium and I won't hold back anymore.",
                escalation_pattern: "Looks like you're ready for the next level 😈 Premium unlocks everything.",
                default: "Want to explore without limits? 💕 Premium gives you the full uncensored experience."
            },
            features: {
                uncensored: { title: "100% Uncensored", description: "No filters, no limits on your conversations" },
                private: { title: "Private & Secure", description: "Your conversations stay completely private" },
                instant: { title: "Instant Access", description: "Upgrade now and continue right where you left off" },
                autoImage: { title: "Auto Image Generation", description: "Get images generated automatically in chat" }
            },
            upgradeButton: "Unlock Premium Now 🔥",
            dismissButton: "Maybe later, stay in safe mode"
        };
    }
    
    // Create and inject the modal HTML
    async function createNsfwUpsellModal() {
        const t = await loadTranslations();
        
        const modalHtml = `
        <div class="modal fade" id="nsfwPremiumUpsellModal" tabindex="-1" aria-labelledby="nsfwPremiumUpsellModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 20px; overflow: hidden;">
                    <div class="modal-header border-0 pt-4 px-4">
                        <h5 class="modal-title text-white" id="nsfwPremiumUpsellModalLabel">
                            <i class="bi bi-fire me-2" style="color: #ff6b6b;"></i>${t.modalTitle}
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body px-4 py-3">
                        <div class="text-center mb-4">
                            <div class="upsell-icon-wrapper mb-3">
                                <i class="bi bi-heart-fill text-danger" style="font-size: 3rem;"></i>
                            </div>
                            <h4 class="text-white mb-2">${t.headline}</h4>
                            <p class="text-white-50" id="nsfwUpsellMessage">
                                ${t.defaultMessage}
                            </p>
                        </div>
                        
                        <div class="upsell-features mb-4">
                            <div class="feature-item d-flex align-items-center mb-3">
                                <div class="feature-icon me-3">
                                    <i class="bi bi-unlock-fill text-success"></i>
                                </div>
                                <div>
                                    <strong class="text-white">${t.features.uncensored.title}</strong>
                                    <small class="text-white-50 d-block">${t.features.uncensored.description}</small>
                                </div>
                            </div>
                            <div class="feature-item d-flex align-items-center mb-3">
                                <div class="feature-icon me-3">
                                    <i class="bi bi-shield-fill-check text-primary"></i>
                                </div>
                                <div>
                                    <strong class="text-white">${t.features.private.title}</strong>
                                    <small class="text-white-50 d-block">${t.features.private.description}</small>
                                </div>
                            </div>
                            <div class="feature-item d-flex align-items-center mb-3">
                                <div class="feature-icon me-3">
                                    <i class="bi bi-lightning-fill text-warning"></i>
                                </div>
                                <div>
                                    <strong class="text-white">${t.features.instant.title}</strong>
                                    <small class="text-white-50 d-block">${t.features.instant.description}</small>
                                </div>
                            </div>
                            <div class="feature-item d-flex align-items-center">
                                <div class="feature-icon me-3">
                                    <i class="bi bi-images text-info"></i>
                                </div>
                                <div>
                                    <strong class="text-white">${t.features.autoImage.title}</strong>
                                    <small class="text-white-50 d-block">${t.features.autoImage.description}</small>
                                </div>
                            </div>
                        </div>
                        
                        <div class="upsell-cta text-center">
                            <button type="button" class="btn btn-lg w-100 mb-3" id="nsfwUpsellUpgradeBtn" style="background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%); color: white; border: none; border-radius: 12px; font-weight: 600;">
                                <i class="bi bi-gem me-2"></i>${t.upgradeButton}
                            </button>
                            <button type="button" class="btn btn-link text-white-50 w-100" data-bs-dismiss="modal" id="nsfwUpsellStaySfw">
                                ${t.dismissButton}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <style>
            #nsfwPremiumUpsellModal .upsell-icon-wrapper {
                width: 100px;
                height: 100px;
                border-radius: 50%;
                background: linear-gradient(135deg, rgba(255, 107, 107, 0.2) 0%, rgba(238, 90, 90, 0.2) 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto;
            }
            
            #nsfwPremiumUpsellModal .feature-icon {
                width: 40px;
                height: 40px;
                border-radius: 10px;
                background: rgba(255, 255, 255, 0.1);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            #nsfwPremiumUpsellModal .feature-icon i {
                font-size: 1.2rem;
            }
            
            #nsfwPremiumUpsellModal .upsell-cta .btn-lg {
                padding: 15px 20px;
                font-size: 1.1rem;
            }
            
            #nsfwPremiumUpsellModal .upsell-cta .btn-lg:hover {
                transform: scale(1.02);
                box-shadow: 0 4px 15px rgba(255, 107, 107, 0.4);
            }
        </style>
        `;
        
        // Append modal to body
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = modalHtml;
        document.body.appendChild(modalContainer);
        
        // Add event listener for "stay sfw" button
        const staySfwBtn = document.getElementById('nsfwUpsellStaySfw');
        if (staySfwBtn) {
            staySfwBtn.addEventListener('click', function() {
                recordNsfwUpsellDismissal('stay_sfw');
            });
        }
        
        // Add event listener for upgrade button
        const upgradeBtn = document.getElementById('nsfwUpsellUpgradeBtn');
        if (upgradeBtn) {
            upgradeBtn.addEventListener('click', function() {
                // Close the NSFW upsell modal first
                const nsfwModal = bootstrap.Modal.getInstance(document.getElementById('nsfwPremiumUpsellModal'));
                if (nsfwModal) {
                    nsfwModal.hide();
                }
                // Open the plan page using loadPlanPage function
                if (typeof loadPlanPage === 'function') {
                    loadPlanPage('nsfw_upsell_modal');
                } else {
                    console.warn('[NSFW Upsell] loadPlanPage function not available');
                }
            });
        }
        
        // Add event listener for modal dismiss
        const modal = document.getElementById('nsfwPremiumUpsellModal');
        if (modal) {
            modal.addEventListener('hidden.bs.modal', function() {
                recordNsfwUpsellDismissal('dismissed');
            });
        }
    }
    
    // Record dismissal via API
    async function recordNsfwUpsellDismissal(action) {
        try {
            await fetch('/api/nsfw-upsell/dismiss', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ action })
            });
        } catch (error) {
            console.error('[NSFW Upsell] Error recording dismissal:', error);
        }
    }
    
    // Show the NSFW upsell modal
    async function showNsfwPremiumUpsellModal(nsfwCategory, nsfwScore) {
        // Increment trigger count
        nsfwUpsellTriggerCount++;
        
        // On first trigger, let user continue chatting without showing modal
        if (nsfwUpsellTriggerCount === 1) {
            console.log('[NSFW Upsell] First trigger - allowing user to continue');
            return false; // Return false to indicate modal was not shown
        }
        
        // On second+ trigger, show the modal
        // Create modal if it doesn't exist
        if (!document.getElementById('nsfwPremiumUpsellModal')) {
            await createNsfwUpsellModal();
        }
        
        // Load translations for message customization
        const t = await loadTranslations();
        
        // Customize message based on category
        const messageElement = document.getElementById('nsfwUpsellMessage');
        if (messageElement && t.messages) {
            messageElement.textContent = t.messages[nsfwCategory] || t.messages['default'] || t.defaultMessage;
        }
        
        // Show the modal
        const modalElement = document.getElementById('nsfwPremiumUpsellModal');
        if (modalElement && typeof bootstrap !== 'undefined') {
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
            return true; // Return true to indicate modal was shown
        }
        return false;
    }
    
    // Generic premium upsell modal (fallback)
    async function showPremiumUpsellModal(reason) {
        // For now, redirect to plan page or show NSFW modal
        if (reason === 'nsfw_uncensored' || reason === 'image_auto_generation') {
            await showNsfwPremiumUpsellModal('default', 0);
        } else {
            // Use loadPlanPage function if available
            if (typeof loadPlanPage === 'function') {
                loadPlanPage(reason || 'premium_upsell');
            } else {
                console.warn('[NSFW Upsell] loadPlanPage function not available');
            }
        }
    }
    
    // Expose functions globally
    window.showNsfwPremiumUpsellModal = showNsfwPremiumUpsellModal;
    window.showPremiumUpsellModal = showPremiumUpsellModal;
    
    /**
     * Debug function to manually show the modal from console
     * Usage: 
     * 1. debugShowNsfwUpsell() - Show with default settings
     * 2. debugShowNsfwUpsell('suggestive') - Show with specific NSFW category
     * 3. debugShowNsfwUpsell('explicit_request', 'french') - Show with category and specific language
     * 
     * Supported languages: english, french, japanese, portuguese, spanish, chinese, korean, thai, german, italian, russian, hindi
     */
    window.debugShowNsfwUpsell = async function(category = 'default', lang = null) {
        console.log(`[NSFW Upsell] Debug manual trigger: category=${category}, lang=${lang || 'current'}`);
        
        let originalLang = localStorage.getItem('preferredChatLanguage');
        
        if (lang) {
            localStorage.setItem('preferredChatLanguage', lang);
            window.clearNsfwUpsellTranslationCache();
        }

        // Reset counter or bypass it
        const originalCount = nsfwUpsellTriggerCount;
        nsfwUpsellTriggerCount = 2; // Set to 2 to ensure it shows
        
        await showNsfwPremiumUpsellModal(category, 100);
        
        nsfwUpsellTriggerCount = originalCount; // Restore original count
        
        // Note: If you changed the language for debugging, you might want to switch it back 
        // in the chat settings or via localStorage.setItem('preferredChatLanguage', '...')
        if (lang) {
            console.log(`[NSFW Upsell] Language was temporarily set to "${lang}". Settings cache cleared.`);
        }
    };
    
    // Function to clear translation cache (useful when language changes)
    window.clearNsfwUpsellTranslationCache = function() {
        modalTranslations = null;
        // Remove existing modal so it gets recreated with new translations
        const existingModal = document.getElementById('nsfwPremiumUpsellModal');
        if (existingModal) {
            existingModal.parentElement.remove();
        }
        console.log('[NSFW Upsell] Translation cache cleared');
    };
    
    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            // Modal will be created when needed
        });
    }
})();
