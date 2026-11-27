(() => {
    "use strict";
    window.CriptaActorCard = {open};

    async function open({actor, token, resolveMedia, onApplied}) {
        if (document.querySelector("[data-actor-card]")) return;
        const app = window.CriptaApp, focus = document.activeElement;
        const base = `api/managed-actors/${encodeURIComponent(actor.worldId)}/${encodeURIComponent(actor.actorId)}/card-generation`;
        const dialog = document.createElement("dialog");
        dialog.className = "npc-avatar-generator";
        dialog.dataset.actorCard = "";
        dialog.setAttribute("aria-labelledby", "actor-card-title");
        dialog.innerHTML = `<header><div><small data-name></small><h2 id="actor-card-title">Genera card Foundry</h2></div><button type="button" data-close aria-label="Chiudi">×</button></header>
            <div class="npc-avatar-generator__body"><p>Sunburst 2.6 · qualità extra-alta · 1600 × 960 px. L’avatar della scheda guida il ritratto a destra. Il nome del personaggio appare a sinistra.</p>
            <p role="status" aria-live="polite" data-status class="npc-avatar-generator__status"></p>
            <figure hidden data-current><figcaption>Card attuale</figcaption><img alt="Card attuale"></figure>
            <figure hidden data-proposal><figcaption>Proposta</figcaption><img alt="Anteprima della card generata"></figure></div>
            <footer><span>Ogni nuova proposta usa una chiamata immagini.</span><div><button type="button" data-refresh>Aggiorna</button><button type="button" data-generate>Genera anteprima</button><button type="button" data-apply class="npc-avatar-generator__confirm">Applica card</button></div></footer>`;
        const el = name => dialog.querySelector(`[data-${name}]`);
        el("name").textContent = actor.name;
        const controller = new AbortController();
        let job, enabled = false, hasAvatar = false, busy = false, timer, previewUrl, previewId, requestId, confirmId;
        const savingMessage = "Salvataggio della card in corso. Puoi chiudere questa finestra.";
        const pending = () => ["pending", "running", "applying"].includes(job?.status);
        const status = (message, error = false) => {
            el("status").textContent = message;
            el("status").classList.toggle("is-error", error);
        };
        const controls = () => {
            el("generate").disabled = busy || pending() || Boolean(confirmId) || !enabled || !hasAvatar;
            el("generate").textContent = requestId ? "Riprova invio" : job ? "Genera un’altra proposta" : "Genera anteprima";
            el("apply").disabled = busy || Boolean(confirmId) || job?.status !== "ready" || previewId !== job.id;
            el("refresh").disabled = busy;
        };
        async function request(suffix = "", body) {
            const timeout = AbortSignal.timeout(30000);
            const response = await fetch(app.urls.api(base + suffix), {method:body ? "POST" : "GET", cache:"no-store",
                headers:{Authorization:"Bearer " + token, ...(body && {"Content-Type":"application/json"})},
                body:body && JSON.stringify(body), signal:body?.background ? timeout : AbortSignal.any([controller.signal, timeout])});
            if (!response.ok) {
                const message = (await response.json().catch(() => null))?.error || "Il generatore di card non è disponibile.";
                throw Object.assign(new Error(message), {status:response.status});
            }
            return response;
        }
        async function load() {
            const data = await (await request()).json();
            if (controller.signal.aborted) return;
            job = data.job; enabled = data.enabled; hasAvatar = data.hasAvatar === true;
            if (job?.status === "applying") confirmId = job.id;
            el("current").hidden = !data.card?.path;
            if (data.card?.path) el("current").querySelector("img").src = resolveMedia(data.card.path);
            if (job?.id === requestId) requestId = null;
            const ready = job?.status === "ready";
            if (ready && job.id !== previewId) {
                const blob = await (await request(`/${job.id}/preview`)).blob();
                if (controller.signal.aborted) return;
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                previewUrl = URL.createObjectURL(blob);
                const img = el("proposal").querySelector("img");
                img.src = previewUrl; await img.decode();
                previewId = job.id;
            }
            el("proposal").hidden = !ready;
            if (job?.error) status(job.error, true);
            else if (job?.status === "applying") status(savingMessage);
            else if (pending()) status(job.automatic ? "Card automatica in preparazione. Verrà salvata nella scheda." : "Generazione in corso. Puoi chiudere e ritrovare qui la proposta.");
            else if (job?.status === "accepted") status("Card salvata nella scheda.");
            else if (ready) status("Controlla il nome e il ritratto, poi applica la card.");
            else if (!hasAvatar) status("Carica e salva un avatar nella scheda per generare la card.");
            else status(enabled ? "Puoi generare la fascia dall’avatar e dal nome della scheda." : "Generazione immagini non attiva.");
        }
        async function refresh() {
            if (!confirmId) return load();
            const id = confirmId;
            try {
                const data = await (await request(`/${id}/confirm`)).json();
                if (controller.signal.aborted) return;
                if (data.job.status === "accepted") { close(); await onApplied(); return; }
                if (data.job.status === "applying") { job = data.job; status(savingMessage); return; }
            } catch (error) {
                if (!error.status || error.status >= 500 || error.status === 429 || error.status === 408) throw error;
                confirmId = null;
                if (![404,405,409].includes(error.status)) { job = null; throw error; }
            }
            confirmId = null;
            await load();
            if (controller.signal.aborted || job?.id !== id) return;
            if (job.status === "accepted") { close(); await onApplied(); }
            else if (job.status === "ready" && !job.error) status("La proposta è pronta. Premi «Applica card» per riprovare il salvataggio.");
        }
        async function run(task) {
            if (busy || controller.signal.aborted) return;
            busy = true; clearTimeout(timer); controls();
            try { await task(); }
            catch (error) {
                if (!controller.signal.aborted) {
                    const timedOut = error.name === "TimeoutError" || /signal timed out/i.test(error.message);
                    status(confirmId ? "In attesa di verificare il salvataggio della card…" : timedOut ? "Il servizio impiega più tempo del previsto. Premi «Aggiorna» per verificare lo stato." : error.message, true);
                }
            }
            finally {
                busy = false;
                if (!controller.signal.aborted) {
                    controls();
                    if (pending() || confirmId) timer = setTimeout(() => run(refresh), 4000);
                }
            }
        }
        function close() {
            clearTimeout(timer); controller.abort();
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            dialog.close(); dialog.remove(); if (focus?.isConnected) focus.focus();
        }
        el("close").onclick = close;
        dialog.oncancel = event => { event.preventDefault(); close(); };
        el("refresh").onclick = () => run(refresh);
        el("generate").onclick = () => run(async () => {
            requestId ||= crypto.randomUUID();
            await request("", {requestId});
            requestId = null;
            await load();
        });
        el("apply").onclick = () => run(async () => {
            confirmId = job.id;
            status("Invio della conferma…");
            try {
                const response = await request(`/${confirmId}/confirm`, {background:true});
                if (controller.signal.aborted) return;
                if (response.status === 200) {
                    close(); await onApplied();
                    return;
                }
                job = (await response.json()).job;
                status(savingMessage);
            } catch (error) {
                if (controller.signal.aborted) return;
                if (error.status && error.status < 500 && error.status !== 408 && error.status !== 429) {
                    confirmId = null;
                    throw error;
                }
                status("Verifica della conferma in corso…");
                await refresh();
            }
        });
        document.body.append(dialog); dialog.showModal();
        status("Caricamento della card…"); await run(load);
    }
})();
