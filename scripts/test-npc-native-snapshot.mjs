import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {build} from '../workers/main-worker/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../workers/main-worker/node_modules/miniflare/dist/src/index.js';
import {captureNpcNativeSnapshot,npcNativeSnapshotEnabled,npcNativeBackfillCandidates,npcNativeSnapshotHash,NPC_NATIVE_SNAPSHOT_VERSION} from '../integrations/cripta-wiki-sync/npc-native-snapshot.mjs';
import {managedActorStorageRecord} from '../workers/main-worker/src/managed-actor-store.js';
import worker from '../workers/main-worker/src/index.js';

let checks=0;
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;},ok=(value,label)=>{assert.ok(value,label);checks++;};
const secret='native-snapshot-test',campaign='cripta-di-sangue',world='world',nativeId='AbCdEfGh12345678',actorId=nativeId.toLowerCase();
const contract={name:'khuzoe-wiki-sync',version:1,module:{id:'cripta-wiki-sync',version:'0.11.14'},foundry:{generation:14,version:'14.367'},system:{id:'dnd5e',version:'5.3.3'}};
const context={campaignId:campaign,worldId:world,foundry:contract.foundry,system:contract.system,wikiSync:'0.11.14',modules:[{id:'z-unknown',version:'2',active:true},{id:'disabled',version:'1',active:false},{id:'dae',version:'3',active:true}]};
const native={_id:nativeId,type:'npc',name:'Snapshot test',img:'original.webp',folder:'folder-id',sort:4,ownership:{default:0,gm:3},
 system:{attributes:{hp:{value:20,max:60}},unrecognized:{nullable:null,empty:[],emptyText:'',falseValue:false,zero:0}},
 prototypeToken:{actorLink:false,texture:{src:'token.webp'},flags:{thirdParty:{unknown:true}}},
 flags:{thirdParty:{nested:{unknown:'keep'},text:'È un testo; 🐉\n'.repeat(2500)},'khuzoe-automations':{midiRollConfig:{version:1,secretRule:'private-probabilities'}}},
 items:[{_id:'Item123456789012',name:'Ability',type:'feat',system:{activities:{Activity12345678:{_id:'Activity12345678',type:'save',save:{dc:{formula:'16'}},custom:{unknown:null}}}},
  effects:[{_id:'Effect1234567890',changes:[{key:'system.unknown',value:'',mode:2}],flags:{unknownModule:{keep:true}}}],flags:{other:{macro:'private-macro-data'}}}],
 effects:[{_id:'ActorEffect12345',name:'Effect',disabled:false,changes:[],statuses:[],flags:{private:{text:'GM-only'}}}],
 _stats:{coreVersion:'14.367',systemVersion:'5.3.3',modifiedTime:1000,compendiumSource:null},unknownTopLevel:{preserve:true}};
const clone=x=>structuredClone(x);
const makeActor=(source=native)=>({id:nativeId,uuid:`Actor.${nativeId}`,type:'npc',documentName:'Actor',isToken:false,toJSON:()=>clone(source),update(){assert.fail('Snapshot export must not update Actors');},setFlag(){assert.fail('Snapshot export must not set flags');}});
const parent={schemaVersion:4,campaignId:campaign,id:`${world}:${actorId}`,worldId:world,actorId,foundryActorId:nativeId,actorUuid:`Actor.${nativeId}`,name:'Snapshot test',actorType:'npc',revision:5,
 visibility:{state:'dm'},ownerAccountIds:['owner'],relationshipType:'companion',definition:{prototypeToken:{actorLink:false},items:[]},runtime:{},system:{id:'dnd5e',version:'5.3.3'}};
