import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import worker from "../workers/main-worker/src/index.js";

// Run against the installed module, without connecting to a live world/Worker.
const root = process.argv[2];
if (!root) throw new Error("Pass the cripta-wiki-sync module directory as the first argument.");
const { NpcDossierVisibilitySync, NPC_VISIBILITY_SETTING } = await import(pathToFileURL(`${root}/scripts/services/npc-dossier-visibility.mjs`));
const { isTemporaryWikiActor } = await import(pathToFileURL(`${root}/scripts/services/actor-sync-eligibility.mjs`));
const copy = structuredClone;
class Collection extends Map { [Symbol.iterator]() { return this.values(); } }
const collection = values => new Collection(values.map(value => [value.id, value]));

function harness() {
  const h = { state: { pending: {}, applied: {} }, writes: [], requests: [], errors: [], scheduled: new Map(), campaign: "test-campaign", push: true, pull: true, managed: true };
  h.profile = { revision: 1, visibility: { state: "dm" }, blocks: [{ text: "Secret", visibility: "dm" }] };
  h.actor = { id: "test-npc", type: "npc", documentName: "Actor", prototypeToken: { displayName: 0, name: "Name", hidden: false }, system: { hp: 42 }, ownership: { default: 0 } };
  h.other = { ...copy(h.actor), id: "other" };
  h.game = { world: { id: "test-world" }, user: { id: "gm", isGM: true }, users: collection([{ id: "gm", isGM: true }, { id: "gm2", isGM: true }, { id: "player", isGM: false }]), actors: collection([h.actor, h.other]) };
  h.game.users.activeGM = h.game.user;
  h.game.scenes = collection(["one", "two"].map(id => {
    const scene = { id, tokens: collection([
      { id: `${id}-linked`, actorId: h.actor.id, actorLink: true, displayName: 0, hidden: true, name: "Linked", x: 42 },
      { id: `${id}-unlinked`, actorId: h.actor.id, actorLink: false, displayName: 20, hidden: false, name: "Unlinked", x: 17 },
      { id: `${id}-other`, actorId: h.other.id, displayName: 40, hidden: true, name: "Other" }
    ]) };
    for (const token of scene.tokens) token.parent = scene;
    scene.updateEmbeddedDocuments = async (type, updates, options) => {
      assert.equal(type, "Token");
      if (h.failScene === id) throw new Error("Scene unavailable");
      h.writes.push({ scene: id, updates: copy(updates), options: copy(options) });
      for (const update of updates) {
        const token = scene.tokens.get(update._id);
        for (const [path, value] of Object.entries(update)) {
          if (path === "_id") continue;
          const keys = path.split("."); let target = token;
          for (const key of keys.slice(0, -1)) target = target[key] ||= {};
          target[keys.at(-1)] = copy(value);
        }
        await h.sync.onTokenUpdate(token, update, options, "gm");
      }
    };
    return scene;
  }));
  h.actor.update = async (changes, options) => {
    h.writes.push({ actor: h.actor.id, changes: copy(changes), options: copy(options) });
    if (!h.ignoreActorUpdate) h.actor.prototypeToken.displayName = changes["prototypeToken.displayName"];
    await h.sync.onActorUpdate(h.actor, changes, options, "gm");
  };
  const leader = () => h.game.user.isGM && h.game.users.activeGM.id === h.game.user.id;
  h.sync = new NpcDossierVisibilitySync({
    game: h.game, campaignId: () => h.campaign, canPush: () => h.push && leader(), canPull: () => h.pull && leader(), isManaged: () => h.managed,
    readState: () => copy(h.state), writeState: async state => { h.state = copy(state); }, report: error => h.errors.push(error),
    timers: { setTimeout(fn, delay) { const id = Symbol(); h.scheduled.set(id, { fn, delay }); return id; }, clearTimeout(id) { h.scheduled.delete(id); } },
    request: async (identity, body) => {
      h.requests.push({ identity: copy(identity), body: copy(body) });
      if (h.intercept) return h.intercept(identity, body);
      if (body) {
        if (body.expectedRevision !== h.profile.revision) throw Object.assign(new Error("Conflict"), { status: 409 });
        h.profile = { ...h.profile, ...copy(body.data), revision: h.profile.revision + 1 };
      }
      return copy(h.profile);
    }
  });
  h.fire = async () => {
    const [id, timer] = h.scheduled.entries().next().value || [];
    assert.ok(timer, "a timer must be scheduled"); h.scheduled.delete(id); await timer.fn();
  };
  h.native = async (mode = 30, options = {}, userId = "gm", nested = false) => {
    h.actor.prototypeToken.displayName = mode;
    return h.sync.onActorUpdate(h.actor, nested ? { prototypeToken: { displayName: mode } } : { "prototypeToken.displayName": mode }, options, userId);
  };
  h.posts = () => h.requests.filter(request => request.body);
  h.key = "test-campaign:test-world:test-npc";
  return h;
}

