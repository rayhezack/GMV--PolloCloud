import { getBusinessWeekStart } from './business-week.ts';

export type RevenueMetric = 'totalGmv' | 'activeGmv' | 'renewalGmv';
export type ProductAction = {
  id: string; date: string; title: string; description: string; platform: string;
  kind: 'pricing' | 'payment' | 'registration' | 'creation' | 'renewal' | 'other';
  actionType: string; source: string; version: string;
};
export type ProductActionSource = { actions: ProductAction[]; available: boolean; readAt: string; lastSyncError?: string | null };
export type RevenueEvent = {
  date: string; change: number; threshold: number; comparison: 'day' | 'week';
  value: number; previous: number; actions: ProductAction[];
};
type Row = { period: string; totalGmv?: number | null; activeGmv?: number | null; renewalGmv?: number | null };
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join('/') : value == null ? '' : typeof value === 'object' ? text((value as Record<string, unknown>).text ?? (value as Record<string, unknown>).name) : String(value).trim();

// Release/merge times are instants in Asia/Shanghai. A record's 统计日 is not a release date.
export function productActionDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return !Number.isNaN(Date.parse(raw)) && new Date(raw).toISOString().slice(0, 10) === raw ? raw : null;
  const time = typeof value === 'number' || /^\d{13}$/.test(raw) ? Number(value) : /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : null;
}

export function normalizeChartActions(records: { id: string; fields: Record<string, unknown> }[]): ProductAction[] {
  return records.flatMap(({id, fields: r}) => {
    const date = productActionDate(['上线时间', 'release_time', '生效时间', 'effective_time', '合入时间', 'merge_time'].map(k => r[k]).find(v => text(v)));
    const title = text(r['更新点'] ?? r.update_point), description = text(r['说明'] ?? r.description);
    const platform = text(r['端类型'] ?? r['端'] ?? r.platform).toLowerCase().replace(/webapp|appweb/g, 'web/app');
    const type = text(r['类型'] ?? r.action_type);
    if (!date || !title) return [];
    // This is a factual release log, not a claim about which release explains GMV.
    const context = `${title} ${description}`;
    const kind: ProductAction['kind'] = /续订|续费|自动扣费|到期/.test(title) ? 'renewal'
      : /定价|pricing|折扣|折|优惠|价格|积分消耗|套餐|权益/i.test(context) ? 'pricing'
      : /支付|收银|UPI|Stripe|PayU|BharatPay/i.test(title) ? 'payment'
      : /注册|登录|登陆|signup|sign.up|onboarding/i.test(title) ? 'registration'
      : /创作|生成|模型|Recast|Cinema|Motion/i.test(title) ? 'creation' : 'other';
    return [{id, date, title, description, platform, kind, actionType: type, source: text(r['来源'] ?? r.source), version: text(r['版本'] ?? r.version)}];
  });
}
const percentile = (values: number[], q: number) => {
  const sorted = [...values].sort((a,b) => a-b), position = (sorted.length-1)*q, lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi]-sorted[lo])*(position-lo);
};

/** Same P95/P05 and 10% floor as GMV alerts, learned only from twelve complete PRIOR business weeks. */
export function revenueActionEvents(rows: Row[], actions: ProductAction[], metric: RevenueMetric, platform: string, start: string, end: string): RevenueEvent[] {
  const byDay = new Map(rows.map(r => [r.period, r[metric]]));
  const at = (date: string) => { const value = byDay.get(date); return value != null && Number.isFinite(value) ? value : null; };
  const candidates: RevenueEvent[] = [];
  for (const row of rows) {
    const date = row.period, value = at(date);
    if (date < start || date > end || value == null || value < 0) continue;
    // Keep all records for the selected platform on that release day, without inferring impact.
    const relevant = actions.filter(a => a.date === date && (platform === 'all' || a.platform.split('/').includes(platform)));
    const unique = [...new Map(relevant.map(a => [a.id,a])).values()];
    if (!unique.length) continue;
    const week = getBusinessWeekStart(date);
    const weeks = Array.from({length:12},(_,i) => shift(week, -(i+1)*7));
    if (weeks.some(w => Array.from({length:7},(_,i) => at(shift(w,i))).some(v => v == null))) continue;
    const history = weeks.flatMap(w => Array.from({length:7},(_,i) => shift(w,i)));
    const signals = ([1,7] as const).flatMap(days => {
      const previous = at(shift(date,-days));
      if (previous == null || previous <= 0) return [];
      const changes = history.flatMap(d => { const v = at(d), p = at(shift(d,-days)); return v != null && p != null && v >= 0 && p > 0 ? [v/p-1] : []; });
      if (changes.length < 8) return [];
      const change = value / previous - 1;
      const threshold = change >= 0 ? Math.max(.10,percentile(changes,.95)) : Math.min(-.10,percentile(changes,.05));
      return (change >= 0 ? change >= threshold : change <= threshold) ? [{date, value, previous, change, threshold, comparison: days === 7 ? 'week' as const : 'day' as const, actions: unique}] : [];
    });
    signals.sort((a,b) => Math.abs(b.change/b.threshold)-Math.abs(a.change/a.threshold));
    if (signals[0]) candidates.push(signals[0]);
  }
  return candidates.sort((a,b) => a.date.localeCompare(b.date));
}
