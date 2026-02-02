let nsfwTrendsChart, categoryChart, premiumVsFreeChart;
let currentPeriod = 'last_7_days';

// Initialize dashboard
$(document).ready(function() {
    loadNsfwAnalyticsData();
    
    $('#refreshData').on('click', function() {
        $(this).html('<span class="spinner-border spinner-border-sm me-2"></span>Refreshing...');
        loadNsfwAnalyticsData(true);
    });

    $('#periodSelect').on('change', function() {
        currentPeriod = $(this).val();
        loadNsfwAnalyticsData(true);
    });
});

async function loadNsfwAnalyticsData(forceRefresh = false) {
    try {
        $('#loadingSpinner').show();
        $('#dashboardContent').hide();
        
        const response = await fetch(`/api/admin/nsfw-analytics?period=${currentPeriod}${forceRefresh ? '&refresh=true' : ''}`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to load analytics');
        }
        
        updateStats(data.analytics);
        updateCharts(data.analytics);
        updateTopUsersTable(data.topUsers);
        updatePeriodBadge();
        
        $('#lastUpdated').text(new Date().toLocaleString());
        $('#refreshData').html('<i class="bi bi-arrow-clockwise me-2"></i>Refresh Data');
        
        $('#loadingSpinner').hide();
        $('#dashboardContent').show();
        
    } catch (error) {
        console.error('Error loading NSFW analytics:', error);
        $('#refreshData').html('<i class="bi bi-arrow-clockwise me-2"></i>Refresh Data');
        $('#loadingSpinner').hide();
        $('#dashboardContent').show();
        showNotification('Failed to load analytics data', 'error');
    }
}

function updateStats(analytics) {
    $('#totalEvents').text(formatNumber(analytics.totalEvents || 0));
    $('#uniqueUsers').text(formatNumber(analytics.uniqueUsers || 0));
    $('#upsellShown').text(formatNumber(analytics.upsellShownCount || 0));
    $('#conversionRate').text((analytics.conversionRate || 0) + '%');
    $('#conversions').text(formatNumber(analytics.conversions || 0));
    $('#avgScore').text(analytics.avgScore || '0');
    
    // Update score circle color based on average score
    const avgScore = parseFloat(analytics.avgScore) || 0;
    const scoreCircle = document.getElementById('avgScoreCircle');
    if (scoreCircle) {
        if (avgScore >= 80) {
            scoreCircle.style.background = 'linear-gradient(135deg, #e53935 0%, #c62828 100%)';
        } else if (avgScore >= 60) {
            scoreCircle.style.background = 'linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%)';
        } else if (avgScore >= 40) {
            scoreCircle.style.background = 'linear-gradient(135deg, #ffa726 0%, #fb8c00 100%)';
        } else {
            scoreCircle.style.background = 'linear-gradient(135deg, #66bb6a 0%, #43a047 100%)';
        }
    }
}

