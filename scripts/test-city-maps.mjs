import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
import { handleCityMaps } from "../workers/main-worker/src/city-maps.js";
import { handleFoundryMaps } from "../workers/main-worker/src/foundry-maps.js";

const sql = new DatabaseSync(":memory:");
sql.exec("PRAGMA foreign_keys = ON");
for (const filename of ["0006_foundry_maps.sql", "0007_city_maps.sql"]) {
    sql.exec(await readFile(new URL("../workers/main-worker/migrations/" + filename, import.meta.url), "utf8"));
}
const objects = new Map();
const env = {
    POLL_DB: { prepare(statement) {
        return { bind(...values) {
            const query = sql.prepare(statement);
            const parameters = /\?\d/.test(statement) ? [Object.fromEntries(values.map((value, i) => [String(i + 1), value]))] : values;
            return {
                async first() { return query.get(...parameters) || null; },
                async all() { return { results: query.all(...parameters) }; },
                async run() { return { meta: query.run(...parameters) }; },
            };
        } };
    } },
    MEDIA_BUCKET: {
        async put(key, body, options) { objects.set(key, { body, customMetadata: options.customMetadata }); },
        async get(key) { return objects.get(key) || null; },
        async head(key) { return objects.get(key) || null; },
        async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
    },
};
const services = {
    async requireUser(request) {
        const id = request.headers.get("Authorization");
        return id ? { id, username: id } : Response.json({}, { status: 401 });
    },
    async isEditor(user, campaign) { return user.id === "dm-" + campaign || user.id === "second-dm" && campaign === "test"; },
    async canReadPlayer(user, campaign) { return ["alice", "bob"].includes(user.id) && campaign === "test"; },
    accountId: user => user.id,
    isFoundry: () => false,
};

function image(marker = 1) {
    const data = new Uint8Array(30);
    data.set(Buffer.from("RIFF"));
    data.set(Buffer.from("WEBPVP8X"), 8);
    new DataView(data.buffer).setUint32(4, 22, true);
    new DataView(data.buffer).setUint32(16, 10, true);
    data[20] = marker;
    data[24] = data[27] = 127;
    return new File([data], "map.webp", { type: "image/webp" });
}

