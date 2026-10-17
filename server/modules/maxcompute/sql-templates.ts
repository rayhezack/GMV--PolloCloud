// SQL 口径对齐用户提供的原始日度脚本与重建说明。

export type DatasetKind = 'pay_type' | 'chain' | 'creative' | 'renewal';

export interface SqlParams {
  platform: string;
  start: string;
  end: string;
  granularity?: 'daily' | 'weekly';
}

function safe(value: string): string {
  return value.replace(/'/gu, "''");
}

function buildEventPlatformCondition(platform: string): string {
  if (platform === 'web') return "platform_type = 'web'";
  if (platform === 'all') return '1 = 1';
  return "COALESCE(platform_type, '') <> 'web'";
}

function buildChainEventPlatformCondition(platform: string): string {
  if (platform === 'web') return "platform_type = 'web'";
  if (platform === 'all') return '1 = 1';
  return "LOWER(COALESCE(platform_type, '')) IN ('ios', 'android')";
}

function buildCreationPlatformCondition(platform: string): string {
  if (platform === 'web') return "app_platform = 'web'";
  if (platform === 'all') return '1 = 1';
  return "app_platform IN ('android', 'ios')";
}

function buildCreationDeviceJoinCondition(platform: string): string {
  return platform === 'all'
    ? '1 = 1'
    : 'LOWER(c.app_platform) = a.device_type';
}

function buildPaymentPlatformCondition(platform: string): string {
  if (platform === 'all') return '1 = 1';
  if (platform === 'web') {
    return [
      "LOWER(COALESCE(s.platform_name, '')) NOT IN ('apple', 'google')",
      "LOWER(COALESCE(p.price_id, '')) NOT LIKE '%ios%'",
      "LOWER(COALESCE(p.price_id, '')) NOT LIKE '%android%'",
    ].join(' AND ');
  }
  return [
    "LOWER(COALESCE(s.platform_name, '')) IN ('apple', 'google')",
    "OR LOWER(COALESCE(p.price_id, '')) LIKE '%ios%'",
    "OR LOWER(COALESCE(p.price_id, '')) LIKE '%android%'",
  ].join(' ');
}

function buildPaymentDeviceTypeExpression(platform: string): string {
  if (platform === 'all') return "'all'";
  return platform === 'web'
    ? "'web'"
    : [
        'CASE',
        "WHEN LOWER(COALESCE(s.platform_name, '')) = 'apple' OR LOWER(COALESCE(p.price_id, '')) LIKE '%ios%' THEN 'ios'",
        "WHEN LOWER(COALESCE(s.platform_name, '')) = 'google' OR LOWER(COALESCE(p.price_id, '')) LIKE '%android%' THEN 'android'",
        'END',
      ].join(' ');
}

function buildPayTypeDeviceTypeExpression(platform: string): string {
  if (platform === 'all') return "'all'";
  if (platform === 'web') return "'web'";
  return [
    'CASE',
    "WHEN LOWER(COALESCE(s.platform_name, '')) = 'apple' OR LOWER(COALESCE(p.price_id, '')) LIKE '%ios%' THEN 'ios'",
    "WHEN LOWER(COALESCE(s.platform_name, '')) = 'google' OR LOWER(COALESCE(p.price_id, '')) LIKE '%android%' THEN 'android'",
    'END',
  ].join(' ');
}

function buildEventDeviceTypeExpression(platform: string): string {
  if (platform === 'all') return "'all'";
  return platform === 'web' ? "'web'" : 'LOWER(platform_type)';
}

function buildPaywallExposureCondition(platform: string): string {
  const webCondition = [
    "(event_id = 'page_view' AND page_name IN ('account/billing', 'pricing'))",
    "OR event_id = 'sub_start'",
  ].join(' ');
  if (platform === 'web') return webCondition;
  if (platform === 'all') {
    return `${webCondition} OR event_id = 'sub_start_expose'`;
  }
  return "event_id = 'sub_start_expose'";
}

function buildRenewalPlatformCondition(platform: string): string {
  if (platform === 'web') return "UPPER(platform_type) = 'WEB'";
  if (platform === 'all') {
    return "UPPER(platform_type) IN ('WEB', 'APP')";
  }
  return "UPPER(platform_type) = 'APP'";
}

export function buildDatasetSql(
  dataset: DatasetKind,
  params: SqlParams,
): string {
  const platform = safe(params.platform);
  const startKey = safe(params.start.replace(/-/gu, ''));
  const endKey = safe(params.end.replace(/-/gu, ''));
  const eventPlatformCondition =
    dataset === 'chain'
      ? buildChainEventPlatformCondition(platform)
      : buildEventPlatformCondition(platform);
  const payTypeEventPlatformCondition = buildChainEventPlatformCondition(platform);
  const creationPlatformCondition = buildCreationPlatformCondition(platform);
  const creationDeviceJoinCondition =
    buildCreationDeviceJoinCondition(platform);
  const paymentPlatformCondition = buildPaymentPlatformCondition(platform);
  const paymentDeviceTypeExpression =
    buildPaymentDeviceTypeExpression(platform);
  const payTypeDeviceTypeExpression =
    buildPayTypeDeviceTypeExpression(platform);
  const eventDeviceTypeExpression = buildEventDeviceTypeExpression(platform);
  const paywallExposureCondition = buildPaywallExposureCondition(platform);
  const renewalPlatformCondition = buildRenewalPlatformCondition(platform);
  const chainMetricPeriod =
    params.granularity === 'weekly'
      ? 'week_start AS stat_date'
      : 'dt AS stat_date';
  const chainMetricGroupBy =
    params.granularity === 'weekly'
      ? 'week_start, device_type, user_tag, creation_cnt_30d_level_id, creation_cnt_30d'
      : 'dt, week_start, device_type, user_tag, creation_cnt_30d_level_id, creation_cnt_30d';
  const creativeMetricPeriod =
    params.granularity === 'weekly'
      ? 'a.week_start AS stat_date'
      : 'a.active_date AS stat_date';
  const creativeMetricGroupBy =
    params.granularity === 'weekly'
      ? 'a.week_start, t.creation_cnt_30d_level_id, t.creation_cnt_30d'
      : 'a.active_date, a.week_start, t.creation_cnt_30d_level_id, t.creation_cnt_30d';

  switch (dataset) {
    case 'renewal':
      return `
SET odps.sql.type.system.odps2=true;

SELECT
    stat_date AS period,
    CAST(
        DATEADD(
            CAST(stat_date AS DATETIME),
            -CAST(PMOD(WEEKDAY(CAST(stat_date AS DATETIME)) + 2, 7) AS BIGINT),
            'dd'
        ) AS DATE
    ) AS week_start,
    DATE_ADD(
        CAST(
            DATEADD(
                CAST(stat_date AS DATETIME),
                -CAST(PMOD(WEEKDAY(CAST(stat_date AS DATETIME)) + 2, 7) AS BIGINT),
                'dd'
            ) AS DATE
        ),
        6
    ) AS week_end,
    platform_type,
    plan_tier,
    plan_cycle,
    SUM(expire_user_cnt) AS expire_user_cnt,
    SUM(renew_same_day_user_cnt) AS renew_user_cnt,
    SUM(renew_same_day_amount_usd) AS renew_amount_usd
FROM mc_prd.ads_pollo_renewal_cohort_dip
WHERE p_date BETWEEN '${startKey}' AND '${endKey}'
  AND platform_type <> '汇总'
  AND plan_cycle <> '汇总'
  AND plan_tier <> '汇总'
  AND borderline_tag = '汇总'
  AND ${renewalPlatformCondition}
GROUP BY
    stat_date,
    platform_type,
    plan_tier,
    plan_cycle
ORDER BY
    period,
    platform_type,
    plan_tier,
    plan_cycle
`.trim();
    case 'pay_type':
      return `
WITH
rates AS (
    SELECT
        LOWER(base_currency_code) AS currency_code,
        MAX(CAST(exchange_rate AS DOUBLE)) AS exchange_rate
    FROM mc_prd.dim_pollo_common_global_exchange_rate_dip
    WHERE p_date = IF('${endKey}' < '20260522', '20260522', '${endKey}')
      AND quote_currency_code = 'USD'
    GROUP BY LOWER(base_currency_code)
),

products AS (
    SELECT
        price_id,
        MAX(product_name) AS product_name
    FROM mc_prd.dwd_video_pollo_products_sub_dfp
    WHERE p_date = MAX_PT('mc_prd.dwd_video_pollo_products_sub_dfp')
    GROUP BY price_id
),

product_relation AS (
    SELECT
        platform_price_id,
        MAX(price_id) AS price_id
    FROM mc_prd.dwd_video_pollo_products_platform_relation_dfp
    WHERE p_date = MAX_PT(
        'mc_prd.dwd_video_pollo_products_platform_relation_dfp'
    )
    GROUP BY platform_price_id
),

all_paid_orders AS (
    SELECT
        CAST(s.id AS STRING) AS payment_id,
        CAST(s.user_id AS STRING) AS user_id,
        CAST(s.date_created AS DATETIME) AS pay_time,
        CAST(s.date_created AS DATE) AS pay_date,
        LOWER(COALESCE(s.description, '')) AS description,
        ${payTypeDeviceTypeExpression} AS device_type,
        CASE
            WHEN LOWER(s.currency) = 'usd'
                THEN CAST(s.amount AS DOUBLE) / 100.0000
            WHEN r.exchange_rate IS NOT NULL
                THEN CAST(s.amount AS DOUBLE) * r.exchange_rate / 100.0000
            ELSE 0.0000
        END AS gmv_usd
    FROM mc_prd.dwd_video_pollo_payment_records_sub_dfp s
    LEFT JOIN product_relation pr
        ON s.prices_id = pr.platform_price_id
    LEFT JOIN products p
        ON pr.price_id = p.price_id
    LEFT JOIN rates r
        ON LOWER(s.currency) = r.currency_code
    WHERE s.p_date = MAX_PT(
            'mc_prd.dwd_video_pollo_payment_records_sub_dfp'
        )
      AND s.amount > 0
      AND LOWER(COALESCE(s.order_risk_tag, 'NORMAL_ORDER')) <> 'risk_order'
      AND LOWER(COALESCE(s.description, '')) <> 'api credits'
      AND CAST(s.date_created AS DATE) < DATE_ADD(
            CAST(TO_DATE('${endKey}', 'yyyymmdd') AS DATE),
            1
        )
      AND (${paymentPlatformCondition})
      AND s.user_id NOT IN (
            'cm28h7zg80000mubl7xhyt6h3',
            'cm2wpx67s000moh1yb8ummve2',
            'cm28e14wa000amu8hq8ii3fev',
            'cm8whkg6000a5xs0klzhdr83p'
        )
),

target_paid_orders AS (
    SELECT
        o.payment_id,
        o.user_id,
        o.pay_time,
        o.pay_date,
        o.description,
        o.device_type,
        o.gmv_usd,
        CAST(
            DATEADD(
                CAST(o.pay_date AS DATETIME),
                -CAST(
                    PMOD(
                        WEEKDAY(CAST(o.pay_date AS DATETIME)) + 2,
                        7
                    ) AS BIGINT
                ),
                'dd'
            ) AS DATE
        ) AS week_start
    FROM all_paid_orders o
    WHERE o.pay_date >= CAST(TO_DATE('${startKey}', 'yyyymmdd') AS DATE)
      AND o.pay_date < DATE_ADD(
            CAST(TO_DATE('${endKey}', 'yyyymmdd') AS DATE),
            1
        )
),

first_subscription AS (
    SELECT user_id, payment_id AS first_subscription_payment_id
    FROM (
        SELECT
            user_id,
            payment_id,
            ROW_NUMBER() OVER (
                PARTITION BY user_id
                ORDER BY pay_time, payment_id
            ) AS subscription_rank
        FROM all_paid_orders
        WHERE description = 'subscription_create'
    ) ranked
    WHERE subscription_rank = 1
),

classified_paid_orders AS (
    SELECT
        o.payment_id,
        o.pay_date AS stat_date,
        o.week_start,
        CAST(
            DATEADD(CAST(o.week_start AS DATETIME), 6, 'dd') AS DATE
        ) AS week_end,
        o.user_id,
        o.pay_time,
        o.description,
        o.device_type,
        o.gmv_usd,
        CASE
            WHEN o.description = 'subscription_cycle'
                THEN '自动续订'
            WHEN o.description NOT IN (
                'subscription_cycle',
                'trial',
                'api credits'
            )
                THEN '主动付费'
            ELSE NULL
        END AS pay_type_l1,
        CASE
            WHEN o.description = 'subscription_cycle'
                THEN '自动续订'
            WHEN o.description = 'subscription_create'
             AND o.payment_id = fs.first_subscription_payment_id
                THEN '首订'
            WHEN o.description = 'subscription_create'
                THEN '重新订阅'
            WHEN o.description = 'subscription_update'
                THEN '套餐升级'
            WHEN o.description IN ('addon', 'pollo credits')
                THEN '积分包'
            ELSE '其他'
        END AS pay_type_l3
    FROM target_paid_orders o
    LEFT JOIN first_subscription fs
        ON o.user_id = fs.user_id
),

user_base AS (
    SELECT
        CAST(id AS STRING) AS user_id,
        MIN(CAST(date_created AS DATE)) AS min_signup_date
    FROM mc_prd.dwd_ai_video_pollo_user_dfp
    WHERE p_date = MAX_PT('mc_prd.dwd_ai_video_pollo_user_dfp')
    GROUP BY CAST(id AS STRING)
),

function_events AS (
    SELECT
        CAST(uid AS STRING) AS user_id,
        CAST(event_time AS DATETIME) AS event_time,
        COALESCE(
            NULLIF(GET_JSON_OBJECT(properties, '$.source_function'), ''),
            NULLIF(GET_JSON_OBJECT(properties, '$.form_type'), '')
        ) AS function_name
    FROM mc_prd.ods_pollo_log_event_dip
    WHERE p_date BETWEEN '${startKey}' AND '${endKey}'
      AND TO_CHAR(event_time, 'yyyymmdd') BETWEEN '${startKey}' AND '${endKey}'
      AND ${payTypeEventPlatformCondition}
      AND (${paywallExposureCondition})
      AND COALESCE(
            NULLIF(GET_JSON_OBJECT(properties, '$.source_function'), ''),
            NULLIF(GET_JSON_OBJECT(properties, '$.form_type'), '')
          ) IS NOT NULL
),

order_event_candidates AS (
    SELECT
        o.*,
        COALESCE(e.function_name, 'not_attributed') AS function_name,
        ROW_NUMBER() OVER (
            PARTITION BY o.payment_id
            ORDER BY
                e.event_time DESC
        ) AS event_rank
    FROM classified_paid_orders o
    LEFT JOIN function_events e
        ON o.pay_type_l1 = '主动付费'
       AND o.user_id = e.user_id
       AND e.event_time <= o.pay_time
),

attributed_paid_orders AS (
    SELECT
        o.payment_id,
        o.stat_date,
        o.week_start,
        o.week_end,
        o.device_type,
        o.pay_type_l1,
        o.pay_type_l3,
        o.function_name,
        CASE
            WHEN u.min_signup_date IS NULL THEN '未知'
            WHEN u.min_signup_date >= o.week_start
             AND u.min_signup_date < DATE_ADD(o.week_start, 7)
                THEN '新用户'
            ELSE '老用户'
        END AS user_tag,
        o.gmv_usd
    FROM order_event_candidates o
    LEFT JOIN user_base u
        ON CAST(o.user_id AS STRING) = u.user_id
    WHERE o.event_rank = 1
),

active_payment_detail AS (
    SELECT
        stat_date,
        week_start,
        week_end,
        device_type,
        pay_type_l3 AS pay_type,
        function_name,
        user_tag,
        SUM(gmv_usd) AS gmv_usd
    FROM attributed_paid_orders
    WHERE pay_type_l1 = '主动付费'
      AND pay_type_l3 IS NOT NULL
    GROUP BY
        stat_date,
        week_start,
        week_end,
        device_type,
        pay_type_l3,
        function_name,
        user_tag
),

renewal_summary AS (
    SELECT
        stat_date,
        week_start,
        week_end,
        device_type,
        '自动续订' AS pay_type,
        CAST(NULL AS STRING) AS function_name,
        CAST(NULL AS STRING) AS user_tag,
        SUM(gmv_usd) AS gmv_usd
    FROM classified_paid_orders
    WHERE pay_type_l1 = '自动续订'
    GROUP BY
        stat_date,
        week_start,
        week_end,
        device_type
),

daily_gmv AS (
    SELECT * FROM active_payment_detail
    UNION ALL
    SELECT * FROM renewal_summary
)

SELECT
    stat_date AS period,
    week_start,
    week_end,
    device_type,
    pay_type,
    function_name,
    user_tag,
    CAST(ROUND(gmv_usd, 2) AS DECIMAL(18, 2)) AS gmv_usd
FROM daily_gmv
ORDER BY
    period,
    device_type,
    pay_type,
    COALESCE(function_name, ''),
    COALESCE(user_tag, '')
`.trim();
    case 'chain':
      return `
SET odps.sql.type.system.odps2=true;

WITH
rates AS (
    SELECT
        LOWER(base_currency_code) AS currency_code,
        MAX(CAST(exchange_rate AS DOUBLE)) AS exchange_rate
    FROM mc_prd.dim_pollo_common_global_exchange_rate_dip
    WHERE p_date = IF('${endKey}' < '20260522', '20260522', '${endKey}')
      AND quote_currency_code = 'USD'
    GROUP BY LOWER(base_currency_code)
),

products AS (
    SELECT
        price_id,
        MAX(product_name) AS product_name
    FROM mc_prd.dwd_video_pollo_products_sub_dfp
    WHERE p_date = MAX_PT('mc_prd.dwd_video_pollo_products_sub_dfp')
    GROUP BY price_id
),

relation AS (
    SELECT
        platform_price_id,
        MAX(price_id) AS price_id
    FROM mc_prd.dwd_video_pollo_products_platform_relation_dfp
    WHERE p_date = MAX_PT(
        'mc_prd.dwd_video_pollo_products_platform_relation_dfp'
    )
    GROUP BY platform_price_id
),

visited_users AS (
    SELECT
        CAST(event_time AS DATE) AS dt,
        ${eventDeviceTypeExpression} AS device_type,
        CAST(uid AS STRING) AS user_id,
        MIN(event_time) AS first_dau_time
    FROM mc_prd.ods_pollo_log_event_dip
    WHERE p_date BETWEEN '${startKey}' AND '${endKey}'
      AND TO_CHAR(event_time, 'yyyymmdd') BETWEEN '${startKey}' AND '${endKey}'
      AND ${eventPlatformCondition}
      AND uid IS NOT NULL
      AND uid <> ''
      AND event_id IS NOT NULL
    GROUP BY
        CAST(event_time AS DATE),
        ${eventDeviceTypeExpression},
        CAST(uid AS STRING)
),

subscription_expose AS (
    SELECT
        CAST(event_time AS DATE) AS dt,
        ${eventDeviceTypeExpression} AS device_type,
        CAST(uid AS STRING) AS user_id,
        MIN(event_time) AS first_expose_time
    FROM mc_prd.ods_pollo_log_event_dip
    WHERE p_date BETWEEN '${startKey}' AND '${endKey}'
      AND TO_CHAR(event_time, 'yyyymmdd') BETWEEN '${startKey}' AND '${endKey}'
      AND ${eventPlatformCondition}
      AND uid IS NOT NULL
      AND uid <> ''
      AND (${paywallExposureCondition})
    GROUP BY
        CAST(event_time AS DATE),
        ${eventDeviceTypeExpression},
        CAST(uid AS STRING)
),

subscription_submit AS (
    SELECT
        CAST(event_time AS DATE) AS dt,
        ${eventDeviceTypeExpression} AS device_type,
        CAST(uid AS STRING) AS user_id,
        MIN(event_time) AS first_submit_time
    FROM mc_prd.ods_pollo_log_event_dip
    WHERE p_date BETWEEN '${startKey}' AND '${endKey}'
      AND TO_CHAR(event_time, 'yyyymmdd') BETWEEN '${startKey}' AND '${endKey}'
      AND ${eventPlatformCondition}
      AND uid IS NOT NULL
      AND uid <> ''
      AND event_id IN ('sub_submit', 'refresh_billing_click')
    GROUP BY
        CAST(event_time AS DATE),
        ${eventDeviceTypeExpression},
        CAST(uid AS STRING)
),

payments AS (
    SELECT
        CAST(s.user_id AS STRING) AS user_id,
        CAST(s.date_created AS DATE) AS dt,
        ${paymentDeviceTypeExpression} AS device_type,
        MIN(CAST(s.date_created AS DATETIME)) AS first_pay_time,
        SUM(
            CASE
                WHEN LOWER(s.currency) = 'usd'
                    THEN CAST(s.amount AS DOUBLE) / 100.0000
                WHEN r.exchange_rate IS NOT NULL
                    THEN CAST(s.amount AS DOUBLE) * r.exchange_rate / 100.0000
                ELSE 0.0000
            END
        ) AS gmv_usd
    FROM mc_prd.dwd_video_pollo_payment_records_sub_dfp s
    LEFT JOIN relation pr
        ON s.prices_id = pr.platform_price_id
    LEFT JOIN products p
        ON pr.price_id = p.price_id
    LEFT JOIN rates r
        ON LOWER(s.currency) = r.currency_code
    WHERE s.p_date = MAX_PT(
            'mc_prd.dwd_video_pollo_payment_records_sub_dfp'
        )
      AND LOWER(COALESCE(s.order_risk_tag, 'NORMAL_ORDER')) <> 'risk_order'
      AND LOWER(COALESCE(s.description, '')) NOT IN (
            'api credits',
            'subscription_cycle',
            'trial'
        )
      AND TO_CHAR(s.date_created, 'yyyymmdd') BETWEEN '${startKey}' AND '${endKey}'
      AND (${paymentPlatformCondition})
      AND s.user_id NOT IN (
            'cm28h7zg80000mubl7xhyt6h3',
            'cm2wpx67s000moh1yb8ummve2',
            'cm28e14wa000amu8hq8ii3fev',
            'cm8whkg6000a5xs0klzhdr83p'
        )
    GROUP BY
        CAST(s.user_id AS STRING),
        CAST(s.date_created AS DATE),
        ${paymentDeviceTypeExpression}
),

active_user_day AS (
    SELECT DISTINCT
        dt,
        device_type,
        user_id
    FROM visited_users
),

expose_user_day AS (
    SELECT DISTINCT
        a.dt,
        a.device_type,
        a.user_id
    FROM visited_users a
    INNER JOIN subscription_expose b
        ON a.dt = b.dt
       AND a.device_type = b.device_type
       AND a.user_id = b.user_id
       AND a.first_dau_time <= b.first_expose_time
),

submit_user_day AS (
    SELECT DISTINCT
        a.dt,
        a.device_type,
        a.user_id
    FROM visited_users a
    INNER JOIN subscription_submit b
        ON a.dt = b.dt
       AND a.device_type = b.device_type
       AND a.user_id = b.user_id
       AND a.first_dau_time <= b.first_submit_time
),

payments_user_day AS (
    SELECT
        a.dt,
        a.device_type,
        a.user_id,
        p.gmv_usd
    FROM visited_users a
    INNER JOIN payments p
        ON a.dt = p.dt
       AND a.device_type = p.device_type
       AND a.user_id = p.user_id
       AND a.first_dau_time <= p.first_pay_time
),

chain_user_day AS (
    SELECT
        a.dt,
        a.device_type,
        a.user_id,
        CASE WHEN e.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_expose,
        CASE WHEN s.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_submit,
        CASE WHEN p.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_pay,
        COALESCE(p.gmv_usd, 0.0000) AS gmv_usd
    FROM active_user_day a
    LEFT JOIN expose_user_day e
        ON a.dt = e.dt
       AND a.device_type = e.device_type
       AND a.user_id = e.user_id
    LEFT JOIN submit_user_day s
        ON a.dt = s.dt
       AND a.device_type = s.device_type
       AND a.user_id = s.user_id
    LEFT JOIN payments_user_day p
        ON a.dt = p.dt
       AND a.device_type = p.device_type
       AND a.user_id = p.user_id
),

chain_user_day_with_week AS (
    SELECT
        dt,
        device_type,
        user_id,
        CAST(
            DATEADD(
                CAST(dt AS DATETIME),
                -CAST(
                    PMOD(
                        WEEKDAY(CAST(dt AS DATETIME)) + 2,
                        7
                    ) AS BIGINT
                ),
                'dd'
            ) AS DATE
        ) AS week_start,
        is_expose,
        is_submit,
        is_pay,
        gmv_usd
    FROM chain_user_day
),

access_users AS (
    SELECT DISTINCT
        week_start,
        device_type,
        user_id
    FROM chain_user_day_with_week
),

user_base AS (
    SELECT
        id AS user_id,
        MIN(CAST(date_created AS DATE)) AS min_signup_date
    FROM mc_prd.dwd_ai_video_pollo_user_dfp
    WHERE p_date = MAX_PT('mc_prd.dwd_ai_video_pollo_user_dfp')
      AND email IS NOT NULL
      AND email <> ''
    GROUP BY id
),

user_week_info AS (
    SELECT
        a.week_start,
        a.device_type,
        a.user_id,
        CASE
            WHEN b.min_signup_date IS NULL THEN '未知'
            WHEN b.min_signup_date >= a.week_start
             AND b.min_signup_date < DATE_ADD(a.week_start, 7) THEN '新用户'
            ELSE '老用户'
        END AS user_tag
    FROM access_users a
    LEFT JOIN user_base b
        ON a.user_id = b.user_id
),

user_30d_creation AS (
    SELECT
        a.week_start,
        a.device_type,
        a.user_id,
        COUNT(DISTINCT c.id) AS creation_task_cnt_30d
    FROM access_users a
    LEFT JOIN mc_prd.dwd_video_pollo_video_generate_record_dfp c
        ON a.user_id = c.user_id
       AND CAST(c.created_date AS DATE) >= DATE_ADD(a.week_start, -30)
       AND CAST(c.created_date AS DATE) < a.week_start
       AND ${creationPlatformCondition}
       AND ${creationDeviceJoinCondition}
       AND c.user_id IS NOT NULL
       AND c.user_id <> ''
       AND c.p_date = MAX_PT(
            'mc_prd.dwd_video_pollo_video_generate_record_dfp'
       )
    GROUP BY
        a.week_start,
        a.device_type,
        a.user_id
),

chain_user_day_tagged AS (
    SELECT
        t1.dt,
        t1.week_start,
        t1.device_type,
        t1.user_id,
        t1.is_expose,
        t1.is_submit,
        t1.is_pay,
        t1.gmv_usd,
        t3.user_tag,
        CASE
            WHEN COALESCE(t2.creation_task_cnt_30d, 0) = 0 THEN 0
            WHEN COALESCE(t2.creation_task_cnt_30d, 0) BETWEEN 1 AND 10 THEN 1
            WHEN COALESCE(t2.creation_task_cnt_30d, 0) BETWEEN 11 AND 30 THEN 2
            WHEN COALESCE(t2.creation_task_cnt_30d, 0) BETWEEN 31 AND 100 THEN 3
            ELSE 4
        END AS creation_cnt_30d_level_id,
        CASE
            WHEN COALESCE(t2.creation_task_cnt_30d, 0) = 0
                THEN 'create_cnt_30d_0'
            WHEN COALESCE(t2.creation_task_cnt_30d, 0) BETWEEN 1 AND 10
                THEN 'create_cnt_30d_[1,11)'
            WHEN COALESCE(t2.creation_task_cnt_30d, 0) BETWEEN 11 AND 30
                THEN 'create_cnt_30d_[11,31)'
            WHEN COALESCE(t2.creation_task_cnt_30d, 0) BETWEEN 31 AND 100
                THEN 'create_cnt_30d_[31,101)'
            ELSE 'create_cnt_30d_[101,+inf)'
        END AS creation_cnt_30d
    FROM chain_user_day_with_week t1
    LEFT JOIN user_30d_creation t2
        ON t1.week_start = t2.week_start
       AND t1.device_type = t2.device_type
       AND t1.user_id = t2.user_id
    LEFT JOIN user_week_info t3
        ON t1.week_start = t3.week_start
       AND t1.device_type = t3.device_type
       AND t1.user_id = t3.user_id
),

chain_metric AS (
    SELECT
        ${chainMetricPeriod},
        week_start,
        device_type,
        user_tag,
        creation_cnt_30d_level_id,
        creation_cnt_30d,
        COUNT(DISTINCT user_id) AS active_uv,
        COUNT(DISTINCT CASE WHEN is_expose = 1 THEN user_id END) AS sub_expose_uv,
        COUNT(DISTINCT CASE WHEN is_submit = 1 THEN user_id END) AS sub_submit_uv,
        COUNT(DISTINCT CASE WHEN is_pay = 1 THEN user_id END) AS chain_pay_uv,
        SUM(gmv_usd) AS chain_gmv_usd
    FROM chain_user_day_tagged
    GROUP BY
        ${chainMetricGroupBy}
)

SELECT
    stat_date AS period,
    week_start,
    DATE_ADD(week_start, 6) AS week_end,
    device_type,
    user_tag,
    creation_cnt_30d_level_id,
    creation_cnt_30d,
    active_uv,
    sub_expose_uv,
    sub_submit_uv,
    chain_pay_uv,
    CAST(ROUND(chain_gmv_usd, 2) AS DECIMAL(18, 2)) AS chain_gmv_usd,
    sub_expose_uv * 1.0000 / NULLIF(active_uv, 0) AS sub_expose_rate,
    sub_submit_uv * 1.0000 / NULLIF(sub_expose_uv, 0) AS sub_submit_rate,
    chain_pay_uv * 1.0000 / NULLIF(sub_submit_uv, 0) AS chain_pay_success_rate,
    chain_gmv_usd / NULLIF(chain_pay_uv, 0) AS chain_arppu
FROM chain_metric
ORDER BY
    period,
    device_type,
    creation_cnt_30d_level_id,
    user_tag
`.trim();
    case 'creative':
      return `
SET odps.sql.type.system.odps2=true;

WITH
active_user_day AS (
    SELECT
        CAST(event_time AS DATE) AS active_date,
        CAST(uid AS STRING) AS user_id
    FROM mc_prd.ods_pollo_log_event_dip
    WHERE p_date BETWEEN '${startKey}' AND '${endKey}'
      AND TO_CHAR(event_time, 'yyyymmdd') BETWEEN '${startKey}' AND '${endKey}'
      AND ${eventPlatformCondition}
      AND uid IS NOT NULL
      AND uid <> ''
      AND event_id IS NOT NULL
    GROUP BY
        CAST(event_time AS DATE),
        CAST(uid AS STRING)
),

user_creation AS (
    SELECT
        user_id,
        CAST(created_date AS DATE) AS create_date,
        COUNT(DISTINCT id) AS creation_task_cnt
    FROM mc_prd.dwd_video_pollo_video_generate_record_dfp
    WHERE p_date = MAX_PT('mc_prd.dwd_video_pollo_video_generate_record_dfp')
      AND ${creationPlatformCondition}
      AND CAST(created_date AS DATE) >= CAST(TO_DATE('${startKey}', 'yyyymmdd') AS DATE)
      AND CAST(created_date AS DATE) < DATE_ADD(
            CAST(TO_DATE('${endKey}', 'yyyymmdd') AS DATE),
            1
        )
    GROUP BY
        user_id,
        CAST(created_date AS DATE)
),

user_creation_hist AS (
    SELECT
        user_id,
        CAST(created_date AS DATE) AS create_date,
        COUNT(DISTINCT id) AS creation_task_cnt
    FROM mc_prd.dwd_video_pollo_video_generate_record_dfp
    WHERE p_date = MAX_PT('mc_prd.dwd_video_pollo_video_generate_record_dfp')
      AND ${creationPlatformCondition}
      AND CAST(created_date AS DATE) >= DATE_ADD(
            CAST(TO_DATE('${startKey}', 'yyyymmdd') AS DATE),
            -30
        )
      AND CAST(created_date AS DATE) < DATE_ADD(
            CAST(TO_DATE('${endKey}', 'yyyymmdd') AS DATE),
            1
        )
    GROUP BY
        user_id,
        CAST(created_date AS DATE)
),

active_user_week AS (
    SELECT DISTINCT
        CAST(
            DATEADD(
                CAST(active_date AS DATETIME),
                -CAST(
                    PMOD(
                        WEEKDAY(CAST(active_date AS DATETIME)) + 2,
                        7
                    ) AS BIGINT
                ),
                'dd'
            ) AS DATE
        ) AS week_start,
        user_id
    FROM active_user_day
),

user_30d_creation AS (
    SELECT
        a.week_start,
        a.user_id,
        COALESCE(SUM(c.creation_task_cnt), 0) AS creation_task_cnt_30d
    FROM active_user_week a
    LEFT JOIN user_creation_hist c
        ON a.user_id = c.user_id
       AND c.create_date >= DATE_ADD(a.week_start, -30)
       AND c.create_date < a.week_start
    GROUP BY
        a.week_start,
        a.user_id
),

user_week_tier AS (
    SELECT
        week_start,
        user_id,
        CASE
            WHEN creation_task_cnt_30d = 0 THEN 0
            WHEN creation_task_cnt_30d BETWEEN 1 AND 10 THEN 1
            WHEN creation_task_cnt_30d BETWEEN 11 AND 30 THEN 2
            WHEN creation_task_cnt_30d BETWEEN 31 AND 100 THEN 3
            ELSE 4
        END AS creation_cnt_30d_level_id,
        CASE
            WHEN creation_task_cnt_30d = 0 THEN 'create_cnt_30d_0'
            WHEN creation_task_cnt_30d BETWEEN 1 AND 10 THEN 'create_cnt_30d_[1,11)'
            WHEN creation_task_cnt_30d BETWEEN 11 AND 30 THEN 'create_cnt_30d_[11,31)'
            WHEN creation_task_cnt_30d BETWEEN 31 AND 100 THEN 'create_cnt_30d_[31,101)'
            ELSE 'create_cnt_30d_[101,+inf)'
        END AS creation_cnt_30d
    FROM user_30d_creation
),

active_user_day_tagged AS (
    SELECT
        a.active_date,
        CAST(
            DATEADD(
                CAST(a.active_date AS DATETIME),
                -CAST(
                    PMOD(
                        WEEKDAY(CAST(a.active_date AS DATETIME)) + 2,
                        7
                    ) AS BIGINT
                ),
                'dd'
            ) AS DATE
        ) AS week_start,
        a.user_id
    FROM active_user_day a
),

creation_user_day AS (
    SELECT
        create_date AS active_date,
        user_id,
        SUM(creation_task_cnt) AS creation_task_cnt_day
    FROM user_creation
    GROUP BY
        create_date,
        user_id
),

daily_metric AS (
    SELECT
        ${creativeMetricPeriod},
        a.week_start,
        t.creation_cnt_30d_level_id,
        t.creation_cnt_30d,
        COUNT(DISTINCT a.user_id) AS active_uv,
        COUNT(DISTINCT CASE
            WHEN COALESCE(c.creation_task_cnt_day, 0) > 0 THEN a.user_id
        END) AS creation_uv,
        SUM(COALESCE(c.creation_task_cnt_day, 0)) AS creation_task_cnt
    FROM active_user_day_tagged a
    LEFT JOIN user_week_tier t
        ON a.week_start = t.week_start
       AND a.user_id = t.user_id
    LEFT JOIN creation_user_day c
        ON a.active_date = c.active_date
       AND a.user_id = c.user_id
    GROUP BY
        ${creativeMetricGroupBy}
)

SELECT
    stat_date AS period,
    week_start,
    DATE_ADD(week_start, 6) AS week_end,
    creation_cnt_30d_level_id,
    creation_cnt_30d,
    active_uv,
    creation_uv,
    creation_task_cnt,
    creation_uv * 1.0000 / NULLIF(active_uv, 0) AS creation_penetration_rate,
    creation_task_cnt * 1.0000 / NULLIF(active_uv, 0) AS avg_creation_task_cnt_per_creator
FROM daily_metric
ORDER BY
    period,
    creation_cnt_30d_level_id
`.trim();
    default:
      throw new Error(`未知数据集：${dataset}`);
  }
}
