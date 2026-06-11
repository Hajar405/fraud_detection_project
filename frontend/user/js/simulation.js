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
let savedGender = 'M';    // Store gender for payload
let savedDob = '1990-01-01'; // Store date of birth for payload

// ── Map des villes marocaines → coordonnées GPS réelles ─────────────────────
const MOROCCO_COORDS = {
    'casablanca':  { lat: 33.5731, lon: -7.5898,  pop: 3700000, region: 'MA' },
    'rabat':       { lat: 34.0209, lon: -6.8416,  pop: 577000,  region: 'MA' },
    'marrakech':   { lat: 31.6295, lon: -7.9811,  pop: 928000,  region: 'MA' },
    'marrakesh':   { lat: 31.6295, lon: -7.9811,  pop: 928000,  region: 'MA' },
    'fes':         { lat: 34.0333, lon: -5.0000,  pop: 1100000, region: 'MA' },
    'fez':         { lat: 34.0333, lon: -5.0000,  pop: 1100000, region: 'MA' },
    'tanger':      { lat: 35.7595, lon: -5.8340,  pop: 947000,  region: 'MA' },
    'tangier':     { lat: 35.7595, lon: -5.8340,  pop: 947000,  region: 'MA' },
    'agadir':      { lat: 30.4202, lon: -9.5982,  pop: 421000,  region: 'MA' },
    'meknes':      { lat: 33.8935, lon: -5.5473,  pop: 632000,  region: 'MA' },
    'oujda':       { lat: 34.6867, lon: -1.9114,  pop: 494000,  region: 'MA' },
    'kenitra':     { lat: 34.2610, lon: -6.5802,  pop: 431000,  region: 'MA' },
    'tetouan':     { lat: 35.5784, lon: -5.3686,  pop: 380000,  region: 'MA' },
    'sale':        { lat: 34.0531, lon: -6.7985,  pop: 890000,  region: 'MA' },
    'el jadida':   { lat: 33.2316, lon: -8.5007,  pop: 194000,  region: 'MA' },
    'beni mellal': { lat: 32.3372, lon: -6.3498,  pop: 187000,  region: 'MA' },
    'nador':       { lat: 35.1740, lon: -2.9287,  pop: 151000,  region: 'MA' },
    'settat':      { lat: 32.9922, lon: -7.6196,  pop: 142000,  region: 'MA' },
    'khouribga':   { lat: 32.8811, lon: -6.9063,  pop: 196000,  region: 'MA' },
    'laayoune':    { lat: 27.1253, lon: -13.1625, pop: 217000,  region: 'MA' },
    'essaouira':   { lat: 31.5085, lon: -9.7595,  pop: 77000,   region: 'MA' },
    'ouarzazate':  { lat: 30.9335, lon: -6.9370,  pop: 71000,   region: 'MA' },
    'dakhla':      { lat: 23.7141, lon: -15.9356, pop: 106000,  region: 'MA' },
};

// Résoudre les coordonnées GPS depuis le nom de la ville saisie
function resolveCityCoords(cityInput) {
    const key = cityInput.trim().toLowerCase();
    return MOROCCO_COORDS[key] || null;
}

// Fetch user profile for full name and pre-fill
async function loadUserProfile() {
    try {
        const response = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const profile = await response.json();
            savedCardNumber = profile.ccNum || '';
            savedGender = profile.gender || 'M';
            savedDob = profile.dob || '1990-01-01';

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
    const ccNum      = document.getElementById('sim-cardnumber').value;
    const merchant   = document.getElementById('sim-merchant').value;
    const cityInput  = document.getElementById('sim-city').value.trim();
    const stateInput = document.getElementById('sim-state').value.trim();
    const category   = document.getElementById('sim-category').value;
    const amt        = document.getElementById('sim-amount').value;

    const parsedAmt = parseFloat(amt);

    // Résolution des coordonnées depuis la ville saisie
    const cityData = resolveCityCoords(cityInput);
    const userLat  = cityData ? cityData.lat : 33.5731;  // Casablanca par défaut
    const userLon  = cityData ? cityData.lon : -7.5898;
    const cityPop  = cityData ? cityData.pop : 3700000;
    const city     = cityInput || 'Casablanca';
    const state    = stateInput || (cityData ? cityData.region : 'MA');

    // Transaction suspecte : marchand éloigné (~340 km, Tanger depuis Casablanca)
    // Transaction normale  : marchand proche (~5 km)
    const isSuspicious = merchant.toLowerCase().includes('fraud') || parsedAmt > 150.0;
    const merchLat   = isSuspicious ? userLat + 3.0  : userLat + 0.04;
    const merchLong  = isSuspicious ? userLon + 1.8  : userLon - 0.04;

    const payload = {
        cc_num:     ccNum,
        amt:        parsedAmt,
        merchant:   merchant,
        category:   category,
        gender:     savedGender,
        city:       city,
        state:      state,
        city_pop:   cityPop,
        job:        'Professionnel',
        dob:        savedDob,
        lat:        userLat,
        long:       userLon,
        merch_lat:  merchLat,
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

        if (response.status === 503) {
            stateError.classList.remove('hidden');
            document.querySelector('#state-error h3').innerText = 'Service temporairement indisponible';
            document.querySelector('#state-error p').innerText  = data.error || 'Le service d\'analyse est momentanément indisponible. Veuillez réessayer dans quelques instants.';
            mainCard.style.borderColor = 'rgba(255, 180, 171, 0.5)';
            mainCard.style.boxShadow   = '0 0 20px rgba(255, 180, 171, 0.2)';
        } else if (response.ok && data.isFraud === false) {
            stateSuccess.classList.remove('hidden');
            document.querySelector('#state-success p').innerText =
                `Aucune anomalie détectée par l'IA. Score de risque : ${data.riskScore}%`;
            const successScores = document.getElementById('success-scores');
            if (successScores) successScores.innerText = `Certitude : ${data.confidenceScore ?? '--'}%`;
            mainCard.style.borderColor = 'rgba(78, 222, 163, 0.5)';
            mainCard.style.boxShadow   = '0 0 20px rgba(78, 222, 163, 0.2)';
        } else {
            stateError.classList.remove('hidden');
            const reason = data.graphSignals?.graphRiskAdjustment > 0
                ? 'Activité inhabituelle détectée sur ce compte.'
                : 'Cette transaction a été classée comme hautement suspecte.';
            document.querySelector('#state-error p').innerText =
                `${reason} Score de risque : ${data.riskScore || 99}%`;
            const errorScores = document.getElementById('error-scores');
            if (errorScores) errorScores.innerText = `Certitude : ${data.confidenceScore ?? '--'}%`;
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
