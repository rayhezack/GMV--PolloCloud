/** Generate fresh, source-only warehouse controls. Does not read any local dashboard data. */
import { mkdirSync, writeFileSync } from 'node:fs';
const dir = 'design-review/warehouse-conservation-2026-11-22';
mkdirSync(dir, { recursive: true });
const range =
  "p_date BETWEEN '20261108' AND '20261121' AND stat_date BETWEEN CAST('2026-11-08' AS DATE) AND CAST('2026-11-21' AS DATE)";
const write = (name, sql) => writeFileSync(`${dir}/${name}.sql`, sql.trim() + '\n');
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
const measures = ['active_uv', 'expose_uv', 'submit_uv', 'pay_uv', 'gmv_usd'];
const scopes = [
  ['all', '1=1'],
  ['web', "platform='web'"],
  ['app', "platform='app'"],
  ['ios', "platform='app' AND device_type='ios'"],
  ['android', "platform='app' AND device_type='android'"],
];
const scopeRows = scopes
  .map(([scope, filter]) => `SELECT *,${quote(scope)} AS scope FROM raw WHERE ${filter}`)
  .join('\nUNION ALL\n');
const parentMeasures = `COUNT(DISTINCT CONCAT(device_type,':',CAST(user_id AS STRING))) AS active_uv,
 COUNT(DISTINCT CASE WHEN is_paywall_expose=1 THEN CONCAT(device_type,':',CAST(user_id AS STRING)) END) AS expose_uv,
 COUNT(DISTINCT CASE WHEN is_paywall_submit=1 THEN CONCAT(device_type,':',CAST(user_id AS STRING)) END) AS submit_uv,
 COUNT(DISTINCT CASE WHEN is_pay=1 THEN CONCAT(device_type,':',CAST(user_id AS STRING)) END) AS pay_uv,
 SUM(CASE WHEN is_pay=1 THEN gmv_usd ELSE 0 END) AS gmv_usd`;
const sums = `COUNT(*) AS active_uv,SUM(is_paywall_expose) AS expose_uv,SUM(is_paywall_submit) AS submit_uv,SUM(is_pay) AS pay_uv,SUM(gmv_usd) AS gmv_usd`;
const chainDims = [
  ['country', 'country_tier'],
  ['lifecycle', 'user_lifecycle'],
  ['creation', 'creation_cnt_30d_label'],
  ['device', 'device_type'],
  ['country_lifecycle', 'country_tier', 'user_lifecycle'],
  ['creation_lifecycle', 'creation_cnt_30d_label', 'user_lifecycle'],
  ['full', 'country_tier', 'user_lifecycle', 'creation_cnt_30d_label'],
  ['submit_channel', 'submit_channel'],
  ['submit_channel_lifecycle', 'submit_channel', 'user_lifecycle'],
  ['expose_type', 'paywall_expose_type'],
  ['expose_reason', 'paywall_expose_reason'],
  ['payment_channel', 'payment_channel'],
];
const children = chainDims
  .map(
    ([name, d1, d2, d3]) => `SELECT period,scope,'${name}' AS dimension,
 COALESCE(CAST(${d1} AS STRING),'UNKNOWN') AS key1,${d2 ? `COALESCE(CAST(${d2} AS STRING),'UNKNOWN')` : "'ALL'"} AS key2,${d3 ? `COALESCE(CAST(${d3} AS STRING),'UNKNOWN')` : "'ALL'"} AS key3,
 ${sums} FROM enriched ${name.startsWith('submit_channel') ? 'WHERE is_paywall_submit=1 OR is_pay=1' : name.startsWith('expose_') ? 'WHERE is_paywall_expose=1 OR is_pay=1' : name === 'payment_channel' ? 'WHERE is_pay=1' : ''}
 GROUP BY period,scope,${[d1, d2, d3].filter(Boolean).join(',')}`,
  )
  .join('\nUNION ALL\n');
