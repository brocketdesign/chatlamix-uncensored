/**
 * My Posts Dashboard
 * Frontend logic for viewing and managing posts (unified posts + chat posts)
 */

/**
 * Caption History Management (shared utility)
 */
const CaptionHistory = window.CaptionHistory || {
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
      
      // Check for duplicates
      const exists = history.some(h => h.caption === newEntry.caption);
      if (!exists) {
        history.unshift(newEntry);
        if (history.length > this.MAX_ITEMS) {
          history.splice(this.MAX_ITEMS);
        }
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
      }
      
      this.renderHistory('editCaptionHistory', 'editCaptionText');
    } catch (e) {
      console.error('[CaptionHistory] Error saving caption:', e);
    }
  },
  
  deleteCaption(captionId) {
    try {
      const history = this.getHistory();
      const filtered = history.filter(h => h.id !== captionId);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filtered));
      this.renderHistory('editCaptionHistory', 'editCaptionText');
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
        if (typeof window.showNotification === 'function') {
          window.showNotification('Caption applied!', 'success');
        }
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

class PostsDashboard {
  constructor() {
    this.currentPage = 1;
    this.limit = 20;
    this.filters = {
      type: '',
      status: '',
      source: '',
      sortBy: 'createdAt',
      sortOrder: 'desc'
    };
    this.currentPost = null;
    this.postModal = null;
    this.scheduleModal = null;
    this.editCaptionModal = null;
    
    this.init();
  }

  init() {
    this.setupModals();
    this.setupEventListeners();
    this.loadPosts();
    this.loadStats();
  }

  setupModals() {
    // Initialize Bootstrap modals
    const postModalEl = document.getElementById('postModal');
    const scheduleModalEl = document.getElementById('scheduleModal');
    const editCaptionModalEl = document.getElementById('editCaptionModal');
    
    if (postModalEl) {
      this.postModal = new bootstrap.Modal(postModalEl);
    }
    if (scheduleModalEl) {
      this.scheduleModal = new bootstrap.Modal(scheduleModalEl);
    }
    if (editCaptionModalEl) {
      this.editCaptionModal = new bootstrap.Modal(editCaptionModalEl);
    }
    
    // Load connected accounts for schedule modal
    this.loadConnectedAccounts();
  }
  
  async loadConnectedAccounts() {
    try {
      const response = await fetch('/api/social/status');
      const data = await response.json();
      
      this.connectedAccounts = data.connections || [];
      this.renderPlatformButtons();
    } catch (error) {
      console.error('Error loading connected accounts:', error);
      this.connectedAccounts = [];
      this.renderPlatformButtons();
    }
  }
  
