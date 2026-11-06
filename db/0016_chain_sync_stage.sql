-- Enriched tables already exist in deployed databases. Keep both snapshots
-- until the bounded replacement has staged successfully.
CREATE TABLE IF NOT EXISTS pollo_da_chain_funnel_stage AS SELECT * FROM pollo_da_chain_funnel WHERE 0;
CREATE TABLE IF NOT EXISTS pollo_da_chain_breakdown_stage AS SELECT * FROM pollo_da_chain_breakdown WHERE 0;
