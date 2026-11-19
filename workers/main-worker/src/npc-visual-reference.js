import {GenerationError} from './ai-generation-errors.js';

export const NPC_SHEET_VISUAL_INPUT_VERSION=1;
export const NPC_AVATAR_MAX_BYTES=12*1024*1024;

// Read the campaign-scoped R2 key captured by the authenticated route. Image
// bytes stay transient: jobs retain only the key and ETag, never the data URL.
export async function npcVisualReferenceInput(job,env,detail='low'){
 const source=await env.MEDIA_BUCKET?.get(job.referenceKey);
 if(!source||source.size>NPC_AVATAR_MAX_BYTES||(job.referenceEtag&&source.etag!==job.referenceEtag))throw new GenerationError('reference_changed','L’avatar di riferimento non è disponibile o è cambiato. Riapri la scheda prima di richiedere una nuova proposta.');
 const bytes=new Uint8Array(await source.arrayBuffer());
 if(!bytes.length||bytes.length>NPC_AVATAR_MAX_BYTES)throw new GenerationError('reference_changed','L’avatar di riferimento non è disponibile o supera 12 MB. Salva un avatar valido prima di richiedere una nuova proposta.');
 let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
 const mime=/\.png$/i.test(job.referenceKey)?'image/png':/\.jpe?g$/i.test(job.referenceKey)?'image/jpeg':'image/webp';
 return {type:'input_image',image_url:`data:${mime};base64,${btoa(raw)}`,detail};
}
