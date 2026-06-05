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
        activeAbilityIndex: 0,
        openRiderPanels: new Set(),
        customConditionTemplates: [],
        conditionDraft: createDefaultConditionDraft(),
        conditionBuilderOpen: false,
        imagePasteTarget: null
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
        document.addEventListener("paste", handleImagePaste);

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
                    <button class="bestiary-detail-action" type="button" data-action="import-creature-json">
                        <i class="fas fa-file-import" aria-hidden="true"></i>
                        <span>Import JSON</span>
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
                            <button class="bestiary-detail-image-frame bestiary-detail-image-upload" type="button" data-action="upload-image" title="Carica immagine o incolla con Ctrl+V">
                                <img src="${escapeHtml(resolveImageUrl(creature.image))}" alt="${escapeHtml(creature.name || "Creatura")}" style="${buildImageStyle(creature.imageAdjust)}">
                            </button>
                            <div class="bestiary-detail-image-adjust" aria-label="Regola immagine creatura">
                                ${renderImageAdjustControl("x", "X", normalizePercent(creature.imageAdjust?.x, 50), 0, 100, 1)}
                                ${renderImageAdjustControl("y", "Y", normalizePercent(creature.imageAdjust?.y, 50), 0, 100, 1)}
                                ${renderImageAdjustControl("size", "Zoom", normalizeScale(creature.imageAdjust?.size, 1), 0.75, 2.5, 0.01)}
                            </div>
                            <div class="bestiary-detail-token-row">
                                <button class="bestiary-detail-token-upload" type="button" data-action="upload-token-image" title="Carica token o incolla con Ctrl+V">
                                    <span>Token</span>
                                    <img src="${escapeHtml(resolveImageUrl(creature.tokenImage || creature.image))}" alt="${escapeHtml(`${creature.name || "Creatura"} token`)}">
                                </button>
                            </div>
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
        bindImagePasteTargets();
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
        root.querySelector('[data-action="upload-token-image"]')?.addEventListener("click", uploadTokenImage);
        root.querySelectorAll("[data-image-adjust]").forEach((field) => {
            field.addEventListener("input", () => updateImageAdjustControl(field));
            field.addEventListener("change", () => updateImageAdjustControl(field));
        });
        root.querySelector('[data-action="download-foundry"]')?.addEventListener("click", downloadFoundryActor);
        root.querySelector('[data-action="import-creature-json"]')?.addEventListener("click", openImportCreatureJsonDialog);
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
        root.querySelectorAll('[data-action="add-condition-template"]').forEach((button) => {
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                addConditionTemplateToActiveAbility(Number(button.dataset.conditionTemplateIndex));
            });
        });
        root.querySelectorAll('[data-action="upload-condition-icon"]').forEach((button) => {
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                uploadConditionTemplateIcon(Number(button.dataset.conditionTemplateIndex));
            });
        });
        root.querySelectorAll("[data-condition-builder-field]").forEach((field) => {
            field.addEventListener("input", () => updateConditionBuilderField(field));
            field.addEventListener("change", () => updateConditionBuilderField(field, { rerender: true }));
        });
        root.querySelector("[data-condition-builder]")?.addEventListener("toggle", (event) => {
            state.conditionBuilderOpen = event.currentTarget.open;
        });
        root.querySelector('[data-action="create-custom-condition-template"]')?.addEventListener("click", createCustomConditionTemplateFromBuilder);
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
        root.querySelectorAll("[data-defense-magic]").forEach((field) => {
            field.addEventListener("change", (event) => updateDefensesFromControls(event));
        });
        root.querySelectorAll("[data-condition-immunity]").forEach((button) => {
            button.addEventListener("click", () => toggleConditionImmunity(button.dataset.conditionImmunity));
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
        root.querySelectorAll("[data-condition-template-index]").forEach((card) => {
            card.addEventListener("dragstart", (event) => {
                event.dataTransfer?.setData("application/x-cripta-condition-template", card.dataset.conditionTemplateIndex || "");
            });
            card.addEventListener("dblclick", () => addConditionTemplateToActiveAbility(Number(card.dataset.conditionTemplateIndex)));
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
            const conditionIndex = event.dataTransfer?.getData("application/x-cripta-condition-template");
            if (conditionIndex !== "") {
                addConditionTemplateToActiveAbility(Number(conditionIndex));
                return;
            }
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
        root.querySelectorAll("[data-ability-passive-break-damage]").forEach((button) => {
            button.addEventListener("click", () => toggleMonsterAbilityPassiveBreakDamage(button));
        });
        root.querySelectorAll("[data-ability-damage-part-field]").forEach((field) => {
            field.addEventListener("input", () => updateMonsterAbilityDamagePart(field));
            field.addEventListener("change", () => updateMonsterAbilityDamagePart(field));
        });
        root.querySelectorAll("[data-ability-damage-part-type]").forEach((button) => {
            button.addEventListener("click", () => updateMonsterAbilityDamagePartType(button));
        });
        root.querySelectorAll("[data-ability-damage-part-magic]").forEach((button) => {
            button.addEventListener("click", () => toggleMonsterAbilityDamagePartMagic(button));
        });
        root.querySelectorAll("[data-ability-rider-field]").forEach((field) => {
            field.addEventListener("input", () => updateMonsterAbilityRiderField(field));
            field.addEventListener("change", () => updateMonsterAbilityRiderField(field));
        });
        root.querySelectorAll("[data-ability-rider-details]").forEach((details) => {
            details.addEventListener("toggle", () => {
                const index = Number(details.dataset.abilityIndex);
                if (!Number.isInteger(index)) return;
                if (details.open) state.openRiderPanels.add(index);
                else state.openRiderPanels.delete(index);
            });
        });
        root.querySelectorAll("[data-rider-condition]").forEach((button) => {
            button.addEventListener("click", () => toggleMonsterAbilityRiderCondition(button));
        });
        root.querySelectorAll("[data-rider-success-mode]").forEach((button) => {
            button.addEventListener("click", () => cycleMonsterAbilityRiderSuccessMode(button));
        });
        root.querySelectorAll("[data-ability-rider-damage-part-field]").forEach((field) => {
            field.addEventListener("input", () => updateMonsterAbilityRiderDamagePart(field));
            field.addEventListener("change", () => updateMonsterAbilityRiderDamagePart(field));
        });
        root.querySelectorAll("[data-ability-rider-damage-part-type]").forEach((button) => {
            button.addEventListener("click", () => updateMonsterAbilityRiderDamagePartType(button));
        });
        root.querySelectorAll("[data-ability-rider-damage-part-magic]").forEach((button) => {
            button.addEventListener("click", () => toggleMonsterAbilityRiderDamagePartMagic(button));
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

    function bindImagePasteTargets() {
        root.querySelector('[data-action="upload-image"]')?.addEventListener("mouseenter", () => setImagePasteTarget({ type: "creature-image" }));
        root.querySelector('[data-action="upload-image"]')?.addEventListener("focus", () => setImagePasteTarget({ type: "creature-image" }));
        root.querySelector('[data-action="upload-token-image"]')?.addEventListener("mouseenter", () => setImagePasteTarget({ type: "creature-token" }));
        root.querySelector('[data-action="upload-token-image"]')?.addEventListener("focus", () => setImagePasteTarget({ type: "creature-token" }));
        root.querySelectorAll('[data-ability-action="upload-icon"]').forEach((button) => {
            const target = { type: "ability-icon", index: Number(button.dataset.abilityIndex) };
            button.addEventListener("mouseenter", () => setImagePasteTarget(target));
            button.addEventListener("focus", () => setImagePasteTarget(target));
        });
        root.querySelectorAll('[data-action="upload-condition-icon"]').forEach((button) => {
            const target = { type: "condition-icon", index: Number(button.dataset.conditionTemplateIndex) };
            button.addEventListener("mouseenter", () => setImagePasteTarget(target));
            button.addEventListener("focus", () => setImagePasteTarget(target));
        });
    }

    function setImagePasteTarget(target) {
        state.imagePasteTarget = target;
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

    function updateImageAdjustControl(field) {
        if (!state.creature) return;
        const key = field.dataset.imageAdjust;
        if (!["x", "y", "size"].includes(key)) return;

        const number = Number(field.value);
        if (!Number.isFinite(number)) return;

        const nextValue = key === "size"
            ? normalizeScale(number, 1)
            : normalizePercent(number, 50);

        state.creature.imageAdjust = {
            ...(state.creature.imageAdjust || {}),
            [key]: nextValue
        };
        state.dirty = true;

        field.value = String(nextValue);
        const image = root.querySelector('[data-action="upload-image"] img');
        if (image) image.setAttribute("style", buildImageStyle(state.creature.imageAdjust));
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
                            ${renderCompactInput("Azioni Leggendarie", "foundry.legendaryActions", foundry.legendaryActions ?? "")}
                            ${renderCompactInput("Resistenze Leggendarie", "foundry.legendaryResistances", foundry.legendaryResistances ?? "")}
                            ${renderSelect("Taglia", "foundry.size", foundry.size || "med", FOUNDRY_SIZE_OPTIONS)}
                            ${renderSelect("Caratteristica Incantesimi", "foundry.spellcastingAbility", foundry.spellcastingAbility || "cha", SPELLCASTING_ABILITY_OPTIONS)}
                        </div>
                        ${renderMovementAndSensesPanel(foundry)}
                        <div class="monster-foundry-body">
                            <div class="monster-foundry-tuning">
                                <div class="monster-score-panel">
                                    <div class="monster-subsection-title">Caratteristiche</div>
                                    <div class="monster-builder-abilities-grid">
                                        ${["str", "dex", "con", "int", "wis", "cha"].map((ability) => renderAbilityScoreStepper(ability, foundry.abilities?.[ability]?.value ?? 10)).join("")}
                                    </div>
                                </div>
                                ${renderSkillProficiencyPanel(foundry.skills || {})}
                            </div>
                            <div class="monster-foundry-defense">
                                ${renderDefensePicker(creature.details || {}, foundry)}
                            </div>
                        </div>
                        <details class="monster-builder-advanced">
                            <summary>Statistiche avanzate</summary>
                            <div class="bestiary-detail-form monster-builder-stats">
                                ${renderMonsterSuggestionPanel(foundry, suggestions)}
                                ${renderArea("Linguaggi", "foundry.languages", foundry.languages || "")}
                            </div>
                        </details>
                    </section>

                    ${renderFoundryValidation(validation)}
                </div>
                </div>

                <div class="monster-ability-workspace">

                    <section class="bestiary-detail-section monster-builder-panel">
                        <div class="monster-builder-section-title">
                            <h2>AbilitÃ  del mostro</h2>
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
                                <p class="monster-builder-empty">Trascina qui un'abilitÃ  dalla libreria a destra.</p>
                            `}
                        </div>
                    </section>

                <aside class="monster-builder-library">
                    <section class="bestiary-detail-section monster-builder-panel">
                        <div class="monster-builder-section-title">
                            <h2>Libreria abilitÃ </h2>
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
                : `<p class="monster-builder-empty">Nessuna abilitÃƒÂ  in questo filtro.</p>`}
                        </div>
                    </section>
                    <section class="bestiary-detail-section monster-builder-panel monster-builder-panel--conditions">
                        <div class="monster-builder-section-title">
                            <h2>Condizioni</h2>
                        </div>
                        <p class="monster-builder-hint">Trascinale sull'abilitÃƒÂ  attiva per aggiungere rider avanzati gestiti dal modulo Foundry.</p>
                        ${renderConditionBuilder()}
                        <div class="monster-ability-library">
                            ${getConditionTemplates().map((template, index) => renderConditionTemplateCard(template, index)).join("")}
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
                    <strong>${escapeHtml(template.name || "AbilitÃ ")}</strong>
                    <span>${escapeHtml([template.type || "feat", template.activation || ""].filter(Boolean).join(" | "))}</span>
                </div>
                <button class="monster-ability-add-btn" type="button" data-action="add-template-ability" data-ability-template-index="${index}" title="Aggiungi">
                    <i class="fas fa-plus" aria-hidden="true"></i>
                </button>
            </article>
        `;
    }

    function renderConditionTemplateCard(template, index) {
        const iconImage = template.effect?.iconImage || template.iconImage || "";
        return `
            <article class="monster-ability-template monster-condition-template" draggable="true" data-condition-template-index="${index}">
                ${iconImage
                ? `<img class="monster-ability-template-icon" src="${escapeHtml(resolveImageUrl(iconImage))}" alt="">`
                : `<i class="fas ${escapeHtml(template.icon || "fa-circle-nodes")}" aria-hidden="true"></i>`}
                <div>
                    <strong>${escapeHtml(template.name || "Condizione")}</strong>
                    <span>${escapeHtml(template.description || "")}</span>
                </div>
                <button class="monster-ability-add-btn monster-ability-add-btn--ghost" type="button" data-action="upload-condition-icon" data-condition-template-index="${index}" title="Carica icona o incolla con Ctrl+V">
                    <i class="fas fa-image" aria-hidden="true"></i>
                </button>
                <button class="monster-ability-add-btn" type="button" data-action="add-condition-template" data-condition-template-index="${index}" title="Aggiungi">
                    <i class="fas fa-plus" aria-hidden="true"></i>
                </button>
            </article>
        `;
    }

    function renderConditionBuilder() {
        const draft = state.conditionDraft || createDefaultConditionDraft();
        const preset = getConditionBuilderPreset(draft.preset);
        return `
            <details class="monster-condition-builder" ${state.conditionBuilderOpen ? "open" : ""} data-condition-builder>
                <summary>
                    <span><i class="fas fa-sliders" aria-hidden="true"></i> Nuova condizione guidata</span>
                    <small>Genera ActiveEffect comuni senza scrivere flag a mano</small>
                </summary>
                <div class="monster-condition-builder-body">
                    <label class="bestiary-detail-field">
                        <span>Nome</span>
                        <input class="bestiary-detail-input" data-condition-builder-field="name" value="${escapeHtml(draft.name || "")}" placeholder="${escapeHtml(preset.defaultName)}">
                    </label>
                    <label class="bestiary-detail-field">
                        <span>Cosa modifica</span>
                        <select class="bestiary-detail-select" data-condition-builder-field="preset">
                            ${CONDITION_BUILDER_PRESETS.map((entry) => `
                                <option value="${escapeHtml(entry.id)}" ${entry.id === draft.preset ? "selected" : ""}>${escapeHtml(entry.label)}</option>
                            `).join("")}
                        </select>
                    </label>
                    ${renderConditionBuilderTargetField(draft, preset)}
                    ${preset.requiresValue === false ? "" : `
                        <label class="bestiary-detail-field">
                            <span>${escapeHtml(preset.valueLabel || "Valore")}</span>
                            <input class="bestiary-detail-input" data-condition-builder-field="value" value="${escapeHtml(draft.value || "")}" placeholder="${escapeHtml(preset.placeholder || "")}">
                        </label>
                    `}
                    <label class="bestiary-detail-field">
                        <span>Durata</span>
                        <select class="bestiary-detail-select" data-condition-builder-field="duration">
                            ${CONDITION_BUILDER_DURATIONS.map(([value, label]) => `
                                <option value="${escapeHtml(value)}" ${value === draft.duration ? "selected" : ""}>${escapeHtml(label)}</option>
                            `).join("")}
                        </select>
                    </label>
                    <label class="bestiary-detail-field">
                        <span>Applicazione</span>
                        <select class="bestiary-detail-select" data-condition-builder-field="timing">
                            <option value="hit" ${draft.timing !== "failed-save" ? "selected" : ""}>Automatica</option>
                            <option value="failed-save" ${draft.timing === "failed-save" ? "selected" : ""}>Su fallimento TS</option>
                        </select>
                    </label>
                    <button class="bestiary-detail-action bestiary-detail-action--primary monster-condition-builder-submit" type="button" data-action="create-custom-condition-template">
                        <i class="fas fa-plus" aria-hidden="true"></i>
                        <span>Crea e aggiungi</span>
                    </button>
                </div>
            </details>
        `;
    }

    function renderConditionBuilderTargetField(draft, preset) {
        if (!preset.targets?.length) return "";
        return `
            <label class="bestiary-detail-field">
                <span>${escapeHtml(preset.targetLabel || "Campo")}</span>
                <select class="bestiary-detail-select" data-condition-builder-field="target">
                    ${preset.targets.map(([value, label]) => `
                        <option value="${escapeHtml(value)}" ${value === draft.target ? "selected" : ""}>${escapeHtml(label)}</option>
                    `).join("")}
                </select>
            </label>
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
        if (kind === "passive") return "passive";
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
        const recharge = getAbilityRechargeValue(ability);
        const summary = `${labelForAbilityKind(kind)}${ability.damageFormula ? ` | ${ability.damageFormula}` : ""}${ability.saveDc ? ` | CD ${ability.saveDc}` : ""}${recharge ? ` | Recharge ${rechargeLabel(recharge)}` : ""}`;
        return `
            <article class="monster-ability-editor ${collapsed ? "is-collapsed" : "is-active"}" data-ability-index="${index}">
                <header data-summary="${escapeHtml(summary)}">
                    ${renderAbilityIconUploadButton(ability, index)}
                    <strong>${escapeHtml(ability.name || "AbilitÃƒÂ ")}</strong>
                    <div>
                        <button class="monster-ability-icon-btn" type="button" data-ability-action="move-up" data-ability-index="${index}" title="Sposta su"><i class="fas fa-arrow-up"></i></button>
                        <button class="monster-ability-icon-btn" type="button" data-ability-action="move-down" data-ability-index="${index}" title="Sposta giÃƒÂ¹"><i class="fas fa-arrow-down"></i></button>
                        <button class="monster-ability-icon-btn monster-ability-icon-btn--danger" type="button" data-ability-action="delete" data-ability-index="${index}" title="Elimina"><i class="fas fa-trash"></i></button>
                    </div>
                </header>
                <div class="bestiary-detail-form monster-ability-body">
                    ${renderAbilityInput(index, "Nome", "name", ability.name || "", "monster-ability-name-field")}
                    ${renderAbilitySelect(index, "Metodo", "kind", kind, ABILITY_KIND_OPTIONS)}
                    ${renderAbilityArea(index, "Descrizione", "description", ability.description || "")}
                    ${renderGuidedAbilityFields(ability, index, kind)}
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
                renderAbilityTimingPanel(ability, index),
                renderAbilityInput(index, "Raggio", "range", ability.range || ""),
                renderAttackTopControls(ability, index),
                renderDamagePartsEditor(ability, index),
                renderAttackRiderEditor(ability, index)
            ].join("");
        }
        if (kind === "save") {
            applySaveAbilityDefaults(ability);
            return [
                renderAbilityTimingPanel(ability, index),
                renderSaveTopControls(ability, index),
                renderDamagePartsEditor(ability, index),
                renderSaveOutcomeEditor(ability, index)
            ].join("");
        }
        if (kind === "aura") {
            return [
                renderAbilityTimingPanel(ability, index),
                renderAbilityInput(index, "Raggio aura", "range", ability.range || ""),
                renderAbilityInput(index, "Target", "target", ability.target || "creature nell'aura"),
                renderAbilitySelect(index, "TS se serve", "saveAbility", ability.saveAbility || "", SAVE_ABILITY_OPTIONS),
                renderAbilityInput(index, "CD TS", "saveDc", ability.saveDc || calculateSpellSaveDc()),
                renderAbilityInput(index, "Danno/effetto", "damageFormula", ability.damageFormula || "")
            ].join("");
        }
        if (kind === "reaction") {
            return [
                renderAbilityTimingPanel(ability, index),
                renderAbilityInput(index, "Trigger/raggio", "range", ability.range || ""),
                renderAttackBonusPicker(ability, index),
                renderAbilityInput(index, "Danno", "damageFormula", ability.damageFormula || "")
            ].join("");
        }
        if (kind === "legendary") {
            return [
                renderAbilityInput(index, "Costo/attivazione", "activation", ability.activation || "legendary"),
                renderAbilityRechargeControls(ability, index),
                renderAbilityInput(index, "Raggio", "range", ability.range || ""),
                renderAbilityInput(index, "Danno/effetto", "damageFormula", ability.damageFormula || "")
            ].join("");
        }
        if (kind === "passive") {
            return [
                renderAbilitySelect(index, "Mostra in", "section", section || "trait", SECTION_OPTIONS),
                renderPassiveValueField(ability, index)
            ].filter(Boolean).join("");
        }
        return [
            renderAbilitySelect(index, "Mostra in", "section", section, SECTION_OPTIONS),
            renderAbilityRechargeControls(ability, index)
        ].join("");
    }

    function renderPassiveValueField(ability, index) {
        const passive = ability.passive && typeof ability.passive === "object" ? ability.passive : {};
        const label = ability.passiveValueLabel || passive.valueLabel || (ability.hasNumberParam || passive.hasNumberParam ? "Valore" : "");
        if (!label) return "";
        if (passive.id === "absorption") {
            return renderAbilitySelect(index, label, "passiveValue", ability.passiveValue || "", [["", "Scegli tipo"], ...ABILITY_DAMAGE_TYPE_OPTIONS]);
        }
        if (passive.id === "regeneration") {
            return [
                renderAbilityInput(index, label, "passiveValue", ability.passiveValue || ""),
                renderPassiveDamageTypePicker(ability, index, "Interrotta da danni")
            ].join("");
        }
        return renderAbilityInput(index, label, "passiveValue", ability.passiveValue || "");
    }

    function renderPassiveDamageTypePicker(ability, index, label) {
        const selected = new Set(normalizeDamageTypes(ability.passiveBreakDamageTypes));
        return `
            <div class="bestiary-detail-field bestiary-detail-field--wide monster-ability-control-panel">
                <span>${escapeHtml(label)}</span>
                <div class="monster-damage-type-grid" role="group" aria-label="${escapeHtml(label)}">
                    ${ABILITY_DAMAGE_TYPE_OPTIONS.map(([value, damageLabel]) => `
                        <button class="monster-choice-btn ${selected.has(value) ? "is-active" : ""}" type="button" data-ability-index="${index}" data-ability-passive-break-damage="${escapeHtml(value)}">
                            ${escapeHtml(damageLabel)}
                        </button>
                    `).join("")}
                </div>
            </div>
        `;
    }

    function renderAbilityTimingPanel(ability, index) {
        return `
            <div class="bestiary-detail-field bestiary-detail-field--wide monster-ability-control-panel monster-timing-panel">
                ${renderAbilityTurnUseControls(ability, index)}
                ${renderAbilityRechargeControls(ability, index)}
            </div>
        `;
    }

    function renderAbilityTurnUseControls(ability, index) {
        const current = ability.section || sectionFromAbilityKind(ability.kind || inferAbilityKind(ability));
        return `
            <div class="monster-timing-group monster-turn-use-panel">
                <span>Uso nel turno</span>
                <div class="monster-ability-choice-row" role="group" aria-label="Uso nel turno">
                    ${TURN_USE_OPTIONS.map(([value, label, icon]) => `
                        <button class="monster-choice-btn ${current === value ? "is-active" : ""}" type="button" data-ability-index="${index}" data-ability-choice-field="turnUse" data-ability-choice-value="${escapeHtml(value)}">
                            <i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>
                            ${escapeHtml(label)}
                        </button>
                    `).join("")}
                </div>
            </div>
        `;
    }

    function renderAbilityRechargeControls(ability, index) {
        const current = getAbilityRechargeValue(ability);
        return `
            <div class="monster-timing-group monster-recharge-panel">
                <span>Recharge d6</span>
                <div class="monster-ability-choice-row" role="group" aria-label="Recharge">
                    ${RECHARGE_OPTIONS.map(([value, label]) => `
                        <button class="monster-choice-btn ${current === value ? "is-active" : ""}" type="button" data-ability-index="${index}" data-ability-choice-field="recharge" data-ability-choice-value="${escapeHtml(value)}">
                            ${escapeHtml(label)}
                        </button>
                    `).join("")}
                </div>
            </div>
        `;
    }

    function renderAttackTopControls(ability, index) {
        const rider = getAbilityRider(ability);
        return `
            <div class="monster-attack-top-grid bestiary-detail-field--wide">
                ${renderAttackBonusPicker(ability, index)}
                <div class="monster-ability-control-panel">
                    ${renderRiderConditionButtons(index, "alwaysConditions", "Condizioni sempre", rider.alwaysConditions)}
                </div>
            </div>
        `;
    }

    function renderAttackBonusPicker(ability, index) {
        const attackAbility = ability.attackAbility || "str";
        const total = calculateAbilityAttackBonus(ability);
        return `
            <div class="bestiary-detail-field bestiary-detail-field--wide monster-ability-control-panel">
                <span>Bonus attacco</span>
                <div class="monster-ability-choice-row monster-attack-ability-row" role="group" aria-label="Caratteristica attacco">
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

    function renderSaveTopControls(ability, index) {
        const templateType = ability.targetTemplateType || "";
        return `
            <div class="monster-save-top-grid bestiary-detail-field--wide">
                <div class="monster-ability-control-panel">
                    <span>Tiro salvezza</span>
                    <div class="monster-save-main-row">
                        ${renderAbilitySelect(index, "Caratteristica", "saveAbility", ability.saveAbility || "con", SAVE_ABILITY_OPTIONS)}
                        ${renderAbilityInput(index, "CD TS", "saveDc", ability.saveDc || calculateSpellSaveDc())}
                        ${renderAbilityInput(index, "Raggio", "range", ability.range || "")}
                    </div>
                </div>
                <div class="monster-ability-control-panel">
                    <span>Template Foundry</span>
                    <div class="monster-ability-choice-row monster-template-choice-row" role="group" aria-label="Template tiro salvezza">
                        ${SAVE_TEMPLATE_OPTIONS.map(([value, label, icon]) => `
                            <button class="monster-choice-btn ${templateType === value ? "is-active" : ""}" type="button" data-ability-index="${index}" data-ability-choice-field="targetTemplateType" data-ability-choice-value="${escapeHtml(value)}">
                                <i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>
                                ${escapeHtml(label)}
                            </button>
                        `).join("")}
                    </div>
                    <div class="monster-save-template-row">
                        ${renderAbilityInput(index, "Area", "targetTemplateSize", ability.targetTemplateSize || "")}
                        ${templateType === "line" ? renderAbilityInput(index, "Larghezza", "targetTemplateWidth", ability.targetTemplateWidth || "5") : ""}
                        ${renderAbilityInput(index, "Target", "target", ability.target || "")}
                    </div>
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
                        ${renderDamageMagicToggle(part, index, partIndex, "base")}
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

    function renderAttackRiderEditor(ability, index) {
        const rider = getAbilityRider(ability);
        const summary = getAttackRiderSummary(ability, rider);
        return `
            <details class="bestiary-detail-field bestiary-detail-field--wide monster-ability-control-panel monster-attack-rider-panel monster-ability-collapsible" data-ability-rider-details data-ability-index="${index}" ${state.openRiderPanels.has(index) ? "open" : ""}>
                <summary>
                    <span>Effetti aggiuntivi</span>
                    <small>${escapeHtml(summary)}</small>
                </summary>
                <div class="monster-ability-collapsible-body">
                    <div class="monster-rider-save-row">
                        ${renderAbilityRiderSelect(index, "Tiro salvezza", "saveAbility", rider.saveAbility || "", SAVE_ABILITY_OPTIONS)}
                        ${renderAbilityRiderInput(index, "CD TS", "saveDc", rider.saveDc || calculateSpellSaveDc())}
                        ${renderSaveSuccessModeButton(index, rider.successMode)}
                    </div>
                    <div class="monster-rider-fail-section">
                        <div class="monster-rider-subtitle">Su fallimento TS</div>
                        <div class="monster-damage-parts-list">
                            ${getAbilityRiderDamageParts(ability).map((part, partIndex, parts) => renderRiderDamagePartRow(part, index, partIndex, parts.length)).join("")}
                        </div>
                        <button class="monster-helper-btn" type="button" data-ability-action="add-rider-damage-part" data-ability-index="${index}">
                            <i class="fas fa-plus" aria-hidden="true"></i>
                            Aggiungi danno su fallimento
                        </button>
                        ${renderRiderConditionButtons(index, "failConditions", "Condizioni su fallimento", rider.failConditions)}
                    </div>
                    ${renderAdvancedRiderEffects(index, rider.advancedEffects)}
                    ${renderAbilityRiderArea(index, "Nota effetto", "notes", rider.notes || "")}
                </div>
            </details>
        `;
    }

    function getAttackRiderSummary(ability, rider) {
        const parts = [];
        const failDamageCount = getAbilityRiderDamageParts(ability).filter((part) => String(part.formula || "").trim()).length;
        const failConditionCount = normalizeConditionImmunities(rider.failConditions).length;
        const advancedCount = Array.isArray(rider.advancedEffects) ? rider.advancedEffects.length : 0;

        if (rider.saveAbility || rider.saveDc || failDamageCount || failConditionCount) parts.push("TS configurato");
        if (failDamageCount) parts.push(`${failDamageCount} danni su fallimento`);
        if (failConditionCount) parts.push(`${failConditionCount} condizioni su fallimento`);
        if (advancedCount) parts.push(`${advancedCount} effetti avanzati`);

        return parts.join(" | ") || "Nessun effetto extra";
    }

    function renderAdvancedRiderEffects(index, effects) {
        const list = Array.isArray(effects) ? effects : [];
        return `
            <div class="monster-rider-advanced-effects">
                <div class="monster-rider-subtitle">Effetti avanzati</div>
                ${list.length ? `
                    <div class="monster-rider-advanced-list">
                        ${list.map((effect, effectIndex) => renderAdvancedRiderEffectRow(index, effect, effectIndex)).join("")}
                    </div>
                ` : `<p class="monster-builder-empty monster-builder-empty--compact">Nessun effetto avanzato. Trascina una condizione dalla libreria.</p>`}
            </div>
        `;
    }

    function renderAdvancedRiderEffectRow(index, effect, effectIndex) {
        const iconImage = effect?.iconImage || "";
        return `
            <div class="monster-rider-advanced-row">
                ${iconImage
                ? `<img class="monster-rider-advanced-icon" src="${escapeHtml(resolveImageUrl(iconImage))}" alt="">`
                : `<i class="fas ${escapeHtml(advancedEffectIcon(effect))}" aria-hidden="true"></i>`}
                <div class="monster-rider-advanced-copy">
                    <strong>${escapeHtml(effect?.name || "Effetto avanzato")}</strong>
                    <span>${escapeHtml(advancedEffectSummary(effect))}</span>
                </div>
                <div class="monster-rider-advanced-timing" role="group" aria-label="Quando applicare ${escapeHtml(effect?.name || "effetto avanzato")}">
                    ${renderAdvancedEffectTimingButton(index, effectIndex, effect, "hit", "Automatico")}
                    ${renderAdvancedEffectTimingButton(index, effectIndex, effect, "failed-save", "Fallimento TS")}
                </div>
                <button class="monster-ability-icon-btn monster-ability-icon-btn--danger" type="button" data-ability-action="remove-advanced-rider-effect" data-ability-index="${index}" data-advanced-effect-index="${effectIndex}" title="Rimuovi effetto avanzato">
                    <i class="fas fa-trash" aria-hidden="true"></i>
                </button>
            </div>
        `;
    }

    function renderAdvancedEffectTimingButton(index, effectIndex, effect, timing, label) {
        const current = effect?.timing || "hit";
        return `
            <button class="monster-rider-timing-btn ${current === timing ? "is-active" : ""}" type="button" data-ability-action="set-advanced-rider-timing" data-ability-index="${index}" data-advanced-effect-index="${effectIndex}" data-advanced-effect-timing="${escapeHtml(timing)}">
                ${escapeHtml(label)}
            </button>
        `;
    }

    function advancedEffectIcon(effect) {
        if (effect?.kind === "startTurnDamage") return "fa-snowflake";
        if (String(effect?.id || "").includes("ac")) return "fa-shield-halved";
        if (String(effect?.id || "").includes("speed")) return "fa-person-running";
        return "fa-circle-nodes";
    }

    function advancedEffectSummary(effect) {
        const timing = effect?.timing === "failed-save" ? "Su fallimento TS" : "Automatico";
        if (effect?.kind === "startTurnDamage") {
            return `${timing}: ${effect.damage?.formula || ""} ${effect.damage?.type || "danno"} a inizio turno${effect.endsOnDamageType ? `, termina con ${effect.endsOnDamageType}` : ""}`;
        }
        if (Array.isArray(effect?.changes) && effect.changes.length) return `${timing}: ${effect.changes.length} modifiche ActiveEffect`;
        return `${timing}: effetto avanzato gestito dal modulo`;
    }

    function renderSaveOutcomeEditor(ability, index) {
        const rider = getAbilityRider(ability);
        return `
            <div class="bestiary-detail-field bestiary-detail-field--wide monster-ability-control-panel monster-attack-rider-panel">
                <span>Esito tiro salvezza</span>
                <div class="monster-rider-save-row monster-rider-save-row--compact">
                    ${renderSaveSuccessModeButton(index, rider.successMode)}
                </div>
                ${renderRiderConditionButtons(index, "alwaysConditions", "Condizioni sempre", rider.alwaysConditions)}
                ${renderRiderConditionButtons(index, "failConditions", "Condizioni su fallimento", rider.failConditions)}
                ${renderAdvancedRiderEffects(index, rider.advancedEffects)}
                ${renderAbilityRiderArea(index, "Nota effetto", "notes", rider.notes || "")}
            </div>
        `;
    }

    function renderSaveSuccessModeButton(index, value) {
        const mode = value === "negates" ? "negates" : "half";
        const label = mode === "negates" ? "Annulla" : "Dimezza";
        const stateClass = mode === "half" ? "is-half" : mode === "negates" ? "is-negates" : "";
        return `
            <div class="monster-save-mode-field">
                <span>Se supera</span>
                <button class="monster-save-mode-btn ${stateClass}" type="button" data-ability-index="${index}" data-rider-success-mode>
                    <strong>${escapeHtml(label)}</strong>
                    <small>Click: dimezza / annulla</small>
                </button>
            </div>
        `;
    }

    function renderRiderConditionButtons(index, field, label, values) {
        const selected = new Set(normalizeConditionImmunities(values));
        return `
            <div class="monster-rider-condition-block">
                <div class="monster-rider-subtitle">${escapeHtml(label)}</div>
                <div class="monster-condition-grid monster-condition-grid--rider">
                    ${CONDITION_IMMUNITY_OPTIONS.map(([value, conditionLabel]) => `
                        <button class="monster-condition-btn ${selected.has(value) ? "is-active" : ""}" type="button" data-ability-index="${index}" data-rider-condition="${escapeHtml(value)}" data-rider-condition-field="${escapeHtml(field)}">
                            <i class="fas ${escapeHtml(conditionIcon(value))}" aria-hidden="true"></i>
                            <span>${escapeHtml(conditionLabel)}</span>
                        </button>
                    `).join("")}
                </div>
            </div>
        `;
    }

    function renderRiderDamagePartRow(part, index, partIndex, totalRows) {
        return `
            <div class="monster-damage-part-row monster-rider-damage-row">
                <label class="bestiary-detail-field">
                    <span>Danno</span>
                    <input class="bestiary-detail-input" data-ability-index="${index}" data-rider-damage-part-index="${partIndex}" data-ability-rider-damage-part-field="formula" value="${escapeHtml(part.formula || "")}" placeholder="2d6">
                </label>
                <div class="monster-damage-type-row">
                    <span>Tipo danno</span>
                    <div class="monster-damage-type-grid monster-damage-type-grid--row" role="group" aria-label="Tipo danno rider ${partIndex + 1}">
                        ${ABILITY_DAMAGE_TYPE_OPTIONS.map(([value, label]) => `
                            <button class="monster-choice-btn monster-choice-btn--damage ${part.type === value ? "is-active" : ""}" type="button" data-ability-index="${index}" data-rider-damage-part-index="${partIndex}" data-ability-rider-damage-part-type="${escapeHtml(value)}">
                                ${escapeHtml(label)}
                            </button>
                        `).join("")}
                        ${renderDamageMagicToggle(part, index, partIndex, "rider")}
                    </div>
                </div>
                ${totalRows > 1 ? `
                    <button class="monster-ability-icon-btn monster-ability-icon-btn--danger monster-damage-remove-btn" type="button" data-ability-action="remove-rider-damage-part" data-ability-index="${index}" data-rider-damage-part-index="${partIndex}" title="Rimuovi danno su fallimento">
                        <i class="fas fa-trash" aria-hidden="true"></i>
                    </button>
                ` : ""}
            </div>
        `;
    }

    function renderDamageMagicToggle(part, index, partIndex, scope) {
        const enabled = isPhysicalAbilityDamageType(part?.type);
        const checked = enabled && part?.magic === true;
        const dataset = scope === "rider"
            ? `data-ability-rider-damage-part-magic="${partIndex}"`
            : `data-ability-damage-part-magic="${partIndex}"`;
        return `
            <button class="monster-choice-btn monster-choice-btn--damage monster-choice-btn--magic ${checked ? "is-active" : ""}" type="button" data-ability-index="${index}" ${dataset} ${enabled ? "" : "disabled"} title="${enabled ? "Marca questo danno come magico" : "Disponibile solo per contundente, perforante o tagliente"}">
                Magico
            </button>
        `;
    }

    function renderAbilityRiderInput(index, label, field, value) {
        return `
            <label class="bestiary-detail-field">
                <span>${escapeHtml(label)}</span>
                <input class="bestiary-detail-input" data-ability-index="${index}" data-ability-rider-field="${escapeHtml(field)}" value="${escapeHtml(value)}">
            </label>
        `;
    }

    function renderAbilityRiderArea(index, label, field, value) {
        return `
            <label class="bestiary-detail-field bestiary-detail-field--wide">
                <span>${escapeHtml(label)}</span>
                <textarea class="bestiary-detail-area" data-ability-index="${index}" data-ability-rider-field="${escapeHtml(field)}" spellcheck="false">${escapeHtml(value)}</textarea>
            </label>
        `;
    }

    function renderAbilityRiderSelect(index, label, field, value, options) {
        return `
            <label class="bestiary-detail-field">
                <span>${escapeHtml(label)}</span>
                <select class="bestiary-detail-select" data-ability-index="${index}" data-ability-rider-field="${escapeHtml(field)}">
                    ${options.map(([optionValue, optionLabel]) => `
                        <option value="${escapeHtml(optionValue)}"${optionValue === value ? " selected" : ""}>${escapeHtml(optionLabel)}</option>
                    `).join("")}
                </select>
            </label>
        `;
    }

    function renderMonsterAbilityEditor(ability, index) {
        return `
            <article class="monster-ability-editor" data-ability-index="${index}">
                <header>
                    ${renderAbilityIconUploadButton(ability, index)}
                    <strong>${escapeHtml(ability.name || "AbilitÃ ")}</strong>
                    <div>
                        <button class="monster-ability-icon-btn" type="button" data-ability-action="move-up" data-ability-index="${index}" title="Sposta su"><i class="fas fa-arrow-up"></i></button>
                        <button class="monster-ability-icon-btn" type="button" data-ability-action="move-down" data-ability-index="${index}" title="Sposta giÃ¹"><i class="fas fa-arrow-down"></i></button>
                        <button class="monster-ability-icon-btn monster-ability-icon-btn--danger" type="button" data-ability-action="delete" data-ability-index="${index}" title="Elimina"><i class="fas fa-trash"></i></button>
                    </div>
                </header>
                <div class="bestiary-detail-form">
                    ${renderAbilityInput(index, "Nome", "name", ability.name || "")}
                    ${renderAbilitySelect(index, "Tipo item", "type", ability.type || "feat", [["feat", "Feature"], ["weapon", "Weapon"], ["spell", "Spell"]])}
                    ${renderAbilitySelect(index, "Sezione", "section", ability.section || "action", [["trait", "Tratto"], ["action", "Azione"], ["bonus", "Bonus action"], ["reaction", "Reazione"], ["legendary", "Leggendaria"]])}
                    ${renderAbilityInput(index, "Attivazione", "activation", ability.activation || "action")}
                    ${renderAbilityInput(index, "Raggio", "range", ability.range || "")}
                    ${renderAbilityInput(index, "Target", "target", ability.target || "")}
                    ${renderAbilityInput(index, "Attacco", "attackBonus", ability.attackBonus || "")}
                    ${renderAbilityInput(index, "Danno", "damageFormula", ability.damageFormula || "")}
                    ${renderAbilityInput(index, "Tipo danno", "damageType", ability.damageType || "")}
                    ${renderAbilityInput(index, "TS abilitÃ ", "saveAbility", ability.saveAbility || "")}
                    ${renderAbilityInput(index, "CD TS", "saveDc", ability.saveDc || "")}
                    ${renderAbilityArea(index, "Descrizione", "description", ability.description || "")}
                </div>
            </article>
        `;
    }

    function renderAbilityIconUploadButton(ability, index) {
        const iconImage = ability.iconImage || ability.img || "";
        const fallbackIcon = ability.icon || "fa-burst";
        return `
            <button class="monster-ability-icon-upload" type="button" data-ability-action="upload-icon" data-ability-index="${index}" title="Carica icona abilita o incolla con Ctrl+V">
                ${iconImage
                ? `<img src="${escapeHtml(resolveImageUrl(iconImage))}" alt="">`
                : `<i class="fas ${escapeHtml(fallbackIcon)}" aria-hidden="true"></i>`}
            </button>
        `;
    }

    function renderAbilityInput(index, label, field, value, extraClass = "") {
        return `
            <label class="bestiary-detail-field ${escapeHtml(extraClass)}">
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
        if (key === "turnUse") {
            ability.section = value;
            ability.activation = activationFromSection(value);
        } else {
            ability[key] = value;
        }
        if (key === "attackAbility") syncAttackBonus(ability);
        if (key === "targetTemplateType" && value === "line" && !String(ability.targetTemplateWidth || "").trim()) {
            ability.targetTemplateWidth = "5";
        }
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

    function toggleMonsterAbilityPassiveBreakDamage(button) {
        const index = Number(button.dataset.abilityIndex);
        const value = button.dataset.abilityPassiveBreakDamage || "";
        const ability = getMonsterAbilities(state.creature)[index];
        if (!ability || !value) return;
        const current = new Set(normalizeDamageTypes(ability.passiveBreakDamageTypes));
        if (current.has(value)) current.delete(value);
        else current.add(value);
        ability.passiveBreakDamageTypes = Array.from(current);
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
            type,
            magic: isPhysicalAbilityDamageType(type) ? parts[partIndex]?.magic === true : false
        };
        setAbilityDamageParts(ability, parts);
        state.dirty = true;
        render();
    }

    function toggleMonsterAbilityDamagePartMagic(button) {
        const index = Number(button.dataset.abilityIndex);
        const partIndex = Number(button.dataset.abilityDamagePartMagic);
        const ability = getMonsterAbilities(state.creature)[index];
        if (!ability || !Number.isInteger(partIndex)) return;
        const parts = getAbilityDamageParts(ability);
        const part = parts[partIndex] || {};
        if (!isPhysicalAbilityDamageType(part.type)) return;
        parts[partIndex] = {
            ...part,
            magic: part.magic !== true
        };
        setAbilityDamageParts(ability, parts);
        state.dirty = true;
        render();
    }

    function updateMonsterAbilityRiderField(field) {
        const index = Number(field.dataset.abilityIndex);
        const key = field.dataset.abilityRiderField;
        const ability = getMonsterAbilities(state.creature)[index];
        if (!ability || !key) return;
        const rider = getAbilityRider(ability);
        rider[key] = field.value;
        state.dirty = true;
    }

    function toggleMonsterAbilityRiderCondition(button) {
        const index = Number(button.dataset.abilityIndex);
        const field = button.dataset.riderConditionField;
        const condition = button.dataset.riderCondition || "";
        const ability = getMonsterAbilities(state.creature)[index];
        if (!ability || !field || !condition) return;
        state.openRiderPanels.add(index);
        const rider = getAbilityRider(ability);
        const current = new Set(normalizeConditionImmunities(rider[field]));
        if (current.has(condition)) current.delete(condition);
        else current.add(condition);
        rider[field] = Array.from(current);
        state.dirty = true;
        render();
    }

    function cycleMonsterAbilityRiderSuccessMode(button) {
        const index = Number(button.dataset.abilityIndex);
        const ability = getMonsterAbilities(state.creature)[index];
        if (!ability) return;
        state.openRiderPanels.add(index);
        const rider = getAbilityRider(ability);
        rider.successMode = rider.successMode === "negates" ? "half" : "negates";
        state.dirty = true;
        render();
    }

    function updateMonsterAbilityRiderDamagePart(field) {
        const index = Number(field.dataset.abilityIndex);
        const partIndex = Number(field.dataset.riderDamagePartIndex);
        const ability = getMonsterAbilities(state.creature)[index];
        if (!ability || !Number.isInteger(partIndex)) return;
        const parts = getAbilityRiderDamageParts(ability);
        parts[partIndex] = {
            ...(parts[partIndex] || {}),
            formula: field.value
        };
        setAbilityRiderDamageParts(ability, parts);
        state.dirty = true;
    }

    function updateMonsterAbilityRiderDamagePartType(button) {
        const index = Number(button.dataset.abilityIndex);
        const partIndex = Number(button.dataset.riderDamagePartIndex);
        const type = button.dataset.abilityRiderDamagePartType || "";
        const ability = getMonsterAbilities(state.creature)[index];
        if (!ability || !Number.isInteger(partIndex) || !type) return;
        state.openRiderPanels.add(index);
        const parts = getAbilityRiderDamageParts(ability);
        parts[partIndex] = {
            ...(parts[partIndex] || {}),
            type,
            magic: isPhysicalAbilityDamageType(type) ? parts[partIndex]?.magic === true : false
        };
        setAbilityRiderDamageParts(ability, parts);
        state.dirty = true;
        render();
    }

    function toggleMonsterAbilityRiderDamagePartMagic(button) {
        const index = Number(button.dataset.abilityIndex);
        const partIndex = Number(button.dataset.abilityRiderDamagePartMagic);
        const ability = getMonsterAbilities(state.creature)[index];
        if (!ability || !Number.isInteger(partIndex)) return;
        state.openRiderPanels.add(index);
        const parts = getAbilityRiderDamageParts(ability);
        const part = parts[partIndex] || {};
        if (!isPhysicalAbilityDamageType(part.type)) return;
        parts[partIndex] = {
            ...part,
            magic: part.magic !== true
        };
        setAbilityRiderDamageParts(ability, parts);
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
        if (action === "add-rider-damage-part") {
            state.openRiderPanels.add(index);
            const parts = getAbilityRiderDamageParts(abilities[index]);
            parts.push({ formula: "", type: "" });
            setAbilityRiderDamageParts(abilities[index], parts);
            state.dirty = true;
            render();
            return;
        }
        if (action === "remove-rider-damage-part") {
            state.openRiderPanels.add(index);
            const partIndex = Number(button.dataset.riderDamagePartIndex);
            const parts = getAbilityRiderDamageParts(abilities[index]);
            if (Number.isInteger(partIndex) && parts.length > 1) {
                parts.splice(partIndex, 1);
                setAbilityRiderDamageParts(abilities[index], parts);
                state.dirty = true;
                render();
            }
            return;
        }
        if (action === "remove-advanced-rider-effect") {
            state.openRiderPanels.add(index);
            const effectIndex = Number(button.dataset.advancedEffectIndex);
            const rider = getAbilityRider(abilities[index]);
            if (Number.isInteger(effectIndex) && Array.isArray(rider.advancedEffects) && rider.advancedEffects[effectIndex]) {
                rider.advancedEffects.splice(effectIndex, 1);
                state.dirty = true;
                render();
            }
            return;
        }
        if (action === "set-advanced-rider-timing") {
            state.openRiderPanels.add(index);
            const effectIndex = Number(button.dataset.advancedEffectIndex);
            const timing = button.dataset.advancedEffectTiming === "failed-save" ? "failed-save" : "hit";
            const rider = getAbilityRider(abilities[index]);
            if (Number.isInteger(effectIndex) && Array.isArray(rider.advancedEffects) && rider.advancedEffects[effectIndex]) {
                rider.advancedEffects[effectIndex].timing = timing;
                state.dirty = true;
                render();
            }
            return;
        }
        if (action === "delete") {
            if (!window.confirm("Eliminare questa abilitÃ  dal mostro?")) return;
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

    function addConditionTemplateToActiveAbility(index) {
        const template = getConditionTemplates()[index];
        if (!template) return;
        const abilities = getMonsterAbilities(state.creature);
        if (!abilities.length) addMonsterAbilityKind("attack");
        const targetAbility = abilities[state.activeAbilityIndex] || abilities[abilities.length - 1];
        if (!targetAbility) return;
        const rider = getAbilityRider(targetAbility);
        rider.advancedEffects.push(structuredCloneSafe(template.effect));
        state.openRiderPanels.add(state.activeAbilityIndex);
        state.dirty = true;
        render();
    }

    function getConditionTemplates() {
        return [...ADVANCED_CONDITION_TEMPLATES, ...state.customConditionTemplates];
    }

    function updateConditionBuilderField(field, options = {}) {
        const key = field.dataset.conditionBuilderField;
        if (!key) return;
        const draft = state.conditionDraft || createDefaultConditionDraft();
        draft[key] = field.value;
        if (key === "preset") {
            state.conditionBuilderOpen = true;
            const preset = getConditionBuilderPreset(field.value);
            draft.name = draft.name || preset.defaultName;
            draft.value = draft.value || preset.defaultValue || "";
            draft.target = preset.targets?.[0]?.[0] || "";
        }
        state.conditionDraft = draft;
        if (options.rerender && (key === "preset")) render();
    }

    function createCustomConditionTemplateFromBuilder() {
        const built = buildCustomConditionTemplateFromDraft(state.conditionDraft || createDefaultConditionDraft());
        if (!built.ok) {
            alert(built.error || "Condizione non valida.");
            return;
        }
        state.customConditionTemplates.push(built.template);
        const index = getConditionTemplates().length - 1;
        state.conditionDraft = createDefaultConditionDraft();
        addConditionTemplateToActiveAbility(index);
    }

    function addEmptyMonsterAbility() {
        const abilities = getMonsterAbilities(state.creature);
        const ability = createMonsterAbilityFromTemplate({
            name: "Nuova abilitÃ ",
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
            name: labels[kind] || "Nuova abilitÃƒÂ ",
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
        const name = window.prompt("Nome della nuova abilitÃ  riutilizzabile:");
        if (!name) return;
        const template = createMonsterAbilityFromTemplate({ name, icon: "fa-burst", section: "action", activation: "action" });
        state.abilityTemplates.push(template);
        const abilities = getMonsterAbilities(state.creature);
        const ability = createMonsterAbilityFromTemplate(template);
        applyAbilityDefaultsForKind(ability);
        abilities.push(ability);
        state.activeAbilityIndex = abilities.length - 1;
        saveMonsterAbilityTemplates().catch((error) => console.warn("Salvataggio libreria abilitÃ  fallito:", error));
        state.dirty = true;
        render();
    }

    function applyAbilityDefaultsForKind(ability) {
        const kind = ability.kind || inferAbilityKind(ability);
        if (kind === "attack") applyAttackAbilityDefaults(ability);
        if (kind === "save") applySaveAbilityDefaults(ability);
    }

    function applyAttackAbilityDefaults(ability) {
        ability.kind = "attack";
        ability.section ||= "action";
        ability.activation ||= activationFromSection(ability.section);
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

    function applySaveAbilityDefaults(ability) {
        ability.kind = "save";
        ability.section ||= "action";
        ability.activation ||= activationFromSection(ability.section);
        ability.type = "feat";
        ability.saveAbility ||= "con";
        if (ability.targetTemplateType === undefined) ability.targetTemplateType = "";
        if (ability.targetTemplateType === "line" && !String(ability.targetTemplateWidth || "").trim()) {
            ability.targetTemplateWidth = "5";
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
        const proficiency = getFoundryProficiency(foundry);
        const extra = Number(String(ability.attackBonusExtra || "").replace("+", "").trim() || 0);
        return formatSignedBonus(modifier + proficiency + (Number.isFinite(extra) ? extra : 0));
    }

    function calculateSpellSaveDc() {
        return calculateFoundrySpellSaveDc(ensureFoundryMonsterData(state.creature));
    }

    function getAbilityDamageParts(ability) {
        const saved = Array.isArray(ability?.damageParts) ? ability.damageParts : [];
        const normalized = saved.map((part) => ({
            formula: String(part?.formula || part?.damage || "").trim(),
            type: damageTypeValueFromLabel(part?.type || part?.damageType || ""),
            magic: part?.magic === true && isPhysicalAbilityDamageType(part?.type || part?.damageType || "")
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
                type: damageTypeValueFromLabel(part?.type || ""),
                magic: part?.magic === true && isPhysicalAbilityDamageType(part?.type || "")
            }));
        ability.damageParts = normalized.length ? normalized : [{ formula: "", type: "" }];
        ability.damageFormula = ability.damageParts[0]?.formula || "";
        ability.damageType = ability.damageParts[0]?.type || "";
        ability.damageTypes = ability.damageParts.map((part) => part.type).filter(Boolean);
    }

    function getAbilityRider(ability) {
        if (!ability.rider || typeof ability.rider !== "object") ability.rider = {};
        const rider = ability.rider;
        if (!Array.isArray(rider.alwaysConditions)) rider.alwaysConditions = normalizeConditionImmunities(rider.alwaysConditions);
        if (!Array.isArray(rider.failConditions)) rider.failConditions = normalizeConditionImmunities(rider.failConditions);
        if (!Array.isArray(rider.failDamageParts)) rider.failDamageParts = [];
        if (!Array.isArray(rider.advancedEffects)) rider.advancedEffects = [];
        rider.saveAbility ??= "";
        rider.saveDc ??= "";
        rider.successMode ??= "";
        rider.notes ??= "";
        return rider;
    }

    function getAbilityRiderDamageParts(ability) {
        const rider = getAbilityRider(ability);
        const normalized = rider.failDamageParts.map((part) => ({
            formula: String(part?.formula || part?.damage || "").trim(),
            type: damageTypeValueFromLabel(part?.type || part?.damageType || ""),
            magic: part?.magic === true && isPhysicalAbilityDamageType(part?.type || part?.damageType || "")
        }));
        return normalized.length ? normalized : [{ formula: "", type: "" }];
    }

    function setAbilityRiderDamageParts(ability, parts) {
        const rider = getAbilityRider(ability);
        rider.failDamageParts = (Array.isArray(parts) ? parts : []).map((part) => ({
            formula: String(part?.formula || "").trim(),
            type: damageTypeValueFromLabel(part?.type || ""),
            magic: part?.magic === true && isPhysicalAbilityDamageType(part?.type || "")
        }));
        if (!rider.failDamageParts.length) rider.failDamageParts = [{ formula: "", type: "" }];
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
        if (changed?.checked && changed.dataset.defenseKind) {
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
        root.querySelectorAll("[data-defense-magic]:checked").forEach((field) => {
            const value = field.dataset.defenseMagic || "";
            if (!value) return;
            ["resistances", "immunities", "vulnerabilities"].forEach((kind) => {
                if (details[kind].some((entry) => normalizeSearchKey(entry) === normalizeSearchKey(value))) {
                    details[kind].push(`${value} magico`);
                }
            });
        });
        state.dirty = true;
        render();
    }

    function toggleConditionImmunity(conditionKey) {
        if (!conditionKey) return;
        const foundry = ensureFoundryMonsterData(state.creature);
        const current = new Set(Array.isArray(foundry.conditionImmunities) ? foundry.conditionImmunities : []);
        if (current.has(conditionKey)) current.delete(conditionKey);
        else current.add(conditionKey);
        foundry.conditionImmunities = Array.from(current);
        state.dirty = true;
        render();
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

    function openImportCreatureJsonDialog() {
        const existing = document.querySelector("[data-creature-json-import-dialog]");
        if (existing) existing.remove();

        const dialog = document.createElement("div");
        dialog.className = "bestiary-import-dialog";
        dialog.dataset.creatureJsonImportDialog = "1";
        dialog.innerHTML = `
            <section class="bestiary-import-dialog-card" role="dialog" aria-modal="true" aria-label="Importa JSON mostro">
                <header>
                    <div>
                        <h2>Importa JSON mostro</h2>
                        <p>Incolla una singola creatura nel formato dell'editor. I campi attuali verranno sostituiti, poi potrai controllare e salvare.</p>
                    </div>
                    <button class="monster-ability-icon-btn" type="button" data-import-close title="Chiudi">
                        <i class="fas fa-xmark" aria-hidden="true"></i>
                    </button>
                </header>
                <textarea class="bestiary-detail-area bestiary-import-dialog-area" data-import-json-text spellcheck="false" placeholder='{"name":"Nuovo Mostro","foundry":{"abilitiesList":[]}}'></textarea>
                <div class="bestiary-import-dialog-actions">
                    <button class="bestiary-detail-action" type="button" data-import-file>
                        <i class="fas fa-folder-open" aria-hidden="true"></i>
                        <span>Da file</span>
                    </button>
                    <button class="bestiary-detail-action" type="button" data-import-cancel>Annulla</button>
                    <button class="bestiary-detail-action bestiary-detail-action--primary" type="button" data-import-submit>
                        <i class="fas fa-file-import" aria-hidden="true"></i>
                        <span>Importa</span>
                    </button>
                </div>
                <input type="file" accept="application/json,.json" data-import-json-file hidden>
            </section>
        `;

        const close = () => dialog.remove();
        const submitText = (text) => {
            if (importCreatureJsonText(text)) close();
        };

        dialog.addEventListener("click", (event) => {
            if (event.target === dialog || event.target.closest("[data-import-close]") || event.target.closest("[data-import-cancel]")) {
                close();
                return;
            }
            if (event.target.closest("[data-import-file]")) {
                dialog.querySelector("[data-import-json-file]")?.click();
                return;
            }
            if (event.target.closest("[data-import-submit]")) {
                try {
                    submitText(dialog.querySelector("[data-import-json-text]")?.value || "");
                } catch (error) {
                    alert(`Import JSON fallito: ${error?.message || error}`);
                }
            }
        });

        dialog.querySelector("[data-import-json-file]")?.addEventListener("change", async (event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            try {
                submitText(await file.text());
            } catch (error) {
                alert(`Import JSON fallito: ${error?.message || error}`);
            }
        });

        document.body.appendChild(dialog);
        dialog.querySelector("[data-import-json-text]")?.focus();
    }

    function importCreatureJsonText(text) {
        if (!String(text || "").trim()) throw new Error("Incolla o seleziona un JSON prima di importare.");
        if (state.dirty && !window.confirm("Sostituire i campi attuali con il JSON importato? Le modifiche non salvate verranno sovrascritte.")) return false;

        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Il dettaglio mostro accetta una singola creatura JSON, non un array.");
        }

        const imported = normalizeImportedCreatureForDetail(parsed);
        state.creature = imported;
        state.activeAbilityIndex = 0;
        state.openRiderPanels.clear();
        state.dirty = true;
        state.editing = true;
        editButton?.classList.add("is-editing");
        render();
        return true;
    }

    function normalizeImportedCreatureForDetail(creature) {
        const copy = structuredCloneSafe(creature);
        const fallbackId = state.creature?.id || creatureId || slugify(copy.name || "creatura-importata");
        copy.name = copy.name || "Creatura importata";
        copy.id = copy.id || fallbackId || slugify(copy.name);
        copy.image = copy.image || state.creature?.image || "media/creatures/bestiary/creatura-importata.webp";
        copy.category = copy.category || state.creature?.category || "Senza Categoria";
        if (!copy.details || typeof copy.details !== "object") copy.details = {};
        copy.details.description ??= "";
        copy.details.dndType ??= "Mostruosita";
        copy.details.size ??= "Media";
        if (!Array.isArray(copy.details.traits)) copy.details.traits = [];
        if (!Array.isArray(copy.details.drops)) copy.details.drops = [];
        ensureFoundryMonsterData(copy);
        getMonsterAbilities(copy).forEach(applyAbilityDefaultsForKind);
        return pruneCreature(copy);
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
        return uploadCreatureMedia({
            property: "image",
            folder: "creatures/bestiary",
            suffix: "",
            label: "immagine creatura"
        });
    }

    async function uploadTokenImage() {
        return uploadCreatureMedia({
            property: "tokenImage",
            folder: "creatures/bestiary/tokens",
            suffix: "-token",
            label: "immagine token"
        });
    }

    async function uploadCreatureMedia({ property, folder, suffix, label, file = null }) {
        const token = readAuthToken();
        if (!token) {
            alert("Login richiesto per caricare immagini.");
            return;
        }
        const selectedFile = file || await pickImageFile();
        if (!selectedFile || !state.creature) return;

        try {
            const blob = /\.webp$/i.test(selectedFile.name || "") ? selectedFile : await convertImageToWebp(selectedFile);
            const fileName = `${slugify(state.creature.name || creatureId || "creatura")}${suffix || ""}.webp`;
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
            state.creature[property] = payload.path || payload.key || buildCampaignMediaPath(folder, fileName);
            await persistCreatureMediaReference(property, state.creature[property]);
            state.dirty = true;
            render();
        } catch (error) {
            console.error(`Upload ${label} fallito:`, error);
            alert(`Upload fallito: ${error?.message || error}`);
        }
    }

    async function handleImagePaste(event) {
        if (!state.editing) return;
        const file = getClipboardImageFile(event);
        if (!file) return;
        const target = resolveImagePasteTarget(event);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();

        try {
            if (target.type === "creature-image") {
                await uploadCreatureMedia({
                    property: "image",
                    folder: "creatures/bestiary",
                    suffix: "",
                    label: "immagine creatura",
                    file
                });
                return;
            }
            if (target.type === "creature-token") {
                await uploadCreatureMedia({
                    property: "tokenImage",
                    folder: "creatures/bestiary/tokens",
                    suffix: "-token",
                    label: "immagine token",
                    file
                });
                return;
            }
            if (target.type === "ability-icon") {
                await uploadAbilityIcon(target.index, file);
                return;
            }
            if (target.type === "condition-icon") {
                await uploadConditionTemplateIcon(target.index, file);
            }
        } catch (error) {
            console.error("Upload immagine incollata fallito:", error);
            alert(`Upload immagine incollata fallito: ${error?.message || error}`);
        }
    }

    function resolveImagePasteTarget(event) {
        const element = event.target instanceof Element ? event.target : null;
        const abilityButton = element?.closest?.('[data-ability-action="upload-icon"]');
        if (abilityButton) return { type: "ability-icon", index: Number(abilityButton.dataset.abilityIndex) };
        const conditionButton = element?.closest?.('[data-action="upload-condition-icon"]');
        if (conditionButton) return { type: "condition-icon", index: Number(conditionButton.dataset.conditionTemplateIndex) };
        if (element?.closest?.('[data-action="upload-image"]')) return { type: "creature-image" };
        if (element?.closest?.('[data-action="upload-token-image"]')) return { type: "creature-token" };
        return state.imagePasteTarget;
    }

    function getClipboardImageFile(event) {
        const items = Array.from(event.clipboardData?.items || []);
        const imageItem = items.find((item) => item.kind === "file" && String(item.type || "").startsWith("image/"));
        const file = imageItem?.getAsFile?.();
        if (!file) return null;
        const extension = mimeExtension(file.type);
        return new File([file], `clipboard-${Date.now()}.${extension}`, { type: file.type || "image/png" });
    }

    async function persistCreatureMediaReference(property, value) {
        if (!property || !value || !state.creature) return;
        const loaded = await loadBestiaryDocument();
        const nextData = Array.isArray(loaded.data) ? loaded.data.slice() : [];
        const targetSlug = slugify(state.creature.id || state.creature.name || creatureId);
        let index = nextData.findIndex((entry) => slugify(entry?.id || entry?.name || "") === targetSlug);
        if (index < 0) index = nextData.findIndex((entry) => slugify(entry?.name || "") === creatureId);
        const baseEntry = index >= 0 ? { ...nextData[index] } : pruneCreature(structuredCloneSafe(state.creature));
        baseEntry[property] = value;
        if (index >= 0) nextData[index] = baseEntry;
        else nextData.push(baseEntry);

        const response = await fetch(getBestiaryApiUrl(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${readAuthToken()}`
            },
            body: JSON.stringify({
                data: nextData,
                expectedVersion: loaded.source === "kv" ? (loaded.version ?? 0) : 0,
                campaignId: getCampaignId()
            })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
        state.version = payload?.version ?? state.version;
        state.source = "kv";
    }

    async function uploadAbilityIcon(index, file = null) {
        const token = readAuthToken();
        if (!token) {
            alert("Login richiesto per caricare immagini.");
            return;
        }
        const abilities = getMonsterAbilities(state.creature);
        const ability = abilities[index];
        if (!ability) return;
        const selectedFile = file || await pickImageFile();
        if (!selectedFile) return;

        try {
            const blob = /\.webp$/i.test(selectedFile.name || "") ? selectedFile : await convertImageToWebp(selectedFile);
            const baseName = slugify(`${state.creature?.name || "creatura"}-${ability.name || "abilita"}`);
            const fileName = versionedWebpFileName(baseName);
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
            ability.iconImage = payload.path || payload.key || buildCampaignMediaPath(folder, fileName);
            state.dirty = true;
            render();
        } catch (error) {
            console.error("Upload icona abilita fallito:", error);
            alert(`Upload icona fallito: ${error?.message || error}`);
        }
    }

    async function uploadConditionTemplateIcon(index, file = null) {
        const token = readAuthToken();
        if (!token) {
            alert("Login richiesto per caricare immagini.");
            return;
        }
        const template = getConditionTemplates()[index];
        if (!template) return;
        const selectedFile = file || await pickImageFile();
        if (!selectedFile) return;

        try {
            const blob = /\.webp$/i.test(selectedFile.name || "") ? selectedFile : await convertImageToWebp(selectedFile);
            const baseName = slugify(`${state.creature?.name || "creatura"}-${template.name || "condizione"}`);
            const fileName = versionedWebpFileName(baseName);
            const folder = "monster-conditions";
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
            const iconImage = payload.path || payload.key || buildCampaignMediaPath(folder, fileName);
            template.iconImage = iconImage;
            template.effect = { ...(template.effect || {}), iconImage };
            getMonsterAbilities(state.creature).forEach((ability) => {
                const rider = getAbilityRider(ability);
                rider.advancedEffects.forEach((effect) => {
                    if ((effect.id || "") === template.effect.id) effect.iconImage = iconImage;
                });
            });
            state.dirty = true;
            render();
        } catch (error) {
            console.error("Upload icona condizione fallito:", error);
            alert(`Upload icona condizione fallito: ${error?.message || error}`);
        }
    }
});

async function loadBestiaryDocument() {
    try {
        if (typeof window.CriptaApp?.api?.get === "function") {
            const payload = await window.CriptaApp.api.get("api/data/bestiary", { query: { _: Date.now() } });
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

    const response = await fetch(window.CriptaApp?.urls?.data?.("bestiary.json") || "../../assets/data/bestiary.json").catch(() => null);
    if (!response?.ok) return { data: [], version: 0, source: "static" };
    const data = await response.json().catch(() => []);
    return { data: Array.isArray(data) ? data : data?.data, version: 0, source: "static" };
}

async function loadMonsterAbilityTemplates() {
    try {
        if (typeof window.CriptaApp?.api?.get === "function") {
            const payload = await window.CriptaApp.api.get("api/data/monster-abilities", { query: { _: Date.now() } });
            if (Array.isArray(payload?.data)) return mergeDefaultAbilityTemplates(payload.data);
        }
    } catch (error) {
        console.warn("KV monster-abilities non disponibile, uso template locali.", error);
    }

    const response = await fetch(window.CriptaApp?.urls?.data?.("monster-abilities.json") || "../../assets/data/monster-abilities.json").catch(() => null);
    if (response?.ok) {
        const data = await response.json().catch(() => null);
        if (Array.isArray(data)) return mergeDefaultAbilityTemplates(data);
        if (Array.isArray(data?.data)) return mergeDefaultAbilityTemplates(data.data);
    }
    return DEFAULT_MONSTER_ABILITY_TEMPLATES;
}

function mergeDefaultAbilityTemplates(templates) {
    const merged = new Map();
    DEFAULT_MONSTER_ABILITY_TEMPLATES.forEach((template) => {
        merged.set(template.id || slugify(template.name || ""), template);
    });
    (Array.isArray(templates) ? templates : []).forEach((template) => {
        const key = template?.id || slugify(template?.name || "");
        if (!key) return;
        merged.set(key, template);
    });
    return Array.from(merged.values());
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
        id: "passive-enlarge",
        name: "Enlarge",
        icon: "fa-up-right-and-down-left-from-center",
        type: "feat",
        kind: "passive",
        category: "passive",
        section: "action",
        activation: "action",
        passiveValueLabel: "Danno extra arma",
        description: "La creatura aumenta di una taglia per 1 minuto. Il buff aumenta la taglia Foundry e, se compilato, aggiunge il danno indicato agli attacchi con arma.",
        passive: { id: "enlarge", hasNumberParam: true, valueLabel: "Danno extra arma", automation: "active-effect" }
    },
    {
        id: "passive-magic-resistance",
        name: "Magic Resistance",
        icon: "fa-wand-sparkles",
        type: "feat",
        kind: "passive",
        category: "passive",
        section: "trait",
        description: "La creatura ha vantaggio ai tiri salvezza contro incantesimi e altri effetti magici.",
        passive: { id: "magic-resistance", automation: "midi-qol" }
    },
    {
        id: "passive-regeneration",
        name: "Regeneration",
        icon: "fa-heart-pulse",
        type: "feat",
        kind: "passive",
        category: "passive",
        section: "trait",
        passiveValueLabel: "PF rigenerati",
        passiveBreakDamageTypes: ["acid", "fire"],
        description: "All'inizio del proprio turno, la creatura recupera i punti ferita indicati. La rigenerazione puo essere interrotta fino al prossimo turno dai tipi di danno selezionati.",
        passive: { id: "regeneration", hasNumberParam: true, valueLabel: "PF rigenerati", automation: "custom-module" }
    },
    {
        id: "passive-undead-fortitude",
        name: "Undead Fortitude",
        icon: "fa-skull",
        type: "feat",
        kind: "passive",
        category: "passive",
        section: "trait",
        description: "Quando la creatura sarebbe ridotta a 0 punti ferita, puo invece restare a 1 punto ferita. L'effetto viene negato da danni radiosi o da altre condizioni indicate nella feature.",
        passive: { id: "undead-fortitude", automation: "custom-module" }
    },
    {
        id: "passive-absorption",
        name: "Assorbimento",
        icon: "fa-droplet",
        type: "feat",
        kind: "passive",
        category: "passive",
        section: "trait",
        passiveValueLabel: "Tipo danno assorbito",
        description: "Quando la creatura subisce il tipo di danno indicato, non subisce quel danno e recupera invece un ammontare equivalente di punti ferita.",
        passive: { id: "absorption", valueLabel: "Tipo danno assorbito", automation: "custom-module" }
    }
];

const CONDITION_BUILDER_PRESETS = [
    {
        id: "ac-bonus",
        label: "Classe Armatura",
        defaultName: "Modifica Classe Armatura",
        icon: "fa-shield-halved",
        valueLabel: "Bonus o malus",
        placeholder: "+2, -3, +1d6 o -1d6",
        defaultValue: "+2",
        build: ({ value }) => [{ key: "system.attributes.ac.bonus", mode: 2, value: normalizeSignedNumber(value), priority: 20 }]
    },
    {
        id: "ability-score",
        label: "Caratteristica",
        defaultName: "Modifica caratteristica",
        icon: "fa-dumbbell",
        targetLabel: "Caratteristica",
        targets: [
            ["str", "Forza"],
            ["dex", "Destrezza"],
            ["con", "Costituzione"],
            ["int", "Intelligenza"],
            ["wis", "Saggezza"],
            ["cha", "Carisma"]
        ],
        valueLabel: "Bonus o malus",
        placeholder: "+2, -2, +1d6 o -1d6",
        defaultValue: "+2",
        build: ({ target, value }) => [{ key: `system.abilities.${target}.value`, mode: 2, value: normalizeSignedNumber(value), priority: 20 }]
    },
    {
        id: "hp-max",
        label: "Punti ferita massimi",
        defaultName: "Modifica PF massimi",
        icon: "fa-heart-pulse",
        valueLabel: "Bonus PF",
        placeholder: "+15, -10, +1d6 o -1d6",
        defaultValue: "+10",
        build: ({ value }) => [{ key: "system.attributes.hp.max", mode: 2, value: normalizeSignedNumber(value), priority: 20 }]
    },
    {
        id: "speed-bonus",
        label: "Velocità",
        defaultName: "Modifica velocità",
        icon: "fa-person-running",
        targetLabel: "Movimento",
        targets: [
            ["all", "Tutte"],
            ["walk", "Camminare"],
            ["fly", "Volare"],
            ["swim", "Nuotare"],
            ["climb", "Scalare"],
            ["burrow", "Scavare"]
        ],
        valueLabel: "Bonus o malus",
        placeholder: "+10, -10, +1d6 o -1d6",
        defaultValue: "-10",
        build: ({ target, value }) => {
            const movements = target === "all" ? ["walk", "fly", "swim", "climb", "burrow"] : [target];
            return movements.map((movement) => ({ key: `system.attributes.movement.${movement}`, mode: 2, value: normalizeSignedNumber(value), priority: 20 }));
        }
    },
    {
        id: "damage-resistance",
        label: "Resistenza ai danni",
        defaultName: "Resistenza temporanea",
        icon: "fa-shield",
        targetLabel: "Tipo danno",
        targets: damageTypeBuilderTargets(),
        valueLabel: "Valore",
        placeholder: "automatico",
        defaultValue: "1",
        requiresValue: false,
        build: ({ target }) => [{ key: "system.traits.dr.value", mode: 0, value: target, priority: 20 }]
    },
    {
        id: "damage-immunity",
        label: "Immunità ai danni",
        defaultName: "Immunità temporanea",
        icon: "fa-shield-virus",
        targetLabel: "Tipo danno",
        targets: damageTypeBuilderTargets(),
        valueLabel: "Valore",
        placeholder: "automatico",
        defaultValue: "1",
        requiresValue: false,
        build: ({ target }) => [{ key: "system.traits.di.value", mode: 0, value: target, priority: 20 }]
    },
    {
        id: "damage-vulnerability",
        label: "Vulnerabilità ai danni",
        defaultName: "Vulnerabilità temporanea",
        icon: "fa-triangle-exclamation",
        targetLabel: "Tipo danno",
        targets: damageTypeBuilderTargets(),
        valueLabel: "Valore",
        placeholder: "automatico",
        defaultValue: "1",
        requiresValue: false,
        build: ({ target }) => [{ key: "system.traits.dv.value", mode: 0, value: target, priority: 20 }]
    },
    {
        id: "condition-immunity",
        label: "Immunità a condizione",
        defaultName: "Immunità a condizione",
        icon: "fa-user-shield",
        targetLabel: "Condizione",
        targets: conditionBuilderTargets(),
        valueLabel: "Valore",
        placeholder: "automatico",
        defaultValue: "1",
        requiresValue: false,
        build: ({ target }) => [{ key: "system.traits.ci.value", mode: 0, value: target, priority: 20 }]
    },
    {
        id: "midi-save-advantage",
        label: "Vantaggio ai tiri salvezza",
        defaultName: "Vantaggio ai tiri salvezza",
        icon: "fa-dice-d20",
        targetLabel: "Tiro salvezza",
        targets: [
            ["all", "Tutti"],
            ["str", "Forza"],
            ["dex", "Destrezza"],
            ["con", "Costituzione"],
            ["int", "Intelligenza"],
            ["wis", "Saggezza"],
            ["cha", "Carisma"]
        ],
        valueLabel: "Valore",
        placeholder: "1",
        defaultValue: "1",
        requiresValue: false,
        build: ({ target }) => [{ key: target === "all" ? "flags.midi-qol.advantage.ability.save.all" : `flags.midi-qol.advantage.ability.save.${target}`, mode: 0, value: "1", priority: 20 }]
    },
    {
        id: "midi-save-disadvantage",
        label: "Svantaggio ai tiri salvezza",
        defaultName: "Svantaggio ai tiri salvezza",
        icon: "fa-dice-d20",
        targetLabel: "Tiro salvezza",
        targets: [
            ["all", "Tutti"],
            ["str", "Forza"],
            ["dex", "Destrezza"],
            ["con", "Costituzione"],
            ["int", "Intelligenza"],
            ["wis", "Saggezza"],
            ["cha", "Carisma"]
        ],
        valueLabel: "Valore",
        placeholder: "1",
        defaultValue: "1",
        requiresValue: false,
        build: ({ target }) => [{ key: target === "all" ? "flags.midi-qol.disadvantage.ability.save.all" : `flags.midi-qol.disadvantage.ability.save.${target}`, mode: 0, value: "1", priority: 20 }]
    }
];

const CONDITION_BUILDER_DURATIONS = [
    ["", "Finche rimosso"],
    ["next-turn", "Fino al prossimo turno"],
    ["1-round", "1 round"],
    ["1-minute", "1 minuto"]
];

function createDefaultConditionDraft() {
    const preset = CONDITION_BUILDER_PRESETS[0];
    return {
        name: "",
        preset: preset.id,
        target: preset.targets?.[0]?.[0] || "",
        value: preset.defaultValue || "",
        duration: "next-turn",
        timing: "hit"
    };
}

function getConditionBuilderPreset(id) {
    return CONDITION_BUILDER_PRESETS.find((preset) => preset.id === id) || CONDITION_BUILDER_PRESETS[0];
}

function buildCustomConditionTemplateFromDraft(draft) {
    const preset = getConditionBuilderPreset(draft?.preset);
    const target = draft?.target || preset.targets?.[0]?.[0] || "";
    const value = String(draft?.value || preset.defaultValue || "").trim();
    const name = String(draft?.name || preset.defaultName || preset.label).trim();
    if (!name) return { ok: false, error: "Inserisci un nome per la condizione." };
    if (preset.targets?.length && !target) return { ok: false, error: "Scegli il campo da modificare." };
    if (preset.requiresValue !== false && !value) return { ok: false, error: "Inserisci un valore." };

    const changes = preset.build({ target, value });
    if (!changes.length) return { ok: false, error: "La condizione non genera modifiche valide." };

    const id = `custom-${slugify(name)}`;
    return {
        ok: true,
        template: {
            id,
            name,
            icon: preset.icon || "fa-sliders",
            description: conditionBuilderDescription(preset, target, value),
            effect: {
                id,
                name,
                timing: draft?.timing === "failed-save" ? "failed-save" : "hit",
                kind: "effect",
                duration: conditionBuilderDuration(draft?.duration),
                changes
            }
        }
    };
}

function conditionBuilderDescription(preset, target, value) {
    const targetLabel = preset.targets?.find(([option]) => option === target)?.[1];
    return [preset.label, targetLabel, value].filter(Boolean).join(" | ");
}

function conditionBuilderDuration(value) {
    if (value === "next-turn") return { rounds: 1, turns: 1 };
    if (value === "1-round") return { rounds: 1 };
    if (value === "1-minute") return { seconds: 60 };
    return {};
}

function normalizeSignedNumber(value) {
    const raw = String(value || "").trim();
    if (!raw) return "0";
    if (/^[+-]?\d+(\.\d+)?$/.test(raw)) return raw.startsWith("+") || raw.startsWith("-") ? raw : `+${raw}`;
    return raw;
}

function damageTypeBuilderTargets() {
    return [
        ["acid", "Acido"],
        ["bludgeoning", "Contundente"],
        ["cold", "Freddo"],
        ["fire", "Fuoco"],
        ["force", "Forza"],
        ["lightning", "Fulmine"],
        ["necrotic", "Necrotico"],
        ["piercing", "Perforante"],
        ["poison", "Veleno"],
        ["psychic", "Psichico"],
        ["radiant", "Radiante"],
        ["slashing", "Tagliente"],
        ["thunder", "Tuono"]
    ];
}

function conditionBuilderTargets() {
    return [
        ["blinded", "Accecato"],
        ["charmed", "Affascinato"],
        ["deafened", "Assordato"],
        ["frightened", "Spaventato"],
        ["grappled", "Afferrato"],
        ["incapacitated", "Incapacitato"],
        ["invisible", "Invisibile"],
        ["paralyzed", "Paralizzato"],
        ["petrified", "Pietrificato"],
        ["poisoned", "Avvelenato"],
        ["prone", "Prono"],
        ["restrained", "Trattenuto"],
        ["stunned", "Stordito"],
        ["unconscious", "Privo di sensi"],
        ["exhaustion", "Indebolimento"]
    ];
}

const ADVANCED_CONDITION_TEMPLATES = [
    {
        id: "half-speed",
        name: "Velocita dimezzata",
        icon: "fa-person-running",
        description: "Dimezza il movimento del bersaglio.",
        effect: {
            id: "half-speed",
            name: "Velocita dimezzata",
            timing: "hit",
            kind: "effect",
            changes: [
                { key: "system.attributes.movement.walk", mode: 1, value: "0.5", priority: 20 },
                { key: "system.attributes.movement.fly", mode: 1, value: "0.5", priority: 20 },
                { key: "system.attributes.movement.swim", mode: 1, value: "0.5", priority: 20 },
                { key: "system.attributes.movement.climb", mode: 1, value: "0.5", priority: 20 },
                { key: "system.attributes.movement.burrow", mode: 1, value: "0.5", priority: 20 }
            ]
        }
    },
    {
        id: "minus-3-ac-next-turn",
        name: "-3 CA fino al prossimo turno",
        icon: "fa-shield-halved",
        description: "Malus di -3 alla CA fino alla fine del prossimo turno del bersaglio.",
        effect: {
            id: "minus-3-ac-next-turn",
            name: "-3 CA",
            timing: "hit",
            kind: "effect",
            duration: { rounds: 1, turns: 1 },
            changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "-3", priority: 20 }]
        }
    },
    {
        id: "frost-dot-fire-break",
        name: "Gelo persistente",
        icon: "fa-snowflake",
        description: "1d8 gelo a inizio turno del bersaglio. Termina se subisce danni da fuoco.",
        effect: {
            id: "frost-dot-fire-break",
            name: "Gelo persistente",
            timing: "hit",
            kind: "startTurnDamage",
            damage: { formula: "1d8", type: "cold" },
            endsOnDamageType: "fire"
        }
    }
];

const SENSE_OPTIONS = [
    { value: "darkvision", label: "Scurovisione" },
    { value: "blindsight", label: "Vista cieca" },
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

const SPELLCASTING_ABILITY_OPTIONS = [
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
    { key: "slt", label: "RapiditÃ  di Mano", ability: "dex" },
    { key: "ste", label: "FurtivitÃ ", ability: "dex" },
    { key: "sur", label: "Sopravvivenza", ability: "wis" }
];

const ATTACK_ABILITY_OPTIONS = [
    ["str", "STR"],
    ["dex", "DEX"],
    ["con", "CON"],
    ["int", "INT"],
    ["wis", "WIS"],
    ["cha", "CHA"],
    ["custom", "ALTRO"]
];

const TURN_USE_OPTIONS = [
    ["action", "Azione", "fa-hand-fist"],
    ["bonus", "Azione Bonus", "fa-bolt"],
    ["reaction", "Reazione", "fa-shield-halved"],
    ["legendary", "Azione Leggendaria", "fa-crown"]
];

const RECHARGE_OPTIONS = [
    ["", "No"],
    ["6", "6"],
    ["5", "5-6"],
    ["4", "4-6"],
    ["3", "3-6"],
    ["2", "2-6"]
];

const SAVE_TEMPLATE_OPTIONS = [
    ["", "Nessuno", "fa-crosshairs"],
    ["line", "Linea", "fa-grip-lines"],
    ["circle", "Sfera", "fa-circle"],
    ["cube", "Cubo", "fa-cube"],
    ["cone", "Cono", "fa-play"]
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

const PHYSICAL_ABILITY_DAMAGE_TYPES = new Set(["bludgeoning", "piercing", "slashing"]);

const ABILITY_FILTERS = [
    ["all", "Tutte"],
    ["attack", "Attacchi"],
    ["passive", "Passive"],
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

const CONDITION_IMMUNITY_OPTIONS = [
    ["blinded", "Accecato"],
    ["charmed", "Affascinato"],
    ["deafened", "Assordato"],
    ["frightened", "Spaventato"],
    ["grappled", "Afferrato"],
    ["incapacitated", "Incapacitato"],
    ["invisible", "Invisibile"],
    ["paralyzed", "Paralizzato"],
    ["petrified", "Pietrificato"],
    ["poisoned", "Avvelenato"],
    ["prone", "Prono"],
    ["restrained", "Trattenuto"],
    ["stunned", "Stordito"],
    ["unconscious", "Privo di sensi"],
    ["exhaustion", "Indebolimento"]
];

const DAMAGE_TYPE_OPTIONS = [
    { value: "Acido", label: "Acido" },
    { value: "Freddo", label: "Freddo" },
    { value: "Fuoco", label: "Fuoco" },
    { value: "Forza", label: "Forza" },
    { value: "Fulmine", label: "Fulmine" },
    { value: "Necrotico", label: "Necrotico" },
    { value: "Psichico", label: "Psichico" },
    { value: "Radiante", label: "Radiante" },
    { value: "Tuono", label: "Tuono" },
    { value: "Veleno", label: "Veleno" },
    { value: "Contundente", label: "Contundente", physical: true },
    { value: "Tagliente", label: "Tagliente", physical: true },
    { value: "Perforante", label: "Perforante", physical: true }
];

function ensureFoundryMonsterData(creature) {
    if (!creature.foundry || typeof creature.foundry !== "object") creature.foundry = {};
    const foundry = creature.foundry;
    foundry.ac ??= "";
    foundry.hp ??= { value: "", formula: "" };
    foundry.movement ??= { walk: 30, fly: "", swim: "", climb: "" };
    foundry.cr ??= "";
    foundry.legendaryActions ??= "";
    foundry.legendaryResistances ??= "";
    foundry.role ??= "standard";
    foundry.size ??= mapWikiSizeToFoundry(creature.details?.size);
    foundry.senses ??= "";
    foundry.languages ??= "";
    foundry.skills ??= {};
    foundry.spellcastingAbility ??= "cha";
    if (!Array.isArray(foundry.conditionImmunities)) foundry.conditionImmunities = [];
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
    copy.name = copy.name || "AbilitÃ ";
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
        type: damageTypeValueFromLabel(part?.type || part?.damageType || ""),
        magic: part?.magic === true && isPhysicalAbilityDamageType(part?.type || part?.damageType || "")
    }));
    if (saved.length) return normalized.length ? normalized : [{ formula: "", type: "" }];
    const legacyTypes = parseAbilityDamageTypes(ability);
    if (ability?.damageFormula || legacyTypes.length) {
        return [{ formula: ability.damageFormula || "", type: legacyTypes[0] || "" }];
    }
    return [{ formula: "", type: "" }];
}

function getAbilityRider(ability) {
    if (!ability.rider || typeof ability.rider !== "object") ability.rider = {};
    const rider = ability.rider;
    if (!Array.isArray(rider.alwaysConditions)) rider.alwaysConditions = normalizeConditionImmunities(rider.alwaysConditions);
    if (!Array.isArray(rider.failConditions)) rider.failConditions = normalizeConditionImmunities(rider.failConditions);
    if (!Array.isArray(rider.failDamageParts)) rider.failDamageParts = [];
    if (!Array.isArray(rider.advancedEffects)) rider.advancedEffects = [];
    rider.saveAbility ??= "";
    rider.saveDc ??= "";
    rider.successMode ??= "";
    rider.notes ??= "";
    return rider;
}

function getAbilityRiderDamageParts(ability) {
    const rider = getAbilityRider(ability);
    const normalized = rider.failDamageParts.map((part) => ({
        formula: String(part?.formula || part?.damage || "").trim(),
        type: damageTypeValueFromLabel(part?.type || part?.damageType || ""),
        magic: part?.magic === true && isPhysicalAbilityDamageType(part?.type || part?.damageType || "")
    }));
    return normalized.length ? normalized : [{ formula: "", type: "" }];
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

function isPhysicalAbilityDamageType(value) {
    return PHYSICAL_ABILITY_DAMAGE_TYPES.has(damageTypeValueFromLabel(value));
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
    if (!creature.image) warnings.push("manca l'immagine avatar");
    if (!creature.tokenImage && !creature.image) warnings.push("manca l'immagine del token");
    if (!foundry.ac) errors.push("manca la Classe Armatura");
    if (!foundry.hp?.value && !foundry.hp?.formula) errors.push("mancano i Punti Ferita");
    if (!foundry.cr) warnings.push("manca il Grado Sfida");
    if (!abilities.length) warnings.push("nessuna abilita configurata");
    abilities.forEach((ability, index) => {
        const label = ability.name || `abilita ${index + 1}`;
        const kind = ability.kind || inferAbilityKind(ability);
        if (!ability.description) warnings.push(`${label}: descrizione vuota`);
        if (kind === "attack" && !ability.attackBonus) warnings.push(`${label}: attacco senza bonus`);
        if (kind === "attack" && getAbilityDamageParts(ability).some((part) => part.formula && !part.type)) warnings.push(`${label}: danno senza tipo`);
        if ((kind === "save" || kind === "aura") && ability.saveAbility && !ability.saveDc) warnings.push(`${label}: TS senza CD`);
        if (kind === "save" && ability.targetTemplateType && !String(ability.targetTemplateSize || ability.range || "").trim()) warnings.push(`${label}: template senza dimensione area`);
    });
    return { errors, warnings };
}

function buildMonsterSuggestions(foundry) {
    const cr = parseCrValue(foundry.cr);
    const role = foundry.role || "standard";
    const size = foundry.size || "med";
    const baseProf = getFoundryProficiency(foundry);
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
    const damageAbsorptions = getFoundryPassiveAbsorptions(abilities);
    const damageAbsorptionSet = new Set(damageAbsorptions);
    const damageImmunities = Array.from(new Set([
        ...normalizeDamageTypes(creature.details?.immunities),
        ...damageAbsorptions
    ]));
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
                prof: getFoundryProficiency(foundry)
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
                di: { value: damageImmunities, custom: "" },
                dr: { value: normalizeDamageTypes(creature.details?.resistances).filter((type) => !damageAbsorptionSet.has(type)), custom: "" },
                dv: { value: normalizeDamageTypes(creature.details?.vulnerabilities).filter((type) => !damageAbsorptionSet.has(type)), custom: "" },
                da: { value: [], custom: "", bypasses: [] },
                ci: { value: normalizeConditionImmunities(foundry.conditionImmunities), custom: "" }
            },
            resources: {
                legact: buildFoundryResource(foundry.legendaryActions),
                legres: buildFoundryResource(foundry.legendaryResistances)
            },
            skills: normalizeFoundrySkills(foundry.skills)
        },
        prototypeToken: {
            name: creature.name || "Creatura",
            displayName: 20,
            displayBars: 20,
            width: tokenSizeForFoundrySize(foundry.size),
            height: tokenSizeForFoundrySize(foundry.size),
            texture: { src: resolveImageUrl(creature.tokenImage || creature.image) },
            actorLink: false
        },
        items: abilities.map((ability) => buildFoundryItemFromAbilityV4(ability, foundry)),
        effects: [],
        flags: buildFoundryActorFlags(foundry.flags, damageAbsorptions)
    };
}

