(function () {
    const SKILL_TREE_ICON_SIZE = 256;
    const SKILL_NODE_DRAG_THRESHOLD_PX = 5;
    let skillTreeRuntime = {};
    let PLAYER_SKILL_TREE_KEYS = {};
    let skillsMemoryCache = null;
    let skillTreeStatesMemoryCache = null;
    let skillTreeStatesVersion = null;
    let skillTreeAuthState = null;
    let skillTreeCurrentUserIsDm = false;

    function applySkillTreeRuntime(context = {}) {
        skillTreeRuntime = context || {};
        PLAYER_SKILL_TREE_KEYS = skillTreeRuntime.PLAYER_SKILL_TREE_KEYS || {};
        skillsMemoryCache = skillTreeRuntime.skillsMemoryCache || null;
        skillTreeStatesMemoryCache = Array.isArray(skillTreeRuntime.skillTreeStatesMemoryCache)
            ? skillTreeRuntime.skillTreeStatesMemoryCache
            : [];
        skillTreeStatesVersion = Number.isFinite(Number(skillTreeRuntime.skillTreeStatesVersion))
            ? Number(skillTreeRuntime.skillTreeStatesVersion)
            : null;
        skillTreeAuthState = skillTreeRuntime.skillTreeAuthState || null;
        skillTreeCurrentUserIsDm = Boolean(skillTreeRuntime.skillTreeCurrentUserIsDm);
    }

    function updateRuntimeSkillTreeStates(states, version) {
        if (typeof skillTreeRuntime.setSkillTreeStates === 'function') {
            skillTreeRuntime.setSkillTreeStates(states, version);
        }
    }

    function escapeHtml(value) {
        if (typeof skillTreeRuntime.escapeHtml === 'function') return skillTreeRuntime.escapeHtml(value);
        return window.CriptaApp?.utils?.escapeHtml?.(value) || String(value ?? '');
    }

    function normalizeText(value) {
        if (typeof skillTreeRuntime.normalizeText === 'function') return skillTreeRuntime.normalizeText(value);
        return window.CriptaApp?.utils?.normalizeKey?.(value) || String(value ?? '').trim().toLowerCase();
    }

    function slugify(value) {
        if (typeof skillTreeRuntime.slugify === 'function') return skillTreeRuntime.slugify(value);
        return window.CriptaApp?.utils?.slugify?.(value) || normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function getCurrentCampaignId() {
        if (typeof skillTreeRuntime.getCurrentCampaignId === 'function') return skillTreeRuntime.getCurrentCampaignId();
        return window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue';
    }

    function readSharedAuthToken() {
        if (typeof skillTreeRuntime.readSharedAuthToken === 'function') return skillTreeRuntime.readSharedAuthToken();
        return window.CriptaDiscordAuth?.getToken?.() || '';
    }

    function resolveSkillAssetPath(path) {
        if (typeof skillTreeRuntime.resolveSkillAssetPath === 'function') return skillTreeRuntime.resolveSkillAssetPath(path);
        return String(path || '');
    }

    function normalizeSkillTreeEditableHtml(element) {
        if (typeof skillTreeRuntime.normalizeSkillTreeEditableHtml === 'function') return skillTreeRuntime.normalizeSkillTreeEditableHtml(element);
        return element?.innerHTML || '<p></p>';
    }

    async function resizeImageFileToSquareWebpBlobShared(file, size = SKILL_TREE_ICON_SIZE, quality = 0.86) {
        if (typeof skillTreeRuntime.resizeImageFileToSquareWebpBlobShared === 'function') {
            return skillTreeRuntime.resizeImageFileToSquareWebpBlobShared(file, size, quality);
        }
        throw new Error('Conversione immagine albero non disponibile.');
    }

    async function resizeImageFileToWebpBlobShared(file, maxSize = 1600, quality = 0.86) {
        if (typeof skillTreeRuntime.resizeImageFileToWebpBlobShared === 'function') {
            return skillTreeRuntime.resizeImageFileToWebpBlobShared(file, maxSize, quality);
        }
        throw new Error('Conversione immagine albero non disponibile.');
    }

    async function saveSkillTreesData(trees) {
        if (typeof skillTreeRuntime.saveSkillTreesData !== 'function') throw new Error('Salvataggio albero non disponibile.');
        const result = await skillTreeRuntime.saveSkillTreesData(trees);
        skillsMemoryCache = trees;
        if (typeof skillTreeRuntime.setSkillsCache === 'function') {
            skillTreeRuntime.setSkillsCache(trees, result?.version);
        }
        return result;
    }

    async function loadSkillTreeStates() {
        if (typeof skillTreeRuntime.loadSkillTreeStates !== 'function') return skillTreeStatesMemoryCache || [];
        const states = await skillTreeRuntime.loadSkillTreeStates();
        skillTreeStatesMemoryCache = Array.isArray(states) ? states : [];
        return skillTreeStatesMemoryCache;
    }

function isCampaignSharedSkillTree(tree, key = '') {
    if (!tree || typeof tree !== 'object') return false;
    const scope = normalizeText(tree.scope || tree.treeScope || tree.visibility || '');
    if (tree.shared === true || tree.campaignShared === true || tree.global === true) return true;
    if (['campaign', 'campagna', 'shared', 'condiviso', 'global'].includes(scope)) return true;
    const keySlug = slugify(key);
    return keySlug === 'campaign'
        || keySlug === 'campagna'
        || keySlug.startsWith('campaign-')
        || keySlug.startsWith('campagna-')
        || keySlug.startsWith('shared-')
        || keySlug.startsWith('condiviso-');
}

function isCampaignSharedSkillTreeState(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const scope = normalizeText(entry.scope || entry.stateScope || entry.visibility || '');
    const characterId = slugify(entry.characterId || entry.subjectId || '');
    return entry.shared === true
        || entry.campaignShared === true
        || ['campaign', 'campagna', 'shared', 'condiviso', 'global'].includes(scope)
        || ['campaign', 'campagna', 'global', 'all', 'tutti'].includes(characterId);
}

function getSkillTreeStateSubject(character, treeKey, treeData = null) {
    const shared = isCampaignSharedSkillTree(treeData, treeKey);
    const subjectId = shared ? '__campaign__' : (character?.id || character?.accountId || character?.name || '');
    return {
        shared,
        id: slugify(`${getCurrentCampaignId()}-${treeKey || ''}-${shared ? 'shared' : subjectId}`),
        characterId: shared ? '__campaign__' : (character?.id || ''),
        characterName: shared ? 'Campagna' : (character?.name || character?.id || '')
    };
}

function mergeSkillTreeStateRecords(records) {
    return [...(records || [])]
        .sort((left, right) => Date.parse(left?.updatedAt || '') - Date.parse(right?.updatedAt || ''))
        .reduce((merged, entry) => {
            const unlocked = new Set([
                ...((merged.unlocked || merged.unlockedNodeIds || []).map(String)),
                ...((entry.unlocked || entry.unlockedNodeIds || []).map(String))
            ].filter(Boolean));
            return {
                ...merged,
                ...entry,
                unlocked: Array.from(unlocked),
                levels: {
                    ...(merged.levels && typeof merged.levels === 'object' ? merged.levels : {}),
                    ...(entry.levels && typeof entry.levels === 'object' ? entry.levels : {})
                }
            };
        }, {});
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
    const characterId = normalizeText(character.id || character.characterId || '');
    const characterSlug = slugify(character.id || character.characterId || '');
    if (!characterId) return [];

    const results = [];
    const used = new Set();
    const addEntry = (key) => {
        if (!key || used.has(key) || !allSkillTrees[key]) return;
        used.add(key);
        results.push({ key, tree: allSkillTrees[key] });
    };

    Object.entries(allSkillTrees).forEach(([key, tree]) => {
        if (!tree || typeof tree !== 'object') return;
        if (isCampaignSharedSkillTree(tree, key)) {
            addEntry(key);
            return;
        }
        const normalizedKey = normalizeText(key);
        const owners = [
            tree.characterId,
            tree.ownerCharacterId,
            ...(Array.isArray(tree.characterIds) ? tree.characterIds : []),
            ...(Array.isArray(tree.ownerCharacterIds) ? tree.ownerCharacterIds : [])
        ].map(normalizeText).filter(Boolean);
        if (owners.length) {
            if (owners.includes(characterId)) addEntry(key);
            return;
        }

        const mappedLegacyKey = PLAYER_SKILL_TREE_KEYS[slugify(character.id || '')] || PLAYER_SKILL_TREE_KEYS[characterId] || character.id;
        const normalizedMappedLegacyKey = normalizeText(mappedLegacyKey);
        if (normalizedKey === characterId || (normalizedMappedLegacyKey && normalizedKey === normalizedMappedLegacyKey)) {
            addEntry(key);
            return;
        }
        const keySlug = slugify(key);
        if (characterSlug && (keySlug.startsWith(`${characterSlug}-`) || keySlug.startsWith(`${characterSlug}_`))) {
            addEntry(key);
        }
    });

    if (results.length > 1) {
        results.sort((left, right) => {
            const leftShared = isCampaignSharedSkillTree(left.tree, left.key) ? 1 : 0;
            const rightShared = isCampaignSharedSkillTree(right.tree, right.key) ? 1 : 0;
            if (leftShared !== rightShared) return leftShared - rightShared;
            const leftOrder = Number(left.tree.order ?? 0);
            const rightOrder = Number(right.tree.order ?? 0);
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            return String(left.tree.name || left.tree.title || left.key).localeCompare(String(right.tree.name || right.tree.title || right.key), 'it');
        });
    }
    return results;
}

function getSkillTreeStateKey(character, treeKey, treeData = null) {
    return getSkillTreeStateSubject(character, treeKey, treeData).id;
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

function getCharacterSkillTreeState(character, treeKey, treeData = null) {
    const subject = getSkillTreeStateSubject(character, treeKey, treeData);
    const key = subject.id;
    const characterId = slugify(subject.characterId || character?.id || '');
    const normalizedTreeKey = slugify(treeKey || '');
    const matches = (skillTreeStatesMemoryCache || []).filter((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        if (entry.id === key || entry.key === key) return true;
        if (subject.shared) {
            return isCampaignSharedSkillTreeState(entry)
                && slugify(entry.treeKey || '') === normalizedTreeKey;
        }
        return slugify(entry.characterId || '') === characterId
            && slugify(entry.treeKey || '') === normalizedTreeKey;
    });
    if (!matches.length) return null;
    const sorted = matches.sort((left, right) => {
        const leftExact = left.id === key || left.key === key ? 1 : 0;
        const rightExact = right.id === key || right.key === key ? 1 : 0;
        if (leftExact !== rightExact) return rightExact - leftExact;
        return Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || '');
    });
    return subject.shared ? mergeSkillTreeStateRecords(sorted) : (sorted[0] || null);
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

function getSkillTreeRequirementMode(node) {
    return ['any', 'one'].includes(String(node?.requiresMode || node?.requireMode || node?.requirementMode || '').toLowerCase())
        ? 'any'
        : 'all';
}

function hasExplicitNodePrerequisites(node) {
    return Array.isArray(node?.requires) || Array.isArray(node?.requirements);
}

function getExplicitNodePrerequisites(node) {
    const explicit = Array.isArray(node?.requires)
        ? node.requires
        : Array.isArray(node?.requirements)
            ? node.requirements
            : [];
    return explicit.map(String).filter(Boolean);
}

function setExplicitNodePrerequisites(node, ids) {
    if (!node) return;
    node.requires = Array.from(new Set((ids || []).map(String).filter(Boolean)));
    if ('requirements' in node) delete node.requirements;
}

function addExplicitNodePrerequisite(node, id) {
    if (!node || !id) return;
    setExplicitNodePrerequisites(node, [...getExplicitNodePrerequisites(node), String(id)]);
}

function removeExplicitNodePrerequisite(node, id) {
    if (!node || !id) return;
    setExplicitNodePrerequisites(node, getExplicitNodePrerequisites(node).filter((entry) => String(entry) !== String(id)));
}

function getSkillTreeNodeLabel(treeData, nodeId) {
    const id = String(nodeId || '');
    const node = (treeData?.nodes || []).find((entry) => String(entry.id) === id);
    return node?.title || node?.id || id;
}

function getIncomingSkillTreeConnections(treeData, targetId) {
    const id = String(targetId || '');
    return (treeData?.nodes || []).flatMap((source) => (
        getSkillTreeConnections(source)
            .filter((connection) => connection.target === id)
            .map((connection) => ({
                source: String(source.id),
                target: id,
                mode: connection.mode || 'normal'
            }))
    ));
}

function getSkillNodeLevels(node) {
    const rawLevels = Array.isArray(node?.levels)
        ? node.levels
        : Array.isArray(node?.upgrades)
            ? node.upgrades
            : Array.isArray(node?.variants)
                ? node.variants
                : [];
    const base = {
        title: node?.title || '',
        flavor: node?.flavor || '',
        desc: normalizeSkillLevelStoredHtml(node?.desc || ''),
        icon: node?.icon || ''
    };
    const normalized = rawLevels
        .map((level, index) => ({
            label: level?.label || `Livello ${index + 1}`,
            title: level?.title || '',
            flavor: level?.flavor || '',
            desc: normalizeSkillLevelStoredHtml(level?.desc || level?.description || ''),
            icon: level?.icon || ''
        }))
        .filter((level) => level.title || level.flavor || level.desc || level.icon || level.label);
    if (!normalized.length) return [base];
    return [
        {
            label: normalized[0]?.label || 'Livello 1',
            ...base
        },
        ...normalized.slice(1)
    ];
}

function cleanSkillLevelHtmlTemplate(template) {
    if (!template?.content) return;
    template.content
        .querySelectorAll('script, style, iframe, object, embed, .player-skill-level-diff, [data-skill-level-diff], .player-skill-level-future-addition, [data-skill-level-future-addition]')
        .forEach((entry) => entry.remove());
    template.content
        .querySelectorAll('mark, .player-skill-level-change-highlight, .player-skill-level-scaling-token, [data-skill-level-values]')
        .forEach((entry) => entry.replaceWith(document.createTextNode(entry.textContent || '')));
}

function unwrapSkillLevelFormattingElement(entry) {
    if (!entry?.parentNode) return;
    while (entry.firstChild) entry.parentNode.insertBefore(entry.firstChild, entry);
    entry.remove();
}

function replaceSkillLevelBlockWithParagraph(entry) {
    if (!entry?.parentNode) return;
    const paragraph = document.createElement('p');
    while (entry.firstChild) paragraph.appendChild(entry.firstChild);
    if (!paragraph.textContent.trim() && !paragraph.querySelector('br')) {
        paragraph.appendChild(document.createElement('br'));
    }
    entry.replaceWith(paragraph);
}

function normalizeSkillLevelStoredHtml(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (typeof document === 'undefined') return skillLevelEditorTextToHtml(skillLevelHtmlToEditorText(raw));

    const template = document.createElement('template');
    template.innerHTML = /<[a-z][\s\S]*>/i.test(raw) ? raw : skillLevelEditorTextToHtml(raw);
    cleanSkillLevelHtmlTemplate(template);

    template.content.querySelectorAll('*').forEach((entry) => {
        const tag = entry.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag) || tag === 'blockquote' || tag === 'section' || tag === 'article') {
            replaceSkillLevelBlockWithParagraph(entry);
            return;
        }
        if (['font', 'small', 'big', 'span'].includes(tag)) {
            unwrapSkillLevelFormattingElement(entry);
            return;
        }
        if (tag === 'div') {
            replaceSkillLevelBlockWithParagraph(entry);
            return;
        }
        if (!['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li'].includes(tag)) {
            entry.replaceWith(document.createTextNode(entry.textContent || ''));
            return;
        }
        Array.from(entry.attributes).forEach((attribute) => entry.removeAttribute(attribute.name));
    });

    return template.innerHTML.trim();
}

function skillLevelHtmlToEditorText(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (!/<[a-z][\s\S]*>/i.test(raw)) return raw;

    const withBreaks = raw
        .replace(/<br\s*\/?>(?!\n)/gi, '\n')
        .replace(/<\/li>\s*<li[^>]*>/gi, '</li>\n<li>')
        .replace(/<\/(p|div|blockquote|h[1-6])>\s*<(p|div|blockquote|h[1-6])[^>]*>/gi, '</$1>\n\n<$2>');

    if (typeof document !== 'undefined') {
        const template = document.createElement('template');
        template.innerHTML = withBreaks;
        cleanSkillLevelHtmlTemplate(template);
        return String(template.content?.textContent || withBreaks)
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    return withBreaks
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function skillLevelEditorTextToHtml(value) {
    const text = String(value || '').replace(/\r\n/g, '\n').trim();
    if (!text) return '';
    return text.split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block) => {
            const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
            if (lines.length && lines.every((line) => /^[-*]\s+/.test(line))) {
                return '<ul>' + lines.map((line) => '<li>' + escapeHtml(line.replace(/^[-*]\s+/, '')) + '</li>').join('') + '</ul>';
            }
            return '<p>' + escapeHtml(block).replace(/\n/g, '<br>') + '</p>';
        })
        .join('');
}

function extractSkillLevelDiffText(value) {
    return skillLevelHtmlToEditorText(value).replace(/\s+/g, ' ').trim();
}

function getCommonSuffixLength(left, right, prefixLength) {
    let count = 0;
    const max = Math.min(left.length, right.length) - prefixLength;
    while (count < max && left[left.length - 1 - count] === right[right.length - 1 - count]) {
        count += 1;
    }
    return count;
}

function buildSkillLevelTextDiff(previousValue, currentValue) {
    const previous = extractSkillLevelDiffText(previousValue);
    const current = extractSkillLevelDiffText(currentValue);
    if (!previous && !current) return { state: 'empty' };
    if (previous === current) return { state: 'same' };

    let prefixLength = 0;
    while (
        prefixLength < previous.length
        && prefixLength < current.length
        && previous[prefixLength] === current[prefixLength]
    ) {
        prefixLength += 1;
    }

    const suffixLength = getCommonSuffixLength(previous, current, prefixLength);
    const previousEnd = suffixLength ? previous.length - suffixLength : previous.length;
    const currentEnd = suffixLength ? current.length - suffixLength : current.length;

    return {
        state: 'changed',
        before: previous.slice(prefixLength, previousEnd).trim(),
        after: current.slice(prefixLength, currentEnd).trim()
    };
}

function getEditableLevelDescription(level) {
    return normalizeSkillLevelStoredHtml(level?.desc || level?.description || '');
}

function getEffectiveSkillLevelDescription(node, index) {
    if (!node) return '';
    const descriptions = getSkillLevelScalingDescriptions(node);
    const safeIndex = Math.max(0, Math.round(Number(index) || 0));
    return descriptions[safeIndex]
        || descriptions[safeIndex - 1]
        || normalizeSkillLevelStoredHtml(node.baseDesc || node.desc || '')
        || '<p>Descrizione potenziamento.</p>';
}

function getNodeLevelComparisonDescription(node, index) {
    if (!node) return '';
    return getEffectiveSkillLevelDescription(node, Math.max(0, Math.round(Number(index) || 0) - 1));
}

function renderSkillLevelDiffHtml(previousValue, currentValue, index) {
    const previousText = extractSkillLevelDiffText(previousValue);
    const currentText = extractSkillLevelDiffText(currentValue);
    if (!previousText && !currentText) {
        return `<div class="player-skill-level-diff is-empty" data-skill-level-diff="${escapeHtml(index)}">Nessun testo da confrontare.</div>`;
    }
    if (previousText === currentText) {
        return `<div class="player-skill-level-diff is-same" data-skill-level-diff="${escapeHtml(index)}">Nessuna variazione rispetto al livello precedente.</div>`;
    }

    const changes = buildSkillLevelScalingChanges([previousValue, currentValue]);
    const insertions = buildSkillLevelFutureInsertions(previousValue, currentValue)
        .map((entry) => String(entry.text || '').trim())
        .filter(Boolean);
    if (!changes.length && !insertions.length) {
        return `<div class="player-skill-level-diff is-empty" data-skill-level-diff="${escapeHtml(index)}">Testo diverso, ma nessun valore scalabile rilevato.</div>`;
    }

    const changeRows = changes.length ? `
            <div class="player-skill-level-diff-row is-before">
                <span>Prima</span>
                <strong>${escapeHtml(changes.map((change) => change.values[0]).join(' / '))}</strong>
            </div>
            <div class="player-skill-level-diff-row is-after">
                <span>Dopo</span>
                <strong>${escapeHtml(changes.map((change) => change.values[1]).join(' / '))}</strong>
            </div>` : '';
    const insertionRows = insertions.length ? `
            <div class="player-skill-level-diff-row is-added">
                <span>Aggiunto</span>
                <strong>${escapeHtml(insertions.join(' / '))}</strong>
            </div>` : '';

    return `
        <div class="player-skill-level-diff" data-skill-level-diff="${escapeHtml(index)}">
            ${changeRows}
            ${insertionRows}
        </div>
    `;
}

function refreshSkillLevelDiffPreview(row, node, index) {
    const diffElement = row?.querySelector?.('[data-skill-level-diff]');
    if (!diffElement) return;
    const current = getEffectiveSkillLevelDescription(node, index);
    const previous = getNodeLevelComparisonDescription(node, index);
    diffElement.outerHTML = renderSkillLevelDiffHtml(previous, current, index);
}

function buildSkillLevelTextNodeMap(text) {
    const normalized = [];
    const map = [];
    let pendingWhitespaceStart = -1;
    let pendingWhitespaceEnd = -1;

    const flushWhitespace = () => {
        if (pendingWhitespaceStart < 0) return;
        if (normalized.length && normalized[normalized.length - 1] !== ' ') {
            normalized.push(' ');
            map.push({ start: pendingWhitespaceStart, end: pendingWhitespaceEnd });
        }
        pendingWhitespaceStart = -1;
        pendingWhitespaceEnd = -1;
    };

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (/\s/.test(char)) {
            if (pendingWhitespaceStart < 0) pendingWhitespaceStart = index;
            pendingWhitespaceEnd = index + 1;
            continue;
        }
        flushWhitespace();
        normalized.push(char);
        map.push({ start: index, end: index + 1 });
    }

    return { normalized: normalized.join('').trim(), map };
}

function getSkillLevelHtmlWithTextBreaks(value) {
    return String(value || '')
        .replace(/<br\s*\/?>(?!\n)/gi, '\n')
        .replace(/<\/li>\s*<li[^>]*>/gi, '</li>\n<li>')
        .replace(/<\/(p|div|blockquote|h[1-6])>\s*<(p|div|blockquote|h[1-6])[^>]*>/gi, '</$1>\n\n<$2>');
}

function tokenizeSkillLevelText(text) {
    const tokens = [];
    const source = String(text || '');
    const matcher = /\S+/g;
    let match;
    while ((match = matcher.exec(source))) {
        tokens.push({ value: match[0], start: match.index, end: match.index + match[0].length });
    }
    return tokens;
}

function getSkillLevelScalingDescriptions(node) {
    const rawLevels = Array.isArray(node?.levels) ? node.levels : [];
    const baseDescription = normalizeSkillLevelStoredHtml(node?.baseDesc || node?.desc || getEditableLevelDescription(rawLevels[0]) || '');
    if (!rawLevels.length) return [baseDescription];

    const descriptions = [baseDescription];
    for (let index = 1; index < rawLevels.length; index += 1) {
        descriptions.push(getEditableLevelDescription(rawLevels[index]) || descriptions[index - 1] || baseDescription);
    }
    return descriptions;
}

function normalizeSkillLevelCompareToken(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
        .trim();
}

function getSkillLevelDisplayTokenValue(value) {
    return String(value || '')
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
        .trim();
}

function buildSkillLevelTokenAnchors(baseTokens, targetTokens) {
    const base = baseTokens.map((token) => normalizeSkillLevelCompareToken(token.value));
    const target = targetTokens.map((token) => normalizeSkillLevelCompareToken(token.value));
    const rows = base.length + 1;
    const cols = target.length + 1;
    const table = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let row = base.length - 1; row >= 0; row -= 1) {
        for (let col = target.length - 1; col >= 0; col -= 1) {
            table[row][col] = base[row] && base[row] === target[col]
                ? table[row + 1][col + 1] + 1
                : Math.max(table[row + 1][col], table[row][col + 1]);
        }
    }

    const anchors = [];
    let row = 0;
    let col = 0;
    while (row < base.length && col < target.length) {
        if (base[row] && base[row] === target[col]) {
            anchors.push({ baseIndex: row, targetIndex: col });
            row += 1;
            col += 1;
        } else if (table[row + 1][col] >= table[row][col + 1]) {
            row += 1;
        } else {
            col += 1;
        }
    }
    return anchors;
}

