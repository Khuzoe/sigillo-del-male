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
};

function media(path, revision = 1) {
  return { path: `media/${path}`, revision, source: "foundry" };
}

async function post(body) {
  const response = await worker.fetch(new Request(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ campaignId, ...body }),
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
assert.doesNotMatch(moduleSyncSource, /\u00C3|\u00C2/, "il modulo non deve contenere testo UTF-8 ricodificato");
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
assert.doesNotMatch(moduleSyncSource, /ui\.notifications\.info\(`\$\{actor\.name\}: Link Actor Data/, "la sincronizzazione riuscita degli NPC deve restare soltanto in console");
assert.match(moduleSyncSource, /managedActorLinkItemStateDifferences/, "l'ispezione deve descrivere le differenze di stato degli oggetti");
assert.match(moduleSyncSource, /managedActorLinkPairItemStates/, "gli oggetti di Actor e token devono essere associati con identita progressive");
assert.match(moduleSyncSource, /managedActorLinkEffectDifferences/, "l'ispezione deve indicare gli effetti diversi tra Actor e token");
assert.match(moduleSyncSource, /managedActorLinkDefinitionDifferences/, "l'ispezione deve confrontare statistiche, competenze e tratti");
assert.match(moduleSyncSource, /managedActorLinkResolvedSystemValue\(sourceActor, `abilities\.\$\{key\}\.value`/, "STR, DEX e le altre caratteristiche devono usare i valori risolti del token sintetico");
assert.match(moduleSyncSource, /actorDefinitionState/, "lo snapshot deve proteggere anche le statistiche strutturali");
assert.match(moduleSyncSource, /applyManagedActorLinkDefinition\(actor, selectedState\.definition\)/, "lo stato selezionato deve propagare anche statistiche e competenze");
assert.match(moduleSyncSource, /managedActorLinkItemDefinitionSignature/, "le modifiche meccaniche interne agli oggetti devono bloccare una conversione distruttiva");
assert.doesNotMatch(moduleSyncSource, /foundry\.utils\.unsetProperty/, "la firma degli oggetti deve essere compatibile anche con Foundry senza unsetProperty");
assert.match(moduleSyncSource, /actor\.update\(\{\s*["']prototypeToken\.actorLink["']:\s*true/, "actorLink puo essere attivato soltanto dalla conversione confermata");
assert.match(moduleSyncSource, /patch\?\.path !== ["']prototypeToken\.actorLink["']/, "i normali comandi actor.update non devono poter cambiare actorLink");
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
  `${itemComparisonBlock}\nreturn { managedActorLinkItemStateDifferences, managedActorLinkStructureSignature, managedActorLinkItemDefinitionDifferences, managedActorLinkItemDefinitionSignature };`,
)(
  { utils: { deepClone: (value) => structuredClone(value) } },
  hashItemValue,
  (item) => String(item?.flags?.["cripta-wiki-sync"]?.transferId || ""),
  stableItemStringify,
  "cripta-wiki-sync",
  "khuzoe-tokenizer",
);
const linkTestItem = ({ id, transferId = "", prepared = true, damage = "1d6", activityId = "primary", sourceLabel = "", properties = [] }) => {
  const source = {
    _id: id,
    name: "Multiattack",
    type: "feat",
    img: "icons/example.webp",
    system: {
      preparation: { prepared },
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
const linkChangedTokenActor = { items: [linkTestItem({ id: "same-id", prepared: false })], effects: [] };
const changedItemDifferences = itemComparison.managedActorLinkItemStateDifferences(linkBaseActor, linkChangedTokenActor);
assert.equal(changedItemDifferences.length, 1);
assert.equal(changedItemDifferences[0].changes[0].label, "Preparato");
const linkMechanicalTokenActor = { items: [linkTestItem({ id: "same-id", damage: "2d6" })], effects: [] };
const mechanicalDifferences = itemComparison.managedActorLinkItemStateDifferences(linkBaseActor, linkMechanicalTokenActor);
assert.equal(mechanicalDifferences.length, 1);
assert.equal(mechanicalDifferences[0].structural, true);
assert.equal(mechanicalDifferences[0].changes[0].label, "Danni attivita");
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
assert.match(mechanicalDifferences[0].changes[0].before, /1d6/);
assert.match(mechanicalDifferences[0].changes[0].after, /2d6/);
assert.match(moduleSyncSource, /schemaVersion: 3/, "il rollback deve usare lo snapshot strutturale completo");
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
const itemRecords = new Map([
  ["existing", { id: "existing", name: "Vecchio", type: "feat", _source: { _id: "existing", name: "Vecchio", type: "feat", system: {} } }],
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
const effectCollection = createEffectCollection([{ _id: proneId, name: "Prone", disabled: false }]);
let createdEffects = 0;
let updatedEffects = 0;
const effectActor = {
  effects: effectCollection,
  async deleteEmbeddedDocuments(_type, ids) { ids.forEach((id) => effectCollection.records.delete(id)); },
  async updateEmbeddedDocuments(_type, updates) {
    updatedEffects += updates.length;
    updates.forEach((effect) => effectCollection.records.set(effect._id, { id: effect._id, _source: structuredClone(effect) }));
  },
  async createEmbeddedDocuments(_type, creates) {
    createdEffects += creates.length;
    for (const effect of creates) {
      if (effectCollection.records.has(effect._id)) throw new Error("duplicate effect id");
      effectCollection.records.set(effect._id, { id: effect._id, _source: structuredClone(effect) });
    }
  },
};
await reconcileActorEffects(effectActor, [
  { _id: proneId, name: "Prone", disabled: true },
  { _id: proneId, name: "Prone duplicato", disabled: true },
]);
assert.equal(effectCollection.records.size, 1, "un ID statico D&D5e duplicato deve essere conservato una sola volta");
assert.equal(createdEffects, 0, "un effetto gia presente deve essere aggiornato e non ricreato");
assert.equal(updatedEffects, 1, "l'effetto Prone esistente deve essere aggiornato in-place");
assert.equal(effectCollection.get(proneId)._source.disabled, true);
assert.match(moduleSyncSource, /acceptStructural !== true/, "Foundry deve esigere una conferma esplicita per differenze strutturali");
assert.match(moduleSyncSource, /verifyManagedActorLinkStructuralState\(actor, selectedState\.structural\)/, "la copia strutturale deve essere verificata semanticamente contro lo snapshot immutabile prima di collegare i token");
const definitionBlock = moduleSyncSource.match(/const MANAGED_ACTOR_LINK_DEFINITION_PATHS[\s\S]+?(?=\nfunction managedActorLinkDefinitionUpdate)/)?.[0];
assert.ok(definitionBlock, "le funzioni di confronto strutturale devono essere testabili");
const getProperty = (target, path) => String(path || "").split(".").filter(Boolean).reduce((value, key) => value?.[key], target);
const setProperty = (target, path, value) => {
  const keys = String(path || "").split(".").filter(Boolean);
  let cursor = target;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] ||= {};
  cursor[keys.at(-1)] = value;
};
const compareDefinitions = new Function("foundry", "stableStringify", `${definitionBlock}\nreturn managedActorLinkDefinitionDifferences;`)(
  { utils: { getProperty, setProperty, deepClone: (value) => structuredClone(value) } },
  (value) => JSON.stringify(value)
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
const managedActorFeSource = await readFile(new URL("../assets/js/pages/managed-actor.js", import.meta.url), "utf8");
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
assert.match(await readFile(new URL("../assets/js/layout.js", import.meta.url), "utf8"), /error\.code = String\(payload\?\.code/, "gli errori API devono esporre il codice macchina al recupero del FE");
assert.match(managedActorFeSource, /managedActorLinkExpectedActorLink/, "la pagina deve attendere e mostrare automaticamente il risultato della conversione");
assert.doesNotMatch(managedActorFeSource, /data-managed-actor-link-apply \$\{structuralConflicts \? "disabled"/, "la presenza di differenze strutturali non deve piu bloccare ogni scelta");
assert.match(managedActorFeSource, /Aggiuntivo/, "il frontend deve distinguere chiaramente i danni secondari");
assert.match(managedActorFeSource, /managedSaveAbilityValues/, "il frontend deve normalizzare le caratteristiche del tiro salvezza");
assert.match(managedActorFeSource, /renderManagedActivityDamagePart/, "l'editor guidato deve modificare ogni componente di danno delle attivita Foundry");
assert.match(managedActorFeSource, /save\.dc\.formula/, "l'editor guidato deve modificare la CD effettiva dell'attivita Foundry");
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
