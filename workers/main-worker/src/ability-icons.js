import {avatarReferenceKey} from './avatar-generation.js';
import {generationStopResponse} from './generation-lifecycle.js';
import {abilityIconSubject,abilityIconContext,abilityIconQuality,ABILITY_ICON_PROMPT_VERSION,ABILITY_ICON_MODEL} from './ability-icon-prompt.js';
import {canUseActorOwnerTools,managedAbilityItems,abilityHasPendingCommand} from './managed-ability-tools.js';
import {handleConceptImage,resolveOptionalIconReferences} from './concept-images.js';
import {callActorCard} from './actor-card.js';

const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const fail=(error,status=400)=>reply({ok:false,error},status);
export const iconDescription=item=>JSON.stringify(abilityIconSubject(item));
const fingerprint=item=>JSON.stringify([item._id,item.img||'',iconDescription(item)]);

// Icon-only jobs never pass through the text/ability compiler. The server owns
// the source Item and the single img patch; the client only selects a preview.
export async function handleAbilityIcons(request,route,campaignId,env,services) {
  const user=await services.requireUser(request);
  if(user instanceof Response)return user;
  if(!env.ABILITY_GENERATOR||!env.MEDIA_BUCKET)return fail('Aggiorna il Worker per generare le icone.',503);
  const actor=await services.readActor(campaignId,route);
  if(!await canUseActorOwnerTools(user,actor,campaignId,services))return fail('Solo il DM o il proprietario del personaggio può generare icone.',403);
  const account = services.accountId(user);
  const conceptKey = id => '_private/ability-icon-concepts/' + [campaignId,route.worldId,route.actorId,account,id].map(encodeURIComponent).join('/');
  if(route.action==='concepts') {
    if(!account)return fail('Accedi per usare i riferimenti visivi.',403);
    return handleConceptImage(request,route.uploadId,env.MEDIA_BUCKET,conceptKey);
  }
  const player=actor.actorType!=='npc';
  const native=player?null:await services.readNativeActor?.(campaignId,route);
  const items=player?managedAbilityItems(actor):(native?.snapshot?.actor?.items||[]).filter(item=>['feat','weapon','spell'].includes(item.type));
  const canSync=player?actor.definition?.editor?.version===1:native?.snapshot?.versions?.nativeEditor===1;
  const commands=await (player?services.readCommands?.(campaignId,route):services.readNativeCommands?.(campaignId,route))||[];
  const blocked=item=>abilityHasPendingCommand(commands,item);
  const stub=env.ABILITY_GENERATOR.get(env.ABILITY_GENERATOR.idFromName('ability-generations-v1'));
  const context={campaignId,worldId:route.worldId,actorId:route.actorId,purpose:'ability-icons'};
  const call=(action,data={},itemId)=>stub.fetch(new Request(`https://ability.internal/${action}`,{method:'POST',body:JSON.stringify({...data,context:{...context,...(itemId?{itemId}:{})}})}));
  try {
    if(request.method==='GET'&&!route.action) {
      const response=await call('icon-list',{itemIds:items.map(item=>item._id)}),data=await response.json();
      if(!response.ok||data.abilityIcons!==1)return fail('Il generatore si sta aggiornando. Riprova tra poco.',503);
      if (actor.media?.card?.path) data.cardStatus = 'present';
      else if (env.ACTOR_CARD_GENERATOR) {
        try {
          const result = await callActorCard(env, context, 'latest');
          const {job} = await result.json();
          if (result.ok && job?.automatic) data.cardStatus = job.status;
        } catch { /* Icon previews remain available while the card service restarts. */ }
      }
      return reply({...data,iconDirections:1,referenceOwner:account,enabled:Boolean(env.OPENAI_API_KEY),canSync,hasAvatar:Boolean(avatarReferenceKey(actor.media?.avatar?.path,campaignId)),items:items.map(item=>({
        id:item._id,name:item.name,type:item.type,active:abilityIconQuality(item.type,item.system)==='high',
        img:actor.definition?.items?.find(entry=>entry.itemId===item._id)?.media?.icon?.path||item.img||'',blocked:blocked(item)
      }))});
    }
    const itemId=new URL(request.url).searchParams.get('item');
    const item=items.find(item=>item._id===itemId);
    if(!item)return fail('Capacità non trovata. Aggiorna la scheda.',404);
    if(request.method==='GET'&&route.action==='preview')return call('preview',{id:route.jobId},itemId);
    if(request.method!=='POST')return fail('Operazione non supportata.',405);
    const text=await request.text();
    if(text.length>3*1024*1024)return fail('Richiesta troppo grande.',413);
    let body;try{body=JSON.parse(text);}catch{return fail('Richiesta non valida.');}
    if(!body||typeof body!=='object'||Array.isArray(body))return fail('Richiesta non valida.');
    if(route.action==='stop')return generationStopResponse(await call('stop',{id:route.jobId,attemptId:body.attemptId},itemId));
    if(!canSync)return fail('Sincronizza la scheda completa da Foundry prima di generare le icone.',409);
    if(!route.action) {
      if(!env.OPENAI_API_KEY)return fail('Generazione immagini non attiva.',503);
      if(!/^[a-f0-9-]{36}$/i.test(body.requestId||''))return fail('Identificativo richiesta non valido.');
      if(body.cardBatchId !== undefined && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.cardBatchId))return fail('Identificativo serie non valido.');
      // Capability handshake prevents old coordinators from treating this as
      // a normal ability generation and charging an unwanted text request.
      const available=await call('icon-list',{itemIds:[]}),capabilities=await available.json();
      if(!available.ok||capabilities.abilityIcons!==1)return fail('Il generatore si sta aggiornando. Riprova tra poco.',503);
      // Retrying the same paid request must recover it even if the source changed.
      const existing=await call('icon-existing',{id:body.requestId},itemId);
      if(existing.status!==404)return existing;
      let optionalReferences;
      if(body.references !== undefined) {
        if(!account)return fail('Accedi per usare i riferimenti visivi.',403);
        if(capabilities.optionalIconReferences !== 1)return fail('Aggiorna il generatore per usare i riferimenti visivi.',503);
        optionalReferences = await resolveOptionalIconReferences(body.references,env.MEDIA_BUCKET,conceptKey);
      }
      if((body.details!==undefined&&typeof body.details!=='string')||(typeof body.details==='string'&&body.details.length>1500))return fail('Le indicazioni aggiuntive devono essere un testo di massimo 1500 caratteri.');
      const details=(body.details||'').trim();
      if(capabilities.imageModel!==ABILITY_ICON_MODEL)return fail('Il generatore si sta aggiornando a Sunburst 2.6. Nessuna nuova generazione è stata avviata. Riprova tra poco.',503);
      if(capabilities.iconPromptVersion!==ABILITY_ICON_PROMPT_VERSION)return fail('Il generatore sta aggiornando lo stile delle icone. Nessuna nuova generazione è stata avviata. Riprova tra poco.',503);
      if(blocked(item))return fail('Questa capacità ha modifiche in attesa di Foundry.',409);
      const referenceKey=avatarReferenceKey(actor.media?.avatar?.path,campaignId),reference=referenceKey&&await env.MEDIA_BUCKET.head(referenceKey);
      if(!reference||reference.size>12*1024*1024)return fail('Carica e salva un avatar sulla wiki (massimo 12 MB).');
      const description=iconDescription(item);
      if(description.length>16000)return fail('La descrizione della capacità è troppo estesa per generare l’icona.');
      return call('create',{id:body.requestId,kind:'ability-icon',cardBatchId:body.cardBatchId,details,withIcon:true,draft:{name:item.name,iconPrompt:details},iconQuality:abilityIconQuality(item.type,item.system),iconContext:abilityIconContext(item,items),iconPromptVersion:ABILITY_ICON_PROMPT_VERSION,sourceFingerprint:fingerprint(item),sourceImage:item.img||'',referenceKey,referenceEtag:reference.etag||'',...(optionalReferences?.length && {optionalReferences})},itemId);
    }
    if(route.action!=='confirm')return fail('Operazione non supportata.',405);
    const response=await call('job',{id:route.jobId},itemId);
    if(!response.ok)return response;
    const {job}=await response.json();
    if(job.kind!=='ability-icon')return fail('Generazione non valida.',409);
    if(job.status==='accepted')return reply({ok:true,command:job.command});
    if(job.sourceFingerprint!==fingerprint(item)&&!(job.prepared&&commands.some(c=>c.clientRequestId===job.id)))return fail('La capacità o la sua icona è cambiata. La proposta resta conservata.',409);
    if(abilityHasPendingCommand(commands,item,job.id))return fail('Attendi le modifiche già inviate a questa capacità.',409);
    const prepared=await call('prepare-icon',{id:job.id,icon:body.icon,iconId:body.iconId,mediaOrigin:new URL(request.url).origin},itemId);
    if(!prepared.ok)return prepared;
    const {document}=await prepared.json();
    const queued=player
      ?await services.enqueueItemAi({expectedRevision:actor.revision,kind:'item.update',target:{itemId},patches:[{path:'img',baseValue:job.sourceImage,value:new URL(document.img).pathname.replace(/^\/+/, '')}]},job.id)
      :await services.enqueueNativeEditor({version:1,requestId:job.id,changes:[{target:{type:'Item',id:itemId},patches:[{path:'img',op:'set',baseExists:Object.hasOwn(item,'img'),...(Object.hasOwn(item,'img')?{baseValue:job.sourceImage}:{}),value:document.img}]}]});
    if(!queued.ok) {
      // Validation/conflict rejections performed no queue write. Release the
      // frozen confirmation so a stale preview never prevents a new image.
      if([400,409].includes(queued.status))await call('unprepare-icon',{id:job.id},itemId);
      return queued;
    }
    const result=await queued.json(),command=player?result.command:result.commands?.[0];
    const accepted=await call('accepted',{id:job.id,command},itemId);
    if(!accepted.ok)return accepted;
    return reply({ok:true,command},202);
  }catch(error){return fail(error.message||'Generazione icone non disponibile.');}
}
