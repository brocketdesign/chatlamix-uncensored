/**
 * Video Dashboard - Frontend JavaScript
 * Handles video generation, timing, and statistics
 */

// Global state
const state = {
    activeTask: null,
    timer: null,
    pollInterval: null,
    generationStartTime: null,
    isGenerating: false,
    baseImageDataUrl: null,
    totalTimerInterval: null,
    // Pricing state
    videoCostPerUnit: window.PRICING?.videoCostPerUnit || 100,
    userPoints: window.PRICING?.userPoints || 0,
    // Video mode state
    videoMode: 'i2v', // i2v, t2v, face
    videoDataUrl: null, // Base64 encoded video for merge face
    faceImageDataUrl: null, // Face image for merge face
    lastImageDataUrl: null // Last/end frame image for Segmind Wan model
};

/**
 * Update the cost display based on user's points
 */
function updateCostDisplay() {
    const totalCost = state.videoCostPerUnit;
    const hasEnoughPoints = state.userPoints >= totalCost;
    
    const userPointsDisplay = document.getElementById('userPointsDisplay');
    const costSection = document.getElementById('costDisplaySection');
    const totalCostDisplay = document.getElementById('totalCostDisplay');
    const costStatusBadge = document.getElementById('costStatusBadge');
    
    // Update total cost display
    if (totalCostDisplay) {
        totalCostDisplay.textContent = totalCost;
    }
    
    // Update user points display
    if (userPointsDisplay) {
        userPointsDisplay.textContent = state.userPoints;
        if (hasEnoughPoints) {
            userPointsDisplay.style.color = '#4ade80'; // Green
        } else {
            userPointsDisplay.style.color = '#f87171'; // Red
        }
    }
    
    // Update status badge
    if (costStatusBadge) {
        if (hasEnoughPoints) {
            costStatusBadge.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Ready';
            costStatusBadge.style.background = 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)';
            costStatusBadge.style.color = '#000';
        } else {
            costStatusBadge.innerHTML = '<i class="bi bi-exclamation-triangle-fill me-1"></i>Need more points';
            costStatusBadge.style.background = 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)';
            costStatusBadge.style.color = '#fff';
        }
    }
    
    // Update cost section border based on affordability
    if (costSection) {
        if (!hasEnoughPoints) {
            costSection.style.border = '1px solid rgba(248, 113, 113, 0.5)';
            costSection.style.boxShadow = '0 0 20px rgba(248, 113, 113, 0.1)';
        } else {
            costSection.style.border = '1px solid rgba(74, 222, 128, 0.3)';
            costSection.style.boxShadow = '0 0 20px rgba(74, 222, 128, 0.1)';
        }
    }
    
    return { totalCost, hasEnoughPoints };
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('[VideoDashboard] Dashboard initialized');
    
    // Initialize file upload
    initializeImageUpload();
    
    // Initialize video mode handlers
    initializeVideoModeHandlers();
    
    // Initialize video merge face upload handlers
    initializeVideoMergeFaceHandlers();
    
    // Initialize rating stars
    initializeRatingStars();
    
    // Initialize video preview modal - stop video on close
    initializeVideoPreviewModal();
    
    // Load initial stats
    refreshStats();
    
    // Load history
    loadHistory();
    
    // Initialize cost display
    updateCostDisplay();
    
    // Initialize model selection handlers for model-specific options
    initializeModelSelectionHandlers();
    
    // Initialize Segmind Wan options
    initializeSegmindWanOptions();
});

/**
 * Initialize video mode radio button handlers
 */
function initializeVideoModeHandlers() {
    document.querySelectorAll('input[name="videoMode"]').forEach(radio => {
        radio.addEventListener('change', handleVideoModeChange);
    });
}

/**
 * Handle video mode change
 */
function handleVideoModeChange(event) {
    const mode = event.target.value;
    state.videoMode = mode;
    
    // Show/hide sections based on mode
    const baseImageSection = document.getElementById('baseImageSection');
    const videoMergeFaceSection = document.getElementById('videoMergeFaceSection');
    const i2vModels = document.getElementById('i2vModelsSection');
    const t2vModels = document.getElementById('t2vModelsSection');
    const faceModels = document.getElementById('faceModelsSection');
    
    // Hide all sections first
    if (baseImageSection) baseImageSection.style.display = 'none';
    if (videoMergeFaceSection) videoMergeFaceSection.style.display = 'none';
    if (i2vModels) i2vModels.style.display = 'none';
    if (t2vModels) t2vModels.style.display = 'none';
    if (faceModels) faceModels.style.display = 'none';
    
    // Show relevant sections based on mode
    switch (mode) {
        case 'i2v':
            if (baseImageSection) baseImageSection.style.display = 'block';
            if (i2vModels) i2vModels.style.display = 'block';
            // Auto-select first I2V model
            const firstI2vRadio = document.querySelector('.i2v-model-radio');
            if (firstI2vRadio) firstI2vRadio.checked = true;
            break;
        case 't2v':
            if (t2vModels) t2vModels.style.display = 'block';
            // Auto-select first T2V model
            const firstT2vRadio = document.querySelector('.t2v-model-radio');
            if (firstT2vRadio) firstT2vRadio.checked = true;
            break;
        case 'face':
            if (videoMergeFaceSection) videoMergeFaceSection.style.display = 'block';
            if (faceModels) faceModels.style.display = 'block';
            // Auto-select first face model
            const firstFaceRadio = document.querySelector('.face-model-radio');
            if (firstFaceRadio) firstFaceRadio.checked = true;
            break;
    }
}

/**
 * Initialize video merge face upload handlers
 */
