/**
 * Explore Gallery - Mobile-First Instagram-Style Character Discovery
 * 
 * Features:
 * - Vertical swipe to browse different characters
 * - Horizontal swipe to browse images of the same character
 * - NSFW toggle with complete filtering
 * - Lazy loading with infinite scroll
 * - Native app-like smooth animations
 */

class ExploreGallery {
    /**
     * Helper to check if a value represents NSFW content
     * Handles: boolean true, string 'true', string 'on', and any truthy non-false value
     */
    static isNsfwValue(value) {
        if (value === true) return true;
        if (value === 'true') return true;
        if (value === 'on') return true;
        if (value === 1) return true;
        if (value === '1') return true;
        return false;
    }
    
    constructor() {
        // State
        this.characters = [];
        this.currentCharacterIndex = 0;
        this.isLoading = false;
        this.hasMore = true;
        this.page = 1;
        this.limit = 6; // Smooth infinite feel while keeping memory in check
        this.query = window.initialQuery || '';

        // Memory safety: cap number of character slides kept in DOM
        this.maxCharactersInDom = 10; // Slightly larger window for smoother scrolling
        this.pruneBuffer = 2; // keep this many slides behind current

        // Load throttling and prefetch tuning
        this.lastLoadTime = 0;
        this.loadCooldownMs = 500;
        this.prefetchThreshold = 3;

        // Tracking for image upgrades / pruning
        this.lastCharacterIndex = 0;
        this.pruneTimer = null;
        
        // Read showNSFW from sessionStorage first (user's current session preference),
        // then localStorage (persisted preference), then window.showNSFW (server default)
        this.showNSFW = this.getStoredNSFWPreference();
        
        // User state
        this.user = window.user || {};
        this.isPremium = this.user.subscriptionStatus === 'active';
        this.isTemporary = this.user.isTemporary || false;
        
        // Liked images state (per image ID)
        this.likedImages = new Set();
        
        // Swipers
        this.verticalSwiper = null;
        this.horizontalSwipers = new Map();
        
        // Elements
        this.container = document.getElementById('explorePage');
        this.swiperWrapper = document.getElementById('characterSwiperWrapper');
        this.loadingEl = document.getElementById('exploreLoading');
        this.emptyEl = document.getElementById('exploreEmpty');
        this.quickActions = document.getElementById('quickActions');
        this.swipeHint = document.getElementById('swipeHint');
        this.nsfwToggleBtn = document.getElementById('nsfwToggleBtn');
        
        // Current character for quick actions
        this.currentCharacter = null;
        
        // Debounce timer for search
        this.searchDebounce = null;

        // Internal guard for pruning logic
        this.isPruning = false;
        
        this.init();
    }
    
    getStoredNSFWPreference() {
        try {
            // Check sessionStorage first (current session preference)
            const sessionValue = sessionStorage.getItem('showNSFW');
            if (sessionValue !== null) {
                return sessionValue === 'true';
            }
            
            // Then check localStorage (persisted preference)
            const localValue = localStorage.getItem('showNSFW');
            if (localValue !== null) {
                return localValue === 'true';
            }
        } catch (err) {
            console.warn('[ExploreGallery] Failed to read from storage:', err);
        }
        
        // Fall back to server-provided value
        return window.showNSFW || false;
    }
    
    async init() {
        // Update the NSFW button to reflect the current state
        this.updateNSFWButton();
        
        this.setupEventListeners();
        this.checkSwipeHint();
        await this.loadCharacters();
        this.initVerticalSwiper();
        
        // Apply blur states after initial render
        this.updateImageBlurStates();
    }
    
