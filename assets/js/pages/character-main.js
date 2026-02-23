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

        function renderMarkdown(md, options = {}) {
            const context = options.context || null;
            if (!md) return '';
            const inline = (text) => {
                const escaped = text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                return escaped
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.+?)\*/g, '<em>$1</em>')
                    .replace(/`(.+?)`/g, '<code>$1</code>');
            };

            const lines = md.replace(/\r\n?/g, '\n').split('\n');
            const out = [];
            let i = 0;
            while (i < lines.length) {
                if (/^\s*$/.test(lines[i])) { i++; continue; }

                // Subtitle as a single italic line at start (image_box, etc.)
                if (context === 'image_box' && i === 0) {
                    const m = lines[i].trim().match(/^\*(.+)\*$/);
                    if (m) {
                        out.push(`<p class="doc-subtitle">${inline(m[1])}</p>`);
                        i++; continue;
                    }
                }

                if (/^###\s+/.test(lines[i])) {
                    out.push(`<h4 class="doc-heading">${inline(lines[i].replace(/^###\s+/, ''))}</h4>`);
                    i++; continue;
                }
                if (/^##\s+/.test(lines[i])) {
                    out.push(`<h3 class="doc-heading">${inline(lines[i].replace(/^##\s+/, ''))}</h3>`);
                    i++; continue;
                }
                if (/^#\s+/.test(lines[i])) {
                    out.push(`<h2 class="doc-heading">${inline(lines[i].replace(/^#\s+/, ''))}</h2>`);
                    i++; continue;
                }

                if (/^>\s?/.test(lines[i])) {
                    const quote = [];
                    while (i < lines.length && /^>\s?/.test(lines[i])) {
                        quote.push(lines[i].replace(/^>\s?/, ''));
                        i++;
                    }
                    const rawQuote = quote.join('\n').trim();
                    const quoteText = inline(rawQuote).replace(/\n/g, '<br>');
                    out.push(`<div class="document-quote"><i class="fas fa-feather-alt"></i><span>${quoteText}</span></div>`);
                    continue;
                }

                if (/^- /.test(lines[i])) {
                    const items = [];
                    while (i < lines.length && /^- /.test(lines[i])) {
                        items.push(lines[i].replace(/^- /, ''));
                        i++;
                    }
                    const lis = items.map(t => `<li>${inline(t)}</li>`).join('');
                    out.push(`<ul class="doc-list">${lis}</ul>`);
                    continue;
                }

                const para = [];
                while (i < lines.length && !/^\s*$/.test(lines[i])) {
                    para.push(lines[i]);
                    i++;
                }
                const paraClass = context === 'image_box' ? ' class="doc-paragraph"' : '';
                out.push(`<p${paraClass}>${inline(para.join(' '))}</p>`);
            }
            return out.join('\n');
        }

        async function loadCharactersManifest() {
            const yamlUrl = '../../assets/data/characters/index.yaml';
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

            const jsonUrl = '../../assets/data/characters/index.json';
            const jsonResp = await fetch(jsonUrl);
            if (jsonResp.ok) return jsonResp.json();
            throw new Error('Impossibile caricare il manifest dei personaggi.');
        }

        async function loadCharacterYaml(entry) {
            const base = '../../assets/data/';
            const filePath = entry.file || `characters/${entry.id}.yaml`;
            const yamlUrl = base + filePath;
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
            throw new Error(`Impossibile caricare i dati del personaggio ${entry.id}`);
        }

        async function loadPlayersData() {
            const resp = await fetch('../../assets/data/players.json');
            if (!resp.ok) throw new Error(`File dati players (${resp.status}) non trovato.`);
            return resp.json();
        }

        async function hydrateContentBlocks(character) {
            if (!character || !Array.isArray(character.content_blocks)) return;
            const base = '../../assets/content/';
            await Promise.all(character.content_blocks.map(async (block) => {
                if (!block.markdown) return;
                const url = base + block.markdown;
                try {
                    const resp = await fetch(url);
                    const md = resp.ok ? await resp.text() : '';
                    block.markdownText = md;
                    block.markdownHtml = md ? renderMarkdown(md, { context: block.type }) : `<p>Impossibile caricare ${block.markdown}</p>`;
                } catch (err) {
                    console.warn(`Errore nel caricare ${block.markdown}:`, err);
                    block.markdownHtml = `<p>Impossibile caricare ${block.markdown}</p>`;
                }
            }));
        }

        async function loadQuestsData() {
            try {
                const resp = await fetch('../../assets/data/quests.json');
                if (resp.ok) return resp.json();
            } catch (e) {
                console.warn("Impossibile caricare quests.json", e);
            }
            return [];
        }

        const INVENTORY_API_URL = 'https://sigillo-api.khuzoe.workers.dev/api/inventory';
        const INVENTORY_CACHE_KEY = 'cds_inventory_api_cache_v1';
        const INVENTORY_CACHE_TTL_MS = 5 * 60 * 1000;
        const INVENTORY_EXCLUDED_TYPES = new Set(['class', 'subclass', 'feat', 'background', 'race', 'spell']);
        const SPELL_SCHOOL_LABELS = {
            abj: 'Abiurazione',
            con: 'Evocazione',
            div: 'Divinazione',
            enc: 'Ammaliamento',
            evo: 'Invocazione',
            ill: 'Illusione',
            nec: 'Necromanzia',
            trs: 'Trasmutazione'
        };
        const DURATION_UNITS_LABELS = {
            inst: 'Istantanea',
            round: 'round',
            minute: 'min',
            hour: 'ora',
            day: 'giorno'
        };
        const RANGE_UNITS_LABELS = {
            touch: 'Contatto',
            self: 'Se stesso',
            ft: 'ft',
            m: 'm'
        };
        const PLAYER_NAME_ALIASES = {
            apothecary: ['apothecary'],
            garun: ["ga'run", 'ga run', 'garun'],
            randra: ["ran'dra", 'ran dra', 'randra'],
            valdor: ['valdor']
        };

        let inventoryRequestPromise = null;
        let inventoryMemoryCache = null;

        function escapeHtml(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function normalizeText(value) {
            return String(value || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, '');
        }

        function formatToken(value) {
            const text = String(value || '')
                .replace(/([a-z])([A-Z])/g, '$1 $2')
                .replace(/[_-]+/g, ' ')
                .trim();
            if (!text) return '';
            return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
        }

        function getSafeSessionStorageItem(key) {
            try {
                return window.sessionStorage.getItem(key);
            } catch (_) {
                return null;
            }
        }

        function setSafeSessionStorageItem(key, value) {
            try {
                window.sessionStorage.setItem(key, value);
            } catch (_) {
                // Ignore storage quota / privacy mode errors.
            }
        }

        function parseInventoryCache(rawValue) {
            if (!rawValue) return null;
            try {
                const parsed = JSON.parse(rawValue);
                if (!parsed || typeof parsed.fetchedAt !== 'number' || !parsed.data) return null;
                return parsed;
            } catch (_) {
                return null;
            }
        }

        function isInventoryCacheFresh(cache) {
            if (!cache || typeof cache.fetchedAt !== 'number') return false;
            return (Date.now() - cache.fetchedAt) < INVENTORY_CACHE_TTL_MS;
        }

        async function loadInventoryData() {
            if (inventoryMemoryCache && isInventoryCacheFresh(inventoryMemoryCache)) {
                return inventoryMemoryCache.data;
            }

            const storedCache = parseInventoryCache(getSafeSessionStorageItem(INVENTORY_CACHE_KEY));
            if (storedCache && isInventoryCacheFresh(storedCache)) {
                inventoryMemoryCache = storedCache;
                return storedCache.data;
            }

            if (inventoryRequestPromise) {
                return inventoryRequestPromise;
            }

            inventoryRequestPromise = (async () => {
                try {
                    const response = await fetch(INVENTORY_API_URL, {
                        method: 'GET',
                        headers: {
                            Accept: 'application/json'
                        }
                    });

                    if (!response.ok) {
                        throw new Error(`Inventory API HTTP ${response.status}`);
                    }

                    const payload = await response.json();
                    if (!payload || !Array.isArray(payload.actors)) {
                        throw new Error('Inventory API: formato non valido.');
                    }

                    const cacheEntry = {
                        fetchedAt: Date.now(),
                        data: payload
                    };
                    inventoryMemoryCache = cacheEntry;
                    setSafeSessionStorageItem(INVENTORY_CACHE_KEY, JSON.stringify(cacheEntry));
                    return payload;
                } catch (error) {
                    if (storedCache && storedCache.data && Array.isArray(storedCache.data.actors)) {
                        console.warn('Inventory API non raggiungibile, uso cache precedente.', error);
                        return storedCache.data;
                    }
                    throw error;
                } finally {
                    inventoryRequestPromise = null;
                }
            })();

            return inventoryRequestPromise;
        }

        function findPlayerActor(payload, character) {
            const actors = Array.isArray(payload && payload.actors) ? payload.actors : [];
            if (!actors.length || !character) return null;

            const nameKeys = new Set();
            nameKeys.add(normalizeText(character.name));
            if (character.inventory_api_name) {
                nameKeys.add(normalizeText(character.inventory_api_name));
            }
            if (Array.isArray(character.inventory_api_aliases)) {
                character.inventory_api_aliases.forEach((alias) => nameKeys.add(normalizeText(alias)));
            }
            const aliases = PLAYER_NAME_ALIASES[character.id] || [];
            aliases.forEach((alias) => nameKeys.add(normalizeText(alias)));

            const byExactName = actors.find((actor) => nameKeys.has(normalizeText(actor.name)));
            if (byExactName) return byExactName;

            return actors.find((actor) => {
                const actorKey = normalizeText(actor.name);
                if (!actorKey) return false;
                for (const key of nameKeys) {
                    if (!key) continue;
                    if (actorKey.includes(key) || key.includes(actorKey)) return true;
                }
                return false;
            }) || null;
        }

        function splitActorLoadout(actor) {
            const sourceEntries = Array.isArray(actor && actor.inventory) ? actor.inventory : [];
            const spells = [];
            const inventory = [];

            sourceEntries.forEach((entry) => {
                if (!entry || typeof entry !== 'object') return;
                if (entry.type === 'spell') {
                    spells.push(entry);
                    return;
                }
                if (!INVENTORY_EXCLUDED_TYPES.has(entry.type)) {
                    inventory.push(entry);
                }
            });

            inventory.sort((a, b) => {
                const typeOrder = String(a.type || '').localeCompare(String(b.type || ''), 'it');
                if (typeOrder !== 0) return typeOrder;
                return String(a.name || '').localeCompare(String(b.name || ''), 'it');
            });

            spells.sort((a, b) => {
                const parsedA = Number(a.level);
                const parsedB = Number(b.level);
                const levelA = Number.isFinite(parsedA) ? parsedA : 99;
                const levelB = Number.isFinite(parsedB) ? parsedB : 99;
                if (levelA !== levelB) return levelA - levelB;
                return String(a.name || '').localeCompare(String(b.name || ''), 'it');
            });

            return { inventory, spells };
        }

        function cleanDescription(value) {
            const simplifyFoundryInlineCommand = (command, args) => {
                const cmd = String(command || '').toLowerCase();
                const rawArgs = String(args || '').trim();
                if (!rawArgs) return '';

                const tokens = rawArgs.split(/\s+/);
                const valueTokens = [];
                for (const token of tokens) {
                    if (/^[\w-]+=/.test(token)) break;
                    valueTokens.push(token);
                }

                const baseValue = (valueTokens.length > 0 ? valueTokens.join(' ') : rawArgs).trim();

                if (cmd === 'damage' || cmd === 'r' || cmd === 'roll' || cmd === 'heal') {
                    const diceMatch = baseValue.match(/\b\d*d\d+(?:\s*[+\-]\s*\d*d?\d+)*\b/i);
                    if (diceMatch) {
                        return diceMatch[0].replace(/\s+/g, ' ').trim();
                    }
                }

                return baseValue;
            };

            const simplifyFoundryReference = (rawReference) => {
                const content = String(rawReference || '').trim();
                if (!content) return '';

                const match = content.match(/([a-z0-9_-]+)\s*=\s*("[^"]+"|'[^']+'|[^,\]|]+)/i);
                const rawLabel = match && match[2]
                    ? match[2]
                    : content.replace(/^[a-z0-9_-]+\s*=\s*/i, '');

                const label = String(rawLabel || '')
                    .trim()
                    .replace(/^["']|["']$/g, '')
                    .replace(/[_-]+/g, ' ')
                    .trim();

                if (!label) return '';
                return `<strong>${label}</strong>`;
            };

            return String(value || '')
                .replace(/\(\s*\[\[\s*\/([a-z0-9_-]+)\s+([^\]]+?)\s*\]\]\s*\)/gi, (_, command, args) => simplifyFoundryInlineCommand(command, args))
                .replace(/\[\[\s*\/([a-z0-9_-]+)\s+([^\]]+?)\s*\]\]/gi, (_, command, args) => simplifyFoundryInlineCommand(command, args))
                .replace(/\[\[[^\]]+\]\]/g, '')
                .replace(/@[\w-]+\[([^\]|]+)(?:\|[^\]]+)?\]/g, '$1')
                .replace(/&(?:amp;)?Reference\s*\[([^\]]+)\]/gi, (_, rawReference) => simplifyFoundryReference(rawReference))
                .trim();
        }

        function renderPlainDescriptionHtml(text) {
            const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
            if (!normalized) return '';

            return normalized
                .split(/\n{2,}/)
                .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
                .join('');
        }

        function sanitizeDescriptionHtml(html) {
            if (!html) return '';

            const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'h4', 'h5']);
            const BLOCKED_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button']);
            const parser = new DOMParser();
            const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
            const root = doc.body.firstElementChild;
            if (!root) return '';

            const sanitizeNode = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    return escapeHtml(node.textContent || '');
                }

                if (node.nodeType !== Node.ELEMENT_NODE) {
                    return '';
                }

                const tag = node.tagName.toLowerCase();
                if (BLOCKED_TAGS.has(tag)) {
                    return '';
                }

                const inner = Array.from(node.childNodes).map(sanitizeNode).join('');
                if (!ALLOWED_TAGS.has(tag)) {
                    return inner;
                }

                if (tag === 'br') {
                    return '<br>';
                }

                if (tag === 'a') {
                    const href = (node.getAttribute('href') || '').trim();
                    const isSafeHref = /^(https?:|mailto:|\/|#)/i.test(href);
                    if (isSafeHref) {
                        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner || escapeHtml(href)}</a>`;
                    }
                    return inner;
                }

                return `<${tag}>${inner}</${tag}>`;
            };

            return Array.from(root.childNodes).map(sanitizeNode).join('').trim();
        }

        function renderDescriptionHtml(value) {
            const cleaned = cleanDescription(value);
            if (!cleaned) return '';

            const hasHtmlTag = /<[^>]+>/.test(cleaned);
            if (!hasHtmlTag) {
                return renderPlainDescriptionHtml(cleaned);
            }

            const sanitized = sanitizeDescriptionHtml(cleaned);
            return sanitized || renderPlainDescriptionHtml(cleaned);
        }

        function getQuantityLabel(entry) {
            const quantity = Number(entry && entry.quantity);
            if (!Number.isFinite(quantity) || quantity <= 1) return '';
            return `x${quantity}`;
        }

        function formatSpellLevel(level) {
            if (!Number.isFinite(level)) return 'Livello ?';
            if (level === 0) return 'Trucchetto';
            return `Livello ${level}`;
        }

        function formatDuration(duration) {
            if (!duration || typeof duration !== 'object') return '';
            const rawUnits = String(duration.units || '').toLowerCase();
            if (!rawUnits) return '';
            if (rawUnits === 'inst') return DURATION_UNITS_LABELS.inst;
            const unitLabel = DURATION_UNITS_LABELS[rawUnits] || rawUnits;
            const value = Number(duration.value);
            if (!Number.isFinite(value)) return formatToken(unitLabel);
            const plural = value > 1 && unitLabel === 'ora' ? 'ore' : (value > 1 && unitLabel === 'giorno' ? 'giorni' : unitLabel);
            return `${value} ${plural}`;
        }

        function formatRange(range) {
            if (!range || typeof range !== 'object') return '';
            const rawUnits = String(range.units || '').toLowerCase();
            if (!rawUnits) return '';
            const unitLabel = RANGE_UNITS_LABELS[rawUnits] || rawUnits;
            const value = Number(range.value);
            if (!Number.isFinite(value)) return formatToken(unitLabel);
            return `${value} ${unitLabel}`;
        }

        function formatGeneratedAtLabel(payload) {
            if (!payload || !payload.generatedAt) return 'Aggiornamento: non disponibile';
            const date = new Date(payload.generatedAt);
            if (Number.isNaN(date.getTime())) return 'Aggiornamento: non disponibile';
            const formatted = new Intl.DateTimeFormat('it-IT', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }).format(date);
            return `Aggiornamento: ${formatted}`;
        }

        function toFiniteNumber(value) {
            const num = Number(value);
            return Number.isFinite(num) ? num : null;
        }

        function formatNumberIt(value, maxFractionDigits = 0) {
            const num = toFiniteNumber(value);
            if (num === null) return '—';
            return new Intl.NumberFormat('it-IT', { maximumFractionDigits: maxFractionDigits }).format(num);
        }

        function formatWeightIt(value) {
            const num = toFiniteNumber(value);
            if (num === null) return '—';
            return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(num);
        }

        function getUniqueItemList(items) {
            const seen = new Set();
            return (Array.isArray(items) ? items : []).filter((item) => {
                if (!item || typeof item !== 'object') return false;
                const key = String(item.id || item.name || '').toLowerCase();
                if (!key) return false;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        function renderOverviewItemPills(items, emptyLabel) {
            const list = getUniqueItemList(items);
            if (!list.length) {
                return `<p class="player-overview-empty">${escapeHtml(emptyLabel)}</p>`;
            }

            return `
                <div class="player-overview-chip-list">
                    ${list.map((item) => {
                        const quantityLabel = getQuantityLabel(item);
                        return `<span class="player-overview-chip">${escapeHtml(item.name || 'Elemento')} ${quantityLabel ? `<small>${escapeHtml(quantityLabel)}</small>` : ''}</span>`;
                    }).join('')}
                </div>
            `;
        }

        function renderSpellSlotsOverview(actor) {
            const spellSlots = actor && actor.spellSlots ? actor.spellSlots : {};
            const perLevel = Array.isArray(spellSlots.perLevel)
                ? spellSlots.perLevel
                    .filter((slot) => toFiniteNumber(slot.total) !== null && Number(slot.total) > 0)
                    .sort((a, b) => Number(a.level || 0) - Number(b.level || 0))
                : [];

            const totalSlots = toFiniteNumber(spellSlots.totals && spellSlots.totals.total);
            const usedSlots = toFiniteNumber(spellSlots.totals && spellSlots.totals.used);
            const availableSlots = toFiniteNumber(spellSlots.totals && spellSlots.totals.available);
            const hasUsableTotals = totalSlots !== null && totalSlots > 0;

            if (!perLevel.length && !hasUsableTotals) {
                return '';
            }

            const slotsSummary = hasUsableTotals
                ? `
                <div class="slots-overview-summary slots-overview-summary--compact">
                    <strong>${formatNumberIt(availableSlots !== null ? availableSlots : Math.max(0, totalSlots - (usedSlots || 0)))} / ${formatNumberIt(totalSlots)}</strong>
                </div>
                `
                : '';

            const levelTiles = perLevel.length
                ? `
                <div class="slots-overview-grid">
                    ${perLevel.map((slot) => {
                        const level = toFiniteNumber(slot.level);
                        const total = toFiniteNumber(slot.total) || 0;
                        const available = toFiniteNumber(slot.available);
                        const used = toFiniteNumber(slot.used);
                        const shownAvailable = available !== null ? available : Math.max(0, total - (used || 0));
                        const isEmpty = shownAvailable <= 0;
                        return `
                            <div class="slot-level-tile ${isEmpty ? 'is-empty' : ''}">
                                <span class="slot-level-title">${level === 0 ? 'C' : `L${level || '?'}`}</span>
                                <span class="slot-level-ratio">${formatNumberIt(shownAvailable)} / ${formatNumberIt(total)}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
                `
                : '';

            return `${slotsSummary}${levelTiles}`;
        }

        function getXpOverviewData(actor) {
            const xpCurrent = toFiniteNumber(actor.xp && actor.xp.current);
            const xpNext = toFiniteNumber(actor.xp && actor.xp.nextLevel);
            const xpMissing = toFiniteNumber(actor.xp && actor.xp.missingToLevel);
            const hasXp = xpCurrent !== null && xpNext !== null && xpNext > 0;
            const xpRatio = hasXp ? Math.min(100, Math.max(0, (xpCurrent / xpNext) * 100)) : 0;
            const xpLevelReady = hasXp && ((xpMissing !== null && xpMissing <= 0) || xpCurrent >= xpNext);

            return {
                hasXp,
                xpCurrent,
                xpNext,
                xpMissing,
                xpRatio,
                xpLevelReady
            };
        }

        function renderXpOverviewBody(actor) {
            if (!actor || typeof actor !== 'object') {
                return '<p class="player-overview-empty">Dati XP non disponibili.</p>';
            }

            const xpData = getXpOverviewData(actor);
            if (!xpData.hasXp) {
                return '<p class="player-overview-empty">Dati XP non disponibili.</p>';
            }

            return `
                <p class="player-overview-main">
                    <strong>${formatNumberIt(xpData.xpCurrent)}</strong>
                    <span>/ ${formatNumberIt(xpData.xpNext)} XP</span>
                </p>
                <div class="xp-progress ${xpData.xpLevelReady ? 'is-level-ready' : ''}">
                    <div class="xp-progress-fill" style="width: ${xpData.xpRatio.toFixed(2)}%"></div>
                </div>
                <p class="player-overview-note ${xpData.xpLevelReady ? 'is-ready' : ''}">
                    ${xpData.xpLevelReady ? 'Pronto per il level up' : `${formatNumberIt(xpData.xpMissing || 0)} XP al prossimo livello`}
                </p>
            `;
        }

        function getWeightOverviewData(actor) {
            const weightCarried = toFiniteNumber(actor.weight && actor.weight.carried);
            const weightCapacity = toFiniteNumber(actor.weight && actor.weight.capacity);
            const weightPercent = toFiniteNumber(actor.weight && actor.weight.percent);
            const computedPercent = (weightCarried !== null && weightCapacity && weightCapacity > 0)
                ? (weightCarried / weightCapacity) * 100
                : null;
            const normalizedWeightPercent = computedPercent !== null
                ? Math.max(0, Math.min(100, computedPercent))
                : (weightPercent !== null ? Math.max(0, Math.min(100, weightPercent)) : 0);

            let encumbranceTier = 'regular';
            if (normalizedWeightPercent > (2 / 3) * 100) {
                encumbranceTier = 'heavy';
            } else if (normalizedWeightPercent >= (1 / 3) * 100) {
                encumbranceTier = 'encumbered';
            }

            return {
                weightCarried,
                weightCapacity,
                encumbranceTier,
                normalizedWeightPercent
            };
        }

        function renderWeightOverviewBody(actor) {
            if (!actor || typeof actor !== 'object') {
                return '<p class="player-overview-empty">Dati peso non disponibili.</p>';
            }

            const weightData = getWeightOverviewData(actor);
            if (weightData.weightCarried === null || weightData.weightCapacity === null) {
                return '<p class="player-overview-empty">Dati peso non disponibili.</p>';
            }

            const progressClass = weightData.encumbranceTier === 'heavy'
                ? 'is-heavily-encumbered'
                : (weightData.encumbranceTier === 'encumbered' ? 'is-encumbered' : '');
            const noteClass = weightData.encumbranceTier === 'heavy'
                ? 'is-danger'
                : (weightData.encumbranceTier === 'encumbered' ? 'is-warning' : '');
            const noteLabel = weightData.encumbranceTier === 'heavy'
                ? 'Gravemente Appesantito'
                : (weightData.encumbranceTier === 'encumbered' ? 'Appesantito' : 'Regolare');

            return `
                <p class="player-overview-main">
                    <strong>${formatWeightIt(weightData.weightCarried)}</strong>
                    <span>/ ${formatWeightIt(weightData.weightCapacity)} kg</span>
                </p>
                <div class="xp-progress has-threshold-markers ${progressClass}">
                    <div class="xp-progress-fill" style="width: ${weightData.normalizedWeightPercent.toFixed(2)}%"></div>
                </div>
                <p class="player-overview-note ${noteClass}">
                    ${noteLabel}
                </p>
            `;
        }

        function getAttunedItems(actor) {
            const attunedItems = getUniqueItemList(
                (Array.isArray(actor.attunementItems) && actor.attunementItems.length > 0)
                    ? actor.attunementItems
                    : (Array.isArray(actor.inventory) ? actor.inventory.filter((item) => item && item.attuned) : [])
            );

            return attunedItems;
        }

        function renderInventoryPanelSummary(actor) {
            if (!actor || typeof actor !== 'object') return '';
            const attunedItems = getAttunedItems(actor);

            return `
                <div class="player-overview-grid loadout-panel-summary">
                    <section class="player-overview-card">
                        <h4><i class="fas fa-weight-hanging"></i> Carico</h4>
                        ${renderWeightOverviewBody(actor)}
                    </section>

                    <section class="player-overview-card player-overview-card--wide">
                        <h4><i class="fas fa-gem"></i> Sintonizzati</h4>
                        ${renderOverviewItemPills(attunedItems, 'Nessun oggetto sintonizzato.')}
                    </section>
                </div>
            `;
        }

        function renderSpellsPanelSummary(actor, spellEntries) {
            if (!actor || typeof actor !== 'object') return '';
            if (!Array.isArray(spellEntries) || spellEntries.length === 0) return '';

            const slotOverviewHtml = renderSpellSlotsOverview(actor);
            if (!slotOverviewHtml) return '';

            return `
                <div class="player-overview-grid loadout-panel-summary">
                    <section class="player-overview-card player-overview-card--wide">
                        <h4><i class="fas fa-bolt"></i> Slot Incantesimi</h4>
                        ${slotOverviewHtml}
                    </section>
                </div>
            `;
        }

        function renderPlayerXpSidebarHtml(actor) {
            return `
                <h4><i class="fas fa-star"></i> Esperienza</h4>
                ${renderXpOverviewBody(actor)}
            `;
        }

        function renderPlayerXpSidebarError(message) {
            const xpCard = document.getElementById('player-xp-right-card');
            if (!xpCard) return;
            xpCard.innerHTML = `
                <h4><i class="fas fa-star"></i> Esperienza</h4>
                <p class="player-overview-empty">${escapeHtml(message || 'Dati XP non disponibili.')}</p>
            `;
        }

        function hydratePlayerRightOverview(character, payload) {
            const xpCard = document.getElementById('player-xp-right-card');
            if (!xpCard) return;

            const actor = findPlayerActor(payload, character);
            xpCard.innerHTML = renderPlayerXpSidebarHtml(actor);
        }

        function getSpellLevelMeta(level) {
            const parsedLevel = Number(level);
            if (!Number.isFinite(parsedLevel)) {
                return {
                    key: 'unknown',
                    label: '?',
                    tooltip: 'Livello sconosciuto',
                    sortOrder: 99
                };
            }

            if (parsedLevel === 0) {
                return {
                    key: 'cantrip',
                    label: 'C',
                    tooltip: 'Cantrip',
                    sortOrder: 0
                };
            }

            return {
                key: `lvl-${parsedLevel}`,
                label: String(parsedLevel),
                tooltip: `Slot livello ${parsedLevel}`,
                sortOrder: parsedLevel
            };
        }

        function getInventoryTypeMeta(type) {
            const rawType = String(type || '').trim();
            if (!rawType) {
                return {
                    key: 'unknown',
                    label: 'Altro'
                };
            }

            return {
                key: normalizeText(rawType) || 'unknown',
                label: formatToken(rawType)
            };
        }

        function renderInventoryTypeFilters(entries) {
            if (!entries.length) return '';

            const typeMap = new Map();
            entries.forEach((entry) => {
                const meta = getInventoryTypeMeta(entry.type);
                if (!typeMap.has(meta.key)) {
                    typeMap.set(meta.key, meta);
                }
            });

            const types = Array.from(typeMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'it'));
            const buttons = types.map((typeMeta) => `
                <button
                    class="inventory-type-filter"
                    type="button"
                    data-inventory-filter="${typeMeta.key}"
                    aria-label="Mostra solo ${escapeHtml(typeMeta.label)}"
                    title="Mostra solo ${escapeHtml(typeMeta.label)}"
                >
                    ${escapeHtml(typeMeta.label)}
                </button>
            `).join('');

            return `
                <div class="inventory-type-filters" role="group" aria-label="Filtri tipo oggetto">
                    <button class="inventory-type-filter is-active" type="button" data-inventory-filter="all" aria-label="Tutti i tipi" title="Tutti i tipi">Tutti</button>
                    ${buttons}
                </div>
            `;
        }

        function renderSpellLevelFilters(entries) {
            if (!entries.length) return '';

            const levelsMap = new Map();
            entries.forEach((entry) => {
                const meta = getSpellLevelMeta(entry.level);
                if (!levelsMap.has(meta.key)) {
                    levelsMap.set(meta.key, meta);
                }
            });

            const levels = Array.from(levelsMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);
            const buttons = levels.map((levelMeta) => `
                <button
                    class="spell-level-filter"
                    type="button"
                    data-level-filter="${levelMeta.key}"
                    aria-label="${levelMeta.tooltip}"
                    title="${levelMeta.tooltip}"
                >
                    ${levelMeta.label}
                </button>
            `).join('');

            return `
                <div class="spell-level-filters" role="group" aria-label="Filtri livello incantesimi">
                    <button class="spell-level-filter is-active" type="button" data-level-filter="all" aria-label="Tutti i livelli" title="Tutti i livelli">All</button>
                    ${buttons}
                </div>
            `;
        }

        function renderLoadoutDisclosure(title, quantityLabel, description, badges, extraClass = '', dataAttributes = '') {
            const bodyParts = [];
            if (description) {
                const descriptionHtml = renderDescriptionHtml(description);
                if (descriptionHtml) {
                    bodyParts.push(`<div class="loadout-entry-description">${descriptionHtml}</div>`);
                }
            }
            if (badges.length > 0) {
                bodyParts.push(`<div class="loadout-chip-row">${badges.map((badge) => `<span class="loadout-chip">${escapeHtml(badge)}</span>`).join('')}</div>`);
            }
            if (bodyParts.length === 0) {
                bodyParts.push('<p class="loadout-entry-description">Nessun dettaglio disponibile.</p>');
            }

            return `
                <details class="loadout-entry ${extraClass}" ${dataAttributes}>
                    <summary class="loadout-entry-toggle">
                        <span class="loadout-entry-title">${escapeHtml(title || 'Elemento senza nome')}</span>
                        <span class="loadout-entry-controls">
                            ${quantityLabel ? `<span class="loadout-qty">${escapeHtml(quantityLabel)}</span>` : ''}
                            <span class="loadout-entry-chevron" aria-hidden="true"><i class="fas fa-chevron-down"></i></span>
                        </span>
                    </summary>
                    <div class="loadout-entry-body">
                        ${bodyParts.join('')}
                    </div>
                </details>
            `;
        }

        function renderInventoryEntries(entries) {
            if (!entries.length) {
                return '<p class="loadout-empty">Nessun oggetto disponibile.</p>';
            }

            const groupsMap = new Map();
            entries.forEach((entry) => {
                const containerId = entry.container && entry.container.id ? String(entry.container.id) : '__loose__';
                const containerName = entry.container && entry.container.name
                    ? String(entry.container.name)
                    : 'Senza contenitore';

                if (!groupsMap.has(containerId)) {
                    groupsMap.set(containerId, {
                        id: containerId,
                        name: containerName,
                        isLoose: containerId === '__loose__',
                        entries: []
                    });
                }
                groupsMap.get(containerId).entries.push(entry);
            });

            const groups = Array.from(groupsMap.values());
            groups.forEach((group) => {
                group.entries.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'it'));
            });

            groups.sort((a, b) => {
                if (a.isLoose !== b.isLoose) return a.isLoose ? -1 : 1;
                return a.name.localeCompare(b.name, 'it');
            });

            const renderedGroups = groups.map((group) => {
                const entriesHtml = group.entries.map((entry) => {
                    const badges = [];
                    const typeMeta = getInventoryTypeMeta(entry.type);
                    badges.push(typeMeta.label);
                    if (entry.rarity) badges.push(`Rarita: ${formatToken(entry.rarity)}`);
                    if (entry.attuned) badges.push('Sintonizzato');

                    const description = cleanDescription(entry.description);
                    const quantityLabel = getQuantityLabel(entry);

                    return renderLoadoutDisclosure(
                        entry.name || 'Oggetto senza nome',
                        quantityLabel,
                        description,
                        badges,
                        '',
                        `data-inventory-type="${typeMeta.key}"`
                    );
                }).join('');

                const icon = group.isLoose ? 'fa-hand-holding' : 'fa-box-archive';
                const groupName = group.isLoose ? 'Senza contenitore' : group.name;

                return `
                    <details class="inventory-group" data-inventory-group open>
                        <summary class="inventory-group-header">
                            <div class="inventory-group-title">
                                <i class="fas ${icon}" aria-hidden="true"></i>
                                <span>${escapeHtml(groupName)}</span>
                            </div>
                            <span class="inventory-group-controls">
                                <span class="inventory-group-count" data-group-count>${group.entries.length}</span>
                                <span class="inventory-group-chevron" aria-hidden="true"><i class="fas fa-chevron-down"></i></span>
                            </span>
                        </summary>
                        <div class="inventory-group-body">
                            ${entriesHtml}
                        </div>
                    </details>
                `;
            }).join('');

            return `<div class="inventory-groups">${renderedGroups}</div>`;
        }

        function renderSpellEntries(entries) {
            if (!entries.length) {
                return '<p class="loadout-empty">Nessun incantesimo preparato.</p>';
            }

            return entries.map((entry) => {
                const badges = [formatSpellLevel(Number(entry.level))];
                const schoolCode = String(entry.school || '').toLowerCase();
                if (schoolCode) badges.push(SPELL_SCHOOL_LABELS[schoolCode] || formatToken(schoolCode));
                if (entry.prepared) badges.push('Preparato');
                if (entry.concentration) badges.push('Concentrazione');

                if (entry.activation && entry.activation.type) {
                    badges.push(`Attivazione: ${formatToken(entry.activation.type)}`);
                }

                const rangeLabel = formatRange(entry.range);
                if (rangeLabel) badges.push(`Raggio: ${rangeLabel}`);

                const durationLabel = formatDuration(entry.duration);
                if (durationLabel) badges.push(`Durata: ${durationLabel}`);

                const description = cleanDescription(entry.description);
                const quantityLabel = getQuantityLabel(entry);
                const levelMeta = getSpellLevelMeta(entry.level);

                return renderLoadoutDisclosure(
                    entry.name || 'Incantesimo senza nome',
                    quantityLabel,
                    description,
                    badges,
                    'loadout-entry--spell',
                    `data-spell-level="${levelMeta.key}"`
                );
            }).join('');
        }

        function buildPlayerLoadoutHtml(character, payload) {
            const actor = findPlayerActor(payload, character);
            if (!actor) {
                return `
                    <h3><i class="fas fa-box-open"></i> Inventario e Incantesimi</h3>
                    <p class="loadout-empty">Nessun inventario trovato per ${escapeHtml(character.name)} nella risposta API.</p>
                `;
            }

            const { inventory, spells } = splitActorLoadout(actor);
            const owners = Array.isArray(actor.owners) ? actor.owners.map((owner) => owner.name).filter(Boolean) : [];
            const preparedSpells = spells.filter((spell) => spell.prepared);
            const inventorySummaryHtml = renderInventoryPanelSummary(actor);
            const spellsSummaryHtml = renderSpellsPanelSummary(actor, preparedSpells);

            return `
                <h3><i class="fas fa-box-open"></i> Inventario e Incantesimi</h3>
                <div class="loadout-meta">
                    <span>${escapeHtml(formatGeneratedAtLabel(payload))}</span>
                    <span>${owners.length > 0 ? `Giocatore: ${escapeHtml(owners.join(', '))}` : 'Giocatore: non disponibile'}</span>
                </div>
                <div class="loadout-tabs" role="tablist" aria-label="Schede inventario">
                    <button class="loadout-tab is-active" type="button" role="tab" aria-selected="true" data-panel-target="inventory">
                        Inventario <span class="loadout-count">${inventory.length}</span>
                    </button>
                    <button class="loadout-tab" type="button" role="tab" aria-selected="false" data-panel-target="spells">
                        Incantesimi <span class="loadout-count">${preparedSpells.length}</span>
                    </button>
                </div>
                <section class="loadout-panel is-active" data-panel="inventory" role="tabpanel">
                    ${inventorySummaryHtml}
                    ${renderInventoryTypeFilters(inventory)}
                    ${renderInventoryEntries(inventory)}
                </section>
                <section class="loadout-panel" data-panel="spells" role="tabpanel" hidden>
                    ${spellsSummaryHtml}
                    ${renderSpellLevelFilters(preparedSpells)}
                    ${renderSpellEntries(preparedSpells)}
                </section>
            `;
        }

        function initializeInventoryTypeFilters(cardElement) {
            const inventoryPanel = cardElement.querySelector('[data-panel="inventory"]');
            if (!inventoryPanel) return;

            const filterButtons = Array.from(inventoryPanel.querySelectorAll('.inventory-type-filter'));
            const inventoryEntries = Array.from(inventoryPanel.querySelectorAll('.loadout-entry[data-inventory-type]'));
            const inventoryGroups = Array.from(inventoryPanel.querySelectorAll('[data-inventory-group]'));

            if (!filterButtons.length || !inventoryEntries.length) return;

            const applyFilter = (filterValue) => {
                filterButtons.forEach((button) => {
                    const isActive = button.dataset.inventoryFilter === filterValue;
                    button.classList.toggle('is-active', isActive);
                    button.setAttribute('aria-pressed', String(isActive));
                });

                inventoryEntries.forEach((entry) => {
                    const entryType = entry.dataset.inventoryType || 'unknown';
                    entry.hidden = filterValue !== 'all' && entryType !== filterValue;
                });

                inventoryGroups.forEach((group) => {
                    const visibleEntries = group.querySelectorAll('.loadout-entry[data-inventory-type]:not([hidden])').length;
                    group.hidden = visibleEntries === 0;
                    const countEl = group.querySelector('[data-group-count]');
                    if (countEl) {
                        countEl.textContent = String(visibleEntries);
                    }
                });
            };

            filterButtons.forEach((button) => {
                button.addEventListener('click', () => {
                    applyFilter(button.dataset.inventoryFilter || 'all');
                });
            });

            applyFilter('all');
        }

        function initializeSpellLevelFilters(cardElement) {
            const spellPanel = cardElement.querySelector('[data-panel="spells"]');
            if (!spellPanel) return;

            const filterButtons = Array.from(spellPanel.querySelectorAll('.spell-level-filter'));
            const spellEntries = Array.from(spellPanel.querySelectorAll('.loadout-entry--spell'));

            if (!filterButtons.length || !spellEntries.length) return;

            const applyFilter = (filterValue) => {
                filterButtons.forEach((button) => {
                    const isActive = button.dataset.levelFilter === filterValue;
                    button.classList.toggle('is-active', isActive);
                    button.setAttribute('aria-pressed', String(isActive));
                });

                spellEntries.forEach((entry) => {
                    const entryLevel = entry.dataset.spellLevel || 'unknown';
                    entry.hidden = filterValue !== 'all' && entryLevel !== filterValue;
                });
            };

            filterButtons.forEach((button) => {
                button.addEventListener('click', () => {
                    applyFilter(button.dataset.levelFilter || 'all');
                });
            });

            applyFilter('all');
        }

        function initializeLoadoutTabs(cardElement) {
            const tabButtons = Array.from(cardElement.querySelectorAll('.loadout-tab'));
            const panels = Array.from(cardElement.querySelectorAll('.loadout-panel'));

            if (!tabButtons.length || !panels.length) return;

            const setActivePanel = (panelName) => {
                tabButtons.forEach((button) => {
                    const isActive = button.dataset.panelTarget === panelName;
                    button.classList.toggle('is-active', isActive);
                    button.setAttribute('aria-selected', String(isActive));
                });

                panels.forEach((panel) => {
                    const isActive = panel.dataset.panel === panelName;
                    panel.classList.toggle('is-active', isActive);
                    panel.hidden = !isActive;
                });
            };

            tabButtons.forEach((button) => {
                button.addEventListener('click', () => {
                    setActivePanel(button.dataset.panelTarget);
                });
            });

            initializeInventoryTypeFilters(cardElement);
            initializeSpellLevelFilters(cardElement);
        }

        document.addEventListener("DOMContentLoaded", async function () {
            const container = document.getElementById('character-content-container');
            const charNameEl = document.getElementById('char-name');
            const charRoleEl = document.getElementById('char-role');

            const params = new URLSearchParams(window.location.search);
            const charId = params.get('id');
            const charType = params.get('type') || 'npc'; // Default to 'npc'

            if (!charId) {
                displayError("ID del personaggio non specificato.");
                return;
            }

            try {
                let character = null;
                let allCharacters = [];

                // Load Quests Data separately
                const questsData = await loadQuestsData();
                const npcQuests = questsData.find(g => g.npc_id === charId);

                // IBRIDO: Se abbiamo dati statici, usiamoli.
                if (window.NPC_DATA && window.NPC_DATA.length > 0) {
                    console.log("Using static NPC data for character details");
                    allCharacters = window.NPC_DATA;
                    character = allCharacters.find(c => c.id === charId);
                } else {
                    // Fallback Fetch Logic
                    let characters;
                    if (charType === 'player') {
                        characters = await loadPlayersData();
                    } else {
                        const manifest = await loadCharactersManifest();
                        const npcEntries = manifest.filter(entry => (entry.type || 'npc') === 'npc');
                        characters = [];
                        for (const entry of npcEntries) {
                            const char = await loadCharacterYaml(entry);
                            if (char) characters.push(char);
                        }
                    }
                    allCharacters = characters;
                    character = characters.find(c => c.id === charId);

                    // Fetch Markdown content if not static
                    await hydrateContentBlocks(character);
                }

                if (!character) {
                    displayError(`Personaggio con ID '${charId}' non trovato.`);
                    return;
                }
                if (window.WikiSpoiler && !window.WikiSpoiler.allowSpoilers() && !window.WikiSpoiler.isVisible(character)) {
                    displayError(`Personaggio con ID '${charId}' non trovato.`);
                    return;
                }

                // If using static data, we might need to convert markdownText to HTML on the fly
                // because build script only loads text.
                if (character.content_blocks) {
                    character.content_blocks.forEach(block => {
                        if (block.markdownText && !block.markdownHtml) {
                            block.markdownHtml = renderMarkdown(block.markdownText, { context: block.type });
                        }
                    });
                }

                renderCharacterPage(character, allCharacters, npcQuests);

            } catch (error) {
                console.error("Errore nel caricamento del personaggio:", error);
                displayError("Impossibile caricare i dati del personaggio.");
            }

            function displayError(message) {
                charNameEl.textContent = "Errore";
                container.innerHTML = `<p style="text-align: center; color: var(--status-dead);">${message}</p>`;
            }

            function resolveImagePath(imagePath) {
                if (!imagePath) return '';
                // Check if the path is already absolute or starts with a protocol
                if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('/') || imagePath.startsWith('data:')) {
                    return imagePath;
                }
                // Prepend the base path for relative asset images
                return `../../assets/${imagePath}`;
            }

            function renderRelationships(relationships, allCharacters) {
                const card = document.createElement('div');
                card.className = 'content-card';

                const relationshipsHtml = relationships.map(rel => {
                    const relatedChar = allCharacters.find(c => c.id === rel.id);
                    if (!relatedChar) return '';
                    if (window.WikiSpoiler && !window.WikiSpoiler.allowSpoilers() && !window.WikiSpoiler.isVisible(relatedChar)) return '';

                    return `
                        <a href="?id=${relatedChar.id}" class="npc-card">
                            <div class="npc-avatar-container">
                                <img src="${resolveImagePath(relatedChar.images.avatar)}" alt="${relatedChar.name}" class="npc-img-pop img-main" onerror="this.style.display='none'">
                                <img src="${resolveImagePath(relatedChar.images.hover)}" alt="${relatedChar.name} Reveal" class="npc-img-pop img-hover" onerror="this.style.display='none'">
                            </div>
                            <div class="npc-info">
                                <div class="npc-header">
                                    <h3 class="npc-name">${relatedChar.name}</h3>
                                </div>
                                <div class="npc-footer">
                                    <span class="npc-desc">${rel.description}</span>
                                    <span class="npc-role">${relatedChar.role}</span>
                                </div>
                            </div>
                            <i class="fas fa-chevron-right arrow-icon"></i>
                        </a>
                    `;
                }).filter(Boolean).join('');

                card.innerHTML = `
                    <h3><i class="fas fa-users"></i> Legami</h3>
                    <div class="npc-list">
                        ${relationshipsHtml}
                    </div>
                `;
                return card;
            }

            async function hydratePlayerLoadout(character) {
                const loadoutCard = document.getElementById('player-loadout-card');
                if (!loadoutCard) return;

                try {
                    const inventoryPayload = await loadInventoryData();
                    loadoutCard.innerHTML = buildPlayerLoadoutHtml(character, inventoryPayload);
                    initializeLoadoutTabs(loadoutCard);
                    hydratePlayerRightOverview(character, inventoryPayload);
                } catch (error) {
                    console.error('Errore nel caricamento inventario API:', error);
                    loadoutCard.innerHTML = `
                        <h3><i class="fas fa-box-open"></i> Inventario e Incantesimi</h3>
                        <div class="loadout-state is-error">
                            <i class="fas fa-triangle-exclamation"></i>
                            <span>Impossibile sincronizzare l'inventario dal server.</span>
                        </div>
                    `;
                    renderPlayerXpSidebarError("Impossibile sincronizzare l'XP dal server.");
                }
            }

            function renderCharacterPage(character, allCharacters, npcQuests) {
                // Set page title and header
                document.title = `${character.name} | Cripta di Sangue`;
                charNameEl.textContent = character.name;
                charRoleEl.textContent = character.role;

                // Build the main grid structure
                const grid = document.createElement('div');
                grid.className = 'char-grid';

                // Build left (lore) and right (image/stats) columns
                // Build left (lore) and right (image/stats) columns
                const leftCol = document.createElement('div');
                leftCol.className = 'left-col';

                const visibleBlocks = (character.content_blocks || []).filter(block => !block.hidden);

                if (visibleBlocks.length > 0) {
                    visibleBlocks.forEach(block => {
                        leftCol.appendChild(renderContentBlock(block));
                    });
                } else {
                    // Display a placeholder if content_blocks is empty or doesn't exist
                    const placeholder = document.createElement('div');
                    placeholder.className = 'content-card';
                    placeholder.innerHTML = '<h3><i class="fas fa-scroll"></i> Storia</h3><p>Dettagli sulla storia di questo personaggio non ancora disponibili.</p>';
                    leftCol.appendChild(placeholder);
                }

                if (charType === 'player') {
                    const playerLoadoutCard = document.createElement('div');
                    playerLoadoutCard.className = 'content-card player-loadout-card';
                    playerLoadoutCard.id = 'player-loadout-card';
                    playerLoadoutCard.innerHTML = `
                        <h3><i class="fas fa-box-open"></i> Inventario e Incantesimi</h3>
                        <div class="loadout-state">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>Sincronizzazione con il Sigillo API in corso...</span>
                        </div>
                    `;
                    leftCol.appendChild(playerLoadoutCard);
                }

                // Render relationships if they exist
                // MOVED TO getRightColumnHtml
                // if(character.relationships && character.relationships.length > 0) {
                //     leftCol.appendChild(renderRelationships(character.relationships, allCharacters));
                // }

                const rightCol = document.createElement('div');
                rightCol.className = 'right-col';
                rightCol.innerHTML = getRightColumnHtml(character, allCharacters, npcQuests);

                grid.appendChild(leftCol);
                grid.appendChild(rightCol);
                container.appendChild(grid);

                if (charType === 'player') {
                    hydratePlayerLoadout(character);
                }

                // After rendering everything, initialize modal logic
                initializeImageModal();
            }

            function getRightColumnHtml(character, allCharacters, npcQuests) {
                const summary = character.summary || {};

                // --- CALCOLO ANNO DI NASCITA E ETA' ---
                // --- CALCOLO ANNO DI NASCITA E ETA' ---
                const CURRENT_YEAR = 2026;
                let periodLabel = "Anno di Nascita";
                let periodValue = "Non disponibile";
                let age = "Non disponibile";

                // Parsing Period field (expected format: "Birth-Death" or "Birth")
                if (summary.period) {
                    const parts = summary.period.toString().split('-');
                    const bYear = parseInt(parts[0].trim());

                    if (!isNaN(bYear)) {
                        periodValue = bYear; // Default to just birth year

                        // Calculate Age
                        if (parts.length > 1 && parts[1].trim() !== '') {
                            // Dead: Age = Death - Birth
                            const dYear = parseInt(parts[1].trim());
                            if (!isNaN(dYear)) {
                                age = `${dYear - bYear} anni`;
                                // UPDATE: Use range for label and value if dead
                                periodLabel = "Nascita - Morte";
                                periodValue = `${bYear} - ${dYear}`;
                            }
                        } else {
                            // Alive/Unknown Death: Age = Current - Birth
                            age = `${CURRENT_YEAR - bYear} anni`;
                        }
                    } else {
                        // Fallback if period is just text (e.g. "Sconosciuto")
                        periodValue = summary.period;
                    }
                }

                // --- ALTRI CAMPI ---
                // Height is already combined in YAML usually ("1.62m | 9kg")
                const heightWeight = summary.height || "Non disponibile";


                const statsHtml = `
                    <div class="stat-box">
                        <span class="stat-label">${periodLabel}</span>
                        <span class="stat-value">${periodValue}</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-label">Età</span>
                        <span class="stat-value">${age}</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-label">Altezza | Peso</span>
                        <span class="stat-value">${heightWeight}</span>
                    </div>
                `;

                // Render Quests if available
                let questsHtml = '';
                if (npcQuests && npcQuests.quests && npcQuests.quests.length > 0) {
                    const visibleQuests = npcQuests.quests.filter(q => q.status !== 'hidden');
                    if (visibleQuests.length > 0) {
                        const questsList = visibleQuests.map(q => {
                            const isCompleted = q.status === 'completed';
                            return `
                            <div class="quest-item">
                                <span class="quest-text" style="${isCompleted ? 'opacity: 0.7;' : ''}">${q.title}</span>
                                <span class="quest-status ${isCompleted ? 'status-completed' : 'status-inprogress'}">
                                    <i class="fas ${isCompleted ? 'fa-check-circle' : 'fa-clock'}"></i>
                                    ${isCompleted ? 'COMPLETA' : 'IN CORSO'}
                                </span>
                            </div>
                           `;
                        }).join('');

                        questsHtml = `
                        <div class="content-card questline-card" style="margin-top: 2rem;">
                            <h3><i class="fas fa-scroll"></i> Missioni</h3>
                            <div class="quest-category">
                                ${questsList}
                            </div>
                             <div style="margin-top: 1rem; text-align: center;">
                                <a href="../missioni.html" class="button-gold-outline" style="font-size: 0.8rem;">Vedi Registro Completo</a>
                            </div>
                        </div>
                        `;
                    }
                }

                // Causa del Decesso (Solo se presente)
                let causeOfDeathHtml = '';
                if (summary.cause_of_death) {
                    causeOfDeathHtml = `
                        <div style="padding: 1rem; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
                            <span class="stat-label" style="margin-bottom: 5px;">Causa del Decesso</span>
                            <span style="color: var(--accent-primary); font-family: 'Cinzel';">${summary.cause_of_death}</span>
                        </div>
                    `;
                }

                const playerXpHtml = charType === 'player'
                    ? `
                        <section id="player-xp-right-card" class="player-overview-card player-overview-card--sidebar">
                            <h4><i class="fas fa-star"></i> Esperienza</h4>
                            <div class="loadout-state">
                                <i class="fas fa-spinner fa-spin"></i>
                                <span>Sincronizzazione XP in corso...</span>
                            </div>
                        </section>
                    `
                    : '';

                return `
                    <div class="image-card">
                        <img src="${resolveImagePath(character.images.portrait)}" class="char-portrait" onerror="this.src='https://placehold.co/400x500/111/333?text=No+Image'">
                        <div class="stats-grid">${statsHtml}</div>
                        ${causeOfDeathHtml}
                        ${playerXpHtml}
                    </div>
                    ${questsHtml}
                    ${character.relationships && character.relationships.length > 0 ? renderRelationships(character.relationships, allCharacters).outerHTML : ''}
                `;
            }

            function renderContentBlock(block) {
                const card = document.createElement('div');
                card.className = 'content-card';
                if (block.type) {
                    card.classList.add(`content-card--${block.type}`);
                }
                const wrapMarkdown = (html, extraClass = '') => {
                    if (!html) return '';
                    const className = extraClass ? `chapter-content ${extraClass}` : 'chapter-content';
                    return `<div class="${className}">${html}</div>`;
                };

                // Use a switch to handle different block types
                switch (block.type) {
                    case 'lore':
                        card.innerHTML = `<h3><i class="fas ${block.icon || 'fa-book-open'}"></i> ${block.title}</h3>${wrapMarkdown(block.markdownHtml)}`;
                        break;

                    case 'secret_dossier':
                        // This block is initially commented out or hidden in the original file. 
                        // For the template, we can render it directly or add a mechanism to reveal it.
                        // For now, let's render it styled as a secret.
                        card.classList.add('secret'); // You can style this class
                        card.innerHTML = `
                        <h3><i class="fas fa-user-secret"></i> ${block.title}</h3>
                        <div class="secret-dossier">
                            <div class="secret-badge">${block.badge}</div>
                            <div class="dossier-content">
                                <img src="${resolveImagePath(block.image)}" class="elena-img" onerror="this.style.display='none'">
                                ${wrapMarkdown(block.markdownHtml, 'chapter-content--compact')}
                            </div>
                        </div>`;
                        break;

                    case 'banner_box':
                        card.innerHTML = `
                             <div class="banner-header">
                                 <img src="${resolveImagePath(block.banner)}" class="banner-img" alt="${block.title}">
                             </div>
                             <div class="banner-body">
                                 <h3><i class="fas ${block.icon || 'fa-flag'}"></i> ${block.title}</h3>
                                 ${wrapMarkdown(block.markdownHtml)}
                             </div>
                         `;
                        break;

                    case 'custom_box':
                        if (block.borderColor) {
                            card.style.borderColor = block.borderColor;
                        }
                        card.innerHTML = `<h3><i class="fas ${block.icon || 'fa-box'}"></i> ${block.title}</h3>${wrapMarkdown(block.markdownHtml)}`;
                        break;

                    case 'image_box':
                        const docTags = (block.tags || []).map(tag => `<span class="doc-tag">${tag}</span>`).join('');

                        card.classList.add('document-card');
                        card.innerHTML = `
                        <div class="document-header">
                            <div class="doc-label"><i class="fas ${block.icon || 'fa-book-dead'}"></i> ${block.title}</div>
                            <div class="document-tags">${docTags}</div>
                        </div>
                        <div class="document-body">
                            <div class="document-image">
                                 <img src="${resolveImagePath(block.image)}" alt="${block.title}" class="doc-image-popup" onerror="this.style.display='none'">
                                ${block.image_caption ? `<p class="document-caption">${block.image_caption}</p>` : ''}
                            </div>
                            <div class="document-content">
                                ${wrapMarkdown(block.markdownHtml, 'chapter-content--compact')}
                            </div>
                        </div>`;
                        break;

                    default:
                        // Default handler for unknown block types
                        card.innerHTML = `<h3>${block.title || 'Informazioni'}</h3>${wrapMarkdown(block.markdownHtml || block.content || '')}`;
                }
                return card;
            }
        });
