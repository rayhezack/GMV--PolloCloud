import type { GmvAnomalyMetric, OverviewTrendPoint } from '@shared/api.interface';
import { revenueBuckets, shiftDay } from '../../components/v62/trend-data.ts';
export type HomeMetric = GmvAnomalyMetric | 'renewalRate';
export const homeMetrics = [
  {
    key: 'totalGmv',
    label: '大盘 GMV',
    tip: '来自付费类型日表，包含主动付费、自动续订及 API 等收入。订单量使用同源订单当量，不是支付人数。',
  },
  {
    key: 'activeGmv',
    label: '主动付费',
    tip: '来自付费类型日表的主动付费明细，不含自动续订。订单量使用同源订单当量。',
  },
  { key: 'renewalGmv', label: '自动续订', tip: '按支付日期汇总的续订金额，与按到期人群统计的续订率口径不同。' },
  {
    key: 'renewalRate',
    label: '续订率',
    tip: '到期续订日表中，续订用户数 / 到期用户数。周、月按两项合计重算；无到期用户或缺失时不计算。',
  },
] as const;
export function homeValue(p: OverviewTrendPoint | undefined, key: HomeMetric, orders = false) {
  return !p
    ? null
    : orders && key === 'totalGmv'
      ? (p.totalOrders ?? null)
      : orders && key === 'activeGmv'
        ? (p.activeOrders ?? null)
        : (p[key] ?? null);
}
export function homeBuckets(
  rows: OverviewTrendPoint[],
  metric: HomeMetric,
  orders: boolean,
  start: string,
  end: string,
  grain: 'day' | 'week' | 'month',
) {
  const mapped = rows.map((p) => ({
    period: p.period,
    totalGmv: homeValue(p, metric, orders) ?? NaN,
    activeGmv: 0,
    renewalGmv: 0,
  }));
  const buckets = revenueBuckets(mapped, 'totalGmv', start, end, grain);
  if (metric !== 'renewalRate') return buckets;
  const byDate = new Map(rows.map((p) => [p.period, p]));
  const ratio = (dates: string[]) => {
    const points = dates.map((d) => byDate.get(d));
    if (points.some((p) => p?.renewalRate == null || p.expireUserCnt == null || p.renewUserCnt == null)) return null;
    const expired = points.reduce((n, p) => n + p!.expireUserCnt, 0);
    return expired > 0 ? points.reduce((n, p) => n + p!.renewUserCnt!, 0) / expired : null;
  };
  return buckets.map((b) => ({
    ...b,
    value: ratio(b.dates) ?? NaN,
    baseline: ratio(b.dates.map((d) => shiftDay(d, -7))),
  }));
}

/** The calendar defaults to a quarter until the header range is explicitly set. */
export function homeCalendarWindow(startDate: string, endDate: string, explicitRange: boolean) {
  return { startDate: explicitRange ? startDate : endDate ? shiftDay(endDate, -89) : '', endDate };
}
