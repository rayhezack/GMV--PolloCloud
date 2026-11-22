import { moneyCompact, countCompact, rate } from '../../../../shared/format.ts';
import { getBusinessWeekStart } from '../../../../shared/business-week.ts';
import type { GmvAnomalyMetric, OverviewTrendPoint } from '@shared/api.interface';
export const shiftDay = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export type TrendBucket = {
  date: string;
  selectedDate: string;
  dates: string[];
  value: number;
  baseline: number | null;
  partial?: string;
};

export function cashFlowSeries(buckets: TrendBucket[]) {
  const paired = buckets.flatMap((bucket, index) =>
    bucket.baseline == null ? [] : [{ index, value: bucket.baseline }],
  );
  return {
    data: buckets.map((bucket) => ({ date: bucket.date, value: bucket.value })),
    compare: paired.map((point) => point.value),
    compareIndices: paired.map((point) => point.index),
  };
}

// Aggregate daily revenue as daily averages. A missing reference day makes the
// bucket non-comparable; it must never be silently replaced with zero.
type RevenuePoint = Pick<OverviewTrendPoint, 'period' | GmvAnomalyMetric>;
export function revenueBuckets(
  rows: RevenuePoint[],
  metric: GmvAnomalyMetric,
  start: string,
  end: string,
  granularity: 'day' | 'week' | 'month',
): TrendBucket[] {
  const byDate = new Map(rows.map((row) => [row.period, row[metric]]));
  const groups = new Map<string, RevenuePoint[]>();
  rows
    .filter((row) => row.period >= start && row.period <= end)
    .forEach((row) => {
      const key =
        granularity === 'week'
          ? getBusinessWeekStart(row.period)
          : granularity === 'month'
            ? row.period.slice(0, 7) + '-01'
            : row.period;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    });
  if (granularity === 'day' && groups.size) {
    for (let d = start; d <= end; d = shiftDay(d, 1)) if (!groups.has(d)) groups.set(d, []);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => {
      if (!values.length) return { date, selectedDate: date, dates: [date], value: NaN, baseline: null };
      const expected =
        granularity === 'week'
          ? 7
          : granularity === 'month'
            ? new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate()
            : 1;
      const baseline = values.map((row) => byDate.get(shiftDay(row.period, -7)));
      return {
        partial: values.length < expected ? `${values.length}/${expected} 天` : undefined,
        date,
        selectedDate: values.at(-1)!.period,
        dates: values.map((row) => row.period),
        value: values.reduce((sum, row) => sum + row[metric], 0) / values.length,
        baseline: baseline.every((value) => value != null)
          ? baseline.reduce<number>((sum, value) => sum + value!, 0) / values.length
          : null,
      };
    });
}

// Lines use a local domain. Change bars have a separate zero baseline.
export function trendDomain(values: Array<number | null>): [number, number] {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!finite.length) return [0, 1];
  const low = Math.min(...finite),
    high = Math.max(...finite);
  const span = Math.max(high - low, Math.abs(high) * 0.05, 0.000001);
  const padding = span * 0.12;
  return [low >= 0 ? Math.max(0, low - padding) : low - padding, high + padding];
}

export function trendAxisLabel(value: number, _step: number, unit: 'count' | 'currency' | 'rate'): string {
  return unit === 'currency' ? moneyCompact(value) : unit === 'rate' ? rate(value) : countCompact(value);
}
