import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import worker from "../workers/main-worker/src/index.js";
import {AbilityGenerationStore, ABILITY_MODEL, abilityContext} from "../workers/main-worker/src/ability-generation.js";
import {validateAbility, compileAbility, abilitySummary} from "../assets/js/shared/npc-ability-schema.mjs";
import {validateSuggestions, generateNpcSuggestions} from "../workers/main-worker/src/npc-suggestions.js";

const draft = {name: "Morso necrotico", flavor: "Le fauci sottraggono energia vitale.", mode: "attack", activation: "action", range: 10, units: "ft", attackKind: "melee", attackBonus: 8,
  damage: {formula: "2d8+5", type: "piercing"}, save: {enabled: true, ability: "con", dc: 16, onSave: "none"}, extraDamage: {formula: "2d6", type: "necrotic"},
  healing: {fraction: 1, source: "extra"}, conditions: [], rounds: 1, uses: 0, recovery: "day", balance: "Danni contenuti per compensare la cura.", assumptions: ["Portata in piedi."], unsupported: [], iconPrompt: "Fauci del mostro con energia necrotica."};
const compiled = compileAbility(draft, "test");
const [attack, secondary] = Object.values(compiled.system.activities);
assert.equal(attack.midiProperties.triggeredActivityId, secondary._id);
assert.equal(attack.midiProperties.triggeredActivityTargets, "hitTargets");
assert.equal(secondary.damage.onSave, "none");
assert.equal(secondary.damage.critical.allow, false);
assert.equal(secondary.damage.parts[0].types[0], "necrotic");
assert.equal(compiled.flags["khuzoe-automations"].npcRules.activities[secondary._id].healing, 1);
assert.equal(compiled.flags["khuzoe-automations"].npcRules.activities[attack._id], undefined, "physical bite cannot trigger healing");
assert.match(abilitySummary(draft).join(" "), /soli danni aggiuntivi/);
assert.equal(secondary.consumption.targets.length, 0, "follow-up does not consume a second use");
for (const mutate of [d => d.macro = "evil", d => d.damage.formula = "1d6 + game.actors.clear()", d => d.save.dc = -5, d => d.range = 9000,
  d => d.extraDamage.formula = "", d => d.healing.fraction = 3, d => d.conditions = ["invented"], d => { d.conditions = ["prone"]; d.rounds = 0; }]) {
  const invalid = structuredClone(draft); mutate(invalid); assert.throws(() => validateAbility(invalid));
}
// Inactive mechanical fields may use zero; active fields remain strictly checked.
const simpleAttack = {...structuredClone(draft), save: {...draft.save, enabled: false, dc: 0}, extraDamage: {...draft.extraDamage, formula: ""}, healing: {fraction: 0, source: "damage"}, rounds: 0};
assert.equal(validateAbility(simpleAttack).save.dc, 0, "do not invent a DC for an attack without a save");
const simpleCompiled = compileAbility(simpleAttack, "simple-attack");
assert.equal(Object.keys(simpleCompiled.system.activities).length, 1);
assert.equal(simpleCompiled.system.activities.KhzAiPrimary0001.save, undefined);
assert.equal(simpleCompiled.flags["khuzoe-automations"].npcRules.activities.KhzAiPrimary0001, undefined);
const healingOnly = compileAbility({...simpleAttack, healing: {fraction: 1, source: "damage"}, rounds: -1}, "healing-only");
assert.equal(healingOnly.flags["khuzoe-automations"].npcRules.activities.KhzAiPrimary0001.rounds, 1, "unused duration is not sent to the Foundry rule validator");
assert.ok(!abilitySummary(simpleAttack).join(" ").includes("TS "));
for (const dc of [0, -1, 41]) assert.throws(() => validateAbility({...draft, save: {...draft.save, dc}}), /CD/);
assert.throws(() => validateAbility({...simpleAttack, save: {...simpleAttack.save, enabled: true}}), /CD/);
assert.throws(() => validateAbility({...simpleAttack, conditions: ["prone"]}), /Durata/);
assert.equal(validateAbility({...simpleAttack, mode: "damage", attackBonus: 100}).attackBonus, 100);
assert.throws(() => validateAbility({...simpleAttack, attackBonus: 100}), /Bonus attacco/);
assert.throws(() => validateAbility({...simpleAttack, save: {...simpleAttack.save, dc: "0"}}), /Valore non valido/);
assert.throws(() => compileAbility({...draft, unsupported: ["TS ripetuti"]}, "x"));
assert.ok(!compileAbility({...draft, flavor: "<script>alert(1)</script>"}, "x").system.description.value.includes("<script>"));

