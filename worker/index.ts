/* Pollocloud Worker: Feishu Base is the analytical source of truth. */

import { MaxComputeClient } from '../server/modules/maxcompute/maxcompute.client';
import { buildDatasetSql, type DatasetKind } from '../server/modules/maxcompute/sql-templates';
import { POLLOCLOUD_APP_OWNER_ID } from '../shared/auth.constants';

type D1Row = Record<string, string | number | null>;
type D1Result<T> = { results: T[] };
type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  all: <T = D1Row>() => Promise<D1Result<T>>;
  first: <T = D1Row>() => Promise<T | null>;
  run: () => Promise<unknown>;
};
type D1Database = { prepare: (sql: string) => D1Statement };
type Env = {
  DB?: D1Database;
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  MAXCOMPUTE_ENDPOINT?: string;
  MAXCOMPUTE_PROJECT?: string;
  MAXCOMPUTE_ACCESS_KEY_ID?: string;
  MAXCOMPUTE_ACCESS_KEY_SECRET?: string;
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
const PLATFORMS = new Set(['web', 'app']);
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
const PRIMARY_PAY_LEVELS = new Set(['一级_付费类型', '一级_订阅方式']);
const ACTIVE_PAY_LEVELS = new Set(['三级_主动付费下钻']);
const TIER_ORDER = [
  'create_cnt_30d_0',
  'create_cnt_30d_[1,11)',
  'create_cnt_30d_[11,31)',
  'create_cnt_30d_[31,101)',
  'create_cnt_30d_[101,+inf)',
];
const USER_TAG_ORDER = ['新用户', '老用户', '未知'];

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
  const cacheKey = `${sheet}|${options.filter ?? '*'}|${JSON.stringify(options.sort ?? [])}|${options.limit ?? '*'}`;
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
      const usesListApi = Boolean(options.filter || options.sort?.length);
      const data = await baseRequest<{
        items?: Array<{ record_id: string; fields: Record<string, unknown> }>;
        has_more?: boolean;
        page_token?: string;
      }>(
        env,
        sheet,
        `/${usesListApi ? 'records' : 'records/search'}?${query}`,
        usesListApi ? undefined : {},
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

async function dailyRows(env: Env, table: 'pay_type_daily' | 'chain_daily' | 'creative_daily' | 'renewal_daily', params: {
  platform?: string;
  startDate?: string;
  endDate?: string;
  deviceType?: string;
}) {
  const records = await baseRecords(env, table, false, {
    filter: buildBaseFilterFormula(params),
  });
  return records
    .map((record) => record.fields)
    .filter((row) => !params.platform || asText(row.platform) === params.platform)
    .filter((row) => !params.startDate || asText(row.period) >= params.startDate)
    .filter((row) => !params.endDate || asText(row.period) <= params.endDate)
    .filter((row) => !params.deviceType || asText(row.device_type) === params.deviceType)
    .sort((left, right) => asText(left.period).localeCompare(asText(right.period)));
}

async function latestDailyPeriod(
  env: Env,
  table: 'pay_type_daily' | 'chain_daily' | 'creative_daily' | 'renewal_daily',
) {
  const record = (await baseRecords(env, table, false, {
    sort: ['period DESC'],
    limit: 1,
  }))[0];
  return asText(record?.fields.period);
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

function payRowsForLevel(rows: D1Row[], level: Set<string>) {
  return rows.filter((row) => level.has(asText(row.analysis_level)));
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
    const primary = payRowsForLevel(group, PRIMARY_PAY_LEVELS);
    const activeDrill = payRowsForLevel(group, ACTIVE_PAY_LEVELS);
    const activePayTypeGmv: Record<string, number> = {};
    for (const row of activeDrill) {
      const key = normalizePayType(asText(row.pay_type));
      activePayTypeGmv[key] = (activePayTypeGmv[key] || 0) + asNumber(row.gmv_usd) / divisor;
    }
    const total = sum(primary.map((row) => asNumber(row.gmv_usd)));
    const active = sum(primary.filter((row) => normalizePayType(asText(row.pay_type)) === '主动付费').map((row) => asNumber(row.gmv_usd)));
    const renewal = sum(primary.filter((row) => normalizePayType(asText(row.pay_type)) === '自动续订').map((row) => asNumber(row.gmv_usd)));
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
  if (!PLATFORMS.has(platform)) return errorResponse('platform 必须是 web / app 之一');
  const [chain, pay, renewalRecords] = await Promise.all([
    dailyRows(env, 'chain_daily', { platform, startDate, endDate, deviceType }),
    dailyRows(env, 'pay_type_daily', { platform, startDate, endDate, deviceType }),
    dailyRows(env, 'renewal_daily', { platform, startDate, endDate }),
  ]);
  const renewal = renewalPlatformRows(renewalRecords, platform, deviceType)
    .filter((row) => !planTier || asText(row.plan_tier).toUpperCase() === planTier);
  const filteredChain = trendUserTag ? chain.filter((row) => asText(row.user_tag) === trendUserTag) : chain;
  const periodDays = trendPeriodDivisors([...filteredChain, ...pay, ...renewal], granularity);
  const periods = groupByPeriod([...filteredChain, ...pay, ...renewal], granularity).filter((period) => dateInRange(period, startDate, endDate));
  const payTrendRows = payTrend(pay.map((row) => ({ ...row, period: granularity === 'week' ? row.week_start : row.period })), periods, periodDays);
  const payPeriods = groupByPeriod(pay, granularity).filter((period) => dateInRange(period, startDate, endDate));
  const payDays = trendPeriodDivisors(pay, granularity);
  const cardTrend = payTrend(pay.map((row) => ({ ...row, period: granularity === 'week' ? row.week_start : row.period })), payPeriods, payDays);
  const chainTrendRows = chainTrend(filteredChain.map((row) => ({ ...row, period: granularity === 'week' ? row.week_start : row.period })), periods, periodDays);
  const trend = payTrendRows.map((row, index) => {
    const chainRow = chainTrendRows[index];
    const renewalTotal = sumRenewal(periodRows(renewal, row.period, granularity));
    const renewalPeriodDays = periodDays.get(row.period) || 1;
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
  const rangeFilter = buildBaseFilterFormula({ startDate, endDate: latestPeriod });
  const payFilter = `AND(${rangeFilter},OR(CurrentValue.[analysis_level]="一级_付费类型",CurrentValue.[analysis_level]="一级_订阅方式"),OR(CurrentValue.[pay_type]="主动付费",CurrentValue.[pay_type]="主动订阅"))`;
  const [payRecords, ...chainRows] = await Promise.all([
    baseRecords(env, 'pay_type_daily', false, { filter: payFilter }),
    ...['web', 'app'].map((platform) =>
    dailyRows(env, 'chain_daily', { platform, startDate, endDate: latestPeriod }),
    ),
  ]);
  const pay = payRecords.map((record) => record.fields);
  const chain = chainRows.flat();
  const platforms: Record<string, unknown> = {};
  for (const platform of ['web', 'app']) {
    const platformPay = pay.filter((row) => asText(row.platform) === platform && PRIMARY_PAY_LEVELS.has(asText(row.analysis_level)) && normalizePayType(asText(row.pay_type)) === '主动付费');
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
  if (!PLATFORMS.has(platform)) return errorResponse('platform 必须是 web / app 之一');
  if (!['pay_type', 'chain', 'creative'].includes(dimension)) return errorResponse('dimension 必须是 pay_type / chain / creative 之一');
  if (!['active', 'renewal'].includes(chainType)) return errorResponse('chainType 必须是 active / renewal 之一');
  if (planTier && !['LITE', 'PRO', 'ULTRA'].includes(planTier)) return errorResponse('planTier 必须是 LITE / PRO / ULTRA 之一');

  if (dimension === 'pay_type') {
    const rows = await dailyRows(env, 'pay_type_daily', { platform, startDate, endDate, deviceType });
    const comparison = buildComparison(rows, startDate, endDate, baselinePeriod, analysisPeriod);
    const days = comparison?.dayCounts || weekDayCounts(rows);
    const periods = [...new Set(rows.map((row) => asText(row.week_start)))].filter((period) => dateInRange(period, startDate, endDate)).sort();
    const trend = periods.map((period) => {
      const periodRows = rows.filter((row) => asText(row.week_start) === period && PRIMARY_PAY_LEVELS.has(asText(row.analysis_level)));
      return { period, value: sum(periodRows.map((row) => asNumber(row.gmv_usd))) / (days.get(period) || WEEK_DAYS), gmv: sum(periodRows.map((row) => asNumber(row.gmv_usd))) / (days.get(period) || WEEK_DAYS) };
    });
    if (!comparison) return json({ dimension, valueLabel: 'GMV', comparison: null, metricLabels: {}, items: [], sections: [], trend });
    const makeSection = (title: string, description: string, level: Set<string>, order: string[]) => {
      const currentRows = rows.filter((row) => asText(row.week_start) === comparison.analysisPeriod && level.has(asText(row.analysis_level)));
      const previousRows = rows.filter((row) => asText(row.week_start) === comparison.baselinePeriod && level.has(asText(row.analysis_level)));
      const current = aggregatePay(currentRows, () => true);
      const previous = aggregatePay(previousRows, () => true);
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
    const sections = [
      makeSection('一级付费类型贡献', '只比较主动付费和自动续订对周度 GMV 变化的贡献。', PRIMARY_PAY_LEVELS, ['主动付费', '自动续订']),
      makeSection('主动付费下钻', '只在主动付费内部拆解首订、积分包、套餐升级、重新订阅等。', ACTIVE_PAY_LEVELS, ['首订', '积分包', '套餐升级', '重新订阅', '其他']),
    ];
    return json({ dimension, valueLabel: 'GMV', comparison, metricLabels: {}, items: sections[0].items, sections, trend });
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
  const drivers = driverDefinitions.map(([metricKey, metric, dailyAverage]) => {
    const value = dailyAverage ? currentMetrics[metricKey] / comparison.analysisPeriodDays : currentMetrics[metricKey];
    const previousValue = dailyAverage ? previousMetrics[metricKey] / comparison.baselinePeriodDays : previousMetrics[metricKey];
    const change = value - previousValue;
    return { tier: selectedTier, userTag: driverUserTag || '全部', metricKey, metric, value, previousValue, change, wowChange: previousValue ? change / previousValue : null, contribution: driverDelta ? change * (currentDriver.chainGmvUsd / Math.max(1, currentMetrics[metricKey])) / driverDelta : null };
  });
  return json({ dimension, valueLabel: '主动付费GMV', comparison, metricLabels, items, sections, drivers, drill: { path: url.searchParams.get('chainPath') || 'tier_to_chain', creationTier: selectedTier, userTag: driverUserTag || '全部' }, trend });
}

const PREVIEW_FIELDS: Record<string, string[]> = {
  run_log: ['run_id', 'status', 'stage', 'start_date', 'end_date', 'platforms', 'rows_synced', 'error_message', 'started_at', 'finished_at'],
  pay_type_daily: ['platform', 'dataset_kind', 'period', 'week_start', 'week_end', 'device_type', 'analysis_level', 'pay_type', 'gmv_usd'],
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

async function workbookPreview(env: Env, request: Request) {
  const url = new URL(request.url);
  const sheet = url.searchParams.get('sheet') || '';
  const table = PREVIEW_TABLES[sheet] as BaseSheet | undefined;
  if (!table || !TABLES.has(table)) return errorResponse('不支持的工作表', 400);
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize') || 50)));
  const platform = url.searchParams.get('platform');
  const allRows = (await baseRecords(env, table))
    .map((record) => record.fields)
    .filter((row) => !platform || !('platform' in row) || asText(row.platform) === platform)
    .reverse();
  const rows = allRows.slice(offset, offset + pageSize);
  return json({ sheet, fields: PREVIEW_FIELDS[sheet] || Object.keys(rows[0] || {}), items: rows.map((row) => previewRow(sheet, row)), total: allRows.length, hasMore: offset + rows.length < allRows.length });
}

async function latestSync(env: Env) {
  const row = (await baseRecords(env, 'run_log'))
    .map((record) => record.fields)
    .sort((left, right) => asText(right.started_at).localeCompare(asText(left.started_at)))[0];
  if (!row) return json(null);
  return json({ runId: asText(row.run_id), status: asText(row.status), stage: asText(row.stage), startDate: asText(row.start_date), endDate: asText(row.end_date), platforms: asText(row.platforms).split(',').filter(Boolean), rowsSynced: asNumber(row.rows_synced), errorMessage: asText(row.error_message) || undefined, startedAt: asText(row.started_at), finishedAt: asText(row.finished_at) || undefined });
}

async function syncPlan(env: Env, mode: 'latest_day' | 'latest_week') {
  const sheets = ['pay_type_daily', 'chain_daily', 'creative_daily', 'renewal_daily'] as const;
  const latestStoredDate = (await latestDailyPeriod(env, 'chain_daily')) || null;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (mode === 'latest_day') {
    const startDate = latestStoredDate && latestStoredDate < yesterday
      ? shiftDate(latestStoredDate, 1)
      : yesterday;
    const entries = await Promise.all(sheets.map(async (sheet) => [
      sheet,
      await dailyRows(env, sheet, { startDate, endDate: startDate }),
    ] as const));
    const rowsBySheet = new Map(entries);
    const missingItems = ['web', 'app'].flatMap((platform) => sheets
      .filter((sheet) => !(rowsBySheet.get(sheet) ?? []).some((row) => asText(row.platform) === platform && asText(row.period) === startDate))
      .map((sheet) => ({ sheet, platform, datasetKind: 'daily', expectedPeriod: startDate, recordCount: 0 })));
    const alreadySynced = startDate === yesterday && missingItems.length === 0;
    return json({ mode, startDate, endDate: yesterday, latestStoredDate, platforms: ['web', 'app'], alreadySynced, canSync: !alreadySynced, running: false, missingItems });
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
  const missingItems = ['web', 'app'].flatMap((platform) => sheets.flatMap((sheet) => {
    const days = new Set((rowsBySheet.get(sheet) ?? []).filter((row) => asText(row.platform) === platform && asText(row.period) >= startDate && asText(row.period) <= endDate).map((row) => asText(row.period)));
    return days.size === 7 ? [] : [{ sheet, platform, datasetKind: 'daily', expectedPeriod: `${startDate} ~ ${endDate}`, recordCount: days.size }];
  }));
  return json({ mode, startDate, endDate, platforms: ['web', 'app'], alreadySynced: missingItems.length === 0, canSync: missingItems.length > 0, running: false, missingItems });
}

const MAXCOMPUTE_NUMBER_FIELDS = new Set([
  'gmv_usd', 'creation_cnt_30d_level_id', 'active_uv', 'sub_expose_uv',
  'sub_submit_uv', 'chain_pay_uv', 'chain_gmv_usd', 'sub_expose_rate',
  'sub_submit_rate', 'chain_pay_success_rate', 'chain_arppu', 'creation_uv',
  'creation_task_cnt', 'creation_penetration_rate', 'avg_creation_task_cnt_per_creator',
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
    return { platform, dataset_kind: 'daily', ...row };
  });
}

async function replaceBaseRange(env: Env, sheet: 'pay_type_daily' | 'chain_daily' | 'creative_daily' | 'renewal_daily', platform: string, startDate: string, endDate: string, rows: D1Row[]) {
  const existing = (await baseRecords(env, sheet, true, {
    filter: buildBaseFilterFormula({ platform, startDate, endDate }),
  })).filter((record) =>
    asText(record.fields.platform) === platform &&
    asText(record.fields.dataset_kind) === 'daily' &&
    asText(record.fields.period) >= startDate &&
    asText(record.fields.period) <= endDate,
  );
  for (let index = 0; index < existing.length; index += 500) {
    await baseRequest(env, sheet, '/records/batch_delete', { records: existing.slice(index, index + 500).map((record) => record.id) });
  }
  for (let index = 0; index < rows.length; index += 500) {
    await baseRequest(env, sheet, '/records/batch_create', {
      records: rows.slice(index, index + 500).map((fields) => ({ fields })),
    });
  }
  invalidateBaseCache(sheet);
  return rows.length;
}

async function runBaseSync(env: Env, runLogId: string, runId: string, platforms: string[], startDate: string, endDate: string) {
  let rowsSynced = 0;
  try {
    for (const platform of platforms) {
      for (const dataset of ['pay_type', 'chain', 'creative', 'renewal'] as const) {
        const rows = await pullDailyFacts(env, platform, dataset, startDate, endDate);
        rowsSynced += await replaceBaseRange(env, `${dataset}_daily` as 'pay_type_daily' | 'chain_daily' | 'creative_daily' | 'renewal_daily', platform, startDate, endDate, rows);
      }
    }
    await baseRequest(env, 'run_log', `/records/${runLogId}`, {
      fields: { status: 'success', stage: 'write', rows_synced: rowsSynced, finished_at: new Date().toISOString() },
    }, 'PUT');
  } catch (error) {
    await baseRequest(env, 'run_log', `/records/${runLogId}`, {
      fields: { status: 'failed', error_message: error instanceof Error ? error.message : String(error), rows_synced: rowsSynced, finished_at: new Date().toISOString() },
    }, 'PUT').catch(() => undefined);
    throw error;
  } finally {
    invalidateBaseCache('run_log');
    await invalidateDashboardCache(env);
  }
  return { runId, rowsSynced };
}

async function createSyncRun(env: Env, request: Request, context: { waitUntil(promise: Promise<unknown>): void }) {
  const body = await request.json().catch(() => ({})) as { mode?: 'latest_day' | 'latest_week'; platforms?: string[] };
  const planResponse = await syncPlan(env, body.mode === 'latest_week' ? 'latest_week' : 'latest_day');
  const plan = await planResponse.json() as { startDate: string; endDate: string; platforms: string[]; alreadySynced?: boolean };
  const platforms = body.platforms?.filter((platform) => PLATFORMS.has(platform)) ?? plan.platforms;
  if (plan.alreadySynced) return json({ runId: `base-${Date.now()}`, mode: body.mode || 'latest_day', ...plan, status: 'success', rowsSynced: 0, skipped: true, skipReason: 'Base 已包含目标日期数据' });
  const runId = `base-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const created = await baseRequest<{ record?: { record_id?: string } }>(env, 'run_log', '/records', {
    fields: { run_id: runId, status: 'running', stage: 'pull', start_date: plan.startDate, end_date: plan.endDate, platforms: platforms.join(','), rows_synced: 0, started_at: startedAt },
  });
  const runLogId = created.record?.record_id;
  if (!runLogId) throw new Error('Base run_log 创建失败：未返回 record_id');
  context.waitUntil(runBaseSync(env, runLogId, runId, platforms, plan.startDate, plan.endDate));
  return json({ runId, mode: body.mode || 'latest_day', startDate: plan.startDate, endDate: plan.endDate, platforms, status: 'running', rowsSynced: 0 });
}

async function reportHandler(env: Env, request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform');
  if (request.method === 'GET' && url.pathname === '/api/report-latest') {
    const row = (await baseRecords(env, 'latest_report')).map((record) => record.fields)
      .filter((item) => !platform || asText(item.platform) === platform)
      .sort((left, right) => asText(right.generated_at).localeCompare(asText(left.generated_at)))[0];
    return json(row ? { platform: asText(row.platform), periodStart: asText(row.period_start), periodEnd: asText(row.period_end), modelUsed: asText(row.model_used), degraded: Boolean(row.degraded), markdown: asText(row.report_md), generatedAt: asText(row.generated_at) } : null);
  }
  if (request.method === 'GET' && url.pathname === '/api/report-history') {
    const rows = (await baseRecords(env, 'report_history')).map((record) => record.fields)
      .filter((item) => !platform || asText(item.platform) === platform)
      .sort((left, right) => asText(right.generated_at).localeCompare(asText(left.generated_at)));
    return json(rows.map((row) => ({ platform: asText(row.platform), periodStart: asText(row.period_start), periodEnd: asText(row.period_end), modelUsed: asText(row.model_used), degraded: Boolean(row.degraded), generatedAt: asText(row.generated_at) })));
  }
  if (request.method === 'GET' && url.pathname === '/api/report-history/detail') {
    const periodStart = url.searchParams.get('periodStart');
    const periodEnd = url.searchParams.get('periodEnd');
    const row = (await baseRecords(env, 'report_history')).map((record) => record.fields)
      .filter((item) => asText(item.platform) === platform && asText(item.period_start) === periodStart && asText(item.period_end) === periodEnd)
      .sort((left, right) => asText(right.generated_at).localeCompare(asText(left.generated_at)))[0];
    return json(row ? { platform: asText(row.platform), periodStart: asText(row.period_start), periodEnd: asText(row.period_end), modelUsed: asText(row.model_used), degraded: Boolean(row.degraded), markdown: asText(row.report_md), generatedAt: asText(row.generated_at) } : null);
  }
  if (request.method === 'GET' && url.pathname === '/api/report-generations/latest') return json(null);
  if (request.method === 'POST' && url.pathname === '/api/report-generations') return errorResponse('数据库迁移阶段暂不生成新报告，请先完成数据源同步服务接入', 501);
  return errorResponse('报告接口不存在', 404);
}

export default {
  async fetch(request: Request, env: Env, context: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/dashboard/overview' && request.method === 'GET') return cachedDashboardResponse(env, request, context, () => overview(env, request));
      if (url.pathname === '/api/dashboard/gmv-coverage' && request.method === 'GET') return cachedDashboardResponse(env, request, context, () => gmvCoverage(env));
      if (url.pathname === '/api/dashboard/attributions' && request.method === 'GET') return cachedDashboardResponse(env, request, context, () => attributions(env, request));
      if (url.pathname === '/api/workbook-preview' && request.method === 'GET') return workbookPreview(env, request);
      if (url.pathname === '/api/sync-runs/latest' && request.method === 'GET') return latestSync(env);
      if (url.pathname === '/api/sync-runs/latest-day-plan' && request.method === 'GET') return syncPlan(env, 'latest_day');
      if (url.pathname === '/api/sync-runs/latest-week-plan' && request.method === 'GET') return syncPlan(env, 'latest_week');
      if (url.pathname === '/api/sync-runs' && request.method === 'POST') {
        const denial = await authorizeDashboardMutation(request);
        return denial || createSyncRun(env, request, context);
      }
      if (url.pathname === '/api/report-generations' && request.method === 'POST') {
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
