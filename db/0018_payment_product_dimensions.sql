-- Run after checking both tables with PRAGMA table_info; apply each ALTER once.
-- The production payment fact stage may not exist yet; create it after the fact-table ALTERs.
ALTER TABLE pollo_da_fact_rows ADD COLUMN product_type TEXT;
ALTER TABLE pollo_da_fact_rows ADD COLUMN product_type_lv2 TEXT;
CREATE TABLE IF NOT EXISTS pollo_da_payment_fact_stage AS SELECT * FROM pollo_da_fact_rows WHERE 0;
-- If the stage existed before this migration, add the same two columns to it.
