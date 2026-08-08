// Replenishment Health Dashboard Frontend Logic
document.addEventListener('DOMContentLoaded', () => {
    // State management
    let state = {
        materials: [],
        summary: {},
        activeFilter: 'all',
        searchTerm: '',
        chartInstance: null
    };

    // DOM Elements
    const elTotalMat = document.getElementById('kpi-total-mat');
    const elHighRisk = document.getElementById('kpi-high-risk');
    const elReorderQty = document.getElementById('kpi-reorder-qty');
    const elLastUpdated = document.getElementById('last-updated-time');
    const tbody = document.getElementById('materials-tbody');
    const searchInput = document.getElementById('input-search');
    const filterTabs = document.querySelectorAll('.tab-btn');
    const countAll = document.getElementById('count-all');
    const countHigh = document.getElementById('count-high');
    const countLow = document.getElementById('count-low');

    // Buttons
    const btnRefresh = document.getElementById('btn-refresh');
    const btnSimulateShortage = document.getElementById('btn-simulate-shortage');
    const btnResetData = document.getElementById('btn-reset-data');

    // Modals
    const forecastModal = document.getElementById('forecast-modal');
    const modalClose = document.getElementById('modal-close');
    const stockModal = document.getElementById('stock-modal');
    const stockModalClose = document.getElementById('stock-modal-close');
    const btnCancelStock = document.getElementById('btn-cancel-stock');
    const stockForm = document.getElementById('stock-form');

    // Fetch master pipeline dataset from backend
    async function loadData() {
        showLoadingState();
        try {
            const response = await fetch('/api/inventory/materials');
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
            const data = await response.json();
            state.materials = data.materials || [];
            state.summary = data.summary || {};
            renderKPIs();
            renderTable();
        } catch (err) {
            console.error('Error fetching pipeline data:', err);
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="loading-cell text-rose">
                        ⚠️ Failed to load inventory pipeline data from backend server.
                        <br><small>${err.message}</small>
                    </td>
                </tr>`;
        }
    }

    function renderKPIs() {
        const s = state.summary;
        if (elTotalMat) elTotalMat.textContent = s.total_materials || 0;
        if (elHighRisk) elHighRisk.textContent = s.high_risk_count || 0;
        if (elReorderQty) elReorderQty.textContent = (s.total_reorder_qty || 0).toLocaleString();
        if (elLastUpdated) elLastUpdated.textContent = s.last_updated || new Date().toLocaleTimeString();

        // Update counts on filter tabs
        const total = state.materials.length;
        const highCount = state.materials.filter(m => m.stockout_risk === 'HIGH').length;
        const lowCount = total - highCount;

        if (countAll) countAll.textContent = total;
        if (countHigh) countHigh.textContent = highCount;
        if (countLow) countLow.textContent = lowCount;
    }

    function renderTable() {
        const filtered = state.materials.filter(mat => {
            const matchesFilter = (state.activeFilter === 'all') || (mat.stockout_risk === state.activeFilter);
            const matchesSearch = mat.material_id.toLowerCase().includes(state.searchTerm.toLowerCase());
            return matchesFilter && matchesSearch;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        No materials match the current filter criteria.
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(mat => {
            const isHigh = mat.stockout_risk === 'HIGH';
            const riskBadge = isHigh 
                ? `<span class="badge badge-high">⚠️ HIGH</span>`
                : `<span class="badge badge-low">✓ LOW</span>`;

            return `
                <tr>
                    <td class="mat-id-cell">${mat.material_id}</td>
                    <td class="num-cell">${mat.lead_time} days</td>
                    <td class="num-cell ${isHigh ? 'text-rose' : ''}"><strong>${mat.current_stock.toLocaleString()}</strong></td>
                    <td class="num-cell">${mat.avg_forecast.toLocaleString()} / day</td>
                    <td class="num-cell">${mat.safety_stock.toLocaleString()}</td>
                    <td class="num-cell text-amber">${mat.reorder_point.toLocaleString()}</td>
                    <td class="num-cell text-emerald">${mat.eoq.toLocaleString()}</td>
                    <td class="num-cell ${mat.recommended_order_qty > 0 ? 'text-emerald font-bold' : ''}">
                        ${mat.recommended_order_qty > 0 ? mat.recommended_order_qty.toLocaleString() : '0'}
                    </td>
                    <td>${riskBadge}</td>
                    <td>
                        <div class="action-btns">
                            <button class="btn-icon-sm btn-view-chart" data-id="${mat.material_id}" title="View ML Forecast Chart">
                                📈 Chart
                            </button>
                            <button class="btn-icon-sm btn-edit-stock" data-id="${mat.material_id}" data-stock="${mat.current_stock}" title="Adjust Inventory Level">
                                ✏️ Edit
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach event listeners to table row action buttons
        document.querySelectorAll('.btn-view-chart').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const matId = e.currentTarget.getAttribute('data-id');
                openForecastModal(matId);
            });
        });

        document.querySelectorAll('.btn-edit-stock').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const matId = e.currentTarget.getAttribute('data-id');
                const stock = e.currentTarget.getAttribute('data-stock');
                openStockModal(matId, stock);
            });
        });
    }

    function showLoadingState() {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="loading-cell">
                    <div class="spinner"></div>
                    <span>Evaluating ML demand forecasts & running Continuous Review pipeline...</span>
                </td>
            </tr>`;
    }

    // Modal 1: Open Forecast & Chart Analytics Modal
    async function openForecastModal(matId) {
        document.getElementById('modal-title').textContent = `Material Analytics & ML Forecast — ${matId}`;
        forecastModal.classList.remove('hidden');

        try {
            const resp = await fetch(`/api/inventory/material/${matId}`);
            if (!resp.ok) throw new Error('Material detail not found');
            const data = await resp.json();

            const rec = data.recommendation;
            document.getElementById('modal-subtitle').textContent = 
                `${matId} • Lead Time: ${rec.lead_time} days • Base Demand: ${rec.base_demand} units/day`;

            document.getElementById('formula-ss-val').textContent = `${rec.safety_stock.toLocaleString()} units`;
            document.getElementById('formula-rop-val').textContent = `${rec.reorder_point.toLocaleString()} units`;
            document.getElementById('formula-eoq-val').textContent = `${rec.eoq.toLocaleString()} units`;

            renderForecastChart(data);
        } catch (err) {
            console.error('Failed to load modal details:', err);
        }
    }

    function renderForecastChart(data) {
        const ctx = document.getElementById('forecastChart').getContext('2d');
        if (state.chartInstance) {
            state.chartInstance.destroy();
        }

        const history = data.history_90 || [];
        const forecast = data.forecast || [];
        const rec = data.recommendation;

        const historyLabels = history.map(h => h.date);
        const forecastLabels = forecast.map(f => f.date);
        const allLabels = [...historyLabels, ...forecastLabels];

        const historySeries = [...history.map(h => h.units_used), ...forecastLabels.map(() => null)];
        const forecastSeries = [...historyLabels.map((_, idx) => idx === historyLabels.length - 1 ? history[history.length - 1].units_used : null), ...forecast.map(f => f.predicted_units)];

        const ropLine = allLabels.map(() => rec.reorder_point);
        const ssLine = allLabels.map(() => rec.safety_stock);

        state.chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: allLabels,
                datasets: [
                    {
                        label: 'Historical Daily Demand',
                        data: historySeries,
                        borderColor: '#9ca3af',
                        backgroundColor: 'rgba(156, 163, 175, 0.05)',
                        borderWidth: 1.8,
                        pointRadius: 0,
                        tension: 0.2
                    },
                    {
                        label: 'ML Recursive Forecast (Lead Time)',
                        data: forecastSeries,
                        borderColor: '#06b6d4',
                        backgroundColor: 'rgba(6, 182, 212, 0.15)',
                        borderWidth: 3,
                        pointRadius: 4,
                        pointBackgroundColor: '#06b6d4',
                        tension: 0.1,
                        fill: true
                    },
                    {
                        label: `Reorder Point (ROP: ${rec.reorder_point})`,
                        data: ropLine,
                        borderColor: '#f59e0b',
                        borderWidth: 2,
                        borderDash: [6, 4],
                        pointRadius: 0
                    },
                    {
                        label: `Safety Stock (SS: ${rec.safety_stock})`,
                        data: ssLine,
                        borderColor: '#f43f5e',
                        borderWidth: 2,
                        borderDash: [4, 4],
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        titleColor: '#f3f4f6',
                        bodyColor: '#cbd5e1',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#6b7280', maxTicksLimit: 12 }
                    },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#6b7280' }
                    }
                }
            }
        });
    }

    // Modal 2: Stock Adjustment Modal
    function openStockModal(matId, currentStock) {
        document.getElementById('edit-mat-id').value = matId;
        document.getElementById('edit-mat-display').value = matId;
        document.getElementById('edit-mat-stock').value = currentStock;
        stockModal.classList.remove('hidden');
    }

    // Handlers & Listeners
    searchInput.addEventListener('input', (e) => {
        state.searchTerm = e.target.value;
        renderTable();
    });

    filterTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            filterTabs.forEach(t => t.classList.remove('active'));
            e.currentTarget.classList.add('active');
            state.activeFilter = e.currentTarget.getAttribute('data-filter');
            renderTable();
        });
    });

    btnRefresh.addEventListener('click', loadData);

    btnSimulateShortage.addEventListener('click', async () => {
        showLoadingState();
        try {
            const resp = await fetch('/api/inventory/simulate-shortage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ material_id: 'MAT_01', drop_to_pct: 0.1 })
            });
            const result = await resp.json();
            if (result.success) {
                state.materials = result.data.materials || [];
                state.summary = result.data.summary || {};
                renderKPIs();
                renderTable();
            }
        } catch (err) {
            console.error('Failed to simulate shortage:', err);
        }
    });

    btnResetData.addEventListener('click', async () => {
        showLoadingState();
        try {
            const resp = await fetch('/api/inventory/regenerate-data', {
                method: 'POST'
            });
            const result = await resp.json();
            if (result.success) {
                state.materials = result.data.materials || [];
                state.summary = result.data.summary || {};
                renderKPIs();
                renderTable();
            }
        } catch (err) {
            console.error('Failed to reset data:', err);
        }
    });

    stockForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const matId = document.getElementById('edit-mat-id').value;
        const newStock = parseInt(document.getElementById('edit-mat-stock').value, 10);
        stockModal.classList.add('hidden');
        showLoadingState();

        try {
            const resp = await fetch('/api/inventory/update-stock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ material_id: matId, new_stock: newStock })
            });
            const result = await resp.json();
            if (result.success) {
                state.materials = result.data.materials || [];
                state.summary = result.data.summary || {};
                renderKPIs();
                renderTable();
            }
        } catch (err) {
            console.error('Failed to update stock:', err);
        }
    });

    // Close buttons
    modalClose.addEventListener('click', () => forecastModal.classList.add('hidden'));
    stockModalClose.addEventListener('click', () => stockModal.classList.add('hidden'));
    btnCancelStock.addEventListener('click', () => stockModal.classList.add('hidden'));

    // Initial boot
    loadData();
});
