const displayedMessageIds = new Set();
const displayedImageIds = new Set();
const displayedImageUrls = new Set();
const displayedVideoIds = new Set();

// Track thumb nav gallery loading state by userChatId
let thumbNavGalleryLoadedUserChatId = null;
let thumbNavGalleryLoading = false;
const thumbNavGalleryImageIds = new Set();

/**
 * Helper function to attach event listeners to image tools containers
 * to prevent swiper from capturing touch/mouse events when scrolling tools
 * @param {HTMLElement} swiperElement - The swiper container element
 */
function attachImageToolsEventListeners(swiperElement) {
    const imageToolsContainers = swiperElement.querySelectorAll('.image-tools');
    imageToolsContainers.forEach(toolsContainer => {
        // Prevent swiper from capturing touch events on image tools
        toolsContainer.addEventListener('touchstart', function(e) {
            e.stopPropagation();
        }, { passive: true });
        
        toolsContainer.addEventListener('touchmove', function(e) {
            e.stopPropagation();
        }, { passive: true });
        
        // Also handle mouse events for desktop
        toolsContainer.addEventListener('mousedown', function(e) {
            e.stopPropagation();
        });
        
        toolsContainer.addEventListener('mousemove', function(e) {
            e.stopPropagation();
        });
    });
}

let language

/**
 * Get user's preferred chat language
 * Priority: userChat.preferredChatLanguage > chatToolSettings > user.preferredChatLanguage > user.lang
 * @param {Object} userChatData - Optional userChat object with preferredChatLanguage field
 * @returns {string} Language name (e.g., 'english', 'japanese', 'french')
 */
function getPreferredLanguage(userChatData = null) {
    // First priority: userChat's preferredChatLanguage (stored per chat session)
    if (userChatData?.preferredChatLanguage) {
        return getLanguageName(userChatData.preferredChatLanguage) || userChatData.preferredChatLanguage;
    }
    
    // Second priority: chatToolSettings (if loaded)
    const settingsLang = window.chatToolSettings?.getPreferredChatLanguage?.();
    if (settingsLang) {
        return getLanguageName(settingsLang) || settingsLang;
    }
    
    // Third priority: user's preferredChatLanguage (set during onboarding or settings)
    if (window.user?.preferredChatLanguage) {
        return getLanguageName(window.user.preferredChatLanguage) || window.user.preferredChatLanguage;
    }
    
    // Fall back to user.lang, then global lang, then default to 'ja'
    return getLanguageName(window.user?.lang) || getLanguageName(window.lang) || getLanguageName('ja');
}

// Expose getPreferredLanguage globally so it can be called after settings updates
window.getPreferredLanguage = getPreferredLanguage;

// Listen for settings updates to refresh the language
document.addEventListener('chatSettingsUpdated', function(e) {
    if (e.detail?.preferredChatLanguage) {
        language = getPreferredLanguage();
        $('#language').val(language);
    }
});

function getIdFromUrl(url) {
    if(!url){return null}
    var regex = /\/chat\/([a-zA-Z0-9]+)/;
    var match = url.match(regex);
    if (match && match[1]) {
        return match[1];
    } else {
        return null;
    }
}

let chatId = getIdFromUrl(window.location.href) 
    || sessionStorage.getItem('lastChatId') 
    || getIdFromUrl($.cookie('redirect_url')) 

// Ensure chatId is not a falsy string (e.g., '', null, undefined, 'null', 'undefined')
if (!chatId || chatId === 'null' || chatId === 'undefined') {
    chatId = null;
}

let userChatId = sessionStorage.getItem('userChatId');
let persona;
let isNew = true;

