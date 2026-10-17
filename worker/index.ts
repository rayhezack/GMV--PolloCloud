import { chainDriverEffects } from './chain-attribution';
/* Pollocloud Worker: D1 stores analytical facts; Base keeps task records for bot notifications. */

import { MaxComputeClient } from '../server/modules/maxcompute/maxcompute.client';
import { buildDatasetSql, type DatasetKind } from '../server/modules/maxcompute/sql-templates';
import { POLLOCLOUD_APP_OWNER_ID } from '../shared/auth.constants';
import { executeReport, reportGenerations } from './report-jobs';
import type { DashboardAttributionsResponse, ReportGenerationRequest, ReportGenerationStatus, ReportSummary, AttributionItem, AttributionDriverItem, SyncDataset, SyncMode, SyncRunStatus } from '../shared/api.interface';

type D1Row = Record<string, string | number | null>;
type D1Result<T> = { results: T[] };
type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  all: <T = D1Row>() => Promise<D1Result<T>>;
  first: <T = D1Row>() => Promise<T | null>;
  run: () => Promise<unknown>;
};
type D1Database = {
  prepare: (sql: string) => D1Statement;
  batch?: (statements: D1Statement[]) => Promise<unknown>;
};
export type Env = {
  DB?: D1Database;
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  MAXCOMPUTE_ENDPOINT?: string;
  MAXCOMPUTE_PROJECT?: string;
  MAXCOMPUTE_ACCESS_KEY_ID?: string;
  MAXCOMPUTE_ACCESS_KEY_SECRET?: string;
  KIMI_API_KEY?: string;
  KIMI_BASE_URL?: string;
  KIMI_MODEL?: string;
};

type BaseSheet =
  | 'pay_type_daily'
  | 'chain_daily'
  | 'creative_daily'
  | 'renewal_daily'
  | 'run_log'
  | 'latest_report'
  | 'report_history'
  | 'report_generation_jobs'
  | 'product_actions';

type BaseRecord = { id: string; fields: D1Row };

const FEISHU_BASE_APP_TOKEN = 'OjCAbXDNbavIU9seAzVcqUHanHg';
const BASE_TABLES: Record<BaseSheet, string> = {
  pay_type_daily: 'tbl4Yg1C7ZsB5W2s',
  chain_daily: 'tblOlmUDP6sa0nJG',
  creative_daily: 'tblFyhw0B7nadRem',
  renewal_daily: 'tbl1jogj5BV4AGT5',
  run_log: 'tblly0M5rJNVZxBL',
  latest_report: 'tblkMF9YKTeh6ZQh',
  report_history: 'tblEOM975aE7DlgR',
  report_generation_jobs: 'tblLAhVBHDYaJt50',
  product_actions: 'tblNJGIo2su7HMF8',
};
const BASE_CACHE_TTL_MS = 5 * 60_000;
const DASHBOARD_CACHE_TTL_MS = 10 * 60_000;
const DASHBOARD_STALE_TTL_MS = 60 * 60_000;
let feishuTokenCache: { token: string; expiresAt: number } | null = null;
const baseCache = new Map<string, { expiresAt: number; records: BaseRecord[] }>();
const baseLoads = new Map<string, Promise<BaseRecord[]>>();
const dashboardLoads = new Map<string, Promise<Response>>();

const WEEK_DAYS = 7;
const REPORT_PLATFORMS = new Set(['web', 'app']);
const DASHBOARD_PLATFORMS = new Set(['all', 'web', 'app']);
const FULL_REFRESH_START_DATE = '2026-01-01';
const STAGING_CHUNK_SIZE = 250;
const TABLES = new Set([
  'pay_type_daily',
  'chain_daily',
  'creative_daily',
  'renewal_daily',
  'run_log',
  'latest_report',
  'report_history',
  'report_generation_jobs',
  'product_actions',
]);
const RENEWAL_PAY_TYPE = '自动续订';
const TIER_ORDER = [
  'create_cnt_30d_0',
  'create_cnt_30d_[1,11)',
  'create_cnt_30d_[11,31)',
  'create_cnt_30d_[31,101)',
  'create_cnt_30d_[101,+inf)',
];
const USER_TAG_ORDER = ['新用户', '老用户', '未知'];
const DAILY_SHEETS = new Set(['pay_type_daily', 'chain_daily', 'creative_daily', 'renewal_daily']);
const FACT_DATASETS = new Set(['pay_type', 'chain', 'creative', 'renewal']);
const FACT_NUMERIC_COLUMNS = [
  'creation_cnt_30d_level_id', 'active_uv', 'creation_uv', 'creation_task_cnt',
  'creation_penetration_rate', 'avg_creation_task_cnt_per_creator', 'sub_expose_uv',
  'sub_submit_uv', 'chain_pay_uv', 'chain_gmv_usd', 'sub_expose_rate',
  'sub_submit_rate', 'chain_pay_success_rate', 'chain_arppu', 'expire_user_cnt',
  'renew_user_cnt', 'renew_amount_usd', 'pay_user_cnt', 'gmv_usd',
] as const;
const FACT_VALUE_COLUMNS = [
  'dataset', 'source_record_id', 'period', 'week_start', 'week_end', 'platform',
  'device_type', 'platform_type', 'dataset_kind', 'analysis_level', 'pay_type',
  'function_name', 'user_tag', 'subscription_tier', 'creation_cnt_30d_level_id', 'creation_cnt_30d',
  'plan_tier', 'plan_cycle', 'active_uv', 'creation_uv', 'creation_task_cnt',
  'creation_penetration_rate', 'avg_creation_task_cnt_per_creator', 'sub_expose_uv',
  'sub_submit_uv', 'chain_pay_uv', 'chain_gmv_usd', 'sub_expose_rate',
  'sub_submit_rate', 'chain_pay_success_rate', 'chain_arppu', 'expire_user_cnt',
  'renew_user_cnt', 'renew_amount_usd', 'pay_user_cnt', 'gmv_usd',
  'fields_json', 'updated_at',
] as const;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });

const errorResponse = (message: string, status = 400) =>
  json({ error: message }, status);

async function cachedDashboardResponse(env: Env, request: Request, context: { waitUntil(promise: Promise<unknown>): void }, load: () => Promise<Response>): Promise<Response> {
  if (!env.DB) return load();
  const url = new URL(request.url);
  url.searchParams.sort();
  const key = `v2:${url.pathname}?${url.searchParams}`;
  const refresh = () => {
    const pending = dashboardLoads.get(key);
    if (pending) return pending;
    const task = (async () => {
      const response = await load();
      if (response.ok) {
        const payload = await response.clone().text();
        await env.DB!.prepare('INSERT OR REPLACE INTO dashboard_response_cache (cache_key, payload, expires_at) VALUES (?, ?, ?)')
          .bind(key, payload, Date.now() + DASHBOARD_CACHE_TTL_MS).run().catch(() => undefined);
      }
      return response;
    })();
    dashboardLoads.set(key, task);
    void task.finally(() => dashboardLoads.delete(key)).catch(() => undefined);
    return task;
  };
  try {
    const cached = await env.DB.prepare('SELECT payload, expires_at FROM dashboard_response_cache WHERE cache_key = ?')
      .bind(key).first<{ payload: string; expires_at: number }>();
    if (cached && cached.expires_at > Date.now()) return json(JSON.parse(cached.payload));
    if (cached && cached.expires_at + DASHBOARD_STALE_TTL_MS > Date.now()) {
      context.waitUntil(refresh().then(() => undefined).catch(() => undefined));
      return json(JSON.parse(cached.payload));
    }
  } catch {
    // Serve from Base if the cache table has not been initialized yet.
  }
  return (await refresh()).clone();
}

async function invalidateDashboardCache(env: Env) {
  if (env.DB) await env.DB.prepare('DELETE FROM dashboard_response_cache').run().catch(() => undefined);
}

export async function authorizeDashboardMutation(request: Request): Promise<Response | null> {
  // Pollo Cloud verifies these identity headers before forwarding to the Worker.
  // Worker-to-app fetches do not retain the browser's platform login context.
  if (request.headers.get('x-pollocloud-user-id') === POLLOCLOUD_APP_OWNER_ID) return null;
  const url = new URL('/_pollocloud/me', request.url);
  let identity: Response;
  try {
    identity = await fetch(url, {
      headers: {
        cookie: request.headers.get('cookie') || '',
        authorization: request.headers.get('authorization') || '',
      },
      redirect: 'manual',
    });
  } catch {
    return errorResponse('无法验证登录状态，请稍后重试', 503);
  }
  if (!identity.ok) return errorResponse('请先登录', 401);
  const payload = await identity.json().catch(() => null) as Record<string, unknown> | null;
  const nested = payload?.user ?? payload?.data;
  const nestedUser = nested && typeof nested === 'object'
    ? (nested as Record<string, unknown>).user ?? nested
    : nested;
  const user = nestedUser && typeof nestedUser === 'object'
    ? nestedUser as Record<string, unknown>
    : payload;
  const userId = user?.userId ?? user?.user_id ?? user?.openId ?? user?.open_id ?? user?.id;
  if (!userId) return errorResponse('无法识别 Pollo Cloud 账号', 401);
  const role = user?.role ?? user?.myRole ?? user?.my_role;
  const isAdmin = user?.isAdmin === true || user?.is_admin === true;
  if (
    String(userId) !== POLLOCLOUD_APP_OWNER_ID &&
    !isAdmin &&
    !['owner', 'admin', 'editor'].includes(String(role ?? ''))
  ) {
    return errorResponse('当前账号没有更新权限', 403);
  }
  return null;
}

const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asText = (value: unknown) => (value == null ? '' : String(value));

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const average = (values: number[]) => (values.length ? sum(values) / values.length : 0);

const readBaseValue = (value: unknown): string | number | null => {
  if (value == null || typeof value === 'string' || typeof value === 'number') return value as string | number | null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Array.isArray(value)) return value.map(readBaseValue).filter((item) => item != null).join('');
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return readBaseValue(object.text ?? object.name ?? object.value ?? '');
  }
  return String(value);
};

const normalizeBaseFields = (fields: Record<string, unknown>): D1Row =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, readBaseValue(value)]));

async function tenantAccessToken(env: Env): Promise<string> {
  if (feishuTokenCache && feishuTokenCache.expiresAt > Date.now()) return feishuTokenCache.token;
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) throw new Error('飞书应用凭证未配置');
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const payload = await response.json() as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) throw new Error(`飞书令牌获取失败：${payload.msg || response.status}`);
  feishuTokenCache = {
    token: payload.tenant_access_token,
    expiresAt: Date.now() + Math.max(60, (payload.expire ?? 7200) - 300) * 1000,
  };
  return payload.tenant_access_token;
}

