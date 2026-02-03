var chatsPerPage = 10;
let initHorizontalChatMenu = false;

// Global heart icon mapping for chat levels
const HEART_ICONS = {
    0: 'purple-heart-icon.png',      // Level 0
    1: 'growing-heart-icon.png',     // Levels 1-5 (Bronze)
    6: 'green-heart-icon.png',       // Levels 6-10 (Gold)
    11: 'blue-heart-icon.png',       // Levels 11-15 (Platinum)
    16: 'red-heart-icon.png',        // Levels 16-20 (Purple)
    21: 'beating-heart-icon.png'     // Levels 21+ (Diamond/Legendary)
};

// Helper function to get heart icon based on level
function getHeartIcon(level) {
    if (level === 0) return HEART_ICONS[0];
    if (level <= 5) return HEART_ICONS[1];
    if (level <= 10) return HEART_ICONS[6];
    if (level <= 15) return HEART_ICONS[11];
    if (level <= 20) return HEART_ICONS[16];
    return HEART_ICONS[21]; // 21+
}

// Helper function to get badge class for legendary hearts
function getHeartBadgeClass(level) {
    return level > 20 ? 'legendary' : '';
}

// Cache object structure
let chatCache = {
    data: [],
    currentPage: 1,
    pagination: { total: 0, totalPages: 0 },
    lastUpdated: null
};

// Reset cache on page refresh
window.addEventListener('beforeunload', function() {
    sessionStorage.removeItem('chatListCache');
});

// Initialize cache from sessionStorage or create new
function initializeCache() {
    const cachedData = sessionStorage.getItem('chatListCache');
    if (cachedData) {
        try {
            chatCache = JSON.parse(cachedData);
        } catch (e) {
            console.warn('Invalid cache data, resetting cache');
            resetCache();
        }
    } else {
        resetCache();
    }
}

initializeCache();
displayChatList(true, window.userId);

// Reset cache
function resetCache() {
    chatCache = {
        data: [],
        currentPage: 1,
        pagination: { total: 0, totalPages: 0 },
        lastUpdated: null
    };
    sessionStorage.removeItem('chatListCache');
}

// Save cache to sessionStorage
function saveCache() {
    chatCache.lastUpdated = Date.now();
    sessionStorage.setItem('chatListCache', JSON.stringify(chatCache));
}

// Current active tab state
let currentChatTab = 'latest';
let favoritesCache = {
    data: [],
    currentPage: 1,
    pagination: { total: 0, totalPages: 0 },
    lastUpdated: null
};

/**
 * Switch between Latest and Favorites tabs
 */
function switchChatTab(tabName) {
    currentChatTab = tabName;

    // Keep nav classes in sync with the clicked tab
    if (tabName === 'favorites') {
        // Hide latest list and show favorites
        $('#latest-chat-list').addClass('d-none');
        $('#chat-favorites-content').addClass('show active');
        $('#chat-latest-content').removeClass('show active');
        $('#tab-favorites').addClass('active');
        $('#tab-latest').removeClass('active');

        loadFavoriteChats(1);
    } else {
        // Show latest and hide favorites
        $('#latest-chat-list').removeClass('d-none');
        $('#chat-latest-content').addClass('show active');
        $('#chat-favorites-content').removeClass('show active');
        $('#tab-latest').addClass('active');
        $('#tab-favorites').removeClass('active');

        displayChatList(false, window.userId);
    }
}

/**
 * Load favorite chats
 */
function loadFavoriteChats(page = 1) {
    const list = $('#favorites-chat-list');
    
    // Hide latest list to prevent duplicate views and scrollbars
    $('#latest-chat-list').addClass('d-none');
    $('#chat-favorites-content').addClass('show active');
    $('#chat-latest-content').removeClass('show active');
    
    // Show skeleton loading
    list.empty();
    const skeletonContainer = $('<div class="loading-dots-container"></div>');
    for (let i = 0; i < 5; i++) {
        skeletonContainer.append('<div class="loading-dot" style="margin-bottom: 0.5rem;"></div>');
    }
    list.append(skeletonContainer);
    list.removeClass('d-none');
    
    $.ajax({
        type: 'GET',
        url: '/favorites',
        data: { page: page, limit: 10 },
        success: function(response) {
            
            if (response.data && response.data.length > 0) {
                favoritesCache.data = response.data;
                favoritesCache.currentPage = page;
                favoritesCache.pagination = response.pagination;

                $('#favorites-chat-list .loading-dots-container').remove();
                displayFavoriteChats(response.data);
                
                // Update favorite count badge
                $('#favorite-count-badge')
                    .text(response.pagination.total)
                    .show();
                // Ensure favorites displayed
                list.removeClass('d-none');
            } else {
                list.html(`
                    <div class="text-center py-5">
                        <i class="bi bi-star display-5 text-muted mb-3"></i>
                        <p class="text-muted">${window.translations.favorite.noFavorites}</p>
                    </div>
                `);
                
                $('#favorite-count-badge').hide();
            }
        },
        error: function(xhr, status, error) {
            spinner.hide();
            console.error('Error loading favorites:', error);
            list.html(`
                <div class="text-center py-5">
                    <i class="bi bi-exclamation-triangle display-5 text-warning mb-3"></i>
                    <p class="text-muted">${window.translations.favorite.requestFailed}</p>
                </div>
            `);
        }
    });
}

/**
 * Display favorite chats in the list
 */
function displayFavoriteChats(favorites) {
    const list = $('#favorites-chat-list');
    // Hide the latest tab content while showing favorites
    $('#latest-chat-list').addClass('d-none');
    list.empty();
    
    if (!favorites || favorites.length === 0) {
        list.html(`
            <div class="text-center py-5">
                <i class="bi bi-star display-5 text-muted mb-3"></i>
                <p class="text-muted">${window.translations.favorite.noFavorites}</p>
            </div>
        `);
        return;
    }
    
    favorites.forEach(function(chat) {
        if (!chat) return; // Skip any null/undefined entries (deleted chats)
        // Ensure chat shape is normalized like the chat-list endpoint
        const normalizedChat = normalizeChatRecord(chat);
        const isActive = chatId && normalizedChat._id === chatId;
        const chatHtml = constructChatItemHtml(normalizedChat, isActive);
        list.append(chatHtml);
    });
}

/**
 * Update favorite count in tab badge
 */
function updateFavoriteCountBadge() {
    if (typeof Favorites !== 'undefined' && Favorites.getFavoriteCount) {
        Favorites.getFavoriteCount(function(count) {
            const badge = $('#favorite-count-badge');
            if (count > 0) {
                badge.text(count).show();
            } else {
                badge.hide();
            }
        });
    }
}

function clearChatListItems() {
    const $latestList = $('#latest-chat-list');
    if ($latestList.length === 0) {
        return;
    }

    $latestList.find('.chat-list.item').remove();
    $latestList.find('#show-more-chats').remove();
}

function getChatTimestamp(chat) {
    if (!chat) return 0;
    const candidates = [
        chat.userChatUpdatedAt,
        chat.updatedAt,
        chat.userChatCreatedAt,
        chat.createdAt,
        chat?.lastMessage?.createdAt,
        chat?.lastMessage?.timestamp
    ];

    for (const value of candidates) {
        if (!value) {
            continue;
        }

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.getTime();
        }

        const time = Date.parse(value);
        if (!Number.isNaN(time)) {
            return time;
        }
    }
    return 0;
}

