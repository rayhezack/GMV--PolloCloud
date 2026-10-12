CREATE TABLE IF NOT EXISTS sync_job_staging_chunks (
  run_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  payload TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, step_key, chunk_index)
);

CREATE INDEX IF NOT EXISTS sync_job_staging_chunks_run
  ON sync_job_staging_chunks(run_id);
