(function () {
    "use strict";
    window.CriptaAvatarGenerator = { open };

    function open({ actor, token, referenceUrl, onApplied }) {
        if (document.querySelector("[data-avatar-generator]")) return;
        const app = window.CriptaApp;
        const base = `api/managed-actors/${encodeURIComponent(actor.worldId)}/${encodeURIComponent(actor.actorId)}/avatar-generation`;
        const storageKey = `avatar-generation:${app.campaigns.currentId()}:${actor.worldId}:${actor.actorId}`;
        let pendingRequest = null;
        try { pendingRequest = JSON.parse(sessionStorage.getItem(storageKey)); } catch (_) { /* Storage may be unavailable. */ }
        const previousFocus = document.activeElement;
        const dialog = document.createElement("dialog");
        dialog.className = "npc-avatar-generator";
        dialog.dataset.avatarGenerator = "";
        dialog.setAttribute("aria-labelledby", "npc-avatar-generator-title");
        dialog.innerHTML = `
          <header><div><small>ILLUSTRAZIONE DEL PERSONAGGIO</small><h2 id="npc-avatar-generator-title">Genera avatar</h2></div><button type="button" data-close aria-label="Chiudi">×</button></header>
          <div class="npc-avatar-generator__body">
            <p data-name></p>
            <p class="npc-avatar-generator__status" data-status role="status" aria-live="polite">Caricamento…</p>
            <button type="button" data-refresh hidden>Riprova caricamento</button><p data-stop-note class="npc-avatar-generator__hint" hidden>Interrompere l’attesa libera il generatore. Non garantisce l’annullamento della chiamata o del relativo costo.</p>
            <div class="npc-avatar-generator__images">
              <figure><figcaption>Avatar attuale · riferimento</figcaption><div><img data-reference alt="Avatar attuale usato come riferimento"><button type="button" data-enlarge="reference" aria-label="Ingrandisci avatar attuale">⤢ Ingrandisci</button></div></figure>
              <figure><figcaption>Nuova proposta</figcaption><div><img data-preview alt="Anteprima del nuovo avatar" hidden><p data-placeholder>La nuova illustrazione apparirà qui.</p><button type="button" data-enlarge="preview" aria-label="Ingrandisci nuova proposta" hidden>⤢ Ingrandisci</button></div></figure>
            </div>
            <div class="npc-avatar-generator__options">
              <label>Qualità<select data-quality aria-describedby="npc-avatar-cost-warning"><option value="medium">Media</option><option value="high" selected>Alta</option><option value="xhigh" disabled>Extra alta · alto costo</option></select></label>
              <label>Risoluzione<select data-resolution aria-describedby="npc-avatar-cost-warning"><option value="medium">Media · 864 × 1536</option><option value="high" selected>Alta · 1296 × 2304</option><option value="2k" disabled>2K · 1440 × 2560 · alto costo</option></select></label>
            </div>
            <p class="npc-avatar-generator__hint">Qualità e risoluzione più alte consumano più budget.</p>
            <p class="npc-avatar-generator__cost" id="npc-avatar-cost-warning" data-cost-warning role="note" aria-live="polite" hidden><strong>Solo per NPC importanti, alto costo!</strong></p>
            <p class="npc-avatar-generator__hint" data-options-unavailable hidden>Queste impostazioni richiedono il Worker aggiornato.</p>
            <label class="npc-avatar-generator__direction">Dettagli aggiuntivi <span>(facoltativi)</span><textarea maxlength="1500" rows="3" data-details placeholder="Ad esempio: posa fiera, mantello mosso dal vento, una cripta sullo sfondo…"></textarea></label>
            <p class="npc-avatar-generator__hint">Figura intera · nuova posa · verticale 9:16. L’avatar attuale viene inviato come riferimento al servizio di generazione OpenAI.</p>
            <details><summary>Stile artistico fisso</summary><p data-style></p></details>
          </div>
          <footer><span>Ogni generazione usa il budget API. L’avatar cambia solo con la tua conferma.</span><div><button type="button" data-stop hidden>Interrompi attesa</button><button type="button" data-generate disabled>Genera anteprima</button><button type="button" class="npc-avatar-generator__confirm" data-confirm disabled>Usa questo avatar</button></div></footer>`;
        document.body.appendChild(dialog);
        const el = (selector) => dialog.querySelector(selector);
        el("[data-name]").textContent = actor.name || "NPC";
        el("[data-reference]").src = referenceUrl;
        if (pendingRequest?.details) el("[data-details]").value = pendingRequest.details;
        const restoreOptions = (options = {}) => {
            el("[data-quality]").value = ["medium", "high", "xhigh"].includes(options.quality) ? options.quality : "high";
            el("[data-resolution]").value = ["medium", "high", "2k"].includes(options.resolution) ? options.resolution : "high";
        };
        restoreOptions(pendingRequest || {});
        let job = null, enabled = false, canStop = false, busy = false, loaded = false, closed = false, applying = false;
        let supportedResolutions = ["medium", "high"];
        let supportedQualities = ["medium", "high"];
        let disabledReason = "Il generatore deve essere attivato dall’amministratore.";
        let previewId = "", previewUrl = "", timer = null, zoomDialog = null;
        const controller = new AbortController();
        const request = async (suffix = "", body) => {
            const response = await fetch(app.urls.api(base + suffix), {
                method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
                headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                const error = new Error(payload.error || (response.status === 404 ? "Il generatore non è ancora disponibile: aggiorna il Worker." : "Impossibile contattare il generatore."));
                error.status = response.status; throw error;
            }
            return response;
        };
        const status = (message, error = false) => {
            el("[data-status]").textContent = message;
            el("[data-status]").classList.toggle("is-error", error);
        };
        const controls = () => {
            const running = ["pending", "running"].includes(job?.status);
            const resolution = pendingRequest?.resolution || el("[data-resolution]").value;
            const quality = pendingRequest?.quality || el("[data-quality]").value;
            const supported = supportedResolutions.includes(resolution) && supportedQualities.includes(quality);
            el('[data-resolution] option[value="2k"]').disabled = !supportedResolutions.includes("2k");
            el('[data-quality] option[value="xhigh"]').disabled = !supportedQualities.includes("xhigh");
            el("[data-cost-warning]").hidden = resolution !== "2k" && quality !== "xhigh";
            el("[data-options-unavailable]").hidden = !loaded || supported;
            el("[data-stop]").hidden = !running || !canStop;
            el("[data-stop]").disabled = busy || !running;
            el("[data-stop-note]").hidden = !running || !canStop;
            el("[data-generate]").disabled = busy || running || !enabled || !loaded || !supported;
            el("[data-generate]").textContent = running ? "Generazione in corso…" : pendingRequest ? "Riprova invio" : job ? "Genera un’altra proposta" : "Genera anteprima";
            el("[data-confirm]").disabled = busy || job?.status !== "ready" || previewId !== job?.id;
            el("[data-details]").disabled = busy || running || !enabled || Boolean(pendingRequest);
            el("[data-quality]").disabled = busy || running || !enabled || Boolean(pendingRequest);
            el("[data-resolution]").disabled = busy || running || !enabled || Boolean(pendingRequest);
            dialog.setAttribute("aria-busy", String(busy || running));
        };
        const rememberRequest = (value) => {
            pendingRequest = value;
            try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch (_) { /* Deduplication also runs on the server. */ }
        };
        const showJob = async () => {
            controls();
            if (["pending", "running"].includes(job?.status)) {
                const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(job.startedAt || job.createdAt)) / 1000));
                const elapsed = Number.isFinite(seconds) && seconds >= 60 ? ` In attesa da ${Math.floor(seconds / 60)} min.` : "";
                status(`Sto dipingendo il nuovo avatar.${elapsed} Puoi chiudere questa finestra e continuare a usare la wiki; l’anteprima resterà qui.`);
                el("[data-refresh]").hidden = false; el("[data-refresh]").textContent = "Controlla stato";
                timer = setTimeout(refresh, 10000);
                return;
            }
            if (["ready", "accepted"].includes(job?.status)) {
                if (previewId !== job.id) {
                    const response = await request(`/${job.id}/preview`);
                    const blob = await response.blob();
                    if (closed) return;
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    previewUrl = URL.createObjectURL(blob);
                    const image = el("[data-preview]");
                    image.src = previewUrl;
                    await image.decode();
                    if (closed) return;
                    image.hidden = false;
                    el("[data-placeholder]").hidden = true;
                    el('[data-enlarge="preview"]').hidden = false;
                    previewId = job.id;
                }
                status(job.status === "accepted" ? "Questa proposta è già stata confermata." : "Controlla la proposta. Se ti piace, scegli «Usa questo avatar».");
            } else if (job?.error) status(job.error, true);
            else status(enabled ? "Pronto: il ritratto attuale guiderà l’aspetto del personaggio." : disabledReason);
            if (!enabled) status(disabledReason, true);
            controls();
        };
        async function refresh() {
            clearTimeout(timer);
            el("[data-refresh]").hidden = true;
            busy = true;
            controls();
            try {
                const payload = await (await request()).json();
                if (closed) return;
                const previousId = job?.id;
                job = payload.job;
                canStop = payload.canStop === true;
                supportedResolutions = Array.isArray(payload.supportedResolutions) ? payload.supportedResolutions.filter(value => ["medium", "high", "2k"].includes(value)) : ["medium", "high"];
                supportedQualities = Array.isArray(payload.supportedQualities) ? payload.supportedQualities.filter(value => ["medium", "high", "xhigh"].includes(value)) : ["medium", "high"];
                enabled = payload.enabled && payload.optionsVersion === 1;
                disabledReason = payload.optionsVersion === 1
                    ? "Il generatore deve essere attivato dall’amministratore."
                    : "Aggiorna il Worker per generare con qualità e risoluzione selezionabili.";
                loaded = true;
                el("[data-style]").textContent = payload.style || "";
                if (job?.id && previousId !== job.id && (!pendingRequest || pendingRequest.requestId === job.id)) {
                    el("[data-details]").value = job.details || "";
                    restoreOptions(job.options || {});
                }
                if (pendingRequest && job?.id === pendingRequest.requestId) rememberRequest(null);
                await showJob();
            } catch (error) {
                if (!closed) {
                    loaded = false;
                    status(error.status ? error.message : "Non riesco ad aggiornare lo stato della generazione. Puoi chiudere la finestra; il controllo verrà ritentato senza generare un’altra immagine.", true);
                    el("[data-refresh]").hidden = false; el("[data-refresh]").textContent = "Riprova caricamento";
                    if (["pending", "running"].includes(job?.status) && ![400, 401, 403, 404].includes(error.status)) timer = setTimeout(refresh, 10000);
                }
            } finally { busy = false; if (!closed) controls(); }
        }
        el("[data-stop]").addEventListener("click", async () => {
            if (busy || !["pending", "running"].includes(job?.status)) return;
            busy = true; clearTimeout(timer); controls();
            try {
                const payload = await (await request(`/${job.id}/stop`, {})).json();
                if (closed) return;
                job = payload.job; rememberRequest(null); loaded = true;
                await showJob();
            } catch (error) {
                if (!closed) { status(`${error.message} Controlla lo stato prima di inviare altre richieste.`, true); timer = setTimeout(refresh, 10000); }
            } finally { busy = false; if (!closed) controls(); }
        });
        el("[data-generate]").addEventListener("click", async () => {
            if (busy || !enabled || !loaded || ["pending", "running"].includes(job?.status) || !supportedResolutions.includes(pendingRequest?.resolution || el("[data-resolution]").value) || !supportedQualities.includes(pendingRequest?.quality || el("[data-quality]").value)) return;
            if (job?.status === "uncertain" && !window.confirm("La richiesta precedente potrebbe essere stata addebitata. Avviare una nuova generazione a pagamento?")) return;
            busy = true;
            if (!pendingRequest) rememberRequest({ requestId: crypto.randomUUID(), details: el("[data-details]").value.trim(), quality: el("[data-quality]").value, resolution: el("[data-resolution]").value });
            controls();
            status("Invio della richiesta…");
            try {
                const payload = await (await request("", pendingRequest)).json();
                if (closed) return;
                job = payload.job;
                rememberRequest(null);
                if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ""; }
                previewId = "";
                el("[data-preview]").hidden = true;
                el('[data-enlarge="preview"]').hidden = true;
                el("[data-placeholder]").hidden = false;
                await showJob();
            } catch (error) {
                if (error.status && error.status < 500) rememberRequest(null);
                if (!closed) { loaded = false; status(`${error.message} Usa «Riprova caricamento» per verificare l’esito.`, true); el("[data-refresh]").hidden = false; el("[data-refresh]").textContent = "Riprova caricamento"; timer = setTimeout(refresh, 10000); }
            } finally { busy = false; if (!closed) controls(); }
        });
        el("[data-confirm]").addEventListener("click", async () => {
            if (busy || job?.status !== "ready") return;
            busy = true;
            applying = true;
            el("[data-close]").disabled = true;
            controls();
            status("Salvataggio dell’avatar…");
            try {
                const payload = await (await request(`/${job.id}/confirm`, {})).json();
                await onApplied(payload);
                applying = false;
                close();
            } catch (error) {
                if (!closed) status(error.message, true);
            } finally { busy = false; applying = false; if (!closed) { el("[data-close]").disabled = false; controls(); } }
        });
        function close() {
            if (closed || applying) return;
            closed = true;
            if (zoomDialog) { zoomDialog.close(); zoomDialog.remove(); zoomDialog = null; }
            controller.abort();
            clearTimeout(timer);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            dialog.close();
            dialog.remove();
            if (previousFocus?.isConnected) previousFocus.focus();
        }
        el("[data-close]").addEventListener("click", close);
        el("[data-resolution]").addEventListener("change", controls);
        el("[data-quality]").addEventListener("change", controls);
        el("[data-refresh]").addEventListener("click", refresh);
        el("[data-reference]").addEventListener("click", () => el('[data-enlarge="reference"]').click());
        el("[data-preview]").addEventListener("click", () => el('[data-enlarge="preview"]').click());
        dialog.querySelectorAll("[data-enlarge]").forEach((button) => button.addEventListener("click", () => {
            if (zoomDialog) return;
            const source = el(button.dataset.enlarge === "preview" ? "[data-preview]" : "[data-reference]");
            if (!source.src || source.hidden) return;
            zoomDialog = document.createElement("dialog");
            zoomDialog.className = "npc-avatar-zoom";
            zoomDialog.setAttribute("aria-label", source.alt);
            zoomDialog.innerHTML = '<header><strong></strong><div><button type="button" data-zoom-size aria-pressed="false">Dimensione reale</button><button type="button" data-zoom-close aria-label="Chiudi anteprima ingrandita">×</button></div></header><div class="npc-avatar-zoom__canvas"><img alt=""></div>';
            zoomDialog.querySelector("strong").textContent = source.alt;
            const image = zoomDialog.querySelector("img");
            image.src = source.src;
            image.alt = source.alt;
            const closeZoom = () => { zoomDialog.close(); zoomDialog.remove(); zoomDialog = null; button.focus(); };
            zoomDialog.querySelector("[data-zoom-close]").addEventListener("click", closeZoom);
            zoomDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeZoom(); });
            zoomDialog.querySelector("[data-zoom-size]").addEventListener("click", (event) => {
                const actual = zoomDialog.classList.toggle("is-actual-size");
                event.currentTarget.textContent = actual ? "Adatta allo schermo" : "Dimensione reale";
                event.currentTarget.setAttribute("aria-pressed", String(actual));
            });
            document.body.appendChild(zoomDialog);
            zoomDialog.showModal();
        }));
        dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
        dialog.showModal();
        refresh();
    }
})();
