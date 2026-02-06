/**
 * User Management Pagination & Enhanced UI
 * Handles pagination controls, page size changes, and improved mobile experience
 */

document.addEventListener('DOMContentLoaded', function() {
  // ============================================
  // PAGE SIZE CHANGE HANDLER
  // ============================================
  const pageSizeSelect = document.getElementById('pageSize');
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', function() {
      const newLimit = this.value;
      const currentUrl = new URL(window.location);
      currentUrl.searchParams.set('limit', newLimit);
      currentUrl.searchParams.set('page', 1);
      window.location.href = currentUrl.toString();
    });
  }

  // ============================================
  // PAGINATION INDEX CALCULATION
  // ============================================
  function updatePaginationInfo() {
    const urlParams = new URLSearchParams(window.location.search);
    const page = parseInt(urlParams.get('page')) || 1;
    const limit = parseInt(urlParams.get('limit')) || 10;
    const tableRows = document.querySelectorAll('#usersTable tbody tr');
    const totalCount = document.getElementById('total-count');
    
    if (tableRows.length > 0) {
      const startIndex = (page - 1) * limit + 1;
      const endIndex = Math.min(page * limit, parseInt(totalCount?.textContent || 0));
      
      const startDisplay = document.getElementById('start-index');
      const endDisplay = document.getElementById('end-index');
      
      if (startDisplay) startDisplay.textContent = startIndex;
      if (endDisplay) endDisplay.textContent = endIndex;
    }
  }

  updatePaginationInfo();

  // ============================================
  // SMOOTH SCROLL TO TABLE ON PAGE CHANGE
  // ============================================
  function smoothScrollToTable() {
    const table = document.querySelector('.table-responsive');
    if (table) {
      setTimeout(() => {
        table.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }

  // Scroll to table when page loads if not on page 1
  const urlParams = new URLSearchParams(window.location.search);
  if (parseInt(urlParams.get('page')) > 1) {
    smoothScrollToTable();
  }

  // ============================================
  // ENHANCED TABLE ROW INTERACTIONS
  // ============================================
  const tableRows = document.querySelectorAll('#usersTable tbody tr');
  
  // Hover effect is handled by CSS (.table-hover tbody tr:hover)

  // ============================================
  // MOBILE-OPTIMIZED ACTION BUTTONS
  // ============================================
  
  // Make action buttons more accessible on mobile
  const actionButtons = document.querySelectorAll('.btn-group button, .btn-group a');
  actionButtons.forEach(btn => {
    // Add touch feedback
    btn.addEventListener('touchstart', function() {
      this.style.opacity = '0.8';
    });
    
    btn.addEventListener('touchend', function() {
      this.style.opacity = '1';
    });

    // Ensure minimum touch target size
    const currentHeight = window.getComputedStyle(btn).height;
    if (parseInt(currentHeight) < 40) {
      btn.style.minHeight = '40px';
      btn.style.minWidth = '40px';
    }
  });

  // ============================================
  // PAGINATION CONTROLS ACCESSIBILITY
  // ============================================
  const paginationButtons = document.querySelectorAll('.pagination-btn');
  paginationButtons.forEach(btn => {
    // Add keyboard navigation
    btn.addEventListener('keypress', function(e) {
      if (e.key === 'Enter' && !this.disabled && this.tagName === 'A') {
        this.click();
      }
    });

    // Add focus management
    btn.addEventListener('focus', function() {
      this.style.outline = '2px solid #667eea';
      this.style.outlineOffset = '2px';
    });

    btn.addEventListener('blur', function() {
      this.style.outline = 'none';
      this.style.outlineOffset = '0';
    });
  });

  // ============================================
  // RESPONSIVE TABLE HANDLING
  // ============================================
  function handleTableResponsiveness() {
    const table = document.querySelector('.table-responsive');
    const windowWidth = window.innerWidth;

    if (windowWidth < 768) {
      // Stack certain columns on mobile
      const headerCells = document.querySelectorAll('thead th');
      headerCells.forEach((cell, index) => {
        if (index > 6) { // Hide columns after "Actions" on mobile
          cell.style.display = 'none';
        }
      });

      const bodyCells = document.querySelectorAll('tbody td');
      bodyCells.forEach((cell, index) => {
        if (index % 10 > 6) { // Hide corresponding columns on mobile
          cell.style.display = 'none';
        }
      });
    }
  }

  handleTableResponsiveness();
  window.addEventListener('resize', handleTableResponsiveness);

  // ============================================
  // PAGINATION ANIMATION
  // ============================================
  const paginationContainer = document.querySelector('.pagination-container');
  if (paginationContainer) {
    // Add fade-in animation
    paginationContainer.style.animation = 'fadeIn 0.3s ease-in';
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================
  // TABLE LOADING STATE
  // ============================================
  function showLoadingState() {
    const table = document.querySelector('.table-responsive');
    if (table) {
      const overlay = document.createElement('div');
      overlay.className = 'pagination-loading';
      overlay.innerHTML = `
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000;">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
        </div>
      `;
      overlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(255, 255, 255, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
      `;
      table.parentElement.style.position = 'relative';
      table.parentElement.appendChild(overlay);

      return overlay;
    }
  }

  function hideLoadingState(overlay) {
    if (overlay) {
      overlay.remove();
    }
  }

  // ============================================
  // PAGINATION LINK ENHANCEMENT
  // ============================================
  const paginationLinks = document.querySelectorAll('.pagination-btn[href]');
  paginationLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      // Show loading state while navigating
      const overlay = showLoadingState();
      
      // Simulate loading time
      setTimeout(() => {
        hideLoadingState(overlay);
      }, 300);
    });
  });

  // ============================================
  // KEYBOARD SHORTCUTS
  // ============================================
  document.addEventListener('keydown', function(e) {
    // Only if not typing in an input
    if (document.activeElement.tagName === 'INPUT') return;

    const urlParams = new URLSearchParams(window.location.search);
    const currentPage = parseInt(urlParams.get('page')) || 1;
    const totalPages = parseInt(document.getElementById('total-pages')?.textContent || 1);
    const limit = urlParams.get('limit') || 10;

    // Alt + N for Next Page
    if (e.altKey && e.key === 'n' && currentPage < totalPages) {
      e.preventDefault();
      window.location.href = `?page=${currentPage + 1}&limit=${limit}`;
    }

    // Alt + P for Previous Page
    if (e.altKey && e.key === 'p' && currentPage > 1) {
      e.preventDefault();
      window.location.href = `?page=${currentPage - 1}&limit=${limit}`;
    }
  });

  // ============================================
  // EXPORT INFO
  // ============================================
  function updateExportInfo() {
    const selectedCount = document.querySelectorAll('.field-btn.selected').length;
    const userType = document.querySelector('input[name="userType"]:checked')?.value || 'registered';
    const includeAnalytics = document.getElementById('includeAnalytics')?.checked;
    
    const userTypeText = userType === 'registered' ? 'Registered Users' : 
                        userType === 'recent' ? 'Recent Users' : 'All Users';
    
    let info = `${selectedCount} fields selected | ${userTypeText}`;
    if (includeAnalytics) {
      info += ' | With Analytics';
    }
    
    const exportInfo = document.getElementById('exportInfo');
    if (exportInfo) {
      exportInfo.textContent = info;
    }
  }

  // ============================================
  // MOBILE PAGINATION OPTIMIZATION
  // ============================================
  function optimizeMobilePagination() {
    const windowWidth = window.innerWidth;
    if (windowWidth < 480) {
      // Hide page number buttons on very small screens
      const pageNumbers = document.querySelectorAll('.page-number');
      pageNumbers.forEach(btn => {
        if (!btn.classList.contains('active')) {
          btn.style.display = 'none';
        }
      });

      // Show only prev/next buttons
      const controls = document.querySelector('.pagination-controls');
      if (controls) {
        controls.style.gap = '0.5rem';
      }
    }
  }

  optimizeMobilePagination();
  window.addEventListener('resize', optimizeMobilePagination);

  // ============================================
  // TABLE ROW SELECTION (Optional)
  // ============================================
  let selectedRows = new Set();

  tableRows.forEach(row => {
    row.addEventListener('click', function(e) {
      // Don't select on button clicks
      if (e.target.closest('button, a')) return;

      const userId = this.getAttribute('data-user-id');
      if (selectedRows.has(userId)) {
        selectedRows.delete(userId);
        this.style.backgroundColor = '';
      } else {
        selectedRows.add(userId);
        this.style.backgroundColor = '#e3f2fd';
      }
    });
  });

  // ============================================
  // HELPER: Update Export Info on User Type Change
  // ============================================
  document.querySelectorAll('input[name="userType"]').forEach(radio => {
    radio.addEventListener('change', updateExportInfo);
  });

  const includeAnalyticsCheckbox = document.getElementById('includeAnalytics');
  if (includeAnalyticsCheckbox) {
    includeAnalyticsCheckbox.addEventListener('change', updateExportInfo);
  }

  console.log('✅ Pagination and UI enhancements loaded successfully');
});
