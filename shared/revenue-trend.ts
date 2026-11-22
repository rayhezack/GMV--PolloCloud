import { getBusinessWeekStart } from './business-week';
import type { OverviewTrendPoint } from './api.interface';

export type RevenueGrain = 'day' | 'week' | 'month';
export type RevenueMetric = 'totalGmv' | 'activeGmv' | 'renewalGmv';
export type RevenueTrendBucket = OverviewTrendPoint & { coverage: string; days: number; partial: boolean };

// Aggregate only actual observations in the card's selected date window.
// Each date contributes once; null/missing observations never become zero.
export function aggregateRevenueTrend(rows: OverviewTrendPoint[], metric: RevenueMetric, grain: RevenueGrain): RevenueTrendBucket[] {
  const dates = new Map(rows.filter(row => row[metric] != null && Number.isFinite(row[metric])).map(row => [row.period, row]));
  const grouped = new Map<string, OverviewTrendPoint[]>();
  for (const row of dates.values()) {
    const period = grain === 'week' ? getBusinessWeekStart(row.period) : grain === 'month' ? `${row.period.slice(0, 7)}-01` : row.period;
    const bucket = grouped.get(period) ?? [];
    bucket.push(row);
    grouped.set(period, bucket);
  }
  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([period, bucket]) => {
    const days = bucket.map(row => row.period).sort();
    const expected = grain === 'week' ? 7 : grain === 'month' ? new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate() : 1;
    return { ...bucket[0], period, coverage: days.length === 1 ? days[0] : `${days[0]} 至 ${days.at(-1)}`, days: days.length, partial: days.length < expected,
      [metric]: bucket.reduce((sum, row) => sum + Number(row[metric]), 0) / days.length };
  });
}
