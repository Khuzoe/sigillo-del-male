import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import worker from "../workers/main-worker/src/index.js";
import { NpcGenerationStore, NPC_TOKEN_SIZES, npcImagePrompt } from "../workers/main-worker/src/npc-generation.js";
import { AVATAR_MODEL, webpHasAlpha } from "../workers/main-worker/src/avatar-generation.js";

class Storage {
  values = new Map();
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) {
    if (typeof key === "object") { for (const [k, v] of Object.entries(key)) await this.put(k, v); }
    else this.values.set(key, structuredClone(value));
  }
  async delete(key) { this.values.delete(key); }
  async getAlarm() { return this.alarm || null; }
  async setAlarm(value) { this.alarm = value; }
  async deleteAlarm() { this.alarm = null; }
  async transaction(fn) { return fn(this); }
}
function image(width, height = width, alpha = false) {
  const bytes = new Uint8Array(alpha ? 40 : 30);
  bytes.set(Buffer.from("RIFF")); new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(Buffer.from("WEBPVP8X"), 8); new DataView(bytes.buffer).setUint32(16, 10, true);
  for (let index = 0; index < 3; index++) { bytes[24 + index] = ((width - 1) >>> (index * 8)) & 255; bytes[27 + index] = ((height - 1) >>> (index * 8)) & 255; }
  if (alpha) { bytes[20] = 0x10; bytes.set(Buffer.from("ALPH"), 30); new DataView(bytes.buffer).setUint32(34, 1, true); }
  return bytes;
}
const objects = new Map(), kv = new Map(), storage = new Storage();
const bucket = {
  async head(key) { return objects.has(key) ? { size: objects.get(key).length, etag: createHash("sha256").update(objects.get(key)).digest("hex") } : null; },
  async get(key) {
    if (!objects.has(key)) return null;
    const bytes = objects.get(key).slice();
    return { ...await this.head(key), body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.buffer, writeHttpMetadata: headers => headers.set("Content-Type", "image/webp") };
  },
  async put(key, body) { objects.set(key, new Uint8Array(await new Response(body).arrayBuffer())); },
  async delete() { assert.fail("Generation never deletes existing images"); },
};
const env = {
  JWT_SECRET: "npc-generation-local-secret", GLOBAL_ADMIN_ACCOUNT_IDS: "admin",
  GLOBAL_ADMIN_DEVICE_CODE: "NPC-GENERATION-ADMIN-LOCAL-STRONG-CODE",
  DEVICE_LOGIN_CODES_SECRET: "NPC-GENERATION-PLAYER||player|Player;NPC-GENERATION-DM||dungeon-master|DM",
  CAMPAIGN_EDITOR_ACCOUNT_IDS: "cripta-di-sangue:dungeon-master",
  INVENTORY_SYNC_SECRET: "local-foundry-only", OPENAI_API_KEY: "fake-no-paid-api",
  SIGILLO_KV: { async get(key) { return kv.get(key) ?? null; }, async put(key, value) { kv.set(key, value); }, async delete(key) { kv.delete(key); } },
  MEDIA_BUCKET: bucket,
};
let coordinator = new NpcGenerationStore({ storage }, env);
env.NPC_GENERATOR = { idFromName: name => name, get: () => ({ fetch: request => coordinator.fetch(request) }) };
const campaign = "cripta-di-sangue", world = "test-world", base = "api/npc-generation";
const syncHeaders = { "X-Cripta-Inventory-Secret": env.INVENTORY_SYNC_SECRET, "X-Khuzoe-Sync-Contract": "1", "X-Khuzoe-Foundry-Generation": "14" };
const contract = { name: "khuzoe-wiki-sync", version: 1, module: { id: "cripta-wiki-sync", version: "0.11.20" }, foundry: { generation: 14 }, system: { id: "dnd5e", version: "5.3.3" } };
async function req(path = base, body, token, targetCampaign = campaign, extraHeaders = {}) {
  return worker.fetch(new Request(`https://worker.test/${path}?campaign=${targetCampaign}`, {
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  }), env, { waitUntil(promise) { promise.catch(() => {}); } });
}
async function login(code) { const response = await req("auth/device/login", { code, campaignId: campaign }); assert.equal(response.status, 200); return (await response.json()).token; }
const admin = await login(env.GLOBAL_ADMIN_DEVICE_CODE), dm = await login("NPC-GENERATION-DM"), player = await login("NPC-GENERATION-PLAYER");
const form = (name = "Custode delle ceneri") => ({ name, description: "Un anziano custode con un mantello rosso e una cicatrice sul sopracciglio.", categoryId: "alleati", targetWorldId: world, kind: "person", visibility: "dm" });
const submit = (name, extra = {}) => ({ requestId: randomUUID(), form: form(name), references: [], quality: "high", resolution: "high", ...extra });
const status = async (token = dm, target = campaign) => (await (await req(base, undefined, token, target)).json());
const readJob = id => storage.get(`job:${id}`);
async function start(body, token = dm, target = campaign) {
  const response = await req(base, body, token, target);
  assert.equal(response.status, 202, await response.clone().text());
  return (await response.json()).job;
}
const sourceKey = id => `campaigns/${campaign}/managed-actors/${world}/${id}/base/avatar.webp`;
for (const [id, name] of [["example", "Una guardia"], ["frame", "Cornice dorata"]]) {
  objects.set(sourceKey(id), image(1296, 2304)); objects.set(sourceKey(id).replace("avatar", "token"), image(1024));
  const response = await req(`api/managed-actors/${world}/${id}`, { name, actorType: "npc", schemaVersion: 3, contract, media: { avatar: { path: `media/${sourceKey(id)}` }, token: { path: `media/${sourceKey(id).replace("avatar", "token")}` } }, definition: { attributes: { hp: { max: 40 } } } }, undefined, campaign, syncHeaders);
  assert.equal(response.status, 200, await response.clone().text());
}
const categoryResponse = await req("api/npc-categories", { expectedRevision: 0, categories: [{ id: "alleati", name: "Alleati", order: 10 }] }, dm);
assert.equal(categoryResponse.status, 200, await categoryResponse.clone().text());

