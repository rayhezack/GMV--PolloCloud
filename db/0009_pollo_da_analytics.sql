-- Pollo DA analytics storage. Base remains the task notification source.
CREATE TABLE IF NOT EXISTS pollo_da_base_records (
  source_table TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  migrated_at INTEGER NOT NULL,
  PRIMARY KEY (source_table, source_record_id)
);

CREATE INDEX IF NOT EXISTS pollo_da_base_records_table
  ON pollo_da_base_records(source_table);

CREATE TABLE IF NOT EXISTS pollo_da_fact_rows (
  dataset TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  period TEXT NOT NULL,
  week_start TEXT,
  week_end TEXT,
  platform TEXT,
  device_type TEXT,
  platform_type TEXT,
  dataset_kind TEXT,
  analysis_level TEXT,
  pay_type TEXT,
  function_name TEXT,
  user_tag TEXT,
  creation_cnt_30d_level_id REAL,
  creation_cnt_30d TEXT,
  plan_tier TEXT,
  plan_cycle TEXT,
  active_uv REAL,
  creation_uv REAL,
  creation_task_cnt REAL,
  creation_penetration_rate REAL,
  avg_creation_task_cnt_per_creator REAL,
  sub_expose_uv REAL,
  sub_submit_uv REAL,
  chain_pay_uv REAL,
  chain_gmv_usd REAL,
  sub_expose_rate REAL,
  sub_submit_rate REAL,
  chain_pay_success_rate REAL,
  chain_arppu REAL,
  expire_user_cnt REAL,
  renew_user_cnt REAL,
  renew_amount_usd REAL,
  pay_user_cnt REAL,
  order_cnt REAL,
  gmv_usd REAL,
  fields_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (dataset, source_record_id)
);

CREATE INDEX IF NOT EXISTS pollo_da_fact_rows_period
  ON pollo_da_fact_rows(dataset, period, platform, device_type);

CREATE INDEX IF NOT EXISTS pollo_da_fact_rows_week
  ON pollo_da_fact_rows(dataset, week_start, platform, device_type);

CREATE TABLE IF NOT EXISTS pollo_da_reports (
  report_kind TEXT NOT NULL,
  report_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  model_used TEXT,
  degraded TEXT,
  generated_at TEXT NOT NULL,
  report_md TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (report_kind, report_key)
);

CREATE INDEX IF NOT EXISTS pollo_da_reports_history
  ON pollo_da_reports(report_kind, platform, generated_at DESC);

CREATE TABLE IF NOT EXISTS pollo_da_product_actions (
  source_record_id TEXT PRIMARY KEY,
  stat_date TEXT,
  weekday TEXT,
  release_time TEXT,
  action_type TEXT,
  update_point TEXT,
  description TEXT,
  board TEXT,
  version TEXT,
  commit_id TEXT,
  source TEXT,
  remark TEXT,
  platform TEXT,
  fields_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS pollo_da_product_actions_stat_date
  ON pollo_da_product_actions(stat_date);
