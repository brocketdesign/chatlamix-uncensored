/**
 * Unified Generation Dashboard
 * Mobile-first state management for image and video generation
 */

// Model categories that cannot be used for text-to-image generation
const INCOMPATIBLE_TEXT_TO_IMAGE_CATEGORIES = ['face', 'img2img'];

// Custom model ID prefix
const CUSTOM_MODEL_PREFIX = 'custom-';

class GenerationDashboard {
  constructor(config = {}) {
    // Core state - initialMode comes from URL param (?mode=video)
    const initialMode = (config.initialMode === 'video') ? 'video' : 'image';
    this.state = {
      mode: initialMode, // 'image' or 'video'
      selectedModel: null,
      isGenerating: false,
      results: [],
      // Tool configuration
      tools: {
        baseImage: null, // Data URL for img2img or i2v
        faceImage: null, // Data URL for face merge
        targetImage: null, // Data URL for face merge target
        baseVideo: null, // Data URL for video face merge
        aspectRatio: '1:1',
        duration: '5',
        style: '',
        negativePrompt: '',
        imageCount: 1 // Number of images to generate
      },
      // User data
      userPoints: config.userPoints || 0,
      imageCostPerUnit: config.imageCostPerUnit || 10,
      videoCostPerUnit: config.videoCostPerUnit || 100,
      faceMergeCost: config.faceMergeCost || 20,
      // Character selection
      selectedCharacter: config.selectedCharacter || null,
      selectedCharacterId: config.selectedCharacterId || null
    };
    
    // Apply face image fallback if character is pre-selected
    if (this.state.selectedCharacter) {
      const char = this.state.selectedCharacter;
      const faceImage = char.faceImageUrl || char.chatImageUrl;
      if (faceImage) {
        this.state.tools.faceImage = faceImage;
        // Also set fallback on the character object
        if (!char.faceImageUrl && char.chatImageUrl) {
          this.state.selectedCharacter.faceImageUrl = char.chatImageUrl;
        }
      }
    }
    
    // Model configurations passed from server
    this.imageModels = config.imageModels || [];
    this.videoModels = config.videoModels || [];
    
    // User's characters
    this.userCharacters = config.userCharacters || [];
    
    // User's custom models
    this.userModels = [];
    
    // UI elements cache
    this.elements = {};
    
    // Polling intervals for async tasks
    this.pollIntervals = new Map();
    
    // Current preview ID for actions
    this._currentPreviewId = null;
    
    // Initialize
    this.init();
  }
  
  /**
   * Check if current user has an active premium subscription
   */
  isPremium() {
    return window.user?.subscriptionStatus === 'active';
  }

  /**
   * Check if a model is available for free users (non-premium)
   * Only z-image-turbo is free for txt2img. All img2img and face models require premium.
   */
  isModelFree(model) {
    if (!model) return false;
    const category = model.category || 'txt2img';
    // img2img and face categories are all premium
    if (category === 'img2img' || category === 'face') return false;
    // For txt2img, only z-image-turbo is free
    if (category === 'txt2img') {
      const id = model.id || model.modelId || '';
      return id === 'z-image-turbo';
    }
    return false;
  }

  /**
   * Generate HTML for an image slide, with NSFW protection for non-premium users
   * @param {string} url - Image URL
   * @param {boolean} isNsfw - Whether the image is flagged as NSFW
   * @param {number} idx - Image index
   * @param {string} resultId - Result ID for data attributes
   * @returns {string} HTML string for the image
   */
  generateImageSlideHtml(url, isNsfw, idx, resultId) {
    const shouldBlur = isNsfw && !this.isPremium();

    if (shouldBlur) {
      // NSFW image for non-premium user: show blurred placeholder with overlay
      return `
        <div class="gen-carousel-slide ${idx === 0 ? 'active' : ''}" data-index="${idx}">
          <div class="gen-nsfw-container" style="position: relative; width: 100%; height: 100%;">
            <img
              class="gen-nsfw-blurred"
              src="/img/nsfw-blurred-2.png"
              alt="NSFW content"
              loading="lazy"
              data-original-url="${url}"
              data-result-id="${resultId}"
              data-index="${idx}"
              style="width: 100%; height: 100%; object-fit: cover; filter: blur(15px); transform: scale(1.1);">
            <div class="gen-nsfw-overlay" style="
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
              background: rgba(0, 0, 0, 0.25);
              z-index: 2;">
              <i class="bi bi-lock-fill" style="font-size: 2rem; color: #fff; opacity: 0.9; margin-bottom: 0.75rem;"></i>
              <button class="btn btn-sm gen-unlock-btn" onclick="event.stopPropagation(); loadPlanPage();" style="
                background: linear-gradient(90.9deg, #D2B8FF 2.74%, #8240FF 102.92%);
                color: white;
                border: none;
                border-radius: 8px;
                font-weight: 600;
                padding: 0.5rem 1rem;
                font-size: 0.85rem;
                cursor: pointer;">
                <i class="bi bi-unlock-fill me-2"></i>${window.translations?.blurButton || 'Unlock Content'}
              </button>
            </div>
          </div>
        </div>
      `;
    } else {
      // Normal image display
      return `
        <div class="gen-carousel-slide ${idx === 0 ? 'active' : ''}" data-index="${idx}">
          <img src="${url}" alt="Generated image ${idx + 1}" loading="lazy">
        </div>
      `;
    }
  }

  /**
   * Generate HTML for a single image, with NSFW protection for non-premium users
   * @param {string} url - Image URL
   * @param {boolean} isNsfw - Whether the image is flagged as NSFW
   * @param {string} resultId - Result ID
   * @returns {string} HTML string for the image
   */
  generateSingleImageHtml(url, isNsfw, resultId) {
    const shouldBlur = isNsfw && !this.isPremium();

    if (shouldBlur) {
      return `
        <div class="gen-nsfw-container" style="position: relative; width: 100%; height: 100%;">
          <img
            class="gen-nsfw-blurred"
            src="/img/nsfw-blurred-2.png"
            alt="NSFW content"
            loading="lazy"
            data-original-url="${url}"
            data-result-id="${resultId}"
            style="width: 100%; height: 100%; object-fit: cover; filter: blur(15px); transform: scale(1.1);">
          <div class="gen-nsfw-overlay" style="
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            background: rgba(0, 0, 0, 0.25);
            z-index: 2;">
            <i class="bi bi-lock-fill" style="font-size: 2rem; color: #fff; opacity: 0.9; margin-bottom: 0.75rem;"></i>
            <button class="btn btn-sm gen-unlock-btn" onclick="event.stopPropagation(); loadPlanPage();" style="
              background: linear-gradient(90.9deg, #D2B8FF 2.74%, #8240FF 102.92%);
              color: white;
              border: none;
              border-radius: 8px;
              font-weight: 600;
              padding: 0.5rem 1rem;
              font-size: 0.85rem;
              cursor: pointer;">
              <i class="bi bi-unlock-fill me-2"></i>${window.translations?.blurButton || 'Unlock Content'}
            </button>
          </div>
        </div>
      `;
    } else {
      return `<img src="${url}" alt="Generated image" loading="lazy">`;
    }
  }

