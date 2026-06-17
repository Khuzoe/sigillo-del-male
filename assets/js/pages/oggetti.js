const ITEMS_DATA_API_URL = () => window.CriptaApp?.urls?.api?.("api/data/items") || "https://sigillo-api.khuzoe.workers.dev/api/data/items";
const ITEMS_MEDIA_WORKER_URL = window.CriptaApp?.config?.workerOrigin || "https://sigillo-api.khuzoe.workers.dev";
const ITEMS_DISCORD_TOKEN_KEY = "discord_jwt";
let currentMaterialTagSuggestions = [];
const ITEM_IMAGE_ADJUST_DATASET_KEYS = { x: "itemAdjustX", y: "itemAdjustY", size: "itemAdjustSize" };
const ITEM_IMAGE_ADJUST_CSS_VARS = { x: "--item-img-x", y: "--item-img-y", size: "--item-img-scale" };
const ITEM_IMAGE_ADJUST_FRAME_SELECTORS = ["[data-item-image-preview]", ".item-card-media"];

window.CriptaApp.onPageReady("oggetti", async () => {
    const grid = document.getElementById("items-grid");
    const count = document.getElementById("items-count");
    const search = document.getElementById("items-search");
    const rarityFilters = document.getElementById("items-rarity-filters");
    const typeFilters = document.getElementById("items-type-filters");
    const attunementFilters = document.getElementById("items-attunement-filters");
    const createButton = document.getElementById("items-create-button");
    if (!grid) return;

    try {
        const [rawItems, canSeeHidden] = await Promise.all([
            loadItemsData(),
            canCurrentUserSeeHiddenItems()
        ]);
        const items = filterVisibleItems(rawItems, { includeHidden: canSeeHidden });
        const state = {
            query: "",
            rarity: "all",
            type: "all",
            attunement: "all",
            canEditItems: canSeeHidden,
            items,
            editingItemId: "",
            itemDraft: null,
            loadedVersion: null
        };

        initItemFilters(items, state, { grid, count, search, rarityFilters, typeFilters, attunementFilters });
        initCreateItemButton(createButton, state, { grid, count, search, rarityFilters, typeFilters, attunementFilters });
        updateItemsView(state.items, state, grid, count);
        initItemImageModal();
        openLinkedItem(grid);
    } catch (error) {
        console.error("Errore nel caricamento degli oggetti:", error);
        grid.innerHTML = '<p class="items-state items-state--error">Impossibile caricare gli oggetti.</p>';
    }
});

async function loadItemsData() {
    try {
        if (typeof window.CriptaApp?.api?.get === "function") {
            const payload = await window.CriptaApp.api.get("api/data/items");
            if (Array.isArray(payload?.data)) return payload.data;
        }
    } catch (error) {
        console.warn("KV items non disponibile, uso JSON statico.", error);
    }

    const response = await fetch(window.CriptaApp?.urls?.data?.("items.json") || "../assets/data/items.json").catch(() => null);
    if (!response?.ok) return [];
    const data = await response.json().catch(() => []);
    return Array.isArray(data) ? data : data?.data || [];
}

const ITEM_TYPES = window.CriptaItemNormalize.ITEM_TYPES;
const ITEM_RARITIES = window.CriptaItemNormalize.ITEM_RARITIES;

function resolveImageUrl(path) {
    const value = String(path || "").trim();
    if (!value) return "";
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    if (value.startsWith("media/")) return window.CriptaApp.urls.api(value);
    if (value.startsWith("/media/")) return window.CriptaApp.urls.api(value.slice(1));
    if (value.startsWith("assets/")) return `../${value}`;
    return `../assets/${value}`;
}

function filterVisibleItems(items, { includeHidden = false } = {}) {
    return window.CriptaItemNormalize.filterVisibleItems(items, { includeHidden });
}

async function canCurrentUserSeeHiddenItems() {
    try {
        const authState = await window.CriptaApp?.auth?.verify?.();
        const accountId = getAuthAccountId(authState);
        const discordId = getAuthDiscordId(authState);
        if (!accountId && !discordId) return false;

        const nextSession = typeof window.CriptaApp?.fetchJson === "function"
            ? await window.CriptaApp.fetchJson(window.CriptaApp.urls.data("next-session.json"))
            : await fetch(window.CriptaApp?.urls?.data?.("next-session.json") || "../assets/data/next-session.json").then(response => response.ok ? response.json() : null);
        const dmAccountId = String(nextSession?.dmAccountId || "").trim();
        const dmDiscordId = String(nextSession?.dmDiscordId || "").trim();
        return Boolean(dmAccountId && accountId === dmAccountId)
            || Boolean(dmDiscordId && discordId === dmDiscordId);
    } catch (_) {
        return false;
    }
}

function getAuthAccountId(authState) {
    return String(authState?.user?.accountId || authState?.user?.id || authState?.user?.sub || "").trim();
}

function getAuthDiscordId(authState) {
    const explicitId = String(authState?.user?.discordId || "").trim();
    if (explicitId) return explicitId;
    const legacyId = String(authState?.user?.id || authState?.user?.sub || "").trim();
    return /^\d{5,32}$/.test(legacyId) ? legacyId : "";
}

function isHiddenItem(item) {
    return window.CriptaItemNormalize.isHiddenItem(item);
}

