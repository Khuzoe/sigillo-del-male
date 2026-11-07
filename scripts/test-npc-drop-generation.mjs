import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import worker, { DropGenerationStore } from "../workers/main-worker/src/index.js";
import { ManagedActorTransaction } from "../workers/main-worker/src/managed-actor-store.js";
import { importManagedActorSql } from "./migrate-managed-actors-d1.mjs";

class Storage {
    data = new Map();
    async get(key) { return structuredClone(this.data.get(key)); }
    async put(key, value) {
        for (const [id, entry] of typeof key === "string" ? [[key, value]] : Object.entries(key)) this.data.set(id, structuredClone(entry));
    }
    async delete(key) { this.data.delete(key); }
    async setAlarm(time) { this.alarm = time; }
    async deleteAlarm() { this.alarm = null; }
    async transaction(fn) { return fn(this); }
}

const campaign = "cripta-di-sangue";
const actorPath = "api/managed-actors/world/golem";
const generation = actorPath + "/drop-generation";
const catalogKey = `campaign:${campaign}:data:items:override`;
const categoriesKey = `campaign:${campaign}:item-categories`;
const d1 = process.argv.includes("--d1");
const reference = `campaigns/${campaign}/managed-actors/world/golem/base/avatar.webp`;
const webp = new Uint8Array(30);
webp.set(Buffer.from("RIFF"));
new DataView(webp.buffer).setUint32(4, 22, true);
webp.set(Buffer.from("WEBPVP8X"), 8);
new DataView(webp.buffer).setUint32(16, 10, true);
webp.set([255, 3, 0, 255, 3, 0], 24);
const objects = new Map([[reference, webp]]);
const kv = new Map();
let rejectQueueWrite = false;
const env = {
    JWT_SECRET: "drop-test-secret", DEVICE_LOGIN_CODES_SECRET: "DROP-DM-TEST||drop-dm|DM;DROP-PLAYER-TEST||player|Player",
    CAMPAIGN_EDITOR_ACCOUNT_IDS: `${campaign}:drop-dm`, INVENTORY_SYNC_SECRET: "drop-foundry", OPENAI_API_KEY: "mock",
    MEDIA_BUCKET: {
        async head(key) { return objects.has(key) ? { size: objects.get(key).length } : null; },
        async get(key) {
            const bytes = objects.get(key);
            return bytes && { size: bytes.length, body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.slice().buffer };
        },
        async put(key, body) { objects.set(key, new Uint8Array(await new Response(body).arrayBuffer())); },
    },
    SIGILLO_KV: {
        async get(key, type) { const value = kv.get(key) ?? null; return type === "json" ? JSON.parse(value) : value; },
        async put(key, value) {
            if (rejectQueueWrite && key.includes("managed-actor-commands:")) {
                rejectQueueWrite = false;
                throw new Error("Simulated queue outage");
            }
            kv.set(key, value);
        },
    },
};
let originalCatalog;
if (d1) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    for (const migration of ["0004_managed_actors.sql", "0005_campaign_items.sql"]) {
        db.exec(await readFile(new URL("../workers/main-worker/migrations/" + migration, import.meta.url), "utf8"));
    }
    const initial = { id: "old-material", name: "Materiale preesistente 🐉", custom: { reference: "media/items/item.webp" } };
    originalCatalog = JSON.stringify({ campaignId: campaign, version: 9, data: [initial], custom: "conservato" }, null, 2) + "\n";
    kv.set(catalogKey, originalCatalog);
    const digest = createHash("sha256").update(originalCatalog).digest("hex");
    const manifest = { scope: "items", campaignId: campaign, migrationId: "test-items", createdAt: "2026-11-06", manifestSha256: digest,
        documents: [{ key: catalogKey, bytes: Buffer.byteLength(originalCatalog), sha256: digest, metadata: { retained: true } }] };
    const sql = importManagedActorSql(manifest, new Map([[catalogKey, originalCatalog]]));
    db.exec(sql);
    assert.equal(db.prepare("SELECT payload FROM managed_actor_documents WHERE document_key=?").get(catalogKey).payload, originalCatalog);
    assert.equal(db.prepare("SELECT payload FROM managed_actor_kv_original_chunks WHERE document_key=?").get(catalogKey).payload, originalCatalog);
    assert.equal(db.prepare("SELECT present FROM managed_actor_documents WHERE document_key=?").get(categoriesKey).present, 0);
    db.exec("UPDATE campaign_item_imports SET state='ready'");
    db.prepare("INSERT INTO managed_actor_imports VALUES (?, 'test-actors', 'ready', '2026-11-06', NULL, 0, 'test')").run(campaign);
    env.POLL_DB = {
        prepare(sqlText) {
            return { bind(...params) {
                const run = () => {
                    const statement = db.prepare(sqlText);
                    return { results: /^\s*SELECT/i.test(sqlText) ? statement.all(...params) : (statement.run(...params), []) };
                };
                return { run, sqlText, async first() { return run().results[0] || null; } };
            } };
        },
        async batch(statements) {
            db.exec("BEGIN");
            try {
                const results = statements.map(statement => {
                    if (rejectQueueWrite && /INSERT INTO managed_actor_commands\s*\(/i.test(statement.sqlText)) {
                        rejectQueueWrite = false;
                        throw new Error("Simulated queue write failure");
                    }
                    return statement.run();
                });
                db.exec("COMMIT");
                return results;
            } catch (error) { db.exec("ROLLBACK"); throw error; }
        },
    };
    env.MANAGED_ACTOR_D1_CAMPAIGNS = env.CAMPAIGN_ITEMS_D1_CAMPAIGNS = campaign;
    assert.equal(await new ManagedActorTransaction(env).get(catalogKey), originalCatalog);
    assert.equal(await new ManagedActorTransaction(env).get(categoriesKey), null);
}
const readDocument = key => d1 ? new ManagedActorTransaction(env).get(key) : kv.get(key) ?? null;
const storage = new Storage();
const store = new DropGenerationStore({ storage }, env);
env.DROP_GENERATOR = { idFromName: value => value, get: () => store };
const foundry = { "X-Cripta-Inventory-Secret": env.INVENTORY_SYNC_SECRET, "X-Khuzoe-Sync-Contract": "1", "X-Khuzoe-Foundry-Generation": "14" };
const contract = { name: "khuzoe-wiki-sync", version: 1, module: { id: "cripta-wiki-sync", version: "0.11.20" }, foundry: { generation: 14 }, system: { id: "dnd5e", version: "5.3.3" } };

