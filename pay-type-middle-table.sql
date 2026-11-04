-- 付费类型 / GMV 归因下钻：仅使用应用层中间表。
--
-- 参数：
--   ${startKey}：开始日期，格式 yyyymmdd
--   ${endKey}：结束日期，格式 yyyymmdd
--   ${platform}：web / app / all
--   ${attributionType}：NONE / CREATION_MODE / MODEL / ACTUAL_MODEL
--   ${attributionName}：具体 attribution_name；传 all 表示该归因类型下全部名称
--
-- 使用规则：
--   1. attributionType = NONE：大盘 GMV，按 pay_category / pay_sub_category 拆分。
--   2. attributionType = CREATION_MODE：按 attribution_name（统一创作功能名）下钻。
--   3. attributionType = MODEL：按 attribution_name（模型名）下钻。
--   4. attributionType = ACTUAL_MODEL：按 attribution_name + actual_supplier + actual_provider 下钻。
--   5. 只保留明细行，排除 pay_category / pay_sub_category 的汇总行，避免重复计算 GMV。

SET odps.sql.submit.mode=script;
SET odps.sql.type.system.odps2=true;

WITH attribution_detail AS (
    SELECT
        CAST(stat_date AS DATE) AS period,
        CAST(
            DATEADD(
                CAST(stat_date AS DATETIME),
                -CAST(PMOD(WEEKDAY(CAST(stat_date AS DATETIME)) + 2, 7) AS BIGINT),
                'dd'
            ) AS DATE
        ) AS week_start,
        CAST(
            DATEADD(
                CAST(stat_date AS DATETIME),
                -CAST(PMOD(WEEKDAY(CAST(stat_date AS DATETIME)) + 2, 7) AS BIGINT) + 6,
                'dd'
            ) AS DATE
        ) AS week_end,
        attribution_type,
        attribution_name,
        UPPER(pay_platform) AS pay_platform,
        CASE
            WHEN UPPER(pay_platform) = 'WEB' THEN 'WEB'
            WHEN UPPER(pay_platform) IN ('IOS', 'ANDROID') THEN 'APP'
            ELSE 'UNKNOWN'
        END AS platform_group,
        pay_category,
        pay_sub_category,
        actual_supplier,
        actual_provider,
        CAST(COALESCE(allocated_gmv_usd, 0) AS DOUBLE) AS allocated_gmv_usd,
        CAST(COALESCE(order_equivalent, 0) AS DOUBLE) AS order_equivalent
    FROM mc_prd.ads_pollo_transaction_gmv_attribution_daily_dip
    WHERE p_date BETWEEN '${startKey}' AND '${endKey}'
      AND stat_date BETWEEN
          CAST(TO_DATE('${startKey}', 'yyyymmdd') AS DATE)
          AND CAST(TO_DATE('${endKey}', 'yyyymmdd') AS DATE)
      AND attribution_type = '${attributionType}'
      AND (
            ('${attributionType}' = 'NONE' AND attribution_name IS NULL)
         OR ('${attributionType}' <> 'NONE'
             AND (
                    '${attributionName}' = 'all'
                 OR attribution_name = '${attributionName}'
             ))
      )
      AND UPPER(COALESCE(pay_platform, 'UNKNOWN')) <> '汇总'
      AND COALESCE(pay_category, '') <> '汇总'
      AND COALESCE(pay_sub_category, '') <> '汇总'
      AND (
            '${platform}' = 'all'
         OR ('${platform}' = 'web' AND UPPER(pay_platform) = 'WEB')
         OR ('${platform}' = 'app' AND UPPER(pay_platform) IN ('IOS', 'ANDROID'))
      )
)

SELECT
    period,
    week_start,
    week_end,
    attribution_type,
    attribution_name,
    platform_group,
    pay_platform,
    pay_category,
    CASE
        WHEN pay_category = 'ACTIVE_PAYMENT' THEN '主动付费'
        WHEN pay_category = 'AUTO_RENEWAL' THEN '自动续订'
        WHEN pay_category = 'API' THEN 'API'
        ELSE pay_category
    END AS pay_category_name,
    pay_sub_category,
    actual_supplier,
    actual_provider,
    CAST(ROUND(SUM(allocated_gmv_usd), 2) AS DECIMAL(20, 2)) AS gmv_usd,
    SUM(order_equivalent) AS order_equivalent
FROM attribution_detail
GROUP BY
    period,
    week_start,
    week_end,
    attribution_type,
    attribution_name,
    platform_group,
    pay_platform,
    pay_category,
    pay_sub_category,
    actual_supplier,
    actual_provider
ORDER BY
    period,
    platform_group,
    attribution_type,
    COALESCE(attribution_name, ''),
    pay_category,
    pay_sub_category,
    COALESCE(actual_supplier, ''),
    COALESCE(actual_provider, '');
