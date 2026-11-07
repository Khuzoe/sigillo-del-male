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

// The roster shortcuts use the same partial profile API. Exercise them against
// the real worker to catch accidental replacement of dossier content or access.
vm.runInNewContext(await readFile(new URL("../assets/js/shared/npc-categories.js", import.meta.url), "utf8"), context);
hasToken = true;
const registry = { categories: [
    { id: "alleati", name: "Alleati", order: 10, color: "#112233", icon: "fa-users", rosterSection: "npc" },
    { id: "custodi", name: "Custodi", parentId: "alleati", order: 20, color: "#445566", icon: "fa-shield", rosterSection: "other" }
] };
assert.equal((await request("api/npc-categories", { expectedRevision: 0, ...registry })).status, 200);
const withNotes = await request(`${actorPath}/profile`, {
    expectedRevision: 4,
    data: { status: "Scomparso dopo la battaglia", tags: ["custode"], media: { idle: { path: "ritratto-originale.webp" } } }
});
assert.equal(withNotes.status, 200);
const rosterBaseline = (await withNotes.json()).data;
npc.managedProfileRevision = rosterBaseline.revision;
npc.kind = "person";
await context.setNpcCategory(npc, "custodi", registry);
assert.deepEqual(posts.at(-1).data, { categoryId: "custodi", category: "Custodi" });
assert.equal(npc.categoryParent, "Alleati");
assert.equal(npc.categorySubcategoryId, "custodi");
assert.equal(npc.categoryRosterSection, "other");
for (const [state, status] of [["alive", "vivo"], ["unknown", "ignoto"], ["dead", "morto"], ["none", ""]]) {
    const revision = npc.managedProfileRevision;
    await context.setNpcLifeState(npc, state);
    assert.deepEqual(posts.at(-1), { expectedRevision: revision, data: { lifeState: state } });
    assert.equal(npc.lifeState, state);
    assert.equal(npc.status, status);
    assert.equal(npc.managedProfileRevision, revision + 1);
    const profile = (await (await request(`${actorPath}/profile`)).json()).data;
    assert.equal(profile.categoryId, "custodi", "state changes keep the selected subcategory");
    for (const field of ["blocks", "media", "role", "tags", "status", "visibility"]) {
        assert.deepEqual(profile[field], rosterBaseline[field], `${field} survives quick state changes`);
    }
}
await context.setNpcCategory(npc, "", registry);
assert.deepEqual(posts.at(-1).data, { categoryId: "", category: "" });
assert.equal(npc.categoryId, "");
assert.equal(npc.categoryParent, "");
assert.equal(npc.categoryGroupId, "");
assert.equal(npc.categoryRosterSection, "npc");
const ungrouped = (await (await request(`${actorPath}/profile`)).json()).data;
assert.equal(ungrouped.categoryId, "");
assert.equal(ungrouped.lifeState, "none", "moving categories preserves the chosen life state");
assert.deepEqual(ungrouped.blocks, rosterBaseline.blocks);
await context.setNpcDossierVisibility(npc, true);
const beforeArchive = (await (await request(`${actorPath}/profile`)).json()).data;
assert.equal((await request(`${actorPath}/profile`, null, false)).status, 200);
for (const state of ["archived", "active"]) {
    const revision = npc.managedProfileRevision;
    await context.setNpcLifecycle(npc, state);
    assert.deepEqual(posts.at(-1), { expectedRevision: revision, data: { lifecycle: { state } } }, "archive shortcuts only change the lifecycle");
    assert.equal(npc.archived, state === "archived");
    const savedProfile = (await (await request(`${actorPath}/profile`)).json()).data;
    assert.equal(savedProfile.lifecycle.state, state);
    for (const [field, value] of Object.entries(beforeArchive)) {
        if (["lifecycle", "revision", "updatedAt", "updatedBy"].includes(field)) continue;
        assert.deepEqual(savedProfile[field], value, `${field} survives archiving and restoring`);
    }
    const publicRead = await request(`${actorPath}/profile`, null, false);
    if (state === "archived") {
        assert.ok([403, 404].includes(publicRead.status), "archived dossiers are hidden from public readers");
        assert.ok(savedProfile.lifecycle.archivedAt, "archive timestamp is recorded");
    } else {
        assert.equal(publicRead.status, 200, "restoring preserves the previous public visibility");
        assert.equal(savedProfile.lifecycle.archivedAt, null);
    }
}
const beforeRejectedPosts = posts.length;
await assert.rejects(context.setNpcLifeState({ ...npc, managedProfileCanEdit: false }, "alive"), /Permesso/);
await assert.rejects(context.setNpcCategory({ ...npc, managedProfileCanEdit: false }, "custodi", registry), /Permesso/);
await assert.rejects(context.setNpcLifeState(npc, "invalid"), /Stato non valido/);
await assert.rejects(context.setNpcCategory(npc, "missing", registry), /Categoria non disponibile/);
await assert.rejects(context.setNpcLifecycle({ ...npc, managedProfileCanEdit: false }, "archived"), /Permesso/);
await assert.rejects(context.setNpcLifecycle(npc, "deleted"), /Stato archivio non valido/);
assert.equal(posts.length, beforeRejectedPosts);
await request(`${actorPath}/profile`, { expectedRevision: npc.managedProfileRevision, data: { quote: "Altro DM al lavoro" } });
const beforeQuickConflict = structuredClone(npc);
await assert.rejects(context.setNpcLifeState(npc, "alive"), error => error.status === 409);
await assert.rejects(context.setNpcCategory(npc, "custodi", registry), error => error.status === 409);
await assert.rejects(context.setNpcLifecycle(npc, "archived"), error => error.status === 409);
assert.deepEqual(npc, beforeQuickConflict, "conflicts leave both shortcuts unchanged");
assert.deepEqual((await (await request(actorPath)).json()).data, actorBefore, "roster shortcuts preserve the Foundry actor document");
console.log("NPC roster shortcuts: states, nested categories, archive/restore, dossier preservation, permissions and conflicts passed.");