function getFoundryPassiveAbsorptions(abilities) {
    return (Array.isArray(abilities) ? abilities : [])
        .map((ability) => buildFoundryWikiPassiveFlags(ability))
        .filter((passive) => passive.enabled && passive.id === "absorption" && passive.value)
        .map((passive) => passive.value)
        .filter((value, index, list) => list.indexOf(value) === index);
}

function buildFoundryActorFlags(flags = {}, damageAbsorptions = []) {
    const wikiFlags = flags["cripta-wiki-sync"] && typeof flags["cripta-wiki-sync"] === "object"
        ? flags["cripta-wiki-sync"]
        : {};
    return {
        ...flags,
        "cripta-wiki-sync": {
            ...wikiFlags,
            damageAbsorptions
        }
    };
}

function buildFoundryItemFromAbilityV4(ability, foundry = {}) {
    const type = foundryItemTypeForAbility(ability);
    const rider = getAbilityRider(ability);
    const effects = buildFoundryPassiveEffects(ability, foundry);
    const system = {
        description: { value: buildFoundryAbilityDescription(ability, foundry), chat: "" },
        source: { custom: "Sigillo del Male Wiki", revision: 1, rules: "2024" },
        uses: buildFoundryItemUses(ability),
        activities: buildFoundryActivitiesForAbility(ability, foundry, type, effects),
        identifier: "",
        requirements: "",
        type: foundryItemSubtypeForAbility(ability, type)
    };

    if (type === "weapon") {
        const damageParts = getAbilityDamageParts(ability).filter((part) => part.formula);
        system.quantity = 1;
        system.weight = { value: 0, units: "lb" };
        system.price = { value: 0, denomination: "gp" };
        system.attunement = "";
        system.equipped = true;
        system.rarity = "";
        system.identified = true;
        system.range = buildFoundryWeaponRange(ability);
        system.damage = {
            base: damageFormulaToDnd5ePart(
                damageParts[0]?.formula || ability.damageFormula || "",
                damageParts[0]?.type || getPrimaryAbilityDamageType(ability),
                shouldStripAbilityDamageBonus(ability)
            ),
            versatile: {
                number: null,
                denomination: null,
                types: [],
                custom: { enabled: false },
                scaling: { number: 1 }
            }
        };
        system.unidentified = { description: "" };
        system.container = null;
        system.attuned = false;
        system.cover = null;
        system.crewed = false;
        system.ammunition = {};
        system.armor = { value: null };
        system.magicalBonus = null;
        system.properties = hasMagicalAbilityDamage(ability) ? ["mgc"] : [];
        system.proficient = true;
        system.weaponType = "natural";
        system.actionType = inferActionType(ability);
        system.attackBonus = ability.attackBonus || "";
    } else {
        system.activation = { type: ability.activation || activationFromSection(ability.section), cost: 1, condition: "" };
        system.target = { value: null, width: null, units: "", type: ability.target || "" };
        system.range = { value: parseRangeValue(ability.range), long: null, units: parseRangeUnits(ability.range) };
        system.consume = { type: "", target: "", amount: null };
        system.actionType = inferActionType(ability);
        system.attackBonus = ability.attackBonus || "";
        system.damage = {
            parts: buildFoundryDamageParts(ability),
            versatile: ""
        };
        system.save = {
            ability: ability.saveAbility || rider.saveAbility || "",
            dc: toNumberOrNull(ability.saveDc || rider.saveDc || calculateFoundrySpellSaveDc(foundry)),
            scaling: "flat"
        };
        system.advancement = [];
        system.cover = null;
        system.crewed = false;
        system.enchant = {};
        system.prerequisites = { level: null, repeatable: false };
        system.properties = [];
    }

    return {
        name: ability.name || "Abilita",
        type,
        img: ability.iconImage ? resolveImageUrl(ability.iconImage) : foundryIconFromFa(ability.icon),
        system,
        effects,
        flags: {
            "midi-qol": {},
            dae: {},
            dnd5e: { persistSourceMigration: true },
            "cripta-wiki-sync": {
                riders: buildFoundryWikiRiderFlags(ability),
                passive: buildFoundryWikiPassiveFlags(ability)
            },
            ...(ability.flags || {})
        }
    };
}

