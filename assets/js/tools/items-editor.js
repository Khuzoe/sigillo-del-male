(function () {
    const DATA_URL = () => window.CriptaApp?.urls?.data?.('items.json') || '../assets/data/items.json';
    const MEDIA_WORKER_URL = window.CriptaApp?.config?.workerOrigin || 'https://sigillo-api.khuzoe.workers.dev';
    const DATA_API_URL = () => window.CriptaApp?.urls?.api?.('api/data/items') || `${MEDIA_WORKER_URL}/api/data/items`;
    const DISCORD_TOKEN_KEY = 'discord_jwt';
    const DB_NAME = 'cripta-items-editor';
    const DB_VERSION = 1;
    const DB_STORE = 'file-handles';
    const ITEMS_HANDLE_KEY = 'items-json';
    const FILTER_STORAGE_KEY = 'cripta-items-editor-filters';
    const DRAFT_STORAGE_KEY = 'cripta-items-editor-draft';
    const FOCUS_MODE_STORAGE_KEY = 'cripta-items-editor-focus-mode';
    const ITEM_IMAGE_PREFIX = 'media/items/';
    const TYPE_OPTIONS = [
        '',
        'Arma',
        'Armatura',
        'Anello',
        'Bacchetta',
        'Bastone',
        'Bottino',
        'Materiali',
        'Oggetto meraviglioso',
        'Pergamena',
        'Pozione',
        'Scudo',
        'Verga'
    ];
    const RARITY_OPTIONS = [
        '',
        'Comune',
        'Non comune',
        'Raro',
        'Epico',
        'Molto raro',
        'Leggendario',
        'Artefatto',
        'Sconosciuta'
    ];
    const STATUS_OPTIONS = [
        ['', 'Pubblico'],
        ['known', 'Noto'],
        ['identified', 'Identificato'],
        ['unknown', 'Sconosciuto'],
        ['hidden', 'Nascosto']
    ];

    const state = {
        items: [],
        selectedIndex: 0,
        query: '',
        rarity: 'all',
        type: 'all',
        fileHandle: null,
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
        const root = document.querySelector('.items-editor-page');
        if (!root || root === initializedRoot) return;
        initializedRoot = root;
        init();
    }

    async function init() {
        bindElements();
        enhanceDetailFormLayout();
        restoreFilters();
        bindEvents();

        try {
            const loaded = await loadItemsData();
            state.items = loaded.items;
            state.loadedVersion = loaded.version ?? null;
            state.loadedUpdatedAt = loaded.updatedAt || null;
            if (!Array.isArray(state.items)) throw new Error('Formato items.json non valido.');
            state.selectedIndex = state.items.length ? 0 : -1;
            const restoredDraft = restoreDraft();
            const selectedFromUrl = selectInitialItemFromUrl();
            renderAll();
            if (selectedFromUrl) setFocusMode(true);
            const statusParts = [`${state.items.length} oggetti caricati da ${loaded.source === 'kv' ? 'KV online' : 'JSON statico'}.`];
            if (restoredDraft) statusParts.push('Bozza locale ripristinata dopo reload.');
            if (selectedFromUrl) statusParts.push('Oggetto aperto dalla griglia.');
            setStatus(statusParts.join(' '));
        } catch (error) {
            console.error('Errore caricamento oggetti:', error);
            setStatus('Impossibile caricare gli oggetti.', 'error');
        }
    }

    async function loadItemsData() {
        try {
            const response = await fetch(withCampaign(DATA_API_URL()));
            if (response.ok) {
                const payload = await response.json();
                if (Array.isArray(payload?.data)) {
                    return {
                        items: payload.data,
                        source: payload.source || 'kv',
                        version: Number(payload.version || 0),
                        updatedAt: payload.updatedAt || null
                    };
                }
            }
        } catch (error) {
            console.warn('KV items non disponibile, uso JSON statico.', error);
        }

        const payload = typeof window.CriptaApp?.data?.json === 'function'
            ? await window.CriptaApp.data.json('items.json')
            : await window.CriptaApp.fetchJson(DATA_URL(), { clone: true });
        const items = Array.isArray(payload) ? payload : payload?.data;
        if (!Array.isArray(items)) throw new Error('Formato items.json non valido.');
        return { items, source: 'static', version: 0, updatedAt: null };
    }

    function bindElements() {
        [
            'editor-status',
            'add-item-btn',
            'add-material-btn',
            'import-json-btn',
            'import-json-file',
            'focus-mode-btn',
            'duplicate-item-btn',
            'delete-item-btn',
            'item-picker',
            'search-input',
            'rarity-filter',
            'type-filter',
            'items-table-body',
        'detail-form',
            'property-list',
            'add-property-btn',
            'preview-image',
            'preview-name',
            'preview-meta',
            'detail-image-dropzone',
            'detail-image-preview',
            'detail-image-path',
            'detail-image-file',
            'material-tag-list',
            'add-material-tag-btn',
            'json-output',
            'connect-json-btn',
            'save-json-btn',
            'copy-json-btn',
            'download-json-btn'
        ].forEach((id) => {
            els[toCamel(id)] = document.getElementById(id);
        });
    }

    function enhanceDetailFormLayout() {
        const form = els.detailForm;
        if (!form || form.dataset.enhanced === '1') return;
        form.dataset.enhanced = '1';
        form.classList.add('items-editor-detail-form');

        const fieldById = (id) => document.getElementById(id)?.closest('.items-editor-field');
        const checkByField = (field) => form.querySelector(`input[data-field="${field}"]`)?.closest('label');
        const section = (title, description, modifier = '') => {
            const node = document.createElement('section');
            node.className = `items-form-section ${modifier}`.trim();
            const header = document.createElement('div');
            header.className = 'items-form-section-header';
            const titleWrap = document.createElement('div');
            titleWrap.className = 'items-form-section-title';
            const heading = document.createElement('h3');
            heading.textContent = title;
            const copy = document.createElement('p');
            copy.textContent = description;
            titleWrap.append(heading, copy);
            header.append(titleWrap);
            node.append(header);
            return { node, header };
        };
        const grid = (modifier = '') => {
            const node = document.createElement('div');
            node.className = `items-form-grid ${modifier}`.trim();
            return node;
        };
        const appendExisting = (parent, nodes) => {
            nodes.filter(Boolean).forEach((node) => parent.append(node));
        };
        const createTextField = ({ id, field, label, placeholder = '', type = 'text' }) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'items-editor-field';
            const labelNode = document.createElement('label');
            labelNode.setAttribute('for', id);
            labelNode.textContent = label;
            const input = document.createElement('input');
            input.className = 'items-editor-input';
            input.id = id;
            input.dataset.field = field;
            input.type = type;
            input.placeholder = placeholder;
            wrapper.append(labelNode, input);
            return wrapper;
        };

        const imageField = els.detailImageDropzone?.closest('.items-editor-field');
        imageField?.classList.remove('items-editor-field--wide');
        if (els.detailImageDropzone) {
            els.detailImageDropzone.classList.add('items-editor-dropzone--hero');
            const strong = els.detailImageDropzone.querySelector('strong');
            const small = els.detailImageDropzone.querySelector('small');
            if (strong) strong.textContent = 'Immagine oggetto';
            if (small && small !== els.detailImagePath) {
                small.textContent = 'Trascina una WebP o clicca per caricare. Il path viene gestito automaticamente.';
            }
        }

        const identity = section('Identita', 'Nome, proprietario e immagine principale dell\'oggetto.', 'items-form-section--hero');
        const identityGrid = grid('items-form-grid--identity');
        appendExisting(identityGrid, [
            fieldById('field-name'),
            fieldById('field-id'),
            fieldById('field-owner')
        ]);
        appendExisting(identity.node, [imageField, identityGrid]);

        const classification = section('Classificazione', 'Campi usati nella lista, nelle schede giocatore e nelle associazioni con Foundry.');
        const classificationGrid = grid();
        appendExisting(classificationGrid, [
            fieldById('field-type'),
            fieldById('field-subtype'),
            fieldById('field-rarity'),
            fieldById('field-status')
        ]);
        const rulesField = document.createElement('div');
        rulesField.className = 'items-editor-field items-editor-field--wide';
        const rulesLabel = document.createElement('label');
        rulesLabel.textContent = 'Regole rapide';
        const rulesGrid = document.createElement('div');
        rulesGrid.className = 'items-editor-check-grid';
        ['unidentified', 'attunement', 'hidden'].forEach((field) => {
            const check = checkByField(field);
            if (!check) return;
            check.classList.add('items-editor-check--pill');
            rulesGrid.append(check);
        });
        rulesField.append(rulesLabel, rulesGrid);
        classificationGrid.append(rulesField);
        classification.node.append(classificationGrid);

        const material = section('Materiale', 'Campi dedicati a reagenti, minerali e componenti: valore, peso e tag descrittivi.');
        material.node.id = 'material-section';
        const materialGrid = grid('items-form-grid--two');
        materialGrid.append(
            createTextField({ id: 'field-value-gold', field: 'valueGold', label: 'Valore in oro', placeholder: 'Es. 50' }),
            createTextField({ id: 'field-weight', field: 'weight', label: 'Peso', placeholder: 'Es. 0.5' })
        );
        const materialTagsField = document.createElement('div');
        materialTagsField.className = 'items-editor-field items-editor-field--wide';
        const materialTagsLabel = document.createElement('label');
        materialTagsLabel.textContent = 'Tag materiale';
        const materialTagsList = document.createElement('div');
        materialTagsList.className = 'items-material-tag-list';
        materialTagsList.id = 'material-tag-list';
        const addMaterialTagBtn = document.createElement('button');
        addMaterialTagBtn.className = 'items-editor-btn';
        addMaterialTagBtn.id = 'add-material-tag-btn';
        addMaterialTagBtn.type = 'button';
        addMaterialTagBtn.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i> Aggiungi tag';
        materialTagsField.append(materialTagsLabel, materialTagsList, addMaterialTagBtn);
        material.node.append(materialGrid, materialTagsField);
        els.materialTagList = materialTagsList;
        els.addMaterialTagBtn = addMaterialTagBtn;

        const links = section('Collegamenti', 'Uno per riga. I nomi Foundry associano inventari e import; gli alias servono alla ricerca del sito.');
        const linksGrid = grid('items-form-grid--two');
        const foundryNamesField = fieldById('field-foundry-names');
        const aliasesField = fieldById('field-aliases');
        foundryNamesField?.classList.remove('items-editor-field--wide');
        aliasesField?.classList.remove('items-editor-field--wide');
        appendExisting(linksGrid, [
            foundryNamesField,
            aliasesField
        ]);
        links.node.append(linksGrid);

        const texts = section('Testi', 'La descrizione breve appare nelle liste. Le note sono per origine, sessione o contesto.');
        const textsGrid = grid('items-form-grid--description');
        appendExisting(textsGrid, [
            fieldById('field-summary'),
            fieldById('field-notes'),
            fieldById('field-unidentified-name'),
            fieldById('field-unidentified-description')
        ]);
        texts.node.append(textsGrid);

        const properties = section('Proprieta', 'Ogni blocco diventa una proprieta leggibile nella pagina oggetto. Usa "nascosta" per testo solo DM.');
        properties.node.id = 'properties-section';
        const propertyField = els.propertyList?.closest('.items-editor-field');
        const propertyLabel = propertyField?.querySelector('label');
        if (propertyLabel) propertyLabel.remove();
        if (els.addPropertyBtn) properties.header.append(els.addPropertyBtn);
        appendExisting(properties.node, [propertyField]);

        form.replaceChildren(identity.node, classification.node, material.node, links.node, texts.node, properties.node);
    }

    function bindEvents() {
        els.searchInput?.addEventListener('input', (event) => {
            state.query = event.target.value.trim();
            persistFilters();
            renderTable();
        });

        els.rarityFilter?.addEventListener('change', (event) => {
            state.rarity = event.target.value;
            persistFilters();
            renderTable();
        });

        els.typeFilter?.addEventListener('change', (event) => {
            state.type = event.target.value;
            persistFilters();
            renderTable();
        });

        els.addItemBtn?.addEventListener('click', () => {
            state.items.push(createEmptyItem());
            state.selectedIndex = state.items.length - 1;
            setFocusMode(true);
            renderAll();
            focusPrimaryDetailField();
            setStatus('Nuovo oggetto aggiunto. Compila la scheda e poi salva online.');
        });

        els.addMaterialBtn?.addEventListener('click', () => {
            state.items.push(createEmptyMaterial());
            state.selectedIndex = state.items.length - 1;
            setFocusMode(true);
            renderAll();
            focusPrimaryDetailField();
            setStatus('Nuovo materiale aggiunto. Compila valore, peso e tag, poi salva online.');
        });

        els.importJsonBtn?.addEventListener('click', openImportJsonDialog);

        els.importJsonFile?.addEventListener('change', handleImportJsonFile);

        els.focusModeBtn?.addEventListener('click', () => {
            setFocusMode(!isFocusMode());
        });

        els.itemPicker?.addEventListener('change', (event) => {
            const index = Number(event.target.value);
            if (!Number.isInteger(index) || !state.items[index]) return;
            commitActiveDetailField();
            state.selectedIndex = index;
            renderAll();
            setFocusMode(true);
        });

        els.duplicateItemBtn?.addEventListener('click', () => {
            const selected = getSelectedItem();
            if (!selected) return;
            const copy = structuredCloneSafe(selected);
            copy.id = uniqueId(`${copy.id || slugify(copy.name) || 'oggetto'}-copia`);
            copy.name = `${copy.name || 'Oggetto'} Copia`;
            state.items.splice(state.selectedIndex + 1, 0, copy);
            state.selectedIndex += 1;
            renderAll();
            setStatus('Oggetto duplicato.');
        });

        els.deleteItemBtn?.addEventListener('click', () => {
            const selected = getSelectedItem();
            if (!selected) return;
            const confirmed = window.confirm(`Eliminare "${selected.name || 'Oggetto senza nome'}"?`);
            if (!confirmed) return;
            state.items.splice(state.selectedIndex, 1);
            state.selectedIndex = Math.min(state.selectedIndex, state.items.length - 1);
            renderAll();
            setStatus('Oggetto eliminato.');
        });

        els.itemsTableBody?.addEventListener('input', handleTableInput);
        els.itemsTableBody?.addEventListener('change', handleTableInput);
        els.itemsTableBody?.addEventListener('change', handleFilePick);
        els.itemsTableBody?.addEventListener('click', handleTableClick);
        els.itemsTableBody?.addEventListener('click', handleFilePickClick);
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

        els.saveJsonBtn?.addEventListener('click', saveOnlineData);
        els.downloadJsonBtn?.addEventListener('click', downloadJson);
    }

    function restoreFilters() {
        try {
            const saved = JSON.parse(window.localStorage.getItem(FILTER_STORAGE_KEY) || '{}');
            if (typeof saved.query === 'string') state.query = saved.query;
            if (typeof saved.rarity === 'string') state.rarity = saved.rarity;
            if (typeof saved.type === 'string') state.type = saved.type;
        } catch (_) {
            // Ignore invalid filter cache.
        }
    }

    function isFocusMode() {
        return document.querySelector('.items-editor-shell')?.classList.contains('is-focus-mode') === true;
    }

    function restoreFocusMode() {
        const saved = window.localStorage.getItem(FOCUS_MODE_STORAGE_KEY);
        return saved === null ? true : saved === '1';
    }

    function setFocusMode(enabled) {
        const shell = document.querySelector('.items-editor-shell');
        shell?.classList.toggle('is-focus-mode', enabled);
        if (els.focusModeBtn) {
            els.focusModeBtn.innerHTML = enabled
                ? '<i class="fas fa-table-list"></i> Tabella'
                : '<i class="fas fa-pen-to-square"></i> Scheda';
            els.focusModeBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            els.focusModeBtn.title = enabled ? 'Torna alla tabella oggetti' : 'Usa tutta la pagina per la scheda oggetto';
        }
        try {
            window.localStorage.setItem(FOCUS_MODE_STORAGE_KEY, enabled ? '1' : '0');
        } catch (_) {
            // Ignore storage errors.
        }
    }

    function persistFilters() {
        try {
            window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
                query: state.query,
                rarity: state.rarity,
                type: state.type
            }));
        } catch (_) {
            // Ignore storage errors.
        }
    }

    function restoreDraft() {
        try {
            const draft = JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY) || 'null');
            if (!draft || !Array.isArray(draft.items)) return false;
            if (!Number.isFinite(Number(draft.loadedVersion)) || Number(draft.loadedVersion) !== Number(state.loadedVersion ?? 0)) {
                console.warn('Bozza editor oggetti ignorata: versione online diversa o sconosciuta.', {
                    draftVersion: draft.loadedVersion,
                    loadedVersion: state.loadedVersion
                });
                return false;
            }
            state.items = draft.items;
            state.selectedIndex = Number.isInteger(draft.selectedIndex)
                ? Math.min(Math.max(draft.selectedIndex, -1), state.items.length - 1)
                : (state.items.length ? 0 : -1);
            return true;
        } catch (error) {
            console.warn('Bozza editor oggetti non valida, ignorata.', error);
            return false;
        }
    }

    function persistDraft(items = null) {
        try {
            window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
                updatedAt: new Date().toISOString(),
                selectedIndex: state.selectedIndex,
                loadedVersion: state.loadedVersion,
                items: items || state.items
            }));
        } catch (error) {
            console.warn('Impossibile salvare la bozza editor oggetti.', error);
        }
    }

    function persistDraftWithImagePath(index, path) {
        const items = state.items.map((item, itemIndex) => {
            const copy = structuredCloneSafe(item);
            if (itemIndex === index) {
                copy.image = path;
                pruneItem(copy);
            }
            return copy;
        });
        persistDraft(items);
    }

    function selectInitialItemFromUrl() {
        const params = new URLSearchParams(window.location.search || '');
        const target = String(params.get('item') || params.get('id') || '').trim();
        if (!target || !Array.isArray(state.items) || !state.items.length) return false;
        const normalizedTarget = normalizeSearch(target);
        const index = state.items.findIndex((item) => {
            const id = String(item?.id || '').trim();
            if (id && id === target) return true;
            return normalizeSearch(id || item?.name || '') === normalizedTarget;
        });
        if (index < 0) return false;
        state.selectedIndex = index;
        return true;
    }

    async function connectJsonFile() {
        if (typeof window.showOpenFilePicker !== 'function') {
            setStatus('Collegamento diretto non supportato da questo browser. Usa Scarica JSON.', 'error');
            return;
        }

        try {
            const [handle] = await window.showOpenFilePicker({
                multiple: false,
                types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
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

    async function saveJsonToFile(event) {
        updateOutput({ commitActive: event?.type === 'change' });

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
                suggestedName: 'items.json',
                types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
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
            await verifyFilePermission(handle, false);
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
            const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(ITEMS_HANDLE_KEY);
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
                .put({ id: ITEMS_HANDLE_KEY, handle });
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
        setFocusMode(restoreFocusMode());
        renderFilters();
        renderItemPicker();
        renderTable();
        renderDetails();
        updateOutput({ commitActive: false });
    }

    function renderItemPicker() {
        if (!els.itemPicker) return;
        if (!state.items.length) {
            els.itemPicker.innerHTML = '<option value="-1">Nessun oggetto</option>';
            els.itemPicker.value = '-1';
            return;
        }
        els.itemPicker.innerHTML = state.items.map((item, index) => {
            const label = [item.name || 'Oggetto senza nome', item.rarity || '', item.type || '']
                .filter(Boolean)
                .join(' - ');
            return `<option value="${index}">${escapeHtml(label)}</option>`;
        }).join('');
        els.itemPicker.value = String(Math.max(0, state.selectedIndex));
    }

    function renderFilters() {
        if (els.searchInput) els.searchInput.value = state.query;
        renderFilterSelect(els.rarityFilter, 'Tutte le rarità', RARITY_OPTIONS, state.rarity);
        renderFilterSelect(els.typeFilter, 'Tutti i tipi', TYPE_OPTIONS, state.type);
    }

    function renderFilterSelect(select, allLabel, options, selectedValue) {
        if (!select) return;
        select.innerHTML = [
            `<option value="all">${allLabel}</option>`,
            ...options.filter(Boolean).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value || 'Vuoto')}</option>`)
        ].join('');
        select.value = selectedValue;
    }

    function renderTable() {
        const items = getFilteredItems();
        if (!items.length) {
            els.itemsTableBody.innerHTML = '<tr><td colspan="11">Nessun oggetto corrisponde ai filtri.</td></tr>';
            return;
        }

        els.itemsTableBody.innerHTML = items.map(({ item, index }) => `
            <tr data-index="${index}" class="${index === state.selectedIndex ? 'is-selected' : ''}">
                <td><input class="items-editor-input" data-field="name" value="${escapeHtml(item.name || '')}"></td>
                <td>
                    <div class="items-editor-path-cell">
                        <input class="items-editor-input" data-field="image" value="${escapeHtml(formatImagePathForEditor(item.image))}">
                        <button class="items-editor-btn" type="button" data-action="pick-image" title="Scegli immagine">
                            <i class="fas fa-folder-open" aria-hidden="true"></i>
                            <input class="items-editor-hidden" type="file" accept="image/*" data-file-field="image">
                        </button>
                    </div>
                </td>
                <td>${renderSelect('type', TYPE_OPTIONS.map((value) => [value, value || 'Tipo vuoto']), item.type || '')}</td>
                <td><input class="items-editor-input" data-field="subtype" value="${escapeHtml(item.subtype || '')}" placeholder="Secondario"></td>
                <td>${renderSelect('rarity', RARITY_OPTIONS.map((value) => [value, value || 'Rarità vuota']), item.rarity || '')}</td>
                <td><input class="items-editor-input" data-field="owner" value="${escapeHtml(item.owner || '')}"></td>
                <td>${renderSelect('status', STATUS_OPTIONS, item.status || '')}</td>
                <td><input type="checkbox" data-field="unidentified" ${item.unidentified === true ? 'checked' : ''}></td>
                <td><input type="checkbox" data-field="attunement" ${item.attunement === true ? 'checked' : ''}></td>
                <td><input type="checkbox" data-field="hidden" ${item.hidden === true || item.status === 'hidden' ? 'checked' : ''}></td>
                <td><button class="items-editor-btn" type="button" data-action="select">Dettagli</button></td>
            </tr>
        `).join('');
    }

    function renderSelect(field, options, selectedValue) {
        return `
            <select class="items-editor-select" data-field="${escapeHtml(field)}">
                ${options.map(([value, label]) => `
                    <option value="${escapeHtml(value)}" ${value === selectedValue ? 'selected' : ''}>${escapeHtml(label)}</option>
                `).join('')}
            </select>
        `;
    }

    function renderDetails() {
        const item = getSelectedItem();
        const fields = els.detailForm.querySelectorAll('[data-field], [data-property-field]');
        fields.forEach((field) => { field.disabled = !item; });
        if (els.addPropertyBtn) els.addPropertyBtn.disabled = !item;
        if (els.addMaterialTagBtn) els.addMaterialTagBtn.disabled = !item;
        if (els.detailImageDropzone) els.detailImageDropzone.disabled = !item;

        if (!item) {
            els.previewImage.removeAttribute('src');
            els.previewName.textContent = 'Nessun oggetto';
            els.previewMeta.textContent = 'Aggiungi o seleziona un oggetto.';
            fields.forEach((field) => { field.value = ''; });
            updateDetailImagePreview(null);
            if (els.propertyList) els.propertyList.innerHTML = '';
            if (els.materialTagList) els.materialTagList.innerHTML = '';
            return;
        }

        renderDetailSelects();
        updatePreview();
        updateDetailImagePreview(item);
        els.detailForm.querySelectorAll('[data-field]').forEach((field) => {
            const key = field.dataset.field;
            if (!key) return;
            if (field.type === 'checkbox') {
                field.checked = item[key] === true || (key === 'hidden' && item.status === 'hidden');
                return;
            }
            field.value = formatDetailFieldValue(item, key);
        });
        renderPropertiesEditor(item);
        renderMaterialSection(item);
    }

    function renderDetailSelects() {
        renderDetailSelect('type', TYPE_OPTIONS.map((value) => [value, value || 'Tipo vuoto']));
        renderDetailSelect('rarity', RARITY_OPTIONS.map((value) => [value, value || 'Rarità vuota']));
        renderDetailSelect('status', STATUS_OPTIONS);
    }

    function renderDetailSelect(field, options) {
        const select = els.detailForm?.querySelector(`select[data-field="${field}"]`);
        if (!select) return;
        const currentValue = select.value;
        select.innerHTML = options.map(([value, label]) => `
            <option value="${escapeHtml(value)}">${escapeHtml(label)}</option>
        `).join('');
        select.value = currentValue;
    }

    function formatDetailFieldValue(item, key) {
        if (key === 'foundryNames' || key === 'aliases') {
            if (key === 'foundryNames') {
                return [...itemNameList(item.foundryNames), ...itemNameList(item.foundryName)]
                    .filter((value, index, list) => list.indexOf(value) === index)
                    .join('\n');
            }
            return itemNameList(item[key]).join('\n');
        }
        if (key === 'image') return formatImagePathForEditor(item.image);
        return item[key] || '';
    }

    function updateDetailImagePreview(item) {
        const imagePath = item?.image || 'img/ui/card.webp';
        if (els.detailImagePreview) {
            els.detailImagePreview.src = resolveImageUrl(imagePath);
            els.detailImagePreview.alt = item?.name || '';
        }
        if (els.detailImagePath) {
            els.detailImagePath.textContent = item?.image || 'Nessuna immagine selezionata.';
        }
    }

    function renderPropertiesEditor(item) {
        if (!els.propertyList) return;
        const properties = normalizeProperties(item.properties, { keepEmpty: true });
        item.properties = properties;
        if (!properties.length) {
            els.propertyList.innerHTML = '<p class="items-editor-status">Nessuna proprietà aggiunta.</p>';
            return;
        }

        els.propertyList.innerHTML = properties.map((property, index) => `
            <div class="items-property-row ${property.negative === true ? 'items-property-row--negative' : property.genial === true ? 'items-property-row--genial' : ''}" data-property-index="${index}">
                <div class="items-property-row-top">
                    <input class="items-editor-input" data-property-field="name" placeholder="Nome" value="${escapeHtml(property.name || '')}">
                    <input class="items-editor-input" data-property-field="charges" placeholder="Cariche" value="${escapeHtml(property.charges || '')}">
                    <button class="items-editor-btn items-editor-btn--danger" type="button" data-action="remove-property" title="Rimuovi proprietà">
                        <i class="fas fa-trash" aria-hidden="true"></i>
                    </button>
                </div>
                <label class="items-editor-check">
                    <input type="checkbox" data-property-field="genial" ${property.genial === true ? 'checked' : ''}>
                    Proprietà geniale
                </label>
                <label class="items-editor-check">
                    <input type="checkbox" data-property-field="negative" ${property.negative === true ? 'checked' : ''}>
                    Effetto negativo
                </label>
                <label class="items-editor-check">
                    <input type="checkbox" data-property-field="hidden" ${property.hidden === true ? 'checked' : ''}>
                    Proprietà nascosta
                </label>
                <textarea class="items-editor-area" data-property-field="description" placeholder="Descrizione">${escapeHtml(property.description || '')}</textarea>
            </div>
        `).join('');
    }

    function renderMaterialSection(item) {
        const section = document.getElementById('material-section');
        const isMaterial = isMaterialItem(item);
        if (section) section.hidden = !isMaterial;
        const propertiesSection = document.getElementById('properties-section');
        if (propertiesSection) propertiesSection.hidden = isMaterial;
        if (!els.materialTagList) return;
        if (!isMaterial) {
            els.materialTagList.innerHTML = '';
            return;
        }

        const tags = normalizeMaterialTags(item.materialTags || item.tags || item.properties, { keepEmpty: true });
        item.materialTags = tags;
        if (Array.isArray(item.tags)) delete item.tags;
        if (Array.isArray(item.properties)) delete item.properties;
        if (!tags.length) {
            els.materialTagList.innerHTML = '<p class="items-editor-status">Nessun tag materiale aggiunto.</p>';
            return;
        }

        els.materialTagList.innerHTML = tags.map((tag, index) => `
            <div class="items-material-tag-row" data-material-tag-index="${index}">
                <div class="items-material-tag-row-top">
                    <input class="items-editor-input" data-material-tag-field="name" placeholder="Tag, es. Metallo, Necrotico, Reagente" value="${escapeHtml(tag.name || '')}">
                    <button class="items-editor-btn items-editor-btn--danger" type="button" data-action="remove-material-tag" title="Rimuovi tag">
                        <i class="fas fa-trash" aria-hidden="true"></i>
                    </button>
                </div>
                <textarea class="items-editor-area" data-material-tag-field="description" placeholder="Descrizione opzionale del tag">${escapeHtml(tag.description || '')}</textarea>
            </div>
        `).join('');
    }

    function updatePreview() {
        const item = getSelectedItem();
        if (!item) return;
        els.previewImage.src = resolveImageUrl(item.image || 'img/ui/card.webp');
        els.previewImage.alt = item.name || '';
        els.previewName.textContent = item.name || 'Oggetto senza nome';
        els.previewMeta.textContent = [
            formatItemTypeLabel(item),
            item.rarity || 'Rarità ignota',
            item.unidentified === true ? 'Non identificato' : ''
        ].filter(Boolean).join(' | ');
    }

    function handleTableClick(event) {
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
        const item = state.items[index];
        if (!row || !item) return;

        commitTableRow(row);
        state.selectedIndex = index;

        if (typeof window.showOpenFilePicker === 'function') {
            try {
                const [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [{
                        description: 'Immagini',
                        accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'] }
                    }]
                });
                applyPickedImageFile(row, index, await handle.getFile());
                return;
            } catch (error) {
                if (error?.name === 'AbortError') return;
                console.warn('Picker immagini non disponibile, uso input file.', error);
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
        const item = state.items[index];
        if (!item) return;

        state.selectedIndex = index;
        if (event.type === 'input') {
            setStatus('Modifiche in corso. Lascia il campo o salva per aggiornare il JSON.');
            return;
        }

        writeItemField(item, field, target.type === 'checkbox' ? target.checked : target.value);
        if (field === 'image') target.value = formatImagePathForEditor(item.image);
        pruneItem(item);
        renderDetails();
        renderItemPicker();
        updateOutput();
        setStatus('Modifiche non salvate esportate nel JSON.');
    }

    function handleFilePick(event) {
        const target = event.target;
        const fileField = target.dataset.fileField;
        if (!fileField || !target.files?.length) return;

        const row = target.closest('tr[data-index]');
        const index = Number(row?.dataset.index);
        const item = state.items[index];
        if (!row || !item) return;

        applyPickedImageFile(row, index, target.files[0]);
    }

    async function applyPickedImageFile(row, index, file) {
        if (!file) return;
        if (!Number.isInteger(index) || !state.items[index]) {
            setStatus('Seleziona o crea un oggetto prima di caricare un’immagine.', 'error');
            return;
        }
        commitActiveTableField();
        commitActiveDetailField();
        const item = state.items[index];
        const outputName = buildWebpImageFileName(file, item);
        const expectedPath = `media/items/${outputName}`;
        applyPickedImagePath(row, index, expectedPath, { alreadySaved: false });
        const path = await uploadImageFileToMediaBucket(file, item, index, outputName);
        if (path) applyPickedImagePath(row, index, path);
    }

    function applyPickedImagePath(row, index, path, { alreadySaved = true } = {}) {
        const item = state.items[index];
        if (!item || !path) return;
        if (!isWebpPath(path)) {
            setStatus('Immagine non applicata: conversione WebP non riuscita.', 'error');
            return;
        }

        writeItemField(item, 'image', path);
        state.selectedIndex = index;
        pruneItem(item);
        const pathInput = row?.querySelector('[data-field="image"]');
        if (pathInput) pathInput.value = formatImagePathForEditor(path);
        updatePreview();
        updateDetailImagePreview(item);
        renderItemPicker();
        renderTable();
        updateOutput({ commitActive: false });
        setStatus(alreadySaved ? `Immagine aggiornata: ${path}` : `Immagine associata. Upload in corso: ${path}`);
    }

    async function pickDetailImage() {
        const item = getSelectedItem();
        if (!item) return;

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
        const item = getSelectedItem();
        if (!item) return;
        const target = event.target;
        const field = target.dataset.field;
        const propertyField = target.dataset.propertyField;
        const materialTagField = target.dataset.materialTagField;

        if (field) {
            writeItemField(item, field, target.type === 'checkbox' ? target.checked : target.value);
        } else if (propertyField) {
            const row = target.closest('[data-property-index]');
            const index = Number(row?.dataset.propertyIndex);
            if (!Number.isInteger(index)) return;
            item.properties = normalizeProperties(item.properties, { keepEmpty: true });
            if (!item.properties[index]) item.properties[index] = {};
            item.properties[index][propertyField] = (propertyField === 'genial' || propertyField === 'negative' || propertyField === 'hidden')
                ? target.checked === true
                : String(target.value || '').trim();
            updatePreview();
            if (propertyField === 'genial' || propertyField === 'negative' || propertyField === 'hidden') renderPropertiesEditor(item);
            updateOutput();
            setStatus('Modifiche non salvate esportate nel JSON.');
            return;
        } else if (materialTagField) {
            const row = target.closest('[data-material-tag-index]');
            const index = Number(row?.dataset.materialTagIndex);
            if (!Number.isInteger(index)) return;
            item.materialTags = normalizeMaterialTags(item.materialTags || item.tags || [], { keepEmpty: true });
            if (!item.materialTags[index]) item.materialTags[index] = {};
            item.materialTags[index][materialTagField] = String(target.value || '').trim();
            if (Array.isArray(item.tags)) delete item.tags;
            updatePreview();
            updateOutput();
            setStatus('Modifiche non salvate esportate nel JSON.');
            return;
        }

        pruneItem(item);
        updatePreview();
        updateDetailImagePreview(item);
        renderMaterialSection(item);
        renderItemPicker();
        renderTable();
        updateOutput();
        setStatus('Modifiche non salvate esportate nel JSON.');
    }

    function handleDetailClick(event) {
        const item = getSelectedItem();
        if (!item) return;

        if (event.target.closest('#add-property-btn')) {
            item.properties = normalizeProperties(item.properties, { keepEmpty: true });
            item.properties.push({ name: '', charges: '', description: '' });
            renderPropertiesEditor(item);
            updateOutput();
            setStatus('Proprietà aggiunta.');
            return;
        }

        if (event.target.closest('#add-material-tag-btn')) {
            item.materialTags = normalizeMaterialTags(item.materialTags || item.tags || [], { keepEmpty: true });
            item.materialTags.push({ name: '', description: '' });
            if (Array.isArray(item.tags)) delete item.tags;
            renderMaterialSection(item);
            updateOutput();
            setStatus('Tag materiale aggiunto.');
            return;
        }

        const removeMaterialTagButton = event.target.closest('[data-action="remove-material-tag"]');
        if (removeMaterialTagButton) {
            const row = removeMaterialTagButton.closest('[data-material-tag-index]');
            const index = Number(row?.dataset.materialTagIndex);
            if (!Number.isInteger(index)) return;
            item.materialTags = normalizeMaterialTags(item.materialTags || item.tags || [], { keepEmpty: true });
            item.materialTags.splice(index, 1);
            pruneItem(item);
            renderMaterialSection(item);
            updateOutput();
            setStatus('Tag materiale rimosso.');
            return;
        }

        const removeButton = event.target.closest('[data-action="remove-property"]');
        if (!removeButton) return;
        const row = removeButton.closest('[data-property-index]');
        const index = Number(row?.dataset.propertyIndex);
        if (!Number.isInteger(index)) return;
        item.properties = normalizeProperties(item.properties, { keepEmpty: true });
        item.properties.splice(index, 1);
        pruneItem(item);
        renderPropertiesEditor(item);
        updateOutput();
        setStatus('Proprietà rimossa.');
    }

    function getFilteredItems() {
        const query = normalizeSearch(state.query);
        return state.items
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => {
                const searchableProperties = item.unidentified === true
                    ? []
                    : normalizeProperties(item.properties).filter((property) => property.hidden !== true);
                const materialTags = normalizeMaterialTags(item.materialTags || item.tags);
                if (state.rarity !== 'all' && (item.rarity || '') !== state.rarity) return false;
                if (state.type !== 'all' && (item.type || '') !== state.type) return false;
                if (!query) return true;
                return normalizeSearch([
                    item.name,
                    ...itemNameList(item.foundryNames),
                    ...itemNameList(item.foundryName),
                    ...itemNameList(item.aliases),
                    item.type,
                    item.subtype,
                    item.rarity,
                    item.owner,
                    item.summary,
                    item.unidentifiedName,
                    item.unidentifiedDescription,
                    item.notes,
                    item.valueGold,
                    item.weight,
                    ...searchableProperties.flatMap((property) => [
                        property.name,
                        property.charges,
                        property.description
                    ]),
                    ...materialTags.flatMap((tag) => [
                        tag.name,
                        tag.description
                    ])
                ].filter(Boolean).join(' ')).includes(query);
            });
    }

    function getSelectedItem() {
        return state.items[state.selectedIndex] || null;
    }

    function createEmptyItem() {
        return {
            id: uniqueId('nuovo-oggetto'),
            name: 'Nuovo Oggetto',
            type: 'Oggetto meraviglioso',
            subtype: '',
            rarity: 'Sconosciuta',
            unidentified: false,
            attunement: false,
            image: 'media/items/nuovo_oggetto.webp',
            icon: 'fa-wand-sparkles',
            summary: '',
            properties: [],
            notes: ''
        };
    }

    function createEmptyMaterial() {
        return {
            id: uniqueId('nuovo-materiale'),
            name: 'Nuovo Materiale',
            type: 'Materiali',
            subtype: 'Reagente',
            rarity: 'Sconosciuta',
            image: 'media/items/nuovo_materiale.webp',
            icon: 'fa-cubes-stacked',
            summary: '',
            materialTags: [],
            notes: ''
        };
    }

    async function handleImportJsonFile(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        try {
            importItemsJsonText(await file.text());
        } catch (error) {
            console.error('Import JSON oggetti fallito:', error);
            setStatus(`Import JSON fallito: ${error?.message || error}`, 'error');
        }
    }

    function openImportJsonDialog() {
        const existing = document.querySelector('[data-items-import-dialog]');
        if (existing) existing.remove();
        const dialog = document.createElement('div');
        dialog.dataset.itemsImportDialog = '1';
        dialog.style.cssText = 'position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:1rem;background:rgba(0,0,0,.72);';
        dialog.innerHTML = `
            <section style="width:min(760px,100%);display:grid;gap:.75rem;padding:1rem;border:1px solid rgba(212,175,55,.28);border-radius:10px;background:#121010;box-shadow:0 24px 70px rgba(0,0,0,.62);">
                <h2 style="margin:0;color:var(--gold);font-family:var(--font-heading);">Importa JSON Oggetto</h2>
                <p class="items-editor-status">Incolla un singolo oggetto JSON oppure un array di oggetti. Se l'id esiste gia, ti verra chiesto se sostituirlo.</p>
                <textarea class="items-editor-area" data-import-json-text rows="16" spellcheck="false" placeholder='{"id":"globo-d-anima","name":"Globo d&apos;Anima",...}'></textarea>
                <div class="items-editor-actions" style="justify-content:flex-end;">
                    <button class="items-editor-btn" type="button" data-import-file><i class="fas fa-folder-open"></i> Da file</button>
                    <button class="items-editor-btn" type="button" data-import-cancel>Annulla</button>
                    <button class="items-editor-btn" type="button" data-import-submit><i class="fas fa-file-import"></i> Importa</button>
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
                    importItemsJsonText(dialog.querySelector('[data-import-json-text]')?.value || '');
                    dialog.remove();
                } catch (error) {
                    console.error('Import JSON oggetti fallito:', error);
                    setStatus(`Import JSON fallito: ${error?.message || error}`, 'error');
                }
            }
        });
        document.body.appendChild(dialog);
        dialog.querySelector('[data-import-json-text]')?.focus();
    }

    function importItemsJsonText(text) {
        const imported = parseImportedItemsJson(text);
        const result = upsertImportedItems(imported);
        renderAll();
        setFocusMode(true);
        setStatus(`Import completato: ${result.added} aggiunti, ${result.replaced} sostituiti.`);
    }

    function parseImportedItemsJson(text) {
        if (!String(text || '').trim()) throw new Error('Incolla o seleziona un JSON prima di importare.');
        const parsed = JSON.parse(text);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const validItems = items.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
        if (!validItems.length) throw new Error('Il JSON deve contenere un oggetto o un array di oggetti.');
        return validItems.map((item) => {
            const copy = structuredCloneSafe(item);
            if (!copy.id && copy.name) copy.id = uniqueId(copy.name);
            if (!copy.name) copy.name = copy.id || 'Oggetto importato';
            pruneItem(copy);
            return copy;
        });
    }

    function upsertImportedItems(importedItems) {
        let added = 0;
        let replaced = 0;
        let lastIndex = state.selectedIndex;

        importedItems.forEach((item) => {
            const existingIndex = findItemIndexForImport(item);
            if (existingIndex >= 0) {
                const confirmed = window.confirm(`Esiste gia "${state.items[existingIndex].name || item.name}". Vuoi sostituirlo con il JSON importato?`);
                if (!confirmed) return;
                state.items[existingIndex] = item;
                replaced += 1;
                lastIndex = existingIndex;
                return;
            }

            state.items.push(item);
            added += 1;
            lastIndex = state.items.length - 1;
        });

        state.selectedIndex = Math.max(-1, lastIndex);
        updateOutput({ commitActive: false });
        return { added, replaced };
    }

    function findItemIndexForImport(item) {
        const id = String(item?.id || '').trim();
        const nameKey = normalizeSearch(item?.name);
        return state.items.findIndex((candidate) => {
            if (id && String(candidate?.id || '').trim() === id) return true;
            return nameKey && normalizeSearch(candidate?.name) === nameKey;
        });
    }

    function writeItemField(item, field, value) {
        if (field === 'attunement') {
            item.attunement = value === true ? true : undefined;
            return;
        }
        if (field === 'unidentified') {
            item.unidentified = value === true ? true : undefined;
            return;
        }
        if (field === 'hidden') {
            item.hidden = value === true ? true : undefined;
            if (value === true) item.status = 'hidden';
            if (value !== true && item.status === 'hidden') item.status = undefined;
            return;
        }
        if (field === 'image') {
            item.image = normalizeImagePathForData(value) || undefined;
            return;
        }
        if (field === 'valueGold' || field === 'weight') {
            item[field] = normalizeNumberLikeField(value);
            return;
        }
        if (field === 'foundryNames' || field === 'aliases') {
            const values = String(value || '')
                .split(/\r?\n/)
                .map((entry) => entry.trim())
                .filter(Boolean);
            item[field] = values.length ? Array.from(new Set(values)) : undefined;
            if (field === 'foundryNames') delete item.foundryName;
            return;
        }
        item[field] = String(value || '').trim() || undefined;
    }

    function pruneItem(item) {
        ['id', 'name', 'type', 'subtype', 'rarity', 'owner', 'status', 'icon', 'image', 'summary', 'notes', 'unidentifiedName', 'unidentifiedDescription', 'valueGold', 'weight'].forEach((key) => {
            if (item[key] === undefined || item[key] === '') delete item[key];
        });
        if (item.foundryName !== undefined) {
            const merged = [...itemNameList(item.foundryNames), ...itemNameList(item.foundryName)]
                .filter((value, index, list) => list.indexOf(value) === index);
            item.foundryNames = merged.length ? merged : undefined;
            delete item.foundryName;
        }
        ['foundryNames', 'aliases'].forEach((key) => {
            if (!Array.isArray(item[key]) || !item[key].length) delete item[key];
        });
        if (item.attunement !== true) delete item.attunement;
        if (item.unidentified !== true) delete item.unidentified;
        if (item.hidden !== true) delete item.hidden;
        if (isMaterialItem(item)) {
            delete item.attunement;
            item.materialTags = normalizeMaterialTags(item.materialTags || item.tags || item.properties);
            if (item.materialTags.length === 0) delete item.materialTags;
            delete item.properties;
            if (Array.isArray(item.tags)) delete item.tags;
            return;
        }
        item.properties = normalizeProperties(item.properties);
        if (item.properties.length === 0) delete item.properties;
        delete item.materialTags;
        if (Array.isArray(item.tags)) delete item.tags;
    }

    function itemNameList(value) {
        if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
        const single = String(value || '').trim();
        return single ? [single] : [];
    }

    function updateOutput({ commitActive = true } = {}) {
        if (commitActive) commitActiveTableField();
        const cleanItems = state.items.map((item) => {
            const copy = structuredCloneSafe(item);
            pruneItem(copy);
            return copy;
        });
        els.jsonOutput.value = `${JSON.stringify(cleanItems, null, 2)}\n`;
        persistDraft(cleanItems);
    }

    function commitActiveTableField() {
        const field = document.activeElement;
        if (!field?.dataset?.field || field.dataset.fileField) return;
        const row = field.closest('tr[data-index]');
        const index = Number(row?.dataset.index);
        const item = state.items[index];
        if (!row || !item) return;
        writeItemField(item, field.dataset.field, field.type === 'checkbox' ? field.checked : field.value);
        if (field.dataset.field === 'image') field.value = formatImagePathForEditor(item.image);
        pruneItem(item);
    }

    function commitActiveDetailField() {
        const field = document.activeElement;
        if (!field?.dataset?.field || field.dataset.fileField) return;
        if (!els.detailForm?.contains(field)) return;
        const item = getSelectedItem();
        if (!item) return;
        writeItemField(item, field.dataset.field, field.type === 'checkbox' ? field.checked : field.value);
        if (field.dataset.field === 'image') field.value = formatImagePathForEditor(item.image);
        pruneItem(item);
    }

    function focusPrimaryDetailField() {
        window.requestAnimationFrame(() => {
            els.detailForm?.querySelector('[data-field="name"]')?.focus();
        });
    }

    function commitTableRow(row) {
        const index = Number(row?.dataset.index);
        const item = state.items[index];
        if (!row || !item) return;
        row.querySelectorAll('[data-field]').forEach((field) => {
            if (field.dataset.fileField) return;
            writeItemField(item, field.dataset.field, field.type === 'checkbox' ? field.checked : field.value);
        });
        pruneItem(item);
    }

    async function copyJson() {
        updateOutput();
        try {
            await navigator.clipboard.writeText(els.jsonOutput.value);
            setStatus('JSON copiato negli appunti.');
        } catch (_) {
            els.jsonOutput.select();
            document.execCommand('copy');
            setStatus('JSON selezionato e copiato.');
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
        } catch (error) {
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
            setStatus(`Oggetti salvati online (${payload.count ?? data.length}). Versione KV ${payload.version ?? '?'}.`);
        } catch (error) {
            console.error('Errore salvataggio online oggetti:', error);
            setStatus(`Salvataggio online fallito: ${error?.message || error}`, 'error');
        }
    }

    function downloadJson() {
        updateOutput();
        const blob = new Blob([els.jsonOutput.value], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'items.json';
        link.click();
        URL.revokeObjectURL(url);
        setStatus('Export JSON scaricato.');
    }

    function normalizeProperties(properties, { keepEmpty = false } = {}) {
        if (!Array.isArray(properties)) return [];
        return properties
            .map((property) => {
                if (typeof property === 'string') {
                    const description = property.trim();
                    return description ? { name: '', charges: '', description } : null;
                }
                if (!property || typeof property !== 'object') return null;
                const normalized = {
                    name: String(property.name || '').trim(),
                    charges: String(property.charges || '').trim(),
                    description: String(property.description || '').trim()
                };
                if (property.negative === true) normalized.negative = true;
                else if (property.genial === true) normalized.genial = true;
                if (property.hidden === true) normalized.hidden = true;
                if (normalized.name || normalized.charges || normalized.description) return normalized;
                return keepEmpty ? normalized : null;
            })
            .filter(Boolean);
    }

    function normalizeMaterialTags(tags, { keepEmpty = false } = {}) {
        if (!Array.isArray(tags)) return [];
        return tags
            .map((tag) => {
                if (typeof tag === 'string') {
                    const name = tag.trim();
                    if (name) return { name, description: '' };
                    return keepEmpty ? { name: '', description: '' } : null;
                }
                if (!tag || typeof tag !== 'object') return null;
                const normalized = {
                    name: String(tag.name || tag.label || tag.tag || '').trim(),
                    description: String(tag.description || tag.desc || tag.note || '').trim()
                };
                if (normalized.name || normalized.description) return normalized;
                return keepEmpty ? normalized : null;
            })
            .filter(Boolean);
    }

    function normalizeNumberLikeField(value) {
        const text = String(value ?? '').trim();
        if (!text) return undefined;
        const numeric = Number(text.replace(',', '.'));
        return Number.isFinite(numeric) && /^-?\d+(?:[.,]\d+)?$/.test(text) ? numeric : text;
    }

    function isMaterialItem(item) {
        const haystack = [
            item?.type,
            item?.subtype,
            item?.name
        ].map((value) => normalizeSearch(value));
        return haystack.some((value) =>
            value === 'materiale'
            || value === 'materiali'
            || value === 'minerale'
            || value === 'minerali'
            || value === 'reagente'
            || value === 'reagenti'
            || value === 'ingrediente'
            || value === 'ingredienti'
        );
    }

    function formatImagePathForEditor(value) {
        const path = String(value || '').trim().replace(/\\/g, '/');
        return path.startsWith(ITEM_IMAGE_PREFIX) ? path.slice(ITEM_IMAGE_PREFIX.length) : path;
    }

    function normalizeImagePathForData(value) {
        const path = String(value || '').trim().replace(/\\/g, '/');
        if (!path) return '';
        if (path.startsWith('media/')) return path;
        if (path.startsWith('/media/')) return path.slice(1);
        if (/^https?:\/\//i.test(path)) return path;
        if (path.startsWith('assets/')) return path.slice('assets/'.length);
        if (path.startsWith('img/')) return path;
        return `${ITEM_IMAGE_PREFIX}${path}`;
    }

    function normalizeAssetPath(file) {
        const rawPath = String(file?.webkitRelativePath || file?.name || '').replace(/\\/g, '/');
        const assetsIndex = rawPath.indexOf('assets/');
        if (assetsIndex >= 0) return rawPath.slice(assetsIndex + 'assets/'.length);
        const mediaIndex = rawPath.indexOf('media/items/');
        if (mediaIndex >= 0) return rawPath.slice(mediaIndex);
        const itemsIndex = rawPath.indexOf('img/items/');
        if (itemsIndex >= 0) return rawPath.slice(itemsIndex);
        const imgIndex = rawPath.indexOf('img/');
        if (imgIndex >= 0) return rawPath.slice(imgIndex);
        return `${ITEM_IMAGE_PREFIX}${rawPath.split('/').pop()}`;
    }

    async function uploadImageFileToMediaBucket(file, item, index, outputName = '') {
        try {
            const finalOutputName = outputName || buildWebpImageFileName(file, item);
            const outputPath = `media/items/${finalOutputName}`;
            setStatus(isWebpPath(file.name) ? 'Upload immagine su R2...' : 'Conversione WebP e upload su R2...');
            persistDraftWithImagePath(index, outputPath);
            const payload = await window.CriptaMedia.uploadImageFile(file, {
                folder: 'items',
                fileName: finalOutputName,
                token: readAuthToken(),
                quality: 0.88,
                authError: 'Login richiesto: accedi alla wiki prima di caricare immagini.'
            });
            return payload.path;
        } catch (error) {
            console.error('Upload immagine R2 fallito:', error);
            setStatus(`Upload immagine fallito: ${error?.message || error}`, 'error');
            return '';
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
        return target.toString();
    }

    function resolveImageUrl(path) {
        const value = String(path || '').trim();
        if (!value) return '../assets/img/ui/card.webp';
        if (/^(https?:|data:|blob:)/i.test(value)) return value;
        if (value.startsWith('media/')) return `${MEDIA_WORKER_URL}/${value}`;
        if (value.startsWith('/media/')) return `${MEDIA_WORKER_URL}${value}`;
        if (value.startsWith('assets/')) return `../${value}`;
        return `../assets/${value}`;
    }

    function buildWebpImageFileName(file, item) {
        const originalName = String(file?.name || '').replace(/\.[^.]+$/, '');
        const base = slugify(item?.id || item?.name || originalName || 'oggetto');
        return `${base || 'oggetto'}.webp`;
    }

    function isWebpPath(path) {
        return /\.webp$/i.test(String(path || '').trim());
    }

    function formatItemTypeLabel(item) {
        const type = String(item?.type || 'Oggetto').trim() || 'Oggetto';
        const subtype = String(item?.subtype || '').trim();
        return subtype ? `${type} (${subtype})` : type;
    }

    function uniqueId(base) {
        const root = slugify(base) || 'oggetto';
        const ids = new Set(state.items.map((item) => item.id).filter(Boolean));
        if (!ids.has(root)) return root;
        let counter = 2;
        while (ids.has(`${root}-${counter}`)) counter += 1;
        return `${root}-${counter}`;
    }

    function slugify(value) {
        return window.CriptaApp.utils.slugify(value, '');
    }

    function normalizeSearch(value) {
        return window.CriptaApp.utils.normalizeText(value);
    }

    function structuredCloneSafe(value) {
        return window.CriptaApp.utils.structuredCloneSafe(value);
    }

    function setStatus(message, type = 'info') {
        if (!els.editorStatus) return;
        els.editorStatus.textContent = message;
        els.editorStatus.dataset.status = type;
    }

    function escapeHtml(value) {
        return window.CriptaApp.utils.escapeHtml(value);
    }

    function toCamel(id) {
        return id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    }
})();