write(
  'chain',
  `WITH raw AS (
 SELECT CAST(stat_date AS STRING) AS period,week_start,week_end,LOWER(platform_group) AS platform,LOWER(platform_type) AS device_type,
 country_tier,creation_cnt_30d_label,register_date,user_id,is_paywall_expose,is_paywall_submit,is_pay,gmv_usd,
 paywall_expose_type,paywall_expose_reason,submit_channel,payment_channel
 FROM mc_prd.ads_pollo_transaction_paywall_user_daily_dip WHERE ${range} AND is_active=1 AND platform_group IN ('WEB','APP')
), scoped AS (${scopeRows}), user_day AS (
 SELECT period,scope,week_start,week_end,device_type,country_tier,creation_cnt_30d_label,register_date,user_id,
 MAX(is_paywall_expose) is_paywall_expose,MAX(is_paywall_submit) is_paywall_submit,MAX(is_pay) is_pay,
 SUM(CASE WHEN is_pay=1 THEN gmv_usd ELSE 0 END) gmv_usd,
 CASE WHEN COUNT(DISTINCT CASE WHEN is_paywall_expose=1 THEN paywall_expose_type END)>1 THEN '__MULTI__' ELSE MAX(CASE WHEN is_paywall_expose=1 THEN paywall_expose_type END) END AS paywall_expose_type,
 CASE WHEN COUNT(DISTINCT CASE WHEN is_paywall_expose=1 THEN paywall_expose_reason END)>1 THEN '__MULTI__' ELSE MAX(CASE WHEN is_paywall_expose=1 THEN paywall_expose_reason END) END AS paywall_expose_reason,
 CASE WHEN COUNT(DISTINCT CASE WHEN is_paywall_submit=1 THEN submit_channel END)>1 THEN '__MULTI__' ELSE MAX(CASE WHEN is_paywall_submit=1 THEN submit_channel END) END AS submit_channel,
 CASE WHEN COUNT(DISTINCT CASE WHEN is_pay=1 THEN payment_channel END)>1 THEN '__MULTI__' ELSE MAX(CASE WHEN is_pay=1 THEN payment_channel END) END AS payment_channel
 FROM scoped GROUP BY period,scope,week_start,week_end,device_type,country_tier,creation_cnt_30d_label,register_date,user_id
), enriched AS (
 SELECT *,CASE WHEN register_date BETWEEN week_start AND week_end THEN 'NEW' WHEN register_date<week_start THEN 'OLD' ELSE 'UNKNOWN' END AS user_lifecycle FROM user_day
), result AS (
 SELECT period,scope,'parent' AS dimension,'ALL' AS key1,'ALL' AS key2,'ALL' AS key3,${parentMeasures} FROM scoped GROUP BY period,scope
 UNION ALL ${children}
) SELECT *,COUNT(*) OVER() AS source_row_count FROM result`,
);

// Payment result control comes directly from valid paid orders, before dimension joins.
const week =
  "CAST(DATEADD(CAST(pay_date AS DATETIME),-CAST(PMOD(WEEKDAY(CAST(pay_date AS DATETIME))+2,7) AS BIGINT),'dd') AS DATE)";
