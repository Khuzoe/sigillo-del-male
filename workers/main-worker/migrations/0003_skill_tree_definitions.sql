-- Additive schema. Original KV values are never modified by this store.
CREATE TABLE IF NOT EXISTS skill_tree_definition_documents (
  campaign_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL,
  metadata TEXT NOT NULL CHECK (json_valid(metadata)),
  has_override INTEGER NOT NULL,
  original_raw TEXT,
  imported_at TEXT NOT NULL,
  mutation_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS skill_tree_definitions (
  campaign_id TEXT NOT NULL,
  tree_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  position INTEGER NOT NULL,
  payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
  mutation_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (campaign_id, tree_id)
);
