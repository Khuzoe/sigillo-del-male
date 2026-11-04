import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import worker from '../workers/main-worker/src/index.js';
import {TileGenerationStore} from '../workers/main-worker/src/tile-generation.js';
import {options,outputSize,planCapture,validateCapture,sourceCrop,tileData,MODULE_ID,MAX_REFERENCES,MAX_REFERENCE_BYTES,MAX_REQUEST_BYTES} from '../integrations/khuzoe-tiles-creator/scripts/model.mjs';
import {TilesController} from '../integrations/khuzoe-tiles-creator/scripts/controller.mjs';
import {mapLayers,sceneFingerprint,captureArea,resultAsInput} from '../integrations/khuzoe-tiles-creator/scripts/capture.mjs';
import {renderTiles} from '../integrations/khuzoe-tiles-creator/scripts/view.mjs';
import {brushPoint,drawErasure,applyEraseMask,resizeEraseMask} from '../integrations/khuzoe-tiles-creator/scripts/eraser.mjs';
import {referenceSize,prepareReference,checkReferences} from '../integrations/khuzoe-tiles-creator/scripts/references.mjs';

let checks=0;const check=(value,message)=>{assert.ok(value,message);checks++;};
const same=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
function webp(width,height){const bytes=new Uint8Array(30);bytes.set(Buffer.from('RIFF'));new DataView(bytes.buffer).setUint32(4,22,true);bytes.set(Buffer.from('WEBPVP8X'),8);new DataView(bytes.buffer).setUint32(16,10,true);for(let i=0;i<3;i++){bytes[24+i]=((width-1)>>>(8*i))&255;bytes[27+i]=((height-1)>>>(8*i))&255;}return bytes;}
class Storage{
  values=new Map();async get(k){return structuredClone(this.values.get(k));}async put(k,v){if(typeof k==='object'){for(const [key,value]of Object.entries(k))await this.put(key,value);return;}this.values.set(k,structuredClone(v));}async delete(k){this.values.delete(k);}async setAlarm(v){this.alarm=v;}async getAlarm(){return this.alarm;}async deleteAlarm(){this.alarm=null;}async transaction(fn){return fn(this);}
}
const objects=new Map(),puts=[];
const bucket={async put(k,v){puts.push(k);objects.set(k,new Uint8Array(await new Response(v).arrayBuffer()));},async head(k){return objects.has(k)?{size:objects.get(k).length}:null;},async get(k){const b=objects.get(k);return b?{size:b.length,body:new Blob([b]).stream(),arrayBuffer:async()=>b.slice().buffer}:null;},async delete(){assert.fail('Never delete pre-existing R2 data');}};
const kv=new Map(),state={storage:new Storage()},env={JWT_SECRET:'tiles-test',GLOBAL_ADMIN_ACCOUNT_IDS:'admin',GLOBAL_ADMIN_DEVICE_CODE:'TILES-ADMIN-TEST-VERY-STRONG',DEVICE_LOGIN_CODES_SECRET:'TILES-DM-TEST||dungeon-master|DM;TILES-PLAYER-TEST||player|Player',CAMPAIGN_EDITOR_ACCOUNT_IDS:'cripta-di-sangue:dungeon-master',OPENAI_API_KEY:'test-only-no-live-api',TILE_MONTHLY_LIMIT:'3',MEDIA_BUCKET:bucket,SIGILLO_KV:{async get(k){return kv.get(k)??null;},async put(k,v){kv.set(k,v);},async delete(k){kv.delete(k);}}};
let store=new TileGenerationStore(state,env);env.TILE_GENERATOR={idFromName:n=>n,get:()=>({fetch:r=>store.fetch(r)})};
const ctx={worldId:'test-world',sceneId:'scene00000000001',levelId:'level00000000001'};
const path='/api/tiles/generations';
async function request(route=path,body,token,campaign='cripta-di-sangue',query=ctx){const url=new URL(route,'https://test.invalid');Object.entries({...query,campaign}).forEach(([k,v])=>url.searchParams.set(k,v));return worker.fetch(new Request(url,{headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})}),env,{waitUntil:p=>p.catch(()=>{})});}
async function login(code){const response=await request('/auth/device/login',{code,campaignId:'cripta-di-sangue'});same(response.status,200);return (await response.json()).token;}
const admin=await login('TILES-ADMIN-TEST-VERY-STRONG'),dm=await login('TILES-DM-TEST'),player=await login('TILES-PLAYER-TEST');
const plan=planCapture({x:200,y:180,width:400,height:400},{x:0,y:0,width:1000,height:1000});
const capture={version:1,...plan,elevation:0,sort:1000,sceneFingerprint:'a'.repeat(64)};
const newBody=()=>({context:ctx,requestId:randomUUID(),details:'Il ponte è crollato. Conserva lo stile.',capture,source:`data:image/webp;base64,${Buffer.from(webp(plan.width,plan.height)).toString('base64')}`,options:options()});
for(const ratio of [1/3,.5,.75,1,1.5,2,3])for(const resolution of ['medium','high']){const size=outputSize(ratio*1000,1000,resolution);check(size.width%16===0&&size.height%16===0&&size.width*size.height>=655360&&size.width/size.height<=3&&size.height/size.width<=3,'API pixel/ratio constraints');}
same(sourceCrop({target:{x:100,y:50,width:200,height:100},frame:{x:0,y:0,width:400,height:200},width:1024,height:512}),{x:256,y:128,width:512,height:256},'Crop includes only the authorized area');
assert.throws(()=>planCapture({x:-1,y:0,width:400,height:400},{x:0,y:0,width:1000,height:1000}));checks++;
assert.throws(()=>outputSize(4000,100));checks++;
assert.throws(()=>validateCapture({...capture,width:17},options()));checks++;
assert.throws(()=>tileData({id:randomUUID(),capture,context:ctx},'../../existing.webp'));checks++;
same((await request()).status,401,'No anonymous generation access');same((await request(path,undefined,player)).status,403);same((await request(path,undefined,dm,'mago-folle')).status,403,'Campaign permission boundary');
const status=await (await request(path,undefined,dm)).json();same(status.enabled,true);same(status.job,null);same(status.quota,{used:0,limit:null});
const syncOnly=await worker.fetch(new Request('https://test.invalid/api/tiles/generations?campaign=cripta-di-sangue',{headers:{'X-Cripta-Inventory-Secret':'test'}}),env,{});same(syncOnly.status,401,'The synchronization secret cannot spend API credits');
same((await request(path,null,dm)).status,400);same((await request(path,{...newBody(),source:'https://untrusted.invalid/secret'},dm)).status,400,'Never fetch a user-supplied remote URL');
same(puts.length,0);
delete env.OPENAI_API_KEY;same((await request(path,newBody(),dm)).status,503);env.OPENAI_API_KEY='test-only-no-live-api';
const first=newBody();same((await request(path,first,dm)).status,202);same((await request(path,first,dm)).status,200,'Idempotent retry');
same((await request(path,{...first,details:'different'},dm)).status,409,'A request ID cannot change meaning');
same((await request(path,newBody(),dm)).status,409,'Only one paid request per campaign is active');
same(state.storage.values.get('usage:'+new Date().toISOString().slice(0,7)),1,'Retries do not consume quota');
same((await request(`${path}/${first.requestId}/source`,undefined,admin)).status,404,'Different site identities cannot read private captures');
same((await request(`${path}/${first.requestId}/source`,undefined,dm,'cripta-di-sangue',{...ctx,sceneId:'other'})).status,404);
same((await request(`${path}/${first.requestId}/source`,undefined,dm)).headers.get('Cache-Control'),'private, no-store');
const fetchBefore=globalThis.fetch;let providerCalls=0,providerBody;
globalThis.fetch=async(url,init)=>{check(String(url)==='https://api.openai.com/v1/images/edits');providerCalls++;providerBody=JSON.parse(init.body);return Response.json({data:[{b64_json:Buffer.from(webp(plan.width,plan.height)).toString('base64')}]});};
try{await store.alarm();}finally{globalThis.fetch=fetchBefore;}
same(providerCalls,1);same(providerBody.quality,'medium');same(providerBody.images.length,1);check(!providerBody.prompt.includes('fullbody'),'No portrait style leaks into maps');check(providerBody.safety_identifier!=='dungeon-master');
const ready=(await (await request(path,undefined,dm)).json()).job;same(ready.status,'ready');check(!('fingerprint'in ready));same((await request(`${path}/${ready.id}/preview`,undefined,dm)).status,200);
same((await request(`/media/_private/ai-tiles/cripta-di-sangue/${ready.id}/generated.webp`)).status,400,'Private image is never served by the public media endpoint');
same((await request(`${path}/${ready.id}/placed`,{context:ctx,tileId:'tile000000000001'},dm)).status,200);same((await request(`${path}/${ready.id}/placed`,{context:ctx,tileId:'tile000000000001'},dm)).status,200,'Receipt can be retried');same((await request(`${path}/${ready.id}/placed`,{context:ctx,tileId:'tile000000000002'},dm)).status,409);
const child={...newBody(),parentJobId:ready.id,details:'Aggiungi rune rosse e mantieni il ponte crollato.'};
same((await request(path,{...child,parentJobId:randomUUID()},dm)).status,404,'A parent must exist');same((await request(path,child,admin)).status,404,'A parent belongs to its authenticated owner');
same((await request(path,{...child,capture:{...capture,target:{...capture.target,x:capture.target.x+1}}},dm)).status,400,'A refinement cannot silently move its target');
same((await request(path,child,dm)).status,202);const childStatus=(await (await request(path,undefined,dm)).json()).job;same(childStatus.parentJobId,ready.id);same((await request(path,child,dm)).status,200,'Refinement retries are idempotent');
same((await request(`${path}/${child.requestId}/stop`,{context:ctx},dm)).status,200);
same((await request(path,{...newBody(),parentJobId:child.requestId},dm)).status,409,'An unfinished result cannot become a paid input');
const stopped=newBody();same((await request(path,stopped,dm)).status,202);same((await request(`${path}/${stopped.requestId}/stop`,{context:ctx},dm)).status,200);await store.alarm();same(providerCalls,1,'Stopping before an alarm never calls the provider');same(state.storage.values.get('active'),undefined);
same((await request(`${path}/${stopped.requestId}/stop`,{context:ctx},dm)).status,200,'Stop is idempotent');
// A late paid response remains available but must not clear a newer job's lock.
const late=newBody();same((await request(path,late,dm)).status,202);let release,startProvider;const started=new Promise(resolve=>startProvider=resolve);
globalThis.fetch=async()=>{providerCalls++;startProvider();return await new Promise(resolve=>{release=()=>resolve(Response.json({data:[{b64_json:Buffer.from(webp(plan.width,plan.height)).toString('base64')}]}));});};
try{
  const running=store.alarm();await started;same((await request(`${path}/${late.requestId}/stop`,{context:ctx},dm)).status,200);
  env.TILE_MONTHLY_LIMIT='0';const next=newBody();same((await request(path,next,dm)).status,202,'Legacy limit variables cannot block a generation');release();await running;
  same(state.storage.values.get('active'),next.requestId,'A late completion cannot release a new lock');same((await request(`${path}/${late.requestId}/preview`,undefined,dm)).status,200,'Late result remains recoverable');
  const pending=await state.storage.get(`job:${next.requestId}`);pending.deadlineAt=Date.now()-1;await state.storage.put(`job:${next.requestId}`,pending);
  store=new TileGenerationStore(state,env);const recovered=await (await request(path,undefined,dm)).json();same(recovered.job.status,'uncertain');same(state.storage.values.get('active'),undefined);same(providerCalls,2,'Restart and expiry never generate again');
  for(let i=0;i<25;i++){const next=newBody();same((await request(path,next,dm)).status,202,'More than 20 requests are allowed');same((await request(`${path}/${next.requestId}/stop`,{context:ctx},dm)).status,200);}
  const unlimited=(await (await request(path,undefined,dm)).json()).quota;same(unlimited.limit,null);check(unlimited.used>20,'Usage accounting is retained without enforcing a limit');
}finally{globalThis.fetch=fetchBefore;}
check(puts.every(k=>k.startsWith('_private/ai-tiles/cripta-di-sangue/')),'No write to old/public R2 paths');check(![...kv.keys()].some(k=>k.includes('managed')||k.includes('tile')),'No NPC/scene documents written to KV');

