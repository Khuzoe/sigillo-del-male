window.CriptaApp.onPageReady("creature", async () => {
    const params = new URLSearchParams(window.location.search);
    const creatureId = slugify(params.get("id") || params.get("creature") || "");
    const createMode = params.get("new") === "1";
    const root = document.getElementById("creature-detail-root");
    const nameEl = document.getElementById("creature-name");
    const subtitleEl = document.getElementById("creature-subtitle");
    const editButton = document.getElementById("creature-edit-button");
    const backLink = document.querySelector(".bestiary-detail-back");
    if (!root) return;
    if (backLink) backLink.href = buildBestiaryListUrl();

    const state = {
        creatures: [],
        creature: null,
        version: 0,
        source: "static",
        editing: false,
        dirty: false,
        abilityTemplates: [],
        abilityFilter: "all",
        abilitySearch: "",
        activeAbilityIndex: 0
    };

    try {
        const loaded = await loadBestiaryDocument();
        state.creatures = loaded.data;
        state.version = loaded.version;
        state.source = loaded.source;
        state.abilityTemplates = await loadMonsterAbilityTemplates();
        state.creature = createMode ? createEmptyCreature() : findCreature(state.creatures, creatureId);
        if (state.creature && !state.creature.id) {
            state.creature.id = slugify(state.creature.name || creatureId);
        }
        if (state.creature) ensureFoundryMonsterData(state.creature);

        if (!state.creature || !isCreatureVisible(state.creature)) {
            redirectToBestiaryList();
            return;
        }
        if (createMode) {
            state.editing = true;
            state.dirty = true;
            editButton?.classList.add("is-editing");
        }

        editButton?.addEventListener("click", () => {
            if (state.editing) return;
            state.editing = true;
            state.dirty = false;
            editButton.classList.add("is-editing");
            render();
        });

        render();
    } catch (error) {
        console.error("Errore caricamento creatura:", error);
        root.innerHTML = '<p class="bestiary-detail-state">Impossibile caricare questa creatura.</p>';
    }

    function render() {
        const creature = state.creature;
        const displayName = getCreatureDisplayName(creature);
        const category = creature.category || "Senza categoria";
        const type = creature.details?.dndType || "Tipo ignoto";
        const rank = getRankLabel(creature.rank);

        document.title = `${displayName} | Bestiario`;
        if (nameEl) nameEl.textContent = displayName;
        if (subtitleEl) subtitleEl.textContent = [rank, category, type].filter(Boolean).join(" | ");

        root.innerHTML = state.editing ? renderEditor(creature) : renderDetail(creature);
        bindRenderedEvents();
    }

    function renderDetail(creature) {
        const details = creature.details || {};
        const stats = [
            ["Tipo", details.dndType],
            ["Taglia", details.size],
            ["Altezza", details.height],
            ["Peso", details.weight]
        ].filter(([, value]) => Boolean(value));
        const defenses = [
            ["Resistenze", details.resistances],
            ["Immunita", details.immunities],
            ["Vulnerabilita", details.vulnerabilities]
        ].map(([label, values]) => [label, Array.isArray(values) ? values.filter(Boolean) : []])
            .filter(([, values]) => values.length);
        const traits = Array.isArray(details.traits) ? details.traits.filter(Boolean) : [];
        const drops = Array.isArray(details.drops) ? details.drops.filter(Boolean) : [];

        return `
            <article class="bestiary-detail-card">
                <div class="bestiary-detail-main">
                    <aside class="bestiary-detail-image-panel">
                        <div class="bestiary-detail-image-frame">
                            <img src="${escapeHtml(resolveImageUrl(creature.image))}" alt="${escapeHtml(getCreatureDisplayName(creature))}" style="${buildImageStyle(creature.imageAdjust)}">
                        </div>
                        <div class="bestiary-detail-meta">
                            ${renderChip("fa-layer-group", creature.category || "Senza categoria")}
                            ${renderChip("fa-dna", details.dndType || "Tipo ignoto")}
                            ${renderChip(getRankIcon(creature.rank), getRankLabel(creature.rank) || "Normale")}
                            ${creature.discovered === false ? renderChip("fa-eye-slash", "Non scoperta") : ""}
                            ${creature.hidden === true ? renderChip("fa-lock", "Nascosta") : ""}
                        </div>
                    </aside>
                    <section class="bestiary-detail-info-panel">
                        <p class="bestiary-detail-description">${escapeHtml(details.description || "Nessuna descrizione registrata.")}</p>
                    </section>
                </div>
            </article>
            ${stats.length ? renderStatsSection(stats) : ""}
            ${defenses.length ? renderListSection("Difese", defenses.map(([label, values]) => ({ name: label, note: values.join(", ") }))) : ""}
            ${traits.length ? renderListSection("Tratti", traits.map(normalizeNamedEntry)) : ""}
            ${drops.length ? renderListSection("Drop", drops.map(normalizeNamedEntry)) : ""}
        `;
    }

    function renderEditor(creature) {
        const details = creature.details || {};
        const foundry = ensureFoundryMonsterData(creature);
        return `
            <div class="bestiary-detail-editor">
                <div class="bestiary-detail-toolbar" data-bestiary-toolbar>
                    <button class="bestiary-detail-action" type="button" data-action="download-foundry">
                        <i class="fas fa-file-export" aria-hidden="true"></i>
                        <span>Export Foundry</span>
                    </button>
                    <button class="bestiary-detail-action" type="button" data-action="cancel">Annulla</button>
                    <button class="bestiary-detail-action bestiary-detail-action--primary" type="button" data-action="save">
                        <i class="fas fa-cloud-arrow-up" aria-hidden="true"></i>
                        <span>Salva</span>
                    </button>
                </div>
                <article class="bestiary-detail-card">
                    <div class="bestiary-detail-main">
                        <aside class="bestiary-detail-image-panel">
                            <button class="bestiary-detail-image-frame bestiary-detail-image-upload" type="button" data-action="upload-image">
                                <img src="${escapeHtml(resolveImageUrl(creature.image))}" alt="${escapeHtml(creature.name || "Creatura")}" style="${buildImageStyle(creature.imageAdjust)}">
                            </button>
                        </aside>
                        <section class="bestiary-detail-info-panel">
                            <div class="bestiary-detail-form">
                                ${renderInput("Nome", "name", creature.name || "")}
                                ${renderInput("Categoria", "category", creature.category || "")}
                                ${renderSelect("Rango", "rank", creature.rank || "", [
                                    ["", "Normale"],
                                    ["mini_boss", "Creatura maggiore"],
                                    ["unique_monster", "Creatura unica"],
                                    ["special", "Speciale"]
                                ])}
                                ${renderSelect("Tipo D&D", "details.dndType", details.dndType || "", DND_TYPE_OPTIONS.map((type) => [type, type]))}
                                ${renderInput("Altezza", "details.height", details.height || "")}
                                ${renderInput("Peso", "details.weight", details.weight || "")}
                                ${renderInput("Nome misterioso", "mysteryName", creature.mysteryName || "")}
                                ${renderArea("Descrizione", "details.description", details.description || "")}
                                <div class="bestiary-editor-status">
                                    <label class="bestiary-detail-check">
                                        <input type="checkbox" data-field="hidden" ${creature.hidden === true ? "checked" : ""}>
                                        <span>Nascosta</span>
                                    </label>
                                    <label class="bestiary-detail-check">
                                        <input type="checkbox" data-field="discovered" ${creature.discovered !== false ? "checked" : ""}>
                                        <span>Scoperta</span>
                                    </label>
                                </div>
                                <details class="monster-builder-advanced bestiary-editor-advanced bestiary-detail-field--wide">
                                    <summary>Dati wiki avanzati</summary>
                                    <div class="bestiary-detail-form">
                                        ${renderArea("Descrizione misteriosa", "mysteryDescription", creature.mysteryDescription || "")}
                                        ${renderArea("Foundry names, uno per riga", "foundryName", listToText(creature.foundryName))}
                                        ${renderArea("Tratti JSON", "details.traits", JSON.stringify(Array.isArray(details.traits) ? details.traits : [], null, 2))}
                                        ${renderArea("Drop JSON", "details.drops", JSON.stringify(Array.isArray(details.drops) ? details.drops : [], null, 2))}
                                    </div>
                                </details>
                            </div>
                        </section>
                    </div>
                </article>
                ${renderMonsterBuilder(creature, foundry)}
            </div>
        `;
    }

    function bindRenderedEvents() {
        root.querySelectorAll("[data-field]").forEach((field) => {
            const eventName = field.type === "checkbox" || field.tagName === "SELECT" ? "change" : "input";
            field.addEventListener(eventName, () => updateField(field));
        });
        root.querySelector('[data-ability-search]')?.addEventListener("input", (event) => {
            state.abilitySearch = event.currentTarget.value || "";
            render();
        });
        root.querySelector('[data-action="cancel"]')?.addEventListener("click", cancelEdit);
        root.querySelector('[data-action="save"]')?.addEventListener("click", saveEdit);
        root.querySelector('[data-action="upload-image"]')?.addEventListener("click", uploadImage);
        root.querySelector('[data-action="download-foundry"]')?.addEventListener("click", downloadFoundryActor);
        root.querySelector('[data-action="add-custom-ability"]')?.addEventListener("click", addCustomAbilityTemplate);
        root.querySelector('[data-action="add-empty-ability"]')?.addEventListener("click", addEmptyMonsterAbility);
        root.querySelectorAll('[data-action="add-ability-kind"]').forEach((button) => {
            button.addEventListener("click", () => addMonsterAbilityKind(button.dataset.abilityKind || "attack"));
        });
        root.querySelector('[data-action="calculate-hp"]')?.addEventListener("click", calculateAverageHp);
        root.querySelector('[data-action="apply-monster-suggestions"]')?.addEventListener("click", applyMonsterSuggestions);
        root.querySelectorAll("[data-ability-filter]").forEach((button) => {
            button.addEventListener("click", () => {
                state.abilityFilter = button.dataset.abilityFilter || "all";
                render();
            });
        });
        root.querySelectorAll('[data-action="add-template-ability"]').forEach((button) => {
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                addTemplateAbility(Number(button.dataset.abilityTemplateIndex));
            });
        });
        root.querySelectorAll("[data-choice-field]").forEach((button) => {
            button.addEventListener("click", () => {
                const path = button.dataset.choiceField;
                const value = button.dataset.choiceValue || "";
                if (!path) return;
                state.dirty = true;
                if (path.startsWith("foundry.")) updateFoundryField(path, value);
                else setPath(state.creature, path, value);
                render();
            });
        });
        root.querySelectorAll("[data-sense-range]").forEach((field) => {
            field.addEventListener("input", updateSensesFromControls);
        });
        root.querySelectorAll("[data-defense-kind]").forEach((field) => {
            field.addEventListener("change", (event) => updateDefensesFromControls(event));
        });
        root.querySelectorAll("[data-score-action]").forEach((button) => {
            button.addEventListener("click", () => {
                const ability = button.dataset.scoreAbility;
                const action = button.dataset.scoreAction;
                const path = `foundry.abilities.${ability}.value`;
                const input = [...root.querySelectorAll("[data-field]")].find((node) => node.dataset.field === path);
                const current = Number(input?.value || 10);
                const next = Math.max(1, Math.min(30, current + (action === "inc" ? 1 : -1)));
                updateFoundryField(path, next);
                state.dirty = true;
                render();
            });
        });
        root.querySelectorAll("[data-skill-key]").forEach((button) => {
            button.addEventListener("click", () => cycleSkillProficiency(button.dataset.skillKey));
        });
        root.querySelectorAll("[data-ability-template-index]").forEach((card) => {
            card.addEventListener("dragstart", (event) => {
                event.dataTransfer?.setData("text/plain", card.dataset.abilityTemplateIndex || "");
                event.dataTransfer?.setData("application/x-cripta-ability-template", card.dataset.abilityTemplateIndex || "");
            });
            card.addEventListener("dblclick", () => addTemplateAbility(Number(card.dataset.abilityTemplateIndex)));
        });
        const abilityDrop = root.querySelector("[data-ability-dropzone]");
        abilityDrop?.addEventListener("dragover", (event) => {
            event.preventDefault();
            abilityDrop.classList.add("is-drag-over");
        });
        abilityDrop?.addEventListener("dragleave", () => abilityDrop.classList.remove("is-drag-over"));
        abilityDrop?.addEventListener("drop", (event) => {
            event.preventDefault();
            abilityDrop.classList.remove("is-drag-over");
            const rawIndex = event.dataTransfer?.getData("application/x-cripta-ability-template") || event.dataTransfer?.getData("text/plain") || "";
            addTemplateAbility(Number(rawIndex));
        });
        root.querySelectorAll("[data-ability-field]").forEach((field) => {
            field.addEventListener("input", () => updateMonsterAbilityField(field));
            field.addEventListener("change", () => updateMonsterAbilityField(field));
        });
        root.querySelectorAll("[data-ability-choice-field]").forEach((button) => {
            button.addEventListener("click", () => updateMonsterAbilityChoice(button));
        });
        root.querySelectorAll("[data-ability-damage-value]").forEach((button) => {
            button.addEventListener("click", () => toggleMonsterAbilityDamageType(button));
        });
        root.querySelectorAll("[data-ability-damage-part-field]").forEach((field) => {
            field.addEventListener("input", () => updateMonsterAbilityDamagePart(field));
            field.addEventListener("change", () => updateMonsterAbilityDamagePart(field));
        });
        root.querySelectorAll("[data-ability-damage-part-type]").forEach((button) => {
            button.addEventListener("click", () => updateMonsterAbilityDamagePartType(button));
        });
        root.querySelectorAll("[data-ability-action]").forEach((button) => {
            button.addEventListener("click", () => handleMonsterAbilityAction(button));
        });
        root.querySelectorAll("[data-ability-edit]").forEach((button) => {
            button.addEventListener("click", () => {
                state.activeAbilityIndex = Number(button.dataset.abilityEdit);
                render();
            });
        });
        root.querySelectorAll(".monster-ability-editor > header").forEach((header) => {
            header.addEventListener("click", (event) => {
                if (event.target.closest("button")) return;
                state.activeAbilityIndex = Number(header.closest("[data-ability-index]")?.dataset.abilityIndex || 0);
                render();
            });
        });
    }

    function updateField(field) {
        const path = field.dataset.field;
        if (!path || !state.creature) return;
        state.dirty = true;
        if (field.type === "checkbox") {
            if (path === "hidden") state.creature.hidden = field.checked;
            if (path === "discovered") state.creature.discovered = field.checked;
            return;
        }

        const value = field.value;
        if (path === "foundryName") {
            state.creature.foundryName = textToList(value);
        } else if (path.startsWith("foundry.")) {
            updateFoundryField(path, value);
            if (path === "foundry.hp.formula") {
                const hpInput = root.querySelector('[data-field="foundry.hp.value"]');
                const hpValue = ensureFoundryMonsterData(state.creature).hp?.value;
                if (hpInput && hpValue !== undefined) hpInput.value = hpValue;
            }
        } else if (path === "details.traits" || path === "details.drops") {
            setPath(state.creature, path, parseJsonArray(value, path));
        } else if (path === "details.resistances" || path === "details.immunities" || path === "details.vulnerabilities") {
            setPath(state.creature, path, textToList(value));
        } else {
            setPath(state.creature, path, value);
        }

        if (path === "name" && nameEl) nameEl.textContent = value || "Creatura";
    }

    function renderMonsterBuilder(creature, foundry) {
        const abilities = getMonsterAbilities(creature);
        const validation = validateFoundryMonster(creature);
        const suggestions = buildMonsterSuggestions(foundry);
        const filteredTemplates = getFilteredAbilityTemplates();
        return `
            <section class="monster-builder monster-builder--fullscreen">
                <div class="monster-foundry-overview">
                <div class="monster-builder-main">
                    <section class="bestiary-detail-section monster-builder-panel monster-builder-panel--compact">
                        <div class="monster-builder-section-title">
                            <h2>Mostro Foundry</h2>
                        </div>
                        <div class="monster-builder-quick-grid">
                            ${renderCompactInput("Classe Armatura", "foundry.ac", foundry.ac ?? "")}
                            ${renderCompactInput("Punti Ferita", "foundry.hp.value", foundry.hp?.value ?? "")}
                            ${renderCompactInput("Formula PF", "foundry.hp.formula", foundry.hp?.formula ?? "")}
                            ${renderCompactInput("Grado Sfida", "foundry.cr", foundry.cr ?? "")}
                            ${renderCompactInput("Bonus Competenza", "foundry.prof", foundry.prof ?? "")}
                            ${renderSelect("Taglia", "foundry.size", foundry.size || "med", FOUNDRY_SIZE_OPTIONS)}
                        </div>
                        ${renderMovementAndSensesPanel(foundry)}
                        <div class="monster-foundry-body">
                            <div class="monster-foundry-defense">
                                ${renderDefensePicker(creature.details || {})}
                            </div>
                            <div class="monster-foundry-tuning">
                                <div class="monster-score-panel">
                                    <div class="monster-subsection-title">Caratteristiche</div>
                                    <div class="monster-builder-abilities-grid">
                                        ${["str", "dex", "con", "int", "wis", "cha"].map((ability) => renderAbilityScoreStepper(ability, foundry.abilities?.[ability]?.value ?? 10)).join("")}
                                    </div>
                                </div>
                                ${renderSkillProficiencyPanel(foundry.skills || {})}
                            </div>
                        </div>
                        <details class="monster-builder-advanced">
                            <summary>Statistiche avanzate</summary>
                            <div class="bestiary-detail-form monster-builder-stats">
                                ${renderMonsterSuggestionPanel(foundry, suggestions)}
                                ${renderArea("Linguaggi", "foundry.languages", foundry.languages || "")}
                                ${renderArea("Skill Foundry JSON", "foundry.skills", JSON.stringify(foundry.skills || {}, null, 2))}
                                ${renderArea("Flags Actor JSON avanzati", "foundry.flags", JSON.stringify(foundry.flags || {}, null, 2))}
                            </div>
                        </details>
                    </section>

                    ${renderFoundryValidation(validation)}
                </div>
                </div>

                <div class="monster-ability-workspace">

                    <section class="bestiary-detail-section monster-builder-panel">
                        <div class="monster-builder-section-title">
                            <h2>Abilità del mostro</h2>
                            <div class="monster-quick-add">
                                <button class="bestiary-detail-action" type="button" data-action="add-ability-kind" data-ability-kind="attack">Attacco</button>
                                <button class="bestiary-detail-action" type="button" data-action="add-ability-kind" data-ability-kind="save">TS</button>
                                <button class="bestiary-detail-action" type="button" data-action="add-ability-kind" data-ability-kind="aura">Aura</button>
                                <button class="bestiary-detail-action" type="button" data-action="add-ability-kind" data-ability-kind="passive">Passiva</button>
                                <button class="bestiary-detail-action" type="button" data-action="add-ability-kind" data-ability-kind="reaction">Reazione</button>
                                <button class="bestiary-detail-action" type="button" data-action="add-ability-kind" data-ability-kind="legendary">Leggendaria</button>
                            </div>
                        </div>
                        <div class="monster-ability-dropzone" data-ability-dropzone>
                            ${abilities.length ? abilities.map(renderGuidedMonsterAbilityEditor).join("") : `
                                <p class="monster-builder-empty">Trascina qui un'abilità dalla libreria a destra.</p>
                            `}
                        </div>
                    </section>

                <aside class="monster-builder-library">
                    <section class="bestiary-detail-section monster-builder-panel">
                        <div class="monster-builder-section-title">
                            <h2>Libreria abilità</h2>
                            <button class="bestiary-detail-action" type="button" data-action="add-custom-ability">
                                <i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i>
                                <span>Nuova</span>
                            </button>
                        </div>
                        <div class="monster-ability-library">
                            <label class="monster-library-search">
                                <span>Cerca abilita</span>
                                <input class="bestiary-detail-input" data-ability-search value="${escapeHtml(state.abilitySearch || "")}" placeholder="Nome, tipo, effetto...">
                            </label>
                            ${renderAbilityFilterTabs()}
                            ${filteredTemplates.length
                                ? filteredTemplates.map(({ template, index }) => renderAbilityTemplateCard(template, index)).join("")
                                : `<p class="monster-builder-empty">Nessuna abilitÃ  in questo filtro.</p>`}
                        </div>
                    </section>
                </aside>
                </div>
            </section>
        `;
    }

    function renderAbilityTemplateCard(template, index) {
        const iconImage = template.iconImage || template.img || "";
        return `
            <article class="monster-ability-template" draggable="true" data-ability-template-index="${index}">
                ${iconImage
                    ? `<img class="monster-ability-template-icon" src="${escapeHtml(resolveImageUrl(iconImage))}" alt="">`
                    : `<i class="fas ${escapeHtml(template.icon || "fa-burst")}" aria-hidden="true"></i>`}
                <div>
                    <strong>${escapeHtml(template.name || "Abilità")}</strong>
                    <span>${escapeHtml([template.type || "feat", template.activation || ""].filter(Boolean).join(" | "))}</span>
                </div>
                <button class="monster-ability-add-btn" type="button" data-action="add-template-ability" data-ability-template-index="${index}" title="Aggiungi">
                    <i class="fas fa-plus" aria-hidden="true"></i>
                </button>
            </article>
        `;
    }

    function renderAbilityFilterTabs() {
        return `
            <div class="monster-ability-filters" role="tablist" aria-label="Filtri abilita">
                ${ABILITY_FILTERS.map(([value, label]) => `
                    <button class="monster-ability-filter ${state.abilityFilter === value ? "is-active" : ""}" type="button" data-ability-filter="${escapeHtml(value)}">
                        ${escapeHtml(label)}
                    </button>
                `).join("")}
            </div>
        `;
    }

    function getFilteredAbilityTemplates() {
        const query = normalizeSearchKey(state.abilitySearch || "");
        return state.abilityTemplates
            .map((template, index) => ({ template, index }))
            .filter(({ template }) => state.abilityFilter === "all" || getAbilityCategory(template) === state.abilityFilter)
            .filter(({ template }) => {
                if (!query) return true;
                return normalizeSearchKey(`${template.name || ""} ${template.section || ""} ${template.activation || ""} ${template.description || ""}`).includes(query);
            });
    }

    function getAbilityCategory(ability) {
        const explicit = String(ability.category || ability.group || "").trim().toLowerCase();
        if (ABILITY_FILTERS.some(([value]) => value === explicit)) return explicit;
        const haystack = `${ability.name || ""} ${ability.section || ""} ${ability.activation || ""} ${ability.description || ""}`.toLowerCase();
        const kind = ability.kind || inferAbilityKind(ability);
        if (kind === "attack") return "attack";
        if (kind === "reaction" || haystack.includes("parata") || haystack.includes("resistenza")) return "defense";
        if (haystack.includes("teletras") || haystack.includes("movimento") || haystack.includes("volo")) return "mobility";
        if (kind === "save" || haystack.includes("restrained") || haystack.includes("prono") || haystack.includes("paura")) return "control";
        if (ability.type === "spell" || haystack.includes("magia") || haystack.includes("incantes")) return "magic";
        if (kind === "legendary" || haystack.includes("leggend")) return "boss";
        return "attack";
    }

    function renderGuidedMonsterAbilityEditor(ability, index) {
        const kind = ability.kind || inferAbilityKind(ability);
        const collapsed = state.activeAbilityIndex !== index;
        const summary = `${labelForAbilityKind(kind)}${ability.damageFormula ? ` | ${ability.damageFormula}` : ""}${ability.saveDc ? ` | CD ${ability.saveDc}` : ""}`;
        return `
            <article class="monster-ability-editor ${collapsed ? "is-collapsed" : "is-active"}" data-ability-index="${index}">
                <header data-summary="${escapeHtml(summary)}">
                    ${renderAbilityIconUploadButton(ability, index)}
                    <strong>${escapeHtml(ability.name || "AbilitÃ ")}</strong>
                    <div>
                        <button class="monster-ability-icon-btn" type="button" data-ability-action="move-up" data-ability-index="${index}" title="Sposta su"><i class="fas fa-arrow-up"></i></button>
                        <button class="monster-ability-icon-btn" type="button" data-ability-action="move-down" data-ability-index="${index}" title="Sposta giÃ¹"><i class="fas fa-arrow-down"></i></button>
                        <button class="monster-ability-icon-btn monster-ability-icon-btn--danger" type="button" data-ability-action="delete" data-ability-index="${index}" title="Elimina"><i class="fas fa-trash"></i></button>
                    </div>
                </header>
                <div class="bestiary-detail-form monster-ability-body">
                    ${renderAbilityInput(index, "Nome", "name", ability.name || "")}
                    ${renderAbilitySelect(index, "Metodo", "kind", kind, ABILITY_KIND_OPTIONS)}
                    ${renderGuidedAbilityFields(ability, index, kind)}
                    ${renderAbilityArea(index, "Descrizione", "description", ability.description || "")}
                    <details class="monster-builder-advanced monster-builder-advanced--ability bestiary-detail-field--wide">
                        <summary>Avanzato Foundry</summary>
                        <div class="bestiary-detail-form monster-ability-details">
                            ${renderAbilityInput(index, "Icona FontAwesome fallback", "icon", ability.icon || "")}
                            ${renderAbilitySelect(index, "Tipo item", "type", ability.type || "feat", [["feat", "Feature"], ["weapon", "Weapon"], ["spell", "Spell"]])}
                            ${renderAbilityArea(index, "Flags/DAE/MIDI JSON", "flagsJson", JSON.stringify(ability.flags || {}, null, 2))}
                        </div>
                    </details>
                </div>
            </article>
        `;
    }

    function renderGuidedAbilityFields(ability, index, kind) {
        const activation = ability.activation || activationFromAbilityKind(kind);
        const section = ability.section || sectionFromAbilityKind(kind);
        if (kind === "attack") {
            applyAttackAbilityDefaults(ability);
            return [
                renderAbilityInput(index, "Raggio", "range", ability.range || ""),
                renderAttackBonusPicker(ability, index),
                renderDamagePartsEditor(ability, index)
            ].join("");
        }
        if (kind === "save") {
            return [
                renderAbilitySelect(index, "Mostra in", "section", section, SECTION_OPTIONS),
                renderAbilityInput(index, "Attivazione", "activation", activation),
                renderAbilityInput(index, "Raggio/Area", "range", ability.range || ""),
                renderAbilityInput(index, "Target", "target", ability.target || ""),
                renderAbilitySelect(index, "Tiro salvezza", "saveAbility", ability.saveAbility || "", SAVE_ABILITY_OPTIONS),
                renderAbilityInput(index, "CD TS", "saveDc", ability.saveDc || ""),
                renderAbilityInput(index, "Danno/effetto", "damageFormula", ability.damageFormula || ""),
                renderDamageTypePicker(ability, index)
            ].join("");
        }
        if (kind === "aura") {
            return [
                renderAbilitySelect(index, "Mostra in", "section", section, [["trait", "Tratto"], ["action", "Azione"]]),
                renderAbilityInput(index, "Raggio aura", "range", ability.range || ""),
                renderAbilityInput(index, "Target", "target", ability.target || "creature nell'aura"),
                renderAbilitySelect(index, "TS se serve", "saveAbility", ability.saveAbility || "", SAVE_ABILITY_OPTIONS),
                renderAbilityInput(index, "CD TS", "saveDc", ability.saveDc || ""),
                renderAbilityInput(index, "Danno/effetto", "damageFormula", ability.damageFormula || "")
            ].join("");
        }
        if (kind === "reaction") {
            return [
                renderAbilityInput(index, "Trigger/raggio", "range", ability.range || ""),
                renderAttackBonusPicker(ability, index),
                renderAbilityInput(index, "Danno", "damageFormula", ability.damageFormula || "")
            ].join("");
        }
        if (kind === "legendary") {
            return [
                renderAbilityInput(index, "Costo/attivazione", "activation", ability.activation || "legendary"),
                renderAbilityInput(index, "Raggio", "range", ability.range || ""),
                renderAbilityInput(index, "Danno/effetto", "damageFormula", ability.damageFormula || "")
            ].join("");
        }
        return renderAbilitySelect(index, "Mostra in", "section", section, SECTION_OPTIONS);
    }

    function renderAttackBonusPicker(ability, index) {
        const attackAbility = ability.attackAbility || "str";
        const total = calculateAbilityAttackBonus(ability);
        return `
            <div class="bestiary-detail-field bestiary-detail-field--wide monster-ability-control-panel">
                <span>Bonus attacco</span>
                <div class="monster-ability-choice-row" role="group" aria-label="Caratteristica attacco">
                    ${ATTACK_ABILITY_OPTIONS.map(([value, label]) => `
                        <button class="monster-choice-btn ${attackAbility === value ? "is-active" : ""}" type="button" data-ability-index="${index}" data-ability-choice-field="attackAbility" data-ability-choice-value="${escapeHtml(value)}">
                            ${escapeHtml(label)}
                        </button>
                    `).join("")}
                </div>
                <div class="monster-attack-bonus-row">
                    ${attackAbility === "custom"
                        ? renderAbilityInput(index, "Bonus manuale", "attackBonus", ability.attackBonus || "")
                        : `
                            <label class="bestiary-detail-field">
                                <span>Bonus extra</span>
                                <input class="bestiary-detail-input" data-ability-index="${index}" data-ability-field="attackBonusExtra" value="${escapeHtml(ability.attackBonusExtra || "")}" placeholder="+0">
                            </label>
                            <output>Totale ${escapeHtml(total)}</output>
                        `}
                </div>
            </div>
        `;
    }

    function renderDamageTypePicker(ability, index) {
        const selected = new Set(parseAbilityDamageTypes(ability));
        return `
            <div class="bestiary-detail-field bestiary-detail-field--wide monster-ability-control-panel">
                <span>Tipo danno</span>
                <div class="monster-damage-type-grid" role="group" aria-label="Tipi di danno">
                    ${ABILITY_DAMAGE_TYPE_OPTIONS.map(([value, label]) => `
                        <button class="monster-choice-btn ${selected.has(value) ? "is-active" : ""}" type="button" data-ability-index="${index}" data-ability-damage-value="${escapeHtml(value)}">
                            ${escapeHtml(label)}
                        </button>
                    `).join("")}
                </div>
            </div>
        `;
    }

    function renderDamagePartsEditor(ability, index) {
        const parts = getAbilityDamageParts(ability);
        return `
            <div class="bestiary-detail-field bestiary-detail-field--wide monster-ability-control-panel monster-damage-parts-panel">
                <span>Danni</span>
                <div class="monster-damage-parts-list">
                    ${parts.map((part, partIndex) => renderDamagePartRow(part, index, partIndex, parts.length)).join("")}
                </div>
                <button class="monster-helper-btn" type="button" data-ability-action="add-damage-part" data-ability-index="${index}">
                    <i class="fas fa-plus" aria-hidden="true"></i>
                    Aggiungi danno
                </button>
            </div>
        `;
    }

    function renderDamagePartRow(part, index, partIndex, totalRows) {
        return `
            <div class="monster-damage-part-row">
                <label class="bestiary-detail-field">
                    <span>Danno</span>
                    <input class="bestiary-detail-input" data-ability-index="${index}" data-damage-part-index="${partIndex}" data-ability-damage-part-field="formula" value="${escapeHtml(part.formula || "")}" placeholder="1d8 + 3">
                </label>
                <div class="monster-damage-type-row">
                    <span>Tipo danno</span>
                    <div class="monster-damage-type-grid monster-damage-type-grid--row" role="group" aria-label="Tipo danno ${partIndex + 1}">
                        ${ABILITY_DAMAGE_TYPE_OPTIONS.map(([value, label]) => `
                            <button class="monster-choice-btn monster-choice-btn--damage ${part.type === value ? "is-active" : ""}" type="button" data-ability-index="${index}" data-damage-part-index="${partIndex}" data-ability-damage-part-type="${escapeHtml(value)}">
                                ${escapeHtml(label)}
                            </button>
                        `).join("")}
                    </div>
                </div>
                ${totalRows > 1 ? `
                    <button class="monster-ability-icon-btn monster-ability-icon-btn--danger monster-damage-remove-btn" type="button" data-ability-action="remove-damage-part" data-ability-index="${index}" data-damage-part-index="${partIndex}" title="Rimuovi danno">
                        <i class="fas fa-trash" aria-hidden="true"></i>
                    </button>
                ` : ""}
            </div>
        `;
    }

    function renderMonsterAbilityEditor(ability, index) {
        return `
            <article class="monster-ability-editor" data-ability-index="${index}">
                <header>
                    ${renderAbilityIconUploadButton(ability, index)}
                    <strong>${escapeHtml(ability.name || "Abilità")}</strong>
                    <div>
                        <button class="monster-ability-icon-btn" type="button" data-ability-action="move-up" data-ability-index="${index}" title="Sposta su"><i class="fas fa-arrow-up"></i></button>
                        <button class="monster-ability-icon-btn" type="button" data-ability-action="move-down" data-ability-index="${index}" title="Sposta giù"><i class="fas fa-arrow-down"></i></button>
                        <button class="monster-ability-icon-btn monster-ability-icon-btn--danger" type="button" data-ability-action="delete" data-ability-index="${index}" title="Elimina"><i class="fas fa-trash"></i></button>
                    </div>
                </header>
                <div class="bestiary-detail-form">
                    ${renderAbilityInput(index, "Nome", "name", ability.name || "")}
                    ${renderAbilityInput(index, "Icona", "icon", ability.icon || "")}
                    ${renderAbilitySelect(index, "Tipo item", "type", ability.type || "feat", [["feat", "Feature"], ["weapon", "Weapon"], ["spell", "Spell"]])}
                    ${renderAbilitySelect(index, "Sezione", "section", ability.section || "action", [["trait", "Tratto"], ["action", "Azione"], ["bonus", "Bonus action"], ["reaction", "Reazione"], ["legendary", "Leggendaria"]])}
                    ${renderAbilityInput(index, "Attivazione", "activation", ability.activation || "action")}
                    ${renderAbilityInput(index, "Raggio", "range", ability.range || "")}
                    ${renderAbilityInput(index, "Target", "target", ability.target || "")}
                    ${renderAbilityInput(index, "Attacco", "attackBonus", ability.attackBonus || "")}
                    ${renderAbilityInput(index, "Danno", "damageFormula", ability.damageFormula || "")}
                    ${renderAbilityInput(index, "Tipo danno", "damageType", ability.damageType || "")}
                    ${renderAbilityInput(index, "TS abilità", "saveAbility", ability.saveAbility || "")}
                    ${renderAbilityInput(index, "CD TS", "saveDc", ability.saveDc || "")}
                    ${renderAbilityArea(index, "Descrizione", "description", ability.description || "")}
                    ${renderAbilityArea(index, "Flags/DAE/MIDI JSON avanzati", "flagsJson", JSON.stringify(ability.flags || {}, null, 2))}
                </div>
            </article>
        `;
    }

    function renderAbilityIconUploadButton(ability, index) {
        const iconImage = ability.iconImage || ability.img || "";
        const fallbackIcon = ability.icon || "fa-burst";
        return `
            <button class="monster-ability-icon-upload" type="button" data-ability-action="upload-icon" data-ability-index="${index}" title="Carica icona abilita">
                ${iconImage
                    ? `<img src="${escapeHtml(resolveImageUrl(iconImage))}" alt="">`
                    : `<i class="fas ${escapeHtml(fallbackIcon)}" aria-hidden="true"></i>`}
            </button>
        `;
    }

    function renderAbilityInput(index, label, field, value) {
        return `
            <label class="bestiary-detail-field">
                <span>${escapeHtml(label)}</span>
                <input class="bestiary-detail-input" data-ability-index="${index}" data-ability-field="${escapeHtml(field)}" value="${escapeHtml(value)}">
            </label>
        `;
    }

    function renderAbilityArea(index, label, field, value) {
        return `
            <label class="bestiary-detail-field bestiary-detail-field--wide">
                <span>${escapeHtml(label)}</span>
                <textarea class="bestiary-detail-area" data-ability-index="${index}" data-ability-field="${escapeHtml(field)}" spellcheck="false">${escapeHtml(value)}</textarea>
            </label>
        `;
    }

    function renderAbilitySelect(index, label, field, value, options) {
        return `
            <label class="bestiary-detail-field">
                <span>${escapeHtml(label)}</span>
                <select class="bestiary-detail-select" data-ability-index="${index}" data-ability-field="${escapeHtml(field)}">
                    ${options.map(([optionValue, optionLabel]) => `
                        <option value="${escapeHtml(optionValue)}"${optionValue === value ? " selected" : ""}>${escapeHtml(optionLabel)}</option>
                    `).join("")}
                </select>
            </label>
        `;
    }

    function updateFoundryField(path, value) {
        const foundry = ensureFoundryMonsterData(state.creature);
        const field = path.replace(/^foundry\./, "");
        if (field === "skills" || field === "flags") {
            setPath(foundry, field, safeParseObject(value));
            return;
        }
        if (field === "size") {
            setPath(foundry, field, value);
            setPath(state.creature, "details.size", foundrySizeToWikiSize(value));
            return;
        }
        const numericFields = new Set(["hp.value", "movement.walk", "movement.fly", "movement.swim", "movement.climb"]);
        if (/^abilities\.[a-z]{3}\.value$/.test(field) || numericFields.has(field)) {
            const number = Number(value);
            setPath(foundry, field, Number.isFinite(number) ? number : value);
            return;
        }
        if (field === "hp.formula") {
            setPath(foundry, field, value);
            const average = calculateDndAverageHp(value, foundry.abilities?.con?.value || 10, foundry.size);
            if (Number.isFinite(average) && average > 0) foundry.hp.value = average;
            return;
        }
        setPath(foundry, field, value);
    }

    function updateMonsterAbilityField(field) {
        const index = Number(field.dataset.abilityIndex);
        const key = field.dataset.abilityField;
        const abilities = getMonsterAbilities(state.creature);
        const ability = abilities[index];
        if (!ability || !key) return;
        if (key === "flagsJson") {
            ability.flags = safeParseObject(field.value);
        } else {
            ability[key] = field.value;
        }
        if (key === "kind") {
            ability.section = sectionFromAbilityKind(field.value);
            ability.activation = activationFromAbilityKind(field.value);
            applyAbilityDefaultsForKind(ability);
        }
        if (key === "attackBonusExtra") {
            syncAttackBonus(ability);
            const output = field.closest(".monster-attack-bonus-row")?.querySelector("output");
            if (output) output.textContent = `Totale ${ability.attackBonus || ""}`;
        }
        state.dirty = true;
        if (key === "kind") render();
    }

    function updateMonsterAbilityChoice(button) {
        const index = Number(button.dataset.abilityIndex);
        const key = button.dataset.abilityChoiceField;
        const value = button.dataset.abilityChoiceValue || "";
        const ability = getMonsterAbilities(state.creature)[index];
        if (!ability || !key) return;
        ability[key] = value;
        if (key === "attackAbility") syncAttackBonus(ability);
        state.dirty = true;
        render();
    }

    function toggleMonsterAbilityDamageType(button) {
        const index = Number(button.dataset.abilityIndex);
        const value = button.dataset.abilityDamageValue || "";
        const ability = getMonsterAbilities(state.creature)[index];
        if (!ability || !value) return;
        const current = new Set(parseAbilityDamageTypes(ability));
        if (current.has(value)) current.delete(value);
        else current.add(value);
        ability.damageTypes = Array.from(current);
        ability.damageType = ability.damageTypes[0] || "";
        state.dirty = true;
        render();
    }

    function updateMonsterAbilityDamagePart(field) {
        const index = Number(field.dataset.abilityIndex);
        const partIndex = Number(field.dataset.damagePartIndex);
        const ability = getMonsterAbilities(state.creature)[index];
        if (!ability || !Number.isInteger(partIndex)) return;
        const parts = getAbilityDamageParts(ability);
        parts[partIndex] = {
            ...(parts[partIndex] || {}),
            formula: field.value
        };
        setAbilityDamageParts(ability, parts);
        state.dirty = true;
    }

    function updateMonsterAbilityDamagePartType(button) {
        const index = Number(button.dataset.abilityIndex);
        const partIndex = Number(button.dataset.damagePartIndex);
        const type = button.dataset.abilityDamagePartType || "";
        const ability = getMonsterAbilities(state.creature)[index];
        if (!ability || !Number.isInteger(partIndex) || !type) return;
        const parts = getAbilityDamageParts(ability);
        parts[partIndex] = {
            ...(parts[partIndex] || {}),
            type
        };
        setAbilityDamageParts(ability, parts);
        state.dirty = true;
        render();
    }

    function handleMonsterAbilityAction(button) {
        const index = Number(button.dataset.abilityIndex);
        const action = button.dataset.abilityAction;
        const abilities = getMonsterAbilities(state.creature);
        if (!Number.isInteger(index) || !abilities[index]) return;
        if (action === "upload-icon") {
            uploadAbilityIcon(index);
            return;
        }
        if (action === "add-damage-part") {
            const parts = getAbilityDamageParts(abilities[index]);
            parts.push({ formula: "", type: "" });
            setAbilityDamageParts(abilities[index], parts);
            state.dirty = true;
            render();
            return;
        }
        if (action === "remove-damage-part") {
            const partIndex = Number(button.dataset.damagePartIndex);
            const parts = getAbilityDamageParts(abilities[index]);
            if (Number.isInteger(partIndex) && parts.length > 1) {
                parts.splice(partIndex, 1);
                setAbilityDamageParts(abilities[index], parts);
                state.dirty = true;
                render();
            }
            return;
        }
        if (action === "delete") {
            if (!window.confirm("Eliminare questa abilità dal mostro?")) return;
            abilities.splice(index, 1);
            state.activeAbilityIndex = Math.max(0, Math.min(index, abilities.length - 1));
        } else if (action === "move-up" && index > 0) {
            [abilities[index - 1], abilities[index]] = [abilities[index], abilities[index - 1]];
            state.activeAbilityIndex = index - 1;
        } else if (action === "move-down" && index < abilities.length - 1) {
            [abilities[index + 1], abilities[index]] = [abilities[index], abilities[index + 1]];
            state.activeAbilityIndex = index + 1;
        }
        state.dirty = true;
        render();
    }

    function addTemplateAbility(index) {
        const template = state.abilityTemplates[index];
        if (!template) return;
        const abilities = getMonsterAbilities(state.creature);
        const ability = createMonsterAbilityFromTemplate(template);
        applyAbilityDefaultsForKind(ability);
        abilities.push(ability);
        state.activeAbilityIndex = abilities.length - 1;
        state.dirty = true;
        render();
    }

    function addEmptyMonsterAbility() {
        const abilities = getMonsterAbilities(state.creature);
        const ability = createMonsterAbilityFromTemplate({
            name: "Nuova abilità",
            icon: "fa-burst",
            section: "action",
            activation: "action",
            description: ""
        });
        applyAbilityDefaultsForKind(ability);
        abilities.push(ability);
        state.activeAbilityIndex = abilities.length - 1;
        state.dirty = true;
        render();
    }

    function addMonsterAbilityKind(kind) {
        const labels = { attack: "Nuovo attacco", save: "Nuovo effetto con TS", aura: "Nuova aura", passive: "Nuova passiva", reaction: "Nuova reazione", legendary: "Nuova leggendaria" };
        const abilities = getMonsterAbilities(state.creature);
        const ability = createMonsterAbilityFromTemplate({
            name: labels[kind] || "Nuova abilitÃ ",
            kind,
            icon: kind === "attack" ? "fa-hand-fist" : kind === "save" ? "fa-dice-d20" : "fa-burst",
            section: sectionFromAbilityKind(kind),
            activation: activationFromAbilityKind(kind),
            description: ""
        });
        applyAbilityDefaultsForKind(ability);
        abilities.push(ability);
        state.activeAbilityIndex = abilities.length - 1;
        state.dirty = true;
        render();
    }

    function addCustomAbilityTemplate() {
        const name = window.prompt("Nome della nuova abilità riutilizzabile:");
        if (!name) return;
        const template = createMonsterAbilityFromTemplate({ name, icon: "fa-burst", section: "action", activation: "action" });
        state.abilityTemplates.push(template);
        const abilities = getMonsterAbilities(state.creature);
        const ability = createMonsterAbilityFromTemplate(template);
        applyAbilityDefaultsForKind(ability);
        abilities.push(ability);
        state.activeAbilityIndex = abilities.length - 1;
        saveMonsterAbilityTemplates().catch((error) => console.warn("Salvataggio libreria abilità fallito:", error));
        state.dirty = true;
        render();
    }

    function applyAbilityDefaultsForKind(ability) {
        const kind = ability.kind || inferAbilityKind(ability);
        if (kind === "attack") applyAttackAbilityDefaults(ability);
    }

    function applyAttackAbilityDefaults(ability) {
        ability.kind = "attack";
        ability.section = "action";
        ability.activation = "action";
        ability.type = ability.type || "feat";
        if (!String(ability.range || "").trim()) ability.range = defaultAttackRange();
        if (!ability.attackAbility) ability.attackAbility = "str";
        syncAttackBonus(ability);
        const damageTypes = parseAbilityDamageTypes(ability);
        if (damageTypes.length) {
            ability.damageTypes = damageTypes;
            ability.damageType = damageTypes[0];
        }
        setAbilityDamageParts(ability, getAbilityDamageParts(ability));
    }

    function defaultAttackRange() {
        const size = ensureFoundryMonsterData(state.creature).size || mapWikiSizeToFoundry(state.creature?.details?.size);
        return size === "huge" || size === "grg" ? "10" : "5";
    }

    function syncAttackBonus(ability) {
        if (!ability || (ability.attackAbility || "str") === "custom") return;
        ability.attackBonus = calculateAbilityAttackBonus(ability);
    }

    function calculateAbilityAttackBonus(ability) {
        const attackAbility = ability.attackAbility || "str";
        if (attackAbility === "custom") return ability.attackBonus || "";
        const foundry = ensureFoundryMonsterData(state.creature);
        const score = Number(foundry.abilities?.[attackAbility]?.value || 10);
        const modifier = Math.floor((score - 10) / 2);
        const proficiency = Number(foundry.prof || buildMonsterSuggestions(foundry).prof || 0);
        const extra = Number(String(ability.attackBonusExtra || "").replace("+", "").trim() || 0);
        return formatSignedBonus(modifier + proficiency + (Number.isFinite(extra) ? extra : 0));
    }

    function getAbilityDamageParts(ability) {
        const saved = Array.isArray(ability?.damageParts) ? ability.damageParts : [];
        const normalized = saved.map((part) => ({
            formula: String(part?.formula || part?.damage || "").trim(),
            type: damageTypeValueFromLabel(part?.type || part?.damageType || "")
        }));
        if (saved.length) return normalized.length ? normalized : [{ formula: "", type: "" }];
        const legacyTypes = parseAbilityDamageTypes(ability);
        if (ability?.damageFormula || legacyTypes.length) {
            return [{ formula: ability.damageFormula || "", type: legacyTypes[0] || "" }];
        }
        return [{ formula: "", type: "" }];
    }

    function setAbilityDamageParts(ability, parts) {
        const normalized = (Array.isArray(parts) ? parts : [])
            .map((part) => ({
                formula: String(part?.formula || "").trim(),
                type: damageTypeValueFromLabel(part?.type || "")
            }));
        ability.damageParts = normalized.length ? normalized : [{ formula: "", type: "" }];
        ability.damageFormula = ability.damageParts[0]?.formula || "";
        ability.damageType = ability.damageParts[0]?.type || "";
        ability.damageTypes = ability.damageParts.map((part) => part.type).filter(Boolean);
    }

    function calculateAverageHp() {
        const foundry = ensureFoundryMonsterData(state.creature);
        const formula = String(foundry.hp?.formula || "").trim();
        const con = Number(foundry.abilities?.con?.value || 10);
        const size = foundry.size || mapWikiSizeToFoundry(state.creature?.details?.size);
        const average = calculateDndAverageHp(formula, con, size);
        if (!Number.isFinite(average) || average <= 0) {
            alert("Formula PF non riconosciuta. Usa un formato tipo 8d10 + 24 oppure 8d10.");
            return;
        }
        foundry.hp.value = average;
        state.dirty = true;
        render();
    }

    function updateSensesFromControls() {
        const values = [];
        root.querySelectorAll("[data-sense-range]").forEach((rangeInput) => {
            const key = rangeInput.dataset.senseRange;
            const label = SENSE_OPTIONS.find((sense) => sense.value === key)?.label || key;
            const range = String(rangeInput?.value || "").trim();
            if (range) values.push(`${label} ${range}`);
        });
        ensureFoundryMonsterData(state.creature).senses = values.join(", ");
        state.dirty = true;
    }

    function updateDefensesFromControls(event) {
        const changed = event?.currentTarget;
        if (changed?.checked) {
            const value = changed.dataset.defenseValue || changed.value;
            root.querySelectorAll("[data-defense-value]").forEach((field) => {
                if (field !== changed && field.dataset.defenseValue === value) field.checked = false;
            });
        }
        const details = state.creature.details || (state.creature.details = {});
        ["resistances", "immunities", "vulnerabilities"].forEach((kind) => {
            details[kind] = Array.from(root.querySelectorAll(`[data-defense-kind="${kind}"]:checked`))
                .map((field) => field.value)
                .filter(Boolean);
        });
        state.dirty = true;
    }

    function cycleSkillProficiency(skillKey) {
        if (!skillKey) return;
        const foundry = ensureFoundryMonsterData(state.creature);
        const skill = SKILL_OPTIONS.find((entry) => entry.key === skillKey);
        if (!skill) return;
        const current = Number(foundry.skills?.[skillKey]?.value || 0);
        const next = current >= 2 ? 0 : current + 1;
        foundry.skills ??= {};
        if (next === 0) {
            delete foundry.skills[skillKey];
        } else {
            foundry.skills[skillKey] = {
                ...(typeof foundry.skills[skillKey] === "object" ? foundry.skills[skillKey] : {}),
                value: next,
                ability: skill.ability,
                bonuses: {
                    check: foundry.skills[skillKey]?.bonuses?.check || "",
                    passive: foundry.skills[skillKey]?.bonuses?.passive || ""
                }
            };
        }
        state.dirty = true;
        render();
    }

    function applyMonsterSuggestions() {
        const foundry = ensureFoundryMonsterData(state.creature);
        const suggestions = buildMonsterSuggestions(foundry);
        foundry.ac = foundry.ac || suggestions.ac;
        foundry.hp.value = foundry.hp.value || suggestions.hp;
        foundry.hp.formula = foundry.hp.formula || suggestions.hpFormula;
        foundry.prof = foundry.prof || suggestions.prof;
        getMonsterAbilities(state.creature).forEach((ability) => {
            const kind = ability.kind || inferAbilityKind(ability);
            if (kind === "attack" && !ability.attackBonus) ability.attackBonus = String(suggestions.attackBonus);
            if (kind === "attack" && !getAbilityDamageParts(ability).some((part) => part.formula)) {
                setAbilityDamageParts(ability, [{ formula: suggestions.damage, type: getPrimaryAbilityDamageType(ability) }]);
            }
            if (kind === "save" && !ability.damageFormula) ability.damageFormula = suggestions.damage;
            if ((kind === "save" || kind === "aura") && !ability.saveDc) ability.saveDc = String(suggestions.saveDc);
        });
        state.dirty = true;
        render();
    }

    function renderFoundryValidation(validation) {
        const statusClass = validation.errors.length ? "is-error" : validation.warnings.length ? "is-warning" : "is-ok";
        const items = [
            ...validation.errors.map((message) => ["Errore", message]),
            ...validation.warnings.map((message) => ["Warning", message])
        ];
        return `
            <section class="monster-validation ${statusClass}">
                <div>
                    <strong>Pronto per Foundry</strong>
                    <span>${validation.errors.length ? "Correggi gli errori prima dell'export." : validation.warnings.length ? "Esportabile, ma con dati da controllare." : "Nessun problema evidente."}</span>
                </div>
                ${items.length ? `
                    <ul>
                        ${items.map(([type, message]) => `<li><b>${escapeHtml(type)}:</b> ${escapeHtml(message)}</li>`).join("")}
                    </ul>
                ` : ""}
            </section>
        `;
    }

    async function saveMonsterAbilityTemplates() {
        const token = readAuthToken();
        if (!token) return;
        const response = await fetch(window.CriptaApp?.urls?.api?.("api/data/monster-abilities") || "https://sigillo-api.khuzoe.workers.dev/api/data/monster-abilities", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                data: state.abilityTemplates.map((template) => createMonsterAbilityFromTemplate(template)),
                campaignId: getCampaignId()
            })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
    }

    function downloadFoundryActor() {
        getMonsterAbilities(state.creature).forEach(applyAbilityDefaultsForKind);
        const actor = buildFoundryActorExport(state.creature);
        const blob = new Blob([JSON.stringify(actor, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${slugify(state.creature?.name || "creatura")}-foundry-v12.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function cancelEdit() {
        if (state.dirty && !window.confirm("Annullare le modifiche non salvate?")) return;
        window.location.reload();
    }

    async function saveEdit() {
        const token = readAuthToken();
        if (!token) {
            alert("Login richiesto per salvare.");
            return;
        }

        const toolbar = root.querySelector("[data-bestiary-toolbar]");
        toolbar?.setAttribute("data-saving", "true");
        try {
            getMonsterAbilities(state.creature).forEach(applyAbilityDefaultsForKind);
            const loaded = await loadBestiaryDocument();
            const nextData = Array.isArray(loaded.data) ? loaded.data.slice() : [];
            const cleanCreature = pruneCreature(structuredCloneSafe(state.creature));
            const targetSlug = slugify(state.creature.id || state.creature.name || creatureId);
            let index = nextData.findIndex((entry) => slugify(entry?.id || entry?.name || "") === targetSlug);
            if (index < 0) index = nextData.findIndex((entry) => slugify(entry?.name || "") === creatureId);
            if (index >= 0) nextData[index] = { ...nextData[index], ...cleanCreature };
            else nextData.push(cleanCreature);

            const response = await fetch(getBestiaryApiUrl(), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    data: nextData,
                    expectedVersion: loaded.source === "kv" ? (loaded.version ?? 0) : 0,
                    campaignId: getCampaignId()
                })
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);

            state.creature = cleanCreature;
            state.version = payload?.version ?? state.version;
            state.source = "kv";
            state.editing = false;
            state.dirty = false;
            editButton?.classList.remove("is-editing");
            if (createMode) {
                const nextUrl = new URL(window.location.href);
                nextUrl.searchParams.delete("new");
                nextUrl.searchParams.set("id", cleanCreature.id);
                history.replaceState({}, "", nextUrl.toString());
            }
            render();
        } catch (error) {
            console.error("Salvataggio creatura fallito:", error);
            alert(`Salvataggio fallito: ${error?.message || error}`);
        } finally {
            toolbar?.removeAttribute("data-saving");
        }
    }

    async function uploadImage() {
        const token = readAuthToken();
        if (!token) {
            alert("Login richiesto per caricare immagini.");
            return;
        }
        const file = await pickImageFile();
        if (!file || !state.creature) return;

        try {
            const blob = /\.webp$/i.test(file.name) ? file : await convertImageToWebp(file);
            const fileName = `${slugify(state.creature.name || creatureId || "creatura")}.webp`;
            const folder = "creatures/bestiary";
            const form = new FormData();
            form.set("folder", folder);
            form.set("filename", fileName);
            form.set("campaignId", getCampaignId());
            form.set("file", new File([blob], fileName, { type: "image/webp" }));

            const uploadUrl = new URL(window.CriptaApp?.urls?.api?.("media/upload") || "https://sigillo-api.khuzoe.workers.dev/media/upload");
            uploadUrl.searchParams.set("folder", folder);
            uploadUrl.searchParams.set("campaign", getCampaignId());
            const response = await fetch(uploadUrl.toString(), {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: form
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
            state.creature.image = payload.path || payload.key || `media/${folder}/${fileName}`;
            state.dirty = true;
            render();
        } catch (error) {
            console.error("Upload immagine creatura fallito:", error);
            alert(`Upload fallito: ${error?.message || error}`);
        }
    }

    async function uploadAbilityIcon(index) {
        const token = readAuthToken();
        if (!token) {
            alert("Login richiesto per caricare immagini.");
            return;
        }
        const abilities = getMonsterAbilities(state.creature);
        const ability = abilities[index];
        if (!ability) return;
        const file = await pickImageFile();
        if (!file) return;

        try {
            const blob = /\.webp$/i.test(file.name) ? file : await convertImageToWebp(file);
            const baseName = slugify(`${state.creature?.name || "creatura"}-${ability.name || "abilita"}`);
            const fileName = `${baseName}.webp`;
            const folder = "monster-abilities";
            const form = new FormData();
            form.set("folder", folder);
            form.set("filename", fileName);
            form.set("campaignId", getCampaignId());
            form.set("file", new File([blob], fileName, { type: "image/webp" }));

            const uploadUrl = new URL(window.CriptaApp?.urls?.api?.("media/upload") || "https://sigillo-api.khuzoe.workers.dev/media/upload");
            uploadUrl.searchParams.set("folder", folder);
            uploadUrl.searchParams.set("campaign", getCampaignId());
            const response = await fetch(uploadUrl.toString(), {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: form
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
            ability.iconImage = payload.path || payload.key || `media/${folder}/${fileName}`;
            state.dirty = true;
            render();
        } catch (error) {
            console.error("Upload icona abilita fallito:", error);
            alert(`Upload icona fallito: ${error?.message || error}`);
        }
    }
});

async function loadBestiaryDocument() {
    try {
        if (typeof window.CriptaApp?.api?.get === "function") {
            const payload = await window.CriptaApp.api.get("api/data/bestiary");
            if (Array.isArray(payload?.data)) {
                return {
                    data: payload.data,
                    version: Number(payload.version || 0),
                    source: payload.source || "kv"
                };
            }
        }
    } catch (error) {
        console.warn("KV bestiary non disponibile, uso JSON statico.", error);
    }

    const response = await fetch(window.CriptaApp?.urls?.data?.("bestiary.json") || "../../assets/data/bestiary.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return { data: Array.isArray(data) ? data : data?.data, version: 0, source: "static" };
}

async function loadMonsterAbilityTemplates() {
    try {
        if (typeof window.CriptaApp?.api?.get === "function") {
            const payload = await window.CriptaApp.api.get("api/data/monster-abilities");
            if (Array.isArray(payload?.data)) return payload.data;
        }
    } catch (error) {
        console.warn("KV monster-abilities non disponibile, uso template locali.", error);
    }

    const response = await fetch(window.CriptaApp?.urls?.data?.("monster-abilities.json") || "../../assets/data/monster-abilities.json").catch(() => null);
    if (response?.ok) {
        const data = await response.json().catch(() => null);
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.data)) return data.data;
    }
    return DEFAULT_MONSTER_ABILITY_TEMPLATES;
}

const DEFAULT_MONSTER_ABILITY_TEMPLATES = [
    {
        id: "multiattack",
        name: "Multiattacco",
        icon: "fa-hand-fist",
        type: "feat",
        section: "action",
        activation: "action",
        description: "La creatura effettua due attacchi."
    },
    {
        id: "melee-weapon-attack",
        name: "Attacco in mischia",
        icon: "fa-swords",
        type: "weapon",
        section: "action",
        activation: "action",
        range: "5 ft",
        target: "1 bersaglio",
        attackBonus: "",
        damageFormula: "1d8 + 3",
        damageType: "slashing",
        description: "Attacco con arma da mischia."
    },
    {
        id: "ranged-weapon-attack",
        name: "Attacco a distanza",
        icon: "fa-bullseye",
        type: "weapon",
        section: "action",
        activation: "action",
        range: "60/120 ft",
        target: "1 bersaglio",
        attackBonus: "",
        damageFormula: "1d6 + 3",
        damageType: "piercing",
        description: "Attacco con arma a distanza."
    },
    {
        id: "saving-throw-effect",
        name: "Effetto con TS",
        icon: "fa-shield-halved",
        type: "feat",
        section: "action",
        activation: "action",
        range: "30 ft",
        target: "una creatura",
        saveAbility: "dex",
        saveDc: "",
        damageFormula: "2d6",
        damageType: "fire",
        description: "Il bersaglio effettua un tiro salvezza o subisce l'effetto."
    },
    {
        id: "recharge-breath",
        name: "Soffio a ricarica",
        icon: "fa-fire-flame-curved",
        type: "feat",
        section: "action",
        activation: "action",
        range: "30 ft",
        target: "cono",
        saveAbility: "dex",
        damageFormula: "4d6",
        damageType: "fire",
        description: "Ricarica 5-6. Ogni creatura nell'area effettua un tiro salvezza."
    },
    {
        id: "reaction-parry",
        name: "Parata",
        icon: "fa-shield",
        type: "feat",
        section: "reaction",
        activation: "reaction",
        description: "La creatura aggiunge 2 alla CA contro un attacco che la colpirebbe."
    }
];

const SENSE_OPTIONS = [
    { value: "blindsight", label: "Vista cieca" },
    { value: "darkvision", label: "Scurovisione" },
    { value: "tremorsense", label: "Percezione tellurica" },
    { value: "truesight", label: "Vista pura" }
];

const MONSTER_ROLE_OPTIONS = [
    ["standard", "Standard"],
    ["brute", "Bruto"],
    ["skirmisher", "Mobile"],
    ["caster", "Incantatore"],
    ["elite", "Elite"],
    ["boss", "Boss"]
];

const FOUNDRY_SIZE_OPTIONS = [
    ["tiny", "Minuscola"],
    ["sm", "Piccola"],
    ["med", "Media"],
    ["lg", "Grande"],
    ["huge", "Enorme"],
    ["grg", "Mastodontica"]
];

const ABILITY_KIND_OPTIONS = [
    ["attack", "Attacco"],
    ["save", "TS"],
    ["aura", "Aura"],
    ["passive", "Passiva"],
    ["reaction", "Reazione"],
    ["legendary", "Leggendaria"]
];

const SECTION_OPTIONS = [
    ["trait", "Tratto"],
    ["action", "Azione"],
    ["bonus", "Bonus action"],
    ["reaction", "Reazione"],
    ["legendary", "Leggendaria"]
];

const SAVE_ABILITY_OPTIONS = [
    ["", "Nessuno"],
    ["str", "Forza"],
    ["dex", "Destrezza"],
    ["con", "Costituzione"],
    ["int", "Intelligenza"],
    ["wis", "Saggezza"],
    ["cha", "Carisma"]
];

const SKILL_OPTIONS = [
    { key: "acr", label: "Acrobazia", ability: "dex" },
    { key: "ani", label: "Addestrare Animali", ability: "wis" },
    { key: "arc", label: "Arcano", ability: "int" },
    { key: "ath", label: "Atletica", ability: "str" },
    { key: "dec", label: "Inganno", ability: "cha" },
    { key: "his", label: "Storia", ability: "int" },
    { key: "ins", label: "Intuizione", ability: "wis" },
    { key: "itm", label: "Intimidire", ability: "cha" },
    { key: "inv", label: "Indagare", ability: "int" },
    { key: "med", label: "Medicina", ability: "wis" },
    { key: "nat", label: "Natura", ability: "int" },
    { key: "prc", label: "Percezione", ability: "wis" },
    { key: "prf", label: "Intrattenere", ability: "cha" },
    { key: "per", label: "Persuasione", ability: "cha" },
    { key: "rel", label: "Religione", ability: "int" },
    { key: "slt", label: "Rapidità di Mano", ability: "dex" },
    { key: "ste", label: "Furtività", ability: "dex" },
    { key: "sur", label: "Sopravvivenza", ability: "wis" }
];

const ATTACK_ABILITY_OPTIONS = [
    ["str", "STR"],
    ["dex", "DEX"],
    ["custom", "ALTRO"]
];

const ABILITY_DAMAGE_TYPE_OPTIONS = [
    ["acid", "Acido"],
    ["bludgeoning", "Contundente"],
    ["cold", "Freddo"],
    ["fire", "Fuoco"],
    ["force", "Forza"],
    ["lightning", "Fulmine"],
    ["necrotic", "Necrotico"],
    ["piercing", "Perforante"],
    ["psychic", "Psichico"],
    ["radiant", "Radiante"],
    ["slashing", "Tagliente"],
    ["thunder", "Tuono"],
    ["poison", "Veleno"]
];

const ABILITY_FILTERS = [
    ["all", "Tutte"],
    ["attack", "Attacchi"],
    ["defense", "Difese"],
    ["mobility", "Mobilita"],
    ["control", "Controllo"],
    ["magic", "Magia"],
    ["boss", "Boss"]
];

const DND_TYPE_OPTIONS = [
    "Aberrazione",
    "Bestia",
    "Celestiale",
    "Costrutto",
    "Drago",
    "Elementale",
    "Folletto",
    "Gigante",
    "Immondo",
    "Melma",
    "Mostruosita",
    "Non morto",
    "Pianta",
    "Umanoide"
];

const DAMAGE_TYPE_OPTIONS = [
    { value: "Acido", label: "Acido" },
    { value: "Contundente", label: "Contundente" },
    { value: "Freddo", label: "Freddo" },
    { value: "Fuoco", label: "Fuoco" },
    { value: "Forza", label: "Forza" },
    { value: "Fulmine", label: "Fulmine" },
    { value: "Necrotico", label: "Necrotico" },
    { value: "Perforante", label: "Perforante" },
    { value: "Psichico", label: "Psichico" },
    { value: "Radiante", label: "Radiante" },
    { value: "Tagliente", label: "Tagliente" },
    { value: "Tuono", label: "Tuono" },
    { value: "Veleno", label: "Veleno" }
];

function ensureFoundryMonsterData(creature) {
    if (!creature.foundry || typeof creature.foundry !== "object") creature.foundry = {};
    const foundry = creature.foundry;
    foundry.ac ??= "";
    foundry.hp ??= { value: "", formula: "" };
    foundry.movement ??= { walk: 30, fly: "", swim: "", climb: "" };
    foundry.cr ??= "";
    foundry.prof ??= "";
    foundry.role ??= "standard";
    foundry.size ??= mapWikiSizeToFoundry(creature.details?.size);
    foundry.senses ??= "";
    foundry.languages ??= "";
    foundry.skills ??= {};
    foundry.flags ??= {};
    foundry.abilities ??= {};
    ["str", "dex", "con", "int", "wis", "cha"].forEach((key) => {
        if (!foundry.abilities[key] || typeof foundry.abilities[key] !== "object") {
            foundry.abilities[key] = { value: 10 };
        }
    });
    if (!Array.isArray(foundry.abilitiesList)) foundry.abilitiesList = [];
    return foundry;
}

function getMonsterAbilities(creature) {
    return ensureFoundryMonsterData(creature).abilitiesList;
}

function createMonsterAbilityFromTemplate(template) {
    const copy = structuredCloneSafe(template || {});
    copy.id = copy.id || slugify(copy.name || "abilita");
    copy.name = copy.name || "Abilità";
    copy.icon = copy.icon || "fa-burst";
    copy.kind = copy.kind || inferAbilityKind(copy);
    copy.type = copy.type || "feat";
    copy.section = copy.section || sectionFromAbilityKind(copy.kind);
    copy.activation = copy.activation || activationFromAbilityKind(copy.kind);
    copy.description = copy.description || "";
    if (!copy.flags || typeof copy.flags !== "object") copy.flags = {};
    return copy;
}

function getAbilityDamageParts(ability) {
    const saved = Array.isArray(ability?.damageParts) ? ability.damageParts : [];
    const normalized = saved.map((part) => ({
        formula: String(part?.formula || part?.damage || "").trim(),
        type: damageTypeValueFromLabel(part?.type || part?.damageType || "")
    }));
    if (saved.length) return normalized.length ? normalized : [{ formula: "", type: "" }];
    const legacyTypes = parseAbilityDamageTypes(ability);
    if (ability?.damageFormula || legacyTypes.length) {
        return [{ formula: ability.damageFormula || "", type: legacyTypes[0] || "" }];
    }
    return [{ formula: "", type: "" }];
}

function parseAbilityDamageTypes(ability) {
    const raw = Array.isArray(ability?.damageTypes)
        ? ability.damageTypes
        : String(ability?.damageType || "").split(/[;,|]/);
    return raw
        .map((value) => damageTypeValueFromLabel(value))
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index);
}

function damageTypeValueFromLabel(value) {
    const key = normalizeSearchKey(value);
    if (!key) return "";
    const direct = ABILITY_DAMAGE_TYPE_OPTIONS.find(([optionValue]) => optionValue === key);
    if (direct) return direct[0];
    const byLabel = ABILITY_DAMAGE_TYPE_OPTIONS.find(([, label]) => normalizeSearchKey(label) === key);
    return byLabel?.[0] || "";
}

function getPrimaryAbilityDamageType(ability) {
    return parseAbilityDamageTypes(ability)[0] || ability?.damageType || "";
}

function formatSignedBonus(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return number >= 0 ? `+${number}` : String(number);
}

function inferAbilityKind(ability) {
    const section = String(ability.section || "").toLowerCase();
    if (ability.kind) return ability.kind;
    if (section === "legendary") return "legendary";
    if (section === "reaction") return "reaction";
    if (ability.saveAbility || ability.saveDc) return "save";
    if (ability.attackBonus || ability.damageFormula) return "attack";
    if (String(ability.name || "").toLowerCase().includes("aura")) return "aura";
    return "passive";
}

function activationFromAbilityKind(kind) {
    if (kind === "reaction") return "reaction";
    if (kind === "legendary") return "legendary";
    if (kind === "passive" || kind === "aura") return "";
    return "action";
}

function sectionFromAbilityKind(kind) {
    if (kind === "reaction") return "reaction";
    if (kind === "legendary") return "legendary";
    if (kind === "passive" || kind === "aura") return "trait";
    return "action";
}

function labelForAbilityKind(kind) {
    return ABILITY_KIND_OPTIONS.find(([value]) => value === kind)?.[1] || "Abilita";
}

function validateFoundryMonster(creature) {
    const foundry = ensureFoundryMonsterData(creature);
    const abilities = getMonsterAbilities(creature);
    const errors = [];
    const warnings = [];
    if (!creature.name) errors.push("manca il nome della creatura");
    if (!creature.image) warnings.push("manca l'immagine del token");
    if (!foundry.ac) errors.push("manca la Classe Armatura");
    if (!foundry.hp?.value && !foundry.hp?.formula) errors.push("mancano i Punti Ferita");
    if (!foundry.cr) warnings.push("manca il Grado Sfida");
    if (!foundry.prof) warnings.push("manca il Bonus Competenza");
    if (!abilities.length) warnings.push("nessuna abilita configurata");
    abilities.forEach((ability, index) => {
        const label = ability.name || `abilita ${index + 1}`;
        const kind = ability.kind || inferAbilityKind(ability);
        if (!ability.description) warnings.push(`${label}: descrizione vuota`);
        if (kind === "attack" && !ability.attackBonus) warnings.push(`${label}: attacco senza bonus`);
        if (kind === "attack" && getAbilityDamageParts(ability).some((part) => part.formula && !part.type)) warnings.push(`${label}: danno senza tipo`);
        if ((kind === "save" || kind === "aura") && ability.saveAbility && !ability.saveDc) warnings.push(`${label}: TS senza CD`);
    });
    return { errors, warnings };
}

function buildMonsterSuggestions(foundry) {
    const cr = parseCrValue(foundry.cr);
    const role = foundry.role || "standard";
    const size = foundry.size || "med";
    const baseProf = cr >= 29 ? 9 : cr >= 25 ? 8 : cr >= 21 ? 7 : cr >= 17 ? 6 : cr >= 13 ? 5 : cr >= 5 ? 3 : 2;
    const roleMod = { brute: 2, skirmisher: 0, caster: -1, elite: 1, boss: 2, standard: 0 }[role] || 0;
    const ac = Math.max(10, Math.round(12 + Math.min(8, cr / 3) + (role === "caster" ? -1 : 0) + (role === "boss" ? 1 : 0)));
    const hpBase = Math.max(7, Math.round(18 + cr * 16));
    const hpMultiplier = { brute: 1.25, skirmisher: 0.85, caster: 0.75, elite: 1.45, boss: 2.1, standard: 1 }[role] || 1;
    const hp = Math.round(hpBase * hpMultiplier);
    const die = hitDieForFoundrySize(size);
    const dice = Math.max(1, Math.round(hp / ((die + 1) / 2 + 2)));
    const attackBonus = Math.max(3, baseProf + 2 + Math.floor(cr / 4) + roleMod);
    const saveDc = Math.max(11, 8 + baseProf + 2 + Math.floor(cr / 4) + roleMod);
    const damageDice = Math.max(1, Math.round((6 + cr * 3) / 7));
    return {
        ac: String(ac),
        hp: String(hp),
        hpFormula: `${dice}d${die}+${Math.max(0, Math.round(hp - dice * ((die + 1) / 2)))}`,
        prof: String(baseProf),
        attackBonus: String(attackBonus),
        saveDc: String(saveDc),
        damage: `${damageDice}d6`
    };
}

function parseCrValue(value) {
    const raw = String(value || "").trim();
    if (!raw) return 1;
    if (raw.includes("/")) {
        const [a, b] = raw.split("/").map(Number);
        return a && b ? a / b : 1;
    }
    const number = Number(raw.replace(",", "."));
    return Number.isFinite(number) ? number : 1;
}

function buildFoundryActorExport(creature) {
    const foundry = ensureFoundryMonsterData(creature);
    const abilities = getMonsterAbilities(creature);
    return {
        name: creature.name || "Creatura",
        type: "npc",
        img: resolveImageUrl(creature.image),
        system: {
            abilities: normalizeFoundryAbilities(foundry.abilities),
            attributes: {
                ac: { flat: toLeadingNumberOrNull(foundry.ac), calc: "flat" },
                hp: {
                    value: toNumberOrNull(foundry.hp?.value) || 1,
                    max: toNumberOrNull(foundry.hp?.value) || 1,
                    formula: String(foundry.hp?.formula || "")
                },
                movement: normalizeFoundryMovement(foundry.movement),
                senses: normalizeFoundrySenses(foundry.senses),
                prof: toNumberOrNull(foundry.prof)
            },
            details: {
                type: { value: mapWikiTypeToFoundry(creature.details?.dndType), subtype: "", swarm: "", custom: creature.details?.dndType || "" },
                cr: toNumberOrString(foundry.cr),
                source: "Sigillo del Male Wiki",
                biography: { value: creature.details?.description || "" }
            },
            traits: {
                size: foundry.size || mapWikiSizeToFoundry(creature.details?.size),
                languages: { value: parseCsvLower(foundry.languages), custom: foundry.languages || "" },
                di: { value: normalizeDamageTypes(creature.details?.immunities), custom: "" },
                dr: { value: normalizeDamageTypes(creature.details?.resistances), custom: "" },
                dv: { value: normalizeDamageTypes(creature.details?.vulnerabilities), custom: "" },
                ci: { value: [], custom: "" }
            },
            skills: normalizeFoundrySkills(foundry.skills)
        },
        prototypeToken: {
            name: creature.name || "Creatura",
            displayName: 20,
            displayBars: 20,
            width: tokenSizeForFoundrySize(foundry.size),
            height: tokenSizeForFoundrySize(foundry.size),
            texture: { src: resolveImageUrl(creature.image) },
            actorLink: false
        },
        items: abilities.map(buildFoundryItemFromAbility),
        effects: [],
        flags: foundry.flags || {}
    };
}

function buildFoundryItemFromAbility(ability) {
    const type = ability.type || "feat";
    const description = ability.description || "";
    const item = {
        name: ability.name || "Abilità",
        type,
        img: ability.iconImage ? resolveImageUrl(ability.iconImage) : foundryIconFromFa(ability.icon),
        system: {
            description: { value: description, chat: "" },
            activation: { type: ability.activation || activationFromSection(ability.section), cost: 1, condition: "" },
            target: { value: null, width: null, units: "", type: ability.target || "" },
            range: { value: parseRangeValue(ability.range), long: null, units: parseRangeUnits(ability.range) },
            uses: { value: null, max: "", per: null, recovery: "" },
            consume: { type: "", target: "", amount: null },
            actionType: inferActionType(ability),
            attackBonus: ability.attackBonus || "",
            damage: {
                parts: buildFoundryDamageParts(ability),
                versatile: ""
            },
            save: {
                ability: ability.saveAbility || "",
                dc: toNumberOrNull(ability.saveDc),
                scaling: ability.saveDc ? "flat" : ""
            },
            type: { value: "", subtype: "" },
            requirements: "",
            recharge: parseRecharge(ability.description)
        },
        effects: [],
        flags: ability.flags || {}
    };
    return item;
}

function buildFoundryDamageParts(ability) {
    const parts = getAbilityDamageParts(ability)
        .filter((part) => part.formula)
        .map((part) => [part.formula, part.type || ""]);
    if (parts.length) return parts;
    return ability.damageFormula ? [[ability.damageFormula, getPrimaryAbilityDamageType(ability)]] : [];
}

function findCreature(creatures, id) {
    const list = Array.isArray(creatures) ? creatures : [];
    return list.find((creature) => slugify(creature?.id || creature?.name || "") === id)
        || list.find((creature) => slugify(creature?.name || "") === id);
}

function createEmptyCreature() {
    return {
        id: `nuovo-mostro-${Date.now().toString(36)}`,
        name: "Nuovo Mostro",
        image: "media/creatures/bestiary/nuovo-mostro.webp",
        imageAdjust: { x: 50, y: 50 },
        category: "Senza Categoria",
        details: {
            description: "",
            dndType: "Mostruosita",
            size: "Media",
            height: "",
            weight: "",
            traits: [],
            drops: []
        },
        foundry: {
            ac: 10,
            hp: { value: 10, formula: "2d8 + 2" },
            movement: { walk: 30, fly: "", swim: "", climb: "" },
            cr: "1/4",
            prof: 2,
            size: "med",
            senses: "",
            languages: "",
            skills: {},
            flags: {},
            abilities: {
                str: { value: 10 },
                dex: { value: 10 },
                con: { value: 10 },
                int: { value: 10 },
                wis: { value: 10 },
                cha: { value: 10 }
            },
            abilitiesList: []
        }
    };
}

function isCreatureVisible(creature) {
    if (!creature) return false;
    if (window.WikiSpoiler) return window.WikiSpoiler.isVisible(creature);
    return creature.hidden !== true && creature.status !== "hidden";
}

function redirectToBestiaryList() {
    const target = new URL(buildBestiaryListUrl(), window.location.href);
    window.location.replace(target.toString());
}

function buildBestiaryListUrl() {
    const target = new URL("../bestiario.html", window.location.href);
    const campaignId = getCampaignId();
    if (campaignId && campaignId !== "cripta-di-sangue") target.searchParams.set("campaign", campaignId);
    return target.toString();
}

function getCreatureDisplayName(creature) {
    if (!creature) return "Creatura";
    return creature.discovered === false ? (creature.mysteryName || "Creatura Misteriosa") : (creature.name || "Creatura");
}

function renderStatsSection(stats) {
    return `
        <section class="bestiary-detail-section">
            <h2>Profilo</h2>
            <dl class="bestiary-detail-stats">
                ${stats.map(([label, value]) => `
                    <div>
                        <dt>${escapeHtml(label)}</dt>
                        <dd>${escapeHtml(value)}</dd>
                    </div>
                `).join("")}
            </dl>
        </section>
    `;
}

function renderListSection(title, entries) {
    return `
        <section class="bestiary-detail-section">
            <h2>${escapeHtml(title)}</h2>
            <ul class="bestiary-detail-list">
                ${entries.map((entry) => `
                    <li>
                        <strong>${escapeHtml(entry.name || entry.label || title)}</strong>
                        ${entry.note || entry.description ? `<span>${escapeHtml(entry.note || entry.description)}</span>` : ""}
                    </li>
                `).join("")}
            </ul>
        </section>
    `;
}

function normalizeNamedEntry(entry) {
    if (typeof entry === "string") return { name: entry };
    if (!entry || typeof entry !== "object") return { name: "Voce" };
    return {
        name: entry.name || entry.label || "Voce",
        note: entry.note || entry.description || entry.rarity || ""
    };
}

function renderChip(icon, label) {
    return `
        <span class="bestiary-detail-chip">
            <i class="fas ${escapeHtml(icon || "fa-circle")}" aria-hidden="true"></i>
            <span>${escapeHtml(label)}</span>
        </span>
    `;
}

function renderInput(label, field, value) {
    return `
        <label class="bestiary-detail-field">
            <span>${escapeHtml(label)}</span>
            <input class="bestiary-detail-input" data-field="${escapeHtml(field)}" value="${escapeHtml(value)}">
        </label>
    `;
}

function renderArea(label, field, value) {
    return `
        <label class="bestiary-detail-field bestiary-detail-field--wide">
            <span>${escapeHtml(label)}</span>
            <textarea class="bestiary-detail-area" data-field="${escapeHtml(field)}" spellcheck="false">${escapeHtml(value)}</textarea>
        </label>
    `;
}

    function renderSelect(label, field, value, options) {
        return `
            <label class="bestiary-detail-field">
                <span>${escapeHtml(label)}</span>
                <select class="bestiary-detail-select" data-field="${escapeHtml(field)}">
                ${options.map(([optionValue, optionLabel]) => `
                    <option value="${escapeHtml(optionValue)}"${optionValue === value ? " selected" : ""}>${escapeHtml(optionLabel)}</option>
                `).join("")}
            </select>
        </label>
        `;
    }

    function renderMovementAndSensesPanel(foundry) {
        return `
            <div class="monster-mobility-panel">
                ${renderMovementRangePicker(foundry.movement)}
                ${renderSensesPicker(foundry.senses)}
            </div>
        `;
    }

    function renderMovementRangePicker(movement) {
        return `
            <div class="bestiary-detail-field bestiary-detail-field--wide">
                <label>Movimenti</label>
                <div class="monster-picker-grid monster-picker-grid--ranges">
                    ${[
                        ["Camminata", "foundry.movement.walk", movement?.walk ?? ""],
                        ["Volo", "foundry.movement.fly", movement?.fly ?? ""],
                        ["Nuoto", "foundry.movement.swim", movement?.swim ?? ""],
                        ["Scalare", "foundry.movement.climb", movement?.climb ?? ""]
                    ].map(([label, field, value]) => `
                        <label class="monster-picker-option monster-picker-option--range">
                            <span>${escapeHtml(label)}</span>
                            <input class="bestiary-detail-input" data-field="${escapeHtml(field)}" value="${escapeHtml(value)}" placeholder="ft">
                        </label>
                    `).join("")}
                </div>
            </div>
        `;
    }

    function renderSensesPicker(value) {
        const parsed = parseSensesText(value);
        return `
            <div class="bestiary-detail-field bestiary-detail-field--wide">
                <label>Sensi</label>
                <div class="monster-picker-grid monster-picker-grid--ranges">
                    ${SENSE_OPTIONS.map((sense) => `
                        <label class="monster-picker-option monster-picker-option--range">
                            <span>${escapeHtml(sense.label)}</span>
                            <input class="bestiary-detail-input" data-sense-range="${escapeHtml(sense.value)}" value="${escapeHtml(parsed.get(sense.value) || "")}" placeholder="ft">
                        </label>
                    `).join("")}
                </div>
            </div>
        `;
    }

    function renderDefensePicker(details) {
        return `
            <div class="bestiary-detail-field bestiary-detail-field--wide">
                <label>Difese</label>
                <div class="monster-defense-table">
                    <div></div>
                    <strong>Resistenza</strong>
                    <strong>Immunità</strong>
                    <strong>Vulnerabilità</strong>
                    ${DAMAGE_TYPE_OPTIONS.map((damage) => `
                        <span>${escapeHtml(damage.label)}</span>
                        ${renderDefenseCheckbox("resistances", damage.value, details.resistances)}
                        ${renderDefenseCheckbox("immunities", damage.value, details.immunities)}
                        ${renderDefenseCheckbox("vulnerabilities", damage.value, details.vulnerabilities)}
                    `).join("")}
                </div>
            </div>
        `;
    }

    function renderDefenseCheckbox(kind, value, selectedValues) {
        const selected = Array.isArray(selectedValues) && selectedValues.some((entry) => normalizeSearchKey(entry) === normalizeSearchKey(value));
        const label = kind === "resistances" ? "Resistenza" : kind === "immunities" ? "Immunita" : "Vulnerabilita";
        return `
            <label class="monster-defense-check" title="${escapeHtml(`${label}: ${value}`)}">
                <input type="checkbox" data-defense-kind="${escapeHtml(kind)}" data-defense-value="${escapeHtml(value)}" value="${escapeHtml(value)}" ${selected ? "checked" : ""}>
                <span></span>
            </label>
        `;
    }

    function renderSkillProficiencyPanel(skills) {
        return `
            <div class="monster-skills-panel">
                <div class="monster-subsection-title">Check</div>
                <p class="monster-skill-help">Click: competenza. Secondo click: expertise.</p>
                <div class="monster-skill-grid">
                    ${SKILL_OPTIONS.map((skill) => {
                        const value = Number(skills?.[skill.key]?.value || 0);
                        const stateClass = value >= 2 ? "is-expertise" : value >= 1 ? "is-proficient" : "";
                        const stateLabel = value >= 2 ? "E" : value >= 1 ? "P" : "";
                        return `
                            <button class="monster-skill-btn ${stateClass}" type="button" data-skill-key="${escapeHtml(skill.key)}" title="${escapeHtml(skill.label)}: nessuna / proficiency / expertise">
                                <span>${escapeHtml(skill.label)}</span>
                                <strong>${escapeHtml(stateLabel)}</strong>
                            </button>
                        `;
                    }).join("")}
                </div>
            </div>
        `;
    }

    function renderMonsterSuggestionPanel(foundry, suggestions) {
        return `
            <div class="bestiary-detail-field bestiary-detail-field--wide monster-suggestion-panel">
                <div class="monster-subsection-title">Suggerimenti rapidi</div>
                <div class="monster-preset-row">
                    ${renderSelect("Preset", "foundry.role", foundry.role || "standard", MONSTER_ROLE_OPTIONS)}
                </div>
                <div class="monster-suggestion-strip">
                    <span>CA ${escapeHtml(suggestions.ac)}</span>
                    <span>PF ${escapeHtml(suggestions.hp)}</span>
                    <span>Attacco +${escapeHtml(suggestions.attackBonus)}</span>
                    <span>CD ${escapeHtml(suggestions.saveDc)}</span>
                    <span>Danno ${escapeHtml(suggestions.damage)}</span>
                </div>
                <div class="monster-helper-row">
                    <button class="monster-helper-btn" type="button" data-action="calculate-hp">
                        <i class="fas fa-calculator" aria-hidden="true"></i>
                        <span>Calcola PF medi dalla formula</span>
                    </button>
                    <button class="monster-helper-btn monster-helper-btn--primary" type="button" data-action="apply-monster-suggestions">
                        <i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i>
                        <span>Applica suggerimenti CR</span>
                    </button>
                </div>
            </div>
        `;
    }

    function renderCompactInput(label, field, value) {
        return `
            <label class="monster-compact-field">
                <span>${escapeHtml(label)}</span>
                <input class="bestiary-detail-input" data-field="${escapeHtml(field)}" value="${escapeHtml(value)}">
            </label>
        `;
    }

    function renderButtonChoiceGroup(label, field, value, options) {
        return `
            <div class="monster-choice-group" role="group" aria-label="${escapeHtml(label)}">
                <span>${escapeHtml(label)}</span>
                <div>
                    ${options.map(([optionValue, optionLabel]) => `
                        <button class="monster-choice-btn ${optionValue === value ? "is-active" : ""}" type="button" data-choice-field="${escapeHtml(field)}" data-choice-value="${escapeHtml(optionValue)}">
                            ${escapeHtml(optionLabel)}
                        </button>
                    `).join("")}
                </div>
            </div>
        `;
    }

    function renderAbilityScoreStepper(ability, value) {
        return `
            <div class="monster-score-stepper" data-score="${escapeHtml(ability)}">
                <span>${escapeHtml(ability.toUpperCase())}</span>
                <button type="button" data-score-action="dec" data-score-ability="${escapeHtml(ability)}" aria-label="Riduci ${escapeHtml(ability)}">-</button>
                <input class="bestiary-detail-input" data-field="foundry.abilities.${escapeHtml(ability)}.value" value="${escapeHtml(value)}">
                <button type="button" data-score-action="inc" data-score-ability="${escapeHtml(ability)}" aria-label="Aumenta ${escapeHtml(ability)}">+</button>
            </div>
        `;
    }

function resolveImageUrl(path) {
    const value = String(path || "").trim();
    if (!value) return "";
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    if (value.startsWith("media/")) return window.CriptaApp?.urls?.api?.(value) || `https://sigillo-api.khuzoe.workers.dev/${value}`;
    if (value.startsWith("/media/")) return window.CriptaApp?.urls?.api?.(value.slice(1)) || `https://sigillo-api.khuzoe.workers.dev/${value.slice(1)}`;
    if (value.startsWith("assets/")) return `../../${value}`;
    return `../../assets/${value}`;
}

function buildImageStyle(adjust) {
    const x = normalizePercent(adjust?.x, 50);
    const y = normalizePercent(adjust?.y, 50);
    const size = normalizeScale(adjust?.size, 1);
    return `--creature-img-x:${x}%; --creature-img-y:${y}%; --creature-img-scale:${size};`;
}

function normalizePercent(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function normalizeScale(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.max(0.75, number) : fallback;
}

function getRankLabel(rank) {
    return {
        mini_boss: "Creatura maggiore",
        unique_monster: "Creatura unica",
        special: "Speciale"
    }[rank] || "";
}

function getRankIcon(rank) {
    return {
        mini_boss: "fa-skull",
        unique_monster: "fa-crown",
        special: "fa-star"
    }[rank] || "fa-circle";
}

function getBestiaryApiUrl() {
    return window.CriptaApp?.urls?.api?.("api/data/bestiary") || "https://sigillo-api.khuzoe.workers.dev/api/data/bestiary";
}

function getCampaignId() {
    return window.CriptaApp?.campaigns?.currentId?.() || new URLSearchParams(window.location.search).get("campaign") || "cripta-di-sangue";
}

function readAuthToken() {
    try {
        return window.localStorage.getItem("discord_jwt") || "";
    } catch (_) {
        return "";
    }
}

async function pickImageFile() {
    if (window.showOpenFilePicker) {
        const [handle] = await window.showOpenFilePicker({
            multiple: false,
            types: [{ description: "Immagini", accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"] } }]
        }).catch(() => []);
        return handle ? handle.getFile() : null;
    }
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.addEventListener("change", () => resolve(input.files?.[0] || null), { once: true });
        input.click();
    });
}

async function convertImageToWebp(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) reject(new Error("Conversione WebP non riuscita."));
            else resolve(blob);
        }, "image/webp", 0.88);
    });
}

