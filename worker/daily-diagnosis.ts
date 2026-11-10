import { buildReportEvidence, metric, type EvidenceSources } from './report-evidence.ts';
import { netChangeShare } from '../shared/rate-attribution.ts';
import { loadReportSources } from './report-evidence-loader.ts';

export type DailySignal = {
  platform: 'all' | 'web' | 'app'; metric: 'totalGmv' | 'activeGmv' | 'renewalGmv';
  period: string; baselinePeriod: string; window: 'day' | 'week'; direction: 'up' | 'down';
  change: number; threshold: number; currentDailyAvg: number; previousDailyAvg: number;
  historyCount: number; baselineWindow: string;
};
const shift = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

/** The existing detector supplies signals. This function never invents an anomaly. */
export function dailyComparison(signals: DailySignal[]) {
  const first = signals[0];
  if (!first || !validDate(first.period) || !['all','web','app'].includes(first.platform) || !['totalGmv','activeGmv','renewalGmv'].includes(first.metric)) throw new Error('缺少有效的日异动信号');
  if (first.period >= new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)) throw new Error('日诊断只支持已结束的统计日');
  if (new Set(signals.map(s => s.window)).size !== signals.length) throw new Error('同一比较口径的异动信号重复');
  for (const s of signals) {
    if (s.period !== first.period || s.platform !== first.platform || s.metric !== first.metric || !['day','week'].includes(s.window) || s.baselinePeriod !== shift(s.period, s.window === 'day' ? -1 : -7)) throw new Error('必须使用同日、同端、同指标的真实比较信号');
    if (![s.change,s.threshold,s.currentDailyAvg,s.previousDailyAvg,s.historyCount].every(Number.isFinite) || s.currentDailyAvg <= 0 || s.previousDailyAvg <= 0 || s.historyCount < 8) throw new Error('异动信号数值或历史样本无效');
    if (Math.abs(s.currentDailyAvg / s.previousDailyAvg - 1 - s.change) > 1e-8 || (s.direction === 'up' ? !(s.threshold >= .10 && s.change >= s.threshold) : s.direction === 'down' ? !(s.threshold <= -.10 && s.change <= s.threshold) : true)) throw new Error('信号金额、变化率或触发方向不一致');
  }
  const primary = signals.find(s => s.window === 'week') ?? first;
  return { mode: 'day' as const, platform: first.platform, metric: first.metric, date: first.period, baselineDate: primary.baselinePeriod, primary, supplementary: signals.filter(s => s !== primary) };
}

export type OverallDailyContext = { baseline: number; current: number; source: string };

/** All prepared facts are retained. The Skill/model chooses the relevant platform and branches. */
export function buildDailyDiagnosis(signals: DailySignal[], sources: Partial<Record<'web' | 'app', EvidenceSources>>, overall?: OverallDailyContext) {
  const trigger = dailyComparison(signals);
  if (overall && (trigger.metric !== 'totalGmv' || ![overall.baseline, overall.current].every(n => Number.isFinite(n) && n > 0))) throw new Error('缺少大盘两日真实总 GMV');
  // A client anomaly requires overall context even when the overall threshold did not fire.
  // The comparison uses overall source amounts; original detector signals stay separate.
  const comparison = overall ? { ...trigger, platform: 'all' as const, primary: {
    platform: 'all' as const, metric: trigger.metric, period: trigger.date, baselinePeriod: trigger.baselineDate, window: trigger.primary.window,
    currentDailyAvg: overall.current, previousDailyAvg: overall.baseline, change: overall.current / overall.baseline - 1,
    direction: overall.current >= overall.baseline ? 'up' as const : 'down' as const,
  }, supplementary: [], context: { kind: 'client_anomaly_companion' as const, source: overall.source, triggerSignals: signals } } : trigger;
  const platforms = comparison.platform === 'all' ? ['web','app'] as const : [comparison.platform];
  const platformEvidence = platforms.map(platform => {
    if (!sources[platform]) throw new Error(`缺少 ${platform} 日诊断数据`);
    return { platform, evidence: buildReportEvidence({ platform, startDate: comparison.baselineDate, endDate: comparison.date, mode: 'day' }, sources[platform]!) };
  });
  const scopeMetric = (e: ReturnType<typeof buildReportEvidence>) => comparison.metric === 'totalGmv' ? e.revenue.total : comparison.metric === 'activeGmv' ? e.activeChain.total.gmv : e.renewal.gmv;
  const denominator = comparison.primary.currentDailyAvg - comparison.primary.previousDailyAvg;
  const contributions = platformEvidence.map(({ platform, evidence }) => {
    const value = scopeMetric(evidence);
    return { platform, ...value, contribution: value.delta == null ? null : netChangeShare(value.delta, denominator) };
  });
  const sum = (side: 'baseline' | 'current') => contributions.every(v => v[side] != null) ? contributions.reduce((n, v) => n + v[side]!, 0) : null;
  const residual = metric('platform.unallocated', '未分配端差额', sum('baseline') == null ? null : comparison.primary.previousDailyAvg - sum('baseline')!, sum('current') == null ? null : comparison.primary.currentDailyAvg - sum('current')!, 'usd');
  const checks = platformEvidence.flatMap(({ platform, evidence }) => evidence.checks.map(c => ({ ...c, id: `${platform}.${c.id}` })));
  if (comparison.platform !== 'all') checks.push({ id: 'trigger.source', passed: residual.baseline != null && residual.current != null && Math.abs(residual.baseline) < 1e-6 && Math.abs(residual.current) < 1e-6, detail: '触发来源金额与同来源日数据一致，不改用另一套收入金额' });
  return { schemaVersion: 3 as const, mode: 'day' as const, comparison, platformComparison: { contributions, residual, denominator, metric: comparison.metric }, platformEvidence, checks };
}

export async function collectDailyDiagnosis(signals: DailySignal[], io: Parameters<typeof loadReportSources>[1], overallContext = false) {
  const comparison = dailyComparison(signals);
  const platforms = overallContext || comparison.platform === 'all' ? ['web','app'] as const : [comparison.platform];
  const sources: Partial<Record<'web' | 'app', EvidenceSources>> = {};
  for (const platform of platforms) sources[platform] = await loadReportSources({ platform, startDate: comparison.baselineDate, endDate: comparison.date, mode: 'day' }, io);
  let overall: OverallDailyContext | undefined;
  if (overallContext) {
    const amounts = await io.query("SELECT period,SUM(gmv_usd) AS gmv_usd FROM pollo_da_fact_rows_read WHERE platform='all' AND period IN (?,?) AND dataset='pay_type' AND dataset_kind='daily' AND attribution_type='NONE' AND pay_category IN ('ACTIVE_PAYMENT','AUTO_RENEWAL','API') AND pay_type<>'汇总' GROUP BY period", comparison.baselineDate, comparison.date);
    const amount = (date: string) => { const row = amounts.find(row => row.period === date); return row?.gmv_usd == null ? NaN : Number(row.gmv_usd); };
    overall = { baseline: amount(comparison.baselineDate), current: amount(comparison.date), source: 'pollo_da_fact_rows_read/pay_type/NONE/all' };
  }
  return buildDailyDiagnosis(signals, sources, overall);
}
