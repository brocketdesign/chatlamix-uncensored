/**
 * User Behavior Tracking - Client Side
 * 
 * This module provides client-side tracking functions for user behavior analytics.
 * It tracks: Start Chat, Message Sent, Premium View, and User Location
 * 
 * Include this script in pages where tracking is needed.
 * 
 * Usage:
 * - UserTracking.trackStartChat(chatId, source, options)
 * - UserTracking.trackMessageSent(chatId, options)
 * - UserTracking.trackPremiumView(source, options)
 * - UserTracking.saveLocation()
 */

(function(window) {
  'use strict';

  /**
   * Chat start source identifiers - must match backend
   */
  const ChatStartSources = {
    CHARACTER_INTRO_MODAL: 'character_intro_modal',
    CHARACTER_PAGE: 'character_page',
    CHAT_LIST: 'chat_list',
    HOME_FEATURED: 'home_featured',
    HOME_CAROUSEL: 'home_carousel',
    EXPLORE_CARD: 'explore_card',
    SEARCH_RESULTS: 'search_results',
    RECOMMENDATION: 'recommendation',
    COLD_ONBOARDING: 'cold_onboarding',
    CHARACTER_CREATION: 'character_creation',
    PAYMENT_SUCCESS: 'payment_success',
    DIRECT_URL: 'direct_url',
    UNKNOWN: 'unknown'
  };

  /**
   * Premium view source identifiers - must match backend
   */
  const PremiumViewSources = {
    CHAT_TOOL_SETTINGS: 'chat_tool_settings',
    IMAGE_GENERATION: 'image_generation',
    DASHBOARD_GENERATION: 'dashboard_generation',
    SETTINGS_PAGE: 'settings_page',
    CHARACTER_CREATION: 'character_creation',
    CREATOR_APPLICATION: 'creator_application',
    AFFILIATION_DASHBOARD: 'affiliation_dashboard',
    CIVITAI_SEARCH: 'civitai_search',
    EARLY_NSFW_UPSELL: 'early_nsfw_upsell',
    WEBSOCKET_TRIGGER: 'websocket_trigger',
    MENU_UPGRADE: 'menu_upgrade',
    UNKNOWN: 'unknown'
  };

  /**
   * Main UserTracking object
   */
  const UserTracking = {
    // Expose source constants
    ChatStartSources: ChatStartSources,
    PremiumViewSources: PremiumViewSources,

    // Debug mode flag
    debug: false,

    /**
     * Enable/disable debug logging
     */
    setDebug: function(enabled) {
      this.debug = enabled;
    },

    /**
     * Log message if debug mode is enabled
     */
    log: function(...args) {
      if (this.debug) {
        console.log('[UserTracking]', ...args);
      }
    },

    /**
     * Track a "Start Chat" event
     * @param {string} chatId - The chat ID being started
     * @param {string} source - Source identifier from ChatStartSources
     * @param {Object} options - Additional options
     * @param {string} options.sourceElementId - ID of the clicked element
     * @param {string} options.sourceElementClass - Class of the clicked element
     * @returns {Promise<Object>} API response
     */
    trackStartChat: async function(chatId, source, options = {}) {
      try {
        this.log('Tracking start chat:', { chatId, source, options });

        const payload = {
          chatId: chatId,
          source: source || ChatStartSources.UNKNOWN,
          sourceElementId: options.sourceElementId || null,
          sourceElementClass: options.sourceElementClass || null,
          pageUrl: window.location.href,
          referrer: document.referrer || null
        };

        const response = await fetch('/api/tracking/start-chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        this.log('Start chat tracked successfully:', result);
        return result;
      } catch (error) {
        console.error('[UserTracking] Error tracking start chat:', error);
        return { success: false, error: error.message };
      }
    },

    /**
     * Track a "Message Sent" event
     * @param {string} chatId - The chat ID where message was sent
     * @param {Object} options - Additional options
     * @param {string} options.messageType - Type of message (text, image, etc.)
     * @param {boolean} options.hasImage - Whether message contains an image
     * @returns {Promise<Object>} API response
     */
    trackMessageSent: async function(chatId, options = {}) {
      try {
        this.log('Tracking message sent:', { chatId, options });

        const payload = {
          chatId: chatId,
          messageType: options.messageType || 'text',
          hasImage: options.hasImage || false
        };

        const response = await fetch('/api/tracking/message-sent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        this.log('Message sent tracked successfully:', result);
        return result;
      } catch (error) {
        console.error('[UserTracking] Error tracking message sent:', error);
        return { success: false, error: error.message };
      }
    },

    /**
     * Track a "Premium View" event (when premium modal is shown)
     * @param {string} source - Source identifier from PremiumViewSources
     * @param {Object} options - Additional options
     * @param {string} options.triggerAction - Action that triggered the modal
     * @returns {Promise<Object>} API response
     */
    trackPremiumView: async function(source, options = {}) {
      try {
        this.log('Tracking premium view:', { source, options });

        const payload = {
          source: source || PremiumViewSources.UNKNOWN,
          triggerAction: options.triggerAction || null,
          pageUrl: window.location.href
        };

        const response = await fetch('/api/tracking/premium-view', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        this.log('Premium view tracked successfully:', result);
        return result;
      } catch (error) {
        console.error('[UserTracking] Error tracking premium view:', error);
        return { success: false, error: error.message };
      }
    },

    /**
     * Track an "Early NSFW Upsell" event
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} API response
     */
    trackEarlyNsfwUpsell: async function(options = {}) {
      try {
        this.log('Tracking early NSFW upsell:', options);

        const payload = {
          chatId: options.chatId || null,
          userChatId: options.userChatId || null,
          severity: options.severity || 'none',
          confidence: options.confidence ?? null,
          reason: options.reason || null,
          userIntent: options.userIntent || null
        };

        const response = await fetch('/api/tracking/early-nsfw-upsell', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        this.log('Early NSFW upsell tracked successfully:', result);
        return result;
      } catch (error) {
        console.error('[UserTracking] Error tracking early NSFW upsell:', error);
        return { success: false, error: error.message };
      }
    },

    /**
     * Save user location based on IP
     * Uses server-side IP detection, with client-side ipinfo.io as fallback
     * @returns {Promise<Object>} API response with location data
     */
    saveLocation: async function() {
      try {
        this.log('Saving user location...');

        // First try server-side detection
        const response = await fetch('/api/tracking/location', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({}) // Send empty body to avoid 400 error
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        let result = await response.json();
        
        // If server detected localhost/local IP, use client-side geolocation as fallback
        if (result.success && result.location && (result.location.isLocal || result.location.ip === '127.0.0.1')) {
          this.log('Server detected localhost, trying client-side geolocation...');
          try {
            const ipInfoResponse = await fetch('https://ipinfo.io/json?token=');
            const ipInfoData = await ipInfoResponse.json();
            
            if (ipInfoData && ipInfoData.ip) {
              // Parse coordinates
              let latitude = 0, longitude = 0;
              if (ipInfoData.loc) {
                const [lat, lon] = ipInfoData.loc.split(',');
                latitude = parseFloat(lat) || 0;
                longitude = parseFloat(lon) || 0;
              }
              
              // Save the client-detected location to server
              const saveResponse = await fetch('/api/tracking/location', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                  clientDetectedLocation: {
                    ip: ipInfoData.ip,
                    country: ipInfoData.country || 'Unknown',
                    countryCode: ipInfoData.country || 'XX',
                    region: ipInfoData.region || 'Unknown',
                    city: ipInfoData.city || 'Unknown',
                    latitude: latitude,
                    longitude: longitude,
                    timezone: ipInfoData.timezone || 'UTC',
                    isp: ipInfoData.org || 'Unknown',
                    isLocal: false
                  }
                })
              });
              
              if (saveResponse.ok) {
                result = await saveResponse.json();
                this.log('Client-side location saved successfully');
              }
            }
          } catch (ipInfoError) {
            this.log('Client-side geolocation fallback failed:', ipInfoError.message);
          }
        }
        
        this.log('Location saved successfully:', result);
        return result;
      } catch (error) {
        console.error('[UserTracking] Error saving location:', error);
        return { success: false, error: error.message };
      }
    },

    /**
     * Get user location
     * @returns {Promise<Object>} Location data
     */
    getLocation: async function() {
      try {
        const response = await fetch('/api/tracking/location', {
          method: 'GET',
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        console.error('[UserTracking] Error getting location:', error);
        return null;
      }
    },

    /**
     * Get tracking stats for current user
     * @returns {Promise<Object>} User tracking stats
     */
    getMyStats: async function() {
      try {
        const response = await fetch('/api/tracking/my-stats', {
          method: 'GET',
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        console.error('[UserTracking] Error getting stats:', error);
        return null;
      }
    },

    /**
     * Detect chat start source from element attributes
     * @param {HTMLElement} element - The clicked element
     * @returns {string} Source identifier
     */
    detectChatStartSource: function(element) {
      if (!element) return ChatStartSources.UNKNOWN;

      // Check for data-tracking-source attribute first
      const trackingSource = element.dataset.trackingSource || 
                            element.closest('[data-tracking-source]')?.dataset.trackingSource;
      if (trackingSource && ChatStartSources[trackingSource.toUpperCase().replace(/-/g, '_')]) {
        return trackingSource;
      }

      // Check for specific classes
      const classList = element.classList;
      const parentClasses = element.closest('a, button')?.classList || [];

      // Character intro modal
      if (classList.contains('track-chat-start-character-intro') || 
          element.closest('#characterIntroModal')) {
        return ChatStartSources.CHARACTER_INTRO_MODAL;
      }

      // Character page
      if (classList.contains('track-chat-start-character-page') ||
          element.closest('.character-page, .character-detail')) {
        return ChatStartSources.CHARACTER_PAGE;
      }

      // Chat list
      if (classList.contains('track-chat-start-chat-list') ||
          element.closest('.chat-list, #chatList')) {
        return ChatStartSources.CHAT_LIST;
      }

      // Home featured
      if (classList.contains('track-chat-start-home-featured') ||
          element.closest('.featured-characters, .home-featured')) {
        return ChatStartSources.HOME_FEATURED;
      }

      // Home carousel
      if (classList.contains('track-chat-start-home-carousel') ||
          element.closest('.carousel, .swiper')) {
        return ChatStartSources.HOME_CAROUSEL;
      }

      // Explore card
      if (classList.contains('track-chat-start-explore-card') ||
          element.closest('.explore-card, .character-card')) {
        return ChatStartSources.EXPLORE_CARD;
      }

      // Search results
      if (classList.contains('track-chat-start-search-results') ||
          element.closest('.search-results')) {
        return ChatStartSources.SEARCH_RESULTS;
      }

      // Recommendation
      if (classList.contains('track-chat-start-recommendation') ||
          element.closest('.recommendations, .recommended')) {
        return ChatStartSources.RECOMMENDATION;
      }

      // Cold onboarding
      if (window.location.pathname.includes('onboarding') ||
          classList.contains('track-chat-start-cold-onboarding')) {
        return ChatStartSources.COLD_ONBOARDING;
      }

      // Payment success
      if (window.location.pathname.includes('payment-success') ||
          classList.contains('track-chat-start-payment-success')) {
        return ChatStartSources.PAYMENT_SUCCESS;
      }

      return ChatStartSources.UNKNOWN;
    },

    /**
     * Detect premium view source from context
     * @param {string} context - Optional context hint
     * @returns {string} Source identifier
     */
    detectPremiumViewSource: function(context) {
      // Check for explicit context
      if (context && PremiumViewSources[context.toUpperCase().replace(/-/g, '_')]) {
        return context;
      }

      // Detect from current page/state
      const pathname = window.location.pathname;

      if (pathname.includes('/chat')) {
        return PremiumViewSources.CHAT_TOOL_SETTINGS;
      }
      if (pathname.includes('/admin/upsell-analytics')) {
        return PremiumViewSources.EARLY_NSFW_UPSELL;
      }
      if (pathname.includes('/generation') || pathname.includes('/dashboard/generation')) {
        return PremiumViewSources.DASHBOARD_GENERATION;
      }
      if (pathname.includes('/settings')) {
        return PremiumViewSources.SETTINGS_PAGE;
      }
      if (pathname.includes('/character') && pathname.includes('/create')) {
        return PremiumViewSources.CHARACTER_CREATION;
      }
      if (pathname.includes('/creator') || pathname.includes('/apply')) {
        return PremiumViewSources.CREATOR_APPLICATION;
      }
      if (pathname.includes('/affiliation')) {
        return PremiumViewSources.AFFILIATION_DASHBOARD;
      }

      return PremiumViewSources.UNKNOWN;
    },

    /**
     * Initialize click tracking for chat start buttons
     * Call this on page load to automatically track chat start clicks
     */
    initChatStartTracking: function() {
      this.log('Initializing chat start tracking...');

      // Track clicks on elements with tracking classes
      document.addEventListener('click', (event) => {
        const target = event.target;
        
        // Check if clicked element or parent is a chat start link
        const chatLink = target.closest('[data-tracking-source], [class*="track-chat-start"]');
        if (!chatLink) return;

        // Extract chat ID from href
        const href = chatLink.href || chatLink.dataset.chatId;
        if (!href) return;

        const chatIdMatch = href.match(/\/chat\/([a-f0-9]+)/i);
        const chatId = chatIdMatch ? chatIdMatch[1] : (chatLink.dataset.chatId || null);

        if (chatId) {
          const source = this.detectChatStartSource(chatLink);
          this.trackStartChat(chatId, source, {
            sourceElementId: chatLink.id || null,
            sourceElementClass: chatLink.className || null
          });
        }
      });

      this.log('Chat start tracking initialized');
    },

    /**
     * Initialize automatic location saving
     * Saves location once per session
     */
    initLocationTracking: function() {
      const locationSaved = sessionStorage.getItem('userLocationSaved');
      if (!locationSaved) {
        this.saveLocation().then(result => {
          if (result.success) {
            sessionStorage.setItem('userLocationSaved', 'true');
          }
        });
      }
    },

    /**
     * Initialize all tracking
     */
    init: function() {
      this.log('Initializing UserTracking...');
      
      // Wait for DOM ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          this.initChatStartTracking();
          this.initLocationTracking();
        });
      } else {
        this.initChatStartTracking();
        this.initLocationTracking();
      }
      
      this.log('UserTracking initialized');
    }
  };

  // Expose to global scope
  window.UserTracking = UserTracking;

  // Auto-initialize if user is logged in
  if (typeof user !== 'undefined' && user && user._id && !user.isTemporary) {
    UserTracking.init();
  }

})(window);
