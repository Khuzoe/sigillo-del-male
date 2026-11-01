import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as snapshots from '../integrations/cripta-wiki-sync/npc-native-snapshot.mjs';
let checks=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;},ok=(v,label)=>{assert.ok(v,label);checks++;};
const clone=structuredClone,world='test-world',firstId='FirstNPC00000001',secondId='SecondNPC0000001';
const raw=id=>({_id:id,type:'npc',name:id,system:{attributes:{hp:{value:10,max:30}}},items:[],effects:[],flags:{secret:{value:'PRIVATE SOURCE'}},_stats:{modifiedTime:1}});
const actor=id=>({id,uuid:`Actor.${id}`,documentName:'Actor',type:'npc',isToken:false,source:raw(id),toJSON(){return clone(this.source);},update(){assert.fail('Backfill must never update an Actor');},setFlag(){assert.fail('Backfill must not set Actor flags');}});
const first=actor(firstId),second=actor(secondId),unshared=actor('Unshared00000001'),temporary={...actor('Temporary0000001'),temporary:true};
const actors=[first,second,unshared,temporary,{...actor('Player0000000001'),type:'character'}];
for(const campaignId of snapshots.NPC_NATIVE_SNAPSHOT_CAMPAIGNS){const candidates=snapshots.npcNativeBackfillCandidates(actors,{campaignId,worldId:world,state:{[firstId]:{revision:1}},known:[{worldId:world,foundryActorId:secondId},{worldId:'other',foundryActorId:unshared.id}]});eq(candidates.map(a=>a.id),[firstId,secondId],'Known NPCs from local state or the remote index, never unrelated worlds or players');}
eq(snapshots.npcNativeBackfillCandidates(actors,{campaignId:'unknown',worldId:world}).length,0);
const modulePath=process.argv[2]||'C:/Program Files/Foundry DEV TEST/FoundryVTT-WindowsPortable-14.367/Data/modules/cripta-wiki-sync/scripts/services/managed-actor-sync.js';
const source=await readFile(modulePath,'utf8'),settings=new Map([['campaignId','cripta-di-sangue'],['managedActorSyncState',{[firstId]:{revision:5}}]]),timers=new Map(),requests=[],messages=[];
let nextTimer=0,push=true,fail=false;
const collection={get:id=>actors.find(actor=>actor.id===id),*[Symbol.iterator](){yield* actors;}};
const sandbox={...snapshots,console:{info(){},warn(...args){messages.push(args);}},URL,AbortSignal,crypto,structuredClone,Set,Map,WeakSet,
 MODULE_ID:'cripta-wiki-sync',SETTINGS:{CAMPAIGN_ID:'campaignId'},DISCORD_WORKER_URL:'https://test.invalid',canPushToWorker:()=>push,canPullFromWorker:()=>true,isTemporaryWikiActor:actor=>Boolean(actor?.temporary),
 foundry:{utils:{deepClone:clone}},game:{user:{id:'gm',isGM:true},users:{activeGM:{id:'gm'}},world:{id:world},actors:collection,modules:new Map(),settings:{get:(_module,key)=>settings.get(key)||{},async set(_module,key,value){settings.set(key,clone(value));}}},
 window:{setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}},
 buildFoundrySyncContract:()=>({foundry:{generation:14,version:'14.367'},system:{id:'dnd5e',version:'5.3.3'},module:{id:'cripta-wiki-sync',version:'0.11.19'}}),
 policyFetch:async(url,options)=>{const body=JSON.parse(options.body);requests.push({url:String(url),body});if(fail)return Response.json({ok:false,error:'temporarily unavailable'},{status:503});return Response.json({ok:true,hash:body.snapshot.hash,schemaVersion:1,actorRevision:9,receivedAt:'now'});}};
