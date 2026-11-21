import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import worker from '../workers/main-worker/src/index.js';
import {activityAnimationPreviews, prepareActivityAnimationPatches} from '../workers/main-worker/src/activity-animations.js';
import {animationPaths, MAX_ANIMATION_BYTES} from '../assets/js/shared/npc-activity-animation.mjs';
import {animationWithFile, appendAnimationControls} from '../assets/js/shared/npc-animation-editor.mjs';
import {repairAnimationMenu} from '../assets/js/shared/npc-animation-config.mjs';
import {hashNpcBytes} from '../integrations/cripta-wiki-sync/npc-native-snapshot.mjs';
import {applyLegacySiteAudio, exportNpcAnimations, installNpcAnimations} from '../integrations/cripta-wiki-sync/activity-animation-sync.mjs';
import {nativeApply, nativeDiff, nativeSet, nativeValidateChanges} from '../assets/js/shared/npc-native-model.mjs';

const campaign='cripta-di-sangue', world='il-sigillo-del-male', actor='qfqeufrl9j3txqxa';
const origin='https://wiki.test', endpoint=`${origin}/api/managed-actors/${world}/${actor}/activity-animations?campaign=${campaign}`;
const headers=()=>({'X-Cripta-Inventory-Secret':'test','X-Khuzoe-Sync-Contract':'1','X-Khuzoe-Foundry-Generation':'14'});
const objects=new Map(), files=new Map(), directories=new Set([`worlds/${world}`]);
let writes=0;
const bucket={
  async head(key) {return objects.has(key) ? {size:objects.get(key).length,httpEtag:'"'+key.split('/').at(-1)+'"'} : null;},
  async put(key,bytes) {writes++;objects.set(key,bytes.slice());},
  async get(key,{range}={}) {const bytes=objects.get(key);return bytes ? {body:range ? bytes.slice(range.offset,range.offset+range.length) : bytes} : null;}
};
const actorKey=`campaign:${campaign}:managed-actor:${world}:${actor}`;
const env={MEDIA_BUCKET:bucket,INVENTORY_SYNC_SECRET:'test',JWT_SECRET:'local-test',CAMPAIGN_EDITOR_ACCOUNT_IDS:`${campaign}:dm`,
  SIGILLO_KV:{async get(key){return key===actorKey ? JSON.stringify({actorType:'npc',relationshipType:'companion',ownerAccountIds:['owner']}) : null;}}};
