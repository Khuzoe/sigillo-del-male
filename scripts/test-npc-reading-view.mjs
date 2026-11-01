import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {normalizeNpcReadingSearch,matchesNpcReadingEntry,npcReadingAnchor} from '../assets/js/shared/npc-reading-view.mjs';

let checks=0;const equal=(a,b,n)=>{assert.deepEqual(a,b,n);checks++;},ok=(a,n)=>{assert.ok(a,n);checks++;};
const records=[{key:'bite',title:'Mórso',kind:'capabilities',group:'capabilities:action',preparation:'',search:normalizeNpcReadingSearch('Mórso danni necrotici e cura')},{key:'spell',title:'Invisibilità',kind:'spells',group:'spells:level-2',preparation:'innate',search:normalizeNpcReadingSearch('Invisibilità')},{key:'unprepared',kind:'spells',group:'spells:level-2',preparation:'unprepared',search:'incantesimo'}];
const filter=state=>records.filter(record=>matchesNpcReadingEntry(record,{kind:'all',query:'',group:'',preparedOnly:false,...state})).map(record=>record.key);
equal(filter({query:'morso'}),['bite'],'Search ignores diacritics');equal(filter({query:'NECROTICI'}),['bite'],'Search finds mechanical text');equal(filter({kind:'spells'}),['spell','unprepared']);equal(filter({group:'capabilities:action'}),['bite']);equal(filter({preparedOnly:true}),['bite','spell'],'Prepared filter retains abilities and innate spells');equal(filter({query:'cura',kind:'spells'}),[]);equal(npcReadingAnchor('StableMixedID'),'managed-npc-ability-StableMixedID');equal(decodeURIComponent(npcReadingAnchor('item:1')), 'managed-npc-ability-item:1');
const before=JSON.stringify(records);filter({query:'nessun risultato'});equal(JSON.stringify(records),before,'Filtering never edits source records');
const source=await readFile(new URL('../assets/js/pages/managed-actor.js',import.meta.url),'utf8');
const sandbox={console,structuredClone,URL,URLSearchParams,Set,Map,WeakMap,window:{CriptaApp:{onPageReady(){},utils:{resolveImageUrl:p=>p}}}};
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,`htmlToText=value=>String(value).replace(/<[^>]*>/g,'');globalThis.readApi={renderManagedEntryCard,renderManagedAbilityRules,renderManagedNpcAbilityDescription,hasManagedProfileContent,setActor(value){currentDocument=value;}};})();`),sandbox);
const api=sandbox.readApi;api.setActor({actorType:'npc',definition:{abilities:{str:{mod:4}},attributes:{prof:3}},runtimePolicy:'shared'});
const end='TESTO FINALE DA CONSERVARE',description='Una descrizione piuttosto lunga. '.repeat(25)+end;
const entry={itemId:'Bite123456789012',type:'feat',name:'Morso <antico>',definition:{
 description,
 activities:{attack:{type:'attack',activation:{type:'action',value:1},attack:{type:{value:'melee',classification:'weapon'},ability:'str',bonus:'3'},damage:{includeBase:false,parts:[{number:2,denomination:6,bonus:'',types:['necrotic']}]},effects:[{_id:'generated'},{_id:'custom'}]}},
 effects:[{_id:'generated',name:'Prono generato',statuses:['prone'],flags:{'khuzoe-automations':{npcRule:{condition:'prone'}}}},{_id:'custom',name:'Marchio <oscuro>',statuses:['frightened']}],
 flags:{'khuzoe-automations':{npcRules:{version:1,activities:{attack:{healing:0.5,conditions:['prone'],rounds:2,expiry:'turnEnd'}}}},'midi-qol':{hiddenMacro:'PRIVATE_MACRO_CONTENT'}}
}};
const original=JSON.stringify(entry),html=api.renderManagedEntryCard(entry,false,'action');
ok(html.includes('npc-reader-card'));ok(html.includes(end),'Full description remains visible');ok(!html.includes('Leggi tutto'),'Reading does not collapse long descriptions');ok(html.includes('Morso &lt;antico&gt;'),'Names are escaped');ok(html.includes('Marchio &lt;oscuro&gt;'),'Effect names are escaped');ok(html.includes('metà dei danni effettivamente inflitti'),'Healing mechanic is explained');ok(html.includes('prono'));ok(!html.includes('Prono generato'),'Preset conditions are not duplicated as generated effects');ok(html.includes('2 round'));ok(html.includes('2d6'),'Existing damage computation is retained');ok(!html.includes('PRIVATE_MACRO_CONTENT'));
entry.definition.flags['khuzoe-automations'].midiRollConfig={version:1,activities:{attack:{attackMaxChance:99,damageMaxChance:87}}};
const privateRead=api.renderManagedEntryCard(entry,false,'action');ok(!privateRead.includes('midiRollConfig')&&!privateRead.includes('attackMaxChance')&&!privateRead.includes('damageMaxChance'),'Private probabilities never enter reading markup');
delete entry.definition.flags['khuzoe-automations'].midiRollConfig;equal(JSON.stringify(entry),original,'Reading never modifies the ability');
entry.definition.flags['khuzoe-automations'].npcRules.activities.attack.healing=1;ok(api.renderManagedAbilityRules(entry,true,true).includes('tutti i danni'),'100% healing is readable');
entry.definition.flags['khuzoe-automations'].npcRules.activities.attack.rounds=0;ok(api.renderManagedAbilityRules(entry,true,true).includes('Finché rimosse'));
entry.definition.effects[0].disabled=true;const disabled=api.renderManagedAbilityRules(entry,true,true);ok(disabled.includes('Prono generato')&&disabled.includes('Disattivato'),'Disabled generated effect remains distinguishable');
entry.definition.flags['khuzoe-automations'].npcRules.version=99;ok(!api.renderManagedAbilityRules(entry,true,true).includes('Cura dai danni'),'Unsupported preset versions are not interpreted');
entry.definition.activities.attack.activation={type:'minute',value:1};ok(api.renderManagedAbilityRules(entry,true,true).includes('1 minuto'),'Casting time is human readable');
entry.definition.activities.attack.activation={type:'hour',value:2};ok(api.renderManagedAbilityRules(entry,true,true).includes('2 ore'),'Casting time retains its quantity');
ok(api.renderManagedNpcAbilityDescription(description).includes('Leggi tutto'),'Existing compact editor preview remains supported');
equal(api.hasManagedProfileContent({blocks:[]}),false);equal(api.hasManagedProfileContent({blocks:[{text:'Un dossier'}]}),true,'Dossier remains default only when it contains something');
console.log(`NPC reading view: ${checks} checks passed`);
