(function () {
    "use strict";
    const schemaUrl = new URL("npc-ability-schema.mjs?v=20261030-optional-fields1", document.currentScript.src).href;
    const nativeUrl = new URL("npc-native-ability.mjs?v=20261031-ai1", document.currentScript.src).href;
    const editorUrl = new URL("npc-sheet-editor.mjs?v=20261031-edit1", document.currentScript.src).href;
    const editUrl=new URL("npc-native-ability-edit.mjs?v=20261031-effects2",document.currentScript.src).href;
    window.CriptaAbilityGenerator = {open};
    async function open({actor, token, onQueued, initialDetails = "", editorAdapters = {}, targetItem = null}) {
        if (document.querySelector("[data-ability-generator]")) return;
        const {validateAbility, abilitySummary, DAMAGE_TYPES, CONDITIONS, ABILITIES, LABELS} = await import(schemaUrl);
        const app = window.CriptaApp;
        const base = `api/managed-actors/${encodeURIComponent(actor.worldId)}/${encodeURIComponent(actor.actorId)}/ability-generation`;
        const baseKey = `ability-generation:${app.campaigns.currentId()}:${actor.worldId}:${actor.actorId}`;
        const nativeClient=(actor.campaignId||app.campaigns.currentId())==="cripta-di-sangue",editing=Boolean(targetItem),key=editing?`${baseKey}:edit:${targetItem.id}`:nativeClient?`${baseKey}:native`:baseKey;
        const readLocal = k => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } };
        const writeLocal = (k, value) => { try { if (value) sessionStorage.setItem(k, JSON.stringify(value)); else sessionStorage.removeItem(k); } catch {} };
        let retry = readLocal(key)||(nativeClient&&readLocal(baseKey)?{...readLocal(baseKey),legacy:true}:null), job = null, busy = false, enabled = false, canSync = false, canStop = false, loaded = false, timer, closed = false, previewUrl = "", previewId = "";
        let startFresh = Boolean(initialDetails) && !retry;
        let nativeModule, nativeEditorModule, proposalEditor;
        const isEdit=()=>job?.format==="npc-native-ability-edit-v1";
        const isNative = () => isEdit()||job?.format === "npc-native-ability-v1";
        const validate = value => isEdit()?nativeModule.validateNativeAbilityEditDraft(value,undefined,job.draft.capabilities):isNative() ? nativeModule.validateNativeAbilityDraft(value) : validateAbility(value);
        const controller = new AbortController(), previousFocus = document.activeElement;
        const dialog = document.createElement("dialog");
        dialog.className = "npc-avatar-generator npc-ability-generator";
        dialog.dataset.abilityGenerator = "";
        dialog.setAttribute("aria-labelledby", "ability-generator-title");
        dialog.innerHTML = `<header><div><small>CAPACITÀ NPC</small><h2 id="ability-generator-title">Crea abilità con AI</h2></div><button type="button" data-close aria-label="Chiudi">×</button></header>
          <div class="npc-avatar-generator__body">
            <p data-name></p><p class="npc-avatar-generator__status" data-status role="status" aria-live="polite">Caricamento…</p><details data-error-details class="npc-generation-error-details" hidden><summary>Dettagli del problema</summary><pre data-error-reference></pre></details>
            <details data-request-panel open><summary>La richiesta</summary><div><label class="npc-avatar-generator__direction">Cosa deve fare?<textarea data-prompt maxlength="2000" rows="3" placeholder="Morde un bersaglio entro 10 piedi. Un TS Costituzione evita danni necrotici aggiuntivi, che curano il mostro."></textarea></label>
            <label class="npc-ability-check"><input type="checkbox" data-with-icon> Genera anche l’icona dall’avatar · 512 × 512</label>
            <p class="npc-avatar-generator__hint">La scheda dell’NPC viene inviata a OpenAI per proporre valori coerenti. Con l’icona viene inviato anche l’avatar. Ogni generazione usa il budget API.</p></div></details>
            <p data-stop-note class="npc-avatar-generator__hint" hidden>Interrompere l’attesa libera il generatore e conserva la bozza già pronta. Non garantisce l’annullamento del costo della chiamata.</p><section data-proposal hidden>
              <div class="npc-ability-heading"><div><h3 data-proposal-name>La tua proposta</h3><details data-summary-panel open><summary>Come funziona</summary><section class="npc-ability-summary" aria-label="Come funziona"><div data-summary></div></section></details></div><div class="npc-ability-icon"><img data-icon alt="Icona della capacità" hidden><button type="button" data-icon-generate>Genera icona</button><label class="npc-ability-check"><input type="checkbox" data-use-icon checked> Usa questa icona</label></div></div>
              <p data-icon-status class="npc-avatar-generator__hint"></p>
              <details class="npc-ability-edit"><summary>Modifica valori, effetti e icona</summary><form data-fields novalidate></form></details>
              <details data-change-review hidden><summary>Cosa cambia</summary><div data-changes></div></details><div data-native-proposal hidden></div>
              <details open><summary>Bilanciamento e ipotesi dell’ultima proposta AI</summary><p data-balance></p><ul data-assumptions></ul></details>
              <p data-unsupported class="is-error" role="alert"></p>
              <p data-validation class="is-error" role="alert"></p>
            </section>
          </div>
          <footer><span>La capacità viene aggiunta soltanto alla conferma. Il bilanciamento resta una proposta da valutare.</span><div><button type="button" data-stop hidden>Interrompi attesa</button><button type="button" data-save disabled>Salva bozza</button><button type="button" data-generate disabled>Genera proposta</button><button type="button" data-new-request hidden>Nuova richiesta</button><button type="button" data-confirm class="npc-avatar-generator__confirm" disabled>Aggiungi abilità</button></div></footer>`;
        document.body.appendChild(dialog);
        const el = s => dialog.querySelector(s);
        if(editing){el("[data-confirm]").textContent="Applica modifiche";el("#ability-generator-title").textContent="Modifica abilità con AI";el("[data-prompt]").previousSibling.textContent="Cosa vuoi cambiare?";el("[data-prompt]").placeholder="Aggiungi una cura pari ai soli danni necrotici del morso. Mantieni gli altri danni e il tiro per colpire.";el("footer > span").textContent="La capacità esistente cambia soltanto alla conferma. Controlla la bozza prima di inviarla a Foundry.";}
        el("[data-name]").textContent = editing?`${actor.name} · ${targetItem.name}`:actor.name;
        el("[data-with-icon]").checked = !editing&&Boolean(actor.media?.avatar?.path);
        if (startFresh) el("[data-prompt]").value = String(initialDetails).slice(0, 2000);
        if (retry?.body?.details) el("[data-prompt]").value = retry.body.details;
        const status = (message, error = false) => { el("[data-status]").textContent = message; el("[data-status]").classList.toggle("is-error", error); };
        const running = () => ["pending", "running", "icon-pending", "icon-running"].includes(job?.status);
        const locked = () => busy || running() || Boolean(retry) || ["confirming", "accepted"].includes(job?.status);
        const request = async (suffix = "", body, legacy=false) => {
            const url=new URL(app.urls.api(base+suffix),window.location.href);
            if(editing){url.searchParams.set("editor","npc-native-ability-edit-v1");url.searchParams.set("item",targetItem.id);}
            else if(nativeClient&&!legacy&&(suffix?job?.channel==="native"||isNative():!body?.baseDraft||body.baseDraft.version===1||job?.channel==="native"))url.searchParams.set("editor","npc-native-ability-v1");
            const response = await fetch(url.href, {method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
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
            if (isNative()) { if(proposalEditor&&!proposalEditor.isValid())throw new Error("Controlla il campo segnalato nella capacità.");if(proposalEditor){draft.item={...draft.item,...proposalEditor.getDraft()};if(isEdit())draft.item.effects=proposalEditor.entities.filter(entity=>entity.type==="ActiveEffect").map(entity=>({_id:entity.target.id,type:entity.effectType||"base",...structuredClone(entity.draft)}));} }
            el("[data-fields]").querySelectorAll("[data-field]").forEach(control => set(draft, control.dataset.field, control.type === "checkbox" ? control.checked : control.type === "number" ? Number(control.value) : control.value));
            if(!isNative()) { draft.healing.fraction = Number(draft.healing.fraction);
            draft.conditions = Array.from(el("[data-fields]").querySelectorAll("[data-condition]:checked"), c => c.value); }
            return draft;
        }
        function preview() {
            if (!job?.draft || startFresh) return false;
            try {
                const draft = validate(readDraft());
                el("[data-proposal-name]").textContent = isNative()?draft.item.name:draft.name;
                el("[data-validation]").textContent = "";
                el("[data-summary]").replaceChildren(...(isNative()?(isEdit()?nativeModule.nativeAbilityEditSummary(draft):nativeModule.nativeAbilitySummary(draft)):abilitySummary(draft)).map(text => { const p = document.createElement("p"); p.textContent = text; return p; }));
                if(isEdit())renderChanges(draft);
                return !draft.unsupported.length&&(!isEdit()||nativeModule.nativeAbilityEditDiff(draft).length>0);
            } catch (error) { el("[data-validation]").textContent = error.message; return false; }
        }
        function controls() {
            const valid = preview();
            el("[data-stop]").hidden = !running() || !canStop;
            el("[data-stop]").disabled = busy || !running();
            el("[data-stop-note]").hidden = !running() || !canStop;
            el("[data-generate]").disabled = busy || running() || !loaded || !enabled || job?.status === "confirming";
            el("[data-generate]").textContent = retry ? "Riprova invio" : running() ? "Generazione in corso…" : startFresh ? (editing?"Genera modifica":"Genera questa abilità") : job?.draft && job.status !== "accepted" ? "Rivedi con AI" : editing?"Genera modifica":"Genera proposta";
            el("[data-confirm]").disabled = startFresh || busy || running() || Boolean(retry) || !canSync || !(job?.status === "confirming" || (job?.status === "ready" && valid && (!job.iconId || previewId === job.iconId || !el("[data-use-icon]").checked)));
            el("[data-confirm]").textContent = job?.status === "confirming" ? "Completa invio" : editing?"Applica modifiche":"Aggiungi abilità";
            el("[data-new-request]").hidden=!editing||!job?.draft||startFresh;
            el("[data-new-request]").disabled=locked();
            el("[data-save]").disabled = startFresh || locked() || !job?.draft;
            el("[data-icon-generate]").disabled = locked() || !enabled || !job?.draft || !actor.media?.avatar?.path;
            el("[data-icon-generate]").textContent = job?.iconId ? "Rigenera icona" : "Genera icona";
            el("[data-use-icon]").disabled = locked() || !job?.iconId;
            el("[data-prompt]").disabled = busy || running() || Boolean(retry);
            el("[data-with-icon]").disabled = busy || running() || Boolean(retry) || !actor.media?.avatar?.path;
            el("[data-fields]").querySelectorAll("input,select,textarea").forEach(control => control.disabled = locked());
            proposalEditor?.setReadOnly(locked(),job?.status==="accepted"?"In attesa di Foundry":job?.status==="confirming"?"Invio da completare":"");
            el("[data-native-proposal]").querySelectorAll("[data-draft-tool]").forEach(button=>button.disabled=locked());
            dialog.setAttribute("aria-busy", String(busy || running()));
        }
        function renderChanges(draft) {
            el("[data-change-review]").hidden=false;
            const host=el("[data-changes]");host.replaceChildren();
            const names={name:"Nome",system:"Regole",activities:"Attività",description:"Descrizione",value:"Valore",npcRules:"Effetti dell’attività",healing:"Cura dai danni",healingTypes:"Danni che curano",damage:"Danni",parts:"Componenti",attack:"Attacco",bonus:"Bonus",save:"Tiro salvezza",dc:"CD",range:"Distanza",uses:"Utilizzi",max:"Massimo",conditions:"Condizioni",rounds:"Durata in round",effects:"Effetti",flags:"Automazioni",activation:"Attivazione",target:"Bersagli"};
            const valueText=value=>value===undefined?"Non impostato":value===null?"Automatico":typeof value==="object"?JSON.stringify(value,null,2):typeof value==="boolean"?(value?"Sì":"No"):String(value);
            for(const patch of nativeModule.nativeAbilityEditDiff(draft)){const row=document.createElement("div");row.className="npc-ability-change";const label=document.createElement("strong");label.textContent=patch.path.split('.').filter(part=>part!=="khuzoe-automations").map(part=>draft.item.system.activities?.[part]?.name||draft.base.system.activities?.[part]?.name||names[part]||part).join(" › ");const details=document.createElement("details"),summary=document.createElement("summary");summary.textContent="Prima e dopo";const before=document.createElement("pre"),after=document.createElement("pre");before.textContent=valueText(patch.baseValue);after.textContent=patch.op==="delete"?"Rimosso":valueText(patch.value);before.setAttribute("aria-label","Prima");after.setAttribute("aria-label","Dopo");details.append(summary,before,after);row.append(label,details);host.append(row);}
        }
        function renderFields(draft) {
            const form = el("[data-fields]"); form.replaceChildren();
            const host=el("[data-native-proposal]");host.replaceChildren();host.hidden=!isNative();proposalEditor=null;
            el(".npc-ability-edit").hidden=isNative();
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
            if(isNative()) {
                const item=job.draft.item;
                const mechanical=value=>({name:value.name,system:value.system,flags:value.flags});
                const base=isEdit()?draft.base:item,entity={key:"Item::proposal",target:{type:"Item",id:isEdit()?draft.itemId:"proposal"},type:"Item",itemType:isEdit()?draft.itemType:"feat",category:"abilities",name:item.name,data:mechanical(base),initialDraft:mechanical(draft.item)};
                const entities=[entity];
                if(isEdit())for(const effect of draft.item.effects||[]){const original=draft.base.effects.find(value=>value._id===effect._id)||effect,data=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!["_id","type"].includes(key)));entities.push({key:`ActiveEffect:${effect._id}`,target:{type:"ActiveEffect",id:effect._id,itemId:draft.itemId},type:"ActiveEffect",effectType:effect.type,readOnly:(draft.generatedEffects||[]).includes(effect._id),category:"abilities",parentName:"Effetto della capacità",name:effect.name,data:data(original),initialDraft:data(effect)});}
                proposalEditor=nativeEditorModule.mountNpcSheetEditor({root:host,draftMode:true,creationMode:!isEdit(),source:{version:1,canApply:true,permissions:{isAdmin:false,sharedRuntime:true},capabilities:draft.capabilities||{},commands:[],entities},
                    deleteEntity:isEdit()?entity=>{if(entity.readOnly)return;const next=readDraft();next.item.effects=next.item.effects.filter(effect=>effect._id!==entity.target.id);for(const activity of Object.values(next.item.system.activities||{}))activity.effects=(activity.effects||[]).filter(link=>link._id!==entity.target.id);writeLocal(`${key}:${job.id}`,next);renderFields(next);controls();}:undefined,
                    panes:[{node:host,categories:["abilities"],label:isEdit()?draft.item.name:"Attività ed effetti"}],resolveMedia:editorAdapters.resolveMedia||(()=>""),
                    descriptionHtml:editorAdapters.descriptionHtml||(value=>{const node=document.createElement("div");node.textContent=value;return node.innerHTML;}),descriptionValue:editorAdapters.descriptionValue||(node=>node.innerHTML),
                    onDraftChange:()=>{if(!proposalEditor)return;try{writeLocal(`${key}:${job.id}`,readDraft());}catch{}controls();}});
                if(isEdit()){
                    const tools=document.createElement("div");tools.className="npc-sheet-entity-tools";const add=document.createElement("button");add.type="button";add.className="npc-sheet-button is-subtle";add.textContent="+ Nuovo effetto";add.dataset.draftTool="";
                    add.addEventListener("click",()=>{const next=readDraft(),id=crypto.randomUUID().replaceAll('-','').slice(0,16);next.item.effects.push({_id:id,name:"Nuovo effetto",type:"base",disabled:false,transfer:false,statuses:[],duration:{value:1,units:"rounds",expiry:"turnEnd"},system:{changes:[]},flags:{}});const activity=Object.values(next.item.system.activities||{})[0];if(activity)activity.effects=[...(activity.effects||[]),{_id:id,onSave:false}];writeLocal(`${key}:${job.id}`,next);renderFields(next);controls();});tools.append(add);host.append(tools);renderChanges(draft);
                }
                const art=group("Direzione artistica dell’icona");field(art,"iconPrompt","Dettaglio da rappresentare","textarea");
                // Keep the art controls in the same draft reader as legacy jobs.
                form.append(art);art.hidden=false;form.closest("details").hidden=false;form.closest("details").open=false;form.closest("details").querySelector("summary").textContent="Impostazioni dell’icona";
                el("[data-balance]").textContent=draft.balance;el("[data-assumptions]").replaceChildren(...draft.assumptions.map(text=>{const li=document.createElement("li");li.textContent=text;return li;}));el("[data-unsupported]").textContent=draft.unsupported.length?`Da rivedere prima della conferma: ${draft.unsupported.join("; ")}`:"";
                return;
            }
            form.closest("details").querySelector("summary").textContent="Modifica valori, effetti e icona";
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
            const compactRequest=isNative()&&Boolean(job?.draft)&&!startFresh,requestPanel=el("[data-request-panel]");requestPanel.classList.toggle("is-native-request",compactRequest);if(!compactRequest)requestPanel.open=true;else if(changed)requestPanel.open=false;
            const summaryPanel=el("[data-summary-panel]");summaryPanel.classList.toggle("is-native-summary",compactRequest);if(!compactRequest)summaryPanel.open=true;else if(changed)summaryPanel.open=isEdit();if(isEdit())summaryPanel.querySelector("summary").textContent="Come cambia l’abilità";
            if(isNative()&&job?.draft&&!nativeModule){[nativeModule,nativeEditorModule]=await Promise.all([import(isEdit()?editUrl:nativeUrl),import(editorUrl)]);}
            const problem = job?.errorDetail || job?.iconErrorDetail;
            el("[data-error-details]").hidden = !job?.error && !job?.iconError;
            el("[data-error-reference]").textContent = problem
                ? [`Generazione: ${job.id}`, `Categoria: ${problem.code}`, problem.stage && `Fase: ${problem.stage}`, problem.httpStatus && `Risposta del servizio: ${problem.httpStatus}`, problem.providerCode && `Codice del servizio: ${problem.providerCode}`, problem.parameter && `Parametro: ${problem.parameter}`, problem.requestId && `Riferimento del servizio: ${problem.requestId}`].filter(Boolean).join("\n")
                : "Questa generazione non conserva il dettaglio della causa. L’aggiornamento lo registra per i nuovi tentativi.";
            el("[data-proposal]").hidden = startFresh || !job?.draft;
            if (changed && job?.details && !el("[data-prompt]").value) el("[data-prompt]").value = job.details;
            if (job?.draft && (changed || !el("[data-fields]").children.length)) renderFields(readLocal(`${key}:${job.id}`) || (nativeClient?readLocal(`${baseKey}:${job.id}`):null) || job.draft);
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
            else if (job?.status === "accepted") status(editing?"Modifiche inviate. La sincronizzazione con Foundry prosegue anche chiudendo questa finestra.":"Abilità inviata. La sincronizzazione con Foundry prosegue anche chiudendo questa finestra.");
            else if (job?.status === "confirming") status("Conferma preparata: premi Completa invio per ritentare senza creare duplicati.");
            else if (job?.error) status(job.error, true);
            else if (!enabled) status("Il generatore deve essere attivato dall’amministratore.");
            else if (!canSync) status(editing?"Ricarica Foundry con Wiki Sync aggiornato e sincronizza questo NPC per modificarne le capacità.":"Puoi preparare una proposta. Per aggiungerla, aggiorna Wiki Sync in Foundry e sincronizza questo NPC.");
            else if(job?.draft&&job.recoveredAt)status("Bozza recuperata senza nuove chiamate AI. Controllala e conferma quando ti convince.");
            else status(job?.draft ? "Controlla la proposta e conferma quando ti convince." : editing?"Descrivi la modifica: userò la capacità originale e la scheda completa del mostro.":"Descrivi l’abilità: userò le statistiche e le capacità già presenti.");
            if (startFresh && !running()) status(job?.status === "confirming" ? "Completa prima l’invio della capacità precedente riaprendo il generatore senza selezionare una nuova idea." : "Idea pronta. Controlla la descrizione e premi Genera questa abilità: l’NPC non è stato modificato.");
            controls();
        }
        async function refresh() {
            clearTimeout(timer);
            try { const data = await (await request()).json(); enabled = data.enabled && data.version === 1; canSync = data.canSync; canStop = data.canStop === true; loaded = true; if (!closed) await showJob(data.job); }
            catch (error) { if (!closed) { status(error.message, true); controls(); if (running()) timer = setTimeout(refresh, 10000); } }
        }
        async function execute(fn) {
            if(proposalEditor&&!proposalEditor.isValid()){status("Controlla il campo segnalato nella capacità prima di continuare.",true);return;}
            if (busy) return; busy = true; clearTimeout(timer); controls();
            try { await fn(); } catch (error) { if (!closed) status(error.message, true); }
            finally { busy = false; if (!closed) controls(); }
        }
        async function sendPaid(suffix, body) {
            retry ||= {suffix, body}; writeLocal(key, retry);
            try {
                const data = await (await request(retry.suffix, retry.body,retry.legacy)).json();
                if (!retry.suffix && data.job?.id === retry.body.requestId) startFresh = false;
                retry = null; writeLocal(key, null); await showJob(data.job);
            } catch (error) {
                if (error.status && error.status < 500) { retry = null; writeLocal(key, null); }
                throw error;
            }
        }
        el("[data-fields]").addEventListener("submit", event => event.preventDefault());
        el("[data-use-icon]").addEventListener("change", controls);
        el("[data-fields]").addEventListener("input", () => { try{writeLocal(`${key}:${job.id}`, readDraft());}catch{}controls(); });
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
            const baseDraft = !startFresh && job?.draft && job.status !== "accepted" ? validate(readDraft()) : null;
            await sendPaid("", {requestId: crypto.randomUUID(), details, withIcon: el("[data-with-icon]").checked, baseDraft});
        }));
        el("[data-new-request]").addEventListener("click",()=>{startFresh=true;el("[data-proposal]").hidden=true;el("[data-request-panel]").open=true;status("Nuova richiesta sulla scheda attuale. La bozza precedente resta conservata finché non avvii una nuova generazione.");controls();});
        el("[data-save]").addEventListener("click", () => execute(async () => {
            const draft = validate(readDraft());
            const data = await (await request(`/${job.id}/save`, {draft})).json(); job = data.job;
            proposalEditor?.markDraftSaved();
            writeLocal(`${key}:${job.id}`, null); status("Bozza salvata. Nessuna generazione a pagamento.");
        }));
        el("[data-icon-generate]").addEventListener("click", () => execute(async () => {
            await sendPaid(`/${job.id}/icon`, {requestId: crypto.randomUUID(), draft: validate(readDraft())});
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
            try { data = await (await request(`/${job.id}/confirm`, {draft: validate(readDraft()), icon})).json(); }
            catch (error) { await refresh(); throw error; }
            writeLocal(`${key}:${job.id}`, null); job.status = "accepted"; status(editing?"Modifiche inviate, in attesa di Foundry.":"Abilità aggiunta, in attesa di Foundry.");
            await onQueued?.(data.command);
        }));
        const close = () => { if (busy) return; closed = true; clearTimeout(timer); controller.abort(); if (previewUrl) URL.revokeObjectURL(previewUrl); dialog.close(); dialog.remove(); previousFocus?.focus(); };
        el("[data-close]").addEventListener("click", close);
        dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
        dialog.showModal(); await refresh();
    }
})();
