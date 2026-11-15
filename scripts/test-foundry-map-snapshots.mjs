import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
import { handleFoundryMaps } from "../workers/main-worker/src/foundry-maps.js";
import worker from "../workers/main-worker/src/index.js";

const sql = new DatabaseSync(":memory:");
sql.exec(await readFile(new URL("../workers/main-worker/migrations/0006_foundry_maps.sql", import.meta.url), "utf8"));
const objects = new Map();
let failSecondWrite = false;
const env = {
    POLL_DB: { prepare(statement) {
        return { bind(...parameters) {
            const query = sql.prepare(statement);
            return {
                async first() { return query.get(...parameters) || null; },
                async all() { return { results: query.all(...parameters) }; },
                async run() { return { meta: query.run(...parameters) }; },
            };
        } };
    } },
    MEDIA_BUCKET: {
        async put(key, bytes) {
            if (failSecondWrite && key.endsWith("/dm.webp")) throw new Error("Simulated R2 failure");
            objects.set(key, Uint8Array.from(bytes));
        },
        async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; },
        async delete(keys) { for (const key of keys) objects.delete(key); },
    },
};
const services = {
    async requireUser(request) { return request.headers.get("Authorization") || Response.json({ error: "Login richiesto." }, { status: 401 }); },
    async isEditor(user, campaign) { return user === "dm:" + campaign; },
    async canReadPlayer(user, campaign) { return user === "player" && campaign === "cripta"; },
    isFoundry(request) { return request.headers.get("X-Test-Foundry") === "true"; },
};
const base = "https://worker.test/api/foundry-maps";
const scene = "/world/SceneA";
function call(path = "", { user, form, campaign = "cripta", fromFoundry = false } = {}) {
    return handleFoundryMaps(new Request(base + path, {
        method: form ? "POST" : "GET", body: form,
        headers: { ...(user ? { Authorization: user } : {}), ...(fromFoundry ? { "X-Test-Foundry": "true" } : {}) },
    }), campaign, env, services, {});
}

function image(marker, width = 128) {
    const webp = new Uint8Array(30);
    webp.set(Buffer.from("RIFF"));
    new DataView(webp.buffer).setUint32(4, 22, true);
    webp.set(Buffer.from("WEBPVP8X"), 8);
    new DataView(webp.buffer).setUint32(16, 10, true);
    webp[20] = marker;
    webp[24] = width - 1;
    webp[27] = 127;
    return new File([webp], "map.webp", { type: "image/webp" });
}
function form(player, dm) {
    const data = new FormData();
    data.set("title", "Porta del Fiume");
    data.set("player", player);
    if (dm) data.set("dm", dm);
    return data;
}

assert.equal((await call()).status, 401);
assert.equal((await call(scene, { user: "player", form: form(image(1)) })).status, 403);
assert.equal((await call(scene, { user: "dm:other", form: form(image(1)) })).status, 403);
assert.equal((await call(scene, { fromFoundry: true, form: form(image(1), image(2, 64)) })).status, 400);
assert.equal((await call(scene, { fromFoundry: true, form: form(image(1)) })).status, 200);
assert.equal(objects.size, 1, "the same view uses one R2 object");
assert.equal((await call(scene, { fromFoundry: true, form: form(image(1)) }).then(result => result.json())).unchanged, true);

assert.equal((await call(scene, { fromFoundry: true, form: form(image(2), image(3)) })).status, 200);
assert.equal(objects.size, 2, "the two views replace the previous image");
assert.ok([...objects.keys()].every(key => key.startsWith("_private/")));
assert.equal((await call(scene + "?view=dm", { user: "player" })).status, 403);
assert.equal((await call(scene + "?view=dm", { user: "dm:other" })).status, 403);
assert.equal((await call(scene, { user: "player", campaign: "other" })).status, 403);
assert.equal((await call(scene, { user: "dm:other", campaign: "other" })).status, 404);
const listing = await (await call("", { user: "player" })).json();
assert.deepEqual(Object.keys(listing.maps[0]).sort(), ["sceneId", "title", "updatedAt", "worldId"]);
assert.equal(listing.canReadDm, false);
const players = await call(scene, { user: "player" });
const dm = await call(scene + "?view=dm", { user: "dm:cripta" });
assert.equal(new Uint8Array(await players.arrayBuffer())[20], 2);
assert.equal(new Uint8Array(await dm.arrayBuffer())[20], 3);
assert.equal(dm.headers.get("Cache-Control"), "private, no-store");
failSecondWrite = true;
await assert.rejects(call(scene, { fromFoundry: true, form: form(image(4), image(5)) }), /R2 failure/);
assert.equal(objects.size, 2);
assert.equal(new Uint8Array(await (await call(scene, { user: "player" })).arrayBuffer())[20], 2);

