DROP INDEX IF EXISTS sync_jobs_active;
CREATE UNIQUE INDEX IF NOT EXISTS sync_jobs_active ON sync_jobs((1)) WHERE status IN ('queued', 'running');
