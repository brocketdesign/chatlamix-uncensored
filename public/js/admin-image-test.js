/**
 * Admin Image Model Test Dashboard - Frontend JavaScript
 * Handles multi-model testing, timing, and statistics
 */

// Model categories that cannot be used for text-to-image generation
const INCOMPATIBLE_TEXT_TO_IMAGE_CATEGORIES = ['face', 'img2img'];

// Global state
const state = {
    activeTasks: new Map(),
    timers: new Map(),
    pollIntervals: new Map(),
    generationStartTime: null,
    isGenerating: false,
    stylePresets: {
        anime: {
            prefix: 'anime style, illustration, ',
            suffix: ', high quality, detailed'
        },
        photorealistic: {
            prefix: 'photorealistic, ultra detailed, ',
            suffix: ', professional photography, 8k resolution'
        }
    },
    currentStyle: '',
    customizedPrompt: null, // Track if user has manually edited the final prompt
    // Pricing state
    imageCostPerUnit: window.PRICING?.imageCostPerUnit || 50,
    userPoints: window.PRICING?.userPoints || 0,
    // Image upload state
    generationMode: 'txt2img', // txt2img, img2img, face
    img2imgDataUrl: null, // Base64 encoded image for img2img
    faceImageDataUrl: null, // Face image for merge face
    targetImageDataUrl: null, // Target image for merge face
    // NSFW blur state
    isSubscribed: window.userSubscriptionStatus || false,
    isTemporary: window.isTemporaryUser || false,
    showNSFW: sessionStorage.getItem('showNSFW') === 'true'
};

// NSFW keywords for content detection
const NSFW_KEYWORDS = [
    'nsfw', 'nude', 'naked', 'nudity', 'explicit', 'sexual', 'erotic', 'erotica',
    'porn', 'xxx', 'adult', 'hentai', 'lewd', 'topless', 'bottomless',
    'breast', 'breasts', 'boob', 'boobs', 'nipple', 'nipples',
    'pussy', 'vagina', 'penis', 'cock', 'dick', 'ass', 'butt',
    'sex', 'intercourse', 'penetration', 'orgasm', 'cum', 'cumshot',
    'masturbat', 'fingering', 'blowjob', 'oral', 'anal', 'dildo', 'vibrator',
    'bondage', 'bdsm', 'fetish', 'dominat', 'submissive',
    'uncensored', 'exposed', 'revealing', 'spread', 'spreading'
];

/**
 * Check if a prompt contains NSFW content
 * @param {string} prompt - The prompt text to check
 * @returns {boolean} - True if NSFW content detected
 */
function isNSFWPrompt(prompt) {
    if (!prompt) return false;
    const lowerPrompt = prompt.toLowerCase();
    return NSFW_KEYWORDS.some(keyword => lowerPrompt.includes(keyword));
}

/**
 * Determine if content should be blurred based on NSFW status and user settings
 * @param {boolean} isNSFW - Whether the content is NSFW
 * @returns {boolean} - True if content should be blurred
 */
function shouldBlurContent(isNSFW) {
    if (!isNSFW) return false;
    
    // Always blur for temporary users
    if (state.isTemporary) return true;
    
    // For subscribed users, check showNSFW setting
    if (state.isSubscribed) {
        return !state.showNSFW;
    }
    
    // Non-subscribed users always see blur
    return true;
}

/**
 * Calculate and update the total cost display
 */
function updateCostDisplay() {
    const selectedModels = getSelectedModels();
    const selectedSDModels = getSelectedSDModels();
    const imagesPerModel = parseInt(document.getElementById('imagesPerModel')?.value) || 1;
    
    // Update display elements
    const totalCostDisplay = document.getElementById('totalCostDisplay');
    const imageCountDisplay = document.getElementById('imageCountDisplay');
    const userPointsDisplay = document.getElementById('userPointsDisplay');
    const costSection = document.getElementById('costDisplaySection');
    const costStatusBadge = document.getElementById('costStatusBadge');
    const costPerImageDisplay = document.getElementById('costPerImage');
    
    let totalCost, totalImages, costPerUnit;
    
    // For face mode, calculate cost differently
    if (state.generationMode === 'face') {
        // Face merge cost is fixed (30 points per PRICING_CONFIG)
        const faceMergeCost = window.PRICING?.faceMergeCost || 30;
        const faceModelsSelected = selectedModels.length;
        
        // If no face models selected, default to 1 (auto-select first model)
        totalImages = faceModelsSelected > 0 ? faceModelsSelected : 1;
        costPerUnit = faceMergeCost;
        totalCost = totalImages * faceMergeCost;
        
        // Update cost per image display for face mode
        if (costPerImageDisplay) {
            costPerImageDisplay.textContent = faceMergeCost;
        }
    } else {
        // Standard image generation cost
        const totalModels = selectedModels.length + selectedSDModels.length;
        totalImages = totalModels * imagesPerModel;
        costPerUnit = state.imageCostPerUnit;
        totalCost = totalImages * costPerUnit;
        
        // Reset cost per image display for non-face modes
        if (costPerImageDisplay) {
            costPerImageDisplay.textContent = state.imageCostPerUnit;
        }
    }
    
    if (totalCostDisplay) {
        totalCostDisplay.textContent = totalCost;
    }
    
    if (imageCountDisplay) {
        imageCountDisplay.textContent = totalImages;
    }
    
    // Check if user has enough points
    const hasEnoughPoints = state.userPoints >= totalCost;
    
    // Update user points display
    if (userPointsDisplay) {
        userPointsDisplay.textContent = state.userPoints;
        if (hasEnoughPoints || totalCost === 0) {
            userPointsDisplay.style.color = '#4ade80'; // Green
        } else {
            userPointsDisplay.style.color = '#f87171'; // Red
        }
    }
    
    // Update status badge based on mode and readiness
    if (costStatusBadge) {
        if (state.generationMode === 'face') {
            // For face mode, check if images are uploaded
            const hasFaceImage = !!state.faceImageDataUrl;
            const hasTargetImage = !!state.targetImageDataUrl;
            
            if (!hasFaceImage || !hasTargetImage) {
                costStatusBadge.innerHTML = '<i class="bi bi-upload me-1"></i>Upload images';
                costStatusBadge.style.background = 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)';
                costStatusBadge.style.color = '#fff';
            } else if (!hasEnoughPoints) {
                costStatusBadge.innerHTML = '<i class="bi bi-exclamation-triangle-fill me-1"></i>Need more points';
                costStatusBadge.style.background = 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)';
                costStatusBadge.style.color = '#fff';
            } else {
                costStatusBadge.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Ready';
                costStatusBadge.style.background = 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)';
                costStatusBadge.style.color = '#000';
            }
        } else {
            // Standard mode status
            if (totalCost === 0) {
                costStatusBadge.innerHTML = '<i class="bi bi-hand-index me-1"></i>Select models';
                costStatusBadge.style.background = 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)';
                costStatusBadge.style.color = '#fff';
            } else if (hasEnoughPoints) {
                costStatusBadge.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Ready';
                costStatusBadge.style.background = 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)';
                costStatusBadge.style.color = '#000';
            } else {
                costStatusBadge.innerHTML = '<i class="bi bi-exclamation-triangle-fill me-1"></i>Need more points';
                costStatusBadge.style.background = 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)';
                costStatusBadge.style.color = '#fff';
            }
        }
    }
    
    // Update cost section border based on affordability
    if (costSection && totalCost > 0) {
        if (!hasEnoughPoints) {
            costSection.style.border = '1px solid rgba(248, 113, 113, 0.5)';
            costSection.style.boxShadow = '0 0 20px rgba(248, 113, 113, 0.1)';
        } else {
            costSection.style.border = '1px solid rgba(74, 222, 128, 0.3)';
            costSection.style.boxShadow = '0 0 20px rgba(74, 222, 128, 0.1)';
        }
    } else if (costSection) {
        costSection.style.border = '1px solid rgba(255,255,255,0.1)';
        costSection.style.boxShadow = 'none';
    }
    
    return { totalCost, totalImages, hasEnoughPoints };
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('[AdminImageTest] Dashboard initialized');
    
    // Initialize model checkbox click handlers
    initializeModelCheckboxes();
    
    // Initialize rating stars
    initializeRatingStars();
    
    // Initialize history preview buttons (for server-rendered items)
    initializeHistoryPreviewButtons();
    
    // Load initial stats
    refreshStats();
    
    // Add event listeners for style preset changes
    document.querySelectorAll('input[name="stylePreset"]').forEach(radio => {
        radio.addEventListener('change', handleStylePresetChange);
    });
    
    // Initialize the preview
    updateFinalPromptPreview();
    
    // Initialize cost display
    updateCostDisplay();
    
    // Add event listener for images per model change
    const imagesPerModelSelect = document.getElementById('imagesPerModel');
    if (imagesPerModelSelect) {
        imagesPerModelSelect.addEventListener('change', updateCostDisplay);
    }
    
    // Initialize generation mode handling
    initializeGenerationModeHandlers();
    
    // Initialize image upload handlers
    initializeImageUploadHandlers();
    
    // Check for prompt from Templates page
    const storedPrompt = sessionStorage.getItem('promptFromTemplates');
    if (storedPrompt) {
        const promptInput = document.getElementById('promptInput');
        if (promptInput) {
            promptInput.value = storedPrompt;
            showNotification('Prompt loaded from Templates!', 'success');
            updateFinalPromptPreview();
        }
        sessionStorage.removeItem('promptFromTemplates');
    }
    
    // Add event delegation for copy prompt buttons (for dynamically loaded content)
    document.addEventListener('click', function(e) {
        if (e.target.closest('.copy-prompt-btn')) {
            const button = e.target.closest('.copy-prompt-btn');
            const prompt = button.getAttribute('data-prompt');
            if (prompt) {
                // Parse JSON if it's JSON string, otherwise use as-is
                let promptText;
                try {
                    promptText = JSON.parse(prompt);
                } catch (err) {
                    promptText = prompt;
                }
                copyPrompt(promptText, button);
            }
        }
    });
});

/**
 * Initialize generation mode radio button handlers
 */
function initializeGenerationModeHandlers() {
    document.querySelectorAll('input[name="generationMode"]').forEach(radio => {
        radio.addEventListener('change', handleGenerationModeChange);
    });
}

/**
 * Handle generation mode change
 */
function handleGenerationModeChange(event) {
    const mode = event.target.value;
    state.generationMode = mode;
    
    // Show/hide sections based on mode
    const img2imgUpload = document.getElementById('img2imgUploadSection');
    const editStrength = document.getElementById('editStrengthSection');
    const mergeFaceSection = document.getElementById('mergeFaceSection');
    const txt2imgModels = document.getElementById('txt2imgModelsSection');
    const img2imgModels = document.getElementById('img2imgModelsSection');
    const faceModels = document.getElementById('faceModelsSection');
    
    // Sections to hide in face mode (not relevant for face tools)
    const userCustomModelsSection = document.getElementById('userCustomModelsSection');
    const sdModelsSection = document.getElementById('sdModelsSection');
    const stylePresetSection = document.getElementById('stylePresetSection');
    const sizeSelectionSection = document.getElementById('sizeSelectionSection');
    const imagesPerModelSection = document.getElementById('imagesPerModelSection');
    const sdParamsSection = document.getElementById('sdParamsSection');
    const promptInputSection = document.getElementById('promptInputSection');
    const stylePresetPreview = document.getElementById('stylePresetPreview');
    const noSystemSDModelsAlert = document.getElementById('noSystemSDModelsAlert');
    
    // Elements inside model selection section that should be hidden in face mode
    const addCustomModelBtn = document.getElementById('addCustomModelBtn');
    const selectAllModelsBtn = document.querySelector('#modelSelectionSection .btn-outline-light');
    const modelSelectionLabel = document.querySelector('#modelSelectionSection > label');
    
    // Hide all mode-specific sections first
    if (img2imgUpload) img2imgUpload.style.display = 'none';
    if (editStrength) editStrength.style.display = 'none';
    if (mergeFaceSection) mergeFaceSection.style.display = 'none';
    if (txt2imgModels) txt2imgModels.style.display = 'none';
    if (img2imgModels) img2imgModels.style.display = 'none';
    if (faceModels) faceModels.style.display = 'none';
    
    // Determine if face mode (hide generation-specific options)
    const isFaceMode = mode === 'face';
    
    // Show/hide sections not relevant to face tools
    if (userCustomModelsSection) userCustomModelsSection.style.display = isFaceMode ? 'none' : 'block';
    if (sdModelsSection) sdModelsSection.style.display = isFaceMode ? 'none' : 'block';
    if (stylePresetSection) stylePresetSection.style.display = isFaceMode ? 'none' : 'block';
    if (sizeSelectionSection) sizeSelectionSection.style.display = isFaceMode ? 'none' : 'block';
    if (imagesPerModelSection) imagesPerModelSection.style.display = isFaceMode ? 'none' : 'block';
    if (sdParamsSection) sdParamsSection.style.display = isFaceMode ? 'none' : sdParamsSection.style.display; // Keep original logic for SD params
    if (promptInputSection) promptInputSection.style.display = isFaceMode ? 'none' : 'block';
    if (stylePresetPreview) stylePresetPreview.style.display = isFaceMode ? 'none' : stylePresetPreview.style.display; // Keep original logic
    if (noSystemSDModelsAlert) noSystemSDModelsAlert.style.display = isFaceMode ? 'none' : 'block';
    
    // Hide/show elements inside model selection section for face mode
    if (addCustomModelBtn) addCustomModelBtn.style.display = isFaceMode ? 'none' : 'inline-block';
    if (selectAllModelsBtn) selectAllModelsBtn.style.display = isFaceMode ? 'none' : 'inline-block';
    if (modelSelectionLabel) {
        // Update the label text for face mode
        const labelSpan = modelSelectionLabel.querySelector('span');
        if (labelSpan) {
            labelSpan.textContent = isFaceMode ? 'Select Face Tool' : 'Select Models to Test';
        }
    }
    
    // Show relevant sections based on mode
    switch (mode) {
        case 'txt2img':
            if (txt2imgModels) txt2imgModels.style.display = 'block';
            break;
        case 'img2img':
            if (img2imgUpload) img2imgUpload.style.display = 'block';
            if (editStrength) editStrength.style.display = 'block';
            if (img2imgModels) img2imgModels.style.display = 'block';
            break;
        case 'face':
            if (mergeFaceSection) mergeFaceSection.style.display = 'block';
            if (faceModels) faceModels.style.display = 'block';
            // Auto-select first face model (merge-face) for convenience
            const firstFaceModel = document.querySelector('#faceModelsSection .model-checkbox');
            if (firstFaceModel && !firstFaceModel.classList.contains('selected')) {
                firstFaceModel.classList.add('selected');
            }
            break;
    }
    
    // Clear model selections (but not for face mode since we auto-select)
    if (mode !== 'face') {
        document.querySelectorAll('.model-checkbox.selected').forEach(cb => {
            cb.classList.remove('selected');
        });
    }
    
    updateCostDisplay();
}

