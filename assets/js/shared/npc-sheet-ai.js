(function(){
 'use strict';
 const modelUrl=new URL('npc-sheet-ai-model.mjs?v=20261124-review-base',document.currentScript.src).href,editorUrl=new URL('npc-sheet-editor.mjs?v=20261124-foundry-fields',document.currentScript.src).href;
 window.CriptaNpcSheetAi={open};
 async function open({actor,token,onQueued,editorAdapters={}}){
  if(document.querySelector('[data-npc-sheet-ai]'))return;
  const [model,{mountNpcSheetEditor}]=await Promise.all([import(modelUrl),import(editorUrl)]),app=window.CriptaApp,controller=new AbortController(),previousFocus=document.activeElement;
  const dialog=document.createElement('dialog');dialog.className='npc-avatar-generator npc-sheet-ai';dialog.dataset.npcSheetAi='';dialog.setAttribute('aria-labelledby','npc-sheet-ai-title');
  dialog.innerHTML=`<header><div><small>ASSISTENTE NPC</small><h2 id="npc-sheet-ai-title">Modifica NPC con AI</h2><p data-name></p></div><button type="button" data-close aria-label="Chiudi">×</button></header>
   <div class="npc-avatar-generator__body"><p data-status role="status" class="npc-avatar-generator__status" aria-live="polite">Caricamento…</p><p data-visual-reference class="npc-avatar-generator__hint" hidden></p><p data-sync-state class="npc-avatar-generator__hint" hidden>Puoi salvare la bozza anche con Foundry spento. Per inviarla, apri il mondo con Wiki Sync aggiornato: i dati si allineano automaticamente.</p>
    <details data-request-panel open class="npc-sheet-ai-request-panel"><summary>La richiesta</summary><section class="npc-sheet-ai-request"><label for="npc-sheet-ai-mode">Tipo di richiesta</label><select id="npc-sheet-ai-mode" data-mode><option value="general">Modifica la scheda</option><option value="translate">Traduci mantenendo le regole</option></select>
    <label class="npc-avatar-generator__direction" for="npc-sheet-ai-prompt">Cosa vuoi cambiare?<textarea id="npc-sheet-ai-prompt" data-prompt rows="3" maxlength="8000" placeholder="Traduci tutte le abilità in italiano, aggiungi un attacco o modifica le statistiche…"></textarea></label>
    <div class="npc-sheet-ai-examples" aria-label="Esempi di richiesta"><button type="button" data-example="translate">Traduci tutte le capacità</button><button type="button" data-example="rebalance">Ribilancia il mostro</button><button type="button" data-example="ability">Aggiungi una capacità</button></div>
    <p class="npc-avatar-generator__hint" data-mode-help>Puoi combinare statistiche, capacità, incantesimi, inventario ed effetti. Ogni proposta usa il budget API.</p></section></details>
    <details data-problem hidden class="npc-generation-error-details"><summary>Dettagli del problema</summary><pre data-problem-text></pre></details>
    <section data-json-repair hidden><p>Correggi i campi della risposta conservata. Potrai rivedere la proposta prima di applicarla.</p><div data-json-fields></div><button type="button" data-prepare-repair>Prepara bozza senza AI</button></section>
    <section data-review hidden><div class="npc-sheet-ai-review-heading"><div><small>PRIMA DELLA CONFERMA</small><h3>Rivedi la proposta</h3></div><span data-count></span></div><p data-summary></p><div class="npc-sheet-ai-change-list" data-changes></div>
     <p data-unsupported class="npc-avatar-generator__hint" role="note"></p><p data-validation class="is-error" role="alert"></p><details data-notes><summary>Bilanciamento e ipotesi</summary><p data-balance></p><ul data-assumptions></ul></details>
     <details data-editor-panel class="npc-sheet-ai-editor-panel"><summary>Controlla e modifica i valori della proposta</summary><div data-editor></div></details></section>
   </div><footer><span>Controlla la proposta. La scheda cambia solo quando confermi.</span><div><button type="button" data-stop hidden>Interrompi attesa</button><button type="button" data-abandon hidden>Annulla invio locale</button><button type="button" data-reopen hidden>Riapri proposta senza AI</button><button type="button" data-new hidden>Nuova richiesta</button><button type="button" data-save disabled>Salva bozza</button><button type="button" data-generate disabled>Genera proposta</button><button type="button" class="npc-avatar-generator__confirm" data-confirm disabled>Applica alla scheda</button></div></footer>`;
  document.body.append(dialog);dialog.showModal();const el=selector=>dialog.querySelector(selector),base=`api/managed-actors/${encodeURIComponent(actor.worldId)}/${encodeURIComponent(actor.actorId)}/ability-generation`,key=`npc-sheet-ai:${actor.campaignId||app.campaigns.currentId()}:${actor.worldId}:${actor.actorId}`;
  let job=null,editor=null,busy=false,closed=false,enabled=false,canGenerate=false,canSync=false,sharedRuntime=true,hasAvatar=false,supportsVisualInput=false,loaded=false,waitingSince=Date.now(),timer,pendingRequest=null,renderedId='',fresh=false,delivery=null,localTimer,localRestored=false;
  let serverBase=null,needsLocalCopy=false;
  try{pendingRequest=JSON.parse(sessionStorage.getItem(key));}catch{}
  const persist=value=>{pendingRequest=value;try{if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{}};
  const running=()=>['pending','running'].includes(job?.status),locked=()=>busy||running()||job?.status==='confirming'||job?.status==='accepted';
  const status=(text,error=false)=>{el('[data-status]').textContent=text;el('[data-status]').classList.toggle('is-error',error);};
  async function api(suffix='',body){const url=new URL(app.urls.api(base+suffix),location.href);url.searchParams.set('editor',model.NPC_SHEET_AI_FORMAT);url.searchParams.set('campaign',actor.campaignId||app.campaigns.currentId());const response=await fetch(url,{method:body===undefined?'GET':'POST',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const payload=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(payload.error||'Impossibile contattare l’assistente.'),{status:response.status});return payload;}
  const validateReview=(draft,allowItemCorrection=false)=>model.validateNpcSheetReview(draft,actor.foundryActorId||actor.actorId,job.sheetOptions||{},allowItemCorrection,serverBase);
  function readDraft(validate=true,allowItemCorrection=false){if(!job?.draft||!editor)return job?.draft;if(validate)editor.validate();const draft=model.npcSheetReadProposalEditor(job.draft,editor.entities);return validate?validateReview(draft,allowItemCorrection):draft;}
  function visualHint(){
   const hint=el('[data-visual-reference]');hint.hidden=!loaded;
   hint.textContent=job&&!fresh?(job.usesAvatar?'Questa richiesta include l’avatar salvato come riferimento visivo.':'Questa richiesta usa i dati e i testi della scheda, senza avatar.'):supportsVisualInput?(hasAvatar?'L’avatar salvato verrà inviato all’AI insieme alla scheda, come riferimento visivo.':'Senza un avatar salvato, l’AI userà i dati e i testi della scheda.'):'Il riferimento visivo sarà disponibile dopo l’aggiornamento del servizio.';
  }
  let localIdentity='session';try{const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));localIdentity=String(claims.accountId||claims.sub||claims.id||'session');}catch{}
  const draftKey=()=>key+':draft:'+encodeURIComponent(localIdentity)+':'+job?.id;
  function cacheDraft(){
   clearTimeout(localTimer);if(!job?.draft||!editor||job.status!=='ready'||fresh||(!needsLocalCopy&&editor.isValid()))return true;
   let draft;
   try{draft=readDraft(true,true);}
   catch(error){status('Controlla la modifica prima di chiudere. '+error.message,true);return false;}
   try{localStorage.setItem(draftKey(),JSON.stringify(draft));needsLocalCopy=false;return true;}
   catch{
    const advice=el('[data-validation]').textContent?'Correggi i campi segnalati per salvarle sul sito.':'Usa Salva bozza per conservarle sul sito.';
    status('Il browser non ha salvato le ultime modifiche. La proposta originale è sul server. '+advice,true);return false;
   }
  }
  function forgetLocal(){needsLocalCopy=false;try{localStorage.removeItem(draftKey());}catch{}}
  function draftChanged(){needsLocalCopy=true;clearTimeout(localTimer);localTimer=setTimeout(cacheDraft,400);controls();}
  function changesPreview(){
   if(!job?.draft||fresh)return false;
   try{
    const draft=readDraft(false),changes=model.npcSheetDraftChanges(draft);el('[data-validation]').textContent='';el('[data-summary]').textContent=draft.summary;el('[data-count]').textContent=`${changes.length} ${changes.length===1?'elemento coinvolto':'elementi coinvolti'}`;
    const list=el('[data-changes]');list.replaceChildren();const value=v=>v===undefined?'Non impostato':typeof v==='string'?v:JSON.stringify(v);
    for(const change of changes){const detail=document.createElement('details'),summary=document.createElement('summary'),badge=document.createElement('span'),name=document.createElement('strong');badge.className=`npc-sheet-ai-badge is-${change.operation}`;badge.textContent={update:'Modifica',create:'Aggiunge',delete:'Rimuove'}[change.operation];name.textContent=change.name;summary.append(badge,name);if(change.patches){const count=document.createElement('small');count.textContent=`${change.patches.length} ${change.patches.length===1?'campo':'campi'}`;summary.append(count);}detail.append(summary);
     if(change.patches){const rows=document.createElement('dl');for(const patch of change.patches){const term=document.createElement('dt'),description=document.createElement('dd'),old=document.createElement('span'),arrow=document.createElement('span'),next=document.createElement('span');term.textContent=patch.path.replace(/^system\./,'').replaceAll('.',' › ');old.textContent=value(patch.baseValue);arrow.textContent='→';next.textContent=patch.op==='delete'?'Rimosso':value(patch.value);description.append(old,arrow,next);rows.append(term,description);}detail.append(rows);}else{const p=document.createElement('p');p.textContent=change.operation==='delete'?'Questo elemento sarà rimosso dalla scheda alla conferma.':'Il nuovo elemento è disponibile nell’editor della proposta.';detail.append(p);}const actions=document.createElement('div'),undo=document.createElement('button');actions.className='npc-sheet-ai-change-actions';undo.type='button';undo.textContent=change.operation==='create'?'Scarta aggiunta':change.operation==='delete'?'Mantieni elemento':'Annulla questa modifica';undo.disabled=locked();undo.addEventListener('click',()=>discardChange(change));actions.append(undo);detail.append(actions);list.append(detail);
    }
    const warnings=[...new Set([...draft.unsupported,...model.npcSheetAutomationWarnings(draft)])];el('[data-unsupported]').textContent=warnings.length?`Automazioni da gestire manualmente · ${warnings.join(' ')}`:'';validateReview(draft);return changes.length>0;
   }catch(error){el('[data-validation]').textContent=error.message;return false;}
  }
  function discardChange(change){
   try{
    const draft=readDraft(false),id=change.target.id,type=change.target.type;
    if(type==='Actor')draft.actor=structuredClone(draft.base.actor);
    else{const key=type==='Item'?'items':'effects',created=type==='Item'?'createdItems':'createdEffects',original=draft.base[key].find(row=>row.id===id);
     if(change.operation==='create')draft[created]=draft[created].filter(row=>row.id!==id);
     else if(change.operation==='delete'){draft[key].push(structuredClone(original));draft[key].sort((a,b)=>draft.base[key].findIndex(row=>row.id===a.id)-draft.base[key].findIndex(row=>row.id===b.id));}
     else draft[key].find(row=>row.id===id).data=structuredClone(original.data);
    }
    const remaining=model.npcSheetDraftChanges(draft);draft.summary=`Bozza rivista: ${remaining.length} ${remaining.length===1?'elemento coinvolto':'elementi coinvolti'}. L’elenco riporta le modifiche attuali.`;
    job.draft=draft;needsLocalCopy=true;renderedId='';editor=null;renderProposal();controls();if(cacheDraft())status('Bozza aggiornata. Nessuna modifica inviata a Foundry.');
   }catch(error){status(error.message,true);}
  }
  function controls(){visualHint();const valid=changesPreview();el('[data-sync-state]').hidden=!canGenerate||canSync||!job?.draft||fresh;el('[data-generate]').disabled=busy||running()||!loaded||!enabled||!canGenerate||job?.status==='confirming';el('[data-generate]').textContent=pendingRequest?'Riprova invio':running()?'Generazione in corso…':job?.draft&&!fresh&&job.status!=='accepted'?'Rivedi con AI':'Genera proposta';el('[data-confirm]').disabled=busy||running()||fresh||Boolean(pendingRequest)||!canSync||!(job?.status==='confirming'||job?.status==='ready'&&valid);el('[data-confirm]').textContent=job?.status==='confirming'?'Completa invio':'Applica alla scheda';el('[data-save]').disabled=locked()||fresh||!job?.draft||!editor?.isValid()||Boolean(el('[data-validation]').textContent);el('[data-stop]').hidden=!running();el('[data-stop]').disabled=busy;el('[data-abandon]').hidden=!pendingRequest||running();el('[data-abandon]').disabled=busy;const repairable=job?.status==='uncertain'&&job.canRepairJson;el('[data-reopen]').hidden=fresh||!repairable&&(job?.status!=='accepted'||!['failed','conflict','missing'].includes(delivery?.status));el('[data-reopen]').textContent=repairable?'Correggi proposta senza AI':'Riapri proposta senza AI';if(fresh)el('[data-json-repair]').hidden=true;el('[data-reopen]').disabled=busy;el('[data-new]').hidden=!job||fresh||running();el('[data-new]').disabled=busy||job?.status==='confirming';el('[data-prompt]').disabled=busy||running()||Boolean(pendingRequest)||job?.status==='confirming';el('[data-mode]').disabled=busy||running()||Boolean(pendingRequest)||Boolean(job?.draft&&!fresh);for(const b of dialog.querySelectorAll('[data-example]'))b.disabled=el('[data-prompt]').disabled;editor?.setReadOnly(locked(),job?.status==='confirming'?'In attesa di invio':'');}
  function renderProposal(){
   if(fresh||job?.status!=='uncertain'||el('[data-json-repair]').dataset.jobId!==job?.id)el('[data-json-repair]').hidden=true;
   const draft=job?.draft;el('[data-review]').hidden=!draft||fresh;if(!draft||fresh)return;
   if(renderedId!==job.id){renderedId=job.id;el('[data-editor]').replaceChildren();const source=model.npcSheetProposalEditor(draft,actor.foundryActorId||actor.actorId,job.sheetOptions||{}),changed=model.npcSheetDraftChanges(draft).find(change=>change.operation!=='delete'),repair=source.entities.find(entity=>entity.selectedActivity);
    if(repair)el('[data-editor-panel]').open=true;
    source.permissions.sharedRuntime=sharedRuntime;editor=mountNpcSheetEditor({root:dialog,source,panes:[{node:el('[data-editor]'),categories:['stats','abilities','spells','inventory','effects'],label:'La scheda proposta'}],draftMode:true,creationMode:false,textOnly:draft.mode==='translate',initialTarget:repair?.target.id||(changed?.target.type==='Actor'?source.entities[0].target.id:changed?.target.id),descriptionHtml:editorAdapters.descriptionHtml,descriptionValue:editorAdapters.descriptionValue,resolveMedia:editorAdapters.resolveMedia|| (value=>value),onDraftChange:()=>{if(editor)draftChanged();}});}
   el('[data-mode]').value=draft.mode;el('[data-balance]').textContent=draft.balance;el('[data-assumptions]').replaceChildren(...draft.assumptions.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  }
  function ingest(payload){
   sharedRuntime=Boolean(payload.sharedRuntime??sharedRuntime);enabled=Boolean(payload.enabled??enabled);canSync=Boolean(payload.canSync??canSync);canGenerate=Boolean(payload.canGenerate??payload.canSync??canGenerate);hasAvatar=Boolean(payload.hasAvatar??hasAvatar);supportsVisualInput=Boolean(payload.supportsVisualInput??supportsVisualInput);loaded=true;delivery=payload.delivery??delivery;const incoming=payload.job;if(incoming&&incoming.format!==model.NPC_SHEET_AI_FORMAT)throw new Error('Questa proposta non appartiene all’editor della scheda.');
   if(incoming){
    const different=job?.id!==incoming.id,keepDraft=!different&&editor&&job?.status==='ready'&&incoming.status==='ready';
    const localDraft=keepDraft?job.draft:null;
    serverBase=incoming.draft?.base??null;
    if(!keepDraft)needsLocalCopy=false;
    if(different){renderedId='';fresh=false;editor=null;}
    else if(job?.status!==incoming.status){renderedId='';editor=null;}
    job=localDraft?{...incoming,draft:localDraft}:incoming;
    if(!keepDraft&&job.status==='ready')try{job.draft=validateReview(job.draft,true);}catch{}
    localRestored=false;
    if(!keepDraft&&job.status==='ready')try{const cached=JSON.parse(localStorage.getItem(draftKey()));if(cached){job.draft=validateReview(cached,true);localRestored=true;}}catch{status('Copia locale non valida: la bozza del server resta disponibile.',true);}
    if(pendingRequest?.requestId===job.id)persist(null);
    // Availability polling must not replace a prompt being written or restore
    // changes the user has removed from an unsaved proposal.
    if(different)el('[data-prompt]').value=job.details||'';
   }
   el('[data-request-panel]').open=!job?.draft||fresh||running();renderProposal();const problem=job?.errorDetail;el('[data-problem]').hidden=!problem;el('[data-problem-text]').textContent=problem?JSON.stringify(problem,null,2):'';
   if(running())status('Sto preparando le modifiche. Puoi chiudere questa finestra e tornare più tardi.');else if(job?.status==='uncertain')status(job.error||'Generazione interrotta. Nessun nuovo tentativo automatico.',true);else if(job?.status==='accepted')status(delivery?.status==='applied'?'Modifiche applicate in Foundry.':delivery?.status==='failed'||delivery?.status==='conflict'?'Foundry non ha applicato la proposta: '+(delivery.error||'Riapri la proposta per correggerla senza nuove chiamate AI.'):'Modifiche inviate. In attesa della conferma di Foundry.',['failed','conflict'].includes(delivery?.status));else if(job?.status==='confirming')status('La proposta è pronta per completare l’invio.');else if(job?.draft&&!fresh)status(localRestored?'Bozza locale ripristinata. Controlla le modifiche prima di inviare.':job.recoveredAt?'Proposta recuperata senza nuove chiamate AI. Rivedila prima di confermare.':'Proposta pronta: controlla cosa cambia prima di applicarla.');else if(!canGenerate)status('La scheda completa viene caricata automaticamente da Wiki Sync quando un GM apre il mondo. Non serve sincronizzare singolarmente l’NPC.');else if(!canSync)status('La scheda archiviata è pronta. Puoi generare una proposta anche con Foundry spento.');else if(!enabled)status('L’assistente deve essere attivato dall’amministratore.');else status('Descrivi le modifiche. Puoi intervenire su tutta la scheda.');controls();clearTimeout(timer);if(!closed&&(running()||job?.status==='accepted'&&['pending','missing'].includes(delivery?.status)||!canGenerate||!canSync))timer=setTimeout(load,running()?3500:Date.now()-waitingSince<60000?10000:60000);
  }
  async function load(){if(closed)return;try{ingest(await api());}catch(error){if(!closed){status(error.message,true);controls();if(running()||job?.status==='accepted'&&['pending','missing'].includes(delivery?.status)||!canGenerate||!canSync)timer=setTimeout(load,running()?6000:30000);}}}
  async function act(action){if(busy)return;busy=true;controls();try{await action();}catch(error){status(error.name==='TimeoutError'?'L’invio è ancora incerto. Riprova invio con la stessa richiesta o riapri la finestra per recuperarne lo stato.':error.message,true);}finally{busy=false;if(!closed)controls();}}
  el('[data-name]').textContent=actor.name;
  el('[data-generate]').addEventListener('click',()=>act(async()=>{
   const details=el('[data-prompt]').value.trim();if(!details)throw new Error('Descrivi cosa vuoi cambiare.');if(!cacheDraft())return;
   const body=pendingRequest||{requestId:crypto.randomUUID(),details,mode:el('[data-mode]').value,...(job?.draft&&!fresh&&job.status!=='accepted'?{baseDraft:readDraft(),baseJobId:job.id}:{})};persist(body);
   try{const payload=await api('',body);renderedId='';editor=null;fresh=false;ingest(payload);}
   catch(error){if(error.status>=400&&error.status<500&&error.status!==408)persist(null);throw error;}
  }));
  el('[data-save]').addEventListener('click',()=>act(async()=>{const payload=await api(`/${job.id}/save`,{draft:readDraft()});job=payload.job;serverBase=job.draft.base;forgetLocal();editor.markDraftSaved();status('Bozza salvata. Nessuna modifica inviata a Foundry.');}));
  el('[data-confirm]').addEventListener('click',()=>act(async()=>{try{const payload=await api(`/${job.id}/confirm`,{draft:readDraft()});persist(null);forgetLocal();job={...job,status:'accepted',command:payload.command};delivery={status:'pending'};await onQueued?.(payload.command);renderedId='';editor=null;await load();}catch(error){try{const latest=await api();if(latest.job?.status==='confirming'||latest.job?.status==='accepted'){renderedId='';editor=null;}ingest(latest);}catch{}throw error;}}));
  el('[data-stop]').addEventListener('click',()=>act(async()=>{ingest(await api(`/${job.id}/stop`,{attemptId:job.id}));persist(null);}));
  el('[data-new]').addEventListener('click',()=>{if(!cacheDraft())return;persist(null);fresh=true;editor=null;renderedId='';el('[data-request-panel]').open=true;el('[data-prompt]').value='';el('[data-mode]').disabled=false;el('[data-review]').hidden=true;status('Descrivi una nuova modifica alla scheda.');controls();el('[data-prompt]').focus();});
  const examples={translate:['translate','Traduci in italiano i nomi e le descrizioni di tutte le capacità, armi e incantesimi, compresi i testi delle attività e degli effetti. Conserva tutte le regole, i numeri, i dadi e i collegamenti.'],rebalance:['general','Ribilancia il mostro per GS __. Adegua statistiche e capacità in modo coerente e spiega le scelte.'],ability:['general','Aggiungi una capacità che __. Considera il resto della scheda e conserva le mosse esistenti.']};
  for(const button of dialog.querySelectorAll('[data-example]'))button.addEventListener('click',()=>{if(job?.draft&&!fresh){if(!cacheDraft())return;persist(null);fresh=true;editor=null;el('[data-review]').hidden=true;}const [mode,text]=examples[button.dataset.example];el('[data-mode]').value=mode;el('[data-prompt]').value=text;updateMode();controls();el('[data-prompt]').focus();});
  function updateMode(){el('[data-mode-help]').textContent=el('[data-mode]').value==='translate'?'Traduzione dei testi con controlli che conservano numeri, formule, collegamenti e meccaniche.':'Puoi combinare statistiche, capacità, incantesimi, inventario ed effetti. Ogni proposta usa il budget API.';}
  el('[data-mode]').addEventListener('change',updateMode);
  el('[data-abandon]').addEventListener('click',()=>{persist(null);controls();status('Invio locale annullato. Un’eventuale generazione già avviata resta recuperabile riaprendo la finestra.');});
  function showRecovered(payload){
   forgetLocal();delivery=null;renderedId='';editor=null;ingest(payload);status('Proposta riaperta. Controlla le modifiche prima di applicarle.');
  }
  el('[data-reopen]').addEventListener('click',()=>act(async()=>{
   const payload=await api('/'+job.id+'/reopen',{});
   if(!payload.fields){showRecovered(payload);return;}
   const section=el('[data-json-repair]'),container=el('[data-json-fields]');container.replaceChildren();
   for(const field of payload.fields){
    const label=document.createElement('label'),input=document.createElement('textarea');
    label.className='npc-avatar-generator__direction';label.textContent=field.name+' · '+field.path;
    input.rows=7;input.spellcheck=false;input.value=field.valueJson;input.dataset.op=field.opIndex;input.dataset.change=field.changeIndex;
    label.append(input);container.append(label);
   }
   section.dataset.jobId=job.id;section.hidden=false;container.querySelector('textarea')?.focus();
  }));
  el('[data-prepare-repair]').addEventListener('click',()=>act(async()=>{
   const repairs=Array.from(el('[data-json-fields]').querySelectorAll('textarea'),input=>({opIndex:Number(input.dataset.op),changeIndex:Number(input.dataset.change),valueJson:input.value}));
   showRecovered(await api('/'+job.id+'/reopen',{repairs}));
  }));
  function close(){if(!cacheDraft()&&!window.confirm('La copia locale non è stata salvata. Chiudere comunque?'))return;closed=true;clearTimeout(localTimer);clearTimeout(timer);controller.abort();dialog.close();dialog.remove();previousFocus?.focus();}
  el('[data-close]').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  if(pendingRequest){el('[data-prompt]').value=pendingRequest.details;el('[data-mode]').value=pendingRequest.mode;}
  await load();if(!running()&&!job?.draft)el('[data-prompt]').focus();
 }
})();
