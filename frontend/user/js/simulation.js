/**
 * simulation.js
 * Logic for the transaction simulation / analysis page.
 * Handles: auth check, form pre-fill, API call, UI state management.
 */

// ── Security check ────────────────────────────────────────────────────────────
const token = localStorage.getItem('jwtToken');
if (!token) {
    window.location.href = '/login.html';
}

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

let savedCardNumber = ''; // Store ccNum for resetForm

// Fetch user profile for full name and pre-fill
async function loadUserProfile() {
    try {
        const response = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const profile = await response.json();
            savedCardNumber = profile.ccNum || ''; // Save for later

            // Display full name in header
            document.getElementById('user-display-name').innerText = profile.fullName;
            
            // Pre-fill full name in simulation form
            const fullnameInput = document.getElementById('sim-fullname');
            if (fullnameInput) fullnameInput.value = profile.fullName;
            
            const cardnumberInput = document.getElementById('sim-cardnumber');
            if (cardnumberInput && savedCardNumber) cardnumberInput.value = savedCardNumber;

            // Pre-fill other address fields if available
            if (profile.state) document.getElementById('sim-state').value = profile.state;
            if (profile.city) document.getElementById('sim-city').value = profile.city;
            if (profile.address) document.getElementById('sim-street').value = profile.address; // Use address for street
            
            // Optionally pre-fill email or other info if needed
        } else {
            window.location.href = '/login.html';
        }
    } catch (err) {
        console.error('Error loading profile', err);
    }
}

loadUserProfile();



// ── DOM references ────────────────────────────────────────────────────────────
const form           = document.getElementById('transaction-form');
const submitBtn      = document.getElementById('submit-btn');
const btnText        = document.getElementById('btn-text');
const btnIcon        = document.getElementById('btn-icon');
const btnLoader      = document.getElementById('btn-loader');
const resultsOverlay = document.getElementById('results-overlay');
const stateSuccess   = document.getElementById('state-success');
const stateError     = document.getElementById('state-error');
const mainCard       = document.getElementById('main-card');

// ── Form submit ───────────────────────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Loading state
    submitBtn.disabled = true;
    btnText.innerText = 'Analyse en cours...';
    btnIcon.classList.add('hidden');
    btnLoader.classList.remove('hidden');
    submitBtn.classList.add('opacity-80', 'cursor-not-allowed');

    // keep other fields unchanged
    const ccNum = document.getElementById('sim-cardnumber').value;
    const merchant  = document.getElementById('sim-merchant').value;
    const state     = document.getElementById('sim-state').value   || 'FR';
    const city      = document.getElementById('sim-city').value    || 'Paris';
    const street    = document.getElementById('sim-street').value  || 'Champs-Elysees';
    const category  = document.getElementById('sim-category').value;
    const amt       = document.getElementById('sim-amount').value;

    const parsedAmt    = parseFloat(amt);
    const isSuspicious = merchant.toLowerCase().includes('fraud') || parsedAmt > 150.0;
    const merchLat     = isSuspicious ? 40.7128 : 48.8600;
    const merchLong    = isSuspicious ? -74.0060 : 2.3600;

    const payload = {
        cc_num:    ccNum,
        amt:       parsedAmt,
        merchant:  merchant,
        category:  category,
        gender:    'M',
        city:      city,
        state:     state,
        city_pop:  2200000,
        job:       'Professionnel',
        dob:       '1985-05-15',
        lat:       48.8566,
        long:      2.3522,
        merch_lat: merchLat,
        merch_long: merchLong
    };

    try {
        const response = await fetch('/api/transactions/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        submitBtn.classList.add('hidden');
        resultsOverlay.classList.remove('hidden');

        if (response.ok && data.isFraud === false) {
            stateSuccess.classList.remove('hidden');
            document.querySelector('#state-success p').innerText =
                `Aucune anomalie détectée par l'IA. Score de risque : ${data.riskScore}%`;
            mainCard.style.borderColor = 'rgba(78, 222, 163, 0.5)';
            mainCard.style.boxShadow   = '0 0 20px rgba(78, 222, 163, 0.2)';
        } else {
            stateError.classList.remove('hidden');
            const reason = data.graphSignals?.graphRiskAdjustment > 0
                ? 'Activité inhabituelle détectée sur ce compte.'
                : 'Cette transaction a été classée comme hautement suspecte.';
            document.querySelector('#state-error p').innerText =
                `${reason} Score de risque : ${data.riskScore || 99}%`;
            mainCard.style.borderColor = 'rgba(255, 180, 171, 0.5)';
            mainCard.style.boxShadow   = '0 0 20px rgba(255, 180, 171, 0.2)';
        }
    } catch (err) {
        submitBtn.classList.add('hidden');
        resultsOverlay.classList.remove('hidden');
        stateError.classList.remove('hidden');
        document.querySelector('#state-error h3').innerText = 'Erreur de connexion';
        document.querySelector('#state-error p').innerText  = 'Impossible d\'analyser la transaction.';
        mainCard.style.borderColor = 'rgba(255, 180, 171, 0.5)';
        mainCard.style.boxShadow   = '0 0 20px rgba(255, 180, 171, 0.2)';
    }
});

// ── Reset form to initial state ───────────────────────────────────────────────
function resetForm() {
    resultsOverlay.classList.add('hidden');
    stateSuccess.classList.add('hidden');
    stateError.classList.add('hidden');

    submitBtn.classList.remove('hidden');
    submitBtn.disabled = false;
    btnText.innerText = 'Analyser & Transférer';
    btnIcon.classList.remove('hidden');
    btnLoader.classList.add('hidden');
    submitBtn.classList.remove('opacity-80', 'cursor-not-allowed');

    mainCard.style.borderColor = 'rgba(173, 198, 255, 0.1)';
    mainCard.style.boxShadow   = 'none';

    form.reset();
    if (savedCardNumber) {
        document.getElementById('sim-cardnumber').value = savedCardNumber;
    }
}