/**
 * Initialize image upload handlers for img2img and merge face
 */
function initializeImageUploadHandlers() {
    // Img2Img image upload
    const img2imgInput = document.getElementById('img2imgInput');
    const img2imgArea = document.getElementById('img2imgUploadArea');
    
    if (img2imgInput) {
        img2imgInput.addEventListener('change', () => handleImageUpload(img2imgInput, 'img2img'));
    }
    
    if (img2imgArea) {
        img2imgArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            img2imgArea.classList.add('drag-over');
        });
        img2imgArea.addEventListener('dragleave', () => {
            img2imgArea.classList.remove('drag-over');
        });
        img2imgArea.addEventListener('drop', (e) => {
            e.preventDefault();
            img2imgArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                img2imgInput.files = files;
                handleImageUpload(img2imgInput, 'img2img');
            }
        });
    }
    
    // Face image upload (for merge face)
    const faceImageInput = document.getElementById('faceImageInput');
    const faceImageArea = document.getElementById('faceImageUploadArea');
    
    if (faceImageInput) {
        faceImageInput.addEventListener('change', () => handleImageUpload(faceImageInput, 'face'));
    }
    
    if (faceImageArea) {
        faceImageArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            faceImageArea.classList.add('drag-over');
        });
        faceImageArea.addEventListener('dragleave', () => {
            faceImageArea.classList.remove('drag-over');
        });
        faceImageArea.addEventListener('drop', (e) => {
            e.preventDefault();
            faceImageArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                faceImageInput.files = files;
                handleImageUpload(faceImageInput, 'face');
            }
        });
    }
    
    // Target image upload (for merge face)
    const targetImageInput = document.getElementById('targetImageInput');
    const targetImageArea = document.getElementById('targetImageUploadArea');
    
    if (targetImageInput) {
        targetImageInput.addEventListener('change', () => handleImageUpload(targetImageInput, 'target'));
    }
    
    if (targetImageArea) {
        targetImageArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            targetImageArea.classList.add('drag-over');
        });
        targetImageArea.addEventListener('dragleave', () => {
            targetImageArea.classList.remove('drag-over');
        });
        targetImageArea.addEventListener('drop', (e) => {
            e.preventDefault();
            targetImageArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                targetImageInput.files = files;
                handleImageUpload(targetImageInput, 'target');
            }
        });
    }
}

/**
 * Handle image upload and preview
 */
function handleImageUpload(fileInput, type) {
    const file = fileInput.files[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
        showNotification('Please upload a valid image file', 'error');
        return;
    }
    
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
        showNotification('Image size must be less than 10MB', 'error');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const dataUrl = e.target.result;
        
        // Store data URL based on type
        switch (type) {
            case 'img2img':
                state.img2imgDataUrl = dataUrl;
                document.querySelector('#img2imgUploadArea .upload-placeholder')?.classList.add('d-none');
                document.getElementById('img2imgPreview')?.classList.remove('d-none');
                document.getElementById('img2imgPreviewImg').src = dataUrl;
                break;
            case 'face':
                state.faceImageDataUrl = dataUrl;
                document.querySelector('#faceImageUploadArea .upload-placeholder')?.classList.add('d-none');
                document.getElementById('faceImagePreview')?.classList.remove('d-none');
                document.getElementById('faceImagePreviewImg').src = dataUrl;
                break;
            case 'target':
                state.targetImageDataUrl = dataUrl;
                document.querySelector('#targetImageUploadArea .upload-placeholder')?.classList.add('d-none');
                document.getElementById('targetImagePreview')?.classList.remove('d-none');
                document.getElementById('targetImagePreviewImg').src = dataUrl;
                break;
        }
        
        showNotification('Image uploaded successfully', 'success');
        
        // Update cost display (for face mode readiness check)
        updateCostDisplay();
    };
    reader.readAsDataURL(file);
}

/**
 * Clear img2img image upload
 */
function clearImg2ImgUpload() {
    state.img2imgDataUrl = null;
    document.getElementById('img2imgInput').value = '';
    document.querySelector('#img2imgUploadArea .upload-placeholder')?.classList.remove('d-none');
    document.getElementById('img2imgPreview')?.classList.add('d-none');
    updateCostDisplay();
}

/**
 * Clear face image upload
 */
function clearFaceImageUpload() {
    state.faceImageDataUrl = null;
    document.getElementById('faceImageInput').value = '';
    document.querySelector('#faceImageUploadArea .upload-placeholder')?.classList.remove('d-none');
    document.getElementById('faceImagePreview')?.classList.add('d-none');
    updateCostDisplay();
}

/**
 * Clear target image upload
 */
function clearTargetImageUpload() {
    state.targetImageDataUrl = null;
    document.getElementById('targetImageInput').value = '';
    document.querySelector('#targetImageUploadArea .upload-placeholder')?.classList.remove('d-none');
    document.getElementById('targetImagePreview')?.classList.add('d-none');
    updateCostDisplay();
}

/**
 * Initialize history preview buttons for server-rendered items
 */
function initializeHistoryPreviewButtons() {
    // Handle thumbnail clicks and NSFW blur for server-rendered items
    document.querySelectorAll('#historyTableBody .history-thumbnail').forEach(thumbnail => {
        const imageUrl = thumbnail.dataset.imageUrl;
        const prompt = thumbnail.dataset.prompt || '';
        const row = thumbnail.closest('tr');
        
        // Check if content is NSFW
        const isNSFW = thumbnail.dataset.isNsfw === 'true' || isNSFWPrompt(prompt);
        const shouldBlur = shouldBlurContent(isNSFW);
        
        // Store NSFW status on row
        if (row && isNSFW) {
            row.dataset.isNsfw = 'true';
        }
        
        // If NSFW and should blur, fetch blurred image via API
        if (shouldBlur && imageUrl) {
            // Set placeholder while loading blurred version
            thumbnail.src = '/img/placeholder.png';
            thumbnail.classList.add('nsfw-blurred');
            
            // Add lock icon overlay
            const wrapper = thumbnail.parentElement;
            if (wrapper && !wrapper.classList.contains('position-relative')) {
                wrapper.classList.add('position-relative', 'd-inline-block');
            }
            
            // Add lock icon if not already present
            if (wrapper && !wrapper.querySelector('.bi-lock-fill')) {
                const lockSpan = document.createElement('span');
                lockSpan.className = 'position-absolute top-50 start-50 translate-middle';
                lockSpan.innerHTML = '<i class="bi bi-lock-fill text-white" style="font-size: 0.9rem; text-shadow: 0 0 4px rgba(0,0,0,0.7);"></i>';
                wrapper.appendChild(lockSpan);
                
                // Add NSFW badge
                const badge = document.createElement('span');
                badge.className = 'position-absolute top-0 end-0 badge bg-danger';
                badge.style.fontSize = '0.5rem';
                badge.textContent = 'NSFW';
                wrapper.appendChild(badge);
            }
            
            // Fetch blurred version
            fetchBlurredImage(imageUrl, function(blobUrl) {
                thumbnail.src = blobUrl;
            });
            
            // Store original URL for authorized reveal
            wrapper.dataset.originalUrl = imageUrl;
        }
        
        thumbnail.addEventListener('click', function(e) {
            e.stopPropagation();
            const imgUrl = this.dataset.imageUrl;
            const modelName = this.dataset.modelName || 'Unknown Model';
            const generationTime = parseInt(this.dataset.generationTime) || 0;
            const testId = this.dataset.testId || '';
            const promptText = this.dataset.prompt || '';
            const contentIsNSFW = isNSFWPrompt(promptText);
            const contentShouldBlur = shouldBlurContent(contentIsNSFW);
            
            if (contentShouldBlur) {
                // Show appropriate action for blurred content
                if (state.isTemporary) {
                    if (typeof openLoginForm === 'function') {
                        openLoginForm();
                    } else {
                        window.location.href = '/login';
                    }
                } else if (!state.isSubscribed) {
                    if (typeof loadPlanPage === 'function') {
                        loadPlanPage();
                    } else {
                        window.location.href = '/plan';
                    }
                } else {
                    // Subscribed user - show preview
                    previewHistoryImage(imgUrl, modelName, generationTime, testId, promptText, contentIsNSFW);
                }
            } else {
                previewHistoryImage(imgUrl, modelName, generationTime, testId, promptText, contentIsNSFW);
            }
        });
    });
    
    // Handle row clicks for preview
    document.querySelectorAll('#historyTableBody tr[data-has-image="true"]').forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', function(e) {
            // Don't trigger if clicking on a button or link inside the row
            if (e.target.closest('button') || e.target.closest('a') || e.target.tagName === 'BUTTON' || e.target.tagName === 'A') {
                return;
            }
            
            const imageUrl = this.dataset.imageUrl;
            const modelName = this.dataset.modelName || 'Unknown Model';
            const generationTime = parseInt(this.dataset.generationTime) || 0;
            const testId = this.dataset.testId || '';
            const prompt = this.dataset.prompt || '';
            const isNSFW = this.dataset.isNsfw === 'true' || isNSFWPrompt(prompt);
            const shouldBlurRow = shouldBlurContent(isNSFW);
            
            if (imageUrl) {
                if (shouldBlurRow) {
                    // Show appropriate action for blurred content
                    if (state.isTemporary) {
                        if (typeof openLoginForm === 'function') {
                            openLoginForm();
                        } else {
                            window.location.href = '/login';
                        }
                    } else if (!state.isSubscribed) {
                        if (typeof loadPlanPage === 'function') {
                            loadPlanPage();
                        } else {
                            window.location.href = '/plan';
                        }
                    } else {
                        // Subscribed user - show preview
                        previewHistoryImage(imageUrl, modelName, generationTime, testId, prompt, isNSFW);
                    }
                } else {
                    previewHistoryImage(imageUrl, modelName, generationTime, testId, prompt, isNSFW);
                }
            }
        });
    });
}

/**
 * Handle style preset radio button change
 */
function handleStylePresetChange(event) {
    const style = event.target.value;
    state.currentStyle = style;
    state.customizedPrompt = null; // Reset customization when changing style
    updateFinalPromptPreview();
}

/**
 * Update the final prompt preview based on selected style
 */
function updateFinalPromptPreview() {
    const previewContainer = document.getElementById('stylePresetPreview');
    const basePrompt = document.getElementById('promptInput').value.trim();
    const selectedStyle = document.querySelector('input[name="stylePreset"]:checked')?.value || '';
    
    state.currentStyle = selectedStyle;
    
    if (!selectedStyle) {
        // No style selected, hide preview
        previewContainer.style.display = 'none';
        return;
    }
    
    // Show preview
    previewContainer.style.display = 'block';
    
    const preset = state.stylePresets[selectedStyle];
    if (!preset) return;
    
    // Update the editable fields
    document.getElementById('stylePrefixInput').value = preset.prefix;
    document.getElementById('stylePromptDisplay').textContent = basePrompt;
    document.getElementById('styleSuffixInput').value = preset.suffix;
    
    // Update combined final prompt
    updateFinalPromptFromParts();
}

/**
 * Update final prompt from individual parts (prefix + prompt + suffix)
 */
function updateFinalPromptFromParts() {
    const prefix = document.getElementById('stylePrefixInput').value;
    const basePrompt = document.getElementById('promptInput').value.trim();
    const suffix = document.getElementById('styleSuffixInput').value;
    
    const finalPrompt = prefix + basePrompt + suffix;
    document.getElementById('finalPromptInput').value = finalPrompt;
    state.customizedPrompt = finalPrompt;
}

/**
 * Reset to default preset values
 */
function resetToPreset() {
    const selectedStyle = state.currentStyle;
    if (!selectedStyle || !state.stylePresets[selectedStyle]) return;
    
    const preset = state.stylePresets[selectedStyle];
    document.getElementById('stylePrefixInput').value = preset.prefix;
    document.getElementById('styleSuffixInput').value = preset.suffix;
    state.customizedPrompt = null;
    
    updateFinalPromptFromParts();
    showNotification('Reset to default preset', 'info');
}

/**
 * Get the final prompt to send to API
 */
function getFinalPrompt() {
    const selectedStyle = document.querySelector('input[name="stylePreset"]:checked')?.value || '';
    const basePrompt = document.getElementById('promptInput').value.trim();
    
    if (!selectedStyle) {
        // No style selected, use base prompt
        return basePrompt;
    }
    
    // Use the customized final prompt from the textarea
    const finalPromptInput = document.getElementById('finalPromptInput');
    if (finalPromptInput && finalPromptInput.value.trim()) {
        return finalPromptInput.value.trim();
    }
    
    // Fallback to combining parts
    const prefix = document.getElementById('stylePrefixInput')?.value || '';
    const suffix = document.getElementById('styleSuffixInput')?.value || '';
    return prefix + basePrompt + suffix;
}

/**
 * Initialize model checkbox click handlers
 */
function initializeModelCheckboxes() {
    // Handle all model checkboxes
    document.querySelectorAll('.model-checkbox').forEach(checkbox => {
        checkbox.addEventListener('click', function(e) {
            // Don't trigger if clicking on a link or button inside
            if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || e.target.closest('a') || e.target.closest('button')) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            this.classList.toggle('selected');
            
            // Check if this is an SD model
            const sdInput = this.querySelector('.sd-model-checkbox');
            if (sdInput) {
                updateSDParamsVisibility();
            }
            
            // Update cost display whenever selection changes
            updateCostDisplay();
        });
    });
}

/**
 * Select all standard model checkboxes
 */
function selectAllModels() {
    const checkboxes = document.querySelectorAll('.model-checkbox');
    const standardCheckboxes = Array.from(checkboxes).filter(cb => !cb.querySelector('.sd-model-checkbox'));
    const allSelected = standardCheckboxes.every(cb => cb.classList.contains('selected'));
    
    standardCheckboxes.forEach(cb => {
        if (allSelected) {
            cb.classList.remove('selected');
        } else {
            cb.classList.add('selected');
        }
    });
    
    // Update cost display
    updateCostDisplay();
}

/**
 * Select all SD model checkboxes
 */
