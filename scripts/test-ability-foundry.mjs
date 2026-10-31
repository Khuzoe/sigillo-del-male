import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import vm from "node:vm";
import {compileAbility} from "../assets/js/shared/npc-ability-schema.mjs";

const root = process.env.FOUNDRY_DATA_PATH || "C:/Program Files/Foundry DEV TEST/FoundryVTT-WindowsPortable-14.367/Data";
const {prepareNpcRules, healFromNpcRule} = await import(pathToFileURL(`${root}/modules/khuzoe-automations/scripts/npc-rules.mjs`));
const source = await readFile(`${root}/modules/cripta-wiki-sync/scripts/services/managed-actor-sync.js`, "utf8");
const fn = source.slice(source.indexOf("async function applyManagedItemCreate("), source.indexOf("async function applyManagedItemDelete("));
const fixture = await readFile(new URL("./test-ability-generation.mjs", import.meta.url), "utf8");
const draft = vm.runInNewContext(fixture.slice(fixture.indexOf("const draft ="), fixture.indexOf("const compiled =")) + "draft");
const rulesDraft = {...draft, conditions: ["prone"], uses: 3};
const document = compileAbility(rulesDraft, "ai-ability-test", "media/campaigns/cripta-di-sangue/managed-actors/a/b/items/ability-ai-test.webp");
globalThis.foundry = {utils: {randomID: () => "GeneratedEffect1"}};
const modules = new Map([["khuzoe-automations", {active: true, api: {npcRules: {version: 1, prepare: prepareNpcRules}}}], ["midi-qol", {active: true}]]);
const sandbox = {structuredClone, crypto, MODULE_ID: "cripta-wiki-sync", CONFIG: {statusEffects: [{id: "prone", name: "Prono", img: "icons/svg/falling.svg"}]},
  game: {modules, items: []}, foundry: {utils: {deepClone: structuredClone, mergeObject: (a, b) => ({...a, ...b})}},
  getItemTransferId: entry => entry.flags["cripta-wiki-sync"].transferId, sanitizeId: value => value,
  toWorkerMediaUrl: path => `https://worker.test/${path}`};
vm.runInNewContext(fn + "globalThis.applyCreate = applyManagedItemCreate;", sandbox);
let creates = 0;
const actor = {items: [], system: {attributes: {hp: {value: 30, max: 90}}}, name: "Custode", async createEmbeddedDocuments(type, data) { assert.equal(type, "Item"); creates++; this.items.push(...structuredClone(data)); }};
const originalStats = JSON.stringify(actor.system);
const command = {target: {transferId: document.transferId}, document};
await sandbox.applyCreate(actor, command);
assert.equal(creates, 1);
assert.equal(actor.items[0].effects[0].statuses[0], "prone");
const activities = actor.items[0].system.activities;
assert.equal(activities.KhzAiFollowup001.effects[0]._id, actor.items[0].effects[0]._id);
assert.equal(activities.KhzAiFollowup001.effects[0].onSave, false, "condition only applies to failed save");
assert.equal(activities.KhzAiPrimary0001.consumption.targets[0].type, "itemUses");
assert.equal(activities.KhzAiFollowup001.consumption.targets.length, 0);
assert.equal(actor.items[0].flags["khuzoe-automations"].npcRules.activities.KhzAiFollowup001.healing, 1);
await sandbox.applyCreate(actor, command); assert.equal(creates, 1, "Foundry deduplicates after queue replay, even after ACK");
assert.equal(JSON.stringify(actor.system), originalStats);
modules.get("midi-qol").active = false;
await assert.rejects(() => sandbox.applyCreate(actor, {...command, target: {transferId: "another"}}), /Midi-QOL/);
assert.equal(creates, 1, "missing dependencies fail before creating an incomplete item");
modules.get("midi-qol").active = true;

const heals = [];
globalThis.game = {user: {id: "dm"}};
globalThis.MidiQOL = {configSettings: () => ({autoApplyDamage: "yes", singleConcentrationRoll: true}), async applyTokenDamage(parts, amount) { heals.push(amount); }};
globalThis.ui = {notifications: {warn() {}}};
const base = {userId: "dm", item: actor.items[0], token: {actor}, damageList: [{tokenUuid: "Scene.a.Token.b", isHit: true, damageDetail: [{type: "necrotic", value: 7}, {type: "none", value: -2}]}]};
await healFromNpcRule({...base, activity: {_id: "KhzAiPrimary0001"}}); assert.deepEqual(heals, [], "attack workflow cannot heal from its physical damage");
const workflow = {...base, activity: {_id: "KhzAiFollowup001"}};
await healFromNpcRule(workflow); await healFromNpcRule(workflow);
assert.deepEqual(heals, [5], "secondary heals adjusted damage once");
await healFromNpcRule({...workflow, damageList: [{tokenUuid: "Scene.a.Token.b", isHit: true, damageDetail: [{type: "necrotic", value: 0}]}]});
assert.deepEqual(heals, [5], "successful save/immunity with zero damage gives zero healing");
globalThis.MidiQOL.configSettings = () => ({autoApplyDamage: "none"});
await healFromNpcRule({...workflow}); assert.deepEqual(heals, [5], "preview-only damage cannot heal");
console.log("Foundry ability integration: actual wiki-sync create handler, effect compiler, transfer deduplication, missing dependencies and actual healing runtime passed; no world data modified.");
