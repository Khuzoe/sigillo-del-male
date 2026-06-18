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
    return window.CriptaMarkdown.render(md, options);
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
    if (looksLikeHtml(source)) return window.CriptaMarkdown.renderInsideHtml(source, { context });
    return window.CriptaMarkdown.render(source, { context });
}

async function loadPlayersData() {
    const payload = typeof window.CriptaApp?.data?.json === 'function'
        ? await window.CriptaApp.data.json('players.json')
        : await window.CriptaApp.fetchJson(dataUrl('players.json'), { clone: true });
    const players = Array.isArray(payload) ? payload : payload?.data;
    const mediaOverrides = await loadMediaOverrides();
    return Array.isArray(players)
        ? normalizeCharactersCollection(players)
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
        if (Array.isArray(players) && findCharacterById(normalizeCharactersCollection(players), charId)) return 'player';
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
        const avatar = appendAssetVersion(getSyncedPlayerImagePath(normalized, 'avatar'), override.updatedAt);
        normalized.images.avatar = avatar;
        normalized.images.portrait = avatar;
    }
    if (images.token) normalized.images.token = appendAssetVersion(getSyncedPlayerImagePath(normalized, 'token'), override.updatedAt);
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
        acc[key] = normalizeSkillTreeNodeIds({
            ...tree,
            id: key,
            name: tree.name || entry.name || entry.title || '',
            ownerCharacterId: tree.ownerCharacterId || entry.ownerCharacterId || entry.characterId || '',
            characterId: tree.characterId || entry.characterId || ''
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
        script.src = new URL('../shared/character-skill-tree.js', baseUrl).toString();
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
        script.src = new URL('../shared/character-transformations.js', baseUrl).toString();
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
        script.src = new URL('../shared/character-loadout.js', baseUrl).toString();
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
        script.src = new URL('../shared/character-inline-editor.js', baseUrl).toString();
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
        return appendAssetVersion(overrideImage, itemOverride.updatedAt);
    }
    if (wikiItem) return '';
    if (overrideImage) return appendAssetVersion(overrideImage, itemOverride.updatedAt);
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
        const avatar = appendAssetVersion(override.images.avatar, override.updatedAt);
        next.img = avatar;
        next._mediaOverrideImages.avatar = avatar;
    }
    if (override.images.token) {
        const token = appendAssetVersion(override.images.token, override.updatedAt);
        next.token.img = token;
        next._mediaOverrideImages.token = token;
    }
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
        const loadoutRole = getLoadoutRole(entry);
        if (loadoutRole === 'ability') {
            abilities.push(entry);
            return;
        }
        if (loadoutRole === 'inventory') {
            inventory.push(entry);
            return;
        }
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

function renderWikiItemThumb(item, className, label = 'Oggetto wiki', defer = false) {
    if (!item) return '';
    const safeLabel = escapeHtml(item.name || label);
    const image = getWikiItemImageUrl(item);
    if (image) {
        const srcAttribute = defer
            ? `data-loadout-lazy-src="${escapeHtml(image)}"`
            : `src="${escapeHtml(image)}"`;
        return `<span class="${escapeHtml(className)}"><img ${srcAttribute} alt="${safeLabel}" loading="lazy" decoding="async"></span>`;
    }
    return `<span class="${escapeHtml(className)}" aria-hidden="true"><i class="fas ${escapeHtml(item.icon || 'fa-wand-sparkles')}"></i></span>`;
}

