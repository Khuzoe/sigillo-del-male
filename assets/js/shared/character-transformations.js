(function () {
    let transformationRuntime = {};
    let transformationSubjectMap = new Map();
    let currentTransformations = [];
    let currentUserIsDm = false;
    let currentAuthState = null;
    let currentCharacter = null;
    let charType = 'player';
    let container = null;
    let transformationsMemoryCache = null;
    let TRANSFORMATIONS_DATA_URL = '';

    function applyTransformationRuntime(context = {}) {
        transformationRuntime = context || {};
        currentTransformations = Array.isArray(transformationRuntime.currentTransformations)
            ? transformationRuntime.currentTransformations
            : [];
        currentUserIsDm = Boolean(transformationRuntime.currentUserIsDm);
        currentAuthState = transformationRuntime.currentAuthState || null;
        currentCharacter = transformationRuntime.currentCharacter || null;
        charType = transformationRuntime.charType || 'player';
        container = transformationRuntime.container || document;
        TRANSFORMATIONS_DATA_URL = transformationRuntime.TRANSFORMATIONS_DATA_URL || '';
    }

    function setRuntimeTransformations(transformations) {
        if (typeof transformationRuntime.setTransformations === 'function') {
            transformationRuntime.setTransformations(transformations);
        }
    }

    function escapeHtml(value) {
        if (typeof transformationRuntime.escapeHtml === 'function') return transformationRuntime.escapeHtml(value);
        return window.CriptaApp?.utils?.escapeHtml?.(value) || String(value ?? '');
    }

    function normalizeText(value) {
        if (typeof transformationRuntime.normalizeText === 'function') return transformationRuntime.normalizeText(value);
        return window.CriptaApp?.utils?.normalizeKey?.(value) || String(value ?? '').trim().toLowerCase();
    }

    function slugify(value) {
        if (typeof transformationRuntime.slugify === 'function') return transformationRuntime.slugify(value);
        return window.CriptaApp?.utils?.slugify?.(value) || normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function mergeTransformations(baseList, overrideList) {
        if (typeof transformationRuntime.mergeTransformations === 'function') return transformationRuntime.mergeTransformations(baseList, overrideList);
        return [...(Array.isArray(baseList) ? baseList : []), ...(Array.isArray(overrideList) ? overrideList : [])];
    }

    function getCurrentCampaignId() {
        if (typeof transformationRuntime.getCurrentCampaignId === 'function') return transformationRuntime.getCurrentCampaignId();
        return window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue';
    }

    function getSyncedPlayerImagePath(character, variant) {
        return typeof transformationRuntime.getSyncedPlayerImagePath === 'function'
            ? transformationRuntime.getSyncedPlayerImagePath(character, variant)
            : '';
    }

    function resolveCharacterAssetPath(path) {
        return typeof transformationRuntime.resolveCharacterAssetPath === 'function'
            ? transformationRuntime.resolveCharacterAssetPath(path)
            : String(path || '');
    }

    function getCompanionsForCharacter(payload, character) {
        return typeof transformationRuntime.getCompanionsForCharacter === 'function'
            ? transformationRuntime.getCompanionsForCharacter(payload, character)
            : [];
    }

    function getCompanionMediaOverrideIdentity(character, companion) {
        return typeof transformationRuntime.getCompanionMediaOverrideIdentity === 'function'
            ? transformationRuntime.getCompanionMediaOverrideIdentity(character, companion)
            : null;
    }

    function getCompanionSkillTreeSubject(character, companion, identity = null) {
        return typeof transformationRuntime.getCompanionSkillTreeSubject === 'function'
            ? transformationRuntime.getCompanionSkillTreeSubject(character, companion, identity)
            : companion;
    }

    function applyCompanionMediaOverride(companion, identity, overrides = []) {
        return typeof transformationRuntime.applyCompanionMediaOverride === 'function'
            ? transformationRuntime.applyCompanionMediaOverride(companion, identity, overrides)
            : companion;
    }

    function readAuthToken() {
        return typeof transformationRuntime.readAuthToken === 'function'
            ? transformationRuntime.readAuthToken()
            : window.CriptaDiscordAuth?.getToken?.() || '';
    }

    async function pickInlineImageFile() {
        if (typeof transformationRuntime.pickInlineImageFile !== 'function') return null;
        return transformationRuntime.pickInlineImageFile();
    }

    async function convertInlineImageFileToWebpBlob(file) {
        if (typeof transformationRuntime.convertInlineImageFileToWebpBlob !== 'function') throw new Error('Conversione immagine non disponibile.');
        return transformationRuntime.convertInlineImageFileToWebpBlob(file);
    }

    async function saveVersionedCollection(options) {
        if (typeof transformationRuntime.saveVersionedCollection !== 'function') throw new Error('Salvataggio versionato non disponibile.');
        return transformationRuntime.saveVersionedCollection(options);
    }

    function getTransformationsApiUrl() {
        return typeof transformationRuntime.getTransformationsApiUrl === 'function'
            ? transformationRuntime.getTransformationsApiUrl()
            : window.CriptaApp?.urls?.api?.('api/data/transformations') || '';
    }

    function buildNoStoreApiUrl(rawUrl) {
        return typeof transformationRuntime.buildNoStoreApiUrl === 'function'
            ? transformationRuntime.buildNoStoreApiUrl(rawUrl)
            : rawUrl;
    }

    async function loadTransformationsData(options = {}) {
        if (typeof transformationRuntime.loadTransformationsData !== 'function') return currentTransformations;
        const transformations = await transformationRuntime.loadTransformationsData(options);
        currentTransformations = Array.isArray(transformations) ? transformations : [];
        return currentTransformations;
    }

    async function copyTextToClipboard(text) {
        if (typeof transformationRuntime.copyTextToClipboard === 'function') return transformationRuntime.copyTextToClipboard(text);
        return false;
    }

    function registerTransformationSubject(subject) {
        if (subject?.id) transformationSubjectMap.set(String(subject.id), subject);
        return subject;
    }

    function getTransformationSubjectFromButton(button) {
        const card = button?.closest?.('[data-transformation-subject-id]');
        const subjectId = card?.dataset?.transformationSubjectId || '';
        return transformationSubjectMap.get(subjectId) || currentCharacter;
    }

    function buildPlayerTransformationsCard(character) {
        registerTransformationSubject(character);
        const card = document.createElement('div');
        card.className = 'content-card player-transformations-card';
        card.id = `player-transformations-card-${slugify(character?.id || 'player')}`;
        card.dataset.transformationSubjectId = String(character?.id || '');
        card.innerHTML = renderPlayerTransformationsHtml(character);
        return card;
    }

    function mountCompanionTransformations(root, character, payload, mediaOverrides = []) {
        if (!root || !character) return;
        const companions = getCompanionsForCharacter(payload, character);
        companions.forEach((rawCompanion) => {
            const identity = getCompanionMediaOverrideIdentity(character, rawCompanion);
            const companion = applyCompanionMediaOverride(rawCompanion, identity, mediaOverrides);
            const subject = registerTransformationSubject(getCompanionSkillTreeSubject(character, companion, identity));
            const host = root.querySelector(`[data-companion-transformations-host="${CSS.escape(subject.id)}"]`);
            if (!host) return;
            const card = document.createElement('div');
            card.className = 'content-card player-transformations-card companion-transformations-card';
            card.dataset.transformationSubjectId = subject.id;
            card.innerHTML = renderPlayerTransformationsHtml(subject);
            host.replaceChildren(card);
        });
    }

    function getCharacterTransformations(character) {
        const characterId = String(character?.id || '').trim();
        const accountId = String(character?.accountId || '').trim();
        const actorId = String(character?.actorId || '').trim();
        const staticEntries = Array.isArray(character?.transformations) ? character.transformations : [];
        const legacyEntries = mergeTransformations(staticEntries.map((entry) => normalizeTransformationEntry(entry, character)), currentTransformations);
        return mergeTransformations(legacyEntries, getManagedActorTokenVariants(character))
            .filter((entry) => {
                if (!entry?.enabled && entry?.enabled !== undefined) return false;
                const isCompanionEntry = isCompanionTransformationEntry(entry);
                if (character?.isCompanion) {
                    if (characterId && String(entry.characterId || '') === characterId) return true;
                    return Boolean(actorId && String(entry.actorId || '') === actorId);
                }
                if (isCompanionEntry) return false;
                if (characterId && String(entry.characterId || '') === characterId) return true;
                return Boolean(accountId && String(entry.ownerAccountId || '') === accountId);
            })
            .sort((left, right) => String(left.creatureName || left.name || '').localeCompare(String(right.creatureName || right.name || ''), 'it'));
    }

    function getManagedActorTokenVariants(character) {
        const managedActor = character?.managedActor || {};
        const variants = Array.isArray(managedActor?.media?.variants) ? managedActor.media.variants : [];
        return variants.map((variant) => ({
            id: `managed-${managedActor.actorId || character?.actorId || 'actor'}-${variant.id || slugify(variant.name || 'variante')}`,
            characterId: character?.id || '',
            entityType: 'player',
            actorId: managedActor.actorId || character?.actorId || '',
            ownerAccountId: character?.accountId || '',
            ownerDiscordId: character?.discordId || '',
            creatureName: variant.name || 'Variante',
            name: variant.name || 'Variante',
            foundryName: variant.name || 'Variante',
            foundryNames: [variant.name || 'Variante'],
            tokenImage: variant.path || '',
            revision: variant.revision || 1,
            size: variant.width || variant.height || 1,
            switcher: true,
            enabled: true,
            managedActorOwned: true
        })).filter((entry) => entry.tokenImage);
    }

    function preserveVersionedCanonicalImage(canonicalPath, currentPath) {
        const canonical = String(canonicalPath || '').trim();
        const current = String(currentPath || '').trim();
        if (!canonical || !current) return canonical || current;
        const cleanCurrent = current.split(/[?#]/)[0].replace(/^\/+/, '');
        return cleanCurrent === canonical ? current : canonical;
    }

    function getCompanionCanonicalTokenPath(character) {
        const ownerCharacterId = slugify(character?.ownerCharacterId || '');
        const entityId = String(character?.entityId || character?.id || character?.characterId || '')
            .replace(/^companion-/, '')
            .trim();
        if (!ownerCharacterId || !entityId) return '';
        return `media/campaigns/${getCurrentCampaignId()}/companions/${ownerCharacterId}/${entityId}-token.webp`;
    }

    function getBaseTransformationTokenImage(character) {
        const images = character?.images || {};
        const canonicalToken = character?.isCompanion
            ? getCompanionCanonicalTokenPath(character)
            : getSyncedPlayerImagePath(character, 'token');
        const tokenImage = preserveVersionedCanonicalImage(canonicalToken, images.token);
        return tokenImage
            || images.tokenFallback
            || images.avatar
            || images.portrait
            || images.idle
            || '';
    }

    function getBaseTransformationEntry(character, entries = []) {
        if (!entries.length) return null;
        const tokenImage = getBaseTransformationTokenImage(character);
        if (!tokenImage) return null;
        const id = `${character?.id || character?.actorId || 'character'}-base-token`;
        return {
            id,
            characterId: character?.id || '',
            entityType: character?.isCompanion ? 'companion' : 'player',
            isCompanion: Boolean(character?.isCompanion),
            actorId: character?.actorId || '',
            ownerCharacterId: character?.ownerCharacterId || '',
            ownerAccountId: character?.accountId || '',
            ownerDiscordId: character?.discordId || '',
            creatureName: 'Base',
            name: 'Base',
            foundryName: character?.foundryName || character?.name || '',
            foundryNames: [character?.foundryName || character?.name || ''].filter(Boolean),
            tokenImage,
            switcher: true,
            isBaseTransformation: true
        };
    }

    function getDisplayCharacterTransformations(character) {
        const entries = getCharacterTransformations(character);
        const baseEntry = getBaseTransformationEntry(character, entries);
        return baseEntry ? [baseEntry, ...entries] : entries;
    }

    function isCompanionTransformationEntry(entry) {
        return Boolean(entry?.isCompanion)
            || String(entry?.entityType || '') === 'companion'
            || String(entry?.characterId || '').startsWith('companion-')
            || String(entry?.id || '').startsWith('companion-');
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
            entityType: entry?.entityType || (character?.isCompanion ? 'companion' : 'player'),
            isCompanion: Boolean(entry?.isCompanion || character?.isCompanion),
            actorId: entry?.actorId || character?.actorId || '',
            ownerCharacterId: entry?.ownerCharacterId || character?.ownerCharacterId || '',
            ownerAccountId: entry?.ownerAccountId || character?.accountId || '',
            ownerDiscordId: entry?.ownerDiscordId || character?.discordId || '',
            ownerAliases: Array.from(new Set([
                ...(Array.isArray(entry?.ownerAliases) ? entry.ownerAliases : []),
                character?.id,
                character?.characterId,
                character?.name,
                character?.foundryName,
                character?.actorId,
                character?.uuid,
                character?.accountId,
                character?.discordId
            ].filter(Boolean))),
            creatureName,
            foundryNames,
            switcher: entry?.switcher === false ? false : true,
            tokenImage: entry?.tokenImage || '',
            revision: normalizeTransformationRevision(entry?.revision || entry?.imageRevision),
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
        const entries = getDisplayCharacterTransformations(character);
        const canEdit = canEditCurrentPlayerTransformations(character);
        const empty = canEdit
            ? 'Nessuna trasformazione configurata. Aggiungi una creatura e carica il token personalizzato.'
            : 'Nessuna trasformazione configurata.';
        const cards = entries.map((entry) => {
            const title = entry.creatureName || entry.name || entry.foundryName || 'Forma';
            const foundryLabel = (Array.isArray(entry.foundryNames) ? entry.foundryNames : [entry.foundryName]).filter(Boolean).join(', ');
            const image = entry.tokenImage ? appendTransformationRevision(resolveCharacterAssetPath(entry.tokenImage), entry.revision) : '';
            const initials = String(title || '?').trim().charAt(0).toUpperCase() || '?';
            const sizeLabel = entry.size ? `Dimensione token: ${entry.size} x ${entry.size}` : '';
            const isBaseEntry = Boolean(entry.isBaseTransformation);
            const managedByFoundry = Boolean(entry.managedActorOwned);
            const canEditEntry = canEdit && !isBaseEntry && !managedByFoundry;
            return `
                <article class="player-transformation-card ${isBaseEntry ? 'is-base' : ''} ${managedByFoundry ? 'is-managed-actor' : ''}" data-transformation-id="${escapeHtml(entry.id)}">
                    ${isBaseEntry || managedByFoundry ? `
                    <div class="player-transformation-token ${image ? 'has-image' : ''} ${isBaseEntry ? 'is-base' : ''}" title="${managedByFoundry ? 'Variante condivisa tra sito e Foundry' : 'Token base del personaggio'}">
                        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}">` : `<span>${escapeHtml(initials)}</span>`}
                        <small><i class="fas ${managedByFoundry ? 'fa-cloud' : 'fa-home'}"></i> ${managedByFoundry ? 'Condivisa' : 'Base'}</small>
                    </div>
                    ` : `
                    <button type="button" class="player-transformation-token ${image ? 'has-image' : ''}" data-transformation-action="upload" data-transformation-id="${escapeHtml(entry.id)}" ${canEditEntry ? '' : 'disabled'} title="${canEditEntry ? 'Carica token personalizzato' : 'Token personalizzato'}">
                        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}">` : `<span>${escapeHtml(initials)}</span>`}
                        ${canEditEntry ? '<small><i class="fas fa-upload"></i> Cambia</small>' : ''}
                    </button>
                    `}
                    <div class="player-transformation-info">
                        ${canEditEntry ? `
                            <label class="player-transformation-name-field">
                                <span>Creatura Foundry</span>
                                <input type="text" value="${escapeHtml(title)}" data-transformation-name-input data-transformation-id="${escapeHtml(entry.id)}" aria-label="Nome creatura Foundry">
                            </label>
                        ` : `<strong>${escapeHtml(title)}</strong>`}
                        ${canEditEntry ? `
                            <div class="player-transformation-size-fields">
                                <label>
                                    <span>Dimensione token</span>
                                    <input type="text" inputmode="decimal" value="${escapeHtml(formatTransformationSizeInput(entry.size))}" placeholder="auto" data-transformation-size-input data-transformation-id="${escapeHtml(entry.id)}" aria-label="Dimensione token" autocomplete="off">
                                </label>
                            </div>
                        ` : ''}
                        ${foundryLabel ? `<span>Foundry: ${escapeHtml(foundryLabel)}</span>` : ''}
                        ${!canEditEntry && sizeLabel ? `<span>${escapeHtml(sizeLabel)}</span>` : ''}
                        <span class="player-transformation-mode ${entry.switcher === false ? 'is-muted' : ''}">
                            <i class="fas ${managedByFoundry ? 'fa-cloud' : 'fa-retweet'}"></i>
                            ${managedByFoundry ? 'Gestibile dal sito e da Foundry' : (isBaseEntry ? 'Token base' : (entry.switcher === false ? 'Non nel Tokenizer' : 'Disponibile nel Tokenizer'))}
                        </span>
                    </div>
                    ${canEditEntry ? `
                        <div class="player-transformation-actions">
                            <button type="button" data-transformation-action="rename" data-transformation-id="${escapeHtml(entry.id)}">Salva dati</button>
                            ${foundryLabel ? `<button type="button" data-transformation-action="copy-foundry-name" data-transformation-id="${escapeHtml(entry.id)}">Copia nome Foundry</button>` : ''}
                            <button type="button" data-transformation-action="toggle-switcher" data-transformation-id="${escapeHtml(entry.id)}">${entry.switcher === false ? 'Attiva Tokenizer' : 'Disattiva Tokenizer'}</button>
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
                    <p>Le nuove varianti arrivano da Khuzoe Tokenizer e si modificano in Foundry; le trasformazioni legacy restano disponibili durante la transizione.</p>
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
        const subject = getTransformationSubjectFromButton(button);
        if (!subject) return;
        const action = button.dataset.transformationAction;
        const id = button.dataset.transformationId || '';
        if (!canEditCurrentPlayerTransformations(subject)) {
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
            }, subject);
            await savePlayerTransformationList(subject, upsertTransformation(getCharacterTransformations(subject), entry));
            return;
        }

        const list = getCharacterTransformations(subject);
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
            await savePlayerTransformationList(subject, upsertTransformation(list, nextEntry));
            return;
        }

        if (action === 'upload') {
            const file = await pickInlineImageFile();
            if (!file) return;
            const path = await uploadTransformationTokenImage(file, entry, subject);
            if (!path) return;
            await savePlayerTransformationList(subject, upsertTransformation(list, {
                ...entry,
                tokenImage: path,
                revision: nextTransformationRevision(entry.revision),
                updatedAt: new Date().toISOString()
            }));
            return;
        }

        if (action === 'clear') {
            await savePlayerTransformationList(subject, upsertTransformation(list, {
                ...entry,
                tokenImage: '',
                revision: nextTransformationRevision(entry.revision),
                updatedAt: new Date().toISOString()
            }));
            return;
        }

        if (action === 'toggle-switcher') {
            await savePlayerTransformationList(subject, upsertTransformation(list, {
                ...entry,
                switcher: entry.switcher === false,
                updatedAt: new Date().toISOString()
            }));
            return;
        }

        if (action === 'remove') {
            if (!window.confirm(`Rimuovere "${entry.creatureName || entry.name || 'questa forma'}"?`)) return;
            await savePlayerTransformationList(subject, list.filter((item) => item.id !== id));
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
        const sizeValue = parseTransformationSizeInput(sizeInput?.value);
        if (sizeValue === undefined) {
            alert('Dimensione token non valida. Usa un numero positivo, ad esempio 0.5, 1, 2 oppure 1/2.');
            sizeInput?.focus?.();
            return null;
        }
        return {
            ...renameTransformationEntry(entry, nextName),
            size: sizeValue,
            width: undefined,
            height: undefined
        };
    }

    function parsePositiveNumberOrNull(value) {
        const parsed = parseTransformationSizeInput(value);
        return parsed === undefined ? null : parsed;
    }

    function parseTransformationSizeInput(value) {
        if (value === '' || value === null || value === undefined) return null;
        const text = String(value).trim().replace(',', '.');
        if (!text) return null;
        const fraction = text.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
        if (fraction) {
            const numerator = Number(fraction[1]);
            const denominator = Number(fraction[2]);
            const number = denominator ? numerator / denominator : NaN;
            return Number.isFinite(number) && number > 0 ? normalizeTransformationSize(number) : undefined;
        }
        const number = Number(text);
        return Number.isFinite(number) && number > 0 ? normalizeTransformationSize(number) : undefined;
    }

    function appendTransformationRevision(path, revision) {
        const value = String(path || '').trim();
        if (!value || !/^https?:/i.test(value)) return value;
        try {
            const url = new URL(value);
            url.searchParams.set('v', String(normalizeTransformationRevision(revision)));
            return url.toString();
        } catch (_) {
            return value;
        }
    }

    function nextTransformationRevision(value) {
        const revision = Math.floor(Number(value));
        return Number.isFinite(revision) && revision > 0 ? revision + 1 : 1;
    }

    function normalizeTransformationRevision(value) {
        const revision = Math.floor(Number(value));
        return Number.isFinite(revision) && revision > 0 ? revision : 1;
    }

    function normalizeTransformationSize(value) {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) return null;
        return Math.round(number * 100) / 100;
    }

    function formatTransformationSizeInput(value) {
        const number = parseTransformationSizeInput(value);
        if (number === null || number === undefined) return '';
        return String(number);
    }

    function upsertTransformation(list, entry) {
        const next = list.filter((item) => item.id !== entry.id);
        next.push(entry);
        return next;
    }

    async function savePlayerTransformationList(subject, characterEntries) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per salvare i token trasformazione.');
            return;
        }
        const subjectId = String(subject?.id || '');
        const card = container.querySelector(`[data-transformation-subject-id="${CSS.escape(subjectId)}"]`);
        card?.setAttribute('data-saving', 'true');
        try {
            const characterId = String(subject?.id || '');
            const accountId = String(subject?.accountId || '');
            const nextOwnEntries = characterEntries.map((entry) => normalizeTransformationEntry(entry, subject));
            const buildTransformationsData = (records) => {
                const otherEntries = (Array.isArray(records) ? records : []).filter((entry) => {
                    if (String(entry?.characterId || '') === characterId) return false;
                    if (!subject?.isCompanion && !isCompanionTransformationEntry(entry) && accountId && String(entry?.ownerAccountId || '') === accountId) return false;
                    return true;
                });
                return [...otherEntries, ...nextOwnEntries];
            };
            await saveVersionedCollection({
                load: loadTransformationsDocumentForSave,
                url: getTransformationsApiUrl(),
                token,
                buildData: buildTransformationsData
            });
            transformationsMemoryCache = null;
            currentTransformations = await loadTransformationsData({ force: true });
            setRuntimeTransformations(currentTransformations);
            const target = container.querySelector(`[data-transformation-subject-id="${CSS.escape(subjectId)}"]`);
            if (target) target.innerHTML = renderPlayerTransformationsHtml(subject);
        } catch (error) {
            console.error('Salvataggio trasformazioni fallito:', error);
            alert(`Salvataggio trasformazioni fallito: ${error?.message || error}`);
        } finally {
            card?.removeAttribute('data-saving');
        }
    }

    async function loadTransformationsDocumentForSave() {
        try {
            const response = await fetch(buildNoStoreApiUrl(getTransformationsApiUrl()));
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

        const payload = await (typeof window.CriptaApp?.data?.json === 'function'
            ? window.CriptaApp.data.json('transformations.json')
            : window.CriptaApp.fetchJson(TRANSFORMATIONS_DATA_URL, { clone: true })
        ).catch(() => []);
        const data = Array.isArray(payload) ? payload : payload?.data;
        return { data: Array.isArray(data) ? data : [], version: 0, source: 'static' };
    }

    async function uploadTransformationTokenImage(file, entry, subject = currentCharacter) {
        const token = readAuthToken();
        if (!token) {
            alert('Login richiesto per caricare immagini.');
            return '';
        }
        try {
            const blob = /\.webp$/i.test(file.name) ? file : await convertInlineImageFileToWebpBlob(file);
            const folder = `transformations/${slugify(subject?.id || subject?.accountId || 'player')}`;
            const fileName = `${slugify(entry.id || entry.creatureName || entry.name || 'forma')}.webp`;
            const payload = await window.CriptaMedia.uploadBlob(blob, {
                folder,
                fileName,
                token,
                campaignId: getCurrentCampaignId(),
                authError: 'Login richiesto per caricare immagini.'
            });
            return payload.path;
        } catch (error) {
            console.error('Upload token trasformazione fallito:', error);
            alert(`Upload token fallito: ${error?.message || error}`);
            return '';
        }
    }

    function buildCard(character, context = {}) {
        applyTransformationRuntime(context);
        return buildPlayerTransformationsCard(character);
    }

    function mountCompanions(root, character, payload, mediaOverrides = [], context = {}) {
        applyTransformationRuntime(context);
        return mountCompanionTransformations(root, character, payload, mediaOverrides);
    }

    async function handleClick(event, context = {}) {
        applyTransformationRuntime(context);
        return handleTransformationClick(event);
    }

    window.CriptaCharacterTransformations = Object.freeze({
        buildCard,
        mountCompanions,
        handleClick,
        renderHtml(character, context = {}) {
            applyTransformationRuntime(context);
            registerTransformationSubject(character);
            return renderPlayerTransformationsHtml(character);
        }
    });
})();
