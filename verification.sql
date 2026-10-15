-- 2026-10-10 Web/App UV attribution validation.
-- GMV/order metrics stay at payment_id grain. Additive payer UV uses the
-- first active-payment order of each user-day as its single attribution anchor.

WITH
rates AS (
    SELECT
        LOWER(base_currency_code) AS currency_code,
        MAX(CAST(exchange_rate AS DOUBLE)) AS exchange_rate
    FROM mc_prd.dim_pollo_common_global_exchange_rate_dip
    WHERE p_date = '20261010'
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

all_paid_orders AS (
    SELECT
        s.id AS payment_id,
        CAST(s.user_id AS STRING) AS user_id,
        CAST(s.date_created AS DATETIME) AS pay_time,
        CAST(s.date_created AS DATE) AS pay_date,
        CASE
            WHEN LOWER(COALESCE(s.platform_name, ''))
                    NOT IN ('apple', 'google')
             AND LOWER(COALESCE(p.price_id, '')) NOT LIKE '%ios%'
             AND LOWER(COALESCE(p.price_id, '')) NOT LIKE '%android%'
                THEN 'web'
            ELSE 'app'
        END AS platform,
        LOWER(COALESCE(s.description, '')) AS description,
        CASE
            WHEN LOWER(s.currency) = 'usd'
                THEN CAST(s.amount AS DOUBLE) / 100.0000
            WHEN r.exchange_rate IS NOT NULL
                THEN CAST(s.amount AS DOUBLE) * r.exchange_rate / 100.0000
            ELSE 0.0000
        END AS gmv_usd
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
      AND s.amount > 0
      AND LOWER(COALESCE(s.order_risk_tag, 'NORMAL_ORDER')) <> 'risk_order'
      AND LOWER(COALESCE(s.description, '')) <> 'api credits'
      AND CAST(s.date_created AS DATE) <= CAST(
            TO_DATE('20261010', 'yyyymmdd') AS DATE
        )
      AND s.user_id NOT IN (
            'cm28h7zg80000mubl7xhyt6h3',
            'cm2wpx67s000moh1yb8ummve2',
            'cm28e14wa000amu8hq8ii3fev',
            'cm8whkg6000a5xs0klzhdr83p'
        )
),

target_paid_orders AS (
    SELECT *
    FROM all_paid_orders
    WHERE pay_date = CAST(TO_DATE('20261010', 'yyyymmdd') AS DATE)
),

first_subscription AS (
    SELECT
        user_id,
        MIN(pay_time) AS first_subscription_time
    FROM all_paid_orders
    WHERE description = 'subscription_create'
    GROUP BY user_id
),

classified_orders AS (
    SELECT
        o.*,
        CASE
            WHEN o.description = 'subscription_cycle' THEN '自动续订'
            WHEN o.description NOT IN (
                'subscription_cycle',
                'trial',
                'api credits'
            ) THEN '主动付费'
            ELSE NULL
        END AS pay_type_l1,
        CASE
            WHEN o.description = 'subscription_cycle' THEN '自动续订'
            WHEN o.description = 'subscription_create'
            AND CAST(fs.first_subscription_time AS DATE)
                    >= CAST(TO_DATE('20261010', 'yyyymmdd') AS DATE)
             AND CAST(fs.first_subscription_time AS DATE)
                    < CAST(TO_DATE('20261017', 'yyyymmdd') AS DATE)
                THEN '首订'
            WHEN o.description = 'subscription_create' THEN '重新订阅'
            WHEN o.description = 'subscription_update' THEN '套餐升级'
            WHEN o.description IN ('addon', 'pollo credits') THEN '积分包'
            ELSE '其他'
        END AS pay_type_l3
    FROM target_paid_orders o
    LEFT JOIN first_subscription fs
        ON o.user_id = fs.user_id
),

function_events AS (
    SELECT
        CAST(uid AS STRING) AS user_id,
        CAST(event_time AS DATE) AS event_date,
        event_time,
        CASE
            WHEN LOWER(COALESCE(platform_type, '')) = 'web' THEN 'web'
            ELSE 'app'
        END AS platform,
        'source_function' AS attribution_source,
        NULLIF(
            GET_JSON_OBJECT(properties, '$.source_function'),
            ''
        ) AS function_name
    FROM mc_prd.ods_pollo_log_event_dip
    WHERE p_date = '20261010'
      AND TO_CHAR(event_time, 'yyyymmdd') = '20261010'
      AND event_id IN ('sub_start', 'sub_submit')
      AND NULLIF(
            GET_JSON_OBJECT(properties, '$.source_function'),
            ''
        ) IS NOT NULL

    UNION ALL

    SELECT
        CAST(uid AS STRING) AS user_id,
        CAST(event_time AS DATE) AS event_date,
        event_time,
        CASE
            WHEN LOWER(COALESCE(platform_type, '')) = 'web' THEN 'web'
            ELSE 'app'
        END AS platform,
        'form_type' AS attribution_source,
        NULLIF(GET_JSON_OBJECT(properties, '$.form_type'), '') AS function_name
    FROM mc_prd.ods_pollo_log_event_dip
    WHERE p_date = '20261010'
      AND TO_CHAR(event_time, 'yyyymmdd') = '20261010'
      AND event_id = 'createflow_form_submit'
      AND NULLIF(GET_JSON_OBJECT(properties, '$.form_type'), '') IS NOT NULL
),

order_event_candidates AS (
    SELECT
        o.*,
        COALESCE(e.function_name, 'not_attributed') AS function_name,
        ROW_NUMBER() OVER (
            PARTITION BY o.payment_id
            ORDER BY
                CASE
                    WHEN e.attribution_source = 'source_function' THEN 1
                    WHEN e.attribution_source = 'form_type' THEN 2
                    ELSE 3
                END,
                e.event_time DESC
        ) AS event_rank
    FROM classified_orders o
    LEFT JOIN function_events e
        ON o.pay_type_l1 = '主动付费'
       AND o.platform = e.platform
       AND o.user_id = e.user_id
       AND e.event_time <= o.pay_time
),

attributed_orders AS (
    SELECT *
    FROM order_event_candidates
    WHERE event_rank = 1
),

active_orders AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY platform, pay_date, user_id
            ORDER BY pay_time, payment_id
        ) AS user_day_order_rank
    FROM attributed_orders
    WHERE pay_type_l1 = '主动付费'
),