function initItemFilters(items, state, elements) {
    renderItemFilter(elements.rarityFilters, "items-rarity", [
        { value: "all", label: "Tutte", icon: "fa-layer-group" },
        ...ITEM_RARITIES.map(item => ({ ...item, label: item.value }))
    ], state.rarity);

    const types = uniqueSorted(items.map(item => getItemCategory(item)).filter(Boolean));
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
        updateItemsView(state.items, state, elements.grid, elements.count);
    });

    bindFilterGroup(elements.rarityFilters, "itemsRarity", value => {
        state.rarity = value;
        updateItemsView(state.items, state, elements.grid, elements.count);
    });
    bindFilterGroup(elements.typeFilters, "itemsType", value => {
        state.type = value;
        updateItemsView(state.items, state, elements.grid, elements.count);
    });
    bindFilterGroup(elements.attunementFilters, "itemsAttunement", value => {
        state.attunement = value;
        updateItemsView(state.items, state, elements.grid, elements.count);
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

function initCreateItemButton(button, state, elements) {
    if (!button || !state.canEditItems) return;
    button.hidden = false;
    button.addEventListener("click", () => {
        const draft = createEmptyItemDraft();
        state.items = [draft, ...state.items.filter(item => getItemId(item) !== draft.id)];
        state.editingItemId = draft.id;
        state.itemDraft = structuredCloneSafe(draft);
        state.query = "";
        state.rarity = "all";
        state.type = "all";
        state.attunement = "all";
        if (elements.search) elements.search.value = "";
        setFilterGroupActive(elements.rarityFilters, "itemsRarity", "all");
        setFilterGroupActive(elements.typeFilters, "itemsType", "all");
        setFilterGroupActive(elements.attunementFilters, "itemsAttunement", "all");
        updateItemsView(state.items, state, elements.grid, elements.count);
        const card = elements.grid.querySelector(`#${CSS.escape(draft.id)}`);
        if (card) {
            card.open = true;
            card.scrollIntoView({ block: "center" });
        }
    });
}

function setFilterGroupActive(container, datasetKey, value) {
    container?.querySelectorAll("button").forEach(button => {
        const active = button.dataset?.[datasetKey] === value;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
    });
}

function createEmptyItemDraft() {
    const suffix = Date.now().toString(36);
    return {
        id: `nuovo-oggetto-${suffix}`,
        name: "Nuovo oggetto",
        type: "Oggetto meraviglioso",
        rarity: "Sconosciuta",
        summary: "",
        notes: "",
        properties: []
    };
}

function updateItemsView(items, state, grid, count) {
    const filtered = filterItems(items, state);
    currentMaterialTagSuggestions = collectMaterialTagSuggestions(items);
    if (count) count.textContent = `${filtered.length} ${filtered.length === 1 ? "voce" : "voci"}`;

    if (!filtered.length) {
        grid.innerHTML = '<p class="items-state">Nessun oggetto corrisponde ai filtri.</p>';
        return;
    }

    grid.innerHTML = renderItemsGrid(filtered, {
        canEdit: state.canEditItems,
        editingItemId: state.editingItemId,
        itemDraft: state.itemDraft
    });
    bindItemExpansion(grid);
    bindItemInlineEditor(grid, state, count);
    initItemAdjustedImages(grid);
}

function renderItemsGrid(items, { canEdit = false, editingItemId = "", itemDraft = null } = {}) {
    const sorted = [...items].sort(compareItems);
    const regularItems = sorted.filter(item => getItemCategory(item) !== "Materiali");
    const materialItems = sorted.filter(item => getItemCategory(item) === "Materiali");
    const regularHtml = regularItems
        .map(item => renderItemCard(item, {
            canEdit,
            isEditing: getItemId(item) === editingItemId,
            draft: getItemId(item) === editingItemId ? itemDraft : null
        }))
        .join("");
    const materialsHtml = materialItems
        .map(item => renderItemCard(item, {
            canEdit,
            isEditing: getItemId(item) === editingItemId,
            draft: getItemId(item) === editingItemId ? itemDraft : null
        }))
        .join("");
    if (!materialItems.length) return regularHtml;
    if (!regularItems.length) return `
        <section class="items-grid-section items-grid-section--materials">
            ${renderItemsSectionHeader("Materiali", materialItems.length, "fa-cubes-stacked")}
            <div class="items-grid-section-cards">${materialsHtml}</div>
        </section>
    `;
    return `
        ${regularHtml}
        <section class="items-grid-section items-grid-section--materials">
            ${renderItemsSectionHeader("Materiali", materialItems.length, "fa-cubes-stacked")}
            <div class="items-grid-section-cards">${materialsHtml}</div>
        </section>
    `;
}

function renderItemsSectionHeader(title, count, icon) {
    return `
        <header class="items-grid-section-header">
            <span><i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>${escapeHtml(title)}</span>
            <small>${count} ${count === 1 ? "voce" : "voci"}</small>
        </header>
    `;
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
        const materialTags = getVisibleMaterialTags(item);
        if (state.rarity !== "all" && (item.rarity || "Sconosciuta") !== state.rarity) return false;
        if (state.type !== "all" && getItemCategory(item) !== state.type) return false;
        if (state.attunement === "yes" && item.attunement !== true) return false;
        if (state.attunement === "no" && item.attunement === true) return false;
        if (!query) return true;
        return normalizeSearch([
            item.name,
            getItemCategory(item),
            item.type,
            item.subtype,
            item.rarity,
            item.owner,
            item.summary,
            item.notes,
            item.valueGold,
            item.weight,
            ...visibleProperties.flatMap(property => [
                property.name,
                property.charges,
                property.description,
                property.negative ? "negativo malus" : ""
            ]),
            ...materialTags.flatMap(tag => [
                tag.name,
                tag.description
            ])
        ].filter(Boolean).join(" ")).includes(query);
    });
}

