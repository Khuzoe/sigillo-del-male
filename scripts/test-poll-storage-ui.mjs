import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../assets/js/shared/next-session.js", import.meta.url), "utf8");
let requests = [], failure = false;
const window = { location: { pathname: "/pages/sondaggio.html" }, CriptaApp: {
  campaigns: { currentId: () => "test" }, utils: { escapeHtml: String },
  api: { request: async (path, options) => {
    requests.push({ path, options });
    if (failure) throw new Error("Il sondaggio è stato modificato. Ricaricalo prima di salvare.");
    return options.method === "POST" ? { data: { ...options.body, revision: options.body.expectedRevision + 1 } }
      : { campaignId: "test", number: 7, revision: 5, availabilityOptions: [] };
  } } }
};
vm.runInNewContext(source.replace("window.CriptaNextSession = {", `window.testStorageUi = {
  sanitizeNextSessionConfig, buildSessionSavePayload, postRemoteSessionConfig, sessionApiService
}; window.CriptaNextSession = {`), { window, document: { body: { classList: { contains: () => true } } }, URL, console });
const api = window.testStorageUi;
const config = { campaignId: "test", number: 7, revision: 4, availabilityOptions: [] };
assert.equal(api.buildSessionSavePayload(api.sanitizeNextSessionConfig(config)).expectedRevision, 4);
assert.equal(api.buildSessionSavePayload({ campaignId: "test", number: 8 }).expectedRevision, 0);
assert.equal(api.sanitizeNextSessionConfig({ revision: -1 }).revision, 0);
assert.equal(api.sanitizeNextSessionConfig({ revision: "4" }).revision, 0);
assert.equal((await api.postRemoteSessionConfig(config)).revision, 5, "Successful save adopts the confirmed server revision");
const saved = await api.sessionApiService.getCurrentSession("test");
assert.equal(saved.revision, 5);
requests = []; failure = true;
await assert.rejects(api.postRemoteSessionConfig(config), /Ricaricalo/);
failure = false;
await api.sessionApiService.getCurrentSession("test");
assert.equal(requests.length, 2, "Failed configuration save invalidates the cached revision before reload");
assert.equal(requests[1].options.method, "GET");
console.log("Poll D1 frontend: revisions survive normalization, confirmed saves and cache invalidation after conflicts.");
