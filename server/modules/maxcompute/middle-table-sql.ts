// ADS migration: keep attribution modes separate; never sum modes together.
export function buildMiddleTableSql(dataset: 'pay_type', platform: string, startKey: string, endKey: string): string {
  const scope = platform === 'web' ? "UPPER(pay_platform) = 'WEB'" : platform === 'app' ? "UPPER(pay_platform) IN ('IOS', 'ANDROID')" : '1=1';
  const week = "CAST(DATEADD(CAST(stat_date AS DATETIME), -CAST(PMOD(WEEKDAY(CAST(stat_date AS DATETIME)) + 2, 7) AS BIGINT), 'dd') AS DATE)";
  return `
SET odps.sql.type.system.odps2=true;
WITH sku_rows AS (
SELECT stat_date AS period, ${week} AS week_start, DATE_ADD(${week}, 6) AS week_end,
 LOWER(pay_platform) AS device_type, attribution_type, attribution_name,
 actual_supplier, actual_provider, pay_category, pay_sub_category AS pay_type,
 product_type, product_type_lv2,
 CASE WHEN attribution_type = 'CREATION_MODE' THEN attribution_name END AS function_name,
 CAST(NULL AS STRING) AS user_tag, CAST(NULL AS STRING) AS subscription_tier,
 CAST(NULL AS BIGINT) AS pay_user_cnt,
 allocated_gmv_usd AS gmv_usd, order_equivalent,
 -- Cost is populated only on MODEL / ACTUAL_MODEL double-summary rows.
 -- Keep those rows for cost analysis; revenue queries must exclude summaries.
 CASE WHEN attribution_type IN ('MODEL','ACTUAL_MODEL')
   AND pay_category = '汇总' AND pay_sub_category = '汇总'
   THEN model_cost_usd ELSE CAST(0 AS DECIMAL(38,18)) END AS model_cost_usd
FROM mc_prd.ads_pollo_transaction_gmv_attribution_daily_dip
WHERE p_date BETWEEN '${startKey}' AND '${endKey}'
 AND stat_date BETWEEN CAST(TO_DATE('${startKey}', 'yyyymmdd') AS DATE) AND CAST(TO_DATE('${endKey}', 'yyyymmdd') AS DATE)
 AND attribution_type IN ('NONE','CREATION_MODE','MODEL','ACTUAL_MODEL')
 AND UPPER(pay_platform) IN ('WEB','IOS','ANDROID','UNKNOWN') AND (${scope})
 AND (
   (pay_category IN ('ACTIVE_PAYMENT','AUTO_RENEWAL','API') AND pay_sub_category <> '汇总')
   OR (attribution_type IN ('MODEL','ACTUAL_MODEL') AND pay_category = '汇总'
       AND pay_sub_category = '汇总' AND COALESCE(model_cost_usd,0) <> 0)
 )
)
-- Preserve product and SKU in the dashboard identity.
SELECT period, week_start, week_end, device_type, attribution_type, attribution_name,
 actual_supplier, actual_provider, pay_category, pay_type, product_type, product_type_lv2, function_name,
 user_tag, subscription_tier, pay_user_cnt, SUM(gmv_usd) AS gmv_usd,
 SUM(order_equivalent) AS order_equivalent, SUM(model_cost_usd) AS model_cost_usd,
 COUNT(*) OVER() AS source_row_count
FROM sku_rows
GROUP BY period, week_start, week_end, device_type, attribution_type, attribution_name,
 actual_supplier, actual_provider, pay_category, pay_type, product_type, product_type_lv2, function_name,
 user_tag, subscription_tier, pay_user_cnt
`.trim();
}
