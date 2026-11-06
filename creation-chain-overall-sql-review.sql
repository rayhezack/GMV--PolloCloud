-- MaxCompute: one row per day and source platform. Replace ${biz_date} with yyyymmdd.
-- Read the source's creation_mode = '汇总' row; do not sum function-level UV.
-- WEB, IOS, ANDROID and UNKNOWN are physical scopes; platform_type = '汇总' is
-- the source's deduplicated cross-platform total, not another physical scope.
-- The week fields are labels only: daily creation_user_cnt cannot be summed
-- into weekly distinct users. Task/output/GMV counts are additive over days.
-- D3/D7/D30 counts are NULL for immature cohorts; retain NULL on refresh.
SELECT
    stat_date AS period,
    CAST(DATEADD(
        CAST(stat_date AS DATETIME),
        -CAST(PMOD(WEEKDAY(CAST(stat_date AS DATETIME)) + 2, 7) AS BIGINT),
        'dd'
    ) AS DATE) AS week_start,
    DATE_ADD(CAST(DATEADD(
        CAST(stat_date AS DATETIME),
        -CAST(PMOD(WEEKDAY(CAST(stat_date AS DATETIME)) + 2, 7) AS BIGINT),
        'dd'
    ) AS DATE), 6) AS week_end,
    platform_type,
    creation_task_cnt,
    valid_creation_task_cnt,
    creation_user_cnt,
    success_task_cnt,
    success_output_cnt,
    adopted_task_cnt,
    adopted_output_cnt,
    d3_creation_user_cnt,
    d7_creation_user_cnt,
    d30_creation_user_cnt,
    gmv_usd,
    etl_time
FROM mc_prd.ads_pollo_creation_function_chain_daily_dip
WHERE p_date = '${biz_date}'
  AND stat_date = CAST(TO_DATE('${biz_date}', 'yyyymmdd') AS DATE)
  AND creation_mode = '汇总'
  AND user_type = '汇总'
  AND pay_gmv_usd_30d = '汇总'
  AND platform_type IN ('WEB', 'IOS', 'ANDROID', 'UNKNOWN', '汇总');