// Listen for persona added event from PersonaModule
window.onPersonaAdded = function(personaObj) {
    persona = {
        name: personaObj.name,
        id: personaObj.id,
        chatImageUrl: personaObj.chatImageUrl
    };
    isNew = !isNew;
    
    // Add a new message to the chat container
    addMessageToChat(chatId, userChatId, {
        role: 'user',
        message: `I updated my Persona to "${persona.name}".`,
        name: 'persona',
        hidden: true
    }, function(error, res) {

        generateChatCompletion();

        if (error) {
            console.error('Error adding persona message:', error);
        }
    });
};
// On close of the persona module check if the chat is new
window.onPersonaModuleClose = function() {
    if (isNew) {
        generateChatCompletion();
        isNew = false;
    }
};
window.thumbnail = false
$(document).ready(async function() {
    let currentStep = 0;
    let totalSteps = 0;
    let chatData = {};
    let character = {}
    let feedback = false
    let isTemporary = !!user.isTemporary

    language = getPreferredLanguage();
    $('#language').val(language)

    $('body').attr('data-temporary-user',isTemporary)

    window.addEventListener('message', function(event) {
        if (event.data.event === 'displayMessage') {
            const { role, message, completion, image, messageId } = event.data
            displayMessage(role, message, userChatId, function() {
                addMessageToChat(chatId, userChatId, {role, message}, function(error, res) {
                    const messageContainer = $(`#chatContainer[data-id=${userChatId}]`)
                    if (error) {
                        console.error('Error adding message:', error);
                    } else {
                        if(completion){
                            generateChatCompletion();
                        }
                        if(image && messageId){
                            const loaderElement = $(`
                                <div id="${messageId}" class="d-flex flex-row justify-content-start mb-4 message-container assistant animate__animated animate__fadeIn">
                                    <img src="${thumbnail || '/img/default-avatar.png'}" alt="avatar" class="rounded-circle chatbot-image-chat" data-id="${chatId}" style="width: 45px; height: 45px; object-fit: cover; object-position: top;" onclick="openCharacterInfoModal('${chatId}', event)">
                                    <div class="load d-flex justify-content-center align-items-center px-3">
                                        <img src="/img/image-placeholder.gif" width="50px" alt="loading">
                                    </div>
                                </div>
                            `);
                            messageContainer.append(loaderElement);
                        }
                    }
                });
            });
        }
    });
    window.addEventListener('message', function(event) {
        if (event.data.event === 'addMessageToChat') {
            const message = event.data.message
            const role = event.data.role || 'user'
            const completion = event.data.completion
            if(!message)return
            addMessageToChat(chatId, userChatId, {role, message},function(){
                if(completion){
                    generateChatCompletion()
                }
            });
        }
    });
    window.addEventListener('message', function(event) {
        if (event.data.event === 'fetchChatData') {
            const fetch_chatId = event.data.chatId
            const fetch_userId = event.data.userId
            const fetch_reset = event.data.reset
            fetchChatData(fetch_chatId, fetch_userId, fetch_reset,function(){ 
                $(`#spinner-${fetch_chatId}`).removeClass('on').hide()
            });
        }
    });
    let count_proposal = 0
    const subscriptionStatus = user.subscriptionStatus == 'active'

    $('.is-free-user').each(function(){if(!subscriptionStatus && !isTemporary)$(this).show()})

    // Helper function to check if scenarios should be generated and displayed
    // For NEW chats, we ALWAYS generate scenarios on first load
    window.shouldGenerateScenariosUI = async function(userChatId) {
        try {
            // Fetch the chat data to check if scenario has already been selected
            const response = await fetch(`/api/chat-scenarios/${userChatId}`);
            const data = await response.json();
            
            // Show scenarios if:
            // 1. No scenario has been selected yet (currentScenario is null) - this is a new chat
            // Even if availableScenarios are empty, we'll generate them
            const hasNoScenarioSelected = !data.currentScenario;
            
            return hasNoScenarioSelected; // Return true for NEW chats to generate scenarios
        } catch (error) {
            console.error('[shouldGenerateScenariosUI] Error checking scenarios:', error);
            return false;
        }
    };

    window.fetchChatData = async function(fetch_chatId, fetch_userId, fetch_reset, callback) {
        const lastUserChat = await getUserChatHistory(fetch_chatId);
        fetch_chatId = lastUserChat ?.chatId || fetch_chatId
        chatId = fetch_chatId
        userChatId = lastUserChat ?._id || userChatId;

        $('.new-chat').data('id',fetch_chatId).fadeIn()
        sessionStorage.setItem('lastChatId', fetch_chatId);
        sessionStorage.setItem('chatId', fetch_chatId);
        sessionStorage.setItem('userChatId', userChatId);

        // Reset the goals widget for the new chat
        if (window.liveGoalsWidget) {
            window.liveGoalsWidget.resetWidget();
        }

        count_proposal = 0;
        
        $('#chatContainer').empty();
        $('#suggestions').empty();
        $('#startButtonContained').remove();
        $('#chat-thumbnail-gallery').empty();

        // Reset thumb nav gallery loading state for new chat
        thumbNavGalleryLoadedUserChatId = null;
        thumbNavGalleryLoading = false;
        thumbNavGalleryImageIds.clear();

        // Reset auto-background state for new chat
        if (typeof window.resetAutoBackgroundState === 'function') {
            window.resetAutoBackgroundState();
        }

        postChatData(fetch_chatId, fetch_userId, userChatId, fetch_reset, callback);
    }
    
    window.postChatData = function(fetch_chatId, fetch_userId, userChatId, fetch_reset, callback) {
        
        $('#chatContainer').empty();
        $('#startButtonContained').remove();
        $('#chat-thumbnail-gallery').empty();

        // Reset thumb nav gallery loading state for new chat
        thumbNavGalleryLoadedUserChatId = null;
        thumbNavGalleryLoading = false;
        thumbNavGalleryImageIds.clear();
        $.ajax({
            url: `${API_URL}/api/chat/`,
            type: 'POST',
            dataType: 'json',
            contentType: 'application/json',
            data: JSON.stringify({ userId: fetch_userId, chatId: fetch_chatId, userChatId }),
            success: function(data) {
                handleChatSuccess(data, fetch_reset, fetch_userId, userChatId);
            },
            error: function(xhr, status, error) {
                showDiscovery();
            },
            complete: function(xhr, status) {
                if (typeof callback === 'function') {
                    callback();
                }
            }
        });
    }            

    if(chatId){
        fetchChatData(chatId, userId);
    }else{
        showDiscovery();
    }
    
    $('textarea').each(function() {
        $(this).on('input change keypress', function(e) {
            if (e.type === 'keypress' && e.which !== 13) {
                return;
            }
        });
    });
    
    $('#sendMessage').on('click', function() {
        sendMessage();
    });

    $('#sendImageMessage').on('click', function() {
        sendImageMessage();
    });

    // Event handler for the Enter key
    $('#userMessage').on('keypress', function(event) {
        if (event.which == 13 && !event.shiftKey) { 
            sendMessage();
        }
    });     

    function updateParameters(newchatId, newuserId, userChatId){

        if(chatId){ 
            localStorage.setItem('chatId', chatId);
            sessionStorage.setItem('chatId', chatId);}
        if(userChatId){
            localStorage.setItem('userChatId', userChatId);
            sessionStorage.setItem('userChatId', userChatId);
            $('#chatContainer').attr('data-id',userChatId)
        }

        var currentUrl = window.location.href;
        var urlParts = currentUrl.split('/');
        urlParts[urlParts.length - 1] = newchatId;
        var newUrl = urlParts.join('/');

        const elementsToUpdate = ['.content .chart-button', '.content .tag-button', '.content .delete-chat'];
        elementsToUpdate.forEach(selector => {
            $(selector).each(function() {
                $(this).attr('data-id', chatId);
            });
        });
        $('.edit-chat').each(function(){
            $(this).attr('href','/chat/edit/'+newchatId)
        })
    }
    window.sendImageMessage = function(customMessage, displayStatus = true) {
        sendMessage(customMessage, displayStatus, true);
    }
    window.sendMessage = function(customMessage, displayStatus = true, image_request = false) {
        
        if (window.promptManager) {
            window.promptManager.hide();
        }
         // Hide suggestions when user sends manual message
        if (window.chatSuggestionsManager) {
            window.chatSuggestionsManager.hide();
        }
        
        // Trigger custom event
        $(document).trigger('chat:messageSent');
        
        $('#startButtonContained, #introChat').hide();
        $('#gen-ideas').removeClass('done');
        
    
        const cleanup = () => {
            setTimeout(() => {
                $('#userMessage').val('')
                    .attr('placeholder', window.translations.sendMessage);
            }, 0);
        };
    
        const message = customMessage || $('#userMessage').val();
        let finalMessage = message;
    
        if (finalMessage.trim() !== '') {
            if (displayStatus) displayMessage('user', message, userChatId);
            $('#userMessage').val('');
            addMessageToChat(chatId, userChatId, { role: 'user', message: finalMessage, image_request }, () => {
                generateChatCompletion(null, true);
            });
        }
        cleanup();
    };    

    $(document).on('click','#unlock-result',function(){
        promptForEmail()
    })

    async function checkBackgroundTasks(chatId, userChatId) {
        try {
            // Check image generation tasks
            const response = await fetch(`/api/background-tasks/${userChatId}`);
            const data = await response.json();
            
            if (data.tasks && data.tasks.length > 0) {
                data.tasks.forEach(task => {
                    if (task.status === 'pending' || task.status === 'processing' || task.status === 'background') {
                        // Display placeholder for background task
                        displayBackgroundTaskPlaceholder(task);
                        
                        // Start fallback polling for this task
                        // Note: Webhooks trigger WebSocket notifications for completion,
                        // so polling is only a fallback if WebSocket fails or is delayed
                        pollBackgroundTask(task.taskId, task.placeholderId);
                    }
                });
            }

            // Check video generation tasks
            const videoResponse = await fetch(`/api/background-video-tasks/${userChatId}`);
            const videoData = await videoResponse.json();
            
            if (videoData.tasks && videoData.tasks.length > 0) {
                videoData.tasks.forEach(task => {
                    if (task.status === 'pending' || task.status === 'processing' || task.status === 'background') {
                        // Display placeholder for background video task
                        displayVideoLoader(task.placeholderId, task.imageId);
                        
                        // Note: No polling needed here since backend handles it via WebSocket
                        console.log(`Background video task found: ${task.taskId}, loader displayed`);
                    }
                });
            }
        } catch (error) {
            console.error('Error checking background tasks:', error);
        }
    }

    function displayBackgroundTaskPlaceholder(task) {
        const placeholderId = task.placeholderId;
        
        // Check if custom prompt was used
        if (task.customPromptId) {
            // Get the custom prompt image preview
            const promptCard = $(`.prompt-card[data-id="${task.customPromptId}"]`);
            if (promptCard.length > 0) {
                const imagePreview = promptCard.find('img').attr('data-src') || promptCard.find('img').attr('src');
                displayOrRemoveImageLoader(placeholderId, 'show', imagePreview);
            } else {
                displayOrRemoveImageLoader(placeholderId, 'show');
            }
        } else {
            displayOrRemoveImageLoader(placeholderId, 'show');
        }
    }

    // Store active polling intervals to allow cleanup if WebSocket completes first
    const activePollIntervals = new Map();
    
    async function pollBackgroundTask(taskId, placeholderId) {
        // Check if WebSocket already completed this task (check for loader removal)
        const loaderElement = $(`.image-loader[data-placeholder-id="${placeholderId}"]`);
        if (loaderElement.length === 0) {
            // Loader already removed by WebSocket, no need to poll
            console.log(`[pollBackgroundTask] Task ${taskId} already completed via WebSocket, skipping poll`);
            return;
        }
        
        let pollCount = 0;
        const maxPolls = 24; // Max 24 polls = 2 minutes (5s * 24)
        const pollInterval = 5000; // 5 seconds
        
        const intervalId = setInterval(async () => {
            pollCount++;
            
            // Check if WebSocket already handled this (loader removed)
            const currentLoader = $(`.image-loader[data-placeholder-id="${placeholderId}"]`);
            if (currentLoader.length === 0) {
                console.log(`[pollBackgroundTask] Task ${taskId} completed via WebSocket during poll, stopping poll`);
                clearInterval(intervalId);
                activePollIntervals.delete(taskId);
                return;
            }
            
            // Timeout after max polls (fallback safety net)
            if (pollCount >= maxPolls) {
                console.warn(`[pollBackgroundTask] Task ${taskId} polling timeout after ${maxPolls} attempts`);
                clearInterval(intervalId);
                activePollIntervals.delete(taskId);
                // Don't remove loader - let WebSocket handle it when it arrives
                return;
            }
            
            try {
                const response = await fetch(`/api/task-status/${taskId}`);
                const taskStatus = await response.json();
                
                if (taskStatus.status === 'completed') {
                    clearInterval(intervalId);
                    activePollIntervals.delete(taskId);
                    
                    // Double-check WebSocket didn't already handle this
                    const finalLoader = $(`.image-loader[data-placeholder-id="${placeholderId}"]`);
                    if (finalLoader.length === 0) {
                        console.log(`[pollBackgroundTask] Task ${taskId} already handled by WebSocket, skipping display`);
                        return;
                    }
                    
                    displayOrRemoveImageLoader(placeholderId, 'remove');
                    
                    // Display the completed images (fallback if WebSocket missed it)
                    if (taskStatus.images && taskStatus.images.length > 0) {
                        console.log(`[pollBackgroundTask] Fallback: Displaying ${taskStatus.images.length} images for task ${taskId}`);
                        taskStatus.images.forEach(image => {
                            window.parent.postMessage({
                                event: 'imageGenerated',
                                imageUrl: image.imageUrl,
                                imageId: image.imageId,
                                userChatId: taskStatus.userChatId,
                                title: image.title,
                                prompt: image.prompt,
                                nsfw: image.nsfw
                            }, '*');
                        });
                    }
                } else if (taskStatus.status === 'failed') {
                    clearInterval(intervalId);
                    activePollIntervals.delete(taskId);
                    displayOrRemoveImageLoader(placeholderId, 'remove');
                    showNotification(window.translations.image_generation_failed || 'Image generation failed', 'error');
                }
            } catch (error) {
                console.error(`[pollBackgroundTask] Error polling task ${taskId}:`, error);
                // Don't clear on single error - continue polling as fallback
                if (pollCount >= maxPolls) {
                    clearInterval(intervalId);
                    activePollIntervals.delete(taskId);
                }
            }
        }, pollInterval);
        
        activePollIntervals.set(taskId, intervalId);
        console.log(`[pollBackgroundTask] Started fallback polling for task ${taskId} (max ${maxPolls} attempts, ${pollInterval/1000}s interval)`);
    }
    
    // Helper to stop polling if WebSocket completes the task
    function stopPollingForTask(taskId) {
        if (activePollIntervals.has(taskId)) {
            clearInterval(activePollIntervals.get(taskId));
            activePollIntervals.delete(taskId);
            console.log(`[stopPollingForTask] Stopped polling for task ${taskId} (completed via WebSocket)`);
        }
    }

    async function handleChatSuccess(data, fetch_reset, fetch_userId, userChatId) {
        logChatDataFetch(data);
        
        $(document).find(`.chat-list.item[data-id="${chatId}"]`).addClass('active').siblings().removeClass('active');
        // Handle fetch_reset and isNew logic robustly

        isNew = (typeof fetch_reset === 'string' ? fetch_reset.toLowerCase() : fetch_reset) === true || 
            (typeof fetch_reset === 'string' ? fetch_reset.toLowerCase() : fetch_reset) === 'true'
            ? true
            : (typeof fetch_reset === 'string' ? fetch_reset.toLowerCase() : fetch_reset) === false || 
              (typeof fetch_reset === 'string' ? fetch_reset.toLowerCase() : fetch_reset) === 'false'
            ? false
            : typeof data.isNew !== 'undefined'
            ? data.isNew
            : true;

        if (!data.chat) {
            showDiscovery();
            return;
        }

        // Update language from userChat if available
        if (data.userChat?.preferredChatLanguage) {
            language = getPreferredLanguage(data.userChat);
            $('#language').val(language);
        }

        setupChatData(data.chat);
        setupChatInterface(data.chat, data.character, data.userChat, isNew);
        updateCurrentChat(chatId);

        if (!isNew) {
            displayExistingChat(data.userChat, data.character);
            await checkBackgroundTasks(chatId, userChatId);
        } else {
            displayInitialChatInterface(data.chat);

        }

        updateParameters(chatId, fetch_userId, userChatId);
        showChat();

        // Update custom prompts using the new PromptManager
        if (window.promptManager && fetch_userId) {
            window.promptManager.update(fetch_userId);
        }

        // Update gift permissions using the new GiftManager
        if (window.giftManager && fetch_userId) {
            window.giftManager.update(fetch_userId);
        }

        $('.fullscreen-overlay').fadeOut(); 
        $('#chat-list').fadeOut();
        $('#footer-toolbar').fadeOut();

        resetSuggestionsAndHide();
    }
    
    function setupChatData(chat) {
        chatData = chat.content || [];
        totalSteps = chatData.length;
        chatName = chat.name;
        thumbnail = chat.chatImageUrl;
        localStorage.setItem('thumbnail',thumbnail)
    }
    
function setupChatInterface(chat, character, userChat, isNew) {
    const gender = determineChatGender(chat);
    const chatNsfw = chat.nsfw || false;
    $('#chat-container').attr('data-genre', gender);
    $('#promptContainer').attr('data-nsfw', chatNsfw).removeClass('nsfw').addClass(chatNsfw ? 'nsfw' : 'sfw');
    $('#giftsList').attr('data-nsfw', chatNsfw).removeClass('nsfw').addClass(chatNsfw ? 'nsfw' : 'sfw');
    if(gender === 'female'){
        $('#showPrompts').show();
        $('#gifts-toggle').show();
        $('#userMessage').removeClass('male').addClass('female');
        $('.settings-modal-body').attr('data-genre', 'female');
    }else{
        $('#showPrompts').hide();
        $('#gifts-toggle').hide();
        $('#userMessage').removeClass('female').addClass('male');
        $('.settings-modal-body').attr('data-genre', 'male');
    }
    const bgImage = isNew ? null : (userChat && userChat.backgroundImageUrl ? userChat.backgroundImageUrl : null);
    updateChatBackgroundImage(bgImage);
    
    updateCurrentChatLevel();
    initializeAudio();

    $('#chat-title').text(chatName);
    $('#userMessage').attr('placeholder', `${window.translations.sendMessage}`);

    const albumLink = $(`<a href="#" onclick="openCharacterModal('${chat._id}',event)"></a>`);
    albumLink.attr('data-bs-toggle', 'tooltip');
    albumLink.attr('title', `${window.translations.album || 'アルバム'}`);
    
    // Remove old classes and add the new styling class
    albumLink.removeClass('btn btn-light shadow-0 border border-3 border-dark rounded-circle shadow');
    albumLink.addClass('album-link-styled rounded-circle-button-size');

    // Clear any inline styles that might conflict or are now handled by the class
    albumLink.removeAttr('style'); 

    const imageCount = chat.imageCount ? chat.imageCount : 0;
    // Set the inner HTML with the icon and the new badge structure
    albumLink.empty().append(`<i class="bi bi-images"></i><span class="image-count image-count-badge" data-chat-id="${chat._id}">${imageCount}</span>`);

    new bootstrap.Tooltip(albumLink[0]);
    $('#chat-thumbnail-gallery').prepend(albumLink);

    if (window.chatToolSettings) {
        window.chatToolSettings.loadSettings();
    }else {
        console.warn('chatToolSettings module not found. Skipping settings load.');
    }
}
    
    function determineChatGender(chat) {
        let gender = chat.gender || 'female';
        if (chat.character && chat.character.prompt) {
            gender = chat.character.prompt.toLowerCase();
            gender = /\bmale\b/.test(gender) ? "male" : "female";
        }
        return gender;
    }
    
    function displayExistingChat(userChat,character) {
        
        persona = userChat.persona;
        thumbnail = character?.image || localStorage.getItem('thumbnail')

        // Initialize scenarios in background - DON'T wait for this to complete
        if (window.ChatScenarioModule && userChatId) {
            window.ChatScenarioModule.init(chatId, userChatId).catch(err => {
                console.warn('[displayExistingChat] Scenario initialization error (non-blocking):', err);
            });
        }

        // Load thumb nav gallery for current userChatId (refreshes when userChatId changes)
        loadThumbNavGallery(chatId, userChatId);

        // Display chat immediately - don't block on scenario initialization
        displayChat(userChat, persona, function(){
            setTimeout(() => {
                const $chatContainer = $('#chatContainer');
                if ($chatContainer.length) {
                    // Wait for content to be rendered by checking if scrollHeight > 0
                    const checkAndScroll = () => {
                        const scrollHeight = $chatContainer.prop("scrollHeight");
                        const containerHeight = $chatContainer.height();
                        
                        if (scrollHeight > 0 && scrollHeight > containerHeight) {
                            $chatContainer.animate({
                                scrollTop: scrollHeight
                            }, 500);
                        } else if (scrollHeight === 0) {
                            // Retry after a short delay if content isn't ready
                            setTimeout(checkAndScroll, 100);
                        }
                    };
                    
                    checkAndScroll();
                }
            }, 1000);


            // Add suggestions after assistant message
            window.chatId = sessionStorage.getItem('chatId') || window.chatId;
            window.userChatId = sessionStorage.getItem('userChatId') || window.userChatId;


            if (window.chatSuggestionsManager && window.userId && window.chatId && window.userChatId) {
                setTimeout(() => {
                    window.chatSuggestionsManager.showSuggestions(
                        window.userId, 
                        window.chatId, 
                        window.userChatId
                    );
                }, 500);
            }
        });

        const today = new Date().toISOString().split('T')[0];
        if (userChat.log_success) {
            displayThankMessage();
        }
    }
    
    function displayInitialChatInterface(chat) {
        displayStarter(chat);
        // Load thumb nav gallery for new chat (refreshes when userChatId changes)
        const currentUserChatId = sessionStorage.getItem('userChatId') || window.userChatId;
        loadThumbNavGallery(chat._id, currentUserChatId);
    }

    /**
     * Load thumb nav gallery for the current userChatId
     * Safeguard: Refreshes when userChatId changes (new chat session)
     */
    async function loadThumbNavGallery(currentChatId, currentUserChatId) {
        // Get current userChatId from session if not provided
        if (!currentUserChatId) {
            currentUserChatId = sessionStorage.getItem('userChatId') || window.userChatId;
        }

        // Safeguard: Don't load if already loaded for this userChatId
        if (thumbNavGalleryLoadedUserChatId === currentUserChatId && currentUserChatId) {
            console.log(`[DEBUG loadThumbNavGallery] Already loaded for userChatId: ${currentUserChatId}, skipping`);
            return;
        }

        // Safeguard: Don't load if currently loading
        if (thumbNavGalleryLoading) {
            console.log(`[DEBUG loadThumbNavGallery] Already loading, skipping`);
            return;
        }

        // Safeguard: Ensure we have a valid chat ID
        if (!currentChatId) {
            console.log(`[DEBUG loadThumbNavGallery] No chatId provided, skipping`);
            return;
        }

        // Set loading flag
        thumbNavGalleryLoading = true;

        try {
            // Build URL with userChatId if available
            let url = `/chat/${currentChatId}/images?page=1`;
            if (currentUserChatId) {
                url += `&userChatId=${currentUserChatId}`;
            }

            // Fetch images from the current chat (filtered by userChatId if provided)
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to load images: ${response.status}`);
            }

            const data = await response.json();
            const images = data.images || [];

            // Only proceed if this is still the current userChatId
            const currentUserChatIdInSession = sessionStorage.getItem('userChatId') || window.userChatId;
            if (currentUserChatIdInSession !== currentUserChatId) {
                console.log(`[DEBUG loadThumbNavGallery] userChatId changed during load (was: ${currentUserChatId}, now: ${currentUserChatIdInSession}), aborting`);
                thumbNavGalleryLoading = false;
                return;
            }

            // Get user subscription status for blur logic
            const subscriptionStatus = (window.user || user)?.subscriptionStatus === 'active';

            // Clear existing thumbnails (except album link)
            const albumLink = $('#chat-thumbnail-gallery').find('a[data-bs-toggle="tooltip"]').first();
            $('#chat-thumbnail-gallery').empty();
            if (albumLink.length) {
                $('#chat-thumbnail-gallery').prepend(albumLink);
            }

            // Reset tracking set
            thumbNavGalleryImageIds.clear();

            // Add images to thumb nav gallery
            images.forEach(image => {
                const imageId = image._id || image.imageId;
                const imageUrl = image.imageUrl || image.url;
                
                // Use shouldBlurNSFW function to properly determine if image should be blurred
                // This handles NSFW + subscription + showNSFW preference logic
                const shouldBlur = typeof window.shouldBlurNSFW === 'function' 
                    ? window.shouldBlurNSFW(image, subscriptionStatus)
                    : (image.nsfw && !subscriptionStatus); // Fallback if function not available

                if (imageId && imageUrl && !thumbNavGalleryImageIds.has(imageId)) {
                    displayImageThumb(imageId, imageUrl, null, shouldBlur);
                }
            });

            console.log(`[DEBUG loadThumbNavGallery] Displayed ${thumbNavGalleryImageIds.size} images in gallery for userChatId: ${currentUserChatId}`);

            // Mark as loaded for this userChatId
            thumbNavGalleryLoadedUserChatId = currentUserChatId;

        } catch (error) {
            console.error('[loadThumbNavGallery] Error loading thumb nav gallery:', error);
        } finally {
            thumbNavGalleryLoading = false;
        }
    }

    function displayImageThumb(imageId, imageUrl, origineUserChatId = null, shouldBlur = false){
        // Safeguard: Check if this image is already in the thumb nav gallery
        if (thumbNavGalleryImageIds.has(imageId)) {
            console.log(`[displayImageThumb] SKIPPED - imageId ${imageId} already in thumbNavGalleryImageIds`);
            return;
        }

        const messageContainer = $(`#chatContainer[data-id=${origineUserChatId}]`)
        if(origineUserChatId && messageContainer.length == 0){
            return
        }

        // Check if element already exists in DOM (additional safeguard)
        if ($(`#chat-thumbnail-gallery [data-id="${imageId}"]`).length > 0) {
            console.log(`[displayImageThumb] SKIPPED - imageId ${imageId} already exists in DOM`);
            thumbNavGalleryImageIds.add(imageId);
            return;
        }

        console.log(`[displayImageThumb] ADDING thumbnail for imageId: ${imageId}`);

        // Create the card element
        var card = $(`
            <div 
            onclick="showImagePreview(this)"
            class="assistant-image-box card custom-card bg-transparent shadow-0 border-0 px-1 col-auto" style="cursor:pointer;" data-src="${imageUrl}" data-id="${imageId}">
                <div class="card-img-top rounded-avatar rounded-circle-button-size position-relative m-auto" data-image-id="${imageId}" data-original-url="${imageUrl}"></div>
                ${shouldBlur ? `<div class="blur-overlay rounded-avatar rounded-circle-button-size position-absolute m-auto"></div>` : ''}
            </div>
        `);
        
        const imageDiv = card.find('.card-img-top');
        
        if (shouldBlur) {
            // Fetch blurred image for NSFW content
            $.ajax({
                url: '/blur-image?url=' + encodeURIComponent(imageUrl),
                method: 'GET',
                xhrFields: {
                    withCredentials: true,
                    responseType: 'blob'
                },
                success: function(blob) {
                    // Convert blob to object URL and set as background-image
                    const blurredUrl = URL.createObjectURL(blob);
                    imageDiv.css('background-image', `url(${blurredUrl})`);
                },
                error: function() {
                    console.error(`[displayImageThumb] Failed to load blurred image for ${imageId}`);
                    // Fallback to original image if blur fails
                    imageDiv.css('background-image', `url(${imageUrl})`);
                }
            });
        } else {
            // Use original image
            imageDiv.css('background-image', `url(${imageUrl})`);
        }
        
        $('#chat-thumbnail-gallery').append(card);
        thumbNavGalleryImageIds.add(imageId);
    }
    function displayVideoThumb(originalImageUrl, videoUrl, origineUserChatId = null, shouldBlur = false){
        if(shouldBlur){
            return;
        }
        const messageContainer = $(`#chatContainer[data-id=${origineUserChatId}]`)
        if(origineUserChatId && messageContainer.length == 0){
            return
        }

        // Use video URL as unique identifier for tracking
        const videoId = videoUrl;
        
        // Safeguard: Check if this video is already in the thumb nav gallery
        if (thumbNavGalleryImageIds.has(videoId)) {
            return;
        }

        // Check if element already exists in DOM (additional safeguard)
        if ($(`#chat-thumbnail-gallery [data-video-src="${videoUrl}"]`).length > 0) {
            thumbNavGalleryImageIds.add(videoId);
            return;
        }

        var card = $(`
            <div 
            onclick="showVideoPreview(this)"
            data-video-src="${videoUrl}"
            class="assistant-image-box card custom-card bg-transparent shadow-0 border-0 px-1 col-auto" style="cursor:pointer;" data-src="${originalImageUrl}">
                <div style="background-image:url(${originalImageUrl});" class="card-img-top rounded-avatar rounded-circle-button-size position-relative m-auto">
                </div>
            </div>
        `);
        $('#chat-thumbnail-gallery').append(card);
        thumbNavGalleryImageIds.add(videoId);
    }


    function displayThankMessage(){
        const customPrompt = {
            systemContent: "あなたの役割は、常にキャラクターとして行動し、ユーザーに対して優しく丁寧な対応をすることです。今回は、ログインしてくれたユーザーに感謝の気持ちを伝える必要があります。ユーザーが戻ってきたことを嬉しく思っていることを、短くて優しい言葉で伝えてください。",
            userContent: "ユーザーがログインしました。あなたのキャラクターとして、心からの感謝と喜びを表現する短いメッセージを伝えてください。そして、100コインがユーザーに贈られたこともお伝えください。",
            temperature: 0.7,
            top_p: 0.9,
            frequency_penalty: 0,
            presence_penalty: 0
        };
                            
        generateCustomCompletion(customPrompt,function(){
            updateLogSuccess()
        })
    }
    function updateLogSuccess(callback) {
        const apiUrl = API_URL + '/api/update-log-success';
    
        $.ajax({
            url: apiUrl,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ userId, userChatId }),
            success: function(response) {
                if (response.success) {
                } else {
                    console.warn(response.message);
                }
                if (typeof callback === "function") {
                    callback();
                }
            },
            error: function(error) {
                console.error('Error:', error);
                if (typeof callback === "function") {
                    callback();
                }
            }
        });
    }
    
    function displayStarter(chat) {
        $('#startButtonContained').hide();
        $('#introChat').hide();
        const uniqueId = `${currentStep}-${Date.now()}`;
        let chatId = chat._id
        if($(document).find('.starter-on').length == 0){
            const botResponseContainer = $(`
                <div id="starter-${uniqueId}" class="starter-on">
                    <div class="d-flex flex-row justify-content-start position-relative mb-4 message-container">
                        <img src="${ thumbnail ? thumbnail : '/img/logo.webp' }" alt="avatar 1" class="rounded-circle chatbot-image-chat" data-id="${chatId}" style="min-width: 45px; width: 45px; height: 45px; border-radius: 15%;object-fit: cover;object-position:top;cursor:pointer;" onclick="openCharacterInfoModal('${chatId}', event)">
                        <div class="audio-controller bg-dark">
                            <button id="play-${uniqueId}" 
                            class="audio-content badge bg-dark rounded-pill shadow-sm border-light">►</button>
                            <button id="download-${uniqueId}"
                            class="audio-download badge bg-dark rounded-pill shadow-sm border-light ms-2"
                            aria-label="音声をダウンロード"
                            title="音声をダウンロード"
                            disabled>
                                <i class="bi bi-download"></i>
                            </button>
                        </div>
                        <div id="completion-${uniqueId}" class="p-3 ms-3 text-start assistant-chat-box">
                            <img src="/img/load-dot.gif" width="50px">
                        </div>
                    </div>
                    <div id="response-${uniqueId}" class="choice-container" ></div>
                </div>`);
        }
        let currentDate = new Date();
        let currentTimeInJapanese = `${currentDate.getHours()}時${currentDate.getMinutes()}分`;

        let message = null
        $.ajax({
            url: API_URL+'/api/init-chat',
            type: 'POST',
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ 
                message,
                userId,
                chatId, 
                isNew: true
            }),
            success: async function(response) {

                userChatId = response.userChatId
                chatId = response.chatId
                if (window.PersonaModule) {
                    PersonaModule.currentUserChatId = userChatId;
                }
                
                sessionStorage.setItem('userChatId', userChatId);
                sessionStorage.setItem('lastChatId', chatId);
                sessionStorage.setItem('chatId', chatId);
            
                updateCurrentChat(chatId,userId);
                updateParameters(chatId,userId,userChatId);

                
                if (window.chatToolSettings) {
                    window.chatToolSettings.hasUserChatted(chatId, async (modalAlreadyOpened) => {
                        const shouldShowScenarios = await shouldGenerateScenariosUI(userChatId);
                        
                        if (shouldShowScenarios) {
                            if (window.ChatScenarioModule) {
                                window.ChatScenarioModule.init(chatId, userChatId);
                                const generated = await window.ChatScenarioModule.generateScenarios();
                                if (generated) {
                                    return;
                                }
                            }
                        }

                        // On chat reset open the settings modal if not opened before
                        if(modalAlreadyOpened === false){
                            window.chatToolSettings.openModal(() => {
                                generateChatCompletion();
                            });
                        } else {
                            generateChatCompletion();
                        }
                    });

                } else {
                    // Fallback if settings not available
                    generateChatCompletion();
                }

            },
            error: function(xhr, status, error)  {
                console.error('Error:', error);
                displayMessage('bot', 'An error occurred while sending the message.',userChatId);
                
            }                    
        });
    }

    async function displayChat(userChat, persona, callback) {
        
        console.log(`\n🔵🔵🔵 [displayChat] ═══════════════════════════════════════════════════════════════════════════`);
        console.log(`📊 [displayChat] Starting to display chat`);
        console.log(`   userChatId: ${userChat._id}`);
        console.log(`   Total messages from server: ${userChat.messages?.length || 0}`);
        
        $('body').css('overflow', 'hidden');
        $('#stability-gen-button').show();
        $('.auto-gen').each(function() { $(this).show(); });
        $('#audio-play').show();

        let chatContainer = $('#chatContainer');
        chatContainer.empty();

        // Clear the tracking sets when displaying a new chat
        displayedMessageIds.clear();
        displayedImageIds.clear();
        displayedImageUrls.clear();
        displayedVideoIds.clear();

        // Just clear the scenario container display, but keep the data
        if (window.ChatScenarioModule) {
            window.ChatScenarioModule.removeSelectedScenarioDisplay();
        }

        let userChatMessages = userChat.messages || [];
        
        // DEBUG: Log message type breakdown
        const messageTypes = {};
        userChatMessages.forEach(msg => {
            const type = msg?.type || msg?.role || 'unknown';
            messageTypes[type] = (messageTypes[type] || 0) + 1;
        });
        console.log(`📊 [displayChat] Message type breakdown:`, messageTypes);
        
        // DEBUG: Count duplicates by mergeId and imageId
        const mergeIdCounts = {};
        const imageIdCounts = {};
        const batchIdCounts = {};
        userChatMessages.forEach(msg => {
            if (msg?.mergeId) {
                mergeIdCounts[msg.mergeId] = (mergeIdCounts[msg.mergeId] || 0) + 1;
            }
            if (msg?.imageId) {
                imageIdCounts[msg.imageId] = (imageIdCounts[msg.imageId] || 0) + 1;
            }
            if (msg?.batchId && msg?.batchIndex !== undefined) {
                const key = `${msg.batchId}:${msg.batchIndex}`;
                batchIdCounts[key] = (batchIdCounts[key] || 0) + 1;
            }
        });
        
        // Find duplicates (count > 1)
        const duplicateMergeIds = Object.entries(mergeIdCounts).filter(([k, v]) => v > 1);
        const duplicateImageIds = Object.entries(imageIdCounts).filter(([k, v]) => v > 1);
        const duplicateBatchIds = Object.entries(batchIdCounts).filter(([k, v]) => v > 1);
        
        if (duplicateMergeIds.length > 0) {
            console.warn(`⚠️  [displayChat] DUPLICATE MERGE IDS FOUND:`, duplicateMergeIds);
            // Log _debugSource for duplicates
            duplicateMergeIds.forEach(([mergeId]) => {
                const dupes = userChatMessages.filter(m => m?.mergeId === mergeId);
                console.warn(`⚠️  [displayChat] MergeId ${mergeId} duplicate details:`, dupes.map((d, i) => ({
                    index: userChatMessages.indexOf(d),
                    _debugSource: d._debugSource || 'NO_SOURCE',
                    _debugId: d._debugId || 'NO_ID',
                    createdAt: d.createdAt,
                    imageId: d.imageId
                })));
            });
        }
        if (duplicateImageIds.length > 0) {
            console.warn(`⚠️  [displayChat] DUPLICATE IMAGE IDS FOUND:`, duplicateImageIds);
            // Log _debugSource for duplicates
            duplicateImageIds.forEach(([imageId]) => {
                const dupes = userChatMessages.filter(m => m?.imageId === imageId);
                console.warn(`⚠️  [displayChat] ImageId ${imageId} duplicate details:`, dupes.map((d, i) => ({
                    index: userChatMessages.indexOf(d),
                    _debugSource: d._debugSource || 'NO_SOURCE',
                    _debugId: d._debugId || 'NO_ID',
                    createdAt: d.createdAt,
                    mergeId: d.mergeId
                })));
            });
        }
        if (duplicateBatchIds.length > 0) {
            console.warn(`⚠️  [displayChat] DUPLICATE BATCH IDS FOUND:`, duplicateBatchIds);
        }
        
        const totalDuplicates = duplicateMergeIds.reduce((sum, [k, v]) => sum + v - 1, 0) +
                                duplicateImageIds.reduce((sum, [k, v]) => sum + v - 1, 0);
        console.log(`📊 [displayChat] Duplicate summary: ${totalDuplicates} potential duplicates (${duplicateMergeIds.length} mergeId, ${duplicateImageIds.length} imageId, ${duplicateBatchIds.length} batchId duplicates)`);

        // CRITICAL FIX: Filter out invalid/undefined messages before processing
        const invalidMessages = [];
        userChatMessages = userChatMessages.filter((msg, index) => {
            // Skip null or undefined messages
            if (!msg) {
                console.warn(`[displayChat] Removing undefined/null message at index ${index}`);
                invalidMessages.push({ index, reason: 'null or undefined' });
                return false;
            }

            // For image messages, validate they have required fields
            if (msg.type === 'image' || msg.type === 'mergeFace' || msg.imageId) {
                if (!msg.imageUrl || !msg.imageId) {
                    console.warn(`[displayChat] Removing invalid image message at index ${index}: imageUrl=${!!msg.imageUrl}, imageId=${!!msg.imageId}`);
                    invalidMessages.push({ index, reason: 'missing imageUrl or imageId', msg });
                    return false;
                }
                // Validate imageUrl format
                if (!msg.imageUrl.startsWith('http') && !msg.imageUrl.startsWith('data:image/') && !msg.imageUrl.startsWith('/')) {
                    console.warn(`[displayChat] Removing message with invalid imageUrl format at index ${index}: ${msg.imageUrl?.substring(0, 60)}`);
                    invalidMessages.push({ index, reason: 'invalid imageUrl format', msg });
                    return false;
                }
            }

            // For batched messages, validate batch metadata
            if (msg.batchId && (msg.batchIndex === undefined || msg.batchSize === undefined)) {
                console.warn(`[displayChat] Removing message with incomplete batch metadata at index ${index}: batchId=${msg.batchId}, batchIndex=${msg.batchIndex}, batchSize=${msg.batchSize}`);
                invalidMessages.push({ index, reason: 'incomplete batch metadata', msg });
                return false;
            }

            return true;
        });

        if (invalidMessages.length > 0) {
            console.warn(`[displayChat] ⚠️  Filtered out ${invalidMessages.length} invalid messages:`, invalidMessages);
        }

        // ===== NEW: Group batched images into slider messages =====
        // Reconstruct bot-image-slider messages from individual batched image messages
        const processedMessages = [];
        const batchedGroups = new Map(); // Track batches by batchId
        const processedIndices = new Set(); // Track which messages we've already processed
        
        // CRITICAL FIX: Store reference to filtered messages for consistent iteration
        const filteredMessages = [...userChatMessages];

        // First pass: identify all batches and group messages
        for (let i = 0; i < filteredMessages.length; i++) {
            const msg = filteredMessages[i];
            
            // Check if this message is part of a batch (has batchId, batchIndex, batchSize)
            if (msg.batchId && msg.batchIndex !== undefined && msg.batchSize !== undefined && msg.batchSize > 1) {
                // This is a batched image - group it
                if (!batchedGroups.has(msg.batchId)) {
                    batchedGroups.set(msg.batchId, {
                        batchId: msg.batchId,
                        batchSize: msg.batchSize,
                        images: [],
                        seenImageIds: new Set(),  // Track unique imageIds to prevent duplicates
                        seenBatchIndices: new Set(), // Track unique batchIndices to prevent duplicates
                        firstMessageIndex: i  // Position in filtered array
                    });
                }
                
                // Add this image to the batch, but skip duplicates by imageId AND batchIndex
                const batch = batchedGroups.get(msg.batchId);

                // Validate message has required data before adding to batch
                if (!msg.imageUrl || !msg.imageId) {
                    console.warn(`[displayChat] Skipping batched message with missing data: imageUrl=${!!msg.imageUrl}, imageId=${!!msg.imageId}`);
                    processedIndices.add(i);
                    continue;
                }

                // Skip duplicates by checking BOTH imageId AND batchIndex
                const isDuplicateImageId = msg.imageId && batch.seenImageIds.has(msg.imageId);
                const isDuplicateBatchIndex = batch.seenBatchIndices.has(msg.batchIndex);
                
                if (isDuplicateImageId || isDuplicateBatchIndex) {
                    // Silently skip duplicates (log only in dev mode if needed)
                } else {
                    batch.seenImageIds.add(msg.imageId);
                    batch.seenBatchIndices.add(msg.batchIndex);
                    // Use batchIndex as position, but fall back to pushing if index already occupied
                    if (batch.images[msg.batchIndex] === undefined) {
                        batch.images[msg.batchIndex] = msg;
                    } else {
                        // Index collision - find next available slot
                        batch.images.push(msg);
                    }
                }
                processedIndices.add(i);
            }
        }
        
        // Log batch summary once per batch (not per message)
        batchedGroups.forEach((batch, batchId) => {
            const validImages = batch.images.filter(img => img !== undefined);
            console.log(`[displayChat] Found batch ${batchId}: ${validImages.length} unique images (expected ${batch.batchSize})`);
        });
        
        // Second pass: rebuild messages with batches converted to slider messages
        // CRITICAL FIX: Use filteredMessages instead of userChat.messages to maintain index consistency
        userChatMessages = [];
        const batchesAdded = new Set(); // Track which batches we've already added
        
        for (let i = 0; i < filteredMessages.length; i++) {
            const msg = filteredMessages[i];
            
            // Skip if this message was part of a batch we've already processed
            if (processedIndices.has(i)) {
                // Create slider when we first encounter ANY message from a batch (not just index 0)
                // This handles cases where index 0 might be missing
                if (msg.batchId && !batchesAdded.has(msg.batchId)) {
                    const batch = batchedGroups.get(msg.batchId);
                    if (batch) {
                        // Add the entire batch as a single slider message
                        const sliderImages = batch.images.filter(img => img !== undefined);
                        const sliderMessage = {
                            role: "assistant",
                            type: "bot-image-slider",
                            sliderImages: sliderImages,
                            batchId: batch.batchId,
                            batchSize: batch.batchSize,
                            createdAt: msg.createdAt,
                            _id: `slider-${msg.batchId}` // Unique ID for the slider message
                        };
                        userChatMessages.push(sliderMessage);
                        batchesAdded.add(msg.batchId);
                        console.log(`[displayChat] Reconstructed slider for batchId ${msg.batchId} with ${sliderImages.length} images`);
                    }
                }
                // Skip adding individual batched messages
                continue;
            }
            
            // Add non-batched messages as-is
            userChatMessages.push(msg);
        }

        const userChatLength = userChatMessages.length;

        for (let i = 0; i < userChatLength; i++) {
            let messageHtml = '';
            let chatMessage = userChatMessages[i];
            const designStep = i + 1;
            
            // Create a unique identifier for each message
            const messageId = chatMessage._id || `${chatMessage.role}_${i}_${chatMessage.content ? chatMessage.content.substring(0, 50) : ''}`;
            
            // Skip if this message has already been displayed
            if (displayedMessageIds.has(messageId)) {
                continue;
            }

            if (chatMessage.role === "user") {
                const isStarter = chatMessage?.content?.startsWith("[Starter]") || chatMessage?.content?.startsWith("Invent a situation") || chatMessage?.content?.startsWith("Here is your character description");
                const isHidden = chatMessage?.hidden === true || chatMessage?.content?.startsWith("[Hidden]") || chatMessage?.name === 'master';
                const image_request = chatMessage.image_request
                if (!isStarter && !isHidden) {
                    const isGift = chatMessage.name === 'gift' || chatMessage.name === 'gift_request' ;
                    if (isGift) {
                        const text = chatMessage.content;
                        const imageUrl = chatMessage.imageUrl;
                        messageHtml = `
                            <div class="d-flex flex-row justify-content-end mb-4 message-container" style="position: relative;">
                                <div>
                                    ${imageUrl ? `<div class="image-container me-3" style="max-width: 300px; margin-bottom: 10px;"><img src="${imageUrl}" alt="Gift" class="gif-message-image"></div>` : ''}
                                </div>
                                ${persona ? `<img src="${persona.chatImageUrl || '/img/logo.webp'}" alt="avatar 1" class="rounded-circle user-image-chat" data-id="${chatId}" style="min-width: 45px; width: 45px; height: 45px; border-radius: 15%; object-fit: cover; object-position:top;">` : ''}
                            </div>
                        `;
                    } else {
                        messageHtml = `
                            <div class="d-flex flex-row justify-content-end mb-4 message-container" style="position: relative;">
                                <div class="p-3 me-3 border-0 text-start user-message" style="border-radius: 15px; background: linear-gradient(135deg, #b58afe, #a855f7);">
                                    ${marked.parse(chatMessage.content)}
                                </div>
                                ${persona ? `<img src="${persona.chatImageUrl || '/img/logo.webp'}" alt="avatar 1" class="rounded-circle user-image-chat" data-id="${chatId}" style="min-width: 45px; width: 45px; height: 45px; border-radius: 15%; object-fit: cover; object-position:top;">` : ''}
                                ${image_request ? `<i class="bi bi-image message-icon" style="position: absolute; top: 0; right: 25px;opacity: 0.7;"></i>` : ''}
                            </div>
                        `;
                    }
                    displayedMessageIds.add(messageId);
                }
            } else if (chatMessage.role === "assistant") {

                const isNarratorMessage = chatMessage.content?.startsWith("[Narrator]");
                const isImageSlider = chatMessage.type === 'bot-image-slider' && Array.isArray(chatMessage.sliderImages);
                const isImage = !!chatMessage?.imageId || chatMessage.content?.startsWith("[Image]") || chatMessage.content?.startsWith("[image]");
                const isVideo = !!chatMessage?.videoId || chatMessage.content?.startsWith("[Video]") || chatMessage.content?.startsWith("[video]");
                const isMergeFace = !!chatMessage?.mergeId || chatMessage.content?.startsWith("[MergeFace]");
            
                if (isNarratorMessage) {
                    const narrationContent = chatMessage.content.replace("[Narrator]", "").trim();
                    messageHtml = `
                        <div id="narrator-container-${designStep}" class="d-flex flex-row justify-content-start message-container">
                            <div id="narration-${designStep}" class="p-3 ms-3 text-start narration-container" style="border-radius: 15px;">
                                ${marked.parse(narrationContent)}
                            </div>
                        </div>
                    `;
                    displayedMessageIds.add(messageId);
                } else if (isImageSlider) {
                    // Handle slider message reconstructed from batched images
                    const sliderImages = chatMessage.sliderImages || [];
                    console.log(`[displayChat] Rendering slider with ${sliderImages.length} images:`, sliderImages.map(img => ({ imageId: img?.imageId, imageUrl: img?.imageUrl?.substring(0, 60) })));
                    
                    if (sliderImages.length > 0) {
                        const sliderId = `slider-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                        const subscriptionStatus = user.subscriptionStatus === 'active';
                        const showNSFW = sessionStorage.getItem('showNSFW') === 'true';
                        const isTemporary = !!user?.isTemporary;
                        
                        // Build slider slides HTML from stored image data
                        let slidesHtml = '';
                        let firstImageNsfw = false;
                        const imageDataArray = [];
                        
                        sliderImages.forEach((imgData, index) => {
                            // Validate image data before rendering
                            if (!imgData) {
                                console.warn(`[displayChat] Skipping undefined image at slider index ${index}`);
                                return;
                            }

                            // CRITICAL FIX: Validate required fields
                            if (!imgData.imageUrl || !imgData.imageId) {
                                console.warn(`[displayChat] Skipping invalid slider image at index ${index}: imageUrl=${!!imgData.imageUrl}, imageId=${!!imgData.imageId}`);
                                return;
                            }

                            const imageNsfw = imgData.nsfw || false;
                            if (index === 0) firstImageNsfw = imageNsfw;

                            // Use proper blur logic that respects showNSFW setting (same as shouldBlurNSFW)
                            // For temporary users or non-subscribers: always blur NSFW
                            // For premium users: respect their showNSFW preference
                            const shouldBlur = imageNsfw && (isTemporary || !subscriptionStatus || (subscriptionStatus && !showNSFW));
                            const displayMode = imageNsfw ? (subscriptionStatus && showNSFW ? 'show' : (subscriptionStatus ? 'overlay' : 'blur')) : 'show';

                            const imageUrl = imgData.imageUrl;
                            const titleText = imgData.title || imgData.prompt || 'Image';
                            const imagePrompt = imgData.prompt || '';
                            const isUpscaled = imgData.isUpscaled || false;
                            const isMergeFace = imgData.isMerged || false;
                            
                            imageDataArray.push({
                                imageUrl,
                                imageId: imgData.imageId,
                                title: titleText,
                                prompt: imagePrompt,
                                nsfw: imageNsfw,
                                isUpscaled,
                                isMergeFace
                            });
                            
                            // Add to thumbnail gallery (FIX: was missing on page reload)
                            displayImageThumb(imgData.imageId, imageUrl, userChatId, shouldBlur);
                            
                            // Only add img-blur class if the image should actually be blurred
                            const imgClass = shouldBlur ? 'img-blur slider-image' : 'slider-image';
                            
                            // For NSFW images that need blur, use data-src instead of src to avoid exposing URL in console
                            // Only store data-src if user is premium (for later unblur), otherwise don't expose URL at all
                            const imgSrc = shouldBlur ? '/img/image-placeholder.gif' : imageUrl;
                            const imgDataSrc = (shouldBlur && subscriptionStatus) ? `data-src="${imageUrl}"` : '';
                            
                            // Store additional data for preview modal
                            const titleAttr = titleText ? `data-title="${titleText.replace(/"/g, '&quot;')}"` : '';
                            const promptAttr = imagePrompt ? `data-prompt="${imagePrompt.replace(/"/g, '&quot;')}"` : '';
                            
                            // Container is always clickable - showImagePreview handles blur state checks
                            // (loads plan page for non-premium, returns for blurred premium, opens preview for unblurred)
                            const containerClass = shouldBlur ? 'assistant-image-box isBlurred' : 'assistant-image-box';
                            
                            slidesHtml += `
                                <div class="swiper-slide" style="display: flex; flex-direction: column; align-items: center;">
                                    <div class="${containerClass}" onclick="showImagePreview(this)" data-id="${imgData.imageId}" ${!shouldBlur ? `data-src="${imageUrl}"` : ''} ${titleAttr} ${promptAttr} style="position: relative; display: flex; justify-content: center; align-items: center; border-radius: 12px; overflow: hidden; width: 100%; min-height: 200px; cursor: pointer;">
                                        <img src="${imgSrc}" 
                                             ${imgDataSrc}
                                             data-id="${imgData.imageId}"
                                             data-nsfw="${imageNsfw || false}"
                                             data-isUpscaled="${!!isUpscaled}"
                                             data-isMergeFace="${!!isMergeFace}"
                                             ${titleAttr}
                                             ${promptAttr}
                                             class="${imgClass}"
                                             style="max-width: 100%; max-height: 400px; width: auto; height: auto; border-radius: 12px; object-fit: contain;"
                                             onerror="console.error('Failed to load slider image')">
                                    </div>
                                    ${!isUpscaled ? `<div style="padding: 10px; text-align: center; font-size: 12px; color: #999;">${getImageTools({chatId, userChatId, imageId: imgData.imageId, isLiked:false, title: titleText, prompt: imagePrompt, nsfw: imageNsfw, imageUrl})}</div>` : ''}
                                </div>
                            `;
                        });
                        
                        messageHtml = `
                            <div class="d-flex flex-row justify-content-start mb-4 message-container bot-image-slider animate__animated animate__fadeIn">
                                <img src="${thumbnail || '/img/logo.webp'}" alt="avatar" class="rounded-circle chatbot-image-chat" data-id="${chatId}" style="min-width: 45px; width: 45px; height: 45px; border-radius: 15%; object-fit: cover; object-position: top;" onclick="openCharacterInfoModal('${chatId}', event)">
                                <div class="ms-3 position-relative image-slider-container" style="max-width: 300px; width: 100%;">
                                    <div class="swiper chat-image-swiper" id="${sliderId}" style="border-radius: 12px; overflow: hidden; min-height: 200px;">
                                        <div class="swiper-wrapper">
                                            ${slidesHtml}
                                        </div>
                                        <div class="swiper-button-prev" style="color: white; opacity: 0.8; transform: scale(0.6);"></div>
                                        <div class="swiper-button-next" style="color: white; opacity: 0.8; transform: scale(0.6);"></div>
                                    </div>
                                </div>
                            </div>      
                        `;
                        
                        messageHtml = `${messageHtml}`; // Wrap HTML
                        
                        // Initialize Swiper after appending (deferred)
                        displayedMessageIds.add(messageId);
                        displayedImageIds.add(`slider-${chatMessage.batchId}`);
                        
                        // Schedule Swiper initialization
                        setTimeout(() => {
                            const swiperElement = document.getElementById(sliderId);
                            if (swiperElement && typeof Swiper !== 'undefined') {
                                const chatSwiper = new Swiper(`#${sliderId}`, {
                                    loop: false,
                                    slidesPerView: 1,
                                    spaceBetween: 10,
                                    navigation: {
                                        nextEl: `#${sliderId} .swiper-button-next`,
                                        prevEl: `#${sliderId} .swiper-button-prev`
                                    },
                                    // Specify that touch events target the wrapper element
                                    touchEventsTarget: 'wrapper',
                                    // Prevent swiping when touching image tools
                                    allowTouchMove: true,
                                    // Handle touch events to disable swiping on image tools
                                    on: {
                                        touchStart: function(swiper, event) {
                                            // Check if the touch started on image tools container
                                            const target = event.target;
                                            const imageTools = target.closest('.image-tools');
                                            if (imageTools) {
                                                // Disable swiper touch move when touching image tools
                                                swiper.allowTouchMove = false;
                                            }
                                        },
                                        touchEnd: function(swiper, event) {
                                            // Always re-enable touch move after touch ends
                                            // This is safe because stopPropagation on image-tools prevents unwanted swipes
                                            swiper.allowTouchMove = true;
                                        }
                                    }
                                });
                                
                                // Attach event listeners to prevent swiper interference with image tools scrolling
                                attachImageToolsEventListeners(swiperElement);
                            }
                            
                            // Apply blur only to images that should be blurred using dashboard.js blurImage function
                            // This fetches blurred version via API and doesn't expose real URL in console
                            $(`#${sliderId} .img-blur`).each(function() {
                                if (typeof window.blurImage === 'function') {
                                    window.blurImage(this);
                                }
                            });
                            
                            // Generate video icons for all images
                            imageDataArray.forEach(imgData => {
                                generateVideoIcon(imgData.imageId, chatId, userChatId);
                            });
                        }, 100);
                    }
                } else if (isMergeFace) {
                    const mergeId = chatMessage?.mergeId || chatMessage.content.replace("[MergeFace]", "").replace("[mergeface]", "").trim();
                    // Skip if this specific merge face instance has already been displayed
                    const uniqueMergeIdentifier = `${mergeId}_${i}_${messageId}`;
                    if (displayedImageIds.has(uniqueMergeIdentifier)) {
                        continue;
                    }
                    
                    let actions = chatMessage.actions || null;
                    const mergeData = await getImageUrlById(mergeId, designStep, thumbnail, actions);
                    if(!mergeData){
                        continue
                    }
                    messageHtml = mergeData ? mergeData.messageHtml : '';
                    if (messageHtml) {
                        displayedImageIds.add(uniqueMergeIdentifier);
                        displayedMessageIds.add(messageId);
                    }
                } else if (isImage) {
                    const imageId = chatMessage?.imageId || chatMessage.content.replace("[Image]", "").replace("[image]", "").trim();
                    
                    // Skip if this image has already been displayed
                    if (displayedImageIds.has(imageId)) {
                        continue;
                    }
                    
                    // This ensures consistent NSFW blur logic
                    let actions = chatMessage.actions || null;
                    console.log(`[displayChat] Fetching image for ID: ${imageId}, design step: ${designStep}`);
                    const imageData = await getImageUrlById(imageId, designStep, thumbnail, actions);
                    if(!imageData){
                        continue
                    }
                    messageHtml = imageData ? imageData.messageHtml : '';
                    if (messageHtml) {
                        displayedImageIds.add(imageId);
                        displayedMessageIds.add(messageId);
                    }
                } else if (isVideo) {
                    const videoId = chatMessage?.videoId || chatMessage.content.replace("[Video]", "").replace("[video]", "").trim();
                    // Skip if this video has already been displayed
                    if (displayedVideoIds.has(videoId)) {
                        continue;
                    }
                    const videoActions = chatMessage.actions || [];
                    const videoData = await getVideoUrlById(videoId, designStep, thumbnail, videoActions);
                    messageHtml = videoData.messageHtml;
                    
                    if (messageHtml) {
                        displayedVideoIds.add(videoId);
                        displayedMessageIds.add(messageId);
                    }
                } else {
                    const isHidden = chatMessage?.hidden === true || chatMessage.content.startsWith("[Hidden]") ;
                    if (chatMessage.content && !isHidden) {
                        let message = formatMessageText(chatMessage.content);
                        
                        // Check if this is the last assistant message
                        const isLastMessage = i === userChat.length - 1 && chatMessage.role === "assistant";
                        const messageActions = chatMessage.actions || [];
                        
                        messageHtml = `
                            <div id="container-${designStep}">
                                <div class="d-flex flex-row justify-content-start position-relative mb-4 message-container">
                                    <img src="${thumbnail || '/img/logo.webp'}" alt="avatar 1" class="rounded-circle chatbot-image-chat" data-id="${chatId}" style="min-width: 45px; width: 45px; height: 45px; border-radius: 15%;object-fit: cover;object-position:top;" onclick="openCharacterInfoModal('${chatId}', event)">
                                    <div class="audio-controller bg-dark">
                                        <button id="play-${designStep}" 
                                        class="audio-content badge bg-dark rounded-pill shadow-sm border-light" data-content="${message}">►</button>
                                        <button id="download-${designStep}"
                                        class="audio-download badge bg-dark rounded-pill shadow-sm border-light ms-2"
                                        data-content="${message}"
                                        aria-label="音声をダウンロード"
                                        title="音声をダウンロード">
                                            <i class="bi bi-download"></i>
                                        </button>
                                    </div>
                                    <div id="message-${designStep}" class="p-3 ms-3 text-start assistant-chat-box position-relative">
                                        ${marked.parse(chatMessage.content)}
                                        ${getMessageTools(i, messageActions, isLastMessage, true, chatMessage)}
                                    </div>
                                </div>
                            </div>
                        `;
                        displayedMessageIds.add(messageId);
                    }
                }
            }

            if (messageHtml) {
                chatContainer.append($(messageHtml).hide().fadeIn());
            }
        }
        
        // Display current scenario at the top AFTER all messages are rendered
        const userChatScenarios = userChat.currentScenario || {};
        if (window.ChatScenarioModule && userChatId && Object.keys(userChatScenarios).length > 0) {
            window.ChatScenarioModule.displaySelectedScenario(userChatScenarios);
        }
        
        // Final display summary
        console.log(`📊 [displayChat] DISPLAY COMPLETE SUMMARY:`);
        console.log(`   Total messages displayed: ${displayedMessageIds.size}`);
        console.log(`   Images tracked: ${displayedImageIds.size}`);
        console.log(`   Image URLs tracked: ${displayedImageUrls.size}`);
        console.log(`🔵🔵🔵 [displayChat] END ═══════════════════════════════════════════════════════════════════════════\n`);
        
        if( typeof callback == 'function'){
            callback()
        }
    }

    window.downloadImage = function(element) {
        const $element = $(element);
        const imageUrl = $element.attr('data-src') || $element.attr('src');
        const imageTitle = $element.attr('data-title') || 'image';
        const imageId = $element.attr('data-id');
        
        if (!imageUrl) {
            showNotification(window.translations?.download_error || 'Image URL not found', 'error');
            return;
        }
        
        // Show loading state
        const originalIcon = $element.find('i').attr('class');
        $element.find('i').attr('class', 'bi bi-download spinner-border spinner-border-sm');
        
        // Create download link and trigger download
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = `${imageTitle || 'image'}_${imageId || Date.now()}.jpg`;
        link.target = '_blank'; // Fallback for browsers that don't support download attribute
        
        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Restore original icon
        $element.find('i').attr('class', originalIcon);
        
        // Show success notification
        showNotification(window.translations?.download_success || 'Download started', 'success');
    };


    window.openShareModal = function(el) {
        const title = $(el).data('title');
        const imageId = $(el).data('image-id');
        const chatId = $(el).data('chat-id');
        
        // Generate clean share URL using the share endpoint instead of raw AWS URL
        // This provides proper meta tags for social media and hides the AWS URL
        // Always use production domain for share links
        const shareDomain = 'https://app.chatlamix.com';
        const shareUrl = imageId ? `${shareDomain}/share/image/${imageId}` : $(el).data('url');
        
        $('#twitterShareButton').off('click').on('click', () => shareOnTwitter(title, shareUrl));
        $('#facebookShareButton').off('click').on('click', () => shareOnFacebook(title, shareUrl));
        $('#shareModal').modal('show');
    }
    function shareOnTwitter(title, url) {
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`, '_blank');
    }
    function shareOnFacebook(title, url) {
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
    }

    function getMergeFaceUrlById(mergeId, designStep, thumbnail) {
        console.log(`[getMergeFaceUrlById] Fetching merge face for ID: ${mergeId}, design step: ${designStep}`);
        const placeholderImageUrl = '/img/placeholder-image-2.gif';

        return new Promise((resolve) => {
            const placeholderHtml = `
            <div id="container-${designStep}">
                <div class="d-flex flex-row justify-content-start mb-4 message-container">
                    <img src="${thumbnail || '/img/logo.webp'}" alt="avatar 1" class="rounded-circle chatbot-image-chat" data-id="${chatId}" style="min-width: 45px; width: 45px; height: 45px; border-radius: 15%; object-fit: cover; object-position: top;" onclick="openCharacterInfoModal('${chatId}', event)">
                    <div class="ms-3 position-relative">
                        <div 
                        onclick="showImagePreview(this)"
                        class="ps-0 text-start assistant-image-box transition-none">
                            <img id="merge-${mergeId}" data-id="${mergeId}" src="${placeholderImageUrl}" alt="Loading merged image...">
                        </div>
                    </div>
                </div>
            </div>`;
            resolve({ messageHtml: placeholderHtml, imageUrl: placeholderImageUrl });

            // Fetch merged image asynchronously using the new route
            $.ajax({
                url: `/api/merge-face/result/${mergeId}`, // Use the new route
                method: 'GET',
                success: function(response) {
                    if (response.success && response.result) {
                        const mergeResult = response.result;
                        const mergedImageUrl = mergeResult.mergedImageUrl;
                        // Use originalImageId (gallery imageId) for thumbnail to prevent duplicates
                        // The gallery API returns images by imageId, so we need to use the same ID here
                        const thumbId = mergeResult.originalImageId || mergeId;
                        console.log(`[getMergeFaceUrlById] Using thumbId: ${thumbId} (originalImageId: ${mergeResult.originalImageId}, mergeId: ${mergeId})`);
                        // Update the placeholder image
                        displayImageThumb(thumbId, mergedImageUrl);
                        $(`#merge-${mergeId}`).attr('src', mergedImageUrl).fadeIn();
                        $(`#merge-${mergeId}`).attr('alt', 'Merged Face Result').fadeIn();
                        $(`#merge-${mergeId}`).attr('data-prompt', 'Face merge completed');
                        
                        // Add tools for merged face image
                        const toolsHtml = getImageTools({
                            chatId, 
                            userChatId,
                            imageId: mergeId, 
                            isLiked: false,
                            title: 'Merged Face Result', 
                            prompt: 'Face merge completed', 
                            nsfw: false, 
                            imageUrl: mergedImageUrl,
                            isMergeFace: true
                        });
                        $(`#merge-${mergeId}`).closest('.assistant-image-box').after(toolsHtml);
        
                    } else {
                        console.error('No merged image URL returned');
                        $(`#merge-${mergeId}`).attr('src', '/img/error-placeholder.png');
                    }
                },
                error: function(xhr, status, error) {
                    console.error('Error fetching merged image URL:', error);
                    $(`#merge-${mergeId}`).attr('src', '/img/error-placeholder.png');
                }
            });
        });
    }


    function getImageUrlById(imageId, designStep, thumbnail, actions = null) {

        const placeholderImageUrl = '/img/placeholder-image-2.gif'; // Placeholder image URL

        // Return immediately with placeholder and update asynchronously
        return new Promise((resolve) => {
            const placeholderHtml = `
            <div id="container-${designStep}">
                <div class="d-flex flex-row justify-content-start mb-4 message-container">
                    <img src="${thumbnail || '/img/logo.webp'}" alt="avatar 1" class="rounded-circle chatbot-image-chat" data-id="${chatId}" style="min-width: 45px; width: 45px; height: 45px; border-radius: 15%; object-fit: cover; object-position: top;" onclick="openCharacterInfoModal('${chatId}', event)">
                    <div class="ms-3 position-relative">
                        <div 
                        onclick="showImagePreview(this)"
                        class="ps-0 text-start assistant-image-box transition-none" style="position: relative;">
                            <img id="image-${imageId}" data-id="${imageId}" src="${placeholderImageUrl}" alt="Loading image...">
                        </div>
                    </div>
                </div>
            </div>`;
            resolve({ messageHtml: placeholderHtml, imageUrl: placeholderImageUrl });

            // Fetch image asynchronously and update the DOM
            $.ajax({
                url: `/image/${imageId}`,
                method: 'GET',
                success: function(response) {
                    if(response.originalImageUrl){
                        if(displayedImageUrls.has(response.originalImageUrl)){
                            return;
                        }
                        displayedImageUrls.add(response.originalImageUrl);
                    }
                    if (response.imageUrl) {
                        // Apply NSFW logic
                        const item = { nsfw: response.nsfw };
                        const subscriptionStatus = user.subscriptionStatus === 'active';
                        const isTemporary = !!user.isTemporary;
                        
                        const shouldBlur = shouldBlurNSFW(item, subscriptionStatus);
                        const displayMode = getNSFWDisplayMode(item, subscriptionStatus);
                        
                        // Update the placeholder image - use galleryImageId for deduplication if available
                        // This prevents duplicates when the same image is added via mergeId and gallery _id
                        const thumbId = response.galleryImageId || imageId;
                        console.log(`[getImageUrlById] Using thumbId: ${thumbId} (galleryImageId: ${response.galleryImageId || 'none'}, imageId: ${imageId})`);
                        displayImageThumb(thumbId, response.imageUrl, null, shouldBlur);
                        
                        if (shouldBlur || displayMode !== 'show') {
                            // Apply blur effect - set data-src and add blur class
                            $(`#image-${imageId}`).attr('data-src', response.imageUrl);
                            $(`#image-${imageId}`).addClass('img-blur');
                            $(`#image-${imageId}`).closest('.assistant-image-box').addClass('isBlurred');
                            
                            // Apply blur image processing
                            blurImage($(`#image-${imageId}`)[0]);
                            
                        } else {
                            // Image is safe to show - set src normally
                            $(`#image-${imageId}`).attr('src', response.imageUrl).fadeIn();
                            // Update the alt text
                            const title = response?.title?.[language]?.trim() || '';
                            $(`#image-${imageId}`).attr('alt', title);
                            //update the image prompt
                            $(`#image-${imageId}`).attr('data-prompt', response.imagePrompt);
                        }

                        if (!response.isUpscaled) {
                            const toolsHtml = getImageTools({
                                chatId, 
                                userChatId,
                                imageId, 
                                isLiked: response?.likedBy?.some(id => id.toString() === userId.toString()),
                                title: response?.title?.[language], 
                                prompt: response.imagePrompt, 
                                nsfw: response.nsfw, 
                                imageUrl: response.imageUrl,
                                isMergeFace: response.isMergeFace,
                                actions
                            });
                            $(`#image-${imageId}`).closest('.assistant-image-box').after(toolsHtml);
                            generateVideoIcon(imageId, chatId, userChatId);
                            if (shouldBlur || displayMode !== 'show') {
                                $(`.image-tools[data-id="${imageId}"]`).hide();
                            }
                            
                            if (response.nsfw) {
                                $(`#image-${imageId}`).closest('.assistant-image-box').find('.nsfw-badge-container').show();
                            }
                        }
                    } else {
                        console.error('No image URL returned');
                        return false;
                    }
                },
                error: function(xhr, status, error) {
                    console.error('Error fetching image URL:', error);
                }
            });
        });
    }

    function getVideoUrlById(videoId, designStep, thumbnail, actions = []) {
        const placeholderVideoUrl = '/img/video-placeholder.gif'; // Placeholder video URL

        // Return immediately with placeholder and update asynchronously
        return new Promise((resolve) => {
            const placeholderHtml = `
            <div id="container-${designStep}">
                <div class="d-flex flex-row justify-content-start mb-4 message-container">
                    <img src="${thumbnail || '/img/logo.webp'}" alt="avatar 1" class="rounded-circle chatbot-image-chat" data-id="${chatId}" style="min-width: 45px; width: 45px; height: 45px; border-radius: 15%; object-fit: cover; object-position: top;" onclick="openCharacterInfoModal('${chatId}', event)">
                    <div class="ms-3 position-relative" style="max-width: 200px;display: grid;">
                        <div class="ps-0 text-start assistant-video-box d-flex">
                            <div id="video-${videoId}" class="video-loading-placeholder">
                                <img src="${placeholderVideoUrl}" alt="Loading video...">
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
            resolve({ messageHtml: placeholderHtml, videoUrl: placeholderVideoUrl });

            // Fetch video asynchronously and update the DOM
            $.ajax({
                url: `/api/video/${videoId}`,
                method: 'GET',
                success: function(response) {
                    if (response.videoUrl) {
                        
                        // Replace placeholder with actual video
                        const videoHtml = `
                            <video 
                                controls loop
                                class="generated-video" 
                                style="max-width: 100%;"
                                data-video-id="${videoId}"
                                data-title="${response.videoOriginialImageTitle || ''}"
                            >
                                <source src="${response.videoUrl}" type="video/mp4">
                                ${window.translations?.video_not_supported || 'Your browser does not support the video tag.'}
                            </video>
                        `;
                        
                        $(`#video-${videoId}`).replaceWith(videoHtml);
                        
                        // Add video tools
                        const toolsHtml = getVideoTools(response.videoUrl, response.duration, videoId, actions);
                        $(`[data-video-id="${videoId}"]`).closest('.assistant-video-box').after(toolsHtml);

                        // Add video to thumbnail gallery
                        if(response.videoOriginialImageUrl){
                            displayVideoThumb(response.videoOriginialImageUrl, response.videoUrl);
                        }
                    } else {
                        console.error('No video URL returned');
                        $(`#video-${videoId}`).html('<div class="text-muted">Video unavailable</div>');
                    }
                },
                error: function(xhr, status, error) {
                    console.error('Error fetching video URL:', error);
                    $(`#video-${videoId}`).html('<div class="text-muted">Error loading video</div>');
                }
            });
        });
    }



    
    $(document).on('click','.comment-badge', function (e) {
        e.stopPropagation()
        e.preventDefault()
        const imageId = $(this).attr('data-id')
        Swal.fire({
          html: `
          <div class="container mt-4">
            <form id="commentForm" class="form-group">
                <div class="mb-3">
                <label for="comment" class="form-label text-white">投稿を作成する</label>
                <textarea id="comment" class="form-control" rows="8" placeholder="ここにコメントを追加してください..." required></textarea>
                </div>
            </form>
          </div>
        `,        
          confirmButtonText: '投稿',
          showCancelButton: false,
          showCloseButton: true,
          width:"100%",
          position: 'bottom',
          backdrop: 'rgba(43, 43, 43, 0.2)',
          showClass: {
            popup: 'album-popup animate__animated animate__slideInUp'
          },
          hideClass: {
            popup: 'album-popup animate__animated animate__slideOutDown'
          },
          customClass: { 
              container: 'p-0', 
              popup: 'album-popup shadow', 
              htmlContainer:'position-relative', 
              closeButton: 'position-absolute me-3' 
          },
          preConfirm: () => {
            const comment = document.getElementById('comment').value;
            if (!comment) {
              Swal.showValidationMessage('コメントを入力してください');
              return false;
            }
            return comment;
          }
        }).then((result) => {
          if (result.isConfirmed) {

            $.ajax({
              url: `/posts`, 
              method: 'POST',
              data: JSON.stringify({ imageId, comment: result.value }),
              contentType: 'application/json',
              success: function (response) {
                showNotification('コメントが投稿されました', 'success');
              },
              error: function () {
                showNotification('コメントの投稿に失敗しました', 'error');
              }
            });

          }
        });
      });
    
    
    $(document).on('click','.unlock-nsfw',function(){
        showUpgradePopup('unlock-nsfw');
    })
    function updatechatContent(response) {
        const previousStep = chatData[currentStep-1]; // Previous step where the choice was made


        if (currentStep < totalSteps) {
            $('#chatContainer').append(`
            <div id="container-${currentStep}">
                <div class="d-flex flex-row justify-content-start mb-4 message-container" style="opacity:0;">
                    <img src="${ thumbnail ? thumbnail : '/img/logo.webp' }" alt="avatar 1" class="rounded-circle" style="min-width: 45px; width: 45px; height: 45px; border-radius: 15%;object-fit: cover;object-position:top;">
                    <div id="message-${currentStep}" class="p-3 ms-3 text-start assistant-chat-box"></div>
                </div>
                <div id="response-${currentStep}" class="choice-container" ></div>
            </div>`)
            const nextStep = chatData[currentStep];
            nextStep.responses.forEach(response => {
                if(response.trim() != ''){
                    const button = $(`<button class="btn btn-outline-secondary m-1" onclick="choosePath('${response}')">${response}</button>`)
                    button.css('opacity',0)
                    $(`#response-${currentStep}`).append(button);
                }
            });

            const choice = previousStep.responses.find(c => c === response);
            $(`#message-${currentStep}`).closest('.message-container').animate({ opacity: 1 }, 500, function() { 
                appendHeadlineCharacterByCharacter($(`#message-${currentStep}`), nextStep.question,function(){
                    $(`#response-${currentStep} button`).each(function(){
                        $(this).css('opacity',1)
                    })
                });
            })
        }else{
            generateChatCompletion()
        }
    }

    function hideOtherChoice(response, currentStep, callback) {

        $(`#response-${currentStep - 1} button`).each(function() {
            const currentChoice = $(this).text()
            if(response == currentChoice){
                const response = $(this).text()
                $(`#response-${currentStep - 1}`).remove()
                $(`#container-${currentStep - 1}`).append(`
                    <div class="d-flex flex-row justify-content-end mb-4 message-container" style="opacity:0;">
                        <div id="response-${currentStep - 1}" class="p-3 me-3 border-0" style="border-radius: 15px; background: linear-gradient(135deg, #b58afe, #a855f7);">${response}</div>
                    </div>
                `)
            }
            $(this).remove()
        });
        $(`#response-${currentStep - 1}`).closest('.message-container').animate({ opacity: 1 }, 1000,function(){
            if (callback) {callback()}
        })
    }

    
    function formatMessageText(str) {
        if (!str) { return str; }
        // Text between * in bold
        const updatedStr = str.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        return updatedStr.trim().length > 10 ? updatedStr : str;
    }

    // Add a global variable to track active rendering processes
    const activeRenderProcesses = new Set();

    // Display completion message character by character
    window.displayCompletionMessage = function(message, uniqueId) {
        // Check if this message is already being rendered
        if (activeRenderProcesses.has(uniqueId)) {
            console.warn(`Message ${uniqueId} is already being rendered, skipping duplicate`);
            return;
        }
        
        // Add this process to active renders
        activeRenderProcesses.add(uniqueId);
        
        let completionElement = $(`#completion-${uniqueId}`);
        // If the completion element doesn't exist (race or was removed), recreate its container
        if (!completionElement.length) {
            createBotResponseContainer(uniqueId);
            completionElement = $(`#completion-${uniqueId}`);
        }

        // Check if the message has already been fully rendered
        const currentText = (completionElement && completionElement.length) ? completionElement.text().trim() : '';
        if (currentText === message.trim()) {
            console.log(`Message ${uniqueId} already fully rendered, skipping`);
            activeRenderProcesses.delete(uniqueId);
            afterStreamEnd(uniqueId, message);
            return;
        }
        
        // Clear any existing content except loading gif
        completionElement.find('img').fadeOut().remove();
        
        // Get already rendered text length to continue from where we left off
        const alreadyRendered = currentText.length;
        const graphemes = [...message.slice(alreadyRendered)];
        const CHUNK_SIZE = 1;
    
        function renderChunk() {
            // Double-check if process is still active (in case of cleanup)
            if (!activeRenderProcesses.has(uniqueId)) {
                return;
            }
            
            // Check if element still exists
            if (!$(`#completion-${uniqueId}`).length) {
                activeRenderProcesses.delete(uniqueId);
                return;
            }
            
            for (let i = 0; i < CHUNK_SIZE && graphemes.length; i++) {
                const textNode = document.createTextNode(graphemes.shift());
                $(`#completion-${uniqueId}`).append(textNode);
            }
            
            if (graphemes.length > 0) {
                requestAnimationFrame(renderChunk);
            } else {
                // Rendering complete, clean up
                activeRenderProcesses.delete(uniqueId);
                afterStreamEnd(uniqueId, $(`#completion-${uniqueId}`).text());
            }
        }
        
        autoPlayMessageAudio(uniqueId, message);
        requestAnimationFrame(renderChunk);
    };

    // Add cleanup function for when containers are removed
    window.hideCompletionMessage = function(uniqueId) {
            // Clean up active render process
            activeRenderProcesses.delete(uniqueId);

            // Prefer removing the whole container we created for this completion
            const container = $(`#container-${uniqueId}`);
            if (container.length) {
                container.fadeOut(200, function() { $(this).remove(); });
                return;
            }

            // Fallback: try to find the message container wrapping the completion element
            const completionEl = $(`#completion-${uniqueId}`);
            if (completionEl.length) {
                const msgContainer = completionEl.closest('.message-container');
                if (msgContainer.length) {
                    msgContainer.fadeOut(200, function() { $(this).remove(); });
                    return;
                }
                // Last resort: remove the completion element itself
                completionEl.fadeOut(200, function() { $(this).remove(); });
            }
        }


    // Update the createBotResponseContainer function to use the new structure
    function createBotResponseContainer(uniqueId) {
        // Clean up any existing process with same ID
        activeRenderProcesses.delete(uniqueId);
        
        const container = $(`
            <div id="container-${uniqueId}">
                <div class="d-flex flex-row justify-content-start position-relative mb-4 message-container">
                    <img src="${thumbnail ? thumbnail : '/img/logo.webp'}" alt="avatar 1" class="rounded-circle chatbot-image-chat" data-id="${chatId}" style="min-width:45px;width:45px;height:45px;border-radius:15%;object-fit:cover;object-position:top;cursor:pointer;" onclick="openCharacterInfoModal('${chatId}', event)">
                    <div class="audio-controller bg-dark">
                        <button id="play-${uniqueId}" 
                        class="audio-content badge bg-dark rounded-pill shadow-sm border-light">►</button>
                        <button id="download-${uniqueId}"
                        class="audio-download badge bg-dark rounded-pill shadow-sm border-light ms-2"
                        aria-label="音声をダウンロード"
                        title="音声をダウンロード"
                        disabled>
                            <i class="bi bi-download"></i>
                        </button>
                    </div>
                    <div class="ms-3 p-3 text-start assistant-chat-box flex-grow-1 position-relative">
                        <div id="completion-${uniqueId}"><img src="/img/load-dot.gif" width="50px"></div>
                        <!-- Message tools will be added here after streaming completes -->
                    </div>
                </div>
            </div>`).hide();
        $('#chatContainer').append(container);
        container.addClass('animate__animated animate__slideInUp').fadeIn();
        return container;
    }

    function afterStreamEnd(uniqueId, markdownContent) {
    $(`#play-${uniqueId}`).attr('data-content', markdownContent);
    $(`#download-${uniqueId}`).attr('data-content', markdownContent);
    $(`#download-${uniqueId}`).prop('disabled', false).removeClass('disabled');
    $(`#play-${uniqueId}`).closest('.audio-controller').show();
        
        // Add message tools after streaming is complete
        const messageContainer = $(`#container-${uniqueId}`);
        if (messageContainer.length) {
            // Get the current message index (count of all messages in the chat)
            const currentMessageIndex = $('#chatContainer .assistant-chat-box').length - 1;
            const currentMessageText = $(`#completion-${uniqueId}`).text().trim();

            // Update the message text with formatted content
            let updatedMessage = formatMessageText(currentMessageText);
            $(`#completion-${uniqueId}`).html(marked.parse(updatedMessage));

            // Check if this is the last message (should be true for new messages)
            const isLastMessage = true;
        
            // Create message data object for tools
            const messageData = {
                _id: null, // Will be set when message is saved to DB
                content: markdownContent,
                timestamp: Date.now(),
                role: 'assistant'
            };
            
            // Add message tools
            const toolsHtml = getMessageTools(currentMessageIndex, [], isLastMessage, true, messageData);

            // Find the position-relative container and add tools to it
            const relativeContainer = messageContainer.find('.position-relative').last();
            if (relativeContainer.length && !relativeContainer.find('.message-tools-controller').length) {
                relativeContainer.append(toolsHtml);
            }

        }

        // Add suggestions after assistant message
        window.chatId = sessionStorage.getItem('chatId') || window.chatId;
        window.userChatId = sessionStorage.getItem('userChatId') || window.userChatId;


        if (window.chatSuggestionsManager && window.userId && window.chatId && window.userChatId) {
            setTimeout(() => {
                window.chatSuggestionsManager.showSuggestions(
                    window.userId, 
                    window.chatId, 
                    window.userChatId
                );
            }, 500);
        }
    }

    // Hide the completion message container
    window.hideCompletion = function(uniqueId) {
        $(`#completion-${uniqueId}`).fadeOut();
    };

    window.generateChatCompletion = function(callback, isHidden = false, disableImageAnalysis = false) {
        const uniqueId = `${currentStep}-${Date.now()}`;
        const container = createBotResponseContainer(uniqueId); 
        // Hide chat suggestions when completion starts
        if (window.chatSuggestionsManager) {
            window.chatSuggestionsManager.hide();
        }
        $.ajax({
            url: API_URL + '/api/openai-chat-completion',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ userId, chatId, userChatId, isHidden, uniqueId, disableImageAnalysis }),
            success: function() {
                // Remove all regenerate buttons from previous messages
                $('#chatContainer .message-regenerate-btn').fadeOut(300, function() {
                    $(this).remove();
                });
            },
            error: function() {
            console.error('Error: AJAX call failed');
            }
        });
    }
  
    window.displayMessage = function(sender, message, origineUserChatId, imageUrl, callback) {
        const messageContainer = $(`#chatContainer[data-id=${origineUserChatId}]`)
        const messageClass = sender === 'user' ? 'user-message' : sender;
        const animationClass = 'animate__animated animate__slideInUp';
        let messageElement;

        if (messageClass === 'user-message') {
            if ((typeof message === 'string' && message.trim() !== '') || imageUrl) {
                message = message.replace('[Hidden]','').replace('[user] ','').replace('[context] ','')
                messageElement = $(`
                    <div class="d-flex flex-row justify-content-end mb-4 message-container ${messageClass} ${animationClass}" style="position: relative; justify-content: flex-end !important; width: 100%;">
                            ${message.trim() ? `<div class="p-3 me-3 border-0 text-start user-message" style="border-radius: 15px; background: linear-gradient(135deg, #b58afe, #a855f7);">${message}</div>` : ''}
                        ${imageUrl ? `<div class="image-container me-3" style="max-width: 300px; margin-bottom: 10px;"><img src="${imageUrl}" alt="Gift" class="gif-message-image"></div>` : ''}
                        ${persona ? `<img src="${persona.chatImageUrl || '/img/logo.webp'}" alt="avatar" class="rounded-circle user-image-chat" data-id="${chatId}" style="min-width: 45px; width: 45px; height: 45px; border-radius: 15%; object-fit: cover; object-position:top;">` : ''}
                    </div>
                `).hide();
                messageContainer.append(messageElement);
                messageElement.addClass(animationClass).fadeIn();

                $('#chatContainer').animate({ scrollTop: $('#chatContainer')[0].scrollHeight }, 500);
            }
        } 
    
        else if (messageClass === 'bot-image' && message instanceof HTMLElement) {
            const imageId = message.getAttribute('data-id');
            const imageNsfw = message.getAttribute('data-nsfw') == 'true';
            const title = message.getAttribute('alt');
            const prompt = message.getAttribute('data-prompt');
            const imageUrl = message.getAttribute('src');
            const isUpscaled = message.getAttribute('data-isUpscaled') == 'true'
            const isMergeFace = message.getAttribute('data-isMergeFace') == 'true'

            // Create a mock item for NSFW checking
            const item = { nsfw: imageNsfw };
            const subscriptionStatus = user.subscriptionStatus === 'active';
            
            // Use the helper function to determine if content should be blurred
            const shouldBlur = shouldBlurNSFW(item, subscriptionStatus);
            const displayMode = getNSFWDisplayMode(item, subscriptionStatus);

            if (shouldBlur) {
                // Remove src attribute to prevent loading the image
                message.removeAttribute('src');
                // Set data-src attribute to generate the blurry image
                message.setAttribute('data-src', imageUrl);
                // add class img-blur
                message.classList.add('img-blur');
            }

            let nsfwOverlay = '';
            const isTemporary = !!user.isTemporary;
            
            messageElement = $(`
                <div class="d-flex flex-row justify-content-start mb-4 message-container ${messageClass} ${animationClass}">
                    <img src="${thumbnail || '/img/logo.webp'}" alt="avatar" class="rounded-circle chatbot-image-chat" data-id="${chatId}" style="min-width: 45px; width: 45px; height: 45px; border-radius: 15%; object-fit: cover; object-position:top;" onclick="openCharacterInfoModal('${chatId}', event)">
                    <div class="ms-3 position-relative">
                        <div 
                        onclick="showImagePreview(this)" 
                        class="ps-0 text-start assistant-image-box transition-none ${shouldBlur ? 'isBlurred' : '' }" data-id="${imageId}" style="position: relative;">
                            ${message.outerHTML}
                            ${nsfwOverlay}
                        </div>
                        ${!isUpscaled ? getImageTools({chatId, userChatId, imageId, isLiked:false, title, prompt, nsfw: imageNsfw, imageUrl, isMergeFace}) : ''}
                    </div>
                </div>      
            `).hide();

            messageContainer.append(messageElement);
            messageElement.addClass(animationClass).fadeIn();
            generateVideoIcon(imageId, chatId, userChatId);
            // Apply blur effect if needed
            if (shouldBlur || displayMode !== 'show') {
                $(`.image-tools[data-id="${imageId}"]`).hide();
                messageElement.find('.img-blur').each(function() {
                    blurImage(this);
                });
            }

            displayImageThumb(imageId, imageUrl, origineUserChatId, shouldBlur);
            if (subscriptionStatus || !imageNsfw) {
                
            }
        } 

        else if (messageClass === 'bot-image-slider' && Array.isArray(message)) {
            // Handle batched images - display in a slider
            const images = message;
            const sliderId = `slider-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const subscriptionStatus = user.subscriptionStatus === 'active';
            
            // Build slider slides HTML
            let slidesHtml = '';
            let firstImageNsfw = false;
            let shouldBlurSlider = false;
            
            images.forEach((imgData, index) => {
                const { imageId, imageUrl, titleText, imagePrompt, imageNsfw, isUpscaled, isMergeFace } = imgData;
                
                // Check NSFW status for first image
                if (index === 0) {
                    firstImageNsfw = imageNsfw;
                    const item = { nsfw: imageNsfw };
                    shouldBlurSlider = shouldBlurNSFW(item, subscriptionStatus);
                }
                
                // For NSFW images, use data-src instead of src to avoid exposing URL in console
                const imgSrc = shouldBlurSlider ? '/img/image-placeholder.gif' : imageUrl;
                const imgClass = shouldBlurSlider ? 'm-auto slider-image img-blur' : 'm-auto slider-image';
                const imgDataSrc = shouldBlurSlider ? `data-src="${imageUrl}"` : '';
                
                slidesHtml += `
                    <div class="swiper-slide">
                        <div class="position-relative">
                            <div onclick="showImagePreview(this)" 
                                 class="text-start assistant-image-box transition-none ${shouldBlurSlider ? 'isBlurred' : ''}" 
                                 data-id="${imageId}" 
                                 data-src="${imageUrl}">
                                <img src="${imgSrc}" 
                                     ${imgDataSrc}
                                     alt="${titleText}" 
                                     data-prompt="${imagePrompt || ''}" 
                                     class="${imgClass}" 
                                     data-id="${imageId}" 
                                     data-nsfw="${imageNsfw || false}"
                                     data-isUpscaled="${!!isUpscaled}"
                                     data-isMergeFace="${!!isMergeFace}"
                                     style="max-width: 100%; border-radius: 12px;">
                            </div>
                            ${!isUpscaled ? getImageTools({chatId, userChatId, imageId, isLiked:false, title: titleText, prompt: imagePrompt, nsfw: imageNsfw, imageUrl, isMergeFace}) : ''}
                        </div>
                    </div>
                `;
                
                // Add to thumbnail gallery
                displayImageThumb(imageId, imageUrl, origineUserChatId, shouldBlurSlider);
            });
            
            // Create message element with inline Swiper slider
            messageElement = $(`
                <div class="d-flex flex-row justify-content-start mb-4 message-container bot-image-slider ${animationClass}">
                    <img src="${thumbnail || '/img/logo.webp'}" alt="avatar" class="rounded-circle chatbot-image-chat" data-id="${chatId}" style="min-width: 45px; width: 45px; height: 45px; border-radius: 15%; object-fit: cover; object-position:top;" onclick="openCharacterInfoModal('${chatId}', event)">
                    <div class="ms-3 position-relative image-slider-container" style="max-width: 300px; width: 100%;">
                        <div class="swiper chat-image-swiper" id="${sliderId}" style="border-radius: 12px; overflow: hidden;">
                            <div class="swiper-wrapper">
                                ${slidesHtml}
                            </div>
                            <div class="swiper-button-prev" style="color: white; opacity: 0.8; transform: scale(0.6);"></div>
                            <div class="swiper-button-next" style="color: white; opacity: 0.8; transform: scale(0.6);"></div>
                        </div>
                    </div>
                </div>      
            `).hide();

            messageContainer.append(messageElement);
            messageElement.addClass(animationClass).fadeIn();
            
            // Initialize Swiper for this slider
            setTimeout(() => {
                const swiperElement = document.getElementById(sliderId);
                if (swiperElement && typeof Swiper !== 'undefined') {
                    const chatSwiper = new Swiper(`#${sliderId}`, {
                        loop: false,
                        slidesPerView: 1,
                        spaceBetween: 10,
                        navigation: {
                            nextEl: `#${sliderId} .swiper-button-next`,
                            prevEl: `#${sliderId} .swiper-button-prev`
                        },
                        // Specify that touch events target the wrapper element
                        touchEventsTarget: 'wrapper',
                        // Prevent swiping when touching image tools
                        allowTouchMove: true,
                        // Handle touch events to disable swiping on image tools
                        on: {
                            touchStart: function(swiper, event) {
                                // Check if the touch started on image tools container
                                const target = event.target;
                                const imageTools = target.closest('.image-tools');
                                if (imageTools) {
                                    // Disable swiper touch move when touching image tools
                                    swiper.allowTouchMove = false;
                                }
                            },
                            touchEnd: function(swiper, event) {
                                // Always re-enable touch move after touch ends
                                // This is safe because stopPropagation on image-tools prevents unwanted swipes
                                swiper.allowTouchMove = true;
                            }
                        }
                    });
                    
                    // Attach event listeners to prevent swiper interference with image tools scrolling
                    attachImageToolsEventListeners(swiperElement);
                }
                
                // Apply blur if needed
                if (shouldBlurSlider) {
                    $(`#${sliderId} .isBlurred img`).each(function() {
                        blurImage(this);
                    });
                }
                
                // Generate video icons for all images
                images.forEach(imgData => {
                    generateVideoIcon(imgData.imageId, chatId, userChatId);
                });
            }, 100);
            
            $('#chatContainer').animate({ scrollTop: $('#chatContainer')[0].scrollHeight }, 500);
        }

        else if (messageClass.startsWith('new-image-') && message instanceof HTMLElement) {
            const imageId = message.getAttribute('data-id');
            const imageNsfw = message.getAttribute('data-nsfw');
            const title = message.getAttribute('alt');
            const prompt = message.getAttribute('data-prompt');
            const imageUrl = message.getAttribute('src');
            const messageId = messageClass.split('new-image-')[1]
            messageElement = $(`
                    <div class="ms-3 position-relative">
                        <div 
                            onclick="showImagePreview(this)"
                            class="text-start assistant-image-box transition-none" data-id="${imageId}">
                            ${message.outerHTML}
                        </div>
                        ${getImageTools({chatId, userChatId, imageId, isLiked:false, title, prompt, nsfw: imageNsfw, imageUrl})}
                    </div>  
            `).hide();
            $(`#${messageId}`).find('.load').remove()
            $(`#${messageId}`).append(messageElement);
            generateVideoIcon(imageId, chatId, userChatId);
            messageElement.addClass(animationClass).fadeIn();
            displayImageThumb(imageId, imageUrl)
        } 
    
        else if (messageClass === 'assistant' && typeof message === 'string' && message.trim() !== '') {
            const uniqueId = `completion-${currentStep}-${Date.now()}`;
            messageElement = $(`
                <div class="d-flex flex-row justify-content-start position-relative mb-4 message-container ${animationClass}">
                    <img src="${thumbnail || '/img/logo.webp'}" alt="avatar" class="rounded-circle chatbot-image-chat" data-id="${chatId}" style="min-width: 45px; width: 45px; height: 45px; border-radius: 15%; object-fit: cover; object-position:top; cursor:pointer;" onclick="openCharacterInfoModal('${chatId}', event)">
                    <div class="audio-controller bg-dark">
                        <button id="play-${uniqueId}" 
                        class="audio-content badge bg-dark rounded-pill shadow-sm border-light" 
                        data-content="${message}">►</button>
                        <button id="download-${uniqueId}" 
                        class="audio-download badge bg-dark rounded-pill shadow-sm border-light ms-2" 
                        data-content="${message}"
                        aria-label="音声をダウンロード"
                        title="音声をダウンロード">
                            <i class="bi bi-download"></i>
                        </button>
                    </div>
                    <div id="${uniqueId}" class="p-3 ms-3 text-start assistant-chat-box position-relative">
                        ${marked.parse(message)}
                    </div>
                </div>
            `).hide();
            messageContainer.append(messageElement);
            messageElement.show().addClass(animationClass);
        }

        if (typeof callback === 'function') {
            callback();
        }
    };       


    
  // Fetch the user's IP address and generate a unique ID
    function appendHeadlineCharacterByCharacter($element, headline, callback) {
        let index = 0;

        const spinner = $(`<div class="spinner-grow spinner-grow-sm text-light" role="status"><span class="visually-hidden">Loading...</span></div>`)
        $element.append(spinner)
        $element.closest(`.message-container`).animate({ opacity: 1 }, 500, function() { 
            $element.addClass('d-flex')
            setTimeout(() => {
                spinner.css('visibility', 'hidden');
                setTimeout(() => {
                    let intervalID = setInterval(function() {
                        if (index < headline.length) {
                            $element.append(headline.charAt(index));
                            index++;
                        } else {
                            clearInterval(intervalID);
                            if (callback) callback();
                        }
                    }, 25);
                }, 100);
            }, 500);
        });


    }

    // Check if 'newSubscription' is true
    if (newSubscription) {
        // Display SweetAlert2 in Japanese
        Swal.fire({
            title: 'サブスクリプション成功',
            text: 'ご登録ありがとうございます！プレミアム機能をお楽しみください。',
            icon: 'success',
            confirmButtonText: '閉じる'
        });
    }
});

