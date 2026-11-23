export type ChainComparisonParams = {
  platform: 'all' | 'web' | 'app';
  deviceType?: 'ios' | 'android';
  mode: 'day' | 'week';
  baseline: string;
  analysis: string;
  chainType: 'active' | 'renewal';
  populationDimension?: 'creation' | 'country';
  lifecycle?: string;
  creationTier?: string;
  countryTier?: string;
  planTier?: string;
};
export type ChainFactor = {
  key: string;
  label: string;
  unit: 'count' | 'rate' | 'currency';
  baseline: number | null;
  current: number | null;
  effect: number | null;
  contribution: number | null;
};
export type ChainGroup = { key: string; label: string; baseline: number; current: number; factors: ChainFactor[] };
export type ChainComparison = {
  ready: boolean;
  reason?: string;
  source: string;
  comparison: ChainComparisonParams;
  dates: { baseline: string[]; analysis: string[] };
  total: { baseline: number; current: number; delta: number } | null;
  residual: { baseline: number; current: number; effect: number; contribution: number | null } | null;
  factors: ChainFactor[];
  groups: ChainGroup[];
  /** Registration lifecycle totals, recomputed from atoms before decomposition. */
  lifecycleGroups?: ChainGroup[];
  /** Country groups keyed by country tier × registration lifecycle. */
  countryGroups?: ChainGroup[];
  trend: { date: string; values: Record<string, number | null> }[];
};

export const CREATION_TIER_ORDER = [
  'create_cnt_30d_0',
  'create_cnt_30d_[1,11)',
  'create_cnt_30d_[11,31)',
  'create_cnt_30d_[31,101)',
  'create_cnt_30d_[101,+inf)',
] as const;
export const LIFECYCLE_ORDER = ['NEW', 'OLD', 'UNKNOWN'] as const;
export const RENEWAL_TIER_ORDER = ['LITE', 'PRO', 'ULTRA'] as const;
export const RESIDUAL_WARN_RATIO = 0.5;
const rank = (key: string, order: readonly string[]) => {
  const i = order.indexOf(key);
  return i < 0 ? order.length : i;
};
export function compareChainGroupKeys(a: string, b: string, type: 'active' | 'renewal') {
  if (type === 'renewal') return rank(a, RENEWAL_TIER_ORDER) - rank(b, RENEWAL_TIER_ORDER) || a.localeCompare(b);
  const [at, al] = a.split(' × '),
    [bt, bl] = b.split(' × ');
  return (
    rank(at, CREATION_TIER_ORDER) - rank(bt, CREATION_TIER_ORDER) ||
    at.localeCompare(bt) ||
    rank(al, LIFECYCLE_ORDER) - rank(bl, LIFECYCLE_ORDER) ||
    al.localeCompare(bl)
  );
}
export function preferredFactor(factors: ChainFactor[], requested: string | null) {
  return (
    factors.find((f) => f.key === requested) ??
    factors.reduce<ChainFactor | undefined>(
      (best, f) =>
        f.effect != null && (best?.effect == null || Math.abs(f.effect) > Math.abs(best.effect)) ? f : best,
      undefined,
    )
  );
}
export function contributionScales(data: Pick<ChainComparison, 'factors' | 'groups' | 'residual'>, factor: string) {
  const maximum = (values: (number | null | undefined)[]) =>
    Math.max(Number.EPSILON, ...values.map((v) => Math.abs(v ?? 0)));
  return {
    root: maximum([...data.factors.map((f) => f.contribution), data.residual?.contribution]),
    child: maximum(data.groups.map((g) => g.factors.find((f) => f.key === factor)?.contribution)),
  };
}
export function residualWarning(data: Pick<ChainComparison, 'factors' | 'residual'>) {
  if (data.residual == null || data.factors.some((f) => f.effect == null)) return false;
  const sum = data.factors.reduce((n, f) => n + Math.abs(f.effect!), 0);
  return Math.abs(data.residual.effect) > 0 && Math.abs(data.residual.effect) >= RESIDUAL_WARN_RATIO * sum;
}
