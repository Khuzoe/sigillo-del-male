(function () {
    const DATA_URL = '../assets/data/items.json';
    const DB_NAME = 'cripta-items-editor';
    const DB_VERSION = 1;
    const DB_STORE = 'file-handles';
    const ITEMS_HANDLE_KEY = 'items-json';
    const FILTER_STORAGE_KEY = 'cripta-items-editor-filters';
    const ITEM_IMAGE_PREFIX = 'img/items/';
    const TYPE_OPTIONS = [
        '',
        'Arma',
        'Armatura',
        'Anello',
        'Bacchetta',
        'Bastone',
        'Bottino',
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
        fileHandle: null
    };

    const els = {};

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        bindElements();
        restoreFilters();
        bindEvents();

        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            state.items = await response.json();
            if (!Array.isArray(state.items)) throw new Error('Formato items.json non valido.');
            state.selectedIndex = state.items.length ? 0 : -1;
            renderAll();
            const restoredHandle = await restoreLinkedJsonFile();
            setStatus(restoredHandle
                ? `${state.items.length} oggetti caricati. File collegato: ${restoredHandle.name}.`
                : `${state.items.length} oggetti caricati.`);
        } catch (error) {
            console.error('Errore caricamento oggetti:', error);
            setStatus('Impossibile caricare assets/data/items.json.', 'error');
        }
    }

    function bindElements() {
        [
            'editor-status',
            'add-item-btn',
            'duplicate-item-btn',
            'delete-item-btn',
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
            'json-output',
            'connect-json-btn',
            'save-json-btn',
            'copy-json-btn',
            'download-json-btn'
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
            renderAll();
            setStatus('Nuovo oggetto aggiunto.');
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

        els.connectJsonBtn?.addEventListener('click', connectJsonFile);
        els.saveJsonBtn?.addEventListener('click', saveJsonToFile);
        els.copyJsonBtn?.addEventListener('click', copyJson);
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
        renderFilters();
        renderTable();
        renderDetails();
        updateOutput({ commitActive: false });
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
            els.itemsTableBody.innerHTML = '<tr><td colspan="12">Nessun oggetto corrisponde ai filtri.</td></tr>';
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
                <td><input class="items-editor-input" data-field="icon" value="${escapeHtml(item.icon || '')}"></td>
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

        if (!item) {
            els.previewImage.removeAttribute('src');
            els.previewName.textContent = 'Nessun oggetto';
            els.previewMeta.textContent = 'Aggiungi o seleziona un oggetto.';
            fields.forEach((field) => { field.value = ''; });
            if (els.propertyList) els.propertyList.innerHTML = '';
            return;
        }

        updatePreview();
        const summaryField = els.detailForm.querySelector('[data-field="summary"]');
        if (summaryField) summaryField.value = item.summary || '';
        renderPropertiesEditor(item);
        const notesField = els.detailForm.querySelector('[data-field="notes"]');
        if (notesField) notesField.value = item.notes || '';
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
            <div class="items-property-row ${property.negative === true ? 'items-property-row--negative' : ''}" data-property-index="${index}">
                <div class="items-property-row-top">
                    <input class="items-editor-input" data-property-field="name" placeholder="Nome" value="${escapeHtml(property.name || '')}">
                    <input class="items-editor-input" data-property-field="charges" placeholder="Cariche" value="${escapeHtml(property.charges || '')}">
                    <button class="items-editor-btn items-editor-btn--danger" type="button" data-action="remove-property" title="Rimuovi proprietà">
                        <i class="fas fa-trash" aria-hidden="true"></i>
                    </button>
                </div>
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

    function updatePreview() {
        const item = getSelectedItem();
        if (!item) return;
        els.previewImage.src = `../assets/${item.image || 'img/ui/card.webp'}`;
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
                applyPickedImagePath(row, index, normalizeAssetPath({ name: handle.name }));
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

        applyPickedImagePath(row, index, normalizeAssetPath(target.files[0]));
    }

    function applyPickedImagePath(row, index, path) {
        const item = state.items[index];
        if (!row || !item || !path) return;

        writeItemField(item, 'image', path);
        state.selectedIndex = index;
        pruneItem(item);
        const pathInput = row.querySelector('[data-field="image"]');
        if (pathInput) pathInput.value = formatImagePathForEditor(path);
        updatePreview();
        updateOutput({ commitActive: false });
        setStatus(`Path immagine aggiornato: ${path}`);
    }

    function handleDetailInput(event) {
        const item = getSelectedItem();
        if (!item) return;
        const target = event.target;
        const field = target.dataset.field;
        const propertyField = target.dataset.propertyField;

        if (field) {
            writeItemField(item, field, target.value);
        } else if (propertyField) {
            const row = target.closest('[data-property-index]');
            const index = Number(row?.dataset.propertyIndex);
            if (!Number.isInteger(index)) return;
            item.properties = normalizeProperties(item.properties, { keepEmpty: true });
            if (!item.properties[index]) item.properties[index] = {};
            item.properties[index][propertyField] = (propertyField === 'negative' || propertyField === 'hidden')
                ? target.checked === true
                : String(target.value || '').trim();
            updatePreview();
            if (propertyField === 'negative' || propertyField === 'hidden') renderPropertiesEditor(item);
            updateOutput();
            setStatus('Modifiche non salvate esportate nel JSON.');
            return;
        }

        pruneItem(item);
        updatePreview();
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
                if (state.rarity !== 'all' && (item.rarity || '') !== state.rarity) return false;
                if (state.type !== 'all' && (item.type || '') !== state.type) return false;
                if (!query) return true;
                return normalizeSearch([
                    item.name,
                    item.type,
                    item.subtype,
                    item.rarity,
                    item.owner,
                    item.summary,
                    item.notes,
                    ...searchableProperties.flatMap((property) => [
                        property.name,
                        property.charges,
                        property.description
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
            image: 'img/items/nuovo_oggetto.webp',
            icon: 'fa-wand-sparkles',
            summary: '',
            properties: [],
            notes: ''
        };
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
        item[field] = String(value || '').trim() || undefined;
    }

    function pruneItem(item) {
        ['id', 'name', 'type', 'subtype', 'rarity', 'owner', 'status', 'icon', 'image', 'summary', 'notes'].forEach((key) => {
            if (item[key] === undefined || item[key] === '') delete item[key];
        });
        if (item.attunement !== true) delete item.attunement;
        if (item.unidentified !== true) delete item.unidentified;
        if (item.hidden !== true) delete item.hidden;
        item.properties = normalizeProperties(item.properties);
        if (item.properties.length === 0) delete item.properties;
    }

    function updateOutput({ commitActive = true } = {}) {
        if (commitActive) commitActiveTableField();
        const cleanItems = state.items.map((item) => {
            const copy = structuredCloneSafe(item);
            pruneItem(copy);
            return copy;
        });
        els.jsonOutput.value = `${JSON.stringify(cleanItems, null, 2)}\n`;
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
                if (property.hidden === true) normalized.hidden = true;
                if (normalized.name || normalized.charges || normalized.description) return normalized;
                return keepEmpty ? normalized : null;
            })
            .filter(Boolean);
    }

    function formatImagePathForEditor(value) {
        const path = String(value || '').trim().replace(/\\/g, '/');
        return path.startsWith(ITEM_IMAGE_PREFIX) ? path.slice(ITEM_IMAGE_PREFIX.length) : path;
    }

    function normalizeImagePathForData(value) {
        const path = String(value || '').trim().replace(/\\/g, '/');
        if (!path) return '';
        if (path.startsWith('assets/')) return path.slice('assets/'.length);
        if (path.startsWith('img/')) return path;
        return `${ITEM_IMAGE_PREFIX}${path}`;
    }

    function normalizeAssetPath(file) {
        const rawPath = String(file?.webkitRelativePath || file?.name || '').replace(/\\/g, '/');
        const assetsIndex = rawPath.indexOf('assets/');
        if (assetsIndex >= 0) return rawPath.slice(assetsIndex + 'assets/'.length);
        const itemsIndex = rawPath.indexOf('img/items/');
        if (itemsIndex >= 0) return rawPath.slice(itemsIndex);
        const imgIndex = rawPath.indexOf('img/');
        if (imgIndex >= 0) return rawPath.slice(imgIndex);
        return `${ITEM_IMAGE_PREFIX}${rawPath.split('/').pop()}`;
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
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function normalizeSearch(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function structuredCloneSafe(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function setStatus(message, type = 'info') {
        if (!els.editorStatus) return;
        els.editorStatus.textContent = message;
        els.editorStatus.dataset.status = type;
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

    function toCamel(id) {
        return id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    }
})();
