import { countCompact, moneyCompact, rate, shortDay } from '../../../../shared/format.ts';
export type ChartUnit = 'count' | 'currency' | 'rate';
export function chartTicks(values: Array<number | null | undefined>): number[] {
  const data = values.filter((n): n is number => n != null && Number.isFinite(n));
  if (!data.length) return [0, 0.25, 0.5, 0.75, 1];
  const low = Math.min(...data),
    high = Math.max(...data),
    span = Math.max(high - low, Math.abs(high) * 0.05, 0.000001);
  const min = low - span * 0.12,
    max = high + span * 0.12,
    raw = (max - min) / 4,
    mag = 10 ** Math.floor(Math.log10(raw));
  const candidates = [0.1, 1, 10]
    .flatMap((order) => [1, 2, 2.5, 5, 10].map((n) => n * mag * order))
    .map((step) => {
      const lo = Math.floor(min / step) * step,
        hi = Math.ceil(max / step) * step;
      return { step, lo, hi, n: Math.round((hi - lo) / step) + 1 };
    })
    .filter((c) => c.n >= 4 && c.n <= 5)
    .sort((a, b) => a.hi - a.lo - (b.hi - b.lo) || b.n - a.n);
  const best = candidates[0] ?? { step: (max - min) / 4, lo: min, n: 5 };
  return Array.from({ length: best.n }, (_, i) => Number((best.lo + i * best.step).toPrecision(12)));
}
export const axisValue = (n: number, unit: ChartUnit) =>
  unit === 'currency' ? moneyCompact(n) : unit === 'rate' ? rate(n) : countCompact(n);
export const axisDate = (date: string) => shortDay(date);
export function businessTickIndices(dates: string[], daily = true): number[] {
  return dates.flatMap((d, i) =>
    i === 0 || i === dates.length - 1 || (daily ? new Date(d + 'T00:00:00Z').getUTCDay() === 6 : true) ? [i] : [],
  );
}
export function weekendIndices(dates: string[]): number[] {
  return dates.flatMap((d, i) => ([0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()) ? [i] : []));
}
export function lineSegments(
  values: Array<number | null>,
  x: (i: number) => number,
  y: (v: number) => number,
): string[] {
  const segments: string[] = [];
  let points: string[] = [];
  const flush = () => {
    if (points.length) segments.push(points.join(' '));
    points = [];
  };
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      flush();
      return;
    }
    points.push(`${points.length ? 'L' : 'M'} ${x(i)} ${y(v)}`);
  });
  flush();
  return segments;
}
export function nextChartIndex(key: string, current: number, length: number): number | null {
  if (!length) return null;
  return key === 'Home'
    ? 0
    : key === 'End'
      ? length - 1
      : key === 'ArrowRight'
        ? Math.min(length - 1, current + 1)
        : key === 'ArrowLeft'
          ? Math.max(0, current - 1)
          : null;
}

/** Relative change stays undefined for absent or zero baselines, rather than reporting infinity. */
export function relativeDifference(current: number, baseline: number | undefined): string {
  if (!Number.isFinite(current) || baseline == null || !Number.isFinite(baseline) || baseline === 0) return '—';
  const change = (current - baseline) / Math.abs(baseline);
  return `${change > 0 ? '+' : change < 0 ? '−' : ''}${(Math.abs(change) * 100).toFixed(1)}%`;
}
