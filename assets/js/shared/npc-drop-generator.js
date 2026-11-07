(function () {
    "use strict";
    window.CriptaDropGenerator = { open };
    const rarities = ["", "Comune", "Non comune", "Raro", "Molto raro", "Leggendario", "Artefatto"];

    function open({ actor, token, onQueued }) {
        if (document.querySelector("[data-drop-generator]")) return;
        const app = window.CriptaApp;
        const base = `api/managed-actors/${encodeURIComponent(actor.worldId)}/${encodeURIComponent(actor.actorId)}/drop-generation`;
        const dialog = document.createElement("dialog");
        dialog.className = "npc-avatar-generator npc-drop-generator";
        dialog.dataset.dropGenerator = "";
        dialog.setAttribute("aria-labelledby", "npc-drop-generator-title");
        dialog.innerHTML = `
            <header><h2 id="npc-drop-generator-title">Genera drop</h2><button type="button" data-close aria-label="Chiudi">×</button></header>
            <div class="npc-avatar-generator__body">
                <p data-status role="status" class="npc-avatar-generator__status">Caricamento…</p>
                <button type="button" data-refresh hidden>Riprova caricamento</button>
                <label class="npc-avatar-generator__direction">Nomi dei drop
                    <textarea data-names rows="4" maxlength="605" placeholder="Piastra di Ferro&#10;Nucleo del Golem&#10;Occhio del golem"></textarea>
                </label>
                <p class="npc-avatar-generator__hint">Da 1 a 5 nomi, uno per riga. L’avatar salvato viene usato come riferimento per le icone a 1024 × 1024.</p>
                <div data-items></div>
            </div>
            <footer><span>Ogni generazione usa il budget API. La conferma aggiunge i drop selezionati a Materiali e all’inventario dell’NPC.</span><div>
                <button type="button" data-generate disabled>Genera anteprime</button>
                <button type="button" data-confirm disabled>Conferma selezionati</button>
            </div></footer>`;
        document.body.append(dialog);
        const get = selector => dialog.querySelector(selector);
        const controller = new AbortController();
        const drafts = new Map();
        const previews = new Map();
        const retryIds = new Map();
        const previousFocus = document.activeElement;
        let job, enabled = false, busy = false, timer, requestId, lastNames;
        const working = () => job?.items.some(item => ["pending", "running"].includes(item.status));
        const publishing = () => job?.items.some(item => item.status === "publishing");
        const request = async (suffix = "", body) => {
            const response = await fetch(app.urls.api(base + suffix), {
                method: body === undefined ? "GET" : "POST", cache: "no-store",
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
                headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || "Generatore temporaneamente non disponibile.");
            }
            return response;
        };

        function updateControls() {
            get("[data-generate]").disabled = !enabled || busy || working() || publishing();
            get("[data-generate]").textContent = job ? "Genera nuova lista" : "Genera anteprime";
            get("[data-confirm]").disabled = busy || !job?.items.some(item =>
                item.status === "publishing" || (item.status === "ready" && drafts.get(item.id)?.selected));
            for (const button of dialog.querySelectorAll("[data-retry]")) button.disabled = !enabled || busy || working();
        }

        async function loadPreview(jobId, item, img, note) {
            try {
                if (!previews.has(item.id)) {
                    const response = await request(`/${jobId}/preview/${item.id}`);
                    const blob = await response.blob();
                    if (controller.signal.aborted) return;
                    if (!previews.has(item.id)) previews.set(item.id, URL.createObjectURL(blob));
                }
                img.src = previews.get(item.id);
            } catch {
                if (!controller.signal.aborted) note.textContent = "Anteprima non caricata. Riapri il generatore per riprovare.";
            }
        }

        function renderItems() {
            const list = get("[data-items]");
            list.replaceChildren();
            for (const item of job?.items || []) {
                const card = document.createElement("section");
                card.className = "npc-drop-generator__item";
                const title = document.createElement("h3");
                title.textContent = item.name;
                const note = document.createElement("p");
                note.className = "npc-avatar-generator__hint";
                card.append(title, note);
                list.append(card);
                if (item.status === "failed") {
                    note.textContent = item.error;
                    const retry = document.createElement("button");
                    retry.type = "button";
                    retry.dataset.retry = "";
                    retry.textContent = "Riprova questo drop";
                    retry.addEventListener("click", () => run(async () => {
                        if (!retryIds.has(item.id)) retryIds.set(item.id, crypto.randomUUID());
                        const result = await request(`/${job.id}/retry/${item.id}`, { requestId: retryIds.get(item.id) });
                        retryIds.delete(item.id);
                        return result.json();
                    }));
                    card.append(retry);
                    continue;
                }
                if (item.status === "pending" || item.status === "running") {
                    note.textContent = item.status === "pending" ? "In coda" : "Generazione in corso…";
                    continue;
                }
                const img = document.createElement("img");
                img.alt = `Anteprima di ${item.name}`;
                img.width = img.height = 128;
                card.append(img);
                void loadPreview(job.id, item, img, note);
                if (item.status === "accepted") {
                    note.textContent = "Confermato · aggiunto a Materiali. Sincronizzazione gestita da Wiki Sync.";
                    continue;
                }
                const draft = item.confirmation ? { ...item.confirmation, selected: true }
                    : drafts.get(item.id) || { description: item.description, rarity: "", selected: true };
                drafts.set(item.id, draft);
                const form = document.createElement("div");
                form.innerHTML = `<label><input type="checkbox"> Includi nella conferma</label>
                    <label>Descrizione<textarea rows="3" maxlength="1000"></textarea></label>
                    <label>Rarità <select></select></label>`;
                const checkbox = form.querySelector("input");
                checkbox.checked = draft.selected;
                checkbox.disabled = item.status === "publishing";
                checkbox.addEventListener("change", () => { draft.selected = checkbox.checked; updateControls(); });
                const description = form.querySelector("textarea");
                description.value = draft.description;
                description.readOnly = item.status === "publishing";
                description.addEventListener("input", () => { draft.description = description.value; });
                const select = form.querySelector("select");
                for (const rarity of rarities) select.add(new Option(rarity || "Da definire", rarity));
                select.value = draft.rarity;
                select.disabled = item.status === "publishing";
                select.addEventListener("change", () => { draft.rarity = select.value; });
                if (item.status === "publishing") note.textContent = "Conferma in sospeso. Premi Conferma selezionati per completarla.";
                card.append(form);
            }
        }

        function apply(payload) {
            const changed = JSON.stringify(job) !== JSON.stringify(payload.job);
            job = payload.job;
            enabled = payload.enabled;
            if (changed) renderItems();
            get("[data-status]").textContent = working() ? "Generazione in corso. Puoi chiudere e tornare più tardi."
                : !enabled ? "Il generatore deve essere attivato dall’amministratore."
                    : job ? "Controlla le proposte e conferma i drop da aggiungere." : "Inserisci i nomi degli oggetti da generare.";
        }

        async function run(action) {
            if (busy || controller.signal.aborted) return;
            busy = true;
            clearTimeout(timer);
            updateControls();
            get("[data-refresh]").hidden = true;
            try { apply(await action()); }
            catch (error) {
                if (controller.signal.aborted) return;
                get("[data-status]").textContent = error.message;
                get("[data-refresh]").hidden = false;
            } finally {
                busy = false;
                if (!controller.signal.aborted) {
                    updateControls();
                    if (working()) timer = setTimeout(refresh, 5000);
                }
            }
        }

        const refresh = () => run(async () => (await request()).json());
        get("[data-refresh]").addEventListener("click", refresh);
        get("[data-generate]").addEventListener("click", () => run(async () => {
            const names = get("[data-names]").value.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
            if (!requestId || JSON.stringify(names) !== lastNames) {
                requestId = crypto.randomUUID();
                lastNames = JSON.stringify(names);
            }
            const result = await (await request("", { names, requestId })).json();
            requestId = null;
            return result;
        }));
        get("[data-confirm]").addEventListener("click", () => run(async () => {
            const items = job.items.filter(item => item.status === "publishing" || (item.status === "ready" && drafts.get(item.id)?.selected))
                .map(item => ({ id: item.id, description: drafts.get(item.id).description, rarity: drafts.get(item.id).rarity }));
            const result = await (await request(`/${job.id}/confirm`, { items })).json();
            onQueued(result.commands || []);
            return result;
        }));
        get("[data-close]").addEventListener("click", () => dialog.close());
        dialog.addEventListener("close", () => {
            controller.abort();
            clearTimeout(timer);
            for (const url of previews.values()) URL.revokeObjectURL(url);
            dialog.remove();
            if (previousFocus?.isConnected) previousFocus.focus();
            else document.querySelector("[data-managed-generate-drop]")?.focus();
        }, { once: true });
        dialog.showModal();
        void refresh();
    }
})();
