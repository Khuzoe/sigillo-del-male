(function () {
    let loadoutRuntime = {};
    let currentPlayerSkillTrees = null;
    let currentSkillTreeModule = null;
    let currentTransformationsModule = null;

    function applyLoadoutRuntime(context = {}) {
        loadoutRuntime = context || {};
        currentPlayerSkillTrees = loadoutRuntime.currentPlayerSkillTrees || null;
        currentSkillTreeModule = loadoutRuntime.currentSkillTreeModule || null;
        currentTransformationsModule = loadoutRuntime.currentTransformationsModule || null;
    }

    function normalizeText(value) {
        if (typeof loadoutRuntime.normalizeText === 'function') return loadoutRuntime.normalizeText(value);
        return window.CriptaApp?.utils?.normalizeKey?.(value) || String(value ?? '').trim().toLowerCase();
    }

    function escapeHtml(value) {
        if (typeof loadoutRuntime.escapeHtml === 'function') return loadoutRuntime.escapeHtml(value);
        return window.CriptaApp?.utils?.escapeHtml?.(value) || String(value ?? '');
    }

    function callRuntime(name, fallback, ...args) {
        const fn = loadoutRuntime[name];
        return typeof fn === 'function' ? fn(...args) : fallback;
    }

    function runtimeSet(name, fallbackValues = []) {
        const value = loadoutRuntime[name];
        if (value instanceof Set) return value;
        if (Array.isArray(value)) return new Set(value);
        return new Set(fallbackValues);
    }

    function formatToken(value) { return callRuntime('formatToken', String(value || ''), value); }
    function isHiddenInventoryEntry(entry) { return Boolean(callRuntime('isHiddenInventoryEntry', false, entry)); }
    function getLoadoutRole(entry) { return callRuntime('getLoadoutRole', '', entry); }
    function getLoadoutSubtype(entry) { return callRuntime('getLoadoutSubtype', '', entry); }
    function getLoadoutAbilityLabel(entry) { return callRuntime('getLoadoutAbilityLabel', '', entry); }
    function findPlayerActor(payload, character) { return callRuntime('findPlayerActor', null, payload, character); }
    function getCompanionsForCharacter(payload, character) { return callRuntime('getCompanionsForCharacter', [], payload, character); }
    function resolveSyncedActorImagePath(path) { return callRuntime('resolveSyncedActorImagePath', String(path || ''), path); }
    function getAvatarVariantPath(path) { return callRuntime('getAvatarVariantPath', '', path); }
    function getAbilityOverrideIdentity(character, actor, entry) { return callRuntime('getAbilityOverrideIdentity', null, character, actor, entry); }
    function getItemOverrideIdentity(character, actor, entry) { return callRuntime('getItemOverrideIdentity', null, character, actor, entry); }
    function findAbilityOverride(records, identity) { return callRuntime('findAbilityOverride', null, records, identity); }
    function findItemOverride(records, identity) { return callRuntime('findItemOverride', null, records, identity); }
    function getInventoryEntryIconPath(entry, wikiItem, itemOverride) { return callRuntime('getInventoryEntryIconPath', entry?.img || wikiItem?.image || itemOverride?.image || '', entry, wikiItem, itemOverride); }
    function buildReadableAssetSlug(...parts) { return callRuntime('buildReadableAssetSlug', parts.filter(Boolean).join('-'), ...parts); }
    function getCompanionReadableEntityId(ownerCharacterId, companion) { return callRuntime('getCompanionReadableEntityId', '', ownerCharacterId, companion); }
    function getCompanionAvatarImageCandidates(companion) { return callRuntime('getCompanionAvatarImageCandidates', [], companion); }
    function getCompanionTokenImageCandidates(companion) { return callRuntime('getCompanionTokenImageCandidates', [], companion); }
    function getCompanionMediaOverrideIdentity(character, companion) { return callRuntime('getCompanionMediaOverrideIdentity', null, character, companion); }
    function getCompanionSkillTreeSubject(character, companion, identity) { return callRuntime('getCompanionSkillTreeSubject', null, character, companion, identity); }
    function applyCompanionMediaOverride(companion, identity, overrides) { return callRuntime('applyCompanionMediaOverride', companion, companion, identity, overrides); }
    function resolveCharacterAssetPath(path) { return callRuntime('resolveCharacterAssetPath', String(path || ''), path); }
    function getInventoryExcludedTypes() {
        return runtimeSet('INVENTORY_EXCLUDED_TYPES', ['class', 'subclass', 'feat', 'background', 'race', 'spell']);
    }

    async function pickInlineImageFile() {
        if (typeof loadoutRuntime.pickInlineImageFile !== 'function') return null;
        return loadoutRuntime.pickInlineImageFile();
    }

    async function cropAbilityIconFileToWebpBlob(file) {
        if (typeof loadoutRuntime.cropAbilityIconFileToWebpBlob !== 'function') throw new Error('Crop icona non disponibile.');
        return loadoutRuntime.cropAbilityIconFileToWebpBlob(file);
    }

    async function uploadAbilityOverrideFile(blob, identity) {
        if (typeof loadoutRuntime.uploadAbilityOverrideFile !== 'function') throw new Error('Upload icona abilita non disponibile.');
        return loadoutRuntime.uploadAbilityOverrideFile(blob, identity);
    }

    async function uploadItemOverrideFile(blob, identity) {
        if (typeof loadoutRuntime.uploadItemOverrideFile !== 'function') throw new Error('Upload icona oggetto non disponibile.');
        return loadoutRuntime.uploadItemOverrideFile(blob, identity);
    }

    async function saveAbilityOverride(identity, patch) {
        if (typeof loadoutRuntime.saveAbilityOverride !== 'function') throw new Error('Salvataggio abilita non disponibile.');
        return loadoutRuntime.saveAbilityOverride(identity, patch);
    }

    async function saveItemOverride(identity, patch) {
        if (typeof loadoutRuntime.saveItemOverride !== 'function') throw new Error('Salvataggio oggetto non disponibile.');
        return loadoutRuntime.saveItemOverride(identity, patch);
    }

    function getTransferableItemKey(input) {
        return typeof loadoutRuntime.getTransferableItemKey === 'function'
            ? loadoutRuntime.getTransferableItemKey(input)
            : '';
    }

    function collectItemProgressEditorDraft(editor) {
        return typeof loadoutRuntime.collectItemProgressEditorDraft === 'function'
            ? loadoutRuntime.collectItemProgressEditorDraft(editor)
            : null;
    }

    function normalizeInventoryProgressMaterials(materials) {
        return typeof loadoutRuntime.normalizeInventoryProgressMaterials === 'function'
            ? loadoutRuntime.normalizeInventoryProgressMaterials(materials)
            : [];
    }

    async function loadInventoryData() { return loadoutRuntime.loadInventoryData?.() || {}; }
    async function loadWikiItemsData() { return loadoutRuntime.loadWikiItemsData?.() || []; }
    async function loadAbilityOverrides() { return loadoutRuntime.loadAbilityOverrides?.() || []; }
    async function loadItemOverrides() { return loadoutRuntime.loadItemOverrides?.() || []; }
    async function loadMediaOverrides() { return loadoutRuntime.loadMediaOverrides?.() || []; }

    function buildPlayerLoadoutHtml(character, payload, wikiItems, abilityOverrides, itemOverrides) {
        return loadoutRuntime.buildPlayerLoadoutHtml?.(character, payload, wikiItems, abilityOverrides, itemOverrides) || '';
    }

    function initializeLoadoutTabs(cardElement) { loadoutRuntime.initializeLoadoutTabs?.(cardElement); }
    function initializeLoadoutCopyButtons(root) { loadoutRuntime.initializeLoadoutCopyButtons?.(root); }

    function buildCompanionsHtml(character, payload, wikiItems, mediaOverrides, options) {
        return loadoutRuntime.buildCompanionsHtml?.(character, payload, wikiItems, mediaOverrides, options) || '';
    }

    function canEditCurrentPlayerTransformations(character) {
        return Boolean(loadoutRuntime.canEditCurrentPlayerTransformations?.(character));
    }

    function mountCompanionSkillTrees(...args) { loadoutRuntime.mountCompanionSkillTrees?.(...args); }
    function getSkillTreeRuntimeContext() { return loadoutRuntime.getSkillTreeRuntimeContext?.() || {}; }
    function getTransformationRuntimeContext() { return loadoutRuntime.getTransformationRuntimeContext?.() || {}; }
    function hydratePlayerRightOverview(character, payload) { loadoutRuntime.hydratePlayerRightOverview?.(character, payload); }
    function renderPlayerXpSidebarError(message) { loadoutRuntime.renderPlayerXpSidebarError?.(message); }


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
            if (!getInventoryExcludedTypes().has(entry.type)) {
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
            return `<span class="${escapeHtml(className)}"><img src="${escapeHtml(image)}" alt="${safeLabel}" loading="eager" decoding="async"></span>`;
        }
        return `<span class="${escapeHtml(className)}" aria-hidden="true"><i class="fas ${escapeHtml(item.icon || 'fa-wand-sparkles')}"></i></span>`;
    }

    function renderLoadoutEntryIcon(imagePath, label = 'Elemento Foundry') {
        const image = resolveSyncedActorImagePath(imagePath);
        if (!image) return '';
        const safeLabel = escapeHtml(label || 'Elemento Foundry');
        return `
                    <span class="loadout-entry-icon">
                        <img src="${escapeHtml(image)}" alt="${safeLabel}" loading="eager" decoding="async" onerror="this.parentElement.remove();">
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

    function getLoadoutEntryRestoreKey(entry) {
        if (!entry) return '';
        if (entry.dataset.inventoryItemKey) return `inventory:${entry.dataset.inventoryItemKey}`;
        if (entry.dataset.abilityEntryKey) return `ability:${entry.dataset.abilityEntryKey}`;
        const panel = entry.closest('.loadout-panel')?.dataset?.panel || '';
        const title = entry.querySelector('.loadout-entry-title span:last-child')?.textContent?.trim() || '';
        return title ? `${panel}:title:${normalizeText(title)}` : '';
    }

    function captureLoadoutRefreshState(trigger = null) {
        const loadoutCard = document.getElementById('player-loadout-card');
        if (!loadoutCard) return null;
        return {
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            activePanel: loadoutCard.querySelector('.loadout-tab.is-active')?.dataset?.panelTarget || 'inventory',
            openEntryKeys: Array.from(loadoutCard.querySelectorAll('.loadout-entry[open]'))
                .map(getLoadoutEntryRestoreKey)
                .filter(Boolean),
            triggerEntryKey: getLoadoutEntryRestoreKey(trigger?.closest?.('.loadout-entry'))
        };
    }

    function restoreLoadoutRefreshState(state) {
        if (!state) return;
        const loadoutCard = document.getElementById('player-loadout-card');
        if (!loadoutCard) return;

        const activePanel = state.activePanel || 'inventory';
        loadoutCard.querySelector(`.loadout-tab[data-panel-target="${CSS.escape(activePanel)}"]`)?.click();

        const keysToOpen = new Set([...(state.openEntryKeys || []), state.triggerEntryKey].filter(Boolean));
        if (keysToOpen.size) {
            loadoutCard.querySelectorAll('.loadout-entry').forEach((entry) => {
                if (keysToOpen.has(getLoadoutEntryRestoreKey(entry))) entry.setAttribute('open', '');
            });
        }

        window.requestAnimationFrame(() => {
            window.scrollTo({ left: state.scrollX || 0, top: state.scrollY || 0, behavior: 'auto' });
        });
    }

    async function hydratePlayerLoadoutPreservingState(character, trigger = null) {
        const state = captureLoadoutRefreshState(trigger);
        await hydratePlayerLoadout(character);
        restoreLoadoutRefreshState(state);
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
                    await hydratePlayerLoadoutPreservingState(character, button);
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
                    await hydratePlayerLoadoutPreservingState(character, button);
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
        const getIdentityFromButton = (button) => {
            const identity = {
                key: button.dataset.itemKey || '',
                characterId: button.dataset.characterId || '',
                characterName: button.dataset.characterName || '',
                actorId: button.dataset.actorId || '',
                actorName: button.dataset.actorName || '',
                itemUuid: button.dataset.itemUuid || '',
                transferId: button.dataset.transferId || '',
                sourceId: button.dataset.sourceId || '',
                transferKey: button.dataset.transferKey || '',
                itemId: button.dataset.itemId || '',
                itemName: button.dataset.itemName || '',
                itemType: button.dataset.itemType || ''
            };
            identity.transferKey = getTransferableItemKey({ ...identity, existingTransferKey: identity.transferKey });
            return identity;
        };

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

        const progressButtons = Array.from(cardElement.querySelectorAll('[data-item-progress-edit]'));
        progressButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const identity = getIdentityFromButton(button);
                if (!identity.key) return;
                const editor = button.closest('.loadout-entry')?.querySelector('[data-item-progress-editor]');
                if (!editor) return;
                editor.hidden = false;
                editor.querySelector('[data-item-progress-field="done"]')?.focus();
            });
        });

        const progressCancelButtons = Array.from(cardElement.querySelectorAll('[data-item-progress-cancel]'));
        progressCancelButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const editor = button.closest('[data-item-progress-editor]');
                if (editor) editor.hidden = true;
            });
        });

        const progressSaveButtons = Array.from(cardElement.querySelectorAll('[data-item-progress-save]'));
        progressSaveButtons.forEach((button) => {
            button.addEventListener('click', async () => {
                const entry = button.closest('.loadout-entry');
                const editButton = entry?.querySelector('[data-item-progress-edit]');
                const editor = button.closest('[data-item-progress-editor]');
                if (!editButton || !editor) return;
                const identity = getIdentityFromButton(editButton);
                if (!identity.key) return;
                const progress = collectItemProgressEditorDraft(editor);
                if (!progress) {
                    alert('Imposta almeno un totale maggiore di zero.');
                    return;
                }

                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    await saveItemOverride(identity, { progress });
                    await hydratePlayerLoadout(character);
                } catch (error) {
                    console.error('Salvataggio progresso inventario fallito:', error);
                    alert(`Salvataggio progresso fallito: ${error?.message || error}`);
                } finally {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            });
        });

        const progressClearButtons = Array.from(cardElement.querySelectorAll('[data-item-progress-clear]'));
        progressClearButtons.forEach((button) => {
            button.addEventListener('click', async () => {
                const entry = button.closest('.loadout-entry');
                const editButton = entry?.querySelector('[data-item-progress-edit]');
                if (!editButton) return;
                const identity = getIdentityFromButton(editButton);
                if (!identity.key) return;
                if (!window.confirm('Rimuovere il progresso wiki da questo oggetto?')) return;

                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    await saveItemOverride(identity, { progress: null });
                    await hydratePlayerLoadout(character);
                } catch (error) {
                    console.error('Rimozione progresso inventario fallita:', error);
                    alert(`Rimozione progresso fallita: ${error?.message || error}`);
                } finally {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            });
        });

        const progressJumpButtons = Array.from(cardElement.querySelectorAll('[data-progress-jump-key]'));
        progressJumpButtons.forEach((button) => {
            button.addEventListener('click', () => {
                jumpToInventoryProgressItem(cardElement, button.dataset.progressJumpKey || '');
            });
        });

        const progressIncrementForms = Array.from(cardElement.querySelectorAll('[data-progress-increment-form]'));
        progressIncrementForms.forEach((form) => {
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const submitButton = form.querySelector('[data-progress-increment-submit]');
                const input = form.querySelector('[data-progress-increment-value]');
                const delta = Number(input?.value || 0);
                if (!submitButton || !Number.isFinite(delta) || delta <= 0) {
                    alert('Inserisci un valore positivo da aggiungere.');
                    return;
                }
                const identity = getIdentityFromButton(submitButton);
                if (!identity.key) return;
                const progress = parseProgressIncrementDraft(form);
                if (!progress) return;
                progress.done = Math.max(0, Number(progress.done || 0) + delta);

                submitButton.disabled = true;
                submitButton.setAttribute('aria-busy', 'true');
                try {
                    await saveItemOverride(identity, { progress });
                    await hydratePlayerLoadout(character);
                } catch (error) {
                    console.error('Incremento progresso inventario fallito:', error);
                    alert(`Incremento progresso fallito: ${error?.message || error}`);
                } finally {
                    submitButton.disabled = false;
                    submitButton.removeAttribute('aria-busy');
                }
            });
        });
    }

    function parseProgressIncrementDraft(form) {
        try {
            const progress = JSON.parse(form?.dataset?.progressJson || '{}');
            if (!progress || typeof progress !== 'object') return null;
            const total = Number(progress.total || 0);
            if (!Number.isFinite(total) || total <= 0) return null;
            return {
                label: String(progress.label || 'Progresso').trim() || 'Progresso',
                done: Number.isFinite(Number(progress.done)) ? Math.max(0, Number(progress.done)) : 0,
                total: Math.max(1, total),
                unit: String(progress.unit || '').trim(),
                crafting: Boolean(progress.crafting || (Array.isArray(progress.materials) && progress.materials.length)),
                materials: normalizeInventoryProgressMaterials(progress.materials)
            };
        } catch (_) {
            return null;
        }
    }

    function jumpToInventoryProgressItem(cardElement, key) {
        const safeKey = String(key || '').trim();
        if (!safeKey || !cardElement) return;
        cardElement.querySelector('[data-panel-target="inventory"]')?.click();
        const target = cardElement.querySelector(`.loadout-entry[data-inventory-item-key="${CSS.escape(safeKey)}"]`);
        if (!target) return;
        target.closest('[data-inventory-group]')?.setAttribute('open', '');
        target.setAttribute('open', '');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('is-jump-highlight');
        window.setTimeout(() => target.classList.remove('is-jump-highlight'), 1400);
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
            const playerActor = findPlayerActor(inventoryPayload, character);
            const managedActorLink = playerActor?.managedActor;
            if (managedActorLink?.worldId && managedActorLink?.actorId) {
                const target = new URL('./managed-actor.html', window.location.href);
                target.searchParams.set('world', managedActorLink.worldId);
                target.searchParams.set('actor', managedActorLink.actorId);
                const campaignId = window.CriptaApp?.campaigns?.currentId?.() || '';
                if (campaignId && campaignId !== 'cripta-di-sangue') target.searchParams.set('campaign', campaignId);
                const managedActorAction = managedActorLink.canEdit === true ? 'Gestisci scheda condivisa' : 'Apri scheda condivisa';
                loadoutCard.insertAdjacentHTML('afterbegin', `<a class="button-gold-outline managed-actor-loadout-link" href="${escapeHtml(`${target.pathname}${target.search}`)}"><i class="fas fa-cloud"></i> ${managedActorAction}</a>`);
            }
            const transformationsCard = document.querySelector(`[data-transformation-subject-id="${CSS.escape(String(character?.id || ''))}"]`);
            if (transformationsCard && currentTransformationsModule?.renderHtml && managedActorLink) {
                const managedCharacter = {
                    ...character,
                    actorId: playerActor?.actorId || character?.actorId || '',
                    managedActor: managedActorLink,
                    images: {
                        ...(character?.images || {}),
                        token: playerActor?.token?.img || character?.images?.token || ''
                    }
                };
                transformationsCard.innerHTML = currentTransformationsModule.renderHtml(managedCharacter, getTransformationRuntimeContext());
            }

            initializeLoadoutTabs(loadoutCard);
            initializeLoadoutCopyButtons(loadoutCard);
            initializeItemOverrideUploads(loadoutCard, character);
            initializeAbilityOverrideUploads(loadoutCard, character);
            if (companionsCard) {
                const companionsHtml = buildCompanionsHtml(character, inventoryPayload, wikiItems, mediaOverrides, {
                    canEdit: canEditCurrentPlayerTransformations(character)
                });
                companionsCard.hidden = !companionsHtml;
                companionsCard.innerHTML = companionsHtml;
                if (companionsHtml) initializeLoadoutCopyButtons(companionsCard);
                if (companionsHtml) mountCompanionSkillTrees(
                    companionsCard,
                    character,
                    inventoryPayload,
                    mediaOverrides,
                    currentPlayerSkillTrees,
                    currentSkillTreeModule,
                    getSkillTreeRuntimeContext()
                );
                if (companionsHtml) currentTransformationsModule?.mountCompanions(
                    companionsCard,
                    character,
                    inventoryPayload,
                    mediaOverrides,
                    getTransformationRuntimeContext()
                );
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

    async function hydrate(character, context = {}) {
        applyLoadoutRuntime(context);
        return hydratePlayerLoadout(character);
    }

    async function hydratePreservingState(character, trigger = null, context = {}) {
        applyLoadoutRuntime(context);
        return hydratePlayerLoadoutPreservingState(character, trigger);
    }

    window.CriptaCharacterLoadout = Object.freeze({
        hydrate,
        hydratePreservingState
    });
})();
