CREATE TABLE IF NOT EXISTS sync_jobs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_jobs_latest ON sync_jobs(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS sync_jobs_active ON sync_jobs(status) WHERE status = 'running';
