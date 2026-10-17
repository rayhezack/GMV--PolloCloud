-- Pay type 通用参数 SQL（仅供口径检查）
-- 参数：
--   ${startKey} / ${endKey}: 日期参数，格式 yyyymmdd
--   ${paymentPlatformCondition}: 付费记录端口过滤条件
--   ${payTypeEventPlatformCondition}: 事件端口过滤条件
--   ${paywallExposureCondition}: 付费弹窗曝光事件条件
--   ${payTypeDeviceTypeExpression}: 由同步参数直接生成的端类型表达式（'web'/'app'/'all'）

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

product_relation AS (
    SELECT
        platform_price_id,
        MAX(price_id) AS price_id
    FROM mc_prd.dwd_video_pollo_products_platform_relation_dfp
    WHERE p_date = MAX_PT('mc_prd.dwd_video_pollo_products_platform_relation_dfp')
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
        CAST(DATEADD(CAST(o.week_start AS DATETIME), 6, 'dd') AS DATE) AS week_end,
        o.user_id,
        o.pay_time,
        o.description,
        o.device_type,
        o.gmv_usd,
        CASE
            WHEN o.description = 'subscription_cycle' THEN '自动续订'
            WHEN o.description NOT IN ('subscription_cycle', 'trial', 'api credits')
                THEN '主动付费'
            ELSE NULL
        END AS pay_type_l1,
        CASE
            WHEN o.description = 'subscription_cycle' THEN '自动续订'
            WHEN o.description = 'subscription_create'
             AND o.payment_id = fs.first_subscription_payment_id THEN '首订'
            WHEN o.description = 'subscription_create' THEN '重新订阅'
            WHEN o.description = 'subscription_update' THEN '套餐升级'
            WHEN o.description IN ('addon', 'pollo credits') THEN '积分包'
            ELSE '其他'
        END AS pay_type_l3
    FROM target_paid_orders o
    LEFT JOIN first_subscription fs ON o.user_id = fs.user_id
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
            ORDER BY e.event_time DESC
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
             AND u.min_signup_date < DATE_ADD(o.week_start, 7) THEN '新用户'
            ELSE '老用户'
        END AS user_tag,
        o.gmv_usd
    FROM order_event_candidates o
    LEFT JOIN user_base u ON CAST(o.user_id AS STRING) = u.user_id
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
    GROUP BY stat_date, week_start, week_end, device_type,
             pay_type_l3, function_name, user_tag
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
    GROUP BY stat_date, week_start, week_end, device_type
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
    COALESCE(user_tag, '');
