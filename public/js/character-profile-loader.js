/**
 * Character Profile Loader
 * Handles loading and initialization of character profile data
 */

// Constants for similar characters pagination
const SIMILAR_CHARACTERS_INITIAL_PAGE = 1;
const SIMILAR_CHARACTERS_LIMIT = 10;
const SIMILAR_CHARACTERS_SCROLL_THRESHOLD = 200; // px from right edge to trigger load

/**
 * Load all character data (images, stats, similar characters, etc.)
 */
function loadCharacterData(chatId) {
    // Show loading state for counts immediately
    showCountLoadingState();
    
    // Get current content type (default to SFW)
    const contentType = window.characterProfile.contentType || 'SFW';
    
    // Fetch total counts immediately (before lazy loading content)
    fetchCharacterImageCount(chatId, contentType);
    fetchCharacterVideoCount(chatId);
    
    loadCharacterImages(chatId, contentType);
    loadCharacterStats(chatId);
    loadSimilarCharacters(chatId);
    loadCharacterPersonality();
    
    if (typeof loadChatUsers === 'function') {
        loadChatUsers(chatId);
    }
}

/**
 * Initialize content type toggle (SFW/NSFW)
 */
function initializeContentTypeToggle() {
    const toggleContainer = document.getElementById('contentTypeToggle');
    if (!toggleContainer) {
        console.log('[initializeContentTypeToggle] Toggle container not found');
        return;
    }
    
    const showNsfwCheckbox = document.getElementById('showNsfwCharacterImages');
    if (!showNsfwCheckbox) {
        console.log('[initializeContentTypeToggle] Checkbox not found');
        return;
    }

    // Set initial state based on current content type
    showNsfwCheckbox.checked = window.characterProfile.contentType === 'NSFW';

    showNsfwCheckbox.addEventListener('change', function() {
        const selectedType = this.checked ? 'NSFW' : 'SFW';

        // If already selected, do nothing
        if (selectedType === window.characterProfile.contentType) {
            return;
        }

        // Update character profile content type
        window.characterProfile.contentType = selectedType;

        // Clear the images grid and show loading state
        const imagesGrid = document.getElementById('imagesGrid');
        if (imagesGrid) {
            imagesGrid.innerHTML = `
                <div class="loading-grid">
                    <div class="loading-item"></div>
                    <div class="loading-item"></div>
                    <div class="loading-item"></div>
                    <div class="loading-item"></div>
                    <div class="loading-item"></div>
                    <div class="loading-item"></div>
                </div>
            `;
        }

        // Load images for the selected content type
        const chatId = window.characterProfile.currentChatId;
        if (chatId) {
            loadCharacterImages(chatId, selectedType);
            fetchCharacterImageCount(chatId, selectedType);
        }
    });
}

/**
 * Load character images with load more button (pagination)
 * Does NOT use infinite scroll - only loads first page initially
 * Supports content_type filtering (SFW/NSFW)
 */
