// Zoho Inventory SaaS Application Logic & Router
document.addEventListener('DOMContentLoaded', () => {
    // State management
    let state = {
        materials: [],
        summary: {},
        activeFilter: 'all',
        searchTerm: '',
        donutChartInstance: null,
        multiChartInstance: null,
        drawerChartInstance: null,
        selectedMaterialId: null
    };

    // View Router Logic
    const navItems = document.querySelectorAll('.nav-item');
    const contentViews = document.querySelectorAll('.content-view');

    function switchView(viewId) {
        navItems.forEach(item => {
            if (item.getAttribute('data-view') === viewId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        contentViews.forEach(view => {
            if (view.id === viewId) {
                view.classList.add('active-view');
            } else {
                view.classList.remove('active-view');
            }
        });
    }

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = e.currentTarget.getAttribute('data-view');
            if (targetView) switchView(targetView);
        });
    });

    // Element references
    const dashTotalStock = document.getElementById('dash-total-stock');
    const dashHighRisk = document.getElementById('dash-high-risk');
    const dashReorderUnits = document.getElementById('dash-reorder-units');
    const dashAvgLeadtime = document.getElementById('dash-avg-leadtime');
    const sidebarAlertCount = document.getElementById('sidebar-alert-count');
    const bellBadgeCount = document.getElementById('bell-badge-count');
    const itemsTbody = document.getElementById('items-tbody');
    const alertFeed = document.getElementById('dash-alert-feed');
    const globalSearch = document.getElementById('global-search');
    const itemsSearch = document.getElementById('items-table-search');

    // Drawer Elements
    const drawerBackdrop = document.getElementById('zoho-drawer-backdrop');
    const drawerCloseBtn = document.getElementById('drawer-close-btn');

    // Fetch master pipeline dataset from server
    async function loadPipelineData() {
        try {
            const resp = await fetch('/api/inventory/materials');
            if (!resp.ok) throw new Error('API fetch failed');
            const data = await resp.json();
            state.materials = data.materials || [];
            state.summary = data.summary || {};

            renderDashboardMetrics();
            renderDonutChart();
            renderItemsTable();
            renderAlertFeed();
            populateForecastSelect();
        } catch (err) {
            console.error('Failed to load inventory data:', err);
        }
    }

    function renderDashboardMetrics() {
        const s = state.summary;
        if (dashTotalStock) dashTotalStock.textContent = (s.total_stock_units || 0).toLocaleString();
        if (dashHighRisk) dashHighRisk.textContent = s.high_risk_count || 0;
        if (dashReorderUnits) dashReorderUnits.textContent = (s.total_reorder_qty || 0).toLocaleString();
        if (dashAvgLeadtime) dashAvgLeadtime.textContent = `${s.avg_lead_time || 0} days`;

        if (sidebarAlertCount) sidebarAlertCount.textContent = s.high_risk_count || 0;
        if (bellBadgeCount) bellBadgeCount.textContent = s.high_risk_count || 0;

        const countOpt = state.materials.length - (s.high_risk_count || 0);
        const donutOpt = document.getElementById('donut-optimal-count');
        const donutRisk = document.getElementById('donut-risk-count');
        if (donutOpt) donutOpt.textContent = countOpt;
        if (donutRisk) donutRisk.textContent = s.high_risk_count || 0;
    }

    function renderDonutChart() {
        const ctx = document.getElementById('healthDonutChart');
        if (!ctx) return;
        if (state.donutChartInstance) state.donutChartInstance.destroy();

        const highCount = state.summary.high_risk_count || 0;
        const lowCount = state.materials.length - highCount;

        state.donutChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Healthy Stock', 'High Stockout Risk'],
                datasets: [{
                    data: [lowCount, highCount],
                    backgroundColor: ['#10b981', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                cutout: '72%'
            }
        });
    }

    function renderItemsTable() {
        if (!itemsTbody) return;

        const filtered = state.materials.filter(mat => {
            const matchesFilter = (state.activeFilter === 'all') || (mat.stockout_risk === state.activeFilter);
            const matchesSearch = mat.material_id.toLowerCase().includes(state.searchTerm.toLowerCase());
            return matchesFilter && matchesSearch;
        });

        if (filtered.length === 0) {
            itemsTbody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align:center; padding: 24px; color: var(--zoho-text-muted);">
                        No materials found matching criteria.
                    </td>
                </tr>`;
            return;
        }

        itemsTbody.innerHTML = filtered.map(mat => {
            const isHigh = mat.stockout_risk === 'HIGH';
            const riskBadge = isHigh 
                ? `<span class="zoho-badge badge-risk-high">⚠️ HIGH RISK</span>`
                : `<span class="zoho-badge badge-risk-low">✓ HEALTHY</span>`;

            return `
                <tr data-id="${mat.material_id}">
                    <td><strong>${mat.material_id}</strong></td>
                    <td>${mat.lead_time} days</td>
                    <td class="${isHigh ? 'text-rose font-bold' : ''}">${mat.current_stock.toLocaleString()}</td>
                    <td>${mat.avg_forecast.toLocaleString()} / day</td>
                    <td>${mat.safety_stock.toLocaleString()}</td>
                    <td class="text-amber"><strong>${mat.reorder_point.toLocaleString()}</strong></td>
                    <td class="text-emerald">${mat.eoq.toLocaleString()}</td>
                    <td class="${mat.recommended_order_qty > 0 ? 'text-emerald font-bold' : ''}">
                        ${mat.recommended_order_qty.toLocaleString()}
                    </td>
                    <td>${riskBadge}</td>
                    <td>
                        <button class="btn btn-sm btn-secondary btn-inspect" data-id="${mat.material_id}">Inspect →</button>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach click listeners to rows & inspect buttons
        itemsTbody.querySelectorAll('tr').forEach(row => {
            row.addEventListener('click', (e) => {
                const matId = row.getAttribute('data-id');
                if (matId) openRightDrawer(matId);
            });
        });
    }

    function renderAlertFeed() {
        if (!alertFeed) return;
        const highRiskItems = state.materials.filter(m => m.stockout_risk === 'HIGH');

        if (highRiskItems.length === 0) {
            alertFeed.innerHTML = `
                <div style="padding: 16px; background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 6px; color: #065f46; font-size: 0.85rem;">
                    ✓ All 15 raw materials are currently operating at healthy stock levels above Reorder Point (ROP).
                </div>`;
            return;
        }

        alertFeed.innerHTML = highRiskItems.map(mat => `
            <div class="alert-feed-item">
                <div class="alert-item-info">
                    <span class="alert-item-mat">${mat.material_id}</span>
                    <div>
                        <strong>Stockout Warning: ${mat.current_stock} units left</strong>
                        <div class="alert-item-sub">ROP Threshold: ${mat.reorder_point} • Recommended EOQ Batch: ${mat.eoq} units</div>
                    </div>
                </div>
                <button class="btn btn-sm btn-warning btn-inspect" data-id="${mat.material_id}">View Analytics</button>
            </div>
        `).join('');

        alertFeed.querySelectorAll('.btn-inspect').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const matId = e.currentTarget.getAttribute('data-id');
                openRightDrawer(matId);
            });
        });
    }

    function populateForecastSelect() {
        const sel = document.getElementById('select-forecast-material');
        if (!sel) return;
        sel.innerHTML = state.materials.map(m => `<option value="${m.material_id}">${m.material_id} (Lead Time: ${m.lead_time} days)</option>`).join('');
        
        sel.addEventListener('change', (e) => renderMultiForecastChart(e.target.value));
        if (state.materials.length > 0) renderMultiForecastChart(state.materials[0].material_id);
    }

    async function renderMultiForecastChart(matId) {
        const ctx = document.getElementById('multiForecastChart');
        if (!ctx) return;
        try {
            const resp = await fetch(`/api/inventory/material/${matId}`);
            if (!resp.ok) return;
            const data = await resp.json();
            const forecast = data.forecast || [];
            
            if (state.multiChartInstance) state.multiChartInstance.destroy();

            state.multiChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: forecast.map(f => f.date),
                    datasets: [{
                        label: `Predicted Usage for ${matId}`,
                        data: forecast.map(f => f.predicted_units),
                        backgroundColor: '#3b82f6',
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true } }
                }
            });
        } catch (err) {
            console.error('Failed forecast chart fetch:', err);
        }
    }

    // Open Zoho Slide-over Right Drawer
    async function openRightDrawer(matId) {
        state.selectedMaterialId = matId;
        document.getElementById('drawer-mat-id').textContent = matId;
        drawerBackdrop.classList.remove('hidden');

        try {
            const resp = await fetch(`/api/inventory/material/${matId}`);
            if (!resp.ok) throw new Error('Failed to load item detail');
            const data = await resp.json();
            const rec = data.recommendation;

            document.getElementById('drawer-title').textContent = `${matId} Inventory Analytics`;
            document.getElementById('drawer-stock-val').textContent = rec.current_stock.toLocaleString();
            document.getElementById('drawer-lt-val').textContent = `${rec.lead_time} days`;
            document.getElementById('drawer-ss-val').textContent = rec.safety_stock.toLocaleString();
            document.getElementById('drawer-rop-val').textContent = rec.reorder_point.toLocaleString();
            document.getElementById('drawer-eoq-val').textContent = rec.eoq.toLocaleString();
            document.getElementById('drawer-order-val').textContent = rec.recommended_order_qty.toLocaleString();

            const isHigh = rec.stockout_risk === 'HIGH';
            const banner = document.getElementById('drawer-risk-banner');
            if (isHigh) {
                banner.className = 'drawer-banner banner-high';
                document.getElementById('drawer-risk-title').textContent = 'HIGH STOCKOUT RISK ALERT';
                document.getElementById('drawer-risk-sub').textContent = `Stock (${rec.current_stock}) is below Reorder Point (${rec.reorder_point}). Recommended EOQ order: ${rec.eoq} units.`;
            } else {
                banner.className = 'drawer-banner banner-low';
                document.getElementById('drawer-risk-title').textContent = 'HEALTHY INVENTORY POSITION';
                document.getElementById('drawer-risk-sub').textContent = `Current stock (${rec.current_stock}) is sufficient to cover forecasted lead-time demand plus safety stock buffer.`;
            }

            renderDrawerChart(data);
        } catch (err) {
            console.error('Drawer load error:', err);
        }
    }

    function renderDrawerChart(data) {
        const ctx = document.getElementById('drawerChart').getContext('2d');
        if (state.drawerChartInstance) state.drawerChartInstance.destroy();

        const history = data.history_90 || [];
        const forecast = data.forecast || [];
        const rec = data.recommendation;

        const labels = [...history.map(h => h.date), ...forecast.map(f => f.date)];
        const histData = [...history.map(h => h.units_used), ...forecast.map(() => null)];
        const forecastData = [...history.map(() => null), ...forecast.map(f => f.predicted_units)];

        state.drawerChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'History 90d',
                        data: histData,
                        borderColor: '#94a3b8',
                        borderWidth: 1.5,
                        pointRadius: 0
                    },
                    {
                        label: 'ML Forecast',
                        data: forecastData,
                        borderColor: '#2563eb',
                        borderWidth: 2.5,
                        pointRadius: 3
                    },
                    {
                        label: 'ROP Threshold',
                        data: labels.map(() => rec.reorder_point),
                        borderColor: '#d97706',
                        borderDash: [5, 4],
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { ticks: { maxTicksLimit: 8 } } }
            }
        });
    }

    // Event Listeners
    if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', () => drawerBackdrop.classList.add('hidden'));
    if (drawerBackdrop) drawerBackdrop.addEventListener('click', (e) => {
        if (e.target === drawerBackdrop) drawerBackdrop.classList.add('hidden');
    });

    // Table Pill Filters
    document.querySelectorAll('.table-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
            document.querySelectorAll('.table-pill').forEach(p => p.classList.remove('active'));
            e.currentTarget.classList.add('active');
            state.activeFilter = e.currentTarget.getAttribute('data-filter');
            renderItemsTable();
        });
    });

    if (itemsSearch) {
        itemsSearch.addEventListener('input', (e) => {
            state.searchTerm = e.target.value;
            renderItemsTable();
        });
    }

    if (globalSearch) {
        globalSearch.addEventListener('input', (e) => {
            state.searchTerm = e.target.value;
            switchView('view-items');
            renderItemsTable();
        });
    }

    // Shortage Simulation Buttons & Form
    const btnQuickShortage = document.getElementById('btn-quick-shortage');
    const btnDashSimulate = document.getElementById('btn-dashboard-simulate');
    const simForm = document.getElementById('sim-form');

    async function executeShortageSim(matId = 'MAT_01', dropPct = 0.1) {
        try {
            const resp = await fetch('/api/inventory/simulate-shortage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ material_id: matId, drop_to_pct: dropPct })
            });
            const res = await resp.json();
            if (res.success) {
                loadPipelineData();
                switchView('view-dashboard');
            }
        } catch (err) {
            console.error('Sim error:', err);
        }
    }

    if (btnQuickShortage) btnQuickShortage.addEventListener('click', () => executeShortageSim('MAT_01', 0.1));
    if (btnDashSimulate) btnDashSimulate.addEventListener('click', () => executeShortageSim('MAT_01', 0.1));

    if (simForm) {
        simForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const matId = document.getElementById('sim-mat-select').value;
            const dropPct = parseFloat(document.getElementById('sim-drop-pct').value);
            executeShortageSim(matId, dropPct);
        });
    }

    // Refresh & Reset buttons
    document.querySelectorAll('.btn-refresh-data').forEach(btn => btn.addEventListener('click', loadPipelineData));
    document.querySelectorAll('.btn-reset-synthetic').forEach(btn => {
        btn.addEventListener('click', async () => {
            const resp = await fetch('/api/inventory/regenerate-data', { method: 'POST' });
            if (resp.ok) loadPipelineData();
        });
    });

    // Boot app data
    loadPipelineData();
});
