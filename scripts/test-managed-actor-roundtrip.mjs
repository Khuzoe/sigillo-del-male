import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const copy = value => value === undefined ? undefined : structuredClone(value);
const get = (value, path) => path.split(".").reduce((entry, key) => entry?.[key], value);
const set = (value, path, next) => {
    const keys = path.split(".");
    let cursor = value;
    for (const key of keys.slice(0, -1)) cursor = cursor[key] ||= {};
    cursor[keys.at(-1)] = copy(next);
};
function merge(target, changes) {
    for (const [key, value] of Object.entries(changes)) {
        if (key.includes(".")) set(target, key, value);
        else if (value && typeof value === "object" && !Array.isArray(value)) merge(target[key] ||= {}, value);
        else target[key] = copy(value);
    }
}
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, label); checks++; }
function check(condition, label) { assert.ok(condition, label); checks++; }

const modulePath = process.argv[2] || new URL("../module/scripts/services/managed-actor-sync.js", import.meta.url);
const moduleSource = await readFile(modulePath, "utf8");
const foundrySandbox = {
    console, structuredClone, crypto: globalThis.crypto, Set, Map, WeakSet, URL,
    MODULE_ID: "cripta-wiki-sync", SETTINGS: {}, DISCORD_WORKER_URL: "https://worker.test",
    foundry: { utils: { deepClone: copy, getProperty: get, setProperty: set } },
    game: { scenes: [] }
};
vm.runInNewContext(moduleSource.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "")
    + "\nglobalThis.syncTest = { applyManagedActorDocumentUpdate, resolveManagedCommandPatch };", foundrySandbox);
const moduleApi = foundrySandbox.syncTest;
let updates = 0;
const actor = {
    id: "npc", type: "npc", name: "Plexus", prototypeToken: { name: "Plexus" },
    system: { abilities: { str: { value: 20, proficient: 0 } }, attributes: { hp: { max: 100, value: 80 }, ac: { calc: "natural", flat: 18 }, prof: 6 }, traits: { dr: { value: ["fire"], custom: "test" } } },
    async update(changes) { updates++; merge(this, changes); this.system.abilities.str.mod = Math.floor((this.system.abilities.str.value - 10) / 2); }
};
const patches = [
    { path: "system.abilities.str.value", baseValue: 20, value: 24 },
    { path: "system.attributes.hp.max", baseValue: 100, value: 130 },
    { path: "system.attributes.ac.flat", baseValue: 18, value: 20 },
    { path: "system.traits.dr.value", baseValue: ["fire"], value: ["fire", "cold"] }
];
equal((await moduleApi.applyManagedActorDocumentUpdate(actor, { patches })).status, "applied", "Foundry applies stats and confirms readback");
equal(actor.system.abilities.str.mod, 7, "Foundry preparation follows the changed score");
equal(actor.system.attributes.hp, { max: 130, value: 80 }, "editing max HP preserves current HP");
equal(actor.system.traits.dr.custom, "test", "unmodified sibling trait fields survive");
const before = updates;
equal((await moduleApi.applyManagedActorDocumentUpdate(actor, { patches })).status, "applied", "replaying an applied command is idempotent");
equal(updates, before, "replay performs no second mutation");
equal((await moduleApi.applyManagedActorDocumentUpdate(actor, { patches: [{ path: "system.abilities.str.value", baseValue: 20, value: 26 }] })).status, "conflict", "concurrent same-field change is rejected");
equal(actor.system.abilities.str.value, 24, "conflict leaves Foundry untouched");
equal((await moduleApi.applyManagedActorDocumentUpdate(actor, { patches: [{ path: "system.attributes.prof", baseValue: 6, value: 10 }] })).status, "failed", "derived proficiency cannot report a false success");
const oldUpdate = actor.update;
actor.update = async () => {};
const ignored = await moduleApi.applyManagedActorDocumentUpdate(actor, { patches: [{ path: "system.attributes.hp.max", baseValue: 130, value: 150 }] });
equal(ignored.status, "failed", "a schema-ignored write is reported as failed");
equal(ignored.current["system.attributes.hp.max"], 130, "failure carries the actual Foundry value");
actor.update = async () => { throw new Error("Schema validation failed"); };
equal((await moduleApi.applyManagedActorDocumentUpdate(actor, { patches: [{ path: "system.attributes.hp.max", baseValue: 130, value: 150 }] })).status, "failed", "validation failure is visible instead of endless silent retries");
actor.update = oldUpdate;
actor.overrides = { system: { abilities: { str: { value: 24 } } } };
equal((await moduleApi.applyManagedActorDocumentUpdate(actor, { patches: [{ path: "system.abilities.str.value", baseValue: 24, value: 26 }] })).status, "failed", "effect-modified scores cannot accidentally receive the displayed value as their base");
equal(actor.system.abilities.str.value, 24, "an active-effect guard leaves the base stat untouched");
delete actor.overrides;

// Exercise reconciliation/ACK ordering with the real queue runner and a network double.
const pullSandbox = { ...foundrySandbox, canPushToWorker: () => true, canPullFromWorker: () => true };
vm.runInNewContext(moduleSource.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "") + `
    getCampaignId = () => "test";
    buildWorkerAuthHeaders = () => ({});
    globalThis.runPull = async function (confirmed) {
        const seen = { events: [], acks: [] };
        policyFetch = async () => ({ok:true,json:async()=>({commands:[{id:"one",kind:"actor.update"}]})});
        applyManagedActorCommand = async () => ({status:"applied",actor:{id:"npc",name:"Plexus"}});
        syncManagedActorNow = async (_actor,event) => {seen.events.push(event);return confirmed;};
        acknowledgeManagedActorCommands = async (_world,acks) => {seen.acks.push(...acks);};
        await executeManagedActorCommandPull("world");
        return seen;
    };
`, pullSandbox);
const deferred = await pullSandbox.runPull(false);
equal(deferred.acks, [], "no applied ACK when the snapshot was not republished");
check(deferred.events[0].forceContentSync === true, "successful local changes force a fresh content snapshot");
equal((await pullSandbox.runPull(true)).acks, [{ id: "one", status: "applied" }], "ACK follows a confirmed snapshot publication");

