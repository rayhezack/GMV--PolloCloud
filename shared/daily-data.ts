import { isValidDateString } from './business-week.ts';
export type DailyValue = string | number | null;
export type DailyColumn = { key: string; label: string; kind: 'text' | 'count' | 'currency' | 'rate' | 'decimal' };
const c = (key: string, label: string, kind: DailyColumn['kind'] = 'text'): DailyColumn => ({ key, label, kind });
const date = c('period', '日期'),
  platform = c('platform', '端');
export const DAILY_DATASETS = {
  pay_type: {
    label: '付费类型',
    source: 'pollo_da_fact_rows_read / pay_type',
    columns: [
      date,
      platform,
      c('device_type', '设备'),
      c('pay_category', '收入类别'),
      c('pay_type', '付费类型'),
      c('order_equivalent', '订单当量', 'decimal'),
      c('gmv_usd', 'GMV · USD', 'currency'),
    ],
  },
  chain: {
    label: '支付链路',
    source: 'pollo_da_chain_funnel',
    columns: [
      date,
      platform,
      c('device_type', '设备'),
      c('country_tier', '国家层级'),
      c('user_tag', '注册新老'),
      c('creation_cnt_30d', '近30日创作次数'),
      c('active_uv', 'DAU', 'count'),
      c('sub_expose_uv', '付费墙曝光用户', 'count'),
      c('sub_submit_uv', '付费墙提交用户', 'count'),
      c('chain_pay_uv', '支付用户', 'count'),
      c('chain_gmv_usd', '链路GMV · USD', 'currency'),
      c('sub_expose_rate', '曝光率', 'rate'),
      c('sub_submit_rate', '提交率', 'rate'),
      c('chain_pay_success_rate', '提交支付率', 'rate'),
      c('chain_arppu', '客单价 · USD', 'currency'),
    ],
  },
  creative: {
    label: '创作活跃',
    source: 'pollo_da_fact_rows_read / creative',
    columns: [
      date,
      platform,
      c('creation_cnt_30d', '近30日创作次数'),
      c('active_uv', '活跃用户', 'count'),
      c('creation_uv', '创作用户', 'count'),
      c('creation_task_cnt', '创作任务', 'count'),
      c('creation_penetration_rate', '创作渗透率', 'rate'),
      c('avg_creation_task_cnt_per_creator', '人均任务数', 'decimal'),
    ],
  },
  creation_chain: {
    label: '创作任务',
    source: 'pollo_da_creation_overall_daily',
    columns: [
      date,
      c('platform_type', '端类型'),
      c('creation_user_cnt', '创作用户', 'count'),
      c('creation_task_cnt', '创作任务', 'count'),
      c('valid_creation_task_cnt', '已请求任务', 'count'),
      c('success_task_cnt', '成功任务', 'count'),
      c('adopted_task_cnt', '采纳任务', 'count'),
      c('d3_creation_user_cnt', 'D3留存用户', 'count'),
      c('d7_creation_user_cnt', 'D7留存用户', 'count'),
      c('d30_creation_user_cnt', 'D30留存用户', 'count'),
      c('gmv_usd', 'GMV · USD', 'currency'),
    ],
  },
  renewal: {
    label: '自动续订',
    source: 'pollo_da_fact_rows_read / renewal',
    columns: [
      date,
      platform,
      c('platform_type', '端类型'),
      c('plan_tier', '套餐'),
      c('plan_cycle', '周期'),
      c('expire_user_cnt', '到期用户', 'count'),
      c('renew_user_cnt', '续订用户', 'count'),
      c('renew_amount_usd', '续订GMV · USD', 'currency'),
    ],
  },
  ads: {
    label: '付费广告',
    source: 'pollo_da_ads_daily',
    columns: [
      date,
      platform,
      c('channel', '渠道'),
      c('country', '国家'),
      c('cost_usd', '广告成本 · USD', 'currency'),
      c('impressions', '展示量', 'count'),
      c('clicks', '点击量', 'count'),
      c('register_user_cnt', '注册用户', 'count'),
      c('gmv_d0', 'D0 GMV · USD', 'currency'),
      c('gmv_d14', 'D14 GMV · USD', 'currency'),
      c('gmv_d30', 'D30 GMV · USD', 'currency'),
      c('gmv_d60', 'D60 GMV · USD', 'currency'),
      c('gmv_d90', 'D90 GMV · USD', 'currency'),
      c('gmv_d180', 'D180 GMV · USD', 'currency'),
    ],
  },
} as const;
export type DailyDataset = keyof typeof DAILY_DATASETS;
export type DailyDataRequest = {
  dataset: DailyDataset;
  platform: 'all' | 'web' | 'app';
  startDate: string;
  endDate: string;
  search?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
};
export type DailyDataResponse = {
  dataset: DailyDataset;
  fields: DailyColumn[];
  items: Record<string, DailyValue>[];
  total: number;
  page: number;
  pageSize: number;
  source: string;
};
const validDay = (value: string) =>
  isValidDateString(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
export function dailyDataParams(search: URLSearchParams): DailyDataRequest {
  const dataset = search.get('dataset') || 'pay_type',
    platform = search.get('platform') || 'all',
    startDate = search.get('startDate') || '',
    endDate = search.get('endDate') || '';
  if (
    !Object.prototype.hasOwnProperty.call(DAILY_DATASETS, dataset) ||
    !['all', 'web', 'app'].includes(platform) ||
    !validDay(startDate) ||
    !validDay(endDate) ||
    startDate > endDate ||
    (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 366
  )
    throw Error('明细数据筛选无效；日期范围最多367天');
  const fields = DAILY_DATASETS[dataset as DailyDataset].columns;
  const sort = search.get('sort') || 'period';
  if (!fields.some((c) => c.key === sort)) throw Error('明细排序字段无效');
  const page = Number(search.get('page') || 1),
    pageSize = Number(search.get('pageSize') || 50);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200)
    throw Error('明细分页参数无效');
  return {
    dataset: dataset as DailyDataset,
    platform: platform as DailyDataRequest['platform'],
    startDate,
    endDate,
    search: (search.get('search') || '').slice(0, 100),
    sort,
    direction: search.get('direction') === 'asc' ? 'asc' : 'desc',
    page,
    pageSize,
  };
}
/** Project only dataset fields. Preserve null; numeric sorting uses source precision. */
export function dailyDataPage(rows: Record<string, unknown>[], params: DailyDataRequest): DailyDataResponse {
  const config = DAILY_DATASETS[params.dataset],
    fields = [...config.columns];
  const search = (params.search || '').toLocaleLowerCase();
  const numeric = fields.find((c) => c.key === params.sort)?.kind !== 'text';
  const projected = rows
    .map((row) => Object.fromEntries(fields.map((c) => [c.key, row[c.key] ?? null])) as Record<string, DailyValue>)
    .filter(
      (row) =>
        !search ||
        Object.values(row).some((value) => value != null && String(value).toLocaleLowerCase().includes(search)),
    );
  projected.sort((a, b) => {
    const key = params.sort || 'period',
      x = a[key],
      y = b[key];
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
    const delta = numeric ? Number(x) - Number(y) : String(x).localeCompare(String(y));
    return (params.direction === 'asc' ? delta : -delta) || String(b.period).localeCompare(String(a.period));
  });
  const pageSize = params.pageSize || 50,
    page = Math.min(params.page || 1, Math.max(1, Math.ceil(projected.length / pageSize)));
  return {
    dataset: params.dataset,
    source: config.source,
    fields,
    items: projected.slice((page - 1) * pageSize, page * pageSize),
    total: projected.length,
    page,
    pageSize,
  };
}
