import assert from 'node:assert/strict';
import {npcSheetAiSource,compileNpcSheetProposal,npcSheetCommandPlan,validateNpcSheetReview,rebaseNpcSheetDraft,npcSheetAutomationWarnings,NPC_SHEET_AI_SCHEMA,NPC_SHEET_AI_COMPILER} from '../assets/js/shared/npc-sheet-ai-model.mjs';
import {nativeActivityTemplate,nativeApply} from '../assets/js/shared/npc-native-model.mjs';
import {nativeUndoPatches} from '../integrations/cripta-wiki-sync/npc-native-undo.mjs';
import {AbilityGenerationStore} from '../workers/main-worker/src/ability-generation.js';
import {editAbilityItem,itemId,capabilities} from './fixtures/npc-native-ability-edit.mjs';
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;},no=(fn,pattern)=>{assert.throws(fn,pattern);checks++;};
const clone=structuredClone,raw={_id:'Actor12345678901',type:'npc',name:'Audit',prototypeToken:{actorLink:true},system:{attributes:{hp:{value:20,max:60}},details:{alignment:'neutral evil',cr:10}},flags:{},items:[clone(editAbilityItem)],effects:[]};
const options={mode:'general',sharedRuntime:true,capabilities},source=npcSheetAiSource(raw,options);
const set=(path,value)=>({path,op:'set',valueJson:JSON.stringify(value)}),typed=(path,value)=>({path,op:'set',value,valueJson:''}),op=(type,id,changes,extra={})=>({targetType:type,targetId:id,parentItemId:'',operation:'update',itemType:'',name:'',changes,...extra}),proposal=operations=>({summary:'Audit',balance:'',assumptions:[],unsupported:[],operations});
let draft=compileNpcSheetProposal(proposal([op('Actor',raw._id,[{path:'system.details.alignment',op:'set',valueJson:'neutrale malvagio'}])]),source,options);
eq(draft.actor.system.details.alignment,'neutrale malvagio','The exact reported legacy failure is recovered locally');
draft=compileNpcSheetProposal(proposal([op('Actor',raw._id,[typed('system.details.alignment','neutrale malvagio'),typed('system.attributes.hp.max',80)])]),source,options);
eq(draft.actor.system.attributes.hp.max,80);eq(draft.actor.system.details.alignment,'neutrale malvagio');
ok(NPC_SHEET_AI_SCHEMA.properties.operations.items.properties.changes.items.required.includes('value'),'New structured output guarantees typed scalars');
{
 const change=(path,value)=>({path,op:'set',value});
 const fields=record=>({entries:Object.entries(record).map(([key,value])=>({key,value}))});
 const rawText='Serraggio (Ricarica 5–6). Fino a due creature Grandi o più piccole visibili entro 10 ft: TS Destrezza CD 19, 18 (4d8) danni contundenti, metà con un successo. Chi fallisce è afferrato; liberarsi CD 19. Una creatura per mano. Può muoversi, rilasciare senza azione e usare azioni consentite senza mani libere.';
 const parts=[fields({number:4,denomination:8,types:['bludgeoning']})];
 const grip=op('Item','serraggio',[
  change('system.description.value',rawText),change('system.uses.max','1'),
  change('system.uses.recovery',[fields({period:'recharge',formula:'5'})]),change('system.activities.presa.type','save'),
  change('system.activities.presa.save',fields({ability:['dex'],dc:fields({calculation:'',formula:'19'})})),
  change('system.activities.presa.damage',fields({onSave:'half',parts})),
  change('system.activities.presa.range',fields({value:'10',units:'ft',override:true})),
  change('system.activities.presa.target.affects.count','2'),
  change('system.activities.presa.consumption.targets',[fields({type:'itemUses',target:'',value:'1'})])
 ],{operation:'create',itemType:'feat',name:'Serraggio'});
 const draft=compileNpcSheetProposal(proposal([grip]),source,options),doc=npcSheetCommandPlan(draft,source,raw,options)[0].document;
 const [saved]=Object.values(doc.system.activities);
 eq(saved.save,{ability:['dex'],dc:{calculation:'',formula:'19'}});eq(saved.damage,{onSave:'half',parts:[{number:4,denomination:8,types:['bludgeoning']}]});
 eq(saved.range.value,'10');eq(saved.target.affects.count,'2');eq(doc.system.description.value,rawText);
 eq(doc.system.uses.recovery,[{period:'recharge',formula:'5'}]);eq(saved.consumption.targets,[{type:'itemUses',target:'',value:'1'}]);
 const legacy=valueJson=>op('Item','serraggio',[{path:'system.activities',op:'set',valueJson}],{operation:'create',itemType:'feat',name:'Serraggio'});
 const rawActivities={presa:{_id:'presa',type:'save',name:'Prova ,} con "virgolette"',save:saved.save,damage:saved.damage}};
 const json=JSON.stringify(rawActivities);
 for(const wrapped of ['```json\n'+json+'\n```',json.slice(0,-1)+',}',JSON.stringify(json)]){
  const repaired=compileNpcSheetProposal(proposal([legacy(wrapped)]),source,options);const [actual]=Object.values(repaired.createdItems[0].data.system.activities);eq(actual.name,rawActivities.presa.name);eq(actual.damage,saved.damage);
 }
 const legacyArray=compileNpcSheetProposal(proposal([legacy(JSON.stringify(Object.values(rawActivities)))]),source,options);
 eq(Object.values(legacyArray.createdItems[0].data.system.activities)[0].damage,saved.damage);
 for(const bad of [json.slice(0,-2),'{,}','{broken'])no(()=>compileNpcSheetProposal(proposal([legacy(bad)]),source,options),/Serraggio.*system.activities.*JSON/);
 for(const key of ['constructor','__proto__'])no(()=>compileNpcSheetProposal(proposal([{...grip,changes:[change('system.activities',{entries:[{key,value:1}]})]}]),source,options),/campo duplicato o non valido/);
 no(()=>compileNpcSheetProposal(proposal([{...grip,changes:[change('system.activities',{entries:[{key:'presa',value:null},{key:'presa',value:5}]})]}]),source,options),/duplicato/);
 eq(Object.hasOwn(NPC_SHEET_AI_SCHEMA.properties.operations.items.properties.changes.items.properties,'valueJson'),false);
}
no(()=>compileNpcSheetProposal(proposal([op('Actor',raw._id,[typed('system.attributes.hp.max',-1)])]),source,options),/hp.max/);
no(()=>compileNpcSheetProposal(proposal([op('Actor',raw._id,[typed('system.details.cr','impossibile')])]),source,options),/details.cr/);
const rangedRaw=clone(raw);rangedRaw.system.attributes.movement={walk:'30',units:'ft'};rangedRaw.system.traits={languages:{value:[],custom:'',communication:{}}};const rangedSource=npcSheetAiSource(rangedRaw,options);
const rangedDraft=compileNpcSheetProposal(proposal([op('Actor',raw._id,[typed('system.traits.languages.communication.telepathy',120)])]),rangedSource,options);
{
 const attack=nativeActivityTemplate('attack','Pugno'),part={number:2,denomination:8,bonus:'4',types:['bludgeoning']};
 const damage={base:'2d8 + 4',types:['bludgeoning']};
 const item=(type,changes)=>op('Item','pugno',changes,{operation:'create',itemType:type,name:'Pugno di basalto'});
 const make=(type,changes,review=false)=>compileNpcSheetProposal(proposal([item(type,changes)]),source,options,review);
 const plan=draft=>npcSheetCommandPlan(draft,source,raw,options)[0].document;
 for(const type of ['weapon','consumable']){
  const changes=[set('system.damage',damage)],doc=plan(make(type,changes));
  eq(doc.system.damage,{base:part});eq(changes[0].valueJson,JSON.stringify(damage));
 }
 const featChanges=[set('system.activities.pugno',attack),set('system.damage',damage)];
 const feat=make('feat',featChanges),doc=plan(feat),activity=Object.values(doc.system.activities)[0];
 eq(activity.damage.parts,[part]);eq(doc.system.damage,undefined);eq(activity.damage.includeBase,false);
 const legacy=clone(feat);legacy.createdItems[0].data.system.damage=clone(damage);
 eq(rebaseNpcSheetDraft(legacy,source,raw,options).draft.createdItems,feat.createdItems,'Reopening a saved duplicate keeps a single roll');
 const spell=make('spell',[set('system.activities.pugno',attack),set('system.damage',{base:'1d6 + 2d4 + @mod',types:['force']})]);
 eq(Object.values(plan(spell).system.activities)[0].damage.parts,[{custom:{enabled:true,formula:'1d6 + 2d4 + @mod'},types:['force']}]);
 const second=nativeActivityTemplate('save','Secondo tiro');
 const ambiguous=[...featChanges,set('system.activities.secondo',second)];
 no(()=>make('feat',ambiguous),/Pugno di basalto.*system.damage.base/);
 const fixable=make('feat',ambiguous,true),reopened=rebaseNpcSheetDraft(fixable,source,raw,options).draft;
 eq(reopened.createdItems[0].data.system.damage,damage);
 no(()=>plan(reopened),/system.damage.base/);
 const corrected=reopened.createdItems[0].data.system;
 delete corrected.damage;Object.values(corrected.activities).find(a=>a.type==='attack').damage.parts=[part];
 eq(Object.values(plan(reopened).system.activities).find(a=>a.type==='attack').damage.parts,[part]);
 no(()=>make('weapon',[set('system.damage',{base:part,types:['fire']})]),/base.types/);
 no(()=>make('feat',[set('system.activities.pugno',{...attack,damage:{parts:[{...part,bonus:'7'}]}}),set('system.damage',damage)]),/duplicato/);
 for(const [type,path,value] of [['loot','system.activities',{pugno:attack}],['container','system.uses.max','2'],['feat','system.range',{value:30}],['equipment','system.level',3]]){
  no(()=>make(type,[set(path,value)]),/campo non disponibile/);
 }
 for(const [activityType,field,value] of [['save','damage.includeBase',true],['heal','damage',{parts:[part]}],['attack','damage.onSave','half']]){
  const activity=nativeActivityTemplate(activityType);const [parent,key]=field.split('.');
  if(key)activity[parent][key]=value;else activity[parent]=value;
  no(()=>make('feat',[set('system.activities.test',activity)]),/campo (assente|non disponibile)/);
 }
 const historical=clone(raw);historical.items[0].system.damage={base:'dato storico',types:['piercing']};
 const oldSource=npcSheetAiSource(historical,options),rename=compileNpcSheetProposal(proposal([op('Item',itemId,[set('name','Solo nome')])]),oldSource,options);
 eq(npcSheetCommandPlan(rename,oldSource,historical,options)[0].patches.map(p=>p.path),['name'],'An unrelated edit leaves existing non-standard fields in place');
}
{
 const attack=nativeActivityTemplate('attack','Lancio');attack._id='lancio';
 attack.range={value:'30',long:'120',units:'ft',override:true};
 const create=(type,extras=[])=>op('Item','javelin',[set('system.activities.lancio',attack),...extras],{operation:'create',itemType:type,name:'Giavellotto'});
 const weapon=compileNpcSheetProposal(proposal([create('weapon',[set('system.properties',['thr']),set('system.range.reach',5)])]),source,options);
 const document=npcSheetCommandPlan(weapon,source,raw,options)[0].document;
 eq(document.system.range,{value:30,long:120,reach:5,units:'ft'});
 const [activity]=Object.values(document.system.activities);
 eq(activity.range,{value:'30',units:'ft',override:false});
 const legacy=clone(weapon),item=legacy.createdItems[0].data;
 item.system.range={reach:5};item.system.activities[activity._id].range=clone(attack.range);
 eq(rebaseNpcSheetDraft(legacy,source,raw,options).draft.createdItems,weapon.createdItems,'Reopening the rejected javelin repairs the existing draft');
 const feat=compileNpcSheetProposal(proposal([create('feat')]),source,options);
 const featDoc=npcSheetCommandPlan(feat,source,raw,options)[0].document;
 eq(Object.values(featDoc.system.activities)[0].range,{value:'30',units:'ft',override:true,special:'Gittata lunga: 120 ft'});
 attack.range.special='Solo in acqua';
 const other=nativeActivityTemplate('attack','Altro tiro');other._id='altro';other.range={override:false};
 const conflict=compileNpcSheetProposal(proposal([create('weapon',[set('system.activities.altro',other),set('system.range',{value:80,long:320,units:'ft'})])]),source,options);
 const distinct=npcSheetCommandPlan(conflict,source,raw,options)[0].document;
 eq(distinct.system.range,{value:80,long:320,units:'ft'});
 eq(Object.values(distinct.system.activities).find(a=>a.name==='Lancio').range.special,'Solo in acqua · Gittata lunga: 120 ft');
 eq(Object.values(distinct.system.activities).find(a=>a.name==='Altro tiro').range,{override:false});
}
eq(rangedDraft.actor.system.traits.languages.communication.telepathy,{value:120,units:'ft'},'The reported numeric range is converted using the archived distance unit');
const oldRanged=clone(rangedDraft);oldRanged.actor.system.traits.languages.communication.telepathy=120;
eq(validateNpcSheetReview(oldRanged,raw._id,options).actor.system.traits.languages.communication.telepathy,{value:120,units:'ft'},'Existing proposals are repaired without another AI request');
eq(rebaseNpcSheetDraft(oldRanged,rangedSource,rangedRaw,options).draft.actor.system.traits.languages.communication.telepathy,{value:120,units:'ft'},'Failed accepted proposals can be reopened and repaired for free');
no(()=>compileNpcSheetProposal(proposal([op('Actor',raw._id,[typed('system.traits.languages.communication.telepathy',-1)])]),rangedSource,options),/communication.telepathy.value/);
no(()=>compileNpcSheetProposal(proposal([op('Actor',raw._id,[typed('system.traits.languages.communication.telepathy','120')])]),rangedSource,options),/distanza e unità/);
no(()=>compileNpcSheetProposal(proposal([op('Actor',raw._id,[typed('system.traits.languages.communication.telepathy',120)])]),source,options),/distanza e unità/);
no(()=>compileNpcSheetProposal(proposal([op('Item',itemId,[{path:'system.activities',op:'set',valueJson:'{broken'}])]),source,options),/system.activities.*JSON/);
no(()=>compileNpcSheetProposal(proposal([op('Item',itemId,[typed('system.description.value','<script>evil()</script>')])]),source,options),/senza codice/);
const translated=compileNpcSheetProposal(proposal([op('Actor',raw._id,[typed('system.details.alignment','neutrale malvagio')])]),source,{...options,mode:'translate'});eq(translated.actor.system.details.alignment,'neutrale malvagio');
const english=clone(raw);english.items[0].system.description.value='<p>DC 18. Range 30 feet.</p>';const englishSource=npcSheetAiSource(english,options);
no(()=>compileNpcSheetProposal(proposal([op('Item',itemId,[set('system.description.value','<p>CD 30. Portata 18 piedi.</p>')])]),englishSource,{...options,mode:'translate'}),/traduzione/);
no(()=>compileNpcSheetProposal(proposal([op('Item',itemId,[set('system.description.value','<p>Portata 18 piedi. CD 30.</p>')])]),englishSource,{...options,mode:'translate'}),/traduzione/);
ok(compileNpcSheetProposal(proposal([op('Item',itemId,[set('system.description.value','<p>CD 18. Portata 30 piedi.</p>')])]),englishSource,{...options,mode:'translate'}));
const effects=clone(source.items[0].effects);effects[0].name='Primo';const parent=op('Item',itemId,[set('effects',effects)]),child=op('ActiveEffect',effects[0]._id,[set('name','Secondo')],{parentItemId:itemId});
no(()=>compileNpcSheetProposal(proposal([parent,child]),source,options),/sovrapposta/);no(()=>compileNpcSheetProposal(proposal([child,parent]),source,options),/sovrapposta/);
const activity=nativeActivityTemplate('utility');activity._id='linked';activity.sort=0;activity.consumption.targets=[{type:'itemUses',target:'pool',value:'1',scaling:{mode:'',formula:''}}];
draft=compileNpcSheetProposal(proposal([op('Item','pool',[set('system.uses.max','3')],{operation:'create',itemType:'feat',name:'Risorsa'}),op('Item','power',[set('system.activities.linked',activity)],{operation:'create',itemType:'feat',name:'Capacità'})]),source,options);
eq(Object.values(draft.createdItems[1].data.system.activities)[0].sort,undefined,'New activity ordering belongs to D&D5e');
draft.createdItems.shift();ok(npcSheetAutomationWarnings(validateNpcSheetReview(draft,raw._id,options)).some(text=>text.includes('risorsa collegata')),'A discarded resource leaves a manual-use notice without blocking valid data');
draft=compileNpcSheetProposal(proposal([op('Actor',raw._id,[typed('system.attributes.hp.max',80)])]),source,options);
const current=clone(raw);current.system.attributes.hp.max=99;const rebased=rebaseNpcSheetDraft(draft,source,current,options);
eq(rebased.draft.base.actor.system.attributes.hp.max,99);eq(rebased.draft.actor.system.attributes.hp.max,80);eq(npcSheetCommandPlan(rebased.draft,rebased.source,current,options)[0].patches[0].baseValue,99,'Reopening requires a new explicit review on the actual source');
const before={_id:'Item123456789012',type:'feat',name:'Audit',system:{activities:{Activity12345678:{_id:'Activity12345678',type:'attack',attack:{bonus:'1'},damage:{parts:[{number:2}]}}}},flags:{},effects:[]};
const expected=clone(before);expected.system.activities.Activity12345678.attack.bonus='12';const concurrent=clone(expected);concurrent.system.activities.Activity12345678.damage.parts[0].number=99;
const undone=nativeApply(concurrent,nativeUndoPatches(before,expected,concurrent,'Item'));
eq(undone.system.activities.Activity12345678.attack.bonus,'1');eq(undone.system.activities.Activity12345678.damage.parts[0].number,99,'Undo never restores an unrelated activity snapshot');
concurrent.system.activities.Activity12345678.attack.bonus='15';no(()=>nativeUndoPatches(before,expected,concurrent,'Item'),/altra operazione/);
class Storage{values=new Map();async get(k){return clone(this.values.get(k));}async put(k,v){if(typeof k==='object'){for(const[x,y]of Object.entries(k))await this.put(x,y);}else{assert.ok(Buffer.byteLength(JSON.stringify(v))<128*1024);this.values.set(k,clone(v));}}async delete(k){this.values.delete(k);}async transaction(fn){const old=clone(this.values);try{return await fn(this);}catch(error){this.values=old;throw error;}}async setAlarm(){}async deleteAlarm(){}}
const coordinator=new AbilityGenerationStore({storage:new Storage()},{}),context={campaignId:'audit',worldId:'world',actorId:'actor',purpose:'native-sheet'},id=crypto.randomUUID();
const large=compileNpcSheetProposal(proposal(Array.from({length:6},(_,i)=>op('Item','new-'+i,[set('system.description.value','Descrizione. '.repeat(14000))],{operation:'create',itemType:'feat',name:'Nuova '+i}))),source,options);
ok(Buffer.byteLength(JSON.stringify(large))>1000000);ok(npcSheetCommandPlan(large,source,raw,options).length===6);
await coordinator.state.storage.put('job:'+id,{id,context,format:'npc-native-sheet-edit-v1',status:'ready',actorSource:source,options,draft:large});
const call=async(action,data)=>{const res=await coordinator.fetch(new Request('https://internal/'+action,{method:'POST',body:JSON.stringify({context,...data})}));return {status:res.status,body:await res.json()};};
const prepared=await call('prepare',{id,draft:large});eq(prepared.status,200,JSON.stringify(prepared.body.error));eq(prepared.body.document.draft.createdItems.length,6);
eq((await coordinator.state.storage.get('job:'+id)).prepared.draft,undefined,'A frozen proposal is not stored twice');eq((await call('prepare',{id})).body.document.draft.createdItems.length,6);
const rejectedProposal=proposal([
 op('Actor',raw._id,[{path:'system.details.alignment',op:'set',valueJson:'neutrale malvagio'}]),
 op('ActiveEffect','prono',[set('flags',{}),set('statuses',['prone'])],{operation:'create',name:'Prono'})
]);
const recoveryId=crypto.randomUUID();await coordinator.state.storage.put('job:'+recoveryId,{id:recoveryId,context,format:'npc-native-sheet-edit-v1',status:'uncertain',actorSource:source,options,rejectedSheetCompiler:NPC_SHEET_AI_COMPILER-1,rejectedProposal});
await coordinator.state.storage.put('latest:audit:world:actor:sheet',recoveryId);
const recovered=await call('latest',{});eq(recovered.body.job.status,'ready');ok(recovered.body.job.recoveredAt);eq(recovered.body.job.draft.actor.system.details.alignment,'neutrale malvagio');
eq(recovered.body.job.draft.createdEffects[0].data.statuses,['prone']);
console.log(`Whole NPC hardening: ${checks} checks passed; reported JSON failure, typed scalars, domain validation, translation roles, effect overlap, dependencies, rebase, concurrent undo, large confirmation and free recovery. No AI calls.`);
