/* MAPPA IMMAGINI (Cache) */
        const characterImages = {};
        const characterImageMeta = {};

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
                    if (player?.images?.avatar) {
                        characterImages[player.id] = player.images.avatar;
                        characterImageMeta[player.id] = { type: 'player', fallback: player.images.avatar };
                    }
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
        function createObjectiveHtml(quest) {
            if (window.WikiSpoiler && !window.WikiSpoiler.isVisible(quest)) return '';
            if (!window.WikiSpoiler && quest.status === 'hidden') return '';

            const isDone = quest.status === 'completed';
            const hasSubquests = quest.subquests && quest.subquests.length > 0;

            // Icona specifica personaggio
            let charIconHtml = '';
            if (quest.character_specific && characterImages[quest.character_specific]) {
                const imgPath = resolveImagePath(characterImages[quest.character_specific]);
                const fallback = characterImageMeta[quest.character_specific]?.fallback || '';
                const legacyFallback = characterImageMeta[quest.character_specific]?.legacyFallback || '';
                charIconHtml = `<img src="${imgPath}" class="quest-char-icon-small" title="Esclusiva per ${quest.character_specific}" alt="${quest.character_specific}"${buildImageFallbackHandler(fallback, legacyFallback)}>`;
            }

            let html = `
                <li class="objective-item ${isDone ? 'done' : ''} ${hasSubquests ? 'has-subquests' : ''}">
                    ${hasSubquests ? '' : '<div class="custom-checkbox"></div>'}
                    <div class="objective-content">
                        <span class="objective-text">
                            ${charIconHtml}
                            ${quest.title}
                        </span>
            `;

            if (quest.rewards) {
                html += `<div class="objective-reward"><i class="fas fa-gift"></i> ${quest.rewards}</div>`;
            }

            if (hasSubquests) {
                html += '<ul class="subquest-list">';
                quest.subquests.forEach(sub => {
                    html += createObjectiveHtml(sub);
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
        function createQuestGroupCard(group) {
            if (window.WikiSpoiler && !window.WikiSpoiler.isVisible(group)) return null;
            // Filtra quest nascoste per il conteggio
            const visibleQuests = (group.quests || []).filter(q =>
                window.WikiSpoiler ? window.WikiSpoiler.isVisible(q) : q.status !== 'hidden'
            );
            if (visibleQuests.length === 0 && group.quests.length > 0) return null;

            const total = visibleQuests.length;
            const completed = visibleQuests.filter(q => q.status === 'completed').length;
            const progress = total > 0 ? (completed / total) * 100 : 0;

            let groupStatus = 'active';
            if (total > 0 && completed === total) groupStatus = 'completed';

            const objectivesHtml = visibleQuests.map(q => createObjectiveHtml(q)).join('');

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
                        <img src="${resolveImagePath(characterImages[group.npc_id])}" alt="${group.title}"${buildImageFallbackHandler(fallback, legacyFallback)}>
                    </div>
                `;
            }

            const card = document.createElement('div');
            card.className = `quest-card ${groupStatus} expanded`;
            card.innerHTML = `
                <div class="quest-header" onclick="toggleQuest(this)">
                    ${npcAvatarHtml}
                    <div class="quest-title-group">
                        <h3 class="text-gold-gradient">${group.title}</h3>
                        ${group.npc_id ? `<span class="quest-type">Incarichi di ${group.title}</span>` : ''}
                    </div>
                    <div class="mini-progress"><div class="mini-bar" style="width: ${progress}%;"></div></div>
                    <span class="quest-status ${statusInfo.class}">${statusInfo.text}</span>
                    <i class="fas fa-chevron-down expand-icon"></i>
                </div>
                <div class="quest-body" style="display: block;"> 
                    <div class="quest-content">
                        <ul class="objective-list">${objectivesHtml}</ul>
                    </div>
                </div>
            `;
            return card;
        }

        // Caricamento e renderizzazione delle missioni
        window.CriptaApp.onPageReady("missioni", async function () {
            try {
                // 1. Preload images
                await loadCharacterAssets();

                // 2. Load Quests
                const groups = await fetchCampaignJson('quests.json', []);
                const recencyMap = await loadNpcRecencyMap();
                const sortedGroups = sortQuestGroups(groups, recencyMap);

                const mainContainer = document.getElementById('main-quests-container');
                const secondaryContainer = document.getElementById('secondary-quests-container');

                sortedGroups.forEach(group => {
                    const card = createQuestGroupCard(group);
                    if (!card) return;

                    if (group.id === 'main_quest') {
                        mainContainer.appendChild(card);
                    } else {
                        secondaryContainer.appendChild(card);
                    }
                });

            } catch (error) {
                console.error("Errore nel caricamento delle missioni:", error);
                const container = document.getElementById('main-quests-container');
                container.innerHTML = '<p style="color: var(--red);">Impossibile caricare il registro delle imprese.</p>';
            }
        });
