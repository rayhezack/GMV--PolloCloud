-- Apply once to an existing registration table; preserve all money as unknown until the verified full backfill.
CREATE TABLE pollo_da_payment_registration_v2 (
  period TEXT NOT NULL,
  week_start TEXT NOT NULL,
  platform TEXT NOT NULL,
  device_type TEXT NOT NULL,
  pay_type TEXT NOT NULL,
  user_lifecycle TEXT NOT NULL,
  reg_country TEXT NOT NULL,
  reg_platform TEXT NOT NULL DEFAULT 'UNKNOWN',
  sku TEXT NOT NULL DEFAULT 'UNKNOWN',
  plan_tier TEXT NOT NULL DEFAULT 'UNKNOWN',
  plan_cycle TEXT NOT NULL DEFAULT 'UNKNOWN',
  credit_amount TEXT NOT NULL DEFAULT 'UNKNOWN',
  previous_sku TEXT NOT NULL DEFAULT 'UNKNOWN',
  previous_plan_tier TEXT NOT NULL DEFAULT 'UNKNOWN',
  previous_plan_cycle TEXT NOT NULL DEFAULT 'UNKNOWN',
  previous_credit_amount TEXT NOT NULL DEFAULT 'UNKNOWN',
  gmv_usd REAL NOT NULL,
  PRIMARY KEY (period, platform, device_type, pay_type, user_lifecycle, reg_country, reg_platform, sku, plan_tier, plan_cycle, credit_amount, previous_sku, previous_plan_tier, previous_plan_cycle, previous_credit_amount)
);
INSERT INTO pollo_da_payment_registration_v2 (period,week_start,platform,device_type,pay_type,user_lifecycle,reg_country,reg_platform,gmv_usd)
SELECT period,week_start,platform,device_type,pay_type,user_lifecycle,reg_country,'UNKNOWN',gmv_usd FROM pollo_da_payment_registration;
DROP TABLE pollo_da_payment_registration;
ALTER TABLE pollo_da_payment_registration_v2 RENAME TO pollo_da_payment_registration;
CREATE INDEX payment_registration_scope ON pollo_da_payment_registration (platform,period);
DROP TABLE IF EXISTS pollo_da_payment_registration_stage;
CREATE TABLE pollo_da_payment_registration_stage AS SELECT * FROM pollo_da_payment_registration WHERE 0;
