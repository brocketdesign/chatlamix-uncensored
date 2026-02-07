/**
 * Social Dashboard Manager
 * Handles the logic for the single-character social command center.
 */

const socialManager = {
    characterId: null,

    init: function() {
        this.characterId = window.characterId;
        if (!this.characterId) {
            console.error('No character ID found');
            return;
        }
        
        console.log('Initializing Social Manager for:', this.characterId);
        this.loadSchedules();
        this.loadRecentPosts();
    },

    loadSchedules: async function() {
        const container = document.getElementById('activeSchedulesList');
        try {
            // Fetch schedules filtered by this character
            const response = await fetch(`/api/schedules?characterId=${this.characterId}&type=recurring&status=active`);
            const data = await response.json();
            
            if (data.success && data.schedules.length > 0) {
                container.innerHTML = data.schedules.map(schedule => `
                    <div class="schedule-item">
                        <div class="schedule-info">
                            <h4>${schedule.name || 'Untitled Schedule'}</h4>
                            <div class="schedule-meta">
                                <i class="bi bi-clock"></i> ${schedule.cronExpression}
                                <span class="ms-2 badge bg-dark">${schedule.actionType}</span>
                            </div>
                        </div>
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" checked 
                                onchange="socialManager.toggleSchedule('${schedule._id}', this.checked)">
                        </div>
                    </div>
                `).join('');
            } else {
                container.innerHTML = '<p class="text-muted text-center py-3">No active recurring schedules.</p>';
            }
        } catch (err) {
            console.error('Error loading schedules:', err);
            container.innerHTML = '<p class="text-danger">Failed to load schedules.</p>';
        }
    },

    loadRecentPosts: async function() {
        const container = document.getElementById('recentPostsGrid');
        try {
            // API call to get posts for this character
            const response = await fetch(`/api/posts?characterId=${this.characterId}&limit=6`);
            const data = await response.json();

            if (data.success && data.posts.length > 0) {
                container.innerHTML = data.posts.map(post => `
                    <div class="recent-post-thumb">
                        <img src="${post.imageUrl || post.thumbnailUrl}" alt="Post">
                    </div>
                `).join('');
            } else {
                container.innerHTML = '<p class="text-muted small col-span-3">No recent posts found.</p>';
            }
        } catch (err) {
            console.error('Error loading recent posts:', err);
        }
    },

    openScheduleModal: function() {
        // Reuse the global schedule modal from dashboard-schedules.js if available,
        // or trigger a custom modal for this specific character context.
        // For MVP, we alert.
        alert('Schedule creation for specific character coming in next iteration.');
    },

    toggleSchedule: async function(id, isActive) {
        // Optimistic UI update already happened via checkbox
        try {
            const endpoint = isActive ? `/api/schedules/${id}/resume` : `/api/schedules/${id}/pause`;
            await fetch(endpoint, { method: 'POST' });
            console.log(`Schedule ${id} toggled to ${isActive}`);
        } catch (err) {
            console.error('Toggle failed:', err);
            // Revert UI if needed (omitted for brevity)
        }
    },
    
    generateNow: function() {
        // Redirect to generation page pre-filled with character
        window.location.href = `/dashboard/generation?characterId=${this.characterId}`;
    },

    editCharacter: function() {
        window.location.href = `/character-update/${this.characterId}`;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    socialManager.init();
});
