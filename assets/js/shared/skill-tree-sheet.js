(function () {
    const definitions = 'api/data/skill-trees', progress = 'api/data/skill-tree-states';
    const conflict = () => Object.assign(new Error('I dati online sono cambiati. Ricarica la scheda prima di salvare.'),{code:'VERSION_CONFLICT'});
    const idOf = record => record.id || record.key;
    const versioned = version => Number.isSafeInteger(version) && version >= 0;
    const api = () => window.CriptaApp.api;
    const read = (path, token) => api().get(path, {token, cache:false, query:{_:Date.now()}});

    async function load(character, legacyKey, token) {
        const result = await api().get('api/skill-trees/sheet', {token,cache:false,
            query:{id:character.id,type:character.isNpc ? 'npc' : 'player',legacyKey:legacyKey || ''}});
        if (!result?.trees?.ok || !result?.progress?.ok) throw new Error('Raccolta degli alberi non disponibile.');
        if (result.scoped && (!result.trees.treeRevisions || !result.progress.stateRevisions ||
            !versioned(result.trees.version) || !versioned(result.progress.version))) throw conflict();
        return result;
    }

    function staticRecords(data) {
        if (!data || typeof data !== 'object') return null;
        const records = Array.isArray(data) ? data : Object.entries(data).map(([id, tree]) => ({...tree,id}));
        if (records.some(record => !record || !idOf(record) || !Array.isArray((record.tree || record).nodes))) return null;
        return new Set(records.map(idOf)).size === records.length ? records : null;
    }
    function replaceTree(records, tree) {
        let found = false;
        const next = records.map(record => {
            if (idOf(record) !== tree.id) return record;
            found = true;
            return record.tree ? {...record,tree} : tree;
        });
        return found ? next : [...next,tree];
    }
    async function save(tree, cache, token, displayedRevision) {
        if (!token || !versioned(cache.version)) throw new Error('Ricarica i dati online prima di salvare l’albero.');
        const post = body => api().post(definitions, body, {token});
        const revision = displayedRevision ?? cache.revisions?.[tree.id] ?? 0;
        if (displayedRevision !== undefined && displayedRevision !== cache.revisions?.[tree.id]) throw conflict();
        let result;
        try {
            if (cache.staticRecords) result = await post({data:replaceTree(cache.staticRecords,tree),staticTreeId:tree.id,expectedVersion:cache.version});
            else result = await post(cache.revisions ? {tree,expectedTreeRevision:revision,responseMode:'revision'} : {tree,expectedVersion:cache.version});
        } catch (error) {
            const status = error?.response?.status || error?.status;
            if (cache.staticRecords || Number(status) !== 400 || !/expected an array/i.test(error?.payload?.error || error?.message)) throw error;
            const full = await read(definitions,token);
            if (!Array.isArray(full?.data) || full.version !== cache.version) throw conflict();
            result = await post({data:replaceTree(full.data,tree),expectedVersion:full.version});
        }
        if (Array.isArray(result?.data)) return result;
        if ((!cache.revisions || cache.staticRecords) && result?.saved === true && result.version === cache.version+1) return result;
        if (result?.saved !== true || result.treeId !== tree.id || result.treeRevision !== revision+1 || !versioned(result.version)) throw conflict();
        return result;
    }

    async function remove(id, cache, token, displayedRevision) {
        if (!token || !versioned(cache.version)) throw conflict();
        // A sheet contains only a subset. Base this explicit collection operation on
        // fresh raw documents, preserving wrappers, unknown fields and other owners.
        const [trees, states] = await Promise.all([read(definitions,token),read(progress,token)]);
        const records = trees?.source === 'static' ? cache.staticRecords : trees?.data;
        const treeVersion = trees?.version ?? (trees?.source === 'static' ? 0 : null);
        if (!Array.isArray(records) || !versioned(treeVersion) || !records.some(row => idOf(row) === id)) throw conflict();
        if (cache.revisions && trees.treeRevisions && !cache.staticRecords) {
            if ((displayedRevision ?? cache.revisions[id]) !== trees.treeRevisions[id]) throw conflict();
        } else if (treeVersion !== cache.version) throw conflict();
        if (!Array.isArray(states?.data) && states?.source !== 'static') throw conflict();
        const others = records.filter(row => idOf(row) !== id);
        const stateRows = states.data || [];
        const kept = stateRows.filter(row => row.treeKey !== id);
        if (kept.length !== stateRows.length && !versioned(states.version)) throw conflict();
        const removed = await api().post(definitions,{data:others,expectedVersion:treeVersion,...(trees.source === 'static' && {staticTreeId:id})},{token});
        if (!removed?.saved || !versioned(removed.version) || removed.version <= treeVersion || removed.data?.some(row => idOf(row) === id)) throw conflict();
        if (kept.length !== stateRows.length) {
            try { await api().post(progress,{data:kept,expectedVersion:states.version},{token}); }
            catch { throw new Error('Albero eliminato. La pulizia dei suoi progressi non è stata confermata. Ricarica la scheda.'); }
        }
    }
    window.CriptaSkillTreeSheet = Object.freeze({load,save,remove,staticRecords});
})();
