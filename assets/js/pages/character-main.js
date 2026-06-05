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
            hidden: Boolean(block.hidden),
            markdownText,
            markdownHtml: markdownText ? renderMarkdown(markdownText, { context: block.image ? 'image_box' : 'lore' }) : ''
        };
    });
}

async function loadPlayersData() {
    const resp = await fetch(dataUrl('players.json'));
    if (!resp.ok) throw new Error(`File dati players (${resp.status}) non trovato.`);
    const payload = await resp.json();
    const players = Array.isArray(payload) ? payload : payload?.data;
    const mediaOverrides = await loadMediaOverrides();
    return Array.isArray(players)
        ? normalizeCharactersCollection(players)
            .map(applySyncedPlayerImageFallback)
            .map((character) => applyCharacterMediaOverride(character, mediaOverrides))
        : [];
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
const INVENTORY_EXCLUDED_NAMES = new Set(['unarmedstrike']);
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
    garun: ["ga'run", 'ga run', 'garun', 'luca'],
    randra: ["ran'dra", 'ran dra', 'randra', 'eli'],
    valdor: ['valdor', 'sommo'],
    theldarion: ['theldarion', 'theldari', 'dona']
};
const SKILLS_DATA_URL = dataUrl('skills.json');
const TRANSFORMATIONS_DATA_URL = dataUrl('transformations.json');
const SKILLS_ASSET_BASE = 'media/skill_trees/';
const ABILITY_ICON_SIZE = 256;
const SKILL_TREE_ICON_SIZE = 256;
const CHARACTER_MEDIA_SIZE = 512;
const PLAYER_SKILL_TREE_KEYS = {
    apothecary: 'apothecary',
    garun: 'garun',
    luca: 'garun',
    randra: 'randra',
    eli: 'randra',
    valdor: 'valdor',
    sommo: 'valdor',
    theldarion: 'theldarion',
    theldari: 'theldarion',
    dona: 'theldarion'
};

let inventoryRequestPromise = null;
let inventoryMemoryCache = null;
let skillsRequestPromise = null;
let skillsMemoryCache = null;
let skillsVersion = null;
let skillTreeStatesRequestPromise = null;
let skillTreeStatesMemoryCache = null;
let skillTreeStatesVersion = null;
let wikiItemsRequestPromise = null;
let wikiItemsMemoryCache = null;
let transformationsRequestPromise = null;
let transformationsMemoryCache = null;
let abilityOverridesRequestPromise = null;
let abilityOverridesMemoryCache = null;
let itemOverridesRequestPromise = null;
let itemOverridesMemoryCache = null;
let mediaOverridesRequestPromise = null;
let mediaOverridesMemoryCache = null;
let skillTreeAuthState = null;
let skillTreeCurrentUserIsDm = false;

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

function isHiddenInventoryEntry(entry) {
    return INVENTORY_EXCLUDED_NAMES.has(normalizeText(entry?.name));
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

async function copyTextToClipboard(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch (_) {
            // Fall back to a temporary textarea for older / restricted browsers.
        }
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch (_) {
        copied = false;
    }
    textarea.remove();
    return copied;
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

function getCurrentCampaignId() {
    return window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue';
}

function normalizeSkillTreeEditableHtml(element) {
    const source = element?.cloneNode?.(true);
    if (!source) return '<p></p>';
    source.querySelectorAll('script, style, iframe, object, embed').forEach((entry) => entry.remove());
    source.querySelectorAll('*').forEach((entry) => {
        const tag = entry.tagName.toLowerCase();
        if (!['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'span', 'div'].includes(tag)) {
            entry.replaceWith(document.createTextNode(entry.textContent || ''));
            return;
        }
        Array.from(entry.attributes).forEach((attribute) => entry.removeAttribute(attribute.name));
    });
    source.querySelectorAll('div').forEach((entry) => {
        const paragraph = document.createElement('p');
        while (entry.firstChild) paragraph.appendChild(entry.firstChild);
        if (!paragraph.textContent.trim() && !paragraph.querySelector('br')) {
            paragraph.appendChild(document.createElement('br'));
        }
        entry.replaceWith(paragraph);
    });
    const html = source.innerHTML.trim();
    return html || '<p></p>';
}

function readSharedAuthToken() {
    try {
        return window.CriptaDiscordAuth?.getToken?.()
            || window.localStorage.getItem('discord_jwt')
            || window.sessionStorage.getItem('discord_jwt')
            || '';
    } catch (_) {
        return '';
    }
}

async function resizeImageFileToSquareWebpBlobShared(file, size = SKILL_TREE_ICON_SIZE, quality = 0.86) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { alpha: true });
    context.clearRect(0, 0, size, size);
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
    bitmap.close?.();

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Il browser non ha prodotto un file WebP.'));
                return;
            }
            resolve(blob);
        }, 'image/webp', quality);
    });
}

async function resizeImageFileToWebpBlobShared(file, maxSize = 1600, quality = 0.86) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Il browser non ha prodotto un file WebP.'));
                return;
            }
            resolve(blob);
        }, 'image/webp', quality);
    });
}

function getSyncedPlayerImagePath(character, variant = 'avatar') {
    const characterId = slugify(character?.id || character?.name || 'personaggio');
    const campaignId = getCurrentCampaignId();
    const suffix = variant === 'token' ? '-token' : '';
    const folder = campaignId === 'cripta-di-sangue' ? 'players' : `campaigns/${campaignId}/players`;
    return `media/${folder}/${characterId}${suffix}.webp`;
}

function applySyncedPlayerImageFallback(character) {
    const normalized = { ...character };
    const images = { ...(normalized.images || {}) };
    const avatarPath = getSyncedPlayerImagePath(normalized, 'avatar');
    const tokenPath = getSyncedPlayerImagePath(normalized, 'token');
    if (!images.avatar) images.avatar = avatarPath;
    if (!images.portrait) images.portrait = images.avatar;
    if (!images.hover) images.hover = images.avatar;
    if (!images.token) images.token = tokenPath;
    normalized.images = images;
    return normalized;
}

function getMediaOverrideId(entityType, entityId) {
    return `${slugify(entityType || 'entity')}:${slugify(entityId || 'unknown')}`;
}

function findMediaOverride(records, entityType, entityId, options = {}) {
    const id = getMediaOverrideId(entityType, entityId);
    const normalizedType = normalizeText(entityType);
    const normalizedId = normalizeText(entityId);
    const actorId = normalizeText(options.actorId || '');
    const foundryName = normalizeText(options.foundryName || options.name || '');
    const ownerCharacterId = normalizeText(options.ownerCharacterId || options.characterId || '');
    return (Array.isArray(records) ? records : []).find((record) => {
        if (!record || typeof record !== 'object') return false;
        if (record.id === id || record.key === id) return true;
        if (normalizeText(record.entityType) !== normalizedType) return false;
        if (normalizeText(record.entityId) === normalizedId) return true;

        if (actorId && normalizeText(record.actorId) === actorId) return true;
        if (!foundryName) return false;
        const recordName = normalizeText(record.foundryName || record.name);
        const recordOwner = normalizeText(record.ownerCharacterId || record.characterId);
        return recordName === foundryName && (!ownerCharacterId || !recordOwner || recordOwner === ownerCharacterId);
    }) || null;
}

