/**
 * History Gallery - Client-side functionality
 */

(function() {
    'use strict';

    const historyTranslations = window.translations?.history_page || {};
    const t = (key, fallback) => historyTranslations[key] || fallback;

    let currentPage = 1;
    let currentFilter = 'all';
    let currentCharacter = '';
    let allContent = [];
    let displayedContent = []; // Track what's already displayed
    let groupedByCharacter = {};
    let isLoading = false;
    let hasMore = true;
    let infiniteScrollObserver = null;
    let loadThrottleTimer = null;
    let carouselInitialized = false; // Track if carousel has been built
    const LOAD_THROTTLE_MS = 1000; // Minimum time between loads

    // Initialize on page load
    document.addEventListener('DOMContentLoaded', function() {
        initializeFilters();
        loadHistory();
        
        // Check if we should open a modal from URL params
        const urlParams = new URLSearchParams(window.location.search);
        const openModal = urlParams.get('openModal');
        if (openModal) {
            const [contentType, contentId] = openModal.split('/');
            if (contentId) {
                // Wait a bit for the page to load, then open modal
                setTimeout(() => {
                    openContentModal({
                        _id: contentId,
                        contentType: contentType
                    });
                    // Clean up URL
                    window.history.replaceState({}, document.title, '/history');
                }, 500);
            }
        }
    });

    /**
     * Initialize filter buttons
     */
    function initializeFilters() {
        // Filter buttons
        document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
            btn.addEventListener('click', function() {
                const filter = this.getAttribute('data-filter');
                setActiveFilter(filter);
                currentFilter = filter;
                currentPage = 1;
                displayedContent = []; // Reset displayed content
                // Reset character filter to all when changing content type filter
                if (currentCharacter) {
                    currentCharacter = '';
                    document.querySelectorAll('.character-filter-item').forEach(item => {
                        item.classList.remove('active');
                    });
                    const allItem = document.querySelector('.character-filter-item[data-character=""]');
                    if (allItem) allItem.classList.add('active');
                }
                loadHistory();
            });
        });

        // Initialize character carousel navigation
        initializeCharacterCarousel();

        // Load more button (fallback)
        const loadMoreBtn = document.getElementById('loadMoreBtn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', function() {
                if (!isLoading && hasMore) {
                    currentPage++;
                    loadHistory(true); // append mode
                }
            });
        }

        // Setup infinite scroll with IntersectionObserver
        setupInfiniteScroll();
    }

    /**
     * Setup infinite scroll using IntersectionObserver
     */
    function setupInfiniteScroll() {
        // Clean up existing observer
        if (infiniteScrollObserver) {
            infiniteScrollObserver.disconnect();
        }

        const loadMoreContainer = document.getElementById('loadMoreContainer');
        if (!loadMoreContainer) return;

        infiniteScrollObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && hasMore && !isLoading) {
                    // Throttle loading to prevent rapid-fire requests
                    if (loadThrottleTimer) return;
                    
                    loadThrottleTimer = setTimeout(() => {
                        loadThrottleTimer = null;
                    }, LOAD_THROTTLE_MS);

                    currentPage++;
                    loadHistory(true);
                }
            });
        }, {
            rootMargin: '200px', // Start loading before reaching the bottom
            threshold: 0.1
        });

        infiniteScrollObserver.observe(loadMoreContainer);
    }

    /**
     * Initialize character carousel navigation and click handlers
     */
    function initializeCharacterCarousel() {
        const carousel = document.getElementById('characterCarousel');
        const scrollLeftBtn = document.getElementById('charScrollLeft');
        const scrollRightBtn = document.getElementById('charScrollRight');
        
        if (!carousel) return;

        // Scroll amount per click
        const scrollAmount = 240;

        // Left scroll button
        if (scrollLeftBtn) {
            scrollLeftBtn.addEventListener('click', () => {
                carousel.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
            });
        }

        // Right scroll button
        if (scrollRightBtn) {
            scrollRightBtn.addEventListener('click', () => {
                carousel.scrollBy({ left: scrollAmount, behavior: 'smooth' });
            });
        }

        // Update button states on scroll
        carousel.addEventListener('scroll', () => {
            updateCarouselButtons();
        });

        // Initial button state update
        updateCarouselButtons();

        // Add click handler for the "All" option
        const allCharacterItem = carousel.querySelector('.character-filter-item[data-character=""]');
        if (allCharacterItem) {
            allCharacterItem.addEventListener('click', () => {
                selectCharacterFilter('', allCharacterItem);
            });
        }
    }

    /**
     * Update carousel navigation button states
     */
    function updateCarouselButtons() {
        const carousel = document.getElementById('characterCarousel');
        const scrollLeftBtn = document.getElementById('charScrollLeft');
        const scrollRightBtn = document.getElementById('charScrollRight');

        if (!carousel || !scrollLeftBtn || !scrollRightBtn) return;

        // Check if at the beginning
        scrollLeftBtn.disabled = carousel.scrollLeft <= 10;

        // Check if at the end
        const maxScroll = carousel.scrollWidth - carousel.clientWidth;
        scrollRightBtn.disabled = carousel.scrollLeft >= maxScroll - 10;
    }

    /**
     * Select a character filter item
     */
    function selectCharacterFilter(characterId, element) {
        // Remove active class from all items
        document.querySelectorAll('.character-filter-item').forEach(item => {
            item.classList.remove('active');
        });

        // Add active class to selected item
        element.classList.add('active');

        // Update filter and reload
        currentCharacter = characterId;
        currentPage = 1;
        displayedContent = []; // Reset displayed content
        loadHistory();
    }

    /**
     * Set active filter button
     */
    function setActiveFilter(filter) {
        document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`.filter-btn[data-filter="${filter}"]`)?.classList.add('active');
    }

    /**
     * Load history content from API
     */
    function loadHistory(append = false) {
        if (isLoading) return;
        
        isLoading = true;
        const contentGrid = document.getElementById('contentGrid');
        const loadMoreContainer = document.getElementById('loadMoreContainer');
        const loadMoreBtn = document.getElementById('loadMoreBtn');
        const loadMoreSpinner = document.getElementById('loadMoreSpinner');
        const emptyState = document.getElementById('emptyState');

        if (!append) {
            contentGrid.innerHTML = `<div class="loading-spinner"><i class="bi bi-hourglass-split"></i><p>${t('loading_content', 'Loading your content...')}</p></div>`;
            displayedContent = [];
        } else {
            // Show loading spinner in load more area
            if (loadMoreBtn) loadMoreBtn.style.display = 'none';
            if (loadMoreSpinner) loadMoreSpinner.style.display = 'block';
        }

        // Build query params
        const params = new URLSearchParams({
            page: currentPage,
            limit: 24
        });

        if (currentCharacter) {
            params.append('character', currentCharacter);
        }

        // Fetch from API
        fetch(`/api/user/history?${params.toString()}`)
            .then(response => response.json())
            .then(data => {
                isLoading = false;

                // Get the new content from this page
                const newContent = data.content || [];
                
                if (!append) {
                    allContent = newContent;
                    groupedByCharacter = data.groupedByCharacter || {};
                } else {
                    // Only add items that aren't already in allContent
                    const existingIds = new Set(allContent.map(item => item._id));
                    const uniqueNewContent = newContent.filter(item => !existingIds.has(item._id));
                    allContent = allContent.concat(uniqueNewContent);
                }

                hasMore = data.page < data.totalPages;

                // Update character carousel with thumbnails (only on initial load, not when filtering)
                if (!append && !carouselInitialized) {
                    updateCharacterCarousel(groupedByCharacter);
                    carouselInitialized = true;
                }

                // Apply client-side filtering to new content only
                let filteredNewContent = filterContent(newContent);
                
                // Filter out already displayed items
                const displayedIds = new Set(displayedContent.map(item => item._id));
                const toDisplay = filteredNewContent.filter(item => !displayedIds.has(item._id));

                // Check if we have any content at all
                const totalFilteredContent = filterContent(allContent);

                // Render content
                if (totalFilteredContent.length === 0 && !append) {
                    contentGrid.innerHTML = '';
                    emptyState.style.display = 'block';
                    loadMoreContainer.style.display = 'none';
                } else {
                    emptyState.style.display = 'none';
                    if (!append) {
                        contentGrid.innerHTML = '';
                    } else {
                        // Remove loading spinner if it exists
                        const spinner = contentGrid.querySelector('.loading-spinner');
                        if (spinner) spinner.remove();
                    }
                    
                    // Only render new items
                    renderContent(toDisplay);
                    displayedContent = displayedContent.concat(toDisplay);
                    
                    // Hide spinner, show button
                    if (loadMoreSpinner) loadMoreSpinner.style.display = 'none';
                    if (loadMoreBtn) loadMoreBtn.style.display = 'inline-block';
                    
                    // Show/hide load more container based on hasMore
                    if (hasMore) {
                        loadMoreContainer.style.display = 'block';
                    } else {
                        loadMoreContainer.style.display = 'none';
                    }
                }
            })
            .catch(error => {
                console.error('Error loading history:', error);
                isLoading = false;
                // Hide spinner on error
                if (loadMoreSpinner) loadMoreSpinner.style.display = 'none';
                if (loadMoreBtn) loadMoreBtn.style.display = 'inline-block';
                if (!append) {
                    contentGrid.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><h3>${t('error_loading_content_title', 'Error loading content')}</h3><p>${t('error_loading_content_message', 'Please try again later')}</p></div>`;
                }
            });
    }

    /**
     * Filter content based on current filter
     */
    function filterContent(content) {
        let filtered = content;

        // Filter by type
        if (currentFilter === 'images') {
            filtered = filtered.filter(item => item.contentType === 'image');
        } else if (currentFilter === 'videos') {
            filtered = filtered.filter(item => item.contentType === 'video');
        } else if (currentFilter === 'recent') {
            // Show content from last 24 hours (matching badge logic)
            const twentyFourHoursAgo = new Date();
            twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
            filtered = filtered.filter(item => {
                const createdAt = new Date(item.createdAt);
                return createdAt >= twentyFourHoursAgo;
            });
        }

        return filtered;
    }

    /**
     * Render content items (only renders passed items, no duplicates)
     */
    function renderContent(content) {
        const contentGrid = document.getElementById('contentGrid');
        
        // Use DocumentFragment for better performance
        const fragment = document.createDocumentFragment();
        
        content.forEach(item => {
            const contentItem = createContentItem(item);
            fragment.appendChild(contentItem);
        });
        
        contentGrid.appendChild(fragment);
    }

    /**
     * Create a content item element
     */
    function createContentItem(item) {
        const div = document.createElement('div');
        div.className = 'content-item';
        div.setAttribute('data-content-id', item._id);
        div.setAttribute('data-content-type', item.contentType);

        // Check if recent (last 24 hours)
        const isRecent = isContentRecent(item.createdAt);
        
        // Use thumbnailUrl (compressed) for gallery grid, fallback to imageUrl
        // For videos, use imageUrl as thumbnail
        const thumbnailUrl = item.contentType === 'video' 
            ? item.imageUrl 
            : (item.thumbnailUrl || item.imageUrl || item.url);
        
        div.innerHTML = `
            <img src="${thumbnailUrl}" alt="${item.prompt || t('generated_content_alt', 'Generated content')}" loading="lazy">
            ${item.contentType === 'video' ? '<div class="video-overlay"><i class="bi bi-play-fill"></i></div>' : ''}
            ${isRecent ? `<span class="content-badge badge-recent"><i class="bi bi-star-fill"></i> ${t('new_badge', 'New')}</span>` : ''}
        `;

        div.addEventListener('click', () => {
            openContentModal(item);
        });

        return div;
    }

    /**
     * Check if content is recent (within 24 hours)
     */
    function isContentRecent(createdAt) {
        const now = new Date();
        const created = new Date(createdAt);
        const hoursDiff = (now - created) / (1000 * 60 * 60);
        return hoursDiff <= 24;
    }

    /**
     * Update character carousel with character thumbnails
     */
    function updateCharacterCarousel(grouped) {
        const carousel = document.getElementById('characterCarousel');
        if (!carousel) return;

        // Keep the "All" option and remove other items
        const allOption = carousel.querySelector('.character-filter-item[data-character=""]');
        carousel.innerHTML = '';
        if (allOption) {
            carousel.appendChild(allOption);
        }

        // Sort characters by count (most content first)
        const sortedCharacters = Object.values(grouped)
            .filter(group => group.characterName && group.characterName !== 'Unknown')
            .sort((a, b) => b.count - a.count);

        // Add character items
        sortedCharacters.forEach(group => {
            const characterItem = document.createElement('div');
            characterItem.className = 'character-filter-item';
            characterItem.setAttribute('data-character', group.chatId);
            
            // Use character thumbnail or a default avatar
            const avatarUrl = group.characterThumbnail || '/img/default-thumbnail.png';
            
            characterItem.innerHTML = `
                <div class="character-filter-avatar">
                    <img src="${avatarUrl}" alt="${group.characterName}" onerror="this.src='/img/default-thumbnail.png'">
                    <span class="character-filter-count">${group.count}</span>
                </div>
                <span class="character-filter-name" title="${group.characterName}">${group.characterName}</span>
            `;

            // Add click handler
            characterItem.addEventListener('click', () => {
                selectCharacterFilter(group.chatId, characterItem);
            });

            carousel.appendChild(characterItem);
        });

        // If current character is selected, highlight it
        if (currentCharacter) {
            const selectedItem = carousel.querySelector(`.character-filter-item[data-character="${currentCharacter}"]`);
            if (selectedItem) {
                document.querySelectorAll('.character-filter-item').forEach(item => item.classList.remove('active'));
                selectedItem.classList.add('active');
            }
        }

        // Update navigation button states
        setTimeout(updateCarouselButtons, 100);
    }

    /**
     * Open content detail modal
     */
    function openContentModal(item) {
        const modal = new bootstrap.Modal(document.getElementById('contentModal'));
        const modalContentArea = document.getElementById('modalContentArea');

        // Show loading state
        modalContentArea.innerHTML = `<div class="text-center p-4"><i class="bi bi-hourglass-split"></i> ${t('loading_details', 'Loading details...')}</div>`;
        modal.show();

        // Fetch detailed info
        const contentType = item.contentType || 'image';
        fetch(`/gallery/content/${item._id}/info?type=${contentType}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    renderModalContent(data.data, data.contentType);
                } else {
                    modalContentArea.innerHTML = `<div class="alert alert-danger">${t('failed_loading_details', 'Failed to load content details')}</div>`;
                }
            })
            .catch(error => {
                console.error('Error loading content details:', error);
                modalContentArea.innerHTML = `<div class="alert alert-danger">${t('error_loading_details', 'Error loading content details')}</div>`;
            });
    }

    /**
     * Render content details in modal
     */
    function renderModalContent(data, contentType) {
        const modalContentArea = document.getElementById('modalContentArea');
        const content = data.content || data.image || data.video;
        const chat = data.chat;
        const request = data.request;

        let html = '';

        // Media display
        if (contentType === 'video') {
            html += `
                <div class="mb-4">
                    <video controls class="w-100" style="border-radius: 12px; max-height: 500px;">
                        <source src="${content.videoUrl}" type="video/mp4">
                        ${t('video_not_supported', 'Your browser does not support the video tag.')}
                    </video>
                </div>
            `;
        } else {
            html += `
                <div class="mb-4 text-center">
                    <img src="${content.imageUrl}" alt="${t('generated_image_alt', 'Generated image')}" class="img-fluid" style="border-radius: 12px; max-height: 500px;">
                </div>
            `;
        }

        // Character info
        if (chat) {
            html += `
                <div class="detail-item">
                    <div class="detail-label">${t('detail_character', 'Character')}</div>
                    <div class="detail-value">
                        <a href="/chat/${chat.slug}" class="text-decoration-none" style="color: #b58afe;">
                            ${chat.name}
                        </a>
                    </div>
                </div>
            `;
        }

        // Prompt
        if (content.prompt) {
            html += `
                <div class="detail-item">
                    <div class="detail-label">${t('detail_prompt', 'Prompt')}</div>
                    <div class="detail-value">${content.prompt}</div>
                </div>
            `;
        }

        // Creation date
        if (content.createdAt) {
            const createdDate = new Date(content.createdAt);
            html += `
                <div class="detail-item">
                    <div class="detail-label">${t('detail_created', 'Created')}</div>
                    <div class="detail-value">${createdDate.toLocaleString()}</div>
                </div>
            `;
        }

        // Image-specific details
        if (contentType === 'image') {
            if (content.seed !== null && content.seed !== undefined) {
                html += `
                    <div class="detail-item">
                        <div class="detail-label">${t('detail_seed', 'Seed')}</div>
                        <div class="detail-value">${content.seed}</div>
                    </div>
                `;
            }

            if (content.aspectRatio) {
                html += `
                    <div class="detail-item">
                        <div class="detail-label">${t('detail_aspect_ratio', 'Aspect Ratio')}</div>
                        <div class="detail-value">${content.aspectRatio}</div>
                    </div>
                `;
            }

            if (request) {
                if (request.model_name) {
                    html += `
                        <div class="detail-item">
                            <div class="detail-label">${t('detail_model', 'Model')}</div>
                            <div class="detail-value">${request.model_name}</div>
                        </div>
                    `;
                }

                if (request.steps) {
                    html += `
                        <div class="detail-item">
                            <div class="detail-label">${t('detail_steps', 'Steps')}</div>
                            <div class="detail-value">${request.steps}</div>
                        </div>
                    `;
                }

                if (request.guidance_scale) {
                    html += `
                        <div class="detail-item">
                            <div class="detail-label">${t('detail_guidance_scale', 'Guidance Scale')}</div>
                            <div class="detail-value">${request.guidance_scale}</div>
                        </div>
                    `;
                }
            }
        }

        // Video-specific details
        if (contentType === 'video' && content.duration) {
            html += `
                <div class="detail-item">
                    <div class="detail-label">${t('detail_duration', 'Duration')}</div>
                    <div class="detail-value">${content.duration}s</div>
                </div>
            `;
        }

        modalContentArea.innerHTML = html;
    }

    // Make functions globally accessible if needed
    window.historyGallery = {
        loadHistory,
        openContentModal
    };

})();