function setPath(target, path, value) {
    const parts = String(path || "").split(".");
    let cursor = target;
    while (parts.length > 1) {
        const key = parts.shift();
        if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
        cursor = cursor[key];
    }
    cursor[parts[0]] = value;
}

function parseJsonArray(value, field) {
    try {
        const parsed = JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.warn(`JSON non valido per ${field}:`, error);
        return [];
    }
}

function listToText(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join("\n");
    return value ? String(value) : "";
}

function textToList(value) {
    return String(value || "")
        .split(/\r?\n|;/)
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function pruneCreature(creature) {
    if (!creature.details || typeof creature.details !== "object") creature.details = {};
    if (creature.foundry && typeof creature.foundry === "object") ensureFoundryMonsterData(creature);
    creature.id = creature.id || slugify(creature.name || "creatura");
    if (creature.hidden !== true) delete creature.hidden;
    if (creature.discovered !== false) delete creature.discovered;
    ["category", "rank", "mysteryName", "mysteryDescription"].forEach((key) => {
        if (!creature[key]) delete creature[key];
    });
    if (Array.isArray(creature.foundryName) && !creature.foundryName.length) delete creature.foundryName;
    ["resistances", "immunities", "vulnerabilities"].forEach((key) => {
        if (Array.isArray(creature.details[key]) && !creature.details[key].length) delete creature.details[key];
    });
    if (!Array.isArray(creature.details.traits)) creature.details.traits = [];
    if (!Array.isArray(creature.details.drops)) creature.details.drops = [];
    return creature;
}

function safeParseObject(value) {
    try {
        const parsed = JSON.parse(value || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        console.warn("JSON oggetto non valido:", error);
        return {};
    }
}

function normalizeFoundryAbilities(abilities) {
    const out = {};
    ["str", "dex", "con", "int", "wis", "cha"].forEach((key) => {
        const score = toNumberOrNull(abilities?.[key]?.value) || 10;
        out[key] = { value: score, proficient: 0, bonuses: { check: "", save: "" } };
    });
    return out;
}

function normalizeFoundryMovement(movement = {}) {
    return {
        burrow: 0,
        climb: toNumberOrNull(movement.climb) || 0,
        fly: toNumberOrNull(movement.fly) || 0,
        swim: toNumberOrNull(movement.swim) || 0,
        walk: toNumberOrNull(movement.walk) || 30,
        units: "ft",
        hover: false
    };
}

function normalizeFoundrySenses(value) {
    const text = String(value || "");
    const parsed = parseSensesText(text);
    return {
        blindsight: Number(parsed.get("blindsight")) || 0,
        darkvision: Number(parsed.get("darkvision")) || 0,
        tremorsense: Number(parsed.get("tremorsense")) || 0,
        truesight: Number(parsed.get("truesight")) || 0,
        units: "ft",
        special: text
    };
}

function parseSensesText(value) {
    const text = String(value || "");
    const map = new Map();
    SENSE_OPTIONS.forEach((sense) => {
        const aliases = {
            blindsight: "blindsight|vista cieca",
            darkvision: "darkvision|scurovisione",
            tremorsense: "tremorsense|percezione tellurica",
            truesight: "truesight|vista pura"
        }[sense.value] || sense.value;
        const regex = new RegExp(`(?:${aliases})\\s*(\\d+)?`, "i");
        const match = text.match(regex);
        if (match) map.set(sense.value, match[1] || "");
    });
    return map;
}

function calculateDndAverageHp(formula, conScore, foundrySize) {
    const normalized = String(formula || "").replace(/\s+/g, "");
    const match = normalized.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!match) return null;
    const diceCount = Number(match[1]);
    const dieSize = Number(match[2]);
    const explicitBonus = match[3] ? Number(match[3]) : null;
    if (!Number.isFinite(diceCount) || !Number.isFinite(dieSize)) return null;
    const conMod = Math.floor((Number(conScore || 10) - 10) / 2);
    const bonus = Number.isFinite(explicitBonus) ? explicitBonus : conMod * diceCount;
    const average = diceCount * ((dieSize + 1) / 2) + bonus;
    const expectedDie = hitDieForFoundrySize(foundrySize);
    if (expectedDie && expectedDie !== dieSize) {
        console.warn(`La formula usa d${dieSize}, ma la taglia suggerirebbe d${expectedDie}. Uso comunque la formula inserita.`);
    }
    return Math.max(1, Math.floor(average));
}

function hitDieForFoundrySize(size) {
    return { tiny: 4, sm: 6, med: 8, lg: 10, huge: 12, grg: 20 }[size] || 8;
}

function normalizeFoundrySkills(skills) {
    const out = {};
    Object.entries(skills || {}).forEach(([key, value]) => {
        if (!key) return;
        out[key] = typeof value === "object"
            ? value
            : { value: Number(value) || 0, ability: "", bonuses: { check: "", passive: "" } };
    });
    return out;
}

function normalizeDamageTypes(values) {
    const map = {
        acido: "acid",
        contundente: "bludgeoning",
        freddo: "cold",
        fuoco: "fire",
        forza: "force",
        fulmine: "lightning",
        necrotico: "necrotic",
        perforante: "piercing",
        psichico: "psychic",
        radiante: "radiant",
        tagliente: "slashing",
        tuono: "thunder",
        veleno: "poison"
    };
    return (Array.isArray(values) ? values : [])
        .map((value) => map[normalizeSearchKey(value)] || String(value || "").trim().toLowerCase())
        .filter(Boolean);
}

function mapWikiTypeToFoundry(value) {
    const map = {
        aberrazione: "aberration",
        bestia: "beast",
        celestiale: "celestial",
        costrutto: "construct",
        drago: "dragon",
        elementale: "elemental",
        folletto: "fey",
        genio: "elemental",
        gigante: "giant",
        immondo: "fiend",
        melma: "ooze",
        mostruosita: "monstrosity",
        "non-morto": "undead",
        "non-morto": "undead",
        pianta: "plant",
        umanoide: "humanoid"
    };
    return map[normalizeSearchKey(value)] || "custom";
}

function mapWikiSizeToFoundry(value) {
    const key = normalizeSearchKey(value);
    if (key.includes("minuscol")) return "tiny";
    if (key.includes("piccol")) return "sm";
    if (key.includes("enorme")) return "huge";
    if (key.includes("grand")) return "lg";
    if (key.includes("mastodont") || key.includes("gargant")) return "grg";
    return "med";
}

function foundrySizeToWikiSize(value) {
    return FOUNDRY_SIZE_OPTIONS.find(([size]) => size === value)?.[1] || "Media";
}

function tokenSizeForFoundrySize(size) {
    return { tiny: 0.5, sm: 1, med: 1, lg: 2, huge: 3, grg: 4 }[size] || 1;
}

function parseCsvLower(value) {
    return String(value || "")
        .split(/[,;\n]/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}

function toNumberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function toLeadingNumberOrNull(value) {
    const match = String(value || "").trim().match(/^-?\d+(?:[.,]\d+)?/);
    if (!match) return null;
    const number = Number(match[0].replace(",", "."));
    return Number.isFinite(number) ? number : null;
}

function toNumberOrString(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : String(value || "");
}

function parseRangeValue(value) {
    const match = String(value || "").match(/(\d+)/);
    return match ? Number(match[1]) : null;
}

function parseRangeUnits(value) {
    const text = String(value || "").toLowerCase();
    if (text.includes("m")) return "ft";
    if (text.includes("ft") || text.includes("feet")) return "ft";
    if (text.includes("mi")) return "mi";
    if (/^\s*\d+/.test(text)) return "ft";
    return "";
}

function parseRecharge(description) {
    const match = String(description || "").match(/ricarica\s+(\d)(?:\s*[-–]\s*(\d))?|recharge\s+(\d)(?:\s*[-–]\s*(\d))?/i);
    if (!match) return { value: null, charged: false };
    const value = Number(match[1] || match[3]);
    return { value: Number.isFinite(value) ? value : null, charged: true };
}

function inferActionType(ability) {
    if (ability.saveAbility) return "save";
    if (ability.damageFormula && ability.type === "weapon") return String(ability.range || "").includes("/") ? "rwak" : "mwak";
    if (ability.damageFormula) return "other";
    return "other";
}

function activationFromSection(section) {
    return {
        bonus: "bonus",
        reaction: "reaction",
        legendary: "legendary"
    }[section] || "action";
}

function foundryIconFromFa(icon) {
    const key = String(icon || "");
    if (key.includes("fire")) return "icons/magic/fire/flame-burning-orange.webp";
    if (key.includes("shield")) return "icons/equipment/shield/heater-steel-boss-red.webp";
    if (key.includes("sword")) return "icons/weapons/swords/sword-broad-serrated-blue.webp";
    if (key.includes("skull")) return "icons/magic/death/skull-energy-light-white.webp";
    if (key.includes("bolt")) return "icons/magic/lightning/bolt-strike-blue.webp";
    return "icons/svg/aura.svg";
}

function normalizeSearchKey(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function structuredCloneSafe(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
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
    return String(value ?? "creatura")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "creatura";
}
