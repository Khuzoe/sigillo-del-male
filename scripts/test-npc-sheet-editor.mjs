import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from '../workers/main-worker/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../workers/main-worker/node_modules/miniflare/dist/src/index.js';
import * as model from '../assets/js/shared/npc-native-model.mjs';
import {applyNpcNativeEditor} from '../integrations/cripta-wiki-sync/npc-native-editor.mjs';
import {managedActorStorageRecord} from '../workers/main-worker/src/managed-actor-store.js';

let checks=0;const eq=(a,b,n)=>{assert.deepEqual(a,b,n);checks++;},ok=(a,n)=>{assert.ok(a,n);checks++;};
const clone=structuredClone,campaign='cripta-di-sangue',world='world',id='Actor12345678901',itemId='Item123456789012',activityId='dnd5eactivity000';
const original={_id:id,name:'Custode',type:'npc',ownership:{default:0,gm:3},_stats:{modifiedTime:10},prototypeToken:{actorLink:true},system:{attributes:{hp:{value:20,max:60,temp:0}},unknown:{keep:null},details:{cr:5}},
 flags:{'khuzoe-automations':{midiRollConfig:{version:1,activities:{}}},other:{keep:'unknown'}},
 items:[{_id:itemId,name:'Morso',type:'feat',system:{description:{value:'Testo'},activities:{[activityId]:{_id:activityId,type:'attack',attack:{bonus:'4'},damage:{parts:[{number:2,denomination:6,types:['necrotic'],bonus:''}]},unknown:{keep:7}}}},effects:[],flags:{other:{keep:1}}}],effects:[{_id:'Effect1234567890',name:'Protetto',type:'base',system:{changes:[{key:'system.attributes.ac.bonus',mode:2,value:'1'}]},duration:{value:1,units:'rounds'},disabled:false,statuses:[]}]};
const permissions={isAdmin:false,sharedRuntime:true},target={type:'Actor',id};
const actorData=model.nativeEntityData(original,'Actor',permissions),next=clone(actorData);next.system.attributes.hp.value=40;
const patches=model.nativeDiff(actorData,next,'Actor',permissions);
eq(patches,[{path:'system.attributes.hp.value',op:'set',baseExists:true,baseValue:20,value:40}],'Only changed leaf is sent');
eq(model.nativeApply(original,patches).items,original.items,'Embedded content preserved');
eq(model.nativeValidateChanges(original,target,patches,permissions).flags,original.flags,'Hidden admin flags preserved');
ok(!JSON.stringify(actorData).includes('midiRollConfig'),'DM projection strips admin probabilities');
assert.throws(()=>model.nativeValidateChanges(original,target,[{path:'system.attributes.hp',op:'set',baseExists:true,baseValue:original.system.attributes.hp,value:{value:30,max:60,temp:0}}],{...permissions,sharedRuntime:false}));checks++;
assert.throws(()=>model.nativeValidateChanges(original,target,[{path:'flags.khuzoe-automations',op:'delete',baseExists:true,baseValue:original.flags['khuzoe-automations']}],permissions));checks++;
assert.throws(()=>model.nativeValidateChanges(original,target,[{path:'system',op:'set',baseExists:true,baseValue:original.system,value:{...original.system,source:{bad:true}}}],permissions));checks++;
assert.throws(()=>model.nativeValidateChanges(original,target,[{path:'system.__proto__.polluted',op:'set',baseExists:false,value:true}],permissions));checks++;
ok(model.nativePatchConflict({...original,system:{attributes:{hp:{value:35}}}},patches[0]),'Concurrent HP edit conflicts');
ok(!model.nativePatchConflict(model.nativeApply(original,patches),patches[0]),'Repeated applied command is idempotent');
eq(model.nativeDiff(actorData,clone(actorData),'Actor',permissions),[],'Opening and closing produces no edits');
const freshAbility=model.nativeEntityData(original.items[0],'Item',permissions),abilityWithRule=clone(freshAbility);
abilityWithRule.flags['khuzoe-automations']={npcRules:{version:1,activities:{[activityId]:{healing:0.5,conditions:[],rounds:1,expiry:'turnEnd'}}}};
const freshRulePatches=model.nativeDiff(freshAbility,abilityWithRule,'Item',permissions);
eq(freshRulePatches[0].path,'flags.khuzoe-automations.npcRules','New preset does not replace its protected namespace');
eq(model.nativeValidateChanges(original.items[0],{type:'Item',id:itemId},freshRulePatches,permissions).flags['khuzoe-automations'].npcRules.activities[activityId].healing,0.5);
const newlyCreated={path:`system.activities.NewActivity12345`,op:'set',baseExists:false,value:{_id:'NewActivity12345',type:'utility'}};
ok(model.nativePatchSatisfied({system:{activities:{NewActivity12345:{_id:'NewActivity12345',type:'utility',sort:0}}}},newlyCreated),'Default fields added by Foundry do not break idempotency');
const imported=clone(original.items[0]);imported.system.activities={oldKey:clone(imported.system.activities[activityId])};
eq(Object.keys(model.nativeEntityData(imported,'Item',permissions).system.activities),[activityId],'Old import keys are addressed by stable activity IDs');
imported.system.activities.otherKey=clone(imported.system.activities.oldKey);
ok(model.nativeActivitiesAmbiguous(imported),'Duplicated activity IDs are detected without dropping records');
const importedData=model.nativeEntityData(imported,'Item',permissions),renamed=clone(importedData);renamed.name='Nuovo nome';
eq(model.nativeValidateChanges(imported,{type:'Item',id:itemId},model.nativeDiff(importedData,renamed,'Item',permissions),permissions).system.activities,imported.system.activities,'Unrelated edits preserve ambiguous legacy activities');
const mechanicallyChanged=clone(importedData);mechanicallyChanged.system.activities.oldKey.attack.bonus='6';
assert.throws(()=>model.nativeValidateChanges(imported,{type:'Item',id:itemId},model.nativeDiff(importedData,mechanicallyChanged,'Item',permissions),permissions),/duplicati/);checks++;

