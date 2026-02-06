/**
 * Schedules Dashboard
 * Frontend logic for viewing and managing schedules
 */

class SchedulesDashboard {
  constructor() {
    this.currentPage = 1;
    this.limit = 20;
    this.filters = {
      type: '',
      status: '',
      actionType: ''
    };
    this.scheduleModal = null;
    this.viewScheduleModal = null;
    this.calendarManagerModal = null;
    this.testRunInProgress = false;
    this.lastTestRunImage = null;
    this.userCharacters = [];
    this.customPrompts = [];
    this.selectedCustomPromptIds = new Set();
    this.selectedCharacterId = '';

    // Character pagination and search
    this.characterSkip = 0;
    this.characterLimit = 50;
    this.characterHasMore = true;
    this.characterSearchQuery = '';
    this.characterLoading = false;
    this.characterSearchTimeout = null;
    this.socialConnections = [];
    this.selectedSocialAccountIds = new Set();

    // Calendar-related properties (single schedule)
    this.calendars = [];
    this.selectedCalendarId = '';
    this.nextAvailableSlot = null;
    this.calendarSlots = [];

    // Calendar-related properties (recurring/cron schedule)
    this.selectedRecurringCalendarId = '';
    this.recurringNextAvailableSlot = null;

    this.init();
  }

  init() {
    this.setupModals();
    this.setupEventListeners();
    this.loadSchedules();
    this.loadStats();
    this.loadUserCharacters();
    this.loadCustomPrompts();
    this.loadSocialConnections();
    this.loadCalendars();
  }

  setupModals() {
    const scheduleModalEl = document.getElementById('scheduleModal');
    const viewScheduleModalEl = document.getElementById('viewScheduleModal');
    const calendarManagerModalEl = document.getElementById('calendarManagerModal');

    if (scheduleModalEl) {
      this.scheduleModal = new bootstrap.Modal(scheduleModalEl);
    }
    if (viewScheduleModalEl) {
      this.viewScheduleModal = new bootstrap.Modal(viewScheduleModalEl);
    }
    if (calendarManagerModalEl) {
      this.calendarManagerModal = new bootstrap.Modal(calendarManagerModalEl);
    }
  }

