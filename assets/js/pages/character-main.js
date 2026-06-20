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

function getCharacterMarkdownOptions(options = {}) {
    return {
        showInlineSecrets: window.CriptaCharacterCanSeeSecrets === true,
        ...options
    };
}

function renderMarkdown(md, options = {}) {
    return window.CriptaMarkdown.render(md, getCharacterMarkdownOptions(options));
}

const CHARACTER_MODULE_VERSION = '20260620-shared-skill-tree3';

function versionedCharacterModuleUrl(path, baseUrl) {
    const url = new URL(path, baseUrl);
    url.searchParams.set('v', CHARACTER_MODULE_VERSION);
    return url.toString();
}

function versionedCharacterStylesheetUrl(path) {
    const mainStyle = document.querySelector('link[href*="assets/css/pages/character.css"], link[data-page-style]');
    const baseUrl = mainStyle?.href || new URL('../../assets/css/pages/character.css', window.location.href).toString();
    const url = new URL(path, baseUrl);
    url.searchParams.set('v', CHARACTER_MODULE_VERSION);
    return url.toString();
}

function loadCharacterStylesheet(path, marker) {
    if (!path || !marker) return;
    if (document.querySelector(`link[data-character-style="${marker}"]`)) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = versionedCharacterStylesheetUrl(path);
    link.dataset.characterStyle = marker;
    document.head.appendChild(link);
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
            : await window.CriptaApp.fetchJson(dataUrl('characters.json'), { clone: true });
        const data = Array.isArray(payload) ? payload : payload?.data;
        if (Array.isArray(data)) return normalizeCharactersCollection(data);
    } catch (error) {
        console.warn('characters.json non disponibile, provo YAML statico.', error);
    }

    return null;
}

function normalizeCharactersCollection(characters) {
    return window.CriptaCharacterNormalize.normalizeCharactersCollection(characters, {
        includeOriginalId: true,
        normalizeBlocks: normalizeCharacterBlocks
    });
}

function characterMatchesId(character, requestedId) {
    const rawId = String(requestedId || '').trim();
    if (!character || !rawId) return false;
    const candidates = [
        character.id,
        character._originalId,
        character.entityId,
        character.name,
        character.foundryName
    ].map(value => String(value || '').trim()).filter(Boolean);
    if (candidates.some(candidate => candidate === rawId)) return true;
    const requestedSlug = slugify(rawId);
    return Boolean(requestedSlug && candidates.some(candidate => slugify(candidate) === requestedSlug));
}

function findCharacterById(characters, requestedId) {
    return (Array.isArray(characters) ? characters : []).find(character => characterMatchesId(character, requestedId));
}

function normalizeCharacterImages(character) {
    return window.CriptaCharacterNormalize.normalizeCharacterImages(character);
}

function createEmptyNpcCharacter() {
    const suffix = Date.now().toString(36);
    const character = {
        id: `nuovo-npc-${suffix}`,
        _originalId: '',
        type: 'npc',
        name: 'Nuovo NPC',
        role: 'NPC',
        category: '',
        summary: {
            race: '',
            period: '',
            age: '',
            height: '',
            weight: '',
            cause_of_death: ''
        },
        images: {},
        content_blocks: [{
            type: 'lore',
            title: 'Informazioni',
            icon: 'fa-book-open',
            markdownText: '',
            markdownHtml: '<p></p>'
        }],
        hidden: true,
        discovered: false,
        updatedAt: new Date().toISOString()
    };
    character.images = normalizeCharacterImages(character);
    return character;
}

function normalizeCharacterBlocks(character) {
    if (Array.isArray(character.content_blocks)) {
        return character.content_blocks.map(normalizeCharacterBlock);
    }
    if (!Array.isArray(character.blocks)) return [];
    return character.blocks.map((block) => normalizeCharacterBlock({
        ...block,
        type: block.type === 'image' || block.image ? 'image_box' : 'lore',
        markdownText: String(block.text || '')
    }));
}

function normalizeCharacterBlock(block) {
    const normalized = {
        ...block,
        type: block.type || (block.image ? 'image_box' : 'lore'),
        title: block.title || 'Informazioni',
        icon: block.icon || 'fa-book-open',
        image: block.image || '',
        hidden: Boolean(block.hidden)
    };
    if (normalized.type === 'image') normalized.type = 'image_box';

    const markdownText = typeof normalized.markdownText === 'string'
        ? normalized.markdownText
        : (typeof normalized.text === 'string' ? normalized.text : '');
    const context = getCharacterBlockMarkdownContext(normalized);

    if (markdownText) {
        normalized.markdownText = markdownText;
        normalized.markdownHtml = renderCharacterBlockMarkup(markdownText, context);
        return normalized;
    }

    if (typeof normalized.markdownHtml === 'string' && looksLikeRawMarkdown(normalized.markdownHtml)) {
        normalized.markdownText = normalized.markdownHtml;
        normalized.markdownHtml = renderCharacterBlockMarkup(normalized.markdownHtml, context);
        return normalized;
    }

    if (!normalized.markdownHtml && typeof normalized.content === 'string') {
        normalized.markdownHtml = renderCharacterBlockMarkup(normalized.content, context);
    }

    return normalized;
}

function getCharacterBlockMarkdownContext(block) {
    return block?.type === 'image_box' || block?.type === 'image' || block?.image ? 'image_box' : 'lore';
}

function looksLikeRawMarkdown(value) {
    return window.CriptaMarkdown.looksLikeRawMarkdown(value);
}

function containsMarkdownSyntax(value) {
    return window.CriptaMarkdown.containsMarkdownSyntax(value);
}

