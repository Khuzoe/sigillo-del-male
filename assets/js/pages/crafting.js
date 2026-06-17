const CRAFTING_ITEM_OVERRIDES_API_URL = () => window.CriptaApp?.urls?.api?.("api/data/item-overrides") || "https://sigillo-api.khuzoe.workers.dev/api/data/item-overrides";
const CRAFTING_DISCORD_TOKEN_KEY = "discord_jwt";
const CRAFTING_IMAGE_ADJUST_DATASET_KEYS = { x: "craftingAdjustX", y: "craftingAdjustY", size: "craftingAdjustSize" };
const CRAFTING_IMAGE_ADJUST_FRAME_SELECTORS = [".crafting-material-thumb"];

window.CriptaApp.onPageReady("crafting", async () => {
    const root = document.getElementById("crafting-root");
    const count = document.getElementById("crafting-count");
    if (!root) return;

    const state = {
        materials: [],
        selected: [],
        players: [],
        actors: [],
        progressItems: [],
        projects: [],
        projectsVersion: 0,
        projectsSource: "static",
        playerId: "",
        projectName: "",
        projectProgressDone: 0,
        status: "",
        statusError: false,
        query: "",
        rarityFilter: "all",
        tagFilter: "all"
    };

    try {
        const [items, players, inventory, itemOverrides, craftingProjects] = await Promise.all([
            loadItemsData(),
            loadPlayersData(),
            loadInventorySnapshot(),
            loadItemOverridesData(),
            loadCraftingProjectsData()
        ]);
        state.materials = filterVisibleItems(items).filter(isMaterialItem).sort(compareMaterials);
        state.players = Array.isArray(players) ? players : [];
        state.actors = Array.isArray(inventory?.actors) ? inventory.actors : [];
        state.projects = Array.isArray(craftingProjects?.data) ? craftingProjects.data : [];
        state.projectsVersion = Number(craftingProjects?.version || 0);
        state.projectsSource = craftingProjects?.source || "static";
        state.progressItems = collectCraftingProgressItems(state.actors, itemOverrides);
        if (count) count.textContent = `${state.materials.length} ${state.materials.length === 1 ? "materiale" : "materiali"}`;
        render(root, state);
    } catch (error) {
        console.error("Errore crafting:", error);
        root.innerHTML = '<p class="items-state items-state--error">Impossibile caricare il crafting.</p>';
    }
});

async function loadItemsData() {
    try {
        if (typeof window.CriptaApp?.api?.get === "function") {
            const payload = await window.CriptaApp.api.get("api/data/items", { query: { _: Date.now() } });
            if (Array.isArray(payload?.data)) return payload.data;
        }
    } catch (error) {
        console.warn("KV items non disponibile per crafting, uso JSON statico.", error);
    }
    const response = await fetch(window.CriptaApp?.urls?.data?.("items.json") || "../assets/data/items.json").catch(() => null);
    if (!response?.ok) return [];
    const payload = await response.json().catch(() => []);
    return Array.isArray(payload) ? payload : payload?.data || [];
}

async function loadPlayersData() {
    const response = await fetch(window.CriptaApp?.urls?.data?.("players.json") || "../assets/data/players.json").catch(() => null);
    if (!response?.ok) return [];
    const payload = await response.json().catch(() => []);
    return Array.isArray(payload) ? payload : payload?.data || [];
}

async function loadInventorySnapshot() {
    try {
        if (typeof window.CriptaApp?.api?.get === "function") return await window.CriptaApp.api.get("api/inventory", { query: { _: Date.now() } });
        const url = new URL("https://sigillo-api.khuzoe.workers.dev/api/inventory");
        url.searchParams.set("campaign", getCampaignId());
        const response = await fetch(url.toString());
        return response.ok ? response.json() : null;
    } catch (error) {
        console.warn("Inventory non disponibile per crafting.", error);
        return null;
    }
}

async function loadItemOverridesData() {
    try {
        if (typeof window.CriptaApp?.api?.get === "function") {
            const payload = await window.CriptaApp.api.get("api/data/item-overrides", { query: { _: Date.now() } });
            if (Array.isArray(payload?.data)) return payload.data;
        }
        const response = await fetch(CRAFTING_ITEM_OVERRIDES_API_URL());
        if (!response.ok) return [];
        const payload = await response.json();
        return Array.isArray(payload) ? payload : payload?.data || [];
    } catch (error) {
        console.warn("Item overrides non disponibili per crafting.", error);
        return [];
    }
}