function updateCharts(analytics) {
    // Destroy existing charts
    if (nsfwTrendsChart) nsfwTrendsChart.destroy();
    if (categoryChart) categoryChart.destroy();
    if (premiumVsFreeChart) premiumVsFreeChart.destroy();
    
    // NSFW Trends Chart
    const trendsCtx = document.getElementById('nsfwTrendsChart');
    if (trendsCtx && analytics.dailyTrends) {
        nsfwTrendsChart = new Chart(trendsCtx, {
            type: 'line',
            data: {
                labels: analytics.dailyTrends.map(d => formatDate(d.date)),
                datasets: [
                    {
                        label: 'NSFW Push Events',
                        data: analytics.dailyTrends.map(d => d.total),
                        borderColor: '#ff6b6b',
                        backgroundColor: 'rgba(255, 107, 107, 0.1)',
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Upsells Shown',
                        data: analytics.dailyTrends.map(d => d.upsellShown),
                        borderColor: '#9c27b0',
                        backgroundColor: 'rgba(156, 39, 176, 0.1)',
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Conversions',
                        data: analytics.dailyTrends.map(d => d.conversions),
                        borderColor: '#4caf50',
                        backgroundColor: 'rgba(76, 175, 80, 0.1)',
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                }
            }
        });
    }
    
    // Category Chart
    const categoryCtx = document.getElementById('categoryChart');
    if (categoryCtx && analytics.byCategory) {
        const categoryColors = {
            'none': '#90a4ae',
            'suggestive': '#ffa726',
            'explicit_request': '#ff6b6b',
            'insistent_demand': '#e53935',
            'escalation_pattern': '#9c27b0',
            'unknown': '#bdbdbd'
        };
        
        categoryChart = new Chart(categoryCtx, {
            type: 'doughnut',
            data: {
                labels: analytics.byCategory.map(c => formatCategory(c.category)),
                datasets: [{
                    data: analytics.byCategory.map(c => c.count),
                    backgroundColor: analytics.byCategory.map(c => categoryColors[c.category] || '#bdbdbd'),
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            boxWidth: 12,
                            padding: 10
                        }
                    }
                }
            }
        });
    }
    
    // Premium vs Free Chart
    const premiumCtx = document.getElementById('premiumVsFreeChart');
    if (premiumCtx && analytics.premiumVsFree) {
        premiumVsFreeChart = new Chart(premiumCtx, {
            type: 'bar',
            data: {
                labels: ['Free Users', 'Premium Users'],
                datasets: [{
                    label: 'NSFW Push Events',
                    data: [analytics.premiumVsFree.free || 0, analytics.premiumVsFree.premium || 0],
                    backgroundColor: ['#ff6b6b', '#4caf50'],
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                }
            }
        });
    }
}

function updateTopUsersTable(topUsers) {
    const tbody = document.getElementById('topUsersTable');
    if (!tbody) return;
    
    if (!topUsers || topUsers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted py-4">
                    <i class="bi bi-inbox me-2"></i>No NSFW push events detected yet
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = topUsers.map((user, index) => `
        <tr>
            <td class="px-4 py-3">
                <div class="d-flex align-items-center">
                    <span class="badge bg-secondary me-3">#${index + 1}</span>
                    <div>
                        <strong>${escapeHtml(user.nickname || 'Anonymous')}</strong>
                        <small class="text-muted d-block">${escapeHtml(user.email || user.userId)}</small>
                    </div>
                </div>
            </td>
            <td class="text-center">
                <span class="badge bg-danger">${user.count}</span>
            </td>
            <td class="text-center">
                <span class="badge" style="background: ${getScoreColor(user.avgScore)}; color: white;">
                    ${user.avgScore || 0}
                </span>
            </td>
            <td class="text-center">
                <span class="badge bg-purple" style="background: #9c27b0;">${user.upsellShown || 0}</span>
            </td>
            <td class="text-center">
                ${user.isPremium 
                    ? '<span class="badge bg-success"><i class="bi bi-gem me-1"></i>Premium</span>' 
                    : '<span class="badge bg-secondary">Free</span>'
                }
            </td>
            <td class="text-center">
                ${user.converted 
                    ? '<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>Yes</span>' 
                    : '<span class="badge bg-light text-dark">No</span>'
                }
            </td>
        </tr>
    `).join('');
}

function updatePeriodBadge() {
    const periodText = {
        'last_7_days': '7 Days',
        'last_30_days': '30 Days',
        'last_90_days': '90 Days'
    };
    $('#trendPeriodBadge').text(periodText[currentPeriod] || '7 Days');
}

// Helper functions
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatCategory(category) {
    const categoryNames = {
        'none': 'None',
        'suggestive': 'Suggestive',
        'explicit_request': 'Explicit Request',
        'insistent_demand': 'Insistent Demand',
        'escalation_pattern': 'Escalation Pattern',
        'unknown': 'Unknown'
    };
    return categoryNames[category] || category;
}

function getScoreColor(score) {
    if (score >= 80) return '#e53935';
    if (score >= 60) return '#ff6b6b';
    if (score >= 40) return '#ffa726';
    return '#66bb6a';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(message, type = 'info') {
    // Use existing notification system if available
    if (window.showNotification) {
        window.showNotification(message, type);
    } else {
        console.log(`[${type}] ${message}`);
    }
}