function initializeVideoMergeFaceHandlers() {
    // Video upload for merge face
    const videoInput = document.getElementById('baseVideoInput');
    const videoArea = document.getElementById('videoUploadArea');
    
    if (videoInput) {
        videoInput.addEventListener('change', handleVideoUpload);
    }
    
    if (videoArea) {
        videoArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            videoArea.classList.add('drag-over');
        });
        videoArea.addEventListener('dragleave', () => {
            videoArea.classList.remove('drag-over');
        });
        videoArea.addEventListener('drop', (e) => {
            e.preventDefault();
            videoArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                videoInput.files = files;
                handleVideoUpload();
            }
        });
    }
    
    // Face image upload for merge face
    const faceInput = document.getElementById('faceImageInput');
    const faceArea = document.getElementById('faceImageUploadArea');
    
    if (faceInput) {
        faceInput.addEventListener('change', handleFaceImageUpload);
    }
    
    if (faceArea) {
        faceArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            faceArea.classList.add('drag-over');
        });
        faceArea.addEventListener('dragleave', () => {
            faceArea.classList.remove('drag-over');
        });
        faceArea.addEventListener('drop', (e) => {
            e.preventDefault();
            faceArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                faceInput.files = files;
                handleFaceImageUpload();
            }
        });
    }
}

/**
 * Handle video upload for merge face
 */
function handleVideoUpload() {
    const fileInput = document.getElementById('baseVideoInput');
    const file = fileInput.files[0];
    
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('video/')) {
        showNotification('Please upload a valid video file', 'error');
        return;
    }
    
    // Validate file size (max 100MB)
    if (file.size > 100 * 1024 * 1024) {
        showNotification('Video size must be less than 100MB', 'error');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        state.videoDataUrl = e.target.result;
        
        // Show preview
        document.querySelector('#videoUploadArea .upload-placeholder')?.classList.add('d-none');
        document.getElementById('videoPreview')?.classList.remove('d-none');
        document.getElementById('previewVideoSource').src = state.videoDataUrl;
        document.getElementById('previewVideo')?.load();
        
        showNotification('Video uploaded successfully', 'success');
    };
    reader.readAsDataURL(file);
}

/**
 * Handle face image upload for merge face
 */
function handleFaceImageUpload() {
    const fileInput = document.getElementById('faceImageInput');
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
        state.faceImageDataUrl = e.target.result;
        
        // Show preview
        document.querySelector('#faceImageUploadArea .upload-placeholder')?.classList.add('d-none');
        document.getElementById('faceImagePreview')?.classList.remove('d-none');
        document.getElementById('facePreviewImg').src = state.faceImageDataUrl;
        
        showNotification('Face image uploaded successfully', 'success');
    };
    reader.readAsDataURL(file);
}

/**
 * Clear video upload
 */
function clearVideoUpload() {
    state.videoDataUrl = null;
    document.getElementById('baseVideoInput').value = '';
    document.querySelector('#videoUploadArea .upload-placeholder')?.classList.remove('d-none');
    document.getElementById('videoPreview')?.classList.add('d-none');
}

/**
 * Clear face image upload (for video merge face)
 */
function clearFaceImageUpload() {
    state.faceImageDataUrl = null;
    document.getElementById('faceImageInput').value = '';
    document.querySelector('#faceImageUploadArea .upload-placeholder')?.classList.remove('d-none');
    document.getElementById('faceImagePreview')?.classList.add('d-none');
}

/**
 * Initialize model selection handlers to show/hide model-specific options
 */
function initializeModelSelectionHandlers() {
    document.querySelectorAll('input[name="videoModel"]').forEach(radio => {
        radio.addEventListener('change', handleModelSelectionChange);
    });
    // Trigger initial check
    const selectedModel = document.querySelector('input[name="videoModel"]:checked');
    if (selectedModel) {
        handleModelSelectionChange({ target: selectedModel });
    }
}

/**
 * Handle model selection change to show/hide model-specific options
 */
function handleModelSelectionChange(event) {
    const modelId = event.target.value;
    const segmindWanOptions = document.getElementById('segmindWanOptions');
    
    if (segmindWanOptions) {
        if (modelId === 'wan-2.2-i2v-fast') {
            segmindWanOptions.style.display = 'block';
        } else {
            segmindWanOptions.style.display = 'none';
        }
    }
}

/**
 * Initialize Segmind Wan model specific options
 */
function initializeSegmindWanOptions() {
    // Number of frames range slider
    const numFramesRange = document.getElementById('numFramesRange');
    const numFramesValue = document.getElementById('numFramesValue');
    if (numFramesRange && numFramesValue) {
        numFramesRange.addEventListener('input', function() {
            numFramesValue.textContent = this.value;
        });
    }
    
    // FPS range slider
    const fpsRange = document.getElementById('fpsRange');
    const fpsValue = document.getElementById('fpsValue');
    if (fpsRange && fpsValue) {
        fpsRange.addEventListener('input', function() {
            fpsValue.textContent = this.value;
        });
    }
    
    // Last image upload handler
    const lastImageInput = document.getElementById('lastImageInput');
    const lastImageUploadArea = document.getElementById('lastImageUploadArea');
    
    if (lastImageInput) {
        lastImageInput.addEventListener('change', handleLastImageUpload);
    }
    
    if (lastImageUploadArea) {
        lastImageUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            lastImageUploadArea.classList.add('drag-over');
        });
        lastImageUploadArea.addEventListener('dragleave', () => {
            lastImageUploadArea.classList.remove('drag-over');
        });
        lastImageUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            lastImageUploadArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                lastImageInput.files = files;
                handleLastImageUpload();
            }
        });
    }
}

/**
 * Handle last image upload for Segmind Wan model
 */
function handleLastImageUpload() {
    const fileInput = document.getElementById('lastImageInput');
    const file = fileInput.files[0];
    
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        showNotification('Please upload a valid image file', 'error');
        return;
    }
    
    if (file.size > 10 * 1024 * 1024) {
        showNotification('Image size must be less than 10MB', 'error');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        state.lastImageDataUrl = e.target.result;
        
        document.querySelector('#lastImageUploadArea .upload-placeholder')?.classList.add('d-none');
        document.getElementById('lastImagePreview')?.classList.remove('d-none');
        document.getElementById('lastPreviewImg').src = state.lastImageDataUrl;
        
        showNotification('End frame image uploaded successfully', 'success');
    };
    reader.readAsDataURL(file);
}

/**
 * Clear last image upload
 */