const request=(url,init)=>worker.fetch(new Request(url,init),env,{waitUntil(){}});
const context={campaign,world,actor,origin,endpoint,headers,request,allowUpload:true,resolve:path=>origin+'/'+path};
const upload=(bytes,extra={})=>request(endpoint,{method:'POST',headers:{...headers(),'Content-Type':'video/webm',...extra},body:bytes});
function siteUpload(bytes, account, target=endpoint) {
  const jwt=[{alg:'HS256',typ:'JWT'},{accountId:account,username:account,exp:Math.floor(Date.now()/1000)+300}].map(part=>Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
  const token=jwt+'.'+createHmac('sha256',env.JWT_SECRET).update(jwt).digest('base64url');
  return request(target,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'video/webm'},body:bytes});
}
const webmHeader = [0x1a,0x45,0xdf,0xa3,0x87,0x42,0x82,0x84,0x77,0x65,0x62,0x6d];
const segmentHeader = [0x18,0x53,0x80,0x67,0x01,255,255,255,255,255,255,255];
const videoEntry = [0xae,0x83,0x83,0x81,1], audioEntry = [0xae,0x84,0x83,0x82,0,2];
const sample = entries => Uint8Array.from([...webmHeader,...segmentHeader,0x16,0x54,0xae,0x6b,0x80+entries.length,...entries]);
const original=process.argv[2] ? new Uint8Array(await readFile(process.argv[2])) : sample([...videoEntry,...audioEntry]);
const digest=await hashNpcBytes(original);
assert.equal(await hashNpcBytes(original,null),digest);
const path='Cripta%20di%20Sangue/tiles/pugno-mano-rossa.webm';
files.set(path,original);
const realItem=process.argv[3] ? JSON.parse(await readFile(process.argv[3],'utf8')) : undefined;
const id='20a62e0b96e10466', base={_id:id,name:'Colpo del Demone',type:'attack',attack:{type:{value:'melee'}},flags:{otherModule:{untouched:true}}};
base.flags.autoanimations=animationWithFile(base,base.name,path);
const item=realItem || {name:base.name,type:'feat',system:{activities:{[id]:base}}};
const activity=item.system.activities[id], originalItem=structuredClone(item);
for (const [type, attackType, menu] of [['attack','melee','melee'],['attack','ranged','range'],['utility',null,'ontoken']]) {
  const fresh = animationWithFile({type,attack:{type:{value:attackType}}},'Test',path);
  assert.equal(fresh.menu,menu);
  assert.equal(fresh.primary.video.customPath,path);
  for (const section of ['primary','source','target','secondary',...(menu==='melee'?['meleeSwitch']:[])]) {
    assert.ok(fresh[section].video.animation && fresh[section].video.dbSection);
    assert.ok(fresh[section].sound && fresh[section].options);
  }
  assert.equal(fresh.meleeSwitch?.options.switchType,menu==='melee'?'off':undefined);
  assert.equal(repairAnimationMenu(fresh),fresh);
}
// The old website stored this shape. AA mounts MeleeSwitch and all three
// auxiliary VideoSelect components even with switchType off / enable false.
const legacy = {menu:'melee',version:5,isCustomized:true,
  primary:{video:{...activity.flags.autoanimations.primary.video},options:{repeat:3,repeatDelay:0},sound:{enable:true,volume:0}},
  meleeSwitch:{options:{switchType:'off'}}, secondary:{enable:false}, source:{enable:false}, target:{enable:false},
  macro:{enable:false}, soundOnly:{sound:{enable:false}}, thirdParty:{keep:'original'}};
const initialLegacy=structuredClone(legacy), healed=repairAnimationMenu(legacy);
assert.deepEqual(legacy,initialLegacy);
assert.deepEqual(healed.primary,legacy.primary);
assert.deepEqual(healed.thirdParty,legacy.thirdParty);
assert.equal(healed.meleeSwitch.video.animation,'arrow');
assert.equal(healed.meleeSwitch.options.switchType,'off');
assert.equal(healed.secondary.video.animation,'curewounds');
assert.equal(healed.source.options.isWait,true);
assert.equal(healed.target.options.persistent,false);
assert.equal(repairAnimationMenu(healed),healed);
for(const menu of ['templatefx','aura','preset']) {
  const untouched={...legacy,menu};assert.equal(repairAnimationMenu(untouched),untouched);
}
const replacementConfig=animationWithFile({flags:{autoanimations:legacy}},'Test','new.webm');
assert.deepEqual(replacementConfig.meleeSwitch,healed.meleeSwitch);
const entry={definition:{activities:item.system.activities}};
globalThis.fetch=async url=>files.has(url) ? new Response(files.get(url)) : new Response(null,{status:404});
globalThis.foundry={utils:{getRoute:s=>s},applications:{apps:{FilePicker:{implementation:{
  async browse(_,parent){assert.ok(directories.has(parent));return {dirs:[...directories]};},
  async createDirectory(_,dir){directories.add(dir);},
  async upload(_,dir,file){const dest=`${dir}/${file.name}`;files.set(dest,new Uint8Array(await file.arrayBuffer()));return {path:dest};}
}}}}};

