(() => {
    function mount(root, { group, selected, owner, canManage, token, escape, hasDraft }) {
        if (!group && !canManage) return;
        const ownerKey = `${owner.worldId}:${owner.actorId}`;
        const path = `api/managed-actors/${encodeURIComponent(owner.worldId)}/${encodeURIComponent(owner.actorId)}/forms`;
        const forms = group?.forms || [];
        function navigate(key, manage = false) {
            const url = new URL(window.location.href);
            url.searchParams.set("world", owner.worldId);
            url.searchParams.set("actor", owner.actorId);
            url.searchParams.delete("profile");
            if (key) url.searchParams.set("form", key);
            else url.searchParams.delete("form");
            if (manage) url.hash = "managed-npc-forms";
            if (url.href === window.location.href) window.location.reload();
            else if (url.pathname + url.search === window.location.pathname + window.location.search) {
                window.history.replaceState(null, "", url);
                window.location.reload();
            } else window.location.assign(url);
        }
        const option = form => {
            const state = form.current ? " · Attuale" : form.past ? " · Passata" : "";
            return `<option value="${escape(form.key)}"${selected?.key === form.key ? " selected" : ""}>${escape(form.label + state)}</option>`;
        };
        if (forms.length > 1 || (forms.length && canManage)) {
            const bar = document.createElement("div");
            bar.className = "npc-form-switch";
            bar.innerHTML = `<label>Forma visualizzata <select>${forms.map(option).join("")}</select></label>`;
            const anchor = root.querySelector(".managed-command-bar") || root.querySelector(".managed-actor-panels");
            anchor?.before(bar);
            bar.querySelector("select").addEventListener("change", event => {
                if (!hasDraft()) navigate(event.target.value);
                else {
                    event.target.value = selected.key;
                    window.alert("Salva o annulla le modifiche prima di cambiare forma.");
                }
            });
        }
        const dossier = root.querySelector("#managed-npc-profile");
        if (!canManage || !dossier) return;
        const panel = document.createElement("details");
        panel.id = "managed-npc-forms";
        panel.className = "npc-forms-manager";
        panel.innerHTML = `<summary><i class="fas fa-layer-group" aria-hidden="true"></i> Gestisci forme</summary>
            <div class="npc-forms-body">
                ${forms.length ? `<label>Forma da gestire <select data-form-member>${forms.map(option).join("")}</select></label><div data-form-actions></div>` : ""}
                <form data-form-link><label>Actor da collegare <select name="actor" required><option value="">Caricamento Actor…</option></select></label>
                    <label>Nome della forma <input name="label" maxlength="120" required placeholder="Es. Angelica"></label>
                    <button type="submit" class="managed-command-primary">Collega Actor</button>
                </form>
                <p role="status" aria-live="polite"></p>
            </div>`;
        const opening = dossier.querySelector(".managed-dossier-opening");
        if (opening) opening.after(panel);
        else dossier.prepend(panel);
        const status = panel.querySelector('[role="status"]');
        const link = panel.querySelector("[data-form-link]");
        let candidatesLoaded = false;
        async function loadCandidates() {
            if (!panel.open || candidatesLoaded) return;
            candidatesLoaded = true;
            try {
                const { candidates } = await window.CriptaApp.api.get(path, { token, query: { candidates: 1 }, cache: false });
                link.elements.actor.replaceChildren(new Option(candidates.length ? "Scegli un Actor" : "Nessun Actor disponibile", ""));
                for (const actor of candidates.sort((a, b) => a.name.localeCompare(b.name, "it"))) {
                    link.elements.actor.add(new Option(`${actor.name} · ${actor.worldId} (${actor.key.split(":")[1]})`, actor.key));
                }
            } catch (error) {
                candidatesLoaded = false;
                status.textContent = error.message || "Impossibile caricare gli Actor.";
            }
        }
        panel.addEventListener("toggle", loadCandidates);
        if (window.location.hash === "#managed-npc-forms") {
            panel.open = true;
            root._managedNpcReveal?.(panel);
        }
        const members = panel.querySelector("[data-form-member]");
        const actions = panel.querySelector("[data-form-actions]");
        function renderActions() {
            if (!members) return;
            const form = forms.find(entry => entry.key === members.value);
            const button = (action, text) => `<button type="button" class="managed-command-secondary" data-action="${action}">${text}</button>`;
            actions.innerHTML = `<label>Nome della forma <input data-form-name value="${escape(form.label)}" maxlength="120"></label>
                <div class="npc-form-buttons">
                    ${button("rename", "Salva nome")}
                    ${!form.current && form.available ? button("current", "Imposta come attuale") : ""}
                    ${!form.current ? button("past", form.past ? "Rendi di nuovo disponibile" : "Segna come passata") : ""}
                    ${form.key !== ownerKey && !form.current ? button("unlink", "Scollega Actor") : ""}
                </div>
                ${form.key !== ownerKey ? `<label class="npc-form-portrait"><input type="checkbox" data-form-portrait ${form.showPortrait ? "checked" : ""}> Mostra nome e immagini anche a chi può leggere soltanto il dossier</label>` : ""}`;
        }
        members?.addEventListener("change", renderActions);
        renderActions();
        let pending = false;
        async function save(body) {
            if (pending) return;
            if (hasDraft()) { status.textContent = "Salva o annulla le modifiche della scheda prima di gestire le forme."; return; }
            pending = true;
            panel.inert = true;
            status.textContent = "Salvataggio…";
            try {
                await window.CriptaApp.api.post(path, { ...body, expectedRevision: group?.revision || 0 }, { token });
                window.CriptaApp.api.clearCache?.();
                navigate(body.action === "current" || body.action === "unlink" ? "" : body.key, true);
            } catch (error) {
                status.textContent = error.message || "Impossibile salvare le forme.";
                pending = false;
                panel.inert = false;
            }
        }
        actions?.addEventListener("click", event => {
            const action = event.target.closest("[data-action]")?.dataset.action;
            if (!action) return;
            const form = forms.find(entry => entry.key === members.value);
            save({ action, key: form.key, label: actions.querySelector("[data-form-name]").value, past: !form.past });
        });
        actions?.addEventListener("change", async event => {
            if (!event.target.matches("[data-form-portrait]")) return;
            const checked = event.target.checked;
            event.target.checked = !checked;
            await save({ action: "portrait", key: members.value, showPortrait: checked });
        });
        link.addEventListener("submit", event => {
            event.preventDefault();
            save({ action: "link", key: link.elements.actor.value, label: link.elements.label.value });
        });
    }
    window.CriptaNpcForms = { mount };
})();
