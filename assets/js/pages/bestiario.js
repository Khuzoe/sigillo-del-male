document.addEventListener("DOMContentLoaded", async () => {
    const grid = document.getElementById("bestiary-grid");
    const count = document.getElementById("bestiary-count");
    if (!grid) return;

    try {
        const response = await fetch("../assets/data/bestiary.json");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const creatures = await response.json();
        const visibleCreatures = filterVisibleBestiaryCreatures(creatures);
        renderBestiary(visibleCreatures, grid, count);
        initBestiaryModal(visibleCreatures);
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

function renderBestiary(creatures, grid, count) {
    if (!Array.isArray(creatures) || creatures.length === 0) {
        grid.innerHTML = '<p class="bestiary-state">Nessuna creatura registrata.</p>';
        if (count) count.textContent = "0 reperti";
        return;
    }

    if (count) {
        count.textContent = `${creatures.length} ${creatures.length === 1 ? "reperto" : "reperti"}`;
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
        const title = item.creature.category || "Senza Categoria";
        if (!groupMap.has(title)) {
            groupMap.set(title, {
                title,
                id: `bestiary-section-${slugify(title)}`,
                items: []
            });
        }
        groupMap.get(title).items.push(item);
    });
    return [...groupMap.values()].sort(compareBestiaryGroups);
}

function compareBestiaryGroups(a, b) {
    if (a.title === "Senza Categoria" && b.title !== "Senza Categoria") return -1;
    if (b.title === "Senza Categoria" && a.title !== "Senza Categoria") return 1;
    return a.title.localeCompare(b.title, "it", { sensitivity: "base" });
}

function renderBestiaryCard(creature, index) {
    const rank = getBestiaryRank(creature.rank);
    const rankIcon = rank ? `<span class="bestiary-rank-icon bestiary-rank-icon--${rank.className}" title="${rank.label}" aria-label="${rank.label}"><i class="${rank.icon}" aria-hidden="true"></i></span>` : "";
    return `
        <button class="bestiary-card ${rank ? `bestiary-card--${rank.className}` : ""}" type="button" data-bestiary-index="${index}" aria-label="Apri ${escapeHtml(creature.name)}">
            <span class="bestiary-image-frame">
                ${rankIcon}
                <img src="../assets/${escapeHtml(creature.image)}" alt="${escapeHtml(creature.name)}" loading="lazy" style="${buildBestiaryImageStyle(creature.imageAdjust)}">
            </span>
            <span class="bestiary-card-name">${escapeHtml(creature.name)}</span>
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

function initBestiaryModal(creatures) {
    const modal = document.getElementById("bestiary-modal");
    const image = document.getElementById("bestiary-modal-image");
    const title = document.getElementById("bestiary-modal-title");
    const kicker = document.getElementById("bestiary-modal-kicker");
    const details = document.getElementById("bestiary-modal-details");
    const link = document.getElementById("bestiary-modal-link");
    if (!modal || !image || !title || !kicker || !details || !link) return;

    document.querySelectorAll("[data-bestiary-index]").forEach(card => {
        card.addEventListener("click", () => {
            const creature = creatures[Number(card.dataset.bestiaryIndex)];
            if (!creature) return;
            openBestiaryModal(creature, modal, image, title, kicker, details, link);
        });
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
    image.src = `../assets/${creature.image}`;
    image.alt = creature.name;
    title.textContent = creature.name;
    kicker.textContent = [rank?.label, creature.category || "Creatura"].filter(Boolean).join(" | ");
    details.innerHTML = renderBestiaryDetails(creature.details);

    if (creature.url) {
        link.href = creature.url;
        link.hidden = false;
    } else {
        link.hidden = true;
    }

    modal.hidden = false;
    document.body.classList.add("bestiary-modal-open");
}

function renderBestiaryDetails(details) {
    if (!details) return "";

    const stats = [
        ["Tipo D&D", details.dndType],
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
