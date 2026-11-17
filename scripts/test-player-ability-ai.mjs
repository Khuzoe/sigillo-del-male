import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import worker, { AbilityGenerationStore } from '../workers/main-worker/src/index.js';
import { validateAbilityTranslation } from '../assets/js/shared/ability-translation.mjs';

class Storage {
    values = new Map();
    async get(key) { return structuredClone(this.values.get(key)); }
    async put(key, value) { if (typeof key === 'object') { for (const [k,v] of Object.entries(key)) await this.put(k,v); } else this.values.set(key, structuredClone(value)); }
    async delete(key) { this.values.delete(key); }
    async setAlarm(value) { this.alarm = value; }
    async deleteAlarm() { this.alarm = null; }
    async transaction(fn) { const before = structuredClone(this.values); try { return await fn(this); } catch (error) { this.values = before; throw error; } }
}
function image(size) {
    const bytes = new Uint8Array(30), view = new DataView(bytes.buffer);
    bytes.set(Buffer.from('RIFF')); view.setUint32(4,22,true); bytes.set(Buffer.from('WEBPVP8X'),8); view.setUint32(16,10,true);
    for (const offset of [24,27]) { bytes[offset] = (size-1)&255; bytes[offset+1] = (size-1)>>8; }
    return bytes;
}
const campaign = 'cripta-di-sangue', world = 'player-ai', actorId = 'own-pc', itemId = 'Ability000000001', spellId = 'Spell00000000001';
const base = `api/managed-actors/${world}/${actorId}`, translations = `${base}/ability-translations`, icons = `${base}/ability-icons`;
const actorKey = `campaign:${campaign}:managed-actor:${world}:${actorId}`, queueKey = `campaign:${campaign}:managed-actor-commands:${world}`;
const secret = 'local-owner-ai', storage = new Storage(), kv = new Map(), objects = new Map();
const avatarKey = `campaigns/${campaign}/managed-actors/${world}/${actorId}/base/avatar.webp`; objects.set(avatarKey,image(1024));
const source = { name:'Arcane Strike', description:'<p>Deal 2d6 fire damage within 30 feet. DC 15. [[/r 2d6]] @UUID[Item.ABC]{Fire}</p>' };
const proposed = { name:'Colpo Arcano', description:'<p>Infligge 2d6 danni da fuoco entro 30 piedi. CD 15. [[/r 2d6]] @UUID[Item.ABC]{Fuoco}</p>' };
assert.deepEqual(validateAbilityTranslation(proposed,source),proposed);
for (const description of [proposed.description.replace('2d6','3d6'),proposed.description.replace('30 piedi','30 metri'),proposed.description.replace('Item.ABC','Item.EVIL'),proposed.description.replace('<p>','<p onclick="evil()">'),proposed.description+'<img src="evil">',proposed.description.replace('CD 15','CA 15')]) assert.throws(() => validateAbilityTranslation({...proposed,description},source));
assert.throws(() => validateAbilityTranslation({...proposed,system:{damage:'99d99'}},source));
const actor = { actorId,worldId:world,campaignId:campaign,foundryActorId:'Actor00000000001',actorType:'character',name:'Eroe',revision:3,ownerAccountIds:['player'],visibility:{state:'public'},
    definition:{ editor:{version:1},attributes:{hp:{value:30,max:30}},items:[
        {itemId,type:'feat',name:source.name,definition:{img:'icons/strike.webp',description:source.description,damage:{parts:[['2d6','fire']]},flags:{private:'PRIVATE-ITEM-DATA'}}},
        {itemId:spellId,type:'spell',name:'Magic Shield',definition:{img:'icons/shield.webp',description:'<p>Gain 2 AC.</p>',level:1}},
        {itemId:'Coin000000000001',type:'loot',name:'Coin'}]},
    media:{avatar:{path:`media/${avatarKey}`,revision:1}},site:{dmNotes:'PRIVATE-DOSSIER'} };
kv.set(actorKey,JSON.stringify(actor));
const env = {JWT_SECRET:secret,INVENTORY_SYNC_SECRET:secret,GLOBAL_ADMIN_ACCOUNT_IDS:'admin',CAMPAIGN_EDITOR_ACCOUNT_IDS:`${campaign}:dm`,OPENAI_API_KEY:'fake-no-live-calls',
    SIGILLO_KV:{async get(k){return kv.get(k)??null;},async put(k,v){kv.set(k,v);},async delete(k){kv.delete(k);}},
    MEDIA_BUCKET:{async head(k){const b=objects.get(k);return b?{size:b.length,etag:k}:null;},async get(k){const b=objects.get(k);return b?{size:b.length,etag:k,body:new Blob([b]).stream(),arrayBuffer:async()=>b.slice().buffer}:null;},async put(k,b){objects.set(k,new Uint8Array(b));}}};
