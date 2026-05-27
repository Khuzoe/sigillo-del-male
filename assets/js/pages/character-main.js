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
    const yamlUrl = dataUrl('characters/index.yaml');
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

    const jsonUrl = dataUrl('characters/index.json');
    const jsonResp = await fetch(jsonUrl);
    if (jsonResp.ok) return jsonResp.json();
    throw new Error('Impossibile caricare il manifest dei personaggi.');
}

async function loadCharacterYaml(entry) {
    const filePath = entry.file || `characters/${entry.id}.yaml`;
    const yamlUrl = dataUrl(filePath);
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

async function loadCharactersCollection() {
    try {
        const response = await fetch(window.CriptaApp?.urls?.api?.('api/data/characters') || 'https://sigillo-api.khuzoe.workers.dev/api/data/characters');
        if (response.ok) {
            const payload = await response.json();
            if (Array.isArray(payload?.data)) return normalizeCharactersCollection(payload.data);
        }
    } catch (error) {
        console.warn('KV characters non disponibile, provo JSON statico.', error);
    }

    try {
        const response = await fetch(dataUrl('characters.json'));
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
    return characters.map((character) => {
        const normalized = { ...character };
        normalized.content_blocks = normalizeCharacterBlocks(character);
        normalized.images = normalized.images || {};
        if (!normalized.images.hover) normalized.images.hover = normalized.images.avatar || normalized.images.portrait || '';
        if (!normalized.images.avatar) normalized.images.avatar = normalized.images.portrait || normalized.images.hover || '';
        return normalized;
    });
}

function normalizeCharacterBlocks(character) {
    if (Array.isArray(character.content_blocks)) return character.content_blocks;
    if (!Array.isArray(character.blocks)) return [];
    return character.blocks.map((block) => {
        const markdownText = String(block.text || '');
        return {
            type: block.type === 'image' || block.image ? 'image_box' : 'lore',
            title: block.title || 'Informazioni',
            icon: block.icon || 'fa-book-open',
            image: block.image || '',
            markdownText,
            markdownHtml: markdownText ? renderMarkdown(markdownText, { context: block.image ? 'image_box' : 'lore' }) : ''
        };
    });
}

async function loadPlayersData() {
    const resp = await fetch(dataUrl('players.json'));
    if (!resp.ok) throw new Error(`File dati players (${resp.status}) non trovato.`);
    return resp.json();
}

async function hydrateContentBlocks(character) {
    if (!character || !Array.isArray(character.content_blocks)) return;
    await Promise.all(character.content_blocks.map(async (block) => {
        if (!block.markdown) return;
        const urls = getContentBlockMarkdownUrls(block.markdown);
        try {
            let md = '';
            for (const url of urls) {
                const resp = await fetch(url);
                if (!resp.ok) continue;
                md = await resp.text();
                break;
            }
            block.markdownText = md;
            block.markdownHtml = md ? renderMarkdown(md, { context: block.type }) : `<p>Impossibile caricare ${block.markdown}</p>`;
        } catch (err) {
            console.warn(`Errore nel caricare ${block.markdown}:`, err);
            block.markdownHtml = `<p>Impossibile caricare ${block.markdown}</p>`;
        }
    }));
}

function getContentBlockMarkdownUrls(markdownPath) {
    const cleanPath = String(markdownPath || '').replace(/^\/+/, '');
    const globalContentUrl = `../../assets/content/${cleanPath}`;

    if (window.CriptaApp?.campaigns?.isDefault?.() === false) {
        return [...new Set([dataUrl(cleanPath), globalContentUrl])];
    }

    return [...new Set([globalContentUrl, dataUrl(cleanPath)])];
}

async function loadQuestsData() {
    try {
        const resp = await fetch(dataUrl('quests.json'));
        if (resp.ok) return resp.json();
    } catch (e) {
        console.warn("Impossibile caricare quests.json", e);
    }
    return [];
}

const INVENTORY_API_URL = typeof window.CriptaApp?.urls?.api === 'function'
    ? window.CriptaApp.urls.api('api/inventory')
    : 'https://sigillo-api.khuzoe.workers.dev/api/inventory';
const WIKI_ITEMS_DATA_URL = dataUrl('items.json');
const INVENTORY_CACHE_KEY = `cds_inventory_api_cache_v1:${window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue'}`;
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
const DND5E_XP_THRESHOLDS = [
    0, 300, 900, 2700, 6500,
    14000, 23000, 34000, 48000, 64000,
    85000, 100000, 120000, 140000, 165000,
    195000, 225000, 265000, 305000, 355000
];
const PLAYER_NAME_ALIASES = {
    apothecary: ['apothecary'],
    garun: ["ga'run", 'ga run', 'garun'],
    randra: ["ran'dra", 'ran dra', 'randra'],
    valdor: ['valdor']
};
const SKILLS_DATA_URL = dataUrl('skills.json');
const SKILLS_ASSET_BASE = 'media/skill_trees/';
const PLAYER_SKILL_TREE_KEYS = {
    apothecary: 'apothecary',
    garun: 'garun',
    randra: 'randra',
    valdor: 'valdor'
};

let inventoryRequestPromise = null;
let inventoryMemoryCache = null;
let skillsRequestPromise = null;
let skillsMemoryCache = null;
let wikiItemsRequestPromise = null;
let wikiItemsMemoryCache = null;

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

function normalizeWords(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function slugify(value) {
    return normalizeWords(value).join('-') || 'item';
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

function resolveSkillAssetPath(path) {
    const value = String(path || '').trim();
    if (!value) return '';
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    if (value.startsWith('media/')) return window.CriptaApp.urls.api(value);
    if (value.startsWith('/media/')) return window.CriptaApp.urls.api(value.slice(1));
    if (value.startsWith('/')) return value;
    return window.CriptaApp.urls.api(`${SKILLS_ASSET_BASE}${value}`);
}

function dataUrl(pathname) {
    return window.CriptaApp?.urls?.data?.(pathname) || `../../assets/data/${String(pathname || '').replace(/^\/+/, '')}`;
}

function resolveCharacterAssetPath(imagePath) {
    const value = String(imagePath || '').trim();
    if (!value) return '';
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    if (value.startsWith('media/')) return window.CriptaApp.urls.api(value);
    if (value.startsWith('/media/')) return window.CriptaApp.urls.api(value.slice(1));
    if (value.startsWith('/')) return value;
    if (value.startsWith('assets/')) return `../../${value}`;
    return `../../assets/${value}`;
}

async function loadSkillsData() {
    if (skillsMemoryCache) return skillsMemoryCache;
    if (skillsRequestPromise) return skillsRequestPromise;

    skillsRequestPromise = (async () => {
        const response = await fetch(SKILLS_DATA_URL);
        if (!response.ok) {
            throw new Error(`File skill tree non trovato (${response.status}).`);
        }
        const payload = await response.json();
        skillsMemoryCache = payload && typeof payload === 'object' ? payload : {};
        return skillsMemoryCache;
    })();

    try {
        return await skillsRequestPromise;
    } finally {
        skillsRequestPromise = null;
    }
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
            const payload = await requestInventoryApi();
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

async function loadWikiItemsData() {
    if (wikiItemsMemoryCache) return wikiItemsMemoryCache;
    if (wikiItemsRequestPromise) return wikiItemsRequestPromise;

    wikiItemsRequestPromise = (async () => {
        let payload = null;
        try {
            if (typeof window.CriptaApp?.api?.get === 'function') {
                const apiPayload = await window.CriptaApp.api.get('api/data/items');
                if (Array.isArray(apiPayload?.data)) payload = apiPayload.data;
            }
        } catch (error) {
            console.warn('KV items non disponibile per scheda giocatore, uso JSON statico.', error);
        }
        if (!payload) {
            const response = await fetch(WIKI_ITEMS_DATA_URL);
            if (!response.ok) throw new Error(`Items wiki HTTP ${response.status}`);
            payload = await response.json();
        }
        const list = Array.isArray(payload) ? payload : [];
        wikiItemsMemoryCache = window.WikiSpoiler
            ? window.WikiSpoiler.filterVisible(list)
            : list.filter((item) => item.hidden !== true && item.status !== 'hidden');
        return wikiItemsMemoryCache;
    })();

    try {
        return await wikiItemsRequestPromise;
    } finally {
        wikiItemsRequestPromise = null;
    }
}

async function requestInventoryApi() {
    if (typeof window.CriptaApp?.api?.get === 'function') {
        try {
            return await window.CriptaApp.api.get('api/inventory');
        } catch (error) {
            const message = String(error?.message || error || '').trim();
            throw new Error(message ? `Inventory API ${message}` : 'Inventory API errore sconosciuto.');
        }
    }

    const inventoryUrl = new URL(INVENTORY_API_URL, window.location.href);
    inventoryUrl.searchParams.set('campaign', window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue');
    const response = await fetch(inventoryUrl.toString(), {
        method: 'GET',
        headers: {
            Accept: 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Inventory API HTTP ${response.status}`);
    }

    return response.json();
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

function getWikiItemAliases(item) {
    const aliases = new Set([
        item.id,
        item.name,
        item.unidentifiedName,
        item.foundryName
    ].filter(Boolean));

    if (Array.isArray(item.foundryNames)) {
        item.foundryNames.forEach((name) => aliases.add(name));
    }
    if (Array.isArray(item.aliases)) {
        item.aliases.forEach((name) => aliases.add(name));
    }
    if (item.owner && item.name && item.name.includes(':')) {
        const localName = item.name.split(':').slice(1).join(':').trim();
        if (localName) aliases.add(`${localName} di ${item.owner}`);
    }
    return Array.from(aliases).filter(Boolean);
}

function buildWikiItemIndex(items) {
    const byKey = new Map();
    const records = (Array.isArray(items) ? items : []).map((item) => {
        const aliases = getWikiItemAliases(item);
        aliases.forEach((alias) => {
            const key = normalizeText(alias);
            if (key && !byKey.has(key)) byKey.set(key, item);
        });
        return {
            item,
            keys: aliases.map(normalizeText).filter(Boolean),
            words: new Set(aliases.flatMap(normalizeWords))
        };
    });
    return { byKey, records };
}

function findWikiItemForInventoryEntry(entry, index) {
    if (!entry || !index) return null;
    const candidateNames = [entry.name, entry.wikiItemId, entry.foundryName].filter(Boolean);
    for (const name of candidateNames) {
        const key = normalizeText(name);
        if (key && index.byKey.has(key)) return index.byKey.get(key);
    }

    const entryKey = normalizeText(entry.name);
    if (!entryKey || entryKey.length < 5) return null;
    const directContains = index.records.find((record) => (
        record.keys.some((key) => key.length >= 5 && entryKey.includes(key))
    ));
    if (directContains) return directContains.item;

    const entryWords = new Set(normalizeWords(entry.name).filter((word) => word.length > 2 && word !== 'di'));
    if (entryWords.size < 2) return null;
    let best = null;
    let bestScore = 0;
    index.records.forEach((record) => {
        let score = 0;
        entryWords.forEach((word) => {
            if (record.words.has(word)) score += 1;
        });
        if (score > bestScore) {
            bestScore = score;
            best = record.item;
        }
    });
    return bestScore >= Math.min(2, entryWords.size) ? best : null;
}

function getWikiItemUrl(item) {
    if (!item) return '';
    return `../oggetti.html#${encodeURIComponent(item.id || slugify(item.name))}`;
}

function getWikiItemImageUrl(item) {
    if (!item || !item.image) return '';
    return resolveCharacterAssetPath(item.image);
}

function renderWikiItemThumb(item, className, label = 'Oggetto wiki') {
    if (!item) return '';
    const safeLabel = escapeHtml(item.name || label);
    const image = getWikiItemImageUrl(item);
    if (image) {
        return `<span class="${escapeHtml(className)}"><img src="${escapeHtml(image)}" alt="${safeLabel}"></span>`;
    }
    return `<span class="${escapeHtml(className)}" aria-hidden="true"><i class="fas ${escapeHtml(item.icon || 'fa-wand-sparkles')}"></i></span>`;
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
        const icon = item.wikiItem ? renderWikiItemThumb(item.wikiItem, 'player-overview-chip-icon') : '';
        const displayName = item.wikiItem?.name || item.name || 'Elemento';
        const label = `${icon}<span>${escapeHtml(displayName)}</span> ${quantityLabel ? `<small>${escapeHtml(quantityLabel)}</small>` : ''}`;
        if (item.wikiItem) {
            return `<a class="player-overview-chip player-overview-chip--link" href="${escapeHtml(getWikiItemUrl(item.wikiItem))}">${label}</a>`;
        }
        return `<span class="player-overview-chip">${label}</span>`;
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
                                <span class="slot-level-title">${level === 0 ? 'Trucchetto' : `Livello ${level || '?'}`}</span>
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
    const rawXpMissing = toFiniteNumber(actor.xp && actor.xp.missingToLevel);
    const hasXp = xpCurrent !== null && xpNext !== null && xpNext > 0;

    let xpPreviousLevel = 0;
    let xpRangeTotal = hasXp ? Math.max(0, xpNext) : 0;
    let xpCurrentInRange = hasXp ? Math.max(0, xpCurrent) : 0;

    if (hasXp) {
        const thresholdIndex = DND5E_XP_THRESHOLDS.findIndex((threshold) => threshold === xpNext);
        if (thresholdIndex > 0) {
            xpPreviousLevel = DND5E_XP_THRESHOLDS[thresholdIndex - 1];
        } else {
            for (let i = 0; i < DND5E_XP_THRESHOLDS.length; i++) {
                const threshold = DND5E_XP_THRESHOLDS[i];
                if (threshold <= xpCurrent) {
                    xpPreviousLevel = threshold;
                    continue;
                }
                if (threshold > xpCurrent) {
                    if (!Number.isFinite(xpNext) || xpNext <= xpPreviousLevel) {
                        xpRangeTotal = threshold - xpPreviousLevel;
                    }
                    break;
                }
            }
        }

        if (xpNext > xpPreviousLevel) {
            xpRangeTotal = xpNext - xpPreviousLevel;
            xpCurrentInRange = Math.min(
                xpRangeTotal,
                Math.max(0, xpCurrent - xpPreviousLevel)
            );
        } else {
            xpRangeTotal = Math.max(1, xpRangeTotal);
            xpCurrentInRange = Math.min(xpRangeTotal, Math.max(0, xpCurrentInRange));
        }
    }

    const xpMissing = hasXp
        ? Math.max(0, xpRangeTotal - xpCurrentInRange)
        : (rawXpMissing !== null ? rawXpMissing : 0);
    const xpRatio = hasXp
        ? Math.min(100, Math.max(0, (xpCurrentInRange / Math.max(1, xpRangeTotal)) * 100))
        : 0;
    const xpLevelReady = hasXp && ((rawXpMissing !== null && rawXpMissing <= 0) || xpCurrent >= xpNext);

    return {
        hasXp,
        xpCurrent,
        xpNext,
        xpPreviousLevel,
        xpCurrentInRange,
        xpRangeTotal,
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
                    <strong>${formatNumberIt(xpData.xpCurrentInRange)}</strong>
                    <span>/ ${formatNumberIt(xpData.xpRangeTotal)} XP</span>
                </p>
                <p class="player-overview-note">Totale: ${formatNumberIt(xpData.xpCurrent)} XP</p>
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
                        <h4><i class="fas fa-gem"></i> IN SINTONIA</h4>
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

function getActorHpData(actor) {
    const hp = actor && actor.vitals && actor.vitals.hp ? actor.vitals.hp : {};
    return {
        value: toFiniteNumber(hp.value),
        max: toFiniteNumber(hp.max),
        temp: toFiniteNumber(hp.temp)
    };
}

function renderVitalOverview(actor) {
    const hp = getActorHpData(actor);
    const ac = toFiniteNumber(actor && actor.vitals && actor.vitals.ac);
    const initiative = toFiniteNumber(actor && actor.vitals && actor.vitals.initiative);
    const speed = actor && actor.vitals ? actor.vitals.speed : null;
    const movement = speed && typeof speed === 'object'
        ? [speed.walk ? `${speed.walk} ft` : '', speed.fly ? `volo ${speed.fly} ft` : ''].filter(Boolean).join(' | ')
        : '';

    return `
                <div class="character-live-kpis">
                    <div class="character-live-kpi character-live-kpi--hp">
                        <span>PF</span>
                        <strong>${formatNumberIt(hp.value)} / ${formatNumberIt(hp.max)}</strong>
                        ${hp.temp ? `<em>+${formatNumberIt(hp.temp)} temp</em>` : ''}
                    </div>
                    <div class="character-live-kpi">
                        <span>CA</span>
                        <strong>${formatNumberIt(ac)}</strong>
                    </div>
                    <div class="character-live-kpi">
                        <span>Iniziativa</span>
                        <strong>${initiative !== null && initiative >= 0 ? '+' : ''}${formatNumberIt(initiative)}</strong>
                    </div>
                    ${movement ? `
                    <div class="character-live-kpi">
                        <span>Movimento</span>
                        <strong>${escapeHtml(movement)}</strong>
                    </div>` : ''}
                </div>
            `;
}

function renderAbilityOverview(actor) {
    const labels = {
        str: 'FOR',
        dex: 'DES',
        con: 'COS',
        int: 'INT',
        wis: 'SAG',
        cha: 'CAR'
    };
    const abilities = actor && actor.abilities && typeof actor.abilities === 'object' ? actor.abilities : {};
    const entries = Object.entries(labels)
        .map(([key, label]) => {
            const ability = abilities[key] || {};
            const value = toFiniteNumber(ability.value);
            const mod = toFiniteNumber(ability.mod);
            if (value === null && mod === null) return '';
            return `
                        <span class="character-ability-pill">
                            <em>${label}</em>
                            <strong>${formatNumberIt(value)}</strong>
                            <small>${mod !== null && mod >= 0 ? '+' : ''}${formatNumberIt(mod)}</small>
                        </span>
                    `;
        })
        .filter(Boolean);
    return entries.length ? `<div class="character-ability-grid">${entries.join('')}</div>` : '';
}

function renderResourceOverview(actor) {
    const resources = actor && actor.resources && typeof actor.resources === 'object' ? actor.resources : {};
    const entries = Object.values(resources)
        .filter((resource) => resource && (resource.label || resource.value !== null || resource.max !== null))
        .slice(0, 4)
        .map((resource) => `
                    <span class="character-resource-pill">
                        <strong>${escapeHtml(resource.label || 'Risorsa')}</strong>
                        <em>${formatNumberIt(resource.value)} / ${formatNumberIt(resource.max)}</em>
                    </span>
                `);
    return entries.length ? `<div class="character-resource-list">${entries.join('')}</div>` : '';
}

function renderCurrencyOverview(actor) {
    const currency = actor && actor.currency && typeof actor.currency === 'object' ? actor.currency : {};
    const labels = { pp: 'PP', gp: 'MO', ep: 'ME', sp: 'MA', cp: 'MR' };
    const entries = Object.entries(labels)
        .map(([key, label]) => {
            const amount = toFiniteNumber(currency[key]);
            if (amount === null || amount <= 0) return '';
            return `<span><strong>${escapeHtml(label)}</strong> ${formatNumberIt(amount)}</span>`;
        })
        .filter(Boolean);
    return entries.length ? `<div class="character-currency-list">${entries.join('')}</div>` : '';
}

function renderCompactSlotOverview(actor) {
    const spellSlots = actor && actor.spellSlots ? actor.spellSlots : {};
    const totalSlots = toFiniteNumber(spellSlots.totals && spellSlots.totals.total);
    if (totalSlots === null || totalSlots <= 0) return '<p class="player-overview-empty">Nessuno slot disponibile.</p>';
    return renderSpellSlotsOverview(actor);
}

function renderCharacterLiveSummary(actor, payload) {
    if (!actor || typeof actor !== 'object') return '';
    const attunedItems = getAttunedItems(actor);
    const equippedItems = getUniqueItemList(Array.isArray(actor.equippedItems) ? actor.equippedItems : []);
    const resourceHtml = renderResourceOverview(actor);
    const currencyHtml = renderCurrencyOverview(actor);
    const abilityHtml = renderAbilityOverview(actor);

    return `
                <section class="character-live-summary" aria-label="Dati live Foundry">
                    <div class="character-live-heading">
                        <div>
                            <p>Snapshot Foundry</p>
                            <h3>Stato Personaggio</h3>
                        </div>
                        <span>${escapeHtml(formatGeneratedAtLabel(payload))}</span>
                    </div>
                    ${renderVitalOverview(actor)}
                    <div class="character-live-grid">
                        <section class="character-live-card">
                            <h4><i class="fas fa-star"></i> Esperienza</h4>
                            ${renderXpOverviewBody(actor)}
                        </section>
                        <section class="character-live-card">
                            <h4><i class="fas fa-weight-hanging"></i> Carico</h4>
                            ${renderWeightOverviewBody(actor)}
                        </section>
                        <section class="character-live-card">
                            <h4><i class="fas fa-bolt"></i> Magia</h4>
                            ${renderCompactSlotOverview(actor)}
                        </section>
                        <section class="character-live-card">
                            <h4><i class="fas fa-dumbbell"></i> Caratteristiche</h4>
                            ${abilityHtml || '<p class="player-overview-empty">Caratteristiche non disponibili.</p>'}
                        </section>
                        ${resourceHtml ? `
                        <section class="character-live-card">
                            <h4><i class="fas fa-gauge-high"></i> Risorse</h4>
                            ${resourceHtml}
                        </section>` : ''}
                        ${currencyHtml ? `
                        <section class="character-live-card">
                            <h4><i class="fas fa-coins"></i> Denaro</h4>
                            ${currencyHtml}
                        </section>` : ''}
                        <section class="character-live-card character-live-card--wide">
                            <h4><i class="fas fa-shirt"></i> Equipaggiato</h4>
                            ${renderOverviewItemPills(equippedItems, 'Nessun oggetto equipaggiato.')}
                        </section>
                        <section class="character-live-card character-live-card--wide">
                            <h4><i class="fas fa-gem"></i> IN SINTONIA</h4>
                            ${renderOverviewItemPills(attunedItems, 'Nessun oggetto sintonizzato.')}
                        </section>
                    </div>
                </section>
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

function renderWikiItemBridge(wikiItem, foundryName = '') {
    if (!wikiItem) return '';
    const url = getWikiItemUrl(wikiItem);
    const properties = Array.isArray(wikiItem.properties) ? wikiItem.properties.filter((property) => property && property.hidden !== true) : [];
    const previewProperties = properties.slice(0, 2);
    const normalizedWikiName = normalizeText(wikiItem.name);
    const normalizedFoundryName = normalizeText(foundryName);
    const showFoundryName = normalizedFoundryName && normalizedFoundryName !== normalizedWikiName;
    return `
                <aside class="loadout-wiki-card" aria-label="Voce collegata dalla wiki">
                    ${renderWikiItemThumb(wikiItem, 'loadout-wiki-icon', 'Oggetto wiki')}
                    <div class="loadout-wiki-content">
                        <div class="loadout-wiki-kicker">
                            <span>Voce ITEMS collegata</span>
                            ${wikiItem.rarity ? `<span>${escapeHtml(wikiItem.rarity)}</span>` : ''}
                        </div>
                        <a class="loadout-wiki-title" href="${escapeHtml(url)}">${escapeHtml(wikiItem.name || 'Oggetto wiki')}</a>
                        ${showFoundryName ? `<p class="loadout-foundry-name">Nome Foundry: ${escapeHtml(foundryName)}</p>` : ''}
                        ${wikiItem.summary ? `<p>${escapeHtml(wikiItem.summary)}</p>` : ''}
                        ${previewProperties.length ? `
                            <ul>
                                ${previewProperties.map((property) => `
                                    <li>
                                        ${property.name ? `<strong>${escapeHtml(property.name)}.</strong> ` : ''}
                                        ${escapeHtml(property.description || '')}
                                    </li>
                                `).join('')}
                            </ul>
                        ` : ''}
                    </div>
                </aside>
            `;
}

function renderLoadoutDisclosure(title, quantityLabel, description, badges, extraClass = '', dataAttributes = '', wikiItem = null, foundryName = '') {
    const bodyParts = [];
    const wikiBridge = renderWikiItemBridge(wikiItem, foundryName);
    if (wikiBridge) bodyParts.push(wikiBridge);
    if (!wikiItem && description) {
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
                        <span class="loadout-entry-title">
                            ${wikiItem ? renderWikiItemThumb(wikiItem, 'loadout-entry-icon', title || 'Elemento senza nome') : ''}
                            <span>${escapeHtml(title || 'Elemento senza nome')}</span>
                        </span>
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
            const wikiItem = entry.wikiItem || null;
            badges.push(typeMeta.label);
            if (wikiItem) badges.push('Wiki');
            if (entry.rarity) badges.push(`Rarita: ${formatToken(entry.rarity)}`);
            if (entry.attuned) badges.push('Sintonizzato');

            const description = cleanDescription(entry.description);
            const quantityLabel = getQuantityLabel(entry);

            return renderLoadoutDisclosure(
                wikiItem?.name || entry.name || 'Oggetto senza nome',
                quantityLabel,
                description,
                badges,
                wikiItem ? 'loadout-entry--wiki-linked' : '',
                `data-inventory-type="${typeMeta.key}"`,
                wikiItem,
                entry.name || ''
            );
        }).join('');

        const icon = group.isLoose ? 'fa-hand-holding' : 'fa-box-archive';
        const groupName = group.isLoose ? 'Senza contenitore' : group.name;

        return `
                    <details class="inventory-group" data-inventory-group>
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

function buildPlayerLoadoutHtml(character, payload, wikiItems = []) {
    const actor = findPlayerActor(payload, character);
    if (!actor) {
        return `
                    <h3><i class="fas fa-box-open"></i> Inventario e Incantesimi</h3>
                    <p class="loadout-empty">Nessun inventario trovato per ${escapeHtml(character.name)} nella risposta API.</p>
                `;
    }

    const wikiItemIndex = buildWikiItemIndex(wikiItems);
    const { inventory, spells } = splitActorLoadout(actor);
    inventory.forEach((entry) => {
        entry.wikiItem = findWikiItemForInventoryEntry(entry, wikiItemIndex);
    });
    [actor.equippedItems, actor.attunementItems].forEach((items) => {
        if (!Array.isArray(items)) return;
        items.forEach((entry) => {
            entry.wikiItem = findWikiItemForInventoryEntry(entry, wikiItemIndex);
        });
    });
    const owners = Array.isArray(actor.owners) ? actor.owners.map((owner) => owner.name).filter(Boolean) : [];
    const preparedSpells = spells.filter((spell) => spell.prepared);
    const liveSummaryHtml = renderCharacterLiveSummary(actor, payload);
    const inventorySummaryHtml = renderInventoryPanelSummary(actor);
    const spellsSummaryHtml = renderSpellsPanelSummary(actor, preparedSpells);

    return `
                ${liveSummaryHtml}
                <h3><i class="fas fa-box-open"></i> Dettaglio Inventario e Incantesimi</h3>
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

function buildPlayerSkillTreeCard(playerId, allSkillTrees) {
    const treeKey = PLAYER_SKILL_TREE_KEYS[playerId] || playerId;
    const treeData = allSkillTrees && allSkillTrees[treeKey];
    const card = document.createElement('div');
    card.className = 'content-card player-skill-tree-card';
    card.id = 'player-skill-tree-card';

    if (!treeData || !Array.isArray(treeData.nodes) || treeData.nodes.length === 0) {
        card.innerHTML = `
                    <h3><i class="fas fa-crown"></i> Albero Abilita</h3>
                    <p class="loadout-empty">Albero abilita non disponibile per questo personaggio.</p>
                `;
        return card;
    }

    card.innerHTML = `
                <h3><i class="fas fa-crown"></i> Albero Abilita</h3>
                <div class="player-skill-tree-layout">
                    <div class="player-skill-tree-column">
                        <div class="player-skill-tree-wrapper" data-skill-tree>
                            <svg class="player-skill-tree-connections" data-skill-tree-lines></svg>
                        </div>
                    </div>
                    <aside class="player-skill-info" data-skill-info></aside>
                </div>
            `;

    const treeContainer = card.querySelector('[data-skill-tree]');
    const linesLayer = card.querySelector('[data-skill-tree-lines]');
    const infoPanel = card.querySelector('[data-skill-info]');
    if (!treeContainer || !linesLayer || !infoPanel) return card;

    const bgImage = resolveSkillAssetPath(treeData.bgImage);
    const bgOpacity = Number.isFinite(Number(treeData.bgOpacity))
        ? Math.max(0, Math.min(1, Number(treeData.bgOpacity)))
        : 1;
    treeContainer.style.setProperty('--skill-tree-bg-image', bgImage ? `url('${bgImage}')` : 'none');
    treeContainer.style.setProperty('--skill-tree-bg-opacity', String(bgOpacity));
    treeContainer.style.setProperty(
        '--skill-tree-bg-overlay',
        'radial-gradient(circle at 50% 50%, rgba(56, 22, 22, 0.45), rgba(0, 0, 0, 0.92))'
    );

    const nodeById = new Map(treeData.nodes.map((node) => [node.id, node]));
    const setDefaultInfo = () => {
        infoPanel.innerHTML = `
                    <div class="player-skill-info-empty">
                        <i class="fas fa-hand-pointer" aria-hidden="true"></i>
                        <p>Passa il cursore su un nodo per vedere i dettagli dell'abilita.</p>
                    </div>
                `;
    };

    const updateInfo = (node) => {
        if (!node) {
            setDefaultInfo();
            return;
        }

        const icon = resolveSkillAssetPath(node.icon);
        infoPanel.innerHTML = `
                    <header class="player-skill-info-header">
                        ${icon ? `<img src="${icon}" alt="${escapeHtml(node.title || 'Abilita')}" class="player-skill-info-icon">` : ''}
                        <h4 class="player-skill-info-title">${escapeHtml(node.title || 'Abilita')}</h4>
                    </header>
                    ${node.flavor ? `<p class="player-skill-info-flavor">${escapeHtml(node.flavor)}</p>` : ''}
                    <div class="player-skill-info-desc">${node.desc || '<p>Nessun dettaglio disponibile.</p>'}</div>
                `;
    };

    setDefaultInfo();

    treeData.nodes.forEach((startNode) => {
        if (!Array.isArray(startNode.connections)) return;
        startNode.connections.forEach((targetId) => {
            const targetNode = nodeById.get(targetId);
            if (!targetNode) return;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', `${startNode.x}%`);
            line.setAttribute('y1', `${startNode.y}%`);
            line.setAttribute('x2', `${targetNode.x}%`);
            line.setAttribute('y2', `${targetNode.y}%`);

            const lineState = targetNode.state === 'unlocked' || targetNode.state === 'unlockable'
                ? targetNode.state
                : 'locked';
            line.setAttribute('class', `player-skill-connection is-${lineState}`);
            linesLayer.appendChild(line);
        });
    });

    treeData.nodes.forEach((node) => {
        const nodeElement = document.createElement('button');
        nodeElement.type = 'button';
        const stateClass = node.state === 'unlocked' || node.state === 'unlockable' ? node.state : 'locked';
        nodeElement.className = `player-skill-node is-${stateClass}${node.keyNode ? ' is-key' : ''}`;
        nodeElement.style.left = `${node.x}%`;
        nodeElement.style.top = `${node.y}%`;
        const icon = resolveSkillAssetPath(node.icon);
        if (icon) {
            nodeElement.style.backgroundImage = `url('${icon}')`;
        }
        nodeElement.setAttribute('aria-label', node.title || 'Abilita');

        const onSelect = () => {
            updateInfo(node);
        };

        nodeElement.addEventListener('mouseenter', onSelect);
        nodeElement.addEventListener('focus', onSelect);
        nodeElement.addEventListener('click', onSelect);

        treeContainer.appendChild(nodeElement);
    });

    const firstNode = treeData.nodes.find((node) => node.state === 'unlocked' || node.state === 'unlockable') || treeData.nodes[0];
    if (firstNode) updateInfo(firstNode);

    return card;
}

window.CriptaApp.onPageReady("character", async function () {
    const container = document.getElementById('character-content-container');
    const charNameEl = document.getElementById('char-name');
    const charRoleEl = document.getElementById('char-role');
    const editLinkEl = document.getElementById('character-edit-link');

    const params = new URLSearchParams(window.location.search);
    const charId = params.get('id');
    const charType = params.get('type') || 'npc'; // Default to 'npc'
    let currentCharacter = null;
    let currentAllCharacters = [];
    let currentNpcQuests = null;
    let currentPlayerSkillTrees = null;
    let isInlineEditing = false;
    let inlineEditDirty = false;
    let inlineEditBlocks = [];
    const inlineImageVersions = new Map();

    if (!charId) {
        displayError("ID del personaggio non specificato.");
        return;
    }

    editLinkEl?.addEventListener('click', (event) => {
        if (charType === 'player') return;
        event.preventDefault();
        enterInlineEditMode();
    });

    container.addEventListener('input', handleInlineEditInput);
    container.addEventListener('change', handleInlineEditChange);
    container.addEventListener('click', handleInlineEditClick);

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
                characters = await loadCharactersCollection();
                if (!Array.isArray(characters)) {
                    const manifest = await loadCharactersManifest();
                    const npcEntries = manifest.filter(entry => (entry.type || 'npc') === 'npc');
                    characters = [];
                    for (const entry of npcEntries) {
                        const char = await loadCharacterYaml(entry);
                        if (char) characters.push(char);
                    }
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
        // Keep spoiler lock for NPCs, but allow direct links to hidden players.
        if (charType !== 'player' && window.WikiSpoiler && !window.WikiSpoiler.allowSpoilers() && !window.WikiSpoiler.isVisible(character)) {
            displayError(`Personaggio con ID '${charId}' non trovato.`);
            return;
        }

        setupCharacterEditLink(character.id || charId, charType);
        // If using static data, we might need to convert markdownText to HTML on the fly
        // because build script only loads text.
        if (character.content_blocks) {
            character.content_blocks.forEach(block => {
                if (block.markdownText && !block.markdownHtml) {
                    block.markdownHtml = renderMarkdown(block.markdownText, { context: block.type });
                }
            });
        }

        let playerSkillTrees = null;
        if (charType === 'player') {
            try {
                playerSkillTrees = await loadSkillsData();
            } catch (skillError) {
                console.warn('Impossibile caricare gli alberi abilita:', skillError);
            }
        }

        currentCharacter = character;
        currentAllCharacters = allCharacters;
        currentNpcQuests = npcQuests;
        currentPlayerSkillTrees = playerSkillTrees;
        renderCharacterPage(character, allCharacters, npcQuests, playerSkillTrees);

    } catch (error) {
        console.error("Errore nel caricamento del personaggio:", error);
        displayError("Impossibile caricare i dati del personaggio.");
    }

    function setupCharacterEditLink(id, type) {
        if (!editLinkEl) return;
        if (type === 'player') {
            editLinkEl.hidden = true;
            return;
        }
        const editUrl = new URL('../../tools/characters-editor.html', window.location.href);
        editUrl.searchParams.set('id', id);
        const campaignId = window.CriptaApp?.campaigns?.currentId?.() || params.get('campaign') || '';
        if (campaignId) editUrl.searchParams.set('campaign', campaignId);
        editLinkEl.href = editUrl.toString();
    }

    function enterInlineEditMode() {
        if (!currentCharacter || charType === 'player') return;
        isInlineEditing = true;
        inlineEditDirty = false;
        inlineEditBlocks = normalizeInlineEditBlocks(currentCharacter);
        editLinkEl?.classList.add('is-editing');
        renderCharacterPage(currentCharacter, currentAllCharacters, currentNpcQuests, currentPlayerSkillTrees);
    }

    function exitInlineEditMode() {
        isInlineEditing = false;
        inlineEditDirty = false;
        inlineEditBlocks = [];
        editLinkEl?.classList.remove('is-editing');
        renderCharacterPage(currentCharacter, currentAllCharacters, currentNpcQuests, currentPlayerSkillTrees);
    }

    function normalizeInlineEditBlocks(character) {
        const blocks = Array.isArray(character?.content_blocks) ? character.content_blocks : [];
        return blocks
            .filter((block) => !block.hidden)
            .map((block, index) => ({
                id: slugify(block.id || block.title || `blocco-${index + 1}`),
                type: block.type === 'image_box' || block.type === 'image' || block.image ? 'image' : 'text',
                title: block.title || 'Informazioni',
                icon: block.icon || 'fa-book-open',
                image: block.image || '',
                text: block.markdownText || stripHtmlToText(block.markdownHtml || block.content || '')
            }));
    }

    function handleInlineEditInput(event) {
        const target = event.target;
        const characterField = target?.dataset?.inlineCharacterField;
        const characterImageField = target?.dataset?.inlineCharacterImageField;
        const characterSummaryField = target?.dataset?.inlineCharacterSummaryField;
        if (characterField || characterImageField || characterSummaryField) {
            updateInlineCharacterField(target, { characterField, characterImageField, characterSummaryField });
            return;
        }

        const blockIndex = Number(target?.dataset?.inlineBlockIndex);
        const blockField = target?.dataset?.inlineBlockField;
        if (!Number.isInteger(blockIndex) || !blockField || !inlineEditBlocks[blockIndex]) return;
        inlineEditBlocks[blockIndex][blockField] = blockField === 'text' || blockField === 'title'
            ? target.innerText.replace(/\u00a0/g, ' ').trimEnd()
            : target.value;
        inlineEditDirty = true;
    }

    function handleInlineEditChange(event) {
        const target = event.target;
        const characterField = target?.dataset?.inlineCharacterField;
        const characterImageField = target?.dataset?.inlineCharacterImageField;
        const characterSummaryField = target?.dataset?.inlineCharacterSummaryField;
        if (characterField || characterImageField || characterSummaryField) {
            updateInlineCharacterField(target, { characterField, characterImageField, characterSummaryField });
            renderCharacterPage(currentCharacter, currentAllCharacters, currentNpcQuests, currentPlayerSkillTrees);
            return;
        }

        const blockIndex = Number(target?.dataset?.inlineBlockIndex);
        const blockField = target?.dataset?.inlineBlockField;
        if (!Number.isInteger(blockIndex) || !blockField || !inlineEditBlocks[blockIndex]) return;
        inlineEditBlocks[blockIndex][blockField] = target.value;
        inlineEditDirty = true;
        renderCharacterPage(currentCharacter, currentAllCharacters, currentNpcQuests, currentPlayerSkillTrees);
    }

    function handleInlineEditClick(event) {
        const actionButton = event.target.closest('[data-inline-edit-action]');
        if (!actionButton || !isInlineEditing) return;
        event.preventDefault();
        const action = actionButton.dataset.inlineEditAction;
        const blockIndex = Number(actionButton.dataset.inlineBlockIndex);

        if (action === 'cancel') {
            if (inlineEditDirty && !window.confirm('Annullare le modifiche non salvate?')) return;
            exitInlineEditMode();
            return;
        }
        if (action === 'save') {
            saveInlineCharacterEdits();
            return;
        }
        if (action === 'upload-character-image') {
            uploadInlineCharacterImage(actionButton.dataset.inlineCharacterImageTarget || 'portrait');
            return;
        }
        if (action === 'upload-block-image') {
            if (!Number.isInteger(blockIndex) || !inlineEditBlocks[blockIndex]) return;
            uploadInlineBlockImage(blockIndex);
            return;
        }
        if (action === 'set-icon') {
            if (!Number.isInteger(blockIndex) || !inlineEditBlocks[blockIndex]) return;
            inlineEditBlocks[blockIndex].icon = actionButton.dataset.inlineIcon || 'fa-book-open';
            inlineEditDirty = true;
            renderCharacterPage(currentCharacter, currentAllCharacters, currentNpcQuests, currentPlayerSkillTrees);
            return;
        }
        if (action === 'add-block') {
            inlineEditBlocks.push({
                id: uniqueInlineBlockId('nuovo-blocco'),
                type: 'text',
                title: 'Nuovo blocco',
                icon: 'fa-book-open',
                image: '',
                text: ''
            });
            inlineEditDirty = true;
            renderCharacterPage(currentCharacter, currentAllCharacters, currentNpcQuests, currentPlayerSkillTrees);
            return;
        }
        if (!Number.isInteger(blockIndex) || !inlineEditBlocks[blockIndex]) return;
        if (action === 'delete-block') {
            if (!window.confirm('Eliminare questo blocco?')) return;
            inlineEditBlocks.splice(blockIndex, 1);
        } else if (action === 'move-up' && blockIndex > 0) {
            [inlineEditBlocks[blockIndex - 1], inlineEditBlocks[blockIndex]] = [inlineEditBlocks[blockIndex], inlineEditBlocks[blockIndex - 1]];
        } else if (action === 'move-down' && blockIndex < inlineEditBlocks.length - 1) {
            [inlineEditBlocks[blockIndex + 1], inlineEditBlocks[blockIndex]] = [inlineEditBlocks[blockIndex], inlineEditBlocks[blockIndex + 1]];
        }
        inlineEditDirty = true;
        renderCharacterPage(currentCharacter, currentAllCharacters, currentNpcQuests, currentPlayerSkillTrees);
    }

    async function uploadInlineCharacterImage(field) {
        if (!currentCharacter) return;
        const file = await pickInlineImageFile();
        if (!file) return;
        const fileName = `${field}.webp`;
        const path = await uploadInlineImageFile(file, currentCharacter.id || charId, fileName);
        if (!path) return;
        markInlineImageUpdated(path);
        currentCharacter.images = currentCharacter.images || {};
        currentCharacter.images[field] = path;
        if (field === 'avatar' && !currentCharacter.images.hover) currentCharacter.images.hover = path;
        inlineEditDirty = true;
        renderCharacterPage(currentCharacter, currentAllCharacters, currentNpcQuests, currentPlayerSkillTrees);
    }

    async function uploadInlineBlockImage(index) {
        const block = inlineEditBlocks[index];
        if (!currentCharacter || !block) return;
        const file = await pickInlineImageFile();
        if (!file) return;
        const fileName = `${slugify(block.id || block.title || `blocco-${index + 1}`)}.webp`;
        const path = await uploadInlineImageFile(file, currentCharacter.id || charId, fileName);
        if (!path) return;
        markInlineImageUpdated(path);
        block.image = path;
        block.type = 'image';
        inlineEditDirty = true;
        renderCharacterPage(currentCharacter, currentAllCharacters, currentNpcQuests, currentPlayerSkillTrees);
    }

    async function pickInlineImageFile() {
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

    async function uploadInlineImageFile(file, characterId, fileName) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per caricare immagini.');
            return '';
        }
        const toolbar = container.querySelector('[data-inline-edit-toolbar]');
        toolbar?.setAttribute('data-saving', 'true');
        try {
            const blob = /\.webp$/i.test(file.name) ? file : await convertInlineImageFileToWebpBlob(file);
            const folder = `characters/${slugify(characterId || 'npc')}`;
            const form = new FormData();
            form.set('folder', folder);
            form.set('filename', fileName);
            form.set('campaignId', getCurrentCampaignId());
            form.set('file', new File([blob], fileName, { type: 'image/webp' }));

            const uploadUrl = new URL(window.CriptaApp?.urls?.api?.('media/upload') || 'https://sigillo-api.khuzoe.workers.dev/media/upload');
            uploadUrl.searchParams.set('folder', folder);
            uploadUrl.searchParams.set('campaign', getCurrentCampaignId());

            const response = await fetch(uploadUrl.toString(), {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: form
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
            return payload.path || payload.key || '';
        } catch (error) {
            console.error('Upload immagine inline fallito:', error);
            alert(`Upload immagine fallito: ${error?.message || error}`);
            return '';
        } finally {
            toolbar?.removeAttribute('data-saving');
        }
    }

    async function convertInlineImageFileToWebpBlob(file) {
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

    function updateInlineCharacterField(target, fields) {
        if (!currentCharacter) return;
        const value = target.value;
        if (fields.characterField) {
            currentCharacter[fields.characterField] = value;
            if (fields.characterField === 'name') charNameEl.textContent = value;
            if (fields.characterField === 'role') charRoleEl.textContent = value;
        }
        if (fields.characterImageField) {
            currentCharacter.images = currentCharacter.images || {};
            currentCharacter.images[fields.characterImageField] = value;
            if (fields.characterImageField === 'portrait') {
                const preview = container.querySelector('[data-inline-portrait-preview]');
                if (preview) preview.src = resolveInlineImagePath(value);
            }
        }
        if (fields.characterSummaryField) {
            currentCharacter.summary = currentCharacter.summary || {};
            currentCharacter.summary[fields.characterSummaryField] = value;
        }
        inlineEditDirty = true;
    }

    async function saveInlineCharacterEdits() {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto: accedi come DM prima di salvare.');
            return;
        }

        const toolbar = container.querySelector('[data-inline-edit-toolbar]');
        toolbar?.setAttribute('data-saving', 'true');

        try {
            const loaded = await loadCharactersDocumentForSave();
            const updatedCharacter = serializeInlineEditedCharacter(currentCharacter);
            const nextData = Array.isArray(loaded.data) ? loaded.data.slice() : [];
            const targetIndex = nextData.findIndex((entry) => String(entry?.id || '') === String(updatedCharacter.id));
            if (targetIndex >= 0) {
                const mergedCharacter = { ...nextData[targetIndex], ...updatedCharacter };
                delete mergedCharacter.content_blocks;
                nextData[targetIndex] = mergedCharacter;
            } else {
                nextData.push(updatedCharacter);
            }

            const response = await fetch(getCharactersApiUrl(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    data: nextData,
                    expectedVersion: loaded.source === 'kv' ? (loaded.version ?? 0) : 0,
                    campaignId: getCurrentCampaignId()
                })
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);

            currentCharacter = normalizeCharactersCollection([updatedCharacter])[0];
            const allIndex = currentAllCharacters.findIndex((entry) => entry.id === currentCharacter.id);
            if (allIndex >= 0) currentAllCharacters[allIndex] = currentCharacter;
            isInlineEditing = false;
            inlineEditDirty = false;
            inlineEditBlocks = [];
            editLinkEl?.classList.remove('is-editing');
            renderCharacterPage(currentCharacter, currentAllCharacters, currentNpcQuests, currentPlayerSkillTrees);
        } catch (error) {
            console.error('Salvataggio inline NPC fallito:', error);
            alert(`Salvataggio fallito: ${error?.message || error}`);
        } finally {
            toolbar?.removeAttribute('data-saving');
        }
    }

    async function loadCharactersDocumentForSave() {
        try {
            const response = await fetch(getCharactersApiUrl());
            if (response.ok) {
                const payload = await response.json();
                if (Array.isArray(payload?.data)) {
                    return {
                        data: payload.data,
                        version: Number(payload.version || 0),
                        source: payload.source || 'kv'
                    };
                }
            }
        } catch (error) {
            console.warn('KV characters non disponibile per salvataggio inline, uso JSON statico.', error);
        }

        const response = await fetch(dataUrl('characters.json'));
        if (!response.ok) throw new Error(`Impossibile caricare characters.json (${response.status}).`);
        const payload = await response.json();
        const data = Array.isArray(payload) ? payload : payload?.data;
        if (!Array.isArray(data)) throw new Error('Formato characters.json non valido.');
        return { data, version: 0, source: 'static' };
    }

    function serializeInlineEditedCharacter(character) {
        const serialized = { ...character };
        delete serialized.content_blocks;
        serialized.id = character.id || charId;
        serialized.name = character.name || 'NPC senza nome';
        serialized.type = character.type || 'npc';
        serialized.blocks = inlineEditBlocks.map((block) => ({
            id: slugify(block.id || block.title || 'blocco'),
            type: block.type === 'image' ? 'image' : 'text',
            title: block.title || 'Informazioni',
            icon: block.icon || 'fa-book-open',
            image: block.type === 'image' ? (block.image || '') : '',
            text: block.text || ''
        }));
        return serialized;
    }

    function getCharactersApiUrl() {
        return window.CriptaApp?.urls?.api?.('api/data/characters') || 'https://sigillo-api.khuzoe.workers.dev/api/data/characters';
    }

    function getCurrentCampaignId() {
        return window.CriptaApp?.campaigns?.currentId?.() || params.get('campaign') || 'cripta-di-sangue';
    }

    function readAuthToken() {
        try {
            return window.localStorage.getItem('discord_jwt') || window.sessionStorage.getItem('discord_jwt') || '';
        } catch (_) {
            return '';
        }
    }

    function stripHtmlToText(html) {
        const div = document.createElement('div');
        div.innerHTML = html || '';
        return div.innerText || '';
    }

    function uniqueInlineBlockId(base) {
        const used = new Set(inlineEditBlocks.map((block) => block.id));
        let id = slugify(base);
        let index = 2;
        while (used.has(id)) id = `${slugify(base)}-${index++}`;
        return id;
    }

    function renderIconPicker(selectedIcon, blockIndex) {
        const options = [
            ['fa-book-open', 'Libro'],
            ['fa-scroll', 'Pergamena'],
            ['fa-feather-alt', 'Nota / diario'],
            ['fa-user-secret', 'Segreto'],
            ['fa-crown', 'Corona'],
            ['fa-skull', 'Pericolo'],
            ['fa-book-dead', 'Bestiario'],
            ['fa-gem', 'Reliquia'],
            ['fa-hand-sparkles', 'Magia'],
            ['fa-heart', 'Cuore'],
            ['fa-shield-halved', 'Difesa'],
            ['fa-flag', 'Bandiera'],
            ['fa-box', 'Generico']
        ];
        const normalizedIcon = selectedIcon || 'fa-book-open';
        const known = options.some(([value]) => value === normalizedIcon);
        const effectiveOptions = known ? options : [[normalizedIcon, 'Attuale'], ...options];
        return effectiveOptions.map(([value, label]) => `
            <button type="button" class="character-inline-icon-choice ${value === normalizedIcon ? 'is-selected' : ''}" data-inline-edit-action="set-icon" data-inline-block-index="${blockIndex}" data-inline-icon="${escapeHtml(value)}" title="${escapeHtml(label)}">
                <i class="fas ${escapeHtml(value)}"></i>
                <span>${escapeHtml(label)}</span>
            </button>
        `).join('');
    }

    function displayError(message) {
        if (editLinkEl) editLinkEl.hidden = true;
        charNameEl.textContent = "Errore";
        container.innerHTML = `<p style="text-align: center; color: var(--status-dead);">${message}</p>`;
    }

    function resolveImagePath(imagePath) {
        return appendInlineImageVersion(resolveCharacterAssetPath(imagePath), imagePath);
    }

    function markInlineImageUpdated(path) {
        const key = String(path || '').trim();
        if (key) inlineImageVersions.set(key, Date.now());
    }

    function resolveInlineImagePath(imagePath) {
        const resolved = resolveImagePath(imagePath);
        return appendInlineImageVersion(resolved, imagePath);
    }

    function appendInlineImageVersion(resolved, imagePath) {
        const version = inlineImageVersions.get(String(imagePath || '').trim());
        if (!version || !resolved) return resolved;
        try {
            const url = new URL(resolved, window.location.href);
            url.searchParams.set('v', String(version));
            return url.toString();
        } catch (_) {
            const separator = resolved.includes('?') ? '&' : '?';
            return `${resolved}${separator}v=${version}`;
        }
    }

    function normalizeImageAdjust(adjust) {
        const x = Number(adjust?.x);
        const y = Number(adjust?.y);
        const size = Number(adjust?.size);
        return {
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0,
            size: Number.isFinite(size) && size > 0 ? size : null
        };
    }

    function buildImageStyle(kind, adjust, counterpartAdjust) {
        const normalized = normalizeImageAdjust(adjust);
        const counterpart = normalizeImageAdjust(counterpartAdjust);
        const isHover = kind === 'hover';
        const restScale = isHover
            ? (counterpart.size || 1)
            : (normalized.size || 1);
        const hoverScale = isHover
            ? (normalized.size || 1.20)
            : (counterpart.size || (normalized.size ? normalized.size * 1.20 : 1.20));

        return `--img-x:${normalized.x}px; --img-y:${normalized.y}px; --img-scale-rest:${restScale}; --img-scale-hover:${hoverScale};`;
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
                                <img src="${resolveImagePath(relatedChar.images.avatar)}" alt="${relatedChar.name}" class="npc-img-pop img-main" style="${buildImageStyle('avatar', relatedChar.images.avatarAdjust, relatedChar.images.hoverAdjust)}" onerror="this.style.display='none'">
                                <img src="${resolveImagePath(relatedChar.images.hover)}" alt="${relatedChar.name} Reveal" class="npc-img-pop img-hover" style="${buildImageStyle('hover', relatedChar.images.hoverAdjust, relatedChar.images.avatarAdjust)}" onerror="this.style.display='none'">
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
            const [inventoryPayload, wikiItems] = await Promise.all([
                loadInventoryData(),
                loadWikiItemsData().catch((error) => {
                    console.warn('Impossibile caricare items.json per collegare gli oggetti:', error);
                    return [];
                })
            ]);
            loadoutCard.innerHTML = buildPlayerLoadoutHtml(character, inventoryPayload, wikiItems);
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

    function renderCharacterPage(character, allCharacters, npcQuests, playerSkillTrees) {
        // Set page title and header
        document.title = `${character.name} | Cripta di Sangue`;
        charNameEl.textContent = character.name;
        charRoleEl.textContent = character.role;
        container.innerHTML = '';

        // Build the main grid structure
        const grid = document.createElement('div');
        grid.className = 'char-grid';

        // Build left (lore) and right (image/stats) columns
        // Build left (lore) and right (image/stats) columns
        const leftCol = document.createElement('div');
        leftCol.className = 'left-col';

        if (charType !== 'player') {
            if (isInlineEditing) {
                leftCol.appendChild(renderInlineEditToolbar());
                inlineEditBlocks.forEach((block, index) => {
                    leftCol.appendChild(renderInlineEditBlock(block, index));
                });
                const addCard = document.createElement('button');
                addCard.className = 'character-inline-add-block';
                addCard.type = 'button';
                addCard.dataset.inlineEditAction = 'add-block';
                addCard.innerHTML = '<i class="fas fa-plus"></i><span>Aggiungi blocco</span>';
                leftCol.appendChild(addCard);
            } else {
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
            }
        }

        if (charType === 'player') {
            leftCol.appendChild(buildPlayerSkillTreeCard(character.id, playerSkillTrees));

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
        rightCol.innerHTML = isInlineEditing && charType !== 'player'
            ? getEditableRightColumnHtml(character)
            : getRightColumnHtml(character, allCharacters, npcQuests);

        grid.appendChild(leftCol);
        grid.appendChild(rightCol);
        container.appendChild(grid);

        if (charType === 'player') {
            hydratePlayerLoadout(character);
        }

        // After rendering everything, initialize modal logic
        initializeImageModal();
    }

    function renderInlineEditToolbar() {
        const toolbar = document.createElement('div');
        toolbar.className = 'character-inline-toolbar';
        toolbar.dataset.inlineEditToolbar = 'true';
        toolbar.innerHTML = `
                    <div>
                        <strong>Modifica pagina NPC</strong>
                        <span>Scrivi nei blocchi, aggiungi sezioni o elimina quelle inutili.</span>
                    </div>
                    <div class="character-inline-toolbar__actions">
                        <button type="button" class="character-inline-btn character-inline-btn--ghost" data-inline-edit-action="cancel">
                            <i class="fas fa-xmark"></i> Annulla
                        </button>
                        <button type="button" class="character-inline-btn character-inline-btn--primary" data-inline-edit-action="save">
                            <i class="fas fa-cloud-arrow-up"></i> Salva
                        </button>
                    </div>
                `;
        return toolbar;
    }

    function renderInlineEditBlock(block, index) {
        const card = document.createElement('article');
        card.className = `content-card character-inline-block ${block.type === 'image' ? 'document-card' : ''}`;
        card.dataset.inlineBlock = String(index);

        const imageControls = block.type === 'image' ? `
                    <label class="character-inline-field character-inline-field--full">
                        <span>Immagine</span>
                        <input type="text" value="${escapeHtml(block.image || '')}" data-inline-block-index="${index}" data-inline-block-field="image" placeholder="media/characters/...webp">
                    </label>
                ` : '';

        const previewHtml = renderMarkdown(block.text || '', { context: block.type === 'image' ? 'image_box' : 'lore' });
        card.innerHTML = `
                    <div class="character-inline-controls">
                        <div class="character-inline-field character-inline-field--icons">
                            <span>Icona</span>
                            <div class="character-inline-icon-grid">
                                ${renderIconPicker(block.icon || 'fa-book-open', index)}
                            </div>
                        </div>
                        <label class="character-inline-field">
                            <span>Tipo</span>
                            <select data-inline-block-index="${index}" data-inline-block-field="type">
                                <option value="text"${block.type !== 'image' ? ' selected' : ''}>Testo</option>
                                <option value="image"${block.type === 'image' ? ' selected' : ''}>Testo + immagine</option>
                            </select>
                        </label>
                        ${imageControls}
                        <div class="character-inline-actions">
                            <button type="button" class="character-inline-icon-btn" data-inline-edit-action="move-up" data-inline-block-index="${index}" title="Sposta su"><i class="fas fa-arrow-up"></i></button>
                            <button type="button" class="character-inline-icon-btn" data-inline-edit-action="move-down" data-inline-block-index="${index}" title="Sposta giu"><i class="fas fa-arrow-down"></i></button>
                            <button type="button" class="character-inline-icon-btn character-inline-icon-btn--danger" data-inline-edit-action="delete-block" data-inline-block-index="${index}" title="Elimina"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="character-inline-final">
                        ${block.type === 'image' ? `
                            <div class="document-header">
                                <div class="doc-label">
                                    <i class="fas ${escapeHtml(block.icon || 'fa-book-dead')}"></i>
                                    <span class="character-inline-title" contenteditable="plaintext-only" spellcheck="true" data-inline-block-index="${index}" data-inline-block-field="title">${escapeHtml(block.title || 'Informazioni')}</span>
                                </div>
                            </div>
                            <div class="document-body">
                                <div class="document-image">
                                    <button type="button" class="character-inline-image-upload" data-inline-edit-action="upload-block-image" data-inline-block-index="${index}" title="Carica nuova immagine">
                                        ${block.image ? `<img src="${resolveInlineImagePath(block.image)}" alt="${escapeHtml(block.title || '')}" onerror="this.style.display='none'">` : '<span class="character-inline-image-placeholder">Nessuna immagine</span>'}
                                        <span class="character-inline-upload-hint"><i class="fas fa-upload"></i> Cambia immagine</span>
                                    </button>
                                </div>
                                <div class="document-content">
                                    <div class="chapter-content chapter-content--compact character-inline-editable" contenteditable="plaintext-only" spellcheck="true" data-inline-block-index="${index}" data-inline-block-field="text">${previewHtml || '<p></p>'}</div>
                                </div>
                            </div>
                        ` : `
                            <h3>
                                <i class="fas ${escapeHtml(block.icon || 'fa-book-open')}"></i>
                                <span class="character-inline-title" contenteditable="plaintext-only" spellcheck="true" data-inline-block-index="${index}" data-inline-block-field="title">${escapeHtml(block.title || 'Informazioni')}</span>
                            </h3>
                            <div class="chapter-content character-inline-editable" contenteditable="plaintext-only" spellcheck="true" data-inline-block-index="${index}" data-inline-block-field="text">${previewHtml || '<p></p>'}</div>
                        `}
                    </div>
                `;
        return card;
    }

    function getEditableRightColumnHtml(character) {
        const summary = character.summary || {};
        const images = character.images || {};
        const editableStats = [
            ['race', 'Razza'],
            ['period', 'Nascita / periodo'],
            ['age', 'Eta'],
            ['height', 'Altezza'],
            ['weight', 'Peso'],
            ['cause_of_death', 'Causa del decesso']
        ];

        return `
                    <div class="image-card character-inline-side-editor">
                        <button type="button" class="character-inline-portrait-upload" data-inline-edit-action="upload-character-image" data-inline-character-image-target="portrait" title="Carica nuovo ritratto">
                            <img src="${resolveInlineImagePath(images.portrait)}" class="char-portrait" data-inline-portrait-preview onerror="this.src='https://placehold.co/400x500/111/333?text=No+Image'">
                            <span class="character-inline-upload-hint"><i class="fas fa-upload"></i> Cambia ritratto</span>
                        </button>
                        <div class="character-inline-side-fields">
                            <label class="character-inline-field">
                                <span>Nome</span>
                                <input type="text" value="${escapeHtml(character.name || '')}" data-inline-character-field="name">
                            </label>
                            <label class="character-inline-field">
                                <span>Ruolo</span>
                                <input type="text" value="${escapeHtml(character.role || '')}" data-inline-character-field="role">
                            </label>
                            <label class="character-inline-field">
                                <span>Ritratto</span>
                                <input type="text" value="${escapeHtml(images.portrait || '')}" data-inline-character-image-field="portrait" placeholder="media/characters/...webp">
                            </label>
                            <label class="character-inline-field">
                                <span>Avatar</span>
                                <div class="character-inline-image-field-row">
                                    <input type="text" value="${escapeHtml(images.avatar || '')}" data-inline-character-image-field="avatar" placeholder="media/characters/...webp">
                                    <button type="button" class="character-inline-mini-upload" data-inline-edit-action="upload-character-image" data-inline-character-image-target="avatar" title="Carica avatar"><i class="fas fa-upload"></i></button>
                                </div>
                            </label>
                            <label class="character-inline-field">
                                <span>Hover</span>
                                <div class="character-inline-image-field-row">
                                    <input type="text" value="${escapeHtml(images.hover || '')}" data-inline-character-image-field="hover" placeholder="media/characters/...webp">
                                    <button type="button" class="character-inline-mini-upload" data-inline-edit-action="upload-character-image" data-inline-character-image-target="hover" title="Carica hover"><i class="fas fa-upload"></i></button>
                                </div>
                            </label>
                        </div>
                        <div class="stats-grid character-inline-stats-grid">
                            ${editableStats.map(([field, label]) => `
                                <label class="stat-box character-inline-stat-field">
                                    <span class="stat-label">${label}</span>
                                    <input type="text" value="${escapeHtml(summary[field] || '')}" data-inline-character-summary-field="${field}" placeholder="Non disponibile">
                                </label>
                            `).join('')}
                        </div>
                    </div>
                `;
    }

    function getRightColumnHtml(character, allCharacters, npcQuests) {
        const summary = character.summary || {};
        const isPlayerView = charType === 'player';

        // --- CALCOLO ANNO DI NASCITA E ETA' ---
        // --- CALCOLO ANNO DI NASCITA E ETA' ---
        const CURRENT_YEAR = 2026;
        let periodLabel = "Anno di Nascita";
        let periodValue = "Non disponibile";
        let age = "Non disponibile";
        const race = summary.race || "Non disponibile";

        // Parsing Period field (expected format: "Birth-Death" or "Birth")
        if (summary.period && !isPlayerView) {
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

        if (summary.age) {
            age = summary.age;
        }

        // --- ALTRI CAMPI ---
        let height = summary.height || "Non disponibile";
        let weight = summary.weight || "Non disponibile";

        // Backward compatibility: legacy format "height | weight"
        if (typeof summary.height === 'string' && summary.height.includes('|')) {
            const [legacyHeight, legacyWeight] = summary.height.split('|').map((part) => part.trim());
            height = legacyHeight || height;
            if (!summary.weight) {
                weight = legacyWeight || weight;
            }
        }

        const periodStatHtml = isPlayerView ? '' : `
                    <div class="stat-box">
                        <span class="stat-label">${periodLabel}</span>
                        <span class="stat-value">${periodValue}</span>
                    </div>
                `;


        const statsHtml = `
                    <div class="stat-box">
                        <span class="stat-label">Razza</span>
                        <span class="stat-value">${race}</span>
                    </div>
                    ${periodStatHtml}
                    <div class="stat-box">
                        <span class="stat-label">Eta</span>
                        <span class="stat-value">${age}</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-label">Altezza</span>
                        <span class="stat-value">${height}</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-label">Peso</span>
                        <span class="stat-value">${weight}</span>
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

