import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import vm from "node:vm";

const servicePath = process.argv[2] || fileURLToPath(new URL("../module/scripts/services/managed-actor-sync.js", import.meta.url));
const automationPath = process.argv[3] || resolve(dirname(servicePath), "../../../khuzoe-automations/scripts/npc-rules.mjs");
const {prepareNpcRules} = await import(pathToFileURL(automationPath));
const {validateManagedMidiRollConfig} = await import(pathToFileURL(resolve(dirname(servicePath), "midi-roll-config.mjs")));
const {isTemporaryWikiActor} = await import(pathToFileURL(resolve(dirname(servicePath), "actor-sync-eligibility.mjs")));
const v14 = await import(pathToFileURL(resolve(dirname(servicePath), "foundry-v14.js")));
let checks = 0;
const plain = value => JSON.parse(JSON.stringify(value));
const equal = (actual, expected, label) => {assert.deepEqual(plain(actual), plain(expected), label); checks++;};
const check = (value, label) => {assert.ok(value, label); checks++;};
const copy = value => value === undefined ? undefined : structuredClone(value);
const get = (root, path) => path.split(".").reduce((value, key) => value?.[key], root);
const set = (root, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  for (const key of keys) root = root[key] ??= {};
  root[last] = copy(value);
};
function merge(root, changes) {
  for (const [key, value] of Object.entries(changes)) {
    if (key.startsWith("-=")) delete root[key.slice(2)];
    else if (key.includes(".")) set(root, key, value);
    else if (value && typeof value === "object" && !Array.isArray(value)) merge(root[key] ??= {}, value);
    else root[key] = copy(value);
  }
}
class Collection extends Map { [Symbol.iterator]() {return this.values();} }
let sequence = 0, writes = 0;
const utils = {deepClone: copy, getProperty: get, setProperty: set, randomID: () => String(++sequence).padStart(16, "0")};
globalThis.foundry = {utils};
globalThis.game = {i18n: {localize: value => value}};
const statuses = [{id: "prone", name: "Prono", img: "icons/svg/falling.svg"}, {id: "poisoned", name: "Avvelenato"}];
const activity = {_source: {_id: "attack", type: "attack", name: "Morso", effects: []}, id: "attack",
  toObject() {return copy(this._source);}, async update(update) {writes++; merge(this._source, update);}};
const item = {documentName: "Item", id: "bite", name: "Morso", type: "weapon", flags: {"other-module": {untouched: true}},
  effects: new Collection(), system: {activities: new Collection([["attack", activity]])},
  async createEmbeddedDocuments(type, sources) {
    assert.equal(type, "ActiveEffect"); writes++;
    for (const source of sources) this.effects.set(source._id, {_source: copy(source), toObject() {return copy(this._source);}});
  },
  async updateEmbeddedDocuments(type, sources) {
    assert.equal(type, "ActiveEffect"); writes++;
    for (const source of sources) this.effects.get(source._id)._source = copy(source);
  },
  async deleteEmbeddedDocuments(type, ids) {assert.equal(type, "ActiveEffect"); writes++; for (const id of ids) this.effects.delete(id);}
};
const actor = {id: "npc", items: new Collection([["bite", item]]), async updateEmbeddedDocuments(type, sources) {
  assert.equal(type, "Item"); writes++; for (const source of sources) merge(this.items.get(source._id), source);
}};
item.parent = actor;
const sandbox = {console, structuredClone, Set, Map, WeakSet, URL, crypto: globalThis.crypto,
  ...v14, validateManagedMidiRollConfig, isTemporaryWikiActor, foundry: {utils}, CONFIG: {statusEffects: statuses},
  MODULE_ID: "cripta-wiki-sync", SETTINGS: {}, DISCORD_WORKER_URL: "https://worker.test",
  game: {actors: new Collection([["npc", actor]]), modules: new Map([["khuzoe-automations", {api: {npcRules: {version: 1, prepare: prepareNpcRules}, midiRollConfig: {version: 1, validate() {throw new Error("Storage must not call the runtime API");}}}}]])}
};
const service = await readFile(servicePath, "utf8");
vm.runInNewContext(service.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "")
  + "\nglobalThis.api = {applyManagedActorCommand, getManagedItemEffects, readManagedCommandPath, buildManagedEditorMetadata, buildManagedActorEntry};", sandbox);
