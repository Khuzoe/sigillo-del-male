function parseYamlLite(yamlText) {
            const text = yamlText.replace(/^\uFEFF/, '');
            const lines = text.split(/\r?\n/);

            const firstNonEmpty = lines.find(l => {
                const t = l.trim();
                return t !== '' && !t.startsWith('#');
            });
            const isArrayRoot = firstNonEmpty ? firstNonEmpty.trim().startsWith('- ') : true;

            const root = isArrayRoot ? [] : {};
            const stack = [{ type: isArrayRoot ? 'array' : 'object', value: root, indent: -1 }];

            const parseScalar = (v) => {
                const val = v.trim();
                if (val === '[]') return [];
                if (val === '{}') return {};
                if (val === 'null') return null;
                if (val === 'true' || val === 'false') return val === 'true';
                if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
                if (val.startsWith('"') && val.endsWith('"')) {
                    try { return JSON.parse(val); } catch (_) { return val.slice(1, -1); }
                }
                if (val.startsWith('\'') && val.endsWith('\'')) return val.slice(1, -1);
                if (val.startsWith('- ')) return [parseScalar(val.slice(2))];
                return val;
            };

            const nextNonEmpty = (idx) => {
                for (let i = idx + 1; i < lines.length; i++) {
                    const raw = lines[i];
                    const trimmed = raw.trim();
                    if (trimmed === '' || trimmed.startsWith('#')) continue;
                    const indent = raw.match(/^ */)[0].length;
                    return { indent, trimmed };
                }
                return null;
            };

            lines.forEach((raw, idx) => {
                const trimmed = raw.trim();
                if (trimmed === '' || trimmed.startsWith('#')) return;
                const indent = raw.match(/^ */)[0].length;
                while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
                    stack.pop();
                }
                const parent = stack[stack.length - 1];

                if (trimmed.startsWith('- ')) {
                    if (parent.type !== 'array') throw new Error('YAML: elemento lista fuori contesto');
                    const entryText = trimmed.slice(2).trim();
                    let item;
                    let pushItem = false;

                    if (entryText === '') {
                        item = {};
                        pushItem = true;
                    } else {
                        const m = entryText.match(/^([^:]+):\s*(.*)$/);
                        if (m) {
                            const key = m[1].trim();
                            const valStr = m[2];
                            item = {};
                            if (valStr === '') {
                                const next = nextNonEmpty(idx);
                                const container = next && next.indent > indent && next.trimmed.startsWith('-') ? [] : {};
                                item[key] = container;
                                pushItem = true;
                                stack.push({ type: Array.isArray(container) ? 'array' : 'object', value: container, indent });
                            } else {
                                item[key] = parseScalar(valStr);
                                pushItem = true;
                            }
                        } else {
                            item = parseScalar(entryText);
                        }
                    }
                    parent.value.push(item);
                    if (pushItem && typeof item === 'object' && item !== null && !Array.isArray(item)) {
                        stack.push({ type: 'object', value: item, indent });
                    }
                    return;
                }

                if (parent.type !== 'object') throw new Error('YAML: chiave fuori contesto');
                const match = trimmed.match(/^([^:]+):\s*(.*)$/);
                if (!match) throw new Error('YAML: riga non valida');
                const key = match[1].trim();
                const valStr = match[2];

                if (valStr === '') {
                    const next = nextNonEmpty(idx);
                    const container = next && next.indent > indent && next.trimmed.startsWith('-') ? [] : {};
                    parent.value[key] = container;
                    stack.push({ type: Array.isArray(container) ? 'array' : 'object', value: container, indent });
                } else {
                    const value = parseScalar(valStr);
                    parent.value[key] = value;
                    if (typeof value === 'object' && value !== null) {
                        stack.push({ type: Array.isArray(value) ? 'array' : 'object', value, indent });
                    }
                }
            });

            return root;
        }

        function buildImageStyle(kind, adjust, counterpartAdjust) {
            return window.CriptaCharacterNormalize.buildNpcImageStyle(kind, adjust, counterpartAdjust);
        }

        function getCurrentCampaignId() {
            return window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue';
        }

        function getSyncedNpcImagePath(npc, variant) {
            return window.CriptaCharacterNormalize.getSyncedNpcImagePath(npc, variant);
        }

        window.CriptaApp.onPageReady("npcs", async function () {
            const base_path = '../assets/'; // Path from npcs.html to assets folder
            const npcListContainer = document.querySelector('.npc-list');
            if (!npcListContainer) return;
            syncNpcAdminLinks();

            try {
                let npcs = [];
                // IBRIDO: Se abbiamo dati statici, usiamoli.
                if (window.NPC_DATA && window.NPC_DATA.length > 0) {
                    console.log("Using static NPC data");
                    npcs = window.NPC_DATA;
                } else {
                    console.log("Fetching NPC data...");
                    npcs = await loadNpcData(base_path);
                }
                npcs = normalizeCharactersCollection(npcs);

                const currentUserIsDm = await resolveNpcListUserIsDm(base_path);
                window.CriptaNpcCategoryManager?.init?.({
                    isEditor: currentUserIsDm,
                    onSaved: () => window.location.reload()
                });
                const visibleNpcs = currentUserIsDm
                    ? npcs
                    : (window.WikiSpoiler
                        ? window.WikiSpoiler.filterVisible(npcs)
                        : npcs.filter(npc => !npc.hidden));

                const managedState = await loadManagedNpcEntries(visibleNpcs).catch((error) => {
                    console.warn('Actor Foundry non caricati:', error);
                    return { managedLegacyCharacterIds: [], npcCategories: [], npcs: [] };
                });
                const managedLegacyIds = new Set((managedState?.managedLegacyCharacterIds || [])
                    .map((id) => String(id || '').trim().toLowerCase())
                    .filter(Boolean));
                const legacyNpcs = visibleNpcs.filter((npc) => !managedLegacyIds.has(String(npc?.id || '').trim().toLowerCase()));
                const categoryRegistry = { categories: managedState?.npcCategories || [] };
                const unifiedNpcs = [...legacyNpcs, ...(managedState?.npcs || [])].map((npc) => applyNpcCategoryMetadata(npc, categoryRegistry));
                const recencyData = await loadNpcRecencyData(base_path);
                const sortedNpcs = sortNpcsByRecency(unifiedNpcs, recencyData);

                if (sortedNpcs.length === 0) {
                    npcListContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Nessun NPC disponibile.</p>';
                    return;
                }

                let refreshRosterFilters = () => {};
                const rosterState = {
                    npcs: sortedNpcs,
                    categoryRegistry,
                    basePath: base_path,
                    canEdit: currentUserIsDm,
                    render: null
                };
                const renderRoster = () => {
                    renderNpcGroups(npcListContainer, rosterState.npcs, rosterState.basePath, currentUserIsDm);
                    window.CriptaRosterMedia?.init(npcListContainer);
                    initNpcCategoryDragAndDrop(npcListContainer, rosterState);
                    refreshRosterFilters();
                };
                rosterState.render = renderRoster;
                renderRoster();
                refreshRosterFilters = initNpcRosterControls(npcListContainer) || (() => {});
                refreshRosterFilters();
            } catch (error) {
                console.error("Errore nel caricamento degli NPC:", error);
                npcListContainer.innerHTML = '<p style="color: var(--red);">Impossibile caricare la lista degli NPC.</p>';
            }
        });

        async function loadManagedNpcEntries(visibleLegacyNpcs = []) {
            if (typeof window.CriptaApp?.api?.get !== 'function') return { managedLegacyCharacterIds: [], npcCategories: [], npcs: [] };
            const token = String(window.CriptaDiscordAuth?.getToken?.() || '').trim();
            const payload = await window.CriptaApp.api.get('api/managed-actors', {
                cache: false,
                ...(token ? { token } : {})
            });
            const managedLegacyCharacterIds = Array.isArray(payload?.managedLegacyCharacterIds)
                ? payload.managedLegacyCharacterIds
                : [];
            const legacyById = new Map((Array.isArray(visibleLegacyNpcs) ? visibleLegacyNpcs : [])
                .map((npc) => [String(npc?.id || '').trim().toLowerCase(), npc])
                .filter(([id]) => id));
            const actors = (Array.isArray(payload?.data) ? payload.data : [])
                .filter((actor) => String(actor?.actorType || '').toLowerCase() === 'npc');
            return {
                managedLegacyCharacterIds,
                npcCategories: Array.isArray(payload?.npcCategories) ? payload.npcCategories : [],
                npcs: actors.map((actor) => {
                    const legacyId = String(actor?.profile?.legacyCharacterId || '').trim().toLowerCase();
                    return managedActorToNpcListEntry(actor, legacyById.get(legacyId) || null);
                })
            };
        }

        function managedActorToNpcListEntry(actor, legacyNpc = null) {
            const profile = actor?.profile || {};
            const media = actor?.media || {};
            const legacyImages = legacyNpc?.images || {};
            const avatarPath = media.avatar?.path || legacyImages.avatar || '';
            const tokenPath = media.token?.path || legacyImages.token || avatarPath;
            const dedicatedIdlePath = media.idle?.path || legacyImages.idle || '';
            const dedicatedHoverPath = media.hover?.path || legacyImages.hover || '';
            const idlePath = dedicatedIdlePath || tokenPath || avatarPath || '';
            const hoverPath = dedicatedHoverPath || tokenPath || idlePath || avatarPath || '';
            const legacyId = String(profile.legacyCharacterId || legacyNpc?.id || '').trim();
            const statsVisibility = String(actor?.visibility?.state || 'dm').toLowerCase();
            const profileVisibility = String(profile?.visibility?.state || 'dm').toLowerCase();
            const hiddenFromPlayers = statsVisibility === 'dm' && profileVisibility === 'dm';
            return {
                ...(legacyNpc || {}),
                id: legacyId || `managed-${actor.worldId || 'world'}-${actor.actorId || 'actor'}`,
                name: actor.name || legacyNpc?.name || 'NPC',
                role: profile.role || legacyNpc?.role || 'NPC',
                quote: profile.quote || legacyNpc?.quote || '',
                lifeState: normalizeManagedNpcLifeState(profile.lifeState, profile.status || legacyNpc?.status),
                status: normalizeManagedNpcStatus(profile.lifeState, profile.status || legacyNpc?.status),
                statusNote: String(profile.status || legacyNpc?.statusNote || ''),
                hidden: hiddenFromPlayers,
                categoryId: Object.prototype.hasOwnProperty.call(profile, 'categoryId')
                    ? profile.categoryId
                    : (legacyNpc?.categoryId || ''),
                category: Object.prototype.hasOwnProperty.call(profile, 'category')
                    ? profile.category
                    : (legacyNpc?.category || 'Altri NPC'),
                categoryPriority: profile.categoryOrder ?? legacyNpc?.categoryPriority ?? null,
                categoryColor: profile.categoryColor || legacyNpc?.categoryColor || '',
                categoryIcon: profile.categoryIcon || legacyNpc?.categoryIcon || '',
                images: {
                    ...legacyImages,
                    avatar: avatarPath,
                    token: tokenPath,
                    idle: idlePath,
                    hover: hoverPath,
                    idleAdjust: managedPresentationToNpcAdjust(media.idle || media.token || media.avatar, legacyImages.idleAdjust || legacyImages.avatarAdjust),
                    hasDedicatedIdle: Boolean(dedicatedIdlePath),
                    hasDedicatedHover: Boolean(dedicatedHoverPath),
                    hoverAdjust: managedPresentationToNpcAdjust(media.hover || media.idle || media.token || media.avatar, legacyImages.hoverAdjust),
                    idleFallback: tokenPath || avatarPath || legacyImages.idleFallback || '',
                    idleFrameCircle: managedPresentationToFrameCircle(media.idle || media.token || media.avatar, legacyImages.idleFrameCircle || legacyImages.tokenFrameCircle),
                    hoverFrameCircle: managedPresentationToFrameCircle(media.hover || media.idle || media.token || media.avatar, legacyImages.hoverFrameCircle),
                    hoverFallback: tokenPath || idlePath || avatarPath || legacyImages.hoverFallback || '',
                    avatarFallback: tokenPath || idlePath || legacyImages.avatarFallback || ''
                },
                updatedAt: actor.updatedAt || legacyNpc?.updatedAt || '',
                managedActorWorldId: String(actor?.worldId || '').trim(),
                managedProfileRevision: Math.max(0, Number(profile.revision || 0)),
                managedProfileCanEdit: actor?.permissions?.isEditor === true,
                managedActorId: String(actor?.actorId || '').trim(),
                discordShareSource: 'managed',
                managedActorUrl: buildManagedActorDetailUrl(actor)
            };
        }
        function managedPresentationToNpcAdjust(descriptor, fallback = null) {
            const presentation = descriptor?.presentation;
            if (!presentation || typeof presentation !== 'object') return fallback || null;
            const finiteOr = (value, defaultValue) => Number.isFinite(Number(value)) ? Number(value) : defaultValue;
            const x = Math.min(100, Math.max(0, finiteOr(presentation.x, 50)));
            const y = Math.min(100, Math.max(0, finiteOr(presentation.y, 50)));
            const size = Math.min(3, Math.max(.5, finiteOr(presentation.scale, 1)));
            return {
                x: Math.round((x - 50) * 2),
                y: Math.round((y - 50) * 2),
                size
            };
        }

        function managedPresentationToFrameCircle(descriptor, fallback = null) {
            return window.CriptaImageAdjust?.normalizeFrameCircle?.(descriptor?.presentation?.frameCircle) || fallback || null;
        }



        function normalizeManagedNpcLifeState(value, fallback = '') {
            const state = String(value || '').trim().toLowerCase();
            if (state === 'alive' || state.includes('viv')) return 'alive';
            if (state === 'dead' || state.includes('mort')) return 'dead';
            if (state === 'unknown' || state.includes('ignot') || state.includes('sconosciut')) return 'unknown';
            const legacy = String(fallback || '').trim().toLowerCase();
            if (legacy === 'alive' || legacy.includes('viv')) return 'alive';
            if (legacy === 'dead' || legacy.includes('mort')) return 'dead';
            return 'unknown';
        }

        function normalizeManagedNpcStatus(value, fallback) {
            const state = normalizeManagedNpcLifeState(value, fallback);
            if (state === 'alive') return 'vivo';
            if (state === 'dead') return 'morto';
            return 'ignoto';
        }

        function buildManagedActorDetailUrl(actor) {
            const target = new URL('./characters/managed-actor.html', window.location.href);
            target.searchParams.set('world', actor?.worldId || '');
            target.searchParams.set('actor', actor?.actorId || '');
            const campaignId = getCurrentCampaignId();
            if (campaignId && campaignId !== 'cripta-di-sangue') target.searchParams.set('campaign', campaignId);
            const permissions = actor?.permissions || {};
            if (permissions.canReadStats === false && permissions.canReadProfile === true) target.searchParams.set('profile', '1');
            return `${target.pathname}${target.search}`;
        }
        function resolveImageUrl(path, base_path = '../assets/') {
            return window.CriptaApp.utils.resolveImageUrl(path);
        }

        function buildNpcDetailUrl(params = {}) {
            const url = new URL('./characters/character.html', window.location.href);
            Object.entries(params).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
            });
            const campaignId = getCurrentCampaignId();
            if (campaignId && campaignId !== 'cripta-di-sangue') url.searchParams.set('campaign', campaignId);
            return `${url.pathname}${url.search}`;
        }

        function syncNpcAdminLinks() {
            document.querySelectorAll('[data-npc-create-link]').forEach((link) => {
                link.href = buildNpcDetailUrl({ type: 'npc', new: '1', edit: '1' });
            });
        }

        async function resolveNpcListUserIsDm(base_path) {
            try {
                return await window.CriptaDiscordAuth?.isCurrentUserDm?.(base_path) === true;
            } catch (_) {
                return false;
            }
        }

        function appendAssetVersion(url, version) {
            return window.CriptaApp.utils.appendAssetVersion(url, version);
        }

        function resolveNpcImageUrl(npc, path, base_path = '../assets/') {
            return appendAssetVersion(resolveImageUrl(path, base_path), npc?.updatedAt);
        }

        async function loadNpcRecencyData(base_path) {
            try {
                const payload = typeof window.CriptaApp?.data?.json === 'function'
                    ? await window.CriptaApp.data.json('npc-recency.json')
                    : await window.CriptaApp.fetchJson(window.CriptaApp?.urls?.data?.('npc-recency.json') || base_path + 'data/npc-recency.json', { clone: true });
                const byId = {};
                (payload.items || []).forEach(item => {
                    if (item && item.id) byId[item.id] = item;
                });
                return { byId };
            } catch (error) {
                console.warn('Impossibile caricare npc-recency.json:', error);
                return { byId: {} };
            }
        }

        function sortNpcsByRecency(npcs, recencyData) {
            const byId = (recencyData && recencyData.byId) ? recencyData.byId : {};
            const parseOrderSlot = (value) => {
                if (value === null || value === undefined || value === '') return null;
                const slot = Number(value);
                return Number.isInteger(slot) && slot > 0 ? slot : null;
            };
            const recencySort = (aMeta, bMeta) => {
                if (aMeta.lastMentionSessionId !== bMeta.lastMentionSessionId) {
                    return bMeta.lastMentionSessionId - aMeta.lastMentionSessionId;
                }
                if (aMeta.mentions !== bMeta.mentions) {
                    return bMeta.mentions - aMeta.mentions;
                }
                return String(aMeta.npc.name || aMeta.npc.id).localeCompare(String(bMeta.npc.name || bMeta.npc.id), 'it');
            };

            const metas = [...npcs].map((npc) => {
                const recency = byId[npc.id] || {};
                return {
                    npc,
                    slot: parseOrderSlot(recency.order_slot) ?? parseOrderSlot(npc.order_slot),
                    lastMentionSessionId: Number.isFinite(Number(recency.lastMentionSessionId)) ? Number(recency.lastMentionSessionId) : -1,
                    mentions: Number.isFinite(Number(recency.mentions)) ? Number(recency.mentions) : 0,
                };
            });

            const unpinned = metas.filter((meta) => meta.slot === null).sort(recencySort);
            const pinned = metas.filter((meta) => meta.slot !== null).sort((a, b) => {
                if (a.slot !== b.slot) return a.slot - b.slot;
                return recencySort(a, b);
            });

            const ordered = unpinned.map((meta) => meta.npc);
            pinned.forEach((meta) => {
                const insertIndex = Math.max(0, Math.min(meta.slot - 1, ordered.length));
                ordered.splice(insertIndex, 0, meta.npc);
            });

            return ordered;
        }

        async function loadNpcData(base_path) {
            const liveCharacters = await loadCharactersCollection();
            if (Array.isArray(liveCharacters)) {
                return liveCharacters.filter(entry => (entry.type || 'npc') === 'npc');
            }

            const manifest = await loadCharactersManifest(base_path);
            const npcEntries = manifest.filter(entry => (entry.type || 'npc') === 'npc');
            const characters = [];
            for (const entry of npcEntries) {
                const char = await loadCharacterYaml(entry, base_path);
                if (char) characters.push(char);
            }
            return characters;
        }

        async function loadCharactersCollection() {
            try {
                if (typeof window.CriptaApp?.api?.get === 'function') {
                    const payload = await window.CriptaApp.api.get('api/data/characters');
                    if (Array.isArray(payload?.data)) return normalizeCharactersCollection(payload.data);
                } else {
                    const response = await fetch(window.CriptaApp?.urls?.api?.('api/data/characters') || 'https://sigillo-api.khuzoe.workers.dev/api/data/characters');
                    if (response.ok) {
                        const payload = await response.json();
                        if (Array.isArray(payload?.data)) return normalizeCharactersCollection(payload.data);
                    }
                }
            } catch (error) {
                console.warn('KV characters non disponibile, provo JSON statico.', error);
            }

            try {
                const payload = typeof window.CriptaApp?.data?.json === 'function'
                    ? await window.CriptaApp.data.json('characters.json')
                    : await window.CriptaApp.fetchJson(window.CriptaApp?.urls?.data?.('characters.json') || '../assets/data/characters.json', { clone: true });
                const data = Array.isArray(payload) ? payload : payload?.data;
                if (Array.isArray(data)) return normalizeCharactersCollection(data);
            } catch (error) {
                console.warn('characters.json non disponibile, provo YAML statico.', error);
            }

            return null;
        }

        function normalizeCharactersCollection(characters) {
            return window.CriptaCharacterNormalize.normalizeCharactersCollection(characters, {
                normalizeBlocks: normalizeCharacterBlocks
            });
        }

        function applyNpcCategoryMetadata(npc, registry) {
            const resolved = window.CriptaNpcCategories?.resolve?.(registry, npc?.categoryId, npc?.category);
            if (!resolved) return npc;
            return {
                ...npc,
                categoryId: resolved.id,
                category: resolved.name,
                categoryPriority: resolved.order,
                categoryColor: resolved.color,
                categoryIcon: resolved.icon
            };
        }

        function renderNpcGroups(container, npcs, base_path, canShare = false) {
            container.innerHTML = '';
            const groups = groupNpcsByCategory(npcs);
            groups.forEach((group) => {
                const section = document.createElement('section');
                section.className = 'npc-category-group';
                section.dataset.npcCategory = group.id || group.category || '';
                if (group.color) section.style.setProperty('--npc-category-accent', group.color);

                const header = document.createElement('header');
                header.className = 'npc-category-header';
                const title = document.createElement('h2');
                title.className = 'npc-category-title';
                if (group.icon) {
                    const icon = document.createElement('i');
                    icon.className = `fas ${group.icon}`;
                    title.appendChild(icon);
                }
                title.appendChild(document.createTextNode(group.category || 'Senza categoria'));
                const count = document.createElement('span');
                count.className = 'npc-category-count';
                count.textContent = String(group.items.length);
                header.append(title, count);
                section.appendChild(header);

                const cards = document.createElement('div');
                cards.className = 'npc-category-list';
                group.items.forEach((npc) => {
                    cards.appendChild(createNpcCard(npc, base_path, canShare));
                });
                section.appendChild(cards);
                container.appendChild(section);
            });
            window.CriptaImageAdjust?.initFrameCircleImages?.(container);
        }

        function groupNpcsByCategory(npcs) {
            const groups = new Map();
            (Array.isArray(npcs) ? npcs : []).forEach((npc) => {
                const category = String(npc?.category || '').trim();
                const id = window.CriptaNpcCategories?.normalizeId?.(npc?.categoryId || category) || category.toLocaleLowerCase('it');
                const key = id || '__uncategorized__';
                if (!groups.has(key)) {
                    groups.set(key, { id, category, color: npc?.categoryColor || '', icon: npc?.categoryIcon || '', priority: null, items: [] });
                }
                const group = groups.get(key);
                if (!group.color && npc?.categoryColor) group.color = npc.categoryColor;
                if (!group.icon && npc?.categoryIcon) group.icon = npc.categoryIcon;
                const priority = normalizeCategoryPriority(npc?.categoryPriority);
                if (priority !== null && (group.priority === null || priority < group.priority)) {
                    group.priority = priority;
                }
                group.items.push(npc);
            });
            return Array.from(groups.values()).sort((left, right) => {
                const leftPriority = normalizeCategoryPriority(left.priority);
                const rightPriority = normalizeCategoryPriority(right.priority);
                if (leftPriority !== null && rightPriority !== null && leftPriority !== rightPriority) return leftPriority - rightPriority;
                if (leftPriority !== null && rightPriority === null) return -1;
                if (leftPriority === null && rightPriority !== null) return 1;
                if (!left.category && right.category) return 1;
                if (left.category && !right.category) return -1;
                return left.category.localeCompare(right.category, 'it');
            });
        }

        function normalizeCategoryPriority(value) {
            return window.CriptaCharacterNormalize.normalizeCategoryPriority(value);
        }

        function normalizeCharacterBlocks(character) {
            if (Array.isArray(character.content_blocks)) return character.content_blocks;
            if (!Array.isArray(character.blocks)) return [];
            return character.blocks.map((block) => ({
                type: block.type === 'image' || block.image ? 'image_box' : 'lore',
                title: block.title || 'Informazioni',
                icon: block.icon || 'fa-book-open',
                image: block.image || '',
                hidden: Boolean(block.hidden),
                markdownText: block.text || '',
                markdownHtml: block.text ? renderMarkdown(block.text) : ''
            }));
        }

        function renderMarkdown(markdown) {
            return window.CriptaMarkdown.render(markdown);
        }

        async function loadCharactersManifest(base_path) {
            const yamlUrl = window.CriptaApp?.urls?.data?.('characters/index.yaml') || base_path + 'data/characters/index.yaml';
            try {
                const resp = await fetch(yamlUrl);
                if (resp.ok) {
                    const text = await resp.text();
                    const parsed = parseYamlLite(text);
                    if (Array.isArray(parsed)) return parsed;
                }
            } catch (err) {
                console.warn('Impossibile leggere manifest YAML, provo JSON:', err);
            }

            const jsonUrl = window.CriptaApp?.urls?.data?.('characters/index.json') || base_path + 'data/characters/index.json';
            const jsonResp = await fetch(jsonUrl);
            if (jsonResp.ok) return jsonResp.json();

            throw new Error('Impossibile caricare il manifest dei personaggi.');
        }

        async function loadCharacterYaml(entry, base_path) {
            const filePath = entry.file || `characters/${entry.id}.yaml`;
            const yamlUrl = window.CriptaApp?.urls?.data?.(filePath) || base_path + 'data/' + filePath;
            try {
                const resp = await fetch(yamlUrl);
                if (resp.ok) {
                    const text = await resp.text();
                    const parsed = parseYamlLite(text);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
                }
            } catch (err) {
                console.warn(`Impossibile leggere YAML per ${entry.id}, provo JSON:`, err);
            }

            const jsonUrl = yamlUrl.replace(/\\.yaml$/, '.json');
            const jsonResp = await fetch(jsonUrl);
            if (jsonResp.ok) return jsonResp.json();
            console.error(`Impossibile caricare i dati del personaggio ${entry.id}`);
            return null;
        }

        function normalizeRosterSearch(value) {
            return String(value || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLocaleLowerCase('it')
                .trim();
        }

        function initNpcRosterControls(container) {
            const search = document.getElementById('npc-search');
            const filters = document.getElementById('npc-status-filters');
            const count = document.getElementById('npc-count');
            const empty = document.getElementById('npc-filter-empty');
            const state = { query: '', status: 'all' };

            const apply = () => {
                const query = normalizeRosterSearch(state.query);
                const cards = Array.from(container.querySelectorAll('[data-roster-card="npc"]'));
                let visibleTotal = 0;
                cards.forEach((card) => {
                    const matchesQuery = !query || String(card.dataset.rosterSearch || '').includes(query);
                    const matchesStatus = state.status === 'all' || card.dataset.rosterStatus === state.status;
                    card.hidden = !(matchesQuery && matchesStatus);
                    if (!card.hidden) visibleTotal += 1;
                });
                container.querySelectorAll('.npc-category-group').forEach((section) => {
                    const visibleCards = Array.from(section.querySelectorAll('[data-roster-card="npc"]')).filter((card) => !card.hidden);
                    section.hidden = visibleCards.length === 0;
                    const sectionCount = section.querySelector('.npc-category-count');
                    if (sectionCount) sectionCount.textContent = String(visibleCards.length);
                });
                if (count) count.textContent = `${visibleTotal} NPC`;
                if (empty) empty.hidden = visibleTotal !== 0;
            };

            search?.addEventListener('input', (event) => {
                state.query = event.target.value;
                apply();
            });
            filters?.addEventListener('click', (event) => {
                const button = event.target.closest('[data-roster-filter]');
                if (!button) return;
                state.status = button.dataset.rosterFilter || 'all';
                filters.querySelectorAll('[data-roster-filter]').forEach((entry) => {
                    const active = entry === button;
                    entry.classList.toggle('is-active', active);
                    entry.setAttribute('aria-pressed', active ? 'true' : 'false');
                });
                apply();
            });
            apply();
            return apply;
        }

        function createNpcCard(npc, base_path, canShare = false) {
            const statusMap = {
                vivo: { text: 'VIVO', class: 'status-vivo' },
                morto: { text: 'MORTO', class: 'status-morto' },
                ignoto: { text: 'IGNOTO', class: 'status-sconosciuto' }
            };
            const statusInfo = statusMap[npc.status] || { text: 'N/A', class: '' };
            const canMoveCategory = canShare && Boolean(npc.managedActorWorldId && npc.managedActorId);

            const card = document.createElement('a');
            card.href = npc.managedActorUrl || buildNpcDetailUrl({ id: npc.id, type: 'npc' });
            card.className = 'npc-card';
            card.draggable = false;
            card.dataset.rosterCard = 'npc';
            card.dataset.rosterStatus = ['vivo', 'morto'].includes(String(npc.status || '').toLowerCase()) ? String(npc.status).toLowerCase() : 'ignoto';
            card.dataset.rosterSearch = normalizeRosterSearch([npc.name, npc.role, npc.quote, npc.category, npc.status, npc.statusNote].filter(Boolean).join(' '));
            card.dataset.managedActorWorld = String(npc.managedActorWorldId || '');
            card.dataset.managedActorId = String(npc.managedActorId || '');
            card.dataset.npcCategoryId = String(npc.categoryId || '');
            const hiddenFromPlayers = npc.hidden === true || npc.status === 'hidden';
            if (hiddenFromPlayers) card.classList.add('npc-card--dm-hidden');
            const hasDedicatedIdle = npc.images.hasDedicatedIdle ?? Boolean(npc.images.idle);
            const hasDedicatedHover = npc.images.hasDedicatedHover ?? Boolean(npc.images.hover);
            const avatarImage = npc.images.idle || npc.images.token || npc.images.avatar || '';
            const hoverImage = npc.images.hover || npc.images.token || avatarImage;
            // Le immagini dedicate hanno la priorit?; token resta il fallback
            // soltanto quando idle/hover ? assente o il file non ? disponibile.
            const avatarFallback = npc.images.idleFallback || npc.images.token || npc.images.avatarFallback || '';
            const hoverFallback = npc.images.hoverFallback || npc.images.token || avatarFallback;
            if (normalizeImageIdentity(avatarImage) === normalizeImageIdentity(hoverImage)) {
                card.classList.add('npc-card--no-avatar-swap');
            }

            card.innerHTML = `
                <span class="npc-status-badge ${statusInfo.class}">${statusInfo.text}</span>
                ${hiddenFromPlayers ? '<span class="npc-player-visibility-badge"><i class="fas fa-user-shield" aria-hidden="true"></i>Solo M</span>' : ''}
                <div class="npc-avatar-container">
                    <img src="${resolveNpcImageUrl(npc, avatarImage, base_path)}" data-original-src="${resolveNpcImageUrl(npc, avatarImage, base_path)}" data-fallback-src="${resolveNpcImageUrl(npc, avatarFallback, base_path)}" data-media-dedicated="${hasDedicatedIdle ? 'true' : 'false'}" alt="${npc.name}" class="npc-img-pop img-main" loading="eager" decoding="async" fetchpriority="auto" style="${buildImageStyle('avatar', npc.images.idleAdjust || npc.images.avatarAdjust, npc.images.hoverAdjust)}">
                    <img src="${resolveNpcImageUrl(npc, hoverImage, base_path)}" data-original-src="${resolveNpcImageUrl(npc, hoverImage, base_path)}" data-fallback-src="${resolveNpcImageUrl(npc, hoverFallback, base_path)}" data-media-dedicated="${hasDedicatedHover ? 'true' : 'false'}" alt="${npc.name} Reveal" class="npc-img-pop img-hover" loading="lazy" decoding="async" fetchpriority="low" style="${buildImageStyle('hover', npc.images.hoverAdjust, npc.images.idleAdjust || npc.images.avatarAdjust)}">
                </div>
                <div class="npc-info">
                    <div class="npc-header">
                        <h3 class="npc-name">${npc.name}</h3>
                        <span class="npc-role">${npc.role}</span>
                    </div>
                    <p class="npc-desc">${npc.quote}</p>
                </div>
                <span class="npc-card-actions">
                    ${canMoveCategory ? '<span class="npc-category-drag-handle" role="button" tabindex="0" draggable="false" title="Trascina in una categoria diversa" aria-label="Sposta ' + escapeNpcAttribute(npc.name) + ' in una categoria diversa"><i class="fas fa-grip-vertical" aria-hidden="true"></i></span>' : ''}
                    ${canShare ? '<span class="npc-discord-share" role="button" tabindex="0" title="Condividi su Discord" aria-label="Condividi ' + escapeNpcAttribute(npc.name) + ' su Discord"><i class="fab fa-discord" aria-hidden="true"></i></span>' : ''}
                    <i class="fas fa-chevron-right arrow-icon"></i>
                </span>
            `;
            if (canShare) {
                const shareButton = card.querySelector('.npc-discord-share');
                const openShare = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    shareNpcOnDiscord(npc, card.href, base_path);
                };
                shareButton?.addEventListener('click', openShare);
                shareButton?.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') openShare(event);
                });
            }
            const frameHost = card.querySelector(".npc-avatar-container");
            const mainImage = card.querySelector(".img-main");
            const hoverImageElement = card.querySelector(".img-hover");
            const idleCircle = window.CriptaImageAdjust?.normalizeFrameCircle?.(npc.images.idleFrameCircle);
            const hoverCircle = window.CriptaImageAdjust?.normalizeFrameCircle?.(npc.images.hoverFrameCircle);
            if (idleCircle || hoverCircle) frameHost.dataset.frameCircleHost = "true";
            if (idleCircle) window.CriptaImageAdjust.setFrameCircleDataset(mainImage, idleCircle, { scale: .85 });
            if (hoverCircle) window.CriptaImageAdjust.setFrameCircleDataset(hoverImageElement, hoverCircle, { scale: 1 });
            if (idleCircle || hoverCircle) requestAnimationFrame(() => window.CriptaImageAdjust?.initFrameCircleImages?.(card));
            return card;

        }

        function initNpcCategoryDragAndDrop(container, state = {}) {
            if (!container || state.canEdit !== true) return;
            container._npcCategoryDragCleanup?.();
            const listenerController = new AbortController();
            container._npcCategoryDragCleanup = () => listenerController.abort();
            const movable = (Array.isArray(state.npcs) ? state.npcs : []).filter((npc) => npc?.managedActorWorldId && npc?.managedActorId);
            if (!movable.length) return;

            const npcByKey = new Map(movable.map((npc) => [managedNpcRosterKey(npc.managedActorWorldId, npc.managedActorId), npc]));
            const categories = (Array.isArray(state.categoryRegistry?.categories) ? state.categoryRegistry.categories : [])
                .filter((category) => !category.archived && !category.mergedInto)
                .sort((left, right) => Number(left.order || 0) - Number(right.order || 0) || String(left.name || '').localeCompare(String(right.name || ''), 'it'));
            const dock = document.createElement('div');
            dock.className = 'npc-category-drop-dock';
            dock.hidden = true;
            dock.setAttribute('aria-label', 'Categorie di destinazione');
            const targets = [{ id: '', name: 'Senza categoria', icon: 'fa-box-archive' }, ...categories];
            dock.innerHTML = `<span class="npc-category-drop-dock-label"><i class="fas fa-folder-tree"></i> Sposta in</span><div>${targets.map((category) => `<button type="button" data-npc-category-drop-id="${escapeNpcAttribute(category.id)}"><i class="fas ${escapeNpcAttribute(category.icon || 'fa-folder-open')}"></i><span>${escapeNpcAttribute(category.name)}</span></button>`).join('')}</div>`;
            container.prepend(dock);

            let draggedNpc = null;
            let saving = false;
            const clearTargets = () => {
                stopDragAutoScroll();
                container.classList.remove('is-category-dragging');
                container.querySelectorAll('.is-category-drop-target').forEach((target) => target.classList.remove('is-category-drop-target'));
                container.querySelectorAll('.npc-card.is-category-drag-source').forEach((card) => card.classList.remove('is-category-drag-source'));
                dock.hidden = true;
            };
            const finishDrag = () => {
                draggedNpc = null;
                clearTargets();
            };
            const moveTo = async (categoryId, card = null) => {
                if (!draggedNpc || saving) return;
                const npc = draggedNpc;
                const targetId = window.CriptaNpcCategories?.normalizeId?.(categoryId || '') || '';
                const currentId = window.CriptaNpcCategories?.normalizeId?.(npc.categoryId || npc.category || '') || '';
                finishDrag();
                if (targetId === currentId) {
                    showNpcRosterFeedback(`${npc.name} \u00e8 gi\u00e0 in ${npc.category || 'Senza categoria'}.`, 'info');
                    return;
                }
                const targetCategory = targetId
                    ? window.CriptaNpcCategories?.resolve?.(state.categoryRegistry, targetId, '')
                    : null;
                if (targetId && !targetCategory) {
                    showNpcRosterFeedback('Categoria non disponibile.', 'error');
                    return;
                }
                saving = true;
                card?.classList.add('is-category-saving');
                try {
                    const profile = await saveManagedNpcProfilePatch(npc, {
                        categoryId: targetId,
                        category: targetCategory?.name || ''
                    });
                    npc.categoryId = String(profile.categoryId || targetId);
                    npc.category = String(profile.category || targetCategory?.name || '');
                    npc.categoryPriority = targetCategory?.order ?? null;
                    npc.categoryColor = targetCategory?.color || '';
                    npc.categoryIcon = targetCategory?.icon || '';
                    npc.managedProfileRevision = Math.max(0, Number(profile.revision || npc.managedProfileRevision || 0));
                    state.render?.();
                    showNpcRosterFeedback(`${npc.name} spostato in ${targetCategory?.name || 'Senza categoria'}.`, 'success');
                } catch (error) {
                    card?.classList.remove('is-category-saving');
                    showNpcRosterFeedback(error?.message || 'Spostamento non riuscito.', 'error');
                } finally {
                    saving = false;
                }
            };

            const pointerDropTargetAt = (clientX, clientY) => {
                const node = document.elementFromPoint(clientX, clientY);
                const target = node?.closest?.('[data-npc-category-drop-id], .npc-category-group') || null;
                return target && container.contains(target) ? target : null;
            };
            const pointerTargetCategoryId = (target) => {
                if (!target) return null;
                if (target.matches('[data-npc-category-drop-id]')) return target.dataset.npcCategoryDropId || '';
                return target.dataset.npcCategory || '';
            };
            const highlightPointerTarget = (target) => {
                container.querySelectorAll('.is-category-drop-target').forEach((entry) => entry.classList.remove('is-category-drop-target'));
                target?.classList.add('is-category-drop-target');
            };
            let pointerSession = null;
            let dragAutoScrollFrame = 0;
            let dragAutoScrollVelocity = 0;
            const stopDragAutoScroll = () => {
                dragAutoScrollVelocity = 0;
                if (dragAutoScrollFrame) cancelAnimationFrame(dragAutoScrollFrame);
                dragAutoScrollFrame = 0;
            };
            const runDragAutoScroll = () => {
                if (!pointerSession?.active || !dragAutoScrollVelocity) {
                    dragAutoScrollFrame = 0;
                    return;
                }
                const scrollingElement = document.scrollingElement || document.documentElement;
                const previousTop = scrollingElement.scrollTop;
                scrollingElement.scrollTop += dragAutoScrollVelocity;
                if (scrollingElement.scrollTop === previousTop) {
                    stopDragAutoScroll();
                    return;
                }
                highlightPointerTarget(pointerDropTargetAt(pointerSession.clientX, pointerSession.clientY));
                dragAutoScrollFrame = requestAnimationFrame(runDragAutoScroll);
            };
            const updateDragAutoScroll = (clientX, clientY) => {
                if (!pointerSession?.active) return;
                pointerSession.clientX = clientX;
                pointerSession.clientY = clientY;
                const directTarget = pointerDropTargetAt(clientX, clientY);
                if (directTarget?.matches?.('[data-npc-category-drop-id]')) {
                    stopDragAutoScroll();
                    return;
                }
                const viewportHeight = Math.max(1, window.innerHeight);
                const edgeSize = Math.min(120, Math.max(80, viewportHeight * .15));
                let nextVelocity = 0;
                if (clientY < edgeSize) {
                    const strength = Math.min(1, Math.max(0, (edgeSize - clientY) / edgeSize));
                    nextVelocity = -Math.round(4 + (20 * strength));
                } else if (clientY > viewportHeight - edgeSize) {
                    const strength = Math.min(1, Math.max(0, (clientY - (viewportHeight - edgeSize)) / edgeSize));
                    nextVelocity = Math.round(4 + (20 * strength));
                }
                dragAutoScrollVelocity = nextVelocity;
                if (!nextVelocity) {
                    stopDragAutoScroll();
                    return;
                }
                if (!dragAutoScrollFrame) dragAutoScrollFrame = requestAnimationFrame(runDragAutoScroll);
            };
            listenerController.signal.addEventListener('abort', stopDragAutoScroll, { once: true });
            const updatePointerSession = (event) => {
                const session = pointerSession;
                if (!session || session.pointerId !== event.pointerId) return;
                if (!session.active) {
                    const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
                    if (distance < 6) return;
                    session.active = true;
                    draggedNpc = session.npc;
                    session.card.classList.add('is-category-drag-source');
                    container.classList.add('is-category-dragging');
                    dock.hidden = false;
                }
                event.preventDefault();
                event.stopPropagation();
                updateDragAutoScroll(event.clientX, event.clientY);
                highlightPointerTarget(pointerDropTargetAt(event.clientX, event.clientY));
            };
            const completePointerSession = (event, cancelled = false) => {
                const session = pointerSession;
                if (!session || session.pointerId !== event.pointerId) return;
                const wasActive = session.active;
                const target = wasActive && !cancelled ? pointerDropTargetAt(event.clientX, event.clientY) : null;
                pointerSession = null;
                if (session.handle?.hasPointerCapture?.(event.pointerId)) {
                    session.handle.releasePointerCapture(event.pointerId);
                }
                if (cancelled) {
                    finishDrag();
                    return;
                }
                if (!wasActive) return;
                event.preventDefault();
                event.stopPropagation();
                const categoryId = pointerTargetCategoryId(target);
                if (categoryId === null) {
                    finishDrag();
                    return;
                }
                moveTo(categoryId, session.card);
            };
            document.addEventListener('pointermove', updatePointerSession, {
                capture: true,
                signal: listenerController.signal
            });
            document.addEventListener('pointerup', (event) => completePointerSession(event), {
                capture: true,
                signal: listenerController.signal
            });
            document.addEventListener('pointercancel', (event) => completePointerSession(event, true), {
                capture: true,
                signal: listenerController.signal
            });
            container.querySelectorAll('.npc-category-drag-handle').forEach((handle) => {
                handle.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                });
                handle.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    showNpcRosterFeedback('Trascina la maniglia verso una categoria.', 'info');
                });
                handle.addEventListener('pointerdown', (event) => {
                    if (event.button !== 0 || saving) return;
                    const card = handle.closest('[data-roster-card="npc"]');
                    const key = managedNpcRosterKey(card?.dataset.managedActorWorld, card?.dataset.managedActorId);
                    const npc = npcByKey.get(key) || null;
                    if (!npc || !card) return;
                    pointerSession = {
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                        active: false,
                        npc,
                        handle,
                        card
                    };
                    handle.setPointerCapture?.(event.pointerId);
                    event.preventDefault();
                    event.stopPropagation();
                });
            });

        }

        function managedNpcRosterKey(worldId, actorId) {
            return `${String(worldId || '').trim().toLowerCase()}:${String(actorId || '').trim().toLowerCase()}`;
        }

        async function saveManagedNpcProfilePatch(npc, data) {
            const token = String(window.CriptaDiscordAuth?.getToken?.() || '').trim();
            if (!token) throw new Error('Accedi per modificare la categoria.');
            if (!npc?.managedActorWorldId || !npc?.managedActorId) throw new Error('Questo NPC non usa ancora il flusso gestito.');
            const payload = await window.CriptaApp.api.post(`api/managed-actors/${encodeURIComponent(npc.managedActorWorldId)}/${encodeURIComponent(npc.managedActorId)}/profile`, {
                expectedRevision: Math.max(0, Number(npc.managedProfileRevision || 0)),
                data
            }, { token });
            return payload?.data || {};
        }

        function showNpcRosterFeedback(message, kind = 'info') {
            let feedback = document.querySelector('[data-npc-roster-feedback]');
            if (!feedback) {
                feedback = document.createElement('div');
                feedback.dataset.npcRosterFeedback = 'true';
                feedback.className = 'npc-roster-feedback';
                feedback.setAttribute('role', 'status');
                feedback.setAttribute('aria-live', 'polite');
                document.body.appendChild(feedback);
            }
            window.clearTimeout(feedback._npcFeedbackTimer);
            feedback.className = `npc-roster-feedback is-${kind}`;
            feedback.innerHTML = `<i class="fas ${kind === 'success' ? 'fa-circle-check' : kind === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-info'}"></i><span>${escapeNpcAttribute(message)}</span>`;
            feedback.classList.add('is-visible');
            feedback._npcFeedbackTimer = window.setTimeout(() => feedback.classList.remove('is-visible'), 3200);
        }

        function shareNpcOnDiscord(npc, detailUrl, base_path) {
            if (!window.CriptaDiscordShare) return;
            const description = getNpcShareDescription(npc);
            const image = npc?.images?.avatar || npc?.images?.idle || npc?.images?.token || '';
            window.CriptaDiscordShare.open({
                kind: 'npc',
                source: npc.discordShareSource || 'characters',
                campaignId: getCurrentCampaignId(),
                entityId: npc.managedActorId || npc.id,
                worldId: npc.managedActorWorldId || '',
                actorId: npc.managedActorId || '',
                name: npc.name || 'NPC',
                subtitle: npc.role || npc.category || 'NPC',
                description,
                imageUrl: image ? resolveNpcImageUrl(npc, image, base_path) : '',
                badges: [npc.category || '', normalizeManagedNpcStatus(npc.status, 'ignoto')],
                facts: [],
                hidden: npc.hidden === true || npc.status === 'hidden',
                pageUrl: detailUrl
            });
        }

        function getNpcShareDescription(npc) {
            const quote = String(npc?.quote || '').trim();
            if (quote) return quote;
            const blocks = Array.isArray(npc?.content_blocks) ? npc.content_blocks : (Array.isArray(npc?.blocks) ? npc.blocks : []);
            const publicBlock = blocks.find((block) => block && block.hidden !== true && String(block.markdownText || block.text || '').trim());
            return String(publicBlock?.markdownText || publicBlock?.text || '').replace(/[#*_>`~]/g, '').trim();
        }

        function escapeNpcAttribute(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }
        function normalizeImageIdentity(path) {
            return String(path || '')
                .trim()
                .replace(/[?#].*$/, '')
                .replace(/^https?:\/\/[^/]+\/?/i, '')
                .replace(/^\/+/, '')
                .toLowerCase();
        }
