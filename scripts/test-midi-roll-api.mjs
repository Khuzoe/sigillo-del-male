import assert from "node:assert/strict";
import worker from "../workers/main-worker/src/index.js";

const store = new Map();
let writes = 0, checks = 0;
const env = {JWT_SECRET: "midi-test-jwt", INVENTORY_SYNC_SECRET: "midi-test-sync", GLOBAL_ADMIN_ACCOUNT_IDS: "admin",
  GLOBAL_ADMIN_DEVICE_CODE: "ADMIN-MIDI-TEST-CODE-VERY-STRONG",
  CAMPAIGN_EDITOR_ACCOUNT_IDS: "dm",
  DEVICE_LOGIN_CODES_SECRET: "PLAYER-MIDI-TEST||player|Player;DM-MIDI-TEST||dm|Dungeon Master",
  SIGILLO_KV: {get: async k => store.get(k) ?? null, put: async (k, v) => {writes++; store.set(k, v);}, delete: async k => store.delete(k)}};
const syncHeaders = {"X-Cripta-Inventory-Secret": env.INVENTORY_SYNC_SECRET, "X-Khuzoe-Sync-Contract": "1", "X-Khuzoe-Foundry-Generation": "14"};
const equal = (a, b, label) => {assert.deepEqual(a, b, label); checks++;};
const path = "api/managed-actors/world/npc";
const flag = "flags.khuzoe-automations.midiRollConfig";
async function request(url, body, token) {
  const response = await worker.fetch(new Request(`https://worker.test/${url}?campaign=test`, {
    headers: {"Content-Type": "application/json", ...(token === "sync" ? syncHeaders : token ? {Authorization: `Bearer ${token}`} : {})},
    ...(body !== undefined ? {method: "POST", body: JSON.stringify(body)} : {})
  }), env, {waitUntil(p) {p.catch(() => {});}});
  return {status: response.status, body: await response.json(), cache: response.headers.get("Cache-Control")};
}
const login = async code => (await request("auth/device/login", {code})).body.token;
const admin = await login(env.GLOBAL_ADMIN_DEVICE_CODE), player = await login("PLAYER-MIDI-TEST"), dm = await login("DM-MIDI-TEST");
assert.ok(admin && player && dm);
const config = {version: 1, activities: {bite: {enabled: true, attackMaxChance: 20, damageMaxChance: 50}}};
const item = {itemId: "item", transferId: "transfer", name: "Morso", definition: {activities: {bite: {type: "attack"}, save: {type: "save"}}, flags: {"khuzoe-automations": {midiRollConfig: config, npcRules: {version: 1, activities: {}}}}}};
const seeded = await request(path, {name: "Fixture", actorType: "npc", ownerAccountIds: ["player"], visibility: {state: "public"},
  contract: {name: "khuzoe-wiki-sync", version: 1, module: {id: "cripta-wiki-sync", version: "0.11.1"}, foundry: {generation: 14}, system: {id: "dnd5e", version: "5.3.3"}},
  definition: {prototypeToken: {actorLink: true}, editor: {midiRollConfig: 1}, items: [item]}, expectedRevision: 0}, "sync");
