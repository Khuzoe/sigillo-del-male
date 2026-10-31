(function () {
    "use strict";
    window.CriptaNpcSuggestions = {open};
    async function open({actor, token, referenceUrl, onDevelop}) {
        if (document.querySelector("[data-npc-suggestions]")) return;
        const app = window.CriptaApp;
        const base = `api/managed-actors/${encodeURIComponent(actor.worldId)}/${encodeURIComponent(actor.actorId)}/ability-suggestions`;
        const key = `npc-suggestions:${app.campaigns.currentId()}:${actor.worldId}:${actor.actorId}`;
        let retry = null;
        try { retry = JSON.parse(sessionStorage.getItem(key)); } catch {}
        const remember = value => { retry = value; try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch {} };
        let job = null, busy = false, loaded = false, enabled = false, hasAvatar = false, stale = false, closed = false, timer;
        const controller = new AbortController(), previousFocus = document.activeElement;
        const dialog = document.createElement("dialog");
        dialog.className = "npc-avatar-generator npc-ability-generator npc-suggestions";
        dialog.dataset.npcSuggestions = ""; dialog.setAttribute("aria-labelledby", "npc-suggestions-title");
        dialog.innerHTML = `<header><div><small>ISPIRAZIONE E BILANCIAMENTO</small><h2 id="npc-suggestions-title">Suggerisci modifiche</h2></div><button type="button" data-close aria-label="Chiudi">×</button></header>
          <div class="npc-avatar-generator__body">
            <div class="npc-suggestions-intro"><img data-reference alt="Avatar attuale dell’NPC" hidden><div><p data-name></p><p>Confronta l’aspetto del mostro con statistiche e capacità per trovare idee coerenti e miglioramenti utili.</p></div></div>
            <p data-status class="npc-avatar-generator__status" role="status" aria-live="polite">Caricamento…</p><details data-error-details class="npc-generation-error-details" hidden><summary>Dettagli del problema</summary><pre data-error-reference></pre></details>
            <label class="npc-avatar-generator__direction">Cosa vuoi migliorare? <span>(facoltativo)</span><textarea data-direction rows="2" maxlength="2000" placeholder="Ad esempio: mantieni il GS, rendilo più tattico; è un companion di supporto…"></textarea></label>
            <p class="npc-avatar-generator__hint">L’analisi invia avatar e scheda a OpenAI. Non genera immagini e non cambia l’NPC.</p>
            <p data-stale class="npc-suggestions-stale" hidden>La scheda o l’avatar sono cambiati dopo questa analisi. Rianalizza prima di sviluppare una delle idee.</p>
            <div data-report hidden>
              <p data-report-date class="npc-avatar-generator__hint"></p><p data-summary class="npc-ability-summary"></p>
              <details><summary>Dall’avatar</summary><ul data-visual></ul></details>
              <section data-strengths-section><h3>Da mantenere</h3><ul data-strengths></ul></section>
              <section data-adjustments-section><h3>Modifiche consigliate</h3><div data-adjustments></div></section>
              <section data-ideas-section><h3>Idee per nuove abilità</h3><p class="npc-avatar-generator__hint">Sviluppa un’idea per preparare una bozza modificabile. La generazione parte soltanto al tuo prossimo clic.</p><div data-ideas></div></section>
              <details data-uncertainties-section open><summary>Ipotesi e aspetti da verificare</summary><ul data-uncertainties></ul></details>
            </div>
          </div>
          <footer><span>I consigli non certificano il GS. Ogni nuova analisi usa il budget API; riaprire i risultati già pronti non li rigenera.</span><div><button type="button" data-analyze class="npc-avatar-generator__confirm" disabled>Analizza NPC</button></div></footer>`;
        document.body.appendChild(dialog);
        const el = selector => dialog.querySelector(selector);
        el("[data-name]").textContent = actor.name;
        if (referenceUrl) { el("[data-reference]").src = referenceUrl; el("[data-reference]").hidden = false; }
        if (retry?.details) el("[data-direction]").value = retry.details;
        const running = () => ["pending", "running"].includes(job?.status);
        const status = (message, error = false) => { el("[data-status]").textContent = message; el("[data-status]").classList.toggle("is-error", error); };
        const controls = () => {
            el("[data-analyze]").disabled = busy || running() || !loaded || !enabled || !hasAvatar;
            el("[data-analyze]").textContent = retry ? "Riprova invio" : running() ? "Analisi in corso…" : job ? "Rianalizza NPC" : "Analizza NPC";
            el("[data-direction]").disabled = busy || running() || Boolean(retry);
            el("[data-stale]").hidden = !stale || !job?.report;
            dialog.querySelectorAll("[data-develop]").forEach(button => button.disabled = busy || running() || stale || Boolean(retry));
            dialog.setAttribute("aria-busy", String(busy || running()));
        };
        const request = async body => {
            const response = await fetch(app.urls.api(base), {method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
                headers: {Authorization: `Bearer ${token}`, ...(body ? {"Content-Type": "application/json"} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
            const data = await response.json().catch(() => ({}));
            if (!response.ok) { const error = new Error(data.error || "Analisi non disponibile. Aggiorna il Worker e riprova."); error.status = response.status; throw error; }
            return data;
        };
        const list = (selector, values) => el(selector).replaceChildren(...values.map(text => { const li = document.createElement("li"); li.textContent = text; return li; }));
        const paragraph = (label, text) => { const p = document.createElement("p"), strong = document.createElement("strong"); strong.textContent = label; p.append(strong, document.createTextNode(text)); return p; };
        function renderReport() {
            const report = job?.report;
            el("[data-report]").hidden = !report;
            if (!report) return;
            el("[data-summary]").textContent = report.summary;
            const date = new Date(job.createdAt);
            el("[data-report-date]").textContent = Number.isNaN(date.getTime()) ? "Analisi salvata" : `Analisi del ${date.toLocaleString("it-IT", {dateStyle: "short", timeStyle: "short"})}`;
            list("[data-visual]", report.visualObservations); list("[data-strengths]", report.strengths); list("[data-uncertainties]", report.uncertainties);
            el("[data-strengths-section]").hidden = !report.strengths.length;
            el("[data-uncertainties-section]").hidden = !report.uncertainties.length;
            el("[data-adjustments]").replaceChildren();
            for (const advice of report.adjustments) {
                const card = document.createElement("article"), title = document.createElement("h4"), impact = document.createElement("span");
                card.className = "npc-suggestions-card"; title.textContent = advice.title;
                impact.className = "npc-suggestions-impact";
                impact.textContent = ({stronger: "Aumenta la potenza", weaker: "Riduce la potenza", neutral: "Potenza simile", uncertain: "Impatto da verificare"})[advice.impact];
                card.append(title, impact, paragraph("Ora: ", advice.current), paragraph("Proposta: ", advice.proposal), paragraph("Perché: ", advice.reason));
                el("[data-adjustments]").append(card);
            }
            if (!report.adjustments.length) el("[data-adjustments]").append(paragraph("", "Non sono emerse modifiche necessarie alla scheda."));
            el("[data-ideas]").replaceChildren();
            for (const idea of report.ideas) {
                const card = document.createElement("article"), title = document.createElement("h4"), button = document.createElement("button");
                card.className = "npc-suggestions-card"; title.textContent = idea.name;
                button.type = "button"; button.dataset.develop = ""; button.textContent = "Sviluppa abilità";
                button.addEventListener("click", async () => {
                    if (stale || busy || running()) return;
                    // Read again before handoff: a second tab or Foundry may have updated the NPC.
                    busy = true; controls();
                    try {
                        const latest = await request(); stale = Boolean(latest.stale);
                        if (stale || latest.job?.id !== job.id) { await show(latest); status("L’analisi è cambiata o non è più aggiornata. Controlla i risultati prima di continuare.", true); return; }
                        if (running() || latest.job?.status !== "ready") return;
                        busy = false;
                        close();
                        await onDevelop?.(idea.generatorPrompt);
                    } catch (error) { if (!closed) status(error.message, true); }
                    finally { busy = false; if (!closed) controls(); }
                });
                card.append(title, paragraph("", idea.concept), paragraph("Dall’avatar: ", idea.visualLink), paragraph("Nella scheda: ", idea.sheetLink), paragraph("Limite o compromesso: ", idea.tradeoff), button);
                el("[data-ideas]").append(card);
            }
            el("[data-ideas-section]").hidden = !report.ideas.length;
        }
        async function show(data) {
            if ("enabled" in data) { enabled = data.enabled && data.version === 1; hasAvatar = data.hasAvatar; loaded = true; }
            stale = Boolean(data.stale); job = data.job;
            const problem = job?.errorDetail || job?.iconErrorDetail;
            el("[data-error-details]").hidden = !job?.error && !job?.iconError;
            el("[data-error-reference]").textContent = problem
                ? [`Generazione: ${job.id}`, `Categoria: ${problem.code}`, problem.stage && `Fase: ${problem.stage}`, problem.httpStatus && `Risposta del servizio: ${problem.httpStatus}`, problem.providerCode && `Codice del servizio: ${problem.providerCode}`, problem.parameter && `Parametro: ${problem.parameter}`, problem.requestId && `Riferimento del servizio: ${problem.requestId}`].filter(Boolean).join("\n")
                : "Questa generazione non conserva il dettaglio della causa. L’aggiornamento lo registra per i nuovi tentativi.";
            if (retry?.requestId === job?.id) remember(null);
            if (!el("[data-direction]").value && job?.details) el("[data-direction]").value = job.details;
            renderReport();
            if (running()) { status("Sto confrontando avatar e scheda. Puoi chiudere e ritrovare l’analisi qui."); timer = setTimeout(refresh, 5000); }
            else if (job?.error) status(job.error, true);
            else if (!enabled) status("Il servizio deve essere attivato dall’amministratore.");
            else if (!hasAvatar) status("Carica e salva un avatar sulla wiki prima di richiedere l’analisi.");
            else status(job?.report ? "Consigli pronti. Nessuna modifica è stata applicata all’NPC." : "Premi Analizza NPC per ricevere consigli e idee.");
            controls();
        }
        async function refresh() {
            clearTimeout(timer);
            try { const data = await request(); if (!closed) await show(data); }
            catch (error) { if (!closed) { status(error.message, true); controls(); if (running()) timer = setTimeout(refresh, 10000); } }
        }
        el("[data-analyze]").addEventListener("click", async () => {
            if (busy || running()) return;
            busy = true; clearTimeout(timer); controls();
            remember(retry || {requestId: crypto.randomUUID(), details: el("[data-direction]").value.trim()});
            try { const data = await request(retry); remember(null); await show(data); }
            catch (error) { if (error.status && error.status < 500) remember(null); if (!closed) status(error.message, true); }
            finally { busy = false; if (!closed) controls(); }
        });
        function close() {
            if (busy) return;
            closed = true; clearTimeout(timer); controller.abort(); dialog.close(); dialog.remove(); previousFocus?.focus();
        }
        el("[data-close]").addEventListener("click", close);
        dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
        dialog.showModal(); await refresh();
    }
})();