function clearLastImageUpload() {
    state.lastImageDataUrl = null;
    document.getElementById('lastImageInput').value = '';
    document.querySelector('#lastImageUploadArea .upload-placeholder')?.classList.remove('d-none');
    document.getElementById('lastImagePreview')?.classList.add('d-none');
}

/**
 * Initialize image upload functionality
 */
function initializeImageUpload() {
    const fileInput = document.getElementById('baseImageInput');
    const uploadArea = document.getElementById('imageUploadArea');
    
    fileInput.addEventListener('change', handleImageUpload);
    
    // Drag and drop support
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            fileInput.files = files;
            handleImageUpload();
        }
    });
}

/**
 * Handle image upload and preview
 */
function handleImageUpload() {
    const fileInput = document.getElementById('baseImageInput');
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
        state.baseImageDataUrl = e.target.result;
        
        // Show preview
        document.querySelector('.upload-placeholder').classList.add('d-none');
        document.getElementById('imagePreview').classList.remove('d-none');
        document.getElementById('previewImg').src = state.baseImageDataUrl;
        
        showNotification('Image uploaded successfully', 'success');
    };
    reader.readAsDataURL(file);
}

/**
 * Clear image upload
 */
function clearImageUpload() {
    state.baseImageDataUrl = null;
    document.getElementById('baseImageInput').value = '';
    document.querySelector('.upload-placeholder').classList.remove('d-none');
    document.getElementById('imagePreview').classList.add('d-none');
}

/**
 * Start video generation
 */
