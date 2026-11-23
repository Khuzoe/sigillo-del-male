import {nativeGet,nativeEqual} from './npc-native-model.mjs';

const textPath=path=>path==='name'||path==='description'||/^system\.details\.alignment$/.test(path)||/\.(?:description|biography)\.(?:value|public|chat|chatFlavor|unidentified)$/.test(path);
// Strict structured output requires named object properties. Encode dynamic
// Foundry keys as entries, with native arrays and scalars at every depth.
const valueRef={$ref:'#/$defs/fieldValue'};
export const NPC_AI_VALUE_SCHEMA={anyOf:[
 {type:'string'},{type:'number'},{type:'boolean'},{type:'null'},
 {type:'array',items:valueRef},
 {type:'object',properties:{entries:{type:'array',items:{type:'object',properties:{key:{type:'string'},value:valueRef},required:['key','value'],additionalProperties:false}}},required:['entries'],additionalProperties:false}
]};
function unpack(value,path,depth=0){
 if(depth>32)throw new Error(`${path}: struttura troppo profonda.`);
 if(value===null||['string','number','boolean'].includes(typeof value))return value;
 if(Array.isArray(value))return value.map(child=>unpack(child,path,depth+1));
 if(!value||Object.keys(value).length!==1||!Array.isArray(value.entries))throw new Error(`${path}: oggetto strutturato non valido.`);
 const keys=new Set(),pairs=[];
 for(const field of value.entries){
  if(!field||typeof field.key!=='string'||!field.key||!Object.hasOwn(field,'value')||keys.has(field.key)||['__proto__','constructor','prototype'].includes(field.key))throw new Error(`${path}: campo duplicato o non valido.`);
  keys.add(field.key);pairs.push([field.key,unpack(field.value,path,depth+1)]);
 }
 return Object.fromEntries(pairs);
}
export class NpcAiJsonError extends Error {}

function parseLegacyJson(text){
 try{return JSON.parse(text);}catch{
  // Retain quoted strings verbatim, including punctuation inside descriptions
  // and formulas. Repair only presentation wrappers and trailing separators.
  const fenced=text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/i);
  const body=(fenced?.[1]??text).trim();
  const clean=body.replace(/"(?:\\[\s\S]|[^"\\])*"|,\s*(?=[}\]])/g,(token,index)=>{
   if(token.startsWith('"'))return token;
   let prior=index-1;while(prior>=0&&/\s/.test(body[prior]))prior--;
   return prior>=0&&!'[{:,'.includes(body[prior])?'':token;
  });
  return JSON.parse(clean);
 }
}
export function decodeNpcAiValue(change,original={}) {
 if(change.op==='delete')return undefined;
 const path=change.path,encoded=change.valueJson;
 const originalValue=nativeGet(original,path),map=path==='system.activities'||/^system\.activities\.[^.]+$/.test(path);
 if(!Object.hasOwn(change,'valueJson')&&Object.hasOwn(change,'value')){
  let value=unpack(change.value,path);
  if(map&&typeof value==='string'){
   try{value=parseLegacyJson(value);}catch{throw new NpcAiJsonError(`${path}: il testo delle attività non è JSON valido.`);}
  }
  if(map&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error(`${path}: indica un oggetto di attività strutturato.`);
  return value;
 }
 if(typeof encoded!=='string')throw new Error(`${path}: formato del valore non valido.`);
 if(Object.hasOwn(change,'value')&&encoded===''){
  if(change.value!==null&&typeof change.value==='object')throw new Error(`${path}: usa valueJson per oggetti ed elenchi.`);
  return structuredClone(change.value);
 }
 if(Object.hasOwn(change,'value')&&change.value!==null)throw new Error(`${path}: specifica un solo valore.`);
 try{
  let value=parseLegacyJson(encoded);
  if(typeof value==='string'&&(map||originalValue&&typeof originalValue==='object'))value=parseLegacyJson(value);
  if(path==='system.activities'&&Array.isArray(value)){
   // Older proposals also carried activity arrays. The compiler resolves their
   // existing IDs and aliases from these indexed entries, as it did at creation.
   value=Object.fromEntries(value.entries());
  }
  if(map&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error();
  return value;
 }catch{
  if((typeof originalValue==='string'||textPath(path))&&!/^\s*[[{"]/.test(encoded))return encoded;
  throw new NpcAiJsonError(`${path}: il valore strutturato non è JSON valido. La proposta originale è conservata.`);
 }
}
export function validateNpcDomainFields(before,after,type) {
 const numeric=(path,{min=0,max=Infinity,integer=false,nullable=false}={})=>{
  const value=nativeGet(after,path);if(nativeEqual(value,nativeGet(before,path))||value===undefined)return;
  if(value===null&&nullable)return;
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||integer&&!Number.isInteger(value))throw new Error(`${path}: inserisci ${integer?'un intero':'un numero'} ${min===0&&!Number.isFinite(max)?'non negativo':Number.isFinite(min)&&Number.isFinite(max)?`tra ${min} e ${max}`:'valido'}${nullable?' oppure null':''}.`);
 };
 if(type==='Actor'){
  for(const field of ['value','max','temp'])numeric(`system.attributes.hp.${field}`,{nullable:true,integer:true});
  numeric('system.attributes.hp.tempmax',{nullable:true,integer:true,min:-Infinity});
  numeric('system.attributes.ac.flat',{nullable:true,integer:true});
  numeric('system.details.cr',{nullable:true});
  for(const sense of Object.keys(nativeGet(after,'system.attributes.senses.ranges')||{}))numeric(`system.attributes.senses.ranges.${sense}`,{nullable:true,integer:true});
  for(const key of ['str','dex','con','int','wis','cha'])numeric(`system.abilities.${key}.value`,{integer:true});
  const alignment=nativeGet(after,'system.details.alignment');if(alignment!==undefined&&!nativeEqual(alignment,nativeGet(before,'system.details.alignment'))&&typeof alignment!=='string')throw new Error('system.details.alignment: è richiesto un testo.');
  const communication=nativeGet(after,'system.traits.languages.communication');
  if(!nativeEqual(communication,nativeGet(before,'system.traits.languages.communication'))&&communication!==undefined){
   if(!communication||typeof communication!=='object'||Array.isArray(communication))throw new Error('system.traits.languages.communication: sono richieste comunicazioni con distanza e unità.');
   for(const [key,value]of Object.entries(communication)){
    const path=`system.traits.languages.communication.${key}`;if(nativeEqual(value,nativeGet(before,path)))continue;
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${path}: indica distanza e unità, per esempio {value:120,units:"ft"}.`);
    numeric(`${path}.value`,{nullable:true});if(value.value!==null&&typeof value.value!=='number'||typeof value.units!=='string'||!value.units.trim())throw new Error(`${path}: indica una distanza numerica o null e un’unità di misura.`);
   }
  }
  for(const key of ['walk','burrow','climb','fly','swim','bonus','special']){
   const path=`system.attributes.movement.${key}`,value=nativeGet(after,path);if(value===undefined||nativeEqual(value,nativeGet(before,path)))continue;
   if(typeof value!=='string')throw new Error(`${path}: inserisci un testo o una formula di movimento.`);
  }
  const hover=nativeGet(after,'system.attributes.movement.hover');if(hover!==undefined&&!nativeEqual(hover,nativeGet(before,'system.attributes.movement.hover'))&&typeof hover!=='boolean')throw new Error('system.attributes.movement.hover: è richiesto un valore booleano.');
 }else if(type==='Item'){
  numeric('system.quantity',{integer:true});numeric('system.level',{max:9,integer:true});numeric('system.uses.spent');
 }
}
