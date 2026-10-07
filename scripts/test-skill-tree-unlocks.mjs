import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import worker from "../workers/main-worker/src/index.js";

const failures = [];
let checks = 0;
async function test(label, run) {
  try { await run(); checks++; } catch (error) { failures.push(`${label}: ${error.message}`); }
}
const copy = value => JSON.parse(JSON.stringify(value));
const source = await readFile(new URL("../assets/js/shared/character-skill-tree.js", import.meta.url), "utf8");
const progressHandlers = source.slice(source.indexOf("    const persistUnlocks = async () => {"), source.indexOf("    const deleteSelectedConnection = () => {"));
assert.ok(progressHandlers.includes("const applyNodeProgressAction"));
function frontend(records = [], version = 3, post = async () => ({version: 4})) {
  const sandbox = {console, structuredClone, URL, Set, Map, Date, window: {localStorage: {getItem() { return null; }}, CriptaApp: {api: {post}}}};
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `
    globalThis.treeApi = {applySkillTreeRuntime, getCharacterSkillTreeState, saveCharacterSkillTreeState,
      deriveSkillTreeNodes, canDisableUnlockedSkillNode, canUnlockSkillTreeGroupChild,
      isSkillTreeExternalRequirementSatisfied, resolvePlayerSkillTreeEntries,
      createProgressTransaction: typeof createSkillTreeProgressTransaction === 'function' ? createSkillTreeProgressTransaction : null,
      progressHarness(workingTree, state, persist, canEditUnlocks = true) {
        const character = {id: 'hero'}, treeKey = workingTree.id;
        let currentNodes = deriveSkillTreeNodes(workingTree, state);
        let unlockedIds = new Set(state.unlocked || []), nodeLevels = structuredClone(state.levels || {}), nodeExternalProgress = structuredClone(state.externalProgress || {});
        let selectedNodeId = '', lockedInfoNodeId = '', renders = 0;
        const infoPanel = {setAttribute() {}, querySelectorAll() {return [];}};
        const renderTree = () => {currentNodes = deriveSkillTreeNodes(workingTree, {unlocked: [...unlockedIds], levels: nodeLevels, externalProgress: nodeExternalProgress}); renders++;};
        const saveCharacterSkillTreeState = persist;
        ${progressHandlers}
        return {action: applyNodeProgressAction, external: updateNodeExternalProgress,
          read: () => ({unlocked: [...unlockedIds], levels: nodeLevels, externalProgress: nodeExternalProgress, nodes: currentNodes, renders})};
      }};
  })();`), sandbox);
  sandbox.treeApi.applySkillTreeRuntime({skillTreeStatesMemoryCache: records, skillTreeStatesVersion: version,
    skillTreeAuthState: {user: {accountId: "dm"}}, skillTreeCurrentUserIsDm: true,
    getCurrentCampaignId: () => "test", readSharedAuthToken: () => "token"});
  return sandbox.treeApi;
}
const tree = {id: "shared-party", shared: true, nodes: [{id: "a"}, {id: "b", requires: ["a"]}]};
const canonical = {id: "test-shared-party-shared", key: "test-shared-party-shared", treeKey: tree.id,
  shared: true, scope: "campaign", characterId: "__campaign__", ownerAccountId: "dm", unlocked: ["a"], levels: {}, externalProgress: {}};
