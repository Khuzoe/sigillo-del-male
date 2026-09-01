import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../workers/main-worker/src/index.js";

class MemoryKv {
  constructor() {
    this.store = new Map();
  }
  async get(key) {
    return this.store.get(key) ?? null;
  }
  async put(key, value) {
    this.store.set(key, String(value));
  }
  async delete(key) {
    this.store.delete(key);
  }
}

const campaignId = "test-campaign";
const worldId = "test-world";
const actorId = "test-actor";
const secret = "managed-actor-test-secret";
const baseUrl = `https://worker.test/api/managed-actors/${worldId}/${actorId}?campaign=${campaignId}`;
const mediaPrefix = `campaigns/${campaignId}/managed-actors/${worldId}/${actorId}/base/`;
const r2Objects = new Set([
  `${mediaPrefix}avatar-r1.webp`,
  `${mediaPrefix}token-r1.webp`,
  `${mediaPrefix}token-r2.webp`,
  `${mediaPrefix}token-r3.webp`,
]);
const deletedR2 = [];
const kv = new MemoryKv();
const env = {
  INVENTORY_SYNC_SECRET: secret,
  SIGILLO_KV: kv,
  MEDIA_BUCKET: {
    async head(key) {
      return r2Objects.has(key) ? { key } : null;
    },
    async delete(key) {
      deletedR2.push(key);
      r2Objects.delete(key);
    },
  },
};
const waits = [];
const ctx = { waitUntil(promise) { waits.push(Promise.resolve(promise)); } };
const headers = {
  "Content-Type": "application/json",
  "X-Cripta-Inventory-Secret": secret,
  "X-Khuzoe-Sync-Contract": "1",
  "X-Khuzoe-Foundry-Generation": "14",
};
const contract = {
  name: "khuzoe-wiki-sync",
  version: 1,
  module: { id: "cripta-wiki-sync", version: "0.9.0" },
  foundry: { generation: 14, version: "14.367" },
  system: { id: "dnd5e", version: "5.3.3" },
};

function media(path, revision = 1) {
  return { path: `media/${path}`, revision, source: "foundry" };
}

async function post(body) {
  const response = await worker.fetch(new Request(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ campaignId, contract, ...body }),
  }), env, ctx);
  const payload = await response.json();
  return { response, payload };
}

