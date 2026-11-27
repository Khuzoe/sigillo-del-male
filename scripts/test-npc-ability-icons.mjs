import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac,randomUUID} from 'node:crypto';
import {Miniflare} from '../workers/main-worker/node_modules/miniflare/dist/src/index.js';
import worker, {ActorCardStore} from '../workers/main-worker/src/index.js';
import {AbilityGenerationStore,ABILITY_ICON_MODEL} from '../workers/main-worker/src/ability-generation.js';
import {AVATAR_MODEL} from '../workers/main-worker/src/avatar-generation.js';
import {buildAbilityIconPrompt,abilityIconContext,abilityIconQuality,ABILITY_ICON_PROMPT_VERSION} from '../workers/main-worker/src/ability-icon-prompt.js';
import {ManagedActorTransaction,managedActorStorageRecord} from '../workers/main-worker/src/managed-actor-store.js';
import {nativeAbilityActor,nativeAbilityVersions} from './fixtures/npc-native-ability.mjs';
import {editAbilityItem,itemId} from './fixtures/npc-native-ability-edit.mjs';

class Storage {
 values=new Map();async get(k){return structuredClone(this.values.get(k));}
 async put(k,v){if(typeof k==='object')for(const[key,value]of Object.entries(k))await this.put(key,value);else this.values.set(k,structuredClone(v));}
 async delete(k){this.values.delete(k);}async setAlarm(t){this.alarm=t;}async deleteAlarm(){this.alarm=null;}
 async transaction(fn){const before=structuredClone(this.values);try{return await fn(this);}catch(error){this.values=before;throw error;}}
}
function image(width, height = width) {
 const bytes = new Uint8Array(30), header = new DataView(bytes.buffer);
 bytes.set(Buffer.from('RIFF'));
 header.setUint32(4, 22, true);
 bytes.set(Buffer.from('WEBPVP8X'), 8);
 header.setUint32(16, 10, true);
 header.setUint16(24, width - 1, true);
 header.setUint16(27, height - 1, true);
 return bytes;
}
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(a,m)=>{assert.ok(a,m);checks++;};
const campaign='cripta-di-sangue',world='test-world',actorId=nativeAbilityActor._id.toLowerCase(),secret='icons-local-test';
const actorKey=`campaign:${campaign}:managed-actor:${world}:${actorId}`,snapshotKey=`campaign:${campaign}:managed-actor-native-snapshot:${world}:${actorId}`,queueKey=`campaign:${campaign}:managed-actor-commands:${world}`;
const ref=`campaigns/${campaign}/managed-actors/${world}/${actorId}/base/avatar.webp`;
const actor={campaignId:campaign,worldId:world,actorId,foundryActorId:nativeAbilityActor._id,name:'Karla',actorType:'npc',revision:5,visibility:{state:'dm'},prototypeToken:{actorLink:true},definition:{items:[]},media:{avatar:{path:`media/${ref}`,revision:1}}};
const record={campaignId:campaign,worldId:world,actorId,snapshot:{actor:structuredClone(nativeAbilityActor),versions:{...nativeAbilityVersions,nativeEditor:1,nativeAbilityEdit:1,npcRulesHealingTypes:1}}};
record.snapshot.actor.items=[structuredClone(editAbilityItem),{_id:'OtherAbility0001',type:'feat',name:'Resistenza alla Magia',system:{
 description:{value:'<p>Vantaggio ai tiri salvezza contro incantesimi ed effetti magici.</p>'},
 activities:{resistance:{type:'utility',activation:{type:'turnStart'}}}
}}];
const sourceBefore=structuredClone(record),objects=new Map([[ref,image(1024)]]),storage=new Storage(),kv=new Map([['untouched','preserved']]);
for (const type of ['action','bonus','reaction','legendary','lair','minute']) eq(abilityIconQuality('feat', {activation:{type}}), 'high');
for (const type of ['', 'none','special','turnStart','turnEnd','shortRest','longRest','encounter']) {
 eq(abilityIconQuality('feat', {activities:{rule:{type:'utility',activation:{type}}}}), 'medium');
}
eq(abilityIconQuality('feat', {actionType:'rwak'}), 'high');
eq(abilityIconQuality('feat', {activities:{strike:{type:'attack'}}}), 'high');
eq(abilityIconQuality('spell', {activation:{type:'action'}, activities:{cast:{activation:{override:false,type:''}}}}), 'high');
eq(abilityIconQuality('spell', {activation:{type:'action'}, activities:{rest:{activation:{override:true,type:'shortRest'}}}}), 'medium');
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
 eq((await icons()).body.items.map(item=>[item.id,item.active]), [[itemId,true],['OtherAbility0001',false]]);
 const binding=env.ABILITY_GENERATOR;env.ABILITY_GENERATOR={idFromName:n=>n,get:()=>({fetch:async()=>Response.json({ok:true,job:null})})};
 eq((await icons('',{requestId:randomUUID()})).status,503,'Old coordinator cannot spend on a text job');env.ABILITY_GENERATOR=binding;
 for(const details of [null,{},'x'.repeat(1501)])eq((await icons('',{requestId:randomUUID(),details})).status,400,'Invalid optional directions never start a paid job');
 eq((await icons()).body.iconDirections,1);
 const iconDetails='Una runa azzurra spezzata, nessun volto';
 const id=randomUUID(),start=await icons('',{requestId:id,details:iconDetails});eq(start.status,202,JSON.stringify(start.body));eq(start.body.job.status,'icon-pending');
 const currentBinding=env.ABILITY_GENERATOR;
 for(const older of ['prompt','model']){
  env.ABILITY_GENERATOR={idFromName:n=>n,get:()=>({fetch:async request=>{const response=await coordinator.fetch(request);if(new URL(request.url).pathname!=='/icon-list')return response;const body=await response.json();if(older==='prompt')delete body.iconPromptVersion;else body.imageModel='gpt-image-2.6-flare';return Response.json(body,{status:response.status});}})};
  eq((await icons('',{requestId:randomUUID()},'dm','OtherAbility0001')).status,503,'An older coordinator cannot charge with the previous prompt or model');eq((await icons('',{requestId:id})).body.job.id,id,'Existing jobs remain recoverable during the rollout');eq(requests.length,0);
 }
 env.ABILITY_GENERATOR=currentBinding;
 eq((await icons('',{requestId:id})).body.job.id,id);eq((await icons()).body.usage,1);
 const secondId=randomUUID();eq((await icons('',{requestId:secondId},'dm','OtherAbility0001')).status,409,'Global paid lock is retained');
 await coordinator.alarm();eq(requests.length,1);eq(requests[0].model,'gpt-image-2.6-sunburst');eq(requests[0].quality,'high');eq(requests[0].n,1);eq(requests[0].size,'1024x1024');ok(requests[0].images[0].image_url.startsWith('data:image/webp;base64,'));
 ok(requests[0].prompt.includes(editAbilityItem.name));ok(!requests[0].prompt.includes('PRIVATE FLAGS'));eq([...storage.values.keys()].some(k=>k.startsWith('usage:text:')),false);
 const firstPrompt=JSON.parse(requests[0].prompt.split('\n').at(-1));eq(firstPrompt.ability.name,editAbilityItem.name);eq(firstPrompt.visualDirection,iconDetails);eq((await icons()).body.jobs[0].details,iconDetails);eq(firstPrompt.otherAbilitiesForContrastOnly.map(row=>row.name),['Resistenza alla Magia']);ok(firstPrompt.otherAbilitiesForContrastOnly[0].description.includes('incantesimi'));ok(requests[0].prompt.includes('A palette change alone is insufficient differentiation'));eq(storage.values.get('job:'+id).iconPromptVersion,ABILITY_ICON_PROMPT_VERSION);
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
 eq(requests[1].quality, 'medium', 'An NPC passive trigger gets a medium-quality icon');
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
 // Native NPC spell icons use the same image-only confirmation contract.
 const spellId='IconSpell0000001';record.snapshot.actor.items.push({...structuredClone(editAbilityItem),_id:spellId,type:'spell',name:'Raggio di Gelo'});await seed(snapshotKey,record);
 eq((await icons()).body.items.find(item=>item.id===spellId).type,'spell');
 const spellJobId=randomUUID();eq((await icons('',{requestId:spellJobId},'dm',spellId)).status,202);await coordinator.alarm();
 const spellConfirmed=await icons(`/${spellJobId}/confirm`,{iconId:spellJobId,icon:payload.icon},'dm',spellId);eq(spellConfirmed.status,202,JSON.stringify(spellConfirmed.body));eq(spellConfirmed.body.command.patches.map(p=>p.path),['img']);
 eq(spellConfirmed.body.command.target,{type:'Item',id:spellId});
 const afterSpell=requests.length;
 const usageKey=`usage:icon:${new Date().toISOString().slice(0,7)}`;
 await storage.put(usageKey,1000000);
 for (const legacyLimit of ['0','1','invalid',undefined]) {
   if (legacyLimit===undefined) delete env.ABILITY_ICON_MONTHLY_LIMIT; else env.ABILITY_ICON_MONTHLY_LIMIT=legacyLimit;
   const unlimitedId=randomUUID();
   eq((await icons('',{requestId:unlimitedId})).status,202,'Historic usage and legacy caps cannot block icons');
   eq((await icons('',{requestId:unlimitedId})).body.job.id,unlimitedId,'Unlimited requests still deduplicate');
   eq((await icons(`/${unlimitedId}/stop`,{attemptId:unlimitedId})).status,200);
 }
 eq((await icons()).body.usage,1000004,'Usage history remains accurate without enforcing a cap');eq(requests.length,afterSpell);
 const upload = (bytes,account='dm') => worker.fetch(new Request('https://worker.test'+base+'/ability-icons/concepts?campaign='+campaign,{
   method:'POST',headers:{Authorization:'Bearer '+token(account),'Content-Type':'image/webp'},body:bytes}),env,{waitUntil(p){p.catch(()=>{});}});
 eq((await upload(image(128),'player')).status,403);
 const refs=[];
 for(const [width,note] of [[128,'Stemma del gelo'],[256,'Il martello del guardiano']]){
   const response=await upload(image(width));eq(response.status,200);
   const {uploadId}=await response.json();
   eq(Buffer.from((await icons('/concepts/'+uploadId)).body),Buffer.from(image(width)));
   eq((await icons('/concepts/'+uploadId,undefined,'admin')).status,404,'References are private even between editors');
   refs.push({uploadId,note});
 }
 eq((await icons()).body.optionalIconReferences,1);
 for(const references of [[...refs,...refs], [refs[0],refs[0]], [{...refs[0],note:'x'.repeat(501)}], [{...refs[0],uploadId:'a'.repeat(64)+'.png'}]]){
   eq((await icons('',{requestId:randomUUID(),references})).status,400);
 }
 eq((await icons('',{requestId:randomUUID(),references:refs},'admin')).status,400);
 eq(requests.length,afterSpell,'Attaching or rejecting images never starts a generation');
 for(const target of [itemId,'OtherAbility0001']){
   const rid=randomUUID(), result=await icons('',{requestId:rid,references:refs,details:'Una sagoma chiara'},'dm',target);
   eq(result.status,202,JSON.stringify(result.body));await coordinator.alarm();
   const edit=requests.at(-1),data=JSON.parse(edit.prompt.split('\n').at(-1));
   eq(edit.images.map(i=>i.image_url),[1024,128,256].map(size=>'data:image/webp;base64,'+Buffer.from(image(size)).toString('base64')));
   eq(data.optionalReferenceImages,[{image:2,note:refs[0].note},{image:3,note:refs[1].note}]);
   eq(data.ability.name,record.snapshot.actor.items.find(it=>it._id===target).name);
   ok(edit.prompt.includes('including none'));eq(data.visualDirection,'Una sagoma chiara');
   eq((await icons('',{requestId:rid,references:[refs[1]]},'dm',target)).body.job.id,rid);
 }
 eq(requests.length,afterSpell+2,'One image call per ability, and no additional selection call');
 eq([...kv],[['untouched','preserved']]);eq(JSON.parse(await new ManagedActorTransaction(env).get(actorKey)),actor);
 // Run real actor-card routes and background alarms against the same D1 archive.
 const cardStorage = new Storage();
 let cardGateDepth = 0;
 const cardStore = new ActorCardStore({storage:cardStorage, async blockConcurrencyWhile(fn) {
   cardGateDepth++;
   try { return await fn(); } finally { cardGateDepth--; }
 }}, env);
 env.ACTOR_CARD_GENERATOR = {idFromName:name=>name, get:()=>cardStore};
 const cardRoute = base + '/card-generation';
 const latestCard = async () => (await call(cardRoute)).body.job;
 const savedActor = async () => JSON.parse(await new ManagedActorTransaction(env).get(actorKey));
 const name = "L’Ègide - L’Ombra";
 await seed(actorKey, {...actor, name});
 const cardBytes = image(1600, 960);
 const cardCalls = [], iconFetch = globalThis.fetch;
 const fetchCardOrIcon = async (url, options) => {
   const body = JSON.parse(options.body);
   if (body.size !== '1600x960') return iconFetch(url, options);
   eq(String(url), 'https://api.openai.com/v1/images/edits');
   cardCalls.push(body);
   return Response.json({data:[{b64_json:Buffer.from(cardBytes).toString('base64')}]});
 };
 globalThis.fetch = fetchCardOrIcon;
 const originalPut = env.MEDIA_BUCKET.put;
 env.MEDIA_BUCKET.put = async (key, bytes) => originalPut(key, bytes instanceof ReadableStream ? await new Response(bytes).arrayBuffer() : bytes);
 eq((await call(cardRoute, {requestId:randomUUID()}, 'player')).status, 403);
 const generateIcon = async batch => {
   const result = await icons('', {requestId:randomUUID(), cardBatchId:batch});
   eq(result.status, 202, JSON.stringify(result.body));
   await coordinator.alarm();
 };
 const batchId = randomUUID();
 await generateIcon(batchId); await generateIcon(batchId);
 eq((await latestCard()).status, 'pending');
 eq((await icons()).body.cardStatus, 'pending');
 await cardStore.alarm(); await cardStore.alarm();
 eq(cardCalls.length, 1); eq((await latestCard()).status, 'accepted');
 const firstCard = (await savedActor()).media.card;
 eq((await icons()).body.cardStatus, 'present');
 eq(Buffer.from(objects.get(firstCard.path.slice(6))), Buffer.from(cardBytes));
 eq([cardCalls[0].model,cardCalls[0].quality,cardCalls[0].size], ['gpt-image-2.6-sunburst','xhigh','1600x960']);
 eq(cardCalls[0].images, [{image_url:'data:image/webp;base64,'+Buffer.from(objects.get(ref)).toString('base64')}]);
 ok(cardCalls[0].prompt.startsWith('Nome dell’NPC: ' + name + '\n\n'));
 ok(cardCalls[0].prompt.includes('l’avatar allegato come riferimento visivo'));
 ok(cardCalls[0].prompt.includes('posa, prospettiva'));
 ok(cardCalls[0].prompt.includes('200 px in basso') && cardCalls[0].prompt.includes('quasi nero sul bordo inferiore'));
 ok(cardCalls[0].prompt.includes('330 px')); ok(!cardCalls[0].prompt.includes(editAbilityItem.name));
 eq((await call('/api/managed-actors')).body.data.find(row=>row.actorId===actorId).media.card.path, firstCard.path);
 await generateIcon(randomUUID()); await cardStore.alarm();
 eq(cardCalls.length, 1, 'Already saved cards skip paid generation');

 const remove = await call(base, {expectedRevision:(await savedActor()).revision, visibility:actor.visibility, media:{card:null}});
 eq(remove.status, 200);
 await generateIcon(randomUUID()); await cardStore.alarm();
 const folder = `managed-actors/${world}/${actorId}/site`, uploadForm = new FormData();
 uploadForm.set('campaignId', campaign); uploadForm.set('folder', folder); uploadForm.set('filename', 'card-manual.webp');
 uploadForm.set('file', new File([cardBytes], 'card-manual.webp', {type:'image/webp'}));
 const uploadResponse = await worker.fetch(new Request('https://worker.test/media/upload?campaign='+campaign, {
   method:'POST', headers:{Authorization:'Bearer '+token('dm')}, body:uploadForm
 }), env);
 eq(uploadResponse.status, 200);
 const manualPath = (await uploadResponse.json()).path;
 eq(manualPath, `media/campaigns/${campaign}/${folder}/card-manual.webp`);
 eq((await call(base, {expectedRevision:(await savedActor()).revision, visibility:actor.visibility, media:{card:{path:manualPath,source:'site',revision:1}}})).status, 200);
 await cardStore.alarm(); eq((await latestCard()).status, 'superseded'); eq((await savedActor()).media.card.path, manualPath);
 await generateIcon(randomUUID()); await cardStore.alarm();
 eq(cardCalls.length, 2, 'Manual uploads take precedence even during automatic generation');

 const playerActor = {...await savedActor(), name:'Iria - La Veggente', actorType:'character', ownerAccountIds:['player']};
 delete playerActor.media.avatar;
 await seed(actorKey, playerActor);
 eq((await call(cardRoute, undefined, 'player')).body.hasAvatar, false);
 eq((await call(cardRoute, {requestId:randomUUID(), avatar:actor.media.avatar}, 'player')).status, 409);
 await cardStore.alarm(); eq(cardCalls.length, 2, 'No image request without a saved avatar');
 const playerRef = `campaigns/${campaign}/managed-actors/${world}/${actorId}/base/player.webp`;
 playerActor.media.avatar = {path:'media/'+playerRef, revision:2};
 await seed(actorKey, playerActor);
 eq((await call(cardRoute, undefined, 'player')).body.hasAvatar, false);
 eq((await call(cardRoute, {requestId:randomUUID()}, 'player')).status, 409, 'A missing R2 object cannot start a card');
 objects.set(playerRef, image(256));
 eq((await call(cardRoute, undefined, 'player')).body.hasAvatar, true);
 const manualId = randomUUID();
 eq((await call(cardRoute, {requestId:manualId, name:'Ignored', avatar:actor.media.avatar, details:'Ignored'}, 'player')).status, 202);
 eq((await call(cardRoute, {requestId:manualId}, 'player')).body.job.id, manualId);
 await cardStore.alarm();
 eq((await latestCard()).status, 'ready'); eq((await savedActor()).media.card.path, manualPath);
 eq(cardCalls[2].prompt, cardCalls[0].prompt.replace(name, playerActor.name), 'The owner gets the same card prompt with the PC’s own name');
 eq(cardCalls[2].images, [{image_url:'data:image/webp;base64,'+Buffer.from(objects.get(playerRef)).toString('base64')}], 'Manual generation sends the saved player avatar');
 eq(Buffer.from((await call(cardRoute+'/'+manualId+'/preview', undefined, 'player')).body), Buffer.from(cardBytes));
 const confirmation = cardRoute+'/'+manualId+'/confirm';
 const queueSave = () => call(confirmation, {background:true}, 'player');
 const applyCard = () => call(confirmation, {}, 'player');
 const saveStatus = async () => (await call(confirmation, undefined, 'player')).body.job.status;
 const receipt = await queueSave();
 eq(receipt.status, 202); eq(receipt.body.job.status, 'applying');
 eq((await savedActor()).media.card.path, manualPath, 'Confirmation acknowledges a durable queue entry before the copy');
 const copyStarted = Promise.withResolvers(), releaseCopy = Promise.withResolvers(), putCard = env.MEDIA_BUCKET.put;
 const copyGateDepths = [];
 env.MEDIA_BUCKET.put = async (...args) => {
   copyGateDepths.push(cardGateDepth);
   if (copyGateDepths.length === 1) throw new Error('Temporary R2 failure');
   copyStarted.resolve();
   await releaseCopy.promise;
   return putCard(...args);
 };
 await cardStore.alarm(); eq(await saveStatus(), 'applying');
 const saving = cardStore.alarm();
 await copyStarted.promise;
 try {
   eq(await saveStatus(), 'applying'); eq((await queueSave()).status, 202);
   eq((await latestCard()).status, 'applying', 'Closing and reopening can observe a slow save');
   eq((await savedActor()).media.card.path, manualPath);
 } finally {
   releaseCopy.resolve(); await saving; env.MEDIA_BUCKET.put = putCard;
 }
 eq(copyGateDepths, [0, 0], 'Both R2 copy attempts run outside the coordinator input gate');
 eq(await saveStatus(), 'accepted');
 const applied = await applyCard(); eq(applied.status, 200); eq((await applyCard()).body.revision, applied.body.revision);
 eq((await savedActor()).media.card.path, applied.body.card.path); eq(cardCalls.length, 3);
 eq((await call(cardRoute, {requestId:randomUUID()}, 'player')).status, 202);
 etag = 'replacement-avatar';
 await cardStore.alarm(); eq((await latestCard()).status, 'failed'); eq(cardCalls.length, 3, 'A replaced avatar cannot start the paid request');
 const staleId = randomUUID();
 eq((await call(cardRoute, {requestId:staleId}, 'player')).status, 202); await cardStore.alarm();
 etag = 'newer-avatar';
 eq((await call(cardRoute+'/'+staleId+'/confirm', {}, 'player')).status, 409);
 eq((await savedActor()).media.card.path, applied.body.card.path);
 const wrongSizeId = randomUUID();
 eq((await call(cardRoute, {requestId:wrongSizeId}, 'player')).status, 202);
 let wrongSizeCalls = 0;
 globalThis.fetch = async () => { wrongSizeCalls++; return Response.json({data:[{b64_json:Buffer.from(image(1024)).toString('base64')}]}); };
 await cardStore.alarm(); await cardStore.alarm();
 eq(wrongSizeCalls, 1); eq((await latestCard()).status, 'failed');
 eq((await savedActor()).media.card.path, applied.body.card.path);

 // A PC owner's ability-icon request must generate a missing card from the same PC as the manual tool.
 globalThis.fetch = fetchCardOrIcon;
 const syncedPlayer = await savedActor();
 delete syncedPlayer.media.card;
 const playerAbility = {itemId:'PlayerAbility001', type:'feat', name:'Presagio', definition:{activities:{foresee:{type:'utility',activation:{type:'reaction'}}}}};
 const playerPassive = {itemId:'PlayerPassive001', type:'feat', name:'Sensi acuti'};
 syncedPlayer.definition = {...syncedPlayer.definition, editor:{version:1}, items:[playerAbility, playerPassive]};
 await seed(actorKey, syncedPlayer);
 const ownerIcons = (body) => icons('', body, 'player', playerAbility.itemId);
 eq((await ownerIcons()).body.items.map(item=>[item.id,item.active]), [[playerAbility.itemId,true],[playerPassive.itemId,false]]);
 const playerBatch = randomUUID(), callsBeforePlayerIcon = cardCalls.length;
 const started = await ownerIcons({requestId:randomUUID(), cardBatchId:playerBatch});
 eq(started.status, 202, JSON.stringify(started.body));
 await coordinator.alarm();
 eq(requests.at(-1).quality, 'high', 'The PC reaction uses high quality');
 eq((await ownerIcons()).body.cardStatus, 'pending');
 await cardStore.alarm(); await cardStore.alarm();
 eq(cardCalls.length, callsBeforePlayerIcon + 1);
 eq(cardCalls.at(-1), cardCalls[2], 'The automatic PC card sends the same name, avatar, size, quality and prompt as the owner’s manual request');
 eq((await ownerIcons()).body.cardStatus, 'present');
 eq((await icons('', {requestId:randomUUID(), cardBatchId:playerBatch}, 'player', playerPassive.itemId)).status, 202);
 await coordinator.alarm();
 eq(requests.at(-1).quality, 'medium', 'The PC passive uses medium quality within the same batch');
 eq((await savedActor()).media.card.path, `media/campaigns/${campaign}/managed-actors/${world}/${actorId}/site/card-ai-${playerBatch}.webp`);
 console.log(`Actor cards and ability icons: ${checks} checks passed, including D1, upload, background generation, manual confirmation and permissions. No paid calls or world data writes.`);
} finally {globalThis.fetch=originalFetch;await runtime.dispose();}
