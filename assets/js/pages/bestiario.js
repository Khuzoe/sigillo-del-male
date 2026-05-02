document.addEventListener("DOMContentLoaded", async () => {
    const grid = document.getElementById("bestiary-grid");
    const count = document.getElementById("bestiary-count");
    const search = document.getElementById("bestiary-search");
    const categoryFilters = document.getElementById("bestiary-category-filters");
    const rankFilters = document.getElementById("bestiary-rank-filters");
    if (!grid) return;

    try {
        const response = await fetch("../assets/data/bestiary.json");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const creatures = await response.json();
        const visibleCreatures = filterVisibleBestiaryCreatures(creatures);
        const state = {
            category: "all",
            rank: "all",
            query: ""
        };

        initBestiaryFilters(visibleCreatures, state, {
            grid,
            count,
            search,
            categoryFilters,
            rankFilters
        });
        updateBestiaryView(visibleCreatures, state, grid, count);
        initBestiaryModal();
    } catch (error) {
        console.error("Errore nel caricamento del bestiario:", error);
        grid.innerHTML = '<p class="bestiary-state bestiary-state--error">Impossibile caricare il bestiario.</p>';
    }
});

function filterVisibleBestiaryCreatures(creatures) {
    if (window.WikiSpoiler) {
        return window.WikiSpoiler.filterVisible(creatures);
    }
    if (!Array.isArray(creatures)) return [];
    return creatures.filter(creature => creature.hidden !== true && creature.status !== "hidden");
}