function logChatDataFetch(data){
    return; // Disable logging for now
    console.log('[logChatDataFetch] Chat data fetched:', data);
}
//.reset-chat,.new-chat
window.handleChatReset = function(el) {
    $(el).prop('disabled', true); // Disable the button to prevent multiple resets
    chatId = $(el).data('id') || localStorage.getItem('chatId');
    if (chatId == null) {
        console.error('[handleChatReset] No chatId found in localStorage');
        $(el).prop('disabled', false); // Re-enable if error
        return;
    }
    fetchChatData(chatId, userId, true, function() {
        $(el).prop('disabled', false); // Re-enable the button after reset completes
    });
};

window.regenImage = function(el){
    const button_ico = $(el).find('i');
    if(button_ico.hasClass('spin')){
        showNotification(window.translations.image_generation_processing,'warning')
        return
    }
    button_ico.addClass('spin')
    
    const imageNsfw = $(el).attr('data-nsfw') == 'true' ? 'nsfw' : 'sfw'
    const imagePrompt = $(el).data('prompt')
    const placeholderId = $(el).data('id')
    displayOrRemoveImageLoader(placeholderId, 'show');

    if($(el).hasClass('txt2img')){
        novitaImageGeneration(userId, chatId, userChatId, {prompt:imagePrompt, imageNsfw, placeholderId, regenerate:true})
        .then(data => {
            if(data.error){
                displayOrRemoveImageLoader(placeholderId, 'remove');
                button_ico.removeClass('spin');
            }
        })
        .catch((error) => {
            console.error('Error:', error);
            displayOrRemoveImageLoader(placeholderId, 'remove');
            button_ico.removeClass('spin');
        });
    }
};


