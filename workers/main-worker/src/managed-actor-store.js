const encoder = new TextEncoder();
const CHUNK_CHARACTERS = 160000;
const SQL_VALUE_BYTES = 900000;

export class ManagedActorStorageError extends Error {
  constructor(message, status = 503, code = "MANAGED_ACTOR_STORAGE_UNAVAILABLE") {
    super(message); this.status = status; this.code = code;
  }
}

function configured(env, name, campaignId) {
  return String(env[name] || "").split(/[,;\s]+/).includes(campaignId);
}
export const managedActorD1Enabled = (env, campaignId) => configured(env, "MANAGED_ACTOR_D1_CAMPAIGNS", campaignId);
export const managedActorWritesPaused = (env, campaignId) => configured(env, "MANAGED_ACTOR_WRITES_PAUSED_CAMPAIGNS", campaignId);

export function managedActorKeyScope(key) {
  const match = String(key).match(/^campaign:([a-z0-9_-]+):(.+)$/);
  if (!match) return null;
  const name = match[2];
  let kind;
  if (/^managed-actor:[^:]+:[^:]+$/.test(name)) kind = "actor";
  else if (/^managed-actor-runtime:[^:]+:[^:]+$/.test(name)) kind = "runtime";
  else if (/^managed-actor-profile:[^:]+:[^:]+$/.test(name)) kind = "profile";
  else if (/^managed-actor-profile-link:[^:]+$/.test(name)) kind = "profile-link";
  else if (/^managed-actor-media-cleanup:[^:]+:[^:]+$/.test(name)) kind = "media-cleanup";
  else if (/^managed-actor-migration-backup:.+$/.test(name)) kind = "legacy-backup";
  else if (/^managed-actor-commands:[^:]+$/.test(name)) kind = "commands";
  else if (name === "managed-actor-create-requests") kind = "create-requests";
  else if (name === "managed-actors:index") kind = "index";
  else if (name === "npc-categories") kind = "categories";
  else return null;
  return { campaignId: match[1], kind };
}