function renderLegacyItemCard(item, { canEdit = false, isEditing = false, draft = null } = {}) {
    const isMaterial = getItemCategory(item) === "Materiali";
    const type = getItemTypeMeta(getItemCategory(item));
    const rarity = getItemRarityMeta(item.rarity);
    const properties = getVisibleItemProperties(item);
    const materialTags = isMaterial ? getVisibleMaterialTags(item) : [];
    const positiveProperties = isMaterial ? [] : properties.filter(property => property.negative !== true);
    const negativeProperties = isMaterial ? [] : properties.filter(property => property.negative === true);
    const hidden = isHiddenItem(item);
    const itemId = getItemId(item);
    return `
        <details class="item-card item-card--${slugify(rarity.label)} ${isMaterial ? "item-card--material" : ""} ${hidden ? "item-card--dm-hidden" : ""} ${isEditing ? "item-card--editing" : ""}" id="${escapeHtml(itemId)}" ${isEditing ? "open" : ""}>
            <summary class="item-card-summary">
                ${renderItemMedia(item, type, rarity)}
                <div class="item-card-text">
                    <div class="item-card-kicker">
                        <span><i class="fas ${escapeHtml(type.icon)}" aria-hidden="true"></i>${escapeHtml(formatItemTypeLabel(item))}</span>
                        <span><i class="fas ${escapeHtml(rarity.icon)}" aria-hidden="true"></i>${escapeHtml(rarity.label)}</span>
                        ${!isMaterial && item.attunement ? '<span><i class="fas fa-link" aria-hidden="true"></i>Sintonia</span>' : ""}
                        ${item.unidentified === true ? '<span><i class="fas fa-eye-slash" aria-hidden="true"></i>Non identificato</span>' : ""}
                        ${hidden ? '<span class="item-card-dm-badge"><i class="fas fa-user-shield" aria-hidden="true"></i>Solo DM</span>' : ""}
                    </div>
                <h3>${escapeHtml(item.name || "Oggetto senza nome")}</h3>
                ${item.owner ? `<p class="item-owner">Provenienza: ${escapeHtml(item.owner)}</p>` : ""}
                ${item.summary ? `<p class="item-summary">${escapeHtml(item.summary)}</p>` : ""}
                </div>
                <div class="item-card-summary-actions">
                    ${canEdit ? `
                        <button class="item-card-edit-link" type="button" data-item-edit="${escapeHtml(itemId)}" title="Modifica questo oggetto">
                            <i class="fas fa-pen" aria-hidden="true"></i>
                            <span>Modifica</span>
                        </button>
                    ` : ""}
                    <span class="item-card-toggle-icon" aria-hidden="true">
                        <i class="fas fa-chevron-down"></i>
                    </span>
                </div>
            </summary>
            <div class="item-card-content">
                ${item.unidentified === true ? `
                    <p class="item-notes item-notes--unidentified">Le proprietà di questo oggetto non sono ancora identificate.</p>
                ` : ""}
                ${isMaterial ? renderMaterialMeta(item) : ""}
                ${isMaterial && materialTags.length ? `
                    <ul class="item-material-tags">
                        ${materialTags.map(tag => `<li>${renderMaterialTag(tag)}</li>`).join("")}
                    </ul>
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

function renderItemCard(item, { canEdit = false, isEditing = false, draft = null } = {}) {
    const isMaterial = getItemCategory(item) === "Materiali";
    const type = getItemTypeMeta(getItemCategory(item));
    const rarity = getItemRarityMeta(item.rarity);
    const properties = getVisibleItemProperties(item);
    const materialTags = isMaterial ? getVisibleMaterialTags(item) : [];
    const positiveProperties = isMaterial ? [] : properties.filter(property => property.negative !== true);
    const negativeProperties = isMaterial ? [] : properties.filter(property => property.negative === true);
    const hidden = isHiddenItem(item);
    const itemId = getItemId(item);
    const content = isEditing ? renderItemInlineEditor(draft || item) : `
        ${item.unidentified === true ? '<p class="item-notes item-notes--unidentified">Le proprieta di questo oggetto non sono ancora identificate.</p>' : ""}
        ${isMaterial ? renderMaterialMeta(item) : ""}
        ${isMaterial && materialTags.length ? `
            <ul class="item-material-tags">
                ${materialTags.map(tag => `<li>${renderMaterialTag(tag)}</li>`).join("")}
            </ul>
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
    `;

    return `
        <details class="item-card item-card--${slugify(rarity.label)} ${isMaterial ? "item-card--material" : ""} ${hidden ? "item-card--dm-hidden" : ""} ${isEditing ? "item-card--editing" : ""}" id="${escapeHtml(itemId)}" ${isEditing ? "open" : ""}>
            <summary class="item-card-summary">
                ${renderItemMedia(item, type, rarity)}
                <div class="item-card-text">
                    <div class="item-card-kicker">
                        <span><i class="fas ${escapeHtml(type.icon)}" aria-hidden="true"></i>${escapeHtml(formatItemTypeLabel(item))}</span>
                        <span><i class="fas ${escapeHtml(rarity.icon)}" aria-hidden="true"></i>${escapeHtml(rarity.label)}</span>
                        ${!isMaterial && item.attunement ? '<span><i class="fas fa-link" aria-hidden="true"></i>Sintonia</span>' : ""}
                        ${item.unidentified === true ? '<span><i class="fas fa-eye-slash" aria-hidden="true"></i>Non identificato</span>' : ""}
                        ${hidden ? '<span class="item-card-dm-badge"><i class="fas fa-user-shield" aria-hidden="true"></i>Solo DM</span>' : ""}
                    </div>
                    <h3>${escapeHtml(item.name || "Oggetto senza nome")}</h3>
                    ${item.owner ? `<p class="item-owner">Provenienza: ${escapeHtml(item.owner)}</p>` : ""}
                    ${item.summary ? `<p class="item-summary">${escapeHtml(item.summary)}</p>` : ""}
                </div>
                <div class="item-card-summary-actions">
                    ${canEdit ? `
                        <button class="item-card-edit-link" type="button" data-item-edit="${escapeHtml(itemId)}" title="Modifica questo oggetto">
                            <i class="fas fa-pen" aria-hidden="true"></i>
                            <span>Modifica</span>
                        </button>
                    ` : ""}
                    <span class="item-card-toggle-icon" aria-hidden="true">
                        <i class="fas fa-chevron-down"></i>
                    </span>
                </div>
            </summary>
            <div class="item-card-content">
                ${content}
            </div>
        </details>
    `;
}

function renderItemInlineEditor(item) {
    const imagePath = String(item.image || "").trim();
    const imageAdjust = normalizeItemImageAdjust(item.imageAdjust);
    const preview = imagePath
        ? `<img src="${escapeHtml(resolveImageUrl(imagePath))}" alt="" ${renderItemAdjustedImageAttributes(imageAdjust)}>`
        : '<span>Nessuna immagine</span>';
    const fileName = getFileNameFromPath(imagePath);
    return `
        <div class="item-inline-editor" data-item-inline-editor>
            <header class="item-inline-editor-header">
                <div>
                    <span>Editor oggetto</span>
                    <strong>${escapeHtml(item.name || "Oggetto senza nome")}</strong>
                </div>
                <div class="item-inline-editor-actions">
                    <button class="item-card-edit-link item-card-edit-link--visible" type="button" data-item-edit-action="cancel">Annulla</button>
                    <button class="item-card-edit-link item-card-edit-link--visible item-card-edit-link--primary" type="button" data-item-edit-action="save">
                        <span>Salva</span>
                    </button>
                </div>
            </header>
            <div class="item-inline-editor-layout">
                <aside class="item-inline-editor-media">
                    <button class="item-inline-editor-preview" type="button" data-item-image-dropzone>
                        <span data-item-image-preview>${preview}</span>
                    </button>
                    <input type="hidden" data-item-field="image" value="${escapeHtml(imagePath)}">
                    <small class="item-inline-editor-file-name" data-item-image-file-name>${escapeHtml(fileName || "Trascina o scegli un file webp")}</small>
                    <div class="item-inline-image-adjust" aria-label="Regola immagine oggetto">
                        ${renderItemImageAdjustControl("x", "X", imageAdjust.x, 0, 100, 1)}
                        ${renderItemImageAdjustControl("y", "Y", imageAdjust.y, 0, 100, 1)}
                        ${renderItemImageAdjustControl("size", "Zoom", imageAdjust.size, 0.75, 2.5, 0.01)}
                    </div>
                    <div class="item-inline-editor-checks">
                        ${renderItemEditCheck("Sintonia", "attunement", item.attunement === true)}
                        ${renderItemEditCheck("Non identificato", "unidentified", item.unidentified === true)}
                        ${renderItemEditCheck("Nascosto", "hidden", item.hidden === true)}
                    </div>
                </aside>
                <div class="item-inline-editor-main">
                    <section class="item-inline-editor-section">
                        <h4>Identita</h4>
                        <div class="item-inline-editor-grid">
                            ${renderItemEditInput("ID", "id", getItemId(item))}
                            ${renderItemEditInput("Nome", "name", item.name || "")}
                            ${renderItemEditSelect("Tipo", "type", item.type || "", getItemTypeOptions(item.type))}
                            ${renderItemEditInput("Sottotipo", "subtype", item.subtype || "")}
                            ${renderItemEditSelect("Rarita", "rarity", item.rarity || "Sconosciuta", getItemRarityOptions(item.rarity))}
                            ${renderItemEditInput("Proprietario", "owner", item.owner || "")}
                            ${renderItemEditInput("Stato", "status", item.status || "")}
                            ${renderItemEditInput("Valore oro", "valueGold", item.valueGold ?? "")}
                            ${renderItemEditInput("Peso", "weight", item.weight ?? "")}
                        </div>
                    </section>
                    <section class="item-inline-editor-section">
                        <h4>Testi</h4>
                        <div class="item-inline-editor-grid">
                            ${renderItemEditArea("Sommario", "summary", item.summary || "", "item-inline-editor-field--wide", 4)}
                            ${renderItemEditArea("Note", "notes", item.notes || "", "item-inline-editor-field--wide", 4)}
                            ${renderItemEditInput("Nome non identificato", "unidentifiedName", item.unidentifiedName || "", "item-inline-editor-field--wide")}
                            ${renderItemEditArea("Descrizione non identificata", "unidentifiedDescription", item.unidentifiedDescription || "", "item-inline-editor-field--wide", 4)}
                        </div>
                    </section>
                    <section class="item-inline-editor-section">
                        <div class="item-inline-editor-section-head">
                            <h4>Proprieta</h4>
                            <button class="item-card-edit-link item-card-edit-link--visible" type="button" data-item-edit-action="add-property">
                                <span>Aggiungi</span>
                            </button>
                        </div>
                        <div class="item-inline-editor-list" data-item-properties-list>
                            ${renderItemPropertyEditors(item.properties)}
                        </div>
                    </section>
                    <section class="item-inline-editor-section">
                        <div class="item-inline-editor-section-head">
                            <h4>Tag materiali</h4>
                            <button class="item-card-edit-link item-card-edit-link--visible" type="button" data-item-edit-action="add-material-tag">
                                <span>Aggiungi</span>
                            </button>
                        </div>
                        <div class="item-inline-editor-list" data-item-material-tags-list>
                            ${renderItemMaterialTagEditors(item.materialTags || item.tags)}
                        </div>
                    </section>
                    <details class="item-inline-editor-section item-inline-editor-advanced">
                        <summary>Dati avanzati</summary>
                        <div class="item-inline-editor-grid">
                            ${renderItemEditJson("Foundry names JSON", "foundryNames", item.foundryNames || [], "item-inline-editor-field--wide")}
                            ${renderItemEditJson("Alias JSON", "aliases", item.aliases || [], "item-inline-editor-field--wide")}
                        </div>
                    </details>
                </div>
            </div>
            <p class="item-inline-editor-status" data-item-editor-status></p>
        </div>
    `;
}

function renderItemImageAdjustControl(key, label, value, min, max, step) {
    return `
        <label class="item-inline-image-adjust-control">
            <span>${escapeHtml(label)}</span>
            <input type="range" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}" value="${escapeHtml(value)}" data-item-image-adjust="${escapeHtml(key)}">
        </label>
    `;
}

function renderItemEditInput(label, field, value, extraClass = "") {
    return `
        <label class="item-inline-editor-field ${extraClass}">
            <span>${escapeHtml(label)}</span>
            <input data-item-field="${escapeHtml(field)}" value="${escapeHtml(value)}">
        </label>
    `;
}

function renderItemEditArea(label, field, value, extraClass = "", rows = 3) {
    return `
        <label class="item-inline-editor-field ${extraClass}">
            <span>${escapeHtml(label)}</span>
            <textarea data-item-field="${escapeHtml(field)}" rows="${escapeHtml(rows)}">${escapeHtml(value)}</textarea>
        </label>
    `;
}

function renderItemEditJson(label, field, value, extraClass = "") {
    return `
        <label class="item-inline-editor-field ${extraClass}">
            <span>${escapeHtml(label)}</span>
            <textarea data-item-json-field="${escapeHtml(field)}" rows="5" spellcheck="false">${escapeHtml(JSON.stringify(Array.isArray(value) ? value : [], null, 2))}</textarea>
        </label>
    `;
}

function renderItemEditSelect(label, field, selectedValue, options) {
    return `
        <label class="item-inline-editor-field">
            <span>${escapeHtml(label)}</span>
            <select data-item-field="${escapeHtml(field)}">
                ${options.map(value => `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
            </select>
        </label>
    `;
}

function renderItemEditCheck(label, field, checked) {
    return `
        <label class="item-inline-editor-check">
            <input type="checkbox" data-item-field="${escapeHtml(field)}" ${checked ? "checked" : ""}>
            <span>${escapeHtml(label)}</span>
        </label>
    `;
}

function renderItemPropertyEditors(properties) {
    const normalized = normalizeItemProperties(properties);
    if (!normalized.length) return '<p class="item-inline-editor-empty">Nessuna proprieta registrata.</p>';
    return normalized.map(renderItemPropertyEditor).join("");
}

function renderItemPropertyEditor(property = {}) {
    return `
        <article class="item-inline-editor-row" data-item-property-row>
            <div class="item-inline-editor-row-grid">
                ${renderInlineRowInput("Nome", "name", property.name || "")}
                ${renderInlineRowInput("Cariche / trigger", "charges", property.charges || "")}
                ${renderInlineRowArea("Descrizione", "description", property.description || "", "item-inline-editor-field--wide", 5)}
            </div>
            <div class="item-inline-editor-row-actions">
                ${renderInlineRowCheck("Negativa", "negative", property.negative === true)}
                ${renderInlineRowCheck("Nascosta", "hidden", property.hidden === true)}
                <button class="item-card-edit-link item-card-edit-link--visible" type="button" data-item-edit-action="remove-row">
                    <span>Rimuovi</span>
                </button>
            </div>
        </article>
    `;
}

function renderItemMaterialTagEditors(tags) {
    const normalized = normalizeMaterialTags(tags);
    if (!normalized.length) return '<p class="item-inline-editor-empty">Nessun tag materiale registrato.</p>';
    return normalized.map(renderItemMaterialTagEditor).join("");
}

function renderItemMaterialTagEditor(tag = {}) {
    const suggestions = currentMaterialTagSuggestions
        .filter(option => normalizeSearch(option.name) !== normalizeSearch(tag.name))
        .slice(0, 80);
    const suggestionSelect = suggestions.length ? `
        <label class="item-inline-editor-field item-inline-editor-field--wide">
            <span>Usa tag esistente</span>
            <select data-material-tag-template>
                <option value="">Scegli un tag...</option>
                ${suggestions.map(option => `<option value="${escapeHtml(option.name)}">${escapeHtml(option.name)}</option>`).join("")}
            </select>
        </label>
    ` : "";
    return `
        <article class="item-inline-editor-row" data-item-material-tag-row>
            <div class="item-inline-editor-row-grid">
                ${suggestionSelect}
                ${renderInlineRowInput("Nome", "name", tag.name || "")}
                ${renderInlineRowArea("Descrizione", "description", tag.description || "", "item-inline-editor-field--wide", 4)}
            </div>
            <div class="item-inline-editor-row-actions">
                ${renderInlineRowCheck("Nascosto", "hidden", tag.hidden === true)}
                <button class="item-card-edit-link item-card-edit-link--visible" type="button" data-item-edit-action="remove-row">
                    <span>Rimuovi</span>
                </button>
            </div>
        </article>
    `;
}

function renderInlineRowCheck(label, field, checked) {
    return `
        <label class="item-inline-editor-check">
            <input type="checkbox" data-row-field="${escapeHtml(field)}" ${checked ? "checked" : ""}>
            <span>${escapeHtml(label)}</span>
        </label>
    `;
}

function renderInlineRowInput(label, field, value, extraClass = "") {
    return `
        <label class="item-inline-editor-field ${extraClass}">
            <span>${escapeHtml(label)}</span>
            <input data-row-field="${escapeHtml(field)}" value="${escapeHtml(value)}">
        </label>
    `;
}

function renderInlineRowArea(label, field, value, extraClass = "", rows = 3) {
    return `
        <label class="item-inline-editor-field ${extraClass}">
            <span>${escapeHtml(label)}</span>
            <textarea data-row-field="${escapeHtml(field)}" rows="${escapeHtml(rows)}">${escapeHtml(value)}</textarea>
        </label>
    `;
}

function getItemTypeOptions(currentValue = "") {
    const values = [...ITEM_TYPES.map(entry => entry.value), String(currentValue || "").trim()]
        .filter(Boolean);
    return [...new Set(values)];
}

function getItemRarityOptions(currentValue = "") {
    const values = [...ITEM_RARITIES.map(entry => entry.value), String(currentValue || "").trim()]
        .filter(Boolean);
    return [...new Set(values)];
}

function bindItemInlineEditor(grid, state, count) {
    grid.querySelectorAll("[data-item-edit]").forEach(button => {
        button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            const id = button.dataset.itemEdit || "";
            const item = state.items.find(entry => getItemId(entry) === id);
            if (!item) return;
            state.editingItemId = id;
            state.itemDraft = structuredCloneSafe(item);
            updateItemsView(state.items, state, grid, count);
            grid.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: "center" });
        });
    });

    grid.querySelectorAll("[data-item-edit-action]").forEach(button => {
        button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            const action = button.dataset.itemEditAction;
            if (action === "cancel") {
                state.editingItemId = "";
                state.itemDraft = null;
                updateItemsView(state.items, state, grid, count);
                return;
            }
            if (action === "add-property") {
                const list = button.closest("[data-item-inline-editor]")?.querySelector("[data-item-properties-list]");
                appendInlineEditorRow(list, renderItemPropertyEditor({}));
                return;
            }
            if (action === "add-material-tag") {
                const list = button.closest("[data-item-inline-editor]")?.querySelector("[data-item-material-tags-list]");
                appendInlineEditorRow(list, renderItemMaterialTagEditor({}));
                return;
            }
            if (action === "remove-row") {
                button.closest("[data-item-property-row], [data-item-material-tag-row]")?.remove();
                return;
            }
            if (action === "save") {
                saveInlineItemEdit(button.closest("[data-item-inline-editor]"), state, grid, count);
            }
        });
    });

    grid.querySelectorAll("[data-material-tag-template]").forEach(select => {
        select.addEventListener("change", () => {
            applyMaterialTagSuggestion(select);
        });
    });

    grid.querySelectorAll("[data-item-image-adjust]").forEach(input => {
        input.addEventListener("input", () => updateItemImageAdjustPreview(input));
        input.addEventListener("change", () => updateItemImageAdjustPreview(input));
    });

    grid.querySelectorAll("[data-item-image-dropzone]").forEach((dropzone) => {
        bindItemImageDropzone(dropzone, state);
    });
}

