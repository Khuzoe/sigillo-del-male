(function () {
    const DATA_URL = '../assets/data/bestiary.json';
    const DB_NAME = 'cripta-bestiary-editor';
    const DB_VERSION = 1;
    const DB_STORE = 'file-handles';
    const BESTIARY_HANDLE_KEY = 'bestiary-json';
    const FILTER_STORAGE_KEY = 'cripta-bestiary-editor-filters';
    const BESTIARY_IMAGE_PREFIX = 'img/creatures/bestiary/';
    const RANK_OPTIONS = [
        ['', 'Normale'],
        ['mini_boss', 'Maggiore'],
        ['unique_monster', 'Unica'],
        ['special', 'Speciale']
    ];
    const TYPE_OPTIONS = [
        '',
        'Aberrazione',
        'Bestia',
        'Celestiale',
        'Costrutto',
        'Drago',
        'Elementale',
        'Folletto',
        'Genio',
        'Gigante',
        'Immondo',
        'Melma',
        'Mostruosità',
        'Non morto',
        'Pianta',
        'Umanoide'
    ];
    const DAMAGE_TYPE_OPTIONS = [
        ['Acido', 'fa-flask-vial'],
        ['Contundente', 'fa-hammer'],
        ['Freddo', 'fa-snowflake'],
        ['Fuoco', 'fa-fire-flame-curved'],
        ['Forza', 'fa-burst'],
        ['Fulmine', 'fa-bolt'],
        ['Necrotico', 'fa-skull'],
        ['Perforante', 'fa-crosshairs'],
        ['Psichico', 'fa-brain'],
        ['Radiante', 'fa-sun'],
        ['Tagliente', 'fa-scissors'],
        ['Tuono', 'fa-volume-high'],
        ['Veleno', 'fa-skull-crossbones']
    ];

    const state = {
        creatures: [],
        selectedIndex: 0,
        query: '',
        category: 'all',
        rank: 'all',
        showHidden: true,
        fileHandle: null,
        imageAdjustIndex: -1,
        adjustDrag: null
    };

    const els = {};

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        bindElements();
        renderDefensePickers();
        restoreFilters();
        bindEvents();

        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            state.creatures = await response.json();
            if (!Array.isArray(state.creatures)) throw new Error('Formato bestiary.json non valido.');
            state.selectedIndex = state.creatures.length ? 0 : -1;
            renderAll();
            const restoredHandle = await restoreLinkedJsonFile();
            setStatus(restoredHandle
                ? `${state.creatures.length} creature caricate. File collegato: ${restoredHandle.name}.`
                : `${state.creatures.length} creature caricate.`);
        } catch (error) {
            console.error('Errore caricamento bestiario:', error);
            setStatus('Impossibile caricare assets/data/bestiary.json.');
        }
    }

    function bindElements() {
        [
            'editor-status',
            'add-creature-btn',
            'duplicate-creature-btn',
            'delete-creature-btn',
            'search-input',
            'category-filter',
            'rank-filter',
            'show-hidden-toggle',
            'bestiary-table-body',
            'detail-form',
            'preview-image',
            'preview-name',
            'preview-meta',
            'json-output',
            'connect-json-btn',
            'save-json-btn',
            'copy-json-btn',
            'download-json-btn',
            'image-adjust-modal',
            'image-adjust-frame',
            'image-adjust-preview',
            'adjust-x',
            'adjust-y',
            'adjust-size'
        ].forEach((id) => {
            els[toCamel(id)] = document.getElementById(id);
        });
    }

    function bindEvents() {
        els.searchInput?.addEventListener('input', (event) => {
            state.query = event.target.value.trim();
            persistFilters();
            renderTable();
        });

        els.categoryFilter?.addEventListener('change', (event) => {
            state.category = event.target.value;
            persistFilters();
            renderTable();
        });

        els.rankFilter?.addEventListener('change', (event) => {
            state.rank = event.target.value;
            persistFilters();
            renderTable();
        });

        els.showHiddenToggle?.addEventListener('change', (event) => {
            state.showHidden = event.target.checked;
            persistFilters();
            renderTable();
        });

        els.addCreatureBtn?.addEventListener('click', () => {
            const creature = createEmptyCreature();
            state.creatures.push(creature);
            state.selectedIndex = state.creatures.length - 1;
            renderAll();
            setStatus('Nuova creatura aggiunta.');
        });

        els.duplicateCreatureBtn?.addEventListener('click', () => {
            const selected = getSelectedCreature();
            if (!selected) return;
            const copy = structuredCloneSafe(selected);
            copy.name = `${copy.name || 'Creatura'} Copia`;
            state.creatures.splice(state.selectedIndex + 1, 0, copy);
            state.selectedIndex += 1;
            renderAll();
            setStatus('Creatura duplicata.');
        });

        els.deleteCreatureBtn?.addEventListener('click', () => {
            const selected = getSelectedCreature();
            if (!selected) return;
            const confirmed = window.confirm(`Eliminare "${selected.name || 'Creatura senza nome'}"?`);
            if (!confirmed) return;
            state.creatures.splice(state.selectedIndex, 1);
            state.selectedIndex = Math.min(state.selectedIndex, state.creatures.length - 1);
            renderAll();
            setStatus('Creatura eliminata.');
        });

        els.bestiaryTableBody?.addEventListener('input', handleTableInput);
        els.bestiaryTableBody?.addEventListener('change', handleTableInput);
        els.bestiaryTableBody?.addEventListener('change', handleFilePick);
        els.bestiaryTableBody?.addEventListener('click', handleTableClick);
        els.bestiaryTableBody?.addEventListener('click', handleFilePickClick);
        els.detailForm?.addEventListener('input', handleDetailInput);
        els.detailForm?.addEventListener('change', handleDetailInput);
        els.imageAdjustModal?.addEventListener('input', handleAdjustInput);
        els.imageAdjustModal?.addEventListener('change', handleAdjustInput);
        els.imageAdjustModal?.addEventListener('click', handleAdjustClick);
        els.imageAdjustFrame?.addEventListener('pointerdown', handleAdjustPointerDown);
        els.imageAdjustFrame?.addEventListener('pointermove', handleAdjustPointerMove);
        els.imageAdjustFrame?.addEventListener('pointerup', handleAdjustPointerUp);
        els.imageAdjustFrame?.addEventListener('pointercancel', handleAdjustPointerUp);
        els.imageAdjustFrame?.addEventListener('wheel', handleAdjustWheel, { passive: false });

        els.connectJsonBtn?.addEventListener('click', connectJsonFile);
        els.saveJsonBtn?.addEventListener('click', saveJsonToFile);

        els.copyJsonBtn?.addEventListener('click', async () => {
            updateOutput();
            try {
                await navigator.clipboard.writeText(els.jsonOutput.value);
                setStatus('JSON copiato negli appunti.');
            } catch (_) {
                els.jsonOutput.select();
                document.execCommand('copy');
                setStatus('JSON selezionato e copiato.');
            }
        });

        els.downloadJsonBtn?.addEventListener('click', () => {
            updateOutput();
            const blob = new Blob([els.jsonOutput.value], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'bestiary.json';
            link.click();
            URL.revokeObjectURL(url);
            setStatus('Export JSON scaricato.');
        });
    }

    function restoreFilters() {
        try {
            const saved = JSON.parse(window.localStorage.getItem(FILTER_STORAGE_KEY) || '{}');
            if (typeof saved.query === 'string') state.query = saved.query;
            if (typeof saved.category === 'string') state.category = saved.category;
            if (typeof saved.rank === 'string') state.rank = saved.rank;
            if (typeof saved.showHidden === 'boolean') state.showHidden = saved.showHidden;
        } catch (_) {
            // Ignore invalid filter cache.
        }
    }

    function persistFilters() {
        try {
            window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
                query: state.query,
                category: state.category,
                rank: state.rank,
                showHidden: state.showHidden
            }));
        } catch (_) {
            // Ignore storage errors.
        }
    }

    async function connectJsonFile() {
        if (typeof window.showOpenFilePicker !== 'function') {
            setStatus('Collegamento diretto non supportato da questo browser. Usa Scarica JSON.', 'error');
            return;
        }

        try {
            const [handle] = await window.showOpenFilePicker({
                multiple: false,
                types: [
                    {
                        description: 'JSON',
                        accept: { 'application/json': ['.json'] }
                    }
                ]
            });
            state.fileHandle = handle;
            await saveStoredFileHandle(handle);
            setStatus(`File collegato: ${handle.name}. Ora Salva JSON sovrascrive questo file.`);
        } catch (error) {
            if (error?.name === 'AbortError') {
                setStatus('Collegamento annullato.');
                return;
            }
            console.error('Errore collegamento JSON:', error);
            setStatus('Impossibile collegare il file JSON.', 'error');
        }
    }

    async function saveJsonToFile() {
        updateOutput({ commitActive: event.type === 'change' });

        if (state.fileHandle) {
            try {
                const permission = await verifyFilePermission(state.fileHandle, true);
                if (!permission) {
                    setStatus('Permesso di scrittura non concesso. Ricollega il file JSON.', 'error');
                    return;
                }
                const writable = await state.fileHandle.createWritable();
                await writable.write(els.jsonOutput.value);
                await writable.close();
                setStatus(`File aggiornato: ${state.fileHandle.name}`);
                return;
            } catch (error) {
                console.error('Errore salvataggio JSON collegato:', error);
                setStatus('Impossibile salvare sul file collegato. Prova a collegarlo di nuovo.', 'error');
                return;
            }
        }

        if (typeof window.showSaveFilePicker !== 'function') {
            setStatus('Salvataggio diretto non supportato da questo browser. Usa Scarica JSON.', 'error');
            return;
        }

        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: 'bestiary.json',
                types: [
                    {
                        description: 'JSON',
                        accept: { 'application/json': ['.json'] }
                    }
                ]
            });
            state.fileHandle = handle;
            await saveStoredFileHandle(handle);
            const writable = await handle.createWritable();
            await writable.write(els.jsonOutput.value);
            await writable.close();
            setStatus(`File salvato: ${handle.name}`);
        } catch (error) {
            if (error?.name === 'AbortError') {
                setStatus('Salvataggio annullato.');
                return;
            }
            console.error('Errore salvataggio JSON:', error);
            setStatus('Impossibile salvare direttamente il JSON.', 'error');
        }
    }

    async function restoreLinkedJsonFile() {
        if (!supportsPersistentFileHandles()) return null;

        try {
            const handle = await getStoredFileHandle();
            if (!handle) return null;

            state.fileHandle = handle;
            const hasPermission = await verifyFilePermission(handle, false);
            if (!hasPermission) {
                setStatus(`File ricordato: ${handle.name}. Salva JSON richiedera il permesso.`);
            }
            return handle;
        } catch (error) {
            console.warn('Impossibile ripristinare il file JSON collegato:', error);
            return null;
        }
    }

    function supportsPersistentFileHandles() {
        return typeof window.indexedDB !== 'undefined' && typeof FileSystemFileHandle !== 'undefined';
    }

    async function verifyFilePermission(handle, requestWrite) {
        if (!handle || typeof handle.queryPermission !== 'function') return false;
        const options = { mode: 'readwrite' };
        const current = await handle.queryPermission(options);
        if (current === 'granted') return true;
        if (!requestWrite || typeof handle.requestPermission !== 'function') return false;
        return await handle.requestPermission(options) === 'granted';
    }

    async function getStoredFileHandle() {
        const db = await openFileHandleDb();
        return new Promise((resolve, reject) => {
            const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(BESTIARY_HANDLE_KEY);
            request.onsuccess = () => resolve(request.result?.handle || null);
            request.onerror = () => reject(request.error);
        });
    }

    async function saveStoredFileHandle(handle) {
        if (!supportsPersistentFileHandles()) return;
        const db = await openFileHandleDb();
        return new Promise((resolve, reject) => {
            const request = db
                .transaction(DB_STORE, 'readwrite')
                .objectStore(DB_STORE)
                .put({ id: BESTIARY_HANDLE_KEY, handle });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    function openFileHandleDb() {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(DB_STORE)) {
                    db.createObjectStore(DB_STORE, { keyPath: 'id' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function renderAll() {
        renderFilters();
        renderTable();
        renderDetails();
        updateOutput();
    }

    function renderFilters() {
        if (els.searchInput) els.searchInput.value = state.query;
        const categories = [...new Set(state.creatures.map((creature) => creature.category || '').filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
        els.categoryFilter.innerHTML = [
            '<option value="all">Tutte le categorie</option>',
            '<option value="">Senza categoria</option>',
            ...categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
        ].join('');
        if (state.category !== 'all' && !categories.includes(state.category) && state.category !== '') {
            state.category = 'all';
        }
        els.categoryFilter.value = state.category;

        els.rankFilter.innerHTML = [
            '<option value="all">Tutti i rank</option>',
            '<option value="">Normale</option>',
            ...RANK_OPTIONS.filter(([value]) => value).map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
        ].join('');
        if (state.rank !== 'all' && !RANK_OPTIONS.some(([value]) => value === state.rank)) {
            state.rank = 'all';
        }
        els.rankFilter.value = state.rank;
        els.showHiddenToggle.checked = state.showHidden;
    }

    function renderTable() {
        const items = getFilteredCreatures();
        if (!items.length) {
            els.bestiaryTableBody.innerHTML = '<tr><td colspan="11">Nessuna creatura corrisponde ai filtri.</td></tr>';
            return;
        }

        els.bestiaryTableBody.innerHTML = items.map(({ creature, index }) => `
            <tr data-index="${index}" class="${index === state.selectedIndex ? 'is-selected' : ''}">
                <td><input class="bestiary-editor-input" data-field="name" value="${escapeHtml(creature.name || '')}"></td>
                <td>
                    <div class="bestiary-editor-path-cell">
                        <input class="bestiary-editor-input" data-field="image" value="${escapeHtml(formatImagePathForEditor(creature.image))}">
                        <button class="bestiary-editor-btn bestiary-editor-file-pick" type="button" data-action="pick-image" title="Scegli immagine">
                            <i class="fas fa-folder-open" aria-hidden="true"></i>
                            <input class="bestiary-editor-hidden" type="file" accept="image/*" data-file-field="image">
                        </button>
                    </div>
                </td>
                <td><input class="bestiary-editor-input" data-field="category" value="${escapeHtml(creature.category || '')}"></td>
                <td>${renderSelect('rank', RANK_OPTIONS, creature.rank || '')}</td>
                <td>${renderSelect('details.dndType', TYPE_OPTIONS.map((type) => [type, type || 'Tipo vuoto']), creature.details?.dndType || '')}</td>
                <td><input class="bestiary-editor-input" data-field="details.size" value="${escapeHtml(creature.details?.size || '')}"></td>
                <td><input class="bestiary-editor-input" data-field="details.height" value="${escapeHtml(formatMetricForEditor(creature.details?.height, 'details.height'))}"></td>
                <td><input class="bestiary-editor-input" data-field="details.weight" value="${escapeHtml(formatMetricForEditor(creature.details?.weight, 'details.weight'))}"></td>
                <td><input type="checkbox" data-field="hidden" ${creature.hidden === true ? 'checked' : ''}></td>
                <td><input type="checkbox" data-field="discovered" ${creature.discovered !== false ? 'checked' : ''}></td>
                <td>
                    <div class="bestiary-editor-row-actions">
                        <button class="bestiary-editor-btn" type="button" data-action="select">Dettagli</button>
                        <button class="bestiary-editor-btn" type="button" data-action="adjust-image">Regola</button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    function renderSelect(field, options, selectedValue) {
        return `
            <select class="bestiary-editor-select" data-field="${escapeHtml(field)}">
                ${options.map(([value, label]) => `
                    <option value="${escapeHtml(value)}" ${value === selectedValue ? 'selected' : ''}>${escapeHtml(label || 'Normale')}</option>
                `).join('')}
            </select>
        `;
    }

    function renderDefensePickers() {
        els.detailForm?.querySelectorAll('[data-defense-field]').forEach((group) => {
            group.innerHTML = DAMAGE_TYPE_OPTIONS.map(([value, icon]) => `
                <label class="bestiary-defense-option">
                    <input type="checkbox" data-defense-option value="${escapeHtml(value)}">
                    <span><i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>${escapeHtml(value)}</span>
                </label>
            `).join('');
        });
    }

    function renderDetails() {
        const creature = getSelectedCreature();
        const fields = els.detailForm.querySelectorAll('[data-detail-field], [data-creature-field], [data-list-field], [data-complex-field], [data-defense-option]');
        fields.forEach((field) => {
            field.disabled = !creature;
        });

        if (!creature) {
            els.previewImage.removeAttribute('src');
            els.previewName.textContent = 'Nessuna creatura';
            els.previewMeta.textContent = 'Aggiungi o seleziona una creatura.';
            fields.forEach((field) => {
                if (field.type !== 'checkbox') field.value = '';
            });
            els.detailForm.querySelectorAll('[data-defense-option]').forEach((field) => { field.checked = false; });
            return;
        }

        els.previewImage.src = `../assets/${creature.image || ''}`;
        els.previewImage.alt = creature.name || '';
        els.previewImage.style.setProperty('--preview-x', `${normalizeNumber(creature.imageAdjust?.x, 50)}%`);
        els.previewImage.style.setProperty('--preview-y', `${normalizeNumber(creature.imageAdjust?.y, 50)}%`);
        els.previewImage.style.setProperty('--preview-size', normalizeNumber(creature.imageAdjust?.size, 1));
        els.previewName.textContent = creature.name || 'Creatura senza nome';
        els.previewMeta.textContent = [creature.category || 'Senza categoria', creature.details?.dndType || 'Tipo ignoto'].join(' | ');

        els.detailForm.querySelector('[data-detail-field="description"]').value = creature.details?.description || '';
        els.detailForm.querySelector('[data-creature-field="sourceCharacterId"]').value = creature.sourceCharacterId || '';
        els.detailForm.querySelector('[data-creature-field="mysteryName"]').value = creature.mysteryName || '';
        els.detailForm.querySelector('[data-creature-field="mysteryDescription"]').value = creature.mysteryDescription || '';
        syncDefensePicker('resistances', creature.details?.resistances);
        syncDefensePicker('immunities', creature.details?.immunities);
        syncDefensePicker('vulnerabilities', creature.details?.vulnerabilities);
        els.detailForm.querySelector('[data-complex-field="traits"]').value = traitsToText(creature.details?.traits);
        els.detailForm.querySelector('[data-complex-field="drops"]').value = dropsToText(creature.details?.drops);
    }

    function syncDefensePicker(fieldName, values) {
        const selected = new Set(Array.isArray(values) ? values : []);
        const group = els.detailForm.querySelector(`[data-defense-field="${fieldName}"]`);
        group?.querySelectorAll('[data-defense-option]').forEach((input) => {
            input.checked = selected.has(input.value);
        });
    }

    function updatePreview() {
        const creature = getSelectedCreature();
        if (!creature) return;
        els.previewName.textContent = creature.name || 'Creatura senza nome';
        els.previewMeta.textContent = [creature.category || 'Senza categoria', creature.details?.dndType || 'Tipo ignoto'].join(' | ');
    }

    function updatePreviewImage() {
        const creature = getSelectedCreature();
        if (!creature) return;
        els.previewImage.src = `../assets/${creature.image || ''}`;
        els.previewImage.alt = creature.name || '';
        els.previewImage.style.setProperty('--preview-x', `${normalizeNumber(creature.imageAdjust?.x, 50)}%`);
        els.previewImage.style.setProperty('--preview-y', `${normalizeNumber(creature.imageAdjust?.y, 50)}%`);
        els.previewImage.style.setProperty('--preview-size', normalizeNumber(creature.imageAdjust?.size, 1));
        updatePreview();
    }

    function openImageAdjustModal(index) {
        const creature = state.creatures[index];
        if (!creature || !els.imageAdjustModal || !els.imageAdjustPreview) return;

        state.imageAdjustIndex = index;
        ensureImageAdjust(creature);
        creature.imageAdjust.x = normalizeNumber(creature.imageAdjust.x, 50);
        creature.imageAdjust.y = normalizeNumber(creature.imageAdjust.y, 50);
        creature.imageAdjust.size = normalizeNumber(creature.imageAdjust.size, 1);

        els.imageAdjustPreview.src = `../assets/${creature.image || ''}`;
        els.imageAdjustPreview.alt = creature.name || '';
        els.imageAdjustModal.hidden = false;
        syncAdjustControls(creature);
    }

    function syncAdjustControls(creature) {
        const values = {
            x: normalizeNumber(creature.imageAdjust?.x, 50),
            y: normalizeNumber(creature.imageAdjust?.y, 50),
            size: normalizeNumber(creature.imageAdjust?.size, 1)
        };
        ['x', 'y', 'size'].forEach((key) => {
            const range = els.imageAdjustModal?.querySelector(`[data-adjust-field="${key}"]`);
            const number = els.imageAdjustModal?.querySelector(`[data-adjust-number="${key}"]`);
            if (range) range.value = values[key];
            if (number) number.value = values[key];
        });
        updateAdjustPreview(values);
    }

    function updateAdjustPreview(values) {
        if (!els.imageAdjustPreview) return;
        els.imageAdjustPreview.style.setProperty('--adjust-x', `${values.x}%`);
        els.imageAdjustPreview.style.setProperty('--adjust-y', `${values.y}%`);
        els.imageAdjustPreview.style.setProperty('--adjust-size', values.size);
    }

    function handleTableClick(event) {
        const adjustButton = event.target.closest('[data-action="adjust-image"]');
        if (adjustButton) {
            const row = adjustButton.closest('tr[data-index]');
            if (!row) return;
            commitTableRow(row);
            state.selectedIndex = Number(row.dataset.index);
            openImageAdjustModal(state.selectedIndex);
            return;
        }

        if (event.target.closest('input, select, textarea, [data-action="pick-image"]')) return;
        const row = event.target.closest('tr[data-index]');
        if (!row) return;
        commitActiveTableField();
        state.selectedIndex = Number(row.dataset.index);
        renderTable();
        renderDetails();
        updateOutput({ commitActive: false });
    }

    async function handleFilePickClick(event) {
        const button = event.target.closest('[data-action="pick-image"]');
        if (!button) return;

        const row = button.closest('tr[data-index]');
        const index = Number(row?.dataset.index);
        const creature = state.creatures[index];
        if (!row || !creature) return;

        commitTableRow(row);
        state.selectedIndex = index;

        if (typeof window.showOpenFilePicker === 'function') {
            try {
                const [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [
                        {
                            description: 'Immagini',
                            accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'] }
                        }
                    ]
                });
                applyPickedImagePath(row, index, normalizeAssetPath({ name: handle.name }));
                return;
            } catch (error) {
                if (error?.name !== 'AbortError') {
                    console.warn('Picker immagini non disponibile, uso input file.', error);
                } else {
                    return;
                }
            }
        }

        const input = button.querySelector('[data-file-field="image"]');
        if (input) input.click();
    }

    function handleTableInput(event) {
        const target = event.target;
        if (target.dataset.fileField) return;
        const row = target.closest('tr[data-index]');
        const field = target.dataset.field;
        if (!row || !field) return;

        const index = Number(row.dataset.index);
        const creature = state.creatures[index];
        if (!creature) return;

        state.selectedIndex = index;
        if (event.type === 'input') {
            setStatus('Modifiche in corso. Lascia il campo o salva per aggiornare il JSON.');
            return;
        }

        const value = target.type === 'checkbox' ? target.checked : target.value;
        writeCreatureField(creature, field, value, { normalizeMetric: true });
        if (isMetricField(field)) {
            target.value = formatMetricForEditor(readCreatureField(creature, field), field);
        } else if (field === 'image') {
            target.value = formatImagePathForEditor(creature.image);
        }
        pruneCreature(creature);
        renderDetails();
        updateOutput();
        setStatus('Modifiche non salvate esportate nel JSON.');
    }

    function handleFilePick(event) {
        const target = event.target;
        const fileField = target.dataset.fileField;
        if (!fileField || !target.files?.length) return;

        const row = target.closest('tr[data-index]');
        const index = Number(row?.dataset.index);
        const creature = state.creatures[index];
        if (!row || !creature) return;

        applyPickedImagePath(row, index, normalizeAssetPath(target.files[0]));
    }

    function applyPickedImagePath(row, index, path) {
        const creature = state.creatures[index];
        if (!row || !creature || !path) return;

        writeCreatureField(creature, 'image', path);
        state.selectedIndex = index;
        pruneCreature(creature);
        const pathInput = row.querySelector('[data-field="image"]');
        if (pathInput) {
            pathInput.value = formatImagePathForEditor(path);
        }
        updatePreviewImage();
        updateOutput({ commitActive: false });
        setStatus(`Path immagine aggiornato: ${path}`);
    }

    function handleDetailInput(event) {
        const creature = getSelectedCreature();
        if (!creature) return;
        ensureDetails(creature);

        const target = event.target;
        const detailField = target.dataset.detailField;
        const creatureField = target.dataset.creatureField;
        const listField = target.dataset.listField;
        const complexField = target.dataset.complexField;
        const defenseField = target.closest('[data-defense-field]')?.dataset.defenseField;

        if (detailField) {
            writeCreatureField(creature, `details.${detailField}`, target.value);
        } else if (creatureField) {
            writeCreatureField(creature, creatureField, target.value);
        } else if (listField) {
            creature.details[listField] = textToList(target.value);
        } else if (defenseField && target.dataset.defenseOption !== undefined) {
            creature.details[defenseField] = getSelectedDefenseValues(defenseField);
        } else if (complexField === 'traits') {
            creature.details.traits = textToTraits(target.value);
        } else if (complexField === 'drops') {
            creature.details.drops = textToDrops(target.value);
        }

        pruneCreature(creature);
        updatePreview();
        updateOutput();
        setStatus('Modifiche non salvate esportate nel JSON.');
    }

    function getSelectedDefenseValues(fieldName) {
        const group = els.detailForm.querySelector(`[data-defense-field="${fieldName}"]`);
        if (!group) return [];
        return [...group.querySelectorAll('[data-defense-option]:checked')].map((input) => input.value);
    }

    function handleAdjustInput(event) {
        const key = event.target.dataset.adjustField || event.target.dataset.adjustNumber;
        if (!key) return;

        const creature = state.creatures[state.imageAdjustIndex];
        if (!creature) return;

        const value = normalizeAdjustValue(key, event.target.value);
        applyAdjustValue(creature, key, value);
    }

    function handleAdjustClick(event) {
        const action = event.target.closest('[data-adjust-action]')?.dataset.adjustAction;
        if (!action) return;

        if (action === 'close') {
            state.imageAdjustIndex = -1;
            state.adjustDrag = null;
            els.imageAdjustFrame?.classList.remove('is-dragging');
            if (els.imageAdjustModal) els.imageAdjustModal.hidden = true;
            return;
        }

        if (action === 'reset') {
            const creature = state.creatures[state.imageAdjustIndex];
            if (!creature) return;
            creature.imageAdjust = { x: 50, y: 50 };
            syncAdjustToRow(state.imageAdjustIndex, 'x', 50);
            syncAdjustToRow(state.imageAdjustIndex, 'y', 50);
            syncAdjustToRow(state.imageAdjustIndex, 'size', '');
            syncAdjustControls({ imageAdjust: { x: 50, y: 50, size: 1 } });
            updatePreviewImage();
            updateOutput({ commitActive: false });
            setStatus('Regolazione immagine ripristinata.');
        }
    }

    function normalizeAdjustValue(key, value) {
        const number = Number(value);
        const fallback = key === 'size' ? 1 : 50;
        if (!Number.isFinite(number)) return fallback;
        if (key === 'size') return Math.max(0.75, Math.min(2.5, Math.round(number * 100) / 100));
        return Math.max(0, Math.min(100, Math.round(number)));
    }

    function applyAdjustValue(creature, key, value, options = {}) {
        ensureImageAdjust(creature);
        creature.imageAdjust[key] = value;

        syncAdjustToRow(state.imageAdjustIndex, key, value);
        syncAdjustControls(creature);
        updatePreviewImage();
        updateOutput({ commitActive: false });
        if (options.status !== false) setStatus('Regolazione immagine aggiornata.');
    }

    function handleAdjustPointerDown(event) {
        if (event.button !== 0 || state.imageAdjustIndex < 0) return;
        const creature = state.creatures[state.imageAdjustIndex];
        if (!creature) return;

        ensureImageAdjust(creature);
        const rect = els.imageAdjustFrame.getBoundingClientRect();
        state.adjustDrag = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startX: normalizeAdjustValue('x', creature.imageAdjust.x),
            startY: normalizeAdjustValue('y', creature.imageAdjust.y),
            width: rect.width || 1,
            height: rect.height || 1
        };
        els.imageAdjustFrame.classList.add('is-dragging');
        els.imageAdjustFrame.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    }

    function handleAdjustPointerMove(event) {
        const drag = state.adjustDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const creature = state.creatures[state.imageAdjustIndex];
        if (!creature) return;

        const deltaX = event.clientX - drag.startClientX;
        const deltaY = event.clientY - drag.startClientY;
        const nextX = normalizeAdjustValue('x', drag.startX - (deltaX / drag.width) * 100);
        const nextY = normalizeAdjustValue('y', drag.startY - (deltaY / drag.height) * 100);

        ensureImageAdjust(creature);
        creature.imageAdjust.x = nextX;
        creature.imageAdjust.y = nextY;
        syncAdjustToRow(state.imageAdjustIndex, 'x', nextX);
        syncAdjustToRow(state.imageAdjustIndex, 'y', nextY);
        syncAdjustControls(creature);
        updatePreviewImage();
        updateOutput({ commitActive: false });
        event.preventDefault();
    }

    function handleAdjustPointerUp(event) {
        const drag = state.adjustDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        state.adjustDrag = null;
        els.imageAdjustFrame?.classList.remove('is-dragging');
        els.imageAdjustFrame?.releasePointerCapture?.(event.pointerId);
        setStatus('Regolazione immagine aggiornata.');
    }

    function handleAdjustWheel(event) {
        if (state.imageAdjustIndex < 0) return;
        const creature = state.creatures[state.imageAdjustIndex];
        if (!creature) return;

        const currentSize = normalizeAdjustValue('size', creature.imageAdjust?.size ?? 1);
        const direction = event.deltaY < 0 ? 1 : -1;
        const step = event.shiftKey ? 0.01 : 0.05;
        const nextSize = normalizeAdjustValue('size', currentSize + direction * step);
        applyAdjustValue(creature, 'size', nextSize);
        event.preventDefault();
    }

    function syncAdjustToRow(index, key, value) {
        const row = els.bestiaryTableBody?.querySelector(`tr[data-index="${index}"]`);
        const field = row?.querySelector(`[data-field="imageAdjust.${key}"]`);
        if (field) field.value = value;
    }

    function getFilteredCreatures() {
        const query = normalizeSearch(state.query);
        return state.creatures
            .map((creature, index) => ({ creature, index }))
            .filter(({ creature }) => {
                if (!state.showHidden && creature.hidden === true) return false;
                if (state.category !== 'all' && (creature.category || '') !== state.category) return false;
                if (state.rank !== 'all' && (creature.rank || '') !== state.rank) return false;
                if (!query) return true;
                return normalizeSearch([
                    creature.name,
                    creature.category,
                    creature.rank,
                    creature.details?.dndType,
                    creature.details?.description
                ].filter(Boolean).join(' ')).includes(query);
            });
    }

    function getSelectedCreature() {
        return state.creatures[state.selectedIndex] || null;
    }

    function createEmptyCreature() {
        return {
            name: 'Nuova Creatura',
            image: 'img/creatures/bestiary/nuova_creatura.webp',
            imageAdjust: { x: 50, y: 50 },
            details: {
                description: '',
                dndType: '',
                size: '',
                height: '',
                weight: '',
                traits: [],
                drops: []
            }
        };
    }

    function writeCreatureField(creature, path, value, options = {}) {
        if (path.startsWith('details.')) ensureDetails(creature);
        if (path.startsWith('imageAdjust.')) ensureImageAdjust(creature);

        if (path === 'hidden') {
            creature.hidden = value === true ? true : undefined;
            return;
        }
        if (path === 'discovered') {
            creature.discovered = value === false ? false : undefined;
            return;
        }
        if (path === 'image') {
            creature.image = normalizeImagePathForData(value) || undefined;
            return;
        }

        const parts = path.split('.');
        let target = creature;
        parts.slice(0, -1).forEach((part) => {
            if (!target[part] || typeof target[part] !== 'object') target[part] = {};
            target = target[part];
        });

        const key = parts[parts.length - 1];
        const numericFields = new Set(['imageAdjust.x', 'imageAdjust.y', 'imageAdjust.size']);
        if (numericFields.has(path)) {
            const number = Number(value);
            target[key] = Number.isFinite(number) && value !== '' ? number : undefined;
        } else if (options.normalizeMetric && isMetricField(path)) {
            target[key] = normalizeMetricFieldValue(path, value) || undefined;
        } else {
            target[key] = String(value || '').trim() || undefined;
        }
    }

    function readCreatureField(creature, path) {
        return path.split('.').reduce((value, key) => value?.[key], creature);
    }

    function isMetricField(path) {
        return path === 'details.height' || path === 'details.weight';
    }

    function normalizeMetricFieldValue(path, value) {
        const unit = path === 'details.height' ? 'm' : 'kg';
        const raw = String(value || '').trim();
        if (!raw) return '';

        const match = raw.match(/^(\d+(?:[,.]\d+)?)(?:\s*(?:m|kg))?\b(.*)$/i);
        if (!match) return raw;

        const number = Number(match[1].replace(',', '.'));
        if (!Number.isFinite(number)) return raw;

        const note = String(match[2] || '').trim().replace(/^\((.*)\)$/, '$1').trim();
        return `${number.toFixed(2)} ${unit}${note ? ` ${note}` : ''}`;
    }

    function ensureDetails(creature) {
        if (!creature.details || typeof creature.details !== 'object') creature.details = {};
    }

    function ensureImageAdjust(creature) {
        if (!creature.imageAdjust || typeof creature.imageAdjust !== 'object') creature.imageAdjust = {};
    }

    function pruneCreature(creature) {
        ensureDetails(creature);
        ensureImageAdjust(creature);

        ['category', 'rank', 'sourceCharacterId', 'mysteryName', 'mysteryDescription'].forEach((key) => {
            if (creature[key] === undefined || creature[key] === '') delete creature[key];
        });
        if (creature.hidden !== true) delete creature.hidden;
        if (creature.discovered !== false) delete creature.discovered;

        Object.keys(creature.details).forEach((key) => {
            const value = creature.details[key];
            if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0 && key !== 'traits' && key !== 'drops')) {
                delete creature.details[key];
            }
        });

        if (!Array.isArray(creature.details.traits)) creature.details.traits = [];
        if (!Array.isArray(creature.details.drops)) creature.details.drops = [];

        Object.keys(creature.imageAdjust).forEach((key) => {
            if (creature.imageAdjust[key] === undefined || creature.imageAdjust[key] === '') {
                delete creature.imageAdjust[key];
            }
        });
        if (Object.keys(creature.imageAdjust).length === 0) delete creature.imageAdjust;
    }

    function updateOutput({ commitActive = true } = {}) {
        if (commitActive) commitActiveTableField();
        const cleanCreatures = state.creatures.map((creature) => {
            const copy = structuredCloneSafe(creature);
            pruneCreature(copy);
            return copy;
        });
        els.jsonOutput.value = `${JSON.stringify(cleanCreatures, null, 2)}\n`;
    }

    function commitActiveTableField() {
        const field = document.activeElement;
        if (!field?.dataset?.field || field.dataset.fileField) return;

        const row = field.closest('tr[data-index]');
        const index = Number(row?.dataset.index);
        const creature = state.creatures[index];
        if (!row || !creature) return;

        const value = field.type === 'checkbox' ? field.checked : field.value;
        writeCreatureField(creature, field.dataset.field, value, { normalizeMetric: true });
        if (isMetricField(field.dataset.field)) {
            field.value = formatMetricForEditor(readCreatureField(creature, field.dataset.field), field.dataset.field);
        } else if (field.dataset.field === 'image') {
            field.value = formatImagePathForEditor(creature.image);
        }
        pruneCreature(creature);
    }

    function commitTableRow(row) {
        const index = Number(row?.dataset.index);
        const creature = state.creatures[index];
        if (!row || !creature) return;

        row.querySelectorAll('[data-field]').forEach((field) => {
            if (field.dataset.fileField) return;
            const fieldName = field.dataset.field;
            const value = field.type === 'checkbox' ? field.checked : field.value;
            writeCreatureField(creature, fieldName, value, { normalizeMetric: false });
        });
        pruneCreature(creature);
    }

    function formatMetricForEditor(value, path) {
        const raw = String(value || '').trim();
        if (!raw || !isMetricField(path)) return raw;

        const unit = path === 'details.height' ? 'm' : 'kg';
        const match = raw.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*${unit}\\b(.*)$`, 'i'));
        if (!match) return raw;

        const note = String(match[2] || '').trim().replace(/^\((.*)\)$/, '$1').trim();
        return `${match[1]}${note ? ` ${note}` : ''}`;
    }

    function listToText(value) {
        return Array.isArray(value) ? value.join('\n') : '';
    }

    function textToList(value) {
        return String(value || '')
            .split(/[\n,]/)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    function traitsToText(value) {
        if (!Array.isArray(value)) return '';
        return value.map((trait) => {
            if (typeof trait === 'string') return trait;
            return [trait.name, trait.icon, trait.note].map((part) => part || '').join(' | ').replace(/\s+\|\s+$/g, '');
        }).join('\n');
    }

    function textToTraits(value) {
        return String(value || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const parts = line.split('|').map((part) => part.trim());
                if (parts.length === 1) return parts[0];
                return pruneObject({
                    name: parts[0],
                    icon: parts[1],
                    note: parts[2]
                });
            });
    }

    function dropsToText(value) {
        if (!Array.isArray(value)) return '';
        return value.map((drop) => {
            if (typeof drop === 'string') return drop;
            return [drop.name, drop.image, drop.rarity, drop.note].map((part) => part || '').join(' | ').replace(/\s+\|\s+$/g, '');
        }).join('\n');
    }

    function textToDrops(value) {
        return String(value || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const parts = line.split('|').map((part) => part.trim());
                if (parts.length === 1) return parts[0];
                return pruneObject({
                    name: parts[0],
                    image: parts[1],
                    rarity: parts[2],
                    note: parts[3]
                });
            });
    }

    function pruneObject(object) {
        Object.keys(object).forEach((key) => {
            if (!object[key]) delete object[key];
        });
        return object;
    }

    function normalizeSearch(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function formatImagePathForEditor(value) {
        const path = String(value || '').trim().replace(/\\/g, '/');
        return path.startsWith(BESTIARY_IMAGE_PREFIX)
            ? path.slice(BESTIARY_IMAGE_PREFIX.length)
            : path;
    }

    function normalizeImagePathForData(value) {
        const path = String(value || '').trim().replace(/\\/g, '/');
        if (!path) return '';
        if (path.startsWith('assets/')) return path.slice('assets/'.length);
        if (path.startsWith('img/')) return path;
        return `${BESTIARY_IMAGE_PREFIX}${path}`;
    }

    function normalizeNumber(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function normalizeAssetPath(file) {
        const rawPath = String(file?.webkitRelativePath || file?.name || '').replace(/\\/g, '/');
        const webpPath = rawPath.replace(/\.(png|jpe?g)$/i, '.webp');
        const assetsIndex = rawPath.indexOf('assets/');
        if (assetsIndex >= 0) {
            return webpPath.slice(assetsIndex + 'assets/'.length);
        }
        const bestiaryIndex = rawPath.indexOf('img/creatures/bestiary/');
        if (bestiaryIndex >= 0) {
            return webpPath.slice(bestiaryIndex);
        }
        const imgIndex = rawPath.indexOf('img/');
        if (imgIndex >= 0) {
            return webpPath.slice(imgIndex);
        }
        return `img/creatures/bestiary/${webpPath.split('/').pop()}`;
    }

    function structuredCloneSafe(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function setStatus(message) {
        if (els.editorStatus) els.editorStatus.textContent = message;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        })[char]);
    }

    function toCamel(value) {
        return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    }
})();
