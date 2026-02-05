// Global states
var swiperInstance;
var currentSwiperIndex = 0;

// Loading Functions Names in this file
// loadAllChatImages
if (typeof allChatsLoadingState === 'undefined') allChatsLoadingState = false
if (typeof allChatsCurrentPage === 'undefined') allChatsCurrentPage = 0
if (typeof allChatsImagesCache === 'undefined') allChatsImagesCache = {}

// displayPeopleChat
if (typeof peopleChatCache === 'undefined') peopleChatCache = {}
if (typeof peopleChatLoadingState === 'undefined') peopleChatLoadingState = {}
if (typeof peopleChatCurrentPage === 'undefined') peopleChatCurrentPage = {}

// Global states for Latest Video Chats
var latestVideoChatsPage = 1;
var latestVideoChatsLoading = false;
var latestVideoChatsState = 1;
const LATEST_VIDEO_CHATS_CACHE_KEY = 'latestVideoChatsCache';
const LATEST_VIDEO_CHATS_CACHE_TIME_KEY = 'latestVideoChatsaCacheTime';
const LATEST_VIDEO_CHATS_CACHE_TTL = 1 * 60 * 60 * 1000; // 1 hour in milliseconds

// loadUserPosts 
// loadChatUsers
// loadUsers

// Helper functions for video chats cache
function getLatestVideoChatsCache() {
    const cache = sessionStorage.getItem(LATEST_VIDEO_CHATS_CACHE_KEY);
    const cacheTime = sessionStorage.getItem(LATEST_VIDEO_CHATS_CACHE_TIME_KEY);
    if (!cache || !cacheTime) return null;
    if (Date.now() - parseInt(cacheTime, 10) > LATEST_VIDEO_CHATS_CACHE_TTL) {
        sessionStorage.removeItem(LATEST_VIDEO_CHATS_CACHE_KEY);
        sessionStorage.removeItem(LATEST_VIDEO_CHATS_CACHE_TIME_KEY);
        return null;
    }
    try {
        return JSON.parse(cache);
    } catch {
        return null;
    }
}

function setLatestVideoChatsCache(page, data) {
    let cache = getLatestVideoChatsCache() || {};
    cache[page] = data;
    sessionStorage.setItem(LATEST_VIDEO_CHATS_CACHE_KEY, JSON.stringify(cache));
    sessionStorage.setItem(LATEST_VIDEO_CHATS_CACHE_TIME_KEY, Date.now().toString());
}

window.loadLatestVideoChats = async function(page = 1, reload = false) {
    if (latestVideoChatsLoading && !reload) {
        return;
    }
    latestVideoChatsLoading = true;
     $('#latest-video-chats-pagination-controls').html(
            `
            <div id="latest-video-chats-loading-spinner" class="text-center my-4">
                <div class="spinner-border text-purple" role="status" style="width: 3rem; height: 3rem;">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <div class="mt-2 text-muted">${translations.loadingMoreVideos ? translations.loadingMoreVideos : 'Loading more videos...'}</div>
            </div>  
            `
    ).show().css('opacity', '1');
    if (reload) {
        latestVideoChatsPage = 1;
        $('#latest-video-chats-gallery').empty();
        sessionStorage.removeItem(LATEST_VIDEO_CHATS_CACHE_KEY);
        sessionStorage.removeItem(LATEST_VIDEO_CHATS_CACHE_TIME_KEY);
    }

    let cache = getLatestVideoChatsCache();
    let data = cache && cache[page];

    if(data && data.videoChats && data.videoChats.length === 0) {
      $('#latest-video-chats-section').remove();
      latestVideoChatsLoading = false;
      $('#latest-video-chats-pagination-controls').html(`
            <div id="latest-video-chats-loading-spinner" class="text-center my-4">
                <div class="spinner-border text-purple" role="status" style="width: 3rem; height: 3rem;">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <div class="mt-2 text-muted">${translations.noMoreVideos ? translations.noMoreVideos : 'No more videos available.'}</div>
            </div>  `).show().css('opacity', '1');
      return;
    }

    if (data) {
        displayLatestVideoChats(data.videoChats, 'latest-video-chats-gallery');
        latestVideoChatsState = data.totalPages || 1;
        latestVideoChatsLoading = false;
        $('#latest-video-chats-pagination-controls').html('');
        return;
    }

    try {
        const res = await fetch(`/api/latest-video-chats?page=${page}`);
        if (!res.ok) {
            $('#latest-video-chats-pagination-controls').html('<div class="text-center text-danger my-3">Failed to load video chats.</div>');
            latestVideoChatsLoading = false;
            return;
        }
        data = await res.json();

        if(data && data.videoChats && data.videoChats.length === 0) {
          $('#latest-video-chats-section').remove();
          latestVideoChatsLoading = false;
          $('#latest-video-chats-pagination-controls').html(`
            <div id="latest-video-chats-loading-spinner" class="text-center my-4">
                <div class="spinner-border text-purple" role="status" style="width: 3rem; height: 3rem;">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <div class="mt-2 text-muted">${translations.noMoreVideos ? translations.noMoreVideos : 'No more videos available.'}</div>
            </div>  `).show().css('opacity', '1');
          return;
        }

        setLatestVideoChatsCache(page, data);
        displayLatestVideoChats(data.videoChats, 'latest-video-chats-gallery');
        latestVideoChatsState = data.totalPages || 1;

        $('#latest-video-chats-pagination-controls').html('');
    } catch (e) {
        console.error('[LatestVideoChats] Error loading video chats:', e);
        $('#latest-video-chats-pagination-controls').html('<div class="text-center text-danger my-3">Error loading video chats.</div>');
    }
    latestVideoChatsLoading = false;
}

window.displayLatestVideoChats = function(videoChatsData, targetGalleryId) {
    let htmlContent = '';
    const currentUser = user;
    const currentUserId = currentUser._id;
    const subscriptionStatus = currentUser.subscriptionStatus === 'active';
    const isTemporaryUser = !!currentUser?.isTemporary;
    const showNSFW = sessionStorage.getItem('showNSFW') === 'true';

    videoChatsData.forEach(videoChat => {
        const isOwner = videoChat.chat.userId === currentUserId;
        const isPremiumChat = false; // video chats don't have premium status
        const isNSFW = videoChat.nsfw || false;
        const genderClass = videoChat.chat.gender ? `chat-gender-${videoChat.chat.gender.toLowerCase()}` : '';
        const styleClass = videoChat.chat.imageStyle ? `chat-style-${videoChat.chat.imageStyle.toLowerCase()}` : '';
        
        // Determine if we should blur the video (same logic as character page)
        let shouldBlur = false;
        if (isNSFW) {
            if (subscriptionStatus && !isTemporaryUser) {
                shouldBlur = !showNSFW; // Blur if showNSFW is false
            } else {
                shouldBlur = true; // Always blur if not subscribed or temporary
            }
        }
        
        // For NSFW content with non-subscribers: show blurred image placeholder, don't expose video URL
        const shouldHideVideoUrl = shouldBlur && (!subscriptionStatus || isTemporaryUser);
        const videoId = videoChat.videoId || videoChat._id;

        // Video card with thumbnail and play button
        htmlContent += `
            <div class="video-chat-card col-6 col-sm-4 col-lg-2 flex-shrink-0 px-1 ${isNSFW ? 'nsfw-content' : ''}" data-chat-id="${videoChat.chatId}" data-nsfw="${isNSFW}" data-video-id="${videoId}" style="cursor: pointer;" onclick="redirectToChat('${videoChat.chatId}')">
                <div class="card shadow-sm border-0 h-100 position-relative overflow-hidden">
                    <!-- Video thumbnail with play button -->
                    <div class="video-thumbnail-wrapper position-relative" style="aspect-ratio: 9/16; background: #1a1a1a;">
                        ${shouldHideVideoUrl ? `
                            <!-- NSFW: Show blurred image placeholder, don't expose video URL -->
                            <img 
                                class="card-img-top video-thumbnail-blur blur-video-preview-gallery" 
                                data-video-id="${videoId}"
                                style="height: 100%; width: 100%; object-fit: cover; filter: blur(15px); transform: scale(1.1);"
                                alt="Video preview"
                                src="/img/nsfw-blurred-2.png">
                        ` : `
                            <video 
                                class="card-img-top video-thumbnail" 
                                style="height: 100%; width: 100%; object-fit: cover;" 
                                muted 
                                loop
                                onmouseenter="this.play()" 
                                onmouseleave="this.pause(); this.currentTime = 0;"
                                onclick="event.stopPropagation(); playVideoModal('${videoChat.videoUrl}', '${videoChat.chat.name}')">
                                <source src="${videoChat.videoUrl}" type="video/mp4">
                                Your browser does not support the video tag.
                            </video>
                            
                            <!-- Play button overlay -->
                            <div class="play-button-overlay position-absolute top-50 start-50 translate-middle" 
                                 onclick="event.stopPropagation(); playVideoModal('${videoChat.videoUrl}', '${videoChat.chat.name}')"
                                 style="z-index: 2;">
                                <div class="btn btn-light rounded-circle p-3 shadow" style="opacity: 0.9; height: 50px; width: 50px; padding: 8px 15px !important;">
                                    <i class="bi bi-play-fill fs-4"></i>
                                </div>
                            </div>
                        `}
                        
                        <!-- Duration badge -->
                        ${videoChat.duration ? `
                            <div class="position-absolute bottom-0 end-0 m-2" style="z-index: 3;">
                                <span class="badge bg-dark">${Math.round(videoChat.duration)}s</span>
                            </div>
                        ` : ''}
                        
                        <!-- NSFW overlay for non-subscribers -->
                        ${shouldHideVideoUrl ? `
                            <div class="gallery-nsfw-overlay position-absolute top-0 start-0 w-100 h-100 d-flex flex-column justify-content-center align-items-center" style="background: rgba(0,0,0,0.25); z-index:2;">
                                <i class="bi bi-lock-fill" style="font-size: 1.5rem; color: #fff; opacity: 0.9; margin-bottom: 0.5rem;"></i>
                                <button class="btn btn-sm gallery-video-unlock-btn" 
                                    onclick="event.stopPropagation(); ${isTemporaryUser ? 'openLoginForm()' : 'loadPlanPage()'};"
                                    style="background: linear-gradient(90.9deg, #D2B8FF 2.74%, #8240FF 102.92%); color: white; border: none; border-radius: 8px; font-weight: 600; padding: 0.4rem 0.8rem; font-size: 0.75rem;">
                                    <i class="bi bi-unlock-fill me-1"></i>${isTemporaryUser ? 'Login' : 'Unlock'}
                                </button>
                            </div>
                        ` : ''}
                        
                        <!-- Subscriber blur overlay (can be toggled) -->
                        ${shouldBlur && subscriptionStatus && !isTemporaryUser ? `
                            <div class="gallery-nsfw-overlay subscriber-blur-overlay position-absolute top-0 start-0 w-100 h-100 d-flex flex-column justify-content-center align-items-center" 
                                 style="background: rgba(0,0,0,0.25); z-index:2; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); cursor: pointer;"
                                 onclick="event.stopPropagation(); $(this).fadeOut(300, function(){ $(this).remove(); });">
                                <button class="btn btn-sm"
                                    style="background: linear-gradient(90.9deg, #D2B8FF 2.74%, #8240FF 102.92%); color: white; border: none; border-radius: 8px; font-weight: 600; padding: 0.4rem 0.8rem; font-size: 0.75rem;">
                                    ${window.translations?.showContent || 'Show Content'}
                                </button>
                            </div>
                        ` : ''}
                    </div>
                    
                    <!-- Card body with character info -->
                    <div class="card-body p-2">
                        <div class="d-flex align-items-center">
                            <img src="${videoChat.chat.chatImageUrl}" alt="${videoChat.chat.name}" 
                                 class="rounded-circle me-2 border" width="30" height="30">
                            <div class="flex-grow-1">
                              <a href="/character/${videoChat.chatId}" class="text-muted small text-truncate" title="${videoChat.chat.name || videoChat.chat.chatName}">
                                <h6 class="card-title mb-0 fw-semibold text-truncate" title="${videoChat.chat.name || videoChat.chat.chatName}">${videoChat.chat.name || videoChat.chat.chatName}</h6>
                              </a>
                              ${videoChat.user.nickname ? `
                                  <small class="text-muted">@${videoChat.user.nickname}</small>
                              ` : ''}
                            </div>
                        </div>
                    </div>
                    
                    <!-- Top badges -->
                    <div class="position-absolute top-0 start-0 m-1" style="z-index:3;">
                        ${isOwner ? `
                            <span class="btn btn-light text-secondary shadow" style="opacity:0.8; font-size: 0.7rem;">
                                <i class="bi bi-person-fill"></i>
                            </span>
                        ` : ''}
                        ${window.isAdmin ? `
                            <button 
                                class="btn btn-dark ms-1 mt-2 video-nsfw-toggle ${isNSFW ? 'nsfw' : 'sfw'}" 
                                data-id="${videoId}" 
                                data-nsfw="${isNSFW}" 
                                onclick="toggleVideoNSFW(this); event.stopPropagation();" 
                                title="${isNSFW ? 'Marked NSFW' : 'Mark NSFW'}"
                                style="padding: 0.2em 0.4em !important; font-size: 0.7rem;">
                                <i class="bi ${isNSFW ? 'bi-eye-slash-fill' : 'bi-eye-fill'}"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    });

    const galleryElement = $(document).find(`#${targetGalleryId}`);
    if (galleryElement.length) {
        galleryElement.append(htmlContent);
        
        // Fetch blurred video previews for NSFW videos (non-subscribers only)
        galleryElement.find('.blur-video-preview-gallery').each(function() {
            const imgElement = this;
            const videoId = $(imgElement).data('video-id');
            if (videoId) {
                fetchBlurredVideoPreviewForGallery(imgElement, videoId);
            }
        });
    } else {
        console.warn(`Target gallery with ID #${targetGalleryId} not found.`);
    }
};

/**
 * Fetch blurred video preview from API for gallery cards
 * Uses videoId to retrieve the associated image and blur it
 * Does NOT expose the video URL - only uses videoId
 */
window.fetchBlurredVideoPreview = function(imgElement, videoId) {
    $.ajax({
        url: '/blur-video-preview?videoId=' + encodeURIComponent(videoId),
        method: 'GET',
        xhrFields: {
            withCredentials: true,
            responseType: 'blob'
        },
        success: function(blob) {
            // Create object URL from blob for security (doesn't expose original URL)
            let objectUrl = URL.createObjectURL(blob);
            $(imgElement)
                .attr('src', objectUrl)
                .css({ 'filter': 'blur(15px)', 'transform': 'scale(1.1)' })
                .data('processed', 'true');
        },
        error: function() {
            // Keep placeholder image on error
            console.error("Failed to load blurred video preview for gallery.");
        }
    });
};

// Function to play video in modal
window.playVideoModal = function(videoUrl, chatName) {
    // Create modal if it doesn't exist
    if ($('#videoPlayModal').length === 0) {
        const modalHTML = `
            <div class="modal fade" id="videoPlayModal" tabindex="-1" aria-labelledby="videoPlayModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-lg modal-dialog-centered">
                    <div class="modal-content bg-transparent shadow-0 border-0 mx-auto w-auto">
                        <div class="modal-header border-0"
                         style="background-color:rgba(33, 37, 41, 0.8)!important;backdrop-filter: blur(10px);-webkit-backdrop-filter: blur(10px);">
                            <h5 class="modal-title text-white" id="videoPlayModalLabel"></h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body p-0 text-center" 
                        style="display: flex;justify-content: center;align-items: center;border-radius: 0 0 25px 25px !important;background-color:rgba(33, 37, 41, 0.8)!important;backdrop-filter: blur(10px);
                        -webkit-backdrop-filter: blur(10px);">
                            <video id="modalVideo" class="w-auto" loop autoplay muted 
                            style="max-width: 90vw;">
                                <source src="" type="video/mp4">
                                Your browser does not support the video tag.
                            </video>
                        </div>
                    </div>
                </div>
            </div>
        `;
        $('body').append(modalHTML);
        
        // Pause video when modal is closed
        $('#videoPlayModal').on('hidden.bs.modal', function() {
            const video = document.getElementById('modalVideo');
            if (video) {
                video.pause();
                video.currentTime = 0;
            }
            $('#videoPlayModal').remove();
        });
    }
    
    // Set video source and title
    $('#modalVideo source').attr('src', videoUrl);
    $('#modalVideo')[0].load();
    $('#videoPlayModalLabel').text(chatName);
    
    // Show modal
    const videoModal = new bootstrap.Modal(document.getElementById('videoPlayModal'));
    videoModal.show();
};

async function onLanguageChange(lang) {
    const updateResponse = await $.ajax({
        url: '/api/user/update-language',
        method: 'POST',
        xhrFields: {
            withCredentials: true
        },
        contentType: 'application/json',
        data: JSON.stringify({ lang })
    });

    if (updateResponse.success) {
        await loadTranslations(lang);
        $('#languageDropdown').text(getLanguageDisplayName(lang));
        resetPeopleChatCache();
        
        // Use URL parameter instead of subdomain for SEO
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('lang', lang);
        // Remove 'app.' prefix if present to ensure we're on app.chatlamix.com
        const hostname = window.location.hostname.replace(/^(en|fr|ja)\./, 'app.');
        if (hostname !== window.location.hostname) {
            currentUrl.hostname = hostname;
        }
        window.location.href = currentUrl.toString();
    }
}

function getLanguageDisplayName(lang) {
    const names = {
        'ja': '日本語',
        'en': 'English',
        'fr': 'Français'
    };
    return names[lang] || '日本語';
}

$(document).ready(function() {
    $(document).on('click','.language-select', function(e) {
        e.preventDefault();
        const selectedLang = $(this).data('lang');
        if (selectedLang !== lang) {
            onLanguageChange(selectedLang);
        }
    });
});



const userId = user._id
isTemporary = !!user?.isTemporary
subscriptionStatus = user.subscriptionStatus == 'active'  