function loadCharacterImages(chatId, contentType = 'SFW') {
    const cacheKey = `chat_${chatId}_${contentType}`;
    
    if (window.characterProfile.imagesLoading) {
        return;
    }
    
    // Get the pagination state for the current content type
    const paginationState = contentType === 'SFW' 
        ? window.characterProfile.sfwPagination 
        : window.characterProfile.nsfwPagination;
    
    // Wait for loadChatImages to be available (it's loaded from dashboard-infinite-scroll.js)
    if (typeof loadChatImages !== 'function') {
        // Retry after a short delay (scripts may still be loading)
        setTimeout(() => {
            loadCharacterImages(chatId, contentType);
        }, 100);
        return;
    }
    
    // Also check if chatImageManager is ready
    if (typeof window.chatImageManager === 'undefined') {
        setTimeout(() => {
            loadCharacterImages(chatId, contentType);
        }, 100);
        return;
    }
    
    window.characterProfile.imagesLoading = true;
    window.loadedImages = [];
    
    loadChatImages(chatId, 1, true, false, contentType)
        .then((images) => {
            const manager = window.chatImageManager;
                            
            // Get the actual state from cache manager after fetch completes
            const actualCurrentPage = manager.currentPages.get(cacheKey) || 1;
            const actualTotalPages = manager.totalPages.get(cacheKey) || 1;
            const hasCache = manager.cache.has(cacheKey);
                                            
            // Display images directly - pass chatId for data-chat-id attribute
            // Only call displayImagesInGrid if we have images to display, otherwise keep the loading state
            if (images && images.length > 0) {
                displayImagesInGrid(images, chatId);
            } else {
                // No images found - show the "no images" message after confirming API call completed
                const grid = document.getElementById('imagesGrid');
                if (grid && grid.querySelector('.loading-grid')) {
                    // Replace loading grid with "no images available" message
                    grid.innerHTML = `<div style="padding: 60px 20px; text-align: center; color: #999; grid-column: 1/-1; font-size: 0.95rem;">
                        <i class="bi bi-image" style="font-size: 2rem; margin-bottom: 10px; opacity: 0.5; display: block;"></i>
                        No images available
                    </div>`;
                }
            }
                
            // Re-read the state AGAIN after display, in case totalPages was just updated
            const finalCurrentPage = manager.currentPages.get(cacheKey) || 1;
            const finalTotalPages = manager.totalPages.get(cacheKey) || 1;
            
            // Sync pagination state with actual cache state AFTER display
            paginationState.currentPage = finalCurrentPage;
            paginationState.totalPages = finalTotalPages;
            
            // After loading first page, update button visibility USING FINAL STATE
            updateLoadMoreButton(chatId, contentType);
            window.characterProfile.imagesLoading = false;
            
        })
        .catch((error) => {
            window.characterProfile.imagesLoading = false;
            // On error, show "no images available" message instead of spinner
            const grid = document.getElementById('imagesGrid');
            if (grid) {
                grid.innerHTML = `<div style="padding: 60px 20px; text-align: center; color: #999; grid-column: 1/-1; font-size: 0.95rem;">
                    <i class="bi bi-image" style="font-size: 2rem; margin-bottom: 10px; opacity: 0.5; display: block;"></i>
                    No images available
                </div>`;
            }
        });
}

/**
 * Load next page of character images
 * Supports content_type filtering (SFW/NSFW)
 */
function loadMoreCharacterImages(chatId, contentType = 'SFW') {
    const cacheKey = `chat_${chatId}_${contentType}`;
    
    // Use the actual cache manager to get real state, not characterProfile
    const manager = window.chatImageManager;
    const currentPageFromCache = manager.currentPages.get(cacheKey) || 0;
    const totalPagesFromCache = manager.totalPages.get(cacheKey) || 0;
    const isLoading = manager.loadingStates.get(cacheKey);
    
    if (isLoading) {
        return;
    }
    
    const nextPage = currentPageFromCache + 1;
    
    // Check if there are more pages
    if (nextPage > totalPagesFromCache) {
        return;
    }
    
    // Get the pagination state for the current content type
    const paginationState = contentType === 'SFW' 
        ? window.characterProfile.sfwPagination 
        : window.characterProfile.nsfwPagination;
    
    if (typeof loadChatImages === 'function') {
        window.characterProfile.imagesLoading = true;
        
        // Load next page WITHOUT reload flag - this will render images and append to grid
        loadChatImages(chatId, nextPage, false, false, contentType)
            .then((images) => {
                const imagesCount = (window.loadedImages || []).length;
                
                // Get updated cache state after fetch
                const updatedCurrentPage = manager.currentPages.get(cacheKey) || nextPage;
                const updatedTotalPages = manager.totalPages.get(cacheKey) || totalPagesFromCache;
               
                // Append new images to existing grid - pass chatId for data-chat-id attribute
                displayMoreImagesInGrid(images, chatId);
                
                // Re-read state ONE MORE TIME before updating UI (totalPages might have just updated)
                const finalCurrentPage = manager.currentPages.get(cacheKey) || nextPage;
                const finalTotalPages = manager.totalPages.get(cacheKey) || totalPagesFromCache;
                
                // Sync pagination state with actual cache state
                paginationState.currentPage = finalCurrentPage;
                paginationState.totalPages = finalTotalPages;
                
                // Update button visibility USING FINAL STATE
                updateLoadMoreButton(chatId, contentType);
                // Hide loading spinner
                if (typeof hideLoadMoreButtonSpinner === 'function') {
                    hideLoadMoreButtonSpinner('images');
                }
                window.characterProfile.imagesLoading = false;
            })
            .catch((error) => {
                // Hide loading spinner on error
                if (typeof hideLoadMoreButtonSpinner === 'function') {
                    hideLoadMoreButtonSpinner('images');
                }
                window.characterProfile.imagesLoading = false;
            });
    }
}

