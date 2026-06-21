window.CriptaApp.onPageReady("bestiario", async () => {
    const grid = document.getElementById("bestiary-grid");
    const count = document.getElementById("bestiary-count");
    const search = document.getElementById("bestiary-search");
    const categoryFilters = document.getElementById("bestiary-category-filters");
    const rankFilters = document.getElementById("bestiary-rank-filters");
    const typeFilters = document.getElementById("bestiary-type-filters");
    const groupToggle = document.getElementById("bestiary-group-toggle");
    if (!grid) return;
    syncBestiaryAdminLinks();

    try {
        const [creatures, items] = await Promise.all([
            loadBestiaryData(),
            loadItemsDataForBestiary()
        ]);
        window.bestiaryItemsById = new Map((Array.isArray(items) ? items : [])
            .map((item) => [String(item.id || slugify(item.name || "")).trim(), item])
            .filter(([id]) => Boolean(id)));
        const userIsDm = await resolveBestiaryUserIsDm();
        const visibleCreatures = userIsDm ? creatures : filterVisibleBestiaryCreatures(creatures);
        const state = {
            category: "all",
            rank: "all",
            type: "all",
            groupByCategory: groupToggle?.checked !== false,
            query: "",
            userIsDm
        };

        initBestiaryFilters(visibleCreatures, state, {
            grid,
            count,
            search,
            categoryFilters,
            rankFilters,
            typeFilters,
            groupToggle
        });
        updateBestiaryView(visibleCreatures, state, grid, count);
        initBestiaryModal();
        initBestiaryItemModal();
        openLinkedBestiaryEntry(visibleCreatures);
    } catch (error) {
        console.error("Errore nel caricamento del bestiario:", error);
        grid.innerHTML = '<p class="bestiary-state bestiary-state--error">Impossibile caricare il bestiario.</p>';
    }
});

function syncBestiaryAdminLinks() {
    const campaignId = window.CriptaApp?.campaigns?.currentId?.() || "";
    document.querySelectorAll('.bestiary-admin-link[href*="bestiary/creature.html"]').forEach((link) => {
        const url = new URL(link.getAttribute("href") || "./bestiary/creature.html?new=1", window.location.href);
        if (campaignId && campaignId !== "cripta-di-sangue") url.searchParams.set("campaign", campaignId);
        else url.searchParams.delete("campaign");
        link.href = url.toString();
    });
}

async function loadBestiaryData() {
    try {
        if (typeof window.CriptaApp?.api?.get === "function") {
            const payload = await window.CriptaApp.api.get("api/data/bestiary");
            if (Array.isArray(payload?.data)) return payload.data;
        }
    } catch (error) {
        console.warn("KV bestiary non disponibile, uso JSON statico.", error);
    }

    const data = await window.CriptaApp?.data?.json?.("bestiary.json").catch(() => []);
    return Array.isArray(data) ? data : data?.data || [];
}

async function loadItemsDataForBestiary() {
    try {
        if (typeof window.CriptaApp?.api?.get === "function") {
            const payload = await window.CriptaApp.api.get("api/data/items");
            if (Array.isArray(payload?.data)) return payload.data;
        }
    } catch (error) {
        console.warn("KV items non disponibile per bestiario, uso JSON statico.", error);
    }

    const data = await window.CriptaApp?.data?.json?.("items.json").catch(() => []);
    return Array.isArray(data) ? data : data?.data || [];
}

function resolveImageUrl(path) {
    const value = String(path || "").trim();
    if (!value) return "";
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    if (value.startsWith("media/")) return window.CriptaApp.urls.api(value);
    if (value.startsWith("/media/")) return window.CriptaApp.urls.api(value.slice(1));
    if (value.startsWith("assets/")) return `../${value}`;
    return `../assets/${value}`;
}

function openLinkedBestiaryEntry(creatures) {
    const list = Array.isArray(creatures) ? creatures : [];
    if (!list.length) return;
    const target = getBestiaryLocationTarget();
    if (!target) return;

    const creature = list.find(entry => {
        const slug = slugify(entry?.id || entry?.name || "");
        return slug === target || normalizeSearchText(entry?.name || "") === target;
    });
    if (!creature) return;

    const modal = document.getElementById("bestiary-modal");
    const image = document.getElementById("bestiary-modal-image");
    const title = document.getElementById("bestiary-modal-title");
    const kicker = document.getElementById("bestiary-modal-kicker");
    const details = document.getElementById("bestiary-modal-details");
    if (!modal || !image || !title || !kicker || !details) return;
    openBestiaryModal(creature, modal, image, title, kicker, details);
}

