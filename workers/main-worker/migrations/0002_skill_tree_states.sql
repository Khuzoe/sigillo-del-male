-- Additive only. Original KV bytes are copied once and never updated.
CREATE TABLE IF NOT EXISTS skill_tree_documents (
  campaign_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL,
  metadata TEXT NOT NULL CHECK (json_valid(metadata)),
  has_override INTEGER NOT NULL,
  original_raw TEXT,
  imported_at TEXT NOT NULL,
  mutation_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS skill_tree_subjects (
  campaign_id TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  mutation_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (campaign_id, subject_key)
);
CREATE TABLE IF NOT EXISTS skill_tree_states (
  campaign_id TEXT NOT NULL,
  row_key TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (campaign_id, row_key)
);
CREATE INDEX IF NOT EXISTS skill_tree_states_subject ON skill_tree_states (campaign_id, subject_key);