async function loadCraftingProjectsData() {
    try {
        if (typeof window.CriptaApp?.api?.get === "function") {
            const payload = await window.CriptaApp.api.get("api/data/crafting", { query: { _: Date.now() } });
            return {
                data: Array.isArray(payload?.data) ? payload.data : [],
                version: Number(payload?.version || 0),
                source: payload?.source || "static"
            };
        }
        const response = await fetch(window.CriptaApp?.urls?.api?.("api/data/crafting") || "https://sigillo-api.khuzoe.workers.dev/api/data/crafting");
        if (!response.ok) return { data: [], version: 0, source: "static" };
        const payload = await response.json();
        return {
            data: Array.isArray(payload?.data) ? payload.data : [],
            version: Number(payload?.version || 0),
            source: payload?.source || "static"
        };
    } catch (error) {
        console.warn("Progetti crafting non disponibili.", error);
        return { data: [], version: 0, source: "static" };
    }
}

function render(root, state) {
    const filteredMaterials = filterMaterials(state.materials, state);
    const summary = getCraftingSummary(state);
    root.innerHTML = `
        ${renderCraftingRulesNote()}
        <section class="crafting-workbench" data-crafting-dropzone>
            <div class="crafting-workbench__main">
                <div class="crafting-workbench__head">
                    <div>
                        <span class="crafting-kicker">Materiali selezionati</span>
                        <h3>${escapeHtml(summary.rarityLabel)}</h3>
                    </div>
                    <button type="button" class="crafting-clear-btn" data-crafting-clear ${state.selected.length ? "" : "disabled"}>
                        <i class="fas fa-broom" aria-hidden="true"></i>
                        Svuota
                    </button>
                </div>
                <div class="crafting-drop-target ${state.selected.length ? "has-materials" : ""}">
                    ${state.selected.length ? renderSelectedMaterials(state) : '<p>Trascina qui i materiali o usa il tasto + nelle schede.</p>'}
                </div>
                <div class="crafting-value-row">
                    <label>
                        <span>Nome progetto</span>
                        <input type="text" value="${escapeHtml(state.projectName)}" placeholder="Oggetto in lavorazione" data-crafting-project-name>
                    </label>
                    <div class="crafting-value-meter">
                        <div class="loadout-progress__bar" aria-label="Valore crafting ${escapeHtml(summary.totalValue)}">
                            <span style="width: ${summary.barPercent.toFixed(2)}%"></span>
                        </div>
                        <small>${escapeHtml(summary.valueLabel)}</small>
                    </div>
                </div>
                <div class="crafting-save-row">
                    <label>
                        <span>Progresso</span>
                        <input type="number" min="0" step="1" value="${escapeHtml(state.projectProgressDone)}" data-crafting-progress-done>
                    </label>
                    <label>
                        <span>Ore richieste</span>
                        <input type="number" min="0" step="1" value="${escapeHtml(summary.timeHours)}" readonly>
                    </label>
                    <button type="button" data-crafting-save ${state.selected.length ? "" : "disabled"}>
                        <i class="fas fa-floppy-disk" aria-hidden="true"></i>
                        Salva progetto
                    </button>
                </div>
                ${state.status ? `<p class="crafting-status ${state.statusError ? "is-error" : ""}">${escapeHtml(state.status)}</p>` : ""}
            </div>
            <aside class="crafting-assignment">
                <label class="crafting-select-field">
                    <span>Giocatore assegnato</span>
                    <select data-crafting-player>
                        <option value="">Nessun giocatore</option>
                        ${getPlayerOptions(state).map((player) => `<option value="${escapeHtml(player.id)}" ${state.playerId === player.id ? "selected" : ""}>${escapeHtml(player.name)}</option>`).join("")}
                    </select>
                </label>
                ${renderProgressPanel(state)}
            </aside>
        </section>

        <section class="crafting-materials-panel">
            <div class="crafting-materials-head">
                <h3>Materiali</h3>
                <div class="crafting-material-controls">
                    <label class="items-search crafting-search">
                        <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
                        <input type="search" value="${escapeHtml(state.query)}" placeholder="Cerca materiale o tag..." data-crafting-search>
                    </label>
                    <label class="crafting-filter-field">
                        <span>Rarita</span>
                        <select data-crafting-rarity-filter>
                            <option value="all">Tutte</option>
                            ${getCraftingRarityOptions(state.materials).map((rarity) => `<option value="${escapeHtml(rarity)}" ${state.rarityFilter === rarity ? "selected" : ""}>${escapeHtml(rarity)}</option>`).join("")}
                        </select>
                    </label>
                    <label class="crafting-filter-field">
                        <span>Tag</span>
                        <select data-crafting-tag-filter>
                            <option value="all">Tutti</option>
                            ${getCraftingTagOptions(state.materials).map((tag) => `<option value="${escapeHtml(tag)}" ${state.tagFilter === tag ? "selected" : ""}>${escapeHtml(tag)}</option>`).join("")}
                        </select>
                    </label>
                </div>
            </div>
            <p class="crafting-materials-count">${filteredMaterials.length} ${filteredMaterials.length === 1 ? "materiale visibile" : "materiali visibili"}</p>
            <div class="crafting-material-grid">
                ${filteredMaterials.length ? filteredMaterials.map((material) => renderMaterialCard(material, state)).join("") : '<p class="items-state">Nessun materiale trovato.</p>'}
            </div>
        </section>
    `;
    bindCrafting(root, state);
    initCraftingAdjustedImages(root);
}

