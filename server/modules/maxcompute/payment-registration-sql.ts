/** True payment results: registration country tiers map order countries through the warehouse dimension; platforms come from orders, registration date from the account snapshot. */
export function buildPaymentRegistrationSql(startDate: string, endDate: string) {
  if (![startDate, endDate].every(date => /^\d{4}-\d{2}-\d{2}$/.test(date)) || startDate > endDate) throw new Error('Invalid payment registration range');
  const week = "CAST(DATEADD(CAST(pay_date AS DATETIME), -CAST(PMOD(WEEKDAY(CAST(pay_date AS DATETIME)) + 2, 7) AS BIGINT), 'dd') AS DATE)";
  return `
WITH accounts AS (
  SELECT user_id, MIN(register_date) AS register_date
  FROM mc_prd.dim_pollo_user_account_dfp
  WHERE p_date = MAX_PT('mc_prd.dim_pollo_user_account_dfp')
  GROUP BY user_id
), country_tiers AS (
  SELECT country_code, MAX(country_tier) AS country_tier
  FROM mc_prd.dim_pollo_common_country_tier_nfn
  GROUP BY country_code
), subscription_ids AS (
  -- One mapping per payment: an ambiguous subscription is left unknown, never fan out an order.
  SELECT payment_id, CASE WHEN COUNT(DISTINCT subscribe_id)=1 THEN MAX(subscribe_id) END AS subscribe_id
  FROM mc_prd.dwd_pollo_transaction_order_snapshot_dip
  WHERE p_date BETWEEN '20241014' AND '${endDate.replaceAll('-', '')}'
  GROUP BY payment_id
), transition_subscriptions AS (
  SELECT DISTINCT o.user_id,s.subscribe_id,o.pay_platform
  FROM mc_prd.dwd_pollo_transaction_order_dip o
  JOIN subscription_ids s ON o.payment_id=s.payment_id
  WHERE o.p_date BETWEEN '${startDate.replaceAll('-', '')}' AND '${endDate.replaceAll('-', '')}'
    AND o.pay_type IN ('UPGRADE','CYCLE_RESET','DOWNGRADE') AND s.subscribe_id IS NOT NULL
), subscription_history AS (
  SELECT o.payment_id,o.pay_time,
    LAG(o.pay_time) OVER(PARTITION BY o.user_id,s.subscribe_id,o.pay_platform ORDER BY o.pay_time,o.payment_id) AS previous_pay_time,
    LAG(o.sku_combo_da) OVER(PARTITION BY o.user_id,s.subscribe_id,o.pay_platform ORDER BY o.pay_time,o.payment_id) AS previous_sku,
    LAG(o.plan_tier_da) OVER(PARTITION BY o.user_id,s.subscribe_id,o.pay_platform ORDER BY o.pay_time,o.payment_id) AS previous_plan_tier,
    LAG(o.sub_period_da) OVER(PARTITION BY o.user_id,s.subscribe_id,o.pay_platform ORDER BY o.pay_time,o.payment_id) AS previous_plan_cycle,
    LAG(o.usage_count) OVER(PARTITION BY o.user_id,s.subscribe_id,o.pay_platform ORDER BY o.pay_time,o.payment_id) AS previous_credit_amount
  FROM mc_prd.dwd_pollo_transaction_order_dip o
  JOIN subscription_ids s ON o.payment_id=s.payment_id
  JOIN transition_subscriptions t ON o.user_id=t.user_id AND s.subscribe_id=t.subscribe_id AND o.pay_platform=t.pay_platform
  WHERE o.p_date BETWEEN '20241014' AND '${endDate.replaceAll('-', '')}'
    AND o.product_type='SUBSCRIPTION' AND o.is_valid_order=1 AND o.is_paid_amount=1 AND o.pay_type<>'TRIAL'
), orders AS (
  SELECT o.pay_date AS period, ${week} AS week_start,
    CASE WHEN o.pay_platform='WEB' THEN 'web' WHEN o.pay_platform IN ('IOS','ANDROID') THEN 'app' ELSE 'unknown' END AS platform,
    LOWER(COALESCE(o.pay_platform,'UNKNOWN')) AS device_type,
    CASE o.pay_type WHEN 'NEW_SUB' THEN '首订' WHEN 'RENEW' THEN '自动续订'
      WHEN 'RESUBSCRIBE' THEN '重新订阅' WHEN 'UPGRADE' THEN '套餐升级'
      WHEN 'CYCLE_RESET' THEN '重置订阅周期' WHEN 'DOWNGRADE' THEN '套餐降级'
      WHEN 'ADDON' THEN '积分包' WHEN 'API' THEN 'API' ELSE '其他' END AS pay_type,
    COALESCE(NULLIF(UPPER(TRIM(o.reg_platform)),''),'UNKNOWN') AS reg_platform,
    COALESCE(NULLIF(o.sku_combo_da,''),'UNKNOWN') AS sku,
    COALESCE(NULLIF(o.plan_tier_da,''),'UNKNOWN') AS plan_tier,
    COALESCE(NULLIF(o.sub_period_da,''),'UNKNOWN') AS plan_cycle,
    COALESCE(CAST(o.usage_count AS STRING),'UNKNOWN') AS credit_amount,
    CASE WHEN o.pay_type IN ('UPGRADE','CYCLE_RESET','DOWNGRADE') AND h.previous_pay_time<o.pay_time THEN COALESCE(NULLIF(h.previous_sku,''),'UNKNOWN') ELSE 'UNKNOWN' END AS previous_sku,
    CASE WHEN o.pay_type IN ('UPGRADE','CYCLE_RESET','DOWNGRADE') AND h.previous_pay_time<o.pay_time THEN COALESCE(NULLIF(h.previous_plan_tier,''),'UNKNOWN') ELSE 'UNKNOWN' END AS previous_plan_tier,
    CASE WHEN o.pay_type IN ('UPGRADE','CYCLE_RESET','DOWNGRADE') AND h.previous_pay_time<o.pay_time THEN COALESCE(NULLIF(h.previous_plan_cycle,''),'UNKNOWN') ELSE 'UNKNOWN' END AS previous_plan_cycle,
    CASE WHEN o.pay_type IN ('UPGRADE','CYCLE_RESET','DOWNGRADE') AND h.previous_pay_time<o.pay_time THEN COALESCE(CAST(h.previous_credit_amount AS STRING),'UNKNOWN') ELSE 'UNKNOWN' END AS previous_credit_amount,
    a.register_date, COALESCE(c.country_tier,'T2') AS country_tier,
    o.amount_received_usd AS gmv_usd
  FROM mc_prd.dwd_pollo_transaction_order_dip o
  LEFT JOIN accounts a ON o.user_id=a.user_id
  LEFT JOIN country_tiers c ON UPPER(TRIM(o.reg_country))=c.country_code
  LEFT JOIN subscription_history h ON o.payment_id=h.payment_id
  WHERE o.p_date BETWEEN '${startDate.replaceAll('-', '')}' AND '${endDate.replaceAll('-', '')}'
    AND o.pay_date BETWEEN CAST(TO_DATE('${startDate.replaceAll('-', '')}','yyyymmdd') AS DATE) AND CAST(TO_DATE('${endDate.replaceAll('-', '')}','yyyymmdd') AS DATE)
    AND o.is_valid_order=1 AND o.is_paid_amount=1 AND o.pay_type<>'TRIAL'
), grouped AS (
  SELECT period,week_start,platform,device_type,pay_type,
    CASE WHEN register_date BETWEEN week_start AND DATE_ADD(week_start,6) THEN 'NEW'
      WHEN register_date<week_start THEN 'OLD' ELSE 'UNKNOWN' END AS user_lifecycle,
    country_tier,reg_platform,sku,plan_tier,plan_cycle,credit_amount,previous_sku,previous_plan_tier,previous_plan_cycle,previous_credit_amount,SUM(gmv_usd) AS gmv_usd
  FROM orders
  GROUP BY period,week_start,platform,device_type,pay_type,
    CASE WHEN register_date BETWEEN week_start AND DATE_ADD(week_start,6) THEN 'NEW'
      WHEN register_date<week_start THEN 'OLD' ELSE 'UNKNOWN' END,country_tier,reg_platform,sku,plan_tier,plan_cycle,credit_amount,previous_sku,previous_plan_tier,previous_plan_cycle,previous_credit_amount
)
SELECT *,COUNT(*) OVER() AS source_row_count FROM grouped
`.trim();
}
