const DEFAULT_CAMPAIGN = "cripta-di-sangue";

export function pollD1Enabled(env, campaignId) {
  return String(env.POLL_D1_CAMPAIGNS || "").split(/[,;\s]+/).includes(campaignId);
}

export class PollStorageError extends Error {
  constructor(message, status = 503, code = "POLL_STORAGE_UNAVAILABLE") {
    super(message); this.status = status; this.code = code;
  }
}

function document(raw, label) {
  if (raw == null) return null;
  let value;
  try { value = JSON.parse(raw); } catch { /* Reject instead of importing an empty replacement. */ }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PollStorageError(`Dati ${label} non validi: importazione interrotta.`, 500, "POLL_IMPORT_INVALID");
  }
  return value;
}

function accountId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

// D1 owns an enabled campaign. KV is read once for each imported record and
// never changed. Storage failures must not send writes back to an old snapshot.
export class D1PollStore {
  constructor(env, campaignId) {
    if (!env.POLL_DB || !env.SIGILLO_KV) throw new PollStorageError("Archivio sondaggi D1 non configurato.");
    this.db = env.POLL_DB; this.kv = env.SIGILLO_KV; this.campaignId = campaignId;
  }
  statement(sql, ...values) { return this.db.prepare(sql).bind(...values); }
  async legacy(key) {
    const scoped = await this.kv.get(`campaign:${this.campaignId}:${key}`);
    if (scoped != null) return scoped;
    // Old unscoped keys belong exclusively to the original campaign.
    return this.campaignId === DEFAULT_CAMPAIGN ? this.kv.get(key) : null;
  }
  async ensureSession(number, currentRaw = null) {
    const importKey = `session:${number}`;
    const exists = await this.statement(`SELECT 1 FROM poll_imports WHERE campaign_id = ? AND import_key = ?
      UNION ALL SELECT 1 FROM poll_sessions WHERE campaign_id = ? AND session_number = ? LIMIT 1`, this.campaignId, importKey, this.campaignId, number).first();
    if (exists) return;
    const [sessionRaw, votesRaw] = await Promise.all([this.legacy(`session/${number}`), this.legacy(`session-votes/${number}`)]);
    if (sessionRaw == null && currentRaw == null) {
      const candidate = await this.legacy("session/current");
      if (candidate && document(candidate, "sessione corrente").number === number) currentRaw = candidate;
    }
    const session = document(sessionRaw ?? currentRaw, "sessione");
    const votes = document(votesRaw, "voti");
    // Public requests for nonexistent session numbers must not fill D1 with
    // empty records. Newly created D1 sessions are recognized by the query above.
    if (!session && !votes) return;
    if ((session && Number(session.number) !== number) || (votes?.sessionNumber != null && Number(votes.sessionNumber) !== number)
      || [session, votes].some(value => value?.campaignId && value.campaignId !== this.campaignId)) {
      throw new PollStorageError("Identità del sondaggio non coerente: importazione interrotta.", 500, "POLL_IMPORT_INVALID");
    }
    if (votes && !Array.isArray(votes.votes)) throw new PollStorageError("Elenco voti non valido: importazione interrotta.", 500, "POLL_IMPORT_INVALID");
    const importedVotes = (votes?.votes || []).map((vote, index) => {
      if (!vote || typeof vote !== "object" || Array.isArray(vote)) throw new PollStorageError("Voto non valido: importazione interrotta.", 500, "POLL_IMPORT_INVALID");
      return { key: `legacy:${index}`, accountId: accountId(vote.accountId || vote.playerId), discordId: String(vote.discordId || "").trim(), payload: vote };
    });
    const metadata = votes ? { ...votes } : { sessionNumber: number, campaignId: this.campaignId };
    delete metadata.votes;
    const missingImport = "NOT EXISTS (SELECT 1 FROM poll_imports WHERE campaign_id = ? AND import_key = ?)";
    const statements = [];
    if (session) statements.push(this.statement(`INSERT OR IGNORE INTO poll_sessions (campaign_id, session_number, payload, revision)
      SELECT ?, ?, ?, 1 WHERE ${missingImport}`, this.campaignId, number, JSON.stringify(session), this.campaignId, importKey));
    if (votes || session) statements.push(this.statement(`INSERT OR IGNORE INTO poll_vote_documents (campaign_id, session_number, payload)
      SELECT ?, ?, ? WHERE ${missingImport}`, this.campaignId, number, JSON.stringify(metadata), this.campaignId, importKey));
    statements.push(this.statement(`INSERT OR IGNORE INTO poll_votes (campaign_id, session_number, voter_key, account_id, discord_id, payload)
      SELECT ?, ?, json_extract(value, '$.key'), json_extract(value, '$.accountId'), json_extract(value, '$.discordId'), json_extract(value, '$.payload')
      FROM json_each(?) WHERE ${missingImport}`, this.campaignId, number, JSON.stringify(importedVotes), this.campaignId, importKey));
    statements.push(this.statement(`INSERT OR IGNORE INTO poll_imports
      (campaign_id, import_key, session_raw, votes_raw, current_raw, imported_at) VALUES (?, ?, ?, ?, ?, ?)`,
      this.campaignId, importKey, sessionRaw, votesRaw, currentRaw, new Date().toISOString()));
    // Seeding and marking the import are one transaction. A second importer
    // cannot reintroduce old selections after a user has changed their vote.
    await this.db.batch(statements);
  }
  async getSession(number) {
    await this.ensureSession(number);
    const row = await this.statement("SELECT payload, revision FROM poll_sessions WHERE campaign_id = ? AND session_number = ?", this.campaignId, number).first();
    return row ? { ...document(row.payload, "sessione"), revision: row.revision } : null;
  }
  async getCurrentSession() {
    const query = () => this.statement(`SELECT s.payload, s.revision FROM poll_current c JOIN poll_sessions s
      ON s.campaign_id = c.campaign_id AND s.session_number = c.session_number WHERE c.campaign_id = ?`, this.campaignId).first();
    let row = await query();
    if (!row) {
      const imported = await this.statement("SELECT 1 FROM poll_imports WHERE campaign_id = ? AND import_key = 'current'", this.campaignId).first();
      if (!imported) {
        const raw = await this.legacy("session/current");
        const session = document(raw, "sessione corrente");
        if (session && (!Number.isSafeInteger(session.number) || session.number <= 0 || (session.campaignId && session.campaignId !== this.campaignId))) {
          throw new PollStorageError("Sessione corrente non valida: importazione interrotta.", 500, "POLL_IMPORT_INVALID");
        }
        if (session) await this.ensureSession(session.number, raw);
        const statements = [];
        if (session) statements.push(this.statement("INSERT OR IGNORE INTO poll_current (campaign_id, session_number) VALUES (?, ?)", this.campaignId, session.number));
        statements.push(this.statement(`INSERT OR IGNORE INTO poll_imports (campaign_id, import_key, current_raw, imported_at)
          VALUES (?, 'current', ?, ?)`, this.campaignId, raw, new Date().toISOString()));
        await this.db.batch(statements);
        row = await query();
      }
    }
    return row ? { ...document(row.payload, "sessione"), revision: row.revision } : null;
  }
  async getVotes(number) {
    await this.ensureSession(number);
    const row = await this.statement(`SELECT d.payload, COALESCE((SELECT json_group_array(json(v.payload)) FROM poll_votes v
      WHERE v.campaign_id = d.campaign_id AND v.session_number = d.session_number), '[]') AS votes
      FROM poll_vote_documents d WHERE d.campaign_id = ? AND d.session_number = ?`, this.campaignId, number).first();
    return row ? { ...document(row.payload, "voti"), votes: JSON.parse(row.votes) } : null;
  }
  async saveSession(session, expectedRevision) {
    const number = session.number;
    await this.ensureSession(number);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new PollStorageError("Ricarica il sondaggio prima di salvarlo.", 409, "POLL_REVISION_CONFLICT");
    }
    const payload = JSON.stringify(session);
    const queries = [this.statement(`INSERT INTO poll_sessions (campaign_id, session_number, payload, revision)
      SELECT ?, ?, ?, 1 WHERE ? = 0
      ON CONFLICT (campaign_id, session_number) DO NOTHING`, this.campaignId, number, payload, expectedRevision),
      this.statement(`UPDATE poll_sessions SET payload = ?, revision = revision + 1
      WHERE campaign_id = ? AND session_number = ? AND revision = ? AND ? > 0`, payload, this.campaignId, number, expectedRevision, expectedRevision)];
    // changes() is evaluated directly after the conditional UPDATE/INSERT.
    // Session, current pointer and vote initialization commit together; stale
    // edits never move the pointer or overwrite another editor's configuration.
    const write = expectedRevision === 0 ? queries[0] : queries[1];
    const results = await this.db.batch([write,
      this.statement(`INSERT INTO poll_current (campaign_id, session_number) SELECT ?, ? WHERE changes() > 0
        ON CONFLICT (campaign_id) DO UPDATE SET session_number = excluded.session_number`, this.campaignId, number),
      this.statement(`INSERT OR IGNORE INTO poll_vote_documents (campaign_id, session_number, payload)
        SELECT ?, ?, ? FROM poll_sessions WHERE campaign_id = ? AND session_number = ?`,
        this.campaignId, number, JSON.stringify({ sessionNumber: number, campaignId: this.campaignId }), this.campaignId, number)]);
    if (!results[0].meta.changes) throw new PollStorageError("Il sondaggio è stato modificato. Ricaricalo prima di salvare.", 409, "POLL_REVISION_CONFLICT");
    return { ...session, revision: expectedRevision + 1 };
  }
  async saveVote(number, { accountId: id, authenticatedDiscordId, name, optionId, value }) {
    await this.ensureSession(number);
    // A caller-provided Discord id can never select another person's record.
    const previous = await this.statement(`SELECT voter_key, payload FROM poll_votes WHERE campaign_id = ? AND session_number = ?
      AND (account_id = ? OR (? <> '' AND discord_id = ?)) ORDER BY CASE WHEN account_id = ? THEN 0 ELSE 1 END, voter_key LIMIT 1`,
      this.campaignId, number, id, authenticatedDiscordId, authenticatedDiscordId, id).first();
    const voterKey = previous?.voter_key || `account:${id}`;
    const previousVote = previous ? document(previous.payload, "voto") : {};
    const discordId = authenticatedDiscordId || String(previousVote.discordId || "");
    const patch = { playerId: id, accountId: id, discordId, name: name || previousVote.name || id, selections: { [optionId]: value } };
    const result = await this.statement(`INSERT INTO poll_votes (campaign_id, session_number, voter_key, account_id, discord_id, payload)
      SELECT ?, ?, ?, ?, ?, ? FROM poll_sessions s WHERE s.campaign_id = ? AND s.session_number = ?
      AND EXISTS (SELECT 1 FROM json_each(s.payload, '$.availabilityOptions') WHERE json_extract(value, '$.id') = ?)
      ON CONFLICT (campaign_id, session_number, voter_key) DO UPDATE SET
      account_id = excluded.account_id, discord_id = excluded.discord_id,
      payload = json_patch(poll_votes.payload, excluded.payload)`,
      this.campaignId, number, voterKey, id, discordId, JSON.stringify(patch), this.campaignId, number, optionId).run();
    if (!result.meta.changes) throw new PollStorageError("Questa data non è più nel sondaggio. Ricarica la pagina.", 409, "POLL_OPTION_CONFLICT");
    return this.getVotes(number);
  }
  async exportCampaign() {
    await this.getCurrentSession();
    const [sessions, current, originals, voteDocuments] = await Promise.all([
      this.statement("SELECT session_number, payload FROM poll_sessions WHERE campaign_id = ? ORDER BY session_number", this.campaignId).all(),
      this.statement("SELECT session_number FROM poll_current WHERE campaign_id = ?", this.campaignId).first(),
      this.statement("SELECT * FROM poll_imports WHERE campaign_id = ? ORDER BY import_key", this.campaignId).all(),
      this.statement(`SELECT d.session_number, d.payload, COALESCE((SELECT json_group_array(json(v.payload)) FROM poll_votes v
        WHERE v.campaign_id = d.campaign_id AND v.session_number = d.session_number), '[]') AS votes
        FROM poll_vote_documents d WHERE d.campaign_id = ? ORDER BY d.session_number`, this.campaignId).all()
    ]);
    const kvDocuments = [];
    const append = (key, value) => {
      kvDocuments.push({ key: `campaign:${this.campaignId}:${key}`, value });
      if (this.campaignId === DEFAULT_CAMPAIGN) kvDocuments.push({ key, value });
    };
    for (const session of sessions.results) {
      append(`session/${session.session_number}`, session.payload);
      if (session.session_number === current?.session_number) append("session/current", session.payload);
    }
    // Export all imported vote documents (including legacy orphans) in one
    // query, keeping query counts independent of the number of past sessions.
    for (const row of voteDocuments.results) {
      append(`session-votes/${row.session_number}`, JSON.stringify({ ...document(row.payload, "voti"), votes: JSON.parse(row.votes) }));
    }
    return { schemaVersion: 1, campaignId: this.campaignId, exportedAt: new Date().toISOString(), kvDocuments, originals: originals.results };
  }
}