/**
 * Load videos with lazy loading support (pagination, no infinite scroll)
 */
function loadVideos() {
    const chatId = window.characterProfile.currentChatId;
    const cacheKey = `chatVideo_${chatId}`;
    
    if (window.characterProfile.videosLoading || window.characterProfile.videosLoaded) {
        return;
    }
    
    // Initialize pagination state for videos
    if (!window.characterProfile.videosCurrentPage) {
        window.characterProfile.videosCurrentPage = 0;
        window.characterProfile.videosTotalPages = 0;
    }
    
    if (chatId && typeof loadChatVideos === 'function') {
        window.characterProfile.videosLoading = true;
        window.loadedVideos = [];
        
        loadChatVideos(chatId, 1, true)
            .then(() => {
                const videosCount = (window.loadedVideos || []).length;
                
                const manager = window.chatImageManager;
                const actualCurrentPage = manager.currentPages.get(cacheKey) || 1;
                const actualTotalPages = manager.totalPages.get(cacheKey) || 1;
                
                setTimeout(() => {
                    displayVideosInGrid();
                    
                    const finalCurrentPage = manager.currentPages.get(cacheKey) || 1;
                    const finalTotalPages = manager.totalPages.get(cacheKey) || 1;
                    
                    window.characterProfile.videosCurrentPage = finalCurrentPage;
                    window.characterProfile.videosTotalPages = finalTotalPages;
                    
                    updateLoadMoreVideoButton(chatId);
                    
                    fetchCharacterVideoCount(chatId);
                    
                    window.characterProfile.videosLoading = false;
                    window.characterProfile.videosLoaded = true;
                }, 800);
            })
            .catch((error) => {
                window.characterProfile.videosLoading = false;
                displayVideosInGrid();
            });
    }
}

/**
 * Fetch total image count from server
 * Supports content_type filtering (SFW/NSFW)
 */
async function fetchCharacterImageCount(chatId, contentType = 'SFW') {
    const cacheKey = `chat_${chatId}_${contentType}`;
    
    try {
        // Build URL with URLSearchParams for robust query string handling
        const url = new URL(`/chat/${chatId}/images`, window.location.origin);
        url.searchParams.set('page', '1');
        url.searchParams.set('content_type', contentType);
        
        const response = await fetch(url.toString());
        if (response.ok) {
            const data = await response.json();
            const totalCount = data.totalImages || 0;
            const totalPages = data.totalPages || 1;
            
            // Get the pagination state for the current content type
            const paginationState = contentType === 'SFW' 
                ? window.characterProfile.sfwPagination 
                : window.characterProfile.nsfwPagination;
            
            // Update pagination state
            paginationState.totalPages = totalPages;
            
            // Wait for cache manager to be initialized, then update it
            let attempts = 0;
            const waitForCacheManager = setInterval(() => {
                const manager = window.chatImageManager;
                
                if (manager && manager.totalPages && manager.totalPages.has(cacheKey)) {
                    manager.totalPages.set(cacheKey, totalPages);
                    clearInterval(waitForCacheManager);
                } else if (attempts > 50) {
                    clearInterval(waitForCacheManager);
                }
                attempts++;
            }, 100);
            
            // Update UI count display only if viewing this content type
            if (contentType === window.characterProfile.contentType) {
                updateCharacterImageCount(totalCount);
            }
            
            // Update button visibility
            updateLoadMoreButton(chatId, contentType);
        } else {
            const paginationState = contentType === 'SFW' 
                ? window.characterProfile.sfwPagination 
                : window.characterProfile.nsfwPagination;
            paginationState.totalPages = 0;
            
            if (contentType === window.characterProfile.contentType) {
                updateCharacterImageCount(0);
            }
        }
    } catch (error) {
        const paginationState = contentType === 'SFW' 
            ? window.characterProfile.sfwPagination 
            : window.characterProfile.nsfwPagination;
        paginationState.totalPages = 0;
        
        if (contentType === window.characterProfile.contentType) {
            updateCharacterImageCount(0);
        }
    }
}

