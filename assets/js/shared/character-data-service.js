(function () {
    const bootstrapCache = new Map();

    function getCampaignId() {
        return window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue";
    }

    function buildCacheKey(characterId, type) {
        return `${getCampaignId()}::${String(type || "player")}::${String(characterId || "")}`;
    }

    async function loadBootstrap(characterId, type = "player", options = {}) {
        const key = buildCacheKey(characterId, type);
        if (options.cache !== false && bootstrapCache.has(key)) return bootstrapCache.get(key);

        const request = window.CriptaApp.api.get("api/bootstrap/character", {
            query: {
                id: characterId,
                type
            },
            cache: options.cache !== false,
            cacheTtlMs: options.cacheTtlMs || 45 * 1000
        });

        if (options.cache !== false) bootstrapCache.set(key, request);
        try {
            return await request;
        } catch (error) {
            bootstrapCache.delete(key);
            throw error;
        }
    }

    function getCollection(bootstrap, collection) {
        const doc = bootstrap?.data?.[collection];
        return Array.isArray(doc?.data) ? doc.data : null;
    }

    function getCollectionDocument(bootstrap, collection) {
        return bootstrap?.data?.[collection] || null;
    }

    function clear() {
        bootstrapCache.clear();
    }

    window.CriptaCharacterData = {
        loadBootstrap,
        getCollection,
        getCollectionDocument,
        clear
    };
})();