let coordinator = new AbilityGenerationStore({storage},env);
env.ABILITY_GENERATOR = {idFromName:n=>n,get:()=>({fetch:r=>coordinator.fetch(r)})};
const auth = account => {
    const data = [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({accountId:account,username:account,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')].join('.');
    return `${data}.${createHmac('sha256',secret).update(data).digest('base64url')}`;
};
async function call(path,body,account='player',item=itemId,targetCampaign=campaign) {
    const url = new URL(`https://local.test/${path}`); url.searchParams.set('campaign',targetCampaign); if(item)url.searchParams.set('item',item);
    const headers = account === 'foundry' ? {'X-Cripta-Inventory-Secret':secret,'X-Khuzoe-Sync-Contract':'1','X-Khuzoe-Foundry-Generation':'14'} : account ? {Authorization:`Bearer ${auth(account)}`} : {};
    const response = await worker.fetch(new Request(url,{headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})}),env,{waitUntil(p){p.catch(()=>{});}});
    return {status:response.status,body:response.headers.get('Content-Type')?.includes('json')?await response.json():new Uint8Array(await response.arrayBuffer())};
}
for(const endpoint of [icons,translations]) {
    assert.equal((await call(endpoint,undefined,null)).status,401);
    assert.equal((await call(endpoint,undefined,'viewer')).status,403);
    assert.equal((await call(endpoint,{requestId:randomUUID(),permissions:{isOwner:true},ownerAccountIds:['viewer']},'viewer')).status,403);
    assert.equal((await call(endpoint,undefined,'player',itemId,'mago-folle')).status,403);
    assert.equal((await call(endpoint)).status,200);
    assert.equal((await call(endpoint,undefined,'dm')).status,200);
    const npc = {...actor,actorType:'npc'}; kv.set(actorKey,JSON.stringify(npc));
    assert.equal((await call(endpoint)).status,403,'NPC companion ownership does not grant campaign AI access'); kv.set(actorKey,JSON.stringify(actor));
}
assert.deepEqual((await call(icons)).body.items.map(item=>item.id),[itemId,spellId]);
assert.equal((await call(`${base}/ability-generation`)).status,403);
assert.equal((await call(`${base}/ability-generation?editor=npc-native-sheet-edit-v1`)).status,403);
assert.equal((await call(`${base}/avatar-generation`)).status,403);
const binding = env.ABILITY_GENERATOR;
env.ABILITY_GENERATOR={idFromName:n=>n,get:()=>({fetch:async()=>Response.json({ok:true,job:null})})};
assert.equal((await call(translations,{requestId:randomUUID()})).status,503); env.ABILITY_GENERATOR=binding;
let requests=[],malformed=false,providerError=false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url,options) => {
    const body=JSON.parse(options.body); requests.push({url,body});
    assert.ok(!JSON.stringify(body).includes('PRIVATE-'),'Private flags and dossier never enter an AI prompt');
    if(providerError)return Response.json({error:{code:'rate_limit_exceeded'}},{status:429});
    if(url==='https://api.openai.com/v1/images/edits')return Response.json({data:[{b64_json:Buffer.from(image(1024)).toString('base64')}]});
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.deepEqual(JSON.parse(body.input),source,'Text-only request sends only this ability, without the character sheet');
    return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(malformed?{...proposed,description:proposed.description.replace('2d6','7d6')}:proposed)}]}]});
};
const clearQueue=()=>kv.delete(queueKey);
try {
    const id=randomUUID();
    assert.equal((await call(translations,{requestId:id})).status,202);
    assert.equal((await call(translations,{requestId:id})).body.job.id,id);
    assert.equal((await call(`${translations}/${id}/confirm`,{})).status,409);
    assert.equal((await call(icons,{requestId:randomUUID()},'player',spellId)).status,409,'Icons and translation share the paid lock');
    await coordinator.alarm(); assert.equal(requests.length,1);
    assert.deepEqual((await call(translations)).body.jobs[0].draft,proposed);
    assert.equal((await call(icons)).body.jobs.length,0,'Scopes keep text and image jobs separate');
    assert.equal(kv.get(actorKey),JSON.stringify(actor)); assert.equal(kv.has(queueKey),false,'Preview does not mutate the actor or enqueue');
    assert.equal((await call(`${translations}/${id}/confirm`,{},'viewer')).status,403);
    assert.equal((await call(`${translations}/${id}/confirm`,{},'player',spellId)).status,404);
    const revocation={...actor,ownerAccountIds:['other']};kv.set(actorKey,JSON.stringify(revocation));
    assert.equal((await call(translations)).status,403);assert.equal((await call(`${translations}/${id}/confirm`,{})).status,403);kv.set(actorKey,JSON.stringify(actor));
    const changed=structuredClone(actor);changed.definition.items[0].definition.description='<p>New rules.</p>';kv.set(actorKey,JSON.stringify(changed));
    assert.equal((await call(`${translations}/${id}/confirm`,{})).status,409);kv.set(actorKey,JSON.stringify(actor));
    const beforePrepared=await storage.get(`job:${id}`);
    delete env.OPENAI_API_KEY;
    const confirmed=await call(`${translations}/${id}/confirm`,{draft:{name:'Hacked',description:'99d99'},system:{hp:999}});
    assert.equal(confirmed.status,202,JSON.stringify(confirmed.body));
    assert.deepEqual(confirmed.body.command.patches.map(p=>p.path),['name','system.description.value']);
    assert.equal(confirmed.body.command.patches[1].value,proposed.description);
    assert.equal(confirmed.body.command.patches[1].baseValue,source.description);
    assert.equal((await call(`${translations}/${id}/confirm`,{})).body.command.id,confirmed.body.command.id);
    assert.equal(JSON.parse(kv.get(queueKey)).commands.length,1);
    // Simulate lost accepted-state persistence: frozen confirmation recovers
    // the original command without merging, reissuing or charging.
    const readyAgain={...beforePrepared,status:'confirming',prepared:{patches:confirmed.body.command.patches}};await storage.put(`job:${id}`,readyAgain);
    assert.equal((await call(`${translations}/${id}/confirm`,{})).body.command.id,confirmed.body.command.id);
    assert.equal(JSON.parse(kv.get(queueKey)).commands.length,1);
    env.OPENAI_API_KEY='fake-no-live-calls';clearQueue();
    const iconId=randomUUID();assert.equal((await call(icons,{requestId:iconId},'player',spellId)).status,202);await coordinator.alarm();
    assert.equal((await call(`${icons}/${iconId}/preview`,undefined,'viewer',spellId)).status,403);
    assert.equal((await call(`${icons}/${iconId}/preview`,undefined,'player',spellId)).status,200);
    const iconResult=await call(`${icons}/${iconId}/confirm`,{iconId,icon:Buffer.from(image(512)).toString('base64'),name:'Hacked'},'player',spellId);
    assert.equal(iconResult.status,202,JSON.stringify(iconResult.body));
    assert.deepEqual(iconResult.body.command.patches.map(p=>p.path),['img']);assert.equal(iconResult.body.command.target.itemId,spellId);
    assert.equal((await call(`${icons}/${iconId}/confirm`,{},'player',spellId)).body.command.id,iconResult.body.command.id);
    const ack = await call(`api/managed-actor-commands/${world}/ack`,{results:[{id:iconResult.body.command.id,status:'applied'}]},'foundry');
    assert.equal(ack.status,200,JSON.stringify(ack.body));
    assert.equal(JSON.parse(kv.get(queueKey)).commands.length,0);
    assert.equal((await call(`${icons}/${iconId}/confirm`,{},'player',spellId)).body.command.id,iconResult.body.command.id,'Confirming after Foundry ACK never queues the same icon twice');
    assert.equal(JSON.parse(kv.get(queueKey)).commands.length,0);
    assert.equal(kv.get(actorKey),JSON.stringify(actor));clearQueue();
    // Ordinary pending commands (without AI ids) must also block spend.
    kv.set(queueKey,JSON.stringify({commands:[{id:'manual',actorId,kind:'item.update',status:'pending',target:{itemId}}]}));
    for(const endpoint of [translations,icons])assert.equal((await call(endpoint,{requestId:randomUUID()})).status,409);
    assert.equal((await call(translations)).body.items[0].blocked,true);clearQueue();
    malformed=true;const invalid=randomUUID();await call(translations,{requestId:invalid});await coordinator.alarm();
    assert.equal((await call(translations)).body.jobs.find(j=>j.id===invalid).status,'uncertain');
    assert.equal((await call(`${translations}/${invalid}/confirm`,{})).status,409);assert.equal(kv.has(queueKey),false);
    const count=requests.length;await coordinator.alarm();assert.equal(requests.length,count,'Malformed output never triggers a paid retry');
    malformed=false;providerError=true;const errorId=randomUUID();await call(translations,{requestId:errorId});await coordinator.alarm();
    const failed=(await call(translations)).body.jobs.find(j=>j.id===errorId);assert.equal(failed.errorDetail.code,'rate_limit');
    providerError=false;
    const stopped=randomUUID();await call(translations,{requestId:stopped});await call(`${translations}/${stopped}/stop`,{attemptId:stopped});
    const before=requests.length;await coordinator.alarm();assert.equal(requests.length,before);
    coordinator=new AbilityGenerationStore({storage},env);
    assert.equal((await call(translations)).body.jobs.find(j=>j.id===stopped).status,'uncertain','Draft state survives coordinator restarts');
    assert.equal(kv.get(actorKey),JSON.stringify(actor));
} finally {globalThis.fetch=originalFetch;}
console.log('Player ability AI: canonical ownership, role and campaign isolation, icon-only patches, protected text translations, explicit confirmation, stale sources, revocation, idempotent retries, recovery and provider errors passed. No live AI calls.');