function appendInlineEditorRow(list, html) {
    if (!list) return;
    list.querySelector(".item-inline-editor-empty")?.remove();
    list.insertAdjacentHTML("beforeend", html);
    bindInlineRowRemoveAction(list.lastElementChild);
}

function bindInlineRowRemoveAction(row) {
    row?.querySelectorAll('[data-item-edit-action="remove-row"]').forEach(button => {
        button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            button.closest("[data-item-property-row], [data-item-material-tag-row]")?.remove();
        });
    });
    row?.querySelector("[data-material-tag-template]")?.addEventListener("change", event => {
        applyMaterialTagSuggestion(event.currentTarget);
    });
}

function updateItemImageAdjustPreview(input) {
    const form = input.closest("[data-item-inline-editor]");
    if (!form) return;
    const adjust = readItemImageAdjust(form);
    const previewImage = form.querySelector("[data-item-image-preview] img");
    if (previewImage) {
        setItemAdjustedImageDataset(previewImage, adjust);
        applyItemAdjustedImageLayout(previewImage);
    }
}

function applyMaterialTagSuggestion(select) {
    const name = String(select?.value || "").trim();
    if (!name) return;
    const suggestion = currentMaterialTagSuggestions.find(tag => normalizeSearch(tag.name) === normalizeSearch(name));
    if (!suggestion) return;
    const row = select.closest("[data-item-material-tag-row]");
    const nameInput = row?.querySelector('[data-row-field="name"]');
    const descriptionInput = row?.querySelector('[data-row-field="description"]');
    if (nameInput) nameInput.value = suggestion.name || "";
    if (descriptionInput) descriptionInput.value = suggestion.description || "";
}