class Storage {
  values = new Map();
  async get(k) { return structuredClone(this.values.get(k)); }
  async put(k, v) { if (typeof k === "object") { for (const [key, value] of Object.entries(k)) await this.put(key, value); } else this.values.set(k, structuredClone(v)); }
  async delete(k) { this.values.delete(k); }
  async setAlarm(t) { this.alarm = t; }
  async deleteAlarm() { this.alarm = null; }
  async transaction(fn) { const before = structuredClone(this.values); try { return await fn(this); } catch (error) { this.values = before; throw error; } }
}
function image(width) {
  const bytes = new Uint8Array(30); bytes.set(Buffer.from("RIFF")); new DataView(bytes.buffer).setUint32(4, 22, true);
  bytes.set(Buffer.from("WEBPVP8X"), 8); new DataView(bytes.buffer).setUint32(16, 10, true);
  bytes[24] = bytes[27] = (width - 1) & 255; bytes[25] = bytes[28] = (width - 1) >> 8; return bytes;
}
const objects = new Map(), kv = new Map(), storage = new Storage();
const env = {
  JWT_SECRET: "ability-test-secret", GLOBAL_ADMIN_ACCOUNT_IDS: "admin", GLOBAL_ADMIN_DEVICE_CODE: "ABILITY-ADMIN-TEST-VERY-STRONG-2026",
  DEVICE_LOGIN_CODES_SECRET: "PLAYER-ABILITY-TEST||player|Player;DM-ABILITY-TEST||dungeon-master|DM", CAMPAIGN_EDITOR_ACCOUNT_IDS: "cripta-di-sangue:dungeon-master",
  INVENTORY_SYNC_SECRET: "foundry-test", OPENAI_API_KEY: "fake-no-live-api", ABILITY_MONTHLY_LIMIT: "30", ABILITY_ICON_MONTHLY_LIMIT: "20",
  SIGILLO_KV: {async get(k) { return kv.get(k) || null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return {keys: [], list_complete: true}; }},
  MEDIA_BUCKET: {async head(k) { return objects.has(k) ? {size: objects.get(k).length} : null; }, async get(k) {
    const bytes = objects.get(k); return bytes ? {size: bytes.length, body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.slice().buffer, writeHttpMetadata: h => h.set("Content-Type", "image/webp")} : null;
  }, async put(k, v) { objects.set(k, new Uint8Array(await new Response(v).arrayBuffer())); }, async delete() { assert.fail("No media deletions"); }}
};
let coordinator = new AbilityGenerationStore({storage}, env);
env.ABILITY_GENERATOR = {idFromName: value => value, get: () => ({fetch: request => coordinator.fetch(request)})};
const campaign = "cripta-di-sangue", path = "api/managed-actors/test-world/test-npc", generation = `${path}/ability-generation`;
async function req(path, body, token, extra = {}, campaignId = campaign) {
  return worker.fetch(new Request(`https://worker.test/${path}?campaign=${campaignId}`, {method: body === undefined ? "GET" : "POST", headers: {"Content-Type": "application/json", ...(token ? {Authorization: `Bearer ${token}`} : {}), ...extra}, ...(body === undefined ? {} : {body: JSON.stringify(body)})}), env, {waitUntil(p) { p.catch(() => {}); }});
}
async function login(code) { const r = await req("auth/device/login", {code, campaignId: campaign}); assert.equal(r.status, 200); return (await r.json()).token; }
const admin = await login("ABILITY-ADMIN-TEST-VERY-STRONG-2026"), player = await login("PLAYER-ABILITY-TEST"), dm = await login("DM-ABILITY-TEST");
const sync = {"X-Cripta-Inventory-Secret": env.INVENTORY_SYNC_SECRET, "X-Khuzoe-Sync-Contract": "1", "X-Khuzoe-Foundry-Generation": "14"};
const ref = `campaigns/${campaign}/managed-actors/test-world/test-npc/base/avatar.webp`; objects.set(ref, image(1024));
const actorInput = {schemaVersion: 3, name: "Custode", actorType: "npc", ownerAccountIds: ["player"], visibility: {state: "public"},
  definition: {editor: {version: 1, generatedAbilities: 1, npcRules: 1}, attributes: {hp: {max: 90}}, details: {cr: 7, biography: "PRIVATE BIOGRAPHY"}, abilities: {str: {value: 20}},
    items: [{name: "Multiattacco", itemId: "existing", type: "feat", definition: {description: "Due attacchi", activities: {}, flags: {secret: "never-send"}}}]},
  media: {avatar: {path: `media/${ref}`, revision: 1}},
  contract: {name: "khuzoe-wiki-sync", version: 1, module: {id: "cripta-wiki-sync", version: "0.11.13"}, foundry: {generation: 14}, system: {id: "dnd5e", version: "5.3.3"}}};
