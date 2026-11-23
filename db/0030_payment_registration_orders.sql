-- Preserve absent historical counts as NULL until verified against canonical orders.
ALTER TABLE pollo_da_payment_registration ADD COLUMN order_count REAL;
ALTER TABLE pollo_da_payment_registration_stage ADD COLUMN order_count REAL;
