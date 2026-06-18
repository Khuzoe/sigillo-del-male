(function () {
    const bootstrapCache = new Map();
    const syncStatusCache = new Map();
    let syncStatusUnavailableUntil = 0;

    function getCampaignId(options = {}) {
        const urlCampaign = new URLSearchParams(window.location.search).get("campaign");
        return options.campaignId || urlCampaign || window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue";
    }

    function buildCacheKey(characterId, type, campaignId = getCampaignId()) {
        return `${campaignId}::${String(type || "player")}::${String(characterId || "")}`;
    }

    async function loadSyncStatus(options = {}) {
        const campaignId = getCampaignId(options);
        const key = `${campaignId}::status`;
        const now = Date.now();
        const cached = syncStatusCache.get(key);
        if (options.cache !== false && cached && cached.expiresAt > now) return cached.payload;
        if (syncStatusUnavailableUntil > now || typeof window.CriptaApp?.sync?.status !== "function") return null;

        try {
            const payload = await window.CriptaApp.sync.status({
                campaignId,
                cache: false
            });
            syncStatusCache.set(key, {
                expiresAt: now + Number(options.cacheTtlMs || 30 * 1000),
                payload
            });
            return payload;
        } catch (error) {
            syncStatusUnavailableUntil = now + 5 * 60 * 1000;
            console.warn("Sync status non disponibile, uso bootstrap legacy.", error);
            return null;
        }
    }

    async function loadBootstrap(characterId, type = "player", options = {}) {
        const campaignId = getCampaignId(options);
        const key = buildCacheKey(characterId, type, campaignId);
        if (options.cache !== false && bootstrapCache.has(key)) return bootstrapCache.get(key);

        const request = (async () => {
            const [legacyBootstrap, syncStatus] = await Promise.all([
                window.CriptaApp.api.get("api/bootstrap/character", {
                    query: {
                        id: characterId,
                        type,
                        campaign: campaignId,
                        campaignId
                    },
                    cache: options.cache !== false,
                    cacheTtlMs: options.cacheTtlMs || 45 * 1000
                }),
                loadSyncStatus({
                    campaignId,
                    cache: options.cache !== false,
                    cacheTtlMs: options.syncCacheTtlMs || 30 * 1000
                })
            ]);

            return syncStatus ? { ...legacyBootstrap, syncStatus } : legacyBootstrap;
        })();

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
        syncStatusCache.clear();
    }

    window.CriptaCharacterData = {
        loadBootstrap,
        loadSyncStatus,
        getCollection,
        getCollectionDocument,
        clear
    };
})();