function containsInlineMarkdownSyntax(value) {
    return /\*\*[^*]+\*\*|==[^=]+==|`[^`]+`|\*[^*\n]+\*/.test(String(value || ''));
}

function looksLikeHtml(value) {
    return window.CriptaMarkdown.looksLikeHtml(value);
}

function renderCharacterBlockMarkup(value, context = 'lore') {
    const source = String(value || '');
    if (!source.trim()) return '';
    const options = getCharacterMarkdownOptions({ context });
    if (looksLikeHtml(source)) return window.CriptaMarkdown.renderInsideHtml(source, options);
    return window.CriptaMarkdown.render(source, options);
}

async function loadPlayersData() {
    const payload = typeof window.CriptaApp?.data?.json === 'function'
        ? await window.CriptaApp.data.json('players.json')
        : await window.CriptaApp.fetchJson(dataUrl('players.json'), { clone: true });
    const players = Array.isArray(payload) ? payload : payload?.data;
    const mediaOverrides = await loadMediaOverrides();
    return Array.isArray(players)
        ? normalizeCharactersCollection(players.map((player) => ({ ...player, type: 'player' })))
            .map(applySyncedPlayerImageFallback)
            .map((character) => applyCharacterMediaOverride(character, mediaOverrides))
        : [];
}

function normalizeCharacterType(value) {
    return String(value || '').trim().toLowerCase() === 'player' ? 'player' : 'npc';
}

function isKnownPlayerRequestId(value) {
    const key = normalizeText(value);
    if (!key) return false;
    return Object.entries(PLAYER_NAME_ALIASES).some(([id, aliases]) => (
        normalizeText(id) === key || (Array.isArray(aliases) && aliases.some((alias) => normalizeText(alias) === key))
    ));
}

async function inferCharacterTypeFromRequest(charId, explicitType) {
    if (explicitType) return normalizeCharacterType(explicitType);
    if (isKnownPlayerRequestId(charId)) return 'player';

    try {
        const payload = typeof window.CriptaApp?.data?.json === 'function'
            ? await window.CriptaApp.data.json('players.json')
            : await window.CriptaApp.fetchJson(dataUrl('players.json'), { clone: true });
        const players = Array.isArray(payload) ? payload : payload?.data;
        if (Array.isArray(players) && findCharacterById(normalizeCharactersCollection(players.map((player) => ({ ...player, type: 'player' }))), charId)) return 'player';
    } catch (_) {
        // Keep NPC default when the lightweight player index is unavailable.
    }

    return 'npc';
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
            block.markdownHtml = md ? renderCharacterBlockMarkup(md, getCharacterBlockMarkdownContext(block)) : `<p>Impossibile caricare ${block.markdown}</p>`;
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
        if (typeof window.CriptaApp?.data?.json === 'function') {
            return await window.CriptaApp.data.json('quests.json');
        }
        return await window.CriptaApp.fetchJson(dataUrl('quests.json'), { clone: true });
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
const SKILLS_ASSET_FOLDER = 'skill-trees';
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
let characterSkillTreeModulePromise = null;
let characterTransformationsModulePromise = null;
let characterLoadoutModulePromise = null;
let characterInlineEditorModulePromise = null;
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
let characterBootstrapData = null;
let characterBootstrapKey = '';

function escapeHtml(value) {
    return window.CriptaApp.utils.escapeHtml(value);
}

function normalizeText(value) {
    return window.CriptaApp.utils.normalizeKey(value);
}

function isHiddenInventoryEntry(entry) {
    return INVENTORY_EXCLUDED_NAMES.has(normalizeText(entry?.name));
}

function getLoadoutRole(entry) {
    const role = String(entry?.loadoutRole || entry?.wikiRole || entry?.siteRole || '').trim().toLowerCase();
    if (role === 'ability' || role === 'abilities' || role === 'attack') return 'ability';
    if (role === 'inventory' || role === 'item') return 'inventory';
    return '';
}

function getLoadoutSubtype(entry) {
    const subtype = String(entry?.loadoutSubtype || entry?.abilitySubtype || entry?.wikiSubtype || '').trim().toLowerCase();
    if (subtype === 'attack' || subtype === 'attacco') return 'attack';
    return '';
}

function getLoadoutAbilityLabel(entry) {
    if (getLoadoutSubtype(entry) === 'attack' || String(entry?.loadoutRole || '').trim().toLowerCase() === 'attack') return 'Attacco';
    return 'Abilita';
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
    return window.CriptaApp.utils.slugify(value, 'item');
}

function normalizeCategoryPriority(value) {
    return window.CriptaCharacterNormalize.normalizeCategoryPriority(value);
}

function formatCategoryPriority(value) {
    const priority = normalizeCategoryPriority(value);
    return priority === null ? '' : String(priority);
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

function initializeLoadoutCopyButtons(root) {
    if (!root) return;
    const buttons = Array.from(root.querySelectorAll('[data-loadout-copy]'));
    buttons.forEach((button) => {
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const entry = button.closest('.loadout-entry');
            const template = entry?.querySelector('[data-loadout-copy-template]');
            const text = normalizeCopyText(template?.content?.textContent || template?.textContent || '');
            if (!text) return;

            button.disabled = true;
            try {
                const copied = await copyTextToClipboard(text);
                if (!copied) return;
                const previousTitle = button.getAttribute('title') || 'Copia titolo e descrizione';
                button.classList.add('is-copied');
                button.setAttribute('title', 'Copiato');
                button.setAttribute('aria-label', 'Copiato');
                window.setTimeout(() => {
                    button.classList.remove('is-copied');
                    button.setAttribute('title', previousTitle);
                    button.setAttribute('aria-label', previousTitle);
                }, 1200);
            } finally {
                button.disabled = false;
            }
        });
    });
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
    if (/^(data:|blob:)/i.test(value)) return value;
    const legacySkillTreeFile = getLegacySkillTreeFileName(value);
    if (legacySkillTreeFile) {
        return window.CriptaApp.urls.api(`media/campaigns/${getCurrentCampaignId()}/${SKILLS_ASSET_FOLDER}/${legacySkillTreeFile}`);
    }
    if (/^https?:/i.test(value)) return value;
    if (value.startsWith('media/')) return window.CriptaApp.urls.api(value);
    if (value.startsWith('/media/')) return window.CriptaApp.urls.api(value.slice(1));
    if (value.startsWith('/')) return value;
    return window.CriptaApp.urls.api(`media/campaigns/${getCurrentCampaignId()}/${SKILLS_ASSET_FOLDER}/${value}`);
}

function getLegacySkillTreeFileName(value) {
    const raw = String(value || '').trim().replace(/\\/g, '/');
    const match = raw.match(/(?:^|\/)media\/skill_trees\/([^?#/]+)(?:[?#].*)?$/i)
        || raw.match(/(?:^|\/)skill_trees\/([^?#/]+)(?:[?#].*)?$/i);
    return match ? match[1] : '';
}

function dataUrl(pathname) {
    const clean = String(pathname || '').replace(/^\/+/, '');
    const resolved = window.CriptaApp?.urls?.data?.(clean);
    if (resolved && !/\/pages\/characters\/assets\/data\//.test(resolved)) return resolved;
    const script = document.querySelector('script[src*="assets/js/pages/character-main.js"]')
        || document.querySelector('script[src*="assets/js/layout.js"]');
    const scriptSrc = script?.getAttribute('src') || '';
    const base = scriptSrc
        ? new URL(scriptSrc, window.location.href).href.replace(/assets\/js\/(?:pages\/character-main|layout)\.js(?:[?#].*)?$/i, '')
        : new URL('../../', window.location.href).href;
    const campaignId = getCurrentCampaignId();
    const dataRoot = campaignId === 'cripta-di-sangue'
        ? 'assets/data'
        : `campaigns/${campaignId}/data`;
    return new URL(`${dataRoot}/${clean}`, base).toString();
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
    return window.CriptaCharacterNormalize.getSyncedPlayerImagePath(character, variant);
}

function getSyncedNpcImagePath(character, variant = 'avatar') {
    return window.CriptaCharacterNormalize.getSyncedNpcImagePath(character, variant);
}

function ensureDefaultNpcListImagePaths(character) {
    if (!character || (character.type || 'npc') === 'player') return;
    character.images = character.images || {};
    if (!character.images.idle) character.images.idle = getSyncedNpcImagePath(character, 'idle');
    if (!character.images.hover) character.images.hover = getSyncedNpcImagePath(character, 'hover');
}

function getLegacySyncedPlayerImagePath(character, variant = 'avatar') {
    const characterId = slugify(character?.id || character?.name || 'personaggio');
    const campaignId = getCurrentCampaignId();
    const suffix = variant === 'token' ? '-token' : '-avatar';
    if (campaignId !== 'cripta-di-sangue') return '';
    return `media/players/${characterId}${suffix}.webp`;
}

function getLegacySyncedPlayerAvatarPath(character) {
    const characterId = slugify(character?.id || character?.name || 'personaggio');
    const campaignId = getCurrentCampaignId();
    if (campaignId !== 'cripta-di-sangue') return '';
    return `media/players/${characterId}.webp`;
}

function applySyncedPlayerImageFallback(character) {
    const normalized = { ...character };
    const images = { ...(normalized.images || {}) };
    const avatarPath = getSyncedPlayerImagePath(normalized, 'avatar');
    const legacyAvatarPath = getLegacySyncedPlayerAvatarPath(normalized);
    const tokenPath = getSyncedPlayerImagePath(normalized, 'token');
    images.avatar = avatarPath;
    images.avatarFallback = legacyAvatarPath;
    images.portrait = avatarPath;
    images.portraitFallback = legacyAvatarPath;
    if (!images.token) images.token = tokenPath;
    if (!images.tokenFallback && images.token === tokenPath) images.tokenFallback = getLegacySyncedPlayerImagePath(normalized, 'token');
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
        const avatar = versionCharacterAssetPath(getSyncedPlayerImagePath(normalized, 'avatar'), override.updatedAt);
        normalized.images.avatar = avatar;
        normalized.images.portrait = avatar;
    }
    if (images.token) normalized.images.token = versionCharacterAssetPath(getSyncedPlayerImagePath(normalized, 'token'), override.updatedAt);
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

function versionCharacterAssetPath(imagePath, version) {
    return appendAssetVersion(resolveCharacterAssetPath(imagePath), version);
}

function getMediaPathFromAssetValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const url = new URL(raw, window.location.href);
        const index = url.pathname.indexOf('/media/');
        if (index >= 0) {
            return url.pathname.slice(index + 1).replace(/^\/+/, '');
        }
    } catch (_) {
        // Plain relative paths are handled below.
    }
    return raw.split(/[?#]/)[0].replace(/^\/+/, '');
}

function isCurrentCampaignMediaAsset(value) {
    const mediaPath = getMediaPathFromAssetValue(value);
    if (!mediaPath) return false;
    return mediaPath.startsWith(`media/campaigns/${getCurrentCampaignId()}/`);
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
            const payload = typeof window.CriptaApp?.data?.json === 'function'
                ? await window.CriptaApp.data.json('transformations.json')
                : await window.CriptaApp.fetchJson(TRANSFORMATIONS_DATA_URL, { clone: true });
            staticList = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []);
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
        merged.set(key, { ...entry, id: key, tokenImage: normalizeTransformationMediaPath(entry.tokenImage) });
    };
    (Array.isArray(baseList) ? baseList : []).forEach(add);
    (Array.isArray(overrideList) ? overrideList : []).forEach(add);
    return Array.from(merged.values());
}

function normalizeTransformationMediaPath(path) {
    const value = String(path || '').trim();
    if (!value) return '';
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    const clean = value.split(/[?#]/)[0].replace(/^\/+/, '');
    if (clean.startsWith(`media/campaigns/${getCurrentCampaignId()}/`)) return value;
    if (clean.startsWith('media/transformations/')) {
        return `media/campaigns/${getCurrentCampaignId()}/${clean.slice('media/'.length)}`;
    }
    if (clean.startsWith('media/companion-transformations/')) {
        return `media/campaigns/${getCurrentCampaignId()}/${clean.slice('media/'.length)}`;
    }
    return value;
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

        let payload = null;
        const fallbackUrl = window.CriptaApp?.urls?.globalData?.('skills.json') || '../../assets/data/skills.json';
        try {
            payload = typeof window.CriptaApp?.data?.json === 'function'
                ? await window.CriptaApp.data.json('skills.json')
                : await window.CriptaApp.fetchJson(SKILLS_DATA_URL, { clone: true });
        } catch (error) {
            if (SKILLS_DATA_URL === fallbackUrl) throw error;
            payload = typeof window.CriptaApp?.data?.globalJson === 'function'
                ? await window.CriptaApp.data.globalJson('skills.json')
                : await window.CriptaApp.fetchJson(fallbackUrl, { clone: true });
        }
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

async function loadCharacterBootstrap(characterId, type) {
    const nextKey = `${getCurrentCampaignId()}::${String(type || 'npc')}::${String(characterId || '')}`;
    if (characterBootstrapData && characterBootstrapKey === nextKey) return characterBootstrapData;
    if (typeof window.CriptaCharacterData?.loadBootstrap !== 'function') return null;
    characterBootstrapKey = nextKey;
    characterBootstrapData = await window.CriptaCharacterData.loadBootstrap(characterId, type, {
        campaignId: getCurrentCampaignId()
    }).catch((error) => {
        characterBootstrapKey = '';
        console.warn('Bootstrap scheda personaggio non disponibile, uso caricamenti separati.', error);
        return null;
    });
    if (characterBootstrapData) applyCharacterBootstrap(characterBootstrapData);
    return characterBootstrapData;
}

function applyCharacterBootstrap(bootstrap) {
    const dataService = window.CriptaCharacterData;
    const inventory = bootstrap?.inventory;
    if (inventory && Array.isArray(inventory.actors)) {
        inventoryMemoryCache = {
            fetchedAt: Date.now(),
            data: inventory
        };
        setSafeSessionStorageItem(INVENTORY_CACHE_KEY, JSON.stringify(inventoryMemoryCache));
    }

    const items = dataService?.getCollection?.(bootstrap, 'items');
    if (items) {
        wikiItemsMemoryCache = window.WikiSpoiler
            ? window.WikiSpoiler.filterVisible(items)
            : items.filter((item) => item.hidden !== true && item.status !== 'hidden');
    }

    const skillTreesDoc = dataService?.getCollectionDocument?.(bootstrap, 'skill-trees');
    if (Array.isArray(skillTreesDoc?.data) && skillTreesDoc.data.length > 0) {
        skillsVersion = Number(skillTreesDoc.version || 0);
        skillsMemoryCache = normalizeSkillTreesCollection(skillTreesDoc.data);
    }

    const skillStatesDoc = dataService?.getCollectionDocument?.(bootstrap, 'skill-tree-states');
    if (Array.isArray(skillStatesDoc?.data)) {
        skillTreeStatesVersion = Number(skillStatesDoc.version || 0);
        skillTreeStatesMemoryCache = skillStatesDoc.data;
    }

    const abilityOverrides = dataService?.getCollection?.(bootstrap, 'ability-overrides');
    if (abilityOverrides) abilityOverridesMemoryCache = abilityOverrides;

    const itemOverrides = dataService?.getCollection?.(bootstrap, 'item-overrides');
    if (itemOverrides) itemOverridesMemoryCache = itemOverrides;

    const mediaOverrides = dataService?.getCollection?.(bootstrap, 'media-overrides');
    if (mediaOverrides) mediaOverridesMemoryCache = mediaOverrides;

    const transformations = dataService?.getCollection?.(bootstrap, 'transformations');
    if (transformations) transformationsMemoryCache = transformations;
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
            payload = typeof window.CriptaApp?.data?.json === 'function'
                ? await window.CriptaApp.data.json('items.json')
                : await window.CriptaApp.fetchJson(WIKI_ITEMS_DATA_URL, { clone: true });
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

function normalizeSkillTreeConnection(connection) {
    if (!connection) return null;
    if (typeof connection === 'object') {
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

function extractSkillTreeNodeIdFromIcon(iconPath) {
    const value = String(iconPath || '').trim().split(/[?#]/)[0];
    if (!value) return '';
    const fileName = value.split('/').pop() || '';
    const id = fileName.replace(/\.[a-z0-9]+$/i, '');
    return /^node-[a-z0-9-]+$/i.test(id) ? id : '';
}

function makeUniqueSkillTreeNodeId(baseId, usedIds) {
    const base = slugify(baseId || 'node') || 'node';
    let id = base.startsWith('node-') ? base : `node-${base}`;
    let index = 2;
    while (usedIds.has(id)) {
        id = `${base}-${index}`;
        if (!id.startsWith('node-')) id = `node-${id}`;
        index += 1;
    }
    return id;
}

function chooseSkillTreeDuplicateTarget(sourceNode, candidates) {
    const options = (candidates || []).filter((candidate) => candidate && String(candidate.id) !== String(sourceNode?.id));
    if (!options.length) return candidates?.[0]?.id || '';
    const sourceX = Number(sourceNode?.x) || 0;
    const sourceY = Number(sourceNode?.y) || 0;
    return options
        .slice()
        .sort((left, right) => {
            const leftDistance = Math.hypot((Number(left.x) || 0) - sourceX, (Number(left.y) || 0) - sourceY);
            const rightDistance = Math.hypot((Number(right.x) || 0) - sourceX, (Number(right.y) || 0) - sourceY);
            return leftDistance - rightDistance;
        })[0]?.id || '';
}

function normalizeSkillTreeNodeIds(tree, treeKey = '') {
    if (!tree || !Array.isArray(tree.nodes)) return tree;
    const rawNodes = tree.nodes.map((node, index) => ({
        ...(node || {}),
        id: String(node?.id || `node-${index + 1}`).trim()
    }));
    const counts = rawNodes.reduce((acc, node) => {
        acc.set(node.id, (acc.get(node.id) || 0) + 1);
        return acc;
    }, new Map());
    const usedIds = new Set();
    const duplicateGroups = new Map();
    let changed = false;

    const nodes = rawNodes.map((node, index) => {
        const originalId = node.id;
        let id = originalId;
        if (!id || usedIds.has(id)) {
            const iconId = extractSkillTreeNodeIdFromIcon(node.icon);
            id = iconId && !usedIds.has(iconId)
                ? iconId
                : makeUniqueSkillTreeNodeId(node.title || originalId || `node-${index + 1}`, usedIds);
            changed = true;
        }
        usedIds.add(id);
        const nextNode = { ...node, id };
        if ((counts.get(originalId) || 0) > 1) {
            if (!duplicateGroups.has(originalId)) duplicateGroups.set(originalId, []);
            duplicateGroups.get(originalId).push(nextNode);
        }
        return nextNode;
    });

    if (!changed) return { ...tree, nodes };

    const remapTarget = (sourceNode, targetId) => {
        const target = String(targetId || '').trim();
        const duplicateCandidates = duplicateGroups.get(target);
        if (!duplicateCandidates?.length) return target;
        return chooseSkillTreeDuplicateTarget(sourceNode, duplicateCandidates) || target;
    };

    const remappedNodes = nodes.map((node) => {
        const nextNode = { ...node };
        if (Array.isArray(nextNode.connections)) {
            setSkillTreeConnections(nextNode, getSkillTreeConnections(nextNode).map((connection) => ({
                ...connection,
                target: remapTarget(nextNode, connection.target)
            })));
        }
        if (Array.isArray(nextNode.requires)) {
            nextNode.requires = nextNode.requires.map((id) => remapTarget(nextNode, id)).filter(Boolean);
        }
        if (Array.isArray(nextNode.requirements)) {
            nextNode.requirements = nextNode.requirements.map((id) => remapTarget(nextNode, id)).filter(Boolean);
        }
        return nextNode;
    });

    console.warn('Albero abilita con id nodo duplicati normalizzato:', treeKey || tree.id || tree.name || '', Array.from(duplicateGroups.keys()));
    return { ...tree, nodes: remappedNodes };
}

function normalizeSkillTreesCollection(data) {
    if (!Array.isArray(data)) return {};
    return data.reduce((acc, entry) => {
        if (!entry || typeof entry !== 'object') return acc;
        const key = String(entry.id || entry.key || entry.characterId || entry.treeKey || '').trim();
        const tree = entry.tree && typeof entry.tree === 'object' ? entry.tree : entry;
        if (!key || !Array.isArray(tree.nodes)) return acc;
        const rawScope = tree.scope || entry.scope || tree.treeScope || entry.treeScope || '';
        const isSharedTree = tree.shared === true
            || entry.shared === true
            || tree.campaignShared === true
            || entry.campaignShared === true
            || tree.global === true
            || entry.global === true
            || ['campaign', 'campagna', 'shared', 'condiviso', 'global'].includes(normalizeText(rawScope));
        acc[key] = normalizeSkillTreeNodeIds({
            ...tree,
            id: key,
            key,
            name: tree.name || entry.name || entry.title || '',
            scope: isSharedTree ? 'campaign' : rawScope,
            shared: isSharedTree,
            ownerCharacterId: isSharedTree ? '' : (tree.ownerCharacterId || entry.ownerCharacterId || entry.characterId || ''),
            characterId: isSharedTree ? '' : (tree.characterId || entry.characterId || '')
        }, key);
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

function loadCharacterSkillTreeModule() {
    if (window.CriptaCharacterSkillTree) return Promise.resolve(window.CriptaCharacterSkillTree);
    if (characterSkillTreeModulePromise) return characterSkillTreeModulePromise;

    characterSkillTreeModulePromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[data-character-skill-tree-module]');
        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(window.CriptaCharacterSkillTree), { once: true });
            existingScript.addEventListener('error', () => reject(new Error('Caricamento modulo albero abilita fallito.')), { once: true });
            return;
        }

        const mainScript = document.querySelector('script[src*="assets/js/pages/character-main.js"]');
        const baseUrl = mainScript?.src || new URL('../../assets/js/pages/character-main.js', window.location.href).toString();
        const script = document.createElement('script');
        script.src = versionedCharacterModuleUrl('../shared/character-skill-tree.js', baseUrl);
        script.defer = true;
        script.dataset.characterSkillTreeModule = 'true';
        script.addEventListener('load', () => {
            if (window.CriptaCharacterSkillTree) {
                resolve(window.CriptaCharacterSkillTree);
                return;
            }
            reject(new Error('Modulo albero abilita non inizializzato.'));
        }, { once: true });
        script.addEventListener('error', () => reject(new Error('Caricamento modulo albero abilita fallito.')), { once: true });
        document.head.appendChild(script);
    });

    return characterSkillTreeModulePromise;
}

function loadCharacterTransformationsModule() {
    if (window.CriptaCharacterTransformations) return Promise.resolve(window.CriptaCharacterTransformations);
    if (characterTransformationsModulePromise) return characterTransformationsModulePromise;

    characterTransformationsModulePromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[data-character-transformations-module]');
        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(window.CriptaCharacterTransformations), { once: true });
            existingScript.addEventListener('error', () => reject(new Error('Caricamento modulo trasformazioni fallito.')), { once: true });
            return;
        }

        const mainScript = document.querySelector('script[src*="assets/js/pages/character-main.js"]');
        const baseUrl = mainScript?.src || new URL('../../assets/js/pages/character-main.js', window.location.href).toString();
        const script = document.createElement('script');
        script.src = versionedCharacterModuleUrl('../shared/character-transformations.js', baseUrl);
        script.defer = true;
        script.dataset.characterTransformationsModule = 'true';
        script.addEventListener('load', () => {
            if (window.CriptaCharacterTransformations) {
                resolve(window.CriptaCharacterTransformations);
                return;
            }
            reject(new Error('Modulo trasformazioni non inizializzato.'));
        }, { once: true });
        script.addEventListener('error', () => reject(new Error('Caricamento modulo trasformazioni fallito.')), { once: true });
        document.head.appendChild(script);
    });

    return characterTransformationsModulePromise;
}

function loadCharacterLoadoutModule() {
    loadCharacterStylesheet('character-loadout.css', 'loadout');

    if (window.CriptaCharacterLoadout) return Promise.resolve(window.CriptaCharacterLoadout);
    if (characterLoadoutModulePromise) return characterLoadoutModulePromise;

    characterLoadoutModulePromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[data-character-loadout-module]');
        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(window.CriptaCharacterLoadout), { once: true });
            existingScript.addEventListener('error', () => reject(new Error('Caricamento modulo loadout fallito.')), { once: true });
            return;
        }

        const mainScript = document.querySelector('script[src*="assets/js/pages/character-main.js"]');
        const baseUrl = mainScript?.src || new URL('../../assets/js/pages/character-main.js', window.location.href).toString();
        const script = document.createElement('script');
        script.src = versionedCharacterModuleUrl('../shared/character-loadout.js', baseUrl);
        script.defer = true;
        script.dataset.characterLoadoutModule = 'true';
        script.addEventListener('load', () => {
            if (window.CriptaCharacterLoadout) {
                resolve(window.CriptaCharacterLoadout);
                return;
            }
            reject(new Error('Modulo loadout non inizializzato.'));
        }, { once: true });
        script.addEventListener('error', () => reject(new Error('Caricamento modulo loadout fallito.')), { once: true });
        document.head.appendChild(script);
    });

    return characterLoadoutModulePromise;
}

function loadCharacterInlineEditorModule() {
    if (window.CriptaCharacterInlineEditor) return Promise.resolve(window.CriptaCharacterInlineEditor);
    if (characterInlineEditorModulePromise) return characterInlineEditorModulePromise;

    characterInlineEditorModulePromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[data-character-inline-editor-module]');
        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(window.CriptaCharacterInlineEditor), { once: true });
            existingScript.addEventListener('error', () => reject(new Error('Caricamento modulo editor NPC fallito.')), { once: true });
            return;
        }

        const mainScript = document.querySelector('script[src*="assets/js/pages/character-main.js"]');
        const baseUrl = mainScript?.src || new URL('../../assets/js/pages/character-main.js', window.location.href).toString();
        const script = document.createElement('script');
        script.src = versionedCharacterModuleUrl('../shared/character-inline-editor.js', baseUrl);
        script.defer = true;
        script.dataset.characterInlineEditorModule = 'true';
        script.addEventListener('load', () => {
            if (window.CriptaCharacterInlineEditor) {
                resolve(window.CriptaCharacterInlineEditor);
                return;
            }
            reject(new Error('Modulo editor NPC non inizializzato.'));
        }, { once: true });
        script.addEventListener('error', () => reject(new Error('Caricamento modulo editor NPC fallito.')), { once: true });
        document.head.appendChild(script);
    });

    return characterInlineEditorModulePromise;
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

    const characterId = normalizeText(character.id);
    const byCharacterId = actors.find((actor) => {
        const ownerCharacterId = normalizeText(actor.ownerCharacterId || actor.characterId);
        return ownerCharacterId && ownerCharacterId === characterId;
    });
    if (byCharacterId) return byCharacterId;

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
    const itemUuid = String(entry?.uuid || '').trim();
    const transferId = String(entry?.transferId || '').trim();
    const sourceId = String(entry?.sourceId || entry?.system?.source?.uuid || entry?.system?.source?.id || entry?.wikiItemId || '').trim();
    const transferKey = getTransferableItemKey({ itemId, itemName, itemType, sourceId, transferId, existingTransferKey: entry?.transferKey });
    const ownerKey = slugify(characterId || actorId || characterName || actorName || 'personaggio');
    const itemKey = slugify(itemId || itemName || 'oggetto');
    return {
        key: `${ownerKey}:${itemKey}`,
        characterId,
        characterName,
        actorId,
        actorName,
        itemUuid,
        transferId,
        sourceId,
        transferKey,
        itemId,
        itemName,
        itemType
    };
}

function getTransferableItemKey({ itemId = '', itemName = '', itemType = '', sourceId = '', transferId = '', existingTransferKey = '' } = {}) {
    const existing = String(existingTransferKey || '').trim();
    if (existing) return existing;
    const instance = normalizeText(transferId);
    if (instance) return `instance:${instance}`;
    const stableSource = normalizeText(sourceId);
    if (stableSource) return `source:${stableSource}`;
    const name = normalizeText(itemName);
    const type = normalizeText(itemType);
    if (name && type) return `name:${type}:${name}`;
    if (name) return `name:${name}`;
    const id = normalizeText(itemId);
    return id ? `id:${id}` : '';
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
        if (record.transferId && identity.transferId && record.transferId === identity.transferId) return true;
        if (sameCharacter) {
            const recordKeyItem = String(record.key || '').split(':').slice(1).join(':');
            if (recordKeyItem && identity.itemId) {
                const sameKeyItem = normalizeText(recordKeyItem) === normalizeText(identity.itemId);
                if (sameKeyItem) return true;
                return false;
            }
        }
        if (sameCharacter && record.transferKey && identity.transferKey && record.transferKey === identity.transferKey) return true;
        if (sameCharacter && record.sourceId && identity.sourceId && normalizeText(record.sourceId) === normalizeText(identity.sourceId)) return true;
        const sameItem = Boolean(record.itemId && identity.itemId && record.itemId === identity.itemId)
            || Boolean(record.itemName && identity.itemName && normalizeText(record.itemName) === normalizeText(identity.itemName));
        return sameCharacter && sameItem;
    }) || null;
}

function getInventoryEntryIconPath(entry, wikiItem, itemOverride) {
    const overrideImage = String(itemOverride?.image || '').trim();
    const overrideSource = String(itemOverride?.imageSource || '').trim().toLowerCase();
    if (overrideImage && overrideSource === 'site') {
        return versionCharacterAssetPath(overrideImage, itemOverride.updatedAt);
    }
    if (wikiItem) return '';
    if (overrideImage) return versionCharacterAssetPath(overrideImage, itemOverride.updatedAt);
    return entry?.img || '';
}

function buildReadableAssetSlug(...parts) {
    const seen = new Set();
    return parts
        .map((part) => slugify(part || ''))
        .filter(Boolean)
        .filter((part) => {
            if (seen.has(part)) return false;
            seen.add(part);
            return true;
        })
        .join('-');
}

function getCompanionReadableEntityId(ownerCharacterId, companion) {
    const companionActorId = companion?.actorId || companion?.id || '';
    const companionName = companion?.foundryName || companion?.name || companion?.displayName || 'companion';
    return buildReadableAssetSlug(ownerCharacterId || 'personaggio', companionName, companionActorId);
}

function getCompanionAvatarImageCandidates(companion) {
    const tokenPath = companion?.token?.img || '';
    const avatarVariant = getAvatarVariantPath(tokenPath);
    const ownerCharacterId = slugify(companion?.ownerCharacterId || companion?.characterId || '');
    const syncedEntityId = ownerCharacterId ? getCompanionReadableEntityId(ownerCharacterId, companion) : '';
    const campaignId = getCurrentCampaignId();
    const companionFolder = `campaigns/${campaignId}/companions/${ownerCharacterId}`;
    const legacyCompanionFolder = campaignId === 'cripta-di-sangue' ? `companions/${ownerCharacterId}` : '';
    const syncedAvatar = syncedEntityId ? `media/${companionFolder}/${syncedEntityId}-avatar.webp` : '';
    const syncedToken = syncedEntityId ? `media/${companionFolder}/${syncedEntityId}-token.webp` : '';
    const legacySyncedAvatar = syncedEntityId && legacyCompanionFolder ? `media/${legacyCompanionFolder}/${syncedEntityId}-avatar.webp` : '';
    const legacySyncedToken = syncedEntityId && legacyCompanionFolder ? `media/${legacyCompanionFolder}/${syncedEntityId}-token.webp` : '';
    const overrideAvatar = companion?._mediaOverrideImages?.avatar || '';
    const currentCampaignOverrideAvatar = isCurrentCampaignMediaAsset(overrideAvatar) ? overrideAvatar : '';
    const legacyOverrideAvatar = currentCampaignOverrideAvatar ? '' : overrideAvatar;
    return Array.from(new Set([
        resolveSyncedActorImagePath(currentCampaignOverrideAvatar),
        resolveSyncedActorImagePath(syncedAvatar),
        resolveSyncedActorImagePath(legacyOverrideAvatar),
        resolveSyncedActorImagePath(avatarVariant),
        resolveSyncedActorImagePath(companion?.img),
        resolveSyncedActorImagePath(legacySyncedAvatar),
        resolveSyncedActorImagePath(syncedToken),
        resolveSyncedActorImagePath(legacySyncedToken),
        resolveSyncedActorImagePath(tokenPath)
    ].filter(Boolean)));
}

function getCompanionTokenImageCandidates(companion) {
    const tokenPath = companion?.token?.img || '';
    const ownerCharacterId = slugify(companion?.ownerCharacterId || companion?.characterId || '');
    const syncedEntityId = ownerCharacterId ? getCompanionReadableEntityId(ownerCharacterId, companion) : '';
    const campaignId = getCurrentCampaignId();
    const companionFolder = `campaigns/${campaignId}/companions/${ownerCharacterId}`;
    const legacyCompanionFolder = campaignId === 'cripta-di-sangue' ? `companions/${ownerCharacterId}` : '';
    const syncedToken = syncedEntityId ? `media/${companionFolder}/${syncedEntityId}-token.webp` : '';
    const legacySyncedToken = syncedEntityId && legacyCompanionFolder ? `media/${legacyCompanionFolder}/${syncedEntityId}-token.webp` : '';
    const overrideToken = companion?._mediaOverrideImages?.token || '';
    const currentCampaignOverrideToken = isCurrentCampaignMediaAsset(overrideToken) ? overrideToken : '';
    const legacyOverrideToken = currentCampaignOverrideToken ? '' : overrideToken;
    return Array.from(new Set([
        resolveSyncedActorImagePath(currentCampaignOverrideToken),
        resolveSyncedActorImagePath(syncedToken),
        resolveSyncedActorImagePath(legacyOverrideToken),
        resolveSyncedActorImagePath(legacySyncedToken),
        resolveSyncedActorImagePath(tokenPath),
        resolveSyncedActorImagePath(companion?.img)
    ].filter(Boolean)));
}

function getCompanionMediaOverrideIdentity(character, companion) {
    const companionName = companion?.foundryName || companion?.name || companion?.displayName || companion?.id || 'companion';
    const companionActorId = companion?.actorId || companion?.id || '';
    const entityId = character?.id
        ? getCompanionReadableEntityId(character.id, companion)
        : buildReadableAssetSlug(companionName, companionActorId);
    return {
        id: getMediaOverrideId('companion', entityId),
        entityType: 'companion',
        entityId,
        characterId: character?.id || '',
        ownerCharacterId: character?.id || '',
        ownerAccountId: character?.accountId || '',
        name: companion?.displayName || companion?.name || 'Companion',
        foundryName: companion?.foundryName || companion?.name || '',
        actorId: companionActorId
    };
}

function getCompanionSkillTreeSubject(character, companion, identity = null) {
    const entityId = identity?.entityId || getCompanionReadableEntityId(character?.id || '', companion);
    return {
        id: `companion-${entityId}`,
        entityId,
        characterId: `companion-${entityId}`,
        name: companion?.displayName || companion?.name || identity?.name || 'Companion',
        foundryName: companion?.foundryName || companion?.name || identity?.foundryName || '',
        actorId: companion?.actorId || companion?.id || identity?.actorId || '',
        uuid: companion?.uuid || '',
        accountId: character?.accountId || '',
        discordId: character?.discordId || '',
        ownerCharacterId: character?.id || '',
        isCompanion: true
    };
}

function applyCompanionMediaOverride(companion, identity, overrides = mediaOverridesMemoryCache || []) {
    const override = findMediaOverride(overrides, 'companion', identity?.entityId, identity);
    if (!override?.images) return companion;
    const next = {
        ...companion,
        token: { ...(companion?.token || {}) },
        _mediaOverrideImages: { ...(companion?._mediaOverrideImages || {}) }
    };
    if (override.images.avatar) {
        const avatar = versionCharacterAssetPath(override.images.avatar, override.updatedAt);
        next.img = avatar;
        next._mediaOverrideImages.avatar = avatar;
    }
    if (override.images.token) {
        const token = versionCharacterAssetPath(override.images.token, override.updatedAt);
        next.token.img = token;
        next._mediaOverrideImages.token = token;
    }
    return next;
}

window.CriptaApp.onPageReady("character", async function () {
    const container = document.getElementById('character-content-container');
    const charNameEl = document.getElementById('char-name');
    const charRoleEl = document.getElementById('char-role');
    const editLinkEl = document.getElementById('character-edit-link');

    const params = new URLSearchParams(window.location.search);
    const charId = params.get('id');
    let charType = normalizeCharacterType(params.get('type'));
    const createMode = params.get('new') === '1';
    const skillTreeOnlyView = params.get('view') === 'skill-tree' || params.get('skillTreeOnly') === '1';
    let currentCharacter = null;
    let currentAllCharacters = [];
    let currentNpcQuests = null;
    let currentPlayerSkillTrees = null;
    let currentSkillTreeModule = null;
    let currentTransformationsModule = null;
    let currentLoadoutModule = null;
    let currentInlineEditorModule = null;
    let currentUserIsDm = false;
    let currentAuthState = null;
    let currentTransformations = [];

    if (!charId && !createMode) {
        displayError("ID del personaggio non specificato.");
        return;
    }

    if (!params.get('type') && !createMode) {
        charType = await inferCharacterTypeFromRequest(charId);
    }

    editLinkEl?.addEventListener('click', async (event) => {
        if (charType === 'player') return;
        event.preventDefault();
        const inlineEditor = await ensureInlineEditorModule();
        inlineEditor.enter(getInlineEditorRuntimeContext());
    });

    container.addEventListener('input', (event) => currentInlineEditorModule?.handleInput(event, getInlineEditorRuntimeContext()));
    container.addEventListener('keydown', (event) => currentInlineEditorModule?.handleKeyDown(event, getInlineEditorRuntimeContext()));
    container.addEventListener('change', (event) => currentInlineEditorModule?.handleChange(event, getInlineEditorRuntimeContext()));
    container.addEventListener('mousedown', (event) => currentInlineEditorModule?.handleMouseDown(event, getInlineEditorRuntimeContext()));
    container.addEventListener('click', (event) => currentInlineEditorModule?.handleClick(event, getInlineEditorRuntimeContext()));
    container.addEventListener('dragover', (event) => currentInlineEditorModule?.handleDragOver(event, getInlineEditorRuntimeContext()));
    container.addEventListener('dragleave', (event) => currentInlineEditorModule?.handleDragLeave(event, getInlineEditorRuntimeContext()));
    container.addEventListener('drop', (event) => currentInlineEditorModule?.handleDrop(event, getInlineEditorRuntimeContext()));
    container.addEventListener('click', handleMediaOverrideClick);
    container.addEventListener('click', (event) => {
        currentTransformationsModule?.handleClick(event, getTransformationRuntimeContext());
    });

    currentAuthState = await window.CriptaDiscordAuth?.verify?.().catch(() => null);
    currentUserIsDm = await resolveCurrentUserIsDm(currentAuthState);
    window.CriptaCharacterCanSeeSecrets = currentUserIsDm || window.WikiSpoiler?.allowSpoilers?.() === true;

    function getSkillTreeRuntimeContext() {
        return {
            PLAYER_SKILL_TREE_KEYS,
            skillsMemoryCache: skillsMemoryCache || currentPlayerSkillTrees || null,
            skillTreeStatesMemoryCache,
            skillTreeStatesVersion,
            skillTreeAuthState: currentAuthState,
            skillTreeCurrentUserIsDm: currentUserIsDm,
            escapeHtml,
            normalizeText,
            slugify,
            getCurrentCampaignId,
            readSharedAuthToken,
            resolveSkillAssetPath,
            normalizeSkillTreeEditableHtml,
            resizeImageFileToSquareWebpBlobShared,
            resizeImageFileToWebpBlobShared,
            loadSkillTreeStates,
            saveSkillTreesData,
            setSkillTreeStates(states, version) {
                skillTreeStatesMemoryCache = Array.isArray(states) ? states : [];
                if (Number.isFinite(Number(version))) skillTreeStatesVersion = Number(version);
            },
            setSkillsCache(trees, version) {
                skillsMemoryCache = trees || {};
                currentPlayerSkillTrees = skillsMemoryCache;
                if (Number.isFinite(Number(version))) skillsVersion = Number(version);
            }
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

    function getTransformationRuntimeContext() {
        return {
            currentTransformations,
            currentUserIsDm,
            currentAuthState,
            currentCharacter,
            charType,
            container,
            TRANSFORMATIONS_DATA_URL,
            escapeHtml,
            normalizeText,
            slugify,
            mergeTransformations,
            getCurrentCampaignId,
            getSyncedPlayerImagePath,
            resolveCharacterAssetPath,
            getCompanionsForCharacter,
            getCompanionMediaOverrideIdentity,
            getCompanionSkillTreeSubject,
            applyCompanionMediaOverride,
            readAuthToken,
            pickInlineImageFile,
            convertInlineImageFileToWebpBlob,
            saveVersionedCollection,
            getTransformationsApiUrl,
            buildNoStoreApiUrl,
            loadTransformationsData,
            copyTextToClipboard,
            setTransformations(transformations) {
                currentTransformations = Array.isArray(transformations) ? transformations : [];
            }
        };
    }

    function getLoadoutRuntimeContext() {
        return {
            currentPlayerSkillTrees,
            currentSkillTreeModule,
            currentTransformationsModule,
            INVENTORY_EXCLUDED_TYPES,
            escapeHtml,
            normalizeText,
            formatToken,
            isHiddenInventoryEntry,
            getLoadoutRole,
            getLoadoutSubtype,
            getLoadoutAbilityLabel,
            findPlayerActor,
            getCompanionsForCharacter,
            resolveSyncedActorImagePath,
            getAvatarVariantPath,
            getAbilityOverrideIdentity,
            getItemOverrideIdentity,
            findAbilityOverride,
            findItemOverride,
            getInventoryEntryIconPath,
            buildReadableAssetSlug,
            getCompanionReadableEntityId,
            getCompanionAvatarImageCandidates,
            getCompanionTokenImageCandidates,
            getCompanionMediaOverrideIdentity,
            getCompanionSkillTreeSubject,
            applyCompanionMediaOverride,
            resolveCharacterAssetPath,
            pickInlineImageFile,
            cropAbilityIconFileToWebpBlob,
            uploadAbilityOverrideFile,
            uploadItemOverrideFile,
            saveAbilityOverride,
            saveItemOverride,
            getTransferableItemKey,
            loadInventoryData,
            loadWikiItemsData,
            loadAbilityOverrides,
            loadItemOverrides,
            loadMediaOverrides,
            initializeLoadoutCopyButtons,
            canEditCurrentPlayerTransformations,
            getSkillTreeRuntimeContext,
            getTransformationRuntimeContext
        };
    }

    async function ensureInlineEditorModule() {
        if (currentInlineEditorModule) return currentInlineEditorModule;
        currentInlineEditorModule = await loadCharacterInlineEditorModule();
        return currentInlineEditorModule;
    }

    function getInlineEditorRuntimeContext() {
        return {
            currentCharacter,
            currentAllCharacters,
            currentNpcQuests,
            currentPlayerSkillTrees,
            charId,
            charType,
            container,
            editLinkEl,
            charNameEl,
            charRoleEl,
            escapeHtml,
            slugify,
            looksLikeHtml,
            renderMarkdown,
            renderCharacterPage,
            normalizeCharactersCollection,
            ensureDefaultNpcListImagePaths,
            getSyncedNpcImagePath,
            normalizeCategoryPriority,
            formatCategoryPriority,
            normalizeImageAdjust,
            serializeImageAdjust,
            compactObject,
            classifyDocumentCardImage,
            resolveCharacterAssetPath,
            appendAssetVersion,
            readAuthToken,
            saveVersionedCollection,
            loadCharactersDocumentForSave,
            getCharactersApiUrl,
            copyInlineCharacterMediaFolder,
            rewriteInlineCharacterMediaFolderPaths,
            pickInlineImageFile,
            uploadInlineImageFile,
            setCurrentCharacter(character) {
                currentCharacter = character;
            },
            setCurrentAllCharacters(characters) {
                currentAllCharacters = Array.isArray(characters) ? characters : [];
            }
        };
    }

    try {
        let character = null;
        let allCharacters = [];
        if (createMode && (charType === 'player' || !currentUserIsDm)) {
            displayError("Creazione NPC non autorizzata.");
            return;
        }

        const bootstrap = createMode ? null : await loadCharacterBootstrap(charId, charType);

        // Quests are only rendered for NPC pages; avoid noisy 404s on player-only campaigns.
        const questsData = charType === 'player' ? [] : await loadQuestsData();
        const npcQuests = questsData.find(g => g.npc_id === charId);

        // IBRIDO: Se abbiamo dati statici, usiamoli.
        if (charType !== 'player' && window.NPC_DATA && window.NPC_DATA.length > 0) {
            console.log("Using static NPC data for character details");
            allCharacters = normalizeCharactersCollection(window.NPC_DATA);
            character = createMode
                ? createEmptyNpcCharacter()
                : findCharacterById(allCharacters, charId);
        } else {
            // Fallback Fetch Logic
            let characters;
            if (charType === 'player') {
                characters = await loadPlayersData();
            } else {
                const bootstrapCharacters = window.CriptaCharacterData?.getCollection?.(bootstrap, 'characters');
                characters = Array.isArray(bootstrapCharacters) && bootstrapCharacters.length
                    ? normalizeCharactersCollection(bootstrapCharacters)
                    : await loadCharactersCollection();
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
            character = createMode
                ? createEmptyNpcCharacter()
                : findCharacterById(characters, charId);

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
                const context = getCharacterBlockMarkdownContext(block);
                if (block.markdownText) {
                    block.markdownHtml = renderCharacterBlockMarkup(block.markdownText, context);
                } else if (block.markdownHtml && looksLikeRawMarkdown(block.markdownHtml)) {
                    block.markdownText = block.markdownHtml;
                    block.markdownHtml = renderCharacterBlockMarkup(block.markdownText, context);
                }
            });
        }

        let playerSkillTrees = null;
        if (charType === 'player') {
            try {
                playerSkillTrees = await loadSkillsData();
                currentSkillTreeModule = await loadCharacterSkillTreeModule();
                await loadSkillTreeStates();
            } catch (skillError) {
                console.warn('Impossibile caricare gli alberi abilita:', skillError);
            }
        }

        if (charType === 'player') {
            currentLoadoutModule = await loadCharacterLoadoutModule().catch((error) => {
                console.warn('Modulo loadout non disponibile:', error);
                return null;
            });
            currentTransformationsModule = await loadCharacterTransformationsModule().catch((error) => {
                console.warn('Modulo trasformazioni non disponibile:', error);
                return null;
            });
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
        if (params.get('edit') === '1' && charType !== 'player' && currentUserIsDm) {
            const inlineEditor = await ensureInlineEditorModule();
            inlineEditor.enter(getInlineEditorRuntimeContext());
        }

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
        const editUrl = new URL(window.location.href);
        editUrl.searchParams.set('id', id);
        editUrl.searchParams.set('type', type || 'npc');
        editUrl.searchParams.set('edit', '1');
        const campaignId = window.CriptaApp?.campaigns?.currentId?.() || params.get('campaign') || '';
        if (campaignId) editUrl.searchParams.set('campaign', campaignId);
        editLinkEl.href = editUrl.toString();
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
                await currentLoadoutModule?.hydrate(currentCharacter, getLoadoutRuntimeContext());
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
            return await uploadInlineImageBlob(blob, characterId, fileName, token);
        } catch (error) {
            console.error('Upload immagine inline fallito:', error);
            alert(`Upload immagine fallito: ${error?.message || error}`);
            return '';
        } finally {
            toolbar?.removeAttribute('data-saving');
        }
    }

    async function uploadInlineImageBlob(blob, characterId, fileName, token = readAuthToken()) {
        const folder = `characters/${slugify(characterId || 'npc')}`;
        const payload = await window.CriptaMedia.uploadBlob(blob, {
            folder,
            fileName,
            token,
            campaignId: getCurrentCampaignId(),
            authError: 'Login richiesto per caricare immagini.'
        });
        return payload.path;
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

    function isVersionConflictResponse(result) {
        return result?.response?.status === 409 || result?.payload?.code === 'VERSION_CONFLICT';
    }

    async function postVersionedCollection(url, data, loaded, token) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                data,
                expectedVersion: loaded.source === 'kv' ? (loaded.version ?? 0) : 0,
                campaignId: getCurrentCampaignId()
            })
        });
        const payload = await response.json().catch(() => null);
        return { response, payload };
    }

    async function saveVersionedCollection({ load, url, token, buildData, attempts = 3 }) {
        let lastResult = null;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            const loaded = await load();
            const nextData = buildData(loaded.data);
            const result = await postVersionedCollection(url, nextData, loaded, token);
            lastResult = result;
            if (isVersionConflictResponse(result)) continue;
            if (!result.response.ok || result.payload?.ok === false) {
                throw new Error(result.payload?.error || `HTTP ${result.response.status}`);
            }
            return { data: nextData, payload: result.payload, loaded };
        }
        throw new Error(lastResult?.payload?.error || 'Salvataggio non riuscito: i dati online sono cambiati durante il salvataggio. Riprova.');
    }

    async function loadCharactersDocumentForSave() {
        try {
            const response = await fetch(buildNoStoreApiUrl(getCharactersApiUrl()));
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

        const payload = typeof window.CriptaApp?.data?.json === 'function'
            ? await window.CriptaApp.data.json('characters.json')
            : await window.CriptaApp.fetchJson(dataUrl('characters.json'), { clone: true });
        const data = Array.isArray(payload) ? payload : payload?.data;
        if (!Array.isArray(data)) throw new Error('Formato characters.json non valido.');
        return { data, version: 0, source: 'static' };
    }

    async function loadAbilityOverridesDocumentForSave() {
        const response = await fetch(buildNoStoreApiUrl(getAbilityOverridesApiUrl()));
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

        const saved = await saveVersionedCollection({
            load: loadAbilityOverridesDocumentForSave,
            url: getAbilityOverridesApiUrl(),
            token,
            buildData: (records) => upsertAbilityOverrideRecord(records, identity, patch)
        });
        abilityOverridesMemoryCache = saved.data;
        return true;
    }

    async function loadItemOverridesDocumentForSave() {
        const response = await fetch(buildNoStoreApiUrl(getItemOverridesApiUrl()));
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
        return payload || { data: [], version: 0, source: 'static' };
    }

    function upsertItemOverrideRecord(records, identity, patch) {
        const existing = findItemOverride(records, identity) || {};
        const nextRecord = {
            ...existing,
            id: existing.id || identity.key,
            key: existing.key || identity.key,
            characterId: identity.characterId,
            characterName: identity.characterName,
            actorId: identity.actorId,
            actorName: identity.actorName,
            itemUuid: identity.itemUuid,
            transferId: identity.transferId,
            sourceId: identity.sourceId,
            transferKey: identity.transferKey,
            itemId: identity.itemId,
            itemName: identity.itemName,
            itemType: identity.itemType,
            ...patch,
            updatedAt: new Date().toISOString()
        };
        const nextData = (Array.isArray(records) ? records : []).filter((record) => (
            !isDuplicateItemOverrideRecord(record, identity, existing)
        ));
        nextData.push(nextRecord);
        nextData.sort((left, right) => {
            const actorSort = String(left.actorName || left.characterName || '').localeCompare(String(right.actorName || right.characterName || ''), 'it');
            if (actorSort !== 0) return actorSort;
            return String(left.itemName || '').localeCompare(String(right.itemName || ''), 'it');
        });
        return nextData;
    }

    function isDuplicateItemOverrideRecord(record, identity, existing) {
        if (!record || typeof record !== 'object') return true;
        if (record === existing) return true;
        if (record.key === identity.key || record.id === identity.key) return true;
        if (record.transferId && identity.transferId && record.transferId === identity.transferId) return true;
        const sameCharacter = Boolean(record.characterId && identity.characterId && record.characterId === identity.characterId)
            || Boolean(record.actorId && identity.actorId && record.actorId === identity.actorId)
            || Boolean(record.actorName && identity.actorName && normalizeText(record.actorName) === normalizeText(identity.actorName));
        if (!sameCharacter) return false;
        if (record.transferKey && identity.transferKey && record.transferKey === identity.transferKey) return true;
        if (record.sourceId && identity.sourceId && normalizeText(record.sourceId) === normalizeText(identity.sourceId)) return true;
        if (record.actorId && identity.actorId && record.actorId === identity.actorId && record.itemId && identity.itemId && record.itemId === identity.itemId) return true;
        return normalizeText(record.actorName) === normalizeText(identity.actorName)
            && normalizeText(record.itemName) === normalizeText(identity.itemName);
    }

    async function saveItemOverride(identity, patch) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per salvare override inventario.');
            return false;
        }

        const saved = await saveVersionedCollection({
            load: loadItemOverridesDocumentForSave,
            url: getItemOverridesApiUrl(),
            token,
            buildData: (records) => upsertItemOverrideRecord(records, identity, patch)
        });
        itemOverridesMemoryCache = saved.data;
        return true;
    }

    async function uploadAbilityOverrideFile(blob, identity) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per caricare icone abilità.');
            return '';
        }

        const folder = buildCampaignScopedOverrideFolder('ability-overrides', identity.actorName || identity.characterId || identity.characterName);
        const fileName = `${slugify(identity.abilityName || identity.abilityId || 'abilita')}.webp`;
        const payload = await window.CriptaMedia.uploadBlob(blob, {
            folder,
            fileName,
            token,
            campaignId: getCurrentCampaignId(),
            authError: 'Login richiesto per caricare icone abilita.'
        });
        return payload.path;
    }

    async function uploadItemOverrideFile(blob, identity) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per caricare icone inventario.');
            return '';
        }

        const folder = buildCampaignScopedOverrideFolder('item-overrides', identity.actorName || identity.characterId || identity.characterName);
        const fileName = `${slugify(identity.itemName || identity.itemId || 'oggetto')}.webp`;
        const payload = await window.CriptaMedia.uploadBlob(blob, {
            folder,
            fileName,
            token,
            campaignId: getCurrentCampaignId(),
            authError: 'Login richiesto per caricare icone inventario.'
        });
        return payload.path;
    }

    function getMediaOverridesApiUrl() {
        return window.CriptaApp?.urls?.api?.('api/data/media-overrides') || 'https://sigillo-api.khuzoe.workers.dev/api/data/media-overrides';
    }

    async function loadMediaOverridesDocumentForSave() {
        const response = await fetch(buildNoStoreApiUrl(getMediaOverridesApiUrl()));
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
        const saved = await saveVersionedCollection({
            load: loadMediaOverridesDocumentForSave,
            url: getMediaOverridesApiUrl(),
            token,
            buildData: (records) => upsertMediaOverrideRecord(records, identity, kind, imagePath)
        });
        mediaOverridesMemoryCache = saved.data;
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
            : `${slugify(identity.entityId || identity.characterId || 'player')}-${kind}.webp`;
        const payload = await window.CriptaMedia.uploadBlob(blob, {
            folder,
            fileName,
            token,
            campaignId: getCurrentCampaignId(),
            authError: 'Login richiesto per caricare immagini.'
        });
        return payload.path;
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

    async function copyInlineCharacterMediaFolder(fromId, toId, token = readAuthToken()) {
        if (!token) throw new Error('Login richiesto per rinominare media NPC.');
        const copyUrl = new URL(window.CriptaApp?.urls?.api?.('media/copy-folder') || 'https://sigillo-api.khuzoe.workers.dev/media/copy-folder');
        copyUrl.searchParams.set('campaign', getCurrentCampaignId());
        const response = await fetch(copyUrl.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                campaignId: getCurrentCampaignId(),
                fromFolder: `characters/${fromId}`,
                toFolder: `characters/${toId}`
            })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
        return payload;
    }

    function rewriteInlineCharacterMediaFolderPaths(character, fromId, toId) {
        const rewrite = (value) => rewriteInlineNpcMediaPath(value, fromId, toId);
        character.images = rewriteInlineObjectStringValues(character.images || {}, rewrite);
        character.blocks = (character.blocks || []).map((block) => ({
            ...block,
            image: rewrite(block.image)
        }));
    }

    function rewriteInlineObjectStringValues(source, rewrite) {
        return Object.fromEntries(Object.entries(source || {}).map(([key, value]) => [
            key,
            typeof value === 'string' ? rewrite(value) : value
        ]));
    }

    function rewriteInlineNpcMediaPath(value, fromId, toId) {
        const raw = String(value || '');
        if (!raw) return raw;
        const campaignId = getCurrentCampaignId();
        const scopedFrom = `media/campaigns/${campaignId}/characters/${fromId}/`;
        const scopedTo = `media/campaigns/${campaignId}/characters/${toId}/`;
        if (raw.startsWith(scopedFrom)) return `${scopedTo}${raw.slice(scopedFrom.length)}`;
        const legacyFrom = `media/characters/${fromId}/`;
        if (raw.startsWith(legacyFrom)) return `${scopedTo}${raw.slice(legacyFrom.length)}`;
        return raw;
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

    function buildNoStoreApiUrl(rawUrl) {
        const url = new URL(rawUrl, window.location.href);
        url.searchParams.set('_', String(Date.now()));
        return url.toString();
    }

    function getCurrentCampaignId() {
        return params.get('campaign') || window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue';
    }

    function buildCampaignScopedOverrideFolder(kind, ownerId) {
        return `${kind}/${slugify(ownerId || 'personaggio')}`;
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

            const config = typeof window.CriptaApp?.data?.json === 'function'
                ? await window.CriptaApp.data.json('next-session.json')
                : await window.CriptaApp.fetchJson(dataUrl('next-session.json'), { clone: true });
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

    function displayError(message) {
        if (editLinkEl) editLinkEl.hidden = true;
        charNameEl.textContent = "Errore";
        container.innerHTML = `<p style="text-align: center; color: var(--status-dead);">${message}</p>`;
    }

    function resolveImagePath(imagePath) {
        const resolved = resolveCharacterAssetPath(imagePath);
        if (currentInlineEditorModule?.isEditing?.()) {
            return currentInlineEditorModule.resolveImagePath(resolved, imagePath, getInlineEditorRuntimeContext());
        }
        return appendAssetVersion(resolved, currentCharacter?.updatedAt);
    }

    function normalizeImageAdjust(adjust) {
        return window.CriptaCharacterNormalize.normalizeImageAdjust(adjust);
    }

    function serializeImageAdjust(adjust) {
        const normalized = normalizeImageAdjust(adjust);
        const rawSize = Number(adjust?.size);
        const result = {};
        if (normalized.x) result.x = normalized.x;
        if (normalized.y) result.y = normalized.y;
        if (Number.isFinite(rawSize) && rawSize > 0) result.size = normalized.size;
        return Object.keys(result).length ? result : null;
    }

    function compactObject(object) {
        return Object.fromEntries(Object.entries(object || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    }

    function buildImageStyle(kind, adjust, counterpartAdjust) {
        return window.CriptaCharacterNormalize.buildNpcImageStyle(kind, adjust, counterpartAdjust);
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
                            <img src="${resolveImagePath(relatedChar.images.idle || relatedChar.images.token || relatedChar.images.avatar)}" alt="${relatedChar.name}" class="npc-img-pop img-main" loading="lazy" decoding="async" style="${buildImageStyle('avatar', relatedChar.images.idleAdjust || relatedChar.images.avatarAdjust, relatedChar.images.hoverAdjust)}" onerror="this.src='${resolveImagePath(relatedChar.images.idleFallback || relatedChar.images.token || relatedChar.images.avatarFallback || '')}'; this.onerror=null;">
                            <img src="${resolveImagePath(relatedChar.images.hover || relatedChar.images.token || relatedChar.images.idle)}" alt="${relatedChar.name} Reveal" class="npc-img-pop img-hover" loading="lazy" decoding="async" style="${buildImageStyle('hover', relatedChar.images.hoverAdjust, relatedChar.images.idleAdjust || relatedChar.images.avatarAdjust)}" onerror="this.src='${resolveImagePath(relatedChar.images.hoverFallback || relatedChar.images.token || relatedChar.images.idleFallback || '')}'; this.onerror=null;">
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

    function renderCharacterPage(character, allCharacters, npcQuests, playerSkillTrees) {
        currentInlineEditorModule?.removeStaleAdjustModal(character, getInlineEditorRuntimeContext());
        const inlineEditing = currentInlineEditorModule?.isEditing?.() === true;
        // Set page title and header
        document.title = `${character.name} | Cripta di Sangue`;
        charNameEl.textContent = character.name;
        charRoleEl.textContent = character.role;
        container.innerHTML = '';

        document.body.classList.toggle('page-character--skill-tree-only', skillTreeOnlyView);
        if (skillTreeOnlyView) {
            renderSkillTreeOnlyPage(character, playerSkillTrees);
            return;
        }

        // Build the main grid structure
        const grid = document.createElement('div');
        grid.className = 'char-grid';

        // Build left (lore) and right (image/stats) columns
        // Build left (lore) and right (image/stats) columns
        const leftCol = document.createElement('div');
        leftCol.className = 'left-col';

        if (charType !== 'player') {
            if (inlineEditing) {
                currentInlineEditorModule?.renderLeftColumn(leftCol, getInlineEditorRuntimeContext());
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

            const transformationsCard = currentTransformationsModule?.buildCard(character, getTransformationRuntimeContext());
            if (transformationsCard) leftCol.appendChild(transformationsCard);

            const skillTreeCard = currentSkillTreeModule?.buildCards(character, playerSkillTrees, getSkillTreeRuntimeContext());
            if (skillTreeCard) leftCol.appendChild(skillTreeCard);
        }

        // Render relationships if they exist
        // MOVED TO getRightColumnHtml
        // if(character.relationships && character.relationships.length > 0) {
        //     leftCol.appendChild(renderRelationships(character.relationships, allCharacters));
        // }

        const rightCol = document.createElement('div');
        rightCol.className = 'right-col';
        rightCol.innerHTML = inlineEditing && charType !== 'player'
            ? currentInlineEditorModule?.getEditableRightColumnHtml(character, getInlineEditorRuntimeContext()) || ''
            : getRightColumnHtml(character, allCharacters, npcQuests);

        grid.appendChild(leftCol);
        grid.appendChild(rightCol);
        container.appendChild(grid);

        if (charType === 'player') {
            currentLoadoutModule?.hydrate(character, getLoadoutRuntimeContext());
        }

        // After rendering everything, initialize modal logic
        initializeImageModal();
    }

    function renderSkillTreeOnlyPage(character, playerSkillTrees) {
        document.title = `Albero Abilita - ${character.name} | Cripta di Sangue`;
        charNameEl.textContent = 'Albero Abilita';
        charRoleEl.textContent = character.name || '';
        editLinkEl.hidden = true;

        const skillTreeCard = currentSkillTreeModule?.buildCards(character, playerSkillTrees, getSkillTreeRuntimeContext());
        if (skillTreeCard) {
            skillTreeCard.classList.add('player-skill-tree-stack--standalone');
            container.appendChild(skillTreeCard);
        } else {
            const empty = document.createElement('div');
            empty.className = 'content-card player-skill-tree-empty';
            empty.innerHTML = '<span>Nessun albero abilita configurato.</span>';
            container.appendChild(empty);
        }

        initializeImageModal();
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
                        periodValue = String(bYear) + ' - ' + String(dYear) + (summary.death_year_note ? ' (' + summary.death_year_note + ')' : '');
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
        } else if (summary.age_at_death) {
            age = summary.age_at_death;
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
                        <div class="character-death-cause">
                            <span class="stat-label">Causa del Decesso</span>
                            <span class="character-death-cause__text">${escapeHtml(summary.cause_of_death)}</span>
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
        const portraitSource = isPlayerView
            ? (images.avatar || images.portrait || '')
            : (images.avatar || images.token || images.idle || '');
        const portraitPrimarySrc = resolveImagePath(portraitSource);
        const portraitFallback = resolveImagePath(images.avatarFallback || images.tokenFallback || images.portraitFallback || '');
        const portraitErrorHandler = portraitFallback
            ? "if(this.dataset.fallbackSrc){this.src=this.dataset.fallbackSrc;this.dataset.fallbackSrc='';}else{this.src='https://placehold.co/400x500/111/333?text=No+Image';}"
            : "this.src='https://placehold.co/400x500/111/333?text=No+Image'";

        return `
                    <div class="image-card">
                        <img src="${portraitPrimarySrc}" data-primary-src="${escapeHtml(portraitPrimarySrc)}" ${portraitFallback ? `data-fallback-src="${escapeHtml(portraitFallback)}"` : ''} class="char-portrait" onerror="${portraitErrorHandler}">
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
        const blockHtml = getRenderableContentBlockHtml(block);
        const wrapMarkdown = (html, extraClass = '') => {
            if (!html) return '';
            const className = extraClass ? `chapter-content ${extraClass}` : 'chapter-content';
            return `<div class="${className}">${html}</div>`;
        };

        // Use a switch to handle different block types
        switch (block.type) {
            case 'lore':
                card.innerHTML = `${hiddenBadge}<h3><i class="fas ${block.icon || 'fa-book-open'}"></i> ${block.title}</h3>${wrapMarkdown(blockHtml)}`;
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
                                <img src="${resolveImagePath(block.image)}" class="elena-img" loading="lazy" decoding="async" onerror="this.style.display='none'">
                                ${wrapMarkdown(blockHtml, 'chapter-content--compact')}
                            </div>
                        </div>`;
                break;

            case 'banner_box':
                card.innerHTML = `
                             ${hiddenBadge}
                             <div class="banner-header">
                                 <img src="${resolveImagePath(block.banner)}" class="banner-img" alt="${block.title}" loading="lazy" decoding="async">
                             </div>
                             <div class="banner-body">
                                 <h3><i class="fas ${block.icon || 'fa-flag'}"></i> ${block.title}</h3>
                                 ${wrapMarkdown(blockHtml)}
                             </div>
                         `;
                break;

            case 'custom_box':
                if (block.borderColor) {
                    card.style.borderColor = block.borderColor;
                }
                card.innerHTML = `${hiddenBadge}<h3><i class="fas ${block.icon || 'fa-box'}"></i> ${block.title}</h3>${wrapMarkdown(blockHtml)}`;
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
                                 <img src="${resolveImagePath(block.image)}" alt="${block.title}" class="doc-image-popup" loading="lazy" decoding="async" onerror="this.style.display='none'">
                                ${block.image_caption ? `<p class="document-caption">${block.image_caption}</p>` : ''}
                            </div>
                            <div class="document-content">
                                ${wrapMarkdown(blockHtml, 'chapter-content--compact')}
                            </div>
                        </div>`;
                break;

            default:
                // Default handler for unknown block types
                card.innerHTML = `${hiddenBadge}<h3>${block.title || 'Informazioni'}</h3>${wrapMarkdown(blockHtml)}`;
        }
        normalizeRenderedInlineMarkdown(card);
        classifyDocumentCardImage(card);
        return card;
    }

    function classifyDocumentCardImage(card) {
        if (!card?.classList?.contains('document-card')) return;
        const image = card.querySelector('.document-image img');
        if (!image) return;
        const apply = () => {
            const width = image.naturalWidth || image.videoWidth || 0;
            const height = image.naturalHeight || image.videoHeight || 0;
            if (!width || !height) return;
            const ratio = height / width;
            card.classList.toggle('document-card--portrait', ratio >= 1.18);
            card.classList.toggle('document-card--tall', ratio >= 1.55);
            card.classList.toggle('document-card--landscape', ratio <= 0.82);
            card.classList.toggle('document-card--squareish', ratio > 0.82 && ratio < 1.18);
        };
        if (image.complete) apply();
        else image.addEventListener('load', apply, { once: true });
    }

    function getRenderableContentBlockHtml(block) {
        const context = getCharacterBlockMarkdownContext(block);
        if (typeof block?.markdownText === 'string' && block.markdownText.trim()) {
            return renderCharacterBlockMarkup(block.markdownText, context);
        }
        if (typeof block?.text === 'string' && block.text.trim()) {
            return renderCharacterBlockMarkup(block.text, context);
        }
        if (typeof block?.markdownHtml === 'string' && block.markdownHtml.trim()) {
            return renderCharacterBlockMarkup(block.markdownHtml, context);
        }
        if (typeof block?.content === 'string' && block.content.trim()) {
            return renderCharacterBlockMarkup(block.content, context);
        }
        return '';
    }

    function normalizeRenderedInlineMarkdown(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!containsInlineMarkdownSyntax(node.textContent || '')) continue;
            nodes.push(node);
        }
        nodes.forEach((node) => {
            const template = document.createElement('template');
            template.innerHTML = window.CriptaMarkdown.renderInline(node.textContent || '');
            node.replaceWith(template.content);
        });
    }
});
