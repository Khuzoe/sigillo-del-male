document.addEventListener("DOMContentLoaded", async () => {
    const grid = document.getElementById("items-grid");
    const count = document.getElementById("items-count");
    const search = document.getElementById("items-search");
    const rarityFilters = document.getElementById("items-rarity-filters");
    const typeFilters = document.getElementById("items-type-filters");
    const attunementFilters = document.getElementById("items-attunement-filters");
    if (!grid) return;

    try {
        const response = await fetch("../assets/data/items.json");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const items = filterVisibleItems(await response.json());
        const state = {
            query: "",
            rarity: "all",
            type: "all",
            attunement: "all"
        };

        initItemFilters(items, state, { grid, count, search, rarityFilters, typeFilters, attunementFilters });
        updateItemsView(items, state, grid, count);
    } catch (error) {
        console.error("Errore nel caricamento degli oggetti:", error);
        grid.innerHTML = '<p class="items-state items-state--error">Impossibile caricare gli oggetti.</p>';
    }
});

const ITEM_TYPES = [
    { value: "Arma", icon: "fa-khanda" },
    { value: "Armatura", icon: "fa-shield-halved" },
    { value: "Anello", icon: "fa-ring" },
    { value: "Bacchetta", icon: "fa-wand-sparkles" },
    { value: "Bastone", icon: "fa-staff-snake" },
    { value: "Oggetto meraviglioso", icon: "fa-hat-wizard" },
    { value: "Pergamena", icon: "fa-scroll" },
    { value: "Pozione", icon: "fa-flask-vial" },
    { value: "Verga", icon: "fa-grip-lines-vertical" }
];

const ITEM_RARITIES = [
    { value: "Comune", icon: "fa-circle" },
    { value: "Non comune", icon: "fa-circle-plus" },
    { value: "Raro", icon: "fa-gem" },
    { value: "Molto raro", icon: "fa-star" },
    { value: "Leggendario", icon: "fa-crown" },
    { value: "Artefatto", icon: "fa-sun" },
    { value: "Sconosciuta", icon: "fa-circle-question" }
];

function filterVisibleItems(items) {
    const list = Array.isArray(items) ? items : [];
    if (window.WikiSpoiler) return window.WikiSpoiler.filterVisible(list);
    return list.filter(item => item.hidden !== true && item.status !== "hidden");
}

function initItemFilters(items, state, elements) {
    renderItemFilter(elements.rarityFilters, "items-rarity", [
        { value: "all", label: "Tutte", icon: "fa-layer-group" },
        ...ITEM_RARITIES.map(item => ({ ...item, label: item.value }))
    ], state.rarity);

    const types = uniqueSorted(items.map(item => item.type).filter(Boolean));
    renderItemFilter(elements.typeFilters, "items-type", [
        { value: "all", label: "Tutti", icon: "fa-box-open" },
        ...types.map(type => ({ value: type, label: type, icon: getItemTypeMeta(type).icon }))
    ], state.type);

    renderItemFilter(elements.attunementFilters, "items-attunement", [
        { value: "all", label: "Tutti", icon: "fa-layer-group" },
        { value: "yes", label: "Sintonia", icon: "fa-link" },
        { value: "no", label: "Senza sintonia", icon: "fa-link-slash" }
    ], state.attunement);

    elements.search?.addEventListener("input", event => {
        state.query = event.target.value.trim();
        updateItemsView(items, state, elements.grid, elements.count);
    });

    bindFilterGroup(elements.rarityFilters, "itemsRarity", value => {
        state.rarity = value;
        updateItemsView(items, state, elements.grid, elements.count);
    });
    bindFilterGroup(elements.typeFilters, "itemsType", value => {
        state.type = value;
        updateItemsView(items, state, elements.grid, elements.count);
    });
    bindFilterGroup(elements.attunementFilters, "itemsAttunement", value => {
        state.attunement = value;
        updateItemsView(items, state, elements.grid, elements.count);
    });
}