function sortChatsByUpdatedAt(chats) {
    if (!Array.isArray(chats)) {
        return [];
    }
    return chats.slice().sort((a, b) => getChatTimestamp(b) - getChatTimestamp(a));
}

function resolveOwnerId(value) {
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value === 'object' && value !== null) {
        if (typeof value.$oid === 'string') {
            return value.$oid;
        }
        if (typeof value.toHexString === 'function') {
            try {
                return value.toHexString();
            } catch (error) {
                console.warn('Failed to convert ObjectId via toHexString', error);
            }
        }
        if (typeof value.toString === 'function') {
            return value.toString();
        }
        return '';
    }
    return value;
}

function normalizeObjectId(value) {
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'object') {
        if (typeof value.$oid === 'string') {
            return value.$oid;
        }
        if (typeof value.toHexString === 'function') {
            try {
                return value.toHexString();
            } catch (error) {
                console.warn('Failed to normalize ObjectId via toHexString', error);
            }
        }
        if (value._bsontype === 'ObjectID' && typeof value.toString === 'function') {
            return value.toString();
        }
        if (typeof value.toString === 'function') {
            return value.toString();
        }
    }
    return String(value);
}

function normalizeChatRecord(chat) {
    if (!chat || typeof chat !== 'object') {
        return chat;
    }

    const normalized = { ...chat };
    normalized._id = normalizeObjectId(normalized._id);
    if ('chatId' in normalized) {
        normalized.chatId = normalizeObjectId(normalized.chatId);
    }
    if ('userChatId' in normalized) {
        normalized.userChatId = normalizeObjectId(normalized.userChatId);
    }
    if ('userId' in normalized) {
        normalized.userId = resolveOwnerId(normalized.userId);
    }

    if (normalized.lastMessage && typeof normalized.lastMessage === 'object') {
        normalized.lastMessage = { ...normalized.lastMessage };
        if ('createdAt' in normalized.lastMessage && normalized.lastMessage.createdAt) {
            const parsedCreatedAt = Date.parse(normalized.lastMessage.createdAt);
            if (!Number.isNaN(parsedCreatedAt)) {
                normalized.lastMessage.createdAt = new Date(parsedCreatedAt).toISOString();
            }
        }
        if ('timestamp' in normalized.lastMessage && normalized.lastMessage.timestamp) {
            const parsedTimestamp = Date.parse(normalized.lastMessage.timestamp);
            if (!Number.isNaN(parsedTimestamp)) {
                normalized.lastMessage.timestamp = new Date(parsedTimestamp).toISOString();
            }
        }
    }

    return normalized;
}

// Event listener for menu chat buttons
$(document).on('click','#toggle-chat-list',function(){

    $('.onchat-on, .onchat-off').hide();
    $('#chat-list').show();
    $('.brand-logo').show();

    $('#footer-toolbar').hide();
    
    // Reset to latest tab and load chats
    currentChatTab = 'latest';
    displayChatList(null, window.userId);
    
    // Update favorite count badge
    updateFavoriteCountBadge();
});

// Close chat list when clicking #close-chat-list-btn
$(document).on('click','#close-chat-list-btn',function(){
    $('#chat-list').hide();
    $('.onchat-off').show();
    $('.onchat-on').hide();
    $('#footer-toolbar').show();
    hideNavbarChatActions();
    if ($('#horizontal-chat-menu').length) {
        $('#horizontal-chat-menu').removeClass('d-none');
        displayHorizontalChatList(window.userId);
    }
});
// if the  url is like '/chat/?list=true'
if (window.location.pathname === '/chat/' && window.location.search === '?list=true') {
    setTimeout(() => {
        $('#toggle-chat-list').click()
    }, 500);
}

// Delete chat function
function deleteChatHandler(chatId) {
    const userId = user._id;
    
    $.ajax({
        url: `/api/delete-chat/${chatId}`,
        type: 'DELETE',
        data: { chatId },
        success: function(response) {
            renderChatList(window.userId);
            showNotification(translations.deleteSuccess, 'success');
        },
        error: function(xhr, status, error) {
            showNotification(translations.error, 'error');
        }
    });
}

// Delete chat history function
function deleteChatHistoryHandler(selectedChatId) {
    $.ajax({
        url: `/api/delete-chat-history/${selectedChatId}`,
        type: 'DELETE',
        success: function(response) {
            $(document).find(`.user-chat-history[data-chat="${selectedChatId}"]`).fadeOut().remove();
            showNotification(translations.deleteSuccess, 'success');
        },
        error: function(xhr, status, error) {
            showNotification(translations.error, 'error');
        }
    });
}

