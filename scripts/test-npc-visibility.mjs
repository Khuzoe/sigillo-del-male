import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import worker from "../workers/main-worker/src/index.js";

const store = new Map();
const secret = "npc-visibility-test";
const env = {
    INVENTORY_SYNC_SECRET: secret,
    SIGILLO_KV: {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, String(value)); },
        async delete(key) { store.delete(key); }
    }
};
const actorPath = "api/managed-actors/test-world/test-npc";
const headers = { "Content-Type": "application/json", "X-Cripta-Inventory-Secret": secret, "X-Khuzoe-Sync-Contract": "1", "X-Khuzoe-Foundry-Generation": "14" };
async function request(path, body, authenticated = true) {
    return worker.fetch(new Request(`https://worker.test/${path}?campaign=test-campaign`, {
        headers: authenticated ? headers : { "Content-Type": "application/json" },
        ...(body ? { method: "POST", body: JSON.stringify(body) } : {})
    }), env);
}
const created = await request(actorPath, {
    expectedRevision: 0, name: "NPC di prova", actorType: "npc",
    visibility: { state: "dm" }, definition: { attributes: { hp: { max: 42 } } },
    contract: { name: "khuzoe-wiki-sync", version: 1, module: { id: "cripta-wiki-sync", version: "0.10.8" }, foundry: { generation: 14 }, system: { id: "dnd5e", version: "5.3.3" } }
});
assert.equal(created.status, 200);
const initialProfile = await request(`${actorPath}/profile`, {
    expectedRevision: 0,
    data: { role: "Custode", visibility: { state: "dm" }, blocks: [
        { id: "public", type: "lore", title: "Storia", text: "Racconto pubblico", visibility: "public", image: "ritratto.webp" },
        { id: "secret", type: "secret_dossier", title: "Segreto", text: "Nota riservata", visibility: "dm" }
    ] }
});
assert.equal(initialProfile.status, 200);
const baseline = (await initialProfile.json()).data;
const actorBefore = (await (await request(actorPath)).json()).data;
const posts = [];
let hasToken = true;
const context = {
    console, URL, URLSearchParams, structuredClone,
    window: {
        CriptaDiscordAuth: { getToken: () => hasToken ? "test-token" : "" },
        CriptaApp: {
            onPageReady() {},
            api: {
                clearCache() {},
                async post(path, body) {
                    posts.push(structuredClone(body));
                    const response = await request(path, body);
                    const result = await response.json();
                    if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
                    return result;
                }
            }
        }
    }
};
vm.runInNewContext(await readFile(new URL("../assets/js/pages/npcs.js", import.meta.url), "utf8"), context);
const npc = { name: "NPC di prova", managedActorWorldId: "test-world", managedActorId: "test-npc", managedProfileRevision: 1, managedProfileCanEdit: true, managedProfileVisibility: "dm", managedStatsVisibility: "dm", hidden: true };
assert.equal((await request(`${actorPath}/profile`, null, false)).status, 403);
await context.setNpcDossierVisibility(npc, true);
assert.deepEqual(posts[0], { expectedRevision: 1, data: { visibility: { state: "public" } } }, "only dossier visibility is sent");
assert.equal(npc.managedProfileVisibility, "public");
assert.equal(npc.managedProfileRevision, 2);
assert.equal(npc.hidden, false);
const publicProfile = await request(`${actorPath}/profile`, null, false);
assert.equal(publicProfile.status, 200);
assert.deepEqual((await publicProfile.json()).data.blocks.map(block => block.id), ["public"], "public readers cannot see DM chapters");
const saved = (await (await request(`${actorPath}/profile`)).json()).data;
assert.deepEqual(saved.blocks, baseline.blocks, "images, text and chapter permissions survive");
assert.equal(saved.role, baseline.role);
assert.deepEqual((await (await request(actorPath)).json()).data, actorBefore, "statistics and actor access are unchanged");
await context.setNpcDossierVisibility(npc, false);
assert.equal(npc.managedProfileRevision, 3);
assert.equal(npc.hidden, true);
assert.equal((await request(`${actorPath}/profile`, null, false)).status, 403, "DM-only dossier rejects anonymous readers");
await request(`${actorPath}/profile`, { expectedRevision: 3, data: { quote: "Modifica concorrente" } });
const beforeConflict = structuredClone(npc);
await assert.rejects(context.setNpcDossierVisibility(npc, true), error => error.status === 409);
assert.deepEqual(npc, beforeConflict, "conflict leaves the displayed state unchanged");
const postCount = posts.length;
hasToken = false;
await assert.rejects(context.setNpcDossierVisibility(npc, true), /Accedi/);
await assert.rejects(context.setNpcDossierVisibility({ ...npc, managedProfileCanEdit: false }, true), /Permesso/);
assert.equal(posts.length, postCount, "read-only users and expired sessions cannot send writes");
const unauthorized = await request(`${actorPath}/profile`, { expectedRevision: 4, data: { visibility: { state: "public" } } }, false);
assert.ok([401, 403].includes(unauthorized.status), "server rejects unauthenticated writes");
console.log("NPC dossier visibility: partial saves, permissions, public filtering, revisions and conflicts passed.");
