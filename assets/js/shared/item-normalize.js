(function () {
    const ITEM_FAMILIES = [
        { value: "weapon", label: "Arma", icon: "fa-khanda", foundryType: "weapon" },
        { value: "armor", label: "Armatura", icon: "fa-shield-halved", foundryType: "equipment" },
        { value: "consumable", label: "Consumabile", icon: "fa-flask-vial", foundryType: "consumable" },
        { value: "equipment", label: "Equipaggiamento", icon: "fa-hat-wizard", foundryType: "equipment" },
        { value: "tool", label: "Strumento", icon: "fa-hammer", foundryType: "tool" },
        { value: "material", label: "Materiale", icon: "fa-cubes-stacked", foundryType: "loot" },
        { value: "loot", label: "Bottino", icon: "fa-gem", foundryType: "loot" },
        { value: "container", label: "Contenitore", icon: "fa-box-open", foundryType: "container" }
    ];

    const ITEM_SUBTYPES = {
        weapon: [
            { value: "simpleM", label: "Semplice da mischia" },
            { value: "simpleR", label: "Semplice a distanza" },
            { value: "martialM", label: "Marziale da mischia" },
            { value: "martialR", label: "Marziale a distanza" },
            { value: "natural", label: "Naturale" },
            { value: "improv", label: "Improvvisata" },
            { value: "siege", label: "D'assedio" }
        ],
        armor: [
            { value: "light", label: "Leggera" },
            { value: "medium", label: "Media" },
            { value: "heavy", label: "Pesante" },
            { value: "natural", label: "Naturale" },
            { value: "shield", label: "Scudo" }
        ],
        consumable: [
            { value: "ammo", label: "Munizione" },
            { value: "potion", label: "Pozione" },
            { value: "poison", label: "Veleno" },
            { value: "food", label: "Cibo" },
            { value: "scroll", label: "Pergamena" },
            { value: "wand", label: "Bacchetta consumabile" },
            { value: "rod", label: "Verga consumabile" },
            { value: "trinket", label: "Monile consumabile" }
        ],
        equipment: [
            { value: "clothing", label: "Abbigliamento" },
            { value: "ring", label: "Anello" },
            { value: "rod", label: "Verga" },
            { value: "trinket", label: "Monile" },
            { value: "vehicle", label: "Veicolo" },
            { value: "wand", label: "Bacchetta" },
            { value: "wondrous", label: "Oggetto meraviglioso" }
        ],
        tool: [
            { value: "art", label: "Strumento da artigiano" },
            { value: "game", label: "Set da gioco" },
            { value: "music", label: "Strumento musicale" }
        ],
        material: [{ value: "material", label: "Materiale" }],
        loot: [
            { value: "art", label: "Oggetto d'arte" },
            { value: "gear", label: "Equipaggiamento comune" },
            { value: "gem", label: "Gemma" },
            { value: "junk", label: "Cianfrusaglia" },
            { value: "material", label: "Materiale" },
            { value: "resource", label: "Risorsa" },
            { value: "treasure", label: "Tesoro" }
        ],
        container: []
    };

    const ITEM_TYPES = [
        { value: "Arma", icon: "fa-khanda" },
        { value: "Armatura", icon: "fa-shield-halved" },
        { value: "Anello", icon: "fa-ring" },
        { value: "Bacchetta", icon: "fa-wand-sparkles" },
        { value: "Bastone", icon: "fa-staff-snake" },
        { value: "Oggetto meraviglioso", icon: "fa-hat-wizard" },
        { value: "Pergamena", icon: "fa-scroll" },
        { value: "Pozione", icon: "fa-flask-vial" },
        { value: "Consumabile", icon: "fa-flask-vial" },
        { value: "Equipaggiamento", icon: "fa-shirt" },
        { value: "Strumento", icon: "fa-hammer" },
        { value: "Materiali", icon: "fa-cubes-stacked" },
        { value: "Bottino", icon: "fa-gem" },
        { value: "Contenitore", icon: "fa-box-open" },
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

    const LEGACY_CLASSIFICATIONS = {
        arma: { family: "weapon", subtype: "" },
        armatura: { family: "armor", subtype: "" },
        anello: { family: "equipment", subtype: "ring" },
        bacchetta: { family: "equipment", subtype: "wand" },
        bastone: { family: "equipment", subtype: "wondrous" },
        "oggetto meraviglioso": { family: "equipment", subtype: "wondrous" },
        pergamena: { family: "consumable", subtype: "scroll" },
        pozione: { family: "consumable", subtype: "potion" },
        consumabile: { family: "consumable", subtype: "" },
        materiali: { family: "material", subtype: "material" },
        materiale: { family: "material", subtype: "material" },
        bottino: { family: "loot", subtype: "" },
        scudo: { family: "armor", subtype: "shield" },
        verga: { family: "equipment", subtype: "rod" },
        strumento: { family: "tool", subtype: "" },
        contenitore: { family: "container", subtype: "" },
        equipaggiamento: { family: "equipment", subtype: "" }
    };

    function cleanClassificationValue(value, maxLength = 80) {
        return String(value || "").trim().slice(0, maxLength);
    }

    function getItemFamilyMeta(family) {
        const value = cleanClassificationValue(family).toLowerCase();
        return ITEM_FAMILIES.find(entry => entry.value === value)
            || ITEM_FAMILIES.find(entry => entry.value === "equipment");
    }

    function getItemSubtypeOptions(family) {
        return Array.isArray(ITEM_SUBTYPES[cleanClassificationValue(family).toLowerCase()])
            ? ITEM_SUBTYPES[cleanClassificationValue(family).toLowerCase()].map(entry => ({ ...entry }))
            : [];
    }

    function familyForFoundryDocument(document) {
        const type = cleanClassificationValue(document?.type).toLowerCase();
        const mechanicalType = cleanClassificationValue(document?.system?.type?.value);
        if (type === "weapon") return "weapon";
        if (type === "consumable") return "consumable";
        if (type === "tool") return "tool";
        if (type === "container") return "container";
        if (type === "loot") return mechanicalType === "material" ? "material" : "loot";
        if (type === "equipment") {
            return getItemSubtypeOptions("armor").some(entry => entry.value === mechanicalType)
                ? "armor"
                : "equipment";
        }
        return "";
    }

    function legacyClassification(item) {
        const type = normalizeSearch(item?.type).trim();
        return LEGACY_CLASSIFICATIONS[type] || null;
    }

    function normalizeItemClassification(item) {
        const source = item?.classification && typeof item.classification === "object" && !Array.isArray(item.classification)
            ? item.classification
            : {};
        const document = item?.foundry?.document && typeof item.foundry.document === "object"
            ? item.foundry.document
            : { type: item?.foundryType || "", system: item?.foundrySystem || {} };
        const legacy = legacyClassification(item);
        const systemType = cleanClassificationValue(document?.system?.type?.value);
        const systemFamily = familyForFoundryDocument(document);
        const explicitFamily = cleanClassificationValue(source.family).toLowerCase();
        const recognizedExplicitFamily = ITEM_FAMILIES.some(entry => entry.value === explicitFamily) ? explicitFamily : "";
        const systemTypeIdentifiesArmor = getItemSubtypeOptions("armor").some(entry => entry.value === systemType);
        const family = recognizedExplicitFamily
            || (systemTypeIdentifiesArmor ? "armor" : "")
            || legacy?.family
            || systemFamily
            || "equipment";
        const legacySubtype = cleanClassificationValue(legacy?.subtype);
        const oldSubtype = cleanClassificationValue(item?.subtype);
        const knownOldSubtype = getItemSubtypeOptions(family).find(entry =>
            entry.value.toLowerCase() === oldSubtype.toLowerCase()
            || normalizeSearch(entry.label) === normalizeSearch(oldSubtype));
        const systemSubtypeFitsFamily = systemType && (
            getItemSubtypeOptions(family).some(entry => entry.value === systemType)
            || systemFamily === family
        );
        const subtype = cleanClassificationValue(source.subtype)
            || (systemSubtypeFitsFamily ? systemType : "")
            || legacySubtype
            || knownOldSubtype?.value
            || oldSubtype;
        const baseItem = cleanClassificationValue(source.baseItem || document?.system?.type?.baseItem || item?.baseItem, 120);
        return {
            version: 1,
            family,
            ...(subtype ? { subtype } : {}),
            ...(baseItem ? { baseItem } : {})
        };
    }

    function legacyTypeForClassification(classification) {
        const family = cleanClassificationValue(classification?.family).toLowerCase();
        const subtype = cleanClassificationValue(classification?.subtype);
        if (family === "armor") return subtype === "shield" ? "Scudo" : "Armatura";
        if (family === "weapon") return "Arma";
        if (family === "consumable") return ({ potion: "Pozione", scroll: "Pergamena" })[subtype] || "Consumabile";
        if (family === "equipment") return ({ ring: "Anello", wand: "Bacchetta", rod: "Verga", wondrous: "Oggetto meraviglioso" })[subtype] || "Equipaggiamento";
        if (family === "tool") return "Strumento";
        if (family === "material") return "Materiali";
        if (family === "loot") return "Bottino";
        if (family === "container") return "Contenitore";
        return "Oggetto meraviglioso";
    }

    function foundryTypeForClassification(classification) {
        return getItemFamilyMeta(classification?.family).foundryType;
    }

    function getItemClassificationMeta(item) {
        const classification = normalizeItemClassification(item);
        const family = getItemFamilyMeta(classification.family);
        const subtype = getItemSubtypeOptions(classification.family).find(entry => entry.value === classification.subtype);
        const subtypeLabel = subtype?.label || cleanClassificationValue(classification.subtype);
        const label = subtypeLabel && normalizeSearch(subtypeLabel) !== normalizeSearch(family.label)
            ? `${family.label} · ${subtypeLabel}`
            : family.label;
        return {
            ...classification,
            familyLabel: family.label,
            icon: family.icon,
            subtypeLabel,
            label
        };
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
        ITEM_FAMILIES,
        ITEM_RARITIES,
        ITEM_SUBTYPES,
        ITEM_TYPES,
        foundryTypeForClassification,
        getItemClassificationMeta,
        getItemFamilyMeta,
        filterVisibleItems,
        formatWeightValue,
        getItemCategory,
        getItemImagePath,
        getItemRarityFrameClass,
        getItemRarityMeta,
        getItemTypeMeta,
        getItemSubtypeOptions,
        legacyTypeForClassification,
        normalizeItemClassification,
        getVisibleMaterialTags,
        isArchivedItem,
        isHiddenItem,
        isMaterialItem,
        normalizeMaterialTags,
        normalizeSearch,
        slugify
    };
})();
