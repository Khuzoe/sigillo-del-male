CREATE TABLE IF NOT EXISTS foundry_map_snapshots (
  campaign_id TEXT NOT NULL,
  world_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  title TEXT NOT NULL,
  revision TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  player_key TEXT NOT NULL,
  dm_key TEXT NOT NULL,
  player_hash TEXT NOT NULL,
  dm_hash TEXT NOT NULL,
  PRIMARY KEY (campaign_id, world_id, scene_id)
);
