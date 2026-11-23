import { dailyDataParams, dailyDataPage } from '../shared/daily-data.ts';
type Row = Record<string, string | number | null>;
type Query = (sql: string, ...binds: unknown[]) => Promise<Row[]>;
/** A read-only explorer over the same sources the analysis pages use. */
export async function readDailyData(
  search: URLSearchParams,
  query: Query,
  readExisting: (
    table: 'pay_type_daily' | 'chain_daily' | 'creative_daily' | 'renewal_daily',
    params: { platform: string; startDate: string; endDate: string },
  ) => Promise<Row[]>,
) {
  const params = dailyDataParams(search);
  let rows: Row[];
  if (params.dataset === 'pay_type') {
    // The table exposes payment-result dimensions only. Aggregate hidden SKU /
    // attribution dimensions in SQL; never transport fields_json to paginate.
    rows = await query(
      `SELECT period,platform,device_type,pay_category,pay_type,
      CASE WHEN COUNT(order_equivalent)=COUNT(*) THEN SUM(order_equivalent) ELSE NULL END AS order_equivalent,
      CASE WHEN COUNT(gmv_usd)=COUNT(*) THEN SUM(gmv_usd) ELSE NULL END AS gmv_usd
      FROM pollo_da_fact_rows_read WHERE dataset='pay_type' AND dataset_kind='daily' AND platform=? AND period BETWEEN ? AND ?
      AND (attribution_type IS NULL OR (attribution_type='NONE' AND pay_category IN ('ACTIVE_PAYMENT','AUTO_RENEWAL','API') AND pay_type<>'汇总'))
      GROUP BY period,platform,device_type,pay_category,pay_type`,
      params.platform,
      params.startDate,
      params.endDate,
    );
  } else if (params.dataset === 'ads') {
    rows = await query(
      `SELECT period,platform,channel,country,cost_usd,impressions,clicks,register_user_cnt,gmv_d0,gmv_d14,gmv_d30,gmv_d60,gmv_d90,gmv_d180 FROM pollo_da_ads_daily WHERE period BETWEEN ? AND ?${params.platform === 'all' ? '' : ' AND LOWER(platform)=?'}`,
      params.startDate,
      params.endDate,
      ...(params.platform === 'all' ? [] : [params.platform]),
    );
  } else if (params.dataset === 'creation_chain') {
    const scope =
      params.platform === 'all'
        ? "platform_type='汇总'"
        : params.platform === 'web'
          ? "platform_type='WEB'"
          : "platform_type IN ('IOS','ANDROID')";
    const columns = await query('PRAGMA table_info(pollo_da_creation_overall_daily)');
    const valid = columns.some((c) => c.name === 'valid_creation_task_cnt')
      ? 'valid_creation_task_cnt'
      : 'NULL AS valid_creation_task_cnt';
    rows = await query(
      `SELECT period,platform_type,creation_user_cnt,creation_task_cnt,${valid},success_task_cnt,adopted_task_cnt,d3_creation_user_cnt,d7_creation_user_cnt,d30_creation_user_cnt,gmv_usd FROM pollo_da_creation_overall_daily WHERE period BETWEEN ? AND ? AND ${scope}`,
      params.startDate,
      params.endDate,
    );
  } else {
    rows = await readExisting(`${params.dataset}_daily`, {
      platform: params.platform,
      startDate: params.startDate,
      endDate: params.endDate,
    });
  }
  return dailyDataPage(
    rows.filter((row) => row.dataset_kind == null || row.dataset_kind === 'daily'),
    params,
  );
}