const userLang = user.lang
$(document).ready(async function() {

    $.ajaxSetup({
        xhrFields: {
            withCredentials: true
        }
    });
        
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');
    const sessionId = urlParams.get('session_id');
    const priceId = urlParams.get('priceId');
    const paymentFalse = urlParams.get('payment') == 'false';

    // If another tab flagged that latest video chats need refresh, clear cache and reload
    try {
      if (localStorage.getItem('latestVideoChatsNeedsRefresh')) {
        sessionStorage.removeItem(LATEST_VIDEO_CHATS_CACHE_KEY);
        sessionStorage.removeItem(LATEST_VIDEO_CHATS_CACHE_TIME_KEY);
        localStorage.removeItem('latestVideoChatsNeedsRefresh');
        if ($('#latest-video-chats-gallery').length && typeof loadLatestVideoChats === 'function') {
          $('#latest-video-chats-gallery').empty();
          loadLatestVideoChats(1, true);
        }
      }
    } catch (e) {
      console.warn('[dashboard] failed to apply latestVideoChats refresh flag', e);
    }
    
    if(isTemporary){
        let formShown = false;
        $(document).scroll(function() {
          var scrollPercent = ($(window).scrollTop() / ($(document).height() - $(window).height())) * 100;
          if (scrollPercent >= 60 && !formShown) {
            formShown = true;
            //openLoginForm();
          }
        });
    }

    if (success && sessionId) {
        $.ajax({
            url: `/plan/update-${success}`,
            method: 'POST',
        xhrFields: {
            withCredentials: true
        },
            data: { sessionId, priceId },
            success: function(response) {
                if (response.success) {
                    Swal.fire({
                        position: 'top-end',
                        icon: 'success',
                        title: 'ご購入ありがとうございます!',
                        showConfirmButton: false,
                        timer: 3000,
                        toast: true,
                        animation: false,
                        customClass: {
                            container: 'animate__animated animate__fadeOutUp animate__delay-3s',
                            title: 'swal2-custom-title',
                            popup: 'swal2-custom-popup'
                        },
                        showClass: {
                            popup: 'animate__animated animate__slideInRight'
                        },
                        hideClass: {
                            popup: 'animate__animated animate__slideOutRight'
                        }
                    });
                    window.postMessage({ event: 'updateCoins' }, '*');
                } else {
                    console.error('Failed to update coins:', response.error);
                }
            },
            error: function(xhr, status, error) {
                console.error('Error updating coins:', error);
            }
        });
    }
    if(paymentFalse){
        Swal.fire({
            position: 'top-end',
            icon: 'error',
            title: 'お支払いは行われませんでした。',
            showConfirmButton: false,
            timer: 3000,
            toast: true,
            animation: false,
            customClass: {
                container: 'animate__animated animate__fadeOutUp animate__delay-3s',
                title: 'swal2-custom-title',
                popup: 'swal2-custom-popup'
            },
            showClass: {
                popup: 'animate__animated animate__slideInRight'
            },
            hideClass: {
                popup: 'animate__animated animate__slideOutRight'
            }
        });
    }
    
    
    
    /*
        $(document).find('input, textarea').each(function() {
            new mdb.Input(this);
        });
    */
    function checkAndRedirect() {
        var selectedChatId = localStorage.getItem('selectedChatId');
        
        if (selectedChatId) {
            localStorage.removeItem('selectedChatId');
            var currentUrl = window.location.href;
            var redirectUrl = '/chat/' + selectedChatId;
            
            if (currentUrl !== redirectUrl) {
                window.location.href = redirectUrl;
            }
        }
    }
    // Display a popup to ask the user to save the links as a PWA on mobile
    if (window.matchMedia('(display-mode: browser)').matches && window.matchMedia('(max-width: 768px)').matches) {
         function showAddToHomeScreenPopup() {
            // Display the popup using Swal.fire
            Swal.fire({
                title: translations.popup_save.instructions,
                imageWidth: '100%',
                imageHeight: 'auto',
                position: 'bottom',
                html: `
                    <div class="d-flex align-items-center py-3">
                        <div>
                            <ul class="list-group mb-0">
                                <li class="bg-light d-flex align-items-center list-group-item">
                                    <i class="bi bi-box-arrow-up me-2 text-primary"></i>
                                    <span>1) ${translations.popup_save.step1}</span>
                                </li>
                                <li class="bg-light d-flex align-items-center list-group-item">
                                    <i class="bi bi-plus-square me-2 text-success"></i>
                                    <span>2) ${translations.popup_save.step2}</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                `,
                showCancelButton: false,
                showConfirmButton: false,
                showCloseButton: true,
                allowOutsideClick: false,
                showClass: {
                    popup: 'swal2-bottom-slide-in'
                },
                hideClass: {
                    popup: 'swal2-bottom-slide-out'
                },
                customClass: {
                    popup: 'animated fadeInDown smaller-title'
                }
            }).then((result) => {   
                if (result.dismiss) {
                    localStorage.setItem('dismissedAddToHomeScreenPopup', 'true');
                }
            });
         };
        if (!isTemporary) {
          if (!localStorage.getItem('dismissedAddToHomeScreenPopup')) {
              setTimeout(showAddToHomeScreenPopup, 5000);
          }
        }
        
    }

    //checkAndRedirect();
    window.showUpgradePopup = function(limitType) {
    
        $.ajax({
            type: 'GET',
        xhrFields: {
            withCredentials: true
        },
            url: `/plan/list?lang=${lang}`,//?update=true
            dataType: 'json',
        success: function(response) {
            const isYearly = $('#plan-switch').is(':checked');
            plan = response
            if (isYearly) {
                plan.price = plan.yearly;
            } else {
                plan.price = plan.monthly;
            }
            let messageTitle = '';
            let messageText = '';
            let imageUrl = '/img/login-bg-862c043f.png'; // replace with your image URL
        
            // Use switch-case to handle different types of limits
            switch (limitType) {
                case 'image-generation':
                    messageTitle = `🎨${translations.imageGeneration.messageTitle}`;
                    messageText = translations.imageGeneration.messageText;
                    break;
                case 'nsfw-prompt':
                    messageTitle = `${translations.nsfwPrompt.messageTitle}`;
                    messageText = translations.nsfwPrompt.messageText;
                    break;
                case 'chat-message':
                    messageTitle = '💬メッセージ制限に達しました';
                    messageText = '無制限のメッセージをお楽しみいただくには、有料プランにご登録ください。';
                    break;
                case 'chat-character':
                    messageTitle = '🤗キャラクター制限に達しました';
                    messageText = 'より多くのキャラクターと会話を楽しむには、有料プランにご登録ください。';
                    break;
                case 'chat-private':
                    messageTitle = '🔒 非公開設定にはアップグレードが必要です';
                    messageText = 'プライベートチャット機能を利用するには、有料プランにアップグレードしてください。';
                    break;
                case 'unlock-nsfw':
                    messageTitle = '⚠️ 成人向けンテンツの利用にはアップグレードが必要です';
                    messageText = '成人向けコンテンツを生成するには、有料プランにアップグレードしてください。';
                    break;
                default:
                    messageTitle = '制限に達しました';
                    messageText = 'ご利用中のプランの制限に達しました。有料プランにアップグレードして、より多くの機能をお楽しみください。';
            }
            // Display the popup using Swal.fire
            Swal.fire({
                //imageUrl: imageUrl,
                imageWidth: '100%',
                imageHeight: 'auto',
                position: 'bottom',
                html: `
                    <div class="container">
                        <div class="row justify-content-center">
                            <div class="text-start">
                                <h5 class="fw-bold">${messageTitle}</h5>
                                <p class="text-muted mb-2 header" style="font-size: 16px;">${messageText}</p>
                                <ul class="list-group list-group-flush">
                                    ${plan.features.map(feature => `<li class="list-group-item px-0"><span class="me-2">🔥</span>${feature}</li>`).join('')}
                                </ul>
                                <a href="#" onclick="loadPlanPage()" class="btn btn-dark close-alert border-0 w-100 custom-gradient-bg mt-3">${translations.check_premium_plan}</a>
                            </div>
                        </div>
                    </div>
                `,
                showCancelButton: false,
                showConfirmButton: false,
                showCloseButton: true,
                allowOutsideClick: false,
                showClass: {
                    popup: 'swal2-bottom-slide-in'
                },
                hideClass: {
                    popup: 'swal2-bottom-slide-out'
                },
                customClass: {
                    popup: 'animated fadeInDown'
                }
            }).then((result) => {
                if (result.dismiss) {
                $.removeCookie('redirect_url');
                }
            });
        },
        error: function(xhr, status, error) {
            console.error('Failed to fetch plans:', error);
        }
        });
    }

    displayTags();
});

$(document).on('click', '.close-alert', function (e) {
  e.preventDefault();
  Swal.close();
});

$(document).find('.jp-date').each(function () {
    const originalDate = new Date($(this).text());
    if (isNaN(originalDate.getTime())) {
        $(this).parent().hide(); 
        return;
    }
    
    const formattedDate = originalDate.toISOString().slice(0, 16).replace('T', ' ');

    $(this).replaceWith(`
        <div>
            <i class="bi bi-calendar"></i> ${formattedDate.slice(0, 10)} 
        </div>
    `);
});


$(document).on('click', '.persona', function(e) {
    e.stopPropagation();
    e.preventDefault();
    const isTemporary = !!user.isTemporary
    if(isTemporary){ openLoginForm(); return; }
    const $this = $(this)
    $this.toggleClass('on');
    const $icon = $(this).find('i');
    const isAdding = $icon.hasClass('far');
    $icon.toggleClass('fas far');
    const personaId = $(this).attr('data-id');
    const isEvent = $(this).attr('data-event') == 'true'
    if(isEvent){
        window.parent.postMessage({ event: 'updatePersona', personaId,isAdding }, '*');
    }else{
        updatePersona(personaId,isAdding,null,function(){
            $icon.toggleClass('fas far');
            $this.toggleClass('on');
        })
    }
});

if(!isTemporary){
    const personas = user?.personas || false
    initializePersonaStats(personas)
}

window.toggleVideoNSFW = function(el) {
  event.stopPropagation();
  const $this = $(el);
  const videoId = $this.data('id');
  const currentNsfw = $this.data('nsfw') === true || $this.hasClass('nsfw') || $this.data('nsfw') === 'true';
  const newNsfw = !currentNsfw;

  // Optimistic UI update
  $this.toggleClass('nsfw', newNsfw).toggleClass('sfw', !newNsfw);
  $this.html(`<i class="bi ${newNsfw ? 'bi-eye-slash-fill' : 'bi-eye-fill'}"></i>`);
  $this.data('nsfw', newNsfw);
  const $card = $this.closest('.video-chat-card');
  if ($card.length) {
    $card.attr('data-nsfw', newNsfw);
    $card.toggleClass('nsfw-content', newNsfw);
  }

  $.ajax({
    url: `/api/video/${videoId}/nsfw`,
    method: 'PUT',
    xhrFields: { withCredentials: true },
    contentType: 'application/json',
    data: JSON.stringify({ nsfw: newNsfw }),
    success: function(response) {
      if (response && response.success) {
        // Clear cached latest video chats so changes are reflected on refresh
        try {
          sessionStorage.removeItem(LATEST_VIDEO_CHATS_CACHE_KEY);
          sessionStorage.removeItem(LATEST_VIDEO_CHATS_CACHE_TIME_KEY);
          // mark for reload on other tabs / next load
          localStorage.setItem('latestVideoChatsNeedsRefresh', Date.now().toString());
        } catch (e) {
          console.warn('[toggleVideoNSFW] cache clear failed', e);
        }

        // Optionally refresh the current list immediately
        if (typeof loadLatestVideoChats === 'function') {
          // reload first page and force reload from server
          loadLatestVideoChats(1, true);
        }
        showNotification(newNsfw ? window.translations?.setNsfw || 'NSFW set' : window.translations?.unsetNsfw || 'NSFW unset', 'success');
      } else {
        // Revert on failure
        $this.toggleClass('nsfw', !newNsfw).toggleClass('sfw', newNsfw);
        $this.html(`<i class="bi ${currentNsfw ? 'bi-eye-slash-fill' : 'bi-eye-fill'}"></i>`);
        $this.data('nsfw', currentNsfw);
        if ($card.length) {
          $card.attr('data-nsfw', currentNsfw);
          $card.toggleClass('nsfw-content', currentNsfw);
        }
        showNotification(window.translations?.errorOccurred || 'Error updating NSFW', 'error');
      }
    },
    error: function(err) {
      console.error('Failed to toggle video nsfw:', err);
      // Revert optimistic UI
      $this.toggleClass('nsfw', !newNsfw).toggleClass('sfw', newNsfw);
      $this.html(`<i class="bi ${currentNsfw ? 'bi-eye-slash-fill' : 'bi-eye-fill'}"></i>`);
      $this.data('nsfw', currentNsfw);
      if ($card.length) {
        $card.attr('data-nsfw', currentNsfw);
        $card.toggleClass('nsfw-content', currentNsfw);
      }
      showNotification(window.translations?.errorOccurred || 'Error updating NSFW', 'error');
    }
  });
}
window.togglePostFavorite = function(el) {
  const isTemporary = !!user.isTemporary;
  if (isTemporary) { openLoginForm(); return; }

  const $this = $(el);
  const postId = $this.data('id');
  const isLiked = $this.hasClass('liked'); // Check if already liked

  const action = isLiked ? 'unlike' : 'like'; // Determine action

  $this.toggleClass('liked');

  $.ajax({
    url: `/posts/${postId}/like-toggle`, // Single endpoint
    method: 'POST',
        xhrFields: {
            withCredentials: true
        },
    data: { action: action }, // Send action (like/unlike) in the request body
    success: function () {
      // Show success notification in Japanese
      if (action === 'like') {
        showNotification('いいねしました！', 'success');
        $this.find('.ct').text(parseInt($this.find('.ct').text()) + 1);
      } else {
        showNotification('いいねを取り消しました！', 'success');
        $this.find('.ct').text(parseInt($this.find('.ct').text()) - 1);
      }
    },
    error: function () {
      // Show error notification in Japanese
      $this.toggleClass('liked');
      showNotification('リクエストに失敗しました。', 'error');
    }
  });
};

window.toggleImageFavorite = function(el) {
  const isTemporary = !!user.isTemporary;
  if (isTemporary) { openLoginForm(); return; }
  // handle .image-fav-double-click
  if ($(el).hasClass('image-fav-double-click') && !$(el).data('double-click')) {
    $(el).data('double-click', true);
    setTimeout(() => {
      $(el).data('double-click', false);
    }, 300); // Reset double-click state after 300ms
    return;
  }
  
  let $this = $(el);
  if ($(el).hasClass('image-fav-double-click')) {
    $this = $(el).parent().find('.image-fav');
  }
  
  const userChatId = $(`#chatContainer`).is(':visible') ? $(`#chatContainer`).attr('data-id') : null;
  const chatId = $this.data('chat-id') || null; // Get chat ID from data attribute or current chat container
  const imageId = $this.data('id');
  const isLiked = $this.find('i').hasClass('bi-heart-fill'); // Check if already liked

  const action = isLiked ? 'unlike' : 'like'; // Determine action
  const likeIconClass = (action == 'like') ? 'bi-heart-fill text-danger' : 'bi-heart';
  
  // Update the clicked element immediately
  $this.find('i').removeClass('bi-heart bi-heart-fill').addClass(likeIconClass); // Toggle icon class

  // Update ALL instances of this image across the page (including toolbar and other locations)
  $(`.image-fav[data-id="${imageId}"]`).each(function() {
    $(this).find('i').removeClass('bi-heart bi-heart-fill text-danger').addClass(likeIconClass);
  });

  // Update the preview modal like button if it exists and matches this image
  if (window.previewImages) {
    const currentPreviewImage = window.previewImages[window.imageSwiper?.activeIndex || 0];
    if (currentPreviewImage && currentPreviewImage.id === imageId) {
      const $modalLikeBtn = $('.image-like-btn i');
      $modalLikeBtn.removeClass('bi-heart bi-heart-fill text-danger').addClass(likeIconClass);
    }
  }

  if(action === 'like') {
    showNotification(window.translations?.like_grant_points.replace('{point}', '1') || 'Image liked!', 'success');
  }

  $.ajax({
    url: `/gallery/${imageId}/like-toggle`, // Single endpoint
    method: 'POST',
    xhrFields: {
        withCredentials: true
    },
    data: { 
      action, 
      userChatId 
    }, // Send action (like/unlike) in the request body
    success: function() {
      
      if (action === 'like') {
        // Update like count for all instances
        $(`.image-fav[data-id="${imageId}"] .ct`).each(function() {
          const currentCount = parseInt($(this).text()) || 0;
          $(this).text(currentCount + 1);
        });
      } else {
        // Update like count for all instances
        $(`.image-fav[data-id="${imageId}"] .ct`).each(function() {
          const currentCount = parseInt($(this).text()) || 0;
          $(this).text(Math.max(0, currentCount - 1));
        });
      }

      // delete the local storage item userImages_${userId}
      let userId = user._id;
      if($('#profileSection').length) {
        userId = $('#profileSection').data('user-id');
      }

      // Debug: Log the cache keys being cleared

      if(chatId && chatId !== 'null') {
        clearChatImageCache(chatId);
      } 
      
      if(userId && userId !== 'null') {
        clearUserImageCache(userId);
        const cacheKey = `userImages_${userId}`;
        localStorage.removeItem(cacheKey);
      } 
    },
    error: function() {
      // Revert all changes on error
      const revertIconClass = (action == 'like') ? 'bi-heart' : 'bi-heart-fill text-danger';
      
      // Revert the clicked element
      $this.find('i').removeClass('bi-heart bi-heart-fill text-danger').addClass(revertIconClass);
      
      // Revert ALL instances of this image
      $(`.image-fav[data-id="${imageId}"]`).each(function() {
        $(this).find('i').removeClass('bi-heart bi-heart-fill text-danger').addClass(revertIconClass);
      });
      
      // Revert the preview modal like button if it exists and matches this image
      if (window.previewImages) {
        const currentPreviewImage = window.previewImages[window.imageSwiper?.activeIndex || 0];
        if (currentPreviewImage && currentPreviewImage.id === imageId) {
          const $modalLikeBtn = $('.image-like-btn i');
          $modalLikeBtn.removeClass('bi-heart bi-heart-fill text-danger').addClass(revertIconClass);
        }
      }

      showNotification(window.translations?.requestFailed || 'Request failed', 'error');
    }
  });
};
window.togglePostVisibility = function(el) {
  const isTemporary = !!user.isTemporary;
  if (isTemporary) { openLoginForm(); return; }

  const $this = $(el);
  const postId = $this.data('id');
  const isPrivate = $this.hasClass('private'); // Check if already private

  const newPrivacyState = !isPrivate; // Toggle privacy state

  $.ajax({
    url: `/posts/${postId}/set-private`, // Single endpoint for both public and private
    method: 'POST',
        xhrFields: {
            withCredentials: true
        },
    data: { isPrivate: newPrivacyState },
    success: function() {
      // Toggle private/public button state
      $this.toggleClass('private');
      const ico = newPrivacyState ? 'bi-eye-slash' : 'bi-eye';
      const text = newPrivacyState ? '非公開' : '公開';
      $this.find('i').removeClass('bi-eye bi-eye-slash').addClass(ico);
      $this.find('.text').text(text);

      // Show success notification in Japanese
      if (newPrivacyState) {
        showNotification('投稿を非公開にしました！', 'success');
      } else {
        showNotification('投稿を公開にしました！', 'success');
      }
    },
    error: function() {
      // Show error notification in Japanese
      showNotification('リクエストに失敗しました。', 'error');
    }
  });
};
window.toggleImageNSFW = function(el) {
  const isTemporary = !!user.isTemporary;
  //if (isTemporary) { openLoginForm(); return; }

  const $this = $(el);
  const imageId = $this.data('id');
  const isNSFW = $this.hasClass('nsfw'); // Check if already marked as NSFW

  const nsfwStatus = !isNSFW; // Toggle NSFW status

  $this.toggleClass('nsfw'); // Toggle NSFW class for UI change
  $this.closest('.image-card').toggleClass('nsfw-content', nsfwStatus); // Toggle NSFW content class

  // Update the button icon based on the NSFW status
  const icon = nsfwStatus 
    ? '<i class="bi bi-eye-slash-fill"></i>'   // NSFW icon (eye-slash for hidden content)
    : '<i class="bi bi-eye-fill"></i>';        // Non-NSFW icon (eye for visible content)

  $this.html(icon); // Update the button's icon

  $.ajax({
    url: `/images/${imageId}/nsfw`, // Endpoint for updating NSFW status
    method: 'PUT',
        xhrFields: {
            withCredentials: true
        },
    contentType: 'application/json',
    data: JSON.stringify({ nsfw: nsfwStatus }), // Send NSFW status in request body
    success: function () {

      // Show success notification in Japanese
      if (nsfwStatus) {
          showNotification(window.translations.setNsfw, 'success');
      } else {
          showNotification(window.translations.unsetNsfw, 'success');
      }
      updateNSFWContentUI();

    },
    error: function () {
    $this.toggleClass('nsfw'); // Revert the class change if request fails
    $this.html(isNSFW 
      ? '<i class="bi bi-eye-fill"></i>' 
      : '<i class="bi bi-eye-slash-fill"></i>'); // Revert the icon as well
      showNotification(window.translations.errorOccurred, 'error');
    }
  });
}