// Main function to display chat list
function displayChatList(reset, userId) {
    if ($('#chat-list').length === 0) return;
    // Ensure latest list is visible by default and favorites are hidden
    $('#latest-chat-list').removeClass('d-none');
    $('#chat-favorites-content').removeClass('show active');
    $('#chat-latest-content').addClass('show active');
    $('#favorites-chat-list').addClass('d-none');
    if (reset) {
        resetCache();
        clearChatListItems();
    }

    chatCache.currentPage = 1;
    fetchChatListData(chatCache.currentPage);

    function fetchChatListData(page) {
        // Show skeleton loading
        const latestList = $('#latest-chat-list');
        
        // Only clear list on first page, append skeleton on subsequent pages
        if (page === 1) {
            latestList.empty();
        }
        
        const skeletonContainer = $('<div class="loading-dots-container" style="margin-top: 0.5rem;"></div>');
        for (let i = 0; i < 5; i++) {
            skeletonContainer.append('<div class="loading-dot" style="margin-bottom: 0.5rem;"></div>');
        }
        latestList.append(skeletonContainer);
        
        $.ajax({
            type: 'GET',
            url: '/api/chat-list/' + userId,
            data: { page: page, limit: chatsPerPage },
            success: function(data) {
                const { chats, pagination } = data;
                const normalizedFetchedChats = Array.isArray(chats)
                    ? chats.map(normalizeChatRecord)
                    : [];
                const sortedChats = sortChatsByUpdatedAt(normalizedFetchedChats);
                let chatsToRender = [];

                const cacheMap = new Map();
                chatCache.data.forEach(chat => {
                    const normalizedChat = normalizeChatRecord(chat);
                    if (normalizedChat && normalizedChat._id) {
                        cacheMap.set(normalizedChat._id, normalizedChat);
                    }
                });

                if (page === 1) {
                    sortedChats.forEach(chat => {
                        if (!chat || !chat._id) {
                            return;
                        }
                        const existing = cacheMap.get(chat._id);
                        cacheMap.set(chat._id, existing ? { ...existing, ...chat } : chat);
                    });

                    // Retain any cached entries that were added client-side but not yet returned by the server
                    chatCache.data.forEach(chat => {
                        const normalizedChat = normalizeChatRecord(chat);
                        if (normalizedChat && normalizedChat._id && !cacheMap.has(normalizedChat._id)) {
                            cacheMap.set(normalizedChat._id, normalizedChat);
                        }
                    });

                    const mergedChats = Array.from(cacheMap.values());
                    chatCache.data = sortChatsByUpdatedAt(mergedChats);
                    clearChatListItems();
                    chatsToRender = chatCache.data;
                } else {
                    const newChats = [];
                    sortedChats.forEach(chat => {
                        if (!chat || !chat._id) {
                            return;
                        }
                        const existing = cacheMap.get(chat._id);
                        if (existing) {
                            cacheMap.set(chat._id, { ...existing, ...chat });
                        } else {
                            cacheMap.set(chat._id, chat);
                            newChats.push(chat);
                        }
                    });

                    chatCache.data = sortChatsByUpdatedAt(Array.from(cacheMap.values()));
                    chatsToRender = newChats;
                }

                chatCache.currentPage = page;
                chatCache.pagination = pagination;
                saveCache();
                $('#latest-chat-list .loading-dots-container').remove();
                displayChats(chatsToRender, pagination);
            },
            error: function(xhr, status, error) {
                console.error('Error fetching chat list:', error);
            },
            complete: function() {
                // Skeleton loading will be replaced by displayChats
            }
        });
    }

    function displayChats(chats, pagination) {
        const $latestList = $('#latest-chat-list');
        if ($latestList.length === 0) {
            return;
        }

        // Remove only the skeleton loading container, not the entire list
        $latestList.find('.loading-dots-container').remove();

        // Reset loading button state
        const $loadMoreBtn = $latestList.find('#show-more-chats');
        if ($loadMoreBtn.length) {
            $loadMoreBtn.removeClass('loading');
            $loadMoreBtn.find('.load-more-content').removeClass('d-none');
            $loadMoreBtn.find('.load-more-loading').addClass('d-none');
            $loadMoreBtn.find('.loading-progress').removeClass('active');
            $loadMoreBtn.prop('disabled', false);
        }
        
        // Don't append if these are duplicate chats
        chats.forEach(function(chat){
            // Check if this chat is already displayed
            if ($latestList.find(`.chat-list.item[data-id="${chat._id}"]`).length === 0) {
                const isActive = chatId ? chat._id === chatId : false;
                const chatHtml = constructChatItemHtml(chat, isActive);
                // Add smooth fade-in animation for new chats
                const $chatElement = $(chatHtml).hide();
                $latestList.append($chatElement);
                $chatElement.fadeIn(300);
            }
        });
        
        updateCurrentChat(chatId, window.userId);
        updateChatCount(pagination.total);
        checkShowMoreButton(pagination);
    }

    function updateChatCount(count) {
        $('#user-chat-count').html('(' + count + ')');
    }

    function checkShowMoreButton(pagination) {
        const $latestList = $('#latest-chat-list');
        if ($latestList.length === 0) {
            return;
        }

        $latestList.find('#show-more-chats').remove(); 
        if (pagination.page < pagination.totalPages) {
            $latestList.append(
                `<button id="show-more-chats" class="btn shadow-0 w-100 mt-2 chat-load-more-btn">
                    <span class="load-more-content">
                        <i class="bi bi-three-dots me-2"></i>
                        ${translations.loadMore}
                    </span>
                    <span class="load-more-loading d-none">
                        <div class="loading-dots">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                        ${translations.loading}
                    </span>
                    <div class="loading-progress"></div>
                </button>`
            );
            $('#show-more-chats').off().on('click', function() {
                const $btn = $(this);
                
                // Start loading state
                $btn.addClass('loading');
                $btn.find('.load-more-content').addClass('d-none');
                $btn.find('.load-more-loading').removeClass('d-none');
                $btn.prop('disabled', true);
                
                // Start progress animation
                $btn.find('.loading-progress').addClass('active');
                
                chatCache.currentPage++;
                fetchChatListData(chatCache.currentPage);
            });
        }
    }
}

// Store current chat data for modal
let currentChatActionsData = null;

// Function to update navbar chat actions button
function updateNavbarChatActions(chat) {
    const actionBtn = $('#chat-actions-btn');

    if (!chat) {
        actionBtn.hide();
        currentChatActionsData = null;
        return;
    }
    
    // Store chat data for modal
    currentChatActionsData = chat;
    actionBtn.show();
}

// Function to open chat actions modal
function openChatActionsModal() {
    const chat = currentChatActionsData;
    if (!chat) return;
    
    const modal = $('#chatActionsModal');
    const content = $('#chatActionsContent');
    
    // Update modal header with chat info
    $('#chatActionsAvatar').attr('src', chat.chatImageUrl || '/img/logo.webp');
    $('#chatActionsName').text(chat.name || 'Chat');
    
    const isOwner = chat.userId === window.userId;
    
    // Check if chat is favorited and build modal content
    Favorites.checkFavorite(chat._id, function(isFavorited) {
        const favoriteIcon = isFavorited ? 'bi-star-fill' : 'bi-star';
        const favoriteText = isFavorited 
            ? window.translations.favorite.removeFavorite 
            : window.translations.favorite.addFavorite;
        
        const actionItems = `
            
            <div class="chat-action-item" onclick="closeChatActionsModal(); handleChatReset(this)" data-id="${chat._id}">
                <div class="action-icon success">
                    <i class="bi bi-plus-square"></i>
                </div>
                <span class="action-text">${window.translations.newChat}</span>
                <i class="bi bi-chevron-right action-arrow"></i>
            </div>
            
            <div class="chat-action-item" onclick="closeChatActionsModal(); showChatHistory('${chat._id}')">
                <div class="action-icon info">
                    <i class="bi bi-clock-history"></i>
                </div>
                <span class="action-text">${window.translations.chatHistory}</span>
                <i class="bi bi-chevron-right action-arrow"></i>
            </div>
            
            <div class="chat-action-item" onclick="closeChatActionsModal(); Favorites.toggleFavorite('${chat._id}')">
                <div class="action-icon warning">
                    <i class="bi ${favoriteIcon}"></i>
                </div>
                <span class="action-text">${favoriteText}</span>
                <i class="bi bi-chevron-right action-arrow"></i>
            </div>
            
            ${window.isAdmin ? `

            <div class="action-divider"></div>
            <div class="admin-section-header">
                <i class="bi bi-shield-lock-fill"></i>
                <span>Admin Settings</span>
            </div>

            <div class="chat-action-item" onclick="closeChatActionsModal(); loadCharacterUpdatePage('${chat._id}')">
                <div class="action-icon primary">
                    <i class="bi bi-pencil"></i>
                </div>
                <span class="action-text">${!isOwner ? window.translations.edit : window.translations.update}</span>
                <i class="bi bi-chevron-right action-arrow"></i>
            </div>

            <div class="chat-action-item" onclick="closeChatActionsModal(); logFullConversation('${chat._id}')">
                <div class="action-icon purple">
                    <i class="bi bi-terminal"></i>
                </div>
                <span class="action-text">Log Full Conversation</span>
                <i class="bi bi-chevron-right action-arrow"></i>
            </div>
            <div class="admin-model-section">
                <div class="model-label">
                    <i class="bi bi-image"></i>
                    <span>Image Generation Model</span>
                </div>
                <div class="current-model-display" id="currentModelDisplay">
                    <span class="current-model-name">${chat.imageModel || 'Not set'}</span>
                </div>
                <select id="modelDropdown" class="model-dropdown" onchange="updateCharacterModel('${chat._id}', this.value)">
                    <option value="">Loading models...</option>
                </select>
            </div>
            ` : ''}
        `;

        content.html(actionItems);

        // If admin, load available models for dropdown
        if (window.isAdmin) {
            loadTxt2ImgModels(chat.imageModel);
        }

        // Show modal using Bootstrap
        const bsModal = new bootstrap.Modal(modal[0]);
        bsModal.show();
    });
}

