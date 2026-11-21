import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { LocalD1 } from "./fixtures/local-d1.mjs";
import worker from "../workers/main-worker/src/index.js";
import { NpcGenerationStore } from "../workers/main-worker/src/npc-generation.js";

class Storage {
  values = new Map();
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { if (typeof key === "object") { for (const [k, v] of Object.entries(key)) await this.put(k, v); } else this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
  async transaction(fn) { return fn(this); }
  async setAlarm(value) { this.alarm = value; }
  async deleteAlarm() { this.alarm = null; }
}
const secret = "local-npc-d1-test", campaign = "npc-pilot", world = "world";
const db = new LocalD1(), stored = new Map(), objects = new Map(), storage = new Storage();
const kv = { async get(key) { return stored.get(key) ?? null; }, async put(key, value) { stored.set(key, value); }, async delete(key) { stored.delete(key); } };
const bucket = {
  async get(key) { const bytes = objects.get(key); return bytes ? { size: bytes.length, body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.slice().buffer } : null; },
  async put(key, bytes) { objects.set(key, new Uint8Array(await new Response(bytes).arrayBuffer())); },
};
const env = { SIGILLO_KV: kv, POLL_DB: db, MEDIA_BUCKET: bucket, JWT_SECRET: secret, INVENTORY_SYNC_SECRET: secret, GLOBAL_ADMIN_ACCOUNT_IDS: "admin", MANAGED_ACTOR_D1_CAMPAIGNS: campaign, MANAGED_ACTOR_WRITES_PAUSED_CAMPAIGNS: "paused" };
const coordinator = new NpcGenerationStore({ storage }, env);
env.NPC_GENERATOR = { idFromName: value => value, get: () => ({ fetch: request => coordinator.fetch(request) }) };
const signed = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ accountId: "admin", username: "admin", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")].join(".");
const token = `${signed}.${createHmac("sha256", secret).update(signed).digest("base64url")}`;
const syncHeaders = { "X-Cripta-Inventory-Secret": secret, "X-Khuzoe-Sync-Contract": "1", "X-Khuzoe-Foundry-Generation": "14" };
async function call(path, body, target = campaign, headers = {}) {
  const url = new URL(`https://local.test/api/${path}`);
  url.searchParams.set("campaign", target);
  const response = await worker.fetch(new Request(url, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  }), env, { waitUntil(promise) { promise.catch(() => {}); } });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
try {
  const schema = await readFile(new URL("../workers/main-worker/migrations/0004_managed_actors.sql", import.meta.url), "utf8");
  await db.batch(schema.replace(/^\s*--.*$/gm, "").split(";").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  await db.prepare("INSERT INTO managed_actor_imports(campaign_id,migration_id,state,imported_at,document_count,manifest_sha256) VALUES(?,?,'ready','now',0,'local-test')").bind(campaign, "npc-generation").run();
  const originalKey = `campaign:${campaign}:managed-actors:index`, original = JSON.stringify({ version: 99, data: [{ name: "Do not change this original" }] });
  await kv.put(originalKey, original);
  const jobState = id => storage.get(`job:${id}`);
  async function seed(name) {
    const id = randomUUID(), avatarKey = `_private/ai-npcs/${id}/avatar.webp`, tokenKey = `_private/ai-npcs/${id}/token.webp`;
    await bucket.put(avatarKey, new Uint8Array([1, 2, 3])); await bucket.put(tokenKey, new Uint8Array([4, 5, 6]));
    const job = { id, draftId: id, context: { campaignId: campaign, accountId: "admin" }, form: { name, description: "Descrizione conservata su D1.", targetWorldId: world, categoryId: "", category: "", kind: "person", visibility: "dm" }, references: [], options: { quality: "medium", resolution: "medium" }, phase: "token", status: "ready", avatarReady: true, tokenReady: true, avatarKey, tokenKey, tokenAvatarKey: avatarKey, createdAt: new Date().toISOString() };
    await storage.put({ [`job:${id}`]: job, [`latest:${campaign}:admin`]: id });
    return job;
  }
  const first = await seed("Primo NPC D1");
  const confirmed = await call(`npc-generation/${first.id}/confirm`, {});
  assert.equal(confirmed.status, 202, JSON.stringify(confirmed.body)); assert.equal(confirmed.headers.get("X-Managed-Actor-Storage"), "d1");
  assert.equal((await jobState(first.id)).status, "accepted");
  const list = await call(`managed-actor-commands/${world}`, undefined, campaign, syncHeaders);
  assert.equal(list.body.createRequests.length, 1); assert.equal(list.body.createRequests[0].id, first.id);
  assert.equal(list.body.createRequests[0].profile.blocks[0].text, first.form.description);
  assert.equal(await kv.get(originalKey), original); assert.equal(await kv.get(`campaign:${campaign}:managed-actor-create-requests`), null);

  const failed = await seed("Conferma da riprendere");
  await db.prepare("CREATE TRIGGER reject_npc_queue BEFORE UPDATE ON managed_actor_documents WHEN NEW.kind = 'create-requests' BEGIN SELECT RAISE(ABORT, 'test queue failure'); END").run();
  const rejected = await call(`npc-generation/${failed.id}/confirm`, {});
  assert.equal(rejected.status, 503, JSON.stringify(rejected.body));
  assert.equal((await jobState(failed.id)).status, "confirming", "a proposal is never accepted before the D1 commit succeeds");
  assert.equal((await call(`managed-actor-commands/${world}`, undefined, campaign, syncHeaders)).body.createRequests.length, 1, "failed batch leaves the existing queue intact");
  await db.prepare("DROP TRIGGER reject_npc_queue").run();
  const resumed = await call(`npc-generation/${failed.id}/confirm`, { form: { ...failed.form, name: "Ignored after confirmation starts" } });
  assert.equal(resumed.status, 202, JSON.stringify(resumed.body)); assert.equal(resumed.body.request.document.name, failed.form.name);
  assert.equal((await jobState(failed.id)).status, "accepted");
  assert.equal((await call(`managed-actor-commands/${world}`, undefined, campaign, syncHeaders)).body.createRequests.length, 2);
  assert.deepEqual((await call(`npc-generation/${failed.id}/confirm`, {})).body, resumed.body, "repeated confirmation returns the committed receipt");

  const ack = await call(`managed-actor-commands/${world}/ack`, { createResults: [{ id: failed.id, status: "applied" }] }, campaign, syncHeaders);
  assert.equal(ack.status, 200, JSON.stringify(ack.body));
  const afterAck = await call(`managed-actor-commands/${world}`, undefined, campaign, syncHeaders);
  assert.equal(afterAck.body.createRequests.length, 1);
  assert.deepEqual((await call(`npc-generation/${failed.id}/confirm`, {})).body, resumed.body);
  assert.equal((await call(`managed-actor-commands/${world}`, undefined, campaign, syncHeaders)).body.createRequests.length, 1, "confirming after Foundry ACK does not enqueue a second Actor");
  assert.equal((await call("npc-generation", { campaignId: campaign }, "paused")).status, 503, "body campaign cannot bypass the URL campaign's write pause");
  assert.notEqual((await call(`npc-generation/${first.id}/stop`, {}, "paused")).status, 503, "the stop route remains available while writes are paused");
  assert.equal(await kv.get(originalKey), original, "D1 workflow never changes the original KV copy");
  const route = "managed-actor-create-requests";
  const checkName = (name, targetWorld = world) => call(route + "/check-name?" + new URLSearchParams({ world: targetWorld, name }));
  const existingName = "Leonora Invess", altName = "Leonora Invess - Forma Vendetta";
  await db.prepare("INSERT INTO managed_actor_documents(campaign_id,document_key,kind,revision,payload,updated_at) VALUES(?,?,'index',1,?,'now')")
    .bind(campaign, originalKey, JSON.stringify({ data: [{ worldId: world, actorId: "leonora", name: existingName }] })).run();
  const manual = { clientId: "site-leonora", targetWorldId: world, document: { name: "  ＬEONORA Invess  ", media: { avatar: "media/npcs/leonora.webp" } } };
  assert.match((await checkName(manual.document.name)).body.conflict, /scheda/);
  assert.equal((await checkName(existingName, "another-world")).body.conflict, "");
  assert.equal((await call(route, manual)).body.code, "NPC_NAME_TAKEN");
  const generated = await seed(existingName);
  assert.equal((await call(`npc-generation/${generated.id}/confirm`, {})).status, 400);
  assert.equal((await jobState(generated.id)).status, "ready", "a taken name leaves the previews editable");
  const renamedDraft = await call(`npc-generation/${generated.id}/confirm`, { form: { ...generated.form, name: altName } });
  assert.equal(renamedDraft.status, 202);
  assert.equal(renamedDraft.body.request.profile.name, altName);
  assert.match((await checkName(altName)).body.conflict, /richiesta/);
  const concurrent = ["site-a","site-b"].map(clientId => ({ ...manual, clientId, document: { ...manual.document, name: "Nome conteso" } }));
  const attempts = await Promise.all(concurrent.map(body => call(route, body)));
  assert.deepEqual(attempts.map(item => item.status).sort(), [202,409]);
  const winner = attempts.findIndex(item => item.status === 202);
  const queued = attempts[winner].body.request;
  assert.equal((await call(route, concurrent[winner])).body.request.id, queued.id);
  // Only Foundry knows about this Actor. Its later conflict can be repaired in place.
  await call(`managed-actor-commands/${world}/ack`, { createResults: [{ id: queued.id, status: "conflict", current: { actorIds: ["unpublished"] } }] }, campaign, syncHeaders);
  const rename = (name, previousName = queued.document.name) => call(`${route}/${queued.id}/rename`, { name, previousName });
  assert.equal((await rename(existingName)).body.code, "NPC_NAME_TAKEN");
  assert.equal((await rename("Nuovo nome", "Nome superato")).status, 409);
  const retried = await rename("Nuovo nome");
  assert.equal(retried.status, 202);
  assert.equal(retried.body.request.id, queued.id);
  assert.equal(retried.body.request.status, "pending");
  assert.deepEqual(retried.body.request.document.media, queued.document.media);
  assert.equal(retried.body.request.profile.name, "Nuovo nome");
  assert.equal((await rename("Nome tardivo")).status, 409);
  const interrupted = await seed(existingName);
  await storage.put(`job:${interrupted.id}`, { ...interrupted, status: "confirming", confirmation: interrupted.form });
  const lateCollision = await call(`npc-generation/${interrupted.id}/confirm`, {});
  assert.equal(lateCollision.body.code, "NPC_NAME_TAKEN");
  const editable = await jobState(interrupted.id);
  assert.equal(editable.status, "ready");
  assert.equal(editable.avatarKey, interrupted.avatarKey);
  assert.equal(editable.tokenKey, interrupted.tokenKey);
  assert.equal((await call(`npc-generation/${interrupted.id}/confirm`, { form: { ...editable.form, name: "Forma del gelo" } })).status, 202);
  console.log("NPC generation D1: production Worker/coordinator and transactional SQLite, commit failure, durable receipts, repeated confirmation, Foundry ACK and preserved KV originals passed.");
} finally { db.database.close(); }