window.togglePostNSFW = function(el) {
  const isTemporary = !!user.isTemporary;
  // if (isTemporary) { openLoginForm(); return; }

  const $this = $(el);
  const postId = $this.data('id'); // Post ID is stored in data attribute
  const isNSFW = $this.hasClass('nsfw'); // Check if already marked as NSFW

  const nsfwStatus = !isNSFW; // Toggle NSFW status

  $this.toggleClass('nsfw'); // Toggle NSFW class for UI change

  // Update the button icon based on the NSFW status
  const icon = nsfwStatus 
    ? '<i class="bi bi-eye-slash-fill"></i>'   // NSFW icon (eye-slash for hidden content)
    : '<i class="bi bi-eye-fill"></i>';        // Non-NSFW icon (eye for visible content)

  $this.html(icon); // Update the button's icon

  $.ajax({
      url: `/user/posts/${postId}/nsfw`, // Endpoint for updating NSFW status
      method: 'PUT',
        xhrFields: {
            withCredentials: true
        },
      contentType: 'application/json',
      data: JSON.stringify({ nsfw: nsfwStatus }), // Send NSFW status in request body
      success: function () {
          // Show success notification
          if (nsfwStatus) {
              showNotification('NSFWに設定されました！', 'success');
          } else {
              showNotification('NSFW設定が解除されました！', 'success');
          }
      },
      error: function () {
          $this.toggleClass('nsfw'); // Revert the class change if request fails
          $this.html(isNSFW 
            ? '<i class="bi bi-eye-fill"></i>' 
            : '<i class="bi bi-eye-slash-fill"></i>'); // Revert the icon as well
          showNotification('リクエストに失敗しました。', 'error');
      }
  });
};

window.toggleFollow = function(el) {
  const isTemporary = !!user.isTemporary;
  if (isTemporary) { openLoginForm(); return; }

  const $this = $(el);
  const userId = $this.data('user-id');
  const isFollowing = $this.hasClass('following'); // Check if already following

  const action = isFollowing ? false : true;
  $this.toggleClass('following');

  $.ajax({
    url: `/user/${userId}/follow-toggle`, // Single endpoint for both follow/unfollow
    method: 'POST',
    xhrFields: {
      withCredentials: true
    },
    data: { action: action }, // Send action (follow/unfollow) in the request body
    success: function () {
      // Update the button text using window.translations.follow object
      if (action) {
      $this.find('.user-follow').text(window.translations?.follow?.following || 'Following');
      showNotification(window.translations?.follow?.followed || 'Followed!', 'success');
      } else {
      $this.find('.user-follow').text(window.translations?.follow?.follow || 'Follow');
      showNotification(window.translations?.follow?.unfollowed || 'Unfollowed!', 'success');
      }
    },
    error: function () {
      $this.toggleClass('following'); // Revert the state on error
      showNotification(window.translations?.follow?.requestFailed || 'Request failed.', 'error');
    }
  });
}

window.redirectToChatPage = function(el) {
    const chatId = $(el).data('id');
    if(chatId){
      window.location = '/chat/' + chatId;
      return
    }
    if (window.location.pathname !== '/chat/') {
      window.location.href = '/chat/';
    }
};

window.blurImage = function(img) {
    if ($(img).data('processed') === "true") return;
    let imageUrl = $(img).data('src');
    window.fetchBlurredImageAndCreateOverlay(img, imageUrl);
}

window.fetchBlurredImageAndCreateOverlay = function(img, imageUrl) {
    $.ajax({
        url: '/blur-image?url=' + encodeURIComponent(imageUrl),
        method: 'GET',
        xhrFields: {
            withCredentials: true
        },
        xhrFields: { responseType: 'blob' },
        success: function(blob) { 
          handleImageSuccess(img, blob, imageUrl, 
          createOverlay(img, imageUrl)); 
        },
        error: function() { console.error("Failed to load blurred image."); }
    });
}

window.updateChatImage = function(el) {
  const chatId = $(el).data('id');
  const imageUrl = $(el).data('img');
  $.ajax({
    url: `/chat/${chatId}/image`,
    type: 'PUT',
        xhrFields: {
            withCredentials: true
        },
    data: { imageUrl },
    success: function(response) {
      updateChatBackgroundImage(imageUrl);
      updateChatbotImageSrc(imageUrl);
    }
  });
}

