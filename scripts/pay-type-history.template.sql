SET odps.sql.type.system.odps2=true;
SELECT stat_date AS period,
 CAST(DATEADD(CAST(stat_date AS DATETIME), -CAST(PMOD(WEEKDAY(CAST(stat_date AS DATETIME)) + 2, 7) AS BIGINT), 'dd') AS DATE) AS week_start,
 DATE_ADD(CAST(DATEADD(CAST(stat_date AS DATETIME), -CAST(PMOD(WEEKDAY(CAST(stat_date AS DATETIME)) + 2, 7) AS BIGINT), 'dd') AS DATE), 6) AS week_end,
 LOWER(pay_platform) AS device_type, attribution_type, attribution_name,
 actual_supplier, actual_provider, pay_category, pay_sub_category AS pay_type,
 CASE WHEN attribution_type = 'CREATION_MODE' THEN attribution_name END AS function_name,
 CAST(NULL AS STRING) AS user_tag, CAST(NULL AS STRING) AS subscription_tier,
 CAST(NULL AS BIGINT) AS pay_user_cnt,
 allocated_gmv_usd AS gmv_usd, order_equivalent,
 CASE WHEN attribution_type IN ('MODEL','ACTUAL_MODEL')
   AND pay_category = '汇总' AND pay_sub_category = '汇总'
   THEN model_cost_usd ELSE CAST(0 AS DECIMAL(38,18)) END AS model_cost_usd,
 'ads_v1' AS metric_version
FROM mc_prd.ads_pollo_transaction_gmv_attribution_daily_dip
WHERE p_date BETWEEN 'STARTKEY' AND 'ENDKEY'
 AND stat_date BETWEEN CAST(TO_DATE('STARTKEY', 'yyyymmdd') AS DATE) AND CAST(TO_DATE('ENDKEY', 'yyyymmdd') AS DATE)
 AND attribution_type IN ('NONE','CREATION_MODE','MODEL','ACTUAL_MODEL')
 AND UPPER(pay_platform) IN ('WEB','IOS','ANDROID','UNKNOWN')
 AND (
   (pay_category IN ('ACTIVE_PAYMENT','AUTO_RENEWAL','API') AND pay_sub_category <> '汇总')
   OR (attribution_type IN ('MODEL','ACTUAL_MODEL') AND pay_category = '汇总'
       AND pay_sub_category = '汇总' AND COALESCE(model_cost_usd,0) <> 0)
 )