assert.equal((await request(endpoint,{method:'POST',headers:{'Content-Type':'video/webm'},body:original})).status,401);
assert.equal((await upload(original,{'Content-Type':'image/webp'})).status,415);
assert.equal((await upload(new Uint8Array([1,2,3]))).status,415);
assert.equal((await upload(original,{'Content-Length':String(MAX_ANIMATION_BYTES+1)})).status,413);
assert.equal((await siteUpload(original,'other')).status,403);
assert.equal((await siteUpload(original,'owner',endpoint.replace(actor,'other-actor'))).status,403);
assert.equal(writes,0);
await exportNpcAnimations([entry],context);
const paths=animationPaths(campaign,world,actor,digest);
assert.deepEqual(entry.media.animations[id],{source:path,path:paths.path});
assert.deepEqual(item,originalItem);
await exportNpcAnimations([entry],context);
assert.equal(writes,1);
const media=origin+'/'+paths.path;
assert.equal((await request(media,{method:'HEAD'})).headers.get('Content-Length'),String(original.length));
const partial=await request(media,{headers:{Range:'bytes=1-5'}});
assert.equal(partial.status,206);
assert.deepEqual(new Uint8Array(await partial.arrayBuffer()),original.slice(1,6));
assert.equal((await request(media,{headers:{Range:'bytes=-4'}})).headers.get('Content-Range'),`bytes ${original.length-4}-${original.length-1}/${original.length}`);
assert.equal((await request(media,{headers:{Range:'bytes=99999999-'}})).status,416);
const full=await request(media);
assert.equal(full.headers.get('Content-Type'),'video/webm');
assert.equal(full.headers.get('Access-Control-Allow-Origin'),'*');
assert.deepEqual(new Uint8Array(await full.arrayBuffer()),original);

// Same Foundry filename, different bytes: keep both revisions independently accessible.
const replacement=new Uint8Array(original.length+2);
replacement.set(original);replacement.set([0xec,0x80],original.length);
files.set(path,replacement);
await exportNpcAnimations([entry],context);
assert.notEqual(entry.media.animations[id].path,paths.path);
assert.equal((await siteUpload(replacement,'owner')).status,200);
const saved=await (await siteUpload(replacement,'dm')).json();
assert.equal(writes,2);
assert.equal(saved.path,entry.media.animations[id].path);
const next=structuredClone(item);
next.system.activities[id].flags.autoanimations=animationWithFile(activity,item.name,saved.localPath,saved.hasAudio);
const changes=nativeDiff(item,next,'Item',{isAdmin:true});
const pathPatch = changes.find(change=>change.path === `system.activities.${id}.flags.autoanimations.primary.video.customPath`);
assert.ok(pathPatch);
if (!process.argv[2]) assert.equal(saved.hasAudio,true);

const route = {worldId:world, actorId:actor};
const transport = {origin, route, campaign, bucket};
const hosted = origin + '/' + saved.path;
async function queuedPatches(before, patches, canInstall) {
  const submitted = structuredClone(patches);
  const proposed = nativeValidateChanges(before, {type:'Item'}, submitted, {isAdmin:true});
  await prepareActivityAnimationPatches(before.system.activities, proposed, submitted, {...transport, canInstall});
  return submitted;
}
const expected = structuredClone(next);
const streamedPrimary = expected.system.activities[id].flags.autoanimations.primary;
streamedPrimary.video.customPath = hosted;
if (streamedPrimary.sound?.file === saved.localPath) streamedPrimary.sound.file = hosted;
assert.deepEqual(nativeApply(item,await queuedPatches(item,changes,true)),next);
assert.deepEqual(nativeApply(item,await queuedPatches(item,changes,false)),expected);
const withoutConfig = structuredClone(item);
delete withoutConfig.system.activities[id].flags.autoanimations;
const added = nativeDiff(withoutConfig, next, 'Item', {isAdmin:true});
const queued = await queuedPatches(withoutConfig, added, false);
const streamedItem = nativeApply(withoutConfig, queued);
assert.deepEqual(streamedItem, expected, 'A patch adding an entire config preserves its siblings and base');
assert.deepEqual(await queuedPatches(item,nativeDiff(item,expected,'Item',{isAdmin:true}),false),
  nativeDiff(item,expected,'Item',{isAdmin:true}), 'A hosted URL can be submitted again');