assert.equal((await req()).status, 401);
assert.equal((await req(base, undefined, player)).status, 403);
assert.equal((await req(base, undefined, dm, "mago-folle")).status, 403);
assert.equal((await req(base, undefined, undefined, campaign, syncHeaders)).status, 401);
const initial = await status();
assert.equal(initial.version, 1); assert.equal(initial.canStop, true); assert.equal(initial.enabled, true); assert.equal(initial.job, null);
assert.equal(initial.tokenTransparencyVersion, 1);
assert.equal(initial.landscapeAvatar, true);
assert.deepEqual(initial.tokenSizes, NPC_TOKEN_SIZES);
assert.deepEqual(initial.supportedQualities, ["medium", "high", "xhigh"]);
assert.deepEqual(initial.supportedResolutions, ["medium", "high", "2k"]);
for (const patch of [{ requestId: "bad" }, { quality: "ultra" }, { resolution: "4k" }, { aspectRatio: "1:1" }, { form: { ...form(), description: "" } }, { form: { ...form(), categoryId: "missing" } }, { form: { ...form(), targetWorldId: "../world" } }, { form: { ...form(), name: "Una guardia" } }, { references: [{ worldId: world, actorId: "missing", purpose: "style" }] }, { references: [{ worldId: world, actorId: "example", purpose: "invalid" }] }, { references: Array.from({ length: 4 }, () => ({ worldId: world, actorId: "example", purpose: "style" })) }]) {
  assert.equal((await req(base, { ...submit(), ...patch }, dm)).status, 400, JSON.stringify(patch));
}
assert.equal(await storage.get("active"), undefined, "invalid input never starts paid work");
delete env.OPENAI_API_KEY;
assert.equal((await req(base, submit(), dm)).status, 503);
env.OPENAI_API_KEY = "fake-no-paid-api";

