-- Parent payment results and registration children switch in one transaction.
CREATE TABLE IF NOT EXISTS pollo_da_payment_fact_stage AS SELECT * FROM pollo_da_fact_rows WHERE 0;
CREATE TABLE IF NOT EXISTS pollo_da_payment_registration_stage AS SELECT * FROM pollo_da_payment_registration WHERE 0;