/**
 * Fetch total video count from server
 */
async function fetchCharacterVideoCount(chatId) {
    const cacheKey = `chatVideo_${chatId}`;
    
    try {
        const response = await fetch(`/chat/${chatId}/videos?page=1`);
        if (response.ok) {
            const data = await response.json();
            const totalCount = data.totalVideos || 0;
            const totalPages = data.totalPages || 1;
            
            // Update characterProfile
            window.characterProfile.totalVideos = totalCount;
            window.characterProfile.videosTotalPages = totalPages;
            
            // Update UI count display
            updateCharacterVideoCount(totalCount);
            
            // Update button visibility
            updateLoadMoreVideoButton(chatId);
        } else {
            window.characterProfile.totalVideos = 0;
            window.characterProfile.videosTotalPages = 0;
            updateCharacterVideoCount(0);
        }
    } catch (error) {
        window.characterProfile.totalVideos = 0;
        window.characterProfile.videosTotalPages = 0;
        updateCharacterVideoCount(0);
    }
}

/**
 * Load character stats
 */
/**
 * Load character stats (global counts - all messages, images, videos)
 */
function loadCharacterStats(chatId) {
    fetch(`/api/character-stats/${chatId}`)
        .then(response => {
            if (response.ok) {
                return response.json();
            }
            throw new Error('Failed to fetch character stats');
        })
        .then(data => {
            if (data.success && data.stats) {
                // Update messages count
                const messagesCount = data.stats.messagesCount || 0;
                const messagesElement = document.getElementById('messagesCount');
                if (messagesElement) {
                    messagesElement.classList.remove('count-loading');
                    messagesElement.textContent = messagesCount.toLocaleString();
                }
                
                // Update image count
                const imageCount = data.stats.imageCount || 0;
                const imageElement = document.getElementById('imagesCount');
                if (imageElement) {
                    imageElement.classList.remove('count-loading');
                    imageElement.textContent = imageCount.toLocaleString();
                }
                
                // Update video count
                const videoCount = data.stats.videoCount || 0;
                const videoElement = document.getElementById('videosCount');
                if (videoElement) {
                    videoElement.classList.remove('count-loading');
                    videoElement.textContent = videoCount.toLocaleString();
                }
            }
        })
        .catch(error => {
            console.error('[loadCharacterStats] Error:', error);
            // Fallback: display 0 if fetch fails and hide loading state
            const messagesElement = document.getElementById('messagesCount');
            if (messagesElement) {
                messagesElement.classList.remove('count-loading');
                messagesElement.textContent = '0';
            }
            
            const imageElement = document.getElementById('imagesCount');
            if (imageElement) {
                imageElement.classList.remove('count-loading');
                imageElement.textContent = '0';
            }
            
            const videoElement = document.getElementById('videosCount');
            if (videoElement) {
                videoElement.classList.remove('count-loading');
                videoElement.textContent = '0';
            }
        });
}

/**
 * Load similar characters with pagination support
 * Initializes the first page of similar characters and sets up infinite scroll
 * 
 * @param {string} chatId - The ID of the current character
 */