const bulkNpcs = [];
const bulkActors = new Map();
for (const id of ["bulk-a", "bulk-b", "bulk-c"]) {
    const path = `api/managed-actors/test-world/${id}`;
    const createdActor = await request(path, {
        expectedRevision: 0, name: id, actorType: "npc", visibility: { state: "dm" },
        definition: { attributes: { hp: { max: 42 } } },
        contract: { name: "khuzoe-wiki-sync", version: 1, module: { id: "cripta-wiki-sync", version: "0.10.8" }, foundry: { generation: 14 }, system: { id: "dnd5e", version: "5.3.3" } }
    });
    assert.equal(createdActor.status, 200);
    bulkActors.set(id, (await (await request(path)).json()).data);
    const profile = await request(`${path}/profile`, {
        expectedRevision: 0, data: { role: `Ruolo ${id}`, lifeState: "alive", visibility: { state: "public" }, blocks: baseline.blocks }
    });
    assert.equal(profile.status, 200);
    bulkNpcs.push({ name: id, kind: "person", managedActorWorldId: "test-world", managedActorId: id, managedProfileRevision: 1, managedProfileCanEdit: true });
}
await request("api/managed-actors/test-world/bulk-b/profile", { expectedRevision: 1, data: { quote: "Modifica concorrente da conservare" } });
const progress = [];
const bulkMoved = await context.saveNpcBulkChanges([bulkNpcs[0], bulkNpcs[0], bulkNpcs[1], bulkNpcs[2]],
    entry => context.setNpcCategory(entry, "custodi", registry), ({ completed, total }) => {
        progress.push([completed, total]);
        assert.ok(bulkNpcs.every(entry => entry.profileSaving), "the full selection stays locked until the batch ends");
    });
assert.deepEqual(Array.from(bulkMoved.succeeded, entry => entry.name), ["bulk-a", "bulk-c"]);
assert.equal(bulkMoved.failed.length, 1);
assert.equal(bulkMoved.failed[0].npc.name, "bulk-b");
assert.equal(bulkMoved.failed[0].error.status, 409);
assert.deepEqual(progress, [[0, 3], [1, 3], [2, 3], [3, 3]], "duplicates are saved once and progress includes failures");
assert.ok(bulkNpcs.every(entry => entry.profileSaving === false), "batch locks are released after partial failure");
for (const entry of bulkNpcs) {
    const saved = (await (await request(`api/managed-actors/test-world/${entry.managedActorId}/profile`)).json()).data;
    assert.deepEqual(saved.blocks, baseline.blocks);
    assert.equal(saved.role, `Ruolo ${entry.name}`);
    assert.equal(saved.lifeState, "alive");
    if (entry.name === "bulk-b") {
        assert.equal(saved.quote, "Modifica concorrente da conservare");
        assert.equal(saved.categoryId, "");
        entry.managedProfileRevision = saved.revision;
    } else {
        assert.equal(saved.categoryId, "custodi");
        assert.equal(entry.managedProfileRevision, 2);
    }
}
for (const lifecycle of ["archived", "active"]) {
    const result = await context.saveNpcBulkChanges(bulkNpcs, entry => context.setNpcLifecycle(entry, lifecycle));
    assert.equal(result.succeeded.length, 3);
    assert.equal(result.failed.length, 0);
    assert.ok(bulkNpcs.every(entry => entry.archived === (lifecycle === "archived")));
}
const postsBeforeRejectedBulk = posts.length;
const readOnlyBulk = await context.saveNpcBulkChanges([{ ...bulkNpcs[0], managedProfileCanEdit: false }], entry => context.setNpcLifecycle(entry, "archived"));
assert.equal(readOnlyBulk.failed.length, 1);
assert.equal(posts.length, postsBeforeRejectedBulk);
bulkNpcs[0].profileSaving = true;
const busyBulk = await context.saveNpcBulkChanges([bulkNpcs[0]], entry => context.setNpcLifecycle(entry, "archived"));
assert.equal(busyBulk.failed.length, 1);
assert.equal(posts.length, postsBeforeRejectedBulk);
assert.equal(bulkNpcs[0].profileSaving, true, "an existing save lock belongs to the original operation");
bulkNpcs[0].profileSaving = false;
for (const entry of bulkNpcs) {
    const saved = (await (await request(`api/managed-actors/test-world/${entry.managedActorId}`)).json()).data;
    assert.deepEqual(saved, bulkActors.get(entry.managedActorId), "bulk operations preserve the entire Foundry actor document");
}
console.log("NPC bulk actions: category moves, archive/restore, deduplication, progress, partial conflicts, permissions and lock handling passed.");