// Function to close chat actions modal
function closeChatActionsModal() {
    const modal = bootstrap.Modal.getInstance($('#chatActionsModal')[0]);
    if (modal) {
        modal.hide();
    }
}

// Function to load txt2img models for dropdown
function loadTxt2ImgModels(currentModel) {
    const dropdown = $('#modelDropdown');

    $.ajax({
        url: '/api/txt2img-models',
        method: 'GET',
        success: function(response) {
            if (response.success && response.models) {
                dropdown.empty();
                dropdown.append('<option value="">-- Select Model --</option>');

                // Group models by type
                const sdModels = response.models.filter(m => m.isSDModel);
                const builtInModels = response.models.filter(m => !m.isSDModel);

                // Add built-in models group
                if (builtInModels.length > 0) {
                    const builtInGroup = $('<optgroup label="Built-in Models"></optgroup>');
                    builtInModels.forEach(model => {
                        const selected = currentModel === model.id ? 'selected' : '';
                        builtInGroup.append(`<option value="${model.id}" ${selected}>${model.name}</option>`);
                    });
                    dropdown.append(builtInGroup);
                }

                // Add SD/Custom models group
                if (sdModels.length > 0) {
                    const sdGroup = $('<optgroup label="Custom SD Models"></optgroup>');
                    sdModels.forEach(model => {
                        const selected = (currentModel === model.modelName || currentModel === model.sdName) ? 'selected' : '';
                        sdGroup.append(`<option value="${model.id}" data-model-name="${model.modelName || model.sdName}" data-style="${model.style || ''}" ${selected}>${model.name}</option>`);
                    });
                    dropdown.append(sdGroup);
                }
            }
        },
        error: function(error) {
            console.error('Error loading models:', error);
            dropdown.html('<option value="">Error loading models</option>');
        }
    });
}

// Function to update character image model
function updateCharacterModel(chatId, modelId) {
    if (!modelId || !chatId) return;

    const dropdown = $('#modelDropdown');
    const selectedOption = dropdown.find('option:selected');

    // Determine model details
    let imageModel, imageStyle, imageVersion;

    if (selectedOption.data('model-name')) {
        // Custom SD model
        imageModel = selectedOption.data('model-name');
        imageStyle = selectedOption.data('style') || 'photorealistic';
        imageVersion = 'SDXL 1.0';
    } else {
        // Built-in model
        imageModel = modelId;
        imageStyle = 'default';
        imageVersion = 'API';
    }

    // Show loading state
    const originalText = selectedOption.text();
    dropdown.prop('disabled', true);

    $.ajax({
        url: '/novita/save-image-model',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
            chatId: chatId,
            modelId: modelId,
            imageModel: imageModel,
            imageStyle: imageStyle,
            imageVersion: imageVersion
        }),
        success: function(response) {
            // Update the current model display
            $('#currentModelDisplay .current-model-name').text(imageModel);

            // Update chat cache if exists
            if (currentChatActionsData) {
                currentChatActionsData.imageModel = imageModel;
            }

            dropdown.prop('disabled', false);

            // Show success feedback
            if (typeof window.showNotification === 'function') {
                window.showNotification('Model updated successfully', 'success');
            }
        },
        error: function(error) {
            console.error('Error updating model:', error);
            dropdown.prop('disabled', false);
            if (typeof window.showNotification === 'function') {
                window.showNotification('Failed to update model', 'error');
            }
        }
    });
}

// Function to hide navbar chat actions
function hideNavbarChatActions() {
    $('#chat-actions-btn').hide();
    currentChatActionsData = null;
}

// Function to update current chat in the list
function updateCurrentChat(chatId, userId) {
    if(!chatId) {
        hideNavbarChatActions();
        return;
    }
    let currentChat = chatCache.data.find(chat => chat._id === chatId);

    if (currentChat) {
        fetchChatDataInfo(chatId, currentChat);
    } else {
        fetchChatDataInfo(chatId, null);
    }

    // Update horizontal chat menu when available
    if ($('#horizontal-chat-menu').length > 0) {
        updateHorizontalChatMenu(chatId);
    }
}

// Function to fetch chat data info
function fetchChatDataInfo(chatId, fallbackChat) {
    $.ajax({
        type: 'GET',
        url: `/api/chat-data/${chatId}`,
        success: function(data) {
            let chatData = data;
            if (fallbackChat && typeof fallbackChat === 'object') {
                chatData = Object.assign({}, fallbackChat, data);
            }
            updateChatListDisplay(chatData);
        },
        error: function(xhr, status, error) {
            console.log(error);
            if (fallbackChat) {
                updateChatListDisplay(fallbackChat);
            }
        }
    });
}

// Function to update chat list display
function updateChatListDisplay(currentChat) {
    if (!currentChat) {
        return;
    }

    const normalizedChat = normalizeChatRecord({ ...currentChat });
    const nowIsoString = new Date().toISOString();
    normalizedChat.userChatUpdatedAt = nowIsoString;
    normalizedChat.updatedAt = nowIsoString;

    chatCache.data = chatCache.data
        .map(normalizeChatRecord)
        .filter(chat => chat._id !== normalizedChat._id);

    chatCache.data.unshift(normalizedChat);
    chatCache.data = sortChatsByUpdatedAt(chatCache.data);
    saveCache();

        const $latestList = $('#latest-chat-list');
        if ($latestList.length) {
            $latestList.find('.chat-list.item').removeClass('active');
        }
        // remove all occurrence of chat from list
        const currentChatObjs = $latestList.find(`.chat-list.item[data-id="${normalizedChat._id}"]`);
    if(currentChatObjs.length >= 1){
        currentChatObjs.each(function(){
            const chatName = $(this).find('.chat-list-title h6').text();
            $(this).remove();
        });
    }

    let chatHtml = constructChatItemHtml(normalizedChat, true);
        if ($latestList.length) {
            $latestList.prepend(chatHtml);
        }

    // Update navbar dropdown
    updateNavbarChatActions(normalizedChat);
}

