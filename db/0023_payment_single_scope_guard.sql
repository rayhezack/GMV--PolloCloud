-- Payment scopes are projected by pollo_da_fact_rows_read; never persist mirror rows.
CREATE TRIGGER IF NOT EXISTS pollo_da_payment_single_scope_insert
BEFORE INSERT ON pollo_da_fact_rows
WHEN NEW.dataset='pay_type' AND (NEW.platform IS NULL OR NEW.platform<>'all')
BEGIN SELECT RAISE(ABORT,'Payment facts require canonical all scope; use the read view for Web/App'); END;
CREATE TRIGGER IF NOT EXISTS pollo_da_payment_single_scope_update
BEFORE UPDATE OF dataset,platform ON pollo_da_fact_rows
WHEN NEW.dataset='pay_type' AND (NEW.platform IS NULL OR NEW.platform<>'all')
BEGIN SELECT RAISE(ABORT,'Payment facts require canonical all scope; use the read view for Web/App'); END;