async function request(path, { user = "dm-test", campaign = "test", method = "GET", body, status = 200, foundry = false } = {}) {
    const headers = user ? { Authorization: user } : {};
    if (body && !(body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(body);
    }
    const handle = foundry ? handleFoundryMaps : handleCityMaps;
    const response = await handle(new Request("https://worker.test/api/" + (foundry ? "foundry-maps" : "city-maps") + path, { method, headers, body }),
        campaign, env, services, {});
    assert.equal(response.status, status, method + " " + path + " " + await response.clone().text());
    return response.headers.get("Content-Type").includes("json") ? response.json() : response;
}

async function snapshot(id, frame, marker) {
    const form = new FormData();
    form.set("title", id);
    form.set("player", image(marker));
    form.set("dm", image(marker + 32));
    if (frame) form.set("frame", JSON.stringify(frame));
    return request("/world/" + id, { foundry: true, method: "POST", body: form });
}

await snapshot("city-scene", [0, 0, 128, 128], 1);
await snapshot("detail-scene", null, 2);
await request("", { user: null, status: 401 });
await request("", { user: "stranger", status: 403 });

const upload = new FormData();
upload.set("title", "Valmorta");
upload.set("image", image(3));
await request("", { user: "alice", method: "POST", body: upload, status: 403 });
const { id: mapId } = await request("", { method: "POST", body: upload, status: 201 });
const mapPath = "/" + mapId;
assert.ok([...objects.keys()].some(key => key.startsWith("_private/city-maps/")));
await request(mapPath + "/image", { user: "alice", status: 404 });
await request(mapPath, { user: "dm-other", campaign: "other", status: 404 });
const pointData = { title: "Porta del Fiume", x: .24, y: .65, detail: { worldId: "world", sceneId: "detail-scene" } };
const { id: pointId } = await request(mapPath + "/points", { method: "POST", body: pointData, status: 201 });
const { id: secretId } = await request(mapPath + "/points", { method: "POST", body: { ...pointData, title: "Rifugio segreto" }, status: 201 });
const notes = mapPath + "/points/" + pointId + "/notes";
assert.deepEqual((await request(mapPath + "?view=player")).points, []);
await request(mapPath, { method: "PUT", body: { title: "Valmorta", published: true, revision: 1 } });
await request(mapPath, { method: "PUT", body: { title: "Vecchia revisione", published: true, revision: 1 }, status: 409 });
await request(mapPath + "/points/" + pointId, { method: "PUT", body: { ...pointData, revealed: true, revision: 1 } });
const playerMap = await request(mapPath, { user: "alice" });
assert.deepEqual(playerMap.points.map(point => point.id), [pointId]);
assert.equal(playerMap.points[0].detail, null);
await request(mapPath + "/points/" + secretId + "/notes", { user: "alice", status: 404 });
assert.equal((await request(mapPath + "/image", { user: "alice" })).headers.get("Cache-Control"), "private, no-store");
await request(mapPath + "/points/" + pointId, { method: "PUT", body: { ...pointData, revealed: true, detailShared: true, revision: 2 } });
assert.deepEqual((await request(mapPath, { user: "bob" })).points[0].detail, pointData.detail);

const addNote = (user, audience, text) => request(notes, { user, method: "POST", body: { audience, text }, status: 201 });
const [personal, group] = await Promise.all([addNote("alice", "personal", "Personale"), addNote("bob", "group", "Condivisa")]);
await addNote("dm-test", "dm", "Riservata");
await request(notes, { user: "bob", method: "POST", body: { audience: "dm", text: "Riservata" }, status: 400 });
const labels = async (user, suffix = "") => (await request(notes + suffix, { user })).notes.map(note => note.text).sort();
assert.deepEqual(await labels("alice"), ["Condivisa", "Personale"]);
assert.deepEqual(await labels("bob"), ["Condivisa"]);
assert.deepEqual(await labels("dm-test"), ["Condivisa", "Riservata"]);
assert.deepEqual(await labels("second-dm"), ["Condivisa", "Riservata"]);
assert.deepEqual(await labels("dm-test", "?view=player"), ["Condivisa"]);
await request(notes + "/" + personal.id, { method: "DELETE", body: { revision: 1 }, status: 404 });
await request(notes + "/" + personal.id, { user: "alice", method: "PUT", body: { revision: 1, audience: "personal", text: "Aggiornata" } });
await request(notes + "/" + personal.id, { user: "alice", method: "DELETE", body: { revision: 1 }, status: 409 });
await request(notes + "/" + group.id, { method: "DELETE", body: { revision: 1 } });
assert.deepEqual(await labels("alice"), ["Aggiornata"]);

await request(mapPath + "/import", { user: "alice", method: "POST", body: { worldId: "world" }, status: 403 });
const queued = (await request(mapPath + "/import", { method: "POST", body: { worldId: "world" }, status: 201 })).job;
assert.equal((await request(mapPath + "/import", { method: "POST", body: { worldId: "world" } })).job.id, queued.id);
const { jobs: [job] } = await request("/scene-imports?world=world");
assert.equal(job.id, queued.id);
assert.deepEqual((await request("/scene-imports?world=elsewhere")).jobs, []);
await request("/scene-imports/" + job.id + "/image?world=elsewhere", { status: 404 });
await request("/scene-imports/" + job.id + "/image?world=world", { user: "bob", status: 403 });
await request("/by-scene/world/" + job.sceneId, { status: 404 });
await request("/scene-imports/" + job.id + "/complete?world=world", { method: "POST", body: { sceneId: "wrong" }, status: 400 });
for (let i = 0; i < 2; i++) {
    await request("/scene-imports/" + job.id + "/complete?world=world", { method: "POST", body: { sceneId: job.sceneId } });
}
assert.deepEqual((await request("/scene-imports?world=world")).jobs, []);
assert.equal((await request("/by-scene/world/" + job.sceneId, { user: "bob" })).id, mapId);
await snapshot(job.sceneId, null, 6);
assert.equal((await request("", { method: "POST", body: { worldId: "world", sceneId: job.sceneId } })).id, mapId);

const origin = { worldId: "world", sceneId: "city-scene" };
const { id: foundryId } = await request("", { method: "POST", body: origin, status: 201 });
assert.equal((await request("", { method: "POST", body: origin })).id, foundryId);
const foundryPath = "/" + foundryId;
await request(foundryPath, { method: "PUT", body: { title: "Città Foundry", published: true, revision: 1 } });
await snapshot("city-scene", [0, 0, 128, 128], 4);
assert.equal((await request(foundryPath, { user: "bob" })).map.alignmentNeeded, false);
await snapshot("city-scene", [1, 0, 128, 128], 5);
assert.equal((await request(foundryPath, { user: "bob" })).map.alignmentNeeded, true);
await request(foundryPath + "/image", { user: "bob", status: 409 });
await request(foundryPath + "/image?view=dm", { user: "bob", status: 403 });
const current = (await request(foundryPath)).map;
const review = await request(foundryPath + "/image?review=" + current.sourceRevision);
assert.equal(new Uint8Array(await review.arrayBuffer())[20], 5);
await request(foundryPath + "/align", { method: "POST", body: { revision: current.revision, sourceRevision: current.sourceRevision } });
assert.equal((await request(foundryPath, { user: "bob" })).map.alignmentNeeded, false);

// Run the actual import routine against in-memory Foundry documents and files.
const moduleSource = await readFile(new URL("../integrations/cripta-wiki-sync/city-maps.mjs", import.meta.url), "utf8");
const installed = new Map();
let creates = 0, uploads = 0, acknowledgements = 0, failAcknowledgement = true, canPull = true;
const fakeGame = {
    world: { id: "world" },
    settings: { get: (_id, key) => ({ campaign: "test", auth: "dm-test" })[key] },
    scenes: installed,
    user: { id: "gm", isGM: true, can: () => true },
    users: { activeGM: { id: "gm" } },
};
const sandbox = vm.createContext({
    URL, AbortSignal, File, Response, Error, game: fakeGame,
    MODULE_ID: "test-module", DISCORD_WORKER_URL: "https://worker.test",
    SETTINGS: { CAMPAIGN_ID: "campaign", DISCORD_TOKEN: "auth" },
    BaseShadowApp: class {},
    CONST: { GRID_TYPES: { GRIDLESS: 0 }, FOG_EXPLORATION_MODES: { DISABLED: 0 } },
    canPullFromWorker: () => canPull,
    Hooks: { on() {} },
    foundry: {
        applications: { apps: { FilePicker: { implementation: {
            async browse() {},
            async upload(_type, folder, file) { uploads++; return { path: folder + "/" + file.name }; },
        } } } },
        documents: { Scene: {
            metadata: { defaultLevelId: "defaultLevel0000" },
            async create(data, options) {
                creates++;
                assert.equal(options.keepId, true);
                assert.equal(data.navigation, false);
                assert.equal(data.active, false);
                assert.equal(data.levels[0].background.src, "khuzoe-city-maps/world/" + job.id + ".webp");
                const document = { id: data._id, getFlag: (id, key) => data.flags[id][key] };
                installed.set(document.id, document);
                return document;
            },
        } },
    },
    async policyFetch(url, init) {
        assert.equal(url.searchParams.get("world"), "world");
        if (url.pathname.endsWith("/image")) return new Response(image(3));
        acknowledgements++;
        assert.equal(JSON.parse(init.body).sceneId, job.sceneId);
        if (failAcknowledgement) return Response.json({ error: "Ricevuta simulata persa." }, { status: 503 });
        return Response.json({ ok: true });
    },
});
vm.runInContext(moduleSource.replace(/^import .+;\r?$/gm, "").replace("export async function", "async function"), sandbox);
const expected = { campaign: "test", world: "world", token: "dm-test" };
canPull = false;
await assert.rejects(sandbox.createCityScene(expected, job), /modalità Wiki Sync/);
canPull = true;
await assert.rejects(sandbox.createCityScene(expected, job), /Ricevuta simulata persa/);
failAcknowledgement = false;
await sandbox.createCityScene(expected, job);
assert.equal(creates, 1);
assert.equal(uploads, 1);
assert.equal(acknowledgements, 2);
console.log("Mappe città: permessi, note concorrenti, scene collegate, allineamento e importazione Foundry idempotente verificati.");
