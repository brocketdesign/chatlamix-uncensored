/**
 * Templates Dashboard
 * Frontend logic for viewing and managing prompt templates
 */

class TemplatesDashboard {
  constructor() {
    this.currentPage = 1;
    this.limit = 20;
    this.filters = {
      category: '',
      styleCategory: '',
      myTemplates: false
    };
    this.templateModal = null;
    this.variationsModal = null;
    this.lastMutatedPrompt = '';
    
    this.init();
  }

  init() {
    this.setupModals();
    this.setupEventListeners();
    this.loadTemplates();
  }

  setupModals() {
    const templateModalEl = document.getElementById('templateModal');
    const variationsModalEl = document.getElementById('variationsModal');
    
    if (templateModalEl) {
      this.templateModal = new bootstrap.Modal(templateModalEl);
    }
    if (variationsModalEl) {
      this.variationsModal = new bootstrap.Modal(variationsModalEl);
    }
  }

  setupEventListeners() {
    // Filter changes
    document.getElementById('filterCategory')?.addEventListener('change', (e) => {
      this.filters.category = e.target.value;
      this.currentPage = 1;
      this.loadTemplates();
    });

    document.getElementById('filterStyleCategory')?.addEventListener('change', (e) => {
      this.filters.styleCategory = e.target.value;
      this.currentPage = 1;
      this.loadTemplates();
    });

    document.getElementById('filterSource')?.addEventListener('change', (e) => {
      this.filters.myTemplates = e.target.value === 'mine';
      this.currentPage = 1;
      this.loadTemplates();
    });

    // Reset filters
    document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
      this.resetFilters();
    });
  }

  resetFilters() {
    this.filters = { category: '', styleCategory: '', myTemplates: false };
    
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterStyleCategory').value = '';
    document.getElementById('filterSource').value = '';
    
    this.currentPage = 1;
    this.loadTemplates();
  }

  async loadTemplates() {
    const grid = document.getElementById('templatesGrid');
    const spinner = document.getElementById('loadingSpinner');
    const noTemplates = document.getElementById('noTemplates');
    
    if (!grid) return;
    
    spinner.style.display = 'block';
    grid.innerHTML = '';
    noTemplates.style.display = 'none';

    try {
      const params = new URLSearchParams({
        page: this.currentPage,
        limit: this.limit,
        ...(this.filters.category && { category: this.filters.category }),
        ...(this.filters.styleCategory && { styleCategory: this.filters.styleCategory }),
        ...(this.filters.myTemplates && { myTemplates: 'true' })
      });

      const response = await fetch(`/api/prompt-templates?${params}`);
      const data = await response.json();

      spinner.style.display = 'none';

      if (!data.success) {
        throw new Error(data.error || 'Failed to load templates');
      }

      if (data.templates.length === 0) {
        noTemplates.style.display = 'block';
        return;
      }

      // Render templates
      data.templates.forEach(template => {
        grid.appendChild(this.createTemplateCard(template));
      });

      // Render pagination
      this.renderPagination(data.pagination);

    } catch (error) {
      console.error('Error loading templates:', error);
      spinner.style.display = 'none';
      this.showNotification('Failed to load templates', 'error');
    }
  }

  createTemplateCard(template) {
    const card = document.createElement('div');
    card.className = 'col-sm-6 col-lg-4';
    card.dataset.templateId = template._id;

    const styleColor = this.getStyleColor(template.styleCategory);
    const categoryIcon = this.getCategoryIcon(template.category);
    
    card.innerHTML = `
      <div class="card bg-dark border-secondary h-100 template-card">
        <div class="card-header bg-${styleColor} bg-opacity-25 d-flex justify-content-between align-items-center">
          <span class="badge bg-${styleColor}">
            <i class="bi ${categoryIcon} me-1"></i>
            ${this.capitalizeFirst(template.category)}
          </span>
          ${template.styleCategory ? `
            <span class="badge bg-secondary">
              ${this.capitalizeFirst(template.styleCategory)}
            </span>
          ` : ''}
        </div>
        <div class="card-body">
          <h6 class="card-title text-white mb-2">${template.name}</h6>
          <p class="card-text text-secondary small mb-2" style="display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
            ${template.basePrompt}
          </p>
          ${template.tags && template.tags.length > 0 ? `
            <div class="mb-2">
              ${template.tags.slice(0, 3).map(tag => `
                <span class="badge bg-dark border border-secondary me-1">${tag}</span>
              `).join('')}
              ${template.tags.length > 3 ? `<span class="text-muted small">+${template.tags.length - 3}</span>` : ''}
            </div>
          ` : ''}
          <p class="text-muted small mb-0">
            <i class="bi bi-lightning me-1"></i>
            Used ${template.usageCount || 0} times
          </p>
        </div>
        <div class="card-footer bg-transparent border-secondary">
          <div class="d-flex gap-1 flex-wrap">
            <button class="btn btn-sm btn-primary" onclick="templatesDashboard.applyTemplate('${template._id}')" title="Apply">
              <i class="bi bi-play"></i> Use
            </button>
            <button class="btn btn-sm btn-outline-info" onclick="templatesDashboard.editTemplate('${template._id}')" title="Edit">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-sm btn-outline-warning" onclick="templatesDashboard.generateFromTemplate('${template._id}')" title="Generate Variations">
              <i class="bi bi-shuffle"></i>
            </button>
            ${!template.isSystem ? `
              <button class="btn btn-sm btn-outline-danger" onclick="templatesDashboard.deleteTemplate('${template._id}')" title="Delete">
                <i class="bi bi-trash"></i>
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    return card;
  }

  openCreateModal() {
    // Reset form
    document.getElementById('templateId').value = '';
    document.getElementById('templateName').value = '';
    document.getElementById('basePrompt').value = '';
    document.getElementById('templateCategory').value = 'character';
    document.getElementById('templateStyleCategory').value = '';
    document.getElementById('templateTags').value = '';
    document.getElementById('templateAddAdjectives').checked = false;
    document.getElementById('templateAddQuality').checked = true;
    document.getElementById('templateRandomSeed').checked = true;
    document.getElementById('templateNsfw').checked = false;
    
    document.getElementById('templateModalTitle').innerHTML = `
      <i class="bi bi-plus-circle me-2"></i>Create New Template
    `;
    
    this.templateModal?.show();
  }

  async editTemplate(templateId) {
    try {
      // For now, fetch from the list or make an API call
      // You might want to add a GET /api/prompt-templates/:id endpoint
      this.showNotification('Edit functionality - loading template...', 'info');
      
      // Placeholder: open modal with empty data
      this.openCreateModal();
      document.getElementById('templateId').value = templateId;
      document.getElementById('templateModalTitle').innerHTML = `
        <i class="bi bi-pencil me-2"></i>Edit Template
      `;

    } catch (error) {
      console.error('Error loading template:', error);
      this.showNotification('Failed to load template', 'error');
    }
  }

  async saveTemplate() {
    const templateId = document.getElementById('templateId').value;
    const name = document.getElementById('templateName').value.trim();
    const basePrompt = document.getElementById('basePrompt').value.trim();
    const category = document.getElementById('templateCategory').value;
    const styleCategory = document.getElementById('templateStyleCategory').value;
    const tagsInput = document.getElementById('templateTags').value.trim();
    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];
    
    if (!name || !basePrompt) {
      this.showNotification('Name and base prompt are required', 'warning');
      return;
    }

    const templateData = {
      name,
      basePrompt,
      category,
      styleCategory: styleCategory || undefined,
      tags,
      mutationOptions: {
        addAdjectives: document.getElementById('templateAddAdjectives').checked,
        addQualityEnhancers: document.getElementById('templateAddQuality').checked,
        randomizeSeed: document.getElementById('templateRandomSeed').checked
      },
      nsfw: document.getElementById('templateNsfw').checked
    };

    try {
      const response = await fetch('/api/prompt-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(templateData)
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to save template');
      }

      this.showNotification('Template saved!', 'success');
      this.templateModal?.hide();
      this.loadTemplates();

    } catch (error) {
      console.error('Error saving template:', error);
      this.showNotification('Failed to save template: ' + error.message, 'error');
    }
  }

  async deleteTemplate(templateId) {
    if (!confirm('Delete this template permanently?')) return;

    try {
      const response = await fetch(`/api/prompt-templates/${templateId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to delete template');
      }

      this.showNotification('Template deleted', 'success');
      this.loadTemplates();

    } catch (error) {
      console.error('Error deleting template:', error);
      this.showNotification('Failed to delete template', 'error');
    }
  }

  async applyTemplate(templateId) {
    try {
      const response = await fetch(`/api/prompt-templates/${templateId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to apply template');
      }

      // Set the mutated prompt in the mutation panel
      document.getElementById('mutateInputPrompt').value = data.originalPrompt || '';
      document.getElementById('mutatedOutput').value = data.mutatedPrompt || '';
      this.lastMutatedPrompt = data.mutatedPrompt || '';
      
      this.showNotification('Template applied! Check the mutation panel above.', 'success');
      
      // Scroll to mutation panel
      document.querySelector('.card.border-primary')?.scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
      console.error('Error applying template:', error);
      this.showNotification('Failed to apply template', 'error');
    }
  }

  async generateFromTemplate(templateId) {
    try {
      const response = await fetch(`/api/prompt-templates/${templateId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to apply template');
      }

      // Generate variations from this template
      await this.showVariationsModal(data.originalPrompt, 5);

    } catch (error) {
      console.error('Error generating from template:', error);
      this.showNotification('Failed to generate variations', 'error');
    }
  }

  // Quick mutation functions
  async mutatePrompt() {
    const inputPrompt = document.getElementById('mutateInputPrompt').value.trim();
    
    if (!inputPrompt) {
      this.showNotification('Please enter a prompt to mutate', 'warning');
      return;
    }

    const style = document.getElementById('mutateStyle').value;
    const quality = document.getElementById('mutateQuality').value;
    const addAdjectives = document.getElementById('randomAdjectives').checked;

    try {
      const response = await fetch('/api/prompt-mutation/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: inputPrompt,
          options: {
            style: style || undefined,
            quality: quality || undefined,
            addAdjectives
          }
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to mutate prompt');
      }

      document.getElementById('mutatedOutput').value = data.mutatedPrompt || '';
      this.lastMutatedPrompt = data.mutatedPrompt || '';
      
      this.showNotification('Prompt mutated!', 'success');

    } catch (error) {
      console.error('Error mutating prompt:', error);
      this.showNotification('Failed to mutate prompt', 'error');
    }
  }

  copyMutated() {
    const output = document.getElementById('mutatedOutput').value;
    
    if (!output) {
      this.showNotification('No mutated prompt to copy', 'warning');
      return;
    }

    navigator.clipboard.writeText(output).then(() => {
      this.showNotification('Copied to clipboard!', 'success');
    }).catch(err => {
      console.error('Failed to copy:', err);
      this.showNotification('Failed to copy', 'error');
    });
  }

  async generateVariations() {
    const inputPrompt = document.getElementById('mutateInputPrompt').value.trim() || 
                       document.getElementById('mutatedOutput').value.trim();
    
    if (!inputPrompt) {
      this.showNotification('Please enter a prompt first', 'warning');
      return;
    }

    await this.showVariationsModal(inputPrompt, 5);
  }

  async showVariationsModal(prompt, count = 5) {
    const body = document.getElementById('variationsBody');
    body.innerHTML = `
      <div class="text-center py-4">
        <div class="spinner-border text-primary" role="status"></div>
        <p class="mt-2 text-muted">Generating variations...</p>
      </div>
    `;
    
    this.variationsModal?.show();
    this.currentVariationPrompt = prompt;

    try {
      const style = document.getElementById('mutateStyle').value;
      const quality = document.getElementById('mutateQuality').value;
      
      const response = await fetch('/api/prompt-mutation/variations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          count,
          options: {
            style: style || undefined,
            quality: quality || undefined
          }
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to generate variations');
      }

      let html = '<div class="list-group list-group-flush">';
      data.variations.forEach((variation, index) => {
        html += `
          <div class="list-group-item bg-dark border-secondary">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <span class="badge bg-primary">Variation ${index + 1}</span>
              <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-success" onclick="templatesDashboard.copyVariation(${index})" title="Copy">
                  <i class="bi bi-clipboard"></i>
                </button>
                <button class="btn btn-outline-info" onclick="templatesDashboard.useVariation(${index})" title="Use in Image Dashboard">
                  <i class="bi bi-image"></i>
                </button>
              </div>
            </div>
            <p class="text-white small mb-0 variation-text" data-index="${index}">${variation.mutatedPrompt}</p>
          </div>
        `;
      });
      html += '</div>';
      
      body.innerHTML = html;
      this.variations = data.variations;

    } catch (error) {
      console.error('Error generating variations:', error);
      body.innerHTML = `
        <div class="text-center py-4 text-danger">
          <i class="bi bi-exclamation-triangle fs-1"></i>
          <p class="mt-2">Failed to generate variations</p>
        </div>
      `;
    }
  }

  regenerateVariations() {
    if (this.currentVariationPrompt) {
      this.showVariationsModal(this.currentVariationPrompt, 5);
    }
  }

  copyVariation(index) {
    if (this.variations && this.variations[index]) {
      navigator.clipboard.writeText(this.variations[index].mutatedPrompt).then(() => {
        this.showNotification('Variation copied!', 'success');
      });
    }
  }

  useVariation(index) {
    if (this.variations && this.variations[index]) {
      // Store in sessionStorage and redirect to image dashboard
      sessionStorage.setItem('promptFromTemplates', this.variations[index].mutatedPrompt);
      window.location.href = '/dashboard/generation?mode=image';
    }
  }

  useInImageDashboard() {
    const mutatedPrompt = document.getElementById('mutatedOutput').value.trim();
    
    if (!mutatedPrompt) {
      this.showNotification('No mutated prompt to use', 'warning');
      return;
    }

    // Store in sessionStorage and redirect
    sessionStorage.setItem('promptFromTemplates', mutatedPrompt);
    window.location.href = '/dashboard/generation?mode=image';
  }

  openMutateModal() {
    // Scroll to mutation panel
    document.querySelector('.card.border-primary')?.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('mutateInputPrompt')?.focus();
  }

  renderPagination(pagination) {
    const container = document.getElementById('pagination');
    if (!container) return;

    container.innerHTML = '';

    if (pagination.totalPages <= 1) return;

    if (pagination.page > 1) {
      const prev = document.createElement('button');
      prev.className = 'btn btn-outline-primary';
      prev.innerHTML = '<i class="bi bi-chevron-left"></i> Previous';
      prev.onclick = () => {
        this.currentPage--;
        this.loadTemplates();
      };
      container.appendChild(prev);
    }

    const pageInfo = document.createElement('span');
    pageInfo.className = 'mx-3 text-white align-self-center';
    pageInfo.textContent = `Page ${pagination.page} of ${pagination.totalPages}`;
    container.appendChild(pageInfo);

    if (pagination.page < pagination.totalPages) {
      const next = document.createElement('button');
      next.className = 'btn btn-outline-primary';
      next.innerHTML = 'Next <i class="bi bi-chevron-right"></i>';
      next.onclick = () => {
        this.currentPage++;
        this.loadTemplates();
      };
      container.appendChild(next);
    }
  }

  getStyleColor(style) {
    const colors = {
      'anime': 'info',
      'photorealistic': 'success',
      'artistic': 'warning',
      'cinematic': 'danger'
    };
    return colors[style] || 'primary';
  }

  getCategoryIcon(category) {
    const icons = {
      'character': 'bi-person',
      'landscape': 'bi-image',
      'abstract': 'bi-grid-3x3',
      'portrait': 'bi-person-square',
      'other': 'bi-collection'
    };
    return icons[category] || 'bi-file-text';
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
}

// Initialize dashboard
let templatesDashboard;
document.addEventListener('DOMContentLoaded', () => {
  templatesDashboard = new TemplatesDashboard();
  
  // Check if there's a prompt from templates page
  const storedPrompt = sessionStorage.getItem('promptFromTemplates');
  if (storedPrompt && document.getElementById('promptInput')) {
    document.getElementById('promptInput').value = storedPrompt;
    sessionStorage.removeItem('promptFromTemplates');
  }
});
