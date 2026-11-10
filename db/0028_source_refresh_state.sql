-- Five-minute scheduler callbacks only dispatch due daily refreshes.
CREATE TABLE IF NOT EXISTS source_refresh_state (
  source TEXT NOT NULL,
  period TEXT NOT NULL,
  refreshed_day TEXT NOT NULL,
  status TEXT NOT NULL,
  attempted_at INTEGER NOT NULL,
  PRIMARY KEY(source, period)
);
