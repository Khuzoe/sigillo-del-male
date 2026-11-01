import { NPC_NATIVE_SNAPSHOT_VERSION, NPC_NATIVE_SNAPSHOT_CAMPAIGNS, NPC_NATIVE_SNAPSHOT_MAX_BYTES, npcNativeSnapshotHash } from "../../../integrations/cripta-wiki-sync/npc-native-snapshot.mjs";
import { managedActorD1Enabled } from "./managed-actor-store.js";

export function npcNativeSnapshotD1Enabled(env, campaignId) {
  return NPC_NATIVE_SNAPSHOT_CAMPAIGNS.includes(campaignId) && managedActorD1Enabled(env, campaignId)
    && String(env.MANAGED_ACTOR_NATIVE_SNAPSHOT_CAMPAIGNS || "").split(/[,;\s]+/).includes(campaignId);
}
export const npcNativeSnapshotKey = (campaignId, worldId, actorId) => `campaign:${campaignId}:managed-actor-native-snapshot:${worldId}:${actorId}`;
const plain = value => value && typeof value === "object" && !Array.isArray(value);
const identityId = value => String(value || "").trim().toLowerCase();
const invalid = message => Object.assign(new Error(message), { status: 400, code: "NPC_SNAPSHOT_INVALID" });

export async function validateNpcNativeSnapshot(snapshot, campaignId, route, actor, contract) {
  if (!plain(snapshot) || snapshot.schemaVersion !== NPC_NATIVE_SNAPSHOT_VERSION) throw invalid("Versione snapshot NPC non supportata.");
  if (Object.keys(snapshot).some(key => !["schemaVersion", "identity", "versions", "actor", "hash", "capturedAt"].includes(key))) throw invalid("Campi snapshot NPC non supportati.");
  const identity = snapshot.identity, source = snapshot.actor, versions = snapshot.versions;
  if (!plain(identity) || identity.campaignId !== campaignId || identity.worldId !== route.worldId
    || identityId(identity.foundryActorId) !== route.actorId || identity.foundryActorId !== String(actor.foundryActorId || actor.actorId)) {
    throw invalid("Identità snapshot NPC non coerente con la scheda sincronizzata.");
  }
  if (!plain(source) || source.type !== "npc" || source._id !== identity.foundryActorId || !plain(source.system)
    || !Array.isArray(source.items) || !Array.isArray(source.effects)) throw invalid("Il JSON nativo deve contenere l’Actor NPC con sistema, oggetti ed effetti.");
  if (!plain(versions) || !plain(versions.foundry) || versions.foundry.generation !== 14
    || !plain(versions.system) || versions.system.id !== "dnd5e" || !Array.isArray(versions.modules)
    || versions.modules.length > 1000 || versions.modules.some(module => !plain(module) || typeof module.id !== "string" || typeof module.version !== "string")) {
    throw invalid("Versioni o moduli dello snapshot NPC non validi.");
  }
  if (identity.actorUuid !== String(actor.actorUuid || `Actor.${identity.foundryActorId}`)
    || !Number.isFinite(Date.parse(snapshot.capturedAt || ""))) throw invalid("Origine o data dello snapshot NPC non valida.");
  if (contract && (versions.foundry.generation !== contract.foundry.generation || versions.foundry.version !== contract.foundry.version
    || versions.system.id !== contract.system.id || versions.system.version !== contract.system.version || versions.wikiSync !== contract.module.version)) {
    throw invalid("Le versioni dello snapshot NPC non corrispondono al contratto Foundry.");
  }
  if (!/^[a-f0-9]{64}$/.test(snapshot.hash || "") || await npcNativeSnapshotHash(snapshot) !== snapshot.hash) {
    throw invalid("Il contenuto dello snapshot NPC non corrisponde al suo hash.");
  }
  return snapshot;
}

// Only the private endpoint calls this writer. The normal Actor, dossier,
// index, AI context and KV documents never receive the complete native JSON.
export async function saveNpcNativeSnapshot(env, campaignId, route, actor, snapshot) {
  if (!npcNativeSnapshotD1Enabled(env, campaignId) || !env.MANAGED_ACTOR_TRANSACTION) {
    throw Object.assign(new Error("Archivio snapshot NPC D1 non abilitato."), { status: 503, code: "NPC_SNAPSHOT_DISABLED" });
  }
  const key = npcNativeSnapshotKey(campaignId, route.worldId, route.actorId);
  const raw = await env.SIGILLO_KV.get(key), previous = raw ? JSON.parse(raw) : null;
  if (previous?.snapshot?.hash === snapshot.hash) return { saved: false, hash: snapshot.hash, schemaVersion: snapshot.schemaVersion, receivedAt: previous.receivedAt };
  const previousModified = Number(previous?.snapshot?.actor?._stats?.modifiedTime || 0);
  const incomingModified = Number(snapshot.actor?._stats?.modifiedTime || 0);
  if (previousModified > 0 && incomingModified > 0 && incomingModified < previousModified) {
    throw Object.assign(new Error("Lo snapshot ricevuto è precedente a quello già conservato."), { status: 409, code: "NPC_SNAPSHOT_STALE" });
  }
  const document = {
    schemaVersion: 1, campaignId, worldId: route.worldId, actorId: route.actorId,
    actorRevision: Number(actor.revision || 0), receivedAt: new Date().toISOString(),
    bytes: new TextEncoder().encode(JSON.stringify(snapshot)).length, snapshot,
  };
  await env.SIGILLO_KV.put(key, JSON.stringify(document));
  return { saved: true, hash: snapshot.hash, schemaVersion: snapshot.schemaVersion, receivedAt: document.receivedAt, bytes: document.bytes };
}

export { NPC_NATIVE_SNAPSHOT_MAX_BYTES };