function applyCharacterMediaOverride(character, overrides = mediaOverridesMemoryCache || []) {
    const normalized = { ...character, images: { ...(character?.images || {}) } };
    const override = findMediaOverride(overrides, 'player', normalized.id || normalized.name);
    const images = override?.images || {};
    if (images.avatar) {
        normalized.images.avatar = images.avatar;
        normalized.images.portrait = images.portrait || images.avatar;
        if (!normalized.images.hover) normalized.images.hover = images.avatar;
    }
    if (images.token) normalized.images.token = images.token;
    return normalized;
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
        try {
            const onlinePayload = await window.CriptaApp?.api?.get?.('api/data/skill-trees', { query: { _: Date.now() } });
            if (Array.isArray(onlinePayload?.data) && onlinePayload.data.length > 0) {
                skillsVersion = Number(onlinePayload.version || 0);
                skillsMemoryCache = normalizeSkillTreesCollection(onlinePayload.data);
                return skillsMemoryCache;
            }
        } catch (error) {
            console.warn('Alberi abilita online non disponibili, uso JSON statico.', error);
        }

        let response = await fetch(SKILLS_DATA_URL);
        const fallbackUrl = window.CriptaApp?.urls?.globalData?.('skills.json') || '../../assets/data/skills.json';
        if (!response.ok && SKILLS_DATA_URL !== fallbackUrl) {
            response = await fetch(fallbackUrl);
        }
        if (!response.ok) {
            throw new Error(`File skill tree non trovato (${response.status}).`);
        }
        const payload = await response.json();
        skillsMemoryCache = payload && typeof payload === 'object' ? payload : {};
        skillsVersion = null;
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

function normalizeSkillTreesCollection(data) {
    if (!Array.isArray(data)) return {};
    return data.reduce((acc, entry) => {
        if (!entry || typeof entry !== 'object') return acc;
        const key = String(entry.id || entry.key || entry.characterId || entry.treeKey || '').trim();
        const tree = entry.tree && typeof entry.tree === 'object' ? entry.tree : entry;
        if (!key || !Array.isArray(tree.nodes)) return acc;
        acc[key] = {
            ...tree,
            id: key,
            name: tree.name || entry.name || entry.title || '',
            ownerCharacterId: tree.ownerCharacterId || entry.ownerCharacterId || entry.characterId || '',
            characterId: tree.characterId || entry.characterId || ''
        };
        return acc;
    }, {});
}

function serializeSkillTreesCollection(trees) {
    return Object.entries(trees || {})
        .filter(([, tree]) => tree && typeof tree === 'object' && Array.isArray(tree.nodes))
        .map(([id, tree]) => ({ ...tree, id }));
}

async function saveSkillTreesData(trees) {
    const body = { data: serializeSkillTreesCollection(trees) };
    if (Number.isFinite(Number(skillsVersion))) body.expectedVersion = Number(skillsVersion);
    const token = readSharedAuthToken();
    if (!token) throw new Error('Login richiesto per salvare l albero abilita.');
    const result = await window.CriptaApp.api.post('api/data/skill-trees', body, { token });
    skillsVersion = Number(result?.version || skillsVersion || 0);
    skillsMemoryCache = trees;
    return result;
}

async function loadSkillTreeStates() {
    if (skillTreeStatesMemoryCache) return skillTreeStatesMemoryCache;
    if (skillTreeStatesRequestPromise) return skillTreeStatesRequestPromise;

    skillTreeStatesRequestPromise = (async () => {
        try {
            const payload = await window.CriptaApp?.api?.get?.('api/data/skill-tree-states', { query: { _: Date.now() } });
            skillTreeStatesVersion = Number(payload?.version || 0);
            skillTreeStatesMemoryCache = Array.isArray(payload?.data) ? payload.data : [];
            return skillTreeStatesMemoryCache;
        } catch (error) {
            console.warn('Stati alberi abilita online non disponibili:', error);
            skillTreeStatesVersion = null;
            skillTreeStatesMemoryCache = [];
            return skillTreeStatesMemoryCache;
        } finally {
            skillTreeStatesRequestPromise = null;
        }
    })();

    return skillTreeStatesRequestPromise;
}

async function loadAbilityOverrides() {
    if (abilityOverridesMemoryCache) return abilityOverridesMemoryCache;
    if (abilityOverridesRequestPromise) return abilityOverridesRequestPromise;

    abilityOverridesRequestPromise = (async () => {
        try {
            let payload = await window.CriptaApp?.api?.get?.('api/data/ability-overrides', { query: { _: Date.now() } });
            if (!Array.isArray(payload?.data) || payload.data.length === 0) {
                const legacyPayload = await window.CriptaApp?.api?.get?.('api/data/ability-icons', { query: { _: Date.now() } }).catch(() => null);
                if (Array.isArray(legacyPayload?.data) && legacyPayload.data.length > 0) payload = legacyPayload;
            }
            abilityOverridesMemoryCache = Array.isArray(payload?.data) ? payload.data : [];
            return abilityOverridesMemoryCache;
        } catch (error) {
            console.warn('Icone abilità online non disponibili:', error);
            abilityOverridesMemoryCache = [];
            return abilityOverridesMemoryCache;
        } finally {
            abilityOverridesRequestPromise = null;
        }
    })();

    return abilityOverridesRequestPromise;
}

async function loadItemOverrides() {
    if (itemOverridesMemoryCache) return itemOverridesMemoryCache;
    if (itemOverridesRequestPromise) return itemOverridesRequestPromise;

    itemOverridesRequestPromise = (async () => {
        try {
            const payload = await window.CriptaApp?.api?.get?.('api/data/item-overrides', { query: { _: Date.now() } });
            itemOverridesMemoryCache = Array.isArray(payload?.data) ? payload.data : [];
            return itemOverridesMemoryCache;
        } catch (error) {
            console.warn('Override inventario online non disponibili:', error);
            itemOverridesMemoryCache = [];
            return itemOverridesMemoryCache;
        } finally {
            itemOverridesRequestPromise = null;
        }
    })();

    return itemOverridesRequestPromise;
}

async function loadMediaOverrides() {
    if (mediaOverridesMemoryCache) return mediaOverridesMemoryCache;
    if (mediaOverridesRequestPromise) return mediaOverridesRequestPromise;

    mediaOverridesRequestPromise = (async () => {
        try {
            const payload = await window.CriptaApp?.api?.get?.('api/data/media-overrides', { query: { _: Date.now() } });
            mediaOverridesMemoryCache = Array.isArray(payload?.data) ? payload.data : [];
            return mediaOverridesMemoryCache;
        } catch (error) {
            console.warn('Override immagini personaggi online non disponibili:', error);
            mediaOverridesMemoryCache = [];
            return mediaOverridesMemoryCache;
        } finally {
            mediaOverridesRequestPromise = null;
        }
    })();

    return mediaOverridesRequestPromise;
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

function getCompanionsForCharacter(payload, character) {
    const companions = Array.isArray(payload && payload.companions) ? payload.companions : [];
    if (!companions.length || !character) return [];
    const characterId = normalizeText(character.id);
    const name = normalizeText(character.name);
    return companions
        .filter((companion) => {
            const ownerCharacterId = normalizeText(companion.ownerCharacterId);
            if (!ownerCharacterId) return false;
            return ownerCharacterId === characterId || ownerCharacterId === name;
        })
        .sort((left, right) => String(left.displayName || left.name || '').localeCompare(String(right.displayName || right.name || ''), 'it'));
}

function resolveSyncedActorImagePath(path) {
    const raw = String(path || '').trim();
    if (!raw) return '';
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    if (/^(media|assets|campaigns|img)\//i.test(raw)) return resolveCharacterAssetPath(raw);
    return '';
}

function getAvatarVariantPath(path) {
    const raw = String(path || '').trim();
    if (!raw || !/\.webp(?:[?#].*)?$/i.test(raw)) return '';
    return raw.replace(/\.webp(?=([?#].*)?$)/i, '-avatar.webp');
}

function getAbilityOverrideIdentity(character, actor, entry) {
    const characterId = String(character?.id || '').trim();
    const characterName = String(character?.name || '').trim();
    const actorId = String(actor?.id || '').trim();
    const actorName = String(actor?.name || actor?.displayName || '').trim();
    const abilityId = String(entry?.id || '').trim();
    const abilityName = String(entry?.name || '').trim();
    const ownerKey = slugify(characterId || actorId || characterName || actorName || 'personaggio');
    const abilityKey = slugify(abilityId || abilityName || 'abilita');
    return {
        key: `${ownerKey}:${abilityKey}`,
        characterId,
        characterName,
        actorId,
        actorName,
        abilityId,
        abilityName
    };
}

function getItemOverrideIdentity(character, actor, entry) {
    const characterId = String(character?.id || '').trim();
    const characterName = String(character?.name || '').trim();
    const actorId = String(actor?.id || '').trim();
    const actorName = String(actor?.name || actor?.displayName || '').trim();
    const itemId = String(entry?.id || '').trim();
    const itemName = String(entry?.name || '').trim();
    const itemType = String(entry?.type || '').trim();
    const ownerKey = slugify(characterId || actorId || characterName || actorName || 'personaggio');
    const itemKey = slugify(itemId || itemName || 'oggetto');
    return {
        key: `${ownerKey}:${itemKey}`,
        characterId,
        characterName,
        actorId,
        actorName,
        itemId,
        itemName,
        itemType
    };
}

function findAbilityOverride(records, identity) {
    if (!identity) return null;
    return (Array.isArray(records) ? records : []).find((record) => {
        if (!record || typeof record !== 'object') return false;
        if (record.key && record.key === identity.key) return true;
        const sameCharacter = Boolean(record.characterId && identity.characterId && record.characterId === identity.characterId)
            || Boolean(record.actorId && identity.actorId && record.actorId === identity.actorId)
            || Boolean(record.actorName && identity.actorName && normalizeText(record.actorName) === normalizeText(identity.actorName));
        const sameAbility = Boolean(record.abilityId && identity.abilityId && record.abilityId === identity.abilityId)
            || Boolean(record.abilityName && identity.abilityName && normalizeText(record.abilityName) === normalizeText(identity.abilityName));
        return sameCharacter && sameAbility;
    }) || null;
}

function findItemOverride(records, identity) {
    if (!identity) return null;
    return (Array.isArray(records) ? records : []).find((record) => {
        if (!record || typeof record !== 'object') return false;
        if (record.key && record.key === identity.key) return true;
        const sameCharacter = Boolean(record.characterId && identity.characterId && record.characterId === identity.characterId)
            || Boolean(record.actorId && identity.actorId && record.actorId === identity.actorId)
            || Boolean(record.actorName && identity.actorName && normalizeText(record.actorName) === normalizeText(identity.actorName));
        const sameItem = Boolean(record.itemId && identity.itemId && record.itemId === identity.itemId)
            || Boolean(record.itemName && identity.itemName && normalizeText(record.itemName) === normalizeText(identity.itemName));
        return sameCharacter && sameItem;
    }) || null;
}

function getInventoryEntryIconPath(entry, wikiItem, itemOverride) {
    const overrideImage = String(itemOverride?.image || '').trim();
    const overrideSource = String(itemOverride?.imageSource || '').trim().toLowerCase();
    if (overrideImage && overrideSource === 'site') {
        return appendAssetVersion(overrideImage, itemOverride.updatedAt);
    }
    if (wikiItem) return '';
    if (overrideImage) return appendAssetVersion(overrideImage, itemOverride.updatedAt);
    return entry?.img || '';
}

function getCompanionAvatarImageCandidates(companion) {
    const tokenPath = companion?.token?.img || '';
    const avatarVariant = getAvatarVariantPath(tokenPath);
    return Array.from(new Set([
        resolveSyncedActorImagePath(companion?.img),
        resolveSyncedActorImagePath(avatarVariant),
        resolveSyncedActorImagePath(tokenPath)
    ].filter(Boolean)));
}

function getCompanionMediaOverrideIdentity(character, companion) {
    const companionName = companion?.foundryName || companion?.name || companion?.displayName || companion?.id || 'companion';
    const entityId = slugify(character?.id ? `${character.id}-${companionName}` : companionName);
    return {
        id: getMediaOverrideId('companion', entityId),
        entityType: 'companion',
        entityId,
        characterId: character?.id || '',
        ownerCharacterId: character?.id || '',
        ownerAccountId: character?.accountId || '',
        name: companion?.displayName || companion?.name || 'Companion',
        foundryName: companion?.foundryName || companion?.name || '',
        actorId: companion?.id || ''
    };
}

function applyCompanionMediaOverride(companion, identity, overrides = mediaOverridesMemoryCache || []) {
    const override = findMediaOverride(overrides, 'companion', identity?.entityId, identity);
    if (!override?.images) return companion;
    const next = {
        ...companion,
        token: { ...(companion?.token || {}) }
    };
    if (override.images.avatar) next.img = override.images.avatar;
    if (override.images.token) next.token.img = override.images.token;
    return next;
}

function splitActorLoadout(actor) {
    const sourceEntries = Array.isArray(actor && actor.inventory) ? actor.inventory : [];
    const spells = [];
    const inventory = [];
    const abilities = [];

    sourceEntries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        if (isHiddenInventoryEntry(entry)) return;
        if (entry.type === 'spell') {
            spells.push(entry);
            return;
        }
        if (entry.type === 'feat') {
            abilities.push(entry);
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

    abilities.sort((a, b) => {
        const activationA = String(a.activation?.type || '');
        const activationB = String(b.activation?.type || '');
        const activationOrder = activationA.localeCompare(activationB, 'it');
        if (activationOrder !== 0) return activationOrder;
        return String(a.name || '').localeCompare(String(b.name || ''), 'it');
    });

    return { inventory, spells, abilities };
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

async function loadTransformationsData(options = {}) {
    if (options.force === true) {
        transformationsMemoryCache = null;
        transformationsRequestPromise = null;
    }
    if (transformationsMemoryCache) return transformationsMemoryCache;
    if (transformationsRequestPromise) return transformationsRequestPromise;

    transformationsRequestPromise = (async () => {
        let staticList = [];
        try {
            const response = await fetch(TRANSFORMATIONS_DATA_URL);
            if (response.ok) {
                const payload = await response.json();
                staticList = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []);
            }
        } catch (error) {
            console.warn('transformations.json non disponibile, uso solo KV.', error);
        }

        let onlineList = null;
        try {
            if (typeof window.CriptaApp?.api?.get === 'function') {
                const payload = await window.CriptaApp.api.get('api/data/transformations', { query: { _: Date.now() } });
                if (Array.isArray(payload?.data)) onlineList = payload.data;
            }
        } catch (error) {
            console.warn('KV transformations non disponibile, uso JSON statico.', error);
        }

        transformationsMemoryCache = mergeTransformations(staticList, onlineList || []);
        return transformationsMemoryCache;
    })();

    try {
        return await transformationsRequestPromise;
    } finally {
        transformationsRequestPromise = null;
    }
}

function mergeTransformations(baseList, overrideList) {
    const merged = new Map();
    const add = (entry) => {
        if (!entry || typeof entry !== 'object') return;
        const key = entry.id || `${entry.characterId || entry.ownerAccountId || 'global'}-${slugify(entry.creatureName || entry.name || entry.foundryName || 'forma')}`;
        merged.set(key, { ...entry, id: key });
    };
    (Array.isArray(baseList) ? baseList : []).forEach(add);
    (Array.isArray(overrideList) ? overrideList : []).forEach(add);
    return Array.from(merged.values());
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

function renderLoadoutEntryIcon(imagePath, label = 'Elemento Foundry') {
    const image = resolveSyncedActorImagePath(imagePath);
    if (!image) return '';
    const safeLabel = escapeHtml(label || 'Elemento Foundry');
    return `
                <span class="loadout-entry-icon">
                    <img src="${escapeHtml(image)}" alt="${safeLabel}" onerror="this.parentElement.remove();">
                </span>
            `;
}

function appendAssetVersion(path, version) {
    const value = String(path || '').trim();
    const stamp = String(version || '').trim();
    if (!value || !stamp || /^(data:|blob:)/i.test(value)) return value;
    return `${value}${value.includes('?') ? '&' : '?'}v=${encodeURIComponent(stamp)}`;
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
    ).filter((item) => !isHiddenInventoryEntry(item));

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
    const equippedItems = getUniqueItemList(Array.isArray(actor.equippedItems) ? actor.equippedItems : [])
        .filter((item) => !isHiddenInventoryEntry(item));
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

function renderLoadoutDisclosure(title, quantityLabel, description, badges, extraClass = '', dataAttributes = '', wikiItem = null, foundryName = '', iconPath = '', bodyExtraHtml = '') {
    const bodyParts = [];
    const wikiBridge = renderWikiItemBridge(wikiItem, foundryName);
    const entryIcon = iconPath
        ? renderLoadoutEntryIcon(iconPath, title || 'Elemento senza nome')
        : (wikiItem
            ? renderWikiItemThumb(wikiItem, 'loadout-entry-icon', title || 'Elemento senza nome')
            : renderLoadoutEntryIcon(iconPath, title || 'Elemento senza nome'));
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
    if (bodyExtraHtml) {
        bodyParts.push(bodyExtraHtml);
    }
    if (bodyParts.length === 0) {
        bodyParts.push('<p class="loadout-entry-description">Nessun dettaglio disponibile.</p>');
    }

    return `
                <details class="loadout-entry ${extraClass}" ${dataAttributes}>
                    <summary class="loadout-entry-toggle">
                        <span class="loadout-entry-title">
                            ${entryIcon}
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

function renderInventoryEntries(entries, context = {}) {
    if (!entries.length) {
        return '<p class="loadout-empty">Nessun oggetto disponibile.</p>';
    }

    const { character = null, actor = null, itemOverrides = [] } = context;
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
            const identity = getItemOverrideIdentity(character, actor, entry);
            const itemOverride = findItemOverride(itemOverrides, identity);
            badges.push(typeMeta.label);
            if (wikiItem) badges.push('Wiki');
            if (itemOverride?.image) badges.push(itemOverride.imageSource === 'site' ? 'Icona wiki' : 'Icona Foundry');
            if (itemOverride?.description) badges.push('Testo wiki');
            if (entry.rarity) badges.push(`Rarita: ${formatToken(entry.rarity)}`);
            if (entry.attuned) badges.push('Sintonizzato');

            const description = cleanDescription(itemOverride?.description || entry.description);
            const quantityLabel = getQuantityLabel(entry);
            const overrideDescriptionHtml = itemOverride?.description && wikiItem
                ? `<div class="loadout-entry-description">${renderDescriptionHtml(cleanDescription(itemOverride.description))}</div>`
                : '';
            const overrideActions = `
                    ${overrideDescriptionHtml}
                    <div class="loadout-entry-actions">
                        <button
                            type="button"
                            class="loadout-entry-action"
                            data-item-icon-upload
                            data-item-key="${escapeHtml(identity.key)}"
                            data-character-id="${escapeHtml(identity.characterId)}"
                            data-character-name="${escapeHtml(identity.characterName)}"
                            data-actor-id="${escapeHtml(identity.actorId)}"
                            data-actor-name="${escapeHtml(identity.actorName)}"
                            data-item-id="${escapeHtml(identity.itemId)}"
                            data-item-name="${escapeHtml(identity.itemName)}"
                            data-item-type="${escapeHtml(identity.itemType)}"
                        >
                            <i class="fas fa-image" aria-hidden="true"></i>
                            Cambia icona
                        </button>
                        <button
                            type="button"
                            class="loadout-entry-action"
                            data-item-description-edit
                            data-item-key="${escapeHtml(identity.key)}"
                            data-character-id="${escapeHtml(identity.characterId)}"
                            data-character-name="${escapeHtml(identity.characterName)}"
                            data-actor-id="${escapeHtml(identity.actorId)}"
                            data-actor-name="${escapeHtml(identity.actorName)}"
                            data-item-id="${escapeHtml(identity.itemId)}"
                            data-item-name="${escapeHtml(identity.itemName)}"
                            data-item-type="${escapeHtml(identity.itemType)}"
                            data-current-description="${escapeHtml(description)}"
                        >
                            <i class="fas fa-pen" aria-hidden="true"></i>
                            Modifica testo
                        </button>
                    </div>
                    <div class="loadout-inline-editor" data-item-description-editor hidden>
                        <label>
                            <span>Descrizione wiki</span>
                            <textarea data-item-description-text rows="8">${escapeHtml(description)}</textarea>
                        </label>
                        <div class="loadout-inline-editor__actions">
                            <button type="button" class="loadout-entry-action loadout-entry-action--primary" data-item-description-save>
                                <i class="fas fa-floppy-disk" aria-hidden="true"></i>
                                Salva testo
                            </button>
                            <button type="button" class="loadout-entry-action" data-item-description-cancel>
                                Annulla
                            </button>
                        </div>
                    </div>
                `;

            return renderLoadoutDisclosure(
                wikiItem?.name || entry.name || 'Oggetto senza nome',
                quantityLabel,
                description,
                badges,
                wikiItem ? 'loadout-entry--wiki-linked' : '',
                `data-inventory-type="${typeMeta.key}"`,
                wikiItem,
                entry.name || '',
                getInventoryEntryIconPath(entry, wikiItem, itemOverride),
                overrideActions
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
            `data-spell-level="${levelMeta.key}"`,
            null,
            '',
            entry.img || ''
        );
    }).join('');
}

function renderAbilityEntries(entries, context = {}) {
    if (!entries.length) {
        return '<p class="loadout-empty">Nessuna abilità sincronizzata.</p>';
    }

    const { character = null, actor = null, abilityOverrides = [] } = context;
    return entries.map((entry) => {
        const badges = ['Abilità'];
        const identity = getAbilityOverrideIdentity(character, actor, entry);
        const abilityOverride = findAbilityOverride(abilityOverrides, identity);
        if (abilityOverride?.image) badges.push('Icona wiki');
        if (abilityOverride?.description) badges.push('Testo wiki');
        const activation = entry.activation?.type ? formatToken(entry.activation.type) : '';
        if (activation) badges.push(`Uso: ${activation}`);

        const rangeLabel = formatRange(entry.range);
        if (rangeLabel) badges.push(`Raggio: ${rangeLabel}`);

        const durationLabel = formatDuration(entry.duration);
        if (durationLabel) badges.push(`Durata: ${durationLabel}`);

        const uses = entry.uses || {};
        const maxUses = uses.max ?? uses.value;
        const spentUses = uses.spent;
        if (maxUses !== undefined && maxUses !== null && String(maxUses).trim() !== '') {
            const usedLabel = spentUses !== undefined && spentUses !== null && String(spentUses).trim() !== ''
                ? `${spentUses}/${maxUses}`
                : String(maxUses);
            badges.push(`Usi: ${usedLabel}`);
        }

        const description = abilityOverride?.description || entry.description;
        const overrideActions = `
                    <div class="loadout-entry-actions">
                        <button
                            type="button"
                            class="loadout-entry-action"
                            data-ability-icon-upload
                            data-ability-key="${escapeHtml(identity.key)}"
                            data-character-id="${escapeHtml(identity.characterId)}"
                            data-character-name="${escapeHtml(identity.characterName)}"
                            data-actor-id="${escapeHtml(identity.actorId)}"
                            data-actor-name="${escapeHtml(identity.actorName)}"
                            data-ability-id="${escapeHtml(identity.abilityId)}"
                            data-ability-name="${escapeHtml(identity.abilityName)}"
                        >
                            <i class="fas fa-image" aria-hidden="true"></i>
                            Cambia icona
                        </button>
                        <button
                            type="button"
                            class="loadout-entry-action"
                            data-ability-description-edit
                            data-ability-key="${escapeHtml(identity.key)}"
                            data-character-id="${escapeHtml(identity.characterId)}"
                            data-character-name="${escapeHtml(identity.characterName)}"
                            data-actor-id="${escapeHtml(identity.actorId)}"
                            data-actor-name="${escapeHtml(identity.actorName)}"
                            data-ability-id="${escapeHtml(identity.abilityId)}"
                            data-ability-name="${escapeHtml(identity.abilityName)}"
                        >
                            <i class="fas fa-pen" aria-hidden="true"></i>
                            Modifica testo
                        </button>
                    </div>
                `;

        return renderLoadoutDisclosure(
            entry.name || 'Abilità senza nome',
            '',
            cleanDescription(description),
            badges,
            'loadout-entry--ability',
            '',
            null,
            '',
            abilityOverride?.image ? appendAssetVersion(abilityOverride.image, abilityOverride.updatedAt) : (entry.img || ''),
            overrideActions
        );
    }).join('');
}

function buildPlayerLoadoutHtml(character, payload, wikiItems = [], abilityOverrides = [], itemOverrides = []) {
    const actor = findPlayerActor(payload, character);
    if (!actor) {
        return `
                    <h3><i class="fas fa-box-open"></i> Inventario / Incantesimi / Abilità</h3>
                    <p class="loadout-empty">Nessun inventario trovato per ${escapeHtml(character.name)} nella risposta API.</p>
                `;
    }

    const wikiItemIndex = buildWikiItemIndex(wikiItems);
    const { inventory, spells, abilities } = splitActorLoadout(actor);
    inventory.forEach((entry) => {
        entry.wikiItem = findWikiItemForInventoryEntry(entry, wikiItemIndex);
    });
    [actor.equippedItems, actor.attunementItems].forEach((items) => {
        if (!Array.isArray(items)) return;
        items.forEach((entry) => {
            if (isHiddenInventoryEntry(entry)) return;
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
                <h3><i class="fas fa-box-open"></i> Inventario / Incantesimi / Abilità</h3>
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
                    <button class="loadout-tab" type="button" role="tab" aria-selected="false" data-panel-target="abilities">
                        Abilità <span class="loadout-count">${abilities.length}</span>
                    </button>
                </div>
                <section class="loadout-panel is-active" data-panel="inventory" role="tabpanel">
                    ${inventorySummaryHtml}
                    ${renderInventoryTypeFilters(inventory)}
                    ${renderInventoryEntries(inventory, { character, actor, itemOverrides })}
                </section>
                <section class="loadout-panel" data-panel="spells" role="tabpanel" hidden>
                    ${spellsSummaryHtml}
                    ${renderSpellLevelFilters(preparedSpells)}
                    ${renderSpellEntries(preparedSpells)}
                </section>
                <section class="loadout-panel" data-panel="abilities" role="tabpanel" hidden>
                    ${renderAbilityEntries(abilities, { character, actor, abilityOverrides })}
                </section>
            `;
}

function renderCompanionFeatures(entries) {
    const features = (Array.isArray(entries) ? entries : [])
        .filter((entry) => entry && entry.type === 'feat')
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'it'));
    if (!features.length) return '<p class="loadout-empty">Nessuna azione o tratto sincronizzato.</p>';
    return features.map((entry) => {
        const badges = ['Feature'];
        const activation = entry.activation?.type ? formatToken(entry.activation.type) : '';
        if (activation) badges.push(`Uso: ${activation}`);
        return renderLoadoutDisclosure(
            entry.name || 'Feature senza nome',
            '',
            cleanDescription(entry.description),
            badges,
            'loadout-entry--spell',
            ''
        );
    }).join('');
}

function buildCompanionsHtml(character, payload, wikiItems = [], mediaOverrides = [], options = {}) {
    const companions = getCompanionsForCharacter(payload, character);
    if (!companions.length) {
        return '';
    }

    const wikiItemIndex = buildWikiItemIndex(wikiItems);
    const canEdit = options.canEdit === true;
    const cards = companions.map((rawCompanion) => {
        try {
            const identity = getCompanionMediaOverrideIdentity(character, rawCompanion);
            const companion = applyCompanionMediaOverride(rawCompanion, identity, mediaOverrides);
            const title = companion.displayName || companion.name || 'Companion';
            const imageCandidates = getCompanionAvatarImageCandidates(companion);
            const image = imageCandidates[0] || '';
            const fallbackImage = imageCandidates[1] || '';
            const imageErrorHandler = fallbackImage
                ? `if(this.dataset.fallbackSrc){this.src=this.dataset.fallbackSrc;this.dataset.fallbackSrc='';}else{this.style.display='none';this.nextElementSibling.hidden=false;}`
                : `this.style.display='none';this.nextElementSibling.hidden=false;`;
            const initials = String(title || '?').trim().charAt(0).toUpperCase() || '?';
            const { inventory, spells, abilities } = splitActorLoadout(companion);
            inventory.forEach((entry) => {
                entry.wikiItem = findWikiItemForInventoryEntry(entry, wikiItemIndex);
            });
            const featuresHtml = renderCompanionFeatures(abilities);
            const inventoryHtml = renderInventoryEntries(inventory);
            const spellsHtml = renderSpellEntries(spells.filter((spell) => spell.prepared || spell.level === 0));
            const details = companion.details || {};
            const detailChips = [
                details.type ? `Tipo: ${formatToken(details.type)}` : '',
                details.cr !== undefined ? `CR: ${formatNumberIt(details.cr, 2)}` : '',
                details.alignment ? `Allineamento: ${details.alignment}` : ''
            ].filter(Boolean);

            return `
                    <article class="companion-card">
                        <div class="companion-card__top">
                            <div class="companion-card__content">
                                <div class="companion-card__overview">
                                    <div class="companion-card__summary">
                                        <div class="companion-card__header">
                                            <div>
                                                <p>Companion di ${escapeHtml(character.name || 'personaggio')}</p>
                                                <h4>${escapeHtml(title)}</h4>
                                                ${detailChips.length ? `<div class="loadout-chip-row">${detailChips.map((chip) => `<span class="loadout-chip">${escapeHtml(chip)}</span>`).join('')}</div>` : ''}
                                            </div>
                                        </div>
                                        <div class="companion-card__vitals">
                                            ${renderVitalOverview(companion)}
                                        </div>
                                    </div>
                                    <section class="character-live-card companion-card__abilities">
                                        <h4><i class="fas fa-dumbbell"></i> Caratteristiche</h4>
                                        ${renderAbilityOverview(companion) || '<p class="player-overview-empty">Caratteristiche non disponibili.</p>'}
                                    </section>
                                </div>
                                <section class="character-live-card character-live-card--wide companion-card__features">
                                    <h4><i class="fas fa-dragon"></i> Azioni e tratti</h4>
                                    ${featuresHtml}
                                </section>
                            </div>
                            <div class="companion-card__hero">
                                ${image ? `<img src="${escapeHtml(image)}" ${fallbackImage ? `data-fallback-src="${escapeHtml(fallbackImage)}"` : ''} alt="${escapeHtml(title)}" onerror="${imageErrorHandler}">` : ''}
                                <span ${image ? 'hidden' : ''}>${escapeHtml(initials)}</span>
                                ${canEdit ? `
                                <div class="character-media-actions character-media-actions--companion">
                                    <button type="button" data-media-override-action="upload" data-media-entity-type="companion" data-media-kind="avatar" data-media-identity="${escapeHtml(identity.entityId)}" data-media-name="${escapeHtml(identity.name)}" data-media-foundry-name="${escapeHtml(identity.foundryName)}" data-media-actor-id="${escapeHtml(identity.actorId)}">
                                        <i class="fas fa-user"></i> Avatar
                                    </button>
                                    <button type="button" data-media-override-action="upload" data-media-entity-type="companion" data-media-kind="token" data-media-identity="${escapeHtml(identity.entityId)}" data-media-name="${escapeHtml(identity.name)}" data-media-foundry-name="${escapeHtml(identity.foundryName)}" data-media-actor-id="${escapeHtml(identity.actorId)}">
                                        <i class="fas fa-circle-dot"></i> Token
                                    </button>
                                </div>` : ''}
                            </div>
                        </div>
                        <div class="character-live-grid companion-card__grid">
                            <section class="character-live-card character-live-card--wide">
                                <h4><i class="fas fa-box-open"></i> Oggetti</h4>
                                ${inventoryHtml}
                            </section>
                            ${spells.length ? `
                            <section class="character-live-card character-live-card--wide">
                                <h4><i class="fas fa-bolt"></i> Incantesimi</h4>
                                ${spellsHtml}
                            </section>` : ''}
                        </div>
                    </article>
                `;
        } catch (error) {
            console.warn('Errore rendering companion:', { companion: rawCompanion, error });
            const title = rawCompanion?.displayName || rawCompanion?.name || 'Companion';
            return `
                    <article class="companion-card">
                        <div class="companion-card__top">
                            <div class="companion-card__content">
                                <div class="companion-card__overview">
                                    <div class="companion-card__summary">
                                        <div class="companion-card__header">
                                            <div>
                                                <p>Companion di ${escapeHtml(character.name || 'personaggio')}</p>
                                                <h4>${escapeHtml(title)}</h4>
                                            </div>
                                        </div>
                                        <p class="loadout-empty">Impossibile mostrare questo companion. Controlla il payload sincronizzato da Foundry.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </article>
                `;
        }
    }).join('');

    return `
                <div class="companion-section-heading">
                    <h3><i class="fas fa-paw"></i> Companion</h3>
                    <p>Dati sincronizzati da Foundry. Modifica statistiche, oggetti e immagini dall'actor companion.</p>
                </div>
                <div class="companion-card-list">
                    ${cards}
                </div>
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

function resolvePlayerSkillTree(characterOrId, allSkillTrees) {
    return resolvePlayerSkillTreeEntry(characterOrId, allSkillTrees)?.tree || null;
}

function resolvePlayerSkillTreeEntry(characterOrId, allSkillTrees) {
    return resolvePlayerSkillTreeEntries(characterOrId, allSkillTrees)[0] || null;
}

function resolvePlayerSkillTreeEntries(characterOrId, allSkillTrees) {
    if (!allSkillTrees || typeof allSkillTrees !== 'object') return [];
    const character = typeof characterOrId === 'object' && characterOrId !== null ? characterOrId : { id: characterOrId };
    const candidates = [
        character.id,
        character.accountId,
        character.discordId,
        character.name,
        character.characterName,
        character.playerName,
        character.foundryName
    ];

    Object.entries(PLAYER_NAME_ALIASES).forEach(([treeKey, aliases]) => {
        const normalizedCandidates = candidates.map(normalizeText);
        if (aliases.some((alias) => normalizedCandidates.includes(normalizeText(alias)))) {
            candidates.push(treeKey);
        }
    });

    const keysByNormalized = new Map(Object.keys(allSkillTrees).map((key) => [normalizeText(key), key]));
    const results = [];
    const used = new Set();
    const addEntry = (key) => {
        if (!key || used.has(key) || !allSkillTrees[key]) return;
        used.add(key);
        results.push({ key, tree: allSkillTrees[key] });
    };

    for (const candidate of candidates) {
        const normalized = normalizeText(candidate);
        if (!normalized) continue;
        const mappedKey = PLAYER_SKILL_TREE_KEYS[slugify(candidate)] || PLAYER_SKILL_TREE_KEYS[normalized] || candidate;
        const directKey = allSkillTrees[mappedKey] ? mappedKey : keysByNormalized.get(normalizeText(mappedKey));
        if (directKey && allSkillTrees[directKey]) addEntry(directKey);
        const normalizedKey = keysByNormalized.get(normalized);
        if (normalizedKey && allSkillTrees[normalizedKey]) addEntry(normalizedKey);
    }

    const normalizedCandidates = new Set(candidates.map(normalizeText).filter(Boolean));
    Object.entries(allSkillTrees).forEach(([key, tree]) => {
        if (!tree || typeof tree !== 'object') return;
        const normalizedKey = normalizeText(key);
        const owners = [
            tree.characterId,
            tree.ownerCharacterId,
            tree.accountId,
            tree.playerId,
            ...(Array.isArray(tree.characterIds) ? tree.characterIds : []),
            ...(Array.isArray(tree.ownerCharacterIds) ? tree.ownerCharacterIds : [])
        ].map(normalizeText).filter(Boolean);
        if (owners.some((owner) => normalizedCandidates.has(owner))) {
            addEntry(key);
            return;
        }
        for (const candidate of normalizedCandidates) {
            if (normalizedKey.startsWith(`${candidate}-`) || normalizedKey.startsWith(`${candidate}_`)) {
                addEntry(key);
                return;
            }
        }
    });

    if (results.length > 1) {
        results.sort((left, right) => {
            const leftOrder = Number(left.tree.order ?? 0);
            const rightOrder = Number(right.tree.order ?? 0);
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            return String(left.tree.name || left.tree.title || left.key).localeCompare(String(right.tree.name || right.tree.title || right.key), 'it');
        });
    }
    return results;
}

function getSkillTreeStateKey(character, treeKey) {
    return slugify(`${getCurrentCampaignId()}-${treeKey || ''}-${character?.id || character?.accountId || character?.name || ''}`);
}

function getCurrentAccountId() {
    const user = skillTreeAuthState?.user || {};
    return slugify(user.accountId || user.id || user.sub || user.discordId || '');
}

function canEditSkillTreeUnlocks(character) {
    if (skillTreeCurrentUserIsDm) return true;
    const user = skillTreeAuthState?.user || {};
    const accountId = String(user.accountId || user.id || user.sub || '').trim();
    const discordId = String(user.discordId || '').trim();
    return Boolean(accountId && character?.accountId && slugify(accountId) === slugify(character.accountId))
        || Boolean(discordId && character?.discordId && String(discordId) === String(character.discordId));
}

function getCharacterSkillTreeState(character, treeKey) {
    const key = getSkillTreeStateKey(character, treeKey);
    const accountId = getCurrentAccountId();
    const characterId = slugify(character?.id || '');
    return (skillTreeStatesMemoryCache || []).find((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        if (entry.id === key || entry.key === key) return true;
        return slugify(entry.characterId || '') === characterId
            && slugify(entry.treeKey || '') === slugify(treeKey || '')
            && (skillTreeCurrentUserIsDm || !accountId || !entry.ownerAccountId || slugify(entry.ownerAccountId) === accountId);
    }) || null;
}

function getNodePrerequisites(node, treeData) {
    const explicit = Array.isArray(node.requires) ? node.requires : Array.isArray(node.requirements) ? node.requirements : null;
    if (explicit) return explicit.map(String).filter(Boolean);
    const parents = [];
    (treeData.nodes || []).forEach((candidate) => {
        if (getSkillTreeConnections(candidate).some((connection) => connection.target === String(node.id))) {
            parents.push(String(candidate.id));
        }
    });
    return parents;
}

function normalizeSkillTreeConnection(connection) {
    if (connection && typeof connection === 'object') {
        const target = String(connection.target || connection.to || connection.id || '').trim();
        if (!target) return null;
        return {
            target,
            mode: connection.mode === 'exclusive' || connection.exclusive === true ? 'exclusive' : 'normal'
        };
    }
    const target = String(connection || '').trim();
    return target ? { target, mode: 'normal' } : null;
}

function getSkillTreeConnections(node) {
    if (!Array.isArray(node?.connections)) return [];
    return node.connections
        .map((connection) => normalizeSkillTreeConnection(connection))
        .filter(Boolean);
}

function setSkillTreeConnections(node, connections) {
    node.connections = (connections || []).map((connection) => {
        const normalized = normalizeSkillTreeConnection(connection);
        if (!normalized) return null;
        return normalized.mode === 'exclusive'
            ? { target: normalized.target, mode: 'exclusive' }
            : normalized.target;
    }).filter(Boolean);
}

function getSkillTreeRequirementMode(node) {
    return ['any', 'one'].includes(String(node?.requiresMode || node?.requireMode || node?.requirementMode || '').toLowerCase())
        ? 'any'
        : 'all';
}

function canUnlockSkillNode(requirements, requirementMode, unlocked) {
    if (!requirements.length) return true;
    return requirementMode === 'any'
        ? requirements.some((id) => unlocked.has(String(id)))
        : requirements.every((id) => unlocked.has(String(id)));
}

function getExclusiveSkillTreeSiblingIds(treeData, nodeId) {
    const id = String(nodeId);
    const siblings = new Set();
    (treeData.nodes || []).forEach((source) => {
        const exclusiveTargets = getSkillTreeConnections(source)
            .filter((connection) => connection.mode === 'exclusive')
            .map((connection) => connection.target);
        if (!exclusiveTargets.includes(id)) return;
        exclusiveTargets.forEach((targetId) => {
            if (targetId !== id) siblings.add(targetId);
        });
    });
    return Array.from(siblings);
}

function isSkillNodeBlockedByExclusiveChoice(treeData, nodeId, unlocked) {
    return getExclusiveSkillTreeSiblingIds(treeData, nodeId).some((siblingId) => unlocked.has(String(siblingId)));
}

function deriveSkillTreeNodes(treeData, stateRecord) {
    const baseUnlocked = new Set(
        (treeData.nodes || [])
            .filter((node) => node.state === 'unlocked' || node.unlocked === true)
            .map((node) => String(node.id))
    );
    const stateUnlocked = Array.isArray(stateRecord?.unlocked) ? stateRecord.unlocked : Array.isArray(stateRecord?.unlockedNodeIds) ? stateRecord.unlockedNodeIds : null;
    const unlocked = new Set((stateUnlocked || Array.from(baseUnlocked)).map(String));

    return (treeData.nodes || []).map((node) => {
        const nodeId = String(node.id);
        const requirements = getNodePrerequisites(node, treeData);
        const requirementMode = getSkillTreeRequirementMode(node);
        let state = 'locked';
        if (unlocked.has(nodeId)) {
            state = 'unlocked';
        } else if (!isSkillNodeBlockedByExclusiveChoice(treeData, nodeId, unlocked) && canUnlockSkillNode(requirements, requirementMode, unlocked)) {
            state = 'unlockable';
        }
        return { ...node, id: nodeId, requires: requirements, requiresMode: requirementMode, state };
    });
}

function pruneUnlockedSkillNodes(treeData, unlockedIds) {
    const nextUnlocked = new Set(Array.from(unlockedIds || []).map(String));
    let changed = true;
    while (changed) {
        changed = false;
        (treeData.nodes || []).forEach((node) => {
            const nodeId = String(node.id);
            if (!nextUnlocked.has(nodeId)) return;
            const requirements = getNodePrerequisites(node, treeData);
            const canStayUnlocked = canUnlockSkillNode(requirements, getSkillTreeRequirementMode(node), nextUnlocked);
            if (!canStayUnlocked) {
                nextUnlocked.delete(nodeId);
                changed = true;
            }
        });
    }
    return nextUnlocked;
}

async function saveCharacterSkillTreeState(character, treeKey, unlockedIds) {
    const accountId = getCurrentAccountId();
    const stateId = getSkillTreeStateKey(character, treeKey);
    const existingStates = await loadSkillTreeStates();
    const kept = existingStates.filter((entry) => entry?.id !== stateId && entry?.key !== stateId);
    const nextRecord = {
        id: stateId,
        treeKey,
        characterId: character?.id || '',
        ownerAccountId: accountId || slugify(character?.accountId || ''),
        unlocked: Array.from(new Set((unlockedIds || []).map(String))).filter(Boolean),
        updatedAt: new Date().toISOString()
    };
    const nextStates = [...kept, nextRecord];
    const body = { data: nextStates };
    const token = readSharedAuthToken();
    if (!token) throw new Error('Login richiesto per salvare lo stato albero abilita.');
    const result = await window.CriptaApp.api.post('api/data/skill-tree-states', body, { token });
    skillTreeStatesVersion = Number(result?.version || skillTreeStatesVersion || 0);
    skillTreeStatesMemoryCache = nextStates;
    return result;
}

function buildPlayerSkillTreeCard(characterOrId, allSkillTrees, forcedTreeEntry = null) {
    const treeEntry = forcedTreeEntry || resolvePlayerSkillTreeEntry(characterOrId, allSkillTrees);
    const treeData = treeEntry?.tree || null;
    if (!treeData || !Array.isArray(treeData.nodes) || treeData.nodes.length === 0) {
        return null;
    }
    const character = typeof characterOrId === 'object' && characterOrId !== null ? characterOrId : { id: characterOrId };
    const treeKey = treeEntry.key;
    const canEditUnlocks = canEditSkillTreeUnlocks(character);
    const canEditTree = skillTreeCurrentUserIsDm;
    const stateRecord = getCharacterSkillTreeState(character, treeKey);
    let workingTree = {
        ...treeData,
        nodes: (treeData.nodes || []).map((node) => ({ ...node, id: String(node.id) }))
    };
    let currentNodes = deriveSkillTreeNodes(workingTree, stateRecord);
    let unlockedIds = new Set(currentNodes.filter((node) => node.state === 'unlocked').map((node) => String(node.id)));
    let selectedNodeId = currentNodes[0]?.id || '';
    let editMode = false;
    let snapToGrid = false;
    let snapToNodes = true;
    let snapGridStep = 5;
    let linkDrag = null;
    let selectedConnection = null;
    const snapThreshold = 1.4;

    const card = document.createElement('div');
    card.className = 'content-card player-skill-tree-card';
    card.id = `player-skill-tree-card-${slugify(treeKey || 'default')}`;
    card.tabIndex = -1;
    const treeLabel = workingTree.name || workingTree.title || (treeKey ? treeKey.replace(/[-_]+/g, ' ') : 'Albero abilita');
    card.innerHTML = `
                <div class="player-skill-tree-card-head">
                    <h3><i class="fas fa-crown"></i> Albero Abilita <small data-skill-tree-label>${escapeHtml(treeLabel)}</small></h3>
                    ${canEditTree ? '<button type="button" class="player-skill-edit-toggle" data-skill-edit-toggle title="Modifica albero" aria-label="Modifica albero"><i class="fas fa-pen"></i></button>' : ''}
                </div>
                <div class="player-skill-tree-layout">
                    <div class="player-skill-tree-column">
                        <div class="player-skill-tree-wrapper" data-skill-tree>
                            <svg class="player-skill-tree-connections" data-skill-tree-lines></svg>
                            <div class="player-skill-snap-guide player-skill-snap-guide--x" data-skill-snap-x hidden></div>
                            <div class="player-skill-snap-guide player-skill-snap-guide--y" data-skill-snap-y hidden></div>
                        </div>
                    </div>
                    <aside class="player-skill-info" data-skill-info></aside>
                </div>
                <section class="player-skill-tree-editor" data-skill-editor hidden></section>
            `;

    const treeContainer = card.querySelector('[data-skill-tree]');
    const linesLayer = card.querySelector('[data-skill-tree-lines]');
    const infoPanel = card.querySelector('[data-skill-info]');
    const editorPanel = card.querySelector('[data-skill-editor]');
    const editToggle = card.querySelector('[data-skill-edit-toggle]');
    const treeTitleLabel = card.querySelector('[data-skill-tree-label]');
    const snapGuideX = card.querySelector('[data-skill-snap-x]');
    const snapGuideY = card.querySelector('[data-skill-snap-y]');
    if (!treeContainer || !linesLayer || !infoPanel) return card;

    const setDefaultInfo = () => {
        infoPanel.innerHTML = `
                    <div class="player-skill-info-empty">
                        <i class="fas fa-hand-pointer" aria-hidden="true"></i>
                        <p>Seleziona un nodo per vedere i dettagli dell'abilita.</p>
                    </div>
                `;
    };

    const updateInfo = (node) => {
        if (!node) {
            setDefaultInfo();
            return;
        }

        const icon = resolveSkillAssetPath(node.icon);
        const editable = editMode && canEditTree;
        infoPanel.innerHTML = `
                    <header class="player-skill-info-header">
                        ${icon ? `<img src="${icon}" alt="${escapeHtml(node.title || 'Abilita')}" class="player-skill-info-icon">` : ''}
                        <h4 class="player-skill-info-title" ${editable ? 'contenteditable="true" data-skill-preview-field="title" spellcheck="false"' : ''}>${escapeHtml(node.title || 'Abilita')}</h4>
                    </header>
                    <div class="player-skill-info-state is-${escapeHtml(node.state || 'locked')}">${escapeHtml(node.state === 'unlocked' ? 'Sbloccata' : node.state === 'unlockable' ? 'Disponibile' : 'Bloccata')}</div>
                    ${editable || node.flavor ? `<p class="player-skill-info-flavor" ${editable ? 'contenteditable="true" data-skill-preview-field="flavor" spellcheck="true"' : ''}>${escapeHtml(node.flavor || '')}</p>` : ''}
                    <div class="player-skill-info-desc ${editable ? 'is-editable' : ''}" ${editable ? 'contenteditable="true" data-skill-preview-field="desc" spellcheck="true"' : ''}>${node.desc || '<p>Nessun dettaglio disponibile.</p>'}</div>
                `;
    };

    const applyTreeBackground = () => {
        const bgImage = resolveSkillAssetPath(workingTree.bgImage);
        const bgOpacity = Number.isFinite(Number(workingTree.bgOpacity))
            ? Math.max(0, Math.min(1, Number(workingTree.bgOpacity)))
            : 1;
        treeContainer.style.setProperty('--skill-tree-bg-image', bgImage ? `url('${bgImage}')` : 'none');
        treeContainer.style.setProperty('--skill-tree-bg-opacity', String(bgOpacity));
        treeContainer.style.setProperty(
            '--skill-tree-bg-overlay',
            workingTree.bgOverlay || 'radial-gradient(circle at 50% 50%, rgba(56, 22, 22, 0.45), rgba(0, 0, 0, 0.92))'
        );
    };

    const recalculateNodes = () => {
        currentNodes = deriveSkillTreeNodes(workingTree, { unlocked: Array.from(unlockedIds) });
    };

    const persistUnlocks = async () => {
        await saveCharacterSkillTreeState(character, treeKey, Array.from(unlockedIds));
    };

    const deleteSelectedConnection = () => {
        if (!selectedConnection) return false;
        const source = workingTree.nodes.find((entry) => String(entry.id) === String(selectedConnection.source));
        if (!source) {
            selectedConnection = null;
            return false;
        }
        setSkillTreeConnections(
            source,
            getSkillTreeConnections(source).filter((connection) => connection.target !== String(selectedConnection.target))
        );
        selectedConnection = null;
        unlockedIds = pruneUnlockedSkillNodes(workingTree, unlockedIds);
        renderTree();
        renderEditor();
        return true;
    };

    const renderConnections = () => {
        linesLayer.replaceChildren();

        const nodeById = new Map(currentNodes.map((node) => [String(node.id), node]));
        currentNodes.forEach((startNode) => {
            getSkillTreeConnections(startNode).forEach((connection) => {
                const targetNode = nodeById.get(String(connection.target));
                if (!targetNode) return;

                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', `${Number(startNode.x) || 50}%`);
                line.setAttribute('y1', `${Number(startNode.y) || 50}%`);
                line.setAttribute('x2', `${Number(targetNode.x) || 50}%`);
                line.setAttribute('y2', `${Number(targetNode.y) || 50}%`);
                const isSelected = selectedConnection
                    && selectedConnection.source === String(startNode.id)
                    && selectedConnection.target === String(connection.target);
                line.setAttribute('class', `player-skill-connection is-${targetNode.state || 'locked'} is-${connection.mode || 'normal'}${isSelected ? ' is-selected' : ''}${editMode && canEditTree ? ' is-editable' : ''}`);
                line.dataset.source = String(startNode.id);
                line.dataset.target = String(connection.target);
                line.dataset.mode = connection.mode || 'normal';
                if (editMode && canEditTree) {
                    line.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectedConnection = {
                            source: String(startNode.id),
                            target: String(connection.target)
                        };
                        selectedNodeId = String(connection.target);
                        card.focus({ preventScroll: true });
                        updateInfo(targetNode);
                        renderConnections();
                        renderEditor();
                    });
                }
                linesLayer.appendChild(line);
            });
        });
    };

    const syncCurrentNodeSnapshot = () => {
        const byId = new Map(workingTree.nodes.map((node) => [String(node.id), node]));
        currentNodes = currentNodes.map((node) => {
            const source = byId.get(String(node.id));
            return source ? { ...node, x: source.x, y: source.y } : node;
        });
    };

    const hideSnapGuides = () => {
        if (snapGuideX) snapGuideX.hidden = true;
        if (snapGuideY) snapGuideY.hidden = true;
    };

    const getTreePointerPosition = (event) => {
        const rect = treeContainer.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
            y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
        };
    };

    const updateLinkPreview = (event) => {
        if (!linkDrag?.line) return;
        const point = getTreePointerPosition(event);
        linkDrag.line.setAttribute('x2', `${point.x}%`);
        linkDrag.line.setAttribute('y2', `${point.y}%`);
        const targetNodeElement = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.player-skill-node');
        const targetId = targetNodeElement?.dataset?.nodeId || '';
        treeContainer.querySelectorAll('.player-skill-node.is-link-target').forEach((entry) => {
            entry.classList.remove('is-link-target');
        });
        if (targetId && targetId !== linkDrag.sourceId) {
            targetNodeElement.classList.add('is-link-target');
        }
    };

    const clearLinkPreview = () => {
        linkDrag?.line?.remove();
        linkDrag = null;
        window.removeEventListener('pointermove', updateLinkPreview);
        window.removeEventListener('pointerup', finishLinkDrag);
        window.removeEventListener('pointercancel', cancelLinkDrag);
        treeContainer.classList.remove('is-linking-skill-tree');
        treeContainer.querySelectorAll('.player-skill-node.is-link-target').forEach((entry) => {
            entry.classList.remove('is-link-target');
        });
    };

    const finishLinkDrag = (event) => {
        if (!linkDrag || event.pointerId !== linkDrag.pointerId) return;
        event.preventDefault();
        const targetNodeElement = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.player-skill-node');
        const targetId = targetNodeElement?.dataset?.nodeId || '';
        const source = workingTree.nodes.find((entry) => String(entry.id) === linkDrag.sourceId);
        if (source && targetId && targetId !== linkDrag.sourceId) {
            const nextConnections = getSkillTreeConnections(source);
            if (!nextConnections.some((connection) => connection.target === String(targetId))) {
                setSkillTreeConnections(source, [...nextConnections, { target: String(targetId), mode: 'normal' }]);
                selectedNodeId = linkDrag.sourceId;
                selectedConnection = { source: linkDrag.sourceId, target: String(targetId) };
            }
        }
        clearLinkPreview();
        renderTree();
        renderEditor();
    };

    const cancelLinkDrag = (event) => {
        if (!linkDrag || (event?.pointerId !== undefined && event.pointerId !== linkDrag.pointerId)) return;
        clearLinkPreview();
        renderTree();
    };

    const startLinkDrag = (node, event) => {
        if (!editMode || !canEditTree) return;
        event.preventDefault();
        event.stopPropagation();
        const sourceId = String(node.id);
        selectedNodeId = sourceId;
        const startX = Number(node.x) || 50;
        const startY = Number(node.y) || 50;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', `${startX}%`);
        line.setAttribute('y1', `${startY}%`);
        line.setAttribute('x2', `${startX}%`);
        line.setAttribute('y2', `${startY}%`);
        line.setAttribute('class', 'player-skill-connection is-link-preview');
        linesLayer.appendChild(line);
        linkDrag = {
            sourceId,
            pointerId: event.pointerId,
            line
        };
        treeContainer.classList.add('is-linking-skill-tree');
        event.currentTarget.setPointerCapture?.(event.pointerId);
        window.addEventListener('pointermove', updateLinkPreview);
        window.addEventListener('pointerup', finishLinkDrag);
        window.addEventListener('pointercancel', cancelLinkDrag);
        updateInfo(node);
        updateLinkPreview(event);
    };

    const applySnapToPosition = (rawX, rawY, nodeId) => {
        let x = rawX;
        let y = rawY;
        let guideX = null;
        let guideY = null;

        if (snapToGrid && snapGridStep > 0) {
            x = Math.round(x / snapGridStep) * snapGridStep;
            y = Math.round(y / snapGridStep) * snapGridStep;
        }

        if (snapToNodes) {
            const otherNodes = (workingTree.nodes || []).filter((entry) => String(entry.id) !== String(nodeId));
            for (const other of otherNodes) {
                const otherX = Number(other.x);
                const otherY = Number(other.y);
                if (Number.isFinite(otherX) && Math.abs(otherX - x) <= snapThreshold) {
                    x = otherX;
                    guideX = otherX;
                }
                if (Number.isFinite(otherY) && Math.abs(otherY - y) <= snapThreshold) {
                    y = otherY;
                    guideY = otherY;
                }
            }
        }

        x = Math.round(Math.max(2, Math.min(98, x)));
        y = Math.round(Math.max(2, Math.min(98, y)));
        if (snapGuideX) {
            snapGuideX.style.left = `${guideX ?? x}%`;
            snapGuideX.hidden = guideX === null;
        }
        if (snapGuideY) {
            snapGuideY.style.top = `${guideY ?? y}%`;
            snapGuideY.hidden = guideY === null;
        }
        return { x, y };
    };

    const renderTree = () => {
        applyTreeBackground();
        recalculateNodes();
        renderConnections();
        treeContainer.querySelectorAll('.player-skill-node').forEach((node) => node.remove());

        currentNodes.forEach((node) => {
            const nodeElement = document.createElement('button');
            nodeElement.type = 'button';
            const stateClass = node.state === 'unlocked' || node.state === 'unlockable' ? node.state : 'locked';
            nodeElement.className = `player-skill-node is-${stateClass}${node.keyNode ? ' is-key' : ''}${String(node.id) === String(selectedNodeId) ? ' is-selected' : ''}`;
            nodeElement.style.left = `${Number(node.x) || 50}%`;
            nodeElement.style.top = `${Number(node.y) || 50}%`;
            const icon = resolveSkillAssetPath(node.icon);
            if (icon) nodeElement.style.backgroundImage = `url('${icon}')`;
            nodeElement.setAttribute('aria-label', node.title || 'Abilita');
            nodeElement.dataset.nodeId = String(node.id);
            if (canEditTree) {
                const linkAnchor = document.createElement('span');
                linkAnchor.className = 'player-skill-node-link-anchor';
                linkAnchor.setAttribute('title', 'Trascina per collegare');
                linkAnchor.setAttribute('aria-hidden', 'true');
                linkAnchor.innerHTML = '<i class="fas fa-link"></i>';
                linkAnchor.addEventListener('pointerdown', (event) => startLinkDrag(node, event));
                linkAnchor.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                });
                nodeElement.appendChild(linkAnchor);
            }

            const selectNode = () => {
                selectedNodeId = String(node.id);
                selectedConnection = null;
                updateInfo(node);
                if (editMode) renderEditor();
                renderTree();
            };

            nodeElement.addEventListener('mouseenter', () => updateInfo(node));
            nodeElement.addEventListener('focus', () => updateInfo(node));
            nodeElement.addEventListener('click', async () => {
                selectedNodeId = String(node.id);
                selectedConnection = null;
                updateInfo(node);
                if (!canEditUnlocks) {
                    renderTree();
                    return;
                }
                if (node.state !== 'unlocked' && (node.state === 'unlockable' || skillTreeCurrentUserIsDm)) {
                    getExclusiveSkillTreeSiblingIds(workingTree, node.id).forEach((siblingId) => unlockedIds.delete(String(siblingId)));
                    unlockedIds.add(String(node.id));
                    unlockedIds = pruneUnlockedSkillNodes(workingTree, unlockedIds);
                    await persistUnlocks().catch((error) => {
                        console.error('Salvataggio albero abilita fallito:', error);
                        alert('Impossibile salvare lo sblocco online.');
                    });
                    renderTree();
                } else {
                    renderTree();
                }
            });
            nodeElement.addEventListener('contextmenu', async (event) => {
                event.preventDefault();
                selectedNodeId = String(node.id);
                if (!canEditUnlocks) return;
                if (unlockedIds.has(String(node.id))) {
                    unlockedIds.delete(String(node.id));
                    unlockedIds = pruneUnlockedSkillNodes(workingTree, unlockedIds);
                    await persistUnlocks().catch((error) => {
                        console.error('Salvataggio albero abilita fallito:', error);
                        alert('Impossibile salvare lo stato online.');
                    });
                    renderTree();
                    updateInfo(currentNodes.find((entry) => String(entry.id) === String(selectedNodeId)));
                }
            });

            if (canEditTree) {
                let dragging = false;
                let dragPointerId = null;
                const moveNode = (event) => {
                    if (!dragging || !editMode || event.pointerId !== dragPointerId) return;
                    const rect = treeContainer.getBoundingClientRect();
                    const target = workingTree.nodes.find((entry) => String(entry.id) === String(node.id));
                    if (!target) return;
                    const rawX = Math.max(2, Math.min(98, ((event.clientX - rect.left) / rect.width) * 100));
                    const rawY = Math.max(2, Math.min(98, ((event.clientY - rect.top) / rect.height) * 100));
                    const snapped = applySnapToPosition(rawX, rawY, node.id);
                    target.x = snapped.x;
                    target.y = snapped.y;
                    nodeElement.style.left = `${target.x}%`;
                    nodeElement.style.top = `${target.y}%`;
                    syncCurrentNodeSnapshot();
                    renderConnections();
                };
                const finishDrag = (event) => {
                    if (!dragging || event.pointerId !== dragPointerId) return;
                    dragging = false;
                    dragPointerId = null;
                    nodeElement.classList.remove('is-dragging');
                    hideSnapGuides();
                    if (nodeElement.hasPointerCapture?.(event.pointerId)) {
                        nodeElement.releasePointerCapture(event.pointerId);
                    }
                    renderTree();
                    renderEditor();
                };
                nodeElement.addEventListener('pointerdown', (event) => {
                    if (!editMode || event.target.closest?.('.player-skill-node-link-anchor')) return;
                    event.preventDefault();
                    dragging = true;
                    dragPointerId = event.pointerId;
                    selectedNodeId = String(node.id);
                    nodeElement.classList.add('is-dragging');
                    nodeElement.setPointerCapture(event.pointerId);
                });
                nodeElement.addEventListener('pointermove', moveNode);
                nodeElement.addEventListener('pointerup', finishDrag);
                nodeElement.addEventListener('pointercancel', finishDrag);
                nodeElement.addEventListener('lostpointercapture', () => {
                    if (!dragging) return;
                    dragging = false;
                    dragPointerId = null;
                    nodeElement.classList.remove('is-dragging');
                    hideSnapGuides();
                    renderTree();
                    renderEditor();
                });
                nodeElement.addEventListener('dblclick', selectNode);
            }

            treeContainer.appendChild(nodeElement);
        });

        const selected = currentNodes.find((node) => String(node.id) === String(selectedNodeId)) || currentNodes[0];
        if (selected) updateInfo(selected);
    };

    const readEditorNode = () => workingTree.nodes.find((node) => String(node.id) === String(selectedNodeId)) || workingTree.nodes[0] || null;
    const uploadSkillTreeMedia = async (file, fileName, blobFactory) => {
        if (!file || !/^image\//i.test(file.type || '')) return null;
        const token = readSharedAuthToken();
        if (!token) {
            alert('Login richiesto per caricare immagini albero.');
            return null;
        }

        const folder = `skill-trees/${slugify(treeKey || character?.id || 'albero')}`;
        const safeFileName = `${slugify(fileName || 'immagine')}.webp`;
        const blob = await blobFactory(file);
        const form = new FormData();
        form.set('folder', folder);
        form.set('filename', safeFileName);
        form.set('campaignId', getCurrentCampaignId());
        form.set('file', new File([blob], safeFileName, { type: 'image/webp' }));

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
    };

    const uploadSelectedNodeIcon = async (file) => {
        const node = readEditorNode();
        if (!node || !file || !/^image\//i.test(file.type || '')) return;
        const path = await uploadSkillTreeMedia(
            file,
            `${slugify(node.id || node.title || 'nodo')}`,
            (entry) => resizeImageFileToSquareWebpBlobShared(entry, SKILL_TREE_ICON_SIZE, 0.86)
        );
        if (!path) return;
        node.icon = path;
        renderTree();
        renderEditor();
    };

    const uploadTreeBackground = async (file) => {
        if (!file || !/^image\//i.test(file.type || '')) return;
        const path = await uploadSkillTreeMedia(
            file,
            'sfondo',
            (entry) => resizeImageFileToWebpBlobShared(entry, 1600, 0.86)
        );
        if (!path) return;
        workingTree.bgImage = path;
        renderTree();
        renderEditor();
    };

    const saveTreeDefinition = async () => {
        const nextTrees = { ...(skillsMemoryCache || allSkillTrees || {}) };
        nextTrees[treeKey] = workingTree;
        await saveSkillTreesData(nextTrees);
        alert('Albero abilita salvato.');
    };

    const renderEditor = () => {
        if (!editorPanel || !canEditTree) return;
        const node = readEditorNode();
        editorPanel.hidden = !editMode;
        if (!editMode) return;
        const bgPath = workingTree.bgImage || '';
        const bgOpacityValue = Number.isFinite(Number(workingTree.bgOpacity))
            ? Math.max(0, Math.min(1, Number(workingTree.bgOpacity)))
            : 1;
        const selectedSourceNode = selectedConnection
            ? workingTree.nodes.find((entry) => String(entry.id) === String(selectedConnection.source))
            : null;
        const selectedTargetNode = selectedConnection
            ? workingTree.nodes.find((entry) => String(entry.id) === String(selectedConnection.target))
            : null;
        const selectedLink = selectedSourceNode
            ? getSkillTreeConnections(selectedSourceNode).find((connection) => connection.target === String(selectedConnection.target))
            : null;
        const selectedLinkHtml = selectedSourceNode && selectedTargetNode && selectedLink ? `
            <details class="player-skill-editor-section player-skill-link-editor" open>
                <summary>Collegamento selezionato</summary>
                <div class="player-skill-link-editor-grid">
                    <div>
                        <span>Origine</span>
                        <strong>${escapeHtml(selectedSourceNode.title || selectedSourceNode.id)}</strong>
                    </div>
                    <div>
                        <span>Destinazione</span>
                        <strong>${escapeHtml(selectedTargetNode.title || selectedTargetNode.id)}</strong>
                    </div>
                    <label>Tipo ramo
                        <select data-skill-link-field="mode">
                            <option value="normal" ${selectedLink.mode !== 'exclusive' ? 'selected' : ''}>Normale</option>
                            <option value="exclusive" ${selectedLink.mode === 'exclusive' ? 'selected' : ''}>Esclusivo</option>
                        </select>
                    </label>
                    <label>Prerequisiti destinazione
                        <select data-skill-link-field="targetRequiresMode">
                            <option value="all" ${getSkillTreeRequirementMode(selectedTargetNode) !== 'any' ? 'selected' : ''}>Tutti richiesti</option>
                            <option value="any" ${getSkillTreeRequirementMode(selectedTargetNode) === 'any' ? 'selected' : ''}>Uno qualsiasi</option>
                        </select>
                    </label>
                    <button type="button" class="player-skill-action-button is-danger" data-skill-action="delete-link"><i class="fas fa-unlink"></i> Rimuovi collegamento</button>
                </div>
            </details>
        ` : '';
        editorPanel.innerHTML = `
            <details class="player-skill-editor-section" open>
                <summary>Albero</summary>
                <div class="player-skill-editor-grid">
                    <label>Nome albero
                        <input type="text" data-skill-field="name" value="${escapeHtml(workingTree.name || workingTree.title || '')}" placeholder="Es. Cammino del Sangue">
                    </label>
                    <div class="player-skill-tree-bg-upload ${bgPath ? 'has-image' : ''}" data-skill-bg-drop tabindex="0">
                        <div>
                            <strong>Sfondo albero</strong>
                            <span>${bgPath ? escapeHtml(bgPath) : 'Trascina, incolla con CTRL+V o scegli un file.'}</span>
                        </div>
                        <button type="button" class="player-skill-action-button is-compact" data-skill-action="pick-bg-image"><i class="fas fa-upload"></i> Cambia</button>
                        <input type="file" accept="image/*" data-skill-bg-file hidden>
                    </div>
                    <label class="player-skill-opacity-control">Opacita sfondo
                        <input type="range" min="0" max="1" step="0.05" data-skill-field="bgOpacity" value="${escapeHtml(bgOpacityValue)}">
                        <output data-skill-bg-opacity>${Math.round(bgOpacityValue * 100)}%</output>
                    </label>
                </div>
            </details>
            <div class="player-skill-editor-tools">
                <label>
                    <input type="checkbox" data-skill-tool="snapGrid" ${snapToGrid ? 'checked' : ''}>
                    Snap griglia
                </label>
                <label>
                    <input type="checkbox" data-skill-tool="snapNodes" ${snapToNodes ? 'checked' : ''}>
                    Allinea ai nodi
                </label>
                <label>
                    Griglia %
                    <input type="number" min="1" max="25" step="1" data-skill-tool="gridStep" value="${escapeHtml(snapGridStep)}">
                </label>
            </div>
            ${selectedLinkHtml}
            <h4 class="player-skill-editor-subtitle">Nodo selezionato</h4>
            <div class="player-skill-editor-grid">
                <label>Nodo selezionato
                    <select data-skill-node-select>
                        ${workingTree.nodes.map((entry) => `<option value="${escapeHtml(entry.id)}" ${String(entry.id) === String(node?.id) ? 'selected' : ''}>${escapeHtml(entry.title || entry.id)}</option>`).join('')}
                    </select>
                </label>
                <label>ID nodo
                    <input type="text" data-node-field="id" value="${escapeHtml(node?.id || '')}">
                </label>
                <div class="player-skill-node-icon-upload ${node?.icon ? 'has-icon' : ''}" data-skill-node-icon-drop tabindex="0">
                    <div class="player-skill-node-icon-preview">
                        ${node?.icon ? `<img src="${escapeHtml(resolveSkillAssetPath(node.icon))}" alt="">` : '<i class="fas fa-image" aria-hidden="true"></i>'}
                    </div>
                    <div>
                        <strong>Icona nodo</strong>
                        <span>Trascina, incolla con CTRL+V o scegli un file.</span>
                        <button type="button" class="player-skill-action-button is-compact" data-skill-action="pick-node-icon"><i class="fas fa-upload"></i> File</button>
                    </div>
                    <input type="file" accept="image/*" data-skill-node-icon-file hidden>
                </div>
                <div class="player-skill-position-fields">
                    <span>Posizione</span>
                    <label>X %
                        <input type="number" min="0" max="100" step="1" data-node-field="x" value="${escapeHtml(Math.round(Number(node?.x ?? 50)))}">
                    </label>
                    <label>Y %
                        <input type="number" min="0" max="100" step="1" data-node-field="y" value="${escapeHtml(Math.round(Number(node?.y ?? 50)))}">
                    </label>
                </div>
                <label>Collega verso nodi
                    <input type="text" data-node-field="connections" value="${escapeHtml(getSkillTreeConnections(node || {}).map((connection) => connection.target).join(', '))}" placeholder="id-nodo-1, id-nodo-2">
                </label>
                <label>Requisiti
                    <input type="text" data-node-field="requires" value="${escapeHtml((node?.requires || getNodePrerequisites(node || {}, workingTree)).join(', '))}" placeholder="vuoto = genitori automatici">
                </label>
                <label>Regola prerequisiti
                    <select data-node-field="requiresMode">
                        <option value="all" ${getSkillTreeRequirementMode(node || {}) !== 'any' ? 'selected' : ''}>Tutti</option>
                        <option value="any" ${getSkillTreeRequirementMode(node || {}) === 'any' ? 'selected' : ''}>Uno qualsiasi</option>
                    </select>
                </label>
            </div>
            <div class="player-skill-editor-actions">
                <button type="button" class="player-skill-action-button" data-skill-action="add-node"><i class="fas fa-plus"></i> Nodo</button>
                <button type="button" class="player-skill-action-button is-danger" data-skill-action="delete-node"><i class="fas fa-trash"></i> Elimina</button>
                <button type="button" class="player-skill-action-button is-primary" data-skill-action="save-tree"><i class="fas fa-save"></i> Salva</button>
            </div>
        `;
    };

    editorPanel?.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.matches('[data-skill-node-select]')) {
            selectedNodeId = target.value;
            selectedConnection = null;
            renderEditor();
            renderTree();
            return;
        }
        const linkField = target.dataset.skillLinkField;
        if (linkField && selectedConnection) {
            const source = workingTree.nodes.find((entry) => String(entry.id) === String(selectedConnection.source));
            const targetNode = workingTree.nodes.find((entry) => String(entry.id) === String(selectedConnection.target));
            if (linkField === 'mode' && source) {
                const connections = getSkillTreeConnections(source).map((connection) => (
                    connection.target === String(selectedConnection.target)
                        ? { ...connection, mode: target.value === 'exclusive' ? 'exclusive' : 'normal' }
                        : connection
                ));
                setSkillTreeConnections(source, connections);
            }
            if (linkField === 'targetRequiresMode' && targetNode) {
                targetNode.requiresMode = target.value === 'any' ? 'any' : 'all';
            }
            unlockedIds = pruneUnlockedSkillNodes(workingTree, unlockedIds);
            renderTree();
            renderEditor();
            return;
        }
        const nodeField = target.dataset.nodeField;
        if (nodeField === 'requiresMode') {
            const node = readEditorNode();
            if (!node) return;
            node.requiresMode = target.value === 'any' ? 'any' : 'all';
            unlockedIds = pruneUnlockedSkillNodes(workingTree, unlockedIds);
            renderTree();
            renderEditor();
        }
    });

    editorPanel?.addEventListener('input', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
        const tool = target.dataset.skillTool;
        if (tool === 'snapGrid') {
            snapToGrid = target.checked;
            return;
        }
        if (tool === 'snapNodes') {
            snapToNodes = target.checked;
            hideSnapGuides();
            return;
        }
        if (tool === 'gridStep') {
            snapGridStep = Math.max(1, Math.min(25, Number(target.value) || 5));
            return;
        }
        const treeField = target.dataset.skillField;
        const nodeField = target.dataset.nodeField;
        if (treeField) {
            workingTree[treeField] = treeField === 'bgOpacity' ? Number(target.value) : target.value;
            if (treeField === 'name' && treeTitleLabel) {
                treeTitleLabel.textContent = target.value || treeKey;
            }
            if (treeField === 'bgOpacity') {
                const output = editorPanel?.querySelector('[data-skill-bg-opacity]');
                if (output) output.textContent = `${Math.round((Number(target.value) || 0) * 100)}%`;
            }
            renderTree();
            return;
        }
        if (nodeField) {
            const node = readEditorNode();
            if (!node) return;
            if (nodeField === 'id') {
                const oldId = String(node.id);
                const nextId = String(target.value || oldId).trim();
                if (!nextId) return;
                node.id = nextId;
                selectedNodeId = nextId;
                workingTree.nodes.forEach((entry) => {
                    if (Array.isArray(entry.connections)) {
                        setSkillTreeConnections(entry, getSkillTreeConnections(entry).map((connection) => ({
                            ...connection,
                            target: connection.target === oldId ? nextId : connection.target
                        })));
                    }
                    if (Array.isArray(entry.requires)) entry.requires = entry.requires.map((id) => String(id) === oldId ? nextId : id);
                });
            } else if (nodeField === 'connections' || nodeField === 'requires') {
                const values = target.value.split(',').map((entry) => entry.trim()).filter(Boolean);
                if (nodeField === 'connections') {
                    setSkillTreeConnections(node, values.map((entry) => ({ target: entry, mode: 'normal' })));
                } else {
                    node[nodeField] = values;
                }
            } else if (nodeField === 'x' || nodeField === 'y') {
                node[nodeField] = Math.round(Math.max(0, Math.min(100, Number(target.value) || 0)));
            } else {
                node[nodeField] = target.value;
            }
            renderTree();
        }
    });

    infoPanel.addEventListener('input', (event) => {
        const target = event.target;
        if (!editMode || !canEditTree || !(target instanceof HTMLElement)) return;
        const field = target.dataset.skillPreviewField;
        if (!field) return;
        const node = readEditorNode();
        if (!node) return;
        if (field === 'desc') {
            node.desc = normalizeSkillTreeEditableHtml(target);
        } else if (field === 'title' || field === 'flavor') {
            const value = target.innerText.trim();
            node[field] = value;
        }
    });

    infoPanel.addEventListener('blur', (event) => {
        if (!editMode || !canEditTree || !(event.target instanceof HTMLElement)) return;
        if (!event.target.dataset.skillPreviewField) return;
        renderTree();
        renderEditor();
    }, true);

    editorPanel?.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-skill-action]');
        if (!button) return;
        const action = button.dataset.skillAction;
        if (action === 'delete-link') {
            deleteSelectedConnection();
            return;
        }
        if (action === 'add-node') {
            const id = `node-${Date.now().toString(36)}`;
            workingTree.nodes.push({
                id,
                x: 50,
                y: 50,
                title: 'Nuova abilita',
                flavor: '',
                desc: '<p>Descrizione.</p>',
                icon: '',
                connections: []
            });
            selectedNodeId = id;
            renderTree();
            renderEditor();
        }
        if (action === 'delete-node') {
            const node = readEditorNode();
            if (!node || !confirm(`Eliminare il nodo "${node.title || node.id}"?`)) return;
            const id = String(node.id);
            workingTree.nodes = workingTree.nodes
                .filter((entry) => String(entry.id) !== id)
                .map((entry) => ({
                    ...entry,
                    connections: getSkillTreeConnections(entry).filter((connection) => connection.target !== id).map((connection) => (
                        connection.mode === 'exclusive' ? { target: connection.target, mode: 'exclusive' } : connection.target
                    )),
                    requires: (entry.requires || []).filter((targetId) => String(targetId) !== id)
                }));
            unlockedIds.delete(id);
            unlockedIds = pruneUnlockedSkillNodes(workingTree, unlockedIds);
            if (selectedConnection?.source === id || selectedConnection?.target === id) selectedConnection = null;
            selectedNodeId = workingTree.nodes[0]?.id || '';
            renderTree();
            renderEditor();
        }
        if (action === 'save-tree') {
            button.disabled = true;
            try {
                await saveTreeDefinition();
            } catch (error) {
                console.error('Salvataggio definizione albero fallito:', error);
                alert('Impossibile salvare la definizione dell albero.');
            } finally {
                button.disabled = false;
            }
        }
        if (action === 'pick-node-icon') {
            editorPanel.querySelector('[data-skill-node-icon-file]')?.click();
        }
        if (action === 'pick-bg-image') {
            editorPanel.querySelector('[data-skill-bg-file]')?.click();
        }
    });

    editorPanel?.addEventListener('change', async (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;
        if (!input.matches('[data-skill-node-icon-file], [data-skill-bg-file]')) return;
        const file = input.files?.[0];
        if (!file) return;
        input.disabled = true;
        try {
            if (input.matches('[data-skill-bg-file]')) {
                await uploadTreeBackground(file);
            } else {
                await uploadSelectedNodeIcon(file);
            }
        } catch (error) {
            console.error('Upload immagine albero fallito:', error);
            alert(`Upload immagine albero fallito: ${error?.message || error}`);
        } finally {
            input.value = '';
            input.disabled = false;
        }
    });

    editorPanel?.addEventListener('dragover', (event) => {
        const dropZone = event.target.closest('[data-skill-node-icon-drop], [data-skill-bg-drop]');
        if (!dropZone) return;
        event.preventDefault();
        dropZone.classList.add('is-drag-over');
    });

    editorPanel?.addEventListener('dragleave', (event) => {
        const dropZone = event.target.closest('[data-skill-node-icon-drop], [data-skill-bg-drop]');
        if (!dropZone) return;
        dropZone.classList.remove('is-drag-over');
    });

    editorPanel?.addEventListener('drop', async (event) => {
        const dropZone = event.target.closest('[data-skill-node-icon-drop], [data-skill-bg-drop]');
        if (!dropZone) return;
        event.preventDefault();
        dropZone.classList.remove('is-drag-over');
        const file = Array.from(event.dataTransfer?.files || []).find((entry) => /^image\//i.test(entry.type || ''));
        if (!file) return;
        dropZone.setAttribute('aria-busy', 'true');
        try {
            if (dropZone.matches('[data-skill-bg-drop]')) {
                await uploadTreeBackground(file);
            } else {
                await uploadSelectedNodeIcon(file);
            }
        } catch (error) {
            console.error('Upload immagine albero fallito:', error);
            alert(`Upload immagine albero fallito: ${error?.message || error}`);
        } finally {
            dropZone.removeAttribute('aria-busy');
        }
    });

    editorPanel?.addEventListener('paste', async (event) => {
        if (!editMode) return;
        const file = Array.from(event.clipboardData?.files || []).find((entry) => /^image\//i.test(entry.type || ''));
        if (!file) return;
        event.preventDefault();
        try {
            const bgDrop = event.target.closest?.('[data-skill-bg-drop]');
            if (bgDrop) {
                await uploadTreeBackground(file);
            } else {
                await uploadSelectedNodeIcon(file);
            }
        } catch (error) {
            console.error('Upload immagine albero fallito:', error);
            alert(`Upload immagine albero fallito: ${error?.message || error}`);
        }
    });

    treeContainer.addEventListener('pointermove', updateLinkPreview);
    treeContainer.addEventListener('pointerup', finishLinkDrag);
    treeContainer.addEventListener('pointercancel', cancelLinkDrag);
    treeContainer.addEventListener('mouseleave', cancelLinkDrag);

    card.addEventListener('keydown', (event) => {
        if (!editMode || !canEditTree || !selectedConnection) return;
        if (event.key !== 'Delete' && event.key !== 'Backspace') return;
        const target = event.target;
        if (target instanceof HTMLElement && (
            target.matches('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')
            || target.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')
        )) return;
        event.preventDefault();
        deleteSelectedConnection();
    });

    editToggle?.addEventListener('click', () => {
        editMode = !editMode;
        if (!editMode) clearLinkPreview();
        card.classList.toggle('is-editing-skill-tree', editMode);
        editToggle.classList.toggle('is-active', editMode);
        editToggle.innerHTML = editMode
            ? '<i class="fas fa-eye"></i>'
            : '<i class="fas fa-pen"></i>';
        editToggle.title = editMode ? 'Fine modifica' : 'Modifica albero';
        editToggle.setAttribute('aria-label', editToggle.title);
        renderEditor();
        renderTree();
    });

    setDefaultInfo();
    renderTree();

    return card;
}

function buildPlayerSkillTreeCards(characterOrId, allSkillTrees) {
    const character = typeof characterOrId === 'object' && characterOrId !== null ? characterOrId : { id: characterOrId };
    const entries = resolvePlayerSkillTreeEntries(character, allSkillTrees);
    if (!entries.length && !skillTreeCurrentUserIsDm) return null;

    const stack = document.createElement('div');
    stack.className = 'player-skill-tree-stack';
    let activeTreeIndex = 0;

    const toolbar = document.createElement('div');
    toolbar.className = 'player-skill-tree-stack-toolbar';
    toolbar.innerHTML = `
        <div class="player-skill-tree-nav-title">
            <span>Alberi abilita</span>
            <strong data-skill-tree-nav-label>${entries[0]?.tree?.name || entries[0]?.tree?.title || entries[0]?.key || 'Nessun albero'}</strong>
        </div>
        <div class="player-skill-tree-nav-controls">
            <button type="button" class="player-skill-tree-nav-button" data-skill-tree-prev aria-label="Albero precedente"><i class="fas fa-chevron-left"></i></button>
            <span data-skill-tree-nav-count>${entries.length ? `1 / ${entries.length}` : '0 / 0'}</span>
            <button type="button" class="player-skill-tree-nav-button" data-skill-tree-next aria-label="Albero successivo"><i class="fas fa-chevron-right"></i></button>
            ${skillTreeCurrentUserIsDm ? `
                <button type="button" class="player-skill-action-button is-primary is-compact" data-skill-create-tree>
                    <i class="fas fa-plus"></i> Nuovo albero
                </button>
            ` : ''}
        </div>
    `;
    stack.appendChild(toolbar);

    const viewport = document.createElement('div');
    viewport.className = 'player-skill-tree-stack-viewport';
    stack.appendChild(viewport);

    const cards = entries.map((entry) => {
        const card = buildPlayerSkillTreeCard(character, allSkillTrees, entry);
        if (!card) return null;
        card.dataset.skillTreeSlide = 'true';
        viewport.appendChild(card);
        return { entry, card };
    }).filter(Boolean);

    const navLabel = toolbar.querySelector('[data-skill-tree-nav-label]');
    const navCount = toolbar.querySelector('[data-skill-tree-nav-count]');
    const prevButton = toolbar.querySelector('[data-skill-tree-prev]');
    const nextButton = toolbar.querySelector('[data-skill-tree-next]');

    const renderActiveTree = () => {
        const total = cards.length;
        if (!total) {
            activeTreeIndex = 0;
            viewport.innerHTML = '<div class="player-skill-tree-empty">Nessun albero abilita configurato.</div>';
        } else {
            activeTreeIndex = Math.max(0, Math.min(total - 1, activeTreeIndex));
            cards.forEach((item, index) => {
                item.card.hidden = index !== activeTreeIndex;
            });
        }
        const active = cards[activeTreeIndex];
        if (navLabel) navLabel.textContent = active
            ? (active.entry.tree?.name || active.entry.tree?.title || active.entry.key || 'Albero abilita')
            : 'Nessun albero';
        if (navCount) navCount.textContent = total ? `${activeTreeIndex + 1} / ${total}` : '0 / 0';
        if (prevButton) prevButton.disabled = total <= 1;
        if (nextButton) nextButton.disabled = total <= 1;
        toolbar.hidden = total <= 1 && !skillTreeCurrentUserIsDm;
    };

    prevButton?.addEventListener('click', () => {
        if (cards.length <= 1) return;
        activeTreeIndex = (activeTreeIndex - 1 + cards.length) % cards.length;
        renderActiveTree();
    });

    nextButton?.addEventListener('click', () => {
        if (cards.length <= 1) return;
        activeTreeIndex = (activeTreeIndex + 1) % cards.length;
        renderActiveTree();
    });

    if (skillTreeCurrentUserIsDm) {
        toolbar.querySelector('[data-skill-create-tree]')?.addEventListener('click', async () => {
            const name = window.prompt('Nome nuovo albero abilita', 'Nuovo albero');
            if (name === null) return;
            const baseKey = slugify(character.id || character.accountId || character.name || 'personaggio');
            const key = `${baseKey}-${Date.now().toString(36)}`;
            const nextTrees = { ...(skillsMemoryCache || allSkillTrees || {}) };
            nextTrees[key] = {
                id: key,
                name: name.trim() || 'Nuovo albero',
                ownerCharacterId: character.id || '',
                characterId: character.id || '',
                bgImage: '',
                bgOpacity: 1,
                nodes: [{
                    id: 'inizio',
                    x: 50,
                    y: 50,
                    title: 'Inizio',
                    flavor: '',
                    desc: '<p>Prima abilita dell albero.</p>',
                    icon: '',
                    connections: [],
                    state: 'unlocked'
                }]
            };
            try {
                await saveSkillTreesData(nextTrees);
                window.location.reload();
            } catch (error) {
                console.error('Creazione albero abilita fallita:', error);
                alert(`Creazione albero fallita: ${error?.message || error}`);
            }
        });
    }

    renderActiveTree();

    return cards.length || skillTreeCurrentUserIsDm ? stack : null;
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
    let currentUserIsDm = false;
    let currentAuthState = null;
    let currentTransformations = [];
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
    container.addEventListener('click', handleMediaOverrideClick);
    container.addEventListener('click', handleTransformationClick);

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
                await loadSkillTreeStates();
            } catch (skillError) {
                console.warn('Impossibile caricare gli alberi abilita:', skillError);
            }
        }

        currentAuthState = await window.CriptaDiscordAuth?.verify?.().catch(() => null);
        currentUserIsDm = await resolveCurrentUserIsDm(currentAuthState);
        skillTreeAuthState = currentAuthState;
        skillTreeCurrentUserIsDm = currentUserIsDm;
        if (charType === 'player') {
            currentTransformations = await loadTransformationsData().catch((error) => {
                console.warn('Impossibile caricare trasformazioni token:', error);
                return [];
            });
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
            .map((block, index) => ({
                id: slugify(block.id || block.title || `blocco-${index + 1}`),
                type: block.type === 'image_box' || block.type === 'image' || block.image ? 'image' : 'text',
                title: block.title || 'Informazioni',
                icon: block.icon || 'fa-book-open',
                image: block.image || '',
                hidden: Boolean(block.hidden),
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
        if (action === 'toggle-hidden') {
            if (!Number.isInteger(blockIndex) || !inlineEditBlocks[blockIndex]) return;
            inlineEditBlocks[blockIndex].hidden = !inlineEditBlocks[blockIndex].hidden;
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

    async function handleMediaOverrideClick(event) {
        const button = event.target.closest('[data-media-override-action="upload"]');
        if (!button) return;
        event.preventDefault();
        if (!canEditCurrentPlayerTransformations(currentCharacter)) {
            alert('Non hai permessi per modificare le immagini di questo personaggio.');
            return;
        }
        const entityType = button.dataset.mediaEntityType || 'player';
        const entityId = button.dataset.mediaIdentity || currentCharacter?.id || charId;
        const kind = button.dataset.mediaKind || 'avatar';
        const file = await pickInlineImageFile();
        if (!file) return;

        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        try {
            const identity = {
                id: getMediaOverrideId(entityType, entityId),
                key: getMediaOverrideId(entityType, entityId),
                entityType,
                entityId,
                characterId: currentCharacter?.id || '',
                ownerCharacterId: currentCharacter?.id || '',
                ownerAccountId: currentCharacter?.accountId || '',
                name: button.dataset.mediaName || currentCharacter?.name || '',
                foundryName: button.dataset.mediaFoundryName || '',
                actorId: button.dataset.mediaActorId || ''
            };
            const imagePath = await uploadMediaOverrideImageFile(file, identity, kind);
            if (!imagePath) return;
            await saveMediaOverride(identity, kind, imagePath);
            applySavedMediaOverrideLocally(identity, kind, imagePath);
            if (entityType === 'companion') {
                await hydratePlayerLoadout(currentCharacter);
            } else {
                renderCharacterPage(currentCharacter, currentAllCharacters, currentNpcQuests, currentPlayerSkillTrees);
            }
        } catch (error) {
            console.error('Salvataggio immagine personaggio fallito:', error);
            alert(`Salvataggio immagine fallito: ${error?.message || error}`);
        } finally {
            button.disabled = false;
            button.removeAttribute('aria-busy');
        }
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

    async function resizeImageFileToSquareWebpBlob(file, size = CHARACTER_MEDIA_SIZE) {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d', { alpha: true });
        context.clearRect(0, 0, size, size);
        const scale = Math.max(size / bitmap.width, size / bitmap.height);
        const width = bitmap.width * scale;
        const height = bitmap.height * scale;
        context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
        bitmap.close?.();

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Il browser non ha prodotto un file WebP.'));
                    return;
                }
                resolve(blob);
            }, 'image/webp', 0.86);
        });
    }

    async function convertImageFileToOriginalSizeWebpBlob(file) {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { alpha: true });
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0);
        bitmap.close?.();

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Il browser non ha prodotto un file WebP.'));
                    return;
                }
                resolve(blob);
            }, 'image/webp', 0.92);
        });
    }

    function loadImageElementFromFile(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => resolve({ image, url });
            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Impossibile leggere l\'immagine selezionata.'));
            };
            image.src = url;
        });
    }

    function clampAbilityIconOffset(state) {
        const drawWidth = state.imageWidth * state.baseScale * state.zoom;
        const drawHeight = state.imageHeight * state.baseScale * state.zoom;
        const maxX = Math.max(0, (drawWidth - ABILITY_ICON_SIZE) / 2);
        const maxY = Math.max(0, (drawHeight - ABILITY_ICON_SIZE) / 2);
        state.offsetX = Math.max(-maxX, Math.min(maxX, state.offsetX));
        state.offsetY = Math.max(-maxY, Math.min(maxY, state.offsetY));
    }

    function renderAbilityIconCropPreview(state, imageEl, zoomInput) {
        clampAbilityIconOffset(state);
        const drawWidth = state.imageWidth * state.baseScale * state.zoom;
        const drawHeight = state.imageHeight * state.baseScale * state.zoom;
        imageEl.style.width = `${drawWidth}px`;
        imageEl.style.height = `${drawHeight}px`;
        imageEl.style.left = `${ABILITY_ICON_SIZE / 2 + state.offsetX}px`;
        imageEl.style.top = `${ABILITY_ICON_SIZE / 2 + state.offsetY}px`;
        if (zoomInput && Number(zoomInput.value) !== state.zoom) {
            zoomInput.value = String(state.zoom);
        }
    }

    function renderAbilityIconCropToBlob(image, state) {
        const canvas = document.createElement('canvas');
        canvas.width = ABILITY_ICON_SIZE;
        canvas.height = ABILITY_ICON_SIZE;
        const context = canvas.getContext('2d', { alpha: true });
        context.clearRect(0, 0, ABILITY_ICON_SIZE, ABILITY_ICON_SIZE);
        const drawWidth = state.imageWidth * state.baseScale * state.zoom;
        const drawHeight = state.imageHeight * state.baseScale * state.zoom;
        const x = (ABILITY_ICON_SIZE - drawWidth) / 2 + state.offsetX;
        const y = (ABILITY_ICON_SIZE - drawHeight) / 2 + state.offsetY;
        context.drawImage(image, x, y, drawWidth, drawHeight);

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Il browser non ha prodotto un file WebP.'));
                    return;
                }
                resolve(blob);
            }, 'image/webp', 0.86);
        });
    }

    async function cropAbilityIconFileToWebpBlob(file) {
        const { image, url } = await loadImageElementFromFile(file);
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'ability-icon-crop-modal';
            modal.innerHTML = `
                        <div class="ability-icon-crop-card" role="dialog" aria-modal="true" aria-label="Centra icona abilita">
                            <header class="ability-icon-crop-header">
                                <div>
                                    <h3>Centra icona abilita</h3>
                                    <p>Trascina l'immagine e usa lo zoom. Salvataggio finale: ${ABILITY_ICON_SIZE}x${ABILITY_ICON_SIZE} WebP.</p>
                                </div>
                                <button type="button" class="ability-icon-crop-close" data-crop-action="cancel" aria-label="Chiudi">
                                    <i class="fas fa-xmark" aria-hidden="true"></i>
                                </button>
                            </header>
                            <div class="ability-icon-crop-stage" data-crop-stage>
                                <img src="${escapeHtml(url)}" alt="Anteprima icona" draggable="false">
                            </div>
                            <label class="ability-icon-crop-zoom">
                                <span>Zoom</span>
                                <input type="range" min="1" max="4" step="0.01" value="1" data-crop-zoom>
                            </label>
                            <footer class="ability-icon-crop-actions">
                                <button type="button" class="button-gold-outline" data-crop-action="reset">Centra</button>
                                <button type="button" class="button-gold-outline" data-crop-action="cancel">Annulla</button>
                                <button type="button" class="button-gold" data-crop-action="save">Usa icona</button>
                            </footer>
                        </div>
                    `;

            const stage = modal.querySelector('[data-crop-stage]');
            const preview = modal.querySelector('img');
            const zoomInput = modal.querySelector('[data-crop-zoom]');
            const state = {
                imageWidth: image.naturalWidth || image.width,
                imageHeight: image.naturalHeight || image.height,
                baseScale: Math.max(ABILITY_ICON_SIZE / (image.naturalWidth || image.width), ABILITY_ICON_SIZE / (image.naturalHeight || image.height)),
                zoom: 1,
                offsetX: 0,
                offsetY: 0
            };
            let pointerState = null;
            let done = false;

            const cleanup = (result) => {
                if (done) return;
                done = true;
                URL.revokeObjectURL(url);
                modal.remove();
                resolve(result);
            };

            const updatePreview = () => renderAbilityIconCropPreview(state, preview, zoomInput);
            document.body.appendChild(modal);
            updatePreview();

            zoomInput.addEventListener('input', () => {
                state.zoom = Number(zoomInput.value) || 1;
                updatePreview();
            });

            stage.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                stage.setPointerCapture?.(event.pointerId);
                pointerState = {
                    id: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    offsetX: state.offsetX,
                    offsetY: state.offsetY
                };
                stage.classList.add('is-dragging');
            });

            stage.addEventListener('pointermove', (event) => {
                if (!pointerState || pointerState.id !== event.pointerId) return;
                state.offsetX = pointerState.offsetX + (event.clientX - pointerState.startX);
                state.offsetY = pointerState.offsetY + (event.clientY - pointerState.startY);
                updatePreview();
            });

            const stopDrag = (event) => {
                if (pointerState?.id === event.pointerId) {
                    pointerState = null;
                    stage.classList.remove('is-dragging');
                }
            };
            stage.addEventListener('pointerup', stopDrag);
            stage.addEventListener('pointercancel', stopDrag);

            stage.addEventListener('wheel', (event) => {
                event.preventDefault();
                const delta = event.deltaY > 0 ? -0.08 : 0.08;
                state.zoom = Math.max(1, Math.min(4, state.zoom + delta));
                updatePreview();
            }, { passive: false });

            modal.addEventListener('click', async (event) => {
                const action = event.target.closest('[data-crop-action]')?.dataset.cropAction;
                if (!action) return;
                if (action === 'cancel') {
                    cleanup(null);
                    return;
                }
                if (action === 'reset') {
                    state.zoom = 1;
                    state.offsetX = 0;
                    state.offsetY = 0;
                    updatePreview();
                    return;
                }
                if (action === 'save') {
                    try {
                        const blob = await renderAbilityIconCropToBlob(image, state);
                        cleanup(blob);
                    } catch (error) {
                        console.error('Crop icona abilita fallito:', error);
                        alert(`Crop icona fallito: ${error?.message || error}`);
                    }
                }
            });
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

    async function loadAbilityOverridesDocumentForSave() {
        const response = await fetch(getAbilityOverridesApiUrl());
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
        return payload || { data: [], version: 0, source: 'static' };
    }

    function upsertAbilityOverrideRecord(records, identity, patch) {
        const existing = (Array.isArray(records) ? records : []).find((record) => (
            record && typeof record === 'object' && (record.key === identity.key || record.id === identity.key)
        )) || {};
        const nextRecord = {
            ...existing,
            id: identity.key,
            key: identity.key,
            characterId: identity.characterId,
            characterName: identity.characterName,
            actorId: identity.actorId,
            actorName: identity.actorName,
            abilityId: identity.abilityId,
            abilityName: identity.abilityName,
            ...patch,
            updatedAt: new Date().toISOString()
        };
        const nextData = (Array.isArray(records) ? records : []).filter((record) => (
            record && typeof record === 'object' && record.key !== identity.key && record.id !== identity.key
        ));
        nextData.push(nextRecord);
        nextData.sort((left, right) => String(left.abilityName || '').localeCompare(String(right.abilityName || ''), 'it'));
        return nextData;
    }

    async function saveAbilityOverride(identity, patch) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per salvare icone abilità.');
            return false;
        }

        const loaded = await loadAbilityOverridesDocumentForSave();
        const nextData = upsertAbilityOverrideRecord(loaded.data, identity, patch);
        const response = await fetch(getAbilityOverridesApiUrl(), {
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
        abilityOverridesMemoryCache = nextData;
        return true;
    }

    async function loadItemOverridesDocumentForSave() {
        const response = await fetch(getItemOverridesApiUrl());
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
        return payload || { data: [], version: 0, source: 'static' };
    }

    function upsertItemOverrideRecord(records, identity, patch) {
        const existing = (Array.isArray(records) ? records : []).find((record) => (
            record
            && typeof record === 'object'
            && (
                record.key === identity.key
                || record.id === identity.key
                || (
                    (record.actorId && identity.actorId && record.actorId === identity.actorId)
                    && (record.itemId && identity.itemId && record.itemId === identity.itemId)
                )
                || (
                    normalizeText(record.actorName) === normalizeText(identity.actorName)
                    && normalizeText(record.itemName) === normalizeText(identity.itemName)
                )
            )
        )) || {};
        const nextRecord = {
            ...existing,
            id: identity.key,
            key: identity.key,
            characterId: identity.characterId,
            characterName: identity.characterName,
            actorId: identity.actorId,
            actorName: identity.actorName,
            itemId: identity.itemId,
            itemName: identity.itemName,
            itemType: identity.itemType,
            ...patch,
            updatedAt: new Date().toISOString()
        };
        const nextData = (Array.isArray(records) ? records : []).filter((record) => (
            record
            && typeof record === 'object'
            && record.key !== identity.key
            && record.id !== identity.key
            && !(
                (record.actorId && identity.actorId && record.actorId === identity.actorId)
                && (record.itemId && identity.itemId && record.itemId === identity.itemId)
            )
            && !(
                normalizeText(record.actorName) === normalizeText(identity.actorName)
                && normalizeText(record.itemName) === normalizeText(identity.itemName)
            )
        ));
        nextData.push(nextRecord);
        nextData.sort((left, right) => {
            const actorSort = String(left.actorName || left.characterName || '').localeCompare(String(right.actorName || right.characterName || ''), 'it');
            if (actorSort !== 0) return actorSort;
            return String(left.itemName || '').localeCompare(String(right.itemName || ''), 'it');
        });
        return nextData;
    }

    async function saveItemOverride(identity, patch) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per salvare override inventario.');
            return false;
        }

        const loaded = await loadItemOverridesDocumentForSave();
        const nextData = upsertItemOverrideRecord(loaded.data, identity, patch);
        const response = await fetch(getItemOverridesApiUrl(), {
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
        itemOverridesMemoryCache = nextData;
        return true;
    }

    async function uploadAbilityOverrideFile(blob, identity) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per caricare icone abilità.');
            return '';
        }

        const folder = `ability-overrides/${slugify(identity.characterId || identity.actorName || identity.characterName || 'personaggio')}`;
        const fileName = `${slugify(identity.abilityName || identity.abilityId || 'abilita')}.webp`;
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
    }

    async function uploadItemOverrideFile(blob, identity) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per caricare icone inventario.');
            return '';
        }

        const folder = `item-overrides/${slugify(identity.characterId || identity.actorName || identity.characterName || 'personaggio')}`;
        const fileName = `${slugify(identity.itemName || identity.itemId || 'oggetto')}.webp`;
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
    }

    function getMediaOverridesApiUrl() {
        return window.CriptaApp?.urls?.api?.('api/data/media-overrides') || 'https://sigillo-api.khuzoe.workers.dev/api/data/media-overrides';
    }

    async function loadMediaOverridesDocumentForSave() {
        const response = await fetch(getMediaOverridesApiUrl());
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
        return payload || { data: [], version: 0, source: 'static' };
    }

    function upsertMediaOverrideRecord(records, identity, kind, imagePath) {
        const key = identity.key || identity.id || getMediaOverrideId(identity.entityType, identity.entityId);
        const existing = (Array.isArray(records) ? records : []).find((record) => (
            record && typeof record === 'object' && (record.key === key || record.id === key)
        )) || findMediaOverride(records, identity.entityType, identity.entityId, identity) || {};
        const nextRecord = {
            ...existing,
            ...identity,
            id: key,
            key,
            images: {
                ...(existing.images || {}),
                [kind]: imagePath,
                ...(kind === 'avatar' ? { portrait: imagePath } : {})
            },
            updatedAt: new Date().toISOString()
        };
        const nextData = (Array.isArray(records) ? records : []).filter((record) => (
            record
            && typeof record === 'object'
            && record !== existing
            && record.key !== key
            && record.id !== key
        ));
        nextData.push(nextRecord);
        nextData.sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'it'));
        return nextData;
    }

    async function saveMediaOverride(identity, kind, imagePath) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per salvare immagini personaggio.');
            return false;
        }
        const loaded = await loadMediaOverridesDocumentForSave();
        const nextData = upsertMediaOverrideRecord(loaded.data, identity, kind, imagePath);
        const response = await fetch(getMediaOverridesApiUrl(), {
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
        mediaOverridesMemoryCache = nextData;
        return true;
    }

    async function uploadMediaOverrideImageFile(file, identity, kind) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per caricare immagini.');
            return '';
        }
        const blob = kind === 'token'
            ? await resizeImageFileToSquareWebpBlob(file, CHARACTER_MEDIA_SIZE)
            : await convertImageFileToOriginalSizeWebpBlob(file);
        const entityType = identity.entityType === 'companion' ? 'companion' : 'player';
        const folder = entityType === 'companion'
            ? `companions/${slugify(identity.ownerCharacterId || identity.characterId || identity.entityId || 'companion')}`
            : 'players';
        const fileName = entityType === 'companion'
            ? `${slugify(identity.entityId || identity.name || 'companion')}-${kind}.webp`
            : `${slugify(identity.entityId || identity.characterId || 'player')}-${kind}-override.webp`;
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
    }

    function applySavedMediaOverrideLocally(identity, kind, imagePath) {
        if (identity.entityType !== 'player' || !currentCharacter) return;
        currentCharacter.images = currentCharacter.images || {};
        currentCharacter.images[kind] = imagePath;
        if (kind === 'avatar') {
            currentCharacter.images.portrait = imagePath;
            if (!currentCharacter.images.hover) currentCharacter.images.hover = imagePath;
        }
        const index = currentAllCharacters.findIndex((entry) => String(entry.id || '') === String(currentCharacter.id || ''));
        if (index >= 0) currentAllCharacters[index] = currentCharacter;
    }

    function initializeAbilityOverrideUploads(cardElement, character) {
        const getIdentityFromButton = (button) => ({
            key: button.dataset.abilityKey || '',
            characterId: button.dataset.characterId || '',
            characterName: button.dataset.characterName || '',
            actorId: button.dataset.actorId || '',
            actorName: button.dataset.actorName || '',
            abilityId: button.dataset.abilityId || '',
            abilityName: button.dataset.abilityName || ''
        });

        const iconButtons = Array.from(cardElement.querySelectorAll('[data-ability-icon-upload]'));
        iconButtons.forEach((button) => {
            button.addEventListener('click', async () => {
                const identity = getIdentityFromButton(button);
                if (!identity.key) return;

                const file = await pickInlineImageFile();
                if (!file) return;
                let iconBlob = null;
                try {
                    iconBlob = await cropAbilityIconFileToWebpBlob(file);
                } catch (error) {
                    console.error('Preparazione icona abilita fallita:', error);
                    alert(`Preparazione icona fallita: ${error?.message || error}`);
                    return;
                }
                if (!iconBlob) return;

                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    const imagePath = await uploadAbilityOverrideFile(iconBlob, identity);
                    if (!imagePath) return;
                    await saveAbilityOverride(identity, { image: imagePath });
                    await hydratePlayerLoadout(character);
                } catch (error) {
                    console.error('Salvataggio icona abilità fallito:', error);
                    alert(`Salvataggio icona abilità fallito: ${error?.message || error}`);
                } finally {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            });
        });

        const descriptionButtons = Array.from(cardElement.querySelectorAll('[data-ability-description-edit]'));
        descriptionButtons.forEach((button) => {
            button.addEventListener('click', async () => {
                const identity = getIdentityFromButton(button);
                if (!identity.key) return;

                const currentText = button
                    .closest('.loadout-entry')
                    ?.querySelector('.loadout-entry-description')
                    ?.innerText
                    ?.trim() || '';
                const nextDescription = window.prompt(`Descrizione per ${identity.abilityName || 'abilità'}`, currentText);
                if (nextDescription === null) return;

                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    await saveAbilityOverride(identity, { description: nextDescription.trim() });
                    await hydratePlayerLoadout(character);
                } catch (error) {
                    console.error('Salvataggio testo abilità fallito:', error);
                    alert(`Salvataggio testo abilità fallito: ${error?.message || error}`);
                } finally {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            });
        });
    }

    function initializeItemOverrideUploads(cardElement, character) {
        const getIdentityFromButton = (button) => ({
            key: button.dataset.itemKey || '',
            characterId: button.dataset.characterId || '',
            characterName: button.dataset.characterName || '',
            actorId: button.dataset.actorId || '',
            actorName: button.dataset.actorName || '',
            itemId: button.dataset.itemId || '',
            itemName: button.dataset.itemName || '',
            itemType: button.dataset.itemType || ''
        });

        const iconButtons = Array.from(cardElement.querySelectorAll('[data-item-icon-upload]'));
        iconButtons.forEach((button) => {
            button.addEventListener('click', async () => {
                const identity = getIdentityFromButton(button);
                if (!identity.key) return;

                const file = await pickInlineImageFile();
                if (!file) return;
                let iconBlob = null;
                try {
                    iconBlob = await cropAbilityIconFileToWebpBlob(file);
                } catch (error) {
                    console.error('Preparazione icona inventario fallita:', error);
                    alert(`Preparazione icona fallita: ${error?.message || error}`);
                    return;
                }
                if (!iconBlob) return;

                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    const imagePath = await uploadItemOverrideFile(iconBlob, identity);
                    if (!imagePath) return;
                    await saveItemOverride(identity, { image: imagePath, imageSource: 'site' });
                    await hydratePlayerLoadout(character);
                } catch (error) {
                    console.error('Salvataggio icona inventario fallito:', error);
                    alert(`Salvataggio icona inventario fallito: ${error?.message || error}`);
                } finally {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            });
        });

        const descriptionButtons = Array.from(cardElement.querySelectorAll('[data-item-description-edit]'));
        descriptionButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const identity = getIdentityFromButton(button);
                if (!identity.key) return;

                const entry = button.closest('.loadout-entry');
                const editor = entry?.querySelector('[data-item-description-editor]');
                const textarea = editor?.querySelector('[data-item-description-text]');
                if (!editor || !textarea) return;
                textarea.value = button.dataset.currentDescription || textarea.value || '';
                editor.hidden = false;
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            });
        });

        const cancelButtons = Array.from(cardElement.querySelectorAll('[data-item-description-cancel]'));
        cancelButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const editor = button.closest('[data-item-description-editor]');
                const entry = button.closest('.loadout-entry');
                const editButton = entry?.querySelector('[data-item-description-edit]');
                const textarea = editor?.querySelector('[data-item-description-text]');
                if (textarea && editButton) textarea.value = editButton.dataset.currentDescription || '';
                if (editor) editor.hidden = true;
            });
        });

        const saveButtons = Array.from(cardElement.querySelectorAll('[data-item-description-save]'));
        saveButtons.forEach((button) => {
            button.addEventListener('click', async () => {
                const entry = button.closest('.loadout-entry');
                const editButton = entry?.querySelector('[data-item-description-edit]');
                const editor = button.closest('[data-item-description-editor]');
                const textarea = editor?.querySelector('[data-item-description-text]');
                if (!editButton || !textarea) return;
                const identity = getIdentityFromButton(editButton);
                if (!identity.key) return;

                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    await saveItemOverride(identity, { description: textarea.value.trim() });
                    await hydratePlayerLoadout(character);
                } catch (error) {
                    console.error('Salvataggio testo inventario fallito:', error);
                    alert(`Salvataggio testo inventario fallito: ${error?.message || error}`);
                } finally {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            });
        });
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
            hidden: Boolean(block.hidden),
            text: block.text || ''
        }));
        return serialized;
    }

    function getCharactersApiUrl() {
        return window.CriptaApp?.urls?.api?.('api/data/characters') || 'https://sigillo-api.khuzoe.workers.dev/api/data/characters';
    }

    function getTransformationsApiUrl() {
        return window.CriptaApp?.urls?.api?.('api/data/transformations') || 'https://sigillo-api.khuzoe.workers.dev/api/data/transformations';
    }

    function getAbilityOverridesApiUrl() {
        return window.CriptaApp?.urls?.api?.('api/data/ability-overrides') || 'https://sigillo-api.khuzoe.workers.dev/api/data/ability-overrides';
    }

    function getItemOverridesApiUrl() {
        return window.CriptaApp?.urls?.api?.('api/data/item-overrides') || 'https://sigillo-api.khuzoe.workers.dev/api/data/item-overrides';
    }

    function getCurrentCampaignId() {
        return window.CriptaApp?.campaigns?.currentId?.() || params.get('campaign') || 'cripta-di-sangue';
    }

    async function resolveCurrentUserIsDm(authState = null) {
        try {
            authState = authState || await window.CriptaDiscordAuth?.verify?.();
            const user = authState?.user || {};
            const accountId = String(user.accountId || user.id || user.sub || '').trim();
            const explicitDiscordId = String(user.discordId || '').trim();
            const legacyId = String(user.id || user.sub || '').trim();
            const discordId = explicitDiscordId || (/^\d{5,32}$/.test(legacyId) ? legacyId : '');
            if (!accountId && !discordId) return false;

            const response = await fetch(dataUrl('next-session.json')).catch(() => null);
            if (!response?.ok) return false;
            const config = await response.json();
            const dmAccountId = String(config?.dmAccountId || '').trim();
            const dmDiscordId = String(config?.dmDiscordId || '').trim();
            return Boolean(dmAccountId && accountId === dmAccountId)
                || Boolean(dmDiscordId && discordId === dmDiscordId);
        } catch (_) {
            return false;
        }
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
        const companionsCard = document.getElementById('player-companions-card');
        if (!loadoutCard) return;

        try {
            const [inventoryPayload, wikiItems, abilityOverrides, itemOverrides, mediaOverrides] = await Promise.all([
                loadInventoryData(),
                loadWikiItemsData().catch((error) => {
                    console.warn('Impossibile caricare items.json per collegare gli oggetti:', error);
                    return [];
                }),
                loadAbilityOverrides(),
                loadItemOverrides(),
                loadMediaOverrides()
            ]);
            loadoutCard.innerHTML = buildPlayerLoadoutHtml(character, inventoryPayload, wikiItems, abilityOverrides, itemOverrides);
            initializeLoadoutTabs(loadoutCard);
            initializeItemOverrideUploads(loadoutCard, character);
            initializeAbilityOverrideUploads(loadoutCard, character);
            if (companionsCard) {
                const companionsHtml = buildCompanionsHtml(character, inventoryPayload, wikiItems, mediaOverrides, {
                    canEdit: canEditCurrentPlayerTransformations(character)
                });
                companionsCard.hidden = !companionsHtml;
                companionsCard.innerHTML = companionsHtml;
            }
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
            if (companionsCard) {
                companionsCard.hidden = true;
                companionsCard.innerHTML = '';
            }
            renderPlayerXpSidebarError("Impossibile sincronizzare l'XP dal server.");
        }
    }

    function buildPlayerTransformationsCard(character) {
        const card = document.createElement('div');
        card.className = 'content-card player-transformations-card';
        card.id = 'player-transformations-card';
        card.innerHTML = renderPlayerTransformationsHtml(character);
        return card;
    }

    function getCharacterTransformations(character) {
        const characterId = String(character?.id || '').trim();
        const accountId = String(character?.accountId || '').trim();
        const staticEntries = Array.isArray(character?.transformations) ? character.transformations : [];
        return mergeTransformations(staticEntries.map((entry) => normalizeTransformationEntry(entry, character)), currentTransformations)
            .filter((entry) => {
                if (!entry?.enabled && entry?.enabled !== undefined) return false;
                return String(entry.characterId || '') === characterId
                    || (accountId && String(entry.ownerAccountId || '') === accountId);
            })
            .sort((left, right) => String(left.creatureName || left.name || '').localeCompare(String(right.creatureName || right.name || ''), 'it'));
    }

    function normalizeTransformationEntry(entry, character) {
        const creatureName = String(entry?.creatureName || entry?.name || entry?.foundryName || '').trim();
        const id = entry?.id || `${character?.id || 'player'}-${slugify(creatureName || 'forma')}`;
        const size = parsePositiveNumberOrNull(entry?.size)
            || parsePositiveNumberOrNull(entry?.width)
            || parsePositiveNumberOrNull(entry?.height);
        const foundryNames = Array.from(new Set([
            entry?.foundryName,
            ...(Array.isArray(entry?.foundryNames) ? entry.foundryNames : []),
            creatureName
        ].filter(Boolean)));
        return {
            ...entry,
            id,
            characterId: entry?.characterId || character?.id || '',
            ownerAccountId: entry?.ownerAccountId || character?.accountId || '',
            ownerDiscordId: entry?.ownerDiscordId || character?.discordId || '',
            ownerAliases: Array.from(new Set([
                ...(Array.isArray(entry?.ownerAliases) ? entry.ownerAliases : []),
                character?.id,
                character?.name,
                character?.accountId,
                character?.discordId
            ].filter(Boolean))),
            creatureName,
            foundryNames,
            tokenImage: entry?.tokenImage || '',
            size,
            width: undefined,
            height: undefined
        };
    }

    function canEditCurrentPlayerTransformations(character) {
        if (currentUserIsDm) return true;
        const user = currentAuthState?.user || {};
        const accountId = String(user.accountId || user.id || user.sub || '').trim();
        const discordId = String(user.discordId || '').trim();
        return Boolean(accountId && character?.accountId && accountId === String(character.accountId))
            || Boolean(discordId && character?.discordId && discordId === String(character.discordId));
    }

    function renderPlayerTransformationsHtml(character) {
        const entries = getCharacterTransformations(character);
        const canEdit = canEditCurrentPlayerTransformations(character);
        const empty = canEdit
            ? 'Nessuna trasformazione configurata. Aggiungi una creatura e carica il token personalizzato.'
            : 'Nessuna trasformazione configurata.';
        const cards = entries.map((entry) => {
            const title = entry.creatureName || entry.name || entry.foundryName || 'Forma';
            const foundryLabel = (Array.isArray(entry.foundryNames) ? entry.foundryNames : [entry.foundryName]).filter(Boolean).join(', ');
            const image = entry.tokenImage ? resolveCharacterAssetPath(entry.tokenImage) : '';
            const initials = String(title || '?').trim().charAt(0).toUpperCase() || '?';
            const sizeLabel = entry.size ? `Dimensione token: ${entry.size} x ${entry.size}` : '';
            return `
                <article class="player-transformation-card" data-transformation-id="${escapeHtml(entry.id)}">
                    <button type="button" class="player-transformation-token ${image ? 'has-image' : ''}" data-transformation-action="upload" data-transformation-id="${escapeHtml(entry.id)}" ${canEdit ? '' : 'disabled'} title="${canEdit ? 'Carica token personalizzato' : 'Token personalizzato'}">
                        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}">` : `<span>${escapeHtml(initials)}</span>`}
                        ${canEdit ? '<small><i class="fas fa-upload"></i> Cambia</small>' : ''}
                    </button>
                    <div class="player-transformation-info">
                        ${canEdit ? `
                            <label class="player-transformation-name-field">
                                <span>Creatura Foundry</span>
                                <input type="text" value="${escapeHtml(title)}" data-transformation-name-input data-transformation-id="${escapeHtml(entry.id)}" aria-label="Nome creatura Foundry">
                            </label>
                        ` : `<strong>${escapeHtml(title)}</strong>`}
                        ${canEdit ? `
                            <div class="player-transformation-size-fields">
                                <label>
                                    <span>Dimensione token</span>
                                    <input type="number" min="0.25" step="0.25" value="${entry.size || ''}" placeholder="auto" data-transformation-size-input data-transformation-id="${escapeHtml(entry.id)}" aria-label="Dimensione token">
                                </label>
                            </div>
                        ` : ''}
                        ${foundryLabel ? `<span>Foundry: ${escapeHtml(foundryLabel)}</span>` : ''}
                        ${!canEdit && sizeLabel ? `<span>${escapeHtml(sizeLabel)}</span>` : ''}
                        <span class="player-transformation-mode ${entry.switcher === false ? 'is-muted' : ''}">
                            <i class="fas fa-retweet"></i>
                            ${entry.switcher === false ? 'Non nel Token Switcher' : 'Disponibile nel Token Switcher'}
                        </span>
                    </div>
                    ${canEdit ? `
                        <div class="player-transformation-actions">
                            <button type="button" data-transformation-action="rename" data-transformation-id="${escapeHtml(entry.id)}">Salva dati</button>
                            ${foundryLabel ? `<button type="button" data-transformation-action="copy-foundry-name" data-transformation-id="${escapeHtml(entry.id)}">Copia nome Foundry</button>` : ''}
                            <button type="button" data-transformation-action="toggle-switcher" data-transformation-id="${escapeHtml(entry.id)}">${entry.switcher === false ? 'Attiva switcher' : 'Disattiva switcher'}</button>
                            ${entry.tokenImage ? `<button type="button" data-transformation-action="clear" data-transformation-id="${escapeHtml(entry.id)}">Reset token</button>` : ''}
                            <button type="button" data-transformation-action="remove" data-transformation-id="${escapeHtml(entry.id)}">Rimuovi</button>
                        </div>
                    ` : ''}
                </article>
            `;
        }).join('');

        return `
            <div class="player-transformations-header">
                <div>
                    <h3><i class="fas fa-shapes"></i> Token trasformazioni</h3>
                    <p>Override estetici: Foundry continua a gestire la trasformazione, il modulo sostituisce solo l'immagine se trova un match.</p>
                </div>
                ${canEdit ? `<button type="button" class="button-gold-outline" data-transformation-action="add"><i class="fas fa-plus"></i> Aggiungi forma</button>` : ''}
            </div>
            ${entries.length ? `<div class="player-transformations-grid">${cards}</div>` : `<p class="player-overview-empty">${escapeHtml(empty)}</p>`}
        `;
    }

    async function handleTransformationClick(event) {
        const button = event.target.closest('[data-transformation-action]');
        if (!button || charType !== 'player' || !currentCharacter) return;
        event.preventDefault();
        const action = button.dataset.transformationAction;
        const id = button.dataset.transformationId || '';
        if (!canEditCurrentPlayerTransformations(currentCharacter)) {
            alert('Login richiesto con il proprietario del personaggio o con un account DM.');
            return;
        }

        if (action === 'add') {
            const name = window.prompt('Nome della creatura su Foundry');
            if (!String(name || '').trim()) return;
            const entry = normalizeTransformationEntry({
                creatureName: String(name).trim(),
                foundryNames: [String(name).trim()],
                enabled: true
            }, currentCharacter);
            await savePlayerTransformationList(upsertTransformation(getCharacterTransformations(currentCharacter), entry));
            return;
        }

        const list = getCharacterTransformations(currentCharacter);
        const entry = list.find((item) => item.id === id);
        if (!entry) return;

        if (action === 'copy-foundry-name') {
            const name = (Array.isArray(entry.foundryNames) ? entry.foundryNames[0] : entry.foundryName)
                || entry.creatureName
                || entry.name
                || '';
            const copied = await copyTextToClipboard(name);
            if (!copied) alert('Impossibile copiare automaticamente il nome Foundry.');
            return;
        }

        if (action === 'rename') {
            const nextEntry = readTransformationCardUpdate(entry, id);
            if (!nextEntry) return;
            await savePlayerTransformationList(upsertTransformation(list, nextEntry));
            return;
        }

        if (action === 'upload') {
            const file = await pickInlineImageFile();
            if (!file) return;
            const path = await uploadTransformationTokenImage(file, entry);
            if (!path) return;
            await savePlayerTransformationList(upsertTransformation(list, { ...entry, tokenImage: path, updatedAt: new Date().toISOString() }));
            return;
        }

        if (action === 'clear') {
            await savePlayerTransformationList(upsertTransformation(list, { ...entry, tokenImage: '', updatedAt: new Date().toISOString() }));
            return;
        }

        if (action === 'toggle-switcher') {
            await savePlayerTransformationList(upsertTransformation(list, {
                ...entry,
                switcher: entry.switcher === false,
                updatedAt: new Date().toISOString()
            }));
            return;
        }

        if (action === 'remove') {
            if (!window.confirm(`Rimuovere "${entry.creatureName || entry.name || 'questa forma'}"?`)) return;
            await savePlayerTransformationList(list.filter((item) => item.id !== id));
        }
    }

    function renameTransformationEntry(entry, nextName) {
        const previousName = String(entry.creatureName || entry.name || entry.foundryName || '').trim();
        const names = Array.isArray(entry.foundryNames) ? entry.foundryNames.slice() : [];
        const hadOnlyDefaultName = !names.length
            || (names.length === 1 && normalizeText(names[0]) === normalizeText(previousName));
        return {
            ...entry,
            creatureName: nextName,
            name: nextName,
            foundryNames: hadOnlyDefaultName
                ? [nextName]
                : Array.from(new Set([nextName, ...names].filter(Boolean))),
            updatedAt: new Date().toISOString()
        };
    }

    function readTransformationCardUpdate(entry, id) {
        const escapedId = CSS.escape(id);
        const input = container.querySelector(`[data-transformation-name-input][data-transformation-id="${escapedId}"]`);
        const sizeInput = container.querySelector(`[data-transformation-size-input][data-transformation-id="${escapedId}"]`);
        const nextName = String(input?.value || '').trim();
        if (!nextName) {
            alert('Il nome della creatura non puo essere vuoto.');
            return null;
        }
        return {
            ...renameTransformationEntry(entry, nextName),
            size: parsePositiveNumberOrNull(sizeInput?.value),
            width: undefined,
            height: undefined
        };
    }

    function parsePositiveNumberOrNull(value) {
        if (value === '' || value === null || value === undefined) return null;
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : null;
    }

    function upsertTransformation(list, entry) {
        const next = list.filter((item) => item.id !== entry.id);
        next.push(entry);
        return next;
    }

    async function savePlayerTransformationList(characterEntries) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per salvare i token trasformazione.');
            return;
        }
        const card = document.getElementById('player-transformations-card');
        card?.setAttribute('data-saving', 'true');
        try {
            const loaded = await loadTransformationsDocumentForSave();
            const characterId = String(currentCharacter?.id || '');
            const accountId = String(currentCharacter?.accountId || '');
            const nextOwnEntries = characterEntries.map((entry) => normalizeTransformationEntry(entry, currentCharacter));
            const otherEntries = (Array.isArray(loaded.data) ? loaded.data : []).filter((entry) => {
                return String(entry?.characterId || '') !== characterId
                    && (!accountId || String(entry?.ownerAccountId || '') !== accountId);
            });
            const nextData = [...otherEntries, ...nextOwnEntries];
            const response = await fetch(getTransformationsApiUrl(), {
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
            transformationsMemoryCache = null;
            currentTransformations = await loadTransformationsData({ force: true });
            const target = document.getElementById('player-transformations-card');
            if (target) target.innerHTML = renderPlayerTransformationsHtml(currentCharacter);
        } catch (error) {
            console.error('Salvataggio trasformazioni fallito:', error);
            alert(`Salvataggio trasformazioni fallito: ${error?.message || error}`);
        } finally {
            card?.removeAttribute('data-saving');
        }
    }

    async function loadTransformationsDocumentForSave() {
        try {
            const response = await fetch(getTransformationsApiUrl());
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
            console.warn('KV transformations non disponibile per salvataggio, uso JSON statico.', error);
        }

        const response = await fetch(TRANSFORMATIONS_DATA_URL);
        if (!response.ok) return { data: [], version: 0, source: 'static' };
        const payload = await response.json();
        const data = Array.isArray(payload) ? payload : payload?.data;
        return { data: Array.isArray(data) ? data : [], version: 0, source: 'static' };
    }

    async function uploadTransformationTokenImage(file, entry) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per caricare immagini.');
            return '';
        }
        try {
            const blob = /\.webp$/i.test(file.name) ? file : await convertInlineImageFileToWebpBlob(file);
            const folder = `transformations/${slugify(currentCharacter?.id || currentCharacter?.accountId || 'player')}`;
            const fileName = `${slugify(entry.creatureName || entry.name || entry.id || 'forma')}.webp`;
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
            console.error('Upload token trasformazione fallito:', error);
            alert(`Upload token fallito: ${error?.message || error}`);
            return '';
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
                const visibleBlocks = (character.content_blocks || []).filter(block => !block.hidden || currentUserIsDm);

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

            const playerCompanionsCard = document.createElement('div');
            playerCompanionsCard.className = 'content-card player-companions-card';
            playerCompanionsCard.id = 'player-companions-card';
            playerCompanionsCard.hidden = true;
            playerCompanionsCard.innerHTML = `
                        <h3><i class="fas fa-paw"></i> Companion</h3>
                        <div class="loadout-state">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>Sincronizzazione companion in corso...</span>
                        </div>
                    `;
            leftCol.appendChild(playerCompanionsCard);

            leftCol.appendChild(buildPlayerTransformationsCard(character));

            const skillTreeCard = buildPlayerSkillTreeCards(character, playerSkillTrees);
            if (skillTreeCard) leftCol.appendChild(skillTreeCard);
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
                            <button type="button" class="character-inline-icon-btn ${block.hidden ? 'is-active' : ''}" data-inline-edit-action="toggle-hidden" data-inline-block-index="${index}" title="${block.hidden ? 'Blocco nascosto ai giocatori' : 'Nascondi ai giocatori'}"><i class="fas ${block.hidden ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                            <button type="button" class="character-inline-icon-btn" data-inline-edit-action="move-up" data-inline-block-index="${index}" title="Sposta su"><i class="fas fa-arrow-up"></i></button>
                            <button type="button" class="character-inline-icon-btn" data-inline-edit-action="move-down" data-inline-block-index="${index}" title="Sposta giu"><i class="fas fa-arrow-down"></i></button>
                            <button type="button" class="character-inline-icon-btn character-inline-icon-btn--danger" data-inline-edit-action="delete-block" data-inline-block-index="${index}" title="Elimina"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="character-inline-final ${block.hidden ? 'character-inline-final--hidden' : ''}">
                        ${block.hidden ? '<span class="character-hidden-badge"><i class="fas fa-eye-slash"></i> Nascosto</span>' : ''}
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
        const images = character.images || {};
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
        const playerMediaActionsHtml = isPlayerView && canEditCurrentPlayerTransformations(character)
            ? `
                        <div class="character-media-actions">
                            <button type="button" data-media-override-action="upload" data-media-entity-type="player" data-media-kind="avatar" data-media-identity="${escapeHtml(character.id || charId)}" data-media-name="${escapeHtml(character.name || '')}">
                                <i class="fas fa-user"></i> Cambia avatar
                            </button>
                            <button type="button" data-media-override-action="upload" data-media-entity-type="player" data-media-kind="token" data-media-identity="${escapeHtml(character.id || charId)}" data-media-name="${escapeHtml(character.name || '')}">
                                <i class="fas fa-circle-dot"></i> Cambia token
                            </button>
                        </div>
                    `
            : '';

        return `
                    <div class="image-card">
                        <img src="${resolveImagePath(images.portrait || images.avatar || images.hover || '')}" class="char-portrait" onerror="this.src='https://placehold.co/400x500/111/333?text=No+Image'">
                        ${playerMediaActionsHtml}
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
        if (block.hidden) {
            card.classList.add('content-card--dm-hidden');
        }
        const hiddenBadge = block.hidden ? '<span class="character-hidden-badge"><i class="fas fa-eye-slash"></i> Nascosto</span>' : '';
        const wrapMarkdown = (html, extraClass = '') => {
            if (!html) return '';
            const className = extraClass ? `chapter-content ${extraClass}` : 'chapter-content';
            return `<div class="${className}">${html}</div>`;
        };

        // Use a switch to handle different block types
        switch (block.type) {
            case 'lore':
                card.innerHTML = `${hiddenBadge}<h3><i class="fas ${block.icon || 'fa-book-open'}"></i> ${block.title}</h3>${wrapMarkdown(block.markdownHtml)}`;
                break;

            case 'secret_dossier':
                // This block is initially commented out or hidden in the original file. 
                // For the template, we can render it directly or add a mechanism to reveal it.
                // For now, let's render it styled as a secret.
                card.classList.add('secret'); // You can style this class
                card.innerHTML = `
                        ${hiddenBadge}
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
                             ${hiddenBadge}
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
                card.innerHTML = `${hiddenBadge}<h3><i class="fas ${block.icon || 'fa-box'}"></i> ${block.title}</h3>${wrapMarkdown(block.markdownHtml)}`;
                break;

            case 'image_box':
                const docTags = (block.tags || []).map(tag => `<span class="doc-tag">${tag}</span>`).join('');

                card.classList.add('document-card');
                card.innerHTML = `
                        ${hiddenBadge}
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
                card.innerHTML = `${hiddenBadge}<h3>${block.title || 'Informazioni'}</h3>${wrapMarkdown(block.markdownHtml || block.content || '')}`;
        }
        return card;
    }
});


