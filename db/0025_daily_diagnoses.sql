-- Daily diagnoses have their own history; never replace a weekly report.
CREATE TABLE IF NOT EXISTS daily_diagnosis_monitor (
  id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 1,
  checked_revision INTEGER NOT NULL DEFAULT 0, checked_day TEXT, checked_at TEXT, checked_version TEXT, retry_pending INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT, lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
INSERT OR IGNORE INTO daily_diagnosis_monitor(id) VALUES(1);
CREATE TABLE IF NOT EXISTS daily_diagnosis_state (
  platform TEXT NOT NULL, period TEXT NOT NULL, baseline TEXT,
  active INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL,
  input_hash TEXT, signals TEXT NOT NULL DEFAULT '[]', current_report_id TEXT,
  error TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY(platform,period)
);
CREATE TABLE IF NOT EXISTS daily_diagnosis_jobs (
  run_id TEXT PRIMARY KEY, platform TEXT NOT NULL, period TEXT NOT NULL,
  baseline TEXT NOT NULL, input_hash TEXT NOT NULL, evidence TEXT NOT NULL,
  status TEXT NOT NULL, requested_by TEXT NOT NULL,
  markdown TEXT, model TEXT, error TEXT, created_at TEXT NOT NULL, finished_at TEXT,
  stage TEXT, progress_at TEXT
);
CREATE INDEX IF NOT EXISTS daily_diagnosis_queue ON daily_diagnosis_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS daily_diagnosis_history ON daily_diagnosis_jobs(platform,period,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS daily_diagnosis_one_pending ON daily_diagnosis_jobs(platform,period) WHERE status IN ('queued','running');
