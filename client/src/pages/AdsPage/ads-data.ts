import { revenueBuckets, shiftDay, type TrendBucket } from '../../components/v62/trend-data.ts';
import { getBusinessWeekStart } from '../../../../shared/business-week.ts';
import type { AdsCohortMatrixRow, AdsChannelRow, AdsAggregate, AdsTrendPoint } from '@shared/api.interface';
export type Horizon = 'D0' | 'D7' | 'D30';
export type LtvHorizon = 'D0' | 'D14' | 'D30' | 'D60' | 'D90' | 'D180';
export const ltvHorizons: LtvHorizon[] = ['D0', 'D14', 'D30', 'D60', 'D90', 'D180'];
export const dailyLtv = (p: AdsTrendPoint, horizon: LtvHorizon, asOf: string) =>
  !mature(p.period, horizon, asOf)
    ? null
    : p.ltvByHorizon
      ? (p.ltvByHorizon[horizon] ?? null)
      : horizon === 'D0' && p.registerUsers > 0
        ? p.gmvD0 / p.registerUsers
        : null;
export const mature = (period: string, horizon: string, asOf: string) =>
  (Date.parse(asOf) - Date.parse(period)) / 86400000 >= Number(horizon.slice(1));
export function dailyRoas(row: AdsTrendPoint, horizon: Horizon, asOf: string) {
  const key = horizon === 'D0' ? 'gmvD0' : horizon === 'D7' ? 'gmvD7' : 'gmvD30';
  return mature(row.period, horizon, asOf) &&
    row.roasByHorizon?.[horizon] != null &&
    row[key] != null &&
    row.costUsd > 0
    ? row[key]! / row.costUsd
    : null;
}
export type CohortRow = AdsCohortMatrixRow & { observedEnd: string; days: number };
/** Recompute ratios from sums of the same cohorts; never average daily ratios. */
export function cohortRows(
  rows: AdsCohortMatrixRow[],
  granularity: 'day' | 'week',
  metric: 'ltv' | 'roas',
  asOf: string,
): CohortRow[] {
  const groups = new Map<string, AdsCohortMatrixRow[]>();
  rows.forEach((row) => {
    const key = granularity === 'week' ? getBusinessWeekStart(row.key) : row.key;
    groups.set(key, [...(groups.get(key) || []), row]);
  });
  return [...groups]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, entries]) => {
      const observedEnd = entries
        .map((row) => row.key)
        .sort()
        .at(-1)!;
      const values = entries[0].values.map((cell) => {
        const cells = entries.map((row) => row.values.find((c) => c.horizon === cell.horizon));
        const complete = cells.every((c, i) => c?.value != null && mature(entries[i].key, cell.horizon, asOf));
        const atoms = cells.reduce(
          (sum, c) => ({
            gmvUsd: sum.gmvUsd + (c?.gmvUsd || 0),
            costUsd: sum.costUsd + (c?.costUsd || 0),
            registerUsers: sum.registerUsers + (c?.registerUsers || 0),
          }),
          { gmvUsd: 0, costUsd: 0, registerUsers: 0 },
        );
        const denominator = metric === 'ltv' ? atoms.registerUsers : atoms.costUsd;
        return { ...cell, ...atoms, value: complete && denominator > 0 ? atoms.gmvUsd / denominator : null };
      });
      return {
        key,
        label:
          granularity === 'week'
            ? `${key.slice(5).replace('-', '/')} – ${observedEnd.slice(5).replace('-', '/')}`
            : key,
        values,
        observedEnd,
        days: entries.length,
      };
    });
}
export function rankedCountries(
  rows: AdsChannelRow[],
  metric: keyof AdsAggregate,
  days: number,
  baseDays: number,
  sort: 'change' | 'scale',
  search: string,
) {
  const unknown = (r: AdsChannelRow) =>
    ['unknown', 'UNKNOWN', '未知', '未记录', '__UNKNOWN__', ''].includes(r.key) || ['未知', '未记录'].includes(r.label);
  const filtered = rows.filter((r) => `${r.key} ${r.label}`.toLowerCase().includes(search.toLowerCase()));
  const value = (r: AdsChannelRow) => Number(r.current[metric]) / days;
  const delta = (r: AdsChannelRow) => value(r) - Number(r.baseline[metric]) / baseDays;
  const known = filtered
    .filter((r) => !unknown(r))
    .sort(
      (a, b) =>
        (sort === 'scale' ? value(b) - value(a) : Math.abs(delta(b)) - Math.abs(delta(a))) ||
        a.key.localeCompare(b.key),
    );
  const rest = known.slice(20);
  const aggregate = (side: 'baseline' | 'current') =>
    Object.fromEntries(
      ['clicks', 'costUsd', 'impressions', 'registerUsers'].map((k) => [
        k,
        rest.reduce((n, r) => n + Number(r[side][k as keyof AdsAggregate]), 0),
      ]),
    ) as unknown as AdsAggregate;
  return [
    ...known.slice(0, 20),
    ...(rest.length
      ? [
          {
            key: '__others__',
            label: `其他 ${rest.length} 国`,
            baseline: aggregate('baseline'),
            current: aggregate('current'),
          },
        ]
      : []),
    ...filtered.filter(unknown),
  ];
}

