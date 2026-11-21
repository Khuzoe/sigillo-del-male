(function () {
    "use strict";
    window.CriptaNpcGenerator = { open };
    const purposes = { style: "Stile e palette", appearance: "Aspetto e lineamenti", clothing: "Abbigliamento", frame: "Cornice del token" };
    const conceptPurposes = { character: "Personaggio / concept", emblem: "Emblema o simbolo", equipment: "Arma o equipaggiamento", clothing: "Abbigliamento", style: "Stile e palette" };
    const active = job => ["pending", "running"].includes(job?.status);
    const referencePickerUrl = new URL("npc-reference-picker.mjs?v=20261118-concepts1", document.currentScript.src).href;

    async function open({ npcs = [], worlds = [], categories = [], initialKind = "person", loadReferences, setupNameCheck, onCreated = () => {} } = {}) {
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
                <label>Nome<input name="name" required maxlength="180" autocomplete="off" aria-describedby="npc-generator-name-feedback" placeholder="Il nome del nuovo NPC"><small id="npc-generator-name-feedback" data-create-name-feedback aria-live="polite"></small></label>
                <label>Categoria / sottocategoria<select name="categoryId"><option value="">Senza categoria</option></select></label>
                <label class="npc-generator__wide">Breve descrizione <span data-description-hint hidden>Facoltativa con un concept del personaggio</span><textarea name="description" required maxlength="1500" rows="3" placeholder="Aspetto, abiti, personalità e dettagli che vuoi vedere nell’immagine."></textarea></label>
              </div>
              <details class="npc-generator__references"><summary>Immagini di riferimento <span data-reference-count>0 / 3 · facoltative</span></summary>
                <p>Allega un personaggio, un emblema o un oggetto, oppure scegli un NPC della campagna. Per ogni immagine puoi indicare cosa riprendere.</p>
                <div class="npc-generator__reference-toolbar"><button type="button" data-attach>Allega immagini</button><input hidden type="file" data-concept-files accept="image/png,image/jpeg,image/webp" multiple aria-label="Immagini concept"><button type="button" data-reference-picker>Scegli NPC di esempio</button><button type="button" data-reference-reload>Aggiorna elenco</button></div>
                <p data-concept-status role="status" aria-live="polite">PNG, JPEG o WebP. Fino a 3 riferimenti, 12 MB per immagine e 24 MB in totale.</p>
                <p data-reference-status role="status" aria-live="polite"></p>
                <div class="npc-generator__selected-references" data-references></div>
              </details>
              <details class="npc-generator__settings"><summary>Impostazioni e destinazione</summary><div class="npc-generator__identity">
                <label>Mondo Foundry <span aria-hidden="true">*</span><span data-world-control></span></label>
                <label>Tipo<select name="kind"><option value="person">NPC collegato</option><option value="creature">Creatura del Bestiario</option></select></label>
                <label>Visibilità dossier<select name="visibility"><option value="dm">Solo DM</option><option value="public">Pubblico</option></select></label>
                <label>Qualità<select name="quality"><option value="medium">Media</option><option value="high" selected>Alta</option><option value="xhigh">Extra alta · alto costo</option></select></label>
                <label class="npc-generator__wide">Risoluzione<select name="resolution"><option value="medium">Media · avatar lato lungo 1536 px · token 1024 × 1024</option><option value="high" selected>Alta · avatar lato lungo 2304 px · token 1536 × 1536</option><option value="2k">2K · avatar lato lungo 2560 px · token 2048 × 2048 · alto costo</option></select></label>
                <label class="npc-avatar-generator__orientation npc-generator__wide"><input type="checkbox" name="landscape">Avatar orizzontale (16:9)</label>
              </div><p>La descrizione viene salvata nel dossier. Foundry crea la scheda con le statistiche iniziali del flusso di creazione.</p></details>
              <p class="npc-avatar-generator__cost" data-cost-warning hidden><strong>Solo per NPC importanti, alto costo!</strong></p>
            </form>
            <p class="npc-avatar-generator__hint" data-stop-note hidden>Interrompere l'attesa conserva le immagini già pronte. Non garantisce l'annullamento del costo della chiamata.</p>
            </section>
            <aside class="npc-generator__preview-pane" aria-label="Anteprime avatar e token">
            <strong class="npc-generator__preview-title">Anteprime</strong>
            <div class="npc-avatar-generator__images npc-generator__previews">
              <figure><figcaption data-avatar-caption>Avatar · 9:16</figcaption><div><img data-avatar alt="Anteprima avatar del nuovo NPC" hidden><p data-avatar-placeholder>L'avatar a figura intera apparirà qui.</p><button type="button" data-enlarge="avatar" hidden>Ingrandisci</button></div></figure>
              <figure><figcaption>Token · 1:1</figcaption><div><img data-token alt="Anteprima token del nuovo NPC" hidden><p data-token-placeholder>Il token verrà generato dall'avatar.</p><button type="button" data-enlarge="token" hidden>Ingrandisci</button></div></figure>
            </div>
            <p class="npc-avatar-generator__hint" data-token-background>Il modello sceglie angolazione e posa del token. Cornice circolare intera, esterno trasparente.</p>
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
        let resolutions = [], qualities = [], landscapeSupported = false;
        const selectedRatio = () => field("landscape").checked ? "16:9" : "9:16";
        let loadingReferences = false, referenceError = "", referencesPicker;
        let conceptSupported = false, checkingFiles = false;
        const conceptUrls = new Set(), remotePreviews = new Map();
        const previews = {}, controller = new AbortController();
        const base = "api/npc-generation";
        const status = (message, error = false) => { el("[data-status]").textContent = message; el("[data-status]").classList.toggle("is-error", error); };
        const request = async (suffix = "", body) => {
            const response = await fetch(app.urls.api(base + suffix), {
                method: body === undefined ? "GET" : "POST", cache: "no-store",
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(body instanceof Blob ? 90000 : 20000)]),
                headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": body instanceof Blob ? body.type : "application/json" }) },
                ...(body === undefined ? {} : { body: body instanceof Blob ? body : JSON.stringify(body) })
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
        const checkName = setupNameCheck?.(form);
        const readForm = () => Object.fromEntries(["name", "description", "categoryId", "targetWorldId", "kind", "visibility"].map(name => [name, field(name).value.trim()]));
        const imagePath = (npc, purpose) => npc?.images?.[purpose === "frame" ? "token" : "avatar"] || "";
        const wikiImage = value => {
            try {
                const path = (/^https?:\/\//i.test(value) ? new URL(value).pathname : value).replace(/^\/+/, "").replace(/^media\//, "").split(/[?#]/)[0];
                return !path.includes("..") && /\.(webp|png|jpe?g)$/i.test(path) && (path.startsWith(`campaigns/${campaign}/`) || (campaign === "cripta-di-sangue" && /^(npcs|players|avatars|managed-actors|characters|creatures|bestiary|companions)\//.test(path)));
            } catch (_) { return false; }
        };
        const locked = () => busy || checkingFiles || active(job) || job?.status === "confirming" || Boolean(pendingRequest);
        function controls() {
            const frozen = locked(), supported = resolutions.includes(field("resolution").value) && qualities.includes(field("quality").value);
            for (const input of form.querySelectorAll("input,textarea,select,button")) input.disabled = frozen;
            field("landscape").disabled = frozen || !landscapeSupported;
            const previewRatio = active(job) || job?.hasAvatar ? job.options?.aspectRatio || "9:16" : selectedRatio();
            el("[data-avatar-caption]").textContent = `Avatar · ${previewRatio}`;
            for (const option of field("resolution").options) option.disabled = !resolutions.includes(option.value);
            for (const option of field("quality").options) option.disabled = !qualities.includes(option.value);
            el("[data-cost-warning]").hidden = field("resolution").value !== "2k" && field("quality").value !== "xhigh";
            el("[data-generate]").disabled = busy || checkingFiles || active(job) || job?.status === "confirming" || !loaded || !enabled || !supported || (field("landscape").checked && !landscapeSupported);
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
            el("[data-attach]").disabled = frozen || !conceptSupported || references.length >= 3;
            el("[data-reference-picker]").disabled = frozen || loadingReferences || !npcs.length || references.filter(isConcept).length === 3;
            el("[data-reference-reload]").disabled = frozen || loadingReferences || !loadReferences;
            el("[data-reference-status]").textContent = loadingReferences ? "Aggiorno tutti gli NPC della campagna…" : referenceError || `${npcs.length} NPC della campagna · personaggi e creature di tutte le categorie`;
            el("[data-reference-status]").classList.toggle("is-error", Boolean(referenceError));
        }
        function isConcept(reference) { return Boolean(reference.file || reference.uploadId); }
        function previewUrl(blob) {
            const url = URL.createObjectURL(blob);
            conceptUrls.add(url);
            return url;
        }
        function clearConceptUrls() {
            for (const url of conceptUrls) URL.revokeObjectURL(url);
            conceptUrls.clear(); remotePreviews.clear();
        }
        function showConceptImage(reference, image) {
            if (reference.url) { image.src = reference.url; return; }
            const id = reference.uploadId;
            if (!remotePreviews.has(id)) {
                remotePreviews.set(id, request(`/concepts/${id}`).then(response => response.blob()).then(blob => closed ? '' : previewUrl(blob))
                    .catch(() => { remotePreviews.delete(id); return ''; }));
            }
            remotePreviews.get(id).then(url => { if (url && image.isConnected) image.src = url; });
        }
        const noteStatus = (text, error = false) => {
            el("[data-concept-status]").textContent = text;
            el("[data-concept-status]").classList.toggle("is-error", error);
        };
        function renderReferences() {
            field("description").required = !references.some(ref => isConcept(ref) && ref.purpose === 'character');
            el("[data-description-hint]").hidden = field("description").required;
            el("[data-reference-count]").textContent = `${references.length} / 3 · facoltative`;
            const root = el("[data-references]"); root.replaceChildren();
            references.forEach((reference, index) => {
                const npc = npcs.find(npc => npc.managedActorWorldId === reference.worldId && npc.managedActorId === reference.actorId);
                const card = document.createElement("article"); card.className = "npc-generator__reference";
                const image = document.createElement("img"); image.alt = "";
                if (isConcept(reference)) { image.alt = reference.name; showConceptImage(reference, image); }
                else if (imagePath(npc, reference.purpose)) image.src = app.utils.resolveImageUrl(imagePath(npc, reference.purpose));
                else image.hidden = true;
                const name = document.createElement("strong"); name.textContent = reference.name || npc?.name || "NPC";
                const label = document.createElement("label"); label.textContent = isConcept(reference) ? "Ruolo dell’immagine" : "Riprendi da questo NPC";
                const select = document.createElement("select"); select.setAttribute("aria-label", `Riferimento da ${name.textContent}`);
                for (const [value, text] of Object.entries(isConcept(reference) ? conceptPurposes : purposes)) {
                    const option = new Option(text, value);
                    option.disabled = !isConcept(reference) && (npc ? !wikiImage(imagePath(npc, value)) : value !== reference.purpose);
                    select.add(option);
                }
                select.value = reference.purpose;
                select.addEventListener("change", () => { reference.purpose = select.value; renderReferences(); });
                label.appendChild(select);
                const note = document.createElement("textarea"); note.rows = 2; note.maxLength = 300; note.placeholder = "Dettagli da riprendere (facoltativi)"; note.value = reference.note || ""; note.setAttribute("aria-label", `Nota per ${name.textContent}`);
                note.addEventListener("input", () => { reference.note = note.value; });
                const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Rimuovi"; remove.setAttribute("aria-label", `Rimuovi ${name.textContent}`);
                remove.addEventListener("click", () => {
                    if (reference.url) { URL.revokeObjectURL(reference.url); conceptUrls.delete(reference.url); }
                    references.splice(index, 1); renderReferences();
                    noteStatus("PNG, JPEG o WebP. Fino a 3 riferimenti, 12 MB per immagine e 24 MB in totale.");
                });
                card.append(image, name, label, note, remove); root.appendChild(card);
            });
            controls();
        }
        el("[data-attach]").addEventListener("click", () => el("[data-concept-files]").click());
        el("[data-concept-files]").addEventListener("change", async event => {
            const files = Array.from(event.target.files || []); event.target.value = "";
            if (!files.length || locked()) return;
            const added = [];
            checkingFiles = true; controls();
            try {
                if (references.length + files.length > 3) throw new Error("Puoi usare fino a tre riferimenti. Rimuovine uno o scegli meno file.");
                let total = references.reduce((sum, ref) => sum + (ref.file?.size || 0), 0);
                for (const file of files) {
                    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || !file.size) throw new Error("Scegli immagini PNG, JPEG o WebP.");
                    total += file.size;
                    if (file.size > 12 * 1024 * 1024 || total > 24 * 1024 * 1024) throw new Error("Il limite è 12 MB per immagine e 24 MB in totale.");
                    const url = previewUrl(file), image = new Image();
                    added.push({file, url, name: file.name.slice(0, 180), purpose: 'character', note: ''});
                    image.src = url;
                    try { await image.decode(); } catch { throw new Error(`Impossibile leggere l’immagine ${file.name}.`); }
                    if (closed) return;
                }
                references.push(...added); noteStatus("Scegli il ruolo e aggiungi eventuali indicazioni per ciascuna immagine.");
            } catch (error) {
                for (const ref of added) { URL.revokeObjectURL(ref.url); conceptUrls.delete(ref.url); }
                noteStatus(error.message, true);
            } finally { checkingFiles = false; if (!closed) renderReferences(); }
        });
        async function reloadReferences() {
            if (!loadReferences || loadingReferences || closed) return;
            loadingReferences = true; referenceError = ""; controls();
            try {
                const catalog = await loadReferences({ signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
                if (!closed) npcs = catalog;
            } catch (_) {
                if (!closed) referenceError = `Non riesco ad aggiornare l'elenco. ${npcs.length} NPC già caricati; puoi riprovare con «Aggiorna elenco».`;
            } finally { loadingReferences = false; if (!closed) { renderReferences(); } }
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
            field("landscape").checked = (input.aspectRatio ?? input.options?.aspectRatio) === "16:9";
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
            el("[data-token-background]").textContent = job?.hasToken && job.tokenBackground !== "transparent"
                ? "Questa anteprima usa lo sfondo precedente. Rigenera solo il token per ottenere l'esterno trasparente."
                : "Il modello sceglie angolazione e posa del token. Cornice circolare intera, esterno trasparente.";
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
                const oldId = job?.id;
                job = payload.job; loaded = true; enabled = payload.enabled && payload.version === 1 && payload.tokenTransparencyVersion === 1; canStop = payload.canStop === true;
                landscapeSupported = payload.landscapeAvatar === true;
                conceptSupported = payload.conceptReferences === 1;
                if (!conceptSupported) noteStatus("Aggiorna il servizio per allegare immagini. Puoi scegliere gli NPC di esempio.");
                resolutions = payload.supportedResolutions || []; qualities = payload.supportedQualities || [];
                if (pendingRequest && job?.id === pendingRequest.requestId) remember(null);
                if (!pendingRequest && job && oldId !== job.id) { clearPreviews(); restore(job, job.references); }
                await showJob();
                if (payload.version !== 1 || payload.tokenTransparencyVersion !== 1) status("Aggiorna il servizio per generare NPC con token trasparenti.", true);
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
            if (busy || checkingFiles || !loaded || !enabled || active(job) || job?.status === "confirming") return;
            if (!worldControl.value.trim()) el(".npc-generator__settings").open = true;
            if (!pendingRequest && !tokenOnly && !form.reportValidity()) return;
            if (!pendingRequest && job?.status === "uncertain" && !window.confirm("La richiesta precedente potrebbe essere stata addebitata. Avviare una nuova generazione a pagamento?")) return;
            busy = true; clearTimeout(timer);
            controls();
            try {
                if (!pendingRequest) {
                    if (!tokenOnly) {
                        if (checkName && !await checkName()) return;
                        for (const reference of references.filter(isConcept)) {
                            if (!conceptSupported) throw new Error("Aggiorna il servizio per generare con le immagini allegate.");
                            if (reference.uploadId) continue;
                            status(`Caricamento di ${reference.name}…`);
                            const uploaded = await (await request("/concepts", reference.file)).json();
                            if (!uploaded.uploadId) throw new Error("Caricamento del concept non confermato.");
                            reference.uploadId = uploaded.uploadId;
                        }
                    }
                    const refs = tokenOnly ? job.references : references.map(({uploadId, name, worldId, actorId, purpose, note}) =>
                        ({...(uploadId ? {uploadId, name} : {worldId, actorId}), purpose, note}));
                    if (closed) return;
                    remember({ requestId: crypto.randomUUID(), aspectRatio: tokenOnly ? job.options?.aspectRatio || "9:16" : selectedRatio(), form: readForm(), references: refs, quality: field("quality").value, resolution: field("resolution").value,
                        ...(job && job.status !== "accepted" ? { parentJobId: job.id, draftId: job.draftId } : {}), ...(tokenOnly ? { tokenOnly: true } : {}) });
                }
                const suffix = pendingRequest.tokenOnly ? `/${pendingRequest.parentJobId}/retry-token` : "";
                status("Invio della richiesta…");
                const payload = await (await request(suffix, pendingRequest)).json();
                if (closed) return;
                job = payload.job; remember(null); clearPreviews(); await showJob();
                try { localStorage.setItem(worldStorage, worldControl.value); } catch (_) {}
            } catch (error) {
                if (!pendingRequest) { if (!closed) status(error.message, true); return; }
                if (error.status && error.status < 500) remember(null);
                if (!closed) { loaded = false; status(`${error.message} Controlla lo stato prima di inviare altre richieste.`, true); el("[data-refresh]").hidden = false; timer = setTimeout(refresh, 10000); }
            } finally { busy = false; if (!closed) controls(); }
        }
        el("[data-generate]").addEventListener("click", () => generate());
        el("[data-retry-token]").addEventListener("click", () => generate(true));
        el("[data-refresh]").addEventListener("click", refresh);
        el("[data-reference-reload]").addEventListener("click", reloadReferences);
        el("[data-reference-picker]").addEventListener("click", async () => {
            if (locked() || loadingReferences) return;
            try {
                const { openNpcReferencePicker } = await import(referencePickerUrl);
                const concepts = references.filter(isConcept);
                if (!closed && !locked()) referencesPicker = openNpcReferencePicker({ npcs, references: references.filter(ref => !isConcept(ref)), limit: 3 - concepts.length, categories, usable: (npc, purpose) => wikiImage(imagePath(npc, purpose)), resolveImageUrl: path => app.utils.resolveImageUrl(path), onApply: next => { references = [...concepts, ...next]; renderReferences(); } });
            } catch (_) { if (!closed) status("Non riesco ad aprire la selezione degli NPC. Ricarica la pagina e riprova.", true); }
        });
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
            job = null; references = []; clearPreviews(); clearConceptUrls(); form.reset(); worldControl.value = selectedWorld; field("kind").value = initialKind; renderReferences();
            noteStatus("PNG, JPEG o WebP. Fino a 3 riferimenti, 12 MB per immagine e 24 MB in totale.");
            status("Descrivi il nuovo NPC: preparerò prima l'avatar e poi il token."); field("name").focus();
        });
        el("[data-confirm]").addEventListener("click", async () => {
            if (busy || !["ready", "confirming"].includes(job?.status)) return;
            if (!worldControl.value.trim()) el(".npc-generator__settings").open = true;
            if (job.status !== "confirming") {
                const description = field("description"), required = description.required;
                description.required = !job.references.some(ref => ref.uploadId && ref.purpose === 'character');
                const valid = form.reportValidity(); description.required = required;
                if (!valid) return;
            }
            busy = true; applying = true; clearTimeout(timer); el("[data-close]").disabled = true; controls(); status("Creazione dell'NPC e invio a Foundry…");
            try {
                if (job.status === "ready" && checkName && !await checkName()) {
                    status("Correggi il nome e conferma di nuovo. Le anteprime sono pronte.");
                    return;
                }
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
                if (part === "token") zoom.classList.add("npc-generator-token-zoom");
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
            referencesPicker?.close();
            if (zoom) { zoom.close(); zoom.remove(); zoom = null; }
            clearPreviews(); clearConceptUrls(); dialog.close(); dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus();
        }
        el("[data-close]").addEventListener("click", close);
        dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
        dialog.showModal(); renderReferences();
        reloadReferences();
        try {
            const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
            storageKey = `npc-generation:${campaign}:${Array.from(digest.slice(0, 12), byte => byte.toString(16).padStart(2, "0")).join("")}`;
            pendingRequest = JSON.parse(sessionStorage.getItem(storageKey));
            if (pendingRequest) restore(pendingRequest, pendingRequest.references);
        } catch (_) {}
        if (!closed) refresh();
    }
})();
