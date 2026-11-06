export type CreationChainKind = 'overall' | 'function';

export function buildCreationChainSql(date: string, kind: CreationChainKind): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('创作链路统计日期无效');
  }
  const partition = date.replace(/-/g, '');
  const week = "CAST(DATEADD(CAST(stat_date AS DATETIME), -CAST(PMOD(WEEKDAY(CAST(stat_date AS DATETIME)) + 2, 7) AS BIGINT), 'dd') AS DATE)";
  const detail = kind === 'function';
  return `
SET odps.sql.type.system.odps2=true;
SELECT stat_date AS period,
  ${week} AS week_start, DATE_ADD(${week}, 6) AS week_end,
  platform_type,${detail ? '\n  creation_mode, user_type, pay_gmv_usd_30d,' : ''}
  creation_task_cnt, valid_creation_task_cnt, creation_user_cnt, success_task_cnt, success_output_cnt,
  adopted_task_cnt, adopted_output_cnt,
  d3_creation_user_cnt, d7_creation_user_cnt, d30_creation_user_cnt,
  gmv_usd, etl_time,
  COUNT(*) OVER() AS source_row_count
FROM mc_prd.ads_pollo_creation_function_chain_daily_dip
WHERE p_date = '${partition}'
  AND stat_date = CAST(TO_DATE('${partition}', 'yyyymmdd') AS DATE)
  AND creation_mode ${detail ? "<>" : "="} '汇总'
  AND user_type ${detail ? "<>" : "="} '汇总'
  AND pay_gmv_usd_30d ${detail ? "<>" : "="} '汇总'
  AND platform_type IN ('WEB', 'IOS', 'ANDROID', 'UNKNOWN', '汇总')
`.trim();
}
