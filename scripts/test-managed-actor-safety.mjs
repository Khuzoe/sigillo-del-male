import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../workers/main-worker/src/index.js";

class MemoryKv {
  constructor() {
    this.store = new Map();
  }
  async get(key) {
    return this.store.get(key) ?? null;
  }
  async put(key, value) {
    this.store.set(key, String(value));
  }
  async delete(key) {
    this.store.delete(key);
  }
}

const campaignId = "test-campaign";
const worldId = "test-world";
const actorId = "test-actor";
const secret = "managed-actor-test-secret";
const baseUrl = `https://worker.test/api/managed-actors/${worldId}/${actorId}?campaign=${campaignId}`;
const mediaPrefix = `campaigns/${campaignId}/managed-actors/${worldId}/${actorId}/base/`;
const r2Objects = new Set([
  `${mediaPrefix}avatar-r1.webp`,
  `${mediaPrefix}token-r1.webp`,
  `${mediaPrefix}token-r2.webp`,
  `${mediaPrefix}token-r3.webp`,
]);
const deletedR2 = [];
const kv = new MemoryKv();
const env = {
  INVENTORY_SYNC_SECRET: secret,
  SIGILLO_KV: kv,
  MEDIA_BUCKET: {
    async head(key) {
      return r2Objects.has(key) ? { key } : null;
    },
    async delete(key) {
      deletedR2.push(key);
      r2Objects.delete(key);
    },
  },
};
const waits = [];
const ctx = { waitUntil(promise) { waits.push(Promise.resolve(promise)); } };
const headers = {
  "Content-Type": "application/json",
  "X-Cripta-Inventory-Secret": secret,
};

function media(path, revision = 1) {
  return { path: `media/${path}`, revision, source: "foundry" };
}

async function post(body) {
  const response = await worker.fetch(new Request(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ campaignId, ...body }),
  }), env, ctx);
  const payload = await response.json();
  return { response, payload };
}