// call fetchchatdata function accross other scripts
function callFetchChatData(fetch_chatId, fetch_userId, fetch_reset, callback){
    fetchChatData(fetch_chatId, fetch_userId, fetch_reset, callback);
}

window.enableToggleDropdown = function(el) {
    const dropdownToggle = $(el);
    if (!dropdownToggle.hasClass('event-attached')) {
        dropdownToggle.addClass('event-attached');

        // Initialize the dropdown
        const dropdown = new mdb.Dropdown(dropdownToggle[0]);

        // Find the parent element that has the hover effect
        const parent = dropdownToggle.closest('.chat-list');

        let hoverTimeout;

        // Add hover event listeners to the parent element
        parent.hover(
            function() {
                if (hoverTimeout) {
                    clearTimeout(hoverTimeout);
                }
                // When the parent element is hovered
                $(this).find('.dropdown-toggle').css({
                    'opacity': 1,
                    'pointer-events': ''
                });
            },
            function() {
                hoverTimeout = setTimeout(() => {
                    // When the parent element is no longer hovered
                    $(this).find('.dropdown-toggle').css({
                        'opacity': 1,
                        'pointer-events': 'none'
                    });
                    // Close the dropdown
                    dropdown.hide();
                }, 500);
            }
        );

        // Open the dropdown on the first click
        dropdownToggle.click();
    }
}
  
