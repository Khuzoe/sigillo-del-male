(function () {
    function slugify(value, fallback = "npc") {
        if (typeof window.CriptaApp?.utils?.slugify === "function") {
            return window.CriptaApp.utils.slugify(value, fallback);
        }
        const slug = String(value || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        return slug || fallback;
    }

    function getCurrentCampaignId() {
        try {
            const params = new URLSearchParams(window.location.search);
            const urlCampaign = params.get("campaign") || params.get("campaignId");
            if (urlCampaign) return urlCampaign;
        } catch (_) {
            // Ignore malformed locations.
        }
        return window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue";
    }

    function getEntitySlug(entity, fallback = "npc") {
        if (typeof window.CriptaMedia?.getMediaSlug === "function") {
            return window.CriptaMedia.getMediaSlug(entity, fallback);
        }
        if (entity && typeof entity === "object") {
            return slugify(
                entity.mediaSlug
                    || entity.media_slug
                    || entity.mediaId
                    || entity.media_id
                    || entity.folderSlug
                    || entity.folder_slug
                    || entity.id
                    || entity.name
                    || fallback,
                fallback
            );
        }
        return slugify(entity || fallback, fallback);
    }

    function getSyncedNpcImagePath(character, variant = "avatar") {
        if (typeof window.CriptaMedia?.buildNpcMediaPath === "function") {
            return window.CriptaMedia.buildNpcMediaPath(character, variant, { campaignId: getCurrentCampaignId() });
        }
        return `media/campaigns/${getCurrentCampaignId()}/characters/${getEntitySlug(character, "npc")}/${variant}.webp`;
    }

    function getSyncedPlayerImagePath(player, variant = "avatar") {
        if (typeof window.CriptaMedia?.buildPlayerMediaPath === "function") {
            return window.CriptaMedia.buildPlayerMediaPath(player, variant, { campaignId: getCurrentCampaignId() });
        }
        const playerId = getEntitySlug(player, "personaggio");
        const suffix = variant === "token"
            ? "-token"
            : variant === "hover"
                ? "-hover"
                : variant === "idle" || variant === "card"
                    ? "-idle"
                    : "-avatar";
        return `media/campaigns/${getCurrentCampaignId()}/players/${playerId}${suffix}.webp`;
    }

    function normalizeCategoryPriority(value) {
        if (value === "" || value === null || value === undefined) return null;
        const number = Number(value);
        return Number.isFinite(number) ? Math.trunc(number) : null;
    }

    function normalizeCharacterImages(character) {
        const raw = character?.images || {};
        if ((character?.type || "npc") === "player") {
            const legacyAvatar = raw.avatar || raw.portrait || raw.hover || "";
            const legacyToken = raw.token || "";
            return {
                ...raw,
                idle: getSyncedPlayerImagePath(character, "idle"),
                hover: getSyncedPlayerImagePath(character, "hover"),
                token: getSyncedPlayerImagePath(character, "token"),
                avatar: getSyncedPlayerImagePath(character, "avatar"),
                portrait: getSyncedPlayerImagePath(character, "avatar"),
                idleFallback: raw.idleFallback || raw.idle || legacyAvatar,
                hoverFallback: raw.hoverFallback || raw.hover || legacyAvatar,
                tokenFallback: raw.tokenFallback || legacyToken,
                avatarFallback: raw.avatarFallback || legacyAvatar,
                portraitFallback: raw.portraitFallback || legacyAvatar
            };
        }

        const token = raw.token || getSyncedNpcImagePath(character, "token");
        const legacyList = raw.avatar || raw.portrait || raw.hover || "";
        return {
            ...raw,
            idle: raw.idle || raw.card || raw.list || raw.showcase || getSyncedNpcImagePath(character, "idle"),
            hover: raw.hover || raw.cardHover || raw.listHover || raw.showcaseHover || getSyncedNpcImagePath(character, "hover"),
            token,
            avatar: raw.avatar || raw.portrait || getSyncedNpcImagePath(character, "avatar"),
            idleFallback: raw.idleFallback || token || legacyList,
            hoverFallback: raw.hoverFallback || token || legacyList,
            avatarFallback: raw.avatarFallback || raw.portrait || legacyList
        };
    }

    function normalizeCharacter(character, options = {}) {
        const normalized = { ...(character || {}) };
        if (options.includeOriginalId) {
            normalized._originalId = getEntitySlug(character, "npc");
        }
        normalized.category = normalized.category || normalized.group || normalized.faction || "";
        const explicitMediaSlug = normalized.mediaSlug || normalized.media_slug || normalized.mediaId || normalized.media_id || "";
        if (explicitMediaSlug) normalized.mediaSlug = explicitMediaSlug;
        normalized.categoryPriority = normalizeCategoryPriority(normalized.categoryPriority);
        if (typeof options.normalizeBlocks === "function") {
            normalized.content_blocks = options.normalizeBlocks(normalized);
        }
        normalized.images = normalizeCharacterImages(normalized);
        return normalized;
    }

    function normalizeCharactersCollection(characters, options = {}) {
        return (Array.isArray(characters) ? characters : []).map((character) => normalizeCharacter(character, options));
    }

    function normalizeImageAdjust(adjust) {
        return window.CriptaImageAdjust.normalizePixelAdjust(adjust);
    }

    function buildNpcImageStyle(kind, adjust, counterpartAdjust) {
        return window.CriptaImageAdjust.buildNpcImageStyle(kind, adjust, counterpartAdjust);
    }

    window.CriptaCharacterNormalize = {
        buildNpcImageStyle,
        getCurrentCampaignId,
        getSyncedNpcImagePath,
        getSyncedPlayerImagePath,
        normalizeCategoryPriority,
        normalizeCharacter,
        normalizeCharacterImages,
        normalizeCharactersCollection,
        normalizeImageAdjust,
        slugify
    };
})();
