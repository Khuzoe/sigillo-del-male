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
const campaign="cripta-di-sangue",world="world",id=nativeAbilityActor._id.toLowerCase(),secret="native-ai-local-test";
const actorKey=`campaign:${campaign}:managed-actor:${world}:${id}`,snapshotKey=`campaign:${campaign}:managed-actor-native-snapshot:${world}:${id}`;
const actor={campaignId:campaign,worldId:world,actorId:id,foundryActorId:nativeAbilityActor._id,name:nativeAbilityActor.name,actorType:"npc",revision:5,visibility:{state:"dm"},prototypeToken:{actorLink:true},definition:{editor:{generatedAbilities:1},attributes:{hp:{value:20,max:90,temp:0}},items:[]},runtime:{hp:{value:20,max:90}}};
const record={campaignId:campaign,worldId:world,actorId:id,snapshot:{actor:structuredClone(nativeAbilityActor),versions:{...structuredClone(nativeAbilityVersions),nativeAbilityEdit:1,npcRulesHealingTypes:1}},receivedAt:"now"};
record.snapshot.actor.items=[structuredClone(editAbilityItem)];
const kv=new Map([[actorKey,"ORIGINAL KV ACTOR"],[`campaign:${campaign}:managed-actor-profile:${world}:${id}`,"ORIGINAL KV DOSSIER"],[`campaign:mago-folle:managed-actor:${world}:${id}`,JSON.stringify({...actor,campaignId:"mago-folle"})],["unrelated-key","ORIGINAL OTHER DATA"]]);
const beforeKV=structuredClone([...kv]),writes=[],objects=new Map(),storage=new Storage();
const runtime=new Miniflare({modules:true,script:"export default {fetch(){return new Response('local test')}}",compatibilityDate:"2026-05-15",d1Databases:["POLL_DB"]});
const originalFetch=globalThis.fetch;let requests=[];
const rule={version:1,activities:{[attackId]:{healing:1,healingTypes:["necrotic"],conditions:[],rounds:0,expiry:"turnEnd"}}};
const proposal={changes:[{path:"flags.khuzoe-automations.npcRules",op:"set",valueJson:JSON.stringify(rule)}],summary:"Cura dai soli danni necrotici",balance:"Danni e attacco invariati",assumptions:[],unsupported:[],iconPrompt:"Fauci necrotiche"};
try{
 const db=await runtime.getD1Database("POLL_DB");
 const schema=await readFile(new URL('../workers/main-worker/migrations/0004_managed_actors.sql',import.meta.url),'utf8');await db.batch(schema.replace(/^\s*--.*$/gm,'').split(';').filter(s=>s.trim()).map(s=>db.prepare(s)));
 await db.prepare("INSERT INTO managed_actor_imports(campaign_id,migration_id,state,imported_at,document_count,manifest_sha256) VALUES(?,'test','ready','now',2,'test')").bind(campaign).run();
 async function seed(key,value){const r=managedActorStorageRecord(key,JSON.stringify(value)),d=r.document;assert.equal(d.chunks,0);await db.prepare('INSERT INTO managed_actor_documents(campaign_id,document_key,kind,revision,present,payload,chunk_count,updated_at) VALUES(?,?,?,?,1,?,0,?) ON CONFLICT(campaign_id,document_key) DO UPDATE SET payload=excluded.payload,revision=managed_actor_documents.revision+1').bind(d.campaign,key,d.kind,1,d.payload,d.at).run();}
 await seed(actorKey,actor);await seed(snapshotKey,record);
 const env={JWT_SECRET:secret,GLOBAL_ADMIN_ACCOUNT_IDS:"admin",CAMPAIGN_EDITOR_ACCOUNT_IDS:`${campaign}:dm`,MANAGED_ACTOR_D1_CAMPAIGNS:campaign,MANAGED_ACTOR_NATIVE_SNAPSHOT_CAMPAIGNS:campaign,POLL_DB:db,OPENAI_API_KEY:"fake-no-paid-calls",INVENTORY_SYNC_SECRET:secret,
  SIGILLO_KV:{async get(key){return kv.get(key)??null;},async put(key,value){writes.push(["put",key]);kv.set(key,value);},async delete(key){writes.push(["delete",key]);kv.delete(key);}},
  MEDIA_BUCKET:{async head(key){return objects.has(key)?{size:objects.get(key).length}:null;},async get(){return null;},async put(key,bytes){objects.set(key,bytes);},async delete(){assert.fail("No media deletions");}}};
 const coordinator=new AbilityGenerationStore({storage},env);env.ABILITY_GENERATOR={idFromName:value=>value,get:()=>({fetch:request=>coordinator.fetch(request)})};
 const token=account=>{const data=[Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString('base64url'),Buffer.from(JSON.stringify({accountId:account,username:account,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')].join('.');return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');};
 async function call(action="",body,account="dm",targetCampaign=campaign,mode="edit",targetItem=itemId){const response=await worker.fetch(new Request(`https://worker.test/api/managed-actors/${world}/${id}/ability-generation${action}?campaign=${targetCampaign}${mode==="edit"?`&editor=npc-native-ability-edit-v1&item=${targetItem}`:mode==="create"?"&editor=npc-native-ability-v1":""}`,{headers:{"Content-Type":"application/json",Authorization:`Bearer ${token(account)}`},...(body===undefined?{}:{method:"POST",body:JSON.stringify(body)})}),env,{waitUntil(promise){promise.catch(()=>{});}});return{status:response.status,body:await response.json()};}
 globalThis.fetch=async(url,options)=>{if(String(url)==="https://api.openai.com/v1/responses"){const input=JSON.parse(options.body);requests.push(input);return Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(proposal)}]}]});}throw new Error(`Unexpected outbound request: ${url}`);};
 eq((await call("",undefined,"player")).status,403,"An ordinary player cannot read a private ability draft");
 eq((await call("",undefined,"admin","mago-folle")).status,409,"Edit opt-in cannot create or edit in another campaign");
 eq((await call("",undefined,"dm",campaign,"edit","bad")).status,400);
 const oldSnapshot=structuredClone(record);delete oldSnapshot.snapshot.versions.nativeAbilityEdit;await seed(snapshotKey,oldSnapshot);
 eq((await call("",{requestId:crypto.randomUUID(),details:"Aggiungi cura",withIcon:false})).status,409,"Old Wiki Sync is rejected before spending");eq(requests.length,0);eq(storage.values.size,0);await seed(snapshotKey,record);
 const binding=env.ABILITY_GENERATOR;env.ABILITY_GENERATOR={idFromName:value=>value,get:()=>({fetch:async()=>Response.json({ok:true,job:null,nativeAbilityEditor:1})})};eq((await call("",{requestId:crypto.randomUUID(),details:"Aggiungi cura",withIcon:false})).status,503,"Old coordinator refuses edits without reserving a paid call");env.ABILITY_GENERATOR=binding;
 env.ABILITY_GENERATOR={idFromName:value=>value,get:()=>({fetch:async()=>Response.json({ok:true,job:{id:crypto.randomUUID(),draft:{name:"Old creation"}},nativeAbilityEditor:1})})};eq((await call()).status,503,"Old coordinator cannot expose a legacy creation as an ability edit");
 env.ABILITY_GENERATOR={idFromName:value=>value,get:()=>({fetch:async()=>Response.json({ok:true,job:{format:"npc-native-ability-v1"},nativeAbilityEditing:1})})};eq((await call()).status,409,"An edit scope cannot adopt a creation draft");env.ABILITY_GENERATOR=binding;
 env.ABILITY_GENERATOR={idFromName:value=>value,get:()=>({fetch:async()=>Response.json({ok:true,job:null,nativeAbilityEditing:1,abilityEditCompiler:1})})};eq((await call("",{requestId:crypto.randomUUID(),details:"Nuovi effetti",withIcon:false})).status,503,"Old compilers cannot spend a new request using the alias contract");env.ABILITY_GENERATOR=binding;
 const jobId=crypto.randomUUID(),request={requestId:jobId,details:"Aggiungi lifesteal sui soli danni necrotici del morso",withIcon:false};
 const starts=await Promise.all([call("",request),call("",request)]);eq(starts.map(r=>r.status).sort(),[200,202]);eq(starts[0].body.job.format,"npc-native-ability-edit-v1");eq(starts[0].body.job.itemId,itemId);eq(starts[0].body.job.channel,"edit");
 await coordinator.alarm();eq(requests.length,1);const sent=requests[0];eq(sent.text.format.name,"npc_ability_edit");eq(sent.text.format.strict,true);eq(sent.store,false);eq(JSON.parse(sent.input).target.id,itemId);eq(JSON.parse(sent.input).monster.versions.system.version,"5.3.3");
 for(const secret of ["PRIVATE ROLL CONFIG","PRIVATE BIOGRAPHY","PRIVATE FLAGS","PRIVATE MACRO","PRIVATE ORIGIN","privateOwner","PRIVATE EFFECT SOURCE","PRIVATE ACTIVITY FLAGS"])ok(!sent.input.includes(secret),secret+" never leaves private storage");
 let state=await call();eq(state.body.job.status,"ready",JSON.stringify(state.body));eq(state.body.job.draft.itemType,"weapon");ok(!JSON.stringify(state.body).includes("PRIVATE"),"The browser never receives raw Item flags or macros");
 eq((await call("",undefined,"dm",campaign,"create")).body.job,null,"Creation and editing have independent drafts");eq((await call("",undefined,"dm",campaign,"legacy")).body.job,null,"Legacy clients cannot see an edit draft");
 eq((await call(`/${jobId}/save`,{draft:state.body.job.draft},"dm",campaign,"legacy")).status,404,"Another channel cannot mutate the edit job");eq((await call(`/${jobId}/save`,{draft:state.body.job.draft},"dm",campaign,"edit","OtherItem0000001")).status,404,"Another Item cannot mutate this draft");
 let draft=structuredClone(state.body.job.draft);draft.item.system.activities[attackId].range.value="15";eq((await call(`/${jobId}/save`,{draft})).status,200);eq(requests.length,1,"Local adjustments do not call the provider");
 const bad=structuredClone(draft);bad.item.flags["khuzoe-automations"].midiRollConfig={version:1,activities:{}};eq((await call(`/${jobId}/save`,{draft:bad})).status,400,"AI drafts cannot modify private dice configuration");
 const stale=structuredClone(record);stale.snapshot.actor.items[0].system.activities[attackId].attack.bonus="10";await seed(snapshotKey,stale);eq((await call(`/${jobId}/confirm`,{draft})).status,409,"A concurrent mechanical edit is never overwritten");eq((await db.prepare('SELECT count(*) AS n FROM managed_actor_commands').first()).n,0);await seed(snapshotKey,record);
 // Spent resource counters can change in combat, without becoming an AI edit.
 const live=structuredClone(record);live.snapshot.actor.items[0].system.uses.spent=2;await seed(snapshotKey,live);
 const confirmed=await call(`/${jobId}/confirm`,{draft});eq(confirmed.status,200,JSON.stringify(confirmed.body));eq(confirmed.body.command.kind,"item.update");eq(confirmed.body.command.nativeEditorVersion,1);eq(confirmed.body.command.target,{type:"Item",id:itemId});
 const command=JSON.parse((await db.prepare('SELECT payload FROM managed_actor_commands').first()).payload);eq(command.target.id,itemId);ok(command.patches.some(p=>p.path==="flags.khuzoe-automations.npcRules"));ok(!command.patches.some(p=>p.path.includes('spent')||p.path.includes('damage')||p.path.includes('attack.bonus')),"Confirmation contains only the intended changes");
 const again=await call(`/${jobId}/confirm`,{draft});eq(again.body.command.id,confirmed.body.command.id);eq((await db.prepare('SELECT count(*) AS n FROM managed_actor_commands').first()).n,1,"Confirmation retries cannot duplicate an update");
 eq((await call("",{requestId:crypto.randomUUID(),details:"Un’altra modifica prima della sincronizzazione",withIcon:false})).status,409,"A queued update blocks a new paid edit before reservation");eq(requests.length,1);
 eq([...kv],beforeKV,"All original KV bytes are preserved");eq(writes,[],"No writes or deletions reach KV");eq(JSON.parse((await db.prepare('SELECT payload FROM managed_actor_documents WHERE document_key=?').bind(snapshotKey).first()).payload),live,"AI never rewrites its archived source");
 // Recovery after queue insertion, before accepted is persisted, is idempotent.
 const prepared=await storage.get(`job:${jobId}`);prepared.status="confirming";delete prepared.command;await storage.put(`job:${jobId}`,prepared);const recovered=await call(`/${jobId}/confirm`,{draft});eq(recovered.body.command.id,confirmed.body.command.id);eq((await db.prepare('SELECT count(*) AS n FROM managed_actor_commands').first()).n,1);
 // An unrelated private configuration inside another effect is retained in D1
 // but redacted from the acknowledgement; it must not hide the whole command.
 await db.prepare("UPDATE managed_actor_commands SET status='applied',payload=json_set(payload,'$.status','applied')").run();
 const withPrivateEffect=structuredClone(record);withPrivateEffect.snapshot.actor.items[0].effects[0].flags['khuzoe-automations']={midiRollConfig:{version:1,activities:{},private:"EFFECT PRIVATE ROLL"}};await seed(snapshotKey,withPrivateEffect);
 const projected=nativeAbilityEditProjection(withPrivateEffect.snapshot.actor.items[0]);
 const effect={_id:"NewEffect0000001",name:"Indebolito",type:"base",disabled:false,transfer:false,statuses:[],duration:{value:1,units:"rounds",expiry:"turnEnd"},system:{changes:[{key:"system.attributes.ac.bonus",type:"add",value:"-1",phase:"initial",priority:20}]},flags:{}};
 proposal.changes=[{path:"effects",op:"set",valueJson:JSON.stringify([...projected.effects,effect])}];
 const effectJob=crypto.randomUUID();eq((await call("",{requestId:effectJob,details:"Aggiungi un effetto di indebolimento",withIcon:false})).status,202);await coordinator.alarm();const effectState=await call();eq(effectState.body.job.status,"ready",JSON.stringify(effectState.body));
 const iconJob=await storage.get(`job:${effectJob}`);iconJob.iconId="saved-icon";await storage.put(`job:${effectJob}`,iconJob);
 const webp=Buffer.alloc(30);webp.write('RIFF');webp.writeUInt32LE(22,4);webp.write('WEBPVP8X',8);webp.writeUInt32LE(10,16);webp.writeUIntLE(511,24,3);webp.writeUIntLE(511,27,3);
 const effectConfirm=await call(`/${effectJob}/confirm`,{draft:effectState.body.job.draft,icon:webp.toString('base64')});eq(effectConfirm.status,200,JSON.stringify(effectConfirm.body));ok(effectConfirm.body.command?.id,"The redacted acknowledgement still identifies the queued update");ok(!JSON.stringify(effectConfirm.body).includes('midiRollConfig'));ok(!JSON.stringify(effectConfirm.body).includes('EFFECT PRIVATE ROLL'));
 ok(effectConfirm.body.command.patches.find(p=>p.path==='img').value.startsWith('https://worker.test/media/campaigns/'),"Foundry receives an absolute URL for the optional generated icon");
 const storedEffects=JSON.parse((await db.prepare("SELECT payload FROM managed_actor_commands WHERE status='pending'").first()).payload).patches.find(p=>p.path==='effects').value;eq(storedEffects.find(e=>e._id===projected.effects[0]._id).flags['khuzoe-automations'].midiRollConfig.private,"EFFECT PRIVATE ROLL");eq([...kv],beforeKV);eq(writes,[]);
 await db.prepare("UPDATE managed_actor_commands SET status='applied',payload=json_set(payload,'$.status','applied')").run();
 proposal.changes=[{path:'effects',op:'set',valueJson:JSON.stringify([{_id:'bad-effect',name:'Afferrato',flags:{macro:{command:'REJECTED PRIVATE CANDIDATE'}}}])}];
 const rejectedId=crypto.randomUUID();eq((await call('',{requestId:rejectedId,details:'Effetto non valido simulato',withIcon:false})).status,202);await coordinator.alarm();
 const rejected=await storage.get(`job:${rejectedId}`),publicRejected=await call();eq(publicRejected.body.job.status,'uncertain');ok(rejected.rejectedProposal,'The rejected candidate is retained privately');ok(!JSON.stringify(publicRejected.body).includes('REJECTED PRIVATE CANDIDATE'));ok(!JSON.stringify(publicRejected.body).includes('rejectedProposal'));
 rejected.rejectedProposal={...proposal,changes:[{path:'effects',op:'set',valueJson:JSON.stringify([...projected.effects,{_id:'new-grapple',name:'Afferrato',type:'base',statuses:['grappled'],system:{changes:[]},duration:{value:null,units:'seconds',expiry:null}}])}]};
 rejected.rejectedCompilerVersion=1;await storage.put(`job:${rejectedId}`,rejected);const paidBefore=requests.length,usageBefore=[...storage.values].filter(([key])=>key.startsWith('usage:'));
 const recoveredDraft=await call();eq(recoveredDraft.body.job.status,'ready',JSON.stringify(recoveredDraft.body));eq(recoveredDraft.body.job.id,rejectedId);ok(recoveredDraft.body.job.recoveredAt);ok(recoveredDraft.body.job.draft.item.effects.every(effect=>/^[A-Za-z0-9]{16}$/.test(effect._id)));eq(requests.length,paidBefore,'A corrected compiler recovers a cached candidate without calling AI');eq([...storage.values].filter(([key])=>key.startsWith('usage:')),usageBefore,'Recovery reserves no extra quota');eq((await storage.get(`job:${rejectedId}`)).rejectedProposal,undefined);eq([...kv],beforeKV);eq(writes,[]);
 console.log(`Ability edit Worker: ${checks} checks passed; real routes, D1 queue, scopes, privacy, capability checks, conflicts, idempotence and unchanged KV. No paid calls.`);
}finally{globalThis.fetch=originalFetch;await runtime.dispose();}