function bindCrafting(root, state) {
    root.querySelector("[data-crafting-project-name]")?.addEventListener("input", (event) => {
        state.projectName = event.target.value;
    });
    root.querySelector("[data-crafting-progress-done]")?.addEventListener("input", (event) => {
        state.projectProgressDone = Math.max(0, Number(event.target.value) || 0);
    });
    root.querySelector("[data-crafting-search]")?.addEventListener("input", (event) => {
        state.query = event.target.value.trim();
        render(root, state);
    });
    root.querySelector("[data-crafting-rarity-filter]")?.addEventListener("change", (event) => {
        state.rarityFilter = event.target.value || "all";
        render(root, state);
    });
    root.querySelector("[data-crafting-tag-filter]")?.addEventListener("change", (event) => {
        state.tagFilter = event.target.value || "all";
        render(root, state);
    });
    root.querySelector("[data-crafting-player]")?.addEventListener("change", (event) => {
        state.playerId = event.target.value;
        render(root, state);
    });
    root.querySelector("[data-crafting-clear]")?.addEventListener("click", () => {
        state.selected = [];
        state.status = "";
        render(root, state);
    });
    root.querySelector("[data-crafting-save]")?.addEventListener("click", async () => {
        await saveCraftingProject(root, state);
    });
    root.querySelectorAll("[data-material-add]").forEach((button) => {
        button.addEventListener("click", () => {
            addMaterialById(state, button.dataset.materialAdd || "");
            render(root, state);
        });
    });
    root.querySelectorAll("[data-material-remove]").forEach((button) => {
        button.addEventListener("click", () => {
            const index = Number(button.dataset.materialRemove);
            state.selected.splice(index, 1);
            render(root, state);
        });
    });
    root.querySelectorAll("[data-material-card]").forEach((card) => {
        card.addEventListener("dragstart", (event) => {
            event.dataTransfer?.setData("text/plain", card.dataset.materialCard || "");
            event.dataTransfer?.setData("application/x-crafting-material", card.dataset.materialCard || "");
        });
    });
    const dropzone = root.querySelector("[data-crafting-dropzone]");
    dropzone?.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropzone.classList.add("is-dragging");
    });
    dropzone?.addEventListener("dragleave", (event) => {
        if (dropzone.contains(event.relatedTarget)) return;
        dropzone.classList.remove("is-dragging");
    });
    dropzone?.addEventListener("drop", (event) => {
        event.preventDefault();
        dropzone.classList.remove("is-dragging");
        const id = event.dataTransfer?.getData("application/x-crafting-material") || event.dataTransfer?.getData("text/plain") || "";
        if (!id) return;
        addMaterialById(state, id);
        render(root, state);
    });
}

function addMaterialById(state, id) {
    const material = state.materials.find((item) => getItemId(item) === id);
    if (!material) return;
    state.selected.push(getItemId(material));
    state.status = "";
}