function renderItemFilter(container, dataName, filters, activeValue) {
    if (!container) return;
    container.innerHTML = filters.map(filter => `
        <button class="items-filter ${filter.value === activeValue ? "is-active" : ""}" type="button"
            data-${dataName}="${escapeHtml(filter.value)}" aria-pressed="${filter.value === activeValue ? "true" : "false"}">
            <i class="fas ${escapeHtml(filter.icon)}" aria-hidden="true"></i>
            <span>${escapeHtml(filter.label)}</span>
        </button>
    `).join("");
}

function bindFilterGroup(container, datasetKey, onChange) {
    container?.addEventListener("click", event => {
        const button = event.target.closest("button");
        const value = button?.dataset?.[datasetKey];
        if (!value) return;
        container.querySelectorAll("button").forEach(item => {
            const active = item === button;
            item.classList.toggle("is-active", active);
            item.setAttribute("aria-pressed", active ? "true" : "false");
        });
        onChange(value);
    });
}

function updateItemsView(items, state, grid, count) {
    const filtered = filterItems(items, state);
    if (count) count.textContent = `${filtered.length} ${filtered.length === 1 ? "voce" : "voci"}`;

    if (!filtered.length) {
        grid.innerHTML = '<p class="items-state">Nessun oggetto corrisponde ai filtri.</p>';
        return;
    }

    grid.innerHTML = filtered
        .sort(compareItems)
        .map(renderItemCard)
        .join("");
}

function filterItems(items, state) {
    const query = normalizeSearch(state.query);
    return items.filter(item => {
        if (state.rarity !== "all" && (item.rarity || "Sconosciuta") !== state.rarity) return false;
        if (state.type !== "all" && (item.type || "") !== state.type) return false;
        if (state.attunement === "yes" && item.attunement !== true) return false;
        if (state.attunement === "no" && item.attunement === true) return false;
        if (!query) return true;
        return normalizeSearch([
            item.name,
            item.type,
            item.rarity,
            item.owner,
            item.summary,
            item.notes,
            ...(Array.isArray(item.properties) ? item.properties : [])
        ].filter(Boolean).join(" ")).includes(query);
    });
}

function renderItemCard(item) {
    const type = getItemTypeMeta(item.type);
    const rarity = getItemRarityMeta(item.rarity);
    const properties = Array.isArray(item.properties) ? item.properties.filter(Boolean) : [];
    return `
        <article class="item-card item-card--${slugify(rarity.label)}">
            ${renderItemMedia(item, type)}
            <div class="item-card-content">
                <div class="item-card-kicker">
                    <span><i class="fas ${escapeHtml(type.icon)}" aria-hidden="true"></i>${escapeHtml(type.label)}</span>
                    <span><i class="fas ${escapeHtml(rarity.icon)}" aria-hidden="true"></i>${escapeHtml(rarity.label)}</span>
                    ${item.attunement ? '<span><i class="fas fa-link" aria-hidden="true"></i>Sintonia</span>' : ""}
                </div>
                <h3>${escapeHtml(item.name || "Oggetto senza nome")}</h3>
                ${item.owner ? `<p class="item-owner">Possessore: ${escapeHtml(item.owner)}</p>` : ""}
                ${item.summary ? `<p class="item-summary">${escapeHtml(item.summary)}</p>` : ""}
                ${properties.length ? `
                    <ul class="item-properties">
                        ${properties.map(property => `<li>${escapeHtml(property)}</li>`).join("")}
                    </ul>
                ` : ""}
                ${item.notes ? `<p class="item-notes">${escapeHtml(item.notes)}</p>` : ""}
            </div>
        </article>
    `;
}

function renderItemMedia(item, type) {
    if (item.image) {
        return `
            <div class="item-card-media">
                <img src="../assets/${escapeHtml(item.image)}" alt="${escapeHtml(item.name || "Oggetto")}">
            </div>
        `;
    }
    return `
        <div class="item-card-icon" aria-hidden="true">
            <i class="fas ${escapeHtml(item.icon || type.icon)}"></i>
        </div>
    `;
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

function compareItems(a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""), "it", { sensitivity: "base" });
}

function uniqueSorted(values) {
    return [...new Set(values)].sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
}

function normalizeSearch(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function slugify(value) {
    return String(value || "item")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "item";
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}