// Real Worker routes and coordinator: ordered references, private recovery and
// immutable retries. All image-provider responses below are local fixtures.
const reference=(name,width=256,height=128)=>({name,note:'Riprendi la texture.',kind:'file',width,height,image:`data:image/webp;base64,${Buffer.from(webp(width,height)).toString('base64')}`});
const refA=reference('Pietra'),refB={...reference('Runa',128,256),kind:'scene',note:'Usa solo il simbolo.'};
same((await(await request(path,undefined,dm)).json()).referencesVersion,1,'Capability comes from the real coordinator');
const putsBeforeReferences=puts.length;
for(const invalid of [null,{},Array.from({length:MAX_REFERENCES+1},()=>refA),[{...refA,image:'https://untrusted.invalid/reference.webp'}],[{...refA,image:'data:image/png;base64,AAAA'}],[{...refA,note:'x'.repeat(301)}],[{...refA,kind:'url'}],[{...refA,width:999}],[reference('Too wide',1537,1)]])same((await request(path,{...newBody(),references:invalid},dm)).status,400,'Invalid references cannot reserve a paid job or write images');
same(puts.length,putsBeforeReferences);
const padded=webp(256,128),large=new Uint8Array(MAX_REFERENCE_BYTES);large.set(padded);new DataView(large.buffer).setUint32(4,large.length-8,true);
const heavy={...refA,image:`data:image/webp;base64,${Buffer.from(large).toString('base64')}`};
same((await request(path,{...newBody(),references:[heavy,heavy,heavy,heavy]},dm)).status,400,'Combined reference budget is enforced');same(puts.length,putsBeforeReferences);
const oversizedRequest=await worker.fetch(new Request('https://test.invalid/api/tiles/generations?campaign=cripta-di-sangue',{method:'POST',headers:{Authorization:`Bearer ${dm}`,'Content-Length':String(MAX_REQUEST_BYTES+1)},body:'{}'}),env,{});same(oversizedRequest.status,413);
const withReferences={...newBody(),references:[refA,refB]},usageBeforeReferences=(await(await request(path,undefined,dm)).json()).quota.used;
const startedReferences=await request(path,withReferences,dm);same(startedReferences.status,202);const referenceJob=(await startedReferences.json()).job;
same(referenceJob.references.map(reference=>reference.name),['Pietra','Runa']);check(referenceJob.references.every(reference=>!('image'in reference)&&!('hash'in reference)),'Job metadata never includes reference bytes or internal storage keys');
same((await request(path,withReferences,dm)).status,200);
same((await request(path,{...withReferences,references:[refB,refA]},dm)).status,409,'A retry cannot reorder references');
same((await request(path,{...withReferences,references:[{...refA,note:'Different'},refB]},dm)).status,409,'A retry cannot change reference guidance');
same((await request(path,{...withReferences,references:[{...refA,image:refB.image,width:refB.width,height:refB.height},refB]},dm)).status,409,'A retry cannot replace reference pixels');
same((await request(path,{...withReferences,references:[]},dm)).status,409,'A retry cannot omit attached references');
same((await(await request(path,undefined,dm)).json()).quota.used,usageBeforeReferences+1);
for(const denied of [admin,player,undefined])same((await request(`${path}/${referenceJob.id}/reference-1`,undefined,denied)).status,denied===admin?404:denied===player?403:401,'References are private to the author');
same((await request(`${path}/${referenceJob.id}/reference-1`,undefined,dm,'mago-folle')).status,403);
same((await request(`${path}/${referenceJob.id}/reference-1`,undefined,dm,'cripta-di-sangue',{...ctx,levelId:'other'})).status,404);
const privateReference=await request(`${path}/${referenceJob.id}/reference-2`,undefined,dm);same(privateReference.status,200);same(privateReference.headers.get('Cache-Control'),'private, no-store');same(privateReference.headers.get('Content-Type'),'image/webp');same(new Uint8Array(await privateReference.arrayBuffer()),webp(128,256));
same((await request(`${path}/${referenceJob.id}/reference-3`,undefined,dm)).status,404);
same((await request(`${path}/${referenceJob.id}/reference-1`,{context:ctx},dm)).status,405);
same((await request(`/media/_private/ai-tiles/cripta-di-sangue/${referenceJob.id}/reference-1.webp`)).status,400);
store=new TileGenerationStore(state,env);const beforeReferenceProvider=providerCalls;
globalThis.fetch=async(url,init)=>{same(String(url),'https://api.openai.com/v1/images/edits');providerCalls++;providerBody=JSON.parse(init.body);return Response.json({data:[{b64_json:Buffer.from(webp(plan.width,plan.height)).toString('base64')}]});};
try{await store.alarm();await store.alarm();}finally{globalThis.fetch=fetchBefore;}
same(providerCalls,beforeReferenceProvider+1,'Recovery and repeated alarms do not make an extra paid call');
same(providerBody.images.map(image=>image.image_url),[withReferences.source,refA.image,refB.image],'The editable map is ALWAYS first; secondary reference order is exact');
same(providerBody.size,`${plan.width}x${plan.height}`,'References never change the output dimensions');check(providerBody.prompt.includes('Edit IMAGE 1 only'));check(providerBody.prompt.includes('SECONDARY REFERENCES ONLY'));check(providerBody.prompt.includes('Usa solo il simbolo.'));
same((await request(path,first,dm)).status,200,'Original requests without references remain idempotent across the upgrade');
const missingReference={...newBody(),references:[refA]};same((await request(path,missingReference,dm)).status,202);objects.delete(`_private/ai-tiles/cripta-di-sangue/${missingReference.requestId}/reference-1.webp`);
globalThis.fetch=async()=>{assert.fail('Missing reference must fail before the paid provider is contacted');};
try{await store.alarm();}finally{globalThis.fetch=fetchBefore;}
same((await(await request(path,undefined,dm)).json()).job.status,'failed');same(state.storage.values.get('active'),undefined);
check(puts.every(key=>key.startsWith('_private/ai-tiles/cripta-di-sangue/')));check(![...kv.keys()].some(key=>key.includes('tile')));

