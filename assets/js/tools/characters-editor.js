(function () {
    const MEDIA_WORKER_URL = window.CriptaApp?.config?.workerOrigin || 'https://sigillo-api.khuzoe.workers.dev';
    const DATA_API_URL = () => window.CriptaApp?.urls?.api?.('api/data/characters') || `${MEDIA_WORKER_URL}/api/data/characters`;
    const DATA_URL = () => window.CriptaApp?.urls?.data?.('characters.json') || '../assets/data/characters.json';
    const TOKEN_KEY = 'discord_jwt';
    const PLACEHOLDER_IMAGE = 'assets/img/logo.webp';

    const state = {
        characters: [],
        selectedIndex: -1,
        query: '',
        loadedVersion: null,
        loadedSource: 'static'
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

    async function bootEditor() {
        const root = document.querySelector('.characters-editor-page');
        if (!root || root === initializedRoot) return;
        initializedRoot = root;
        bindElements();
        bindEvents();
        await loadData();
    }

    function bindElements() {
        [
            'editor-status',
            'character-list',
            'search-input',
            'add-character-btn',
            'save-json-btn',
            'export-json-btn',
            'delete-character-btn',
            'detail-title',
            'detail-form',
            'field-id',
            'field-name',
            'field-role',
            'field-category',
            'field-status',
            'field-quote',
            'field-idle',
            'field-avatar',
            'field-hover',
            'field-token',
            'idle-preview',
            'avatar-preview',
            'hover-preview',
            'token-preview',
            'blocks-list',
            'add-block-btn'
        ].forEach((id) => {
            els[toCamel(id)] = document.getElementById(id);
        });
    }

    function bindEvents() {
        els.searchInput?.addEventListener('input', () => {
            state.query = els.searchInput.value;
            renderList();
        });

        els.addCharacterBtn?.addEventListener('click', addCharacter);
        els.addBlockBtn?.addEventListener('click', addBlock);
        els.saveJsonBtn?.addEventListener('click', saveOnlineData);
        els.exportJsonBtn?.addEventListener('click', exportJson);
        els.deleteCharacterBtn?.addEventListener('click', deleteCharacter);

        els.detailForm?.addEventListener('input', (event) => {
            const character = getSelectedCharacter();
            if (!character) return;
            const field = event.target?.dataset?.field;
            const imageField = event.target?.dataset?.imageField;
            if (field) {
                character[field] = event.target.value;
                if (field === 'name') {
                    const nextId = slugify(event.target.value);
                    if (nextId && character.id !== nextId) {
                        character.id = nextId;
                        if (els.fieldId) els.fieldId.value = nextId;
                    }
                }
                if (field === 'id') character.id = slugify(event.target.value);
                renderList();
                renderHeader();
            }
            if (imageField) {
                character.images = character.images || {};
                character.images[imageField] = event.target.value;
                syncImagePreviews();
                renderList();
            }
        });

        els.detailForm?.addEventListener('click', async (event) => {
            const uploadTarget = event.target.closest('[data-upload-image]');
            if (uploadTarget) {
                event.preventDefault();
                await uploadCharacterImage(uploadTarget.dataset.uploadImage);
                return;
            }

            const blockAction = event.target.closest('[data-block-action]');
            if (!blockAction) return;
            event.preventDefault();
            handleBlockAction(blockAction.dataset.blockAction, Number(blockAction.dataset.blockIndex));
        });

        els.detailForm?.addEventListener('dragover', (event) => {
            const dropTarget = event.target.closest('[data-image-drop-target]');
            if (!dropTarget) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            dropTarget.classList.add('is-drop-target');
        });

        els.detailForm?.addEventListener('dragleave', (event) => {
            const dropTarget = event.target.closest('[data-image-drop-target]');
            if (!dropTarget || dropTarget.contains(event.relatedTarget)) return;
            dropTarget.classList.remove('is-drop-target');
        });

        els.detailForm?.addEventListener('drop', async (event) => {
            const dropTarget = event.target.closest('[data-image-drop-target]');
            if (!dropTarget) return;
            event.preventDefault();
            dropTarget.classList.remove('is-drop-target');
            await handleImageDrop(dropTarget.dataset.imageDropTarget, event.dataTransfer?.files);
        });

        els.detailForm?.addEventListener('change', (event) => {
            const blockIndex = Number(event.target?.dataset?.blockIndex);
            const blockField = event.target?.dataset?.blockField;
            if (!Number.isInteger(blockIndex) || !blockField) return;
            const block = getSelectedCharacter()?.blocks?.[blockIndex];
            if (!block) return;
            block[blockField] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
            if (blockField === 'title' && !block.id) block.id = slugify(event.target.value);
            renderBlocks();
        });

        els.detailForm?.addEventListener('input', (event) => {
            const blockIndex = Number(event.target?.dataset?.blockIndex);
            const blockField = event.target?.dataset?.blockField;
            if (!Number.isInteger(blockIndex) || !blockField) return;
            const block = getSelectedCharacter()?.blocks?.[blockIndex];
            if (!block) return;
            block[blockField] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
            updateBlockPreview(blockIndex);
        });
    }

    function resolveInitialSelectedIndex() {
        if (!state.characters.length) return -1;
        const requestedId = new URLSearchParams(window.location.search).get('id');
        if (!requestedId) return 0;
        const requestedIndex = state.characters.findIndex((character) => character.id === requestedId);
        return requestedIndex >= 0 ? requestedIndex : 0;
    }

    async function loadData() {
        try {
            const loaded = await loadCharactersData();
            state.characters = loaded.characters;
            state.loadedVersion = loaded.version ?? 0;
            state.loadedSource = loaded.source;
            state.selectedIndex = resolveInitialSelectedIndex();
            renderAll();
            setStatus(`${state.characters.length} NPC caricati da ${loaded.source === 'kv' ? 'KV online' : 'JSON statico'}.`);
        } catch (error) {
            console.error('Errore caricamento NPC:', error);
            setStatus('Impossibile caricare gli NPC.', 'error');
        }
    }

    async function loadCharactersData() {
        try {
            const response = await fetch(withCampaign(DATA_API_URL()));
            if (response.ok) {
                const payload = await response.json();
                if (Array.isArray(payload?.data)) {
                    return {
                        characters: normalizeCharacters(payload.data),
                        source: payload.source || 'kv',
                        version: Number(payload.version || 0)
                    };
                }
            }
        } catch (error) {
            console.warn('KV characters non disponibile, uso JSON statico.', error);
        }

        const response = await fetch(DATA_URL());
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const data = Array.isArray(payload) ? payload : payload?.data;
        if (!Array.isArray(data)) throw new Error('Formato characters.json non valido.');
        return { characters: normalizeCharacters(data), source: 'static', version: 0 };
    }

    function normalizeCharacters(characters) {
        return characters.map((character) => {
            const images = normalizeNpcImages(character);
            const id = slugify(character.id || character.name || 'npc');
            return {
                _originalId: id,
                id,
                name: character.name || 'Nuovo NPC',
                type: character.type || 'npc',
                role: character.role || '',
                category: character.category || '',
                status: character.status || 'ignoto',
                hidden: Boolean(character.hidden),
                quote: character.quote || '',
                images,
                blocks: normalizeBlocks(character.blocks || character.content_blocks || [])
            };
        });
    }

    function normalizeNpcImages(character) {
        const raw = character?.images || {};
        const avatar = raw.avatar || raw.portrait || PLACEHOLDER_IMAGE;
        const token = raw.token || raw.avatar || raw.portrait || PLACEHOLDER_IMAGE;
        return {
            idle: raw.idle || raw.card || raw.list || raw.showcase || raw.avatar || raw.portrait || raw.token || PLACEHOLDER_IMAGE,
            hover: raw.hover || raw.cardHover || raw.listHover || raw.showcaseHover || raw.token || raw.avatar || raw.portrait || PLACEHOLDER_IMAGE,
            token,
            avatar
        };
    }

    function getNpcImagePath(character, variant) {
        const characterId = slugify(character?.id || character?.name || 'npc');
        return `media/campaigns/${getCampaignId()}/characters/${characterId}/${variant}.webp`;
    }

    function ensureDefaultNpcListImagePaths(character) {
        if (!character || (character.type || 'npc') === 'player') return;
        character.images = character.images || {};
        if (!character.images.idle || character.images.idle === PLACEHOLDER_IMAGE) {
            character.images.idle = getNpcImagePath(character, 'idle');
        }
        if (!character.images.hover || character.images.hover === PLACEHOLDER_IMAGE) {
            character.images.hover = getNpcImagePath(character, 'hover');
        }
    }

    function getListImage(character) {
        return character?.images?.idle || character?.images?.token || character?.images?.avatar || PLACEHOLDER_IMAGE;
    }

    function normalizeBlocks(blocks) {
        return blocks.map((block, index) => ({
            id: slugify(block.id || block.title || `blocco-${index + 1}`),
            type: block.type === 'image_box' || block.image ? 'image' : 'text',
            title: block.title || 'Nuovo blocco',
            icon: block.icon || 'fa-book-open',
            image: block.image || '',
            hidden: Boolean(block.hidden),
            text: block.text || block.markdownText || block.content || ''
        }));
    }

    function renderAll() {
        renderList();
        renderDetail();
    }

    function renderList() {
        const query = normalizeSearch(state.query);
        const visible = state.characters
            .map((character, index) => ({ character, index }))
            .filter(({ character }) => !query || normalizeSearch(`${character.name} ${character.role} ${character.category}`).includes(query));

        els.characterList.innerHTML = visible.map(({ character, index }) => `
            <button class="characters-editor-list-btn ${index === state.selectedIndex ? 'is-active' : ''}" type="button" data-character-index="${index}">
                <img src="${resolveImageUrl(getListImage(character))}" alt="" onerror="this.style.display='none'">
                <span>
                    <span class="characters-editor-list-name">${escapeHtml(character.name)}</span>
                    <span class="characters-editor-list-role">${escapeHtml([character.role, character.category].filter(Boolean).join(' - ') || character.id)}</span>
                </span>
            </button>
        `).join('');

        els.characterList.querySelectorAll('[data-character-index]').forEach((button) => {
            button.addEventListener('click', () => {
                state.selectedIndex = Number(button.dataset.characterIndex);
                renderAll();
            });
        });
    }

    function renderDetail() {
        const character = getSelectedCharacter();
        const disabled = !character;
        els.detailForm?.querySelectorAll('input, textarea, select, button').forEach((node) => {
            node.disabled = disabled;
        });
        if (!character) {
            els.detailTitle.textContent = 'Nessun NPC';
            els.blocksList.innerHTML = '';
            return;
        }

        renderHeader();
        els.fieldId.value = character.id || '';
        els.fieldName.value = character.name || '';
        els.fieldRole.value = character.role || '';
        els.fieldCategory.value = character.category || '';
        els.fieldStatus.value = character.status || 'ignoto';
        els.fieldQuote.value = character.quote || '';
        els.fieldIdle.value = character.images?.idle || '';
        els.fieldAvatar.value = character.images?.avatar || '';
        els.fieldHover.value = character.images?.hover || '';
        els.fieldToken.value = character.images?.token || '';
        syncImagePreviews();
        renderBlocks();
    }

    function renderHeader() {
        const character = getSelectedCharacter();
        els.detailTitle.textContent = character ? character.name || character.id : 'Nessun NPC';
    }

    function renderBlocks() {
        const character = getSelectedCharacter();
        if (!character) return;
        character.blocks = Array.isArray(character.blocks) ? character.blocks : [];
        els.blocksList.innerHTML = character.blocks.map((block, index) => renderBlock(block, index)).join('');
    }

    function renderBlock(block, index) {
        const imageRow = block.type === 'image' ? `
            <div class="characters-editor-field characters-editor-field--full">
                <label>Immagine blocco</label>
                <div class="characters-editor-image-row">
                    <img class="characters-editor-preview" src="${resolveImageUrl(block.image || PLACEHOLDER_IMAGE)}" alt="" onerror="this.style.display='none'">
                    <input class="characters-editor-input" data-block-index="${index}" data-block-field="image" type="text" value="${escapeAttr(block.image || '')}">
                    <button class="characters-editor-btn" type="button" data-block-action="upload-image" data-block-index="${index}">
                        <i class="fas fa-image"></i> Upload
                    </button>
                </div>
            </div>
        ` : '';

        return `
            <article class="characters-editor-block">
                <div class="characters-editor-block-head">
                    <span class="characters-editor-block-title">${escapeHtml(block.title || `Blocco ${index + 1}`)}</span>
                    <span class="characters-editor-actions">
                        <button class="characters-editor-btn" type="button" data-block-action="up" data-block-index="${index}" title="Sposta su"><i class="fas fa-arrow-up"></i></button>
                        <button class="characters-editor-btn" type="button" data-block-action="down" data-block-index="${index}" title="Sposta giu"><i class="fas fa-arrow-down"></i></button>
                        <button class="characters-editor-btn characters-editor-btn--danger" type="button" data-block-action="delete" data-block-index="${index}" title="Elimina"><i class="fas fa-trash"></i></button>
                    </span>
                </div>
                <div class="characters-editor-block-body">
                    <div class="characters-editor-field">
                        <label>Titolo</label>
                        <input class="characters-editor-input" data-block-index="${index}" data-block-field="title" type="text" value="${escapeAttr(block.title || '')}">
                    </div>
                    <div class="characters-editor-field">
                        <label>Tipo</label>
                        <select class="characters-editor-select" data-block-index="${index}" data-block-field="type">
                            <option value="text"${block.type !== 'image' ? ' selected' : ''}>Testo</option>
                            <option value="image"${block.type === 'image' ? ' selected' : ''}>Testo + immagine</option>
                        </select>
                    </div>
                    <div class="characters-editor-field">
                        <label>ID blocco</label>
                        <input class="characters-editor-input" data-block-index="${index}" data-block-field="id" type="text" value="${escapeAttr(block.id || '')}">
                    </div>
                    <label class="characters-editor-check characters-editor-field--full">
                        <input data-block-index="${index}" data-block-field="hidden" type="checkbox"${block.hidden ? ' checked' : ''}>
                        <span>Nascondi questo blocco ai giocatori</span>
                    </label>
                    ${imageRow}
                    <textarea class="characters-editor-area" data-block-index="${index}" data-block-field="text" spellcheck="true">${escapeHtml(block.text || '')}</textarea>
                    <div class="characters-editor-live-preview characters-editor-field--full" data-block-preview="${index}">
                        ${renderBlockPreview(block)}
                    </div>
                </div>
            </article>
        `;
    }

    function updateBlockPreview(index) {
        const character = getSelectedCharacter();
        const block = character?.blocks?.[index];
        if (!block) return;
        const previewNode = els.blocksList?.querySelector(`[data-block-preview="${index}"]`);
        if (previewNode) previewNode.innerHTML = renderBlockPreview(block);
        const headingNode = previewNode?.closest('.characters-editor-block')?.querySelector('.characters-editor-block-title');
        if (headingNode) headingNode.textContent = block.title || `Blocco ${index + 1}`;
    }

    function renderBlockPreview(block) {
        const title = escapeHtml(block.title || 'Informazioni');
        const icon = escapeAttr(block.icon || 'fa-book-open');
        const body = renderMarkdownPreview(block.text || '');
        if (block.type === 'image') {
            const imageHtml = block.image
                ? `<div class="document-image"><img src="${resolveImageUrl(block.image)}" alt="${title}" onerror="this.style.display='none'"></div>`
                : '<div class="document-image document-image--empty">Nessuna immagine</div>';
            return `
                <span class="characters-editor-preview-label">Anteprima finale</span>
                <div class="content-card document-card characters-editor-preview-card">
                    <div class="document-header">
                        <div class="doc-label"><i class="fas ${icon}"></i> ${title}</div>
                    </div>
                    <div class="document-body">
                        ${imageHtml}
                        <div class="document-content">
                            <div class="chapter-content chapter-content--compact">${body}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <span class="characters-editor-preview-label">Anteprima finale</span>
            <div class="content-card characters-editor-preview-card">
                <h3><i class="fas ${icon}"></i> ${title}</h3>
                <div class="chapter-content">${body}</div>
            </div>
        `;
    }

    function renderMarkdownPreview(text) {
        const source = String(text || '').trim();
        if (!source) return '<p class="characters-editor-empty-preview">Scrivi il contenuto del blocco...</p>';
        return source
            .split(/\n{2,}/)
            .map((paragraph) => {
                const inline = escapeHtml(paragraph.trim())
                    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
                    .replace(/\n/g, '<br>');
                return `<p>${inline}</p>`;
            })
            .join('');
    }

    function addCharacter() {
        const id = uniqueId('nuovo-npc', state.characters.map((item) => item.id));
        state.characters.push({
            id,
            name: 'Nuovo NPC',
            type: 'npc',
            role: '',
            category: '',
            status: 'ignoto',
            hidden: false,
            quote: '',
            images: { idle: PLACEHOLDER_IMAGE, hover: PLACEHOLDER_IMAGE, token: PLACEHOLDER_IMAGE, avatar: PLACEHOLDER_IMAGE },
            blocks: []
        });
        state.selectedIndex = state.characters.length - 1;
        renderAll();
        setStatus('Nuovo NPC creato localmente. Salva online per pubblicarlo.');
    }

    function deleteCharacter() {
        const character = getSelectedCharacter();
        if (!character) return;
        if (!window.confirm(`Eliminare ${character.name || character.id}?`)) return;
        state.characters.splice(state.selectedIndex, 1);
        state.selectedIndex = Math.min(state.selectedIndex, state.characters.length - 1);
        renderAll();
    }

    function addBlock() {
        const character = getSelectedCharacter();
        if (!character) return;
        character.blocks = Array.isArray(character.blocks) ? character.blocks : [];
        character.blocks.push({
            id: uniqueId('nuovo-blocco', character.blocks.map((block) => block.id)),
            type: 'text',
            title: 'Nuovo blocco',
            icon: 'fa-book-open',
            image: '',
            text: ''
        });
        renderBlocks();
    }

    function handleBlockAction(action, index) {
        const character = getSelectedCharacter();
        const blocks = character?.blocks;
        if (!Array.isArray(blocks) || !blocks[index]) return;
        if (action === 'delete') {
            blocks.splice(index, 1);
        } else if (action === 'up' && index > 0) {
            [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]];
        } else if (action === 'down' && index < blocks.length - 1) {
            [blocks[index + 1], blocks[index]] = [blocks[index], blocks[index + 1]];
        } else if (action === 'upload-image') {
            uploadBlockImage(index);
            return;
        }
        renderBlocks();
    }

    async function saveOnlineData() {
        const token = readAuthToken();
        if (!token) {
            setStatus('Login richiesto: accedi come admin prima di salvare online.', 'error');
            return;
        }

        try {
            setStatus('Sincronizzazione cartelle R2 in corso...');
            await migrateRenamedCharacterMedia(token);
            setStatus('Salvataggio online in corso...');
            const serialized = serializeCharacters();
            const response = await fetch(withCampaign(DATA_API_URL(), { force: true }), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    data: serialized,
                    expectedVersion: state.loadedSource === 'kv' ? (state.loadedVersion ?? 0) : 0,
                    campaignId: getCampaignId()
                })
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
            state.loadedVersion = payload.version ?? state.loadedVersion;
            state.loadedSource = 'kv';
            state.characters.forEach((character) => {
                character._originalId = slugify(character.id || character.name || 'npc');
            });
            setStatus(`Salvato online. Versione ${state.loadedVersion}.`);
        } catch (error) {
            console.error('Salvataggio characters fallito:', error);
            setStatus(`Salvataggio fallito: ${error?.message || error}`, 'error');
        }
    }

    function serializeCharacters() {
        return state.characters.map((character) => ({
            id: slugify(character.id || character.name),
            name: character.name || 'NPC senza nome',
            type: character.type || 'npc',
            role: character.role || '',
            category: character.category || '',
            status: character.status || 'ignoto',
            hidden: Boolean(character.hidden),
            quote: character.quote || '',
            images: {
                idle: character.images?.idle || character.images?.token || PLACEHOLDER_IMAGE,
                hover: character.images?.hover || character.images?.token || PLACEHOLDER_IMAGE,
                token: character.images?.token || character.images?.idle || PLACEHOLDER_IMAGE,
                avatar: character.images?.avatar || character.images?.token || PLACEHOLDER_IMAGE
            },
            blocks: (character.blocks || []).map((block) => ({
                id: slugify(block.id || block.title || 'blocco'),
                type: block.type === 'image' ? 'image' : 'text',
                title: block.title || 'Informazioni',
                icon: block.icon || 'fa-book-open',
                image: block.type === 'image' ? (block.image || '') : '',
                hidden: Boolean(block.hidden),
                text: block.text || ''
            }))
        }));
    }

    async function migrateRenamedCharacterMedia(token = readAuthToken()) {
        for (const character of state.characters) {
            const fromId = slugify(character._originalId || character.id || character.name || 'npc');
            const toId = slugify(character.id || character.name || 'npc');
            if (!fromId || !toId || fromId === toId) continue;
            await copyCharacterMediaFolder(fromId, toId, token);
            rewriteCharacterMediaFolderPaths(character, fromId, toId);
        }
    }

    async function copyCharacterMediaFolder(fromId, toId, token = readAuthToken()) {
        if (!token) throw new Error('Login richiesto per rinominare media NPC.');
        const response = await fetch(withCampaign(`${MEDIA_WORKER_URL}/media/copy-folder`, { force: true }), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                campaignId: getCampaignId(),
                fromFolder: `characters/${fromId}`,
                toFolder: `characters/${toId}`
            })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.error || `HTTP ${response.status}`);
        }
        return payload;
    }

    function rewriteCharacterMediaFolderPaths(character, fromId, toId) {
        const rewrite = (value) => rewriteNpcMediaPath(value, fromId, toId);
        character.images = rewriteObjectStringValues(character.images || {}, rewrite);
        character.blocks = (character.blocks || []).map((block) => ({
            ...block,
            image: rewrite(block.image)
        }));
    }

    function rewriteObjectStringValues(source, rewrite) {
        return Object.fromEntries(Object.entries(source || {}).map(([key, value]) => [
            key,
            typeof value === 'string' ? rewrite(value) : value
        ]));
    }

    function rewriteNpcMediaPath(value, fromId, toId) {
        const raw = String(value || '');
        if (!raw) return raw;
        const campaignId = getCampaignId();
        const scopedFrom = `media/campaigns/${campaignId}/characters/${fromId}/`;
        const scopedTo = `media/campaigns/${campaignId}/characters/${toId}/`;
        if (raw.startsWith(scopedFrom)) return `${scopedTo}${raw.slice(scopedFrom.length)}`;
        const legacyFrom = `media/characters/${fromId}/`;
        if (raw.startsWith(legacyFrom)) return `${scopedTo}${raw.slice(legacyFrom.length)}`;
        return raw;
    }

    function exportJson() {
        const doc = {
            version: state.loadedVersion || 1,
            collection: 'characters',
            campaignId: getCampaignId(),
            data: serializeCharacters()
        };
        const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `characters-${getCampaignId()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function uploadCharacterImage(field) {
        const character = getSelectedCharacter();
        if (!character) return;
        const file = await pickImageFile();
        if (!file) return;
        const fileName = `${field}.webp`;
        const path = await uploadImageFile(file, character.id, fileName);
        if (!path) return;
        character.images = character.images || {};
        character.images[field] = path;
        if (field === 'avatar' || field === 'token') ensureDefaultNpcListImagePaths(character);
        renderDetail();
    }

    async function handleImageDrop(field, fileList) {
        const files = Array.from(fileList || []).filter((file) => file?.type?.startsWith('image/'));
        if (!field || !files.length) return;
        if (field === 'avatar' && files.length === 2) {
            await handleAvatarTokenDrop(files);
            return;
        }
        await uploadDroppedCharacterImage(field, files[0]);
    }

    async function uploadDroppedCharacterImage(field, file) {
        const character = getSelectedCharacter();
        if (!character || !file) return;
        const path = await uploadImageFile(file, character.id, `${field}.webp`);
        if (!path) return;
        character.images = character.images || {};
        character.images[field] = path;
        if (field === 'avatar' || field === 'token') ensureDefaultNpcListImagePaths(character);
        renderDetail();
        setStatus(`${field}.webp aggiornato dall'immagine trascinata.`);
    }

    async function handleAvatarTokenDrop(fileList) {
        const character = getSelectedCharacter();
        const files = Array.from(fileList || []).filter((file) => file?.type?.startsWith('image/'));
        if (!character || files.length !== 2) return;

        try {
            setStatus('Analisi immagini avatar/token...');
            const assignment = await assignAvatarAndTokenFiles(files);
            const avatarPath = await uploadImageFile(assignment.avatar.file, character.id, 'avatar.webp');
            const tokenPath = await uploadImageFile(assignment.token.file, character.id, 'token.webp');
            if (!avatarPath || !tokenPath) return;
            character.images = character.images || {};
            character.images.avatar = avatarPath;
            character.images.token = tokenPath;
            ensureDefaultNpcListImagePaths(character);
            renderDetail();
            setStatus('Avatar e token aggiornati dalle immagini trascinate.');
        } catch (error) {
            console.error('Drop avatar/token fallito:', error);
            setStatus(`Drop avatar/token fallito: ${error?.message || error}`, 'error');
        }
    }

    async function assignAvatarAndTokenFiles(files) {
        const analyzed = await Promise.all(files.map(async (file) => {
            const dimensions = await readImageDimensions(file);
            const area = dimensions.width * dimensions.height;
            const squareDelta = Math.abs(dimensions.width - dimensions.height) / Math.max(dimensions.width, dimensions.height, 1);
            return { file, ...dimensions, area, squareDelta };
        }));
        analyzed.sort((left, right) => {
            const squareSort = left.squareDelta - right.squareDelta;
            if (Math.abs(squareSort) > 0.04) return squareSort;
            return left.area - right.area;
        });
        const token = analyzed[0];
        const avatar = analyzed[1];
        return { avatar, token };
    }

    async function readImageDimensions(file) {
        const bitmap = await createImageBitmap(file);
        const dimensions = { width: bitmap.width, height: bitmap.height };
        bitmap.close?.();
        return dimensions;
    }

    async function uploadBlockImage(index) {
        const character = getSelectedCharacter();
        const block = character?.blocks?.[index];
        if (!character || !block) return;
        const file = await pickImageFile();
        if (!file) return;
        const fileName = `${slugify(block.id || block.title || `blocco-${index + 1}`)}.webp`;
        const path = await uploadImageFile(file, character.id, fileName);
        if (!path) return;
        block.image = path;
        block.type = 'image';
        renderBlocks();
    }

    async function pickImageFile() {
        if (window.showOpenFilePicker) {
            const [handle] = await window.showOpenFilePicker({
                multiple: false,
                types: [{ description: 'Immagini', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'] } }]
            }).catch(() => []);
            return handle ? handle.getFile() : null;
        }
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
            input.click();
        });
    }

    async function uploadImageFile(file, characterId, fileName) {
        const token = readAuthToken();
        if (!token) {
            setStatus('Login richiesto per caricare immagini.', 'error');
            return '';
        }

        try {
            setStatus(/\.webp$/i.test(file.name) ? 'Upload immagine su R2...' : 'Conversione WebP e upload su R2...');
            const blob = /\.webp$/i.test(file.name) ? file : await convertImageFileToWebpBlob(file);
            const path = await uploadImageBlob(blob, characterId, fileName, token);
            setStatus('Immagine caricata su R2.');
            return path;
        } catch (error) {
            console.error('Upload immagine fallito:', error);
            setStatus(`Upload immagine fallito: ${error?.message || error}`, 'error');
            return '';
        }
    }

    async function uploadImageBlob(blob, characterId, fileName, token = readAuthToken()) {
        if (!token) throw new Error('Login richiesto per caricare immagini.');
        const folder = `characters/${slugify(characterId || 'npc')}`;
        const form = new FormData();
        form.set('folder', folder);
        form.set('filename', fileName);
        form.set('campaignId', getCampaignId());
        form.set('file', new File([blob], fileName, { type: 'image/webp' }));

        const response = await fetch(withCampaign(`${MEDIA_WORKER_URL}/media/upload?folder=${encodeURIComponent(folder)}`, { force: true }), {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
        validateUploadPayload(payload, blob, fileName);
        return payload.path || payload.key || `media/campaigns/${getCampaignId()}/${folder}/${fileName}`;
    }

    function validateUploadPayload(payload, blob, fileName = 'media.webp') {
        const expectedSize = Number(blob?.size || 0);
        const storedSize = Number(payload?.storedSize || payload?.size || 0);
        if (expectedSize > 0 && storedSize > 0 && expectedSize !== storedSize) {
            throw new Error(`Upload R2 non coerente per ${fileName}: inviati ${expectedSize} byte, salvati ${storedSize} byte.`);
        }
        if (!payload?.key && !payload?.path) throw new Error(`Upload R2 senza path/key per ${fileName}.`);
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

    function syncImagePreviews() {
        const character = getSelectedCharacter();
        if (!character) return;
        els.idlePreview.src = resolveImageUrl(character.images?.idle || character.images?.token || PLACEHOLDER_IMAGE);
        els.hoverPreview.src = resolveImageUrl(character.images?.hover || character.images?.token || PLACEHOLDER_IMAGE);
        els.tokenPreview.src = resolveImageUrl(character.images?.token || PLACEHOLDER_IMAGE);
        els.avatarPreview.src = resolveImageUrl(character.images?.avatar || character.images?.token || PLACEHOLDER_IMAGE);
    }

    function getSelectedCharacter() {
        return state.characters[state.selectedIndex] || null;
    }

    function setStatus(message, type = 'info') {
        if (!els.editorStatus) return;
        els.editorStatus.textContent = message;
        els.editorStatus.dataset.status = type;
    }

    function readAuthToken() {
        try {
            return window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY) || '';
        } catch (_) {
            return '';
        }
    }

    function getCampaignId() {
        return window.CriptaApp?.campaigns?.currentId?.() || new URLSearchParams(window.location.search).get('campaign') || 'cripta-di-sangue';
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
        if (!value) return '../assets/img/logo.webp';
        if (/^(https?:|data:|blob:)/i.test(value)) return value;
        if (value.startsWith('media/')) return `${MEDIA_WORKER_URL}/${value}`;
        if (value.startsWith('/media/')) return `${MEDIA_WORKER_URL}${value}`;
        if (value.startsWith('assets/')) return `../${value}`;
        return `../assets/${value}`;
    }

    function slugify(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/['’]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'npc';
    }

    function uniqueId(base, existing) {
        const used = new Set(existing.filter(Boolean));
        let id = slugify(base);
        let index = 2;
        while (used.has(id)) id = `${slugify(base)}-${index++}`;
        return id;
    }

    function normalizeSearch(value) {
        return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/'/g, '&#39;');
    }

    function toCamel(id) {
        return id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    }
})();