function getBestiaryLocationTarget() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("creature");
    if (fromQuery) return normalizeSearchText(fromQuery).replace(/\s+/g, "-");
    const fromHash = decodeURIComponent(window.location.hash || "").replace(/^#/, "");
    if (fromHash) return normalizeSearchText(fromHash).replace(/\s+/g, "-");
    return "";
}

const BESTIARY_CREATURE_TYPES = [
    { value: "Aberrazione", icon: "fa-brain" },
    { value: "Bestia", icon: "fa-paw" },
    { value: "Celestiale", icon: "fa-sun" },
    { value: "Costrutto", icon: "fa-gear" },
    { value: "Drago", icon: "fa-dragon" },
    { value: "Elementale", icon: "fa-fire-flame-curved" },
    { value: "Folletto", icon: "fa-wand-sparkles" },
    { value: "Genio", icon: "fa-wind" },
    { value: "Gigante", icon: "fa-mountain" },
    { value: "Immondo", icon: "fa-fire" },
    { value: "Melma", icon: "fa-droplet" },
    { value: "Mostruosità", icon: "fa-burst" },
    { value: "Non morto", icon: "fa-skull" },
    { value: "Pianta", icon: "fa-seedling" },
    { value: "Umanoide", icon: "fa-user" },
];

const BESTIARY_DAMAGE_TYPES = [
    { value: "Acido", icon: "fa-flask-vial" },
    { value: "Contundente", icon: "fa-hammer" },
    { value: "Freddo", icon: "fa-snowflake" },
    { value: "Fuoco", icon: "fa-fire-flame-curved" },
    { value: "Forza", icon: "fa-burst" },
    { value: "Fulmine", icon: "fa-bolt" },
    { value: "Necrotico", icon: "fa-skull" },
    { value: "Perforante", icon: "fa-crosshairs" },
    { value: "Psichico", icon: "fa-brain" },
    { value: "Radiante", icon: "fa-sun" },
    { value: "Tagliente", icon: "fa-scissors" },
    { value: "Tuono", icon: "fa-volume-high" },
    { value: "Veleno", icon: "fa-skull-crossbones" },
];

function filterVisibleBestiaryCreatures(creatures) {
    if (window.WikiSpoiler) {
        return window.WikiSpoiler.filterVisible(creatures);
    }
    if (!Array.isArray(creatures)) return [];
    return creatures.filter(creature => creature.hidden !== true && creature.status !== "hidden");
}

async function resolveBestiaryUserIsDm() {
    if (typeof window.CriptaApp?.auth?.isCurrentUserDm !== "function") return false;
    return window.CriptaApp.auth.isCurrentUserDm(window.CriptaBasePath || "").catch(() => false);
}

function initBestiaryFilters(creatures, state, elements) {
    renderCategoryFilters(creatures, state, elements.categoryFilters);
    renderRankFilters(state, elements.rankFilters);
    renderTypeFilters(creatures, state, elements.typeFilters);

    elements.search?.addEventListener("input", event => {
        state.query = event.target.value.trim();
        updateBestiaryView(creatures, state, elements.grid, elements.count);
    });

    elements.categoryFilters?.addEventListener("click", event => {
        const button = event.target.closest("[data-bestiary-category]");
        if (!button) return;
        state.category = button.dataset.bestiaryCategory;
        updateActiveFilter(elements.categoryFilters, "[data-bestiary-category]", state.category);
        updateBestiaryView(creatures, state, elements.grid, elements.count);
    });

    elements.rankFilters?.addEventListener("click", event => {
        const button = event.target.closest("[data-bestiary-rank]");
        if (!button) return;
        state.rank = button.dataset.bestiaryRank;
        updateActiveFilter(elements.rankFilters, "[data-bestiary-rank]", state.rank);
        updateBestiaryView(creatures, state, elements.grid, elements.count);
    });

    elements.typeFilters?.addEventListener("click", event => {
        const button = event.target.closest("[data-bestiary-type]");
        if (!button) return;
        state.type = button.dataset.bestiaryType;
        updateActiveFilter(elements.typeFilters, "[data-bestiary-type]", state.type);
        updateBestiaryView(creatures, state, elements.grid, elements.count);
    });

    elements.groupToggle?.addEventListener("change", event => {
        state.groupByCategory = event.target.checked;
        updateBestiaryView(creatures, state, elements.grid, elements.count);
    });
}

function renderCategoryFilters(creatures, state, container) {
    if (!container) return;
    const categories = [...new Set(creatures.map(getBestiaryCategory))]
        .sort(compareBestiaryCategoryNames);
    const filters = [
        { value: "all", label: "Tutte" },
        ...categories.map(category => ({ value: category, label: category }))
    ];
    container.innerHTML = filters.map(filter => renderFilterButton(
        "bestiary-category",
        filter.value,
        filter.label,
        state.category === filter.value
    )).join("");
}