// Exercise installed capture selection against fake v14 level/layer objects.
globalThis.foundry={canvas:{groups:{PrimaryCanvasGroup:{SORT_LAYERS:{SCENE:0,TILES:1},_compareObjects:(a,b)=>(a.elevation||0)-(b.elevation||0)||(a.sortLayer||0)-(b.sortLayer||0)||(a.sort||0)-(b.sort||0)}}}};
const bg={src:'map.webp',level:{textures:{}},elevation:0};
const makeTile=(id,extra={})=>({id,texture:{src:`${id}.webp`,anchorX:0,anchorY:0,scaleX:-1,scaleY:1},viewed:true,hidden:false,width:100,height:100,x:30,y:20,rotation:45,alpha:.4,elevation:0,sort:2,...extra});
const scene={backgroundColor:0,dimensions:{sceneRect:{x:0,y:0,width:1000,height:1000}},_configureLevelTextures:()=>[bg],tiles:[makeTile('visible'),makeTile('hidden',{hidden:true}),makeTile('different-level',{viewed:false})]};
const layers=mapLayers(scene);same(layers.length,2);same(layers[1].alpha,.4);same(layers[1].rotation,45);same(layers[1].scaleX,-1);const fp=await sceneFingerprint(scene);scene.tokens=[{hp:5}];same(await sceneFingerprint(scene),fp,'Token/combat changes do not invalidate the capture');scene.tiles[0].x++;check(await sceneFingerprint(scene)!==fp,'Changed tile geometry invalidates stale captures');

