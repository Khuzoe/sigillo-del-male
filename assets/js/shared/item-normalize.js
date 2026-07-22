(function () {
    const ITEM_TYPES = [
        { value: "Arma", icon: "fa-khanda" },
        { value: "Armatura", icon: "fa-shield-halved" },
        { value: "Anello", icon: "fa-ring" },
        { value: "Bacchetta", icon: "fa-wand-sparkles" },
        { value: "Bastone", icon: "fa-staff-snake" },
        { value: "Oggetto meraviglioso", icon: "fa-hat-wizard" },
        { value: "Pergamena", icon: "fa-scroll" },
        { value: "Pozione", icon: "fa-flask-vial" },
        { value: "Materiali", icon: "fa-cubes-stacked" },
        { value: "Bottino", icon: "fa-gem" },
        { value: "Scudo", icon: "fa-shield" },
        { value: "Verga", icon: "fa-wand-magic-sparkles" }
    ];

    const ITEM_RARITIES = [
        { value: "Comune", icon: "fa-circle" },
        { value: "Non comune", icon: "fa-circle-plus" },
        { value: "Raro", icon: "fa-gem" },
        { value: "Epico", icon: "fa-star" },
        { value: "Molto raro", icon: "fa-star" },
        { value: "Leggendario", icon: "fa-crown" },
        { value: "Artefatto", icon: "fa-sun" },
        { value: "Sconosciuta", icon: "fa-circle-question" }
    ];

    const MATERIAL_TOKENS = ["materiale", "materiali", "minerale", "minerali", "reagente", "reagenti", "ingrediente", "ingredienti"];

    function normalizeSearch(value) {
        return String(value || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    }

    function slugify(value, fallback = "item") {
        if (typeof window.CriptaApp?.utils?.slugify === "function") {
            return window.CriptaApp.utils.slugify(value, fallback);
        }
        return normalizeSearch(value)
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || fallback;
    }

    function isHiddenItem(item) {
        return item?.hidden === true || item?.status === "hidden";
    }

    function isArchivedItem(item) {
        return item?.archived === true || String(item?.status || "").trim().toLowerCase() === "archived";
    }

    function filterVisibleItems(items, { includeHidden = false, includeArchived = false } = {}) {
        const list = Array.isArray(items) ? items : [];
        const visible = includeHidden
            ? list
            : window.WikiSpoiler
                ? window.WikiSpoiler.filterVisible(list)
                : list.filter(item => !isHiddenItem(item));
        return includeArchived ? visible : visible.filter(item => !isArchivedItem(item));
    }

    function getItemCategory(item) {
        const type = String(item?.type || "").trim();
        const subtype = String(item?.subtype || "").trim();
        const name = String(item?.name || "").trim();
        const haystack = [type, subtype, name].map(normalizeSearch);
        const isMaterial = haystack.some((value) => MATERIAL_TOKENS.some((token) => value === token || value.includes(token)));
        return isMaterial ? "Materiali" : type;
    }

    function isMaterialItem(item) {
        return getItemCategory(item) === "Materiali";
    }

    function getItemTypeMeta(type) {
        const label = String(type || "").trim();
        const meta = ITEM_TYPES.find(item => item.value.toLowerCase() === label.toLowerCase());
        return meta ? { label: meta.value, icon: meta.icon } : { label: label || "Oggetto", icon: "fa-box-open" };
    }

    function getItemRarityMeta(rarity) {
        const label = String(rarity || "Sconosciuta").trim();
        const meta = ITEM_RARITIES.find(item => item.value.toLowerCase() === label.toLowerCase());
        return meta ? { label: meta.value, icon: meta.icon } : { label, icon: "fa-circle-question" };
    }

    function getItemRarityFrameClass(rarity) {
        const normalized = normalizeSearch(rarity);
        if (normalized === "comune") return "item-rarity-frame--common";
        if (normalized === "non comune") return "item-rarity-frame--uncommon";
        if (normalized === "raro") return "item-rarity-frame--rare";
        if (normalized === "epico" || normalized === "molto raro") return "item-rarity-frame--epic";
        if (normalized === "leggendario") return "item-rarity-frame--legendary";
        if (normalized === "artefatto") return "item-rarity-frame--artifact";
        return "";
    }

    function normalizeMaterialTags(value) {
        if (!Array.isArray(value)) return [];
        return value
            .map((tag) => {
                if (typeof tag === "string") {
                    const name = tag.trim();
                    return name ? { name, description: "" } : null;
                }
                if (!tag || typeof tag !== "object") return null;
                const name = String(tag.name || tag.label || tag.tag || "").trim();
                const description = String(tag.description || tag.desc || tag.note || "").trim();
                const hidden = tag.hidden === true;
                if (!name && !description) return null;
                return { name, description, hidden };
            })
            .filter(Boolean);
    }

    function getVisibleMaterialTags(item) {
        const source = Array.isArray(item?.materialTags)
            ? item.materialTags
            : Array.isArray(item?.tags)
                ? item.tags
                : item?.properties;
        return normalizeMaterialTags(source).filter(tag => tag.hidden !== true);
    }

    function formatWeightValue(value) {
        const text = String(value ?? "").trim();
        return /^-?\d+(?:[.,]\d+)?$/.test(text) ? `${text.replace(".", ",")} kg` : text;
    }

    function getItemImagePath(item) {
        return String(item?.image || item?.img || item?.icon || item?.avatar || "").trim();
    }

    window.CriptaItemNormalize = {
        ITEM_RARITIES,
        ITEM_TYPES,
        filterVisibleItems,
        formatWeightValue,
        getItemCategory,
        getItemImagePath,
        getItemRarityFrameClass,
        getItemRarityMeta,
        getItemTypeMeta,
        getVisibleMaterialTags,
        isArchivedItem,
        isHiddenItem,
        isMaterialItem,
        normalizeMaterialTags,
        normalizeSearch,
        slugify
    };
})();