function selectAllSDModels() {
    const checkboxes = document.querySelectorAll('.model-checkbox');
    const sdCheckboxes = Array.from(checkboxes).filter(cb => cb.querySelector('.sd-model-checkbox'));
    const allSelected = sdCheckboxes.every(cb => cb.classList.contains('selected'));
    
    sdCheckboxes.forEach(cb => {
        if (allSelected) {
            cb.classList.remove('selected');
        } else {
            cb.classList.add('selected');
        }
    });
    
    updateSDParamsVisibility();
    
    // Update cost display
    updateCostDisplay();
}

/**
 * Get selected standard models based on current generation mode
 */
function getSelectedModels() {
    let selector;
    switch (state.generationMode) {
        case 'txt2img':
            selector = '.txt2img-model-checkbox';
            break;
        case 'img2img':
            selector = '.img2img-model-checkbox';
            break;
        case 'face':
            selector = '.face-model-checkbox';
            break;
        default:
            selector = 'input[type="checkbox"]';
    }
    
    const checkboxes = document.querySelectorAll('.model-checkbox.selected');
    const standardSelected = Array.from(checkboxes).filter(cb => {
        const checkbox = cb.querySelector(selector);
        return checkbox && !cb.classList.contains('user-custom-model-item') && !cb.querySelector('.sd-model-checkbox');
    });
    
    return standardSelected.map(cb => {
        const input = cb.querySelector(selector) || cb.querySelector('input[type="checkbox"]');
        return {
            id: input.value,
            name: input.dataset.modelName,
            category: input.dataset.category,
            requiresImage: input.dataset.requiresImage === 'true',
            requiresTwoImages: input.dataset.requiresTwoImages === 'true',
            supportsImg2Img: input.dataset.supportsImg2img === 'true'
        };
    });
}

/**
 * Get selected SD models (both system and user custom models)
 */
function getSelectedSDModels() {
    // Get system SD models
    const systemCheckboxes = document.querySelectorAll('.model-checkbox.selected');
    const systemSdSelected = Array.from(systemCheckboxes).filter(cb => 
        cb.querySelector('.sd-model-checkbox') && !cb.classList.contains('user-custom-model-item')
    );
    
    const systemModels = systemSdSelected.map(cb => {
        const input = cb.querySelector('.sd-model-checkbox');
        return {
            modelId: input.value,
            model: input.dataset.model,
            model_name: input.dataset.model,
            name: input.dataset.modelName,
            isUserModel: false
        };
    });
    
    // Get user custom SD models
    const userModels = getSelectedUserSDModels();
    
    // Combine both
    return [...systemModels, ...userModels];
}

/**
 * Update SD parameters section visibility
 */
function updateSDParamsVisibility() {
    const sdSection = document.getElementById('sdParamsSection');
    const selectedSD = getSelectedSDModels(); // This now includes both system and user models
    
    if (sdSection) {
        sdSection.style.display = selectedSD.length > 0 ? 'block' : 'none';
    }
}

/**
 * Select all user custom SD model checkboxes
 */
function selectAllUserSDModels() {
    const userModelItems = document.querySelectorAll('.user-custom-model-item');
    const allSelected = Array.from(userModelItems).every(item => item.classList.contains('selected'));
    
    userModelItems.forEach(item => {
        if (allSelected) {
            item.classList.remove('selected');
        } else {
            item.classList.add('selected');
        }
    });
    
    updateSDParamsVisibility();
    updateCostDisplay();
}

// SD params visibility is now handled in initializeModelCheckboxes()

/**
 * Start generation for selected models
 */
async function startGeneration() {
    const selectedModels = getSelectedModels();
    const selectedSDModels = getSelectedSDModels();
    
    if (selectedModels.length === 0 && selectedSDModels.length === 0) {
        showNotification('Please select at least one model', 'warning');
        return;
    }

    const basePrompt = document.getElementById('promptInput').value.trim();
    
    // For face tools like Merge Face, prompt may not be required
    const needsPrompt = state.generationMode !== 'face' || 
        selectedModels.some(m => m.id !== 'merge-face' && m.id !== 'merge-face-segmind');
    
    if (needsPrompt && !basePrompt) {
        showNotification('Please enter a prompt', 'warning');
        return;
    }
    
    // Validate image requirements based on mode
    if (state.generationMode === 'img2img' && !state.img2imgDataUrl) {
        showNotification('Please upload a source image for image-to-image generation', 'warning');
        return;
    }
    
    if (state.generationMode === 'face') {
        const hasMergeFace = selectedModels.some(m => m.id === 'merge-face' || m.id === 'merge-face-segmind');
        const hasOtherFaceTools = selectedModels.some(m => m.id !== 'merge-face' && m.id !== 'merge-face-segmind');
        
        if (hasMergeFace && (!state.faceImageDataUrl || !state.targetImageDataUrl)) {
            showNotification('Please upload both face and target images for Merge Face', 'warning');
            return;
        }
        
        if (hasOtherFaceTools && !state.faceImageDataUrl && !state.img2imgDataUrl) {
            showNotification('Please upload an image for face tools', 'warning');
            return;
        }
    }

    // Check if user has enough points before proceeding
    const { totalCost, totalImages, hasEnoughPoints } = updateCostDisplay();
    if (!hasEnoughPoints) {
        showNotification(`Insufficient points. You need ${totalCost} points but only have ${state.userPoints} points.`, 'error');
        return;
    }

    const size = document.getElementById('sizeSelect').value;
    const style = document.querySelector('input[name="stylePreset"]:checked')?.value || '';
    const imagesPerModel = parseInt(document.getElementById('imagesPerModel').value) || 1;
    const editStrength = document.querySelector('input[name="editStrength"]:checked')?.value || 'medium';
    
    // Get the final prompt (with style applied and any user edits)
    const finalPrompt = getFinalPrompt();
    
    // Get SD parameters if SD models are selected
    let sdParams = {};
    if (selectedSDModels.length > 0) {
        sdParams = {
            negativePrompt: document.getElementById('sdNegativePrompt')?.value || '',
            steps: document.getElementById('sdSteps')?.value || '30',
            guidanceScale: document.getElementById('sdGuidanceScale')?.value || '7.5',
            samplerName: document.getElementById('sdSampler')?.value || 'Euler a'
        };
    }

    console.log('[AdminImageTest] Starting generation:', {
        mode: state.generationMode,
        models: selectedModels.map(m => m.id),
        sdModels: selectedSDModels.map(m => m.model),
        basePrompt: basePrompt.substring(0, 50) + '...',
        finalPrompt: finalPrompt.substring(0, 80) + '...',
        size,
        style,
        editStrength,
        hasImg2ImgImage: !!state.img2imgDataUrl,
        hasFaceImage: !!state.faceImageDataUrl,
        hasTargetImage: !!state.targetImageDataUrl
    });

    // Clear previous results
    clearResults();
    
    // Update UI state
    state.isGenerating = true;
    state.generationStartTime = Date.now();
    updateGenerateButton(true);
    document.getElementById('totalTimeDisplay').classList.remove('d-none');
    startTotalTimer();

    try {
        const requestBody = {
            prompt: finalPrompt, // Send the final edited prompt
            basePrompt: basePrompt, // Also send base prompt for reference
            size,
            style,
            skipStyleApplication: !!style, // Tell server not to apply style again
            imagesPerModel: imagesPerModel, // Number of images to generate per model
            generationMode: state.generationMode,
            editStrength: editStrength
        };
        
        // Add image data based on mode
        if (state.generationMode === 'img2img' && state.img2imgDataUrl) {
            requestBody.image_base64 = state.img2imgDataUrl;
        }
        
        if (state.generationMode === 'face') {
            if (state.faceImageDataUrl) {
                requestBody.face_image_file = state.faceImageDataUrl;
            }
            if (state.targetImageDataUrl) {
                requestBody.image_file = state.targetImageDataUrl;
            }
            // For other face tools, use face image as the source
            if (!state.targetImageDataUrl && state.faceImageDataUrl) {
                requestBody.image_file = state.faceImageDataUrl;
            }
        }
        
        // Add standard models if any selected
        if (selectedModels.length > 0) {
            requestBody.models = selectedModels.map(m => m.id);
        }
        
        // Add SD models and parameters if any selected
        if (selectedSDModels.length > 0) {
            requestBody.selectedSDModels = selectedSDModels;
            requestBody.negativePrompt = sdParams.negativePrompt;
            requestBody.steps = sdParams.steps;
            requestBody.guidanceScale = sdParams.guidanceScale;
            requestBody.samplerName = sdParams.samplerName;
            
            // For img2img mode with SD models, add the image
            if (state.generationMode === 'img2img' && state.img2imgDataUrl) {
                requestBody.image_base64 = state.img2imgDataUrl;
            }
        }
        
        const response = await fetch('/dashboard/image/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            // Handle insufficient points error
            if (response.status === 402) {
                showNotification(data.message || `Insufficient points. Need ${data.required} but have ${data.available}.`, 'error');
                state.userPoints = data.available || 0;
                updateCostDisplay();
                state.isGenerating = false;
                updateGenerateButton(false);
                stopTotalTimer();
                return;
            }
            throw new Error(data.error || 'Generation failed');
        }

        // Update user points after successful deduction
        const totalModelsCount = selectedModels.length + selectedSDModels.length;
        const totalImagesCount = totalModelsCount * imagesPerModel;
        const deductedCost = totalImagesCount * state.imageCostPerUnit;
        state.userPoints -= deductedCost;
        updateCostDisplay();

        console.log('[AdminImageTest] Generation started:', data);

        // Process each task - create cards dynamically based on tasks returned
        data.tasks.forEach(task => {
            // Use cardId from task if provided (for multiple images per model), otherwise derive it
            let cardId = task.cardId || task.modelId;
            
            // For SD models, use the custom card ID
            if ((task.modelId === 'sd-txt2img' || task.modelId === 'sd-img2img') && task.sdModelName) {
                // Find the matching SD model to get the card ID
                const matchingSD = selectedSDModels.find(sd => sd.model === task.sdModelName || sd.name === task.sdModelName);
                if (matchingSD && !task.cardId) {
                    cardId = `sd-${matchingSD.modelId}`;
                }
            }
            
            // Create card if it doesn't exist (for dynamically created tasks)
            const cardElement = document.getElementById(`result-${cardId}`);
            if (!cardElement) {
                const displayName = task.modelName || task.modelId;
                createResultCard(cardId, displayName);
            }
            
            state.activeTasks.set(cardId, task);
            updateResultCard(cardId, task);

            if (task.status === 'processing' && task.async) {
                // Start polling for async tasks
                startTaskPolling(task, cardId);
            } else if (task.status === 'completed') {
                // Handle sync completion
                handleTaskCompletion(task);
            } else if (task.status === 'failed') {
                // Handle immediate failure
                handleTaskFailure(task);
            }
        });

    } catch (error) {
        console.error('[AdminImageTest] Generation error:', error);
        showNotification(error.message, 'error');
        state.isGenerating = false;
        updateGenerateButton(false);
        stopTotalTimer();
    }
}

/**
 * Create a result card for a model
 */
