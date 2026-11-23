import { chainDriverEffects, lmdiDriverEffects, type ChainFactors } from './chain-attribution.ts';
import { compareChainGroupKeys, LIFECYCLE_ORDER } from '../shared/chain-comparison.ts';
import type { ChainComparisonParams, ChainComparison, ChainFactor, ChainGroup } from '../shared/chain-comparison.ts';
type Row = Record<string, unknown>;
type Query = (sql: string, ...binds: string[]) => Promise<Row[]>;
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const activeDefinitions = [
  ['activeUv', 'DAU', 'count'],
  ['subExposeRate', '付费墙曝光率', 'rate'],
  ['subSubmitRate', '付费墙提交率', 'rate'],
  ['chainPaySuccessRate', '提交支付率', 'rate'],
  ['chainArppu', '客单价', 'currency'],
] as const;
const renewalDefinitions = [
  ['expireUserCnt', '到期用户数', 'count'],
  ['renewalRate', '续订率', 'rate'],
  ['renewalAov', '续订客单价', 'currency'],
] as const;
const sum = (rows: Row[], field: string) =>
  rows.length &&
  rows.every(
    (row) => row[field] != null && row[field] !== '' && Number.isFinite(Number(row[field])) && Number(row[field]) >= 0,
  )
    ? rows.reduce((n, row) => n + Number(row[field]), 0)
    : null;
const divide = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? a / b : null);
const share = (effect: number | null, delta: number) => (effect == null || delta === 0 ? null : effect / delta);
const lifecycleOf = (row: Row) =>
  ['NEW', 'OLD'].includes(String(row.user_lifecycle)) ? String(row.user_lifecycle) : 'UNKNOWN';
