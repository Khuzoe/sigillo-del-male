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
assert.deepEqual(initial.tokenSizes, NPC_TOKEN_SIZES);
assert.deepEqual(initial.supportedQualities, ["medium", "high", "xhigh"]);
assert.deepEqual(initial.supportedResolutions, ["medium", "high", "2k"]);
for (const patch of [{ requestId: "bad" }, { quality: "ultra" }, { resolution: "4k" }, { form: { ...form(), description: "" } }, { form: { ...form(), categoryId: "missing" } }, { form: { ...form(), targetWorldId: "../world" } }, { form: { ...form(), name: "Una guardia" } }, { references: [{ worldId: world, actorId: "missing", purpose: "style" }] }, { references: [{ worldId: world, actorId: "example", purpose: "invalid" }] }, { references: Array.from({ length: 4 }, () => ({ worldId: world, actorId: "example", purpose: "style" })) }]) {
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

  const regenerated = await start(submit("Nuovo cavaliere", { parentJobId: referenceJob.id }));
  assert.equal(regenerated.draftId, referenceJob.draftId); assert.equal(regenerated.hasToken, false);
  assert.equal((await req(`${base}/${referenceJob.id}/confirm`, {}, dm)).status, 409, "a superseded pair cannot be confirmed");
  await coordinator.alarm(); failToken = true; await coordinator.alarm(); failToken = false;
  const partial = (await status()).job;
  assert.equal(partial.status, "uncertain"); assert.equal(partial.hasAvatar, true); assert.equal(partial.hasToken, false);
  assert.doesNotMatch(partial.error, /private provider payload/);
  const retryId = randomUUID(), beforeRetry = calls.length;
  const retried = await req(`${base}/${regenerated.id}/retry-token`, { requestId: retryId, quality: "medium", resolution: "medium" }, dm);
  assert.equal(retried.status, 202, await retried.clone().text());
  const retryJob = (await retried.json()).job; assert.equal(retryJob.draftId, referenceJob.draftId);
  await coordinator.alarm();
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

  for (const target of ["mago-folle", "oltre-il-velo"]) {
    const other = await start({ ...submit(`NPC ${target}`), form: { ...form(`NPC ${target}`), categoryId: "" } }, admin, target);
    await coordinator.alarm(); await coordinator.alarm();
    assert.equal((await status(admin, target)).job.status, "ready");
    assert.equal((await req(`${base}/${other.id}/token`, undefined, admin, campaign)).status, 404);
    assert.equal((await req(`${base}/${other.id}/confirm`, {}, admin, target)).status, 202);
  }
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
  const setupStart = directory.indexOf("        function setupNpcGeneration(");
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
