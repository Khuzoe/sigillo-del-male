CREATE TABLE IF NOT EXISTS city_maps (
  campaign_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  location_id TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1,
  image_key TEXT,
  width INTEGER,
  height INTEGER,
  source_world TEXT,
  source_scene TEXT,
  source_revision TEXT,
  source_frame TEXT,
  PRIMARY KEY (campaign_id, id),
  UNIQUE (campaign_id, source_world, source_scene)
);

CREATE TABLE IF NOT EXISTS city_map_points (
  campaign_id TEXT NOT NULL,
  map_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location_id TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL CHECK (x BETWEEN 0 AND 1),
  y REAL NOT NULL CHECK (y BETWEEN 0 AND 1),
  revealed INTEGER NOT NULL DEFAULT 0 CHECK (revealed IN (0, 1)),
  detail_world TEXT,
  detail_scene TEXT,
  detail_shared INTEGER NOT NULL DEFAULT 0 CHECK (detail_shared IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (campaign_id, map_id, id),
  FOREIGN KEY (campaign_id, map_id) REFERENCES city_maps (campaign_id, id)
);

CREATE TABLE IF NOT EXISTS city_map_notes (
  campaign_id TEXT NOT NULL,
  map_id TEXT NOT NULL,
  point_id TEXT NOT NULL,
  id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('personal', 'group', 'dm')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (campaign_id, map_id, point_id, id),
  FOREIGN KEY (campaign_id, map_id, point_id) REFERENCES city_map_points (campaign_id, map_id, id)
);

CREATE TABLE IF NOT EXISTS city_map_scene_jobs (
  campaign_id TEXT NOT NULL,
  map_id TEXT NOT NULL,
  id TEXT NOT NULL,
  world_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  PRIMARY KEY (campaign_id, id),
  UNIQUE (campaign_id, map_id),
  UNIQUE (campaign_id, world_id, scene_id),
  FOREIGN KEY (campaign_id, map_id) REFERENCES city_maps (campaign_id, id)
);

CREATE INDEX IF NOT EXISTS city_map_jobs_world ON city_map_scene_jobs (campaign_id, world_id, completed);
