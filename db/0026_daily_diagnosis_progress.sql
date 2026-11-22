-- Apply only when these columns are absent (0025 fresh installs include them).
ALTER TABLE daily_diagnosis_jobs ADD COLUMN stage TEXT;
ALTER TABLE daily_diagnosis_jobs ADD COLUMN progress_at TEXT;