// Enhanced function to construct chat item HTML with ultra-compact design for 260px sidebar
function constructChatItemHtml(chat, isActive) {
    const isOwner = chat.userId === window.userId;
    const lang = window.lang
    let lastMessageTime
    switch (lang) {
        case 'ja':
            lastMessageTime = chat.updatedAt ? new Date(chat.updatedAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) : '';
            break;
        case 'en':
            lastMessageTime = chat.updatedAt ? new Date(chat.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
            break;
        case 'fr':
            lastMessageTime = chat.updatedAt ? new Date(chat.updatedAt).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }) : '';
            break;
        default:
            lastMessageTime = chat.updatedAt ? new Date(chat.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
            break;
    }

    const previewText = chat.lastMessage?.content || '';

    return `
        <div class="list-group-item list-group-item-action border-0 p-0 ${isActive ? 'active bg-primary bg-opacity-10' : ''} chat-list item user-chat chat-item-enhanced" 
            data-id="${chat._id}" style="position: relative;">
            <div class="d-flex align-items-center w-100 px-2 py-1">
                <div class="user-chat-content d-flex align-items-center flex-grow-1"
                onclick="handleChatListItemClick(this)" style="cursor: pointer; min-width: 0;">
                    <div class="chat-avatar-container position-relative me-2">
                        <img class="chat-avatar rounded-circle border" 
                             src="${chat.chatImageUrl || '/img/logo.webp'}" 
                             alt="${chat.name}"
                             style="width: 40px; height: 40px; object-fit: cover;">
                        ${isActive ? '<div class="position-absolute top-0 end-0 bg-primary rounded-circle" style="width: 10px; height: 10px; border: 1px solid white;"></div>' : ''}
                    </div>
                    <div class="chat-content flex-grow-1 min-w-0">
                        <div class="d-flex justify-content-between align-items-start">
                            <h6 class="chat-name mb-0 fw-semibold text-truncate" style="max-width: 140px; font-size: 0.9rem; line-height: 1.1;">${chat.name}</h6>
                            <small class="chat-time text-muted flex-shrink-0 ms-1" style="font-size: 0.75rem;">${lastMessageTime}</small>
                        </div>
                        <div class="mt-1">
                            <p class="chat-preview mb-0 small text-truncate ${chat.lastMessage ? '' : 'd-none'}" 
                               style="max-width: 150px; font-size: 0.8rem; line-height: 1.2;">
                                ${previewText}
                            </p>
                            ${!chat.lastMessage ? `<small class="text-muted fst-italic" style="font-size: 0.8rem;">${translations.newChat}</small>` : ''}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Enhanced function to display user chat history in modal with compact design
function displayUserChatHistoryInModal(userChat) {
    const chatHistoryList = $('#chat-history-list');
    chatHistoryList.empty();

    if (userChat && userChat.length > 0) {
        const userChats = userChat.filter(chat => !chat.isWidget);
        
        if (userChats.length === 0) {
            chatHistoryList.html(`
                <div class="text-center py-4">
                    <i class="bi bi-chat-square-dots display-5 text-muted mb-2"></i>
                    <p class="text-muted small">${translations.noChatHistory}</p>
                </div>
            `);
            return;
        }

        userChats.forEach(chat => {
                // Determine the best timestamp available for the chat
                const timestamp = (chat.updatedAt || chat.createdAt || chat.userChatUpdatedAt || chat.userChatCreatedAt || chat.lastMessage?.createdAt || chat.lastMessage?.timestamp || null);
                const chatDate = timestamp ? new Date(timestamp) : new Date();

                // Determine locale from window.lang with sensible defaults
                const lang = typeof window.lang === 'string' ? window.lang : 'en';
                const localeMap = {
                    'ja': 'ja-JP',
                    'en': 'en-US',
                    'fr': 'fr-FR'
                };
                const locale = localeMap[lang] || lang || 'en-US';

                const formattedDate = chatDate.toLocaleDateString(locale, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'short'
                });
                const formattedTime = chatDate.toLocaleTimeString(locale, {
                    hour: '2-digit',
                    minute: '2-digit'
                });

            const historyItem = $(`
                <div class="list-group-item list-group-item-action border-0 p-2 user-chat-history"
                     data-id="${chat.chatId}" 
                     data-chat="${chat._id}" 
                     onclick="handleUserChatHistoryClick(this)"
                     style="cursor: pointer; border-radius: 8px; margin-bottom: 0.25rem;">
                    <div class="d-flex align-items-center justify-content-between w-100">
                        <div class="d-flex align-items-center flex-grow-1 min-w-0">
                            <div class="chat-history-icon me-2">
                                <i class="bi bi-chat-dots-fill text-primary" style="font-size: 1.2rem;"></i>
                            </div>
                            <div class="chat-history-content min-w-0">
                                <div class="chat-history-date fw-semibold text-dark mb-0" style="font-size: 0.8rem;">${formattedDate}</div>
                                <small class="text-muted" style="font-size: 0.7rem;">${formattedTime}</small>
                            </div>
                        </div>
                        <div class="chat-history-actions">
                            <div onclick="enableToggleDropdown(this); event.stopPropagation();" class="dropdown">
                                <button class="btn btn-sm btn-outline-secondary border-0 rounded-circle" 
                                        type="button" 
                                        id="historyDropdown_${chat._id}" 
                                        data-mdb-toggle="dropdown" 
                                        aria-expanded="false"
                                        style="width: 24px; height: 24px; z-index: 1000; font-size: 0.7rem;">
                                    <i class="bi bi-three-dots-vertical"></i>
                                </button>
                                <ul class="dropdown-menu dropdown-menu-end shadow border-0" 
                                    aria-labelledby="historyDropdown_${chat._id}"
                                    style="z-index: 1050; font-size: 0.75rem;">
                                    <li>
                                        <button class="dropdown-item d-flex align-items-center py-1 border-0 bg-transparent w-100 text-start text-danger" 
                                                onclick="deleteChatHistoryHandler('${chat._id}')">
                                            <i class="bi bi-trash me-2" style="width: 16px; font-size: 0.7rem;"></i>
                                            <span style="font-size: 0.75rem;">${translations.delete}</span>
                                        </button>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            `);

            chatHistoryList.append(historyItem);
        });
    } else {
        chatHistoryList.html(`
            <div class="text-center py-4">
                <i class="bi bi-chat-square-dots display-5 text-muted mb-2"></i>
                <p class="text-muted small">${translations.noChatHistory}</p>
            </div>
        `);
    }
}

// Enhanced function to render chat dropdown with compact design
function renderChatDropdown(chat) {
    const chatId = chat._id;
    const dropdownHtml = `
        <div class="d-inline-block align-items-center">
            <div onclick="enableToggleDropdown(this)" class="dropdown pe-2">
                <button class="btn btn-sm btn-outline-secondary border-0 rounded-circle" 
                        type="button" 
                        id="dropdownMenuButton_${chatId}" 
                        data-mdb-toggle="dropdown" 
                        aria-expanded="false"
                        style="width: 30px; height: 30px; z-index: 1000;">
                    <i class="bi bi-three-dots-vertical"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end shadow border-0" 
                    aria-labelledby="dropdownMenuButton_${chatId}"
                    style="z-index: 1050;">
                    <li>
                        <span onclick="deleteChatHistoryHandler('${chatId}')" 
                              class="dropdown-item d-flex align-items-center py-2 text-danger" 
                              style="cursor:pointer">
                            <i class="bi bi-trash me-3"></i>
                            <span>${translations.delete}</span>
                        </span>
                    </li>
                </ul>
            </div>
        </div>
    `;

    return dropdownHtml;
}

async function getUserChatHistory(chatId) {
    try {
        const response = await fetch(`/api/chat-history/${chatId}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch chat history: ${response.status}`);
        }

        const data = await response.json();
        displayUserChatHistoryInModal(data);

        const userChats = Array.isArray(data) ? data.filter(chat => !chat.isWidget) : [];
        if (userChats.length === 0) {
            return null;
        }

        // Prefer continuing today's conversation when available to avoid unintended resets.
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);

        const pickTimestamp = chat => chat.updatedAt || chat.createdAt || chat.userChatUpdatedAt || chat.userChatCreatedAt;
        const isTodayChat = chat => {
            const timestamp = pickTimestamp(chat);
            if (!timestamp) {
                return false;
            }
            const chatDate = new Date(timestamp);
            return chatDate >= startOfDay && chatDate < endOfDay;
        };

        const todaysChat = userChats.find(isTodayChat);
        const selectedChat = todaysChat || userChats[0];

        if (selectedChat) {
            sessionStorage.setItem('userChatId', selectedChat._id);
            return selectedChat;
        }
    } catch (error) {
        console.error('Error fetching user chat history:', error);
    }
    return null;
}


//.user-chat-history
function handleUserChatHistoryClick(el) {
    if (userChatId == $(el).data('chat')) {
        return;
    }
    chatId = $(el).data('id');
    userChatId = $(el).data('chat');
    postChatData(chatId, window.userId, userChatId, false, null);
};

//.chat-list.item.user-chat .user-chat-content
function handleChatListItemClick(el) {
    const $el = $(el);
    if ($el.hasClass('loading')) return;
    
    $el.addClass('loading');
    const selectChatId = $el.closest('.user-chat').data('id');
    const chatImageUrl = $el.find('img').attr('src');
    
    // Make sure we have a valid chatId
    if (!selectChatId) {
        console.error('No chat ID found in clicked element');
        $el.removeClass('loading');
        return;
    }
    
    // Track chat start event
    if (typeof UserTracking !== 'undefined' && UserTracking.trackStartChat) {
        UserTracking.trackStartChat(selectChatId, 'chat_list', {
            sourceElementId: null,
            sourceElementClass: 'chat-list-item'
        });
    }
    
    $el.closest('.chat-list.item').addClass('active').siblings().removeClass('active');
    //$('#chat-wrapper').css('background-image', `url(${chatImageUrl})`);
    
    // Update global chatId variable before calling fetchChatData
    window.chatId = selectChatId;
    
    if (typeof window.fetchChatData === 'function') {
        window.fetchChatData(selectChatId, window.userId, null, function() {
            $el.removeClass('loading');
            // Update current chat after successful fetch
            updateCurrentChat(selectChatId, window.userId);
        });
    } else {
        // Redirect to chat page if fetchChatData is not available
        window.location.href = `/chat/${selectChatId}`;
    }
};

// Show chat history modal (fixed with proper modal management)
function showChatHistory(chatId) {
    // Close all other modals first
    if (typeof window.closeAllModals === 'function') {
        window.closeAllModals();
    }
    
    // Wait a moment for other modals to close
    setTimeout(async () => {
        try {
            // Show modal with proper Bootstrap 5 API and high z-index
            const modalElement = document.getElementById('chatHistoryModal');
            if (!modalElement) {
                console.error('Chat history modal element not found');
                return;
            }
            
            // Ensure modal has high z-index
            modalElement.style.zIndex = '1060';
            
            const modal = new bootstrap.Modal(modalElement, {
                backdrop: true,
                keyboard: true,
                focus: true
            });
            
            modal.show();
            
            // Show loading state
            $('#chat-history-list').html(`
                <div class="text-center py-5">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">${translations.loading}</span>
                    </div>
                    <p class="text-muted mt-3">${translations.loadingHistory}</p>
                </div>
            `);
            
            // Fetch and display chat history
            const response = await fetch(`/api/chat-history/${chatId}`);
            if (!response.ok) {
                throw new Error('Failed to fetch chat history');
            }
            
            const data = await response.json();
            displayUserChatHistoryInModal(data);
            
        } catch (error) {
            console.error('Error loading chat history:', error);
            $('#chat-history-list').html(`
                <div class="text-center py-5">
                    <i class="bi bi-exclamation-triangle display-4 text-warning mb-3"></i>
                    <p class="text-muted">${translations.historyLoadError}</p>
                    <button class="btn btn-outline-primary btn-sm" onclick="location.reload()">${translations.retry}</button>
                </div>
            `);
        }
    }, 200); // Small delay to ensure other modals are closed
}

// Initialize horizontal chat menu on index page
$(document).ready(function() {
    initializeHorizontalChatMenu();
});

// Initialize horizontal chat menu
function initializeHorizontalChatMenu() {
    if ($('#horizontal-chat-menu').length === 0) return;
    
    // Add styles to head
    if ($('#horizontal-chat-styles').length === 0) {
        $('head').append('<div id="horizontal-chat-styles">' + horizontalChatStyles + '</div>');
    }
    
    // Show the menu
    $('#horizontal-chat-menu').removeClass('d-none');
    
    // Load latest chats for horizontal display
    displayHorizontalChatList(window.userId);
}

// Display chats in horizontal menu (similar to displayImageThumb)
function displayHorizontalChatList(userId, options = {}) {
    if (!userId || $('#horizontal-chat-list').length === 0) return;

    const forceReload = options.force === true;

    // Check if already initialized first to prevent duplicate loads
    if (initHorizontalChatMenu && !forceReload) {
        return;
    }

    // Only use cache if menu hasn't been initialized yet
    if (!forceReload && chatCache.data.length > 0 && !initHorizontalChatMenu) {
        displayChatThumbs(chatCache.data, userId);
        initHorizontalChatMenu = true;
        return;
    }

    initHorizontalChatMenu = true;

    // Show loading spinner
    $('#horizontal-chat-loading').show();
    $('#horizontal-chat-list').hide();

    $.ajax({
        type: 'GET',
        url: '/api/chat-list/' + userId,
        data: { page: 1, limit: 20 }, // Get latest 20 chats
        success: function(data) {
            const { chats } = data;
            displayChatThumbs(chats, userId);
        },
        error: function(xhr, status, error) {
            console.error('Error fetching horizontal chat list:', error);
            // Hide loading spinner on error
            $('#horizontal-chat-loading').hide().remove();
            $('#horizontal-chat-list').show();
        }
    });
}
function buildChatThumbElement(chat, index = 0, userChatLevel = null) {
    const animationDelay = `${Math.max(index, 0) * 0.1}s`;
    const ownerId = resolveOwnerId(chat.userId);
    const updatedAt = getChatTimestamp(chat);

    // Use real data when available, fallback to 0 (will be updated asynchronously)
    const level = (userChatLevel && userChatLevel[chat._id] !== undefined)
        ? userChatLevel[chat._id]
        : 0;  // Start with 0, update via API

    // Choose heart icon per tier
    let heartIcon = getHeartIcon(level);
    let badgeClass = getHeartBadgeClass(level);
    let showIcon = level > 0;

    const iconHtml = showIcon ? `<img src="/img/heart/${heartIcon}" class="heart-icon ${badgeClass}" alt="♥">` : '';

    const badgeHtml = level > 0 ? `
                <!-- HEART LEVEL BADGE – bottom center -->
                <div class="heart-badge position-absolute start-50 translate-middle-x d-flex align-items-center justify-content-center ${badgeClass}">
                    ${iconHtml}
                    <span class="heart-number text-white fw-bold">${level}</span>
                </div>
    ` : '';

    return $(`
        <div class="chat-thumb-container flex-shrink-0 me-2 animate__animated ${chat.nsfw ? 'nsfw-content' : ''}"
             data-id="${chat._id}"
             data-user-id="${ownerId}"
             data-updated-at="${updatedAt}"
             onclick="handleChatThumbClick(this)"
             style="cursor: pointer; opacity: 0; animation-delay: ${animationDelay};">

            <div class="chat-thumb-card rounded-circle border border-2 border-light shadow-sm position-relative overflow-visible"
                 style="width: 60px; height: 60px; background-image: url('${chat.chatImageUrl || '/img/logo.webp'}'); background-size: cover; background-position: center;">

                ${badgeHtml}

            </div>

            <div class="chat-thumb-name text-center mt-1 d-none">
                <small class="text-dark fw-medium text-truncate d-block" style="font-size: 0.7rem; max-width: 60px;">
                    ${chat.name}
                </small>
            </div>
        </div>
    `);
}

// Function to fetch and update levels for chat thumbnails
async function updateChatThumbLevels(chats) {
    if (!chats || chats.length === 0) return;

    const horizontalChatList = $('#horizontal-chat-list');
    
    for (const chat of chats) {
        try {
            const response = await $.ajax({
                url: `/api/chat-level/${chat._id}`,
                method: 'GET',
                xhrFields: {
                    withCredentials: true
                }
            });
            
            if (response.success) {
                const level = response.level;
                const $thumb = horizontalChatList.find(`.chat-thumb-container[data-id="${chat._id}"]`);
                if ($thumb.length > 0) {
                    // Update the heart badge
                    let heartIcon = getHeartIcon(level);
                    let badgeClass = getHeartBadgeClass(level);
                    
                    const $card = $thumb.find('.chat-thumb-card');
                    $card.find('.heart-badge').remove(); // Remove existing
                    
                    if (level > 0) {
                        const iconHtml = level > 0 ? `<img src="/img/heart/${heartIcon}" class="heart-icon ${badgeClass}" alt="♥">` : '';
                        $card.append(`
                            <div class="heart-badge position-absolute start-50 translate-middle-x d-flex align-items-center justify-content-center ${badgeClass}">
                                ${iconHtml}
                                <span class="heart-number text-white fw-bold">${level}</span>
                            </div>
                        `);
                    }
                    
                } else {
                    console.warn('⚠️ [UI WARNING] Thumb not found for chat:', chat._id);
                }
            }
        } catch (error) {
            // Silently handle errors to avoid console logs
        }
    }
}

// Function to update the current chat level in the avatar menu
async function updateCurrentChatLevel() {
    const chatId = localStorage.getItem('chatId');
    const userId = window.user && window.user._id;

    if (!chatId || !userId) return;

    try {
        const response = await $.ajax({
            url: `/api/chat-level/${chatId}`,
            method: 'GET',
            xhrFields: {
                withCredentials: true
            }
        });

        if (response.success) {
            const level = response.level;
            const container = $('#chatLevelContainer span');
            if (container.length > 0) {
                // Choose heart icon based on level
                let heartIcon = getHeartIcon(level);
                let badgeClass = getHeartBadgeClass(level);

                const iconHtml = level ? `<img src="/img/heart/${heartIcon}" class="heart-icon ${badgeClass}" alt="♥" style="width: 16px; height: 16px; margin-right: 4px;">` : '';
                container.html(`${iconHtml}${translations.avatar.lvl || 'Lvl.'} ${level}`);

                // Update button class based on level for professional styling
                container.removeClass('btn-primary btn-success btn-warning btn-danger btn-info d-none');
                if (level >= 20) {
                    container.addClass('btn-danger'); // Diamond or higher - red
                } else if (level >= 15) {
                    container.addClass('btn-warning'); // Platinum - yellow
                } else if (level >= 10) {
                    container.addClass('btn-success'); // Gold - green
                } else if (level >= 5) {
                    container.addClass('btn-info'); // Bronze and below - blue
                } else {
                    container.addClass('btn-dark'); // Default
                }
            }
        } 
    } catch (error) {
        console.error('Error fetching current chat level:', error);
    }
}

// Display chat thumbnails in horizontal menu (similar to displayImageThumb)
function displayChatThumbs(chats, userId) {
    const horizontalChatList = $('#horizontal-chat-list');
    
    // Hide loading spinner
    $('#horizontal-chat-loading').hide().remove();
    $('#horizontal-chat-list').show();
    
    const normalizedChats = Array.isArray(chats)
        ? chats.map(normalizeChatRecord)
        : [];
    const sortedChats = sortChatsByUpdatedAt(normalizedChats);

    if (!sortedChats || sortedChats.length === 0) {
        return;
    }
    
    horizontalChatList.empty();
    
    sortedChats.forEach(function(chat, index) {
        const chatThumb = buildChatThumbElement(chat, index); // Use the heart version
        horizontalChatList.append(chatThumb);
    });
    
    // Fetch and update levels for all chats
    updateChatThumbLevels(sortedChats);
    
    // Trigger bouncing animation for each thumbnail with staggered timing
    horizontalChatList.find('.chat-thumb-container').each(function(index) {
        const $thumb = $(this);
        setTimeout(() => {
            $thumb.addClass('animate__bounceIn').css('opacity', '1');
            
            // Remove animation class after animation completes to allow re-animation
            setTimeout(() => {
                $thumb.removeClass('animate__bounceIn');
            }, 1000);
        }, index * 100); // 100ms delay between each thumbnail
    });

    if (chatId) {
        updateHorizontalChatMenu(chatId);
    }
}

// Handle click on chat thumbnail
function handleChatThumbClick(el) {
    const $el = $(el);
    const selectChatId = $el.data('id');
    const chatOwnerId = $el.data('user-id');
    const activeUserId = typeof window.userId !== 'undefined' ? window.userId : chatOwnerId;

    if (!selectChatId) {
        console.error('No chat ID found in clicked thumbnail');
        return;
    }

    // Track chat start event
    if (typeof UserTracking !== 'undefined' && UserTracking.trackStartChat) {
        UserTracking.trackStartChat(selectChatId, 'chat_list', {
            sourceElementId: null,
            sourceElementClass: 'chat-thumb'
        });
    }

    window.chatId = selectChatId;

    // Always fetch using the signed-in user so we reopen the latest session instead of resetting.
    if (typeof window.fetchChatData === 'function') {
        window.fetchChatData(selectChatId, activeUserId, null, function() {
            $el.prependTo($el.parent());
        });
    } else {
        // Redirect to chat page if fetchChatData is not available (e.g., on /character page)
        window.location.href = `/chat/${selectChatId}`;
    }
}

// Update horizontal chat menu when current chat changes
function updateHorizontalChatMenu(currentChatId) {
    const horizontalList = $('#horizontal-chat-list');
    if (horizontalList.length === 0) return;

    horizontalList.find('.chat-thumb-indicator').remove();

    if (!currentChatId) return;

    let currentThumb = horizontalList.find(`.chat-thumb-container[data-id="${currentChatId}"]`);
    const chatData = chatCache.data.find(chat => chat._id === currentChatId);

    if (currentThumb.length === 0 && chatData) {
        currentThumb = buildChatThumbElement(chatData, 0);
        currentThumb.css('opacity', '1');
        horizontalList.append(currentThumb);
    }

    if (!currentThumb.length) {
        return;
    }

    let chatTimestamp = parseInt(currentThumb.attr('data-updated-at'), 10);
    if (Number.isNaN(chatTimestamp)) {
        chatTimestamp = 0;
    }

    if (chatData) {
        const imageUrl = chatData.chatImageUrl || '/img/logo.webp';
        currentThumb.attr('data-user-id', resolveOwnerId(chatData.userId));
        chatTimestamp = getChatTimestamp(chatData);
        currentThumb.attr('data-updated-at', chatTimestamp);
        currentThumb.find('.chat-thumb-card').css('background-image', `url('${imageUrl}')`);
        currentThumb.find('.chat-thumb-name small').text(chatData.name || '');
    }
    const siblings = horizontalList.children('.chat-thumb-container').not(currentThumb);
    let inserted = false;

    siblings.each(function() {
        const $sibling = $(this);
        const siblingTimestamp = parseInt($sibling.attr('data-updated-at'), 10) || 0;
        if (chatTimestamp >= siblingTimestamp) {
            currentThumb.insertBefore($sibling);
            inserted = true;
            return false;
        }
    });

    if (!inserted) {
        currentThumb.appendTo(horizontalList);
    }

    currentThumb.find('.chat-thumb-card').append(
        '<div class="chat-thumb-indicator position-absolute top-0 end-0 bg-primary rounded-circle" style="width: 12px; height: 12px; border: 2px solid white;"></div>'
    );
}

window.logFullConversation = function(chatId) {

    const userChatId = localStorage.getItem('userChatId') || sessionStorage.getItem('userChatId');
    if (!userChatId) {
        showNotification('No user chat ID found', 'error');
        return;
    }

    if (!window.isAdmin) {
        console.warn('Unauthorized: Admin access required');
        return;
    }

    if (!chatId) {
        showNotification('Invalid chat ID', 'error');
        return;
    }

    // Show loading notification
    showNotification('Fetching conversation...', 'info');

    $.ajax({
        url: `/api/log-conversation/${chatId}/${userChatId}`,
        method: 'POST',
        xhrFields: {
            withCredentials: true
        },
        success: function(response) {
            if (response.success) {
                showNotification('Conversation logged to server console', 'success');
                console.log('Conversation logged successfully:', response.message);
            } else {
                showNotification('Failed to log conversation', 'error');
            }
        },
        error: function(xhr, status, error) {
            console.error('Error logging conversation:', error);
            showNotification('Error logging conversation', 'error');
        }
    });
};


// Add CSS styles for horizontal chat menu
const horizontalChatStyles = `
<style>
#horizontal-chat-menu {
    border-bottom: 1px solid #e9ecef;
}