if(process.argv[2]) {
 const source=await readFile(process.argv[2],'utf8'),current={[activityId]:clone(original.items[0].system.activities[activityId])};let created=0,removed=0;
 const item={id:itemId,name:'Morso',system:{activities:new Map()},parent:{items:new Map()}};item.parent.items.set(itemId,item);
 const activity=data=>({_source:clone(data),toObject(){return clone(this._source);},async update(changes){for(const[path,value]of Object.entries(changes))model.nativeSet(this._source,path,value);}});
 item.system.activities.set(activityId,activity(current[activityId]));
 item.createActivity=async(type,data,options)=>{eq(options.renderSheet,false,'Activity creation never opens a sheet');created++;item.system.activities.set(data._id,activity({...data,sort:1000}));};
 item.deleteActivity=async id=>{removed++;item.system.activities.delete(id);};
 const sandbox={console,structuredClone,crypto,Set,Map,WeakSet,URL,MODULE_ID:'cripta-wiki-sync',SETTINGS:{},DISCORD_WORKER_URL:'https://test.invalid',game:{scenes:[]},nativeValuePreserved:model.nativeValuePreserved,
  foundry:{utils:{deepClone:clone,getProperty:model.nativeGet,setProperty:model.nativeSet}},CONFIG:{DND5E:{activityTypes:{utility:{documentClass:class{constructor(data,{parent}){assert.equal(parent,item);}}}}}}};
 vm.runInNewContext(source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.activityTest={applyManagedActivitiesUpdate,managedActivityChanges};',sandbox);
 const newActivity=model.nativeActivityTemplate('utility','Nuova utilità'),request={...current,[newActivity._id]:newActivity};
 await sandbox.activityTest.applyManagedActivitiesUpdate(item,current,request);eq(created,1);ok(item.system.activities.has(newActivity._id),'Typed activity creation persists stable ID');
 await sandbox.activityTest.applyManagedActivitiesUpdate(item,request,{[newActivity._id]:newActivity});eq(removed,1);eq(item.system.activities.has(activityId),false,'Typed activity deletion removes only selected activity');
 const invalid={...request,InvalidActivity1:{_id:'InvalidActivity1',type:'missing'}};const beforeCreated=created;
 assert.throws(()=>sandbox.activityTest.managedActivityChanges({[newActivity._id]:newActivity},invalid,item));checks++;eq(created,beforeCreated,'Invalid activity batch is rejected before creating anything');
}

class FakeDocument {
 constructor(source){this.source=clone(source);this.id=source._id;this.type=source.type;this.name=source.name;this.items=new Map((source.items||[]).map(item=>[item._id,new FakeDocument(item)]));this.effects=new Map((source.effects||[]).map(effect=>[effect._id,new FakeDocument(effect)]));this.writes=0;}
 toJSON(){return clone(this.source);}clone(){return new FakeDocument(this.source);}
 async update(update){this.writes++;for(const[path,value]of Object.entries(update)){const parts=path.split('.'),last=parts.at(-1);model.nativeSet(this.source,last.startsWith('-=')?[...parts.slice(0,-1),last.slice(2)].join('.'):path,value,last.startsWith('-='));}}
}
const actor=new FakeDocument(original),services={read:(doc,path)=>model.nativeGet(doc.source,path),applyItem:async command=>{const doc=actor.items.get(command.target.itemId);for(const patch of command.patches)await doc.update({[patch.path]:patch.value});return{status:'applied',actor};}};
const command={nativeEditorVersion:1,target,patches,nativePermissions:permissions};
eq((await applyNpcNativeEditor(actor,command,services)).status,'applied');eq(actor.source.system.attributes.hp.value,40);eq(actor.source.flags,original.flags);
eq((await applyNpcNativeEditor(actor,command,services)).status,'applied');eq(actor.writes,1,'Retry does not write twice');
const stale={...command,patches:[{...patches[0],value:50}]};eq((await applyNpcNativeEditor(actor,stale,services)).status,'conflict');eq(actor.writes,1);
const item=actor.items.get(itemId),itemData=model.nativeEntityData(item.source,'Item',permissions),itemNext=clone(itemData);itemNext.system.activities[activityId].damage.parts[0].number=4;
eq((await applyNpcNativeEditor(actor,{...command,target:{type:'Item',id:itemId},patches:model.nativeDiff(itemData,itemNext,'Item',permissions)},services)).status,'applied');eq(item.source.system.activities[activityId].damage.parts[0].number,4);eq(item.source.system.activities[activityId].unknown,{keep:7});
const effect=actor.effects.get('Effect1234567890'),effectData=model.nativeEntityData(effect.source,'ActiveEffect',permissions),effectNext=clone(effectData);effectNext.system.changes[0].value='2';
eq((await applyNpcNativeEditor(actor,{...command,target:{type:'ActiveEffect',id:effect.id},patches:model.nativeDiff(effectData,effectNext,'ActiveEffect',permissions)},services)).status,'applied');eq(effect.source.system.changes[0].value,'2','v14 effect source uses system.changes');
const refuses=new FakeDocument(original);refuses.update=async()=>{};eq((await applyNpcNativeEditor(refuses,command,services)).status,'failed','Readback detects silent rejection');

const secret='sheet-test',actorKey=`campaign:${campaign}:managed-actor:${world}:${id.toLowerCase()}`,snapshotKey=`campaign:${campaign}:managed-actor-native-snapshot:${world}:${id.toLowerCase()}`;
const parent={campaignId:campaign,worldId:world,actorId:id.toLowerCase(),foundryActorId:id,actorType:'npc',name:'Custode',revision:5,definition:{prototypeToken:{actorLink:true}},ownerAccountIds:['owner'],relationshipType:'companion',visibility:{state:'dm'}};
const token=account=>{const data=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({accountId:account,username:account,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')].join('.');return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../workers/main-worker/src/index.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022'});
const runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',kvNamespaces:['SIGILLO_KV'],d1Databases:['POLL_DB'],bindings:{JWT_SECRET:secret,GLOBAL_ADMIN_ACCOUNT_IDS:'admin',CAMPAIGN_EDITOR_ACCOUNT_IDS:`${campaign}:dm`,MANAGED_ACTOR_D1_CAMPAIGNS:campaign,MANAGED_ACTOR_NATIVE_SNAPSHOT_CAMPAIGNS:campaign,INVENTORY_SYNC_SECRET:secret}});
async function call(account,body,suffix='/editor',targetCampaign=campaign){const r=await runtime.dispatchFetch(`https://test.local/api/managed-actors/${world}/${id.toLowerCase()}${suffix}?campaign=${targetCampaign}`,{headers:{'Content-Type':'application/json',Origin:'https://khuzoe.github.io',...(account?{Authorization:'Bearer '+token(account)}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};}
async function seed(db,key,value){const r=managedActorStorageRecord(key,JSON.stringify(value)),d=r.document;await db.prepare('INSERT INTO managed_actor_documents(campaign_id,document_key,kind,revision,present,payload,chunk_count,updated_at) VALUES(?,?,?,?,1,?,0,?)').bind(d.campaign,key,d.kind,1,d.payload,d.at).run();}
try{
 const db=await runtime.getD1Database('POLL_DB'),kv=await runtime.getKVNamespace('SIGILLO_KV');
 const schema=await readFile(new URL('../workers/main-worker/migrations/0004_managed_actors.sql',import.meta.url),'utf8');await db.batch(schema.replace(/^\s*--.*$/gm,'').split(';').filter(s=>s.trim()).map(s=>db.prepare(s)));
 await db.prepare("INSERT INTO managed_actor_imports(campaign_id,migration_id,state,imported_at,document_count,manifest_sha256) VALUES(?,'test','ready','now',2,'test')").bind(campaign).run();
 await seed(db,actorKey,parent);const snapshot={campaignId:campaign,worldId:world,actorId:id.toLowerCase(),snapshot:{versions:{nativeEditor:1},actor:original},receivedAt:'now'};await seed(db,snapshotKey,snapshot);await kv.put(actorKey,'ORIGINAL KV BYTES');
 for(const account of ['dm','owner','admin']){const r=await call(account);eq(r.status,200,JSON.stringify(r.body));eq(r.body.data.canApply,true);eq(r.body.data.entities.length,3);eq(JSON.stringify(r.body).includes('midiRollConfig'),account==='admin');}
 for(const account of ['','other'])ok([401,403].includes((await call(account)).status),'Unauthorized source access denied');
 eq((await call('dm',undefined,'/editor','mago-folle')).body.code,'NPC_EDITOR_DISABLED');
 const body={version:1,requestId:crypto.randomUUID(),changes:[{target,patches}]};const posted=await call('dm',body);eq(posted.status,202,JSON.stringify(posted.body));eq(posted.body.commands[0].nativeEditorVersion,1);
 const repeated=await call('dm',body);eq(repeated.body.commands[0].id,posted.body.commands[0].id,'HTTP retry keeps same command');
 eq((await call('dm',{...body,requestId:crypto.randomUUID()})).body.code,'NPC_EDITOR_PENDING');
 const itemBody={version:1,requestId:crypto.randomUUID(),changes:[{target:{type:'Item',id:itemId},patches:model.nativeDiff(model.nativeEntityData(original.items[0],'Item',permissions),itemNext,'Item',permissions)}]};eq((await call('owner',itemBody)).status,202,'Companion owner may edit activities');
 eq((await call('other',itemBody)).status,403);
 const before=await db.prepare('SELECT count(*) AS n FROM managed_actor_commands').first();
 eq(before.n,2,'One command per edited entity');
 // Validate a bad second entity before writing any part of a batch.
 const bad={version:1,requestId:crypto.randomUUID(),changes:[{target:{type:'ActiveEffect',id:effect.id},patches:[{path:'disabled',op:'set',baseExists:true,baseValue:false,value:true}]},{target:{type:'ActiveEffect',id:effect.id+'x'},patches:[]}]};eq((await call('dm',bad)).status,400);
 eq((await db.prepare('SELECT count(*) AS n FROM managed_actor_commands').first()).n,before.n,'Invalid batch never partially queues');
 eq(await kv.get(actorKey),'ORIGINAL KV BYTES','KV untouched');eq(await kv.get(snapshotKey),null);
 eq(JSON.parse((await db.prepare('SELECT payload FROM managed_actor_documents WHERE document_key=?').bind(snapshotKey).first()).payload),snapshot,'Editor never replaces the native snapshot');
}finally{await runtime.dispose();}
console.log(`NPC sheet editor: ${checks} checks passed`);
