(function () {
    "use strict";
    window.CriptaNpcGenerator = { open };
    const purposes = { style: "Stile e palette", appearance: "Aspetto e lineamenti", clothing: "Abbigliamento", frame: "Cornice del token" };
    const active = job => ["pending", "running"].includes(job?.status);

    async function open({ npcs = [], worlds = [], categories = [], initialKind = "person", onCreated = () => {} } = {}) {
        if (document.querySelector("[data-npc-generator]")) return;
        const app = window.CriptaApp, token = window.CriptaDiscordAuth?.getToken?.();
        if (!app || !token) return;
        const campaign = app.campaigns.currentId(), previousFocus = document.activeElement;
        const dialog = document.createElement("dialog");
        dialog.className = "npc-avatar-generator npc-generator";
        dialog.dataset.npcGenerator = "";
        dialog.setAttribute("aria-labelledby", "npc-generator-title");
        dialog.innerHTML = `<header><div><small>NUOVO NPC</small><h2 id="npc-generator-title">Genera NPC</h2></div><button type="button" data-close aria-label="Chiudi">×</button></header>
          <div class="npc-avatar-generator__body npc-generator__workspace">
            <section class="npc-generator__editor" aria-label="Dati del personaggio">
            <p class="npc-avatar-generator__status" data-status role="status" aria-live="polite">Caricamento della bozza…</p>
            <button type="button" data-refresh hidden>Controlla stato</button>
            <form data-form>
              <div class="npc-generator__identity">
                <label>Nome<input name="name" required maxlength="180" autocomplete="off" placeholder="Il nome del nuovo NPC"></label>
                <label>Categoria / sottocategoria<select name="categoryId"><option value="">Senza categoria</option></select></label>
                <label class="npc-generator__wide">Breve descrizione<textarea name="description" required maxlength="1500" rows="3" placeholder="Aspetto, abiti, personalità e dettagli che vuoi vedere nell'immagine."></textarea></label>
              </div>
              <details class="npc-generator__references"><summary>NPC di esempio <span data-reference-count>0 / 3 · facoltativi</span></summary>
                <p>Indica cosa riprendere da ciascun esempio. La descrizione definisce il nuovo personaggio.</p>
                <label>Cerca nella campagna<input type="search" data-reference-search placeholder="Nome o categoria" autocomplete="off"></label>
                <div class="npc-generator__search-results" data-reference-results aria-label="NPC disponibili"></div>
                <p>Gli esempi devono avere l'immagine già salvata sulla wiki. Puoi selezionare fino a tre NPC.</p>
                <div class="npc-generator__selected-references" data-references></div>
              </details>
              <details class="npc-generator__settings"><summary>Impostazioni e destinazione</summary><div class="npc-generator__identity">
                <label>Mondo Foundry <span aria-hidden="true">*</span><span data-world-control></span></label>
                <label>Tipo<select name="kind"><option value="person">NPC collegato</option><option value="creature">Creatura del Bestiario</option></select></label>
                <label>Visibilità dossier<select name="visibility"><option value="dm">Solo DM</option><option value="public">Pubblico</option></select></label>
                <label>Qualità<select name="quality"><option value="medium">Media</option><option value="high" selected>Alta</option><option value="xhigh">Extra alta · alto costo</option></select></label>
                <label class="npc-generator__wide">Risoluzione<select name="resolution"><option value="medium">Media · avatar 864 × 1536 · token 1024 × 1024</option><option value="high" selected>Alta · avatar 1296 × 2304 · token 1536 × 1536</option><option value="2k">2K · avatar 1440 × 2560 · token 2048 × 2048 · alto costo</option></select></label>
              </div><p>La descrizione viene salvata nel dossier. Foundry crea la scheda con le statistiche iniziali del flusso di creazione.</p></details>
              <p class="npc-avatar-generator__cost" data-cost-warning hidden><strong>Solo per NPC importanti, alto costo!</strong></p>
            </form>
            <p class="npc-avatar-generator__hint" data-stop-note hidden>Interrompere l'attesa conserva le immagini già pronte. Non garantisce l'annullamento del costo della chiamata.</p>
            </section>
            <aside class="npc-generator__preview-pane" aria-label="Anteprime avatar e token">
            <strong class="npc-generator__preview-title">Anteprime</strong>
            <div class="npc-avatar-generator__images npc-generator__previews">
              <figure><figcaption>Avatar · 9:16</figcaption><div><img data-avatar alt="Anteprima avatar del nuovo NPC" hidden><p data-avatar-placeholder>L'avatar a figura intera apparirà qui.</p><button type="button" data-enlarge="avatar" hidden>Ingrandisci</button></div></figure>
              <figure><figcaption>Token · 1:1</figcaption><div><img data-token alt="Anteprima token del nuovo NPC" hidden><p data-token-placeholder>Il token verrà generato dall'avatar.</p><button type="button" data-enlarge="token" hidden>Ingrandisci</button></div></figure>
            </div>
            <p class="npc-avatar-generator__hint">Il modello sceglie angolazione e posa del token. Cornice circolare intera, bianco piatto all'esterno.</p>
            </aside>
          </div>
          <footer><span>Due generazioni per coppia. Conferma per creare l'NPC.</span><div>
            <button type="button" data-new hidden>Nuova bozza</button><button type="button" data-stop hidden>Interrompi attesa</button>
            <button type="button" data-retry-token hidden>Rigenera solo token</button><button type="button" data-generate disabled>Genera anteprime</button>
            <button type="button" class="npc-avatar-generator__confirm" data-confirm disabled>Crea NPC e sincronizza</button>
          </div></footer>`;
        document.body.appendChild(dialog);
        const el = selector => dialog.querySelector(selector), form = el("[data-form]");
        const field = name => form.elements.namedItem(name);
        for (const category of categories) field("categoryId").add(new Option(category.parentName ? `${category.parentName} / ${category.name}` : category.name, category.id));
        const worldControl = document.createElement(worlds.length ? "select" : "input");
        worldControl.name = "targetWorldId"; worldControl.required = true;
        if (worlds.length) for (const world of worlds) worldControl.add(new Option(world, world));
        else { worldControl.placeholder = "ID del mondo Foundry"; worldControl.maxLength = 96; }
        el("[data-world-control]").appendChild(worldControl);
        field("kind").value = initialKind;
        const worldStorage = `npc-generation-world:${campaign}`;
        try { const saved = localStorage.getItem(worldStorage); if (saved && (!worlds.length || worlds.includes(saved))) worldControl.value = saved; } catch (_) {}
        let job = null, busy = false, loaded = false, enabled = false, canStop = false, closed = false, applying = false;
        let timer, zoom, pendingRequest = null, storageKey = "", references = [];
        let resolutions = [], qualities = [];
        const previews = {}, controller = new AbortController();
        const base = "api/npc-generation";
        const status = (message, error = false) => { el("[data-status]").textContent = message; el("[data-status]").classList.toggle("is-error", error); };
        const request = async (suffix = "", body) => {
            const response = await fetch(app.urls.api(base + suffix), {
                method: body === undefined ? "GET" : "POST", cache: "no-store",
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
                headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw Object.assign(new Error(payload.error || (response.status === 404 ? "Genera NPC richiede l'aggiornamento del servizio." : "Impossibile contattare il generatore.")), { status: response.status });
            }
            return response;
        };
        const remember = value => {
            pendingRequest = value;
            try { if (storageKey) { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } } catch (_) {}
        };
        const readForm = () => Object.fromEntries(["name", "description", "categoryId", "targetWorldId", "kind", "visibility"].map(name => [name, field(name).value.trim()]));
        const imagePath = (npc, purpose) => npc?.images?.[purpose === "frame" ? "token" : "avatar"] || "";
        const wikiImage = value => {
            try {
                const path = (/^https?:\/\//i.test(value) ? new URL(value).pathname : value).replace(/^\/+/, "").replace(/^media\//, "").split(/[?#]/)[0];
                return !path.includes("..") && /\.(webp|png|jpe?g)$/i.test(path) && (path.startsWith(`campaigns/${campaign}/`) || (campaign === "cripta-di-sangue" && /^(npcs|players|avatars|managed-actors|characters|creatures|bestiary|companions)\//.test(path)));
            } catch (_) { return false; }
        };
        const locked = () => busy || active(job) || job?.status === "confirming" || Boolean(pendingRequest);
        function controls() {
            const frozen = locked(), supported = resolutions.includes(field("resolution").value) && qualities.includes(field("quality").value);
            for (const input of form.querySelectorAll("input,textarea,select,button")) input.disabled = frozen;
            for (const option of field("resolution").options) option.disabled = !resolutions.includes(option.value);
            for (const option of field("quality").options) option.disabled = !qualities.includes(option.value);
            el("[data-cost-warning]").hidden = field("resolution").value !== "2k" && field("quality").value !== "xhigh";
            el("[data-generate]").disabled = busy || active(job) || job?.status === "confirming" || !loaded || !enabled || !supported;
            el("[data-generate]").textContent = active(job) ? "Generazione in corso…" : pendingRequest ? "Riprova invio" : job && job.status !== "accepted" ? "Rigenera avatar e token" : "Genera anteprime";
            el("[data-confirm]").disabled = busy || !loaded || !["ready", "confirming"].includes(job?.status) || previews.avatar?.id !== job?.id || previews.token?.id !== job?.id || Boolean(pendingRequest);
            el("[data-confirm]").textContent = job?.status === "confirming" ? "Riprendi conferma" : "Crea NPC e sincronizza";
            el("[data-retry-token]").hidden = !job?.hasAvatar || active(job) || ["accepted", "confirming"].includes(job?.status);
            el("[data-retry-token]").disabled = frozen || !loaded || !enabled || !supported;
            el("[data-retry-token]").textContent = job?.hasToken ? "Rigenera solo token" : "Genera solo token";
            el("[data-stop]").hidden = !active(job) || !canStop;
            el("[data-stop]").disabled = busy;
            el("[data-stop-note]").hidden = !active(job);
            el("[data-new]").hidden = !job || active(job) || job.status === "confirming";
            el("[data-new]").disabled = busy || Boolean(pendingRequest);
            dialog.setAttribute("aria-busy", String(busy || active(job)));
            renderSearch();
        }
        function renderReferences() {
            el("[data-reference-count]").textContent = `${references.length} / 3 · facoltativi`;
            const root = el("[data-references]"); root.replaceChildren();
            references.forEach((reference, index) => {
                const npc = npcs.find(npc => npc.managedActorWorldId === reference.worldId && npc.managedActorId === reference.actorId);
                const card = document.createElement("article"); card.className = "npc-generator__reference";
                const image = document.createElement("img"); image.alt = "";
                if (imagePath(npc, reference.purpose)) image.src = app.utils.resolveImageUrl(imagePath(npc, reference.purpose));
                else image.hidden = true;
                const name = document.createElement("strong"); name.textContent = reference.name || npc?.name || "NPC";
                const label = document.createElement("label"); label.textContent = "Riprendi da questo NPC";
                const select = document.createElement("select"); select.setAttribute("aria-label", `Riferimento da ${name.textContent}`);
                for (const [value, text] of Object.entries(purposes)) {
                    const option = new Option(text, value);
                    option.disabled = npc ? !wikiImage(imagePath(npc, value)) : value !== reference.purpose;
                    select.add(option);
                }
                select.value = reference.purpose;
                select.addEventListener("change", () => { reference.purpose = select.value; renderReferences(); });
                label.appendChild(select);
                const note = document.createElement("textarea"); note.rows = 2; note.maxLength = 300; note.placeholder = "Dettagli da riprendere (facoltativi)"; note.value = reference.note || ""; note.setAttribute("aria-label", `Nota per ${name.textContent}`);
                note.addEventListener("input", () => { reference.note = note.value; });
                const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Rimuovi"; remove.setAttribute("aria-label", `Rimuovi ${name.textContent}`);
                remove.addEventListener("click", () => { references.splice(index, 1); renderReferences(); });
                card.append(image, name, label, note, remove); root.appendChild(card);
            });
            controls();
        }
        function renderSearch() {
            const root = el("[data-reference-results]"), search = el("[data-reference-search]").value.trim().toLocaleLowerCase();
            root.replaceChildren();
            const matches = npcs.filter(npc => !references.some(reference => reference.worldId === npc.managedActorWorldId && reference.actorId === npc.managedActorId) && `${npc.name} ${npc.category || ""}`.toLocaleLowerCase().includes(search)).slice(0, 18);
            for (const npc of matches) {
                const button = document.createElement("button"); button.type = "button";
                const hasAvatar = wikiImage(imagePath(npc, "style")), hasToken = wikiImage(imagePath(npc, "frame"));
                const image = document.createElement("img"); image.alt = ""; image.loading = "lazy";
                const path = imagePath(npc, hasAvatar ? "style" : "frame");
                if (path) image.src = app.utils.resolveImageUrl(path); else image.hidden = true;
                const name = document.createElement("span"); name.textContent = npc.name;
                button.append(image, name); button.disabled = locked() || references.length >= 3 || (!hasAvatar && !hasToken);
                if (!hasAvatar && !hasToken) button.title = "Carica e salva prima un'immagine di questo NPC sulla wiki.";
                button.addEventListener("click", () => {
                    references.push({ worldId: npc.managedActorWorldId, actorId: npc.managedActorId, name: npc.name, purpose: hasAvatar ? "style" : "frame", note: "" });
                    renderReferences();
                });
                root.appendChild(button);
            }
            if (!matches.length) { const empty = document.createElement("p"); empty.textContent = "Nessun altro NPC corrispondente nella campagna."; root.appendChild(empty); }
        }
        function restore(input, refs = []) {
            for (const key of ["name", "description", "categoryId", "targetWorldId", "kind", "visibility", "quality", "resolution"]) {
                const value = input[key] ?? input.form?.[key] ?? input.options?.[key];
                if (value !== undefined) {
                    if (key === "targetWorldId" && worlds.length && !worlds.includes(value)) worldControl.add(new Option(value, value));
                    if (key === "categoryId" && value && !categories.some(category => category.id === value)) field(key).add(new Option("Categoria non più disponibile", value));
                    field(key).value = value;
                }
            }
            references = refs.map(reference => ({ ...reference })); renderReferences();
        }
        function clearPreviews() {
            for (const part of ["avatar", "token"]) {
                if (previews[part]) URL.revokeObjectURL(previews[part].url);
                delete previews[part]; el(`[data-${part}]`).hidden = true; el(`[data-${part}-placeholder]`).hidden = false; el(`[data-enlarge="${part}"]`).hidden = true;
            }
        }
        async function showJob() {
            await Promise.all(["avatar", "token"].map(async part => {
                if (!job?.[part === "avatar" ? "hasAvatar" : "hasToken"] || previews[part]?.id === job.id) return;
                const id = job.id, blob = await (await request(`/${id}/${part}`)).blob();
                if (closed) return;
                const url = URL.createObjectURL(blob), image = el(`[data-${part}]`);
                try { image.src = url; await image.decode(); } catch (error) { URL.revokeObjectURL(url); throw error; }
                if (closed) { URL.revokeObjectURL(url); return; }
                if (previews[part]) URL.revokeObjectURL(previews[part].url);
                previews[part] = { id, url }; image.hidden = false;
                el(`[data-${part}-placeholder]`).hidden = true; el(`[data-enlarge="${part}"]`).hidden = false;
            }));
            if (closed) return;
            if (active(job)) {
                const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(job.startedAt || job.createdAt)) / 60000));
                status(`${job.phase === "avatar" ? "Sto creando l'avatar" : "Sto creando il token dall'avatar"}${elapsed ? ` · ${elapsed} min` : ""}. Puoi chiudere la finestra e ritrovare qui la bozza.`);
                el("[data-refresh]").hidden = false; timer = setTimeout(refresh, 10000);
            } else if (job?.status === "ready") status("Avatar e token sono pronti. Controllali prima di creare l'NPC.");
            else if (job?.status === "accepted") status("Questo NPC è già stato inviato a Foundry. Puoi iniziare una nuova bozza.");
            else if (job?.status === "confirming") status("La conferma è stata avviata. Riprendila per verificare l'invio senza creare duplicati.");
            else if (job?.error) status(job.error, true);
            else status(enabled ? "Descrivi il nuovo NPC: preparerò prima l'avatar e poi il token." : "Il generatore deve essere attivato dall'amministratore.", !enabled);
            controls();
        }
        async function refresh() {
            if (closed || busy) return;
            clearTimeout(timer); busy = true; controls();
            try {
                const payload = await (await request()).json();
                if (closed) return;
                const first = !loaded, oldId = job?.id;
                job = payload.job; loaded = true; enabled = payload.enabled && payload.version === 1; canStop = payload.canStop === true;
                resolutions = payload.supportedResolutions || []; qualities = payload.supportedQualities || [];
                if (pendingRequest && job?.id === pendingRequest.requestId) remember(null);
                if (!pendingRequest && job && (first || oldId !== job.id)) { clearPreviews(); restore(job, job.references); }
                await showJob();
                if (payload.version !== 1) status("Genera NPC richiede l'aggiornamento del servizio.", true);
            } catch (error) {
                if (!closed) {
                    loaded = false;
                    status(error.status ? error.message : "Non riesco a controllare la bozza. Riprova il controllo: non avvia nuove generazioni.", true);
                    el("[data-refresh]").hidden = false;
                    if (active(job) && ![400, 401, 403, 404].includes(error.status)) timer = setTimeout(refresh, 10000);
                }
            } finally { busy = false; if (!closed) controls(); }
        }
        async function generate(tokenOnly = false) {
            if (busy || !loaded || !enabled || active(job) || job?.status === "confirming") return;
            if (!worldControl.value.trim()) el(".npc-generator__settings").open = true;
            if (!pendingRequest && !tokenOnly && !form.reportValidity()) return;
            if (!pendingRequest && job?.status === "uncertain" && !window.confirm("La richiesta precedente potrebbe essere stata addebitata. Avviare una nuova generazione a pagamento?")) return;
            busy = true; clearTimeout(timer);
            if (!pendingRequest) remember({ requestId: crypto.randomUUID(), form: readForm(), references: references.map(({ worldId, actorId, purpose, note }) => ({ worldId, actorId, purpose, note })), quality: field("quality").value, resolution: field("resolution").value,
                ...(job && job.status !== "accepted" ? { parentJobId: job.id, draftId: job.draftId } : {}), ...(tokenOnly ? { tokenOnly: true } : {}) });
            const suffix = pendingRequest.tokenOnly ? `/${pendingRequest.parentJobId}/retry-token` : "";
            controls(); status("Invio della richiesta…");
            try {
                const payload = await (await request(suffix, pendingRequest)).json();
                if (closed) return;
                job = payload.job; remember(null); clearPreviews(); await showJob();
                try { localStorage.setItem(worldStorage, worldControl.value); } catch (_) {}
            } catch (error) {
                if (error.status && error.status < 500) remember(null);
                if (!closed) { loaded = false; status(`${error.message} Controlla lo stato prima di inviare altre richieste.`, true); el("[data-refresh]").hidden = false; timer = setTimeout(refresh, 10000); }
            } finally { busy = false; if (!closed) controls(); }
        }
        el("[data-generate]").addEventListener("click", () => generate());
        el("[data-retry-token]").addEventListener("click", () => generate(true));
        el("[data-refresh]").addEventListener("click", refresh);
        el("[data-reference-search]").addEventListener("input", renderSearch);
        form.addEventListener("submit", event => { event.preventDefault(); generate(); });
        form.addEventListener("change", controls);
        el("[data-stop]").addEventListener("click", async () => {
            if (busy || !active(job)) return;
            busy = true; clearTimeout(timer); controls();
            try { job = (await (await request(`/${job.id}/stop`, {})).json()).job; await showJob(); }
            catch (error) { if (!closed) status(error.message, true); }
            finally { busy = false; if (!closed) controls(); }
        });
        el("[data-new]").addEventListener("click", () => {
            if (locked()) return;
            const selectedWorld = worldControl.value;
            job = null; references = []; clearPreviews(); form.reset(); worldControl.value = selectedWorld; field("kind").value = initialKind; renderReferences();
            status("Descrivi il nuovo NPC: preparerò prima l'avatar e poi il token."); field("name").focus();
        });
        el("[data-confirm]").addEventListener("click", async () => {
            if (busy || !["ready", "confirming"].includes(job?.status)) return;
            if (!worldControl.value.trim()) el(".npc-generator__settings").open = true;
            if (job.status !== "confirming" && !form.reportValidity()) return;
            busy = true; applying = true; clearTimeout(timer); el("[data-close]").disabled = true; controls(); status("Creazione dell'NPC e invio a Foundry…");
            try {
                const payload = await (await request(`/${job.id}/confirm`, { form: readForm() })).json();
                job.status = "accepted"; remember(null); applying = false; close(); await onCreated(payload);
            } catch (error) {
                if (!closed) { status(`${error.message} La bozza è conservata.`, true); el("[data-refresh]").hidden = false; timer = setTimeout(refresh, 10000); }
            } finally { busy = false; applying = false; if (!closed) { el("[data-close]").disabled = false; controls(); } }
        });
        for (const part of ["avatar", "token"]) {
            const enlarge = () => {
                if (zoom || !previews[part]) return;
                zoom = document.createElement("dialog"); zoom.className = "npc-avatar-zoom";
                zoom.setAttribute("aria-label", part === "avatar" ? "Avatar ingrandito" : "Token ingrandito");
                zoom.innerHTML = '<header><strong></strong><div><button type="button" data-size aria-pressed="false">Dimensione reale</button><button type="button" data-dismiss aria-label="Chiudi ingrandimento">×</button></div></header><div class="npc-avatar-zoom__canvas"><img alt=""></div>';
                zoom.querySelector("strong").textContent = `${part === "avatar" ? "Avatar" : "Token"} · ${field("name").value}`;
                zoom.querySelector("img").src = previews[part].url;
                const dismiss = () => { zoom.close(); zoom.remove(); zoom = null; el(`[data-enlarge="${part}"]`).focus(); };
                zoom.querySelector("[data-dismiss]").addEventListener("click", dismiss);
                zoom.addEventListener("cancel", event => { event.preventDefault(); dismiss(); });
                zoom.querySelector("[data-size]").addEventListener("click", event => { const actual = zoom.classList.toggle("is-actual-size"); event.currentTarget.textContent = actual ? "Adatta allo schermo" : "Dimensione reale"; event.currentTarget.setAttribute("aria-pressed", String(actual)); });
                document.body.appendChild(zoom); zoom.showModal();
            };
            el(`[data-enlarge="${part}"]`).addEventListener("click", enlarge); el(`[data-${part}]`).addEventListener("click", enlarge);
        }
        function close() {
            if (closed || applying) return;
            closed = true; clearTimeout(timer); controller.abort();
            if (zoom) { zoom.close(); zoom.remove(); zoom = null; }
            clearPreviews(); dialog.close(); dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus();
        }
        el("[data-close]").addEventListener("click", close);
        dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
        dialog.showModal(); renderReferences();
        try {
            const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
            storageKey = `npc-generation:${campaign}:${Array.from(digest.slice(0, 12), byte => byte.toString(16).padStart(2, "0")).join("")}`;
            pendingRequest = JSON.parse(sessionStorage.getItem(storageKey));
            if (pendingRequest) restore(pendingRequest, pendingRequest.references);
        } catch (_) {}
        if (!closed) refresh();
    }
})();
