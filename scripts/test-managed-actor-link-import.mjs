import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

// Exercise the installed orchestration and Foundry's actual fromImport method.
// Documents, schema validation, migrations and persistence are in-memory doubles;
// no browser, live world, external Worker or network is used.
const root = process.argv[2];
if (!root) throw new Error("Pass the installed cripta-wiki-sync module directory.");
const moduleSource = fs.readFileSync(path.join(root, "scripts/services/managed-actor-sync.js"), "utf8");
const coreSource = fs.readFileSync(path.resolve(root, "../../../App/resources/app/client/documents/abstract/client-document.mjs"), "utf8");
const nativeFromImport = coreSource.match(/^    static async fromImport\([^\n]*\) \{[\s\S]*?^    \}/m)?.[0];
assert.ok(nativeFromImport, "actual native import preparation must be available");
const copy = structuredClone;
const get = (value, key) => key.split(".").reduce((entry, part) => entry?.[part], value);
function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    const keys = key.split("."); let branch = target;
    for (const part of keys.slice(0, -1)) branch = branch[part] ||= {};
    branch[keys.at(-1)] = copy(value);
  }
  return target;
}
class Collection extends Map { [Symbol.iterator]() { return this.values(); } }
const collection = rows => new Collection(rows.map(row => [row.id, row]));
const document = (hp, name = "NPC") => ({
  _id: "actor", type: "npc", name, img: "portrait.webp", _stats: { coreVersion: "14.367", modifiedTime: 1 },
  folder: "folder", sort: 7, ownership: { default: 0, player: 2 }, flags: { custom: { keep: true } },
  system: { attributes: { hp: { value: hp, max: 100, temp: 3 } }, spells: { spell1: { max: 4, spent: 2 } }, resources: { legact: { max: 3, value: 1 } } },
  items: [{ _id: "attack", name: "Bite", type: "feat",
    system: { quantity: 2, uses: { max: "3", spent: 1 }, activities: {
      bite: { _id: "bite", type: "attack", damage: { parts: [{ number: 2, denomination: 6, bonus: "4", types: ["piercing"] }] } }
    } },
    effects: [{ _id: "item-effect", name: "Rider", changes: [{ key: "system.foo", mode: 2, value: "1" }] }]
  }],
  effects: [{ _id: "prone", name: "Prone", statuses: ["prone"], changes: [], disabled: false }],
  prototypeToken: { name, actorLink: false, displayName: 30, width: 1, height: 1, rotation: 0 }
});