function alignSkillLevelTokensToBase(baseTokens, targetTokens) {
    const aligned = Array(baseTokens.length).fill(undefined);
    const anchors = buildSkillLevelTokenAnchors(baseTokens, targetTokens);
    const allAnchors = [
        { baseIndex: -1, targetIndex: -1 },
        ...anchors,
        { baseIndex: baseTokens.length, targetIndex: targetTokens.length }
    ];

    anchors.forEach((anchor) => {
        aligned[anchor.baseIndex] = targetTokens[anchor.targetIndex]?.value;
    });

    for (let index = 0; index < allAnchors.length - 1; index += 1) {
        const current = allAnchors[index];
        const next = allAnchors[index + 1];
        const baseStart = current.baseIndex + 1;
        const baseEnd = next.baseIndex;
        const targetStart = current.targetIndex + 1;
        const targetEnd = next.targetIndex;
        const baseGap = baseEnd - baseStart;
        const targetGap = targetEnd - targetStart;

        if (baseGap <= 0 || targetGap <= 0 || baseGap !== targetGap) continue;
        for (let offset = 0; offset < baseGap; offset += 1) {
            aligned[baseStart + offset] = targetTokens[targetStart + offset]?.value;
        }
    }

    return aligned;
}


function trimInsertionDuplicateTrailingPunctuation(text, punctuation) {
    if (!punctuation) return text;
    let output = String(text || '');
    punctuation.split('').reverse().forEach((char) => {
        const trimmed = output.trimEnd();
        if (!trimmed.endsWith(char)) return;
        output = trimmed.slice(0, -char.length);
    });
    return output;
}