function buildFoundryWikiPassiveFlags(ability) {
    const passive = ability.passive && typeof ability.passive === "object" ? ability.passive : {};
    const id = String(passive.id || "").trim();
    if (!id) return { enabled: false };
    return {
        enabled: true,
        id,
        automation: passive.automation || "manual",
        value: String(ability.passiveValue || "").trim(),
        valueLabel: ability.passiveValueLabel || passive.valueLabel || "",
        breakDamageTypes: normalizeDamageTypes(ability.passiveBreakDamageTypes)
    };
}

function buildFoundryPassiveEffects(ability, foundry = {}) {
    const passive = buildFoundryWikiPassiveFlags(ability);
    if (!passive.enabled) return [];
    if (passive.id === "magic-resistance") {
        return [buildFoundryTransferEffect("Magic Resistance", "icons/magic/defensive/shield-barrier-glowing-blue.webp", [
            {
                key: "flags.midi-qol.magicResistance.all",
                mode: 0,
                value: "1",
                priority: 20
            }
        ])];
    }
    if (passive.id === "enlarge") {
        const changes = [
            {
                key: "system.traits.size",
                mode: 5,
                value: nextFoundrySize(foundry.size),
                priority: 20
            }
        ];
        if (passive.value) {
            changes.push(
                { key: "system.bonuses.mwak.damage", mode: 2, value: passive.value, priority: 20 },
                { key: "system.bonuses.rwak.damage", mode: 2, value: passive.value, priority: 20 }
            );
        }
        return [buildFoundryTemporaryEffect("Enlarge", "icons/magic/control/buff-strength-muscle-damage.webp", changes, {
            seconds: 60,
            rounds: 10
        })];
    }
    if (passive.id === "absorption" && passive.value) {
        return [];
    }
    return [];
}