function harness(options = {}) {
  const h = { writes: [], validations: [], migrations: [], notifications: [], state: {}, sceneWrites: [] };
  const original = document(20, "Original"), selected = document(60, "Selected"); selected._id = "synthetic-source";
  h.original = copy(original); h.selected = selected;
  h.game = { version: "14.367", user: { id: "gm", isGM: true }, modules: new Map(), scenes: collection([]), settings: {
    get: () => copy(h.state), set: async (_module, _key, value) => { h.state = copy(value); }
  }, socket: { emit: (_event, _type, source, resolve) => {
    h.migrations.push(copy(source));
    const migrated = copy(source); migrated._stats.coreVersion = "14.367";
    migrated.system.attributes.hp.value = Number(migrated.system.attributes.hp.value);
    resolve({ source: migrated });
  } } };
  h.validate = (source, context) => {
    h.validations.push(copy(context));
    const invalid = [...(source.items || []), ...(source.effects || []), ...(source.items || []).flatMap(item => item.effects || [])].filter(entry => entry.invalidForCurrentSchema);
    if (invalid.length && context.strict && !context.dropInvalidEmbedded) throw new Error(`Invalid embedded document: ${invalid[0]._id}`);
    const data = copy(source);
    if (options.normalize) options.normalize(data);
    return { source: data };
  };
  const ctx = vm.createContext({ game: h.game, h, copy, crypto, structuredClone,
    MODULE_ID: "cripta-wiki-sync", PRIMARY_DOCUMENT_TYPES: ["Actor"],
    foundry: { utils: { deepClone: copy, getProperty: get, mergeObject: merge, isNewerVersion: () => false } },
    console: { info() {}, warn() {}, error() {}, debug() {}, groupCollapsed() {}, groupEnd() {}, table() {} }
  });
  vm.runInContext(`class MemoryActor {
    static documentName = "Actor";
    static metadata = {preserveOnImport:["_id","ownership","sort","folder"]};
    static fromSource(source, context) { return h.validate(source, context); }
    ${nativeFromImport}
  }
  globalThis.MemoryActor = MemoryActor;`, ctx);
  const actor = new ctx.MemoryActor(); h.actor = actor;
  actor.data = copy(original); actor.id = "actor"; actor.documentName = "Actor";
  for (const key of ["_id", "name", "type", "img", "system", "prototypeToken", "ownership", "sort", "flags"]) Object.defineProperty(actor, key, { get: () => actor.data[key] });
  Object.defineProperty(actor, "folder", { get: () => actor.data.folder ? { id: actor.data.folder } : null });
  actor.toJSON = () => copy(actor.data);
  actor.toObject = () => copy(actor.data);
  actor.collection = { fromCompendium: imported => { const data = copy(imported.source); delete data._id; data.ownership = { default: 0 }; delete data.sort; return data; } };
  actor.importFromJSON = () => { throw new Error("Unsafe raw JSON import must not be used"); };
  actor.update = async (data, updateOptions) => {
    const fullImport = "system" in data;
    h.writes.push({ data: copy(data), options: copy(updateOptions), guarded: h.api.isImporting(actor.id) });
    const savedSystem = copy(actor.data.system);
    merge(actor.data, data);
    if (fullImport && options.ignoreSystem) actor.data.system = savedSystem;
    if (fullImport && options.ignoreSelectedSystem && data.name === "Selected") actor.data.system = savedSystem;
    if (fullImport && options.omitItem && data.name === "Selected") actor.data.items = [];
    if (fullImport && options.omitEffect && data.name === "Selected") actor.data.effects = [];
    if (fullImport && options.mutatePayload) data.system.attributes.hp.value = -999;
    if (options.prototypeSideEffect && data.prototypeToken?.actorLink === true) actor.data.system.attributes.hp.value = 1;
    if (options.failUpdate) throw new Error("Backend unavailable");
    return actor;
  };
  h.tokens = ["one", "two"].map((id, index) => {
    const token = { id, data: { _id: id, name: index ? "Other instance" : "Selected token", actorId: "actor", actorLink: false, displayName: 30, width: 1, height: 1, rotation: 0, x: index * 100, y: 50, elevation: 0, sort: 0, hidden: Boolean(index), locked: false, _regions: [], delta: {} } };
    for (const key of Object.keys(token.data)) if (key !== "_id") Object.defineProperty(token, key, { get: () => token.data[key] });
    token.toObject = () => copy(token.data); return token;
  });
  const scene = { id: "scene", tokens: collection(h.tokens), updateEmbeddedDocuments: async (_type, updates) => {
    h.sceneWrites.push(copy(updates));
    for (const data of updates) merge(scene.tokens.get(data._id).data, data);
  } };
  for (const token of h.tokens) token.parent = scene;
  h.game.scenes = collection([scene]);
  const selectedActor = { toJSON: () => copy(h.selected) };
  Object.assign(ctx, { actor, selectedActor, tokens: h.tokens });
  vm.runInContext(moduleSource.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "") + `
    // Keep the real import, token writers, native readback and rollback. The
    // already-reviewed selection itself is a fixture, unrelated to these bugs.
    inspectManagedActorLink = () => ({sources:[{id:"token:scene:one",kind:"token",actorDocument:selectedActor,tokenDocument:tokens[0]}],tokenRecords:[],review:{snapshotHash:"review"}});
    captureManagedActorLinkSnapshot = () => ({schemaVersion:6,commandId:"command",actorDocument:actor.toJSON(),prototypeActorLink:actor.prototypeToken.actorLink,prototypeTokenConfiguration:managedActorLinkTokenConfigurationState(actor.prototypeToken),tokens:tokens.map(token=>({sceneId:"scene",tokenId:token.id,actorLink:token.actorLink,source:token.toObject()}))});
    managedActorLinkSchemaCleanDocumentSource = (_document, source) => copy(source);
    globalThis.api = {importManagedActorLinkActorDocument,executeManagedActorLinkConversion,restoreManagedActorLinkSnapshot,rollbackManagedActorLinkConversion,verifyManagedActorLinkNativeDocument,isImporting:id=>managedActorLinkNativeImports.has(id)};
  `, ctx);
  h.api = ctx.api;
  h.command = { id: "command", document: { snapshotHash: "review", sourceId: "token:scene:one" } };
  h.snapshot = () => ({ schemaVersion: 6, actorDocument: copy(h.original), prototypeActorLink: false, prototypeTokenConfiguration: copy(h.original.prototypeToken), tokens: [] });
  return h;
}

test("complete native conversion preserves selected mechanics, destination identity, permissions and token positions", async () => {
  const h = harness(), before = h.tokens.map(token => ({ x: token.x, y: token.y, hidden: token.hidden }));
  const result = await h.api.executeManagedActorLinkConversion(h.actor, h.command);
  assert.equal(result.status, "applied");
  assert.deepEqual(h.actor.system, h.selected.system); assert.deepEqual(h.actor.data.items, h.selected.items); assert.deepEqual(h.actor.data.effects, h.selected.effects);
  assert.equal(h.actor.data._id, "actor"); assert.deepEqual(h.actor.ownership, h.original.ownership); assert.equal(h.actor.folder.id, h.original.folder);
  assert.equal(h.actor.prototypeToken.actorLink, true); assert.ok(h.tokens.every(token => token.actorLink));
  assert.deepEqual(h.tokens.map(token => ({ x: token.x, y: token.y, hidden: token.hidden })), before);
  assert.equal(h.state.actor.actorLinkConversion.status, "complete");
  assert.deepEqual(h.validations[0], { strict: true, dropInvalidEmbedded: false });
  assert.equal(h.writes[0].guarded, true); assert.equal(h.api.isImporting("actor"), false);
});

