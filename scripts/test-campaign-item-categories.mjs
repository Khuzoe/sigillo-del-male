import assert from "node:assert/strict";
import fs from "node:fs";
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