equal(seeded.status, 200, "seed fixture through Foundry contract");
const command = (value, patchPath = flag) => ({kind: "item.update", expectedRevision: 1, target: {itemId: "item"}, patches: [{path: patchPath, value, baseValue: config}]});
for (const token of [undefined, player, dm]) {
  const read = await request(path, undefined, token);
  equal(read.status, 200, "normal actor stays readable");
  equal(JSON.stringify(read.body).includes("midiRollConfig"), false, "private rule and capability are absent");
  equal(read.body.data.permissions.canConfigureMidiRolls, false, "owner/DM is not site admin");
}
for (const token of [admin, "sync"]) {
  const read = await request(path, undefined, token);
  equal(read.body.data.definition.items[0].definition.flags["khuzoe-automations"].midiRollConfig, config, "admin and sync read full config");
  equal(read.cache, "private, no-store", "no shared caching of private rules");
}
equal((await request(path, undefined, admin)).body.data.permissions.canConfigureMidiRolls, true, "admin editing capability");
for (const token of [player, dm]) {
  for (const patchPath of [flag, ` ${flag} `]) {
    const before = writes;
    equal((await request(path + "/commands", command(config, patchPath), token)).status, 403, "non-admin write rejected including normalized paths");
    equal(writes, before, "rejected write does not enqueue anything");
  }
}
for (const bad of [
  {version: 2, activities: {}}, {activities: {missing: {enabled: true}}}, {activities: {save: {attackMaxChance: 50}}},
  {activities: {bite: {enabled: "true"}}}, {activities: {bite: {damageMaxChance: -1}}},
  {activities: {bite: {damageMaxChance: 101}}}, {activities: {bite: {damageMaxChance: "50"}}},
  {activities: {bite: {when: "always"}}}, {activities: {bite: {script: "unsafe()"}}},
  {activities: JSON.parse('{"__proto__":{"enabled":true}}')}
]) {
  const before = writes;
  equal((await request(path + "/commands", command(bad), admin)).status, 400, "invalid config rejected");
  equal(writes, before, "invalid config leaves queue intact");
}
const next = structuredClone(config); next.activities.bite.attackMaxChance = 30;
equal((await request(path + "/commands", command(next), admin)).status, 202, "admin can enqueue configuration");
let read = await request(path, undefined, player);
equal(JSON.stringify(read.body).includes("attackMaxChance"), false, "pending private command not disclosed");
const ordinary = {kind: "item.update", expectedRevision: 1, target: {itemId: "item"}, patches: [{path: "name", baseValue: "Morso", value: "Morso feroce"}]};
const merged = await request(path + "/commands", ordinary, player);
equal(merged.status, 202, "ordinary player edit can coexist with admin config");
equal(merged.body.command.patches.map(p => p.path), ["name"], "merged command response hides private patches");
equal(JSON.stringify(merged.body).includes("attackMaxChance"), false, "no merged response leak");
read = await request(path, undefined, player);
equal(read.body.data.sync.commands[0].patches.map(p => p.path), ["name"], "ordinary edit remains visible in pending list");
equal(JSON.stringify(read.body).includes("attackMaxChance"), false, "no pending list leak");
const adminRead = await request(path, undefined, admin);
equal(adminRead.body.data.sync.commands[0].patches.length, 2, "private setting survives concurrent ordinary edit");
// Inspect the stored queue to ensure the private patch is preserved for Foundry.
const queue = [...store.values()].map(v => {try {return JSON.parse(v);} catch {return null;}}).find(v => v?.commands?.some(c => c.patches?.some(p => p.path === flag)));
equal(queue.commands[0].patches.find(p => p.path === flag).value, next, "Foundry queue retains admin values");
const stale = command(next); stale.expectedRevision = 0;
equal((await request(path + "/commands", stale, admin)).status, 409, "stale revision rejected");
equal((await request(path, undefined, admin)).body.data.definition.items[0].definition.flags["khuzoe-automations"].midiRollConfig, config, "queue does not fake application in Foundry");
// Old snapshots have native activities but no roll flag and no editor capability.
for (const capability of [undefined, 0]) {
  const legacyPath = `api/managed-actors/world/legacy-${capability ?? "missing"}`;
  const legacyDefinition = {prototypeToken: {actorLink: true}, items: [{...item, definition: {activities: item.definition.activities}}]};
  if (capability !== undefined) legacyDefinition.editor = {midiRollConfig: capability};
  equal((await request(legacyPath, {name: "Legacy fixture", actorType: "npc", ownerAccountIds: ["player"], visibility: {state: "public"},
    contract: {name: "khuzoe-wiki-sync", version: 1, module: {id: "cripta-wiki-sync", version: "0.11.1"}, foundry: {generation: 14}, system: {id: "dnd5e", version: "5.3.3"}},
    definition: legacyDefinition, expectedRevision: 0}, "sync")).status, 200, "old snapshot accepted without roll capability");
  equal((await request(legacyPath, undefined, admin)).body.data.permissions.canConfigureMidiRolls, true, "admin permission is independent of runtime snapshot");
  const legacyCommand = command(next); legacyCommand.patches[0].baseValue = {version: 1, activities: {}};
  equal((await request(legacyPath + "/commands", legacyCommand, admin)).status, 202, "admin config can be queued on an old ability without stored flags");
  for (const token of [player, dm]) {
    equal((await request(legacyPath + "/commands", legacyCommand, token)).status, 403, "old snapshot does not bypass admin-only writes");
    equal(JSON.stringify((await request(legacyPath, undefined, token)).body).includes("attackMaxChance"), false, "old snapshot hides pending probability settings from ordinary readers");
  }
  equal((await request(legacyPath, undefined, "sync")).body.data.sync.commands[0].patches[0].value, next, "Foundry receives stored configuration even without runtime capability");
}
console.log(`Midi API permissions and validation: ${checks} checks passed.`);