async function startGeneration() {
    const mode = state.videoMode;
    
    console.log('[VideoDashboard] 🚀 startGeneration() called');
    console.log('[VideoDashboard] Current mode:', mode);
    
    // Validate inputs based on mode
    if (mode === 'i2v') {
        console.log('[VideoDashboard] I2V mode - checking base image...');
        console.log('[VideoDashboard] baseImageDataUrl exists:', !!state.baseImageDataUrl);
        console.log('[VideoDashboard] baseImageDataUrl length:', state.baseImageDataUrl?.length || 0);
        if (!state.baseImageDataUrl) {
            showNotification('Please upload a base image first', 'warning');
            return;
        }
    } else if (mode === 't2v') {
        const prompt = document.getElementById('promptInput').value.trim();
        console.log('[VideoDashboard] T2V mode - checking prompt...');
        console.log('[VideoDashboard] Prompt:', prompt);
        if (!prompt) {
            showNotification('Please enter a prompt for text-to-video generation', 'warning');
            return;
        }
    } else if (mode === 'face') {
        console.log('[VideoDashboard] Face mode - checking video and face image...');
        console.log('[VideoDashboard] videoDataUrl exists:', !!state.videoDataUrl);
        console.log('[VideoDashboard] faceImageDataUrl exists:', !!state.faceImageDataUrl);
        if (!state.videoDataUrl) {
            showNotification('Please upload a source video', 'warning');
            return;
        }
        if (!state.faceImageDataUrl) {
            showNotification('Please upload a face image', 'warning');
            return;
        }
    }
    
    const selectedModel = document.querySelector('input[name="videoModel"]:checked');
    console.log('[VideoDashboard] Selected model element:', selectedModel);
    if (!selectedModel) {
        showNotification('Please select a video model', 'warning');
        return;
    }
    
    // Check if user has enough points before proceeding
    const { totalCost, hasEnoughPoints } = updateCostDisplay();
    console.log('[VideoDashboard] Points check - total cost:', totalCost, 'user points:', state.userPoints, 'has enough:', hasEnoughPoints);
    if (!hasEnoughPoints) {
        showNotification(`Insufficient points. You need ${totalCost} points but only have ${state.userPoints} points.`, 'error');
        return;
    }
    
    const modelId = selectedModel.value;
    const modelName = selectedModel.dataset.modelName;
    const prompt = document.getElementById('promptInput').value.trim();
    const duration = document.getElementById('durationSelect').value;
    const aspectRatio = document.getElementById('aspectRatioSelect').value;
    
    console.log('[VideoDashboard] ========== GENERATION REQUEST ==========');
    console.log('[VideoDashboard] Model ID:', modelId);
    console.log('[VideoDashboard] Model Name:', modelName);
    console.log('[VideoDashboard] Prompt:', prompt);
    console.log('[VideoDashboard] Duration:', duration);
    console.log('[VideoDashboard] Aspect Ratio:', aspectRatio);
    console.log('[VideoDashboard] Mode:', mode);
    console.log('[VideoDashboard] Has Base Image:', !!state.baseImageDataUrl);
    console.log('[VideoDashboard] Has Video:', !!state.videoDataUrl);
    console.log('[VideoDashboard] Has Face Image:', !!state.faceImageDataUrl);
    console.log('[VideoDashboard] =========================================');
    
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
            modelId,
            prompt,
            basePrompt: prompt,
            duration,
            aspectRatio,
            videoMode: mode
        };
        
        // Add mode-specific data
        if (mode === 'i2v') {
            requestBody.baseImageUrl = state.baseImageDataUrl;
            console.log('[VideoDashboard] Added baseImageUrl to request (length:', state.baseImageDataUrl?.length, ')');
        } else if (mode === 'face') {
            requestBody.videoFile = state.videoDataUrl;
            requestBody.faceImageFile = state.faceImageDataUrl;
            console.log('[VideoDashboard] Added videoFile and faceImageFile to request');
        }
        // T2V just needs the prompt which is already included
        
        // Add Segmind Wan 2.2 I2V Fast specific parameters
        if (modelId === 'wan-2.2-i2v-fast') {
            const goFastToggle = document.getElementById('goFastToggle');
            const numFramesRange = document.getElementById('numFramesRange');
            const segmindResolutionSelect = document.getElementById('segmindResolutionSelect');
            const fpsRange = document.getElementById('fpsRange');
            const negativePromptInput = document.getElementById('negativePromptInput');
            
            requestBody.go_fast = goFastToggle ? goFastToggle.checked : true;
            requestBody.num_frames = numFramesRange ? parseInt(numFramesRange.value, 10) : 81;
            requestBody.resolution = segmindResolutionSelect ? segmindResolutionSelect.value : '480p';
            requestBody.frames_per_second = fpsRange ? parseInt(fpsRange.value, 10) : 16;
            
            if (negativePromptInput && negativePromptInput.value.trim()) {
                requestBody.negative_prompt = negativePromptInput.value.trim();
            }
            
            // Add last image if uploaded
            if (state.lastImageDataUrl) {
                requestBody.last_image = state.lastImageDataUrl;
                console.log('[VideoDashboard] Added last_image to request (length:', state.lastImageDataUrl?.length, ')');
            }
            
            console.log('[VideoDashboard] Added Segmind Wan options:', {
                go_fast: requestBody.go_fast,
                num_frames: requestBody.num_frames,
                resolution: requestBody.resolution,
                frames_per_second: requestBody.frames_per_second,
                has_negative_prompt: !!requestBody.negative_prompt,
                has_last_image: !!requestBody.last_image
            });
        }
        
        console.log('[VideoDashboard] 📤 Sending request to /dashboard/video/generate');
        console.log('[VideoDashboard] Request body keys:', Object.keys(requestBody));
        console.log('[VideoDashboard] Request body (without image data):', {
            ...requestBody,
            baseImageUrl: requestBody.baseImageUrl ? `[BASE64 DATA - ${requestBody.baseImageUrl.length} chars]` : undefined,
            videoFile: requestBody.videoFile ? `[BASE64 DATA - ${requestBody.videoFile.length} chars]` : undefined,
            faceImageFile: requestBody.faceImageFile ? `[BASE64 DATA - ${requestBody.faceImageFile.length} chars]` : undefined
        });
        
        const response = await fetch('/dashboard/video/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('[VideoDashboard] 📥 Response received');
        console.log('[VideoDashboard] Response status:', response.status);
        console.log('[VideoDashboard] Response ok:', response.ok);
        
        const data = await response.json();
        console.log('[VideoDashboard] Response data:', JSON.stringify(data, null, 2));
        
        if (!response.ok) {
            // Handle insufficient points error
            if (response.status === 402) {
                console.log('[VideoDashboard] ❌ Insufficient points error');
                showNotification(data.message || `Insufficient points. Need ${data.required} but have ${data.available}.`, 'error');
                state.userPoints = data.available || 0;
                updateCostDisplay();
                state.isGenerating = false;
                updateGenerateButton(false);
                stopTotalTimer();
                return;
            }
            console.log('[VideoDashboard] ❌ Request failed with error:', data.error);
            throw new Error(data.error || 'Generation failed');
        }
        
        // Update user points after successful deduction
        state.userPoints -= state.videoCostPerUnit;
        updateCostDisplay();
        
        console.log('[VideoDashboard] ✅ Generation started successfully');
        console.log('[VideoDashboard] Task data:', data.task);
        
        // Create result card
        createResultCard(modelId, modelName);
        
        // Store task
        state.activeTask = data.task;
        state.activeTask.modelId = modelId;
        state.activeTask.modelName = modelName;
        
        console.log('[VideoDashboard] Task ID:', data.task?.taskId);
        console.log('[VideoDashboard] Task status:', data.task?.status);
        console.log('[VideoDashboard] Task async:', data.task?.async);
        
        // Update card
        updateResultCard(data.task);
        
        // Handle sync vs async response
        if (data.task.status === 'completed' && data.task.videoUrl) {
            // Synchronous completion (e.g., Segmind)
            console.log('[VideoDashboard] ✅ Synchronous completion - video ready');
            stopTotalTimer();
            state.isGenerating = false;
            updateGenerateButton(false);
            
            // Convert videoUrl to videos array format for consistency
            data.task.videos = [{ videoUrl: data.task.videoUrl }];
            
            // Update card to show completed video
            const statusEl = document.getElementById(`status-${modelId}`);
            if (statusEl) {
                statusEl.className = 'status badge bg-success';
                statusEl.innerHTML = '<i class="bi bi-check-circle me-1"></i>Complete';
            }
            const progressEl = document.getElementById(`progress-${modelId}`);
            if (progressEl) {
                progressEl.style.width = '100%';
                progressEl.className = 'progress-bar bg-success';
            }
            
            // Show video
            const videoContainer = document.getElementById(`video-container-${modelId}`);
            if (videoContainer) {
                videoContainer.innerHTML = `
                    <video controls class="w-100 rounded" style="max-height: 300px;" onclick="previewVideo('${data.task.videoUrl}', '${modelName}', ${data.task.generationTime || 0}, '${data.task.taskId}')">
                        <source src="${data.task.videoUrl}" type="video/mp4">
                    </video>
                    <div class="d-flex gap-2 mt-2">
                        <a href="${data.task.videoUrl}" download class="btn btn-sm btn-outline-success">
                            <i class="bi bi-download me-1"></i>Download
                        </a>
                        <button class="btn btn-sm btn-outline-info" onclick="previewVideo('${data.task.videoUrl}', '${modelName}', ${data.task.generationTime || 0}, '${data.task.taskId}')">
                            <i class="bi bi-eye me-1"></i>Preview
                        </button>
                    </div>
                `;
            }
            
            // Save result to database for history
            saveTestResult(modelId, data.task);
            
            // Reload history to show the new video
            loadHistory();
            
            showNotification('Video generated successfully!', 'success');
        } else if (data.task.status === 'processing' && data.task.async) {
            // Async processing - start polling
            console.log('[VideoDashboard] 🔄 Starting task polling for task:', data.task.taskId);
            startTaskPolling(data.task);
        } else {
            console.log('[VideoDashboard] ⚠️ Not starting polling - status:', data.task?.status, 'async:', data.task?.async);
        }
    } catch (error) {
        console.error('[VideoDashboard] ❌ Generation error:', error);
        console.error('[VideoDashboard] Error stack:', error.stack);
        showNotification(error.message, 'error');
        state.isGenerating = false;
        updateGenerateButton(false);
        stopTotalTimer();
    }
}