const paymentDims = [
  'pay_type',
  'user_lifecycle',
  'country_tier',
  'reg_platform',
  'sku',
  'plan_tier',
  'plan_cycle',
  'credit_amount',
];
write(
  'payment-orders',
  `WITH raw AS (
 SELECT CAST(pay_date AS STRING) AS period,${week} AS week_start,LOWER(COALESCE(pay_platform,'UNKNOWN')) AS device_type,
 user_id,reg_country,reg_platform,sku_combo_da AS sku,plan_tier_da AS plan_tier,sub_period_da AS plan_cycle,CAST(usage_count AS STRING) AS credit_amount,
 CASE pay_type WHEN 'NEW_SUB' THEN '首订' WHEN 'RENEW' THEN '自动续订' WHEN 'RESUBSCRIBE' THEN '重新订阅' WHEN 'UPGRADE' THEN '套餐升级' WHEN 'CYCLE_RESET' THEN '重置订阅周期' WHEN 'DOWNGRADE' THEN '套餐降级' WHEN 'ADDON' THEN '积分包' WHEN 'API' THEN 'API' ELSE '其他' END AS pay_type,
 amount_received_usd AS gmv_usd
 FROM mc_prd.dwd_pollo_transaction_order_dip WHERE p_date BETWEEN '20261108' AND '20261121'
 AND pay_date BETWEEN CAST('2026-11-08' AS DATE) AND CAST('2026-11-21' AS DATE) AND is_valid_order=1 AND is_paid_amount=1 AND pay_type<>'TRIAL'
), accounts AS (SELECT user_id,MIN(register_date) register_date FROM mc_prd.dim_pollo_user_account_dfp WHERE p_date=MAX_PT('mc_prd.dim_pollo_user_account_dfp') GROUP BY user_id),
 countries AS (SELECT country_code,MAX(country_tier) country_tier FROM mc_prd.dim_pollo_common_country_tier_nfn GROUP BY country_code),
 enriched AS (SELECT r.*,CASE WHEN a.register_date BETWEEN week_start AND DATE_ADD(week_start,6) THEN 'NEW' WHEN a.register_date<week_start THEN 'OLD' ELSE 'UNKNOWN' END AS user_lifecycle,COALESCE(c.country_tier,'T2') country_tier
 FROM raw r LEFT JOIN accounts a ON r.user_id=a.user_id LEFT JOIN countries c ON UPPER(TRIM(r.reg_country))=c.country_code),
 result AS (
 SELECT period,device_type,'parent' AS dimension,'ALL' AS parent_type,'ALL' AS key1,SUM(gmv_usd) gmv_usd,COUNT(*) order_count FROM raw GROUP BY period,device_type
 UNION ALL
 ${paymentDims.map((d) => `SELECT period,device_type,'${d}' AS dimension,${d === 'pay_type' ? "'ALL'" : 'pay_type'} AS parent_type,COALESCE(CAST(${d} AS STRING),'UNKNOWN') AS key1,SUM(gmv_usd) gmv_usd,COUNT(*) order_count FROM enriched GROUP BY period,device_type,${d === 'pay_type' ? 'pay_type' : `pay_type,${d}`}`).join('\nUNION ALL\n')}
) SELECT *,COUNT(*) OVER() AS source_row_count FROM result`,
);

const adsDims = [
  ['country', 'country'],
  ['channel', 'channel'],
  ['country_channel', 'country', 'channel'],
];
const adsFields = [
  'cost_usd',
  'impressions',
  'clicks',
  'register_user_cnt',
  'gmv_d0',
  'gmv_d14',
  'gmv_d30',
  'gmv_d60',
  'gmv_d90',
  'gmv_d180',
];
write(
  'ads',
  `WITH raw AS (
 SELECT CAST(stat_date AS STRING) period,UPPER(source_end) platform,UPPER(country) country,UPPER(ad_platform) channel,
 cost_usd,impressions,clicks,cohort_user_cnt register_user_cnt,gmv_usd_d0 gmv_d0,gmv_usd_d14 gmv_d14,gmv_usd_d30 gmv_d30,gmv_usd_d60 gmv_d60,gmv_usd_d90 gmv_d90,gmv_usd_d180 gmv_d180
 FROM mc_prd.ads_pollo_ad_attribution_daily_dip WHERE ${range} AND product_type='ALL' AND is_first_purchase='汇总'
), result AS (
 SELECT period,platform,'parent' dimension,'ALL' key1,'ALL' key2,${adsFields.map((f) => `SUM(${f}) ${f}`).join(',')} FROM raw GROUP BY period,platform
 UNION ALL
 ${adsDims.map(([name, d1, d2]) => `SELECT period,platform,'${name}' dimension,COALESCE(${d1},'UNKNOWN') key1,${d2 ? `COALESCE(${d2},'UNKNOWN')` : "'ALL'"} key2,${adsFields.map((f) => `SUM(${f}) ${f}`).join(',')} FROM raw GROUP BY period,platform,${[d1, d2].filter(Boolean).join(',')}`).join('\nUNION ALL\n')}
) SELECT *,COUNT(*) OVER() source_row_count FROM result`,
);