const previews = activityAnimationPreviews(streamedItem.system.activities, {}, campaign, route, origin);
assert.deepEqual(previews[id], {source:hosted, path:saved.path});
assert.deepEqual(activityAnimationPreviews(streamedItem.system.activities, {}, campaign, {...route, actorId:'another'}, origin), {});
assert.deepEqual(activityAnimationPreviews(streamedItem.system.activities, {}, campaign, route, 'https://another.test'), {});
assert.deepEqual(new Uint8Array(await (await request(hosted)).arrayBuffer()), replacement);
for (const invalid of [saved.localPath.replace(actor,'another'), hosted.replace(actor,'another'), hosted.replace(saved.digest,'0'.repeat(64))]) {
  await assert.rejects(queuedPatches(item,[{...pathPatch,value:invalid}],false), /WebM/);
}
let downloads=0;
const receiving={...context,request:async(...args)=>{downloads++;return request(...args);}};
await assert.rejects(installNpcAnimations(item.system.activities,next.system.activities,{...context,request:async()=>new Response(original)}),/non corrisponde/);
assert.ok(!files.has(saved.localPath));
await installNpcAnimations(item.system.activities,next.system.activities,receiving);
assert.deepEqual(files.get(saved.localPath),replacement);
await installNpcAnimations(item.system.activities,next.system.activities,receiving);
assert.equal(downloads,1);
const reread={definition:{activities:next.system.activities}};
await exportNpcAnimations([reread],context);
assert.deepEqual(reread.media.animations[id],{source:saved.localPath,path:saved.path});
assert.equal(writes,2);

// Exercise the editor's file-input listener without a server or a browser.
const made=[];
function make(tag, cls, text) {
  const node={tag, textContent:text, children:[], listeners:{}, append(...nodes){this.children.push(...nodes);},
    addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(){},querySelector(){return this.children[0];}};
  made.push(node);return node;
}
const draft=structuredClone(item), entity={key:'current',name:item.name,target:{id:item._id},draft};
const pending=new Set(), errorsBefore=structuredClone(draft), body=make('section');
let attempts=0;
appendAnimationControls({body,activity:draft.system.activities[id],entity,id,source:{animationMedia:{[item._id]:{[id]:{source:path,path:paths.path}}}},
  context:{...context,resolve:value=>origin+'/'+value},set:(_,key,value)=>{assert.equal(key,`system.activities.${id}.flags.autoanimations`);draft.system.activities[id].flags.autoanimations=value;},
  field:()=>{const label=make('label');label.append(make('input'));return label;},make,locked:()=>false,pending,update(){},redraw(){},
  upload:async()=>{if(++attempts===1)throw Error('Connessione interrotta');return saved;}});
const fileInput=made.find(node=>node.type==='file'), video=made.find(node=>node.tag==='video');
assert.equal(video.src,origin+'/'+paths.path);
fileInput.files=[new File([replacement],'test.webm',{type:'video/webm'})];
await fileInput.listeners.change();
assert.deepEqual(draft,errorsBefore);assert.equal(pending.size,0);assert.equal(entity.animationErrors.get(id),'Connessione interrotta');
await fileInput.listeners.change();
assert.deepEqual(draft,next);assert.equal(fileInput.disabled,false);