test("prototype HOVER publishes only dossier visibility; internal changes cannot echo", async () => {
  const h = harness();
  await h.native(30, {}, "gm2", true); await h.fire();
  assert.equal(h.posts().length, 1);
  assert.deepEqual(h.posts()[0].body, { expectedRevision: 1, data: { visibility: { state: "public" } } });
  assert.equal(h.profile.blocks[0].visibility, "dm");
  assert.deepEqual(h.state.pending, {});
  assert.equal(h.scheduled.size, 0);
  assert.equal(h.errors.length, 0);
});

test("placed linked and unlinked tokens both resolve to the base NPC", async () => {
  for (const suffix of ["linked", "unlinked"]) {
    const h = harness(), token = h.game.scenes.get("one").tokens.get(`one-${suffix}`);
    token.displayName = 30;
    await h.sync.onTokenUpdate(token, { displayName: 30 }, {}, "gm"); await h.fire();
    assert.equal(h.posts()[0].identity.actorId, h.actor.id);
    assert.equal(h.actor.prototypeToken.displayName, 30);
    assert.equal(h.errors.length, 0);
  }
});

test("other modes, players, nonleader GMs, unmanaged NPCs, PCs and internal edits do not publish", async () => {
  for (const mode of [0, 10, 20, 40, 50]) { const h = harness(); await h.native(mode); assert.equal(h.scheduled.size, 0); }
  for (const setup of [h => { h.game.user.isGM = false; }, h => { h.game.users.activeGM = { id: "gm2" }; }, h => { h.managed = false; }, h => { h.actor.type = "character"; }, h => { h.actor.isToken = true; }, h => { h.actor.pack = "pack"; }, h => { h.push = false; }]) {
    const h = harness(); setup(h); await h.native(); assert.equal(h.scheduled.size, 0);
  }
  for (const options of [{ criptaWikiSyncCommand: true }, { khuzoeTokenizerSave: true }]) { const h = harness(); await h.native(30, options); assert.equal(h.scheduled.size, 0); }
  const h = harness(); await h.native(30, {}, "player"); await h.sync.onActorUpdate(h.actor, { name: "Test" }, {}, "gm"); assert.equal(h.scheduled.size, 0);
});

test("wiki public sets only displayName on prototype and all matching scene tokens", async () => {
  const h = harness(), before = [...h.game.scenes].flatMap(scene => [...scene.tokens].map(({ parent, ...token }) => copy(token)));
  await h.sync.pull(h.actor, { revision: 2, visibility: { state: "public" } });
  assert.equal(h.actor.prototypeToken.displayName, 30);
  assert.deepEqual(h.actor.system, { hp: 42 }); assert.deepEqual(h.actor.ownership, { default: 0 });
  const after = [...h.game.scenes].flatMap(scene => [...scene.tokens].map(({ parent, ...token }) => copy(token)));
  assert.deepEqual(after, before.map(token => token.actorId === h.actor.id ? { ...token, displayName: 30 } : token));
  assert.deepEqual(h.writes[0].changes, { "prototypeToken.displayName": 30 });
  assert.equal(h.requests.length, 0); assert.equal(h.scheduled.size, 0); assert.equal(h.errors.length, 0);
});