function createResultCard(modelId, modelName) {
    const container = document.getElementById('resultsContainer');
    const placeholder = document.getElementById('noResultsPlaceholder');
    
    if (placeholder) {
        placeholder.style.display = 'none';
    }

    const card = document.createElement('div');
    card.id = `result-${modelId}`;
    card.className = 'result-card mb-3 p-3 rounded position-relative';
    card.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="text-white mb-0">${modelName}</h6>
            <div class="d-flex align-items-center gap-2">
                <span class="timer badge bg-secondary" id="timer-${modelId}">0.0s</span>
                <span class="status badge bg-warning" id="status-${modelId}">
                    <span class="spinner-border spinner-border-sm me-1"></span>
                    Starting...
                </span>
            </div>
        </div>
        <div class="progress mb-2" style="height: 4px;">
            <div class="progress-bar" id="progress-${modelId}" role="progressbar" style="width: 0%"></div>
        </div>
        <div class="result-image-container" id="image-container-${modelId}">
            <div class="text-center text-muted py-3">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-2 mb-0 small">Generating...</p>
            </div>
        </div>
    `;

    container.appendChild(card);

    // Start individual timer
    startModelTimer(modelId);
}

/**
 * Update a result card with task status
 */
function updateResultCard(modelId, task) {
    const statusEl = document.getElementById(`status-${modelId}`);
    const progressEl = document.getElementById(`progress-${modelId}`);
    const imageContainer = document.getElementById(`image-container-${modelId}`);
    const card = document.getElementById(`result-${modelId}`);

    if (!statusEl || !card) return;

    if (task.status === 'processing') {
        statusEl.className = 'status badge bg-info';
        statusEl.innerHTML = `
            <span class="spinner-border spinner-border-sm me-1"></span>
            Processing ${task.progress || 0}%
        `;
        progressEl.style.width = `${task.progress || 0}%`;
        progressEl.className = 'progress-bar bg-info';
    } else if (task.status === 'completed') {
        stopModelTimer(modelId);
        const time = task.generationTime || (Date.now() - task.startTime);
        
        statusEl.className = 'status badge bg-success';
        statusEl.innerHTML = `<i class="bi bi-check-circle me-1"></i>Completed`;
        progressEl.style.width = '100%';
        progressEl.className = 'progress-bar bg-success';

        // Update timer with final time
        const timerEl = document.getElementById(`timer-${modelId}`);
        if (timerEl) {
            timerEl.textContent = `${(time / 1000).toFixed(1)}s`;
            timerEl.className = 'timer badge bg-success';
        }

        // Display images first (they're already available)
        if (task.images && task.images.length > 0) {
            displayImages(modelId, task.images, time);
        }
        
        // Save result to get testId - use task.modelId, not the card modelId
        // This updates task.testId which will be used if user clicks on image again
        // Only save if not already saved and not currently saving (prevent duplicate saves)
        const currentTask = state.activeTasks.get(modelId);
        if (!currentTask?.testId && !currentTask?.saving) {
            // Mark as saving immediately to prevent duplicate saves
            task.saving = true;
            state.activeTasks.set(modelId, task);
            
            saveTestResult(task.modelId || modelId, task).catch(err => {
                console.error(`[AdminImageTest] Error saving result for ${modelId}:`, err);
                // Clear saving flag on error so it can be retried
                const errorTask = state.activeTasks.get(modelId);
                if (errorTask) {
                    errorTask.saving = false;
                    state.activeTasks.set(modelId, errorTask);
                }
            });
        }
        
        card.classList.add('completed');
    } else if (task.status === 'failed') {
        stopModelTimer(modelId);
        
        statusEl.className = 'status badge bg-danger';
        statusEl.innerHTML = `<i class="bi bi-x-circle me-1"></i>Failed`;
        progressEl.style.width = '100%';
        progressEl.className = 'progress-bar bg-danger';

        imageContainer.innerHTML = `
            <div class="text-center text-danger py-3">
                <i class="bi bi-exclamation-triangle display-4"></i>
                <p class="mt-2 mb-0">${task.error || 'Generation failed'}</p>
            </div>
        `;

        card.classList.add('failed');
    }

    // Check if all tasks are complete
    checkAllTasksComplete();
}

/**
 * Display generated images
 */
function displayImages(modelId, images, time) {
    const container = document.getElementById(`image-container-${modelId}`);
    if (!container) return;

    container.innerHTML = '';

    images.forEach((img, index) => {
        const imgUrl = img.imageUrl || img.image_url || img;
        const task = state.activeTasks.get(modelId);
        // Get testId from task (will be set when saveTestResult completes)
        // For now, use empty string and it will be updated when save completes
        const testId = task?.testId || '';
        const escapedUrl = imgUrl.replace(/'/g, "\\'");
        // Use task.modelId for modal, not the card modelId (which might be like 'sd-xxx')
        const actualModelId = task?.modelId || modelId;
        const actualModelName = task?.modelName || modelId;
        
        // Check if content is NSFW based on prompt or nsfw_detection result
        const prompt = task?.finalPrompt || task?.originalPrompt || '';
        const nsfwDetection = img.nsfw_detection;
        const isNSFW = img.isNSFW || isNSFWPrompt(prompt) || (nsfwDetection && nsfwDetection.valid);
        const shouldBlur = shouldBlurContent(isNSFW);
        
        // Store NSFW status in task for later reference
        if (task && isNSFW) {
            task.isNSFW = true;
        }
        
        // Create image element with onclick that will get updated testId from task
        const wrapper = document.createElement('div');
        wrapper.className = 'result-image-wrapper d-inline-block position-relative';
        wrapper.style.position = 'relative';
        
        const imgElement = document.createElement('img');
        imgElement.alt = `Generated Image ${index + 1}`;
        imgElement.className = 'result-image img-fluid rounded cursor-pointer';
        imgElement.onerror = function() { this.src = '/img/placeholder.png'; };
        
        if (shouldBlur) {
            // Use blur API to fetch blurred blob - never expose the real URL
            imgElement.src = '/img/placeholder.png'; // Placeholder while loading blurred image
            
            // Fetch blurred image from API
            fetchBlurredImage(imgUrl, function(blobUrl) {
                imgElement.src = blobUrl;
            });
            
            // Store original URL in data attribute for overlay click (subscribers only)
            wrapper.dataset.originalUrl = imgUrl;
            
            // Create overlay based on user status
            const overlay = createNSFWOverlay(imgUrl, escapedUrl, actualModelId, time, testId, wrapper);
            wrapper.appendChild(imgElement);
            wrapper.appendChild(overlay);
        } else {
            // Normal display for non-NSFW or unlocked content
            imgElement.src = imgUrl;
            imgElement.onclick = function() {
                // Get latest testId from task (may have been updated by saveTestResult)
                const currentTask = state.activeTasks.get(modelId);
                const currentTestId = currentTask?.testId || testId;
                previewImage(escapedUrl, actualModelId, time, currentTestId);
            };
            wrapper.appendChild(imgElement);
        }
        
        // Add NSFW badge if content is NSFW
        if (isNSFW) {
            const badge = document.createElement('span');
            badge.className = 'position-absolute top-0 end-0 badge bg-danger m-1';
            badge.style.fontSize = '0.65rem';
            badge.style.zIndex = '5';
            badge.innerHTML = '<i class="bi bi-exclamation-triangle-fill me-1"></i>NSFW';
            wrapper.appendChild(badge);
        }
        
        container.appendChild(wrapper);
    });
}

/**
 * Fetch blurred image from API and return blob URL
 * @param {string} imageUrl - Original image URL
 * @param {function} callback - Callback function that receives the blob URL
 */
function fetchBlurredImage(imageUrl, callback) {
    $.ajax({
        url: '/blur-image?url=' + encodeURIComponent(imageUrl),
        method: 'GET',
        xhrFields: { responseType: 'blob' },
        success: function(blob) {
            const blobUrl = URL.createObjectURL(blob);
            callback(blobUrl);
        },
        error: function() {
            console.error("Failed to load blurred image.");
            // Use a placeholder on error
            callback('/img/placeholder.png');
        }
    });
}

/**
 * Create NSFW overlay for blurred images
 * @param {string} imgUrl - Original image URL
 * @param {string} escapedUrl - Escaped image URL for onclick
 * @param {string} modelId - Model ID
 * @param {number} time - Generation time
 * @param {string} testId - Test ID
 * @param {HTMLElement} wrapper - Parent wrapper element containing data-original-url
 * @returns {HTMLElement} - Overlay element
 */
function createNSFWOverlay(imgUrl, escapedUrl, modelId, time, testId, wrapper) {
    const overlay = document.createElement('div');
    overlay.className = 'gallery-nsfw-overlay position-absolute top-0 start-0 w-100 h-100 d-flex flex-column justify-content-center align-items-center';
    overlay.style.background = 'rgba(0, 0, 0, 0.25)';
    overlay.style.zIndex = '3';
    overlay.style.borderRadius = 'inherit';
    
    if (state.isTemporary) {
        // Temporary user - show login prompt
        overlay.style.cursor = 'pointer';
        overlay.onclick = function(e) {
            e.stopPropagation();
            if (typeof openLoginForm === 'function') {
                openLoginForm();
            } else {
                window.location.href = '/login';
            }
        };
        
        const lockIcon = document.createElement('i');
        lockIcon.className = 'bi bi-lock-fill';
        lockIcon.style.cssText = 'font-size: 1.5rem; color: #fff; opacity: 0.9; margin-bottom: 0.5rem;';
        
        const loginBtn = document.createElement('button');
        loginBtn.className = 'btn btn-sm';
        loginBtn.style.cssText = 'background: linear-gradient(90.9deg, #D2B8FF 2.74%, #8240FF 102.92%); color: white; border: none; border-radius: 8px; font-weight: 600; padding: 0.4rem 0.8rem; font-size: 0.75rem;';
        loginBtn.innerHTML = '<i class="bi bi-unlock-fill me-1"></i>Login';
        loginBtn.onclick = function(e) {
            e.stopPropagation();
            if (typeof openLoginForm === 'function') {
                openLoginForm();
            } else {
                window.location.href = '/login';
            }
        };
        
        overlay.appendChild(lockIcon);
        overlay.appendChild(loginBtn);
        
    } else if (state.isSubscribed && !state.showNSFW) {
        // Subscribed user with showNSFW disabled - can reveal on click
        overlay.style.cursor = 'pointer';
        overlay.onclick = function(e) {
            e.stopPropagation();
            // Get the original URL from wrapper and load the actual image
            const imgElement = this.previousElementSibling;
            const originalUrl = wrapper ? wrapper.dataset.originalUrl : imgUrl;
            if (imgElement && imgElement.tagName === 'IMG') {
                // Load the actual unblurred image
                imgElement.src = originalUrl;
                imgElement.onclick = function() {
                    previewImage(escapedUrl, modelId, time, testId);
                };
            }
            this.style.display = 'none';
        };
        
        const showBtn = document.createElement('button');
        showBtn.className = 'btn btn-sm';
        showBtn.style.cssText = 'background: linear-gradient(90.9deg, #D2B8FF 2.74%, #8240FF 102.92%); color: white; border: none; border-radius: 8px; font-weight: 600; padding: 0.4rem 0.8rem; font-size: 0.75rem;';
        showBtn.textContent = window.translations?.showContent || 'Show Content';
        showBtn.onclick = function(e) {
            e.stopPropagation();
            // Trigger parent overlay click
            overlay.click();
        };
        
        overlay.appendChild(showBtn);
        
    } else {
        // Non-subscribed user - show premium unlock prompt
        overlay.style.cursor = 'pointer';
        overlay.onclick = function(e) {
            e.stopPropagation();
            if (typeof loadPlanPage === 'function') {
                loadPlanPage();
            } else {
                window.location.href = '/plan';
            }
        };
        
        const lockIcon = document.createElement('i');
        lockIcon.className = 'bi bi-lock-fill';
        lockIcon.style.cssText = 'font-size: 1.5rem; color: #fff; opacity: 0.9; margin-bottom: 0.5rem;';
        
        const unlockBtn = document.createElement('button');
        unlockBtn.className = 'btn btn-sm';
        unlockBtn.style.cssText = 'background: linear-gradient(90.9deg, #D2B8FF 2.74%, #8240FF 102.92%); color: white; border: none; border-radius: 8px; font-weight: 600; padding: 0.4rem 0.8rem; font-size: 0.75rem;';
        unlockBtn.innerHTML = '<i class="bi bi-unlock-fill me-1"></i>' + (window.translations?.blurButton || 'Unlock');
        unlockBtn.onclick = function(e) {
            e.stopPropagation();
            if (typeof loadPlanPage === 'function') {
                loadPlanPage();
            } else {
                window.location.href = '/plan';
            }
        };
        
        overlay.appendChild(lockIcon);
        overlay.appendChild(unlockBtn);
    }
    
    return overlay;
}

/**
 * Preview image in modal
 */
function previewImage(imageUrl, modelId, time, testId = null) {
    const modal = new bootstrap.Modal(document.getElementById('imagePreviewModal'));
    const modalElement = document.getElementById('imagePreviewModal');
    
    document.getElementById('previewImage').src = imageUrl;
    
    const task = state.activeTasks.get(modelId);
    const modelName = task?.modelName || modelId;
    const prompt = task?.finalPrompt || task?.originalPrompt || '';
    
    document.getElementById('previewModelName').textContent = modelName;
    document.getElementById('previewTime').textContent = `Generated in ${(time / 1000).toFixed(1)} seconds`;
    
    // Show truncated prompt
    const promptEl = document.getElementById('previewPrompt');
    if (promptEl && prompt) {
        const truncatedPrompt = prompt.length > 100 ? prompt.substring(0, 100) + '...' : prompt;
        promptEl.textContent = truncatedPrompt;
        promptEl.title = prompt;
        promptEl.style.display = 'block';
    } else if (promptEl) {
        promptEl.style.display = 'none';
    }
    
    // Store current image info for rating and draft
    modalElement.dataset.modelId = modelId;
    modalElement.dataset.modelName = modelName;
    modalElement.dataset.imageUrl = imageUrl;
    modalElement.dataset.testId = testId || '';
    modalElement.dataset.prompt = prompt;
    
    // Reset rating stars
    resetRatingStars();
    
    // Load existing rating if testId is provided
    if (testId) {
        loadImageRating(testId);
    }
    
    modal.show();
}

/**
 * Start polling for async task status
 */
function startTaskPolling(task, cardId) {
    const actualCardId = cardId || task.modelId;
    const pollInterval = setInterval(async () => {
        try {
            const response = await fetch(`/dashboard/image/status/${task.taskId}`);
            const data = await response.json();

            console.log(`[AdminImageTest] Poll ${actualCardId}:`, data.status, data.progress || 0);

            // Get current task from state to preserve testId and saving flag
            const currentTask = state.activeTasks.get(actualCardId) || task;
            // Update task with new data, preserving existing testId and saving flag
            const updatedTask = {
                ...currentTask,
                ...data,
                generationTime: Date.now() - task.startTime
            };
            
            state.activeTasks.set(actualCardId, updatedTask);
            updateResultCard(actualCardId, updatedTask);

            // Stop polling if task is complete, failed, or errored
            if (data.status === 'completed' || data.status === 'failed' || data.status === 'error') {
                clearInterval(pollInterval);
                state.pollIntervals.delete(actualCardId);

                if (data.status === 'completed') {
                    handleTaskCompletion(updatedTask);
                } else {
                    // Handle both 'failed' and 'error' status as failures
                    handleTaskFailure(updatedTask);
                }
            }
        } catch (error) {
            console.error(`[AdminImageTest] Polling error for ${actualCardId}:`, error);
            // On fetch error, keep polling but log the error
            // The backend checkTaskResult already returns error status, so this catch is for network errors
        }
    }, 2000); // Poll every 2 seconds

    state.pollIntervals.set(actualCardId, pollInterval);
}

/**
 * Handle task completion
 */
function handleTaskCompletion(task) {
    console.log(`[AdminImageTest] Task completed: ${task.modelId} in ${task.generationTime}ms`);
    showNotification(`${task.modelName} completed in ${(task.generationTime / 1000).toFixed(1)}s`, 'success');
}

/**
 * Handle task failure
 */
function handleTaskFailure(task) {
    console.error(`[AdminImageTest] Task failed: ${task.modelId}`, task.error);
    showNotification(`${task.modelName} failed: ${task.error}`, 'error');
}

/**
 * Save test result to database
 */
async function saveTestResult(modelId, task) {
    return fetch('/dashboard/image/save-result', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            modelId,
            modelName: task.modelName,
            prompt: task.finalPrompt || task.originalPrompt,
            params: {
                size: task.size,
                style: task.style
            },
            generationTime: task.generationTime,
            status: task.status,
            images: task.images,
            error: task.error
        })
    })
    .then(response => response.json())
    .then(data => {
        console.log(`[AdminImageTest] Result saved for ${modelId}`, data);
        // Store testId in task and clear saving flag
        if (data.testId) {
            task.testId = data.testId;
        }
        task.saving = false;
        // Update the task in activeTasks to reflect the testId
        const currentTask = state.activeTasks.get(modelId);
        if (currentTask) {
            currentTask.testId = data.testId;
            currentTask.saving = false;
            state.activeTasks.set(modelId, currentTask);
        }
        return data;
    })
    .catch(error => {
        console.error(`[AdminImageTest] Error saving result:`, error);
    });
}

/**
 * Check if all tasks are complete
 */
function checkAllTasksComplete() {
    const allComplete = Array.from(state.activeTasks.values()).every(
        task => task.status === 'completed' || task.status === 'failed'
    );

    if (allComplete && state.isGenerating) {
        state.isGenerating = false;
        stopTotalTimer();
        updateGenerateButton(false);
        
        const totalTime = Date.now() - state.generationStartTime;
        document.getElementById('totalTimeDisplay').textContent = `Total: ${(totalTime / 1000).toFixed(1)}s`;
        
        showNotification('All generations complete!', 'success');
        refreshStats();
    }
}

/**
 * Start model-specific timer
 */
function startModelTimer(modelId) {
    const startTime = Date.now();
    const timerEl = document.getElementById(`timer-${modelId}`);
    
    const interval = setInterval(() => {
        if (timerEl) {
            const elapsed = (Date.now() - startTime) / 1000;
            timerEl.textContent = `${elapsed.toFixed(1)}s`;
        }
    }, 100);

    state.timers.set(modelId, interval);
}

/**
 * Stop model-specific timer
 */
function stopModelTimer(modelId) {
    const interval = state.timers.get(modelId);
    if (interval) {
        clearInterval(interval);
        state.timers.delete(modelId);
    }
}

/**
 * Start total timer
 */
function startTotalTimer() {
    const totalEl = document.getElementById('totalTimeDisplay');
    
    state.totalTimerInterval = setInterval(() => {
        if (totalEl && state.generationStartTime) {
            const elapsed = (Date.now() - state.generationStartTime) / 1000;
            totalEl.textContent = `Total: ${elapsed.toFixed(1)}s`;
        }
    }, 100);
}

/**
 * Stop total timer
 */
function stopTotalTimer() {
    if (state.totalTimerInterval) {
        clearInterval(state.totalTimerInterval);
        state.totalTimerInterval = null;
    }
}

/**
 * Clear all results
 */
function clearResults() {
    // Stop all timers
    state.timers.forEach((interval, modelId) => {
        clearInterval(interval);
    });
    state.timers.clear();

    // Stop all polling
    state.pollIntervals.forEach((interval, modelId) => {
        clearInterval(interval);
    });
    state.pollIntervals.clear();

    // Clear tasks
    state.activeTasks.clear();

    // Clear UI
    const container = document.getElementById('resultsContainer');
    container.innerHTML = `
        <div class="text-center text-muted py-5" id="noResultsPlaceholder">
            <i class="bi bi-image display-1"></i>
            <p class="mt-3">Select models and click "Start Generation" to begin testing</p>
        </div>
    `;

    document.getElementById('totalTimeDisplay').classList.add('d-none');
}

/**
 * Update generate button state
 */
function updateGenerateButton(isLoading) {
    const btn = document.getElementById('generateBtn');
    if (isLoading) {
        btn.disabled = true;
        btn.innerHTML = `
            <span class="spinner-border spinner-border-sm me-2"></span>
            Generating...
        `;
    } else {
        btn.disabled = false;
        btn.innerHTML = `
            <i class="bi bi-play-fill me-2"></i>Start Generation
        `;
    }
}

/**
 * Refresh statistics
 */
async function refreshStats() {
    try {
        const response = await fetch('/dashboard/image/stats');
        const data = await response.json();

        if (data.stats) {
            data.stats.forEach(stat => {
                const card = document.querySelector(`.stat-card[data-model-id="${stat.modelId}"]`);
                if (card) {
                    card.querySelector('.badge').textContent = `${stat.totalTests} tests`;
                    card.querySelector('.stat-avg').textContent = stat.averageTime ? `${(stat.averageTime / 1000).toFixed(1)}s` : '--';
                    card.querySelector('.stat-min').textContent = stat.minTime ? `${(stat.minTime / 1000).toFixed(1)}s` : '--';
                    card.querySelector('.stat-max').textContent = stat.maxTime ? `${(stat.maxTime / 1000).toFixed(1)}s` : '--';
                    
                    // Update rating display
                    const ratingSection = card.querySelector('.border-top');
                    if (stat.averageRating && stat.totalRatings) {
                        if (!ratingSection) {
                            // Create rating section if it doesn't exist
                            const ratingHtml = `
                                <div class="text-center mt-2 pt-2 border-top border-secondary">
                                    <small class="text-muted d-block mb-1">Average Rating</small>
                                    <div class="d-flex justify-content-center align-items-center gap-1">
                                        <span class="text-warning fw-bold stat-rating">${stat.averageRating.toFixed(1)}</span>
                                        <i class="bi bi-star-fill text-warning"></i>
                                        <small class="text-muted">(${stat.totalRatings} ratings)</small>
                                    </div>
                                </div>
                            `;
                            card.insertAdjacentHTML('beforeend', ratingHtml);
                        } else {
                            ratingSection.querySelector('.stat-rating').textContent = stat.averageRating.toFixed(1);
                            const ratingsText = ratingSection.querySelector('.text-muted');
                            if (ratingsText) {
                                ratingsText.textContent = `(${stat.totalRatings} ratings)`;
                            }
                        }
                    } else if (ratingSection) {
                        ratingSection.remove();
                    }
                }
            });
        }

        console.log('[AdminImageTest] Stats refreshed');
    } catch (error) {
        console.error('[AdminImageTest] Error refreshing stats:', error);
    }
}

/**
 * Load test history
 */
async function loadHistory() {
    try {
        // Get selected model filter
        const modelFilter = document.getElementById('modelFilter')?.value || '';
        const url = modelFilter 
            ? `/dashboard/image/history?limit=50&modelId=${encodeURIComponent(modelFilter)}`
            : '/dashboard/image/history?limit=50';
        
        const response = await fetch(url);
        const data = await response.json();

        const tbody = document.getElementById('historyTableBody');
        tbody.innerHTML = '';

                if (data.history && data.history.length > 0) {
            data.history.forEach(test => {
                const row = document.createElement('tr');
                
                // Get first image URL if available
                let imageCell = '<span class="text-muted">--</span>';
                const imgUrl = test.images && test.images.length > 0 
                    ? (test.images[0].imageUrl || test.images[0].s3Url || test.images[0])
                    : null;
                
                // Check if content is NSFW based on prompt
                const isNSFW = test.isNSFW || isNSFWPrompt(test.prompt || '');
                const shouldBlur = shouldBlurContent(isNSFW);
                
                // Generate a unique ID for this history item's image
                const historyImgId = `history-img-${test._id || Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                
                if (imgUrl) {
                    const escapedUrl = imgUrl.replace(/'/g, "\\'");
                    
                    if (shouldBlur) {
                        // Blurred thumbnail for NSFW content - use placeholder initially, fetch blur via API
                        imageCell = `
                            <div class="position-relative d-inline-block history-img-wrapper" data-original-url="${imgUrl}">
                                <img src="/img/placeholder.png" 
                                     alt="Generated" 
                                     id="${historyImgId}"
                                     class="history-thumbnail nsfw-blurred"
                                     data-test-id="${test._id || ''}"
                                     data-needs-blur="true"
                                     data-blur-url="${imgUrl}"
                                     onerror="this.src='/img/placeholder.png'">
                                <span class="position-absolute top-50 start-50 translate-middle">
                                    <i class="bi bi-lock-fill text-white" style="font-size: 0.9rem; text-shadow: 0 0 4px rgba(0,0,0,0.7);"></i>
                                </span>
                                ${isNSFW ? '<span class="position-absolute top-0 end-0 badge bg-danger" style="font-size: 0.5rem;">NSFW</span>' : ''}
                            </div>
                        `;
                    } else {
                        imageCell = `
                            <div class="position-relative d-inline-block">
                                <img src="${imgUrl}" 
                                     alt="Generated" 
                                     class="history-thumbnail cursor-pointer"
                                     data-test-id="${test._id || ''}"
                                     onerror="this.src='/img/placeholder.png'">
                                ${isNSFW ? '<span class="position-absolute top-0 end-0 badge bg-danger" style="font-size: 0.5rem;">NSFW</span>' : ''}
                            </div>
                        `;
                    }
                    
                    // Add data attributes to row for click handler
                    row.dataset.hasImage = 'true';
                    row.dataset.imageUrl = imgUrl;
                    row.dataset.modelName = test.modelName || 'Unknown Model';
                    row.dataset.generationTime = test.generationTime || 0;
                    row.dataset.testId = test._id || '';
                    row.dataset.prompt = test.prompt || '';
                    row.dataset.isNsfw = isNSFW.toString();
                    row.style.cursor = 'pointer';
                }
                
                // Escape prompt for HTML and JavaScript
                const escapedPrompt = (test.prompt || '--').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n');
                const displayPrompt = (test.prompt || '--').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                
                row.innerHTML = `
                    <td>${imageCell}</td>
                    <td>${test.modelName || '--'}</td>
                    <td>
                        <div class="d-flex align-items-center gap-2">
                            <span class="text-truncate" style="max-width: 200px; flex: 1;" title="${test.prompt || ''}">${displayPrompt}</span>
                            <button class="btn btn-sm btn-outline-info copy-prompt-btn" 
                                    onclick="copyPrompt('${escapedPrompt}')"
                                    title="Copy prompt">
                                <i class="bi bi-clipboard"></i>
                            </button>
                        </div>
                    </td>
                    <td>${test.params?.size || '--'}</td>
                    <td>${test.generationTime ? (test.generationTime / 1000).toFixed(1) + 's' : '--'}</td>
                    <td>
                        ${test.status === 'completed' 
                            ? '<span class="badge bg-success">Completed</span>' 
                            : test.status === 'failed' 
                                ? '<span class="badge bg-danger">Failed</span>'
                                : `<span class="badge bg-warning">${test.status}</span>`}
                    </td>
                    <td>
                        <span class="small">${new Date(test.testedAt).toLocaleString()}</span>
                    </td>
                `;
                tbody.appendChild(row);
                
                // Add click handler for thumbnail
                const thumbnail = row.querySelector('.history-thumbnail');
                if (thumbnail) {
                    thumbnail.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // Check if content should be blurred and handle accordingly
                        const rowIsNsfw = row.dataset.isNsfw === 'true';
                        const rowShouldBlur = shouldBlurContent(rowIsNsfw);
                        
                        if (rowShouldBlur) {
                            // Show appropriate action for blurred content
                            if (state.isTemporary) {
                                if (typeof openLoginForm === 'function') {
                                    openLoginForm();
                                } else {
                                    window.location.href = '/login';
                                }
                            } else if (!state.isSubscribed) {
                                if (typeof loadPlanPage === 'function') {
                                    loadPlanPage();
                                } else {
                                    window.location.href = '/plan';
                                }
                            } else {
                                // Subscribed user - show preview
                                previewHistoryImage(imgUrl, test.modelName || 'Unknown Model', test.generationTime || 0, test._id || '', test.prompt || '', rowIsNsfw);
                            }
                        } else {
                            previewHistoryImage(imgUrl, test.modelName || 'Unknown Model', test.generationTime || 0, test._id || '', test.prompt || '', rowIsNsfw);
                        }
                    });
                }
                
                // Add click handler for entire row if it has an image
                if (imgUrl) {
                    row.addEventListener('click', function(e) {
                        // Don't trigger if clicking on a button or link inside the row
                        if (e.target.closest('button') || e.target.closest('a') || e.target.tagName === 'BUTTON' || e.target.tagName === 'A') {
                            return;
                        }
                        
                        const imageUrl = this.dataset.imageUrl;
                        const modelName = this.dataset.modelName || 'Unknown Model';
                        const generationTime = parseInt(this.dataset.generationTime) || 0;
                        const testId = this.dataset.testId || '';
                        const prompt = this.dataset.prompt || '';
                        const rowIsNsfw = this.dataset.isNsfw === 'true';
                        const rowShouldBlur = shouldBlurContent(rowIsNsfw);
                        
                        if (rowShouldBlur) {
                            // Show appropriate action for blurred content
                            if (state.isTemporary) {
                                if (typeof openLoginForm === 'function') {
                                    openLoginForm();
                                } else {
                                    window.location.href = '/login';
                                }
                            } else if (!state.isSubscribed) {
                                if (typeof loadPlanPage === 'function') {
                                    loadPlanPage();
                                } else {
                                    window.location.href = '/plan';
                                }
                            } else {
                                // Subscribed user - show preview
                                previewHistoryImage(imageUrl, modelName, generationTime, testId, prompt, rowIsNsfw);
                            }
                        } else {
                            previewHistoryImage(imageUrl, modelName, generationTime, testId, prompt, rowIsNsfw);
                        }
                    });
                }
                
                // Load blurred image for NSFW thumbnail via API
                const blurImg = row.querySelector('[data-needs-blur="true"]');
                if (blurImg && blurImg.dataset.blurUrl) {
                    fetchBlurredImage(blurImg.dataset.blurUrl, function(blobUrl) {
                        blurImg.src = blobUrl;
                        blurImg.removeAttribute('data-needs-blur');
                    });
                }
            });
        } else {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center text-muted">No test history available</td>
                </tr>
            `;
        }

        console.log('[AdminImageTest] History loaded');
    } catch (error) {
        console.error('[AdminImageTest] Error loading history:', error);
    }
}

/**
 * Copy prompt to clipboard
 */
async function copyPrompt(prompt, button = null) {
    try {
        // Ensure prompt is a string
        const promptText = typeof prompt === 'string' ? prompt : String(prompt);
        
        await navigator.clipboard.writeText(promptText);
        
        // Show success feedback on button
        if (button) {
            showCopyFeedback(button);
        }
        
        showNotification('Prompt copied to clipboard!', 'success');
    } catch (error) {
        console.error('[AdminImageTest] Error copying prompt:', error);
        
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        const promptText = typeof prompt === 'string' ? prompt : String(prompt);
        textarea.value = promptText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            if (button) {
                showCopyFeedback(button);
            }
            showNotification('Prompt copied to clipboard!', 'success');
        } catch (err) {
            showNotification('Failed to copy prompt', 'error');
        }
        document.body.removeChild(textarea);
    }
}

/**
 * Show copy feedback on button
 */
function showCopyFeedback(button) {
    if (!button) return;
    
    const icon = button.querySelector('i');
    if (!icon) return;
    
    const originalClass = icon.className;
    
    // Change icon to checkmark
    icon.className = 'bi bi-check';
    button.classList.add('btn-success');
    button.classList.remove('btn-outline-info');
    
    // Reset after 2 seconds
    setTimeout(() => {
        icon.className = originalClass;
        button.classList.remove('btn-success');
        button.classList.add('btn-outline-info');
    }, 2000);
}

/**
 * Preview image from history
 */
function previewHistoryImage(imageUrl, modelName, generationTime, testId = null, prompt = '', isNSFW = false) {
    const modal = new bootstrap.Modal(document.getElementById('imagePreviewModal'));
    const modalElement = document.getElementById('imagePreviewModal');
    const previewImage = document.getElementById('previewImage');
    const previewContainer = previewImage.parentElement;
    
    // Remove any existing NSFW overlay
    const existingOverlay = previewContainer.querySelector('.preview-nsfw-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }
    
    // Check if content is NSFW (from parameter or prompt detection)
    const contentIsNSFW = isNSFW || isNSFWPrompt(prompt || '');
    const shouldBlur = shouldBlurContent(contentIsNSFW);
    
    if (shouldBlur && !state.isSubscribed) {
        // For non-subscribed users, fetch blurred image via API - never expose real URL
        previewImage.src = '/img/placeholder.png'; // Placeholder while loading
        
        // Fetch blurred version via API
        fetchBlurredImage(imageUrl, function(blobUrl) {
            previewImage.src = blobUrl;
        });
        
        // Create preview overlay
        const overlay = document.createElement('div');
        overlay.className = 'preview-nsfw-overlay position-absolute top-0 start-0 w-100 h-100 d-flex flex-column justify-content-center align-items-center';
        overlay.style.cssText = 'background: rgba(0, 0, 0, 0.4); z-index: 10; border-radius: inherit;';
        
        const lockIcon = document.createElement('i');
        lockIcon.className = 'bi bi-lock-fill';
        lockIcon.style.cssText = 'font-size: 3rem; color: #fff; opacity: 0.9; margin-bottom: 1rem;';
        
        const message = document.createElement('p');
        message.className = 'text-white text-center mb-3';
        message.style.cssText = 'font-size: 1rem; max-width: 80%;';
        message.textContent = state.isTemporary 
            ? 'Login to view adult content' 
            : 'Subscribe to unlock adult content';
        
        const actionBtn = document.createElement('button');
        actionBtn.className = 'btn';
        actionBtn.style.cssText = 'background: linear-gradient(90.9deg, #D2B8FF 2.74%, #8240FF 102.92%); color: white; border: none; border-radius: 8px; font-weight: 600; padding: 0.6rem 1.5rem;';
        actionBtn.innerHTML = state.isTemporary 
            ? '<i class="bi bi-box-arrow-in-right me-2"></i>Login' 
            : '<i class="bi bi-gem me-2"></i>Subscribe';
        actionBtn.onclick = function() {
            if (state.isTemporary) {
                if (typeof openLoginForm === 'function') {
                    openLoginForm();
                } else {
                    window.location.href = '/login';
                }
            } else {
                if (typeof loadPlanPage === 'function') {
                    loadPlanPage();
                } else {
                    window.location.href = '/plan';
                }
            }
        };
        
        overlay.appendChild(lockIcon);
        overlay.appendChild(message);
        overlay.appendChild(actionBtn);
        
        previewContainer.style.position = 'relative';
        previewContainer.appendChild(overlay);
    } else {
        // Show image normally (either not NSFW, or user is subscribed)
        previewImage.src = imageUrl;
        previewImage.style.filter = 'none';
        previewImage.style.transform = 'none';
    }
    
    document.getElementById('previewModelName').textContent = modelName || 'Unknown Model';
    document.getElementById('previewTime').textContent = generationTime 
        ? `Generated in ${(generationTime / 1000).toFixed(1)} seconds`
        : '';
    
    // Show truncated prompt
    const promptEl = document.getElementById('previewPrompt');
    if (promptEl && prompt) {
        const truncatedPrompt = prompt.length > 100 ? prompt.substring(0, 100) + '...' : prompt;
        promptEl.textContent = truncatedPrompt;
        promptEl.title = prompt;
        promptEl.style.display = 'block';
    } else if (promptEl) {
        promptEl.style.display = 'none';
    }
    
    // Store current image info for rating and draft
    modalElement.dataset.modelId = 'history-image';
    modalElement.dataset.modelName = modelName || 'Unknown Model';
    modalElement.dataset.imageUrl = imageUrl;
    modalElement.dataset.testId = testId || '';
    modalElement.dataset.prompt = prompt || '';
    modalElement.dataset.isFromHistory = 'true';
    
    // Reset rating stars
    resetRatingStars();
    
    // Load existing rating if testId is provided
    if (testId) {
        loadImageRating(testId);
    }
    
    modal.show();
}

/**
 * Reset rating stars to default state
 */
function resetRatingStars() {
    const stars = document.querySelectorAll('.rating-star');
    stars.forEach(star => {
        star.classList.remove('bi-star-fill', 'active', 'filled');
        star.classList.add('bi-star');
    });
    document.getElementById('ratingStatus').textContent = 'Click a star to rate';
}

/**
 * Initialize rating stars click handlers
 */
function initializeRatingStars() {
    const stars = document.querySelectorAll('.rating-star');
    stars.forEach(star => {
        star.addEventListener('click', function() {
            const rating = parseInt(this.dataset.rating);
            setRating(rating);
            saveImageRating(rating);
        });
        
        star.addEventListener('mouseenter', function() {
            const rating = parseInt(this.dataset.rating);
            highlightStars(rating);
        });
    });
    
    const ratingContainer = document.getElementById('ratingStars');
    if (ratingContainer) {
        ratingContainer.addEventListener('mouseleave', function() {
            const currentRating = parseInt(ratingContainer.dataset.currentRating || '0');
            if (currentRating > 0) {
                highlightStars(currentRating);
            } else {
                resetRatingStars();
            }
        });
    }
}

/**
 * Set rating and highlight stars
 */
function setRating(rating) {
    const ratingContainer = document.getElementById('ratingStars');
    ratingContainer.dataset.currentRating = rating;
    highlightStars(rating);
    document.getElementById('ratingStatus').textContent = `Rated ${rating} out of 5 stars`;
}

/**
 * Highlight stars up to the given rating
 */
function highlightStars(rating) {
    const stars = document.querySelectorAll('.rating-star');
    stars.forEach((star, index) => {
        const starRating = parseInt(star.dataset.rating);
        if (starRating <= rating) {
            star.classList.remove('bi-star');
            star.classList.add('bi-star-fill', 'active', 'filled');
        } else {
            star.classList.remove('bi-star-fill', 'active', 'filled');
            star.classList.add('bi-star');
        }
    });
}

/**
 * Save image rating
 */
async function saveImageRating(rating) {
    const modal = document.getElementById('imagePreviewModal');
    const modelId = modal.dataset.modelId;
    const modelName = modal.dataset.modelName;
    const imageUrl = modal.dataset.imageUrl;
    const testId = modal.dataset.testId;
    
    if (!modelId || !imageUrl) {
        console.error('[AdminImageTest] Missing modelId or imageUrl for rating');
        return;
    }
    
    try {
        const response = await fetch('/dashboard/image/rate-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                modelId,
                modelName,
                imageUrl,
                rating,
                testId: testId || null
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Rating saved: ${rating} stars`, 'success');
            // Refresh statistics to show updated average rating
            refreshStats();
        } else {
            showNotification(data.error || 'Failed to save rating', 'error');
        }
    } catch (error) {
        console.error('[AdminImageTest] Error saving rating:', error);
        showNotification('Failed to save rating', 'error');
    }
}