function invalid(message) { throw new ManagedActorStorageError(message, 500, "MANAGED_ACTOR_DATA_INVALID"); }
function parse(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { invalid("Documento NPC non valido. Nessun dato è stato sostituito."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Documento NPC non valido.");
  return value;
}

export function splitManagedActorText(raw) {
  const chunks = [];
  for (let offset = 0; offset < raw.length;) {
    let end = Math.min(offset + CHUNK_CHARACTERS, raw.length);
    // Never split a surrogate pair: joining must preserve the original bytes.
    if (end < raw.length && /[\uD800-\uDBFF]/.test(raw[end - 1])) end--;
    chunks.push(raw.slice(offset, end)); offset = end;
  }
  return chunks;
}

// The same serializer is used by the offline, read-only KV importer and Worker.
export function managedActorStorageRecord(key, raw, revision = 1, now = new Date().toISOString()) {
  const scope = managedActorKeyScope(key);
  if (!scope) invalid("Chiave NPC non riconosciuta.");
  const value = parse(raw);
  if (value.campaignId && value.campaignId !== scope.campaignId) invalid("Campagna del documento NPC non coerente.");
  if (["actor", "runtime", "profile"].includes(scope.kind)) {
    const [, , , worldId, actorId] = key.split(":");
    if ((value.worldId && value.worldId !== worldId) || (value.actorId && value.actorId !== actorId)) invalid("Identità del documento NPC non coerente.");
  }
  const field = scope.kind === "commands" ? "commands" : scope.kind === "create-requests" ? "requests" : null;
  const commands = [];
  let payload = raw;
  if (field) {
    if (!Array.isArray(value[field])) invalid("Coda NPC non valida.");
    const seen = new Set();
    for (const [position, command] of value[field].entries()) {
      const id = String(command?.id || "");
      if (!id || seen.has(id) || !command || typeof command !== "object" || Array.isArray(command)) invalid("Identificativi duplicati o mancanti nella coda NPC.");
      seen.add(id);
      const text = JSON.stringify(command);
      if (encoder.encode(text).length > 1800000) throw new ManagedActorStorageError("Il singolo comando NPC supera la dimensione consentita.", 413, "MANAGED_ACTOR_COMMAND_TOO_LARGE");
      commands.push({ campaign: scope.campaignId, key, id, position, actor: String(command.actorId || ""), status: String(command.status || "pending"), payload: text });
    }
    const metadata = { ...value }; delete metadata[field]; payload = JSON.stringify(metadata);
  }
  const chunks = encoder.encode(payload).length > 800000 ? splitManagedActorText(payload) : [];
  return { document: { campaign: scope.campaignId, key, kind: scope.kind, revision, present: 1, payload: chunks.length ? null : payload, chunks: chunks.length, at: now },
    chunks: chunks.map((payload, part) => ({ campaign: scope.campaignId, key, part, payload })), commands };
}

// Keep bound JSON well below D1's 2 MB limit, including escaping overhead.
export function managedActorJsonBatches(values) {
  const batches = []; let batch = [], bytes = 2;
  for (const value of values) {
    const size = encoder.encode(JSON.stringify(value)).length + 1;
    if (size > 1800000) throw new ManagedActorStorageError("Dati NPC troppo grandi per una singola operazione.", 413, "MANAGED_ACTOR_VALUE_TOO_LARGE");
    if (batch.length && bytes + size > SQL_VALUE_BYTES) { batches.push(JSON.stringify(batch)); batch = []; bytes = 2; }
    batch.push(value); bytes += size;
  }
  if (batch.length) batches.push(JSON.stringify(batch));
  return batches;
}

export class ManagedActorTransaction {
  constructor(env) {
    this.env = env; this.db = env.POLL_DB; this.kv = env.SIGILLO_KV;
    this.loaded = new Map(); this.pending = new Map(); this.ready = new Map(); this.receipts = [];
    this.afterCommit = []; this.loading = [];
  }
  statement(sql, ...args) {
    if (!this.db) throw new ManagedActorStorageError("Archivio NPC D1 non configurato.");
    return this.db.prepare(sql).bind(...args);
  }
  async ensureReady(campaignId) {
    if (!this.ready.has(campaignId)) this.ready.set(campaignId, this.statement(
      "SELECT state FROM managed_actor_imports WHERE campaign_id = ?", campaignId).first().then(row => {
      if (row?.state !== "ready") throw new ManagedActorStorageError("Archivio NPC in preparazione. Riprova tra poco.", 503, "MANAGED_ACTOR_IMPORT_NOT_READY");
    }));
    return this.ready.get(campaignId);
  }
  decodeRows(rows, entries, scope) {
    if (!rows.length) return { raw: null, revision: 0 };
    const row = rows[0];
    if (!row.present) return { raw: null, revision: row.revision };
    let raw = row.payload;
    if (row.chunk_count) {
      if (rows.length !== row.chunk_count || rows.some((entry, index) => entry.part !== index)) invalid("Documento NPC incompleto: lettura interrotta.");
      raw = rows.map(entry => entry.chunk).join("");
    }
    if (raw == null) invalid("Documento NPC privo di contenuto.");
    if (["commands", "create-requests"].includes(scope.kind)) {
      const field = scope.kind === "commands" ? "commands" : "requests";
      raw = JSON.stringify({ ...parse(raw), [field]: entries.map(entry => parse(entry.payload)) });
    }
    return { raw, revision: row.revision };
  }
  load(key, scope) {
    const promise = new Promise((resolve, reject) => this.loading.push({ key, scope, resolve, reject }));
    if (this.loading.length === 1) queueMicrotask(() => this.flushLoads());
    return promise;
  }
  async flushLoads() {
    const requests = this.loading.splice(0);
    try {
      await Promise.all([...new Set(requests.map(item => item.scope.campaignId))].map(id => this.ensureReady(id)));
      for (const campaign of new Set(requests.map(item => item.scope.campaignId))) {
        const scoped = requests.filter(item => item.scope.campaignId === campaign);
        // Index hydration may request hundreds of profiles together. Batch reads
        // avoid turning those into hundreds of D1 queries on a Free Worker.
        for (let offset = 0; offset < scoped.length; offset += 80) {
          const batch = scoped.slice(offset, offset + 80), keys = batch.map(item => item.key);
          const placeholders = keys.map(() => "?").join(",");
          const statements = [this.statement(`SELECT d.document_key, d.revision, d.present, d.payload, d.chunk_count, c.part, c.payload AS chunk
            FROM managed_actor_documents d LEFT JOIN managed_actor_document_chunks c
            ON c.campaign_id = d.campaign_id AND c.document_key = d.document_key
            WHERE d.campaign_id = ? AND d.document_key IN (${placeholders}) ORDER BY d.document_key, c.part`, campaign, ...keys)];
          const queueKeys = batch.filter(item => ["commands", "create-requests"].includes(item.scope.kind)).map(item => item.key);
          if (queueKeys.length) statements.push(this.statement(`SELECT queue_key, payload FROM managed_actor_commands
            WHERE campaign_id = ? AND queue_key IN (${queueKeys.map(() => "?").join(",")}) AND present = 1 ORDER BY queue_key, position, command_id`, campaign, ...queueKeys));
          // Queue metadata and entries must belong to the same SQL snapshot.
          const result = await this.db.batch(statements), rows = result[0].results || [], entries = result[1]?.results || [];
          for (const item of batch) item.resolve(this.decodeRows(rows.filter(row => row.document_key === item.key), entries.filter(row => row.queue_key === item.key), item.scope));
        }
      }
    } catch (error) {
      const failure = error instanceof ManagedActorStorageError ? error : new ManagedActorStorageError("Archivio NPC D1 temporaneamente non disponibile.");
      for (const item of requests) item.reject(failure);
    }
  }
  async get(key, options) {
    const scope = managedActorKeyScope(key);
    if (!scope || !managedActorD1Enabled(this.env, scope.campaignId)) return this.kv.get(key, options);
    if (!this.loaded.has(key)) this.loaded.set(key, this.load(key, scope));
    const stored = await this.loaded.get(key);
    const raw = this.pending.has(key) ? this.pending.get(key) : stored.raw;
    const type = typeof options === "string" ? options : options?.type;
    if (raw == null || !type || type === "text") return raw;
    if (type === "json") return JSON.parse(raw);
    if (type === "arrayBuffer") return encoder.encode(raw).buffer;
    if (type === "stream") return new Blob([raw]).stream();
    throw new TypeError("Unsupported managed Actor storage read type");
  }
  assertWritable(scope) {
    if (scope && managedActorWritesPaused(this.env, scope.campaignId)) {
      throw new ManagedActorStorageError("Salvataggi NPC temporaneamente sospesi per la migrazione. Riprova tra poco.", 503, "MANAGED_ACTOR_WRITES_PAUSED");
    }
  }
  async put(key, raw, options) {
    const scope = managedActorKeyScope(key); this.assertWritable(scope);
    if (!scope || !managedActorD1Enabled(this.env, scope.campaignId)) return this.kv.put(key, raw, options);
    if (typeof raw !== "string") throw new TypeError("Managed Actor documents must be JSON text");
    managedActorStorageRecord(key, raw); // Validate before staging anything.
    await this.get(key); this.pending.set(key, raw);
  }
  async delete(key) {
    const scope = managedActorKeyScope(key); this.assertWritable(scope);
    if (!scope || !managedActorD1Enabled(this.env, scope.campaignId)) return this.kv.delete(key);
    await this.get(key); this.pending.set(key, null);
  }
  async getWithMetadata(key, options) {
    const scope = managedActorKeyScope(key);
    if (!scope || !managedActorD1Enabled(this.env, scope.campaignId)) return this.kv.getWithMetadata(key, options);
    return { value: await this.get(key, options), metadata: null, cacheStatus: null };
  }
  defer(callback) { this.afterCommit.push(callback); }
  recordAcknowledgements(campaignId, worldId, body) {
    if (!managedActorD1Enabled(this.env, campaignId)) return;
    for (const [key, results] of [[`campaign:${campaignId}:managed-actor-commands:${worldId}`, body?.results], [`campaign:${campaignId}:managed-actor-create-requests`, body?.createResults]]) {
      for (const result of (Array.isArray(results) ? results : []).slice(0, 256)) {
        if (result?.id && ["applied", "failed", "conflict", "review"].includes(result.status)) this.receipts.push({
          campaign: campaignId, key, id: String(result.id), status: result.status, payload: JSON.stringify(result), at: new Date().toISOString(),
        });
      }
    }
  }
  async commit() {
    if (!this.pending.size && !this.receipts.length) {
      for (const callback of this.afterCommit.splice(0)) callback();
      return;
    }
    const now = new Date().toISOString(), documents = [], chunks = [], commands = [], guards = [];
    // Validate every managed read used to make a mutation, not only its target.
    // This also protects ownership and command base values during an Actor sync.
    for (const [key, promise] of this.loaded) {
      const scope = managedActorKeyScope(key), stored = await promise;
      guards.push({ campaign: scope.campaignId, key, revision: stored.revision });
    }
    for (const [key, raw] of this.pending) {
      const scope = managedActorKeyScope(key); this.assertWritable(scope);
      const previous = await this.loaded.get(key);
      if (raw === previous.raw) continue;
      if (raw == null) documents.push({ campaign: scope.campaignId, key, kind: scope.kind, revision: previous.revision + 1, present: 0, payload: null, chunks: 0, at: now });
      else {
        const record = managedActorStorageRecord(key, raw, previous.revision + 1, now);
        documents.push(record.document); chunks.push(...record.chunks); commands.push(...record.commands);
      }
    }
    if (!documents.length && !this.receipts.length) { this.pending.clear(); for (const callback of this.afterCommit.splice(0)) callback(); return; }
    const operationId = crypto.randomUUID();
    const gate = "EXISTS (SELECT 1 FROM managed_actor_transactions WHERE operation_id = ?)";
    const statements = [this.statement(`INSERT INTO managed_actor_transactions(operation_id)
      SELECT ? WHERE NOT EXISTS (SELECT 1 FROM json_each(?) g
      LEFT JOIN managed_actor_documents d ON d.campaign_id = json_extract(g.value, '$.campaign') AND d.document_key = json_extract(g.value, '$.key')
      WHERE COALESCE(d.revision, 0) <> json_extract(g.value, '$.revision'))`, operationId, JSON.stringify(guards))];
    for (const values of managedActorJsonBatches(documents)) statements.push(this.statement(`INSERT INTO managed_actor_documents
      (campaign_id, document_key, kind, revision, present, payload, chunk_count, updated_at)
      SELECT json_extract(value, '$.campaign'), json_extract(value, '$.key'), json_extract(value, '$.kind'), json_extract(value, '$.revision'),
        json_extract(value, '$.present'), json_extract(value, '$.payload'), json_extract(value, '$.chunks'), json_extract(value, '$.at')
      FROM json_each(?) WHERE ${gate} ON CONFLICT(campaign_id, document_key) DO UPDATE SET
      kind = excluded.kind, revision = excluded.revision, present = excluded.present, payload = excluded.payload, chunk_count = excluded.chunk_count, updated_at = excluded.updated_at`, values, operationId));
    const keys = JSON.stringify(documents.map(({ campaign, key }) => ({ campaign, key })));
    statements.push(this.statement(`DELETE FROM managed_actor_document_chunks WHERE ${gate} AND EXISTS
      (SELECT 1 FROM json_each(?) k WHERE campaign_id = json_extract(k.value, '$.campaign') AND document_key = json_extract(k.value, '$.key'))`, operationId, keys));
    for (const values of managedActorJsonBatches(chunks)) statements.push(this.statement(`INSERT INTO managed_actor_document_chunks (campaign_id, document_key, part, payload)
      SELECT json_extract(value, '$.campaign'), json_extract(value, '$.key'), json_extract(value, '$.part'), json_extract(value, '$.payload') FROM json_each(?) WHERE ${gate}`, values, operationId));
    statements.push(this.statement(`UPDATE managed_actor_commands SET present = 0, archived_at = ? WHERE ${gate} AND present = 1 AND EXISTS
      (SELECT 1 FROM json_each(?) k WHERE campaign_id = json_extract(k.value, '$.campaign') AND queue_key = json_extract(k.value, '$.key'))`, now, operationId, keys));
    for (const values of managedActorJsonBatches(commands)) statements.push(this.statement(`INSERT INTO managed_actor_commands
      (campaign_id, queue_key, command_id, position, actor_id, status, present, payload)
      SELECT json_extract(value, '$.campaign'), json_extract(value, '$.key'), json_extract(value, '$.id'), json_extract(value, '$.position'),
        json_extract(value, '$.actor'), json_extract(value, '$.status'), 1, json_extract(value, '$.payload') FROM json_each(?) WHERE ${gate}
      ON CONFLICT(campaign_id, queue_key, command_id) DO UPDATE SET position = excluded.position, actor_id = excluded.actor_id,
        status = excluded.status, present = 1, payload = excluded.payload, archived_at = NULL`, values, operationId));
    for (const values of managedActorJsonBatches(this.receipts)) statements.push(this.statement(`INSERT INTO managed_actor_command_receipts
      (campaign_id, queue_key, command_id, status, payload, received_at)
      SELECT json_extract(value, '$.campaign'), json_extract(value, '$.key'), json_extract(value, '$.id'), json_extract(value, '$.status'),
        json_extract(value, '$.payload'), json_extract(value, '$.at') FROM json_each(?) WHERE ${gate}
      ON CONFLICT(campaign_id, queue_key, command_id) DO UPDATE SET status = excluded.status, payload = excluded.payload, received_at = excluded.received_at
      WHERE managed_actor_command_receipts.status <> 'applied'`, values, operationId));
    statements.push(this.statement("SELECT 1 AS committed FROM managed_actor_transactions WHERE operation_id = ?", operationId));
    statements.push(this.statement("DELETE FROM managed_actor_transactions WHERE operation_id = ?", operationId));
    let result;
    try { result = await this.db.batch(statements); }
    catch { throw new ManagedActorStorageError("Salvataggio NPC non riuscito. Nessuna modifica è stata applicata all’archivio D1."); }
    if (!result.at(-2)?.results?.[0]?.committed) throw new ManagedActorStorageError(
      "L’NPC è stato aggiornato da un’altra richiesta. Ricarica i dati e riprova.", 409, "MANAGED_ACTOR_STORAGE_CONFLICT");
    this.pending.clear(); this.loaded.clear(); this.receipts = [];
    for (const callback of this.afterCommit.splice(0)) callback();
  }
}

export function managedActorStorageEnvironment(env) {
  if (!env.SIGILLO_KV) return { env, transaction: null };
  const transaction = new ManagedActorTransaction(env);
  const kv = {
    get: transaction.get.bind(transaction), put: transaction.put.bind(transaction), delete: transaction.delete.bind(transaction),
    getWithMetadata: transaction.getWithMetadata.bind(transaction), list: (...args) => env.SIGILLO_KV.list(...args),
  };
  return { env: { ...env, SIGILLO_KV: kv, MANAGED_ACTOR_TRANSACTION: transaction }, transaction };
}