const apiEnv = { ...env, INVENTORY_SYNC_SECRET: "test-sync-secret", JWT_SECRET: "test-login-secret",
    DEVICE_LOGIN_CODES_SECRET: "MAP-PLAYER-TEST||map-player|Player",
    SIGILLO_KV: {
        async get(key) {
            return key === "campaign:cripta:data:characters:override"
                ? JSON.stringify({ data: [{ id: "pg", accountId: "map-player" }] }) : null;
        },
    },
};
failSecondWrite = false;
const route = (path, init) => worker.fetch(new Request("https://worker.test" + path, init), apiEnv, {});
const login = await route("/auth/device/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: "cripta", code: "MAP-PLAYER-TEST" }) });
assert.equal(login.status, 200);
const playerHeaders = { Authorization: "Bearer " + (await login.json()).token };
assert.equal((await route("/api/foundry-maps/world/SceneB?campaign=cripta", { method: "POST", body: form(image(6), image(7)),
    headers: { "X-Cripta-Inventory-Secret": apiEnv.INVENTORY_SYNC_SECRET, "X-Khuzoe-Sync-Contract": "1", "X-Khuzoe-Foundry-Generation": "14" },
})).status, 200);
assert.equal((await route("/api/foundry-maps/world/SceneB?campaign=cripta", { headers: playerHeaders })).status, 200);
assert.equal((await route("/api/foundry-maps/world/SceneB?campaign=cripta&view=dm", { headers: playerHeaders })).status, 403);
assert.equal((await route("/api/foundry-maps/world/SceneB?campaign=other", { headers: playerHeaders })).status, 403);
const privateKey = [...objects.keys()].find(key => key.includes("/SceneB/") && key.endsWith("/dm.webp"));
assert.equal((await route("/media/" + privateKey, { headers: playerHeaders })).status, 400);

const source = await readFile(new URL("../integrations/cripta-wiki-sync/foundry-map-snapshots.mjs", import.meta.url), "utf8");
const hooks = new Map();
const logs = [];
let captureCount = 0;
const context = vm.createContext({
    Hooks: { on(name, fn) { hooks.set(name, fn); }, once(name, fn) { hooks.set(name, fn); } },
    game: { user: { id: "gm" }, users: { activeGM: { id: "gm" } } },
    canvas: { ready: false, scene: null },
    performance,
    canPushToWorker: () => true, MODULE_ID: "cripta-wiki-sync", ui: { notifications: { warn: message => logs.push(message) } },
    captured: () => { captureCount++; },
});
vm.runInContext(source.replace(/^import .*$/gm, "").replace(/^export /gm, "")
    + "\nglobalThis.captureReal = capture; globalThis.publishReal = publish; capture = async () => { captured(); return {}; }; publish = async () => {};", context);
const mask = new Uint8Array(3);
context.unionExploredPixels(mask, new Uint8ClampedArray([255, 0, 0, 255, 1, 0, 0, 255, 250, 0, 0, 1]));
context.unionExploredPixels(mask, new Uint8ClampedArray([0, 0, 0, 255, 230, 0, 0, 255, 80, 0, 0, 255]));
assert.deepEqual([...mask], [255, 255, 0]);
const placeable = (id, hidden, src = "art.webp") => ({ document: { id, hidden, texture: { src } } });
const visible = placeable("public", false);
const privateToken = placeable("secret", true);
const changed = placeable("replaced", false, "new.webp");
const approved = ["public", "secret", "replaced"].map(id => JSON.stringify([id, "art.webp"]));
assert.deepEqual([...context.playerPlaceables([visible, privateToken, changed], approved)], [visible]);

hooks.get("ready")();
assert.equal(captureCount, 0);
context.canvas.ready = true;
context.canvas.scene = { active: false, getFlag: () => ({ auto: true, signature: "approved" }) };
await hooks.get("canvasReady")();
assert.equal(captureCount, 0, "the scene must be active");
context.canvas.scene.active = true;
context.game.users.activeGM.id = "other-gm";
await hooks.get("canvasReady")();
assert.equal(captureCount, 0, "only the designated GM publishes");
context.game.users.activeGM.id = "gm";
await hooks.get("canvasReady")();
assert.equal(captureCount, 1);
assert.deepEqual(logs, []);

const rect = { width: 128, height: 128, clone() { return this; } };
const level = { textures: {} };
const background = { level, name: "background", src: "city.webp" };
const foreground = { level, name: "foreground", src: null };
const sceneWithEmptyForeground = {
    levels: { size: 1, contents: [{ id: "floor" }] }, tiles: [], fog: { mode: 0 },
    _configureLevelTextures: () => [background, foreground],
};
context.CONST = { FOG_EXPLORATION_MODES: { DISABLED: 0 } };
Object.assign(context.canvas, {
    scene: sceneWithEmptyForeground, dimensions: { sceneRect: rect },
    primary: { levelTextures: [{ visible: true, texture: { valid: true } }, { visible: false, texture: { valid: true } }] },
    tiles: { placeables: [] }, tokens: { placeables: [] },
});
vm.runInContext('renderLayers = () => "render"; encodeWebp = async image => image;', context);
const approvedView = { tileKeys: [], tokenKeys: [] };
assert.equal((await context.captureReal(sceneWithEmptyForeground, approvedView)).player, "render");
foreground.src = "roof.webp";
await assert.rejects(context.captureReal(sceneWithEmptyForeground, approvedView), /primo piano/);
foreground.src = null;
background.src = null;
context.canvas.primary.levelTextures = [];
assert.equal((await context.captureReal(sceneWithEmptyForeground, approvedView)).player, "render");

// The saved scene stays authoritative even when the canvas reports no tiles.
const rendered = [];
const uploads = [];
const textures = new Map();
let elapsed = 0;
let onWait = () => {};
Object.assign(context, {
    performance: { now: () => elapsed },
    setTimeout(resolve, delay) { elapsed += delay; onWait(); resolve(); },
    foundry: { canvas: { TextureLoader: { loader: { getCache: src => textures.get(src) } } } },
    URL, Blob, FormData, AbortSignal,
    DISCORD_WORKER_URL: "https://worker.test",
    DEFAULT_CAMPAIGN_ID: "cripta",
    SETTINGS: {},
    policyFetch: async (url, options) => {
        uploads.push({ url, options });
        return Response.json({ ok: true });
    },
    recordRender: tiles => { rendered.push(Array.from(tiles, tile => tile.document.id)); },
});
context.game.world = { id: "world" };
context.game.settings = { get: () => "" };
vm.runInContext("capture = captureReal; publish = publishReal; renderLayers = (_rect, _size, _background, tiles) => { recordRender(tiles); return 'render'; }; encodeWebp = async image => new Blob([image], {type:'image/webp'});", context);
const setting = { ...approvedView, title: "P4", auto: true, signature: (await context.captureReal(sceneWithEmptyForeground, approvedView)).signature };
function tileDocument(id, src, { hidden = false, level = "floor" } = {}) {
    return { id, hidden, texture: { src }, includedInLevel: viewed => viewed === level };
}
function canvasTile(document, baseTexture) {
    return { document, mesh: { texture: { valid: true, baseTexture } }, renderFlags: new Set() };
}
const approvedTile = tileDocument("approved", "approved.webp");
const hiddenTile = tileDocument("hidden", "hidden.webp", { hidden: true });
const otherFloor = tileDocument("other-floor", "other.webp", { level: "different" });
const approvedSource = { valid: true };
const hiddenSource = { valid: true };
const approvedPlaceable = canvasTile(approvedTile, approvedSource);
const hiddenPlaceable = canvasTile(hiddenTile, hiddenSource);
const fallback = canvasTile(approvedTile, { valid: true });
const sceneWithTiles = Object.assign(sceneWithEmptyForeground, {
    id: "p4", active: true, tiles: [approvedTile, hiddenTile, otherFloor], getFlag: () => setting,
});
setting.tileKeys = [JSON.stringify([approvedTile.id, approvedTile.texture.src]), JSON.stringify([hiddenTile.id, hiddenTile.texture.src])];
textures.set(approvedTile.texture.src, approvedSource);
textures.set(hiddenTile.texture.src, hiddenSource);

rendered.length = 0;
let waits = 0;
onWait = () => {
    assert.equal(uploads.length, 0);
    assert.equal(rendered.length, 0);
    if (++waits === 1) context.canvas.tiles.placeables = [fallback, hiddenPlaceable];
    if (waits === 2) {
        approvedPlaceable.renderFlags.add("refresh");
        context.canvas.tiles.placeables = [approvedPlaceable, hiddenPlaceable];
    }
    if (waits === 3) approvedPlaceable.renderFlags.clear();
};
await hooks.get("canvasReady")();
assert.equal(waits, 3, "wait for missing tiles, the real texture and applied render flags");
assert.deepEqual(rendered, [["approved"], ["approved", "hidden"]]);
assert.equal(uploads.length, 1);
assert.ok(uploads[0].options.body.has("dm"));

rendered.length = 0;
context.canvas.tiles.placeables = [];
const waitStarted = elapsed;
onWait = () => {};
await hooks.get("canvasReady")();
assert.equal(elapsed - waitStarted, 15_000);
assert.equal(rendered.length, 0);
assert.equal(uploads.length, 1, "an incomplete capture must never replace the published map");
assert.match(logs.at(-1), /Mappa non aggiornata.*2 tile/);

context.canvas.tiles.placeables = [approvedPlaceable, hiddenPlaceable];
const preview = await context.captureReal(sceneWithTiles, setting);
context.canvas.tiles.placeables = [approvedPlaceable];
await assert.rejects(context.publishReal(sceneWithTiles, setting, preview), /1 tile/);
assert.equal(uploads.length, 1, "tile lost after preview must prevent the upload");

context.canvas.tiles.placeables = [];
onWait = () => { context.canvas.scene = null; };
await hooks.get("canvasReady")();
assert.match(logs.at(-1), /scena è cambiata/);
assert.equal(uploads.length, 1);
console.log("Mappe Foundry: nebbia, permessi, attesa dei tile e conservazione dell’immagine pubblicata verificati.");