assert.equal((await req(path, actorInput, null, sync)).status, 200);
const actorKey = `campaign:${campaign}:managed-actor:test-world:test-npc`;
const baseline = kv.get(actorKey);
assert.ok(!JSON.stringify(abilityContext(actorInput)).includes("PRIVATE BIOGRAPHY"));
assert.ok(!JSON.stringify(abilityContext(actorInput)).includes("never-send"));
assert.ok([401, 403].includes((await req(generation)).status));
assert.equal((await req(generation, undefined, player)).status, 403);
assert.equal((await req(generation, undefined, null, sync)).status, 401);
assert.equal((await req(generation, undefined, dm, {}, "mago-folle")).status, 403);
assert.equal((await (await req(generation, undefined, dm)).json()).canSync, true);

const currentAbilityBinding = env.ABILITY_GENERATOR;
try {
  env.ABILITY_GENERATOR = {idFromName: n => n, get: () => ({fetch: async request => new URL(request.url).pathname === "/latest"
    ? Response.json({ok: true, job: null}) : Response.json({ok: false, error: "Operazione non disponibile."}, {status: 409})})};
  assert.equal((await (await req(generation, undefined, dm)).json()).canStop, false);
  const updating = await req(`${generation}/${randomUUID()}/stop`, {attemptId: randomUUID()}, dm);
  assert.equal(updating.status, 503); assert.equal((await updating.json()).code, "GENERATOR_UPDATING");
} finally {env.ABILITY_GENERATOR = currentAbilityBinding;}
const id = randomUUID();
const creates = await Promise.all(Array.from({length: 4}, () => req(generation, {requestId: id, details: "Morso con cura dai danni necrotici", withIcon: true}, dm)));
assert.ok(creates.every(r => r.ok));
const month = new Date().toISOString().slice(0, 7);
assert.equal(storage.values.get(`usage:text:${month}`), 1);
assert.equal(storage.values.get(`usage:icon:${month}`), 1);
assert.equal((await req(`${generation}/${id}/confirm`, {draft}, dm)).status, 409);
assert.equal(kv.get(actorKey), baseline);
const originalFetch = globalThis.fetch;
let textCalls = 0, imageCalls = 0, imageFailure = false, capturedText, capturedImage;
globalThis.fetch = async (url, options) => {
  if (url === "https://api.openai.com/v1/responses") { textCalls++; capturedText = JSON.parse(options.body); return Response.json({status: "completed", output: [{content: [{type: "output_text", text: JSON.stringify(draft)}]}]}); }
  assert.equal(url, "https://api.openai.com/v1/images/edits"); imageCalls++; capturedImage = JSON.parse(options.body);
  return imageFailure ? new Response("provider error fake-secret", {status: 500}) : Response.json({data: [{b64_json: Buffer.from(image(1024)).toString("base64")}]});
};
try {
  await coordinator.alarm();
  assert.equal(textCalls, 1); assert.equal(imageCalls, 0);
  assert.equal(storage.values.get(`job:${id}`).status, "icon-pending");
  assert.equal(capturedText.model, ABILITY_MODEL); assert.equal(capturedText.store, false);
  assert.equal(capturedText.text.format.strict, true); assert.ok(capturedText.input.includes("Multiattacco"));
  assert.ok(!capturedText.input.includes("never-send"));
  coordinator = new AbilityGenerationStore({storage}, env);
  await coordinator.alarm(); await coordinator.alarm();
  assert.equal(textCalls, 1); assert.equal(imageCalls, 1);
  assert.equal(capturedImage.size, "1024x1024"); assert.equal(capturedImage.n, 1); assert.ok(capturedImage.images[0].image_url.startsWith("data:image/webp;base64,"));
  assert.equal(kv.get(actorKey), baseline, "draft never mutates the NPC");
  assert.equal((await req(`${generation}/${id}/preview`, undefined, dm)).status, 200);
  assert.equal((await req(`${generation}/${id}/preview`, undefined, player)).status, 403);
  assert.equal((await req(`media/_private/ai-abilities/${id}.webp`)).status, 400);
  const edited = {...draft, range: 15, damage: {...draft.damage, formula: "3d8+5"}};
  assert.equal((await req(`${generation}/${id}/save`, {draft: edited}, dm)).status, 200);
  assert.equal(textCalls, 1, "manual edit does not call OpenAI");
  assert.equal((await req(`${generation}/${id}/confirm`, {draft: edited, icon: Buffer.from(image(1024)).toString("base64")}, dm)).status, 400, "wrong final icon size rejected before enqueue");
  const response = await req(`${generation}/${id}/confirm`, {draft: edited, icon: Buffer.from(image(512)).toString("base64")}, dm);
  assert.equal(response.status, 200, await response.clone().text());
  const {command} = await response.json();
  assert.equal(command.kind, "item.create"); assert.equal(command.document.system.activities.KhzAiPrimary0001.range.value, "15");
  assert.equal(command.document.flags["khuzoe-automations"].npcRules.activities.KhzAiFollowup001.healing, 1, "creation pipeline retains approved declarative automation");
  assert.ok(command.document.img.startsWith("media/campaigns/"));
  assert.equal((await req(command.document.img)).status, 200, "final icon is loadable using the exact saved path");
  assert.equal((await (await req(`${generation}/${id}/confirm`, {draft}, dm)).json()).command.id, command.id);
  assert.equal(kv.get(actorKey), baseline, "only the normal command queue is changed, never existing stats");
  assert.equal((await req(`${generation}/${id}/save`, {draft}, dm)).status, 409);
  assert.equal(textCalls, 1); assert.equal(imageCalls, 1);

  // Image failure preserves usable text and an explicit icon-only retry.
  const second = randomUUID(); imageFailure = true;
  assert.equal((await req(generation, {requestId: second, details: "Altro morso", withIcon: true}, dm)).status, 202);
  await coordinator.alarm(); await coordinator.alarm();
  let job = (await (await req(generation, undefined, dm)).json()).job;
  assert.equal(job.status, "ready"); assert.equal(job.draft.name, draft.name); assert.ok(job.iconError); assert.ok(!job.iconError.includes("fake-secret")); assert.equal(job.iconErrorDetail.code, "service_error"); assert.equal(job.iconErrorDetail.stage, "icon");
  imageFailure = false; const iconAttempt = randomUUID();
  const iconBody = {requestId: iconAttempt, draft};
  assert.equal((await req(`${generation}/${second}/icon`, iconBody, dm)).status, 202);
  assert.equal((await req(`${generation}/${second}/icon`, iconBody, dm)).status, 200);
  await coordinator.alarm(); const textsBefore = textCalls;
  assert.equal((await req(`${generation}/${second}/icon`, iconBody, dm)).status, 200); await coordinator.alarm();
  assert.equal(textCalls, textsBefore, "icon retry never regenerates text");
  assert.equal(imageCalls, 3);
  // A different actor/campaign cannot retrieve another job by UUID.
  const otherActor = structuredClone(actorInput); otherActor.name = "Altro";
  await req("api/managed-actors/test-world/other", otherActor, null, sync);
  assert.equal((await req(`api/managed-actors/test-world/other/ability-generation/${second}/preview`, undefined, dm)).status, 404);
  const modified = JSON.parse(kv.get(actorKey)); modified.definition.attributes.hp.max = 150; kv.set(actorKey, JSON.stringify(modified));
  assert.equal((await req(`${generation}/${second}/confirm`, {draft}, dm)).status, 409, "stale balance cannot be silently confirmed");
  kv.set(actorKey, baseline);
  const unsupported = {...draft, unsupported: ["Teleportazione non supportata"]};
  assert.equal((await req(`${generation}/${second}/confirm`, {draft: unsupported}, dm)).status, 400);
  modified.definition = {...JSON.parse(baseline).definition, editor: {generatedAbilities: 0}}; kv.set(actorKey, JSON.stringify(modified));
  assert.equal((await req(`${generation}/${second}/confirm`, {draft}, dm)).status, 409, "old wiki-sync cannot silently drop mechanics");
  kv.set(actorKey, baseline);
  // Running marker recovery: no paid automatic retry.
  const third = randomUUID();
  await req(generation, {requestId: third, details: "Morso", withIcon: false}, dm);
  const interrupted = await storage.get(`job:${third}`); interrupted.status = "running"; await storage.put(`job:${third}`, interrupted);
  coordinator = new AbilityGenerationStore({storage}, env); await coordinator.alarm();
  assert.equal(textCalls, textsBefore); assert.equal((await storage.get(`job:${third}`)).status, "uncertain");
  env.ABILITY_MONTHLY_LIMIT = "0";
  assert.equal((await req(generation, {requestId: randomUUID(), details: "Morso", withIcon: false}, dm)).status, 400);
  assert.equal(textCalls, textsBefore);
} finally { globalThis.fetch = originalFetch; }