function nextFoundrySize(size) {
    const order = ["tiny", "sm", "med", "lg", "huge", "grg"];
    const index = order.indexOf(size || "med");
    return order[Math.min(order.length - 1, Math.max(0, index) + 1)] || "lg";
}

function buildFoundryTemporaryEffect(name, img, changes, duration = {}) {
    return {
        ...buildFoundryTransferEffect(name, img, changes),
        transfer: false,
        duration: {
            startTime: null,
            seconds: duration.seconds ?? null,
            combat: null,
            rounds: duration.rounds ?? null,
            turns: duration.turns ?? null,
            startRound: null,
            startTurn: null
        }
    };
}

function buildFoundryTransferEffect(name, img, changes) {
    return {
        _id: `effect${slugify(name).replace(/-/g, "").slice(0, 10).padEnd(10, "0")}`,
        name,
        img,
        origin: null,
        disabled: false,
        transfer: true,
        description: "",
        tint: "#ffffff",
        statuses: [],
        changes,
        duration: { startTime: null, seconds: null, combat: null, rounds: null, turns: null, startRound: null, startTurn: null },
        flags: {
            dae: { showIcon: true, specialDuration: [] },
            "midi-qol": {},
            core: { overlay: false }
        },
        type: "base",
        system: {},
        sort: 0
    };
}