async function baseRequest<T>(env: Env, sheet: BaseSheet, path: string, body?: unknown, method = 'POST'): Promise<T> {
  const token = await tenantAccessToken(env);
  const init: RequestInit = {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const response = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_BASE_APP_TOKEN}/tables/${BASE_TABLES[sheet]}${path}`,
    init,
  );
  const payload = await response.json() as { code?: number; msg?: string; data?: T };
  if (!response.ok || payload.code !== 0) throw new Error(`Base ${sheet} 请求失败：${payload.msg || response.status}`);
  return (payload.data ?? {}) as T;
}

type BaseReadOptions = {
  filter?: string;
  sort?: string[];
  limit?: number;
  fields?: string[];
};

function invalidateBaseCache(sheet?: BaseSheet) {
  if (!sheet) {
    baseCache.clear();
    return;
  }
  for (const key of baseCache.keys()) {
    if (key.startsWith(`${sheet}|`)) baseCache.delete(key);
  }
}

async function baseRecords(
  env: Env,
  sheet: BaseSheet,
  fresh = false,
  options: BaseReadOptions = {},
): Promise<BaseRecord[]> {
  const cacheKey = `${sheet}|${options.filter ?? '*'}|${JSON.stringify(options.sort ?? [])}|${options.limit ?? '*'}|${JSON.stringify(options.fields ?? [])}`;
  const cached = baseCache.get(cacheKey);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.records;
  const pending = baseLoads.get(cacheKey);
  if (!fresh && pending) return pending;

  const load = (async () => {
    const records: BaseRecord[] = [];
    let pageToken: string | undefined;
    do {
      const pageSize = Math.min(500, options.limit ?? 500);
      const query = new URLSearchParams({ page_size: String(pageSize) });
      if (pageToken) query.set('page_token', pageToken);
      if (options.filter) query.set('filter', options.filter);
      if (options.sort?.length) query.set('sort', JSON.stringify(options.sort));
      if (options.fields?.length) query.set('field_names', JSON.stringify(options.fields));
      const usesListApi = Boolean(options.filter || options.sort?.length);
      const data = await baseRequest<{
        items?: Array<{ record_id: string; fields: Record<string, unknown> }>;
        has_more?: boolean;
        page_token?: string;
      }>(
        env,
        sheet,
        `/${usesListApi ? 'records' : 'records/search'}?${query}`,
        usesListApi ? undefined : options.fields ? { field_names: options.fields } : {},
        usesListApi ? 'GET' : 'POST',
      );
      records.push(...(data.items ?? []).map((item) => ({ id: item.record_id, fields: normalizeBaseFields(item.fields) })));
      if (options.limit && records.length >= options.limit) break;
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);
    const result = options.limit ? records.slice(0, options.limit) : records;
    baseCache.set(cacheKey, { expiresAt: Date.now() + BASE_CACHE_TTL_MS, records: result });
    return result;
  })();

  baseLoads.set(cacheKey, load);
  try {
    return await load;
  } finally {
    if (baseLoads.get(cacheKey) === load) baseLoads.delete(cacheKey);
  }
}

const escapeBaseFormulaValue = (value: string) =>
  value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');

export function buildBaseFilterFormula(params: {
  platform?: string;
  startDate?: string;
  endDate?: string;
  deviceType?: string;
}) {
  const conditions = [
    params.platform
      ? `CurrentValue.[platform]="${escapeBaseFormulaValue(params.platform)}"`
      : '',
    params.startDate
      ? `CurrentValue.[period]>="${escapeBaseFormulaValue(params.startDate)}"`
      : '',
    params.endDate
      ? `CurrentValue.[period]<="${escapeBaseFormulaValue(params.endDate)}"`
      : '',
    params.deviceType
      ? `CurrentValue.[device_type]="${escapeBaseFormulaValue(params.deviceType)}"`
      : '',
  ].filter(Boolean);
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : `AND(${conditions.join(',')})`;
}

const dateInRange = (value: string, start: string, end: string) =>
  value >= start && value <= end;

const normalizePayType = (value: string) => {
  const labels: Record<string, string> = {
    主动订阅: '主动付费',
    自动续费: '自动续订',
    会员订阅: '首订',
    升级: '套餐升级',
    其他主动付费: '积分包',
    复购: '重新订阅',
  };
  return labels[value] || value;
};

const tierRank = (key: string) => {
  const known = TIER_ORDER.indexOf(key);
  if (known >= 0) return known;
  const lower = Number(key.match(/\[(\d+),/u)?.[1]);
  return Number.isFinite(lower) ? lower : Number.MAX_SAFE_INTEGER;
};

const tierKey = (row: D1Row) => asText(row.creation_cnt_30d) || TIER_ORDER[Number(row.creation_cnt_30d_level_id) || 0] || '';

const queryRows = async <T extends D1Row = D1Row>(
  env: Env,
  sql: string,
  ...binds: unknown[]
): Promise<T[]> => {
  if (!env.DB) throw new Error('D1 未配置');
  const result = await env.DB.prepare(sql).bind(...binds).all<T>();
  return result.results || [];
};

const factDataset = (table: string) => table.replace(/_daily$/u, '');

function factSourceId(dataset: string, row: D1Row) {
  const sourceId = asText(row.source_record_id);
  if (sourceId) return sourceId;
  const identity = [
    row.period, row.week_start, row.week_end, row.platform, row.device_type,
    row.dataset_kind, row.analysis_level, row.pay_type, row.function_name,
    row.user_tag, row.creation_cnt_30d_level_id, row.creation_cnt_30d,
    row.platform_type, row.plan_tier, row.plan_cycle, row.subscription_tier,
  ].map(value => asText(value)).join('|');
  return identity || crypto.randomUUID();
}

function factValues(dataset: string, row: D1Row, now = Date.now()) {
  const values: Record<string, unknown> = {
    dataset,
    source_record_id: factSourceId(dataset, row),
    period: asText(row.period),
    week_start: asText(row.week_start) || null,
    week_end: asText(row.week_end) || null,
    platform: asText(row.platform) || null,
    device_type: asText(row.device_type) || null,
    platform_type: asText(row.platform_type) || null,
    dataset_kind: asText(row.dataset_kind) || 'daily',
    analysis_level: asText(row.analysis_level) || null,
    pay_type: asText(row.pay_type) || null,
    function_name: asText(row.function_name) || null,
    user_tag: asText(row.user_tag) || null,
    subscription_tier: asText(row.subscription_tier) || null,
    creation_cnt_30d_level_id: null,
    creation_cnt_30d: asText(row.creation_cnt_30d) || null,
    plan_tier: asText(row.plan_tier) || null,
    plan_cycle: asText(row.plan_cycle) || null,
    fields_json: JSON.stringify(row),
    updated_at: now,
  };
  FACT_NUMERIC_COLUMNS.forEach((column) => {
    values[column] = row[column] == null || row[column] === '' ? null : asNumber(row[column]);
  });
  return FACT_VALUE_COLUMNS.map(column => values[column]);
}

const FACT_INSERT_SQL = `INSERT OR REPLACE INTO pollo_da_fact_rows (${FACT_VALUE_COLUMNS.join(', ')}) VALUES (${FACT_VALUE_COLUMNS.map(() => '?').join(', ')})`;

async function writeFactRows(env: Env, dataset: string, rows: D1Row[]) {
  if (!env.DB) throw new Error('D1 未配置');
  const statements = rows.map(row => env.DB!.prepare(FACT_INSERT_SQL).bind(...factValues(dataset, row)));
  for (let index = 0; index < statements.length; index += 50) {
    const batch = statements.slice(index, index + 50);
    if (env.DB.batch) await env.DB.batch(batch);
    else for (const statement of batch) await statement.run();
  }
  return rows.length;
}

async function clearFactRange(env: Env, dataset: string, startDate: string, endDate: string, platform?: string) {
  if (!env.DB) throw new Error('D1 未配置');
  const statement = platform
    ? env.DB.prepare('DELETE FROM pollo_da_fact_rows WHERE dataset = ? AND period >= ? AND period <= ? AND platform = ?').bind(dataset, startDate, endDate, platform)
    : env.DB.prepare('DELETE FROM pollo_da_fact_rows WHERE dataset = ? AND period >= ? AND period <= ?').bind(dataset, startDate, endDate);
  await statement.run();
}

async function replaceFactRange(env: Env, dataset: string, platform: string, startDate: string, endDate: string, rows: D1Row[]) {
  await clearFactRange(env, dataset, startDate, endDate, platform);
  return writeFactRows(env, dataset, rows);
}

async function dailyRows(env: Env, table: 'pay_type_daily' | 'chain_daily' | 'creative_daily' | 'renewal_daily', params: {
  platform?: string;
  startDate?: string;
  endDate?: string;
  deviceType?: string;
}) {
  const conditions = ['dataset = ?'];
  const binds: unknown[] = [factDataset(table)];
  if (params.platform) { conditions.push('platform = ?'); binds.push(params.platform); }
  if (params.startDate) { conditions.push('period >= ?'); binds.push(params.startDate); }
  if (params.endDate) { conditions.push('period <= ?'); binds.push(params.endDate); }
  if (params.deviceType) { conditions.push('device_type = ?'); binds.push(params.deviceType); }
  return queryRows(env, `SELECT * FROM pollo_da_fact_rows WHERE ${conditions.join(' AND ')} ORDER BY period`, ...binds);
}

async function latestDailyPeriod(
  env: Env,
  table: 'pay_type_daily' | 'chain_daily' | 'creative_daily' | 'renewal_daily',
) {
  const row = await env.DB!.prepare('SELECT MAX(period) AS period FROM pollo_da_fact_rows WHERE dataset = ?')
    .bind(factDataset(table)).first<{ period: string | null }>();
  return row?.period || '';
}

function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function weekDayCounts(rows: D1Row[]) {
  const weeks = new Map<string, Set<string>>();
  for (const row of rows) {
    const week = asText(row.week_start);
    const period = asText(row.period);
    if (!week || !period) continue;
    const dates = weeks.get(week) || new Set<string>();
    dates.add(period);
    weeks.set(week, dates);
  }
  return new Map([...weeks].map(([week, dates]) => [week, Math.min(WEEK_DAYS, dates.size)]));
}

function alignComparisonWeekdays(
  rows: D1Row[],
  baselinePeriod?: string,
  analysisPeriod?: string,
) {
  if (!baselinePeriod || !analysisPeriod) return rows;
  const dayOffset = (row: D1Row) => {
    const period = Date.parse(`${asText(row.period)}T00:00:00Z`);
    const week = Date.parse(`${asText(row.week_start)}T00:00:00Z`);
    return Math.round((period - week) / 86_400_000);
  };
  const analysisOffsets = new Set(
    rows
      .filter((row) => asText(row.week_start) === analysisPeriod)
      .map(dayOffset),
  );
  if (analysisOffsets.size === 0) return rows;
  return rows.filter((row) => {
    const week = asText(row.week_start);
    return (
      (week !== baselinePeriod && week !== analysisPeriod) ||
      analysisOffsets.has(dayOffset(row))
    );
  });
}

function sumChain(rows: D1Row[]) {
  return {
    activeUv: sum(rows.map((row) => asNumber(row.active_uv))),
    subExposeUv: sum(rows.map((row) => asNumber(row.sub_expose_uv))),
    subSubmitUv: sum(rows.map((row) => asNumber(row.sub_submit_uv))),
    chainPayUv: sum(rows.map((row) => asNumber(row.chain_pay_uv))),
    chainGmvUsd: sum(rows.map((row) => asNumber(row.chain_gmv_usd))),
  };
}

function chainMetrics(row: ReturnType<typeof sumChain>) {
  return {
    activeUv: row.activeUv,
    subExposeUv: row.subExposeUv,
    subExposeRate: row.activeUv ? row.subExposeUv / row.activeUv : 0,
    subSubmitUv: row.subSubmitUv,
    subSubmitRate: row.subExposeUv ? row.subSubmitUv / row.subExposeUv : 0,
    chainPayUv: row.chainPayUv,
    chainPaySuccessRate: row.subSubmitUv ? row.chainPayUv / row.subSubmitUv : 0,
    chainArppu: row.chainPayUv ? row.chainGmvUsd / row.chainPayUv : 0,
  };
}

function renewalPlatformRows(rows: D1Row[], platform: string, deviceType?: string) {
  if (platform === 'all') return rows;
  const platformType = platform === 'web' ? 'WEB' : deviceType ? deviceType.toUpperCase() : 'APP';
  return rows.filter((row) => asText(row.platform_type).toUpperCase() === platformType);
}

const RENEWAL_DRIVER_DEFINITIONS = [
  ['expireUserCnt', '到期用户数'],
  ['renewalRate', '续订率'],
  ['renewalAov', '续订客单价'],
] as const;

function renewalFactors(rows: D1Row[], days: number) {
  const totals = sumRenewal(rows);
  return {
    expireUserCnt: totals.expireUserCnt / days,
    renewalRate: totals.expireUserCnt ? totals.renewUserCnt / totals.expireUserCnt : 0,
    renewalAov: totals.renewUserCnt ? totals.renewAmountUsd / totals.renewUserCnt : 0,
  };
}

function renewalDriverEffects(
  previous: ReturnType<typeof renewalFactors>,
  current: ReturnType<typeof renewalFactors>,
) {
  const keys = RENEWAL_DRIVER_DEFINITIONS.map(([key]) => key);
  const permutations = [
    [keys[0], keys[1], keys[2]],
    [keys[0], keys[2], keys[1]],
    [keys[1], keys[0], keys[2]],
    [keys[1], keys[2], keys[0]],
    [keys[2], keys[0], keys[1]],
    [keys[2], keys[1], keys[0]],
  ];
  const multiply = (factors: typeof previous) =>
    keys.reduce((product, key) => product * factors[key], 1);
  const effects = { expireUserCnt: 0, renewalRate: 0, renewalAov: 0 };
  for (const permutation of permutations) {
    const state = { ...previous };
    for (const key of permutation) {
      const before = multiply(state);
      state[key] = current[key];
      effects[key] += multiply(state) - before;
    }
  }
  keys.forEach((key) => { effects[key] /= permutations.length; });
  return effects;
}

function sumRenewal(rows: D1Row[]) {
  return {
    expireUserCnt: sum(rows.map((row) => asNumber(row.expire_user_cnt))),
    renewUserCnt: sum(rows.map((row) => asNumber(row.renew_user_cnt))),
    renewAmountUsd: sum(rows.map((row) => asNumber(row.renew_amount_usd))),
  };
}

function isActivePayDetailRow(row: D1Row) {
  return normalizePayType(asText(row.pay_type)) !== RENEWAL_PAY_TYPE && Boolean(asText(row.function_name));
}

function activePayDetailRows(rows: D1Row[]) {
  return rows.filter(isActivePayDetailRow);
}

function buildComparison(rows: D1Row[], startDate: string, endDate: string, baseline?: string, analysis?: string) {
  const dayCounts = weekDayCounts(rows);
  const available = [...dayCounts.keys()].filter((week) => dateInRange(week, startDate, endDate)).sort();
  const all = [...dayCounts.keys()].sort();
  const candidates = available.length >= 2 ? available : all.filter((week) => week <= endDate);
  const current = analysis || candidates.at(-1);
  const previous = baseline || candidates.at(-2);
  if (!current || !previous) return null;
  return {
    baselinePeriod: previous,
    analysisPeriod: current,
    periodDays: dayCounts.get(current) || WEEK_DAYS,
    baselinePeriodDays: dayCounts.get(previous) || WEEK_DAYS,
    analysisPeriodDays: dayCounts.get(current) || WEEK_DAYS,
    dayCounts,
  };
}

function attributionItem(params: {
  key: string;
  value: number;
  previousValue: number;
  metrics?: Record<string, number>;
  previousMetrics?: Record<string, number>;
  contributionDenominator?: number;
  dailyAverage?: boolean;
  baselineDays: number;
  analysisDays: number;
}) {
  const dailyAverage = params.dailyAverage !== false;
  const analysisDailyAvg = dailyAverage ? params.value / params.analysisDays : params.value;
  const baselineDailyAvg = dailyAverage ? params.previousValue / params.baselineDays : params.previousValue;
  const change = params.value - params.previousValue;
  const delta = analysisDailyAvg - baselineDailyAvg;
  return {
    key: params.key,
    value: params.value,
    previousValue: params.previousValue,
    change,
    analysisDailyAvg,
    baselineDailyAvg,
    wowChange: baselineDailyAvg ? delta / baselineDailyAvg : null,
    contribution: params.contributionDenominator ? (dailyAverage ? delta : change) / params.contributionDenominator : null,
    metrics: params.metrics || {},
    previousMetrics: params.previousMetrics || {},
  };
}

function aggregatePay(rows: D1Row[], filter: (row: D1Row) => boolean) {
  const values = new Map<string, number>();
  for (const row of rows.filter(filter)) {
    const key = normalizePayType(asText(row.pay_type));
    values.set(key, (values.get(key) || 0) + asNumber(row.gmv_usd));
  }
  return values;
}

function aggregateChainBy(rows: D1Row[], keyOf: (row: D1Row) => string) {
  const values = new Map<string, D1Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const group = values.get(key) || [];
    group.push(row);
    values.set(key, group);
  }
  return values;
}

function aggregateCreativeBy(rows: D1Row[]) {
  const values = new Map<string, D1Row[]>();
  for (const row of rows) {
    const key = tierKey(row);
    if (!key) continue;
    const group = values.get(key) || [];
    group.push(row);
    values.set(key, group);
  }
  return values;
}

function creativeMetrics(rows: D1Row[], days: number) {
  const activeUv = sum(rows.map((row) => asNumber(row.active_uv))) / days;
  const creationUv = sum(rows.map((row) => asNumber(row.creation_uv))) / days;
  const creationTaskCnt = sum(rows.map((row) => asNumber(row.creation_task_cnt))) / days;
  return {
    activeUv,
    creationUv,
    creationTaskCnt,
    creationPenetrationRate: activeUv ? creationUv / activeUv : 0,
    avgCreationTaskCntPerCreator: activeUv ? creationTaskCnt / activeUv : 0,
  };
}

function payTrend(rows: D1Row[], periods: string[], days: Map<string, number>) {
  return periods.map((period) => {
    const group = rows.filter((row) => asText(row.period) === period);
    const divisor = days.get(period) || 1;
    const primary = group;
    const activeDrill = activePayDetailRows(group);
    const activePayTypeGmv: Record<string, number> = {};
    for (const row of activeDrill) {
      const key = normalizePayType(asText(row.pay_type));
      activePayTypeGmv[key] = (activePayTypeGmv[key] || 0) + asNumber(row.gmv_usd) / divisor;
    }
    const total = sum(primary.map((row) => asNumber(row.gmv_usd)));
    const active = sum(activeDrill.map((row) => asNumber(row.gmv_usd)));
    const renewal = sum(primary.filter((row) => normalizePayType(asText(row.pay_type)) === RENEWAL_PAY_TYPE).map((row) => asNumber(row.gmv_usd)));
    return { period, totalGmv: total / divisor, activeGmv: active / divisor, renewalGmv: renewal / divisor, activePayTypeGmv, gmv: 0, dau: 0, paywallExposureRate: 0, submitRate: 0, payRate: 0, aov: 0 };
  });
}

function chainTrend(rows: D1Row[], periods: string[], days: Map<string, number>) {
  return periods.map((period) => {
    const group = sumChain(rows.filter((row) => asText(row.period) === period));
    const divisor = days.get(period) || 1;
    return {
      period,
      gmv: group.chainGmvUsd / divisor,
      dau: group.activeUv / divisor,
      paywallExposureRate: group.activeUv ? group.subExposeUv / group.activeUv : 0,
      submitRate: group.subExposeUv ? group.subSubmitUv / group.subExposeUv : 0,
      payRate: group.subSubmitUv ? group.chainPayUv / group.subSubmitUv : 0,
      aov: group.chainPayUv ? group.chainGmvUsd / group.chainPayUv : 0,
    };
  });
}

function groupByPeriod(rows: D1Row[], granularity: string) {
  const periods = new Set<string>();
  for (const row of rows) periods.add(granularity === 'week' ? asText(row.week_start) : asText(row.period));
  return [...periods].filter(Boolean).sort();
}

function periodRows(rows: D1Row[], period: string, granularity: string) {
  return rows.filter((row) => (granularity === 'week' ? asText(row.week_start) : asText(row.period)) === period);
}

export function trendPeriodDivisors(rows: D1Row[], granularity: string) {
  if (granularity === 'week') return weekDayCounts(rows);
  return new Map(
    [...new Set(rows.map((row) => asText(row.period)).filter(Boolean))]
      .map((period) => [period, 1]),
  );
}

async function overview(env: Env, request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') || 'web';
  const granularity = url.searchParams.get('granularity') || 'day';
  const startDate = url.searchParams.get('startDate') || '1970-01-01';
  const endDate = url.searchParams.get('endDate') || '9999-12-31';
  const deviceType = url.searchParams.get('deviceType') || undefined;
  const trendUserTag = url.searchParams.get('trendUserTag') || undefined;
  const planTier = url.searchParams.get('planTier')?.toUpperCase() || undefined;
  if (!DASHBOARD_PLATFORMS.has(platform)) return errorResponse('platform 必须是 all / web / app 之一');
  const [chain, pay, renewalRecords] = await Promise.all([
    dailyRows(env, 'chain_daily', { platform, startDate, endDate, deviceType }),
    dailyRows(env, 'pay_type_daily', { platform, startDate, endDate }),
    dailyRows(env, 'renewal_daily', { platform, startDate, endDate }),
  ]);
  const renewal = renewalPlatformRows(renewalRecords, platform, deviceType)
    .filter((row) => !planTier || asText(row.plan_tier).toUpperCase() === planTier);
  const filteredChain = trendUserTag ? chain.filter((row) => asText(row.user_tag) === trendUserTag) : chain;
  const payDays = trendPeriodDivisors(pay, granularity);
  const chainDays = trendPeriodDivisors(filteredChain, granularity);
  const renewalDays = trendPeriodDivisors(renewal, granularity);
  const periods = groupByPeriod([...filteredChain, ...pay, ...renewal], granularity).filter((period) => dateInRange(period, startDate, endDate));
  const payTrendRows = payTrend(pay.map((row) => ({ ...row, period: granularity === 'week' ? row.week_start : row.period })), periods, payDays);
  const payPeriods = groupByPeriod(pay, granularity).filter((period) => dateInRange(period, startDate, endDate));
  const cardTrend = payTrend(pay.map((row) => ({ ...row, period: granularity === 'week' ? row.week_start : row.period })), payPeriods, payDays);
  const chainTrendRows = chainTrend(filteredChain.map((row) => ({ ...row, period: granularity === 'week' ? row.week_start : row.period })), periods, chainDays);
  const trend = payTrendRows.map((row, index) => {
    const chainRow = chainTrendRows[index];
    const renewalTotal = sumRenewal(periodRows(renewal, row.period, granularity));
    const renewalPeriodDays = renewalDays.get(row.period) || 1;
    return {
      ...row,
      ...chainRow,
      activeGmv: chainRow.gmv,
      renewalGmv: renewalTotal.renewAmountUsd / renewalPeriodDays,
      expireUserCnt: renewalTotal.expireUserCnt / renewalPeriodDays,
      renewalRate: renewalTotal.expireUserCnt ? renewalTotal.renewUserCnt / renewalTotal.expireUserCnt : 0,
      renewalAov: renewalTotal.renewUserCnt ? renewalTotal.renewAmountUsd / renewalTotal.renewUserCnt : 0,
    };
  });
  const requestedMetricDate = url.searchParams.get('metricDate') || endDate;
  const availableMetricDates = [...new Set(chain.map((row) => asText(row.period)))].filter(Boolean).sort();
  const metricDate = availableMetricDates.includes(requestedMetricDate)
    ? requestedMetricDate
    : availableMetricDates.filter((period) => period <= requestedMetricDate).at(-1) || availableMetricDates.at(-1) || requestedMetricDate;
  const current = sumChain(chain.filter((row) => asText(row.period) === metricDate));
  const previousDate = new Date(`${metricDate}T00:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const previousPeriod = previousDate.toISOString().slice(0, 10);
  const previous = sumChain(chain.filter((row) => asText(row.period) === previousPeriod));
  return json({
    selectedPeriod: metricDate,
    gmvTotal: current.chainGmvUsd,
    gmvPrev: previous.chainGmvUsd,
    wowChange: previous.chainGmvUsd ? (current.chainGmvUsd - previous.chainGmvUsd) / previous.chainGmvUsd : 0,
    dau: current.activeUv,
    paywallExposureRate: current.activeUv ? current.subExposeUv / current.activeUv : 0,
    submitRate: current.subExposeUv ? current.subSubmitUv / current.subExposeUv : 0,
    payRate: current.subSubmitUv ? current.chainPayUv / current.subSubmitUv : 0,
    aov: current.chainPayUv ? current.chainGmvUsd / current.chainPayUv : 0,
    trend,
    cardTrend,
  });
}