function factorValues(rows: Row[], days: number, type: 'active' | 'renewal'): Record<string, number | null> {
  if (type === 'renewal') {
    const expire = sum(rows, 'expire_user_cnt'),
      renew = sum(rows, 'renew_user_cnt'),
      gmv = sum(rows, 'renew_amount_usd');
    return {
      expireUserCnt: expire == null ? null : expire / days,
      renewalRate: divide(renew, expire),
      renewalAov: divide(gmv, renew),
    };
  }
  const active = sum(rows, 'active_uv'),
    expose = sum(rows, 'paywall_expose_uv'),
    submit = sum(rows, 'paywall_submit_uv'),
    pay = sum(rows, 'pay_uv'),
    gmv = sum(rows, 'gmv_usd');
  return {
    activeUv: active == null ? null : active / days,
    subExposeRate: divide(expose, active),
    subSubmitRate: divide(submit, expose),
    chainPaySuccessRate: divide(pay, submit),
    chainArppu: divide(gmv, pay),
  };
}
function decompose(
  previous: Row[],
  current: Row[],
  days: number,
  type: 'active' | 'renewal',
  denominator: number,
): ChainFactor[] {
  const before = factorValues(previous, days, type),
    after = factorValues(current, days, type);
  const definitions = type === 'active' ? activeDefinitions : renewalDefinitions;
  const valid = [...Object.values(before), ...Object.values(after)].every(
    (value) => value != null && Number.isFinite(value) && value >= 0,
  );
  const effects = !valid
    ? null
    : type === 'active'
      ? chainDriverEffects(before as ChainFactors, after as ChainFactors)
      : lmdiDriverEffects(
          before as Record<string, number>,
          after as Record<string, number>,
          renewalDefinitions.map(([key]) => key),
        );
  return definitions.map(([key, label, unit]) => ({
    key,
    label,
    unit,
    baseline: before[key],
    current: after[key],
    effect: effects?.[key] ?? null,
    contribution: share(effects?.[key] ?? null, denominator),
  }));
}
export function comparisonParams(search: URLSearchParams): ChainComparisonParams {
  const params = {
    platform: search.get('platform') || 'all',
    deviceType: (search.get('deviceType') as 'ios' | 'android' | undefined) || undefined,
    mode: search.get('mode') || 'week',
    baseline: search.get('baseline') || '',
    analysis: search.get('analysis') || '',
    chainType: search.get('chainType') || 'active',
    populationDimension: search.get('populationDimension') || 'creation',
    lifecycle: search.get('lifecycle') || undefined,
    creationTier: search.get('creationTier') || undefined,
    countryTier: search.get('countryTier') || undefined,
    planTier: search.get('planTier') || undefined,
  };
  if (
    !['all', 'web', 'app'].includes(params.platform) ||
    (params.deviceType != null && (params.platform !== 'app' || !['ios', 'android'].includes(params.deviceType))) ||
    !['day', 'week'].includes(params.mode) ||
    !['active', 'renewal'].includes(params.chainType) ||
    !['creation', 'country'].includes(params.populationDimension) ||
    !validDate(params.baseline) ||
    !validDate(params.analysis) ||
    params.baseline >= params.analysis
  )
    throw new Error('链路比较参数无效；基准日期必须早于分析日期');
  if (params.lifecycle && !['NEW', 'OLD', 'UNKNOWN'].includes(params.lifecycle)) throw new Error('注册人群无效');
  if (params.countryTier && (params.chainType !== 'active' || params.populationDimension !== 'country' || !params.lifecycle))
    throw new Error('国家分层必须属于已选注册人群');
  if (
    params.creationTier &&
    (params.populationDimension !== 'creation' || !params.lifecycle ||
      ![
        'create_cnt_30d_0',
        'create_cnt_30d_[1,11)',
        'create_cnt_30d_[11,31)',
        'create_cnt_30d_[31,101)',
        'create_cnt_30d_[101,+inf)',
      ].includes(params.creationTier))
  )
    throw new Error('创作分层必须属于已选注册人群');
  if (params.planTier && !['LITE', 'PRO', 'ULTRA', 'UNKNOWN'].includes(params.planTier)) throw new Error('套餐无效');
  if (
    params.mode === 'week' &&
    [params.baseline, params.analysis].some((date) => new Date(`${date}T00:00:00Z`).getUTCDay() !== 6)
  )
    throw new Error('业务周必须从周六开始');
  return params as ChainComparisonParams;
}
export function buildChainComparison(
  params: ChainComparisonParams,
  source: Row[],
  pay: Row[],
  inheritedDates?: ChainComparison['dates'],
): ChainComparison {
  if (params.lifecycle || params.countryTier || params.planTier) {
    const full = buildChainComparison(
      { ...params, lifecycle: undefined, creationTier: undefined, countryTier: undefined, planTier: undefined },
      source,
      pay,
    );
    if (!full.ready) return { ...full, comparison: params, residual: null };
    const selected = source.filter((row) =>
      params.chainType === 'active'
        ? lifecycleOf(row) === params.lifecycle &&
          (!params.creationTier || row.creation_cnt_30d_label === params.creationTier) &&
          (!params.countryTier || String(row.country_tier || 'UNKNOWN') === params.countryTier)
        : String(row.plan_tier || 'UNKNOWN').toUpperCase() === params.planTier,
    );
    const field = params.chainType === 'active' ? 'gmv_usd' : 'renew_amount_usd';
    // A missing stratum on an observed parent day contributes zero amount; it
    // must not shrink the matched calendar and inflate that stratum's daily mean.
    const selectedPay = [...full.dates.baseline, ...full.dates.analysis].map((period) => ({
      period,
      gmv_usd: selected.some((row) => row.period === period)
        ? sum(
            selected.filter((row) => row.period === period),
            field,
          )
        : 0,
    }));
    const scoped = buildChainComparison(
      { ...params, lifecycle: undefined, creationTier: undefined, countryTier: undefined, planTier: undefined },
      selected,
      selectedPay,
      full.dates,
    );
    return {
      ...scoped,
      comparison: params,
      groups: full.groups,
      lifecycleGroups: full.lifecycleGroups,
      countryGroups: full.countryGroups,
      residual: null,
    };
  }
  const platforms = params.platform === 'all' ? ['web', 'app'] : [params.platform];
  const sourceName = params.chainType === 'active' ? 'pollo_da_chain_funnel' : 'pollo_da_fact_rows_read/renewal';
  const empty: ChainComparison = {
    ready: false,
    source: sourceName,
    comparison: params,
    dates: { baseline: [], analysis: [] },
    total: null,
    residual: null,
    factors: [],
    groups: [],
    trend: [],
  };
  const hasDay = (date: string) =>
    platforms.every((platform) => source.some((row) => row.period === date && row.platform === platform)) &&
    pay.some((row) => row.period === date);
  const offsets = Array.from({ length: params.mode === 'day' ? 1 : 7 }, (_, i) => i).filter((i) =>
    inheritedDates
      ? inheritedDates.baseline.includes(shift(params.baseline, i)) &&
        inheritedDates.analysis.includes(shift(params.analysis, i))
      : hasDay(shift(params.baseline, i)) && hasDay(shift(params.analysis, i)),
  );
  if (!offsets.length) return { ...empty, reason: '比较日的支付结果或链路原子数据缺失，未补零' };
  const dates = {
    baseline: offsets.map((i) => shift(params.baseline, i)),
    analysis: offsets.map((i) => shift(params.analysis, i)),
  };
  const previous = source.filter((row) => dates.baseline.includes(String(row.period))),
    current = source.filter((row) => dates.analysis.includes(String(row.period)));
  const days = offsets.length;
  const baseline = sum(
      pay.filter((row) => dates.baseline.includes(String(row.period))),
      'gmv_usd',
    ),
    analysis = sum(
      pay.filter((row) => dates.analysis.includes(String(row.period))),
      'gmv_usd',
    );
  if (baseline == null || analysis == null) return { ...empty, dates, reason: '支付结果金额缺失或无效，未补零' };
  const total = { baseline: baseline / days, current: analysis / days, delta: (analysis - baseline) / days };
  const factors = decompose(previous, current, days, params.chainType, total.delta);
  if (factors.some((factor) => factor.effect == null))
    return { ...empty, dates, total, factors, reason: '链路分母为零或原子数据无效，无法定义 LMDI 因子；未用零值替代' };
  const gmvField = params.chainType === 'active' ? 'gmv_usd' : 'renew_amount_usd';
  const chainBefore = sum(previous, gmvField),
    chainAfter = sum(current, gmvField);
  if (chainBefore == null || chainAfter == null) return { ...empty, dates, total, reason: '链路金额不可用' };
  const effectSum = factors.reduce((n, factor) => n + factor.effect!, 0);
  const chainDelta = (chainAfter - chainBefore) / days;
  if (Math.abs(effectSum - chainDelta) > 1e-7 * Math.max(1, Math.abs(chainDelta)))
    return { ...empty, dates, total, reason: 'LMDI 与链路金额未守恒' };
  const residual = {
    baseline: total.baseline - chainBefore / days,
    current: total.current - chainAfter / days,
    effect: total.delta - effectSum,
    contribution: share(total.delta - effectSum, total.delta),
  };
  const creationGroupKey = (row: Row) =>
    params.chainType === 'active'
      ? `${row.creation_cnt_30d_label || '未知'} × ${lifecycleOf(row)}`
      : String(row.plan_tier || 'UNKNOWN').toUpperCase();
  const countryGroupKey = (row: Row) => `${row.country_tier || 'UNKNOWN'} × ${lifecycleOf(row)}`;
  const tierNames: Record<string, string> = {
    create_cnt_30d_0: '近30日未创作',
    'create_cnt_30d_[1,11)': '近30日 1–10 次',
    'create_cnt_30d_[11,31)': '近30日 11–30 次',
    'create_cnt_30d_[31,101)': '近30日 31–100 次',
    'create_cnt_30d_[101,+inf)': '近30日 101+ 次',
  };
  const makeGroups = (groupKey: (row: Row) => string, labelPart: (part: string) => string) =>
    [...new Set([...previous, ...current].map(groupKey))]
    .sort((a, b) => compareChainGroupKeys(a, b, params.chainType))
    .map((key) => {
      const p = previous.filter((row) => groupKey(row) === key),
        c = current.filter((row) => groupKey(row) === key);
      return {
        key,
        label: key
          .split(' × ')
          .map(
            (part) =>
              labelPart(part) ||
              ({ NEW: '新用户', OLD: '老用户', UNKNOWN: '未知' } as Record<string, string>)[part] ||
              part,
          )
          .join(' × '),
        baseline: (sum(p, gmvField) ?? 0) / days,
        current: (sum(c, gmvField) ?? 0) / days,
        factors: decompose(p, c, days, params.chainType, total.delta),
      };
    });
  const creationGroups = makeGroups(creationGroupKey, (part) => tierNames[part] || '');
  const countryGroups =
    params.chainType === 'active'
      ? makeGroups(countryGroupKey, (part) => (part === 'UNKNOWN' ? '未知国家' : part))
      : [];
  const groups = params.populationDimension === 'country' ? countryGroups : creationGroups;
  const trend = [...new Set(source.map((row) => String(row.period)))].sort().map((date) => {
    const rows = source.filter((row) => row.period === date);
    return {
      date,
      values: factorValues(
        platforms.every((platform) => rows.some((row) => row.platform === platform)) ? rows : [],
        1,
        params.chainType,
      ),
    };
  });
  const lifecycleKey = lifecycleOf;
  const lifecycleGroups: ChainGroup[] =
    params.chainType === 'active'
      ? [...new Set([...previous, ...current].map(lifecycleKey))]
          .sort((a, b) => {
            const rank = (key: string) => {
              const i = (LIFECYCLE_ORDER as readonly string[]).indexOf(key);
              return i < 0 ? LIFECYCLE_ORDER.length : i;
            };
            return rank(a) - rank(b) || a.localeCompare(b);
          })
          .map((key) => {
            const p = previous.filter((row) => lifecycleKey(row) === key),
              c = current.filter((row) => lifecycleKey(row) === key);
            return {
              key,
              label: ({ NEW: '新用户', OLD: '老用户', UNKNOWN: '未知' } as Record<string, string>)[key] || key,
              baseline: (sum(p, gmvField) ?? 0) / days,
              current: (sum(c, gmvField) ?? 0) / days,
              factors: decompose(p, c, days, params.chainType, total.delta),
            };
          })
      : [];
  return {
    ready: true,
    source: sourceName,
    comparison: params,
    dates,
    total,
    residual,
    factors,
    groups,
    lifecycleGroups,
    countryGroups,
    trend,
  };
}

