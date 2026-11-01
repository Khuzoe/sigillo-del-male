import {nativeGet, nativeSet, nativeEqual, nativeDiff, nativeValidateChanges, nativeEditorSource, nativeValidateValue, nativeActivitiesAmbiguous} from "./npc-native-model.mjs";

export const NATIVE_ABILITY_EDIT_FORMAT = "npc-native-ability-edit-v1";
export const NATIVE_ABILITY_EDIT_COMPILER_VERSION = 4;
const clone = value => value === undefined ? undefined : structuredClone(value);
const object = properties => ({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const string = {type:"string"};
export const NATIVE_ABILITY_EDIT_SCHEMA = object({
  changes:{type:"array",items:object({path:string,op:{type:"string",enum:["set","delete"]},valueJson:string})},
  summary:string, balance:string, assumptions:{type:"array",items:string}, unsupported:{type:"array",items:string}, iconPrompt:string
});
const damageTypes = new Set(["acid","bludgeoning","cold","fire","force","lightning","necrotic","piercing","poison","psychic","radiant","slashing","thunder"]);
const conditions = new Set(["blinded","charmed","deafened","frightened","grappled","incapacitated","invisible","paralyzed","petrified","poisoned","prone","restrained","stunned","unconscious"]);
const blocked = path => path.split(".").some(key => ["__proto__","prototype","constructor","_stats","ownership","midiRollConfig"].includes(key) || /macro|^script|^command|onUse/i.test(key));
const safeFlag = path => /^flags\.(?:khuzoe-automations\.npcRules|midi-qol|dae)(?:\.|$)/.test(path);
const allowed = path => !blocked(path) && (path === "name" || /^system\./.test(path) && !/^system\.(?:source|sourceItem|advancement)(?:\.|$)/.test(path) || safeFlag(path) || path === "effects");
function project(value,path="") {
  if (blocked(path)) return undefined;
  if (Array.isArray(value)) return value.map((child,index)=>project(child,`${path}.${index}`));
  if (!value || typeof value !== "object") return clone(value);
  return Object.fromEntries(Object.entries(value).filter(([key])=>!blocked(path?`${path}.${key}`:key)).map(([key,child])=>[key,key==="flags"?flags(child):project(child,path?`${path}.${key}`:key)]));
}
function flags(value={}) {
  const result={"khuzoe-automations":{}};
  for(const [module,data] of Object.entries(value)) {
    if(module==="khuzoe-automations" && data.npcRules)result[module]={npcRules:project(data.npcRules)};
    else if(["midi-qol","dae"].includes(module))result[module]=project(data);
  }
  return result;
}
export function nativeAbilityEditProjection(item) {
  const source=nativeEditorSource(item,"Item"),system=project(source.system||{},"system");
  for(const key of ["source","sourceItem","advancement"])delete system[key];
  return {name:source.name,system,flags:flags(source.flags),effects:(source.effects||[]).filter(effect=>(effect.system?.changes||[]).every(change=>/^system\./.test(change.key||"")&&!blocked(change.key)&&change.type!=="custom")).map(effect=>{
    const result={};
    for(const key of ["_id","name","img","type","description","disabled","transfer","duration","statuses","changes","system","tint","showIcon"])if(Object.hasOwn(effect,key))result[key]=project(effect[key],key);
    result.flags=flags(effect.flags);return result;
  })};
}
// Apply the changed, visible fields over the archived source. Opaque module
// settings and private flags never travel through the model or the browser.
function reconcile(original,base,next,path="") {
  if(nativeEqual(base,next))return clone(original);
  if(Array.isArray(next)) {
    const byId=next.every(value=>value&&typeof value==="object"&&value._id) && (base||[]).every(value=>value&&typeof value==="object"&&value._id);
    const result=next.map((value,index)=>{const previous=byId?(base||[]).find(entry=>entry._id===value._id):base?.[index],raw=byId?(original||[]).find(entry=>entry._id===value._id):original?.[index];return reconcile(raw,previous,value,`${path}.${index}`);});
    if(byId)for(const hidden of original||[])if(!(base||[]).some(value=>value._id===hidden._id)&&!next.some(value=>value._id===hidden._id))result.push(clone(hidden));
    return result;
  }
  if(next && typeof next==="object") {
    const result=clone(original&&typeof original==="object"&&!Array.isArray(original)?original:{});
    for(const key of new Set([...Object.keys(base||{}),...Object.keys(next)])) {
      if(!Object.hasOwn(next,key)){
        if(path.split('.').includes('flags')&&base?.[key]&&typeof base[key]==="object"&&!Array.isArray(base[key])){const retained=reconcile(original?.[key],base[key],{},`${path}.${key}`);if(Object.keys(retained).length)result[key]=retained;else delete result[key];}
        else delete result[key];
      }
      else result[key]=reconcile(original?.[key],base?.[key],next[key],path?`${path}.${key}`:key);
    }
    return result;
  }
  return clone(next);
}
function assertData(value,path="") {
  nativeValidateValue(value);
  const visit=(entry,prefix)=>{
    if(blocked(prefix))throw new Error(`Campo non disponibile all’AI: ${prefix}`);
    if(entry&&typeof entry==="object")for(const [key,child]of Object.entries(entry))visit(child,prefix?`${prefix}.${key}`:key);
    else if(typeof entry==="string") {
      if(/<\s*(?:script|iframe|object|embed|style)\b|\bon\w+\s*=|javascript\s*:|\b(?:eval|Function)\s*\(|\b(?:game|canvas|globalThis|window|document)\s*[.[]/i.test(entry))throw new Error(`Questo campo deve contenere dati, senza codice: ${prefix}`);
      if(/(?:formula|bonus|\.max)$/.test(prefix) && /[;{}]|=>/.test(entry))throw new Error(`Formula non valida: ${prefix}`);
    }
  };visit(value,path);
}
// IDs are transport details, not game mechanics. Resolve aliases for NEW
// documents on the server, then rewrite every supported reference together.
// Existing identities, duplicate aliases and ambiguous links are never guessed.
function assignCreatedIds(item,baseline) {
  const original=nativeEditorSource(baseline,"Item"),activities=item.system?.activities||{},oldActivities=original.system?.activities||{};
  if(nativeActivitiesAmbiguous(original)){
    const visible=nativeAbilityEditProjection(original);
    if(!nativeEqual(item.system?.activities,visible.system?.activities)||!nativeEqual(item.flags?.['khuzoe-automations']?.npcRules,visible.flags?.['khuzoe-automations']?.npcRules))throw new Error('Questa capacità contiene attività con identificativi duplicati: conserva le meccaniche e correggile prima in Foundry.');
    return item;
  }
  const oldEffects=new Set((original.effects||[]).map(effect=>effect._id));
  const valid=id=>typeof id==="string"&&/^[A-Za-z0-9]{16}$/.test(id);
  const reserved=new Set([...Object.keys(oldActivities),...oldEffects,...Object.keys(activities).filter(valid),...Object.values(activities).flatMap(activity=>[activity?._id,activity?.id]).filter(valid),...(item.effects||[]).map(effect=>effect?._id||effect?.id).filter(valid)]);
  const counters={A:0,E:0},maps={A:new Map(),E:new Map()};
  const allocate=type=>{let id;do{id=`KhzEdit${type}${String(++counters[type]).padStart(8,"0")}`;}while(reserved.has(id));reserved.add(id);return id;};
  const alias=(type,from,to)=>{if(from===undefined||from===null||from==="")return;if(typeof from!=="string")throw new Error("L’identificativo generato deve essere un testo.");const previous=maps[type].get(from);if(previous&&previous!==to)throw new Error("La proposta contiene riferimenti ambigui a nuovi elementi.");maps[type].set(from,to);};
  const nextActivities={};
  for(const [key,activity]of Object.entries(activities)) {
    if(!activity||typeof activity!=="object"||Array.isArray(activity))throw new Error("Attività generata non valida.");
    let id;
    if(Object.hasOwn(oldActivities,key)) {
      if(activity._id&&activity._id!==key||activity.id&&activity.id!==key&&activity.id!==oldActivities[key].id)throw new Error("L’AI non può cambiare l’identificativo di un’attività esistente.");
      id=key;
    } else {
      if([activity._id,activity.id].some(value=>Object.hasOwn(oldActivities,value)))throw new Error("L’attività generata riutilizza l’identificativo di un’altra attività.");
      id=valid(key)?key:valid(activity._id)?activity._id:valid(activity.id)?activity.id:allocate('A');
    }
    if(Object.hasOwn(nextActivities,id))throw new Error("La proposta contiene attività duplicate.");
    for(const value of [key,activity._id,activity.id])alias('A',value,id);
    activity._id=id;if(!Object.hasOwn(oldActivities[key]||{},'id'))delete activity.id;nextActivities[id]=activity;
  }
  if(item.system?.activities)item.system.activities=nextActivities;
  const effectAliases=new Set();
  if(!Array.isArray(item.effects))throw new Error("L’elenco degli effetti generato non è valido.");
  for(const effect of item.effects) {
    if(!effect||typeof effect!=="object"||Array.isArray(effect))throw new Error("Effetto generato non valido.");
    if(effect.statuses!==undefined&&!Array.isArray(effect.statuses))throw new Error("Le condizioni dell’effetto devono essere un elenco.");
    if((effect.statuses||[]).some(value=>typeof value!=="string"||!value.trim()))throw new Error("Ogni condizione dell’effetto deve avere un identificativo testuale.");
    const provided=effect._id||effect.id;
    if(effect._id&&effect.id&&effect._id!==effect.id)throw new Error("Un effetto contiene due identificativi diversi.");
    if(provided&&effectAliases.has(provided))throw new Error("La proposta contiene effetti duplicati.");
    if(provided)effectAliases.add(provided);
    const id=oldEffects.has(provided)||valid(provided)?provided:allocate('E');
    alias('E',provided,id);effect._id=id;delete effect.id;
    if(!oldEffects.has(id)&&(!effect.name||typeof effect.name!=="string"||!effect.name.trim())){
      const names={grappled:"Afferrato",prone:"Prono",restrained:"Trattenuto",poisoned:"Avvelenato",stunned:"Stordito"};
      effect.name=typeof effect.label==="string"&&effect.label.trim()?effect.label.trim():(effect.statuses||[]).map(value=>names[value]||value).join(", ")||`Effetto di ${item.name||baseline.name}`;
    }
    if(Object.hasOwn(effect,'label')&&!Object.hasOwn((original.effects||[]).find(value=>value._id===id)||{},'label'))delete effect.label;
  }
  const activityId=id=>maps.A.get(id)||id,effectId=id=>maps.E.get(id)||id;
  for(const activity of Object.values(nextActivities)) {
    if(activity.otherActivityId)activity.otherActivityId=activityId(activity.otherActivityId);
    if(activity.midiProperties?.triggeredActivityId)activity.midiProperties.triggeredActivityId=activityId(activity.midiProperties.triggeredActivityId);
    for(const link of activity.effects||[])if(link&&typeof link==="object"){
      if(link._id&&link.id&&link._id!==link.id)throw new Error("Un collegamento effetto contiene due identificativi diversi.");
      link._id=effectId(link._id||link.id);delete link.id;
    }
  }
  const rules=item.flags?.['khuzoe-automations']?.npcRules;
  if(rules?.activities){const result={};for(const [key,rule]of Object.entries(rules.activities)){const id=activityId(key);if(Object.hasOwn(result,id))throw new Error("Regole duplicate per la stessa attività.");result[id]=rule;}rules.activities=result;}
  return item;
}
function validateMechanics(item,baseline,capabilities={}) {
  const activities=item.system?.activities||{},ids=new Set(Object.keys(activities));
  if(ids.size>32)throw new Error("Una capacità può contenere al massimo 32 attività.");
  for(const [id,activity]of Object.entries(activities)) {
    if(nativeEqual(activity,baseline.system?.activities?.[id]))continue;
    if(!/^[A-Za-z0-9]{16}$/.test(id)||activity._id!==id||!activity.type)throw new Error("Identificativo di attività non valido.");
    if(!baseline.system?.activities?.[id]&&!['attack','save','damage','heal','utility'].includes(activity.type))throw new Error("La nuova attività richiede un tipo non supportato dall’editor.");
    for(const linked of [activity.otherActivityId,activity.midiProperties?.triggeredActivityId])if(linked&&linked!=="none"&&!ids.has(linked))throw new Error("L’attività collegata non esiste.");
  }
  const followUps=value=>Object.fromEntries(Object.entries(value||{}).map(([id,activity])=>[id,activity.midiProperties?.triggeredActivityId||""]));
  const links=followUps(activities);
  if(!nativeEqual(links,followUps(baseline.system?.activities))){
    for(const start of ids){const visited=new Set();let id=start;while(id&&links[id]){if(visited.has(id))throw new Error("Le attività successive formano un ciclo: ogni tiro deve terminare.");visited.add(id);id=links[id];}}
  }
  const effects=item.effects||[];
  if(!Array.isArray(effects)||effects.length>64||new Set(effects.map(effect=>effect._id)).size!==effects.length)throw new Error("Effetti non validi o duplicati.");
  const effectIds=new Set(effects.map(effect=>effect._id));
  for(const effect of effects) {
    if(nativeEqual(effect,(baseline.effects||[]).find(value=>value._id===effect._id)))continue;
    if(!/^[A-Za-z0-9]{16}$/.test(effect._id)||typeof effect.name!=="string"||!effect.name.trim())throw new Error("Ogni effetto deve avere un nome e un identificativo valido.");
    for(const change of effect.system?.changes||effect.changes||[])if(!/^system\.[A-Za-z0-9_.-]+$/.test(change.key)||!['multiply','add','subtract','downgrade','upgrade','override'].includes(change.type))throw new Error("Gli effetti AI possono modificare campi di gioco, senza macro o operazioni personalizzate.");
  }
  for(const activity of Object.values(activities))for(const link of activity.effects||[])if(!effectIds.has(link._id))throw new Error("L’attività richiama un effetto che non esiste.");
  const rules=item.flags?.['khuzoe-automations']?.npcRules;
  if(rules && !nativeEqual(rules,baseline.flags?.['khuzoe-automations']?.npcRules)) {
    if(rules.version!==1||!rules.activities||Array.isArray(rules.activities)||Object.keys(rules).some(key=>!['version','activities'].includes(key)))throw new Error("Regole della capacità non valide.");
    for(const [id,rule]of Object.entries(rules.activities)) {
      if(!ids.has(id)||Object.keys(rule).some(key=>!['healing','healingTypes','conditions','rounds','expiry'].includes(key))||![0,.5,1].includes(rule.healing??0)||!Array.isArray(rule.conditions??[])||(rule.conditions||[]).some(value=>!conditions.has(value))||!Number.isInteger(rule.rounds??1)||(rule.rounds??1)<0||(rule.rounds??1)>100||!['turnStart','turnEnd'].includes(rule.expiry??'turnEnd'))throw new Error("Effetto dell’attività non valido.");
      if(rule.healingTypes!==undefined&&(!Array.isArray(rule.healingTypes)||rule.healingTypes.length>13||rule.healingTypes.some(type=>!damageTypes.has(type))))throw new Error("Tipi di danno per la cura non validi.");
      if(rule.healingTypes?.length&&capabilities.healingTypes!==1)throw new Error("Aggiorna Khuzoe Automations e sincronizza l’NPC per usare la cura da un tipo di danno.");
      if(rule.healing&&!['attack','save','damage'].includes(activities[id].type))throw new Error("La cura dai danni richiede un attacco, un danno o un tiro salvezza.");
    }
  }
}
export function validateNativeAbilityEditDraft(draft,baseline,capabilities={}) {
  if(draft?.version!==1||draft.format!==NATIVE_ABILITY_EDIT_FORMAT||!draft.item||typeof draft.itemId!=="string")throw new Error("Bozza di modifica non valida.");
  if(Object.keys(draft).some(key=>!["version","format","itemId","itemType","base","item","summary","balance","assumptions","unsupported","iconPrompt","capabilities","generatedEffects"].includes(key)))throw new Error("La bozza contiene campi non previsti.");
  if(baseline && (draft.itemId!==baseline._id||draft.itemType!==baseline.type))throw new Error("La bozza riguarda un’altra capacità.");
  for(const key of ["summary","balance","iconPrompt"])if(typeof draft[key]!=="string"||draft[key].length>6000)throw new Error("Descrizione della proposta non valida.");
  for(const key of ["assumptions","unsupported"])if(!Array.isArray(draft[key])||draft[key].length>24||draft[key].some(value=>typeof value!=="string"||value.length>2000))throw new Error("Note della proposta non valide.");
  const base=baseline?nativeAbilityEditProjection(baseline):draft.base;
  if(!base)throw new Error("Manca la capacità originale.");
  if(baseline&&!nativeEqual(draft.base,base))throw new Error("La capacità è cambiata. Conserva la bozza o riparti dalla scheda attuale con una nuova richiesta.");
  const patches=nativeDiff(base,draft.item,"Item",{isAdmin:false,embeddedEffects:true});
  for(const patch of patches) {
    if(!allowed(patch.path))throw new Error(`L’AI non può modificare questo campo: ${patch.path}`);
    if(patch.op==="set")assertData(patch.value,patch.path);
  }
  const original=baseline?nativeEditorSource(baseline,"Item"):{_id:draft.itemId,type:draft.itemType,...base},next=nativeEditorSource(reconcile(original,base,draft.item),"Item");
  const visibleEffects=new Set(base.effects.map(effect=>effect._id));
  for(const effect of original.effects||[])if(!visibleEffects.has(effect._id)&&!nativeEqual(effect,(next.effects||[]).find(value=>value._id===effect._id)))throw new Error("Un effetto gestito da codice deve essere preservato.");
  validateMechanics(next,original,capabilities);
  const actual=nativeDiff({name:original.name,system:original.system,flags:original.flags||{},effects:original.effects||[]},{name:next.name,system:next.system,flags:next.flags||{},effects:next.effects||[]},"Item",{isAdmin:false,embeddedEffects:true});
  if(actual.length)nativeValidateChanges(original,{type:"Item",id:draft.itemId},actual,{isAdmin:false,embeddedEffects:true});
  for(const effect of original.effects||[])if(effect.flags?.['khuzoe-automations']?.npcRule&&!nativeEqual(effect,(next.effects||[]).find(value=>value._id===effect._id)))throw new Error("Modifica le condizioni dagli effetti dell’attività: questo effetto è generato automaticamente.");
  if(new TextEncoder().encode(JSON.stringify(draft)).length>320*1024)throw new Error("Bozza troppo grande.");
  return {...clone(draft),capabilities:clone(capabilities),generatedEffects:(original.effects||[]).filter(effect=>effect.flags?.["khuzoe-automations"]?.npcRule).map(effect=>effect._id),base:clone(base),item:nativeAbilityEditProjection(next)};
}
export function compileNativeAbilityEdit(proposal,baseline,capabilities={}) {
  if(!Array.isArray(proposal?.changes)||proposal.changes.length>256)throw new Error("Modifiche generate non valide.");
  const base=nativeAbilityEditProjection(baseline),item=clone(base),paths=[];
  for(const change of proposal.changes) {
    if(!change||!allowed(change.path)||!['set','delete'].includes(change.op)||typeof change.valueJson!=="string")throw new Error(`Modifica non valida: ${change?.path||""}`);
    if(paths.some(path=>path===change.path||path.startsWith(change.path+'.')||change.path.startsWith(path+'.')))throw new Error("La proposta modifica campi sovrapposti.");
    paths.push(change.path);
    const value=change.op==="set"?JSON.parse(change.valueJson):undefined;
    if(change.op==="set")assertData(value,change.path);
    nativeSet(item,change.path,value,change.op==="delete");
  }
  return validateNativeAbilityEditDraft({version:1,format:NATIVE_ABILITY_EDIT_FORMAT,itemId:baseline._id,itemType:baseline.type,base,item:assignCreatedIds(item,baseline),
    summary:proposal.summary,balance:proposal.balance,assumptions:proposal.assumptions,unsupported:proposal.unsupported,iconPrompt:proposal.iconPrompt},baseline,capabilities);
}
export function nativeAbilityEditChanges(draft,baseline,capabilities={}) {
  baseline=nativeEditorSource(baseline,"Item");
  const checked=validateNativeAbilityEditDraft(draft,baseline,capabilities),base=nativeAbilityEditProjection(baseline),next=reconcile(baseline,base,checked.item);
  return nativeDiff({name:baseline.name,system:baseline.system,flags:baseline.flags||{},effects:baseline.effects||[]},{name:next.name,system:next.system,flags:next.flags||{},effects:next.effects||[]},"Item",{isAdmin:false,embeddedEffects:true});
}
export function nativeAbilityEditSummary(draft) {
  const patches=nativeDiff(draft.base,draft.item,"Item",{isAdmin:false,embeddedEffects:true});
  return [draft.summary,`${patches.length} ${patches.length===1?"campo modificato":"campi modificati"} nella capacità esistente.`].filter(Boolean);
}

export const nativeAbilityEditDiff = draft => nativeDiff(draft.base,draft.item,"Item",{isAdmin:false,embeddedEffects:true});
// Shared by the whole-NPC editor: the same data-only policy and preservation
// of opaque fields apply to manual drafts and AI changes.
export const nativeAiAssertData=assertData;
export const nativeAiMergeFields=reconcile;
