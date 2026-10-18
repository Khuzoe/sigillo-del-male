import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/shared/character-skill-tree.js', import.meta.url), 'utf8');
const extensions = await readFile(new URL('../assets/js/shared/managed-player-extensions.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const sandbox = {console, structuredClone, URLSearchParams, window: {location: {search: '?world=other&character=valdor'}, localStorage: {getItem() {return null;}}}};
vm.runInNewContext(extensions.replace(/\}\)\(\);\s*$/, 'globalThis.subject = skillTreeSubject; })();'), sandbox);
const npc = sandbox.subject({actorType:'npc', worldId:'world-a', actorId:'abc123', ownerCharacterId:'valdor'});
assert.equal(npc.id, 'npc-world-a-abc123');
assert.equal(npc.isNpc, true);
assert.notEqual(sandbox.subject({actorType:'npc', worldId:'world-b', actorId:'abc123'}).id, npc.id);
assert.notEqual(sandbox.subject({actorType:'npc', worldId:'world-a', actorId:'def456'}).id, npc.id);
assert.equal(sandbox.subject({actorType:'character', ownerCharacterId:'valdor'}).id, 'valdor');
assert.equal(sandbox.subject({actorType:'npc', worldId:'world-a'}), null, 'Do not fall back to the owner for an unidentified NPC');

vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `globalThis.api = {applySkillTreeRuntime, resolvePlayerSkillTreeEntries,
 canManagePersonalSkillTrees, canManageSkillTreeDefinition, canEditSkillTreeUnlocks,
 getSkillTreeProgressTrack, normalizeSkillTreeProgressValue, renderSkillTreeProgressSettings,
 saveCharacterSkillTreeState, getCharacterSkillTreeState, createSkillTreeProgressTransaction}; })();`), sandbox);
const api = sandbox.api;
const personal = {id:'companion-tree', ownerCharacterId:npc.id, nodes:[{id:'a'}], progressTrack:{enabled:true,label:'Affinità',target:100}};
const definitions = {companion:personal, valdor:{ownerCharacterId:'valdor',nodes:[{id:'b'}]}, campaign:{shared:true,nodes:[{id:'c'}]}};
api.applySkillTreeRuntime({skillTreeCurrentUserIsDm:true});
assert.deepEqual(clone(api.resolvePlayerSkillTreeEntries(npc, definitions).map(entry=>entry.key)), ['companion']);
assert.deepEqual(clone(api.resolvePlayerSkillTreeEntries({id:'valdor'}, definitions).map(entry=>entry.key)), ['valdor','campaign']);
api.applySkillTreeRuntime({skillTreeCurrentUserIsDm:false});
assert.equal(api.resolvePlayerSkillTreeEntries(npc, {companion:{...personal,archived:true}}).length, 0);
api.applySkillTreeRuntime({skillTreeCurrentUserIsDm:false,skillTreeCanManagePersonalTrees:true,skillTreeAuthState:{user:{accountId:'co-owner'}}});
assert.equal(api.canManagePersonalSkillTrees({...npc,accountId:'co-owner'}),true,'An owner can edit the companion tree without being DM');
assert.equal(api.canEditSkillTreeUnlocks({...npc,accountId:'co-owner'}),true);
assert.equal(api.canManagePersonalSkillTrees({...npc,accountId:'other'}),false,'The scoped flag does not authorize another owner');
assert.equal(api.canManagePersonalSkillTrees({id:'hero',accountId:'co-owner'}),false,'Companion permissions do not widen player tree permissions');
assert.equal(api.canManageSkillTreeDefinition({...npc,accountId:'co-owner'},personal),true);
assert.equal(api.canManageSkillTreeDefinition({...npc,accountId:'co-owner'},{...personal,characterIds:['npc-other']}),false,'Mixed owners cannot widen definition permissions');
assert.equal(api.canManageSkillTreeDefinition({...npc,accountId:'co-owner'},{...personal,shared:true}),false);
assert.deepEqual(clone(api.getSkillTreeProgressTrack({})), {enabled:false,label:'Esperienza',target:100,position:'right'});
assert.equal(api.getSkillTreeProgressTrack({progressTrack:{target:0}}).target, 1);
assert.equal(api.normalizeSkillTreeProgressValue(Infinity), 0);
assert.equal(api.normalizeSkillTreeProgressValue(-10), 0);
assert.equal(api.normalizeSkillTreeProgressValue(1e15), 1e12);
assert.match(api.renderSkillTreeProgressSettings(personal), /Verticale a destra/);
assert.ok(!api.renderSkillTreeProgressSettings({}).includes('data-skill-progress-field="target"'));

let stored;
const original = {id:`test-companion-tree-${npc.id}`, treeKey:'companion-tree', characterId:npc.id, scope:'character', shared:false,
 unlocked:['a'], levels:{a:2}, externalProgress:{a:{goal:1}}, treeProgress:45, custom:{keep:true}};
const unrelated = {id:'other', treeKey:'valdor', characterId:'valdor', treeProgress:99};
let reject = false;
sandbox.window.CriptaApp = {api:{post:async (path,body)=>{
 if(reject) throw Object.assign(new Error('Conflict'), {code:'VERSION_CONFLICT'});
 stored=clone(body); return {version:4};
}}};
api.applySkillTreeRuntime({skillTreeStatesMemoryCache:[original,unrelated],skillTreeStatesVersion:3,
 skillTreeAuthState:{user:{accountId:'dm'}},skillTreeCurrentUserIsDm:true,getCurrentCampaignId:()=> 'test',readSharedAuthToken:()=> 'token'});
await api.saveCharacterSkillTreeState(npc,'companion-tree',['a'],{a:3},personal,{a:{goal:1}});
let saved = stored.data.find(entry=>entry.treeKey==='companion-tree');
assert.equal(saved.treeProgress,45,'Unlock changes preserve the progress counter');
assert.deepEqual(saved.custom,{keep:true},'Unknown metadata survives state writes');
assert.equal(stored.data.find(entry=>entry.id==='other').treeProgress,99);
await api.saveCharacterSkillTreeState(npc,'companion-tree',['a'],{a:3},personal,{a:{goal:1}},150);
saved=stored.data.find(entry=>entry.treeKey==='companion-tree');
assert.equal(saved.treeProgress,150,'Going past the objective does not discard earned points');
assert.deepEqual(saved.unlocked,['a']);
assert.deepEqual(saved.levels,{a:3});
assert.deepEqual(saved.externalProgress,{a:{goal:1}});
await api.saveCharacterSkillTreeState({id:'hero',accountId:'player'},'hero-tree',[],{}, {nodes:[{id:'first'}]}, {}, 20);
assert.equal(stored.data.find(entry=>entry.treeKey==='hero-tree').ownerAccountId,'player','A DM updating XP does not take ownership of the player record');
reject=true;
await assert.rejects(api.saveCharacterSkillTreeState(npc,'companion-tree',[],{},personal,{},0));
assert.equal(api.getCharacterSkillTreeState(npc,'companion-tree',personal).treeProgress,150,'Failed write leaves the cached value intact');
let value=150;
const change=api.createSkillTreeProgressTransaction({snapshot:()=>value,restore:old=>{value=old;},persist:async()=>{throw Error('offline');},render(){},setBusy(){}});
await assert.rejects(change(()=>{value=10;}));
assert.equal(value,150,'Failed progress edit rolls the UI back');
console.log('NPC trees and optional progress: identity isolation, visibility, counters, preservation and rollback passed.');
