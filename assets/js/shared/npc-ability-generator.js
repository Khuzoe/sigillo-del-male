(function () {
    "use strict";
    const schemaUrl = new URL("npc-ability-schema.mjs?v=20261030-optional-fields1", document.currentScript.src).href;
    window.CriptaAbilityGenerator = {open};
    async function open({actor, token, onQueued, initialDetails = ""}) {
        if (document.querySelector("[data-ability-generator]")) return;
        const {validateAbility, abilitySummary, DAMAGE_TYPES, CONDITIONS, ABILITIES, LABELS} = await import(schemaUrl);
        const app = window.CriptaApp;
        const base = `api/managed-actors/${encodeURIComponent(actor.worldId)}/${encodeURIComponent(actor.actorId)}/ability-generation`;
        const key = `ability-generation:${app.campaigns.currentId()}:${actor.worldId}:${actor.actorId}`;
        const readLocal = k => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } };
        const writeLocal = (k, value) => { try { if (value) sessionStorage.setItem(k, JSON.stringify(value)); else sessionStorage.removeItem(k); } catch {} };
        let retry = readLocal(key), job = null, busy = false, enabled = false, canSync = false, canStop = false, loaded = false, timer, closed = false, previewUrl = "", previewId = "";
        let startFresh = Boolean(initialDetails) && !retry;
        const controller = new AbortController(), previousFocus = document.activeElement;
        const dialog = document.createElement("dialog");
        dialog.className = "npc-avatar-generator npc-ability-generator";
        dialog.dataset.abilityGenerator = "";
        dialog.setAttribute("aria-labelledby", "ability-generator-title");
        dialog.innerHTML = `<header><div><small>CAPACITÀ NPC</small><h2 id="ability-generator-title">Crea abilità con AI</h2></div><button type="button" data-close aria-label="Chiudi">×</button></header>
          <div class="npc-avatar-generator__body">
            <p data-name></p><p class="npc-avatar-generator__status" data-status role="status" aria-live="polite">Caricamento…</p><details data-error-details class="npc-generation-error-details" hidden><summary>Dettagli del problema</summary><pre data-error-reference></pre></details>
            <label class="npc-avatar-generator__direction">Cosa deve fare?<textarea data-prompt maxlength="2000" rows="3" placeholder="Morde un bersaglio entro 10 piedi. Un TS Costituzione evita danni necrotici aggiuntivi, che curano il mostro."></textarea></label>
            <label class="npc-ability-check"><input type="checkbox" data-with-icon> Genera anche l’icona dall’avatar · 512 × 512</label>
            <p class="npc-avatar-generator__hint">La scheda dell’NPC viene inviata a OpenAI per proporre valori coerenti. Con l’icona viene inviato anche l’avatar. Ogni generazione usa il budget API.</p>
            <p data-stop-note class="npc-avatar-generator__hint" hidden>Interrompere l’attesa libera il generatore e conserva la bozza già pronta. Non garantisce l’annullamento del costo della chiamata.</p><section data-proposal hidden>
              <div class="npc-ability-heading"><div><h3 data-proposal-name>La tua proposta</h3><section class="npc-ability-summary" aria-label="Come funziona"><div data-summary></div></section></div><div class="npc-ability-icon"><img data-icon alt="Icona della capacità" hidden><button type="button" data-icon-generate>Genera icona</button><label class="npc-ability-check"><input type="checkbox" data-use-icon checked> Usa questa icona</label></div></div>
              <p data-icon-status class="npc-avatar-generator__hint"></p>
              <details class="npc-ability-edit"><summary>Modifica valori, effetti e icona</summary><form data-fields novalidate></form></details>
              <details open><summary>Bilanciamento e ipotesi dell’ultima proposta AI</summary><p data-balance></p><ul data-assumptions></ul></details>
              <p data-unsupported class="is-error" role="alert"></p>
              <p data-validation class="is-error" role="alert"></p>
            </section>
          </div>
          <footer><span>La capacità viene aggiunta soltanto alla conferma. Il bilanciamento resta una proposta da valutare.</span><div><button type="button" data-stop hidden>Interrompi attesa</button><button type="button" data-save disabled>Salva bozza</button><button type="button" data-generate disabled>Genera proposta</button><button type="button" data-confirm class="npc-avatar-generator__confirm" disabled>Aggiungi abilità</button></div></footer>`;
        document.body.appendChild(dialog);
        const el = s => dialog.querySelector(s);
        el("[data-name]").textContent = actor.name;
        el("[data-with-icon]").checked = Boolean(actor.media?.avatar?.path);
        if (startFresh) el("[data-prompt]").value = String(initialDetails).slice(0, 2000);
        if (retry?.body?.details) el("[data-prompt]").value = retry.body.details;
        const status = (message, error = false) => { el("[data-status]").textContent = message; el("[data-status]").classList.toggle("is-error", error); };
        const running = () => ["pending", "running", "icon-pending", "icon-running"].includes(job?.status);
        const locked = () => busy || running() || Boolean(retry) || ["confirming", "accepted"].includes(job?.status);
        const request = async (suffix = "", body) => {
            const response = await fetch(app.urls.api(base + suffix), {method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
                headers: {Authorization: `Bearer ${token}`, ...(body === undefined ? {} : {"Content-Type": "application/json"})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                const error = new Error(data.error || "Impossibile contattare il generatore. Aggiorna il Worker e riprova."); error.status = response.status; throw error;
            }
            return response;
        };
        const get = (object, path) => path.split(".").reduce((o, k) => o?.[k], object);
        const set = (object, path, value) => { const parts = path.split("."); const last = parts.pop(); parts.reduce((o, k) => o[k], object)[last] = value; };
        function readDraft() {
            const draft = structuredClone(job.draft);
            el("[data-fields]").querySelectorAll("[data-field]").forEach(control => set(draft, control.dataset.field, control.type === "checkbox" ? control.checked : control.type === "number" ? Number(control.value) : control.value));
            draft.healing.fraction = Number(draft.healing.fraction);
            draft.conditions = Array.from(el("[data-fields]").querySelectorAll("[data-condition]:checked"), c => c.value);
            return draft;
        }
        function preview() {
            if (!job?.draft || startFresh) return false;
            try {
                const draft = validateAbility(readDraft());
                el("[data-proposal-name]").textContent = draft.name;
                el("[data-validation]").textContent = "";
                el("[data-summary]").replaceChildren(...abilitySummary(draft).map(text => { const p = document.createElement("p"); p.textContent = text; return p; }));
                return !draft.unsupported.length;
            } catch (error) { el("[data-validation]").textContent = error.message; return false; }
        }
        function controls() {
            const valid = preview();
            el("[data-stop]").hidden = !running() || !canStop;
            el("[data-stop]").disabled = busy || !running();
            el("[data-stop-note]").hidden = !running() || !canStop;
            el("[data-generate]").disabled = busy || running() || !loaded || !enabled || job?.status === "confirming";
            el("[data-generate]").textContent = retry ? "Riprova invio" : running() ? "Generazione in corso…" : startFresh ? "Genera questa abilità" : job?.draft && job.status !== "accepted" ? "Rivedi con AI" : "Genera proposta";
            el("[data-confirm]").disabled = startFresh || busy || running() || Boolean(retry) || !canSync || !(job?.status === "confirming" || (job?.status === "ready" && valid && (!job.iconId || previewId === job.iconId || !el("[data-use-icon]").checked)));
            el("[data-confirm]").textContent = job?.status === "confirming" ? "Completa invio" : "Aggiungi abilità";
            el("[data-save]").disabled = startFresh || locked() || !job?.draft;
            el("[data-icon-generate]").disabled = locked() || !enabled || !job?.draft || !actor.media?.avatar?.path;
            el("[data-icon-generate]").textContent = job?.iconId ? "Rigenera icona" : "Genera icona";
            el("[data-use-icon]").disabled = locked() || !job?.iconId;
            el("[data-prompt]").disabled = busy || running() || Boolean(retry);
            el("[data-with-icon]").disabled = busy || running() || Boolean(retry) || !actor.media?.avatar?.path;
            el("[data-fields]").querySelectorAll("input,select,textarea").forEach(control => control.disabled = locked());
            dialog.setAttribute("aria-busy", String(busy || running()));
        }
        function renderFields(draft) {
            const form = el("[data-fields]"); form.replaceChildren();
            const group = title => { const fieldset = document.createElement("fieldset"), legend = document.createElement("legend"); legend.textContent = title; fieldset.append(legend); form.append(fieldset); return fieldset; };
            const field = (parent, path, label, type = "text", choices = []) => {
                const wrapper = document.createElement("label"), span = document.createElement("span"); span.textContent = label;
                const control = document.createElement(type === "select" ? "select" : type === "textarea" ? "textarea" : "input");
                if (control.tagName === "INPUT") control.type = type;
                if (type === "textarea") control.rows = 2;
                if (choices.length) for (const [value, text] of choices) { const option = document.createElement("option"); option.value = value; option.textContent = text; control.append(option); }
                control.dataset.field = path;
                if (type === "checkbox") { control.checked = Boolean(get(draft, path)); wrapper.className = "npc-ability-check"; }
                else control.value = get(draft, path);
                wrapper.append(span, control); parent.append(wrapper);
            };
            const choices = values => values.map(v => [v, LABELS[v] || v]);
            const basics = group("Identità e utilizzo");
            field(basics, "name", "Nome"); field(basics, "activation", "Quando si usa", "select", choices(["action", "bonus", "reaction"]));
            field(basics, "mode", "Tipo", "select", choices(["attack", "save", "damage", "utility"])); field(basics, "range", "Portata", "number");
            field(basics, "units", "Unità", "select", [["ft", "Piedi"], ["m", "Metri"]]); field(basics, "uses", "Utilizzi (0 = illimitati)", "number");
            field(basics, "recovery", "Recupero utilizzi", "select", [["day", "Ogni giorno"], ["lr", "Riposo lungo"], ["sr", "Riposo breve"]]);
            field(basics, "flavor", "Descrizione narrativa", "textarea");
            const attack = group("Attacco e danni principali");
            field(attack, "attackKind", "Attacco", "select", [["melee", "Mischia"], ["ranged", "Distanza"]]); field(attack, "attackBonus", "Bonus per colpire", "number");
            field(attack, "damage.formula", "Danni (es. 2d8+4)"); field(attack, "damage.type", "Tipo danni", "select", choices(DAMAGE_TYPES));
            const save = group("Tiro salvezza");
            field(save, "save.enabled", "Richiede TS (dopo il colpo, se è un attacco)", "checkbox"); field(save, "save.ability", "Caratteristica", "select", choices(ABILITIES));
            field(save, "save.dc", "CD", "number"); field(save, "save.onSave", "Con TS riuscito", "select", [["none", "Nessun danno"], ["half", "Metà danni"], ["full", "Danni completi"]]);
            field(save, "extraDamage.formula", "Danni aggiuntivi dopo l’attacco"); field(save, "extraDamage.type", "Tipo danni aggiuntivi", "select", choices(DAMAGE_TYPES));
            const effects = group("Cura ed effetti");
            field(effects, "healing.fraction", "Cura chi usa l’abilità", "select", [[0, "Nessuna"], [0.5, "50% dei danni"], [1, "100% dei danni"]]);
            field(effects, "healing.source", "Danni che curano", "select", [["damage", "Solo principali"], ["extra", "Solo aggiuntivi"]]); field(effects, "rounds", "Durata condizioni (round)", "number");
            const conditionList = document.createElement("div"); conditionList.className = "npc-ability-conditions";
            for (const condition of CONDITIONS) { const label = document.createElement("label"), input = document.createElement("input"); input.type = "checkbox"; input.dataset.condition = ""; input.value = condition; input.checked = draft.conditions.includes(condition); label.append(input, document.createTextNode(LABELS[condition])); conditionList.append(label); }
            effects.append(conditionList);
            const icon = group("Direzione artistica dell’icona"); field(icon, "iconPrompt", "Dettaglio da rappresentare", "textarea");
            el("[data-balance]").textContent = draft.balance;
            el("[data-assumptions]").replaceChildren(...draft.assumptions.map(text => { const li = document.createElement("li"); li.textContent = text; return li; }));
            el("[data-unsupported]").textContent = draft.unsupported.length ? `Da rivedere prima della conferma: ${draft.unsupported.join("; ")}` : "";
        }
        async function showJob(next) {
            const changed = job?.id !== next?.id || (!job?.draft && next?.draft);
            job = next;
            const problem = job?.errorDetail || job?.iconErrorDetail;
            el("[data-error-details]").hidden = !job?.error && !job?.iconError;
            el("[data-error-reference]").textContent = problem
                ? [`Generazione: ${job.id}`, `Categoria: ${problem.code}`, problem.stage && `Fase: ${problem.stage}`, problem.httpStatus && `Risposta del servizio: ${problem.httpStatus}`, problem.providerCode && `Codice del servizio: ${problem.providerCode}`, problem.parameter && `Parametro: ${problem.parameter}`, problem.requestId && `Riferimento del servizio: ${problem.requestId}`].filter(Boolean).join("\n")
                : "Questa generazione non conserva il dettaglio della causa. L’aggiornamento lo registra per i nuovi tentativi.";
            el("[data-proposal]").hidden = startFresh || !job?.draft;
            if (changed && job?.details && !el("[data-prompt]").value) el("[data-prompt]").value = job.details;
            if (job?.draft && (changed || !el("[data-fields]").children.length)) renderFields(readLocal(`${key}:${job.id}`) || job.draft);
            if (job?.status === "confirming") { renderFields(job.draft); writeLocal(`${key}:${job.id}`, null); }
            if (retry && (retry.body.requestId === job?.id || retry.body.requestId === job?.iconAttempt)) { retry = null; writeLocal(key, null); }
            if (!startFresh && job?.iconId && previewId !== job.iconId) {
                const response = await request(`/${job.id}/preview`), blob = await response.blob();
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                previewUrl = URL.createObjectURL(blob); previewId = job.iconId;
                el("[data-icon]").src = previewUrl; el("[data-icon]").hidden = false;
            } else if (!job?.iconId && previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ""; previewId = ""; el("[data-icon]").hidden = true; }
            el("[data-icon-status]").textContent = job?.iconError || "";
            if (running()) { status(job.status.startsWith("icon") ? "Sto creando l’icona. La proposta dell’abilità è già conservata." : "Sto preparando la capacità sulla base della scheda. Puoi chiudere e ritrovarla qui."); timer = setTimeout(refresh, 5000); }
            else if (job?.status === "accepted") status("Abilità inviata. La sincronizzazione con Foundry prosegue anche chiudendo questa finestra.");
            else if (job?.status === "confirming") status("Conferma preparata: premi Completa invio per ritentare senza creare duplicati.");
            else if (job?.error) status(job.error, true);
            else if (!enabled) status("Il generatore deve essere attivato dall’amministratore.");
            else if (!canSync) status("Puoi preparare una proposta. Per aggiungerla, aggiorna Wiki Sync in Foundry e sincronizza questo NPC.");
            else status(job?.draft ? "Controlla la proposta e conferma quando ti convince." : "Descrivi l’abilità: userò le statistiche e le capacità già presenti.");
            if (startFresh && !running()) status(job?.status === "confirming" ? "Completa prima l’invio della capacità precedente riaprendo il generatore senza selezionare una nuova idea." : "Idea pronta. Controlla la descrizione e premi Genera questa abilità: l’NPC non è stato modificato.");
            controls();
        }
        async function refresh() {
            clearTimeout(timer);
            try { const data = await (await request()).json(); enabled = data.enabled && data.version === 1; canSync = data.canSync; canStop = data.canStop === true; loaded = true; if (!closed) await showJob(data.job); }
            catch (error) { if (!closed) { status(error.message, true); controls(); if (running()) timer = setTimeout(refresh, 10000); } }
        }
        async function execute(fn) {
            if (busy) return; busy = true; clearTimeout(timer); controls();
            try { await fn(); } catch (error) { if (!closed) status(error.message, true); }
            finally { busy = false; if (!closed) controls(); }
        }
        async function sendPaid(suffix, body) {
            retry ||= {suffix, body}; writeLocal(key, retry);
            try {
                const data = await (await request(retry.suffix, retry.body)).json();
                if (!retry.suffix && data.job?.id === retry.body.requestId) startFresh = false;
                retry = null; writeLocal(key, null); await showJob(data.job);
            } catch (error) {
                if (error.status && error.status < 500) { retry = null; writeLocal(key, null); }
                throw error;
            }
        }
        el("[data-fields]").addEventListener("submit", event => event.preventDefault());
        el("[data-use-icon]").addEventListener("change", controls);
        el("[data-fields]").addEventListener("input", () => { writeLocal(`${key}:${job.id}`, readDraft()); controls(); });
        el("[data-stop]").addEventListener("click", () => execute(async () => {
            if (!running()) return;
            const data = await (await request(`/${job.id}/stop`, {attemptId: job.iconAttempt || job.id})).json();
            retry = null; writeLocal(key, null);
            await showJob(data.job);
        }));
        el("[data-generate]").addEventListener("click", () => execute(async () => {
            if (retry) return sendPaid(retry.suffix, retry.body);
            const details = el("[data-prompt]").value.trim();
            if (!details) throw new Error("Descrivi l’abilità o la modifica che desideri.");
            const baseDraft = !startFresh && job?.draft && job.status !== "accepted" ? validateAbility(readDraft()) : null;
            await sendPaid("", {requestId: crypto.randomUUID(), details, withIcon: el("[data-with-icon]").checked, baseDraft});
        }));
        el("[data-save]").addEventListener("click", () => execute(async () => {
            const draft = validateAbility(readDraft());
            const data = await (await request(`/${job.id}/save`, {draft})).json(); job = data.job;
            writeLocal(`${key}:${job.id}`, null); status("Bozza salvata. Nessuna generazione a pagamento.");
        }));
        el("[data-icon-generate]").addEventListener("click", () => execute(async () => {
            await sendPaid(`/${job.id}/icon`, {requestId: crypto.randomUUID(), draft: validateAbility(readDraft())});
        }));
        el("[data-confirm]").addEventListener("click", () => execute(async () => {
            let icon = "";
            if (previewUrl && el("[data-use-icon]").checked && job.status !== "confirming") {
                const image = el("[data-icon]"); await image.decode();
                const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
                canvas.getContext("2d").drawImage(image, 0, 0, 512, 512);
                const dataUrl = canvas.toDataURL("image/webp", .9);
                if (!dataUrl.startsWith("data:image/webp;base64,")) throw new Error("Questo browser non può esportare l’icona WebP. Puoi aggiungere l’abilità senza icona.");
                icon = dataUrl.split(",")[1];
            }
            let data;
            try { data = await (await request(`/${job.id}/confirm`, {draft: validateAbility(readDraft()), icon})).json(); }
            catch (error) { await refresh(); throw error; }
            writeLocal(`${key}:${job.id}`, null); job.status = "accepted"; status("Abilità aggiunta, in attesa di Foundry.");
            await onQueued?.(data.command);
        }));
        const close = () => { if (busy) return; closed = true; clearTimeout(timer); controller.abort(); if (previewUrl) URL.revokeObjectURL(previewUrl); dialog.close(); dialog.remove(); previousFocus?.focus(); };
        el("[data-close]").addEventListener("click", close);
        dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
        dialog.showModal(); await refresh();
    }
})();
