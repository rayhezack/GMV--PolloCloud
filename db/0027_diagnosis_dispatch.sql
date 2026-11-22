-- A single model lane for anomaly diagnoses and scheduled weekly reports.
CREATE TABLE IF NOT EXISTS diagnosis_dispatch (
  id INTEGER PRIMARY KEY CHECK(id=1),
  not_before INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO diagnosis_dispatch(id) VALUES(1);
