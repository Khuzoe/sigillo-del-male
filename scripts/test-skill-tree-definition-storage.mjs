import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from '../workers/main-worker/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../workers/main-worker/node_modules/miniflare/dist/src/index.js';
import {SkillTreeDefinitionStore} from '../workers/main-worker/src/skill-tree-definition-store.js';
const secret='definitions-local-test';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../workers/main-worker/src/index.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022'});
const runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',kvNamespaces:['SIGILLO_KV'],kvPersist:false,d1Databases:['POLL_DB'],d1Persist:false,
 bindings:{JWT_SECRET:secret,GLOBAL_ADMIN_ACCOUNT_IDS:'admin',CAMPAIGN_EDITOR_ACCOUNT_IDS:'test:dm',SKILL_TREE_D1_CAMPAIGNS:'test',
 SKILL_TREE_DEFINITION_D1_CAMPAIGNS:'test,other,empty,broken,duplicate',SKILL_TREE_DEFINITION_WRITES_PAUSED_CAMPAIGNS:'paused',DISCORD_BOT_TOKEN:''}});
let checks=0;
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const ok=(value,label)=>{assert.ok(value,label);checks++;};
async function rejects(promise){await assert.rejects(promise);checks++;}
function jwt(account){const text=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({accountId:account,username:account,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')].join('.');return text+'.'+createHmac('sha256',secret).update(text).digest('base64url');}
async function call(path,body,account='admin') {const res=await runtime.dispatchFetch('https://local.test'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://khuzoe.github.io',...(account?{Authorization:'Bearer '+jwt(account)}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json(),headers:res.headers};}
const path='/api/data/skill-trees?campaign=test',key=campaign=>`campaign:${campaign}:data:skill-trees:override`;
const tree=id=>({id,name:id,nodes:[{id:'one',title:'One',levels:[{desc:'First'},{desc:'Second'}],externalRequirements:[{id:'ore',quantity:8}]}],connections:[],custom:{preserve:true}});
const a=tree('a'),b={id:'b',tree:{...tree('b'),shared:true},unknown:'wrapper'};
const patch=(record,revision)=>({campaignId:'test',tree:record,expectedTreeRevision:revision});
try{
 const db=await runtime.getD1Database('POLL_DB'),kv=await runtime.getKVNamespace('SIGILLO_KV');
 for(const name of ['0001_polls.sql','0002_skill_tree_states.sql','0003_skill_tree_definitions.sql','0003_skill_tree_definitions.sql']){const sql=await readFile(new URL('../workers/main-worker/migrations/'+name,import.meta.url),'utf8');await db.batch(sql.split(';').filter(x=>x.trim()).map(x=>db.prepare(x)));}
 const raw=JSON.stringify({campaignId:'test',version:41,updatedAt:'2026-10-01',updatedBy:'original',unknown:{keep:true},data:[a,b]},null,2);
 const otherRaw=JSON.stringify({version:7,data:[tree('other')]});
 await kv.put(key('test'),raw);await kv.put(key('other'),otherRaw);await kv.put(key('broken'),'{invalid');await kv.put(key('duplicate'),JSON.stringify({data:[a,a]}));
 const imported=await Promise.all(Array.from({length:4},()=>call(path)));
 for(const result of imported){equal(result.status,200);equal(result.body.data,[a,b]);equal(result.body.version,41);equal(result.body.treeRevisions,{a:1,b:1});}
 equal((await db.prepare("SELECT original_raw FROM skill_tree_definition_documents WHERE campaign_id='test'").first()).original_raw,raw);
 equal((await call('/api/data/skill-trees?campaign=other')).body.version,7);
 equal((await call('/api/data/skill-trees?campaign=empty')).body.data,null);
 for(const campaign of ['broken','duplicate']){equal((await call('/api/data/skill-trees?campaign='+campaign)).body.code,'SKILL_TREE_DEFINITION_IMPORT_INVALID');equal((await db.prepare('SELECT COUNT(*) AS n FROM skill_tree_definition_documents WHERE campaign_id=?').bind(campaign).first()).n,0);}
 equal((await call(path,patch(a,1),'alice')).status,403);equal((await call(path,patch(a,1),'')).status,401);
 const different=await Promise.all([call(path,patch({...a,name:'Changed A'},1),'dm'),call(path,patch({...b,unknown:'Changed B'},1),'dm')]);for(const result of different)equal(result.status,200);
 let doc=(await call(path)).body;equal(doc.version,43);equal(doc.data.map(x=>x.name||x.unknown),['Changed A','Changed B']);
 const same=await Promise.all([call(path,patch({...a,name:'first'},2)),call(path,patch({...a,name:'second'},2))]);equal(same.map(x=>x.status).sort(),[200,409]);
 const beforeStale=(await call(path)).body;equal(beforeStale.treeRevisions.a,3);
 equal((await call(path,patch({...a,name:'stale'},2))).status,409);equal((await call(path)).body,beforeStale,'Failed CAS cannot reuse winner mutation');
 equal((await call(path,patch(a,'3'))).status,409);
 const create=await Promise.all([call(path,patch(tree('new'),0)),call(path,patch(tree('new'),0))]);equal(create.map(x=>x.status).sort(),[200,409]);
 equal((await call(path,patch({id:'invalid'},0))).status,400);
 const store=new SkillTreeDefinitionStore({POLL_DB:db,SIGILLO_KV:kv},'test');
 const originalStatement=store.statement.bind(store);store.statement=(sql,...params)=>sql.startsWith('UPDATE skill_tree_definition_documents')?db.prepare("UPDATE skill_tree_definition_documents SET metadata='{invalid' WHERE campaign_id='test'"):originalStatement(sql,...params);
 const beforeRollback=await store.getDocument();await rejects(store.saveTree(a,3,{}));equal(await store.getDocument(),beforeRollback,'Target mutation rolls back when metadata fails');
 const clean=new SkillTreeDefinitionStore({POLL_DB:db,SIGILLO_KV:kv},'test');
 const old=(await call(path)).body;
 const bulk=await Promise.all([call(path,{campaignId:'test',data:old.data,expectedVersion:old.version}),call(path,{campaignId:'test',data:old.data,expectedVersion:old.version})]);equal(bulk.map(x=>x.status).sort(),[200,409]);
 equal((await call(path,{campaignId:'test',tree:a})).status,409);
 let latest=(await call(path)).body;
 equal((await call(path,{campaignId:'test',tree:{...a,name:'legacy'},expectedVersion:latest.version})).status,200);
 latest=(await call(path)).body;equal(latest.data.find(x=>x.id==='a').name,'legacy');
 const afterDelete=await clean.replaceCollection(latest.data.filter(x=>x.id!=='new'),latest.version,{});equal(afterDelete.treeRevisions.new,2);
 await rejects(clean.saveTree(tree('new'),0,{}));equal(await clean.getDocument(),afterDelete);
 const restored=await clean.saveTree(tree('new'),2,{});equal(restored.treeRevisions.new,3);
 const race=await Promise.allSettled([clean.saveTree({...a,name:'race'},restored.treeRevisions.a,{}),clean.replaceCollection(restored.data,restored.version,{})]);ok(race.some(x=>x.status==='fulfilled'));equal((await clean.getDocument()).data.find(x=>x.id==='a').name,'race');
 const failing=new SkillTreeDefinitionStore({POLL_DB:db,SIGILLO_KV:kv},'test');const prepared=failing.statement.bind(failing);
 failing.statement=(sql,...params)=>sql.startsWith('INSERT INTO skill_tree_definitions')?db.prepare("INSERT INTO skill_tree_definitions (campaign_id,tree_id,revision,position,payload) VALUES ('test','bad',1,0,'{invalid')"):prepared(sql,...params);
 const safe=await clean.getDocument();await rejects(failing.replaceCollection([],safe.version,{}));equal(await clean.getDocument(),safe,'Full replacement failure preserves metadata, tombstones and trees');
 const empty=new SkillTreeDefinitionStore({POLL_DB:db,SIGILLO_KV:kv},'empty');equal((await empty.saveTree(tree('first'),0,{})).data,[tree('first')]);equal(await kv.get(key('empty')),null);
 await rejects(async()=>new SkillTreeDefinitionStore({SIGILLO_KV:kv},'test').getDocument());
 const noKv=new SkillTreeDefinitionStore({POLL_DB:db,SIGILLO_KV:{get(){throw Error('Unexpected KV read');}}},'test');equal((await noKv.getDocument()).version,(await clean.getDocument()).version);
 equal((await call('/api/data/skill-trees?campaign=paused',{campaignId:'paused',tree:a,expectedVersion:0})).body.code,'SKILL_TREE_DEFINITION_WRITES_PAUSED');equal((await call('/api/data/skill-trees?campaign=paused')).status,200);
 equal((await call('/api/data/skill-trees?campaign=disabled',{campaignId:'disabled',tree:a,expectedVersion:0})).status,200);ok(await kv.get(key('disabled')));
 equal((await call('/api/bootstrap/character?campaign=test&id=hero')).body.data['skill-trees'].data,(await clean.getDocument()).data);
 equal((await call('/api/sync/status?campaign=test&collections=skill-trees')).body.collections['skill-trees'].source,'d1');
 equal((await call('/api/skill-trees/storage/export?campaign=test',undefined,'dm')).status,403);
 const exported=await call('/api/skill-trees/storage/export?campaign=test');equal(exported.status,200);equal(exported.body.originalRaw,raw);equal(JSON.parse(exported.body.kvDocuments[0].value).unknown,{keep:true});ok(exported.headers.get('cache-control').includes('no-store'));
 // Shared progress permissions must read the new D1 definitions, not the old KV copy.
 await kv.put('campaign:test:data:characters:override',JSON.stringify({data:[{id:'hero',accountId:'alice'}]}));
 const state={id:'test-a-hero',key:'test-a-hero',treeKey:'a',characterId:'hero',ownerAccountId:'alice',shared:false,scope:'character',unlocked:[]};
 await kv.put('campaign:test:data:skill-tree-states:override',JSON.stringify({version:1,data:[state]}));
 const prior=await clean.getDocument();await clean.saveTree({...a,shared:true},prior.treeRevisions.a,{});
 equal((await call('/api/data/skill-tree-states?campaign=test',{campaignId:'test',state,expectedStateRevision:1},'alice')).status,403,'Shared state protection follows current D1 definition');
 equal(await kv.get(key('test')),raw);equal(await kv.get(key('other')),otherRaw);
 // The actual character-page serializer adopts the complete server snapshot and next revision.
 const page=await readFile(new URL('../assets/js/pages/character-main.js',import.meta.url),'utf8');
 const functions=page.slice(page.indexOf('function normalizeSkillTreesCollection('),page.indexOf('async function loadSkillTreeStates('));
 let sent;const sandbox={console,normalizeText:x=>String(x).toLowerCase(),normalizeSkillTreeNodeIds:x=>x,readSharedAuthToken:()=> 'test',
 window:{CriptaApp:{api:{post:async(_,body)=>{sent=body;return {version:50,data:[a,b],treeRevisions:{a:4,b:2}};}}}}};
 vm.createContext(sandbox);vm.runInContext('let skillsVersion=41,skillsMemoryCache={},skillTreeDefinitionRevisions={a:3};\n'+functions,sandbox);
 const saved=await vm.runInContext(`saveSingleSkillTreeData('a',${JSON.stringify(a)},{a:${JSON.stringify(a)}})`,sandbox);
 equal(sent.expectedTreeRevision,3);equal(sent.expectedVersion,undefined);equal(Object.keys(saved.normalizedTrees),['a','b']);
 equal(vm.runInContext('skillTreeDefinitionRevisions.a',sandbox),4);
 sandbox.window.CriptaApp.api.post=async()=>{throw Error('Conflict');};await rejects(vm.runInContext(`saveSingleSkillTreeData('a',${JSON.stringify(a)},{})`,sandbox));equal(vm.runInContext('skillTreeDefinitionRevisions.a',sandbox),4);
 // The managed-actor host uses per-tree revisions and keeps authoritative empty collections.
 const managedSource=await readFile(new URL('../assets/js/shared/managed-player-extensions.js',import.meta.url),'utf8');
 let managedBody,staticLoads=0;const managedSandbox={console,URL,window:{CriptaApp:{utils:{normalizeKey:x=>String(x).toLowerCase()},
   api:{get:async()=>({version:8,data:[],treeRevisions:{a:2}}),post:async(_,body)=>{managedBody=body;return {version:9,data:[a,b],treeRevisions:{a:3,b:1}};}},
   data:{json:async()=>{staticLoads++;return {old:tree('old')};}}}}};
 vm.runInNewContext(managedSource.replace(/\}\)\(\);\s*$/,`globalThis.api={loadTrees,saveTree,cache:()=>skills,revisions:()=>treeRevisions};})();`),managedSandbox);
 await managedSandbox.api.loadTrees();equal(Object.keys(managedSandbox.api.cache()),[]);equal(staticLoads,0,'An authoritative empty collection never restores static trees');
 const managedSaved=await managedSandbox.api.saveTree('a',a,{a});equal(managedBody.expectedTreeRevision,2);equal(Object.keys(managedSaved.normalizedTrees),['a','b']);equal(managedSandbox.api.revisions().a,3);
 // Shared editor cache adopts the server snapshot instead of the local partial collection.
 const sharedSource=await readFile(new URL('../assets/js/shared/character-skill-tree.js',import.meta.url),'utf8');
 let adopted;const sharedSandbox={console,window:{},URL};
 vm.runInNewContext(sharedSource.replace(/\}\)\(\);\s*$/,`globalThis.api={applySkillTreeRuntime,saveSingleSkillTreeData};})();`),sharedSandbox);
 sharedSandbox.api.applySkillTreeRuntime({saveSkillTreeData:async()=>({normalizedTrees:{a,b},version:9,treeRevisions:{a:3,b:1}}),setSkillsCache:(trees,version,revisions)=>{adopted={trees,version,revisions};}});
 await sharedSandbox.api.saveSingleSkillTreeData('a',a,{a});equal(Object.keys(adopted.trees),['a','b']);equal(adopted.revisions.a,3);
 console.log(`Skill tree definitions D1: ${checks} checks passed.`);
}finally{await runtime.dispose();}