/**
 * Load existing rating for an image
 */
async function loadImageRating(testId) {
    if (!testId) return;
    
    try {
        const response = await fetch(`/dashboard/image/rating/${testId}`);
        const data = await response.json();
        
        if (data.success && data.rating) {
            setRating(data.rating);
        }
    } catch (error) {
        console.error('[AdminImageTest] Error loading rating:', error);
    }
}

/**
 * Set default character creation model
 */
async function setDefaultModel(style, modelId) {
    try {
        const response = await fetch('/dashboard/image/default-model', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ style, modelId })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');
        } else {
            showNotification(data.error || 'Failed to set default model', 'error');
        }
    } catch (error) {
        console.error('[AdminImageTest] Error setting default model:', error);
        showNotification(error.message, 'error');
    }
}

/**
 * Reset all statistics
 */
async function resetAllStats() {
    if (!confirm('Are you sure you want to reset all model statistics?')) {
        return;
    }

    try {
        const response = await fetch('/dashboard/image/stats/reset', {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('All statistics reset', 'success');
            refreshStats();
            loadHistory();
        } else {
            showNotification(data.error || 'Failed to reset stats', 'error');
        }
    } catch (error) {
        console.error('[AdminImageTest] Error resetting stats:', error);
        showNotification(error.message, 'error');
    }
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // Fallback toast notification
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${type === 'error' ? 'danger' : type === 'success' ? 'success' : 'info'} border-0`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container position-fixed top-0 end-0 p-3';
        document.body.appendChild(container);
    }
    
    container.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();
    
    toast.addEventListener('hidden.bs.toast', () => toast.remove());
}

// Draft post state
let currentDraftData = null;
let saveDraftModal = null;

/**
 * Save current image as draft post
 */
function saveAsDraftPost() {
    const modal = document.getElementById('imagePreviewModal');
    const imageUrl = modal.dataset.imageUrl;
    const modelId = modal.dataset.modelId;
    const modelName = modal.dataset.modelName;
    const testId = modal.dataset.testId;
    const isFromHistory = modal.dataset.isFromHistory === 'true';
    
    if (!imageUrl) {
        showNotification('No image to save', 'error');
        return;
    }
    
    // Get the prompt - from modal dataset for history items, or from task for current generation
    let prompt = '';
    if (isFromHistory) {
        prompt = modal.dataset.prompt || '';
    } else {
        const task = state.activeTasks.get(modelId);
        prompt = task?.finalPrompt || task?.originalPrompt || document.getElementById('promptInput')?.value || '';
    }
    
    // Store data for the draft
    currentDraftData = {
        imageUrl,
        prompt,
        model: modelName,
        testId: testId || null,
        parameters: {
            size: document.getElementById('sizeSelect')?.value,
            style: document.querySelector('input[name="stylePreset"]:checked')?.value
        }
    };
    
    // Update draft modal preview
    document.getElementById('draftPreviewImage').src = imageUrl;
    document.getElementById('draftCaptionText').value = '';
    
    // Close preview modal and open draft modal
    bootstrap.Modal.getInstance(modal)?.hide();
    
    if (!saveDraftModal) {
        saveDraftModal = new bootstrap.Modal(document.getElementById('saveDraftModal'));
    }
    
    // Initialize caption history
    CaptionHistory.renderHistory('draftCaptionHistory', 'draftCaptionText');
    
    saveDraftModal.show();
}

/**
 * Caption History Management
 */
const CaptionHistory = {
    STORAGE_KEY: 'captionHistory',
    MAX_ITEMS: 20,
    
    getHistory() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.error('[CaptionHistory] Error reading history:', e);
            return [];
        }
    },
    
    saveCaption(caption, imageId = null) {
        if (!caption || caption.trim().length === 0) return;
        
        try {
            const history = this.getHistory();
            const newEntry = {
                id: Date.now().toString(),
                caption: caption.trim(),
                imageId: imageId,
                createdAt: new Date().toISOString()
            };
            
            // Check for duplicates (same caption text)
            const exists = history.some(h => h.caption === newEntry.caption);
            if (!exists) {
                history.unshift(newEntry);
                // Keep only the last MAX_ITEMS
                if (history.length > this.MAX_ITEMS) {
                    history.splice(this.MAX_ITEMS);
                }
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
            }
            
            // Update UI if container exists
            this.renderHistory('draftCaptionHistory', 'draftCaptionText');
        } catch (e) {
            console.error('[CaptionHistory] Error saving caption:', e);
        }
    },
    
    deleteCaption(captionId) {
        try {
            const history = this.getHistory();
            const filtered = history.filter(h => h.id !== captionId);
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filtered));
            this.renderHistory('draftCaptionHistory', 'draftCaptionText');
        } catch (e) {
            console.error('[CaptionHistory] Error deleting caption:', e);
        }
    },
    
    renderHistory(containerId, textareaId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const history = this.getHistory();
        
        if (history.length === 0) {
            container.innerHTML = '<small class="text-muted">No caption history yet</small>';
            return;
        }
        
        const html = history.slice(0, 10).map(item => {
            const date = new Date(item.createdAt);
            const timeAgo = this.formatTimeAgo(date);
            const shortCaption = item.caption.length > 100 
                ? item.caption.substring(0, 100) + '...' 
                : item.caption;
            
            return `
                <div class="caption-history-item d-flex align-items-start gap-2 p-2 mb-1 rounded" style="background: rgba(255,255,255,0.05); cursor: pointer;" 
                     onclick="CaptionHistory.useCaption('${item.id}', '${textareaId}')">
                    <div class="flex-grow-1">
                        <small class="d-block text-white-50" style="font-size: 0.75rem;">${this.escapeHtml(shortCaption)}</small>
                        <small class="text-muted" style="font-size: 0.65rem;">${timeAgo}</small>
                    </div>
                    <button type="button" class="btn btn-sm p-0 text-danger" onclick="event.stopPropagation(); CaptionHistory.deleteCaption('${item.id}')" title="Delete">
                        <i class="bi bi-x"></i>
                    </button>
                </div>
            `;
        }).join('');
        
        container.innerHTML = `
            <label class="form-label small text-muted mt-2">
                <i class="bi bi-clock-history me-1"></i>Caption History
            </label>
            <div class="caption-history-list" style="max-height: 150px; overflow-y: auto;">
                ${html}
            </div>
        `;
    },
    
    useCaption(captionId, textareaId) {
        const history = this.getHistory();
        const item = history.find(h => h.id === captionId);
        if (item) {
            const textarea = document.getElementById(textareaId);
            if (textarea) {
                textarea.value = item.caption;
                textarea.focus();
                showNotification('Caption applied!', 'success');
            }
        }
    },
    
    formatTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        const intervals = { day: 86400, hour: 3600, minute: 60 };
        
        for (const [unit, secondsInUnit] of Object.entries(intervals)) {
            const interval = Math.floor(seconds / secondsInUnit);
            if (interval >= 1) {
                return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
            }
        }
        return 'Just now';
    },
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Make CaptionHistory globally available
window.CaptionHistory = CaptionHistory;

/**
 * Generate caption for draft post using AI
 */
async function generateDraftCaption() {
    const captionInput = document.getElementById('draftCaptionText');
    const btn = document.getElementById('generateCaptionBtn');
    
    if (!currentDraftData?.prompt) {
        showNotification('No prompt available for caption generation', 'warning');
        return;
    }
    
    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Generating...';
    captionInput.disabled = true;
    
    try {
        // Get style and language from dropdowns
        const captionStyle = document.getElementById('draftCaptionStyle')?.value || 'engaging';
        const captionLanguage = document.getElementById('draftCaptionLanguage')?.value || 'english';
        
        // Get existing caption (if any) to use as a starting point
        const existingCaption = captionInput.value.trim();
        
        const response = await fetch('/api/posts/generate-caption', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: currentDraftData.prompt,
                platform: 'general',
                style: captionStyle,
                language: captionLanguage,
                existingCaption: existingCaption || undefined
            })
        });
        
        const data = await response.json();
        
        if (data.success && data.caption) {
            captionInput.value = data.caption;
            // Save to caption history
            CaptionHistory.saveCaption(data.caption, currentDraftData.testId);
            showNotification('Caption generated!', 'success');
        } else {
            throw new Error(data.error || 'Failed to generate caption');
        }
    } catch (error) {
        console.error('[ImageDashboard] Error generating caption:', error);
        showNotification('Failed to generate caption', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-magic me-1"></i>Generate Caption with AI';
        captionInput.disabled = false;
    }
}

/**
 * Confirm and save draft post
 */
async function confirmSaveDraft() {
    if (!currentDraftData) {
        showNotification('No draft data available', 'error');
        return;
    }
    
    const caption = document.getElementById('draftCaptionText').value;
    const btn = document.getElementById('confirmSaveDraftBtn');
    
    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';
    
    try {
        const response = await fetch('/api/posts/draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                imageUrl: currentDraftData.imageUrl,
                prompt: currentDraftData.prompt,
                model: currentDraftData.model,
                testId: currentDraftData.testId,
                parameters: currentDraftData.parameters,
                generateCaption: !caption, // Generate caption if not provided
                caption: caption || undefined
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Draft post saved! Redirecting to My Posts...', 'success');
            
            // Close modal
            saveDraftModal?.hide();
            
            // Redirect to My Posts after short delay
            setTimeout(() => {
                window.location.href = '/dashboard/posts';
            }, 1500);
        } else {
            throw new Error(data.error || 'Failed to save draft');
        }
    } catch (error) {
        console.error('[ImageDashboard] Error saving draft:', error);
        showNotification('Failed to save draft: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check me-1"></i>Save Draft';
    }
}


// ==============================================
// User Custom Model Management
// ==============================================

// User models state
let userCustomModels = [];
let userModelSearchModal = null;
let isPremiumUser = false;

/**
 * Initialize user model management on page load
 */
function initializeUserModelManagement() {
    // Check premium status
    isPremiumUser = window.user?.subscriptionStatus === 'active';
    
    // Update premium UI
    updateCustomModelsPremiumUI();
    
    // Initialize modal
    const modalElement = document.getElementById('userModelSearchModal');
    if (modalElement) {
        userModelSearchModal = new bootstrap.Modal(modalElement);
    }

    // Search input event listeners
    const searchInput = document.getElementById('userModelSearchInput');
    const searchBtn = document.getElementById('userModelSearchBtn');
    
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.which === 13) {
                e.preventDefault();
                searchUserModels(searchInput.value.trim());
            }
        });
    }
    
    if (searchBtn) {
        searchBtn.addEventListener('click', function() {
            searchUserModels(document.getElementById('userModelSearchInput').value.trim());
        });
    }
    
    // Load user's existing custom models
    loadUserCustomModels();
}

/**
 * Update UI based on premium status for custom models section
 */
function updateCustomModelsPremiumUI() {
    const premiumNotice = document.getElementById('customModelsPremiumNotice');
    const userCustomModelsList = document.getElementById('userCustomModelsList');
    const addModelBtn = document.querySelector('[onclick="openUserModelSearchModal()"]');
    
    if (!isPremiumUser) {
        // Show premium notice for non-subscribers
        if (premiumNotice) premiumNotice.style.display = 'flex';
        // Hide the models list for non-premium users
        if (userCustomModelsList) userCustomModelsList.style.display = 'none';
        // Hide or disable add model button
        if (addModelBtn) addModelBtn.style.display = 'none';
    } else {
        // Hide premium notice for subscribers
        if (premiumNotice) premiumNotice.style.display = 'none';
        // Show the models list for premium users
        if (userCustomModelsList) userCustomModelsList.style.display = 'block';
        // Show add model button
        if (addModelBtn) addModelBtn.style.display = 'inline-flex';
    }
}

/**
 * Open the user model search modal
 */
function openUserModelSearchModal() {
    // Check premium status - redirect to plan page if not premium
    if (!isPremiumUser) {
        loadPlanPage();
        return;
    }
    
    // Reset search state
    document.getElementById('userModelSearchInput').value = '';
    document.getElementById('userModelSearchResultsList').innerHTML = '';
    document.getElementById('userModelSearchPlaceholder').classList.remove('d-none');
    document.getElementById('userModelNoResults').classList.add('d-none');
    document.getElementById('userModelSearchLoading').classList.add('d-none');
    
    if (userModelSearchModal) {
        userModelSearchModal.show();
    }
}

/**
 * Search for models using Civitai/Novita API
 */
async function searchUserModels(query) {
    if (!query || query.length < 2) {
        showNotification('Please enter at least 2 characters', 'warning');
        return;
    }

    // Show loading state
    document.getElementById('userModelSearchPlaceholder').classList.add('d-none');
    document.getElementById('userModelNoResults').classList.add('d-none');
    document.getElementById('userModelSearchLoading').classList.remove('d-none');
    document.getElementById('userModelSearchResultsList').innerHTML = '';

    try {
        const response = await fetch(`/api/civitai/search?query=${encodeURIComponent(query)}&limit=20`);
        const data = await response.json();

        document.getElementById('userModelSearchLoading').classList.add('d-none');

        if (data.success && data.models && data.models.length > 0) {
            renderUserModelSearchResults(data.models);
        } else {
            document.getElementById('userModelNoResults').classList.remove('d-none');
        }
    } catch (error) {
        console.error('[ImageDashboard] Error searching models:', error);
        document.getElementById('userModelSearchLoading').classList.add('d-none');
        document.getElementById('userModelNoResults').classList.remove('d-none');
        showNotification('Failed to search models', 'error');
    }
}

/**
 * Render search results in the modal
 */
function renderUserModelSearchResults(models) {
    const container = document.getElementById('userModelSearchResultsList');
    container.innerHTML = '';

    models.forEach(model => {
        const previewImage = model.previewImage || model.cover_url || '/img/default-model.png';
        const rating = model.stats?.rating ? Number(model.stats.rating).toFixed(1) : 'N/A';
        const downloads = formatModelNumber(model.stats?.downloadCount || 0);
        const favorites = formatModelNumber(model.stats?.favoriteCount || 0);
        
        // Check if model already exists in user's collection
        const isAdded = userCustomModels.some(m => m.civitaiModelId === model.id.toString());

        // For Novita API, use sd_name as the file name
        const sdName = model.sd_name || model.name;
        const baseModel = model.base_model || model.modelVersions?.[0]?.baseModel || 'SD 1.5';

        const versionsHtml = model.modelVersions?.map((v, idx) => {
            const file = v.files?.[0];
            const fileName = file?.name || sdName;
            return `<option value="${v.id}" 
                data-name="${escapeModelHtml(v.name)}" 
                data-file="${escapeModelHtml(fileName)}"
                data-base="${escapeModelHtml(v.baseModel || baseModel)}">
                ${escapeModelHtml(v.name)} ${v.baseModel ? `(${v.baseModel})` : ''}
            </option>`;
        }).join('') || `<option value="${model.id}" data-name="Default" data-file="${escapeModelHtml(sdName)}" data-base="${escapeModelHtml(baseModel)}">Default (${baseModel})</option>`;

        const tagsHtml = model.tags?.slice(0, 3).map(tag => 
            `<span class="badge bg-secondary">${escapeModelHtml(tag)}</span>`
        ).join(' ') || '';

        const cardHtml = `
            <div class="civitai-model-card d-flex gap-3 mb-3 p-3 rounded ${isAdded ? 'opacity-50' : ''}" 
                 data-model-id="${model.id}" 
                 data-sd-name="${escapeModelHtml(sdName)}"
                 style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);">
                <img src="${previewImage}" class="rounded" alt="${escapeModelHtml(model.name)}" 
                     style="width: 80px; height: 80px; object-fit: cover;"
                     onerror="this.src='/img/default-model.png'">
                <div class="flex-grow-1">
                    <div class="fw-bold text-white">${escapeModelHtml(model.name)}</div>
                    <small class="text-muted d-block text-truncate" style="max-width: 300px;" title="${escapeModelHtml(sdName)}">${escapeModelHtml(sdName)}</small>
                    <div class="my-1">
                        <small class="text-muted me-2"><i class="bi bi-download"></i> ${downloads}</small>
                        <small class="text-muted me-2"><i class="bi bi-heart"></i> ${favorites}</small>
                        <small class="text-muted"><i class="bi bi-star"></i> ${rating}</small>
                    </div>
                    <div class="mb-2">${tagsHtml}</div>
                    
                    ${model.modelVersions?.length > 0 ? `
                    <div class="mb-2">
                        <select class="form-select form-select-sm bg-secondary text-white border-secondary version-select-dropdown" data-model-id="${model.id}">
                            ${versionsHtml}
                        </select>
                    </div>
                    ` : ''}
                    
                    <div>
                        ${isAdded ? 
                            `<span class="text-success small"><i class="bi bi-check-circle"></i> Already added</span>` :
                            `<button class="btn btn-sm btn-primary add-user-model-btn" 
                                data-model-id="${model.id}"
                                data-model-name="${escapeModelHtml(model.name)}"
                                data-model-image="${previewImage}"
                                data-model-style="${model.tags?.[0] || ''}">
                                <i class="bi bi-plus-lg me-1"></i>Add Model
                            </button>`
                        }
                    </div>
                </div>
            </div>
        `;

        container.insertAdjacentHTML('beforeend', cardHtml);
    });

    // Handle add model button clicks
    container.querySelectorAll('.add-user-model-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const card = this.closest('.civitai-model-card');
            const modelId = this.dataset.modelId;
            const modelName = this.dataset.modelName;
            const modelImage = this.dataset.modelImage;
            const modelStyle = this.dataset.modelStyle;
            
            // Get sd_name from card data attribute (set from Novita API)
            const cardSdName = card.dataset.sdName;
            
            // Get selected version info (if version dropdown exists)
            const versionSelect = card.querySelector('.version-select-dropdown');
            const versionId = versionSelect?.value || modelId;
            const selectedOption = versionSelect?.options[versionSelect.selectedIndex];
            const versionName = selectedOption?.dataset.name || 'Default';
            const fileName = selectedOption?.dataset.file || cardSdName || modelName;
            const baseModel = selectedOption?.dataset.base || 'SD 1.5';

            addUserCustomModel({
                civitaiModelId: modelId,
                civitaiVersionId: versionId,
                modelName: modelName,
                versionName: versionName,
                fileName: fileName,
                image: modelImage,
                style: modelStyle,
                baseModel: baseModel
            }, this);
        });
    });
}

/**
 * Add a model to user's custom collection
 */
async function addUserCustomModel(modelData, btn) {
    try {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

        const response = await fetch('/api/user/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(modelData)
        });

        const data = await response.json();

        if (data.success) {
            userCustomModels.push(data.model);
            renderUserCustomModelsInDashboard();
            updateUserModelsCount();
            
            // Update button state
            btn.replaceWith(document.createRange().createContextualFragment(
                `<span class="text-success small"><i class="bi bi-check-circle"></i> Added</span>`
            ));
            btn.closest('.civitai-model-card')?.classList.add('opacity-50');
            
            showNotification('Model added successfully!', 'success');
        } else {
            throw new Error(data.error || 'Failed to add model');
        }
    } catch (error) {
        console.error('[ImageDashboard] Error adding model:', error);
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-plus-lg me-1"></i>Add Model';
        showNotification(error.message || 'Failed to add model', 'error');
    }
}

/**
 * Remove a model from user's collection
 */
async function removeUserCustomModel(modelId) {
    if (!confirm('Remove this model from your collection?')) {
        return;
    }

    try {
        const response = await fetch(`/api/user/models/${modelId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            userCustomModels = userCustomModels.filter(m => m._id !== modelId);
            renderUserCustomModelsInDashboard();
            updateUserModelsCount();
            showNotification('Model removed', 'success');
        } else {
            throw new Error(data.error || 'Failed to remove model');
        }
    } catch (error) {
        console.error('[ImageDashboard] Error removing model:', error);
        showNotification('Failed to remove model', 'error');
    }
}

