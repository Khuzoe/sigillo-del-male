import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {pathToFileURL} from "node:url";
import {compileNativeAbilityProposal,validateNativeAbilityDraft,validateNativeAbilityItem,nativeAbilitySummary} from "../assets/js/shared/npc-native-ability.mjs";
import {nativeAbilityContext,nativeAbilityFingerprint} from "../workers/main-worker/src/npc-native-ability-context.js";
import {createVerifiedNpcAbility} from "../integrations/cripta-wiki-sync/npc-native-ability-create.mjs";
import {nativeAbilityProposal as proposal,nativeAbilityActor,nativeAbilityVersions} from "./fixtures/npc-native-ability.mjs";

let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(a,message)=>{assert.ok(a,message);checks++;},refuses=(fn,message)=>{assert.throws(fn,message);checks++;};
const draft=compileNativeAbilityProposal(proposal),[attack,save]=Object.values(draft.item.system.activities),original=JSON.stringify(proposal);
eq(attack.midiProperties.triggeredActivityId,save._id);eq(save.activation.type,"");eq(save.consumption.targets,[]);eq(save.damage.critical.allow,false);eq(draft.item.flags["khuzoe-automations"].npcRules.activities[save._id].healing,1);ok(!draft.item.flags["khuzoe-automations"].npcRules.activities[attack._id]);
eq(JSON.stringify(proposal),original,"Compilation does not edit the request");ok(nativeAbilitySummary(draft).join(" ").includes("100%"));
eq(attack.damage.parts[0].number,2);eq(attack.damage.parts[0].denomination,8);eq(attack.damage.parts[0].bonus,"5");eq(attack.damage.parts[0].custom.enabled,false,"Simple dice use native fields shown by the editor");ok(nativeAbilitySummary(draft).join(" ").includes("Prono"));ok(nativeAbilitySummary(draft).join(" ").includes("necrotici"));
const fixed=structuredClone(proposal);fixed.activities[0].damage[0].formula="12";eq(Object.values(compileNativeAbilityProposal(fixed).item.system.activities)[0].damage.parts[0].custom.formula,"12");
const spell=structuredClone(proposal);spell.activities=[{...spell.activities[0],next:"",attack:{...spell.activities[0].attack,classification:"spell"}}];eq(Object.values(compileNativeAbilityProposal(spell).item.system.activities)[0].attack.type.classification,"spell");
const healing=structuredClone(spell);Object.assign(healing.activities[0],{type:"heal",damage:[],healing:{formula:"3d8+5",type:"healing"}});eq(Object.values(compileNativeAbilityProposal(healing).item.system.activities)[0].healing.number,3);
const utility=structuredClone(spell);Object.assign(utility.activities[0],{type:"utility",damage:[],rules:{healing:0,conditions:["invisible"],rounds:0,expiry:"turnEnd"}});eq(compileNativeAbilityProposal(utility).item.flags["khuzoe-automations"].npcRules.activities[attack._id].rounds,0);
const area=structuredClone(spell);Object.assign(area.activities[0],{type:"save",target:{count:10,type:"creature",area:"cone",size:30},save:{ability:"dex",dc:16,onSave:"half"}});eq(Object.values(compileNativeAbilityProposal(area).item.system.activities)[0].target.template.size,"30");
for(const mutate of [d=>d.macro="evil",d=>d.activities[1].save.dc=0,d=>d.activities[0].next="missing",d=>d.activities[1].key="bite",d=>d.activities[0].damage[0].formula="game.actors.clear()",d=>d.activities[1].rules.healing=2,d=>d.activities[1].rules.conditions=["made-up"]]){const invalid=structuredClone(proposal);mutate(invalid);refuses(()=>compileNativeAbilityProposal(invalid));}
for(const mutate of [d=>d.item.flags["midi-qol"]={macro:"evil"},d=>d.item.flags["khuzoe-automations"].midiRollConfig={},d=>d.item.system.activities[attack._id].macroData={command:"evil"},d=>Object.assign(d.item.system.activities[attack._id].damage.parts[0].custom,{enabled:true,formula:"1d6 + game.user.id"}),d=>d.item.system.activities[save._id].activation.type="action",d=>d.item.system.description.value='<img src=x onerror="evil()">',d=>d.item.effects.push({name:"arbitrary"}),d=>d.item.ownership={default:3}]){const invalid=structuredClone(draft);mutate(invalid);refuses(()=>validateNativeAbilityDraft(invalid));}
const unsupported=structuredClone(draft);unsupported.unsupported=["Evocazione di un Actor"];eq(validateNativeAbilityDraft(unsupported).unsupported.length,1,"Unsupported requests remain editable but confirmation must block them");
const record={snapshot:{actor:structuredClone(nativeAbilityActor),versions:structuredClone(nativeAbilityVersions)}},light={definition:{attributes:{hp:{value:20,max:90,temp:0},prof:3}}};
const context=nativeAbilityContext(record,light),sent=JSON.stringify(context);for(const value of ["PRIVATE BIOGRAPHY","PRIVATE FLAGS","PRIVATE ROLL CONFIG","PRIVATE MACRO","PRIVATE ORIGIN","privateOwner","unrelated-private-module","midiRollConfig"])ok(!sent.includes(value),`${value} never enters AI context`);
eq(context.versions.foundry.version,"14.367");eq(context.versions.system.version,"5.3.3");eq(context.actor.items[0].description,"Due attacchi.","Mechanical descriptions are retained");eq(context.actor.effects[0].changes.length,1);const fp=await nativeAbilityFingerprint(record,light);record.snapshot.actor.system.attributes.hp.value=1;light.definition.attributes.hp.value=1;eq(await nativeAbilityFingerprint(record,light),fp,"Current HP cannot invalidate a mechanical proposal");record.snapshot.actor.system.details.cr=8;ok(await nativeAbilityFingerprint(record,light)!==fp,"Balance context detects changed CR");record.snapshot.actor.system.details.cr=7;
const tooLarge=structuredClone(record);tooLarge.snapshot.actor.items[0].system.description.value="x".repeat(81000);refuses(()=>nativeAbilityContext(tooLarge,light),/troppo estesa/);