test("repeated pulls and newer content revisions do not repeat native writes; DM → public reactivates", async () => {
  const h = harness();
  await h.sync.pull(h.actor, { revision: 2, visibility: { state: "public" } });
  const count = h.writes.length;
  await h.sync.pull(h.actor, { revision: 2, visibility: { state: "public" } });
  await h.sync.pull(h.actor, { revision: 3, visibility: { state: "public" } });
  await h.sync.pull(h.actor, { revision: 1, visibility: { state: "dm" } });
  assert.equal(h.state.applied[h.key].visibility, "public");
  await h.sync.pull(h.actor, { revision: 4, visibility: { state: "dm" } });
  assert.equal(h.writes.length, count); assert.equal(h.actor.prototypeToken.displayName, 30, "DM visibility never hides native token names");
  await h.native(0); assert.equal(h.posts().length, 0, "turning HOVER off never hides the dossier");
  await h.sync.pull(h.actor, { revision: 5, visibility: { state: "public" } });
  assert.equal(h.actor.prototypeToken.displayName, 30);
});

test("duplicate hooks coalesce and existing public profiles need no POST", async () => {
  const h = harness(); h.profile.visibility.state = "public";
  await h.native(); await h.native(); assert.equal(h.scheduled.size, 1); await h.fire();
  assert.equal(h.requests.length, 1); assert.equal(h.posts().length, 0);
});

test("an edit undone before sending, while reading, or while offline is cancelled", async () => {
  for (const timing of ["before", "during", "offline"]) {
    const h = harness(); await h.native();
    if (timing === "before") { await h.native(0); assert.equal(h.scheduled.size, 0); }
    if (timing === "during") { h.intercept = async () => { h.actor.prototypeToken.displayName = 0; return copy(h.profile); }; await h.fire(); }
    if (timing === "offline") { h.actor.prototypeToken.displayName = 0; h.sync.resume(); await h.fire(); }
    assert.equal(h.posts().length, 0); assert.deepEqual(h.state.pending, {});
  }
});

test("lost POST response is recovered without a second write", async () => {
  const h = harness(); h.intercept = async (_identity, body) => {
    if (body) { h.profile = { ...h.profile, ...copy(body.data), revision: 2 }; throw new Error("Response lost"); }
    return copy(h.profile);
  };
  await h.native(); await h.fire(); assert.equal(h.scheduled.size, 1);
  h.intercept = null; await h.fire();
  assert.equal(h.posts().length, 1); assert.deepEqual(h.state.pending, {});
});

test("lost response followed by a wiki private edit cannot republish the dossier", async () => {
  const h = harness(); h.intercept = async (_identity, body) => {
    if (body) { h.profile.revision = 3; throw new Error("Response lost, wiki already private again"); }
    return copy(h.profile);
  };
  await h.native(); await h.fire(); h.intercept = null; await h.fire();
  assert.equal(h.posts().length, 1); assert.equal(h.profile.visibility.state, "dm");
  assert.deepEqual(h.state.pending, {}); assert.equal(h.errors.at(-1).status, 409);
});

test("an offline intent based on an older known profile cannot overwrite a newer private profile", async () => {
  const h = harness(); await h.sync.pull(h.actor, h.profile); await h.native();
  h.profile.revision = 3; await h.fire();
  assert.equal(h.posts().length, 0); assert.equal(h.errors.at(-1).status, 409); assert.deepEqual(h.state.pending, {});
});