/**
 * Load user's custom models from server
 */
async function loadUserCustomModels() {
    try {
        const response = await fetch('/api/user/models');
        const data = await response.json();

        if (data.success) {
            userCustomModels = data.models || [];
            renderUserCustomModelsInDashboard();
            updateUserModelsCount();
        }
    } catch (error) {
        console.error('[ImageDashboard] Error loading user models:', error);
    }
}

/**
 * Render user's custom models in the dashboard SD models section
 */
function renderUserCustomModelsInDashboard() {
    const container = document.getElementById('userCustomModelsList');
    const placeholder = document.getElementById('noUserModelsPlaceholder');
    
    if (!container) return;

    // Clear existing model cards (but keep the placeholder)
    container.querySelectorAll('.user-custom-model-item').forEach(el => el.remove());

    if (userCustomModels.length === 0) {
        if (placeholder) placeholder.style.display = 'block';
        return;
    }

    if (placeholder) placeholder.style.display = 'none';

    userCustomModels.forEach(model => {
        const modelHtml = `
            <div class="form-check model-checkbox mb-2 user-custom-model-item position-relative" data-user-model-id="${model._id}">
                <button class="btn btn-sm btn-outline-danger position-absolute" 
                        style="top: 5px; right: 5px; padding: 2px 6px; font-size: 0.7rem; z-index: 10;"
                        onclick="event.stopPropagation(); removeUserCustomModel('${model._id}')"
                        title="Remove model">
                    <i class="bi bi-x"></i>
                </button>
                <input class="form-check-input sd-model-checkbox user-sd-model-checkbox" type="checkbox" 
                       value="${model.modelId}" 
                       id="user-sd-model-${model._id}" 
                       data-model="${model.model}"
                       data-model-name="${escapeModelHtml(model.name)}"
                       data-model-id="${model.modelId}"
                       data-is-user-model="true">
                <label class="form-check-label text-white" for="user-sd-model-${model._id}">
                    <div class="d-flex align-items-start gap-2">
                        ${model.image ? `
                        <img src="${model.image}" 
                             alt="${escapeModelHtml(model.name)}" 
                             class="model-thumbnail"
                             style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;"
                             onerror="this.style.display='none'">
                        ` : ''}
                        <div class="flex-grow-1" style="padding-right: 25px;">
                            <span class="fw-semibold">${escapeModelHtml(model.name)}</span>
                            <span class="badge bg-primary ms-1">Custom</span>
                            <br>
                            <small class="text-muted text-truncate d-block" style="max-width: 200px;">${escapeModelHtml(model.model || '')}</small>
                        </div>
                    </div>
                </label>
            </div>
        `;

        container.insertAdjacentHTML('beforeend', modelHtml);
    });

    // Re-initialize click handlers for the new model checkboxes
    container.querySelectorAll('.user-custom-model-item').forEach(checkbox => {
        checkbox.addEventListener('click', function(e) {
            // Don't trigger if clicking on the remove button
            if (e.target.closest('button')) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            this.classList.toggle('selected');
            updateSDParamsVisibility();
            updateCostDisplay();
        });
    });
}

