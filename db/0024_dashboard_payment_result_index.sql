-- Headline reads must not scan model/function attribution rows (millions of rows).
-- Keep legacy results and canonical NONE results in the same small index.
CREATE INDEX IF NOT EXISTS pollo_da_payment_result_period
ON pollo_da_fact_rows(dataset, period, platform, device_type)
WHERE attribution_type IS NULL OR
  (attribution_type = 'NONE' AND pay_category IN ('ACTIVE_PAYMENT','AUTO_RENEWAL','API') AND pay_type <> '汇总');
