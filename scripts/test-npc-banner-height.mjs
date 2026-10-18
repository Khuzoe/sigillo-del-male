import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import worker from "../workers/main-worker/src/index.js";

const store = new Map();
const env = { INVENTORY_SYNC_SECRET: "banner-test", SIGILLO_KV: {
    async get(key) { return store.get(key) ?? null; },
    async put(key, value) { store.set(key, String(value)); },
    async delete(key) { store.delete(key); }
} };
const path = "api/managed-actors/banner-world/banner-npc";
async function request(url, body, authenticated = true) {
    return worker.fetch(new Request(`https://worker.test/${url}?campaign=banner-test`, {
        headers: { "Content-Type": "application/json", ...(authenticated ? {
            "X-Cripta-Inventory-Secret": "banner-test", "X-Khuzoe-Sync-Contract": "1", "X-Khuzoe-Foundry-Generation": "14"
        } : {}) },
        ...(body ? { method: "POST", body: JSON.stringify(body) } : {})
    }), env);
}
assert.equal((await request(path, { expectedRevision: 0, name: "NPC banner", actorType: "npc", visibility: { state: "dm" },
    definition: { attributes: { hp: { max: 42 } } },
    contract: { name: "khuzoe-wiki-sync", version: 1, module: { id: "cripta-wiki-sync", version: "0.11.11" }, foundry: { generation: 14 }, system: { id: "dnd5e", version: "5.3.3" } }
})).status, 200);
const actorBefore = (await (await request(path)).json()).data;
const blocks = [
    { id: "banner", type: "banner_box", title: "Incontro", text: "Il racconto", banner: "media/banner.webp", visibility: "public", bannerHeight: 360 },
    { id: "secret", type: "lore", title: "Segreto", text: "Riservato", image: "media/secret.webp", visibility: "dm", bannerHeight: 400 }
];
const created = await request(`${path}/profile`, { expectedRevision: 0, data: { role: "Custode", blocks } });
assert.equal(created.status, 200);
const baseline = (await created.json()).data;
assert.equal(baseline.blocks[0].bannerHeight, 360);
assert.equal(baseline.blocks[1].bannerHeight, undefined, "other types ignore crop height");
assert.equal((await (await request(`${path}/profile`)).json()).data.blocks[0].bannerHeight, 360, "readback retains height");
const visibilitySave = await request(`${path}/profile`, { expectedRevision: 1, data: { visibility: { state: "public" } } });
assert.deepEqual((await visibilitySave.json()).data.blocks, baseline.blocks, "partial saves preserve images, text, height and permissions");
const publicProfile = (await (await request(`${path}/profile`, null, false)).json()).data;
assert.deepEqual(publicProfile.blocks.map(block => block.id), ["banner"]);
assert.equal(publicProfile.blocks[0].bannerHeight, 360);
assert.equal((await request(`${path}/profile`, { expectedRevision: 2, data: { blocks } }, false)).status, 401);
const conflictSnapshot = new Map(store);
assert.equal((await request(`${path}/profile`, { expectedRevision: 1, data: { blocks: [] } })).status, 409);
assert.deepEqual(store, conflictSnapshot, "conflicts leave persisted data unchanged");
let revision = 2;
for (const [height, expected] of [[9999, 600], [1, 120], [185.5, 186], ["300", 300], [true, undefined], ["400; color:red", undefined], [null, undefined]]) {
    const saved = await request(`${path}/profile`, { expectedRevision: revision++, data: { blocks: [{ ...blocks[0], bannerHeight: height }, blocks[1]] } });
    assert.equal(saved.status, 200);
    const data = (await saved.json()).data;
    assert.equal(data.blocks[0].bannerHeight, expected);
    assert.equal(data.blocks[0].text, blocks[0].text);
    assert.equal(data.blocks[0].banner, blocks[0].banner);
    assert.equal(data.blocks[1].visibility, "dm");
}
assert.deepEqual((await (await request(path)).json()).data, actorBefore, "dossier crop never changes actor statistics");

