/**
 * user_dashboard.js
 * Logic for the user personal dashboard page.
 * Handles: auth check, profile loading, transaction history, WebSocket (STOMP) real-time updates.
 */

// ── Security check ────────────────────────────────────────────────────────────
const token = localStorage.getItem('jwtToken');
if (!token) {
    window.location.href = '/login.html';
}

let userCcNum = '';

// ── Logout ────────────────────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.clear();
    window.location.href = '/login.html';
});

// ── Dynamic Navigation ────────────────────────────────────────────────────────
const role = localStorage.getItem('role');
const navDashboard = document.getElementById('nav-dashboard');
if (navDashboard) {
    navDashboard.addEventListener('click', (e) => {
        e.preventDefault();
        if (role === 'ADMIN') {
            window.location.href = '/admin/admin_dashboard.html';
        } else {
            window.location.href = '/user/user_dashboard.html';
        }
    });
}

// ── Utility: mask card number ─────────────────────────────────────────────────
function maskCardNumber(card) {
    if (!card) return 'INCONNUE';
    const trimmed = card.replace(/\s+/g, '');
    if (trimmed.length < 4) return trimmed;
    return `**** **** **** ${trimmed.slice(-4)}`;
}

// ── Update the visual account status badge ────────────────────────────────────
function updateAccountStatus(hasFraud) {
    const cardEl  = document.getElementById('summary-status-card');
    const pingEl  = document.getElementById('summary-status-ping');
    const dotEl   = document.getElementById('summary-status-dot');
    const textEl  = document.getElementById('summary-status-text');

    if (hasFraud) {
        cardEl.className  = 'px-xl py-3 rounded-lg border-l-4 flex items-center gap-md shadow-lg transition-all duration-500 bg-error/10 border-error';
        pingEl.className  = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-75';
        dotEl.className   = 'relative inline-flex rounded-full h-3.5 w-3.5 bg-error';
        textEl.className  = 'font-label-md text-label-md text-error uppercase tracking-widest font-bold';
        textEl.innerText  = 'ALERTE DE COMPROMISSION';
    } else {
        cardEl.className  = 'px-xl py-3 rounded-lg border-l-4 flex items-center gap-md shadow-lg transition-all duration-500 bg-secondary/10 border-secondary';
        pingEl.className  = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75';
        dotEl.className   = 'relative inline-flex rounded-full h-3.5 w-3.5 bg-secondary';
        textEl.className  = 'font-label-md text-label-md text-secondary uppercase tracking-widest font-bold';
        textEl.innerText  = 'COMPTE SÉCURISÉ';
    }
}

// ── Append a transaction row to the history table ─────────────────────────────
function appendRow(tx, prepend = true) {
    const tbody = document.getElementById('personal-history-rows');

    // Remove loading / empty placeholder
    if (tbody.children.length === 1 && tbody.innerText.includes('Aucune transaction')) {
        tbody.innerHTML = '';
    }

    const row = document.createElement('tr');
    row.className = 'hover:bg-white/5 transition-all duration-500 cursor-pointer group';

    const dateCell = document.createElement('td');
    dateCell.className = 'px-lg py-4 font-label-md text-label-md';
    dateCell.innerText = tx.transDate;

    const merchCell = document.createElement('td');
    merchCell.className = 'px-lg py-4 font-body-md font-semibold';
    merchCell.innerText = tx.merchant;

    const amtCell = document.createElement('td');
    amtCell.className = 'px-lg py-4 font-label-md text-label-md';
    amtCell.innerText = `-${tx.amt.toFixed(2)} €`;

    const statusCell = document.createElement('td');
    statusCell.className = 'px-lg py-4';
    const statusSpan = document.createElement('span');
    if (tx.isFraud) {
        statusSpan.className = 'inline-flex items-center gap-1 text-error bg-error/10 px-2 py-1 rounded text-[11px] font-bold uppercase tracking-tight';
        statusSpan.innerHTML = '<span class="w-1.5 h-1.5 bg-error rounded-full animate-pulse"></span> Suspect';
    } else {
        statusSpan.className = 'inline-flex items-center gap-1 text-secondary bg-secondary/10 px-2 py-1 rounded text-[11px] font-bold uppercase tracking-tight';
        statusSpan.innerHTML = '<span class="w-1.5 h-1.5 bg-secondary rounded-full"></span> Validé';
    }
    statusCell.appendChild(statusSpan);

    row.appendChild(dateCell);
    row.appendChild(merchCell);
    row.appendChild(amtCell);
    row.appendChild(statusCell);

    if (prepend) {
        tbody.insertBefore(row, tbody.firstChild);
        row.classList.add('bg-primary/10');
        setTimeout(() => row.classList.remove('bg-primary/10'), 2000);
    } else {
        tbody.appendChild(row);
    }
}

// ── Fetch personal transaction history ───────────────────────────────────────
async function loadPersonalHistory() {
    const tbody = document.getElementById('personal-history-rows');
    try {
        const response = await fetch('/api/transactions/history', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                window.location.href = '/login.html';
                return;
            }
            throw new Error('Failed to load history');
        }

        const history = await response.json();
        tbody.innerHTML = '';

        if (history.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="px-lg py-8 text-center text-on-surface-variant font-label-md">
                        Aucune transaction trouvée pour cette carte bancaire.
                    </td>
                </tr>
            `;
            updateAccountStatus(false);
            return;
        }

        let hasFraud = false;
        history.forEach(tx => {
            if (tx.isFraud) hasFraud = true;
            appendRow(tx, false);
        });
        updateAccountStatus(hasFraud);

    } catch (err) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="px-lg py-8 text-center text-error font-label-md">
                    Erreur lors de la récupération des transactions.
                </td>
            </tr>
        `;
    }
}

// ── STOMP WebSocket ───────────────────────────────────────────────────────────
function connectWebsocket() {
    const socket = new SockJS('/ws');
    const stompClient = Stomp.over(socket);
    stompClient.debug = null;

    stompClient.connect({}, () => {
        console.log('✅ Stomp WebSocket connected to User Dashboard!');
        stompClient.subscribe('/topic/transactions', (message) => {
            const tx = JSON.parse(message.body);
            if (tx.ccNum && tx.ccNum.replace(/\s+/g, '') === userCcNum.replace(/\s+/g, '')) {
                appendRow(tx, true);
                if (tx.isFraud) updateAccountStatus(true);
            }
        });
    }, (error) => {
        console.error('⚠️ STOMP Connection dropped, retrying in 5s...', error);
        setTimeout(connectWebsocket, 5000);
    });
}

// ── Load user profile, then history + websocket ───────────────────────────────
async function loadUserProfile() {
    try {
        const response = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const profile = await response.json();
            userCcNum = profile.ccNum;

            document.getElementById('user-display-name').innerText = profile.fullName;

            document.getElementById('summary-fullname').innerText = profile.fullName;
            document.getElementById('summary-card').innerText = `CARTE : ${maskCardNumber(profile.ccNum)}`;
            document.getElementById('summary-email').innerText  = profile.email;
            document.getElementById('summary-phone').innerText  = profile.phone;
            document.getElementById('summary-address').innerText = profile.address;

            loadPersonalHistory();
            connectWebsocket();
        } else {
            window.location.href = '/login.html';
        }
    } catch (err) {
        console.error('Error loading user profile', err);
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
loadUserProfile();