async function gmvCoverage(env: Env) {
  const latestPeriod = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const startDate = shiftDate(latestPeriod, -41);
  const [payRows, ...chainRows] = await Promise.all([
    dailyRows(env, 'pay_type_daily', { startDate, endDate: latestPeriod }),
    ...['web', 'app'].map((platform) =>
      dailyRows(env, 'chain_daily', { platform, startDate, endDate: latestPeriod }),
    ),
  ]);
  const pay = payRows.filter(isActivePayDetailRow);
  const chain = chainRows.flat();
  const platforms: Record<string, unknown> = {};
  for (const platform of ['web', 'app']) {
    const platformPay = pay.filter((row) => asText(row.platform) === platform);
    const platformChain = chain.filter((row) => asText(row.platform) === platform);
    const payByWeek = new Map<string, number>();
    const chainByWeek = new Map<string, number>();
    for (const row of platformPay) payByWeek.set(asText(row.week_start), (payByWeek.get(asText(row.week_start)) || 0) + asNumber(row.gmv_usd));
    for (const row of platformChain) chainByWeek.set(asText(row.week_start), (chainByWeek.get(asText(row.week_start)) || 0) + asNumber(row.chain_gmv_usd));
    const payDays = weekDayCounts(platformPay);
    const chainDays = weekDayCounts(platformChain);
    const weeks = [...payByWeek.keys()].filter((week) => chainByWeek.has(week) && (payDays.get(week) || 0) >= WEEK_DAYS && (chainDays.get(week) || 0) >= WEEK_DAYS).sort().slice(-4).map((period) => {
      const payTypeDailyAvg = (payByWeek.get(period) || 0) / (payDays.get(period) || WEEK_DAYS);
      const chainDailyAvg = (chainByWeek.get(period) || 0) / (chainDays.get(period) || WEEK_DAYS);
      const unattributedDailyAvg = payTypeDailyAvg - chainDailyAvg;
      return { period, payTypeDailyAvg, chainDailyAvg, unattributedDailyAvg, unattributedRate: payTypeDailyAvg ? unattributedDailyAvg / payTypeDailyAvg : null };
    });
    const payTypeDailyAvg = average(weeks.map((week) => week.payTypeDailyAvg));
    const chainDailyAvg = average(weeks.map((week) => week.chainDailyAvg));
    const unattributedDailyAvg = payTypeDailyAvg - chainDailyAvg;
    platforms[platform] = { platform, weeks, payTypeDailyAvg, chainDailyAvg, unattributedDailyAvg, unattributedRate: payTypeDailyAvg ? unattributedDailyAvg / payTypeDailyAvg : null };
  }
  return json({ weekCount: Math.max(...Object.values(platforms).map((value) => (value as { weeks: unknown[] }).weeks.length)), platforms });
}

function percentile(values: number[], quantile: number) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

async function gmvAnomalies(env: Env) {
  if (!env.DB) return json({ latestWeek: '', method: 'rolling_p95_p05_min_10pct', alerts: [] });
  const latestPeriod = await Promise.all([
    latestDailyPeriod(env, 'pay_type_daily'),
    latestDailyPeriod(env, 'chain_daily'),
  ]).then((periods) => periods.filter(Boolean).sort().at(-1) || '');
  if (!latestPeriod) return json({ latestWeek: '', method: 'rolling_p95_p05_min_10pct', alerts: [] });
  const endDate = latestPeriod;
  const startDate = shiftDate(latestPeriod, -110);
  const [payRows, chainRows, renewalRows] = await Promise.all([
    dailyRows(env, 'pay_type_daily', { startDate, endDate }),
    dailyRows(env, 'chain_daily', { startDate, endDate }),
    dailyRows(env, 'renewal_daily', { startDate, endDate }),
  ]);
  const alerts: Array<Record<string, unknown>> = [];
  let latestCompleteWeek = '';
  for (const platform of ['all', 'web', 'app'] as const) {
    const pay = payRows.filter((row) => asText(row.platform) === platform);
    const chain = chainRows.filter((row) => asText(row.platform) === platform);
    const renewal = renewalPlatformRows(renewalRows, platform);
    const payDays = weekDayCounts(pay);
    const chainDays = weekDayCounts(chain);
    const renewalDays = weekDayCounts(renewal);
    const completeWeeks = [...new Set([...payDays.keys()].filter((week) =>
      (payDays.get(week) || 0) >= WEEK_DAYS && (chainDays.get(week) || 0) >= WEEK_DAYS,
    ))].sort();
    if (completeWeeks.length < 2) continue;
    const latestWeek = completeWeeks.at(-1)!;
    if (latestWeek > latestCompleteWeek) latestCompleteWeek = latestWeek;
    const previousWeek = completeWeeks.at(-2)!;
    const metrics = [
      { key: 'totalGmv', rows: pay, field: 'gmv_usd', days: payDays },
      { key: 'activeGmv', rows: chain, field: 'chain_gmv_usd', days: chainDays },
      { key: 'renewalGmv', rows: renewal, field: 'renew_amount_usd', days: renewalDays },
    ] as const;
    for (const metric of metrics) {
      const valueForWeek = (week: string) => {
        const rows = metric.rows.filter((row) => asText(row.week_start) === week);
        const days = metric.days.get(week) || WEEK_DAYS;
        return sum(rows.map((row) => asNumber(row[metric.field]))) / days;
      };
      const values = completeWeeks.map((week) => ({ week, value: valueForWeek(week) }));
      const changes = values.slice(1).flatMap((current, index) => {
        const previous = values[index];
        return previous.value > 0 && current.value > 0
          ? [{ week: current.week, value: current.value / previous.value - 1 }]
          : [];
      });
      const current = changes.at(-1);
      if (!current) continue;
      const history = changes.slice(Math.max(0, changes.length - 13), -1).map((item) => item.value);
      if (history.length < 8) continue;
      const upper = Math.max(percentile(history, 0.95), 0.10);
      const lower = Math.min(percentile(history, 0.05), -0.10);
      const direction = current.value >= upper ? 'up' : current.value <= lower ? 'down' : null;
      if (!direction) continue;
      const currentValue = values.at(-1)!.value;
      const previousValue = values.at(-2)!.value;
      alerts.push({
        platform,
        metric: metric.key,
        period: latestWeek,
        direction,
        change: current.value,
        threshold: direction === 'up' ? upper : lower,
        currentDailyAvg: currentValue,
        previousDailyAvg: previousValue,
        historyCount: history.length,
      });
    }
  }
  return json({ latestWeek: latestCompleteWeek, method: 'rolling_p95_p05_min_10pct', alerts });
}

