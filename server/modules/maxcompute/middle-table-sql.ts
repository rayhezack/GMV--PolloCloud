// ADS migration: keep attribution modes separate; never sum modes together.
export function buildMiddleTableSql(dataset: 'pay_type' | 'chain', platform: string, startKey: string, endKey: string): string {
  const scope = platform === 'web' ? "UPPER(pay_platform) = 'WEB'" : platform === 'app' ? "UPPER(pay_platform) IN ('IOS', 'ANDROID')" : '1=1';
  const week = "CAST(DATEADD(CAST(stat_date AS DATETIME), -CAST(PMOD(WEEKDAY(CAST(stat_date AS DATETIME)) + 2, 7) AS BIGINT), 'dd') AS DATE)";
  if (dataset === 'pay_type') return `
SET odps.sql.type.system.odps2=true;
SELECT stat_date AS period, ${week} AS week_start, DATE_ADD(${week}, 6) AS week_end,
 LOWER(pay_platform) AS device_type, attribution_type, attribution_name,
 actual_supplier, actual_provider, pay_category, pay_sub_category AS pay_type,
 CASE WHEN attribution_type = 'CREATION_MODE' THEN attribution_name END AS function_name,
 CAST(NULL AS STRING) AS user_tag, CAST(NULL AS STRING) AS subscription_tier,
 CAST(NULL AS BIGINT) AS pay_user_cnt,
 allocated_gmv_usd AS gmv_usd, order_equivalent,
 -- Cost is populated only on MODEL / ACTUAL_MODEL double-summary rows.
 -- Keep those rows for cost analysis; revenue queries must exclude summaries.
 CASE WHEN attribution_type IN ('MODEL','ACTUAL_MODEL')
   AND pay_category = '汇总' AND pay_sub_category = '汇总'
   THEN model_cost_usd ELSE CAST(0 AS DECIMAL(38,18)) END AS model_cost_usd,
 'ads_v1' AS metric_version, COUNT(*) OVER() AS source_row_count
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
`.trim();
  const chainScope = platform === 'web' ? "platform_group = 'WEB'" : platform === 'app' ? "platform_group = 'APP'" : '1=1';
  const device = platform === 'all' ? "'all'" : 'LOWER(platform_type)';
  return `
SET odps.sql.type.system.odps2=true;
WITH daily AS (
 SELECT stat_date AS period, week_start, week_end, ${device} AS device_type,
 creation_cnt_30d_label AS creation_cnt_30d,
 COUNT(DISTINCT user_id) AS active_uv,
 COUNT(DISTINCT CASE WHEN is_paywall_expose=1 THEN user_id END) AS sub_expose_uv,
 COUNT(DISTINCT CASE WHEN is_paywall_submit=1 THEN user_id END) AS sub_submit_uv,
 COUNT(DISTINCT CASE WHEN is_pay=1 THEN user_id END) AS chain_pay_uv,
 SUM(gmv_usd) AS chain_gmv_usd
 FROM mc_prd.ads_pollo_transaction_paywall_user_daily_dip
 WHERE p_date BETWEEN '${startKey}' AND '${endKey}'
 AND stat_date BETWEEN CAST(TO_DATE('${startKey}', 'yyyymmdd') AS DATE) AND CAST(TO_DATE('${endKey}', 'yyyymmdd') AS DATE)
 AND is_active=1 AND (${chainScope})
 GROUP BY stat_date, week_start, week_end, ${device}, creation_cnt_30d_label
)
SELECT *, CAST(NULL AS STRING) AS user_tag,
 CASE creation_cnt_30d WHEN 'create_cnt_30d_0' THEN 0 WHEN 'create_cnt_30d_[1,11)' THEN 1
 WHEN 'create_cnt_30d_[11,31)' THEN 2 WHEN 'create_cnt_30d_[31,101)' THEN 3 ELSE 4 END AS creation_cnt_30d_level_id,
 sub_expose_uv * 1.0 / NULLIF(active_uv,0) AS sub_expose_rate,
 sub_submit_uv * 1.0 / NULLIF(sub_expose_uv,0) AS sub_submit_rate,
 chain_pay_uv * 1.0 / NULLIF(sub_submit_uv,0) AS chain_pay_success_rate,
 chain_gmv_usd / NULLIF(chain_pay_uv,0) AS chain_arppu, 'ads_v1' AS metric_version, COUNT(*) OVER() AS source_row_count
FROM daily
`.trim();
}