window.updateChatbotImageSrc = function(newImageUrl) {
  $('.chatbot-image-chat').each(function() {
    const currentSrc = $(this).attr('src');
    if (currentSrc !== newImageUrl) {
      $(this).attr('src', newImageUrl);
    }
  });
}
window.updateUserChatBackgroundImage = function(el) {
  const userChatId = $(el).data('user-chat-id');
  const imageUrl = $(el).data('img');
  const imageId = $(el).data('image-id');
  $.ajax({
    url: `/api/user-chat/${userChatId}/background-image`,
    type: 'PUT',
        xhrFields: {
            withCredentials: true
        },
    contentType: 'application/json',
    data: JSON.stringify({ imageId, imageUrl }),
    success: function(response) {
      // Maybe show a success message or update UI
      console.log('User chat background updated successfully');
      updateChatBackgroundImage(imageUrl);
    },
    error: function(xhr, status, error) {
      console.error('Failed to update user chat background:', error);
    }
  });
}

    
window.updateChatBackgroundImage = function(thumbnail) {
  const currentImageUrl = $('#chat-wrapper').css('background-image').replace(/url\(["']?|["']?\)$/g, '');
  if (currentImageUrl !== thumbnail) {
     $('#chat-wrapper').css('background-image', `url(${thumbnail})`);
  }
  if(!thumbnail || thumbnail === 'null' || thumbnail === 'undefined' || thumbnail === '') {
    $('#chat-wrapper').css('background-image', '');
  }
  resetPeopleChatCache(chatId);
}

window.resetPeopleChatCache = function(chatId,model_name) {
  for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('peopleChatCache_')) {
          const dataToString = localStorage.getItem(key);
          if (!chatId || (dataToString && dataToString.includes(chatId))) {
              localStorage.removeItem(key);
          }
          if(dataToString && dataToString.includes(model_name)){
            localStorage.removeItem(key);
          }
      }
  }
};
function applyNSFWBlurEffect(){
    $(document).find('img.blurred-image').each(function() {
      if ($(this).data('processed') === "true") return;
      let imageUrl = $(this).data('src');
      fetchBlurredImageAndReplace(this, imageUrl);
    });
}
function fetchBlurredImageAndReplace(img, imageUrl) {
    $.ajax({
        url: '/blur-image?url=' + encodeURIComponent(imageUrl),
        method: 'GET',
        xhrFields: {
            withCredentials: true
        },
        xhrFields: { responseType: 'blob' },
        success: function(blob) { 
          handleImageSuccess(img, blob, imageUrl); 
        },
        error: function() { console.error("Failed to load blurred image."); }
    });
}

function handleImageSuccess(img, blob, imageUrl, call) {
    let objectUrl = URL.createObjectURL(blob);
    $(img).attr('src', objectUrl).data('processed', "true").removeAttr('data-original-src').removeAttr('data-src').removeAttr('srcset');
    if(call && typeof call === 'function'){
      call();
    }
}

window.createOverlay = function(img, imageUrl) {
  let overlay;
  const isTemporary = !!window.user?.isTemporary; // Access global user object
  const subscriptionStatus = window.user?.subscriptionStatus === 'active';
  const showNSFW = sessionStorage.getItem('showNSFW') === 'true';
  
  // Check if the overlay already exists
  if ($(img).next('.gallery-nsfw-overlay').length) {
    // If it exists, remove it first
    $(img).next('.gallery-nsfw-overlay').remove();
  }

  // Save container link and remove it
  const containerLink = $(img).closest('a');
  const originalHref = containerLink.attr('href');
  if (containerLink.length) {
    containerLink.attr('href', 'javascript:void(0);');
  }
  
  if (isTemporary) {
    // Temporary user - show login overlay with modern design
    overlay = $('<div></div>')
        .addClass('gallery-nsfw-overlay position-absolute top-0 start-0 w-100 h-100 d-flex flex-column justify-content-center align-items-center animate__animated animate__fadeIn')
        .css({
            background: 'rgba(0, 0, 0, 0.25)',
            zIndex: 2,
            cursor: 'pointer'
        })
        .on('click', function() {
            openLoginForm();
        });

    const lockIcon = $('<i></i>').addClass('bi bi-lock-fill').css({ 'font-size': '2rem', 'color': '#fff', 'opacity': '0.9', 'margin-bottom': '0.75rem' });
    const loginButton = $('<button></button>')
        .addClass('btn btn-sm')
        .css({
            'background': 'linear-gradient(90.9deg, #D2B8FF 2.74%, #8240FF 102.92%)',
            'color': 'white',
            'border': 'none',
            'border-radius': '8px',
            'font-weight': '600',
            'padding': '0.5rem 1rem',
            'font-size': '0.85rem',
            'cursor': 'pointer',
            'transition': 'all 0.2s ease'
        })
        .html('<i class="bi bi-unlock-fill me-2"></i>Unlock')
        .on('click', function(e) {
            e.stopPropagation();
            openLoginForm();
        });

    overlay.append(lockIcon, loginButton);

  } else if (subscriptionStatus && !showNSFW) {
    // Subscribed user with showNSFW disabled - show removable overlay
    overlay = $('<div></div>')
        .addClass('gallery-nsfw-overlay position-absolute top-0 start-0 w-100 h-100 d-flex flex-column justify-content-center align-items-center animate__animated animate__fadeIn')
        .css({
            background: 'rgba(0, 0, 0, 0.25)',
            zIndex: 2
        });

    let buttonElement = $('<button></button>')
        .addClass('btn btn-sm')
        .css({
            'background': 'linear-gradient(90.9deg, #D2B8FF 2.74%, #8240FF 102.92%)',
            'color': 'white',
            'border': 'none',
            'border-radius': '8px',
            'font-weight': '600',
            'padding': '0.5rem 1rem',
            'font-size': '0.85rem',
            'cursor': 'pointer',
            'transition': 'all 0.2s ease',
            'margin-top': '0.75rem'
        })
        .text(window.translations?.showContent || 'Show Content')
        .on('click', function (e) {
            e.stopPropagation();
            $(img).attr('src', imageUrl).removeClass('img-blur');
            const $container = $(img).closest('.assistant-image-box');
            $container.removeClass('isBlurred');
            // Set data-src on container so showImagePreview can find the image URL
            $container.attr('data-src', imageUrl);
            const imageId = $(img).attr('data-id');
            const $imageTools = $(document).find(`.image-tools[data-id="${imageId}"]`);
            
            overlay.hide().removeClass('d-flex');
            
            // Display the image tools
            $imageTools.show();

            // Restore container link if it was removed
            containerLink.attr('href', originalHref);
        })
        .on('mouseenter', function() {
            $(this).css({ 'transform': 'translateY(-2px)', 'box-shadow': '0 8px 16px rgba(130, 64, 255, 0.3)' });
        })
        .on('mouseleave', function() {
            $(this).css({ 'transform': 'translateY(0)', 'box-shadow': 'none' });
        });

    overlay.append(buttonElement);

  } else {
    // Non-subscribed user - show unlock overlay with modern design
    overlay = $('<div></div>')
        .addClass('gallery-nsfw-overlay position-absolute top-0 start-0 w-100 h-100 d-flex flex-column justify-content-center align-items-center animate__animated animate__fadeIn')
        .css({
            background: 'rgba(0, 0, 0, 0.25)',
            zIndex: 2,
            cursor: 'pointer'
        })
        .on('click', function() {
            loadPlanPage();
        });

    let buttonElement = $('<button></button>')
        .addClass('btn btn-sm')
        .css({
            'background': 'linear-gradient(90.9deg, #D2B8FF 2.74%, #8240FF 102.92%)',
            'color': 'white',
            'border': 'none',
            'border-radius': '8px',
            'font-weight': '600',
            'padding': '0.5rem 1rem',
            'font-size': '0.85rem',
            'cursor': 'pointer',
            'transition': 'all 0.2s ease',
            'margin-top': '0.75rem'
        })
        .html('<i class="bi bi-lock-fill me-2"></i>' + (window.translations?.blurButton || 'Unlock Content'))
        .on('click', function (e) {
            e.stopPropagation();
            loadPlanPage();
        })
        .on('mouseenter', function() {
            $(this).css({ 'transform': 'translateY(-2px)', 'box-shadow': '0 8px 16px rgba(130, 64, 255, 0.3)' });
        })
        .on('mouseleave', function() {
            $(this).css({ 'transform': 'translateY(0)', 'box-shadow': 'none' });
        });

    overlay.append(buttonElement);
  }

  $(img)
    .wrap('<div style="position: relative;"></div>')
    .after(overlay);
}
async function checkIfAdmin(userId) {
    try {
      const response = await $.get(`/user/is-admin/${userId}`);
      return response.isAdmin;
    } catch (error) {
      console.log('Error checking admin status');
      return false;
    }
}

  function unlockImage(id, type, el) {
    loadPlanPage();
    return
    /*
    $.post(`/api/unlock/${type}/${id}`)
      .done((response) => {
        const imageUrl = response.item.image ? response.item.image.imageUrl : response.item.imageUrl
        const prompt = response.item.image ? response.item.image.prompt : response.item.prompt
        $(el).before(`
            <a href="${response.redirect}" class="text-muted text-decoration-none">
                <img src="${imageUrl}" alt="${prompt}" class="card-img-top">
            </a>`)
            $(el).remove()
        showNotification(window.translations.unlockSuccess, 'success');
      })
      .fail(() => {
    });
    */
  }
  
  function isUnlocked(currentUser, id, ownerId) {
    if (!currentUser) {
        console.warn('isUnlocked: currentUser is undefined', { id, ownerId });
        return false;
    }
    if(currentUser.isTemporary){
        console.warn('isUnlocked: currentUser is temporary', { id, ownerId });
        return false;
    }
    const unlocked = Array.isArray(currentUser.unlockedItems) && currentUser.unlockedItems.includes(id);
    const isOwner = currentUser._id == ownerId;
    console.log({ unlocked, isOwner, id, ownerId });
    return unlocked || isOwner;
  }
  
// Helper function to scroll to the top
function scrollToTop() {
    $('html, body').animate({ scrollTop: 0 }, 'slow');
}

let imgPlaceholder = '/img/nsfw-blurred-2.png'
window.imagePlaceholder = function(){
    if(!isTemporary){
        return `/img/nsfw-blurred-2.png`
    }
    return imgPlaceholder
}
window.loadUsers = async function (page = 1) {
    $.ajax({
        url: `/users/?page=${page}`,
        method: 'GET',
        xhrFields: {
            withCredentials: true
        },
        success: function (data) {
            let usersHtml = '';
            data.users.forEach(user => {
                usersHtml += `
                    <div class="me-3 text-center" style="min-width: 100px;">
                        <a href="/user/${user.userId}" class="text-decoration-none text-dark">
                            <img src="${user.profilePicture || '/img/default-avatar.png'}" alt="${user.userName}" class="rounded-circle mb-2" width="60" height="60">
                            <div>${user.userName}</div>
                        </a>
                    </div>
                `;
            });

            $('#users-gallery').append(usersHtml);
            if( $('#users-pagination-controls').length > 0){
                generateUserPagination(data.page, data.totalPages);
            }
        },
        error: function (err) {
            console.error('Failed to load users', err);
        }
    });
}
function generateUserPagination(currentPage, totalPages) {
  let paginationHtml = '';
  const sidePagesToShow = 2;
  let pagesShown = new Set();

  // Use namespaced event to avoid conflicts
  const eventName = 'scroll.userPagination';
  $(window).off(eventName).on(eventName, function() {
    if ($(window).scrollTop() + $(window).height() >= $(document).height() - 100) {
      if (currentPage < totalPages && !pagesShown.has(currentPage + 1)) {
        loadUsers(currentPage + 1);
        pagesShown.add(currentPage + 1);
      }
    }
  });

  if (currentPage >= totalPages) {
    console.log('All Users: No more pages to load')
    return;
  }

  if (totalPages > 1) {
    paginationHtml += `<button class="btn btn-outline-primary me-2" ${currentPage === 1 ? 'disabled' : ''} onclick="loadUsers(${currentPage - 1})">${window.translations.prev}</button>`;

    if (currentPage > sidePagesToShow + 1) {
      paginationHtml += `<button class="btn btn-outline-primary mx-1" onclick="loadUsers(1)">1</button>`;
      if (currentPage > sidePagesToShow + 2) paginationHtml += `<span class="mx-1">...</span>`;
    }

    let startPage = Math.max(1, currentPage - sidePagesToShow);
    let endPage = Math.min(totalPages, currentPage + sidePagesToShow);

    for (let i = startPage; i <= endPage; i++) {
      paginationHtml += `<button class="btn ${i === currentPage ? 'btn-primary' : 'btn-outline-primary'} mx-1" onclick="loadUsers(${i})">${i}</button>`;
    }

    if (currentPage < totalPages - sidePagesToShow - 1) {
      if (currentPage < totalPages - sidePagesToShow - 2) paginationHtml += `<span class="mx-1">...</span>`;
      paginationHtml += `<button class="btn btn-outline-primary mx-1" onclick="loadUsers(${totalPages})">${totalPages}</button>`;
    }

    paginationHtml += `<button class="btn btn-outline-primary ms-2" ${currentPage === totalPages ? 'disabled' : ''} onclick="loadUsers(${currentPage + 1})">${window.translations.next}</button>`;
  }

  $('#users-pagination-controls').html(paginationHtml);
}

window.loadChatUsers = async function (chatId, page = 1) {
  $.ajax({
    url: `/chat/${chatId}/users?page=${page}`,
    method: 'GET',
        xhrFields: {
            withCredentials: true
        },
    success: function (data) {
      // Add style once if not already present
      if (!$('#chat-users-style').length) {
        $('head').append(`
          <style id="chat-users-style">
            .user-avatar-card {
              transition: all 0.3s ease;
            }
            .user-avatar-card:hover {
              transform: translateY(-5px);
              box-shadow: 0 8px 20px rgba(0,0,0,0.15) !important;
            }
            .user-avatar {
              transition: all 0.3s ease;
              box-shadow: 0 4px 10px rgba(0,0,0,0.1);
            }
          </style>
        `);
      }

      let chatUsersHtml = '';
      data.users.forEach(user => {
        chatUsersHtml += `
          <div class="col-auto mb-4 user-avatar-card mx-2 shadow border border-2 border-light rounded p-2">
            <a href="/user/${user.userId}" class="text-decoration-none text-center d-block">
              <div class="avatar-wrapper mb-2 d-flex justify-content-center">
                <img src="${user.profileUrl || '/img/default-avatar.png'}" 
                   alt="${user.nickname}" 
                   class="rounded-circle border-light user-avatar"
                   width="64" height="64">
              </div>
              <div class="user-name text-secondary fw-medium" style="max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${user.nickname}
              </div>
            </a>
          </div>
        `;
      });

      $('#chat-users-gallery').append(chatUsersHtml);
      // If no users found update the frontend by removing the section
      if(data.users.length === 0 && page === 1){
        $('#chat-users-gallery').closest('section').remove();
      }
      // Generate pagination if needed
      if ($('#chat-users-pagination-controls').length > 0) {
        generateChatUserPagination(data.page, data.totalPages, chatId);
      }
    },
    error: function (err) {
      console.error('Failed to load users', err);
    }
  });
}

function generateChatUserPagination(currentPage, totalPages, chatId) {
    let paginationHtml = '';
    const sidePagesToShow = 2;
    let pagesShown = new Set();

    // Use namespaced event to avoid conflicts
    const eventName = `scroll.chatUserPagination_${chatId}`;
    $(window).off(eventName).on(eventName, function() {
        if ($(window).scrollTop() + $(window).height() >= $(document).height() - 100) {
            if (currentPage < totalPages && !pagesShown.has(currentPage + 1)) {
                loadChatUsers(chatId, currentPage + 1);
                pagesShown.add(currentPage + 1);
            }
        }
    });

    if (currentPage >= totalPages) {
        return;
    }

    if (totalPages > 1) {
        paginationHtml += `<button class="btn btn-outline-primary me-2" ${currentPage === 1 ? 'disabled' : ''} onclick="loadChatUsers('${chatId}', ${currentPage - 1})">${window.translations.prev}</button>`;

        if (currentPage > sidePagesToShow + 1) {
            paginationHtml += `<button class="btn btn-outline-primary mx-1" onclick="loadChatUsers('${chatId}', 1)">1</button>`;
            if (currentPage > sidePagesToShow + 2) paginationHtml += `<span class="mx-1">...</span>`;
        }

        let startPage = Math.max(1, currentPage - sidePagesToShow);
        let endPage = Math.min(totalPages, currentPage + sidePagesToShow);

        for (let i = startPage; i <= endPage; i++) {
            paginationHtml += `<button class="btn ${i === currentPage ? 'btn-primary' : 'btn-outline-primary'} mx-1" onclick="loadChatUsers('${chatId}', ${i})">${i}</button>`;
        }

        if (currentPage < totalPages - sidePagesToShow - 1) {
            if (currentPage < totalPages - sidePagesToShow - 2) paginationHtml += `<span class="mx-1">...</span>`;
            paginationHtml += `<button class="btn btn-outline-primary mx-1" onclick="loadChatUsers('${chatId}', ${totalPages})">${totalPages}</button>`;
        }

        paginationHtml += `<button class="btn btn-outline-primary ms-2" ${currentPage === totalPages ? 'disabled' : ''} onclick="loadChatUsers('${chatId}', ${currentPage + 1})">${window.translations.next}</button>`;
    }

    $('#chat-users-pagination-controls').html(paginationHtml);
}

window.displayPeopleList = async function (userId, type = 'followers', page = 1) {
    try {
        // Show loading state on first page
        if (page === 1) {
            $('#people-list').html(`
                <div class="followers-page-loading">
                    <div class="followers-loading-spinner">
                        <i class="bi bi-arrow-repeat"></i>
                    </div>
                    <span>Loading...</span>
                </div>
            `);
        }
        
        const response = await fetch(`/user/${userId}/followers-or-followings?type=${type}&page=${page}`);
        const data = await response.json();

        let people = data.users || [];
        let htmlContent = '';

        // If there are followers or following users
        if (people.length > 0) {
            people.forEach(user => {
                htmlContent += `
                    <a href="/user/${user.userId}" class="follower-page-item">
                        <div class="follower-avatar-wrapper">
                            <img src="${user.profilePicture || '/img/avatar.png'}" alt="${user.userName}" class="follower-avatar">
                        </div>
                        <div class="follower-info-content">
                            <div class="follower-name-row">
                                <span class="follower-username">${user.userName}</span>
                            </div>
                            ${user.userBio ? `<p class="follower-bio">${user.userBio}</p>` : '<p class="follower-bio follower-bio-placeholder">No bio yet</p>'}
                        </div>
                        <div class="follower-action">
                            <i class="bi bi-chevron-right"></i>
                        </div>
                    </a>
                `;
            });
        } else if (page === 1) {
            // Only show empty state on first page
            htmlContent = `
                <div class="followers-page-empty">
                    <i class="bi bi-people"></i>
                    <span>${type === 'followers' ? 'No followers yet' : 'Not following anyone yet'}</span>
                </div>
            `;
        }

        // Update the HTML content for the list
        if (page === 1) {
            $('#people-list').html(htmlContent);
        } else {
            $('#people-list').append(htmlContent);
        }

        // Generate pagination controls
        if ($('#pagination-controls').length > 0) {
            generatePagination(data.page, data.totalPages, userId, type);
            
        }
    } catch (err) {
        console.error('Failed to load list', err);
        if ($('#people-list').children().length === 0) {
            $('#people-list').html(`
                <div class="followers-page-error">
                    <i class="bi bi-exclamation-triangle"></i>
                    <span>Failed to load list. Please try again.</span>
                    <button class="followers-retry-btn" onclick="displayPeopleList('${userId}', '${type}', 1)">
                        <i class="bi bi-arrow-clockwise"></i> Retry
                    </button>
                </div>
            `);
        }
    }
};
function generatePagination(currentPage, totalPages, userId, type) {
  let paginationHtml = '';
  const maxPagesToShow = 5;
  const sidePagesToShow = 2;
  let pagesShown = new Set();  // Track the pages already displayed

  // Use namespaced event to avoid conflicts
  const eventName = `scroll.peoplePagination_${userId}_${type}`;
  $(window).off(eventName).on(eventName, function() {
    if($('#pagination-controls').length === 0) return;
    const scrollTresold = $('#pagination-controls').offset().top  - 1000;
    
    if (scrollTresold < $(window).scrollTop()) {
      if (currentPage < totalPages && !pagesShown.has(currentPage + 1)) {
        displayPeopleList(userId, type, currentPage + 1);
        pagesShown.add(currentPage + 1);  // Mark page as shown
      }
    }
  });

  // If more than one page, generate pagination buttons
  if (totalPages > 1) {
    paginationHtml += `<button class="btn btn-outline-primary me-2" ${currentPage === 1 ? 'disabled' : ''} onclick="displayPeopleList('${userId}', '${type}', ${currentPage - 1})">${window.translations.prev}</button>`;

    if (currentPage > sidePagesToShow + 1) {
      paginationHtml += `<button class="btn btn-outline-primary mx-1" onclick="displayPeopleList('${userId}', '${type}', 1)">1</button>`;
      if (currentPage > sidePagesToShow + 2) {
        paginationHtml += `<span class="mx-1">...</span>`;
      }
    }

    let startPage = Math.max(1, currentPage - sidePagesToShow);
    let endPage = Math.min(totalPages, currentPage + sidePagesToShow);

    for (let i = startPage; i <= endPage; i++) {
      paginationHtml += `
      <button class="btn ${i === currentPage ? 'btn-primary' : 'btn-outline-primary'} mx-1" onclick="displayPeopleList('${userId}', '${type}', ${i})">
        ${i}
      </button>`;
    }

    if (currentPage < totalPages - sidePagesToShow - 1) {
      if (currentPage < totalPages - sidePagesToShow - 2) {
        paginationHtml += `<span class="mx-1">...</span>`;
      }
      paginationHtml += `<button class="btn btn-outline-primary mx-1" onclick="displayPeopleList('${userId}', '${type}', ${totalPages})">${totalPages}</button>`;
    }

    paginationHtml += `<button class="btn btn-outline-primary ms-2" ${currentPage === totalPages ? 'disabled' : ''} onclick="displayPeopleList('${userId}', '${type}', ${currentPage + 1})">${window.translations.next}</button>`;
  }

  $('#pagination-controls').html(paginationHtml);
}

window.displayUserChats = async function(userId, page = 1, skipDeduplication, forceRefresh = false) {
    try {
        // Add cache-busting timestamp to ensure fresh data (no browser caching)
        const cacheBuster = Date.now();
        const response = await fetch(`/api/chats?userId=${userId}&page=${page}&skipDeduplication=${skipDeduplication}&_t=${cacheBuster}`, {
            cache: 'no-store', // Disable browser caching
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
        const data = await response.json();

        let userChats = data.recent || [];
        let htmlContent = '';
        
        // Clear gallery on first page or force refresh to show latest characters
        if (page === 1 || forceRefresh) {
            $('#user-chat-gallery').empty();
        }
        
        displayChats(userChats, 'user-chat-gallery');

        // Update the gallery HTML
        $('#user-chat-gallery').append(htmlContent);
        if($('#user-chat-pagination-controls').length > 0){
            generateUserChatsPagination(userId, data.page, data.totalPages);   
        }
    } catch (err) {
        console.error('Failed to load user chats', err);
    }
};
function generateUserChatsPagination(userId, currentPage, totalPages) {
  let paginationHtml = '';
  const sidePagesToShow = 2;
  let pagesShown = new Set();

  // Use namespaced event to avoid conflicts
  const eventName = `scroll.userChatsPagination_${userId}`;
  $(window).off(eventName).on(eventName, function() {
    if($('#user-chat-pagination-controls').length === 0) return;
    const scrollTresold = $('#user-chat-pagination-controls').offset().top  - 1000;
    
    if (scrollTresold < $(window).scrollTop()) {
      if (currentPage < totalPages && !pagesShown.has(currentPage + 1)) {
        displayUserChats(userId, currentPage + 1);
        pagesShown.add(currentPage + 1);
      }
    }
  });

  if (currentPage >= totalPages) {
    $('#user-chat-pagination-controls').empty(); // Hide spinner when all is shown
    return;
  }

  if (totalPages > 1) {
    paginationHtml += `<button class="btn btn-outline-primary me-2" ${currentPage === 1 ? 'disabled' : ''} onclick="displayUserChats('${userId}', ${currentPage - 1})">${window.translations.prev}</button>`;

    if (currentPage > sidePagesToShow + 1) {
      paginationHtml += `<button class="btn btn-outline-primary mx-1" onclick="displayUserChats('${userId}', 1)">1</button>`;
      if (currentPage > sidePagesToShow + 2) paginationHtml += `<span class="mx-1">...</span>`;
    }

    let startPage = Math.max(1, currentPage - sidePagesToShow);
    let endPage = Math.min(totalPages, currentPage + sidePagesToShow);

    for (let i = startPage; i <= endPage; i++) {
      paginationHtml += `<button class="btn ${i === currentPage ? 'btn-primary' : 'btn-outline-primary'} mx-1" onclick="displayUserChats('${userId}', ${i})">${i}</button>`;
    }

    if (currentPage < totalPages - sidePagesToShow - 1) {
      if (currentPage < totalPages - sidePagesToShow - 2) paginationHtml += `<span class="mx-1">...</span>`;
      paginationHtml += `<button class="btn btn-outline-primary mx-1" onclick="displayUserChats('${userId}', ${totalPages})">${totalPages}</button>`;
    }

    paginationHtml += `<button class="btn btn-outline-primary ms-2" ${currentPage === totalPages ? 'disabled' : ''} onclick="displayUserChats('${userId}', ${currentPage + 1})">${window.translations.next}</button>`;
  }

  $('#user-chat-pagination-controls').html(paginationHtml);
}

// Enhanced displayPeopleChat with caching + infinite scroll
window.displayPeopleChat = async function (page = 1, option = {}, callback, reload = false) {
  const { imageStyle, imageModel, modelId = false, premium = false, query = '', userId = false, modal = false } = option
  const searchId = `${imageStyle}-${imageModel}-${query}-${userId}`

  let nsfw = $.cookie('nsfw') === 'true' || false
  if (option.nsfw) {
    nsfw = true
  }

  // LocalStorage key
  const cacheKey = `peopleChatCache_${searchId}`
  // Init or retrieve cache for this searchId
  let cacheData = JSON.parse(localStorage.getItem(cacheKey) || '{}')
  if (!cacheData.pages) cacheData.pages = {}
  peopleChatCache[searchId] = cacheData.pages

  // List cached pages
  const cachedPages = Object.keys(peopleChatCache[searchId]).map(Number).sort((a, b) => a - b)
  const maxCachedPage = cachedPages.length ? Math.max(...cachedPages) : 0

  // If reload => append all cached pages, update current page
  if (reload) {
    for (let p of cachedPages) {
      if (peopleChatCache[searchId][p]?.recent) {
        window.displayChats(peopleChatCache[searchId][p].recent, searchId, modal)
        if (typeof callback === 'function') {
          const uniqueIds = [...new Set(peopleChatCache[searchId][p].recent.map((chat) => chat._id))]
          callback(uniqueIds)
        }
      }
    }
    peopleChatCurrentPage[searchId] = maxCachedPage
    if (maxCachedPage > 0) page = maxCachedPage + 1 // optionally refresh from server
  }

  // If page already cached & not reloading => skip server call
  if (peopleChatCache[searchId][page] && !reload) {
    const cachedResult = peopleChatCache[searchId][page]
    window.displayChats(cachedResult.recent || [], searchId, modal)
    if (typeof callback === 'function') {
      const uniqueIds = [...new Set((cachedResult.recent || []).map((c) => c._id))]
      callback(uniqueIds)
    }
    peopleChatCurrentPage[searchId] = page
    generateChatsPaginationFromCache(option) // update pagination controls if needed
    return
  }

  // Otherwise fetch from server
  try {
    const response = await fetch(
      `/api/chats?page=${page}&style=${imageStyle}&model=${imageModel}&modelId=${modelId}&q=${query}&userId=${userId}&nsfw=${nsfw}`
    )
    const data = await response.json()
    
    // Display and callback
    if (data.recent) {
      window.displayChats(data.recent, searchId, modal)
      if (typeof callback === 'function') {
        const uniqueChatIds = [...new Set(data.recent.map((chat) => chat._id))]
        callback(uniqueChatIds)
      }
    }

    // Store in cache
    peopleChatCache[searchId][page] = data
    cacheData.pages = peopleChatCache[searchId]
    localStorage.setItem(cacheKey, JSON.stringify(cacheData))

    // Update current page & pagination
    peopleChatCurrentPage[searchId] = page
    if ($('#chat-pagination-controls').length > 0 && data.totalPages) {
      generateChatsPagination(data.totalPages, option)
    }
  } catch (err) {
    console.error('Failed to load chats:', err)
    if (typeof callback === 'function') callback([])
  }
}
// Infinite scroll + pagination
window.generateChatsPagination = function (totalPages, option = {}) {
  const { imageStyle, imageModel, query = '', userId = '' } = option
  const searchId = `${imageStyle}-${imageModel}-${query}-${userId}`

  if (!peopleChatLoadingState[searchId]) peopleChatLoadingState[searchId] = false
  if (!peopleChatCurrentPage[searchId]) peopleChatCurrentPage[searchId] = 0

  // Use namespaced event to avoid conflicts
  const eventName = `scroll.chatsPagination_${searchId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  $(window).off(eventName).on(eventName, () => {
    if($('#chat-pagination-controls').length === 0) return;
    const scrollTresold = $('#chat-pagination-controls').offset().top - 1000;
    if (
      !peopleChatLoadingState[searchId] &&
      peopleChatCurrentPage[searchId] < totalPages &&
      scrollTresold < $(window).scrollTop() 
    ) {
      console.log(`Infinite scroll => next page: ${peopleChatCurrentPage[searchId] + 1}`)
      peopleChatLoadingState[searchId] = true

      displayPeopleChat(peopleChatCurrentPage[searchId] + 1, option, null, false)
        .then(() => {
          peopleChatLoadingState[searchId] = false
          console.log(`Finished loading page ${peopleChatCurrentPage[searchId]}`)
        })
        .catch(() => {
          peopleChatLoadingState[searchId] = false
          console.error('Failed to load the next page.')
        })
    }
  })

  updateChatPaginationControls(totalPages, searchId)
}
// If we skip the server call due to cache
function generateChatsPaginationFromCache(option = {}) {
  const { imageStyle, imageModel, query = '', userId = '' } = option
  const searchId = `${imageStyle}-${imageModel}-${query}-${userId}`
  console.log(`generateChatsPaginationFromCache => searchId:${searchId}`)
  // If you don't store real totalPages in cache, pick a large number or track it separately
  updateChatPaginationControls(9999, searchId)
}

// Spinner or back-to-top
function updateChatPaginationControls(totalPages, searchId) {
  if (peopleChatCurrentPage[searchId] >= totalPages) {
  } else {
    $('#chat-pagination-controls').html(
      '<div class="text-center"><div class="spinner-border" role="status"></div></div>'
    )
  }
}
window.displaySimilarChats = function (chatData, targetGalleryIdParam) {
  let htmlContent = '';
  const currentUser = user; // Assuming 'user' is globally available from the template
  const currentUserId = currentUser._id;
  const subscriptionStatus = currentUser.subscriptionStatus === 'active';
  const isTemporaryUser = !!currentUser?.isTemporary;
  const targetGalleryId = targetGalleryIdParam || 'similar-characters-gallery';

  const loader = $(`#${targetGalleryId}-loader`);

  if(chatData.length === 0) {
    loader.removeClass('d-flex').hide(); // Hide the loader if it exists
    const galleryElement = $(document).find(`#${targetGalleryId}`);
    if (galleryElement.length) {
      galleryElement.append(`
        <div class="alert alert-info text-center" role="alert">
        ${window.translations?.similarChatsNotFound || 'No similar chats found.'}
        </div>
      `);
    } 
    return;
  }
  
  chatData.forEach(chat => {
    const isOwner = chat.userId === currentUserId;
    const isPremiumChat = false;
    const isNSFW = chat.nsfw || false;
    const genderClass = chat.gender ? `chat-gender-${chat.gender.toLowerCase()}` : '';
    const styleClass = chat.imageStyle ? `chat-style-${chat.imageStyle.toLowerCase()}` : '';
    const isBlur = shouldBlurNSFW(chat, subscriptionStatus);

    // Using col-md-4 col-lg-3 for potentially 3-4 cards per row
    let cardClass = `chat-card-mobile col-6 col-sm-4 col-md-3 col-lg-3 col-xl-2 p-1 ${genderClass} ${styleClass}`;
    if (isPremiumChat) cardClass += ' premium-chat';
    if (isNSFW) cardClass += ' nsfw-content';

    const primaryImage = chat.chatImageUrl || chat.thumbnailUrl || '/img/logo.webp';
    const chatId = chat._id;
    const chatName = chat.name || chat.chatName || 'Unknown';
    const firstMessage = chat.first_message || chat.description || '';
    const tags = (chat.tags || chat.chatTags || []).slice(0, 3);

    htmlContent += `
      <div class="${cardClass}" data-id="${chat._id}">
        <div class="card border-0 rounded-4 overflow-hidden position-relative" 
             style="aspect-ratio: 3/4; background: #1a1a1a;">
          
          <!-- Full-bleed Image -->
          <img 
            src="${primaryImage}" 
            alt="${chatName}" 
            class="position-absolute w-100 h-100 ${isBlur ? 'blurred-image-none' : ''}"
            style="object-fit: cover; inset: 0;"
            loading="lazy"
          >
          
          <!-- Gradient Overlay -->
          <div class="position-absolute w-100 h-100" 
               style="background: linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.85) 100%); inset: 0;">
          </div>
          
          <!-- Top Badges -->
          <div class="position-absolute top-0 start-0 end-0 p-2 d-flex justify-content-between align-items-start" style="z-index: 3;">
            <div class="d-flex gap-1 flex-wrap">
              ${isNSFW ? `
                <span class="badge rounded-pill px-2 py-1" 
                      style="background: rgba(220,53,69,0.9); font-size: 0.65rem; font-weight: 600;">
                  18+
                </span>
              ` : ''}
              ${isOwner ? `
                <span class="badge rounded-pill px-2 py-1" 
                      style="background: rgba(255,255,255,0.2); backdrop-filter: blur(4px); font-size: 0.65rem;">
                  <i class="bi bi-person-fill"></i>
                </span>
              ` : ''}
            </div
            
            <!-- Profile Quick Link -->
            <button class="btn btn-sm rounded-circle d-flex align-items-center justify-content-center"
                    onclick="event.stopPropagation(); redirectToCharacter('${chatId}', '${chat.slug || ''}')"
                    style="width: 32px; height: 32px; background: rgba(255,255,255,0.2); backdrop-filter: blur(4px); border: none;">
              <i class="bi bi-info-circle text-white" style="font-size: 0.9rem;"></i>
            </button>
          </div>
          
          <!-- Bottom Content -->
          <div class="position-absolute bottom-0 start-0 end-0 p-3" style="z-index: 3;">
            
            <!-- Character Name -->
            <h6 class="text-white fw-bold mb-1 text-truncate" 
                style="font-size: 1rem; text-shadow: 0 1px 3px rgba(0,0,0,0.5);">
              ${chatName}
            </h6>
            
            <!-- Short Description -->
            ${firstMessage ? `
              <p class="text-white-50 mb-2" 
                 style="font-size: 0.7rem; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                ${firstMessage.substring(0, 80)}${firstMessage.length > 80 ? '...' : ''}
              </p>
            ` : ''}
            
            <!-- Tags -->
            ${tags.length > 0 ? `
              <div class="d-flex gap-1 mb-2 flex-wrap">
                ${tags.map(tag => `
                  <span class="badge rounded-pill px-2 py-1" 
                        onclick="event.stopPropagation(); handleCategoryClick('${tag}')"
                        style="background: rgba(255,255,255,0.15); backdrop-filter: blur(4px); font-size: 0.6rem; cursor: pointer;">
                    #${tag}
                  </span>
                `).join('')}
              </div>
            ` : ''}
            
            <!-- Action Buttons -->
            <div class="d-flex gap-2">
              <button class="btn flex-grow-1 rounded-pill py-2 d-flex align-items-center justify-content-center gap-1"
                      onclick="event.stopPropagation(); redirectToChat('${chatId}', '${primaryImage}')"
                      style="background: linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%); border: none; color: white; font-size: 0.8rem; font-weight: 600;">
                <i class="bi bi-chat-dots-fill"></i>
                <span>${window.translations?.startChat || 'Chat'}</span>
              </button>
              <button class="btn rounded-pill py-2 d-flex align-items-center justify-content-center"
                      onclick="event.stopPropagation(); openCharacterIntroModal('${chatId}')"
                      style="background: rgba(255,255,255,0.15); backdrop-filter: blur(4px); border: none; color: white; font-size: 0.8rem; min-width: 44px;">
                <i class="bi bi-three-dots"></i>
              </button>
            </div>
          </div>
          
          <!-- NSFW Blur Overlay -->
          ${isBlur ? `
            <div class="position-absolute w-100 h-100 d-flex flex-column align-items-center justify-content-center" 
                 style="inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(20px); z-index: 4;">
              <i class="bi bi-lock-fill text-white mb-2" style="font-size: 1.5rem;"></i>
              <span class="text-white-50 mb-3" style="font-size: 0.75rem;">${window.translations?.nsfwContent || 'Adult Content'}</span>
              <button class="btn btn-sm rounded-pill px-4 py-2"
                      onclick="event.stopPropagation(); handleClickRegisterOrPay(event, ${isTemporaryUser})"
                      style="background: linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%); border: none; color: white; font-size: 0.8rem; font-weight: 600;">
                <i class="bi bi-unlock-fill me-1"></i>
                ${isTemporaryUser ? (window.translations?.login || 'Login') : (window.translations?.unlock || 'Unlock')}
              </button>
            </div>
          ` : ''}
          
          <!-- Loading Spinner -->
          <div id="spinner-${chatId}" 
               class="position-absolute w-100 h-100 d-none align-items-center justify-content-center" 
               style="inset: 0; background: rgba(255,255,255,0.9); z-index: 5;">
            <div class="spinner-border text-purple" role="status">
              <span class="visually-hidden">Loading...</span>
            </div>
          </div>
          
          <!-- Admin Controls -->
          ${window.isAdmin ? `
            <div class="position-absolute top-0 end-0 m-1 d-flex flex-column gap-1" style="z-index: 10; margin-top: 40px !important;">
              <button class="btn btn-sm rounded-circle chat-nsfw-toggle ${isNSFW ? 'nsfw' : 'sfw'}" 
                      data-id="${chatId}" 
                      onclick="event.stopPropagation(); toggleChatNSFW(this)"
                      style="width: 28px; height: 28px; background: rgba(0,0,0,0.7); border: none; color: white; font-size: 0.7rem;">
                <i class="bi ${isNSFW ? 'bi-eye-slash-fill' : 'bi-eye-fill'}"></i>
              </button>
              <button class="btn btn-sm rounded-circle set-sfw-thumbnail-btn" 
                      data-id="${chatId}" 
                      onclick="event.stopPropagation(); setSFWThumbnail(this)"
                      style="width: 28px; height: 28px; background: rgba(0,0,0,0.7); border: none; color: white; font-size: 0.7rem;">
                <i class="bi bi-image"></i>
              </button>
              <button class="btn btn-sm rounded-circle" 
                      data-id="${chat._id}" 
                      onclick="event.stopPropagation(); deleteChat(this)"
                      style="width: 28px; height: 28px; background: rgba(220,53,69,0.9); border: none; color: white; font-size: 0.7rem;">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  });

  const galleryElement = $(document).find(`#${targetGalleryId}`);
  if (galleryElement.length) {
    galleryElement.append(htmlContent);
  } else {
    console.warn(`Target gallery with ID #${targetGalleryId} not found.`);
  }
};
    
// Call /api/delete-chat/:chatId to delete a chat
window.deleteChat = function(el) {

  event.stopPropagation();
  const chatId = $(el).data('id');
  $.ajax({
    url: `/api/delete-chat/${chatId}`,
    method: 'DELETE',
    xhrFields: {
      withCredentials: true
    },
    success: function() {
      showNotification('Successfully deleted chat.', 'success');
      $(`.gallery-card[data-id="${chatId}"]`).remove();
    },
    error: function() {
      showNotification('Failed to delete chat.', 'error');
    }
  });
}

// Set SFW thumbnail for a character - finds a non-NSFW image from gallery and sets it as the chatImageUrl
window.setSFWThumbnail = function(el) {
  event.stopPropagation();
  const $btn = $(el);
  const chatId = $btn.data('id');
  
  if (!chatId) {
    showNotification('No chat ID found', 'error');
    return;
  }
  
  // Show loading state
  const originalHtml = $btn.html();
  $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status"></span>');
  
  $.ajax({
    url: `/api/admin/character/${chatId}/set-sfw-thumbnail`,
    method: 'POST',
    xhrFields: {
      withCredentials: true
    },
    success: function(response) {
      if (response.success && response.newImageUrl) {
        // Update the thumbnail image in the UI in real time
        const $card = $btn.closest('.gallery-card');
        const $cardImg = $card.find('.card-img-top, .rounded-avatar');
        
        if ($cardImg.length) {
          // If it's a background-image style
          if ($cardImg.css('background-image') !== 'none') {
            $cardImg.css('background-image', `url(${response.newImageUrl})`);
          } else {
            // If it's an img src
            $cardImg.attr('src', response.newImageUrl);
          }
        }
        
        // Also update any other images with the same chat ID on the page
        $(`.gallery-card[data-id="${chatId}"] .card-img-top`).attr('src', response.newImageUrl);
        $(`.gallery-card[data-id="${chatId}"] .rounded-avatar`).css('background-image', `url(${response.newImageUrl})`);
        
        // Update the character profile avatar if on character page
        const $profileAvatar = $('.profile-avatar, #mainProfileImage');
        if ($profileAvatar.length) {
          $profileAvatar.attr('src', response.newImageUrl);
        }
        
        // Update profile cover background if it exists
        const $profileCover = $('.profile-cover');
        if ($profileCover.length && $profileCover.css('background-image') !== 'none') {
          $profileCover.css('background-image', `linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.8)), url(${response.newImageUrl})`);
        }
        
        showNotification('Thumbnail updated to SFW image!', 'success');
      } else {
        showNotification(response.error || 'Failed to update thumbnail', 'error');
      }
    },
    error: function(xhr) {
      const errorMsg = xhr.responseJSON?.error || 'Failed to set SFW thumbnail';
      showNotification(errorMsg, 'error');
    },
    complete: function() {
      // Restore button state
      $btn.prop('disabled', false).html(originalHtml);
    }
  });
}

window.toggleChatNSFW = function(el) {
  //Avoid propagation
  event.stopPropagation();
  const isTemporary = !!user.isTemporary;
  // if (isTemporary) { openLoginForm(); return; }

  const $this = $(el);
  const chatId = $this.data('id');
  const isNSFW = $this.hasClass('nsfw'); // Check if already marked as NSFW

  const nsfwStatus = !isNSFW; // Toggle NSFW status

  $this.toggleClass('nsfw'); // Toggle NSFW class for UI change
  $this.closest('.gallery-card').toggleClass('nsfw-content', nsfwStatus); // Toggle NSFW content class
  
  // Update the button icon based on the NSFW status
  const icon = nsfwStatus 
    ? '<i class="bi bi-eye-slash-fill"></i>'   // NSFW icon (eye-slash for hidden content)
    : '<i class="bi bi-eye-fill"></i>';        // Non-NSFW icon (eye for visible content)

  $this.html(icon); // Update the button's icon

  $.ajax({
    url: `/api/chat/${chatId}/nsfw`, // Endpoint for updating NSFW status
    method: 'PUT',
        xhrFields: {
            withCredentials: true
        },
    contentType: 'application/json',
    data: JSON.stringify({ nsfw: nsfwStatus }), // Send NSFW status in request body
    success: function () {
      // Show success notification in Japanese
      if (nsfwStatus) {
          showNotification(window.translations.setNsfw, 'success');
      } else {
          showNotification(window.translations.unsetNsfw, 'success');
      }
      resetPopularChatCache();
      updateNSFWContentUI();
    },
    error: function () {
      $this.toggleClass('nsfw'); // Revert the class change if request fails
      $this.html(isNSFW 
        ? '<i class="bi bi-eye-fill"></i>' 
        : '<i class="bi bi-eye-slash-fill"></i>'); // Revert the icon as well
      showNotification(window.translations.errorOccurred, 'error');
    }
  });
}

window.deleteCharacter = function(el) {
  event.stopPropagation();
  const $btn = $(el);
  const chatId = $btn.data('id');
  
  if (!chatId) {
    showNotification('No chat ID found', 'error');
    return;
  }
  
  // Show confirmation dialog
  if (!confirm('Are you sure you want to delete this character? This action cannot be undone.')) {
    return;
  }
  
  // Show loading state
  const originalHtml = $btn.html();
  $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status"></span>');
  
  $.ajax({
    url: `/api/delete-chat/${chatId}`,
    method: 'DELETE',
    xhrFields: {
      withCredentials: true
    },
    success: function(response) {
      showNotification('Character deleted successfully', 'success');
      // Redirect to home or dashboard after deletion
      setTimeout(function() {
        window.location.href = '/';
      }, 1500);
    },
    error: function(xhr) {
      $btn.prop('disabled', false).html(originalHtml);
      const errorMessage = xhr.responseJSON?.error || 'Failed to delete character';
      showNotification(errorMessage, 'error');
    }
  });
}

window.loadAllUserPosts = async function (page = 1) {
    const currentUser = user
    const currentUserId = currentUser._id;
    const subscriptionStatus = currentUser.subscriptionStatus === 'active';
    const isAdmin = await checkIfAdmin(currentUserId);    
    const isTemporary = !!currentUser?.isTemporary
    $.ajax({
      url: `/user/posts?page=${page}`,
      method: 'GET',
        xhrFields: {
            withCredentials: true
        },
      success: function (data) {
        let galleryHtml = '';
        data.posts.forEach(item => {
            let isBlur = item?.post?.nsfw && !subscriptionStatus 
            const isLiked = item?.post?.likedBy?.some(id => id.toString() === currentUserId.toString());

            galleryHtml += `
              <div class="col-12 col-md-3 col-lg-2 mb-2">
                <div class="card shadow-0">
                  <div class="d-flex align-items-center p-2">
                    <a href="/user/${item.userId}">
                      <img src="${item.profilePicture}" alt="${item.userName}" class="rounded-circle me-2" width="40" height="40">
                    </a>
                    <a href="/user/${item.userId}" class="text-decoration-none text-dark">
                      <strong>${item.userName}</strong>
                    </a>
                  </div>
                  ${isBlur ? `
                  <div type="button" onclick=${isTemporary?`openLoginForm()`:`loadPlanPage()`}>
                    <img data-src="${item.post.imageUrl}" class="card-img-top img-blur" style="object-fit: cover;">
                  </div>
                  ` : `
                  <a href="/post/${item.post.postId}" class="text-muted text-decoration-none">
                    <img src="${item.post.imageUrl}" alt="${item.post.prompt}" class="card-img-top">
                  </a>
                  <div class="d-none card-body p-2 d-flex align-items-center justify-content-between">
                    <div class="row">
                            <div class="col-12" style="overflow:hidden; text-wrap:nowrap;">
                                <a href="/post/${item.post.postId}" class="text-muted text-decoration-none text-short">${item.post.comment}</a>
                            </div>
                            <div class="col-12 text-end">
                                <button 
                                class="btn btn-light post-nsfw-toggle ${!isAdmin?'d-none':''}" 
                                data-id="${item.post.postId}"
                                onclick="togglePostNSFW(this)"> 
                                    <i class="bi ${item?.post?.nsfw ? 'bi-eye-slash':'bi-eye'} me-2" style="cursor: pointer;"></i>
                                </button>
                                <button 
                                class="btn btn-light shadow-0 post-fav  ${isLiked ? 'liked' : ''}" 
                                data-id="${item.post.postId}"
                                onclick="togglePostFavorite(this)" 
                                > 
                                    <i class="bi bi-heart me-2"></i>いいね 
                                    <span class="ct">${item.post.likes || 0}</span>
                                </button>
                            </div>
                        </div>
                  </div>
                  `}
                </div>
              </div>
            `;
        });

        $('#post-gallery').append(galleryHtml);
        if($('#user-posts-pagination-controls').length > 0){
            generateUserPostsPagination(data.page, data.totalPages);
        }

        $(document).find('.img-blur').each(function() {
            blurImage(this);
        });
      },
      error: function (err) {
        console.error('Failed to load posts', err);
      }
    });
}
function scrollToPlan() {
    $('html, body').animate({
        scrollTop: $('#pricing-container').offset().top
    }, 800); // Adjust the duration (800ms) as needed
}

window.searchImages = async function () {
    $(`.all-chats-images-gallery`).each(function(){
        const container = $(this)
        const query = container.attr('data-query')
        const style = container.attr('data-style')
        resultImageSearch(1,query,style); 
    })
}
window.resultImageSearch = async function (page = 1,query,style = 'anime', callback) {
    const currentUser = user
    const currentUserId = currentUser._id;
    const subscriptionStatus = currentUser.subscriptionStatus === 'active';
    const isAdmin = await checkIfAdmin(currentUserId);    
    $.ajax({
      url: `/chats/images/search?page=${page}&query=${query}&style=${style}`,
      method: 'GET',
        xhrFields: {
            withCredentials: true
        },
      success: function (data) {
        let chatGalleryHtml = '';
        data.images.forEach(item => {
            let isBlur = item?.nsfw && !subscriptionStatus 
            const isLiked = item?.likedBy?.some(id => id.toString() === currentUserId.toString());
            chatGalleryHtml += `
                <div class="col-6 col-md-3 col-lg-2 mb-2">
                    <div class="card shadow-0">
                        ${isBlur ? `
                        <div type="button" onclick="event.stopPropagation();handleClickRegisterOrPay(event,${isTemporary})">
                            <img data-src="${item.imageUrl}" class="card-img-top img-blur" style="object-fit: cover;" >
                        </div>
                        ` : `
                        <a href="/character/slug/${item.chatSlug}?imageSlug=${item.slug}" class="text-muted text-decoration-none">
                            <img src="${item.imageUrl}" alt="${item.prompt}" class="card-img-top">
                        </a>
                        <div class="${!isAdmin ? 'd-none' : ''} card-body p-2 d-flex align-items-center justify-content-between">
                            <button onclick="event.stopPropagation(); if(typeof UserTracking !== 'undefined' && UserTracking.trackStartChat) { UserTracking.trackStartChat('${item.chatId}', 'search_results', { sourceElementClass: 'search-result-chat-btn' }); } window.location.href='/chat/${item.chatId}';" class="btn btn-outline-secondary col-12">
                              <i class="bi bi-chat-dots me-2"></i> ${translations.startChat}
                            </button>
                            <button class="btn btn-light image-nsfw-toggle ${!isAdmin ? 'd-none' : ''} ${item?.nsfw ? 'nsfw' : 'sfw'}" data-id="${item._id}">
                              <i class="bi ${item.nsfw ? 'bi-eye-slash-fill' : 'bi-eye-fill'}"></i>
                            </button>
                            <button class="btn btn-sm btn-info set-sfw-thumbnail-btn ${!isAdmin ? 'd-none' : ''}" data-id="${item.chatId}" onclick="setSFWThumbnail(this); event.stopPropagation();" title="Set SFW Thumbnail">
                              <i class="bi bi-image"></i>
                            </button>
                            <span 
                            class="btn btn-light float-end image-fav ${isLiked ? 'liked' : ''}" 
                            data-id="${item._id}" 
                            onclick="toggleImageFavorite(this)" 
                            >
                              <i class="bi ${isLiked ? 'bi-heart-fill':'bi-heart'}" style="cursor: pointer;"></i>
                            </span>
                        </div>`
                        }
                    </div>
                </div>
            `;
        });

        $(`.all-chats-images-gallery[data-query="${query}"]`).append(chatGalleryHtml);

        $(document).find('.img-blur').each(function() {
            blurImage(this);
        });

        if (typeof callback === 'function') {
            callback(data.images);
        }
      },
      error: function (err) {
        console.error('Failed to load images', err);
      }
    });
}
// Load All Chat Images with cache + infinite scroll
window.loadAllChatImages = function (page = 1, reload = false) {
    const cacheKey = 'allChatsImagesCache'
    const currentUserId = user._id
    const subscriptionStatus = user.subscriptionStatus === 'active'
  
    // Return a Promise for sync with infinite scroll
    return new Promise(async (resolve, reject) => {
      // Check admin rights (optional async call)
      let isAdmin = false;
      if (currentUserId) {
        checkIfAdmin(currentUserId)
          .then(result => {
            isAdmin = result;
          })
          .catch(err => console.error('Failed to check admin status:', err));
      }

      // Retrieve or init cache
      let cacheData = JSON.parse(localStorage.getItem(cacheKey) || '{}')
      if (!cacheData.pages) cacheData.pages = {}
      allChatsImagesCache = cacheData.pages
  
      // List cached pages
      const cachedPages = Object.keys(allChatsImagesCache).map(Number).sort((a, b) => a - b)
      const maxCachedPage = cachedPages.length ? Math.max(...cachedPages) : 0
  
      // If reload => append all cached pages, set current page
      if (reload) {
        cachedPages.forEach((p) => {
          if (allChatsImagesCache[p]?.recent) {
            appendAllChatsImages(allChatsImagesCache[p].recent, subscriptionStatus, isAdmin)
          }
        })
        allChatsCurrentPage = maxCachedPage
        if (maxCachedPage > 0) page = maxCachedPage + 1 // optional: refresh the last cached page
      }
  
      // If page is in cache and not reloading => skip server call
      if (allChatsImagesCache[page] && !reload) {
        appendAllChatsImages(allChatsImagesCache[page], subscriptionStatus, isAdmin)
        allChatsCurrentPage = page
        generateAllChatsImagePaginationFromCache() // updates spinner/back-to-top
        return resolve()
      }
  
      // Otherwise, fetch from server
      $.ajax({
        url: `/chats/images?page=${page}`,
        method: 'GET',
        xhrFields: {
            withCredentials: true
        },
        success: (data) => {
          appendAllChatsImages(data.images, subscriptionStatus, isAdmin)
  
          // Cache the new page
          allChatsImagesCache[data.page] = data.images
          cacheData.pages = allChatsImagesCache
          localStorage.setItem(cacheKey, JSON.stringify(cacheData))
  
          // Update currentPage, then set up infinite scroll
          allChatsCurrentPage = data.page
          generateAllChatsImagePagination(data.totalPages)
          resolve()
        },
        error: (err) => {
          console.error(`Failed to load page ${page} from server`, err)
          reject(err)
        },
      })
    })
  }
  
  // Infinite scroll + pagination for All Chats images
  window.generateAllChatsImagePagination = function (totalPages) {
    // Use namespaced event to avoid conflicts
    const eventName = 'scroll.allChatsImagePagination';
    $(window).off(eventName).on(eventName, () => {
      if($('#all-chats-images-pagination-controls').length === 0) return;
      const scrollTresold = $('#all-chats-images-pagination-controls').offset().top - 1000;
      if (
        !allChatsLoadingState &&
        allChatsCurrentPage < totalPages &&
        scrollTresold < $(window).scrollTop() 
      ) {
        allChatsLoadingState = true
        loadAllChatImages(allChatsCurrentPage + 1, false)
          .then(() => {
            allChatsLoadingState = false
          })
          .catch(() => {
            allChatsLoadingState = false
          })
      }
    })
    updateAllChatsPaginationControls(totalPages)
  }
  
  // If we skip a server call (using only cache), refresh controls
  function generateAllChatsImagePaginationFromCache() {
    // If you don't store totalPages, set a high number or store it separately
    updateAllChatsPaginationControls(9999)
  }
  
  // Spinner vs. Back-to-top
  function updateAllChatsPaginationControls(totalPages) {
    if (allChatsCurrentPage >= totalPages) {
      console.log('All Chats: No more pages to load.')
    } else {
      $('#all-chats-images-pagination-controls').html(
        '<div class="text-center"><div class="spinner-border" role="status"></div></div>'
      )
    }
  }
  
  // Append images to #all-chats-images-gallery
  function appendAllChatsImages(images, subscriptionStatus, isAdmin) {
    const currentUserId = user._id
    let chatGalleryHtml = ''
  
    images.forEach((item) => {
      const isBlur = shouldBlurNSFW(item, subscriptionStatus);
      const isLiked = Array.isArray(item.likedBy)
        ? item.likedBy.some(id => id.toString() === currentUserId.toString())
        : false;

      chatGalleryHtml += `
        <div class="col-6 col-md-3 col-lg-2 mb-2">
          <div class="card shadow-0">
            ${
              isBlur
                ? `<div type="button" onclick="event.stopPropagation();handleClickRegisterOrPay(event,${isTemporary})">
                        <img data-src="${item.imageUrl}" class="card-img-top img-blur" style="object-fit: cover;" >
                    </div>`
                : `<a href="/character/slug/${item.chatSlug}?imageSlug=${item.slug}" class="text-muted text-decoration-none">
                     <img src="${item.imageUrl}" alt="${item.prompt}" class="card-img-top">
                   </a>
                   <div class="${!isAdmin ? 'd-none' : ''} card-body p-2 d-flex align-items-center justify-content-between">
                     <button onclick="event.stopPropagation(); if(typeof UserTracking !== 'undefined' && UserTracking.trackStartChat) { UserTracking.trackStartChat('${item.chatId}', 'explore_card', { sourceElementClass: 'gallery-chat-btn' }); } window.location.href='/chat/${item.chatId}';" class="btn btn-outline-secondary col-12">
                       <i class="bi bi-chat-dots me-2"></i> ${translations.startChat}
                     </button>
                     <button class="btn btn-light image-nsfw-toggle ${!isAdmin ? 'd-none' : ''} ${item?.nsfw ? 'nsfw' : 'sfw'}" data-id="${item._id}">
                       <i class="bi ${item.nsfw ? 'bi-eye-slash-fill' : 'bi-eye-fill'}"></i>
                     </button>
                     <button class="btn btn-sm btn-info set-sfw-thumbnail-btn ${!isAdmin ? 'd-none' : ''}" data-id="${item.chatId}" onclick="setSFWThumbnail(this); event.stopPropagation();" title="Set SFW Thumbnail">
                       <i class="bi bi-image"></i>
                     </button>
                     <span 
                     class="btn btn-light float-end image-fav ${isLiked ? 'liked' : ''}" 
                     data-id="${item._id}" 
                     onclick="toggleImageFavorite(this)" 
                     >
                       <i class="bi ${isLiked ? 'bi-heart-fill':'bi-heart'}" style="cursor: pointer;"></i>
                     </span>
                   </div>`
            }
          </div>
        </div>
      `
    })
  
    $('#all-chats-images-gallery').append(chatGalleryHtml)
    $(document).find('.img-blur').each(function () {
      blurImage(this)
    })
  }
window.loadUserPosts = async function (userId, page = 1, like = false) {
    const currentUser = user
    const currentUserId = currentUser._id
    const subscriptionStatus = currentUser.subscriptionStatus == 'active'
    const isTemporary = !!currentUser?.isTemporary
    $.ajax({
      url: `/user/${userId}/posts?page=${page}&like=${like}`,
      method: 'GET',
        xhrFields: {
            withCredentials: true
        },
      success: function (data) {
        let galleryHtml = '';
        data.posts.forEach(item => {
            let isBlur = item?.image?.nsfw && !subscriptionStatus 
            const isLiked = item?.likedBy?.some(id => id.toString() === currentUserId.toString());
            galleryHtml += `
                <div class="col-12 col-md-3 col-lg-2 mb-2">
                <div class="card">
                    <div class="d-flex align-items-center p-2">
                        <a href="/user/${item.userId}">
                            <img src="${item?.profilePicture}" alt="${item?.userName}" class="rounded-circle me-2" width="40" height="40">
                        </a>
                        <a href="/user/${item.userId}" class="text-decoration-none text-dark">
                            <strong>${item?.userName}</strong>
                        </a>
                    </div>
                    ${isBlur ? `
                    <div type="button" onclick=${isTemporary?`openLoginForm()`:`loadPlanPage()`}>
                        <img data-src="${item.image.imageUrl}" class="card-img-top img-blur" style="object-fit: cover;" >
                    </div>
                    ` : `
                    <a href="/post/${item._id}" class="text-muted text-decoration-none">
                        <img src="${item.image.imageUrl}" alt="${item.image.prompt}" class="card-img-top">
                    </a>
                    <div class="d-none card-body p-2">
                        <div class="row mx-0">
                            <div class="col-12" style="overflow:hidden; text-wrap:nowrap;">
                                <a href="/post/${item._id}" class="text-muted text-decoration-none text-short ">${item.comment || 'No Comment'}</a>
                            </div>
                            <div class="col-12 text-end">
                                <button 
                                class="btn btn-light shadow-0 post-fav  ${isLiked ? 'liked' : ''}" 
                                data-id="${item._id}
                                onclick="togglePostFavorite(this)"> 
                                    <i class="bi bi-heart me-2"></i>いいね 
                                    <span class="ct">${item.likes || 0}</span>
                                </button>
                                <span 
                                class="float-end post-visible d-none ${item.isPrivate ? 'private':''} ${item.userId.toString() != currentUser._id.toString() ? 'd-none':''}" 
                                data-id="${item._id}"
                                onclick="togglePostVisibility(this)"
                                >
                                    <i class="bi ${item.isPrivate ? 'bi-eye-slash':'bi-eye'} me-2" style="cursor: pointer;"></i>
                                </span>
                            </div>
                        </div>
                    </div>
                    `}
                </div>
                </div>
            `;
        });
        const containerId = like ? 'user-posts-like' : 'user-posts-gallery'
        $(`#${containerId}`).append(galleryHtml);
        const pageContainerId = like ? 'posts-like-pagination-controls' : 'pagination-controls';
        if($(`#${pageContainerId}`).length > 0){
            generateUserPostPagination(data.page, data.totalPages, userId);
        }

        $(document).find('.img-blur').each(function() {
            blurImage(this);
        });
      },
      error: function (err) {
        console.log('Failed to load posts', err);
      }
    });
}

function initializePersonaStats(personas) {

    if(personas){
        $('.persona').each(function() {
            const personaId = $(this).data('id');
            if (personas.includes(personaId)) {
                $(this).addClass('on')
                $(this).find('i').addClass('fas').removeClass('far');
            } else {
                $(this).removeClass('on')
                $(this).find('i').addClass('far').removeClass('fas');
            }
        });
    }
}


window.showPremiumPopup = async function() {
    const user = user
    const isTemporary = !!user?.isTemporary
    if(isTemporary){
        openLoginForm()
        return
    }
    const features = [
        "毎日無制限でチャットできる",
        "フレンドを無制限で作成できる",
        "新しいキャラクターを作成する",
        "新機能への早期アクセス",
        "優先的なサポート対応"
    ];
    const messageTitle = '🚀 プレミアムプランで<br>体験をアップグレードしよう！';
    const messageText = `
        <div class="premium-offer" style="background-color: #fff3cd; border-radius: 10px; padding: 10px; margin-bottom: 15px;">
            <h6 style="color: #856404; font-weight: bold; text-align: center;">今なら登録するだけで<br><strong>1,000コイン</strong>をプレゼント！</h6>
        </div>
        <p style="font-size: 12px; text-align: center;">無制限の機能とエクスクルーシブな特典をお楽しみいただけます。<br>今すぐプレミアムプランに登録して、すべての機能を最大限に活用しましょう。</p>
        <ul class="list-group list-group-flush">
            ${features.map(feature => `<li class="list-group-item px-0"><span class="me-2">🔥</span>${feature}</li>`).join('')}
        </ul>
        <p style="font-size: 12px; text-align: center;">いつでもキャンセル可能、質問なしで対応いたします。<br>また、お支払いは <strong>最も安全なStripe</strong> で行われます。</p>
    `;

    // Display the first premium promotion popup using Swal.fire
    Swal.fire({
        //imageUrl: '/img/premium-promo.png', // Replace with your image URL
        imageWidth: '100%',
        imageHeight: 'auto',
        position: 'bottom',
        html: `
            <div class="container-0">
                <div class="row justify-content-center">
                    <div class="text-start">
                        <h5 class="fw-bold text-center">${messageTitle}</h5>
                        <div class="premium-content" style="background-color: #f8f9fa; border-radius: 10px; padding: 20px; box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1);">
                            ${messageText}
                            <a href="/my-plan" class="btn btn-dark border-0 shadow-0 w-100 custom-gradient-bg mt-3" style="font-size: 16px; padding: 10px;">プレミアムプランを確認する</a>
                        </div>
                    </div>
                </div>
            </div>
        `,
        showCancelButton: false,
        showConfirmButton: false,
        showCloseButton: true,
        animation: false,
        showClass: {
            popup: 'animate__animated animate__fadeIn'
        },
        hideClass: {
            popup: 'animate__animated animate__slideOutRight'
        },
        customClass: {
            popup: 'swal2-custom-popup animate__animated animate__fadeIn',
            closeButton: 'swal2-custom-close-button' 
        },
        didOpen: () => {
            // Initially hide the close button
            document.querySelector('.swal2-custom-close-button').style.display = 'none';

            // Show the close button after 5 seconds
            setTimeout(() => {
                $('.swal2-custom-close-button').fadeIn('slow')
            }, 3000);
        }
    }).then((result) => {
        $.cookie('showPremiumPopup', true, { expires: 1/24 });
        if (result.dismiss) {
            // Display a secondary popup after the first one is closed
            Swal.fire({
                position: 'top-end',
                title: '<strong>プレミアムプランでさらに楽しもう！</strong>',
                html: `
                    <p style="font-size: 14px; margin-bottom: 10px;">今なら1,000コインをプレゼント中！</p>
                    <a href="/my-plan" class="btn btn-dark border-0 shadow-0 w-100 custom-gradient-bg" style="font-size: 14px; padding: 8px;">今すぐプレゼントを受け取る</a>
                `,
                showConfirmButton: false,
                showCloseButton: true,
                backdrop: false,
                allowOutsideClick: false,
                customClass: {
                    title: 'swal2-custom-title',
                    popup: 'swal2-custom-popup bg-light border border-dark',
                    content: 'swal2-custom-content',
                    closeButton: 'swal2-top-left-close-button',
                    popup: 'swal2-custom-popup animate__animated animate__fadeIn',
                },
                showClass: {
                    popup: 'animate__animated animate__fadeIn'
                },
                hideClass: {
                    popup: 'animate__animated animate__slideOutRight'
                },
            });
            
        }
        
        
    });
}

window.generateCompletion = async function(systemPrompt, userMessage) {
    try {
        const response = await $.ajax({
            url: '/api/generate-completion',
            type: 'POST',
            contentType: 'application/json',
            xhrFields: {
                withCredentials: true
            },
            data: JSON.stringify({ systemPrompt: systemPrompt, userMessage: userMessage })
        });
        return response.completion;
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}

function updateSwiperSlides(images) {
    // Ensure Swiper container exists
    const swiperContainer = document.querySelector('.swiper-container');
    const swiperWrapper = swiperContainer.querySelector('.swiper-wrapper');
    
    if (!swiperContainer || !swiperWrapper) {
        console.error('Swiper container or wrapper is missing.');
        return;
    }

    // Append new slides
    images.forEach((image, index) => {
        const slide = document.createElement('div');
        slide.className = 'swiper-slide';
        slide.setAttribute('data-index', index);
        slide.innerHTML = `<img src="${image.imageUrl}" alt="${image.prompt}" class="card-img-top rounded shadow m-auto" style="object-fit: contain;height: 100vh;width: 100%;">`;
        swiperWrapper.appendChild(slide);
    });

    // Initialize or update Swiper
    if (!swiperInstance) {
        swiperInstance = new Swiper('.swiper-container', {
            loop: false,
            navigation: {
                nextEl: '.swiper-button-next',
                prevEl: '.swiper-button-prev',
            },
            pagination: {
                el: '.swiper-pagination',
                clickable: true,
            },
        });
    } else {
        swiperInstance.update(); // Update existing instance with new slides
    }

    // Navigate to the current index
    swiperInstance.slideTo(currentSwiperIndex, 0);
}

function gridLayout(selector) {
  // Check if the selector exists
  const $container = $(selector);
  if ($container.length === 0) {
    return;
  }
  // Find the image items (typically in a column div)
  const $items = $container.children('div');

  if ($items.length === 0) return; // No items to adjust
  
  // If a grid controller already exists, don't create another one
  if ($container.prev('.grid-control').length > 0) {
    return;
  }
  
  // Determine current grid size by examining the first item's classes
  let currentValue = 2; // Default to 2 per row
  const $firstItem = $items.first();
  if ($firstItem.attr('class')) {
    const classList = $firstItem.attr('class').split(/\s+/);
    
    // Check for various Bootstrap column classes
    for (const className of classList) {
      // Check for col-N classes (regular, md, lg, etc.)
      const matches = className.match(/col-(?:xs-|sm-|md-|lg-|xl-|xxl-)?(\d+)/);
      if (matches && matches[1]) {
        currentValue = Math.min(6, Math.max(1, 12 / parseInt(matches[1])));
        break;
      }
    }
  }
  
  // Create a unique ID for the slider
  const sliderId = `grid-slider-${Math.random().toString(36).substring(2, 11)}`;
  
  // Create the slider control HTML with an icon
  const sliderHtml = `
    <div class="grid-control mb-3">
      <label for="${sliderId}" class="d-flex justify-content-between align-items-center">
        <span><i class="bi bi-grid"></i> ${translations?.gridSize || 'Grid Size'}</span>
        <span class="grid-size-display badge bg-light text-dark">${currentValue} ${translations?.perRow || 'per row'}</span>
      </label>
      <input type="range" class="form-range" min="1" max="4" value="${currentValue}" id="${sliderId}">
    </div>
  `;
  
  // Insert the slider before the container
  $container.before(sliderHtml);
  
  // Get the slider element
  const $slider = $(`#${sliderId}`);
  const $sizeDisplay = $slider.closest('.grid-control').find('.grid-size-display');
  

  // Use delegation to handle dynamically added elements
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Check if new items were added
        const hasNewItems = Array.from(mutation.addedNodes).some(node => 
          node.nodeType === Node.ELEMENT_NODE && node.tagName === 'DIV'
        );
        if (hasNewItems) {
          // Re-apply grid layout to new items
          const currentValue = $slider.val();
          updateGrid(currentValue);
        }
      }
    });
  });

  // Start observing the container for changes
  observer.observe($container[0], {
    childList: true,
    subtree: false
  });

  // Store observer reference for cleanup if needed
  $container.data('gridObserver', observer);

  function updateGrid(value) {
    $sizeDisplay.text(`${value} ${translations?.perRow || 'per row'}`);

    let effectiveValue = parseInt(value);
    const screenWidth = window.innerWidth;

    // On small screens (<768px), cap at 2 columns max
    if (screenWidth < 768 && effectiveValue > 2) {
      effectiveValue = 2;
      $sizeDisplay.text(`2 ${translations?.perRow || 'per row'}`);
      $slider.attr('max', 2);
    }

    // Remove ALL Bootstrap grid classes and custom col-20p class
    // The improved regex captures all possible col-* classes including col-20p
    $container.children('div').each(function() {
      const $div = $(this);
      const classes = $div.attr('class') ? $div.attr('class').split(/\s+/) : [];
      const filtered = classes.filter(c =>
        !/^col(-[a-z]{2,3})?-\d+$/.test(c) && c !== 'col-20p'
      );
      $div.attr('class', filtered.join(' '));
    });

    // Handle 5 columns (custom 20% width)
    if (effectiveValue === 5) {
      // Add the custom CSS if it doesn't exist yet
      if (!$('#grid-custom-css').length) {
        $('head').append(`
          <style id="grid-custom-css">
            .col-20p { 
              width: 20%; 
              flex: 0 0 20%;
              max-width: 20%;
              position: relative;
              padding-right: 15px;
              padding-left: 15px;
            }
          </style>
        `);
      }
      $container.children('div').each(function() {
        if (screenWidth < 768) {
          $(this).addClass('col-6');
        } else {
          $(this).addClass('col-20p');
        }
      });
    } else {
      // Standard Bootstrap grid
      if (screenWidth < 768) {
        // 1: col-12, 2: col-6, 3: col-4
        const colClass = `col-${12 / effectiveValue}`;
        $container.children('div').each(function() {
          $(this).addClass(colClass);
        });
      } else {
        const colSize = Math.floor(12 / effectiveValue);
        $container.children('div').each(function() {
          $(this).addClass(`col-${colSize} col-sm-${colSize} col-md-${colSize} col-lg-${colSize} col-xl-${colSize}`);
        });
      }
    }

    localStorage.setItem('gridPreference', value);
  }
    
    // Check for saved preference
    const savedPreference = localStorage.getItem('gridPreference');
    if (savedPreference) {
      $slider.val(savedPreference);
      updateGrid(savedPreference);
    }
    
    // Add event listener for slider changes
    $slider.on('input', function() {
      updateGrid($(this).val());
    });
}