// Keep every native warehouse cube row. Parent summary rows are compared to separate detail rows.
const creativeFields = [
  'creation_task_cnt',
  'valid_creation_task_cnt',
  'creation_user_cnt',
  'success_task_cnt',
  'success_output_cnt',
  'adopted_task_cnt',
  'adopted_output_cnt',
  'd3_creation_user_cnt',
  'd7_creation_user_cnt',
  'd30_creation_user_cnt',
  'gmv_usd',
];
write(
  'creative',
  `SELECT CAST(stat_date AS STRING) period,platform_type,creation_mode,user_type,pay_gmv_usd_30d,
 ${creativeFields.map((f) => `SUM(${f}) ${f}`).join(',')},COUNT(*) OVER() source_row_count
 FROM mc_prd.ads_pollo_creation_function_chain_daily_dip WHERE ${range} AND platform_type IN ('WEB','IOS','ANDROID','UNKNOWN','汇总')
 GROUP BY stat_date,platform_type,creation_mode,user_type,pay_gmv_usd_30d`,
);
write(
  'renewal',
  `SELECT CAST(stat_date AS STRING) period,platform_type,plan_tier,plan_cycle,borderline_tag,
 SUM(expire_user_cnt) expire_user_cnt,SUM(renew_same_day_user_cnt) renew_user_cnt,SUM(renew_same_day_amount_usd) gmv_usd,COUNT(*) OVER() source_row_count
 FROM mc_prd.ads_pollo_renewal_cohort_dip WHERE ${range}
 GROUP BY stat_date,platform_type,plan_tier,plan_cycle,borderline_tag`,
);
write(
  'payment-attribution',
  `WITH raw AS (
 SELECT CAST(stat_date AS STRING) period,LOWER(pay_platform) device_type,attribution_type,attribution_name,actual_supplier,actual_provider,pay_category,pay_sub_category AS pay_type,product_type,product_type_lv2,allocated_gmv_usd gmv_usd,order_equivalent,model_cost_usd
 FROM mc_prd.ads_pollo_transaction_gmv_attribution_daily_dip WHERE ${range}
 AND attribution_type IN ('NONE','CREATION_MODE','MODEL','ACTUAL_MODEL') AND UPPER(pay_platform) IN ('WEB','IOS','ANDROID','UNKNOWN')
 AND pay_category IN ('ACTIVE_PAYMENT','AUTO_RENEWAL','API') AND pay_sub_category<>'汇总'
), result AS (
 SELECT period,device_type,attribution_type,'parent' dimension,'ALL' parent_type,'ALL' key1,'ALL' key2,SUM(gmv_usd) gmv_usd,SUM(order_equivalent) order_equivalent FROM raw GROUP BY period,device_type,attribution_type
 UNION ALL
 ${['pay_type', 'attribution_name', 'actual_supplier', 'actual_provider', 'product_type', 'product_type_lv2'].map((d) => `SELECT period,device_type,attribution_type,'${d}' dimension,${d === 'pay_type' ? "'ALL'" : 'pay_type'} parent_type,COALESCE(CAST(${d} AS STRING),'UNKNOWN') key1,'ALL' key2,SUM(gmv_usd) gmv_usd,SUM(order_equivalent) order_equivalent FROM raw GROUP BY period,device_type,attribution_type,${d === 'pay_type' ? 'pay_type' : `pay_type,${d}`}`).join('\nUNION ALL\n')}
) SELECT *,COUNT(*) OVER() source_row_count FROM result`,
);
console.log(`Prepared six source-only queries in ${dir}`);