const api = sandbox.api;
const rulesPath = "flags.khuzoe-automations.npcRules";
const emptyRules = {version: 1, activities: {}};
const desiredRules = {version: 1, activities: {attack: {healing: 0.5, conditions: ["prone"], rounds: 2, expiry: "turnEnd"}}};
const command = patches => ({kind: "item.update", foundryActorId: "npc", target: {itemId: "bite"}, patches});
const patch = {path: rulesPath, baseValue: emptyRules, value: desiredRules};
const result = await api.applyManagedActorCommand(command([patch]));
equal(result.status, "applied", result.error ?? "preset is applied end to end");
equal(item.flags["khuzoe-automations"].npcRules, desiredRules, "structured rules persist without overwriting other flags");
equal(item.flags["other-module"], {untouched: true}, "foreign module flags survive");
equal(item.effects.size, 1, "generated effect is an embedded ActiveEffect");
equal(activity._source.effects[0]._id, [...item.effects.keys()][0], "native activity references the created effect");
const previousWrites = writes;
equal((await api.applyManagedActorCommand(command([patch]))).status, "applied", "replay reports applied");
equal(writes, previousWrites, "replay causes no document writes");
const conflict = await api.applyManagedActorCommand(command([{...patch, value: {...desiredRules, activities: {attack: {...desiredRules.activities.attack, healing: 1}}}}]));
equal(conflict.status, "conflict", "stale modification of the same rule conflicts");
equal(writes, previousWrites, "conflict mutates nothing");
const invalid = await api.applyManagedActorCommand(command([{path: rulesPath, baseValue: desiredRules, value: {version: 1, activities: {missing: {healing: 1}}}}]));
equal(invalid.status, "failed", "invalid activity fails before mutation");
equal(writes, previousWrites, "invalid rule leaves all documents intact");
const unknownReference = {attack: {...activity.toObject(), effects: [{_id: "absent0000000000"}]}};
const oldRules = item.flags["khuzoe-automations"].npcRules;
delete item.flags["khuzoe-automations"].npcRules;
const invalidLink = await api.applyManagedActorCommand(command([{path: "system.activities", baseValue: {attack: activity.toObject()}, value: unknownReference}]));
equal(invalidLink.status, "failed", "dangling effect reference is rejected");
equal(writes, previousWrites, "invalid reference fails before all mutations");
item.flags["khuzoe-automations"].npcRules = oldRules;
const baseEffects = api.getManagedItemEffects(item);
const changedEffects = copy(baseEffects);
changedEffects[0].disabled = true;
equal((await api.applyManagedActorCommand(command([{path: "effects", baseValue: baseEffects, value: changedEffects}]))).status, "applied", "advanced embedded effect edit persists");
equal(api.getManagedItemEffects(item)[0].disabled, true, "effect readback sees the change");
equal((await api.applyManagedActorCommand(command([{path: rulesPath, baseValue: desiredRules, value: emptyRules}]))).status, "applied", "removing presets succeeds");
equal(item.effects.size, 0, "removing preset cleans up generated effects");
equal(activity._source.effects, [], "removing preset clears only generated links");
equal(item.flags["khuzoe-automations"].npcRules, emptyRules, "nested removed flags are actually deleted in Foundry");
const normalUpdate = activity.update;
activity.update = async () => {throw new Error("Transient activity failure");};
equal((await api.applyManagedActorCommand(command([patch]))).status, "failed", "partial failure is not reported as applied");
equal(item.effects.size, 1, "partial failure has one recoverable generated effect");
activity.update = normalUpdate;
equal((await api.applyManagedActorCommand(command([patch]))).status, "applied", "retry repairs links even when the rules flag already persisted");
equal(item.effects.size, 1, "retry after a partial failure creates no duplicate effect");
equal(activity._source.effects.length, 1, "retry restores the native activity link");
const metadata = api.buildManagedEditorMetadata({_source: {system: {abilities: {str: {value: 12}}}}, system: {abilities: {str: {value: 20}}}, overrides: {system: {abilities: {str: {value: 20}}}}});
const midiPath = "flags.khuzoe-automations.midiRollConfig";
const midiEmpty = {version: 1, activities: {}};
const midiDesired = {version: 1, activities: {attack: {enabled: true, attackMaxChance: 20, damageMaxChance: 50}}};
equal(metadata.midiRollConfig, 1, "runtime capability reaches the editor");
equal(api.readManagedCommandPath(item, midiPath), midiEmpty, "missing flag has a stable baseline");
const midiPatch = {path: midiPath, baseValue: midiEmpty, value: midiDesired};
equal((await api.applyManagedActorCommand(command([midiPatch]))).status, "applied", "admin roll config persists through sync");
equal(item.flags["khuzoe-automations"].midiRollConfig, midiDesired, "stored configuration matches requested activity");
equal(item.flags["khuzoe-automations"].npcRules, desiredRules, "roll config preserves healing and conditions");
equal(item.flags["other-module"], {untouched: true}, "roll config preserves unrelated flags");
const afterMidi = writes;
equal((await api.applyManagedActorCommand(command([midiPatch]))).status, "applied", "repeated configuration is idempotent");
equal(writes, afterMidi, "repeated configuration performs no writes");
const midiOff = structuredClone(midiDesired); midiOff.activities.attack.enabled = false;
equal((await api.applyManagedActorCommand(command([{...midiPatch, value: midiOff}]))).status, "conflict", "stale private configuration conflicts");
equal((await api.applyManagedActorCommand(command([{...midiPatch, baseValue: midiDesired, value: midiOff}]))).status, "applied", "disable preserves configured percentages");
equal(item.flags["khuzoe-automations"].midiRollConfig, midiOff, "disabled configuration is retained");
const beforeInvalidMidi = writes;
equal((await api.applyManagedActorCommand(command([{path: midiPath, baseValue: midiOff, value: {activities: {missing: {enabled: true}}}}]))).status, "failed", "unknown activity rejected before mutations");
equal(writes, beforeInvalidMidi, "invalid private configuration causes no partial writes");
equal((await api.applyManagedActorCommand(command([{path: midiPath, baseValue: midiOff, value: midiEmpty}]))).status, "applied", "clearing removes old nested activity flags");
equal(item.flags["khuzoe-automations"].midiRollConfig, midiEmpty, "cleared rules do not reappear after merge");
const updatedModule = sandbox.game.modules.get("khuzoe-automations");
const unavailableModules = [undefined, {active: false}, {active: true, api: {}}, {active: true, api: {midiRollConfig: {version: 0, validate() {throw new Error("Old runtime called");}}}}];
for (const unavailable of unavailableModules) {
  if (unavailable) sandbox.game.modules.set("khuzoe-automations", unavailable);
  else sandbox.game.modules.delete("khuzoe-automations");
  equal(api.buildManagedEditorMetadata({_source: {}}).midiRollConfig, 0, "runtime metadata stays truthful when execution is unavailable");
  equal((await api.applyManagedActorCommand(command([midiPatch]))).status, "applied", "flag can be stored with old, inactive or absent Automations");
  equal(item.flags["khuzoe-automations"].midiRollConfig, midiDesired, "configuration persists without runtime integration");
  const beforeReplay = writes;
  equal((await api.applyManagedActorCommand(command([midiPatch]))).status, "applied", "retry without runtime remains idempotent");
  equal(writes, beforeReplay, "retry without runtime performs no writes");
  equal((await api.applyManagedActorCommand(command([{path: "name", baseValue: item.name, value: "Morso aggiornato"}]))).status, "applied", "ordinary ability editing remains available without Automations");
  equal(item.flags["khuzoe-automations"].midiRollConfig, midiDesired, "ordinary edits retain previously stored probability flags");
  const exportedItem = {id: item.id, name: item.name, type: item.type, flags: item.flags, effects: item.effects, system: {activities: item.system.activities},
    toObject: () => ({_id: item.id, name: item.name, type: item.type, flags: copy(item.flags), system: {activities: {attack: activity.toObject()}}})};
  equal(api.buildManagedActorEntry(exportedItem).definition.flags["khuzoe-automations"].midiRollConfig, midiDesired, "next Foundry snapshot retains stored rules even without runtime");
  for (const badConfig of [
    {version: 2, activities: {}}, {activities: {missing: {enabled: true}}},
    {activities: {attack: {attackMaxChance: -1}}}, {activities: {attack: {damageMaxChance: 101}}},
    {activities: {attack: {enabled: "true"}}}, {activities: {attack: {when: "always"}}}
  ]) {
    const beforeInvalid = writes;
    const badCommand = command([{path: "name", baseValue: item.name, value: "Must not be written"}, {path: midiPath, baseValue: midiDesired, value: badConfig}]);
    equal((await api.applyManagedActorCommand(badCommand)).status, "failed", "invalid config is rejected locally even without runtime");
    equal(writes, beforeInvalid, "invalid config prevents the entire item command from writing");
  }
  equal((await api.applyManagedActorCommand(command([{path: midiPath, baseValue: midiDesired, value: midiOff}]))).status, "applied", "stored rule can be disabled without runtime");
  equal(item.flags["khuzoe-automations"].midiRollConfig, midiOff, "disabling preserves percentages without runtime");
  equal((await api.applyManagedActorCommand(command([{path: midiPath, baseValue: midiOff, value: midiEmpty}]))).status, "applied", "stored rule can be cleared without runtime");
  equal(item.flags["khuzoe-automations"].midiRollConfig, midiEmpty, "clearing removes nested stored rules without runtime");
}
sandbox.game.modules.set("khuzoe-automations", updatedModule);
equal(metadata.fields["system.abilities.str.value"].editable, false, "effect-controlled stat is marked read-only");
equal(metadata.fields["system.abilities.str.value"].base, 12, "base stat is transmitted separately");
equal(metadata.fields["system.abilities.str.value"].effective, 20, "effective stat remains visible");