const report = {
  summary: "Il Custode ha già una buona identità da combattente. Renderei più leggibile il suo controllo del campo senza alzare il GS.",
  visualObservations: ["Il ritratto mostra un’armatura pesante e colori freddi; non dimostra resistenze magiche."],
  strengths: ["Preservare il Multiattacco e il ruolo di prima linea."],
  adjustments: [{title: "Rendere il Multiattacco più chiaro", current: "Multiattacco: Due attacchi", proposal: "Indicare esattamente quali attacchi può scegliere.", reason: "Evita ambiguità senza aumentare i danni.", impact: "neutral"}],
  ideas: [{name: "Morso necrotico", concept: "Un morso che recupera energia vitale dai danni necrotici.", visualLink: "La palette fredda suggerisce un tema necrotico, come scelta creativa.", sheetLink: "Un’alternativa agli attacchi del Multiattacco.", tradeoff: "Non aggiungerlo come attacco gratuito: sostituisce un attacco e richiede un TS per il danno extra.", generatorPrompt: "Crea un morso con TS Costituzione dopo il colpo, danni necrotici aggiuntivi e cura pari a quei soli danni. Mantieni il GS; suggerisci il costo, non modificare il Multiattacco."}],
  uncertainties: ["Il bilanciamento richiede una prova al tavolo; l’immagine non stabilisce capacità soprannaturali."]
};
validateSuggestions(report);
assert.throws(() => validateSuggestions({...report, patches: [{path: "system.attributes.hp.max", value: 1}]}));
assert.throws(() => validateSuggestions({...report, ideas: Array(4).fill(report.ideas[0])}));
assert.throws(() => validateSuggestions({...report, adjustments: [{...report.adjustments[0], impact: "guaranteed"}]}));
const suggestions = `${path}/ability-suggestions`, analysisId = randomUUID();
const kvBeforeAnalysis = [...kv.entries()], objectsBeforeAnalysis = [...objects.keys()];
const previousAbility = (await (await req(generation, undefined, dm)).json()).job.id;
assert.equal((await req(suggestions, undefined, player)).status, 403);
assert.equal((await req(suggestions, undefined, null, sync)).status, 401);
assert.equal((await req(suggestions, undefined, dm, {}, "mago-folle")).status, 403);
const analysisBody = {requestId: analysisId, details: "Mantieni il GS, suggerisci miglioramenti tattici."};
const duplicates = await Promise.all(Array.from({length: 3}, () => req(suggestions, analysisBody, dm)));
assert.ok(duplicates.every(r => r.ok));
assert.equal(storage.values.get(`usage:suggestions:${month}`), 1);
let analysisCalls = 0, capturedAnalysis, invalidAnalysis = false;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "https://api.openai.com/v1/responses", "analysis never calls image generation");
  analysisCalls++; capturedAnalysis = JSON.parse(options.body);
  return Response.json({status: "completed", output: [{content: [{type: "output_text", text: JSON.stringify(invalidAnalysis ? {...report, patches: []} : report)}]}]});
};
try {
  await assert.rejects(() => generateNpcSuggestions({referenceKey: ref, referenceEtag: "original-avatar"}, {
    MEDIA_BUCKET: {get: async () => ({size: 30, etag: "replaced-avatar"})}
  }, ABILITY_MODEL), /avatar di riferimento/i);
  assert.equal(analysisCalls, 0, "changed reference is rejected before a paid call");
  await coordinator.alarm(); await coordinator.alarm();
  assert.equal(analysisCalls, 1);
  assert.equal(capturedAnalysis.text.format.name, "npc_suggestions");
  assert.equal(capturedAnalysis.store, false);
  const content = capturedAnalysis.input[0].content;
  assert.equal(content[1].type, "input_image"); assert.equal(content[1].detail, "low");
  assert.equal(content[1].image_url, `data:image/webp;base64,${Buffer.from(image(1024)).toString("base64")}`);
  assert.match(content[0].text, /Multiattacco/); assert.match(content[0].text, /Mantieni il GS/);
  assert.ok(!content[0].text.includes("PRIVATE BIOGRAPHY"));
  const result = await (await req(suggestions, undefined, dm)).json();
  assert.equal(result.job.status, "ready"); assert.equal(result.stale, false); assert.deepEqual(result.job.report, report);
  assert.equal(result.job.draft, null);
  assert.equal((await (await req(generation, undefined, dm)).json()).job.id, previousAbility, "suggestions do not replace an ability draft");
  assert.equal((await req(`${generation}/${analysisId}/confirm`, {draft}, dm)).status, 404, "a report cannot enter the ability command pipeline");
  assert.equal((await req(`${generation}/${analysisId}/preview`, undefined, dm)).status, 404);
  for (let i = 0; i < 3; i++) await req(suggestions, undefined, dm);
  assert.equal(analysisCalls, 1, "reopening only reads saved analysis");
  assert.deepEqual([...kv.entries()], kvBeforeAnalysis, "analysis never writes NPC data or command queues");
  assert.deepEqual([...objects.keys()], objectsBeforeAnalysis, "analysis never writes/deletes R2 objects");
  const changed = JSON.parse(baseline); changed.definition.attributes.hp.max += 10; kv.set(actorKey, JSON.stringify(changed));
  assert.equal((await (await req(suggestions, undefined, dm)).json()).stale, true, "changed stats flag stale advice");
  kv.set(actorKey, baseline);
  changed.definition = JSON.parse(baseline).definition; changed.media.avatar.revision += 1; kv.set(actorKey, JSON.stringify(changed));
  assert.equal((await (await req(suggestions, undefined, dm)).json()).stale, true, "changed avatar flags stale advice");
  changed.media.avatar.path = "media/campaigns/another-campaign/portrait.webp"; kv.set(actorKey, JSON.stringify(changed));
  assert.equal((await req(suggestions, {requestId: randomUUID(), details: ""}, dm)).status, 400, "no cross-campaign or missing reference");
  assert.equal(storage.values.get(`usage:suggestions:${month}`), 1, "invalid reference does not reserve budget");
  kv.set(actorKey, baseline);
  invalidAnalysis = true;
  const invalidId = randomUUID();
  await req(suggestions, {requestId: invalidId, details: ""}, dm); await coordinator.alarm();
  assert.equal((await (await req(suggestions, undefined, dm)).json()).job.status, "uncertain");
  assert.equal((await (await req(suggestions, undefined, dm)).json()).job.errorDetail.code, "validation");
  assert.deepEqual([...kv.entries()], kvBeforeAnalysis, "invalid model output cannot change data either");
  // A restarted in-flight analysis is not automatically billed again.
  const restartId = randomUUID(); await req(suggestions, {requestId: restartId, details: ""}, dm);
  const interrupted = await storage.get(`job:${restartId}`); interrupted.status = "running"; await storage.put(`job:${restartId}`, interrupted);
  coordinator = new AbilityGenerationStore({storage}, env); await coordinator.alarm();
  assert.equal(analysisCalls, 2);
  env.NPC_SUGGESTION_MONTHLY_LIMIT = "0";
  assert.equal((await req(suggestions, {requestId: randomUUID(), details: ""}, dm)).status, 400);
  assert.equal(analysisCalls, 2);
} finally { globalThis.fetch = originalFetch; }
console.log("NPC suggestions: visual reference + full mechanical sheet, private permissions, structured advisory output, isolated drafts, unchanged KV/R2, stale reports, deduplication, failure recovery and separate quota passed.");

