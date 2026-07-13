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
                const visibleNpcs = currentUserIsDm
                    ? npcs
                    : (window.WikiSpoiler
                        ? window.WikiSpoiler.filterVisible(npcs)
                        : npcs.filter(npc => !npc.hidden));

                const managedState = await loadManagedNpcEntries(visibleNpcs).catch((error) => {
                    console.warn('Actor Foundry non caricati:', error);
                    return { managedLegacyCharacterIds: [], npcs: [] };
                });
                const managedLegacyIds = new Set((managedState?.managedLegacyCharacterIds || [])
                    .map((id) => String(id || '').trim().toLowerCase())
                    .filter(Boolean));
                const legacyNpcs = visibleNpcs.filter((npc) => !managedLegacyIds.has(String(npc?.id || '').trim().toLowerCase()));
                const unifiedNpcs = [...legacyNpcs, ...(managedState?.npcs || [])];
                const recencyData = await loadNpcRecencyData(base_path);
                const sortedNpcs = sortNpcsByRecency(unifiedNpcs, recencyData);

                if (sortedNpcs.length === 0) {
                    npcListContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Nessun NPC disponibile.</p>';
                    return;
                }

                renderNpcGroups(npcListContainer, sortedNpcs, base_path);
            } catch (error) {
                console.error("Errore nel caricamento degli NPC:", error);
                npcListContainer.innerHTML = '<p style="color: var(--red);">Impossibile caricare la lista degli NPC.</p>';
            }
        });

        async function loadManagedNpcEntries(visibleLegacyNpcs = []) {
            if (typeof window.CriptaApp?.api?.get !== 'function') return { managedLegacyCharacterIds: [], npcs: [] };
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
            const idlePath = media.idle?.path || tokenPath || avatarPath || legacyImages.idle || '';
            const hoverPath = media.hover?.path || tokenPath || idlePath || legacyImages.hover || '';
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
                status: normalizeManagedNpcStatus(profile.status, legacyNpc?.status),
                hidden: hiddenFromPlayers,
                category: profile.category || legacyNpc?.category || 'Altri NPC',
                categoryPriority: legacyNpc?.categoryPriority ?? null,
                images: {
                    ...legacyImages,
                    avatar: avatarPath,
                    token: tokenPath,
                    idle: idlePath,
                    hover: hoverPath,
                    idleAdjust: managedPresentationToNpcAdjust(media.idle || media.token || media.avatar, legacyImages.idleAdjust || legacyImages.avatarAdjust),
                    hoverAdjust: managedPresentationToNpcAdjust(media.hover || media.idle || media.token || media.avatar, legacyImages.hoverAdjust),
                    idleFallback: tokenPath || avatarPath || legacyImages.idleFallback || '',
                    idleFrameCircle: managedPresentationToFrameCircle(media.idle || media.token || media.avatar, legacyImages.idleFrameCircle || legacyImages.tokenFrameCircle),
                    hoverFrameCircle: managedPresentationToFrameCircle(media.hover || media.idle || media.token || media.avatar, legacyImages.hoverFrameCircle),
                    hoverFallback: idlePath || tokenPath || avatarPath || legacyImages.hoverFallback || '',
                    avatarFallback: tokenPath || idlePath || legacyImages.avatarFallback || ''
                },
                updatedAt: actor.updatedAt || legacyNpc?.updatedAt || '',
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



        function normalizeManagedNpcStatus(value, fallback) {
            const status = String(value || '').trim().toLowerCase();
            if (status.includes('mort') || status === 'dead') return 'morto';
            if (status.includes('viv') || status === 'alive') return 'vivo';
            if (status.includes('ignot') || status.includes('sconosciut') || status === 'unknown') return 'ignoto';
            const legacyStatus = String(fallback || '').trim().toLowerCase();
            return ['vivo', 'morto', 'ignoto'].includes(legacyStatus) ? legacyStatus : 'ignoto';
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

        function renderNpcGroups(container, npcs, base_path) {
            container.innerHTML = '';
            const groups = groupNpcsByCategory(npcs);
            groups.forEach((group) => {
                const section = document.createElement('section');
                section.className = 'npc-category-group';
                section.dataset.npcCategory = group.category || '';

                const header = document.createElement('header');
                header.className = 'npc-category-header';
                const title = document.createElement('h2');
                title.className = 'npc-category-title';
                title.textContent = group.category || 'Senza categoria';
                const count = document.createElement('span');
                count.className = 'npc-category-count';
                count.textContent = String(group.items.length);
                header.append(title, count);
                section.appendChild(header);

                const cards = document.createElement('div');
                cards.className = 'npc-category-list';
                group.items.forEach((npc) => {
                    cards.appendChild(createNpcCard(npc, base_path));
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
                const key = category.toLocaleLowerCase('it') || '__uncategorized__';
                if (!groups.has(key)) {
                    groups.set(key, { category, priority: null, items: [] });
                }
                const group = groups.get(key);
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

        function createNpcCard(npc, base_path) {
            const statusMap = {
                vivo: { text: 'VIVO', class: 'status-vivo' },
                morto: { text: 'MORTO', class: 'status-morto' },
                ignoto: { text: 'IGNOTO', class: 'status-sconosciuto' }
            };
            const statusInfo = statusMap[npc.status] || { text: 'N/A', class: '' };

            const card = document.createElement('a');
            card.href = npc.managedActorUrl || buildNpcDetailUrl({ id: npc.id, type: 'npc' });
            card.className = 'npc-card';
            const hiddenFromPlayers = npc.hidden === true || npc.status === 'hidden';
            if (hiddenFromPlayers) card.classList.add('npc-card--dm-hidden');
            const avatarImage = npc.images.idle || npc.images.token || npc.images.avatar || '';
            const hoverImage = npc.images.hover || npc.images.token || avatarImage;
            const avatarFallback = npc.images.idleFallback || npc.images.token || npc.images.avatarFallback || '';
            const hoverFallback = npc.images.hoverFallback || avatarFallback;
            if (normalizeImageIdentity(avatarImage) === normalizeImageIdentity(hoverImage)) {
                card.classList.add('npc-card--no-avatar-swap');
            }

            card.innerHTML = `
                <span class="npc-status-badge ${statusInfo.class}">${statusInfo.text}</span>
                ${hiddenFromPlayers ? '<span class="npc-player-visibility-badge"><i class="fas fa-user-shield" aria-hidden="true"></i>Solo M</span>' : ''}
                <div class="npc-avatar-container">
                    <img src="${resolveNpcImageUrl(npc, avatarImage, base_path)}" data-fallback-src="${resolveNpcImageUrl(npc, avatarFallback, base_path)}" alt="${npc.name}" class="npc-img-pop img-main" loading="lazy" decoding="async" style="${buildImageStyle('avatar', npc.images.idleAdjust || npc.images.avatarAdjust, npc.images.hoverAdjust)}" onerror="this.src=this.dataset.fallbackSrc || ''; this.onerror=null;">
                    <img src="${resolveNpcImageUrl(npc, hoverImage, base_path)}" data-fallback-src="${resolveNpcImageUrl(npc, hoverFallback, base_path)}" alt="${npc.name} Reveal" class="npc-img-pop img-hover" loading="lazy" decoding="async" style="${buildImageStyle('hover', npc.images.hoverAdjust, npc.images.idleAdjust || npc.images.avatarAdjust)}" onerror="this.src=this.dataset.fallbackSrc || ''; this.onerror=null;">
                </div>
                <div class="npc-info">
                    <div class="npc-header">
                        <h3 class="npc-name">${npc.name}</h3>
                        <span class="npc-role">${npc.role}</span>
                    </div>
                    <p class="npc-desc">${npc.quote}</p>
                </div>
                <i class="fas fa-chevron-right arrow-icon"></i>
            `;
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

        function normalizeImageIdentity(path) {
            return String(path || '')
                .trim()
                .replace(/[?#].*$/, '')
                .replace(/^https?:\/\/[^/]+\/?/i, '')
                .replace(/^\/+/, '')
                .toLowerCase();
        }