async function attributions(env: Env, request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') || 'web';
  const dimension = url.searchParams.get('dimension') || 'pay_type';
  const startDate = url.searchParams.get('startDate') || '1970-01-01';
  const endDate = url.searchParams.get('endDate') || '9999-12-31';
  const baselinePeriod = url.searchParams.get('baselinePeriod') || undefined;
  const analysisPeriod = url.searchParams.get('analysisPeriod') || undefined;
  const deviceType = url.searchParams.get('deviceType') || undefined;
  const chainType = url.searchParams.get('chainType') || 'active';
  const planTier = url.searchParams.get('planTier')?.toUpperCase() || undefined;
  if (!DASHBOARD_PLATFORMS.has(platform)) return errorResponse('platform 必须是 all / web / app 之一');
  if (!['pay_type', 'chain', 'creative'].includes(dimension)) return errorResponse('dimension 必须是 pay_type / chain / creative 之一');
  if (!['active', 'renewal'].includes(chainType)) return errorResponse('chainType 必须是 active / renewal 之一');
  if (planTier && !['LITE', 'PRO', 'ULTRA'].includes(planTier)) return errorResponse('planTier 必须是 LITE / PRO / ULTRA 之一');

  if (dimension === 'pay_type') {
    const rawRows = await dailyRows(env, 'pay_type_daily', { platform, startDate, endDate });
    const rows = alignComparisonWeekdays(rawRows, baselinePeriod, analysisPeriod);
    const renewalRows = alignComparisonWeekdays(
      renewalPlatformRows(
        await dailyRows(env, 'renewal_daily', { platform, startDate, endDate }),
        platform,
        deviceType,
      ),
      baselinePeriod,
      analysisPeriod,
    );
    const comparison = buildComparison(rows, startDate, endDate, baselinePeriod, analysisPeriod);
    const days = comparison?.dayCounts || weekDayCounts(rows);
    const periods = [...new Set(rows.map((row) => asText(row.week_start)))].filter((period) => dateInRange(period, startDate, endDate)).sort();
    const trend = periods.map((period) => {
      const periodRows = rows.filter((row) => asText(row.week_start) === period);
      return { period, value: sum(periodRows.map((row) => asNumber(row.gmv_usd))) / (days.get(period) || WEEK_DAYS), gmv: sum(periodRows.map((row) => asNumber(row.gmv_usd))) / (days.get(period) || WEEK_DAYS) };
    });
    if (!comparison) return json({ dimension, valueLabel: 'GMV', comparison: null, metricLabels: {}, items: [], sections: [], trend });
    const makeSection = (title: string, description: string, sourceRows: D1Row[], order: string[]) => {
      const currentRows = sourceRows.filter((row) => asText(row.week_start) === comparison.analysisPeriod);
      const previousRows = sourceRows.filter((row) => asText(row.week_start) === comparison.baselinePeriod);
      const current = aggregatePay(currentRows, () => true);
      const previous = aggregatePay(previousRows, () => true);
      if (sourceRows === primaryRows) {
        current.set('自动续订', sumRenewal(renewalRows.filter((row) => asText(row.week_start) === comparison.analysisPeriod)).renewAmountUsd);
        previous.set('自动续订', sumRenewal(renewalRows.filter((row) => asText(row.week_start) === comparison.baselinePeriod)).renewAmountUsd);
      }
      const keys = [...new Set([...order.filter((key) => current.has(key) || previous.has(key)), ...current.keys(), ...previous.keys()])];
      const denominator = sum([...current.values()]) / comparison.analysisPeriodDays - sum([...previous.values()]) / comparison.baselinePeriodDays;
      return {
        title,
        description,
        valueLabel: 'GMV',
        metricLabels: {},
        items: keys.map((key) => attributionItem({ key, value: current.get(key) || 0, previousValue: previous.get(key) || 0, contributionDenominator: denominator, baselineDays: comparison.baselinePeriodDays, analysisDays: comparison.analysisPeriodDays })),
      };
    };
    const primaryRows = rows.map((row) => isActivePayDetailRow(row) ? { ...row, pay_type: '主动付费' } : row);
    const makeRenewalPlanSection = () => {
      const currentRows = renewalRows.filter((row) => asText(row.week_start) === comparison.analysisPeriod);
      const previousRows = renewalRows.filter((row) => asText(row.week_start) === comparison.baselinePeriod);
      const current = new Map<string, number>();
      const previous = new Map<string, number>();
      for (const row of currentRows) {
        const key = asText(row.plan_tier).toUpperCase();
        if (key) current.set(key, (current.get(key) || 0) + asNumber(row.renew_amount_usd));
      }
      for (const row of previousRows) {
        const key = asText(row.plan_tier).toUpperCase();
        if (key) previous.set(key, (previous.get(key) || 0) + asNumber(row.renew_amount_usd));
      }
      const order = ['LITE', 'PRO', 'ULTRA'];
      const keys = [...new Set([...order.filter((key) => current.has(key) || previous.has(key)), ...current.keys(), ...previous.keys()])];
      const denominator = sum([...current.values()]) / comparison.analysisPeriodDays - sum([...previous.values()]) / comparison.baselinePeriodDays;
      return {
        title: '自动续订套餐下钻',
        description: '只在自动续订内部拆解 Lite、Pro、Ultra 套餐对 GMV 变化的贡献。',
        valueLabel: 'GMV',
        metricLabels: {},
        items: keys.map((key) => attributionItem({
          key,
          value: current.get(key) || 0,
          previousValue: previous.get(key) || 0,
          contributionDenominator: denominator,
          baselineDays: comparison.baselinePeriodDays,
          analysisDays: comparison.analysisPeriodDays,
        })),
      };
    };
    const sections = [
      makeSection('付费类型贡献', '主动付费明细汇总后与自动续订汇总比较 GMV 变化。', primaryRows, ['主动付费', '自动续订']),
      makeSection('主动付费下钻', '主动付费明细按付费类型汇总；功能和注册新老明细见下方。', activePayDetailRows(rows), ['首订', '积分包', '套餐升级', '重新订阅', '其他']),
      makeRenewalPlanSection(),
    ];
    // Attribution uses aligned weekdays, but the detail trend must retain every
    // available calendar day in the selected weeks (including the baseline tail).
    const breakdownDates = [...new Set(rawRows.filter((row) =>
      asText(row.week_start) === comparison.baselinePeriod || asText(row.week_start) === comparison.analysisPeriod,
    ).map((row) => asText(row.period)))];
    const conditions = ["dataset = 'pay_type'", "function_name IS NOT NULL", "user_tag IS NOT NULL", `period IN (${breakdownDates.map(() => '?').join(', ')})`, 'week_start IN (?, ?)'];
    const binds: unknown[] = [...breakdownDates, comparison.baselinePeriod, comparison.analysisPeriod];
    conditions.push('platform = ?');
    binds.push(platform);
    const breakdownRows = breakdownDates.length
      ? await queryRows(env, `SELECT period, week_start, pay_type, function_name, user_tag, SUM(gmv_usd) AS gmv_usd FROM pollo_da_fact_rows WHERE ${conditions.join(' AND ')} GROUP BY period, week_start, pay_type, function_name, user_tag`, ...binds)
      : [];
    const paymentBreakdown = breakdownRows.map((row) => ({
      period: asText(row.period),
      weekStart: asText(row.week_start),
      payType: normalizePayType(asText(row.pay_type)),
      functionName: asText(row.function_name) || 'not_attributed',
      userTag: asText(row.user_tag) || '未知',
      gmvUsd: asNumber(row.gmv_usd),
    }));
    return json({ dimension, valueLabel: 'GMV', comparison, metricLabels: {}, items: sections[0].items, sections, trend, paymentBreakdown });
  }

  if (dimension === 'creative') {
    const rows = await dailyRows(env, 'creative_daily', { platform, startDate, endDate });
    const comparison = buildComparison(rows, startDate, endDate, baselinePeriod, analysisPeriod);
    const days = comparison?.dayCounts || weekDayCounts(rows);
    const periods = [...new Set(rows.map((row) => asText(row.week_start)))].filter((period) => dateInRange(period, startDate, endDate)).sort();
    const trend = periods.map((period) => ({ period, ...creativeMetrics(rows.filter((row) => asText(row.week_start) === period), days.get(period) || WEEK_DAYS) }));
    const metricLabels = { activeUv: '活跃UV', creationUv: '创作UV', creationTaskCnt: '创作数量', creationPenetrationRate: '创作渗透率', avgCreationTaskCntPerCreator: '人均创作数量' };
    if (!comparison) return json({ dimension, valueLabel: '人均创作数量', comparison: null, metricLabels, items: [], trend });
    const currentRows = rows.filter((row) => asText(row.week_start) === comparison.analysisPeriod);
    const previousRows = rows.filter((row) => asText(row.week_start) === comparison.baselinePeriod);
    const currentGroups = aggregateCreativeBy(currentRows);
    const previousGroups = aggregateCreativeBy(previousRows);
    const keys = [...new Set([...currentGroups.keys(), ...previousGroups.keys()])].sort((left, right) => tierRank(left) - tierRank(right));
    const items = keys.map((key) => {
      const currentMetrics = creativeMetrics(currentGroups.get(key) || [], comparison.analysisPeriodDays);
      const previousMetrics = creativeMetrics(previousGroups.get(key) || [], comparison.baselinePeriodDays);
      return attributionItem({ key, value: currentMetrics.avgCreationTaskCntPerCreator, previousValue: previousMetrics.avgCreationTaskCntPerCreator, metrics: currentMetrics, previousMetrics, dailyAverage: false, baselineDays: comparison.baselinePeriodDays, analysisDays: comparison.analysisPeriodDays });
    });
    return json({ dimension, valueLabel: '人均创作数量', comparison, metricLabels, items, trend });
  }

  if (chainType === 'renewal') {
    const sourceRows = await dailyRows(env, 'renewal_daily', { platform, startDate, endDate });
    const filteredRows = renewalPlatformRows(sourceRows, platform, deviceType)
      .filter((row) => !planTier || asText(row.plan_tier).toUpperCase() === planTier);
    const rows = alignComparisonWeekdays(
      filteredRows,
      baselinePeriod,
      analysisPeriod,
    );
    const comparison = buildComparison(rows, startDate, endDate, baselinePeriod, analysisPeriod);
    const days = comparison?.dayCounts || weekDayCounts(rows);
    const periods = [...new Set(rows.map((row) => asText(row.week_start)))].filter((period) => dateInRange(period, startDate, endDate)).sort();
    const trend = periods.map((period) => {
      const factors = renewalFactors(rows.filter((row) => asText(row.week_start) === period), days.get(period) || WEEK_DAYS);
      return { period, value: factors.expireUserCnt * factors.renewalRate * factors.renewalAov, gmv: factors.expireUserCnt * factors.renewalRate * factors.renewalAov, ...factors };
    });
    const metricLabels = { expireUserCnt: '到期用户数', renewalRate: '续订率', renewalAov: '续订客单价' };
    if (!comparison) return json({ dimension, valueLabel: '续订GMV', comparison: null, metricLabels, items: [], sections: [], drivers: [], trend });
    const previousFactors = renewalFactors(rows.filter((row) => asText(row.week_start) === comparison.baselinePeriod), comparison.baselinePeriodDays);
    const currentFactors = renewalFactors(rows.filter((row) => asText(row.week_start) === comparison.analysisPeriod), comparison.analysisPeriodDays);
    const effects = renewalDriverEffects(previousFactors, currentFactors);
    const previousGmv = previousFactors.expireUserCnt * previousFactors.renewalRate * previousFactors.renewalAov;
    const currentGmv = currentFactors.expireUserCnt * currentFactors.renewalRate * currentFactors.renewalAov;
    const gmvDelta = currentGmv - previousGmv;
    const drivers = RENEWAL_DRIVER_DEFINITIONS.map(([metricKey, metric]) => {
      const value = currentFactors[metricKey];
      const previousValue = previousFactors[metricKey];
      const change = value - previousValue;
      return { tier: planTier || '全部套餐', metricKey, metric, value, previousValue, change, wowChange: previousValue ? change / previousValue : null, contribution: gmvDelta ? effects[metricKey] / gmvDelta : null };
    });
    return json({ dimension, valueLabel: '续订GMV', comparison, metricLabels, items: [], sections: [], drivers, drill: { path: 'tier_to_chain', creationTier: 'all', userTag: '全部', chainType: 'renewal', planTier }, trend });
  }

  const rows = await dailyRows(env, 'chain_daily', { platform, startDate, endDate, deviceType });
  const comparison = buildComparison(rows, startDate, endDate, baselinePeriod, analysisPeriod);
  const days = comparison?.dayCounts || weekDayCounts(rows);
  const periods = [...new Set(rows.map((row) => asText(row.week_start)))].filter((period) => dateInRange(period, startDate, endDate)).sort();
  const trend = periods.map((period) => {
    const totals = sumChain(rows.filter((row) => asText(row.week_start) === period));
    const metrics = chainMetrics(totals);
    const divisor = days.get(period) || WEEK_DAYS;
    return { period, value: totals.chainGmvUsd / divisor, gmv: totals.chainGmvUsd / divisor, dau: metrics.activeUv / divisor, paywallExposureRate: metrics.subExposeRate, submitRate: metrics.subSubmitRate, payRate: metrics.chainPaySuccessRate, aov: metrics.chainArppu };
  });
  const metricLabels = { activeUv: 'DAU', subExposeUv: '付费墙曝光UV', subExposeRate: '付费墙曝光率', subSubmitUv: '付费墙支付提交UV', subSubmitRate: '付费墙提交率', chainPayUv: '支付UV', chainPaySuccessRate: '提交支付率', chainArppu: '客单价' };
  if (!comparison) return json({ dimension, valueLabel: '主动付费GMV', comparison: null, metricLabels, items: [], drivers: [], trend });
  const currentRows = rows.filter((row) => asText(row.week_start) === comparison.analysisPeriod);
  const previousRows = rows.filter((row) => asText(row.week_start) === comparison.baselinePeriod);
  const currentGroups = aggregateChainBy(currentRows, tierKey);
  const previousGroups = aggregateChainBy(previousRows, tierKey);
  const keys = [...new Set([...currentGroups.keys(), ...previousGroups.keys()])].sort((left, right) => tierRank(left) - tierRank(right));
  const currentGmv = sum([...currentGroups.values()].map((group) => sumChain(group).chainGmvUsd));
  const previousGmv = sum([...previousGroups.values()].map((group) => sumChain(group).chainGmvUsd));
  const denominator = currentGmv / comparison.analysisPeriodDays - previousGmv / comparison.baselinePeriodDays;
  const items = keys.map((key) => {
    const current = sumChain(currentGroups.get(key) || []);
    const previous = sumChain(previousGroups.get(key) || []);
    return attributionItem({ key, value: current.chainGmvUsd, previousValue: previous.chainGmvUsd, metrics: chainMetrics(current), previousMetrics: chainMetrics(previous), contributionDenominator: denominator, baselineDays: comparison.baselinePeriodDays, analysisDays: comparison.analysisPeriodDays });
  });
  const selectedTier = url.searchParams.get('creationTier') && url.searchParams.get('creationTier') !== 'all' ? url.searchParams.get('creationTier')! : 'all';
  const selectedRows = selectedTier === 'all' ? currentRows : currentRows.filter((row) => tierKey(row) === selectedTier);
  const selectedPreviousRows = selectedTier === 'all' ? previousRows : previousRows.filter((row) => tierKey(row) === selectedTier);
  const userGroups = aggregateChainBy(selectedRows, (row) => asText(row.user_tag) || '未知');
  const previousUserGroups = aggregateChainBy(selectedPreviousRows, (row) => asText(row.user_tag) || '未知');
  const selectedGmv = sumChain(selectedRows).chainGmvUsd;
  const selectedPreviousGmv = sumChain(selectedPreviousRows).chainGmvUsd;
  const userDenominator = selectedGmv / comparison.analysisPeriodDays - selectedPreviousGmv / comparison.baselinePeriodDays;
  const userItems = USER_TAG_ORDER.filter((key) => userGroups.has(key) || previousUserGroups.has(key)).map((key) => {
    const current = sumChain(userGroups.get(key) || []);
    const previous = sumChain(previousUserGroups.get(key) || []);
    return attributionItem({ key, value: current.chainGmvUsd, previousValue: previous.chainGmvUsd, metrics: chainMetrics(current), previousMetrics: chainMetrics(previous), contributionDenominator: userDenominator, baselineDays: comparison.baselinePeriodDays, analysisDays: comparison.analysisPeriodDays });
  });
  const sections = [
    { title: '创作分层 GMV 贡献', description: '先定位不同创作分层对主动付费GMV变化的贡献。', valueLabel: '主动付费GMV', metricLabels, items },
    { title: `用户类型下钻 · ${selectedTier}`, description: '在选定创作分层内比较新用户、老用户和未知用户。', valueLabel: '主动付费GMV', metricLabels, items: userItems },
  ];
  const driverUserTag = url.searchParams.get('userTag') && url.searchParams.get('userTag') !== 'all' ? url.searchParams.get('userTag')! : '';
  const driverRows = driverUserTag ? selectedRows.filter((row) => (asText(row.user_tag) || '未知') === driverUserTag) : selectedRows;
  const driverPreviousRows = driverUserTag ? selectedPreviousRows.filter((row) => (asText(row.user_tag) || '未知') === driverUserTag) : selectedPreviousRows;
  const currentDriver = sumChain(driverRows);
  const previousDriver = sumChain(driverPreviousRows);
  const currentMetrics = chainMetrics(currentDriver);
  const previousMetrics = chainMetrics(previousDriver);
  const driverDelta = currentDriver.chainGmvUsd / comparison.analysisPeriodDays - previousDriver.chainGmvUsd / comparison.baselinePeriodDays;
  const driverDefinitions = [
    ['activeUv', 'DAU', true],
    ['subExposeRate', '付费墙曝光率', false],
    ['subSubmitRate', '付费墙提交率', false],
    ['chainPaySuccessRate', '提交支付率', false],
    ['chainArppu', '客单价', false],
  ] as const;
  const effects = chainDriverEffects(
    { ...previousMetrics, activeUv: previousMetrics.activeUv / comparison.baselinePeriodDays },
    { ...currentMetrics, activeUv: currentMetrics.activeUv / comparison.analysisPeriodDays },
  );
  const drivers = driverDefinitions.map(([metricKey, metric, dailyAverage]) => {
    const value = dailyAverage ? currentMetrics[metricKey] / comparison.analysisPeriodDays : currentMetrics[metricKey];
    const previousValue = dailyAverage ? previousMetrics[metricKey] / comparison.baselinePeriodDays : previousMetrics[metricKey];
    const change = value - previousValue;
    return { tier: selectedTier, userTag: driverUserTag || '全部', metricKey, metric, value, previousValue, change, wowChange: previousValue ? change / previousValue : null, contribution: driverDelta ? effects[metricKey] / driverDelta : null };
  });
  return json({ dimension, valueLabel: '主动付费GMV', comparison, metricLabels, items, sections, drivers, drill: { path: url.searchParams.get('chainPath') || 'tier_to_chain', creationTier: selectedTier, userTag: driverUserTag || '全部' }, trend });
}

