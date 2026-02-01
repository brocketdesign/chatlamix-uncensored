let userGrowthChart, genderChart, nationalityChart, contentTrendsChart;
let behaviorTrendsChart;

// Initialize dashboard
$(document).ready(function() {
    loadAnalyticsData();
    loadBehaviorTrackingData();
    
    // Debug: Get and display IP geolocation data (disabled in production)
    // debugIPGeolocation();
    
    $('#refreshData').on('click', function() {
        $(this).html('<span class="spinner-border spinner-border-sm me-2"></span>Refreshing...');
        loadAnalyticsData(true); // Force refresh, bypass cache
        loadBehaviorTrackingData(true); // Force refresh
    });
});

/**
 * Debug function to test IP geolocation
 * Retrieves the current user's IP and location data using HTTPS services
 * This shows exactly what data would be saved to the database
 */
async function debugIPGeolocation() {
    console.log('🌍 [IP Geolocation Debug] Starting IP geolocation test...');
    console.log('═══════════════════════════════════════════════════════════════');
    
    try {
        // Use ipinfo.io (HTTPS, free tier) - works from HTTPS pages
        console.log('📡 [IP Geolocation Debug] Calling ipinfo.io (HTTPS service)...');
        
        const response = await fetch('https://ipinfo.io/json?token=');
        const ipInfoData = await response.json();
        
        if (ipInfoData && ipInfoData.ip) {
            // Parse coordinates (ipinfo returns "lat,lon" as string)
            let latitude = 0, longitude = 0;
            if (ipInfoData.loc) {
                const [lat, lon] = ipInfoData.loc.split(',');
                latitude = parseFloat(lat) || 0;
                longitude = parseFloat(lon) || 0;
            }
            
            // Format data exactly as backend would save it
            const locationData = {
                ip: ipInfoData.ip,
                country: ipInfoData.country || 'Unknown',
                countryCode: ipInfoData.country || 'XX',
                region: ipInfoData.region || 'Unknown',
                city: ipInfoData.city || 'Unknown',
                latitude: latitude,
                longitude: longitude,
                timezone: ipInfoData.timezone || 'UTC',
                isp: ipInfoData.org || 'Unknown',
                isLocal: false
            };
            
            console.log('✅ [IP Geolocation Debug] Successfully retrieved geolocation data!');
            console.log('');
            console.log('📊 DATA THAT WOULD BE SAVED TO DATABASE:');
            console.log('═══════════════════════════════════════════════════════════════');
            console.table(locationData);
            console.log('═══════════════════════════════════════════════════════════════');
            
            console.log('');
            console.log('📦 [IP Geolocation Debug] Raw ipinfo.io response:', ipInfoData);
            console.log('');
            console.log('💾 [IP Geolocation Debug] Formatted location object (as stored in DB):', locationData);
            
            // Also check what the backend currently has stored
            console.log('');
            console.log('📡 [IP Geolocation Debug] Checking what backend has stored...');
            try {
                const storedResponse = await fetch('/api/tracking/location', {
                    method: 'GET',
                    credentials: 'include'
                });
                const storedLocation = await storedResponse.json();
                console.log('💾 [IP Geolocation Debug] Currently stored in database:', storedLocation);
                
                // Compare with what we detected
                if (storedLocation.ip !== locationData.ip) {
                    console.log('');
                    console.log('📋 [IP Geolocation Debug] COMPARISON:');
                    console.log('   Server detected IP: ' + storedLocation.ip);
                    console.log('   Client detected IP: ' + locationData.ip);
                    console.log('   Server location: ' + (storedLocation.city || 'Unknown') + ', ' + (storedLocation.country || 'Unknown'));
                    console.log('   Client location: ' + locationData.city + ', ' + locationData.country);
                }
            } catch (err) {
                console.warn('⚠️ [IP Geolocation Debug] Could not fetch stored location:', err.message);
            }
            
            console.log('');
            console.log('═══════════════════════════════════════════════════════════════');
            console.log('✅ [IP Geolocation Debug] Test complete!');
            console.log('   IP geolocation service is working correctly.');
            console.log('═══════════════════════════════════════════════════════════════');
            
        } else {
            console.error('❌ [IP Geolocation Debug] ipinfo.io returned error or empty data:', ipInfoData);
        }
        
    } catch (error) {
        console.error('❌ [IP Geolocation Debug] Error during IP geolocation test:', error);
    }
}

