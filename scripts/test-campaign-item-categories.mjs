import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import worker from "../workers/main-worker/src/index.js";
import {
  categoryFolderName,
  isAcceptedCampaignItemSnapshotResult,
  isCampaignItemAttunementRequired,
  recordHasFoundryIntent,
  resolveRecordCategory,
  shouldRepairLegacyCampaignItemAttunement,
} from "../module/scripts/services/campaign-item-sync.js";
import {
  applyCampaignItemCategoryFromFoundry,
  campaignItemArchiveFromSnapshot,
  campaignItemClassificationFromDocument,
  campaignItemCategoryFromSnapshot,
  normalizeFoundrySnapshot,
  normalizeItemImage,
} from "../workers/main-worker/src/campaign-items.js";

const registry = {
  revision: 7,
  categories: [
    { id: "arma", name: "Armi", order: 10 },
    { id: "armatura", name: "Armature", order: 20 },
    { id: "reliquie", name: "Reliquie", order: 30 },
    { id: "reliquie-vecchie", name: "Vecchie reliquie", mergedInto: "reliquie", order: 40 },
  ],
};

assert.deepEqual(
  resolveRecordCategory({ categoryId: "arma", category: "Arma" }, registry),
  { id: "arma", name: "Armi" },
  "l'ID stabile conserva il collegamento quando il nome viene rinominato",
);
assert.deepEqual(
  resolveRecordCategory({ category: "Armature" }, registry),
  { id: "armatura", name: "Armature" },
  "un documento legacy viene collegato per nome esatto",
);
assert.deepEqual(
  resolveRecordCategory({ categoryId: "reliquie-vecchie", category: "Vecchie reliquie" }, registry),
  { id: "reliquie", name: "Reliquie" },
  "una categoria unita punta sempre alla destinazione canonica",
);
assert.deepEqual(
  resolveRecordCategory({ type: "Pozione" }, { categories: [] }),
  { id: "pozione", name: "Pozione" },
  "i dati di Cripta di Sangue senza categoria mantengono il tipo leggibile",
);
assert.equal(categoryFolderName("  Armi / Reliquie  "), "Armi / Reliquie");
assert.equal(categoryFolderName("\u0000\u0007"), "Senza categoria");

const subfolders = [
  { id: "arma", name: "Arma" },
  { id: "armatura", name: "Armatura" },
  { id: "armi-geniali", name: "Geniali", parentId: "arma" },
  { id: "armature-geniali", name: "Geniali", parentId: "armatura" },
];
assert.deepEqual(resolveRecordCategory({ categoryId: "armi-geniali", category: "Geniali" }, { categories: subfolders }),
  { id: "armi-geniali", name: "Geniali", parentId: "arma" });

const values = new Map();
const env = {
  INVENTORY_SYNC_SECRET: "test-secret",
  SIGILLO_KV: { async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); } },
};
const endpoint = "https://worker.test/api/item-categories?campaign=cripta-di-sangue";
const saveFolders = (categories, expectedRevision = 0) => worker.fetch(new Request(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Cripta-Inventory-Secret": env.INVENTORY_SYNC_SECRET,
    "X-Khuzoe-Sync-Contract": "1", "X-Khuzoe-Foundry-Generation": "14" },
  body: JSON.stringify({ categories, expectedRevision }),
}), env, {});
assert.equal((await saveFolders(subfolders)).status, 200, "nomi uguali sono validi in cartelle diverse");
const readFolders = await worker.fetch(new Request(endpoint), env, {});
assert.equal((await readFolders.json()).data.categories.find(category => category.id === "armi-geniali").parentId, "arma");
for (const invalid of [
  [...subfolders, { id: "duplicata", name: "Geniali", parentId: "arma" }],
  [...subfolders, { id: "troppo-profonda", name: "Altro", parentId: "armi-geniali" }],
  subfolders.filter(category => category.id !== "arma"),
  subfolders.map(category => category.id === "arma" ? { ...category, archived: true } : category),
]) assert.equal((await saveFolders(invalid, 1)).status, 400);

function snapshot({ folder = "Cripta Wiki Items / Armi", id = "arma", name = "Armi", version = 0 } = {}) {
  return {
    folderPath: folder,
    document: {
      flags: {
        "cripta-wiki-sync": {
          categoryId: id,
          categoryName: name,
          ...(version ? { categoryIdentityVersion: version } : {}),
        },
      },
    },
  };
}