const dataRoot=process.env.FOUNDRY_DATA_PATH||"C:/Program Files/Foundry DEV TEST/FoundryVTT-WindowsPortable-14.367/Data";
const {prepareNpcRules}=await import(pathToFileURL(`${dataRoot}/modules/khuzoe-automations/scripts/npc-rules.mjs`));
globalThis.foundry={utils:{randomID:()=>"EffectNew1234567"}};
let refuseSchema=false,loseReadback=false,creates=0;const deleted=[];
class Item {constructor(data,{strict}={}){if(refuseSchema&&strict)throw new Error("Schema refuses");this.source=structuredClone(data);this.id=data._id;}toJSON(){return structuredClone(this.source);}}
class Collection extends Map{[Symbol.iterator](){return this.values();}}
globalThis.CONFIG={Item:{documentClass:Item}};
const source=await readFile(`${dataRoot}/modules/cripta-wiki-sync/scripts/services/managed-actor-sync.js`,"utf8"),fn=source.slice(source.indexOf("async function applyManagedItemCreate("),source.indexOf("async function applyManagedItemDelete("));
const modules=new Map([["khuzoe-automations",{api:{npcRules:{version:1,prepare:prepareNpcRules}}}],["midi-qol",{active:true}]]);
const sandbox={structuredClone,crypto,MODULE_ID:"cripta-wiki-sync",getCampaignId:()=>"cripta-di-sangue",validateNativeAbilityItem,createVerifiedNpcAbility,CONFIG:{statusEffects:[{id:"prone",name:"Prono",img:"icons/svg/falling.svg"}]},game:{items:[],modules},foundry:{utils:{deepClone:structuredClone,mergeObject:(a,b)=>({...a,...b})}},getItemTransferId:item=>item.source.flags["cripta-wiki-sync"].transferId,sanitizeId:value=>value,toWorkerMediaUrl:path=>path};
vm.runInNewContext(fn+"globalThis.applyCreate=applyManagedItemCreate;",sandbox);
const actor={type:"npc",isToken:false,items:new Collection(),system:{hp:90},async createEmbeddedDocuments(_type,data){creates++;const item=new Item({...data[0],_id:`CreatedItem${String(creates).padStart(5,"0")}`});if(loseReadback)item.source.system.activities[attack._id].attack.bonus="0";this.items.set(item.id,item);return[item];},async deleteEmbeddedDocuments(_type,ids){for(const id of ids){deleted.push(id);this.items.delete(id);}}};
const before=new Item({_id:"UntouchedItem123",name:"Da conservare",flags:{"cripta-wiki-sync":{transferId:"existing"}},system:{keep:true}});actor.items.set(before.id,before);
const command={nativeAbilityVersion:1,campaignId:"cripta-di-sangue",target:{transferId:"ai-native-test"},document:{...draft.item,transferId:"ai-native-test",img:""}};
eq((await sandbox.applyCreate(actor,command)).status,"applied");eq(creates,1);eq((await sandbox.applyCreate(actor,command)).status,"applied");eq(creates,1,"Retry never creates a duplicate");eq(actor.items.get("CreatedItem00001").source.effects[0].statuses,["prone"]);
actor.items.get("CreatedItem00001").source.name="Modifica successiva";eq((await sandbox.applyCreate(actor,command)).status,"conflict");eq(creates,1);
const next={...command,target:{transferId:"ai-native-failure"}};refuseSchema=true;eq((await sandbox.applyCreate(actor,next)).status,"failed");eq(creates,1,"Reject before any creation");refuseSchema=false;loseReadback=true;
eq((await sandbox.applyCreate(actor,next)).status,"failed");eq(deleted,["CreatedItem00002"],"Only the failed new Item is removed");eq(actor.items.get(before.id).toJSON(),before.toJSON());eq(actor.system,{hp:90},"Actor statistics stay unchanged");
eq((await sandbox.applyCreate(actor,{...command,campaignId:"mago-folle"})).status,"failed");eq(creates,2,"Native commands cannot run in another campaign");
const installed=await readFile(`${dataRoot}/modules/cripta-wiki-sync/scripts/services/npc-native-ability.mjs`,"utf8");ok(installed===await readFile(new URL('../assets/js/shared/npc-native-ability.mjs',import.meta.url),'utf8'),"Installed validator is shared with the site and Worker");
console.log(`Native AI ability: ${checks} checks passed; schemas, native context privacy, attack/save/heal/area, installed Wiki Sync, rollback and idempotence; no world data or paid calls.`);
