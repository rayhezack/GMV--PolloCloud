-- Product action snapshots. Source 统计日/统计时间 are deliberately excluded.
CREATE TABLE IF NOT EXISTS pollo_da_product_action_details (
  snapshot_id TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  release_time TEXT,
  update_point TEXT,
  description TEXT,
  board TEXT,
  version TEXT,
  platform TEXT,
  action_type TEXT,
  source TEXT,
  original_message_link TEXT,
  fields_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, source_record_id)
);
CREATE TABLE IF NOT EXISTS product_action_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_snapshot TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER,
  sync_date TEXT,
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
INSERT OR IGNORE INTO product_action_sync_state (id) VALUES (1);
