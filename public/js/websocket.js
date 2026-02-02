let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectInterval = 3000;
let currentSocket = null;
let isConnected = false;
let reconnectModal = null; // Track modal instance
let isReconnectModalShown = false; // Track modal state

function initializeWebSocket(onConnectionResult = null) {

  let socket;
  if (MODE === 'local') {
    const ip = location.hostname;
    socket = new WebSocket(`ws://${ip}:3000/ws?userId=${user._id}`);
  } else {
    socket = new WebSocket(`wss://app.chatlamix.com/ws?userId=${user._id}`);
  }

  currentSocket = socket;

  socket.onopen = () => {
    reconnectAttempts = 0; 
   if($('#chatContainer').is(':visible')) {
      // Call fetchChatData function to load chat data onyl once per reconnectInterval
      // This is to avoid multiple calls to fetchChatData when the user is on the chat page
      setTimeout(() => {
        if (!isConnected) {
          fetchChatData(chatId,user._id)
        }
      }, reconnectInterval);
    }
    isConnected = true;

    // After successful WebSocket reconnection, check for missed prompt completions
    if (window.promptManager) {
      window.promptManager.handleWebSocketReconnect();
    }

    // Notify reconnection attempt of success
    if (onConnectionResult) {
      onConnectionResult(true);
    }
  };

  socket.onerror = (error) => {
    console.error('[Websocket] Connection error:', error);
    isConnected = false;
    // Notify reconnection attempt of failure
    if (onConnectionResult) {
      onConnectionResult(false);
    }
  };

  socket.onmessage = (event) => {
    // Removed console.log('[WebSocket] Raw message received:', event.data);
    
    try {
      const data = JSON.parse(event.data);
      // Removed console.log('[WebSocket] Parsed message data:', data);
      
      if (data.notification) {
        // Try to handle with user points handler first
        if (window.webSocketUserPointsHandler && 
            window.webSocketUserPointsHandler.handlePointsMessage(data)) {
          return; // Message was handled by points handler
        }
        
        switch (data.notification.type) {
          case 'log':
            // Removed console.log(data.notification.message);
            break;
          case 'showNotification': {
            const { message, icon } = data.notification;
            showNotification(message, icon);
            break;
          }
          case 'imageModerationFlagged': {
            const { flagged, currentUserId } = data.notification;
            if(flagged){
              $(`[data-user-id="${currentUserId}"] #imageModerationFlagged`).show();
              $(`[data-user-id="${currentUserId}"] #profileImage`).addClass('flagged');
              $(`[data-user-id="${currentUserId}"] #profileImage`).attr('src', '/img/avatar.png');
            }else{
              $(`[data-user-id="${currentUserId}"] #imageModerationFlagged`).hide();
            }
            break;
          }
          case 'updateNotificationCountOnLoad': {
            const { userId } = data.notification;
            updateNotificationCountOnLoad(userId);

            if($('#chatContainer').is(':visible')) {
              fetchChatData(chatId,user._id)
            }
            break;
          }
          case 'addIconToLastUserMessage':
            addIconToLastUserMessage();
            break;
          case 'handleLoader': {
            const {imageId, action } = data.notification;
            console.log(`[WebSocket] handleLoader action: ${action} for imageId: ${imageId}`);
            displayOrRemoveImageLoader(imageId, action);
            break;
          }
          case 'handleVideoLoader': {
            const { placeholderId, action } = data.notification; // Use placeholderId consistently
            displayOrRemoveVideoLoader(placeholderId, action);
            break;
          }
          case 'videoGenerated': {
            const { videoId, videoUrl, duration, userChatId, placeholderId, taskId } = data.notification;

            if( userChatId == sessionStorage.getItem('userChatId')) {
              
              // Remove any existing loader for this placeholder
              removeVideoLoader(placeholderId);
              
              // Display the generated video
              displayGeneratedVideo({
                videoId,
                videoUrl,
                duration,
                userChatId,
                placeholderId,
                taskId
              });
              
              showNotification(window.translations.video_generation_completed || 'Video generated successfully!', 'success');
            } else {
              console.warn(`[WebSocket] UserChatId does not match. Ignoring video generation for videoId: ${videoId}`);
            }
            break;
          }
          case 'handleRegenSpin': {
            const {imageId, spin} = data.notification;
            handleRegenSpin(imageId, spin);
            break;
          }
          case 'registerAutoGeneration': {
            const { taskId, placeholderId, userChatId, startTime } = data.notification;
            
            // Register with PromptManager if available
            if (window.promptManager && window.promptManager.autoGenerations) {
                window.promptManager.autoGenerations.set(taskId, {
                    placeholderId,
                    startTime,
                    userChatId,
                    isAutoGeneration: true
                });
                
                if (window.MODE === 'development') {
                    console.log(`[WebSocket] Registered auto-generation: ${taskId}`);
                }
            }
            
            // Dispatch custom event for other listeners
            if (window.dispatchEvent) {
                window.dispatchEvent(new CustomEvent('registerAutoGeneration', {
                    detail: { taskId, placeholderId, userChatId, startTime }
                }));
            }
            break;
          }
          case 'imageGenerated': {
            const { userChatId, imageId, imageUrl, title, prompt, nsfw, isUpscaled, isMergeFace, batchId, batchIndex, batchSize } = data.notification;
            console.log(`[WebSocket] imageGenerated received - imageId: ${imageId}, isMergeFace: ${isMergeFace}, userChatId: ${userChatId}, batch: ${batchIndex + 1}/${batchSize}`);
            generateImage({
              userChatId,
              url: imageUrl,
              id:imageId,
              title,
              prompt,
              imageId, 
              nsfw, 
              isUpscaled,
              isMergeFace,
              batchId,
              batchIndex,
              batchSize
            });
            break;
          }
          case 'mergeFaceCompleted': {
            const { imageId, mergeId, mergedImageUrl, userChatId } = data.notification;
            console.log(`[WebSocket] mergeFaceCompleted received - mergeId: ${mergeId}, imageId: ${imageId}, userChatId: ${userChatId}`);
            
            // Dispatch custom event for merge-face.js to handle
            if (window.dispatchEvent) {
              window.dispatchEvent(new CustomEvent('mergeFaceCompleted', {
                detail: { imageId, mergeId, mergedImageUrl, userChatId }
              }));
            }
            
            // Also try to refresh existing merge results if modal is open
            if (typeof loadExistingMergeResults === 'function' && imageId) {
              loadExistingMergeResults(imageId);
            }
            
            break;
          }
          case 'updateChatData': {
            const { chatData } = data.notification;
            if (window.updateChatData) {
              window.updateChatData(chatData);
            }
            break;
          }
          case 'updateEnhancedPrompt': {
            const { enhancedPrompt } = data.notification;
            if (window.updateEnhancedPrompt) {
              window.updateEnhancedPrompt(enhancedPrompt);
            }
            break;
          }
          case 'characterImageGenerated':
            const { imageUrl, nsfw, chatId} = data.notification;
            const hasOldContainer = $('#imageContainer').length > 0;
            const hasNewContainer = $('#generatedImagesGrid').length > 0;
            
            console.log(`[WebSocket] characterImageGenerated received - chatId: ${chatId}, current window.chatCreationId: ${window.chatCreationId}`);
            console.log(`[WebSocket] #imageContainer exists: ${hasOldContainer}, #generatedImagesGrid exists: ${hasNewContainer}`);
            
            // Verify chatId matches current character creation (if set)
            if (window.chatCreationId && chatId && chatId !== window.chatCreationId) {
              console.log(`[WebSocket] ChatId mismatch - ignoring image. Expected: ${window.chatCreationId}, received: ${chatId}`);
              break;
            }
            
            // Check for new character creation container first
            if (hasNewContainer && window.characterCreation) {
              console.log(`[WebSocket] New character creation container found, appending image immediately`);
              console.log(`[WebSocket] Received imageUrl: ${imageUrl}`);
              
              // Track received images to avoid duplicates
              if (!window.receivedCharacterImages) {
                window.receivedCharacterImages = new Set();
              }
              
              // Check if this image URL was already received
              if (window.receivedCharacterImages.has(imageUrl)) {
                console.log(`[WebSocket] Duplicate imageUrl detected, skipping: ${imageUrl}`);
                break;
              }
              
              // Add to received set
              window.receivedCharacterImages.add(imageUrl);
              console.log(`[WebSocket] Total unique images received: ${window.receivedCharacterImages.size}`);
              
              // Append image immediately as it arrives (don't wait for all images)
              window.characterCreation.onImagesGenerated([imageUrl], true);
              
              // Stop polling after first image arrives since webhook is working
              if (window.characterCreation.stopPolling) {
                window.characterCreation.stopPolling();
              }
              
            } else if (hasOldContainer) {
              console.log(`[WebSocket] Old container found, processing image generation`);
              
              if (window.hideImageSpinner) {
                window.hideImageSpinner();
              }
              
              // Ensure sync before calling generateCharacterImage
              if (chatId && chatId !== window.chatCreationId) {
                console.log(`[WebSocket] Chat ID mismatch detected, syncing...`);
                if (window.syncChatCreationId) {
                  window.syncChatCreationId(chatId);
                }
              }
              
              generateCharacterImage(imageUrl, nsfw, chatId);
            } else {
              console.warn(`[WebSocket] Container not yet available, queuing for retry...`);
              
              // Queue the notification for processing once container is ready
              if (!window.pendingCharacterImages) {
                window.pendingCharacterImages = [];
              }
              
              window.pendingCharacterImages.push({ imageUrl, nsfw, chatId });
              console.log(`[WebSocket] Queued image. Total queued: ${window.pendingCharacterImages.length}`);
              
              // Retry checking for container every 500ms for up to 10 seconds
              let retryCount = 0;
              const maxRetries = 20;
              const retryInterval = setInterval(() => {
                retryCount++;
                console.log(`[WebSocket] Retry ${retryCount}/${maxRetries} - checking for containers`);
                
                const hasOld = $('#imageContainer').length > 0;
                const hasNew = $('#generatedImagesGrid').length > 0;
                
                if (hasNew && window.characterCreation) {
                  clearInterval(retryInterval);
                  console.log(`[WebSocket] New container now available! Processing queued images...`);
                  
                  const allImages = window.pendingCharacterImages.map(p => p.imageUrl);
                  window.characterCreation.onImagesGenerated(allImages);
                  window.pendingCharacterImages = [];
                } else if (hasOld) {
                  clearInterval(retryInterval);
                  console.log(`[WebSocket] Old container now available! Processing queued images...`);
                  
                  // Process all queued images
                  while (window.pendingCharacterImages && window.pendingCharacterImages.length > 0) {
                    const { imageUrl: queuedUrl, nsfw: queuedNsfw, chatId: queuedChatId } = window.pendingCharacterImages.shift();
                    console.log(`[WebSocket] Processing queued image - chatId: ${queuedChatId}`);
                    
                    // Sync if needed
                    if (queuedChatId && queuedChatId !== window.chatCreationId) {
                      if (window.syncChatCreationId) {
                        window.syncChatCreationId(queuedChatId);
                      }
                    }
                    
                    generateCharacterImage(queuedUrl, queuedNsfw, queuedChatId);
                  }
                } else if (retryCount >= maxRetries) {
                  clearInterval(retryInterval);
                  console.error(`[WebSocket] Container still not found after ${retryCount} retries. Discarding queued images.`);
                  window.pendingCharacterImages = [];
                }
              }, 500);
            }
            break;
          case 'resetCharacterForm':
            if ($('#imageContainer').length > 0) {
              if (window.hideImageSpinner) {
                window.hideImageSpinner();
              }
              resetCharacterForm();
            }
            break;
          case 'updateImageTitle': {
            const { imageId, title } = data.notification;
            updateImageTitle(imageId, title);
            break;
          }
          case 'updateCharacterGenerationMessage':
            if ($('.genexp').length) {
              const { mess } = data.notification;
              updateCharacterGenerationMess(mess);
            }
            break;
          case 'displayCompletionMessage': {
            const { message, uniqueId } = data.notification;
            displayCompletionMessage(message, uniqueId);
            break;
          }
          case 'hideCompletionMessage': {
            const { uniqueId } = data.notification;
            hideCompletionMessage(uniqueId);
            break;
          }
          case 'loadPlanPage':
            loadPlanPage();
            break;
          case 'updateCustomPrompt': {
            const { promptId } = data.notification;
            if (window.updateCustomPrompt) {
              window.updateCustomPrompt(promptId);
            }
            break;
          }
          case 'displaySimilarChats': {
            const { chatId, similarChats } = data.notification;
            console.log('[WebSocket] Displaying similar chats for chatId:', chatId, 'with data:', similarChats);
            if (window.displaySimilarChats) {
              window.displaySimilarChats(similarChats);
            }
            break;
          }
          case 'updateImageCount': {
            const { chatId, count } = data.notification;
            if (window.updateImageCount) {
              window.updateImageCount(chatId, count);
            }
            break;
          }
          case 'showChatSuggestions': {
              const { userId, chatId, userChatId } = data.notification;
              if (window.chatSuggestionsManager) {
                  window.chatSuggestionsManager.showSuggestions(userId, chatId, userChatId);
              }
              break;
          }
          case 'showScenariosGenerated': {
              // Scenarios are already generated and displayed from the frontend
              // No need to generate them again via WebSocket notification
              break;
          }
          case 'imageRequestDetectedPremiumRequired': {
              // Image request was detected but user needs premium to auto-generate
              const { message, chatId: notifChatId, userChatId: notifUserChatId } = data.notification;
              console.log('[WebSocket] Image request detected - premium required notification');
              
              // Show a notification to the user
              showNotification(message, 'info');
              
              // Optionally show premium upsell modal
              if (window.showPremiumUpsellModal) {
                  window.showPremiumUpsellModal('image_auto_generation');
              }
              break;
          }
          case 'nsfwUpsellTrigger': {
              // NSFW push detected - show premium upsell for uncensored mode
              const { message, nsfwCategory, nsfwScore, chatId: nsfwChatId, userChatId: nsfwUserChatId } = data.notification;
              console.log('[WebSocket] NSFW push detected - triggering premium upsell', { nsfwCategory, nsfwScore });
              
              // Show the NSFW upsell modal
              if (window.showNsfwPremiumUpsellModal) {
                  window.showNsfwPremiumUpsellModal(nsfwCategory, nsfwScore);
              } else {
                  // Fallback to standard notification
                  showNotification(message, 'info');
                  // Try generic premium modal if available
                  if (window.showPremiumUpsellModal) {
                      window.showPremiumUpsellModal('nsfw_uncensored');
                  }
              }
              break;
          }
          default:
            // Removed console.log('[WebSocket] Unhandled notification type:', data.notification.type);
            break;
        }
      } else {
        // Removed console.log('[WebSocket] Message without notification property:', data);
      }
    } catch (error) {
      console.error('[WebSocket] Error parsing message:', error);
      // Removed console.log('[WebSocket] Raw message that failed to parse:', event.data);
    }
  };

  socket.onclose = () => {
    isConnected = false;
    if (reconnectAttempts < maxReconnectAttempts) {
      console.warn(`[Websocket] Connection closed. Attempting to reconnect... ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
      setTimeout(() => {
        reconnectAttempts++;
        initializeWebSocket();
      }, reconnectInterval);
    } else {
      console.error('Max reconnect attempts reached. Could not reconnect to WebSocket.');
      // Call a module to ask the user to retry or refresh the page
      if (window.showReconnectPrompt && window.MODE === 'local') {
        window.showReconnectPrompt();
      } else {
        console.error('No reconnect prompt function available.');
      }
    }
  };

  socket.onerror = (error) => {
    isConnected = false;
  }
}

// Initialize WebSocket
initializeWebSocket();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (!currentSocket || currentSocket.readyState === WebSocket.CLOSED) {
      // Removed console.log("Tab resumed. Attempting to reconnect WebSocket...");
      initializeWebSocket();
    }
  }
});

// Handle reconnect attempts after a failed connection
window.showReconnectPrompt = function() {
    // Prevent multiple modals from being created
    if (isReconnectModalShown) {
        return;
    }
    
    // Dispose of any existing modal instance
    if (reconnectModal) {
        reconnectModal.dispose();
        reconnectModal = null;
    }
    
    // Remove any existing backdrop manually
    const existingBackdrops = document.querySelectorAll('.modal-backdrop');
    existingBackdrops.forEach(backdrop => backdrop.remove());
    
    isReconnectModalShown = true;
    
    reconnectModal = new bootstrap.Modal(document.getElementById('reconnectModal'), {
        backdrop: 'static',
        keyboard: false
    });
    
    const retryBtn = document.getElementById('retryConnectionBtn');
    const refreshBtn = document.getElementById('refreshPageBtn');
    const statusDiv = document.getElementById('reconnectStatus');
    const statusText = document.getElementById('reconnectStatusText');
    
    let retryAttempts = 0;
    const maxRetryAttempts = 5;
    
    // Reset button states
    retryBtn.disabled = false;
    refreshBtn.disabled = false;
    statusDiv.style.display = 'none';
    
    // Retry connection handler
    retryBtn.onclick = function() {
        retryBtn.disabled = true;
        refreshBtn.disabled = true;
        statusDiv.style.display = 'block';
        retryAttempts = 0;
        
        attemptReconnection();
    };
    
    // Refresh page handler
    refreshBtn.textContent = window.translations.reconnect.refresh_page || 'Refresh Page';
    refreshBtn.onclick = function() {
        setTimeout(() => {
          window.location.reload();
        }, 2000);
    };
    
    function attemptReconnection() {
        if (retryAttempts >= maxRetryAttempts) {
            statusText.textContent = window.translations.reconnect.failed;
            statusDiv.querySelector('.spinner-border').style.display = 'none';
            retryBtn.disabled = false;
            refreshBtn.disabled = false;
            return;
        }
        
        retryAttempts++;
        statusText.textContent = `${window.translations.reconnect.attempting} (${retryAttempts}/${maxRetryAttempts})`;
        
        // Reset reconnect attempts counter for websocket
        reconnectAttempts = 0;
        
        // Try to initialize websocket with callback
        try {
            initializeWebSocket((success) => {
                if (success) {
                  // Successfully reconnected, check for missed prompt completions
                  if (window.promptManager) {
                    window.promptManager.handleWebSocketReconnect();
                  }
                  // Successfully reconnected, close modal
                  reconnectModal.hide();
                  window.showNotification(window.translations.reconnect.success, 'success');
                } else {
                  // Connection failed, try again after delay
                  setTimeout(attemptReconnection, 2000);
                }
            });
            
        } catch (error) {
            console.error('Reconnection attempt failed:', error);
            setTimeout(attemptReconnection, 2000);
        }
    }
    
    // Handle modal cleanup when hidden
    reconnectModal._element.addEventListener('hidden.bs.modal', function() {
        isReconnectModalShown = false;
        if (reconnectModal) {
            reconnectModal.dispose();
            reconnectModal = null;
        }
        // Ensure backdrop is removed
        const backdrops = document.querySelectorAll('.modal-backdrop');
        backdrops.forEach(backdrop => backdrop.remove());
    });
    
    reconnectModal.show();
};