function buildFoundryWikiRiderFlags(ability) {
    const rider = getAbilityRider(ability);
    return {
        enabled: true,
        alwaysConditions: normalizeConditionImmunities(rider.alwaysConditions),
        failConditions: normalizeConditionImmunities(rider.failConditions),
        saveAbility: rider.saveAbility || "",
        saveDc: rider.saveDc || "",
        successMode: rider.successMode === "negates" ? "negates" : "half",
        failDamageParts: getAbilityRiderDamageParts(ability).filter((part) => part.formula),
        advancedEffects: normalizeAdvancedRiderEffects(rider.advancedEffects),
        notes: rider.notes || ""
    };
}

function normalizeAdvancedRiderEffects(effects) {
    return (Array.isArray(effects) ? effects : [])
        .map((effect) => ({
            id: slugify(effect?.id || effect?.name || "advanced-effect"),
            name: String(effect?.name || "Effetto avanzato"),
            timing: normalizeAdvancedEffectTiming(effect?.timing),
            kind: String(effect?.kind || "effect"),
            iconImage: effect?.iconImage || "",
            duration: effect?.duration || {},
            changes: normalizeAdvancedEffectChanges(effect),
            damage: effect?.damage || null,
            endsOnDamageType: effect?.endsOnDamageType || ""
        }));
}

