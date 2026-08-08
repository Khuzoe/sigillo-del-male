import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const sharedSource = fs.readFileSync(new URL("../assets/js/shared/npc-categories.js", import.meta.url), "utf8");
let postedBody = null;
const sandbox = {
  structuredClone,
  window: {
    CriptaApp: {
      campaigns: { currentId: () => "test-campaign" },
      api: {
        clearCache() {},
        async post(_path, body) {
          postedBody = structuredClone(body);
          return { campaignId: "test-campaign", revision: 2, categories: body.categories };
        },
      },
    },
    CriptaDiscordAuth: { getToken: () => "test-token" },
  },
};
vm.createContext(sandbox);
vm.runInContext(sharedSource, sandbox, { filename: "npc-categories.js" });

const api = sandbox.window.CriptaNpcCategories;
const existing = api.normalizeCategory({
  id: "alleati",
  name: "Alleati",
  order: 10,
  color: "#112233",
  icon: "fa-users",
  rosterSection: "npc",
});
assert.equal(existing.parentId, "", "le categorie esistenti restano categorie principali");
assert.equal(existing.id, "alleati", "l'identificativo esistente non viene riscritto");

const child = api.normalizeCategory({
  id: "alleati-segreti",
  name: "Alleati segreti",
  parentId: "alleati",
  order: 10,
  color: "#445566",
  icon: "fa-masks-theater",
  rosterSection: "other",
});
assert.equal(child.parentId, "alleati", "la sottocategoria conserva il collegamento alla principale");
assert.equal(child.rosterSection, "other", "una sottocategoria puo essere mostrata in Altri indipendentemente dalla principale");

await api.save([existing, child], 1, { token: "test-token" });
assert.deepEqual(
  postedBody.categories.map(({ id, parentId, rosterSection }) => ({ id, parentId, rosterSection })),
  [
    { id: "alleati", parentId: "", rosterSection: "npc" },
    { id: "alleati-segreti", parentId: "alleati", rosterSection: "other" },
  ],
  "il salvataggio preserva tutte le categorie e aggiunge soltanto il campo facoltativo",
);

const workerSource = fs.readFileSync(new URL("../workers/main-worker/src/index.js", import.meta.url), "utf8");
assert.match(workerSource, /\.\.\.\(parentId \? \{ parentId \} : \{\}\)/, "il worker conserva parentId quando presente");
assert.match(workerSource, /if \(!parent\) return `Categoria principale non trovata/, "il worker rifiuta riferimenti mancanti");
assert.match(workerSource, /if \(parent\.parentId\) return "E consentito un solo livello/, "il worker impedisce profondita superiori a un livello");
assert.match(workerSource, /const hierarchyError = validateNpcCategoryHierarchy\(categories\)/, "la validazione gerarchica viene eseguita prima del salvataggio");

const foundryServiceSource = fs.readFileSync(new URL("../module/scripts/services/managed-actor-sync.js", import.meta.url), "utf8");
assert.match(foundryServiceSource, /categoryId:\s*category\?\.id \|\| ""/, "Foundry continua a sincronizzare un solo categoryId stabile");

console.log("Sottocategorie NPC: compatibilita, sezione indipendente e protezioni verificate.");
