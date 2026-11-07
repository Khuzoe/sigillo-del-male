-- Separate readiness gate. Catalogs and folders reuse the existing document
-- and original-byte tables so a drop and its Actor command can commit together.
CREATE TABLE IF NOT EXISTS campaign_item_imports (
  campaign_id TEXT PRIMARY KEY,
  migration_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('importing', 'ready')),
  imported_at TEXT NOT NULL,
  verified_at TEXT,
  document_count INTEGER NOT NULL,
  manifest_sha256 TEXT NOT NULL
);
