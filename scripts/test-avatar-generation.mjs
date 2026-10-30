import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import worker from "../workers/main-worker/src/index.js";
import { AvatarGenerationStore, AVATAR_STYLE, AVATAR_MODEL, avatarReferenceKey, webpSize } from "../workers/main-worker/src/avatar-generation.js";

class Storage {
    values = new Map();
    async get(key) { return structuredClone(this.values.get(key)); }
    async put(key, value) {
        if (typeof key === "object") { for (const [k, v] of Object.entries(key)) await this.put(k, v); return; }
        this.values.set(key, structuredClone(value));
    }
    async delete(key) { this.values.delete(key); }
    async setAlarm(time) { this.alarm = time; }
    async deleteAlarm() { this.alarm = null; }
    async transaction(fn) { return fn(this); }
}
const objects = new Map(), kv = new Map();
const bucket = {
    async head(key) { return objects.has(key) ? { size: objects.get(key).byteLength } : null; },
    async get(key) {
        if (!objects.has(key)) return null;
        const bytes = objects.get(key);
        return { size: bytes.byteLength, body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.slice().buffer, writeHttpMetadata: (headers) => headers.set("Content-Type", "image/webp") };
    },
    async put(key, body) { objects.set(key, new Uint8Array(await new Response(body).arrayBuffer())); },
    async delete() { assert.fail("No existing R2 object should be deleted"); },
};
const storage = new Storage();
const env = {
    JWT_SECRET: "avatar-test-secret", GLOBAL_ADMIN_ACCOUNT_IDS: "admin",
    GLOBAL_ADMIN_DEVICE_CODE: "AVATAR-ADMIN-TEST-VERY-STRONG-2026",
    DEVICE_LOGIN_CODES_SECRET: "PLAYER-AVATAR-TEST||player|Player;DM-AVATAR-TEST||dungeon-master|DM",
    CAMPAIGN_EDITOR_ACCOUNT_IDS: "cripta-di-sangue:dungeon-master",
    INVENTORY_SYNC_SECRET: "foundry-test", OPENAI_API_KEY: "fake-key-no-live-api",
    AVATAR_MONTHLY_LIMIT: "20", MEDIA_BUCKET: bucket,
    SIGILLO_KV: { async get(key) { return kv.get(key) ?? null; }, async put(key, value) { kv.set(key, value); }, async delete(key) { kv.delete(key); } },
};
let coordinator = new AvatarGenerationStore({ storage }, env);
env.AVATAR_GENERATOR = { idFromName: (name) => name, get: () => ({ fetch: (req) => coordinator.fetch(req) }) };
const campaign = "cripta-di-sangue", path = "api/managed-actors/test-world/test-npc", generation = `${path}/avatar-generation`;
async function req(url, body, token, extraHeaders = {}, targetCampaign = campaign) {
    return worker.fetch(new Request(`https://worker.test/${url}?campaign=${targetCampaign}`, {
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
        ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    }), env, { waitUntil(promise) { promise.catch(() => {}); } });
}
async function login(code) {
    const response = await req("auth/device/login", { code, campaignId: campaign });
    assert.equal(response.status, 200);
    return (await response.json()).token;
}
const admin = await login("AVATAR-ADMIN-TEST-VERY-STRONG-2026"), player = await login("PLAYER-AVATAR-TEST"), dm = await login("DM-AVATAR-TEST");
const syncHeaders = { "X-Cripta-Inventory-Secret": env.INVENTORY_SYNC_SECRET, "X-Khuzoe-Sync-Contract": "1", "X-Khuzoe-Foundry-Generation": "14" };
const referenceKey = `campaigns/${campaign}/managed-actors/test-world/test-npc/base/avatar-1.webp`;
const webp = new Uint8Array(30);
webp.set(Buffer.from("RIFF")); new DataView(webp.buffer).setUint32(4, 22, true);
webp.set(Buffer.from("WEBPVP8X"), 8); new DataView(webp.buffer).setUint32(16, 10, true);
webp[24] = 15; webp[25] = 5; webp[27] = 255; webp[28] = 8; // 1296 × 2304, container fixture.
objects.set(referenceKey, webp);
const actorInput = {
    name: "Custode", actorType: "npc", schemaVersion: 3, ownerAccountIds: ["player"], visibility: { state: "public" },
    definition: { attributes: { hp: { max: 42 } }, items: [{ id: "spell", name: "Incantesimo" }] },
    media: { avatar: { path: referenceKey, source: "foundry", revision: 1 }, token: { path: referenceKey }, variants: [{ id: "other", path: referenceKey }] },
    contract: { name: "khuzoe-wiki-sync", version: 1, module: { id: "cripta-wiki-sync", version: "0.11.12" }, foundry: { generation: 14 }, system: { id: "dnd5e", version: "5.3.3" } },
};
assert.equal((await req(path, actorInput, null, syncHeaders)).status, 200);
assert.equal((await req(`${path}/profile`, { expectedRevision: 0, data: { visibility: { state: "public" }, blocks: [{ id: "story", type: "lore", title: "Storia", text: "Dossier conservato", visibility: "public" }] } }, dm)).status, 200);
const readActor = async () => (await (await req(path, undefined, admin)).json()).data;
const baseline = await readActor();
assert.ok([401, 403].includes((await req(generation)).status));
assert.equal((await req(generation, undefined, player)).status, 403, "NPC owner cannot spend the generation budget");
assert.equal((await req(generation, undefined, null, syncHeaders)).status, 401, "Foundry sync secret does not authorize paid API requests");
assert.equal((await req(generation, undefined, dm, {}, "mago-folle")).status, 403, "DM permission is scoped to its campaign");
assert.equal((await req(generation, undefined, dm)).status, 200);
const emptyStatus = await (await req(generation, undefined, admin)).json();
assert.equal(emptyStatus.enabled, true);
assert.equal(emptyStatus.optionsVersion, 1, "frontend can detect an older Worker that would ignore selected settings");
assert.equal(emptyStatus.style, AVATAR_STYLE);
assert.equal(emptyStatus.job, null);
delete env.OPENAI_API_KEY;
assert.equal((await req(generation, { requestId: randomUUID(), details: "" }, dm)).status, 503);
env.OPENAI_API_KEY = "fake-key-no-live-api";
assert.equal((await req(generation, { requestId: randomUUID(), details: "x".repeat(1501) }, dm)).status, 400);
for (const options of [{ quality: "max" }, { resolution: "4k" }, { quality: 1 }, { resolution: {} }]) {
    assert.equal((await req(generation, { requestId: randomUUID(), details: "", ...options }, dm)).status, 400, "unsupported settings cannot spend quota");
}
assert.equal(avatarReferenceKey("http://localhost/private.png", campaign), "");
assert.equal(avatarReferenceKey("campaigns/other/npcs/image.webp", campaign), "");
assert.equal(avatarReferenceKey("campaigns/cripta-di-sangue/../secret.webp", campaign), "");
assert.equal(avatarReferenceKey(`https://worker.test/media/${referenceKey}?v=2`, campaign), referenceKey);
assert.equal(avatarReferenceKey("players/portrait.webp", campaign), `campaigns/${campaign}/players/portrait.webp`);
assert.deepEqual(webpSize(webp), { width: 1296, height: 2304 });
assert.equal(webpSize(new Uint8Array(50)), null);