function renderRankFilters(state, container) {
    if (!container) return;
    const filters = [
        { value: "all", label: "Tutti", icon: "fa-layer-group" },
        { value: "normal", label: "Normali", icon: "fa-circle" },
        { value: "mini_boss", label: "Creature Maggiori", icon: "fa-skull" },
        { value: "unique_monster", label: "Creature Uniche", icon: "fa-crown" },
        { value: "special", label: "Speciali", icon: "fa-star" },
        { value: "undiscovered", label: "Misteriose", icon: "fa-eye-slash" },
        ...(state.userIsDm ? [{ value: "hidden", label: "Nascoste", icon: "fa-user-slash" }] : [])
    ];
    container.innerHTML = filters.map(filter => renderFilterButton(
        "bestiary-rank",
        filter.value,
        filter.label,
        state.rank === filter.value,
        filter.icon
    )).join("");
}

function renderTypeFilters(creatures, state, container) {
    if (!container) return;
    const filters = [
        { value: "all", label: "Tutti", icon: "fa-dna" },
        ...BESTIARY_CREATURE_TYPES.map(type => ({ value: type.value, label: type.value, icon: type.icon }))
    ];
    container.innerHTML = filters.map(filter => renderFilterButton(
        "bestiary-type",
        filter.value,
        filter.label,
        state.type === filter.value,
        filter.icon
    )).join("");
}

function renderFilterButton(type, value, label, active, icon) {
    return `
        <button class="bestiary-filter ${active ? "is-active" : ""}" type="button" data-${type}="${escapeHtml(value)}" aria-pressed="${active ? "true" : "false"}">
            ${icon ? `<i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>` : ""}
            <span>${escapeHtml(label)}</span>
        </button>
    `;
}

