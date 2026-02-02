let upsellTrendChart, upsellSeverityChart, upsellVsPremiumChart;

$(document).ready(function() {
    loadUpsellAnalytics();
    $('#refreshData').on('click', function() {
        $(this).html('<span class="spinner-border spinner-border-sm me-2"></span>Refreshing...');
        loadUpsellAnalytics(true);
    });
});

async function loadUpsellAnalytics(forceRefresh = false) {
    try {
        const statsResponse = await fetch('/api/tracking/admin/stats');
        const statsData = await statsResponse.json();

        const trendsResponse = await fetch('/api/tracking/admin/trends?days=7');
        const trendsData = await trendsResponse.json();

        if (statsData) {
            updateUpsellStats(statsData);
            renderUpsellSeverityChart(statsData.earlyNsfwUpsell?.bySeverity || []);
            renderUpsellSourceList(statsData.premiumViewSources || []);
            renderUpsellVsPremiumChart(statsData);
        }

        if (trendsData && trendsData.length > 0) {
            renderUpsellTrendChart(trendsData);
        }

        $('#lastUpdated').text(new Date().toLocaleString('ja-JP'));
        $('#loadingSpinner').hide();
        $('#dashboardContent').fadeIn();
        $('#refreshData').html('<i class="bi bi-arrow-clockwise me-2"></i>Refresh Data');
    } catch (error) {
        console.error('Error loading upsell analytics:', error);
        $('#loadingSpinner').html('<div class="alert alert-danger">Failed to load upsell analytics data</div>');
    }
}

function updateUpsellStats(data) {
    const upsellCount = data.events?.earlyNsfwUpsell?.count || 0;
    const upsellUsers = data.events?.earlyNsfwUpsell?.uniqueUsers || 0;
    const premiumViews = data.events?.premiumView?.count || 0;
    const topSeverity = data.earlyNsfwUpsell?.bySeverity?.[0]?.severity || 'unknown';

    $('#totalUpsellTriggers').text(upsellCount.toLocaleString());
    $('#premiumViews').text(premiumViews.toLocaleString());
    $('#upsellUniqueUsers').text(upsellUsers.toLocaleString());
    $('#topUpsellSeverity').text(formatLabel(topSeverity));
    $('#upsellTriggerChange').html(`<i class="bi bi-activity me-1"></i><span class="change-value">${upsellUsers.toLocaleString()}</span> <span class="change-period">unique users</span>`);
    $('#premiumViewChange').html(`<i class="bi bi-activity me-1"></i><span class="change-value">${premiumViews.toLocaleString()}</span> <span class="change-period">total views</span>`);
}

function renderUpsellTrendChart(trendsData) {
    const ctx = document.getElementById('upsellTrendChart');
    if (!ctx) return;

    if (upsellTrendChart) {
        upsellTrendChart.destroy();
    }

    const labels = trendsData.map(t => t.date);
    const upsellData = trendsData.map(t => t.earlyNsfwUpsell || 0);

    upsellTrendChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Early NSFW Upsells',
                data: upsellData,
                borderColor: 'rgba(245, 87, 108, 1)',
                backgroundColor: 'rgba(245, 87, 108, 0.12)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: 'rgba(245, 87, 108, 1)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: 'rgba(0,0,0,0.8)', padding: 12 }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderUpsellSeverityChart(severityData) {
    const ctx = document.getElementById('upsellSeverityChart');
    if (!ctx) return;

    if (upsellSeverityChart) {
        upsellSeverityChart.destroy();
    }

    if (!severityData || severityData.length === 0) {
        return;
    }

    upsellSeverityChart = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: severityData.map(item => formatLabel(item.severity)),
            datasets: [{
                data: severityData.map(item => item.count),
                backgroundColor: [
                    'rgba(245, 87, 108, 0.8)',
                    'rgba(255, 167, 38, 0.8)',
                    'rgba(156, 39, 176, 0.8)',
                    'rgba(79, 172, 254, 0.8)'
                ],
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: { backgroundColor: 'rgba(0,0,0,0.8)', padding: 12 }
            }
        }
    });
}

function renderUpsellVsPremiumChart(statsData) {
    const ctx = document.getElementById('upsellVsPremiumChart');
    if (!ctx) return;

    if (upsellVsPremiumChart) {
        upsellVsPremiumChart.destroy();
    }

    const upsellCount = statsData.events?.earlyNsfwUpsell?.count || 0;
    const premiumViews = statsData.events?.premiumView?.count || 0;

    upsellVsPremiumChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Early NSFW Upsell', 'Premium Views'],
            datasets: [{
                data: [upsellCount, premiumViews],
                backgroundColor: [
                    'rgba(245, 87, 108, 0.8)',
                    'rgba(156, 39, 176, 0.8)'
                ],
                borderRadius: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: 'rgba(0,0,0,0.8)', padding: 12 }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderUpsellSourceList(sourcesData) {
    const container = document.getElementById('upsellSourceList');
    if (!container) return;

    const sources = sourcesData || [];
    const total = sources.reduce((sum, s) => sum + s.count, 0);

    if (sources.length === 0) {
        container.innerHTML = '<div class="text-center text-muted py-3">No data available</div>';
        return;
    }

    const sourceInfo = {
        early_nsfw_upsell: { icon: 'bi-fire', page: 'Early NSFW Upsell' },
        websocket_trigger: { icon: 'bi-lightning', page: 'Websocket Trigger' },
        chat_tool_settings: { icon: 'bi-chat-dots', page: 'Chat' },
        unknown: { icon: 'bi-question-circle', page: 'Unknown' }
    };

    let html = '<div class="list-group list-group-flush">';

    sources.slice(0, 6).forEach((s, index) => {
        const info = sourceInfo[s.source] || sourceInfo.unknown;
        const percentage = total > 0 ? ((s.count / total) * 100).toFixed(1) : 0;

        html += `
            <div class="list-group-item d-flex align-items-center justify-content-between py-2 px-3">
                <div class="d-flex align-items-center gap-2">
                    <span class="badge bg-light text-dark" style="min-width: 24px;">${index + 1}</span>
                    <i class="${info.icon} text-primary"></i>
                    <div>
                        <div class="fw-semibold small">${formatLabel(s.source)}</div>
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

function formatLabel(value) {
    if (!value || value === 'unknown') return 'Unknown';
    return String(value).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
