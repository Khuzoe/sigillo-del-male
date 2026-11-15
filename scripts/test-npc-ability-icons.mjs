import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac,randomUUID} from 'node:crypto';
import {Miniflare} from '../workers/main-worker/node_modules/miniflare/dist/src/index.js';
import worker from '../workers/main-worker/src/index.js';
import {AbilityGenerationStore,ABILITY_ICON_MODEL} from '../workers/main-worker/src/ability-generation.js';
import {AVATAR_MODEL} from '../workers/main-worker/src/avatar-generation.js';
import {buildAbilityIconPrompt,abilityIconContext,ABILITY_ICON_PROMPT_VERSION} from '../workers/main-worker/src/ability-icon-prompt.js';
import {ManagedActorTransaction,managedActorStorageRecord} from '../workers/main-worker/src/managed-actor-store.js';
import {nativeAbilityActor,nativeAbilityVersions} from './fixtures/npc-native-ability.mjs';
import {editAbilityItem,itemId} from './fixtures/npc-native-ability-edit.mjs';

class Storage {
 values=new Map();async get(k){return structuredClone(this.values.get(k));}
 async put(k,v){if(typeof k==='object')for(const[key,value]of Object.entries(k))await this.put(key,value);else this.values.set(k,structuredClone(v));}
 async delete(k){this.values.delete(k);}async setAlarm(t){this.alarm=t;}async deleteAlarm(){this.alarm=null;}
 async transaction(fn){const before=structuredClone(this.values);try{return await fn(this);}catch(error){this.values=before;throw error;}}
}
function image(width){const bytes=new Uint8Array(30);bytes.set(Buffer.from('RIFF'));new DataView(bytes.buffer).setUint32(4,22,true);bytes.set(Buffer.from('WEBPVP8X'),8);new DataView(bytes.buffer).setUint32(16,10,true);bytes[24]=bytes[27]=(width-1)&255;bytes[25]=bytes[28]=(width-1)>>8;return bytes;}
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(a,m)=>{assert.ok(a,m);checks++;};
const campaign='cripta-di-sangue',world='test-world',actorId=nativeAbilityActor._id.toLowerCase(),secret='icons-local-test';
const actorKey=`campaign:${campaign}:managed-actor:${world}:${actorId}`,snapshotKey=`campaign:${campaign}:managed-actor-native-snapshot:${world}:${actorId}`,queueKey=`campaign:${campaign}:managed-actor-commands:${world}`;
const ref=`campaigns/${campaign}/managed-actors/${world}/${actorId}/base/avatar.webp`;
const actor={campaignId:campaign,worldId:world,actorId,foundryActorId:nativeAbilityActor._id,name:'Karla',actorType:'npc',revision:5,visibility:{state:'dm'},prototypeToken:{actorLink:true},definition:{items:[]},media:{avatar:{path:`media/${ref}`,revision:1}}};
const record={campaignId:campaign,worldId:world,actorId,snapshot:{actor:structuredClone(nativeAbilityActor),versions:{...nativeAbilityVersions,nativeEditor:1,nativeAbilityEdit:1,npcRulesHealingTypes:1}}};
record.snapshot.actor.items=[structuredClone(editAbilityItem),{...structuredClone(editAbilityItem),_id:'OtherAbility0001',name:'Seconda capacità'}];
record.snapshot.actor.items[1].name='Resistenza alla Magia';record.snapshot.actor.items[1].system.description.value='<p>Vantaggio ai tiri salvezza contro incantesimi ed effetti magici.</p>';
const sourceBefore=structuredClone(record),objects=new Map([[ref,image(1024)]]),storage=new Storage(),kv=new Map([['untouched','preserved']]);
const runtime=new Miniflare({modules:true,script:"export default {fetch(){return new Response('local')}}",compatibilityDate:'2026-05-15',d1Databases:['POLL_DB']});
const originalFetch=globalThis.fetch;let requests=[],failImage=false,etag='one';
const subjectData=abilityIconContext(record.snapshot.actor.items[0],record.snapshot.actor.items),subjectBefore=JSON.stringify(record.snapshot.actor.items);
eq(subjectData.otherAbilities.map(row=>row.name),['Resistenza alla Magia']);ok(!JSON.stringify(subjectData).includes('PRIVATE FLAGS'));ok(!subjectData.otherAbilities[0].description.includes('<p>'));
const legacyPrompt=buildAbilityIconPrompt({name:'Passaggio Incorporeo',context:JSON.stringify({name:'Passaggio Incorporeo',description:'Attraversa un muro solido.'})});
eq(JSON.parse(legacyPrompt.split('\n').at(-1)).ability.description,'Attraversa un muro solido.','Legacy job descriptions are decoded instead of doubly quoted');
ok(legacyPrompt.includes('main subject communicates this specific ability'));ok(legacyPrompt.includes('Reference image 1 supplies'));ok(legacyPrompt.includes('avatar pose is not the default subject'));
const bounded=abilityIconContext(record.snapshot.actor.items[0],Array.from({length:40},(_,i)=>({_id:String(i),name:'Capacità '+i,system:{description:{value:'<p>'+('testo '.repeat(100))+'</p>'}},flags:{private:'PRIVATE SIBLING FLAGS'}})));
eq(bounded.otherAbilities.length,24);ok(bounded.otherAbilities.every(row=>row.description.length<=180));ok(!JSON.stringify(bounded).includes('PRIVATE SIBLING FLAGS'));eq(JSON.stringify(record.snapshot.actor.items),subjectBefore,'Prompt construction never alters native Items');
try {
 const db=await runtime.getD1Database('POLL_DB');
 const schema=await readFile(new URL('../workers/main-worker/migrations/0004_managed_actors.sql',import.meta.url),'utf8');
 await db.batch(schema.replace(/^\s*--.*$/gm,'').split(';').filter(s=>s.trim()).map(s=>db.prepare(s)));
 await db.prepare("INSERT INTO managed_actor_imports(campaign_id,migration_id,state,imported_at,document_count,manifest_sha256) VALUES(?,'test','ready','now',2,'test')").bind(campaign).run();
 async function seed(key,value){const d=managedActorStorageRecord(key,JSON.stringify(value)).document;assert.equal(d.chunks,0);await db.prepare('INSERT INTO managed_actor_documents(campaign_id,document_key,kind,revision,present,payload,chunk_count,updated_at) VALUES(?,?,?,?,1,?,0,?) ON CONFLICT(campaign_id,document_key) DO UPDATE SET payload=excluded.payload,revision=managed_actor_documents.revision+1').bind(d.campaign,key,d.kind,1,d.payload,d.at).run();}
 await seed(actorKey,actor);await seed(snapshotKey,record);
 const env={JWT_SECRET:secret,GLOBAL_ADMIN_ACCOUNT_IDS:'admin',CAMPAIGN_EDITOR_ACCOUNT_IDS:`${campaign}:dm`,MANAGED_ACTOR_D1_CAMPAIGNS:campaign,MANAGED_ACTOR_NATIVE_SNAPSHOT_CAMPAIGNS:campaign,POLL_DB:db,INVENTORY_SYNC_SECRET:secret,OPENAI_API_KEY:'fake-no-live-calls',ABILITY_ICON_MONTHLY_LIMIT:'4',
 SIGILLO_KV:{async get(k){return kv.get(k)||null;},async put(){assert.fail('No legacy KV writes');},async delete(){assert.fail('No deletions');}},
 MEDIA_BUCKET:{async head(k){return objects.has(k)?{size:objects.get(k).length,etag}:null;},async get(k){const b=objects.get(k);return b?{size:b.length,etag,body:new Blob([b]).stream(),arrayBuffer:async()=>b.slice().buffer}:null;},async put(k,b){objects.set(k,new Uint8Array(b));},async delete(){assert.fail('No media deletions');}}};
 const coordinator=new AbilityGenerationStore({storage},env);env.ABILITY_GENERATOR={idFromName:n=>n,get:()=>({fetch:r=>coordinator.fetch(r)})};
 const token=account=>{const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({accountId:account,username:account,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),s=head+'.'+body;return s+'.'+createHmac('sha256',secret).update(s).digest('base64url');};
 const base=`/api/managed-actors/${world}/${actorId}`;
 async function call(path=base+'/ability-icons',body,account='dm',item){const url=new URL('https://worker.test'+path);url.searchParams.set('campaign',campaign);if(item)url.searchParams.set('item',item);const response=await worker.fetch(new Request(url,{headers:{'Content-Type':'application/json',...(account==='foundry'?{'X-Cripta-Inventory-Secret':secret,'X-Khuzoe-Sync-Contract':'1','X-Khuzoe-Foundry-Generation':'14'}:{Authorization:`Bearer ${token(account)}`})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})}),env,{waitUntil(p){p.catch(()=>{});}});return {status:response.status,body:response.headers.get('Content-Type')?.includes('json')?await response.json():await response.arrayBuffer()};}
 const icons=(suffix='',body,account='dm',item=itemId)=>call(base+'/ability-icons'+suffix,body,account,item);
 globalThis.fetch=async(url,options)=>{eq(String(url),'https://api.openai.com/v1/images/edits','Icons never request a text generation');const body=JSON.parse(options.body);requests.push(body);return failImage?Response.json({error:{type:'server_error'}},{status:500}):Response.json({data:[{b64_json:Buffer.from(image(1024)).toString('base64')}]});};
 eq(AVATAR_MODEL,'gpt-image-2.6-sunburst');eq(ABILITY_ICON_MODEL,'gpt-image-2.6-sunburst');
 eq((await icons('',undefined,'player')).status,403);
 eq((await icons()).body.items.length,2);eq((await icons()).body.usage,0);eq((await icons()).body.quota,undefined);
 const binding=env.ABILITY_GENERATOR;env.ABILITY_GENERATOR={idFromName:n=>n,get:()=>({fetch:async()=>Response.json({ok:true,job:null})})};
 eq((await icons('',{requestId:randomUUID()})).status,503,'Old coordinator cannot spend on a text job');env.ABILITY_GENERATOR=binding;
 const id=randomUUID(),start=await icons('',{requestId:id});eq(start.status,202,JSON.stringify(start.body));eq(start.body.job.status,'icon-pending');
 const currentBinding=env.ABILITY_GENERATOR;
 for(const older of ['prompt','model']){
  env.ABILITY_GENERATOR={idFromName:n=>n,get:()=>({fetch:async request=>{const response=await coordinator.fetch(request);if(new URL(request.url).pathname!=='/icon-list')return response;const body=await response.json();if(older==='prompt')delete body.iconPromptVersion;else body.imageModel='gpt-image-2.6-flare';return Response.json(body,{status:response.status});}})};
  eq((await icons('',{requestId:randomUUID()},'dm','OtherAbility0001')).status,503,'An older coordinator cannot charge with the previous prompt or model');eq((await icons('',{requestId:id})).body.job.id,id,'Existing jobs remain recoverable during the rollout');eq(requests.length,0);
 }
 env.ABILITY_GENERATOR=currentBinding;
 eq((await icons('',{requestId:id})).body.job.id,id);eq((await icons()).body.usage,1);
 const secondId=randomUUID();eq((await icons('',{requestId:secondId},'dm','OtherAbility0001')).status,409,'Global paid lock is retained');
 await coordinator.alarm();eq(requests.length,1);eq(requests[0].model,'gpt-image-2.6-sunburst');eq(requests[0].quality,'medium');eq(requests[0].n,1);eq(requests[0].size,'1024x1024');ok(requests[0].images[0].image_url.startsWith('data:image/webp;base64,'));
 ok(requests[0].prompt.includes(editAbilityItem.name));ok(!requests[0].prompt.includes('PRIVATE FLAGS'));eq([...storage.values.keys()].some(k=>k.startsWith('usage:text:')),false);
 const firstPrompt=JSON.parse(requests[0].prompt.split('\n').at(-1));eq(firstPrompt.ability.name,editAbilityItem.name);eq(firstPrompt.otherAbilitiesForContrastOnly.map(row=>row.name),['Resistenza alla Magia']);ok(firstPrompt.otherAbilitiesForContrastOnly[0].description.includes('incantesimi'));ok(requests[0].prompt.includes('A palette change alone is insufficient differentiation'));eq(storage.values.get('job:'+id).iconPromptVersion,ABILITY_ICON_PROMPT_VERSION);
 const ready=(await icons()).body.jobs[0];eq(ready.status,'ready');eq(ready.iconId,id);
 eq((await icons(`/${id}/preview`)).status,200);eq((await icons(`/${id}/preview`,undefined,'dm','OtherAbility0001')).status,404);
 const bad=await icons(`/${id}/confirm`,{iconId:id,icon:Buffer.from(image(1024)).toString('base64')});eq(bad.status,400);
 const payload={iconId:id,icon:Buffer.from(image(512)).toString('base64')};
 const confirmed=await icons(`/${id}/confirm`,payload);eq(confirmed.status,202,JSON.stringify(confirmed.body));
 eq(confirmed.body.command.patches.map(p=>p.path),['img'],'Only the icon is queued');eq(confirmed.body.command.target,{type:'Item',id:itemId});
 eq((await icons(`/${id}/confirm`,payload)).body.command.id,confirmed.body.command.id,'Confirm retry is idempotent');eq(requests.length,1);
 eq(JSON.parse(await new ManagedActorTransaction(env).get(snapshotKey)),sourceBefore,'Mechanics remain unchanged');
 const commandId=confirmed.body.command.id;
 eq((await call(base+'/commands',{kind:'command.discard',commandId,expectedRevision:5})).status,409,'Pending commands cannot be discarded');
 eq((await call(`/api/managed-actor-commands/${world}/ack`,{results:[{id:commandId,status:'failed',error:'Foundry non ha conservato le modifiche alle attivita: KhzEditA00000001'}]},'foundry')).status,200);
 eq((await call(base+'/commands',{kind:'command.discard',commandId,expectedRevision:5},'player')).status,403);
 eq((await call(base+'/commands',{kind:'command.discard',commandId,expectedRevision:5})).status,200);
 eq((await call(base+'/commands',{kind:'command.discard',commandId,expectedRevision:5})).status,200,'Discard is repeatable');
 const archived=await db.prepare('SELECT present FROM managed_actor_commands WHERE campaign_id=? AND command_id=?').bind(campaign,commandId).first();eq(archived.present,0,'Discard archives the record in D1');
 await call(`/api/managed-actor-commands/${world}/ack`,{results:[{id:commandId,status:'failed'}]},'foundry');
 eq((JSON.parse(await new ManagedActorTransaction(env).get(queueKey))).commands.length,0,'Late ACK does not resurrect the problem');
 const transaction=new ManagedActorTransaction(env),queue=JSON.parse(await transaction.get(queueKey));
 queue.commands.push({id:'whole-sheet-error',actorId,kind:'actor.update',nativeSheetVersion:1,status:'conflict'}, {id:'other-actor-error',actorId:'another-npc',kind:'item.update',status:'failed'});
 await transaction.put(queueKey,JSON.stringify(queue));await transaction.commit();
 eq((await call(base+'/commands',{kind:'command.discard',commandId:'whole-sheet-error',expectedRevision:5})).status,200,'Whole-sheet errors can be discarded');
 eq((await call(base+'/commands',{kind:'command.discard',commandId:'other-actor-error',expectedRevision:5})).status,200);
 eq(JSON.parse(await new ManagedActorTransaction(env).get(queueKey)).commands.map(c=>c.id),['other-actor-error'],'Discard cannot touch another NPC');
 // Stale source and per-Item scopes, while preserving the generated preview.
 eq((await icons('',{requestId:secondId},'dm','OtherAbility0001')).status,202);await coordinator.alarm();
 const secondPrompt=JSON.parse(requests[1].prompt.split('\n').at(-1));eq(secondPrompt.ability.name,'Resistenza alla Magia');ok(secondPrompt.ability.description.includes('Vantaggio'));eq(secondPrompt.otherAbilitiesForContrastOnly.map(row=>row.name),[editAbilityItem.name]);ok(requests[1].prompt!==requests[0].prompt,'Each provider request targets the selected ability with distinct semantic data');
 ok(objects.has(`_private/ai-abilities/${id}/${id}.webp`));ok(objects.has(`_private/ai-abilities/${secondId}/${secondId}.webp`),'Separate jobs retain separate preview objects');
 record.snapshot.actor.items[1].img='changed-elsewhere.webp';await seed(snapshotKey,record);
 eq((await icons(`/${secondId}/confirm`,{iconId:secondId,icon:payload.icon},'dm','OtherAbility0001')).status,409);
 eq((await icons()).body.jobs.length,2,'Closing and reopening retrieves every latest Item preview');
 // Failed image generations retain explicit errors and never retry for money.
 failImage=true;const failureId=randomUUID();eq((await icons('',{requestId:failureId})).status,202);await coordinator.alarm();
 const failed=(await icons()).body.jobs.find(j=>j.id===failureId);eq(failed.status,'ready');ok(failed.iconError);const paid=requests.length;await coordinator.alarm();eq(requests.length,paid);
 failImage=false;const stopId=randomUUID();eq((await icons('',{requestId:stopId})).status,202);
 eq((await icons(`/${stopId}/stop`,{attemptId:randomUUID()})).status,409);eq((await icons(`/${stopId}/stop`,{attemptId:stopId})).status,200);await coordinator.alarm();eq(requests.length,paid,'Stop before alarm never calls the provider');
 const usageKey=`usage:icon:${new Date().toISOString().slice(0,7)}`;
 await storage.put(usageKey,1000000);
 for (const legacyLimit of ['0','1','invalid',undefined]) {
   if (legacyLimit===undefined) delete env.ABILITY_ICON_MONTHLY_LIMIT; else env.ABILITY_ICON_MONTHLY_LIMIT=legacyLimit;
   const unlimitedId=randomUUID();
   eq((await icons('',{requestId:unlimitedId})).status,202,'Historic usage and legacy caps cannot block icons');
   eq((await icons('',{requestId:unlimitedId})).body.job.id,unlimitedId,'Unlimited requests still deduplicate');
   eq((await icons(`/${unlimitedId}/stop`,{attemptId:unlimitedId})).status,200);
 }
 eq((await icons()).body.usage,1000004,'Usage history remains accurate without enforcing a cap');eq(requests.length,paid);
 eq([...kv],[['untouched','preserved']]);eq(JSON.parse(await new ManagedActorTransaction(env).get(actorKey)),actor);
 console.log(`NPC ability icons and discard: ${checks} checks passed; real routes, SQLite archive, paid deduplication, Sunburst medium, avatar, scopes, image-only patch, conflicts, stop and unlimited attempts. No paid calls or world data writes.`);
} finally {globalThis.fetch=originalFetch;await runtime.dispose();}