async function getDocument() {
  const response = await worker.fetch(new Request(baseUrl, { headers }), env, ctx);
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

const initial = await post({
  expectedRevision: 0,
  writeScopes: ["content", "media"],
  mediaWriteTargets: ["avatar", "token"],
  name: "Actor integro",
  actorType: "npc",
  definition: { marker: "original", attributes: { hp: { max: 203 } } },
  runtime: { hp: { value: 203 } },
  system: { id: "dnd5e" },
  contentHash: "content-r1",
  mediaHash: "media-r1",
  media: {
    avatar: media(`${mediaPrefix}avatar-r1.webp`),
    token: media(`${mediaPrefix}token-r1.webp`),
    variants: [],
  },
});
assert.equal(initial.response.status, 200);
assert.equal(initial.payload.revision, 1);

const mediaOnly = await post({
  expectedRevision: 1,
  writeScopes: ["media"],
  mediaWriteTargets: ["token"],
  name: "NON DEVE VINCERE",
  actorType: "character",
  definition: { marker: "NON DEVE VINCERE" },
  runtime: { hp: { value: 1 } },
  system: { id: "wrong" },
  contentHash: "wrong-content",
  mediaHash: "media-r2",
  media: {
    avatar: media(`${mediaPrefix}avatar-r1.webp`),
    token: media(`${mediaPrefix}token-r2.webp`, 2),
    variants: [],
  },
});
assert.equal(mediaOnly.response.status, 200);
assert.equal(mediaOnly.payload.revision, 2);
let stored = await getDocument();
assert.equal(stored.name, "Actor integro");
assert.equal(stored.actorType, "npc");
assert.equal(stored.definition.marker, "original");
assert.equal(stored.runtime.hp.value, 203);
assert.equal(stored.system.id, "dnd5e");
assert.equal(stored.contentHash, "content-r1");
assert.equal(stored.media.token.path, `media/${mediaPrefix}token-r2.webp`);
assert.deepEqual(deletedR2, [], "il media sostituito non deve essere eliminato subito");

const stale = await post({
  expectedRevision: 1,
  writeScopes: ["content", "media"],
  definition: { marker: "stale" },
  contentHash: "stale",
  mediaHash: "stale",
  media: stored.media,
});
assert.equal(stale.response.status, 409);
assert.equal(stale.payload.code, "VERSION_CONFLICT");
stored = await getDocument();
assert.equal(stored.revision, 2);
assert.equal(stored.definition.marker, "original");

const missing = await post({
  expectedRevision: 2,
  writeScopes: ["media"],
  mediaWriteTargets: ["token"],
  contentHash: "wrong-again",
  mediaHash: "missing-media",
  media: {
    ...stored.media,
    token: media(`${mediaPrefix}missing.webp`, 3),
  },
});
assert.equal(missing.response.status, 409);
assert.equal(missing.payload.code, "MEDIA_OBJECT_MISSING");
stored = await getDocument();
assert.equal(stored.revision, 2);
assert.equal(stored.media.token.path, `media/${mediaPrefix}token-r2.webp`);

const cleanupEntry = Array.from(kv.store.entries()).find(([key]) => key.includes("managed-actor-media-cleanup:"));
assert.ok(cleanupEntry, "la sostituzione deve creare una coda di pulizia differita");
const cleanupDocument = JSON.parse(cleanupEntry[1]);
assert.equal(cleanupDocument.entries.some((entry) => entry.key === `${mediaPrefix}token-r1.webp`), true);
cleanupDocument.entries.forEach((entry) => { entry.deleteAfter = 0; });
await kv.put(cleanupEntry[0], JSON.stringify(cleanupDocument));

const nextMedia = await post({
  expectedRevision: 2,
  writeScopes: ["media"],
  mediaWriteTargets: ["token"],
  contentHash: "still-must-not-win",
  mediaHash: "media-r3",
  media: {
    ...stored.media,
    token: media(`${mediaPrefix}token-r3.webp`, 3),
  },
});
assert.equal(nextMedia.response.status, 200);
assert.equal(nextMedia.payload.revision, 3);
assert.equal(deletedR2.includes(`${mediaPrefix}token-r1.webp`), true, "il media scaduto deve essere eliminato solo dopo il grace period");
stored = await getDocument();
assert.equal(stored.definition.marker, "original");
assert.equal(stored.media.token.path, `media/${mediaPrefix}token-r3.webp`);

const perInstance = await post({
  expectedRevision: 3,
  writeScopes: ["content", "media"],
  name: stored.name,
  actorType: "npc",
  definition: {
    ...stored.definition,
    prototypeToken: { actorLink: false },
  },
  system: stored.system,
  contentHash: "content-per-instance",
  mediaHash: "media-r3",
  media: stored.media,
});
assert.equal(perInstance.response.status, 200);
stored = await getDocument();
assert.equal(stored.entityKind, "creature");
assert.equal(stored.runtimePolicy, "per-instance");
assert.deepEqual(stored.runtime, {}, "il runtime precedente resta conservato ma non deve essere esposto per una creatura unlinked");

const runtimeResponse = await worker.fetch(new Request(`${baseUrl.split("?")[0]}/runtime?campaign=${campaignId}`, {
  method: "POST",
  headers,
  body: JSON.stringify({ campaignId, runtime: { hp: { value: 1, temp: 5 } } }),
}), env, ctx);
const runtimePayload = await runtimeResponse.json();
assert.equal(runtimeResponse.status, 200);
assert.equal(runtimePayload.saved, false);
assert.equal(runtimePayload.ignored, "per-instance-runtime");

const separatedPolicy = await post({
  expectedRevision: stored.revision,
  writeScopes: ["content"],
  name: stored.name,
  actorType: "npc",
  runtimePolicy: "shared",
  definition: {
    ...stored.definition,
    prototypeToken: { actorLink: false },
  },
  runtime: { hp: { value: 150 } },
  system: stored.system,
  contentHash: "content-shared-with-unlinked-prototype",
});
assert.equal(separatedPolicy.response.status, 200);
stored = await getDocument();
assert.equal(stored.definition.prototypeToken.actorLink, false, "actorLink deve restare la proprieta Foundry strutturale autorevole");
assert.equal(stored.runtimePolicy, "per-instance", "una classificazione manuale non deve trasformare un token indipendente in stato condiviso");
assert.deepEqual(stored.runtime, {}, "il runtime condiviso non deve riapparire finche actorLink resta disattivato");

const indexEntry = Array.from(kv.store.entries()).find(([key]) => key.includes("managed-actors:index"));
assert.ok(indexEntry, "la sincronizzazione deve creare l'indice dei Managed Actor");
const staleIndex = JSON.parse(indexEntry[1]);
delete staleIndex.actorLinkIndexVersion;
staleIndex.data = staleIndex.data.map((entry) => entry.actorId === actorId
  ? { ...entry, actorLink: null, entityKind: "person", runtimePolicy: "shared" }
  : entry);
await kv.put(indexEntry[0], JSON.stringify(staleIndex));
const repairedDirectoryResponse = await worker.fetch(new Request(
  `https://worker.test/api/managed-actors?campaign=${campaignId}&view=directory`,
  { headers },
), env, ctx);
const repairedDirectoryPayload = await repairedDirectoryResponse.json();
assert.equal(repairedDirectoryResponse.status, 200);
const repairedDirectoryActor = repairedDirectoryPayload.data.find((entry) => entry.actorId === actorId);
assert.equal(repairedDirectoryActor.actorLink, false, "la directory deve recuperare actorLink dai documenti autorevoli");
assert.equal(repairedDirectoryActor.entityKind, "creature", "un vecchio indice stale deve essere riparato come Bestiario");
assert.equal(repairedDirectoryActor.runtimePolicy, "per-instance");
const repairedStoredIndex = JSON.parse(await kv.get(indexEntry[0]));
assert.equal(repairedStoredIndex.actorLinkIndexVersion, 1, "la riparazione dell'indice deve avvenire una sola volta");
assert.equal(repairedStoredIndex.data.find((entry) => entry.actorId === actorId).actorLink, false);
const sharedRuntimeResponse = await worker.fetch(new Request(`${baseUrl.split("?")[0]}/runtime?campaign=${campaignId}`, {
  method: "POST",
  headers,
  body: JSON.stringify({ campaignId, runtime: { hp: { value: 149, temp: 2 } } }),
}), env, ctx);
const sharedRuntimePayload = await sharedRuntimeResponse.json();
assert.equal(sharedRuntimeResponse.status, 200);
assert.equal(sharedRuntimePayload.saved, false);
stored = await getDocument();
assert.deepEqual(stored.runtime, {});

const moduleSyncSource = await readFile(new URL("../module/scripts/services/managed-actor-sync.js", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../workers/main-worker/src/index.js", import.meta.url), "utf8");
const managedActorFeSource = await readFile(new URL("../assets/js/pages/managed-actor.js", import.meta.url), "utf8");
const playerRosterFeSource = await readFile(new URL("../assets/js/pages/giocatori.js", import.meta.url), "utf8");
const layoutFeSource = await readFile(new URL("../assets/js/layout.js", import.meta.url), "utf8");
assert.doesNotMatch(moduleSyncSource, /\u00C3|\u00C2/, "il modulo non deve contenere testo UTF-8 ricodificato");
assert.match(moduleSyncSource, /console\.table\(diagnostics\)/, "un fallimento Link Actor deve mostrare una tabella leggibile delle differenze");
assert.match(moduleSyncSource, /error\.diagnostics = diagnostics/, "il dettaglio della verifica deve restare disponibile anche nell errore di rollback");
assert.match(moduleSyncSource, /conversionDiagnostics[\s\S]+rollbackDiagnostics/, "il log di rollback deve distinguere il fallimento originale da quello del ripristino");
assert.match(moduleSyncSource, /\\u00B7 \$\{scene\.name/, "il nome dell'istanza deve separare token e scena con un punto medio stabile");
const foundryLiveSyncSource = await readFile(new URL("../module/scripts/services/foundry-live-sync.js", import.meta.url), "utf8");
const moduleMainSource = await readFile(new URL("../module/scripts/main.js", import.meta.url), "utf8");
assert.match(moduleSyncSource, /export async function pullManagedActorCommandsNow/, "il modulo deve poter controllare la sola coda comandi senza riallineare tutti gli Actor");
assert.match(moduleSyncSource, /if \(managedActorCommandPullPromise\) return managedActorCommandPullPromise/, "due controlli della coda non devono applicare lo stesso comando contemporaneamente");
assert.match(moduleSyncSource, /managedActorCommandPullPromise = executeManagedActorCommandPull\(worldId\)/, "la coda deve usare una singola esecuzione condivisa");
assert.match(foundryLiveSyncSource, /COMMAND_SAFETY_FALLBACK_INTERVAL_MS = 60_000/, "un comando perso dal canale live deve essere recuperato entro un minuto");
assert.match(foundryLiveSyncSource, /queueManagedActorCommandCheck\("live-connected"\)/, "la prima connessione live deve recuperare i comandi creati durante l'avvio");
assert.match(foundryLiveSyncSource, /startsWith\("managed-actor-command:"\)/, "le notifiche di comando devono usare il controllo leggero dedicato");
assert.match(moduleMainSource, /pullManagedActorCommands: pullManagedActorCommandsNow/, "il canale live deve ricevere il callback leggero dei comandi");
assert.match(moduleSyncSource, /applyManagedActorLinkConversion/, "la conversione Link Actor deve usare un flusso dedicato");
assert.match(moduleSyncSource, /captureManagedActorLinkSnapshot/, "la conversione deve salvare uno snapshot prima di modificare Actor o token");
assert.match(moduleSyncSource, /restoreManagedActorLinkSnapshot/, "la conversione deve prevedere un rollback completo");
assert.match(moduleSyncSource, /async function rollbackManagedActorLinkConversion/, "una conversione completata deve poter ripristinare esplicitamente il backup");
assert.match(moduleSyncSource, /"actor-link.rollback"/, "il client Foundry deve accettare il comando di ripristino Link Actor");
assert.match(workerSource, /kind === "actor-link.rollback"/, "il Worker deve accodare il ripristino Link Actor");
assert.match(managedActorFeSource, /rollbackManagedActorLinkSelection/, "il FE deve esporre il ripristino della conversione completata");
assert.doesNotMatch(moduleSyncSource, /ui\.notifications\.info\(`\$\{actor\.name\}: Link Actor Data/, "la sincronizzazione riuscita degli NPC deve restare soltanto in console");
const managedActorLinkDisplayBlock = managedActorFeSource.match(/function managedActorLinkDisplayValue[\s\S]+?(?=\r?\n    function managedActorLinkResourceLabel)/)?.[0];
assert.ok(managedActorLinkDisplayBlock, "il FE deve tradurre le differenze tecniche in valori leggibili");
const displayManagedActorLinkValue = new Function("managedActorLinkValue", `${managedActorLinkDisplayBlock}\nreturn managedActorLinkDisplayValue;`)((value) => String(value));
assert.equal(
  displayManagedActorLinkValue("Danni attivita", JSON.stringify({ includeBase: true, parts: [{ number: 4, denomination: 8, bonus: "31" }] })),
  "Danno base incluso + 4d8 + 31",
  "anche le ispezioni gia in coda con JSON grezzo devono mostrare la formula dei danni",
);
assert.match(moduleSyncSource, /managedActorLinkItemStateDifferences/, "l'ispezione deve descrivere le differenze di stato degli oggetti");
assert.match(moduleSyncSource, /managedActorLinkPairItemStates/, "gli oggetti di Actor e token devono essere associati con identita progressive");
assert.match(moduleSyncSource, /managedActorLinkEffectDifferences/, "l'ispezione deve indicare gli effetti diversi tra Actor e token");
assert.match(moduleSyncSource, /managedActorLinkDefinitionDifferences/, "l'ispezione deve confrontare statistiche, competenze e tratti");
assert.match(moduleSyncSource, /managedActorLinkResolvedSystemValue\(sourceActor, `abilities\.\$\{key\}\.value`/, "STR, DEX e le altre caratteristiche devono usare i valori risolti del token sintetico");
const captureLinkSnapshotBlock = moduleSyncSource.match(/function captureManagedActorLinkSnapshot[\s\S]+?(?=\r?\nasync function restoreManagedActorLinkSnapshot)/)?.[0] || "";
assert.match(captureLinkSnapshotBlock, /actorSystem: managedActorLinkSystemState\(actor\)/, "lo snapshot deve proteggere l intero sistema Actor");
assert.match(captureLinkSnapshotBlock, /actorDocument: managedActorLinkNativeActorSource\(actor\)/, "i nuovi backup devono conservare il documento Actor nativo completo");
assert.doesNotMatch(captureLinkSnapshotBlock, /actorDefinitionState:/, "i nuovi backup non devono serializzare il modello abilities deprecato una seconda volta");
assert.match(moduleSyncSource, /DocumentClass\.fromImport\(foundry\.utils\.deepClone\(source\)\)/, "la conversione deve affidare migrazione e validazione al percorso nativo di Foundry");
assert.match(moduleSyncSource, /collection\.fromCompendium\(imported\)/, "l'importazione completa deve usare la trasformazione nativa da compendio");
assert.match(moduleSyncSource, /noHook: true[\s\S]+criptaWikiSyncCommand: true/, "l'importazione nativa non deve generare una seconda sincronizzazione durante la transazione");
const executeManagedActorLinkBlock = moduleSyncSource.match(/async function executeManagedActorLinkConversion[\s\S]+?(?=\r?\nasync function applyManagedActorLinkConversion)/)?.[0] || "";
assert.match(executeManagedActorLinkBlock, /importManagedActorLinkActorDocument\(actor, selectedState\.actorDocument\)/, "lo stato selezionato deve usare il JSON Actor completo");
assert.doesNotMatch(executeManagedActorLinkBlock, /nativeImport\.verification|nativa integrale/, "il percorso nativo riuscito non deve essere invalidato da una seconda ricostruzione euristica");
assert.doesNotMatch(executeManagedActorLinkBlock, /mappedStructural|verifyManagedActorLinkCanonicalState/, "la conversione nativa non deve passare dalla vecchia associazione euristica degli Item");
assert.doesNotMatch(executeManagedActorLinkBlock, /applyManagedActorLink(SystemState|StructuralState|Runtime|ActorEnvelope)\(actor, selectedState\./, "la conversione non deve piu ricostruire manualmente sottoinsiemi dell'Actor");
assert.match(moduleSyncSource, /applyManagedActorLinkPlacedTokens\(actor, selectedState\.tokenConfiguration\)/, "tutte le istanze devono ricevere la configurazione del token autorevole");
assert.match(moduleSyncSource, /verifyManagedActorLinkPlacedTokens/, "la conversione deve verificare anche tutte le istanze in scena");
assert.match(moduleSyncSource, /managedActorLinkItemDefinitionSignature/, "le modifiche meccaniche interne agli oggetti devono bloccare una conversione distruttiva");
assert.doesNotMatch(moduleSyncSource, /foundry\.utils\.unsetProperty/, "la firma degli oggetti deve essere compatibile anche con Foundry senza unsetProperty");
assert.match(moduleSyncSource, /applyManagedActorLinkPrototypeConfiguration\(actor, selectedState\.tokenConfiguration, true\)/, "actorLink puo essere attivato soltanto dalla conversione autoritativa confermata");
assert.match(moduleSyncSource, /patch\?\.path !== ["']prototypeToken\.actorLink["']/, "i normali comandi actor.update non devono poter cambiare actorLink");
assert.doesNotMatch(executeManagedActorLinkBlock, /captureManagedActorLinkStructuralState/, "la verifica nativa non deve rinominare o riassociare gli Item selezionati");
const nativeActorSourceBlock = moduleSyncSource.match(/function managedActorLinkNativeActorSource[\s\S]+?(?=\r?\nasync function importManagedActorLinkActorDocument)/)?.[0] || "";
assert.ok(nativeActorSourceBlock, "la cattura JSON nativa dell'Actor deve essere testabile");
const captureNativeActorSource = new Function(
  "foundry",
  `${nativeActorSourceBlock}\nreturn managedActorLinkNativeActorSource;`,
)({ utils: { deepClone: (value) => structuredClone(value) } });
assert.deepEqual(
  captureNativeActorSource({
    toJSON: () => ({ marker: "token-actor-json", items: [{ _id: "slam" }] }),
    toObject: () => { throw new Error("toObject non deve sostituire un toJSON valido"); },
  }),
  { marker: "token-actor-json", items: [{ _id: "slam" }] },
  "la sorgente deve coincidere con JSON.stringify(token.actor)",
);

const nativeActorImportBlock = moduleSyncSource.match(/async function importManagedActorLinkActorDocument[\s\S]+?(?=\r?\nfunction managedActorLinkSemanticValue)/)?.[0] || "";
assert.ok(nativeActorImportBlock, "il percorso nativo di importazione Actor deve essere testabile");
const nativeImportEvents = [];
const nativeFoundry = {
  utils: {
    deepClone: (value) => structuredClone(value),
    getProperty: (object, path) => String(path).split(".").reduce((value, key) => value?.[key], object),
    mergeObject: (target, source) => Object.assign(target, structuredClone(source)),
  },
};
class NativeImportActorDocument {}
NativeImportActorDocument.metadata = { preserveOnImport: ["_id", "ownership", "sort"] };
NativeImportActorDocument.fromImport = async (source) => {
  nativeImportEvents.push({ kind: "from-import", source: structuredClone(source) });
  return { source: structuredClone(source) };
};
const nativeImportActor = {
  constructor: NativeImportActorDocument,
  _id: "actor-target",
  ownership: { default: 3 },
  sort: 42,
  folder: { id: "folder-target" },
  collection: {
    fromCompendium(imported) {
      nativeImportEvents.push({ kind: "from-compendium" });
      const data = structuredClone(imported.source);
      delete data._id;
      data.ownership = { default: 0 };
      return data;
    },
  },
  async update(data, options) {
    nativeImportEvents.push({ kind: "update", data: structuredClone(data), options: structuredClone(options) });
  },
};
const importNativeActorDocument = new Function(
  "foundry",
  `${nativeActorImportBlock}\nreturn importManagedActorLinkActorDocument;`,
)(nativeFoundry);
const nativeImportResult = await importNativeActorDocument(nativeImportActor, {
  _id: "actor-source",
  name: "Sorgente",
  _stats: { coreVersion: "12.331" },
  items: [{ _id: "slam", name: "Slam" }],
  effects: [{ _id: "dead", name: "Dead" }],
});
assert.deepEqual(nativeImportEvents.map((entry) => entry.kind), ["from-import", "from-compendium", "update"]);
assert.equal(nativeImportEvents[0].source._stats.coreVersion, "12.331", "la migrazione nativa deve ricevere i metadati di versione");
const nativeUpdate = nativeImportEvents.at(-1);
assert.equal(nativeUpdate.data._id, "actor-target", "l'importazione deve conservare l'identita del world Actor");
assert.deepEqual(nativeUpdate.data.ownership, { default: 3 }, "l'importazione deve conservare i permessi del world Actor");
assert.equal(nativeUpdate.data.folder, "folder-target", "l'importazione deve conservare la cartella del world Actor");
assert.equal(nativeUpdate.data.items[0]._id, "slam", "gli Item devono mantenere l'identita scelta nel token sorgente");
assert.equal(nativeUpdate.options.noHook, true);
assert.deepEqual(nativeImportResult.expectedSource, nativeUpdate.data, "la verifica deve usare esattamente il payload normalizzato inviato a Foundry");
assert.equal(nativeUpdate.options.diff, false);
assert.equal(nativeUpdate.options.recursive, false);
const nativeActorVerificationBlock = moduleSyncSource.match(/const MANAGED_ACTOR_LINK_NATIVE_IGNORED_ROOT_KEYS[\s\S]+?(?=\r?\nfunction managedActorLinkSemanticValue)/)?.[0] || "";
const directImportGuards = new Set();
const directImportEvents = [];
const directImportActor = {
  id: "actor-target",
  name: "Prototype",
  persisted: null,
  async importFromJSON(json) {
    const parsed = JSON.parse(json);
    directImportEvents.push(parsed);
    this.persisted = structuredClone(parsed);
    return this;
  },
};
const importActorJsonDirectly = new Function(
  "foundry", "managedActorLinkNativeImports", "managedActorLinkNativeActorSource",
  `${nativeActorImportBlock}\nreturn importManagedActorLinkActorDocument;`,
)(
  nativeFoundry,
  directImportGuards,
  (actor) => structuredClone(actor.persisted),
);
const directActorJson = {
  _id: "synthetic-source",
  name: "Token scelto",
  system: { attributes: { hp: { value: 198, max: 225 } } },
  items: [{ _id: "summon-fey", name: "Summon Fey", system: { target: { affects: { count: null } } } }],
  effects: [{ _id: "dead", name: "Dead" }],
};
const directImportResult = await importActorJsonDirectly(directImportActor, directActorJson);
assert.deepEqual(directImportEvents, [directActorJson], "il JSON completo del token deve essere passato invariato a importFromJSON");
assert.deepEqual(directImportResult.expectedSource, directActorJson, "il risultato deve essere lo stato realmente persistito dal percorso nativo");
assert.equal(directImportGuards.size, 0, "la protezione dagli hook deve essere sempre rimossa dopo l'importazione");

assert.ok(nativeActorVerificationBlock, "la verifica del documento nativo deve essere testabile");
const nativeStableStringify = (value) => JSON.stringify(value);
const verifyNativeActorDocument = new Function(
  "stableStringify", "managedActorLinkNativeActorSource",
  "managedActorLinkCanonicalDifferencePaths", "managedActorLinkCanonicalDifferenceLabel",
  `${nativeActorVerificationBlock}\nreturn verifyManagedActorLinkNativeDocument;`,
)(
  nativeStableStringify,
  (actor) => structuredClone(actor.toObject()),
  (expected, actual) => nativeStableStringify(expected) === nativeStableStringify(actual) ? [] : ["items.0.name"],
  (path, expected, actual) => `${expected.items?.[0]?.name || actual.items?.[0]?.name || "Elemento"} - ${path}`,
);
const nativeUnidentifiedSource = {
  _id: "actor-target",
  name: "Gianni",
  prototypeToken: { actorLink: false },
  _stats: { modifiedTime: 100 },
  system: { attributes: { hp: { value: 198, max: 225 } } },
  items: [{ _id: "flame-tongue", name: "Flame Tongue Longsword", system: { identified: false } }],
  effects: [],
};
const nativeUnidentifiedActor = {
  items: [{ _id: "flame-tongue", name: "[Non Identificato] Spada di Fuoco" }],
  toObject: () => ({
    ...structuredClone(nativeUnidentifiedSource),
    prototypeToken: { actorLink: true },
    _stats: { modifiedTime: 999 },
  }),
};
assert.equal(
  verifyNativeActorDocument(nativeUnidentifiedActor, nativeUnidentifiedSource).ok,
  true,
  "un nome preparato/localizzato non deve invalidare un JSON persistente importato correttamente",
);
assert.equal(
  verifyNativeActorDocument({
    ...nativeUnidentifiedActor,
    toObject: () => ({
      ...structuredClone(nativeUnidentifiedSource),
      items: [{ _id: "flame-tongue", name: "Oggetto realmente diverso", system: { identified: false } }],
    }),

  }, nativeUnidentifiedSource).ok,
  false,
  "una differenza reale nel JSON persistente deve continuare a bloccare la conversione",
);


assert.match(moduleSyncSource, /const SYNC_BATCH_WINDOW_MS = 60_000;/, "le modifiche Foundry devono essere raccolte per un minuto");
assert.match(moduleSyncSource, /if \(!pendingTimers\.has\(actorId\)\) scheduleManagedActorFlush\(actorId, SYNC_BATCH_WINDOW_MS\);/, "nuove modifiche devono confluire nella finestra gia aperta");
assert.match(moduleSyncSource, /pendingJobs\.get\(actorId\) !== event/, "una modifica arrivata durante l'invio non deve essere cancellata dall'ack precedente");
assert.match(moduleSyncSource, /activity\.damage\?\.includeBase !== false/, "il danno base deve seguire il default D&D5e anche quando includeBase non e serializzato");
assert.match(moduleSyncSource, /managedCollectionValues\(activity\.damage\?\.parts\)/, "tutti i danni aggiuntivi dell'attivita devono essere esportati");
assert.match(moduleSyncSource, /managedActivitiesSourceMap/, "le ActivityCollection D&D5e devono essere confrontate come mappe persistite");
assert.match(moduleSyncSource, /path === "system\.activities" \? managedActivitiesSourceMap\(value\) : value/, "il controllo conflitti deve normalizzare system.activities");
assert.match(moduleSyncSource, /applyManagedActivitiesUpdate/, "le attivita devono essere aggiornate tramite il documento D&D5e dedicato");
assert.match(moduleSyncSource, /Foundry non ha conservato le modifiche alle attivita/, "il modulo non deve confermare falsamente un danno non applicato");
const itemUpdateCommandBlock = moduleSyncSource.match(/if \(kind === "item\.update"\)[\s\S]+?(?=\n\s+const effect =)/)?.[0];
assert.ok(itemUpdateCommandBlock, "il comando item.update deve essere ispezionabile");
assert.match(itemUpdateCommandBlock, /deleteManagedCommandPath\(itemUpdate, "system\.activities"\)/, "system.activities deve essere separato dall'update EmbeddedDocument generico");
assert.doesNotMatch(itemUpdateCommandBlock, /_id: item\.id, \.\.\.update/, "l'intera ActivityCollection non deve essere inviata a updateEmbeddedDocuments");
const activityMapBlock = moduleSyncSource.match(/function managedActivitiesSourceMap[\s\S]+?(?=\r?\n\r?\nconst MANAGED_ACTIVITY_ARRAY_PATHS)/)?.[0];
assert.ok(activityMapBlock, "la normalizzazione delle ActivityCollection deve essere testabile");
const normalizeActivityMap = new Function("foundry", `${activityMapBlock}\nreturn managedActivitiesSourceMap;`)(
  { utils: { deepClone: (value) => structuredClone(value) } },
);
const mockActivityCollection = new Map([["attack-id", {
  _id: "attack-id",
  toObject: () => ({ _id: "attack-id", type: "attack", damage: { parts: [{ number: 7, denomination: 8 }] } }),
}]]);
assert.deepEqual(
  normalizeActivityMap(mockActivityCollection),
  { "attack-id": { _id: "attack-id", type: "attack", damage: { parts: [{ number: 7, denomination: 8 }] } } },
  "una ActivityCollection viva deve coincidere con il payload persistito usato dal sito",
);
const activityChangeBlock = moduleSyncSource.match(/const MANAGED_ACTIVITY_ARRAY_PATHS[\s\S]+?(?=\r?\n\r?\nasync function applyManagedActivitiesUpdate)/)?.[0];
assert.ok(activityChangeBlock, "la pianificazione degli update Activity deve essere testabile");
const changedValuePaths = (baseValue, desiredValue, path = [], output = []) => {
  if (JSON.stringify(baseValue) === JSON.stringify(desiredValue)) return output;
  if (Array.isArray(baseValue) && Array.isArray(desiredValue) && baseValue.length === desiredValue.length) {
    baseValue.forEach((entry, index) => changedValuePaths(entry, desiredValue[index], [...path, String(index)], output));
    return output;
  }
  const baseObject = baseValue && typeof baseValue === "object" && !Array.isArray(baseValue);
  const desiredObject = desiredValue && typeof desiredValue === "object" && !Array.isArray(desiredValue);
  if (baseObject && desiredObject) {
    new Set([...Object.keys(baseValue), ...Object.keys(desiredValue)])
      .forEach((key) => changedValuePaths(baseValue[key], desiredValue[key], [...path, key], output));
    return output;
  }
  output.push(path);
  return output;
};
const relativeValue = (value, path) => path.reduce((entry, key) => entry?.[key], value);
const planActivityChanges = new Function(
  "foundry", "managedActivitiesSourceMap", "managedCommandChangedPaths", "managedCommandRelativeValue",
  `${activityChangeBlock}\nreturn managedActivityChanges;`,
)(
  { utils: { deepClone: (value) => structuredClone(value) } },
  normalizeActivityMap,
  changedValuePaths,
  relativeValue,
);
const activityBeforeUpdate = normalizeActivityMap(mockActivityCollection);
const activityAfterUpdate = structuredClone(activityBeforeUpdate);
activityAfterUpdate["attack-id"].damage.parts[0].number = 9;
const activityPlan = planActivityChanges(activityBeforeUpdate, activityAfterUpdate);
assert.deepEqual(
  activityPlan.grouped.get("attack-id").changes,
  { "damage.parts": [{ number: 9, denomination: 8 }] },
  "un danno deve essere scritto tramite damage.parts, come fa la scheda D&D5e",
);
assert.deepEqual(
  activityPlan.grouped.get("attack-id").verifyPaths,
  [["damage", "parts", "0", "number"]],
  "la conferma deve controllare soltanto il valore realmente modificato dal sito",
);
const activityRuntimeBlock = moduleSyncSource.match(/function managedActivitiesSourceMap[\s\S]+?(?=\r?\n\r?\nfunction readManagedCommandPath)/)?.[0];
assert.ok(activityRuntimeBlock, "l'applicazione delle Activity D&D5e deve essere testabile");
const applyActivityUpdate = new Function(
  "foundry", "managedCommandChangedPaths", "managedCommandRelativeValue", "sameManagedCommandValue", "applyingManagedActivityCommands",
  `${activityRuntimeBlock}\nreturn applyManagedActivitiesUpdate;`,
)(
  { utils: { deepClone: (value) => structuredClone(value) } },
  changedValuePaths,
  relativeValue,
  (left, right) => JSON.stringify(left) === JSON.stringify(right),
  new WeakSet(),
);
let persistedActivitySource = { _id: "attack-id", type: "attack", sort: 950, damage: { parts: [{ number: 7, denomination: 8 }] } };
let receivedActivityChanges = null;
const liveActivity = {
  id: "attack-id",
  _id: "attack-id",
  toObject: () => structuredClone(persistedActivitySource),
  async update(changes) {
    receivedActivityChanges = structuredClone(changes);
    persistedActivitySource.damage.parts = structuredClone(changes["damage.parts"]);
    persistedActivitySource.sort = 975;
  },
};
const liveActivities = new Map([["attack-id", liveActivity]]);
const liveItem = { id: "item-id", system: { activities: liveActivities }, parent: { items: new Map() } };
liveItem.parent.items.set(liveItem.id, liveItem);
await applyActivityUpdate(liveItem, activityBeforeUpdate, activityAfterUpdate);
assert.deepEqual(receivedActivityChanges, { "damage.parts": [{ number: 9, denomination: 8 }] });
assert.equal(persistedActivitySource.damage.parts[0].number, 9, "il nuovo danno deve risultare persistito");
assert.equal(persistedActivitySource.sort, 975, "una normalizzazione Foundry estranea al danno non deve causare un falso errore");
const rejectingActivity = { ...liveActivity, async update() {} };
const rejectingItem = { id: "item-fail", system: { activities: new Map([["attack-id", rejectingActivity]]) }, parent: { items: new Map() } };
rejectingItem.parent.items.set(rejectingItem.id, rejectingItem);
persistedActivitySource = structuredClone(activityBeforeUpdate["attack-id"]);
await assert.rejects(
  applyActivityUpdate(rejectingItem, activityBeforeUpdate, activityAfterUpdate),
  /attack-id\.damage\.parts\.0\.number/,
  "il comando non deve essere confermato se il danno non viene realmente persistito",
);
assert.match(moduleSyncSource, /managedCollectionValues\(abilitySource\)/, "le caratteristiche del tiro salvezza devono estrarre correttamente i Set di Foundry");
assert.match(moduleSyncSource, /const role = damage\.length \|\| index > 0 \? ["']secondary["']/, "i danni successivi al principale devono restare identificabili");

const itemComparisonBlock = moduleSyncSource.match(/function unsetManagedActorLinkPath[\s\S]+?(?=\nfunction managedActorLinkEffectDifferences)/)?.[0];
assert.ok(itemComparisonBlock, "il confronto degli oggetti deve essere testabile");
const stableItemStringify = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableItemStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableItemStringify(value[key])}`).join(",")}}`;
};
const hashItemValue = (value) => {
  const text = stableItemStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};
const itemComparison = new Function(
  "foundry", "hashValue", "getItemTransferId", "stableStringify", "MODULE_ID", "TOKENIZER_MODULE_ID",
  `${itemComparisonBlock}\nreturn { managedActorLinkSchemaCleanDocumentSource, managedActorLinkDocumentSource, managedActorLinkSemanticValue, managedActorLinkEffectSemanticState, managedActorLinkItemState, managedActorLinkPairItemStates, managedActorLinkItemStateDifferences, managedActorLinkStructureSignature, managedActorLinkItemDefinitionSource, managedActorLinkItemDefinitionDifferences, managedActorLinkItemDefinitionSignature, managedActorLinkItemStateValueEqual };`,
)(
  { utils: { deepClone: (value) => structuredClone(value) } },
  hashItemValue,
  (item) => String(item?.flags?.["cripta-wiki-sync"]?.transferId || ""),
  stableItemStringify,
  "cripta-wiki-sync",
  "khuzoe-tokenizer",
);
const linkTestItem = ({ id, name = "Multiattack", transferId = "", prepared = true, damage = "1d6", activityId = "primary", sourceLabel = "", properties = [], identifier = undefined }) => {
  const source = {
    _id: id,
    name,
    type: "feat",
    img: "icons/example.webp",
    system: {
      preparation: { prepared },
      ...(identifier === undefined ? {} : { identifier }),
      source: sourceLabel,
      properties,
      activities: { [activityId]: { _id: activityId, sort: 100, damage: { parts: [[damage, "piercing"]] } } },
    },
    flags: transferId ? { "cripta-wiki-sync": { transferId } } : {},
  };
  return {
    id,
    name: source.name,
    type: source.type,
    system: source.system,
    flags: source.flags,
    _source: source,
  };
};
const linkBaseActor = { items: [linkTestItem({ id: "same-id", transferId: "stable-transfer" })], effects: [] };
const linkTokenActor = { items: [linkTestItem({ id: "same-id" })], effects: [] };
assert.deepEqual(
  itemComparison.managedActorLinkItemStateDifferences(linkBaseActor, linkTokenActor),
  [],
  "la stessa abilita non deve apparire rimossa e riaggiunta se soltanto il transferId manca nel vecchio token",
);
const linkCopiedTokenActor = { items: [linkTestItem({ id: "token-copy-id" })], effects: [] };
assert.deepEqual(
  itemComparison.managedActorLinkItemStateDifferences(linkBaseActor, linkCopiedTokenActor),
  [],
  "una copia con ID diverso deve essere riconosciuta tramite definizione e identita",
);assert.equal(
  itemComparison.managedActorLinkStructureSignature(linkBaseActor),
  itemComparison.managedActorLinkStructureSignature(linkTokenActor),
  "i metadati di sincronizzazione non devono creare differenze strutturali",
);
const linkRenamedIdentifierBase = { items: [linkTestItem({ id: "old-slam", name: "Slam (Copy)", identifier: "slam" })], effects: [] };
const linkRenamedIdentifierToken = { items: [linkTestItem({ id: "new-slam", name: "Slam" })], effects: [] };
const renamedIdentifierPairing = itemComparison.managedActorLinkPairItemStates(
  itemComparison.managedActorLinkItemState(linkRenamedIdentifierBase),
  itemComparison.managedActorLinkItemState(linkRenamedIdentifierToken),
);
assert.equal(renamedIdentifierPairing.pairs.length, 1, "identifier esplicito e identifier automatico devono individuare lo stesso Item rinominato");
assert.equal(renamedIdentifierPairing.baseOnly.length, 0, "lo Slam precedente non deve restare come elemento separato");
assert.equal(renamedIdentifierPairing.sourceOnly.length, 0, "lo Slam rinominato non deve essere pianificato come duplicato");
const linkChangedTokenActor = { items: [linkTestItem({ id: "same-id", prepared: false })], effects: [] };
const changedItemDifferences = itemComparison.managedActorLinkItemStateDifferences(linkBaseActor, linkChangedTokenActor);
assert.equal(changedItemDifferences.length, 1);
assert.equal(changedItemDifferences[0].changes[0].label, "Preparato");
const linkMechanicalTokenActor = { items: [linkTestItem({ id: "same-id", damage: "2d6" })], effects: [] };
const mechanicalDifferences = itemComparison.managedActorLinkItemStateDifferences(linkBaseActor, linkMechanicalTokenActor);
assert.equal(mechanicalDifferences.length, 1);
assert.equal(itemComparison.managedActorLinkItemStateValueEqual("uses.value", undefined, 0), true, "utilizzi non impostati e zero devono essere equivalenti");
assert.equal(itemComparison.managedActorLinkItemStateValueEqual("uses.spent", null, 0), true, "utilizzi spesi null e zero devono essere equivalenti");
const linkUsesItem = ({ id, value, spent, max = 3 }) => {
  const item = linkTestItem({ id });
  const uses = { value, max, ...(spent === undefined ? {} : { spent }) };
  item.system.uses = uses;
  item._source.system.uses = uses;
  return item;
};
const selectedUsesActor = { items: [linkUsesItem({ id: "limited-spell", value: 2, spent: 1 })], effects: [] };
const persistedUsesActor = { items: [linkUsesItem({ id: "limited-spell", value: 99, spent: 1 })], effects: [] };
assert.equal(itemComparison.managedActorLinkItemState(selectedUsesActor)[0].uses.value, undefined);
assert.equal(itemComparison.managedActorLinkItemState(selectedUsesActor)[0].uses.spent, 1);
assert.deepEqual(
  itemComparison.managedActorLinkItemStateDifferences(selectedUsesActor, persistedUsesActor),
  [],
  "uses.value ricalcolato da D&D5e non deve bloccare la conversione quando uses.spent e stato conservato",
);
const changedSpentActor = { items: [linkUsesItem({ id: "limited-spell", value: 1, spent: 2 })], effects: [] };
assert.equal(
  itemComparison.managedActorLinkItemStateDifferences(selectedUsesActor, changedSpentActor)[0].changes[0].label,
  "Utilizzi spesi",
  "una differenza reale negli utilizzi spesi deve continuare a essere rilevata",
);
const legacyUsesActor = { items: [linkUsesItem({ id: "legacy-uses", value: 2 })], effects: [] };
const legacyChangedUsesActor = { items: [linkUsesItem({ id: "legacy-uses", value: 1 })], effects: [] };
assert.equal(
  itemComparison.managedActorLinkItemStateDifferences(legacyUsesActor, legacyChangedUsesActor)[0].changes[0].label,
  "Utilizzi",
  "i sistemi legacy senza uses.spent devono continuare a usare uses.value",
);
const itemRuntimeUpdateBlock = moduleSyncSource.match(/function managedActorLinkItemUpdates[\s\S]+?(?=\r?\nasync function applyManagedActorLinkRuntime)/)?.[0];
assert.ok(itemRuntimeUpdateBlock, "la copia degli utilizzi degli Item deve essere testabile");
const planItemRuntimeUpdates = new Function(
  "foundry", "stableStringify", "managedActorLinkItemState", "managedActorLinkPairItemStates",
  `${itemRuntimeUpdateBlock}\nreturn managedActorLinkItemUpdates;`,
)(
  { utils: { deepClone: (value) => structuredClone(value), getProperty: (target, path) => path.split(".").reduce((value, key) => value?.[key], target) } },
  stableItemStringify,
  itemComparison.managedActorLinkItemState,
  itemComparison.managedActorLinkPairItemStates,
);
const targetUsesActor = { items: [linkUsesItem({ id: "limited-spell", value: 3, spent: 0 })], effects: [] };
assert.deepEqual(
  planItemRuntimeUpdates(targetUsesActor, selectedUsesActor),
  [{ _id: "limited-spell", "system.uses.spent": 1 }],
  "la copia deve scrivere uses.spent senza tentare di persistere uses.value derivato",
);
assert.equal(itemComparison.managedActorLinkItemStateValueEqual("prepared", undefined, false), true, "un flag booleano opzionale assente deve equivalere al default false");
assert.equal(itemComparison.managedActorLinkItemStateValueEqual("quantity", undefined, 0), false, "quantita assente e zero devono restare differenti");
assert.equal(mechanicalDifferences[0].structural, true);
assert.equal(mechanicalDifferences[0].changes[0].label, "Danni attivita");
assert.doesNotMatch(mechanicalDifferences[0].changes[0].before, /^\s*[\[{]/, "le differenze dei danni devono essere leggibili e non JSON grezzo");
assert.match(mechanicalDifferences[0].changes[0].after, /2d6/, "la formula effettiva deve essere immediatamente visibile");
const linkSemanticallyEqualBase = { items: [linkTestItem({
  id: "semantic-id", activityId: "activity-original", sourceLabel: "PHB'14", properties: new Set(["fin", "mgc"]),
})], effects: [] };
const linkSemanticallyEqualToken = { items: [linkTestItem({
  id: "semantic-id", activityId: "activity-regenerated", sourceLabel: "Player's Handbook", properties: ["mgc", "fin"],
})], effects: [] };
assert.deepEqual(
  itemComparison.managedActorLinkItemStateDifferences(linkSemanticallyEqualBase, linkSemanticallyEqualToken),
  [],
  "ID attivita, provenienza editoriale e rappresentazioni Set/Array equivalenti non devono produrre falsi conflitti",
);
const linkAutomaticIdentifierBase = { items: [linkTestItem({ id: "automatic-identifier" })], effects: [] };
const linkAutomaticIdentifierToken = { items: [linkTestItem({ id: "automatic-identifier", identifier: "multiattack" })], effects: [] };
assert.deepEqual(
  itemComparison.managedActorLinkItemStateDifferences(linkAutomaticIdentifierBase, linkAutomaticIdentifierToken),
  [],
  "un identifier generato automaticamente dal nome non deve bloccare la copia meccanica",
);
const linkCustomIdentifierBase = { items: [linkTestItem({ id: "custom-identifier", identifier: "multiattack-speciale" })], effects: [] };
const linkCustomIdentifierToken = { items: [linkTestItem({ id: "custom-identifier", identifier: "multiattack-alternativo" })], effects: [] };
const customIdentifierDifferences = itemComparison.managedActorLinkItemStateDifferences(linkCustomIdentifierBase, linkCustomIdentifierToken);
assert.equal(customIdentifierDifferences.length, 1);
assert.equal(
  customIdentifierDifferences[0].changes.some((change) => String(change.label).toLowerCase().includes("identifier")),
  true,
  "identifier personalizzati realmente diversi devono continuare a essere verificati",
);

let selectedDocumentSourceMode = null;
let preparedSystemRead = false;
const selectedPersistentSystem = {
  preparation: { prepared: true },
  properties: ["mgc"],
  activities: {
    effective: { _id: "effective", type: "attack", damage: { parts: [["4d10", "force"]] } },
    secondary: { _id: "secondary", type: "attack", damage: { parts: [["2d12 + 7", "necrotic"], ["1d8", "cold"]] } },
  },
};
const selectedPreparedSystem = {
  ...structuredClone(selectedPersistentSystem),
  derivedArmorClass: 23,
  // ActivityCollection.toObject(false) can expose a prepared array. It must
  // never replace the persistent mapping used by the selected Token Actor.
  activities: [{ _id: "stale", type: "attack", damage: { parts: [["1d4", "force"]] } }],
};
const selectedMigratedItem = {
  _source: linkTestItem({ id: "selected-migrated", damage: "1d4" })._source,
  toObject: (source) => {
    selectedDocumentSourceMode = source;
    return {
      _id: "selected-migrated",
      name: "Multiattack",
      type: "feat",
      system: structuredClone(source ? selectedPersistentSystem : selectedPreparedSystem),
    };
  },
  system: {
    toObject: () => { preparedSystemRead = true; return structuredClone(selectedPreparedSystem); }
  },
};
const capturedSelectedItem = itemComparison.managedActorLinkDocumentSource(selectedMigratedItem);
assert.deepEqual(Object.keys(capturedSelectedItem.system.activities), ["effective", "secondary"], "tutte le Activity devono mantenere le loro chiavi native");
assert.equal(
  capturedSelectedItem.system.activities.effective.damage.parts[0][0],
  "4d10",
  "la conversione deve copiare il danno persistito della Activity scelta e non un array preparato o obsoleto",
);assert.deepEqual(
  capturedSelectedItem.system.activities.secondary.damage.parts,
  [["2d12 + 7", "necrotic"], ["1d8", "cold"]],
  "la conversione deve conservare anche danni secondari e formule diverse tra piu attacchi",
);
assert.equal(selectedDocumentSourceMode, true, "la cattura deve leggere la sorgente persistente e gia fusa del Token Actor sintetico");
assert.equal(preparedSystemRead, false, "i valori derivati dal DataModel non devono essere salvati insieme alle loro cause persistenti");
let liveActivitySourceMode = null;
const selectedDeltaOnlyItem = {
  toObject: () => ({
    _id: "selected-delta-only",
    name: "Greatsword",
    type: "weapon",
    effects: [],
    system: { actionType: "mwak", activities: {} },
  }),
  system: {
    activities: new Map([["live-attack", {
      _id: "live-attack",
      toObject: (source) => {
        liveActivitySourceMode = source;
        return { _id: "live-attack", type: "attack", damage: { parts: [["2d6 + 5", "slashing"]] } };
      },
    }]]),
  },
};
const capturedDeltaOnlyItem = itemComparison.managedActorLinkDocumentSource(selectedDeltaOnlyItem);
assert.deepEqual(Object.keys(capturedDeltaOnlyItem.system.activities), ["live-attack"], "le Activity vive omesse dal delta sintetico devono entrare nello snapshot autorevole");
assert.equal(capturedDeltaOnlyItem.system.activities["live-attack"].damage.parts[0][0], "2d6 + 5");
assert.equal(liveActivitySourceMode, true, "anche il fallback runtime deve leggere la sorgente persistente della Activity");

let syntheticWeaponActivitySourceMode = null;
class MockSyntheticWeaponItem {
  static cleanData(source) {
    const cleaned = structuredClone(source);
    // Simula un DataModel che, fuori dal parent Actor, scarta ActivitiesField.
    delete cleaned.system.activities;
    return cleaned;
  }

  constructor() {
    this.name = "Shortbow";
    this._source = {
      _id: "shortbow",
      name: this.name,
      type: "weapon",
      system: {
        activities: {
          inherited: { _id: "inherited", type: "attack", damage: { parts: [] } },
        },
      },
    };
    this.system = {
      activities: new Map([["shortbow-attack", {
        _id: "shortbow-attack",
        toObject: (source) => {
          syntheticWeaponActivitySourceMode = source;
          return {
            _id: "shortbow-attack",
            type: "attack",
            attack: { type: { value: "ranged" }, ability: "dex" },
            damage: { parts: [["2d6 + 5", "piercing"]] },
          };
        },
      }]]),
    };
  }

  toObject() {
    return structuredClone(this._source);
  }
}
const capturedSyntheticWeapon = itemComparison.managedActorLinkDocumentSource(new MockSyntheticWeaponItem());
assert.deepEqual(
  Object.keys(capturedSyntheticWeapon.system.activities),
  ["shortbow-attack"],
  "le Activity vive complete devono sostituire il ramo sintetico parziale",
);
assert.equal(capturedSyntheticWeapon.system.activities["shortbow-attack"].damage.parts[0][0], "2d6 + 5");
assert.equal(syntheticWeaponActivitySourceMode, true, "la collezione viva deve essere letta in modalita persistente");

class MockSchemaItem {
  static migrateDataSafe(source) {
    return structuredClone(source);
  }

  static cleanData(source) {
    const cleaned = structuredClone(source);
    delete cleaned.system.derivedLabel;
    if (cleaned.system.uses) delete cleaned.system.uses.value;
    return cleaned;
  }

  constructor() {
    this.name = "Capacita con dati derivati";
    this._effective = {
      _id: "schema-item",
      name: this.name,
      type: "feat",
      system: { uses: { max: 3, spent: 1, value: 2 }, derivedLabel: "2/3" }
    };
    this.system = { toObject: () => structuredClone(this._effective.system) };
  }

  toObject() {
    return structuredClone(this._effective);
  }
}
const schemaItem = new MockSchemaItem();
const schemaCleanedSource = itemComparison.managedActorLinkDocumentSource(schemaItem);
assert.equal(schemaCleanedSource.system.uses.spent, 1);
assert.equal(schemaCleanedSource.system.uses.value, undefined, "cleanData deve rimuovere i campi preparati ma non persistenti");
assert.equal(schemaCleanedSource.system.derivedLabel, undefined, "lo snapshot deve seguire lo schema del Document");
assert.equal(schemaItem._effective.system.derivedLabel, "2/3", "la normalizzazione non deve mai mutare il documento vivo");

const applyActorSystemBlock = moduleSyncSource.match(/async function applyManagedActorLinkSystemState[\s\S]+?(?=\r?\nfunction inspectManagedActorLink)/)?.[0];
assert.ok(applyActorSystemBlock, "la sostituzione sicura del sistema Actor deve essere testabile");
const applyActorSystemState = new Function(
  "foundry", "managedActorLinkDocumentSource", "managedActorLinkSchemaCleanDocumentSource",
  `${applyActorSystemBlock}\nreturn applyManagedActorLinkSystemState;`,
)(
  { utils: { deepClone: (value) => structuredClone(value) } },
  itemComparison.managedActorLinkDocumentSource,
  itemComparison.managedActorLinkSchemaCleanDocumentSource,
);
class MockActorDocument {
  static cleanData(source) {
    const cleaned = structuredClone(source);
    delete cleaned.system.derivedArmorClass;
    return cleaned;
  }

  constructor() {
    this.name = "Guscio originale";
    this.ownership = { default: 3 };
    this.flags = { "cripta-wiki-sync": { actorId: "stable" } };
    this._system = { abilities: { str: { value: 10 } }, derivedArmorClass: 12 };
    this.system = { toObject: () => structuredClone(this._system) };
  }

  toObject() {
    return {
      _id: "actor-shell",
      name: this.name,
      ownership: structuredClone(this.ownership),
      flags: structuredClone(this.flags),
      type: "npc",
      system: structuredClone(this._system)
    };
  }

  async update(changes, options) {
    this.receivedChanges = structuredClone(changes);
    this.receivedOptions = structuredClone(options);
  }
}
const mockActorDocument = new MockActorDocument();
await applyActorSystemState(mockActorDocument, {
  abilities: { str: { value: 28 }, int: { value: 22 } },
  attributes: { hp: { value: 170, max: 170 } },
  derivedArmorClass: 18
});
assert.deepEqual(mockActorDocument.receivedChanges, {
  system: {
    abilities: { str: { value: 28 }, int: { value: 22 } },
    attributes: { hp: { value: 170, max: 170 } }
  }
});
assert.equal(mockActorDocument.receivedOptions.diff, false);
assert.equal(mockActorDocument.receivedOptions.recursive, false);
assert.equal("name" in mockActorDocument.receivedChanges, false, "nome e identita del guscio Actor non devono essere sovrascritti");
assert.equal("ownership" in mockActorDocument.receivedChanges, false, "i permessi dell'Actor non devono essere sovrascritti");
assert.equal("flags" in mockActorDocument.receivedChanges, false, "i collegamenti del modulo non devono essere sovrascritti");

const authoritativeTokenBlock = moduleSyncSource.match(/const MANAGED_ACTOR_LINK_TOKEN_INSTANCE_KEYS[\s\S]+?(?=\r?\nfunction managedActorLinkResolvedSystemValue)/)?.[0];
assert.ok(authoritativeTokenBlock, "la trasposizione autoritativa dei token deve essere testabile");
const authoritativeTokenGame = { scenes: [] };
const authoritativeTokenHelpers = new Function(
  "foundry", "managedActorLinkDocumentSource", "managedActorLinkSemanticValue", "stableStringify",
  "managedActorLinkSchemaCleanDocumentSource", "managedActorLinkCanonicalDifferencePaths",
  "managedActorLinkCanonicalDifferenceLabel", "managedActorLinkDiagnosticPathValue",
  "managedActorLinkDiagnosticValue", "managedActorLinkDiagnosticInstruction", "game",
  `${authoritativeTokenBlock}\nreturn { managedActorLinkTokenConfigurationState, applyManagedActorLinkPrototypeConfiguration, managedActorLinkPlacedTokenSource, verifyManagedActorLinkPlacedTokens };`,
)(
  { utils: { deepClone: (value) => structuredClone(value) } },
  (document) => structuredClone(document?.toObject?.(false) || document?._source || document || {}),
  itemComparison.managedActorLinkSemanticValue,
  stableItemStringify,
  (_document, source) => structuredClone(source),
  (expected, actual) => stableItemStringify(expected) === stableItemStringify(actual) ? [] : ["texture.src"],
  (path) => path,
  (root, path) => String(path || "").split(".").filter(Boolean).reduce((value, key) => value?.[key], root),
  (value) => value === undefined ? "—" : String(value),
  () => "Riallinea il campo.",
  authoritativeTokenGame,
);
const authoritativeSelectedToken = {
  toObject: () => ({
    _id: "selected-token", actorId: "actor-id", actorLink: false, delta: { system: { ignored: true } },
    x: 900, y: 800, elevation: 20, sort: 50, _regions: ["selected-region"],
    name: "Forma autorevole", width: 3, height: 3,
    texture: { src: "selected.webp", scaleX: 1.2, scaleY: 1.2 },
    sight: { enabled: true, range: 120 }, hidden: false, locked: false, flags: { module: { mechanical: true } }
  })
};
const authoritativeConfiguration = authoritativeTokenHelpers.managedActorLinkTokenConfigurationState(authoritativeSelectedToken);
assert.equal("x" in authoritativeConfiguration, false, "le coordinate non fanno parte dello stato condiviso");
assert.equal("delta" in authoritativeConfiguration, false, "il delta indipendente non deve sopravvivere al collegamento");
assert.equal("hidden" in authoritativeConfiguration, false, "la visibilita e uno stato operativo della singola istanza");
assert.equal("locked" in authoritativeConfiguration, false, "il blocco e uno stato operativo della singola istanza");
assert.equal("_regions" in authoritativeConfiguration, false, "le regioni appartengono alla singola scena");
const authoritativePrototypeConfiguration = authoritativeTokenHelpers.managedActorLinkTokenConfigurationState({
  toObject: () => ({ ...authoritativeSelectedToken.toObject(), randomImg: true })
});
assert.deepEqual(authoritativePrototypeConfiguration, authoritativeConfiguration, "randomImg esiste solo sul PrototypeToken e non deve entrare nello stato condiviso");
const prototypeUpdates = [];
await authoritativeTokenHelpers.applyManagedActorLinkPrototypeConfiguration({
  prototypeToken: { randomImg: true },
  async update(changes) { prototypeUpdates.push(structuredClone(changes)); }
}, authoritativeConfiguration, true);
assert.equal(prototypeUpdates[0].prototypeToken.randomImg, true, "randomImg del prototype deve essere conservato");
assert.equal(authoritativeConfiguration.texture.src, "selected.webp");
const authoritativeTargetToken = {
  id: "target-token",
  toObject: () => ({
    _id: "target-token", actorId: "actor-id", actorLink: false,
    x: 100, y: 200, elevation: 5, sort: 10, _regions: ["region-a"],
    name: "Forma vecchia", width: 1, height: 1,
    texture: { src: "old.webp" }, hidden: true, locked: true, delta: { system: { attributes: { hp: { value: 1 } } } }
  })
};
const authoritativePlacedSource = authoritativeTokenHelpers.managedActorLinkPlacedTokenSource(
  authoritativeTargetToken,
  { id: "actor-id" },
  authoritativeConfiguration,
);
assert.equal(authoritativePlacedSource.x, 100, "ogni istanza deve restare nella propria posizione");
assert.equal(authoritativePlacedSource.y, 200);
assert.equal(authoritativePlacedSource.actorLink, true);
assert.deepEqual(authoritativePlacedSource.delta, {}, "nessuno stato Actor indipendente deve restare sul token collegato");
assert.equal(authoritativePlacedSource.name, "Forma autorevole");
assert.equal(authoritativePlacedSource.texture.src, "selected.webp");
assert.equal(authoritativePlacedSource.hidden, true, "ogni token deve conservare la propria visibilita nella scena");
assert.equal(authoritativePlacedSource.locked, true, "ogni token deve conservare il proprio blocco nella scena");
assert.deepEqual(authoritativePlacedSource._regions, ["region-a"], "ogni token deve conservare le proprie regioni");
const authoritativeLiveToken = {
  id: "target-token", name: "Forma autorevole", actorId: "actor-id", actorLink: true,
  toObject: () => structuredClone(authoritativePlacedSource)
};
authoritativeTokenGame.scenes = [{ tokens: [authoritativeLiveToken] }];
assert.equal(authoritativeTokenHelpers.verifyManagedActorLinkPlacedTokens({ id: "actor-id" }, authoritativeConfiguration).ok, true);
authoritativeLiveToken.toObject = () => ({ ...structuredClone(authoritativePlacedSource), texture: { src: "regressed.webp" } });
assert.equal(authoritativeTokenHelpers.verifyManagedActorLinkPlacedTokens({ id: "actor-id" }, authoritativeConfiguration).ok, false, "una sola istanza diversa deve invalidare l'intera conversione");
const canonicalBlock = moduleSyncSource.match(/function managedActorLinkCanonicalOptionalState[\s\S]+?(?=\r?\nfunction managedActorLinkRuntimeDifferenceSummary)/)?.[0];
assert.ok(canonicalBlock, "lo snapshot meccanico canonico deve essere testabile");
const canonicalSnapshot = new Function(
  "MANAGED_ACTOR_LINK_CANONICAL_SCHEMA_VERSION",
  "foundry", "stableStringify", "managedActorLinkSemanticValue", "managedActorLinkItemState",
  "managedActorLinkItemDefinitionSource", "managedActorLinkEffectSemanticState",
  "managedActorLinkRuntimeComparable", "buildManagedActorRuntime", "managedActorLinkSystemState",
  "managedActorLinkActorEnvelopeState", "managedActorLinkTokenConfigurationState",
  "managedActorLinkActorEnvelopeComparable", "managedActorLinkTokenConfigurationComparable",
  "managedActorLinkStructuralStateActor", "managedActorLinkDefinitionDifferences",
  "managedActorLinkItemStateDifferences", "managedActorLinkEffectDifferences",
  "verifyManagedActorLinkRuntimeState",
  `${canonicalBlock}\nreturn managedActorLinkCanonicalMechanicalSnapshot;`,
)(
  2,
  { utils: { deepClone: (value) => structuredClone(value) } },
  stableItemStringify,
  itemComparison.managedActorLinkSemanticValue,
  itemComparison.managedActorLinkItemState,
  itemComparison.managedActorLinkItemDefinitionSource,
  itemComparison.managedActorLinkEffectSemanticState,
  (value) => structuredClone(value || {}),
  (actor) => structuredClone(actor?.runtime || {}),
  (actor) => structuredClone(actor?.system || {}),
  (actor) => ({ name: actor?.name || "", img: actor?.img || "", flags: structuredClone(actor?.flags || {}) }),
  (token) => structuredClone(token?.configuration || {}),
  (value) => structuredClone(value || {}),
  (value) => structuredClone(value || {}),
  () => ({ items: [], effects: [] }),
  () => [],
  () => [],
  () => [],
  () => ({ ok: true, summary: [] }),
);
const canonicalActorA = {
  system: { abilities: { str: { value: 18 } }, attributes: { hp: { value: 20, max: 20 } } },
  items: [linkUsesItem({ id: "canonical-spell", value: 2, spent: 1 })],
  effects: [],
  runtime: { hp: { value: 20, max: 20 } }
};
const canonicalActorB = {
  system: structuredClone(canonicalActorA.system),
  items: [linkUsesItem({ id: "canonical-spell", value: 999, spent: 1 })],
  effects: [],
  runtime: structuredClone(canonicalActorA.runtime)
};
assert.deepEqual(
  canonicalSnapshot(canonicalActorA),
  canonicalSnapshot(canonicalActorB),
  "il round-trip canonico deve essere idempotente rispetto ai valori derivati",
);
const canonicalActorChanged = {
  ...canonicalActorB,
  items: [linkUsesItem({ id: "canonical-spell", value: 1, spent: 2 })]
};
assert.notDeepEqual(
  canonicalSnapshot(canonicalActorA),
  canonicalSnapshot(canonicalActorChanged),
  "lo snapshot canonico deve continuare a rilevare una modifica meccanica persistente",
);

const restoreLinkSnapshotBlock = moduleSyncSource.match(/async function restoreManagedActorLinkSnapshot[\s\S]+?(?=\r?\nasync function executeManagedActorLinkConversion)/)?.[0];
assert.ok(restoreLinkSnapshotBlock, "il rollback completo deve essere testabile");
const restoreEvents = [];
const restoreLinkSnapshot = new Function(
  "foundry", "applyManagedActorLinkSystemState", "applyManagedActorLinkDefinition",
  "applyManagedActorLinkActorEnvelope", "applyManagedActorLinkPrototypeConfiguration",
  "replaceManagedActorLinkEmbeddedDocuments", "applyManagedActorLinkRuntime",
  "managedActorLinkActivitiesSourceMap", "managedActorLinkSchemaCleanDocumentSource",
  "managedActorLinkActorEnvelopeState", "managedActorLinkTokenConfigurationState",
  "managedActorLinkTokenConfigurationComparable", "verifyManagedActorLinkCanonicalState",
  "verifyManagedActorLinkNativeDocument",
  "assertManagedActorLinkVerification", "stableStringify", "managedActorLinkSemanticValue",
  "importManagedActorLinkActorDocument", "game",
  `${restoreLinkSnapshotBlock}\nreturn restoreManagedActorLinkSnapshot;`,
)(
  { utils: { deepClone: (value) => structuredClone(value) } },
  async (_actor, system) => restoreEvents.push({ kind: "system", system: structuredClone(system) }),
  async () => restoreEvents.push({ kind: "legacy-definition" }),
  async (_actor, envelope) => restoreEvents.push({ kind: "actor-envelope", envelope: structuredClone(envelope) }),
  async (_actor, configuration, actorLink) => restoreEvents.push({ kind: "prototype-configuration", configuration: structuredClone(configuration), actorLink }),
  async (_actor, documentName, data) => restoreEvents.push({ kind: documentName, data: structuredClone(data) }),
  async (_actor, runtime) => restoreEvents.push({ kind: "runtime", runtime: structuredClone(runtime) }),
  (value) => Object.fromEntries((Array.isArray(value) ? value : Object.values(value || {})).map((activity, index) => {
    const source = activity?.toObject?.(true) || activity || {};
    const id = String(source._id || activity?._id || index);
    return [id, structuredClone({ ...source, _id: id })];
  })),
  (_document, source) => structuredClone(source),
  () => ({}),
  (token) => structuredClone(token?.configuration || token?.toObject?.(false) || token || {}),
  (value) => structuredClone(value || {}),
  () => ({ ok: true, summary: [] }),
  () => ({ ok: true, summary: [] }),
  () => {},
  stableItemStringify,
  itemComparison.managedActorLinkSemanticValue,
  async (_actor, actorDocument) => {
    restoreEvents.push({ kind: "native-document", actorDocument: structuredClone(actorDocument) });
    return { expectedSource: structuredClone(actorDocument) };
  },
  { scenes: [] },
);
const restoreActor = {
  async update(changes) {
    restoreEvents.push({ kind: "prototype", changes: structuredClone(changes) });
  }
};
await restoreLinkSnapshot(restoreActor, {
  schemaVersion: 4,
  actorSystem: { abilities: { str: { value: 10 } }, attributes: { hp: { value: 12, max: 12 } } },
  actorRuntime: { hp: { value: 12, max: 12 } },
  actorItemState: [],
  actorItems: [{ _id: "old-item", name: "Elemento originale", type: "feat", system: { activities: [{ _id: "old-attack", type: "attack", damage: { parts: [["3d8", "fire"]] } }] } }],
  actorEffects: [{ _id: "old-effect", name: "Effetto originale" }],
  prototypeActorLink: false,
  tokens: []
});
assert.deepEqual(restoreEvents.map((event) => event.kind), [
  "system", "Item", "ActiveEffect", "runtime", "prototype"
]);
assert.deepEqual(restoreEvents[0].system.abilities.str.value, 10);
assert.deepEqual(Object.keys(restoreEvents.find((event) => event.kind === "Item").data[0].system.activities), ["old-attack"], "anche i backup precedenti devono ripristinare le Activity come mappa persistibile");
assert.equal(restoreEvents.find((event) => event.kind === "Item").data[0].system.activities["old-attack"].damage.parts[0][0], "3d8");
assert.equal(
  restoreEvents.some((event) => event.kind === "legacy-definition"),
  false,
  "un backup v4 deve ripristinare il sistema completo e non il vecchio sottoinsieme",
);
restoreEvents.length = 0;
await restoreLinkSnapshot(restoreActor, {
  schemaVersion: 6,
  actorDocument: {
    _id: "actor-original",
    name: "Actor originale",
    items: [{ _id: "native-item", name: "Elemento nativo" }],
    effects: [{ _id: "native-effect", name: "Effetto nativo" }],
  },
  prototypeActorLink: false,
  prototypeTokenConfiguration: { name: "Token originale" },
  tokens: [],
});
assert.deepEqual(
  restoreEvents.map((event) => event.kind),
  ["native-document", "prototype-configuration"],
  "un backup schema 6 deve ripristinare l'Actor completo in un'unica importazione nativa",
);
assert.equal(restoreEvents[0].actorDocument.items[0]._id, "native-item");
assert.match(moduleSyncSource, /canonicalSignature: hashValue\(managedActorLinkCanonicalMechanicalSnapshot/, "l'hash di conferma deve coprire tutto lo snapshot canonico");



const embeddedEffectItem = ({ id, reversed = false, regenerated = false }) => {
  const item = linkTestItem({ id });
  const effects = [
    {
      _id: regenerated ? "shield-regenerated" : "shield-selected",
      name: "Shield",
      origin: regenerated ? "Actor.prototype.Item.shield" : "Scene.scene.Token.token.Actor.actor.Item.shield",
      sort: regenerated ? 200 : 100,
      disabled: regenerated ? undefined : false,
      transfer: regenerated ? undefined : false,
      duration: regenerated ? {} : { startTime: 0, startRound: 0, startTurn: 0 },
      changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "5", priority: 20 }],
      statuses: [],
      _stats: { modifiedTime: regenerated ? 200 : 100 },
    },
    {
      _id: regenerated ? "mage-armor-regenerated" : "mage-armor-selected",
      name: "Mage Armor",
      origin: regenerated ? "Actor.prototype.Item.mage-armor" : "Scene.scene.Token.token.Actor.actor.Item.mage-armor",
      sort: regenerated ? 100 : 200,
      disabled: regenerated ? undefined : false,
      transfer: regenerated ? undefined : false,
      duration: {},
      changes: [{ key: "system.attributes.ac.calc", mode: 5, value: "mage", priority: 20 }],
      statuses: [],
      _stats: { modifiedTime: regenerated ? 220 : 120 },
    },
  ];
  item._source.effects = reversed ? effects.reverse() : effects;
  return item;
};
assert.deepEqual(
  itemComparison.managedActorLinkItemStateDifferences(
    { items: [embeddedEffectItem({ id: "spell-item" })], effects: [] },
    { items: [embeddedEffectItem({ id: "spell-item", reversed: true, regenerated: true })], effects: [] },
  ),
  [],
  "ID, ordine, origine e statistiche rigenerate degli effetti incorporati non devono simulare differenze meccaniche",
);
const selectedMindBlank = {
  _id: "mind-blank-selected",
  name: "Mind Blank",
  origin: "Scene.scene.Token.token.Actor.actor.Item.mind-blank",
  sort: 100,
  disabled: false,
  transfer: false,
  duration: { seconds: 86400, startTime: 0, startRound: 0, startTurn: 0 },
  changes: [{ key: "system.traits.ci.value", mode: 2, value: "charmed", priority: 20 }],
  statuses: new Set(["mindBlank"]),
  flags: { dnd5e: { riders: { activity: [] } } },
  _stats: { modifiedTime: 100 },
};
const persistedMindBlank = {
  ...structuredClone({ ...selectedMindBlank, statuses: ["mindBlank"] }),
  _id: "mind-blank-regenerated",
  origin: "Actor.prototype.Item.mind-blank",
  sort: 200,
  duration: { seconds: 86400 },
  _stats: { modifiedTime: 200 },
};
assert.deepEqual(
  itemComparison.managedActorLinkEffectSemanticState(selectedMindBlank),
  itemComparison.managedActorLinkEffectSemanticState(persistedMindBlank),
  "la verifica di un Active Effect deve ignorare soltanto i metadati rigenerati da Foundry",
);
assert.notDeepEqual(
  itemComparison.managedActorLinkEffectSemanticState(selectedMindBlank),
  itemComparison.managedActorLinkEffectSemanticState({ ...persistedMindBlank, duration: { seconds: 3600 } }),
  "una differenza reale nella durata di un Active Effect deve continuare a bloccare la conversione",
);
assert.match(mechanicalDifferences[0].changes[0].before, /1d6/);
assert.match(mechanicalDifferences[0].changes[0].after, /2d6/);
assert.match(moduleSyncSource, /MANAGED_ACTOR_LINK_BACKUP_SCHEMA_VERSION = 6/, "il rollback deve usare lo snapshot Actor nativo completo");
assert.match(moduleSyncSource, /actorSystem: managedActorLinkSystemState\(actor\)/, "il rollback deve conservare l'intero sistema Actor originale");
assert.match(moduleSyncSource, /actorItems: Array\.from/, "lo snapshot deve conservare tutti gli Item dell'Actor");
assert.match(moduleSyncSource, /actorEffects: Array\.from/, "lo snapshot deve conservare tutti gli ActiveEffect dell'Actor");
assert.match(moduleSyncSource, /applyManagedActorLinkStructuralState/, "la sorgente token deve poter sostituire in sicurezza Item ed effetti");
assert.match(moduleSyncSource, /reconcileManagedActorLinkEffects/, "gli ActiveEffect devono essere riconciliati senza cancellazione e ricreazione cieca");
assert.doesNotMatch(moduleSyncSource, /replaceManagedActorLinkEmbeddedDocuments\([^\n]+"ActiveEffect", \[\]\)/, "la conversione e il rollback non devono svuotare preventivamente tutti gli effetti");
assert.match(moduleSyncSource, /reconcileManagedActorLinkItems/, "gli Item devono essere riconciliati senza cancellazione completa preventiva");
assert.doesNotMatch(moduleSyncSource, /currentIds\.length\) await actor\.deleteEmbeddedDocuments\(documentName, currentIds/, "la conversione non deve piu eliminare tutti gli Item prima della copia");
assert.match(moduleSyncSource, /diff: false, recursive: false/, "gli aggiornamenti strutturali devono sostituire in modo deterministico il sotto-documento");
assert.match(moduleSyncSource, /recoverPreparedManagedActorLinkConversions/, "una conversione interrotta deve essere recuperata dal backup al riavvio");
assert.match(moduleSyncSource, /managedActorLinkConversions\.has\(actorId\)/, "due conversioni concorrenti dello stesso Actor devono essere bloccate");
assert.match(moduleSyncSource, /verification\.summary/, "un fallimento strutturale deve indicare le proprieta che non sono state conservate");
const runtimeComparableBlock = moduleSyncSource.match(/function managedActorLinkRuntimeComparable[\s\S]+?(?=\r?\nfunction managedActorLinkRuntimeDifferenceSummary)/)?.[0];
assert.ok(runtimeComparableBlock, "la normalizzazione dello stato corrente deve essere testabile");
const normalizeLinkRuntime = new Function("managedActorLinkSemanticValue", `${runtimeComparableBlock}\nreturn managedActorLinkRuntimeComparable;`)((value) => value);
assert.deepEqual(
  normalizeLinkRuntime({ hp: { value: 0, max: 14, temp: null }, xp: { value: 5900, max: 6000 }, weight: { value: 20 }, resources: { primary: { value: 0 } }, spellSlots: { spell1: { value: 0, spent: 0 } } }),
  { hp: { max: 14 } },
  "i default vuoti normalizzati da Foundry a zero non devono far fallire il controllo runtime",
);
assert.doesNotMatch(moduleSyncSource, /"details\.xp\.value", "details\.xp\.current"/, "la conversione NPC non deve scrivere gli XP derivati dalla CR");
assert.match(runtimeComparableBlock, /delete comparable\.xp/, "gli XP derivati non devono bloccare la verifica dello stato corrente");
const itemReconcileBlock = moduleSyncSource.match(/function uniqueManagedActorLinkItems[\s\S]+?(?=\r?\nfunction uniqueManagedActorLinkEffects)/)?.[0];
assert.ok(itemReconcileBlock, "la riconciliazione degli Item deve essere testabile");
const reconcileActorItems = new Function(
  "foundry", "stableStringify", "managedActorLinkDocumentSource", "managedActorLinkSemanticValue",
  `${itemReconcileBlock}\nreturn reconcileManagedActorLinkItems;`,
)(
  { utils: { deepClone: (value) => structuredClone(value) } },
  stableItemStringify,
  (item) => structuredClone(item?._source || item || {}),
  (value) => value,
);
assert.match(moduleSyncSource, /system\.resources\.\$\{key\}\.max/, "la conversione deve conservare anche il massimo delle risorse");
assert.match(moduleSyncSource, /system\.spells\.\$\{key\}\.max/, "la conversione deve conservare anche il massimo degli slot");
const itemRecords = new Map([
  ["existing", { id: "existing", name: "Vecchio", type: "feat", _source: { _id: "existing", name: "Vecchio", type: "feat", system: {}, flags: { legacy: { stale: true } } } }],
  ["stale", { id: "stale", name: "Da rimuovere", type: "feat", _source: { _id: "stale", name: "Da rimuovere", type: "feat", system: {} } }],
]);
const itemEvents = [];
const itemActor = {
  items: { [Symbol.iterator]: () => itemRecords.values() },
  async createEmbeddedDocuments(_type, creates) {
    itemEvents.push("create");
    creates.forEach((item, index) => {
      const id = item._id || `created-${index}`;
      itemRecords.set(id, { id, name: item.name, type: item.type, _source: structuredClone({ ...item, _id: id }) });
    });
  },
  async updateEmbeddedDocuments(_type, updates) {
    itemEvents.push("update");
    updates.forEach((item) => itemRecords.set(item._id, { id: item._id, name: item.name, type: item.type, _source: structuredClone(item) }));
  },
  async deleteEmbeddedDocuments(_type, ids) {
    itemEvents.push("delete");
    ids.forEach((id) => itemRecords.delete(id));
  },
};
await reconcileActorItems(itemActor, [
  { _id: "existing", name: "Aggiornato", type: "feat", system: { uses: { max: 3 } } },
  { _id: "created", name: "Nuovo", type: "spell", system: {} },
]);
assert.equal(itemRecords.has("stale"), false, "gli Item davvero assenti dalla sorgente devono essere rimossi");
assert.equal(itemRecords.get("existing")._source.name, "Aggiornato", "un Item esistente deve essere aggiornato in sede");
assert.equal(itemRecords.has("created"), true, "un Item mancante deve essere creato");
assert.equal(itemRecords.get("existing")._source.flags, undefined, "la sostituzione deve eliminare le proprieta residue assenti dall'elemento scelto");
assert.equal(itemEvents.includes("update"), false, "un Item strutturalmente diverso deve essere ricreato con lo stesso ID e non fuso con il precedente");
assert.equal(itemEvents.at(-1), "delete", "la rimozione degli Item superflui deve avvenire soltanto dopo create e update riusciti");
const effectReconcileBlock = moduleSyncSource.match(/function uniqueManagedActorLinkEffects[\s\S]+?(?=\r?\n\r?\nfunction managedActorLinkStructuralStateSignature)/)?.[0];
assert.match(moduleSyncSource, /commandAlreadyCompleted/, "un comando gia completato prima di un riavvio deve essere confermato senza ripetere la conversione");
assert.ok(effectReconcileBlock, "la riconciliazione degli ActiveEffect deve essere testabile");
const reconcileActorEffects = new Function(
  "foundry", "stableStringify", "managedActorLinkDocumentSource", "managedActorLinkEffectSemanticState",
  `${effectReconcileBlock}\nreturn reconcileManagedActorLinkEffects;`,
)(
  { utils: { deepClone: (value) => structuredClone(value) } },
  (value) => JSON.stringify(value),
  (effect) => structuredClone(effect?._source || {}),
  (effect) => ({
    name: String(effect?.name || effect?._source?.name || ""),
    disabled: effect?.disabled === true || effect?._source?.disabled === true,
    changes: effect?.changes || effect?._source?.changes || [],
    statuses: Array.from(effect?.statuses || effect?._source?.statuses || []),
  }),
);
const createEffectCollection = (sources = []) => {
  const records = new Map(sources.map((source) => [source._id, { id: source._id, _source: structuredClone(source) }]));
  return { records, get: (id) => records.get(id), [Symbol.iterator]: () => records.values() };
};
const proneId = "dnd5eprone000000";
const deadId = "dnd5edead0000000";
const effectCollection = createEffectCollection([{ _id: proneId, name: "Prone", disabled: false }]);
let effectBranchUpdates = 0;
const effectActor = {
  effects: effectCollection,
  async update(update, options) {
    effectBranchUpdates += 1;
    assert.equal(options.diff, false);
    assert.equal(options.recursive, false);
    effectCollection.records.clear();
    for (const effect of update.effects || []) {
      const id = effect._id || `generated-${effectCollection.records.size}`;
      effectCollection.records.set(id, { id, _source: structuredClone({ ...effect, _id: id }) });
    }
  },
  async updateEmbeddedDocuments() { throw new Error(`ActiveEffect "${deadId}" does not exist!`); },
};
await reconcileActorEffects(effectActor, [
  { _id: proneId, name: "Prone", disabled: true },
  { _id: proneId, name: "Prone duplicato", disabled: true },
]);
assert.equal(effectCollection.records.size, 1, "un ID statico D&D5e duplicato deve essere conservato una sola volta");
assert.equal(effectBranchUpdates, 1, "gli effetti devono essere sostituiti atomicamente sul documento Actor");
assert.equal(effectCollection.get(proneId)._source.disabled, true);
// Simula la collezione client obsoleta che ha causato l'errore reale: il Dead
// sembra esistere in memoria, mentre un updateEmbeddedDocuments server-side lo
// rifiuterebbe. La sostituzione del ramo Actor non deve usare quella API.
effectCollection.records.set(deadId, { id: deadId, _source: { _id: deadId, name: "Dead obsoleto", statuses: ["dead"] } });
await reconcileActorEffects(effectActor, [
  { _id: proneId, name: "Prone", disabled: true },
  { _id: deadId, name: "Dead", disabled: false, statuses: ["dead"], duration: { rounds: 1 } },
]);
assert.deepEqual(
  effectCollection.get(deadId)._source.statuses,
  ["dead"],
  "gli effetti temporanei presenti nello stato scelto devono essere copiati integralmente",
);
assert.equal(effectBranchUpdates, 2, "la collezione client obsoleta non deve provocare update per-ID");
assert.match(effectReconcileBlock, /actor\.update\(\{ effects: desired \}/, "gli ActiveEffect devono essere sostituiti tramite il ramo del parent Actor");

assert.match(moduleSyncSource, /acceptStructural !== true/, "Foundry deve esigere una conferma esplicita per differenze strutturali");
assert.match(executeManagedActorLinkBlock, /importManagedActorLinkActorDocument\(actor, selectedState\.actorDocument\)/, "la conversione deve importare direttamente il JSON persistente prima di collegare i token");
const definitionBlock = moduleSyncSource.match(/const MANAGED_ACTOR_LINK_DEFINITION_PATHS[\s\S]+?(?=\nfunction managedActorLinkDefinitionUpdate)/)?.[0];
assert.ok(definitionBlock, "le funzioni di confronto strutturale devono essere testabili");
const getProperty = (target, path) => String(path || "").split(".").filter(Boolean).reduce((value, key) => value?.[key], target);
const setProperty = (target, path, value) => {
  const keys = String(path || "").split(".").filter(Boolean);
  let cursor = target;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] ||= {};
  cursor[keys.at(-1)] = value;
};
const compareDefinitions = new Function("foundry", "stableStringify", "managedActorLinkSemanticValue", `${definitionBlock}\nreturn managedActorLinkDefinitionDifferences;`)(
  { utils: { getProperty, setProperty, deepClone: (value) => structuredClone(value) } },
  stableItemStringify,
  itemComparison.managedActorLinkSemanticValue,
);
const baseAbilityData = { abilities: { str: { value: 24, proficient: 0 } }, skills: {}, attributes: {}, traits: {}, details: {} };
const syntheticAbilityData = { abilities: { str: { value: 28, proficient: 0 } }, skills: {}, attributes: {}, traits: {}, details: {} };
const resolvedAbilityDifferences = compareDefinitions(
  { _source: { system: structuredClone(baseAbilityData) }, system: structuredClone(baseAbilityData) },
  { _source: { system: structuredClone(baseAbilityData) }, system: structuredClone(syntheticAbilityData) }
);
assert.deepEqual(
  resolvedAbilityDifferences.find((entry) => entry.label === "Forza"),
  { label: "Forza", before: "24", after: "28", group: "ability" },
  "un token sintetico con STR 28 deve risultare diverso dal prototype con STR 24 anche se _source conserva 24"
);
const equivalentDerivedDefinitionA = {
  abilities: {}, skills: {}, details: {},
  attributes: { ac: { calc: "natural", flat: 18, value: 21 }, prof: 5 },
  traits: { dr: { value: new Set(["fire", "cold"]), bypasses: new Set(["mgc"]), custom: "" }, ci: { value: new Set(["charmed", "poisoned"]), custom: "" }, languages: { value: new Set(["common", "elvish"]), custom: "Telepatia", communication: { telepathy: { value: 60, units: "ft" } } } },
};
const equivalentDerivedDefinitionB = {
  abilities: {}, skills: {}, details: {},
  attributes: { ac: { calc: "natural", flat: 18, value: 21 }, prof: 5 },
  traits: { dr: { value: ["cold", "fire"], bypasses: ["mgc"], custom: "", labels: ["Cold", "Fire"], prepared: true }, ci: { value: ["poisoned", "charmed"], custom: "", labels: ["Poisoned", "Charmed"], prepared: true }, languages: { value: ["elvish", "common"], custom: "Telepatia", communication: { telepathy: { value: 60, units: "ft" } }, labels: { languages: ["Common", "Elvish", "Telepatia"], ranged: ["Telepathy 60 ft"] } } },
};
assert.deepEqual(
  compareDefinitions(
    { _source: { system: structuredClone(equivalentDerivedDefinitionA) }, system: structuredClone(equivalentDerivedDefinitionA) },
    { _source: { system: structuredClone(equivalentDerivedDefinitionB) }, system: structuredClone(equivalentDerivedDefinitionB) },
  ),
  [],
  "CA, competenza e resistenze equivalenti devono superare la verifica anche tra Set e Array",
);
const changedDerivedDefinition = structuredClone(equivalentDerivedDefinitionB);
changedDerivedDefinition.attributes.ac.value = 22;
changedDerivedDefinition.attributes.prof = 6;
changedDerivedDefinition.traits.dr.value = ["cold"];
const changedDerivedDifferences = compareDefinitions(
  { _source: { system: structuredClone(equivalentDerivedDefinitionA) }, system: structuredClone(equivalentDerivedDefinitionA) },
  { _source: { system: structuredClone(changedDerivedDefinition) }, system: structuredClone(changedDerivedDefinition) },
);
assert.deepEqual(
  changedDerivedDifferences.map((entry) => entry.label),
  ["Classe Armatura", "Bonus competenza", "Resistenze ai danni"],
  "differenze derivate reali devono continuare a bloccare una copia incompleta",
);
assert.match(
  managedActorFeSource,
  /actorType === ["']npc["'] && typeof actorLink === ["']boolean["']\) return actorLink/,
  "il frontend deve usare actorLink come autorita strutturale per gli NPC",
);
assert.match(managedActorFeSource, /actor-link\.inspect/, "il sito deve richiedere un'ispezione prima della conversione");
assert.match(managedActorFeSource, /snapshotHash/, "il sito deve confermare esattamente lo snapshot ispezionato");
assert.match(managedActorFeSource, /managedActorLinkAllDifferences/, "le opzioni devono confrontare lo stato con l'Actor originale");
assert.match(managedActorFeSource, /definitionDifferences/, "il sito deve mostrare anche statistiche, competenze e resistenze differenti");
assert.match(managedActorFeSource, /acceptStructural/, "il sito deve trasmettere la conferma strutturale esplicita");
assert.match(managedActorFeSource, /window\.confirm\(message\)/, "le differenze strutturali devono richiedere conferma prima dell'invio");
assert.match(managedActorFeSource, /managedActorLinkPreferredSourceId/, "la sorgente scelta deve restare selezionata durante refresh e nuovi tentativi");
assert.match(managedActorFeSource, /VERSION_CONFLICT.*INSPECTION_STALE.*INSPECTION_MISSING/s, "il sito deve recuperare automaticamente revisioni o ispezioni obsolete");
assert.match(await readFile(new URL("../workers/main-worker/src/index.js", import.meta.url), "utf8"), /kind === "actor-link\.inspect"[\s\S]+?startsWith\("actor-link\."\)/, "una nuova ispezione deve sostituire i comandi Link Actor obsoleti");
assert.match(layoutFeSource, /error\.code = String\(payload\?\.code/, "gli errori API devono esporre il codice macchina al recupero del FE");
const managedPlayerRosterFilterBlock = playerRosterFeSource.match(/function getManagedPlayerCharacterId[\s\S]+?(?=\r?\n    function managedPlayerPriority)/)?.[0] || "";
assert.ok(managedPlayerRosterFilterBlock, "il filtro del roster giocatori deve essere testabile");
const managedPlayerRosterHelpers = new Function("window", "normalizeText", `${managedPlayerRosterFilterBlock}\nreturn { getManagedPlayerCharacterId, isManagedPlayerEntry };`)(
  { CriptaApp: { utils: { slugify: (value, fallback = "") => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback } } },
  (value) => String(value || "").trim().toLowerCase(),
);
assert.equal(managedPlayerRosterHelpers.getManagedPlayerCharacterId({ actorType: "character" }), "", "un actor senza proprietario non deve ricevere l'id fittizio personaggio");
assert.equal(managedPlayerRosterHelpers.isManagedPlayerEntry({ actorType: "character" }), false, "un actor character non collegato non deve comparire tra i giocatori");
assert.equal(managedPlayerRosterHelpers.isManagedPlayerEntry({ actorType: "character", ownerCharacterId: "garun" }), false, "il solo tipo character non deve sostituire la relazione esplicita player");
assert.equal(managedPlayerRosterHelpers.isManagedPlayerEntry({ actorType: "character", relationshipType: "player", ownerCharacterId: "garun" }), true, "un giocatore collegato deve restare nel roster");
const managedPlayerUrlFilterBlock = layoutFeSource.match(/function isManagedPrimaryPlayerEntry[\s\S]+?(?=\r?\nfunction findManagedPlayerEntry)/)?.[0] || "";
assert.ok(managedPlayerUrlFilterBlock, "il filtro dei link giocatore deve essere testabile");
const isManagedPrimaryPlayerForUrl = new Function("normalizeText", "slugifyText", `${managedPlayerUrlFilterBlock}\nreturn isManagedPrimaryPlayerEntry;`)(
  (value) => String(value || "").trim().toLowerCase(),
  (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
);
assert.equal(isManagedPrimaryPlayerForUrl({ actorType: "character" }), false, "il router non deve trattare un actor trasformazione scollegato come pagina giocatore");
assert.equal(isManagedPrimaryPlayerForUrl({ relationshipType: "player", ownerCharacterId: "garun" }, "garun"), true, "il router deve continuare ad aprire il Managed Actor del giocatore valido");
assert.match(managedActorFeSource, /managedActorLinkExpectedActorLink/, "la pagina deve attendere e mostrare automaticamente il risultato della conversione");
assert.match(moduleSyncSource, /Number\.POSITIVE_INFINITY/, "la diagnostica della conversione deve includere tutti i campi non persistiti");
const canonicalDifferenceBlock = moduleSyncSource.match(/function managedActorLinkCanonicalDifferencePaths[\s\S]+?(?=\nfunction managedActorLinkCanonicalDifferenceLabel)/)?.[0];
assert.ok(canonicalDifferenceBlock, "il confronto canonico completo deve essere testabile");
const collectCanonicalDifferencePaths = new Function("stableStringify", `${canonicalDifferenceBlock}\nreturn managedActorLinkCanonicalDifferencePaths;`)(stableItemStringify);
const manyExpectedValues = { values: Array.from({ length: 40 }, (_, index) => index) };
const manyActualValues = { values: Array.from({ length: 40 }, (_, index) => index + 100) };
assert.equal(collectCanonicalDifferencePaths(manyExpectedValues, manyActualValues, Number.POSITIVE_INFINITY).length, 40, "la diagnostica non deve troncare i campi dopo 24 elementi");
assert.match(moduleSyncSource, /diagnostics: Array\.isArray\(result\.diagnostics\)/, "il modulo deve inviare la diagnostica completa al Worker");
assert.match(moduleSyncSource, /diagnostics: Array\.isArray\(error\?\.diagnostics\)/, "un fallimento Link Actor deve restituire i dettagli della verifica");
assert.match(managedActorFeSource, /Correzione manuale guidata/, "la pagina deve spiegare come correggere manualmente ogni campo fallito");
assert.match(managedActorFeSource, /data-managed-actor-link-reinspect/, "dopo le correzioni deve essere disponibile una nuova ispezione");
assert.doesNotMatch(managedActorFeSource, /data-managed-actor-link-apply \$\{structuralConflicts \? "disabled"/, "la presenza di differenze strutturali non deve piu bloccare ogni scelta");
assert.match(managedActorFeSource, /Aggiuntivo/, "il frontend deve distinguere chiaramente i danni secondari");
assert.match(managedActorFeSource, /managedSaveAbilityValues/, "il frontend deve normalizzare le caratteristiche del tiro salvezza");
assert.match(managedActorFeSource, /renderManagedActivityDamagePart/, "l'editor guidato deve modificare ogni componente di danno delle attivita Foundry");
assert.match(managedActorFeSource, /save\.dc\.formula/, "l'editor guidato deve modificare la CD effettiva dell'attivita Foundry");
assert.match(managedActorFeSource, /renderManagedLegendaryCapabilitySummary/, "le risorse leggendarie disponibili devono comparire accanto a capacita e attacchi");
assert.match(managedActorFeSource, /managed-entry--legendary/, "le azioni leggendarie devono avere una resa distinta dalle azioni normali");
const managedActivationHelpers = managedActorFeSource.match(/function getManagedEntryActivities[\s\S]+?(?=\r?\n    function renderManagedLegendaryActionBadge)/)?.[0] || "";
const managedEntryGroupBlock = managedActorFeSource.match(/function getManagedEntryGroup[\s\S]+?(?=\r?\n    function normalizeManagedSearch)/)?.[0] || "";
assert.ok(managedActivationHelpers && managedEntryGroupBlock, "la classificazione delle attivita deve essere testabile");
const classifyManagedCapability = new Function(`${managedActivationHelpers}\n${managedEntryGroupBlock}\nreturn getManagedEntryGroup;`)();
assert.equal(classifyManagedCapability({ definition: { activation: { type: "action" }, activities: { use: { activation: { type: "legendary", value: 2 } } } } }, "capabilities").key, "legendary", "l'attivazione moderna D&D5e deve prevalere sul vecchio campo azione");
assert.equal(classifyManagedCapability({ definition: { activities: { attack: { activation: { type: "action" } } } } }, "capabilities").key, "action", "un attacco normale deve restare tra le azioni normali");
const managedOverviewSummaryBlock = managedActorFeSource.match(/function formatManagedMovementSummary[\s\S]+?(?=\r?\n    function renderCoreStats)/)?.[0] || "";
assert.ok(managedOverviewSummaryBlock, "movimento e sensi del riepilogo devono essere testabili");
const managedOverviewSummaries = new Function(`${managedOverviewSummaryBlock}\nreturn { formatManagedMovementSummary, formatManagedSensesSummary, getManagedMovementFacts, getManagedSenseFacts };`)();
assert.equal(managedOverviewSummaries.formatManagedMovementSummary({ walk: 60, climb: 40, fly: 0, units: "ft" }), "Terra 60 ft · Scalata 40 ft", "il riepilogo deve mostrare tutte le modalita di movimento valorizzate");
assert.equal(managedOverviewSummaries.formatManagedSensesSummary({ darkvision: 120, blindsight: 120, truesight: 120, tremorsense: 0, units: "ft" }), "Scurovisione 120 ft · Vista cieca 120 ft · Vista pura 120 ft", "il riepilogo deve mostrare tutti i sensi valorizzati");
assert.deepEqual(managedOverviewSummaries.getManagedMovementFacts({ walk: 60, climb: 40, units: "ft" }).map(({ key, icon }) => ({ key, icon })), [{ key: "walk", icon: "fa-person-walking" }, { key: "climb", icon: "fa-mountain" }], "ogni modalita di movimento deve avere un'icona riconoscibile");
assert.deepEqual(managedOverviewSummaries.getManagedSenseFacts({ darkvision: 120, truesight: 120, units: "ft" }).map(({ key, icon }) => ({ key, icon })), [{ key: "darkvision", icon: "fa-moon" }, { key: "truesight", icon: "fa-eye" }], "ogni tipo di visione deve avere un'icona riconoscibile");
assert.match(managedActorFeSource, /initiative\.total \?\? initiative\.mod \?\? initiative\.bonus/, "in lettura l'iniziativa deve usare il totale Foundry prima del solo bonus manuale");
assert.match(managedActorFeSource, /note: String\(hp\.formula/, "la formula dei PF deve comparire come informazione secondaria");
assert.match(managedActorFeSource, /runtime\?\.xp\?\.value[\s\S]*?label: "PE"/, "gli XP disponibili devono comparire nel riepilogo NPC");
assert.match(managedActorFeSource, /primaryCards[\s\S]*?managed-stat-grid--primary/, "le statistiche principali devono avere una fascia dedicata");
assert.match(managedActorFeSource, /layout: "context"[\s\S]*?contextCards[\s\S]*?managed-stat-grid--context/, "movimento, sensi e risorse tattiche devono essere separati dalla fascia principale");
const managedRechargeBlock = managedActorFeSource.match(/function getManagedEntryRecharge[\s\S]+?(?=\r?\n    function renderManagedRechargeBadge)/)?.[0] || "";
assert.ok(managedRechargeBlock, "la presentazione delle capacita con ricarica deve essere testabile");
const readManagedRecharge = new Function(`${managedRechargeBlock}\nreturn getManagedEntryRecharge;`)();
assert.deepEqual(readManagedRecharge({ definition: { recharge: { value: 5, charged: true } } }), { threshold: 5, charged: true, label: "Ricarica 5–6", stateLabel: "Pronta" }, "la soglia e lo stato disponibile devono arrivare dal dato Foundry");
assert.deepEqual(readManagedRecharge({ definition: { recharge: { value: 6, charged: false } } }), { threshold: 6, charged: false, label: "Ricarica 6", stateLabel: "Da ricaricare" }, "una capacita consumata deve essere riconoscibile senza alterarne i dati");
assert.deepEqual(readManagedRecharge({ definition: { recharge: { value: 5, charged: false } } }, false), { threshold: 5, charged: null, label: "Ricarica 5–6", stateLabel: "" }, "per i token indipendenti deve comparire la soglia ma non uno stato globale fuorviante");
const modernRechargeUses = { max: 1, recovery: [{ period: "recharge", type: "recoverAll", formula: "5" }] };
assert.deepEqual(readManagedRecharge({ definition: { uses: modernRechargeUses } }), { threshold: 5, charged: null, label: "Ricarica 5–6", stateLabel: "" }, "uses.recovery deve riconoscere esattamente il formato Recharge moderno di D&D5e anche senza stato runtime");
assert.deepEqual(readManagedRecharge({ definition: { uses: modernRechargeUses }, state: { uses: { max: 1, spent: 0 } } }), { threshold: 5, charged: true, label: "Ricarica 5–6", stateLabel: "Pronta" }, "uses.recovery deve mostrare pronta quando resta un uso");
assert.deepEqual(readManagedRecharge({ definition: { uses: modernRechargeUses }, state: { uses: { max: 1, spent: 1 } } }), { threshold: 5, charged: false, label: "Ricarica 5–6", stateLabel: "Da ricaricare" }, "uses.recovery deve mostrare da ricaricare quando l'uso e stato speso");
assert.deepEqual(readManagedRecharge({ definition: { uses: { max: 1, recovery: [{ period: "recharge", type: "recoverAll", formula: "6" }] } }, state: { uses: { value: 1 } } }, false), { threshold: 6, charged: null, label: "Ricarica 6", stateLabel: "" }, "lo stato degli usi moderni non deve essere condiviso tra token indipendenti");
assert.equal(readManagedRecharge({ definition: { uses: { max: 1, recovery: [{ period: "shortRest", type: "recoverAll", formula: "5" }] } } }), null, "un recupero al riposo non deve essere scambiato per una ricarica");
assert.equal(readManagedRecharge({ definition: {} }), null, "le capacita normali non devono ricevere il badge ricarica");
assert.equal(readManagedRecharge({ definition: { recharge: { value: null, charged: true } } }), null, "il valore charged predefinito di D&D5e non deve trasformare una capacita normale in Recharge 6");
assert.match(moduleSyncSource, /recharge:\s*system\.recharge/, "il modulo Foundry deve gia esportare la soglia e lo stato Recharge nel documento esistente");
assert.match(moduleSyncSource, /uses:\s*\{\s*max:\s*system\.uses\?\.max,\s*recovery:\s*system\.uses\?\.recovery/s, "il modulo Foundry deve gia esportare uses.recovery nel documento esistente");
assert.match(moduleSyncSource, /Hooks\.on\("updateItem"[\s\S]*?queueManagedItemOwnerSync/, "un cambio dello stato Recharge deve gia accodare l'aggiornamento del Managed Actor");
const managedDamageAverageBlock = managedActorFeSource.match(/function calculateManagedDamageAverage[\s\S]+?(?=\r?\n    function renderManagedEffectiveRolls)/)?.[0] || "";
assert.ok(managedDamageAverageBlock, "il calcolo FE del danno medio deve essere testabile");
const calculateManagedDamageAverage = new Function(`${managedDamageAverageBlock}\nreturn calculateManagedDamageAverage;`)();
assert.equal(calculateManagedDamageAverage("2d6 + 4"), 11, "la media deve sommare dadi e bonus fissi");
assert.equal(calculateManagedDamageAverage("1d6"), 3, "la media D&D deve essere arrotondata per difetto");
assert.equal(calculateManagedDamageAverage("2 * (1d6 + 3)"), 13, "il calcolo deve gestire in sicurezza parentesi e moltiplicazioni");
assert.equal(calculateManagedDamageAverage("2d8 + @mod"), null, "una formula non risolta non deve mostrare una media potenzialmente errata");
assert.equal(calculateManagedDamageAverage("7"), null, "un danno fisso non deve ripetere inutilmente lo stesso valore come media");
assert.match(managedActorFeSource, /managed-effective-damage-average/, "la media deve comparire accanto alla formula nel tag danno");
const managedDamageDedupBlock = managedActorFeSource.match(/function managedDamageIdentity[\s\S]+?(?=\r?\n    function renderManagedEffectiveRolls)/)?.[0] || "";
assert.ok(managedDamageDedupBlock, "la deduplicazione FE dei danni base deve essere testabile");
const deduplicateManagedDamageParts = new Function("managedRawCollectionValues", `${managedDamageDedupBlock}\nreturn deduplicateManagedDamageParts;`)((value) => Array.isArray(value) ? value : value == null ? [] : [value]);
const duplicatedPiercingDamage = [
  { formula: "5d12 + 10", types: ["piercing"], role: "primary" },
  { formula: "5d12 + 10", types: ["piercing"], role: "secondary" },
  { formula: "6d8", types: ["psychic"], role: "secondary" },
];
assert.deepEqual(deduplicateManagedDamageParts(duplicatedPiercingDamage, duplicatedPiercingDamage[0]), [duplicatedPiercingDamage[0], duplicatedPiercingDamage[2]], "il danno base duplicato nell'export non deve produrre due tag perforanti");
assert.equal(deduplicateManagedDamageParts(duplicatedPiercingDamage, null).length, 3, "senza riscontro nel danno base il FE non deve nascondere componenti potenzialmente legittime");
const managedRawActivityBlock = managedActorFeSource.match(/function getManagedRawActivity[\s\S]+?(?=\r?\n    function resolveManagedRawFormula)/)?.[0] || "";
assert.ok(managedRawActivityBlock, "la risoluzione delle attivita Foundry deve essere testabile");
const getManagedRawActivity = new Function(`${managedRawActivityBlock}\nreturn getManagedRawActivity;`)();
const nestedFoundryActivity = { _id: "BNwVlKgdqBCg74h7", damage: { includeBase: true } };
assert.equal(getManagedRawActivity({ definition: { activities: { 0: nestedFoundryActivity } } }, "BNwVlKgdqBCg74h7"), nestedFoundryActivity, "un'attivita moderna indicizzata numericamente deve essere ritrovata tramite il proprio id Foundry");
const managedFallbackDamageBlock = managedActorFeSource.match(/function managedRawDamageSourceFormula[\s\S]+?(?=\r?\n    function buildManagedEffectiveRollFallback)/)?.[0] || "";
assert.ok(managedFallbackDamageBlock, "il calcolo FE dei modificatori impliciti deve essere testabile");
const fallbackDamageDocument = {
  definition: {
    abilities: { str: { mod: 5 } },
    attributes: { spellcasting: "int" },
    bonuses: { mwak: { damage: "" }, rwak: {}, msak: {}, rsak: {} },
  },
};
const fallbackDamageHelpers = new Function(
  "currentDocument",
  "managedRawCollectionValues",
  "resolveManagedRawFormula",
  `${managedFallbackDamageBlock}\nreturn { summarizeManagedRawDamage, managedAppendDamageFormula };`,
)(
  fallbackDamageDocument,
  (value) => Array.isArray(value) ? value : value == null || value === "" ? [] : [value],
  (value, entry, activity = {}) => {
    const ability = String(activity?.attack?.ability || entry?.definition?.attack?.ability || "").toLowerCase();
    const mod = Number(fallbackDamageDocument.definition.abilities?.[ability]?.mod || 0);
    return String(value || "").replace(/@mod\b/g, String(mod)).trim();
  },
);
const toncaWeapon = { type: "weapon", definition: { type: { value: "natural" } } };
const toncaMeleeAttack = { type: "attack", attack: { type: { value: "melee" }, ability: "str" }, attackMode: "oneHanded" };
assert.equal(
  fallbackDamageHelpers.summarizeManagedRawDamage({ number: 4, denomination: 6, types: ["slashing"] }, toncaWeapon, toncaMeleeAttack, "primary").formula,
  "4d6 + 5",
  "un'arma v14 deve aggiungere il modificatore implicito di Forza al danno primario",
);
assert.equal(
  fallbackDamageHelpers.summarizeManagedRawDamage({ number: 4, denomination: 6, bonus: "@mod", types: ["slashing"] }, toncaWeapon, toncaMeleeAttack, "primary").formula,
  "4d6 + 5",
  "un @mod gia presente non deve essere sommato due volte",
);
assert.equal(
  fallbackDamageHelpers.summarizeManagedRawDamage({ number: 2, denomination: 6, types: ["fire"] }, toncaWeapon, toncaMeleeAttack, "secondary").formula,
  "2d6",
  "il modificatore implicito non deve contaminare i danni secondari",
);
assert.equal(
  fallbackDamageHelpers.summarizeManagedRawDamage({ custom: { enabled: true, formula: "12" }, types: ["force"] }, toncaWeapon, toncaMeleeAttack, "primary").formula,
  "12",
  "un danno fisso non deve ricevere il modificatore di caratteristica",
);
assert.equal(
  fallbackDamageHelpers.summarizeManagedRawDamage({ number: 4, denomination: 6, types: ["slashing"] }, toncaWeapon, { ...toncaMeleeAttack, attackMode: "offhand" }, "primary").formula,
  "4d6",
  "una mano secondaria con modificatore positivo deve seguire l'esclusione di D&D5e",
);
fallbackDamageDocument.definition.bonuses.mwak.damage = "+2";
toncaWeapon.definition.damageBonus = "1d4";
toncaWeapon.definition.magicAvailable = true;
toncaWeapon.definition.magicalBonus = "+1";
assert.equal(
  fallbackDamageHelpers.summarizeManagedRawDamage({ number: 4, denomination: 6, types: ["slashing"] }, toncaWeapon, toncaMeleeAttack, "primary").formula,
  "4d6 + 5 + 2 + 1d4 + 1",
  "bonus globale, bonus elemento e bonus magico devono completare il danno primario",
);
assert.match(moduleSyncSource, /activity\.getDamageConfig\(\)/, "l'export Foundry deve usare il calcolo danni preparato nativo di D&D5e v14");
assert.match(moduleSyncSource, /formulaVersion:\s*2/, "il nuovo riepilogo danni deve essere distinguibile dai documenti precedenti");
assert.match(managedActorFeSource, /getManagedEffectiveRollActivities/, "il FE deve correggere anche i documenti sincronizzati prima del nuovo formato");
assert.match(managedActorFeSource, /effectiveRolls\.formulaVersion/, "il FE deve fidarsi dei modificatori gia risolti dal nuovo export");
const managedAttackFactBlock = managedActorFeSource.match(/function getManagedActivityAttackFact[\s\S]+?(?=\r?\n    function getManagedActivityRangeFact)/)?.[0] || "";
assert.ok(managedAttackFactBlock, "il tiro per colpire strutturato deve essere testabile");
const getManagedActivityAttackFact = new Function("currentDocument", "resolveManagedRawFormula", "formatSigned", `${managedAttackFactBlock}\nreturn getManagedActivityAttackFact;`)(
  { definition: { attributes: { prof: 8 }, abilities: { str: { mod: 10, attack: 18 } } } },
  (value) => String(value),
  (value) => `${Number(value) >= 0 ? "+" : ""}${Number(value)}`,
);
assert.deepEqual(getManagedActivityAttackFact({ definition: {} }, { type: "attack", attack: { type: { value: "melee" }, ability: "str", flat: false } }), { icon: "fa-crosshairs", label: "+18 a colpire", className: "is-attack" }, "il payload NPC deve produrre il tiro per colpire totale");
const managedGeometryFactBlock = managedActorFeSource.match(/function getManagedActivityRangeFact[\s\S]+?(?=\r?\n    function getManagedActivityDurationFact)/)?.[0] || "";
assert.ok(managedGeometryFactBlock, "gittata, area e bersagli devono essere testabili");
const managedGeometryFacts = new Function(`${managedGeometryFactBlock}\nreturn { getManagedActivityRangeFact, getManagedActivityAreaFact, getManagedActivityTargetFact };`)();
assert.deepEqual(managedGeometryFacts.getManagedActivityRangeFact({ definition: { range: { value: 20, reach: 5, units: "ft" } } }, { attack: { type: { value: "melee" } }, range: { units: "self", override: false } }), { icon: "fa-arrows-left-right", label: "Portata 20 ft", className: "is-range" }, "una portata ereditata dall'elemento deve restare visibile");
assert.deepEqual(managedGeometryFacts.getManagedActivityAreaFact({ target: { template: { type: "cone", size: 60, units: "ft" } } }), { icon: "fa-triangle", label: "Cono 60 ft", className: "is-area is-cone" }, "un cono deve avere forma e dimensione leggibili");
assert.deepEqual(managedGeometryFacts.getManagedActivityAreaFact({ target: { template: { type: "radius", size: 20, units: "ft" } } }), { icon: "fa-circle", label: "Raggio 20 ft", className: "is-area is-circle" }, "un raggio deve usare l'icona circolare");
assert.deepEqual(managedGeometryFacts.getManagedActivityAreaFact({ target: { template: { type: "cube", size: 15, units: "ft" } } }), { icon: "fa-square", label: "Cubo 15 ft", className: "is-area is-square" }, "un cubo deve usare l'icona quadrata");
assert.deepEqual(managedGeometryFacts.getManagedActivityAreaFact({ target: { template: { type: "line", size: 20, width: 10, units: "ft" } } }), { icon: "fa-minus", label: "Linea 20 × 10 ft", className: "is-area is-line" }, "una linea deve mostrare lunghezza e larghezza");
assert.deepEqual(managedGeometryFacts.getManagedActivityTargetFact({ target: { affects: { count: 6, type: "creature" } } }), { icon: "fa-bullseye", label: "6 creature", className: "is-target" }, "il numero di bersagli deve essere leggibile");
const managedTimingFactBlock = managedActorFeSource.match(/function getManagedActivityDurationFact[\s\S]+?(?=\r?\n    function getManagedActivityTacticalFacts)/)?.[0] || "";
assert.ok(managedTimingFactBlock, "durata ed esito del tiro salvezza devono essere testabili");
const managedTimingFacts = new Function("managedRawCollectionValues", `${managedTimingFactBlock}\nreturn { getManagedActivityDurationFact, getManagedSaveOutcomeFact };`)((value) => Array.isArray(value) ? value : value == null ? [] : [value]);
assert.deepEqual(managedTimingFacts.getManagedActivityDurationFact({ duration: { value: 1, units: "minute", concentration: true } }), { icon: "fa-hourglass-half", label: "1 minuto · concentrazione", className: "is-duration" }, "durata e concentrazione devono comparire nello stesso tag compatto");
assert.deepEqual(managedTimingFacts.getManagedSaveOutcomeFact({ damage: { onSave: "half", parts: [{}] } }, { damage: [{ formula: "6d10" }] }), { icon: "fa-shield", label: "Metà con TS riuscito", className: "is-save-outcome" }, "il danno dimezzato con TS riuscito deve essere esplicito");
assert.match(managedActorFeSource, /renderManagedActivityTacticalFacts\(getManagedActivityTacticalFacts/, "i metadati tattici devono essere inseriti accanto a danni e CD");
assert.match(managedActorFeSource, /damage\.parts\.\$\{index\}/, "i campi guidati devono puntare ai danni reali dentro system.activities");
assert.match(managedActorFeSource, /renderManagedActivitiesGuide\(activities, entry\)/, "l'editor e il riepilogo devono risolvere le formule dalla stessa definizione dell'elemento");
assert.match(managedActorFeSource, /scheduleManagedCommandRefresh\(button\.closest\("\[data-managed-actor-root\]"\)\)/, "la pagina deve seguire automaticamente una modifica elemento fino alla conferma di Foundry");
assert.match(managedActorFeSource, /Applicato in Foundry\./, "un comando concluso deve rimuovere il vecchio conflitto e mostrare l'esito");
assert.match(managedActorFeSource, /object\\s\+\(\?:set\|map\|object\)/, "il frontend deve nascondere i placeholder Object Set gia salvati");
assert.match(managedActorFeSource, /buildManagedEffectiveRollFallback/, "i dati Foundry gia salvati devono mostrare i danni anche prima di una nuova sincronizzazione");
assert.match(managedActorFeSource, /\["capabilities", "spells"\]\.includes\(collectionKind\)/, "i dettagli effettivi devono comparire anche per gli incantesimi");
assert.match(
  moduleSyncSource,
  /value === null \|\| value === undefined \|\| value === ""\) return undefined/,
  "il confronto dei comandi deve ignorare i valori vuoti rimossi durante l'esportazione",
);
assert.match(
  moduleSyncSource,
  /\.filter\(\(\[, entry\]\) => entry !== undefined\)/,
  "il confronto delle attivita deve normalizzare ricorsivamente le proprieta vuote aggiunte da D&D5e",
);
const commandComparisonBlock = moduleSyncSource.match(/function sameManagedCommandValue[\s\S]+?(?=\nasync function acknowledgeManagedActorCommands)/)?.[0];
assert.ok(commandComparisonBlock, "il confronto dei comandi Managed Actor deve essere testabile");
const stableComparableStringify = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableComparableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableComparableStringify(value[key])}`).join(",")}}`;
};
const compareManagedCommandValues = new Function("stableStringify", `${commandComparisonBlock}\nreturn sameManagedCommandValue;`)(stableComparableStringify);
const exportedActivity = { attack: { type: { value: "melee" } }, damage: { parts: [{ number: 2, denomination: 8, bonus: "@mod", types: ["slashing"], custom: { enabled: false } }] } };
const liveActivityWithDefaults = { attack: { type: { value: "melee", classification: "" }, ability: null }, damage: { parts: [{ number: 2, denomination: 8, bonus: "@mod", types: new Set(["slashing"]), custom: { enabled: false, formula: "" } }] } };
assert.equal(compareManagedCommandValues(liveActivityWithDefaults, exportedActivity), true, "i default vuoti di D&D5e non devono creare un falso conflitto");
assert.equal(compareManagedCommandValues({ ...liveActivityWithDefaults, damage: { parts: [{ ...liveActivityWithDefaults.damage.parts[0], number: 5 }] } }, exportedActivity), false, "un numero di dadi realmente diverso deve restare un conflitto");

const commandMergeBlock = moduleSyncSource.match(/function managedCommandChangedPaths[\s\S]+?(?=\nasync function applyManagedDocumentPatches)/)?.[0];
assert.ok(commandMergeBlock, "la fusione a tre vie dei comandi Managed Actor deve essere testabile");
const resolveManagedCommandPatch = new Function(
  "foundry",
  "sameManagedCommandValue",
  `${commandMergeBlock}\nreturn resolveManagedCommandPatch;`,
)({ utils: { deepClone: structuredClone } }, compareManagedCommandValues);
const emptyInitiative = resolveManagedCommandPatch(null, {
  path: "system.attributes.init.bonus",
  baseValue: 0,
  value: 0,
});
assert.equal(emptyInitiative.conflict, false, "iniziativa null e zero devono essere equivalenti");
assert.equal(emptyInitiative.changed, false, "iniziativa null non deve essere riscritta inutilmente come zero");
assert.equal(resolveManagedCommandPatch(2, {
  path: "system.attributes.init.bonus",
  baseValue: 0,
  value: 1,
}).conflict, true, "un bonus iniziativa realmente cambiato in Foundry deve restare un conflitto");
const activityBeforeWebsiteEdit = {
  attack: {
    activation: { type: "action" },
    damage: { parts: [{ number: 2, denomination: 8, bonus: "@mod", types: ["slashing"] }] },
  },
};
const activityAfterWebsiteEdit = structuredClone(activityBeforeWebsiteEdit);
activityAfterWebsiteEdit.attack.damage.parts[0].number = 3;
const activityCurrentlyInFoundry = structuredClone(activityBeforeWebsiteEdit);
activityCurrentlyInFoundry.attack.activation.type = "bonus";
activityCurrentlyInFoundry.attack.sort = 950;
const mergedActivity = resolveManagedCommandPatch(activityCurrentlyInFoundry, {
  baseValue: activityBeforeWebsiteEdit,
  value: activityAfterWebsiteEdit,
});
assert.equal(mergedActivity.conflict, false, "i metadati Foundry non modificati dal sito non devono creare conflitto");
assert.equal(mergedActivity.value.attack.damage.parts[0].number, 3, "la fusione deve applicare il solo danno richiesto dal sito");
assert.equal(mergedActivity.value.attack.activation.type, "bonus", "la fusione deve conservare le modifiche Foundry estranee al comando");
assert.equal(mergedActivity.value.attack.sort, 950, "la fusione deve conservare i metadati Foundry non presenti nel comando");
const conflictingActivity = structuredClone(activityCurrentlyInFoundry);
conflictingActivity.attack.damage.parts[0].number = 5;
assert.equal(resolveManagedCommandPatch(conflictingActivity, {
  baseValue: activityBeforeWebsiteEdit,
  value: activityAfterWebsiteEdit,
}).conflict, true, "una modifica concorrente dello stesso danno deve restare un conflitto reale");
const managedActorWorkerSource = await readFile(new URL("../workers/main-worker/src/index.js", import.meta.url), "utf8");
assert.match(managedActorWorkerSource, /normalizeManagedActorLinkDiagnostics\(result\.diagnostics\)/, "il Worker deve conservare tutta la diagnostica restituita da Foundry");
const workerDiagnosticsBlock = managedActorWorkerSource.match(/function normalizeManagedActorLinkDiagnostics[\s\S]+?(?=\nfunction publicManagedActorCommand)/)?.[0];
assert.ok(workerDiagnosticsBlock, "la normalizzazione diagnostica del Worker deve essere testabile");
const normalizeWorkerDiagnostics = new Function(`${workerDiagnosticsBlock}\nreturn normalizeManagedActorLinkDiagnostics;`)();
const manyDiagnostics = Array.from({ length: 40 }, (_, index) => ({ Categoria: "Item", Percorso: `Elemento ${index}`, Atteso: index, Ottenuto: index + 1 }));
assert.equal(normalizeWorkerDiagnostics(manyDiagnostics).length, 40, "il Worker non deve conservare soltanto un sottoinsieme delle correzioni");
assert.match(managedActorWorkerSource, /managedActorCommandIsSatisfied\(runtimeData, command\)/, "il Worker deve rimuovere i conflitti oggetto giÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â  soddisfatti dallo stato Foundry sincronizzato");
const satisfiedCommandBlock = managedActorWorkerSource.match(/function normalizeManagedActorCommandComparable[\s\S]+?(?=\nasync function handleManagedActorGet)/)?.[0];
assert.ok(satisfiedCommandBlock, "la riconciliazione dei conflitti oggetto deve essere testabile");
const isManagedActorCommandSatisfied = new Function(`${satisfiedCommandBlock}\nreturn managedActorCommandIsSatisfied;`)();
const syncedActorWithEmptyInitiative = {
  name: "Actor iniziativa vuota",
  runtime: {},
  definition: { attributes: { init: { bonus: null } } },
};
const satisfiedInitiativeCommand = {
  kind: "actor.update",
  patches: [{
    path: "system.attributes.init.bonus",
    baseValue: 0,
    value: 0,
  }],
};
assert.equal(isManagedActorCommandSatisfied(syncedActorWithEmptyInitiative, satisfiedInitiativeCommand), true, "il Worker deve chiudere automaticamente il falso conflitto iniziativa null/zero");
const differentInitiativeCommand = structuredClone(satisfiedInitiativeCommand);
differentInitiativeCommand.patches[0].value = 1;
assert.equal(isManagedActorCommandSatisfied({
  ...syncedActorWithEmptyInitiative,
  definition: { attributes: { init: { bonus: 2 } } },
}, differentInitiativeCommand), false, "il Worker deve conservare un conflitto iniziativa reale");
const syncedActorWithActivity = {
  definition: {
    items: [{
      itemId: "necrotic-claw",
      transferId: "item-necrotic-claw",
      name: "Necrotic Claw",
      definition: { activities: { attack: { type: "attack", sort: 950, activation: { type: "bonus" }, damage: { parts: [{ number: 3, denomination: 8, bonus: "@mod", types: ["slashing"], custom: { enabled: false } }] } } } },
      state: {},
    }],
  },
};
const satisfiedActivityCommand = {
  kind: "item.update",
  target: { transferId: "item-necrotic-claw" },
  patches: [{
    path: "system.activities",
    baseValue: { attack: { type: "attack", activation: { type: "action" }, damage: { parts: [{ number: 2, denomination: 8, bonus: "@mod", types: ["slashing"], custom: { enabled: false, formula: "" } }] } } },
    value: { attack: { type: "attack", activation: { type: "action" }, damage: { parts: [{ number: 3, denomination: 8, bonus: "@mod", types: ["slashing"], custom: { enabled: false, formula: "" } }] } } },
  }],
};
assert.equal(isManagedActorCommandSatisfied(syncedActorWithActivity, satisfiedActivityCommand), true, "un conflitto attivitÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â  giÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â  applicato deve essere chiuso");
const differentActivityCommand = structuredClone(satisfiedActivityCommand);
differentActivityCommand.patches[0].value.attack.damage.parts[0].number = 5;
assert.equal(isManagedActorCommandSatisfied(syncedActorWithActivity, differentActivityCommand), false, "una modifica attivitÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â  non ancora applicata deve restare visibile");
assert.match(managedActorWorkerSource, /acceptStructural: source\.acceptStructural === true/, "il Worker deve conservare soltanto una conferma strutturale booleana esplicita");
const npcDirectorySource = await readFile(new URL("../assets/js/pages/npcs.js", import.meta.url), "utf8");
assert.match(npcDirectorySource, /if \(typeof actorLink === ["']boolean["']\) return actorLink \? ["']person["'] : ["']creature["']/, "actorLink deve decidere autorevolmente tra NPC e Bestiario");
assert.match(npcDirectorySource, /const effectiveKind = managedActorDirectoryKind\(actor, profile\)/, "la lista deve usare la classificazione autorevole");
const directoryKindBlock = npcDirectorySource.match(/function managedActorDirectoryKind[\s\S]+?(?=\n\s*function getSyncedNpcImagePath)/)?.[0];
assert.ok(directoryKindBlock, "la classificazione della directory deve essere testabile");
const classifyManagedActorDirectory = new Function(`${directoryKindBlock}\nreturn managedActorDirectoryKind;`)();
assert.equal(classifyManagedActorDirectory({ actorLink: false, entityKind: "person", runtimePolicy: "shared" }, { kind: "person", kindSource: "automatic" }), "creature", "actorLink false deve correggere un indice person rimasto obsoleto");
assert.equal(classifyManagedActorDirectory({ actorLink: true, entityKind: "creature" }, { kind: "creature", kindSource: "manual" }), "person", "actorLink true deve correggere una classificazione manuale obsoleta");
assert.equal(classifyManagedActorDirectory({ actorLink: null, runtimePolicy: "per-instance" }, {}), "creature", "i record precedenti devono conservare il fallback per-instance");

await Promise.allSettled(waits);
console.log("Managed Actor safety tests passed.");
