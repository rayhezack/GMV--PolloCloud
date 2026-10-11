CREATE TABLE IF NOT EXISTS report_jobs (
  run_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS report_jobs_latest ON report_jobs(platform, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS report_jobs_active ON report_jobs(platform) WHERE status IN ('queued', 'running');
