/**
 * Custom Prompts Management
 * Handles all client-side operations for the custom image prompts tool.
 */
class PromptManager {
    constructor() {
        this.activeGenerations = new Map();
        this.autoGenerations = new Map(); 
        this.pollInterval = null;
        this.bindEvents();
        this.startPolling();
    }

    // Helper function to check if we're in development mode
    isDevelopmentMode() {
        return window.MODE === 'development' || window.location.hostname === 'localhost';
    }

    bindEvents() {
        // Click handler for the main show/hide prompts button
        $(document).off('click', '#showPrompts, .showPrompts-toggle').on('click', '#showPrompts, .showPrompts-toggle', () => {
            const $promptContainer = $('#promptContainer');
            if ($promptContainer.hasClass('visible')) {
                this.hide();
            } else {
                this.show();
            }
        });

        // Click handler for the close button inside the prompt container
        $('#close-promptContainer').on('click', () => {
            this.hide();
        });

        // Pose filter toggle event handler
        this.bindPoseFilterEvents();

        // Click handler for individual prompt cards
        $(document).off('click', '.prompt-card').on('click', '.prompt-card', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $card = $(e.currentTarget);

            if ($card.hasClass('inactive')) {
                const cost = $card.data('cost');
                showNotification(`${window.userPointsTranslations?.need_coins?.replace('{coins}', cost) || `Need: ${cost}`}`, 'warning');
                openBuyPointsModal();
                return;
            }

            if ($card.hasClass('active')) {
                $('.prompt-card').removeClass('selected');
                $card.addClass('selected');

                const promptId = $card.data('id');
                const imageNsfw = $card.data('nsfw') ? 'nsfw' : 'sfw';
                const imagePreview = new URL($card.find('img').attr('data-src') || $card.find('img').attr('src'), window.location.origin).href;

                // Check custom prompt settings

                const defaultDescriptionEnabled = window.chatToolSettings?.getDefaultDescriptionEnabled() ?? false;
                let description = '';
                if (defaultDescriptionEnabled) {
                    description = window.chatToolSettings?.getDefaultDescription() ?? '';
                }

                const customPromptEnabled = window.chatToolSettings?.getCustomPromptEnabled() ?? true;
                if (customPromptEnabled) {
                    description = await this.showCustomPromptModal(description);
                }

                // Send the prompt image generation request if the user didn't cancel
                if (description === null) {
                    this.hide();
                    return;
                }
                
                this.sendPromptImageDirectly(promptId, imageNsfw, imagePreview, description);
                this.hide();
            }
        });

    }

    // Show modal for custom prompt description input
    showCustomPromptModal(initialDescription = '') {
        return new Promise((resolve) => {
            const translations = window.translations || {};
            const modalTitle = translations.customPromptModal?.title || "Custom Prompt Description";
            const modalSubtitle = translations.customPromptModal?.subtitle || "Enter additional description for the image generation";
            const labelText = translations.customPromptModal?.label || "Description (optional)";
            const placeholderText = translations.customPromptModal?.placeholder || "e.g., in a futuristic setting, with dramatic lighting...";
            const generateButtonText = translations.customPromptModal?.generateButton || "Generate Image";
            const cancelButtonText = translations.customPromptModal?.cancelButton || "Cancel";
            const enhanceButtonText = translations.customPromptModal?.enhanceButton || "✨ Enhance with AI";
            const styleTags = translations.customPromptModal?.styleTags || "Quick Style Tags:";
            
            const modalHtml = `
                <div class="modal fade" id="customPromptModal" tabindex="-1" aria-labelledby="customPromptModalLabel" aria-hidden="true">
                    <div class="modal-dialog modal-dialog-centered">
                        <div class="modal-content mx-auto" style="height: auto;">
                            <div class="modal-header">
                                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                                <h5 class="modal-title" id="customPromptModalLabel">
                                    <i class="bi bi-image"></i>
                                    ${modalTitle}
                                </h5>
                            </div>
                            <div class="modal-body">
                                <div class="mb-3">
                                    <label for="customPromptTextarea" class="form-label">
                                        ${labelText}
                                    </label>
                                    <p class="form-text">
                                        ${modalSubtitle}
                                    </p>
                                    <div class="position-relative">
                                        <textarea 
                                            class="form-control" 
                                            id="customPromptTextarea" 
                                            rows="6" 
                                            maxlength="500" 
                                            placeholder="${placeholderText}"
                                        ></textarea>
                                        <div class="d-flex gap-2 mt-1">
                                            <button 
                                                type="button" 
                                                class="btn btn-sm flex-grow-1" 
                                                id="enhancePromptBtn"
                                                title="Enhance your description with AI"
                                            >
                                                ${enhanceButtonText}
                                            </button>
                                            <button 
                                                type="button" 
                                                class="btn btn-sm btn-outline-danger" 
                                                id="clearPromptBtn"
                                                title="Clear the text area"
                                            >
                                                <i class="bi bi-eraser"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="form-text d-flex justify-content-between align-items-center">
                                        <span><span id="customCharCount">0</span>/500 characters</span>
                                        <span id="enhanceStatus"></span>
                                    </div>
                                </div>
                                
                                <!-- Style Tags Section -->
                                <div class="mb-3">
                                    <label class="form-label">
                                        <i class="bi bi-tags"></i>
                                        ${styleTags}
                                    </label>
                                    <div id="styleTagsContainer" class="d-flex flex-wrap gap-2">
                                        <button type="button" class="btn btn-sm style-tag-btn" data-style="cinematic">
                                            <i class="bi bi-film"></i>Cinematic
                                        </button>
                                        <button type="button" class="btn btn-sm style-tag-btn" data-style="anime">
                                            <i class="bi bi-palette"></i>Anime
                                        </button>
                                        <button type="button" class="btn btn-sm style-tag-btn" data-style="portrait">
                                            <i class="bi bi-person-circle"></i>Portrait
                                        </button>
                                        <button type="button" class="btn btn-sm style-tag-btn" data-style="photorealistic">
                                            <i class="bi bi-camera"></i>Photorealistic
                                        </button>
                                        <button type="button" class="btn btn-sm style-tag-btn" data-style="artistic">
                                            <i class="bi bi-brush"></i>Artistic
                                        </button>
                                        <button type="button" class="btn btn-sm style-tag-btn" data-style="dramatic">
                                            <i class="bi bi-lightning"></i>Dramatic
                                        </button>
                                        <button type="button" class="btn btn-sm style-tag-btn" data-style="casual">
                                            <i class="bi bi-sunglasses"></i>Casual
                                        </button>
                                        <button type="button" class="btn btn-sm style-tag-btn" data-style="elegant">
                                            <i class="bi bi-gem"></i>Elegant
                                        </button>
                                        <button type="button" class="btn btn-sm style-tag-btn" data-style="action">
                                            <i class="bi bi-activity"></i>Action
                                        </button>
                                        <button type="button" class="btn btn-sm style-tag-btn" data-style="romantic">
                                            <i class="bi bi-heart"></i>Romantic
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                                    ${cancelButtonText}
                                </button>
                                <button type="button" class="btn btn-primary" id="generateCustomPromptBtn">
                                    <i class="bi bi-image"></i>
                                    ${generateButtonText}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Remove existing modal if any
            $('#customPromptModal').remove();
            
            // Add modal to body
            $('body').append(modalHtml);
            
            const modal = new bootstrap.Modal(document.getElementById('customPromptModal'));
            const textarea = $('#customPromptTextarea');
            const charCount = $('#customCharCount');
            const generateBtn = $('#generateCustomPromptBtn');
            const enhanceBtn = $('#enhancePromptBtn');
            const enhanceStatus = $('#enhanceStatus');

            // Save and restore last prompt using localStorage
            const lastPromptKey = 'custom_prompt_last_prompt';
            const savedPrompt = localStorage.getItem(lastPromptKey);
            if (savedPrompt && !initialDescription) {
                // Restore last saved prompt if no initial description is provided
                textarea.val(savedPrompt);
                charCount.text(savedPrompt.length);
            } else if (initialDescription) {
                // Set initial description if provided
                textarea.val(initialDescription);
                charCount.text(initialDescription.length);
            }

            // Character counter
            textarea.on('input', function() {
                const length = $(this).val().length;
                charCount.text(length);
                
                if (length > 500) {
                    charCount.addClass('text-danger');
                } else {
                    charCount.removeClass('text-danger');
                }

                localStorage.setItem(lastPromptKey, $(this).val());
            });

            // Enhance button click
            enhanceBtn.on('click', async function() {
                const description = textarea.val().trim();
                
                if (!description) {
                    enhanceStatus.text('Please enter a description first').addClass('text-warning');
                    setTimeout(() => enhanceStatus.text('').removeClass('text-warning'), 3000);
                    return;
                }

                // Show loading state
                enhanceBtn.prop('disabled', true);
                enhanceStatus.text('Enhancing...').removeClass('text-warning text-success').addClass('text-info');
                const originalBtnText = enhanceBtn.html();
                enhanceBtn.html('<span class="spinner-border spinner-border-sm me-1"></span>Enhancing...');

                try {
                    const chatId = sessionStorage.getItem('chatId') || window.chatId;
                    const response = await fetch('/api/custom-prompt/enhance', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ description, chatId })
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({ error: 'Enhancement failed' }));
                        throw new Error(errorData.error || 'Enhancement failed');
                    }

                    const data = await response.json();
                    
                    if (data.success && data.enhanced) {
                        // Truncate if exceeds limit
                        const enhanced = data.enhanced.length > 500 ? data.enhanced.substring(0, 500) : data.enhanced;
                        textarea.val(enhanced);
                        charCount.text(enhanced.length);
                        localStorage.setItem(lastPromptKey, enhanced);
                        enhanceStatus.text('Enhanced! ✨').removeClass('text-info').addClass('text-success');
                        setTimeout(() => enhanceStatus.text('').removeClass('text-success'), 3000);
                    } else {
                        throw new Error(data.error || 'Enhancement failed');
                    }
                } catch (error) {
                    console.error('Error enhancing prompt:', error);
                    enhanceStatus.text('Enhancement failed').removeClass('text-info').addClass('text-warning');
                    setTimeout(() => enhanceStatus.text('').removeClass('text-warning'), 3000);
                } finally {
                    enhanceBtn.prop('disabled', false);
                    enhanceBtn.html(originalBtnText);
                }
            });

            // Clear button click
            const clearBtn = $('#clearPromptBtn');
            clearBtn.on('click', function() {
                textarea.val('');
                charCount.text('0');
                localStorage.removeItem(lastPromptKey);
            });

            // Style tag buttons click
            $('.style-tag-btn').on('click', async function() {
                const styleTag = $(this).data('style');
                const $btn = $(this);
                
                // Show loading state
                $btn.prop('disabled', true);
                const originalBtnHtml = $btn.html();
                $btn.html('<span class="spinner-border spinner-border-sm"></span>');
                enhanceStatus.text('Generating...').removeClass('text-warning text-success').addClass('text-info');

                try {
                    const chatId = sessionStorage.getItem('chatId') || window.chatId;
                    const response = await fetch('/api/custom-prompt/generate-from-tag', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ styleTag, chatId })
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({ error: 'Generation failed' }));
                        throw new Error(errorData.error || 'Generation failed');
                    }

                    const data = await response.json();
                    
                    if (data.success && data.prompt) {
                        // Truncate if exceeds limit
                        const prompt = data.prompt.length > 500 ? data.prompt.substring(0, 500) : data.prompt;
                        textarea.val(prompt);
                        charCount.text(prompt.length);
                        localStorage.setItem(lastPromptKey, prompt);
                        enhanceStatus.text('Generated! 🎨').removeClass('text-info').addClass('text-success');
                        setTimeout(() => enhanceStatus.text('').removeClass('text-success'), 3000);
                    } else {
                        throw new Error(data.error || 'Generation failed');
                    }
                } catch (error) {
                    console.error('Error generating prompt from tag:', error);
                    enhanceStatus.text('Generation failed').removeClass('text-info').addClass('text-warning');
                    setTimeout(() => enhanceStatus.text('').removeClass('text-warning'), 3000);
                } finally {
                    $btn.prop('disabled', false);
                    $btn.html(originalBtnHtml);
                }
            });

            // Generate button click
            generateBtn.on('click', function() {
                const description = textarea.val().trim();
                modal.hide();
                resolve(description);
            });

            // Modal close events
            $('#customPromptModal').on('hidden.bs.modal', function() {
                $(this).remove();
                resolve(null);
            });

            // Show modal
            modal.show();
            
            // Focus textarea
            $('#customPromptModal').on('shown.bs.modal', function() {
                textarea.focus();
            });
        });
    }

    // Bind pose filter toggle events
    bindPoseFilterEvents() {
        const $toggle = $('#poseFilterToggle');
        const $buttons = $toggle.find('.pose-filter-btn');
        const $slider = $toggle.find('.pose-filter-slider');

        // Initialize slider position and width
        this.updateSliderPosition($toggle, $buttons.filter('.active'), $slider);

        // Click handler for filter buttons
        $buttons.on('click', (e) => {
            const $clickedBtn = $(e.currentTarget);
            const filter = $clickedBtn.data('filter');

            // Update active state
            $buttons.removeClass('active');
            $clickedBtn.addClass('active');

            // Update toggle data attribute for color changes
            $toggle.attr('data-active', filter);

            // Animate slider to new position
            this.updateSliderPosition($toggle, $clickedBtn, $slider);

            // Apply filter to pose cards
            this.filterPoseCards(filter);
            
            // Save filter preference to localStorage
            localStorage.setItem('pose_filter_preference', filter);
        });

        // Restore saved filter preference
        const savedFilter = localStorage.getItem('pose_filter_preference') || 'all';
        const $savedBtn = $buttons.filter(`[data-filter="${savedFilter}"]`);
        if ($savedBtn.length && savedFilter !== 'all') {
            $savedBtn.trigger('click');
        }
    }

    // Update slider position and width
    updateSliderPosition($toggle, $activeBtn, $slider) {
        if (!$activeBtn.length) return;
        
        const btnLeft = $activeBtn.position().left;
        const btnWidth = $activeBtn.outerWidth();
        
        $slider.css({
            left: btnLeft + 'px',
            width: btnWidth + 'px'
        });
    }

    // Filter pose cards based on SFW/NSFW selection
    filterPoseCards(filter) {
        const $cards = $('.prompt-card');
        const $promptList = $('#promptList');
        
        // Remove any existing empty state
        $promptList.find('.pose-empty-state').remove();
        
        let visibleCount = 0;

        $cards.each(function() {
            const $card = $(this);
            const isNsfw = $card.data('nsfw') === true || $card.data('nsfw') === 'true';
            
            let shouldShow = false;
            
            switch (filter) {
                case 'all':
                    shouldShow = true;
                    break;
                case 'sfw':
                    shouldShow = !isNsfw;
                    break;
                case 'nsfw':
                    shouldShow = isNsfw;
                    break;
            }
            
            if (shouldShow) {
                $card.removeClass('pose-filtered-hidden pose-filtering-out');
                $card.addClass('pose-filtering-in');
                visibleCount++;
                
                // Remove animation class after animation completes
                setTimeout(() => {
                    $card.removeClass('pose-filtering-in');
                }, 300);
            } else {
                $card.addClass('pose-filtering-out');
                
                // Hide after animation
                setTimeout(() => {
                    $card.addClass('pose-filtered-hidden').removeClass('pose-filtering-out');
                }, 200);
            }
        });

        // Show empty state if no poses match the filter
        if (visibleCount === 0) {
            const emptyStateHtml = `
                <div class="pose-empty-state">
                    <i class="bi bi-${filter === 'sfw' ? 'shield-check' : 'fire'}"></i>
                    <p>${filter === 'sfw' ? 
                        (window.translations?.poseFilter?.noSfwPoses || 'No SFW poses available') : 
                        (window.translations?.poseFilter?.noNsfwPoses || 'No NSFW poses available')
                    }</p>
                </div>
            `;
            $promptList.append(emptyStateHtml);
        }
    }

    // Show the main prompt container
    show() {
        $('#promptContainer').hide().addClass('visible').slideDown('fast');
        $('#suggestions').removeClass('d-flex').hide();
        
        // Re-initialize slider position after container is visible
        setTimeout(() => {
            const $toggle = $('#poseFilterToggle');
            const $activeBtn = $toggle.find('.pose-filter-btn.active');
            const $slider = $toggle.find('.pose-filter-slider');
            this.updateSliderPosition($toggle, $activeBtn, $slider);
        }, 100);
    }

    // Hide the main prompt container
    hide() {
        $('#promptContainer').removeClass('visible').slideUp('fast');
        $('#suggestions').addClass('d-flex').show();
        this.removePromptFromMessage();
    }

    // Update prompts based on user's points
    async update(userId) {
        try {
            const res = await fetch(`/api/custom-prompts/${userId}`);
            if (!res.ok) {
                console.error('Failed to fetch custom prompts data.');
                $('.prompt-card').addClass('inactive').removeClass('active');
                return;
            }
            
            const promptData = await res.json();
            const userPoints = promptData.userPoints;

            $('.prompt-card').each(function() {
                const $card = $(this);
                const promptId = $card.data('id');
                const promptInfo = promptData.prompts.find(p => p.promptId === promptId);

                if (!promptInfo) {
                    $card.addClass('inactive').removeClass('active');
                    return;
                }
                
                if (promptInfo.canAfford) {
                    $card.addClass('active').removeClass('inactive').removeAttr('title');
                } else {
                    $card.addClass('inactive').removeClass('active');
                    $card.attr('title', 
                        `${window.userPointsTranslations?.need_coins?.replace('{coins}', promptInfo.cost) || `Need: ${promptInfo.cost}`}, ${window.userPointsTranslations?.have_coins?.replace('{coins}', userPoints) || `Have: ${userPoints}`}`
                    );
                }
            });

        } catch (e) {
            console.error('Error updating custom prompts:', e);
            $('.prompt-card').addClass('inactive').removeClass('active');
        }
        
        if (window.updatePromptActivatedCounter) {
            window.updatePromptActivatedCounter();
        }
    }

    // Send the selected prompt to generate an image
    sendPromptImageDirectly(promptId, imageNsfw, imagePreview, description) {
        const placeholderId = `${new Date().getTime()}_${Math.random().toString(36).substring(2, 8)}_${promptId}`;
        
        // Check if this prompt is already being generated
        if (this.activeGenerations.has(promptId)) {
            if (this.isDevelopmentMode()) {
                console.warn(`Prompt ${promptId} is already being generated`);
            }
            showNotification('Image generation for this prompt is already in progress', 'warning');
            return;
        }
        let c_userChatId = sessionStorage.getItem('userChatId');
        let c_chatId = sessionStorage.getItem('chatId');
        // Store generation metadata
        this.activeGenerations.set(promptId, {
            placeholderId,
            startTime: Date.now(),
            userChatId: c_userChatId || window.userChatId,
            imagePreview
        });
        
        displayOrRemoveImageLoader(placeholderId, 'show', imagePreview);
        
            // Get prompt from promptId
            const promptTitle = $('.prompt-card[data-id="' + promptId + '"]').find('.prompt-image').attr('alt')
            
        // Add a new message to the chat container for sending a gift
        /*
        addMessageToChat(c_chatId, c_userChatId, {
            role: 'user',
            message: window.translations.sendPoseRequest + promptTitle +' '+ description,
            name: 'pose_request',
            hidden: true
        }, function(error, res) {

            //generateChatCompletion(null, false, true);

            if (error) {
            console.error('Error adding gift message:', error);
            }
        });
        */

        const chatId = sessionStorage.getItem('chatId') || window.chatId;
        const userChatId = sessionStorage.getItem('userChatId') || window.userChatId;
        
        novitaImageGeneration(window.user._id, chatId, userChatId, { 
            placeholderId, 
            imageNsfw, 
            promptId, 
            customPrompt: true,
            description
        })
        .then(() => {
            if (this.isDevelopmentMode()) {
                console.log(`[PromptManager] Image generation started for prompt ${promptId}`);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            displayOrRemoveImageLoader(placeholderId, 'remove');
            this.activeGenerations.delete(promptId);
        });
    }

    // Start polling for completed tasks
    startPolling() {
        // Poll every 30 seconds if there are active generations
        this.pollInterval = setInterval(() => {
            if (this.activeGenerations.size > 0) {
                if (this.isDevelopmentMode()) {
                    console.log(`[PromptManager] Polling for ${this.activeGenerations.size} active generations`);
                }
                this.checkActiveGenerations();
            }
        }, 30000); // 30 seconds
    }
    
    bindAutoGenerationEvents() {
        // Listen for auto-generation registration from WebSocket
        if (window.addEventListener) {
            window.addEventListener('registerAutoGeneration', (event) => {
                const { taskId, placeholderId, userChatId, startTime } = event.detail;
                this.autoGenerations.set(taskId, {
                    placeholderId,
                    startTime,
                    userChatId,
                    isAutoGeneration: true
                });
                
                if (this.isDevelopmentMode()) {
                    console.log(`[PromptManager] Registered auto-generation: ${taskId}`);
                }
            });
        }
    }

    // Update checkActiveGenerations to include auto-generations
    async checkActiveGenerations() {
        const userChatId = sessionStorage.getItem('userChatId') || window.userChatId;
        
        if (!userChatId) {
            if (this.isDevelopmentMode()) {
                console.warn('[PromptManager] No userChatId found for polling');
            }
            return;
        }

        try {
            const response = await fetch(`/api/background-tasks/${userChatId}`);
            if (!response.ok) {
                console.error('[PromptManager] Failed to fetch background tasks');
                return;
            }

            const data = await response.json();
            const completedTasks = data.tasks || [];

            // Check both prompt generations and auto-generations
            const allGenerations = new Map([...this.activeGenerations, ...this.autoGenerations]);

            for (const [generationId, metadata] of allGenerations.entries()) {
                // Check if task has been running for more than 5 minutes (timeout)
                if (Date.now() - metadata.startTime > 5 * 60 * 1000) {
                    if (this.isDevelopmentMode()) {
                        console.warn(`[PromptManager] Task ${generationId} timed out, cleaning up`);
                    }
                    displayOrRemoveImageLoader(metadata.placeholderId, 'remove');
                    this.activeGenerations.delete(generationId);
                    this.autoGenerations.delete(generationId);
                    continue;
                }

                // Check if this generation is completed
                const completedTask = completedTasks.find(task => 
                    task.placeholderId === metadata.placeholderId || 
                    task.customPromptId === generationId ||
                    task.taskId === generationId // Add taskId matching for auto-generations
                );

                if (completedTask && completedTask.status === 'completed') {
                    if (this.isDevelopmentMode()) {
                        console.log(`[PromptManager] Found completed task for ${generationId}:`, completedTask);
                    }
                    
                    // Remove the loader
                    displayOrRemoveImageLoader(metadata.placeholderId, 'remove');
                    
                    // Process completed images
                    if (completedTask.result?.images && Array.isArray(completedTask.result.images)) {
                        for (const image of completedTask.result.images) {
                            if (this.isDevelopmentMode()) {
                                console.log(`[PromptManager] Processing completed image:`, image);
                            }
                            
                            // Generate the image using the existing generateImage function
                            await generateImage({
                                imageId: image.imageId,
                                imageUrl: image.imageUrl,
                                userChatId: metadata.userChatId,
                                prompt: image.prompt,
                                title: image.title,
                                nsfw: image.nsfw,
                                isUpscaled: image.isUpscaled,
                                isMerged: image.isMerged
                            });
                        }
                    }
                    
                    // Clean up from both maps
                    this.activeGenerations.delete(generationId);
                    this.autoGenerations.delete(generationId);
                }
            }
        } catch (error) {
            console.error('[PromptManager] Error checking active generations:', error);
        }
    }
    
    // Clean up method for when WebSocket reconnects
    handleWebSocketReconnect() {
        if (this.activeGenerations.size > 0) {
            this.checkActiveGenerations();
        }
    }

    // Remove prompt image from the message input area
    removePromptFromMessage() {
        const userMessage = $('#userMessage');
        userMessage.css('background-image', 'none');
        userMessage.removeClass('prompt-image');
        userMessage.removeAttr('data-prompt-id');
        userMessage.removeAttr('data-nsfw');
        userMessage.attr('placeholder', window.translations?.sendMessage || 'Send a message...'); 
    }

    // Cleanup method
    destroy() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
    }
}

$(document).ready(() => {
    window.promptManager = new PromptManager();
});