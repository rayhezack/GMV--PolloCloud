/** True payment results: one order once; registration comes from the account snapshot. */
export function buildPaymentRegistrationSql(startDate: string, endDate: string) {
  if (![startDate, endDate].every(date => /^\d{4}-\d{2}-\d{2}$/.test(date)) || startDate > endDate) throw new Error('Invalid payment registration range');
  const week = "CAST(DATEADD(CAST(pay_date AS DATETIME), -CAST(PMOD(WEEKDAY(CAST(pay_date AS DATETIME)) + 2, 7) AS BIGINT), 'dd') AS DATE)";
  return `
WITH accounts AS (
  SELECT user_id, MIN(register_date) AS register_date
  FROM mc_prd.dim_pollo_user_account_dfp
  WHERE p_date = MAX_PT('mc_prd.dim_pollo_user_account_dfp')
  GROUP BY user_id
), orders AS (
  SELECT o.pay_date AS period, ${week} AS week_start,
    CASE WHEN o.pay_platform='WEB' THEN 'web' WHEN o.pay_platform IN ('IOS','ANDROID') THEN 'app' ELSE 'unknown' END AS platform,
    LOWER(COALESCE(o.pay_platform,'UNKNOWN')) AS device_type,
    CASE o.pay_type WHEN 'NEW_SUB' THEN '首订' WHEN 'RENEW' THEN '自动续订'
      WHEN 'RESUBSCRIBE' THEN '重新订阅' WHEN 'UPGRADE' THEN '套餐升级'
      WHEN 'CYCLE_RESET' THEN '重置订阅周期' WHEN 'DOWNGRADE' THEN '套餐降级'
      WHEN 'ADDON' THEN '积分包' WHEN 'API' THEN 'API' ELSE '其他' END AS pay_type,
    a.register_date, COALESCE(NULLIF(UPPER(TRIM(o.reg_country)),''),'未知') AS reg_country,
    o.amount_received_usd AS gmv_usd
  FROM mc_prd.dwd_pollo_transaction_order_dip o
  LEFT JOIN accounts a ON o.user_id=a.user_id
  WHERE o.p_date BETWEEN '${startDate.replaceAll('-', '')}' AND '${endDate.replaceAll('-', '')}'
    AND o.pay_date BETWEEN CAST(TO_DATE('${startDate.replaceAll('-', '')}','yyyymmdd') AS DATE) AND CAST(TO_DATE('${endDate.replaceAll('-', '')}','yyyymmdd') AS DATE)
    AND o.is_valid_order=1 AND o.is_paid_amount=1 AND o.pay_type<>'TRIAL'
), grouped AS (
  SELECT period,week_start,platform,device_type,pay_type,
    CASE WHEN register_date BETWEEN week_start AND DATE_ADD(week_start,6) THEN 'NEW'
      WHEN register_date<week_start THEN 'OLD' ELSE 'UNKNOWN' END AS user_lifecycle,
    reg_country,SUM(gmv_usd) AS gmv_usd
  FROM orders
  GROUP BY period,week_start,platform,device_type,pay_type,
    CASE WHEN register_date BETWEEN week_start AND DATE_ADD(week_start,6) THEN 'NEW'
      WHEN register_date<week_start THEN 'OLD' ELSE 'UNKNOWN' END,reg_country
)
SELECT *,COUNT(*) OVER() AS source_row_count FROM grouped
`.trim();
}
