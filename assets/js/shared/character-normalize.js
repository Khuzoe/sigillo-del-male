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
        return window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue";
    }

    function getEntitySlug(entity, fallback = "npc") {
        if (entity && typeof entity === "object") {
            return slugify(entity.id || entity.name || fallback, fallback);
        }
        return slugify(entity || fallback, fallback);
    }

    function getSyncedNpcImagePath(character, variant = "avatar") {
        return `media/campaigns/${getCurrentCampaignId()}/characters/${getEntitySlug(character, "npc")}/${variant}.webp`;
    }

    function getSyncedPlayerImagePath(player, variant = "avatar") {
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
            const images = { ...raw };
            if (!images.hover) images.hover = images.avatar || images.portrait || "";
            if (!images.avatar) images.avatar = images.portrait || images.hover || "";
            return images;
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