/**
 * Create a result card for the video generation
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
        <div class="result-video-container" id="video-container-${modelId}">
            <div class="text-center text-muted py-3">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-2 mb-0 small">Generating video...</p>
            </div>
        </div>
    `;
    
    container.appendChild(card);
    
    // Start timer
    startModelTimer(modelId);
}

/**
 * Update a result card with task status
 */
function updateResultCard(task) {
    const modelId = task.modelId;
    const statusEl = document.getElementById(`status-${modelId}`);
    const progressEl = document.getElementById(`progress-${modelId}`);
    const videoContainer = document.getElementById(`video-container-${modelId}`);
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
        
        // Display video
        if (task.videos && task.videos.length > 0) {
            displayVideo(modelId, task.videos[0], time);
        }
        
        // Save result
        saveTestResult(modelId, task);
        
        card.classList.add('completed');
        
        // Check if generation is complete
        checkGenerationComplete();
    } else if (task.status === 'failed') {
        stopModelTimer(modelId);
        
        statusEl.className = 'status badge bg-danger';
        statusEl.innerHTML = `<i class="bi bi-x-circle me-1"></i>Failed`;
        progressEl.style.width = '100%';
        progressEl.className = 'progress-bar bg-danger';
        
        videoContainer.innerHTML = `
            <div class="text-center text-danger py-3">
                <i class="bi bi-exclamation-triangle display-4"></i>
                <p class="mt-2 mb-0">${task.error || 'Generation failed'}</p>
            </div>
        `;
        
        card.classList.add('failed');
        
        checkGenerationComplete();
    }
}

/**
 * Display generated video
 */
function displayVideo(modelId, video, time) {
    const container = document.getElementById(`video-container-${modelId}`);
    if (!container) return;
    
    container.innerHTML = '';
    
    const videoUrl = video.videoUrl || video.video_url;
    const task = state.activeTask;
    const testId = task?.testId || '';
    const escapedUrl = videoUrl.replace(/'/g, "\\'");
    
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.controls = true;
    videoElement.className = 'result-video img-fluid rounded cursor-pointer';
    videoElement.onclick = function() {
        const currentTask = state.activeTask;
        const currentTestId = currentTask?.testId || testId;
        previewVideo(escapedUrl, modelId, time, currentTestId);
    };
    
    container.appendChild(videoElement);
}

/**
 * Preview video in modal
 */
function previewVideo(videoUrl, modelId, time, testId = null) {
    const modal = new bootstrap.Modal(document.getElementById('videoPreviewModal'));
    const modalElement = document.getElementById('videoPreviewModal');
    
    const modalVideo = document.getElementById('modalPreviewVideo');
    const modalVideoSource = document.getElementById('modalPreviewVideoSource');
    
    modalVideoSource.src = videoUrl;
    modalVideo.load();
    // Auto-play the video when modal opens
    modalVideo.play().catch(e => console.log('Auto-play prevented:', e));
    
    const task = state.activeTask;
    const modelName = task?.modelName || modelId;
    document.getElementById('previewModelName').textContent = modelName;
    document.getElementById('previewTime').textContent = `Generated in ${(time / 1000).toFixed(1)} seconds`;
    
    // Store current video info for rating
    modalElement.dataset.modelId = modelId;
    modalElement.dataset.modelName = modelName;
    modalElement.dataset.videoUrl = videoUrl;
    modalElement.dataset.testId = testId || '';
    
    // Reset rating stars
    resetRatingStars();
    
    // Load existing rating if testId is provided
    if (testId) {
        loadVideoRating(testId);
    }
    
    modal.show();
}

/**
 * Preview video from history
 */
function previewHistoryVideo(videoUrl, modelName, generationTime, testId = null, prompt = '') {
    const modal = new bootstrap.Modal(document.getElementById('videoPreviewModal'));
    const modalElement = document.getElementById('videoPreviewModal');
    
    const modalVideo = document.getElementById('modalPreviewVideo');
    const modalVideoSource = document.getElementById('modalPreviewVideoSource');
    
    modalVideoSource.src = videoUrl;
    modalVideo.load();
    // Auto-play the video when modal opens
    modalVideo.play().catch(e => console.log('Auto-play prevented:', e));
    
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
    
    // Store current video info for rating and draft
    modalElement.dataset.modelId = 'history-video';
    modalElement.dataset.modelName = modelName || 'Unknown Model';
    modalElement.dataset.videoUrl = videoUrl;
    modalElement.dataset.testId = testId || '';
    modalElement.dataset.prompt = prompt || '';
    modalElement.dataset.isFromHistory = 'true';
    
    // Reset rating stars
    resetRatingStars();
    
    // Load existing rating if testId is provided
    if (testId) {
        loadVideoRating(testId);
    }
    
    modal.show();
}

/**
 * Start polling for task status
 */
function startTaskPolling(task) {
    let pollCount = 0;
    console.log('[VideoDashboard] 🔄 Starting polling for task:', task.taskId);
    console.log('[VideoDashboard] Task start time:', task.startTime);
    
    const pollInterval = setInterval(async () => {
        pollCount++;
        console.log(`[VideoDashboard] ========== POLL #${pollCount} ==========`);
        console.log(`[VideoDashboard] Task ID: ${task.taskId}`);
        console.log(`[VideoDashboard] Elapsed time: ${((Date.now() - task.startTime) / 1000).toFixed(1)}s`);
        
        try {
            console.log(`[VideoDashboard] 📤 Fetching status from /dashboard/video/status/${task.taskId}`);
            const response = await fetch(`/dashboard/video/status/${task.taskId}`);
            
            console.log(`[VideoDashboard] 📥 Response status: ${response.status}`);
            const data = await response.json();
            
            console.log(`[VideoDashboard] Poll response data:`, JSON.stringify(data, null, 2));
            console.log(`[VideoDashboard] Status: ${data.status}, Progress: ${data.progress || 0}%`);
            
            if (data.error) {
                console.log(`[VideoDashboard] ⚠️ Error in response: ${data.error}`);
            }
            
            if (data.videos && data.videos.length > 0) {
                console.log(`[VideoDashboard] 🎥 Videos found:`, data.videos);
            }
            
            // Update task
            const updatedTask = {
                ...state.activeTask,
                ...data,
                generationTime: Date.now() - task.startTime
            };
            
            state.activeTask = updatedTask;
            updateResultCard(updatedTask);
            
            // Stop polling if complete or failed
            if (data.status === 'completed' || data.status === 'failed' || data.status === 'error') {
                console.log(`[VideoDashboard] 🏁 Polling complete - Final status: ${data.status}`);
                clearInterval(pollInterval);
                state.pollInterval = null;
                
                if (data.status === 'completed') {
                    console.log(`[VideoDashboard] ✅ Task completed successfully`);
                    handleTaskCompletion(updatedTask);
                } else {
                    console.log(`[VideoDashboard] ❌ Task failed: ${data.error || 'Unknown error'}`);
                    handleTaskFailure(updatedTask);
                }
            }
            console.log(`[VideoDashboard] ========== END POLL #${pollCount} ==========`);
        } catch (error) {
            console.error(`[VideoDashboard] ❌ Polling error at poll #${pollCount}:`, error);
            console.error(`[VideoDashboard] Error message:`, error.message);
            console.error(`[VideoDashboard] Error stack:`, error.stack);
        }
    }, 3000); // Poll every 3 seconds (videos take longer than images)
    
    state.pollInterval = pollInterval;
    console.log('[VideoDashboard] Polling interval started (3s intervals)');
}

/**
 * Handle task completion
 */
function handleTaskCompletion(task) {
    console.log(`[VideoDashboard] Task completed: ${task.modelId} in ${task.generationTime}ms`);
    showNotification(`${task.modelName} completed in ${(task.generationTime / 1000).toFixed(1)}s`, 'success');
}

/**
 * Handle task failure
 */
function handleTaskFailure(task) {
    console.error(`[VideoDashboard] Task failed: ${task.modelId}`, task.error);
    showNotification(`${task.modelName} failed: ${task.error}`, 'error');
}

/**
 * Save test result to database
 */
async function saveTestResult(modelId, task) {
    try {
        const response = await fetch('/dashboard/video/save-result', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                modelId,
                modelName: task.modelName,
                prompt: task.finalPrompt || task.originalPrompt,
                params: {
                    duration: task.duration,
                    aspectRatio: task.aspectRatio
                },
                generationTime: task.generationTime,
                status: task.status,
                videos: task.videos,
                error: task.error
            })
        });
        
        const data = await response.json();
        console.log(`[VideoDashboard] Result saved for ${modelId}`, data);
        
        if (data.testId) {
            task.testId = data.testId;
            state.activeTask.testId = data.testId;
        }
        
        return data;
    } catch (error) {
        console.error(`[VideoDashboard] Error saving result:`, error);
    }
}