assert.deepEqual(
  campaignItemCategoryFromSnapshot(snapshot({ folder: "Cripta Wiki Items / Armature", id: "arma", name: "Armi" })),
  { id: "armature", name: "Armature" },
  "un vecchio modulo continua a usare il percorso quando i suoi flag sono obsoleti",
);
assert.deepEqual(
  campaignItemCategoryFromSnapshot(snapshot({ folder: "Cripta Wiki Items / Nome visuale", id: "arma", name: "Armi", version: 2 })),
  { id: "arma", name: "Armi" },
  "il nuovo modello usa l'identita stabile anche durante una rinomina",
);

assert.deepEqual(
  campaignItemArchiveFromSnapshot({
    folderPath: "Cripta Wiki Items / _ARCHIVIATI",
    document: { flags: { "cripta-wiki-sync": { archived: true, archiveIdentityVersion: 1 } } },
  }),
  { known: true, archived: true },
  "la cartella riservata archivia l'oggetto senza cancellarlo",
);
assert.deepEqual(
  campaignItemArchiveFromSnapshot({
    folderPath: "Cripta Wiki Items / Armi",
    document: { flags: { "cripta-wiki-sync": { archived: false, archiveIdentityVersion: 1 } } },
  }),
  { known: true, archived: false },
  "uscire dall'archivio ripristina l'oggetto",
);

const next = { categoryId: "arma", category: "Armi" };
applyCampaignItemCategoryFromFoundry(next, next, null, snapshot({ id: "armatura", name: "Armature", version: 2 }));
assert.deepEqual(next, { categoryId: "armatura", category: "Armature" }, "uno spostamento Foundry aggiorna il sito");

const pending = { categoryId: "arma", category: "Armi" };
applyCampaignItemCategoryFromFoundry(pending, pending, null, snapshot({ id: "armatura", name: "Armature", version: 2 }), { preserveSiteChanges: true });
assert.deepEqual(pending, { categoryId: "arma", category: "Armi" }, "una modifica sito pendente non viene sovrascritta");

const moduleSource = fs.readFileSync(new URL("../module/scripts/services/campaign-item-sync.js", import.meta.url), "utf8");
const folders = new Map();
folders[Symbol.iterator] = folders.values;
function addFolder(data) {
  const flags = { ...data.flags?.["cripta-wiki-sync"] };
  const folder = {
    ...data, id: String(folders.size + 1),
    getFlag(_scope, name) { return flags[name]; },
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key.startsWith("flags.")) flags[key.split(".").at(-1)] = value;
        else this[key] = value;
      }
    },
  };
  folders.set(folder.id, folder);
  return folder;
}
const root = addFolder({ type: "Item", name: "Cripta Wiki Items" });
const normalizeKey = value => String(value || "").trim().toLowerCase();
const foundry = vm.createContext({
  MODULE_ID: "cripta-wiki-sync", CATEGORY_FOLDER_ID_FLAG: "categoryId", CATEGORY_FOLDER_NAME_FLAG: "categoryName",
  game: { folders }, Folder: { create: addFolder }, getRootFolder: () => root, getOrCreateRootFolder: async () => root,
  isArchiveFolder: () => false, normalizeId: normalizeKey, normalizeName: normalizeKey, mapRecordType: () => "equipment",
  latestCategoryRegistry: { categories: subfolders },
});
const moduleSection = (start, end) => moduleSource.slice(moduleSource.indexOf(start), moduleSource.indexOf(end)).replaceAll("export function", "function");
vm.runInContext(moduleSection("function folderParentId(", "function defaultCategoryNameForFoundryType(")
  + moduleSection("function categoryIdentityForFolder(", "function categoryFolderNeedsRegistration(")
  + "\nglobalThis.createCategory = getOrCreateCategoryFolder;", foundry);