/**
 * Update user models count badge
 */
function updateUserModelsCount() {
    const countBadge = document.getElementById('userCustomModelsCount');
    if (countBadge) {
        countBadge.textContent = userCustomModels.length;
    }
}

/**
 * Get selected user custom SD models
 */
function getSelectedUserSDModels() {
    const checkboxes = document.querySelectorAll('.user-custom-model-item.selected');
    
    return Array.from(checkboxes).map(cb => {
        const input = cb.querySelector('.user-sd-model-checkbox');
        return {
            modelId: input.value,
            model: input.dataset.model,
            model_name: input.dataset.model,
            name: input.dataset.modelName,
            isUserModel: true
        };
    });
}

/**
 * Format number with K/M suffix
 */
function formatModelNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeModelHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize user model management when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    initializeUserModelManagement();
});

// ==============================================
// Character Creation from Image
// ==============================================

let createCharacterModal = null;
let addToGalleryModal = null;
let currentCharacterImageData = null;
let selectedCharacterForGallery = null;

/**
 * Open the create character modal
 */
function openCreateCharacterModal() {
    const previewModal = document.getElementById('imagePreviewModal');
    const imageUrl = previewModal.dataset.imageUrl;
    const prompt = previewModal.dataset.prompt;
    const modelId = previewModal.dataset.modelId;
    const modelName = previewModal.dataset.modelName;
    
    if (!imageUrl) {
        showNotification('No image selected', 'error');
        return;
    }
    
    // Get the task data if available to retrieve SD model information
    let sdModelName = null;
    let imageModel = null;
    let imageVersion = 'sdxl';
    let imageStyle = 'general';
    
    // Try to get model info from active task
    if (modelId && state.activeTasks) {
        const task = state.activeTasks.get(modelId);
        if (task) {
            sdModelName = task.sdModelName;
            // For SD models, the actual model name is in sdModelName
            if (task.modelId === 'sd-txt2img' || task.modelId === 'sd-img2img') {
                imageModel = task.sdModelName || 'prefectPonyXL_v50_1128833';
                imageVersion = 'sdxl';
                imageStyle = 'general';
            }
        }
    }
    
    // Store current image data including model info
    currentCharacterImageData = {
        imageUrl: imageUrl,
        prompt: prompt || document.getElementById('promptInput')?.value || '',
        modelId: modelId,
        modelName: modelName,
        sdModelName: sdModelName,
        imageModel: imageModel || sdModelName,
        imageVersion: imageVersion,
        imageStyle: imageStyle
    };
    
    // Determine if we need to show the model selector
    // Get the selected models to check their category
    const currentModelCategory = getSelectedModels().find(m => m.id === modelId)?.category;
    
    // Show model selector if the current model is not suitable for text-to-image
    const needsModelSelection = currentModelCategory && INCOMPATIBLE_TEXT_TO_IMAGE_CATEGORIES.includes(currentModelCategory);
    currentCharacterImageData.needsModelSelection = needsModelSelection;
    
    // Update modal content
    document.getElementById('characterPreviewImage').src = imageUrl;
    document.getElementById('characterPromptPreview').textContent = currentCharacterImageData.prompt.length > 200 
        ? currentCharacterImageData.prompt.substring(0, 200) + '...' 
        : currentCharacterImageData.prompt;
    document.getElementById('characterNameInput').value = '';
    document.getElementById('characterPersonalityInput').value = '';
    document.getElementById('characterNsfwCheck').checked = false;
    document.getElementById('useImageAsBaseFaceCheck').checked = false;
    
    // Populate the text-to-image model selector if needed
    const modelSection = document.getElementById('characterImageModelSection');
    const modelSelect = document.getElementById('characterImageModelSelect');
    
    if (needsModelSelection && modelSection && modelSelect) {
        // Show the model selection section
        modelSection.style.display = 'block';
        
        // Get all txt2img models from the checkboxes
        const txt2imgCheckboxes = document.querySelectorAll('.txt2img-model-checkbox');
        const txt2imgModels = Array.from(txt2imgCheckboxes).map(checkbox => ({
            id: checkbox.value,
            name: checkbox.dataset.modelName
        }));
        
        // Store model data for later use in confirmCreateCharacter
        currentCharacterImageData.txt2imgModels = txt2imgModels;
        
        // Clear existing options and populate safely using DOM methods
        modelSelect.innerHTML = '';
        txt2imgModels.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.name;
            modelSelect.appendChild(option);
        });
        
        // Select the first model by default
        if (txt2imgModels.length > 0) {
            modelSelect.value = txt2imgModels[0].id;
        }
    } else if (modelSection) {
        // Hide the section if not needed
        modelSection.style.display = 'none';
    }
    
    // Reset the create button to its original state
    const createBtn = document.getElementById('confirmCreateCharacterBtn');
    if (createBtn) {
        createBtn.disabled = false;
        createBtn.classList.remove('btn-primary');
        createBtn.classList.add('btn-success');
        createBtn.innerHTML = '<i class="bi bi-person-plus me-1"></i>Create Character';
        createBtn.onclick = confirmCreateCharacter;
    }
    
    // Reset cancel button text
    const cancelBtn = createBtn?.previousElementSibling;
    if (cancelBtn && cancelBtn.classList.contains('btn-secondary')) {
        cancelBtn.textContent = 'Cancel';
    }
    
    // Close preview modal and open character creation modal
    bootstrap.Modal.getInstance(previewModal)?.hide();
    
    if (!createCharacterModal) {
        createCharacterModal = new bootstrap.Modal(document.getElementById('createCharacterModal'));
    }
    createCharacterModal.show();
}