// Foundry 14 always includes both textures for the viewed level, including an
// empty foreground. Execute the full capture path: no empty URL may reach the loader.
const noTiles={...scene,id:'background-only',_view:'level',tiles:[],_configureLevelTextures:()=>[bg,...[null,'','   ',undefined].map(src=>({name:'foreground',src,level:{textures:{}},elevation:20}))]};
const point=()=>({x:0,y:0,set(x,y=x){this.x=x;this.y=y;}});
class CaptureContainer{children=[];position=point();scale=point();addChild(child){this.children.push(child);return child;}destroy(){this.destroyed=true;}}
class CaptureGraphics{beginFill(){return this;}drawRect(){return this;}endFill(){return this;}}
class CaptureSprite{anchor=point();position=point();constructor(image){this.image=image;}}
globalThis.PIXI={Container:CaptureContainer,Graphics:CaptureGraphics,Sprite:CaptureSprite,RenderTexture:{create:size=>({...size,destroy(){this.destroyed=true;}})}};
globalThis.HTMLVideoElement=class {};
const loaded=[];let rendered;foundry.canvas.loadTexture=async src=>{if(!src?.trim())throw new Error('Requested texture path is empty.');loaded.push(src);return{width:1000,height:1000};};
foundry.canvas.primary={PrimarySpriteMesh:class{resize(width,height){this.width=width;this.height=height;}}};
globalThis.canvas={
  ready:true,scene:noTiles,level:{id:'level',elevation:{bottom:0}},
  app:{renderer:{
    render(stage){rendered=stage;},
    extract:{canvas:()=>({toBlob(resolve){resolve(new Blob([webp(1024,1024)],{type:'image/webp'}));}})}
  }}
};
const emptyForegroundFingerprint=await sceneFingerprint(noTiles);
const capturedBackground=await captureArea({x:200,y:200,width:400,height:400},options());
same(loaded,['map.webp'],'Background-only scene loads only its actual background');same(capturedBackground.tiles,0);same(rendered.children.length,2,'Only fill and background sprites are rendered');check(capturedBackground.blob.size>0);
same(mapLayers(noTiles).map(layer=>layer.src),['map.webp'],'Null, missing, empty and whitespace-only sources are ignored');
same(await sceneFingerprint({...noTiles,_configureLevelTextures:()=>[bg]}),emptyForegroundFingerprint,'Empty level textures do not change the source fingerprint');
loaded.length=0;const onlyColor={...noTiles,_configureLevelTextures:()=>[{src:null,level:{textures:{}}}]};canvas.scene=onlyColor;
const capturedColor=await captureArea({x:200,y:200,width:400,height:400},options());same(loaded,[],'Color-only backgrounds never load a texture');same(capturedColor.tiles,0);same(rendered.children.length,1);
const withForeground={...noTiles,_configureLevelTextures:()=>[bg,{src:'roof.webp',level:{textures:{}},elevation:20}]};same(mapLayers(withForeground).map(layer=>layer.src),['map.webp','roof.webp'],'A configured foreground is still captured');

