CREATE TABLE IF NOT EXISTS pollo_da_creation_overall_daily (
  period TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  platform_type TEXT NOT NULL,
  creation_task_cnt INTEGER NOT NULL,
  creation_user_cnt INTEGER NOT NULL,
  success_task_cnt INTEGER NOT NULL,
  success_output_cnt INTEGER NOT NULL,
  adopted_task_cnt INTEGER NOT NULL,
  adopted_output_cnt INTEGER NOT NULL,
  d3_creation_user_cnt INTEGER,
  d7_creation_user_cnt INTEGER,
  d30_creation_user_cnt INTEGER,
  gmv_usd REAL NOT NULL,
  etl_time TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (period, platform_type)
);

CREATE INDEX IF NOT EXISTS pollo_da_creation_overall_week
  ON pollo_da_creation_overall_daily(week_start, platform_type);

CREATE TABLE IF NOT EXISTS pollo_da_creation_function_daily (
  period TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  platform_type TEXT NOT NULL,
  creation_mode TEXT NOT NULL,
  user_type TEXT NOT NULL,
  pay_gmv_usd_30d TEXT NOT NULL,
  creation_task_cnt INTEGER NOT NULL,
  creation_user_cnt INTEGER NOT NULL,
  success_task_cnt INTEGER NOT NULL,
  success_output_cnt INTEGER NOT NULL,
  adopted_task_cnt INTEGER NOT NULL,
  adopted_output_cnt INTEGER NOT NULL,
  d3_creation_user_cnt INTEGER,
  d7_creation_user_cnt INTEGER,
  d30_creation_user_cnt INTEGER,
  gmv_usd REAL NOT NULL,
  etl_time TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (period, platform_type, creation_mode, user_type, pay_gmv_usd_30d)
);

CREATE INDEX IF NOT EXISTS pollo_da_creation_function_week
  ON pollo_da_creation_function_daily(week_start, platform_type, creation_mode);

CREATE TABLE IF NOT EXISTS pollo_da_creation_overall_stage AS
  SELECT * FROM pollo_da_creation_overall_daily WHERE 0;

CREATE TABLE IF NOT EXISTS pollo_da_creation_function_stage AS
  SELECT * FROM pollo_da_creation_function_daily WHERE 0;