const id = randomUUID();
const attempts = await Promise.all(Array.from({ length: 4 }, () => req(generation, { requestId: id, details: "Un mantello rosso" }, dm)));
assert.ok(attempts.every((response) => response.ok), "simultaneous duplicate submission succeeds idempotently");
assert.equal(storage.values.get(`usage:${new Date().toISOString().slice(0, 7)}`), 1);
const concurrent = await (await req(generation, { requestId: randomUUID(), details: "Different" }, dm)).json();
assert.equal(concurrent.job.id, id, "same NPC reuses its active job even from a second tab");
assert.equal((await req(`${generation}/${id}/confirm`, {}, dm)).status, 409);
assert.deepEqual(await readActor(), baseline, "generation start never changes the NPC");

let calls = 0, captured;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/images/edits");
    calls++;
    captured = JSON.parse(options.body);
    return Response.json({ data: [{ b64_json: Buffer.from(webp).toString("base64") }] });
};
try {
    await coordinator.alarm();
    assert.equal(calls, 1);
    assert.equal(captured.model, AVATAR_MODEL);
    assert.equal(captured.n, 1);
    assert.equal(captured.size, "1296x2304");
    assert.equal(captured.quality, "high");
    assert.equal(captured.output_format, "webp");
    assert.ok(captured.prompt.endsWith(AVATAR_STYLE));
    assert.ok(captured.prompt.includes("Un mantello rosso"));
    assert.equal(captured.images[0].image_url, `data:image/webp;base64,${Buffer.from(webp).toString("base64")}`);
    await coordinator.alarm();
    assert.equal(calls, 1, "repeated alarm cannot repeat the paid call");
    assert.equal((await (await req(generation, undefined, dm)).json()).job.status, "ready");
    assert.deepEqual(await readActor(), baseline, "ready image remains a draft");
    assert.equal((await req(`${generation}/${id}/preview`, undefined, dm)).status, 200);
    assert.equal((await req(`${generation}/${id}/preview`, undefined, player)).status, 403);
    assert.equal((await req(`media/_private/ai-avatars/${id}.webp`)).status, 400, "draft is not served by public media API");
    const accepted = await req(`${generation}/${id}/confirm`, {}, dm);
    assert.equal(accepted.status, 200, await accepted.clone().text());
    const saved = await readActor();
    assert.ok(saved.media.avatar.path.endsWith(`avatar-ai-${id}.webp`));
    assert.ok(saved.media.avatar.path.startsWith("media/campaigns/"), "confirmation returns a site media path, never a raw R2 key");
    assert.ok(objects.has(saved.media.avatar.path.slice("media/".length)), "R2 stores the key without the media route prefix");
    const servedImage = await req(saved.media.avatar.path);
    assert.equal(servedImage.status, 200, "the exact returned image path is publicly loadable");
    assert.equal(servedImage.headers.get("content-type"), "image/webp");
    const savedProfile = (await (await req(`${path}/profile`)).json()).data;
    assert.equal(savedProfile.media.avatar.path, saved.media.avatar.path, "public dossier retains the confirmed avatar");
    assert.equal(saved.media.avatar.source, "site");
    assert.equal(saved.media.avatar.revision, 2);
    assert.deepEqual(saved.visibility, baseline.visibility);
    assert.deepEqual(saved.definition, baseline.definition);
    assert.deepEqual(saved.media.token, baseline.media.token);
    assert.deepEqual(saved.media.variants, baseline.media.variants);
    assert.ok(saved.site.avatarHistory.some((entry) => entry.path === referenceKey));
    assert.ok(objects.has(referenceKey));
    const cleanup = [...kv.entries()].find(([key]) => key.includes("media-cleanup"));
    assert.ok(!cleanup || !JSON.parse(cleanup[1]).pending?.some((entry) => entry.key === referenceKey));
    assert.equal((await req(`${generation}/${id}/confirm`, {}, dm)).status, 200);
    assert.equal((await readActor()).revision, saved.revision, "reconfirm is a no-op");
    assert.equal(calls, 1);

    // Reproduce the first released format: raw key on actor/index and null avatar on dossier.
    const actorKey = `campaign:${campaign}:managed-actor:test-world:test-npc`;
    const profileKey = `campaign:${campaign}:managed-actor-profile:test-world:test-npc`;
    const indexKey = `campaign:${campaign}:managed-actors:index`;
    // Complete the unrelated, existing one-time index metadata initialization first.
    await req("api/managed-actors", undefined, dm);
    const legacyActor = JSON.parse(kv.get(actorKey));
    legacyActor.media.avatar.path = saved.media.avatar.path.slice(6);
    kv.set(actorKey, JSON.stringify(legacyActor));
    const legacyProfile = JSON.parse(kv.get(profileKey));
    legacyProfile.media.avatar = null;
    kv.set(profileKey, JSON.stringify(legacyProfile));
    const legacyIndex = JSON.parse(kv.get(indexKey));
    legacyIndex.data.find((entry) => entry.actorId === "test-npc").media.avatar.path = legacyActor.media.avatar.path;
    kv.set(indexKey, JSON.stringify(legacyIndex));
    // Read repair must be non-destructive and also usable by Foundry's sync reader.
    const kvBeforeRecovery = new Map(kv);
    assert.equal((await readActor()).media.avatar.path, saved.media.avatar.path);
    assert.equal((await (await req(path, undefined, null, syncHeaders)).json()).data.media.avatar.path, saved.media.avatar.path);
    const recoveredProfile = (await (await req(`${path}/profile`)).json()).data;
    assert.equal(recoveredProfile.media.avatar.path, saved.media.avatar.path);
    assert.deepEqual(recoveredProfile.blocks, savedProfile.blocks);
    const recoveredDirectory = (await (await req("api/managed-actors", undefined, dm)).json()).data;
    assert.equal(recoveredDirectory.find((entry) => entry.actorId === "test-npc").media.avatar.path, saved.media.avatar.path);
    assert.deepEqual(kv, kvBeforeRecovery, "recovering existing avatars in reads does not rewrite KV");
    assert.equal((await req(`${generation}/${id}/confirm`, {}, dm)).status, 200, "old accepted jobs can repair their stored path without regeneration");
    assert.equal(JSON.parse(kv.get(actorKey)).media.avatar.path, saved.media.avatar.path);
    assert.equal(calls, 1, "path repair never calls the paid provider");
    const recoveredActor = await readActor();
    const preserved = await req(path, { ...recoveredActor, expectedRevision: recoveredActor.revision, site: { label: "Normal edit without history" } }, dm);
    assert.equal(preserved.status, 200);
    const edited = await readActor();
    assert.ok(edited.site.avatarHistory.some((entry) => entry.path === referenceKey), "ordinary saves cannot discard avatar history");

    const second = randomUUID();
    await req(generation, { requestId: second, details: "Altra posa" }, dm);
    await coordinator.alarm();
    assert.equal(calls, 2);
    assert.equal((await req(path, { ...edited, expectedRevision: edited.revision, media: { avatar: { ...edited.media.avatar, path: referenceKey, revision: 3 } } }, dm)).status, 200);
    assert.equal((await req(`${generation}/${second}/confirm`, {}, dm)).status, 409, "a stale draft cannot overwrite a subsequently changed portrait");

    const crashId = randomUUID();
    await req(generation, { requestId: crashId, details: "" }, dm);
    const crashJob = await storage.get(`job:${crashId}`);
    crashJob.status = "running";
    await storage.put(`job:${crashId}`, crashJob);
    coordinator = new AvatarGenerationStore({ storage }, env);
    await coordinator.alarm();
    assert.equal((await storage.get(`job:${crashId}`)).status, "uncertain");
    assert.equal(calls, 2, "a restarted coordinator never repeats a possibly paid request");
    assert.equal(await storage.get("active"), undefined);

    const refused = randomUUID();
    await req(generation, { requestId: refused, details: "" }, dm);
    globalThis.fetch = async () => { calls++; return Response.json({ error: { message: "secret provider internals" } }, { status: 400 }); };
    await coordinator.alarm();
    const failed = (await (await req(generation, undefined, dm)).json()).job;
    assert.equal(failed.status, "failed");
    assert.ok(!failed.error.includes("secret provider"));
    await coordinator.alarm();
    assert.equal(calls, 3);

    env.AVATAR_MONTHLY_LIMIT = "4";
    assert.equal((await req(generation, { requestId: randomUUID(), details: "" }, dm)).status, 429);
    assert.equal(calls, 3, "quota rejection does not call the provider");

    env.AVATAR_MONTHLY_LIMIT = "20";
    for (const quality of ["medium", "high"]) for (const resolution of ["medium", "high"]) {
        const requestId = randomUUID();
        const dimensions = resolution === "medium" ? { width: 864, height: 1536 } : { width: 1296, height: 2304 };
        const output = webp.slice();
        for (let byte = 0; byte < 3; byte++) {
            output[24 + byte] = ((dimensions.width - 1) >>> (byte * 8)) & 255;
            output[27 + byte] = ((dimensions.height - 1) >>> (byte * 8)) & 255;
        }
        globalThis.fetch = async (_url, options) => {
            calls++;
            const body = JSON.parse(options.body);
            assert.equal(body.quality, quality);
            assert.equal(body.size, `${dimensions.width}x${dimensions.height}`);
            assert.equal(body.model, AVATAR_MODEL);
            return Response.json({ data: [{ b64_json: Buffer.from(output).toString("base64") }] });
        };
        const started = await req(generation, { requestId, details: "", quality, resolution }, dm);
        assert.equal(started.status, 202);
        assert.deepEqual((await started.json()).job.options, { quality, resolution });
        // Retried submissions must retain the settings of the original request.
        const duplicate = await req(generation, { requestId, details: "", quality: "high", resolution: "high" }, dm);
        assert.deepEqual((await duplicate.json()).job.options, { quality, resolution });
        coordinator = new AvatarGenerationStore({ storage }, env);
        await coordinator.alarm();
        const resumed = (await (await req(generation, undefined, dm)).json()).job;
        assert.equal(resumed.status, "ready");
        assert.deepEqual(resumed.options, { quality, resolution });
    }
    assert.equal(calls, 7, "all four quality/resolution combinations use one provider call each");
} finally { globalThis.fetch = originalFetch; }
console.log("Avatar generation: permissions, reference, fixed style/format, idempotency, recovery, quota, private preview, explicit confirmation and data preservation passed (no real API calls).");