/**
 * Check if generation is complete
 */
function checkGenerationComplete() {
    if (state.isGenerating && state.activeTask && 
        (state.activeTask.status === 'completed' || state.activeTask.status === 'failed')) {
        state.isGenerating = false;
        stopTotalTimer();
        updateGenerateButton(false);
        
        const totalTime = Date.now() - state.generationStartTime;
        document.getElementById('totalTimeDisplay').textContent = `Total: ${(totalTime / 1000).toFixed(1)}s`;
        
        showNotification('Video generation complete!', 'success');
        refreshStats();
        loadHistory();
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
    
    state.timer = interval;
}

/**
 * Stop model-specific timer
 */
function stopModelTimer(modelId) {
    if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
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
    if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
    }
    
    if (state.pollInterval) {
        clearInterval(state.pollInterval);
        state.pollInterval = null;
    }
    
    state.activeTask = null;
    
    const container = document.getElementById('resultsContainer');
    container.innerHTML = `
        <div class="text-center text-muted py-5" id="noResultsPlaceholder">
            <i class="bi bi-film display-1"></i>
            <p class="mt-3">Upload an image and click "Generate Video" to begin</p>
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
            <i class="bi bi-play-fill me-2"></i>Generate Video
        `;
    }
}

/**
 * Refresh statistics
 */
async function refreshStats() {
    try {
        const response = await fetch('/dashboard/video/stats');
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
        
        console.log('[VideoDashboard] Stats refreshed');
    } catch (error) {
        console.error('[VideoDashboard] Error refreshing stats:', error);
    }
}

/**
 * Load test history
 */