// Global state for query management
let currentActiveQuery = '';
let availableQueryTags = [];


// Initialize infinite scroll for chats with images
$(document).ready(function () {
    let currentPageMap = new Map(); // Track current page for each query
    let isFetchingChats = false;
    const hasMoreChatsMap = new Map(); // Track if more chats are available for each query
  
    // Adjust these as needed
    const currentUser = window.user || {};
    const currentUserId = currentUser._id;
    const subscriptionStatus = currentUser.subscriptionStatus === 'active';
    const isTemporary = !!currentUser.isTemporary;
  
    // Check admin rights (optional async call)
    let isAdmin = false;
    if (currentUserId) {
      checkIfAdmin(currentUserId)
        .then(result => {
          isAdmin = result;
        })
        .catch(err => console.error('Failed to check admin status:', err));
    }

    // Create loading spinner element
    function createLoadingSpinner() {
      return `
        <div id="chats-loading-spinner" class="text-center my-4">
          <div class="spinner-border text-purple" role="status" style="width: 3rem; height: 3rem;">
            <span class="visually-hidden">Loading...</span>
          </div>
          <div class="mt-2 text-muted">${translations.loadingMoreCharacters}</div>
        </div>
      `;
    }

    // Create back to top button
    function createBackToTopButton() {
      return `
        <div id="back-to-top-container" class="text-center my-4">
          <button class="btn btn-outline-primary" onclick="scrollToTop()">
            <i class="bi bi-arrow-up"></i> Back to Top
          </button>
        </div>
      `;
    }

    // Show loading spinner
    function showLoadingSpinner() {
      // Remove existing spinner or back-to-top if present
      $('#chats-loading-spinner, #back-to-top-container').remove();
      
      // Add spinner to the end of the container
      $('#all-chats-container').append(createLoadingSpinner());

    }

    // Hide loading spinner
    function hideLoadingSpinner() {
      $('#chats-loading-spinner').remove();
    }

    // Show back to top button
    function showBackToTopButton() {
      // Remove existing spinner or back-to-top if present
      $('#chats-loading-spinner, #back-to-top-container').remove();
      
      // Add back-to-top button
      $('#all-chats-container').append(createBackToTopButton());
    }
    // Hide back to top button
    function hideBackToTopButton() {
      $(document).find('#back-to-top-container').remove();
    }

    /**
     * Fetch Chats with Images (Vertical Infinite Scroll)
     */
    function fetchChatsWithImages(page, query = '') {
      if(query == '' && !window.location.pathname.includes('/character')) {
        $('#all-chats-container').empty(); 
        $('#all-chats-images-pagination-controls').empty();
        $('#chat-gallery').show();
        return
      }
      const hasMoreChats = hasMoreChatsMap.get(query) !== false;
      if (isFetchingChats || !hasMoreChats) return;
      
      isFetchingChats = true;
      $('#chat-gallery').hide();
      showLoadingSpinner();
      hideBackToTopButton();

      $.ajax({
        url: `/chats/horizontal-gallery?page=${page}&query=${encodeURIComponent(query)}`,
        method: 'GET',
        xhrFields: {
            withCredentials: true
        },
        success: function (data) {
          // Hide spinner on success
          hideLoadingSpinner();
          // Check if we have more chats
          if (!data.chats || data.chats.length === 0) {
            hasMoreChatsMap.set(query, false);
            showBackToTopButton();
            console.log('No more characters to load');
            return;
          }

          // Check if this is the last page
          if (data.totalPages && currentPageMap.get(query) >= data.totalPages) {
            hasMoreChatsMap.set(query, false);
          }
            
          window.displayChats(data.chats, 'all-chats-container');
          
  
          // Apply blur if needed
          $(document)
            .find('.img-blur')
            .each(function () {
              blurImage(this);
            });
  
          // Reset fetching flag and increment page
          isFetchingChats = false;
          currentPageMap.set(query, (currentPageMap.get(query) || 1) + 1);

            // Only show back to top if we've reached the end AND not currently loading
          if (!hasMoreChatsMap.get(query) && !isFetchingChats) {
            showBackToTopButton();
          }
        },
        error: function (err) {
          console.error('Failed to load chats', err);
          hideLoadingSpinner();
          isFetchingChats = false;
          
                   
          // Show error message or back to top on error
          $('#all-chats-container').append(`
            <div class="text-center my-4 text-danger">
              <i class="bi bi-exclamation-triangle"></i> Failed to load more characters
            </div>
          `);
        }
      });
    }
  
    /**
     * Horizontal Infinite Scrolling for Each Chat's Images
     */
    function attachHorizontalScrollListeners() {
      $('.chat-images-horizontal').off('scroll').on('scroll', function () {
        const $container = $(this);
        // If near the right edge, load more images
        if ($container[0].scrollWidth - $container.scrollLeft() <= $container.outerWidth() + 50) {
          const chatId = $container.data('chat-id');
          const currentImages = $container.find('.horizontal-image-wrapper').length;
  
          // Fetch more images for the chat (only if your backend supports offset/pagination)
          $.ajax({
            url: `/chats/${chatId}/images?skip=${currentImages}`,
            method: 'GET',
            xhrFields: {
                withCredentials: true
            },
            success: function (data) {
              let additionalImagesHtml = '';
  
              data.images.forEach((item, index) => {
                const isBlur = shouldBlurNSFW(item, subscriptionStatus);
                const isLiked = Array.isArray(item.likedBy)
                  ? item.likedBy.some(id => id.toString() === currentUserId.toString())
                  : false;
  
                additionalImagesHtml += `
                  <div class="image-card horizontal-image-wrapper col-12 col-md-4 col-lg-2 mb-2 px-1">
                    <div class="card shadow-0">
                      ${
                        isBlur
                          ? `
                            <div 
                              type="button" 
                              onclick="event.stopPropagation();handleClickRegisterOrPay(event,${isTemporary})"
                            >
                              <img 
                                data-src="${item.imageUrl}" 
                                class="card-img-top img-blur" 
                                style="object-fit: cover;"
                              >
                            </div>
                          `
                          : `
                            <a 
                              href="/character/slug/${item.chatSlug}?imageSlug=${item.slug}" 
                              class="text-muted text-decoration-none"
                            >
                              <img 
                                src="${item.imageUrl}" 
                                alt="${item.prompt}" 
                                class="card-img-top"
                              >
                            </a>
                            <div class="${
                              !isAdmin ? 'd-none' : ''
                            } card-body p-2 d-flex align-items-center justify-content-between">
                              <button 
                                class="btn btn-light image-nsfw-toggle ${
                                  !isAdmin ? 'd-none' : ''
                                } ${item.nsfw ? 'nsfw' : 'sfw'}" 
                                data-id="${item._id}"
                                onclick="toggleImageNSFW(this)"
                              >
                                <i class="bi ${
                                  item.nsfw ? 'bi-eye-slash-fill' : 'bi-eye-fill'
                                }"></i> 
                              </button>
                              <span 
                                class="btn btn-light float-end image-fav ${
                                  isLiked ? 'liked' : ''
                                }" 
                                data-id="${item._id}"
                                onclick="toggleImageFavorite(this)"
                              >
                                <i class="bi ${isLiked ? 'bi-heart-fill':'bi-heart'}" style="cursor: pointer;"></i>
                              </span>
                            </div>
                          `
                      }
                    </div>
                  </div>
                `;
              });
  
              $container.append(additionalImagesHtml);
  
              // Re-apply blur to newly added images
              $(document)
                .find('.img-blur')
                .each(function () {
                  blurImage(this);
                });
            },
            error: function (err) {
              console.error('Failed to load more images', err);
            }
          });
        }
      });
    }
  
    /**
     * Vertical Infinite Scroll for Chats
     */
    $(window).off('scroll.fetchChats').on('scroll.fetchChats', function () {
      if($('#all-chats-images-pagination-controls').length === 0) return;
      // Only trigger if the gallery and controls are both visible (not display:none and not opacity:0)
      const $gallery = $('#all-chats-container');
      const $controls = $('#all-chats-images-pagination-controls');
      if (!$gallery.is(':visible') || $gallery.css('opacity') === '0') return;
      if (!$controls.is(':visible') || $controls.css('opacity') === '0') return;
      const scrollTresold = $('#all-chats-images-pagination-controls').offset().top  - 1000;
      if (scrollTresold < $(window).scrollTop()) {
        fetchChatsWithImages(currentPageMap.get(currentActiveQuery) || 1, currentActiveQuery);
      }
    });

    /**
     * Initial Load
     */
    if (window.location.pathname.includes('/character')) {
      fetchChatsWithImages(currentPageMap.get(currentActiveQuery) || 1, currentActiveQuery);
    } 

    // Function to load and display query tags
    window.loadQueryTags = async function() {
        try {
            const lang = translations?.lang || 'en';
            const response = await fetch(`/api/query-tags?lang=${lang}`);
            if (!response.ok) throw new Error('Failed to fetch query tags');
            
            const data = await response.json();
            availableQueryTags = data.tags || [];
            
            displayQueryTags();
        } catch (error) {
            console.error('Error loading query tags:', error);
            // Hide the query tags section if loading fails
            $('.query-tags-section').hide();
        }
    };

    // Function to display query tags
    window.displayQueryTags = function() {
        const queryTagsList = $('#query-tags-list');
        
        if (!availableQueryTags.length) {
            $('.query-tags-section').hide();
            return;
        }
        
        let tagsHtml = '';
        
        // Add "All" tag first (active by default)
        tagsHtml += `
            <div class="query-tag query-tag-all badge badge-sm btn-primary active" 
                style="line-height: 1.5;"
                data-query="" 
                onclick="loadPopularChats(1, true); setActiveQuery(''); loadStyleFilteredChats('');">
                <i class="bi bi-grid me-1"></i>${translations.all || 'All'}
            </div>
        `;
        
        // Add "Recent Videos" button
        tagsHtml += `
            <div id="reload-latest-video-chats" class="d-none query-tag badge badge-sm btn-outline-primary" 
            style="line-height: 1.5;">
                <i class="bi bi-film me-1"></i>${translations.recentVideos || 'Recent Videos'}
            </div>
        `;
        

        // Add "Realistic" and "Anime" tags
        const specialTags = ['photorealistic', 'anime'];
        specialTags.forEach(tag => {
            const isActive = currentActiveQuery === tag;
            tagsHtml += `
                <div id="popular-chats-style-${tag}" 
                class="query-tag badge badge-sm btn-outline-primary ${isActive ? 'active' : ''}" 
                style="line-height: 1.5;"
                    data-query="${tag === 'photorealistic' ? 'photorealistic' : 'anime'}" 
                    >
                    #${tag == 'photorealistic' ? translations.photorealistic : translations.anime}
                </div>
            `;
        });
        
        // Add other query tags
        availableQueryTags = [] // Disable tags
        availableQueryTags.forEach(tag => {
            const isActive = currentActiveQuery === tag;
            tagsHtml += `
                <div class="query-tag badge badge-sm btn-outline-primary ${isActive ? 'active' : ''}" 
                    style="line-height: 1.5;"
                    data-query="${tag}" 
                    onclick="setActiveQueryAndSearch('${tag}')">
                    #${tag}
                </div>
            `;
        });
        
        queryTagsList.html(tagsHtml);
    };

    // Function to set active query and update UI only
    window.setActiveQuery = function(query) {
      currentActiveQuery = query;
      $('.query-tag').removeClass('active');
      $(`.query-tag[data-query="${query}"]`).addClass('active');
      // Replace outline class with filled
      $('.query-tag').removeClass('btn-primary').addClass('btn-outline-primary');
      $(`.query-tag[data-query="${query}"]`).removeClass('btn-outline-primary').addClass('btn-primary');
    };

    // Function to set active query and trigger search
    window.setActiveQueryAndSearch = function(query) {
      window.setActiveQuery(query);

      // Clear existing results
      $('#all-chats-container').empty();
      $('#all-chats-images-gallery').empty();
      $('#all-chats-images-pagination-controls').empty();

      // Reset pagination state
      if (typeof currentPageMap !== 'undefined') {
        currentPageMap.set(query, 0);
      }
      if (typeof allChatsLoadingState !== 'undefined') {
        allChatsLoadingState = false;
      }

      // Reset global flags
      isFetchingChats = false;
      hasMoreChatsMap.set(query, true);

      // Trigger new search with query
      if (query) {
        emptyAllGalleriesExcept('all-chats-container');
        fetchChatsWithImagesQuery(1, query);
      } else {
        if (typeof fetchChatsWithImages === 'function') {
          fetchChatsWithImages(1, '');
        }
      }
    };

    // Enhanced function to fetch chats with query support
    window.fetchChatsWithImagesQuery = function(page, query = '') {
          fetchChatsWithImages(page, query);
    };
    // Load query tags if we're on the character exploration page
    if ($('#query-tags-list').length > 0) {
      loadQueryTags();
    }
});
  
