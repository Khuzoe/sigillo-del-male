(() => {
    const ICONS = [
        ["fa-folder-open", "Cartella"],
        ["fa-users", "Gruppo"],
        ["fa-masks-theater", "Fazione"],
        ["fa-crown", "Nobilta"],
        ["fa-skull", "Nemici"],
        ["fa-shield-halved", "Alleati"],
        ["fa-dungeon", "Luogo"],
        ["fa-paw", "Creature"]
    ];

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function cloneCategories(categories) {
        return (Array.isArray(categories) ? categories : []).map((category) => ({ ...category }));
    }

    function createDialog() {
        let dialog = document.querySelector("[data-npc-category-dialog]");
        if (dialog) return dialog;
        dialog = document.createElement("dialog");
        dialog.className = "npc-category-dialog";
        dialog.dataset.npcCategoryDialog = "";
        document.body.appendChild(dialog);
        return dialog;
    }

    function iconOptions(selected) {
        return ICONS.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
    }

    function renderRow(category, categories, index) {
        const mergeTargets = categories.filter((entry) => entry.id !== category.id && !entry.archived && !entry.mergedInto);
        return `<article class="npc-category-row ${category.archived ? "is-archived" : ""}" data-category-id="${escapeHtml(category.id)}" style="--category-color:${escapeHtml(category.color)}">
            <div class="npc-category-row__drag">
                <button type="button" data-category-action="up" aria-label="Sposta su" ${index === 0 ? "disabled" : ""}><i class="fas fa-chevron-up"></i></button>
                <button type="button" data-category-action="down" aria-label="Sposta giu" ${index === categories.length - 1 ? "disabled" : ""}><i class="fas fa-chevron-down"></i></button>
            </div>
            <label class="npc-category-row__name">
                <input type="text" data-category-field="name" value="${escapeHtml(category.name)}" maxlength="120" aria-label="Nome categoria">
                <small>${escapeHtml(category.id)}${category.inferred ? " - importata dai dati esistenti" : ""}</small>
            </label>
            <div class="npc-category-row__visual">
                <input type="color" data-category-field="color" value="${escapeHtml(category.color)}" aria-label="Colore categoria">
                <select data-category-field="icon" aria-label="Icona categoria">${iconOptions(category.icon)}</select>
            </div>
            <label class="npc-category-row__merge">
                <select data-category-field="mergedInto" aria-label="Unisci categoria">
                    <option value="">Non unire</option>
                    ${mergeTargets.map((target) => `<option value="${escapeHtml(target.id)}" ${category.mergedInto === target.id ? "selected" : ""}>Unisci in ${escapeHtml(target.name)}</option>`).join("")}
                </select>
            </label>
            <div>
                <div class="npc-category-row__usage">${category.usageCount || 0} NPC</div>
                <div class="npc-category-row__actions">
                    <button type="button" data-category-action="archive" title="${category.archived ? "Riattiva" : "Archivia"}"><i class="fas ${category.archived ? "fa-box-open" : "fa-box-archive"}"></i></button>
                    <button type="button" data-category-action="remove" title="Rimuovi" ${(category.usageCount || 0) > 0 ? "disabled" : ""}><i class="fas fa-trash"></i></button>
                </div>
            </div>
        </article>`;
    }

    function render(dialog, state) {
        dialog.innerHTML = `<form class="npc-category-manager" method="dialog">
            <header class="npc-category-manager__header">
                <div class="npc-category-manager__heading">
                    <span class="npc-category-manager__emblem" aria-hidden="true"><i class="fas fa-layer-group"></i></span>
                    <div><small>Organizzazione della campagna</small><h2>Categorie NPC</h2></div>
                </div>
                <button class="npc-category-manager__close" type="button" data-category-close aria-label="Chiudi"><i class="fas fa-xmark"></i></button>
            </header>
            <div class="npc-category-manager__create">
                <input type="text" data-category-new-name maxlength="120" placeholder="Nome nuova categoria" autocomplete="off">
                <button type="button" data-category-add><i class="fas fa-plus"></i> Aggiungi</button>
            </div>
            <div class="npc-category-manager__list">
                ${state.categories.length ? state.categories.map((category, index) => renderRow(category, state.categories, index)).join("") : '<div class="npc-category-manager__empty">Nessuna categoria configurata.</div>'}
            </div>
            <footer class="npc-category-manager__footer">
                <span class="npc-category-manager__status" data-category-status>${state.dirty ? "Modifiche non salvate" : `Revisione ${state.revision}`}</span>
                <button class="npc-category-manager__save" type="button" data-category-save ${state.saving ? "disabled" : ""}><i class="fas ${state.saving ? "fa-spinner fa-spin" : "fa-check"}"></i> Salva categorie</button>
            </footer>
        </form>`;
    }

    function syncFields(dialog, state) {
        dialog.querySelectorAll("[data-category-id]").forEach((row) => {
            const category = state.categories.find((entry) => entry.id === row.dataset.categoryId);
            if (!category) return;
            row.querySelectorAll("[data-category-field]").forEach((control) => {
                const field = control.dataset.categoryField;
                category[field] = control.value;
                if (field === "mergedInto") category.archived = Boolean(control.value) || category.archived;
            });
        });
    }

    function markDirty(dialog, state) {
        state.dirty = true;
        const status = dialog.querySelector("[data-category-status]");
        if (status) status.textContent = "Modifiche non salvate";
    }

    async function open({ onSaved } = {}) {
        const dialog = createDialog();
        dialog.innerHTML = '<div class="npc-category-manager__empty"><i class="fas fa-spinner fa-spin"></i></div>';
        if (!dialog.open) dialog.showModal();

        let registry;
        try {
            registry = await window.CriptaNpcCategories.load({ force: true });
        } catch (error) {
            dialog.innerHTML = `<div class="npc-category-manager__empty">${escapeHtml(error.message || "Categorie non disponibili.")}</div>`;
            return;
        }

        const state = {
            revision: registry.revision,
            categories: cloneCategories(registry.categories),
            dirty: false,
            saving: false
        };
        render(dialog, state);
        dialog._npcCategoryListeners?.abort();
        const listeners = new AbortController();
        dialog._npcCategoryListeners = listeners;


        dialog.addEventListener("input", (event) => {
            if (!event.target.closest("[data-category-field]")) return;
            syncFields(dialog, state);
            markDirty(dialog, state);
            if (event.target.matches('[data-category-field="color"]')) {
                event.target.closest("[data-category-id]")?.style.setProperty("--category-color", event.target.value);
            }
        }, { signal: listeners.signal });

        dialog.addEventListener("change", (event) => {
            if (!event.target.closest("[data-category-field]")) return;
            syncFields(dialog, state);
            markDirty(dialog, state);
            if (event.target.matches('[data-category-field="mergedInto"]')) render(dialog, state);
        }, { signal: listeners.signal });

        dialog.addEventListener("click", async (event) => {
            const close = event.target.closest("[data-category-close]");
            if (close) {
                if (!state.dirty || window.confirm("Chiudere senza salvare le modifiche?")) dialog.close();
                return;
            }

            const add = event.target.closest("[data-category-add]");
            if (add) {
                syncFields(dialog, state);
                const input = dialog.querySelector("[data-category-new-name]");
                const name = String(input?.value || "").trim();
                const id = window.CriptaNpcCategories.normalizeId(name);
                if (!id) return;
                if (state.categories.some((category) => category.id === id)) {
                    input.setCustomValidity("Esiste gia una categoria con questo nome.");
                    input.reportValidity();
                    return;
                }
                const maxOrder = Math.max(0, ...state.categories.map((category) => Number(category.order) || 0));
                state.categories.push({ id, name, order: maxOrder + 10, color: "#b99a45", icon: "fa-folder-open", archived: false, mergedInto: "", usageCount: 0 });
                state.dirty = true;
                render(dialog, state);
                return;
            }

            const action = event.target.closest("[data-category-action]");
            if (action) {
                syncFields(dialog, state);
                const row = action.closest("[data-category-id]");
                const index = state.categories.findIndex((category) => category.id === row?.dataset.categoryId);
                if (index < 0) return;
                const kind = action.dataset.categoryAction;
                if (kind === "up" && index > 0) [state.categories[index - 1], state.categories[index]] = [state.categories[index], state.categories[index - 1]];
                if (kind === "down" && index < state.categories.length - 1) [state.categories[index + 1], state.categories[index]] = [state.categories[index], state.categories[index + 1]];
                if (kind === "archive") state.categories[index].archived = !state.categories[index].archived;
                if (kind === "remove" && !(state.categories[index].usageCount > 0)) state.categories.splice(index, 1);
                state.dirty = true;
                render(dialog, state);
                return;
            }

            const save = event.target.closest("[data-category-save]");
            if (!save || state.saving) return;
            syncFields(dialog, state);
            const invalid = state.categories.find((category) => !String(category.name || "").trim());
            if (invalid) {
                dialog.querySelector(`[data-category-id="${CSS.escape(invalid.id)}"] [data-category-field="name"]`)?.focus();
                return;
            }
            state.categories.forEach((category, index) => { category.order = (index + 1) * 10; });
            state.saving = true;
            render(dialog, state);
            try {
                const saved = await window.CriptaNpcCategories.save(state.categories, state.revision);
                state.revision = saved.revision;
                state.categories = cloneCategories(saved.categories);
                state.dirty = false;
                state.saving = false;
                render(dialog, state);
                onSaved?.(saved);
            } catch (error) {
                state.saving = false;
                render(dialog, state);
                const status = dialog.querySelector("[data-category-status]");
                if (status) status.textContent = error.message || "Salvataggio fallito.";
            }
        }, { signal: listeners.signal });
    }

    function init({ isEditor = false, onSaved } = {}) {
        const button = document.querySelector("[data-npc-category-manager]");
        if (!button) return;
        button.hidden = !isEditor;
        if (!isEditor) return;
        button.addEventListener("click", () => open({ onSaved }));
        const params = new URLSearchParams(window.location.search);
        if (params.get("manageCategories") === "1") {
            params.delete("manageCategories");
            const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
            window.history.replaceState(null, "", clean);
            open({ onSaved });
        }
    }

    window.CriptaNpcCategoryManager = { init, open };
})();
