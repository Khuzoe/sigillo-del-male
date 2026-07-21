import assert from "node:assert/strict";
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

await Promise.allSettled(waits);
console.log("Managed Actor safety tests passed.");