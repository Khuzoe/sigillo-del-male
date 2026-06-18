/* MAPPA IMMAGINI (Cache) */
        const characterImages = {};
        const characterImageMeta = {};
        const questState = {
            groups: [],
            source: 'static',
            version: 0,
            canEdit: false,
            saving: false,
            editing: null
        };

        const QUEST_STATUS_OPTIONS = [
            ['active', 'Attiva'],
            ['in_progress', 'In corso'],
            ['completed', 'Completata'],
            ['failed', 'Fallita'],
            ['hidden', 'Nascosta']
        ];

        function escapeHtml(value) {
            if (typeof window.CriptaApp?.utils?.escapeHtml === 'function') {
                return window.CriptaApp.utils.escapeHtml(value);
            }
            return String(value ?? '').replace(/[&<>"']/g, char => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            })[char]);
        }

        function cloneQuestData(data) {
            try {
                return structuredClone(data);
            } catch (_) {
                return JSON.parse(JSON.stringify(data || null));
            }
        }

        function siteUrl(path) {
            const cleanPath = String(path || '').replace(/^\/+/, '');
            if (cleanPath.startsWith('assets/data/') && typeof window.CriptaApp?.urls?.data === 'function') {
                return window.CriptaApp.urls.data(cleanPath.replace(/^assets\/data\//, ''));
            }
            if (typeof window.CriptaApp?.urls?.site === 'function') {
                return window.CriptaApp.urls.site(cleanPath);
            }
            return new URL(`../${cleanPath}`, window.location.href).toString();
        }

        function getSyncedNpcImagePath(npcId, variant = 'hover') {
            return window.CriptaCharacterNormalize.getSyncedNpcImagePath(npcId, variant);
        }

        function getSyncedPlayerImagePath(player, variant = 'avatar') {
            return window.CriptaCharacterNormalize.getSyncedPlayerImagePath(player, variant);
        }

        function slugifyQuestValue(value, fallback = 'missione') {
            if (typeof window.CriptaApp?.utils?.slugify === 'function') {
                return window.CriptaApp.utils.slugify(value, fallback);
            }
            const slug = String(value || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
            return slug || fallback;
        }

        function createUniqueQuestGroupId(seed, excludingIndex = -1) {
            const base = `${slugifyQuestValue(seed, 'missione')}_quests`;
            const used = new Set(
                questState.groups
                    .map((group, index) => (index === excludingIndex ? '' : String(group?.id || '').trim()))
                    .filter(Boolean)
            );
            if (!used.has(base)) return base;
            let counter = 2;
            let candidate = `${base}-${counter}`;
            while (used.has(candidate)) {
                counter += 1;
                candidate = `${base}-${counter}`;
            }
            return candidate;
        }

        // Funzione helper per parsare YAML (molto semplificata, solo per estrarre immagini)
        function extractImagesFromYaml(yamlText) {
            const avatarMatch = yamlText.match(/avatar:\s*["']?([^"'\n]+)["']?/);
            return avatarMatch ? avatarMatch[1] : null;
        }
        function isHiddenFromYaml(yamlText) {
            // Match only top-level "hidden: true" (no indentation),
            // so nested fields like content_blocks[].hidden don't hide the whole NPC.
            return /^hidden:\s*true\b/im.test(yamlText || '');
        }

        async function fetchCampaignJson(pathname, fallback) {
            try {
                if (typeof window.CriptaApp?.data?.json === 'function') {
                    return await window.CriptaApp.data.json(pathname);
                }
                return await window.CriptaApp.fetchJson(siteUrl(`assets/data/${pathname}`), { clone: true });
            } catch (error) {
                console.warn(`Impossibile caricare ${pathname}:`, error);
                return fallback;
            }
        }

        async function loadQuestsDocument(options = {}) {
            try {
                if (typeof window.CriptaApp?.api?.get === 'function') {
                    const payload = await window.CriptaApp.api.get('api/data/quests', {
                        query: options.force ? { _: Date.now() } : undefined
                    });
                    if (Array.isArray(payload?.data)) {
                        return {
                            data: payload.data,
                            source: payload.source || 'kv',
                            version: Number(payload.version || 0)
                        };
                    }
                }
            } catch (error) {
                console.warn('KV quests non disponibile, uso JSON statico.', error);
            }

            const payload = await fetchCampaignJson('quests.json', []);
            const data = Array.isArray(payload) ? payload : payload?.data || [];
            return { data, source: 'static', version: 0 };
        }

        async function resolveCanEditQuests() {
            try {
                if (typeof window.CriptaDiscordAuth?.isCurrentUserDm !== 'function') return false;
                return await window.CriptaDiscordAuth.isCurrentUserDm(window.CriptaBasePath || '');
            } catch (_) {
                return false;
            }
        }

        function readQuestAuthToken() {
            return String(window.CriptaDiscordAuth?.getToken?.() || window.CriptaApp?.auth?.getToken?.() || '').trim();
        }

        async function saveQuestsToKv() {
            if (questState.saving) return;
            const token = readQuestAuthToken();
            if (!token) throw new Error('Login richiesto per salvare le missioni.');

            questState.saving = true;
            updateQuestStatus('Salvataggio...');
            try {
                const body = {
                    data: questState.groups,
                    campaignId: window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue',
                    expectedVersion: questState.source === 'kv' ? questState.version : 0
                };
                const result = await window.CriptaApp.api.post('api/data/quests', body, { token });
                questState.source = 'kv';
                questState.version = Number(result?.version || questState.version || 0);
                window.CriptaApp?.api?.clearCache?.('api/data/quests');
                updateQuestStatus('Missioni salvate.');
            } finally {
                questState.saving = false;
            }
        }

        async function loadLegacyNpcAssets() {
            const respIndex = await fetch(siteUrl('assets/data/characters/index.yaml'));
            if (!respIndex.ok) return;
            const text = await respIndex.text();
            const lines = text.split('\n');
            const entries = [];
            let currentId = null;

            for (const line of lines) {
                const idMatch = line.match(/- id:\s*["']?([^"']+)["']?/);
                if (idMatch) currentId = idMatch[1];
                const fileMatch = line.match(/file:\s*["']?([^"']+)["']?/);
                if (currentId && fileMatch) {
                    entries.push({ id: currentId, file: fileMatch[1] });
                    currentId = null;
                }
            }

            await Promise.all(entries.map(async (entry) => {
                try {
                    const response = await fetch(siteUrl(`assets/data/${entry.file}`));
                    if (!response.ok) return;
                    const text = await response.text();
                    if (window.WikiSpoiler && !window.WikiSpoiler.allowSpoilers() && isHiddenFromYaml(text)) return;
                    const img = extractImagesFromYaml(text);
                    characterImages[entry.id] = getSyncedNpcImagePath(entry.id, 'hover');
                    characterImageMeta[entry.id] = { type: 'npc', fallback: getSyncedNpcImagePath(entry.id, 'token'), legacyFallback: img || '' };
                } catch (_) {
                    console.warn("Failed to load generic NPC", entry.id);
                }
            }));
        }

        // Carica dati giocatori e NPC per le immagini
        async function loadCharacterAssets() {
            try {
                Object.keys(characterImages).forEach(key => delete characterImages[key]);
                Object.keys(characterImageMeta).forEach(key => delete characterImageMeta[key]);

                const playersPayload = await fetchCampaignJson('players.json', []);
                const players = Array.isArray(playersPayload) ? playersPayload : playersPayload?.data || [];
                players.forEach((player) => {
                    const id = String(player?.id || '').trim();
                    if (!id) return;
                    characterImages[id] = getSyncedPlayerImagePath({ ...player, type: 'player' }, 'avatar');
                    characterImageMeta[id] = {
                        type: 'player',
                        fallback: getSyncedPlayerImagePath({ ...player, type: 'player' }, 'token'),
                        legacyFallback: player?.images?.avatar || player?.avatar || ''
                    };
                });

                const charactersPayload = await fetchCampaignJson('characters.json', null);
                const characters = Array.isArray(charactersPayload) ? charactersPayload : charactersPayload?.data || [];
                if (characters.length) {
                    characters
                        .filter((character) => !window.WikiSpoiler || window.WikiSpoiler.isVisible(character))
                        .forEach((character) => {
                            const id = String(character?.id || '').trim();
                            if (!id) return;
                            const images = character.images || {};
                            characterImages[id] = getSyncedNpcImagePath(id, 'hover');
                            characterImageMeta[id] = {
                                type: 'npc',
                                fallback: getSyncedNpcImagePath(id, 'token'),
                                legacyFallback: images.hover || images.avatar || character.avatar || ''
                            };
                        });
                } else {
                    await loadLegacyNpcAssets();
                }

            } catch (e) {
                console.warn("Errore caricamento assets personaggi:", e);
            }
        }

        function resolveImagePath(path) {
            return window.CriptaApp.utils.resolveImageUrl(path);
        }

        function buildImageFallbackHandler(fallbackPath, legacyFallbackPath = '') {
            const fallbackUrl = resolveImagePath(fallbackPath);
            const legacyFallbackUrl = resolveImagePath(legacyFallbackPath);
            const escaped = fallbackUrl.replace(/'/g, "\\'");
            const escapedLegacy = legacyFallbackUrl.replace(/'/g, "\\'");
            if (!escaped && !escapedLegacy) return '';
            return ` data-fallback-src="${escaped}" data-legacy-fallback-src="${escapedLegacy}" onerror="if(this.dataset.fallbackSrc){this.src=this.dataset.fallbackSrc;this.dataset.fallbackSrc='';}else if(this.dataset.legacyFallbackSrc){this.src=this.dataset.legacyFallbackSrc;this.dataset.legacyFallbackSrc='';}else{this.style.display='none';}"`;
        }

        async function loadNpcRecencyMap() {
            try {
                const payload = await fetchCampaignJson('npc-recency.json', { items: [] });
                const map = {};
                (payload.items || []).forEach(item => {
                    if (item && item.id) map[item.id] = item;
                });
                return map;
            } catch (error) {
                console.warn("Impossibile caricare npc-recency.json:", error);
                return {};
            }
        }

        function sortQuestGroups(groups, recencyMap) {
            const list = Array.isArray(groups) ? [...groups] : [];
            const parseOrderSlot = (value) => {
                if (value === null || value === undefined || value === '') return null;
                const slot = Number(value);
                return Number.isInteger(slot) && slot > 0 ? slot : null;
            };
            const mainGroups = list.filter((group) => group.id === 'main_quest');
            const secondaryGroups = list.filter((group) => group.id !== 'main_quest');

            const recencySort = (aMeta, bMeta) => {
                if (aMeta.lastMentionSessionId !== bMeta.lastMentionSessionId) {
                    return bMeta.lastMentionSessionId - aMeta.lastMentionSessionId;
                }
                if (aMeta.mentions !== bMeta.mentions) {
                    return bMeta.mentions - aMeta.mentions;
                }
                return String(aMeta.group.title || aMeta.group.id || '').localeCompare(
                    String(bMeta.group.title || bMeta.group.id || ''),
                    'it'
                );
            };

            const metas = secondaryGroups.map((group) => {
                const recency = group.npc_id ? (recencyMap[group.npc_id] || {}) : {};
                return {
                    group,
                    slot: parseOrderSlot(recency.order_slot),
                    lastMentionSessionId: Number.isFinite(Number(recency.lastMentionSessionId)) ? Number(recency.lastMentionSessionId) : -1,
                    mentions: Number.isFinite(Number(recency.mentions)) ? Number(recency.mentions) : 0,
                };
            });

            const unpinned = metas.filter((meta) => meta.slot === null).sort(recencySort);
            const pinned = metas.filter((meta) => meta.slot !== null).sort((a, b) => {
                if (a.slot !== b.slot) return a.slot - b.slot;
                return recencySort(a, b);
            });

            const orderedSecondary = unpinned.map((meta) => meta.group);
            pinned.forEach((meta) => {
                const insertIndex = Math.max(0, Math.min(meta.slot - 1, orderedSecondary.length));
                orderedSecondary.splice(insertIndex, 0, meta.group);
            });

            return [...mainGroups, ...orderedSecondary];
        }

        // Script per l'apertura/chiusura a fisarmonica (Accordion)
        function toggleQuest(header) {
            const card = header.parentElement;
            const body = card.querySelector('.quest-body');
            const isExpanded = card.classList.contains('expanded');

            if (isExpanded) {
                // Chiudi
                body.style.maxHeight = body.scrollHeight + 'px'; // Imposta altezza fissa prima di chiudere per transizione fluida
                requestAnimationFrame(() => {
                    body.style.maxHeight = '0px';
                    card.classList.remove('expanded');
                });
            } else {
                // Apri
                card.classList.add('expanded');
                body.style.maxHeight = body.scrollHeight + 'px';

                // Rimuovi max-height alla fine della transizione per permettere resize dinamico
                setTimeout(() => {
                    if (card.classList.contains('expanded')) {
                        body.style.maxHeight = 'none';
                    }
                }, 500);
            }
        }

        // Renderizza una subquest (o un obiettivo semplice)
        function createObjectiveHtml(quest, groupIndex, path = []) {
            if (window.WikiSpoiler && !window.WikiSpoiler.isVisible(quest)) return '';
            if (!window.WikiSpoiler && quest.status === 'hidden') return '';

            const isDone = quest.status === 'completed';
            const hasSubquests = quest.subquests && quest.subquests.length > 0;
            const pathValue = path.join('.');

            // Icona specifica personaggio
            let charIconHtml = '';
            if (quest.character_specific && characterImages[quest.character_specific]) {
                const imgPath = resolveImagePath(characterImages[quest.character_specific]);
                const fallback = characterImageMeta[quest.character_specific]?.fallback || '';
                const legacyFallback = characterImageMeta[quest.character_specific]?.legacyFallback || '';
                charIconHtml = `<img src="${escapeHtml(imgPath)}" class="quest-char-icon-small" title="Esclusiva per ${escapeHtml(quest.character_specific)}" alt="${escapeHtml(quest.character_specific)}" loading="lazy" decoding="async"${buildImageFallbackHandler(fallback, legacyFallback)}>`;
            }

            let html = `
                <li class="objective-item ${isDone ? 'done' : ''} ${hasSubquests ? 'has-subquests' : ''}" data-quest-path="${escapeHtml(pathValue)}">
                    ${hasSubquests ? '' : `<button type="button" class="custom-checkbox" data-quest-action="toggle-objective" data-quest-group-index="${groupIndex}" data-quest-path="${escapeHtml(pathValue)}" ${questState.canEdit ? '' : 'disabled'} title="${questState.canEdit ? 'Cambia stato obiettivo' : ''}"></button>`}
                    <div class="objective-content">
                        <span class="objective-text">
                            ${charIconHtml}
                            ${escapeHtml(quest.title || 'Obiettivo')}
                        </span>
            `;

            if (quest.rewards) {
                html += `<div class="objective-reward"><i class="fas fa-gift"></i> ${escapeHtml(quest.rewards)}</div>`;
            }

            if (hasSubquests) {
                html += '<ul class="subquest-list">';
                quest.subquests.forEach((sub, subIndex) => {
                    html += createObjectiveHtml(sub, groupIndex, [...path, subIndex]);
                });
                html += '</ul>';
            }

            html += `
                    </div>
                </li>
            `;
            return html;
        }

        // Funzione per generare l'HTML di una singola card (Gruppo di Quest)
        function createQuestGroupCard(group, groupIndex) {
            if (window.WikiSpoiler && !window.WikiSpoiler.isVisible(group)) return null;
            const groupQuests = Array.isArray(group.quests) ? group.quests : [];
            // Filtra quest nascoste per il conteggio
            const visibleQuests = groupQuests.filter(q =>
                window.WikiSpoiler ? window.WikiSpoiler.isVisible(q) : q.status !== 'hidden'
            );
            if (visibleQuests.length === 0 && groupQuests.length > 0) return null;

            const total = visibleQuests.length;
            const completed = visibleQuests.filter(q => q.status === 'completed').length;
            const progress = total > 0 ? (completed / total) * 100 : 0;

            let groupStatus = 'active';
            if (total > 0 && completed === total) groupStatus = 'completed';

            const objectivesHtml = groupQuests
                .map((q, objectiveIndex) => (
                    (window.WikiSpoiler ? window.WikiSpoiler.isVisible(q) : q.status !== 'hidden')
                        ? createObjectiveHtml(q, groupIndex, [objectiveIndex])
                        : ''
                ))
                .join('');

            const statusMap = {
                active: { text: 'In Corso', class: 'status-active' },
                completed: { text: 'Completata', class: 'status-completed' },
                failed: { text: 'Fallita', class: 'status-failed' }
            };
            const statusInfo = statusMap[groupStatus] || { text: 'Ignoto', class: '' };

            // NPC Avatar Logic
            let npcAvatarHtml = '';
            if (group.npc_id && characterImages[group.npc_id]) {
                const fallback = characterImageMeta[group.npc_id]?.fallback || '';
                const legacyFallback = characterImageMeta[group.npc_id]?.legacyFallback || '';
                npcAvatarHtml = `
                    <div class="quest-npc-avatar">
                        <img src="${escapeHtml(resolveImagePath(characterImages[group.npc_id]))}" alt="${escapeHtml(group.title)}" loading="lazy" decoding="async"${buildImageFallbackHandler(fallback, legacyFallback)}>
                    </div>
                `;
            }

            const card = document.createElement('div');
            card.className = `quest-card ${groupStatus} expanded`;
            card.dataset.questGroupIndex = String(groupIndex);
            card.innerHTML = `
                <div class="quest-header" data-quest-action="toggle-card">
                    ${npcAvatarHtml}
                    <div class="quest-title-group">
                        <h3 class="text-gold-gradient">${escapeHtml(group.title || 'Missione')}</h3>
                        ${group.npc_id ? `<span class="quest-type">Incarichi di ${escapeHtml(group.title || '')}</span>` : ''}
                    </div>
                    <div class="mini-progress"><div class="mini-bar" style="width: ${progress}%;"></div></div>
                    <span class="quest-status ${statusInfo.class}">${statusInfo.text}</span>
                    ${questState.canEdit ? `<button type="button" class="quest-edit-btn" data-quest-action="edit-group" data-quest-group-index="${groupIndex}" title="Modifica missione"><i class="fas fa-pen"></i></button>` : ''}
                    <i class="fas fa-chevron-down expand-icon"></i>
                </div>
                <div class="quest-body" style="display: block;"> 
                    <div class="quest-content">
                        ${group.description ? `<p class="quest-desc">${escapeHtml(group.description)}</p>` : ''}
                        <ul class="objective-list">${objectivesHtml}</ul>
                    </div>
                </div>
            `;
            return card;
        }

        function renderQuestAdminToolbar(root) {
            if (!questState.canEdit || root.querySelector('[data-quest-admin-toolbar]')) return;
            const toolbar = document.createElement('div');
            toolbar.className = 'quest-admin-toolbar';
            toolbar.dataset.questAdminToolbar = 'true';
            toolbar.innerHTML = `
                <div>
                    <strong>Gestione missioni</strong>
                    <span data-quest-status>${questState.source === 'kv' ? 'Dati online KV.' : 'Dati statici: il primo salvataggio creerà la versione KV.'}</span>
                </div>
            `;
            toolbar.firstElementChild?.insertAdjacentHTML('afterend', `
                <div class="quest-admin-toolbar__actions">
                    <button type="button" class="quest-admin-btn" data-quest-action="create-group">
                        <i class="fas fa-plus"></i>
                        Nuova missione
                    </button>
                </div>
            `);
            root.prepend(toolbar);
        }

        function updateQuestStatus(message, isError = false) {
            const status = document.querySelector('[data-quest-status]');
            if (!status) return;
            status.textContent = message || '';
            status.classList.toggle('is-error', Boolean(isError));
        }

        function renderQuests() {
            const mainContainer = document.getElementById('main-quests-container');
            const secondaryContainer = document.getElementById('secondary-quests-container');
            if (!mainContainer || !secondaryContainer) return;
            mainContainer.innerHTML = '';
            secondaryContainer.innerHTML = '';

            questState.groups.forEach((group, groupIndex) => {
                const card = createQuestGroupCard(group, groupIndex);
                if (!card) return;

                if (group.id === 'main_quest') {
                    mainContainer.appendChild(card);
                } else {
                    secondaryContainer.appendChild(card);
                }
            });
        }

        function getQuestObjectiveByPath(group, pathValue) {
            const indexes = String(pathValue || '')
                .split('.')
                .filter(part => part !== '')
                .map(part => Number(part));
            let current = null;
            let list = group?.quests || [];
            for (const index of indexes) {
                if (!Number.isInteger(index) || !Array.isArray(list) || !list[index]) return null;
                current = list[index];
                list = current.subquests || [];
            }
            return current;
        }

        function normalizeQuestStatus(value) {
            const clean = String(value || '').trim();
            return QUEST_STATUS_OPTIONS.some(([status]) => status === clean) ? clean : 'active';
        }

        async function toggleQuestObjective(groupIndex, pathValue) {
            if (!questState.canEdit) return;
            const group = questState.groups[groupIndex];
            const objective = getQuestObjectiveByPath(group, pathValue);
            if (!objective) return;
            const previousStatus = objective.status;
            objective.status = objective.status === 'completed' ? 'active' : 'completed';
            try {
                await saveQuestsToKv();
                renderQuests();
            } catch (error) {
                objective.status = previousStatus;
                console.error('Salvataggio missione fallito:', error);
                updateQuestStatus(error?.message || 'Salvataggio fallito.', true);
                alert(`Salvataggio fallito: ${error?.message || error}`);
            }
        }

        function ensureQuestEditorModal() {
            let modal = document.getElementById('quest-editor-modal');
            if (modal) return modal;
            modal = document.createElement('div');
            modal.id = 'quest-editor-modal';
            modal.className = 'quest-editor-modal';
            modal.hidden = true;
            document.body.appendChild(modal);
            return modal;
        }

        function closeQuestEditor() {
            const modal = ensureQuestEditorModal();
            modal.hidden = true;
            questState.editing = null;
        }

        function createEmptyQuestGroup() {
            return {
                id: createUniqueQuestGroupId('nuova-missione'),
                title: 'Nuova missione',
                npc_id: null,
                description: '',
                quests: [
                    { title: 'Nuovo obiettivo', status: 'active' }
                ]
            };
        }

        function openNewQuestEditor() {
            const draft = createEmptyQuestGroup();
            questState.editing = {
                mode: 'create',
                groupIndex: -1,
                original: null,
                draft
            };
            renderQuestEditor();
        }

        function openQuestEditor(groupIndex) {
            const group = questState.groups[groupIndex];
            if (!group) return;
            questState.editing = {
                mode: 'edit',
                groupIndex,
                original: cloneQuestData(group),
                draft: cloneQuestData(group)
            };
            renderQuestEditor();
        }

        function renderQuestEditor() {
            const modal = ensureQuestEditorModal();
            const editing = questState.editing;
            const draft = editing?.draft;
            if (!draft) return;
            modal.hidden = false;
            modal.innerHTML = `
                <div class="quest-editor-panel" role="dialog" aria-modal="true" aria-label="${editing.mode === 'create' ? 'Nuova missione' : 'Modifica missione'}">
                    <div class="quest-editor-head">
                        <div>
                            <p>${editing.mode === 'create' ? 'Nuova missione' : 'Missione'}</p>
                            <h3>${escapeHtml(draft.title || 'Missione')}</h3>
                        </div>
                        <button type="button" class="quest-editor-close" data-quest-action="close-editor" title="Chiudi"><i class="fas fa-xmark"></i></button>
                    </div>
                    <div class="quest-editor-grid">
                        <label>
                            <span>Titolo</span>
                            <input type="text" data-quest-editor-field="title" value="${escapeHtml(draft.title || '')}">
                        </label>
                        <label>
                            <span>Legame NPC/Giocatore</span>
                            <input type="text" data-quest-editor-field="npc_id" value="${escapeHtml(draft.npc_id || '')}" placeholder="id opzionale">
                        </label>
                        <label class="quest-editor-field--full">
                            <span>Descrizione</span>
                            <textarea data-quest-editor-field="description" rows="3">${escapeHtml(draft.description || '')}</textarea>
                        </label>
                    </div>
                    <div class="quest-editor-objectives">
                        <div class="quest-editor-objectives__head">
                            <strong>Obiettivi</strong>
                            <button type="button" data-quest-action="add-objective"><i class="fas fa-plus"></i> Aggiungi</button>
                        </div>
                        ${renderQuestEditorObjectiveRows(draft.quests || [])}
                    </div>
                    <div class="quest-editor-actions">
                        <button type="button" class="quest-editor-btn quest-editor-btn--ghost" data-quest-action="close-editor">Annulla</button>
                        <button type="button" class="quest-editor-btn quest-editor-btn--primary" data-quest-action="save-editor">Salva missione</button>
                    </div>
                </div>
            `;
        }

        function renderQuestEditorObjectiveRows(quests, prefix = [], depth = 0) {
            return (Array.isArray(quests) ? quests : []).map((quest, index) => {
                const path = [...prefix, index];
                const pathValue = path.join('.');
                const status = normalizeQuestStatus(quest.status);
                const children = renderQuestEditorObjectiveRows(quest.subquests || [], path, depth + 1);
                return `
                    <div class="quest-editor-objective" data-quest-editor-objective data-quest-path="${escapeHtml(pathValue)}" style="--quest-depth:${depth}">
                        <input type="text" data-quest-editor-objective-field="title" value="${escapeHtml(quest.title || '')}" placeholder="Titolo obiettivo">
                        <select data-quest-editor-objective-field="status">
                            ${QUEST_STATUS_OPTIONS.map(([value, label]) => `<option value="${value}"${value === status ? ' selected' : ''}>${label}</option>`).join('')}
                        </select>
                        <input type="text" data-quest-editor-objective-field="character_specific" value="${escapeHtml(quest.character_specific || '')}" placeholder="Personaggio">
                        <input type="text" data-quest-editor-objective-field="rewards" value="${escapeHtml(quest.rewards || '')}" placeholder="Ricompensa">
                    </div>
                    ${children}
                `;
            }).join('');
        }

        function collectQuestEditorDraft() {
            const editing = questState.editing;
            const modal = document.getElementById('quest-editor-modal');
            if (!editing?.draft || !modal) return null;
            const draft = editing.draft;
            draft.title = modal.querySelector('[data-quest-editor-field="title"]')?.value.trim() || 'Missione';
            draft.npc_id = modal.querySelector('[data-quest-editor-field="npc_id"]')?.value.trim() || null;
            if (editing.mode === 'create' || !String(draft.id || '').trim()) {
                draft.id = createUniqueQuestGroupId(draft.npc_id || draft.title, editing.groupIndex);
            }
            const description = modal.querySelector('[data-quest-editor-field="description"]')?.value.trim() || '';
            if (description) draft.description = description;
            else delete draft.description;

            modal.querySelectorAll('[data-quest-editor-objective]').forEach((row) => {
                const objective = getQuestObjectiveByPath(draft, row.dataset.questPath || '');
                if (!objective) return;
                objective.title = row.querySelector('[data-quest-editor-objective-field="title"]')?.value.trim() || 'Obiettivo';
                objective.status = normalizeQuestStatus(row.querySelector('[data-quest-editor-objective-field="status"]')?.value);
                const characterSpecific = row.querySelector('[data-quest-editor-objective-field="character_specific"]')?.value.trim() || '';
                const rewards = row.querySelector('[data-quest-editor-objective-field="rewards"]')?.value.trim() || '';
                if (characterSpecific) objective.character_specific = characterSpecific;
                else delete objective.character_specific;
                if (rewards) objective.rewards = rewards;
                else delete objective.rewards;
            });
            return draft;
        }

        function addQuestEditorObjective() {
            const draft = collectQuestEditorDraft();
            if (!draft) return;
            if (!Array.isArray(draft.quests)) draft.quests = [];
            draft.quests.push({ title: 'Nuovo obiettivo', status: 'active' });
            questState.editing.draft = draft;
            renderQuestEditor();
        }

        async function saveQuestEditor() {
            const editing = questState.editing;
            const draft = collectQuestEditorDraft();
            if (!editing || !draft) return;
            const previousGroups = cloneQuestData(questState.groups);
            if (editing.mode === 'create') {
                questState.groups.push(draft);
            } else {
                questState.groups[editing.groupIndex] = draft;
            }
            try {
                await saveQuestsToKv();
                closeQuestEditor();
                renderQuests();
            } catch (error) {
                questState.groups = previousGroups;
                console.error('Salvataggio missione fallito:', error);
                updateQuestStatus(error?.message || 'Salvataggio fallito.', true);
                alert(`Salvataggio fallito: ${error?.message || error}`);
            }
        }

        function handleQuestClick(event) {
            const button = event.target.closest('[data-quest-action]');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();
            const action = button.dataset.questAction;
            if (action === 'toggle-objective') {
                toggleQuestObjective(Number(button.dataset.questGroupIndex), button.dataset.questPath || '');
            } else if (action === 'create-group') {
                openNewQuestEditor();
            } else if (action === 'edit-group') {
                openQuestEditor(Number(button.dataset.questGroupIndex));
            } else if (action === 'close-editor') {
                closeQuestEditor();
            } else if (action === 'add-objective') {
                addQuestEditorObjective();
            } else if (action === 'save-editor') {
                saveQuestEditor();
            } else if (action === 'toggle-card') {
                toggleQuest(button);
            }
        }

        // Caricamento e renderizzazione delle missioni
        window.CriptaApp.onPageReady("missioni", async function () {
            try {
                // 1. Preload images
                await loadCharacterAssets();
                questState.canEdit = await resolveCanEditQuests();

                // 2. Load Quests
                const questsDocument = await loadQuestsDocument();
                const recencyMap = await loadNpcRecencyMap();
                questState.groups = sortQuestGroups(questsDocument.data || [], recencyMap);
                questState.source = questsDocument.source || 'static';
                questState.version = Number(questsDocument.version || 0);

                const root = document.querySelector('.container');
                if (root) {
                    renderQuestAdminToolbar(root);
                    root.addEventListener('click', handleQuestClick);
                }
                ensureQuestEditorModal().addEventListener('click', (event) => {
                    if (event.target?.id === 'quest-editor-modal') closeQuestEditor();
                    else handleQuestClick(event);
                });
                renderQuests();

            } catch (error) {
                console.error("Errore nel caricamento delle missioni:", error);
                const container = window.document.getElementById('main-quests-container');
                container.innerHTML = '<p style="color: var(--red);">Impossibile caricare il registro delle imprese.</p>';
            }
        });
