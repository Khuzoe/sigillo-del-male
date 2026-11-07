import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const sharedSource = fs.readFileSync(new URL("../assets/js/shared/npc-categories.js", import.meta.url), "utf8");
let postedBody = null;
const sandbox = {
  structuredClone, URL, URLSearchParams,
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

sandbox.window.location = { href: "https://wiki.test/pages/npcs.html" };
sandbox.window.CriptaApp.onPageReady = () => {};
vm.runInContext(fs.readFileSync(new URL("../assets/js/shared/character-normalize.js", import.meta.url), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(new URL("../assets/js/pages/npcs.js", import.meta.url), "utf8"), sandbox);
for (const [campaignId, genericName, genericId] of [
  ["cripta-di-sangue", "Altri NPC", "altri-npc"],
  ["mago-folle", "ALTRI", "altri"],
  ["oltre-il-velo", "Senza categoria", "senza-categoria"],
]) {
  const sourceRegistry = { campaignId, categories: [
    { id: genericId, name: genericName, order: 10 },
    { id: "reperti", name: "Reperti", parentId: genericId, order: 20 },
    { id: "alleati", name: "Alleati", order: 30 },
    { id: "altri-alleati", name: "Altri", parentId: "alleati", order: 40 },
  ] };
  const beforeRegistry = structuredClone(sourceRegistry);
  const registry = api.normalizeRegistry(sourceRegistry);
  assert.equal(registry.campaignId, campaignId);
  assert.equal(registry.categories.find(category => category.id === genericId).name, "Senza categoria");
  assert.equal(api.normalizeAssignment(registry, genericId, genericName).categoryId, "");
  assert.equal(api.normalizeAssignment(registry, "altri-alleati", "Altri").categoryId, "altri-alleati", "named subcategories remain assigned");
  const npcs = [
    { id: "legacy", categoryId: genericId, category: genericName, role: "Custode", quote: "Da conservare", hidden: true, archived: true, images: { avatar: "ritratto.webp" } },
    { id: "unassigned", categoryId: "", category: "" },
    { id: "child", categoryId: "reperti", category: "Reperti" },
    { id: "specific", categoryId: "alleati", category: "Alleati" },
    { id: "named-child", categoryId: "altri-alleati", category: "Altri" },
  ];
  const beforeNpcs = structuredClone(npcs);
  const normalized = npcs.map(npc => sandbox.applyNpcCategoryMetadata(npc, registry));
  const groups = sandbox.groupNpcsByCategory(normalized);
  assert.equal(groups.length, 2, `${campaignId}: legacy and empty assignments share a single group`);
  assert.equal(groups.find(group => group.id === "").items.length, 3);
  assert.ok(groups.find(group => group.id === "").subgroups.some(group => group.id === "reperti"), "child folders retain their identity");
  assert.equal(groups.reduce((count, group) => count + group.items.length, 0), npcs.length, "every NPC is preserved");
  for (const field of ["role", "quote", "hidden", "archived", "images"]) {
    assert.deepEqual(normalized[0][field], npcs[0][field]);
  }
  assert.deepEqual(sourceRegistry, beforeRegistry, "stored registry and identifiers remain untouched");
  assert.deepEqual(npcs, beforeNpcs, "source NPC documents remain untouched");
  const choices = sandbox.selectableNpcCategories(registry);
  assert.ok(!choices.some(category => category.id === genericId), "the implicit uncategorized choice is not duplicated");
  assert.equal(choices.find(category => category.id === "reperti").parentName, "Senza categoria");
}
const renamed = api.normalizeRegistry({ categories: [{ id: "altri-npc", name: "Draghi" }] });
assert.equal(api.normalizeAssignment(renamed, "altri-npc", "Draghi").categoryId, "altri-npc", "a deliberately renamed category keeps its stable identity");
console.log("Categorie generiche: uniformita nelle tre campagne, vecchie assegnazioni, sottocartelle e dati originali preservati.");
