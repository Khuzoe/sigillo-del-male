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

                const visibleNpcs = window.WikiSpoiler
                    ? window.WikiSpoiler.filterVisible(npcs)
                    : npcs.filter(npc => !npc.hidden);

                const recencyData = await loadNpcRecencyData(base_path);
                const sortedNpcs = sortNpcsByRecency(visibleNpcs, recencyData);

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

        function appendAssetVersion(url, version) {
            return window.CriptaApp.utils.appendAssetVersion(url, version);
        }

        function resolveNpcImageUrl(npc, path, base_path = '../assets/') {
            return appendAssetVersion(resolveImageUrl(path, base_path), npc?.updatedAt);
        }

        async function loadNpcRecencyData(base_path) {
            try {
                const response = await fetch(window.CriptaApp?.urls?.data?.('npc-recency.json') || base_path + 'data/npc-recency.json');
                if (!response.ok) return { byId: {} };
                const payload = await response.json();
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
                const response = await fetch(window.CriptaApp?.urls?.data?.('characters.json') || '../assets/data/characters.json');
                if (response.ok) {
                    const payload = await response.json();
                    const data = Array.isArray(payload) ? payload : payload?.data;
                    if (Array.isArray(data)) return normalizeCharactersCollection(data);
                }
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
            card.href = buildNpcDetailUrl({ id: npc.id, type: 'npc' });
            card.className = 'npc-card';
            const avatarImage = npc.images.idle || npc.images.token || npc.images.avatar || '';
            const hoverImage = npc.images.hover || npc.images.token || avatarImage;
            const avatarFallback = npc.images.idleFallback || npc.images.token || npc.images.avatarFallback || '';
            const hoverFallback = npc.images.hoverFallback || avatarFallback;
            if (normalizeImageIdentity(avatarImage) === normalizeImageIdentity(hoverImage)) {
                card.classList.add('npc-card--no-avatar-swap');
            }

            card.innerHTML = `
                <span class="npc-status-badge ${statusInfo.class}">${statusInfo.text}</span>
                <div class="npc-avatar-container">
                    <img src="${resolveNpcImageUrl(npc, avatarImage, base_path)}" data-fallback-src="${resolveNpcImageUrl(npc, avatarFallback, base_path)}" alt="${npc.name}" class="npc-img-pop img-main" style="${buildImageStyle('avatar', npc.images.idleAdjust || npc.images.avatarAdjust, npc.images.hoverAdjust)}" onerror="this.src=this.dataset.fallbackSrc || ''; this.onerror=null;">
                    <img src="${resolveNpcImageUrl(npc, hoverImage, base_path)}" data-fallback-src="${resolveNpcImageUrl(npc, hoverFallback, base_path)}" alt="${npc.name} Reveal" class="npc-img-pop img-hover" style="${buildImageStyle('hover', npc.images.hoverAdjust, npc.images.idleAdjust || npc.images.avatarAdjust)}" onerror="this.src=this.dataset.fallbackSrc || ''; this.onerror=null;">
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