function loadSimilarCharacters(chatId) {
    // Ensure characterProfile exists
    if (!window.characterProfile) {
        window.characterProfile = {};
    }
    
    // Initialize pagination state
    // State structure:
    // - currentPage: Current page number (1-indexed to match backend)
    // - totalPages: Total number of pages available
    // - hasMore: Whether there are more pages to load
    // - loading: Flag to prevent multiple simultaneous requests
    // - chatId: ID of the character for which we're loading similar characters
    // - scrollListener: Reference to scroll event handler for cleanup
    if (!window.characterProfile.similarCharacters) {
        window.characterProfile.similarCharacters = {
            currentPage: SIMILAR_CHARACTERS_INITIAL_PAGE,  // Start from page 1 to match backend pagination
            totalPages: 1,
            hasMore: true,
            loading: false,
            chatId: chatId,
            scrollListener: null
        };
    }
    
    // Show loading spinner
    showSimilarCharactersLoader();
    
    if (typeof fetchSimilarChats === 'function') {
        fetchSimilarChats(chatId, SIMILAR_CHARACTERS_INITIAL_PAGE, SIMILAR_CHARACTERS_LIMIT).then(response => {
            // Handle new paginated response format
            const characters = response.similarChats || response;
            const pagination = response.pagination || {};
            
            // Update pagination state
            window.characterProfile.similarCharacters.currentPage = pagination.currentPage || SIMILAR_CHARACTERS_INITIAL_PAGE;
            window.characterProfile.similarCharacters.totalPages = pagination.totalPages || 1;
            window.characterProfile.similarCharacters.hasMore = pagination.hasMore || false;
            
            displaySimilarCharacters(characters, false); // false = don't append, replace
            // Hide loading spinner
            hideSimilarCharactersLoader();
            
            // Initialize scroll listener for infinite scroll
            initializeSimilarCharactersScroll(chatId);
        }).catch(error => {
            // Hide loading spinner on error
            hideSimilarCharactersLoader();
        });
    }
}

/**
 * Load more similar characters (for infinite scroll)
 */
function loadMoreSimilarCharacters(chatId) {
    const state = window.characterProfile.similarCharacters;
    
    // Don't load if already loading or no more pages
    if (state.loading || !state.hasMore) {
        return;
    }
    
    const nextPage = state.currentPage + 1;
    
    // Set loading state
    state.loading = true;
    
    if (typeof fetchSimilarChats === 'function') {
        fetchSimilarChats(chatId, nextPage, SIMILAR_CHARACTERS_LIMIT).then(response => {
            // Handle new paginated response format
            const characters = response.similarChats || response;
            const pagination = response.pagination || {};
            
            // Update pagination state
            state.currentPage = pagination.currentPage || nextPage;
            state.totalPages = pagination.totalPages || state.totalPages;
            state.hasMore = pagination.hasMore || false;
            state.loading = false;
            
            // Append new characters to existing grid
            displaySimilarCharacters(characters, true); // true = append
        }).catch(error => {
            state.loading = false;
            console.error('Failed to load more similar characters:', error);
        });
    }
}

/**
 * Initialize scroll listener for similar characters infinite scroll
 * Detects when user scrolls near the end of the horizontal scroll and loads more characters
 */
function initializeSimilarCharactersScroll(chatId) {
    const grid = document.getElementById('similarCharactersGrid');
    if (!grid) return;
    
    // Store listener reference in characterProfile state for proper cleanup
    const state = window.characterProfile.similarCharacters;
    
    // Remove existing listener if any
    if (state.scrollListener) {
        grid.removeEventListener('scroll', state.scrollListener);
    }
    
    // Create new scroll listener
    state.scrollListener = function() {
        // Check if we're near the end (within threshold of the right edge)
        const scrollLeft = grid.scrollLeft;
        const scrollWidth = grid.scrollWidth;
        const clientWidth = grid.clientWidth;
        const distanceFromEnd = scrollWidth - (scrollLeft + clientWidth);
        
        if (distanceFromEnd < SIMILAR_CHARACTERS_SCROLL_THRESHOLD && state.hasMore && !state.loading) {
            console.log('[SimilarCharacters] Near end of scroll, loading more...');
            loadMoreSimilarCharacters(chatId);
        }
    };
    
    grid.addEventListener('scroll', state.scrollListener);
}