// Run the actual placement controller twice; a deterministic receipt prevents duplicates.
globalThis.game={user:{id:'gm',isGM:true,can:()=>true},world:{id:'test-world'}};
const id=randomUUID(),job={id,status:'ready',context:{...ctx,campaignId:'cripta-di-sangue'},capture:{...capture,sceneFingerprint:await sceneFingerprint(scene)}};
class DocumentCollection extends Map{[Symbol.iterator](){return this.values();}}
const tiles=new DocumentCollection();scene.tiles=tiles;job.capture.sceneFingerprint=await sceneFingerprint(scene);let created=0,uploads=0;
scene.createEmbeddedDocuments=async(type,docs,opts)=>{same(type,'Tile');same(opts.keepId,true);created++;const tile={...docs[0],id:docs[0]._id};tiles.set(tile.id,tile);return[tile];};
globalThis.canvas={scene};foundry.applications={apps:{FilePicker:{implementation:{async browse(){return{};},async upload(_source,folder,file){uploads++;return{path:`${folder}/${file.name}`};}}}}};
const client={context:{...job.context,remoteWrites:true},identity:()=> 'identity',assert:()=>{},request:async(_action,body)=>({job:{...job,status:'placed',tileId:body.tileId}})};
const controller=new TilesController({client,drafts:{}});controller.job=job;controller.blobs.result=new Blob(['fake-test-data']);await controller.place();same(controller.error,'');await controller.place();same(created,1);same(uploads,1);check(tiles.values().next().value.locked);same(tiles.values().next().value.texture.anchorX,0,'Tile coordinates use a top-left anchor');
const flag=tiles.values().next().value.flags[MODULE_ID];same(flag.generationId,id);same(scene.tokens,[{hp:5}],'Tokens preserved');
const manifest=JSON.parse(await readFile(new URL('../integrations/khuzoe-tiles-creator/module.json',import.meta.url)));same(manifest.id,MODULE_ID);same(manifest.compatibility.minimum,'14');
const idle=new TilesController({client:{...client,request:async()=>({enabled:true,job:null,quota:{used:0,limit:20}})},drafts:{async get(){return null;}}});await idle.open();same(idle.opened,true,'First open must keep polling enabled');idle.close();same(idle.opened,false);await idle.open();same(idle.opened,true,'Reopening resumes status checks');idle.close();

