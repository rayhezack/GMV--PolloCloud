import type { EvidenceRow, EvidenceSource, EvidenceSources, ReportWindow } from './report-evidence.ts';

export type EvidenceQuery = { key: Exclude<keyof EvidenceSources, 'actions'>; source: string; sql: string; binds: string[] };
const nullableSum = (field: string) => `CASE WHEN COUNT(${field})=COUNT(*) THEN SUM(${field}) ELSE NULL END AS ${field}`;
const creationFields = ['creation_task_cnt', 'valid_creation_task_cnt', 'creation_user_cnt', 'success_task_cnt', 'success_output_cnt', 'adopted_task_cnt', 'adopted_output_cnt', 'd3_creation_user_cnt', 'd7_creation_user_cnt', 'd30_creation_user_cnt'];

/** Bounded daily aggregates; no weekly snapshots, cached responses, or legacy funnel fallback. */
export function reportEvidenceQueries(window: ReportWindow): EvidenceQuery[] {
  const { platform, startDate, endDate } = window;
  const mainBinds = [startDate, endDate, platform];
  const tierSelect = window.mode === 'day' ? ',creation_cnt_30d_label' : '';
  const creationWhere = platform === 'web' ? "platform_type='WEB'" : "platform_type IN ('IOS','ANDROID')";
  const creationSelect = creationFields.map(nullableSum).join(',');
  return [
    { key: 'pay', source: 'pollo_da_fact_rows/pay_type/NONE', binds: mainBinds, sql: `SELECT period,week_start,platform,pay_category,pay_type,product_type,SUM(gmv_usd) AS gmv_usd FROM pollo_da_fact_rows_read WHERE period BETWEEN ? AND ? AND platform=? AND dataset='pay_type' AND dataset_kind='daily' AND attribution_type='NONE' AND pay_category IN ('ACTIVE_PAYMENT','AUTO_RENEWAL','API') AND pay_type<>'汇总' GROUP BY period,week_start,platform,pay_category,pay_type,product_type` },
    { key: 'funnel', source: 'pollo_da_chain_funnel', binds: mainBinds, sql: `SELECT period,week_start,platform,country_tier,user_lifecycle${tierSelect},SUM(active_uv) AS active_uv,SUM(paywall_expose_uv) AS expose_uv,SUM(paywall_submit_uv) AS submit_uv,SUM(pay_uv) AS pay_uv,SUM(gmv_usd) AS gmv_usd FROM pollo_da_chain_funnel WHERE period BETWEEN ? AND ? AND platform=? GROUP BY period,week_start,platform,country_tier,user_lifecycle${tierSelect}` },
    { key: 'breakdown', source: 'pollo_da_chain_breakdown', binds: mainBinds, sql: `SELECT period,week_start,platform,country_tier,user_lifecycle${tierSelect},breakdown_type,breakdown_value,SUM(expose_uv) AS expose_uv,SUM(submit_uv) AS submit_uv,SUM(pay_uv) AS pay_uv,SUM(gmv_usd) AS gmv_usd FROM pollo_da_chain_breakdown WHERE period BETWEEN ? AND ? AND platform=? AND breakdown_type IN ('EXPOSE_TYPE','EXPOSE_REASON','SUBMIT_CHANNEL') GROUP BY period,week_start,platform,country_tier,user_lifecycle${tierSelect},breakdown_type,breakdown_value` },
    { key: 'renewal', source: 'pollo_da_fact_rows/renewal', binds: [...mainBinds, platform === 'web' ? 'WEB' : 'APP'], sql: `SELECT period,week_start,platform,platform_type,plan_tier,plan_cycle,${nullableSum('expire_user_cnt')},${nullableSum('renew_user_cnt')},${nullableSum('renew_amount_usd')} FROM pollo_da_fact_rows_read WHERE period BETWEEN ? AND ? AND platform=? AND platform_type=? AND dataset='renewal' AND dataset_kind='daily' GROUP BY period,week_start,platform,platform_type,plan_tier,plan_cycle` },
    { key: 'ads', source: 'pollo_da_ads_daily', binds: mainBinds, sql: `SELECT period,week_start,platform,country,channel,SUM(cost_usd) AS cost_usd,SUM(impressions) AS impressions,SUM(clicks) AS clicks,SUM(register_user_cnt) AS register_user_cnt FROM pollo_da_ads_daily WHERE period BETWEEN ? AND ? AND LOWER(platform)=? GROUP BY period,week_start,platform,country,channel` },
    { key: 'creation', source: 'pollo_da_creation_overall_daily', binds: [startDate, endDate], sql: `SELECT period,week_start,platform_type,${creationSelect} FROM pollo_da_creation_overall_daily WHERE period BETWEEN ? AND ? AND ${creationWhere} GROUP BY period,week_start,platform_type` },
    { key: 'functions', source: 'pollo_da_creation_function_daily', binds: [startDate, endDate], sql: `SELECT period,week_start,platform_type,creation_mode,${creationSelect} FROM pollo_da_creation_function_daily WHERE period BETWEEN ? AND ? AND ${creationWhere} GROUP BY period,week_start,platform_type,creation_mode` },
  ];
}

export async function loadReportSources(window: ReportWindow, io: {
  query: (sql: string, ...binds: string[]) => Promise<EvidenceRow[]>;
  actions: () => Promise<EvidenceSource>;
}): Promise<EvidenceSources> {
  const entries = await Promise.all(reportEvidenceQueries(window).map(async query => {
    let result: EvidenceSource;
    try { result = { source: query.source, status: 'ok', readAt: new Date().toISOString(), rows: await io.query(query.sql, ...query.binds) }; }
    catch { result = { source: query.source, status: 'unavailable', readAt: new Date().toISOString(), rows: [], error: '数据源读取失败，未使用旧口径替代' }; }
    return [query.key, result] as const;
  }));
  let actions: EvidenceSource;
  try { actions = await io.actions(); }
  catch { actions = { source: '飞书 Base/产品动作明细', status: 'unavailable', readAt: new Date().toISOString(), complete: false, rows: [], error: '产品动作读取失败，未用缓存冒充四周检索' }; }
  return { ...Object.fromEntries(entries), actions } as EvidenceSources;
}
