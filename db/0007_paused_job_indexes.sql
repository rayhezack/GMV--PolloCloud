DROP INDEX IF EXISTS report_jobs_active;
CREATE UNIQUE INDEX IF NOT EXISTS report_jobs_active
  ON report_jobs(platform)
  WHERE status IN ('queued', 'running', 'pausing', 'paused');

DROP INDEX IF EXISTS sync_jobs_active;
CREATE UNIQUE INDEX IF NOT EXISTS sync_jobs_active
  ON sync_jobs((1))
  WHERE status IN ('queued', 'running', 'pausing', 'paused');