window.addMessageToChat = function(chatId, userChatId, option, callback) {
    const { message, role, name, hidden, image_request, imageUrl } = option;
    $.ajax({
        url: '/api/chat/add-message',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
            chatId: chatId,
            userChatId: userChatId,
            role: role,
            name: name || null,
            hidden: hidden || false,
            message: message,
            image_request: image_request || null,
            imageUrl: imageUrl || null
        }),
        success: function(response) {
            if(typeof callback == 'function'){
                callback(null, response);
            }
        },
        error: function(xhr, status, error) {
            if(typeof callback == 'function'){
                callback(error);
            }
        }
    });
}

window.resetChatUrl = function() {
    var currentUrl = window.location.href;
    var urlParts = currentUrl.split('/');
    urlParts[urlParts.length - 1] = '';
    var newUrl = urlParts.join('/');
    window.history.pushState({ path: newUrl }, '', newUrl);
    sessionStorage.setItem('lastChatId', null);
}

// Add this at the top of the file with other global variables
const upscaledImages = new Set();

window.upscaleImage = async function(imageId, imageUrl, chatId, userChatId) {
    try {
        const upscaleButton = $(`.upscale-img[data-id="${imageId}"]`);
        if (!imageId || !imageUrl) {
            showNotification('Invalid image data', 'error');
            return;
        }
        
        // Check if image has already been upscaled
        if (upscaledImages.has(imageId)) {
            showNotification(window.translations?.already_upscaled || 'This image has already been upscaled', 'warning');
            return;
        }
        
        if( upscaleButton.hasClass('disabled')) {
            showNotification(window.translations?.upscaling_in_progress || 'Upscaling in progress...', 'warning');
            return;
        }
        
        // Add to upscaled set to prevent duplicate upscaling
        upscaledImages.add(imageId);

        // Show loading notification
        showNotification(window.translations?.upscaling_image || 'Upscaling image...', 'info');

        // Disable the button
        upscaleButton.addClass('disabled').attr('disabled', true);
        upscaleButton.find('i').removeClass('bi-badge-hd').addClass('bi-badge-hd-fill text-success');
        
        // Convert image URL to base64
        const base64Response = await fetch('/api/convert-url-to-base64', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: imageUrl })
        });

        if (!base64Response.ok) {
            throw new Error('Failed to convert image to base64');
        }

        const { base64Image } = await base64Response.json();

        // Create placeholder for upscaled image
        const placeholderId = `upscale_${Date.now()}_${imageId}`;
        displayOrRemoveImageLoader(placeholderId, 'show');

        // Call upscale API
        const upscaleResponse = await fetch('/novita/upscale-img', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId,
                chatId,
                userChatId,
                originalImageId: imageId,
                image_base64: base64Image,
                originalImageUrl: imageUrl,
                placeholderId,
                scale_factor: 2,
                model_name: 'RealESRGAN_x4plus_anime_6B'
            })
        });

        if (!upscaleResponse.ok) {
            throw new Error('Failed to start upscale process');
        }

        const result = await upscaleResponse.json();
        
    } catch (error) {
        console.error('Error upscaling image:', error);
        // Remove from upscaled set if there was an error
        upscaledImages.delete(imageId);
        showNotification(window.translations?.upscale_error || 'Failed to upscale image', 'error');
    }
};

window.reloadCurrentChat = function() {
    // Check if the chat container is open (visible and has content)
    if ($('#chatContainer').is(':visible') && $('#chatContainer').children().length > 0 && chatId) {
        // Reload the current chat by fetching data again
        fetchChatData(chatId, userId);
    }
};