import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import vm from "node:vm";
import * as model from "../assets/js/shared/npc-native-model.mjs";
import {compileNativeAbilityEdit,nativeAbilityEditChanges,nativeAbilityEditProjection} from "../assets/js/shared/npc-native-ability-edit.mjs";
import {applyNpcNativeEditor} from "../integrations/cripta-wiki-sync/npc-native-editor.mjs";
import {editAbilityItem,itemId,attackId,capabilities} from "./fixtures/npc-native-ability-edit.mjs";
const modulesRoot=process.env.FOUNDRY_DATA_PATH||"C:/Program Files/Foundry DEV TEST/FoundryVTT-WindowsPortable-14.367/Data";
const servicePath=`${modulesRoot}/modules/cripta-wiki-sync/scripts/services/managed-actor-sync.js`;
const {prepareNpcRules}=await import(pathToFileURL(`${modulesRoot}/modules/khuzoe-automations/scripts/npc-rules.mjs`));
const v14=await import(pathToFileURL(`${modulesRoot}/modules/cripta-wiki-sync/scripts/services/foundry-v14.js`));
let checks=0,writes=0,sequence=0,failOrdinary=false,failStrict=false;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;},ok=(a,label)=>{assert.ok(a,label);checks++;};
const clone=structuredClone;
function merge(root,update){for(const [path,value]of Object.entries(update)){const parts=path.split('.');let cursor=root;for(const part of parts.slice(0,-1))cursor=cursor[part]??={};const key=parts.at(-1);if(key.startsWith('-='))delete cursor[key.slice(2)];else if(value&&typeof value==='object'&&!Array.isArray(value))merge(cursor[key]??={},value);else cursor[key]=clone(value);}}
class Collection extends Map{[Symbol.iterator](){return this.values();}}
class Effect{constructor(source,{parent}={}){this.source=clone(source);this.parent=parent;this.id=source._id;}get _source(){return this.source;}toObject(){return clone(this.source);}}
class Activity{constructor(source,{parent,strict}={}){this.source=source;this.parent=parent;this.id=source._id;if(strict&&failStrict)throw new Error("Rejected activity");}get _id(){return this.id;}toObject(){return clone(this.source);}async update(update){writes++;merge(this.source,update);}}
class Item{
 constructor(source,{parent,strict}={}){if(strict&&failStrict)throw new Error('Rejected source');this.source=clone(source);this.parent=parent;this.id=source._id;this.documentName='Item';}
 get flags(){return this.source.flags||{};}get type(){return this.source.type;}get name(){return this.source.name;}get _source(){return this.source;}
 get system(){return{...this.source.system,activities:new Collection(Object.entries(this.source.system.activities||{}).map(([id,data])=>[id,new Activity(data,{parent:this})]))};}
 get effects(){const collection=new Collection((this.source.effects||[]).map(data=>[data._id,new Effect(data,{parent:this})]));collection.documentClass=Effect;return collection;}
 toJSON(){return clone(this.source);}toObject(){return clone(this.source);}
 async update(update){if(failOrdinary&&Object.hasOwn(update,'name')){failOrdinary=false;throw new Error('Ordinary update failed');}writes++;merge(this.source,update);}
 async createEmbeddedDocuments(type,data){assert.equal(type,'ActiveEffect');writes++;for(const effect of data)this.source.effects.push(clone(effect));}
 async updateEmbeddedDocuments(type,data){assert.equal(type,'ActiveEffect');writes++;for(const effect of data){const index=this.source.effects.findIndex(value=>value._id===effect._id);this.source.effects[index]=clone(effect);}}
 async deleteEmbeddedDocuments(type,ids){assert.equal(type,'ActiveEffect');writes++;this.source.effects=this.source.effects.filter(effect=>!ids.includes(effect._id));}
 async createActivity(type,data){writes++;this.source.system.activities[data._id]=clone(data);}
 async deleteActivity(id){writes++;delete this.source.system.activities[id];}
}
const actor={id:'Actor12345678901',type:'npc',isToken:false,prototypeToken:{actorLink:true},items:new Collection(),async updateEmbeddedDocuments(type,data){assert.equal(type,'Item');for(const update of data){const{_id,...changes}=update;await this.items.get(_id).update(changes);}}};
const fresh=()=>{const item=new Item(model.nativeEditorSource(editAbilityItem,'Item'),{parent:actor});actor.items.set(item.id,item);return item;};fresh();
const utils={deepClone:clone,getProperty:model.nativeGet,setProperty:model.nativeSet,randomID:()=>`Generated${String(++sequence).padStart(7,'0')}`};
const game={actors:new Collection([[actor.id,actor]]),modules:new Map([['khuzoe-automations',{api:{npcRules:{version:1,healingTypes:1,prepare:prepareNpcRules}}}]]),i18n:{localize:value=>value}};
globalThis.foundry={utils};globalThis.game=game;
const sandbox={console,structuredClone,Set,Map,WeakSet,URL,crypto,applyNpcNativeEditor,...model,...v14,foundry:{utils},game,CONFIG:{statusEffects:[{id:'prone',name:'Prono',changes:[]}],DND5E:{activityTypes:Object.fromEntries(['attack','save','damage','heal','utility'].map(type=>[type,{documentClass:Activity}]))},ActiveEffect:{documentClass:Effect}},isTemporaryWikiActor:()=>false,MODULE_ID:'cripta-wiki-sync',SETTINGS:{},validateManagedMidiRollConfig:()=>{}};
const source=await readFile(servicePath,'utf8');vm.runInNewContext(source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.apply=applyManagedActorCommand;',sandbox);
const proposal=changes=>({changes,summary:'Modifica del morso',balance:'Danni invariati',assumptions:[],unsupported:[],iconPrompt:'Fauci'});
const set=(path,value)=>({path,op:'set',valueJson:JSON.stringify(value)});
const commandFor=changes=>{const source=actor.items.get(itemId).toJSON(),draft=compileNativeAbilityEdit(proposal(changes),source,capabilities);return{kind:'item.update',nativeEditorVersion:1,foundryActorId:actor.id,target:{type:'Item',id:itemId},nativePermissions:{isAdmin:false,embeddedEffects:true,sharedRuntime:true},patches:nativeAbilityEditChanges(draft,source,capabilities)};};
const apply=command=>sandbox.apply(command);
const rules={version:1,activities:{[attackId]:{healing:1,healingTypes:['necrotic'],conditions:[],rounds:0,expiry:'turnEnd'}}};
let command=commandFor([set('flags.khuzoe-automations.npcRules',rules)]),result=await apply(command);eq(result.status,'applied',result.error);let item=actor.items.get(itemId);eq(item.flags['khuzoe-automations'].npcRules,rules);eq(item.source.system.activities[attackId].damage,editAbilityItem.system.activities[attackId].damage);eq(item.flags.other,editAbilityItem.flags.other);eq(item.flags['khuzoe-automations'].midiRollConfig,editAbilityItem.flags['khuzoe-automations'].midiRollConfig);
let count=writes;eq((await apply(command)).status,'applied');eq(writes,count,'Replaying a completed edit writes nothing');
const effect={_id:'NewEffect0000001',name:'Rallentato',type:'base',disabled:false,transfer:false,statuses:[],duration:{value:2,units:'rounds',expiry:'turnEnd'},system:{changes:[{key:'system.attributes.movement.walk',type:'add',value:'-10',phase:'initial',priority:20}]},flags:{}};
const visible=nativeAbilityEditProjection(item.source);command=commandFor([set('effects',[...visible.effects,effect]),set(`system.activities.${attackId}.effects`,[...visible.system.activities[attackId].effects,{_id:effect._id,onSave:false}])]);result=await apply(command);eq(result.status,'applied',result.error);eq(item.effects.size,2);eq(item.source.system.activities[attackId].effects.at(-1)._id,effect._id);eq(item.source.effects.find(value=>value._id===effect._id).system.changes[0].type,'add');eq(item.source.effects.find(value=>value._id===visible.effects[0]._id).flags.other,editAbilityItem.effects[0].flags.other);
count=writes;eq((await apply(command)).status,'applied');eq(writes,count,'Effects and links are idempotent');
command=commandFor([set(`system.activities.${attackId}.attack.bonus`,'9')]);item.source.system.activities[attackId].attack.bonus='10';count=writes;eq((await apply(command)).status,'conflict');eq(writes,count,'Concurrent edits are detected before writing');fresh();
const nextActivity=model.nativeActivityTemplate('save','Veleno');nextActivity.effects=[];const withCondition={version:1,activities:{[nextActivity._id]:{healing:0,conditions:['prone'],rounds:2,expiry:'turnEnd'}}};
command=commandFor([set(`system.activities.${nextActivity._id}`,nextActivity),set('flags.khuzoe-automations.npcRules',withCondition)]);result=await apply(command);eq(result.status,'applied',result.error);item=actor.items.get(itemId);eq(item.effects.size,2);ok(item.source.system.activities[nextActivity._id].effects.length===1,'Generated condition effect is linked to the new activity');count=writes;result=await apply(command);eq(result.status,'applied',result.error);eq(writes,count,'Generated effects do not cause a false conflict on replay');
const before=clone(item.source);command=commandFor([set(`system.activities.${attackId}.attack.bonus`,'11'),set('name','Morso feroce')]);failOrdinary=true;result=await apply(command);eq(result.status,'failed');eq(item.source,before,'A partial failure restores the touched mechanics and preserves unrelated fields');
command=commandFor([set('name','Morso nuovo')]);count=writes;failStrict=true;result=await apply(command);failStrict=false;eq(result.status,'failed');eq(writes,count,'A detached schema failure performs no writes');
command=commandFor([{path:'flags.khuzoe-automations.npcRules',op:'delete',valueJson:'null'}]);result=await apply(command);eq(result.status,'applied',result.error);eq(item.flags['khuzoe-automations'].npcRules,undefined);eq(item.effects.size,1,'Clearing a preset removes only its generated effect');eq(item.source.system.activities[nextActivity._id].effects,[]);
const aliasSave=model.nativeActivityTemplate('save','Morso necrotico');aliasSave._id='ts-morso';aliasSave.activation={type:'',value:0,override:true};aliasSave.consumption.targets=[];aliasSave.save={ability:['con'],dc:{calculation:'',formula:'18'}};aliasSave.damage={onSave:'none',parts:[{number:2,denomination:8,bonus:'',types:['necrotic'],custom:{enabled:false,formula:''},scaling:{mode:'',number:null,formula:''}}],critical:{allow:false,bonus:''}};aliasSave.effects=[{_id:'afferrato',onSave:false}];
const aliasEffect={_id:'afferrato',name:'Afferrato',type:'base',disabled:false,transfer:false,statuses:['grappled'],system:{changes:[]},duration:{value:null,units:'seconds',expiry:null},flags:{}};
const oldAttack=clone(item.source.system.activities[attackId]),oldEffects=nativeAbilityEditProjection(item.source).effects;
command=commandFor([set('system.activities.ts-morso',aliasSave),set(`system.activities.${attackId}.midiProperties`,{triggeredActivityId:'ts-morso',triggeredActivityTargets:'hitTargets',triggeredActivityRollAs:'self',triggeredActivityConsume:false,triggeredActivityConfigure:false}),set('effects',[...oldEffects,aliasEffect])]);result=await apply(command);eq(result.status,'applied',result.error);
const savedFollow=Object.values(item.source.system.activities).find(value=>value.name==='Morso necrotico'),savedGrapple=item.source.effects.find(value=>value.name==='Afferrato');ok(/^[A-Za-z0-9]{16}$/.test(savedFollow._id));ok(/^[A-Za-z0-9]{16}$/.test(savedGrapple._id));eq(savedFollow.effects[0]._id,savedGrapple._id);eq(savedFollow.damage.onSave,'none');eq(savedFollow.damage.parts[0].denomination,8);eq(savedGrapple.statuses,['grappled']);eq(item.source.system.activities[attackId].damage,oldAttack.damage);count=writes;eq((await apply(command)).status,'applied');eq(writes,count,'Assigned identifiers remain stable on replay');
console.log(`Ability edit Foundry: ${checks} checks passed; installed Wiki Sync adapter, v14 effects, generated conditions, retries, conflicts and rollback. No world data written.`);
export const nativeFoundryHarness={actor,Item,Effect,Collection,sandbox,merge,fresh,get writes(){return writes;},failOrdinary:()=>{failOrdinary=true;},failStrict:value=>{failStrict=value;}};
