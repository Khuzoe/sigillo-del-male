import assert from "node:assert/strict";
import fs from "node:fs";
import { categoryFolderName, resolveRecordCategory } from "../module/scripts/services/campaign-item-sync.js";
import { applyCampaignItemCategoryFromFoundry, campaignItemCategoryFromSnapshot } from "../workers/main-worker/src/campaign-items.js";

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

const next = { categoryId: "arma", category: "Armi" };
applyCampaignItemCategoryFromFoundry(next, next, null, snapshot({ id: "armatura", name: "Armature", version: 2 }));
assert.deepEqual(next, { categoryId: "armatura", category: "Armature" }, "uno spostamento Foundry aggiorna il sito");

const pending = { categoryId: "arma", category: "Armi" };
applyCampaignItemCategoryFromFoundry(pending, pending, null, snapshot({ id: "armatura", name: "Armature", version: 2 }), { preserveSiteChanges: true });
assert.deepEqual(pending, { categoryId: "arma", category: "Armi" }, "una modifica sito pendente non viene sovrascritta");

const moduleSource = fs.readFileSync(new URL("../module/scripts/services/campaign-item-sync.js", import.meta.url), "utf8");
const folderOnlyBranch = moduleSource.match(/else if \(folderChanged \|\| categoryIdentityChanged\) \{([\s\S]*?)localChanges \+= 1;/)?.[1] || "";
assert.ok(folderOnlyBranch, "la migrazione cartelle deve avere un ramo limitato alla categoria");
assert.doesNotMatch(
  folderOnlyBranch,
  /buildWorldItemUpdate|\bsystem\b|\beffects\b|\bimg\b/,
  "spostare una categoria non deve riscrivere contenuti o immagini dell'oggetto",
);

console.log("Categorie oggetti: identita stabile, rinomina, merge e conflitti verificati.");