function bindItemImageDropzone(dropzone, state) {
    if (!dropzone) return;
    const form = dropzone.closest("[data-item-inline-editor]");
    const pickFile = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (file) applyItemImageFile(file, form, state);
        }, { once: true });
        input.click();
    };
    dropzone.addEventListener("click", (event) => {
        event.preventDefault();
        pickFile();
    });
    dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropzone.classList.add("is-dragging");
    });
    dropzone.addEventListener("dragleave", (event) => {
        if (dropzone.contains(event.relatedTarget)) return;
        dropzone.classList.remove("is-dragging");
    });
    dropzone.addEventListener("drop", (event) => {
        event.preventDefault();
        dropzone.classList.remove("is-dragging");
        const file = Array.from(event.dataTransfer?.files || []).find((entry) => entry.type?.startsWith("image/"));
        if (file) applyItemImageFile(file, form, state);
    });
}

async function applyItemImageFile(file, form, state) {
    if (!file || !form || !state.itemDraft) return;
    try {
        setItemEditorStatus(form, "Caricamento immagine...");
        const path = await uploadItemImageFile(file, state.itemDraft);
        state.itemDraft.image = path;
        const field = form.querySelector('[data-item-field="image"]');
        const preview = form.querySelector("[data-item-image-preview]");
        const fileName = form.querySelector("[data-item-image-file-name]");
        if (field) field.value = path;
        if (preview) {
            preview.innerHTML = `<img src="${escapeHtml(resolveImageUrl(path))}" alt="" ${renderItemAdjustedImageAttributes(readItemImageAdjust(form))}>`;
            initItemAdjustedImages(preview);
        }
        if (fileName) fileName.textContent = getFileNameFromPath(path) || getFileNameFromPath(file.name) || "immagine.webp";
        setItemEditorStatus(form, "Immagine caricata. Salva l'oggetto per confermare.");
    } catch (error) {
        console.error("Upload immagine oggetto fallito:", error);
        setItemEditorStatus(form, `Upload fallito: ${error?.message || error}`, true);
    }
}

