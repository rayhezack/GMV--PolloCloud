-- Payment-result dimensions, kept separate from funnel attribution and model allocations.
CREATE TABLE IF NOT EXISTS pollo_da_payment_registration (
  period TEXT NOT NULL,
  week_start TEXT NOT NULL,
  platform TEXT NOT NULL,
  device_type TEXT NOT NULL,
  pay_type TEXT NOT NULL,
  user_lifecycle TEXT NOT NULL,
  country_tier TEXT NOT NULL,
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
  PRIMARY KEY (period, platform, device_type, pay_type, user_lifecycle, country_tier, reg_platform, sku, plan_tier, plan_cycle, credit_amount, previous_sku, previous_plan_tier, previous_plan_cycle, previous_credit_amount)
);
CREATE INDEX IF NOT EXISTS payment_registration_scope ON pollo_da_payment_registration (platform, period);
