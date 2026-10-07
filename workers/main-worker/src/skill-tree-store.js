import { PollStorageError } from './poll-store.js';

export function skillTreeD1Enabled(env, campaignId) {
  return String(env.SKILL_TREE_D1_CAMPAIGNS || '').split(/[,;\s]+/).includes(campaignId);
}
const slug = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Match the frontend's canonical identity without changing imported payloads.
export function skillTreeSubjectId(campaignId, record, index = 0) {
  const character = slug(record.characterId || record.subjectId);
  const scope = String(record.scope || record.stateScope || record.visibility || '').trim().toLowerCase();
  const shared = record.shared === true || record.campaignShared === true || record.global === true
    || ['campaign', 'campagna', 'shared', 'condiviso', 'global'].includes(scope)
    || ['campaign', 'campagna', 'global', 'all', 'tutti'].includes(character);
  if (record.treeKey && (character || shared)) return slug(`${campaignId}-${record.treeKey}-${shared ? 'shared' : character}`);
  return String(record.id || record.key || `legacy:${index}`);
}
function validRecords(data) {
  if (!Array.isArray(data) || data.some(record => !record || typeof record !== 'object' || Array.isArray(record))) {
    throw new PollStorageError('Progressi non validi: operazione interrotta.', 400, 'SKILL_TREE_DATA_INVALID');
  }
}
const conflict = () => new PollStorageError('I progressi online sono cambiati. Ricarica la pagina prima di salvare.', 409, 'VERSION_CONFLICT');
export class SkillTreeStateStore {
  constructor(env, campaignId) {
    if (!env.POLL_DB || !env.SIGILLO_KV) throw new PollStorageError('Archivio progressi D1 non configurato.');
    this.db = env.POLL_DB; this.kv = env.SIGILLO_KV; this.campaignId = campaignId;
  }
  statement(sql, ...values) { return this.db.prepare(sql).bind(...values); }
  async ensureImported() {
    if (await this.statement('SELECT 1 FROM skill_tree_documents WHERE campaign_id = ?', this.campaignId).first()) return;
    const raw = await this.kv.get(`campaign:${this.campaignId}:data:skill-tree-states:override`);
    let doc = { version: 0, data: [] };
    if (raw != null) {
      try { doc = JSON.parse(raw); } catch { throw new PollStorageError('Progressi KV non validi: importazione interrotta.', 500, 'SKILL_TREE_IMPORT_INVALID'); }
      if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.data)
        || doc.data.some(record => !record || typeof record !== 'object' || Array.isArray(record))
        || (doc.campaignId && doc.campaignId !== this.campaignId)
        || !Number.isSafeInteger(Number(doc.version || 0)) || Number(doc.version || 0) < 0) {
        throw new PollStorageError('Progressi KV non validi: importazione interrotta.', 500, 'SKILL_TREE_IMPORT_INVALID');
      }
    }
    const metadata = { ...doc }; delete metadata.data;
    const rows = doc.data.map((record, position) => ({ key: `legacy:${position}`, subject: skillTreeSubjectId(this.campaignId, record, position), position, payload: record }));
    const missing = 'NOT EXISTS (SELECT 1 FROM skill_tree_documents WHERE campaign_id = ?)';
    await this.db.batch([
      this.statement(`INSERT OR IGNORE INTO skill_tree_subjects (campaign_id, subject_key, revision)
        SELECT DISTINCT ?, json_extract(value, '$.subject'), 1 FROM json_each(?) WHERE ${missing}`, this.campaignId, JSON.stringify(rows), this.campaignId),
      this.statement(`INSERT OR IGNORE INTO skill_tree_states (campaign_id, row_key, subject_key, position, payload)
        SELECT ?, json_extract(value, '$.key'), json_extract(value, '$.subject'), json_extract(value, '$.position'), json_extract(value, '$.payload')
        FROM json_each(?) WHERE ${missing}`, this.campaignId, JSON.stringify(rows), this.campaignId),
      this.statement(`INSERT OR IGNORE INTO skill_tree_documents (campaign_id, version, metadata, has_override, original_raw, imported_at)
        VALUES (?, ?, ?, ?, ?, ?)`, this.campaignId, raw == null ? 0 : Number(doc.version || 1), JSON.stringify(metadata), raw == null ? 0 : 1, raw, new Date().toISOString())
    ]);
  }
  async readRow() {
    await this.ensureImported();
    // All fields come from one SQL snapshot; no stale metadata/data mix.
    return this.statement(`SELECT d.*, COALESCE((SELECT json_group_array(json(payload)) FROM
        (SELECT payload FROM skill_tree_states WHERE campaign_id = d.campaign_id ORDER BY position, row_key)), '[]') AS data,
      COALESCE((SELECT json_group_object(subject_key, revision) FROM skill_tree_subjects WHERE campaign_id = d.campaign_id), '{}') AS revisions
      FROM skill_tree_documents d WHERE campaign_id = ?`, this.campaignId).first();
  }
  documentFromRow(row) {
    const metadata = JSON.parse(row.metadata);
    return { ok: true, collection: 'skill-tree-states', campaignId: this.campaignId, source: row.has_override ? 'd1' : 'static',
      version: row.version, updatedAt: metadata.updatedAt || null, updatedBy: metadata.updatedBy || null,
      data: row.has_override ? JSON.parse(row.data) : null, stateRevisions: JSON.parse(row.revisions) };
  }
  async getDocument() { return this.documentFromRow(await this.readRow()); }
  async saveState(record, expectedRevision, attribution) {
    validRecords([record]);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw conflict();
    const subject = skillTreeSubjectId(this.campaignId, record);
    if (!record.treeKey || !record.characterId || record.id !== subject || (record.key && record.key !== subject)) {
      throw new PollStorageError('Identità del progresso non valida.', 400, 'SKILL_TREE_DATA_INVALID');
    }
    await this.ensureImported();
    const mutation = crypto.randomUUID();
    const cas = expectedRevision === 0
      ? this.statement(`INSERT INTO skill_tree_subjects (campaign_id, subject_key, revision, mutation_id) VALUES (?, ?, 1, ?)
          ON CONFLICT (campaign_id, subject_key) DO NOTHING`, this.campaignId, subject, mutation)
      : this.statement(`UPDATE skill_tree_subjects SET revision = revision + 1, mutation_id = ?
          WHERE campaign_id = ? AND subject_key = ? AND revision = ?`, mutation, this.campaignId, subject, expectedRevision);
    // Unique operation id gates every statement, including unsuccessful CAS.
    // Comparing only revision+1 would let a stale request reuse another save.
    const gate = 'EXISTS (SELECT 1 FROM skill_tree_subjects WHERE campaign_id = ? AND subject_key = ? AND mutation_id = ?)';
    const params = [this.campaignId, subject, mutation];
    const results = await this.db.batch([
      cas,
      this.statement(`DELETE FROM skill_tree_states WHERE campaign_id = ? AND subject_key = ? AND ${gate}`, this.campaignId, subject, ...params),
      this.statement(`INSERT INTO skill_tree_states (campaign_id, row_key, subject_key, position, payload)
        SELECT ?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM skill_tree_states WHERE campaign_id = ?), 0), ? WHERE ${gate}`,
        this.campaignId, `subject:${subject}`, subject, this.campaignId, JSON.stringify(record), ...params),
      this.statement(`UPDATE skill_tree_documents SET version = version + 1, has_override = 1,
        metadata = json_patch(metadata, ?) WHERE campaign_id = ? AND ${gate}`, JSON.stringify(attribution), this.campaignId, ...params)
    ]);
    if (!results[0].meta.changes) throw conflict();
    return this.getDocument();
  }
  async replaceCollection(data, expectedVersion, attribution) {
    validRecords(data);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw conflict();
    const before = await this.getDocument();
    if (before.version !== expectedVersion) throw conflict();
    const grouped = records => {
      const groups = new Map();
      records.forEach((record, index) => { const key = skillTreeSubjectId(this.campaignId, record, index); const list = groups.get(key) || []; list.push(record); groups.set(key, list); });
      return groups;
    };
    const previous = grouped(before.data || []), next = grouped(data);
    const changed = [...new Set([...previous.keys(), ...next.keys()])].filter(key => JSON.stringify(previous.get(key)) !== JSON.stringify(next.get(key)));
    const rows = data.map((record, position) => ({ key: `legacy:${position}`, subject: skillTreeSubjectId(this.campaignId, record, position), position, payload: record }));
    const mutation = crypto.randomUUID();
    const gate = 'EXISTS (SELECT 1 FROM skill_tree_documents WHERE campaign_id = ? AND mutation_id = ?)';
    const params = [this.campaignId, mutation];
    const results = await this.db.batch([
      this.statement(`UPDATE skill_tree_documents SET version = version + 1, has_override = 1, metadata = json_patch(metadata, ?), mutation_id = ?
        WHERE campaign_id = ? AND version = ?`, JSON.stringify(attribution), mutation, this.campaignId, expectedVersion),
      this.statement(`INSERT INTO skill_tree_subjects (campaign_id, subject_key, revision, mutation_id)
        SELECT ?, value, 1, ? FROM json_each(?) WHERE ${gate}
        ON CONFLICT (campaign_id, subject_key) DO UPDATE SET revision = revision + 1, mutation_id = excluded.mutation_id`,
        this.campaignId, mutation, JSON.stringify(changed), ...params),
      this.statement(`DELETE FROM skill_tree_states WHERE campaign_id = ? AND ${gate}`, this.campaignId, ...params),
      this.statement(`INSERT INTO skill_tree_states (campaign_id, row_key, subject_key, position, payload)
        SELECT ?, json_extract(value, '$.key'), json_extract(value, '$.subject'), json_extract(value, '$.position'), json_extract(value, '$.payload')
        FROM json_each(?) WHERE ${gate}`, this.campaignId, JSON.stringify(rows), ...params)
    ]);
    if (!results[0].meta.changes) throw conflict();
    return this.getDocument();
  }
  async exportCampaign() {
    const row = await this.readRow();
    const document = this.documentFromRow(row);
    return { schemaVersion: 1, campaignId: this.campaignId, exportedAt: new Date().toISOString(), originalRaw: row.original_raw,
      importedAt: row.imported_at, document, kvDocuments: row.has_override ? [{ key: `campaign:${this.campaignId}:data:skill-tree-states:override`,
        value: JSON.stringify({ ...JSON.parse(row.metadata), campaignId: this.campaignId, collection: 'skill-tree-states', version: document.version, data: document.data }) }] : [] };
  }
}