async function getDocument() {
  const response = await worker.fetch(new Request(baseUrl, { headers }), env, ctx);
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

const initial = await post({
  expectedRevision: 0,
  writeScopes: ["content", "media"],
  mediaWriteTargets: ["avatar", "token"],
  name: "Actor integro",
  actorType: "npc",
  definition: { marker: "original", attributes: { hp: { max: 203 } } },
  runtime: { hp: { value: 203 } },
  system: { id: "dnd5e" },
  contentHash: "content-r1",
  mediaHash: "media-r1",
  media: {
    avatar: media(`${mediaPrefix}avatar-r1.webp`),
    token: media(`${mediaPrefix}token-r1.webp`),
    variants: [],
  },
});
assert.equal(initial.response.status, 200);
assert.equal(initial.payload.revision, 1);

const mediaOnly = await post({
  expectedRevision: 1,
  writeScopes: ["media"],
  mediaWriteTargets: ["token"],
  name: "NON DEVE VINCERE",
  actorType: "character",
  definition: { marker: "NON DEVE VINCERE" },
  runtime: { hp: { value: 1 } },
  system: { id: "wrong" },
  contentHash: "wrong-content",
  mediaHash: "media-r2",
  media: {
    avatar: media(`${mediaPrefix}avatar-r1.webp`),
    token: media(`${mediaPrefix}token-r2.webp`, 2),
    variants: [],
  },
});
assert.equal(mediaOnly.response.status, 200);
assert.equal(mediaOnly.payload.revision, 2);
let stored = await getDocument();
assert.equal(stored.name, "Actor integro");
assert.equal(stored.actorType, "npc");
assert.equal(stored.definition.marker, "original");
assert.equal(stored.runtime.hp.value, 203);
assert.equal(stored.system.id, "dnd5e");
assert.equal(stored.contentHash, "content-r1");
assert.equal(stored.media.token.path, `media/${mediaPrefix}token-r2.webp`);
assert.deepEqual(deletedR2, [], "il media sostituito non deve essere eliminato subito");

const stale = await post({
  expectedRevision: 1,
  writeScopes: ["content", "media"],
  definition: { marker: "stale" },
  contentHash: "stale",
  mediaHash: "stale",
  media: stored.media,
});
assert.equal(stale.response.status, 409);
assert.equal(stale.payload.code, "VERSION_CONFLICT");
stored = await getDocument();
assert.equal(stored.revision, 2);
assert.equal(stored.definition.marker, "original");

const missing = await post({
  expectedRevision: 2,
  writeScopes: ["media"],
  mediaWriteTargets: ["token"],
  contentHash: "wrong-again",
  mediaHash: "missing-media",
  media: {
    ...stored.media,
    token: media(`${mediaPrefix}missing.webp`, 3),
  },
});
assert.equal(missing.response.status, 409);
assert.equal(missing.payload.code, "MEDIA_OBJECT_MISSING");
stored = await getDocument();
assert.equal(stored.revision, 2);
assert.equal(stored.media.token.path, `media/${mediaPrefix}token-r2.webp`);

const cleanupEntry = Array.from(kv.store.entries()).find(([key]) => key.includes("managed-actor-media-cleanup:"));
assert.ok(cleanupEntry, "la sostituzione deve creare una coda di pulizia differita");
const cleanupDocument = JSON.parse(cleanupEntry[1]);
assert.equal(cleanupDocument.entries.some((entry) => entry.key === `${mediaPrefix}token-r1.webp`), true);
cleanupDocument.entries.forEach((entry) => { entry.deleteAfter = 0; });
await kv.put(cleanupEntry[0], JSON.stringify(cleanupDocument));

const nextMedia = await post({
  expectedRevision: 2,
  writeScopes: ["media"],
  mediaWriteTargets: ["token"],
  contentHash: "still-must-not-win",
  mediaHash: "media-r3",
  media: {
    ...stored.media,
    token: media(`${mediaPrefix}token-r3.webp`, 3),
  },
});
assert.equal(nextMedia.response.status, 200);
assert.equal(nextMedia.payload.revision, 3);
assert.equal(deletedR2.includes(`${mediaPrefix}token-r1.webp`), true, "il media scaduto deve essere eliminato solo dopo il grace period");
stored = await getDocument();
assert.equal(stored.definition.marker, "original");
assert.equal(stored.media.token.path, `media/${mediaPrefix}token-r3.webp`);

const perInstance = await post({
  expectedRevision: 3,
  writeScopes: ["content", "media"],
  name: stored.name,
  actorType: "npc",
  definition: {
    ...stored.definition,
    prototypeToken: { actorLink: false },
  },
  system: stored.system,
  contentHash: "content-per-instance",
  mediaHash: "media-r3",
  media: stored.media,
});
assert.equal(perInstance.response.status, 200);
stored = await getDocument();
assert.equal(stored.entityKind, "creature");
assert.equal(stored.runtimePolicy, "per-instance");
assert.deepEqual(stored.runtime, {}, "il runtime precedente resta conservato ma non deve essere esposto per una creatura unlinked");

const runtimeResponse = await worker.fetch(new Request(`${baseUrl.split("?")[0]}/runtime?campaign=${campaignId}`, {
  method: "POST",
  headers,
  body: JSON.stringify({ campaignId, runtime: { hp: { value: 1, temp: 5 } } }),
}), env, ctx);
const runtimePayload = await runtimeResponse.json();
assert.equal(runtimeResponse.status, 200);
assert.equal(runtimePayload.saved, false);
assert.equal(runtimePayload.ignored, "per-instance-runtime");

const separatedPolicy = await post({
  expectedRevision: stored.revision,
  writeScopes: ["content"],
  name: stored.name,
  actorType: "npc",
  runtimePolicy: "shared",
  definition: {
    ...stored.definition,
    prototypeToken: { actorLink: false },
  },
  runtime: { hp: { value: 150 } },
  system: stored.system,
  contentHash: "content-shared-with-unlinked-prototype",
});
assert.equal(separatedPolicy.response.status, 200);
stored = await getDocument();
assert.equal(stored.definition.prototypeToken.actorLink, false, "actorLink deve restare una proprietà Foundry indipendente");
assert.equal(stored.runtimePolicy, "shared", "la politica runtime esplicita deve prevalere senza alterare actorLink");
assert.equal(stored.runtime.hp.value, 150);

const sharedRuntimeResponse = await worker.fetch(new Request(`${baseUrl.split("?")[0]}/runtime?campaign=${campaignId}`, {
  method: "POST",
  headers,
  body: JSON.stringify({ campaignId, runtime: { hp: { value: 149, temp: 2 } } }),
}), env, ctx);
const sharedRuntimePayload = await sharedRuntimeResponse.json();
assert.equal(sharedRuntimeResponse.status, 200);
assert.equal(sharedRuntimePayload.saved, true);
stored = await getDocument();
assert.equal(stored.runtime.hp.value, 149);

const moduleSyncSource = await readFile(new URL("../module/scripts/services/managed-actor-sync.js", import.meta.url), "utf8");
assert.doesNotMatch(
  moduleSyncSource,
  /actor\.update\(\{\s*["']prototypeToken\.actorLink["']:/,
  "la sincronizzazione non deve mai cambiare automaticamente actorLink sugli Actor esistenti",
);
assert.match(moduleSyncSource, /runtimePolicyOverride/, "il modulo deve conservare la politica runtime separata");
assert.match(moduleSyncSource, /patch\?\.path !== ["']prototypeToken\.actorLink["']/, "il modulo deve scartare anche i vecchi comandi actorLink gia accodati");
assert.match(moduleSyncSource, /const SYNC_BATCH_WINDOW_MS = 60_000;/, "le modifiche Foundry devono essere raccolte per un minuto");
assert.match(moduleSyncSource, /if \(!pendingTimers\.has\(actorId\)\) scheduleManagedActorFlush\(actorId, SYNC_BATCH_WINDOW_MS\);/, "nuove modifiche devono confluire nella finestra gia aperta");
assert.match(moduleSyncSource, /pendingJobs\.get\(actorId\) !== event/, "una modifica arrivata durante l'invio non deve essere cancellata dall'ack precedente");

const managedActorFeSource = await readFile(new URL("../assets/js/pages/managed-actor.js", import.meta.url), "utf8");
assert.match(
  managedActorFeSource,
  /explicitPolicy === ["']shared["']/,
  "il frontend deve rispettare la politica condivisa esplicita senza ricadere su actorLink",
);

await Promise.allSettled(waits);
console.log("Managed Actor safety tests passed.");