// Execute the actual iterative image composition and controller without a DOM
// renderer. Draw calls must place the displayed crop back into its context.
const drawCalls=[];let localReads=0;
globalThis.createImageBitmap=async blob=>{const bytes=new Uint8Array(await blob.arrayBuffer());const width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16);return{width,height,blob,close(){}};};
globalThis.document={createElement:()=>({width:0,height:0,getContext(){return{drawImage(...args){drawCalls.push(args);},createLinearGradient(){return{addColorStop(){}};},fillRect(){}};},toBlob(fn,type='image/webp'){fn(new Blob([webp(this.width,this.height)],{type}));}})};
const crop=sourceCrop(job.capture),displayed=new Blob([webp(Math.round(crop.width),Math.round(crop.height))],{type:'image/webp'}),frameBlob=new Blob([webp(job.capture.width,job.capture.height)],{type:'image/webp'});
const newInput=await resultAsInput(frameBlob,displayed,job.capture);same(drawCalls.length,2);same(drawCalls[0].slice(1),[0,0]);same(drawCalls[1].slice(1),[crop.x,crop.y,crop.width,crop.height],'Place the displayed image only inside the selected crop');check(newInput.size>0);
let localDraft;
const drafts={async get(){return localDraft;},async put(_k,value){localDraft=structuredClone(value);return true;},async delete(){localDraft=null;}};
const refineClient={...client,request:async action=>{localReads++;if(action==='source'||action==='preview')return frameBlob;return{enabled:true,job:{...job,status:'placed'},quota:{used:42,limit:null}};}};
const progressive=new TilesController({client:refineClient,drafts});progressive.origin=refineClient.identity();progressive.activeDraftKey=progressive.draftKey();progressive.job={...job,status:'placed'};progressive.blobs.source=frameBlob;progressive.blobs.result=displayed;progressive.enabled=true;
await progressive.refine();same(progressive.error,'');same(localReads,0,'Choosing a new input never calls the API');same(progressive.job,null);same(progressive.selection.parentJobId,job.id);same(progressive.details,'');same(progressive.selection.capture.sceneFingerprint,await sceneFingerprint(scene),'Refinement after placement keeps the added tile as its baseline');check(progressive.selection.capture.sort>job.capture.sort);
same(localDraft.kind,'refinement');same(localDraft.parentJobId,job.id);check(localDraft.blob instanceof Blob);same(progressive.pending,null,'A local refinement draft must not lock the form as a pending request');
const savedInput=progressive.selection.blob;progressive.details='Conserva il ponte crollato, aggiungi solo rune.';await progressive.saveRefinement();
const reopened=new TilesController({client:refineClient,drafts});await reopened.open();same(reopened.details,progressive.details,'Text survives reopening');same(reopened.selection.parentJobId,job.id);same(reopened.blobs.source.size,savedInput.size,'Refined image survives reopening');same(reopened.job,null,'Status checks cannot replace a local draft with the older server result');
reopened.settings.resolution='high';await reopened.recapture();same(reopened.error,'');same(localReads,1,'Changing iterative resolution only resamples the selected input');same(reopened.selection.parentJobId,job.id);check(reopened.selection.capture.width>job.capture.width);
const html=renderTiles(reopened);check(html.includes('Genera nuova modifica'));check(html.includes('Immagine di partenza'));check(!html.includes('generazioni disponibili questo mese'),'No monthly limit shown');check(!html.includes('>Usa come nuovo input<'),'A local draft must generate before it can be refined again');
await reopened.cancelRefinement();same(reopened.error,'');same(reopened.job.id,job.id);same(localDraft,null,'Cancelling only removes the unsubmitted local draft');
const readyView=renderTiles({...reopened,busy:false,job:{...job,status:'ready'},urls:{result:'blob:test',source:'blob:original'}});check(readyView.includes('>Usa come nuovo input<'),'Ready results expose the next-input action');
// Follow two progressive generations through the actual submission code. The
// second request must refer to its immediate predecessor, never the raw map.
globalThis.FileReader=class{readAsDataURL(blob){void blob.arrayBuffer().then(bytes=>{this.result=`data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`;this.onload();});}};
let current;const paidRequests=[],localSources=new Map();
const rollingClient={...client,request:async(action='',body,id)=>{
  if(action==='source'||action==='preview')return localSources.get(id);
  if(body){paidRequests.push(body);const blob=new Blob([Buffer.from(body.source.split(',')[1],'base64')],{type:'image/webp'});localSources.set(body.requestId,blob);current={id:body.requestId,parentJobId:body.parentJobId,status:'ready',context:job.context,capture:body.capture,options:body.options,details:body.details};return{job:structuredClone(current)};}
  return{enabled:true,job:structuredClone(current),quota:{used:paidRequests.length,limit:null}};
}};
const chain=new TilesController({client:rollingClient,drafts});chain.enabled=true;chain.origin=rollingClient.identity();chain.activeDraftKey=chain.draftKey();chain.job={...job,id:randomUUID(),status:'ready',capture:{...job.capture,sceneFingerprint:await sceneFingerprint(scene)}};chain.blobs.source=frameBlob;chain.blobs.result=displayed;
const firstParent=chain.job.id;await chain.refine();same(chain.error,'');chain.details='Aggiungi rune.';await chain.generate();same(chain.error,'');same(paidRequests.length,1);same(paidRequests[0].parentJobId,firstParent);check(!localDraft,'Accepted requests release the browser-local retry record');
const intermediate=chain.job.id;await chain.refine();same(chain.error,'');same(paidRequests.length,1,'Choosing the next base is local');chain.details='Rendi le rune blu.';await chain.generate();same(chain.error,'');same(paidRequests.length,2);same(paidRequests[1].parentJobId,intermediate);check(paidRequests[1].parentJobId!==firstParent,'Each step builds on the latest successful result');
chain.close({save:false});
// A changed map cannot be acknowledged simply by excluding the placed tile.
scene.backgroundColor=123;await reopened.refine();check(reopened.error.includes('cambiati'),'Unrelated map changes still require a new selection');
progressive.close({save:false});reopened.close({save:false});