// Exercise failure handling through real routes and Durable Object alarm, not paid APIs.
env.ABILITY_MONTHLY_LIMIT = "100";
const beforeSimple = [...kv.entries()];
let simpleCalls = 0;
try {
  globalThis.fetch = async () => { simpleCalls++; return Response.json({status: "completed", output: [{content: [{type: "output_text", text: JSON.stringify(simpleAttack)}]}]}); };
  const response = await req(generation, {requestId: randomUUID(), details: "Attacco senza tiro salvezza", withIcon: false}, dm);
  assert.equal(response.status, 202);
  await coordinator.alarm();
  const generated = (await (await req(generation, undefined, dm)).json()).job;
  assert.equal(generated.status, "ready");
  assert.equal(generated.error, "");
  assert.equal(generated.draft.save.enabled, false);
  assert.equal(generated.draft.save.dc, 0);
  assert.equal(simpleCalls, 1);
  assert.deepEqual([...kv.entries()], beforeSimple);
} finally { globalThis.fetch = originalFetch; }
const completed = text => Response.json({status: "completed", output: [{content: [{type: "output_text", text}]}]});
const rejected = (status, code, param) => Response.json({error: {code, param, message: "fake-private-secret prompt must never leak"}}, {status, headers: {"x-request-id": "req_test_error"}});
const failureCases = [
  ["authentication", () => rejected(401, "invalid_api_key")],
  ["access_denied", () => rejected(403, "permission_denied")],
  ["model_unavailable", () => rejected(404, "model_not_found", "model")],
  ["quota", () => rejected(429, "insufficient_quota")],
  ["rate_limit", () => rejected(429, "rate_limit_exceeded")],
  ["request_invalid", () => rejected(400, "invalid_json_schema", "text.format.schema")],
  ["service_error", () => rejected(500, "server_error")],
  ["response_invalid", () => new Response("fake-private-secret", {status: 200})],
  ["output_limit", () => Response.json({status: "incomplete", incomplete_details: {reason: "max_output_tokens"}})],
  ["response_incomplete", () => Response.json({status: "failed", error: {message: "fake-private-secret"}})],
  ["refused", () => Response.json({status: "completed", output: [{content: [{type: "refusal", refusal: "fake-private-secret"}]}]})],
  ["output_empty", () => Response.json({status: "completed", output: []})],
  ["output_json", () => completed("fake-private-secret invalid JSON")],
  ["validation", () => completed(JSON.stringify({...draft, save: {...draft.save, dc: 0}}))],
  ["timeout", () => { throw new DOMException("fake-private-secret", "TimeoutError"); }],
  ["network", () => { throw new TypeError("fake-private-secret"); }]
];
const beforeFailures = [...kv.entries()], mediaBeforeFailures = [...objects.keys()];
try {
  for (const [code, result] of failureCases) {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return result(); };
    const requestId = randomUUID();
    const response = await req(generation, {requestId, details: "Spada radiosa", withIcon: true}, dm);
    assert.equal(response.status, 202);
    await coordinator.alarm(); await coordinator.alarm();
    const failed = (await (await req(generation, undefined, dm)).json()).job;
    assert.equal(failed.errorDetail.code, code);
    assert.equal(failed.errorDetail.stage, "ability");
    assert.equal(failed.status, "uncertain");
    assert.equal(failed.draft, null);
    assert.ok(!JSON.stringify(failed).includes("fake-private-secret"));
    assert.match(failed.error, /Nessun tentativo automatico/);
    assert.equal(calls, 1, "no automatic retry or image call after a text failure");
    if (code === "validation") assert.match(failed.error, /CD: valore fuori intervallo/);
    if (code === "request_invalid") {
      assert.equal(failed.errorDetail.requestId, "req_test_error");
      assert.equal(failed.errorDetail.parameter, "text.format.schema");
      assert.equal(failed.errorDetail.providerCode, "invalid_json_schema");
    }
    assert.equal((await req(generation, {requestId, details: "Spada radiosa", withIcon: true}, dm)).status, 200);
    await coordinator.alarm(); assert.equal(calls, 1, "replaying the UUID only reads the failure");
  }
  assert.deepEqual([...kv.entries()], beforeFailures);
  assert.deepEqual([...objects.keys()], mediaBeforeFailures);
} finally { globalThis.fetch = originalFetch; }
console.log("Generation diagnostics: 16 real-route failure scenarios distinguished, safe metadata, no provider payload leakage, no automatic retries, no icon calls or data changes after failed proposals.");