async function uploadItemImageFile(file, item) {
    const fileName = buildItemImageFileName(file, item);
    const blob = isWebpFile(file.name) ? file : await convertImageFileToWebpBlob(file);
    return uploadItemImageBlob(blob, fileName);
}

async function convertImageFileToWebpBlob(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("Il browser non ha prodotto un file WebP."));
                return;
            }
            resolve(blob);
        }, "image/webp", 0.96);
    });
}

async function uploadItemImageBlob(blob, fileName) {
    const token = readItemsAuthToken();
    if (!token) throw new Error("Login richiesto per caricare immagini.");
    const form = new FormData();
    form.set("folder", "items");
    form.set("filename", fileName);
    form.set("campaignId", getItemsCampaignId());
    form.set("file", new File([blob], fileName, { type: "image/webp" }));
    const response = await fetch(withItemsCampaign(`${ITEMS_MEDIA_WORKER_URL}/media/upload?folder=items`, { force: true }), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false || !payload?.path) throw new Error(payload?.error || `HTTP ${response.status}`);
    validateItemUploadPayload(payload, blob, fileName);
    return payload.path;
}

function validateItemUploadPayload(payload, blob, fileName = "media.webp") {
    const expectedSize = Number(blob?.size || 0);
    const storedSize = Number(payload?.storedSize || payload?.size || 0);
    if (expectedSize > 0 && storedSize > 0 && expectedSize !== storedSize) {
        throw new Error(`Upload R2 non coerente per ${fileName}: inviati ${expectedSize} byte, salvati ${storedSize} byte.`);
    }
}

function buildItemImageFileName(file, item) {
    const originalName = String(file?.name || "").replace(/\.[^.]+$/, "");
    const base = slugify(item?.id || item?.name || originalName || "oggetto");
    return `${base || "oggetto"}.webp`;
}

function isWebpFile(path) {
    return /\.webp$/i.test(String(path || "").trim());
}

function getFileNameFromPath(path) {
    return String(path || "").split(/[\\/]/).pop() || "";
}