window.getLanguageName = function(langCode) {
    const langMap = {
        en: "english",
        fr: "french",
        ja: "japanese"
    };
    return langMap[langCode] || langCode || "english";
}

// Pagination logic simplified with loadingStates
function generateUserPostsPagination(totalPages) {
  if (typeof loadingStates === 'undefined') loadingStates = {};
  if (typeof currentPageMap === 'undefined') currentPageMap = {};

  if (typeof loadingStates['userPosts'] === 'undefined') loadingStates['userPosts'] = false;
  if (typeof currentPageMap['userPosts'] === 'undefined') currentPageMap['userPosts'] = 1;

  // Use namespaced event to avoid conflicts
  const eventName = 'scroll.userPostsPagination';
  $(window).off(eventName).on(eventName, function() {
    if (!loadingStates['userPosts'] && currentPageMap['userPosts'] < totalPages && $(window).scrollTop() + $(window).height() >= $(document).height() - 100) {
      loadingStates['userPosts'] = true;
      loadAllUserPosts(currentPageMap['userPosts'] + 1).then(() => {
        currentPageMap['userPosts']++;
        loadingStates['userPosts'] = false;
      }).catch(() => {
        loadingStates['userPosts'] = false;
      });
    }
  });

  if (currentPageMap['userPosts'] >= totalPages) {
    console.log('All Chats: No more pages to load.')
  } else {
    $('#user-posts-pagination-controls').html(
      '<div class="text-center"><div class="spinner-border" role="status"></div></div>'
    );
  }
}
function generateUserPostsPagination(userId, totalPages) {
  if (typeof loadingStates === 'undefined') loadingStates = {}; // Ensure the loadingStates object exists
  if (typeof currentPageMap === 'undefined') currentPageMap = {}; // Ensure the currentPageMap object exists

  if (typeof loadingStates[userId] === 'undefined') loadingStates[userId] = false;
  if (typeof currentPageMap[userId] === 'undefined') currentPageMap[userId] = 1; // Initialize the current page for the user

  // Use namespaced event to avoid conflicts
  const eventName = `scroll.userPostsPagination_${userId}`;
  $(window).off(eventName).on(eventName, function() {
    if (!loadingStates[userId] && currentPageMap[userId] < totalPages && $(window).scrollTop() + $(window).height() >= $(document).height() - 100) {
      loadingStates[userId] = true;
      loadAllUserPosts(currentPageMap[userId] + 1).then(() => {
        currentPageMap[userId]++; // Increment the page after successful loading
        loadingStates[userId] = false; // Reset the loading state
      }).catch(() => {
        // Handle errors if needed
        loadingStates[userId] = false;
      });
    }
  });

  // Display spinner if more pages are available, otherwise show a back-to-top button
  if (currentPageMap[userId] >= totalPages) {
    console.log('All User Posts: No more pages to load.')
  } else {
    $('#user-posts-pagination-controls').html(
      '<div class="text-center"><div class="spinner-border" role="status"></div></div>'
    );
  }
}

