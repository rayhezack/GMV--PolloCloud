-- 2026-10-15 pay_type GMV 守恒校验
-- 只读查询：比较原始有效订单、无下钻汇总、功能×新老用户下钻汇总。

WITH
rates AS (
    SELECT
        LOWER(base_currency_code) AS currency_code,
        MAX(CAST(exchange_rate AS DOUBLE)) AS exchange_rate
    FROM mc_prd.dim_pollo_common_global_exchange_rate_dip
    WHERE p_date = '20261015'
      AND quote_currency_code = 'USD'
    GROUP BY LOWER(base_currency_code)
),

products AS (
    SELECT price_id, MAX(product_name) AS product_name
    FROM mc_prd.dwd_video_pollo_products_sub_dfp
    WHERE p_date = MAX_PT('mc_prd.dwd_video_pollo_products_sub_dfp')
    GROUP BY price_id
),

product_relation AS (
    SELECT platform_price_id, MAX(price_id) AS price_id
    FROM mc_prd.dwd_video_pollo_products_platform_relation_dfp
    WHERE p_date = MAX_PT('mc_prd.dwd_video_pollo_products_platform_relation_dfp')
    GROUP BY platform_price_id
),

scopes AS (
    SELECT 'web' AS platform
    UNION ALL SELECT 'app'
    UNION ALL SELECT 'all'
),

payment_base AS (
    SELECT
        CAST(s.id AS STRING) AS payment_id,
        CAST(s.user_id AS STRING) AS user_id,
        CAST(s.date_created AS DATETIME) AS pay_time,
        CAST(s.date_created AS DATE) AS pay_date,
        LOWER(COALESCE(s.description, '')) AS description,
        LOWER(COALESCE(s.platform_name, '')) AS platform_name,
        LOWER(COALESCE(p.price_id, '')) AS price_id,
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
    WHERE s.p_date = MAX_PT('mc_prd.dwd_video_pollo_payment_records_sub_dfp')
      AND s.amount > 0
      AND LOWER(COALESCE(s.order_risk_tag, 'NORMAL_ORDER')) <> 'risk_order'
      AND LOWER(COALESCE(s.description, '')) <> 'api credits'
      AND CAST(s.date_created AS DATE) < DATE_ADD(
            CAST(TO_DATE('20261015', 'yyyymmdd') AS DATE), 1
        )
      AND s.user_id NOT IN (
            'cm28h7zg80000mubl7xhyt6h3',
            'cm2wpx67s000moh1yb8ummve2',
            'cm28e14wa000amu8hq8ii3fev',
            'cm8whkg6000a5xs0klzhdr83p'
        )
),

scoped_orders AS (
    SELECT /*+ MAPJOIN(s) */
        s.platform,
        o.payment_id,
        o.user_id,
        o.pay_time,
        o.pay_date,
        o.description,
        CASE
            WHEN s.platform = 'all' THEN 'all'
            WHEN s.platform = 'web' THEN 'web'
            WHEN o.platform_name = 'apple' OR o.price_id LIKE '%ios%' THEN 'ios'
            WHEN o.platform_name = 'google' OR o.price_id LIKE '%android%' THEN 'android'
            ELSE NULL
        END AS device_type,
        o.gmv_usd
    FROM payment_base o
    JOIN scopes s ON 1 = 1
    WHERE (
            s.platform = 'all'
         OR (
                s.platform = 'web'
            AND o.platform_name NOT IN ('apple', 'google')
            AND o.price_id NOT LIKE '%ios%'
            AND o.price_id NOT LIKE '%android%'
         )
         OR (
                s.platform = 'app'
            AND (
                   o.platform_name IN ('apple', 'google')
                OR o.price_id LIKE '%ios%'
                OR o.price_id LIKE '%android%'
            )
         )
    )
),

target_paid_orders AS (
    SELECT
        o.*,
        CAST(
            DATEADD(
                CAST(o.pay_date AS DATETIME),
                -CAST(PMOD(WEEKDAY(CAST(o.pay_date AS DATETIME)) + 2, 7) AS BIGINT),
                'dd'
            ) AS DATE
        ) AS week_start
    FROM scoped_orders o
    WHERE o.pay_date = CAST(TO_DATE('20261015', 'yyyymmdd') AS DATE)
),

first_subscription AS (
    SELECT platform, user_id, payment_id AS first_subscription_payment_id
    FROM (
        SELECT
            platform,
            user_id,
            payment_id,
            ROW_NUMBER() OVER (
                PARTITION BY platform, user_id
                ORDER BY pay_time, payment_id
            ) AS subscription_rank
        FROM scoped_orders
        WHERE description = 'subscription_create'
    ) ranked
    WHERE subscription_rank = 1
),

