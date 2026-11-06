/** One canonical enriched chain source for every reader and sync job. */
export function buildChainFunnelSql(platform: string, startDate: string, endDate: string) {
  if (![startDate,endDate].every(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date))) || startDate > endDate) throw new Error('链路日期范围无效');
  const startKey=startDate.replaceAll('-',''), endKey=endDate.replaceAll('-','');
  const scope=platform==='web'?"platform_group='WEB'":platform==='app'?"platform_group='APP'":'1=1';
  return `SET odps.sql.type.system.odps2=true;

WITH user_day AS (
  SELECT stat_date,week_start,week_end,LOWER(platform_group) AS platform,LOWER(platform_type) AS device_type,
    country_tier,creation_cnt_30d_label,register_date,user_id,
    MAX(is_paywall_expose) AS is_paywall_expose,MAX(is_paywall_submit) AS is_paywall_submit,MAX(is_pay) AS is_pay,
    CASE WHEN COUNT(DISTINCT CASE WHEN is_paywall_expose=1 THEN paywall_expose_type END)>1 THEN '__MULTI__' ELSE MAX(CASE WHEN is_paywall_expose=1 THEN paywall_expose_type END) END AS paywall_expose_type,
    CASE WHEN COUNT(DISTINCT CASE WHEN is_paywall_expose=1 THEN paywall_expose_reason END)>1 THEN '__MULTI__' ELSE MAX(CASE WHEN is_paywall_expose=1 THEN paywall_expose_reason END) END AS paywall_expose_reason,
    CASE WHEN COUNT(DISTINCT CASE WHEN is_paywall_submit=1 THEN submit_channel END)>1 THEN '__MULTI__' ELSE MAX(CASE WHEN is_paywall_submit=1 THEN submit_channel END) END AS submit_channel,
    CASE WHEN COUNT(DISTINCT CASE WHEN is_pay=1 THEN payment_channel END)>1 THEN '__MULTI__' ELSE MAX(CASE WHEN is_pay=1 THEN payment_channel END) END AS payment_channel,
    SUM(CASE WHEN is_pay=1 THEN gmv_usd ELSE 0 END) AS gmv_usd,
    SUM(pay_fail_order_cnt) AS pay_fail_order_cnt,SUM(pay_fail_amount_usd) AS pay_fail_amount_usd
  FROM mc_prd.ads_pollo_transaction_paywall_user_daily_dip
  WHERE p_date BETWEEN '${startKey}' AND '${endKey}'
    AND stat_date BETWEEN CAST(TO_DATE('${startKey}','yyyymmdd') AS DATE) AND CAST(TO_DATE('${endKey}','yyyymmdd') AS DATE)
    AND is_active=1 AND platform_group IN ('WEB','APP') AND (${scope})
  GROUP BY stat_date,week_start,week_end,platform_group,platform_type,country_tier,creation_cnt_30d_label,register_date,user_id
), enriched AS (
  SELECT *,CASE WHEN register_date BETWEEN week_start AND week_end THEN 'NEW' WHEN register_date<week_start THEN 'OLD' ELSE NULL END AS user_lifecycle
  FROM user_day
), funnel AS (
SELECT stat_date AS period,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,
  COUNT(*) AS active_uv,SUM(is_paywall_expose) AS paywall_expose_uv,SUM(is_paywall_submit) AS paywall_submit_uv,SUM(is_pay) AS pay_uv,
  SUM(gmv_usd) AS gmv_usd,SUM(pay_fail_order_cnt) AS pay_fail_order_cnt,SUM(pay_fail_amount_usd) AS pay_fail_amount_usd
FROM enriched
GROUP BY stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label
), breakdown AS (
SELECT stat_date AS period,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,
  'EXPOSE_TYPE' AS breakdown_type,paywall_expose_type AS breakdown_value,
  SUM(is_paywall_expose) AS expose_uv,SUM(is_paywall_submit) AS submit_uv,SUM(is_pay) AS pay_uv,SUM(gmv_usd) AS gmv_usd
FROM enriched WHERE is_paywall_expose=1 OR is_pay=1
GROUP BY stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,paywall_expose_type
UNION ALL
SELECT stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,
  'EXPOSE_REASON',paywall_expose_reason,SUM(is_paywall_expose),SUM(is_paywall_submit),SUM(is_pay),SUM(gmv_usd)
FROM enriched WHERE is_paywall_expose=1 OR is_pay=1
GROUP BY stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,paywall_expose_reason
UNION ALL
SELECT stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,
  'SUBMIT_CHANNEL',submit_channel,SUM(is_paywall_expose),SUM(is_paywall_submit),SUM(is_pay),SUM(gmv_usd)
FROM enriched WHERE is_paywall_submit=1 OR is_pay=1
GROUP BY stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,submit_channel
UNION ALL
SELECT stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,
  'PAYMENT_CHANNEL',payment_channel,SUM(is_paywall_expose),SUM(is_paywall_submit),SUM(is_pay),SUM(gmv_usd)
FROM enriched WHERE is_pay=1
GROUP BY stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,payment_channel
), result AS (SELECT period,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,'funnel' AS source_kind,CAST(NULL AS STRING) AS breakdown_type,CAST(NULL AS STRING) AS breakdown_value,active_uv,paywall_expose_uv,paywall_submit_uv,pay_uv,gmv_usd,pay_fail_order_cnt,pay_fail_amount_usd,CAST(NULL AS DOUBLE) AS expose_uv,CAST(NULL AS DOUBLE) AS submit_uv FROM funnel UNION ALL SELECT period,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,'breakdown' AS source_kind,breakdown_type,breakdown_value,CAST(NULL AS DOUBLE) AS active_uv,CAST(NULL AS DOUBLE) AS paywall_expose_uv,CAST(NULL AS DOUBLE) AS paywall_submit_uv,pay_uv,gmv_usd,CAST(NULL AS DOUBLE) AS pay_fail_order_cnt,CAST(NULL AS DOUBLE) AS pay_fail_amount_usd,expose_uv,submit_uv FROM breakdown)
SELECT *,COUNT(*) OVER() AS source_row_count FROM result`.trim();
}
