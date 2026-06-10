// Security check
const token = localStorage.getItem('jwtToken');
const role = localStorage.getItem('role');
if (!token || role !== 'ADMIN') {
    window.location.href = '/login.html';
}

// Logout action
document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.clear();
    window.location.href = '/login.html';
});

// Populate analyst profile name from username
const currentUsername = localStorage.getItem('username');
if (currentUsername) {
    const profileEl = document.getElementById('profile-username');
    if (profileEl) {
        profileEl.innerText = currentUsername.split('@')[0];
    }
}

// Quick client-side filtering/searching for predictions
const searchInput = document.getElementById('csv-search');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const rows = document.querySelectorAll('#csv-results-rows tr');
        rows.forEach(row => {
            if (row.innerText.includes("Aucune transaction") || row.innerText.includes("Sélectionnez un fichier")) return;
            const text = row.innerText.toLowerCase();
            if (text.includes(term)) {
                row.classList.remove('hidden');
            } else {
                row.classList.add('hidden');
            }
        });
    });
}

const dropZone = document.getElementById('csv-drop-zone');
const fileInput = document.getElementById('csv-file-input');
const selectBtn = document.getElementById('csv-select-btn');

// Click to select file
selectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});

dropZone.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileUpload(e.target.files[0]);
    }
});

// Drag and drop handlers
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-primary', 'bg-primary/10');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-primary', 'bg-primary/10');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-primary', 'bg-primary/10');
    if (e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files[0]);
    }
});

// Execute Batch CSV upload API request
async function handleFileUpload(file) {
    if (!file.name.endsWith('.csv')) {
        alert("Veuillez sélectionner un fichier CSV valide.");
        return;
    }

    // Update UI info panel
    document.getElementById('file-name-label').innerText = file.name;
    document.getElementById('progress-title').innerText = "Analyse en cours...";
    document.getElementById('progress-pct').innerText = "15%";
    document.getElementById('progress-bar').style.width = "15%";
    document.getElementById('status-label').innerText = "Envoi du fichier au serveur...";

    const formData = new FormData();
    formData.append("file", file);

    try {
        // Fake animation progress while backend parses
        let pct = 15;
        const progressInterval = setInterval(() => {
            if (pct < 90) {
                pct += 5;
                document.getElementById('progress-pct').innerText = `${pct}%`;
                document.getElementById('progress-bar').style.width = `${pct}%`;
                document.getElementById('status-label').innerText = "Analyse des transactions en cours...";

            }
        }, 800);

        const response = await fetch('/api/transactions/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        clearInterval(progressInterval);

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            if (response.status === 503) {
                document.getElementById('progress-title').innerText = 'Service indisponible';
                document.getElementById('progress-pct').innerText = 'Erreur';
                document.getElementById('progress-pct').className = 'font-label-md text-label-md text-error';
                document.getElementById('progress-bar').className = 'h-full bg-error w-[100%]';
                document.getElementById('status-label').innerText = errData.error || 'Le service d\'analyse est temporairement indisponible. Veuillez réessayer plus tard.';
            } else {
                throw new Error('Erreur lors du traitement du fichier CSV.');
            }
            return;
        }

        const data = await response.json();

        // Finish progress
        document.getElementById('progress-pct').innerText = "100%";
        document.getElementById('progress-bar').style.width = "100%";
        document.getElementById('progress-title').innerText = "Importation terminée";
        document.getElementById('status-label').innerText = "Archivage terminé, résultats disponibles.";

        // Populate Session summary
        document.getElementById('parsed-count').innerText = data.totalParsed.toLocaleString();
        document.getElementById('fraud-count').innerText = data.fraudCount.toLocaleString();

        // Render Preview Table
        const tbody = document.getElementById('csv-results-rows');
        tbody.innerHTML = '';

        const predictions = data.predictions || [];
        if (predictions.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="px-lg py-8 text-center text-on-surface-variant font-label-md">
                        Aucune transaction valide trouvée dans le fichier CSV.
                    </td>
                </tr>
            `;
            return;
        }

        predictions.forEach(tx => {
            const row = document.createElement('tr');
            row.className = "hover:bg-white/5 transition-colors group";

            const isFraud = tx.isFraud;

            let statusBadge = '';
            if (isFraud) {
                statusBadge = `
                    <span class="bg-error/10 text-error px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 w-fit">
                        <span class="w-1.5 h-1.5 bg-error rounded-full"></span>
                        FRAUDE
                    </span>
                `;
            } else {
                statusBadge = `
                    <span class="bg-secondary/10 text-secondary px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 w-fit">
                        <span class="w-1.5 h-1.5 bg-secondary rounded-full"></span>
                        SÉCURISÉ
                    </span>
                `;
            }

            row.innerHTML = `
                <td class="px-lg py-4 font-label-md text-primary">#TXN-${tx.id.slice(0, 8).toUpperCase()}</td>
                <td class="px-lg py-4 text-on-surface-variant">${tx.transDate}</td>
                <td class="px-lg py-4 text-on-surface">${tx.amt.toFixed(2)} €</td>
                <td class="px-lg py-4">
                    <div class="flex items-center gap-2">
                        <div class="w-12 h-1.5 bg-surface-container rounded-full overflow-hidden">
                            <div class="${isFraud ? 'bg-error' : 'bg-secondary'} h-full" style="width: ${tx.riskScore}%"></div>
                        </div>
                        <span class="${isFraud ? 'text-error' : 'text-secondary'} font-bold">${tx.riskScore.toFixed(0)}%</span>
                    </div>
                </td>
                <td class="px-lg py-4">${statusBadge}</td>
                <td class="px-lg py-4 text-right">
                    <button class="text-primary hover:text-primary-container p-1 rounded transition-colors" title="Voir détails">
                        <span class="material-symbols-outlined">visibility</span>
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });

        // Update display pagination label
        document.getElementById('csv-pagination-label').innerText = `Affichage de 1-${predictions.length} sur ${data.totalParsed} résultats`;

    } catch (err) {
        document.getElementById('progress-title').innerText = "Échec d'importation";
        document.getElementById('progress-pct').innerText = "Erreur";
        document.getElementById('progress-pct').className = "font-label-md text-label-md text-error";
        document.getElementById('progress-bar').className = "h-full bg-error w-[100%]";
        document.getElementById('status-label').innerText = err.message;
    }
}