window.startCountdown = function() {
  return
  const countdownElements = $('.countdown-timer');
  let storedEndTime = localStorage.getItem('countdownEndTime');
  const now = Date.now();

  if (!storedEndTime) {
    storedEndTime = now + 30 * 60 * 1000;
    localStorage.setItem('countdownEndTime', storedEndTime);
  } else {
    storedEndTime = parseInt(storedEndTime);
  }

  countdownElements.each(function() {
    const element = $(this);
    const id = element.attr('id') || `countdown-${Math.random().toString(36).substr(2, 9)}`;
    element.attr('id', id);

    const interval = setInterval(() => updateCountdown(element, storedEndTime, interval), 10); // Update every 10ms
    updateCountdown(element, storedEndTime, interval);
  });
}

window.updateCountdown = function(element, endTime, interval) {
  const remaining = endTime - Date.now();

  if (remaining <= 0) {
    element.text('00:00.00');
    localStorage.removeItem('countdownEndTime');
    clearInterval(interval);
    loadPlanPage();
    return;
  }

  const minutes = Math.floor(remaining / (60 * 1000));
  const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
  const milliseconds = Math.floor((remaining % 1000) / 10); // Convert to two-digit milliseconds
  element.text(
    `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(2, '0')}`
  );
}


    // jQuery function to display tags
    function displayTags(imageStyle) {
      let tags;
      if (!tags || !tags.length) {
          $.get(`/api/tags`, function(response) {
          const totalPages = response.totalPages;
          const randomPage = Math.floor(Math.random() * totalPages) + 1; // Random page number between 1 and totalPages
          $.get(`/api/tags?page=${randomPage}`, function(response) {
              tags = response.tags;
              tags = tags.slice(0,30)
              renderTags(tags,imageStyle);
          });
          });
      } else {
          renderTags(tags,imageStyle);
      }
  }


  window.renderTags = function(tags, imageStyle) {
    $('#tags-container').empty();
    
    if (!tags.length) {
      $('#tags-container').html('');
      $('.tag-list-container').hide();
      return;
    }
    $('.tag-list-container').show();
    tags = tags.filter(tag => tag !== '');
    const html = `
      <div class="tags-wrapper py-2">
        <div class="tags-cloud d-flex flex-wrap gap-2 justify-content-center">
          ${tags.map(tag => 
            `<a href="/search?q=${encodeURIComponent(tag)}" 
                class="tag-item px-3 py-2 rounded-pill text-decoration-none"
                data-tag="${tag}">
                #${tag}
             </a>`
          ).join('')}
        </div>
      </div>`;
    $('#tags-container').html(html);
    
  }

