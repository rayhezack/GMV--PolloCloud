-- 支付链路日颗粒度 SQL
-- 参数：${startKey} / ${endKey}，格式 yyyymmdd
-- 参数：${platform}，取值 web / app / all
-- Web 付费墙曝光：page_view(account/billing/pricing) 或 sub_start
-- App 付费墙曝光：sub_start_expose
-- 支付提交：sub_submit 或 refresh_billing_click

SET odps.sql.type.system.odps2=true;

WITH
active_users AS (
    SELECT
        CAST(event_time AS DATE) AS stat_date,
        CASE
            WHEN LOWER(COALESCE(platform_type, '')) = 'web' THEN 'Web'
            WHEN LOWER(COALESCE(platform_type, '')) IN ('ios', 'android') THEN 'App'
            ELSE 'Unknown'
        END AS platform_type,
        CAST(uid AS STRING) AS user_id,
        MIN(CAST(event_time AS DATETIME)) AS first_active_time
    FROM mc_prd.ods_pollo_log_event_dip
    WHERE p_date BETWEEN '${startKey}' AND '${endKey}'
      AND TO_CHAR(event_time, 'yyyymmdd') BETWEEN '${startKey}' AND '${endKey}'
      AND uid IS NOT NULL
      AND uid <> ''
      AND event_id IS NOT NULL
      AND (
            '${platform}' = 'all'
         OR ('${platform}' = 'web' AND LOWER(COALESCE(platform_type, '')) = 'web')
         OR ('${platform}' = 'app' AND LOWER(COALESCE(platform_type, '')) IN ('ios', 'android'))
      )
    GROUP BY
        CAST(event_time AS DATE),
        CASE
            WHEN LOWER(COALESCE(platform_type, '')) = 'web' THEN 'Web'
            WHEN LOWER(COALESCE(platform_type, '')) IN ('ios', 'android') THEN 'App'
            ELSE 'Unknown'
        END,
        CAST(uid AS STRING)
),

paywall_exposure AS (
    SELECT
        CAST(event_time AS DATE) AS stat_date,
        CASE
            WHEN LOWER(COALESCE(platform_type, '')) = 'web' THEN 'Web'
            WHEN LOWER(COALESCE(platform_type, '')) IN ('ios', 'android') THEN 'App'
            ELSE 'Unknown'
        END AS platform_type,
        CAST(uid AS STRING) AS user_id,
        MIN(CAST(event_time AS DATETIME)) AS first_exposure_time
    FROM mc_prd.ods_pollo_log_event_dip
    WHERE p_date BETWEEN '${startKey}' AND '${endKey}'
      AND TO_CHAR(event_time, 'yyyymmdd') BETWEEN '${startKey}' AND '${endKey}'
      AND uid IS NOT NULL
      AND uid <> ''
      AND (
            (
                LOWER(COALESCE(platform_type, '')) = 'web'
                AND (
                    (event_id = 'page_view' AND page_name IN ('account/billing', 'pricing'))
                    OR event_id = 'sub_start'
                )
            )
         OR (
                LOWER(COALESCE(platform_type, '')) IN ('ios', 'android')
                AND event_id = 'sub_start_expose'
            )
      )
    GROUP BY
        CAST(event_time AS DATE),
        CASE
            WHEN LOWER(COALESCE(platform_type, '')) = 'web' THEN 'Web'
            WHEN LOWER(COALESCE(platform_type, '')) IN ('ios', 'android') THEN 'App'
            ELSE 'Unknown'
        END,
        CAST(uid AS STRING)
),

payment_submit AS (
    SELECT
        CAST(event_time AS DATE) AS stat_date,
        CASE
            WHEN LOWER(COALESCE(platform_type, '')) = 'web' THEN 'Web'
            WHEN LOWER(COALESCE(platform_type, '')) IN ('ios', 'android') THEN 'App'
            ELSE 'Unknown'
        END AS platform_type,
        CAST(uid AS STRING) AS user_id,
        MIN(CAST(event_time AS DATETIME)) AS first_submit_time
    FROM mc_prd.ods_pollo_log_event_dip
    WHERE p_date BETWEEN '${startKey}' AND '${endKey}'
      AND TO_CHAR(event_time, 'yyyymmdd') BETWEEN '${startKey}' AND '${endKey}'
      AND uid IS NOT NULL
      AND uid <> ''
      AND event_id IN ('sub_submit', 'refresh_billing_click')
    GROUP BY
        CAST(event_time AS DATE),
        CASE
            WHEN LOWER(COALESCE(platform_type, '')) = 'web' THEN 'Web'
            WHEN LOWER(COALESCE(platform_type, '')) IN ('ios', 'android') THEN 'App'
            ELSE 'Unknown'
        END,
        CAST(uid AS STRING)
),

