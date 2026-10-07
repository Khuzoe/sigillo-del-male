-- Additive migration: no existing KV, D1 or media data is removed.
CREATE TABLE IF NOT EXISTS poll_sessions (
  campaign_id TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (campaign_id, session_number)
);
CREATE TABLE IF NOT EXISTS poll_current (
  campaign_id TEXT PRIMARY KEY NOT NULL,
  session_number INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS poll_vote_documents (
  campaign_id TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (campaign_id, session_number)
);
CREATE TABLE IF NOT EXISTS poll_votes (
  campaign_id TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  voter_key TEXT NOT NULL,
  account_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (campaign_id, session_number, voter_key)
);
CREATE INDEX IF NOT EXISTS poll_votes_account ON poll_votes (campaign_id, session_number, account_id);
CREATE INDEX IF NOT EXISTS poll_votes_discord ON poll_votes (campaign_id, session_number, discord_id);
CREATE TABLE IF NOT EXISTS poll_imports (
  campaign_id TEXT NOT NULL,
  import_key TEXT NOT NULL,
  session_raw TEXT,
  votes_raw TEXT,
  current_raw TEXT,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, import_key)
);
