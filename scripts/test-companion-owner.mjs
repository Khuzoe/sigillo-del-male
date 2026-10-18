// Real Worker routes with temporary local D1, KV and R2; never production bindings.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from '../workers/main-worker/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../workers/main-worker/node_modules/miniflare/dist/src/index.js';
const secret='companion-owner-local';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../workers/main-worker/src/index.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022'});
const runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',kvNamespaces:['SIGILLO_KV'],kvPersist:false,d1Databases:['POLL_DB'],d1Persist:false,r2Buckets:['MEDIA_BUCKET'],r2Persist:false,
 bindings:{JWT_SECRET:secret,GLOBAL_ADMIN_ACCOUNT_IDS:'admin',CAMPAIGN_EDITOR_ACCOUNT_IDS:'test:dm;legacy:dm',SKILL_TREE_D1_CAMPAIGNS:'test',SKILL_TREE_DEFINITION_D1_CAMPAIGNS:'test',DISCORD_BOT_TOKEN:''}});
let checks=0;
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
function jwt(account){const text=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({accountId:account,username:account,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')].join('.');return text+'.'+createHmac('sha256',secret).update(text).digest('base64url');}
async function call(campaign,path,body,account='alice') {
 const response=await runtime.dispatchFetch(`https://local.test${path}?campaign=${campaign}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt(account)},...(body?{body:JSON.stringify(body)}:{})});
 return{status:response.status,body:await response.json()};
}
async function upload(form) {
 const request=new Request('https://local.test/media/upload',{method:'POST',headers:{Authorization:'Bearer '+jwt('alice')},body:form});
 return runtime.dispatchFetch(request.url,{method:'POST',headers:Object.fromEntries(request.headers),body:await request.arrayBuffer()});
}
const subject='npc-world-companion';
const otherSubject='npc-world-other';
const actor={worldId:'world',actorId:'companion',id:'world:companion',actorType:'npc',name:'Companion',ownerCharacterId:'hero',ownerAccountIds:['alice','co-owner'],relationshipType:'companion',revision:1,
 visibility:{state:'dm'},definition:{attributes:{hp:{max:50}},items:[],effects:[]},media:{},runtime:{}};
const other={...actor,actorId:'other',id:'world:other',ownerAccountIds:['bob']};
const tree=(id,owner)=>({id,name:id,characterId:owner,ownerCharacterId:owner,shared:false,scope:'character',nodes:[{id:'first',title:'First',editorStatus:'draft',desc:'<p>Original</p>'}]});
const ownTree=tree('companion-training',subject),otherTree=tree('other-training',otherSubject),shared={id:'campaign-party',shared:true,scope:'campaign',nodes:[{id:'party'}]};
try {
 const db=await runtime.getD1Database('POLL_DB'),kv=await runtime.getKVNamespace('SIGILLO_KV');
 for(const name of ['0002_skill_tree_states.sql','0003_skill_tree_definitions.sql']){const sql=await readFile(new URL('../workers/main-worker/migrations/'+name,import.meta.url),'utf8');await db.batch(sql.split(';').filter(x=>x.trim()).map(x=>db.prepare(x)));}
 for(const campaign of ['test','legacy']) {
  const indexKey=`campaign:${campaign}:managed-actors:index`,definitionKey=`campaign:${campaign}:data:skill-trees:override`,stateKey=`campaign:${campaign}:data:skill-tree-states:override`;
  await kv.put(indexKey,JSON.stringify({data:[actor,other]}));
  await kv.put(`campaign:${campaign}:managed-actor:world:companion`,JSON.stringify({...actor,campaignId:campaign}));
  const state={id:`${campaign}-companion-training-${subject}`,key:`${campaign}-companion-training-${subject}`,treeKey:ownTree.id,characterId:subject,ownerAccountId:'dm',scope:'character',shared:false,unlocked:[],levels:{},treeProgress:10};
  const otherState={...state,id:`${campaign}-other-training-${otherSubject}`,key:`${campaign}-other-training-${otherSubject}`,treeKey:otherTree.id,characterId:otherSubject,ownerAccountId:'alice',treeProgress:99};
  const rawDefinitions=JSON.stringify({version:5,data:[ownTree,otherTree,shared]}),rawStates=JSON.stringify({version:5,data:[state,otherState]});
  await kv.put(definitionKey,rawDefinitions);await kv.put(stateKey,rawStates);
  const actorPath='/api/managed-actors/world/companion';
  let response=await call(campaign,actorPath);
  equal(response.status,200);equal(response.body.data.permissions.isOwner,true);equal(response.body.data.permissions.canEdit,true);equal(response.body.data.permissions.canEditStats,true);equal(response.body.data.permissions.isEditor,false);
  equal((await call(campaign,actorPath,undefined,'bob')).status,403);
  equal((await call(campaign,actorPath,undefined,'co-owner')).body.data.permissions.canEdit,true,'Every current owner can edit the companion');
  for(const command of [
   {kind:'actor.update',patches:[{path:'system.attributes.hp.max',value:60}]},
   {kind:'item.create',document:{name:'New ability',type:'feat',system:{description:{value:'Test'}}}},
   {kind:'effect.create',document:{name:'New effect',changes:[]}}
  ]) equal((await call(campaign,actorPath+'/commands',{expectedRevision:1,...command})).status,202,JSON.stringify(command));
  equal((await call(campaign,actorPath+'/commands',{expectedRevision:1,kind:'actor.update',patches:[{path:'name',value:'Intruder'}]},'bob')).status,403);
  const profile=await call(campaign,actorPath+'/profile');
  equal((await call(campaign,actorPath+'/profile',{expectedRevision:profile.body.data.revision,data:{...profile.body.data,role:'Edited by owner'}})).status,200);
  const definitions=()=>call(campaign,'/api/data/skill-trees');
  const states=()=>call(campaign,'/api/data/skill-tree-states');
  async function saveTree(value,account='alice') {
   const before=(await definitions()).body;
   return call(campaign,'/api/data/skill-trees',{tree:value,...(before.treeRevisions?{expectedTreeRevision:before.treeRevisions[value.id]??0}:{expectedVersion:before.version})},account);
  }
  response=await saveTree({...ownTree,name:'Edited by owner',nodes:[{...ownTree.nodes[0],desc:'<p>Changed</p>'}]});equal(response.status,200);
  equal((await definitions()).body.data.find(t=>t.id===ownTree.id).nodes[0].desc,'<p>Changed</p>');
  equal((await saveTree({...otherTree,characterId:subject,ownerCharacterId:subject})).status,403,'Owner cannot claim another NPC tree');
  equal((await saveTree({...ownTree,shared:true})).status,403,'Owner cannot turn a personal tree into a campaign tree');
  equal((await saveTree({...ownTree,id:shared.id})).status,403,'Shared IDs cannot be overwritten');
  equal((await saveTree({...ownTree,characterIds:[otherSubject]})).status,403,'Additional owners cannot widen scope');
  equal((await saveTree(ownTree,'bob')).status,403);
  const created=tree('new-companion-tree',subject);equal((await saveTree(created)).status,200,'Owner creates a personal companion tree');
  const form=new FormData();form.set('campaignId',campaign);form.set('folder','skill-trees/'+created.id);form.set('file',new File(['RIFFtestWEBP'],'background.webp',{type:'image/webp'}));
  let uploaded=await upload(form);equal(uploaded.status,200,await uploaded.text());
  form.set('folder','skill-trees/'+otherTree.id);uploaded=await upload(form);equal(uploaded.status,403);
  async function saveState(value) {
   const before=(await states()).body;
   return call(campaign,'/api/data/skill-tree-states',before.stateRevisions?{state:value,expectedStateRevision:before.stateRevisions[value.id]??0}
    :{data:before.data.map(entry=>entry.id===value.id?value:entry),expectedVersion:before.version});
  }
  response=await saveState({...state,ownerAccountId:'alice',treeProgress:55,unlocked:['first']});equal(response.status,200);
  equal((await states()).body.data.find(s=>s.id===state.id).treeProgress,55);equal((await states()).body.data.find(s=>s.id===state.id).unlocked,['first']);
  response=await saveState({...otherState,treeProgress:0});if(campaign==='test')equal(response.status,403);
  equal((await states()).body.data.find(s=>s.id===otherState.id).treeProgress,99,'Forged ownerAccountId grants no access');
  const beforeDelete=(await definitions()).body;
  const invalidBulk=await call(campaign,'/api/data/skill-trees',{expectedVersion:beforeDelete.version,data:beforeDelete.data.map(t=>t.id===ownTree.id?{...t,shared:true}:t)});
  equal(invalidBulk.status,403,'Invalid updates are rejected rather than deleting the owned tree');
  equal((await definitions()).body.version,beforeDelete.version);
  response=await call(campaign,'/api/data/skill-trees',{expectedVersion:beforeDelete.version,data:beforeDelete.data.filter(t=>t.id!==created.id).map(t=>t.id===shared.id?{...t,name:'Intruder'}:t)});
  equal(response.status,200);equal((await definitions()).body.data.some(t=>t.id===created.id),false);equal((await definitions()).body.data.find(t=>t.id===shared.id),shared,'Bulk edits preserve campaign trees');equal((await definitions()).body.data.find(t=>t.id===otherTree.id),otherTree);
  if(campaign==='test'){equal(await kv.get(definitionKey),rawDefinitions,'D1 writes leave original KV definitions intact');equal(await kv.get(stateKey),rawStates,'D1 writes leave original KV states intact');}
  await kv.put(indexKey,JSON.stringify({data:[{...actor,ownerAccountIds:['bob']},other]}));
  equal((await saveTree(ownTree)).status,403,'Revoked ownership cannot edit definitions');
  response=await saveState({...state,ownerAccountId:'alice',treeProgress:0});if(campaign==='test')equal(response.status,403);
  equal((await states()).body.data.find(s=>s.id===state.id).treeProgress,55,'Revoked ownership cannot edit progress');
 }
 console.log(`Companion ownership: ${checks} checks passed on D1 and legacy KV.`);
} finally {await runtime.dispose();}