function initBestiaryFilters(creatures, state, elements) {
    renderCategoryFilters(creatures, state, elements.categoryFilters);
    renderRankFilters(state, elements.rankFilters);

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
        { value: "undiscovered", label: "Misteriose", icon: "fa-eye-slash" }
    ];
    container.innerHTML = filters.map(filter => renderFilterButton(
        "bestiary-rank",
        filter.value,
        filter.label,
        state.rank === filter.value,
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
    renderBestiary(filteredCreatures, grid, count);
}

function filterBestiaryCreatures(creatures, state) {
    const query = normalizeSearchText(state.query);
    return creatures.filter(creature => {
        if (state.category !== "all" && getBestiaryCategory(creature) !== state.category) return false;
        if (state.rank !== "all" && getBestiaryStatus(creature) !== state.rank) return false;
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
        details.description,
        details.dndType,
        details.size
    ].filter(Boolean).join(" "));
}

function normalizeSearchText(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function renderBestiary(creatures, grid, count) {
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
    const groups = groupBestiaryCreatures(indexedCreatures);

    grid.innerHTML = groups.map(group => `
        <section class="bestiary-section" aria-labelledby="${escapeHtml(group.id)}">
            <div class="bestiary-section-header">
                <h3 id="${escapeHtml(group.id)}">${escapeHtml(group.title)}</h3>
                <span>${group.items.length} ${group.items.length === 1 ? "creatura" : "creature"}</span>
            </div>
            <div class="bestiary-section-grid">
                ${group.items.map(({ creature, index }) => renderBestiaryCard(creature, index)).join("")}
            </div>
        </section>
    `).join("");
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
    return a.localeCompare(b, "it", { sensitivity: "base" });
}

function renderBestiaryCard(creature, index) {
    const rank = getBestiaryRank(creature.rank);
    const discovered = isBestiaryDiscovered(creature);
    const mysteryIcon = !discovered ? `<span class="bestiary-rank-icon bestiary-rank-icon--undiscovered" title="Creatura Misteriosa" aria-label="Creatura Misteriosa"><i class="fas fa-eye-slash" aria-hidden="true"></i></span>` : "";
    const rankIcon = discovered && rank ? `<span class="bestiary-rank-icon bestiary-rank-icon--${rank.className}" title="${rank.label}" aria-label="${rank.label}"><i class="${rank.icon}" aria-hidden="true"></i></span>` : "";
    const cardName = discovered ? creature.name : (creature.mysteryName || "Creatura Misteriosa");
    return `
        <button class="bestiary-card ${rank && discovered ? `bestiary-card--${rank.className}` : ""} ${!discovered ? "bestiary-card--undiscovered" : ""}" type="button" data-bestiary-index="${index}" aria-label="Apri ${escapeHtml(cardName)}">
            <span class="bestiary-image-frame">
                ${mysteryIcon}
                ${rankIcon}
                <img src="../assets/${escapeHtml(creature.image)}" alt="${escapeHtml(cardName)}" loading="lazy" style="${buildBestiaryImageStyle(creature.imageAdjust)}">
            </span>
            <span class="bestiary-card-name">${escapeHtml(cardName)}</span>
        </button>
    `;
}

function buildBestiaryImageStyle(adjust) {
    const x = normalizePercent(adjust?.x, 50);
    const y = normalizePercent(adjust?.y, 50);
    const size = normalizeScale(adjust?.size, 1);
    return `--bestiary-img-x:${x}%; --bestiary-img-y:${y}%; --bestiary-img-scale:${size};`;
}

function normalizePercent(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(100, number));
}

function normalizeScale(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.max(0.75, Math.min(1.35, number));
}

function getBestiaryRank(rank) {
    const ranks = {
        mini_boss: { label: "Creatura Maggiore", className: "mini-boss", icon: "fas fa-skull" },
        unique_monster: { label: "Creatura Unica", className: "unique-monster", icon: "fas fa-crown" }
    };
    return ranks[rank] || null;
}

function getBestiaryCategory(creature) {
    return creature.category || "Senza Categoria";
}

function isBestiaryDiscovered(creature) {
    return creature.discovered !== false;
}

function getBestiaryStatus(creature) {
    if (!isBestiaryDiscovered(creature)) return "undiscovered";
    if (creature.rank === "mini_boss" || creature.rank === "unique_monster") return creature.rank;
    return "normal";
}

function initBestiaryModal() {
    const modal = document.getElementById("bestiary-modal");
    const image = document.getElementById("bestiary-modal-image");
    const title = document.getElementById("bestiary-modal-title");
    const kicker = document.getElementById("bestiary-modal-kicker");
    const details = document.getElementById("bestiary-modal-details");
    const link = document.getElementById("bestiary-modal-link");
    if (!modal || !image || !title || !kicker || !details || !link) return;

    document.addEventListener("click", event => {
        const card = event.target.closest("[data-bestiary-index]");
        if (!card) return;
        const creature = window.currentBestiaryCreatures?.[Number(card.dataset.bestiaryIndex)];
        if (!creature) return;
        openBestiaryModal(creature, modal, image, title, kicker, details, link);
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

function openBestiaryModal(creature, modal, image, title, kicker, details, link) {
    const rank = getBestiaryRank(creature.rank);
    const discovered = isBestiaryDiscovered(creature);
    const displayName = discovered ? creature.name : (creature.mysteryName || "Creatura Misteriosa");
    image.src = `../assets/${creature.image}`;
    image.alt = displayName;
    title.textContent = displayName;
    kicker.textContent = [discovered ? rank?.label : "Non Scoperta", getBestiaryCategory(creature)].filter(Boolean).join(" | ");
    details.innerHTML = discovered
        ? renderBestiaryDetails(creature.details)
        : renderUndiscoveredBestiaryDetails(creature);

    if (discovered && creature.url) {
        link.href = creature.url;
        link.hidden = false;
    } else {
        link.hidden = true;
    }

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
        ["Tipo", details.dndType],
        ["Taglia", details.size],
        ["Altezza", details.height],
        ["Peso", details.weight]
    ].filter(([, value]) => Boolean(value));

    const traits = Array.isArray(details.traits) ? details.traits.filter(Boolean) : [];
    const drops = Array.isArray(details.drops) ? details.drops.filter(Boolean) : [];

    return `
        ${details.description ? `<p class="bestiary-modal-description">${escapeHtml(details.description)}</p>` : ""}
        ${stats.length ? `
            <dl class="bestiary-modal-stats">
                ${stats.map(([label, value]) => `
                    <div>
                        <dt>${escapeHtml(label)}</dt>
                        <dd>${escapeHtml(value)}</dd>
                    </div>
                `).join("")}
            </dl>
        ` : ""}
        ${traits.length ? `
            <div class="bestiary-modal-block">
                <h3>Tratti</h3>
                <ul class="bestiary-modal-list">
                    ${traits.map(trait => `<li>${escapeHtml(trait)}</li>`).join("")}
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

function renderBestiaryDrop(drop) {
    if (typeof drop === "string") return escapeHtml(drop);
    const name = escapeHtml(drop.name || "Oggetto");
    const note = drop.note ? ` <span>${escapeHtml(drop.note)}</span>` : "";
    const rarity = drop.rarity ? ` <em>${escapeHtml(drop.rarity)}</em>` : "";
    return `<strong>${name}</strong>${rarity}${note}`;
}

function closeBestiaryModal(modal) {
    modal.hidden = true;
    document.body.classList.remove("bestiary-modal-open");
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

function slugify(value) {
    return String(value ?? "section")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "section";
}