test("a new HOVER edit on another token replaces a cancelled pending source", async () => {
  const h = harness(); await h.native(); h.actor.prototypeToken.displayName = 0;
  const token = h.game.scenes.get("one").tokens.get("one-unlinked"); token.displayName = 30;
  await h.sync.onTokenUpdate(token, { displayName: 30 }, {}, "gm"); await h.fire();
  assert.equal(h.posts().length, 1); assert.equal(h.errors.length, 0);
});

test("terminal API errors stop retries and transient errors retry with bounded backoff", async () => {
  for (const status of [400, 401, 403, 404, 409]) {
    const h = harness(); h.intercept = async () => { throw Object.assign(new Error("Rejected"), { status }); };
    await h.native(); await h.fire(); assert.equal(h.scheduled.size, 0); assert.deepEqual(h.state.pending, {});
  }
  const h = harness(); h.intercept = async () => { throw new Error("Offline"); };
  await h.native();
  for (const delay of [60000, 120000, 240000, 300000, 300000]) { await h.fire(); assert.equal([...h.scheduled.values()][0].delay, delay); }
  assert.equal(h.errors.length, 1);
});

test("world/campaign or leader changes during a read prevent publication", async () => {
  for (const change of [h => { h.campaign = "different"; }, h => { h.game.world.id = "different"; }, h => { h.game.users.activeGM = { id: "gm2" }; }]) {
    const h = harness(); h.intercept = async () => { change(h); return copy(h.profile); };
    await h.native(); await h.fire(); assert.equal(h.posts().length, 0); assert.equal(h.writes.length, 0);
  }
});

test("failed native writes are not acknowledged; next pull completes partial updates", async () => {
  const h = harness(), profile = { revision: 2, visibility: { state: "public" } };
  h.failScene = "two"; await h.sync.pull(h.actor, profile);
  assert.equal(h.state.applied[h.key], undefined); assert.equal(h.errors.length, 1);
  h.failScene = null; const count = h.writes.length; await h.sync.pull(h.actor, profile);
  assert.equal(h.writes.length, count + 1, "only remaining scene needs a second write");
  assert.equal(h.state.applied[h.key].applied, true);
  const ignored = harness(); ignored.ignoreActorUpdate = true; await ignored.sync.pull(ignored.actor, profile);
  assert.equal(ignored.state.applied[ignored.key], undefined); assert.equal(ignored.errors.length, 1);
});

test("a campaign switch before queued work starts discards the old intent", async () => {
  for (const direction of ["push", "pull"]) {
    const h = harness();
    const work = direction === "push" ? h.native() : h.sync.pull(h.actor, { revision: 1, visibility: { state: "public" } });
    h.campaign = "new-campaign"; await work;
    assert.equal(h.writes.length, 0); assert.equal(h.scheduled.size, 0); assert.equal(h.requests.length, 0);
  }
});

test("restart resumes durable pending jobs, without altering other jobs or campaigns", async () => {
  const h = harness(); await h.native();
  const next = harness(); next.state = copy(h.state); next.actor.prototypeToken.displayName = 30;
  next.state.pending.unrelated = { campaignId: "other-campaign", worldId: "test-world", actorId: "other", id: "kept" };
  next.sync.resume(); assert.equal(next.scheduled.size, 1); await next.fire();
  assert.equal(next.posts().length, 1); assert.equal(next.state.pending.unrelated.id, "kept");
});

test("pull policy is respected", async () => {
  const h = harness(); h.pull = false; await h.sync.pull(h.actor, { revision: 1, visibility: { state: "public" } });
  assert.equal(h.writes.length, 0); assert.deepEqual(h.state.applied, {});
});

