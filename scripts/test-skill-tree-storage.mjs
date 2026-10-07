// Real local D1 and Worker routes; no remote bindings or live data.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from '../workers/main-worker/node_modules/esbuild/lib/main.js';
import { Miniflare } from '../workers/main-worker/node_modules/miniflare/dist/src/index.js';
import { SkillTreeStateStore } from '../workers/main-worker/src/skill-tree-store.js';

const secret = 'skill-tree-local-test';
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../workers/main-worker/src/index.js', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022' });
const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-05-15',
  kvNamespaces: ['SIGILLO_KV'], kvPersist: false, d1Databases: ['POLL_DB'], d1Persist: false,
  bindings: { JWT_SECRET: secret, GLOBAL_ADMIN_ACCOUNT_IDS: 'admin', CAMPAIGN_EDITOR_ACCOUNT_IDS: 'test:dm;other:dm',
    SKILL_TREE_D1_CAMPAIGNS: 'test,other,empty,broken', SKILL_TREE_WRITES_PAUSED_CAMPAIGNS: 'paused', DISCORD_BOT_TOKEN: '' } });
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
function ok(value, label) { assert.ok(value, label); checks++; }
function jwt(account) {
  const parts = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ accountId: account, username: account, exp: Math.floor(Date.now()/1000) + 3600 })).toString('base64url')].join('.');
  return `${parts}.${createHmac('sha256', secret).update(parts).digest('base64url')}`;
}
async function call(path, body, account = 'admin') {
  const response = await runtime.dispatchFetch(`https://local.test${path}`, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Origin: 'https://khuzoe.github.io', ...(account ? { Authorization: `Bearer ${jwt(account)}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const record = (tree, character, owner) => ({ id: `test-${tree}-${character}`, key: `test-${tree}-${character}`, treeKey: tree, characterId: character,
  ownerAccountId: owner, scope: 'character', shared: false, unlocked: ['a'], levels: { a: 2 }, externalProgress: { a: { q: 2 } }, updatedAt: '2026-10-01' });
const a = record('a', 'hero', 'alice'), b = record('b', 'other-hero', 'bob');
const shared = { ...record('shared-party', 'shared', 'alice'), characterId: '__campaign__', scope: 'campaign', shared: true };
const legacyShared = { ...shared, id: 'old-shared', key: 'old-shared', unlocked: ['a','b'], updatedAt: '2026-09-01', extra: 'preserve-original' };
const key = campaign => `campaign:${campaign}:data:skill-tree-states:override`;
const path = '/api/data/skill-tree-states?campaign=test';
const patch = (state, revision = 1) => ({ campaignId: 'test', state, expectedStateRevision: revision });
try {
  const db = await runtime.getD1Database('POLL_DB'), kv = await runtime.getKVNamespace('SIGILLO_KV');
  for (const file of ['0001_polls.sql', '0002_skill_tree_states.sql', '0002_skill_tree_states.sql']) {
    const schema = await readFile(new URL(`../workers/main-worker/migrations/${file}`, import.meta.url), 'utf8');
    await db.batch(schema.split(';').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  }
  const raw = JSON.stringify({ version: 9, campaignId: 'test', data: [a, b, legacyShared, shared], unknownMetadata: { preserve: true } }, null, 2);
  const otherRaw = JSON.stringify({ version: 22, data: [{ ...a, id: 'other-a-hero' }] });
  await kv.put(key('test'), raw); await kv.put(key('other'), otherRaw); await kv.put(key('broken'), '{invalid');
  await kv.put('campaign:test:data:characters:override', JSON.stringify({data: [{id: 'hero',accountId: 'alice'}, {id: 'other-hero',accountId: 'bob'}]}));
  await kv.put('campaign:test:data:skill-trees:override', JSON.stringify({data: [{id:'shared-party',shared:true}]}));
  const imported = await Promise.all(Array.from({ length: 5 }, () => call(path)));
  imported.forEach(result => { equal(result.status, 200); equal(result.body.version, 9); equal(result.body.data, [a,b,legacyShared,shared]); });
  equal((await db.prepare("SELECT COUNT(*) AS n FROM skill_tree_states WHERE campaign_id='test'").first()).n, 4);
  equal(imported[0].body.stateRevisions, { 'test-a-hero':1, 'test-b-other-hero':1, 'test-shared-party-shared':1 });
  equal((await db.prepare("SELECT original_raw FROM skill_tree_documents WHERE campaign_id='test'").first()).original_raw, raw);
  equal((await call('/api/data/skill-tree-states?campaign=other')).body.version, 22);
  equal((await call('/api/data/skill-tree-states?campaign=empty')).body.data, null);
  equal((await call('/api/data/skill-tree-states?campaign=broken')).body.code, 'SKILL_TREE_IMPORT_INVALID');
  equal((await db.prepare("SELECT COUNT(*) AS n FROM skill_tree_documents WHERE campaign_id='broken'").first()).n, 0);
  const different = await Promise.all([call(path, patch({...a,unlocked:[]}), 'alice'),call(path, patch({...b,levels:{a:3}}), 'bob')]);
  different.forEach(result => equal(result.status, 200, JSON.stringify(result.body)));
  let document = (await call(path)).body;
  equal(document.version,11); equal(document.data.find(x=>x.id===a.id).unlocked,[]); equal(document.data.find(x=>x.id===b.id).levels,{a:3});
  const same = await Promise.all([call(path,patch({...a,unlocked:['one']},2),'alice'),call(path,patch({...a,unlocked:['two']},2),'alice')]);
  equal(same.map(x=>x.status).sort(),[200,409]);
  document=(await call(path)).body; equal(document.version,12); equal(document.stateRevisions[a.id],3);
  const beforeFailure = JSON.stringify(document);
  equal((await call(path,patch({...a,unlocked:['stale']},2),'alice')).status,409);
  equal(JSON.stringify((await call(path)).body),beforeFailure,'Failed CAS does not reuse another operation revision');
  const newRecord=record('new','hero','alice');
  const first=await Promise.all([call(path,patch(newRecord,0),'alice'),call(path,patch(newRecord,0),'alice')]);
  equal(first.map(x=>x.status).sort(),[200,409]);
  equal((await call(path,patch(a,3),'bob')).status,403);
  equal((await call(path,patch({...b,ownerAccountId:'alice'},2),'alice')).status,403,'Cannot claim another owned character');
  equal((await call(path,patch({...shared,characterId:'hero',shared:false,scope:'character'},1),'alice')).status,403,'An old shared owner is not permission to edit shared progress');
  equal((await call(path,patch(shared,1),'alice')).status,403);
  equal((await call(path,patch(a,3),'')).status,401);
  equal((await call(path,patch({...shared,unlocked:[],levels:{},externalProgress:{}},1),'dm')).status,200);
  document=(await call(path)).body;
  equal(document.data.filter(x=>x.treeKey==='shared-party').length,1,'Targeted save consolidates only its own old duplicates');
  equal(document.data.find(x=>x.id===shared.id).unlocked,[]);
  const sharedRevision=document.stateRevisions[shared.id];
  const store=new SkillTreeStateStore({POLL_DB:db,SIGILLO_KV:kv},'test');
  const originalStatement=store.statement.bind(store);
  store.statement=(sql,...values)=>sql.includes('INSERT INTO skill_tree_states')
    ? db.prepare("INSERT INTO skill_tree_states (campaign_id,row_key,subject_key,position,payload) VALUES ('test','bad','bad',0,'{invalid')")
    : originalStatement(sql,...values);
  const beforeRollback=await store.getDocument();
  await assert.rejects(store.saveState({...shared,unlocked:['should-not-save']},sharedRevision,{})); checks++;
  equal(await store.getDocument(),beforeRollback,'Transaction rolls back revision, deletes and payload on failure');
  const current=(await call(path)).body;
  const bulks=await Promise.all([call(path,{campaignId:'test',data:current.data,expectedVersion:current.version}),call(path,{campaignId:'test',data:current.data,expectedVersion:current.version})]);
  equal(bulks.map(x=>x.status).sort(),[200,409],'Old full-collection clients remain atomic');
  equal((await call(path,{campaignId:'test',data:current.data})).status,409);
  equal((await call('/api/data/skill-tree-states?campaign=paused',{campaignId:'paused',data:[],expectedVersion:0})).status,503);
  equal((await call('/api/data/skill-tree-states?campaign=paused')).status,200);
  const disabled=await call('/api/data/skill-tree-states?campaign=disabled',{campaignId:'disabled',data:[],expectedVersion:0});
  equal(disabled.status,200); ok(await kv.get(key('disabled')));
  const bootstrap=(await call('/api/bootstrap/character?campaign=test&id=hero')).body;
  equal(bootstrap.data['skill-tree-states'].source,'d1');
  equal(bootstrap.data['skill-tree-states'].data,(await call(path)).body.data);
  equal((await call('/api/sync/status?campaign=test&collections=skill-tree-states')).body.collections['skill-tree-states'].source,'d1');
  equal((await call('/api/skill-tree-states/storage/export?campaign=test',undefined,'alice')).status,403);
  const exported=await call('/api/skill-tree-states/storage/export?campaign=test');
  equal(exported.status,200); equal(exported.body.originalRaw,raw); equal(JSON.parse(exported.body.kvDocuments[0].value).unknownMetadata,{preserve:true});
  ok(exported.headers.get('cache-control').includes('no-store'));
  equal(await kv.get(key('test')),raw,'Original KV unchanged after every read/write/failure');
  equal(await kv.get(key('other')),otherRaw);
  const noKvReads = new SkillTreeStateStore({POLL_DB:db,SIGILLO_KV:{get(){throw Error('Unexpected KV access');}}},'test');
  equal((await noKvReads.getDocument()).version,(await call(path)).body.version);

  // Deletion retains a revision tombstone; an old first-save cannot resurrect it.
  const cleanStore = new SkillTreeStateStore({POLL_DB:db,SIGILLO_KV:kv},'test');
  const beforeDelete = await cleanStore.getDocument();
  const removed = await cleanStore.replaceCollection(beforeDelete.data.filter(x=>x.id!==newRecord.id),beforeDelete.version,{});
  equal(removed.stateRevisions[newRecord.id],2);
  await assert.rejects(cleanStore.saveState(newRecord,0,{}),error=>error.status===409); checks++;
  equal(await cleanStore.getDocument(),removed);
  const restored=await cleanStore.saveState(newRecord,2,{});
  equal(restored.stateRevisions[newRecord.id],3);
  const racing=await Promise.allSettled([
    cleanStore.saveState({...a,unlocked:['race']},restored.stateRevisions[a.id],{}),
    cleanStore.replaceCollection(restored.data,restored.version,{})
  ]);
  ok(racing.some(result=>result.status==='fulfilled'));
  const afterRace=await cleanStore.getDocument();
  equal(afterRace.data.find(x=>x.id===a.id).unlocked,['race'],'Bulk/target race cannot lose a successful targeted write');
  const bulkRollbackStore=new SkillTreeStateStore({POLL_DB:db,SIGILLO_KV:kv},'test');
  const bulkStatement=bulkRollbackStore.statement.bind(bulkRollbackStore);
  bulkRollbackStore.statement=(sql,...values)=>sql.includes('INSERT INTO skill_tree_states')
    ? db.prepare("INSERT INTO skill_tree_states (campaign_id,row_key,subject_key,position,payload) VALUES ('test','bad','bad',0,'{invalid')")
    : bulkStatement(sql,...values);
  await assert.rejects(bulkRollbackStore.replaceCollection([],afterRace.version,{})); checks++;
  equal(await cleanStore.getDocument(),afterRace,'Bulk transaction failure preserves deleted rows and revisions');
  await assert.rejects(async()=>new SkillTreeStateStore({SIGILLO_KV:kv},'test').getDocument()); checks++;
  const emptyStore=new SkillTreeStateStore({POLL_DB:db,SIGILLO_KV:kv},'empty');
  const emptyRecord={...record('first','hero','alice'),id:'empty-first-hero',key:'empty-first-hero'};
  equal((await emptyStore.saveState(emptyRecord,0,{})).data,[emptyRecord]);
  equal(await kv.get(key('empty')),null,'First save to a missing collection does not create a KV key');
  equal(await kv.get(key('test')),raw);

  // Exercise the actual frontend serializer with D1 metadata and server data.
  const source=await readFile(new URL('../assets/js/shared/character-skill-tree.js',import.meta.url),'utf8');
  let sent,context;
  const sandbox={console,structuredClone,URL,Date,Map,Set,window:{localStorage:{getItem(){return null;}},CriptaApp:{api:{post:async(_,body)=>{
    sent=body; return {version:18,data:[{...a,unlocked:['a']},b],stateRevisions:{[a.id]:4,[b.id]:2}};
  }}}}};
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,`globalThis.api={applySkillTreeRuntime,saveCharacterSkillTreeState,getCharacterSkillTreeState};})();`),sandbox);
  sandbox.api.applySkillTreeRuntime({skillTreeStatesMemoryCache:[a],skillTreeStatesVersion:17,skillTreeStateRevisions:{[a.id]:3},
    skillTreeAuthState:{user:{accountId:'alice'}},getCurrentCampaignId:()=> 'test',readSharedAuthToken:()=> 'token',
    setSkillTreeStates:(data,version,revisions)=>{context={data,version,revisions};}});
  await sandbox.api.saveCharacterSkillTreeState({id:'hero',accountId:'alice'},'a',['a'],{}, {nodes:[{id:'a'}]});
  equal(sent.expectedStateRevision,3); equal(sent.data,undefined); equal(sent.state.id,a.id);
  equal(context.version,18); equal(context.data.length,2); equal(context.revisions[a.id],4);
  console.log(`Skill tree D1 storage: ${checks} checks passed.`);
} finally { await runtime.dispose(); }
