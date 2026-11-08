import { buildChainFunnelSql } from './chain-funnel-sql';
import { buildMiddleTableSql } from './middle-table-sql';

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

function buildCreationPlatformCondition(platform: string): string {
  if (platform === 'web') return "app_platform = 'web'";
  if (platform === 'all') return '1 = 1';
  return "app_platform IN ('android', 'ios')";
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
  const eventPlatformCondition = buildEventPlatformCondition(platform);
  const creationPlatformCondition = buildCreationPlatformCondition(platform);
  const renewalPlatformCondition = buildRenewalPlatformCondition(platform);
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
    SUM(renew_same_day_amount_usd) AS renew_amount_usd,
    COUNT(*) OVER() AS source_row_count
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
    case 'chain':
      if (params.granularity === 'weekly') throw new Error('链路只同步日表，周指标由日表聚合');
      return buildChainFunnelSql(platform, params.start, params.end);
    case 'pay_type':
      if (params.granularity === 'weekly') throw new Error('ADS 口径只同步日表，周指标由日表聚合');
      return buildMiddleTableSql(dataset, platform, startKey, endKey);
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
    creation_task_cnt * 1.0000 / NULLIF(active_uv, 0) AS avg_creation_task_cnt_per_creator,
    COUNT(*) OVER() AS source_row_count
FROM daily_metric
ORDER BY
    period,
    creation_cnt_30d_level_id
`.trim();
    default:
      throw new Error(`未知数据集：${dataset}`);
  }
}