const firstBranch = await foundry.createCategory({ categoryId: "armi-geniali" }, { categories: subfolders });
const secondBranch = await foundry.createCategory({ categoryId: "armature-geniali" }, { categories: subfolders });
assert.notEqual(firstBranch.id, secondBranch.id);
assert.equal(folders.get(firstBranch.folder).name, "Arma");
assert.equal(folders.get(secondBranch.folder).name, "Armatura");
assert.equal(foundry.categoryFolderForItem({ folder: firstBranch.id }).id, firstBranch.id);
assert.equal(foundry.categoryIdentityForWorldItem({ folder: firstBranch.id }).id, "armi-geniali");
assert.equal(foundry.categoryIdentityForWorldItem({ folder: secondBranch.id }).id, "armature-geniali");
const movedCategories = subfolders.map(category => category.id === "armi-geniali" ? { ...category, name: "Speciali", parentId: "armatura" } : category);
const moved = await foundry.createCategory({ categoryId: "armi-geniali" }, { categories: movedCategories });
assert.equal(moved.id, firstBranch.id, "spostare una sottocartella conserva il documento Folder");
assert.equal(moved.name, "Speciali");
assert.equal(moved.folder, secondBranch.folder);
const folderOnlyBranch = moduleSource.match(/else if \(folderChanged \|\| categoryIdentityChanged\) \{([\s\S]*?)localChanges \+= 1;/)?.[1] || "";
assert.ok(folderOnlyBranch, "la migrazione cartelle deve avere un ramo limitato alla categoria");
assert.match(moduleSource, /ARCHIVE_FOLDER_NAME\s*=\s*"_ARCHIVIATI"/, "Foundry usa una cartella archivio riservata");
assert.match(moduleSource, /getOrCreateItemFolder\(record, categoryRegistry\)/, "il reconcile sceglie tra categoria e archivio");
assert.doesNotMatch(
  folderOnlyBranch,
  /buildWorldItemUpdate|\bsystem\b|\beffects\b|\bimg\b/,
  "spostare una categoria non deve riscrivere contenuti o immagini dell'oggetto",
);

assert.equal(
  recordHasFoundryIntent({ foundryNames: ["Scudo di Ginevra"] }),
  true,
  "un alias Foundry esplicito rende sincronizzabile un record legacy del sito",
);
assert.equal(
  recordHasFoundryIntent({ name: "Oggetto soltanto narrativo" }),
  false,
  "un record legacy senza collegamenti non viene creato automaticamente in Foundry",
);
assert.equal(isAcceptedCampaignItemSnapshotResult({ campaignItemId: "scudo", status: "saved" }), true);
assert.equal(isAcceptedCampaignItemSnapshotResult({ campaignItemId: "scudo", status: "unchanged" }), true);
assert.equal(isAcceptedCampaignItemSnapshotResult({ campaignItemId: "scudo", status: "invalid" }), false);
assert.equal(isAcceptedCampaignItemSnapshotResult({ campaignItemId: "scudo", status: "conflict" }), false);
assert.equal(isCampaignItemAttunementRequired("required"), true);
assert.equal(isCampaignItemAttunementRequired(""), false);
assert.equal(
  shouldRepairLegacyCampaignItemAttunement({
    attunement: true,
    sync: { pendingFoundry: false, siteRevision: 0 },
    foundry: { document: { system: { attunement: "" } } },
  }, { system: { attunement: "" } }),
  true,
  "un requisito legacy del sito viene proiettato una sola volta su Foundry",
);
assert.equal(
  shouldRepairLegacyCampaignItemAttunement({
    attunement: true,
    sync: { pendingFoundry: false, siteRevision: 1 },
    foundry: { document: { system: { attunement: "" } } },
  }, { system: { attunement: "" } }),
  false,
  "le revisioni del flusso nuovo non usano la riparazione legacy",
);

assert.deepEqual(
  campaignItemClassificationFromDocument({
    type: "equipment",
    system: { type: { value: "medium", baseItem: "halfplate" } },
  }),
  { version: 1, family: "armor", subtype: "medium", baseItem: "halfplate" },
  "Foundry esporta categoria di armatura e oggetto base in campi strutturati",
);
assert.deepEqual(
  campaignItemClassificationFromDocument({
    type: "weapon",
    system: { type: { value: "martialR", baseItem: "longbow" } },
  }),
  { version: 1, family: "weapon", subtype: "martialR", baseItem: "longbow" },
  "Foundry esporta anche il tipo meccanico delle armi",
);
assert.match(
  moduleSource,
  /system\.type\s*=\s*\{[\s\S]*?value:\s*String\(classification\.subtype/,
  "il modulo proietta la classificazione del sito nel sistema dnd5e",
);
const localImage = "worlds/oltre-il-velo/Oggetti/Lino del fiume Oceanus.webp";
assert.equal(
  normalizeItemImage(localImage, "oltre-il-velo"),
  localImage,
  "un'immagine Foundry con spazi non blocca l'import dell'oggetto",
);
assert.equal(normalizeItemImage("javascript:alert(1)", "oltre-il-velo"), null);
const safeSnapshot = normalizeFoundrySnapshot({
  itemId: "oceanus",
  uuid: "Item.oceanus",
  folderPath: "Cripta Wiki Items / Materiali",
  document: {
    name: "Lino del fiume Oceanus",
    type: "loot",
    img: "javascript:alert(1)",
    system: {},
    effects: [],
    flags: {},
  },
}, "oltre-il-velo", "oltre-il-velo");
assert.ok(safeSnapshot, "un'immagine non sicura non deve scartare tutto lo snapshot");
assert.equal(safeSnapshot.document.img, "", "solo il percorso immagine non sicuro viene omesso");

console.log("Categorie oggetti: identita stabile, rinomina, merge e conflitti verificati.");
