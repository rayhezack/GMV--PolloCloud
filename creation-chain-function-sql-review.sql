-- MaxCompute: one row per day, source platform, function, user type,
-- and rolling 30-day payment tier.
-- Function UV is deduplicated only inside its row and is not additive across functions.
-- Keep '未知' and '未归因' so task and GMV reconciliation remains visible.
-- The week fields are labels only: daily creation_user_cnt is not weekly UV.
-- '未归因' is a GMV attribution bucket, not a creation feature.
-- Keep only leaf rows for both segment dimensions; source summary rows
-- duplicate the same metrics. For a single day and function, group by either
-- segment dimension and sum across the other to drill into it.
-- Source user_type = NEW means registered on stat_date, not within the week.
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
    creation_mode,
    user_type,
    pay_gmv_usd_30d,
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
  AND creation_mode <> '汇总'
  AND user_type <> '汇总'
  AND pay_gmv_usd_30d <> '汇总'
  AND platform_type IN ('WEB', 'IOS', 'ANDROID', 'UNKNOWN', '汇总');