// Exercise the actual appearance panel, not the obsolete standalone media renderer.
const frontendSource = await readFile(new URL("../assets/js/pages/managed-actor.js", import.meta.url), "utf8");
const frontend = { window: { CriptaApp: { onPageReady() {}, utils: { resolveImageUrl: (path) => path } } } };
vm.runInNewContext(frontendSource.replace(/\}\)\(\);\s*$/, `
    globalThis.renderAppearance = (actor) => { currentDocument = actor; return renderAdmin(actor); };
    globalThis.renderPortraitAction = (actor) => { currentDocument = actor; return renderManagedAvatarGenerateAction(actor.media?.avatar); };
    globalThis.bindGenerator = setupManagedAvatarGenerator;
})();`), frontend);
const editorActor = { actorType: "npc", media: { avatar: { path: referenceKey } }, permissions: { isEditor: true } };
const appearance = frontend.renderAppearance(editorActor);
assert.equal((appearance.match(/data-managed-generate-avatar(?:\s|>)/g) || []).length, 1, "real appearance editor includes exactly one generation button");
assert.match(appearance, /data-managed-generate-avatar\s*>/, "generation is enabled with a reference image");
assert.match(frontend.renderAppearance({ ...editorActor, media: {} }), /data-managed-generate-avatar disabled/, "without a reference image the button is visible but disabled");
assert.doesNotMatch(frontend.renderAppearance({ ...editorActor, permissions: { isEditor: false, isOwner: true } }), /data-managed-generate-avatar/, "companion ownership alone does not show generation");
assert.doesNotMatch(frontend.renderAppearance({ ...editorActor, actorType: "character" }), /data-managed-generate-avatar/, "generation is limited to NPCs");
const portraitAction = frontend.renderPortraitAction(editorActor);
assert.ok(appearance.includes(portraitAction), "portrait and editor use the exact same button markup and CSS class");
const buttons = [0, 1].map(() => ({ addEventListener(event, fn) { assert.equal(event, "click"); this.click = fn; }, closest() { return { querySelector: () => ({ textContent: "" }) }; } }));
let opened = 0;
frontend.window.CriptaAvatarGenerator = { open: (options) => { opened++; assert.equal(options.actor, editorActor); } };
frontend.bindGenerator({ querySelectorAll: () => buttons });
buttons.forEach((button) => button.click());
assert.equal(opened, 2, "both entry points are wired, not just the first button");
console.log("Avatar editor integration: actual appearance panel, reference availability and permission gates passed.");
