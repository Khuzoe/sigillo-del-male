(function () {
    const DATA_URL = () => window.CriptaApp?.urls?.data?.('bestiary.json') || '../assets/data/bestiary.json';
    const ITEMS_URL = () => window.CriptaApp?.urls?.data?.('items.json') || '../assets/data/items.json';
    const MEDIA_WORKER_URL = window.CriptaApp?.config?.workerOrigin || 'https://sigillo-api.khuzoe.workers.dev';
    const DATA_API_URL = () => window.CriptaApp?.urls?.api?.('api/data/bestiary') || `${MEDIA_WORKER_URL}/api/data/bestiary`;
    const ITEMS_API_URL = () => window.CriptaApp?.urls?.api?.('api/data/items') || `${MEDIA_WORKER_URL}/api/data/items`;
    const DISCORD_TOKEN_KEY = 'discord_jwt';
    const DB_NAME = 'cripta-bestiary-editor';
    const DB_VERSION = 1;
    const DB_STORE = 'file-handles';
    const BESTIARY_HANDLE_KEY = 'bestiary-json';
    const FILTER_STORAGE_KEY = 'cripta-bestiary-editor-filters';
    const DRAFT_STORAGE_KEY = 'cripta-bestiary-editor-draft';
    const FOCUS_MODE_STORAGE_KEY = 'cripta-bestiary-editor-focus-mode';
    const BESTIARY_IMAGE_PREFIX = 'media/creatures/bestiary/';
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
        adjustDrag: null,
        wikiItems: [],
        loadedVersion: null,
        loadedUpdatedAt: null
    };

    const els = {};
    let initializedRoot = null;

    bootWhenReady();
    document.addEventListener('cripta:spa-ready', bootEditor);

    function bootWhenReady() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bootEditor, { once: true });
        } else {
            bootEditor();
        }
    }

    function bootEditor() {
        const root = document.querySelector('.bestiary-editor-page');
        if (!root || root === initializedRoot) return;
        initializedRoot = root;
        init();
    }

    async function init() {
        bindElements();
        renderDefensePickers();
        renderStaticDetailSelects();
        restoreFilters();
        bindEvents();

        try {
            const loaded = await loadBestiaryData();
            state.creatures = loaded.creatures;
            state.loadedVersion = loaded.version ?? null;
            state.loadedUpdatedAt = loaded.updatedAt || null;
            if (!Array.isArray(state.creatures)) throw new Error('Formato bestiary.json non valido.');
            state.wikiItems = await loadWikiItems();
            state.selectedIndex = state.creatures.length ? 0 : -1;
            const restoredDraft = restoreDraft();
            renderAll();
            setFocusMode(restoreFocusMode());
            const statusParts = [`${state.creatures.length} creature caricate da ${loaded.source === 'kv' ? 'KV online' : 'JSON statico'}.`];
            if (restoredDraft) statusParts.push('Bozza locale ripristinata dopo reload.');
            setStatus(statusParts.join(' '));
        } catch (error) {
            console.error('Errore caricamento bestiario:', error);
            setStatus('Impossibile caricare il bestiario.', 'error');
        }
    }

    async function loadBestiaryData() {
        try {
            const response = await fetch(withCampaign(DATA_API_URL(), { cacheBust: true }));
            if (response.ok) {
                const payload = await response.json();
                if (Array.isArray(payload?.data)) {
                    return {
                        creatures: payload.data,
                        source: payload.source || 'kv',
                        version: Number(payload.version || 0),
                        updatedAt: payload.updatedAt || null
                    };
                }
            }
        } catch (error) {
            console.warn('KV bestiary non disponibile, uso JSON statico.', error);
        }

        const response = await fetch(DATA_URL());
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { creatures: await response.json(), source: 'static', version: 0, updatedAt: null };
    }

    function bindElements() {
        [
            'editor-status',
            'add-creature-btn',
            'import-json-btn',
            'import-json-file',
            'focus-mode-btn',
            'duplicate-creature-btn',
            'delete-creature-btn',
            'creature-picker',
            'search-input',
            'category-filter',
            'rank-filter',
            'show-hidden-toggle',
            'bestiary-table-body',
            'detail-form',
            'wiki-drop-select',
            'add-wiki-drop-btn',
            'preview-image',
            'preview-name',
            'preview-meta',
            'detail-image-dropzone',
            'detail-image-preview',
            'detail-image-path',
            'detail-image-file',
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
            setFocusMode(true);
            renderAll();
            focusPrimaryDetailField();
            setStatus('Nuova creatura aggiunta. Compila la scheda e poi salva online.');
        });

        els.importJsonBtn?.addEventListener('click', openImportJsonDialog);

        els.importJsonFile?.addEventListener('change', handleImportJsonFile);

        els.focusModeBtn?.addEventListener('click', () => {
            setFocusMode(!isFocusMode());
        });

        els.creaturePicker?.addEventListener('change', (event) => {
            const index = Number(event.target.value);
            if (!Number.isInteger(index) || !state.creatures[index]) return;
            commitActiveDetailField();
            state.selectedIndex = index;
            renderAll();
            setFocusMode(true);
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
            setStatus('Creatura eliminata dalla bozza. Premi "Salva online" per rimuoverla anche dal bestiario pubblico.');
        });

        els.bestiaryTableBody?.addEventListener('input', handleTableInput);
        els.bestiaryTableBody?.addEventListener('change', handleTableInput);
        els.bestiaryTableBody?.addEventListener('change', handleFilePick);
        els.bestiaryTableBody?.addEventListener('click', handleTableClick);
        els.bestiaryTableBody?.addEventListener('click', handleFilePickClick);
        els.detailForm?.addEventListener('input', handleDetailInput);
        els.detailForm?.addEventListener('change', handleDetailInput);
        els.detailForm?.addEventListener('click', handleDetailClick);
        els.detailImageDropzone?.addEventListener('click', () => pickDetailImage());
        els.detailImageFile?.addEventListener('change', handleDetailImageFile);
        els.detailImageDropzone?.addEventListener('dragover', handleDetailImageDrag);
        els.detailImageDropzone?.addEventListener('dragleave', handleDetailImageDrag);
        els.detailImageDropzone?.addEventListener('drop', handleDetailImageDrop);
        window.addEventListener('dragover', preventFileDropNavigation);
        window.addEventListener('drop', preventFileDropNavigation);
        els.imageAdjustModal?.addEventListener('input', handleAdjustInput);
        els.imageAdjustModal?.addEventListener('change', handleAdjustInput);
        els.imageAdjustModal?.addEventListener('click', handleAdjustClick);
        els.imageAdjustFrame?.addEventListener('pointerdown', handleAdjustPointerDown);
        els.imageAdjustFrame?.addEventListener('pointermove', handleAdjustPointerMove);
        els.imageAdjustFrame?.addEventListener('pointerup', handleAdjustPointerUp);
        els.imageAdjustFrame?.addEventListener('pointercancel', handleAdjustPointerUp);
        els.imageAdjustFrame?.addEventListener('wheel', handleAdjustWheel, { passive: false });

        els.saveJsonBtn?.addEventListener('click', saveOnlineData);

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

    function isFocusMode() {
        return document.querySelector('.bestiary-editor-shell')?.classList.contains('is-focus-mode') === true;
    }

    function restoreFocusMode() {
        const saved = window.localStorage.getItem(FOCUS_MODE_STORAGE_KEY);
        return saved === null ? true : saved === '1';
    }

    function setFocusMode(enabled) {
        const shell = document.querySelector('.bestiary-editor-shell');
        shell?.classList.toggle('is-focus-mode', enabled);
        if (els.focusModeBtn) {
            els.focusModeBtn.innerHTML = enabled
                ? '<i class="fas fa-table-list"></i> Tabella'
                : '<i class="fas fa-pen-to-square"></i> Scheda';
            els.focusModeBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            els.focusModeBtn.title = enabled ? 'Torna alla tabella bestiario' : 'Usa tutta la pagina per la scheda creatura';
        }
        try {
            window.localStorage.setItem(FOCUS_MODE_STORAGE_KEY, enabled ? '1' : '0');
        } catch (_) {
            // Ignore storage errors.
        }
    }

    function restoreDraft() {
        try {
            const draft = JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY) || 'null');
            if (!draft || !Array.isArray(draft.creatures)) return false;
            if (!Number.isFinite(Number(draft.loadedVersion)) || Number(draft.loadedVersion) !== Number(state.loadedVersion ?? 0)) {
                console.warn('Bozza editor bestiario ignorata: versione online diversa o sconosciuta.', {
                    draftVersion: draft.loadedVersion,
                    loadedVersion: state.loadedVersion
                });
                return false;
            }
            state.creatures = draft.creatures;
            state.selectedIndex = Number.isInteger(draft.selectedIndex)
                ? Math.min(Math.max(draft.selectedIndex, -1), state.creatures.length - 1)
                : (state.creatures.length ? 0 : -1);
            return true;
        } catch (error) {
            console.warn('Bozza editor bestiario non valida, ignorata.', error);
            return false;
        }
    }

    function persistDraft(creatures = null) {
        try {
            window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
                updatedAt: new Date().toISOString(),
                selectedIndex: state.selectedIndex,
                loadedVersion: state.loadedVersion,
                creatures: creatures || state.creatures
            }));
        } catch (error) {
            console.warn('Impossibile salvare la bozza editor bestiario.', error);
        }
    }

    function persistDraftWithImagePath(index, path) {
        const creatures = state.creatures.map((creature, creatureIndex) => {
            const copy = structuredCloneSafe(creature);
            if (creatureIndex === index) {
                copy.image = path;
                pruneCreature(copy);
            }
            return copy;
        });
        persistDraft(creatures);
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

    async function saveOnlineData(event) {
        updateOutput({ commitActive: event?.type === 'change' });
        const token = readAuthToken();
        if (!token) {
            setStatus('Login richiesto: accedi come admin prima di salvare online.', 'error');
            return;
        }

        let data;
        try {
            data = JSON.parse(els.jsonOutput.value);
        } catch (_) {
            setStatus('JSON non valido, impossibile salvare online.', 'error');
            return;
        }

        try {
            setStatus('Salvataggio online in corso...');
            const response = await fetch(withCampaign(DATA_API_URL(), { force: true }), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ data, expectedVersion: state.loadedVersion ?? 0, campaignId: getCampaignId() })
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || payload?.ok === false) {
                throw new Error(payload?.error || `HTTP ${response.status}`);
            }
            state.loadedVersion = payload.version ?? state.loadedVersion;
            state.loadedUpdatedAt = payload.updatedAt || state.loadedUpdatedAt;
            try {
                window.localStorage.removeItem(DRAFT_STORAGE_KEY);
            } catch (_) {
                // Ignore storage errors.
            }
            setStatus(`Bestiario salvato online (${payload.count ?? data.length}). Versione KV ${payload.version ?? '?'}.`);
        } catch (error) {
            console.error('Errore salvataggio online bestiario:', error);
            setStatus(`Salvataggio online fallito: ${error?.message || error}`, 'error');
        }
    }

    function readAuthToken() {
        try {
            return window.localStorage.getItem(DISCORD_TOKEN_KEY) || '';
        } catch (_) {
            return '';
        }
    }

    function getCampaignId() {
        return window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue';
    }

    function withCampaign(url, options = {}) {
        const target = new URL(url, window.location.href);
        const campaignId = getCampaignId();
        if (options.force === true || campaignId !== 'cripta-di-sangue') {
            target.searchParams.set('campaign', campaignId);
        }
        if (options.cacheBust === true) {
            target.searchParams.set('_', String(Date.now()));
        }
        return target.toString();
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
        renderCreaturePicker();
        renderDetails();
        updateOutput();
    }

    function renderCreaturePicker() {
        if (!els.creaturePicker) return;
        if (!state.creatures.length) {
            els.creaturePicker.innerHTML = '<option value="-1">Nessuna creatura</option>';
            els.creaturePicker.value = '-1';
            return;
        }
        els.creaturePicker.innerHTML = state.creatures.map((creature, index) => {
            const label = [creature.name || 'Creatura senza nome', creature.category].filter(Boolean).join(' | ');
            return `<option value="${index}">${escapeHtml(label)}</option>`;
        }).join('');
        els.creaturePicker.value = String(Math.max(0, state.selectedIndex));
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

    function renderStaticDetailSelects() {
        const rankSelect = document.getElementById('field-rank');
        if (rankSelect) {
            rankSelect.innerHTML = RANK_OPTIONS.map(([value, label]) => `
                <option value="${escapeHtml(value)}">${escapeHtml(label || 'Normale')}</option>
            `).join('');
        }

        const typeSelect = document.getElementById('field-type');
        if (typeSelect) {
            typeSelect.innerHTML = TYPE_OPTIONS.map((type) => `
                <option value="${escapeHtml(type)}">${escapeHtml(type || 'Tipo vuoto')}</option>
            `).join('');
        }
    }

    async function loadWikiItems() {
        try {
            const response = await fetch(withCampaign(ITEMS_API_URL()));
            if (response.ok) {
                const payload = await response.json();
                if (Array.isArray(payload?.data)) {
                    return payload.data.filter((item) => item && item.name);
                }
            }
        } catch (error) {
            console.warn('KV items non disponibile per i drop wiki, uso JSON statico.', error);
        }

        try {
            const response = await fetch(ITEMS_URL());
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const items = await response.json();
            return Array.isArray(items) ? items.filter((item) => item && item.name) : [];
        } catch (error) {
            console.warn('Impossibile caricare items.json per i drop wiki:', error);
            return [];
        }
    }

    function renderWikiDropSelect() {
        if (!els.wikiDropSelect) return;
        const options = state.wikiItems
            .slice()
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'it', { sensitivity: 'base' }))
            .map((item) => `<option value="${escapeHtml(item.id || item.name)}">${escapeHtml(item.name)}${item.rarity ? ` (${escapeHtml(item.rarity)})` : ''}</option>`);
        els.wikiDropSelect.innerHTML = [
            '<option value="">Scegli oggetto dalla wiki...</option>',
            ...options
        ].join('');
        if (els.addWikiDropBtn) els.addWikiDropBtn.disabled = options.length === 0;
    }

    function renderDetails() {
        const creature = getSelectedCreature();
        const fields = els.detailForm.querySelectorAll('[data-detail-field], [data-creature-field], [data-creature-list-field], [data-list-field], [data-complex-field], [data-defense-option]');
        fields.forEach((field) => {
            field.disabled = !creature;
        });
        if (els.detailImageDropzone) els.detailImageDropzone.disabled = !creature;

        if (!creature) {
            els.previewImage.removeAttribute('src');
            els.previewName.textContent = 'Nessuna creatura';
            els.previewMeta.textContent = 'Aggiungi o seleziona una creatura.';
            fields.forEach((field) => {
                if (field.type !== 'checkbox') field.value = '';
            });
            els.detailForm.querySelectorAll('[data-defense-option]').forEach((field) => { field.checked = false; });
            if (els.detailImagePreview) els.detailImagePreview.src = '../assets/img/ui/card.webp';
            if (els.detailImagePath) els.detailImagePath.textContent = 'Nessuna immagine selezionata.';
            return;
        }

        els.previewImage.src = resolveImageUrl(creature.image || '');
        els.previewImage.alt = creature.name || '';
        els.previewImage.style.setProperty('--preview-x', `${normalizeNumber(creature.imageAdjust?.x, 50)}%`);
        els.previewImage.style.setProperty('--preview-y', `${normalizeNumber(creature.imageAdjust?.y, 50)}%`);
        els.previewImage.style.setProperty('--preview-size', normalizeNumber(creature.imageAdjust?.size, 1));
        els.previewName.textContent = creature.name || 'Creatura senza nome';
        els.previewMeta.textContent = [creature.category || 'Senza categoria', creature.details?.dndType || 'Tipo ignoto'].join(' | ');

        els.detailForm.querySelector('[data-creature-field="name"]').value = creature.name || '';
        els.detailForm.querySelector('[data-creature-field="category"]').value = creature.category || '';
        els.detailForm.querySelector('[data-creature-field="rank"]').value = creature.rank || '';
        els.detailForm.querySelector('[data-detail-field="dndType"]').value = creature.details?.dndType || '';
        els.detailForm.querySelector('[data-detail-field="size"]').value = creature.details?.size || '';
        els.detailForm.querySelector('[data-detail-field="height"]').value = formatMetricForEditor(creature.details?.height, 'details.height');
        els.detailForm.querySelector('[data-detail-field="weight"]').value = formatMetricForEditor(creature.details?.weight, 'details.weight');
        els.detailForm.querySelector('[data-creature-field="hidden"]').checked = creature.hidden === true;
        els.detailForm.querySelector('[data-creature-field="discovered"]').checked = creature.discovered !== false;
        els.detailForm.querySelector('[data-creature-list-field="foundryName"]').value = creatureListToText(getCreatureFoundryNames(creature));
        els.detailForm.querySelector('[data-creature-list-field="aliases"]').value = creatureListToText(creature.aliases);
        if (els.detailImagePreview) {
            els.detailImagePreview.src = resolveImageUrl(creature.image || 'img/ui/card.webp');
            els.detailImagePreview.alt = creature.name || '';
        }
        if (els.detailImagePath) {
            els.detailImagePath.textContent = creature.image || 'Nessuna immagine selezionata.';
        }
        els.detailForm.querySelector('[data-detail-field="description"]').value = creature.details?.description || '';
        els.detailForm.querySelector('[data-creature-field="sourceCharacterId"]').value = creature.sourceCharacterId || '';
        els.detailForm.querySelector('[data-creature-field="mysteryName"]').value = creature.mysteryName || '';
        els.detailForm.querySelector('[data-creature-field="mysteryDescription"]').value = creature.mysteryDescription || '';
        syncDefensePicker('resistances', creature.details?.resistances);
        syncDefensePicker('immunities', creature.details?.immunities);
        syncDefensePicker('vulnerabilities', creature.details?.vulnerabilities);
        els.detailForm.querySelector('[data-complex-field="traits"]').value = traitsToText(creature.details?.traits);
        els.detailForm.querySelector('[data-complex-field="drops"]').value = dropsToText(creature.details?.drops);
        renderWikiDropSelect();
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
        els.previewImage.src = resolveImageUrl(creature.image || '');
        els.previewImage.alt = creature.name || '';
        els.previewImage.style.setProperty('--preview-x', `${normalizeNumber(creature.imageAdjust?.x, 50)}%`);
        els.previewImage.style.setProperty('--preview-y', `${normalizeNumber(creature.imageAdjust?.y, 50)}%`);
        els.previewImage.style.setProperty('--preview-size', normalizeNumber(creature.imageAdjust?.size, 1));
        updatePreview();
    }

    function updateDetailImagePreview(creature) {
        if (els.detailImagePreview) {
            els.detailImagePreview.src = resolveImageUrl(creature?.image || 'img/ui/card.webp');
            els.detailImagePreview.alt = creature?.name || '';
        }
        if (els.detailImagePath) {
            els.detailImagePath.textContent = creature?.image || 'Nessuna immagine selezionata.';
        }
    }

    function openImageAdjustModal(index) {
        const creature = state.creatures[index];
        if (!creature || !els.imageAdjustModal || !els.imageAdjustPreview) return;

        state.imageAdjustIndex = index;
        ensureImageAdjust(creature);
        creature.imageAdjust.x = normalizeNumber(creature.imageAdjust.x, 50);
        creature.imageAdjust.y = normalizeNumber(creature.imageAdjust.y, 50);
        creature.imageAdjust.size = normalizeNumber(creature.imageAdjust.size, 1);

        els.imageAdjustPreview.src = resolveImageUrl(creature.image || '');
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
                applyPickedImageFile(row, index, await handle.getFile());
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

        applyPickedImageFile(row, index, target.files[0]);
        target.value = '';
    }

    async function applyPickedImageFile(row, index, file) {
        if (!file) return;
        if (!Number.isInteger(index) || !state.creatures[index]) {
            setStatus('Seleziona o crea una creatura prima di caricare un\'immagine.', 'error');
            return;
        }
        commitActiveTableField();
        commitActiveDetailField();
        const creature = state.creatures[index];
        const outputName = buildWebpImageFileName(file, creature);
        const expectedPath = `${BESTIARY_IMAGE_PREFIX}${outputName}`;
        applyPickedImagePath(row, index, expectedPath, { alreadySaved: false });
        const path = await uploadImageFileToMediaBucket(file, creature, index, outputName);
        if (path) applyPickedImagePath(row, index, path);
    }

    function applyPickedImagePath(row, index, path, { alreadySaved = true } = {}) {
        const creature = state.creatures[index];
        if (!creature || !path) return;
        if (!isWebpPath(path)) {
            setStatus('Immagine non applicata: conversione WebP non riuscita.', 'error');
            return;
        }

        writeCreatureField(creature, 'image', path);
        state.selectedIndex = index;
        pruneCreature(creature);
        const pathInput = row?.querySelector('[data-field="image"]');
        if (pathInput) {
            pathInput.value = formatImagePathForEditor(path);
        }
        updatePreviewImage();
        updateDetailImagePreview(creature);
        renderCreaturePicker();
        renderTable();
        updateOutput({ commitActive: false });
        setStatus(alreadySaved ? `Immagine aggiornata: ${path}` : `Immagine associata. Upload in corso: ${path}`);
    }

    async function pickDetailImage() {
        const creature = getSelectedCreature();
        if (!creature) return;

        if (typeof window.showOpenFilePicker === 'function') {
            try {
                const [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [{
                        description: 'Immagini',
                        accept: { 'image/webp': ['.webp'], 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.avif'] }
                    }]
                });
                applyPickedImageFile(null, state.selectedIndex, await handle.getFile());
                return;
            } catch (error) {
                if (error?.name === 'AbortError') return;
                console.warn('Picker immagini non disponibile, uso input file.', error);
            }
        }

        els.detailImageFile?.click();
    }

    function handleDetailImageFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        applyPickedImageFile(null, state.selectedIndex, file);
        event.target.value = '';
    }

    function handleDetailImageDrag(event) {
        event.preventDefault();
        event.stopPropagation();
        if (event.type === 'dragover') {
            els.detailImageDropzone?.classList.add('is-dragging');
        } else {
            els.detailImageDropzone?.classList.remove('is-dragging');
        }
    }

    function handleDetailImageDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        els.detailImageDropzone?.classList.remove('is-dragging');
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;
        applyPickedImageFile(null, state.selectedIndex, file);
    }

    function preventFileDropNavigation(event) {
        if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
        event.preventDefault();
    }

    function handleDetailInput(event) {
        const creature = getSelectedCreature();
        if (!creature) return;
        ensureDetails(creature);

        const target = event.target;
        const detailField = target.dataset.detailField;
        const creatureField = target.dataset.creatureField;
        const creatureListField = target.dataset.creatureListField;
        const listField = target.dataset.listField;
        const complexField = target.dataset.complexField;
        const defenseField = target.closest('[data-defense-field]')?.dataset.defenseField;

        if (detailField) {
            const fieldPath = `details.${detailField}`;
            const value = target.type === 'checkbox' ? target.checked : target.value;
            writeCreatureField(creature, fieldPath, value, { normalizeMetric: event.type === 'change' });
            if (event.type === 'change' && isMetricField(fieldPath)) {
                target.value = formatMetricForEditor(readCreatureField(creature, fieldPath), fieldPath);
            }
        } else if (creatureField) {
            const value = target.type === 'checkbox' ? target.checked : target.value;
            writeCreatureField(creature, creatureField, value);
        } else if (creatureListField) {
            if (creatureListField === 'foundryName') {
                creature.foundryName = textToList(target.value);
                delete creature.foundryNames;
            } else {
                creature[creatureListField] = textToList(target.value);
            }
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
        renderCreaturePicker();
        updateOutput();
        setStatus('Modifiche non salvate esportate nel JSON.');
    }

    function handleDetailClick(event) {
        const addButton = event.target.closest('#add-wiki-drop-btn');
        if (!addButton) return;
        const creature = getSelectedCreature();
        if (!creature || !els.wikiDropSelect?.value) return;
        const item = state.wikiItems.find((entry) => String(entry.id || entry.name) === els.wikiDropSelect.value);
        if (!item) return;

        ensureDetails(creature);
        const drop = pruneObject({
            itemId: item.id,
            name: item.name,
            image: item.image,
            rarity: item.rarity,
            note: item.attunement ? 'Richiede sintonia' : ''
        });
        const drops = Array.isArray(creature.details.drops) ? creature.details.drops : [];
        creature.details.drops = [...drops, drop];
        const dropField = els.detailForm.querySelector('[data-complex-field="drops"]');
        if (dropField) dropField.value = dropsToText(creature.details.drops);
        pruneCreature(creature);
        updateOutput();
        setStatus(`Drop aggiunto da Oggetti: ${item.name}.`);
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
                    ...getCreatureFoundryNames(creature),
                    ...creatureListToArray(creature.aliases),
                    creature.category,
                    creature.rank,
                    creature.sourceCharacterId,
                    creature.mysteryName,
                    creature.mysteryDescription,
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
            image: `${BESTIARY_IMAGE_PREFIX}nuova_creatura.webp`,
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

    async function handleImportJsonFile(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        try {
            importCreaturesJsonText(await file.text());
        } catch (error) {
            console.error('Import JSON bestiario fallito:', error);
            setStatus(`Import JSON fallito: ${error?.message || error}`);
        }
    }

    function openImportJsonDialog() {
        const existing = document.querySelector('[data-bestiary-import-dialog]');
        if (existing) existing.remove();
        const dialog = document.createElement('div');
        dialog.dataset.bestiaryImportDialog = '1';
        dialog.style.cssText = 'position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:1rem;background:rgba(0,0,0,.72);';
        dialog.innerHTML = `
            <section style="width:min(760px,100%);display:grid;gap:.75rem;padding:1rem;border:1px solid rgba(212,175,55,.28);border-radius:10px;background:#121010;box-shadow:0 24px 70px rgba(0,0,0,.62);">
                <h2 style="margin:0;color:var(--gold);font-family:var(--font-heading);">Importa JSON Bestiario</h2>
                <p class="bestiary-editor-status">Incolla una singola creatura JSON oppure un array di creature. Se il nome o un nome Foundry esiste gia, ti verra chiesto se sostituirla.</p>
                <textarea class="bestiary-editor-area" data-import-json-text rows="16" spellcheck="false" placeholder='{"name":"Nuova Creatura","image":"media/creatures/bestiary/nuova.webp",...}'></textarea>
                <div class="bestiary-editor-actions" style="justify-content:flex-end;">
                    <button class="bestiary-editor-btn" type="button" data-import-file><i class="fas fa-folder-open"></i> Da file</button>
                    <button class="bestiary-editor-btn" type="button" data-import-cancel>Annulla</button>
                    <button class="bestiary-editor-btn" type="button" data-import-submit><i class="fas fa-file-import"></i> Importa</button>
                </div>
            </section>
        `;
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog || event.target.closest('[data-import-cancel]')) {
                dialog.remove();
                return;
            }
            if (event.target.closest('[data-import-file]')) {
                dialog.remove();
                els.importJsonFile?.click();
                return;
            }
            if (event.target.closest('[data-import-submit]')) {
                try {
                    importCreaturesJsonText(dialog.querySelector('[data-import-json-text]')?.value || '');
                    dialog.remove();
                } catch (error) {
                    console.error('Import JSON bestiario fallito:', error);
                    setStatus(`Import JSON fallito: ${error?.message || error}`);
                }
            }
        });
        document.body.appendChild(dialog);
        dialog.querySelector('[data-import-json-text]')?.focus();
    }

    function importCreaturesJsonText(text) {
        const imported = parseImportedCreaturesJson(text);
        const result = upsertImportedCreatures(imported);
        renderAll();
        setFocusMode(true);
        setStatus(`Import completato: ${result.added} aggiunte, ${result.replaced} sostituite.`);
    }

    function parseImportedCreaturesJson(text) {
        if (!String(text || '').trim()) throw new Error('Incolla o seleziona un JSON prima di importare.');
        const parsed = JSON.parse(text);
        const creatures = Array.isArray(parsed) ? parsed : [parsed];
        const validCreatures = creatures.filter((creature) => creature && typeof creature === 'object' && !Array.isArray(creature));
        if (!validCreatures.length) throw new Error('Il JSON deve contenere una creatura o un array di creature.');
        return validCreatures.map((creature) => {
            const copy = structuredCloneSafe(creature);
            if (!copy.name) copy.name = 'Creatura importata';
            if (!copy.details || typeof copy.details !== 'object') copy.details = {};
            pruneCreature(copy);
            return copy;
        });
    }

    function upsertImportedCreatures(importedCreatures) {
        let added = 0;
        let replaced = 0;
        let lastIndex = state.selectedIndex;

        importedCreatures.forEach((creature) => {
            const existingIndex = findCreatureIndexForImport(creature);
            if (existingIndex >= 0) {
                const confirmed = window.confirm(`Esiste gia "${state.creatures[existingIndex].name || creature.name}". Vuoi sostituirla con il JSON importato?`);
                if (!confirmed) return;
                state.creatures[existingIndex] = creature;
                replaced += 1;
                lastIndex = existingIndex;
                return;
            }

            state.creatures.push(creature);
            added += 1;
            lastIndex = state.creatures.length - 1;
        });

        state.selectedIndex = Math.max(-1, lastIndex);
        updateOutput({ commitActive: false });
        return { added, replaced };
    }

    function findCreatureIndexForImport(creature) {
        const nameKey = normalizeSearch(creature?.name);
        const foundryNames = new Set(getCreatureFoundryNames(creature).map(normalizeSearch));
        return state.creatures.findIndex((candidate) => {
            if (nameKey && normalizeSearch(candidate?.name) === nameKey) return true;
            if (!foundryNames.size) return false;
            return getCreatureFoundryNames(candidate).some((name) => foundryNames.has(normalizeSearch(name)));
        });
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
        if (creature.foundryNames !== undefined) {
            const merged = [...creatureListToArray(creature.foundryName), ...creatureListToArray(creature.foundryNames)]
                .filter((value, index, list) => list.indexOf(value) === index);
            creature.foundryName = merged.length ? merged : undefined;
            delete creature.foundryNames;
        }
        if (Array.isArray(creature.foundryName) && creature.foundryName.length === 0) delete creature.foundryName;
        if (Array.isArray(creature.aliases) && creature.aliases.length === 0) delete creature.aliases;
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
        persistDraft(cleanCreatures);
        els.jsonOutput.value = `${JSON.stringify(cleanCreatures, null, 2)}\n`;
    }

    function commitActiveDetailField() {
        const field = document.activeElement;
        if (!field?.dataset || field.dataset.fileField) return;
        if (!els.detailForm?.contains(field)) return;
        const creature = getSelectedCreature();
        if (!creature) return;

        const detailField = field.dataset.detailField;
        const creatureField = field.dataset.creatureField;
        const creatureListField = field.dataset.creatureListField;
        if (detailField) {
            const path = `details.${detailField}`;
            writeCreatureField(creature, path, field.type === 'checkbox' ? field.checked : field.value, { normalizeMetric: true });
            if (isMetricField(path)) field.value = formatMetricForEditor(readCreatureField(creature, path), path);
        } else if (creatureField) {
            writeCreatureField(creature, creatureField, field.type === 'checkbox' ? field.checked : field.value);
        } else if (creatureListField) {
            creature[creatureListField] = textToList(field.value);
        }
        pruneCreature(creature);
    }

    function focusPrimaryDetailField() {
        window.requestAnimationFrame(() => {
            els.detailForm?.querySelector('[data-creature-field="name"]')?.focus();
        });
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

    function creatureListToText(value) {
        return creatureListToArray(value).join('\n');
    }

    function creatureListToArray(value) {
        if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
        const single = String(value || '').trim();
        return single ? [single] : [];
    }

    function getCreatureFoundryNames(creature) {
        return [...creatureListToArray(creature?.foundryName), ...creatureListToArray(creature?.foundryNames)]
            .filter((value, index, list) => list.indexOf(value) === index);
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
            const note = drop.itemId
                ? [drop.note, `wiki:${drop.itemId}`].filter(Boolean).join(' ')
                : drop.note;
            return [drop.name, drop.image, drop.rarity, note].map((part) => part || '').join(' | ').replace(/\s+\|\s+$/g, '');
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
                const note = parts[3] || '';
                const itemMatch = note.match(/\bwiki:([a-z0-9_-]+)\b/i);
                return pruneObject({
                    name: parts[0],
                    image: parts[1],
                    rarity: parts[2],
                    note: note.replace(/\bwiki:[a-z0-9_-]+\b/i, '').trim(),
                    itemId: itemMatch?.[1]
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
        if (path.startsWith('media/')) return path;
        if (path.startsWith('/media/')) return path.slice(1);
        if (/^https?:\/\//i.test(path)) return path;
        if (path.startsWith('assets/')) return path.slice('assets/'.length);
        if (path.startsWith('img/')) return path;
        return `${BESTIARY_IMAGE_PREFIX}${path}`;
    }

    function resolveImageUrl(path) {
        const value = String(path || '').trim();
        if (!value) return '';
        if (/^(https?:|data:|blob:)/i.test(value)) return value;
        if (value.startsWith('media/')) return `${MEDIA_WORKER_URL}/${value}`;
        if (value.startsWith('/media/')) return `${MEDIA_WORKER_URL}${value}`;
        if (value.startsWith('assets/')) return `../${value}`;
        return `../assets/${value}`;
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
        const mediaIndex = rawPath.indexOf('media/creatures/bestiary/');
        if (mediaIndex >= 0) {
            return webpPath.slice(mediaIndex);
        }
        const bestiaryIndex = rawPath.indexOf('img/creatures/bestiary/');
        if (bestiaryIndex >= 0) {
            return webpPath.slice(bestiaryIndex);
        }
        const imgIndex = rawPath.indexOf('img/');
        if (imgIndex >= 0) {
            return webpPath.slice(imgIndex);
        }
        return `${BESTIARY_IMAGE_PREFIX}${webpPath.split('/').pop()}`;
    }

    async function uploadImageFileToMediaBucket(file, creature, index, outputName = '') {
        try {
            const finalOutputName = outputName || buildWebpImageFileName(file, creature);
            const outputPath = `${BESTIARY_IMAGE_PREFIX}${finalOutputName}`;
            setStatus(isWebpPath(file.name) ? 'Upload immagine su R2...' : 'Conversione WebP e upload su R2...');
            const blob = isWebpPath(file.name) ? file : await convertImageFileToWebpBlob(file);
            persistDraftWithImagePath(index, outputPath);
            return await uploadWebpBlob(blob, finalOutputName);
        } catch (error) {
            console.error('Upload immagine bestiario R2 fallito:', error);
            setStatus(`Upload immagine fallito: ${error?.message || error}`, 'error');
            return '';
        }
    }

    async function convertImageFileToWebpBlob(file) {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        bitmap.close?.();

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Il browser non ha prodotto un file WebP.'));
                    return;
                }
                resolve(blob);
            }, 'image/webp', 0.88);
        });
    }

    async function uploadWebpBlob(blob, fileName) {
        const token = readAuthToken();
        if (!token) {
            throw new Error('Login richiesto: accedi alla wiki prima di caricare immagini.');
        }

        const form = new FormData();
        form.set('folder', 'creatures/bestiary');
        form.set('filename', fileName);
        form.set('campaignId', getCampaignId());
        form.set('file', new File([blob], fileName, { type: 'image/webp' }));

        const response = await fetch(withCampaign(`${MEDIA_WORKER_URL}/media/upload?folder=creatures/bestiary`, { force: true }), {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`
            },
            body: form
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch (_) {
            payload = null;
        }

        if (!response.ok || !payload?.path) {
            throw new Error(payload?.error || `HTTP ${response.status}`);
        }

        return payload.path;
    }

    function buildWebpImageFileName(file, creature) {
        const originalName = String(file?.name || '').replace(/\.[^.]+$/, '');
        const base = slugify(creature?.name || originalName || 'creatura');
        return `${base || 'creatura'}.webp`;
    }

    function isWebpPath(path) {
        return /\.webp$/i.test(String(path || '').trim());
    }

    function slugify(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
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