const originalFetch = globalThis.fetch;
const calls = [];
let failToken = false, wrongSize = false, opaqueToken = false;
globalThis.fetch = async (url, options) => {
  assert.match(url, /^https:\/\/api\.openai\.com\/v1\/images\/(generations|edits)$/);
  const body = JSON.parse(options.body); calls.push({ url, body });
  assert.equal(body.model, AVATAR_MODEL); assert.equal(body.n, 1); assert.equal(body.output_format, "webp");
  const [width, height] = body.size.split("x").map(Number);
  if (failToken && width === height) return Response.json({ error: "private provider payload" }, { status: 500 });
  return Response.json({ data: [{ b64_json: Buffer.from(image(wrongSize ? 16 : width, wrongSize ? 16 : height, body.background === "transparent" && !opaqueToken)).toString("base64") }] });
};
try {
  assert.equal(webpHasAlpha(image(1536)), false);
  assert.equal(webpHasAlpha(image(1536, 1536, true)), true);
  assert.equal(webpHasAlpha(image(1536, 1536, true).slice(0, -1)), false, "truncated alpha chunks are rejected");
  const flagOnly = image(1536); flagOnly[20] = 0x10;
  assert.equal(webpHasAlpha(flagOnly), false, "a flag without an alpha payload is not sufficient");
  const lossless = image(16); lossless.set(Buffer.from("VP8L"), 12); lossless[20] = 0x2f;
  new DataView(lossless.buffer).setUint32(21, 15 | (15 << 14) | 0x10000000, true);
  assert.equal(webpHasAlpha(lossless), true, "lossless WebP alpha is supported too");
  new DataView(lossless.buffer).setUint32(21, 15 | (15 << 14), true);
  assert.equal(webpHasAlpha(lossless), false);
  const binding = env.NPC_GENERATOR;
  env.NPC_GENERATOR = { idFromName: value => value, get: () => ({ fetch: async request => new URL(request.url).pathname === "/latest" ? Response.json({ ok: true, version: 1, job: null }) : Response.json({ ok: false }, { status: 404 }) }) };
  assert.equal((await req(base, submit(), dm)).status, 503, "an older coordinator cannot silently generate opaque tokens");
  env.NPC_GENERATOR = binding;
  const body = submit(), id = body.requestId;
  const duplicates = await Promise.all(Array.from({ length: 4 }, () => req(base, body, dm)));
  assert.ok(duplicates.every(response => response.ok));
  assert.equal(calls.length, 0, "enqueueing a draft makes no provider call");
  assert.equal((await status()).job.id, id);
  assert.equal((await req(base, submit("Other"), dm)).status, 409);
  assert.equal((await req(`${base}/${id}/confirm`, {}, dm)).status, 409);
  await coordinator.alarm();
  assert.equal(calls.length, 1); assert.ok(calls[0].url.endsWith("/generations")); assert.equal(calls[0].body.images, undefined);
  assert.equal(calls[0].body.size, "1296x2304"); assert.match(calls[0].body.prompt, /full.*body|entire body/i);
  const avatarOnly = (await status()).job;
  assert.equal(avatarOnly.options.aspectRatio, "9:16");
  assert.match(calls[0].body.prompt, /Vertical 9:16/);
  assert.equal(avatarOnly.phase, "token"); assert.equal(avatarOnly.hasAvatar, true); assert.equal(avatarOnly.hasToken, false);
  assert.equal((await req(`${base}/${id}/avatar`, undefined, dm)).status, 200);
  assert.equal((await req(`${base}/${id}/token`, undefined, dm)).status, 409);
  assert.equal((await req(`${base}/${id}/avatar`, undefined, admin)).status, 404, "drafts also stay separate between editors");
  assert.equal((await req(`${base}/${id}/avatar`, undefined, player)).status, 403);
  assert.equal((await req(`media/_private/ai-npcs/${id}/avatar.webp`)).status, 400);
  coordinator = new NpcGenerationStore({ storage }, env);
  await coordinator.alarm();
  assert.equal(calls.length, 2); assert.ok(calls[1].url.endsWith("/edits")); assert.equal(calls[1].body.size, "1536x1536");
  assert.equal(calls[1].body.images.length, 1); assert.equal(calls[1].body.images[0].image_url, `data:image/webp;base64,${Buffer.from(image(1296, 2304)).toString("base64")}`);
  assert.match(calls[1].body.prompt, /transparent alpha channel/); assert.match(calls[1].body.prompt, /entire circular frame/);
  assert.equal(calls[1].body.background, "transparent"); assert.equal(calls[1].body.output_compression, 100);
  assert.equal(calls[1].body.quality, "high"); assert.equal(calls[0].body.background, undefined, "avatar settings are unchanged");
  assert.doesNotMatch(calls[1].body.prompt, /front|three.quarter|3\/4|9:16/i, "the token has no forced viewing angle or vertical composition");
  assert.equal((await status()).job.status, "ready"); await coordinator.alarm(); assert.equal(calls.length, 2);
  assert.equal(kv.has(`campaign:${campaign}:managed-actor-create-requests`), false, "images do not create an Actor before confirmation");
  const finalForm = { ...form("Custode approvato"), description: "Descrizione corretta dopo l'anteprima.", visibility: "public" };
  const accepted = await req(`${base}/${id}/confirm`, { form: finalForm }, dm);
  assert.equal(accepted.status, 202, await accepted.clone().text());
  const receipt = await accepted.json();
  assert.equal(receipt.request.id, id); assert.equal(receipt.request.clientId, `ai-${id}`);
  assert.equal(receipt.request.profile.blocks[0].text, finalForm.description); assert.equal(receipt.request.profile.categoryId, "alleati");
  assert.equal(receipt.request.profile.visibility.state, "public"); assert.equal(receipt.request.document.system.attributes.hp.max, 1);
  assert.deepEqual(objects.get(receipt.request.document.media.token.slice("media/".length)), image(1536, 1536, true), "confirmation preserves the provider's exact full-resolution bytes without re-encoding");
  assert.ok(receipt.request.document.media.token.startsWith("media/campaigns/")); assert.notEqual(receipt.request.document.media.avatar, receipt.request.document.media.token);
  assert.equal((await req(receipt.request.document.media.avatar)).status, 200);
  assert.deepEqual(await (await req(`${base}/${id}/confirm`, {}, dm)).json(), receipt);
  assert.equal(JSON.parse(kv.get(`campaign:${campaign}:managed-actor-create-requests`)).requests.length, 1);
  assert.equal(calls.length, 2, "confirmation and repeated confirmation are free");

  const referenceBody = submit("Nuovo cavaliere", { references: [{ worldId: world, actorId: "example", purpose: "clothing", note: "Il mantello" }, { worldId: world, actorId: "frame", purpose: "frame", note: "Il bordo dorato" }] });
  const referenceJob = await start(referenceBody);
  const savedReference = objects.get(sourceKey("example")).slice(); objects.set(sourceKey("example"), image(864, 1536));
  const beforeReferences = calls.length;
  await coordinator.alarm(); await coordinator.alarm();
  assert.equal(calls.length, beforeReferences + 2);
  assert.equal(calls.at(-2).body.images.length, 1, "frame references are not sent to the avatar generator");
  assert.equal(calls.at(-2).body.images[0].image_url, `data:image/webp;base64,${Buffer.from(savedReference).toString("base64")}`, "references are fixed when the request starts");
  assert.equal(calls.at(-1).body.images.length, 2, "the token receives the generated avatar and its frame reference");
  assert.match(calls.at(-1).body.prompt, /circular token frame/);
  assert.equal((await status(admin)).job, null);
  assert.equal((await status(admin, "mago-folle")).job, null, "campaign drafts are isolated");

  const regenerated = await start(submit("Nuovo cavaliere", { parentJobId: referenceJob.id, aspectRatio: "16:9" }));
  assert.equal(regenerated.draftId, referenceJob.draftId); assert.equal(regenerated.hasToken, false);
  assert.equal((await req(`${base}/${referenceJob.id}/confirm`, {}, dm)).status, 409, "a superseded pair cannot be confirmed");
  await coordinator.alarm(); failToken = true; await coordinator.alarm(); failToken = false;
  assert.equal(calls.at(-2).body.size, "2304x1296");
  assert.match(calls.at(-2).body.prompt, /Horizontal 16:9/);
  assert.doesNotMatch(calls.at(-2).body.prompt, /9:16/);
  const partial = (await status()).job;
  assert.equal(partial.status, "uncertain"); assert.equal(partial.hasAvatar, true); assert.equal(partial.hasToken, false);
  assert.doesNotMatch(partial.error, /private provider payload/);
  const retryId = randomUUID(), beforeRetry = calls.length;
  const retried = await req(`${base}/${regenerated.id}/retry-token`, { requestId: retryId, quality: "medium", resolution: "medium" }, dm);
  assert.equal(retried.status, 202, await retried.clone().text());
  const retryJob = (await retried.json()).job; assert.equal(retryJob.draftId, referenceJob.draftId);
  await coordinator.alarm();
  assert.equal(retryJob.options.aspectRatio, "16:9", "retrying only the token preserves the existing avatar orientation");
  assert.equal(calls.at(-1).body.images[0].image_url, `data:image/webp;base64,${Buffer.from(image(2304, 1296)).toString("base64")}`);
  assert.doesNotMatch(calls.at(-1).body.prompt, /9:16|16:9/);
  assert.equal(calls.length, beforeRetry + 1); assert.equal(calls.at(-1).body.size, "1024x1024"); assert.equal(calls.at(-1).body.quality, "medium");
  assert.equal((await status()).job.status, "ready");
  assert.equal((await readJob(retryId)).avatarKey, (await readJob(regenerated.id)).avatarKey);
  assert.equal((await readJob(retryId)).tokenAvatarKey, (await readJob(retryId)).avatarKey);
  assert.equal((await req(`${base}/${regenerated.id}/retry-token`, { requestId: retryId }, dm)).status, 200, "lost token request responses recover the same paid attempt");

  const noAlpha = await start(submit("Token senza alpha")); await coordinator.alarm(); opaqueToken = true; await coordinator.alarm(); opaqueToken = false;
  const alphaFailure = (await status()).job;
  assert.equal(alphaFailure.hasAvatar, true); assert.equal(alphaFailure.hasToken, false); assert.match(alphaFailure.error, /trasparenza/);
  assert.equal((await req(`${base}/${noAlpha.id}/confirm`, {}, dm)).status, 409);
  const alphaCalls = calls.length; await coordinator.alarm(); assert.equal(calls.length, alphaCalls, "an opaque result never triggers another paid attempt automatically");
  const alphaRetry = await req(`${base}/${noAlpha.id}/retry-token`, { requestId: randomUUID() }, dm);
  assert.equal(alphaRetry.status, 202); await coordinator.alarm(); assert.equal(calls.length, alphaCalls + 1); assert.equal((await status()).job.tokenBackground, "transparent");

  assert.equal(initial.conceptReferences, 1);
  const upload = (bytes, auth = dm, type = 'image/webp', headers = {}) => worker.fetch(new Request(`https://worker.test/${base}/concepts?campaign=${campaign}`, {
    method: 'POST', headers: {Authorization: `Bearer ${auth}`, 'Content-Type': type, ...headers}, body: bytes
  }), env, {});
  const art = await Promise.all(['creatures/bestiary/nino_olegna_npc.webp', 'items/control_crown.webp', 'items/ginevra_shield.webp']
    .map(path => readFile(new URL('../assets/img/' + path, import.meta.url))));
  assert.equal((await upload(art[0], player)).status, 403);
  assert.equal((await upload('<svg></svg>')).status, 400);
  assert.equal((await upload(art[0], dm, 'image/png')).status, 400);
  assert.equal((await upload(art[0], dm, 'image/webp', {'Content-Length': 13 * 1024 * 1024})).status, 413);
  assert.equal((await upload(new Uint8Array(12 * 1024 * 1024 + 1))).status, 413, 'Stream limit also applies without a declared length');
  const beforeConcept = calls.length;
  const refs = [];
  for (const [index, purpose] of ['character','emblem','equipment'].entries()) {
    const result = await upload(art[index]); assert.equal(result.status, 200);
    const {uploadId} = await result.json();
    refs.push({uploadId, name: 'Disegno ' + index, purpose, note: ['','Sul petto','Al braccio sinistro'][index]});
    const path = `${base}/concepts/${uploadId}`;
    assert.deepEqual(Buffer.from(await (await req(path, undefined, dm)).arrayBuffer()), art[index]);
    assert.equal((await req(path, undefined, admin)).status, 404);
    assert.equal((await req(path, undefined, admin, 'mago-folle')).status, 404);
  }
  assert.equal((await (await upload(art[0])).json()).uploadId, refs[0].uploadId);
  assert.equal(calls.length, beforeConcept, 'Uploading multiple concepts never starts generation');
  const storedHead = bucket.head;
  try {
    bucket.head = async key => key.includes('/concepts/') ? {size:9 * 1024 * 1024} : storedHead.call(bucket, key);
    assert.equal((await req(base, submit('', {references:refs}), dm)).status, 400, 'Three individually valid files can exceed the combined size limit');
  } finally { bucket.head = storedHead; }
  const newForm = {...form('Custode da un ritratto'), description: ''};
  for (const invalid of [[refs[1]], [...refs, refs[0]], [refs[0], refs[0]], [{...refs[0], note:'a'.repeat(301)}], [{...refs[0], uploadId:'../concept'}]]) {
    assert.equal((await req(base, submit('', {form:newForm, references:invalid}), dm)).status, 400);
  }
  assert.equal((await req(base, submit('', {references:refs}), admin)).status, 400);
  const soloBody = submit('', {form:newForm, references:[refs[0]]});
  await start(soloBody); await coordinator.alarm(); await coordinator.alarm();
  assert.equal(calls.at(-2).body.images.length, 1);
  assert.equal((await req(base, soloBody, dm)).status, 200);
  assert.equal((await req(`${base}/${soloBody.requestId}/confirm`, {form:newForm}, dm)).status, 202);
  const fromArt = await start(submit('Custode con emblema', {references: refs}));
  assert.deepEqual(fromArt.references, refs);
  await coordinator.alarm(); await coordinator.alarm();
  const avatarCall = calls.at(-2).body, tokenCall = calls.at(-1).body;
  assert.deepEqual(avatarCall.images.map(im => im.image_url), art.map(bytes => 'data:image/webp;base64,' + bytes.toString('base64')));
  assert.deepEqual(JSON.parse(avatarCall.prompt.split('Reference roles: ').at(-1)).map(ref => [ref.image, ref.note]), refs.map((ref, i) => [i + 1, ref.note]));
  assert.equal(tokenCall.images.length, 1);
  assert.doesNotMatch(tokenCall.prompt, /Sul petto|Al braccio/);
  const mixed = await start(submit('Araldo', {references:[refs[1], {worldId:world, actorId:'frame', purpose:'frame'}]}));
  await coordinator.alarm(); await coordinator.alarm();
  assert.equal(calls.at(-2).body.images.length, 1); assert.equal(calls.at(-1).body.images.length, 2);
  const retryMixed = await req(`${base}/${mixed.id}/retry-token`, {requestId:randomUUID()}, dm);
  assert.equal(retryMixed.status, 202); assert.deepEqual((await retryMixed.json()).job.references, mixed.references);
  await coordinator.alarm(); assert.equal(calls.at(-1).body.images.length, 2);

  for (const target of ["mago-folle", "oltre-il-velo"]) {
    const other = await start({ ...submit(`NPC ${target}`), form: { ...form(`NPC ${target}`), categoryId: "" } }, admin, target);
    await coordinator.alarm(); await coordinator.alarm();
    assert.equal((await status(admin, target)).job.status, "ready");
    assert.equal((await req(`${base}/${other.id}/token`, undefined, admin, campaign)).status, 404);
    assert.equal((await req(`${base}/${other.id}/confirm`, {}, admin, target)).status, 202);
  }
  const poseDraft = await start(submit("Custode in due pose"));
  await coordinator.alarm(); await coordinator.alarm();
  const poseAction = (id, action, body = {}) => req(`${base}/${id}/${action}`, { requestId: randomUUID(), ...body }, dm);
  assert.equal((await poseAction(poseDraft.id, "generate-hover")).status, 409);
  const idleRequest = { requestId: randomUUID() };
  const idleStart = await poseAction(poseDraft.id, "generate-idle", idleRequest);
  assert.equal(idleStart.status, 202);
  assert.equal((await poseAction(poseDraft.id, "generate-idle", idleRequest)).status, 200);
  await coordinator.alarm();
  const idle = (await status()).job;
  assert.equal(idle.hasIdle, true); assert.equal(idle.hasHover, false);
  const idleCall = calls.at(-1).body;
  assert.equal(idleCall.images.length, 2); assert.equal(idleCall.background, "transparent"); assert.match(idleCall.prompt, /frameless/);
  const uploadBytes = image(1024, 1024, true), uploaded = await (await upload(uploadBytes)).json();
  const beforeImport = calls.length;
  assert.equal((await poseAction(idle.id, "use-idle", {uploadId: uploaded.uploadId})).status, 202);
  const imported = (await status()).job;
  await coordinator.alarm(); assert.equal(calls.length, beforeImport);
  assert.deepEqual(new Uint8Array(await (await req(`${base}/${imported.id}/idle`, undefined, dm)).arrayBuffer()), uploadBytes);
  assert.equal((await poseAction(imported.id, "generate-hover", {idleRevision: idle.idleRevision})).status, 409);
  const direction = "Le rune sul guanto si accendono";
  assert.equal((await poseAction(imported.id, "generate-hover", { idleRevision: imported.idleRevision, direction })).status, 202);
  await coordinator.alarm();
  const pair = (await status()).job, hoverCall = calls.at(-1).body;
  assert.deepEqual(hoverCall.images, [{image_url: "data:image/webp;base64," + Buffer.from(uploadBytes).toString("base64")}]);
  assert.ok(hoverCall.prompt.includes(direction)); assert.equal(hoverCall.output_compression, 100);
  assert.equal((await poseAction(pair.id, "confirm", { includePoses: true, idleRevision: "stale", hoverRevision: pair.hoverRevision })).status, 409);
  // An opaque replacement preserves the previously approved pair and never changes the map token.
  assert.equal((await poseAction(pair.id, "generate-idle")).status, 202);
  opaqueToken = true; await coordinator.alarm(); opaqueToken = false;
  const rejectedIdle = (await status()).job;
  assert.equal(rejectedIdle.canConfirm, true); assert.equal(rejectedIdle.hoverRevision, pair.hoverRevision);
  const poseReceipt = await poseAction(rejectedIdle.id, "confirm", { includePoses: true, idleRevision: pair.idleRevision, hoverRevision: pair.hoverRevision });
  assert.equal(poseReceipt.status, 202, await poseReceipt.clone().text());
  const queuedPoses = (await poseReceipt.json()).request;
  assert.equal(queuedPoses.profile.poseDraftId, poseDraft.id);
  assert.deepEqual(Object.keys(queuedPoses.document.media).sort(), ["avatar", "token"]);
  const posePrefix = queuedPoses.document.media.token.slice(6, -"token.webp".length);
  assert.deepEqual(objects.get(posePrefix + "idle.webp"), uploadBytes);
  assert.deepEqual(objects.get(posePrefix + "token.webp"), image(1536, 1536, true));
  const optionalDraft = await start(submit("Solo token e avatar"));
  await coordinator.alarm(); await coordinator.alarm();
  const opaqueUpload = await (await upload(image(1024))).json();
  assert.equal((await poseAction(optionalDraft.id, "use-idle", {uploadId:opaqueUpload.uploadId})).status, 400);
  assert.equal((await poseAction(optionalDraft.id, "generate-idle")).status, 202);
  await coordinator.alarm();
  const firstIdle = (await status()).job;
  await poseAction(firstIdle.id, "generate-hover", {idleRevision:firstIdle.idleRevision});
  await coordinator.alarm();
  const firstPair = (await status()).job;
  await poseAction(firstPair.id, "generate-idle"); await coordinator.alarm();
  const replacement = (await status()).job;
  assert.notEqual(replacement.idleRevision, firstPair.idleRevision);
  assert.equal(replacement.hasHover, false, "a replacement idle cannot be approved with the old hover");
  assert.equal((await poseAction(firstPair.id, "confirm", {includePoses:true, idleRevision:firstPair.idleRevision, hoverRevision:firstPair.hoverRevision})).status, 409);
  await poseAction(replacement.id, "generate-hover", {idleRevision:replacement.idleRevision});
  const stoppedPose = (await status()).job;
  await poseAction(stoppedPose.id, "stop");
  const skipped = await poseAction(stoppedPose.id, "confirm");
  assert.equal(skipped.status, 202); assert.equal((await skipped.json()).request.profile.poseDraftId, undefined);

  const existingPath = `api/managed-actors/${world}/example`, existingPoses = existingPath + "/poses";
  const readExisting = async () => (await (await req(existingPath, undefined, dm)).json()).data;
  const currentPoses = async () => (await (await req(existingPoses, undefined, dm)).json());
  const posePost = (suffix, input) => req(existingPoses + suffix, input, dm);
  const beforeExisting = await readExisting(), existingIdleKey = sourceKey("example").replace("avatar.webp","idle.png");
  const png = new Uint8Array([137,80,78,71,13,10,26,10]);
  objects.set(existingIdleKey, png);
  const currentIdleSlot = {path:"media/" + existingIdleKey, revision:2, source:"site", presentation:{x:48,y:43,scale:1.1}};
  assert.equal((await req(existingPath, {...beforeExisting, expectedRevision: beforeExisting.revision, media:{idle:currentIdleSlot}}, dm)).status, 200);
  const oldMedia = (await readExisting()).media;
  const existingDraft = (await status()).job.id;
  let poseState = await currentPoses();
  assert.equal(poseState.canUseIdle, true);
  assert.equal((await req(existingPoses, undefined, player)).status, 403);
  const startExisting = (action, extra = {}) => posePost("", {requestId:randomUUID(), baseline:poseState.baseline, action, ...extra});
  const fromSaved = await startExisting("hover", {direction:"Socchiude gli occhi"});
  assert.equal(fromSaved.status, 202, await fromSaved.clone().text());
  await coordinator.alarm();
  let proposed = (await currentPoses()).job;
  assert.equal(proposed.usesCurrentIdle,true);
  assert.deepEqual(calls.at(-1).body.images, [{image_url:"data:image/png;base64," + Buffer.from(png).toString("base64")}]);
  assert.match(calls.at(-1).body.prompt, /Socchiude gli occhi/);
  assert.equal((await req(`${existingPoses}/${proposed.id}/idle`, undefined, dm)).headers.get("Content-Type"), "image/png");
  assert.equal((await req(`${base}/${proposed.id}/hover`, undefined, dm)).status, 404);
  assert.equal((await req(`api/managed-actors/${world}/frame/poses/${proposed.id}/hover`, undefined, dm)).status, 404);
  assert.deepEqual((await readExisting()).media, oldMedia);
  const applyPoses = job => posePost("/" + job.id + "/confirm", {idleRevision:job.idleRevision,hoverRevision:job.hoverRevision});
  const appliedPair = await applyPoses(proposed);
  assert.equal(appliedPair.status, 200, await appliedPair.clone().text());
  const withHover = await readExisting();
  assert.deepEqual(withHover.media.idle, oldMedia.idle); assert.deepEqual(withHover.media.token, oldMedia.token);
  assert.deepEqual(withHover.media.avatar, oldMedia.avatar); assert.deepEqual(withHover.media.hover.presentation, oldMedia.idle.presentation);
  assert.deepEqual(await (await applyPoses(proposed)).json(), await appliedPair.json());
  assert.equal((await readExisting()).revision, withHover.revision);
  poseState = await currentPoses();
  assert.equal((await startExisting("idle")).status, 202); await coordinator.alarm();
  const candidateIdle = (await currentPoses()).job;
  assert.equal(calls.at(-1).body.images.length, 2);
  assert.equal((await startExisting("hover", {parentJobId:candidateIdle.id,idleRevision:"wrong"})).status,409);
  assert.equal((await startExisting("hover", {parentJobId:candidateIdle.id,idleRevision:candidateIdle.idleRevision})).status, 202);
  await coordinator.alarm();
  proposed = (await currentPoses()).job;
  const changedMedia = {idle:{...oldMedia.idle,revision:10}};
  assert.equal((await req(existingPath, {...withHover,expectedRevision:withHover.revision,media:changedMedia}, dm)).status,200);
  assert.equal((await applyPoses(proposed)).status,409,"concurrent edits protect both slots");
  poseState = await currentPoses();
  assert.equal((await startExisting("idle")).status,202); await coordinator.alarm();
  const newIdle = (await currentPoses()).job;
  assert.equal((await startExisting("hover",{parentJobId:newIdle.id,idleRevision:newIdle.idleRevision})).status,202);
  await coordinator.alarm();
  proposed = (await currentPoses()).job;
  assert.equal((await applyPoses(proposed)).status,200);
  const finalActor = await readExisting();
  assert.notEqual(finalActor.media.idle.path, oldMedia.idle.path);
  assert.deepEqual(finalActor.media.token, oldMedia.token);
  assert.ok(finalActor.site.idleHistory.some(i => i.path === oldMedia.idle.path));
  assert.ok(finalActor.site.hoverHistory.some(i => i.path === withHover.media.hover.path));
  const uploadPose = await worker.fetch(new Request(`https://worker.test/${existingPoses}/upload?campaign=${campaign}`, {
    method:"POST", headers:{Authorization:"Bearer " + dm,"Content-Type":"image/webp"}, body:uploadBytes
  }), env, {});
  assert.equal(uploadPose.status,200);
  const uploadedPose = await uploadPose.json();
  poseState = await currentPoses();
  const paidBeforeUpload = calls.length;
  assert.equal((await startExisting("upload",{uploadId:uploadedPose.uploadId})).status,202);
  const importedPose = (await currentPoses()).job;
  assert.equal(importedPose.status,"ready");
  await coordinator.alarm(); assert.equal(calls.length,paidBeforeUpload);
  assert.equal((await startExisting("hover",{parentJobId:importedPose.id,idleRevision:importedPose.idleRevision})).status,202);
  await coordinator.alarm();
  assert.deepEqual(calls.at(-1).body.images,[{image_url:"data:image/webp;base64," + Buffer.from(uploadBytes).toString("base64")}]);
  assert.deepEqual((await readExisting()).media,finalActor.media);
  assert.equal((await status()).job.id, existingDraft,"existing NPC tools do not replace the new NPC draft");

  const interrupted = await start(submit("Interrotto")); const beforeStop = calls.length;
  assert.equal((await req(`${base}/${interrupted.id}/stop`, {}, dm)).status, 200);
  await coordinator.alarm(); assert.equal(calls.length, beforeStop); assert.equal(await storage.get("active"), undefined);
  assert.equal((await req(`${base}/${interrupted.id}/retry-token`, { requestId: randomUUID() }, dm)).status, 409);

  const invalidResult = await start(submit("Formato errato")); wrongSize = true; await coordinator.alarm(); wrongSize = false;
  assert.equal((await status()).job.hasAvatar, false); assert.equal((await req(`${base}/${invalidResult.id}/confirm`, {}, dm)).status, 409);

  const restart = await start(submit("Riavvio incerto"));
  const persisted = await readJob(restart.id); persisted.status = "running"; persisted.deadlineAt = Date.now() + 60000; await storage.put(`job:${restart.id}`, persisted);
  coordinator = new NpcGenerationStore({ storage }, env); const beforeRestart = calls.length; await coordinator.alarm();
  assert.equal(calls.length, beforeRestart); assert.equal((await status()).job.status, "uncertain", "a restarted execution is never repeated at the provider");

  const recovered = await start(submit("Avatar da recuperare"));
  const expired = await readJob(recovered.id); expired.status = "running"; expired.deadlineAt = Date.now() - 1; await storage.put(`job:${recovered.id}`, expired);
  objects.set(expired.avatarKey, image(1296, 2304));
  const beforeRecovery = calls.length; assert.equal((await status()).job.status, "paused"); assert.equal((await status()).job.hasAvatar, true);
  await coordinator.alarm(); assert.equal(calls.length, beforeRecovery, "recovering an avatar does not silently pay for a token");

  const late = await start(submit("Avatar tardivo"));
  let resolveProvider, started;
  const began = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async () => { started(); return new Promise(resolve => { resolveProvider = resolve; }); };
  const execution = coordinator.alarm(); await began;
  await req(`${base}/${late.id}/stop`, {}, dm);
  const next = await start(submit("Bozza successiva")), nextAlarm = storage.alarm;
  resolveProvider(Response.json({ data: [{ b64_json: Buffer.from(image(1296, 2304)).toString("base64") }] })); await execution;
  assert.equal((await readJob(late.id)).status, "paused"); assert.equal((await readJob(late.id)).avatarReady, true);
  assert.equal(await storage.get("active"), next.id); assert.equal(storage.alarm, nextAlarm, "a late completion never clears a newer generation");
  await req(`${base}/${next.id}/stop`, {}, dm);

  // Regression: pending directory cards must render before an Actor exists.
  const directory = await readFile(new URL("../assets/js/pages/npcs.js", import.meta.url), "utf8");
  const startAt = directory.indexOf("        function managedCreateRequestToNpcListEntry(request) {");
  const endAt = directory.indexOf("        function managedPresentationToNpcAdjust", startAt);
  const context = vm.createContext({}); vm.runInContext(directory.slice(startAt, endAt), context);
  context.request = receipt.request;
  const pending = vm.runInContext("managedCreateRequestToNpcListEntry(request)", context);
  assert.equal(pending.pendingCreate, true); assert.equal(pending.name, finalForm.name); assert.equal(pending.images.token, receipt.request.document.media.token);
  // The real directory button must work from both NPC and Bestiary filters.
  const setupStart = directory.indexOf("        function setupNpcCreateNameCheck(");
  const setupEnd = directory.indexOf("        function openManagedNpcCreateWizard(", setupStart);
  for (const kind of ["person", "creature"]) {
    let click, opened;
    let reloadOptions;
    const completeCatalog = Array.from({ length: 65 }, (_, index) => ({ managedActorWorldId: world, managedActorId: `reference-${index}`, kind: index % 2 ? "creature" : "person" }));
    const button = { dataset: {}, addEventListener: (_event, callback) => { click = callback; } };
    const setupContext = vm.createContext({
      document: { querySelector: selector => selector === "[data-npc-generate]" ? button : { dataset: { rosterType: kind } } },
      window: { CriptaNpcGenerator: { open: options => { opened = options; } }, CriptaNpcCategories: { normalizeRegistry: value => value }, location: { reload() {} } },
      selectableNpcCategories: registry => registry.categories,
      loadManagedNpcEntries: async (_legacy, options) => { reloadOptions = options; return { npcs: [...completeCatalog, { pendingCreate: true }], npcCategories: [] }; },
      applyNpcCategoryMetadata: npc => npc,
    });
    vm.runInContext(directory.slice(setupStart, setupEnd), setupContext);
    setupContext.input = { managedState: { npcs: [{ managedActorWorldId: world, managedActorId: "example" }, { pendingCreate: true }], worldIds: [world] }, categoryRegistry: { categories: [] } };
    vm.runInContext("setupNpcGeneration(input)", setupContext); click();
    assert.equal(opened.initialKind, kind); assert.equal(opened.npcs.length, 1); assert.equal(opened.worlds[0], world);
    const signal = AbortSignal.timeout(20000), catalog = await opened.loadReferences({ signal });
    assert.equal(catalog.length, 65, "reference selection reloads the complete catalog independently of the current roster type");
    assert.equal(reloadOptions.signal, signal); assert.ok(catalog.some(npc => npc.kind === "creature")); assert.ok(catalog.some(npc => npc.kind === "person"));
  }
  assert.doesNotMatch(npcImagePrompt(await readJob(late.id), "token"), /front|three.quarter|3\/4|9:16/i);
  console.log("NPC generation: authenticated routes, private drafts, sequential images, scoped references, retries, confirmations, all campaigns and interrupted-work recovery passed. No paid API calls.");
} finally { globalThis.fetch = originalFetch; }