/**
 * Confirm and create character from image
 */
async function confirmCreateCharacter() {
    if (!currentCharacterImageData) {
        showNotification('No image data available', 'error');
        return;
    }
    
    const btn = document.getElementById('confirmCreateCharacterBtn');
    const name = document.getElementById('characterNameInput').value.trim();
    const personalityInput = document.getElementById('characterPersonalityInput').value.trim();
    const language = document.getElementById('characterLanguageSelect').value;
    const nsfw = document.getElementById('characterNsfwCheck').checked;
    const useImageAsBaseFace = document.getElementById('useImageAsBaseFaceCheck').checked;
    
    // Get the selected text-to-image model if the section is visible
    let finalModelId = currentCharacterImageData.modelId;
    let finalModelName = currentCharacterImageData.modelName;
    
    if (currentCharacterImageData.needsModelSelection) {
        const modelSelect = document.getElementById('characterImageModelSelect');
        if (modelSelect && modelSelect.value) {
            const selectedModelId = modelSelect.value;
            // Use cached model data to find the selected model
            const txt2imgModels = currentCharacterImageData.txt2imgModels || [];
            const selectedModel = txt2imgModels.find(m => m.id === selectedModelId);
            if (selectedModel) {
                finalModelId = selectedModel.id;
                finalModelName = selectedModel.name;
            }
        }
    }
    
    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating Character...';
    
    try {
        const response = await fetch('/api/dashboard/create-character-from-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                imageUrl: currentCharacterImageData.imageUrl,
                imagePrompt: currentCharacterImageData.prompt,
                personalityInput: personalityInput,
                name: name || undefined,
                language: language,
                nsfw: nsfw,
                useImageAsBaseFace: useImageAsBaseFace,
                // Include model information for consistent image generation in chat
                modelId: finalModelId,
                modelName: finalModelName,
                imageModel: currentCharacterImageData.imageModel,
                imageVersion: currentCharacterImageData.imageVersion,
                imageStyle: currentCharacterImageData.imageStyle
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Character created successfully!', 'success');
            
            // Store the chat URL for the start chat button
            const chatUrl = `/chat/${data.chatId}`;
            
            // Transform the button to "Start Chat" button
            btn.disabled = false;
            btn.classList.remove('btn-success');
            btn.classList.add('btn-primary');
            btn.innerHTML = '<i class="bi bi-chat-heart me-1"></i>Start Chat';
            btn.onclick = function() {
                window.location.href = chatUrl;
            };
            
            // Also update the cancel button to "Close"
            const cancelBtn = btn.previousElementSibling;
            if (cancelBtn) {
                cancelBtn.textContent = 'Close';
            }
        } else {
            throw new Error(data.error || 'Failed to create character');
        }
    } catch (error) {
        console.error('[ImageDashboard] Error creating character:', error);
        showNotification('Failed to create character: ' + error.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-person-plus me-1"></i>Create Character';
    }
}

/**
 * Open the add to gallery modal
 */
function openAddToGalleryModal() {
    const previewModal = document.getElementById('imagePreviewModal');
    const imageUrl = previewModal.dataset.imageUrl;
    const prompt = previewModal.dataset.prompt;
    
    if (!imageUrl) {
        showNotification('No image selected', 'error');
        return;
    }
    
    // Store current image data
    currentCharacterImageData = {
        imageUrl: imageUrl,
        prompt: prompt || document.getElementById('promptInput')?.value || ''
    };
    
    // Update modal content
    document.getElementById('galleryPreviewImage').src = imageUrl;
    document.getElementById('characterSearchInput').value = '';
    document.getElementById('characterSearchResults').innerHTML = `
        <div class="text-center text-muted py-4">
            <i class="bi bi-person-circle display-4"></i>
            <p class="mt-2">Search for a character to add this image to their gallery</p>
        </div>
    `;
    document.getElementById('confirmAddToGalleryBtn').disabled = true;
    selectedCharacterForGallery = null;
    
    // Close preview modal and open gallery modal
    bootstrap.Modal.getInstance(previewModal)?.hide();
    
    if (!addToGalleryModal) {
        addToGalleryModal = new bootstrap.Modal(document.getElementById('addToGalleryModal'));
    }
    addToGalleryModal.show();
}

/**
 * Search for characters to add image to gallery
 */
async function searchCharactersForGallery() {
    const query = document.getElementById('characterSearchInput').value.trim();
    const resultsContainer = document.getElementById('characterSearchResults');
    
    resultsContainer.innerHTML = `
        <div class="text-center py-4">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-2 text-muted">Searching characters...</p>
        </div>
    `;
    
    try {
        const response = await fetch(`/api/dashboard/search-characters?query=${encodeURIComponent(query)}&limit=20`);
        const data = await response.json();
        
        if (data.success && data.characters && data.characters.length > 0) {
            resultsContainer.innerHTML = '';
            
            data.characters.forEach(character => {
                const thumbnail = character.thumbnail || '/img/default-thumbnail.png';
                const cardHtml = `
                    <div class="character-result-card d-flex align-items-center gap-3 p-2 mb-2 rounded cursor-pointer" 
                         data-chat-id="${character._id}"
                         data-chat-name="${escapeModelHtml(character.name)}"
                         style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);"
                         onclick="selectCharacterForGallery(this)">
                        <img src="${thumbnail}" alt="${escapeModelHtml(character.name)}" 
                             class="rounded" style="width: 50px; height: 50px; object-fit: cover;"
                             onerror="this.src='/img/default-thumbnail.png'">
                        <div class="flex-grow-1">
                            <div class="fw-bold text-white">${escapeModelHtml(character.name)}</div>
                            <small class="text-muted text-truncate d-block" style="max-width: 250px;">${escapeModelHtml(character.short_intro || '')}</small>
                            ${character.tags?.slice(0, 3).map(tag => `<span class="badge bg-secondary me-1" style="font-size: 0.6rem;">${escapeModelHtml(tag)}</span>`).join('') || ''}
                        </div>
                        <i class="bi bi-chevron-right text-muted"></i>
                    </div>
                `;
                resultsContainer.insertAdjacentHTML('beforeend', cardHtml);
            });
        } else {
            resultsContainer.innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="bi bi-emoji-frown display-4"></i>
                    <p class="mt-2">No characters found</p>
                    <small>Try a different search term</small>
                </div>
            `;
        }
    } catch (error) {
        console.error('[ImageDashboard] Error searching characters:', error);
        resultsContainer.innerHTML = `
            <div class="text-center text-danger py-4">
                <i class="bi bi-exclamation-triangle display-4"></i>
                <p class="mt-2">Failed to search characters</p>
            </div>
        `;
    }
}

/**
 * Select a character for gallery addition
 */
function selectCharacterForGallery(element) {
    // Remove selection from all cards
    document.querySelectorAll('.character-result-card').forEach(card => {
        card.style.border = '1px solid rgba(255,255,255,0.1)';
        card.style.background = 'rgba(255,255,255,0.05)';
    });
    
    // Select this card
    element.style.border = '2px solid #0d6efd';
    element.style.background = 'rgba(13,110,253,0.1)';
    
    selectedCharacterForGallery = {
        chatId: element.dataset.chatId,
        name: element.dataset.chatName
    };
    
    // Enable confirm button
    document.getElementById('confirmAddToGalleryBtn').disabled = false;
}

/**
 * Confirm adding image to character gallery
 */
async function confirmAddToGallery() {
    if (!selectedCharacterForGallery || !currentCharacterImageData) {
        showNotification('Please select a character', 'error');
        return;
    }
    
    const btn = document.getElementById('confirmAddToGalleryBtn');
    
    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Adding...';
    
    try {
        const response = await fetch('/api/dashboard/add-image-to-gallery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: selectedCharacterForGallery.chatId,
                imageUrl: currentCharacterImageData.imageUrl,
                prompt: currentCharacterImageData.prompt,
                nsfw: false
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Image added to ${selectedCharacterForGallery.name}'s gallery!`, 'success');
            
            // Close modal
            addToGalleryModal?.hide();
        } else {
            throw new Error(data.error || 'Failed to add image');
        }
    } catch (error) {
        console.error('[ImageDashboard] Error adding to gallery:', error);
        showNotification('Failed to add image: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-plus-lg me-1"></i>Add to Gallery';
    }
}

// Add enter key handler for character search
document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('characterSearchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.which === 13) {
                e.preventDefault();
                searchCharactersForGallery();
            }
        });
    }
});