async function loadHistory() {
    try {
        const response = await fetch('/dashboard/video/history?limit=50');
        const data = await response.json();
        
        const tbody = document.getElementById('historyTableBody');
        tbody.innerHTML = '';
        
        if (data.history && data.history.length > 0) {
            data.history.forEach(test => {
                const row = document.createElement('tr');
                
                // Get first video if available
                let videoCell = '<span class="text-muted">--</span>';
                let videoUrl = null;
                if (test.videos && test.videos.length > 0) {
                    videoUrl = test.videos[0].videoUrl || test.videos[0].video_url;
                    if (videoUrl) {
                        videoCell = `
                            <video class="history-video" muted preload="metadata">
                                <source src="${videoUrl}" type="video/mp4">
                            </video>
                        `;
                    }
                }
                
                const escapedUrl = videoUrl ? videoUrl.replace(/'/g, "\\'") : '';
                const escapedModelName = (test.modelName || '').replace(/'/g, "\\'");
                const escapedPrompt = (test.prompt || '').replace(/'/g, "\\'");
                const testId = test._id || '';
                const hasVideo = videoUrl && test.status === 'completed';
                
                row.innerHTML = `
                    <td>${videoCell}</td>
                    <td>${test.modelName || '--'}</td>
                    <td>
                        <span class="text-truncate" style="max-width: 200px; display: inline-block;" title="${test.prompt || ''}">${test.prompt || '--'}</span>
                    </td>
                    <td>${test.params?.duration || '--'}s</td>
                    <td>${test.generationTime ? (test.generationTime / 1000).toFixed(1) + 's' : '--'}</td>
                    <td>
                        ${test.status === 'completed' 
                            ? '<span class="badge bg-success">Completed</span>' 
                            : test.status === 'failed' 
                                ? '<span class="badge bg-danger">Failed</span>'
                                : `<span class="badge bg-warning">${test.status}</span>`}
                    </td>
                    <td>${new Date(test.testedAt).toLocaleString()}</td>
                `;
                
                // Make entire row clickable if video is available
                if (hasVideo) {
                    row.style.cursor = 'pointer';
                    row.classList.add('history-row-clickable');
                    row.addEventListener('click', function(e) {
                        // Prevent click if user is selecting text
                        if (window.getSelection().toString()) return;
                        previewHistoryVideo(escapedUrl, escapedModelName, test.generationTime || 0, testId, escapedPrompt);
                    });
                }
                
                tbody.appendChild(row);
            });
        } else {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center text-muted">No test history available</td>
                </tr>
            `;
        }
        
        console.log('[VideoDashboard] History loaded');
    } catch (error) {
        console.error('[VideoDashboard] Error loading history:', error);
    }
}

/**
 * Initialize video preview modal - stop video when modal closes
 */
function initializeVideoPreviewModal() {
    const modalElement = document.getElementById('videoPreviewModal');
    if (modalElement) {
        modalElement.addEventListener('hidden.bs.modal', function() {
            const video = document.getElementById('modalPreviewVideo');
            if (video) {
                video.pause();
                video.currentTime = 0;
            }
        });
        
        // Also handle when modal is shown to ensure video plays
        modalElement.addEventListener('shown.bs.modal', function() {
            const video = document.getElementById('modalPreviewVideo');
            if (video && video.src) {
                video.play().catch(e => console.log('Auto-play prevented:', e));
            }
        });
    }
}

/**
 * Rating stars functionality
 */
function initializeRatingStars() {
    const stars = document.querySelectorAll('.rating-star');
    stars.forEach(star => {
        star.addEventListener('click', function() {
            const rating = parseInt(this.dataset.rating);
            setRating(rating);
            saveVideoRating(rating);
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

function setRating(rating) {
    const ratingContainer = document.getElementById('ratingStars');
    ratingContainer.dataset.currentRating = rating;
    highlightStars(rating);
    document.getElementById('ratingStatus').textContent = `Rated ${rating} out of 5 stars`;
}

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

function resetRatingStars() {
    const stars = document.querySelectorAll('.rating-star');
    stars.forEach(star => {
        star.classList.remove('bi-star-fill', 'active', 'filled');
        star.classList.add('bi-star');
    });
    document.getElementById('ratingStatus').textContent = 'Click a star to rate';
}

async function saveVideoRating(rating) {
    const modal = document.getElementById('videoPreviewModal');
    const modelId = modal.dataset.modelId;
    const modelName = modal.dataset.modelName;
    const videoUrl = modal.dataset.videoUrl;
    const testId = modal.dataset.testId;
    
    if (!modelId || !videoUrl) {
        console.error('[VideoDashboard] Missing modelId or videoUrl for rating');
        return;
    }
    
    try {
        const response = await fetch('/dashboard/video/rate-video', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                modelId,
                modelName,
                videoUrl,
                rating,
                testId: testId || null
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Rating saved: ${rating} stars`, 'success');
            refreshStats();
        } else {
            showNotification(data.error || 'Failed to save rating', 'error');
        }
    } catch (error) {
        console.error('[VideoDashboard] Error saving rating:', error);
        showNotification('Failed to save rating', 'error');
    }
}

async function loadVideoRating(testId) {
    if (!testId) return;
    
    try {
        const response = await fetch(`/dashboard/video/rating/${testId}`);
        const data = await response.json();
        
        if (data.success && data.rating) {
            setRating(data.rating);
        }
    } catch (error) {
        console.error('[VideoDashboard] Error loading rating:', error);
    }
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
    // Check if there's a global showNotification that's different from this function
    if (typeof window.showNotification === 'function' && window.showNotification !== showNotification) {
        window.showNotification(message, type);
    } else {
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
}

// Draft post state
let currentDraftData = null;
let saveDraftModal = null;

/**
 * Save current video as draft post
 */
function saveAsDraftPost() {
    const modal = document.getElementById('videoPreviewModal');
    const videoUrl = modal.dataset.videoUrl;
    const modelId = modal.dataset.modelId;
    const modelName = modal.dataset.modelName;
    const testId = modal.dataset.testId;
    const isFromHistory = modal.dataset.isFromHistory === 'true';
    
    if (!videoUrl) {
        showNotification('No video to save', 'error');
        return;
    }
    
    // Get the prompt - from modal dataset for history items, or from task for current generation
    let prompt = '';
    if (isFromHistory) {
        prompt = modal.dataset.prompt || '';
    } else if (state.activeTask) {
        prompt = state.activeTask.finalPrompt || state.activeTask.originalPrompt || document.getElementById('promptInput')?.value || '';
    } else {
        prompt = document.getElementById('promptInput')?.value || '';
    }
    
    // Store data for the draft
    currentDraftData = {
        videoUrl,
        prompt,
        model: modelName,
        testId: testId || null,
        parameters: {
            duration: document.getElementById('durationSelect')?.value,
            aspectRatio: document.getElementById('aspectRatioSelect')?.value
        }
    };
    
    // Update draft modal preview
    document.getElementById('draftPreviewVideoSource').src = videoUrl;
    document.getElementById('draftPreviewVideo').load();
    document.getElementById('draftCaptionText').value = '';
    
    // Close preview modal and open draft modal
    bootstrap.Modal.getInstance(modal)?.hide();
    
    if (!saveDraftModal) {
        saveDraftModal = new bootstrap.Modal(document.getElementById('saveDraftModal'));
    }
    saveDraftModal.show();
}

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
                mediaType: 'video',
                existingCaption: existingCaption || undefined
            })
        });
        
        const data = await response.json();
        
        if (data.success && data.caption) {
            captionInput.value = data.caption;
            showNotification('Caption generated!', 'success');
        } else {
            throw new Error(data.error || 'Failed to generate caption');
        }
    } catch (error) {
        console.error('[VideoDashboard] Error generating caption:', error);
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
                videoUrl: currentDraftData.videoUrl,
                prompt: currentDraftData.prompt,
                model: currentDraftData.model,
                testId: currentDraftData.testId,
                parameters: currentDraftData.parameters,
                generateCaption: !caption, // Generate caption if not provided
                caption: caption || undefined,
                mediaType: 'video'
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
        console.error('[VideoDashboard] Error saving draft:', error);
        showNotification('Failed to save draft: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check me-1"></i>Save Draft';
    }
}