// Load all analytics data
async function loadAnalyticsData(forceRefresh = false) {
    try {
        const url = forceRefresh 
            ? '/admin/api/analytics/dashboard?refresh=true' 
            : '/admin/api/analytics/dashboard';
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            updateStatCards(data.stats);
            renderCharts(data);
            updateAdditionalStats(data.stats);
            
            $('#lastUpdated').text(new Date(data.lastUpdated).toLocaleString('ja-JP'));
            $('#loadingSpinner').hide();
            $('#dashboardContent').fadeIn();
            $('#refreshData').html('<i class="bi bi-arrow-clockwise me-2"></i>Refresh');
        }
    } catch (error) {
        console.error('Error loading analytics:', error);
        $('#loadingSpinner').html('<div class="alert alert-danger">Failed to load analytics data</div>');
    }
}

// Update stat cards
function updateStatCards(stats) {
    // Total Users
    animateValue('totalUsers', 0, stats.totalUsers, 1000);
    updateChangeIndicator('userChange', stats.userGrowth);
    
    // Total Images
    animateValue('totalImages', 0, stats.totalImages, 1000);
    updateChangeIndicator('imageChange', stats.imageGrowth);
    
    // Total Messages
    animateValue('totalMessages', 0, stats.totalMessages, 1000);
    updateChangeIndicator('messageChange', stats.messageGrowth);
    
    // Average Messages
    animateValue('avgMessages', 0, stats.avgMessagesPerUser, 1000, 1);
}

// Update additional stats
function updateAdditionalStats(stats) {
    // Premium Users
    $('#premiumUsers').text(stats.premiumUsers);
    const premiumPercentage = ((stats.premiumUsers / stats.totalUsers) * 100).toFixed(1);
    $('#premiumPercentage').text(premiumPercentage + '%');
    $('#premiumProgress').css('width', premiumPercentage + '%');
    
    // Total Likes
    $('#totalLikes').text(stats.totalLikes.toLocaleString());
    $('#likesPerUser').text((stats.totalLikes / stats.totalUsers).toFixed(1) + '/user');
    
    // Average Images Per User
    $('#avgImagesPerUser').text((stats.totalImages / stats.totalUsers).toFixed(1));
    $('#activeGenerators').text(stats.activeImageGenerators + ' active');
}

// Render all charts
function renderCharts(data) {
    renderUserGrowthChart(data.userGrowth);
    renderGenderChart(data.genderDistribution);
    renderContentTrendsChart(data.contentTrends);
}

