// Security and Authorization check
const token = localStorage.getItem('jwtToken');
const role = localStorage.getItem('role');
if (!token || role !== 'ADMIN') {
    window.location.href = '/login.html';
}

// Store loaded transactions in memory for search and details modal
const loadedTransactions = {};
let currentLimit = 20;

// Populate analyst profile name from username
const currentUsername = localStorage.getItem('username');
if (currentUsername) {
    const profileEl = document.getElementById('profile-username');
    if (profileEl) {
        profileEl.innerText = currentUsername.split('@')[0];
    }
}

// Secure logout
document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.clear();
    window.location.href = '/login.html';
});

// Load initial transactions from the database
async function loadTransactions(limit = 20) {
    try {
        const response = await fetch(`/api/admin/transactions?limit=${limit}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error("Failed to load transactions.");
        
        const transactions = await response.json();
        const tbody = document.getElementById('admin-transaction-rows');
        tbody.innerHTML = '';

        if (transactions.length === 0) {
            tbody.innerHTML = `
                <tr class="hover:bg-surface-container-highest/30 transition-colors group">
                    <td colspan="6" class="px-lg py-8 text-center text-on-surface-variant font-label-md">Aucune transaction récente.</td>
                </tr>
            `;
            return;
        }

        transactions.forEach(tx => {
            loadedTransactions[tx.id] = tx;
            appendTransactionRow(tx);
        });
    } catch (err) {
        console.error("Error loading transactions", err);
    }
}

// Connect to WebSocket using SockJS and STOMP
function connectWebsocket() {
    const socket = new SockJS('/ws');
    const stompClient = Stomp.over(socket);
    stompClient.debug = null; // Quiet stomp logging

    stompClient.connect({}, (frame) => {
        console.log("✅ Stomp WebSocket connected!");
        
        stompClient.subscribe('/topic/transactions', (message) => {
            const tx = JSON.parse(message.body);
            loadedTransactions[tx.id] = tx;
            prependTransactionRow(tx);
        });
    }, (error) => {
        console.error("⚠️ WebSocket disconnect, retrying in 5s...", error);
        setTimeout(connectWebsocket, 5000);
    });
}

// Populate a transaction row at the bottom (initial load)
function appendTransactionRow(tx) {
    const tbody = document.getElementById('admin-transaction-rows');
    const row = createRowElement(tx);
    tbody.appendChild(row);
}

// Prepend dynamic real-time transaction rows
function prependTransactionRow(tx) {
    const tbody = document.getElementById('admin-transaction-rows');
    
    // Remove empty placeholder row if present
    if (tbody.children.length === 1 && (tbody.innerText.includes("En attente") || tbody.innerText.includes("Aucune transaction"))) {
        tbody.innerHTML = '';
    }

    const row = createRowElement(tx);
    tbody.insertBefore(row, tbody.firstChild);

    // Highlight new WebSocket prepends
    row.classList.add('bg-primary/5');
    setTimeout(() => row.classList.remove('bg-primary/5'), 2000);

    // Truncate to maximum of 30 rows on live screen
    if (tbody.children.length > 30) {
        tbody.removeChild(tbody.lastChild);
    }

    // Trigger dynamic metrics reload
    fetchStats();
}

// Helper to create table row element
function createRowElement(tx) {
    const row = document.createElement('tr');
    row.setAttribute("data-id", tx.id);
    const isFraud = tx.isFraud;

    if (isFraud) {
        row.className = "hover:bg-error/5 bg-error/5 border-l-4 border-error transition-all duration-500 group";
    } else {
        row.className = "hover:bg-surface-container-highest/30 transition-colors group";
    }

    const name = tx.fullName || `Card Holder ${tx.ccNum ? tx.ccNum.slice(-4) : 'XXXX'}`;
    const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const bgClass = isFraud ? "bg-error/20 text-error" : "bg-primary/10 text-primary";

    let statusSpan = '';
    const riskScoreVal = tx.riskScore || 0;
    if (isFraud) {
        statusSpan = `
            <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-error/10 text-error border border-error/20 text-xs font-bold uppercase">
                <span class="status-dot bg-error animate-pulse"></span>
                FRAUDE (${riskScoreVal.toFixed(0)}%)
            </span>
        `;
    } else {
        statusSpan = `
            <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/10 text-secondary border border-secondary/20 text-xs font-bold uppercase">
                <span class="status-dot bg-secondary"></span>
                NORMAL
            </span>
        `;
    }

    row.innerHTML = `
        <td class="px-lg py-4">
            <div class="flex items-center gap-md">
                <div class="w-8 h-8 rounded-full ${bgClass} flex items-center justify-center font-bold text-xs">${initials}</div>
                <span class="font-body-md text-on-surface">${name}</span>
            </div>
        </td>
        <td class="px-lg py-4 font-label-md text-label-md text-on-surface-variant">**** **** **** ${tx.ccNum ? tx.ccNum.slice(-4) : 'XXXX'}</td>
        <td class="px-lg py-4 font-body-md text-on-surface">${tx.merchant}</td>
        <td class="px-lg py-4 font-label-md text-label-md font-bold ${isFraud ? 'text-error' : 'text-primary'}">${tx.amt.toFixed(2)} €</td>
        <td class="px-lg py-4">${statusSpan}</td>
        <td class="px-lg py-4 text-right">
            <div class="flex justify-end gap-xs opacity-40 group-hover:opacity-100 transition-opacity">
                <button onclick="viewDetails('${tx.id}')" class="p-2 text-primary hover:bg-primary/10 rounded" title="Voir détails">
                    <span class="material-symbols-outlined text-[20px]">visibility</span>
                </button>
            </div>
        </td>
    `;
    return row;
}

// Open transaction details modal
function viewDetails(id) {
    const tx = loadedTransactions[id];
    if (tx) {
        showDetailsModal(tx);
    }
}

// Modal Builder & Injection
function showDetailsModal(tx) {
    let modal = document.getElementById('details-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'details-modal';
    modal.className = 'fixed inset-0 bg-surface/85 backdrop-blur-md flex items-center justify-center z-50 p-md transition-all duration-300';
    
    const riskScoreVal = tx.riskScore || 0;
    const isFraud = tx.isFraud;
    const badge = isFraud 
        ? `<span class="bg-error/10 text-error px-3 py-1 rounded-full text-xs font-bold border border-error/20 flex items-center gap-1.5 uppercase"><span class="w-1.5 h-1.5 bg-error rounded-full animate-pulse"></span> FRAUDE (${riskScoreVal.toFixed(0)}%)</span>`
        : `<span class="bg-secondary/10 text-secondary px-3 py-1 rounded-full text-xs font-bold border border-secondary/20 flex items-center gap-1.5 uppercase"><span class="w-1.5 h-1.5 bg-secondary rounded-full"></span> SÉCURISÉ</span>`;

    const graphRiskAdjustment = tx.graphSignals?.graphRiskAdjustment || 0;
    const cardTransactionCount = tx.graphSignals?.cardTransactionCount || 0;
    const merchantPastFraudIncidents = tx.graphSignals?.merchantPastFraudIncidents || 0;

    modal.innerHTML = `
        <div class="glass-panel border border-outline-variant/30 w-full max-w-xl rounded-xl p-lg shadow-2xl relative flex flex-col gap-md max-h-[90vh] overflow-y-auto">
            <!-- Modal Header -->
            <div class="flex justify-between items-center border-b border-white/5 pb-4">
                <div>
                    <span class="text-primary font-label-sm text-xs uppercase tracking-wider block">ID TRANSACTION</span>
                    <h3 class="font-label-md text-label-md text-on-surface select-all">${tx.id}</h3>
                </div>
                <button onclick="document.getElementById('details-modal').remove()" class="p-2 text-on-surface-variant hover:bg-white/5 rounded-full">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>

            <!-- Modal Content -->
            <div class="space-y-md">
                <!-- Row 1: Amount & Status -->
                <div class="grid grid-cols-2 gap-md items-center">
                    <div>
                        <span class="text-outline font-label-sm text-[10px] uppercase">Montant</span>
                        <div class="text-2xl font-bold font-headline-sm text-primary mt-1">${tx.amt.toFixed(2)} €</div>
                    </div>
                    <div>
                        <span class="text-outline font-label-sm text-[10px] uppercase">Statut Décision</span>
                        <div class="mt-1">${badge}</div>
                    </div>
                </div>

                <!-- Row 2: Card & User -->
                <div class="grid grid-cols-2 gap-md">
                    <div>
                        <span class="text-outline font-label-sm text-[10px] uppercase">Titulaire</span>
                        <div class="font-body-md font-semibold text-on-surface mt-1">${tx.fullName || "Card Holder"}</div>
                    </div>
                    <div>
                        <span class="text-outline font-label-sm text-[10px] uppercase">Numéro de carte</span>
                        <div class="font-label-md text-label-md text-on-surface mt-1">**** **** **** ${tx.ccNum ? tx.ccNum.slice(-4) : 'XXXX'}</div>
                    </div>
                </div>

                <!-- Row 3: Merchant & Category -->
                <div class="grid grid-cols-2 gap-md">
                    <div>
                        <span class="text-outline font-label-sm text-[10px] uppercase">Marchand</span>
                        <div class="font-body-md font-semibold text-on-surface mt-1">${tx.merchant}</div>
                    </div>
                    <div>
                        <span class="text-outline font-label-sm text-[10px] uppercase">Catégorie</span>
                        <div class="font-body-md text-on-surface-variant mt-1">${tx.category || "Général"}</div>
                    </div>
                </div>

                <!-- Row 4: Date -->
                <div>
                    <span class="text-outline font-label-sm text-[10px] uppercase">Date de Transaction</span>
                    <div class="font-label-md text-label-md text-on-surface mt-1">${tx.transDate}</div>
                </div>

                <!-- Row 5: ML Prediction Insights -->
                <div class="bg-surface-container-high/40 border border-white/5 p-md rounded-lg">
                    <h4 class="text-primary font-label-md text-xs uppercase tracking-wider mb-2 flex items-center gap-1">
                        <span class="material-symbols-outlined text-sm">analytics</span> Analyse IA
                    </h4>
                    <div class="grid grid-cols-2 gap-sm text-sm">
                        <div>
                            <span class="text-outline text-xs">Score de risque :</span>
                            <span class="font-bold text-on-surface ml-1">${tx.riskScore ? tx.riskScore.toFixed(2) : 0}%</span>
                        </div>
                        <div>
                            <span class="text-outline text-xs">Certitude (Confidence) :</span>
                            <span class="font-bold text-on-surface ml-1">${tx.confidenceScore ? tx.confidenceScore.toFixed(2) : 50}%</span>
                        </div>
                    </div>
                </div>

                <!-- Row 6: Graph Security Signals -->
                <div class="bg-surface-container-high/40 border border-white/5 p-md rounded-lg">
                    <h4 class="text-secondary font-label-md text-xs uppercase tracking-wider mb-2 flex items-center gap-1">
                        <span class="material-symbols-outlined text-sm">hub</span> Signaux de Sécurité Graphe
                    </h4>
                    <div class="space-y-1.5 text-xs">
                        <div class="flex justify-between">
                            <span class="text-outline">Activité carte (historique) :</span>
                            <span class="font-semibold text-on-surface">${cardTransactionCount} transactions</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-outline">Historique fraudes marchand :</span>
                            <span class="font-semibold text-on-surface">${merchantPastFraudIncidents} cas passés</span>
                        </div>
                        <div class="flex justify-between pt-1 border-t border-white/5">
                            <span class="text-outline">Poids d'ajustement graphe :</span>
                            <span class="font-bold text-secondary">+${graphRiskAdjustment}%</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Modal Actions -->
            <div class="flex gap-md border-t border-white/5 pt-4 mt-2 justify-end">
                <button onclick="document.getElementById('details-modal').remove()" class="px-5 py-2.5 bg-surface-container-high hover:bg-surface-bright text-on-surface font-label-md text-label-md rounded-lg transition-all">
                    Fermer
                </button>
                <button onclick="triggerDelete('${tx.id}')" class="px-5 py-2.5 bg-error/20 hover:bg-error/30 text-error font-label-md text-label-md rounded-lg transition-all flex items-center gap-1.5 border border-error/20">
                    <span class="material-symbols-outlined text-sm">delete</span> Supprimer la transaction
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

// Trigger REST call to delete transaction
async function triggerDelete(id) {
    if (!confirm("Êtes-vous sûr de vouloir supprimer définitivement cette transaction ?")) return;
    try {
        const response = await fetch(`/api/admin/transactions/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (response.ok) {
            // Remove modal
            const modal = document.getElementById('details-modal');
            if (modal) modal.remove();
            
            // Remove from local dictionary
            delete loadedTransactions[id];
            
            // Remove row from table
            const rows = document.querySelectorAll('#admin-transaction-rows tr');
            rows.forEach(row => {
                if (row.getAttribute("data-id") === id) {
                    row.remove();
                }
            });

            // If empty, show placeholder
            const tbody = document.getElementById('admin-transaction-rows');
            if (tbody.children.length === 0) {
                tbody.innerHTML = `
                    <tr class="hover:bg-surface-container-highest/30 transition-colors group">
                        <td colspan="6" class="px-lg py-8 text-center text-on-surface-variant font-label-md">Aucune transaction récente.</td>
                    </tr>
                `;
            }

            // Refresh stats
            fetchStats();
        } else {
            alert("Erreur lors de la suppression de la transaction.");
        }
    } catch (err) {
        alert("Erreur de connexion lors de la suppression.");
    }
}

// Quick client-side searching and filtering
const searchInput = document.getElementById('transaction-search');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const rows = document.querySelectorAll('#admin-transaction-rows tr');
        rows.forEach(row => {
            if (row.innerText.includes("En attente") || row.innerText.includes("Aucune transaction")) return;
            const text = row.innerText.toLowerCase();
            const dataId = (row.getAttribute("data-id") || "").toLowerCase();
            if (text.includes(term) || dataId.includes(term)) {
                row.classList.remove('hidden');
            } else {
                row.classList.add('hidden');
            }
        });
    });
}

// Load More pagination listener
document.getElementById('load-more-btn').addEventListener('click', () => {
    currentLimit += 20;
    loadTransactions(currentLimit);
});

// Fetch and populate Admin Stats from REST API
async function fetchStats() {
    try {
        const res = await fetch('/api/admin/stats', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const stats = await res.json();
            
            // Update average risk score
            const avgRiskEl = document.getElementById('avg-risk-score');
            if (avgRiskEl) {
                avgRiskEl.innerHTML = `${stats.avgRiskScore.toFixed(1)} <span class="text-headline-sm font-headline-sm text-outline">/ 100</span>`;
            }

            // Update live speed label
            const txSpeedLabel = document.getElementById('live-tx-count');
            if (txSpeedLabel) {
                txSpeedLabel.innerText = `TOTAL TX : ${stats.totalTransactions}`;
            }

            // Update meters if transactions exist
            if (stats.totalTransactions > 0) {
                const fraudPct = (stats.fraudAlertsCount / stats.totalTransactions) * 100;
                const normalPct = 100 - fraudPct;
                
                const normalPctLabel = document.getElementById('normal-pct-label');
                const normalPctBar = document.getElementById('normal-pct-bar');
                if (normalPctLabel) normalPctLabel.innerText = `${normalPct.toFixed(1)}%`;
                if (normalPctBar) normalPctBar.style.width = `${normalPct}%`;
                
                const suspectPctLabel = document.getElementById('suspect-pct-label');
                const suspectPctBar = document.getElementById('suspect-pct-bar');
                if (suspectPctLabel) suspectPctLabel.innerText = `${(fraudPct * 0.7).toFixed(1)}%`;
                if (suspectPctBar) suspectPctBar.style.width = `${fraudPct * 0.7}%`;
                
                const critiquePctLabel = document.getElementById('critique-pct-label');
                const critiquePctBar = document.getElementById('critique-pct-bar');
                if (critiquePctLabel) critiquePctLabel.innerText = `${(fraudPct * 0.3).toFixed(1)}%`;
                if (critiquePctBar) critiquePctBar.style.width = `${fraudPct * 0.3}%`;
            }
        }
    } catch (err) {
        console.error("Failed to load statistics from API", err);
    }
}

// Initialize Dashboard
fetchStats();
loadTransactions(currentLimit);
connectWebsocket();

// Streaming Control Logic
async function checkStreamingStatus() {
    try {
        const res = await fetch('/api/admin/streaming/status', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            updateStreamingUI(data.enabled);
        }
    } catch (err) {
        console.error("Error fetching streaming status", err);
    }
}

async function toggleStreaming() {
    const btn = document.getElementById('toggle-streaming-btn');
    if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-50');
    }
    
    try {
        const res = await fetch('/api/admin/streaming/toggle', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            updateStreamingUI(data.enabled);
        }
    } catch (err) {
        console.error("Error toggling streaming", err);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('opacity-50');
        }
    }
}

function updateStreamingUI(isEnabled) {
    const btnText = document.getElementById('toggle-streaming-text');
    const btnIcon = document.getElementById('toggle-streaming-icon');
    const btn = document.getElementById('toggle-streaming-btn');
    
    const indicatorPanel = document.getElementById('live-indicator-panel');
    const indicatorDot = document.getElementById('live-indicator-dot');
    const txCount = document.getElementById('live-tx-count');

    if (isEnabled) {
        if (btnText) btnText.innerText = "Pause";
        if (btnIcon) btnIcon.innerText = "pause";
        if (btnIcon) btnIcon.classList.replace('text-primary', 'text-secondary');
        if (btn) btn.classList.replace('border-primary/50', 'border-outline-variant/30');
        
        if (indicatorPanel) indicatorPanel.classList.replace('border-outline-variant', 'border-secondary');
        if (indicatorPanel) indicatorPanel.classList.replace('opacity-50', 'opacity-100');
        if (indicatorDot) indicatorDot.classList.remove('hidden');
        if (txCount) txCount.classList.replace('text-on-surface-variant', 'text-secondary');
        fetchStats(); // Update the label correctly
    } else {
        if (btnText) btnText.innerText = "Reprendre";
        if (btnIcon) btnIcon.innerText = "play_arrow";
        if (btnIcon) btnIcon.classList.replace('text-secondary', 'text-primary');
        if (btn) btn.classList.replace('border-outline-variant/30', 'border-primary/50');
        
        if (indicatorPanel) indicatorPanel.classList.replace('border-secondary', 'border-outline-variant');
        if (indicatorPanel) indicatorPanel.classList.replace('opacity-100', 'opacity-50');
        if (indicatorDot) indicatorDot.classList.add('hidden');
        if (txCount) txCount.classList.replace('text-secondary', 'text-on-surface-variant');
        if (txCount) txCount.innerText = "EN PAUSE";
    }
}

const toggleBtn = document.getElementById('toggle-streaming-btn');
if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleStreaming);
}

// Initial status check
checkStreamingStatus();

