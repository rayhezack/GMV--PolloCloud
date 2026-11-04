-- Apply once after checking PRAGMA table_info(pollo_da_fact_rows).
ALTER TABLE pollo_da_fact_rows ADD COLUMN attribution_type TEXT;
ALTER TABLE pollo_da_fact_rows ADD COLUMN attribution_name TEXT;
ALTER TABLE pollo_da_fact_rows ADD COLUMN actual_supplier TEXT;
ALTER TABLE pollo_da_fact_rows ADD COLUMN actual_provider TEXT;
ALTER TABLE pollo_da_fact_rows ADD COLUMN pay_category TEXT;
ALTER TABLE pollo_da_fact_rows ADD COLUMN order_equivalent REAL;
ALTER TABLE pollo_da_fact_rows ADD COLUMN model_cost_usd REAL;
ALTER TABLE pollo_da_fact_rows ADD COLUMN metric_version TEXT;
CREATE INDEX IF NOT EXISTS pollo_da_fact_attribution ON pollo_da_fact_rows(dataset, attribution_type, period, platform);
