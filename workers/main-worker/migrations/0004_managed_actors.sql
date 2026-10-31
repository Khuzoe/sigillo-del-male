-- Additive only. Import tools read KV; neither this schema nor the Worker
-- writes to the original KV keys of an enabled campaign.
CREATE TABLE IF NOT EXISTS managed_actor_imports (
  campaign_id TEXT PRIMARY KEY,
  migration_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('importing', 'ready')),
  imported_at TEXT NOT NULL,
  verified_at TEXT,
  document_count INTEGER NOT NULL,
  manifest_sha256 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS managed_actor_documents (
  campaign_id TEXT NOT NULL,
  document_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  present INTEGER NOT NULL DEFAULT 1 CHECK (present IN (0, 1)),
  payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
  chunk_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, document_key)
);

CREATE TABLE IF NOT EXISTS managed_actor_document_chunks (
  campaign_id TEXT NOT NULL,
  document_key TEXT NOT NULL,
  part INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (campaign_id, document_key, part),
  FOREIGN KEY (campaign_id, document_key) REFERENCES managed_actor_documents(campaign_id, document_key)
);

CREATE TABLE IF NOT EXISTS managed_actor_commands (
  campaign_id TEXT NOT NULL,
  queue_key TEXT NOT NULL,
  command_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  actor_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  present INTEGER NOT NULL CHECK (present IN (0, 1)),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  archived_at TEXT,
  PRIMARY KEY (campaign_id, queue_key, command_id),
  FOREIGN KEY (campaign_id, queue_key) REFERENCES managed_actor_documents(campaign_id, document_key)
);
CREATE INDEX IF NOT EXISTS managed_actor_commands_active ON managed_actor_commands(campaign_id, queue_key, present, position);

CREATE TABLE IF NOT EXISTS managed_actor_command_receipts (
  campaign_id TEXT NOT NULL,
  queue_key TEXT NOT NULL,
  command_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  received_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, queue_key, command_id)
);

-- Original bytes, including whitespace, are separate from the live documents.
-- Chunks keep large Actors below D1's maximum size for a row or bound value.
CREATE TABLE IF NOT EXISTS managed_actor_kv_originals (
  campaign_id TEXT NOT NULL,
  document_key TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  metadata TEXT NOT NULL CHECK (json_valid(metadata)),
  chunk_count INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, document_key)
);
CREATE TABLE IF NOT EXISTS managed_actor_kv_original_chunks (
  campaign_id TEXT NOT NULL,
  document_key TEXT NOT NULL,
  part INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (campaign_id, document_key, part),
  FOREIGN KEY (campaign_id, document_key) REFERENCES managed_actor_kv_originals(campaign_id, document_key)
);

-- A short-lived gate inside a D1 batch. It is removed in the same transaction.
CREATE TABLE IF NOT EXISTS managed_actor_transactions (
  operation_id TEXT PRIMARY KEY
);

-- Used only by the offline importer to keep SQL literals below 100 KB.
-- Its rows are removed at the end of that same guarded import file.
CREATE TABLE IF NOT EXISTS managed_actor_import_parts (
  migration_id TEXT NOT NULL,
  value_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (migration_id, value_id, part)
);