/**
 * Open share to social modal (placeholder for social sharing)
 */
function openShareModal() {
    const modal = document.getElementById('videoPreviewModal');
    const videoUrl = modal.dataset.videoUrl;
    
    if (!videoUrl) {
        showNotification('No video to share', 'error');
        return;
    }
    
    // For now, redirect to My Posts where social sharing is available
    showNotification('Saving video first...', 'info');
    saveAsDraftPost();
}

// ==============================================
// Add Video to Character
// ==============================================

let addVideoToCharacterModal = null;
let currentVideoData = null;
let selectedCharacterForVideo = null;

/**
 * Open the add video to character modal
 */
function openAddVideoToCharacterModal() {
    const previewModal = document.getElementById('videoPreviewModal');
    const videoUrl = previewModal.dataset.videoUrl;
    const prompt = previewModal.dataset.prompt;
    
    if (!videoUrl) {
        showNotification('No video selected', 'error');
        return;
    }
    
    // Store current video data
    currentVideoData = {
        videoUrl: videoUrl,
        prompt: prompt || document.getElementById('promptInput')?.value || '',
        duration: document.getElementById('durationSelect')?.value || '5',
        aspectRatio: document.getElementById('aspectRatioSelect')?.value || '16:9',
        modelName: previewModal.dataset.modelName || state.activeTask?.modelName || 'Unknown'
    };
    
    // Update modal content
    document.getElementById('videoCharacterPreviewSource').src = videoUrl;
    document.getElementById('videoCharacterPreview').load();
    document.getElementById('videoPromptPreview').textContent = currentVideoData.prompt.length > 150 
        ? currentVideoData.prompt.substring(0, 150) + '...' 
        : currentVideoData.prompt;
    document.getElementById('videoCharacterSearchInput').value = '';
    document.getElementById('videoCharacterSearchResults').innerHTML = `
        <div class="text-center text-muted py-4">
            <i class="bi bi-person-circle display-4"></i>
            <p class="mt-2">Search for a character to add this video to</p>
        </div>
    `;
    document.getElementById('confirmAddVideoToCharacterBtn').disabled = true;
    selectedCharacterForVideo = null;
    
    // Close preview modal and open character search modal
    bootstrap.Modal.getInstance(previewModal)?.hide();
    
    if (!addVideoToCharacterModal) {
        addVideoToCharacterModal = new bootstrap.Modal(document.getElementById('addVideoToCharacterModal'));
    }
    addVideoToCharacterModal.show();
}

/**
 * Search for characters to add video to
 */
async function searchCharactersForVideo() {
    const query = document.getElementById('videoCharacterSearchInput').value.trim();
    const resultsContainer = document.getElementById('videoCharacterSearchResults');
    
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
                         data-chat-name="${escapeHtml(character.name)}"
                         style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);"
                         onclick="selectCharacterForVideo(this)">
                        <img src="${thumbnail}" alt="${escapeHtml(character.name)}" 
                             class="rounded" style="width: 50px; height: 50px; object-fit: cover;"
                             onerror="this.src='/img/default-thumbnail.png'">
                        <div class="flex-grow-1">
                            <div class="fw-bold text-white">${escapeHtml(character.name)}</div>
                            <small class="text-muted text-truncate d-block" style="max-width: 250px;">${escapeHtml(character.short_intro || '')}</small>
                            ${character.tags?.slice(0, 3).map(tag => `<span class="badge bg-secondary me-1" style="font-size: 0.6rem;">${escapeHtml(tag)}</span>`).join('') || ''}
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
        console.error('[VideoDashboard] Error searching characters:', error);
        resultsContainer.innerHTML = `
            <div class="text-center text-danger py-4">
                <i class="bi bi-exclamation-triangle display-4"></i>
                <p class="mt-2">Failed to search characters</p>
            </div>
        `;
    }
}

/**
 * Select a character for video addition
 */
function selectCharacterForVideo(element) {
    // Remove selection from all cards
    document.querySelectorAll('#videoCharacterSearchResults .character-result-card').forEach(card => {
        card.style.border = '1px solid rgba(255,255,255,0.1)';
        card.style.background = 'rgba(255,255,255,0.05)';
    });
    
    // Select this card
    element.style.border = '2px solid #0d6efd';
    element.style.background = 'rgba(13,110,253,0.1)';
    
    selectedCharacterForVideo = {
        chatId: element.dataset.chatId,
        name: element.dataset.chatName
    };
    
    // Enable confirm button
    document.getElementById('confirmAddVideoToCharacterBtn').disabled = false;
}

/**
 * Confirm adding video to character
 */
async function confirmAddVideoToCharacter() {
    if (!selectedCharacterForVideo || !currentVideoData) {
        showNotification('Please select a character', 'error');
        return;
    }
    
    const btn = document.getElementById('confirmAddVideoToCharacterBtn');
    
    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Adding...';
    
    try {
        const response = await fetch('/api/dashboard/add-video-to-character', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: selectedCharacterForVideo.chatId,
                videoUrl: currentVideoData.videoUrl,
                prompt: currentVideoData.prompt,
                duration: currentVideoData.duration,
                aspectRatio: currentVideoData.aspectRatio,
                modelName: currentVideoData.modelName
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Video added to ${selectedCharacterForVideo.name}'s gallery!`, 'success');
            
            // Close modal
            addVideoToCharacterModal?.hide();
        } else {
            throw new Error(data.error || 'Failed to add video');
        }
    } catch (error) {
        console.error('[VideoDashboard] Error adding video:', error);
        showNotification('Failed to add video: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-plus-lg me-1"></i>Add Video to Character';
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Add enter key handler for character search
document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('videoCharacterSearchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.which === 13) {
                e.preventDefault();
                searchCharactersForVideo();
            }
        });
    }
});