// Object to manage modal loading status
const modalStatus = {
    isSettingsLoading: false,
    isCharacterCreationLoading: false,
    isPlanLoading: false,
    isCharacterModalLoading: false,
    isLoginLoading: false
};

// Function to close any opened modal
window.closeAllModals = function() {
    const modals = ['characterUpdateModal', 'settingsModal', 'characterCreationModal', 'planUpgradeModal', 'characterModal', 'loginModal', 'characterIntroModal'];
    modals.forEach(modalId => {
        const modalElement = document.getElementById(modalId);
        if (modalElement) {
            const modalInstance = bootstrap.Modal.getInstance(modalElement);
            if (modalInstance) {
                modalInstance.hide();
            }
        }
    });

}
// Function to load character update page & execute scripts & open #characterUpdateModal
function loadCharacterUpdatePage(chatId, event = null) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!chatId) {
        showNotification('Invalid character ID', 'error');
        return;
    }
    // Set the chatId in the cookie for access in the modal
    $.cookie('character-update-id', chatId, { path: '/' });
    // Add an event listener to the modal close event to remove the cookie
    $('#characterUpdateModal').on('hidden.bs.modal', function () {
        $.removeCookie('character-update-id', { path: '/' });
    });
    if (modalStatus.isCharacterUpdateLoading) return;
    modalStatus.isCharacterUpdateLoading = true;

    closeAllModals();

    const characterUpdateModal = new bootstrap.Modal(document.getElementById('characterUpdateModal'));
    $('#character-update-container').html('<div class="position-absolute d-flex justify-content-center align-items-center" style="inset:0;"><div class="spinner-border" role="status"></div></div>');
    characterUpdateModal.show();

    $.ajax({
        url: `/character-update/${chatId}`,
        method: 'GET',
        xhrFields: {
            withCredentials: true
        },
        success: function(data) {
            $('#character-update-container').html(data);
            
            // Load CSS
            const cssLink = document.createElement('link');
            cssLink.rel = 'stylesheet';
            cssLink.href = '/css/character-update.css';
            document.head.appendChild(cssLink);
            
            // Load the character update script
            const script = document.createElement('script');
            script.src = '/js/character-update.js';
            script.onload = function() {
                modalStatus.isCharacterUpdateLoading = false;
                // Initialize the character update functionality
                if (typeof window.initCharacterUpdate === 'function') {
                    window.initCharacterUpdate(chatId);
                }
            };
            script.onerror = function() {
                console.error('Failed to load character-update.js script.');
                modalStatus.isCharacterUpdateLoading = false;
            };
            document.body.appendChild(script);
        },
        error: function(err) {
            console.error('Failed to load character update page', err);
            modalStatus.isCharacterUpdateLoading = false;
        }
    });
}

// Expose the function globally
window.openCharacterUpdateModal = function(chatId) {
    loadCharacterUpdatePage(chatId);
};

// Function to load settings page & execute script settings.js & open #settingsModal
function loadSettingsPage() {
    if (modalStatus.isSettingsLoading) return;
    modalStatus.isSettingsLoading = true;

    closeAllModals();

    const settingsModal = new bootstrap.Modal(document.getElementById('settingsModal'));
    $('#settings-container').html('<div class="position-absolute d-flex justify-content-center align-items-center" style="inset:0;"><div class="spinner-border" role="status"></div></div>');
    settingsModal.show();

    $.ajax({
        url: '/settings',
        method: 'GET',
        xhrFields: {
            withCredentials: true
        },
        success: function(data) {
            $('#settings-container').html(data);
            const script = document.createElement('script');
            script.src = '/js/settings.js';
            script.onload = function() {
                modalStatus.isSettingsLoading = false;
            };
            script.onerror = function() {
                console.error('Failed to load settings.js script.');
                modalStatus.isSettingsLoading = false;
            };
            document.body.appendChild(script);
        },
        error: function(err) {
            console.error('Failed to load settings page', err);
            modalStatus.isSettingsLoading = false;
        }
    });
}


// Function to load character creation page & execute scripts & open #characterCreationModal

function loadCharacterCreationPage(chatId) {
    if (modalStatus.isCharacterCreationLoading) return;
    modalStatus.isCharacterCreationLoading = true;

    closeAllModals();

    const characterCreationModal = new bootstrap.Modal(document.getElementById('characterCreationModal'));
    $('#character-creation-container').html('<div class="position-absolute d-flex justify-content-center align-items-center" style="inset:0;"><div class="spinner-border" role="status"></div></div>');
    characterCreationModal.show();
    
    
    let redirectUrl = '/chat/edit/';
    if (chatId) {
        redirectUrl += chatId;
    }

    $.ajax({
        url: redirectUrl,
        method: 'GET',
        xhrFields: {
            withCredentials: true
        },
        success: function(data) {
            if(!data){
              characterCreationModal.hide();
              modalStatus.isCharacterCreationLoading = false;
              loadPlanPage();
              return;
            } else {
              // On close refresh the page after 1second
              $('#characterCreationModal').on('hidden.bs.modal', function () {
                setTimeout(() => {
                    //location.reload();
                }, 1000);
              });
            }
            
            // Set the modal content first
            $('#character-creation-container').html(data);

                // Load CSS files first
                const cssPromises = [];
                
                // Load image uploader CSS
                const imageUploaderCSS = new Promise((resolve) => {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = '/css/image-uploader.css';
                    link.onload = resolve;
                    link.onerror = (err) => {
                        console.error('Failed to load /css/image-uploader.css', err);
                        resolve(); // Continue even if CSS fails
                    };                    
                    document.head.appendChild(link);
                });
                cssPromises.push(imageUploaderCSS);
                
                // Load character creation CSS
                const characterCreationCSS = new Promise((resolve) => {
                    const ccLink = document.createElement('link');
                    ccLink.rel = 'stylesheet';
                    ccLink.href = '/css/character-creation.css';
                    ccLink.onload = resolve;
                    ccLink.onerror = (err) => {
                        console.error('Failed to load /css/character-creation.css', err);
                        resolve(); // Continue even if CSS fails
                    };
                    document.head.appendChild(ccLink);
                });
                cssPromises.push(characterCreationCSS);

                // Wait for CSS to load, then load scripts in order
                Promise.all(cssPromises).then(() => {
                    // Additional delay to ensure DOM is fully rendered
                    setTimeout(() => {
                        // Load image uploader script first
                        const imageUploaderScript = document.createElement('script');
                        imageUploaderScript.src = '/js/image-uploader.js';
                        
                        imageUploaderScript.onload = function() {
                            // Wait for image uploader to initialize, then load character creation script
                            setTimeout(() => {
                                const characterCreationScript = document.createElement('script');
                                characterCreationScript.src = '/js/character-creation.js';
                                characterCreationScript.onload = function() {
                                    modalStatus.isCharacterCreationLoading = false;
                                    // Optionally, you can initialize something here
                                };
                                characterCreationScript.onerror = function() {
                                    console.error('Failed to load character-creation.js script.');
                                    modalStatus.isCharacterCreationLoading = false;
                                };
                                document.body.appendChild(characterCreationScript);
                            }, 200);
                        };
                        
                        imageUploaderScript.onerror = function() {
                          console.error('Failed to load image-uploader.js script.');
                          modalStatus.isCharacterCreationLoading = false;
                        };

                        const civitaiModelSearchScript = document.createElement('script');
                        civitaiModelSearchScript.src = '/js/civitai-model-search.js';
                        civitaiModelSearchScript.onload = function() {
                          // Additional logic if needed after civitai-model-search.js loads
                        };
                        civitaiModelSearchScript.onerror = function() {
                          console.error('Failed to load civitai-model-search.js script.');
                        };
                        document.body.appendChild(civitaiModelSearchScript);
                        
                        document.body.appendChild(imageUploaderScript);
                    }, 300); // Additional delay for DOM rendering
                });
        },
        error: function(err) {
            console.error('Failed to load character creation page', err);
            modalStatus.isCharacterCreationLoading = false;
            characterCreationModal.hide();
        }
    });
}

// Load the plan page and open the modal
function loadPlanPage(trackingSource) {
    if(!user || isTemporary) {
      console.log('User is not logged in or is temporary, aborting loadPlanPage.');
      openLoginForm();
      return;
    }
    if (modalStatus.isPlanLoading) {
      return;
    }
    modalStatus.isPlanLoading = true;

    // Track premium view event
    if (typeof UserTracking !== 'undefined') {
      const source = trackingSource || UserTracking.detectPremiumViewSource();
      UserTracking.trackPremiumView(source, { triggerAction: 'loadPlanPage' });
    }

    closeAllModals();

    const planModal = new bootstrap.Modal(document.getElementById('planUpgradeModal'));
    $('#plan-container').html('<div class="position-absolute d-flex justify-content-center align-items-center" style="inset:0;"><div class="spinner-border" role="status"></div></div>');
    planModal.show();

    $.ajax({
        url: '/my-plan',
        method: 'GET',
        xhrFields: {
            withCredentials: true
        },
        success: function(data) {
            $('#plan-container').html(data);
            const script = document.createElement('script');
            script.src = '/js/plan.js';
            script.onload = function() {
                modalStatus.isPlanLoading = false;
            };
            script.onerror = function() {
                console.error('Failed to load plan.js script.');
                modalStatus.isPlanLoading = false;
            };
            document.body.appendChild(script);
        },
        error: function(err) {
            console.error('Failed to load plan page', err);
            modalStatus.isPlanLoading = false;
        }
    });
}
// Load the plan page and open the modal
function loadAffiliationPlanPage() {
    if(!user || isTemporary) {
      console.log('User is not logged in or is temporary, aborting loadPlanPage.');
      return;
    }
    if (modalStatus.isPlanLoading) {
      return;
    }
    modalStatus.isPlanLoading = true;

    closeAllModals();

    const affiliationModal = new bootstrap.Modal(document.getElementById('affiliationModal'));
    $('#affiliation-container').html('<div class="position-absolute d-flex justify-content-center align-items-center" style="inset:0;"><div class="spinner-border" role="status"></div></div>');
    affiliationModal.show();

    $.ajax({
        url: '/affiliation-plan',
        method: 'GET',
        xhrFields: {
            withCredentials: true
        },
        success: function(data) {
            $('#affiliation-container').html(data);
            const script = document.createElement('script');
            script.src = '/js/plan.js';
            script.onload = function() {
                modalStatus.isPlanLoading = false;
            };
            script.onerror = function() {
                console.error('Failed to load plan.js script.');
                modalStatus.isPlanLoading = false;
            };
            document.body.appendChild(script);
        },
        error: function(err) {
            console.error('Failed to load plan page', err);
            modalStatus.isPlanLoading = false;
        }
    });
}

// Open /character/:id?modal=true to show the character modal
function openCharacterModal(modalChatId, event) {
    event.stopPropagation();
    event.preventDefault(); 
    if (modalStatus.isCharacterModalLoading) return;
    modalStatus.isCharacterModalLoading = true;

    closeAllModals();

    const characterModal = new bootstrap.Modal(document.getElementById('characterModal'));
    $('#character-modal-container').html('<div class="d-flex justify-content-center align-items-center w-100" style="min-height:200px;"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div></div>');
    characterModal.show();

    const url = `/character/${modalChatId}?modal=true`;
    $.ajax({
        url: url,
        method: 'GET',
        xhrFields: {
            withCredentials: true
        },
        success: function(data) {
            $('#character-modal-container').html(data);
            $(document).ready(function () {
                if (modalChatId) {
                    // Clear any existing cache and loading states for this modal context
                    const cacheKey = `chat_${modalChatId}`;
                    const manager = window.chatImageManager;
                    
                    // Reset loading state to prevent duplicate request detection
                    manager.loadingStates.set(cacheKey, false);
                    
                    // Load images with proper reload
                    loadChatImages(modalChatId, 1, true, true);
                }
            });
            modalStatus.isCharacterModalLoading = false;
        },
        error: function(err) {
            console.error('Failed to open character modal', err);
            modalStatus.isCharacterModalLoading = false;
        }
    });
}

// Function to open the Clerk user profile page
window.openUserProfile = function() {
  if (window.Clerk) {
    window.Clerk.openUserProfile();
  } else {
    console.error('Clerk is not initialized');
  }
};

window.handleClickRegisterOrPay = function(event = null , isTemporary) {
  if (event) event.preventDefault();
  const subscribed = window.user && window.user.subscriptionStatus === 'active';
  if (isTemporary) {
      openLoginForm();
  } else if (subscribed) {
    return;
  } else {
      loadPlanPage();
  }
}

window.updatePromptActivatedCounter = function() {
  
  const $prompts = $('.prompt-card');
  
  const total = $prompts.length;
  const activated = $prompts.filter('.active').length;
  
  $('#prompt-activated-counter').html(`<span class="badge custom-gradient-bg">${activated}/${total}</>`);
}

  // Function to update the UI when a specific custom prompt is activated
  // This is typically called via a WebSocket notification
  window.updateCustomPrompt = function(promptId) { 
    const $promptCard = $(`.prompt-card[data-id="${promptId}"]`);
    if ($promptCard.length) {
        // Find the next prompt-card after the current one
        const $nextPrompt = $promptCard.next('.prompt-card');
        if ($nextPrompt.length) {
            $nextPrompt.addClass('active').removeClass('inactive');
            showNotification(translations['promptCardActivated'], 'success');
        } else {
            console.warn(`No next prompt-card found after promptId ${promptId}.`);
        }
    } else {
        console.warn(`Prompt card with ID ${promptId} not found to update active state.`);
    }

    updatePromptActivatedCounter();
};

window.updateImageTitle = function(imageId, localizedTitle) {
  console.log(`[updateImageTitle] Updating image card with ID ${imageId} to title: ${localizedTitle}`);
  if ($('#about_image').length) {
    $('#about_image').text(localizedTitle);
  } else {
    console.warn(`Image card with ID ${imageId} not found to update title.`);
  }
};
// Helper function to determine NSFW display behavior
window.shouldBlurNSFW = function(item, subscriptionStatus) {
  if (!item?.nsfw) return false; // Not NSFW, don't blur
  
  const showNSFW = sessionStorage.getItem('showNSFW') === 'true';
  
  // If user has subscription, respect their showNSFW preference
  if (subscriptionStatus) {
    return !showNSFW; // Blur only if showNSFW is false
  }
  
  // If no subscription, always blur NSFW content regardless of showNSFW setting
  return true;
};

// Enhanced function to determine NSFW display behavior with overlay option
window.getNSFWDisplayMode = function(item, subscriptionStatus) {
  if (!item?.nsfw) return 'show'; // Not NSFW, show normally
  
  const showNSFW = sessionStorage.getItem('showNSFW') === 'true';
  
  if (subscriptionStatus) {
    return showNSFW ? 'show' : 'overlay'; // Show with overlay if showNSFW is false
  }
  
  return 'blur'; // No subscription, blur the content
};

window.showNSFWContent = function(buttonElement, imageUrl) {
    const $button = $(buttonElement);
    const $overlay = $button.closest('.gallery-nsfw-overlay');
    const $imageContainer = $overlay.closest('.assistant-image-box');
    const $image = $imageContainer.find('img');
    const imageId = $image.attr('data-id');
    const $imageTools = $(document).find(`.image-tools[data-id="${imageId}"]`);

    // Set the original image source and remove blur
    $image.attr('src', imageUrl).removeClass('img-blur');
    $imageContainer.removeClass('isBlurred');
    
    // Remove the overlay with animation
    $overlay.hide().removeClass('d-flex');

    // Display the image tools
    $imageTools.show();
};

// .toggle-nsfw-btn click handler
$(document).on('click', '.toggle-nsfw-btn', function() {
  const subscriptionStatus = window.user ? window.user.subscriptionStatus === 'active' : false;
  if(isTemporary || !subscriptionStatus) {
    loadPlanPage();
    return;
  }
  toggleNSFWContent();
  window.location.reload();
});
// .toggle-nsfw-btn-chat
$(document).on('click', '.toggle-nsfw-btn-chat', function() {
  const subscriptionStatus = window.user ? window.user.subscriptionStatus === 'active' : false;
  if(isTemporary || !subscriptionStatus) {
    loadPlanPage();
    return;
  }
  toggleNSFWContent();
  reloadCurrentChat();
});

const modals = document.querySelectorAll('.modal');
modals.forEach(m => {
  m.addEventListener('hide.bs.modal', e => {
    m.querySelector('.modal-dialog').classList.add('modal-out');
  });
  m.addEventListener('hidden.bs.modal', e => {
    m.querySelector('.modal-dialog').classList.remove('modal-out');
  });
});