function renderCraftingRulesNote() {
    return `
        <section class="crafting-rules-note" aria-label="Regole crafting">
            <div>
                <span class="crafting-kicker">Regole crafting</span>
                <p>Il valore dei materiali determina la rarita raggiunta; la rarita finale non puo superare quella del materiale piu raro usato.</p>
                <p>Una prova di Arcana puo aumentare le ore di lavoro effettive svolte.</p>
                <div class="crafting-arcana-reminder" aria-label="Moltiplicatori prova Arcana">
                    ${CRAFTING_ARCANA_MULTIPLIERS.map((entry) => `
                        <span><strong>${escapeHtml(entry.dc)}</strong> x${escapeHtml(entry.multiplier)}</span>
                    `).join("")}
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Rarita</th>
                        <th>Tempo minimo</th>
                        <th>Costo minimo</th>
                    </tr>
                </thead>
                <tbody>
                    ${CRAFTING_RULES.map((rule) => `
                        <tr>
                            <td>${escapeHtml(rule.label)}</td>
                            <td>${formatNumberIt(rule.hours)} ore</td>
                            <td>${formatGoldValue(rule.cost)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </section>
    `;
}

async function saveCraftingProject(root, state) {
    const token = readSharedAuthToken();
    if (!token) {
        state.status = "Login richiesto per salvare il progetto.";
        state.statusError = true;
        render(root, state);
        return;
    }
    const selectedMaterials = state.selected
        .map((id) => state.materials.find((material) => getItemId(material) === id))
        .filter(Boolean);
    if (!selectedMaterials.length) {
        state.status = "Aggiungi almeno un materiale prima di salvare.";
        state.statusError = true;
        render(root, state);
        return;
    }

    const summary = getCraftingSummary(state);
    const player = getPlayerOptions(state).find((entry) => entry.id === state.playerId) || null;
    const name = String(state.projectName || summary.rarityLabel || "Progetto crafting").trim() || "Progetto crafting";
    const project = {
        id: buildCraftingProjectId(name, state.playerId),
        name,
        playerId: state.playerId || "",
        playerName: player?.name || "",
        progress: {
            label: "Progresso",
            done: Math.max(0, Number(state.projectProgressDone) || 0),
            total: Math.max(1, Number(summary.timeHours) || 1),
            unit: "ore",
            crafting: true
        },
        value: {
            total: summary.totalValue,
            rarity: summary.rarityLabel,
            maxRarity: summary.maxRarityLabel,
            requiredCost: summary.requiredCost,
            requiredHours: summary.timeHours
        },
        materials: selectedMaterials.map((material) => ({
            id: getItemId(material),
            name: material.name || "",
            rarity: material.rarity || "",
            valueGold: material.valueGold ?? material.value ?? "",
            tags: getVisibleMaterialTags(material).map((tag) => ({ name: tag.name || "", description: tag.description || "" }))
        })),
        updatedAt: new Date().toISOString()
    };
    const nextProjects = [
        ...state.projects.filter((entry) => entry?.id !== project.id),
        project
    ].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "it"));

    try {
        const body = {
            data: nextProjects,
            campaignId: getCampaignId()
        };
        if (state.projectsSource === "kv") body.expectedVersion = state.projectsVersion;
        const result = await window.CriptaApp.api.post("api/data/crafting", body, { token });
        state.projects = nextProjects;
        state.projectsVersion = Number(result?.version || state.projectsVersion || 0);
        state.projectsSource = "kv";
        state.status = "Progetto crafting salvato.";
        state.statusError = false;
        window.CriptaApp?.api?.clearCache?.();
    } catch (error) {
        console.error("Salvataggio crafting fallito:", error);
        state.status = `Salvataggio fallito: ${error?.message || error}`;
        state.statusError = true;
    }
    render(root, state);
}

function renderSelectedMaterials(state) {
    return `
        <div class="crafting-selected-list">
            ${state.selected.map((id, index) => {
                const material = state.materials.find((item) => getItemId(item) === id);
                if (!material) return "";
                return `
                    <span class="crafting-selected-chip">
                        ${escapeHtml(material.name || "Materiale")}
                        <small>${escapeHtml(material.rarity || "Sconosciuta")}</small>
                        <button type="button" data-material-remove="${index}" aria-label="Rimuovi ${escapeHtml(material.name || "materiale")}"><i class="fas fa-xmark" aria-hidden="true"></i></button>
                    </span>
                `;
            }).join("")}
        </div>
    `;
}

function renderMaterialCard(material, state) {
    const id = getItemId(material);
    const rarity = getItemRarityMeta(material.rarity);
    const tags = getVisibleMaterialTags(material);
    const selectedCount = state.selected.filter((entry) => entry === id).length;
    const imagePath = getMaterialImagePath(material);
    const imageUrl = imagePath ? resolveImageUrl(imagePath) : "";
    return `
        <article class="crafting-material-card item-card--${escapeHtml(slugify(rarity.label))}" draggable="true" data-material-card="${escapeHtml(id)}">
            <header>
                <div class="crafting-material-card__head-main">
                    <div class="crafting-material-thumb">
                        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" ${renderCraftingAdjustedImageAttributes(material.imageAdjust)}>` : `<i class="fas fa-cubes-stacked" aria-hidden="true"></i>`}
                    </div>
                    <div>
                        <span><i class="fas ${escapeHtml(rarity.icon)}" aria-hidden="true"></i>${escapeHtml(rarity.label)}</span>
                        <h4>${escapeHtml(material.name || "Materiale")}</h4>
                    </div>
                </div>
                <button type="button" data-material-add="${escapeHtml(id)}" title="Aggiungi al crafting" aria-label="Aggiungi ${escapeHtml(material.name || "materiale")}">
                    <i class="fas fa-plus" aria-hidden="true"></i>
                </button>
            </header>
            ${selectedCount ? `<p class="crafting-selected-count">Selezionato x${selectedCount}</p>` : ""}
            ${renderMaterialMeta(material)}
            ${tags.length ? `<ul class="item-material-tags">${tags.map((tag) => `<li>${renderMaterialTag(tag)}</li>`).join("")}</ul>` : ""}
            ${material.summary ? `<p class="item-summary">${escapeHtml(material.summary)}</p>` : ""}
        </article>
    `;
}

function renderProgressPanel(state) {
    const playerOptions = getPlayerOptions(state);
    const selectedPlayer = playerOptions.find((player) => player.id === state.playerId);
    const projectItems = normalizeCraftingProjectsAsProgress(state.projects);
    const progressItems = [...projectItems, ...state.progressItems].filter((item) => {
        if (!state.playerId) return true;
        const key = normalizeText(item.characterId || item.characterName || item.actorName);
        return key && selectedPlayer?.keys?.has(key);
    });
    const limited = progressItems.slice(0, 8);
    return `
        <div class="crafting-progress-panel">
            <h4>Progressi craft</h4>
            ${limited.length ? limited.map(renderCraftingProgressItem).join("") : '<p>Nessun progresso craft trovato per la selezione.</p>'}
        </div>
    `;
}

function normalizeCraftingProjectsAsProgress(projects) {
    return (Array.isArray(projects) ? projects : [])
        .map((project) => {
            const progress = normalizeProgress(project?.progress);
            if (!progress) return null;
            return {
                ...progress,
                itemName: project.name || "Progetto crafting",
                actorName: project.playerName || "",
                characterName: project.playerName || "",
                characterId: project.playerId || "",
                label: project.value?.rarity ? `${progress.label} - ${project.value.rarity}` : progress.label
            };
        })
        .filter(Boolean);
}

function renderCraftingProgressItem(item) {
    const percent = item.total > 0 ? Math.max(0, Math.min(100, (item.done / item.total) * 100)) : 0;
    return `
        <article class="crafting-progress-item">
            <header>
                <strong>${escapeHtml(item.itemName || "Craft")}</strong>
                <span>${escapeHtml(item.characterName || item.actorName || "Personaggio")}</span>
            </header>
            <div class="loadout-progress__bar" aria-label="${escapeHtml(item.label)} ${formatNumberIt(item.done)} su ${formatNumberIt(item.total)}">
                <span style="width: ${percent.toFixed(2)}%"></span>
            </div>
            <small>${escapeHtml(item.label)}: ${formatProgressAmount(item.done, item.unit)} / ${formatProgressAmount(item.total, item.unit)}</small>
        </article>
    `;
}

function collectCraftingProgressItems(actors, itemOverrides) {
    const rows = [];
    (Array.isArray(actors) ? actors : []).forEach((actor) => {
        (Array.isArray(actor.inventory) ? actor.inventory : []).forEach((entry) => {
            const progress = normalizeProgress(entry.progress || entry.system?.progress);
            if (!progress?.crafting) return;
            rows.push({
                ...progress,
                itemName: entry.name,
                actorName: actor.name,
                characterName: actor.characterName || actor.ownerCharacterName || actor.name,
                characterId: actor.ownerCharacterId || actor.characterId || ""
            });
        });
    });
    (Array.isArray(itemOverrides) ? itemOverrides : []).forEach((record) => {
        const progress = normalizeProgress(record?.progress);
        if (!progress?.crafting) return;
        rows.push({
            ...progress,
            itemName: record.itemName || record.name,
            actorName: record.actorName,
            characterName: record.characterName || record.actorName,
            characterId: record.characterId || record.actorId || ""
        });
    });
    return rows.sort((a, b) => String(a.characterName || a.actorName || "").localeCompare(String(b.characterName || b.actorName || ""), "it"));
}

function normalizeProgress(progress) {
    if (!progress || typeof progress !== "object") return null;
    const total = Number(progress.total || progress.required || 0);
    if (!Number.isFinite(total) || total <= 0) return null;
    const materials = normalizeProgressMaterials(progress.materials || progress.requiredMaterials || progress.components);
    return {
        label: String(progress.label || "Progresso").trim() || "Progresso",
        done: Math.max(0, Number(progress.done || progress.current || 0) || 0),
        total,
        unit: String(progress.unit || "").trim(),
        crafting: Boolean(progress.crafting || progress.isCrafting || materials.length),
        materials
    };
}

function normalizeProgressMaterials(materials) {
    const list = Array.isArray(materials) ? materials : Array.isArray(materials?.items) ? materials.items : [];
    return list
        .map((item) => typeof item === "string" ? { name: item } : item)
        .filter((item) => item && typeof item === "object" && String(item.name || "").trim());
}

function getCraftingSummary(state) {
    const selectedMaterials = state.selected
        .map((id) => state.materials.find((material) => getItemId(material) === id))
        .filter(Boolean);
    const totalValue = selectedMaterials.reduce((sum, material) => sum + getMaterialValue(material), 0);
    const maxRarityRank = selectedMaterials.reduce((max, material) => Math.max(max, getRarityRank(material.rarity)), 0);
    const valueRarityRank = CRAFTING_RULES.reduce((rank, rule) => totalValue >= rule.cost ? rule.rank : rank, 0);
    const rarityRank = Math.min(maxRarityRank, valueRarityRank);
    const currentRule = getCraftingRuleByRank(rarityRank);
    const nextRule = getNextCraftingRule(totalValue, maxRarityRank, rarityRank);
    const baseCost = currentRule?.cost || 0;
    const targetCost = nextRule?.cost || currentRule?.cost || CRAFTING_RULES[0]?.cost || 1;
    const barPercent = !selectedMaterials.length
        ? 0
        : !nextRule
            ? 100
            : Math.max(0, Math.min(100, ((totalValue - baseCost) / Math.max(1, targetCost - baseCost)) * 100));
    return {
        totalValue,
        barPercent,
        rarityLabel: rarityRank > 0 ? CRAFTING_RARITY_ORDER[rarityRank]?.label || "Sconosciuta" : "Nessuna rarita",
        maxRarityLabel: maxRarityRank > 0 ? CRAFTING_RARITY_ORDER[maxRarityRank]?.label || "Sconosciuta" : "nessuna",
        requiredCost: currentRule?.cost || 0,
        timeHours: currentRule?.hours || 0,
        valueLabel: getCraftingValueLabel(totalValue, currentRule, nextRule, maxRarityRank, rarityRank)
    };
}

const CRAFTING_RULES = [
    { rank: 1, label: "Comune", hours: 20, cost: 50 },
    { rank: 2, label: "Non comune", hours: 40, cost: 200 },
    { rank: 3, label: "Raro", hours: 200, cost: 2000 },
    { rank: 4, label: "Molto raro", hours: 500, cost: 20000 },
    { rank: 5, label: "Leggendario", hours: 1000, cost: 100000 }
];

const CRAFTING_ARCANA_MULTIPLIERS = [
    { dc: "10", multiplier: 2 },
    { dc: "18", multiplier: 3 },
    { dc: "26", multiplier: 4 },
    { dc: "34+", multiplier: 5 }
];

const CRAFTING_RARITY_ORDER = [
    { label: "Nessuna" },
    ...CRAFTING_RULES.map((rule) => ({ label: rule.label }))
];

function getRarityRank(rarity) {
    const normalized = normalizeText(rarity);
    const aliases = {
        epico: 4,
        artefatto: 5,
        sconosciuta: 0
    };
    if (Object.prototype.hasOwnProperty.call(aliases, normalized)) return aliases[normalized];
    const rule = CRAFTING_RULES.find((entry) => normalizeText(entry.label) === normalized);
    return rule?.rank || 0;
}

function getCraftingRuleByRank(rank) {
    return CRAFTING_RULES.find((rule) => rule.rank === rank) || null;
}

function getNextCraftingRule(totalValue, maxRarityRank, currentRank) {
    if (!maxRarityRank) return CRAFTING_RULES[0] || null;
    return CRAFTING_RULES.find((rule) => rule.rank > currentRank && rule.rank <= maxRarityRank && totalValue < rule.cost) || null;
}

function getCraftingValueLabel(totalValue, currentRule, nextRule, maxRarityRank, rarityRank) {
    const valueText = formatGoldValue(totalValue);
    if (!maxRarityRank) return `${valueText} / ${formatGoldValue(CRAFTING_RULES[0]?.cost || 0)} verso Comune`;
    if (!nextRule) {
        const capText = rarityRank >= maxRarityRank ? "cap materiali raggiunto" : "soglia massima raggiunta";
        return `${valueText} - ${capText}`;
    }
    const currentText = currentRule ? `${currentRule.label} raggiunto` : "nessuna rarita";
    return `${valueText} / ${formatGoldValue(nextRule.cost)} verso ${nextRule.label} (${currentText})`;
}

function getMaterialValue(material) {
    const raw = String(material?.valueGold ?? material?.value ?? "").replace(",", ".").trim();
    const number = Number(raw.replace(/[^\d.-]+/g, ""));
    return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function getPlayerOptions(state) {
    const map = new Map();
    (Array.isArray(state.players) ? state.players : []).forEach((player) => {
        const id = String(player.id || player.name || "").trim();
        if (!id) return;
        map.set(id, {
            id,
            name: player.name || id,
            keys: new Set([normalizeText(player.id), normalizeText(player.name), normalizeText(player.inventory_api_name)].filter(Boolean))
        });
    });
    (Array.isArray(state.actors) ? state.actors : []).forEach((actor) => {
        const id = String(actor.ownerCharacterId || actor.characterId || actor.name || "").trim();
        if (!id) return;
        const existing = map.get(id) || {
            id,
            name: actor.ownerCharacterName || actor.characterName || actor.name || id,
            keys: new Set()
        };
        [actor.ownerCharacterId, actor.characterId, actor.name, actor.ownerCharacterName, actor.characterName].forEach((value) => {
            const key = normalizeText(value);
            if (key) existing.keys.add(key);
        });
        map.set(id, existing);
    });
    return Array.from(map.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "it"));
}

function filterVisibleItems(items) {
    return window.CriptaItemNormalize.filterVisibleItems(items);
}

function filterMaterials(materials, state) {
    const needle = normalizeText(state.query);
    const rarityFilter = String(state.rarityFilter || "all");
    const tagFilter = String(state.tagFilter || "all");
    return (Array.isArray(materials) ? materials : []).filter((material) => {
        if (rarityFilter !== "all" && normalizeText(material.rarity || "Sconosciuta") !== normalizeText(rarityFilter)) return false;
        const tags = getVisibleMaterialTags(material);
        if (tagFilter !== "all" && !tags.some((tag) => normalizeText(tag.name) === normalizeText(tagFilter))) return false;
        if (!needle) return true;
        return normalizeText([
        material.name,
        material.summary,
        material.notes,
        material.rarity,
        material.valueGold,
        material.value,
            ...tags.flatMap((tag) => [tag.name, tag.description])
        ].filter(Boolean).join(" ")).includes(needle);
    });
}

function getCraftingRarityOptions(materials) {
    const values = new Set();
    (Array.isArray(materials) ? materials : []).forEach((material) => {
        const rarity = String(material?.rarity || "Sconosciuta").trim() || "Sconosciuta";
        values.add(rarity);
    });
    return Array.from(values).sort((a, b) => {
        const rank = getRarityRank(a) - getRarityRank(b);
        if (rank !== 0) return rank;
        return String(a).localeCompare(String(b), "it");
    });
}

function getCraftingTagOptions(materials) {
    const values = new Map();
    (Array.isArray(materials) ? materials : []).forEach((material) => {
        getVisibleMaterialTags(material).forEach((tag) => {
            const name = String(tag.name || "").trim();
            if (!name) return;
            const key = normalizeText(name);
            if (!values.has(key)) values.set(key, name);
        });
    });
    return Array.from(values.values()).sort((a, b) => String(a).localeCompare(String(b), "it"));
}

function isMaterialItem(item) {
    return window.CriptaItemNormalize.isMaterialItem(item);
}

function compareMaterials(a, b) {
    const rarity = getRarityRank(b.rarity) - getRarityRank(a.rarity);
    if (rarity !== 0) return rarity;
    return String(a.name || "").localeCompare(String(b.name || ""), "it");
}

function getItemCategory(item) {
    return window.CriptaItemNormalize.getItemCategory(item);
}

function getItemId(item) {
    return String(item?.id || slugify(item?.name || "")).trim();
}

function getMaterialImagePath(item) {
    return window.CriptaItemNormalize.getItemImagePath(item);
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

function renderCraftingAdjustedImageAttributes(adjust) {
    const normalized = normalizeCraftingImageAdjust(adjust);
    return [
        "data-crafting-adjusted-image",
        `data-crafting-adjust-x="${escapeHtml(normalized.x)}"`,
        `data-crafting-adjust-y="${escapeHtml(normalized.y)}"`,
        `data-crafting-adjust-size="${escapeHtml(normalized.size)}"`
    ].join(" ");
}

function normalizeCraftingImageAdjust(adjust) {
    return window.CriptaImageAdjust.normalizePercentAdjust(adjust);
}

function initCraftingAdjustedImages(root = document) {
    window.CriptaImageAdjust.initContainedImages(root, {
        selector: "[data-crafting-adjusted-image]",
        bindingKey: "crafting-adjusted-images",
        boundDatasetKey: "craftingAdjustedBound",
        datasetKeys: CRAFTING_IMAGE_ADJUST_DATASET_KEYS,
        frameSelectors: CRAFTING_IMAGE_ADJUST_FRAME_SELECTORS
    });
}

function applyCraftingAdjustedImageLayout(image) {
    window.CriptaImageAdjust.applyContainedImageLayout(image, {
        datasetKeys: CRAFTING_IMAGE_ADJUST_DATASET_KEYS,
        frameSelectors: CRAFTING_IMAGE_ADJUST_FRAME_SELECTORS
    });
}

function getItemRarityMeta(rarity) {
    return window.CriptaItemNormalize.getItemRarityMeta(rarity);
}

function normalizeMaterialTags(value) {
    return window.CriptaItemNormalize.normalizeMaterialTags(value);
}

function getVisibleMaterialTags(item) {
    return window.CriptaItemNormalize.getVisibleMaterialTags(item);
}

function renderMaterialMeta(item) {
    const rawValue = item.valueGold !== undefined && item.valueGold !== "" ? item.valueGold : item.value;
    const rows = [
        rawValue !== undefined && rawValue !== "" ? { icon: "fa-coins", label: "Valore", value: formatGoldValue(rawValue) } : null,
        item.weight !== undefined && item.weight !== "" ? { icon: "fa-weight-hanging", label: "Peso", value: formatWeightValue(item.weight) } : null
    ].filter(Boolean);
    if (!rows.length) return "";
    return `<dl class="item-material-meta">${rows.map((row) => `<div><dt><i class="fas ${escapeHtml(row.icon)}" aria-hidden="true"></i>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join("")}</dl>`;
}

function renderMaterialTag(tag) {
    return `<span>${escapeHtml(tag.name || "Tag")}</span>${tag.description ? `<p>${escapeHtml(tag.description)}</p>` : ""}`;
}

function formatGoldValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${formatNumberIt(number)} mo` : String(value || "");
}

function formatWeightValue(value) {
    return window.CriptaItemNormalize.formatWeightValue(value);
}

function formatProgressAmount(value, unit = "") {
    return `${formatNumberIt(value)}${unit ? ` ${unit}` : ""}`;
}

function formatNumberIt(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(number);
}

function getCampaignId() {
    return window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue";
}

function readSharedAuthToken() {
    try {
        return window.localStorage.getItem(CRAFTING_DISCORD_TOKEN_KEY)
            || window.sessionStorage.getItem(CRAFTING_DISCORD_TOKEN_KEY)
            || "";
    } catch (_) {
        return "";
    }
}

function buildCraftingProjectId(name, playerId) {
    return [getCampaignId(), playerId || "unassigned", slugify(name || "crafting")].filter(Boolean).join(":");
}

function normalizeText(value) {
    return window.CriptaApp.utils.normalizeKey(value);
}

function slugify(value) {
    return window.CriptaItemNormalize.slugify(value, "materiale");
}

function escapeHtml(value) {
    return window.CriptaApp.utils.escapeHtml(value);
}