const PREVIEW_FIELDS: Record<string, string[]> = {
  run_log: ['run_id', 'status', 'stage', 'start_date', 'end_date', 'platforms', 'rows_synced', 'error_message', 'started_at', 'finished_at'],
  pay_type_daily: ['platform', 'dataset_kind', 'period', 'week_start', 'week_end', 'device_type', 'pay_type', 'function_name', 'user_tag', 'subscription_tier', 'pay_user_cnt', 'gmv_usd'],
  chain_daily: ['platform', 'dataset_kind', 'period', 'week_start', 'week_end', 'device_type', 'user_tag', 'creation_cnt_30d_level_id', 'creation_cnt_30d', 'active_uv', 'sub_expose_uv', 'sub_submit_uv', 'chain_pay_uv', 'chain_gmv_usd', 'sub_expose_rate', 'sub_submit_rate', 'chain_pay_success_rate', 'chain_arppu'],
  creative_daily: ['platform', 'dataset_kind', 'period', 'week_start', 'week_end', 'creation_cnt_30d_level_id', 'creation_cnt_30d', 'active_uv', 'creation_uv', 'creation_task_cnt', 'creation_penetration_rate', 'avg_creation_task_cnt_per_creator'],
  renewal_daily: ['platform', 'dataset_kind', 'period', 'week_start', 'week_end', 'platform_type', 'plan_tier', 'plan_cycle', 'expire_user_cnt', 'renew_user_cnt', 'renew_amount_usd'],
  latest_report: ['platform', 'period_start', 'period_end', 'model_used', 'degraded', 'generated_at', 'report_md'],
  report_history: ['platform', 'period_start', 'period_end', 'model_used', 'degraded', 'generated_at', 'report_md'],
  report_generation_jobs: ['run_id', 'platform', 'granularity', 'period_start', 'period_end', 'status', 'stage', 'requested_at', 'started_at', 'heartbeat_at', 'finished_at', 'error_message', 'model_used'],
  product_actions: ['统计日', '星期', '上线时间', '类型', '更新点', '说明', '板块', '版本', 'commit', '来源', '备注', '端'],
};

const PREVIEW_TABLES: Record<string, string> = {
  run_log: 'run_log',
  pay_type_daily: 'pay_type_daily',
  chain_daily: 'chain_daily',
  creative_daily: 'creative_daily',
  renewal_daily: 'renewal_daily',
  latest_report: 'latest_report',
  report_history: 'report_history',
  report_generation_jobs: 'report_generation_jobs',
  product_actions: 'product_actions',
};

function previewRow(sheet: string, row: D1Row) {
  if (sheet !== 'product_actions') return row;
  return {
    统计日: row.stat_date,
    星期: row.weekday,
    上线时间: row.release_time,
    类型: row.action_type,
    更新点: row.update_point,
    说明: row.description,
    板块: row.board,
    版本: row.version,
    commit: row.commit_id,
    来源: row.source,
    备注: row.remark,
    端: row.platform,
  };
}

async function productActionRows(env: Env) {
  try {
    return (await baseRecords(env, 'product_actions')).map(record => {
      const row = record.fields;
      return {
        stat_date: row.stat_date ?? row['统计日'], weekday: row.weekday ?? row['星期'],
        release_time: row.release_time ?? row['上线时间'], action_type: row.action_type ?? row['类型'],
        update_point: row.update_point ?? row['更新点'], description: row.description ?? row['说明'],
        board: row.board ?? row['板块'], version: row.version ?? row['版本'],
        commit_id: row.commit_id ?? row.commit, source: row.source ?? row['来源'],
        remark: row.remark ?? row['备注'], platform: row.platform ?? row['端'],
      };
    });
  } catch {
    return queryRows(env, 'SELECT stat_date, weekday, release_time, action_type, update_point, description, board, version, commit_id, source, remark, platform FROM pollo_da_product_actions ORDER BY stat_date DESC');
  }
}

async function workbookPreview(env: Env, request: Request) {
  const url = new URL(request.url);
  const sheet = url.searchParams.get('sheet') || '';
  const table = PREVIEW_TABLES[sheet] as BaseSheet | undefined;
  if (!table || !TABLES.has(table)) return errorResponse('不支持的工作表', 400);
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize') || 50)));
  const platform = url.searchParams.get('platform');
  const sourceRows = DAILY_SHEETS.has(table)
    ? await dailyRows(env, table as 'pay_type_daily' | 'chain_daily' | 'creative_daily' | 'renewal_daily', { platform: platform || undefined })
    : table === 'product_actions'
      ? await productActionRows(env)
      : (await baseRecords(env, table)).map((record) => record.fields);
  const allRows = sourceRows
    .filter((row) => !platform || !('platform' in row) || asText(row.platform) === platform)
    .reverse();
  const rows = allRows.slice(offset, offset + pageSize);
  return json({ sheet, fields: PREVIEW_FIELDS[sheet] || Object.keys(rows[0] || {}), items: rows.map((row) => previewRow(sheet, row)), total: allRows.length, hasMore: offset + rows.length < allRows.length });
}

async function latestSync(env: Env) {
  if (!env.DB) return json(null);
  const latest = await env.DB.prepare('SELECT payload, updated_at FROM sync_jobs ORDER BY created_at DESC LIMIT 1').first<{ payload: string; updated_at: number }>();
  if (!latest) return json(null);
  const job = JSON.parse(latest.payload) as SyncRunStatus;
  if (['queued', 'running', 'pausing'].includes(job.status) && latest.updated_at < Date.now() - 180000) {
    job.status = 'failed';
    job.errorMessage = '同步任务已中断，请重新同步。';
    job.finishedAt = new Date().toISOString();
    job.steps?.forEach(step => { if (step.status === 'running') step.status = 'failed'; });
    await env.DB.prepare("UPDATE sync_jobs SET status = 'failed', payload = ?, updated_at = ? WHERE run_id = ? AND status IN ('queued', 'running', 'pausing') AND updated_at < ?")
      .bind(JSON.stringify(job), Date.now(), job.runId, Date.now() - 180000).run();
  }
  return json(job);
}