#horizontal-chat-list {
    scrollbar-width: none;
    -ms-overflow-style: none;
    scroll-behavior: smooth;
    gap: 0.5rem;
}

#horizontal-chat-list::-webkit-scrollbar {
    display: none;
}

#horizontal-chat-loading {
    min-height: 80px;
    width: 100%;
}

.chat-thumb-container {
    flex: 0 0 auto;
    min-width: 60px;
    animation-duration: 0.6s;
    animation-fill-mode: both;
}

.chat-thumb-container:hover .chat-thumb-card {
    transform: translateY(-2px) scale(1.05);
    transition: all 0.2s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
}

.chat-thumb-card {
    transition: all 0.2s ease;
    cursor: pointer;
}
.chat-thumb-card {
    width: 70px !important;
    height: 70px !important;
}
.chat-thumb-name small {
    color: #495057;
}

.chat-thumb-container:hover .chat-thumb-name small {
    color: #007bff;
    transition: color 0.2s ease;
}

/* Ensure Animate.css bounce effect is visible */
.animate__bounceIn {
    animation-name: bounceIn;
    animation-duration: 0.75s;
    animation-timing-function: cubic-bezier(0.215, 0.610, 0.355, 1.000);
}

@keyframes bounceIn {
    from,
    20%,
    40%,
    60%,
    80%,
    to {
        animation-timing-function: cubic-bezier(0.215, 0.610, 0.355, 1.000);
    }

    0% {
        opacity: 0;
        transform: scale3d(0.3, 0.3, 0.3);
    }

    20% {
        transform: scale3d(1.1, 1.1, 1.1);
    }

    40% {
        transform: scale3d(0.9, 0.9, 0.9);
    }

    60% {
        opacity: 1;
        transform: scale3d(1.03, 1.03, 1.03);
    }

    80% {
        transform: scale3d(0.97, 0.97, 0.97);
    }

    to {
        opacity: 1;
        transform: scale3d(1, 1, 1);
    }
}