// Eraser coordinates follow the displayed canvas, including CSS downscaling.
same(brushPoint({clientX:300,clientY:150},{left:100,top:50,width:400,height:200},1000,500),{x:500,y:250});
same(brushPoint({clientX:0,clientY:999},{left:100,top:50,width:400,height:200},1000,500),{x:0,y:500});
const strokeCalls=[],strokeContext={save(){},restore(){},beginPath(){},arc(...args){strokeCalls.push(['arc',...args]);},fill(){},moveTo(...args){strokeCalls.push(['move',...args]);},lineTo(...args){strokeCalls.push(['line',...args]);},stroke(){}};
drawErasure(strokeContext,{size:80,points:[{x:12,y:20}]});same(strokeContext.globalCompositeOperation,'destination-out');same(strokeCalls[0],['arc',12,20,40,0,Math.PI*2]);
strokeCalls.length=0;drawErasure(strokeContext,{size:24,points:[{x:10,y:20},{x:100,y:200}]});same(strokeContext.lineWidth,24);same(strokeContext.lineCap,'round');same(strokeCalls,[['move',10,20],['line',100,200]],'Continuous strokes cannot leave gaps between pointer events');
same(await applyEraseMask(displayed,null),displayed);const alphaBlob=new Blob([webp(Math.round(crop.width),Math.round(crop.height))],{type:'image/png'});
const alphaResult=await applyEraseMask(displayed,alphaBlob);same(alphaResult.type,'image/webp');await assert.rejects(()=>applyEraseMask(frameBlob,alphaBlob),/dimensioni/);checks++;
const resizedMask=await resizeEraseMask(alphaBlob,{width:320,height:160}),resizedBitmap=await createImageBitmap(resizedMask);same(resizedMask.type,'image/png');same([resizedBitmap.width,resizedBitmap.height],[320,160]);
const editRecords=new Map(),editDrafts={async get(key){return editRecords.get(key);},async put(key,value){editRecords.set(key,structuredClone(value));return true;},async delete(key){editRecords.delete(key);}};
const eraseJob={...job,id:randomUUID(),status:'ready',capture:{...job.capture,sceneFingerprint:await sceneFingerprint(scene)}};
let editorCalls=0,erasurePaidCalls=0;
const eraseClient={...client,request:async action=>{if(action==='source'||action==='preview')return frameBlob;return{enabled:true,job:eraseJob};}};
const manual=new TilesController({client:eraseClient,drafts:editDrafts,eraser:async args=>{editorCalls++;same(args.blob.type,'image/webp');same(args.brushSize,48);return{mask:alphaBlob,result:alphaResult,brushSize:80};}});
manual.origin=eraseClient.identity();manual.activeDraftKey=manual.draftKey();manual.job=eraseJob;manual.blobs.source=frameBlob;manual.blobs.generated=frameBlob;manual.blobs.result=displayed;
await manual.erase();same(manual.error,'');same(editorCalls,1);same(manual.eraserMask,alphaBlob);same(manual.blobs.result,alphaResult);same(manual.eraserBrush,80);same(editRecords.get(manual.editKey(eraseJob)).kind,'tile-edit');same(editRecords.get(manual.draftKey()),undefined,'Eraser records never overwrite a pending generation or refinement draft');
manual.settings.feather=0;await manual.compose();same(manual.eraserMask,alphaBlob,'Feather changes retain the alpha mask');same(editRecords.get(manual.editKey(eraseJob)).feather,0);
const manualReload=new TilesController({client:eraseClient,drafts:editDrafts});await manualReload.open();same(manualReload.error,'');check(manualReload.eraserMask instanceof Blob,'The alpha mask survives a full controller reload');same(manualReload.settings.feather,0);
const beforeCancelMask=manualReload.eraserMask;manualReload.eraser=async()=>null;await manualReload.erase();same(manualReload.error,'');same(manualReload.eraserMask,beforeCancelMask,'Cancelling the dialog keeps the previous erasures');
const eraserView=renderTiles(manualReload);check(eraserView.includes('data-action="erase"'));check(eraserView.includes('ktc-art--transparent'));check(!renderTiles({...manualReload,job:{...eraseJob,status:'placed'}}).includes('data-action="erase"'),'Existing tiles are not silently overwritten by the eraser');
await manualReload.refine();same(manualReload.error,'');check(manualReload.selection.eraseMask instanceof Blob,'Erased regions are carried to the next progressive step');check(editRecords.get(manualReload.draftKey()).eraseMask instanceof Blob);
manualReload.settings.resolution='high';await manualReload.recapture();same(manualReload.error,'');const highCrop=sourceCrop(manualReload.selection.capture),highMask=await createImageBitmap(manualReload.selection.eraseMask);same([highMask.width,highMask.height],[Math.round(highCrop.width),Math.round(highCrop.height)],'Progressive resolution changes also resize the alpha mask');
let erasedChild;const childSources=new Map();manualReload.client={...eraseClient,request:async(action='',body,id)=>{
  if(action==='source'||action==='preview')return childSources.get(id);
  if(body){erasurePaidCalls++;check(!('eraseMask'in body),'The mask stays local and is not sent to the AI');const input=new Blob([Buffer.from(body.source.split(',')[1],'base64')],{type:'image/webp'});childSources.set(body.requestId,input);erasedChild={id:body.requestId,parentJobId:body.parentJobId,status:'ready',context:eraseJob.context,capture:body.capture,options:body.options,details:body.details};return{job:erasedChild};}
  return{enabled:true,job:erasedChild};
}};
same(erasurePaidCalls,0);manualReload.enabled=true;manualReload.details='Aggiungi rune senza riempire le parti cancellate.';await manualReload.generate();same(manualReload.error,'');same(erasurePaidCalls,1,'Only an explicit Generate action makes a new request');check(manualReload.eraserMask instanceof Blob,'The next result still receives the local alpha mask');same(manualReload.eraserJobId,erasedChild.id);
manual.close({save:false});manualReload.close({save:false});