    setupEventListeners() {
        // Search form
        const searchForm = document.getElementById('search-form');
        const searchInput = document.getElementById('search-input');
        
        if (searchForm) {
            searchForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.query = searchInput.value.trim();
                this.resetAndReload();
            });
        }
        
        // Live search with debounce
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this.searchDebounce);
                this.searchDebounce = setTimeout(() => {
                    this.query = e.target.value.trim();
                    this.resetAndReload();
                }, 500);
            });
        }
        
        // Clear search
        const clearBtn = document.getElementById('clearSearch');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                searchInput.value = '';
                this.query = '';
                this.resetAndReload();
            });
        }
        
        // NSFW toggle
        if (this.nsfwToggleBtn) {
            this.nsfwToggleBtn.addEventListener('click', () => this.toggleNSFW());
            this.updateNSFWButton();
        }
        
        // Quick action buttons
        document.getElementById('viewProfileBtn')?.addEventListener('click', () => this.viewProfile());
        document.getElementById('startChatBtn')?.addEventListener('click', () => this.startChat());
        
        // Swipe hint dismiss
        if (this.swipeHint) {
            this.swipeHint.addEventListener('click', () => this.dismissSwipeHint());
            // Also dismiss on any touch
            this.swipeHint.addEventListener('touchstart', () => this.dismissSwipeHint());
        }
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
        
        // Handle visibility change to pause/resume
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.verticalSwiper) {
                this.verticalSwiper.update();
            }
        });
    }
    
    checkSwipeHint() {
        const hasSeenHint = localStorage.getItem('exploreSwipeHintSeen');
        if (hasSeenHint) {
            this.swipeHint?.classList.add('hidden');
        } else {
            // Auto-dismiss after 4 seconds
            setTimeout(() => this.dismissSwipeHint(), 4000);
        }
    }
    
    dismissSwipeHint() {
        if (this.swipeHint && !this.swipeHint.classList.contains('hidden')) {
            this.swipeHint.classList.add('hidden');
            localStorage.setItem('exploreSwipeHintSeen', 'true');
        }
    }
    
    handleKeyboard(e) {
        // Don't handle if user is typing in search
        if (document.activeElement.tagName === 'INPUT') return;
        if (!this.verticalSwiper) return;
        
        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                this.verticalSwiper.slidePrev();
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.verticalSwiper.slideNext();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this.getCurrentHorizontalSwiper()?.slidePrev();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.getCurrentHorizontalSwiper()?.slideNext();
                break;
            case 'Enter':
                e.preventDefault();
                this.startChat();
                break;
        }
    }
    
    getCurrentHorizontalSwiper() {
        const currentSlide = this.verticalSwiper?.slides[this.verticalSwiper.activeIndex];
        if (currentSlide) {
            const charId = currentSlide.dataset.characterId;
            return this.horizontalSwipers.get(charId);
        }
        return null;
    }
    
    async toggleNSFW() {
        // Check if user is premium
        if (!this.isPremium) {
            // Show premium upgrade prompt
            if (typeof loadPlanPage === 'function') {
                loadPlanPage();
            } else {
                window.location.href = '/plan';
            }
            return;
        }
        
        this.showNSFW = !this.showNSFW;
        window.showNSFW = this.showNSFW;
        
        // Save to sessionStorage and localStorage (with error handling)
        try {
            sessionStorage.setItem('showNSFW', this.showNSFW.toString());
            localStorage.setItem('showNSFW', this.showNSFW.toString());
        } catch (err) {
            console.error('[ExploreGallery] Failed to save to storage:', err);
        }
        
        // Update button state
        this.updateNSFWButton();
        
        // Apply or remove blur based on new state
        this.updateImageBlurStates();
        
        // Save preference to server
        try {
            await fetch(`/user/update-nsfw-preference/${this.user._id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `showNSFW=${this.showNSFW}`
            });
        } catch (err) {
            console.error('[ExploreGallery] Failed to save NSFW preference:', err);
        }
    }
    
    updateNSFWButton() {
        if (!this.nsfwToggleBtn) return;
        
        const label = this.nsfwToggleBtn.querySelector('.nsfw-label');
        const icon = this.nsfwToggleBtn.querySelector('i');
        
        if (this.showNSFW) {
            this.nsfwToggleBtn.dataset.nsfw = 'true';
            label.textContent = 'NSFW';
            icon.className = 'bi bi-shield-exclamation';
        } else {
            this.nsfwToggleBtn.dataset.nsfw = 'false';
            label.textContent = 'SFW';
            icon.className = 'bi bi-shield-check';
        }
    }
    
    updateImageBlurStates() {
        // Get all images in the gallery
        const allImages = document.querySelectorAll('.explore-image[data-sfw]');
        
        allImages.forEach(img => {
            const dataSfwAttr = img.getAttribute('data-sfw');
            const isSfw = dataSfwAttr === 'true';
            const imageCard = img.closest('.explore-image-card');
            
            if (!imageCard) return;
            
            // Remove existing overlay if any
            const existingOverlay = imageCard.querySelector('.nsfw-blur-overlay');
            if (existingOverlay) {
                existingOverlay.remove();
            }
            
            // If image is NSFW and we're in SFW mode, apply blur
            if (!isSfw && !this.showNSFW) {
                // Add blur class (CSS will apply the blur effect)
                imageCard.classList.add('nsfw-content', 'nsfw-blurred');
                
                // Add clickable overlay for premium users to toggle back to NSFW mode
                if (this.isPremium && !this.isTemporary) {
                    const overlay = document.createElement('div');
                    overlay.className = 'nsfw-blur-overlay';
                    
                    const content = document.createElement('div');
                    content.className = 'nsfw-blur-content';
                    
                    const icon = document.createElement('i');
                    icon.className = 'bi bi-eye-slash-fill';
                    
                    const text = document.createElement('p');
                    text.textContent = 'NSFW Content';
                    
                    const small = document.createElement('small');
                    small.textContent = 'Click to show all NSFW content';
                    
                    content.appendChild(icon);
                    content.appendChild(text);
                    content.appendChild(small);
                    overlay.appendChild(content);
                    
                    // Clicking overlay toggles NSFW mode globally
                    overlay.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.toggleNSFW();
                    });
                    imageCard.appendChild(overlay);
                }
            } else {
                // Remove blur
                imageCard.classList.remove('nsfw-content', 'nsfw-blurred');
            }
        });
    }
    
    async resetAndReload() {
        this.characters = [];
        this.page = 1;
        this.hasMore = true;
        this.currentCharacterIndex = 0;
        
        // Clear existing slides
        if (this.swiperWrapper) {
            this.swiperWrapper.innerHTML = '';
        }
        
        // Destroy swipers
        this.horizontalSwipers.forEach(swiper => swiper.destroy());
        this.horizontalSwipers.clear();
        if (this.verticalSwiper) {
            this.verticalSwiper.destroy();
            this.verticalSwiper = null;
        }
        
        // Hide quick actions and empty state
        if (this.quickActions) {
            this.quickActions.style.display = 'none';
        }
        if (this.emptyEl) {
            this.emptyEl.style.display = 'none';
        }
        
        // Reload
        this.showLoading();
        await this.loadCharacters();
        this.initVerticalSwiper();
    }
    
    async loadCharacters() {
        if (this.isLoading || !this.hasMore) return;

        const now = Date.now();
        if (this.characters.length > 0 && (now - this.lastLoadTime) < this.loadCooldownMs) {
            return;
        }
        this.lastLoadTime = now;

        this.isLoading = true;
        if (this.characters.length === 0) {
            this.showLoading();
        }

        try {
            const params = new URLSearchParams({
                query: this.query,
                page: this.page,
                limit: this.limit,
                nsfw: this.showNSFW ? 'include' : 'exclude'
            });

            // Use fetchWithState if available (includes user state for personalization)
            const fetchFn = window.fetchWithState || fetch;
            const response = await fetchFn(`/api/gallery/explore?${params}`);

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const data = await response.json();

            if (data.characters && data.characters.length > 0) {
                // Process characters
                const newCharacters = this.processCharacters(data.characters);
                this.characters.push(...newCharacters);
                this.renderCharacterSlides(newCharacters);

                // Track served characters to avoid immediate repeats on refresh/page load
                if (window.ContentDiscovery?.trackCharactersServed) {
                    const servedIds = newCharacters.map(c => c.chatId).filter(Boolean);
                    window.ContentDiscovery.trackCharactersServed(servedIds);
                }

                this.page++;

                // Continue infinite scroll: hasMore is true if we got results
                // Even if backend says hasMore=false, we keep trying (backend might have more on next page)
                this.hasMore = newCharacters.length > 0;
            } else {
                // No more characters found
                this.hasMore = false;

                if (this.characters.length === 0) {
                    this.showEmpty();
                }
            }

            this.hideLoading();

        } catch (err) {
            console.error('[ExploreGallery] Failed to load characters:', err);
            this.hideLoading();

            if (this.characters.length === 0) {
                this.showEmpty();
            } else {
                // On error, allow retry by keeping hasMore true
                this.hasMore = true;
            }
        } finally {
            this.isLoading = false;
        }
    }
    
    processCharacters(characters) {
        // Don't filter out NSFW images - just pass them through
        // Blurring is handled in createCharacterSlide and updateImageBlurStates
        // CRITICAL: Limit images per character to prevent mobile memory crashes
        const MAX_IMAGES_PER_CHARACTER = 3;
        return characters.map(char => ({
            ...char,
            images: (char.images || []).slice(0, MAX_IMAGES_PER_CHARACTER)
        })).filter(char => char.images.length > 0);
    }
    
    renderCharacterSlides(characters) {
        if (!this.swiperWrapper) return;
        
        characters.forEach(char => {
            const slide = this.createCharacterSlide(char);
            this.swiperWrapper.appendChild(slide);
        });
        
        // Update swiper if already initialized
        if (this.verticalSwiper) {
            this.verticalSwiper.update();
        }

        // Initialize or update horizontal swipers for newly added slides
        this.initHorizontalSwipers();

        // Prune offscreen slides to prevent memory pressure on mobile
        this.schedulePrune();
    }
    
    createCharacterSlide(character) {
        const slide = document.createElement('div');
        slide.className = 'swiper-slide character-slide';
        slide.dataset.characterId = character.chatId;
        slide.dataset.currentImageId = character.images[0]?._id || character.images[0]?.imageUrl || '';
        
        const imagesHtml = character.images.map((img, idx) => {
            // Use thumbnail for initial display to reduce memory (full image available via data-full)
            const thumbUrl = img.thumbnailUrl || img.imageUrl || '/img/placeholder.png';
            const fullUrl = img.imageUrl || img.thumbnailUrl || '/img/placeholder.png';
            // Check if image is NSFW using helper (handles boolean, 'true', 'on', etc.)
            const isNsfwImage = ExploreGallery.isNsfwValue(img.nsfw);
            const shouldBlur = isNsfwImage && !this.showNSFW;
            // data-sfw is the inverse of isNsfwImage
            const isSfw = !isNsfwImage;

            // Use placeholder for deferred loading - actual images loaded when slide becomes visible
            const usePlaceholder = idx > 0; // Only first image loads immediately
            return `
                <div class="swiper-slide" data-image-id="${img._id || img.imageUrl}" data-image-model="${img.imageModelId || ''}">
                    <div class="explore-image-card ${isNsfwImage ? 'nsfw-content' : ''} ${shouldBlur ? 'nsfw-blurred' : ''}">
                        <img 
                            src="${usePlaceholder ? '/img/placeholder.png' : thumbUrl}" 
                            data-src="${thumbUrl}"
                            data-full="${fullUrl}"
                            alt="${this.escapeHtml(character.chatName)}"
                            class="explore-image${usePlaceholder ? ' deferred-image' : ''}"
                            data-sfw="${isSfw}"
                            loading="lazy"
                            onerror="this.onerror=null; this.src='/img/placeholder.png';"
                        >
                        ${shouldBlur ? this.createNSFWOverlay() : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        const dotsHtml = this.createImageDots(character.images.length);
        
        slide.innerHTML = `
            <div class="swiper character-images-swiper" data-character-id="${character.chatId}">
                <div class="swiper-wrapper">
                    ${imagesHtml}
                </div>
            </div>
            
            <!-- TikTok-style action buttons (right side, vertical) -->
            <div class="tiktok-actions">
                <span class="tiktok-action-btn heart-btn" 
                        data-chat-id="${character.chatId}"
                        data-id="${character.images[0]?._id || character.images[0]?.imageUrl || ''}"
                        onclick="event.stopPropagation(); window.exploreGallery.handleLikeImage(this);"
                        title="Add to favorites">
                    <div class="action-icon">
                        <i class="bi bi-heart"></i>
                    </div>
                </span>
                <button class="tiktok-action-btn profile-btn" 
                        onclick="event.stopPropagation(); window.location.href='/character/slug/${character.chatSlug}'" 
                        title="View Profile">
                    <div class="action-icon">
                        <i class="bi bi-person"></i>
                    </div>
                </button>
                <button class="tiktok-action-btn chat-btn"
                        onclick="event.stopPropagation(); window.exploreGallery.handleChatClick('${character.chatId}')"
                        title="Open Chat">
                    <div class="action-icon">
                        <i class="bi bi-chat-dots"></i>
                    </div>
                </button>
                ${window.isAdmin ? `
                <div class="admin-actions-divider"></div>
                <button class="tiktok-action-btn admin-btn delete-image-btn"
                        data-chat-id="${character.chatId}"
                        onclick="event.stopPropagation(); window.exploreGallery.handleAdminDeleteImage(this);"
                        title="Delete Current Image">
                    <div class="action-icon">
                        <i class="bi bi-image"></i>
                    </div>
                </button>
                <button class="tiktok-action-btn admin-btn delete-character-btn"
                        data-chat-id="${character.chatId}"
                        onclick="event.stopPropagation(); window.exploreGallery.handleAdminDeleteCharacter(this);"
                        title="Delete Character">
                    <div class="action-icon">
                        <i class="bi bi-trash"></i>
                    </div>
                </button>
                ` : ''}
            </div>
            
            <!-- Image model indicator (admin only) -->
            ${window.isAdmin ? `
            <div class="image-model-indicator">
                <i class="bi bi-gpu-card"></i>
                <span class="model-name">${character.images[0]?.imageModelId || 'Unknown'}</span>
            </div>
            ` : ''}
            
            <!-- Bottom info overlay -->
            <div class="character-info-overlay">
                <div class="character-header">
                    <div class="character-avatar-link">
                        <img 
                            src="${character.chatImageUrl || '/img/default-thumbnail.png'}" 
                            alt="${this.escapeHtml(character.chatName)}"
                            class="character-avatar"
                            onerror="this.src='/img/default-thumbnail.png'"
                        >
                    </div>
                    <div class="character-details">
                        <h3 class="character-name">
                            <a href="/character/slug/${character.chatSlug}" onclick="event.stopPropagation()">${this.escapeHtml(character.chatName)}</a>
                        </h3>
                        <p class="image-counter">
                            <span class="current-image">1</span> / ${character.images.length} images
                        </p>
                    </div>
                </div>
                ${dotsHtml}
            </div>
        `;
        
        return slide;
    }
    
    /**
     * Handle chat button click - redirects to chat or opens login modal
     */
    handleChatClick(chatId) {
        if (this.isTemporary) {
            // Open login modal for non-logged-in users
            if (typeof openLoginForm === 'function') {
                openLoginForm();
            } else {
                window.location.href = '/login';
            }
        } else {
            // Track chat start event
            if (typeof UserTracking !== 'undefined' && UserTracking.trackStartChat) {
                UserTracking.trackStartChat(chatId, 'explore_card', {
                    sourceElementId: null,
                    sourceElementClass: 'explore-gallery-chat'
                });
            }
            // Go to chat for logged-in users
            window.location.href = `/chat/${chatId}`;
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
    
    createNSFWOverlay() {
        if (this.isTemporary || !this.isPremium) {
            return `
                <div class="nsfw-blur-overlay" onclick="event.stopPropagation(); window.exploreGallery.showUpgradePrompt()">
                    <div class="nsfw-blur-content">
                        <i class="bi bi-lock-fill"></i>
                        <p>Premium content</p>
                    </div>
                </div>
            `;
        }
        return '';
    }
    
    createImageDots(count) {
        if (count <= 1) return '';
        
        const maxDots = Math.min(count, 8);
        const dots = Array(maxDots).fill(0).map((_, i) => 
            `<div class="image-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>`
        ).join('');
        
        if (count > maxDots) {
            return `<div class="image-pagination">${dots}<span class="more-indicator">+${count - maxDots}</span></div>`;
        }
        
        return `<div class="image-pagination">${dots}</div>`;
    }
    
    initVerticalSwiper() {
        if (!this.swiperWrapper || this.characters.length === 0) {
            this.hideLoading();
            return;
        }
        
        this.verticalSwiper = new Swiper('#characterSwiper', {
            direction: 'vertical',
            slidesPerView: 1,
            spaceBetween: 0,
            mousewheel: {
                forceToAxis: true,
                sensitivity: 1
            },
            keyboard: {
                enabled: true,
                onlyInViewport: true
            },
            touchEventsTarget: 'container',
            threshold: 5,
            resistanceRatio: 0.9,
            touchRatio: 1,
            longSwipesRatio: 0.2,
            longSwipesMs: 150,
            shortSwipes: true,
            touchReleaseOnEdges: true,
            speed: 400,
            effect: 'slide',
            on: {
                slideChangeTransitionEnd: () => this.onCharacterChange(),
                reachEnd: () => this.onReachEnd()
            }
        });
        
        // Initialize horizontal swipers for each character
        this.initHorizontalSwipers();
        
        // Show quick actions
        if (this.quickActions && this.characters.length > 0) {
            this.quickActions.style.display = 'flex';
            this.updateCurrentCharacter();
        }

        // Ensure the first visible image is upgraded to full resolution
        this.loadDeferredImagesForActiveCharacter();
        this.promoteActiveImageToFullRes();
    }
    
    initHorizontalSwipers() {
        // Only initialize swipers for current and adjacent slides to save memory
        const currentIndex = this.verticalSwiper?.activeIndex || 0;
        const indicesToInit = [currentIndex - 1, currentIndex, currentIndex + 1].filter(i => i >= 0);
        
        indicesToInit.forEach(slideIndex => {
            const slide = this.verticalSwiper?.slides?.[slideIndex];
            if (!slide) return;
            
            const container = slide.querySelector('.character-images-swiper');
            if (!container) return;
            
            const charId = container.dataset.characterId;
            if (this.horizontalSwipers.has(charId)) return;
            
            // Load deferred images for this slide
            this.loadDeferredImages(container);
            
            const swiper = new Swiper(container, {
                direction: 'horizontal',
                slidesPerView: 1,
                spaceBetween: 0,
                nested: true,
                touchEventsTarget: 'container',
                threshold: 20,
                resistanceRatio: 0.85,
                speed: 300,
                lazy: true,
                on: {
                    slideChange: (s) => this.onImageChange(charId, s.activeIndex)
                }
            });
            
            this.horizontalSwipers.set(charId, swiper);
            
            // Update heart button state for the first image
            this.updateHeartButtonForImage(container, 0);
            
            // Setup double-tap to like on images (only once)
            if (!container.dataset.doubleTapInit) {
                this.setupDoubleTapLike(container);
                container.dataset.doubleTapInit = 'true';
            }
        });
    }
    
    /**
     * Load deferred images for a container
     */
    loadDeferredImages(container) {
        const deferredImages = container.querySelectorAll('img.deferred-image');
        deferredImages.forEach(img => {
            if (img.dataset.src && img.src.includes('placeholder')) {
                img.src = img.dataset.src;
                img.classList.remove('deferred-image');
            }
        });
    }

    /**
     * Load deferred thumbnails for the active character slide
     */
    loadDeferredImagesForActiveCharacter() {
        const slide = this.verticalSwiper?.slides?.[this.verticalSwiper.activeIndex];
        const container = slide?.querySelector('.character-images-swiper');
        if (container) {
            this.loadDeferredImages(container);
        }
    }

    /**
     * Promote the active image to full resolution
     */
    promoteActiveImageToFullRes() {
        const slide = this.verticalSwiper?.slides?.[this.verticalSwiper.activeIndex];
        if (!slide) return;

        const activeIndex = this.getActiveImageIndexForSlide(slide);
        this.promoteImageToFullRes(slide, activeIndex);
        this.demoteInactiveImages(slide, activeIndex);
    }

    getActiveImageIndexForSlide(slide) {
        const charId = slide?.dataset?.characterId;
        if (!charId) return 0;
        const swiper = this.horizontalSwipers.get(charId);
        return swiper ? swiper.activeIndex : 0;
    }

    promoteImageToFullRes(slide, imageIndex) {
        if (!slide) return;
        const imageSlides = Array.from(slide.querySelectorAll('.character-images-swiper .swiper-slide'));
        const imageSlide = imageSlides[imageIndex];
        const img = imageSlide?.querySelector('img.explore-image');
        if (!img || !img.dataset.full) return;

        if (img.src !== img.dataset.full) {
            img.src = img.dataset.full;
            img.dataset.fullLoaded = 'true';
        }
    }

    demoteInactiveImages(slide, activeIndex) {
        if (!slide) return;
        const images = Array.from(slide.querySelectorAll('img.explore-image'));
        images.forEach((img, idx) => {
            if (idx === activeIndex) return;
            if (img.dataset.fullLoaded === 'true' && img.dataset.src) {
                img.src = img.dataset.src;
                delete img.dataset.fullLoaded;
            }
        });
    }

    demoteFullResForSlide(slide) {
        if (!slide) return;
        const images = Array.from(slide.querySelectorAll('img.explore-image'));
        images.forEach(img => {
            if (img.dataset.fullLoaded === 'true' && img.dataset.src) {
                img.src = img.dataset.src;
                delete img.dataset.fullLoaded;
            }
        });
    }
    
    /**
     * Setup double-tap to like on images
     */
    setupDoubleTapLike(container) {
        const slide = container.closest('.character-slide');
        if (!slide) return;

        let lastTapTime = 0;
        let lastTapX = 0;
        let lastTapY = 0;

        // Touch events for mobile
        container.addEventListener('touchend', (e) => {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTapTime;

            // Get current touch point
            if (e.changedTouches.length > 0) {
                const touch = e.changedTouches[0];
                const currentX = touch.clientX;
                const currentY = touch.clientY;

                // Check if it's a double tap (within 300ms and same location within 30px)
                const distance = Math.sqrt(
                    Math.pow(currentX - lastTapX, 2) +
                    Math.pow(currentY - lastTapY, 2)
                );

                if (tapLength < 300 && tapLength > 0 && distance < 30) {
                    e.preventDefault();

                    // Create floating heart animation at tap position
                    this.createDoubleTapHearts(currentX, currentY, slide);

                    // Trigger like on the heart button
                    const heartBtn = slide.querySelector('.tiktok-action-btn.heart-btn');
                    if (heartBtn) {
                        this.handleLikeImage(heartBtn);
                    }
                }

                lastTapTime = currentTime;
                lastTapX = currentX;
                lastTapY = currentY;
            }
        });

        // Double-click support for desktop
        container.addEventListener('dblclick', (e) => {
            e.preventDefault();

            // Create floating heart animation at click position
            this.createDoubleTapHearts(e.clientX, e.clientY, slide);

            // Trigger like on the heart button
            const heartBtn = slide.querySelector('.tiktok-action-btn.heart-btn');
            if (heartBtn) {
                this.handleLikeImage(heartBtn);
            }
        });
    }

    /**
     * Create floating hearts animation at double-tap position
     */
    createDoubleTapHearts(x, y, slide) {
        const numHearts = 3;
        const animations = ['floatHeart', 'floatHeartLeft', 'floatHeartRight'];

        for (let i = 0; i < numHearts; i++) {
            const heart = document.createElement('div');
            heart.className = `double-tap-heart heart-${i + 1}`;

            // Check if Bootstrap Icons are available, otherwise use emoji
            const testIcon = document.createElement('i');
            testIcon.className = 'bi bi-heart-fill';
            testIcon.style.position = 'absolute';
            testIcon.style.visibility = 'hidden';
            document.body.appendChild(testIcon);
            const computedStyle = window.getComputedStyle(testIcon);
            const hasBootstrapIcons = computedStyle.fontFamily.includes('bootstrap-icons');
            document.body.removeChild(testIcon);

            // Use Bootstrap icon or emoji fallback
            if (hasBootstrapIcons) {
                heart.innerHTML = '<i class="bi bi-heart-fill"></i>';
            } else {
                heart.innerHTML = '❤️';
            }

            // Use fixed positioning to work with clientX/clientY coordinates
            heart.style.position = 'fixed';
            heart.style.left = `${x}px`;
            heart.style.top = `${y}px`;
            heart.style.zIndex = '999999';

            // Apply animation for each heart
            heart.style.animation = `${animations[i]} 1s ease-out forwards`;
            heart.style.animationDelay = `${i * 0.1}s`;

            // Add to body for proper fixed positioning
            document.body.appendChild(heart);

            // Remove after animation completes
            setTimeout(() => {
                if (heart.parentNode) {
                    heart.remove();
                }
            }, 1200 + (i * 100));
        }
    }

    /**
     * Update heart button for a specific image
     */
    updateHeartButtonForImage(container, imageIndex) {
        const slide = container.closest('.character-slide');
        if (!slide) return;
        
        const imageSlidesArray = Array.from(slide.querySelectorAll('.character-images-swiper .swiper-slide'));
        if (!imageSlidesArray[imageIndex]) return;
        
        const imageId = imageSlidesArray[imageIndex].dataset.imageId;
        const heartBtn = slide.querySelector('.tiktok-action-btn.heart-btn');
        
        if (heartBtn && imageId) {
            heartBtn.dataset.id = imageId;
            this.syncHeartButtonState(heartBtn, imageId);
        }
    }
    
    /**
     * Synchronize heart button state with the actual like status
     */
    syncHeartButtonState(heartBtn, imageId) {
        if (!heartBtn || !imageId) return;
        
        // Check current icon state
        const icon = heartBtn.querySelector('.action-icon i');
        if (!icon) return;
        
        // Check if we have this image's like state stored locally
        const isLiked = this.likedImages && this.likedImages.has(imageId);
        
        // Update the heart button to match the stored state
        if (isLiked) {
            heartBtn.classList.add('liked');
            icon.classList.remove('bi-heart');
            icon.classList.add('bi-heart-fill');
            icon.classList.add('text-danger');
        } else {
            heartBtn.classList.remove('liked');
            icon.classList.remove('bi-heart-fill');
            icon.classList.remove('text-danger');
            icon.classList.add('bi-heart');
        }
    }
    
    /**
     * Handle like/unlike image with proper state management and notification
     */
    handleLikeImage(buttonEl) {
        // Check if user is temporary
        if (this.isTemporary) {
            if (typeof openLoginForm === 'function') {
                openLoginForm();
            }
            return;
        }
        
        const imageId = buttonEl.dataset.id;
        const chatId = buttonEl.dataset.chatId;
        if (!imageId) return;
        
        const icon = buttonEl.querySelector('.action-icon i');
        if (!icon) return;
        
        // Determine current state and toggle
        const isCurrentlyLiked = this.likedImages.has(imageId);
        const action = isCurrentlyLiked ? 'unlike' : 'like';
        
        // Update local state FIRST
        if (action === 'like') {
            this.likedImages.add(imageId);
        } else {
            this.likedImages.delete(imageId);
        }
        
        // Update UI immediately
        this.syncHeartButtonState(buttonEl, imageId);
        
        // Show notification for likes
        if (action === 'like') {
            if (typeof showNotification === 'function') {
                const message = window.translations?.like_grant_points?.replace('{point}', '1') || 'Image liked! +1 point';
                showNotification(message, 'success');
            }
        }
        
        // Make API call
        fetch(`/gallery/${imageId}/like-toggle`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ action, userChatId: chatId })
        }).catch(err => {
            console.error('[ExploreGallery] Failed to toggle like:', err);
            // Revert state on error
            if (action === 'like') {
                this.likedImages.delete(imageId);
            } else {
                this.likedImages.add(imageId);
            }
            this.syncHeartButtonState(buttonEl, imageId);
        });
    }
    
    onCharacterChange() {
        const previousIndex = this.currentCharacterIndex;
        this.currentCharacterIndex = this.verticalSwiper.activeIndex;

        // Demote previous slide's full-res images back to thumbnails to reduce memory
        if (previousIndex !== this.currentCharacterIndex) {
            const prevSlide = this.verticalSwiper.slides[previousIndex];
            this.demoteFullResForSlide(prevSlide);
        }

        this.updateCurrentCharacter();

        // Track character view
        this.trackCharacterView();

        // Initialize horizontal swiper for new slides
        this.initHorizontalSwipers();

        // Load deferred thumbnails for active slide and upgrade active image to full res
        this.loadDeferredImagesForActiveCharacter();
        this.promoteActiveImageToFullRes();

        // Preload next characters
        this.preloadNextCharacters();

        // Load more characters when approaching the end (5 characters before the end)
        const remainingCharacters = this.characters.length - this.currentCharacterIndex;
        if (remainingCharacters <= this.prefetchThreshold && this.hasMore && !this.isLoading) {
            console.log('[ExploreGallery] Approaching end, preloading more characters...');
            this.loadCharacters();
        }

        // Prune offscreen slides to prevent DOM/image bloat on mobile
        this.schedulePrune();
    }

    schedulePrune() {
        if (this.pruneTimer) {
            clearTimeout(this.pruneTimer);
        }
        this.pruneTimer = setTimeout(() => {
            if (!this.verticalSwiper || this.verticalSwiper.destroyed) return;
            if (this.verticalSwiper.animating) {
                this.schedulePrune();
                return;
            }
            this.pruneSlides();
        }, 200);
    }

    /**
     * Prune far-off slides to avoid mobile browser crashes due to memory pressure.
     * Keeps a sliding window of slides around the current index.
     */
    pruneSlides() {
        if (this.isPruning || !this.verticalSwiper) return;
        if (this.verticalSwiper.animating) return;

        const totalSlides = this.verticalSwiper.slides.length;
        if (totalSlides <= this.maxCharactersInDom) return;

        this.isPruning = true;

        const currentIndex = this.verticalSwiper.activeIndex;
        const keepStart = Math.max(0, currentIndex - this.pruneBuffer);
        const keepEnd = Math.min(totalSlides - 1, keepStart + this.maxCharactersInDom - 1);
        const adjustedKeepStart = Math.max(0, keepEnd - this.maxCharactersInDom + 1);

        // Safety: always keep the current slide and its immediate neighbors
        const protectedStart = Math.max(0, currentIndex - 1);
        const protectedEnd = Math.min(totalSlides - 1, currentIndex + 1);

        const indexesToRemove = [];
        for (let i = 0; i < totalSlides; i++) {
            if ((i < adjustedKeepStart || i > keepEnd) && (i < protectedStart || i > protectedEnd)) {
                indexesToRemove.push(i);
            }
        }

        if (indexesToRemove.length === 0) {
            this.isPruning = false;
            return;
        }

        // Clean up horizontal swipers for removed slides
        indexesToRemove.forEach(index => {
            const slide = this.verticalSwiper.slides[index];
            if (!slide) return;
            const charId = slide.dataset.characterId;
            const swiper = this.horizontalSwipers.get(charId);
            if (swiper) {
                swiper.destroy(true, true);
                this.horizontalSwipers.delete(charId);
            }
        });

        // Remove associated character data (remove from end to start)
        indexesToRemove
            .slice()
            .sort((a, b) => b - a)
            .forEach(index => {
                if (this.characters[index]) {
                    this.characters.splice(index, 1);
                }
            });

        // Remove slides from Swiper and update
        this.verticalSwiper.removeSlide(indexesToRemove);
        this.verticalSwiper.update();

        // Sync current index after removal
        this.currentCharacterIndex = this.verticalSwiper.activeIndex;
        this.updateCurrentCharacter();

        this.isPruning = false;
    }
    
    preloadNextCharacters() {
        // Preload images for next 2 characters
        const nextIndices = [
            this.currentCharacterIndex + 1,
            this.currentCharacterIndex + 2
        ];
        
        nextIndices.forEach(idx => {
            if (idx < this.characters.length) {
                const char = this.characters[idx];
                if (char && char.images && char.images.length > 0) {
                    const preloadUrl = char.images[0].thumbnailUrl;
                    if (preloadUrl) {
                        const img = new Image();
                        img.src = preloadUrl;
                    }
                }
            }
        });
    }
    
    onImageChange(charId, imageIndex) {
        // Update image counter
        const slide = document.querySelector(`.character-slide[data-character-id="${charId}"]`);
        if (slide) {
            const counter = slide.querySelector('.current-image');
            if (counter) {
                counter.textContent = imageIndex + 1;
            }
            
            // Update dots
            const dots = slide.querySelectorAll('.image-dot');
            dots.forEach((dot, i) => {
                dot.classList.toggle('active', i === imageIndex);
            });
            
            // Update the heart button with the new image ID
            const imageSlidesArray = Array.from(slide.querySelectorAll('.character-images-swiper .swiper-slide'));
            if (imageSlidesArray[imageIndex]) {
                const newImageId = imageSlidesArray[imageIndex].dataset.imageId;
                const newImageModel = imageSlidesArray[imageIndex].dataset.imageModel;
                const heartBtn = slide.querySelector('.tiktok-action-btn.heart-btn');
                if (heartBtn && newImageId) {
                    heartBtn.dataset.id = newImageId;
                    slide.dataset.currentImageId = newImageId;
                    
                    // Synchronize heart button state with the actual like status
                    this.syncHeartButtonState(heartBtn, newImageId);
                }
                
                // Update model indicator (admin only)
                const modelIndicator = slide.querySelector('.image-model-indicator .model-name');
                if (modelIndicator) {
                    modelIndicator.textContent = newImageModel || 'Unknown';
                }
            }

            // Promote active image to full resolution and demote inactive images
            this.promoteImageToFullRes(slide, imageIndex);
            this.demoteInactiveImages(slide, imageIndex);
        }
    }
    
    onReachEnd() {
        // Load more characters when reaching near the end
        if (this.hasMore && !this.isLoading) {
            console.log('[ExploreGallery] Reached end, loading more characters...');
            this.loadCharacters();
        }
    }
    
    updateCurrentCharacter() {
        const char = this.characters[this.currentCharacterIndex];
        if (char) {
            this.currentCharacter = char;
        }
    }
    
    /**
     * Track character view for personalization
     */
    trackCharacterView() {
        if (!this.currentCharacter) return;
        
        // Gather data to track
        const characterId = this.currentCharacter.chatId;
        const imageIds = (this.currentCharacter.images || []).map(img => img._id || img.imageUrl);
        const tags = this.currentCharacter.chatTags || [];
        
        // Use ContentDiscovery tracker if available
        if (window.ContentDiscovery) {
            window.ContentDiscovery.trackCharacterView(characterId, imageIds.slice(0, 5), tags);
        }
        
        // For logged-in users, also send to server (async, don't wait)
        if (!this.isTemporary) {
            this.sendTrackingToServer(characterId, imageIds.slice(0, 5), tags);
        }
    }
    
    /**
     * Send tracking data to server (for logged-in users)
     */
    async sendTrackingToServer(characterId, imageIds, tags) {
        try {
            await fetch('/api/gallery/track/character-view', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    characterId,
                    imageIds,
                    tags
                })
            });
        } catch (error) {
            // Silent fail - tracking is not critical
            console.debug('[ExploreGallery] Failed to send tracking:', error);
        }
    }
    
    // Quick Actions
    viewProfile() {
        if (this.currentCharacter) {
            this.openProfile(this.currentCharacter.chatId);
        }
    }
    
    startChat() {
        if (this.currentCharacter) {
            this.goToChat(this.currentCharacter.chatSlug);
        }
    }
    
    /**
     * Handle image favorite button click
     */
    handleImageFavorite(button, chatId) {
        // Check if user is logged in
        if (this.isTemporary) {
            // Open login modal for non-logged-in users
            if (typeof openLoginForm === 'function') {
                openLoginForm();
            } else {
                window.location.href = '/login';
            }
            return;
        }
        
        // Toggle favorite status
        const isCurrentlyLiked = button.classList.contains('liked');
        
        // Optimistic UI update
        if (isCurrentlyLiked) {
            button.classList.remove('liked');
            const icon = button.querySelector('.action-icon i');
            if (icon) {
                icon.classList.remove('bi-heart-fill');
                icon.classList.add('bi-heart');
            }
        } else {
            button.classList.add('liked');
            const icon = button.querySelector('.action-icon i');
            if (icon) {
                icon.classList.remove('bi-heart');
                icon.classList.add('bi-heart-fill');
            }
        }
        
        // Call favorites API
        if (typeof Favorites !== 'undefined') {
            Favorites.toggleFavorite(chatId, (response) => {
                // Update UI based on actual response
                if (response && response.success) {
                    const actualState = response.isFavorited;
                    
                    // Ensure UI matches actual state
                    if (actualState) {
                        button.classList.add('liked');
                        const icon = button.querySelector('.action-icon i');
                        if (icon) {
                            icon.classList.remove('bi-heart');
                            icon.classList.add('bi-heart-fill');
                        }
                    } else {
                        button.classList.remove('liked');
                        const icon = button.querySelector('.action-icon i');
                        if (icon) {
                            icon.classList.remove('bi-heart-fill');
                            icon.classList.add('bi-heart');
                        }
                    }
                } else {
                    // Revert optimistic update on error
                    if (isCurrentlyLiked) {
                        button.classList.add('liked');
                        const icon = button.querySelector('.action-icon i');
                        if (icon) {
                            icon.classList.remove('bi-heart');
                            icon.classList.add('bi-heart-fill');
                        }
                    } else {
                        button.classList.remove('liked');
                        const icon = button.querySelector('.action-icon i');
                        if (icon) {
                            icon.classList.remove('bi-heart-fill');
                            icon.classList.add('bi-heart');
                        }
                    }
                }
            });
        }
    }
    
    openProfile(chatId) {
        if (typeof openCharacterIntroModal === 'function') {
            openCharacterIntroModal(chatId);
        } else {
            window.location.href = `/character/${chatId}`;
        }
    }
    
    goToChat(slug) {
        window.location.href = `/character/slug/${slug}`;
    }
    
    showUpgradePrompt() {
        if (typeof loadPlanPage === 'function') {
            loadPlanPage();
        } else {
            window.location.href = '/plan';
        }
    }
    
    // Admin actions
    handleAdminDeleteImage(btn) {
        const slide = btn.closest('.character-slide');
        if (!slide) return;
        const chatId = btn.dataset.chatId;
        const currentImageSlide = slide.querySelector('.character-images-swiper .swiper-slide-active');
        const imageId = currentImageSlide?.dataset?.imageId;
        if (!imageId) {
            alert('No image selected');
            return;
        }
        if (!confirm('Delete this image? This cannot be undone.')) return;

        btn.style.opacity = '0.5';
        btn.style.pointerEvents = 'none';
        fetch(`/api/admin/delete-image/${chatId}/${imageId}`, {
            method: 'DELETE',
            credentials: 'same-origin'
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                // Remove the image slide
                if (currentImageSlide) currentImageSlide.remove();
                // Update horizontal swiper
                const swiperEl = slide.querySelector('.character-images-swiper');
                if (swiperEl?.swiper) swiperEl.swiper.update();
                alert('Image deleted');
            } else {
                alert(data.error || 'Failed to delete image');
            }
        })
        .catch(() => alert('Failed to delete image'))
        .finally(() => {
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
        });
    }

    handleAdminDeleteCharacter(btn) {
        const chatId = btn.dataset.chatId;
        if (!chatId) return;
        if (!confirm('Delete this character and all their data? This cannot be undone.')) return;

        btn.style.opacity = '0.5';
        btn.style.pointerEvents = 'none';
        fetch(`/api/delete-chat/${chatId}`, {
            method: 'DELETE',
            credentials: 'same-origin'
        })
        .then(r => r.json())
        .then(data => {
            if (data.message || data.success) {
                // Remove the character slide and move to next
                const slide = btn.closest('.character-slide');
                if (slide) slide.remove();
                if (this.verticalSwiper) this.verticalSwiper.update();
                alert('Character deleted');
            } else {
                alert(data.error || 'Failed to delete character');
            }
        })
        .catch(() => alert('Failed to delete character'))
        .finally(() => {
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
        });
    }

    // UI States
    showLoading() {
        if (this.loadingEl) {
            this.loadingEl.style.display = 'flex';
        }
        if (this.emptyEl) {
            this.emptyEl.style.display = 'none';
        }
    }
    
    hideLoading() {
        if (this.loadingEl) {
            this.loadingEl.style.display = 'none';
        }
    }
    
    showEmpty() {
        if (this.emptyEl) {
            this.emptyEl.style.display = 'flex';
        }
        if (this.loadingEl) {
            this.loadingEl.style.display = 'none';
        }
        if (this.quickActions) {
            this.quickActions.style.display = 'none';
        }
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.exploreGallery = new ExploreGallery();
});