function request(path, body, token, headers = {}, targetCampaign = campaign) {
    return worker.fetch(new Request(`https://worker.test/${path}?campaign=${targetCampaign}`, {
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    }), env, { waitUntil() {} });
}
async function login(code) {
    const response = await request("auth/device/login", { code, campaignId: campaign });
    assert.equal(response.status, 200);
    return (await response.json()).token;
}
const dm = await login("DROP-DM-TEST"), player = await login("DROP-PLAYER-TEST");
const actor = {
    name: "Golem di Ferro", actorType: "npc", schemaVersion: 3, visibility: { state: "public" }, ownerAccountIds: ["player"],
    definition: { items: [] }, media: { avatar: { path: `media/${reference}` } }, contract,
};
assert.equal((await request(actorPath, actor, null, foundry)).status, 200);
assert.equal((await request(generation, undefined, player)).status, 403);
assert.equal((await request(generation, undefined, dm, {}, "mago-folle")).status, 403);
const payload = { requestId: crypto.randomUUID(), names: ["Piastra di Ferro", "Nucleo del Golem", "Occhio del golem"] };
const start = await request(generation, payload, dm);
assert.equal(start.status, 200);
const { job } = await start.json();
assert.equal((await (await request(generation, payload, dm)).json()).job.id, job.id);
const [plate, core, eye] = job.items;
assert.equal((await request(`${generation}/${job.id}/confirm`, { items: [{ id: plate.id, description: "Test", rarity: "" }] }, dm)).status, 400);
let imageCalls = 0, textCalls = 0;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, options) => {
    if (url.endsWith("/items.json")) return Response.json([{ id: "old-material", name: "Materiale preesistente" }]);
    const body = JSON.parse(options.body);
    if (url.endsWith("/responses")) {
        textCalls++;
        assert.match(body.input[0].content[1].image_url, /^data:image\/webp;base64,/);
        return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: "Metallo scuro con venature sottili." }] }] });
    }
    imageCalls++;
    assert.equal(url, "https://api.openai.com/v1/images/edits");
    assert.equal(body.size, "1024x1024");
    assert.equal(body.quality, "medium");
    assert.match(body.images[0].image_url, /^data:image\/webp;base64,/);
    assert.match(body.prompt, /clean white/);
    if (imageCalls === 2) return new Response(null, { status: 500 });
    return Response.json({ data: [{ b64_json: Buffer.from(webp).toString("base64") }] });
};
try {
    await store.alarm();
    await store.alarm();
    await store.alarm();
    await store.alarm();
    const latest = async () => (await (await request(generation, undefined, dm)).json()).job;
    assert.deepEqual((await latest()).items.map(item => item.status), ["ready", "failed", "ready"]);
    assert.equal(imageCalls, 3);
    assert.equal(await readDocument(catalogKey), originalCatalog ?? null);
    assert.equal(await readDocument(categoriesKey), null, "le anteprime non creano cartelle");
    assert.equal((await request(`${generation}/${job.id}/preview/${plate.id}`, undefined, player)).status, 403);
    assert.equal((await request(`${generation}/${job.id}/preview/${plate.id}`, undefined, dm)).headers.get("Content-Type"), "image/webp");

    const retry = { requestId: crypto.randomUUID() };
    assert.equal((await request(`${generation}/${job.id}/retry/${core.id}`, retry, dm)).status, 200);
    await store.alarm();
    assert.equal((await request(`${generation}/${job.id}/retry/${core.id}`, retry, dm)).status, 200);
    await store.alarm();
    assert.equal(imageCalls, 4);
    assert.equal(textCalls, 3, "image retry reuses the description");
    assert.deepEqual((await latest()).items.map(item => item.status), ["ready", "ready", "ready"]);

    const confirm = { items: [
        { id: plate.id, description: "Piastra di ferro battuto.", rarity: "" },
        { id: eye.id, description: "Lente di ferro e vetro.", rarity: "Raro" },
    ] };
    env.CAMPAIGN_ITEMS_WRITES_PAUSED_CAMPAIGNS = campaign;
    assert.equal((await request(`${generation}/${job.id}/confirm`, confirm, dm)).status, 503);
    assert.equal(await readDocument(catalogKey), originalCatalog ?? null);
    delete env.CAMPAIGN_ITEMS_WRITES_PAUSED_CAMPAIGNS;
    rejectQueueWrite = true;
    assert.equal((await request(`${generation}/${job.id}/confirm`, confirm, dm)).status, d1 ? 503 : 500);
    assert.deepEqual((await latest()).items.map(item => item.status), ["publishing", "ready", "publishing"]);
    assert.equal((await latest()).items[2].confirmation.rarity, "Raro");
    const publishedVersion = JSON.parse(await readDocument(catalogKey)).version;
    if (d1) {
        assert.equal(await readDocument(catalogKey), originalCatalog, "failed D1 queue write rolls back the catalog");
        assert.equal(await readDocument(categoriesKey), null, "failed D1 queue write rolls back the folders");
    }
    const confirmed = await request(`${generation}/${job.id}/confirm`, confirm, dm);
    assert.equal(confirmed.status, 200);
    const result = await confirmed.json();
    assert.deepEqual(result.job.items.map(item => item.status), ["accepted", "ready", "accepted"]);
    assert.equal(result.commands.length, 2);
    const catalog = JSON.parse(await readDocument(catalogKey));
    const registry = async () => (await (await request("api/item-categories")).json()).data;
    const folders = await registry();
    const parent = folders.categories.find(category => category.name === "Materiali");
    const child = folders.categories.find(category => category.name === "Golem di Ferro");
    assert.ok(parent && child);
    assert.equal(child.parentId, parent.id);
    assert.equal(catalog.version, publishedVersion + Number(d1));
    assert.deepEqual(catalog.data.map(item => item.id), ["old-material", plate.id, eye.id]);
    for (const record of catalog.data.slice(1)) {
        assert.equal(record.sync.pendingFoundry, true);
        assert.equal(record.category, "Golem di Ferro");
        assert.equal(record.categoryId, child.id);
        assert.equal(record.foundry.document.type, "loot");
        assert.equal(record.classification.family, "material");
        assert.ok(objects.has(record.image.replace(/^media\//, "")));
        const command = result.commands.find(entry => entry.document.campaignItemId === record.id);
        assert.equal(command.target.transferId, record.id);
        assert.equal(command.document.img, record.image);
        assert.equal(command.document.system.type.value, "material");
    }
    assert.equal(result.commands[1].document.system.rarity, "rare");
    const queued = await request("api/managed-actor-commands/world", undefined, null, foundry);
    assert.equal(queued.status, 200);
    assert.deepEqual((await queued.json()).commands.map(entry => entry.target.transferId), [plate.id, eye.id]);
    assert.equal((await request(`${generation}/${job.id}/confirm`, confirm, dm)).status, 200);
    assert.equal(JSON.parse(await readDocument(catalogKey)).version, catalog.version);
    const read = await (await request(actorPath, undefined, dm)).json();
    assert.equal(read.data.sync.commands.length, 2);
    assert.ok(!objects.has(`campaigns/${campaign}/items/${core.id}.webp`));
    const later = await request(`${generation}/${job.id}/confirm`, {
        items: [{ id: core.id, description: "Nucleo di ferro.", rarity: "" }]
    }, dm);
    assert.equal(later.status, 200);
    assert.equal((await registry()).revision, folders.revision, "ulteriori drop riusano la sottocartella");
    assert.equal(JSON.parse(await readDocument(catalogKey)).data.find(item => item.id === core.id).categoryId, child.id);
    if (d1) {
        assert.equal((await request("api/data/items")).headers.get("X-Campaign-Items-Storage"), "d1");
        assert.equal(kv.get(catalogKey), originalCatalog);
        assert.equal(kv.has(categoriesKey), false);
    }
} finally {
    globalThis.fetch = fetchOriginal;
}
console.log("NPC drops (" + (d1 ? "D1" : "KV") + "): permissions, independent retry, private previews, Materiali and Foundry queue verified");