export type AdsMetric = 'clicks' | 'cpc' | 'costUsd' | 'cac' | 'ltv' | 'registerUsers' | 'impressions' | 'ctr' | 'roas';
export function adsValue(
  rows: AdsTrendPoint[],
  metric: AdsMetric,
  horizon: Horizon,
  asOf: string,
  ltvHorizon: LtvHorizon = 'D0',
): number | null {
  if (!rows.length || rows.some((p) => !p)) return null;
  const sum = (key: 'costUsd' | 'clicks' | 'impressions' | 'registerUsers' | 'gmvD0') =>
    rows.reduce((n, p) => n + p[key], 0);
  if (metric === 'cpc') return sum('clicks') > 0 ? sum('costUsd') / sum('clicks') : null;
  if (metric === 'cac') return sum('registerUsers') > 0 ? sum('costUsd') / sum('registerUsers') : null;
  if (metric === 'ltv')
    return rows.every((p) => dailyLtv(p, ltvHorizon, asOf) != null) && sum('registerUsers') > 0
      ? rows.reduce((n, p) => n + dailyLtv(p, ltvHorizon, asOf)! * p.registerUsers, 0) / sum('registerUsers')
      : null;
  if (metric === 'ctr') return sum('impressions') > 0 ? sum('clicks') / sum('impressions') : null;
  if (metric === 'roas') {
    if (!rows.every((p) => dailyRoas(p, horizon, asOf) != null)) return null;
    const amount = rows.reduce((n, p) => n + (horizon === 'D0' ? p.gmvD0 : horizon === 'D7' ? p.gmvD7! : p.gmvD30), 0);
    return sum('costUsd') > 0 ? amount / sum('costUsd') : null;
  }
  return sum(metric) / rows.length;
}
export function adsBuckets(
  rows: AdsTrendPoint[],
  metric: AdsMetric,
  horizon: Horizon,
  asOf: string,
  start: string,
  end: string,
  grain: 'day' | 'week' | 'month',
  ltvHorizon: LtvHorizon = 'D0',
): TrendBucket[] {
  const map = new Map(rows.map((p) => [p.period, p]));
  return revenueBuckets(
    rows.map((p) => ({ period: p.period, totalGmv: 0, activeGmv: 0, renewalGmv: 0 })),
    'totalGmv',
    start,
    end,
    grain,
  ).map((bucket) => {
    const current = bucket.dates.map((d) => map.get(d)!);
    const base = bucket.dates.map((d) => map.get(shiftDay(d, -7)));
    return {
      ...bucket,
      value: adsValue(current, metric, horizon, asOf, ltvHorizon) ?? NaN,
      baseline: base.every(Boolean) ? adsValue(base as AdsTrendPoint[], metric, horizon, asOf, ltvHorizon) : null,
    };
  });
}