// Browser-local reference preparation, recovery and progressive submissions.
same(referenceSize(3000,2000),{width:1536,height:1024});same(referenceSize(32,8),{width:32,height:8});
await assert.rejects(()=>prepareReference(new Blob(['<svg/>'],{type:'image/svg+xml'})),/PNG/);checks++;
assert.throws(()=>checkReferences(Array.from({length:MAX_REFERENCES+1},()=>({blob:new Blob()}))),/reference/);checks++;
const localReferences=await prepareReference(new File([webp(2048,1024)],'stone.webp',{type:'image/webp'}));same([localReferences.width,localReferences.height],[1536,768]);same(localReferences.blob.type,'image/webp');
let referencesCurrent=null,loseReferenceResponse=false;const referenceRecords=new Map(),referencePosts=[],referenceSources=new Map(),referenceJobs=new Map(),referenceDrafts={async get(key){return referenceRecords.get(key);},async put(key,value){referenceRecords.set(key,structuredClone(value));return true;},async delete(key){referenceRecords.delete(key);}};
const referencesClient={...client,request:async(action='',body,id)=>{
  if(action==='source'||action==='preview')return referenceSources.get(id)?.source;
  if(/^reference-/.test(action))return referenceSources.get(id)?.references[Number(action.split('-')[1])-1];
  if(body){referencePosts.push(structuredClone(body));if(referenceJobs.has(body.requestId))return{job:referenceJobs.get(body.requestId)};const decode=url=>new Blob([Buffer.from(url.split(',')[1],'base64')],{type:'image/webp'});referenceSources.set(body.requestId,{source:decode(body.source),references:(body.references||[]).map(reference=>decode(reference.image))});referencesCurrent={id:body.requestId,parentJobId:body.parentJobId,status:'ready',context:job.context,capture:body.capture,options:body.options,details:body.details,references:(body.references||[]).map(({image,...metadata})=>metadata)};referenceJobs.set(body.requestId,referencesCurrent);if(loseReferenceResponse){loseReferenceResponse=false;throw new Error('Response lost');}return{job:referencesCurrent};}
  return{enabled:true,referencesVersion:1,job:referencesCurrent};
}};
const referenceController=new TilesController({client:referencesClient,drafts:referenceDrafts});referenceController.origin=referencesClient.identity();referenceController.activeDraftKey=referenceController.draftKey();referenceController.enabled=true;referenceController.referenceSupport=true;referenceController.fresh=true;referenceController.selection={blob:frameBlob,capture:{...job.capture,sceneFingerprint:await sceneFingerprint(scene)}};referenceController.setBlob('source',frameBlob);
const initialReferenceTarget=structuredClone(referenceController.selection.capture);
await referenceController.addReferenceFiles([new File([webp(256,128)],'<stone>.webp',{type:'image/webp'}),new File([webp(128,256)],'rune.webp',{type:'image/webp'})]);same(referenceController.error,'');same(referencePosts.length,0,'Attaching is local and free');same(referenceController.references.length,2);same(referenceController.selection.capture,initialReferenceTarget,'Attachments cannot replace the editable map');
referenceController.references[0].note='Mantieni questa pietra.';referenceController.details='Usa la reference 2 per il pavimento.';await referenceController.saveRefinement();referenceController.close({save:false});
const referenceReload=new TilesController({client:referencesClient,drafts:referenceDrafts});await referenceReload.open();same(referenceReload.error,'');same(referenceReload.job,null);same(referenceReload.references.length,2);same(referenceReload.references[0].note,'Mantieni questa pietra.');same(referenceReload.details,referenceController.details);same(referenceReload.selection.capture,initialReferenceTarget);check(referenceReload.references.every(reference=>reference.blob instanceof Blob),'Files survive reopening before the first generation');
const referencesHtml=renderTiles(referenceReload);check(referencesHtml.includes('1 · Mappa da modificare'));check(referencesHtml.includes('Rimuovi reference 2'));check(referencesHtml.includes('Rimuovi reference 3'));check(referencesHtml.includes('&lt;stone&gt;.webp'),'Uploaded file names are HTML-escaped');
referenceReload.referenceSupport=false;await referenceReload.generate();check(referenceReload.error.includes('Aggiorna il Worker'));same(referencePosts.length,0,'An older Worker cannot silently ignore references and spend credits');check(!referenceReload.pending,'A capability error keeps the local draft editable');
referenceReload.referenceSupport=true;loseReferenceResponse=true;await referenceReload.generate();same(referenceReload.error,'Response lost');check(referenceReload.pending.references[0].blob instanceof Blob);const frozenReferenceId=referenceReload.pending.id;
referenceReload.references[0].note='Local change after ambiguous send';await referenceReload.generate();same(referenceReload.error,'');same(referencePosts.length,2);same(referencePosts[0],referencePosts[1],'A retry retains the exact map, reference pixels, order, guidance and UUID');same(referenceReload.job.id,frozenReferenceId);same(referenceReload.references[0].note,'Mantieni questa pietra.');
check(!referenceRecords.has(referenceReload.draftKey()),'Accepted requests release only the pending record');
const finishedReload=new TilesController({client:referencesClient,drafts:referenceDrafts});await finishedReload.open();same(finishedReload.error,'');same(finishedReload.references.length,2,'Completed references are restored through private image routes');
await finishedReload.refine();same(finishedReload.error,'');same(finishedReload.references.length,2);same(referencePosts.length,2,'Using as input does not generate another image');
await finishedReload.removeReference(0);same(finishedReload.error,'');same(finishedReload.references[0].name,'rune.webp');same(finishedReload.selection.capture,initialReferenceTarget,'Removing a reference preserves the primary map');
await finishedReload.cancelRefinement();same(finishedReload.error,'');same(finishedReload.references.length,2,'Cancelling refinement restores the original reference list');same(referencePosts.length,2);
await finishedReload.refine();finishedReload.details='Mantieni la pietra e aggiungi rune.';await finishedReload.generate();same(finishedReload.error,'');same(referencePosts.length,3);same(referencePosts[2].parentJobId,frozenReferenceId);same(referencePosts[2].references,referencePosts[0].references,'Progressive edits retain secondary references in the same order');
const primaryAfterReferences=referencePosts[2].source;check(primaryAfterReferences.startsWith('data:image/webp;base64,'));finishedReload.reset();same(finishedReload.references.length,0,'Changing context clears local attachments');same(finishedReload.referenceUrls.length,0);
referenceReload.close({save:false});finishedReload.close({save:false});
console.log(`Tiles Creator: ${checks} checks passed. Ordered private secondary references, recovery and progressive edits, adjustable eraser, unlimited authenticated generations, idempotency, capture and placement. No live API, real scene or existing KV writes.`);