const actorKey=`campaign:${campaign}:managed-actor:${world}:${actorId}`,snapshotKey=`campaign:${campaign}:managed-actor-native-snapshot:${world}:${actorId}`,indexKey=`campaign:${campaign}:managed-actors:index`;
const path=`/api/managed-actors/${world}/${actorId}`;
const token=account=>{const data=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({accountId:account,username:account,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')].join('.');return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');};
const syncHeaders={'Content-Type':'application/json','X-Cripta-Inventory-Secret':secret,'X-Khuzoe-Sync-Contract':'1','X-Khuzoe-Foundry-Generation':'14'};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../workers/main-worker/src/index.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022'});
const runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',kvNamespaces:['SIGILLO_KV'],kvPersist:false,d1Databases:['POLL_DB'],d1Persist:false,
 bindings:{JWT_SECRET:secret,INVENTORY_SYNC_SECRET:secret,GLOBAL_ADMIN_ACCOUNT_IDS:'admin',CAMPAIGN_EDITOR_ACCOUNT_IDS:`${campaign}:dm`,MANAGED_ACTOR_D1_CAMPAIGNS:campaign,MANAGED_ACTOR_NATIVE_SNAPSHOT_CAMPAIGNS:campaign}});
async function call(endpoint=path+'/snapshot',body,account='admin',target=campaign,overrides={}){
 const headers=account==='foundry'?{...syncHeaders,...overrides}:{'Content-Type':'application/json',Origin:'https://khuzoe.github.io',...(account?{Authorization:'Bearer '+token(account)}:{}),...overrides};
 const response=await runtime.dispatchFetch(`https://local.test${endpoint}?campaign=${target}`,{headers,...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
 return {status:response.status,body:await response.json(),headers:response.headers};
}
async function seed(db,key,raw){const record=managedActorStorageRecord(key,raw),d=record.document;assert.ok(!record.chunks.length);await db.prepare('INSERT INTO managed_actor_documents(campaign_id,document_key,kind,revision,present,payload,chunk_count,updated_at) VALUES(?,?,?,?,1,?,0,?)').bind(d.campaign,key,d.kind,1,d.payload,d.at).run();}
try{
 const db=await runtime.getD1Database('POLL_DB'),kv=await runtime.getKVNamespace('SIGILLO_KV');
 const schema=await readFile(new URL('../workers/main-worker/migrations/0004_managed_actors.sql',import.meta.url),'utf8');await db.batch(schema.replace(/^\s*--.*$/gm,'').split(';').filter(s=>s.trim()).map(s=>db.prepare(s)));
 await db.prepare("INSERT INTO managed_actor_imports(campaign_id,migration_id,state,imported_at,document_count,manifest_sha256) VALUES(?,'test','ready','now',2,'test')").bind(campaign).run();
 const original=JSON.stringify(parent,null,2),index=JSON.stringify({campaignId:campaign,version:4,profileAccessVersion:2,actorLinkIndexVersion:1,data:[parent]});
 await seed(db,actorKey,original);await seed(db,indexKey,index);await kv.put(actorKey,original);await kv.put(indexKey,index);
 const first=await captureNpcNativeSnapshot(makeActor(),context);equal(first.actor,native,'Exact native export, including all flags, metadata and long strings');
 equal(await npcNativeSnapshotHash(first,{subtle:null}),first.hash,'HTTP LAN fallback matches native SHA-256');
 for(const length of [0,1,55,56,63,64,65,127]){const boundary={...first,actor:{...native,padding:'x'.repeat(length)}};equal(await npcNativeSnapshotHash(boundary,{subtle:null}),await npcNativeSnapshotHash(boundary),'SHA-256 padding boundary');}
 equal(first.versions.modules.map(m=>m.id),['dae','z-unknown']);equal(first.schemaVersion,1);
 equal(npcNativeSnapshotEnabled('mago-folle',makeActor()),true);equal(await captureNpcNativeSnapshot({...makeActor(),type:'character'},context),null);equal(await captureNpcNativeSnapshot({...makeActor(),isToken:true},context),null);
 let sourceRead=false;const sourceFallback={...makeActor(),toJSON:undefined,toObject(source){sourceRead=source;return clone(native);},system:{attributes:{hp:{value:999}}}};
 equal((await captureNpcNativeSnapshot(sourceFallback,context)).actor,native,'Capture reads persistent source rather than prepared values');equal(sourceRead,true);
 const reordered={...first,actor:Object.fromEntries(Object.entries(first.actor).reverse()),capturedAt:'2030-01-01'};equal(await npcNativeSnapshotHash(reordered),first.hash,'Key ordering and capture timestamp do not generate writes');
 equal((await call()).body.code,'NPC_SNAPSHOT_PENDING');
 const beforeActor=await call(path),beforeIndex=await call('/api/managed-actors');equal(beforeActor.status,200);equal(beforeIndex.status,200);
 const posted=await call(undefined,{campaignId:campaign,contract,snapshot:first},'foundry');equal(posted.status,200,JSON.stringify(posted.body));equal(posted.body.saved,true);equal(posted.body.hash,first.hash);
 const get=await call();equal(get.status,200);equal(get.body.data.snapshot.actor,native);ok(get.headers.get('cache-control').includes('no-store'));equal(get.body.data.actorRevision,5);
 const revision=(await db.prepare('SELECT revision FROM managed_actor_documents WHERE campaign_id=? AND document_key=?').bind(campaign,snapshotKey).first()).revision;
 const repeated=await call(undefined,{campaignId:campaign,contract,snapshot:{...first,capturedAt:new Date().toISOString()}},'foundry');equal(repeated.status,200);equal(repeated.body.saved,false);
 equal((await db.prepare('SELECT revision FROM managed_actor_documents WHERE campaign_id=? AND document_key=?').bind(campaign,snapshotKey).first()).revision,revision,'Unchanged snapshots do not rewrite D1');
 for(const account of ['','dm','owner','other','foundry'])ok([401,403].includes((await call(undefined,undefined,account)).status),'Only the global admin reads raw JSON');
 for(const account of ['admin','dm','owner',''])equal((await call(undefined,{campaignId:campaign,contract,snapshot:first},account)).status,403,'Site accounts cannot write raw sources');
 equal((await call(undefined,{campaignId:campaign,contract,snapshot:first},'foundry',campaign,{'X-Khuzoe-Foundry-Generation':'13'})).status,426);
 equal((await call(undefined,{campaignId:campaign,contract,snapshot:{...first,actor:{...native,name:'Tampered'}}},'foundry')).status,400);
 equal((await call(undefined,{campaignId:'mago-folle',contract,snapshot:first},'foundry')).status,400);
 equal((await call(undefined,{campaignId:campaign,contract,snapshot:{...first,identity:{...first.identity,foundryActorId:'other'}}},'foundry')).status,400);
 equal((await call(undefined,{campaignId:'mago-folle',contract,snapshot:first},'foundry','mago-folle')).body.code,'NPC_SNAPSHOT_DISABLED');
 equal(await kv.get('campaign:mago-folle:managed-actor-native-snapshot:world:'+actorId),null);
 const changedSource=clone(native);changedSource._stats.modifiedTime=2000;changedSource.flags.thirdParty.onlyChangedFlag={nothingElse:7};
 const changed=await captureNpcNativeSnapshot(makeActor(changedSource),context);equal((await call(undefined,{campaignId:campaign,contract,snapshot:changed},'foundry')).body.saved,true);
 equal((await call()).body.data.snapshot.actor,changedSource,'Changes outside the light projection are retained');
 equal((await call(undefined,{campaignId:campaign,contract,snapshot:first},'foundry')).body.code,'NPC_SNAPSHOT_STALE');
 equal((await call(path)).body,beforeActor.body,'Raw export never changes normal Actor response');equal((await call('/api/managed-actors')).body,beforeIndex.body,'Raw export never changes the index');
 ok(!JSON.stringify((await call(path)).body).includes('private-probabilities'),'Raw private flags never enter regular endpoints');

 const large=clone(changedSource);large.flags.longText='🐉È'.repeat(420000);large._stats.modifiedTime=3000;
 const largeSnapshot=await captureNpcNativeSnapshot(makeActor(large),context);ok(Buffer.byteLength(JSON.stringify(largeSnapshot))>2000000);
 equal((await call(undefined,{campaignId:campaign,contract,snapshot:largeSnapshot},'foundry')).status,200);
 equal((await call()).body.data.snapshot.actor,large,'Large Unicode native source survives D1 chunking');
 ok((await db.prepare('SELECT chunk_count FROM managed_actor_documents WHERE campaign_id=? AND document_key=?').bind(campaign,snapshotKey).first()).chunk_count>1);
 await db.prepare("CREATE TRIGGER reject_native_snapshot BEFORE UPDATE ON managed_actor_documents WHEN NEW.kind='native-snapshot' BEGIN SELECT RAISE(ABORT,'forced failure'); END").run();
 const failing=clone(large);failing._stats.modifiedTime=4000;
 equal((await call(undefined,{campaignId:campaign,contract,snapshot:await captureNpcNativeSnapshot(makeActor(failing),context)},'foundry')).status,503);
 equal((await call()).body.data.snapshot.hash,largeSnapshot.hash,'A failed save preserves the previous complete snapshot');await db.prepare('DROP TRIGGER reject_native_snapshot').run();
 equal(await kv.get(actorKey),original);equal(await kv.get(indexKey),index);equal(await kv.get(snapshotKey),null,'No snapshot is ever written to KV');
 const noKvEnv={POLL_DB:db,MANAGED_ACTOR_D1_CAMPAIGNS:campaign,MANAGED_ACTOR_NATIVE_SNAPSHOT_CAMPAIGNS:campaign,JWT_SECRET:secret,INVENTORY_SYNC_SECRET:secret,GLOBAL_ADMIN_ACCOUNT_IDS:'admin',
  SIGILLO_KV:{get(){assert.fail('Snapshot route must not read KV');},put(){assert.fail('Snapshot route must not write KV');},delete(){assert.fail('KV delete');}}};
 const noKv=await worker.fetch(new Request(`https://local.test${path}/snapshot?campaign=${campaign}`,{headers:{Authorization:'Bearer '+token('admin')}}),noKvEnv,{});equal(noKv.status,200);
 const unavailable=await worker.fetch(new Request(`https://local.test${path}/snapshot?campaign=${campaign}`,{headers:{Authorization:'Bearer '+token('admin')}}),{...noKvEnv,POLL_DB:null},{});equal(unavailable.status,503,'D1 outages never fall back to KV');
 const oversized=clone(native);oversized.flags.long='x'.repeat(9*1024*1024);await assert.rejects(()=>captureNpcNativeSnapshot(makeActor(oversized),context),e=>e.code==='NPC_SNAPSHOT_TOO_LARGE');checks++;

 if(process.argv[2]){
  const moduleSource=await readFile(process.argv[2],'utf8'),settings=new Map([['campaignId',campaign],['managedActorSyncState',{[nativeId]:{revision:5,schemaVersion:4}}]]);
  let network=0,ensureIds=0,push=true,fail=false;const timers=[],messages=[];
  const sandbox={console:{info(){},warn(...args){messages.push(args);},error(){}},URL,AbortSignal,structuredClone,crypto,Set,Map,WeakSet,
   MODULE_ID:'cripta-wiki-sync',SETTINGS:{CAMPAIGN_ID:'campaignId'},DISCORD_WORKER_URL:'https://local.test',NPC_NATIVE_SNAPSHOT_VERSION,captureNpcNativeSnapshot,npcNativeSnapshotEnabled,npcNativeBackfillCandidates,
   canPushToWorker:()=>push,canPullFromWorker:()=>true,isTemporaryWikiActor:a=>Boolean(a?.temporary),
   window:{setTimeout(fn,delay){timers.push({fn,delay});return timers.length;},clearTimeout(){}},
   foundry:{utils:{deepClone:clone}},game:{user:{id:'gm',isGM:true},users:{activeGM:{id:'gm'}},world:{id:world},scenes:[],
    settings:{get(_module,key){return settings.get(key)||{};},async set(_module,key,value){settings.set(key,value);}},
    modules:new Map(context.modules.map(m=>[m.id,m])),actors:null},
   buildFoundrySyncContract:()=>contract,
   policyFetch:async(url,init)=>{network++;if(fail)return Response.json({ok:false,error:'temporary'}, {status:503});return runtime.dispatchFetch(url,init);}};
  const testActor=makeActor(changedSource);sandbox.game.actors={get:id=>id===nativeId?testActor:null,*[Symbol.iterator](){yield testActor;}};
  vm.createContext(sandbox);vm.runInContext(moduleSource.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+
   `\ncallbacks={ensureTransferIds:async()=>{throw new Error('Backfill must not assign IDs');}};buildWorkerAuthHeaders=()=>(${JSON.stringify(syncHeaders)});globalThis.test={sync:syncManagedActorNow,resume:resumeManagedActorSyncQueue,normalize:normalizeTokenizerEvent,merge:mergeTokenizerEvents,reset:()=>pendingJobs.clear(),pending:()=>Array.from(pendingJobs.values()),backfill:()=>Array.from(nativeSnapshotBackfillQueue.keys())};`,sandbox);
  // Use a later source version than the large fixture for the actual module-to-Worker run.
  changedSource._stats.modifiedTime=5000;equal(await sandbox.test.sync(testActor,{nativeSnapshotOnly:true}),true);equal(network,1);
  equal((await call()).body.data.snapshot.actor,changedSource,'Actual module sends to the actual Worker/D1 route');
  equal(settings.get('managedActorSyncState')[nativeId].nativeSnapshotVersion,1);ok(!JSON.stringify(settings.get('managedActorSyncState')).includes('private-probabilities'),'Full JSON is not copied into world settings');
  equal(await sandbox.test.sync(testActor,{nativeSnapshotOnly:true}),true);equal(network,1,'Unchanged native source sends no second request');
  const confirmedHash=settings.get('managedActorSyncState')[nativeId].nativeSnapshotHash;
  changedSource.flags.thirdParty.changedAgain=true;changedSource._stats.modifiedTime=6000;fail=true;
  await assert.rejects(()=>sandbox.test.sync(testActor,{nativeSnapshotOnly:true}));checks++;
  equal(settings.get('managedActorSyncState')[nativeId].nativeSnapshotHash,confirmedHash,'A failed upload never records an unsaved hash');
  fail=false;push=false;const count=network;equal(await sandbox.test.sync(testActor,{nativeSnapshotOnly:true}),false);equal(network,count,'Pull-only mode never exports native snapshots');push=true;
  settings.set('campaignId','unconfigured');equal(await sandbox.test.sync(testActor,{nativeSnapshotOnly:true}),false);equal(network,count,'Unknown campaigns never export snapshots');settings.set('campaignId',campaign);
  const state=settings.get('managedActorSyncState');delete state[nativeId].nativeSnapshotVersion;settings.set('managedActorSyncState',state);
  await sandbox.test.resume();ok(sandbox.test.backfill().includes(nativeId),'Existing NPCs get an independent read-only startup backfill');
  const snapshotEvent=sandbox.test.normalize({nativeSnapshotOnly:true}),normalEvent=sandbox.test.normalize({reason:'actor-update',forceContentSync:true});
  equal(sandbox.test.merge(snapshotEvent,normalEvent).nativeSnapshotOnly,false,'A snapshot cannot suppress a queued normal edit');equal(sandbox.test.merge(normalEvent,snapshotEvent).nativeSnapshotOnly,false);
  const beforeOtherClients=network;sandbox.game.users.activeGM.id='another-gm';equal(await sandbox.test.sync(testActor,{nativeSnapshotOnly:true}),false);equal(network,beforeOtherClients,'Only the primary GM exports snapshots');sandbox.game.users.activeGM.id='gm';
  equal(await sandbox.test.sync({...testActor,temporary:true},{nativeSnapshotOnly:true}),false);equal(network,beforeOtherClients,'Temporary transformations are excluded');
  equal(JSON.stringify(messages).includes('private-probabilities'),false,'Console never logs native flag contents');
 }
 console.log(`Native NPC snapshots: ${checks} checks passed (complete JSON, D1, private access, KV preservation${process.argv[2]?', installed module/backfill':''}).`);
}finally{await runtime.dispose();}