/**
 * Load character personality traits
 */
function loadCharacterPersonality() {
    const personalityContainer = document.getElementById('characterPersonality');
    if (!personalityContainer) return;
    
    try {
        // This will be populated by the template with chat data
        const chatElement = document.querySelector('[data-chat-personality]');
        if (chatElement && chatElement.dataset.chatPersonality) {
            const personality = JSON.parse(chatElement.dataset.chatPersonality || '{}');
            if (personality && personality.base_personality) {
                const html = generatePersonalityHTML(personality.base_personality);
                personalityContainer.innerHTML = html;
            }
        }
    } catch (error) {
        // ignore parse errors
    }
}

/**
 * Show loading state for count displays
 */
function showCountLoadingState() {
    const imagesCount = document.getElementById('imagesCount');
    const videosCount = document.getElementById('videosCount');
    const messagesCount = document.getElementById('messagesCount');
    
    if (imagesCount) {
        imagesCount.classList.add('count-loading');
        imagesCount.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
    }
    
    if (videosCount) {
        videosCount.classList.add('count-loading');
        videosCount.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
    }
    
    if (messagesCount) {
        messagesCount.classList.add('count-loading');
        messagesCount.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
    }
}

/**
 * Hide loading state from count displays
 */
function hideCountLoadingState() {
    const imagesCount = document.getElementById('imagesCount');
    const videosCount = document.getElementById('videosCount');
    const messagesCount = document.getElementById('messagesCount');
    
    if (imagesCount) {
        imagesCount.classList.remove('count-loading');
    }
    
    if (videosCount) {
        videosCount.classList.remove('count-loading');
    }
    
    if (messagesCount) {
        messagesCount.classList.remove('count-loading');
    }
}

/**
 * Fetch similar chats with pagination
 */
async function fetchSimilarChats(chatId, page = 1, limit = 10) {
    try {
        const response = await fetch(`/api/similar-chats/${chatId}?page=${page}&limit=${limit}`);
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        // ignore fetch errors
    }
    return { similarChats: [], pagination: { hasMore: false } };
}

/**
 * Update and show load more button for images
 * Supports content_type filtering (SFW/NSFW)
 */
function updateLoadMoreButton(chatId, contentType = 'SFW') {
    const manager = window.chatImageManager;
    const cacheKey = `chat_${chatId}_${contentType}`;
    
    let currentPage, totalPages, source;
    
    // Prefer using actual cache manager state
    if (manager && manager.currentPages.has(cacheKey)) {
        currentPage = manager.currentPages.get(cacheKey) || 0;
        totalPages = manager.totalPages.get(cacheKey) || 0;
        source = 'CACHE_MGR';
    } else {
        // Fallback to pagination state
        const paginationState = contentType === 'SFW' 
            ? window.characterProfile.sfwPagination 
            : window.characterProfile.nsfwPagination;
        currentPage = paginationState.currentPage || 1;
        totalPages = paginationState.totalPages || 1;
        source = 'FALLBACK';
    }
    
    const buttonId = 'loadMoreImagesBtn';
    const shouldShow = currentPage < totalPages;
    
    // Show button only if there are more pages
    if (shouldShow) {
        showLoadMoreButton('images');
    } else {
        hideLoadMoreButton('images');
    }
}

/**
 * Show the load more button
 */
function showLoadMoreButton(type) {
    const buttonId = type === 'images' ? 'loadMoreImagesBtn' : 'loadMoreVideosBtn';
    const button = document.getElementById(buttonId);
    if (button) {
        button.style.display = 'block';
    }
}

/**
 * Hide the load more button
 */
function hideLoadMoreButton(type) {
    const buttonId = type === 'images' ? 'loadMoreImagesBtn' : 'loadMoreVideosBtn';
    const button = document.getElementById(buttonId);
    if (button) {
        button.style.display = 'none';
    }
}