function normalizeAdvancedEffectTiming(value) {
    const timing = String(value || "hit");
    return timing === "failedSave" || timing === "failed-save" ? "failed-save" : "hit";
}

function normalizeAdvancedEffectChanges(effect) {
    const id = String(effect?.id || "");
    return (Array.isArray(effect?.changes) ? effect.changes : []).map((change) => {
        const normalized = { ...change };
        const key = String(normalized.key || "");
        if (id === "half-speed" && key.startsWith("system.attributes.movement.") && String(normalized.value) === "0.5") {
            normalized.mode = 1;
        }
        return normalized;
    });
}

function buildFoundryItemFromAbility(ability, foundry = {}) {
    const type = foundryItemTypeForAbility(ability);
    const rider = getAbilityRider(ability);
    const description = buildFoundryAbilityDescription(ability, foundry);
    const item = {
        name: ability.name || "AbilitÃ ",
        type,
        img: ability.iconImage ? resolveImageUrl(ability.iconImage) : foundryIconFromFa(ability.icon),
        system: {
            description: { value: description, chat: "" },
            activation: { type: ability.activation || activationFromSection(ability.section), cost: 1, condition: "" },
            target: { value: null, width: null, units: "", type: ability.target || "" },
            range: { value: parseRangeValue(ability.range), long: null, units: parseRangeUnits(ability.range) },
            uses: buildFoundryItemUses(ability),
            consume: { type: "", target: "", amount: null },
            actionType: inferActionType(ability),
            attackBonus: ability.attackBonus || "",
            damage: {
                parts: buildFoundryDamageParts(ability),
                versatile: ""
            },
            save: {
                ability: ability.saveAbility || rider.saveAbility || "",
                dc: toNumberOrNull(ability.saveDc || rider.saveDc || calculateFoundrySpellSaveDc(foundry)),
                scaling: "flat"
            },
            type: foundryItemSubtypeForAbility(ability, type),
            requirements: "",
            recharge: buildFoundryRecharge(ability)
        },
        effects: [],
        flags: ability.flags || {}
    };
    if (type === "weapon") {
        item.system.equipped = true;
        item.system.proficient = true;
        item.system.weaponType = "natural";
        item.system.properties = hasMagicalAbilityDamage(ability) ? ["mgc"] : [];
    }
    return item;
}

