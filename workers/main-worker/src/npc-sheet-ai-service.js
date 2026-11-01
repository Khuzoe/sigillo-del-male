import {NPC_SHEET_AI_FORMAT,NPC_SHEET_AI_COMPILER,validateNpcSheetDraft,npcSheetCommandPlan} from '../../../assets/js/shared/npc-sheet-ai-model.mjs';
import {npcSheetAiContext,npcSheetAiOptions,npcSheetSharedRuntime,npcSheetAiSourceAvailable} from './npc-sheet-ai-context.js';
import {generationStopResponse} from './generation-lifecycle.js';
const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}}),fail=(error,status=400)=>reply({ok:false,error},status);
export async function handleNpcSheetAi(request,route,campaignId,env,services){
 const user=await services.requireUser(request);if(user instanceof Response)return user;
 if(!await services.isEditor(user,campaignId))return fail('Solo il DM della campagna o l’admin può modificare la scheda con AI.',403);
 if(!services.nativeGenerationEnabled||route.purpose==='suggestions')return fail('L’archivio completo NPC non è ancora attivo per questa campagna.',409);
 if(!env.ABILITY_GENERATOR)return fail('Aggiorna il Worker per usare questo editor.',503);
 const actor=await services.readActor(campaignId,route);if(!actor||actor.actorType!=='npc')return fail('NPC non trovato.',404);
 const context={campaignId,worldId:route.worldId,actorId:route.actorId,purpose:'native-sheet'},stub=env.ABILITY_GENERATOR.get(env.ABILITY_GENERATOR.idFromName('ability-generations-v1'));
 const call=(action,data={})=>stub.fetch(new Request(`https://ability.internal/${action}`,{method:'POST',body:JSON.stringify({...data,context})}));
 try{
  const latestResponse=await call('latest'),latest=await latestResponse.json();
  if(!latestResponse.ok||latest.nativeSheetEditor!==NPC_SHEET_AI_COMPILER)return fail('Il generatore si sta aggiornando. Nessuna chiamata AI è stata avviata. Riprova tra poco.',503);
  if(latest.job&&latest.job.format!==NPC_SHEET_AI_FORMAT)return fail('La proposta non appartiene all’editor della scheda.',409);
  const record=await services.readNativeActor(campaignId,route);
  if(request.method==='GET'&&!route.action)return reply({...latest,version:1,enabled:Boolean(env.OPENAI_API_KEY),canStop:true,canGenerate:npcSheetAiSourceAvailable(record),sharedRuntime:npcSheetSharedRuntime(actor,record?.snapshot?.actor),canSync:record?.snapshot?.versions?.nativeSheetEditor===1});
  if(request.method!=='POST')return fail('Operazione non supportata.',405);
  const text=await request.text();if(new TextEncoder().encode(text).length>2*1024*1024)return fail('Proposta troppo grande.',413);let body;try{body=JSON.parse(text);}catch{return fail('Richiesta non valida.');}
  if(route.action==='stop')return generationStopResponse(await call('stop',{id:route.jobId,attemptId:body.attemptId}));
  if(!route.action){
   if(!env.OPENAI_API_KEY)return fail('Il generatore deve essere attivato dall’amministratore.',503);
   if(!/^[a-f0-9-]{36}$/i.test(body.requestId||'')||typeof body.details!=='string'||!body.details.trim()||body.details.length>8000||!['general','translate'].includes(body.mode))return fail('Descrivi le modifiche entro 8000 caratteri.');
   const options=npcSheetAiOptions(record,actor,body.mode),{source,context:sheetContext}=npcSheetAiContext(record,actor,options);
   const pending=await services.readNativeCommands(campaignId,route);if(pending.some(command=>command.status==='pending'))return fail('Attendi la sincronizzazione delle modifiche già inviate a questo NPC prima di avviare una nuova proposta.',409);
   const baseDraft=body.baseDraft?validateNpcSheetDraft(body.baseDraft,source,options):null;
   return call('create',{id:body.requestId,format:NPC_SHEET_AI_FORMAT,details:body.details.trim(),withIcon:false,actorSource:source,options,sheet:sheetContext,baseDraft});
  }
  const stored=await call('job',{id:route.jobId});if(!stored.ok)return stored;const {job}=await stored.json();if(job.format!==NPC_SHEET_AI_FORMAT)return fail('Proposta della scheda non trovata.',404);
  if(route.action==='save')return call('save',{id:route.jobId,draft:body.draft});
  if(route.action!=='confirm')return fail('Questa proposta non genera immagini.',405);
  if(job.status==='accepted')return reply({ok:true,command:job.command});
  const commands=await services.readNativeCommands(campaignId,route),duplicate=commands.find(command=>command.nativeSheetVersion===1&&command.clientRequestId===job.id);
  if(duplicate){const command=services.commandForReader(duplicate);const accepted=await call('accepted',{id:job.id,command});if(!accepted.ok)return accepted;return reply({ok:true,command});}
  const options=npcSheetAiOptions(record,actor,job.options.mode);
  if(record.snapshot.versions?.nativeSheetEditor!==1)return fail('La proposta è conservata. L’invio sarà disponibile appena Wiki Sync aggiornato si collega al mondo e aggiorna automaticamente la scheda: non serve una sincronizzazione manuale dell’NPC.',409);
  // Detect conflicts before freezing the draft. A failed queue insertion can
  // also release it, but only after checking that no command was committed.
  let plan;
  try{plan=npcSheetCommandPlan(job.prepared?.draft||body.draft,job.actorSource,record.snapshot.actor,options);}
  catch(error){await call('unprepare',{id:job.id});return fail(error.message,409);}
  const prepared=await call('prepare',{id:job.id,draft:body.draft});if(!prepared.ok)return prepared;const {document}=await prepared.json();
  const queued=await services.enqueueNativeSheet({version:1,requestId:job.id,plan,summary:{text:document.draft.summary,mode:document.draft.mode,names:plan.map(operation=>({operation:operation.operation,type:operation.target.type,id:operation.target.id,name:operation.document?.name||document.draft.items.find(row=>row.id===operation.target.id)?.data.name||document.draft.base.items.find(row=>row.id===operation.target.id)?.data.name||actor.name}))}});
  if(!queued.ok){
   if(queued.status<500){const saved=(await services.readNativeCommands(campaignId,route)).find(command=>command.nativeSheetVersion===1&&command.clientRequestId===job.id);if(saved){const command=services.commandForReader(saved);await call('accepted',{id:job.id,command});return reply({ok:true,command});}await call('unprepare',{id:job.id});}
   return queued;
  }const payload=await queued.json(),accepted=await call('accepted',{id:job.id,command:payload.command});if(!accepted.ok)return accepted;return reply(payload);
 }catch(error){return fail(error.message||'Impossibile preparare la modifica della scheda.',error.status||400);}
}