const worker = await readFile(new URL("../workers/main-worker/src/index.js", import.meta.url), "utf8");
const workerSandbox = {console, Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone, CalendarStoreBase: class {},
  crypto: globalThis.crypto, atob, btoa, setTimeout, clearTimeout};
vm.runInNewContext(worker.replace(/^import .*;\r?\n/gm, "").replace(/^export \{.*;\r?\n/gm, "").replace(/^export class /gm, "class ").replace("export default {", "const worker = {")
  + "\nglobalThis.api = {normalizeManagedActorCommandPatch, handleManagedActorRuntimePost, managedActorDocumentKey, managedActorCommandItemValue};", workerSandbox);
const workerApi = workerSandbox.api;
equal(workerApi.normalizeManagedActorCommandPatch(patch), patch, "worker retains rule baselines and values");
equal(workerApi.normalizeManagedActorCommandPatch({path: "effects", baseValue: baseEffects, value: changedEffects}).value, changedEffects, "worker preserves full embedded effect data");
for (const bad of [
  {path: rulesPath, value: {version: 9, activities: {}}},
  {path: rulesPath, value: {version: 1, activities: {attack: {healing: 7}}}},
  {path: rulesPath, value: {version: 1, activities: {attack: {conditions: ["imaginary"]}}}},
  {path: "flags.other-module", value: {overwrite: true}},
  {path: "effects", value: [{_id: "short", name: "Invalid"}]},
  {path: "effects", value: [...baseEffects, ...baseEffects]},
  {path: "flags.dae", value: {tooLong: "x".repeat(12_001)}},
  {path: "flags.dae", value: JSON.parse('{"__proto__":{"polluted":true}}')}
]) equal(workerApi.normalizeManagedActorCommandPatch(bad), null, "invalid or truncated automation is refused");
equal(workerApi.normalizeManagedActorCommandPatch({path: "system.uses.max", value: "@prof + 2", baseValue: "3"}).value, "@prof + 2", "resource formula is retained as a formula");
equal(workerApi.managedActorCommandItemValue({definition: {flags: {"khuzoe-automations": {npcRules: desiredRules}}}}, rulesPath), desiredRules, "worker readback understands preset flags");
let kvWrites = 0, r2Calls = 0;
const memory = new Map();
const route = {worldId: "world", actorId: "npc"};
const env = {INVENTORY_SYNC_SECRET: "test-secret", SIGILLO_KV: {
  get: async key => memory.get(key) ?? null,
  put: async (key, value) => {kvWrites++; memory.set(key, value);}
}, MEDIA_BUCKET: {get() {r2Calls++;}, put() {r2Calls++;}}};
memory.set(workerApi.managedActorDocumentKey("test", "world", "npc"), JSON.stringify({runtimePolicy: "shared", definition: {prototypeToken: {actorLink: true}}}));
const runtimeRequest = value => new Request("https://worker.test/runtime", {method: "POST", headers: {"Content-Type": "application/json", "X-Cripta-Inventory-Secret": "test-secret", "X-Khuzoe-Sync-Contract": "1", "X-Khuzoe-Foundry-Generation": "14"}, body: JSON.stringify({campaignId: "test", runtime: {hp: {value, temp: 5, max: 100}}})});
equal((await workerApi.handleManagedActorRuntimePost(runtimeRequest(80), route, "test", env)).status, 200, "runtime request accepted");
equal(kvWrites, 1, "first runtime writes once");
const unchanged = await workerApi.handleManagedActorRuntimePost(runtimeRequest(80), route, "test", env);
equal((await unchanged.json()).saved, false, "identical runtime is acknowledged without rewriting");
equal(kvWrites, 1, "unchanged runtime saves one KV write");
await workerApi.handleManagedActorRuntimePost(runtimeRequest(79), route, "test", env);
equal(kvWrites, 2, "changed HP still write immediately");
equal(r2Calls, 0, "stat synchronization never touches R2");
console.log(`Managed NPC integration: ${checks} checks passed.`);
