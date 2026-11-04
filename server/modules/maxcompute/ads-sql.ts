// Advertising cohorts are keyed by acquisition date; retain daily grain for business-week rollups.
export function buildAdsSql(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('广告统计日期无效');
  }
  const partition = date.replace(/-/g, '');
  const week = "CAST(DATEADD(CAST(stat_date AS DATETIME), -CAST(PMOD(WEEKDAY(CAST(stat_date AS DATETIME)) + 2, 7) AS BIGINT), 'dd') AS DATE)";
  return `
SET odps.sql.type.system.odps2=true;
SELECT CAST(stat_date AS DATE) AS period,
  ${week} AS week_start, DATE_ADD(${week}, 6) AS week_end,
  UPPER(ad_platform) AS channel, UPPER(country) AS country,
  UPPER(source_end) AS platform,
  SUM(COALESCE(cost_usd, 0)) AS cost_usd,
  SUM(COALESCE(impressions, 0)) AS impressions,
  SUM(COALESCE(clicks, 0)) AS clicks,
  SUM(COALESCE(cohort_user_cnt, 0)) AS register_user_cnt,
  SUM(COALESCE(gmv_usd_d0, 0)) AS gmv_d0,
  SUM(gmv_usd_d14) AS gmv_d14,
  SUM(gmv_usd_d30) AS gmv_d30,
  SUM(gmv_usd_d60) AS gmv_d60,
  SUM(gmv_usd_d90) AS gmv_d90,
  SUM(gmv_usd_d180) AS gmv_d180,
  COUNT(*) OVER() AS source_row_count
FROM mc_prd.ads_pollo_ad_attribution_daily_dip
WHERE p_date = '${partition}' AND stat_date = CAST(TO_DATE('${partition}', 'yyyymmdd') AS DATE)
  AND product_type = 'ALL' AND is_first_purchase = '汇总'
GROUP BY stat_date, UPPER(ad_platform), UPPER(country), UPPER(source_end)
`.trim();
}
