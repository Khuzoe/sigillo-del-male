import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { LocalD1 } from "./fixtures/local-d1.mjs";
import worker from "../workers/main-worker/src/index.js";

const db = new LocalD1();
const schema = await readFile(new URL("../workers/main-worker/migrations/0004_managed_actors.sql", import.meta.url), "utf8");
db.database.exec(schema);
db.database.exec("INSERT INTO managed_actor_imports VALUES ('test','forms','ready','now',null,0,'test')");
const secret = "local-test-only";
const env = {
    POLL_DB: db, MANAGED_ACTOR_D1_CAMPAIGNS: "test", GLOBAL_ADMIN_ACCOUNT_IDS: "dm",
    JWT_SECRET: secret, SIGILLO_KV: { get: async () => null }
};
function token(account) {
    const signed = [{ alg: "HS256", typ: "JWT" }, { accountId: account, exp: Math.floor(Date.now() / 1000) + 600 }]
        .map(value => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");
    return signed + "." + createHmac("sha256", secret).update(signed).digest("base64url");
}
const dm = token("dm"), player = token("player");
async function call(path, body, auth = dm) {
    const url = new URL(path, "https://forms.test");
    url.searchParams.set("campaign", "test");
    const response = await worker.fetch(new Request(url, {
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer " + auth } : {}) },
        ...(body ? { method: "POST", body: JSON.stringify(body) } : {})
    }), env);
    return { status: response.status, ...await response.json() };
}
function put(key, kind, data) {
    db.database.prepare("INSERT INTO managed_actor_documents VALUES (?,?,?,1,1,?,0,'now')")
        .run("test", "campaign:test:" + key, kind, JSON.stringify(data));
}
const roster = [
    ["human", "Arianna", "public", 30], ["angel", "Arianna serafica", "dm", 130],
    ["shade", "Arianna delle ombre", "public", 80], ["other", "Altro NPC", "dm", 11]
].map(([id, name, visibility, hp]) => {
    const actor = { id: "world:" + id, name, worldId: "world", actorId: id, actorType: "npc", revision: 1, entityKind: "person",
        media: { avatar: { path: id + "-avatar.webp" }, token: { path: id + "-token.webp" } },
        definition: { prototypeToken: { actorLink: true }, attributes: { hp: { max: hp } }, items: [] },
        visibility: { state: visibility } };
    const profile = { worldId: "world", actorId: id, legacyCharacterId: id, name, revision: 1, mediaSyncVersion: 1, media: actor.media,
        visibility: { state: id === "human" ? "public" : "dm" }, role: "Custode",
        blocks: [{ id: "chapter", type: "lore", title: id === "human" ? "Storia condivisa" : "Dossier originario " + id, text: "Testo", visibility: { state: "public" } }] };
    put("managed-actor:world:" + id, "actor", actor);
    put("managed-actor-profile:world:" + id, "profile", profile);
    return { ...actor, profile: { ...profile, blocks: undefined } };
});
put("managed-actors:index", "index", { version: 1, profileAccessVersion: 2, actorLinkIndexVersion: 1, data: roster });
const root = "/api/managed-actors/world/human/forms";
const baseline = () => db.database.prepare("SELECT document_key, payload, revision FROM managed_actor_documents WHERE kind <> 'npc-forms' ORDER BY document_key").all();
const before = baseline();
async function change(action, id, revision, extra = {}, path = root) {
    return call(path, { action, key: "world:" + id, expectedRevision: revision, ...extra });
}
assert.equal((await call(root)).group, null);
for (const auth of ["", player]) {
    assert.equal((await call(root + "?candidates=1", null, auth)).status, 403);
    assert.equal((await call(root, { action: "link" }, auth)).status, 403);
}
assert.equal((await change("link", "angel", 0, { label: "Angelica" })).status, 200);
assert.equal((await change("link", "angel", 0, { label: "Duplicata" })).status, 409);
assert.equal((await change("link", "angel", 0, { label: "Duplicata" }, "/api/managed-actors/world/other/forms")).status, 409);
assert.equal((await change("current", "angel", 1)).status, 200);
assert.equal((await change("past", "human", 2, { past: true })).status, 200);
assert.equal((await change("past", "angel", 3, { past: true })).status, 400);
const privateGroup = (await call(root)).group;
assert.equal(privateGroup.forms.find(form => form.current).label, "Angelica");
assert.ok(privateGroup.forms.find(form => form.key === "world:human").past);
assert.deepEqual((await call("/api/managed-actors/world/angel/forms")).group, privateGroup);
assert.equal((await call(root, null, "")).group, null, "a private transformation is undisclosed");
for (const view of ["directory", "search"]) {
    const index = (await call("/api/managed-actors?view=" + view)).data;
    assert.deepEqual(index.map(actor => actor.actorId), ["human", "shade", "other"]);
    assert.equal(index[0].media.avatar.path, "angel-avatar.webp");
    const publicIndex = (await call("/api/managed-actors?view=" + view, null, "")).data;
    assert.equal(publicIndex[0].media.token.path, "human-token.webp");
    assert.doesNotMatch(JSON.stringify(publicIndex), /angel/i);
}
assert.equal((await call("/api/managed-actors")).data.length, 4, "Foundry still sees individual Actors");
assert.equal((await change("portrait", "angel", 3, { showPortrait: true })).status, 200);
const publicForm = (await call(root, null, "")).group.forms.find(form => form.current);
assert.equal(publicForm.canReadStats, false);
assert.equal(publicForm.media.token.path, "angel-token.webp");
assert.equal((await call("/api/managed-actors/world/angel", null, "")).status, 403);
assert.equal((await change("link", "shade", 4, { label: "Oscura" })).status, 200);
assert.equal((await change("current", "shade", 5)).status, 200);
assert.equal((await change("current", "human", 6)).status, 200);
const restored = (await call(root)).group;
assert.equal(restored.forms.filter(form => form.past).length, 0);
assert.ok(restored.forms.find(form => form.current && form.key === "world:human"));
assert.equal((await change("unlink", "shade", 7)).status, 200);
assert.equal((await change("unlink", "angel", 8)).status, 200);
assert.equal((await call(root)).group, null);
const competing = await Promise.all([
    change("link", "angel", 0, { label: "Angelica" }),
    change("link", "angel", 0, { label: "Angelica" }, "/api/managed-actors/world/other/forms")
]);
assert.deepEqual(competing.map(result => result.status).sort(), [200, 409]);
assert.deepEqual(baseline(), before, "group changes preserve both Actor documents, profiles, and the sync index");
console.log("Forme NPC verificate su D1 locale: collegamenti, concorrenza, privacy, immagini, dossier e ritorno alla forma precedente.");
if (process.argv.includes("--browser")) {
    db.database.exec("DELETE FROM managed_actor_documents WHERE kind = 'npc-forms'");
    const { verifyDossierForms } = await import("./fixtures/npc-forms-browser.mjs");
    await verifyDossierForms(call, dm);
}