const character = {id: "hero", accountId: "player"};
await test("latest shared snapshot does not resurrect a relocked node", () => {
  const api = frontend([{...canonical, id: "legacy", key: "legacy", unlocked: ["a", "b"], updatedAt: "2026-09-01"},
    {...canonical, unlocked: [], updatedAt: "2026-09-02"}]);
  assert.deepEqual(copy(api.getCharacterSkillTreeState(character, tree.id, tree).unlocked), []);
});
await test("latest snapshot also clears levels and external progress", () => {
  const api = frontend([{...canonical, id: "legacy", key: "legacy", levels: {a: 3}, externalProgress: {a: {task: 4}}, updatedAt: "2026-09-01"},
    {...canonical, updatedAt: "2026-09-02"}]);
  const state = api.getCharacterSkillTreeState(character, tree.id, tree);
  assert.deepEqual(copy([state.levels, state.externalProgress]), [{}, {}]);
});
await test("shared state is identical for different characters", () => {
  const api = frontend([canonical]);
  assert.deepEqual(copy(api.getCharacterSkillTreeState(character, tree.id, tree)), copy(api.getCharacterSkillTreeState({id: "other"}, tree.id, tree)));
});
await test("legacy personal records still resolve by their canonical id", () => {
  const api = frontend([{id: "test-personal-hero", unlocked: ["a"]}]);
  assert.deepEqual(copy(api.getCharacterSkillTreeState(character, "personal", {nodes: tree.nodes}).unlocked), ["a"]);
});
await test("a forged personal record with the shared id is ignored", () => {
  const api = frontend([{...canonical, shared: false, scope: "character", characterId: "hero"}]);
  assert.equal(api.getCharacterSkillTreeState(character, tree.id, tree), null);
});
await test("unlock write carries its loaded version", async () => {
  let body;
  const api = frontend([canonical], 7, async (_, value) => { body = value; return {version: 8}; });
  await api.saveCharacterSkillTreeState(character, tree.id, ["a", "b"], {}, tree);
  assert.equal(body.expectedVersion, 7);
});
await test("an unreadable state collection cannot be overwritten", async () => {
  let writes = 0;
  const api = frontend([], null, async () => { writes++; return {version: 1}; });
  await assert.rejects(api.saveCharacterSkillTreeState(character, tree.id, ["a"], {}, tree));
  assert.equal(writes, 0);
});
await test("failed save does not advance cached progress", async () => {
  const api = frontend([canonical], 3, async () => {throw new Error("offline");});
  await assert.rejects(api.saveCharacterSkillTreeState(character, tree.id, ["a", "b"], {}, tree));
  assert.deepEqual(copy(api.getCharacterSkillTreeState(character, tree.id, tree).unlocked), ["a"]);
});
await test("a failed save is not included in a later successful save", async () => {
  let calls = 0, saved;
  const api = frontend([canonical], 3, async (_, body) => {
    if (++calls === 1) throw new Error("offline");
    saved = body;
    return {version: 4};
  });
  await assert.rejects(api.saveCharacterSkillTreeState(character, tree.id, ["a", "b"], {}, tree));
  await api.saveCharacterSkillTreeState(character, "personal", ["x"], {}, {nodes: [{id: "x"}]});
  assert.equal(saved.expectedVersion, 3);
  assert.deepEqual(copy(saved.data.find(entry => entry.id === canonical.id).unlocked), ["a"]);
});
await test("rapid saves in different cards are serialized without losing either tree", async () => {
  let release;
  const barrier = new Promise(resolve => {release = resolve;});
  const posts = [];
  const api = frontend([canonical], 3, async (_, body) => {
    posts.push(copy(body));
    if (posts.length === 1) await barrier;
    return {version: body.expectedVersion + 1};
  });
  const first = api.saveCharacterSkillTreeState(character, tree.id, ["a", "b"], {}, tree);
  const second = api.saveCharacterSkillTreeState(character, "personal", ["x"], {}, {nodes: [{id: "x"}]});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(posts.length, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(posts[1].expectedVersion, 4);
  assert.deepEqual(posts[1].data.find(entry => entry.id === canonical.id).unlocked, ["a", "b"]);
  assert.equal(posts[1].data.length, 2);
});
await test("shared save consolidates legacy duplicates but preserves unrelated records", async () => {
  let saved;
  const unrelated = {...canonical, id: "other", key: "other", treeKey: "other-tree"};
  const api = frontend([canonical, {...canonical, id: "legacy", key: "legacy"}, unrelated], 3, async (_, body) => {saved = body; return {version: 4};});
  await api.saveCharacterSkillTreeState(character, tree.id, [], {}, tree);
  assert.equal(saved.data.length, 2);
  assert.deepEqual(copy(saved.data[0]), unrelated);
  assert.deepEqual(copy(saved.data[1].unlocked), []);
});
await test("missing timestamps prefer the canonical snapshot deterministically", () => {
  const api = frontend([{...canonical, id: "legacy", key: "legacy", unlocked: ["a", "b"]}, canonical]);
  assert.deepEqual(copy(api.getCharacterSkillTreeState(character, tree.id, tree).unlocked), ["a"]);
});
await test("progress transaction rolls back unlocks, levels and nested requirements on failure", async () => {
  const api = frontend();
  let state = {unlocked: [], levels: {a: 1}, external: {a: {quest: 0}}}, renders = 0;
  const busy = [];
  const run = api.createProgressTransaction({snapshot: () => copy(state), restore: previous => {state = previous;},
    persist: async () => {throw new Error("offline");}, render: () => {renders++;}, setBusy: value => busy.push(value)});
  await assert.rejects(run(() => {state.unlocked.push("a"); state.levels.a = 2; state.external.a.quest = 3;}));
  assert.deepEqual(state, {unlocked: [], levels: {a: 1}, external: {a: {quest: 0}}});
  assert.equal(renders, 1);
  assert.deepEqual(busy, [true, false]);
});
await test("repeated clicks during a pending unlock do not run another mutation", async () => {
  const api = frontend();
  let release, changes = 0, writes = 0;
  const run = api.createProgressTransaction({snapshot: () => changes, restore: previous => {changes = previous;},
    persist: () => {writes++; return new Promise(resolve => {release = resolve;});}, render() {}, setBusy() {}});
  const first = run(() => {changes++;});
  assert.equal(await run(() => {changes++;}), false);
  assert.equal(changes, 1);
  release();
  assert.equal(await first, true);
  assert.equal(writes, 1);
});
const rulesApi = frontend();
const nodeState = (definition, unlocked, externalProgress = {}) => Object.fromEntries(rulesApi.deriveSkillTreeNodes(definition, {unlocked, externalProgress}).map(node => [node.id, node.state]));
await test("all prerequisites are required", () => {
  assert.equal(nodeState({nodes: [{id: "a"}, {id: "b"}, {id: "c", requires: ["a", "b"]}]}, ["a"]).c, "locked");
});
await test("any prerequisite allows either branch", () => {
  assert.equal(nodeState({nodes: [{id: "a"}, {id: "b"}, {id: "c", requires: ["a", "b"], requiresMode: "any"}]}, ["a"]).c, "unlockable");
});
await test("exclusive branches cannot both be unlocked", () => {
  const definition = {nodes: [{id: "a", connections: [{target: "b", mode: "exclusive"}, {target: "c", mode: "exclusive"}]}, {id: "b"}, {id: "c"}]};
  assert.equal(nodeState(definition, ["a", "b"]).c, "locked");
});
await test("choice groups respect their maximum and open their descendants at minimum", () => {
  const definition = {nodes: [{id: "g", type: "group", children: ["a", "b"], minChoices: 1, maxChoices: 1}, {id: "a"}, {id: "b"}, {id: "c", requires: ["g"]}]};
  assert.deepEqual(nodeState(definition, ["a"]), {g: "unlocked", a: "unlocked", b: "locked", c: "unlockable"});
  assert.equal(rulesApi.canDisableUnlockedSkillNode(definition, "a", ["a", "c"]), false);
});
await test("external requirements gate unlocks and each additional level", () => {
  const node = {id: "a", levels: [{label: "Base"}, {label: "Avanzato"}], externalRequirements: [{id: "q1", target: 2, level: 1}, {id: "q2", target: 3, level: 2}]};
  assert.equal(nodeState({nodes: [node]}, [], {a: {q1: 1}}).a, "locked");
  assert.equal(nodeState({nodes: [node]}, [], {a: {q1: 2}}).a, "unlockable");
  assert.equal(rulesApi.isSkillTreeExternalRequirementSatisfied(node, {a: {q1: 2, q2: 2}}, 2), false);
  assert.equal(rulesApi.isSkillTreeExternalRequirementSatisfied(node, {a: {q1: 2, q2: 3}}, 2), true);
});
await test("an explicit empty snapshot overrides pre-unlocked template nodes", () => {
  assert.equal(nodeState({nodes: [{id: "a", state: "unlocked"}]}, []).a, "unlockable");
});
await test("a prerequisite cannot be disabled while its descendant is unlocked", () => {
  assert.equal(rulesApi.canDisableUnlockedSkillNode(tree, "a", ["a", "b"]), false);
  assert.equal(rulesApi.canDisableUnlockedSkillNode(tree, "b", ["a", "b"]), true);
});
await test("real UI unlock handler restores failed changes before another action", async () => {
  let writes = 0;
  const ui = rulesApi.progressHarness(tree, {unlocked: []}, async () => {writes++; throw new Error("offline");});
  await assert.rejects(ui.action("unlock", "a"));
  assert.deepEqual(copy(ui.read().unlocked), []);
  await ui.action("unlock", "b");
  assert.equal(writes, 1);
  assert.equal(ui.read().nodes.find(node => node.id === "b").state, "locked");
});
await test("real UI cannot unlock or edit requirements without permission", async () => {
  let writes = 0;
  const definition = {...tree, nodes: [{id: "a", externalRequirements: [{id: "q", target: 2}]}]};
  const ui = rulesApi.progressHarness(definition, {unlocked: []}, async () => {writes++;}, false);
  await ui.external("a", "q", 2);
  await ui.action("unlock", "a");
  assert.equal(writes, 0);
});
await test("failed external requirement edit cannot unlock its node", async () => {
  const definition = {...tree, nodes: [{id: "a", externalRequirements: [{id: "q", target: 2}]}]};
  let writes = 0;
  const ui = rulesApi.progressHarness(definition, {unlocked: [], externalProgress: {a: {q: 1}}}, async () => {writes++; throw new Error("offline");});
  await assert.rejects(ui.external("a", "q", 2));
  assert.equal(ui.read().externalProgress.a.q, 1);
  await ui.action("unlock", "a");
  assert.equal(writes, 1);
});
await test("real UI unlock, level-up and lock preserve their constraints", async () => {
  const definition = {...tree, nodes: [{id: "a", levels: [{label: "Base"}, {label: "L2"}], externalRequirements: [{id: "q", target: 2, level: 2}]}, tree.nodes[1]]};
  const saved = [];
  const ui = rulesApi.progressHarness(definition, {unlocked: []}, async (...args) => saved.push(copy(args)));
  await ui.action("unlock", "a");
  await ui.action("level-up", "a");
  assert.equal(saved.length, 1);
  await ui.external("a", "q", 2);
  await ui.action("level-up", "a");
  assert.equal(ui.read().levels.a, 2);
  await ui.action("unlock", "b");
  const count = saved.length;
  await ui.action("lock", "a");
  assert.equal(saved.length, count);
  await ui.action("lock", "b");
  await ui.action("lock", "a");
  assert.deepEqual(copy(ui.read().unlocked), []);
});
await test("real UI ignores duplicate level-up while its first save is pending", async () => {
  const definition = {...tree, nodes: [{id: "a", levels: [{label: "Base"}, {label: "L2"}, {label: "L3"}]}]};
  let release, writes = 0;
  const ui = rulesApi.progressHarness(definition, {unlocked: ["a"]}, () => {writes++; return new Promise(resolve => {release = resolve;});});
  const first = ui.action("level-up", "a");
  await ui.action("level-up", "a");
  assert.equal(writes, 1);
  release();
  await first;
  assert.equal(ui.read().levels.a, 2);
});

const store = new Map();
const env = {JWT_SECRET: "skill-tree-test", GLOBAL_ADMIN_ACCOUNT_IDS: "admin", GLOBAL_ADMIN_DEVICE_CODE: "ADMIN-SKILL-TREE-TEST-VERY-STRONG",
  CAMPAIGN_EDITOR_ACCOUNT_IDS: "test:dm", DEVICE_LOGIN_CODES_SECRET: "PLAYER-SKILL-TEST||player|Player;DM-SKILL-TEST||dm|DM",
  SIGILLO_KV: {get: async key => store.get(key) ?? null, put: async (key, value) => {store.set(key, value);}}};
async function request(path, body, token) {
  const response = await worker.fetch(new Request(`https://worker.test/${path}?campaign=test`, {
    headers: {"Content-Type": "application/json", ...(token ? {Authorization: `Bearer ${token}`} : {})},
    ...(body !== undefined ? {method: "POST", body: JSON.stringify(body)} : {})
  }), env, {waitUntil(p) {p.catch(() => {});}});
  return {status: response.status, body: await response.json()};
}
const login = async code => (await request("auth/device/login", {code})).body.token;
const admin = await login(env.GLOBAL_ADMIN_DEVICE_CODE), dm = await login("DM-SKILL-TEST"), player = await login("PLAYER-SKILL-TEST");
assert.ok(admin && dm && player);
const path = "api/data/skill-tree-states";
await request("api/data/skill-trees", {data: [tree], expectedVersion: 0}, admin);
const seed = async data => {
  const current = await request(path);
  const result = await request(path, {data, expectedVersion: current.body.version || 0}, admin);
  assert.equal(result.status, 200);
  assert.deepEqual((await request(path)).body.data, data);
  return result.body.version;
};
await test("DM can unlock a shared tree", async () => {
  const version = await seed([canonical]);
  const result = await request(path, {data: [{...canonical, unlocked: ["a", "b"]}], expectedVersion: version}, dm);
  assert.equal(result.status, 200);
  assert.deepEqual((await request(path)).body.data[0].unlocked, ["a", "b"]);
});
await test("stale browser is refused and preserves latest shared progress", async () => {
  const version = await seed([canonical]);
  await request(path, {data: [{...canonical, unlocked: ["a", "b"]}], expectedVersion: version}, dm);
  assert.equal((await request(path, {data: [canonical], expectedVersion: version}, dm)).status, 409);
  assert.deepEqual((await request(path)).body.data[0].unlocked, ["a", "b"]);
});
await test("state writes without a baseline are refused", async () => {
  await seed([canonical]);
  assert.equal((await request(path, {data: []}, dm)).status, 409);
  assert.deepEqual((await request(path)).body.data, [canonical]);
});
await test("player cannot insert a forged shared state through a personal record", async () => {
  const version = await seed([canonical]);
  const forged = {...canonical, ownerAccountId: "player", shared: false, scope: "character", characterId: "hero", unlocked: ["a", "b"]};
  await request(path, {data: [forged], expectedVersion: version}, player);
  assert.deepEqual((await request(path)).body.data, [canonical]);
});
await test("campaign sentinel stays protected even without the shared flag", async () => {
  const sentinel = {...canonical, id: "legacy", key: "legacy", scope: "character", shared: false, ownerAccountId: "player"};
  const version = await seed([sentinel]);
  await request(path, {data: [], expectedVersion: version}, player);
  assert.deepEqual((await request(path)).body.data, [sentinel]);
});
await test("a player can still unlock their personal tree without changing campaign progress", async () => {
  const version = await seed([canonical]);
  const personal = {...canonical, id: "personal", key: "personal", treeKey: "hero", characterId: "hero", shared: false, scope: "character", ownerAccountId: "player"};
  const result = await request(path, {data: [{...canonical, unlocked: []}, personal], expectedVersion: version}, player);
  assert.equal(result.status, 200);
  assert.deepEqual((await request(path)).body.data, [canonical, personal]);
});
await test("shared definitions without a reserved name are also protected", async () => {
  const trees = await request("api/data/skill-trees");
  await request("api/data/skill-trees", {data: [tree, {...tree, id: "party"}], expectedVersion: trees.body.version}, admin);
  const version = await seed([canonical]);
  await request(path, {data: [{id: "forged", treeKey: "party", characterId: "hero", ownerAccountId: "player", unlocked: ["a"]}], expectedVersion: version}, player);
  assert.deepEqual((await request(path)).body.data, [canonical]);
});
await test("a personal record cannot reuse an existing campaign state id even with a different tree key", async () => {
  const forged = {...canonical, treeKey: "hero", characterId: "hero", shared: false, scope: "character", ownerAccountId: "player"};
  const version = await seed([canonical]);
  await request(path, {data: [forged], expectedVersion: version}, player);
  assert.deepEqual((await request(path)).body.data, [canonical]);
});
await test("campaign states remain separate", async () => {
  const response = await worker.fetch(new Request("https://worker.test/api/data/skill-tree-states?campaign=other"), env, {});
  const payload = await response.json();
  assert.equal(Array.isArray(payload.data) ? payload.data.length : 0, 0);
});

if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
console.log(`Skill tree unlocks: ${checks} checks passed, ${failures.length} failed.`);