let dropHeight = false;
const source = await readFile(new URL("../assets/js/pages/managed-actor.js", import.meta.url), "utf8");
const context = { console, structuredClone, URL, URLSearchParams, CSS: { escape: value => value },
    window: { CriptaApp: { onPageReady() {}, utils: { resolveImageUrl: value => value }, api: {
        async post(url, body) {
            const data = structuredClone(body.data);
            data.revision = body.expectedRevision + 1;
            if (dropHeight) data.blocks.forEach(block => { delete block.bannerHeight; });
            return { data };
        }
    } } }
};
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `globalThis.banner = {
    normalizeManagedBannerHeight, normalizeManagedProfileBlockClient, renderManagedProfileViewBlock,
    renderManagedBannerEditor, setupManagedBannerEditors, collectManagedProfileFromRoot, saveManagedActorProfile,
    setProfile(value) { currentDocument = { actorType: "npc" }; currentProfile = value; managedProfileDirty = true; },
    state() { return { profile: currentProfile, dirty: managedProfileDirty }; }
};\n})();`), context);
const fe = context.banner;
for (const invalid of [undefined, null, "", 0, -1, Infinity, true, {}, "300; color:red"]) assert.equal(fe.normalizeManagedBannerHeight(invalid), null);
assert.equal(fe.normalizeManagedBannerHeight(900), 600);
assert.equal(fe.normalizeManagedBannerHeight(50), 120);
assert.match(fe.renderManagedProfileViewBlock(blocks[0]), /--managed-banner-height:360px/);
assert.doesNotMatch(fe.renderManagedProfileViewBlock({ ...blocks[0], bannerHeight: "300; color:red" }), /style=/);
assert.doesNotMatch(fe.renderManagedProfileViewBlock(blocks[1]), /--managed-banner-height/);
assert.equal(fe.renderManagedBannerEditor(blocks[1], "media/secret.webp"), "");
const events = {};
const slider = { value: "420", addEventListener(type, handler) { events[type] = handler; } };
const field = { value: "" }, label = {}, attributes = {}, styles = new Map();
const auto = { setAttribute(name, value) { attributes[name] = value; }, addEventListener(type, handler) { events.auto = handler; } };
const preview = { style: { setProperty(name, value) { styles.set(name, value); }, removeProperty(name) { styles.delete(name); } } };
const controls = { "[data-managed-banner-height]": slider, '[data-managed-profile-block-field="bannerHeight"]': field,
    "[data-managed-banner-height-label]": label, "[data-managed-banner-auto]": auto, "[data-managed-banner-preview]": preview };
let dirty = 0;
fe.setupManagedBannerEditors({ querySelectorAll() { return [{ querySelector(selector) { return controls[selector]; } }]; } }, () => dirty++);
events.input();
assert.equal(field.value, 420);
assert.equal(label.textContent, "420 px");
assert.equal(styles.get("--managed-banner-height"), "420px");
assert.equal(attributes["aria-pressed"], "false");
events.auto();
assert.equal(field.value, "");
assert.equal(label.textContent, "Auto");
assert.equal(attributes["aria-pressed"], "true");
assert.equal(styles.size, 0);
assert.equal(dirty, 2);

const values = { ...blocks[0], image: blocks[0].banner, bannerHeight: "360" };
let showHeight = true;
const node = { querySelector(selector) {
    const name = selector.match(/field="(.*?)"/)?.[1];
    return name === "bannerHeight" && !showHeight ? null : { value: values[name] ?? "" };
} };
const section = { querySelector() { return null; }, querySelectorAll(selector) { return selector === "[data-managed-profile-block]" ? [node] : []; } };
const root = { querySelector(selector) { return selector === "[data-managed-profile]" ? section : null; } };
const profile = { worldId: "banner-world", actorId: "banner-npc", revision: 1, blocks: [blocks[0]], tags: [] };
fe.setProfile(structuredClone(profile));
assert.equal(fe.collectManagedProfileFromRoot(root).blocks[0].bannerHeight, 360);
showHeight = false;
assert.equal(fe.collectManagedProfileFromRoot(root).blocks[0].bannerHeight, 360, "older editor layout retains stored crop");
showHeight = true;
values.bannerHeight = "";
assert.equal(fe.collectManagedProfileFromRoot(root).blocks[0].bannerHeight, null, "Auto clears previous crop");
values.bannerHeight = "360";
values.type = "lore";
assert.equal(fe.collectManagedProfileFromRoot(root).blocks[0].bannerHeight, null, "changing type clears the banner-only setting");
values.type = "banner_box";
dropHeight = true;
await assert.rejects(fe.saveManagedActorProfile(root, "test"), /Worker aggiornato/);
assert.equal(fe.state().profile.blocks[0].bannerHeight, 360, "old server response preserves the draft");
assert.equal(fe.state().profile.revision, 2, "retry uses the revision accepted by the server");
assert.equal(fe.state().dirty, true);
dropHeight = false;
await fe.saveManagedActorProfile(root, "test");
assert.equal(fe.state().profile.blocks[0].bannerHeight, 360);
assert.equal(fe.state().profile.revision, 3);
assert.equal(fe.state().dirty, false);
console.log("Banner height: editor controls, Auto, safe rendering, draft preservation and Worker roundtrip passed (in-memory data only).");