const workerSource = await readFile(new URL("../workers/main-worker/src/index.js", import.meta.url), "utf8");
const workerSandbox = { console, Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone, crypto: globalThis.crypto, atob, btoa, setTimeout, clearTimeout };
vm.runInNewContext(workerSource.replace(/^import .*;\r?\n/gm, "").replace(/^export \{.*;\r?\n/gm, "").replace("export default {", "const worker = {") + `
    authorizeManagedActorStatsWrite = async () => ({source: "site", isEditor: true, user: {id: "test-editor"}});
    globalThis.workerTest = { handleManagedActorCommandEnqueue, handleManagedActorCommandAck, handleManagedActorCommandList, managedActorDocumentKey, managedActorCommandQueueKey, managedActorCommandIsSatisfied, mergeManagedPendingPatch };
`, workerSandbox);
const workerApi = workerSandbox.workerTest;
equal(workerApi.mergeManagedPendingPatch(
    { path: "system.activities", baseValue: { attack: { damage: 8, dc: 20, flags: { keep: true } } }, value: { attack: { damage: 10, dc: 20, flags: { keep: true } } } },
    { path: "system.activities", baseValue: { attack: { damage: 8, dc: 20, flags: { keep: true } } }, value: { attack: { damage: 8, dc: 22, flags: { keep: true } } } }
).value, { attack: { damage: 10, dc: 22, flags: { keep: true } } }, "two editors changing different activity fields keep both intents");
const memory = new Map();
const env = { INVENTORY_SYNC_SECRET: "test-secret", SIGILLO_KV: { get: async key => memory.get(key) || null, put: async (key, value) => memory.set(key, value) } };
const route = { worldId: "world", actorId: "npc" };
const document = { ...route, revision: 1, foundryActorId: "npc", definition: { prototypeToken: { actorLink: true }, abilities: { str: { value: 20 } }, attributes: { hp: { max: 100 }, ac: { flat: 18 } }, traits: { dr: { value: ["fire"] } } } };
memory.set(workerApi.managedActorDocumentKey("test", "world", "npc"), JSON.stringify(document));
const commandRequest = body => new Request("https://worker.test/api/managed-actors/world/npc/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: "test", expectedRevision: 1, kind: "actor.update", ...body }) });
async function enqueue(body) {
    const response = await workerApi.handleManagedActorCommandEnqueue(commandRequest(body), route, "test", env);
    return { status: response.status, ...(await response.json()) };
}
const first = await enqueue({ patches });
equal(first.status, 202, "Worker accepts an authenticated valid stat update");
equal(first.command.patches, patches, "Worker retains desired values and their original bases");
const second = await enqueue({ patches: [{ path: "system.abilities.str.value", baseValue: 24, value: 26 }] });
check(second.command.id !== first.command.id, "editing a pending payload gets a new command identity");
equal(second.command.patches.find(p => p.path === "system.abilities.str.value").baseValue, 20, "pending merge retains original conflict baseline");
const ack = new Request("https://worker.test/api/managed-actor-commands/world/ack", { method: "POST", headers: { "Content-Type": "application/json", "X-Cripta-Inventory-Secret": "test-secret", "X-Khuzoe-Sync-Contract": "1", "X-Khuzoe-Foundry-Generation": "14" }, body: JSON.stringify({ campaignId: "test", results: [{ id: first.command.id, status: "applied" }] }) });
equal((await workerApi.handleManagedActorCommandAck(ack, route, "test", env)).status, 200, "late old ACK is accepted without removing newer work");
const queue = JSON.parse(memory.get(workerApi.managedActorCommandQueueKey("test", "world")));
equal(queue.commands.map(command => command.id), [second.command.id], "newer pending stats survive an old ACK");
equal((await enqueue({ patches: [{ path: "system.attributes.prof", baseValue: 6, value: 10 }] })).code, "INVALID_PATCH", "Worker rejects derived stat writes");
equal((await enqueue({ patches: [{ path: "system.abilities.str.proficient", baseValue: 0, value: 2 }] })).code, "INVALID_PATCH", "unsupported save proficiency is rejected");
equal((await enqueue({ patches: [...patches, { path: "unsupported.path", value: 1 }] })).code, "INVALID_PATCH", "invalid fields cannot be silently dropped from a partially accepted save");
equal((await enqueue({ expectedRevision: 0, patches })).code, "VERSION_CONFLICT", "stale envelope revisions are rejected");
const snapshot = { ...document, definition: { ...document.definition, abilities: actor.system.abilities, attributes: actor.system.attributes, traits: actor.system.traits } };
check(workerApi.managedActorCommandIsSatisfied(snapshot, first.command), "roundtrip readback recognizes the intended stats");
check(!workerApi.managedActorCommandIsSatisfied(snapshot, second.command), "readback does not mistake an older value for the latest edit");
console.log(`Managed actor roundtrip: ${checks} checks passed (${process.argv[2] ? "installed module" : "repository module"}).`);
