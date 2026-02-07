/**
 * Gallery Display Utils
 * Global function for rendering character cards in galleries
 * Used across multiple pages: character.hbs, dashboard.js, explore pages, etc.
 */

/**
 * Global displayChats function for rendering character cards in galleries
 */
window.displayChats = function (chatData, targetGalleryId = 'chat-gallery', modal = false) {
    const currentUser = window.user || {};
    const currentUserId = currentUser._id;
    const subscriptionStatus = currentUser.subscriptionStatus === 'active';
    const isTemporaryUser = !!currentUser.isTemporary;
    
    let htmlContent = '';
    
    if (!Array.isArray(chatData)) {
        return;
    }
    
    chatData.forEach(chat => {
        if (!chat || (!chat.name && !chat.chatName)) return;
        
        // Normalize nsfw to boolean
        const nsfw = chat?.nsfw === true || chat?.nsfw === 'true';
        const moderationFlagged = Array.isArray(chat?.moderation?.results) && 
            chat.moderation.results.length > 0 && !!chat.moderation.results[0].flagged;
        const finalNsfwResult = nsfw || moderationFlagged;
        const isOwner = chat.userId === currentUserId;
        
        // Sample image selection logic
        let sampleImages = [];
        if (Array.isArray(chat.sampleImages) && chat.sampleImages.length > 0) {
            sampleImages = chat.sampleImages.filter(img => img && img.imageUrl).map(img => img.imageUrl);
        }
        if (Array.isArray(chat.images) && chat.images.length > 0) {
            sampleImages = sampleImages.concat(chat.images.filter(img => img && img.imageUrl).map(img => img.imageUrl));
        }
        if (chat.chatImageUrl) {
            sampleImages.unshift(chat.chatImageUrl);
        }
        sampleImages = [...new Set(sampleImages.filter(Boolean))];
        if (sampleImages.length === 0) {
            sampleImages = ['/img/logo.webp'];
        }
        
        const primaryImage = sampleImages[0];
        const secondaryImage = sampleImages.find((img) => img !== primaryImage) || primaryImage;
        const chatId = chat.chatId || chat._id;
        const chatName = chat.name || chat.chatName || 'Unknown';
        const chatSlug = chat.slug || null;
        const genderClass = chat.gender ? `chat-gender-${chat.gender.toLowerCase()}` : '';
        const styleClass = chat.imageStyle ? `chat-style-${chat.imageStyle.toLowerCase()}` : '';
        
        // Determine click action
        let clickAction;
        if (chat.premium && !subscriptionStatus) {
            clickAction = `loadPlanPage()`;
        } else if (chatSlug) {
            // If slug is available, navigate to character profile page with slug
            clickAction = `window.location.href='/character/slug/${chatSlug}'`;
        } else {
            // Fallback to character page with chatId
            clickAction = `window.location.href='/character/${chatId}'`;
        }
        
        htmlContent += `
            <div class="gallery-card ${finalNsfwResult ? 'nsfw-content' : ''} ${chat.premium ? 'premium-chat' : ''} ${genderClass} ${styleClass}" data-id="${chat._id}">
                <div class="card gallery-hover"
                    onclick="${clickAction}"
                    style="cursor: pointer;">
                    <!-- Primary Image -->
                    <img 
                        src="${primaryImage}" 
                        alt="${chatName}" 
                        class="gallery-img gallery-img-primary"
                        loading="lazy"
                    >
                    <!-- Secondary Image for hover -->
                    <img 
                        src="${secondaryImage}" 
                        alt="${chatName}"
                        class="gallery-img gallery-img-secondary"
                        style="position: absolute; inset: 0; opacity: 0;"
                        loading="lazy"
                    >
                    
                    <!-- Multi-image indicator -->
                    ${sampleImages.length > 1 ? `
                        <i class="bi bi-images multi-indicator"></i>
                    ` : ''}
                    
                    <!-- Owner Badge & Social Manager Button -->
                    ${isOwner ? `
                        <div class="position-absolute top-0 start-0 p-2 d-flex align-items-center gap-1" style="z-index: 10;">
                            <span class="badge rounded-pill px-2 py-1" 
                                  style="background: rgba(139, 92, 246, 0.9); font-size: 0.65rem; font-weight: 600;">
                                <i class="bi bi-person-fill"></i> My Character
                            </span>
                        </div>
                        <a href="/dashboard/social/${chatId}" 
                           class="position-absolute bottom-0 end-0 m-2 btn btn-sm rounded-pill d-flex align-items-center gap-1"
                           onclick="event.stopPropagation();"
                           style="background: linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%); border: none; color: white; font-size: 0.7rem; padding: 4px 10px; z-index: 10;"
                           title="Manage Social Presence">
                            <i class="bi bi-megaphone-fill"></i>
                        </a>
                    ` : ''}
                    
                    <!-- Floating Like Button -->
                    <button class="gallery-like-btn d-none" 
                            data-chat-id="${chatId}"
                            onclick="event.stopPropagation(); toggleCharacterFavorite('${chatId}', this);"
                            title="Add to favorites">
                        <i class="bi bi-heart"></i>
                    </button>
                    
                    <!-- Hover overlay content -->
                    <div class="hover-overlay position-absolute inset-0 d-flex align-items-center justify-content-center" 
                         style="background: rgba(0,0,0,0.4); opacity: 0; transition: opacity 0.2s ease; inset: 0; position: absolute;">
                        <div class="text-white text-center px-2">
                            <div class="fw-bold text-truncate" style="font-size: 13px; max-width: 120px;">${chatName}</div>
                        </div>
                    </div>
                    
                    <!-- Loading spinner -->
                    <div id="spinner-${chatId}" class="position-absolute d-none justify-content-center align-items-center" style="background: rgba(0,0,0,0.7); z-index: 20; inset: 0;">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                    </div>
                </div>
            </div>
        `;
    });
    
    // Append to target gallery
    const $target = $(`#${targetGalleryId}`);
    
    if ($target.length > 0) {
        $target.append(htmlContent);
    } else {
        // Try fallback
        const $fallback = $('#chat-gallery');
        if ($fallback.length > 0) {
            $fallback.append(htmlContent);
        }
    }
    
    // Apply hover effects
    $('.gallery-card .card').off('mouseenter mouseleave').on('mouseenter', function() {
        $(this).find('.gallery-img-primary').css('opacity', '0');
        $(this).find('.gallery-img-secondary').css('opacity', '1');
        $(this).find('.hover-overlay').css('opacity', '1');
    }).on('mouseleave', function() {
        $(this).find('.gallery-img-primary').css('opacity', '1');
        $(this).find('.gallery-img-secondary').css('opacity', '0');
        $(this).find('.hover-overlay').css('opacity', '0');
    });
};
