-- Persist partial model output separately; never publish an incomplete report.
ALTER TABLE daily_diagnosis_jobs ADD COLUMN checkpoint TEXT;
ALTER TABLE daily_diagnosis_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_diagnosis_jobs ADD COLUMN continuation_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_diagnosis_jobs ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