function updateActiveFilter(container, selector, activeValue) {
    container.querySelectorAll(selector).forEach(button => {
        const isActive = Object.values(button.dataset).includes(activeValue);
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
}

function updateBestiaryView(creatures, state, grid, count) {
    const filteredCreatures = filterBestiaryCreatures(creatures, state);
    renderBestiary(filteredCreatures, grid, count, state);
}

function filterBestiaryCreatures(creatures, state) {
    const query = normalizeSearchText(state.query);
    return creatures.filter(creature => {
        if (state.category !== "all" && getBestiaryCategory(creature) !== state.category) return false;
        if (state.rank === "hidden" && !isBestiaryHiddenFromPlayers(creature)) return false;
        if (state.rank !== "all" && state.rank !== "hidden" && getBestiaryStatus(creature) !== state.rank) return false;
        if (state.type !== "all" && getBestiaryType(creature) !== state.type) return false;
        if (!query) return true;
        return getBestiarySearchText(creature).includes(query);
    });
}

function getBestiarySearchText(creature) {
    const details = creature.details || {};
    return normalizeSearchText([
        creature.name,
        getBestiaryCategory(creature),
        getBestiaryRank(creature.rank)?.label,
        isBestiaryDiscovered(creature) ? "" : "misteriosa non scoperta",
        isBestiaryHiddenFromPlayers(creature) ? "nascosta hidden invisibile player" : "",
        details.description,
        details.dndType,
        details.size
    ].filter(Boolean).join(" "));
}

function normalizeSearchText(value) {
    return window.CriptaApp.utils.normalizeText(value);
}

function renderBestiary(creatures, grid, count, state = {}) {
    window.currentBestiaryCreatures = Array.isArray(creatures) ? creatures : [];

    if (!Array.isArray(creatures) || creatures.length === 0) {
        grid.innerHTML = '<p class="bestiary-state">Nessuna creatura corrisponde ai filtri.</p>';
        if (count) count.textContent = "0 voci";
        return;
    }

    if (count) {
        count.textContent = `${creatures.length} ${creatures.length === 1 ? "voce" : "voci"}`;
    }

    const indexedCreatures = creatures.map((creature, index) => ({ creature, index }));
    if (state.groupByCategory === false) {
        const items = indexedCreatures.sort(compareBestiaryItems);
        grid.innerHTML = `
            <div class="bestiary-section-grid bestiary-section-grid--flat">
                ${items.map(({ creature, index }) => renderBestiaryCard(creature, index, state)).join("")}
            </div>
        `;
        bindBestiaryImageRecovery(grid);
        return;
    }

    const groups = groupBestiaryCreatures(indexedCreatures);

    grid.innerHTML = groups.map(group => `
        <section class="bestiary-section" aria-labelledby="${escapeHtml(group.id)}">
            <div class="bestiary-section-header">
                <h3 id="${escapeHtml(group.id)}">${escapeHtml(group.title)}</h3>
                <span>${group.items.length} ${group.items.length === 1 ? "creatura" : "creature"}</span>
            </div>
            <div class="bestiary-section-grid">
                ${group.items.map(({ creature, index }) => renderBestiaryCard(creature, index, state)).join("")}
            </div>
        </section>
    `).join("");
    bindBestiaryImageRecovery(grid);
}

function groupBestiaryCreatures(indexedCreatures) {
    const groupMap = new Map();
    indexedCreatures.forEach(item => {
        const title = getBestiaryCategory(item.creature);
        if (!groupMap.has(title)) {
            groupMap.set(title, {
                title,
                id: `bestiary-section-${slugify(title)}`,
                items: []
            });
        }
        groupMap.get(title).items.push(item);
    });
    return [...groupMap.values()].map(group => ({
        ...group,
        items: group.items.sort(compareBestiaryItems)
    })).sort(compareBestiaryGroups);
}

function compareBestiaryGroups(a, b) {
    return compareBestiaryCategoryNames(a.title, b.title);
}

function compareBestiaryItems(a, b) {
    return a.creature.name.localeCompare(b.creature.name, "it", { sensitivity: "base" });
}

function compareBestiaryCategoryNames(a, b) {
    if (a === "Senza Categoria" && b !== "Senza Categoria") return -1;
    if (b === "Senza Categoria" && a !== "Senza Categoria") return 1;
    if (a === "Speciale" && b !== "Speciale") return 1;
    if (b === "Speciale" && a !== "Speciale") return -1;
    return a.localeCompare(b, "it", { sensitivity: "base" });
}

function getBestiaryImageCandidates(creature) {
    const candidates = [creature?.image, creature?.tokenImage]
        .map(resolveImageUrl)
        .map(value => String(value || "").trim())
        .filter(Boolean);
    return [...new Set(candidates)];
}

function renderBestiaryCardImage(creature, cardName) {
    const candidates = getBestiaryImageCandidates(creature);
    if (!candidates.length) return "";
    return '<img src="' + escapeHtml(candidates[0])
        + '" alt="' + escapeHtml(cardName)
        + '" loading="lazy" decoding="async" style="' + buildBestiaryImageStyle(creature.imageAdjust)
        + '" data-bestiary-image data-bestiary-image-srcs="' + escapeHtml(encodeURIComponent(JSON.stringify(candidates)))
        + '" data-bestiary-image-index="0" data-bestiary-image-retry="0">';
}

function bindBestiaryImageRecovery(container) {
    container.querySelectorAll("[data-bestiary-image]").forEach((image) => {
        image.addEventListener("load", () => {
            image.classList.remove("is-retrying", "is-missing");
            image.dataset.bestiaryImageRetry = "0";
        });
        image.addEventListener("error", () => recoverBestiaryImage(image));
        if (image.complete && image.naturalWidth === 0) recoverBestiaryImage(image);
    });
}

function recoverBestiaryImage(image) {
    if (!(image instanceof HTMLImageElement)) return;
    const candidates = parseBestiaryImageCandidates(image.dataset.bestiaryImageSrcs);
    if (!candidates.length) {
        markBestiaryImageMissing(image);
        return;
    }

    const currentIndex = Math.max(0, Number(image.dataset.bestiaryImageIndex || 0));
    const currentRetry = Math.max(0, Number(image.dataset.bestiaryImageRetry || 0));
    const currentUrl = candidates[currentIndex];
    if (currentUrl && currentRetry < 2) {
        image.dataset.bestiaryImageRetry = String(currentRetry + 1);
        image.classList.add("is-retrying");
        const delay = 260 + currentRetry * 620 + Math.floor(Math.random() * 220);
        window.setTimeout(() => {
            image.src = appendBestiaryImageRetryParam(currentUrl);
        }, delay);
        return;
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex < candidates.length) {
        image.dataset.bestiaryImageIndex = String(nextIndex);
        image.dataset.bestiaryImageRetry = "0";
        image.classList.add("is-retrying");
        window.setTimeout(() => {
            image.src = appendBestiaryImageRetryParam(candidates[nextIndex]);
        }, 240);
        return;
    }

    markBestiaryImageMissing(image);
}

function parseBestiaryImageCandidates(value) {
    try {
        const parsed = JSON.parse(decodeURIComponent(String(value || "%5B%5D")));
        return Array.isArray(parsed) ? parsed.map(item => String(item || "").trim()).filter(Boolean) : [];
    } catch (_) {
        return [];
    }
}

function appendBestiaryImageRetryParam(url) {
    const separator = String(url || "").includes("?") ? "&" : "?";
    return String(url || "") + separator + "img_retry=" + Date.now().toString(36);
}

function markBestiaryImageMissing(image) {
    image.classList.remove("is-retrying");
    image.classList.add("is-missing");
    image.removeAttribute("src");
}

function renderBestiaryCard(creature, index, state = {}) {
    const rank = getBestiaryRank(creature.rank);
    const discovered = isBestiaryDiscovered(creature);
    const hiddenFromPlayers = isBestiaryHiddenFromPlayers(creature);
    const userIsDm = Boolean(state.userIsDm);
    const playerVisibilityBadge = userIsDm ? renderBestiaryPlayerVisibilityBadge(creature) : "";
    const mysteryIcon = !userIsDm && !discovered ? `<span class="bestiary-rank-icon bestiary-rank-icon--undiscovered" title="Creatura Misteriosa" aria-label="Creatura Misteriosa"><i class="fas fa-eye-slash" aria-hidden="true"></i></span>` : "";
    const rankIcon = (userIsDm || discovered) && rank ? `<span class="bestiary-rank-icon bestiary-rank-icon--${rank.className}" title="${rank.label}" aria-label="${rank.label}"><i class="${rank.icon}" aria-hidden="true"></i></span>` : "";
    const cardName = userIsDm || discovered ? creature.name : (creature.mysteryName || "Creatura Misteriosa");
    const detailUrl = buildBestiaryDetailUrl(creature);
    const classes = [
        "bestiary-card",
        rank && (userIsDm || discovered) ? `bestiary-card--${rank.className}` : "",
        !userIsDm && !discovered ? "bestiary-card--undiscovered" : "",
        userIsDm && !discovered ? "bestiary-card--dm-undiscovered" : "",
        userIsDm && hiddenFromPlayers ? "bestiary-card--dm-hidden" : ""
    ].filter(Boolean).join(" ");
    return `
        <a class="${classes}" href="${escapeHtml(detailUrl)}" aria-label="Apri ${escapeHtml(cardName)}">
            <span class="bestiary-image-frame">
                ${mysteryIcon}
                ${rankIcon}
                ${playerVisibilityBadge}
                ${renderBestiaryCardImage(creature, cardName)}
            </span>
            <span class="bestiary-card-name">${escapeHtml(cardName)}</span>
        </a>
    `;
}

function renderBestiaryPlayerVisibilityBadge(creature) {
    const hidden = isBestiaryHiddenFromPlayers(creature);
    const discovered = isBestiaryDiscovered(creature);
    if (hidden) {
        return `
            <span class="bestiary-player-visibility-badge bestiary-player-visibility-badge--hidden" title="I player non vedono questa creatura">
                <i class="fas fa-user-slash" aria-hidden="true"></i>
                <span>Nascosta</span>
            </span>
        `;
    }
    if (!discovered) {
        const playerName = creature.mysteryName || "Creatura Misteriosa";
        return `
            <span class="bestiary-player-visibility-badge bestiary-player-visibility-badge--undiscovered" title="I player vedono: ${escapeHtml(playerName)}">
                <i class="fas fa-eye-slash" aria-hidden="true"></i>
                <span>${escapeHtml(playerName)}</span>
            </span>
        `;
    }
    return "";
}

function buildBestiaryDetailUrl(creature) {
    const url = new URL("./bestiary/creature.html", window.location.href);
    url.searchParams.set("id", getBestiaryRouteId(creature));
    const campaignId = window.CriptaApp?.campaigns?.currentId?.() || "";
    if (campaignId && campaignId !== "cripta-di-sangue") url.searchParams.set("campaign", campaignId);
    return url.toString();
}

function getBestiaryRouteId(creature) {
    const id = slugify(creature?.id || "");
    const name = slugify(creature?.name || "");
    if (/^nuovo-mostro(?:-|$)/.test(id) && name && name !== "nuovo-mostro") return name;
    return id || name;
}

function buildBestiaryImageStyle(adjust) {
    return window.CriptaImageAdjust.buildPercentCssVars(adjust, {
        x: "--bestiary-img-x",
        y: "--bestiary-img-y",
        size: "--bestiary-img-scale"
    });
}

function getBestiaryRank(rank) {
    const ranks = {
        mini_boss: { label: "Creatura Maggiore", className: "mini-boss", icon: "fas fa-skull" },
        unique_monster: { label: "Creatura Unica", className: "unique-monster", icon: "fas fa-crown" },
        special: { label: "Speciale", className: "special", icon: "fas fa-star" }
    };
    return ranks[rank] || null;
}

function getBestiaryType(creature) {
    return normalizeBestiaryType(creature.details?.dndType);
}

function getBestiaryTypeMeta(type) {
    const normalizedType = normalizeBestiaryType(type);
    const meta = BESTIARY_CREATURE_TYPES.find(item => item.value === normalizedType);
    return meta
        ? { label: meta.value, icon: meta.icon }
        : { label: normalizedType || "Tipo ignoto", icon: "fa-dna" };
}

function normalizeBestiaryType(type) {
    const legacyTypes = {
        "Bestia mostruosa": "Mostruosità",
        "Umanoide corrotto": "Umanoide",
        "Vegetale": "Pianta",
        "Vegetale non morto": "Non morto"
    };
    return legacyTypes[type] || type || "";
}

function getBestiaryCategory(creature) {
    return creature.category || "Senza Categoria";
}

function isBestiaryDiscovered(creature) {
    return creature.discovered !== false;
}

function isBestiaryHiddenFromPlayers(creature) {
    return creature?.hidden === true || creature?.status === "hidden";
}

function getBestiaryStatus(creature) {
    if (!isBestiaryDiscovered(creature)) return "undiscovered";
    if (creature.rank === "mini_boss" || creature.rank === "unique_monster" || creature.rank === "special") return creature.rank;
    return "normal";
}

function initBestiaryModal() {
    const modal = document.getElementById("bestiary-modal");
    const image = document.getElementById("bestiary-modal-image");
    const title = document.getElementById("bestiary-modal-title");
    const kicker = document.getElementById("bestiary-modal-kicker");
    const details = document.getElementById("bestiary-modal-details");
    if (!modal || !image || !title || !kicker || !details) return;

    document.addEventListener("click", event => {
        const card = event.target.closest("[data-bestiary-index]");
        if (!card) return;
        const creature = window.currentBestiaryCreatures?.[Number(card.dataset.bestiaryIndex)];
        if (!creature) return;
        openBestiaryModal(creature, modal, image, title, kicker, details);
    });

    modal.querySelectorAll("[data-close-bestiary]").forEach(button => {
        button.addEventListener("click", () => closeBestiaryModal(modal));
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !modal.hidden) {
            closeBestiaryModal(modal);
        }
    });
}

function openBestiaryModal(creature, modal, image, title, kicker, details) {
    const rank = getBestiaryRank(creature.rank);
    const discovered = isBestiaryDiscovered(creature);
    const displayName = discovered ? creature.name : (creature.mysteryName || "Creatura Misteriosa");
    image.src = resolveImageUrl(creature.image);
    image.alt = displayName;
    title.textContent = displayName;
    kicker.textContent = [discovered ? rank?.label : "Non Scoperta", getBestiaryCategory(creature)].filter(Boolean).join(" | ");
    details.innerHTML = discovered
        ? renderBestiaryDetails(creature.details)
        : renderUndiscoveredBestiaryDetails(creature);

    modal.hidden = false;
    document.body.classList.add("bestiary-modal-open");
}

function renderUndiscoveredBestiaryDetails(creature) {
    const note = creature.mysteryDescription || "La creatura è stata intravista o registrata da fonti incomplete. I dettagli completi saranno disponibili dopo la scoperta.";
    return `<p class="bestiary-modal-description">${escapeHtml(note)}</p>`;
}

function renderBestiaryDetails(details) {
    if (!details) return "";

    const stats = [
        ["Tipo", details.dndType, "type"],
        ["Taglia", details.size],
        ["Altezza", details.height],
        ["Peso", details.weight]
    ].filter(([, value]) => Boolean(value));

    const traits = Array.isArray(details.traits) ? details.traits.filter(Boolean) : [];
    const drops = Array.isArray(details.drops) ? details.drops.filter(Boolean) : [];
    const defenses = [
        ["Resistenze", details.resistances],
        ["Immunità", details.immunities],
        ["Vulnerabilità", details.vulnerabilities]
    ].map(([label, values]) => [
        label,
        Array.isArray(values) ? values.filter(Boolean) : []
    ]).filter(([, values]) => values.length);

    return `
        ${details.description ? `<p class="bestiary-modal-description">${escapeHtml(details.description)}</p>` : ""}
        ${stats.length ? `
            <dl class="bestiary-modal-stats">
                ${stats.map(([label, value]) => `
                    <div>
                        <dt>${escapeHtml(label)}</dt>
                        <dd>${renderBestiaryStatValue(label, value)}</dd>
                    </div>
                `).join("")}
            </dl>
        ` : ""}
        ${defenses.length ? `
            <div class="bestiary-modal-defense-grid">
                ${defenses.map(([label, values]) => `
                    <div class="bestiary-modal-defense bestiary-modal-defense--${slugify(label)}">
                        <h3>${escapeHtml(label)}</h3>
                        <ul class="bestiary-modal-list">
                            ${values.map(value => `<li>${renderBestiaryDefenseValue(value)}</li>`).join("")}
                        </ul>
                    </div>
                `).join("")}
            </div>
        ` : ""}
        ${traits.length ? `
            <div class="bestiary-modal-block">
                <h3>Tratti</h3>
                <ul class="bestiary-modal-list">
                    ${traits.map(trait => `<li>${renderBestiaryTrait(trait)}</li>`).join("")}
                </ul>
            </div>
        ` : ""}
        ${drops.length ? `
            <div class="bestiary-modal-block">
                <h3>Drop</h3>
                <ul class="bestiary-modal-list">
                    ${drops.map(drop => `<li>${renderBestiaryDrop(drop)}</li>`).join("")}
                </ul>
            </div>
        ` : ""}
    `;
}

function renderBestiaryStatValue(label, value) {
    if (label === "Tipo") return renderBestiaryType(value);
    if (label === "Altezza") return renderMetricMeasure(value, "height");
    if (label === "Peso") return renderMetricMeasure(value, "weight");
    return escapeHtml(value);
}

function renderMetricMeasure(value, kind) {
    const parsed = parseMetricMeasure(value, kind);
    if (!parsed) return escapeHtml(value);

    const converted = kind === "height"
        ? formatMetersAsFeetInches(parsed.amount)
        : formatKgAsPounds(parsed.amount);
    const note = parsed.note ? ` <span class="bestiary-measure-note">(${escapeHtml(parsed.note)})</span>` : "";
    return `
        <span class="bestiary-measure">
            <span class="bestiary-measure-primary">${escapeHtml(parsed.metricText)}${note}</span>
            <span class="bestiary-measure-converted">${escapeHtml(converted)}</span>
        </span>
    `;
}

function parseMetricMeasure(value, kind) {
    const unit = kind === "height" ? "m" : "kg";
    const pattern = kind === "height"
        ? /^(\d+(?:[,.]\d+)?)\s*m\b(.*)$/i
        : /^(\d+(?:[,.]\d{1,3})*(?:[,.]\d+)?)\s*kg\b(.*)$/i;
    const match = String(value || "").trim().match(pattern);
    if (!match) return null;

    const amount = parseItalianNumber(match[1]);
    if (!Number.isFinite(amount)) return null;

    return {
        amount,
        metricText: `${match[1].trim()} ${unit}`,
        note: String(match[2] || "").trim()
    };
}

function parseItalianNumber(value) {
    const raw = String(value || "").trim();
    if (raw.includes(",") && raw.includes(".")) {
        return Number(raw.replace(/\./g, "").replace(",", "."));
    }
    if (raw.includes(",")) {
        return Number(raw.replace(",", "."));
    }
    const parts = raw.split(".");
    if (parts.length > 1 && parts[parts.length - 1].length === 3) {
        return Number(raw.replace(/\./g, ""));
    }
    return Number(raw);
}

function formatMetersAsFeetInches(meters) {
    const totalInches = Math.round(meters * 39.3700787);
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    return `${feet} ft ${inches} in`;
}

function formatKgAsPounds(kg) {
    const pounds = kg * 2.20462262;
    const rounded = pounds < 10 ? Math.round(pounds * 10) / 10 : Math.round(pounds);
    return `${String(rounded).replace(".", ",")} lbs`;
}

function renderBestiaryType(type) {
    const meta = getBestiaryTypeMeta(type);
    return `
        <span class="bestiary-type-value">
            <i class="fas ${escapeHtml(meta.icon)}" aria-hidden="true"></i>
            <span>${escapeHtml(meta.label)}</span>
        </span>
    `;
}

function renderBestiaryDefenseValue(value) {
    const meta = getBestiaryDamageMeta(value);
    return `
        <span class="bestiary-defense-value">
            <i class="fas ${escapeHtml(meta.icon)}" aria-hidden="true"></i>
            <span>${escapeHtml(meta.label)}</span>
        </span>
    `;
}

function getBestiaryDamageMeta(value) {
    const label = String(value || "").trim();
    const meta = BESTIARY_DAMAGE_TYPES.find(item => item.value.toLowerCase() === label.toLowerCase());
    return meta
        ? { label: meta.value, icon: meta.icon }
        : { label: label || "Danno", icon: "fa-shield-halved" };
}

function renderBestiaryTrait(trait) {
    if (typeof trait === "string") return escapeHtml(trait);
    const name = escapeHtml(trait.name || "Tratto");
    const icon = trait.icon ? `<i class="fas ${escapeHtml(trait.icon)}" aria-hidden="true"></i>` : "";
    const note = trait.note ? `<span>${escapeHtml(trait.note)}</span>` : "";
    return `
        <span class="bestiary-trait">
            ${icon}
            <span>
                <strong>${name}</strong>
                ${note}
            </span>
        </span>
    `;
}

function renderBestiaryDrop(drop) {
    if (typeof drop === "string") return escapeHtml(drop);
    const itemId = resolveBestiaryDropItemId(drop);
    const name = escapeHtml(drop.name || "Oggetto");
    const note = drop.note ? `<span>${escapeHtml(drop.note)}</span>` : "";
    const rarity = drop.rarity ? `<em>${escapeHtml(drop.rarity)}</em>` : "";
    const image = drop.image
        ? `<img src="${escapeHtml(resolveImageUrl(drop.image))}" alt="" loading="lazy">`
        : "";
    const openTag = itemId
        ? `<button class="bestiary-drop" type="button" data-bestiary-item-id="${escapeHtml(itemId)}">`
        : '<span class="bestiary-drop">';
    const closeTag = itemId ? '</button>' : '</span>';
    return `
        ${openTag}
            ${image}
            <span class="bestiary-drop-text">
                <strong>${name}</strong>
                ${rarity}
                ${note}
            </span>
        ${closeTag}
    `;
}

function resolveBestiaryDropItemId(drop) {
    const explicitId = String(drop?.itemId || "").trim();
    if (explicitId && window.bestiaryItemsById?.has(explicitId)) return explicitId;
    const nameId = slugify(drop?.name || "");
    if (nameId && window.bestiaryItemsById?.has(nameId)) return nameId;
    return explicitId;
}

function initBestiaryItemModal() {
    let modal = document.getElementById("bestiary-item-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "bestiary-item-modal";
        modal.className = "bestiary-item-modal";
        modal.hidden = true;
        modal.innerHTML = `
            <button class="bestiary-item-modal-backdrop" type="button" data-close-bestiary-item aria-label="Chiudi"></button>
            <article class="bestiary-item-modal-card" role="dialog" aria-modal="true" aria-labelledby="bestiary-item-modal-title">
                <button class="bestiary-modal-close" type="button" data-close-bestiary-item aria-label="Chiudi">
                    <i class="fas fa-xmark" aria-hidden="true"></i>
                </button>
                <div id="bestiary-item-modal-content"></div>
            </article>
        `;
        document.body.appendChild(modal);
    }

    document.addEventListener("click", (event) => {
        const trigger = event.target.closest("[data-bestiary-item-id]");
        if (!trigger) return;
        event.preventDefault();
        const item = window.bestiaryItemsById?.get(trigger.dataset.bestiaryItemId);
        if (!item) return;
        openBestiaryItemModal(modal, item);
    });

    modal.addEventListener("click", (event) => {
        if (!event.target.closest("[data-close-bestiary-item]")) return;
        closeBestiaryItemModal(modal);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !modal.hidden) closeBestiaryItemModal(modal);
    });
}

