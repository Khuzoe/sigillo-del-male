import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {resolve, join} from "node:path";
import {pathToFileURL} from "node:url";
import vm from "node:vm";

const moduleRoot = process.argv[2];
if (!moduleRoot) throw new Error("Pass the installed cripta-wiki-sync module directory.");
const {NpcDossierVisibilitySync} = await import(pathToFileURL(join(moduleRoot, "scripts/services/npc-dossier-visibility.mjs")));
const coreRoot = resolve(moduleRoot, "../../../App/resources/app");
const [documentSource, backendSource, clientSource] = await Promise.all([
  readFile(join(coreRoot, "common/abstract/document.mjs"), "utf8"),
  readFile(join(coreRoot, "common/abstract/backend.mjs"), "utf8"),
  readFile(join(coreRoot, "client/data/client-backend.mjs"), "utf8")
]);
function method(source, pattern) {
  const match = source.match(pattern)?.[0];
  assert.ok(match, `Native Foundry method available: ${pattern}`);
  return match;
}
const native = {
  update: method(documentSource, /^  async update\([^\n]*\) \{[\s\S]*?^  \}/m),
  updateEmbedded: method(documentSource, /^  async updateEmbeddedDocuments\([^\n]*\) \{[\s\S]*?^  \}/m),
  collectionName: method(documentSource, /^  static getCollectionName\([^\n]*\) \{[\s\S]*?^  \}/m),
  embeddedCollection: method(documentSource, /^  getEmbeddedCollection\([^\n]*\) \{[\s\S]*?^  \}/m),
  parent: method(backendSource, /^  async _getParent\([^\n]*\) \{[\s\S]*?^  \}/m),
  collection: method(clientSource, /^  static #getCollection\([^\n]*\) \{[\s\S]*?^  \}/m),
  request: method(clientSource, /^  static #buildRequest\([^\n]*\) \{[\s\S]*?^  \}/m),
  delta: method(clientSource, /^  static #adjustActorDeltaRequest\([^\n]*\) \{[\s\S]*?^  \}/m),
  ancestor: method(clientSource, /^  static #getTokenAncestor\([^\n]*\) \{[\s\S]*?^  \}/m)
};
const copy = structuredClone;
class Collection extends Map { [Symbol.iterator]() {return this.values();} }

// Real native update methods and request routing; document storage/socket are
// memory doubles. No live Foundry world, Worker, browser or network is touched.
function harness() {
  const h = {state: {pending: {}, applied: {}}, errors: [], writes: [], options: [], incoming: []};
  const game = h.game = {world: {id: "world"}, users: new Collection([["gm", {isGM: true}]]), actors: new Collection(), scenes: new Collection(), collections: new Map(), packs: new Map()};
  const sandbox = {h, game, copy,
    foundry: {utils: {isSubclass: (type, base) => type === base || type.prototype instanceof base}},
    async fromUuid(uuid) {return [...game.scenes].find(scene => scene.uuid === uuid) ?? null;}
  };
  vm.runInNewContext(`
    class Document {
      static hierarchy = {};
      ${native.update}
      ${native.updateEmbedded}
      ${native.collectionName}
      ${native.embeddedCollection}
      static async updateDocuments(updates, operation) {
        h.options.push(operation);
        h.incoming.push({type: this.documentName, parentUuid: operation.parentUuid});
        operation.parent = await backend._getParent(operation);
        const collection = ClientDatabaseBackend.collection(this, operation);
        if (h.failScene && operation.parent?.id === h.failScene) throw new Error("Scene unavailable");
        operation.updates = updates;
        ClientDatabaseBackend.request(this, operation);
        h.writes.push({type: this.documentName, operation: copy(operation)});
        const documents = [];
        for (const update of updates) {
          const document = collection.get(update._id);
          if (!document) throw new Error("Missing memory document");
          for (const [path, value] of Object.entries(update)) {
            if (path === "_id") continue;
            const keys = path.split("."); let target = document;
            for (const key of keys.slice(0, -1)) target = target[key] ??= {};
            target[keys.at(-1)] = copy(value);
          }
          if (h.sync) {
            if (this.documentName === "Actor") await h.sync.onActorUpdate(document, update, operation, "gm");
            else await h.sync.onTokenUpdate(document, update, operation, "gm");
          }
          documents.push(document);
        }
        return documents;
      }
    }
    class Actor extends Document {static documentName = "Actor";}
    class TokenDocument extends Document {static documentName = "Token";}
    class Scene extends Document {
      static documentName = "Scene";
      static hierarchy = {tokens: {model: TokenDocument, getCollection: scene => scene.tokens}};
    }
    class ClientDatabaseBackend {
      ${native.parent}
      ${native.collection}
      ${native.request}
      ${native.delta}
      ${native.ancestor}
      static collection(type, operation) {return this.#getCollection(type, operation);}
      static request(type, operation) {return this.#buildRequest(type, "update", operation);}
    }
    const backend = new ClientDatabaseBackend();
    function getDocumentClass(type) {if (type === "Token") return TokenDocument; throw new Error("Unexpected embedded type");}
    globalThis.classes = {Actor, Scene, TokenDocument};
  `, sandbox);
  const {Actor, Scene, TokenDocument} = sandbox.classes;
  h.actors = ["npc-one", "npc-two"].map(id => Object.assign(new Actor(), {
    id, type: "npc", documentName: "Actor", parent: null, pack: null, prototypeToken: {displayName: 0}, system: {hp: 42}, ownership: {default: 0}
  }));
  for (const actor of h.actors) game.actors.set(actor.id, actor);
  game.collections.set("Actor", game.actors);
  for (const id of ["scene-one", "scene-two"]) {
    const scene = Object.assign(new Scene(), {id, uuid: `Scene.${id}`, documentName: "Scene", parent: null, pack: null, tokens: new Collection()});
    for (const actor of h.actors) for (const actorLink of [true, false]) {
      const tokenId = `${actor.id}-${actorLink ? "linked" : "unlinked"}`;
      scene.tokens.set(tokenId, Object.assign(new TokenDocument(), {id: tokenId, actorId: actor.id, actorLink, displayName: 0, hidden: true, x: 17, parent: scene}));
    }
    game.scenes.set(id, scene);
  }
  h.sync = new NpcDossierVisibilitySync({game, campaignId: () => "campaign", canPush: () => true, canPull: () => true, isManaged: () => true,
    readState: () => copy(h.state), writeState: async state => {h.state = copy(state);}, report: error => h.errors.push(error),
    request: async () => {throw new Error("Unexpected network operation");}, timers: {setTimeout() {throw new Error("Unexpected polling");}, clearTimeout() {}}
  });
  return h;
}

test("native v14 reproduces the reported Actor-in-Scene error when update options are reused", async () => {
  const h = harness(), options = {criptaWikiSyncCommand: true, criptaNpcDossierVisibility: true};
  await h.actors[0].update({"prototypeToken.displayName": 30}, options);
  const scene = h.game.scenes.get("scene-one"), token = [...scene.tokens][0];
  await scene.updateEmbeddedDocuments("Token", [{_id: token.id, displayName: 30}], options);
  assert.equal(options.parentUuid, scene.uuid, "native request serialization mutates the shared options");
  await assert.rejects(() => h.actors[1].update({"prototypeToken.displayName": 30}, options), /Actor is not a valid embedded Document within the Scene Document/);
  assert.equal(h.actors[1].prototypeToken.displayName, 0, "the failed Actor write never persisted");
});

test("public dossiers for successive NPCs use isolated native contexts across multiple scenes", async () => {
  const h = harness();
  for (const actor of h.actors) await h.sync.pull(actor, {revision: 1, visibility: {state: "public"}});
  assert.deepEqual(h.errors, []);
  assert.equal(h.writes.length, 6, "two Actor updates and four per-scene Token batches");
  assert.equal(new Set(h.options).size, h.options.length, "every native write receives its own options object");
  assert.ok(h.incoming.every(operation => operation.parentUuid === undefined), "no call inherits an earlier scene UUID");
  assert.ok(h.writes.filter(write => write.type === "Actor").every(write => !write.operation.parentUuid));
  for (const actor of h.actors) {
    assert.equal(actor.prototypeToken.displayName, 30);
    assert.deepEqual(actor.system, {hp: 42}); assert.deepEqual(actor.ownership, {default: 0});
    assert.equal(h.state.applied[`campaign:world:${actor.id}`].applied, true);
  }
  for (const scene of h.game.scenes) for (const token of scene.tokens) {
    assert.equal(token.displayName, 30); assert.equal(token.hidden, true); assert.equal(token.x, 17);
  }
  assert.deepEqual(h.state.pending, {}, "internal Actor/Token hooks never generate a return publication");
  const count = h.writes.length;
  for (const actor of h.actors) await h.sync.pull(actor, {revision: 1, visibility: {state: "public"}});
  assert.equal(h.writes.length, count, "repeated pulls do not repeat completed writes");
});

test("a partial native scene failure resumes safely and does not poison the next NPC update", async () => {
  const h = harness(), profile = {revision: 1, visibility: {state: "public"}};
  h.failScene = "scene-two";
  await h.sync.pull(h.actors[0], profile);
  assert.equal(h.errors.length, 1);
  assert.equal(h.state.applied["campaign:world:npc-one"], undefined);
  h.failScene = null;
  const count = h.writes.length;
  await h.sync.pull(h.actors[0], profile);
  assert.equal(h.writes.length, count + 1, "only the unfinished scene is retried");
  await h.sync.pull(h.actors[1], profile);
  assert.equal(h.errors.length, 1, "no Actor-in-Scene errors after retry");
  assert.equal(h.state.applied["campaign:world:npc-one"].applied, true);
  assert.equal(h.state.applied["campaign:world:npc-two"].applied, true);
});