export async function readChainComparison(params: ChainComparisonParams, query: Query): Promise<ChainComparison> {
  const start = [params.baseline, shift(params.analysis, -36)].sort()[0],
    end = shift(params.analysis, params.mode === 'week' ? 6 : 0);
  const scopes = params.platform === 'all' ? ['web', 'app'] : [params.platform];
  const slots = scopes.map(() => '?').join(',');
  const deviceClause = params.deviceType ? ' AND device_type = ?' : '';
  const deviceBinds = params.deviceType ? [params.deviceType] : [];
  const renewalPlatform = params.deviceType
    ? ' AND platform_type = ?'
    : " AND ((platform='web' AND platform_type='WEB') OR (platform='app' AND platform_type='APP'))";
  const source =
    params.chainType === 'active'
      ? await query(
          `SELECT period,platform,country_tier,creation_cnt_30d_label,user_lifecycle,active_uv,paywall_expose_uv,paywall_submit_uv,pay_uv,gmv_usd FROM pollo_da_chain_funnel WHERE period BETWEEN ? AND ? AND platform IN (${slots})${deviceClause}`,
          start,
          end,
          ...scopes,
          ...deviceBinds,
        )
      : await query(
          `SELECT period,platform,plan_tier,expire_user_cnt,renew_user_cnt,renew_amount_usd FROM pollo_da_fact_rows_read WHERE dataset='renewal' AND dataset_kind='daily' AND period BETWEEN ? AND ? AND platform IN (${slots})${renewalPlatform}`,
          start,
          end,
          ...scopes,
          ...(params.deviceType ? [params.deviceType.toUpperCase()] : []),
        );
  const pay = await query(
    `SELECT period,CASE WHEN COUNT(gmv_usd)=COUNT(*) THEN SUM(gmv_usd) ELSE NULL END AS gmv_usd FROM pollo_da_fact_rows_read WHERE dataset='pay_type' AND dataset_kind='daily' AND attribution_type='NONE' AND pay_type<>'汇总' AND pay_category=? AND platform=? AND period BETWEEN ? AND ?${deviceClause} GROUP BY period`,
    params.chainType === 'active' ? 'ACTIVE_PAYMENT' : 'AUTO_RENEWAL',
    params.platform,
    start,
    end,
    ...deviceBinds,
  );
  return buildChainComparison(params, source, pay);
}
