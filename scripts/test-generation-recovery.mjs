import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {AvatarGenerationStore} from '../workers/main-worker/src/avatar-generation.js';
import {AbilityGenerationStore} from '../workers/main-worker/src/ability-generation.js';
import {GENERATION_WAIT_MS} from '../workers/main-worker/src/generation-lifecycle.js';
const fixture = await readFile(new URL('./test-ability-generation.mjs', import.meta.url), 'utf8');
const draft = vm.runInNewContext(fixture.slice(fixture.indexOf('const draft ='), fixture.indexOf('const compiled =')) + 'draft');
class Storage {
  values = new Map();
  async get(k) { return structuredClone(this.values.get(k)); }
  async put(k,v) { if (typeof k === 'object') { for (const [key,value] of Object.entries(k)) await this.put(key,value); } else this.values.set(k,structuredClone(v)); }
  async delete(k) { this.values.delete(k); }
  async getAlarm() { return this.alarm || null; }
  async setAlarm(t) { this.alarm = t; }
  async deleteAlarm() { this.alarm = null; }
  async transaction(fn) { return fn(this); }
}
function image(width,height=width) {
  const b = new Uint8Array(30); b.set(Buffer.from('RIFF')); new DataView(b.buffer).setUint32(4,22,true); b.set(Buffer.from('WEBPVP8X'),8); new DataView(b.buffer).setUint32(16,10,true);
  for (let i=0;i<3;i++) { b[24+i] = ((width-1) >>> (i*8)) & 255; b[27+i] = ((height-1) >>> (i*8)) & 255; } return b;
}
const contexts = [{campaignId:'oltre-il-velo',worldId:'world',actorId:'merida'}, {campaignId:'other',worldId:'world',actorId:'npc'}];
const realNow=Date.now, realFetch=globalThis.fetch;
let now=realNow(), calls=0;
Date.now=()=>now;
function fixtureStore(Store) {
  const storage=new Storage(), objects=new Map([['ref.webp',image(1296,2304)]]);
  const env={OPENAI_API_KEY:'fake-no-paid-call',ABILITY_MONTHLY_LIMIT:'100',ABILITY_ICON_MONTHLY_LIMIT:'100', MEDIA_BUCKET:{
    head:async k=>objects.has(k)?{size:objects.get(k).length}:null,
    get:async k=>objects.has(k)?{size:objects.get(k).length,arrayBuffer:async()=>objects.get(k).slice().buffer}:null,
    put:async(k,b)=>objects.set(k,new Uint8Array(b)), delete:async()=>assert.fail('no R2 deletion')
  }};
  return {storage,objects,env,store:new Store({storage},env)};
}
const request=(store,action,context=contexts[0],data={})=>store.fetch(new Request('https://internal/'+action,{method:'POST',body:JSON.stringify({...data,context})}));
async function seed(f,id,status='pending',extra={}) {
  const job={id,context:contexts[0],status,createdAt:new Date(now).toISOString(),referenceKey:'ref.webp',options:{quality:'high',resolution:'high'},details:'Reference',...extra};
  await f.storage.put({['job:'+id]:job,active:id,['latest:oltre-il-velo:world:merida']:id}); return job;
}
function deferredProvider() {
  let resolve, started;
  const response=new Promise(r=>resolve=r), began=new Promise(r=>started=r);
  globalThis.fetch=async()=>{calls++;started();return response;}; return {resolve,began};
}
try {
  // Legacy lock expires on a read, without invoking the paid provider or touching other campaigns.
  const a=fixtureStore(AvatarGenerationStore);
  await seed(a,'legacy','running',{createdAt:new Date(now-GENERATION_WAIT_MS-1).toISOString()});
  globalThis.fetch=async()=>assert.fail('recovery must not generate an image');
  const old=(await (await request(a.store,'latest')).json()).job;
  assert.equal(old.status,'uncertain'); assert.equal(await a.storage.get('active'),undefined);
  assert.equal((await request(a.store,'create',contexts[1],{id:'new-campaign',details:'',options:{quality:'high',resolution:'high'}})).status,202);
  assert.equal(await a.storage.get('active'),'new-campaign');
  const orphan=fixtureStore(AvatarGenerationStore); await orphan.storage.put('active','missing'); await request(orphan.store,'latest');
  assert.equal(await orphan.storage.get('active'),undefined);
  const pending=fixtureStore(AvatarGenerationStore); await seed(pending,'expired-pending','pending',{deadlineAt:now-1}); await pending.store.alarm();
  assert.equal((await pending.storage.get('job:expired-pending')).status,'uncertain');
  // A result already uploaded before a crash is recovered rather than discarded.
  const uploaded=fixtureStore(AvatarGenerationStore); await seed(uploaded,'uploaded','running',{deadlineAt:now-1}); uploaded.objects.set('_private/ai-avatars/uploaded.webp',image(1296,2304));
  assert.equal((await (await request(uploaded.store,'latest')).json()).job.status,'ready');
  // Concurrent reads / duplicate alarms cannot expire a still valid in-flight request.
  const slow=fixtureStore(AvatarGenerationStore); await seed(slow,'slow'); const provider=deferredProvider();
  const execution=slow.store.alarm(); await provider.began; const before=calls;
  await slow.store.alarm(); assert.equal((await slow.storage.get('job:slow')).status,'running'); assert.equal(calls,before);
  now+=GENERATION_WAIT_MS+1; await request(slow.store,'latest');
  await request(slow.store,'create',contexts[1],{id:'next',details:'',options:{quality:'high',resolution:'high'}}); const nextAlarm=slow.storage.alarm;
  provider.resolve(Response.json({data:[{b64_json:Buffer.from(image(1296,2304)).toString('base64')}]})); await execution;
  assert.equal((await slow.storage.get('job:slow')).status,'ready','late paid image remains available');
  assert.equal(await slow.storage.get('active'),'next'); assert.equal(slow.storage.alarm,nextAlarm,'old completion must not delete the newer watchdog');
  // Expired icon preserves the ability, permits manual edits, and late image does not undo them.
  const icon=fixtureStore(AbilityGenerationStore); await seed(icon,'icon','icon-pending',{draft,iconAttempt:'attempt-1',withIcon:true}); const iconProvider=deferredProvider();
  const iconExecution=icon.store.alarm(); await iconProvider.began;
  now+=GENERATION_WAIT_MS+1; const recovered=(await (await request(icon.store,'latest')).json()).job;
  assert.equal(recovered.status,'ready'); assert.equal(recovered.draft.name,draft.name); assert.match(recovered.iconError,/conservata/);
  await request(icon.store,'save',contexts[0],{id:'icon',draft:{...draft,range:15}});
  await request(icon.store,'create',contexts[1],{id:'another',details:'New',withIcon:false}); const iconAlarm=icon.storage.alarm;
  iconProvider.resolve(Response.json({data:[{b64_json:Buffer.from(image(1024)).toString('base64')}]})); await iconExecution;
  const late=await icon.storage.get('job:icon'); assert.equal(late.draft.range,15); assert.equal(late.iconId,'attempt-1'); assert.equal(late.iconError,'');
  assert.equal(await icon.storage.get('active'),'another'); assert.equal(icon.storage.alarm,iconAlarm);
  // A late text result is retained, but does not silently start another paid image request.
  const text=fixtureStore(AbilityGenerationStore); await seed(text,'text','pending',{withIcon:true,iconAttempt:'text'}); const textProvider=deferredProvider();
  const textExecution=text.store.alarm(); await textProvider.began; const textCalls=calls;
  now+=GENERATION_WAIT_MS+1; await request(text.store,'latest');
  textProvider.resolve(Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(draft)}]}]})); await textExecution;
  assert.equal((await text.storage.get('job:text')).status,'ready'); assert.equal(calls,textCalls); assert.equal(await text.storage.get('active'),undefined);
  // Explicit interruption is idempotent, scoped to the job, and aborts only its own request.
  const stop=fixtureStore(AvatarGenerationStore); await seed(stop,'stop'); let began, aborted=false;
  const started=new Promise(r=>began=r);
  globalThis.fetch=async(_url,options)=>new Promise((_resolve,reject)=>{
    calls++; options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Stopped','AbortError'));},{once:true}); began();
  });
  const stoppedExecution=stop.store.alarm(); await started; const callsBeforeStop=calls;
  assert.equal((await request(stop.store,'stop',contexts[1],{id:'stop'})).status,404,'cannot stop another campaign');
  assert.equal((await stop.storage.get('job:stop')).status,'running');
  const stopped=(await (await request(stop.store,'stop',contexts[0],{id:'stop'})).json()).job;
  assert.equal(stopped.status,'uncertain'); assert.match(stopped.error,/Attesa interrotta/); assert.equal(await stop.storage.get('active'),undefined);
  await stoppedExecution; assert.equal(aborted,true); assert.match((await stop.storage.get('job:stop')).error,/Attesa interrotta/);
  await request(stop.store,'stop',contexts[0],{id:'stop'}); await stop.store.alarm(); assert.equal(calls,callsBeforeStop);
  // The ability survives stopping its icon, and a stale tab cannot stop a newer icon attempt.
  const stopIcon=fixtureStore(AbilityGenerationStore); await seed(stopIcon,'stop-icon','icon-pending',{draft,iconAttempt:'new-attempt'});
  assert.equal((await request(stopIcon.store,'stop',contexts[0],{id:'stop-icon',attemptId:'old-attempt'})).status,409);
  assert.equal((await stopIcon.storage.get('job:stop-icon')).status,'icon-pending');
  const stoppedIcon=(await (await request(stopIcon.store,'stop',contexts[0],{id:'stop-icon',attemptId:'new-attempt'})).json()).job;
  assert.equal(stoppedIcon.status,'ready'); assert.equal(stoppedIcon.draft.name,draft.name); assert.match(stoppedIcon.iconError,/conservata/);
  assert.equal(await stopIcon.storage.get('active'),undefined); assert.equal(calls,callsBeforeStop);
  // Stop cannot depend on the same media service that might be stalled.
  const stalledMedia=fixtureStore(AvatarGenerationStore);
  await seed(stalledMedia,'stalled-media','running',{deadlineAt:now-1});
  stalledMedia.env.MEDIA_BUCKET.head=async()=>assert.fail('stop must not wait on R2, even after the deadline');
  assert.equal((await request(stalledMedia.store,'stop',contexts[0],{id:'stalled-media'})).status,200);
  assert.equal(await stalledMedia.storage.get('active'),undefined);
  const stalledIcon=fixtureStore(AbilityGenerationStore);
  await seed(stalledIcon,'stalled-icon','icon-running',{draft,iconAttempt:'latest-attempt',deadlineAt:now-1});
  stalledIcon.env.MEDIA_BUCKET.head=async()=>assert.fail('stop icon must not wait on R2');
  assert.equal((await request(stalledIcon.store,'stop',contexts[0],{id:'stalled-icon',attemptId:'latest-attempt'})).status,200);
  assert.equal((await stalledIcon.storage.get('job:stalled-icon')).draft.name,draft.name);
  assert.equal(await stalledIcon.storage.get('active'),undefined);
  console.log('Generation recovery: expired legacy/pending/orphan locks, uploaded results, live requests, late images/text, preservation of edits and newer locks/alarms passed. No paid calls or world/KV changes.');
} finally {Date.now=realNow;globalThis.fetch=realFetch;}