// Debug function to test heart animation from console
window.testHeartAnimation = function(x, y) {
    console.log('🧪 Testing heart animation...');

    // Check if Font Awesome is loaded
    const testIcon = document.createElement('i');
    testIcon.className = 'fas fa-heart';
    document.body.appendChild(testIcon);
    const computedStyle = window.getComputedStyle(testIcon);
    const isFontAwesome = computedStyle.fontFamily.includes('Font Awesome');
    document.body.removeChild(testIcon);
    console.log('📦 Font Awesome loaded:', isFontAwesome);

    // Use center of screen if no coordinates provided
    if (x === undefined || y === undefined) {
        x = window.innerWidth / 2;
        y = window.innerHeight / 2;
        console.log(`📍 Using center of screen: (${x}, ${y})`);
    }

    const numHearts = 3;
    const animations = ['floatHeart', 'floatHeartLeft', 'floatHeartRight'];

    for (let i = 0; i < numHearts; i++) {
        const heart = document.createElement('div');
        heart.className = `double-tap-heart heart-${i + 1}`;

        // Use both icon and text as fallback
        heart.innerHTML = '<i class="fas fa-heart"></i>';
        if (!isFontAwesome) {
            heart.innerHTML = '❤️'; // Fallback to emoji
            console.warn('⚠️ Font Awesome not detected, using emoji fallback');
        }

        // Use fixed positioning
        heart.style.position = 'fixed';
        heart.style.left = `${x}px`;
        heart.style.top = `${y}px`;
        heart.style.zIndex = '999999';

        // Apply animation
        heart.style.animation = `${animations[i]} 1s ease-out forwards`;
        heart.style.animationDelay = `${i * 0.1}s`;

        console.log(`❤️ Heart ${i + 1} created:`, {
            position: heart.style.position,
            left: heart.style.left,
            top: heart.style.top,
            zIndex: heart.style.zIndex,
            animation: heart.style.animation,
            className: heart.className,
            innerHTML: heart.innerHTML
        });

        // Add to body
        document.body.appendChild(heart);

        // Log computed styles after adding to DOM
        const computed = window.getComputedStyle(heart);
        console.log(`🎨 Heart ${i + 1} computed styles:`, {
            position: computed.position,
            left: computed.left,
            top: computed.top,
            zIndex: computed.zIndex,
            opacity: computed.opacity,
            visibility: computed.visibility,
            display: computed.display,
            fontSize: computed.fontSize,
            color: computed.color
        });

        // Remove after animation
        setTimeout(() => {
            if (heart.parentNode) {
                heart.remove();
                console.log(`🗑️ Heart ${i + 1} removed`);
            }
        }, 1200 + (i * 100));
    }

    console.log('✅ Heart animation test complete! Hearts should be visible now.');
};