async function syncPlan(env: Env, mode: SyncMode) {
  const sheets = ['pay_type_daily', 'chain_daily', 'creative_daily', 'renewal_daily'] as const;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const platforms = ['all', 'web', 'app'];
  const payTypeShape = await env.DB!.prepare(`
    SELECT
      COUNT(*) AS row_count,
      SUM(CASE
        WHEN analysis_level IS NOT NULL
          OR device_type IS NULL
          OR (LOWER(platform) = 'web' AND LOWER(device_type) <> 'web')
          OR (LOWER(platform) = 'all' AND LOWER(device_type) <> 'all')
          OR (LOWER(platform) = 'app' AND LOWER(device_type) NOT IN ('ios', 'android'))
        THEN 1 ELSE 0 END) AS invalid_shape_count
    FROM pollo_da_fact_rows
    WHERE dataset = 'pay_type'
  `).first<{ row_count: number | string; invalid_shape_count: number | string }>();
  const payTypeNeedsFullRefresh =
    Number(payTypeShape?.row_count || 0) === 0
    || Number(payTypeShape?.invalid_shape_count || 0) > 0;
  if (mode === 'full_refresh') {
    return json({
      mode,
      startDate: FULL_REFRESH_START_DATE,
      endDate: yesterday,
      latestStoredDate: null,
      platforms,
      alreadySynced: false,
      canSync: true,
      running: false,
      missingItems: [],
      datasets: [...SYNC_DATASETS],
    });
  }
  if (payTypeNeedsFullRefresh) {
    return json({
      mode,
      startDate: FULL_REFRESH_START_DATE,
      endDate: yesterday,
      latestStoredDate: null,
      platforms,
      alreadySynced: false,
      canSync: true,
      running: false,
      datasets: ['pay_type'],
      fullRefreshRequired: true,
      missingItems: platforms.map((platform) => ({
        sheet: 'pay_type_daily' as const,
        platform: platform as 'all' | 'web' | 'app',
        datasetKind: 'daily' as const,
        expectedPeriod: `${FULL_REFRESH_START_DATE} ~ ${yesterday}`,
        recordCount: 0,
      })),
    });
  }
  const latestStoredDate = (await latestDailyPeriod(env, 'chain_daily')) || null;
  if (mode === 'latest_day') {
    const startDate = latestStoredDate && latestStoredDate < yesterday
      ? shiftDate(latestStoredDate, 1)
      : yesterday;
    const entries = await Promise.all(sheets.map(async (sheet) => [
      sheet,
      await dailyRows(env, sheet, { startDate, endDate: startDate }),
    ] as const));
    const rowsBySheet = new Map(entries);
    const missingItems = platforms.flatMap((platform) => sheets
      .filter((sheet) => {
        const rows = rowsBySheet.get(sheet) ?? [];
        const platformRows = rows.filter((row) => asText(row.platform) === platform && asText(row.period) === startDate);
        const hasExpectedPayTypeShape = sheet !== 'pay_type_daily' || platformRows.some((row) => !asText(row.analysis_level));
        return platformRows.length === 0 || !hasExpectedPayTypeShape;
      })
      .map((sheet) => ({ sheet, platform, datasetKind: 'daily', expectedPeriod: startDate, recordCount: 0 })));
    const alreadySynced = startDate === yesterday && missingItems.length === 0;
    return json({ mode, startDate, endDate: yesterday, latestStoredDate, platforms, alreadySynced, canSync: !alreadySynced, running: false, missingItems });
  }
  const date = new Date(`${yesterday}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((day + 1) % 7));
  const startDate = date.toISOString().slice(0, 10);
  const end = new Date(date);
  end.setUTCDate(end.getUTCDate() + 6);
  const endDate = end.toISOString().slice(0, 10);
  const entries = await Promise.all(sheets.map(async (sheet) => [
    sheet,
    await dailyRows(env, sheet, { startDate, endDate }),
  ] as const));
  const rowsBySheet = new Map(entries);
  const missingItems = platforms.flatMap((platform) => sheets.flatMap((sheet) => {
    const platformRows = (rowsBySheet.get(sheet) ?? []).filter((row) => asText(row.platform) === platform && asText(row.period) >= startDate && asText(row.period) <= endDate);
    const days = new Set(platformRows.map((row) => asText(row.period)));
    const hasExpectedPayTypeShape = sheet !== 'pay_type_daily' || platformRows.some((row) => !asText(row.analysis_level));
    return days.size === 7 && hasExpectedPayTypeShape ? [] : [{ sheet, platform, datasetKind: 'daily', expectedPeriod: `${startDate} ~ ${endDate}`, recordCount: days.size }];
  }));
  return json({ mode, startDate, endDate, platforms, alreadySynced: missingItems.length === 0, canSync: missingItems.length > 0, running: false, missingItems });
}

const MAXCOMPUTE_NUMBER_FIELDS = new Set([
  'gmv_usd', 'pay_user_cnt', 'creation_cnt_30d_level_id', 'active_uv', 'sub_expose_uv',
  'sub_submit_uv', 'chain_pay_uv', 'chain_gmv_usd', 'sub_expose_rate',
  'sub_submit_rate', 'chain_pay_success_rate', 'chain_arppu', 'creation_uv',
  'creation_task_cnt', 'creation_penetration_rate', 'avg_creation_task_cnt_per_creator',
  'expire_user_cnt', 'renew_user_cnt', 'renew_amount_usd',
]);

function maxComputeConnection(env: Env) {
  const entries = {
    endpoint: env.MAXCOMPUTE_ENDPOINT,
    project: env.MAXCOMPUTE_PROJECT,
    accessKeyId: env.MAXCOMPUTE_ACCESS_KEY_ID,
    accessKeySecret: env.MAXCOMPUTE_ACCESS_KEY_SECRET,
  };
  const missing = Object.entries(entries).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`MaxCompute 配置缺失：${missing.join(', ')}`);
  return entries as { endpoint: string; project: string; accessKeyId: string; accessKeySecret: string };
}

async function pullDailyFacts(env: Env, platform: string, dataset: DatasetKind, startDate: string, endDate: string) {
  const sql = buildDatasetSql(dataset, { platform, start: startDate, end: endDate, granularity: 'daily' });
  const payload = await new MaxComputeClient(maxComputeConnection(env)).executeSql(sql);
  return payload.rows.map((values) => {
    const row: D1Row = {};
    payload.column_names.forEach((column, index) => {
      const key = column.toLowerCase();
      const value = values[index];
      row[key] = MAXCOMPUTE_NUMBER_FIELDS.has(key) ? asNumber(value) : asText(value);
    });
    // The query aggregates by the requested scope; stamp that scope explicitly
    // so D1 reads can always select all / web / app without inference.
    return { ...row, platform, dataset_kind: 'daily' };
  });
}

type DailySheet = 'pay_type_daily' | 'chain_daily' | 'creative_daily' | 'renewal_daily';

type SyncJobState = SyncRunStatus & { runLogId?: string };
const SYNC_DATASETS = ['pay_type', 'chain', 'creative', 'renewal'] as const;
const SYNC_DATASET_LABELS = { pay_type: '付费类型', chain: '支付链路', creative: '创作积极性', renewal: '自动续订' };

function newSyncJob(
  mode: SyncMode,
  startDate: string,
  endDate: string,
  platforms: SyncRunStatus['platforms'],
  datasets: SyncDataset[] = [...SYNC_DATASETS],
): SyncJobState {
  const runId = crypto.randomUUID();
  return {
    runId,
    mode,
    status: 'queued',
    stage: 'pull',
    startDate,
    endDate,
    platforms,
    datasets,
    rowsSynced: 0,
    startedAt: new Date().toISOString(),
    steps: [
      ...platforms.flatMap(platform => datasets.map(dataset => ({
        key: `${platform}-${dataset}`,
        label: `${platform === 'all' ? '全端' : platform === 'web' ? 'Web' : 'App'} · ${SYNC_DATASET_LABELS[dataset]}`,
        status: 'waiting' as const,
      }))),
      { key: 'finish', label: '完成同步', status: 'waiting' as const },
    ],
  };
}

async function stageSyncRows(env: Env, runId: string, stepKey: string, rows: D1Row[]) {
  await env.DB!.prepare('DELETE FROM sync_job_staging_chunks WHERE run_id = ? AND step_key = ?')
    .bind(runId, stepKey).run();
  for (let index = 0; index < rows.length; index += STAGING_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + STAGING_CHUNK_SIZE);
    await env.DB!.prepare('INSERT INTO sync_job_staging_chunks (run_id, step_key, chunk_index, payload, row_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(runId, stepKey, index / STAGING_CHUNK_SIZE, JSON.stringify(chunk), chunk.length, Date.now()).run();
  }
  if (rows.length === 0) {
    await env.DB!.prepare('INSERT INTO sync_job_staging_chunks (run_id, step_key, chunk_index, payload, row_count, created_at) VALUES (?, ?, 0, ?, 0, ?)')
      .bind(runId, stepKey, '[]', Date.now()).run();
  }
}

async function loadStagedRows(env: Env, runId: string, stepKey: string) {
  const chunks = await env.DB!.prepare('SELECT payload FROM sync_job_staging_chunks WHERE run_id = ? AND step_key = ? ORDER BY chunk_index')
    .bind(runId, stepKey).all<{ payload: string }>();
  return chunks.results.flatMap((chunk) => JSON.parse(chunk.payload) as D1Row[]);
}

async function saveSyncJob(env: Env, job: SyncJobState) {
  job.heartbeatAt = new Date().toISOString();
  await env.DB!.prepare('UPDATE sync_jobs SET status = ?, payload = ?, updated_at = ? WHERE run_id = ?')
    .bind(job.status, JSON.stringify(job), Date.now(), job.runId).run();
}

async function ensureSyncRunLog(env: Env, job: SyncJobState) {
  if (job.runLogId) return job.runLogId;
  const created = await baseRequest<{ record?: { record_id?: string } }>(env, 'run_log', '/records', {
    fields: { run_id: job.runId, status: 'running', stage: 'pull', start_date: job.startDate, end_date: job.endDate, platforms: job.platforms.join(','), rows_synced: 0, started_at: job.startedAt },
  });
  job.runLogId = created.record?.record_id;
  if (!job.runLogId) throw new Error('Base run_log 创建失败：未返回 record_id');
  await saveSyncJob(env, job);
  return job.runLogId;
}

async function runBaseSyncStep(env: Env, job: SyncJobState) {
  const firstWaitingStep = job.steps?.find(item => item.key !== 'finish' && item.status === 'waiting');
  if (!firstWaitingStep) {
    const dataSteps = job.steps?.filter(item => item.key !== 'finish') ?? [];
    const staged = await env.DB!.prepare('SELECT step_key, SUM(row_count) AS row_count FROM sync_job_staging_chunks WHERE run_id = ? GROUP BY step_key')
      .bind(job.runId).all<{ step_key: string; row_count: number }>();
    if (staged.results.length !== dataSteps.length || dataSteps.some(item => item.status !== 'success')) {
      throw new Error(`同步暂存结果不完整：应有 ${dataSteps.length} 份，实际 ${staged.results.length} 份`);
    }
    const finish = job.steps?.find(item => item.key === 'finish');
    if (finish) {
      finish.status = 'running';
      finish.detail = `${staged.results.length} 份查询结果已就绪 · 正在统一写入数据库`;
      job.stage = 'write';
      await saveSyncJob(env, job);
      const runLogId = await ensureSyncRunLog(env, job);
      job.rowsSynced = 0;
      for (const item of dataSteps) {
        const separator = item.key.indexOf('-');
        const platform = item.key.slice(0, separator);
        const dataset = item.key.slice(separator + 1) as DatasetKind;
        const rows = await loadStagedRows(env, job.runId, item.key);
        if (!FACT_DATASETS.has(dataset)) throw new Error(`同步数据集无效：${dataset}`);
        job.rowsSynced += await replaceFactRange(env, dataset, platform, job.startDate, job.endDate, rows);
        finish.detail = `正在统一写入数据库 · ${job.rowsSynced.toLocaleString('en-US')} 条分析记录`;
        await saveSyncJob(env, job);
      }
      await baseRequest(env, 'run_log', `/records/${runLogId}`, {
        fields: { status: 'success', stage: 'write', rows_synced: job.rowsSynced, finished_at: new Date().toISOString() },
      }, 'PUT');
      finish.status = 'success';
      finish.detail = `共写入数据库 ${job.rowsSynced.toLocaleString('en-US')} 条分析记录`;
    }
    job.status = 'success';
    job.finishedAt = new Date().toISOString();
    await saveSyncJob(env, job);
    await env.DB!.prepare('DELETE FROM sync_job_staging_chunks WHERE run_id = ?').bind(job.runId).run();
    invalidateBaseCache('run_log');
    await invalidateDashboardCache(env);
    return;
  }

  const separator = firstWaitingStep.key.indexOf('-');
  const dataset = firstWaitingStep.key.slice(separator + 1) as DatasetKind;
  if (!SYNC_DATASETS.includes(dataset)) throw new Error(`同步步骤无效：${firstWaitingStep.key}`);
  const batchSteps = job.steps?.filter(item => item.status === 'waiting' && item.key.endsWith(`-${dataset}`)) ?? [];
  for (const step of batchSteps) {
    const platform = step.key.slice(0, step.key.indexOf('-'));
    if (!DASHBOARD_PLATFORMS.has(platform)) throw new Error(`同步步骤无效：${step.key}`);
    step.status = 'running';
    step.detail = '正在并发查询业务数据库';
  }
  job.stage = 'pull';
  await saveSyncJob(env, job);

  const results = await Promise.allSettled(batchSteps.map(async step => {
    const platform = step.key.slice(0, step.key.indexOf('-'));
    const rows = await pullDailyFacts(env, platform, dataset, job.startDate, job.endDate);
    return { step, rows };
  }));
  let failure: unknown;
  for (const [index, result] of results.entries()) {
    const step = batchSteps[index];
    if (result.status === 'rejected') {
      step.status = 'failed';
      step.detail = undefined;
      failure ??= result.reason;
      continue;
    }
    const { rows } = result.value;
    await stageSyncRows(env, job.runId, step.key, rows);
    step.status = 'success';
    step.detail = `已暂存 ${rows.length.toLocaleString('en-US')} 条聚合记录`;
  }
  if (failure) throw failure;
  const control = await env.DB!.prepare('SELECT status FROM sync_jobs WHERE run_id = ?')
    .bind(job.runId).first<{ status: SyncRunStatus['status'] }>();
  job.status = control?.status === 'pausing' || control?.status === 'paused' ? 'paused' : 'queued';
  job.stage = 'pull';
  await saveSyncJob(env, job);
}

async function createSyncRun(env: Env, request: Request) {
  if (!env.DB) return errorResponse('同步任务数据库未配置', 503);
  await latestSync(env);
  const body = await request.json().catch(() => ({})) as { mode?: SyncMode; platforms?: string[]; datasets?: string[] };
  const mode: SyncMode = body.mode === 'full_refresh' ? 'full_refresh' : body.mode === 'latest_week' ? 'latest_week' : 'latest_day';
  const planResponse = await syncPlan(env, mode);
  const plan = await planResponse.json() as {
    startDate: string;
    endDate: string;
    platforms: string[];
    datasets?: SyncDataset[];
    fullRefreshRequired?: boolean;
    alreadySynced?: boolean;
  };
  const requestedPlatforms = body.platforms?.filter((platform) => DASHBOARD_PLATFORMS.has(platform)) ?? plan.platforms;
  const platforms = [...new Set(requestedPlatforms)];
  const requestedDatasets = body.datasets?.filter((dataset): dataset is SyncDataset => SYNC_DATASETS.includes(dataset as SyncDataset)) ?? plan.datasets ?? [...SYNC_DATASETS];
  const datasets = plan.fullRefreshRequired ? ['pay_type'] as SyncDataset[] : [...new Set(requestedDatasets)];
  if (!platforms.length) return errorResponse('请选择同步端口', 400);
  if (!datasets.length) return errorResponse('请选择同步数据集', 400);
  if (plan.alreadySynced) return json({ runId: `base-${Date.now()}`, mode, ...plan, status: 'success', rowsSynced: 0, skipped: true, skipReason: 'Base 已包含目标日期数据' });
  const active = await env.DB.prepare("SELECT payload FROM sync_jobs WHERE status IN ('queued', 'running', 'pausing', 'paused') ORDER BY created_at DESC LIMIT 1").first<{ payload: string }>();
  if (active) return json(JSON.parse(active.payload));
  const effectiveMode = plan.fullRefreshRequired ? 'full_refresh' : mode;
  const job = newSyncJob(effectiveMode, plan.startDate, plan.endDate, platforms as SyncRunStatus['platforms'], datasets);
  const { runId } = job;
  await env.DB.prepare("INSERT OR IGNORE INTO sync_jobs (run_id, status, payload, created_at, updated_at) VALUES (?, 'queued', ?, ?, ?)")
    .bind(runId, JSON.stringify(job), Date.now(), Date.now()).run();
  return json(job);
}

async function retrySyncRun(env: Env, request: Request) {
  if (!env.DB) return errorResponse('同步任务数据库未配置', 503);
  await latestSync(env);
  const { runId } = await request.json().catch(() => ({})) as { runId?: string };
  if (!runId) return errorResponse('缺少原任务 ID');
  const sourceRow = await env.DB.prepare('SELECT payload FROM sync_jobs WHERE run_id = ?').bind(runId).first<{ payload: string }>();
  if (!sourceRow) return errorResponse('未找到原数据同步任务', 404);
  const source = JSON.parse(sourceRow.payload) as SyncJobState;
  if (['queued', 'running', 'pausing', 'paused'].includes(source.status)) return errorResponse('该数据同步任务尚未结束', 409);
  const active = await env.DB.prepare("SELECT run_id FROM sync_jobs WHERE status IN ('queued', 'running', 'pausing', 'paused') LIMIT 1").first<{ run_id: string }>();
  if (active) return errorResponse('已有数据同步任务正在运行，请完成后再试', 409);
  const platforms = [...new Set(source.platforms)] as SyncRunStatus['platforms'];
  const job = newSyncJob(source.mode ?? 'latest_day', source.startDate, source.endDate, platforms, source.datasets ?? [...SYNC_DATASETS]);
  await env.DB.prepare("INSERT INTO sync_jobs (run_id, status, payload, created_at, updated_at) VALUES (?, 'queued', ?, ?, ?)")
    .bind(job.runId, JSON.stringify(job), Date.now(), Date.now()).run();
  return json(job, 202);
}

async function controlSyncRun(env: Env, request: Request, action: 'pause' | 'resume') {
  if (!env.DB) return errorResponse('同步任务数据库未配置', 503);
  const { runId } = await request.json().catch(() => ({})) as { runId?: string };
  if (!runId) return errorResponse('缺少任务 ID');
  const row = await env.DB.prepare('SELECT status, payload FROM sync_jobs WHERE run_id = ?')
    .bind(runId).first<{ status: SyncRunStatus['status']; payload: string }>();
  if (!row) return errorResponse('未找到数据同步任务', 404);
  const job = JSON.parse(row.payload) as SyncJobState;
  if (action === 'pause') {
    if (row.status === 'paused' || row.status === 'pausing') return json(job);
    if (row.status !== 'queued' && row.status !== 'running') return errorResponse('当前任务无法暂停', 409);
    if (job.stage === 'write') return errorResponse('数据正在统一写入 Base，该阶段不可暂停', 409);
    job.status = row.status === 'queued' ? 'paused' : 'pausing';
  } else {
    if (row.status !== 'paused') return errorResponse('只有已暂停的任务可以继续', 409);
    job.status = 'queued';
    job.errorMessage = undefined;
    job.finishedAt = undefined;
  }
  await saveSyncJob(env, job);
  return json(job);
}

async function executeSyncRun(env: Env, request: Request) {
  if (!env.DB) return errorResponse('同步任务数据库未配置', 503);
  const { runId } = await request.json() as { runId: string };
  const claimed = await env.DB.prepare("UPDATE sync_jobs SET status = 'running', updated_at = ? WHERE run_id = ? AND status = 'queued' RETURNING payload")
    .bind(Date.now(), runId).first<{ payload: string }>();
  if (!claimed) return json({ message: '任务已由后台接管或已结束' });
  const job = JSON.parse(claimed.payload) as SyncJobState;
  job.status = 'running';
  job.heartbeatAt = new Date().toISOString();
  await env.DB.prepare("UPDATE sync_jobs SET payload = ?, updated_at = ? WHERE run_id = ?")
    .bind(JSON.stringify(job), Date.now(), runId).run();
  const encoder = new TextEncoder();
  let disconnected = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const pulse = setInterval(() => { if (!disconnected) controller.enqueue(encoder.encode(' ')); }, 5000);
      const heartbeat = setInterval(() => {
        void env.DB!.prepare("UPDATE sync_jobs SET updated_at = ? WHERE run_id = ? AND status IN ('running', 'pausing')")
          .bind(Date.now(), job.runId).run().catch(() => undefined);
      }, 10000);
      try {
        await runBaseSyncStep(env, job);
      } catch (error) {
        const control = await env.DB!.prepare('SELECT status FROM sync_jobs WHERE run_id = ?').bind(runId).first<{ status: SyncRunStatus['status'] }>();
        if (control?.status === 'pausing' || control?.status === 'paused') {
          job.status = 'paused';
          job.steps?.forEach(step => { if (step.status === 'running' || step.status === 'failed') { step.status = 'waiting'; step.detail = undefined; } });
          await saveSyncJob(env, job).catch(() => undefined);
        } else {
          job.status = 'failed';
          job.errorMessage = error instanceof Error ? error.message : String(error);
          job.finishedAt = new Date().toISOString();
          job.steps?.forEach(step => { if (step.status === 'running') { step.status = 'failed'; step.detail = undefined; } });
          if (job.runLogId) await baseRequest(env, 'run_log', `/records/${job.runLogId}`, {
            fields: { status: 'failed', error_message: job.errorMessage, rows_synced: job.rowsSynced, finished_at: job.finishedAt },
          }, 'PUT').catch(() => undefined);
          if (!job.runLogId) await env.DB!.prepare('DELETE FROM sync_job_staging_chunks WHERE run_id = ?').bind(runId).run().catch(() => undefined);
          await env.DB!.prepare("UPDATE sync_jobs SET status = 'failed', payload = ?, updated_at = ? WHERE run_id = ? AND status = 'running'")
            .bind(JSON.stringify(job), Date.now(), runId).run().catch(() => undefined);
        }
      } finally {
        clearInterval(heartbeat);
        clearInterval(pulse);
        if (!disconnected) { controller.enqueue(encoder.encode(JSON.stringify({ status: job.status }))); controller.close(); }
      }
    },
    cancel() { disconnected = true; },
  });
  return new Response(stream, { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

function reportDependencies(env: Env) {
  return {
    collect: (body: ReportGenerationRequest, progress: ReportProgress) => collectReportEvidence(env, body, progress),
    persist: (report: ReportSummary) => persistGeneratedReport(env, report),
    persistTask: (job: ReportGenerationStatus) => persistReportTaskToBase(env, job),
  };
}

async function runScheduledSync(env: Env) {
  const response = await createSyncRun(env, new Request('https://schedule.internal/api/sync-runs', {
    method: 'POST', body: JSON.stringify({ mode: 'latest_day', platforms: ['all', 'web', 'app'], datasets: [...SYNC_DATASETS] }),
    headers: { 'content-type': 'application/json' },
  }));
  const job = await response.json() as SyncRunResponse;
  if (!response.ok || job.status === 'failed') throw new Error(job.errorMessage || '定时同步任务创建失败');
  if (job.skipped || job.status === 'success') return job;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const executionResponse = await executeSyncRun(env, new Request('https://schedule.internal/api/sync-runs/run', {
      method: 'POST', body: JSON.stringify({ runId: job.runId }), headers: { 'content-type': 'application/json' },
    }));
    const executionBody = await executionResponse.text();
    const executionStatus = executionBody.match(/\{"status":"(success|failed|paused)"\}/)?.[1];
    if (executionStatus === 'success') return { ...job, status: 'success' };
    if (executionStatus === 'failed') throw new Error('定时同步失败');
    const current = await env.DB!.prepare('SELECT payload FROM sync_jobs WHERE run_id = ?').bind(job.runId).first<{ payload: string }>();
    if (!current) throw new Error('定时同步任务状态丢失');
    const status = JSON.parse(current.payload) as SyncRunStatus;
    if (status.status === 'success') return status;
    if (status.status === 'failed') throw new Error(status.errorMessage || '定时同步失败');
  }
  throw new Error('定时同步超过最大执行步骤');
}

async function runScheduledReports(env: Env) {
  const localDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  // Report requests include both the baseline week and the latest analysis week.
  const startDate = shiftDate(localDate, -14);
  const endDate = shiftDate(localDate, -1);
  const deps = reportDependencies(env);
  await Promise.all((['web', 'app'] as const).map(async platform => {
    const response = await reportGenerations(env, new Request('https://schedule.internal/api/report-generations', {
      method: 'POST', body: JSON.stringify({ platform, granularity: 'week', startDate, endDate }),
      headers: { 'content-type': 'application/json' },
    }), deps);
    const job = await response.json() as ReportGenerationStatus & { message?: string };
    if (!response.ok && response.status !== 202) throw new Error(job.message || `${platform} 定时报告任务创建失败`);
    if (job.status === 'queued') await executeReport(env, job, deps);
  }));
}

async function cronHandler(env: Env, request: Request): Promise<Response> {
  if (request.headers.get('x-pollocloud-trigger') !== 'cron') return errorResponse('仅允许 Pollo Cloud 定时任务触发', 403);
  const path = new URL(request.url).pathname;
  if (path === '/api/cron/daily') {
    const result = await runScheduledSync(env);
    return json({ ok: true, task: 'daily-sync', status: result.status, runId: result.runId });
  }
  if (path === '/api/cron/weekly-reports') {
    await runScheduledReports(env);
    return json({ ok: true, task: 'weekly-reports' });
  }
  return errorResponse('定时任务不存在', 404);
}

type ReportProgress = (key: string, status: NonNullable<ReportGenerationStatus['steps']>[number]['status'], detail?: string) => Promise<void>;

async function collectReportEvidence(env: Env, request: ReportGenerationRequest, progress: ReportProgress) {
  const { platform, startDate, endDate } = request;
  const analysisPeriod = shiftDate(startDate, 7);
  const params = new URLSearchParams({ platform, startDate, endDate, baselinePeriod: startDate, analysisPeriod });
  const readAttribution = async (dimension: string, extra: Record<string, string> = {}) => {
    const query = new URLSearchParams(params);
    query.set('dimension', dimension);
    Object.entries(extra).forEach(([key, value]) => query.set(key, value));
    const response = await attributions(env, new Request(`https://report.internal/api/dashboard/attributions?${query}`));
    if (!response.ok) throw new Error('归因数据读取失败');
    return await response.json() as DashboardAttributionsResponse;
  };
  const read = async (key: string, table: 'pay_type_daily' | 'chain_daily' | 'renewal_daily' | 'creative_daily', dimension: string, extra = {}) => {
    await progress(key, 'running');
    const rows = await dailyRows(env, table, { platform, startDate, endDate });
    const dates = new Set(rows.map(row => asText(row.period)));
    const analysisEnd = shiftDate(analysisPeriod, 6);
    const isIncompleteAnalysis = endDate < analysisEnd;
    const baselineDates = Array.from({ length: 7 }, (_, i) => shiftDate(startDate, i));
    const analysisExpectedDays = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${analysisPeriod}T00:00:00Z`)) / 86400000) + 1;
    const analysisExpectedDates = Array.from({ length: analysisExpectedDays }, (_, i) => shiftDate(analysisPeriod, i));
    const missingBaseline = baselineDates.filter(date => !dates.has(date));
    const missingAnalysis = analysisExpectedDates.filter(date => !dates.has(date));
    if (missingBaseline.length || (!isIncompleteAnalysis && missingAnalysis.length)) {
      const missing = [...missingBaseline, ...missingAnalysis];
      throw new Error(`${table} 缺少 ${missing.join('、')} 的数据，请先同步后再生成。`);
    }
    const observedAnalysisDays = analysisExpectedDates.filter(date => dates.has(date)).length;
    if (!observedAnalysisDays) throw new Error(`${table} 在分析业务周暂无可用数据，请先同步后再生成。`);
    const data = await readAttribution(dimension, extra);
    const coverage = isIncompleteAnalysis
      ? `基准期 7 个业务日 · 分析期 ${observedAnalysisDays}/${analysisExpectedDays} 个业务日`
      : `${baselineDates.length + analysisExpectedDays} 个业务日`;
    await progress(key, 'success', `已读取 ${rows.length.toLocaleString('en-US')} 条记录 · ${coverage}`);
    return data;
  };
  const results = await Promise.allSettled([
    read('pay', 'pay_type_daily', 'pay_type'), read('chain', 'chain_daily', 'chain'),
    read('renewal', 'renewal_daily', 'chain', { chainType: 'renewal' }), read('creative', 'creative_daily', 'creative'),
  ]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  const [pay, chain, renewal, creative] = results.map(result => (result as PromiseFulfilledResult<DashboardAttributionsResponse>).value);
  await progress('analyze', 'running');
  const coreTier = [...chain.items].filter(item => (item.contribution ?? 0) > 0).sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0))[0];
  const coreChain = coreTier ? await readAttribution('chain', { creationTier: coreTier.key }) : chain;
  const actions = (await productActionRows(env)).filter(row => {
    const dateValue = row.release_time || row.stat_date;
    const date = typeof dateValue === 'number' ? new Date(dateValue).toISOString().slice(0, 10) : asText(dateValue).slice(0, 10);
    const scope = asText(row.platform || 'web').toLowerCase();
    return dateInRange(date, startDate, endDate) && ['新增功能', '优化'].includes(asText(row.action_type)) && (scope.includes(platform) || /全部|双端/.test(scope));
  });
  const labels: Record<string, string> = Object.fromEntries(TIER_ORDER.map((tier, i) => [tier, ['分析期前30日无创作用户', '分析期前30日创作1-10次用户', '分析期前30日创作11-30次用户', '分析期前30日创作31-100次用户', '分析期前30日创作101次以上用户'][i]]));
  const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const percent = (value: number | null) => value == null ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
  const itemTable = (items: AttributionItem[]) => ['| 维度 | 基准期日均 | 分析期日均 | 周环比 | 贡献度 |', '| --- | ---: | ---: | ---: | ---: |', ...items.map(item => `| ${labels[item.key] || item.key} | $${number(item.baselineDailyAvg)} | $${number(item.analysisDailyAvg)} | ${percent(item.wowChange)} | ${percent(item.contribution)} |`)].join('\n');
  const driverTable = (drivers: AttributionDriverItem[]) => {
    const value = (driver: AttributionDriverItem, amount: number) => /Rate/.test(driver.metricKey) ? `${(amount * 100).toFixed(2)}%` : /Arppu|Aov/.test(driver.metricKey) ? `$${number(amount)}` : number(amount);
    return ['| 指标 | 基准期 | 分析期 | 周环比 | 贡献度 |', '| --- | ---: | ---: | ---: | ---: |', ...drivers.map(driver => `| ${driver.metric} | ${value(driver, driver.previousValue)} | ${value(driver, driver.value)} | ${percent(driver.wowChange)} | ${percent(driver.contribution)} |`)].join('\n');
  };
  // Give the model display-ready, consistently daily figures instead of mixing
  // weekly totals, daily averages and unformatted percentage ratios.
  const money = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const gmvEvidence = (baseline: number, analysis: number) => ({ 基准期日均GMV: money(baseline), 分析期日均GMV: money(analysis), 日均增量: money(analysis - baseline), 周环比: percent(baseline ? (analysis - baseline) / baseline : null) });
  const itemsEvidence = (items: AttributionItem[]) => items.map(item => ({ 名称: labels[item.key] || item.key, ...gmvEvidence(item.baselineDailyAvg, item.analysisDailyAvg), 贡献度: percent(item.contribution) }));
  const driversEvidence = (drivers: AttributionDriverItem[]) => drivers.map(driver => {
    const value = (amount: number) => /Rate/.test(driver.metricKey) ? `${(amount * 100).toFixed(2)}%` : /Arppu|Aov/.test(driver.metricKey) ? money(amount) : number(amount);
    return { 指标: driver.metric, 基准期: value(driver.previousValue), 分析期: value(driver.value), 周环比: percent(driver.wowChange), 贡献度: percent(driver.contribution) };
  });
  const totalEvidence = (items: AttributionItem[]) => gmvEvidence(sum(items.map(item => item.baselineDailyAvg)), sum(items.map(item => item.analysisDailyAvg)));
  const renewalGmv = (period: string) => Number(renewal.trend.find(point => point.period === period)?.gmv ?? 0);
  const creativeEvidence = creative.items.map(item => ({
    分层: labels[item.key] || item.key,
    指标: Object.entries(creative.metricLabels).map(([key, label]) => {
      const baseline = item.previousMetrics?.[key] ?? 0;
      const analysis = item.metrics?.[key] ?? 0;
      const value = (amount: number) => /Rate/.test(key) ? `${(amount * 100).toFixed(2)}%` : number(amount);
      return { 指标: label, 基准期: value(baseline), 分析期: value(analysis), 周环比: percent(baseline ? (analysis - baseline) / baseline : null) };
    }),
  }));
  const overallCreative = (period: string) => creative.trend.find(point => point.period === period) as Record<string, unknown> | undefined;
  const creativeOverall = Object.entries(creative.metricLabels).map(([key, label]) => {
    const baseline = Number(overallCreative(startDate)?.[key] ?? 0);
    const analysis = Number(overallCreative(analysisPeriod)?.[key] ?? 0);
    const value = (amount: number) => /Rate/.test(key) ? `${(amount * 100).toFixed(2)}%` : number(amount);
    return { 指标: label, 基准期: value(baseline), 分析期: value(analysis), 周环比: percent(baseline ? (analysis - baseline) / baseline : null) };
  });
  const rankedDrivers = [...(coreChain.drivers || [])].filter(driver => (driver.contribution ?? 0) > 0)
    .sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0));
  const coreDriver = rankedDrivers[0];
  let inflection: unknown = null;
  if (coreTier && coreDriver) {
    const rows = (await dailyRows(env, 'chain_daily', { platform, startDate, endDate }))
      .filter(row => tierKey(row) === coreTier.key);
    const analysisDates = [...new Set(
      rows
        .map(row => asText(row.period))
        .filter(date => date >= analysisPeriod && date <= endDate),
    )].sort();
    const valueForDate = (date: string) => {
      const metrics = chainMetrics(sumChain(rows.filter(row => asText(row.period) === date)));
      return metrics[coreDriver.metricKey as keyof typeof metrics];
    };
    const baselineMean = analysisDates.length
      ? average(analysisDates.map(date => valueForDate(shiftDate(date, -7))))
      : 0;
    const analysisDaily = analysisDates.map(date => ({ date, value: valueForDate(date) }));
    const direction = Math.sign(coreDriver.change);
    const first = direction ? analysisDaily.find((_, i) => analysisDaily.slice(i).every(item => (item.value - baselineMean) * direction > 0)) : undefined;
    inflection = { 指标: coreDriver.metric, 持续变动开始日: first?.date ?? null, 方向: direction > 0 ? '持续高于基准周日均' : direction < 0 ? '持续低于基准周日均' : '无变化', 无拐点时: '仅可使用较弱的周级时序证据' };
  }
  await progress('analyze', 'success', '已按所选业务周和前一周计算归因');
  return {
    evidence: {
      platform, baselineWeek: `${startDate} ~ ${shiftDate(startDate, 6)}`, analysisWeek: `${analysisPeriod} ~ ${endDate}`,
      付费总收入: { 数据源: 'pay_type_daily', ...totalEvidence(pay.items), 一级构成: itemsEvidence(pay.items), 主动付费下钻: itemsEvidence(pay.sections?.[1]?.items || []) },
      主动支付链路: { 数据源: 'chain_daily', ...totalEvidence(chain.items), 创作分层: itemsEvidence(chain.items), 核心分层: coreTier ? labels[coreTier.key] || coreTier.key : '全部', 核心分层过程因子: driversEvidence(coreChain.drivers || []), 同向因子排名: driversEvidence(rankedDrivers), 核心因子拐点: inflection },
      自动续订链路: { 数据源: 'renewal_daily', ...gmvEvidence(renewalGmv(startDate), renewalGmv(analysisPeriod)), 过程因子: driversEvidence(renewal.drivers || []) },
      创作侧证: { 整体: creativeOverall, 分层: creativeEvidence }, productActions: actions,
    },
    tables: { PAY_TYPE_PRIMARY_TABLE: itemTable(pay.items), PAY_TYPE_DRILL_TABLE: itemTable(pay.sections?.[1]?.items || []), CHAIN_TIER_TABLE: itemTable(chain.items), CHAIN_DRIVER_TABLE: driverTable(coreChain.drivers || []), RENEWAL_DRIVER_TABLE: driverTable(renewal.drivers || []) },
  };
}

async function persistGeneratedReport(env: Env, report: ReportSummary) {
  const now = Date.now();
  const reportFields = {
    platform: report.platform,
    period_start: report.periodStart,
    period_end: report.periodEnd,
    model_used: report.modelUsed,
    degraded: report.degraded ? 'true' : 'false',
    generated_at: report.generatedAt,
    report_md: report.markdown,
  };
  const d1Fields = [
    report.platform,
    report.periodStart,
    report.periodEnd,
    report.modelUsed,
    report.degraded ? 'true' : 'false',
    report.generatedAt,
    report.markdown,
    now,
  ];
  let d1Error: unknown;
  let baseError: unknown;
  try {
    if (!env.DB) throw new Error('D1 未配置');
    await env.DB.prepare(`INSERT OR REPLACE INTO pollo_da_reports
      (report_kind, report_key, platform, period_start, period_end, model_used, degraded, generated_at, report_md, updated_at)
      VALUES ('history', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`${report.platform}:${report.periodStart}:${report.periodEnd}`, ...d1Fields).run();
    await env.DB.prepare(`INSERT OR REPLACE INTO pollo_da_reports
      (report_kind, report_key, platform, period_start, period_end, model_used, degraded, generated_at, report_md, updated_at)
      VALUES ('latest', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(report.platform, ...d1Fields).run();
  } catch (error) {
    d1Error = error;
  }
  try {
    for (const sheet of ['report_history', 'latest_report'] as const) {
      const parts = [`CurrentValue.[platform]="${escapeBaseFormulaValue(report.platform)}"`];
      if (sheet === 'report_history') parts.push(`CurrentValue.[period_start]="${escapeBaseFormulaValue(report.periodStart)}"`, `CurrentValue.[period_end]="${escapeBaseFormulaValue(report.periodEnd)}"`);
      const records = await baseRecords(env, sheet, true, { filter: parts.length > 1 ? `AND(${parts.join(',')})` : parts[0], sort: ['generated_at DESC'], limit: 1 });
      const existing = records[0];
      await baseRequest(env, sheet, existing ? `/records/${existing.id}` : '/records', { fields: reportFields }, existing ? 'PUT' : 'POST');
      invalidateBaseCache(sheet);
    }
  } catch (error) {
    baseError = error;
  }
  if (d1Error || baseError) {
    const failures = [d1Error ? `D1：${String(d1Error)}` : '', baseError ? `Base：${String(baseError)}` : ''].filter(Boolean).join('；');
    throw new Error(`报告未完成双写：${failures}`);
  }
}

async function persistReportTaskToBase(env: Env, job: ReportGenerationStatus) {
  const fields = {
    run_id: job.runId,
    platform: job.platform,
    granularity: 'week',
    period_start: job.periodStart,
    period_end: job.periodEnd,
    status: job.status,
    stage: job.stage,
    requested_at: job.startedAt,
    started_at: job.startedAt,
    heartbeat_at: job.heartbeatAt,
    finished_at: job.finishedAt,
    error_message: job.errorMessage,
    model_used: job.report?.modelUsed,
  };
  const existing = await baseRecords(env, 'report_generation_jobs', true, {
    filter: `CurrentValue.[run_id]="${escapeBaseFormulaValue(job.runId)}"`,
    limit: 1,
  });
  if (existing[0]) {
    await baseRequest(env, 'report_generation_jobs', `/records/${existing[0].id}`, { fields }, 'PUT');
  } else {
    await baseRequest(env, 'report_generation_jobs', '/records', { fields });
  }
  invalidateBaseCache('report_generation_jobs');
}

async function reportHandler(env: Env, request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform');
  if (url.pathname.startsWith('/api/report-generations')) return reportGenerations(env, request, {
    collect: (body, progress) => collectReportEvidence(env, body, progress),
    persist: report => persistGeneratedReport(env, report),
    persistTask: job => persistReportTaskToBase(env, job),
  });
  if (platform && !REPORT_PLATFORMS.has(platform)) return errorResponse('platform 必须是 web / app 之一');
  if (request.method === 'GET' && url.pathname === '/api/report-latest') {
    let item: D1Row | undefined;
    try {
      item = (await baseRecords(env, 'latest_report', false, { filter: platform ? `CurrentValue.[platform]="${escapeBaseFormulaValue(platform)}"` : undefined, sort: ['generated_at DESC'], limit: 1 }))[0]?.fields;
    } catch {
      item = (await queryRows(env, `SELECT platform, period_start, period_end, model_used, degraded, generated_at, report_md FROM pollo_da_reports WHERE report_kind = 'latest' ${platform ? 'AND platform = ?' : ''} ORDER BY generated_at DESC LIMIT 1`, ...(platform ? [platform] : [])))[0];
    }
    return json(item ? { platform: asText(item.platform), periodStart: asText(item.period_start), periodEnd: asText(item.period_end), modelUsed: asText(item.model_used), degraded: asText(item.degraded) === 'true', markdown: asText(item.report_md), generatedAt: asText(item.generated_at) } : null);
  }
  if (request.method === 'GET' && url.pathname === '/api/report-history') {
    let rows: D1Row[];
    try {
      rows = (await baseRecords(env, 'report_history', false, { filter: platform ? `CurrentValue.[platform]="${escapeBaseFormulaValue(platform)}"` : undefined, sort: ['generated_at DESC'], fields: PREVIEW_FIELDS.report_history.filter(field => field !== 'report_md') })).map(record => record.fields);
    } catch {
      rows = await queryRows(env, `SELECT platform, period_start, period_end, model_used, degraded, generated_at FROM pollo_da_reports WHERE report_kind = 'history' ${platform ? 'AND platform = ?' : ''} ORDER BY generated_at DESC`, ...(platform ? [platform] : []));
    }
    return json(rows.map((row) => ({ platform: asText(row.platform), periodStart: asText(row.period_start), periodEnd: asText(row.period_end), modelUsed: asText(row.model_used), degraded: asText(row.degraded) === 'true', generatedAt: asText(row.generated_at) })));
  }
  if (request.method === 'GET' && url.pathname === '/api/report-history/detail') {
    const periodStart = url.searchParams.get('periodStart');
    const periodEnd = url.searchParams.get('periodEnd');
    let row: D1Row | null = null;
    try {
      const filter = `AND(CurrentValue.[platform]="${escapeBaseFormulaValue(platform || '')}",CurrentValue.[period_start]="${escapeBaseFormulaValue(periodStart || '')}",CurrentValue.[period_end]="${escapeBaseFormulaValue(periodEnd || '')}")`;
      row = (await baseRecords(env, 'report_history', false, { filter, sort: ['generated_at DESC'], limit: 1 }))[0]?.fields || null;
    } catch {
      row = await env.DB!.prepare(`SELECT platform, period_start, period_end, model_used, degraded, generated_at, report_md FROM pollo_da_reports WHERE report_kind = 'history' AND platform = ? AND period_start = ? AND period_end = ? ORDER BY generated_at DESC LIMIT 1`).bind(platform || '', periodStart || '', periodEnd || '').first<D1Row>();
    }
    return json(row ? { platform: asText(row.platform), periodStart: asText(row.period_start), periodEnd: asText(row.period_end), modelUsed: asText(row.model_used), degraded: asText(row.degraded) === 'true', markdown: asText(row.report_md), generatedAt: asText(row.generated_at) } : null);
  }
  return errorResponse('报告接口不存在', 404);
}

export default {
  async fetch(request: Request, env: Env, context: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/cron/')) return cronHandler(env, request);
      if (url.pathname === '/api/dashboard/overview' && request.method === 'GET') return cachedDashboardResponse(env, request, context, () => overview(env, request));
      if (url.pathname === '/api/dashboard/gmv-coverage' && request.method === 'GET') return cachedDashboardResponse(env, request, context, () => gmvCoverage(env));
      if (url.pathname === '/api/dashboard/gmv-anomalies' && request.method === 'GET') return cachedDashboardResponse(env, request, context, () => gmvAnomalies(env));
      if (url.pathname === '/api/dashboard/attributions' && request.method === 'GET') return cachedDashboardResponse(env, request, context, () => attributions(env, request));
      if (url.pathname === '/api/workbook-preview' && request.method === 'GET') return workbookPreview(env, request);
      if (url.pathname === '/api/sync-runs/latest' && request.method === 'GET') return latestSync(env);
      if (url.pathname === '/api/sync-runs/latest-day-plan' && request.method === 'GET') return syncPlan(env, 'latest_day');
      if (url.pathname === '/api/sync-runs/latest-week-plan' && request.method === 'GET') return syncPlan(env, 'latest_week');
      if (url.pathname === '/api/sync-runs' && request.method === 'POST') {
        const denial = await authorizeDashboardMutation(request);
        return denial || createSyncRun(env, request);
      }
      if (url.pathname === '/api/sync-runs/retry' && request.method === 'POST') {
        const denial = await authorizeDashboardMutation(request);
        return denial || retrySyncRun(env, request);
      }
      if (url.pathname === '/api/sync-runs/pause' && request.method === 'POST') {
        const denial = await authorizeDashboardMutation(request);
        return denial || controlSyncRun(env, request, 'pause');
      }
      if (url.pathname === '/api/sync-runs/resume' && request.method === 'POST') {
        const denial = await authorizeDashboardMutation(request);
        return denial || controlSyncRun(env, request, 'resume');
      }
      if (url.pathname === '/api/sync-runs/run' && request.method === 'POST') {
        const denial = await authorizeDashboardMutation(request);
        return denial || executeSyncRun(env, request);
      }
      if (url.pathname.startsWith('/api/report-generations') && request.method === 'POST') {
        const denial = await authorizeDashboardMutation(request);
        if (denial) return denial;
      }
      if (url.pathname.startsWith('/api/report')) return reportHandler(env, request);
      if (url.pathname === '/api/admin-members') return errorResponse('请通过 Pollo Cloud 管理访问成员', 501);
      return errorResponse('API route not found', 404);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return errorResponse(message, 500);
    }
  },
};