function foundryItemTypeForAbility(ability) {
    if (isAttackAbility(ability)) return "weapon";
    if ((ability.kind || inferAbilityKind(ability)) === "save") return "feat";
    return ability.type || "feat";
}

function foundryItemSubtypeForAbility(ability, itemType) {
    if (itemType === "weapon") return { value: "natural", baseItem: "" };
    return { value: "", subtype: "" };
}

function buildFoundryDamageParts(ability) {
    const parts = getAbilityDamageParts(ability)
        .filter((part) => part.formula)
        .map((part) => [part.formula, part.type || ""]);
    if (parts.length) return parts;
    return ability.damageFormula ? [[ability.damageFormula, getPrimaryAbilityDamageType(ability)]] : [];
}

function hasMagicalAbilityDamage(ability) {
    const allParts = [
        ...getAbilityDamageParts(ability),
        ...getAbilityRiderDamageParts(ability)
    ];
    return allParts.some((part) => part?.magic === true && isPhysicalAbilityDamageType(part.type));
}

function buildFoundryActivitiesForAbility(ability, foundry, itemType, effects) {
    if (itemType === "weapon") {
        const activities = { dnd5eactivity000: buildFoundryAttackActivity(ability, effects) };
        if (hasAbilitySaveRider(ability)) activities.dnd5eactivity001 = buildFoundrySaveActivity(ability, foundry, effects, "dnd5eactivity001", { includeBaseDamage: false });
        return activities;
    }
    if (ability.saveAbility || getAbilityRider(ability).saveAbility) return { dnd5eactivity000: buildFoundrySaveActivity(ability, foundry, effects) };
    return { dnd5eactivity000: buildFoundryUtilityActivity(ability, effects) };
}

function buildFoundryAttackActivity(ability, effects) {
    const ranged = isRangedAttackAbility(ability);
    const attackAbility = ability.attackAbility === "custom" ? "" : (ability.attackAbility || "str");
    const damageParts = getAbilityDamageParts(ability).filter((part) => part.formula);
    return {
        _id: "dnd5eactivity000",
        type: "attack",
        activation: buildFoundryActivityActivation(ability),
        consumption: buildFoundryActivityConsumption(ability),
        description: { chatFlavor: "" },
        duration: buildFoundryInstantDuration(),
        effects: [],
        range: { units: ranged ? "ft" : "self", special: "", override: false, ...(ranged ? { value: parseRangeValue(ability.range) || "" } : {}) },
        target: buildFoundrySingleCreatureTarget(),
        uses: { spent: 0, max: "", recovery: [] },
        attack: {
            ability: attackAbility,
            bonus: ability.attackAbility === "custom" ? (ability.attackBonus || "") : (ability.attackBonusExtra || ""),
            critical: { threshold: null },
            flat: ability.attackAbility === "custom",
            type: { value: ranged ? "ranged" : "melee", classification: "weapon" }
        },
        damage: {
            critical: { bonus: "" },
            includeBase: true,
            parts: damageParts.slice(1).map((part) => damageFormulaToDnd5ePart(part.formula, part.type, false))
        },
        sort: 0,
        ...foundryMidiActivityDefaults(),
        attackMode: "oneHanded",
        ammunition: "",
        otherActivityUuid: ""
    };
}

function buildFoundrySaveActivity(ability, foundry, effects, activityId = "dnd5eactivity000", options = {}) {
    const rider = getAbilityRider(ability);
    const damageParts = [
        ...(options.includeBaseDamage === false ? [] : getAbilityDamageParts(ability).filter((part) => part.formula)),
        ...getAbilityRiderDamageParts(ability).filter((part) => part.formula)
    ];
    return {
        _id: activityId,
        type: "save",
        activation: buildFoundryActivityActivation(ability),
        consumption: buildFoundryActivityConsumption(ability),
        description: { chatFlavor: "" },
        duration: buildFoundryInstantDuration(),
        effects: buildFoundrySaveActivityEffectRefs(effects),
        range: { value: parseRangeValue(ability.range) || "", units: parseRangeUnits(ability.range) || "ft", special: "", override: false },
        target: buildFoundryTargetForAbility(ability),
        uses: { spent: 0, max: "", recovery: [] },
        damage: {
            onSave: rider.successMode === "negates" ? "none" : "half",
            parts: damageParts.map((part) => damageFormulaToDnd5ePart(part.formula, part.type, false)),
            critical: { allow: false }
        },
        save: {
            ability: [ability.saveAbility || rider.saveAbility || "con"],
            dc: { calculation: "", formula: String(ability.saveDc || rider.saveDc || calculateFoundrySpellSaveDc(foundry)) }
        },
        sort: 0,
        ...foundryMidiActivityDefaults()
    };
}

function hasAbilitySaveRider(ability) {
    const rider = getAbilityRider(ability);
    return Boolean(
        rider.saveAbility
        || rider.saveDc
        || getAbilityRiderDamageParts(ability).some((part) => part.formula)
        || normalizeConditionImmunities(rider.failConditions).length
    );
}

function buildFoundryUtilityActivity(ability, effects) {
    return {
        _id: "dnd5eactivity000",
        type: "utility",
        activation: buildFoundryActivityActivation(ability),
        consumption: buildFoundryActivityConsumption(ability),
        description: { chatFlavor: "" },
        duration: buildFoundryInstantDuration(),
        effects: effects.map((effect) => ({ _id: effect._id })),
        range: { units: "self", special: "", override: false },
        target: buildFoundrySingleCreatureTarget(),
        uses: { spent: 0, max: "", recovery: [] },
        roll: { formula: "", name: "", prompt: false, visible: false },
        sort: 0,
        ...foundryMidiActivityDefaults(),
        otherActivityId: "none"
    };
}

function buildFoundrySaveActivityEffectRefs(effects) {
    return [];
}

function buildFoundryActivityActivation(ability) {
    const recharge = getAbilityRechargeValue(ability);
    return {
        type: ability.activation || activationFromSection(ability.section),
        value: 1,
        condition: recharge ? `Recharge ${rechargeLabel(recharge)}` : "",
        override: false
    };
}

function buildFoundryActivityConsumption(ability) {
    const recharge = getAbilityRechargeValue(ability);
    return {
        targets: recharge ? [{
            type: "itemUses",
            target: "",
            value: "1",
            scaling: { mode: "", formula: "" }
        }] : [],
        scaling: { allowed: false, max: "" },
        spellSlot: true
    };
}

function buildFoundryInstantDuration() {
    return {
        concentration: false,
        units: "inst",
        special: "",
        override: false
    };
}

function buildFoundrySingleCreatureTarget() {
    return {
        template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
        affects: { count: "1", type: "creature", choice: false, special: "" },
        prompt: true,
        override: false
    };
}

function buildFoundryTargetForAbility(ability) {
    const templateType = String(ability?.targetTemplateType || "").trim();
    if (!templateType) return buildFoundrySingleCreatureTarget();
    const size = parseRangeValue(ability.targetTemplateSize) || parseRangeValue(ability.range) || "";
    const width = templateType === "line" ? (parseRangeValue(ability.targetTemplateWidth) || 5) : "";
    return {
        template: {
            count: "",
            contiguous: false,
            type: templateType,
            size,
            width,
            height: "",
            units: parseRangeUnits(ability.targetTemplateSize || ability.range) || "ft"
        },
        affects: {
            count: "",
            type: "creature",
            choice: false,
            special: ability.target || ""
        },
        prompt: true,
        override: false
    };
}

function foundryMidiActivityDefaults() {
    return {
        useConditionText: "",
        useConditionReason: "",
        effectConditionText: "",
        macroData: { name: "", command: "" },
        ignoreTraits: { idi: false, idr: false, idv: false, ida: false },
        midiProperties: {
            ignoreTraits: [],
            triggeredActivityId: "none",
            triggeredActivityConditionText: "",
            triggeredActivityTargets: "targets",
            triggeredActivityRollAs: "self",
            forceDialog: false,
            confirmTargets: "default",
            autoTargetType: "any",
            autoTargetAction: "default",
            automationOnly: false,
            otherActivityCompatible: true,
            identifier: "",
            displayActivityName: false,
            rollMode: "default",
            chooseEffects: false,
            toggleEffect: false,
            ignoreFullCover: false
        },
        isOverTimeFlag: false,
        overTimeProperties: { saveRemoves: true, preRemoveConditionText: "", postRemoveConditionText: "" },
        otherActivityId: ""
    };
}

function buildFoundryItemEffectsForAbility(ability) {
    const rider = getAbilityRider(ability);
    const effects = [];
    const always = normalizeConditionImmunities(rider.alwaysConditions);
    always.forEach((condition) => {
        effects.push({ ...buildFoundryConditionEffect(`${ability.name || "Attacco"} ${conditionLabel(condition)}`, [condition], "Applied on hit."), _applyOn: "hit" });
    });
    const failed = normalizeConditionImmunities(rider.failConditions);
    failed.forEach((condition) => {
        effects.push({ ...buildFoundryConditionEffect(`${ability.name || "Effetto"} ${conditionLabel(condition)}`, [condition], "Applied on a failed save."), _applyOn: "failedSave" });
    });
    return effects.map((effect, index) => ({ ...effect, _id: `effect${String(index + 1).padStart(10, "0")}` }));
}

