(() => {
    "use strict";
    window.CriptaNpcPoses = {open};

    async function open({actor, token, resolveMedia, onApplied}) {
        if (!actor || !token || document.querySelector("[data-npc-poses]")) return;
        const app = window.CriptaApp;
        const base = `api/managed-actors/${encodeURIComponent(actor.worldId)}/${encodeURIComponent(actor.actorId)}/poses`;
        const dialog = document.createElement("dialog"), previousFocus = document.activeElement;
        dialog.className = "npc-avatar-generator npc-actor-poses";
        dialog.dataset.npcPoses = "";
        dialog.setAttribute("aria-labelledby", "npc-actor-poses-title");
        dialog.innerHTML = `<header><div><small data-name></small><h2 id="npc-actor-poses-title">Genera pose idle e hover</h2></div><button type="button" data-close aria-label="Chiudi">×</button></header>
          <div class="npc-avatar-generator__body"><p data-status class="npc-avatar-generator__status" role="status">Caricamento delle pose…</p>
          <div class="npc-actor-poses__workspace"><figure><figcaption data-caption>Anteprima</figcaption>
            <div data-stage><img data-idle hidden alt="Posa a riposo"><img data-hover hidden alt="Posa hover"><span data-placeholder>L’anteprima dell’idle apparirà qui.</span></div>
            <button type="button" data-test aria-pressed="false" hidden>Prova la transizione</button></figure>
          <section><h3>Posa a riposo</h3>
            <label data-choice hidden>Idle da usare<select data-source><option value="proposal">Idle della proposta</option><option value="current">Idle della scheda</option></select></label>
            <div class="npc-actor-poses__buttons"><button type="button" data-generate-idle>Genera idle</button><button type="button" data-upload>Carica idle</button><input type="file" data-file hidden accept="image/webp"></div>
            <small>Puoi caricare un WebP quadrato trasparente, fino a 12 MB.</small>
            <label class="npc-avatar-generator__direction">Indicazioni per l’hover <span>(facoltative)</span><textarea data-direction maxlength="500" rows="2" placeholder="Ad esempio, alza lo scudo davanti alla spalla e si mette in guardia."></textarea></label>
            <button type="button" data-generate-hover>Genera hover</button></section></div></div>
          <footer><span>Ogni posa generata richiede una chiamata AI. Conferma per salvarla.</span><div><button type="button" data-refresh>Aggiorna</button><button type="button" data-stop hidden>Interrompi attesa</button><button type="button" data-retry hidden>Riprova invio</button><button type="button" class="npc-avatar-generator__confirm" data-apply disabled>Applica pose</button></div></footer>`;
        const el = key => dialog.querySelector(`[data-${key}]`);
        el("name").textContent = actor.name;
        document.body.append(dialog);
        const controller = new AbortController(), images = {};
        let state, job, busy = false, applying = false, timer, pending, storageKey, source = "current";
        const running = () => ["pending", "running"].includes(job?.status);
        const proposal = () => source === "proposal" && job && job.status !== "accepted";
        const status = (message, error = false) => { el("status").textContent = message; el("status").classList.toggle("is-error", error); };
        const remember = value => {
            pending = value;
            try { if (storageKey) { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } } catch {}
        };
        async function request(suffix = "", body) {
            const file = body instanceof Blob;
            const response = await fetch(app.urls.api(base + suffix), {method:body === undefined ? "GET" : "POST",
                headers:{Authorization:"Bearer " + token, ...(body !== undefined ? {"Content-Type":file ? body.type : "application/json"} : {})},
                body:body === undefined || file ? body : JSON.stringify(body), cache:"no-store",
                signal:AbortSignal.any([controller.signal, AbortSignal.timeout(file ? 90000 : 25000)])});
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw Object.assign(new Error(data.error || (response.status === 404 ? "Aggiorna il Worker per usare le pose sugli NPC esistenti." : "Servizio delle pose non disponibile.")), {status:response.status});
            }
            return response;
        }
        function controls() {
            const frozen = busy || running() || job?.status === "confirming" || !state || Boolean(pending);
            el("source").disabled = frozen;
            el("choice").hidden = !(job?.hasIdle && job.status !== "accepted" && state?.canUseIdle);
            el("source").value = source;
            el("generate-idle").disabled = frozen || !state?.enabled || !state?.canGenerateIdle;
            el("upload").disabled = frozen;
            el("direction").disabled = frozen;
            el("generate-hover").disabled = frozen || !state?.enabled || !images.idle || !(proposal() ? job.hasIdle : state?.canUseIdle);
            el("apply").disabled = busy || !proposal() || !job.hasHover || !["ready","confirming"].includes(job.status) || !images.hover || !images.idle;
            el("apply").textContent = job?.usesCurrentIdle ? "Applica hover" : "Applica le due pose";
            el("stop").hidden = !running(); el("stop").disabled = busy;
            el("retry").hidden = !pending; el("retry").disabled = busy;
            el("refresh").disabled = busy;
            el("close").disabled = applying;
            el("test").hidden = !images.hover || !images.idle;
        }
        async function imageFor(part, path, revision) {
            const key = revision || path, existing = images[part];
            if (existing && existing.key === key) return;
            const image = el(part);
            if (existing?.blob) URL.revokeObjectURL(existing.blob);
            delete images[part]; image.hidden = true; image.removeAttribute("src");
            if (!key) return;
            const blob = revision ? URL.createObjectURL(await (await request(`/${job.id}/${part}`)).blob()) : "";
            try {
                image.src = blob || resolveMedia(path);
                await image.decode();
                if (controller.signal.aborted) { if (blob) URL.revokeObjectURL(blob); return; }
                images[part] = {key, blob}; image.hidden = false;
            } catch (error) { if (blob) URL.revokeObjectURL(blob); throw error; }
        }
        async function render() {
            el("stage").classList.remove("show-hover"); el("test").setAttribute("aria-pressed", "false");
            const staged = proposal();
            el("caption").textContent = staged ? "Anteprima della proposta" : "Pose attuali della scheda";
            const results = await Promise.allSettled(["idle","hover"].map(part => imageFor(part,
                staged ? "" : state["current" + (part === "idle" ? "Idle" : "Hover")], staged ? job[part + "Revision"] : "")));
            el("placeholder").hidden = Boolean(images.idle || images.hover);
            if (running()) status(job.phase === "hover" ? "Generazione dell’hover dall’idle scelto…" : "Generazione dell’idle…");
            else if (job?.error) status(job.error, true);
            else if (pending) status("Invio da verificare. Puoi riprovare la stessa richiesta.");
            else if (staged && job.hasHover) status("Prova la transizione, poi applicala alla scheda.");
            else if (staged && job.hasIdle) status("Controlla l’idle e genera l’hover quando sei soddisfatto.");
            else if (job?.status === "accepted") status("Le pose sono salvate nella scheda.");
            else if (!state.enabled) status("Il generatore AI deve essere attivato dall’amministratore.");
            else if (state.canUseIdle) status("Puoi generare l’hover direttamente dall’idle della scheda.");
            else status(state.canGenerateIdle ? "Genera l’idle del personaggio oppure caricane uno tuo." : "Carica un idle da usare per la nuova posa.");
            if (results.some(result => result.status === "rejected")) status("Impossibile visualizzare una posa. Premi Aggiorna per riprovare.", true);
            if (running()) timer = setTimeout(refresh, 4000);
        }
        async function load() {
            const next = await (await request()).json(), old = job;
            state = next; job = next.job;
            if (pending?.requestId === job?.id) remember(null);
            if (job?.baseline !== state.baseline && !running() && !["accepted","confirming"].includes(job?.status)) job = null;
            if (!job || job.status === "accepted") source = "current";
            else if (old?.id !== job.id) {
                source = job.hasIdle || job.phase === "idle" ? "proposal" : "current";
                if (job.poseDirection) el("direction").value = job.poseDirection;
            }
            await render();
        }
        async function run(task) {
            if (busy || controller.signal.aborted) return;
            clearTimeout(timer); busy = true; controls();
            try { await task(); } catch (error) {
                if (!controller.signal.aborted) {
                    status(error.message, true);
                    if (running() || pending || applying) timer = setTimeout(refresh, 5000);
                }
            } finally { busy = false; applying = false; if (!controller.signal.aborted) controls(); }
        }
        function refresh() { return run(load); }
        async function send() {
            let sent;
            try { sent = (await (await request("", pending)).json()).job; }
            catch (error) { if (error.status && error.status < 500) remember(null); throw error; }
            await load();
            if (pending && sent?.id === pending.requestId) {
                remember(null);
                status("È disponibile una proposta più recente per questo NPC.");
            }
        }
        function generate(action, file) {
            return run(async () => {
                let uploadId;
                if (file) {
                    if (file.type !== "image/webp" || file.size > 12 * 1024 * 1024) throw new Error("Scegli un WebP fino a 12 MB.");
                    uploadId = (await (await request("/upload", file)).json()).uploadId;
                }
                remember({requestId:crypto.randomUUID(), action, baseline:state.baseline, direction:el("direction").value.trim(), uploadId,
                    ...(action === "hover" && proposal() ? {parentJobId:job.id, idleRevision:images.idle.key} : {})});
                await send();
            });
        }
        function close() {
            if (applying) return;
            clearTimeout(timer); controller.abort();
            for (const image of Object.values(images)) if (image.blob) URL.revokeObjectURL(image.blob);
            dialog.close(); dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus();
        }
        el("close").onclick = close; dialog.oncancel = event => { event.preventDefault(); close(); };
        el("generate-idle").onclick = () => generate("idle");
        el("generate-hover").onclick = () => generate("hover");
        el("upload").onclick = () => el("file").click();
        el("file").onchange = event => { const file = event.target.files[0]; event.target.value = ""; if (file) generate("upload", file); };
        el("source").onchange = () => { source = el("source").value; return run(render); };
        el("test").onclick = () => el("test").setAttribute("aria-pressed", String(el("stage").classList.toggle("show-hover")));
        el("refresh").onclick = refresh; el("retry").onclick = () => run(send);
        el("stop").onclick = () => run(async () => { await request(`/${job.id}/stop`, {}); await load(); });
        el("apply").onclick = () => run(async () => {
            applying = true; controls();
            await request(`/${job.id}/confirm`, {idleRevision:images.idle.key, hoverRevision:images.hover.key});
            applying = false; close(); await onApplied();
        });
        dialog.showModal(); controls();
        try {
            const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
            storageKey = [base, actor.campaignId || app.campaigns.currentId(), ...bytes.slice(0, 12)].join(":");
            pending = JSON.parse(sessionStorage.getItem(storageKey));
        } catch {}
        await refresh();
    }
})();