const stopAbilityId = randomUUID();
await req(generation, {requestId: stopAbilityId, details: "Stop test", withIcon: false}, dm);
const beforeStopAbility = [...kv.entries()];
assert.equal((await req(`${generation}/${stopAbilityId}/stop`, {attemptId: stopAbilityId}, player)).status, 403);
assert.equal((await req(`${generation}/${stopAbilityId}/stop`, {attemptId: stopAbilityId}, null, sync)).status, 401);
assert.equal((await req(`${generation}/${stopAbilityId}/stop`, {attemptId: stopAbilityId}, dm)).status, 200);
assert.deepEqual([...kv.entries()], beforeStopAbility);
const page = await readFile(new URL("../assets/js/pages/managed-actor.js", import.meta.url), "utf8");
const sandbox = {console, URL, Set, Map, WeakMap, window: {CriptaApp: {onPageReady() {}}}};
vm.runInNewContext(page.replace(/\}\)\(\);\s*$/, `globalThis.api = {renderManagedItemCreator, setActor(a) {currentDocument=a;}};})();`), sandbox);
sandbox.api.setActor({...actorInput, permissions: {isEditor: true}});
assert.match(sandbox.api.renderManagedItemCreator("Capacità"), /data-managed-generate-ability/);
assert.match(sandbox.api.renderManagedItemCreator("Capacità"), /data-managed-suggest-npc/);
assert.ok(!sandbox.api.renderManagedItemCreator("Inventario").includes("data-managed-generate-ability"));
sandbox.api.setActor({...actorInput, permissions: {isEditor: false}});
assert.ok(!sandbox.api.renderManagedItemCreator("Capacità").includes("data-managed-generate-ability"));
assert.ok(!sandbox.api.renderManagedItemCreator("Capacità").includes("data-managed-suggest-npc"));
console.log("Ability generation: schema/compiler, real Worker routes, permissions, quotas, private drafts, reference, icon failure/retry, preservation, stale checks and idempotent confirmation passed; no paid calls.");