const brokenItem=structuredClone(item);
brokenItem.system.activities[id].flags.autoanimations=legacy;
const healingEntity={...entity,draft:structuredClone(brokenItem)};
let repaints=0;
function repairControl(locked) {
  const panel=make('section');
  appendAnimationControls({body:panel,activity:healingEntity.draft.system.activities[id],entity:healingEntity,id,
    source:{},context,make,field:()=>{const row=make('label');row.append(make('input'));return row;},
    set:(target,p,v)=>nativeSet(target.draft,p,v),locked:()=>locked,pending,update(){},redraw:()=>repaints++});
  return panel.children.find(node=>node.textContent==='Ripara menu Foundry');
}
assert.equal(repairControl(true).disabled,true);
repairControl(true).listeners.click();
const action=repairControl(false);
assert.deepEqual(healingEntity.draft,brokenItem);
action.listeners.click();
assert.equal(repaints,1);
assert.equal(repairControl(false),undefined);
const repairs=nativeDiff(brokenItem,healingEntity.draft,'Item',{isAdmin:true});
assert.ok(repairs.length && repairs.every(p=>!p.baseExists && p.op==='set'));
assert.deepEqual(await queuedPatches(brokenItem,repairs,true),repairs);
assert.deepEqual(nativeApply(brokenItem,repairs).system.activities[id].flags.autoanimations,healed);

// Persistent templates and sound-only overrides keep their independent settings.
const template = structuredClone(item);
const templateConfig = template.system.activities[id].flags.autoanimations;
templateConfig.menu = 'templatefx';
Object.assign(templateConfig.primary.options,{persistent:true,persistType:'sequencerground',repeat:3,repeatDelay:400});
templateConfig.primary.sound = {enable:false,file:'worlds/demo/bell.ogg',volume:0.5,repeat:2};
templateConfig.soundOnly = {sound:{enable:false,file:'worlds/demo/wind.ogg',volume:0.8}};
const templateDraft = structuredClone(template);
const templateEntity = {...entity, draft:templateDraft};
const controls = new Map();
const prefix = `system.activities.${id}.flags.autoanimations.`;
function renderSettings() {
  controls.clear();
  appendAnimationControls({body:make('section'), activity:templateDraft.system.activities[id], entity:templateEntity,
    id, source:{}, context, make, locked:()=>false, pending, update(){}, redraw:renderSettings,
    set:(target,path,value)=>nativeSet(target.draft,path,value),
    field:(target,path,label,value,write)=>{
      const row=make('label'), input=make('input');
      input.value=String(value); row.append(input);
      controls.set(path.slice(prefix.length), {value,input,label,change(nextValue) {
        write(target,path,nextValue);
        input.listeners.change?.();
      }});
      return row;
    }});
}
renderSettings();
assert.equal(controls.get('primary.options.persistent').value,true);
assert.equal(controls.has('primary.options.repeat'),false);
controls.get('primary.options.persistent').change(false);
assert.equal(controls.get('primary.options.repeat').value,3);
assert.equal(controls.get('primary.options.repeatDelay').value,400);
controls.get('primary.options.repeat').change(4);
controls.get('primary.sound.enable').change(true);
assert.equal(controls.get('primary.sound.file').value,'worlds/demo/bell.ogg');
assert.equal(controls.get('primary.sound.volume').input.max,'1');
controls.get('primary.sound.volume').change(0);
controls.get('soundOnly.sound.enable').change(true);
assert.ok(!controls.has('primary.options.repeat') && !controls.has('primary.sound.file'));
assert.equal(controls.get('soundOnly.sound.file').value,'worlds/demo/wind.ogg');
controls.get('soundOnly.sound.enable').change(false);
assert.equal(controls.get('primary.sound.volume').value,0);
const settingsDiff = nativeDiff(template,templateDraft,'Item',{isAdmin:true});
assert.deepEqual(settingsDiff.map(p=>p.path.slice(prefix.length)).sort(),
  ['primary.options.persistent','primary.options.repeat','primary.sound.enable','primary.sound.volume']);