function renderLoadoutEntryIcon(imagePath, label = 'Elemento Foundry') {
    const image = resolveSyncedActorImagePath(imagePath);
    if (!image) return '';
    const safeLabel = escapeHtml(label || 'Elemento Foundry');
    return `
                <span class="loadout-entry-icon">
                    <img data-loadout-lazy-src="${escapeHtml(image)}" alt="${safeLabel}" loading="lazy" decoding="async" onerror="this.parentElement.remove();">
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

    const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'mark', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'h4', 'h5']);
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

function normalizeCopyText(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function renderDescriptionCopyText(value) {
    const html = renderDescriptionHtml(value);
    if (!html) return '';

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    wrapper.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
    wrapper.querySelectorAll('p, li, h4, h5, blockquote, pre').forEach((node) => {
        node.append(document.createTextNode('\n'));
    });
    return normalizeCopyText(wrapper.innerText || wrapper.textContent || '');
}

function buildWikiItemCopySections(wikiItem, foundryName = '') {
    if (!wikiItem) return [];
    const sections = [];
    const meta = [wikiItem.type, wikiItem.rarity].map((value) => String(value || '').trim()).filter(Boolean);
    if (meta.length) sections.push(meta.join(' | '));

    const normalizedWikiName = normalizeText(wikiItem.name);
    const normalizedFoundryName = normalizeText(foundryName);
    if (normalizedFoundryName && normalizedFoundryName !== normalizedWikiName) {
        sections.push(`Nome Foundry: ${foundryName}`);
    }

    const summary = normalizeCopyText(wikiItem.summary || wikiItem.description || '');
    if (summary) sections.push(summary);

    const properties = Array.isArray(wikiItem.properties) ? wikiItem.properties.filter((property) => property && property.hidden !== true) : [];
    properties.forEach((property) => {
        const name = normalizeCopyText(property.name || '');
        const charges = normalizeCopyText(property.charges || '');
        const description = normalizeCopyText(property.description || '');
        const title = [name, charges ? `(${charges})` : ''].filter(Boolean).join(' ');
        if (title && description) sections.push(`${title}\n${description}`);
        else if (title || description) sections.push(title || description);
    });

    const notes = normalizeCopyText(wikiItem.notes || '');
    if (notes) sections.push(`Note: ${notes}`);
    return sections;
}

function buildLoadoutCopyText(title, quantityLabel, description, badges, wikiItem = null, foundryName = '') {
    const sections = [];
    const heading = [normalizeCopyText(title || 'Elemento senza nome'), normalizeCopyText(quantityLabel || '')].filter(Boolean).join(' ');
    if (heading) sections.push(heading);

    const badgeText = (Array.isArray(badges) ? badges : [])
        .map((badge) => normalizeCopyText(badge))
        .filter(Boolean)
        .join(' | ');
    if (badgeText) sections.push(badgeText);

    if (wikiItem) {
        sections.push(...buildWikiItemCopySections(wikiItem, foundryName));
    } else {
        const descriptionText = renderDescriptionCopyText(description);
        if (descriptionText) sections.push(descriptionText);
    }

    return normalizeCopyText(sections.join('\n\n'));
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
            .sort(compareSpellSlotLevels)
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
            const total = toFiniteNumber(slot.total) || 0;
            const available = toFiniteNumber(slot.available);
            const used = toFiniteNumber(slot.used);
            const shownAvailable = available !== null ? available : Math.max(0, total - (used || 0));
            const isEmpty = shownAvailable <= 0;
            return `
                            <div class="slot-level-tile ${isEmpty ? 'is-empty' : ''}">
                                <span class="slot-level-title">${formatSpellSlotLabel(slot)}</span>
                                <span class="slot-level-ratio">${formatNumberIt(shownAvailable)} / ${formatNumberIt(total)}</span>
                            </div>
                        `;
        }).join('')}
                </div>
                `
        : '';

    return `${slotsSummary}${levelTiles}`;
}

function compareSpellSlotLevels(a, b) {
    const orderA = getSpellSlotSortOrder(a);
    const orderB = getSpellSlotSortOrder(b);
    if (orderA !== orderB) return orderA - orderB;
    return String(a?.slot || a?.level || '').localeCompare(String(b?.slot || b?.level || ''));
}

function getSpellSlotSortOrder(slot) {
    if (isPactSpellSlot(slot)) return 10;
    const level = toFiniteNumber(slot?.level);
    return level !== null ? level : 99;
}

function isPactSpellSlot(slot) {
    return String(slot?.slot || '').toLowerCase() === 'pact'
        || String(slot?.level || '').toLowerCase() === 'pact';
}

function formatSpellSlotLabel(slot) {
    if (isPactSpellSlot(slot)) return 'PATTO';
    const level = toFiniteNumber(slot?.level);
    if (level === 0) return 'Trucchetto';
    return `Livello ${level || '?'}`;
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

function renderVitalOverview(actor, options = {}) {
    const hp = getActorHpData(actor);
    const ac = toFiniteNumber(actor && actor.vitals && actor.vitals.ac);
    const initiative = toFiniteNumber(actor && actor.vitals && actor.vitals.initiative);
    const proficiency = toFiniteNumber(actor && actor.vitals && actor.vitals.prof);
    const speed = actor && actor.vitals ? actor.vitals.speed : null;
    const movement = speed && typeof speed === 'object'
        ? [speed.walk ? `${speed.walk} ft` : '', speed.fly ? `volo ${speed.fly} ft` : ''].filter(Boolean).join(' | ')
        : '';

    return `
                <div class="character-live-kpis ${escapeHtml(options.className || '')}">
                    <div class="character-live-kpi character-live-kpi--hp">
                        <span>PF</span>
                        <strong>${formatNumberIt(hp.value)} / ${formatNumberIt(hp.max)}</strong>
                        ${hp.temp ? `<em>+${formatNumberIt(hp.temp)} temp</em>` : ''}
                    </div>
                    <div class="character-live-kpi character-live-kpi--ac">
                        <span>CA</span>
                        <strong>${formatNumberIt(ac)}</strong>
                    </div>
                    <div class="character-live-kpi character-live-kpi--initiative">
                        <span>Iniziativa</span>
                        <strong>${formatSignedNumber(initiative)}</strong>
                    </div>
                    ${proficiency !== null ? `
                    <div class="character-live-kpi character-live-kpi--proficiency">
                        <span>Competenza</span>
                        <strong>${formatSignedNumber(proficiency)}</strong>
                    </div>` : ''}
                    ${movement ? `
                    <div class="character-live-kpi character-live-kpi--movement">
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
            const save = toFiniteNumber(ability.save);
            if (value === null && mod === null && save === null) return '';
            return `
                        <span class="character-ability-pill">
                            <em>${label}</em>
                            <strong>${formatNumberIt(value)}</strong>
                            <small>${formatSignedNumber(mod)} | ${formatSignedNumber(save)}</small>
                        </span>
                    `;
        })
        .filter(Boolean);
    return entries.length ? `<div class="character-ability-grid">${entries.join('')}</div>` : '';
}