vm.createContext(sandbox);vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+`
buildWorkerAuthHeaders=()=>({});callbacks={ensureTransferIds:()=>{throw Error('No transfer ID changes');}};
globalThis.test={queue:queueManagedNpcNativeBackfill,flush:flushManagedNpcNativeBackfill,keys:()=>Array.from(nativeSnapshotBackfillQueue.keys()),known:(campaign,data)=>{managedActorRelationshipCache.campaignId=campaign;managedActorRelationshipCache.payload={data};},media:()=>pendingJobs.set('${firstId}',{forceContentSync:true}),mediaPending:()=>pendingJobs.has('${firstId}')};`,sandbox);
sandbox.test.known('cripta-di-sangue',[{worldId:world,foundryActorId:secondId},{worldId:world,foundryActorId:temporary.id}]);
sandbox.test.media();sandbox.test.queue();eq(Array.from(sandbox.test.keys()),[firstId,secondId],'A regular media job cannot suppress the independent source archive; temporary forms excluded');const timerCount=timers.size;sandbox.test.queue();eq(timers.size,timerCount,'Repeated bootstrap does not create competing timers');
await sandbox.test.flush();await sandbox.test.flush();eq(requests.length,2);eq(requests.map(r=>r.body.snapshot.identity.foundryActorId),[firstId,secondId]);ok(sandbox.test.mediaPending(),'Source export preserves the queued media/content edit');ok(!JSON.stringify([...settings]).includes('PRIVATE SOURCE'),'Only confirmation metadata enters world settings');
eq(settings.get('managedActorSyncState')[secondId].revision,9,'A confirmed remote-only Actor recovers its metadata so future edits remain automatic');
sandbox.test.queue();await sandbox.test.flush();await sandbox.test.flush();eq(requests.length,2,'Reload checks all known NPCs but never uploads an unchanged hash');
first.source.system.attributes.hp.value=7;first.source._stats.modifiedTime=2;sandbox.test.queue();await sandbox.test.flush();await sandbox.test.flush();eq(requests.length,3,'Changes made while Wiki Sync was disabled are found on startup without a click');eq(requests.at(-1).body.snapshot.actor.system.attributes.hp.value,7);
const previousHash=settings.get('managedActorSyncState')[firstId].nativeSnapshotHash;first.source._stats.modifiedTime=3;fail=true;sandbox.test.queue();await sandbox.test.flush();eq(settings.get('managedActorSyncState')[firstId].nativeSnapshotHash,previousHash,'Network failures cannot mark unarchived data as synchronized');ok(sandbox.test.keys().includes(firstId));eq([...timers.values()].at(-1).delay,60000,'Network failure backs off without dropping the retry');ok(!JSON.stringify(messages).includes('PRIVATE SOURCE'));
fail=false;await sandbox.test.flush();await sandbox.test.flush();eq(settings.get('managedActorSyncState')[firstId].nativeSheetVersion,1);ok(settings.get('managedActorSyncState')[firstId].nativeSnapshotHash!==previousHash,'Automatic retry records the confirmed result');
push=false;const before=requests.length;sandbox.test.queue();await sandbox.test.flush();eq(requests.length,before,'Pull-only mode never exports sources');push=true;sandbox.game.users.activeGM.id='other-gm';sandbox.test.queue();await sandbox.test.flush();eq(requests.length,before,'Only the elected GM owns the source backfill');
eq(first.source.system.attributes.hp.value,7);eq(second.source.system.attributes.hp.value,10);eq(unshared.source.system.attributes.hp.value,10);
// Execute the actual UI status updater: passive source polling must never
// overwrite a new prompt or restore an addition removed from an unsaved draft.
const uiSource=await readFile(new URL('../assets/js/shared/npc-sheet-ai.js',import.meta.url),'utf8'),start=uiSource.indexOf('  function ingest(payload){'),end=uiSource.indexOf('  async function load()',start);ok(start>=0&&end>start);
const ui={model:{NPC_SHEET_AI_FORMAT:'npc-native-sheet-edit-v1'},Date,JSON,setTimeout(){return 1;},clearTimeout(){}};vm.createContext(ui);
vm.runInContext(`let job=null,editor=null,fresh=false,renderedId='',pendingRequest=null,sharedRuntime=true,enabled=true,canGenerate=true,canSync=false,loaded=false,timer,waitingSince=0,closed=false;
const nodes=new Map(),el=key=>{if(!nodes.has(key))nodes.set(key,{});return nodes.get(key);},running=()=>job?.status==='running',renderProposal=()=>{},controls=()=>{},persist=()=>{},status=()=>{},load=()=>{};
${uiSource.slice(start,end)}
globalThis.test={ingest,prepare:state=>{job=state.job;editor=state.editor;fresh=state.fresh||false;el('[data-prompt]').value=state.prompt;},state:()=>JSON.parse(JSON.stringify({job,editor,fresh,renderedId,canSync,prompt:el('[data-prompt]').value}))};`,ui);
const originalJob={id:'job-one',format:'npc-native-sheet-edit-v1',status:'ready',details:'Richiesta originale',draft:{createdItems:[{id:'new-item'}]}},localJob=clone(originalJob);localJob.draft.createdItems=[];
ui.test.prepare({job:localJob,editor:{active:true},prompt:'Richiesta corretta'});ui.test.ingest({job:originalJob,canGenerate:true,canSync:false});let uiState=ui.test.state();eq(uiState.job.draft.createdItems.length,0,'Availability polling preserves additions removed from an unsaved proposal');eq(uiState.prompt,'Richiesta corretta');
ui.test.prepare({job:originalJob,editor:null,fresh:true,prompt:'Una nuova richiesta ancora in scrittura'});ui.test.ingest({job:originalJob,canGenerate:true,canSync:true});uiState=ui.test.state();eq(uiState.prompt,'Una nuova richiesta ancora in scrittura','Automatic synchronization does not replace a new prompt');eq(uiState.fresh,true);eq(uiState.canSync,true,'The same dialog unlocks submission without regeneration');
ui.test.prepare({job:localJob,editor:{active:true},prompt:'Draft'});ui.test.ingest({job:{...originalJob,status:'accepted'},canGenerate:true,canSync:true});eq(ui.test.state().editor,null,'A confirmed proposal adopts the authoritative frozen state');
console.log(`Automatic NPC sources: ${checks} checks passed; all campaigns, startup reconciliation, unchanged hashes, media independence, remote-index recovery, retries, privacy and elected-GM policy. No real Actor or network writes.`);