// User Growth Chart
function renderUserGrowthChart(growthData) {
    const ctx = document.getElementById('userGrowthChart').getContext('2d');
    
    if (userGrowthChart) {
        userGrowthChart.destroy();
    }
    
    userGrowthChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: growthData.labels,
            datasets: [{
                label: 'New Users',
                data: growthData.values,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: 5,
                pointBackgroundColor: '#667eea',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    titleFont: { size: 14, weight: 'bold' },
                    bodyFont: { size: 13 }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        precision: 0
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Gender Distribution Chart
function renderGenderChart(genderData) {
    const ctx = document.getElementById('genderChart').getContext('2d');
    
    if (genderChart) {
        genderChart.destroy();
    }
    
    genderChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: genderData.labels,
            datasets: [{
                data: genderData.values,
                backgroundColor: [
                    'rgba(102, 126, 234, 0.8)',
                    'rgba(245, 87, 108, 0.8)',
                    'rgba(158, 158, 158, 0.8)'
                ],
                borderWidth: 0,
                hoverOffset: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        font: { size: 12, weight: '600' },
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((context.parsed / total) * 100).toFixed(1);
                            return `${context.label}: ${context.parsed} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

// Nationality Distribution Chart (from IP geolocation)
function renderNationalityChart(locationData) {
    const ctx = document.getElementById('nationalityChart');
    if (!ctx) return;
    
    if (nationalityChart) {
        nationalityChart.destroy();
    }
    
    const countries = locationData?.byCountry || [];
    const labels = countries.map(c => c.country);
    const values = countries.map(c => c.count);
    
    nationalityChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels.slice(0, 10),
            datasets: [{
                label: 'Users',
                data: values.slice(0, 10),
                backgroundColor: 'rgba(79, 172, 254, 0.8)',
                borderColor: 'rgba(79, 172, 254, 1)',
                borderWidth: 2,
                borderRadius: 8,
                hoverBackgroundColor: 'rgba(79, 172, 254, 1)'
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        precision: 0
                    }
                },
                y: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Content Trends Chart
function renderContentTrendsChart(trendsData) {
    const ctx = document.getElementById('contentTrendsChart').getContext('2d');
    
    if (contentTrendsChart) {
        contentTrendsChart.destroy();
    }
    
    contentTrendsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: trendsData.labels,
            datasets: [
                {
                    label: 'Images',
                    data: trendsData.images,
                    borderColor: '#f5576c',
                    backgroundColor: 'rgba(245, 87, 108, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Messages',
                    data: trendsData.messages,
                    borderColor: '#ffa726',
                    backgroundColor: 'rgba(255, 167, 38, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        padding: 15,
                        font: { size: 12, weight: '600' },
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Update change indicator
function updateChangeIndicator(elementId, changePercent) {
    const element = $(`#${elementId}`);
    const isPositive = changePercent >= 0;
    const icon = isPositive ? 'bi-arrow-up' : 'bi-arrow-down';
    const color = isPositive ? 'inherit' : 'opacity-75';
    
    element.html(`
        <i class="bi ${icon}"></i> 
        <span>${Math.abs(changePercent).toFixed(1)}%</span> from last week
    `).addClass(color);
}

// Animate number counting
function animateValue(id, start, end, duration, decimals = 0) {
    const obj = document.getElementById(id);
    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;
    
    const timer = setInterval(function() {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            current = end;
            clearInterval(timer);
        }
        obj.textContent = current.toFixed(decimals).toLocaleString();
    }, 16);
}

// ============================================
// User Behavior Tracking Functions
// ============================================

// Load behavior tracking data
async function loadBehaviorTrackingData(forceRefresh = false) {
    try {
        // Load aggregate stats
        const refreshParam = forceRefresh ? '?refresh=true' : '';
        const statsResponse = await fetch('/api/tracking/admin/stats' + refreshParam);
        const statsData = await statsResponse.json();
        
        if (statsData) {
            updateBehaviorStats(statsData);
            renderNationalityChart(statsData.locations);
            renderChatStartSourcesChart(statsData.startChatSources);
        }
        
        // Load trends data
        const trendsResponse = await fetch('/api/tracking/admin/trends?days=7');
        const trendsData = await trendsResponse.json();
        
        if (trendsData && trendsData.length > 0) {
            renderBehaviorTrendsChart(trendsData);
        }
    } catch (error) {
        console.error('Error loading behavior tracking data:', error);
    }
}

// Update behavior tracking stat cards
function updateBehaviorStats(data) {
    if (!data || !data.events) return;
    
    // Chat Sessions Started
    $('#totalChatStarts').text(data.events.startChat?.count?.toLocaleString() || '0');
    $('#uniqueChatStartUsers').text((data.events.startChat?.uniqueUsers || 0) + ' users');
    
    // Messages Sent (Tracked)
    $('#totalTrackedMessages').text(data.events.messageSent?.count?.toLocaleString() || '0');
    $('#uniqueMessageUsers').text((data.events.messageSent?.uniqueUsers || 0) + ' users');
    
    // Premium Modal Views
    $('#totalPremiumViews').text(data.events.premiumView?.count?.toLocaleString() || '0');
    $('#uniquePremiumViewUsers').text((data.events.premiumView?.uniqueUsers || 0) + ' users');
}

// Chat Start Sources List
function renderChatStartSourcesChart(sourcesData) {
    const container = document.getElementById('chatStartSourcesList');
    if (!container) return;
    
    const sources = sourcesData || [];
    const total = sources.reduce((sum, s) => sum + s.count, 0);
    
    if (sources.length === 0) {
        container.innerHTML = '<div class="text-center text-muted py-3">No data available</div>';
        return;
    }
    
    const sourceInfo = {
        'character_card': { icon: 'bi-person-badge', page: 'Explore / Character Card' },
        'character_detail': { icon: 'bi-person-lines-fill', page: 'Character Detail Page' },
        'explore_gallery': { icon: 'bi-grid-3x3-gap', page: 'Explore Gallery' },
        'chat_list': { icon: 'bi-chat-dots', page: 'Chat List' },
        'image_gallery': { icon: 'bi-images', page: 'Image Gallery' },
        'home_banner': { icon: 'bi-house', page: 'Home Page Banner' },
        'home_featured': { icon: 'bi-star', page: 'Home Featured Section' },
        'search_result': { icon: 'bi-search', page: 'Search Results' },
        'recommendation': { icon: 'bi-hand-thumbs-up', page: 'Recommendations' },
        'direct_link': { icon: 'bi-link-45deg', page: 'Direct Link' },
        'unknown': { icon: 'bi-question-circle', page: 'Unknown' }
    };
    
    let html = '<div class="list-group list-group-flush">';
    
    sources.forEach((s, index) => {
        const info = sourceInfo[s.source] || sourceInfo['unknown'];
        const percentage = total > 0 ? ((s.count / total) * 100).toFixed(1) : 0;
        
        html += `
            <div class="list-group-item d-flex align-items-center justify-content-between py-2 px-3">
                <div class="d-flex align-items-center gap-2">
                    <span class="badge bg-light text-dark" style="min-width: 24px;">${index + 1}</span>
                    <i class="${info.icon} text-primary"></i>
                    <div>
                        <div class="fw-semibold small">${formatSourceLabel(s.source)}</div>
                        <div class="text-muted" style="font-size: 0.7rem;">${info.page}</div>
                    </div>
                </div>
                <div class="text-end">
                    <span class="fw-bold">${s.count.toLocaleString()}</span>
                    <span class="text-muted small ms-1">(${percentage}%)</span>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Behavior Trends Chart
function renderBehaviorTrendsChart(trendsData) {
    const ctx = document.getElementById('behaviorTrendsChart');
    if (!ctx) return;
    
    if (behaviorTrendsChart) {
        behaviorTrendsChart.destroy();
    }
    
    const labels = trendsData.map(t => t.date);
    const startChatData = trendsData.map(t => t.startChat);
    const messageSentData = trendsData.map(t => t.messageSent);
    const premiumViewData = trendsData.map(t => t.premiumView);
    
    behaviorTrendsChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Chat Sessions',
                    data: startChatData,
                    borderColor: 'rgba(76, 175, 80, 1)',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: 'rgba(76, 175, 80, 1)'
                },
                {
                    label: 'Messages Sent',
                    data: messageSentData,
                    borderColor: 'rgba(33, 150, 243, 1)',
                    backgroundColor: 'rgba(33, 150, 243, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: 'rgba(33, 150, 243, 1)'
                },
                {
                    label: 'Premium Views',
                    data: premiumViewData,
                    borderColor: 'rgba(156, 39, 176, 1)',
                    backgroundColor: 'rgba(156, 39, 176, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: 'rgba(156, 39, 176, 1)'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        padding: 15,
                        font: { size: 12, weight: '600' },
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0, 0, 0, 0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

// Format source label for display
function formatSourceLabel(source) {
    if (!source) return 'Unknown';
    return source
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
}