function formatSignedNumber(value) {
    const number = toFiniteNumber(value);
    if (number === null) return '-';
    return `${number >= 0 ? '+' : ''}${formatNumberIt(number)}`;
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
    const entries = Object.entries(INVENTORY_CURRENCY_META)
        .map(([key, meta]) => {
            const amount = toFiniteNumber(currency[key]);
            if (amount === null || amount <= 0) return '';
            return `
                <span class="inventory-coin character-currency-coin ${meta.className}" title="${escapeHtml(meta.label)} ${formatNumberIt(amount)}">
                    <i aria-hidden="true"></i>
                    <strong>${escapeHtml(meta.label)}</strong>
                    ${formatNumberIt(amount)}
                </span>
            `;
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
                    ${renderWikiItemThumb(wikiItem, 'loadout-wiki-icon', 'Oggetto wiki', true)}
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
    const copyText = buildLoadoutCopyText(title, quantityLabel, description, badges, wikiItem, foundryName);
    const entryIcon = iconPath
        ? renderLoadoutEntryIcon(iconPath, title || 'Elemento senza nome')
        : (wikiItem
            ? renderWikiItemThumb(wikiItem, 'loadout-entry-icon', title || 'Elemento senza nome', true)
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
                            ${copyText ? `
                            <button type="button" class="loadout-copy-button" data-loadout-copy title="Copia titolo e descrizione" aria-label="Copia titolo e descrizione">
                                <i class="fas fa-copy" aria-hidden="true"></i>
                            </button>` : ''}
                            <span class="loadout-entry-chevron" aria-hidden="true"><i class="fas fa-chevron-down"></i></span>
                        </span>
                    </summary>
                    ${copyText ? `<template data-loadout-copy-template>${escapeHtml(copyText)}</template>` : ''}
                    <div class="loadout-entry-body">
                        ${bodyParts.join('')}
                    </div>
                </details>
            `;
}

function getInventoryProgressData(entry, itemOverride = null) {
    const overrideHasProgress = itemOverride && Object.prototype.hasOwnProperty.call(itemOverride, 'progress');
    const source = overrideHasProgress
        ? (itemOverride.progress && typeof itemOverride.progress === 'object' ? itemOverride.progress : null)
        : entry?.progress && typeof entry.progress === 'object'
            ? entry.progress
            : entry?.system?.progress && typeof entry.system.progress === 'object'
                ? entry.system.progress
                : null;
    if (!source) return null;
    const done = Number(source.done ?? source.value ?? source.current ?? source.completed ?? 0);
    const total = Number(source.total ?? source.max ?? source.target ?? source.required ?? 0);
    if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
    const materials = normalizeInventoryProgressMaterials(
        source.materials || source.requiredMaterials || source.requirements || source.components
    );
    return {
        done: Math.max(0, done),
        total: Math.max(1, total),
        unit: String(source.unit || '').trim(),
        label: String(source.label || source.unit || 'Progresso').trim() || 'Progresso',
        materials,
        crafting: Boolean(source.crafting || source.isCrafting || materials.length)
    };
}

function normalizeInventoryProgressMaterials(materials) {
    const list = Array.isArray(materials)
        ? materials
        : Array.isArray(materials?.items)
            ? materials.items
            : [];
    return list.map((material) => {
        if (typeof material === 'string') {
            const name = material.trim();
            return name ? { name, done: 0, required: 1, unit: '' } : null;
        }
        if (!material || typeof material !== 'object') return null;
        const name = String(material.name || material.label || material.itemName || material.id || '').trim();
        const done = Number(material.done ?? material.value ?? material.current ?? material.available ?? material.owned ?? 0);
        const required = Number(material.required ?? material.total ?? material.quantity ?? material.max ?? material.target ?? 0);
        if (!name && (!Number.isFinite(required) || required <= 0)) return null;
        return {
            id: String(material.id || material.itemId || '').trim(),
            name: name || String(material.id || material.itemId || 'Materiale').trim(),
            done: Number.isFinite(done) ? Math.max(0, done) : 0,
            required: Number.isFinite(required) ? Math.max(0, required) : 0,
            unit: String(material.unit || '').trim()
        };
    }).filter(Boolean);
}

function formatProgressAmount(value, unit = '') {
    const label = formatNumberIt(value, 2);
    const suffix = String(unit || '').trim();
    return suffix ? `${label} ${escapeHtml(suffix)}` : label;
}

function renderInventoryProgress(progressOrEntry, itemOverride = null) {
    const progress = progressOrEntry?.total !== undefined
        ? progressOrEntry
        : getInventoryProgressData(progressOrEntry, itemOverride);
    if (!progress) return '';
    const percent = Math.max(0, Math.min(100, (progress.done / progress.total) * 100));
    const remaining = Math.max(0, progress.total - progress.done);
    return `
        <div class="loadout-progress" data-item-progress>
            <div class="loadout-progress__head">
                <span>${escapeHtml(progress.label)}</span>
                <strong>${formatProgressAmount(progress.done, progress.unit)} / ${formatProgressAmount(progress.total, progress.unit)}</strong>
            </div>
            <div class="loadout-progress__bar" aria-label="${escapeHtml(progress.label)} ${formatNumberIt(progress.done)} su ${formatNumberIt(progress.total)}">
                <span style="width: ${percent.toFixed(2)}%"></span>
            </div>
            <small>${formatProgressAmount(remaining, progress.unit)} rimanenti</small>
        </div>
    `;
}

function renderProgressMaterialsList(materials, extraClass = '') {
    const normalized = normalizeInventoryProgressMaterials(materials);
    if (!normalized.length) return '';
    return `
        <ul class="player-progress-materials ${escapeHtml(extraClass)}">
            ${normalized.map((material) => {
                const required = material.required || 0;
                const done = material.done || 0;
                const percent = required > 0 ? Math.max(0, Math.min(100, (done / required) * 100)) : 0;
                return `
                    <li>
                        <span>${escapeHtml(material.name)}</span>
                        <strong>${formatProgressAmount(done, material.unit)} / ${formatProgressAmount(required, material.unit)}</strong>
                        <i aria-hidden="true"><span style="width: ${percent.toFixed(2)}%"></span></i>
                    </li>
                `;
            }).join('')}
        </ul>
    `;
}

function renderItemProgressEditor(progress) {
    const materialLines = (progress?.materials || [])
        .map((material) => [
            material.name || material.id || '',
            material.done ?? 0,
            material.required ?? 0,
            material.unit || ''
        ].join(' | '))
        .join('\n');
    return `
        <div class="loadout-inline-editor loadout-inline-editor--progress" data-item-progress-editor hidden>
            <div class="loadout-inline-editor-grid">
                <label>
                    <span>Etichetta</span>
                    <input data-item-progress-field="label" value="${escapeHtml(progress?.label || 'Progresso')}">
                </label>
                <label>
                    <span>Unita</span>
                    <input data-item-progress-field="unit" value="${escapeHtml(progress?.unit || '')}">
                </label>
                <label>
                    <span>Fatto</span>
                    <input type="number" step="0.01" min="0" data-item-progress-field="done" value="${escapeHtml(String(progress?.done ?? 0))}">
                </label>
                <label>
                    <span>Totale</span>
                    <input type="number" step="0.01" min="0" data-item-progress-field="total" value="${escapeHtml(String(progress?.total ?? ''))}">
                </label>
            </div>
            <label>
                <span>Materiali richiesti</span>
                <textarea data-item-progress-materials rows="4" placeholder="Nome | ottenuti | richiesti | unita">${escapeHtml(materialLines)}</textarea>
            </label>
            <div class="loadout-inline-editor__actions">
                <button type="button" class="loadout-entry-action loadout-entry-action--primary" data-item-progress-save>
                    Salva progresso
                </button>
                <button type="button" class="loadout-entry-action" data-item-progress-clear>
                    Rimuovi progresso
                </button>
                <button type="button" class="loadout-entry-action" data-item-progress-cancel>
                    Annulla
                </button>
            </div>
        </div>
    `;
}

function parseProgressMaterialsText(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const parts = line.split('|').map((part) => part.trim());
            const name = parts[0] || '';
            const done = Number(parts[1] || 0);
            const required = Number(parts[2] || 0);
            const unit = parts[3] || '';
            if (!name && (!Number.isFinite(required) || required <= 0)) return null;
            return {
                name,
                done: Number.isFinite(done) ? Math.max(0, done) : 0,
                required: Number.isFinite(required) ? Math.max(0, required) : 0,
                unit
            };
        })
        .filter(Boolean);
}

function collectItemProgressEditorDraft(editor) {
    const getField = (name) => String(editor?.querySelector(`[data-item-progress-field="${name}"]`)?.value || '').trim();
    const done = Number(getField('done') || 0);
    const total = Number(getField('total') || 0);
    if (!Number.isFinite(total) || total <= 0) return null;
    return {
        label: getField('label') || 'Progresso',
        done: Number.isFinite(done) ? Math.max(0, done) : 0,
        total: Math.max(1, total),
        unit: getField('unit'),
        materials: parseProgressMaterialsText(editor?.querySelector('[data-item-progress-materials]')?.value || '')
    };
}

function renderPlayerProgressSection(entries, context = {}) {
    const { character = null, actor = null, itemOverrides = [] } = context;
    const rows = (Array.isArray(entries) ? entries : [])
        .map((entry) => {
            const identity = getItemOverrideIdentity(character, actor, entry);
            const itemOverride = findItemOverride(itemOverrides, identity);
            const progress = getInventoryProgressData(entry, itemOverride);
            if (!progress) return '';
            const percent = Math.max(0, Math.min(100, (progress.done / progress.total) * 100));
            const remaining = Math.max(0, progress.total - progress.done);
            const progressJson = JSON.stringify(progress);
            return `
                <article class="player-progress-item ${progress.crafting ? 'is-crafting' : ''}" data-progress-item-key="${escapeHtml(identity.key)}">
                    <header>
                        <div>
                            <strong>${escapeHtml(entry.name || 'Oggetto senza nome')}</strong>
                            <span>${escapeHtml(progress.crafting ? 'Craft' : progress.label)}</span>
                        </div>
                        <div class="player-progress-item-actions">
                            <em>${formatProgressAmount(progress.done, progress.unit)} / ${formatProgressAmount(progress.total, progress.unit)}</em>
                            <button type="button" class="player-progress-jump" data-progress-jump-key="${escapeHtml(identity.key)}">Apri</button>
                        </div>
                    </header>
                    <div class="loadout-progress__bar" aria-label="${escapeHtml(progress.label)} ${formatNumberIt(progress.done)} su ${formatNumberIt(progress.total)}">
                        <span style="width: ${percent.toFixed(2)}%"></span>
                    </div>
                    <small>${formatProgressAmount(remaining, progress.unit)} rimanenti</small>
                    ${renderProgressMaterialsList(progress.materials)}
                    <form class="player-progress-increment" data-progress-increment-form data-progress-json="${escapeHtml(progressJson)}">
                        <input type="number" step="0.01" min="0" data-progress-increment-value aria-label="Aggiungi progresso a ${escapeHtml(entry.name || 'oggetto')}">
                        <button type="submit" data-progress-increment-submit
                            data-item-key="${escapeHtml(identity.key)}"
                            data-character-id="${escapeHtml(identity.characterId)}"
                            data-character-name="${escapeHtml(identity.characterName)}"
                            data-actor-id="${escapeHtml(identity.actorId)}"
                            data-actor-name="${escapeHtml(identity.actorName)}"
                            data-item-uuid="${escapeHtml(identity.itemUuid)}"
                            data-transfer-id="${escapeHtml(identity.transferId)}"
                            data-source-id="${escapeHtml(identity.sourceId)}"
                            data-transfer-key="${escapeHtml(identity.transferKey)}"
                            data-item-id="${escapeHtml(identity.itemId)}"
                            data-item-name="${escapeHtml(identity.itemName)}"
                            data-item-type="${escapeHtml(identity.itemType)}"
                        >+</button>
                    </form>
                </article>
            `;
        })
        .filter(Boolean)
        .join('');

    return `
        <section class="player-progress-section">
            <h4>Progressi</h4>
            ${rows ? `<div class="player-progress-list">${rows}</div>` : '<p class="loadout-empty">Nessun oggetto con progresso registrato.</p>'}
        </section>
    `;
}

const INVENTORY_CURRENCY_META = {
    pp: { label: 'PP', className: 'coin--pp' },
    gp: { label: 'MO', className: 'coin--gp' },
    ep: { label: 'ME', className: 'coin--ep' },
    sp: { label: 'MA', className: 'coin--sp' },
    cp: { label: 'MR', className: 'coin--cp' }
};

function renderInventoryCurrency(currency) {
    if (!currency || typeof currency !== 'object') return '';
    const coins = Object.entries(INVENTORY_CURRENCY_META)
        .map(([key, meta]) => {
            const amount = toFiniteNumber(currency[key]);
            if (amount === null || amount <= 0) return '';
            return `
                <span class="inventory-coin ${meta.className}" title="${escapeHtml(meta.label)} ${formatNumberIt(amount)}">
                    <i aria-hidden="true"></i>
                    <strong>${escapeHtml(meta.label)}</strong>
                    ${formatNumberIt(amount)}
                </span>
            `;
        })
        .filter(Boolean)
        .join('');
    return coins ? `<span class="inventory-container-currency">${coins}</span>` : '';
}

function renderInventoryCapacity(capacity) {
    if (!capacity || typeof capacity !== 'object') return '';
    const used = toFiniteNumber(capacity.used);
    const max = toFiniteNumber(capacity.max);
    if (used === null && max === null) return '';
    const unit = String(capacity.unit || '').trim();
    const text = max !== null
        ? `${formatNumberIt(used ?? 0)} / ${formatNumberIt(max)}${unit ? ` ${unit}` : ''}`
        : `${formatNumberIt(used)}${unit ? ` ${unit}` : ''}`;
    const percent = used !== null && max !== null && max > 0
        ? Math.max(0, Math.min(100, (used / max) * 100))
        : null;
    return `
        <span class="inventory-container-capacity" title="Capienza occupata">
            <span class="inventory-container-capacity__text">${escapeHtml(text)}</span>
            ${percent !== null ? `<span class="inventory-container-capacity__bar"><i style="width: ${percent.toFixed(2)}%"></i></span>` : ''}
        </span>
    `;
}

function getInventoryContainerDetails(group, entries) {
    if (!group || group.isLoose) return null;
    const groupId = String(group.id || '').trim();
    const groupName = normalizeText(group.name || '');
    return (Array.isArray(entries) ? entries : []).find((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        if (groupId && String(entry.id || '').trim() === groupId) return true;
        if (groupId && String(entry._id || '').trim() === groupId) return true;
        if (groupId && String(entry.itemId || '').trim() === groupId) return true;
        return groupName && normalizeText(entry.name || '') === groupName;
    }) || null;
}

function getInventoryContainerCapacity(entry) {
    return entry?.capacity
        || (entry?.container && typeof entry.container === 'object' ? entry.container.capacity : null)
        || null;
}

function getInventoryContainerCurrency(entry) {
    return entry?.currency
        || (entry?.container && typeof entry.container === 'object' ? entry.container.currency : null)
        || null;
}

function getInventoryContainerGroup(entry) {
    const container = entry?.container && typeof entry.container === 'object' ? entry.container : null;
    const rawId = String(container?.id ?? '').trim();
    const rawName = String(container?.name ?? '').trim();
    const normalizedName = normalizeText(rawName);
    const looseNames = new Set(['', 'senzacontenitore', 'nessuncontenitore', 'none', 'null', 'undefined']);
    const looseIds = new Set(['', 'none', 'null', 'undefined', '__loose__']);
    const isLoose = looseIds.has(rawId.toLowerCase()) || looseNames.has(normalizedName);
    if (isLoose) {
        return { id: '__loose__', name: 'Senza contenitore', isLoose: true };
    }
    const id = rawId || `container:${normalizedName || 'sconosciuto'}`;
    return {
        id,
        name: rawName || 'Contenitore',
        isLoose: false
    };
}

function renderInventoryEntries(entries, context = {}) {
    if (!entries.length) {
        return '<p class="loadout-empty">Nessun oggetto disponibile.</p>';
    }

    const { character = null, actor = null, itemOverrides = [] } = context;
    const groupsMap = new Map();
    entries.forEach((entry) => {
        const containerGroup = getInventoryContainerGroup(entry);
        const containerId = containerGroup.id;

        if (!groupsMap.has(containerId)) {
            groupsMap.set(containerId, {
                id: containerId,
                name: containerGroup.name,
                isLoose: containerGroup.isLoose,
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
        const containerEntry = getInventoryContainerDetails(group, entries);
        const containerMetaHtml = [
            renderInventoryCapacity(getInventoryContainerCapacity(containerEntry)),
            renderInventoryCurrency(getInventoryContainerCurrency(containerEntry))
        ].filter(Boolean).join('');
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

            const progress = getInventoryProgressData(entry, itemOverride);
            if (progress) badges.push(progress.crafting ? 'Craft' : 'Progresso');
            const description = cleanDescription(itemOverride?.description || entry.description);
            const quantityLabel = getQuantityLabel(entry);
            const overrideDescriptionHtml = itemOverride?.description && wikiItem
                ? `<div class="loadout-entry-description">${renderDescriptionHtml(cleanDescription(itemOverride.description))}</div>`
                : '';
            const progressHtml = renderInventoryProgress(progress);
            const overrideActions = `
                    ${progressHtml}
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
                            data-item-uuid="${escapeHtml(identity.itemUuid)}"
                            data-transfer-id="${escapeHtml(identity.transferId)}"
                            data-source-id="${escapeHtml(identity.sourceId)}"
                            data-transfer-key="${escapeHtml(identity.transferKey)}"
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
                            data-item-uuid="${escapeHtml(identity.itemUuid)}"
                            data-transfer-id="${escapeHtml(identity.transferId)}"
                            data-source-id="${escapeHtml(identity.sourceId)}"
                            data-transfer-key="${escapeHtml(identity.transferKey)}"
                            data-item-id="${escapeHtml(identity.itemId)}"
                            data-item-name="${escapeHtml(identity.itemName)}"
                            data-item-type="${escapeHtml(identity.itemType)}"
                            data-current-description="${escapeHtml(description)}"
                        >
                            <i class="fas fa-pen" aria-hidden="true"></i>
                            Modifica testo
                        </button>
                        <button
                            type="button"
                            class="loadout-entry-action"
                            data-item-progress-edit
                            data-item-key="${escapeHtml(identity.key)}"
                            data-character-id="${escapeHtml(identity.characterId)}"
                            data-character-name="${escapeHtml(identity.characterName)}"
                            data-actor-id="${escapeHtml(identity.actorId)}"
                            data-actor-name="${escapeHtml(identity.actorName)}"
                            data-item-uuid="${escapeHtml(identity.itemUuid)}"
                            data-transfer-id="${escapeHtml(identity.transferId)}"
                            data-source-id="${escapeHtml(identity.sourceId)}"
                            data-transfer-key="${escapeHtml(identity.transferKey)}"
                            data-item-id="${escapeHtml(identity.itemId)}"
                            data-item-name="${escapeHtml(identity.itemName)}"
                            data-item-type="${escapeHtml(identity.itemType)}"
                        >
                            Progresso
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
                    ${renderItemProgressEditor(progress)}
                `;

            return renderLoadoutDisclosure(
                wikiItem?.name || entry.name || 'Oggetto senza nome',
                quantityLabel,
                description,
                badges,
                wikiItem ? 'loadout-entry--wiki-linked' : '',
                `data-inventory-type="${typeMeta.key}" data-inventory-item-key="${escapeHtml(identity.key)}"`,
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
                            ${containerMetaHtml ? `<div class="inventory-container-meta">${containerMetaHtml}</div>` : ''}
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
        const badges = [getLoadoutAbilityLabel(entry)];
        const identity = getAbilityOverrideIdentity(character, actor, entry);
        const abilityOverride = findAbilityOverride(abilityOverrides, identity);
        if (entry.type && entry.type !== 'feat') badges.push(formatToken(entry.type));
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
            `data-ability-entry-key="${escapeHtml(identity.key)}"`,
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
                ${renderPlayerProgressSection(inventory, { character, actor, itemOverrides })}
            `;
}

function renderCompanionFeatures(entries) {
    const features = (Array.isArray(entries) ? entries : [])
        .filter((entry) => entry && (entry.type === 'feat' || getLoadoutRole(entry) === 'ability'))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'it'));
    if (!features.length) return '<p class="loadout-empty">Nessuna azione o tratto sincronizzato.</p>';
    return features.map((entry) => {
        const badges = [getLoadoutAbilityLabel(entry) === 'Attacco' ? 'Attacco' : 'Feature'];
        if (entry.type && entry.type !== 'feat') badges.push(formatToken(entry.type));
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
            const imageFallbacks = imageCandidates.slice(1);
            const tokenCandidates = getCompanionTokenImageCandidates(companion);
            const tokenImage = tokenCandidates[0] || '';
            const tokenFallbacks = tokenCandidates.slice(1);
            const fallbackAttr = imageFallbacks.length
                ? `data-fallback-srcs="${escapeHtml(encodeURIComponent(JSON.stringify(imageFallbacks)))}"`
                : '';
            const tokenFallbackAttr = tokenFallbacks.length
                ? `data-fallback-srcs="${escapeHtml(encodeURIComponent(JSON.stringify(tokenFallbacks)))}"`
                : '';
            const imageErrorHandler = imageFallbacks.length
                ? `try{const l=JSON.parse(decodeURIComponent(this.dataset.fallbackSrcs||'%5B%5D'));const n=l.shift();this.dataset.fallbackSrcs=encodeURIComponent(JSON.stringify(l));if(n){this.src=n;}else{this.style.display='none';this.nextElementSibling.hidden=false;}}catch(_){this.style.display='none';this.nextElementSibling.hidden=false;}`
                : `this.style.display='none';this.nextElementSibling.hidden=false;`;
            const tokenErrorHandler = tokenFallbacks.length
                ? `try{const l=JSON.parse(decodeURIComponent(this.dataset.fallbackSrcs||'%5B%5D'));const n=l.shift();this.dataset.fallbackSrcs=encodeURIComponent(JSON.stringify(l));if(n){this.src=n;}else{this.style.display='none';}}catch(_){this.style.display='none';}`
                : `this.style.display='none';`;
            const initials = String(title || '?').trim().charAt(0).toUpperCase() || '?';
            const { inventory, spells, abilities } = splitActorLoadout(companion);
            inventory.forEach((entry) => {
                entry.wikiItem = findWikiItemForInventoryEntry(entry, wikiItemIndex);
            });
            const featuresHtml = renderCompanionFeatures(abilities);
            const inventoryHtml = renderInventoryEntries(inventory);
            const spellsHtml = renderSpellEntries(spells.filter((spell) => spell.prepared || spell.level === 0));
            const details = companion.details || {};
            const companionTreeSubject = getCompanionSkillTreeSubject(character, companion, identity);
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
                                            ${renderVitalOverview(companion, { className: 'character-live-kpis--companion' })}
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
                                ${tokenImage ? `<img class="companion-card__token doc-image-popup" src="${escapeHtml(tokenImage)}" ${tokenFallbackAttr} alt="Token ${escapeHtml(title)}" loading="lazy" decoding="async" onerror="${tokenErrorHandler}">` : ''}
                                <div class="companion-card__image-stage">
                                    ${image ? `<img class="doc-image-popup" src="${escapeHtml(image)}" ${fallbackAttr} alt="${escapeHtml(title)}" loading="lazy" decoding="async" onerror="${imageErrorHandler}">` : ''}
                                    <span ${image ? 'hidden' : ''}>${escapeHtml(initials)}</span>
                                </div>
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
                        <details class="companion-collapsible-panel">
                            <summary><i class="fas fa-crown"></i> Albero abilità</summary>
                            <div class="companion-skill-tree-host" data-companion-skill-tree-host="${escapeHtml(companionTreeSubject.id)}"></div>
                        </details>
                        <details class="companion-collapsible-panel">
                            <summary><i class="fas fa-masks-theater"></i> Token e trasformazioni</summary>
                            <div class="companion-transformations-host" data-companion-transformations-host="${escapeHtml(companionTreeSubject.id)}"></div>
                        </details>
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

function mountCompanionSkillTrees(root, character, payload, mediaOverrides = [], allSkillTrees = null, skillTreeModule = null, skillTreeContext = null) {
    if (!root || !character || !allSkillTrees || !skillTreeModule) return;
    const companions = getCompanionsForCharacter(payload, character);
    companions.forEach((rawCompanion) => {
        const identity = getCompanionMediaOverrideIdentity(character, rawCompanion);
        const companion = applyCompanionMediaOverride(rawCompanion, identity, mediaOverrides);
        const subject = getCompanionSkillTreeSubject(character, companion, identity);
        const host = root.querySelector(`[data-companion-skill-tree-host="${CSS.escape(subject.id)}"]`);
        if (!host) return;
        const treeCard = skillTreeModule.buildCards(subject, allSkillTrees, skillTreeContext || {});
        if (treeCard) host.replaceChildren(treeCard);
    });
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

function hydrateDeferredLoadoutImages(scope) {
    if (!scope) return;
    scope.querySelectorAll('img[data-loadout-lazy-src]').forEach((image) => {
        const src = image.dataset.loadoutLazySrc || '';
        if (!src) return;
        image.src = src;
        image.removeAttribute('data-loadout-lazy-src');
    });
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
            if (isActive) hydrateDeferredLoadoutImages(panel);
        });
    };

    tabButtons.forEach((button) => {
        button.addEventListener('click', () => {
            setActivePanel(button.dataset.panelTarget);
        });
    });

    initializeInventoryTypeFilters(cardElement);
    initializeSpellLevelFilters(cardElement);
    hydrateDeferredLoadoutImages(cardElement.querySelector('.loadout-panel.is-active'));
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
            normalizeText,
            pickInlineImageFile,
            cropAbilityIconFileToWebpBlob,
            uploadAbilityOverrideFile,
            uploadItemOverrideFile,
            saveAbilityOverride,
            saveItemOverride,
            getTransferableItemKey,
            collectItemProgressEditorDraft,
            normalizeInventoryProgressMaterials,
            loadInventoryData,
            loadWikiItemsData,
            loadAbilityOverrides,
            loadItemOverrides,
            loadMediaOverrides,
            buildPlayerLoadoutHtml,
            initializeLoadoutTabs,
            initializeLoadoutCopyButtons,
            buildCompanionsHtml,
            canEditCurrentPlayerTransformations,
            mountCompanionSkillTrees,
            getSkillTreeRuntimeContext,
            getTransformationRuntimeContext,
            hydratePlayerRightOverview,
            renderPlayerXpSidebarError
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
        if (window.NPC_DATA && window.NPC_DATA.length > 0) {
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
        const portraitSource = isPlayerView
            ? (images.avatar || images.portrait || '')
            : (images.avatar || images.token || images.idle || '');
        const portraitFallback = resolveImagePath(images.avatarFallback || images.tokenFallback || images.portraitFallback || '');
        const portraitErrorHandler = portraitFallback
            ? "if(this.dataset.fallbackSrc){this.src=this.dataset.fallbackSrc;this.dataset.fallbackSrc='';}else{this.src='https://placehold.co/400x500/111/333?text=No+Image';}"
            : "this.src='https://placehold.co/400x500/111/333?text=No+Image'";

        return `
                    <div class="image-card">
                        <img src="${resolveImagePath(portraitSource)}" ${portraitFallback ? `data-fallback-src="${escapeHtml(portraitFallback)}"` : ''} class="char-portrait" onerror="${portraitErrorHandler}">
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