classified_paid_orders AS (
    SELECT
        o.platform,
        o.payment_id,
        o.pay_date AS stat_date,
        o.week_start,
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
    LEFT JOIN first_subscription fs
        ON o.platform = fs.platform
       AND o.user_id = fs.user_id
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
    SELECT /*+ MAPJOIN(s) */
        s.platform,
        CAST(e.uid AS STRING) AS user_id,
        CAST(e.event_time AS DATETIME) AS event_time,
        COALESCE(
            NULLIF(GET_JSON_OBJECT(e.properties, '$.source_function'), ''),
            NULLIF(GET_JSON_OBJECT(e.properties, '$.form_type'), '')
        ) AS function_name
    FROM mc_prd.ods_pollo_log_event_dip e
    JOIN scopes s ON 1 = 1
    WHERE e.p_date = '20261015'
      AND TO_CHAR(e.event_time, 'yyyymmdd') = '20261015'
      AND (
            s.platform = 'all'
         OR (s.platform = 'web' AND LOWER(COALESCE(e.platform_type, '')) = 'web')
         OR (s.platform = 'app' AND LOWER(COALESCE(e.platform_type, '')) IN ('ios', 'android'))
      )
      AND (
            (s.platform = 'web'
             AND ((e.event_id = 'page_view' AND e.page_name IN ('account/billing', 'pricing'))
                  OR e.event_id = 'sub_start'))
         OR (s.platform = 'app' AND e.event_id = 'sub_start_expose')
         OR (s.platform = 'all'
             AND ((e.event_id = 'page_view' AND e.page_name IN ('account/billing', 'pricing'))
                  OR e.event_id IN ('sub_start', 'sub_start_expose')))
      )
      AND COALESCE(
            NULLIF(GET_JSON_OBJECT(e.properties, '$.source_function'), ''),
            NULLIF(GET_JSON_OBJECT(e.properties, '$.form_type'), '')
          ) IS NOT NULL
),

order_event_candidates AS (
    SELECT
        o.*,
        COALESCE(e.function_name, 'not_attributed') AS function_name,
        ROW_NUMBER() OVER (
            PARTITION BY o.platform, o.payment_id
            ORDER BY e.event_time DESC
        ) AS event_rank
    FROM classified_paid_orders o
    LEFT JOIN function_events e
        ON o.platform = e.platform
       AND o.pay_type_l1 = '主动付费'
       AND o.user_id = e.user_id
       AND e.event_time <= o.pay_time
),

attributed_paid_orders AS (
    SELECT
        o.platform,
        o.payment_id,
        o.stat_date,
        o.week_start,
        o.pay_type_l1,
        o.pay_type_l3,
        o.device_type,
        o.function_name,
        CASE
            WHEN u.min_signup_date IS NULL THEN '未知'
            WHEN u.min_signup_date >= o.week_start
             AND u.min_signup_date < DATE_ADD(o.week_start, 7) THEN '新用户'
            ELSE '老用户'
        END AS user_tag,
        o.gmv_usd
    FROM order_event_candidates o
    LEFT JOIN user_base u
        ON CAST(o.user_id AS STRING) = u.user_id
    WHERE o.event_rank = 1
),

base_total AS (
    SELECT platform, SUM(gmv_usd) AS raw_gmv_usd
    FROM classified_paid_orders
    WHERE pay_type_l1 IN ('主动付费', '自动续订')
    GROUP BY platform
),

no_dimension_total AS (
    SELECT platform, SUM(gmv_usd) AS no_dimension_gmv_usd
    FROM classified_paid_orders
    WHERE pay_type_l1 IN ('主动付费', '自动续订')
    GROUP BY platform
),

with_dimension_total AS (
    SELECT platform, SUM(gmv_usd) AS dimension_gmv_usd
    FROM attributed_paid_orders
    WHERE pay_type_l1 IN ('主动付费', '自动续订')
    GROUP BY platform
)

SELECT
    b.platform,
    CAST(ROUND(b.raw_gmv_usd, 2) AS DECIMAL(18, 2)) AS raw_gmv_usd,
    CAST(ROUND(n.no_dimension_gmv_usd, 2) AS DECIMAL(18, 2)) AS no_dimension_gmv_usd,
    CAST(ROUND(d.dimension_gmv_usd, 2) AS DECIMAL(18, 2)) AS dimension_gmv_usd,
    CAST(ROUND(n.no_dimension_gmv_usd - b.raw_gmv_usd, 6) AS DECIMAL(18, 6)) AS no_dimension_diff,
    CAST(ROUND(d.dimension_gmv_usd - b.raw_gmv_usd, 6) AS DECIMAL(18, 6)) AS dimension_diff,
    CASE
        WHEN ABS(n.no_dimension_gmv_usd - b.raw_gmv_usd) < 0.000001
         AND ABS(d.dimension_gmv_usd - b.raw_gmv_usd) < 0.000001
            THEN 'PASS'
        ELSE 'FAIL'
    END AS conservation_check
FROM base_total b
JOIN no_dimension_total n ON b.platform = n.platform
JOIN with_dimension_total d ON b.platform = d.platform
ORDER BY CASE b.platform WHEN 'web' THEN 1 WHEN 'app' THEN 2 ELSE 3 END;