assert.deepEqual(await queuedPatches(template,settingsDiff,true),settingsDiff);
assert.deepEqual(nativeApply(template,settingsDiff),templateDraft);
templateDraft.system.activities[id].flags.autoanimations.menu='melee';
templateDraft.system.activities[id].flags.autoanimations.isCustomized=false;
renderSettings();
assert.ok(controls.has('primary.options.repeat') && !controls.has('primary.options.persistent'));
assert.equal(templateDraft.system.activities[id].flags.autoanimations.isCustomized,false);
controls.get('primary.options.repeat').change(2);
assert.equal(templateDraft.system.activities[id].flags.autoanimations.isCustomized,true);
templateDraft.system.activities[id].flags.autoanimations.menu='aura';
renderSettings();
assert.ok(!controls.has('primary.options.repeat') && !controls.has('primary.options.persistent'));
// Select the actual Tracks/TrackEntry/TrackType hierarchy, even in a streamed
// segment. An identical sequence inside a video block is not an audio track.
const videoOnly = Uint8Array.from([...sample(videoEntry),0x1f,0x43,0xb6,0x75,0x88,0xa3,0x86,...audioEntry]);
assert.equal((await (await siteUpload(videoOnly,'dm')).json()).hasAudio,false);
const audible = await (await siteUpload(sample([...videoEntry,...audioEntry]),'dm')).json();
assert.equal(audible.hasAudio,true);
const uploadTo = (config, clip) => animationWithFile({flags:{autoanimations:config}},'Test',clip.localPath,clip.hasAudio);
const linked = uploadTo({},audible);
assert.equal(linked.primary.sound.enable,true);
assert.equal(linked.primary.sound.file,audible.localPath);
const quiet = uploadTo(linked,{localPath:'silent.webm',hasAudio:false});
assert.equal(quiet.primary.sound.enable,false);
assert.equal(quiet.primary.sound.file,'');
assert.equal(uploadTo(quiet,audible).primary.sound.enable,true);
assert.equal(uploadTo(linked,{localPath:'legacy-worker.webm'}).primary.sound.enable,false);
templateDraft.system.activities[id].flags.autoanimations=structuredClone(linked);
const beforeMute=structuredClone(templateDraft);
renderSettings();
assert.equal(controls.get('primary.sound.enable').label,'Audio del WebM');
controls.get('primary.sound.enable').change(false);
const muted = templateDraft.system.activities[id].flags.autoanimations;
assert.equal(muted.primary.sound.file,audible.localPath);
assert.equal(muted.primary.sound.enable,false);
const muteDiff=nativeDiff(beforeMute,templateDraft,'Item',{isAdmin:true});
assert.deepEqual(muteDiff.map(p=>p.path),[prefix+'primary.sound.enable']);
assert.deepEqual(nativeApply(beforeMute,await queuedPatches(beforeMute,muteDiff,false)),templateDraft);
assert.equal(uploadTo(muted,{...audible,localPath:'other.webm'}).primary.sound.enable,false);
assert.equal(uploadTo(uploadTo(muted,{localPath:'silent.webm',hasAudio:false}),audible).primary.sound.enable,false);
controls.get('primary.sound.enable').change(true);
assert.equal(muted.primary.sound.enable,true);
const customSound = uploadTo(templateConfig,audible);
assert.deepEqual(customSound.primary.sound,templateConfig.primary.sound);
assert.deepEqual(customSound.soundOnly,templateConfig.soundOnly);
const customWithSoundOnly=structuredClone(customSound);
customWithSoundOnly.primary.sound.enable=true;
customWithSoundOnly.soundOnly.sound.enable=true;
const replacedCustom=uploadTo(customWithSoundOnly,{...audible,localPath:'next.webm'});
assert.deepEqual(replacedCustom.primary.sound,customWithSoundOnly.primary.sound);
assert.deepEqual(replacedCustom.soundOnly,customWithSoundOnly.soundOnly);
templateDraft.system.activities[id].flags.autoanimations=customSound;
renderSettings();
made.findLast(node=>node.textContent==='Usa l’audio del WebM').listeners.click();
assert.deepEqual(customSound.primary.sound,{...templateConfig.primary.sound, file:audible.localPath, enable:true});
assert.deepEqual(customSound.soundOnly,templateConfig.soundOnly);
// A GM pull upgrades only former site assignments, using the same file for
// either transport. The legacy upload had a disabled sound with no filename.
const localAudio=audible.localPath, hostedAudio=origin+'/'+audible.path;
const silent=await (await siteUpload(videoOnly,'dm')).json();
files.set(localAudio,sample([...videoEntry,...audioEntry]));
let migrated=0;
function oldActivity(id,src,sound={enable:false}) {
  return {id,flags:{autoanimations:{primary:{video:{enableCustom:true,customPath:src},sound}}},
    async update(changes) {
      for(const [path,value] of Object.entries(changes))nativeSet(this,path,value);
      migrated++;
    }};
}
const oldLocal=oldActivity('local',localAudio,{enable:false,volume:0.42});
const oldHosted=oldActivity('remote',hostedAudio);
const oldSilent=oldActivity('silent',silent.localPath);
const oldMuted=oldActivity('muted',localAudio,{file:localAudio,enable:false,volume:0.6});
const oldCustom=oldActivity('custom',hostedAudio,{file:'spell.ogg',enable:false});
const oldOnly=oldActivity('only',localAudio);
oldOnly.flags.autoanimations.soundOnly={sound:{file:'wind.ogg',enable:true}};
const nativeOnly=oldActivity('foundry',path);
const otherOrigin=oldActivity('external',hostedAudio.replace(origin,'https://other.test'));
const otherActor=oldActivity('foreign',localAudio.replace(actor,'another'));
const activities=new Map([oldLocal,oldHosted,oldMuted,oldCustom,oldOnly,oldSilent,nativeOnly,otherOrigin,otherActor].map(a=>[a.id,a]));
const npc={type:'npc',items:new Map([['item',{id:'item',system:{activities}}]])};
let reads=0;
const legacyContext={...context,request:async(...args)=>{reads++;return request(...args);}};
assert.equal(await applyLegacySiteAudio(npc,legacyContext,()=>false),false);
assert.equal(await applyLegacySiteAudio(npc,legacyContext,()=>true),true);
assert.equal(reads,1);
assert.equal(migrated,5);
assert.deepEqual(oldLocal.flags.autoanimations.primary.sound,{enable:true,volume:0.42,file:localAudio});
assert.deepEqual(oldHosted.flags.autoanimations.primary.sound,{enable:true,file:hostedAudio});
assert.deepEqual(oldMuted.flags.autoanimations.primary.sound,{enable:false,volume:0.6,file:localAudio});
assert.deepEqual(oldCustom.flags.autoanimations.primary.sound,{enable:false,file:'spell.ogg'});
assert.deepEqual(oldOnly.flags.autoanimations.primary.sound,{enable:false});
for(const untouched of [nativeOnly,otherOrigin,otherActor,oldSilent])assert.equal(untouched.flags.autoanimations.primary.video.wikiSyncAudio,undefined);
// A missing file is retried. Once processed, manual mutes survive later pulls.
files.set(silent.localPath,videoOnly);
oldLocal.flags.autoanimations.primary.sound.enable=false;
assert.equal(await applyLegacySiteAudio(npc,legacyContext,()=>true),true);
assert.deepEqual(oldSilent.flags.autoanimations.primary.video.wikiSyncAudio,{hasTrack:false});
assert.deepEqual(oldSilent.flags.autoanimations.primary.sound,{enable:false});
assert.equal(await applyLegacySiteAudio(npc,legacyContext,()=>true),false);
assert.equal(oldLocal.flags.autoanimations.primary.sound.enable,false);
const replaced=oldActivity('replaced',hostedAudio);
activities.set(replaced.id,replaced);
assert.equal(await applyLegacySiteAudio(npc,{...context,request:async(...args)=>{
  replaced.flags.autoanimations.primary.video.customPath=path;
  return request(...args);
}},()=>true),false);
assert.deepEqual(replaced.flags.autoanimations.primary.sound,{enable:false});
assert.equal(migrated,6);
console.log(`WebM OK: Foundry → Worker → editor → Foundry → sito; ${original.length} byte, tracce audio, mute, formato, Range, permessi e integrità.`);