pay_type_nonexclusive AS (
    SELECT
        platform,
        pay_type_l3 AS attribution_value,
        COUNT(DISTINCT user_id) AS payer_uv
    FROM active_orders
    GROUP BY platform, pay_type_l3
),

pay_type_exclusive AS (
    SELECT
        platform,
        pay_type_l3 AS attribution_value,
        COUNT(DISTINCT user_id) AS payer_uv
    FROM active_orders
    WHERE user_day_order_rank = 1
    GROUP BY platform, pay_type_l3
),

function_nonexclusive AS (
    SELECT
        platform,
        function_name AS attribution_value,
        COUNT(DISTINCT user_id) AS payer_uv
    FROM active_orders
    GROUP BY platform, function_name
),

function_exclusive AS (
    SELECT
        platform,
        function_name AS attribution_value,
        COUNT(DISTINCT user_id) AS payer_uv
    FROM active_orders
    WHERE user_day_order_rank = 1
    GROUP BY platform, function_name
),

pay_type_metrics AS (
    SELECT
        platform,
        pay_type_l3 AS attribution_value,
        COUNT(DISTINCT payment_id) AS order_cnt,
        SUM(gmv_usd) AS gmv_usd,
        COUNT(DISTINCT user_id) AS nonexclusive_payer_uv,
        COUNT(DISTINCT CASE
            WHEN user_day_order_rank = 1 THEN user_id
        END) AS exclusive_payer_uv
    FROM active_orders
    GROUP BY platform, pay_type_l3
),

function_metrics AS (
    SELECT
        platform,
        function_name AS attribution_value,
        COUNT(DISTINCT payment_id) AS order_cnt,
        SUM(gmv_usd) AS gmv_usd,
        COUNT(DISTINCT user_id) AS nonexclusive_payer_uv,
        COUNT(DISTINCT CASE
            WHEN user_day_order_rank = 1 THEN user_id
        END) AS exclusive_payer_uv
    FROM active_orders
    GROUP BY platform, function_name
),

dimension_uv AS (
    SELECT
        'pay_type' AS dimension_name,
        n.platform,
        n.attribution_value,
        n.payer_uv AS nonexclusive_payer_uv,
        COALESCE(e.payer_uv, 0) AS exclusive_payer_uv
    FROM pay_type_nonexclusive n
    LEFT JOIN pay_type_exclusive e
        ON n.platform = e.platform
       AND n.attribution_value = e.attribution_value

    UNION ALL

    SELECT
        'function' AS dimension_name,
        n.platform,
        n.attribution_value,
        n.payer_uv AS nonexclusive_payer_uv,
        COALESCE(e.payer_uv, 0) AS exclusive_payer_uv
    FROM function_nonexclusive n
    LEFT JOIN function_exclusive e
        ON n.platform = e.platform
       AND n.attribution_value = e.attribution_value
),

active_uv AS (
    SELECT
        platform,
        COUNT(DISTINCT user_id) AS total_active_payer_uv
    FROM active_orders
    GROUP BY platform
)

SELECT
    d.dimension_name,
    d.platform,
    d.attribution_value,
    d.nonexclusive_payer_uv,
    d.exclusive_payer_uv,
    CASE
        WHEN d.dimension_name = 'pay_type' THEN pm.order_cnt
        ELSE fm.order_cnt
    END AS order_cnt,
    CASE
        WHEN d.dimension_name = 'pay_type' THEN pm.gmv_usd
        ELSE fm.gmv_usd
    END AS gmv_usd,
    a.total_active_payer_uv
FROM dimension_uv d
INNER JOIN active_uv a
    ON d.platform = a.platform
LEFT JOIN pay_type_metrics pm
    ON d.dimension_name = 'pay_type'
   AND d.platform = pm.platform
   AND d.attribution_value = pm.attribution_value
LEFT JOIN function_metrics fm
    ON d.dimension_name = 'function'
   AND d.platform = fm.platform
   AND d.attribution_value = fm.attribution_value
ORDER BY
    d.dimension_name,
    d.platform,
    d.nonexclusive_payer_uv DESC,
    d.attribution_value;
