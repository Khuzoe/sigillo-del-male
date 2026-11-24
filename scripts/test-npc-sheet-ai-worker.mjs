import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHmac} from "node:crypto";
import {Miniflare} from "../workers/main-worker/node_modules/miniflare/dist/src/index.js";
import worker from "../workers/main-worker/src/index.js";
import {AbilityGenerationStore} from "../workers/main-worker/src/ability-generation.js";
import {managedActorStorageRecord} from "../workers/main-worker/src/managed-actor-store.js";
import {nativeAbilityProposal,nativeAbilityActor,nativeAbilityVersions} from "./fixtures/npc-native-ability.mjs";

import {editAbilityItem,itemId,attackId,capabilities} from "./fixtures/npc-native-ability-edit.mjs";
import {nativeAbilityEditProjection} from "../assets/js/shared/npc-native-ability-edit.mjs";
let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(a,message)=>{assert.ok(a,message);checks++;};
class Storage{
 values=new Map();async get(k){return structuredClone(this.values.get(k));}async put(k,v){if(typeof k==="object")for(const[key,value]of Object.entries(k))await this.put(key,value);else this.values.set(k,structuredClone(v));}async delete(k){this.values.delete(k);}async setAlarm(value){this.alarm=value;}async deleteAlarm(){this.alarm=null;}async transaction(fn){const before=structuredClone(this.values);try{return await fn(this);}catch(error){this.values=before;throw error;}}
}
const campaign=process.argv[2]||"cripta-di-sangue",world="world",id=nativeAbilityActor._id.toLowerCase(),secret="native-ai-local-test";
const actorKey=`campaign:${campaign}:managed-actor:${world}:${id}`,snapshotKey=`campaign:${campaign}:managed-actor-native-snapshot:${world}:${id}`;
const actor={campaignId:campaign,worldId:world,actorId:id,foundryActorId:nativeAbilityActor._id,name:nativeAbilityActor.name,actorType:"npc",revision:5,visibility:{state:"dm"},prototypeToken:{actorLink:true},definition:{editor:{generatedAbilities:1},attributes:{hp:{value:20,max:90,temp:0}},items:[]},runtime:{hp:{value:20,max:90}}};
const record={campaignId:campaign,worldId:world,actorId:id,snapshot:{schemaVersion:1,actor:structuredClone(nativeAbilityActor),versions:{...structuredClone(nativeAbilityVersions),nativeAbilityEdit:1,nativeSheetEditor:1,npcRulesHealingTypes:1}},receivedAt:"now"};
record.snapshot.actor.items=[structuredClone(editAbilityItem)];
const kv=new Map([[actorKey,"ORIGINAL KV ACTOR"],[`campaign:${campaign}:managed-actor-profile:${world}:${id}`,"ORIGINAL KV DOSSIER"],[`campaign:unconfigured:managed-actor:${world}:${id}`,JSON.stringify({...actor,campaignId:"unconfigured"})],["unrelated-key","ORIGINAL OTHER DATA"]]);
const beforeKV=structuredClone([...kv]),writes=[],objects=new Map(),references=new Map(),referenceReads=[],storage=new Storage();
const runtime=new Miniflare({modules:true,script:"export default {fetch(){return new Response('local test')}}",compatibilityDate:"2026-05-15",d1Databases:["POLL_DB"]});
const originalFetch=globalThis.fetch;let requests=[];
const rule={version:1,activities:{[attackId]:{healing:1,healingTypes:["necrotic"],conditions:[],rounds:0,expiry:"turnEnd"}}};
const set=(path,value)=>({path,op:'set',valueJson:JSON.stringify(value)});
const operation=(type,target,changes,extra={})=>({targetType:type,targetId:target,parentItemId:'',operation:'update',itemType:'',name:'',changes,...extra});
const nativeField=(path,value)=>({path,op:'set',value});
let proposal={summary:'Traduzione completa',balance:'Regole invariate',assumptions:[],unsupported:[],operations:[operation('Item',itemId,[nativeField('name','Morso vampirico')])]};
try{
 const db=await runtime.getD1Database("POLL_DB");
 const schema=await readFile(new URL('../workers/main-worker/migrations/0004_managed_actors.sql',import.meta.url),'utf8');await db.batch(schema.replace(/^\s*--.*$/gm,'').split(';').filter(s=>s.trim()).map(s=>db.prepare(s)));
 await db.prepare("INSERT INTO managed_actor_imports(campaign_id,migration_id,state,imported_at,document_count,manifest_sha256) VALUES(?,'test','ready','now',2,'test')").bind(campaign).run();
 async function seed(key,value){const r=managedActorStorageRecord(key,JSON.stringify(value)),d=r.document;assert.equal(d.chunks,0);await db.prepare('INSERT INTO managed_actor_documents(campaign_id,document_key,kind,revision,present,payload,chunk_count,updated_at) VALUES(?,?,?,?,1,?,0,?) ON CONFLICT(campaign_id,document_key) DO UPDATE SET payload=excluded.payload,revision=managed_actor_documents.revision+1').bind(d.campaign,key,d.kind,1,d.payload,d.at).run();}
 await seed(actorKey,actor);await seed(snapshotKey,record);
 const env={JWT_SECRET:secret,GLOBAL_ADMIN_ACCOUNT_IDS:"admin",CAMPAIGN_EDITOR_ACCOUNT_IDS:`${campaign}:dm`,MANAGED_ACTOR_D1_CAMPAIGNS:campaign,MANAGED_ACTOR_NATIVE_SNAPSHOT_CAMPAIGNS:campaign,POLL_DB:db,OPENAI_API_KEY:"fake-no-paid-calls",INVENTORY_SYNC_SECRET:secret,
  SIGILLO_KV:{async get(key){return kv.get(key)??null;},async put(key,value){writes.push(["put",key]);kv.set(key,value);},async delete(key){writes.push(["delete",key]);kv.delete(key);}},
  MEDIA_BUCKET:{async head(key){referenceReads.push(key);const ref=references.get(key);return ref?{size:ref.size??ref.bytes.length,etag:ref.etag}:objects.has(key)?{size:objects.get(key).length}:null;},async get(key){referenceReads.push(key);const ref=references.get(key);return ref?{size:ref.size??ref.bytes.length,etag:ref.etag,async arrayBuffer(){return Uint8Array.from(ref.bytes).buffer;}}:null;},async put(key,bytes){objects.set(key,bytes);},async delete(){assert.fail("No media deletions");}}};
 const coordinator=new AbilityGenerationStore({storage},env);env.ABILITY_GENERATOR={idFromName:value=>value,get:()=>({fetch:request=>coordinator.fetch(request)})};
 const token=account=>{const data=[Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString('base64url'),Buffer.from(JSON.stringify({accountId:account,username:account,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')].join('.');return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');};
 async function call(action='',body,account='dm',targetCampaign=campaign,mode='sheet'){
  const query=mode==='sheet'?'&editor=npc-native-sheet-edit-v1':mode==='edit'?`&editor=npc-native-ability-edit-v1&item=${itemId}`:mode==='create'?'&editor=npc-native-ability-v1':'';
  const response=await worker.fetch(new Request(`https://worker.test/api/managed-actors/${world}/${id}/ability-generation${action}?campaign=${targetCampaign}${query}`,{headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(account)}`},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})}),env,{waitUntil(p){p.catch(()=>{});}});return{status:response.status,body:await response.json()};
 }
 globalThis.fetch=async(url,options)=>{if(String(url)!=='https://api.openai.com/v1/responses')throw new Error('Unexpected outbound request');requests.push(JSON.parse(options.body));return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(proposal)}]}]});};
 eq((await call('',undefined,'player')).status,403);
 eq((await call('',undefined,'admin','unconfigured')).status,409);
 const old=structuredClone(record);delete old.snapshot.versions.nativeSheetEditor;delete old.snapshot.schemaVersion;await seed(snapshotKey,old);
 eq((await call('',{requestId:crypto.randomUUID(),details:'Traduci tutto',mode:'translate'})).status,409);eq(requests.length,0);await seed(snapshotKey,record);
 const binding=env.ABILITY_GENERATOR;env.ABILITY_GENERATOR={idFromName:v=>v,get:()=>({fetch:async()=>Response.json({ok:true,job:null,nativeAbilityEditor:1})})};eq((await call()).status,503);env.ABILITY_GENERATOR=binding;
 const compiler=(await import('../assets/js/shared/npc-sheet-ai-model.mjs')).NPC_SHEET_AI_COMPILER;
 const latestStub=respond=>({idFromName:v=>v,get:()=>({fetch:async request=>{
  assert.equal(new URL(request.url).pathname,'/latest');return respond();
 }})});
 for(const capabilities of [{nativeSheetEditor:6},{nativeSheetFormat:'npc-native-sheet-edit-v1',nativeSheetEditor:compiler+1}]){
  env.ABILITY_GENERATOR=latestStub(()=>Response.json({ok:true,job:null,...capabilities}));
  eq((await call()).status,200,'Compatible coordinators allow the editor to open across compiler revisions');
 }
 env.ABILITY_GENERATOR=latestStub(()=>Response.json({ok:true,job:null,nativeSheetEditor:compiler,nativeSheetFormat:'npc-native-sheet-edit-v2'}));
 eq((await call()).status,503,'An explicitly incompatible format takes precedence over the compiler');
 env.ABILITY_GENERATOR=latestStub(()=>Response.json({error:'La proposta è incompleta nell’archivio.'},{status:409}));
 const unreadable=await call();eq(unreadable.status,409);eq(unreadable.body.error,'La proposta è incompleta nell’archivio.');
 env.ABILITY_GENERATOR=latestStub(()=>new Response('unavailable',{status:502}));eq((await call()).status,502);
 eq(requests.length,0);
 env.ABILITY_GENERATOR={idFromName:v=>v,get:()=>({fetch:async request=>new URL(request.url).pathname==='/public-job'?Response.json({error:'missing'},{status:404}):Response.json({ok:true,job:null,nativeSheetEditor:compiler})})};eq((await call('',{requestId:crypto.randomUUID(),details:'Usa anche l’avatar',mode:'general'})).status,503,'An older coordinator cannot silently omit visual input');eq(requests.length,0);env.ABILITY_GENERATOR=binding;
 const jobId=crypto.randomUUID(),request={requestId:jobId,details:'Traduci tutte le capacità in italiano',mode:'translate'};
 const starts=await Promise.all([call('',request),call('',request)]);eq(starts.map(r=>r.status).sort(),[200,202]);eq(starts[0].body.job.format,'npc-native-sheet-edit-v1');
 await coordinator.alarm();eq(requests.length,1);const sent=requests[0];eq(sent.text.format.name,'npc_sheet_edit');eq(sent.model,'gpt-6.2-sol');eq(sent.reasoning,{effort:'medium'});eq(sent.max_output_tokens,32000);eq(sent.store,false);eq(JSON.parse(sent.input).mode,'translate');eq(JSON.parse(sent.input).versions.system.version,'5.3.3');
 const translationOp=sent.text.format.schema.properties.operations.items.properties;
 eq(translationOp.operation.enum,['update']);eq(translationOp.changes.items.properties.value.type,'string');
 eq(JSON.parse(sent.input).contract.fieldForms,undefined);
 for(const secret of ['PRIVATE ROLL CONFIG','PRIVATE FLAGS','PRIVATE MACRO','PRIVATE ORIGIN','privateOwner','PRIVATE EFFECT SOURCE','PRIVATE ACTIVITY FLAGS'])ok(!sent.input.includes(secret),secret+' does not reach AI');
 let state=await call();eq(state.body.hasAvatar,false);eq(state.body.supportsVisualInput,true);eq(state.body.job.usesAvatar,false);eq(state.body.job.status,'ready',JSON.stringify(state.body));eq(state.body.job.draft.items[0].data.name,'Morso vampirico');ok(!JSON.stringify(state.body).includes('PRIVATE ROLL CONFIG'));ok(!JSON.stringify(state.body).includes('PRIVATE MACRO'));
 eq((await call('',undefined,'dm',campaign,'edit')).body.job,null);eq((await call('',undefined,'dm',campaign,'create')).body.job,null);eq((await call(`/${jobId}/save`,{draft:state.body.job.draft},'dm',campaign,'edit')).status,404);
 const draft=structuredClone(state.body.job.draft);draft.items[0].data.name='Morso della cripta';eq((await call(`/${jobId}/save`,{draft})).status,200);eq(requests.length,1);
 const bad=structuredClone(draft);bad.items[0].data.system.activities[attackId].attack.bonus='12';eq((await call(`/${jobId}/save`,{draft:bad})).status,400,'Translation cannot change mechanical fields');
 const live=structuredClone(record);live.snapshot.actor.system.attributes.hp.value=7;live.snapshot.actor.items[0].system.uses.spent=2;await seed(snapshotKey,live);
 let confirmed=await call(`/${jobId}/confirm`,{draft});eq(confirmed.status,200,JSON.stringify(confirmed.body));eq(confirmed.body.command.nativeSheetVersion,1);eq(confirmed.body.command.document,undefined,'Browser acknowledgement never contains raw hidden fields');
 const row=await db.prepare('SELECT payload FROM managed_actor_commands').first(),command=JSON.parse(row.payload);eq(command.nativeSheetVersion,1);eq(command.document.operations.length,1);eq(command.document.operations[0].target.id,itemId);eq(command.document.operations[0].patches.map(p=>p.path),['name']);
 eq(confirmed.body.command.campaignId,campaign);eq(confirmed.body.command.worldId,world);
 const pollResponse=await worker.fetch(new Request(`https://worker.test/api/managed-actor-commands/${world}?campaign=${campaign}`,{headers:{'X-Cripta-Inventory-Secret':secret,'X-Khuzoe-Sync-Contract':'1','X-Khuzoe-Foundry-Generation':'14'}}),env,{}),poll=await pollResponse.json();eq(pollResponse.status,200,JSON.stringify(poll));eq(poll.commands[0].campaignId,campaign);eq(poll.commands[0].nativeSheetVersion,1);eq(poll.commands[0].document.operations,command.document.operations,'Foundry receives the full native group through the authenticated poll');
 eq((await db.prepare('SELECT count(*) AS n FROM managed_actor_commands').first()).n,1);eq((await call(`/${jobId}/confirm`,{draft})).body.command.id,confirmed.body.command.id);
 eq((await call('',{requestId:crypto.randomUUID(),details:'Altra modifica',mode:'general'})).status,409);eq((await call('',{requestId:crypto.randomUUID(),details:'Altra modifica',withIcon:false},'dm',campaign,'edit')).status,409);eq(requests.length,1);
 eq((await call('',{requestId:crypto.randomUUID(),details:'Altra capacità',withIcon:false},'dm',campaign,'create')).status,409,'A group in flight blocks another paid ability creation');
 const editorRequest=new Request(`https://worker.test/api/managed-actors/${world}/${id}/editor?campaign=${campaign}`,{headers:{Authorization:`Bearer ${token('dm')}`}}),editorResponse=await worker.fetch(editorRequest,env,{}),reader=await editorResponse.json();ok(reader.data.commands.some(c=>c.nativeSheetVersion===1));ok(!JSON.stringify(reader).includes('PRIVATE ROLL CONFIG'));
 const {npcSheetJobStorage}=await import('../workers/main-worker/src/npc-sheet-job-storage.js'),chunks=npcSheetJobStorage(storage),prepared=await chunks.get(`job:${jobId}`);prepared.status='confirming';delete prepared.command;await chunks.put(`job:${jobId}`,prepared);eq((await call(`/${jobId}/confirm`,{draft})).body.command.id,command.id,'Accepted acknowledgement can be recovered without duplicate queue entries');
 await db.prepare("UPDATE managed_actor_commands SET status='applied',payload=json_set(payload,'$.status','applied')").run();await seed(snapshotKey,record);
 proposal={summary:'Potenziamento del mostro',balance:'Revisione',assumptions:[],unsupported:[],operations:[operation('Actor',nativeAbilityActor._id,[nativeField('system.attributes.hp.max',120)]),operation('Item',itemId,[nativeField('name','Morso maggiore')]),operation('Item','nuova-onda',[nativeField('system.description.value','Onda oscura'),{activityType:{activity:'onda',type:'save'}},{newActivitySave:{activity:'onda',ability:'wis',dc:15}}],{operation:'create',itemType:'feat',name:'Onda oscura'})]};
 const generalId=crypto.randomUUID();eq((await call('',{requestId:generalId,details:'Aumenta PF e aggiungi una capacità',mode:'general'})).status,202);await coordinator.alarm();state=await call();eq(state.body.job.status,'ready',JSON.stringify(state.body));eq(state.body.job.draft.createdItems.length,1);
 const stale=structuredClone(record);stale.snapshot.actor.system.attributes.hp.max=100;await seed(snapshotKey,stale);eq((await call(`/${generalId}/confirm`,{draft:state.body.job.draft})).status,409,'Conflicting stat is not overwritten');eq((await db.prepare("SELECT count(*) AS n FROM managed_actor_commands WHERE status='pending'").first()).n,0);eq((await call()).body.job.status,'ready','A failed preflight does not freeze the proposal');await seed(snapshotKey,record);
 confirmed=await call(`/${generalId}/confirm`,{draft:state.body.job.draft});eq(confirmed.status,200,JSON.stringify(confirmed.body));const group=JSON.parse((await db.prepare("SELECT payload FROM managed_actor_commands WHERE status='pending'").first()).payload);eq(group.document.operations.length,3);eq(group.document.operations.map(o=>o.operation),['update','update','create']);eq((await db.prepare("SELECT count(*) AS n FROM managed_actor_commands WHERE status='pending'").first()).n,1,'A whole-sheet change is one group, not partial commands');
 eq(Object.values(group.document.operations[2].document.system.activities)[0].save.dc.formula,'15');
 const structured=requests.at(-1).text.format;ok(structured.strict);ok(structured.schema.properties.operations.items.properties.changes.items.anyOf.some(v=>v.properties.newActivitySave));
 const contract=JSON.parse(requests.at(-1).input).contract;
 eq(Object.keys(contract.itemTemplates).length,8);eq(contract.itemTemplates.weapon.range,{value:null,long:null,reach:null,units:'ft'});
 eq(contract.fieldForms.abilityBonus,'Actor');eq(contract.fieldForms.newActivitySave,'create:activity');
 ok(Object.values(contract.activityTemplates).every(template=>!Object.hasOwn(template,'_id')));
 await db.prepare("UPDATE managed_actor_commands SET status='applied',payload=json_set(payload,'$.status','applied')").run();const stoppedId=crypto.randomUUID(),paidBefore=requests.length;eq((await call('',{requestId:stoppedId,details:'Prova interruzione',mode:'general'})).status,202);eq(storage.values.get(`job:${stoppedId}`).storageFormat,'npc-sheet-job-chunks-v1');eq((await call(`/${stoppedId}/stop`,{attemptId:stoppedId})).body.job.status,'uncertain');eq(await storage.get('active'),undefined,'Stop releases the shared generator lock');eq(requests.length,paidBefore,'Stopping a pending job does not call AI');
 const archived=structuredClone(record);delete archived.snapshot.versions.nativeSheetEditor;await seed(snapshotKey,archived);let availability=await call();eq(availability.body.canGenerate,true,'A complete archive can be used even without the new module capability');eq(availability.body.canSync,false);
 const offlineJob=crypto.randomUUID(),offlineBefore=requests.length;eq((await call('',{requestId:offlineJob,details:'Modifica usando il JSON già archiviato',mode:'general'})).status,202);await coordinator.alarm();const offline=await call();eq(offline.body.job.status,'ready',JSON.stringify(offline.body));eq(requests.length,offlineBefore+1);eq((await call(`/${offlineJob}/save`,{draft:offline.body.job.draft})).status,200,'The draft can be saved while Foundry is offline or not upgraded');eq((await call(`/${offlineJob}/confirm`,{draft:offline.body.job.draft})).status,409,'Only submission waits for a verified receiver capability');eq((await call()).body.job.status,'ready');await seed(snapshotKey,record);availability=await call();eq(availability.body.canSync,true,'Automatic upload unlocks the same proposal');
 // Simulate a second window freezing its own reviewed version between the
 // first route's read and its prepare call. The queue must match the freeze.
 const normalBinding=env.ABILITY_GENERATOR,frozenDraft=structuredClone(offline.body.job.draft);frozenDraft.items[0].data.name='Bozza confermata nell’altra finestra';let freezeOtherWindow=true;
 env.ABILITY_GENERATOR={idFromName:value=>value,get:()=>({fetch:async request=>{
  if(freezeOtherWindow&&new URL(request.url).pathname==='/prepare'){
   freezeOtherWindow=false;const body=await request.clone().json();
   const frozen=await coordinator.fetch(new Request('https://ability.internal/prepare',{method:'POST',body:JSON.stringify({...body,draft:frozenDraft})}));assert.equal(frozen.status,200);
  }
  return coordinator.fetch(request);
 }})};
 eq((await call(`/${offlineJob}/confirm`,{draft:offline.body.job.draft})).status,200);env.ABILITY_GENERATOR=normalBinding;
 const frozenCommand=JSON.parse((await db.prepare("SELECT payload FROM managed_actor_commands WHERE status='pending'").first()).payload);
 eq(frozenCommand.document.operations.find(row=>row.target.id===itemId).patches.find(row=>row.path==='name').value,frozenDraft.items[0].data.name,'The queue matches the frozen review even when another window confirms first');
 eq(requests.length,offlineBefore+1,'No new paid generation is required after automatic synchronization');
 // A failed Foundry delivery can be reviewed and resubmitted for free, with a
 // new submission identity, while the generation identity remains unchanged.
 const acceptedJob=(await call()).body.job,failedCommandId=acceptedJob.command.id,paidAtReopen=requests.length;
 await db.prepare("UPDATE managed_actor_commands SET status='failed',payload=json_set(payload,'$.status','failed','$.error','Simulated Foundry failure') WHERE command_id=?").bind(failedCommandId).run();
 eq((await call()).body.delivery.status,'failed');
 const reopened=await call(`/${acceptedJob.id}/reopen`,{});eq(reopened.status,200,JSON.stringify(reopened.body));eq(reopened.body.job.status,'ready');eq(reopened.body.job.id,acceptedJob.id);eq(requests.length,paidAtReopen,'Reopening performs no model request');
 eq((await call(`/${acceptedJob.id}/reopen`,{})).body.job.status,'ready','Reopen is idempotent');
 const resubmitted=await call(`/${acceptedJob.id}/confirm`,{draft:reopened.body.job.draft});eq(resubmitted.status,200,JSON.stringify(resubmitted.body));ok(resubmitted.body.command.id!==failedCommandId);eq(requests.length,paidAtReopen);
 eq((await db.prepare('SELECT present FROM managed_actor_commands WHERE command_id=?').bind(failedCommandId).first()).present,0,'The superseded failed command is archived with the new insertion');
 eq((await call(`/${acceptedJob.id}/confirm`,{draft:reopened.body.job.draft})).body.command.id,resubmitted.body.command.id);
 eq((await call()).body.delivery.status,'pending');eq((await call(`/${acceptedJob.id}/reopen`,{})).status,409,'A running submission cannot be reopened');
 await db.prepare("UPDATE managed_actor_commands SET status='applied',payload=json_set(payload,'$.status','applied') WHERE command_id=?").bind(resubmitted.body.command.id).run();
 eq((await call(`/${acceptedJob.id}/reopen`,{})).status,409,'An applied queue acknowledgement also prevents reopening before the next snapshot');
 record.snapshot.actor.flags??={};record.snapshot.actor.flags['cripta-wiki-sync']??={};record.snapshot.actor.flags['cripta-wiki-sync'].nativeSheetReceipts=[resubmitted.body.command.id];await seed(snapshotKey,record);
 await db.prepare("UPDATE managed_actor_commands SET status='failed',payload=json_set(payload,'$.status','failed','$.error','Late failure') WHERE command_id=?").bind(resubmitted.body.command.id).run();
 eq((await call()).body.delivery,{status:'applied',error:''},'A durable receipt takes precedence over a stale failure acknowledgement');
 await db.prepare('UPDATE managed_actor_commands SET present=0 WHERE command_id=?').bind(resubmitted.body.command.id).run();
 record.snapshot.actor.flags??={};record.snapshot.actor.flags['cripta-wiki-sync']??={};record.snapshot.actor.flags['cripta-wiki-sync'].nativeSheetReceipts=[resubmitted.body.command.id];await seed(snapshotKey,record);
 eq((await call()).body.delivery.status,'applied','A persisted Foundry receipt distinguishes applied from missing');
 eq((await call(`/${acceptedJob.id}/reopen`,{})).status,409,'Applied work cannot be resubmitted as a failed delivery');
 eq((await call('',{requestId:acceptedJob.id,details:'Retry old request',mode:'general'})).body.job.id,acceptedJob.id,'A duplicate paid request is recovered before validating a changed snapshot');eq(requests.length,paidAtReopen);
 const rejected=await coordinator.state.storage.get(`job:${acceptedJob.id}`),recoveryId=crypto.randomUUID();
 Object.assign(rejected,{id:recoveryId,status:'uncertain',rejectedSheetCompiler:1,rejectedProposal:{summary:'Allineamento',balance:'',assumptions:[],unsupported:[],operations:[operation('Actor',nativeAbilityActor._id,[{path:'system.details.alignment',op:'set',valueJson:'neutrale malvagio'}])]}});delete rejected.prepared;delete rejected.command;
 await coordinator.state.storage.put(`job:${recoveryId}`,rejected);await coordinator.state.storage.put(`latest:${campaign}:${world}:${id}:sheet`,recoveryId);
 const recovered=await call();eq(recovered.body.job.status,'ready',JSON.stringify(recovered.body));eq(recovered.body.job.draft.actor.system.details.alignment,'neutrale malvagio');ok(recovered.body.job.recoveredAt);eq(requests.length,paidAtReopen,'The exact reported parsing error is recovered without payment');
 {
  const bonusId=crypto.randomUUID(),path='system.abilities.con.bonuses.save';
  const before=structuredClone(record),saved=structuredClone(rejected);
  before.snapshot.actor.system.abilities.con={value:14,bonuses:{save:'+1',check:'+3'}};
  saved.actorSource.system.abilities.con={...before.snapshot.actor.system.abilities.con};delete saved.actorSource.system.abilities.con.bonuses;
  Object.assign(saved,{id:bonusId,rejectedSheetCompiler:9,rejectedProposal:{...saved.rejectedProposal,operations:[operation('Actor',nativeAbilityActor._id,[set(path,2)])]}});
  await coordinator.state.storage.put('job:'+bonusId,saved);await coordinator.state.storage.put(`latest:${campaign}:${world}:${id}:sheet`,bonusId);
  await seed(snapshotKey,before);
  const recovered=(await call()).body.job;eq(recovered.status,'ready');eq(recovered.draft.base.actor.system.abilities.con.bonuses,{save:'+1',check:'+3'});
  eq(recovered.draft.actor.system.abilities.con.bonuses.save,'2');
  const changed=structuredClone(before);changed.snapshot.actor.system.abilities.con.bonuses.save='+4';await seed(snapshotKey,changed);
  eq((await call('/'+bonusId+'/confirm',{draft:recovered.draft})).status,409);
  await seed(snapshotKey,before);const result=await call('/'+bonusId+'/confirm',{draft:recovered.draft});eq(result.status,200,JSON.stringify(result.body));
  const command=JSON.parse(await db.prepare('SELECT payload FROM managed_actor_commands WHERE command_id=?').bind(result.body.command.id).first('payload'));
  eq(command.document.operations[0].patches.map(p=>[p.path,p.baseValue,p.value]),[[path,'+1','2']]);
  await db.prepare('DELETE FROM managed_actor_commands WHERE command_id=?').bind(result.body.command.id).run();
  await seed(snapshotKey,record);eq(requests.length,paidAtReopen);
 }
 {
  const gripId=crypto.randomUUID(),details='Serraggio (Ricarica 5–6): TS Destrezza CD 19, 4d8 contundenti, metà se riesce.',broken='{"presa":{"type":"save"';
  const rejectedGrip={...rejected,id:gripId,details,rejectedSheetCompiler:1,rejectedProposal:{summary:'Serraggio',balance:'',assumptions:[],unsupported:[],operations:[
   operation('Item','presa',[set('system.description.value',details),{path:'system.activities',op:'set',valueJson:broken}],{operation:'create',itemType:'feat',name:'Serraggio'})
  ]}};
  await coordinator.state.storage.put('job:'+gripId,rejectedGrip);await coordinator.state.storage.put(`latest:${campaign}:${world}:${id}:sheet`,gripId);
  const state=await call();eq(state.body.job.status,'uncertain');eq(state.body.job.canRepairJson,true);eq(state.body.job.rejectedProposal,undefined);
  eq((await call('/'+gripId+'/reopen',{},'player')).status,403);
  const inspect=await call('/'+gripId+'/reopen',{});eq(inspect.body.fields,[{opIndex:0,changeIndex:1,name:'Serraggio',path:'system.activities',valueJson:broken}]);
  const repair=(valueJson,changeIndex=1)=>call('/'+gripId+'/reopen',{repairs:[{opIndex:0,changeIndex,valueJson}]});
  eq((await repair('{}',0)).status,400);eq((await repair(broken)).status,400);
  eq((await coordinator.state.storage.get('job:'+gripId)).rejectedProposal,rejectedGrip.rejectedProposal);
  const fixed=JSON.stringify({presa:{type:'save',save:{ability:['dex'],dc:{calculation:'',formula:'19'}},damage:{onSave:'half',parts:[{number:4,denomination:8,types:['bludgeoning']}]}}});
  const ready=await repair(fixed);eq(ready.body.job.status,'ready',JSON.stringify(ready.body));const item=ready.body.job.draft.createdItems[0];
  eq(item.data.system.description.value,details);eq(Object.values(item.data.system.activities)[0].save.dc.formula,'19');eq((await repair(fixed)).body.job.draft,ready.body.job.draft);
  eq(requests.length,paidAtReopen,'Inspecting, fixing and replaying the saved fragment never calls the model');
 }
 // Reopening the original four operations must never reroll a paid response.
 {
  const jobId=crypto.randomUUID(),names=['Scudo','Presidio','Turno','Tenete la linea'];
  const operations=names.map((name,index)=>operation('Item','tratto-'+index,[
   set('system.description.value',name),...(index===3?[set('system.activities.linea',{name:'Difesa',type:'reaction',activation:{type:'reaction',value:1}})]:[])
  ],{operation:'create',itemType:'feat',name}));
  await coordinator.state.storage.put('job:'+jobId,{...rejected,id:jobId,rejectedSheetCompiler:7,rejectedProposal:{...rejected.rejectedProposal,operations}});
  await coordinator.state.storage.put(`latest:${campaign}:${world}:${id}:sheet`,jobId);
  const state=await call(),job=state.body.job;eq(job.status,'ready',JSON.stringify(state.body));ok(job.recoveredAt);
  const draft=job.draft;eq(draft.createdItems.map(row=>row.data.name),names);
  const [activity]=Object.values(draft.createdItems[3].data.system.activities);eq(activity.type,'reaction');
  const pending=()=>db.prepare("SELECT count(*) AS n FROM managed_actor_commands WHERE status='pending'").first('n');
  const count=await pending(),blocked=await call('/'+jobId+'/confirm',{draft});
  ok(blocked.status>=400&&blocked.status<500);assert.match(blocked.body.error,/Tenete la linea.*reaction/);
  eq(await pending(),count);eq((await call()).body.job.status,'ready');
  activity.type='utility';
  const result=await call('/'+jobId+'/confirm',{draft});eq(result.status,200,JSON.stringify(result.body));
  const command=JSON.parse(await db.prepare('SELECT payload FROM managed_actor_commands WHERE command_id=?').bind(result.body.command.id).first('payload'));
  eq(command.document.operations.map(op=>op.document.name),names);
  eq(Object.values(command.document.operations[3].document.system.activities)[0],activity);
  eq(requests.length,paidAtReopen,'Recovery, rejected confirmation and corrected group submission never call the model');
  await db.prepare("UPDATE managed_actor_commands SET status='applied',payload=json_set(payload,'$.status','applied') WHERE command_id=?").bind(result.body.command.id).run();
 }
 // Descriptive rules are importable even when their application is manual.
 const manualNotice='Resistenza alla Magia e Resistenza Leggendaria richiedono applicazione manuale da parte del GM.',magicText='<p>Il mostro ha vantaggio ai tiri salvezza contro incantesimi e altri effetti magici.</p>',legendaryText='<p>Se fallisce un tiro salvezza, il mostro può scegliere invece di superarlo. Tre utilizzi al giorno.</p>';
 proposal={summary:'Aggiunge due tratti da gestire manualmente',balance:'Regole complete nelle descrizioni',assumptions:[],unsupported:[manualNotice],operations:[
  operation('Item','magic-resistance',[set('system.description.value',magicText)],{operation:'create',itemType:'feat',name:'Resistenza alla Magia'}),
  operation('Item','legendary-resistance',[set('system.description.value',legendaryText),set('system.uses.max','3'),set('system.uses.recovery',[{period:'day',type:'recoverAll'}])],{operation:'create',itemType:'feat',name:'Resistenza Leggendaria'})
 ]};
 const manualId=crypto.randomUUID(),beforeManual=requests.length;eq((await call('',{requestId:manualId,details:'Importa entrambe le resistenze senza automatizzarle',mode:'general'})).status,202);await coordinator.alarm();
 const manualDraft=(await call()).body.job.draft;eq(manualDraft.unsupported,[manualNotice]);eq(manualDraft.createdItems.length,2);
 eq((await call(`/${manualId}/save`,{draft:manualDraft})).status,200,'Manual notices do not prevent saving existing drafts');
 const invalidManual=structuredClone(manualDraft);invalidManual.actor.system.attributes.hp.max=-1;eq((await call(`/${manualId}/save`,{draft:invalidManual})).status,400,'Real data errors remain blocking even with a manual notice');
 const manualConfirm=await call(`/${manualId}/confirm`,{draft:manualDraft});eq(manualConfirm.status,200,JSON.stringify(manualConfirm.body));
 const manualCommand=JSON.parse((await db.prepare('SELECT payload FROM managed_actor_commands WHERE command_id=?').bind(manualConfirm.body.command.id).first()).payload),manualItems=manualCommand.document.operations.map(row=>row.document);
 eq(manualItems.map(row=>row.system.description.value),[magicText,legendaryText],'The full rules reach the Foundry queue');eq(manualItems[1].system.uses.max,'3');eq(manualItems[1].system.uses.recovery,[{period:'day',type:'recoverAll'}]);
 for(const item of manualItems){eq(item.system.activities,{},'No fake activities for passive or manual rules');eq(item.effects,[],'No fake effects are generated');}
 eq((await call()).body.job.draft.unsupported,[manualNotice],'The manual notice remains visible after submission');eq((await call(`/${manualId}/confirm`,{draft:manualDraft})).body.command.id,manualConfirm.body.command.id);eq(requests.length,beforeManual+1,'Saving and confirming a manual rule never regenerate the proposal');
 // The real route attaches the saved campaign avatar to the same structured
 // request. Visual input is transient and does not generate or update images.
 await db.prepare("UPDATE managed_actor_commands SET status='applied',payload=json_set(payload,'$.status','applied')").run();
 const avatarKey=`campaigns/${campaign}/managed-actors/${id}/avatar.png`,avatarBytes=Buffer.from('SIMULATED NPC AVATAR'),visualActor={...structuredClone(actor),media:{avatar:{path:'media/'+avatarKey}}};references.set(avatarKey,{bytes:avatarBytes,etag:'avatar-v1'});await seed(actorKey,visualActor);
 proposal={summary:'Aspetto coerente',balance:'',assumptions:['L’abbigliamento visibile ispira la descrizione.'],unsupported:[],operations:[operation('Item',itemId,[set('name','Morso visivo')])]};
 const visualId=crypto.randomUUID(),beforeVisual=requests.length;eq((await call()).body.hasAvatar,true);eq((await call('',{requestId:visualId,details:'Adatta la capacità all’aspetto del personaggio',mode:'general',referenceKey:'campaigns/other/private.png'})).status,202);await coordinator.alarm();eq(requests.length,beforeVisual+1);
 const visualRequest=requests.at(-1),visualContent=visualRequest.input[0].content,visualText=JSON.parse(visualContent[0].text);eq(visualContent.map(row=>row.type),['input_text','input_image']);eq(visualContent[1],{type:'input_image',image_url:'data:image/png;base64,'+avatarBytes.toString('base64'),detail:'low'});eq(visualText.visualReference,{included:true});eq(visualText.request,'Adatta la capacità all’aspetto del personaggio');eq(visualRequest.text.format.name,'npc_sheet_edit');eq(visualRequest.store,false);eq(visualRequest.model,'gpt-6.2-sol');eq(visualRequest.reasoning,{effort:'medium'});ok(visualRequest.instructions.includes('anatomia, abbigliamento, equipaggiamento'));ok(visualRequest.instructions.includes('non dedurre automaticamente allineamento'));ok(visualRequest.instructions.includes('In mode translate conserva integralmente regole'));
 const visualJob=(await call()).body.job;eq(visualJob.usesAvatar,true);ok(!JSON.stringify(visualJob).includes(avatarKey));ok(!JSON.stringify(visualJob).includes(avatarBytes.toString('base64')));for(const secret of ['PRIVATE ROLL CONFIG','PRIVATE FLAGS','PRIVATE MACRO','PRIVATE ORIGIN'])ok(!visualContent[0].text.includes(secret));
 const storedVisual=await coordinator.state.storage.get(`job:${visualId}`);eq(storedVisual.referenceKey,avatarKey);eq(storedVisual.referenceEtag,'avatar-v1');ok(!JSON.stringify(storedVisual).includes('data:image/'),'Base64 images never enter persisted jobs');
 const secondAvatarKey=`campaigns/${campaign}/managed-actors/${id}/updated.webp`,secondAvatarBytes=Buffer.from('UPDATED SIMULATED AVATAR');references.set(secondAvatarKey,{bytes:secondAvatarBytes,etag:'avatar-v2'});visualActor.media.avatar.path='media/'+secondAvatarKey;await seed(actorKey,visualActor);
 const revisedId=crypto.randomUUID();eq((await call('',{requestId:revisedId,details:'Rivedi la proposta con l’avatar aggiornato',mode:'general',baseJobId:visualId,baseDraft:visualJob.draft})).status,202);await coordinator.alarm();eq(requests.length,beforeVisual+2);const revisedInput=requests.at(-1).input[0].content;eq(revisedInput[1].image_url,'data:image/webp;base64,'+secondAvatarBytes.toString('base64'));eq(JSON.parse(revisedInput[0].text).previousProposal,visualJob.draft);
 const revisedJob=(await call()).body.job;eq((await call(`/${revisedId}/save`,{draft:revisedJob.draft})).status,200);const visualConfirm=await call(`/${revisedId}/confirm`,{draft:revisedJob.draft});eq(visualConfirm.status,200,JSON.stringify(visualConfirm.body));eq(requests.length,beforeVisual+2,'Save and confirmation never call the model');const visualCommand=JSON.parse((await db.prepare('SELECT payload FROM managed_actor_commands WHERE command_id=?').bind(visualConfirm.body.command.id).first()).payload);eq(visualCommand.document.operations[0].patches.map(p=>p.path),['name']);
 await db.prepare("UPDATE managed_actor_commands SET status='applied',payload=json_set(payload,'$.status','applied')").run();
 const changedId=crypto.randomUUID(),beforeChanged=requests.length;eq((await call('',{requestId:changedId,details:'Modifica con questo avatar',mode:'general'})).status,202);references.get(secondAvatarKey).etag='avatar-replaced';await coordinator.alarm();let changedJob=(await call()).body.job;eq(changedJob.status,'uncertain');eq(changedJob.errorDetail.code,'reference_changed');eq(changedJob.errorDetail.stage,'avatar-reference');eq(requests.length,beforeChanged,'An avatar changed after reservation stops before the paid call');await coordinator.alarm();eq(requests.length,beforeChanged,'Reference failures are never retried automatically');eq((await call('',{requestId:changedId,details:'Recupera lo stesso lavoro',mode:'general'})).body.job.id,changedId,'Duplicate recovery precedes reference validation');
 references.delete(secondAvatarKey);const missingId=crypto.randomUUID();eq((await call('',{requestId:missingId,details:'Avatar mancante',mode:'general'})).status,400);eq(await coordinator.state.storage.get(`job:${missingId}`),undefined);references.set(secondAvatarKey,{bytes:secondAvatarBytes,size:12*1024*1024+1,etag:'oversize'});eq((await call('',{requestId:crypto.randomUUID(),details:'Avatar troppo grande',mode:'general'})).status,400);eq(requests.length,beforeChanged);
 visualActor.media.avatar.path='media/campaigns/other/private.png';await seed(actorKey,visualActor);eq((await call()).body.hasAvatar,false);const textOnlyId=crypto.randomUUID();eq((await call('',{requestId:textOnlyId,details:'Traduci mantenendo le regole',mode:'translate'})).status,202);await coordinator.alarm();eq(typeof requests.at(-1).input,'string');eq(JSON.parse(requests.at(-1).input).visualReference,{included:false});eq((await call()).body.job.usesAvatar,false);ok(referenceReads.every(key=>key.startsWith(`campaigns/${campaign}/`)),'Other campaigns and client-supplied keys are never read');eq(objects.size,0,'Visual input never generates or rewrites media');
 const savedSnapshot=JSON.parse((await db.prepare('SELECT payload FROM managed_actor_documents WHERE document_key=?').bind(snapshotKey).first()).payload);eq(savedSnapshot.snapshot.actor,record.snapshot.actor,'Visual generations preserve the saved native NPC JSON');
 eq([...kv],beforeKV,'All original KV bytes unchanged');eq(writes,[],'No original KV put/delete');
 console.log(`Whole NPC Worker: ${checks} checks passed: real D1 routes, one-group queue, idempotence, privacy, version gates, translation and preserved KV. No paid calls.`);
}finally{globalThis.fetch=originalFetch;await runtime.dispose();}
