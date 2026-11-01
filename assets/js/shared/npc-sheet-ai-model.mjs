import {nativeGet,nativeSet,nativeHas,nativeEqual,nativeDiff,nativeValidateChanges,nativeEditorSource,nativeEntityData,nativePatchConflict,nativeNormalizeEffect,nativeActivitiesAmbiguous} from './npc-native-model.mjs';
import {nativeAbilityEditProjection,compileNativeAbilityEdit,validateNativeAbilityEditDraft,nativeAbilityEditChanges,nativeAiAssertData,nativeAiMergeFields} from './npc-native-ability-edit.mjs';

export const NPC_SHEET_AI_FORMAT='npc-native-sheet-edit-v1';
export const NPC_SHEET_AI_VERSION=1;
export const NPC_SHEET_AI_COMPILER=1;
const clone=structuredClone,object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false}),string={type:'string'};
export const NPC_SHEET_AI_SCHEMA=object({summary:string,balance:string,assumptions:{type:'array',items:string},unsupported:{type:'array',items:string},operations:{type:'array',items:object({targetType:{type:'string',enum:['Actor','Item','ActiveEffect']},targetId:string,parentItemId:string,operation:{type:'string',enum:['update','create','delete']},itemType:{type:'string',enum:['','feat','spell','weapon','equipment','consumable','tool','loot','container']},name:string,changes:{type:'array',items:object({path:string,op:{type:'string',enum:['set','delete']},valueJson:string})}})}});
const allowedTypes=new Set(['feat','spell','weapon','equipment','consumable','tool','loot','container']);
const plain=value=>String(value||'').replace(/<[^>]*>/g,' ');
const fakeItem=effects=>({_id:'KhzActorEffects1',name:'Effetti del personaggio',type:'feat',system:{activities:{}},effects,flags:{}});
const effectData=effect=>Object.fromEntries(Object.entries(effect).filter(([key])=>!['_id','type','_stats','ownership','origin'].includes(key)));
const mainData=value=>({name:value.name,system:value.system,flags:value.flags||{}});
const meta=()=>({summary:'',balance:'',assumptions:[],unsupported:[],iconPrompt:''});
const itemDraft=(base,row)=>({version:1,format:'npc-native-ability-edit-v1',itemId:row.id,itemType:row.type,base:nativeAbilityEditProjection(base),item:row.data,...meta()});
export function npcSheetItemTemplate(type,name,id){
 if(!allowedTypes.has(type)||typeof name!=='string'||!name.trim())throw new Error('Tipo o nome del nuovo elemento non valido.');
 const system={description:{value:''}};
 if(['feat','spell','weapon','equipment','consumable','tool'].includes(type))Object.assign(system,{activities:{},uses:{spent:0,max:'',recovery:[]}});
 if(type==='feat')system.type={value:'monster',subtype:''};
 if(type==='spell')Object.assign(system,{level:1,school:'abj',method:'spell',prepared:0});
 if(['equipment','consumable','tool','loot','container'].includes(type))system.quantity=1;
 return {_id:id,name,type,system,flags:{},effects:[]};
}
export function npcSheetEffectTemplate(name,id){return nativeNormalizeEffect({_id:id,name,type:'base',disabled:false,transfer:false,statuses:[],duration:{value:null,units:'seconds',expiry:null},system:{changes:[]},flags:{'khuzoe-automations':{}}});}
function safeEffects(effects){
 const publicEffects=nativeAbilityEditProjection(fakeItem(effects)).effects;
 const visible=new Set(publicEffects.map(effect=>effect._id));
 return (effects||[]).map(effect=>{
  if(!visible.has(effect._id))return{_id:effect._id,name:effect.name,type:effect.type||'base',system:{changes:[{key:'macro.readonly',type:'custom',value:'preserved'}]},flags:{}};
  const safe=clone(publicEffects.find(value=>value._id===effect._id));
  if(effect.flags?.['khuzoe-automations']?.npcRule){safe.flags['khuzoe-automations']??={};safe.flags['khuzoe-automations'].npcRule=clone(effect.flags['khuzoe-automations'].npcRule);}
  return safe;
 });
}
export function npcSheetAiSource(raw,permissions={}){
 const actor=mainData(nativeAbilityEditProjection({...raw,effects:[]}));
 return {_id:raw._id,type:'npc',...actor,prototypeToken:{actorLink:permissions.sharedRuntime!==false},
  items:(raw.items||[]).map(item=>({_id:item._id,type:item.type,...mainData(nativeAbilityEditProjection(item)),effects:safeEffects(item.effects||[])})),effects:safeEffects(raw.effects||[])};
}
export function npcSheetAiProjection(source){return{actor:mainData(nativeAbilityEditProjection({...source,effects:[]})),items:(source.items||[]).map(item=>({id:item._id,type:item.type,data:nativeAbilityEditProjection(item)})),effects:nativeAbilityEditProjection(fakeItem(source.effects||[])).effects.map(effect=>({id:effect._id,type:effect.type||'base',data:effectData(effect)}))};}
function changeFields(original,changes,type,permissions){
 const next=clone(original);
 if(!Array.isArray(changes)||changes.length>512)throw new Error('Elenco di modifiche non valido.');
 const seen=[];
 for(const change of changes){
  if(!change||typeof change.path!=='string'||!['set','delete'].includes(change.op)||typeof change.valueJson!=='string')throw new Error('Campo della proposta non valido.');
  if(seen.some(path=>path===change.path||path.startsWith(change.path+'.')||change.path.startsWith(path+'.')))throw new Error('La proposta contiene campi sovrapposti.');seen.push(change.path);
  const value=change.op==='set'?JSON.parse(change.valueJson):undefined;if(change.op==='set')nativeAiAssertData(value,change.path);
  nativeSet(next,change.path,value,change.op==='delete');
 }
 nativeDiff(original,next,type,permissions);return next;
}
function notes(input){for(const key of ['summary','balance'])if(typeof input[key]!=='string'||input[key].length>8000)throw new Error('Riepilogo della proposta non valido.');for(const key of ['assumptions','unsupported'])if(!Array.isArray(input[key])||input[key].length>64||input[key].some(value=>typeof value!=='string'||value.length>2000))throw new Error('Note della proposta non valide.');}
export function compileNpcSheetProposal(proposal,source,options={}){
 notes(proposal);if(!Array.isArray(proposal.operations)||proposal.operations.length>256)throw new Error('Operazioni della scheda non valide.');
 const base=npcSheetAiProjection(source),draft={version:1,format:NPC_SHEET_AI_FORMAT,mode:options.mode||'general',base,actor:clone(base.actor),items:clone(base.items),effects:clone(base.effects),createdItems:[],createdEffects:[],summary:proposal.summary,balance:proposal.balance,assumptions:clone(proposal.assumptions),unsupported:clone(proposal.unsupported)};
 const permissions={isAdmin:false,embeddedEffects:true,sharedRuntime:options.sharedRuntime!==false},used=new Set([source._id,...(source.items||[]).map(item=>item._id),...(source.effects||[]).map(effect=>effect._id)]),aliases=new Map(),seen=new Set();let sequence=0;
 const allocate=kind=>{let id;do{id=`KhzNpc${kind}${String(++sequence).padStart(8,'0')}`;}while(used.has(id));used.add(id);return id;};
 for(const operation of proposal.operations){
  const {targetType,targetId,parentItemId,changes}=operation;
  if(!['Actor','Item','ActiveEffect'].includes(targetType)||!['create','update','delete'].includes(operation.operation)||typeof targetId!=='string'||typeof parentItemId!=='string')throw new Error('Destinazione della proposta non valida.');
  const key=`${targetType}:${parentItemId}:${targetId}`;if(seen.has(key))throw new Error('Più operazioni si sovrappongono sullo stesso elemento.');seen.add(key);
  if(targetType==='Actor'){
   if(operation.operation!=='update'||targetId!==source._id||parentItemId)throw new Error('L’AI può modificare soltanto questo NPC.');
   draft.actor=changeFields(draft.actor,changes,'Actor',permissions);continue;
  }
  if(targetType==='Item'){
   if(parentItemId)throw new Error('Un oggetto deve appartenere al personaggio selezionato.');
   if(operation.operation==='create'){
    if(!targetId||aliases.has(targetId)||used.has(targetId))throw new Error('Alias del nuovo elemento non valido o duplicato.');
    const id=allocate('It'),template=npcSheetItemTemplate(operation.itemType,operation.name,id);aliases.set(targetId,id);
    const edited=compileNativeAbilityEdit({...meta(),changes},template,options.capabilities||{});
    draft.createdItems.push({id,type:template.type,base:nativeAbilityEditProjection(template),data:edited.item});continue;
   }
   const row=draft.items.find(item=>item.id===targetId),original=(source.items||[]).find(item=>item._id===targetId);if(!row||!original)throw new Error('La capacità o l’oggetto selezionato non esiste.');
   if(operation.operation==='delete'){if(changes.length)throw new Error('Una rimozione non deve includere modifiche.');draft.items=draft.items.filter(item=>item.id!==targetId);continue;}
   row.data=compileNativeAbilityEdit({...meta(),changes},nativeAiMergeFields(original,nativeAbilityEditProjection(original),row.data),options.capabilities||{}).item;continue;
  }
  const rows=parentItemId?(draft.items.find(item=>item.id===parentItemId)?.data.effects):draft.effects;
  if(parentItemId){
   const item=draft.items.find(item=>item.id===parentItemId),original=source.items.find(item=>item._id===parentItemId),effect=item?.data.effects.find(effect=>effect._id===targetId);
   if(operation.operation==='create')throw new Error('Aggiungi nuovi effetti di capacità tramite l’elenco effetti della capacità.');
   if(!effect||!original)throw new Error('L’effetto selezionato non è modificabile.');
   const next=clone(item.data.effects);
   if(operation.operation==='delete')next.splice(next.findIndex(value=>value._id===targetId),1);
   else {const index=next.findIndex(value=>value._id===targetId);next[index]={_id:effect._id,type:effect.type,...changeFields(effectData(effect),changes,'ActiveEffect',permissions)};}
   const itemChanges=[{path:'effects',op:'set',valueJson:JSON.stringify(next)}];
   if(operation.operation==='delete')for(const [id,activity]of Object.entries(item.data.system.activities||{}))if(activity.effects?.some(link=>link._id===targetId))itemChanges.push({path:`system.activities.${id}.effects`,op:'set',valueJson:JSON.stringify(activity.effects.filter(link=>link._id!==targetId))});
   // Apply over the current public draft, then validate over its original base.
   item.data=compileNativeAbilityEdit({...meta(),changes:itemChanges},nativeAiMergeFields(original,nativeAbilityEditProjection(original),item.data),options.capabilities||{}).item;continue;
  }
  if(operation.operation==='create'){
   if(!targetId||aliases.has(targetId)||used.has(targetId))throw new Error('Alias del nuovo effetto non valido o duplicato.');
   const id=allocate('Ef'),template=npcSheetEffectTemplate(operation.name||'Nuovo effetto',id);aliases.set(targetId,id);const data=changeFields(effectData(template),changes,'ActiveEffect',permissions);draft.createdEffects.push({id,type:'base',base:effectData(template),data});continue;
  }
  const row=rows?.find(effect=>effect.id===targetId);if(!row)throw new Error('L’effetto selezionato non è modificabile.');
  if(operation.operation==='delete'){if(changes.length)throw new Error('Una rimozione non deve includere modifiche.');draft.effects=draft.effects.filter(effect=>effect.id!==targetId);}else row.data=changeFields(row.data,changes,'ActiveEffect',permissions);
 }
 for(const row of [...draft.items,...draft.createdItems])for(const activity of Object.values(row.data.system.activities||{}))for(const target of activity.consumption?.targets||[])if(aliases.has(target.target))target.target=aliases.get(target.target);
 return validateNpcSheetDraft(draft,source,options);
}
function checkRows(rows,types=false){if(!Array.isArray(rows)||rows.length>256||new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('Elementi della bozza non validi o duplicati.');for(const row of rows)if(!/^[A-Za-z0-9]{16}$/.test(row.id)||!row.data||types&&typeof row.type!=='string')throw new Error('Elemento della bozza non valido.');}
export function validateNpcSheetDraft(input,source,options={}){
 notes(input);if(input.version!==1||input.format!==NPC_SHEET_AI_FORMAT||!['general','translate'].includes(input.mode)||input.mode!==(options.mode||'general'))throw new Error('Bozza della scheda non valida.');
 if(Object.keys(input).some(key=>!['version','format','mode','base','actor','items','effects','createdItems','createdEffects','summary','balance','assumptions','unsupported'].includes(key)))throw new Error('La bozza contiene dati non previsti.');
 const base=npcSheetAiProjection(source);if(!nativeEqual(input.base,base))throw new Error('La sorgente della proposta non corrisponde alla scheda selezionata.');
 const permissions={isAdmin:false,embeddedEffects:true,sharedRuntime:options.sharedRuntime!==false},draft=clone(input);
 const actorPatches=nativeDiff(base.actor,draft.actor,'Actor',permissions);for(const patch of actorPatches)if(patch.op==='set')nativeAiAssertData(patch.value,patch.path);if(actorPatches.length)nativeValidateChanges(source,{type:'Actor',id:source._id},actorPatches,permissions);
 for(const key of ['items','effects','createdItems','createdEffects'])checkRows(draft[key],key.includes('Items')||key==='items');
 const ids=new Set([...base.items.map(row=>row.id),...base.effects.map(row=>row.id),source._id]);
 for(const row of draft.items){const original=source.items.find(item=>item._id===row.id);if(!original||original.type!==row.type)throw new Error('L’identità o il tipo di una capacità esistente non può cambiare.');if(!nativeEqual(base.items.find(item=>item.id===row.id).data,row.data))row.data=validateNativeAbilityEditDraft(itemDraft(original,row),original,options.capabilities||{}).item;}
 for(const row of draft.createdItems){if(ids.has(row.id))throw new Error('Il nuovo elemento usa un identificativo già presente.');ids.add(row.id);const template=npcSheetItemTemplate(row.type,row.base?.name,row.id);if(!nativeEqual(row.base,nativeAbilityEditProjection(template)))throw new Error('Sorgente del nuovo elemento non valida.');row.data=validateNativeAbilityEditDraft(itemDraft(template,row),template,options.capabilities||{}).item;}
 const validateEffect=(row,original)=>{const before=effectData(nativeAbilityEditProjection(fakeItem([original])).effects[0]||{});if(!before.name)throw new Error('L’effetto gestito da codice non può essere modificato dall’AI.');const patches=nativeDiff(before,row.data,'ActiveEffect',permissions);for(const patch of patches)if(patch.op==='set')nativeAiAssertData(patch.value,patch.path);if(patches.length){
  for(const change of row.data.system?.changes||[])if(!/^system\.[A-Za-z0-9_.-]+$/.test(change.key)||!['multiply','add','subtract','downgrade','upgrade','override'].includes(change.type))throw new Error('Gli effetti AI possono modificare dati di gioco, senza macro o operazioni personalizzate.');
  nativeValidateChanges(original,{type:'ActiveEffect',id:row.id},patches,permissions);
 }};
 for(const row of draft.effects){const original=source.effects.find(effect=>effect._id===row.id);if(!original||row.type!==(original.type||'base'))throw new Error('L’effetto esistente non è valido.');validateEffect(row,original);}
 for(const row of draft.createdEffects){if(ids.has(row.id)||row.type!=='base')throw new Error('Il nuovo effetto usa un identificativo o tipo non valido.');ids.add(row.id);const template=npcSheetEffectTemplate(row.base?.name,row.id);if(!nativeEqual(row.base,effectData(template)))throw new Error('Sorgente del nuovo effetto non valida.');validateEffect(row,template);}
 const itemIds=new Set([...draft.items,...draft.createdItems].map(row=>row.id));
 for(const row of [...draft.items,...draft.createdItems])for(const activity of Object.values(row.data.system.activities||{}))for(const target of activity.consumption?.targets||[])if(target.type==='itemUses'&&target.target&&!itemIds.has(target.target)&&!String(target.target).includes('.'))throw new Error('Un’attività consuma una risorsa appartenente a un elemento mancante.');
 if(draft.mode==='translate')validateTranslation(draft,permissions);
 if(new TextEncoder().encode(JSON.stringify(draft)).length>1500000)throw new Error('La proposta è troppo grande per essere inviata integralmente. Nessun dato è stato troncato.');
 return draft;
}
function validateTranslation(draft,permissions){
 if(draft.createdItems.length||draft.createdEffects.length||!nativeEqual(draft.base.items.map(row=>row.id).sort(),draft.items.map(row=>row.id).sort())||!nativeEqual(draft.base.effects.map(row=>row.id).sort(),draft.effects.map(row=>row.id).sort()))throw new Error('La modalità traduzione conserva tutti gli elementi e le loro meccaniche.');
 const textChange=(patch,allowed)=>{if(!allowed(patch.path)||patch.op!=='set'||typeof patch.value!=='string'||typeof patch.baseValue!=='string')throw new Error('La traduzione può cambiare soltanto nomi e testi.');
  const tokens=value=>(value.match(/@(?:UUID|Compendium|Embed)\[[^\]]+\]|\[\[[\s\S]*?\]\]|&Reference\[[^\]]+\]/g)||[]).sort();
  const numbers=value=>(plain(value).match(/\d+(?:[.,]\d+)?/g)||[]).map(value=>value.replace(',','.')).sort();
  const dice=value=>(plain(value).match(/\b\d*d\d+(?:\s*[+-]\s*\d+)?\b/gi)||[]).map(value=>value.replace(/\s/g,'').toLowerCase()).sort();
  if(!nativeEqual(tokens(patch.baseValue),tokens(patch.value))||!nativeEqual(numbers(patch.baseValue),numbers(patch.value))||!nativeEqual(dice(patch.baseValue),dice(patch.value)))throw new Error('La traduzione deve conservare numeri, formule e collegamenti.');};
 for(const patch of nativeDiff(draft.base.actor,draft.actor,'Actor',permissions))textChange(patch,path=>path==='name'||/^system\.details\.biography\.(?:value|public)$/.test(path));
 const effectTexts=(before,after)=>{for(const patch of nativeDiff(before,after,'ActiveEffect',permissions))textChange(patch,path=>['name','description'].includes(path));};
 for(const row of draft.items){const before=draft.base.items.find(item=>item.id===row.id).data;for(const patch of nativeDiff(mainData(before),mainData(row.data),'Item',permissions))textChange(patch,path=>path==='name'||/^system\.description\.(?:value|chat|unidentified)$/.test(path)||/^system\.activities\.[^.]+\.(?:name|description\.(?:value|chatFlavor))$/.test(path));if(!nativeEqual(before.effects.map(effect=>effect._id).sort(),row.data.effects.map(effect=>effect._id).sort()))throw new Error('La traduzione conserva gli effetti esistenti.');for(const effect of row.data.effects)effectTexts(effectData(before.effects.find(value=>value._id===effect._id)),effectData(effect));}
 for(const row of draft.effects)effectTexts(draft.base.effects.find(effect=>effect.id===row.id).data,row.data);
}
export function npcSheetDraftChanges(draft){
 const permissions={isAdmin:false,embeddedEffects:true,sharedRuntime:true},changes=[];
 const add=(type,id,name,before,after,extra={})=>{const patches=nativeDiff(before,after,type,permissions);if(patches.length)changes.push({operation:'update',target:{type,id,...extra},name,patches});};
 add('Actor','actor',draft.actor.name,draft.base.actor,draft.actor);
 for(const row of draft.items){const before=draft.base.items.find(value=>value.id===row.id);add('Item',row.id,row.data.name,before.data,row.data);}
 for(const row of draft.effects){const before=draft.base.effects.find(value=>value.id===row.id);add('ActiveEffect',row.id,row.data.name,before.data,row.data);}
 for(const row of draft.createdItems)changes.push({operation:'create',target:{type:'Item',id:row.id},name:row.data.name});
 for(const row of draft.createdEffects)changes.push({operation:'create',target:{type:'ActiveEffect',id:row.id},name:row.data.name});
 for(const row of draft.base.items)if(!draft.items.some(value=>value.id===row.id))changes.push({operation:'delete',target:{type:'Item',id:row.id},name:row.data.name});
 for(const row of draft.base.effects)if(!draft.effects.some(value=>value.id===row.id))changes.push({operation:'delete',target:{type:'ActiveEffect',id:row.id},name:row.data.name});return changes;
}
// UI adapter: the same typed controls as the manual editor, including effects
// under their owning Item. Only the public projection enters the browser.
export function npcSheetProtectedEffects(source){return(source?.items||[]).flatMap(item=>(item.effects||[]).filter(effect=>effect.flags?.['khuzoe-automations']?.npcRule).map(effect=>({itemId:item._id,id:effect._id})));}
export function npcSheetProposalEditor(draft,actorId,options={}){
 const entities=[],effectEntity=(row,before,item)=>({key:`ActiveEffect:${item?.id||''}:${row.id}`,target:{type:'ActiveEffect',id:row.id,...(item?{itemId:item.id}:{})},type:'ActiveEffect',effectType:row.type||'base',name:row.data.name,parentName:item?.data.name,readOnly:(options.protectedEffects||[]).some(effect=>effect.itemId===item?.id&&effect.id===row.id),category:'effects',data:clone(before),initialDraft:clone(row.data)});
 entities.push({key:`Actor::${actorId}`,target:{type:'Actor',id:actorId},type:'Actor',name:draft.actor.name,category:'stats',data:clone(draft.base.actor),initialDraft:clone(draft.actor)});
 for(const row of [...draft.items,...draft.createdItems]){
  const before=draft.base.items.find(value=>value.id===row.id)?.data||row.base,withoutEffects=value=>{const result=clone(value);delete result.effects;return result;},category=row.type==='spell'?'spells':['feat','weapon'].includes(row.type)?'abilities':'inventory';
  entities.push({key:`Item::${row.id}`,target:{type:'Item',id:row.id},type:'Item',itemType:row.type,activityReadOnly:nativeActivitiesAmbiguous(row.data),name:row.data.name,category,data:withoutEffects(before),initialDraft:withoutEffects(row.data)});
  for(const effect of row.data.effects||[]){const old=before.effects?.find(value=>value._id===effect._id);entities.push(effectEntity({id:effect._id,type:effect.type,data:effectData(effect)},old?effectData(old):effectData(effect),row));}
 }
 for(const row of [...draft.effects,...draft.createdEffects])entities.push(effectEntity(row,draft.base.effects.find(value=>value.id===row.id)?.data||row.base));
 return{version:1,canApply:true,capabilities:options.capabilities||{},permissions:{isAdmin:false,embeddedEffects:true,sharedRuntime:options.sharedRuntime!==false},entities,commands:[]};
}
export function npcSheetReadProposalEditor(draft,entities){
 const next=clone(draft),actor=entities.find(entity=>entity.type==='Actor');next.actor=clone(actor.draft);
 for(const row of [...next.items,...next.createdItems]){const item=entities.find(entity=>entity.type==='Item'&&entity.target.id===row.id);row.data={...clone(item.draft),effects:entities.filter(entity=>entity.type==='ActiveEffect'&&entity.target.itemId===row.id).map(entity=>({_id:entity.target.id,type:entity.effectType||'base',...clone(entity.draft)}))};}
 for(const row of [...next.effects,...next.createdEffects])row.data=clone(entities.find(entity=>entity.type==='ActiveEffect'&&!entity.target.itemId&&entity.target.id===row.id).draft);
 return next;
}
// Expand only the user's intent over the current raw snapshot. Unseen module
// fields remain current, and each changed field keeps its original base value.
export function npcSheetCommandPlan(draft,baseline,current,options={}){
 draft=validateNpcSheetDraft(draft,baseline,options);const permissions={isAdmin:false,embeddedEffects:true,sharedRuntime:options.sharedRuntime!==false},plan=[];
 const actorBaseRaw=nativeAiMergeFields(current,mainData(nativeAbilityEditProjection({...current,effects:[]})),draft.base.actor),actorNext=nativeAiMergeFields(actorBaseRaw,draft.base.actor,draft.actor);
 const actorPatches=nativeDiff(nativeEntityData(actorBaseRaw,'Actor',permissions),nativeEntityData(actorNext,'Actor',permissions),'Actor',permissions);if(actorPatches.length)plan.push({operation:'update',target:{type:'Actor',id:current._id},patches:actorPatches});
 for(const row of draft.items){if(nativeEqual(draft.base.items.find(item=>item.id===row.id).data,row.data))continue;const now=current.items.find(item=>item._id===row.id),old=baseline.items.find(item=>item._id===row.id);if(!now||!old||now.type!==row.type)throw new Error('Una capacità è stata rimossa o sostituita. La bozza è conservata.');const raw=nativeAiMergeFields(now,nativeAbilityEditProjection(now),nativeAbilityEditProjection(old));const patches=nativeAbilityEditChanges(itemDraft(raw,row),raw,options.capabilities||{});if(patches.length)plan.push({operation:'update',target:{type:'Item',id:row.id},patches});}
 for(const row of draft.effects){if(nativeEqual(draft.base.effects.find(effect=>effect.id===row.id).data,row.data))continue;const now=current.effects.find(effect=>effect._id===row.id),old=baseline.effects.find(effect=>effect._id===row.id);if(!now||!old)throw new Error('Un effetto è stato rimosso. La bozza è conservata.');const pub=effectData(nativeAbilityEditProjection(fakeItem([now])).effects[0]||{}),oldPub=effectData(nativeAbilityEditProjection(fakeItem([old])).effects[0]||{}),raw=nativeAiMergeFields(now,pub,oldPub),next=nativeAiMergeFields(raw,oldPub,row.data);const patches=nativeDiff(nativeEntityData(raw,'ActiveEffect',permissions),nativeEntityData(next,'ActiveEffect',permissions),'ActiveEffect',permissions);if(patches.length)plan.push({operation:'update',target:{type:'ActiveEffect',id:row.id},patches});}
 for(const row of draft.createdItems){const template=npcSheetItemTemplate(row.type,row.base.name,row.id),doc=nativeApplyItem(template,row,options);plan.push({operation:'create',target:{type:'Item',id:row.id},document:doc});}
 for(const row of draft.createdEffects)plan.push({operation:'create',target:{type:'ActiveEffect',id:row.id},document:{_id:row.id,type:'base',...clone(row.data)}});
 for(const before of draft.base.items)if(!draft.items.some(row=>row.id===before.id)){const now=current.items.find(item=>item._id===before.id);if(!now||!nativeEqual(nativeAbilityEditProjection(now),before.data))throw new Error('L’elemento da eliminare è cambiato. Aggiorna la proposta.');plan.push({operation:'delete',target:{type:'Item',id:before.id},baseValue:nativeEditorSource(now,'Item')});}
 for(const before of draft.base.effects)if(!draft.effects.some(row=>row.id===before.id)){const now=current.effects.find(effect=>effect._id===before.id);if(!now||!nativeEqual(effectData(nativeAbilityEditProjection(fakeItem([now])).effects[0]),before.data))throw new Error('L’effetto da eliminare è cambiato.');plan.push({operation:'delete',target:{type:'ActiveEffect',id:before.id},baseValue:clone(now)});}
 for(const operation of plan)if(operation.operation==='update'){const raw=operation.target.type==='Actor'?current:operation.target.type==='Item'?current.items.find(item=>item._id===operation.target.id):current.effects.find(effect=>effect._id===operation.target.id);if(operation.patches.some(patch=>nativePatchConflict(nativeEditorSource(raw,operation.target.type),patch)))throw new Error('Alcuni campi sono cambiati dopo la proposta. Nessuna modifica è stata inviata.');nativeValidateChanges(raw,operation.target,operation.patches,permissions);}
 if(!plan.length)throw new Error('La proposta non contiene modifiche.');if(new TextEncoder().encode(JSON.stringify(plan)).length>700000)throw new Error('Le modifiche superano il limite di un invio: nessun dato è stato troncato.');return plan;
}
function nativeApplyItem(template,row,options){const draft=itemDraft(template,row),patches=nativeAbilityEditChanges(draft,template,options.capabilities||{}),result=clone(template);for(const patch of patches)nativeSet(result,patch.path,patch.value,patch.op==='delete');return result;}