  setupEventListeners() {
    // Filter changes
    document.getElementById('filterType')?.addEventListener('change', (e) => {
      this.filters.type = e.target.value;
      this.currentPage = 1;
      this.loadSchedules();
    });

    document.getElementById('filterStatus')?.addEventListener('change', (e) => {
      this.filters.status = e.target.value;
      this.currentPage = 1;
      this.loadSchedules();
    });

    document.getElementById('filterAction')?.addEventListener('change', (e) => {
      this.filters.actionType = e.target.value;
      this.currentPage = 1;
      this.loadSchedules();
    });

    // Reset filters
    document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
      this.resetFilters();
    });

    // Schedule type toggle
    document.querySelectorAll('input[name="scheduleTypeRadio"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.toggleScheduleType(e.target.value);
      });
    });

    // Prompt type toggle
    document.querySelectorAll('input[name="promptTypeRadio"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.togglePromptType(e.target.value);
      });
    });

    // Action type selector buttons
    document.querySelectorAll('.schedule-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.selectActionType(e.currentTarget.dataset.action);
      });
    });

    // Calendar selector (single schedule)
    document.getElementById('calendarSelect')?.addEventListener('change', (e) => {
      this.onCalendarSelected(e.target.value);
    });

    // Calendar selector (recurring/cron schedule)
    document.getElementById('recurringCalendarSelect')?.addEventListener('change', (e) => {
      this.onRecurringCalendarSelected(e.target.value);
    });

    // Model selector button
    const modelSelectorBtn = document.getElementById('modelSelectorBtn');
    const modelDropdown = document.getElementById('modelDropdown');
    
    if (modelSelectorBtn && modelDropdown) {
      modelSelectorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modelSelectorBtn.classList.toggle('open');
        modelDropdown.classList.toggle('show');
      });

      // Model dropdown items
      document.querySelectorAll('.model-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
          this.selectModel(item.dataset.value, item.dataset.name);
          modelDropdown.classList.remove('show');
          modelSelectorBtn.classList.remove('open');
        });
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!modelSelectorBtn.contains(e.target) && !modelDropdown.contains(e.target)) {
          modelDropdown.classList.remove('show');
          modelSelectorBtn.classList.remove('open');
        }
      });

      // Select first model by default
      const firstModel = document.querySelector('.model-dropdown-item');
      if (firstModel) {
        this.selectModel(firstModel.dataset.value, firstModel.dataset.name);
      }
    }

    // Character search input
    const characterSearchInput = document.getElementById('characterSearchInput');
    if (characterSearchInput) {
      characterSearchInput.addEventListener('input', (e) => {
        this.onCharacterSearch(e.target.value);
      });
    }

    // Character list infinite scroll
    const characterContainer = document.getElementById('characterSelectionContainer');
    if (characterContainer) {
      characterContainer.addEventListener('scroll', () => {
        this.onCharacterScroll(characterContainer);
      });
    }
  }

  onCharacterSearch(query) {
    // Debounce search
    if (this.characterSearchTimeout) {
      clearTimeout(this.characterSearchTimeout);
    }

    this.characterSearchTimeout = setTimeout(() => {
      this.characterSearchQuery = query.trim();
      this.characterSkip = 0;
      this.characterHasMore = true;
      this.loadUserCharacters(false);
    }, 300);
  }

  onCharacterScroll(container) {
    if (this.characterLoading || !this.characterHasMore) return;

    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    // Load more when scrolled near the bottom (within 50px)
    if (scrollTop + clientHeight >= scrollHeight - 50) {
      this.characterSkip += this.characterLimit;
      this.loadUserCharacters(true);
    }
  }

  selectActionType(actionType) {
    // Update hidden input
    document.getElementById('actionType').value = actionType;

    // Update button states
    document.querySelectorAll('.schedule-action-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.action === actionType);
    });

    // Update description text using translations
    const descriptionText = document.getElementById('actionTypeDescriptionText');
    if (descriptionText && window.translations?.dashboard) {
      const descriptions = {
        'generate_image': window.translations.dashboard.generateImageDescription,
        'generate_video': window.translations.dashboard.generateVideoDescription,
        'publish_post': window.translations.dashboard.publishPostDescription
      };
      descriptionText.textContent = descriptions[actionType] || '';
    }
  }

  selectModel(modelId, modelName) {
    // Update hidden input
    document.getElementById('actionModel').value = modelId;
    
    // Update selector button text
    const modelNameEl = document.querySelector('.schedule-model-selector .model-name');
    if (modelNameEl) {
      modelNameEl.textContent = modelName;
    }
    
    // Update selected state in dropdown
    document.querySelectorAll('.model-dropdown-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.value === modelId);
    });
  }

  resetFilters() {
    this.filters = { type: '', status: '', actionType: '' };
    
    document.getElementById('filterType').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterAction').value = '';
    
    this.currentPage = 1;
    this.loadSchedules();
  }

  toggleScheduleType(type) {
    document.getElementById('scheduleType').value = type;
    
    const singleFields = document.getElementById('singleScheduleFields');
    const recurringFields = document.getElementById('recurringScheduleFields');
    
    if (type === 'single') {
      singleFields.style.display = 'block';
      recurringFields.style.display = 'none';
    } else {
      singleFields.style.display = 'none';
      recurringFields.style.display = 'block';
    }
  }

  togglePromptType(type) {
    const manualFields = document.getElementById('manualPromptFields');
    const customFields = document.getElementById('customPromptFields');
    
    if (type === 'manual') {
      manualFields.style.display = 'block';
      customFields.style.display = 'none';
    } else {
      manualFields.style.display = 'none';
      customFields.style.display = 'block';
    }
  }

  async loadUserCharacters(append = false) {
    if (this.characterLoading) return;
    if (append && !this.characterHasMore) return;

    this.characterLoading = true;

    try {
      const params = new URLSearchParams({
        skip: this.characterSkip,
        limit: this.characterLimit
      });
      if (this.characterSearchQuery) {
        params.append('search', this.characterSearchQuery);
      }

      const response = await fetch(`/api/schedules/user-characters?${params}`);
      const data = await response.json();

      if (data.success) {
        const newCharactersCount = data.characters.length;
        if (append) {
          this.userCharacters = [...this.userCharacters, ...data.characters];
        } else {
          this.userCharacters = data.characters;
        }
        this.characterHasMore = data.pagination?.hasMore ?? false;
        this.populateCharacterDropdown(append, newCharactersCount);
      } else {
        if (!append) {
          this.showCharacterLoadError();
        }
      }
    } catch (error) {
      console.error('Error loading characters:', error);
      if (!append) {
        this.showCharacterLoadError();
      }
    } finally {
      this.characterLoading = false;
    }
  }

  showCharacterLoadError() {
    const container = document.getElementById('characterSelectionContainer');
    if (!container) return;
    container.innerHTML = `
      <div class="text-center py-2">
        <p class="text-muted mb-0 small">No characters found</p>
      </div>
    `;
  }

  populateCharacterDropdown(append = false, newCount = 0) {
    const container = document.getElementById('characterSelectionContainer');
    if (!container) return;

    // Remove existing loader if present
    const existingLoader = container.querySelector('.character-load-more');
    if (existingLoader) {
      existingLoader.remove();
    }

    if (!append) {
      container.innerHTML = '';

      // Create "None" option (only when not searching)
      if (!this.characterSearchQuery) {
        const noneItem = document.createElement('div');
        noneItem.className = 'character-selection-item';
        noneItem.dataset.characterId = '';
        noneItem.innerHTML = `
          <div class="character-item-avatar">
            <i class="bi bi-x-circle"></i>
          </div>
          <div class="character-item-info">
            <div class="character-item-name">None</div>
          </div>
        `;
        noneItem.addEventListener('click', () => this.selectCharacter('', noneItem));
        container.appendChild(noneItem);
      }
    }

    // Determine which characters to add (all if not appending, or just the newly loaded ones)
    const charactersToAdd = append
      ? this.userCharacters.slice(-newCount)
      : this.userCharacters;

    // Add character items
    charactersToAdd.forEach(character => {
      const item = document.createElement('div');
      item.className = 'character-selection-item';
      item.dataset.characterId = character.id;

      // API returns imageUrl, also check thumbnail and chatImageUrl for backward compatibility
      // Use /img/avatar.png as fallback since default-thumbnail.png doesn't exist
      const thumbnail = character.imageUrl || character.thumbnail || character.chatImageUrl || '/img/avatar.png';
      const charName = this.escapeHtml(character.name || 'Unknown');
      const favoriteIcon = character.isFavorite ? '<i class="bi bi-star-fill character-favorite-icon"></i>' : '';

      item.innerHTML = `
        <div class="character-item-avatar">
          <img src="${thumbnail}" alt="${charName}" onerror="this.src='/img/avatar.png'">
        </div>
        <div class="character-item-info">
          <div class="character-item-name">${charName}${favoriteIcon}</div>
        </div>
      `;

      item.addEventListener('click', () => this.selectCharacter(character.id, item));
      container.appendChild(item);
    });

    // Show "no results" message if searching and no characters found
    if (!append && this.characterSearchQuery && this.userCharacters.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'text-center py-3';
      noResults.innerHTML = `<p class="text-muted mb-0 small">No characters found</p>`;
      container.appendChild(noResults);
    }

    // Restore active state if a character was selected
    if (this.selectedCharacterId) {
      const selectedItem = container.querySelector(`[data-character-id="${this.selectedCharacterId}"]`);
      if (selectedItem) {
        selectedItem.classList.add('active');
      }
    }
  }

  selectCharacter(characterId, itemElement) {
    // Remove active class from all items
    document.querySelectorAll('.character-selection-item').forEach(item => {
      item.classList.remove('active');
    });

    // Add active class to clicked item
    if (itemElement) {
      itemElement.classList.add('active');
    }

    // Store selected character
    this.selectedCharacterId = characterId;

    // If character has a model, add it to the dropdown and select it
    if (characterId) {
      const character = this.userCharacters.find(c => c.id === characterId);
      console.log('[Schedule] Selected character:', character);
      console.log('[Schedule] Character modelId:', character?.modelId);
      console.log('[Schedule] Character modelName:', character?.modelName);
      if (character && character.modelId) {
        this.addCharacterModelToDropdown(character);
      }
    } else {
      // No character selected - remove character model from dropdown
      this.removeCharacterModelFromDropdown();
    }
  }

  /**
   * Add a character's model to the top of the model dropdown and select it
   */
  addCharacterModelToDropdown(character) {
    if (!character || !character.modelId) return;

    const modelDropdown = document.getElementById('modelDropdown');
    if (!modelDropdown) return;

    let modelId = character.modelId;
    const modelName = character.modelName || modelId;

    // Check if this is a numeric ID (SD/CivitAI model) - needs sd- prefix
    // The API expects SD models to be prefixed with "sd-"
    if (/^\d+$/.test(modelId)) {
      modelId = `sd-${modelId}`;
      console.log('[Schedule] Detected SD model, using prefixed ID:', modelId);
    }

    // Check if the model already exists in the dropdown
    let existingItem = modelDropdown.querySelector(`.model-dropdown-item[data-value="${modelId}"]`);

    if (existingItem) {
      // Model exists in the list - just select it
      const existingName = existingItem.dataset.name;
      console.log('[Schedule] Found existing model in dropdown:', modelId, existingName);
      this.selectModel(modelId, existingName);
    } else {
      // Model not in the standard list - add it as a character model
      console.log('[Schedule] Adding character model to dropdown:', modelId, modelName);

      // Remove any previous character model items
      this.removeCharacterModelFromDropdown();

      // Create a header for character model
      const characterHeader = document.createElement('div');
      characterHeader.className = 'model-dropdown-header character-model';
      characterHeader.innerHTML = '<span>Character Model</span>';
      modelDropdown.insertBefore(characterHeader, modelDropdown.firstChild);

      // Create the model item
      const modelItem = document.createElement('div');
      modelItem.className = 'model-dropdown-item character-model-item';
      modelItem.dataset.value = modelId;
      modelItem.dataset.name = modelName;
      modelItem.innerHTML = `
        <div class="model-item-icon" style="background: linear-gradient(135deg, #ec4899, #8b5cf6);">
          <i class="bi bi-person-hearts"></i>
        </div>
        <div class="model-item-info">
          <span class="model-item-name">${this.escapeHtml(modelName)}</span>
          <span class="model-item-badge" style="background: linear-gradient(135deg, #ec4899, #8b5cf6);">Character</span>
        </div>
        <i class="bi bi-check-lg model-check"></i>
      `;

      // Add click handler
      modelItem.addEventListener('click', () => {
        this.selectModel(modelId, modelName);
        document.getElementById('modelDropdown').classList.remove('show');
        document.getElementById('modelSelectorBtn').classList.remove('open');
      });

      // Insert after the header
      modelDropdown.insertBefore(modelItem, characterHeader.nextSibling);

      // Select this model
      this.selectModel(modelId, modelName);
    }
  }

  /**
   * Remove character model items from dropdown
   */
  removeCharacterModelFromDropdown() {
    const modelDropdown = document.getElementById('modelDropdown');
    if (!modelDropdown) return;

    const characterHeader = modelDropdown.querySelector('.model-dropdown-header.character-model');
    if (characterHeader) characterHeader.remove();

    const characterItems = modelDropdown.querySelectorAll('.character-model-item');
    characterItems.forEach(item => item.remove());
  }

  async loadCustomPrompts() {
    try {
      const response = await fetch('/api/schedules/custom-prompts');
      const data = await response.json();
      
      if (data.success && data.prompts) {
        this.customPrompts = data.prompts;
        this.renderCustomPrompts();
      } else {
        console.error('Custom prompts API returned no data:', data);
        this.renderCustomPromptsError();
      }
    } catch (error) {
      console.error('Error loading custom prompts:', error);
      this.renderCustomPromptsError();
    }
  }

  renderCustomPrompts() {
    const container = document.getElementById('customPromptsContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (this.customPrompts.length === 0) {
      container.innerHTML = `
        <div class="text-center py-3">
          <p class="text-muted mb-0">No custom prompts available</p>
        </div>
      `;
      return;
    }
    
    this.customPrompts.forEach(prompt => {
      const card = document.createElement('div');
      card.className = 'custom-prompt-card';
      card.dataset.promptId = prompt.id;
      
      // Create image element - use imagePreview which contains the prompt image
      const img = document.createElement('img');
      const imageUrl = prompt.imagePreview || '/img/image-placeholder-1.gif';
      img.src = imageUrl;
      img.alt = this.escapeHtml(prompt.title || '');
      img.onerror = () => { img.src = '/img/image-placeholder-1.gif'; };
      
      // Create overlay with title or description
      const overlay = document.createElement('div');
      overlay.className = 'prompt-overlay';
      const displayText = prompt.title || prompt.description || '';
      overlay.textContent = this.truncateText(displayText, 40);
      
      // Create badge
      const badge = document.createElement('div');
      badge.className = 'selected-badge';
      badge.innerHTML = '<i class="bi bi-check"></i>';
      
      card.appendChild(img);
      card.appendChild(overlay);
      card.appendChild(badge);
      
      card.addEventListener('click', () => {
        this.toggleCustomPromptSelection(prompt.id, card);
      });
      
      container.appendChild(card);
    });
  }

  renderCustomPromptsError() {
    const container = document.getElementById('customPromptsContainer');
    if (!container) return;
    
    container.innerHTML = `
      <div class="text-center py-3">
        <i class="bi bi-exclamation-triangle text-warning"></i>
        <p class="text-muted mb-0 mt-2">Failed to load custom prompts</p>
      </div>
    `;
  }

  toggleCustomPromptSelection(promptId, cardElement) {
    if (this.selectedCustomPromptIds.has(promptId)) {
      this.selectedCustomPromptIds.delete(promptId);
      cardElement.classList.remove('selected');
    } else {
      this.selectedCustomPromptIds.add(promptId);
      cardElement.classList.add('selected');
    }
    
    this.updateSelectedPromptsInfo();
  }

  updateSelectedPromptsInfo() {
    const info = document.getElementById('selectedPromptsInfo');
    const count = document.getElementById('selectedPromptsCount');
    
    if (!info || !count) return;
    
    count.textContent = this.selectedCustomPromptIds.size;
    info.style.display = this.selectedCustomPromptIds.size > 0 ? 'block' : 'none';
  }

  // ============================================
  // Calendar Management Methods
  // ============================================

  async loadCalendars() {
    try {
      const response = await fetch('/api/calendars');
      const data = await response.json();

      if (data.success) {
        this.calendars = data.calendars || [];
        this.populateCalendarSelect();
      }
    } catch (error) {
      console.error('Error loading calendars:', error);
    }
  }

  populateCalendarSelect() {
    // Populate single schedule calendar selector
    const select = document.getElementById('calendarSelect');
    if (select) {
      // Keep the first option (manual selection)
      select.innerHTML = '<option value="">Manual time selection</option>';

      this.calendars.forEach(calendar => {
        const option = document.createElement('option');
        option.value = calendar._id;
        const slotCount = (calendar.slots || []).filter(s => s.isEnabled).length;
        option.textContent = `${calendar.name} (${slotCount} slots)`;
        select.appendChild(option);
      });
    }

    // Populate recurring schedule calendar selector
    const recurringSelect = document.getElementById('recurringCalendarSelect');
    if (recurringSelect) {
      // Keep the first option (cron expression)
      recurringSelect.innerHTML = '<option value="">Use cron expression instead</option>';

      this.calendars.forEach(calendar => {
        const option = document.createElement('option');
        option.value = calendar._id;
        const slotCount = (calendar.slots || []).filter(s => s.isEnabled).length;
        option.textContent = `${calendar.name} (${slotCount} slots)`;
        recurringSelect.appendChild(option);
      });
    }
  }

  async onCalendarSelected(calendarId) {
    this.selectedCalendarId = calendarId;
    const previewEl = document.getElementById('nextSlotPreview');

    if (!calendarId) {
      this.nextAvailableSlot = null;
      if (previewEl) previewEl.style.display = 'none';
      return;
    }

    // Show loading state
    if (previewEl) {
      previewEl.style.display = 'block';
      document.getElementById('nextSlotText').textContent = 'Finding next available slot...';
    }

    await this.fetchNextSlot(calendarId);
  }

  async fetchNextSlot(calendarId) {
    try {
      const response = await fetch(`/api/calendars/${calendarId}/next-slot`);
      const data = await response.json();

      const previewEl = document.getElementById('nextSlotPreview');
      const textEl = document.getElementById('nextSlotText');

      if (data.success && data.nextSlot) {
        this.nextAvailableSlot = data.nextSlot;
        const publishAt = new Date(data.nextSlot.publishAt);
        textEl.textContent = `Next slot: ${this.formatDate(publishAt)}`;
        previewEl.style.display = 'block';
      } else {
        this.nextAvailableSlot = null;
        textEl.textContent = data.message || (window.translations?.dashboard?.noAvailableSlots || 'No available slots');
        previewEl.style.display = 'block';
      }
    } catch (error) {
      console.error('Error fetching next slot:', error);
      this.nextAvailableSlot = null;
      const previewEl = document.getElementById('nextSlotPreview');
      if (previewEl) previewEl.style.display = 'none';
    }
  }

  useNextSlot() {
    if (!this.nextAvailableSlot) return;

    const publishAt = new Date(this.nextAvailableSlot.publishAt);
    // Format for datetime-local input (YYYY-MM-DDTHH:MM)
    const localDateTime = new Date(publishAt.getTime() - publishAt.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);

    document.getElementById('scheduledFor').value = localDateTime;
    this.showNotification(window.translations?.dashboard?.timeSlotApplied || 'Time slot applied!', 'success');
  }

  // Handle calendar selection for recurring (cron) schedules
  async onRecurringCalendarSelected(calendarId) {
    this.selectedRecurringCalendarId = calendarId;
    const previewEl = document.getElementById('recurringNextSlotPreview');
    const cronSection = document.getElementById('cronExpressionSection');

    if (!calendarId) {
      this.recurringNextAvailableSlot = null;
      if (previewEl) previewEl.style.display = 'none';
      if (cronSection) cronSection.style.display = 'block';
      return;
    }

    // Hide cron expression section when calendar is selected
    if (cronSection) cronSection.style.display = 'none';

    // Show loading state
    if (previewEl) {
      previewEl.style.display = 'block';
      document.getElementById('recurringNextSlotText').innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>' + (window.translations?.dashboard?.findingNextSlot || 'Finding next available slot...');
    }

    await this.fetchRecurringNextSlot(calendarId);
  }

  async fetchRecurringNextSlot(calendarId) {
    try {
      const response = await fetch(`/api/calendars/${calendarId}/next-slot`);
      const data = await response.json();

      const previewEl = document.getElementById('recurringNextSlotPreview');
      const textEl = document.getElementById('recurringNextSlotText');

      if (data.success && data.nextSlot) {
        this.recurringNextAvailableSlot = data.nextSlot;
        const publishAt = new Date(data.nextSlot.publishAt);
        
        // Get calendar info for slot summary
        const calendar = this.calendars.find(c => c._id === calendarId);
        const enabledSlots = calendar ? (calendar.slots || []).filter(s => s.isEnabled).length : 0;
        
        const t = window.translations?.dashboard || {};
        textEl.innerHTML = `
          <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
            <div>
              <strong>${t.next || 'Next'}:</strong> ${this.formatDate(publishAt)}
              <span class="text-muted ms-2">(${enabledSlots} ${t.weeklySlots || 'weekly slots'})</span>
            </div>
            <button type="button" class="btn btn-sm btn-outline-success" onclick="schedulesDashboard.useRecurringNextSlot()">
              <i class="bi bi-check-lg me-1"></i>${t.useThisSlot || 'Use this slot'}
            </button>
          </div>
        `;
        previewEl.style.display = 'block';
      } else {
        this.recurringNextAvailableSlot = null;
        textEl.innerHTML = `<i class="bi bi-exclamation-circle me-2"></i>${data.message || (window.translations?.dashboard?.noAvailableSlotsConfigured || 'No available slots configured')}`;
        previewEl.style.display = 'block';
      }
    } catch (error) {
      console.error('Error fetching recurring next slot:', error);
      this.recurringNextAvailableSlot = null;
      const previewEl = document.getElementById('recurringNextSlotPreview');
      if (previewEl) previewEl.style.display = 'none';
      // Show cron section again on error
      const cronSection = document.getElementById('cronExpressionSection');
      if (cronSection) cronSection.style.display = 'block';
    }
  }

  useRecurringNextSlot() {
    if (!this.recurringNextAvailableSlot || !this.selectedRecurringCalendarId) return;

    // For recurring schedules with calendar, we store the calendar ID
    // The next slot is automatically determined by the calendar
    this.showNotification(window.translations?.dashboard?.calendarSlotRecurring || 'Calendar slot will be used for recurring schedule!', 'success');
  }

  // Calendar Manager Modal
  openCalendarManager() {
    this.showCalendarList();
    this.loadCalendarList();
    this.calendarManagerModal?.show();
  }

  async loadCalendarList() {
    const listEl = document.getElementById('calendarList');
    if (!listEl) return;

    listEl.innerHTML = `
      <div class="text-center py-4">
        <div class="spinner-border spinner-border-sm" role="status">
          <span class="visually-hidden">${window.translations?.dashboard?.loading || 'Loading...'}</span>
        </div>
      </div>
    `;

    try {
      const response = await fetch('/api/calendars');
      const data = await response.json();

      if (data.success) {
        this.calendars = data.calendars || [];
        this.renderCalendarList();
        // Also update the dropdown in the schedule modal
        this.populateCalendarSelect();
      } else {
        throw new Error(data.error || (window.translations?.dashboard?.failedToLoadCalendars || 'Failed to load calendars'));
      }
    } catch (error) {
      console.error('Error loading calendar list:', error);
      listEl.innerHTML = `
        <div class="text-center py-4 text-danger">
          <i class="bi bi-exclamation-triangle me-2"></i>${window.translations?.dashboard?.failedToLoadCalendars || 'Failed to load calendars'}
        </div>
      `;
    }
  }

  renderCalendarList() {
    const listEl = document.getElementById('calendarList');
    if (!listEl) return;

    if (this.calendars.length === 0) {
      listEl.innerHTML = `
        <div class="text-center py-4">
          <i class="bi bi-calendar-x" style="font-size: 2rem; color: var(--sched-text-muted);"></i>
          <p class="text-muted mt-2 mb-0">${window.translations?.dashboard?.noCalendarsYet || 'No calendars yet'}</p>
          <p class="text-muted small">${window.translations?.dashboard?.createCalendarToSchedule || 'Create a calendar to schedule posts at recurring times'}</p>
        </div>
      `;
      return;
    }

    const t = window.translations?.dashboard || {};
    const dayNames = [t.sunShort || 'Sun', t.monShort || 'Mon', t.tueShort || 'Tue', t.wedShort || 'Wed', t.thuShort || 'Thu', t.friShort || 'Fri', t.satShort || 'Sat'];

    listEl.innerHTML = this.calendars.map(calendar => {
      const enabledSlots = (calendar.slots || []).filter(s => s.isEnabled);
      const slotSummary = enabledSlots.length > 0
        ? enabledSlots.slice(0, 3).map(s => `${dayNames[s.dayOfWeek]} ${String(s.hour).padStart(2, '0')}:${String(s.minute || 0).padStart(2, '0')}`).join(', ')
          + (enabledSlots.length > 3 ? ` +${enabledSlots.length - 3} ${t.more || 'more'}` : '')
        : (t.noSlotsConfigured || 'No slots configured');

      return `
        <div class="calendar-list-item ${calendar.isActive ? '' : 'inactive'}">
          <div class="calendar-item-info">
            <div class="d-flex align-items-center gap-2">
              <h6 class="mb-0">${this.escapeHtml(calendar.name)}</h6>
              <span class="badge ${calendar.isActive ? 'bg-success' : 'bg-secondary'}">${calendar.isActive ? (t.active || 'Active') : (t.inactive || 'Inactive')}</span>
            </div>
            ${calendar.description ? `<p class="text-muted small mb-1">${this.escapeHtml(calendar.description)}</p>` : ''}
            <p class="text-muted small mb-0">
              <i class="bi bi-clock me-1"></i>${slotSummary}
            </p>
          </div>
          <div class="calendar-item-actions">
            <button class="btn btn-sm btn-outline-primary" onclick="schedulesDashboard.openEditCalendarModal('${calendar._id}')" title="Edit">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="schedulesDashboard.deleteCalendarConfirm('${calendar._id}')" title="Delete">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  showCalendarList() {
    document.getElementById('calendarListContainer').style.display = 'block';
    document.getElementById('calendarFormContainer').style.display = 'none';
    document.getElementById('calendarModalFooter').innerHTML = `
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${window.translations?.dashboard?.close || 'Close'}</button>
    `;
  }

  openCreateCalendarModal() {
    // Reset form
    document.getElementById('editCalendarId').value = '';
    document.getElementById('calendarName').value = '';
    document.getElementById('calendarDescription').value = '';
    document.getElementById('calendarTimezone').value = 'UTC';
    document.getElementById('calendarFormTitle').textContent = window.translations?.dashboard?.newCalendar || 'New Calendar';

    // Clear and add default slots
    this.calendarSlots = [];
    this.renderSlotRows();

    // Show form
    document.getElementById('calendarListContainer').style.display = 'none';
    document.getElementById('calendarFormContainer').style.display = 'block';
    document.getElementById('calendarModalFooter').innerHTML = `
      <button type="button" class="btn btn-secondary" onclick="schedulesDashboard.showCalendarList()">${window.translations?.dashboard?.cancel || 'Cancel'}</button>
      <button type="button" class="btn btn-primary" onclick="schedulesDashboard.saveCalendar()">
        <i class="bi bi-check me-1"></i>${window.translations?.dashboard?.createCalendar || 'Create Calendar'}
      </button>
    `;
  }

  async openEditCalendarModal(calendarId) {
    try {
      const response = await fetch(`/api/calendars/${calendarId}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || (window.translations?.dashboard?.failedToLoadCalendar || 'Failed to load calendar'));
      }

      const calendar = data.calendar;

      // Populate form
      document.getElementById('editCalendarId').value = calendar._id;
      document.getElementById('calendarName').value = calendar.name || '';
      document.getElementById('calendarDescription').value = calendar.description || '';
      document.getElementById('calendarTimezone').value = calendar.timezone || 'UTC';
      document.getElementById('calendarFormTitle').textContent = window.translations?.dashboard?.editCalendar || 'Edit Calendar';

      // Populate slots
      this.calendarSlots = (calendar.slots || []).map(s => ({
        _id: s._id,
        dayOfWeek: s.dayOfWeek,
        hour: s.hour,
        minute: s.minute || 0,
        isEnabled: s.isEnabled !== false
      }));
      this.renderSlotRows();

      // Show form
      document.getElementById('calendarListContainer').style.display = 'none';
      document.getElementById('calendarFormContainer').style.display = 'block';
      document.getElementById('calendarModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" onclick="schedulesDashboard.showCalendarList()">${window.translations?.dashboard?.cancel || 'Cancel'}</button>
        <button type="button" class="btn btn-primary" onclick="schedulesDashboard.saveCalendar()">
          <i class="bi bi-check me-1"></i>${window.translations?.dashboard?.saveChanges || 'Save Changes'}
        </button>
      `;

    } catch (error) {
      console.error('Error loading calendar:', error);
      this.showNotification(window.translations?.dashboard?.failedToLoadCalendar || 'Failed to load calendar', 'error');
    }
  }

  addSlotRow() {
    this.calendarSlots.push({
      dayOfWeek: 1, // Monday
      hour: 9,
      minute: 0,
      isEnabled: true
    });
    this.renderSlotRows();
  }

  removeSlotRow(index) {
    this.calendarSlots.splice(index, 1);
    this.renderSlotRows();
  }

  renderSlotRows() {
    const container = document.getElementById('slotsContainer');
    if (!container) return;

    if (this.calendarSlots.length === 0) {
      container.innerHTML = `
        <div class="text-center py-3 text-muted">
          <i class="bi bi-clock me-1"></i>${window.translations?.dashboard?.noTimeSlotsConfigured || 'No time slots configured'}
        </div>
      `;
      return;
    }

    const t = window.translations?.dashboard || {};
    const dayOptions = [
      { value: 0, label: t.sunday || 'Sunday' },
      { value: 1, label: t.monday || 'Monday' },
      { value: 2, label: t.tuesday || 'Tuesday' },
      { value: 3, label: t.wednesday || 'Wednesday' },
      { value: 4, label: t.thursday || 'Thursday' },
      { value: 5, label: t.friday || 'Friday' },
      { value: 6, label: t.saturday || 'Saturday' }
    ];

    container.innerHTML = this.calendarSlots.map((slot, index) => `
      <div class="slot-row" data-index="${index}">
        <select class="form-select form-select-sm slot-day" onchange="schedulesDashboard.updateSlot(${index}, 'dayOfWeek', this.value)">
          ${dayOptions.map(d => `<option value="${d.value}" ${slot.dayOfWeek === d.value ? 'selected' : ''}>${d.label}</option>`).join('')}
        </select>
        <input type="time" class="form-control form-control-sm slot-time"
               value="${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}"
               onchange="schedulesDashboard.updateSlotTime(${index}, this.value)">
        <div class="form-check form-switch slot-enabled">
          <input class="form-check-input" type="checkbox" ${slot.isEnabled ? 'checked' : ''}
                 onchange="schedulesDashboard.updateSlot(${index}, 'isEnabled', this.checked)">
        </div>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="schedulesDashboard.removeSlotRow(${index})">
          <i class="bi bi-x"></i>
        </button>
      </div>
    `).join('');
  }

  updateSlot(index, field, value) {
    if (this.calendarSlots[index]) {
      if (field === 'dayOfWeek') {
        this.calendarSlots[index][field] = parseInt(value);
      } else {
        this.calendarSlots[index][field] = value;
      }
    }
  }

  updateSlotTime(index, timeValue) {
    if (this.calendarSlots[index] && timeValue) {
      const [hour, minute] = timeValue.split(':').map(Number);
      this.calendarSlots[index].hour = hour;
      this.calendarSlots[index].minute = minute;
    }
  }

  async saveCalendar() {
    const calendarId = document.getElementById('editCalendarId').value;
    const name = document.getElementById('calendarName').value.trim();
    const description = document.getElementById('calendarDescription').value.trim();
    const timezone = document.getElementById('calendarTimezone').value;

    if (!name) {
      this.showNotification(window.translations?.dashboard?.enterCalendarName || 'Please enter a calendar name', 'warning');
      return;
    }

    const calendarData = {
      name,
      description,
      timezone,
      slots: this.calendarSlots.map(s => ({
        dayOfWeek: parseInt(s.dayOfWeek),
        hour: parseInt(s.hour),
        minute: parseInt(s.minute) || 0,
        isEnabled: s.isEnabled !== false
      }))
    };

    try {
      let response;
      if (calendarId) {
        // Update existing
        response = await fetch(`/api/calendars/${calendarId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(calendarData)
        });
      } else {
        // Create new
        response = await fetch('/api/calendars', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(calendarData)
        });
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || (window.translations?.dashboard?.failedToSaveCalendar || 'Failed to save calendar'));
      }

      this.showNotification(calendarId ? (window.translations?.dashboard?.calendarUpdated || 'Calendar updated!') : (window.translations?.dashboard?.calendarCreated || 'Calendar created!'), 'success');
      this.showCalendarList();
      this.loadCalendarList();

    } catch (error) {
      console.error('Error saving calendar:', error);
      this.showNotification((window.translations?.dashboard?.failedToSaveCalendar || 'Failed to save calendar') + ': ' + error.message, 'error');
    }
  }

  deleteCalendarConfirm(calendarId) {
    if (!confirm(window.translations?.dashboard?.deleteCalendarConfirm || 'Delete this calendar? This will also cancel any queued items.')) return;
    this.deleteCalendar(calendarId);
  }

  async deleteCalendar(calendarId) {
    try {
      const response = await fetch(`/api/calendars/${calendarId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || (window.translations?.dashboard?.failedToDeleteCalendar || 'Failed to delete calendar'));
      }

      this.showNotification(window.translations?.dashboard?.calendarDeleted || 'Calendar deleted', 'success');
      this.loadCalendarList();

    } catch (error) {
      console.error('Error deleting calendar:', error);
      this.showNotification(window.translations?.dashboard?.failedToDeleteCalendar || 'Failed to delete calendar', 'error');
    }
  }

  escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  async loadSocialConnections() {
    const container = document.getElementById('socialAccountsContainer');

    if (!container) return;

    try {
      const response = await fetch('/api/social/status');
      const data = await response.json();

      if (data.success) {
        this.socialConnections = data.connections || [];
        this.renderSocialConnections();
      } else {
        console.error('Social connections API returned error:', data);
        this.socialConnections = [];
        this.renderSocialConnections();
      }
    } catch (error) {
      console.error('Error loading social connections:', error);
      this.socialConnections = [];
      this.renderSocialConnections();
    }
  }

  renderSocialConnections() {
    const container = document.getElementById('socialAccountsContainer');
    const noAccountsMessage = document.getElementById('noSocialAccountsMessage');

    if (!container) return;

    if (this.socialConnections.length === 0) {
      container.style.display = 'none';
      if (noAccountsMessage) {
        noAccountsMessage.style.display = 'block';
      }
      return;
    }

    container.style.display = 'block';
    if (noAccountsMessage) {
      noAccountsMessage.style.display = 'none';
    }

    const platformIcons = {
      instagram: '<i class="bi bi-instagram me-1"></i>',
      twitter: '<i class="bi bi-twitter-x me-1"></i>'
    };

    const html = this.socialConnections.map(conn => {
      const icon = platformIcons[conn.platform] || '<i class="bi bi-globe me-1"></i>';
      const checkboxId = `socialAccount_${conn.id}`;
      const isSelected = this.selectedSocialAccountIds.has(conn.id);

      return `
        <div class="form-check">
          <input class="form-check-input social-account-checkbox"
                 type="checkbox"
                 id="${checkboxId}"
                 value="${conn.id}"
                 data-platform="${conn.platform}"
                 data-username="${this.escapeHtml(conn.username)}"
                 ${isSelected ? 'checked' : ''}>
          <label class="form-check-label" for="${checkboxId}">
            ${icon}@${this.escapeHtml(conn.username)}
          </label>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="d-flex flex-wrap gap-3">${html}</div>`;

    // Add event listeners for checkboxes
    container.querySelectorAll('.social-account-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.selectedSocialAccountIds.add(e.target.value);
        } else {
          this.selectedSocialAccountIds.delete(e.target.value);
        }
      });
    });
  }

  openConnectionsSettings() {
    // Try to open the settings modal on connections tab
    if (typeof window.SocialConnections !== 'undefined' && window.SocialConnections.openSettingsConnectionsTab) {
      window.SocialConnections.openSettingsConnectionsTab();
    } else {
      // Fallback: try to open settings modal directly
      const settingsModal = document.getElementById('settingsModal');
      if (settingsModal) {
        const modal = new bootstrap.Modal(settingsModal);
        modal.show();
        setTimeout(() => {
          const connectionsTab = document.getElementById('connections-tab');
          if (connectionsTab) {
            connectionsTab.click();
          }
        }, 300);
      }
    }
  }

  async loadSchedules() {
    const grid = document.getElementById('schedulesGrid');
    const spinner = document.getElementById('loadingSpinner');
    const noSchedules = document.getElementById('noSchedules');
    
    if (!grid) return;
    
    spinner.style.display = 'block';
    grid.innerHTML = '';
    noSchedules.style.display = 'none';

    try {
      const params = new URLSearchParams({
        page: this.currentPage,
        limit: this.limit,
        ...(this.filters.type && { type: this.filters.type }),
        ...(this.filters.status && { status: this.filters.status }),
        ...(this.filters.actionType && { actionType: this.filters.actionType })
      });

      const response = await fetch(`/api/schedules?${params}`);
      const data = await response.json();

      spinner.style.display = 'none';

      if (!data.success) {
        throw new Error(data.error || (window.translations?.dashboard?.failedToLoadSchedules || 'Failed to load schedules'));
      }

      if (data.schedules.length === 0) {
        noSchedules.style.display = 'block';
        return;
      }

      // Render schedules
      data.schedules.forEach(schedule => {
        grid.appendChild(this.createScheduleCard(schedule));
      });

      // Render pagination
      this.renderPagination(data.pagination);

    } catch (error) {
      console.error('Error loading schedules:', error);
      spinner.style.display = 'none';
      this.showNotification(window.translations?.dashboard?.failedToLoadSchedules || 'Failed to load schedules', 'error');
    }
  }

  createScheduleCard(schedule) {
    const card = document.createElement('div');
    card.className = 'col-sm-6 col-lg-4';
    card.dataset.scheduleId = schedule._id;

    const isRecurring = schedule.type === 'recurring';
    const actionIcon = this.getActionIcon(schedule.actionType);
    const t = window.translations?.dashboard || {};

    card.innerHTML = `
      <div class="schedule-card h-100">
        <div class="card-header">
          <span class="schedule-type-badge ${isRecurring ? 'recurring' : 'single'}">
            <i class="bi bi-${isRecurring ? 'arrow-repeat' : 'calendar-event'}"></i>
            ${isRecurring ? (t.recurring || 'Recurring') : (t.single || 'Single')}
          </span>
          <span class="schedule-status-badge ${schedule.status}">
            ${this.capitalizeFirst(schedule.status)}
          </span>
        </div>
        <div class="card-body">
          <h6 class="card-title text-white mb-3">
            <i class="bi ${actionIcon} me-2" style="color: var(--sched-primary-light);"></i>
            ${schedule.description || this.formatActionType(schedule.actionType)}
          </h6>

          ${isRecurring ? `
            ${schedule.useCalendar && schedule.calendarName ? `
              <p class="small mb-2" style="color: var(--sched-primary-light);">
                <i class="bi bi-calendar-week me-1"></i>
                ${t.calendar || 'Calendar'}: ${this.escapeHtml(schedule.calendarName)}
              </p>
            ` : `
              <p class="small mb-2" style="color: var(--sched-primary-light);">
                <i class="bi bi-clock me-1"></i>
                ${t.cron || 'Cron'}: <code>${schedule.cronExpression || 'N/A'}</code>
              </p>
            `}
            <p class="small mb-2" style="color: var(--sched-text-secondary);">
              <i class="bi bi-play-circle me-1"></i>
              ${t.runs || 'Runs'}: ${schedule.executionCount || 0}${schedule.maxExecutions ? '/' + schedule.maxExecutions : ''}
            </p>
            ${schedule.nextExecutionAt ? `
              <p class="small mb-2" style="color: #fbbf24;">
                <i class="bi bi-arrow-right me-1"></i>
                ${t.next || 'Next'}: ${this.formatDate(schedule.nextExecutionAt)}
              </p>
            ` : ''}
          ` : `
            <p class="small mb-2" style="color: #fbbf24;">
              <i class="bi bi-calendar me-1"></i>
              ${t.scheduled || 'Scheduled'}: ${this.formatDate(schedule.scheduledFor)}
            </p>
          `}

          ${schedule.lastExecutedAt ? `
            <p class="small mb-2" style="color: #34d399;">
              <i class="bi bi-check me-1"></i>
              ${t.lastRun || 'Last run'}: ${this.formatDate(schedule.lastExecutedAt)}
            </p>
          ` : ''}

          <p class="small mb-0" style="color: var(--sched-text-muted);">
            <i class="bi bi-calendar-plus me-1"></i>
            ${t.created || 'Created'}: ${this.formatDate(schedule.createdAt)}
          </p>
        </div>
        <div class="card-footer">
          <div class="schedule-card-actions">
            <button class="btn btn-outline-primary" onclick="schedulesDashboard.viewSchedule('${schedule._id}')" title="View">
              <i class="bi bi-eye"></i>
            </button>
            <button class="btn btn-outline-secondary" onclick="schedulesDashboard.editSchedule('${schedule._id}')" title="Edit">
              <i class="bi bi-pencil"></i>
            </button>
            ${schedule.status === 'active' ? `
              <button class="btn btn-outline-warning" onclick="schedulesDashboard.pauseSchedule('${schedule._id}')" title="Pause">
                <i class="bi bi-pause"></i>
              </button>
            ` : ''}
            ${schedule.status === 'paused' ? `
              <button class="btn btn-outline-success" onclick="schedulesDashboard.resumeSchedule('${schedule._id}')" title="Resume">
                <i class="bi bi-play"></i>
              </button>
            ` : ''}
            ${schedule.status === 'pending' ? `
              <button class="btn btn-outline-secondary" onclick="schedulesDashboard.cancelSchedule('${schedule._id}')" title="Cancel">
                <i class="bi bi-x-circle"></i>
              </button>
            ` : ''}
            <button class="btn btn-outline-danger" onclick="schedulesDashboard.deleteSchedule('${schedule._id}')" title="Delete">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;

    return card;
  }

  async loadStats() {
    try {
      const response = await fetch('/api/schedules/stats');
      const data = await response.json();

      if (!data.success) return;

      const stats = data.stats;
      document.getElementById('totalSchedules').textContent = stats.total || 0;
      document.getElementById('activeSchedules').textContent = (stats.active || 0) + (stats.pending || 0);
      document.getElementById('pausedSchedules').textContent = stats.paused || 0;
      document.getElementById('completedSchedules').textContent = stats.completed || 0;

    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }

  openCreateModal(type = 'single') {
    // Reset form
    document.getElementById('scheduleId').value = '';
    document.getElementById('scheduleDescription').value = '';
    document.getElementById('actionPrompt').value = '';

    // Reset calendar selection (single schedule)
    this.selectedCalendarId = '';
    this.nextAvailableSlot = null;
    const calendarSelect = document.getElementById('calendarSelect');
    if (calendarSelect) calendarSelect.value = '';
    const nextSlotPreview = document.getElementById('nextSlotPreview');
    if (nextSlotPreview) nextSlotPreview.style.display = 'none';

    // Reset calendar selection (recurring schedule)
    this.selectedRecurringCalendarId = '';
    this.recurringNextAvailableSlot = null;
    const recurringCalendarSelect = document.getElementById('recurringCalendarSelect');
    if (recurringCalendarSelect) recurringCalendarSelect.value = '';
    const recurringNextSlotPreview = document.getElementById('recurringNextSlotPreview');
    if (recurringNextSlotPreview) recurringNextSlotPreview.style.display = 'none';
    const cronSection = document.getElementById('cronExpressionSection');
    if (cronSection) cronSection.style.display = 'block';
    
    // Reset action type to generate_image
    this.selectActionType('generate_image');
    
    // Reset model to first available or flux-2-flex
    const firstModel = document.querySelector('.model-dropdown-item');
    if (firstModel) {
      this.selectModel(firstModel.dataset.value, firstModel.dataset.name);
    } else {
      document.getElementById('actionModel').value = 'flux-2-flex';
    }
    
    // Reset character selection
    this.selectedCharacterId = '';
    document.querySelectorAll('.character-selection-item').forEach(item => {
      item.classList.remove('active');
    });
    
    // Select the "None" option first
    const noneItem = document.querySelector('.character-selection-item[data-character-id=""]');
    if (noneItem) {
      noneItem.classList.add('active');
    }
    
    // Reset social account selections
    this.selectedSocialAccountIds.clear();
    document.querySelectorAll('.social-account-checkbox').forEach(checkbox => {
      checkbox.checked = false;
    });
    
    // Reset prompt type to manual
    document.getElementById('promptTypeManual').checked = true;
    this.togglePromptType('manual');
    
    // Clear custom prompt selections
    this.selectedCustomPromptIds.clear();
    document.querySelectorAll('.custom-prompt-card').forEach(card => {
      card.classList.remove('selected');
    });
    this.updateSelectedPromptsInfo();
    
    // Set default schedule time (tomorrow at 9 AM)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    document.getElementById('scheduledFor').value = tomorrow.toISOString().slice(0, 16);
    
    // Recurring fields
    document.getElementById('cronExpression').value = '0 9 * * *';
    document.getElementById('maxExecutions').value = '';
    document.getElementById('endDate').value = '';
    document.getElementById('mutationEnabled').checked = false;
    
    // Clear test run preview
    this.clearTestRun();
    
    // Set type
    document.getElementById(`type${type === 'single' ? 'Single' : 'Recurring'}`).checked = true;
    this.toggleScheduleType(type);
    
    // Update modal title
    const t = window.translations?.dashboard || {};
    document.getElementById('scheduleModalTitle').innerHTML = `
      <i class="bi bi-calendar-plus me-2"></i>${type === 'single' ? (t.createSingleSchedule || 'Create Schedule') : (t.createRecurringJob || 'Create Recurring Job')}
    `;
    
    this.scheduleModal?.show();
  }

  async editSchedule(scheduleId) {
    try {
      const response = await fetch(`/api/schedules/${scheduleId}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || (window.translations?.dashboard?.failedToLoadSchedule || 'Failed to load schedule'));
      }

      const schedule = data.schedule;
      
      // Populate form
      document.getElementById('scheduleId').value = schedule._id;
      document.getElementById('scheduleDescription').value = schedule.description || '';
      document.getElementById('actionPrompt').value = schedule.actionData?.prompt || '';

      // Reset calendar selection (editing uses manual time)
      this.selectedCalendarId = '';
      this.nextAvailableSlot = null;
      const calendarSelect = document.getElementById('calendarSelect');
      if (calendarSelect) calendarSelect.value = '';
      const nextSlotPreview = document.getElementById('nextSlotPreview');
      if (nextSlotPreview) nextSlotPreview.style.display = 'none';

      // Update action type selector
      this.selectActionType(schedule.actionType);
      
      // Update model selector
      const modelId = schedule.actionData?.model || 'flux-2-flex';
      const modelItem = document.querySelector(`.model-dropdown-item[data-value="${modelId}"]`);
      if (modelItem) {
        this.selectModel(modelId, modelItem.dataset.name);
      } else {
        document.getElementById('actionModel').value = modelId;
      }
      
      // Restore character selection
      const characterId = schedule.actionData?.characterId || '';
      this.selectedCharacterId = characterId;

      // Update character selection UI
      document.querySelectorAll('.character-selection-item').forEach(item => {
        item.classList.remove('active');
      });

      if (characterId) {
        const characterItem = document.querySelector(`.character-selection-item[data-character-id="${characterId}"]`);
        if (characterItem) {
          characterItem.classList.add('active');
        }
      } else {
        // Select "None" option (first item without data-character-id)
        const noneItem = document.querySelector('.character-selection-item:not([data-character-id])');
        if (noneItem) {
          noneItem.classList.add('active');
        }
      }

      // Restore social account selections
      this.selectedSocialAccountIds.clear();
      document.querySelectorAll('.social-account-checkbox').forEach(checkbox => {
        checkbox.checked = false;
      });

      if (schedule.actionData?.socialAccountIds?.length > 0) {
        schedule.actionData.socialAccountIds.forEach(accountId => {
          this.selectedSocialAccountIds.add(accountId);
          const checkbox = document.querySelector(`.social-account-checkbox[value="${accountId}"]`);
          if (checkbox) {
            checkbox.checked = true;
          }
        });
      } else if (schedule.actionData?.socialPlatforms?.length > 0) {
        // Fallback: select accounts by platform if accountIds not saved
        schedule.actionData.socialPlatforms.forEach(platform => {
          const checkbox = document.querySelector(`.social-account-checkbox[data-platform="${platform}"]`);
          if (checkbox) {
            checkbox.checked = true;
            this.selectedSocialAccountIds.add(checkbox.value);
          }
        });
      }

      // Set prompt type based on whether custom prompts are used
      if (schedule.actionData?.useCustomPrompts && schedule.actionData?.customPromptIds?.length > 0) {
        document.getElementById('promptTypeCustom').checked = true;
        this.togglePromptType('custom');
        
        // Restore selected custom prompts
        this.selectedCustomPromptIds.clear();
        schedule.actionData.customPromptIds.forEach(id => {
          this.selectedCustomPromptIds.add(id);
        });
        
        // Update UI
        document.querySelectorAll('.custom-prompt-card').forEach(card => {
          const promptId = card.dataset.promptId;
          if (this.selectedCustomPromptIds.has(promptId)) {
            card.classList.add('selected');
          }
        });
        this.updateSelectedPromptsInfo();
      } else {
        document.getElementById('promptTypeManual').checked = true;
        this.togglePromptType('manual');
      }
      
      // Set type
      const isRecurring = schedule.type === 'recurring';
      document.getElementById(`type${isRecurring ? 'Recurring' : 'Single'}`).checked = true;
      this.toggleScheduleType(schedule.type);
      
      if (isRecurring) {
        // Handle calendar-based vs cron-based recurring schedules
        const recurringCalendarSelect = document.getElementById('recurringCalendarSelect');
        const cronSection = document.getElementById('cronExpressionSection');
        const recurringNextSlotPreview = document.getElementById('recurringNextSlotPreview');
        
        if (schedule.useCalendar && schedule.calendarId) {
          // Calendar-based recurring schedule
          this.selectedRecurringCalendarId = schedule.calendarId;
          if (recurringCalendarSelect) recurringCalendarSelect.value = schedule.calendarId;
          if (cronSection) cronSection.style.display = 'none';
          // Fetch and show next slot
          this.fetchRecurringNextSlot(schedule.calendarId);
        } else {
          // Traditional cron-based schedule
          this.selectedRecurringCalendarId = '';
          if (recurringCalendarSelect) recurringCalendarSelect.value = '';
          if (cronSection) cronSection.style.display = 'block';
          if (recurringNextSlotPreview) recurringNextSlotPreview.style.display = 'none';
          document.getElementById('cronExpression').value = schedule.cronExpression || '';
        }
        
        document.getElementById('maxExecutions').value = schedule.maxExecutions || '';
        document.getElementById('endDate').value = schedule.endDate ? schedule.endDate.split('T')[0] : '';
        document.getElementById('mutationEnabled').checked = schedule.mutationEnabled || false;
      } else {
        document.getElementById('scheduledFor').value = schedule.scheduledFor ? 
          new Date(schedule.scheduledFor).toISOString().slice(0, 16) : '';
      }
      
      // Clear test run preview
      this.clearTestRun();
      
      // Update modal title
      document.getElementById('scheduleModalTitle').innerHTML = `
        <i class="bi bi-pencil me-2"></i>${window.translations?.dashboard?.editSchedule || 'Edit Schedule'}
      `;
      
      this.scheduleModal?.show();

    } catch (error) {
      console.error('Error loading schedule:', error);
      this.showNotification(window.translations?.dashboard?.failedToLoadSchedule || 'Failed to load schedule', 'error');
    }
  }

  async viewSchedule(scheduleId) {
    try {
      const response = await fetch(`/api/schedules/${scheduleId}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || (window.translations?.dashboard?.failedToLoadSchedule || 'Failed to load schedule'));
      }

      const schedule = data.schedule;
      const isRecurring = schedule.type === 'recurring';
      const t = window.translations?.dashboard || {};

      const bodyHtml = `
        <div class="row">
          <div class="col-md-6">
            <div class="mb-3">
              <label class="form-label">${t.type || 'Type'}</label>
              <p class="mb-0">
                <span class="schedule-type-badge ${isRecurring ? 'recurring' : 'single'}">
                  <i class="bi bi-${isRecurring ? 'arrow-repeat' : 'calendar-event'}"></i>
                  ${isRecurring ? (t.recurring || 'Recurring') : (t.single || 'Single')}
                </span>
              </p>
            </div>
            <div class="mb-3">
              <label class="form-label">${t.status || 'Status'}</label>
              <p class="mb-0">
                <span class="schedule-status-badge ${schedule.status}">
                  ${this.capitalizeFirst(schedule.status)}
                </span>
              </p>
            </div>
            <div class="mb-3">
              <label class="form-label">${t.action || 'Action'}</label>
              <p class="mb-0">${this.formatActionType(schedule.actionType)}</p>
            </div>
            ${schedule.description ? `
              <div class="mb-3">
                <label class="form-label">${t.description || 'Description'}</label>
                <p class="mb-0">${schedule.description}</p>
              </div>
            ` : ''}
          </div>
          <div class="col-md-6">
            ${isRecurring ? `
              ${schedule.useCalendar && schedule.calendarName ? `
                <div class="mb-3">
                  <label class="form-label">${t.calendar || 'Calendar'}</label>
                  <p class="mb-0">
                    <i class="bi bi-calendar-week me-1 text-info"></i>
                    ${this.escapeHtml(schedule.calendarName)}
                  </p>
                </div>
              ` : `
                <div class="mb-3">
                  <label class="form-label">${t.cronExpression || 'Cron Expression'}</label>
                  <p class="mb-0"><code>${schedule.cronExpression || 'N/A'}</code></p>
                </div>
              `}
              <div class="mb-3">
                <label class="form-label">${t.executions || 'Executions'}</label>
                <p class="mb-0">${schedule.executionCount || 0}${schedule.maxExecutions ? ' / ' + schedule.maxExecutions : ''}</p>
              </div>
              ${schedule.nextExecutionAt ? `
                <div class="mb-3">
                  <label class="form-label">${t.nextExecution || 'Next Execution'}</label>
                  <p class="mb-0" style="color: #fbbf24;">${this.formatDate(schedule.nextExecutionAt)}</p>
                </div>
              ` : ''}
            ` : `
              <div class="mb-3">
                <label class="form-label">${t.scheduledFor || 'Scheduled For'}</label>
                <p class="mb-0" style="color: #fbbf24;">${this.formatDate(schedule.scheduledFor)}</p>
              </div>
            `}
            ${schedule.lastExecutedAt ? `
              <div class="mb-3">
                <label class="form-label">${t.lastExecuted || 'Last Executed'}</label>
                <p class="mb-0" style="color: #34d399;">${this.formatDate(schedule.lastExecutedAt)}</p>
              </div>
            ` : ''}
            <div class="mb-3">
              <label class="form-label">${t.created || 'Created'}</label>
              <p class="mb-0">${this.formatDate(schedule.createdAt)}</p>
            </div>
          </div>
        </div>

        ${schedule.actionData?.prompt ? `
          <div class="mt-3 pt-3" style="border-top: 1px solid var(--sched-border);">
            <label class="form-label">${t.prompt || 'Prompt'}</label>
            <p class="mb-0 small" style="white-space: pre-wrap; color: var(--sched-text-secondary);">${schedule.actionData.prompt}</p>
          </div>
        ` : ''}
        
        ${schedule.generatedPostIds && schedule.generatedPostIds.length > 0 ? `
          <div class="mt-3 pt-3 border-top border-secondary">
            <label class="form-label text-muted small">${t.generatedPosts || 'Generated Posts'}</label>
            <p class="mb-0">${schedule.generatedPostIds.length} ${t.postsCreated || 'posts created'}</p>
            <a href="/dashboard/posts" class="btn btn-sm btn-outline-primary mt-2">${t.viewPosts || 'View Posts'}</a>
          </div>
        ` : ''}
        
        ${schedule.error ? `
          <div class="mt-3 pt-3 border-top border-danger">
            <label class="form-label text-danger small">${t.lastError || 'Last Error'}</label>
            <p class="mb-0 text-danger small">${schedule.error}</p>
          </div>
        ` : ''}
      `;

      document.getElementById('viewScheduleBody').innerHTML = bodyHtml;
      
      // Update footer with actions
      const footerHtml = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${t.close || 'Close'}</button>
        <button type="button" class="btn btn-info" onclick="schedulesDashboard.editSchedule('${schedule._id}')">
          <i class="bi bi-pencil me-1"></i>${t.edit || 'Edit'}
        </button>
        ${schedule.status === 'active' ? `
          <button type="button" class="btn btn-warning" onclick="schedulesDashboard.pauseSchedule('${schedule._id}')">
            <i class="bi bi-pause me-1"></i>${t.pause || 'Pause'}
          </button>
        ` : ''}
        ${schedule.status === 'paused' ? `
          <button type="button" class="btn btn-success" onclick="schedulesDashboard.resumeSchedule('${schedule._id}')">
            <i class="bi bi-play me-1"></i>${t.resume || 'Resume'}
          </button>
        ` : ''}
      `;
      
      document.getElementById('viewScheduleFooter').innerHTML = footerHtml;
      
      this.viewScheduleModal?.show();

    } catch (error) {
      console.error('Error viewing schedule:', error);
      this.showNotification(window.translations?.dashboard?.failedToLoadScheduleDetails || 'Failed to load schedule details', 'error');
    }
  }

  async saveSchedule() {
    const scheduleId = document.getElementById('scheduleId').value;
    const type = document.getElementById('scheduleType').value;
    const description = document.getElementById('scheduleDescription').value;
    const actionType = document.getElementById('actionType').value;
    const model = document.getElementById('actionModel').value;
    
    // Get prompt type
    const promptType = document.querySelector('input[name="promptTypeRadio"]:checked').value;
    
    // Get character selection (from the new list-based selector)
    const characterId = this.selectedCharacterId || null;
    
    // Collect social platforms from connected accounts
    const socialPlatforms = [];
    const socialAccountIds = [];
    document.querySelectorAll('.social-account-checkbox:checked').forEach(checkbox => {
      socialPlatforms.push(checkbox.dataset.platform);
      socialAccountIds.push(checkbox.value);
    });
    
    const scheduleData = {
      type,
      actionType,
      description,
      actionData: {
        model,
        socialPlatforms,
        socialAccountIds,
        autoPublish: socialPlatforms.length > 0,
        characterId: characterId
      }
    };

    // Handle prompt based on type
    if (promptType === 'manual') {
      const prompt = document.getElementById('actionPrompt').value;
      scheduleData.actionData.prompt = prompt;
      scheduleData.actionData.useCustomPrompts = false;
    } else {
      // Custom prompts mode
      if (this.selectedCustomPromptIds.size === 0) {
        this.showNotification(window.translations?.dashboard?.selectAtLeastOnePrompt || 'Please select at least one custom prompt', 'warning');
        return;
      }
      scheduleData.actionData.useCustomPrompts = true;
      scheduleData.actionData.customPromptIds = Array.from(this.selectedCustomPromptIds);
      scheduleData.actionData.prompt = ''; // Optional: user can still provide additional context
    }

    if (type === 'single') {
      const scheduledFor = document.getElementById('scheduledFor').value;
      if (!scheduledFor) {
        this.showNotification(window.translations?.dashboard?.selectDateAndTime || 'Please select a date and time', 'warning');
        return;
      }
      scheduleData.scheduledFor = new Date(scheduledFor).toISOString();
    } else {
      // Check if using calendar-based scheduling or cron expression
      const recurringCalendarId = this.selectedRecurringCalendarId || document.getElementById('recurringCalendarSelect')?.value;
      const cronExpression = document.getElementById('cronExpression').value;
      
      if (recurringCalendarId) {
        // Calendar-based recurring schedule
        scheduleData.calendarId = recurringCalendarId;
        scheduleData.useCalendar = true;
        // Generate cron from calendar slots for backend compatibility
        const calendar = this.calendars.find(c => c._id === recurringCalendarId);
        if (calendar) {
          scheduleData.calendarName = calendar.name;
        }
      } else if (cronExpression) {
        // Traditional cron-based schedule
        scheduleData.cronExpression = cronExpression;
        scheduleData.useCalendar = false;
      } else {
        this.showNotification(window.translations?.dashboard?.selectCalendarOrCron || 'Please select a calendar or enter a cron expression', 'warning');
        return;
      }
      
      const maxExecutions = document.getElementById('maxExecutions').value;
      const endDate = document.getElementById('endDate').value;
      const mutationEnabled = document.getElementById('mutationEnabled').checked;
      
      if (maxExecutions) scheduleData.maxExecutions = parseInt(maxExecutions);
      if (endDate) scheduleData.endDate = endDate;
      scheduleData.mutationEnabled = mutationEnabled;
    }

    try {
      let response;
      if (scheduleId) {
        // Update existing
        response = await fetch(`/api/schedules/${scheduleId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scheduleData)
        });
      } else {
        // Create new
        response = await fetch('/api/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scheduleData)
        });
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || (window.translations?.dashboard?.failedToSaveSchedule || 'Failed to save schedule'));
      }

      this.showNotification(scheduleId ? (window.translations?.dashboard?.scheduleUpdated || 'Schedule updated!') : (window.translations?.dashboard?.scheduleCreated || 'Schedule created!'), 'success');
      this.scheduleModal?.hide();
      this.loadSchedules();
      this.loadStats();

    } catch (error) {
      console.error('Error saving schedule:', error);
      this.showNotification((window.translations?.dashboard?.failedToSaveSchedule || 'Failed to save schedule') + ': ' + error.message, 'error');
    }
  }

  async pauseSchedule(scheduleId) {
    try {
      const response = await fetch(`/api/schedules/${scheduleId}/pause`, {
        method: 'POST'
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || (window.translations?.dashboard?.failedToPauseSchedule || 'Failed to pause schedule'));
      }

      this.showNotification(window.translations?.dashboard?.schedulePaused || 'Schedule paused', 'success');
      this.viewScheduleModal?.hide();
      this.loadSchedules();
      this.loadStats();

    } catch (error) {
      console.error('Error pausing schedule:', error);
      this.showNotification(window.translations?.dashboard?.failedToPauseSchedule || 'Failed to pause schedule', 'error');
    }
  }

  async resumeSchedule(scheduleId) {
    try {
      const response = await fetch(`/api/schedules/${scheduleId}/resume`, {
        method: 'POST'
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || (window.translations?.dashboard?.failedToResumeSchedule || 'Failed to resume schedule'));
      }

      this.showNotification(window.translations?.dashboard?.scheduleResumed || 'Schedule resumed', 'success');
      this.viewScheduleModal?.hide();
      this.loadSchedules();
      this.loadStats();

    } catch (error) {
      console.error('Error resuming schedule:', error);
      this.showNotification(window.translations?.dashboard?.failedToResumeSchedule || 'Failed to resume schedule', 'error');
    }
  }

  async cancelSchedule(scheduleId) {
    if (!confirm(window.translations?.dashboard?.cancelScheduleConfirm || 'Cancel this schedule?')) return;

    try {
      const response = await fetch(`/api/schedules/${scheduleId}/cancel`, {
        method: 'POST'
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || (window.translations?.dashboard?.failedToCancelSchedule || 'Failed to cancel schedule'));
      }

      this.showNotification(window.translations?.dashboard?.scheduleCancelled || 'Schedule cancelled', 'success');
      this.loadSchedules();
      this.loadStats();

    } catch (error) {
      console.error('Error cancelling schedule:', error);
      this.showNotification(window.translations?.dashboard?.failedToCancelSchedule || 'Failed to cancel schedule', 'error');
    }
  }

  async deleteSchedule(scheduleId) {
    if (!confirm(window.translations?.dashboard?.deleteScheduleConfirm || 'Delete this schedule permanently?')) return;

    try {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || (window.translations?.dashboard?.failedToDeleteSchedule || 'Failed to delete schedule'));
      }

      this.showNotification(window.translations?.dashboard?.scheduleDeleted || 'Schedule deleted', 'success');
      this.loadSchedules();
      this.loadStats();

    } catch (error) {
      console.error('Error deleting schedule:', error);
      this.showNotification(window.translations?.dashboard?.failedToDeleteSchedule || 'Failed to delete schedule', 'error');
    }
  }

  renderPagination(pagination) {
    const container = document.getElementById('pagination');
    if (!container) return;

    container.innerHTML = '';

    if (pagination.totalPages <= 1) return;

    if (pagination.page > 1) {
      const prev = document.createElement('button');
      prev.className = 'btn btn-outline-primary';
      prev.innerHTML = `<i class="bi bi-chevron-left"></i> ${window.translations?.dashboard?.previous || 'Previous'}`;
      prev.onclick = () => {
        this.currentPage--;
        this.loadSchedules();
      };
      container.appendChild(prev);
    }

    const pageInfo = document.createElement('span');
    pageInfo.className = 'mx-3 text-white align-self-center';
    const t = window.translations?.dashboard || {};
    pageInfo.textContent = `${t.page || 'Page'} ${pagination.page} ${t.of || 'of'} ${pagination.totalPages}`;
    container.appendChild(pageInfo);

    if (pagination.page < pagination.totalPages) {
      const next = document.createElement('button');
      next.className = 'btn btn-outline-primary';
      next.innerHTML = `${window.translations?.dashboard?.next || 'Next'} <i class="bi bi-chevron-right"></i>`;
      next.onclick = () => {
        this.currentPage++;
        this.loadSchedules();
      };
      container.appendChild(next);
    }
  }

  getStatusColor(status) {
    const colors = {
      'pending': 'secondary',
      'active': 'success',
      'paused': 'warning',
      'completed': 'info',
      'failed': 'danger',
      'cancelled': 'dark'
    };
    return colors[status] || 'secondary';
  }

  getActionIcon(actionType) {
    const icons = {
      'generate_image': 'bi-image',
      'generate_video': 'bi-film',
      'publish_post': 'bi-send'
    };
    return icons[actionType] || 'bi-gear';
  }

  formatActionType(actionType) {
    const t = window.translations?.dashboard || {};
    const types = {
      'generate_image': t.generateImage || 'Generate Image',
      'generate_video': t.generateVideo || 'Generate Video',
      'publish_post': t.publishPost || 'Publish Post'
    };
    return types[actionType] || actionType;
  }

  formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  showNotification(message, type = 'info') {
    if (typeof window.showNotification === 'function') {
      window.showNotification(message, type);
      return;
    }
    
    const bgClass = type === 'error' ? 'bg-danger' : type === 'success' ? 'bg-success' : type === 'warning' ? 'bg-warning' : 'bg-info';
    
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white ${bgClass} border-0`;
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
      container.style.zIndex = '1100';
      document.body.appendChild(container);
    }
    
    container.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();
    
    toast.addEventListener('hidden.bs.toast', () => toast.remove());
  }

  /**
   * Run a test generation with current form settings
   */
  async runTestGeneration() {
    if (this.testRunInProgress) {
      this.showNotification(window.translations?.dashboard?.testAlreadyInProgress || 'Test already in progress', 'warning');
      return;
    }

    const prompt = document.getElementById('actionPrompt').value.trim();
    const model = document.getElementById('actionModel').value;
    const actionType = document.getElementById('actionType').value;
    
    // Check if using custom prompts
    const promptType = document.querySelector('input[name="promptTypeRadio"]:checked')?.value;
    const useCustomPrompts = promptType === 'custom';
    const customPromptIds = useCustomPrompts ? Array.from(this.selectedCustomPromptIds) : [];

    // Validate: either manual prompt or custom prompts must be provided
    if (!useCustomPrompts && !prompt) {
      this.showNotification(window.translations?.dashboard?.enterPromptFirst || 'Please enter a prompt first', 'warning');
      return;
    }
    
    if (useCustomPrompts && customPromptIds.length === 0) {
      this.showNotification(window.translations?.dashboard?.selectAtLeastOnePrompt || 'Please select at least one custom prompt', 'warning');
      return;
    }

    if (actionType !== 'generate_image') {
      this.showNotification(window.translations?.dashboard?.testRunOnlyImage || 'Test run only supports image generation', 'info');
      return;
    }

    // Show loading state
    this.testRunInProgress = true;
    const testRunBtn = document.getElementById('testRunBtn');
    const testRunPreview = document.getElementById('testRunPreview');
    const testRunLoading = document.getElementById('testRunLoading');
    const testRunResult = document.getElementById('testRunResult');
    const testRunError = document.getElementById('testRunError');

    testRunBtn.disabled = true;
    testRunBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>' + (window.translations?.dashboard?.running || 'Running...');
    testRunPreview.style.display = 'block';
    testRunLoading.style.display = 'block';
    testRunResult.style.display = 'none';
    testRunError.style.display = 'none';

    try {
      const requestBody = {
        prompt,
        model,
        actionType,
        useCustomPrompts,
        customPromptIds,
        characterId: this.selectedCharacterId || null
      };
      console.log('[Schedule] Test run request:', requestBody);
      console.log('[Schedule] Model being sent:', model);

      const response = await fetch('/api/schedules/test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Test run failed');
      }

      // Show result
      testRunLoading.style.display = 'none';
      testRunResult.style.display = 'block';
      
      const testRunImage = document.getElementById('testRunImage');
      testRunImage.src = data.imageUrl;
      this.lastTestRunImage = data.imageUrl;

      const testRunInfo = document.getElementById('testRunInfo');
      const seconds = (data.generationTimeMs / 1000).toFixed(1);
      testRunInfo.innerHTML = `
        <i class="bi bi-clock me-1"></i>${seconds}s · 
        <i class="bi bi-coin me-1"></i>${data.pointsUsed} pts · 
        <span class="text-success">${window.translations?.dashboard?.savedToPosts || 'Saved to Posts'}</span>
      `;

      this.showNotification(window.translations?.dashboard?.testImageGenerated || 'Test image generated successfully!', 'success');

    } catch (error) {
      console.error('Test run error:', error);
      testRunLoading.style.display = 'none';
      testRunError.style.display = 'block';
      document.getElementById('testRunErrorMsg').textContent = error.message;
      this.showNotification((window.translations?.dashboard?.testRunFailed || 'Test run failed') + ': ' + error.message, 'error');
    } finally {
      this.testRunInProgress = false;
      testRunBtn.disabled = false;
      testRunBtn.innerHTML = '<i class="bi bi-play-circle me-1"></i>' + (window.translations?.dashboard?.testRunButton || 'Test Run');
    }
  }

  /**
   * Clear the test run preview
   */
  clearTestRun() {
    const testRunPreview = document.getElementById('testRunPreview');
    const testRunLoading = document.getElementById('testRunLoading');
    const testRunResult = document.getElementById('testRunResult');
    const testRunError = document.getElementById('testRunError');

    testRunPreview.style.display = 'none';
    testRunLoading.style.display = 'none';
    testRunResult.style.display = 'none';
    testRunError.style.display = 'none';
    this.lastTestRunImage = null;
  }

  /**
   * Expand test image in a larger modal
   */
  expandTestImage() {
    if (!this.lastTestRunImage) return;

    // Create a fullscreen modal for the image
    const t = window.translations?.dashboard || {};
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
      <div class="modal-dialog modal-xl modal-dialog-centered">
        <div class="modal-content bg-dark border-secondary">
          <div class="modal-header border-secondary">
            <h5 class="modal-title text-white">
              <i class="bi bi-image me-2"></i>${t.testRunResult || 'Test Run Result'}
            </h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body text-center p-2">
            <img src="${this.lastTestRunImage}" alt="${t.testRunResult || 'Test Result'}" class="img-fluid">
          </div>
          <div class="modal-footer border-secondary">
            <a href="${this.lastTestRunImage}" target="_blank" class="btn btn-outline-info">
              <i class="bi bi-box-arrow-up-right me-1"></i>${t.openFullSize || 'Open Full Size'}
            </a>
            <a href="/dashboard/posts" class="btn btn-outline-primary">
              <i class="bi bi-collection me-1"></i>${t.viewInPosts || 'View in Posts'}
            </a>
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${t.close || 'Close'}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();

    modal.addEventListener('hidden.bs.modal', () => {
      modal.remove();
    });
  }
}

// Helper function for cron presets
function setCronPreset(expression) {
  document.getElementById('cronExpression').value = expression;
}

// Initialize dashboard
let schedulesDashboard;
document.addEventListener('DOMContentLoaded', () => {
  schedulesDashboard = new SchedulesDashboard();
});