  /**
   * Fetch blurred image blob and update the image element
   * @param {HTMLImageElement} imgElement - The image element to update
   * @param {string} imageUrl - Original image URL
   */
  fetchBlurredImageForNsfw(imgElement, imageUrl) {
    fetch('/blur-image?url=' + encodeURIComponent(imageUrl), {
      method: 'GET',
      credentials: 'include'
    })
    .then(response => response.blob())
    .then(blob => {
      const objectUrl = URL.createObjectURL(blob);
      imgElement.src = objectUrl;
      imgElement.style.filter = 'blur(15px)';
      imgElement.style.transform = 'scale(1.1)';
    })
    .catch(error => {
      console.error('[GenerationDashboard] Failed to load blurred image:', error);
    });
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    
    // Apply initial mode from URL parameter to the mode buttons UI
    if (this.state.mode !== 'image') {
      this.elements.modeButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === this.state.mode);
      });
    }
    
    this.setInitialState();
    this.loadStoredResults();
    this.loadUserModels(); // Load user's custom models
    this.updateUI();
    
    // Update tools visibility for initial mode
    this.updateToolsForMode();

    console.log('[GenerationDashboard] Initialized with mode:', this.state.mode);
  }
  
  cacheElements() {
    // Top bar
    this.elements.modeButtons = document.querySelectorAll('.gen-mode-btn');
    this.elements.modelSelector = document.querySelector('.gen-model-selector');
    this.elements.modelNameDisplay = document.querySelector('.gen-model-selector .model-name');
    
    // Main content
    this.elements.mainContent = document.querySelector('.studio-results') || document.querySelector('.gen-main-content');
    this.elements.contentInner = document.querySelector('.gen-content-inner');
    this.elements.emptyState = document.querySelector('.gen-empty-state');
    
    // Bottom bar
    this.elements.promptInput = document.querySelector('.gen-prompt-input');
    this.elements.submitBtn = document.querySelector('.gen-submit-btn');
    this.elements.toolsRow = document.querySelector('.gen-tools-row');
    this.elements.toolButtons = document.querySelectorAll('.gen-tool-btn');
    this.elements.costDisplay = document.querySelector('.gen-cost-display');
    
    // Overlays
    this.elements.overlayBackdrop = document.querySelector('.gen-overlay-backdrop');
    this.elements.modelSheet = document.querySelector('#modelSheet');
    this.elements.settingsSheet = document.querySelector('#settingsSheet');
    this.elements.uploadSheet = document.querySelector('#uploadSheet');
    this.elements.previewOverlay = document.querySelector('.gen-preview-overlay');
    
    // File inputs
    this.elements.baseImageInput = document.querySelector('#baseImageInput');
    this.elements.faceImageInput = document.querySelector('#faceImageInput');
    this.elements.targetImageInput = document.querySelector('#targetImageInput');
    this.elements.baseVideoInput = document.querySelector('#baseVideoInput');
  }
  
  bindEvents() {
    // Mode switching
    this.elements.modeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => this.handleModeSwitch(e));
    });
    
    // Model selector
    if (this.elements.modelSelector) {
      this.elements.modelSelector.addEventListener('click', () => this.openModelSheet());
    }
    
    // Prompt input
    if (this.elements.promptInput) {
      this.elements.promptInput.addEventListener('input', () => this.handlePromptInput());
      this.elements.promptInput.addEventListener('keydown', (e) => this.handlePromptKeydown(e));
    }
    
    // Submit button
    if (this.elements.submitBtn) {
      this.elements.submitBtn.addEventListener('click', () => this.handleGenerate());
    }
    
    // Tool buttons
    this.elements.toolButtons.forEach(btn => {
      btn.addEventListener('click', (e) => this.handleToolClick(e));
    });
    
    // Overlay backdrop
    if (this.elements.overlayBackdrop) {
      this.elements.overlayBackdrop.addEventListener('click', () => this.closeAllOverlays());
    }
    
    // File inputs
    this.bindFileInputs();
    
    // Window resize for textarea
    window.addEventListener('resize', () => this.resizePromptInput());
  }
  
  bindFileInputs() {
    if (this.elements.baseImageInput) {
      this.elements.baseImageInput.addEventListener('change', (e) => {
        this.handleFileUpload(e.target.files[0], 'baseImage');
      });
    }
    
    if (this.elements.faceImageInput) {
      this.elements.faceImageInput.addEventListener('change', (e) => {
        this.handleFileUpload(e.target.files[0], 'faceImage');
      });
    }
    
    if (this.elements.targetImageInput) {
      this.elements.targetImageInput.addEventListener('change', (e) => {
        this.handleFileUpload(e.target.files[0], 'targetImage');
      });
    }
    
    if (this.elements.baseVideoInput) {
      this.elements.baseVideoInput.addEventListener('change', (e) => {
        this.handleFileUpload(e.target.files[0], 'baseVideo');
      });
    }
  }
  
  setInitialState() {
    // Set default model based on mode
    this.selectDefaultModel();
    
    // Auto-resize prompt input
    this.resizePromptInput();
    
    // Update aspect ratio button to show current value
    this.updateAspectRatioButton();
  }
  
  selectDefaultModel() {
    const models = this.state.mode === 'image' ? this.imageModels : this.videoModels;
    if (models.length > 0) {
      this.state.selectedModel = models[0];
      this.updateModelDisplay();
      this.updateToolButtonsForModel(); // Update tool buttons for the default model
    }
  }
  
  // ============================================================================
  // MODE MANAGEMENT
  // ============================================================================
  
  handleModeSwitch(e) {
    const btn = e.currentTarget;
    const newMode = btn.dataset.mode;

    if (newMode === this.state.mode) return;

    // Video mode is premium only
    if (newMode === 'video' && !this.isPremium()) {
      this.showNotification('Video generation is a premium feature.', 'warning');
      if (typeof loadPlanPage === 'function') loadPlanPage();
      return;
    }

    this.state.mode = newMode;
    
    // Update UI
    this.elements.modeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Switch to appropriate default model
    this.selectDefaultModel();
    
    // Update tools visibility
    this.updateToolsForMode();
    
    // Update cost display
    this.updateCostDisplay();
    
    // Update empty state text
    this.updateEmptyState();
    
    console.log('[GenerationDashboard] Mode switched to:', newMode);
  }
  
  updateToolsForMode() {
    // Define which tools are available in each mode
    const imageTools = ['upload-base', 'upload-face', 'aspect-ratio', 'image-count', 'settings'];
    const videoTools = ['upload-base', 'upload-face', 'duration', 'upload-video', 'settings'];
    
    this.elements.toolButtons.forEach(btn => {
      const toolType = btn.dataset.tool;
      const isImageTool = imageTools.includes(toolType);
      const isVideoTool = videoTools.includes(toolType);
      
      if (this.state.mode === 'image') {
        btn.classList.toggle('gen-hidden', !isImageTool);
      } else {
        btn.classList.toggle('gen-hidden', !isVideoTool);
      }
    });
    
    // Also update tool buttons based on selected model
    this.updateToolButtonsForModel();
  }
  
  /**
   * Update aspect ratio button to show current selection
   */
  updateAspectRatioButton() {
    const btn = document.querySelector('[data-tool="aspect-ratio"]');
    if (btn) {
      const span = btn.querySelector('span');
      if (span) {
        span.textContent = this.state.tools.aspectRatio;
      }
    }
  }
  
  /**
   * Update image count button to show current selection
   */
  updateImageCountButton() {
    const btn = document.querySelector('[data-tool="image-count"]');
    if (btn) {
      const span = btn.querySelector('span');
      if (span) {
        span.textContent = `${this.state.tools.imageCount}x`;
      }
    }
  }
  
  // ============================================================================
  // MODEL SELECTION
  // ============================================================================
  
  openModelSheet() {
    this.showOverlay('modelSheet');
    this.renderModelList();
  }
  
  renderModelList() {
    const container = document.querySelector('#modelSheet .gen-bottom-sheet-body');
    if (!container) return;
    
    const models = this.state.mode === 'image' ? this.imageModels : this.videoModels;
    
    // Group models by category
    const categories = {};
    models.forEach(model => {
      const cat = model.category || 'other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(model);
    });
    
    let html = '';
    
    // Add custom models section for image mode only
    if (this.state.mode === 'image' && this.userModels.length > 0) {
      html += `
        <div class="gen-model-category">
          <div class="gen-model-category-title">
            <i class="bi bi-person-badge"></i>
            Custom Models
            <span class="badge bg-primary ms-2">${this.userModels.length}</span>
          </div>
          <div class="gen-model-list">
            ${this.userModels.map(model => this.renderCustomModelItem(model)).join('')}
          </div>
        </div>
      `;
    }
    
    // Add "Add Custom Model" button for premium users in image mode
    if (this.state.mode === 'image') {
      const isPremium = window.user?.subscriptionStatus === 'active';
      html += `
        <div class="gen-model-category">
          <div class="gen-model-list">
            <div class="gen-model-item add-custom-model-item" id="addCustomModelBtn" style="cursor: pointer; border: 2px dashed rgba(255,255,255,0.2);">
              <div class="model-icon">
                <i class="bi bi-plus-circle"></i>
              </div>
              <div class="model-info">
                <div class="model-name">${isPremium ? 'Add Custom Model' : 'Add Custom Model (Premium)'}</div>
                <div class="model-desc">${isPremium ? 'Search and add Stable Diffusion models' : 'Upgrade to add custom models'}</div>
              </div>
              <div class="check-icon">
                ${isPremium ? '<i class="bi bi-search"></i>' : '<i class="bi bi-gem"></i>'}
              </div>
            </div>
          </div>
        </div>
      `;
    }
    
    Object.entries(categories).forEach(([category, categoryModels]) => {
      const categoryLabels = {
        'txt2img': 'Text to Image',
        'img2img': 'Image to Image',
        'face': 'Face Tools',
        'i2v': 'Image to Video',
        't2v': 'Text to Video',
        'other': 'Other Models'
      };
      
      html += `
        <div class="gen-model-category">
          <div class="gen-model-category-title">
            <i class="bi bi-collection"></i>
            ${categoryLabels[category] || category}
          </div>
          <div class="gen-model-list">
            ${categoryModels.map(model => this.renderModelItem(model)).join('')}
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
    
    // Bind click events for system models
    container.querySelectorAll('.gen-model-item:not(.add-custom-model-item)').forEach(item => {
      item.addEventListener('click', () => {
        const modelId = item.dataset.modelId;
        this.selectModel(modelId);
      });
    });
    
    // Bind click event for add custom model button
    const addBtn = container.querySelector('#addCustomModelBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.openCivitaiSearch());
    }
  }
  
  renderCustomModelItem(model) {
    // For custom models, the model.modelId already includes the prefix
    const isSelected = this.state.selectedModel?.id === model.modelId;
    
    return `
      <div class="gen-model-item ${isSelected ? 'selected' : ''}" data-model-id="${model.modelId}" data-is-custom="true">
        <div class="model-icon">
          ${model.image ? `<img src="${model.image}" style="width: 40px; height: 40px; border-radius: 8px; object-fit: cover;" alt="${model.name}">` : '<i class="bi bi-image"></i>'}
        </div>
        <div class="model-info">
          <div class="model-name">${model.name}</div>
          <div class="model-desc">${model.style || ''} - ${model.baseModel || 'SD'}</div>
          <div class="model-badges">
            <span class="gen-model-badge custom">Custom</span>
            <span class="gen-model-badge async">Async</span>
          </div>
        </div>
        <div class="check-icon">
          <i class="bi bi-check"></i>
        </div>
      </div>
    `;
  }
  
  renderModelItem(model) {
    const isSelected = this.state.selectedModel?.id === model.id;
    const isFree = this.isModelFree(model);
    const needsPremium = !isFree && !this.isPremium();

    const badges = [];
    if (model.async) badges.push('<span class="gen-model-badge async">Async</span>');
    if (model.category === 'i2v' || model.supportsImg2Img) {
      badges.push('<span class="gen-model-badge i2v">I2V</span>');
    }
    if (model.category === 't2v' || model.category === 'txt2img') {
      badges.push('<span class="gen-model-badge t2v">T2V</span>');
    }
    if (model.category === 'face') {
      badges.push('<span class="gen-model-badge face">Face</span>');
    }
    if (needsPremium) {
      badges.push('<span class="gen-model-badge premium"><i class="bi bi-gem"></i> Premium</span>');
    }

    return `
      <div class="gen-model-item ${isSelected ? 'selected' : ''} ${needsPremium ? 'gen-premium-locked' : ''}" data-model-id="${model.id}" data-premium="${needsPremium ? 'true' : 'false'}">
        <div class="model-icon">
          <i class="bi bi-${needsPremium ? 'lock-fill' : (this.state.mode === 'image' ? 'image' : 'film')}"></i>
        </div>
        <div class="model-info">
          <div class="model-name">${model.name}${needsPremium ? ' <i class="bi bi-gem" style="color: #a78bfa; font-size: 0.75em;"></i>' : ''}</div>
          <div class="model-desc">${model.description || ''}</div>
          <div class="model-badges">${badges.join('')}</div>
        </div>
        <div class="check-icon">
          ${needsPremium ? '<i class="bi bi-gem"></i>' : '<i class="bi bi-check"></i>'}
        </div>
      </div>
    `;
  }
  
  selectModel(modelId) {
    // Check if it's a custom model using the prefix constant
    let model = null;

    if (modelId.startsWith(CUSTOM_MODEL_PREFIX)) {
      // Search in user models
      model = this.userModels.find(m => m.modelId === modelId);
    } else {
      // Search in system models
      const models = this.state.mode === 'image' ? this.imageModels : this.videoModels;
      model = models.find(m => m.id === modelId);
    }

    // Block non-premium users from selecting premium models
    if (model && !this.isModelFree(model) && !this.isPremium()) {
      this.showNotification('This model requires a premium subscription.', 'warning');
      if (typeof loadPlanPage === 'function') loadPlanPage();
      return;
    }

    if (model) {
      // Store model with proper id field for consistency
      this.state.selectedModel = {
        ...model,
        id: model.modelId || model.id
      };
      this.updateModelDisplay();
      this.updateToolButtonsForModel(); // Update tool buttons based on model requirements
      this.updateCostDisplay(); // Update cost as different models may have different costs
      this.updateSubmitButtonState(); // Update submit button state for face merge models
      this.closeAllOverlays();
      console.log('[GenerationDashboard] Model selected:', this.state.selectedModel.name, this.state.selectedModel);
    }
  }
  
  updateModelDisplay() {
    if (this.elements.modelNameDisplay && this.state.selectedModel) {
      this.elements.modelNameDisplay.textContent = this.state.selectedModel.name;
    }
  }
  
  /**
   * Update tool buttons based on selected model requirements
   * Disable/enable base image and face image buttons based on what the model supports
   */
  updateToolButtonsForModel() {
    const model = this.state.selectedModel;
    if (!model) return;
    
    const baseImageBtn = document.querySelector('[data-tool="upload-base"]');
    const faceImageBtn = document.querySelector('[data-tool="upload-face"]');
    
    if (this.state.mode === 'image') {
      // For image mode, check if model requires or supports images
      const requiresImage = model.requiresImage || false;
      const supportsImg2Img = model.supportsImg2Img || false;
      const requiresTwoImages = model.requiresTwoImages || false;
      const category = model.category || 'txt2img';
      
      // Base image button: Enable if model supports img2img or requires image
      if (baseImageBtn) {
        const shouldEnableBase = supportsImg2Img || requiresImage || category === 'img2img';
        baseImageBtn.disabled = !shouldEnableBase;
        baseImageBtn.classList.toggle('gen-disabled', !shouldEnableBase);
        baseImageBtn.title = shouldEnableBase ? 'Upload base image' : 'Not supported by this model';
      }
      
      // Face image button: Enable only for face category models
      if (faceImageBtn) {
        const shouldEnableFace = category === 'face' || requiresTwoImages;
        faceImageBtn.disabled = !shouldEnableFace;
        faceImageBtn.classList.toggle('gen-disabled', !shouldEnableFace);
        faceImageBtn.title = shouldEnableFace ? 'Upload face image' : 'Not supported by this model';
      }
    } else {
      // For video mode
      const category = model.category || 'i2v';
      const requiresImage = model.requiresImage || category === 'i2v';
      const requiresFaceImage = model.requiresFaceImage || category === 'face';
      
      // Base image button: Enable for i2v models
      if (baseImageBtn) {
        baseImageBtn.disabled = !requiresImage;
        baseImageBtn.classList.toggle('gen-disabled', !requiresImage);
        baseImageBtn.title = requiresImage ? 'Upload base image' : 'Not supported by this model';
      }
      
      // Face image button: Enable for face category models
      if (faceImageBtn) {
        faceImageBtn.disabled = !requiresFaceImage;
        faceImageBtn.classList.toggle('gen-disabled', !requiresFaceImage);
        faceImageBtn.title = requiresFaceImage ? 'Upload face image' : 'Not supported by this model';
      }
    }
  }
  
  /**
   * Get the model name for SD models, handling multiple possible field names
   * @param {Object} model - Model object
   * @returns {string} Model name
   */
  getSDModelName(model) {
    return model.sdName || model.modelName || model.model || 'Unknown Model';
  }
  
  /**
   * Load user's custom models from the API
   */
  async loadUserModels() {
    try {
      const response = await fetch('/api/user/models');
      const data = await response.json();
      
      if (data.success && data.models) {
        // Convert user models to the format expected by the dashboard
        this.userModels = data.models.map(model => ({
          modelId: `${CUSTOM_MODEL_PREFIX}${model.modelId}`,
          name: model.name,
          sdName: model.model,
          model: model.model,
          image: model.image,
          style: model.style,
          baseModel: model.baseModel,
          category: 'txt2img',
          async: true,
          isCustom: true,
          isSDModel: true,
          requiresModel: true,
          modelName: model.model,
          description: `Custom ${model.style || ''} model`,
          supportedParams: ['model_name', 'prompt', 'negative_prompt', 'width', 'height', 'image_num', 'steps', 'guidance_scale', 'sampler_name', 'seed', 'loras', 'sd_vae'],
          defaultParams: {
            width: 1024,
            height: 1024,
            image_num: 1,
            steps: 30,
            guidance_scale: 7.5,
            sampler_name: 'Euler a',
            seed: -1
          }
        }));
        
        console.log('[GenerationDashboard] Loaded custom models:', this.userModels.length);
      }
    } catch (error) {
      console.error('[GenerationDashboard] Error loading user models:', error);
    }
  }
  
  /**
   * Open Civitai model search modal
   */
  openCivitaiSearch() {
    const isPremium = window.user?.subscriptionStatus === 'active';
    
    if (!isPremium) {
      this.showNotification('Custom models are a premium feature.', 'warning');
      if (typeof loadPlanPage === 'function') loadPlanPage();
      return;
    }
    
    // Open the Civitai search modal
    const modal = new bootstrap.Modal(document.getElementById('civitaiSearchModal'));
    modal.show();
    
    // Close model sheet
    this.closeAllOverlays();
  }
  
  // ============================================================================
  // PROMPT INPUT
  // ============================================================================
  
  handlePromptInput() {
    this.resizePromptInput();
    this.updateSubmitButtonState();
  }
  
  handlePromptKeydown(e) {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleGenerate();
    }
  }
  
  resizePromptInput() {
    const input = this.elements.promptInput;
    if (!input) return;
    
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }
  
  updateSubmitButtonState() {
    const hasPrompt = this.elements.promptInput?.value.trim().length > 0;
    const isFaceMerge = this.state.selectedModel?.category === 'face';
    const canGenerate = (hasPrompt || isFaceMerge) && !this.state.isGenerating && this.hasEnoughPoints();
    
    if (this.elements.submitBtn) {
      this.elements.submitBtn.disabled = !canGenerate;
    }
  }
  
  // ============================================================================
  // GENERATION
  // ============================================================================
  
  async handleGenerate() {
    const prompt = this.elements.promptInput?.value.trim();
    const model = this.state.selectedModel;
    
    // For face merge models, prompt is optional; for others, it's required
    const isFaceMerge = model?.category === 'face';
    if ((!prompt && !isFaceMerge) || this.state.isGenerating) return;
    
    if (!this.hasEnoughPoints()) {
      this.showNotification('Insufficient points for generation', 'error');
      return;
    }
    if (!model) {
      this.showNotification('Please select a model', 'error');
      return;
    }
    
    // Validate face merge: requires both face image and target image
    if (isFaceMerge || model?.requiresTwoImages) {
      const hasFace = this.state.tools.faceImage || 
        this.state.selectedCharacter?.faceImageUrl || 
        this.state.selectedCharacter?.chatImageUrl;
      const hasTarget = this.state.tools.baseImage || this.state.tools.targetImage;
      
      if (!hasFace) {
        this.showNotification('Face merge requires a face image. Upload one or select a character.', 'error');
        return;
      }
      if (!hasTarget) {
        this.showNotification('Face merge requires a target image. Upload a base image with the body/scene.', 'error');
        return;
      }
    }
    
    this.state.isGenerating = true;
    this.updateGeneratingState(true);
    
    try {
      // Create pending result card
      const pendingResult = this.createPendingResult(prompt);
      this.addResultToFeed(pendingResult);
      
      // Store face image info for potential post-processing face merge
      const faceImageForMerge = this.state.tools.faceImage || 
        this.state.selectedCharacter?.faceImageUrl || 
        this.state.selectedCharacter?.chatImageUrl || null;
      const selectedModelCategory = this.state.selectedModel?.category || 'txt2img';
      
      // If we have a face image but are NOT using a face merge model,
      // we'll need to do post-processing face merge after generation
      if (faceImageForMerge && selectedModelCategory !== 'face') {
        pendingResult._pendingFaceMerge = true;
        pendingResult._faceImageForMerge = faceImageForMerge;
      }
      
      // Call appropriate API based on mode
      const endpoint = this.state.mode === 'image' 
        ? '/dashboard/image/generate'
        : '/dashboard/video/generate';
      
      const payload = this.buildGenerationPayload(prompt);
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      console.log('[GenerationDashboard] 📨 API Response received');
      console.log('[GenerationDashboard] 📨 Tasks count:', data.tasks?.length || 0);
      
      // Log detailed task info for debugging
      if (data.tasks) {
        data.tasks.forEach((task, idx) => {
          console.log(`[GenerationDashboard] 📨 Task ${idx + 1}:`, {
            taskId: task.taskId || task.task_id,
            status: task.status,
            async: task.async,
            imagesCount: task.images?.length || 0,
            imagesUrls: task.images?.map(img => (img?.imageUrl || img?.image_url || img?.url || 'UNKNOWN').substring(0, 50) + '...')
          });
        });
      }
      
      if (!data.success && !data.tasks) {
        throw new Error(data.error || 'Generation failed');
      }
      
      // Handle tasks - ALL tasks should contribute to ONE result with carousel
      if (data.tasks && data.tasks.length > 0) {
        const totalTasks = data.tasks.length;
        console.log(`[GenerationDashboard] 🔄 Processing ${totalTasks} task(s) into single carousel result`);
        
        // Initialize the pending result to track all tasks
        pendingResult.expectedImageCount = totalTasks;
        pendingResult.completedTaskCount = 0;
        pendingResult.taskIds = [];
        pendingResult.mediaUrls = [];
        pendingResult.mediaItems = []; // Store {url, nsfw} objects
        
        // Process all tasks - they all contribute to the same result
        for (let i = 0; i < totalTasks; i++) {
          const task = data.tasks[i];
          const taskId = task.taskId || task.task_id;
          
          console.log(`[GenerationDashboard] 🔄 Task ${i + 1}/${totalTasks}:`, {
            taskId: taskId,
            status: task.status,
            async: task.async,
            imagesCount: task.images?.length || 0
          });
          
          // Track this task ID
          if (taskId) {
            pendingResult.taskIds.push(taskId);
          }
          
          // Process the task - it will add images to pendingResult
          this.processTaskForCarousel(task, pendingResult);
        }
      } else if (data.result) {
        // Immediate result
        this.updateResultWithData(pendingResult.id, data.result);
      }
      
      // Clear input and reset
      this.elements.promptInput.value = '';
      this.resizePromptInput();
      
      // Update points
      if (data.newPoints !== undefined) {
        this.state.userPoints = data.newPoints;
        this.updateCostDisplay();
      }
      
    } catch (error) {
      console.error('[GenerationDashboard] Generation error:', error);
      this.showNotification(error.message || 'Generation failed', 'error');
    } finally {
      this.state.isGenerating = false;
      this.updateGeneratingState(false);
    }
  }
  
  /**
   * Process a single task and add its images to the shared result (for carousel)
   * This handles both sync completed tasks and async tasks that need polling
   * @param {Object} task - Task object from backend
   * @param {Object} result - Shared result object to add images to
   */
  processTaskForCarousel(task, result) {
    // Check if task is already completed (sync models like merge-face-segmind)
    if (task.status === 'completed' && task.images && task.images.length > 0) {
      console.log('[GenerationDashboard] 🖼️ Sync task completed with', task.images.length, 'image(s)');

      // Extract ALL image data (URL + NSFW flag) from the task
      const imageData = task.images.map((img, idx) => {
        const url = img?.imageUrl || img?.image_url || img?.url || (typeof img === 'string' ? img : null);
        const nsfw = img?.nsfw || false;
        console.log(`[GenerationDashboard] 🖼️ Sync Image ${idx + 1} URL:`, url ? url.substring(0, 80) + '...' : 'NOT FOUND', 'NSFW:', nsfw);
        return url ? { url, nsfw } : null;
      }).filter(item => item);

      // Add images to the shared result
      this.addImagesToResult(result.id, imageData);
      
    } else if (task.status === 'completed') {
      // Task completed but no images - count as completed but with no contribution
      console.log('[GenerationDashboard] ⚠️ Task completed but no images:', task);
      result.completedTaskCount = (result.completedTaskCount || 0) + 1;
      this.checkAndFinalizeResult(result);
      
    } else if (task.status === 'failed') {
      // Task failed - count as completed (failed)
      console.log('[GenerationDashboard] ❌ Task failed:', task.error || 'Unknown error');
      result.completedTaskCount = (result.completedTaskCount || 0) + 1;
      this.checkAndFinalizeResult(result);
      
    } else {
      // Async task - need to poll for result
      const taskId = task.taskId || task.task_id;
      console.log('[GenerationDashboard] ⏳ Starting async poll for task:', taskId);
      this.startPollingTaskForCarousel(taskId, result);
    }
  }
  
  /**
   * Add images to a result and update the UI
   * @param {string} resultId - Result ID
   * @param {Array} imageData - Array of image objects {url, nsfw} or URLs to add
   */
  addImagesToResult(resultId, imageData) {
    const result = this.state.results.find(r => r.id === resultId);
    if (!result) return;

    // Initialize arrays if not exists
    if (!result.mediaUrls) {
      result.mediaUrls = [];
    }
    if (!result.mediaItems) {
      result.mediaItems = []; // Store full image data {url, nsfw}
    }

    // Normalize and add new images (with deduplication)
    imageData.forEach(item => {
      const url = typeof item === 'string' ? item : item?.url;
      if (!url) return;

      // Check if URL already exists to prevent duplicates
      if (result.mediaUrls.includes(url)) {
        console.log(`[GenerationDashboard] ⚠️ Skipping duplicate URL: ${url.substring(0, 50)}...`);
        return;
      }

      if (typeof item === 'string') {
        // Legacy: just a URL string
        result.mediaUrls.push(item);
        result.mediaItems.push({ url: item, nsfw: false });
      } else if (item && item.url) {
        // New format: {url, nsfw} object
        result.mediaUrls.push(item.url);
        result.mediaItems.push(item);
      }
    });

    // Set primary mediaUrl for backward compatibility
    if (!result.mediaUrl && result.mediaUrls.length > 0) {
      result.mediaUrl = result.mediaUrls[0];
    }

    // Increment completed task count
    result.completedTaskCount = (result.completedTaskCount || 0) + 1;

    console.log(`[GenerationDashboard] 📊 Added ${imageData.length} images to result ${resultId}`);
    console.log(`[GenerationDashboard] 📊 Total images now: ${result.mediaUrls.length}`);
    console.log(`[GenerationDashboard] 📊 Tasks completed: ${result.completedTaskCount}/${result.expectedImageCount || '?'}`);

    // Check if all tasks are done
    this.checkAndFinalizeResult(result);
  }
  
  /**
   * Check if all tasks are complete and finalize the result
   * @param {Object} result - Result object
   */
  checkAndFinalizeResult(result) {
    const expectedCount = result.expectedImageCount || 1;
    const completedCount = result.completedTaskCount || 0;
    
    console.log(`[GenerationDashboard] 🔍 Checking result completion: ${completedCount}/${expectedCount}`);
    
    // Update status based on completion
    if (completedCount >= expectedCount) {
      // All tasks complete
      if (result.mediaUrls && result.mediaUrls.length > 0) {
        // Check if post-processing face merge is needed
        if (result._pendingFaceMerge && result._faceImageForMerge) {
          console.log(`[GenerationDashboard] 🔄 Starting post-processing face merge for ${result.mediaUrls.length} image(s)`);
          result.status = 'pending'; // Keep as pending during face merge
          this.applyPostProcessingFaceMerge(result);
          return; // Don't finalize yet, applyPostProcessingFaceMerge will handle it
        }
        
        result.status = 'completed';
        console.log(`[GenerationDashboard] ✅ All tasks complete! Total images: ${result.mediaUrls.length}`);
      } else {
        result.status = 'failed';
        console.log('[GenerationDashboard] ❌ All tasks complete but no images received');
      }
    } else {
      // Still waiting for more tasks
      result.status = 'pending';
    }
    
    // Log for debugging
    console.log(`[GenerationDashboard] 📊 IMAGES RECEIVED: ${result.mediaUrls?.length || 0}`);
    console.log(`[GenerationDashboard] 📊 IMAGES TO DISPLAY: ${result.mediaUrls?.length || (result.mediaUrl ? 1 : 0)}`);
    
    // Update card in DOM
    const card = document.getElementById(`result-${result.id}`);
    if (card) {
      const newCard = this.createResultCard(result);
      card.replaceWith(newCard);
    }
    
    // Save to localStorage if completed
    if (result.status === 'completed') {
      this.saveResults();
    }
  }
  
  /**
   * Apply face merge as post-processing step after image generation
   * Takes each generated image and merges the character's face onto it
   * @param {Object} result - The completed result with generated images
   */
  async applyPostProcessingFaceMerge(result) {
    const faceImage = result._faceImageForMerge;
    const originalUrls = [...result.mediaUrls];
    const originalItems = [...(result.mediaItems || [])];
    
    console.log(`[GenerationDashboard] 🔄 Face merge post-processing: ${originalUrls.length} image(s) with face: ${faceImage?.substring(0, 60)}...`);
    
    // Show notification
    this.showNotification('Applying face swap to generated images...', 'info');
    
    // Update card to show face merge in progress
    result.status = 'pending';
    result._faceMergeStatus = 'processing';
    const card = document.getElementById(`result-${result.id}`);
    if (card) {
      const newCard = this.createResultCard(result);
      card.replaceWith(newCard);
    }
    
    // Process each generated image through face merge
    const mergedUrls = [];
    const mergedItems = [];
    let hasAnySuccess = false;
    
    for (let i = 0; i < originalUrls.length; i++) {
      const targetImageUrl = originalUrls[i];
      console.log(`[GenerationDashboard] 🔄 Face merge for image ${i + 1}/${originalUrls.length}`);
      
      try {
        const mergePayload = {
          models: ['merge-face-segmind'],
          selectedSDModels: [],
          prompt: result.prompt || '',
          generationMode: 'face',
          face_image_file: faceImage,
          image_file: targetImageUrl,
          size: '1024*1024',
          imagesPerModel: 1
        };
        
        const response = await fetch('/dashboard/image/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mergePayload)
        });
        
        const data = await response.json();
        
        if (data.success && data.tasks && data.tasks.length > 0) {
          const mergeTask = data.tasks[0];
          
          if (mergeTask.status === 'completed' && mergeTask.images?.length > 0) {
            // Synchronous completion
            const img = mergeTask.images[0];
            const url = img?.imageUrl || img?.image_url || img?.url || (typeof img === 'string' ? img : null);
            if (url) {
              mergedUrls.push(url);
              mergedItems.push({ url, nsfw: img?.nsfw || originalItems[i]?.nsfw || false });
              hasAnySuccess = true;
              console.log(`[GenerationDashboard] ✅ Face merge ${i + 1} completed (sync)`);
            } else {
              // Fallback to original
              mergedUrls.push(targetImageUrl);
              mergedItems.push(originalItems[i] || { url: targetImageUrl, nsfw: false });
            }
          } else if (mergeTask.async && (mergeTask.taskId || mergeTask.task_id)) {
            // Async merge - poll for result
            const taskId = mergeTask.taskId || mergeTask.task_id;
            const mergedResult = await this.pollForFaceMergeResult(taskId);
            if (mergedResult) {
              mergedUrls.push(mergedResult.url);
              mergedItems.push(mergedResult);
              hasAnySuccess = true;
              console.log(`[GenerationDashboard] ✅ Face merge ${i + 1} completed (async)`);
            } else {
              mergedUrls.push(targetImageUrl);
              mergedItems.push(originalItems[i] || { url: targetImageUrl, nsfw: false });
              console.log(`[GenerationDashboard] ⚠️ Face merge ${i + 1} failed, using original`);
            }
          } else {
            // Failed, use original
            mergedUrls.push(targetImageUrl);
            mergedItems.push(originalItems[i] || { url: targetImageUrl, nsfw: false });
          }
        } else {
          console.error(`[GenerationDashboard] ❌ Face merge ${i + 1} API error:`, data.error);
          mergedUrls.push(targetImageUrl);
          mergedItems.push(originalItems[i] || { url: targetImageUrl, nsfw: false });
        }
      } catch (error) {
        console.error(`[GenerationDashboard] ❌ Face merge ${i + 1} error:`, error);
        mergedUrls.push(targetImageUrl);
        mergedItems.push(originalItems[i] || { url: targetImageUrl, nsfw: false });
      }
    }
    
    // Update result with merged images
    result.mediaUrls = mergedUrls;
    result.mediaItems = mergedItems;
    result.mediaUrl = mergedUrls[0] || result.mediaUrl;
    result._pendingFaceMerge = false;
    result._faceMergeStatus = 'completed';
    result._faceMergeApplied = hasAnySuccess;
    result.status = 'completed';
    
    console.log(`[GenerationDashboard] ✅ Face merge post-processing complete. ${hasAnySuccess ? 'Face swap applied!' : 'Using original images.'}`);
    
    if (hasAnySuccess) {
      this.showNotification('Face swap applied successfully!', 'success');
    } else {
      this.showNotification('Face swap could not be applied, showing original images.', 'warning');
    }
    
    // Update card and save
    const finalCard = document.getElementById(`result-${result.id}`);
    if (finalCard) {
      const newCard = this.createResultCard(result);
      finalCard.replaceWith(newCard);
    }
    this.saveResults();
  }
  
  /**
   * Poll for a face merge async task result
   * @param {string} taskId - The task ID to poll
   * @returns {Object|null} - { url, nsfw } or null if failed
   */
  async pollForFaceMergeResult(taskId) {
    const maxAttempts = 60; // 5 minutes max (5s intervals)
    let attempts = 0;
    
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        attempts++;
        try {
          const response = await fetch(`/dashboard/image/status/${taskId}`);
          const data = await response.json();
          
          if (data.status === 'completed' || data.status === 'TASK_STATUS_SUCCEED') {
            clearInterval(interval);
            const images = data.images || [];
            if (images.length > 0) {
              const img = images[0];
              const url = img?.imageUrl || img?.image_url || img?.url || (typeof img === 'string' ? img : null);
              resolve(url ? { url, nsfw: img?.nsfw || false } : null);
            } else if (data.imageUrl) {
              resolve({ url: data.imageUrl, nsfw: data.nsfw || false });
            } else {
              resolve(null);
            }
          } else if (data.status === 'failed' || data.status === 'TASK_STATUS_FAILED' || attempts >= maxAttempts) {
            clearInterval(interval);
            resolve(null);
          }
        } catch (error) {
          console.error('[GenerationDashboard] Face merge poll error:', error);
          if (attempts >= maxAttempts) {
            clearInterval(interval);
            resolve(null);
          }
        }
      }, 5000);
    });
  }
  
  /**
   * Start polling for an async task that will add images to a shared carousel result
   * @param {string} taskId - Task ID to poll
   * @param {Object} result - Shared result object to add images to
   */
  startPollingTaskForCarousel(taskId, result) {
    if (!taskId) {
      console.log('[GenerationDashboard] startPollingTaskForCarousel: No taskId provided');
      result.completedTaskCount = (result.completedTaskCount || 0) + 1;
      this.checkAndFinalizeResult(result);
      return;
    }
    
    // Skip polling for sync tasks (they already have results)
    if (taskId.startsWith('sync-')) {
      console.log('[GenerationDashboard] Skipping poll for sync task:', taskId);
      return;
    }
    
    console.log('[GenerationDashboard] Starting carousel poll for task:', taskId);
    
    const pollEndpoint = this.state.mode === 'image'
      ? '/dashboard/image/status'
      : '/dashboard/video/status';
    
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${pollEndpoint}/${taskId}`);
        const data = await response.json();
        
        console.log('[GenerationDashboard] 📡 Carousel poll response for', taskId, '- status:', data.status);
        
        if (data.status === 'completed' || data.status === 'TASK_STATUS_SUCCEED') {
          clearInterval(interval);
          this.pollIntervals.delete(taskId);

          // Extract ALL image data (URL + NSFW flag)
          const rawImages = data.images || [];
          console.log('[GenerationDashboard] 🖼️ Async task completed with', rawImages.length, 'image(s)');

          const imageData = rawImages.map((img, idx) => {
            const url = img?.imageUrl || img?.image_url || img?.url || (typeof img === 'string' ? img : null);
            const nsfw = img?.nsfw || false;
            console.log(`[GenerationDashboard] 🖼️ Async Image ${idx + 1} URL:`, url ? url.substring(0, 80) + '...' : 'NOT FOUND', 'NSFW:', nsfw);
            return url ? { url, nsfw } : null;
          }).filter(item => item);

          // If no images from array, try direct imageUrl
          if (imageData.length === 0 && data.imageUrl) {
            imageData.push({ url: data.imageUrl, nsfw: data.nsfw || false });
          }

          console.log('[GenerationDashboard] ✅ Task', taskId, 'completed with', imageData.length, 'valid URLs');

          // Add images to the shared result
          this.addImagesToResult(result.id, imageData);
          
        } else if (data.status === 'failed' || data.status === 'TASK_STATUS_FAILED') {
          clearInterval(interval);
          this.pollIntervals.delete(taskId);
          console.log('[GenerationDashboard] ❌ Async task', taskId, 'failed:', data.error || 'Unknown error');
          
          // Mark this task as completed (failed)
          result.completedTaskCount = (result.completedTaskCount || 0) + 1;
          this.checkAndFinalizeResult(result);
          
        } else {
          console.log('[GenerationDashboard] ⏳ Task', taskId, 'still processing, progress:', data.progress || 'unknown');
        }
      } catch (error) {
        console.error('[GenerationDashboard] ❌ Polling error for task', taskId, ':', error);
      }
    }, 5000); // Poll every 5 seconds
    
    this.pollIntervals.set(taskId, interval);
  }
  
  buildGenerationPayload(prompt) {
    const model = this.state.selectedModel;
    const payload = {};
    
    // Add character data if a character is selected
    if (this.state.selectedCharacterId) {
      payload.characterId = this.state.selectedCharacterId;
      payload.saveAsPendingPost = true; // Flag to save as pending post for character
    }
    
    // Check if this is a custom SD model
    if (model.isCustom || model.isSDModel) {
      // For SD models, use selectedSDModels array
      const modelName = this.getSDModelName(model);
      payload.selectedSDModels = [{
        model: modelName,
        model_name: modelName,
        name: model.name
      }];
      payload.models = []; // Empty array for standard models
    } else {
      // For standard models
      payload.models = [model.id];
      payload.selectedSDModels = []; // Empty array for SD models
    }
    
    // Use enhanced prompt if character selected, otherwise use raw prompt
    const finalPrompt = this.state.selectedCharacterId ? this.getEnhancedPrompt(prompt) : prompt;
    
    // Prompt is optional for face merge models
    if (finalPrompt || model.category !== 'face') {
      payload.prompt = finalPrompt || '';
    }
    
    if (this.state.mode === 'image') {
      // Get size format based on model (some models use 'x' instead of '*')
      const sizeFormat = model.sizeFormat || '*';
      payload.size = this.aspectRatioToSize(this.state.tools.aspectRatio, sizeFormat);
      
      // Add image count for multiple image generation
      payload.imagesPerModel = this.state.tools.imageCount;
      
      // Determine generation mode based on model and uploaded images
      if (model.category === 'face' || model.requiresTwoImages) {
        payload.generationMode = 'face';
      } else if (model.requiresImage || (model.supportsImg2Img && this.state.tools.baseImage)) {
        payload.generationMode = 'img2img';
      } else {
        payload.generationMode = 'txt2img';
      }
      
      if (this.state.tools.style) payload.style = this.state.tools.style;
      if (this.state.tools.negativePrompt) payload.negativePrompt = this.state.tools.negativePrompt;
      
      // Handle image uploads based on model requirements
      // Note: Both image_base64 and image_file are provided for compatibility with different models
      // Some models use image_base64, others use image_file - the backend handles this
      if (this.state.tools.baseImage) {
        payload.image_base64 = this.state.tools.baseImage;
        payload.image_file = this.state.tools.baseImage;
      }
      
      // Face image handling - use character's face if available, otherwise use uploaded face
      const faceImageToUse = this.state.tools.faceImage || 
        (this.state.selectedCharacter?.faceImageUrl ? this.state.selectedCharacter.faceImageUrl : 
         this.state.selectedCharacter?.chatImageUrl ? this.state.selectedCharacter.chatImageUrl : null);
      if (faceImageToUse) {
        payload.face_image_file = faceImageToUse;
      }
      
      if (this.state.tools.targetImage) {
        payload.image_file = this.state.tools.targetImage;
      }
    } else {
      // Video mode payload
      payload.modelId = model.id;
      payload.duration = this.state.tools.duration;
      payload.videoMode = model.category || 'i2v';
      
      if (this.state.tools.baseImage) {
        payload.baseImageUrl = this.state.tools.baseImage;
      }
      
      // Face image handling - use character's face if available, otherwise use uploaded face
      const faceImageToUse = this.state.tools.faceImage || 
        (this.state.selectedCharacter?.faceImageUrl ? this.state.selectedCharacter.faceImageUrl : 
         this.state.selectedCharacter?.chatImageUrl ? this.state.selectedCharacter.chatImageUrl : null);
      if (faceImageToUse) {
        payload.faceImageFile = faceImageToUse;
      }
      
      if (this.state.tools.baseVideo) {
        payload.videoFile = this.state.tools.baseVideo;
      }
    }
    
    console.log('[GenerationDashboard] Built payload:', payload);
    return payload;
  }
  
  /**
   * Convert aspect ratio to size string
   * @param {string} ratio - Aspect ratio like '1:1', '16:9', etc.
   * @param {string} separator - Size separator ('*' or 'x')
   * @returns {string} Size string like '1024*1024' or '1024x1024'
   */
  aspectRatioToSize(ratio, separator = '*') {
    const sizeMap = {
      '1:1': [1024, 1024],
      '16:9': [1280, 720],
      '9:16': [720, 1280],
      '4:3': [1024, 768],
      '3:4': [768, 1024]
    };
    const [width, height] = sizeMap[ratio] || [1024, 1024];
    return `${width}${separator}${height}`;
  }
  
  createPendingResult(prompt) {
    const selectedModel = this.state.selectedModel;
    
    // For custom SD models, get the actual model filename
    let sdModelName = null;
    if (selectedModel?.isCustom || selectedModel?.isSDModel) {
      sdModelName = this.getSDModelName(selectedModel);
    }
    
    const result = {
      id: Date.now().toString(),
      taskId: null,
      taskIds: [],           // Track all task IDs for multi-image generation
      prompt,
      status: 'pending',
      mode: this.state.mode,
      model: selectedModel?.name || 'Unknown',
      modelId: selectedModel?.id || null,           // Store the model ID for character creation
      sdModelName: sdModelName,                      // Store SD model filename for custom models
      isCustomModel: selectedModel?.isCustom || false,
      isSDModel: selectedModel?.isSDModel || false,
      createdAt: new Date().toISOString(),
      mediaUrl: null,
      mediaUrls: [],         // Array of all image URLs for carousel
      mediaItems: [],        // Array of {url, nsfw} objects for NSFW handling
      expectedImageCount: 1, // How many tasks/images to expect
      completedTaskCount: 0  // How many tasks have completed
    };
    
    this.state.results.unshift(result);
    return result;
  }
  
  addResultToFeed(result) {
    // Hide empty state
    if (this.elements.emptyState) {
      this.elements.emptyState.style.display = 'none';
    }
    
    const card = this.createResultCard(result);
    
    if (this.elements.contentInner) {
      // Insert at the beginning
      if (this.elements.contentInner.firstChild && this.elements.contentInner.firstChild !== this.elements.emptyState) {
        this.elements.contentInner.insertBefore(card, this.elements.contentInner.firstChild);
      } else {
        this.elements.contentInner.appendChild(card);
      }
    }
    
    // Scroll to top to show new result
    if (this.elements.mainContent) {
      this.elements.mainContent.scrollTop = 0;
    }
  }
  
  createResultCard(result) {
    const card = document.createElement('div');
    card.className = `gen-result-card ${result.status === 'pending' ? 'generating' : ''}`;
    card.id = `result-${result.id}`;
    
    const isImage = result.mode === 'image';
    
    // Check if we have multiple images for carousel
    const hasMultipleImages = result.mediaUrls && result.mediaUrls.length > 1;
    const imageCount = result.mediaUrls?.length || (result.mediaUrl ? 1 : 0);
    const expectedCount = result.expectedImageCount || 1;
    const completedCount = result.completedTaskCount || 0;
    
    // Debug logging for carousel display
    console.log(`[GenerationDashboard] 🎨 createResultCard for ${result.id}:`, {
      hasMultipleImages,
      imageCount,
      expectedCount,
      completedCount,
      status: result.status
    });
    
    // Build media content - carousel if multiple images, single if one
    let mediaContent = '';
    if (result.status === 'pending') {
      // Show progress if expecting multiple images
      const progressText = expectedCount > 1 
        ? `Generating ${imageCount}/${expectedCount} images...`
        : 'Generating...';
      
      // If we have some images already, show a partial carousel with loading indicator
      if (imageCount > 0 && isImage) {
        const mediaItems = result.mediaItems || result.mediaUrls.map(url => ({ url, nsfw: false }));
        mediaContent = `
          <div class="gen-carousel gen-carousel-loading" data-result-id="${result.id}">
            <div class="gen-carousel-inner">
              ${mediaItems.map((item, idx) => {
                const url = typeof item === 'string' ? item : item.url;
                const isNsfw = typeof item === 'object' ? item.nsfw : false;
                return this.generateImageSlideHtml(url, isNsfw, idx, result.id);
              }).join('')}
            </div>
            <div class="gen-carousel-controls">
              <button class="gen-carousel-btn prev" onclick="genDashboard.carouselPrev('${result.id}')" ${imageCount <= 1 ? 'disabled' : ''}>
                <i class="bi bi-chevron-left"></i>
              </button>
              <span class="gen-carousel-counter">${imageCount > 0 ? '1' : '0'} / ${expectedCount}</span>
              <button class="gen-carousel-btn next" onclick="genDashboard.carouselNext('${result.id}')" ${imageCount <= 1 ? 'disabled' : ''}>
                <i class="bi bi-chevron-right"></i>
              </button>
            </div>
            <div class="gen-carousel-loading-overlay">
              <div class="spinner"></div>
              <span>${progressText}</span>
            </div>
          </div>
        `;
      } else {
        mediaContent = `
          <div class="loading-indicator">
            <div class="spinner"></div>
            <span>${progressText}</span>
          </div>
        `;
      }
    } else if (hasMultipleImages && isImage) {
      // Carousel for multiple images
      console.log(`[GenerationDashboard] 🎠 Creating carousel with ${result.mediaUrls.length} images`);
      const mediaItems = result.mediaItems || result.mediaUrls.map(url => ({ url, nsfw: false }));
      mediaContent = `
        <div class="gen-carousel" data-result-id="${result.id}">
          <div class="gen-carousel-inner">
            ${mediaItems.map((item, idx) => {
              const url = typeof item === 'string' ? item : item.url;
              const isNsfw = typeof item === 'object' ? item.nsfw : false;
              return this.generateImageSlideHtml(url, isNsfw, idx, result.id);
            }).join('')}
          </div>
          <div class="gen-carousel-controls">
            <button class="gen-carousel-btn prev" onclick="genDashboard.carouselPrev('${result.id}')" ${result.mediaUrls.length <= 1 ? 'disabled' : ''}>
              <i class="bi bi-chevron-left"></i>
            </button>
            <span class="gen-carousel-counter">1 / ${result.mediaUrls.length}</span>
            <button class="gen-carousel-btn next" onclick="genDashboard.carouselNext('${result.id}')" ${result.mediaUrls.length <= 1 ? 'disabled' : ''}>
              <i class="bi bi-chevron-right"></i>
            </button>
          </div>
          <div class="gen-carousel-dots">
            ${result.mediaUrls.map((_, idx) => `
              <span class="gen-carousel-dot ${idx === 0 ? 'active' : ''}" data-index="${idx}" onclick="genDashboard.carouselGoTo('${result.id}', ${idx})"></span>
            `).join('')}
          </div>
        </div>
      `;
    } else if (result.mediaUrl) {
      // Single image or video
      const firstItem = result.mediaItems?.[0];
      const isNsfw = firstItem?.nsfw || false;
      mediaContent = isImage
        ? this.generateSingleImageHtml(result.mediaUrl, isNsfw, result.id)
        : `<video src="${result.mediaUrl}" preload="metadata" muted loop></video>`;
    } else {
      // Failed state
      mediaContent = `
        <div class="loading-indicator">
          <i class="bi bi-exclamation-triangle" style="font-size: 32px; color: #f87171;"></i>
          <span>Generation failed</span>
        </div>
      `;
    }
    
    card.innerHTML = `
      <div class="gen-result-media ${result.status === 'pending' ? 'loading' : ''}" data-result-id="${result.id}">
        ${mediaContent}
      </div>
      <div class="gen-result-footer">
        <div class="gen-result-info">
          <div class="prompt-text">${this.escapeHtml(result.prompt)}</div>
          <div class="meta">
            <span class="gen-status-badge ${result.status}">${this.getStatusLabel(result.status)}</span>
            <span>${result.model}</span>
            ${imageCount > 1 ? `<span class="image-count-badge"><i class="bi bi-images"></i> ${imageCount}</span>` : ''}
            <span>${this.formatTimeAgo(result.createdAt)}</span>
          </div>
        </div>
        <div class="gen-result-actions">
          ${result.status === 'completed' ? `
            <button class="gen-action-btn" onclick="genDashboard.openPreview('${result.id}')" title="View">
              <i class="bi bi-eye"></i>
            </button>
            <button class="gen-action-btn" onclick="genDashboard.downloadResult('${result.id}')" title="Download">
              <i class="bi bi-download"></i>
            </button>
            <button class="gen-action-btn" onclick="genDashboard.reusePrompt('${result.id}')" title="Reuse">
              <i class="bi bi-arrow-repeat"></i>
            </button>
            ${this.state.selectedCharacterId ? `
              <button class="gen-action-btn gen-save-post-btn" onclick="genDashboard.saveAsPost('${result.id}')" title="Save as Post">
                <i class="bi bi-bookmark-plus"></i>
              </button>
            ` : ''}
          ` : ''}
        </div>
      </div>
    `;
    
    // Add click handler for media preview (not on carousel controls)
    const media = card.querySelector('.gen-result-media');
    if (media && result.status === 'completed' && !hasMultipleImages) {
      media.addEventListener('click', () => this.openPreview(result.id));
    }
    
    // For carousel, add click on images only (exclude NSFW blurred images)
    if (hasMultipleImages) {
      const slides = card.querySelectorAll('.gen-carousel-slide img:not(.gen-nsfw-blurred)');
      slides.forEach(img => {
        img.addEventListener('click', () => this.openPreview(result.id));
      });
    }

    // Fetch blurred versions for NSFW images (for non-premium users)
    if (!this.isPremium()) {
      const nsfwImages = card.querySelectorAll('.gen-nsfw-blurred');
      nsfwImages.forEach(img => {
        const originalUrl = img.dataset.originalUrl;
        if (originalUrl) {
          this.fetchBlurredImageForNsfw(img, originalUrl);
        }
      });
    }

    return card;
  }
  
  /**
   * Carousel navigation - go to previous slide
   */
  carouselPrev(resultId) {
    const carousel = document.querySelector(`#result-${resultId} .gen-carousel`);
    if (!carousel) return;
    
    const slides = carousel.querySelectorAll('.gen-carousel-slide');
    const dots = carousel.querySelectorAll('.gen-carousel-dot');
    const counter = carousel.querySelector('.gen-carousel-counter');
    
    let currentIndex = Array.from(slides).findIndex(s => s.classList.contains('active'));
    currentIndex = (currentIndex - 1 + slides.length) % slides.length;
    
    slides.forEach((s, i) => s.classList.toggle('active', i === currentIndex));
    dots.forEach((d, i) => d.classList.toggle('active', i === currentIndex));
    if (counter) counter.textContent = `${currentIndex + 1} / ${slides.length}`;
    
    console.log(`[GenerationDashboard] 🎠 Carousel prev: now showing image ${currentIndex + 1}/${slides.length}`);
  }
  
  /**
   * Carousel navigation - go to next slide
   */
  carouselNext(resultId) {
    const carousel = document.querySelector(`#result-${resultId} .gen-carousel`);
    if (!carousel) return;
    
    const slides = carousel.querySelectorAll('.gen-carousel-slide');
    const dots = carousel.querySelectorAll('.gen-carousel-dot');
    const counter = carousel.querySelector('.gen-carousel-counter');
    
    let currentIndex = Array.from(slides).findIndex(s => s.classList.contains('active'));
    currentIndex = (currentIndex + 1) % slides.length;
    
    slides.forEach((s, i) => s.classList.toggle('active', i === currentIndex));
    dots.forEach((d, i) => d.classList.toggle('active', i === currentIndex));
    if (counter) counter.textContent = `${currentIndex + 1} / ${slides.length}`;
    
    console.log(`[GenerationDashboard] 🎠 Carousel next: now showing image ${currentIndex + 1}/${slides.length}`);
  }
  
  /**
   * Carousel navigation - go to specific slide
   */
  carouselGoTo(resultId, index) {
    const carousel = document.querySelector(`#result-${resultId} .gen-carousel`);
    if (!carousel) return;
    
    const slides = carousel.querySelectorAll('.gen-carousel-slide');
    const dots = carousel.querySelectorAll('.gen-carousel-dot');
    const counter = carousel.querySelector('.gen-carousel-counter');
    
    slides.forEach((s, i) => s.classList.toggle('active', i === index));
    dots.forEach((d, i) => d.classList.toggle('active', i === index));
    if (counter) counter.textContent = `${index + 1} / ${slides.length}`;
    
    console.log(`[GenerationDashboard] 🎠 Carousel goTo: now showing image ${index + 1}/${slides.length}`);
  }
  
  /**
   * Get current carousel index for a result
   */
  getCurrentCarouselIndex(resultId) {
    const carousel = document.querySelector(`#result-${resultId} .gen-carousel`);
    if (!carousel) return 0;
    
    const slides = carousel.querySelectorAll('.gen-carousel-slide');
    return Array.from(slides).findIndex(s => s.classList.contains('active')) || 0;
  }
  
  updateResultWithData(resultId, data) {
    const result = this.state.results.find(r => r.id === resultId);
    if (!result) return;

    result.status = data.status || 'completed';
    result.mediaUrl = data.imageUrl || data.videoUrl || data.url;

    // Store all image URLs for carousel support
    result.mediaUrls = data.imageUrls || (result.mediaUrl ? [result.mediaUrl] : []);

    // Also update mediaItems with NSFW info if available
    if (data.images && Array.isArray(data.images)) {
      result.mediaItems = data.images.map(img => ({
        url: img?.imageUrl || img?.image_url || img?.url || img,
        nsfw: img?.nsfw || false
      }));
    } else {
      // Create mediaItems from mediaUrls if not provided
      result.mediaItems = result.mediaUrls.map(url => ({ url, nsfw: false }));
    }

    console.log('[GenerationDashboard] 📊 updateResultWithData:', {
      resultId,
      status: result.status,
      mediaUrl: result.mediaUrl,
      mediaUrlsCount: result.mediaUrls?.length || 0,
      mediaUrls: result.mediaUrls
    });

    // Log for debugging carousel display issue
    console.log(`[GenerationDashboard] 📊 IMAGES RECEIVED: ${result.mediaUrls?.length || 0}`);
    console.log(`[GenerationDashboard] 📊 IMAGES TO DISPLAY: ${result.mediaUrls?.length || (result.mediaUrl ? 1 : 0)}`);
    
    // Update card in DOM
    const card = document.getElementById(`result-${resultId}`);
    if (card) {
      const newCard = this.createResultCard(result);
      card.replaceWith(newCard);
    }
    
    // Save to localStorage
    this.saveResults();
  }
  
  // ============================================================================
  // TASK POLLING
  // ============================================================================
  
  startPollingTask(result) {
    const taskId = result.taskId;
    if (!taskId) {
      console.log('[GenerationDashboard] startPollingTask: No taskId provided');
      return;
    }
    
    // Skip polling for sync tasks (they already have results)
    if (taskId.startsWith('sync-')) {
      console.log('[GenerationDashboard] Skipping poll for sync task:', taskId);
      return;
    }
    
    console.log('[GenerationDashboard] Starting poll for task:', taskId);
    
    const pollEndpoint = this.state.mode === 'image'
      ? '/dashboard/image/status'
      : '/dashboard/video/status';
    
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${pollEndpoint}/${taskId}`);
        const data = await response.json();
        
        console.log('[GenerationDashboard] 📡 Poll response for', taskId, '- status:', data.status);
        
        if (data.status === 'completed' || data.status === 'TASK_STATUS_SUCCEED') {
          clearInterval(interval);
          this.pollIntervals.delete(taskId);
          
          // Extract ALL image URLs - backend returns images array with imageUrl property
          const rawImages = data.images || [];
          console.log('[GenerationDashboard] 🖼️ Async task completed with', rawImages.length, 'image(s)');
          console.log('[GenerationDashboard] 🖼️ Raw images data:', JSON.stringify(rawImages, null, 2));
          
          const imageUrls = rawImages.map((img, idx) => {
            const url = img?.imageUrl || img?.image_url || img?.url || (typeof img === 'string' ? img : null);
            console.log(`[GenerationDashboard] 🖼️ Async Image ${idx + 1} URL:`, url ? url.substring(0, 80) + '...' : 'NOT FOUND');
            return url;
          }).filter(url => url);
          
          const imageUrl = data.imageUrl || imageUrls[0];
          const videoUrl = data.videoUrl || data.videos?.[0]?.videoUrl || data.videos?.[0]?.url;
          
          console.log('[GenerationDashboard] ✅ Task completed - Total valid URLs:', imageUrls.length);
          console.log('[GenerationDashboard] ✅ Primary imageUrl:', imageUrl ? imageUrl.substring(0, 80) + '...' : 'NONE');

          this.updateResultWithData(result.id, {
            status: 'completed',
            imageUrl: imageUrl,
            imageUrls: imageUrls.length > 0 ? imageUrls : (imageUrl ? [imageUrl] : []),
            images: rawImages, // Pass raw images with NSFW flags
            videoUrl: videoUrl
          });
        } else if (data.status === 'failed' || data.status === 'TASK_STATUS_FAILED') {
          clearInterval(interval);
          this.pollIntervals.delete(taskId);
          console.log('[GenerationDashboard] ❌ Async task failed:', data.error || 'Unknown error');
          this.updateResultWithData(result.id, { status: 'failed' });
        } else {
          console.log('[GenerationDashboard] ⏳ Task still processing, progress:', data.progress || 'unknown');
        }
      } catch (error) {
        console.error('[GenerationDashboard] ❌ Polling error:', error);
      }
    }, 5000); // Poll every 5 seconds
    
    this.pollIntervals.set(taskId, interval);
  }
  
  // ============================================================================
  // FILE UPLOADS
  // ============================================================================
  
  /**
   * Get the tool button selector from a state type
   * @param {string} type - State type like 'baseImage', 'faceImage', 'baseVideo'
   * @returns {string} - Tool button data-tool value
   */
  getToolButtonSelector(type) {
    const typeToToolMap = {
      'baseImage': 'upload-base',
      'faceImage': 'upload-face',
      'targetImage': 'upload-target',
      'baseVideo': 'upload-video'
    };
    return typeToToolMap[type] || null;
  }
  
  handleToolClick(e) {
    const btn = e.currentTarget;
    const tool = btn.dataset.tool;
    
    // Check if button is disabled
    if (btn.disabled || btn.classList.contains('gen-disabled')) {
      this.showNotification('This option is not available for the selected model', 'info');
      return;
    }
    
    switch (tool) {
      case 'upload-base':
        this.elements.baseImageInput?.click();
        break;
      case 'upload-face':
        this.elements.faceImageInput?.click();
        break;
      case 'upload-target':
        this.elements.targetImageInput?.click();
        break;
      case 'upload-video':
        this.elements.baseVideoInput?.click();
        break;
      case 'aspect-ratio':
      case 'duration':
      case 'image-count':
      case 'settings':
        this.openSettingsSheet(tool);
        break;
    }
  }
  
  async handleFileUpload(file, type) {
    if (!file) return;
    
    const maxSize = type === 'baseVideo' ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      this.showNotification(`File too large. Max size: ${maxSize / (1024 * 1024)}MB`, 'error');
      return;
    }
    
    try {
      const dataUrl = await this.fileToDataUrl(file);
      this.state.tools[type] = dataUrl;
      
      // Update tool button to show it has content
      const toolSelector = this.getToolButtonSelector(type);
      if (toolSelector) {
        const toolBtn = document.querySelector(`[data-tool="${toolSelector}"]`);
        if (toolBtn) {
          toolBtn.classList.add('has-content');
        }
      }
      
      // Update the upload area with a preview of the uploaded image
      this.updateUploadAreaPreview(type, dataUrl);
      
      this.showNotification(`${type === 'baseImage' ? 'Base image' : type === 'faceImage' ? 'Face image' : type === 'targetImage' ? 'Target image' : 'File'} uploaded`, 'success');
    } catch (error) {
      console.error('[GenerationDashboard] File upload error:', error);
      this.showNotification('Failed to upload file', 'error');
    }
  }
  
  /**
   * Update the upload area with an image preview
   */
  updateUploadAreaPreview(type, dataUrl) {
    const areaMap = {
      'baseImage': 'baseImageUploadArea',
      'faceImage': 'faceImageUploadArea',
      'targetImage': 'targetImageUploadArea'
    };
    
    const areaId = areaMap[type];
    if (!areaId) return;
    
    const uploadArea = document.getElementById(areaId);
    if (!uploadArea) return;
    
    if (type === 'faceImage') {
      this.updateFaceUploadUI(dataUrl);
      return;
    }
    
    uploadArea.classList.add('has-image');
    uploadArea.innerHTML = `
      <button class="upload-clear-btn" onclick="event.stopPropagation(); genDashboard.clearUploadArea('${type}');" title="Remove">
        <i class="bi bi-x"></i>
      </button>
      <img src="${dataUrl}" class="upload-preview" alt="${type}">
    `;
  }
  
  /**
   * Clear an upload area and reset its state
   */
  clearUploadArea(type) {
    this.state.tools[type] = null;
    
    const areaMap = {
      'baseImage': { id: 'baseImageUploadArea', icon: 'bi-image', text: 'Drop or click to upload' },
      'faceImage': { id: 'faceImageUploadArea', icon: 'bi-person-bounding-box', text: 'Drop or click to upload' },
      'targetImage': { id: 'targetImageUploadArea', icon: 'bi-image', text: 'Drop or click to upload' }
    };
    
    const config = areaMap[type];
    if (!config) return;
    
    const uploadArea = document.getElementById(config.id);
    if (uploadArea) {
      uploadArea.classList.remove('has-image');
      uploadArea.innerHTML = `
        <i class="bi ${config.icon} upload-area-icon"></i>
        <span class="upload-area-text">${config.text}</span>
      `;
    }
    
    // Update tool button
    const toolSelector = this.getToolButtonSelector(type);
    if (toolSelector) {
      const toolBtn = document.querySelector(`[data-tool="${toolSelector}"]`);
      if (toolBtn) {
        toolBtn.classList.remove('has-content');
      }
    }
    
    this.showNotification('Image removed', 'info');
  }
  
  fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  
  clearUpload(type) {
    this.state.tools[type] = null;
    
    const toolSelector = this.getToolButtonSelector(type);
    if (toolSelector) {
      const toolBtn = document.querySelector(`[data-tool="${toolSelector}"]`);
      if (toolBtn) {
        toolBtn.classList.remove('has-content');
      }
    }
  }
  
  // ============================================================================
  // SETTINGS
  // ============================================================================
  
  openSettingsSheet(settingType) {
    this.showOverlay('settingsSheet');
    this.renderSettingsContent(settingType);
  }
  
  renderSettingsContent(settingType) {
    const container = document.querySelector('#settingsSheet .gen-bottom-sheet-body');
    if (!container) return;
    
    let html = '';
    
    // Aspect Ratio setting
    if (settingType === 'aspect-ratio' || settingType === 'settings') {
      const aspectRatios = ['1:1', '16:9', '9:16', '4:3', '3:4'];
      const premium = this.isPremium();
      html += `
        <div class="gen-settings-group">
          <label>Aspect Ratio</label>
          <div class="gen-segmented-control">
            ${aspectRatios.map(ratio => {
              const isFreeRatio = ratio === '1:1';
              const locked = !isFreeRatio && !premium;
              return `
              <button class="gen-segmented-btn ${this.state.tools.aspectRatio === ratio ? 'active' : ''} ${locked ? 'gen-premium-locked' : ''}"
                      data-value="${ratio}" data-setting="aspectRatio" ${locked ? 'data-premium="true"' : ''}>
                ${ratio}${locked ? ' <i class="bi bi-gem" style="font-size:0.7em;"></i>' : ''}
              </button>
            `}).join('')}
          </div>
          ${!premium ? '<div class="form-text"><i class="bi bi-gem"></i> More aspect ratios available with Premium</div>' : ''}
        </div>
      `;
    }

    // Image Count setting (only for image mode)
    if ((settingType === 'image-count' || settingType === 'settings') && this.state.mode === 'image') {
      const counts = [1, 2, 3, 4];
      const premium = this.isPremium();
      html += `
        <div class="gen-settings-group">
          <label>Number of Images</label>
          <div class="gen-segmented-control">
            ${counts.map(count => {
              const isFreeCount = count === 1;
              const locked = !isFreeCount && !premium;
              return `
              <button class="gen-segmented-btn ${this.state.tools.imageCount === count ? 'active' : ''} ${locked ? 'gen-premium-locked' : ''}"
                      data-value="${count}" data-setting="imageCount" ${locked ? 'data-premium="true"' : ''}>
                ${count}x${locked ? ' <i class="bi bi-gem" style="font-size:0.7em;"></i>' : ''}
              </button>
            `}).join('')}
          </div>
          <div class="form-text">Cost: ${this.state.imageCostPerUnit} points per image</div>
          ${!premium ? '<div class="form-text"><i class="bi bi-gem"></i> Generate multiple images with Premium</div>' : ''}
        </div>
      `;
    }
    
    // Duration setting (only for video mode)
    if ((settingType === 'duration' || settingType === 'settings') && this.state.mode === 'video') {
      const durations = ['3', '5', '10'];
      html += `
        <div class="gen-settings-group">
          <label>Duration (seconds)</label>
          <div class="gen-segmented-control">
            ${durations.map(d => `
              <button class="gen-segmented-btn ${this.state.tools.duration === d ? 'active' : ''}"
                      data-value="${d}" data-setting="duration">
                ${d}s
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }
    
    // Negative Prompt setting
    if (settingType === 'settings') {
      html += `
        <div class="gen-settings-group">
          <label>Negative Prompt</label>
          <textarea class="gen-settings-input" id="negativePromptInput" 
                    placeholder="Enter things to avoid..."
                    rows="3">${this.state.tools.negativePrompt || ''}</textarea>
          <div class="form-text">Describe what you don't want in the result</div>
        </div>
      `;
    }
    
    container.innerHTML = html;
    
    // Bind events for segmented buttons
    container.querySelectorAll('.gen-segmented-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Block premium-locked settings
        if (btn.dataset.premium === 'true') {
          this.showNotification('This option requires a premium subscription.', 'warning');
          if (typeof loadPlanPage === 'function') loadPlanPage();
          return;
        }

        const setting = btn.dataset.setting;
        let value = btn.dataset.value;
        
        // Parse numeric values
        if (setting === 'imageCount') {
          value = parseInt(value, 10);
        }
        
        this.state.tools[setting] = value;
        
        // Update UI
        btn.parentElement.querySelectorAll('.gen-segmented-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update cost display live when image count changes
        if (setting === 'imageCount') {
          this.updateCostDisplay();
          this.updateImageCountButton();
        }
        
        // Update aspect ratio button when changed
        if (setting === 'aspectRatio') {
          this.updateAspectRatioButton();
        }
      });
    });
    
    const negativeInput = container.querySelector('#negativePromptInput');
    if (negativeInput) {
      negativeInput.addEventListener('change', (e) => {
        this.state.tools.negativePrompt = e.target.value;
      });
    }
  }
  
  // ============================================================================
  // PREVIEW
  // ============================================================================
  
  openPreview(resultId) {
    const result = this.state.results.find(r => r.id === resultId);
    if (!result || !result.mediaUrl) return;
    
    const overlay = this.elements.previewOverlay;
    if (!overlay) return;
    
    const content = overlay.querySelector('.gen-preview-content');
    if (!content) return;
    
    // Store current preview ID for action buttons in template
    this._currentPreviewId = resultId;
    this._currentPreviewResult = result;
    this._previewImageIndex = this.getCurrentCarouselIndex(resultId) || 0;
    
    const isImage = result.mode === 'image';
    const hasMultipleImages = result.mediaUrls && result.mediaUrls.length > 1;
    
    console.log(`[GenerationDashboard] 🔍 openPreview for ${resultId}:`, {
      hasMultipleImages,
      imageCount: result.mediaUrls?.length || 1,
      currentIndex: this._previewImageIndex
    });
    
    if (hasMultipleImages && isImage) {
      // Show carousel in preview
      const currentUrl = result.mediaUrls[this._previewImageIndex] || result.mediaUrl;
      content.innerHTML = `
        <div class="gen-preview-carousel">
          <img src="${currentUrl}" alt="Preview">
          <div class="gen-preview-nav">
            <button class="gen-preview-nav-btn prev" onclick="genDashboard.previewPrev()">
              <i class="bi bi-chevron-left"></i>
            </button>
            <span class="gen-preview-counter">${this._previewImageIndex + 1} / ${result.mediaUrls.length}</span>
            <button class="gen-preview-nav-btn next" onclick="genDashboard.previewNext()">
              <i class="bi bi-chevron-right"></i>
            </button>
          </div>
        </div>
      `;
    } else {
      content.innerHTML = isImage
        ? `<img src="${result.mediaUrl}" alt="Preview">`
        : `<video src="${result.mediaUrl}" controls autoplay></video>`;
    }
    
    // Update footer with appropriate action buttons
    this.updatePreviewFooter(result);
    
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Store current scroll position
    this._scrollPosition = this.elements.mainContent?.scrollTop;
    
    // Bind close button
    const closeBtn = overlay.querySelector('.gen-preview-close');
    if (closeBtn) {
      closeBtn.onclick = () => this.closePreview();
    }
  }
  
  /**
   * Navigate to previous image in preview carousel
   */
  previewPrev() {
    const result = this._currentPreviewResult;
    if (!result || !result.mediaUrls || result.mediaUrls.length <= 1) return;
    
    this._previewImageIndex = (this._previewImageIndex - 1 + result.mediaUrls.length) % result.mediaUrls.length;
    this.updatePreviewImage();
  }
  
  /**
   * Navigate to next image in preview carousel
   */
  previewNext() {
    const result = this._currentPreviewResult;
    if (!result || !result.mediaUrls || result.mediaUrls.length <= 1) return;
    
    this._previewImageIndex = (this._previewImageIndex + 1) % result.mediaUrls.length;
    this.updatePreviewImage();
  }
  
  /**
   * Update the preview image based on current index
   */
  updatePreviewImage() {
    const result = this._currentPreviewResult;
    if (!result || !result.mediaUrls) return;
    
    const content = this.elements.previewOverlay?.querySelector('.gen-preview-content');
    if (!content) return;
    
    const img = content.querySelector('img');
    const counter = content.querySelector('.gen-preview-counter');
    
    if (img) {
      img.src = result.mediaUrls[this._previewImageIndex];
    }
    if (counter) {
      counter.textContent = `${this._previewImageIndex + 1} / ${result.mediaUrls.length}`;
    }
    
    console.log(`[GenerationDashboard] 🔍 Preview showing image ${this._previewImageIndex + 1}/${result.mediaUrls.length}`);
  }
  
  /**
   * Update preview footer with action buttons based on result type
   */
  updatePreviewFooter(result) {
    const footer = this.elements.previewOverlay?.querySelector('.gen-preview-footer');
    if (!footer) return;
    
    const isImage = result.mode === 'image';
    
    footer.innerHTML = `
      <button class="gen-preview-action" onclick="genDashboard.downloadResult('${result.id}')">
        <i class="bi bi-download"></i>
        <span>Download</span>
      </button>
      <button class="gen-preview-action" onclick="genDashboard.reusePrompt('${result.id}'); genDashboard.closePreview();">
        <i class="bi bi-arrow-repeat"></i>
        <span>Reuse</span>
      </button>
      ${isImage ? `
        <button class="gen-preview-action ${!this.isPremium() ? 'gen-premium-locked' : ''}" onclick="${this.isPremium() ? `genDashboard.openCreateCharacterModal('${result.id}')` : `genDashboard.showPremiumGate('Character creation')`}">
          <i class="bi bi-person-plus"></i>
          <span>Character${!this.isPremium() ? ' <i class="bi bi-gem" style="font-size:0.75em;color:#a78bfa;"></i>' : ''}</span>
        </button>
        ${this.state.selectedCharacterId ? `
          <button class="gen-preview-action gen-save-post-action" onclick="genDashboard.saveAsPost('${result.id}')">
            <i class="bi bi-bookmark-plus"></i>
            <span>Save as Post</span>
          </button>
        ` : `
          <button class="gen-preview-action" onclick="genDashboard.createPost('${result.id}')">
            <i class="bi bi-share"></i>
            <span>Post</span>
          </button>
        `}
      ` : ''}
    `;
  }
  
  closePreview() {
    const overlay = this.elements.previewOverlay;
    if (!overlay) return;
    
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    
    // Stop video if playing
    const video = overlay.querySelector('video');
    if (video) video.pause();
    
    // Restore scroll position
    if (this.elements.mainContent && this._scrollPosition !== undefined) {
      this.elements.mainContent.scrollTop = this._scrollPosition;
    }
  }
  
  // ============================================================================
  // RESULT ACTIONS
  // ============================================================================
  
  downloadResult(resultId) {
    const result = this.state.results.find(r => r.id === resultId);
    if (!result || !result.mediaUrl) return;
    
    // If in preview mode with multiple images, download the current one
    let downloadUrl = result.mediaUrl;
    let imageIndex = 0;
    
    if (result.mediaUrls && result.mediaUrls.length > 1 && this._currentPreviewResult?.id === resultId) {
      imageIndex = this._previewImageIndex || 0;
      downloadUrl = result.mediaUrls[imageIndex] || result.mediaUrl;
    }
    
    console.log(`[GenerationDashboard] 📥 Downloading image ${imageIndex + 1}:`, downloadUrl.substring(0, 80) + '...');
    
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `generation-${result.id}${result.mediaUrls?.length > 1 ? `-${imageIndex + 1}` : ''}.${result.mode === 'image' ? 'png' : 'mp4'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  
  reusePrompt(resultId) {
    const result = this.state.results.find(r => r.id === resultId);
    if (!result) return;
    
    if (this.elements.promptInput) {
      this.elements.promptInput.value = result.prompt;
      this.resizePromptInput();
      this.elements.promptInput.focus();
    }
  }
  
  /**
   * Save a generated image as a pending post for the selected character
   * @param {string} resultId - Result ID to save
   */
  async saveAsPost(resultId) {
    const result = this.state.results.find(r => r.id === resultId);
    if (!result) {
      this.showNotification('Result not found', 'error');
      return;
    }
    
    if (!this.state.selectedCharacterId) {
      this.showNotification('Please select a character first', 'error');
      return;
    }
    
    // Get the image URL - if in preview with multiple images, save the current one
    let imageUrl = result.mediaUrl;
    let imageIndex = 0;
    
    if (result.mediaUrls && result.mediaUrls.length > 1 && this._currentPreviewResult?.id === resultId) {
      imageIndex = this._previewImageIndex || 0;
      imageUrl = result.mediaUrls[imageIndex] || result.mediaUrl;
    }
    
    if (!imageUrl) {
      this.showNotification('No image to save', 'error');
      return;
    }
    
    try {
      const response = await fetch('/dashboard/image/save-as-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: this.state.selectedCharacterId,
          imageUrl: imageUrl,
          prompt: result.prompt,
          model: result.model,
          parameters: {
            aspectRatio: this.state.tools.aspectRatio,
            style: this.state.tools.style
          },
          nsfw: result.mediaItems?.[imageIndex]?.nsfw || false
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.showNotification('Saved as pending post! Manage it in Social Manager.', 'success');
      } else {
        throw new Error(data.error || 'Failed to save');
      }
    } catch (error) {
      console.error('[GenerationDashboard] Error saving as post:', error);
      this.showNotification(error.message || 'Failed to save as post', 'error');
    }
  }
  
  // ============================================================================
  // OVERLAYS
  // ============================================================================
  
  showOverlay(sheetId) {
    if (this.elements.overlayBackdrop) {
      this.elements.overlayBackdrop.classList.add('active');
    }
    
    const sheet = document.getElementById(sheetId);
    if (sheet) {
      sheet.classList.add('active');
    }
  }
  
  closeAllOverlays() {
    if (this.elements.overlayBackdrop) {
      this.elements.overlayBackdrop.classList.remove('active');
    }
    
    document.querySelectorAll('.gen-bottom-sheet').forEach(sheet => {
      sheet.classList.remove('active');
    });
    
    this.closePreview();
  }
  
  // ============================================================================
  // UI UPDATES
  // ============================================================================
  
  updateUI() {
    this.updateModelDisplay();
    this.updateToolsForMode();
    this.updateCostDisplay();
    this.updateSubmitButtonState();
    this.updateEmptyState();
  }
  
  updateGeneratingState(isGenerating) {
    if (this.elements.submitBtn) {
      this.elements.submitBtn.disabled = isGenerating;
      this.elements.submitBtn.innerHTML = isGenerating
        ? '<div class="spinner-border spinner-border-sm" role="status"></div>'
        : '<i class="bi bi-arrow-up"></i>';
    }
    
    if (this.elements.promptInput) {
      this.elements.promptInput.disabled = isGenerating;
    }
  }
  
  /**
   * Calculate total cost based on mode and image count
   */
  calculateTotalCost() {
    if (this.state.mode === 'image') {
      const imageCount = this.state.tools.imageCount || 1;
      return this.state.imageCostPerUnit * imageCount;
    }
    return this.state.videoCostPerUnit;
  }
  
  updateCostDisplay() {
    if (!this.elements.costDisplay) return;
    
    const totalCost = this.calculateTotalCost();
    const hasEnough = this.state.userPoints >= totalCost;
    
    this.elements.costDisplay.classList.toggle('insufficient', !hasEnough);
    
    const costValue = this.elements.costDisplay.querySelector('.cost-value');
    const costAmount = document.getElementById('costAmount');
    
    if (costValue) {
      // Show image count if more than 1
      const imageCount = this.state.tools.imageCount || 1;
      if (this.state.mode === 'image' && imageCount > 1) {
        costValue.innerHTML = `<i class="bi bi-coin"></i> <span id="costAmount">${totalCost}</span> points (${imageCount} images)`;
      } else {
        costValue.innerHTML = `<i class="bi bi-coin"></i> <span id="costAmount">${totalCost}</span> points`;
      }
    } else if (costAmount) {
      costAmount.textContent = totalCost;
    }
  }
  
  updateEmptyState() {
    if (!this.elements.emptyState) return;
    
    const icon = this.elements.emptyState.querySelector('.empty-icon i');
    const title = this.elements.emptyState.querySelector('h3');
    const desc = this.elements.emptyState.querySelector('p');
    
    if (this.state.mode === 'image') {
      if (icon) icon.className = 'bi bi-images';
      if (title) title.textContent = 'Ready to create images';
      if (desc) desc.textContent = 'Enter a prompt below to generate your first image';
    } else {
      if (icon) icon.className = 'bi bi-film';
      if (title) title.textContent = 'Ready to create videos';
      if (desc) desc.textContent = 'Enter a prompt or upload an image to generate your first video';
    }
    
    // Show/hide based on results
    const hasResults = this.state.results.length > 0;
    this.elements.emptyState.style.display = hasResults ? 'none' : 'flex';
  }
  
  hasEnoughPoints() {
    const cost = this.calculateTotalCost();
    return this.state.userPoints >= cost;
  }
  
  // ============================================================================
  // PERSISTENCE
  // ============================================================================
  
  loadStoredResults() {
    try {
      const stored = localStorage.getItem('gen_dashboard_results');
      if (stored) {
        const results = JSON.parse(stored);
        // Only load completed results
        this.state.results = results.filter(r => r.status === 'completed').slice(0, 20);
        
        // Render stored results
        this.state.results.forEach(result => {
          const card = this.createResultCard(result);
          if (this.elements.contentInner) {
            this.elements.contentInner.appendChild(card);
          }
        });
        
        this.updateEmptyState();
      }
    } catch (error) {
      console.error('[GenerationDashboard] Failed to load stored results:', error);
    }
  }
  
  saveResults() {
    try {
      // Only save completed results, limit to 20
      const toSave = this.state.results
        .filter(r => r.status === 'completed')
        .slice(0, 20);
      localStorage.setItem('gen_dashboard_results', JSON.stringify(toSave));
    } catch (error) {
      console.error('[GenerationDashboard] Failed to save results:', error);
    }
  }
  
  // ============================================================================
  // UTILITIES
  // ============================================================================
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
  
  getStatusLabel(status) {
    const labels = {
      pending: 'Generating...',
      completed: 'Complete',
      failed: 'Failed'
    };
    return labels[status] || status;
  }
  
  /**
   * Show premium gate notification and open the plan modal
   */
  showPremiumGate(featureName) {
    this.showNotification(`${featureName} is a premium feature.`, 'warning');
    if (typeof loadPlanPage === 'function') loadPlanPage();
  }

  showNotification(message, type = 'info') {
    // Use existing notification system if available
    if (typeof window.showNotification === 'function') {
      window.showNotification(message, type);
      return;
    }
    
    // Fallback: create toast
    const bgClass = type === 'error' ? 'bg-danger' : type === 'success' ? 'bg-success' : 'bg-info';
    
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white ${bgClass} border-0 position-fixed`;
    toast.style.cssText = 'bottom: 100px; left: 50%; transform: translateX(-50%); z-index: 1100;';
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="this.parentElement.parentElement.remove()"></button>
      </div>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
  }

  // ============================================================================
  // CHARACTER SELECTION METHODS
  // ============================================================================

  /**
   * Select a character for generation
   * @param {HTMLElement|null} element - The character option element or null to clear
   */
  selectCharacter(element) {
    if (!element) {
      // Clear character selection
      this.state.selectedCharacter = null;
      this.state.selectedCharacterId = null;
      this.state.tools.faceImage = null;
      
      // Reset face upload UI back to default
      this.clearFaceImageUI();
      
      // Update UI
      this.updateCharacterUI();
      this.closeCharacterDropdown();
      
      // Update URL without page reload
      const url = new URL(window.location);
      url.searchParams.delete('characterId');
      window.history.replaceState({}, '', url);
      
      this.showNotification('Character cleared', 'info');
      return;
    }
    
    const characterId = element.dataset.characterId;
    const characterName = element.dataset.characterName;
    const characterImage = element.dataset.characterImage;
    const characterFace = element.dataset.characterFace;
    const characterPrompt = element.dataset.characterPrompt;
    
    // Use face image if available, otherwise fallback to character thumbnail
    const faceImage = characterFace || characterImage;
    
    // Update state
    this.state.selectedCharacter = {
      _id: characterId,
      name: characterName,
      chatImageUrl: characterImage,
      faceImageUrl: faceImage,
      basePromptForImageGeneration: characterPrompt
    };
    this.state.selectedCharacterId = characterId;
    
    // Auto-set face image (use face if available, otherwise use thumbnail)
    if (faceImage) {
      this.state.tools.faceImage = faceImage;
      this.updateFaceUploadUI(faceImage);
    }
    
    // Update UI
    this.updateCharacterUI();
    this.closeCharacterDropdown();
    
    // Update URL without page reload
    const url = new URL(window.location);
    url.searchParams.set('characterId', characterId);
    window.history.replaceState({}, '', url);
    
    this.showNotification(`Selected: ${characterName}`, 'success');
  }

  /**
   * Update character-related UI elements
   */
  updateCharacterUI() {
    const selectorBtn = document.getElementById('characterSelectorBtn');
    const dropdown = document.getElementById('characterDropdown');
    
    if (selectorBtn) {
      if (this.state.selectedCharacter) {
        selectorBtn.classList.add('has-character');
        selectorBtn.innerHTML = `
          <img src="${this.state.selectedCharacter.chatImageUrl || '/img/avatar.png'}" alt="" class="character-selector-avatar">
          <span class="character-selector-text">${this.state.selectedCharacter.name}</span>
          <i class="bi bi-chevron-down"></i>
        `;
      } else {
        selectorBtn.classList.remove('has-character');
        selectorBtn.innerHTML = `
          <div class="character-selector-placeholder">
            <i class="bi bi-person"></i>
          </div>
          <span class="character-selector-text placeholder">No Character</span>
          <i class="bi bi-chevron-down"></i>
        `;
      }
    }
    
    // Update dropdown selected state
    if (dropdown) {
      dropdown.querySelectorAll('.character-option').forEach(opt => {
        // Remove old check icons
        const existingCheck = opt.querySelector('.bi-check-circle-fill');
        if (existingCheck) existingCheck.remove();
        
        if (opt.dataset.characterId === this.state.selectedCharacterId) {
          opt.classList.add('selected');
          // Add check icon
          const check = document.createElement('i');
          check.className = 'bi bi-check-circle-fill';
          check.style.cssText = 'color: var(--studio-primary); font-size: 16px; flex-shrink: 0;';
          opt.appendChild(check);
        } else {
          opt.classList.remove('selected');
        }
      });
    }
    
    // Update prompt meta area
    const promptMeta = document.querySelector('.prompt-meta');
    if (promptMeta && this.state.selectedCharacter) {
      let metaHtml = `
        <div class="cost-indicator">
          <i class="bi bi-coin"></i>
          <span id="costAmount">${this.calculateCost()}</span> points
        </div>
        <span style="color: var(--studio-primary-light, #a78bfa);">
          <i class="bi bi-person-check"></i> Posting to ${this.state.selectedCharacter.name}
        </span>
      `;
      promptMeta.innerHTML = metaHtml;
    } else if (promptMeta) {
      // Reset to default cost display
      promptMeta.innerHTML = `
        <div class="cost-indicator">
          <i class="bi bi-coin"></i>
          <span id="costAmount">${this.calculateCost()}</span> points
        </div>
      `;
    }
    
    // Update character info section in controls panel
    this.updateCharacterInfoSection();
    
    // Refresh result cards to show/hide "Save as Post" buttons
    this.refreshResultCards();
  }
  
  /**
   * Refresh all result cards to reflect current state (like character selection)
   */
  refreshResultCards() {
    this.state.results.forEach(result => {
      const card = document.getElementById(`result-${result.id}`);
      if (card && result.status === 'completed') {
        const newCard = this.createResultCard(result);
        card.replaceWith(newCard);
      }
    });
  }

  /**
   * Update the character info section in the controls panel
   */
  updateCharacterInfoSection() {
    let section = document.getElementById('characterSection');
    
    if (this.state.selectedCharacter) {
      if (!section) {
        // Create section if it doesn't exist
        const controls = document.getElementById('studioControls');
        if (controls) {
          section = document.createElement('div');
          section.id = 'characterSection';
          section.className = 'control-section';
          controls.insertBefore(section, controls.firstChild);
        }
      }
      
      if (section) {
        const char = this.state.selectedCharacter;
        const originalFace = this.userCharacters?.find(c => c._id === char._id)?.faceImageUrl;
        const faceLabel = originalFace 
          ? '<span class="character-info-badge">Face Set</span>' 
          : '<span class="character-info-badge" style="background:var(--studio-warning,#f59e0b);color:#000;">Using Thumbnail</span>';
        section.innerHTML = `
          <div class="control-section-header">
            <span class="control-section-title">Character</span>
            <button class="btn btn-sm btn-link text-muted p-0" onclick="genDashboard.clearCharacter()">
              <i class="bi bi-x"></i>
            </button>
          </div>
          <div class="character-info-card">
            <img src="${char.chatImageUrl || '/img/avatar.png'}" alt="" class="character-info-avatar">
            <div class="character-info-details">
              <div class="character-info-name">${char.name}</div>
              <div class="character-info-meta">
                ${faceLabel}
              </div>
            </div>
          </div>
        `;
      }
    } else if (section) {
      section.remove();
    }
  }

  /**
   * Update the face upload UI with an image
   */
  updateFaceUploadUI(imageUrl) {
    const uploadArea = document.getElementById('faceImageUploadArea');
    if (uploadArea) {
      uploadArea.classList.add('has-image');
      uploadArea.innerHTML = `
        <button class="upload-clear-btn" onclick="event.stopPropagation(); genDashboard.clearFaceImage();" title="Remove">
          <i class="bi bi-x"></i>
        </button>
        <img src="${imageUrl}" class="upload-preview" alt="Face image">
      `;
    }
  }

  /**
   * Clear the selected character
   */
  clearCharacter() {
    this.selectCharacter(null);
  }

  /**
   * Clear the face image (with notification)
   */
  clearFaceImage() {
    this.state.tools.faceImage = null;
    this.clearFaceImageUI();
    this.showNotification('Face image cleared', 'info');
  }
  
  /**
   * Reset face upload UI to default state (no notification)
   */
  clearFaceImageUI() {
    const uploadArea = document.getElementById('faceImageUploadArea');
    if (uploadArea) {
      uploadArea.classList.remove('has-image');
      uploadArea.innerHTML = `
        <i class="bi bi-person-bounding-box upload-area-icon"></i>
        <span class="upload-area-text">Drop or click to upload</span>
      `;
    }
    
    // Also update tool button
    const toolBtn = document.querySelector('[data-tool="upload-face"]');
    if (toolBtn) {
      toolBtn.classList.remove('has-content');
    }
  }

  /**
   * Close the character dropdown
   */
  closeCharacterDropdown() {
    const dropdown = document.getElementById('characterDropdown');
    const overlay = document.getElementById('studioOverlay');
    
    if (dropdown) dropdown.classList.remove('visible');
    if (overlay) overlay.classList.remove('visible');
  }

  /**
   * Toggle mobile controls panel
   */
  toggleMobileControls() {
    const controls = document.getElementById('studioControls');
    if (controls) {
      controls.classList.toggle('mobile-visible');
    }
  }

  /**
   * Get the prompt to use for generation, potentially enhanced with character prompt
   */
  getEnhancedPrompt(userPrompt) {
    // If a character with a base prompt is selected, combine them
    if (this.state.selectedCharacter?.basePromptForImageGeneration) {
      const charPrompt = this.state.selectedCharacter.basePromptForImageGeneration;
      // Combine character's base prompt with user's prompt
      return `${charPrompt}, ${userPrompt}`;
    }
    return userPrompt;
  }
  
  // ============================================================================
  // CHARACTER CREATION & POSTING
  // ============================================================================
  
  /**
   * Open create character modal for a result
   */
  openCreateCharacterModal(resultId) {
    const result = this.state.results.find(r => r.id === resultId);
    if (!result || !result.mediaUrl) {
      this.showNotification('No image available', 'error');
      return;
    }
    
    // Get the current image URL (for carousel, use the current preview index)
    let currentImageUrl = result.mediaUrl;
    if (result.mediaUrls && result.mediaUrls.length > 1 && this._currentPreviewResult?.id === resultId) {
      const imageIndex = this._previewImageIndex || 0;
      currentImageUrl = result.mediaUrls[imageIndex] || result.mediaUrl;
      console.log(`[GenerationDashboard] Creating character from carousel image ${imageIndex + 1}/${result.mediaUrls.length}`);
    }
    
    // Check if the create character modal exists on the page
    const modal = document.getElementById('createCharacterModal');
    if (modal) {
      // Use the existing modal system from admin-image-test.js
      // Set up the modal data
      const previewImg = document.getElementById('characterPreviewImage');
      const promptPreview = document.getElementById('characterPromptPreview');
      const nameInput = document.getElementById('characterNameInput');
      const personalityInput = document.getElementById('characterPersonalityInput');
      
      if (previewImg) previewImg.src = currentImageUrl;
      if (promptPreview) {
        const promptText = result.prompt.length > 200 
          ? result.prompt.substring(0, 200) + '...' 
          : result.prompt;
        promptPreview.textContent = promptText;
      }
      if (nameInput) nameInput.value = '';
      if (personalityInput) personalityInput.value = '';
      
      // Get the model info from the result (not the currently selected model)
      // This ensures we use the model that was actually used to generate the image
      let resultModelId = result.modelId;
      let resultModelName = result.model;
      let resultSdModelName = result.sdModelName;
      let resultIsCustomModel = result.isCustomModel || result.isSDModel;
      
      // Debug: log what we have in the result
      console.log('[GenerationDashboard] Result model info:', {
        modelId: resultModelId,
        model: resultModelName,
        sdModelName: resultSdModelName,
        isCustomModel: resultIsCustomModel,
        isSDModel: result.isSDModel
      });
      
      // For legacy results, try to detect if the model name is an SD model filename
      // SD model filenames typically end in .safetensors or .ckpt
      if (!resultSdModelName && resultModelName) {
        const modelNameLower = resultModelName.toLowerCase();
        if (modelNameLower.endsWith('.safetensors') || modelNameLower.endsWith('.ckpt')) {
          resultSdModelName = resultModelName;
          resultIsCustomModel = true;
          console.log('[GenerationDashboard] Detected SD model from name:', resultSdModelName);
        }
      }
      
      // Fallback to current model only if result doesn't have model info (legacy results)
      const currentModel = this.state.selectedModel;
      const currentModelCategory = currentModel?.category;
      
      // Determine if we need to show the model selector
      // Show it if the current model is not suitable for text-to-image (e.g., face tools, img2img)
      const needsModelSelection = currentModelCategory && INCOMPATIBLE_TEXT_TO_IMAGE_CATEGORIES.includes(currentModelCategory);
      
      // Populate the text-to-image model selector if needed
      const modelSection = document.getElementById('characterImageModelSection');
      const modelSelect = document.getElementById('characterImageModelSelect');
      
      if (needsModelSelection && modelSection && modelSelect) {
        // Show the model selection section
        modelSection.style.display = 'block';
        
        // Get all text-to-image models from instance property
        const txt2imgModels = this.imageModels.filter(m => m.category === 'txt2img');
        
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
      
      // Store result data for character creation as instance property
      // Use the result's stored model info, with fallback to current model for legacy results
      // For custom SD models, the sdModelName is the key identifier
      const finalModelId = resultIsCustomModel && resultSdModelName 
        ? `custom-sd-${resultSdModelName}` 
        : (resultModelId || currentModel?.id);
      
      this._currentCharacterImageData = {
        imageUrl: currentImageUrl,
        prompt: result.prompt,
        modelId: finalModelId,
        modelName: resultModelName || currentModel?.name,
        sdModelName: resultSdModelName,  // SD model filename for custom models
        isCustomModel: resultIsCustomModel,
        needsModelSelection: needsModelSelection
      };
      
      console.log('[GenerationDashboard] Character creation data:', this._currentCharacterImageData);
      
      // Show the modal
      const bsModal = new bootstrap.Modal(modal);
      bsModal.show();
      
      this.closePreview();
    } else {
      // Redirect to character creation page with image URL
      const params = new URLSearchParams({
        imageUrl: result.mediaUrl,
        prompt: result.prompt
      });
      window.location.href = `/character-creation?${params.toString()}`;
    }
  }
  
  /**
   * Create a post from a result
   */
  async createPost(resultId) {
    const result = this.state.results.find(r => r.id === resultId);
    if (!result || !result.mediaUrl) {
      this.showNotification('No image available', 'error');
      return;
    }
    
    // Get the current image URL (for carousel, use the current preview index)
    let currentImageUrl = result.mediaUrl;
    if (result.mediaUrls && result.mediaUrls.length > 1 && this._currentPreviewResult?.id === resultId) {
      const imageIndex = this._previewImageIndex || 0;
      currentImageUrl = result.mediaUrls[imageIndex] || result.mediaUrl;
      console.log(`[GenerationDashboard] Creating post from carousel image ${imageIndex + 1}/${result.mediaUrls.length}`);
    }
    
    // Check if post modal exists
    const modal = document.getElementById('createPostModal');
    if (modal) {
      // Set up the modal
      const mediaPreview = modal.querySelector('.post-media-preview');
      if (mediaPreview) {
        if (result.mode === 'image') {
          mediaPreview.innerHTML = `<img src="${currentImageUrl}" alt="Post image" 
                                        style="max-height: 250px; max-width: 100%; border-radius: 8px; object-fit: contain;">`;
        } else {
          mediaPreview.innerHTML = `<video src="${currentImageUrl}" controls 
                                          style="max-height: 250px; max-width: 100%; border-radius: 8px; object-fit: contain;"></video>`;
        }
      }
      
      const captionInput = modal.querySelector('#postCaption');
      if (captionInput) captionInput.value = result.prompt;
      
      // Store result data for posting (use current carousel image)
      this._currentPostData = {
        mediaUrl: currentImageUrl,
        mediaType: result.mode,
        prompt: result.prompt
      };
      
      const bsModal = new bootstrap.Modal(modal);
      bsModal.show();
      
      this.closePreview();
    } else {
      // Redirect to posts dashboard with the image
      const params = new URLSearchParams({
        imageUrl: currentImageUrl,
        caption: result.prompt
      });
      window.location.href = `/dashboard/posts?${params.toString()}`;
    }
  }

  /**
   * Generate caption for draft post using AI
   */
  async generateDraftCaption() {
    const captionInput = document.getElementById('postCaption');
    const btn = document.getElementById('generatePostCaptionBtn');
    
    if (!this._currentPostData?.prompt) {
      this.showNotification('No prompt available for caption generation', 'warning');
      return;
    }
    
    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Generating...';
    captionInput.disabled = true;
    
    try {
      // Get style and language from dropdowns
      const captionStyle = document.getElementById('postCaptionStyle')?.value || 'engaging';
      const captionLanguage = document.getElementById('postCaptionLanguage')?.value || 'english';
      
      // Get existing caption (if any) to use as a starting point
      const existingCaption = captionInput.value.trim();
      
      const response = await fetch('/api/posts/generate-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: this._currentPostData.prompt,
          platform: 'general',
          style: captionStyle,
          language: captionLanguage,
          mediaType: this._currentPostData.mediaType,
          existingCaption: existingCaption || undefined
        })
      });
      
      const data = await response.json();
      
      if (data.success && data.caption) {
        captionInput.value = data.caption;
        this.showNotification('Caption generated!', 'success');
      } else {
        throw new Error(data.error || 'Failed to generate caption');
      }
    } catch (error) {
      console.error('[GenerationDashboard] Error generating caption:', error);
      this.showNotification('Failed to generate caption', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-magic me-1"></i>Generate Caption with AI';
      captionInput.disabled = false;
    }
  }

  /**
   * Confirm and save draft post
   */
  async confirmCreatePost() {
    if (!this._currentPostData) {
      this.showNotification('No post data available', 'error');
      return;
    }
    
    const caption = document.getElementById('postCaption').value;
    const btn = document.getElementById('confirmCreatePostBtn');
    
    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';
    
    try {
      const response = await fetch('/api/posts/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: this._currentPostData.mediaUrl,
          videoUrl: this._currentPostData.mediaType === 'video' ? this._currentPostData.mediaUrl : undefined,
          prompt: this._currentPostData.prompt,
          model: 'generation-dashboard',
          generateCaption: !caption, // Generate caption if not provided
          caption: caption || undefined,
          mediaType: this._currentPostData.mediaType
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.showNotification('Draft post saved!', 'success');
        
        // Update button to "Go to My Posts"
        btn.textContent = '';
        btn.innerHTML = '<i class="bi bi-file-earmark-check me-1"></i>Go to My Posts';
        btn.disabled = false;
        btn.onclick = () => this.goToMyPosts();
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-success');
        
        // Disable caption input and generate button
        document.getElementById('postCaption').disabled = true;
        document.getElementById('generatePostCaptionBtn').disabled = true;
      } else {
        throw new Error(data.error || 'Failed to save draft');
      }
    } catch (error) {
      console.error('[GenerationDashboard] Error saving draft:', error);
      this.showNotification('Failed to save draft: ' + error.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check me-1"></i>Save as Draft';
    }
  }

  /**
   * Navigate to My Posts page
   */
  goToMyPosts() {
    window.location.href = '/dashboard/posts';
  }
  
  /**
   * Add result to character gallery
   */
  async addToGallery(resultId, characterId) {
    const result = this.state.results.find(r => r.id === resultId);
    if (!result || !result.mediaUrl) {
      this.showNotification('No media available', 'error');
      return;
    }
    
    try {
      const response = await fetch('/api/dashboard/add-image-to-gallery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId,
          mediaUrl: result.mediaUrl,
          mediaType: result.mode,
          prompt: result.prompt
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.showNotification('Added to gallery!', 'success');
      } else {
        throw new Error(data.error || 'Failed to add to gallery');
      }
    } catch (error) {
      console.error('[GenerationDashboard] Add to gallery error:', error);
      this.showNotification(error.message || 'Failed to add to gallery', 'error');
    }
  }
  
  /**
   * Confirm and create character from the modal
   */
  async confirmCreateCharacter() {
    const imageData = this._currentCharacterImageData;
    if (!imageData || !imageData.imageUrl) {
      this.showNotification('No image data available', 'error');
      return;
    }
    
    const btn = document.getElementById('confirmCreateCharacterBtn');
    const name = document.getElementById('characterNameInput')?.value.trim();
    const personalityInput = document.getElementById('characterPersonalityInput')?.value.trim();
    const language = document.getElementById('characterLanguageSelect')?.value || 'english';
    const nsfw = document.getElementById('characterNsfwCheck')?.checked || false;
    const useImageAsBaseFace = document.getElementById('useImageAsBaseFaceCheck')?.checked || false;
    
    // Get the selected text-to-image model if the section is visible
    let finalModelId = imageData.modelId;
    let finalModelName = imageData.modelName;
    let finalSdModelName = imageData.sdModelName;
    let finalIsCustomModel = imageData.isCustomModel;
    
    if (imageData.needsModelSelection) {
      const modelSelect = document.getElementById('characterImageModelSelect');
      if (modelSelect && modelSelect.value) {
        const selectedModelId = modelSelect.value;
        const selectedModel = this.imageModels.find(m => m.id === selectedModelId);
        if (selectedModel) {
          finalModelId = selectedModel.id;
          finalModelName = selectedModel.name;
          // When user selects a different model, clear the SD model info
          finalSdModelName = null;
          finalIsCustomModel = false;
        }
      }
    }
    
    // Show loading state
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating Character...';
    }
    
    console.log('[GenerationDashboard] Creating character with model info:', {
      modelId: finalModelId,
      modelName: finalModelName,
      sdModelName: finalSdModelName,
      isCustomModel: finalIsCustomModel
    });
    
    try {
      const response = await fetch('/api/dashboard/create-character-from-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: imageData.imageUrl,
          imagePrompt: imageData.prompt,
          personalityInput: personalityInput,
          name: name || undefined,
          language: language,
          nsfw: nsfw,
          useImageAsBaseFace: useImageAsBaseFace,
          modelId: finalModelId,
          modelName: finalModelName,
          sdModelName: finalSdModelName,
          isCustomModel: finalIsCustomModel
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.showNotification('Character created successfully!', 'success');
        
        // Store the chat URL for the start chat button
        const chatUrl = `/chat/${data.chatId}`;
        
        // Transform the button to "Start Chat" button
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('btn-success');
          btn.classList.add('btn-primary');
          btn.innerHTML = '<i class="bi bi-chat-heart me-1"></i>Start Chat';
          btn.onclick = function() {
            window.location.href = chatUrl;
          };
        }
        
        // Update cancel button text
        const cancelBtn = btn?.previousElementSibling;
        if (cancelBtn && cancelBtn.classList.contains('btn-secondary')) {
          cancelBtn.textContent = 'Close';
        }
      } else {
        throw new Error(data.error || 'Failed to create character');
      }
    } catch (error) {
      console.error('[GenerationDashboard] Create character error:', error);
      this.showNotification(error.message || 'Failed to create character', 'error');
      
      // Reset button state
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-person-plus me-1"></i>Create Character';
      }
    }
  }
}

// Global instance
let genDashboard;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Get configuration from page
  const config = window.GEN_DASHBOARD_CONFIG || {};
  genDashboard = new GenerationDashboard(config);
  
  // Expose to window for other scripts (e.g., civitai-model-search.js)
  window.genDashboard = genDashboard;
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GenerationDashboard;
}
