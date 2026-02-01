/**
 * Social Media Connections Manager
 * Handles SNS account connections and posting functionality
 */

(function() {
    'use strict';

    // State management
    const state = {
        connections: [],
        limits: { current: 0, max: 1, isPremium: false },
        isLoading: false,
        currentImage: null,
        selectedPlatforms: [],
        captionStyle: 'engaging'
    };

    // Translations fallback
    const getTranslation = (key, fallback) => {
        return window.translations?.sns?.[key] || fallback;
    };

    /**
     * Initialize the social connections manager
     */
    function init() {
        console.log('[Social] Initializing social connections manager');
        
        // Load connections when settings modal opens
        $('#settingsModal').on('show.bs.modal', onSettingsModalOpen);
        $('#settingsModal').on('shown.bs.tab', onSettingsTabChange);
        
        // Initialize SNS post modal
        initSnsPostModal();
        
        // Bind platform connect buttons
        bindConnectButtons();
        
        // Check for URL params (OAuth callbacks)
        handleOAuthCallback();
    }

    /**
     * Handle settings modal open
     */
    function onSettingsModalOpen() {
        // Load connections if on connections tab
        const activeTab = $('#myTab .nav-link.active').attr('id');
        if (activeTab === 'connections-tab') {
            loadConnections();
            loadRecentPosts();
        }
    }

    /**
     * Handle tab change in settings
     */
    function onSettingsTabChange(e) {
        const target = $(e.target).attr('id');
        if (target === 'connections-tab') {
            loadConnections();
            loadRecentPosts();
        }
    }

    /**
     * Load user's SNS connections
     */
    async function loadConnections() {
        if (state.isLoading) return;
        
        state.isLoading = true;
        console.log('[Social] Loading connections...');
        
        try {
            const response = await fetch('/api/social/status', {
                method: 'GET',
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success) {
                state.connections = data.connections || [];
                state.limits = data.limits || { current: 0, max: 1, isPremium: false };
                
                console.log('[Social] Loaded connections:', state.connections.length);
                
                renderConnections();
                updateLimitInfo();
                updateConnectButtons();
            } else {
                throw new Error(data.error || 'Failed to load connections');
            }
        } catch (error) {
            console.error('[Social] Error loading connections:', error);
            showConnectionsError(error.message);
        } finally {
            state.isLoading = false;
        }
    }

    /**
     * Render connected accounts list
     */
    function renderConnections() {
        const container = $('#connectedAccountsList');
        
        if (state.connections.length === 0) {
            container.html(`
                <div class="text-center p-4">
                    <i class="bi bi-link-45deg fs-1 mb-2 text-muted"></i>
                    <p class="mb-0 text-muted">${getTranslation('no_connections', 'No connected accounts yet')}</p>
                    <p class="small text-muted">${getTranslation('connect_hint', 'Connect your social media accounts below')}</p>
                </div>
            `);
            return;
        }

        const html = state.connections.map(conn => {
            const platformIcon = getPlatformIcon(conn.platform);
            const platformName = getPlatformName(conn.platform);
            const avatar = conn.profileUrl || '/img/avatar.png';
            
            return `
                <div class="connected-account-item" data-connection-id="${conn.id}" data-platform="${conn.platform}">
                    <div class="account-info">
                        <img src="${avatar}" alt="${conn.username}" class="account-avatar" onerror="this.src='/img/avatar.png'">
                        <div class="account-details">
                            <span class="account-username">@${conn.username}</span>
                            <span class="account-platform">
                                ${platformIcon}
                                ${platformName}
                            </span>
                        </div>
                    </div>
                    <button type="button" class="btn btn-link disconnect-btn" onclick="window.SocialConnections.disconnect('${conn.platform}', '${conn.id}')" title="${getTranslation('disconnect', 'Disconnect')}">
                        <i class="bi bi-x-circle"></i>
                    </button>
                </div>
            `;
        }).join('');

        container.html(html);
    }

    /**
     * Update account limit info
     */
    function updateLimitInfo() {
        const { current, max, isPremium } = state.limits;
        
        $('#connectionCountBadge').text(`${current}/${max}`);
        
        const limitText = isPremium 
            ? getTranslation('premium_limit', `Premium: ${max} accounts`)
            : getTranslation('free_limit', `Free: ${max} account`);
        
        $('#connectionLimitText').text(limitText);
        
        // Show/hide premium upsell
        if (!isPremium && current >= max) {
            $('#connectionPremiumUpsell').show();
        } else {
            $('#connectionPremiumUpsell').hide();
        }
    }

    /**
     * Update connect buttons state
     */
    function updateConnectButtons() {
        const canConnect = state.connections.length < state.limits.max;
        
        $('.platform-connect-btn').each(function() {
            const platform = $(this).data('platform');
            const isConnected = state.connections.some(c => c.platform === platform);
            
            if (isConnected) {
                $(this)
                    .addClass('connected')
                    .prop('disabled', true)
                    .html(`${getPlatformIcon(platform)} <span>${getPlatformName(platform)}</span> <i class="bi bi-check-circle ms-1"></i>`);
            } else if (!canConnect) {
                $(this)
                    .removeClass('connected')
                    .prop('disabled', true)
                    .attr('title', getTranslation('limit_reached', 'Account limit reached'));
            } else {
                $(this)
                    .removeClass('connected')
                    .prop('disabled', false)
                    .html(`${getPlatformIcon(platform)} <span>${getPlatformName(platform)}</span>`);
            }
        });
    }

    /**
     * Bind connect button handlers
     */
    function bindConnectButtons() {
        $(document).on('click', '.platform-connect-btn:not(.connected):not(:disabled)', async function() {
            const platform = $(this).data('platform');
            await connectPlatform(platform, $(this));
        });
    }

    /**
     * Connect to a platform
     */
    async function connectPlatform(platform, $button) {
        console.log('[Social] Connecting to:', platform);
        
        const originalHtml = $button.html();
        $button.prop('disabled', true).html(`
            <span class="spinner-border spinner-border-sm me-1"></span>
            ${getTranslation('connecting', 'Connecting...')}
        `);
        
        try {
            const response = await fetch(`/api/social/connect/${platform}`, {
                method: 'GET',
                credentials: 'include'
            });

            const data = await response.json();
            
            if (data.success && data.authUrl) {
                // Open OAuth in new window
                const authWindow = window.open(data.authUrl, 'sns_auth', 'width=600,height=700');
                
                // Check for window close
                const checkClosed = setInterval(() => {
                    if (authWindow.closed) {
                        clearInterval(checkClosed);
                        $button.prop('disabled', false).html(originalHtml);
                        // Reload connections after OAuth
                        setTimeout(() => loadConnections(), 1000);
                    }
                }, 500);
            } else if (data.needsUpgrade) {
                showNotification(getTranslation('upgrade_required', 'Upgrade to premium to connect more accounts'), 'warning');
                loadPlanPage();
                $button.prop('disabled', false).html(originalHtml);
            } else {
                throw new Error(data.error || 'Failed to get auth URL');
            }
        } catch (error) {
            console.error('[Social] Connect error:', error);
            showNotification(error.message || getTranslation('connect_error', 'Failed to connect'), 'error');
            $button.prop('disabled', false).html(originalHtml);
        }
    }

    /**
     * Disconnect from a platform
     */
    async function disconnect(platform, accountId) {
        const confirmed = await Swal.fire({
            title: getTranslation('confirm_disconnect', 'Disconnect account?'),
            text: getTranslation('disconnect_warning', 'You will need to reconnect to post again.'),
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: getTranslation('disconnect', 'Disconnect'),
            cancelButtonText: window.translations?.cancel || 'Cancel',
            confirmButtonColor: '#dc3545'
        });

        if (!confirmed.isConfirmed) return;

        console.log('[Social] Disconnecting:', platform, accountId);
        
        try {
            const response = await fetch(`/api/social/disconnect/${platform}/${accountId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            const data = await response.json();
            
            if (data.success) {
                showNotification(getTranslation('disconnected', 'Account disconnected'), 'success');
                loadConnections();
            } else {
                throw new Error(data.error || 'Failed to disconnect');
            }
        } catch (error) {
            console.error('[Social] Disconnect error:', error);
            showNotification(error.message || getTranslation('disconnect_error', 'Failed to disconnect'), 'error');
        }
    }

    /**
     * Handle OAuth callback from URL params
     */
    function handleOAuthCallback() {
        const params = new URLSearchParams(window.location.search);
        
        if (params.has('sns_success')) {
            const platform = params.get('platform');
            showNotification(
                getTranslation('connected_success', `Successfully connected to ${getPlatformName(platform)}`),
                'success'
            );
            // Clean URL
            window.history.replaceState({}, '', window.location.pathname);
            // Open settings to connections tab
            setTimeout(() => {
                openSettingsConnectionsTab();
            }, 500);
        } else if (params.has('sns_error')) {
            const error = params.get('sns_error');
            showNotification(
                getTranslation('connect_failed', `Connection failed: ${error}`),
                'error'
            );
            window.history.replaceState({}, '', window.location.pathname);
        }
    }

    /**
     * Initialize SNS Post Modal
     */
    function initSnsPostModal() {
        const $modal = $('#snsPostModal');
        
        // Caption character count
        $('#snsPostCaption').on('input', function() {
            const count = $(this).val().length;
            $('#captionCharCount').text(count);
        });
        
        // Generate caption button
        $('#generateCaptionBtn').on('click', generateCaption);
        
        // Publish button
        $('#publishSnsPostBtn').on('click', publishPost);
        
        // Platform checkbox change
        $(document).on('change', '.sns-platform-checkbox', updatePublishButton);
        
        // Platform button click - toggle checkbox
        $(document).on('click', '.sns-platform-btn', function() {
            const checkboxId = $(this).data('checkbox-id');
            const $checkbox = $(`#${checkboxId}`);
            const isChecked = !$checkbox.prop('checked');
            $checkbox.prop('checked', isChecked).trigger('change');
            updatePlatformButtonState($(this), isChecked);
        });
        
        // Modal events
        $modal.on('show.bs.modal', onSnsPostModalOpen);
        $modal.on('hidden.bs.modal', onSnsPostModalClose);
    }

    /**
     * Open SNS Post Modal
     */
    function openSnsPostModal(imageUrl, imagePrompt, imageId) {
        state.currentImage = { url: imageUrl, prompt: imagePrompt, id: imageId };
        
        $('#snsPostImage').attr('src', imageUrl);
        $('#snsPostCaption').val('').trigger('input');
        state.selectedPlatforms = [];
        
        const modal = new bootstrap.Modal(document.getElementById('snsPostModal'));
        modal.show();
    }

    /**
     * Handle SNS Post Modal Open
     */
    async function onSnsPostModalOpen() {
        console.log('[Social] SNS Post modal opened');
        
        // Show style options
        $('#captionStyleOptions').show();
        
        // Load connections for platform selection
        if (state.connections.length === 0) {
            await loadConnections();
        }
        
        renderPlatformCheckboxes();
    }

    /**
     * Handle SNS Post Modal Close
     */
    function onSnsPostModalClose() {
        state.currentImage = null;
        state.selectedPlatforms = [];
    }

    /**
     * Render platform checkboxes in post modal
     */
    function renderPlatformCheckboxes() {
        const container = $('#snsPlatformCheckboxes');
        
        // Always show profile option first
        let html = `
            <div class="platform-checkbox-wrapper">
                <input type="checkbox" class="sns-platform-checkbox" 
                       id="platform_profile" 
                       data-platform="profile"
                       value="profile"
                       style="display: none;">
                <button type="button" class="sns-platform-btn" 
                        data-checkbox-id="platform_profile"
                        data-platform="profile">
                    <i class="bi bi-person-circle"></i>
                    <span>${getTranslation('post_to_profile', 'My Profile')}</span>
                </button>
            </div>
        `;
        
        // Add SNS connections if any
        html += state.connections.map(conn => {
            const platformIcon = getPlatformIcon(conn.platform);
            const platformName = getPlatformName(conn.platform);
            
            return `
                <div class="platform-checkbox-wrapper">
                    <input type="checkbox" class="sns-platform-checkbox" 
                           id="platform_${conn.platform}_${conn.id}" 
                           data-platform="${conn.platform}"
                           value="${conn.id}"
                           style="display: none;">
                    <button type="button" class="sns-platform-btn" 
                            data-checkbox-id="platform_${conn.platform}_${conn.id}">
                        ${platformIcon}
                        <span>@${conn.username}</span>
                    </button>
                </div>
            `;
        }).join('');

        container.html(html);
        
        // Hide no connections warning since profile is always available
        $('#noConnectionsWarning').hide();
        
        // Initialize button states based on checkbox states
        $('.sns-platform-btn').each(function() {
            const checkboxId = $(this).data('checkbox-id');
            const $checkbox = $(`#${checkboxId}`);
            updatePlatformButtonState($(this), $checkbox.prop('checked'));
        });
    }

    /**
     * Update platform button active state
     */
    function updatePlatformButtonState($button, isActive) {
        if (isActive) {
            $button.addClass('active');
        } else {
            $button.removeClass('active');
        }
    }

    /**
     * Update publish button state
     */
    function updatePublishButton() {
        const checkedCount = $('.sns-platform-checkbox:checked').length;
        const hasCaption = $('#snsPostCaption').val().trim().length > 0;
        
        state.selectedPlatforms = [];
        $('.sns-platform-checkbox:checked').each(function() {
            state.selectedPlatforms.push($(this).data('platform'));
        });
        
        $('#publishSnsPostBtn').prop('disabled', checkedCount === 0 || !hasCaption);
    }

    /**
     * Generate AI caption
     */
    async function generateCaption() {
        if (!state.currentImage) {
            showNotification(getTranslation('no_image', 'No image selected'), 'error');
            return;
        }

        const $btn = $('#generateCaptionBtn');
        const $status = $('#captionGeneratingStatus');
        const originalHtml = $btn.html();
        
        $btn.prop('disabled', true);
        $status.show();
        
        try {
            // Determine target platform
            const targetPlatform = state.selectedPlatforms[0] || 'general';
            
            // Get style and language from dropdowns
            const captionStyle = $('#captionStyleSelect').val() || 'engaging';
            const captionLanguage = $('#captionLanguageSelect').val() || 'english';
            
            // Get existing caption (if any) to use as a starting point
            const existingCaption = $('#snsPostCaption').val().trim();
            
            const response = await fetch('/api/social/generate-caption', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    imagePrompt: state.currentImage.prompt,
                    imageUrl: state.currentImage.url,
                    platform: targetPlatform,
                    style: captionStyle,
                    language: captionLanguage,
                    existingCaption: existingCaption || undefined
                })
            });

            const data = await response.json();
            
            if (data.success && data.caption) {
                $('#snsPostCaption').val(data.caption).trigger('input');
                updatePublishButton();
                // Save to caption history
                if (typeof window.CaptionHistory !== 'undefined') {
                    window.CaptionHistory.saveCaption(data.caption, state.currentImage?.id);
                }
                showNotification(getTranslation('caption_generated', 'Caption generated!'), 'success');
            } else {
                throw new Error(data.error || 'Failed to generate caption');
            }
        } catch (error) {
            console.error('[Social] Caption generation error:', error);
            showNotification(error.message || getTranslation('caption_error', 'Failed to generate caption'), 'error');
        } finally {
            $btn.prop('disabled', false);
            $status.hide();
        }
    }

    /**
     * Publish post to selected platforms
     */
    async function publishPost() {
        const caption = $('#snsPostCaption').val().trim();
        const platforms = state.selectedPlatforms;
        
        if (!caption || platforms.length === 0) {
            showNotification(getTranslation('missing_info', 'Please add caption and select platforms'), 'error');
            return;
        }

        const $btn = $('#publishSnsPostBtn');
        const originalHtml = $btn.html();
        
        $btn.prop('disabled', true).html(`
            <span class="spinner-border spinner-border-sm me-1"></span>
            ${getTranslation('publishing', 'Publishing...')}
        `);
        
        try {
            // Separate profile posts from SNS posts
            const postToProfile = platforms.includes('profile');
            const snsPlatforms = platforms.filter(p => p !== 'profile');
            
            const response = await fetch('/api/social/post', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    text: caption,
                    mediaUrls: state.currentImage ? [state.currentImage.url] : [],
                    platforms: snsPlatforms,
                    postToProfile: postToProfile,
                    imageId: state.currentImage?.id || null
                })
            });

            const data = await response.json();
            
            if (data.success) {
                showNotification(
                    data.message || getTranslation('post_success', 'Post published successfully!'),
                    'success'
                );
                
                // Reload recent posts to show the new post
                loadRecentPosts();
                
                // Close modal
                bootstrap.Modal.getInstance(document.getElementById('snsPostModal'))?.hide();
            } else if (data.needsConnection) {
                showNotification(getTranslation('need_connection', 'Please connect your accounts first'), 'warning');
                openSettingsConnectionsTab();
            } else if (data.needsReconnect) {
                // Account IDs couldn't be resolved - need to reconnect
                const failedList = data.failedPlatforms ? data.failedPlatforms.join(', ') : 'selected platforms';
                showNotification(
                    getTranslation('reconnect_required', `Please reconnect your ${failedList} account(s)`),
                    'warning'
                );
                openSettingsConnectionsTab();
            } else {
                throw new Error(data.error || 'Failed to publish');
            }
        } catch (error) {
            console.error('[Social] Publish error:', error);
            showNotification(error.message || getTranslation('publish_error', 'Failed to publish post'), 'error');
        } finally {
            $btn.prop('disabled', false).html(originalHtml);
        }
    }

    /**
     * Open settings modal on connections tab
     */
    function openSettingsConnectionsTab() {
        // Close any open modals first
        $('.modal').modal('hide');
        
        setTimeout(() => {
            // Load settings page
            if (typeof loadSettingsPage === 'function') {
                loadSettingsPage();
            }
            
            // Open settings modal
            const settingsModal = new bootstrap.Modal(document.getElementById('settingsModal'));
            settingsModal.show();
            
            // Switch to connections tab
            setTimeout(() => {
                $('#connections-tab').tab('show');
            }, 300);
        }, 300);
    }

    /**
     * Show error in connections list
     */
    function showConnectionsError(message) {
        $('#connectedAccountsList').html(`
            <div class="alert alert-danger m-0">
                <i class="bi bi-exclamation-triangle me-2"></i>
                ${message}
                <button type="button" class="btn btn-sm btn-outline-danger ms-2" onclick="window.SocialConnections.loadConnections()">
                    ${getTranslation('retry', 'Retry')}
                </button>
            </div>
        `);
    }

    /**
     * Load recent posts
     */
    async function loadRecentPosts() {
        console.log('[Social] Loading recent posts...');
        
        try {
            const response = await fetch('/api/social/posts?limit=10', {
                method: 'GET',
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success) {
                console.log('[Social] Loaded recent posts:', data.posts.length);
                renderRecentPosts(data.posts);
            } else {
                throw new Error(data.error || 'Failed to load posts');
            }
        } catch (error) {
            console.error('[Social] Error loading posts:', error);
            showRecentPostsError(error.message);
        }
    }

    /**
     * Render recent posts list
     */
    function renderRecentPosts(posts) {
        const container = $('#recentPostsList');
        
        if (posts.length === 0) {
            container.html(`
                <div class="text-center p-4 text-muted">
                    <i class="bi bi-inbox fs-1 mb-2"></i>
                    <p class="mb-0">${getTranslation('no_posts_yet', 'No posts yet')}</p>
                </div>
            `);
            return;
        }

        const html = posts.map(post => {
            const createdAt = new Date(post.createdAt);
            const timeAgo = formatTimeAgo(createdAt);
            const platformsList = post.platforms.map(p => {
                const icon = getPlatformIcon(p.platform);
                return `<span class="platform-badge">${icon}</span>`;
            }).join(' ');
            
            const statusBadge = getStatusBadge(post.status);
            const hasMedia = post.mediaUrls && post.mediaUrls.length > 0;
            const thumbnail = hasMedia ? post.mediaUrls[0] : null;
            
            return `
                <div class="recent-post-item">
                    ${thumbnail ? `
                        <div class="post-thumbnail">
                            <img src="${thumbnail}" alt="Post image" onerror="this.style.display='none'">
                        </div>
                    ` : ''}
                    <div class="post-details">
                        <div class="post-text">${escapeHtml(post.text.substring(0, 100))}${post.text.length > 100 ? '...' : ''}</div>
                        <div class="post-meta">
                            <span class="post-platforms">${platformsList}</span>
                            <span class="post-time"><i class="bi bi-clock me-1"></i>${timeAgo}</span>
                            ${statusBadge}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.html(html);
    }

    /**
     * Get status badge HTML
     */
    function getStatusBadge(status) {
        const badges = {
            'published': '<span class="badge bg-success">Published</span>',
            'pending': '<span class="badge bg-warning">Pending</span>',
            'scheduled': '<span class="badge bg-info">Scheduled</span>',
            'failed': '<span class="badge bg-danger">Failed</span>'
        };
        return badges[status] || '';
    }

    /**
     * Format time ago
     */
    function formatTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        const intervals = {
            year: 31536000,
            month: 2592000,
            week: 604800,
            day: 86400,
            hour: 3600,
            minute: 60
        };
        
        for (const [unit, secondsInUnit] of Object.entries(intervals)) {
            const interval = Math.floor(seconds / secondsInUnit);
            if (interval >= 1) {
                return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
            }
        }
        
        return 'Just now';
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Show error in recent posts list
     */
    function showRecentPostsError(message) {
        $('#recentPostsList').html(`
            <div class="alert alert-danger m-0">
                <i class="bi bi-exclamation-triangle me-2"></i>
                ${message}
            </div>
        `);
    }

    /**
     * Get platform icon SVG
     */
    function getPlatformIcon(platform) {
        const icons = {
            instagram: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`,
            twitter: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`
        };
        return icons[platform] || '<i class="bi bi-globe"></i>';
    }

    /**
     * Get platform display name
     */
    function getPlatformName(platform) {
        const names = {
            instagram: 'Instagram',
            twitter: 'X (Twitter)'
        };
        return names[platform] || platform;
    }

    // Initialize on document ready
    $(document).ready(init);

    // Expose public API
    window.SocialConnections = {
        loadConnections,
        loadRecentPosts,
        disconnect,
        openSnsPostModal,
        openSettingsConnectionsTab
    };

})();