function stripFoundryInternalEffectMeta(effect) {
    const { _applyOn, ...cleanEffect } = effect;
    return cleanEffect;
}

function buildFoundryConditionEffect(name, statuses, description) {
    return {
        name,
        img: foundryEffectIconForConditions(statuses),
        origin: null,
        disabled: false,
        transfer: false,
        description,
        tint: "#ffffff",
        statuses,
        changes: buildFoundryConditionChanges(statuses),
        duration: {
            startTime: null,
            seconds: null,
            combat: null,
            rounds: null,
            turns: null,
            startRound: null,
            startTurn: null
        },
        flags: { dae: {}, "midi-qol": {} },
        type: "base",
        system: {},
        sort: 0
    };
}

function buildFoundryConditionChanges(statuses) {
    if (!statuses.includes("grappled")) return [];
    return ["walk", "fly", "swim", "climb", "burrow"].map((movement) => ({
        key: `system.attributes.movement.${movement}`,
        mode: 5,
        value: "0",
        priority: 20
    }));
}

function foundryEffectIconForConditions(statuses) {
    if (statuses.includes("grappled") || statuses.includes("restrained")) return "icons/svg/net.svg";
    if (statuses.includes("prone")) return "icons/svg/falling.svg";
    if (statuses.includes("poisoned")) return "icons/svg/poison.svg";
    if (statuses.includes("frightened")) return "icons/svg/terror.svg";
    return "icons/svg/aura.svg";
}

function damageFormulaToDnd5ePart(formula, type, stripStaticBonus = false) {
    const cleanFormula = String(formula || "").trim();
    const match = cleanFormula.match(/^(\d+)d(\d+)\s*([+-]\s*\d+)?$/i);
    if (match) {
        return {
            number: Number(match[1]),
            denomination: Number(match[2]),
            bonus: stripStaticBonus ? "" : (match[3] ? match[3].replace(/\s+/g, "") : ""),
            types: type ? [type] : [],
            custom: { enabled: false, formula: "" },
            scaling: { mode: "whole", number: null, formula: "" }
        };
    }
    return {
        number: null,
        denomination: null,
        bonus: "",
        types: type ? [type] : [],
        custom: { enabled: Boolean(cleanFormula), formula: cleanFormula },
        scaling: { mode: "whole", number: null, formula: "" }
    };
}

function shouldStripAbilityDamageBonus(ability) {
    return isAttackAbility(ability) && ability.attackAbility !== "custom";
}

function buildFoundryWeaponRange(ability) {
    if (isRangedAttackAbility(ability)) {
        return { value: parseRangeValue(ability.range), long: null, units: parseRangeUnits(ability.range) || "ft" };
    }
    return { value: null, long: null, units: "self", reach: parseRangeValue(ability.range) || 5 };
}

function calculateFoundrySpellSaveDc(foundry = {}) {
    const ability = foundry.spellcastingAbility || "cha";
    const score = Number(foundry.abilities?.[ability]?.value || 10);
    const modifier = Math.floor((score - 10) / 2);
    return 8 + getFoundryProficiency(foundry) + modifier;
}

function buildFoundryAbilityDescription(ability, foundry = {}) {
    const base = String(ability.description || "").trim();
    const rider = getAbilityRider(ability);
    const lines = [];
    const recharge = getAbilityRechargeValue(ability);
    if (recharge) lines.push(`Ricarica ${rechargeLabel(recharge)}.`);
    const passive = ability.passive && typeof ability.passive === "object" ? ability.passive : {};
    const passiveValue = String(ability.passiveValue || "").trim();
    const passiveValueLabel = ability.passiveValueLabel || passive.valueLabel || "";
    if (passiveValue && passiveValueLabel) {
        const displayValue = passive.id === "absorption"
            ? (ABILITY_DAMAGE_TYPE_OPTIONS.find(([value]) => value === passiveValue)?.[1] || passiveValue)
            : passiveValue;
        lines.push(`${passiveValueLabel}: ${displayValue}.`);
    }
    if (passive.id === "regeneration") {
        const breakTypes = normalizeDamageTypes(ability.passiveBreakDamageTypes);
        if (breakTypes.length) {
            lines.push(`Interrotta fino al prossimo turno da: ${breakTypes.map((type) => ABILITY_DAMAGE_TYPE_OPTIONS.find(([value]) => value === type)?.[1] || type).join(", ")}.`);
        }
    }
    const alwaysConditions = normalizeConditionImmunities(rider.alwaysConditions);
    if (alwaysConditions.length) {
        lines.push(`Condizioni applicate: ${alwaysConditions.map(conditionLabel).join(", ")}.`);
    }
    const failDamage = getAbilityRiderDamageParts(ability).filter((part) => part.formula);
    const failConditions = normalizeConditionImmunities(rider.failConditions);
    if (rider.saveAbility || rider.saveDc || failDamage.length || failConditions.length) {
        const dc = rider.saveDc || calculateFoundrySpellSaveDc(foundry);
        const saveText = rider.saveAbility || rider.saveDc ? `TS ${abilityLabel(rider.saveAbility)} CD ${dc}` : "TS";
        const effects = [
            failDamage.length ? `subisce ${failDamage.map(formatDamagePartLabel).join(" + ")}` : "",
            failConditions.length ? `riceve ${failConditions.map(conditionLabel).join(", ")}` : ""
        ].filter(Boolean).join(" e ");
        lines.push(`${saveText}: su fallimento ${effects || "si applica l'effetto descritto"}.`);
        if (rider.saveAbility || rider.saveDc || failDamage.length || failConditions.length) {
            const successMode = rider.successMode === "negates" ? "negates" : "half";
            const successEffects = [
                successMode === "half" && failDamage.length ? "dimezza i danni" : "annulla i danni e gli effetti da fallimento",
            ].filter(Boolean).join(" e ");
            lines.push(`Successo: ${successEffects}.`);
        }
    }
    if (rider.notes) lines.push(String(rider.notes).trim());
    if (!lines.length) return base;
    return [base, `<hr><p><strong>Effetti aggiuntivi.</strong> ${escapeHtml(lines.join(" "))}</p>`].filter(Boolean).join("\n");
}

function formatDamagePartLabel(part) {
    const damageLabel = ABILITY_DAMAGE_TYPE_OPTIONS.find(([value]) => value === part.type)?.[1] || part.type || "danno";
    return `${part.formula} ${damageLabel}${part.magic ? " magico" : ""}`;
}

function rechargeLabel(value) {
    const threshold = Number(value);
    if (!Number.isFinite(threshold) || threshold < 2 || threshold > 6) return "";
    return threshold === 6 ? "6" : `${threshold}-6`;
}

function conditionLabel(value) {
    return CONDITION_IMMUNITY_OPTIONS.find(([key]) => key === value)?.[1] || value;
}

function conditionIcon(value) {
    return {
        blinded: "fa-eye-slash",
        charmed: "fa-heart",
        deafened: "fa-ear-deaf",
        frightened: "fa-face-dizzy",
        grappled: "fa-hand-fist",
        incapacitated: "fa-ban",
        invisible: "fa-user-ninja",
        paralyzed: "fa-person",
        petrified: "fa-mountain",
        poisoned: "fa-skull-crossbones",
        prone: "fa-person-falling",
        restrained: "fa-link",
        stunned: "fa-bolt",
        unconscious: "fa-bed",
        exhaustion: "fa-battery-quarter"
    }[value] || "fa-circle";
}

function abilityLabel(value) {
    return SAVE_ABILITY_OPTIONS.find(([key]) => key === value)?.[1] || value || "?";
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

function renderImageAdjustControl(key, label, value, min, max, step) {
    return `
        <label class="bestiary-detail-image-adjust-control">
            <span>${escapeHtml(label)}</span>
            <input type="range" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}" value="${escapeHtml(value)}" data-image-adjust="${escapeHtml(key)}">
        </label>
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

function renderDefensePicker(details, foundry) {
    const selectedConditions = new Set(normalizeConditionImmunities(foundry?.conditionImmunities));
    return `
            <div class="bestiary-detail-field bestiary-detail-field--wide">
                <label>Difese</label>
                <div class="monster-defense-table">
                    <div></div>
                    <strong>Resistenza</strong>
                    <strong>ImmunitÃ </strong>
                    <strong>VulnerabilitÃ </strong>
                    <strong>Magico</strong>
                    ${DAMAGE_TYPE_OPTIONS.map((damage) => `
                        <span>${escapeHtml(damage.label)}</span>
                        ${renderDefenseCheckbox("resistances", damage.value, details.resistances)}
                        ${renderDefenseCheckbox("immunities", damage.value, details.immunities)}
                        ${renderDefenseCheckbox("vulnerabilities", damage.value, details.vulnerabilities)}
                        ${damage.physical ? renderMagicDefenseCheckbox(damage.value, details) : `<span class="monster-defense-magic-empty"></span>`}
                    `).join("")}
                </div>
                <div class="monster-condition-immunity-panel">
                    <div class="monster-condition-title">ImmunitÃ  alle condizioni</div>
                    <div class="monster-condition-grid">
                        ${CONDITION_IMMUNITY_OPTIONS.map(([value, label]) => `
                            <button class="monster-condition-btn ${selectedConditions.has(value) ? "is-active" : ""}" type="button" data-condition-immunity="${escapeHtml(value)}">
                                <i class="fas ${escapeHtml(conditionIcon(value))}" aria-hidden="true"></i>
                                <span>${escapeHtml(label)}</span>
                            </button>
                        `).join("")}
                    </div>
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

function renderMagicDefenseCheckbox(value, details) {
    const magicValue = `${value} magico`;
    const enabled = hasBasePhysicalDefense(value, details);
    const selected = ["resistances", "immunities", "vulnerabilities"].some((kind) => {
        const values = Array.isArray(details?.[kind]) ? details[kind] : [];
        return values.some((entry) => normalizeSearchKey(entry) === normalizeSearchKey(magicValue));
    }) && enabled;
    return `
            <label class="monster-defense-check monster-defense-check--magic ${enabled ? "" : "is-disabled"}" title="${escapeHtml(enabled ? `Include ${magicValue}` : `Prima seleziona una difesa ${value}`)}">
                <input type="checkbox" data-defense-magic="${escapeHtml(value)}" value="${escapeHtml(value)}" ${selected ? "checked" : ""} ${enabled ? "" : "disabled"}>
                <span></span>
            </label>
        `;
}

function hasBasePhysicalDefense(value, details) {
    return ["resistances", "immunities", "vulnerabilities"].some((kind) => {
        const values = Array.isArray(details?.[kind]) ? details[kind] : [];
        return values.some((entry) => normalizeSearchKey(entry) === normalizeSearchKey(value));
    });
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
                    <span>PB +${escapeHtml(suggestions.prof)}</span>
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

function buildCampaignMediaPath(folder, filename) {
    return `media/campaigns/${getCampaignId()}/${folder}/${filename}`;
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

function mimeExtension(mimeType) {
    return {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
        "image/avif": "avif"
    }[String(mimeType || "").toLowerCase()] || "png";
}

function versionedWebpFileName(baseName) {
    return `${slugify(baseName || "immagine")}-${Date.now().toString(36)}.webp`;
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
    if (creature.discovered !== true && creature.discovered !== false) delete creature.discovered;
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

function getFoundryProficiency(foundry = {}) {
    const cr = parseCrValue(foundry.cr);
    if (cr >= 29) return 9;
    if (cr >= 25) return 8;
    if (cr >= 21) return 7;
    if (cr >= 17) return 6;
    if (cr >= 13) return 5;
    if (cr >= 9) return 4;
    if (cr >= 5) return 3;
    return 2;
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
        "contundente-magico": "bludgeoning-magic",
        freddo: "cold",
        fuoco: "fire",
        forza: "force",
        fulmine: "lightning",
        necrotico: "necrotic",
        perforante: "piercing",
        "perforante-magico": "piercing-magic",
        psichico: "psychic",
        radiante: "radiant",
        tagliente: "slashing",
        "tagliente-magico": "slashing-magic",
        tuono: "thunder",
        veleno: "poison"
    };
    return (Array.isArray(values) ? values : [])
        .map((value) => map[normalizeSearchKey(value)] || String(value || "").trim().toLowerCase())
        .filter(Boolean);
}

function normalizeConditionImmunities(values) {
    const aliases = {
        accecato: "blinded",
        affascinato: "charmed",
        assordato: "deafened",
        spaventato: "frightened",
        afferrato: "grappled",
        incapacitato: "incapacitated",
        invisibile: "invisible",
        paralizzato: "paralyzed",
        pietrificato: "petrified",
        avvelenato: "poisoned",
        prono: "prone",
        trattenuto: "restrained",
        stordito: "stunned",
        "privo-di-sensi": "unconscious",
        unconscious: "unconscious",
        exhaustion: "exhaustion",
        indebolimento: "exhaustion"
    };
    return (Array.isArray(values) ? values : [])
        .map((value) => {
            const key = normalizeSearchKey(value);
            if (CONDITION_IMMUNITY_OPTIONS.some(([optionValue]) => optionValue === key)) return key;
            return aliases[key] || "";
        })
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index);
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

function buildFoundryResource(value) {
    const amount = Math.max(0, toNumberOrNull(value) || 0);
    return { value: amount, max: amount };
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

function buildFoundryRecharge(ability) {
    const value = getAbilityRechargeValue(ability);
    const threshold = Number(value);
    return {
        value: Number.isFinite(threshold) && threshold >= 2 && threshold <= 6 ? threshold : null,
        charged: Number.isFinite(threshold) && threshold >= 2 && threshold <= 6
    };
}

function buildFoundryItemUses(ability) {
    const recharge = getAbilityRechargeValue(ability);
    return {
        spent: 0,
        max: recharge ? "1" : "",
        recovery: recharge ? [{
            period: "recharge",
            formula: recharge,
            type: "recoverAll"
        }] : []
    };
}

function getAbilityRechargeValue(ability) {
    const hasExplicitRecharge = Object.prototype.hasOwnProperty.call(ability || {}, "recharge")
        || Object.prototype.hasOwnProperty.call(ability || {}, "rechargeValue")
        || Object.prototype.hasOwnProperty.call(ability || {}, "rechargeThreshold");
    if (hasExplicitRecharge) {
        return normalizeRechargeValue(ability?.recharge ?? ability?.rechargeValue ?? ability?.rechargeThreshold);
    }
    return normalizeRechargeValue(parseRechargeText(ability?.description).value);
}

function normalizeRechargeValue(value) {
    if (value && typeof value === "object") return normalizeRechargeValue(value.value ?? value.threshold ?? "");
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw || raw === "no" || raw === "none" || raw === "false") return "";
    const rangeMatch = raw.match(/([2-6])\s*[-â€“]\s*6/);
    if (rangeMatch) return rangeMatch[1];
    const numberMatch = raw.match(/[2-6]/);
    return numberMatch ? numberMatch[0] : "";
}

function parseRechargeText(description) {
    const match = String(description || "").match(/ricarica\s+(\d)(?:\s*[-â€“]\s*(\d))?|recharge\s+(\d)(?:\s*[-â€“]\s*(\d))?/i);
    if (!match) return { value: null, charged: false };
    const value = Number(match[1] || match[3]);
    return { value: Number.isFinite(value) ? value : null, charged: true };
}

function inferActionType(ability) {
    if (isAttackAbility(ability)) return isRangedAttackAbility(ability) ? "rwak" : "mwak";
    if (ability.saveAbility) return "save";
    if (ability.damageFormula && ability.type === "weapon") return String(ability.range || "").includes("/") ? "rwak" : "mwak";
    if (ability.damageFormula) return "other";
    return "other";
}

function isAttackAbility(ability) {
    return ability?.kind === "attack" || ability?.type === "weapon" || Boolean(ability?.attackBonus);
}

function isRangedAttackAbility(ability) {
    const range = String(ability?.range || "").toLowerCase();
    if (range.includes("/")) return true;
    const value = parseRangeValue(range);
    return Number.isFinite(value) && value > 10;
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

