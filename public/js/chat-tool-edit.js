

    window.openEditModal = async function(imageId, chatId, userChatId) {
        const img = $('img[data-id="' + imageId + '"]');
        const imageUrl = img.attr('src');
        const imagePrompt = img.attr('data-prompt') || '';
        if(!imageUrl) {
            showNotification('Image not found.', 'error');
            return;
        }
        const originalPrompt = img.attr('data-prompt') || '';
        const title = img.attr('data-title') || '';
        const nsfw = img.attr('data-nsfw') === 'true';

        const allImageModels = (window.GEN_DASHBOARD_CONFIG?.imageModels || []).filter(Boolean);
        let img2imgModels = allImageModels.filter(model => model.category === 'img2img');
        if (img2imgModels.length === 0) {
            img2imgModels = allImageModels.filter(model => model.supportsImg2Img && model.requiresImage);
        }
        const lastModelKey = 'edit_prompt_last_model_id';
        let selectedModelId = localStorage.getItem(lastModelKey) || (img2imgModels[0]?.id || img2imgModels[0]?.modelId || '');

        const modalId = `editModal-${imageId}`;
        const modalHtml = `
            <div class="modal fade" id="${modalId}" tabindex="-1" aria-labelledby="${modalId}Label" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
                    <div class="modal-content mx-auto" style="height: auto;">
                        <div class="modal-header d-flex align-items-center justify-content-center position-relative border-bottom-0 pb-2">
                            <button type="button" class="btn-close btn-close-white ms-0 position-absolute start-0 ms-3" data-bs-dismiss="modal" aria-label="Close" style="margin-left: 1rem !important;"></button>
                            <div class="text-center">
                                <h5 class="modal-title" id="${modalId}Label">
                                    <i class="bi bi-pencil me-2"></i>
                                    Edit Image
                                </h5>
                                <span class="text-white-50 small d-block">Modify attributes of the original image</span>
                            </div>
                        </div>
                        <div class="modal-body">
                            <div class="text-center mb-4">
                                <div class="edit-image-preview-container" style="position: relative; display: inline-block;">
                                    <img src="${imageUrl}" class="rounded shadow-lg" style="max-width: 100%; max-height: 250px; border: 2px solid rgba(255,255,255,0.1);" alt="Image to edit" />
                                    <div class="position-absolute top-0 end-0 m-2">
                                        <span class="badge bg-dark bg-opacity-75">Original</span>
                                    </div>
                                </div>
                            </div>

                            <div class="mb-4">
                                <label class="form-label fw-bold small text-uppercase tracking-wider">
                                    <i class="bi bi-lightning-charge me-1"></i>
                                    Edit Strength
                                </label>
                                <div class="d-flex justify-content-center gap-2" id="editStrengthBadges-${imageId}">
                                    <button type="button" class="btn btn-outline-primary flex-fill edit-strength-btn" data-strength="low">Low</button>
                                    <button type="button" class="btn btn-outline-primary flex-fill edit-strength-btn active" data-strength="medium">Medium</button>
                                    <button type="button" class="btn btn-outline-primary flex-fill edit-strength-btn" data-strength="high">High</button>
                                </div>
                                <div class="form-text text-center mt-2 small">
                                    Low = subtle changes, High = significant transformation
                                </div>
                            </div>

                            <div class="mb-4">
                                <label class="form-label fw-bold small text-uppercase tracking-wider">
                                    <i class="bi bi-cpu me-1"></i>
                                    Model
                                </label>
                                ${img2imgModels.length ? `
                                    <div class="dropdown w-100" id="editModelDropdown-${imageId}">
                                        <button class="btn btn-dark w-100 d-flex align-items-center justify-content-between p-3 border-secondary" type="button" id="modelTrigger-${imageId}" data-bs-toggle="dropdown" aria-expanded="false" style="border-radius: 12px; background: rgba(255,255,255,0.05);">
                                            <div class="d-flex align-items-center gap-3 overflow-hidden text-start">
                                                <div class="bg-primary bg-gradient rounded-3 d-flex align-items-center justify-content-center shadow-sm" style="width: 38px; height: 38px; flex-shrink: 0;">
                                                    <i class="bi bi-magic text-white fs-5"></i>
                                                </div>
                                                <div class="overflow-hidden">
                                                    <div class="fw-bold text-white mb-0 text-truncate" id="selectedModelName-${imageId}">Select Model</div>
                                                    <div class="text-white-50 small text-truncate" id="selectedModelDesc-${imageId}">Choose an AI model</div>
                                                </div>
                                            </div>
                                            <i class="bi bi-chevron-down ms-2 opacity-50"></i>
                                        </button>
                                        <ul class="dropdown-menu dropdown-menu-dark w-100 p-2 shadow-lg border-0" aria-labelledby="modelTrigger-${imageId}" style="border-radius: 15px; background: #2a2a2a; max-height: 300px; overflow-y: auto;">
                                            <li class="px-2 py-1 mb-1 border-bottom border-secondary border-opacity-25 pb-2">
                                                <span class="text-white-50 small text-uppercase tracking-wider fw-bold px-2">Available Models</span>
                                            </li>
                                            ${img2imgModels.map(model => {
                                                const id = model.id || model.modelId;
                                                const isActive = id === selectedModelId;
                                                return `
                                                    <li>
                                                        <a class="dropdown-item edit-model-item py-2 px-3 rounded-3 d-flex align-items-center justify-content-between ${isActive ? 'active' : ''}" href="#" data-model-id="${id}" data-name="${model.name}" data-desc="${model.description || ''}">
                                                            <div class="d-flex align-items-center gap-3 overflow-hidden">
                                                                <div class="rounded-2 d-flex align-items-center justify-content-center bg-secondary bg-opacity-25" style="width: 32px; height: 32px; flex-shrink: 0;">
                                                                    <i class="bi bi-box"></i>
                                                                </div>
                                                                <div class="overflow-hidden">
                                                                    <div class="fw-bold text-truncate">${model.name}</div>
                                                                    <div class="small text-white-50 text-truncate">${model.description || ''}</div>
                                                                </div>
                                                            </div>
                                                            ${isActive ? '<i class="bi bi-check-circle-fill text-primary"></i>' : ''}
                                                        </a>
                                                    </li>
                                                `;
                                            }).join('')}
                                        </ul>
                                    </div>
                                ` : `
                                    <div class="alert alert-secondary mb-0 p-2 small">
                                        <i class="bi bi-exclamation-triangle me-2"></i>
                                        No image-to-image models available.
                                    </div>
                                `}
                            </div>

                            <div class="mb-2">
                                <label for="editPromptTextarea-${imageId}" class="form-label fw-bold small text-uppercase tracking-wider">
                                    <i class="bi bi-chat-left-dots me-1"></i>
                                    Edit Instructions
                                </label>
                                <div class="position-relative">
                                    <textarea 
                                        class="form-control" 
                                        style="min-height: 120px; border-radius: 12px; background: rgba(255,255,255,0.03);"
                                        id="editPromptTextarea-${imageId}" 
                                        rows="5" 
                                        maxlength="500" 
                                        placeholder="e.g., change the background to a beach, make the character smile, change hair color to red..."
                                    ></textarea>
                                    <div class="position-absolute bottom-0 end-0 m-2 text-white-50 small">
                                        <span id="editCharCount-${imageId}">0</span>/500
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer border-top-0 pt-0">
                            <button type="button" class="btn btn-link text-white-50 text-decoration-none" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary px-4 py-2" id="submitEdit-${imageId}" style="border-radius: 10px;">
                                <i class="bi bi-stars me-2"></i>
                                Generate Edit
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        $(`#${modalId}`).remove();
        
        // Add modal to body
        $('body').append(modalHtml);
        
        const modal = new bootstrap.Modal(document.getElementById(modalId));
        const textarea = $(`#editPromptTextarea-${imageId}`);
        const charCount = $(`#editCharCount-${imageId}`);
        const generateBtn = $(`#submitEdit-${imageId}`);
        const strengthBadges = $(`#editStrengthBadges-${imageId} .edit-strength-btn`);
        const modelSelect = $(`#editModelSelect-${imageId}`);
        const modelItems = $(`#editModal-${imageId} .edit-model-item`);

        // Initialize selected model display
        const initialModel = img2imgModels.find(m => (m.id || m.modelId) === selectedModelId) || img2imgModels[0];
        if (initialModel) {
            $(`#selectedModelName-${imageId}`).text(initialModel.name);
            $(`#selectedModelDesc-${imageId}`).text(initialModel.description || '');
        }

        // Save and restore last prompt using localStorage
        const lastPromptKey = 'edit_prompt_last_prompt';
        const savedPrompt = localStorage.getItem(lastPromptKey);
        if (savedPrompt) {
            textarea.val(savedPrompt);
            charCount.text(savedPrompt.length);
        }

        // Save and restore last edit strength using localStorage
        const lastStrengthKey = 'edit_prompt_last_strength';
        let selectedStrength = localStorage.getItem(lastStrengthKey) || 'medium';
        strengthBadges.removeClass('active');
        strengthBadges.filter(`[data-strength="${selectedStrength}"]`).addClass('active');

        // Handle strength badge clicks
        strengthBadges.on('click', function() {
            strengthBadges.removeClass('active');
            $(this).addClass('active');
            selectedStrength = $(this).data('strength');
            localStorage.setItem(lastStrengthKey, selectedStrength);
        });

        if (modelSelect.length) {
            modelSelect.on('change', function() {
                selectedModelId = $(this).val();
                localStorage.setItem(lastModelKey, selectedModelId);
            });
        }

        // Handle custom model dropdown clicks
        modelItems.on('click', function(e) {
            e.preventDefault();
            const id = $(this).data('model-id');
            const name = $(this).data('name');
            const desc = $(this).data('desc');

            selectedModelId = id;
            localStorage.setItem(lastModelKey, selectedModelId);

            // Update UI
            $(`#selectedModelName-${imageId}`).text(name);
            $(`#selectedModelDesc-${imageId}`).text(desc || '');
            modelItems.removeClass('active');
            $(this).addClass('active');

            // Update checkmark
            modelItems.find('.bi-check-circle-fill').remove();
            $(this).append('<i class="bi bi-check-circle-fill text-primary"></i>');
        });

        // Character counter
        textarea.on('input', function() {
            const length = $(this).val().length;
            charCount.text(length);
            
            if (length > 500) {
                charCount.addClass('text-danger');
            } else {
                charCount.removeClass('text-danger');
            }

            // Save to localStorage
            localStorage.setItem(lastPromptKey, $(this).val());
        });

        // Generate button click
        generateBtn.off('click').on('click', async () => {
            const editPrompt = textarea.val().trim();
            if (!editPrompt) {
                showNotification('Please enter edit instructions.', 'warning');
                return;
            }
            const editStrength = selectedStrength;
            modal.hide();

            try {
                // Get original image dimensions before converting
                const imgElement = new Image();
                imgElement.crossOrigin = 'anonymous';
                
                const imageDimensions = await new Promise((resolve, reject) => {
                    imgElement.onload = () => resolve({ width: imgElement.naturalWidth, height: imgElement.naturalHeight });
                    imgElement.onerror = () => resolve({ width: 1024, height: 1024 }); // fallback
                    imgElement.src = imageUrl;
                });
                
                // Calculate aspect ratio string (e.g., "16:9", "1:1", "9:16")
                const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
                const divisor = gcd(imageDimensions.width, imageDimensions.height);
                const ratioW = imageDimensions.width / divisor;
                const ratioH = imageDimensions.height / divisor;
                
                // Map to standard aspect ratios supported by the API
                let aspectRatio = '1:1';
                const ratio = imageDimensions.width / imageDimensions.height;
                if (ratio >= 1.7) aspectRatio = '16:9';
                else if (ratio >= 1.4) aspectRatio = '3:2';
                else if (ratio >= 1.2) aspectRatio = '4:3';
                else if (ratio >= 0.9 && ratio <= 1.1) aspectRatio = '1:1';
                else if (ratio >= 0.7) aspectRatio = '3:4';
                else if (ratio >= 0.6) aspectRatio = '2:3';
                else aspectRatio = '9:16';
                
                console.log(`[EditModal] Original image: ${imageDimensions.width}x${imageDimensions.height}, ratio: ${ratio.toFixed(2)}, mapped to: ${aspectRatio}`);

                // Convert image URL to base64
                const response = await fetch('/api/convert-url-to-base64', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: imageUrl })
                });
                const data = await response.json();
                const image_base64 = data.base64Image;

                if (!image_base64) {
                    throw new Error('Failed to convert image to base64');
                }

                // Create placeholder
                const placeholderId = `${new Date().getTime()}_${Math.random().toString(36).substring(2, 8)}_${imageId}`;
                displayOrRemoveImageLoader(placeholderId, 'show');

                // Add message to chat
                addMessageToChat(chatId, userChatId, {
                    role: 'user',
                    message: `Edit image: ${editPrompt}`,
                    name: 'image_edit',
                    hidden: true
                });
                
                // Call image generation
                await novitaImageGeneration(window.user._id, chatId, userChatId, {
                    placeholderId,
                    prompt: editPrompt,
                    editPrompt: editPrompt,
                    imagePrompt: imagePrompt || originalPrompt,
                    image_base64,
                    imageType: nsfw ? 'nsfw' : 'sfw',
                    regenerate: true,
                    title: title || 'Edited Image',
                    editStrength: editStrength,
                    modelId: selectedModelId || null,
                    aspectRatio: aspectRatio,
                    originalWidth: imageDimensions.width,
                    originalHeight: imageDimensions.height
                });
            } catch (error) {
                console.error('Error in edit image:', error);
                showNotification('Failed to edit image. Please try again.', 'error');
            }
        });

        // Modal close events
        $(`#${modalId}`).on('hidden.bs.modal', function() {
            $(this).remove();
        });

        // Show modal
        modal.show();
        
        // Focus textarea
        $(`#${modalId}`).on('shown.bs.modal', function() {
            textarea.focus();
        });
    };