  renderPlatformButtons() {
    const container = document.getElementById('connectedPlatformsContainer');
    const noAccountsMsg = document.getElementById('noPlatformsMessage');
    
    if (!container) return;
    
    // Always hide the no platforms message since we always show My Profile
    if (noAccountsMsg) noAccountsMsg.style.display = 'none';
    
    const platformIcons = {
      instagram: 'bi-instagram',
      twitter: 'bi-twitter-x'
    };
    
    const platformColors = {
      instagram: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
      twitter: '#000'
    };
    
    // Always show My Profile first
    let html = `
      <button type="button" 
              class="sns-platform-btn" 
              data-platform="profile"
              data-account-id="profile">
        <i class="bi bi-person-circle"></i>
        <span>My Profile</span>
      </button>
    `;
    
    // Add connected SNS accounts
    if (this.connectedAccounts && this.connectedAccounts.length > 0) {
      html += this.connectedAccounts.map(account => `
        <button type="button" 
                class="sns-platform-btn" 
                data-platform="${account.platform}"
                data-account-id="${account.id}">
          <i class="bi ${platformIcons[account.platform] || 'bi-share'}"></i>
          <span>@${account.username}</span>
        </button>
      `).join('');
    }
    
    container.innerHTML = html;
    
    // Add click handlers
    container.querySelectorAll('.sns-platform-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        this.updatePublishButtons();
      });
    });
  }
  
  updatePublishButtons() {
    const hasProfileSelected = document.querySelector('.sns-platform-btn[data-platform="profile"].active');
    const publishNowBtn = document.getElementById('publishNowBtn');
    
    if (publishNowBtn) {
      publishNowBtn.style.display = hasProfileSelected ? 'inline-flex' : 'none';
    }
  }
  
  getSelectedPlatforms() {
    const container = document.getElementById('connectedPlatformsContainer');
    if (!container) return { profile: false, platforms: [] };
    
    const selectedButtons = container.querySelectorAll('.sns-platform-btn.active');
    const platforms = Array.from(selectedButtons).map(btn => btn.dataset.platform);
    
    return {
      profile: platforms.includes('profile'),
      platforms: platforms.filter(p => p !== 'profile')
    };
  }

  setupEventListeners() {
    // Filter changes
    document.getElementById('filterType')?.addEventListener('change', (e) => {
      this.filters.type = e.target.value;
      this.currentPage = 1;
      this.loadPosts();
    });

    document.getElementById('filterStatus')?.addEventListener('change', (e) => {
      this.filters.status = e.target.value;
      this.currentPage = 1;
      this.loadPosts();
    });

    document.getElementById('filterSource')?.addEventListener('change', (e) => {
      this.filters.source = e.target.value;
      this.currentPage = 1;
      this.loadPosts();
    });

    document.getElementById('filterSort')?.addEventListener('change', (e) => {
      this.filters.sortBy = e.target.value;
      this.currentPage = 1;
      this.loadPosts();
    });

    // Reset filters
    document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
      this.resetFilters();
    });
  }

  resetFilters() {
    this.filters = {
      type: '',
      status: '',
      source: '',
      sortBy: 'createdAt',
      sortOrder: 'desc'
    };
    
    document.getElementById('filterType').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterSource').value = '';
    document.getElementById('filterSort').value = 'createdAt';
    
    this.currentPage = 1;
    this.loadPosts();
  }

  async loadPosts() {
    const grid = document.getElementById('postsGrid');
    const spinner = document.getElementById('loadingSpinner');
    const noPosts = document.getElementById('noPosts');
    
    if (!grid) return;
    
    spinner.style.display = 'block';
    grid.innerHTML = '';
    noPosts.style.display = 'none';

    try {
      const params = new URLSearchParams({
        page: this.currentPage,
        limit: this.limit,
        sortBy: this.filters.sortBy,
        sortOrder: this.filters.sortOrder,
        ...(this.filters.type && { type: this.filters.type }),
        ...(this.filters.status && { status: this.filters.status }),
        ...(this.filters.source && { source: this.filters.source })
      });

      const response = await fetch(`/api/posts?${params}`);
      const data = await response.json();

      spinner.style.display = 'none';

      if (!data.success) {
        throw new Error(data.error || 'Failed to load posts');
      }

      if (data.posts.length === 0) {
        noPosts.style.display = 'block';
        return;
      }

      // Render posts
      data.posts.forEach(post => {
        grid.appendChild(this.createPostCard(post));
      });

      // Render pagination
      this.renderPagination(data.pagination);

      // Update stats
      this.updateStatsFromPosts(data.posts, data.pagination.total);

    } catch (error) {
      console.error('Error loading posts:', error);
      spinner.style.display = 'none';
      this.showNotification('Failed to load posts', 'error');
    }
  }

  createPostCard(post) {
    const card = document.createElement('div');
    card.className = 'col-sm-6 col-md-4 col-lg-3';
    card.dataset.postId = post._id;

    const statusClass = post.status || 'draft';
    const typeIcon = post.type === 'video' ? 'bi-film' : 'bi-image';
    const sourceLabel = this.formatSource(post.source);
    const isLegacyChat = post._isLegacyChatPost;
    
    // Get media URL
    let mediaUrl = '/img/placeholder.png';
    let isVideo = false;
    if (post.type === 'image') {
      mediaUrl = post.content?.imageUrl || post.content?.thumbnailUrl || mediaUrl;
    } else if (post.type === 'video') {
      mediaUrl = post.content?.thumbnailUrl || post.content?.videoUrl || mediaUrl;
      isVideo = true;
    }

    // Get caption/comment
    const caption = post.content?.caption || post.content?.prompt?.substring(0, 80) || '';

    card.innerHTML = `
      <div class="card bg-dark border-secondary h-100 post-card-item">
        <div class="position-relative">
          ${isVideo ? '<div class="video-overlay"><i class="bi bi-play-circle-fill"></i></div>' : ''}
          <img src="${mediaUrl}" 
               class="card-img-top" 
               alt="Post" 
               style="aspect-ratio: 9/16;object-fit: cover;"
               onerror="this.src='/img/placeholder.png'">
          ${post.metadata?.nsfw ? '<span class="badge bg-danger position-absolute top-0 end-0 m-2">NSFW</span>' : ''}
          <span class="badge bg-${this.getStatusColor(statusClass)} position-absolute bottom-0 start-0 m-2">
            ${this.capitalizeFirst(statusClass)}
          </span>
          ${isLegacyChat ? '<span class="badge bg-info position-absolute bottom-0 end-0 m-2"><i class="bi bi-chat me-1"></i>Chat</span>' : ''}
        </div>
        <div class="card-body p-2">
          <div class="d-flex align-items-center justify-content-between mb-2">
            <small class="text-muted">
              <i class="bi ${typeIcon} me-1"></i>${this.capitalizeFirst(post.type)}
            </small>
            <small class="text-muted">
              ${this.formatDate(post.createdAt)}
            </small>
          </div>
          <p class="card-text text-white small mb-2" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
            ${this.escapeHtml(caption) || '<span class="text-muted">No caption</span>'}
          </p>
          ${post.scheduledFor ? `
            <div class="text-warning small mb-2">
              <i class="bi bi-calendar-event me-1"></i>
              ${this.formatDate(post.scheduledFor)}
            </div>
          ` : ''}
          <div class="d-flex gap-1 flex-wrap">
            <button class="btn btn-sm btn-outline-primary" onclick="postsDashboard.viewPost('${post._id}')" title="View">
              <i class="bi bi-eye"></i>
            </button>
            ${!isLegacyChat ? `
              <button class="btn btn-sm btn-outline-info" onclick="postsDashboard.editCaption('${post._id}')" title="Edit Caption">
                <i class="bi bi-pencil"></i>
              </button>
            ` : ''}
            ${post.status === 'draft' && !isLegacyChat ? `
              <button class="btn btn-sm btn-outline-warning" onclick="postsDashboard.openScheduleModal('${post._id}')" title="Schedule">
                <i class="bi bi-calendar-plus"></i>
              </button>
            ` : ''}
            ${post.status === 'scheduled' && !isLegacyChat ? `
              <button class="btn btn-sm btn-outline-secondary" onclick="postsDashboard.cancelSchedule('${post._id}')" title="Cancel Schedule">
                <i class="bi bi-calendar-x"></i>
              </button>
            ` : ''}
            ${!isLegacyChat ? `
              <button class="btn btn-sm btn-outline-danger" onclick="postsDashboard.deletePost('${post._id}')" title="Delete">
                <i class="bi bi-trash"></i>
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    return card;
  }

  async loadStats() {
    try {
      // Load all posts to get accurate counts
      const response = await fetch('/api/posts?limit=1000');
      const data = await response.json();

      if (!data.success) return;

      this.updateStatsFromPosts(data.posts, data.pagination.total);

    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }

  updateStatsFromPosts(posts, total) {
    const drafts = posts.filter(p => p.status === 'draft').length;
    const scheduled = posts.filter(p => p.status === 'scheduled').length;
    const published = posts.filter(p => p.status === 'published').length;

    document.getElementById('totalPosts').textContent = total || posts.length;
    document.getElementById('draftPosts').textContent = drafts;
    document.getElementById('scheduledPosts').textContent = scheduled;
    document.getElementById('publishedPosts').textContent = published;
  }

  async viewPost(postId) {
    try {
      const response = await fetch(`/api/posts/${postId}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to load post');
      }

      this.currentPost = data.post;
      this.showPostModal(data.post);

    } catch (error) {
      console.error('Error viewing post:', error);
      this.showNotification('Failed to load post details', 'error');
    }
  }

  showPostModal(post) {
    const modalBody = document.getElementById('modalBody');
    const modalFooter = document.getElementById('modalFooter');
    const isVideo = post.type === 'video';
    const mediaUrl = isVideo ? post.content?.videoUrl : post.content?.imageUrl;
    const isLegacyChat = post._isLegacyChatPost;

    modalBody.innerHTML = `
      <div class="row">
        <div class="col-md-6 mb-3">
          ${isVideo ? `
            <video controls class="w-100 rounded" style="max-height: 400px;">
              <source src="${mediaUrl}" type="video/mp4">
            </video>
          ` : `
            <img src="${mediaUrl}" alt="Post" class="w-100 rounded" style="max-height: 400px; object-fit: contain;">
          `}
        </div>
        <div class="col-md-6">
          <div class="mb-3">
            <label class="form-label text-muted small">Status</label>
            <div>
              <span class="badge bg-${this.getStatusColor(post.status)}">${this.capitalizeFirst(post.status)}</span>
              ${post.metadata?.nsfw ? '<span class="badge bg-danger ms-1">NSFW</span>' : ''}
            </div>
          </div>
          
          <div class="mb-3">
            <label class="form-label text-muted small">Source</label>
            <p class="mb-0">${this.formatSource(post.source)}</p>
          </div>
          
          <div class="mb-3">
            <label class="form-label text-muted small">Created</label>
            <p class="mb-0">${this.formatDate(post.createdAt)}</p>
          </div>
          
          ${post.scheduledFor ? `
            <div class="mb-3">
              <label class="form-label text-muted small">Scheduled For</label>
              <p class="mb-0 text-warning">${this.formatDate(post.scheduledFor)}</p>
            </div>
          ` : ''}
          
          ${post.content?.caption ? `
            <div class="mb-3">
              <label class="form-label text-muted small">Caption</label>
              <p class="mb-0">${this.escapeHtml(post.content.caption)}</p>
            </div>
          ` : ''}
          
          <div class="mb-3">
            <label class="form-label text-muted small">Prompt</label>
            <p class="mb-0 small text-secondary" style="max-height: 100px; overflow-y: auto;">${this.escapeHtml(post.content?.prompt || 'N/A')}</p>
          </div>
          
          ${post.content?.model ? `
            <div class="mb-3">
              <label class="form-label text-muted small">Model</label>
              <p class="mb-0 small">${post.content.model}</p>
            </div>
          ` : ''}
          
          ${post.socialPlatforms && post.socialPlatforms.length > 0 ? `
            <div class="mb-3">
              <label class="form-label text-muted small">Social Platforms</label>
              <p class="mb-0">${post.socialPlatforms.join(', ')}</p>
            </div>
          ` : ''}
          
          <div class="mb-3">
            <label class="form-label text-muted small">Engagement</label>
            <p class="mb-0">
              <i class="bi bi-heart text-danger me-1"></i>${post.likes || 0} likes
              <i class="bi bi-chat ms-2 me-1"></i>${post.comments?.length || 0} comments
            </p>
          </div>
        </div>
      </div>
    `;

    modalFooter.innerHTML = `
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
        <i class="bi bi-x me-1"></i>Close
      </button>
      ${!isLegacyChat ? `
        <button type="button" class="btn btn-info" onclick="postsDashboard.editCaption('${post._id}')">
          <i class="bi bi-pencil me-1"></i>Edit Caption
        </button>
        ${post.status === 'draft' ? `
          <button type="button" class="btn btn-primary" onclick="postsDashboard.openScheduleModal('${post._id}')">
            <i class="bi bi-calendar-plus me-1"></i>Schedule
          </button>
        ` : ''}
      ` : ''}
    `;

    this.postModal?.show();
  }

  editCaption(postId) {
    document.getElementById('editCaptionPostId').value = postId;
    
    // Load current caption if viewing post
    if (this.currentPost && this.currentPost._id === postId) {
      document.getElementById('editCaptionText').value = this.currentPost.content?.caption || '';
    } else {
      // Fetch post data
      fetch(`/api/posts/${postId}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            this.currentPost = data.post;
            document.getElementById('editCaptionText').value = data.post.content?.caption || '';
          }
        });
    }
    
    // Initialize caption history
    CaptionHistory.renderHistory('editCaptionHistory', 'editCaptionText');
    
    this.postModal?.hide();
    this.editCaptionModal?.show();
  }

  async regenerateCaption() {
    const postId = document.getElementById('editCaptionPostId').value;
    const captionInput = document.getElementById('editCaptionText');
    
    if (!this.currentPost) {
      this.showNotification('Please wait for post to load', 'warning');
      return;
    }

    captionInput.disabled = true;
    captionInput.placeholder = 'Generating caption...';

    try {
      // Get style and language from dropdowns
      const captionStyle = document.getElementById('editCaptionStyle')?.value || 'engaging';
      const captionLanguage = document.getElementById('editCaptionLanguage')?.value || 'english';
      
      // Get existing caption (if any) to use as a starting point
      const existingCaption = captionInput.value.trim();
      
      const response = await fetch('/api/posts/generate-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: this.currentPost.content?.prompt || '',
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
        CaptionHistory.saveCaption(data.caption, postId);
        this.showNotification('Caption generated!', 'success');
      } else {
        throw new Error(data.error || 'Failed to generate caption');
      }
    } catch (error) {
      console.error('Error generating caption:', error);
      this.showNotification('Failed to generate caption', 'error');
    } finally {
      captionInput.disabled = false;
      captionInput.placeholder = 'Enter your caption...';
    }
  }

  async saveCaption() {
    const postId = document.getElementById('editCaptionPostId').value;
    const caption = document.getElementById('editCaptionText').value;

    try {
      const response = await fetch(`/api/posts/${postId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to save caption');
      }

      this.showNotification('Caption saved!', 'success');
      this.editCaptionModal?.hide();
      this.loadPosts();

    } catch (error) {
      console.error('Error saving caption:', error);
      this.showNotification('Failed to save caption', 'error');
    }
  }

  openScheduleModal(postId) {
    document.getElementById('schedulePostId').value = postId;
    
    // Set default date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    document.getElementById('scheduleDateTime').value = tomorrow.toISOString().slice(0, 16);
    
    // Reset platform buttons
    const container = document.getElementById('connectedPlatformsContainer');
    if (container) {
      container.querySelectorAll('.sns-platform-btn').forEach(btn => {
        btn.classList.remove('active');
      });
    }
    
    // Reset publish now button visibility
    this.updatePublishButtons();
    
    // Reset publish now checkbox
    const publishNowCheckbox = document.getElementById('publishNowCheckbox');
    if (publishNowCheckbox) {
      publishNowCheckbox.checked = false;
    }
    const scheduleDateTimeSection = document.getElementById('scheduleDateTimeSection');
    if (scheduleDateTimeSection) {
      scheduleDateTimeSection.style.display = 'block';
    }

    this.postModal?.hide();
    this.scheduleModal?.show();
  }

  togglePublishNow() {
    const checkbox = document.getElementById('publishNowCheckbox');
    const scheduleDateTimeSection = document.getElementById('scheduleDateTimeSection');

    if (checkbox && scheduleDateTimeSection) {
      scheduleDateTimeSection.style.display = checkbox.checked ? 'none' : 'block';
    }
  }

  async publishToProfileNow() {
    const postId = document.getElementById('schedulePostId').value;
    const selection = this.getSelectedPlatforms();
    
    if (!selection.profile) {
      this.showNotification('Please select My Profile to publish', 'warning');
      return;
    }

    try {
      // Update the post to be a profile post and publish it
      const response = await fetch(`/api/posts/${postId}/profile-status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isProfilePost: true })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to publish to profile');
      }

      // Update post status to published
      const publishResponse = await fetch(`/api/posts/${postId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const publishData = await publishResponse.json();

      if (!publishData.success) {
        throw new Error(publishData.error || 'Failed to publish post');
      }

      this.showNotification('Post published to your profile!', 'success');
      this.scheduleModal?.hide();
      this.loadPosts();
      this.loadStats();

    } catch (error) {
      console.error('Error publishing to profile:', error);
      this.showNotification('Failed to publish to profile', 'error');
    }
  }

  async confirmSchedule() {
    const postId = document.getElementById('schedulePostId').value;
    const scheduledFor = document.getElementById('scheduleDateTime').value;
    const publishNowCheckbox = document.getElementById('publishNowCheckbox');
    const publishNow = publishNowCheckbox?.checked || false;

    const selection = this.getSelectedPlatforms();

    if (!publishNow && !scheduledFor) {
      this.showNotification('Please select a date and time or check "Publish Now"', 'warning');
      return;
    }

    try {
      // If profile is selected, mark post for profile
      if (selection.profile) {
        await fetch(`/api/posts/${postId}/profile-status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isProfilePost: true })
        });
      }

      // Update post with SNS platforms if any selected
      if (selection.platforms.length > 0) {
        await fetch(`/api/posts/${postId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            socialPlatforms: selection.platforms,
            autoPublish: true
          })
        });
      }

      // Publish immediately or schedule for later
      let response;
      if (publishNow) {
        response = await fetch(`/api/posts/${postId}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        response = await fetch(`/api/posts/${postId}/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduledFor: new Date(scheduledFor).toISOString() })
        });
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || (publishNow ? 'Failed to publish post' : 'Failed to schedule post'));
      }

      this.showNotification(publishNow ? 'Post published!' : 'Post scheduled successfully!', 'success');
      this.scheduleModal?.hide();
      this.loadPosts();
      this.loadStats();

    } catch (error) {
      console.error('Error publishing/scheduling post:', error);
      this.showNotification(error.message || 'Failed to complete action', 'error');
    }
  }

  async cancelSchedule(postId) {
    if (!confirm('Cancel scheduled post? The post will be moved back to drafts.')) return;

    try {
      const response = await fetch(`/api/posts/${postId}/cancel-schedule`, {
        method: 'POST'
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to cancel schedule');
      }

      this.showNotification('Schedule cancelled', 'success');
      this.loadPosts();
      this.loadStats();

    } catch (error) {
      console.error('Error cancelling schedule:', error);
      this.showNotification('Failed to cancel schedule', 'error');
    }
  }

  async deletePost(postId) {
    if (!confirm('Are you sure you want to delete this post? This action cannot be undone.')) return;

    try {
      const response = await fetch(`/api/posts/${postId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to delete post');
      }

      this.showNotification('Post deleted', 'success');
      this.loadPosts();
      this.loadStats();

    } catch (error) {
      console.error('Error deleting post:', error);
      this.showNotification('Failed to delete post', 'error');
    }
  }

  renderPagination(pagination) {
    const container = document.getElementById('pagination');
    if (!container) return;

    container.innerHTML = '';

    if (pagination.totalPages <= 1) return;

    // Previous button
    if (pagination.page > 1) {
      const prev = document.createElement('button');
      prev.className = 'btn btn-outline-primary';
      prev.innerHTML = '<i class="bi bi-chevron-left"></i> Previous';
      prev.onclick = () => {
        this.currentPage--;
        this.loadPosts();
      };
      container.appendChild(prev);
    }

    // Page numbers
    const pageInfo = document.createElement('span');
    pageInfo.className = 'mx-3 text-white align-self-center';
    pageInfo.textContent = `Page ${pagination.page} of ${pagination.totalPages}`;
    container.appendChild(pageInfo);

    // Next button
    if (pagination.page < pagination.totalPages) {
      const next = document.createElement('button');
      next.className = 'btn btn-outline-primary';
      next.innerHTML = 'Next <i class="bi bi-chevron-right"></i>';
      next.onclick = () => {
        this.currentPage++;
        this.loadPosts();
      };
      container.appendChild(next);
    }
  }

  formatSource(source) {
    const sources = {
      'image_dashboard': 'Image Dashboard',
      'video_dashboard': 'Video Dashboard',
      'cron_job': 'Automated',
      'gallery': 'Gallery',
      'api': 'API',
      'chat': 'Chat'
    };
    return sources[source] || source || 'Unknown';
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

  getStatusColor(status) {
    const colors = {
      'draft': 'secondary',
      'scheduled': 'warning',
      'published': 'success',
      'failed': 'danger',
      'processing': 'info'
    };
    return colors[status] || 'secondary';
  }

  capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showNotification(message, type = 'info') {
    // Try to use global notification if available
    if (typeof window.showNotification === 'function') {
      window.showNotification(message, type);
      return;
    }
    
    // Fallback toast notification
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
}

// Initialize dashboard
let postsDashboard;
document.addEventListener('DOMContentLoaded', () => {
  postsDashboard = new PostsDashboard();
});
