const SHEET_FORMAT="npc-native-sheet-edit-v1",MARKER="npc-sheet-job-chunks-v1";
export const MAX_SHEET_JOB_BYTES=2*1024*1024;
// Existing jobs retain their storage layout. Whole-sheet jobs are split into
// private, transactional parts rather than being truncated at DO's value limit.
export function npcSheetJobStorage(raw,inTransaction=false){
  const get=async key=>{
    const value=await raw.get(key);
    if(value?.storageFormat!==MARKER)return value;
    if(typeof key!=="string"||!key.startsWith('job:')||!Number.isInteger(value.parts)||value.parts<1||value.parts>160)throw new Error("Archivio della proposta non valido.");
    const parts=await Promise.all(Array.from({length:value.parts},(_,i)=>raw.get(`${key}:sheet-part:${i}`)));
    if(parts.some(part=>typeof part!=="string"))throw new Error("La proposta è incompleta nell’archivio. Nessuna modifica è stata inviata.");
    const text=parts.join('');if(new TextEncoder().encode(text).length!==value.bytes)throw new Error("La proposta non corrisponde all’archivio.");
    return JSON.parse(text);
  };
  async function put(key,value){
    if(key&&typeof key==='object'){for(const [name,entry]of Object.entries(key))await put(name,entry);return;}
    if(typeof key!=='string'||!key.startsWith('job:')||value?.format!==SHEET_FORMAT)return raw.put(key,value);
    const text=JSON.stringify(value),bytes=new TextEncoder().encode(text).length;if(bytes>MAX_SHEET_JOB_BYTES)throw new Error("La proposta supera il limite di archiviazione: nessun dato è stato troncato.");
    if(!inTransaction)return raw.transaction(tx=>npcSheetJobStorage(tx,true).put(key,value));
    const parts=[];for(let start=0;start<text.length;){let end=Math.min(start+16000,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;parts.push(text.slice(start,end));start=end;}
    for(let i=0;i<parts.length;i++)await raw.put(`${key}:sheet-part:${i}`,parts[i]);
    await raw.put(key,{storageFormat:MARKER,parts:parts.length,bytes});
  }
  const result={get,put,delete:key=>raw.delete(key),transaction:fn=>raw.transaction(tx=>fn(npcSheetJobStorage(tx,true))),setAlarm:value=>raw.setAlarm(value),deleteAlarm:()=>raw.deleteAlarm()};
  if(raw.getAlarm)result.getAlarm=()=>raw.getAlarm();return result;
}
