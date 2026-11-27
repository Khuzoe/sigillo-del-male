import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from '../workers/main-worker/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../workers/main-worker/node_modules/miniflare/dist/src/index.js';
import {SkillTreeDefinitionStore} from '../workers/main-worker/src/skill-tree-definition-store.js';
import {campaign as guardianCampaign, treeId as guardianId, prepareValdorGrades, migrateOnline} from '../assets/js/shared/valdor-grades.mjs';
const secret='definitions-local-test';
const staticBaseline = {starter:{nodes:[{id:'start',extra:'keep'}]},'npc-existing':{ownerCharacterId:'npc-owned',nodes:[]}};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../workers/main-worker/src/index.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022'});
const runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',kvNamespaces:['SIGILLO_KV'],kvPersist:false,d1Databases:['POLL_DB'],d1Persist:false,
 outboundService:async request=>new URL(request.url).pathname.endsWith('/skills.json') ? Response.json(staticBaseline) : new Response(null,{status:404}),
 bindings:{JWT_SECRET:secret,GLOBAL_ADMIN_ACCOUNT_IDS:'admin',CAMPAIGN_EDITOR_ACCOUNT_IDS:'test:dm',SKILL_TREE_D1_CAMPAIGNS:'test,sheet',
 SKILL_TREE_DEFINITION_D1_CAMPAIGNS:'test,sheet,other,empty,broken,duplicate,fresh',SKILL_TREE_DEFINITION_WRITES_PAUSED_CAMPAIGNS:'paused',DISCORD_BOT_TOKEN:''}});
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
 const sheetSource=await readFile(new URL('../assets/js/shared/skill-tree-sheet.js',import.meta.url),'utf8');
 const bootstrapCalls=[];
 const bootEnv={URLSearchParams,window:{location:{search:''},CriptaApp:{api:{get:async(path,options)=>{bootstrapCalls.push(options.query);return {ok:true};}}}}};
 vm.runInNewContext(await readFile(new URL('../assets/js/shared/character-data-service.js',import.meta.url),'utf8'),bootEnv);
 const loader=bootEnv.window.CriptaCharacterData;
 await loader.loadBootstrap('hero','player',{campaignId:'test',separateSkillTrees:true});
 await loader.loadBootstrap('hero','player',{campaignId:'test'});
 await loader.loadBootstrap('hero','player',{campaignId:'test',separateSkillTrees:true});
 equal(bootstrapCalls.map(q=>q.skillTrees),['separate',undefined]);
 vm.createContext(sandbox);vm.runInContext(sheetSource,sandbox);
 vm.runInContext('let skillsVersion=41,skillsMemoryCache={},skillTreeDefinitionRevisions={a:3},staticSkillRecords=null;\n'+functions,sandbox);
 const saved=await vm.runInContext(`saveSingleSkillTreeData('a',${JSON.stringify(a)},{a:${JSON.stringify(a)}})`,sandbox);
 equal(sent.expectedTreeRevision,3);equal(sent.expectedVersion,undefined);equal(Object.keys(saved.normalizedTrees),['a','b']);
 equal(vm.runInContext('skillTreeDefinitionRevisions.a',sandbox),4);
 sandbox.window.CriptaApp.api.post=async()=>{throw Error('Conflict');};await rejects(vm.runInContext(`saveSingleSkillTreeData('a',${JSON.stringify(a)},{})`,sandbox));equal(vm.runInContext('skillTreeDefinitionRevisions.a',sandbox),4);
 sandbox.window.CriptaApp.api.post=async(_,body)=>({saved:true,treeId:body.tree.id,treeRevision:body.expectedTreeRevision+1,version:53});
 const compactPage=await vm.runInContext(`saveSingleSkillTreeData('a',${JSON.stringify({...a,name:'Updated'})},{},4)`,sandbox);
 equal(Object.keys(compactPage.normalizedTrees),['a','b']);equal(compactPage.treeRevisions.b,2);equal(compactPage.treeRevisions.a,5);
 await rejects(vm.runInContext(`saveSingleSkillTreeData('a',${JSON.stringify(a)},{},4)`,sandbox));
 // The managed-actor host uses per-tree revisions and keeps authoritative empty collections.
 const managedSource=await readFile(new URL('../assets/js/shared/managed-player-extensions.js',import.meta.url),'utf8');
 let managedBody,staticLoads=0;const managedSandbox={console,URL,window:{CriptaApp:{utils:{normalizeKey:x=>String(x).toLowerCase()},
   api:{get:async()=>({version:8,data:[],treeRevisions:{a:2}}),post:async(_,body)=>{managedBody=body;return {version:9,data:[a,b],treeRevisions:{a:3,b:1}};}},
   auth:{getToken:()=>'test'},data:{json:async()=>{staticLoads++;return {old:tree('old')};}}}}};
 vm.runInNewContext(sheetSource,managedSandbox);
 vm.runInNewContext(managedSource.replace(/\}\)\(\);\s*$/,`globalThis.api={loadTrees,saveTree,cache:()=>skills,revisions:()=>treeRevisions};})();`),managedSandbox);
 await managedSandbox.api.loadTrees();equal(Object.keys(managedSandbox.api.cache()),[]);equal(staticLoads,0,'An authoritative empty collection never restores static trees');
 const managedSaved=await managedSandbox.api.saveTree('a',a,{a});equal(managedBody.expectedTreeRevision,2);equal(Object.keys(managedSaved.normalizedTrees),['a','b']);equal(managedSandbox.api.revisions().a,3);
 // Shared editor cache adopts the server snapshot instead of the local partial collection.
 const sharedSource=await readFile(new URL('../assets/js/shared/character-skill-tree.js',import.meta.url),'utf8');
 let adopted;const sharedSandbox={console,window:{},URL};
 vm.runInNewContext(sharedSource.replace(/\}\)\(\);\s*$/,`globalThis.api={applySkillTreeRuntime,saveSingleSkillTreeData};})();`),sharedSandbox);
 sharedSandbox.api.applySkillTreeRuntime({saveSkillTreeData:async()=>({normalizedTrees:{a,b},version:9,treeRevisions:{a:3,b:1}}),setSkillsCache:(trees,version,revisions)=>{adopted={trees,version,revisions};}});
 await sharedSandbox.api.saveSingleSkillTreeData('a',a,{a});equal(Object.keys(adopted.trees),['a','b']);equal(adopted.revisions.a,3);
 // Use an isolated campaign in the temporary database. Never change the progress collection.
 const guardianStore = new SkillTreeDefinitionStore({POLL_DB:db,SIGILLO_KV:kv},guardianCampaign);
 const duration = hours => '<p>Puoi restare qui e puoi restarci per '+hours+'.</p>';
 const original = {id:guardianId,ownerCharacterId:'valdor',extra:{keep:true},nodes:[
   {id:'inizio',title:'Cavità',desc:duration('1 ora'),levels:[{desc:duration('1 ora')},{desc:duration('8 ore'),
     changeNotes:[{id:'custom-note',type:'changed',label:'Durata',before:'1 ora',after:'8 ore'}]}],
     connections:['mystery'],externalRequirements:[{id:'study-2',level:2,target:16}],foundry:{keep:true}},
   {id:'mystery',levels:[{desc:'testo originale'},{desc:'altro testo'}],futureClient:{preserve:true}}
 ]};
 const companionTree = tree('other-guardian-tree');
 const rawRecord = JSON.stringify(original);
 await kv.put(key(guardianCampaign),JSON.stringify({version:2,data:[original,companionTree]}));
 const stateRow={treeKey:guardianId,characterId:'valdor',unlocked:['inizio'],levels:{inizio:2},externalProgress:{inizio:{'study-2':9}}};
 const statePayload=JSON.stringify(stateRow);
 await db.prepare('INSERT INTO skill_tree_states VALUES (?,?,?,?,?)').bind(guardianCampaign,'row','valdor',0,statePayload).run();
 const read=async name=>name==='skill-trees' ? guardianStore.getDocument() : {source:'d1',campaignId:guardianCampaign,
   data:[JSON.parse((await db.prepare('SELECT payload FROM skill_tree_states WHERE campaign_id=?').bind(guardianCampaign).first()).payload)]};
 const save=({tree,expectedTreeRevision})=>guardianStore.saveTree(tree,expectedTreeRevision,{updatedBy:'test'});
 let backup;
 const capture=async data=>{backup=structuredClone(data);};
 const migratedGuardian=prepareValdorGrades(original);
 equal(JSON.stringify(original),rawRecord);
 equal(migratedGuardian.added,['inizio']); equal(migratedGuardian.individual,['mystery']);
 await rejects(migrateOnline({read,save,backup:async()=>{throw Error('Backup unavailable');}}));
 equal((await read('skill-trees')).treeRevisions[guardianId],1);
 await rejects(migrateOnline({read,backup:capture,save:async body=>{
   await save({tree:{...original,freshEdit:true},expectedTreeRevision:1});
   return save(body);
 }}));
 equal((await read('skill-trees')).data[0].freshEdit,true);
 const confirmed=await migrateOnline({read,backup:capture,save:async body=>{await save(body);throw Error('Response lost');}});
 equal(confirmed,{revision:3,changed:true});equal(backup.original,{...original,freshEdit:true});equal(backup.states,[stateRow]);
 const converted=await read('skill-trees');
 equal(converted.data[0],{...migratedGuardian.adapted,freshEdit:true});equal(converted.data[1],companionTree);equal(converted.treeRevisions[companionTree.id],1);
 equal((await db.prepare('SELECT payload FROM skill_tree_states WHERE campaign_id=?').bind(guardianCampaign).first()).payload,statePayload);
 equal(await migrateOnline({read,save:()=>assert.fail('Repeat write'),backup:()=>assert.fail('Repeat backup')}),{revision:3,changed:false});
 // Two sheets of the same campaign see different subsets. Keep the raw legacy wrapper
 // and every unrelated record across compact writes, conflicts and explicit deletion.
 const wrapped = {id:'guardian',editorMetadata:{keep:1},tree:{...tree('guardian'),characterIds:['Lù-ca','secondo']}};
 const shared = {...tree('campagna-voti'),shared:true}, legacy = tree('garun'), unrelated = {...tree('altro'),ownerCharacterId:'npc-altro'};
 const seed = [wrapped,shared,legacy,unrelated];
 const stateFor = (id,treeKey,characterId,extras={}) => ({id,treeKey,characterId,unlocked:['one'],custom:{preserve:true},...extras});
 const hero = stateFor('sheet-guardian-luca','guardian','Luca');
 const party = stateFor('sheet-campagna-voti-shared',shared.id,'__campaign__',{shared:true});
 const second = stateFor('sheet-guardian-secondo','guardian','secondo');
 const other = stateFor('sheet-altro-npc-altro','altro','npc-altro');
 const statesKey = 'campaign:sheet:data:skill-tree-states:override';
 await kv.put(key('sheet'),JSON.stringify({version:5,data:seed}));
 await kv.put(statesKey,JSON.stringify({version:8,data:[hero,party,second,other]}));
 const sheetRoute = '/api/skill-trees/sheet?campaign=sheet&id=luca&legacyKey=garun';
 const firstSheet = (await call(sheetRoute)).body;
 equal(firstSheet.trees.data,[wrapped,shared,legacy]);equal(firstSheet.progress.data,[hero,party]);
 equal(firstSheet.trees.treeRevisions,{guardian:1,[shared.id]:1,garun:1});
 equal(firstSheet.progress.stateRevisions,{[hero.id]:1,[party.id]:1});
 const npcSheet=(await call('/api/skill-trees/sheet?campaign=sheet&id=npc-altro&type=npc')).body;
 equal(npcSheet.trees.data,[unrelated]);equal(npcSheet.progress.data,[other]);
 const startup = await call('/api/bootstrap/character?campaign=sheet&id=luca&skillTrees=separate');
 equal(startup.body.data['skill-trees'],undefined);equal(startup.body.data['skill-tree-states'],undefined);
 const pathFor = name => '/api/data/'+name+'?campaign=sheet';
 const edit = {...wrapped.tree,name:'Modifica A'}, editedOther={...unrelated,name:'Modifica B'};
 const saveCompact = (tree,revision)=>call(pathFor('skill-trees'),{tree,expectedTreeRevision:revision,responseMode:'revision'});
 const acknowledgements = await Promise.all([saveCompact(edit,1),saveCompact(editedOther,1)]);
 for (const result of acknowledgements) {equal(result.status,200);equal(result.body.treeRevision,2);equal(result.body.data,undefined);}
 equal((await saveCompact({...edit,name:'Stale'},1)).status,409);
 equal((await call(pathFor('skill-trees'))).body.data,[{...wrapped,tree:edit},shared,legacy,editedOther]);
 const editedProgress={...hero,levels:{one:2}};
 const ack=await call(pathFor('skill-tree-states'),{state:editedProgress,expectedStateRevision:1,responseMode:'revision'});
 equal(ack.status,200);equal(ack.body.state,editedProgress);equal(ack.body.stateRevision,2);equal(ack.body.data,undefined);
 equal((await call(pathFor('skill-tree-states'))).body.data.find(row=>row.id===other.id),other);
 const transport=sandbox.window.CriptaSkillTreeSheet;
 sandbox.window.CriptaApp.api={
   get:async path=>(await call('/'+path+'?campaign=sheet')).body,
   post:async(path,body)=>{const res=await call('/'+path+'?campaign=sheet',body);if(res.status!==200)throw Error('Conflict');return res.body;}
 };
 await rejects(transport.remove('guardian',{version:5,revisions:{guardian:1}},'test'));
 const directPost=sandbox.window.CriptaApp.api.post;
 sandbox.window.CriptaApp.api.post=async(path,body)=>{
   await saveCompact({...editedOther,name:'Modifica durante la cancellazione'},2);
   return directPost(path,body);
 };
 await rejects(transport.remove('guardian',{version:5,revisions:{guardian:2}},'test'));
 equal((await call(pathFor('skill-trees'))).body.data[0],{...wrapped,tree:edit});
 equal((await call(pathFor('skill-tree-states'))).body.data.length,4);
 sandbox.window.CriptaApp.api.post=directPost;
 await transport.remove('guardian',{version:5,revisions:{guardian:2}},'test');
 equal((await call(pathFor('skill-trees'))).body.data,[shared,legacy,{...editedOther,name:'Modifica durante la cancellazione'}]);
 equal((await call(pathFor('skill-tree-states'))).body.data,[party,other]);
 equal(JSON.parse(await kv.get(key('sheet'))).data,seed);equal(JSON.parse(await kv.get(statesKey)).data,[hero,party,second,other]);
 const companionEdit={id:'npc-nuovo',ownerCharacterId:'npc-owned',nodes:[{id:'start'}]};
 for (const campaign of ['fresh','fresh-kv']) {
   await kv.put('campaign:'+campaign+':data:characters:override',JSON.stringify({data:[{id:'npc-owned',accountId:'alice'}]}));
   const target='/api/data/skill-trees?campaign='+campaign;
   const body={expectedVersion:0,staticTreeId:companionEdit.id,data:[companionEdit]};
   equal((await call(target,body,'alice')).status,200);
   equal((await call(target)).body.data,[...Object.entries(staticBaseline).map(([id,row])=>({...row,id})),companionEdit]);
   equal((await call(target,body,'alice')).status,409);
 }
 const localOnly = sandbox.window.CriptaSkillTreeSheet.staticRecords(staticBaseline);
 const posts = [];
 sandbox.window.CriptaApp.api.post=async (path,body)=>{posts.push(body);return {saved:true,version:1};};
 await transport.save(companionEdit,{version:0,revisions:null,staticRecords:localOnly},'admin');
 equal(posts[0].data.map(id=>id.id).join(','),'starter,npc-existing,npc-nuovo');
 await rejects(transport.save(companionEdit,{version:null,revisions:null,staticRecords:localOnly},'admin'));
 await rejects(transport.save(edit,{version:8,revisions:{guardian:5}},'admin',4));
 equal(posts.length,1,'Offline static fallback never writes');
 console.log(`Skill tree definitions D1: ${checks} checks passed.`);
}finally{await runtime.dispose();}