async function saveInlineItemEdit(form, state, grid, count) {
    if (!form || !state.itemDraft) return;
    const token = readItemsAuthToken();
    if (!token) {
        setItemEditorStatus(form, "Login richiesto: accedi come DM prima di salvare.", true);
        return;
    }

    let draft;
    try {
        draft = collectItemDraft(form, state.itemDraft);
    } catch (error) {
        setItemEditorStatus(form, error?.message || "Dati non validi.", true);
        return;
    }

    try {
        setItemEditorStatus(form, "Salvataggio online...");
        const loaded = await loadItemsDocumentForSave();
        const nextData = Array.isArray(loaded.data) ? loaded.data.slice() : [];
        const previousId = state.editingItemId;
        const nextId = getItemId(draft);
        let index = nextData.findIndex(item => getItemId(item) === previousId);
        if (index < 0) index = nextData.findIndex(item => getItemId(item) === nextId);
        if (index >= 0) nextData[index] = { ...nextData[index], ...draft };
        else nextData.push(draft);

        const response = await fetch(withItemsCampaign(ITEMS_DATA_API_URL(), { force: true }), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                data: nextData,
                expectedVersion: loaded.source === "kv" ? (loaded.version ?? 0) : 0,
                campaignId: getItemsCampaignId()
            })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);

        state.items = nextData;
        state.loadedVersion = payload?.version ?? loaded.version ?? state.loadedVersion;
        state.editingItemId = "";
        state.itemDraft = null;
        updateItemsView(state.items, state, grid, count);
        const nextCard = grid.querySelector(`#${CSS.escape(nextId)}`);
        if (nextCard) {
            nextCard.open = true;
            nextCard.scrollIntoView({ block: "center" });
        }
    } catch (error) {
        console.error("Salvataggio oggetto fallito:", error);
        setItemEditorStatus(form, `Salvataggio fallito: ${error?.message || error}`, true);
    }
}

function collectItemDraft(form, original) {
    const draft = structuredCloneSafe(original || {});
    form.querySelectorAll("[data-item-field]").forEach(field => {
        const key = field.dataset.itemField;
        if (!key) return;
        const value = field.type === "checkbox" ? field.checked : field.value;
        setItemDraftField(draft, key, value);
    });
    form.querySelectorAll("[data-item-json-field]").forEach(field => {
        const key = field.dataset.itemJsonField;
        if (!key) return;
        const text = field.value.trim();
        try {
            draft[key] = text ? JSON.parse(text) : [];
        } catch (_) {
            throw new Error(`${key}: JSON non valido.`);
        }
    });
    draft.properties = collectItemPropertyRows(form);
    draft.materialTags = collectItemMaterialTagRows(form);
    draft.imageAdjust = readItemImageAdjust(form);
    delete draft.tags;
    draft.id = getItemId(draft);
    if (!draft.name) draft.name = draft.id || "Oggetto senza nome";
    pruneInlineItem(draft);
    return draft;
}

function collectItemPropertyRows(form) {
    return Array.from(form.querySelectorAll("[data-item-property-row]"))
        .map((row) => ({
            name: readInlineRowValue(row, "name"),
            charges: readInlineRowValue(row, "charges"),
            description: readInlineRowValue(row, "description"),
            negative: readInlineRowChecked(row, "negative"),
            hidden: readInlineRowChecked(row, "hidden")
        }))
        .map((property) => {
            if (!property.name && !property.charges && !property.description) return null;
            if (property.negative !== true) delete property.negative;
            if (property.hidden !== true) delete property.hidden;
            return property;
        })
        .filter(Boolean);
}

function collectItemMaterialTagRows(form) {
    return Array.from(form.querySelectorAll("[data-item-material-tag-row]"))
        .map((row) => ({
            name: readInlineRowValue(row, "name"),
            description: readInlineRowValue(row, "description"),
            hidden: readInlineRowChecked(row, "hidden")
        }))
        .map((tag) => {
            if (!tag.name && !tag.description) return null;
            if (tag.hidden !== true) delete tag.hidden;
            return tag;
        })
        .filter(Boolean);
}

function readInlineRowValue(row, field) {
    return String(row.querySelector(`[data-row-field="${field}"]`)?.value || "").trim();
}

function readInlineRowChecked(row, field) {
    return row.querySelector(`[data-row-field="${field}"]`)?.checked === true;
}

function setItemDraftField(item, key, value) {
    if (key === "hidden" || key === "attunement" || key === "unidentified") {
        item[key] = value === true;
        return;
    }
    item[key] = typeof value === "string" ? value.trim() : value;
}

function pruneInlineItem(item) {
    ["type", "subtype", "rarity", "owner", "summary", "image", "notes", "valueGold", "weight"].forEach(key => {
        if (item[key] === "") delete item[key];
    });
    ["hidden", "attunement", "unidentified"].forEach(key => {
        if (item[key] !== true) delete item[key];
    });
    if (Array.isArray(item.properties) && !item.properties.length) delete item.properties;
    if (Array.isArray(item.materialTags) && !item.materialTags.length) delete item.materialTags;
    if (Array.isArray(item.foundryNames) && !item.foundryNames.length) delete item.foundryNames;
    if (Array.isArray(item.aliases) && !item.aliases.length) delete item.aliases;
    if (isDefaultItemImageAdjust(item.imageAdjust)) delete item.imageAdjust;
}

async function loadItemsDocumentForSave() {
    const response = await fetch(withItemsCampaign(ITEMS_DATA_API_URL(), { cacheBust: true }));
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = Array.isArray(payload) ? payload : payload?.data;
    if (!Array.isArray(data)) throw new Error("Formato items non valido.");
    return {
        data,
        source: payload?.source || "kv",
        version: Number(payload?.version || 0)
    };
}

function setItemEditorStatus(form, message, isError = false) {
    const status = form?.querySelector("[data-item-editor-status]");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", Boolean(isError));
}

function getItemId(item) {
    return String(item?.id || slugify(item?.name || "")).trim();
}

function readItemsAuthToken() {
    try {
        return window.localStorage.getItem(ITEMS_DISCORD_TOKEN_KEY) || window.sessionStorage.getItem(ITEMS_DISCORD_TOKEN_KEY) || "";
    } catch (_) {
        return "";
    }
}

function getItemsCampaignId() {
    return window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue";
}

function withItemsCampaign(url, options = {}) {
    const target = new URL(url, window.location.href);
    const campaignId = getItemsCampaignId();
    if (options.force === true || campaignId !== "cripta-di-sangue") {
        target.searchParams.set("campaign", campaignId);
    }
    if (options.cacheBust === true) target.searchParams.set("_", Date.now().toString());
    return target.toString();
}