function openBestiaryItemModal(modal, item) {
    const content = modal.querySelector("#bestiary-item-modal-content");
    if (!content) return;
    const image = item.image ? `<img class="bestiary-item-modal-image" src="${escapeHtml(resolveImageUrl(item.image))}" alt="${escapeHtml(item.name || "Oggetto")}">` : "";
    const properties = Array.isArray(item.properties) ? item.properties.filter(property => property && property.hidden !== true) : [];
    content.innerHTML = `
        ${image}
        <div class="bestiary-item-modal-body">
            <p class="bestiary-modal-kicker">${escapeHtml([item.type, item.rarity].filter(Boolean).join(" | ") || "Oggetto")}</p>
            <h2 id="bestiary-item-modal-title">${escapeHtml(item.name || "Oggetto")}</h2>
            ${item.summary ? `<p class="bestiary-modal-description">${escapeHtml(item.summary)}</p>` : ""}
            ${properties.length ? `
                <ul class="bestiary-modal-list">
                    ${properties.map((property) => `<li>${renderBestiaryItemProperty(property)}</li>`).join("")}
                </ul>
            ` : ""}
            ${item.notes ? `<p class="item-notes">${escapeHtml(item.notes)}</p>` : ""}
        </div>
    `;
    modal.hidden = false;
    document.body.classList.add("bestiary-item-modal-open");
}

function renderBestiaryItemProperty(property) {
    if (typeof property === "string") return escapeHtml(property);
    const name = property.name ? `<strong>${escapeHtml(property.name)}</strong>` : "";
    const description = property.description ? `<span>${escapeHtml(property.description)}</span>` : "";
    return `${name}${description}`;
}

function closeBestiaryItemModal(modal) {
    modal.hidden = true;
    document.body.classList.remove("bestiary-item-modal-open");
}

function closeBestiaryModal(modal) {
    modal.hidden = true;
    modal.querySelector("#bestiary-modal-image")?.removeAttribute("src");
    document.body.classList.remove("bestiary-modal-open");
}

function escapeHtml(value) {
    return window.CriptaApp.utils.escapeHtml(value);
}

function slugify(value) {
    return window.CriptaApp.utils.slugify(value, "section");
}