for (const retroactive of [false, true]) test(`real Worker ${retroactive ? "retroactive" : "native edit"} round trip preserves private stats, chapters, images and index visibility`, async () => {
  const h = harness(), memory = new Map(), secret = "isolated-test-secret";
  const env = { INVENTORY_SYNC_SECRET: secret, SIGILLO_KV: { get: async key => memory.get(key) ?? null, put: async (key, value) => memory.set(key, String(value)), delete: async key => memory.delete(key) } };
  const headers = { "Content-Type": "application/json", "X-Cripta-Inventory-Secret": secret, "X-Khuzoe-Sync-Contract": "1", "X-Khuzoe-Foundry-Generation": "14" };
  const base = "api/managed-actors/test-world/test-npc";
  async function request(path, body, authenticated = true) {
    return worker.fetch(new Request(`https://worker.test/${path}?campaign=test-campaign`, { headers: authenticated ? headers : {}, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) }), env);
  }
  assert.equal((await request(base, { expectedRevision: 0, name: "NPC", actorType: "npc", visibility: { state: "dm" }, definition: { attributes: { hp: { max: 42 } } }, contract: { name: "khuzoe-wiki-sync", version: 1, module: { id: "cripta-wiki-sync", version: "0.11.1" }, foundry: { generation: 14 }, system: { id: "dnd5e", version: "5.3.3" } } })).status, 200);
  const profileResponse = await request(`${base}/profile`, { expectedRevision: 0, data: { visibility: { state: "dm" }, role: "Custode", blocks: [{ id: "public", type: "lore", title: "History", text: "Public", image: "portrait.webp", visibility: "public" }, { id: "secret", type: "secret_dossier", title: "Secret", text: "Private", visibility: "dm" }] } });
  const original = (await profileResponse.json()).data;
  const stats = (await (await request(base)).json()).data;
  h.intercept = async (_identity, body) => {
    const response = await request(`${base}/profile`, body), payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error), { status: response.status });
    return payload.data;
  };
  if (retroactive) {
    h.actor.prototypeToken.displayName = 30;
    await h.sync.pull(h.actor, original);
  } else await h.native();
  await h.fire();
  assert.equal(h.errors.length, 0);
  const saved = (await (await request(`${base}/profile`)).json()).data;
  assert.equal(saved.visibility.state, "public"); assert.deepEqual(saved.blocks, original.blocks); assert.equal(saved.role, original.role);
  assert.deepEqual((await (await request(base)).json()).data, stats);
  assert.deepEqual((await (await request(`${base}/profile`, null, false)).json()).data.blocks.map(block => block.id), ["public"]);
  const index = (await (await request("api/managed-actors")).json()).data;
  const summary = index.find(entry => entry.actorId === "test-npc");
  assert.equal(summary.profile.visibility.state, "public"); assert.equal(summary.profile.revision, saved.revision);
  const receiver = harness(); await receiver.sync.pull(receiver.actor, summary.profile);
  assert.equal(receiver.actor.prototypeToken.displayName, 30); assert.equal(receiver.requests.length, 0);
});

test("existing HOVER is discovered once on prototype or linked/unlinked scene tokens, including old local state", async () => {
  for (const source of ["prototype", "linked", "unlinked"]) {
    const h = harness(); h.state.applied[h.key] = { revision: 1, visibility: "dm", applied: false };
    if (source === "prototype") h.actor.prototypeToken.displayName = 30;
    else h.game.scenes.get("two").tokens.get(`two-${source}`).displayName = 30;
    await h.sync.pull(h.actor, h.profile); await h.sync.pull(h.actor, h.profile);
    assert.equal(h.requests.length, 0, "uses the existing index, without immediate extra reads");
    assert.equal(h.scheduled.size, 1); assert.equal(h.state.initialHoverChecked[h.key], true);
    await h.fire(); assert.equal(h.posts().length, 1); assert.equal(h.profile.visibility.state, "public");
    assert.equal(h.errors.length, 0);
  }
});