function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
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

function normalizeMaterialTags(value) {
    return window.CriptaItemNormalize.normalizeMaterialTags(value);
}

function getVisibleMaterialTags(item) {
    return window.CriptaItemNormalize.getVisibleMaterialTags(item);
}

function collectMaterialTagSuggestions(items) {
    const byKey = new Map();
    (Array.isArray(items) ? items : [])
        .filter(item => getItemCategory(item) === "Materiali")
        .flatMap(item => normalizeMaterialTags(item.materialTags || item.tags || item.properties))
        .filter(tag => tag.name)
        .forEach(tag => {
            const key = normalizeSearch(tag.name);
            const existing = byKey.get(key);
            if (!existing || String(tag.description || "").length > String(existing.description || "").length) {
                byKey.set(key, { name: tag.name, description: tag.description || "" });
            }
        });
    return Array.from(byKey.values()).sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "it"));
}

function renderMaterialMeta(item) {
    const rows = [
        item.valueGold !== undefined && item.valueGold !== "" ? { icon: "fa-coins", label: "Valore", value: formatGoldValue(item.valueGold) } : null,
        item.weight !== undefined && item.weight !== "" ? { icon: "fa-weight-hanging", label: "Peso", value: formatWeightValue(item.weight) } : null
    ].filter(Boolean);
    if (!rows.length) return "";
    return `
        <dl class="item-material-meta">
            ${rows.map(row => `
                <div>
                    <dt><i class="fas ${escapeHtml(row.icon)}" aria-hidden="true"></i>${escapeHtml(row.label)}</dt>
                    <dd>${escapeHtml(row.value)}</dd>
                </div>
            `).join("")}
        </dl>
    `;
}

function renderMaterialTag(tag) {
    const description = tag.description ? `<p>${escapeHtml(tag.description)}</p>` : "";
    return `
        <span>${escapeHtml(tag.name || "Tag")}</span>
        ${description}
    `;
}

function formatGoldValue(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    return /^-?\d+(?:[.,]\d+)?$/.test(text) ? `${text.replace(".", ",")} mo` : text;
}

function formatWeightValue(value) {
    return window.CriptaItemNormalize.formatWeightValue(value);
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
        const imageUrl = resolveImageUrl(item.image);
        return `
            <button class="item-card-media ${escapeHtml(rarityClass)}" type="button" data-item-image="${escapeHtml(imageUrl)}" data-item-name="${escapeHtml(item.name || "Oggetto")}" aria-label="Ingrandisci immagine: ${escapeHtml(item.name || "Oggetto")}">
                <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name || "Oggetto")}" ${renderItemAdjustedImageAttributes(item.imageAdjust)}>
            </button>
        `;
    }
    return `
        <div class="item-card-icon ${escapeHtml(rarityClass)}" aria-hidden="true">
            <i class="fas ${escapeHtml(item.icon || type.icon)}"></i>
        </div>
    `;
}

function readItemImageAdjust(form) {
    const values = {};
    form?.querySelectorAll("[data-item-image-adjust]").forEach(input => {
        const key = input.dataset.itemImageAdjust;
        if (!key) return;
        values[key] = input.value;
    });
    return normalizeItemImageAdjust(values);
}

function normalizeItemImageAdjust(adjust) {
    return window.CriptaImageAdjust.normalizePercentAdjust(adjust);
}

function isDefaultItemImageAdjust(adjust) {
    return window.CriptaImageAdjust.isDefaultPercentAdjust(adjust);
}

function buildItemImageStyle(adjust) {
    return window.CriptaImageAdjust.buildPercentCssVars(adjust, ITEM_IMAGE_ADJUST_CSS_VARS);
}

function renderItemAdjustedImageAttributes(adjust) {
    const normalized = normalizeItemImageAdjust(adjust);
    return [
        "data-item-adjusted-image",
        `data-item-adjust-x="${escapeHtml(normalized.x)}"`,
        `data-item-adjust-y="${escapeHtml(normalized.y)}"`,
        `data-item-adjust-size="${escapeHtml(normalized.size)}"`,
        `style="${buildItemImageStyle(normalized)}"`
    ].join(" ");
}

function setItemAdjustedImageDataset(image, adjust) {
    window.CriptaImageAdjust.setDatasetAdjust(image, adjust, ITEM_IMAGE_ADJUST_DATASET_KEYS, ITEM_IMAGE_ADJUST_CSS_VARS);
}

function initItemAdjustedImages(root = document) {
    window.CriptaImageAdjust.initContainedImages(root, {
        selector: "[data-item-adjusted-image]",
        bindingKey: "item-adjusted-images",
        boundDatasetKey: "itemAdjustedBound",
        datasetKeys: ITEM_IMAGE_ADJUST_DATASET_KEYS,
        frameSelectors: ITEM_IMAGE_ADJUST_FRAME_SELECTORS
    });
}

function applyItemAdjustedImageLayout(image) {
    window.CriptaImageAdjust.applyContainedImageLayout(image, {
        datasetKeys: ITEM_IMAGE_ADJUST_DATASET_KEYS,
        frameSelectors: ITEM_IMAGE_ADJUST_FRAME_SELECTORS
    });
}

function formatItemTypeLabel(item) {
    const type = getItemTypeMeta(getItemCategory(item)).label;
    const subtype = String(item?.subtype || "").trim();
    if (!subtype || normalizeSearch(subtype) === normalizeSearch(type)) return type;
    return `${type} (${subtype})`;
}

function getItemCategory(item) {
    return window.CriptaItemNormalize.getItemCategory(item);
}

function getItemTypeMeta(type) {
    return window.CriptaItemNormalize.getItemTypeMeta(type);
}

function getItemRarityMeta(rarity) {
    return window.CriptaItemNormalize.getItemRarityMeta(rarity);
}

function getItemRarityFrameClass(rarity) {
    return window.CriptaItemNormalize.getItemRarityFrameClass(rarity);
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
    return window.CriptaItemNormalize.normalizeSearch(value);
}

function slugify(value) {
    return window.CriptaItemNormalize.slugify(value, "item");
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