function buildSkillLevelFutureInsertions(currentHtml, futureHtml) {
    const currentText = skillLevelHtmlToEditorText(currentHtml);
    const futureText = skillLevelHtmlToEditorText(futureHtml);
    const currentTokens = tokenizeSkillLevelText(currentText);
    const futureTokens = tokenizeSkillLevelText(futureText);
    if (!currentTokens.length || !futureTokens.length) return [];

    const anchors = buildSkillLevelTokenAnchors(currentTokens, futureTokens);
    const allAnchors = [
        { baseIndex: -1, targetIndex: -1 },
        ...anchors,
        { baseIndex: currentTokens.length, targetIndex: futureTokens.length }
    ];
    const insertions = [];

    for (let index = 0; index < allAnchors.length - 1; index += 1) {
        const current = allAnchors[index];
        const next = allAnchors[index + 1];
        const currentStart = current.baseIndex + 1;
        const currentEnd = next.baseIndex;
        const futureStart = current.targetIndex + 1;
        const futureEnd = next.targetIndex;
        const currentGap = currentEnd - currentStart;
        const futureGap = futureEnd - futureStart;
        if (currentGap !== 0 || futureGap <= 0) continue;

        const previousCurrentToken = current.baseIndex >= 0 ? currentTokens[current.baseIndex] : null;
        const previousFutureToken = current.targetIndex >= 0 ? futureTokens[current.targetIndex] : null;
        const nextCurrentToken = next.baseIndex < currentTokens.length ? currentTokens[next.baseIndex] : null;
        const nextFutureToken = next.targetIndex < futureTokens.length ? futureTokens[next.targetIndex] : null;
        const textStart = previousFutureToken ? previousFutureToken.end : futureTokens[futureStart]?.start ?? 0;
        const textEnd = nextFutureToken ? nextFutureToken.start : futureTokens[futureEnd - 1]?.end ?? futureText.length;
        let text = futureText.slice(textStart, textEnd);
        let offset = previousCurrentToken ? previousCurrentToken.end : nextCurrentToken?.start ?? currentText.length;

        const punctuation = previousCurrentToken?.value?.match(/[.,;:!?]+$/)?.[0] || '';
        const samePreviousToken = previousCurrentToken && previousFutureToken
            && normalizeSkillLevelCompareToken(previousCurrentToken.value) === normalizeSkillLevelCompareToken(previousFutureToken.value);
        if (punctuation && samePreviousToken && !previousFutureToken.value.endsWith(punctuation)) {
            offset = Math.max(previousCurrentToken.start, previousCurrentToken.end - punctuation.length);
            text = trimInsertionDuplicateTrailingPunctuation(text, punctuation);
        }

        if (!String(text || '').trim()) continue;
        insertions.push({ offset, text });
    }

    return insertions;
}