@media (max-width: 768px) {
    #horizontal-chat-menu .container-fluid {
        padding-left: 0.5rem;
        padding-right: 0.5rem;
    }
    
    .chat-thumb-container {
        min-width: 50px;
    }

    .chat-thumb-name small {
        font-size: 0.6rem !important;
        max-width: 50px !important;
    }
}

/* Level badge styles */
.level-badge {
    bottom: -5px;
    font-size: 0.7rem;
    padding: 2px 6px;
    border-radius: 10px;
    min-width: 20px;
    text-align: center;
    line-height: 1;
}

.level-badge.zero {
    background-color: #6c757d;
}

.level-badge.bronze {
    background-color: #cd7f32;
}

.level-badge.gold {
    background-color: #ffd700;
    color: #000;
}

.level-badge.platinum {
    background-color: #e5e4e2;
    color: #000;
}

.level-badge.purple {
    background-color: #6f42c1;
}

.level-badge.diamond {
    background-color: #b9f2ff;
    color: #000;
}

@keyframes breathe {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
}
</style>
`;

// Debug function to test loading skeleton state
window.debugShowLoadingState = function(count = 5) {
    const latestList = $('#latest-chat-list');
    
    if (latestList.length === 0) {
        console.warn('Chat list not found');
        return;
    }
    
    // Make sure the list is visible
    latestList.removeClass('d-none');
    latestList.show();
    
    // Clear existing content
    latestList.empty();
    
    // Add skeleton items with proper spacing (similar to actual chat items)
    const skeletonContainer = $('<div class="loading-dots-container"></div>');
    for (let i = 0; i < count; i++) {
        skeletonContainer.append('<div class="loading-dot" style="margin-bottom: 0.5rem;"></div>');
    }
    latestList.append(skeletonContainer);
    
    console.log(`✓ Loading skeleton state displayed with ${count} items.`);
    console.log(`  Call debugHideLoadingState() to restore the chat list.`);
};

// Debug function to hide/restore the loading state
window.debugHideLoadingState = function() {
    const latestList = $('#latest-chat-list');
    
    if (latestList.length === 0) {
        console.warn('Chat list not found');
        return;
    }
    
    // Clear skeleton items
    latestList.empty();
    
    // Reload actual chat list
    displayChatList(false, window.userId);
    
    console.log('✓ Chat list restored.');
};

// Make functions available globally
window.displayChatList = displayChatList;
window.displayUserChatHistoryInModal = displayUserChatHistoryInModal;
window.updateCurrentChat = updateCurrentChat;
window.getUserChatHistory = getUserChatHistory;
window.handleUserChatHistoryClick = handleUserChatHistoryClick;
window.handleChatListItemClick = handleChatListItemClick;
window.deleteChatHandler = deleteChatHandler;
window.deleteChatHistoryHandler = deleteChatHistoryHandler;
window.showChatHistory = showChatHistory;
window.displayHorizontalChatList = displayHorizontalChatList;
window.displayChatThumbs = displayChatThumbs;
window.handleChatThumbClick = handleChatThumbClick;
window.updateHorizontalChatMenu = updateHorizontalChatMenu;
window.initializeHorizontalChatMenu = initializeHorizontalChatMenu;
window.updateCurrentChatLevel = updateCurrentChatLevel;
window.openChatActionsModal = openChatActionsModal;
window.closeChatActionsModal = closeChatActionsModal;