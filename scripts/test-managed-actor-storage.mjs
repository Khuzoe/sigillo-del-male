import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from '../workers/main-worker/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../workers/main-worker/node_modules/miniflare/dist/src/index.js';
import worker from '../workers/main-worker/src/index.js';
import {ManagedActorTransaction,managedActorStorageRecord,splitManagedActorText,managedActorKeyScope} from '../workers/main-worker/src/managed-actor-store.js';
import {importManagedActorSql} from './migrate-managed-actors-d1.mjs';
import {compileAbility} from '../assets/js/shared/npc-ability-schema.mjs';

const secret='npc-storage-local-test',campaign='pilot',world='world';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../workers/main-worker/src/index.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022'});
const runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',kvNamespaces:['SIGILLO_KV'],kvPersist:false,d1Databases:['POLL_DB'],d1Persist:false,
 bindings:{JWT_SECRET:secret,INVENTORY_SYNC_SECRET:secret,GLOBAL_ADMIN_ACCOUNT_IDS:'admin',MANAGED_ACTOR_D1_CAMPAIGNS:'pilot,empty,large',MANAGED_ACTOR_WRITES_PAUSED_CAMPAIGNS:'paused',DISCORD_BOT_TOKEN:''}});
let checks=0;const equal=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const jwt=account=>{const data=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({accountId:account,username:account,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')].join('.');return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');};
const syncHeaders={'Content-Type':'application/json','X-Cripta-Inventory-Secret':secret,'X-Khuzoe-Sync-Contract':'1','X-Khuzoe-Foundry-Generation':'14'};
const contract={name:'khuzoe-wiki-sync',version:1,module:{id:'cripta-wiki-sync',version:'0.11.13'},foundry:{generation:14,version:'14.367'},system:{id:'dnd5e',version:'5.3.3'}};
const actorKey=id=>`campaign:${campaign}:managed-actor:${world}:${id}`,indexKey=`campaign:${campaign}:managed-actors:index`,queueKey=`campaign:${campaign}:managed-actor-commands:${world}`;
const actorPath=id=>`/api/managed-actors/${world}/${id}`;
async function call(path,body,account='admin',target=campaign){
 const headers=account==='foundry'?syncHeaders:{'Content-Type':'application/json',Origin:'https://khuzoe.github.io',...(account?{Authorization:'Bearer '+jwt(account)}:{})};
 const response=await runtime.dispatchFetch(`https://local.test${path}?campaign=${target}`,{headers,...(body===undefined?{}:{method:'POST',body:JSON.stringify({campaignId:target,...body})})});
 return {status:response.status,body:await response.json(),headers:response.headers};
}
async function postToOriginal(kv,id,name){
 const response=await worker.fetch(new Request(`https://local.test${actorPath(id)}?campaign=${campaign}`,{method:'POST',headers:syncHeaders,
  body:JSON.stringify({campaignId:campaign,contract,expectedRevision:0,writeScopes:['content','runtime','media'],name,actorType:'npc',ownerAccountIds:['alice'],relationshipType:'companion',
    prototypeToken:{actorLink:true},actorLink:true,definition:{actorLink:true,attributes:{hp:{max:60}},items:[],unrecognized:{preserve:true}},runtime:{hp:{value:20,max:60}},contentHash:`original-${id}`,mediaHash:'none'})}),
  {SIGILLO_KV:kv,JWT_SECRET:secret,INVENTORY_SYNC_SECRET:secret,GLOBAL_ADMIN_ACCOUNT_IDS:'admin'}, {waitUntil(){}});
 equal(response.status,200,'Original contract accepted before migration');
}
async function seed(db,key,raw){
 const record=managedActorStorageRecord(key,raw,1,'2026-10-31'),d=record.document;
 const statements=[db.prepare('INSERT INTO managed_actor_documents(campaign_id,document_key,kind,revision,present,payload,chunk_count,updated_at) VALUES(?,?,?,?,?,?,?,?)')
  .bind(d.campaign,key,d.kind,d.revision,1,d.payload,d.chunks,d.at)];
 for(const chunk of record.chunks)statements.push(db.prepare('INSERT INTO managed_actor_document_chunks(campaign_id,document_key,part,payload) VALUES(?,?,?,?)').bind(d.campaign,key,chunk.part,chunk.payload));
 for(const command of record.commands)statements.push(db.prepare('INSERT INTO managed_actor_commands(campaign_id,queue_key,command_id,position,actor_id,status,present,payload) VALUES(?,?,?,?,?,?,1,?)')
  .bind(d.campaign,key,command.id,command.position,command.actor,command.status,command.payload));
 await db.batch(statements);
}
try{
 const db=await runtime.getD1Database('POLL_DB'),kv=await runtime.getKVNamespace('SIGILLO_KV');
 const schema=await readFile(new URL('../workers/main-worker/migrations/0004_managed_actors.sql',import.meta.url),'utf8');
 for(let repeat=0;repeat<2;repeat++)await db.batch(schema.replace(/^\s*--.*$/gm,'').split(';').filter(sql=>sql.trim()).map(sql=>db.prepare(sql)));
 await postToOriginal(kv,'a','First NPC');await postToOriginal(kv,'b','Second NPC');
 const originalA=JSON.parse(await kv.get(actorKey('a'))),originalB=JSON.parse(await kv.get(actorKey('b')));
 originalA.nativeUnknown={flags:{module:{unknown:'keep'}},nested:[1,{text:'È un’abilità; \"x\" 🐉'}]};
 await kv.put(actorKey('a'),JSON.stringify(originalA,null,2));
 const initialIndex=JSON.parse(await kv.get(indexKey));initialIndex.profileAccessVersion=2;initialIndex.actorLinkIndexVersion=1;initialIndex.customMetadata={keep:true};await kv.put(indexKey,JSON.stringify(initialIndex));
 const oldCommand={id:'existing',actorId:'a',worldId:world,kind:'actor.update',status:'pending',patches:[{path:'system.attributes.hp.value',baseValue:20,value:25}],unknown:{keep:true}};
 await kv.put(queueKey,JSON.stringify({schemaVersion:1,campaignId:campaign,worldId:world,version:7,updatedAt:'old',commands:[oldCommand],unknown:{preserve:true}}));
 await kv.put(`campaign:${campaign}:managed-actor-profile:${world}:a`,JSON.stringify({campaignId:campaign,worldId:world,actorId:'a',name:'First NPC',revision:4,visibility:{state:'dm'},blocks:[{id:'secret',type:'text',text:'Secret dossier',visibility:'dm'}],unknown:'keep'}));
 const originals=new Map();for(const {name}of(await kv.list()).keys){const raw=await kv.get(name);originals.set(name,raw);await seed(db,name,raw);}
 for(const id of [campaign,'large'])await db.prepare("INSERT INTO managed_actor_imports(campaign_id,migration_id,state,imported_at,document_count,manifest_sha256) VALUES(?,?,'ready','now',0,'test')").bind(id,id).run();
 const env={SIGILLO_KV:kv,POLL_DB:db,MANAGED_ACTOR_D1_CAMPAIGNS:campaign,JWT_SECRET:secret,INVENTORY_SYNC_SECRET:secret,GLOBAL_ADMIN_ACCOUNT_IDS:'admin'};
 equal((await call(actorPath('a'))).body.data.nativeUnknown,originalA.nativeUnknown,'Unknown native data preserved');
 equal((await call(actorPath('a'),undefined,'')).status,403,'Private stats remain private');
 equal((await call(actorPath('a'))).headers.get('X-Managed-Actor-Storage'),'d1');
 equal((await call(actorPath('a'),undefined,'alice')).body.data.permissions.canEdit,true,'Companion owner still edits');
 equal((await call(actorPath('a'),undefined,'bob')).status,403,'Other player cannot read private NPC');
 equal((await call('/api/managed-actors/storage/status',undefined,'alice')).status,403);
 equal((await call('/api/managed-actors/storage/status')).body.source,'d1');
 const beforeIndex=await call('/api/managed-actors');equal(beforeIndex.status,200);equal(beforeIndex.body.data.length,2);

 // Independent Actor saves compete for the same index: bounded retries retain both.
 const edits=await Promise.all(['a','b'].map((id,i)=>call(actorPath(id),{contract,expectedRevision:1,name:`Changed ${id}`,contentHash:`changed-${id}`,mediaHash:'none',writeScopes:['content'],
  actorType:'npc',prototypeToken:{actorLink:true},actorLink:true,definition:{actorLink:true,attributes:{hp:{max:60}},items:[],unrecognized:{preserve:true}}},'foundry')));
 for(const edit of edits)equal(edit.status,200,JSON.stringify(edit.body));
 const afterIndex=await call('/api/managed-actors');equal(afterIndex.body.data.map(a=>a.name),['Changed a','Changed b']);
 equal(JSON.parse(await new ManagedActorTransaction(env).get(indexKey)).customMetadata,{keep:true},'Index metadata preserved');
 const revision=(await call(actorPath('a'))).body.data.revision;
 const sharedRace=await Promise.all([41,42].map(value=>call(actorPath('a'),{contract,expectedRevision:revision,name:'Race '+value,contentHash:'race-'+value,writeScopes:['content'],actorType:'npc',definition:{actorLink:true,attributes:{hp:{max:60}},items:[]}},'foundry')));
 equal(sharedRace.map(r=>r.status).sort(),[200,409],'Same-Actor stale write rejected');

 const currentA=(await call(actorPath('a'))).body.data,currentB=(await call(actorPath('b'))).body.data;
 const queueRequest=(id,revision,value)=>call(actorPath(id)+'/commands',{kind:'actor.update',expectedRevision:revision,patches:[{path:'system.attributes.hp.value',baseValue:20,value}]});
 const queued=await Promise.all([queueRequest('a',currentA.revision,40),queueRequest('b',currentB.revision,35)]);
 for(const item of queued)equal(item.status,202,JSON.stringify(item.body));
 let list=await call(`/api/managed-actor-commands/${world}`,undefined,'foundry');equal(list.body.commands.length,2,'Both concurrent commands retained');
 const olderId=queued[0].body.command.id;
 const newer=await queueRequest('a',currentA.revision,45);equal(newer.status,202);ok(newer.body.command.id!==olderId,'New payload rotates ID');
 const staleAck=await call(`/api/managed-actor-commands/${world}/ack`,{results:[{id:olderId,status:'applied'}]},'foundry');equal(staleAck.status,200);
 list=await call(`/api/managed-actor-commands/${world}`,undefined,'foundry');ok(list.body.commands.some(c=>c.id===newer.body.command.id),'Old ACK cannot delete newer payload');
 equal((await call(`/api/managed-actor-commands/${world}/ack`,{results:list.body.commands.map(c=>({id:c.id,status:'applied'}))},'foundry')).status,200);
 equal((await call(`/api/managed-actor-commands/${world}`,undefined,'foundry')).body.commands,[]);
 ok((await db.prepare('SELECT COUNT(*) AS n FROM managed_actor_commands WHERE campaign_id=? AND present=0').bind(campaign).first()).n>=3,'Archived commands retained separately');
 equal((await db.prepare('SELECT status FROM managed_actor_command_receipts WHERE campaign_id=? AND command_id=?').bind(campaign,newer.body.command.id).first()).status,'applied','Foundry ACK recorded');
 equal((await call(`/api/managed-actor-commands/${world}/ack`,{results:[{id:newer.body.command.id,status:'failed'}]},'foundry')).status,200);
 equal((await db.prepare('SELECT status FROM managed_actor_command_receipts WHERE campaign_id=? AND command_id=?').bind(campaign,newer.body.command.id).first()).status,'applied','A late failed ACK cannot downgrade a completed receipt');

 // A rejected compare-and-swap must not change a sibling record or publish.
 const first=new ManagedActorTransaction(env),second=new ManagedActorTransaction(env);
 const raw=await first.get(actorKey('a'));await second.get(actorKey('a'));
 await first.put(actorKey('a'),JSON.stringify({...JSON.parse(raw),name:'Transaction winner'}));await first.commit();
 const indexBefore=await new ManagedActorTransaction(env).get(indexKey);let invalidations=0;
 await second.put(actorKey('a'),JSON.stringify({...JSON.parse(raw),name:'Stale loser'}));await second.put(indexKey,JSON.stringify({...JSON.parse(indexBefore),unknown:'must roll back'}));second.defer(()=>invalidations++);
 await assert.rejects(()=>second.commit(),error=>error.code==='MANAGED_ACTOR_STORAGE_CONFLICT');checks++;
 equal(await new ManagedActorTransaction(env).get(indexKey),indexBefore,'CAS failure is atomic');equal(invalidations,0,'Failed write does not notify Foundry');
 equal((await db.prepare('SELECT COUNT(*) AS n FROM managed_actor_transactions').first()).n,0,'Transaction gates do not accumulate');
 // Real SQLite failure must roll back the Actor and index together.
 const actorBefore=await new ManagedActorTransaction(env).get(actorKey('a'));
 await db.prepare("CREATE TRIGGER reject_npc_index BEFORE UPDATE ON managed_actor_documents WHEN NEW.kind='index' BEGIN SELECT RAISE(ABORT,'forced failure'); END").run();
 const failing=new ManagedActorTransaction(env);await failing.put(actorKey('a'),JSON.stringify({...JSON.parse(actorBefore),name:'Should roll back'}));await failing.put(indexKey,JSON.stringify({...JSON.parse(indexBefore),unknown:'trigger'}));
 await assert.rejects(()=>failing.commit());checks++;equal(await new ManagedActorTransaction(env).get(actorKey('a')),actorBefore,'SQL failure rolls back Actor');equal(await new ManagedActorTransaction(env).get(indexKey),indexBefore);
 await db.prepare('DROP TRIGGER reject_npc_index').run();

 // Paid generation is mocked; acceptance must observe an already committed D1
 // save/command. Otherwise a coordinator could accept a merely staged change.
 const aiActor=JSON.parse(await new ManagedActorTransaction(env).get(actorKey('a')));
 aiActor.definition.editor={...(aiActor.definition.editor||{}),generatedAbilities:1};
 aiActor.media={avatar:{path:'media/campaigns/pilot/managed-actors/world/a/base/old.webp',revision:1}};
 const setupAi=new ManagedActorTransaction(env);await setupAi.put(actorKey('a'),JSON.stringify(aiActor));await setupAi.commit();
 let acceptedAvatar=0,acceptedAbility=0;
 const jobId='00000000-0000-4000-8000-000000000001',expectedAvatar=`media/campaigns/pilot/managed-actors/world/a/base/avatar-ai-${jobId}.webp`;
 const mockBucket={head:async()=>({size:30}),get:async()=>({body:new Uint8Array([1,2,3])}),put:async()=>{},delete:async()=>assert.fail('D1 pilot must retain old media')};
 const aiEnv={...env,MEDIA_BUCKET:mockBucket,AVATAR_GENERATOR:{idFromName:x=>x,get:()=>({fetch:async request=>{
   const action=new URL(request.url).pathname.slice(1);
   if(action==='job')return Response.json({job:{id:jobId,status:'ready',reference:aiActor.media.avatar}});
   equal(action,'accepted');equal(JSON.parse(await new ManagedActorTransaction(env).get(actorKey('a'))).media.avatar.path,expectedAvatar,'Avatar committed before coordinator accepts');acceptedAvatar++;return Response.json({ok:true});
 }})}};
 const aiRequest=(path,body)=>new Request(`https://local.test${actorPath('a')}/${path}?campaign=pilot`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt('admin')},body:JSON.stringify(body)});
 let aiResponse=await worker.fetch(aiRequest(`avatar-generation/${jobId}/confirm`,{}),aiEnv,{waitUntil(p){p.catch(()=>{});}});
 equal(aiResponse.status,200,await aiResponse.text());equal(acceptedAvatar,1);
 const fixture=await readFile(new URL('./test-ability-generation.mjs',import.meta.url),'utf8');
 const draft=vm.runInNewContext(fixture.slice(fixture.indexOf('const draft ='),fixture.indexOf('const compiled ='))+'draft');
 const ability=compileAbility(draft,'d1-generated');
 aiEnv.ABILITY_GENERATOR={idFromName:x=>x,get:()=>({fetch:async request=>{
   const action=new URL(request.url).pathname.slice(1);
   if(action==='job')return Response.json({job:{id:jobId,status:'ready',prepared:true}});
   if(action==='prepare')return Response.json({document:ability});
   equal(action,'accepted');const stored=JSON.parse(await new ManagedActorTransaction(env).get(queueKey));ok(stored.commands.some(c=>c.document?.transferId===ability.transferId),'Ability command committed before coordinator accepts');acceptedAbility++;return Response.json({ok:true});
 }})};
 aiResponse=await worker.fetch(aiRequest(`ability-generation/${jobId}/confirm`,{}),aiEnv,{waitUntil(p){p.catch(()=>{});}});
 equal(aiResponse.status,200,await aiResponse.text());equal(acceptedAbility,1);
 const failDocument={...ability,transferId:'must-not-be-accepted'};
 aiEnv.ABILITY_GENERATOR={idFromName:x=>x,get:()=>({fetch:async request=>{
   const action=new URL(request.url).pathname.slice(1);
   if(action==='job')return Response.json({job:{id:jobId,status:'ready',prepared:true}});
   if(action==='prepare')return Response.json({document:failDocument});
   assert.fail('A failed D1 write cannot accept an AI job');
 }})};
 await db.prepare("CREATE TRIGGER reject_generated_command BEFORE INSERT ON managed_actor_commands BEGIN SELECT RAISE(ABORT,'forced failure'); END").run();
 aiResponse=await worker.fetch(aiRequest(`ability-generation/${jobId}/confirm`,{}),aiEnv,{waitUntil(){}});equal(aiResponse.status,503);
 ok(!JSON.parse(await new ManagedActorTransaction(env).get(queueKey)).commands.some(c=>c.document?.transferId===failDocument.transferId),'Failed AI confirmation leaves no partial command');
 await db.prepare('DROP TRIGGER reject_generated_command').run();

 // Large multibyte JSON and original whitespace survive chunking exactly.
 const largeKey='campaign:large:managed-actor:world:big',largeRaw=JSON.stringify({campaignId:'large',actorId:'big',worldId:'world',nativeFlags:{text:'🐉È;\n'.repeat(290000)}},null,2);
 ok(Buffer.byteLength(largeRaw)>2000000);equal(splitManagedActorText(largeRaw).join(''),largeRaw);
 await seed(db,largeKey,largeRaw);const largeStore=new ManagedActorTransaction({...env,MANAGED_ACTOR_D1_CAMPAIGNS:'large'});equal(await largeStore.get(largeKey),largeRaw);
 const largeNext=largeRaw.replace('"actorId": "big"','"actorId": "big", "extra": true');await largeStore.put(largeKey,largeNext);await largeStore.commit();equal(await largeStore.get(largeKey),largeNext);
 // Batch hydration stays comfortably below Free query limits.
 let calls=0;const counted={...env,POLL_DB:{prepare(...args){calls++;return db.prepare(...args);},batch:db.batch.bind(db)}};
 const hydration=new ManagedActorTransaction(counted);await Promise.all(Array.from({length:175},(_,i)=>hydration.get(`campaign:pilot:managed-actor-profile:world:profile-${i}`)));
 ok(calls<=4,`Hydration used ${calls} queries`);

 const forbiddenKv={get(){assert.fail('Enabled D1 campaign must never read old KV');},put(){assert.fail('KV write');},delete(){assert.fail('KV delete');}};
 equal(JSON.parse(await new ManagedActorTransaction({...env,SIGILLO_KV:forbiddenKv}).get(actorKey('a'))).name,'Transaction winner');
 const noImport=await call('/api/managed-actors',undefined,'admin','empty');equal(noImport.status,503);equal(noImport.body.code,'MANAGED_ACTOR_IMPORT_NOT_READY');
 equal((await call(actorPath('x'),{contract},'foundry','paused')).body.code,'MANAGED_ACTOR_WRITES_PAUSED');
 equal((await call(`/api/managed-actor-commands/${world}`,undefined,'foundry','paused')).body.code,'MANAGED_ACTOR_WRITES_PAUSED','Paused campaigns do not deliver commands for execution');
 const legacy=await call(actorPath('legacy'),{contract,name:'Legacy campaign',actorType:'npc',definition:{},contentHash:'legacy'},'foundry','untouched');equal(legacy.status,200);ok(await kv.get('campaign:untouched:managed-actor:world:legacy'));
 for(const [key,value]of originals)equal(await kv.get(key),value,'Every original KV value remains byte-identical');

 const documents=[...originals].map(([key,raw],i)=>({key,file:`${i}.json`,bytes:Buffer.byteLength(raw),sha256:createHash('sha256').update(raw).digest('hex')}));
 const manifest={campaignId:campaign,createdAt:'2026-10-31',migrationId:'local-test',manifestSha256:'test',documents};
 const sql=importManagedActorSql(manifest,originals);ok(!/(?:^|\n)\s*(?:UPDATE\b|DELETE FROM managed_actor_documents)/i.test(sql),'Importer never replaces live D1 documents');
 const beforeReimport=await new ManagedActorTransaction(env).get(actorKey('a'));
 // Re-importing an already active campaign cannot overwrite its live revision.
 for(const statement of importManagedActorSql(manifest,originals,{statements:true}))await db.prepare(statement).run();
 equal(await new ManagedActorTransaction(env).get(actorKey('a')),beforeReimport,'Importer refuses ready campaigns');
 const importCampaign='offline',importRaw=JSON.stringify({campaignId:importCampaign,actorId:'big',worldId:'world',unknown:'🐉;È\n\"'.repeat(55000)},null,2);
 const importKey='campaign:offline:managed-actor:world:big',importManifest={...manifest,campaignId:importCampaign,migrationId:'offline-test',documents:[{key:importKey,file:'one',bytes:Buffer.byteLength(importRaw),sha256:createHash('sha256').update(importRaw).digest('hex')}]};
 const statements=importManagedActorSql(importManifest,new Map([[importKey,importRaw]]),{statements:true});
 for(const statement of statements)await db.prepare(statement).run();
 await db.prepare("UPDATE managed_actor_imports SET state='ready' WHERE campaign_id='offline'").run();
 equal(await new ManagedActorTransaction({...env,MANAGED_ACTOR_D1_CAMPAIGNS:'offline'}).get(importKey),importRaw,'Large literal import survives 100 KB SQL limit');
 equal((await db.prepare('SELECT COUNT(*) AS n FROM managed_actor_import_parts').first()).n,0,'Importer staging does not accumulate');
 const output=resolve('output/npc-d1/tests');await mkdir(output,{recursive:true});await writeFile(resolve(output,'import.sql'),sql);await writeFile(resolve(output,'schema.sql'),schema);
 equal(managedActorKeyScope('campaign:pilot:data:characters:override'),null,'Unrelated character collection is untouched');
 console.log(`Managed Actors D1: ${checks} checks passed.`);
}finally{await runtime.dispose();}