test("retroactive check skips other display modes, characters, unmanaged NPCs, players and nonleader GMs", async () => {
  for (const mode of [0, 10, 20, 40, 50]) {
    const h = harness(); h.actor.prototypeToken.displayName = mode; await h.sync.pull(h.actor, h.profile);
    assert.equal(h.scheduled.size, 0); assert.equal(h.requests.length, 0);
  }
  for (const setup of [h => { h.managed = false; }, h => { h.actor.type = "character"; }, h => { h.game.user.isGM = false; }, h => { h.game.users.activeGM = { id: "gm2" }; }]) {
    const h = harness(); h.actor.prototypeToken.displayName = 30; setup(h); await h.sync.pull(h.actor, h.profile);
    assert.equal(h.scheduled.size, 0); assert.equal(h.requests.length, 0); assert.equal(h.state.initialHoverChecked?.[h.key], undefined);
  }
});

test("a later DM-only choice stays private after repeated pulls and restart", async () => {
  const h = harness(); h.actor.prototypeToken.displayName = 30;
  await h.sync.pull(h.actor, h.profile); await h.fire();
  h.profile = { ...h.profile, revision: 3, visibility: { state: "dm" } };
  await h.sync.pull(h.actor, h.profile); await h.sync.pull(h.actor, h.profile);
  assert.equal(h.scheduled.size, 0); assert.equal(h.posts().length, 1);
  const next = harness(); next.state = copy(h.state); next.profile = copy(h.profile); next.actor.prototypeToken.displayName = 30;
  next.sync.resume(); await next.sync.pull(next.actor, next.profile);
  assert.equal(next.scheduled.size, 0); assert.equal(next.requests.length, 0);
  assert.equal(next.actor.prototypeToken.displayName, 30); assert.equal(next.profile.visibility.state, "dm");
});

test("retroactive offline work survives restart; a newer private revision cancels it permanently", async () => {
  const h = harness(); h.actor.prototypeToken.displayName = 30; await h.sync.pull(h.actor, h.profile);
  h.intercept = async () => { throw new Error("Offline"); }; await h.fire();
  const next = harness(); next.state = copy(h.state); next.actor.prototypeToken.displayName = 30; next.profile.revision = 3;
  next.sync.resume(); await next.fire();
  assert.equal(next.posts().length, 0); assert.equal(next.errors.at(-1).status, 409);
  await next.sync.pull(next.actor, next.profile); assert.equal(next.scheduled.size, 0);
});

test("initial public dossiers do not trigger outgoing writes or a later privacy reset", async () => {
  const h = harness(); h.profile.visibility.state = "public";
  await h.sync.pull(h.actor, h.profile);
  assert.equal(h.actor.prototypeToken.displayName, 30); assert.equal(h.scheduled.size, 0); assert.equal(h.requests.length, 0);
  await h.sync.pull(h.actor, { revision: 2, visibility: { state: "dm" } });
  assert.equal(h.scheduled.size, 0);
});

test("disabled push defers private backfill, while public pull records that alignment already happened", async () => {
  const h = harness(); h.actor.prototypeToken.displayName = 30; h.push = false;
  await h.sync.pull(h.actor, h.profile); assert.equal(h.state.initialHoverChecked?.[h.key], undefined);
  h.push = true; await h.sync.pull(h.actor, h.profile); assert.equal(h.scheduled.size, 1);
  const publicOnly = harness(); publicOnly.push = false;
  await publicOnly.sync.pull(publicOnly.actor, { revision: 1, visibility: { state: "public" } });
  publicOnly.push = true; await publicOnly.sync.pull(publicOnly.actor, { revision: 2, visibility: { state: "dm" } });
  assert.equal(publicOnly.scheduled.size, 0);
});

test("a shared actor without profile metadata is checked through the existing profile API", async () => {
  const h = harness(); h.actor.prototypeToken.displayName = 30;
  await h.sync.pull(h.actor, null); await h.fire();
  assert.equal(h.posts().length, 1); assert.equal(h.profile.visibility.state, "public"); assert.equal(h.errors.length, 0);
});

