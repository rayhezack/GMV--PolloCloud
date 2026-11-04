CREATE TABLE IF NOT EXISTS pollo_da_ads_daily (
  period TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  channel TEXT NOT NULL,
  country TEXT NOT NULL,
  platform TEXT NOT NULL,
  cost_usd REAL NOT NULL,
  impressions REAL NOT NULL,
  clicks REAL NOT NULL,
  register_user_cnt REAL NOT NULL,
  gmv_d0 REAL NOT NULL,
  gmv_d14 REAL,
  gmv_d30 REAL,
  gmv_d60 REAL,
  gmv_d90 REAL,
  gmv_d180 REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (period, channel, country, platform)
);

CREATE INDEX IF NOT EXISTS pollo_da_ads_daily_week
  ON pollo_da_ads_daily(week_start, platform, channel, country);
