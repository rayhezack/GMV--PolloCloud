-- Payment-result dimensions, kept separate from funnel attribution and model allocations.
CREATE TABLE IF NOT EXISTS pollo_da_payment_registration (
  period TEXT NOT NULL,
  week_start TEXT NOT NULL,
  platform TEXT NOT NULL,
  device_type TEXT NOT NULL,
  pay_type TEXT NOT NULL,
  user_lifecycle TEXT NOT NULL,
  reg_country TEXT NOT NULL,
  gmv_usd REAL NOT NULL,
  PRIMARY KEY (period, platform, device_type, pay_type, user_lifecycle, reg_country)
);
CREATE INDEX IF NOT EXISTS payment_registration_scope ON pollo_da_payment_registration (platform, period);