for (const kind of ["item", "effect", "item-effect"]) test(`invalid ${kind} fails validation before any document write`, async () => {
  const h = harness();
  const entry = kind === "item" ? h.selected.items[0] : kind === "effect" ? h.selected.effects[0] : h.selected.items[0].effects[0];
  entry.invalidForCurrentSchema = true;
  await assert.rejects(h.api.importManagedActorLinkActorDocument(h.actor, h.selected), /Invalid embedded document/);
  assert.equal(h.writes.length, 0); assert.deepEqual(h.actor.toJSON(), h.original); assert.equal(h.api.isImporting("actor"), false);
});

for (const options of [{ ignoreSelectedSystem: true }, { omitItem: true }, { omitEffect: true }]) test(`partial selected import fails and restores the backup: ${Object.keys(options)[0]}`, async () => {
  const h = harness(options), result = await h.api.executeManagedActorLinkConversion(h.actor, h.command);
  assert.equal(result.status, "failed"); assert.ok(result.diagnostics.length);
  assert.deepEqual(h.actor.toJSON(), h.original); assert.ok(h.tokens.every(token => !token.actorLink));
  assert.equal(h.state.actor.actorLinkConversion, undefined, "complete is never recorded after an incomplete import");
});

test("a side effect of linking tokens cannot bypass the final Actor verification", async () => {
  const h = harness({ prototypeSideEffect: true });
  const result = await h.api.executeManagedActorLinkConversion(h.actor, h.command);
  assert.equal(result.status, "failed"); assert.ok(result.diagnostics.some(entry => entry.PercorsoTecnico.includes("hp.value")));
  assert.deepEqual(h.actor.system, h.original.system); assert.ok(h.tokens.every(token => !token.actorLink));
  assert.equal(h.state.actor.actorLinkConversion, undefined);
});

test("expected native data is captured before update mutates the request", async () => {
  const h = harness({ mutatePayload: true });
  const imported = await h.api.importManagedActorLinkActorDocument(h.actor, h.selected);
  assert.equal(imported.expectedSource.system.attributes.hp.value, 60);
  assert.equal(h.actor.system.attributes.hp.value, 60);
  assert.equal(h.api.verifyManagedActorLinkNativeDocument(h.actor, imported.expectedSource).ok, true);
});

test("backup restore rejects ignored mechanics instead of verifying the post-import Actor against itself", async () => {
  const h = harness({ ignoreSystem: true }), snapshot = h.snapshot(); snapshot.actorDocument.system.attributes.hp.value = 99;
  await assert.rejects(h.api.restoreManagedActorLinkSnapshot(h.actor, snapshot), /backup nativo/);
  assert.equal(h.actor.system.attributes.hp.value, 20); assert.equal(snapshot.actorDocument.system.attributes.hp.value, 99);
});

test("a failed explicit rollback retains the complete backup and reports failure", async () => {
  const h = harness({ ignoreSystem: true }), snapshot = h.snapshot(); snapshot.actorDocument.system.attributes.hp.value = 99;
  h.state = { actor: { revision: 5, actorLinkConversion: { status: "complete", snapshot } } };
  const before = copy(h.state);
  const result = await h.api.rollbackManagedActorLinkConversion(h.actor);
  assert.equal(result.status, "failed"); assert.deepEqual(h.state, before);
});

test("successful native backup restores complete mechanics without mutating the saved snapshot", async () => {
  const h = harness(), snapshot = h.snapshot(), before = copy(snapshot);
  snapshot.actorDocument.system.attributes.hp.value = 99; before.actorDocument.system.attributes.hp.value = 99;
  await h.api.restoreManagedActorLinkSnapshot(h.actor, snapshot);
  assert.equal(h.actor.system.attributes.hp.value, 99); assert.deepEqual(snapshot, before);
});

test("expected data includes native migration/defaults and excludes prepared display values and bookkeeping", async () => {
  const h = harness({ normalize: data => { data.system.migrated = true; } });
  h.selected._stats.coreVersion = "12.331"; h.selected.system.attributes.hp.value = "60";
  const imported = await h.api.importManagedActorLinkActorDocument(h.actor, h.selected);
  assert.equal(h.migrations.length, 1); assert.equal(imported.expectedSource.system.attributes.hp.value, 60); assert.equal(imported.expectedSource.system.migrated, true);
  h.actor.data._stats.modifiedTime = 999;
  Object.defineProperty(h.actor, "items", { value: [{ name: "Localized display title" }] });
  assert.equal(h.api.verifyManagedActorLinkNativeDocument(h.actor, imported.expectedSource).ok, true);
});

test("backend exceptions always release the internal import guard", async () => {
  const h = harness({ failUpdate: true });
  await assert.rejects(h.api.importManagedActorLinkActorDocument(h.actor, h.selected), /Backend unavailable/);
  assert.equal(h.api.isImporting("actor"), false);
});