function markSkillLevelFutureAdditions(levelHtml, futureHtml, levelIndex = 0) {
    if (!futureHtml || typeof document === 'undefined') return levelHtml;
    const insertions = buildSkillLevelFutureInsertions(levelHtml, futureHtml);
    if (!insertions.length) return levelHtml;

    const template = document.createElement('template');
    template.innerHTML = levelHtml;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let fullText = '';
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const start = fullText.length;
        const text = String(node.textContent || '');
        fullText += text;
        textNodes.push({ node, start, end: fullText.length, insertions: [] });
    }

    insertions.forEach((insertion) => {
        const offset = Math.max(0, Math.min(fullText.length, insertion.offset));
        const owner = textNodes.find((entry) => offset >= entry.start && offset <= entry.end) || textNodes[textNodes.length - 1];
        if (!owner) return;
        owner.insertions.push({
            offset: offset - owner.start,
            text: insertion.text
        });
    });

    textNodes.forEach((owner) => {
        if (!owner.insertions.length) return;
        const text = String(owner.node.textContent || '');
        const replacements = [];
        let cursor = 0;
        owner.insertions
            .sort((left, right) => left.offset - right.offset)
            .forEach((insertion) => {
                const offset = Math.max(cursor, Math.min(text.length, insertion.offset));
                if (offset > cursor) replacements.push(document.createTextNode(text.slice(cursor, offset)));
                const span = document.createElement('span');
                span.className = 'player-skill-level-future-addition';
                span.dataset.skillLevelFutureAddition = String(levelIndex + 2);
                span.title = 'Aggiunto dal livello ' + (levelIndex + 2);
                span.textContent = insertion.text;
                replacements.push(span);
                cursor = offset;
            });
        if (cursor < text.length) replacements.push(document.createTextNode(text.slice(cursor)));
        owner.node.replaceWith(...replacements);
    });

    return template.innerHTML;
}

function buildSkillLevelScalingChanges(descriptions) {
    const tokenLists = descriptions.map((description) => tokenizeSkillLevelText(skillLevelHtmlToEditorText(description)));
    const baseTokens = tokenLists[0] || [];
    if (!baseTokens.length || tokenLists.length < 2) return [];

    const alignedLists = tokenLists.map((tokens, index) => (
        index === 0 ? baseTokens.map((token) => token.value) : alignSkillLevelTokensToBase(baseTokens, tokens)
    ));

    return baseTokens.map((token, tokenIndex) => {
        const rawValues = alignedLists.map((tokens) => tokens[tokenIndex]);
        if (rawValues.some((value) => value === undefined || value === '')) return null;
        const values = rawValues.map(getSkillLevelDisplayTokenValue);
        if (values.some((value) => !value)) return null;
        const uniqueValues = new Set(values.map((value) => normalizeSkillLevelCompareToken(value)));
        if (uniqueValues.size <= 1) return null;
        return { tokenIndex, values };
    }).filter(Boolean);
}

function markSkillLevelScalingTokens(levelHtml, changes, levelIndex = 0) {
    if (!changes.length || typeof document === 'undefined') return levelHtml;

    const template = document.createElement('template');
    template.innerHTML = getSkillLevelHtmlWithTextBreaks(levelHtml);
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let fullText = '';
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const start = fullText.length;
        const text = String(node.textContent || '');
        fullText += text;
        textNodes.push({ node, start, end: fullText.length, marks: [] });
    }

    const levelTokens = tokenizeSkillLevelText(fullText);
    const valuesByLevelToken = new Map();
    changes.forEach((change) => {
        const value = change.values?.[levelIndex];
        const normalized = normalizeSkillLevelCompareToken(value);
        if (!normalized) return;
        if (!valuesByLevelToken.has(normalized)) valuesByLevelToken.set(normalized, []);
        valuesByLevelToken.get(normalized).push(change.values);
    });

    levelTokens.forEach((token) => {
        const normalized = normalizeSkillLevelCompareToken(token.value);
        const valueSets = valuesByLevelToken.get(normalized);
        if (!valueSets?.length) return;
        const values = valueSets.shift();
        const owner = textNodes.find((entry) => token.start >= entry.start && token.end <= entry.end);
        if (!owner) return;
        owner.marks.push({
            start: token.start - owner.start,
            end: token.end - owner.start,
            values
        });
    });

    textNodes.forEach((owner) => {
        if (!owner.marks.length) return;
        const text = String(owner.node.textContent || '');
        const replacements = [];
        let cursor = 0;

        owner.marks
            .sort((left, right) => left.start - right.start)
            .forEach((markData) => {
                if (markData.start < cursor) return;
                if (markData.start > cursor) replacements.push(document.createTextNode(text.slice(cursor, markData.start)));

                const mark = document.createElement('mark');
                mark.className = 'player-skill-level-change-highlight player-skill-level-scaling-token';
                mark.title = markData.values.join(' / ');
                mark.dataset.skillLevelValues = markData.values.join(' / ');
                mark.textContent = text.slice(markData.start, markData.end);
                replacements.push(mark);
                cursor = markData.end;
            });

        if (cursor < text.length) replacements.push(document.createTextNode(text.slice(cursor)));
        owner.node.replaceWith(...replacements);
    });

    return template.innerHTML;
}

function renderSkillNodeDescriptionForReading(node) {
    const descriptions = getSkillLevelScalingDescriptions(node);
    const levelIndex = Math.max(0, Math.min(descriptions.length - 1, Math.round(Number(node?.level) || 1) - 1));
    const currentDescription = descriptions[levelIndex] || descriptions[0] || '<p>Nessun dettaglio disponibile.</p>';
    if (descriptions.length <= 1) return currentDescription;

    const changes = buildSkillLevelScalingChanges(descriptions);
    let renderedDescription = changes.length
        ? markSkillLevelScalingTokens(currentDescription, changes, levelIndex)
        : currentDescription;
    if (descriptions[levelIndex + 1]) {
        renderedDescription = markSkillLevelFutureAdditions(renderedDescription, descriptions[levelIndex + 1], levelIndex);
    }
    return renderedDescription;
}

function normalizeSkillTreeDefinitionForSave(treeData) {
    if (!treeData || typeof treeData !== 'object') return treeData;
    return {
        ...treeData,
        nodes: Array.isArray(treeData.nodes)
            ? treeData.nodes.map((node) => ({
                ...node,
                desc: normalizeSkillLevelStoredHtml(node?.desc || ''),
                levels: Array.isArray(node?.levels)
                    ? node.levels.map((level) => {
                        const normalizedDesc = normalizeSkillLevelStoredHtml(level?.desc || level?.description || '');
                        return {
                            ...level,
                            desc: normalizedDesc,
                            ...(level && Object.prototype.hasOwnProperty.call(level, 'description') ? { description: normalizedDesc } : {})
                        };
                    })
                    : node?.levels
            }))
            : treeData.nodes
    };
}

function applySkillNodeLevel(node, levelValue) {
    const levels = getSkillNodeLevels(node);
    const maxLevel = levels.length;
    const level = Math.max(1, Math.min(maxLevel, Math.round(Number(levelValue) || 1)));
    const data = levels[level - 1] || levels[0] || {};
    return {
        ...node,
        baseTitle: node.baseTitle || node.title,
        baseFlavor: node.baseFlavor || node.flavor,
        baseDesc: node.baseDesc || node.desc,
        baseIcon: node.baseIcon || node.icon,
        title: data.title || node.title,
        flavor: data.flavor || node.flavor,
        desc: data.desc || node.desc,
        icon: data.icon || node.icon,
        level,
        maxLevel,
        levelLabel: data.label || (maxLevel > 1 ? `Livello ${level}` : '')
    };
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
    const stateLevels = stateRecord?.levels && typeof stateRecord.levels === 'object' ? stateRecord.levels : {};

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
        const level = unlocked.has(nodeId) ? stateLevels[nodeId] : 1;
        return applySkillNodeLevel({ ...node, id: nodeId, requires: requirements, requiresMode: requirementMode, state }, level);
    });
}

