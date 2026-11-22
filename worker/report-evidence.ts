import { chainDriverEffects, lmdiDriverEffects, type ChainFactors } from './chain-attribution.ts';
import { decomposeRate, decomposeCount, netChangeShare } from '../shared/rate-attribution.ts';

export type EvidenceRow = Record<string, unknown>;
export type EvidenceSource = { source: string; status: 'ok' | 'unavailable'; readAt: string; rows: EvidenceRow[]; complete?: boolean; error?: string; provenance?: Record<string, unknown> };
export type EvidenceSources = Record<'pay' | 'funnel' | 'breakdown' | 'renewal' | 'ads' | 'creation' | 'functions' | 'actions', EvidenceSource>;
export type ReportWindow = { platform: 'web' | 'app'; startDate: string; endDate: string; mode?: 'week' | 'day' };
type Unit = 'usd' | 'usdPerUser' | 'count' | 'rate';
type Pair = { baseline: EvidenceRow[]; current: EvidenceRow[] };
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const dates = (start: string, end: string) => Array.from({ length: Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1 }, (_, i) => shift(start, i));
const text = (value: unknown): string => Array.isArray(value) ? value.map(text).filter(Boolean).join('/') : value == null ? '' : String(value).trim();
const dimension = (value: unknown) => /^(unknown|未知|未记录|null|undefined)?$/i.test(text(value)) ? '未知' : text(value) === '__MULTI__' ? '多类型' : text(value);
const productTier = (value: unknown) => ({ lite: 'Lite', pro: 'Pro', ultra: 'Ultra' } as Record<string, string>)[text(value).toLowerCase()] ?? dimension(value);
const valueLabel = (key: string) => ({ active: '主动曝光', passive: '被动曝光', insufficient_credits: '积分不足', insufficient_permission: '权益不足', product_design: '产品设计', stripe: 'Stripe', payinsider: 'PayInsider', paypal: 'PayPal', apple: 'Apple', google: 'Google', web: 'Web' } as Record<string, string>)[key] ?? key;
const sum = (rows: EvidenceRow[], field: string): number | null => rows.every(row => row[field] != null && row[field] !== '' && Number.isFinite(Number(row[field]))) ? rows.reduce((n, row) => n + Number(row[field]), 0) : null;
const ratio = (n: number | null, d: number | null) => n != null && d != null && n >= 0 && d > 0 && n <= d ? n / d : null;
const quotient = (n: number | null, d: number | null) => n != null && d != null && d > 0 ? n / d : null;
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
const number = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const signed = (value: number, digits = 2) => { const rounded=Number(value.toFixed(digits)); return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(digits)}`; };
const show = (value: number | null, unit: Unit) => value == null ? '不可用' : unit === 'rate' ? `${(value * 100).toFixed(2)}%` : unit === 'usd' || unit === 'usdPerUser' ? `$${number(value, unit === 'usdPerUser' ? 2 : 0)}` : number(value);

export function formatMetricMovement(m: { label: string; baseline: number | null; current: number | null; relativeChange: number | null; pp: number | null; unit: Unit }) {
  return `${m.label} ${m.relativeChange == null ? '相对变化不可计算' : `${signed(m.relativeChange * 100)}%`}（${show(m.baseline, m.unit)} -> ${show(m.current, m.unit)}）${m.pp == null ? '' : `，变化 ${signed(m.pp)}pp`}`;
}

export function metric(id: string, label: string, baseline: number | null, current: number | null, unit: Unit, reason = '') {
  const delta = baseline != null && current != null ? current - baseline : null;
  const relativeChange = delta != null && baseline !== 0 ? delta / baseline! : null;
  const pp = unit === 'rate' && delta != null ? delta * 100 : null;
  const unavailableReason = reason || (delta == null ? '原子数据缺失、分母为零或比较不可用' : baseline === 0 ? '基准为零，相对变化不可计算' : '');
  return { id, label, unit, baseline, current, delta, relativeChange, pp, unavailableReason,
    movement: formatMetricMovement({label,unit,baseline,current,relativeChange,pp}) };
}

const t1 = new Set('US GB DE FR JP CA AU IT ES NL CH SE NO DK FI BE AT NZ IE KR SG LU BR MX AR CL CN HK'.split(' '));
const t3 = new Set('IN ID RU DZ PK PH'.split(' '));
const regions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
export function normalizeCountry(value: unknown) {
  const code = text(value).toUpperCase();
  if (code === 'UK') return 'GB';
  return /^[A-Z]{2}$/.test(code) && code !== 'ZZ' && regions.of(code) ? code : '未知';
}
export const confirmedCountryMapping = { validFrom: '2026-10-24', validThrough: '2026-11-08', t1: [...t1], t3: [...t3], alias: { UK: 'GB' }, unknown: '缺失或无法识别，不能归入 T2', confirmedBy: '用户提供截图并明确确认本次比较期' };

export function actionDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  // Base timestamps are instants; business dates use Asia/Shanghai.
  if (typeof value === 'number' || /^\d{13}$/.test(text(value))) {
    const epoch = Number(value);
    return Number.isFinite(epoch) && !Number.isNaN(new Date(epoch).getTime()) ? new Date(epoch + 8 * 3600000).toISOString().slice(0, 10) : null;
  }
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return !Number.isNaN(Date.parse(raw)) && new Date(raw).toISOString().slice(0, 10) === raw ? raw : null;
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(raw) && !Number.isNaN(Date.parse(raw))) return new Date(Date.parse(raw) + 8 * 3600000).toISOString().slice(0, 10);
  return null;
}

export function normalizeProductAction(row: EvidenceRow, recordId = text(row.record_id)): EvidenceRow {
  const candidates = ['merge_time','合入时间','release_time','上线时间','effective_time','生效时间','publish_time','发布时间'];
  const launchTimeField = candidates.find(key => text(row[key]) !== '');
  return { record_id: recordId, launch_time: launchTimeField ? row[launchTimeField] : null, launch_time_field: launchTimeField ?? null,
    stat_date: row.stat_date ?? row['统计日'], weekday: row.weekday ?? row['星期'],
    release_time: row.release_time ?? row['上线时间'], merge_time: row.merge_time ?? row['合入时间'], effective_time: row.effective_time ?? row['生效时间'], publish_time: row.publish_time ?? row['发布时间'], action_type: text(row.action_type ?? row['类型']),
    update_point: text(row.update_point ?? row['更新点']), description: text(row.description ?? row['说明']),
    platform: text(row.platform ?? row['端类型'] ?? row['端']) || '未知', board: text(row.board ?? row['板块']),
    version: text(row.version ?? row['版本']), source: text(row.source ?? row['来源']), commit_id: text(row.commit_id ?? row.commit), remark: text(row.remark ?? row['备注']), original_message: text(row.original_message ?? row['原消息链接']) };
}

export const candidateActionTypes = ['新增功能','优化','策略调整','配置变更','修复','故障恢复'];

export function selectProductActions(window: ReportWindow, source: EvidenceSource) {
  const searchStart = window.mode === 'day' ? shift(window.endDate, -27) : shift(window.startDate, -14);
  const eligible: EvidenceRow[] = [];
  const associatedReleases: EvidenceRow[] = [];
  const excluded: { recordId: string; reason: string }[] = [];
  for (const row of source.rows) {
    const recordId = text(row.record_id);
    const date = actionDate(row.launch_time);
    const scope = text(row.platform).toLowerCase();
    const tokens = scope.split(/[\s/、,，&+]+/);
    let reason = '';
    if (!recordId) reason = '缺失来源记录标识';
    else if (!date) reason = '缺失或无效生效时间，未使用统计日替代';
    else if (date < searchStart || date > window.endDate) reason = '生效时间不在本次四周窗口';
    else if (!scope || dimension(scope) === '未知') reason = '端未知，暂不用于端内解释';
    else if (!tokens.includes(window.platform) && !['双端', '全部', '全端'].includes(scope)) reason = '端范围不匹配或无法识别';
    else if (!candidateActionTypes.includes(text(row.action_type)) && row.action_type !== '版本发布') reason = '动作类型不在允许范围';
    if (reason) excluded.push({ recordId, reason });
    else if (row.action_type === '版本发布') associatedReleases.push({ ...row, launchDate: date, role: '仅作关联记录，不独立作为原因候选' });
    else eligible.push({ ...row, launchDate: date, priorityWindow: date! >= window.startDate, matchStatus: '仅通过时间窗口、类型和端筛选；路径、范围细节及方向仍需核对，不代表因果' });
  }
  return { source: source.source, provenance: source.provenance, readAt: source.readAt, searchStart, searchEnd: window.endDate, priorityStart: window.startDate,
    complete: source.status === 'ok' && source.complete === true, status: source.status,
    retrievedRecords: source.rows.length, eligible, associatedReleases, excluded, error: source.error,
    limitation: '完整表示已读完该表记录，不证明业务动作被完整记录；没有匹配项不证明没有发生动作' };
}

export function buildReportEvidence(window: ReportWindow, sources: EvidenceSources) {
  const isDay = window.mode === 'day';
  const analysisStart = isDay ? window.endDate : shift(window.startDate, 7);
  const calendar = isDay ? { baseline: [window.startDate], current: [window.endDate] } : { baseline: dates(window.startDate, shift(window.startDate, 6)), current: dates(analysisStart, window.endDate) };
  if (isDay && window.startDate >= window.endDate) throw new Error('日诊断比较日必须早于异动日');
  // Only the two requested days belong to a daily comparison; intervening days are not evidence.
  if (isDay) sources = Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, key === 'actions' ? source : { ...source, rows: source.rows.filter(row => [...calendar.baseline, ...calendar.current].includes(text(row.period))) }])) as EvidenceSources;
  if (!calendar.current.length || calendar.current.length > 7) throw new Error('报告比较窗口无效');
  const pair = (rows: EvidenceRow[]): Pair => ({ baseline: rows.filter(row => calendar.baseline.includes(text(row.period))), current: rows.filter(row => calendar.current.includes(text(row.period))) });
  const days = { baseline: calendar.baseline.length, current: calendar.current.length };
  const coverage = (source: EvidenceSource, expectedPlatforms?: string[]) => {
    const missing: string[] = [];
    for (const side of ['baseline', 'current'] as const) for (const date of calendar[side]) {
      if (expectedPlatforms) for (const platform of expectedPlatforms) {
        if (!source.rows.some(row => row.period === date && row.platform_type === platform)) missing.push(`${date}/${platform}`);
      } else if (!source.rows.some(row => row.period === date)) missing.push(date);
    }
    return { source: source.source, status: source.status, readAt: source.readAt, rows: source.rows.length, missing, complete: source.status === 'ok' && missing.length === 0, error: source.error };
  };
  const creationPlatforms = window.platform === 'web' ? ['WEB'] : ['IOS', 'ANDROID'];
  const sourceCoverage = { pay: coverage(sources.pay), funnel: coverage(sources.funnel), breakdown: coverage(sources.breakdown), renewal: coverage(sources.renewal), ads: coverage(sources.ads), creation: coverage(sources.creation, creationPlatforms), functions: coverage(sources.functions, creationPlatforms) };
  for (const key of ['pay', 'funnel'] as const) if (!sourceCoverage[key].complete) throw new Error(`${sourceCoverage[key].source} 缺少可比数据：${sourceCoverage[key].missing.join('、') || '读取失败'}`);
  for (const [source, fields] of [[sources.pay, ['gmv_usd']], [sources.funnel, ['active_uv','expose_uv','submit_uv','pay_uv','gmv_usd']]] as const) {
    if (source.rows.some(row => fields.some(field => row[field] == null || row[field] === '' || !Number.isFinite(Number(row[field]))))) throw new Error(`${source.source} 核心原子数据缺失或无效，未补零`);
    if (!isDay && source.rows.some(row => text(row.week_start) !== (text(row.period) < analysisStart ? window.startDate : analysisStart))) throw new Error(`${source.source} 业务周标签与比较窗口不一致`);
  }
  const checks: { id: string; passed: boolean; detail: string }[] = [];
  const check = (id: string, passed: boolean, detail: string) => { checks.push({ id, passed, detail }); return passed; };
  const daily = (rows: EvidenceRow[], field: string, side: keyof Pair) => { const n = sum(rows, field); return n == null ? null : n / days[side]; };
  const movement = (id: string, label: string, rows: EvidenceRow[], field: string, unit: Unit = 'count', average = true) => {
    const p = pair(rows);
    return metric(id, isDay ? label.replaceAll('日均', '当日') : label, average ? daily(p.baseline, field, 'baseline') : sum(p.baseline, field), average ? daily(p.current, field, 'current') : sum(p.current, field), unit);
  };
  const revenue = movement('revenue.total', '总日均GMV', sources.pay.rows, 'gmv_usd', 'usd');
  const revenueItems = ['ACTIVE_PAYMENT', 'AUTO_RENEWAL', 'API'].map((key, i) => {
    const m = movement(`revenue.${key}`, ['主动付费日均GMV', '自动续订日均GMV', 'API日均GMV'][i], sources.pay.rows.filter(row => row.pay_category === key), 'gmv_usd', 'usd');
    return { ...m, key, contribution: m.delta != null && revenue.delta != null ? netChangeShare(m.delta, revenue.delta) : null, contributionDenominator: revenue.id };
  });
  const activeRevenue = revenueItems[0];
  const activeRows = sources.pay.rows.filter(row => row.pay_category === 'ACTIVE_PAYMENT');
  const activeTypes = [...new Set(activeRows.map(row => text(row.pay_type)))].map(key => {
    const m = movement(`revenue.activeType.${key}`, key, activeRows.filter(row => row.pay_type === key), 'gmv_usd', 'usd');
    return { ...m, contribution: m.delta != null && activeRevenue.delta != null ? netChangeShare(m.delta, activeRevenue.delta) : null, contributionDenominator: activeRevenue.id };
  });
  const renewalRevenue = revenueItems[1];
  const renewalResultRows = sources.pay.rows.filter(row => row.pay_category === 'AUTO_RENEWAL');
  const renewalTypes = [...new Set(renewalResultRows.map(row => productTier(row.product_type)))].map(key => {
    const rows = renewalResultRows.filter(row => productTier(row.product_type) === key);
    const m = movement(`revenue.renewalType.${key}`, `${key}自动续订日均GMV`, rows, 'gmv_usd', 'usd');
    return { ...m, key, sourceLabels: [...new Set(rows.map(row => text(row.product_type)))], contribution: m.delta != null && renewalRevenue.delta != null ? netChangeShare(m.delta, renewalRevenue.delta) : null, contributionDenominator: renewalRevenue.id };
  });
  for (const side of ['baseline', 'current'] as const) check(`revenue.renewalTypes.${side}`, renewalRevenue[side] != null && renewalTypes.every(t => t[side] != null) && near(renewalTypes.reduce((n, t) => n + t[side]!, 0), renewalRevenue[side]!), '全部续订产品类型（含其他、未知）与支付结果自动续订收入守恒');
  for (const side of ['baseline', 'current'] as const) check(`revenue.partition.${side}`, revenue[side] != null && revenueItems.every(row => row[side] != null) && near(revenueItems.reduce((n, row) => n + row[side]!, 0), revenue[side]!), '主动付费、自动续订、API 与总收入对账');

  const atomKeys = ['active_uv', 'expose_uv', 'submit_uv', 'pay_uv', 'gmv_usd'] as const;
  const atoms = (rows: EvidenceRow[]) => Object.fromEntries(atomKeys.map(key => [key, sum(rows, key)])) as Record<typeof atomKeys[number], number | null>;
  const factorValues = (a: ReturnType<typeof atoms>, side: keyof Pair) => ({ activeUv: a.active_uv == null ? null : a.active_uv / days[side], subExposeRate: ratio(a.expose_uv, a.active_uv), subSubmitRate: ratio(a.submit_uv, a.expose_uv), chainPaySuccessRate: ratio(a.pay_uv, a.submit_uv), chainArppu: quotient(a.gmv_usd, a.pay_uv) });
  const factorLabels = { activeUv: '日均DAU', subExposeRate: '付费墙曝光率', subSubmitRate: '付费墙提交率', chainPaySuccessRate: '提交支付率', chainArppu: '客单价' };
  const funnelScope = (id: string, label: string, rows: EvidenceRow[]) => {
    const p = pair(rows), raw = { baseline: atoms(p.baseline), current: atoms(p.current) };
    const m = movement(`${id}.gmv`, `${label}链路日均GMV`, rows, 'gmv_usd', 'usd');
    const f0 = factorValues(raw.baseline, 'baseline'), f1 = factorValues(raw.current, 'current');
    const valid = Object.values(f0).every(n => n != null && n >= 0) && Object.values(f1).every(n => n != null && n >= 0);
    const effects = valid ? chainDriverEffects(f0 as ChainFactors, f1 as ChainFactors) : null;
    if (effects) check(`${id}.lmdi`, m.delta != null && near(Object.values(effects).reduce((n, v) => n + v, 0), m.delta), '五因子金额效应等于本组链路日均GMV变化');
    const factors = (Object.keys(factorLabels) as (keyof ChainFactors)[]).map(key => ({ ...metric(`${id}.${key}`, isDay ? factorLabels[key].replaceAll('日均', '当日') : factorLabels[key], f0[key], f1[key], key === 'activeUv' ? 'count' : key === 'chainArppu' ? 'usdPerUser' : 'rate'), key, effectUsd: effects?.[key] ?? null, contribution: effects && m.delta != null ? netChangeShare(effects[key], m.delta) : null, contributionDenominator: m.id }));
    return { id, label, raw, gmv: m, lmdi: { valid, reason: valid ? '' : '分子分母缺失、为零或不满足漏斗关系；未为未定义比率补零', factors,
      sameDirection: factors.filter(f => f.contribution != null && f.contribution > 0).sort((a, b) => b.contribution! - a.contribution!).map(f => f.id), offsets: factors.filter(f => f.contribution != null && f.contribution < 0).map(f => f.id) } };
  };
  const countBreakdown = (id: string, label: string, rows: EvidenceRow[], keyOf: (row: EvidenceRow) => string, field: string, parent: ReturnType<typeof metric>) => {
    const keys = [...new Set(rows.map(keyOf))];
    const groups = keys.map(key => ({ key, ...movement(`${id}.${key}`, valueLabel(key), rows.filter(row => keyOf(row) === key), field) }));
    const rawValid = groups.every(g => g.baseline != null && g.current != null) && parent.baseline != null && parent.current != null;
    if (!groups.length && parent.baseline === 0 && parent.current === 0) return { id, label, valid: true, parentId: parent.id, reason: '本组两周均未观测到人数，无贡献可归因', groups: [] };
    const d = rawValid ? decomposeCount(groups.map(g => ({ key: g.key, label: g.label, baseline: g.baseline!, current: g.current! })), { baseline: parent.baseline!, current: parent.current! }) : null;
    check(id, d?.valid === true, `${label}分组与父层人数守恒`);
    return { id, label, valid: d?.valid === true, parentId: parent.id, reason: d?.valid ? '' : '分组缺失或不守恒，仅保留原子数，不解释贡献', groups: groups.map(g => ({ ...g, contribution: d?.valid ? netChangeShare(g.delta!, parent.delta!) : null })) };
  };
  const rateBreakdown = (id: string, rows: EvidenceRow[], keyOf: (row: EvidenceRow) => string, parent: ReturnType<typeof funnelScope>, separateUnresolved: boolean) => {
    const p = pair(rows), keys = [...new Set(rows.map(keyOf))];
    const segments = keys.map(key => ({ key, label: valueLabel(key), baseline: { numerator: sum(p.baseline.filter(row => keyOf(row) === key), 'pay_uv'), denominator: sum(p.baseline.filter(row => keyOf(row) === key), 'submit_uv') }, current: { numerator: sum(p.current.filter(row => keyOf(row) === key), 'pay_uv'), denominator: sum(p.current.filter(row => keyOf(row) === key), 'submit_uv') } }));
    const parentAtoms = { baseline: { numerator: parent.raw.baseline.pay_uv, denominator: parent.raw.baseline.submit_uv }, current: { numerator: parent.raw.current.pay_uv, denominator: parent.raw.current.submit_uv } };
    if ([parentAtoms, ...segments].some(r => [r.baseline.numerator, r.baseline.denominator, r.current.numerator, r.current.denominator].some(n => n == null))) return { id, valid: false, reason: '分子分母缺失，未补零', atoms: segments };
    const d = decomposeRate(segments as Parameters<typeof decomposeRate>[0], parentAtoms as Parameters<typeof decomposeRate>[1], { separateUnresolved });
    // An undefined rate is not a failed conservation equation. Preserve its
    // unavailable status; only verify effects when the method is applicable.
    if (d.valid) check(id, near(d.efficiency + d.structure + d.unresolved, d.delta!), '效率、结构、未归因之和等于总体比率变化');
    return { id, valid: d.valid, reason: d.reason, parentId: parent.id, movement: metric(`${id}.rate`, '提交支付率', d.baselineRate, d.currentRate, 'rate'),
      effects: d.valid ? { efficiencyPp: d.efficiency * 100, structurePp: d.structure * 100, unresolvedPp: d.unresolved * 100, efficiencyContribution: netChangeShare(d.efficiency, d.delta!), structureContribution: netChangeShare(d.structure, d.delta!), unresolvedContribution: netChangeShare(d.unresolved, d.delta!), simpson: d.simpson } : null,
      groups: d.valid ? d.groups.map(g => ({ key: g.key, raw: { baseline: g.baseline, current: g.current }, rate: metric(`${id}.${g.key}.rate`, g.label, g.rate0, g.rate1, 'rate'), weight: metric(`${id}.${g.key}.weight`, `${g.label}提交人数占比`, g.w0, g.w1, 'rate'), efficiencyPp: g.efficiency * 100, structurePp: g.structure * 100, unresolvedPp: g.unresolvedEffect * 100, comparable: !g.absent })) : [], atoms: segments };
  };
  const tierNames: Record<string, string> = { create_cnt_30d_0: '近30日无创作用户', 'create_cnt_30d_[1,11)': '近30日创作1-10次用户', 'create_cnt_30d_[11,31)': '近30日创作11-30次用户', 'create_cnt_30d_[31,101)': '近30日创作31-100次用户', 'create_cnt_30d_[101,+inf)': '近30日创作101次以上用户' };
  const lifecycleOf = (row: EvidenceRow) => ['NEW', 'OLD'].includes(text(row.user_lifecycle)) ? text(row.user_lifecycle) : '未知';
  const allChain = funnelScope('chain.all', '全部用户', sources.funnel.rows);
  const overallCountries = countBreakdown('chain.all.dauCountries', '国家层级DAU', sources.funnel.rows, row => dimension(row.country_tier), 'active_uv', movement('chain.all.dau', '日均DAU', sources.funnel.rows, 'active_uv'));
  const overallPayRate = { country: rateBreakdown('chain.all.countryPayRate', sources.funnel.rows, row => dimension(row.country_tier), allChain, false), channel: rateBreakdown('chain.all.submitChannelPayRate', sources.breakdown.rows.filter(row => row.breakdown_type === 'SUBMIT_CHANNEL'), row => dimension(row.breakdown_value), allChain, true) };
  const groupKeys = isDay ? [...new Set(sources.funnel.rows.map(row => dimension(row.creation_cnt_30d_label)))] : ['NEW', 'OLD', '未知'];
  if (isDay && sources.funnel.rows.some(row => !Object.hasOwn(row, 'creation_cnt_30d_label'))) throw new Error('日诊断缺少创作分层原始字段，不能用注册新老或总体代替');
  const groupOf = isDay ? (row: EvidenceRow) => dimension(row.creation_cnt_30d_label) : lifecycleOf;
  const groups = groupKeys.map((key, i) => {
    const rows = sources.funnel.rows.filter(row => groupOf(row) === key);
    const b = sources.breakdown.rows.filter(row => groupOf(row) === key);
    const scope = funnelScope(`chain.${isDay ? 'creationTier.' : ''}${key}`, isDay ? tierNames[key] ?? key : ['注册新用户', '注册老用户', '注册信息未知用户'][i], rows);
    const exposure = movement(`${scope.id}.expose`, '日均曝光人数', rows, 'expose_uv');
    const dau = movement(`${scope.id}.dau`, '日均DAU', rows, 'active_uv');
    return { ...scope, key, contribution: scope.gmv.delta != null && allChain.gmv.delta != null ? netChangeShare(scope.gmv.delta, allChain.gmv.delta) : null, contributionDenominator: allChain.gmv.id,
      dauCountries: countBreakdown(`${scope.id}.dauCountries`, '国家层级DAU', rows, row => dimension(row.country_tier), 'active_uv', dau),
      countryPayRate: rateBreakdown(`${scope.id}.countryPayRate`, rows, row => dimension(row.country_tier), scope, false),
      submitChannelPayRate: rateBreakdown(`${scope.id}.submitChannelPayRate`, b.filter(row => row.breakdown_type === 'SUBMIT_CHANNEL'), row => dimension(row.breakdown_value), scope, true),
      exposure: { count: exposure, types: countBreakdown(`${scope.id}.exposeTypes`, '曝光类型', b.filter(row => row.breakdown_type === 'EXPOSE_TYPE'), row => dimension(row.breakdown_value), 'expose_uv', exposure), reasons: countBreakdown(`${scope.id}.exposeReasons`, '曝光原因', b.filter(row => row.breakdown_type === 'EXPOSE_REASON'), row => dimension(row.breakdown_value), 'expose_uv', exposure) },
      daily: rows.map(row => ({ ...row })) };
  });
  for (const side of ['baseline', 'current'] as const) for (const field of atomKeys) check(`${isDay ? 'creationTier' : 'lifecycle'}.${side}.${field}`, allChain.raw[side][field] != null && groups.every(g => g.raw[side][field] != null) && near(groups.reduce((n, g) => n + g.raw[side][field]!, 0), allChain.raw[side][field]!), '分组与主动链路原子数对账');
  const gap = metric('coverage.gap', isDay ? '未归因当日差额' : '未归因日均差额', activeRevenue.baseline! - allChain.gmv.baseline!, activeRevenue.current! - allChain.gmv.current!, 'usd');
  const gapRate = metric('coverage.gapRate', '未归因占比', quotient(gap.baseline, activeRevenue.baseline), quotient(gap.current, activeRevenue.current), 'rate');

  const renewalAtoms = (rows: EvidenceRow[]) => ({ expire: sum(rows, 'expire_user_cnt'), paid: sum(rows, 'renew_user_cnt'), gmv: sum(rows, 'renew_amount_usd') });
  const renewalScope = (id: string, label: string, rows: EvidenceRow[]) => {
    const p = pair(rows), raw = { baseline: renewalAtoms(p.baseline), current: renewalAtoms(p.current) };
    const completeness = coverage({ ...sources.renewal, rows });
    const values = (side: keyof Pair) => ({ expiry: raw[side].expire == null ? null : raw[side].expire! / days[side], rate: ratio(raw[side].paid, raw[side].expire), aov: quotient(raw[side].gmv, raw[side].paid) });
    const r0 = values('baseline'), r1 = values('current');
    const gmv = metric(`${id}.gmv`, `${label}到期队列${isDay ? '当日' : '日均'}续订GMV`, completeness.complete ? daily(p.baseline, 'renew_amount_usd', 'baseline') : null, completeness.complete ? daily(p.current, 'renew_amount_usd', 'current') : null, 'usd');
    const valid = completeness.complete && Object.values(r0).every(v => v != null && v >= 0) && Object.values(r1).every(v => v != null && v >= 0);
    const effects = valid ? lmdiDriverEffects(r0 as Record<'expiry'|'rate'|'aov', number>, r1 as Record<'expiry'|'rate'|'aov', number>, ['expiry','rate','aov']) : null;
    if (effects) check(`${id}.lmdi`, near(Object.values(effects).reduce((n, v) => n + v, 0), gmv.delta!), '本组续订三因子金额效应等于本组到期队列日均收入变化，不换算为支付结果收入影响');
    const factors = (['expiry','rate','aov'] as const).map((key, i) => ({ ...metric(`${id}.${key}`, [isDay ? '当日到期人数' : '日均到期人数','续订率','续订客单价'][i], completeness.complete ? r0[key] : null, completeness.complete ? r1[key] : null, key === 'rate' ? 'rate' : key === 'aov' ? 'usdPerUser' : 'count'), key, effectUsd: effects?.[key] ?? null, contribution: effects ? netChangeShare(effects[key], gmv.delta!) : null, contributionDenominator: gmv.id }));
    return { id, label, available: completeness.complete, missingDates: completeness.missing, raw, gmv, lmdi: { valid, reason: valid ? '' : '本组日期不完整、原子数据缺失或比率分母为零；不补零，不用整体续订因子替代', factors, sameDirection: factors.filter(f => f.contribution != null && f.contribution > 0).sort((a,b) => b.contribution! - a.contribution!).map(f => f.id), offsets: factors.filter(f => f.contribution != null && f.contribution < 0).map(f => f.id) } };
  };
  const renewal = renewalScope('renewal', '', sources.renewal.rows);
  const renewalProductTypes = [...new Set(sources.renewal.rows.map(row => productTier(row.plan_tier)))].map(key => {
    const rows = sources.renewal.rows.filter(row => productTier(row.plan_tier) === key);
    return { ...renewalScope(`renewal.productType.${key}`, key, rows), key, sourceLabels: [...new Set(rows.map(row => text(row.plan_tier)))], cycles: [...new Set(rows.map(row => dimension(row.plan_cycle)))] };
  });
  if (sourceCoverage.renewal.complete) for (const side of ['baseline','current'] as const) for (const field of ['expire','paid','gmv'] as const) {
    if (renewal.raw[side][field] != null && renewalProductTypes.every(t => t.raw[side][field] != null)) check(`renewal.productTypes.${side}.${field}`, near(renewalProductTypes.reduce((n, t) => n + t.raw[side][field]!, 0), renewal.raw[side][field]!), '全部档位原子数与本来源续订总表守恒，不跨来源对账');
  }

  const mappingApplicable = window.startDate >= confirmedCountryMapping.validFrom && window.endDate <= confirmedCountryMapping.validThrough;
  const adRows = sources.ads.rows.map(row => ({ ...row, normalizedCountry: normalizeCountry(row.country) }));
  const adMetrics = (id: string, rows: EvidenceRow[]) => {
    const p = pair(rows);
    const base = ['clicks','impressions','cost_usd','register_user_cnt'].map((field, i) => movement(`${id}.${field}`, `${isDay ? '当日' : '周'}${['点击量','曝光量','花费','投放注册人数'][i]}`, rows, field, field === 'cost_usd' ? 'usd' : 'count', false));
    return [...base, metric(`${id}.ctr`, 'CTR', ratio(sum(p.baseline, 'clicks'), sum(p.baseline, 'impressions')), ratio(sum(p.current, 'clicks'), sum(p.current, 'impressions')), 'rate'), metric(`${id}.cpc`, 'CPC', quotient(sum(p.baseline, 'cost_usd'), sum(p.baseline, 'clicks')), quotient(sum(p.current, 'cost_usd'), sum(p.current, 'clicks')), 'usdPerUser')];
  };
  const adsTotal = adMetrics('ads.all', adRows);
  const adsGroups = (field: (row: EvidenceRow) => string, id: string) => [...new Set(adRows.map(field))].map(key => {
    const metrics = adMetrics(`${id}.${key}`, adRows.filter(row => field(row) === key));
    return { key, metrics, clickChangeContribution: netChangeShare(metrics[0].delta!, adsTotal[0].delta!) };
  });
  const adsCountries = sourceCoverage.ads.complete ? adsGroups(row => text(row.normalizedCountry), 'ads.country') : [];
  const adsTiers = sourceCoverage.ads.complete && mappingApplicable ? adsGroups(row => row.normalizedCountry === '未知' ? '未知' : t1.has(text(row.normalizedCountry)) ? 'T1' : t3.has(text(row.normalizedCountry)) ? 'T3' : 'T2', 'ads.tier') : [];
  if (adsTiers.length) for (const side of ['baseline','current'] as const) for (let i = 0; i < 4; i++) check(`ads.${side}.${i}`, adsTotal[i][side] != null && near(adsTiers.reduce((n, g) => n + g.metrics[i][side]!, 0), adsTotal[i][side]!), '投放国家映射分组与父层对账');

  const creationMetrics = (id: string, rows: EvidenceRow[], available: boolean) => {
    const p = pair(rows);
    const atomLabels = { creation_task_cnt: '日均创作任务数', valid_creation_task_cnt: '日均有效任务数', creation_user_cnt: '日均创作用户数', success_task_cnt: '日均成功任务数', success_output_cnt: '日均成功产出数', adopted_task_cnt: '日均采纳任务数', adopted_output_cnt: '日均采纳产出数' };
    const result = Object.entries(atomLabels).map(([field, label]) => available ? movement(`${id}.${field}`, label, rows, field) : metric(`${id}.${field}`, label, null, null, 'count', '数据源不完整'));
    for (const [label, n, d] of [['任务成功率','success_task_cnt','creation_task_cnt'],['任务采纳率','adopted_task_cnt','success_task_cnt']] as const) result.push(metric(`${id}.${n}.rate`, label, available ? ratio(sum(p.baseline,n),sum(p.baseline,d)) : null, available ? ratio(sum(p.current,n),sum(p.current,d)) : null, 'rate'));
    return result;
  };
  const creation = creationMetrics('creation.all', sources.creation.rows, sourceCoverage.creation.complete);
  const functionGroups = [...new Set(sources.functions.rows.map(row => dimension(row.creation_mode)))].map(key => ({ key, metrics: creationMetrics(`creation.function.${key}`, sources.functions.rows.filter(row => dimension(row.creation_mode) === key), sourceCoverage.functions.complete) }));
  const taskFields = ['creation_task_cnt','valid_creation_task_cnt','success_task_cnt','success_output_cnt','adopted_task_cnt','adopted_output_cnt'];
  const functionChecks = [];
  if (sourceCoverage.creation.complete && sourceCoverage.functions.complete) for (const date of [...calendar.baseline, ...calendar.current]) for (const platform of creationPlatforms) for (const field of taskFields) {
    const overall = sum(sources.creation.rows.filter(row => row.period === date && row.platform_type === platform), field);
    const children = sum(sources.functions.rows.filter(row => row.period === date && row.platform_type === platform), field);
    functionChecks.push(check(`creation.${date}.${platform}.${field}`, overall != null && children != null && near(overall, children), '功能任务/产出数与总表对账；功能UV不加总'));
  }
  const retention = [3,7,30].map(horizon => {
    const field = `d${horizon}_creation_user_cnt`;
    const matureDates = (side: keyof Pair) => calendar[side].filter(date => creationPlatforms.every(platform => { const rows = sources.creation.rows.filter(row => row.period === date && row.platform_type === platform); return rows.length > 0 && rows.every(row => row[field] != null); }));
    const b = matureDates('baseline'), c = matureDates('current');
    const full = sourceCoverage.creation.complete && b.length === days.baseline && c.length === days.current;
    return { horizon, baselineMatureDates: b, analysisMatureDates: c, comparableFullWeeks: full, rate: metric(`creation.retention.d${horizon}`, `D${horizon}创作留存率`, full ? ratio(sum(pair(sources.creation.rows).baseline,field),sum(pair(sources.creation.rows).baseline,'creation_user_cnt')) : null, full ? ratio(sum(pair(sources.creation.rows).current,field),sum(pair(sources.creation.rows).current,'creation_user_cnt')) : null, 'rate', full ? '' : isDay ? '比较日或异动日cohort未成熟或数据不完整，不生成完整比较结论' : '两周未全部成熟或数据不完整，不生成完整周留存变化结论') };
  });
  const actions = selectProductActions(window, sources.actions);
  return {
    schemaVersion: 2, ...(isDay ? { mode: 'day' as const } : {}), window: { ...window, analysisStart, baselineDates: calendar.baseline, analysisDates: calendar.current, days },
    sources: sourceCoverage, checks,
    revenue: { total: revenue, items: revenueItems, activeTypes, renewalTypes, renewalTypeRanking: { sameDirection: renewalTypes.filter(t => t.contribution != null && t.contribution > 0).sort((a,b) => b.contribution! - a.contribution!).map(t => t.id), offsets: renewalTypes.filter(t => t.contribution != null && t.contribution < 0).map(t => t.id), denominator: renewalRevenue.id }, rule: '总GMV包含API；API独立列项且不进入主动付费漏斗' },
    activeChain: { total: allChain, ...(isDay ? { creationTiers: groups } : { lifecycle: groups }), dauCountries: overallCountries, payRate: overallPayRate, coverage: { resultGmv: activeRevenue, chainGmv: allChain.gmv, gap, gapRate, note: '支付结果汇总实际收入；链路仅包含能够按行为时间顺序串联的部分。差额保留，不分配给链路因子。', threePercentIsBlockingThreshold: false } },
    renewal: { ...renewal, productTypes: renewalProductTypes, typeCorrespondence: { status: 'confirmed', resultDimension: 'product_type', chainDimension: 'plan_tier', chainTierDefinition: '到期时的原订阅档位', sameNameTypes: ['Ultra', 'Pro', 'Lite'], confirmedBy: '用户于2026-11-09明确确认：到期时的原订阅档位，可以按照同名类型对应分析。', otherTypes: '其他及未知类型保留原名，未取得对应关系时不自行映射。' }, note: '按到期cohort统计，不等于按支付日期统计的自动续订收入；按各自来源分别计算贡献，不换算影响。Ultra/Pro/Lite已由用户确认可按同名类型对应分析；链路档位为到期时的原订阅档位，不代表续订后的目标档位。' },
    ads: { available: sourceCoverage.ads.complete, mapping: { ...confirmedCountryMapping, applicable: mappingApplicable }, totals: sourceCoverage.ads.complete ? adsTotal : [], countries: adsCountries, tiers: adsTiers, limitation: '点击不等于DAU，投放注册不等于链路注册新用户活跃。未桥接同一用户及归属日期，不给点击到注册漏斗或DAU因果解释比例。' },
    creation: { available: sourceCoverage.creation.complete, metrics: creation, functions: functionGroups, functionCountsReconcile: functionChecks.length > 0 && functionChecks.every(Boolean), retention, limitation: '创作与支付链路尚未关联同一批用户；功能UV不可相加。成功率分母沿用现有任务总数定义，未改成有效任务数。' },
    productActions: actions,
    gaps: [renewalTypes.some(t=>t.key==='未知') && '支付结果含未知续订产品类型，不能将其归入Ultra/Pro/Lite', renewalProductTypes.some(t=>t.key==='未知') && '续订链路含未知档位，不能当作已匹配的产品类型', ...renewalProductTypes.filter(t=>!t.lmdi.valid).map(t=>`${t.label}续订链路数据或比率不可用，不以整体三因子替代`), !mappingApplicable && '本比较期尚无经用户确认的国家映射；投放国家层级论证不可用', !actions.complete && '未完成四周产品动作来源核验，不声称已经查全', ...Object.entries(sourceCoverage).filter(([,s])=>!s.complete).map(([key])=>`${key} 数据不完整，相关解释待检查`), checks.some(c => c.id.startsWith('creation.') && !c.passed) && '功能任务或产出未与总表对齐，不能据此确认主要功能', ...retention.filter(r=>!r.comparableFullWeeks).map(r=>`D${r.horizon}未形成完整${isDay ? '日' : '周'}可比留存`)].filter((s): s is string => Boolean(s)),
  };
}