paid_orders AS (
    SELECT
        CAST(o.pay_date AS DATE) AS stat_date,
        CASE
            WHEN LOWER(COALESCE(o.pay_platform, '')) = 'web' THEN 'Web'
            WHEN LOWER(COALESCE(o.pay_platform, '')) IN ('ios', 'android') THEN 'App'
            ELSE 'Unknown'
        END AS platform_type,
        CAST(o.user_id AS STRING) AS user_id,
        MIN(CAST(o.pay_time AS DATETIME)) AS pay_time,
        SUM(CAST(o.amount_received_usd AS DOUBLE)) AS gmv_usd
    FROM mc_prd.dwd_pollo_transaction_order_dip o
    WHERE o.p_date BETWEEN '${startKey}' AND '${endKey}'
      AND o.is_valid_order = 1
      AND o.is_paid_amount = 1
      AND o.pay_type NOT IN ('RENEW', 'API', 'TRIAL')
      AND o.user_id IS NOT NULL
      AND o.user_id <> ''
      AND (
            '${platform}' = 'all'
         OR ('${platform}' = 'web' AND LOWER(COALESCE(o.pay_platform, '')) = 'web')
         OR ('${platform}' = 'app' AND LOWER(COALESCE(o.pay_platform, '')) IN ('ios', 'android'))
      )
    GROUP BY
        CAST(o.pay_date AS DATE),
        CASE
            WHEN LOWER(COALESCE(o.pay_platform, '')) = 'web' THEN 'Web'
            WHEN LOWER(COALESCE(o.pay_platform, '')) IN ('ios', 'android') THEN 'App'
            ELSE 'Unknown'
        END,
        CAST(o.user_id AS STRING)
),

creation_before_day AS (
    SELECT
        a.stat_date,
        a.platform_type,
        a.user_id,
        COUNT(DISTINCT t.record_id) AS creation_task_cnt_30d
    FROM active_users a
    LEFT JOIN mc_prd.dwd_pollo_creation_task_dip t
      ON CAST(t.user_id AS STRING) = a.user_id
     AND t.is_valid_task = 1
     AND t.created_time < CAST(a.stat_date AS DATETIME)
     AND t.created_time >= DATEADD(CAST(a.stat_date AS DATETIME), -30, 'dd')
     AND t.p_date BETWEEN TO_CHAR(DATEADD(CAST(a.stat_date AS DATETIME), -30, 'dd'), 'yyyymmdd') AND TO_CHAR(a.stat_date, 'yyyymmdd')
    GROUP BY
        a.stat_date,
        a.platform_type,
        a.user_id
),

user_chain AS (
    SELECT
        a.stat_date,
        a.platform_type,
        a.user_id,
        CASE WHEN e.user_id IS NOT NULL AND e.first_exposure_time >= a.first_active_time THEN 1 ELSE 0 END AS is_exposed,
        CASE WHEN s.user_id IS NOT NULL AND s.first_submit_time >= a.first_active_time THEN 1 ELSE 0 END AS is_submitted,
        CASE WHEN p.user_id IS NOT NULL AND p.pay_time >= a.first_active_time THEN 1 ELSE 0 END AS is_paid,
        CASE WHEN p.user_id IS NOT NULL AND p.pay_time >= a.first_active_time THEN p.gmv_usd ELSE 0.0 END AS gmv_usd,
        CASE
            WHEN COALESCE(c.creation_task_cnt_30d, 0) = 0 THEN 'create_cnt_30d_0'
            WHEN c.creation_task_cnt_30d BETWEEN 1 AND 10 THEN 'create_cnt_30d_[1,11)'
            WHEN c.creation_task_cnt_30d BETWEEN 11 AND 30 THEN 'create_cnt_30d_[11,31)'
            WHEN c.creation_task_cnt_30d BETWEEN 31 AND 100 THEN 'create_cnt_30d_[31,101)'
            ELSE 'create_cnt_30d_[101,+inf)'
        END AS creation_cnt_30d
    FROM active_users a
    LEFT JOIN paywall_exposure e
      ON e.stat_date = a.stat_date
     AND e.platform_type = a.platform_type
     AND e.user_id = a.user_id
    LEFT JOIN payment_submit s
      ON s.stat_date = a.stat_date
     AND s.platform_type = a.platform_type
     AND s.user_id = a.user_id
    LEFT JOIN paid_orders p
      ON p.stat_date = a.stat_date
     AND p.platform_type = a.platform_type
     AND p.user_id = a.user_id
    LEFT JOIN creation_before_day c
      ON c.stat_date = a.stat_date
     AND c.platform_type = a.platform_type
     AND c.user_id = a.user_id
),

chain_daily AS (
    SELECT
        stat_date,
        platform_type,
        creation_cnt_30d,
        COUNT(DISTINCT user_id) AS active_uv,
        COUNT(DISTINCT CASE WHEN is_exposed = 1 THEN user_id END) AS sub_expose_uv,
        COUNT(DISTINCT CASE WHEN is_submitted = 1 THEN user_id END) AS sub_submit_uv,
        COUNT(DISTINCT CASE WHEN is_paid = 1 THEN user_id END) AS chain_pay_uv,
        SUM(gmv_usd) AS chain_gmv_usd
    FROM user_chain
    GROUP BY stat_date, platform_type, creation_cnt_30d
)

SELECT
    stat_date AS period,
    platform_type,
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
FROM chain_daily
ORDER BY period, platform_type, creation_cnt_30d;
