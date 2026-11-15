import {nativeGet,nativeEqual} from './npc-native-model.mjs';

const textPath=path=>path==='name'||path==='description'||/^system\.details\.alignment$/.test(path)||/\.(?:description|biography)\.(?:value|public|chat|chatFlavor|unidentified)$/.test(path);
// Scalars travel as native JSON values. valueJson remains only for structured
// values and older proposals, which can be recovered without another AI call.
export const NPC_AI_VALUE_SCHEMA={type:['string','number','boolean','null']};
export function decodeNpcAiValue(change,original={}) {
 if(change.op==='delete')return undefined;
 const path=change.path,encoded=change.valueJson;
 if(typeof encoded!=='string')throw new Error(`${path}: formato del valore non valido.`);
 if(Object.hasOwn(change,'value')&&encoded===''){
  if(change.value!==null&&typeof change.value==='object')throw new Error(`${path}: usa valueJson per oggetti ed elenchi.`);
  return structuredClone(change.value);
 }
 if(Object.hasOwn(change,'value')&&change.value!==null)throw new Error(`${path}: specifica un solo valore.`);
 try{return JSON.parse(encoded);}catch{
  if((typeof nativeGet(original,path)==='string'||textPath(path))&&!/^\s*[[{"]/.test(encoded))return encoded;
  throw new Error(`${path}: il valore strutturato non è JSON valido. La proposta originale è conservata.`);
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
