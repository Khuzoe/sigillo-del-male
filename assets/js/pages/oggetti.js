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
        initItemImageModal();
        openLinkedItem(grid);
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
    bindItemExpansion(grid);
}

function bindItemExpansion(grid) {
    grid.querySelectorAll(".item-card").forEach(card => {
        card.addEventListener("toggle", () => {
            if (!card.open) return;
            grid.querySelectorAll(".item-card[open]").forEach(otherCard => {
                if (otherCard !== card) otherCard.open = false;
            });
        });
    });
}

function openLinkedItem(grid) {
    const id = decodeURIComponent(window.location.hash || "").replace(/^#/, "");
    if (!id) return;
    const target = grid.querySelector(`#${CSS.escape(id)}`);
    if (!target) return;
    target.open = true;
    target.scrollIntoView({ block: "center" });
}

function filterItems(items, state) {
    const query = normalizeSearch(state.query);
    return items.filter(item => {
        const visibleProperties = getVisibleItemProperties(item);
        if (state.rarity !== "all" && (item.rarity || "Sconosciuta") !== state.rarity) return false;
        if (state.type !== "all" && (item.type || "") !== state.type) return false;
        if (state.attunement === "yes" && item.attunement !== true) return false;
        if (state.attunement === "no" && item.attunement === true) return false;
        if (!query) return true;
        return normalizeSearch([
            item.name,
            item.type,
            item.subtype,
            item.rarity,
            item.owner,
            item.summary,
            item.notes,
            ...visibleProperties.flatMap(property => [
                property.name,
                property.charges,
                property.description,
                property.negative ? "negativo malus" : ""
            ])
        ].filter(Boolean).join(" ")).includes(query);
    });
}

function renderItemCard(item) {
    const type = getItemTypeMeta(item.type);
    const rarity = getItemRarityMeta(item.rarity);
    const properties = getVisibleItemProperties(item);
    const positiveProperties = properties.filter(property => property.negative !== true);
    const negativeProperties = properties.filter(property => property.negative === true);
    return `
        <details class="item-card item-card--${slugify(rarity.label)}" id="${escapeHtml(item.id || slugify(item.name))}">
            <summary class="item-card-summary">
                ${renderItemMedia(item, type, rarity)}
                <div class="item-card-text">
                    <div class="item-card-kicker">
                        <span><i class="fas ${escapeHtml(type.icon)}" aria-hidden="true"></i>${escapeHtml(formatItemTypeLabel(item))}</span>
                        <span><i class="fas ${escapeHtml(rarity.icon)}" aria-hidden="true"></i>${escapeHtml(rarity.label)}</span>
                        ${item.attunement ? '<span><i class="fas fa-link" aria-hidden="true"></i>Sintonia</span>' : ""}
                        ${item.unidentified === true ? '<span><i class="fas fa-eye-slash" aria-hidden="true"></i>Non identificato</span>' : ""}
                    </div>
                <h3>${escapeHtml(item.name || "Oggetto senza nome")}</h3>
                ${item.owner ? `<p class="item-owner">Provenienza: ${escapeHtml(item.owner)}</p>` : ""}
                ${item.summary ? `<p class="item-summary">${escapeHtml(item.summary)}</p>` : ""}
                </div>
            </summary>
            <div class="item-card-content">
                ${item.unidentified === true ? `
                    <p class="item-notes item-notes--unidentified">Le proprietà di questo oggetto non sono ancora identificate.</p>
                ` : ""}
                ${positiveProperties.length ? `
                    <ul class="item-properties">
                        ${positiveProperties.map(property => `<li>${renderItemProperty(property)}</li>`).join("")}
                    </ul>
                ` : ""}
                ${negativeProperties.length ? `
                    <section class="item-properties-block item-properties-block--negative" aria-label="Effetti negativi">
                        <h4>Effetti negativi</h4>
                        <ul class="item-properties item-properties--negative">
                            ${negativeProperties.map(property => `<li>${renderItemProperty(property)}</li>`).join("")}
                        </ul>
                    </section>
                ` : ""}
                ${item.notes ? `<p class="item-notes">${escapeHtml(item.notes)}</p>` : ""}
            </div>
        </details>
    `;
}

function normalizeItemProperties(properties) {
    if (!Array.isArray(properties)) return [];
    return properties
        .map(property => {
            if (typeof property === "string") {
                const text = property.trim();
                return text ? { description: text } : null;
            }
            if (!property || typeof property !== "object") return null;
            const name = String(property.name || "").trim();
            const charges = String(property.charges || "").trim();
            const description = String(property.description || "").trim();
            const negative = property.negative === true;
            const hidden = property.hidden === true;
            if (!name && !charges && !description) return null;
            return { name, charges, description, negative, hidden };
        })
        .filter(Boolean);
}

function getVisibleItemProperties(item) {
    if (item?.unidentified === true) return [];
    return normalizeItemProperties(item?.properties).filter(property => property.hidden !== true);
}

function renderItemProperty(property) {
    if (!property.name) return escapeHtml(property.description || "");
    const charges = String(property.charges || "").trim();
    const chargeCount = Number(charges);
    const chargeText = charges
        ? Number.isFinite(chargeCount)
            ? ` (${escapeHtml(charges)} ${chargeCount === 1 ? "carica" : "cariche"})`
            : ` (${escapeHtml(charges)})`
        : "";
    const description = property.description ? ` ${escapeHtml(property.description)}` : "";
    return `<strong>${escapeHtml(property.name)}${chargeText}.</strong>${description}`;
}

function renderItemMedia(item, type, rarity) {
    const rarityClass = getItemRarityFrameClass(rarity.label);
    if (item.image) {
        return `
            <button class="item-card-media ${escapeHtml(rarityClass)}" type="button" data-item-image="../assets/${escapeHtml(item.image)}" data-item-name="${escapeHtml(item.name || "Oggetto")}" aria-label="Ingrandisci immagine: ${escapeHtml(item.name || "Oggetto")}">
                <img src="../assets/${escapeHtml(item.image)}" alt="${escapeHtml(item.name || "Oggetto")}">
            </button>
        `;
    }
    return `
        <div class="item-card-icon ${escapeHtml(rarityClass)}" aria-hidden="true">
            <i class="fas ${escapeHtml(item.icon || type.icon)}"></i>
        </div>
    `;
}

function formatItemTypeLabel(item) {
    const type = getItemTypeMeta(item.type).label;
    const subtype = String(item?.subtype || "").trim();
    return subtype ? `${type} (${subtype})` : type;
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

function initItemImageModal() {
    let modal = document.getElementById("item-image-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "item-image-modal";
        modal.className = "item-image-modal";
        modal.hidden = true;
        modal.innerHTML = `
            <button class="item-image-modal-backdrop" type="button" data-close-item-image aria-label="Chiudi"></button>
            <figure class="item-image-modal-frame">
                <button class="item-image-modal-close" type="button" data-close-item-image aria-label="Chiudi">
                    <i class="fas fa-xmark" aria-hidden="true"></i>
                </button>
                <img id="item-image-modal-img" src="" alt="">
                <figcaption id="item-image-modal-caption"></figcaption>
            </figure>
        `;
        document.body.appendChild(modal);
    }

    document.addEventListener("click", event => {
        const trigger = event.target.closest("[data-item-image]");
        if (!trigger) return;
        event.preventDefault();
        event.stopPropagation();
        const image = modal.querySelector("#item-image-modal-img");
        const caption = modal.querySelector("#item-image-modal-caption");
        image.src = trigger.dataset.itemImage;
        image.alt = trigger.dataset.itemName || "Oggetto";
        caption.textContent = trigger.dataset.itemName || "";
        modal.hidden = false;
        document.body.classList.add("item-image-modal-open");
    });

    modal.addEventListener("click", event => {
        if (!event.target.closest("[data-close-item-image]")) return;
        closeItemImageModal(modal);
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !modal.hidden) closeItemImageModal(modal);
    });
}

function closeItemImageModal(modal) {
    modal.hidden = true;
    const image = modal.querySelector("#item-image-modal-img");
    if (image) image.removeAttribute("src");
    document.body.classList.remove("item-image-modal-open");
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