test("undoing HOVER cancels retroactive work; stale index revisions cannot initialize it", async () => {
  const h = harness(); h.actor.prototypeToken.displayName = 30; await h.sync.pull(h.actor, h.profile);
  await h.native(0); await h.sync.pull(h.actor, h.profile);
  assert.equal(h.scheduled.size, 0); assert.equal(h.requests.length, 0);
  const stale = harness(); stale.actor.prototypeToken.displayName = 30; stale.state.applied[stale.key] = { revision: 4, visibility: "dm", applied: false };
  await stale.sync.pull(stale.actor, stale.profile);
  assert.equal(stale.scheduled.size, 0); assert.equal(stale.state.initialHoverChecked?.[stale.key], undefined);
});

test("installed media synchronization preserves the placed HOVER while retroactive publication is pending", async () => {
  const source = await readFile(`${root}/scripts/services/managed-actor-sync.js`, "utf8");
  const h = harness(), token = h.game.scenes.get("one").tokens.get("one-linked");
  token.displayName = 30;
  await h.sync.pull(h.actor, h.profile);
  const sandbox = { game: h.game, sync: h.sync, foundry: { utils: { deepClone: copy } } };
  vm.runInNewContext(source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "") + `
    npcDossierVisibilitySync = sync;
    globalThis.updateMedia = updateLinkedPlacedTokens;
  `, sandbox);
  await sandbox.updateMedia(h.actor, "new-image.webp");
  assert.equal(token.displayName, 30); assert.equal(token.texture.src, "new-image.webp");
  await h.fire();
  assert.equal(h.posts().length, 1); assert.equal(h.profile.visibility.state, "public");
  assert.equal(h.actor.prototypeToken.displayName, 30); assert.equal(h.errors.length, 0);
  h.actor.prototypeToken.displayName = 0;
  await sandbox.updateMedia(h.actor, "new-image.webp");
  assert.equal(token.displayName, 0, "ordinary prototype propagation resumes once the pending job is finished");
});

test("installed integration registers hooks and recognizes shared NPCs on the first cached-index pull", async () => {
  const source = await readFile(`${root}/scripts/services/managed-actor-sync.js`, "utf8");
  const h = harness(), settings = new Map(), hooks = new Map();
  h.game.settings = { register: (_module, key, spec) => { if (!settings.has(key)) settings.set(key, copy(spec.default)); }, get: (_module, key) => settings.get(key), set: async (_module, key, value) => settings.set(key, copy(value)) };
  const sandbox = { console, URL, AbortSignal, crypto, structuredClone, game: h.game, NpcDossierVisibilitySync, NPC_VISIBILITY_SETTING, isTemporaryWikiActor,
    MODULE_ID: "cripta-wiki-sync", SETTINGS: { CAMPAIGN_ID: "campaignId" }, DISCORD_WORKER_URL: "https://worker.test", canPullFromWorker: () => true, canPushToWorker: () => true,
    Hooks: { on: (name, handler) => hooks.set(name, [...(hooks.get(name) || []), handler]) }, ui: { notifications: { warn: error => h.errors.push(error) } }
  };
  vm.runInNewContext(source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "") + `
    registerManagedActorSync();
    game.settings.set(MODULE_ID, SETTINGS.CAMPAIGN_ID, "test-campaign");
    managedActorRelationshipCache.campaignId = "test-campaign";
    managedActorRelationshipCache.payload = {data:[{worldId:"test-world",actorId:"test-npc",foundryActorId:"test-npc"}]};
    globalThis.integrationSync = npcDossierVisibilitySync;
  `, sandbox);
  assert.ok(hooks.has("updateActor")); assert.ok(hooks.has("updateToken")); assert.ok(hooks.has("userConnected"));
  assert.equal(sandbox.integrationSync.eligible(h.actor), true);
  assert.equal(sandbox.integrationSync.eligible(h.other), false);
  await sandbox.integrationSync.pull(h.actor, { revision: 1, visibility: { state: "public" } });
  assert.equal(h.actor.prototypeToken.displayName, 30);
  assert.equal(h.errors.length, 0);
});