function deriveSkillTreeEditorNodes(treeData, stateRecord) {
    const runtimeById = new Map(deriveSkillTreeNodes(treeData, stateRecord).map((node) => [String(node.id), node]));
    return (treeData.nodes || []).map((node) => {
        const nodeId = String(node.id);
        const runtimeNode = runtimeById.get(nodeId) || {};
        return {
            ...node,
            id: nodeId,
            requires: getNodePrerequisites(node, treeData),
            requiresMode: getSkillTreeRequirementMode(node),
            state: runtimeNode.state || node.state || 'locked',
            level: runtimeNode.level || 1,
            maxLevel: getSkillNodeLevels(node).length
        };
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

async function saveCharacterSkillTreeState(character, treeKey, unlockedIds, levelMap = {}, treeData = null) {
    const accountId = getCurrentAccountId();
    const subject = getSkillTreeStateSubject(character, treeKey, treeData);
    const stateId = subject.id;
    const characterId = slugify(subject.characterId || character?.id || '');
    const normalizedTreeKey = slugify(treeKey || '');
    const existingStates = await loadSkillTreeStates();
    const kept = existingStates.filter((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        if (entry.id === stateId || entry.key === stateId) return false;
        if (subject.shared) {
            return !(isCampaignSharedSkillTreeState(entry) && slugify(entry.treeKey || '') === normalizedTreeKey);
        }
        return !(slugify(entry.characterId || '') === characterId && slugify(entry.treeKey || '') === normalizedTreeKey);
    });
    const nextRecord = {
        id: stateId,
        key: stateId,
        treeKey,
        characterId: subject.characterId,
        characterName: subject.characterName,
        ownerAccountId: accountId || slugify(character?.accountId || ''),
        scope: subject.shared ? 'campaign' : 'character',
        shared: subject.shared,
        unlocked: Array.from(new Set((unlockedIds || []).map(String))).filter(Boolean),
        levels: Object.fromEntries(Object.entries(levelMap || {})
            .map(([key, value]) => [String(key), Math.max(1, Math.round(Number(value) || 1))])
            .filter(([key, value]) => key && value > 1)),
        updatedAt: new Date().toISOString()
    };
    const nextStates = [...kept, nextRecord];
    const body = { data: nextStates };
    const token = readSharedAuthToken();
    if (!token) throw new Error('Login richiesto per salvare lo stato albero abilita.');
    const result = await window.CriptaApp.api.post('api/data/skill-tree-states', body, { token });
    skillTreeStatesVersion = Number(result?.version || skillTreeStatesVersion || 0);
    skillTreeStatesMemoryCache = nextStates;
    updateRuntimeSkillTreeStates(nextStates, skillTreeStatesVersion);
    window.parent?.postMessage?.({
        type: 'cripta-skill-tree-state-updated',
        campaignId: getCurrentCampaignId(),
        characterId: subject.characterId,
        treeKey,
        shared: subject.shared,
        unlocked: nextRecord.unlocked
    }, '*');
    return result;
}

async function deleteSkillTreeData(treeKey, treeData, allSkillTrees) {
    const key = String(treeKey || '').trim();
    if (!key) throw new Error('Albero abilita non valido.');
    const nextTrees = { ...(skillsMemoryCache || allSkillTrees || {}) };
    if (!nextTrees[key]) throw new Error('Albero abilita non trovato.');
    delete nextTrees[key];
    await saveSkillTreesData(nextTrees);

    try {
        const token = readSharedAuthToken();
        if (!token || typeof window.CriptaApp?.api?.post !== 'function') return;
        const existingStates = await loadSkillTreeStates();
        const normalizedTreeKey = slugify(key);
        const nextStates = existingStates.filter((entry) => slugify(entry?.treeKey || '') !== normalizedTreeKey);
        if (nextStates.length === existingStates.length) return;
        const result = await window.CriptaApp.api.post('api/data/skill-tree-states', { data: nextStates }, { token });
        skillTreeStatesVersion = Number(result?.version || skillTreeStatesVersion || 0);
        skillTreeStatesMemoryCache = nextStates;
        updateRuntimeSkillTreeStates(nextStates, skillTreeStatesVersion);
    } catch (error) {
        console.warn('Pulizia stati albero abilita fallita:', error);
    }
}

function buildPlayerSkillTreeCard(characterOrId, allSkillTrees, forcedTreeEntry = null) {
    const treeEntry = forcedTreeEntry || resolvePlayerSkillTreeEntry(characterOrId, allSkillTrees);
    const treeData = treeEntry?.tree || null;
    if (!treeData || !Array.isArray(treeData.nodes) || treeData.nodes.length === 0) {
        return null;
    }
    const character = typeof characterOrId === 'object' && characterOrId !== null ? characterOrId : { id: characterOrId };
    const treeKey = treeEntry.key;
    const isSharedTree = isCampaignSharedSkillTree(treeData, treeKey);
    const canEditUnlocks = isSharedTree ? skillTreeCurrentUserIsDm : canEditSkillTreeUnlocks(character);
    const canEditTree = skillTreeCurrentUserIsDm;
    const stateRecord = getCharacterSkillTreeState(character, treeKey, treeData);
    let workingTree = {
        ...treeData,
        nodes: (treeData.nodes || []).map((node) => ({ ...node, id: String(node.id) }))
    };
    let currentNodes = deriveSkillTreeNodes(workingTree, stateRecord);
    let unlockedIds = new Set(currentNodes.filter((node) => node.state === 'unlocked').map((node) => String(node.id)));
    let nodeLevels = { ...(stateRecord?.levels && typeof stateRecord.levels === 'object' ? stateRecord.levels : {}) };
    let selectedNodeId = currentNodes[0]?.id || '';
    let editMode = false;
    let snapToGrid = false;
    let snapToNodes = true;
    let snapGridStep = 5;
    let linkDrag = null;
    let selectedConnection = null;
    const snapThreshold = 1.4;

    const card = document.createElement('div');
    card.className = `content-card player-skill-tree-card${isSharedTree ? ' is-shared-skill-tree' : ''}`;
    card.id = `player-skill-tree-card-${slugify(treeKey || 'default')}`;
    card.tabIndex = -1;
    const treeLabel = workingTree.name || workingTree.title || (treeKey ? treeKey.replace(/[-_]+/g, ' ') : 'Albero abilita');
    card.innerHTML = `
                <div class="player-skill-tree-card-head">
                    <h3><i class="fas ${isSharedTree ? 'fa-users' : 'fa-crown'}"></i> Albero Abilita <small data-skill-tree-label>${escapeHtml(treeLabel)}</small>${isSharedTree ? '<span class="player-skill-tree-shared-badge">Condiviso</span>' : ''}</h3>
                    ${canEditTree ? '<div class="player-skill-tree-card-actions"><button type="button" class="player-skill-edit-toggle player-skill-delete-tree" data-skill-delete-tree title="Elimina albero" aria-label="Elimina albero"><i class="fas fa-trash"></i></button><button type="button" class="player-skill-edit-toggle" data-skill-edit-toggle title="Modifica albero" aria-label="Modifica albero"><i class="fas fa-pen"></i></button></div>' : ''}
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
    const deleteButton = card.querySelector('[data-skill-delete-tree]');
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
        const requirementNames = getNodePrerequisites(node, workingTree)
            .map((id) => getSkillTreeNodeLabel(workingTree, id))
            .filter(Boolean);
        const requirementMode = getSkillTreeRequirementMode(node);
        const requirementsLabel = requirementNames.length
            ? requirementMode === 'any'
                ? `<p class="player-skill-info-requirements is-any"><strong>REQUISITO:</strong> almeno uno tra ${escapeHtml(requirementNames.join(', '))}</p>`
                : `<p class="player-skill-info-requirements is-all"><strong>REQUISITI:</strong> ${escapeHtml(requirementNames.join(', '))}</p>`
            : '';
        const descriptionHtml = editable
            ? (node.desc || '<p>Nessun dettaglio disponibile.</p>')
            : renderSkillNodeDescriptionForReading(node);
        const richTextToolbar = editable ? `
                    <div class="player-skill-rich-toolbar" role="toolbar" aria-label="Formato descrizione abilita">
                        <button type="button" data-skill-rich-command="bold" title="Grassetto"><i class="fas fa-bold" aria-hidden="true"></i></button>
                        <button type="button" data-skill-rich-command="italic" title="Corsivo"><i class="fas fa-italic" aria-hidden="true"></i></button>
                        <button type="button" data-skill-rich-command="insertUnorderedList" title="Elenco puntato"><i class="fas fa-list-ul" aria-hidden="true"></i></button>
                        <button type="button" data-skill-rich-command="insertOrderedList" title="Elenco numerato"><i class="fas fa-list-ol" aria-hidden="true"></i></button>
                    </div>
        ` : '';
        infoPanel.innerHTML = `
                    <header class="player-skill-info-header">
                        ${icon ? `<img src="${icon}" alt="${escapeHtml(node.title || 'Abilita')}" class="player-skill-info-icon">` : ''}
                        <h4 class="player-skill-info-title" ${editable ? 'contenteditable="true" data-skill-preview-field="title" spellcheck="false"' : ''}>${escapeHtml(node.title || 'Abilita')}</h4>
                    </header>
                    <div class="player-skill-info-state-row">
                        <div class="player-skill-info-state is-${escapeHtml(node.state || 'locked')}">${escapeHtml(node.state === 'unlocked' ? 'Sbloccata' : node.state === 'unlockable' ? 'Disponibile' : 'Bloccata')}</div>
                        ${Number(node.maxLevel || 1) > 1 ? `<div class="player-skill-info-level">Livello ${escapeHtml(node.level || 1)} / ${escapeHtml(node.maxLevel)}</div>` : ''}
                    </div>
                    ${editable || node.flavor ? `<p class="player-skill-info-flavor" ${editable ? 'contenteditable="true" data-skill-preview-field="flavor" spellcheck="true"' : ''}>${escapeHtml(node.flavor || '')}</p>` : ''}
                    ${richTextToolbar}
                    ${requirementsLabel}
                    <div class="player-skill-info-desc ${editable ? 'is-editable' : ''}" ${editable ? 'contenteditable="true" data-skill-preview-field="desc" spellcheck="true"' : ''}>${descriptionHtml}</div>
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
        const stateSnapshot = { unlocked: Array.from(unlockedIds), levels: nodeLevels };
        currentNodes = editMode && canEditTree
            ? deriveSkillTreeEditorNodes(workingTree, stateSnapshot)
            : deriveSkillTreeNodes(workingTree, stateSnapshot);
    };

    const persistUnlocks = async () => {
        const activeLevels = Object.fromEntries(Object.entries(nodeLevels).filter(([nodeId]) => unlockedIds.has(String(nodeId))));
        nodeLevels = activeLevels;
        await saveCharacterSkillTreeState(character, treeKey, Array.from(unlockedIds), activeLevels, workingTree);
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

    const connectionMarkerPrefix = `skill-link-arrow-${slugify(treeKey || character?.id || 'tree')}`;

    const getConnectionMarkerId = (state, selected = false) => {
        if (selected) return `${connectionMarkerPrefix}-selected`;
        if (state === 'unlocked') return `${connectionMarkerPrefix}-unlocked`;
        if (state === 'unlockable') return `${connectionMarkerPrefix}-unlockable`;
        return `${connectionMarkerPrefix}-locked`;
    };

    const appendConnectionMarkers = () => {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        [
            ['locked', 'rgba(238, 238, 238, 0.82)'],
            ['unlockable', 'rgba(222, 186, 104, 0.9)'],
            ['unlocked', 'rgba(230, 190, 70, 0.95)'],
            ['selected', 'rgba(255, 230, 140, 0.98)']
        ].forEach(([state, fill]) => {
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', getConnectionMarkerId(state, state === 'selected'));
            marker.setAttribute('viewBox', '0 0 8 8');
            marker.setAttribute('refX', '7');
            marker.setAttribute('refY', '4');
            marker.setAttribute('markerWidth', '8');
            marker.setAttribute('markerHeight', '8');
            marker.setAttribute('orient', 'auto');
            marker.setAttribute('markerUnits', 'userSpaceOnUse');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M 0 1 L 8 4 L 0 7 z');
            path.setAttribute('fill', fill);
            marker.appendChild(path);
            defs.appendChild(marker);
        });
        linesLayer.appendChild(defs);
    };

    const getConnectionLinePoints = (startNode, targetNode) => {
        const sx = Number(startNode.x) || 50;
        const sy = Number(startNode.y) || 50;
        const tx = Number(targetNode.x) || 50;
        const ty = Number(targetNode.y) || 50;
        const dx = tx - sx;
        const dy = ty - sy;
        const distance = Math.hypot(dx, dy);
        if (!distance) return { x1: sx, y1: sy, x2: tx, y2: ty };
        const ux = dx / distance;
        const uy = dy / distance;
        const sourceRadius = startNode.keyNode ? 5.85 : 4.35;
        const targetRadius = targetNode.keyNode ? 5.85 : 4.35;
        const sourceOffset = Math.min(sourceRadius, distance * 0.28);
        const targetOffset = Math.min(targetRadius, distance * 0.36);
        return {
            x1: sx + ux * sourceOffset,
            y1: sy + uy * sourceOffset,
            x2: tx - ux * targetOffset,
            y2: ty - uy * targetOffset
        };
    };

    const renderConnections = () => {
        linesLayer.replaceChildren();
        appendConnectionMarkers();

        const nodeById = new Map(currentNodes.map((node) => [String(node.id), node]));
        currentNodes.forEach((startNode) => {
            getSkillTreeConnections(startNode).forEach((connection) => {
                const targetNode = nodeById.get(String(connection.target));
                if (!targetNode) return;

                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                const points = getConnectionLinePoints(startNode, targetNode);
                line.setAttribute('x1', `${points.x1}%`);
                line.setAttribute('y1', `${points.y1}%`);
                line.setAttribute('x2', `${points.x2}%`);
                line.setAttribute('y2', `${points.y2}%`);
                const isSelected = selectedConnection
                    && selectedConnection.source === String(startNode.id)
                    && selectedConnection.target === String(connection.target);
                line.setAttribute('class', `player-skill-connection is-${targetNode.state || 'locked'} is-${connection.mode || 'normal'}${isSelected ? ' is-selected' : ''}${editMode && canEditTree ? ' is-editable' : ''}`);
                line.setAttribute('marker-end', `url(#${getConnectionMarkerId(targetNode.state || 'locked', isSelected)})`);
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
        const target = workingTree.nodes.find((entry) => String(entry.id) === String(targetId));
        if (source && targetId && targetId !== linkDrag.sourceId) {
            const nextConnections = getSkillTreeConnections(source);
            if (!nextConnections.some((connection) => connection.target === String(targetId))) {
                setSkillTreeConnections(source, [...nextConnections, { target: String(targetId), mode: 'normal' }]);
                if (hasExplicitNodePrerequisites(target)) addExplicitNodePrerequisite(target, linkDrag.sourceId);
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
            if (Number(node.maxLevel || 1) > 1 && Number(node.level || 1) > 1) {
                const levelBadge = document.createElement('span');
                levelBadge.className = 'player-skill-node-level-badge';
                levelBadge.textContent = String(node.level || 1);
                levelBadge.setAttribute('aria-hidden', 'true');
                nodeElement.appendChild(levelBadge);
            }
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

            nodeElement.addEventListener('mouseenter', () => {
                if (!editMode) updateInfo(node);
            });
            nodeElement.addEventListener('focus', () => {
                if (!editMode) updateInfo(node);
            });
            nodeElement.addEventListener('click', async () => {
                selectedNodeId = String(node.id);
                selectedConnection = null;
                updateInfo(node);
                if (editMode && canEditTree) {
                    renderTree();
                    renderEditor();
                    return;
                }
                if (!canEditUnlocks) {
                    renderTree();
                    return;
                }
                if (node.state !== 'unlocked' && (node.state === 'unlockable' || skillTreeCurrentUserIsDm)) {
                    getExclusiveSkillTreeSiblingIds(workingTree, node.id).forEach((siblingId) => unlockedIds.delete(String(siblingId)));
                    unlockedIds.add(String(node.id));
                    nodeLevels[String(node.id)] = 1;
                    unlockedIds = pruneUnlockedSkillNodes(workingTree, unlockedIds);
                    await persistUnlocks().catch((error) => {
                        console.error('Salvataggio albero abilita fallito:', error);
                        alert('Impossibile salvare lo sblocco online.');
                    });
                    renderTree();
                } else if (node.state === 'unlocked' && Number(node.maxLevel || 1) > Number(node.level || 1)) {
                    nodeLevels[String(node.id)] = Number(node.level || 1) + 1;
                    await persistUnlocks().catch((error) => {
                        console.error('Salvataggio livello albero abilita fallito:', error);
                        alert('Impossibile salvare il livello online.');
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
                    const currentLevel = Math.max(1, Number(nodeLevels[String(node.id)] || node.level || 1));
                    if (currentLevel > 1) {
                        nodeLevels[String(node.id)] = currentLevel - 1;
                    } else {
                        delete nodeLevels[String(node.id)];
                        unlockedIds.delete(String(node.id));
                        unlockedIds = pruneUnlockedSkillNodes(workingTree, unlockedIds);
                    }
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
                let dragStarted = false;
                let dragPointerId = null;
                let dragStartClientX = 0;
                let dragStartClientY = 0;
                const moveNode = (event) => {
                    if (!dragging || !editMode || event.pointerId !== dragPointerId) return;
                    const deltaX = event.clientX - dragStartClientX;
                    const deltaY = event.clientY - dragStartClientY;
                    if (!dragStarted && Math.hypot(deltaX, deltaY) < SKILL_NODE_DRAG_THRESHOLD_PX) return;
                    if (!dragStarted) {
                        dragStarted = true;
                        nodeElement.classList.add('is-dragging');
                    }
                    event.preventDefault();
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
                    const shouldRenderAfterDrag = dragStarted;
                    dragging = false;
                    dragStarted = false;
                    dragPointerId = null;
                    nodeElement.classList.remove('is-dragging');
                    hideSnapGuides();
                    if (nodeElement.hasPointerCapture?.(event.pointerId)) {
                        nodeElement.releasePointerCapture(event.pointerId);
                    }
                    if (shouldRenderAfterDrag) {
                        renderTree();
                        renderEditor();
                    }
                };
                nodeElement.addEventListener('pointerdown', (event) => {
                    if (!editMode || event.target.closest?.('.player-skill-node-link-anchor')) return;
                    event.preventDefault();
                    dragging = true;
                    dragStarted = false;
                    dragPointerId = event.pointerId;
                    dragStartClientX = event.clientX;
                    dragStartClientY = event.clientY;
                    selectedNodeId = String(node.id);
                    nodeElement.setPointerCapture(event.pointerId);
                });
                nodeElement.addEventListener('pointermove', moveNode);
                nodeElement.addEventListener('pointerup', finishDrag);
                nodeElement.addEventListener('pointercancel', finishDrag);
                nodeElement.addEventListener('lostpointercapture', () => {
                    if (!dragging) return;
                    const shouldRenderAfterDrag = dragStarted;
                    dragging = false;
                    dragStarted = false;
                    dragPointerId = null;
                    nodeElement.classList.remove('is-dragging');
                    hideSnapGuides();
                    if (shouldRenderAfterDrag) {
                        renderTree();
                        renderEditor();
                    }
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
        const payload = await window.CriptaMedia.uploadBlob(blob, {
            folder,
            fileName: safeFileName,
            token,
            campaignId: getCurrentCampaignId(),
            authError: 'Login richiesto per caricare immagini albero.'
        });
        return payload.path;
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

    const ensureEditableNodeLevels = (node) => {
        if (!node) return [];
        if (!Array.isArray(node.levels) || !node.levels.length) {
            node.levels = [{
                label: 'Livello 1',
                title: node.title || '',
                flavor: node.flavor || '',
                desc: node.desc || '',
                icon: node.icon || ''
            }];
        }
        return node.levels;
    };

    const saveTreeDefinition = async () => {
        const nextTrees = { ...(skillsMemoryCache || allSkillTrees || {}) };
        nextTrees[treeKey] = normalizeSkillTreeDefinitionForSave(workingTree);
        await saveSkillTreesData(nextTrees);
        workingTree = structuredClone(nextTrees[treeKey]);
        renderTree();
        renderEditor();
        alert('Albero abilita salvato.');
    };

    const buildConnectionSelectButton = (connection, direction = 'out') => {
        const sourceId = String(connection.source || '');
        const targetId = String(connection.target || '');
        const otherId = direction === 'in' ? sourceId : targetId;
        const icon = direction === 'in' ? 'fa-arrow-right-to-bracket' : 'fa-arrow-up-right-from-square';
        const modeLabel = connection.mode === 'exclusive' ? 'esclusivo' : 'normale';
        return `
            <button type="button" class="player-skill-relation-chip" data-skill-action="select-link" data-link-source="${escapeHtml(sourceId)}" data-link-target="${escapeHtml(targetId)}">
                <i class="fas ${icon}"></i>
                <span>${escapeHtml(getSkillTreeNodeLabel(workingTree, otherId))}</span>
                <small>${escapeHtml(modeLabel)}</small>
            </button>
        `;
    };

    const buildNodeRelationshipPanel = (node) => {
        if (!node) return '';
        const nodeId = String(node.id || '');
        const incoming = getIncomingSkillTreeConnections(workingTree, nodeId);
        const outgoing = getSkillTreeConnections(node).map((connection) => ({
            source: nodeId,
            target: String(connection.target),
            mode: connection.mode || 'normal'
        }));
        const requirementIds = new Set(getNodePrerequisites(node, workingTree).map(String));
        const explicitRequirements = hasExplicitNodePrerequisites(node);
        const otherNodes = (workingTree.nodes || []).filter((entry) => String(entry.id) !== nodeId);
        const modeLabel = getSkillTreeRequirementMode(node) === 'any'
            ? 'basta uno dei requisiti selezionati'
            : 'servono tutti i requisiti selezionati';
        const requirementRows = otherNodes.length
            ? otherNodes.map((entry) => {
                const id = String(entry.id);
                const isParent = incoming.some((connection) => connection.source === id);
                const isRequired = requirementIds.has(id);
                return `
                    <label class="player-skill-requirement-row ${isParent ? 'is-linked' : ''}">
                        <input type="checkbox" data-node-requirement-id="${escapeHtml(id)}" ${isRequired ? 'checked' : ''}>
                        <span>${escapeHtml(entry.title || entry.id)}</span>
                        ${isParent ? '<small>link entrante</small>' : ''}
                    </label>
                `;
            }).join('')
            : '<p class="player-skill-editor-help">Non ci sono altri nodi da usare come requisito.</p>';

        return `
            <details class="player-skill-editor-section player-skill-relations-editor" open>
                <summary>Relazioni e sblocco</summary>
                <div class="player-skill-relations-summary">
                    <div>
                        <span>Regola attiva</span>
                        <strong>${escapeHtml(modeLabel)}</strong>
                        <small>${explicitRequirements ? 'Lista requisiti esplicita' : 'Auto: i link entranti sono requisiti'}</small>
                    </div>
                    <div>
                        <span>Link entranti</span>
                        <strong>${incoming.length}</strong>
                        <small>Chi punta a questo nodo</small>
                    </div>
                    <div>
                        <span>Link uscenti</span>
                        <strong>${outgoing.length}</strong>
                        <small>Cosa parte da questo nodo</small>
                    </div>
                </div>
                <div class="player-skill-relations-grid">
                    <section>
                        <h5>Prerequisiti del nodo</h5>
                        <div class="player-skill-requirement-list">
                            ${requirementRows}
                        </div>
                        <div class="player-skill-relations-actions">
                            <button type="button" class="player-skill-action-button is-compact" data-skill-action="reset-requirements-auto">
                                <i class="fas fa-rotate-left"></i> Usa link entranti automatici
                            </button>
                        </div>
                    </section>
                    <section>
                        <h5>Link entranti</h5>
                        <div class="player-skill-relation-chip-list">
                            ${incoming.length ? incoming.map((connection) => buildConnectionSelectButton(connection, 'in')).join('') : '<p class="player-skill-editor-help">Nessun link entra in questo nodo.</p>'}
                        </div>
                    </section>
                    <section>
                        <h5>Link uscenti</h5>
                        <div class="player-skill-relation-chip-list">
                            ${outgoing.length ? outgoing.map((connection) => buildConnectionSelectButton(connection, 'out')).join('') : '<p class="player-skill-editor-help">Questo nodo non sblocca ancora altri nodi.</p>'}
                        </div>
                    </section>
                </div>
            </details>
        `;
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
        const selectedLinkIsRequirement = selectedSourceNode && selectedTargetNode
            ? getNodePrerequisites(selectedTargetNode, workingTree).map(String).includes(String(selectedSourceNode.id))
            : false;
        const selectedTargetUsesExplicitRequirements = hasExplicitNodePrerequisites(selectedTargetNode);
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
                    <div class="player-skill-link-requirement-state ${selectedLinkIsRequirement ? 'is-active' : ''}">
                        <span>Effetto sullo sblocco</span>
                        <strong>${selectedLinkIsRequirement ? 'Questo link attiva la destinazione' : 'Questo link è solo visivo'}</strong>
                        <small>${selectedTargetUsesExplicitRequirements ? 'La destinazione usa requisiti espliciti.' : 'Auto: ogni link entrante è requisito.'}</small>
                    </div>
                    <button type="button" class="player-skill-action-button is-compact" data-skill-action="toggle-link-requirement" data-link-source="${escapeHtml(selectedSourceNode.id)}" data-link-target="${escapeHtml(selectedTargetNode.id)}">
                        <i class="fas ${selectedLinkIsRequirement ? 'fa-link-slash' : 'fa-link'}"></i>
                        ${selectedLinkIsRequirement ? 'Togli dai requisiti' : 'Usa come requisito'}
                    </button>
                    <button type="button" class="player-skill-action-button is-danger" data-skill-action="delete-link"><i class="fas fa-unlink"></i> Rimuovi collegamento</button>
                </div>
            </details>
        ` : '';
        const allNodeLevels = Array.isArray(node?.levels) ? node.levels : [];
        const upgradeLevels = allNodeLevels.slice(1);
        const upgradeLevelsHtml = `
            <details class="player-skill-editor-section player-skill-level-editor" ${upgradeLevels.length ? 'open' : ''}>
                <summary>Livelli nodo</summary>
                <div class="player-skill-level-list">
                    ${upgradeLevels.length ? upgradeLevels.map((level, offset) => {
                        const index = offset + 1;
                        const currentDescription = getEffectiveSkillLevelDescription(node, index);
                        const currentEditorHtml = normalizeSkillLevelStoredHtml(currentDescription) || '<p><br></p>';
                        const previousDescription = getNodeLevelComparisonDescription(node, index);
                        return `
                            <div class="player-skill-level-row" data-skill-level-row="${index}">
                                <label class="player-skill-level-meta">Etichetta
                                    <input type="text" data-node-level-index="${index}" data-node-level-field="label" value="${escapeHtml(level.label || `Livello ${index + 1}`)}">
                                </label>
                                <label class="player-skill-level-meta">Titolo
                                    <input type="text" data-node-level-index="${index}" data-node-level-field="title" value="${escapeHtml(level.title || '')}" placeholder="vuoto = titolo base">
                                </label>
                                <button type="button" class="player-skill-action-button is-danger is-compact" data-skill-action="delete-node-level" data-node-level-index="${index}">
                                    <i class="fas fa-trash"></i> Livello
                                </button>
                                <div class="player-skill-level-text">
                                    <span>Testo livello</span>
                                    <div class="player-skill-rich-toolbar player-skill-level-rich-toolbar" role="toolbar" aria-label="Formato testo livello">
                                        <button type="button" data-skill-level-rich-command="bold" title="Grassetto"><i class="fas fa-bold" aria-hidden="true"></i></button>
                                        <button type="button" data-skill-level-rich-command="italic" title="Corsivo"><i class="fas fa-italic" aria-hidden="true"></i></button>
                                        <button type="button" data-skill-level-rich-command="insertUnorderedList" title="Elenco puntato"><i class="fas fa-list-ul" aria-hidden="true"></i></button>
                                        <button type="button" data-skill-level-rich-command="insertOrderedList" title="Elenco numerato"><i class="fas fa-list-ol" aria-hidden="true"></i></button>
                                    </div>
                                    <div class="player-skill-level-rich-editor" contenteditable="true" data-node-level-index="${index}" data-node-level-field="desc" spellcheck="true">${currentEditorHtml}</div>
                                </div>
                                ${renderSkillLevelDiffHtml(previousDescription, currentDescription, index)}
                            </div>
                        `;
                    }).join('') : '<p class="player-skill-editor-help">Nessun potenziamento. Il livello 1 usa il testo del nodo base.</p>'}
                </div>
                <button type="button" class="player-skill-action-button is-compact" data-skill-action="add-node-level"><i class="fas fa-plus"></i> Aggiungi livello</button>
            </details>
        `;
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
                <label>Regola prerequisiti
                    <select data-node-field="requiresMode">
                        <option value="all" ${getSkillTreeRequirementMode(node || {}) !== 'any' ? 'selected' : ''}>Tutti</option>
                        <option value="any" ${getSkillTreeRequirementMode(node || {}) === 'any' ? 'selected' : ''}>Uno qualsiasi</option>
                    </select>
                </label>
            </div>
            ${buildNodeRelationshipPanel(node)}
            ${upgradeLevelsHtml}
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
        const requirementId = target.dataset.nodeRequirementId;
        if (requirementId) {
            const node = readEditorNode();
            if (!node) return;
            if (target.checked) {
                addExplicitNodePrerequisite(node, requirementId);
            } else {
                removeExplicitNodePrerequisite(node, requirementId);
            }
            unlockedIds = pruneUnlockedSkillNodes(workingTree, unlockedIds);
            renderTree();
            renderEditor();
        }
    });

    editorPanel?.addEventListener('input', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const isFormControl = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
        const levelIndex = target.dataset.nodeLevelIndex;
        const levelField = target.dataset.nodeLevelField;
        if (levelIndex !== undefined && levelField) {
            const node = readEditorNode();
            const levels = ensureEditableNodeLevels(node);
            const index = Math.max(1, Math.round(Number(levelIndex) || 1));
            if (!levels[index]) levels[index] = { label: `Livello ${index + 1}`, title: '', flavor: '', desc: '', icon: '' };
            if (levelField === 'desc' || levelField === 'description') {
                const editorHtml = target.isContentEditable
                    ? normalizeSkillTreeEditableHtml(target)
                    : skillLevelEditorTextToHtml(target.value);
                levels[index][levelField] = normalizeSkillLevelStoredHtml(editorHtml);
                refreshSkillLevelDiffPreview(target.closest('.player-skill-level-row'), node, index);
            } else if (isFormControl) {
                levels[index][levelField] = target.value;
            }
            return;
        }
        if (!isFormControl) return;
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
                    values.forEach((targetId) => {
                        const targetNode = workingTree.nodes.find((entry) => String(entry.id) === String(targetId));
                        if (hasExplicitNodePrerequisites(targetNode)) addExplicitNodePrerequisite(targetNode, node.id);
                    });
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

    infoPanel.addEventListener('click', (event) => {
        const button = event.target.closest('[data-skill-rich-command]');
        if (!editMode || !canEditTree || !button) return;
        event.preventDefault();
        const node = readEditorNode();
        const descEditor = infoPanel.querySelector('[data-skill-preview-field="desc"]');
        if (!node || !(descEditor instanceof HTMLElement)) return;
        descEditor.focus();
        document.execCommand(button.dataset.skillRichCommand, false, null);
        node.desc = normalizeSkillTreeEditableHtml(descEditor);
    });

    infoPanel.addEventListener('mousedown', (event) => {
        if (event.target.closest('[data-skill-rich-command]')) {
            event.preventDefault();
        }
    });

    infoPanel.addEventListener('blur', (event) => {
        if (!editMode || !canEditTree || !(event.target instanceof HTMLElement)) return;
        if (!event.target.dataset.skillPreviewField) return;
        renderTree();
        renderEditor();
    }, true);

    editorPanel?.addEventListener('mousedown', (event) => {
        if (event.target.closest('[data-skill-level-rich-command]')) {
            event.preventDefault();
        }
    });

    editorPanel?.addEventListener('click', async (event) => {
        const richButton = event.target.closest('[data-skill-level-rich-command]');
        if (richButton) {
            event.preventDefault();
            const row = richButton.closest('[data-skill-level-row]');
            const descEditor = row?.querySelector('[data-node-level-field="desc"]');
            if (!(descEditor instanceof HTMLElement)) return;
            descEditor.focus();
            document.execCommand(richButton.dataset.skillLevelRichCommand, false, null);
            const node = readEditorNode();
            const levels = ensureEditableNodeLevels(node);
            const index = Math.max(1, Math.round(Number(descEditor.dataset.nodeLevelIndex) || 1));
            if (!levels[index]) levels[index] = { label: `Livello ${index + 1}`, title: '', flavor: '', desc: '', icon: '' };
            levels[index].desc = normalizeSkillLevelStoredHtml(normalizeSkillTreeEditableHtml(descEditor));
            refreshSkillLevelDiffPreview(row, node, index);
            return;
        }
        const button = event.target.closest('[data-skill-action]');
        if (!button) return;
        const action = button.dataset.skillAction;
        if (action === 'delete-link') {
            deleteSelectedConnection();
            return;
        }
        if (action === 'select-link') {
            const source = String(button.dataset.linkSource || '');
            const target = String(button.dataset.linkTarget || '');
            if (source && target) {
                selectedConnection = { source, target };
                selectedNodeId = target;
                const targetNode = workingTree.nodes.find((entry) => String(entry.id) === target);
                if (targetNode) updateInfo(targetNode);
                renderTree();
                renderEditor();
            }
            return;
        }
        if (action === 'toggle-link-requirement') {
            const source = String(button.dataset.linkSource || selectedConnection?.source || '');
            const target = String(button.dataset.linkTarget || selectedConnection?.target || '');
            const targetNode = workingTree.nodes.find((entry) => String(entry.id) === target);
            if (!source || !targetNode) return;
            const currentRequirements = getNodePrerequisites(targetNode, workingTree).map(String);
            if (currentRequirements.includes(source)) {
                const explicit = hasExplicitNodePrerequisites(targetNode)
                    ? getExplicitNodePrerequisites(targetNode)
                    : currentRequirements;
                setExplicitNodePrerequisites(targetNode, explicit.filter((entry) => String(entry) !== source));
            } else {
                addExplicitNodePrerequisite(targetNode, source);
            }
            unlockedIds = pruneUnlockedSkillNodes(workingTree, unlockedIds);
            renderTree();
            renderEditor();
            return;
        }
        if (action === 'reset-requirements-auto') {
            const node = readEditorNode();
            if (!node) return;
            delete node.requires;
            delete node.requirements;
            unlockedIds = pruneUnlockedSkillNodes(workingTree, unlockedIds);
            renderTree();
            renderEditor();
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
        if (action === 'add-node-level') {
            const node = readEditorNode();
            if (!node) return;
            const levels = ensureEditableNodeLevels(node);
            const previousIndex = Math.max(0, levels.length - 1);
            const previousLevel = levels[previousIndex] || null;
            const previousDescription = getEffectiveSkillLevelDescription(node, previousIndex);
            levels.push({
                label: `Livello ${levels.length + 1}`,
                title: previousLevel?.title || node.title || '',
                flavor: previousLevel?.flavor || '',
                desc: normalizeSkillLevelStoredHtml(previousDescription || node.desc || '<p>Descrizione potenziamento.</p>'),
                icon: ''
            });
            renderTree();
            renderEditor();
        }
        if (action === 'delete-node-level') {
            const node = readEditorNode();
            const index = Math.max(1, Math.round(Number(button.dataset.nodeLevelIndex) || 1));
            if (!node || !Array.isArray(node.levels) || !node.levels[index]) return;
            node.levels.splice(index, 1);
            Object.keys(nodeLevels).forEach((nodeId) => {
                if (nodeId === String(node.id)) nodeLevels[nodeId] = Math.min(Number(nodeLevels[nodeId]) || 1, getSkillNodeLevels(node).length);
            });
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
            delete nodeLevels[id];
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

    deleteButton?.addEventListener('click', async () => {
        const label = workingTree.name || workingTree.title || treeKey || 'questo albero';
        const confirmed = window.confirm(`Eliminare definitivamente l'albero abilita "${label}"?`);
        if (!confirmed) return;
        deleteButton.disabled = true;
        editToggle?.setAttribute('disabled', 'disabled');
        try {
            await deleteSkillTreeData(treeKey, workingTree, allSkillTrees);
            window.location.reload();
        } catch (error) {
            console.error('Eliminazione albero abilita fallita:', error);
            alert(`Eliminazione albero fallita: ${error?.message || error}`);
            deleteButton.disabled = false;
            editToggle?.removeAttribute('disabled');
        }
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
                <button type="button" class="player-skill-action-button is-primary is-compact" data-skill-create-shared-tree title="Crea un albero condiviso da tutta la campagna">
                    <i class="fas fa-users"></i> Condiviso
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

    const createSkillTree = async (shared = false) => {
        const name = window.prompt(shared ? 'Nome nuovo albero abilita condiviso' : 'Nome nuovo albero abilita', shared ? 'Albero condiviso' : 'Nuovo albero');
        if (name === null) return;
        const cleanName = name.trim() || (shared ? 'Albero condiviso' : 'Nuovo albero');
        const baseKey = shared ? 'campaign' : slugify(character.id || character.accountId || character.name || 'personaggio');
        const key = `${baseKey}-${slugify(cleanName || 'albero')}-${Date.now().toString(36)}`;
        const nextTrees = { ...(skillsMemoryCache || allSkillTrees || {}) };
        nextTrees[key] = {
            id: key,
            key,
            name: cleanName,
            scope: shared ? 'campaign' : 'character',
            shared,
            ownerCharacterId: shared ? '' : (character.id || ''),
            characterId: shared ? '' : (character.id || ''),
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
    };

    const renderActiveTree = () => {
        const total = cards.length;
        if (!total) {
            activeTreeIndex = 0;
            viewport.innerHTML = '<div class="player-skill-tree-empty"><span>Nessun albero abilita configurato.</span></div>';
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
        toolbar.querySelector('[data-skill-create-tree]')?.addEventListener('click', () => createSkillTree(false));
        toolbar.querySelector('[data-skill-create-shared-tree]')?.addEventListener('click', () => createSkillTree(true));
    }

    renderActiveTree();

    return cards.length || skillTreeCurrentUserIsDm ? stack : null;
}

    function buildCards(characterOrId, allSkillTrees, context = {}) {
        applySkillTreeRuntime(context);
        return buildPlayerSkillTreeCards(characterOrId, allSkillTrees);
    }

    function resolveEntries(characterOrId, allSkillTrees, context = {}) {
        applySkillTreeRuntime(context);
        return resolvePlayerSkillTreeEntries(characterOrId, allSkillTrees);
    }

    window.CriptaCharacterSkillTree = Object.freeze({
        buildCards,
        resolveEntries,
        resolveTree(characterOrId, allSkillTrees, context = {}) {
            applySkillTreeRuntime(context);
            return resolvePlayerSkillTree(characterOrId, allSkillTrees);
        }
    });
})();
