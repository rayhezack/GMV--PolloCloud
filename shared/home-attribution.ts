import type { OverviewTrendPoint } from './api.interface';
import type { ChainComparison } from './chain-comparison';
export type HomeSource = { id: string; label: string; amount: number; kind: 'factor' | 'residual' | 'revenue' };
const labels: Record<string, string> = {
  subscription: '首订',
  first_subscription: '首订',
  first_sub: '首订',
  SUBSCRIPTION: '首订',
  renewal: '自动续订',
  auto_renewal: '自动续订',
  RENEWAL: '自动续订',
  credit_pack: '积分包',
  credits: '积分包',
  CREDIT_PACK: '积分包',
  upgrade: '套餐升级',
  UPGRADE: '套餐升级',
  reset: '重置订阅周期',
  resubscribe: '重新订阅',
  api: 'API',
};
/** Actual daily composition, using the same pay-type snapshot as the GMV KPI. */
export function paymentComposition(point?: OverviewTrendPoint) {
  if (!point || !Number.isFinite(point.totalGmv) || !point.totalPayTypeGmv) return null;
  const grouped = new Map<string, number>();
  for (const [key, amount] of Object.entries(point.totalPayTypeGmv)) {
    if (!Number.isFinite(amount)) return null;
    const label = labels[key] ?? key;
    grouped.set(label, (grouped.get(label) ?? 0) + amount);
  }
  const difference = point.totalGmv - [...grouped.values()].reduce((sum, amount) => sum + amount, 0);
  if (Math.abs(difference) > 0.005) grouped.set('未分类差额', (grouped.get('未分类差额') ?? 0) + difference);
  return {
    total: point.totalGmv,
    items: [...grouped]
      .filter(([, amount]) => amount !== 0)
      .map(([label, amount]) => ({ id: label, label, amount }))
      .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id)),
  };
}
export function paymentChanges(
  current?: OverviewTrendPoint,
  baseline?: OverviewTrendPoint,
  metric: 'totalGmv' | 'activeGmv' | 'renewalGmv' = 'totalGmv',
): HomeSource[] | null {
  if (!current || !baseline) return null;
  const key =
    metric === 'totalGmv' ? 'totalPayTypeGmv' : metric === 'activeGmv' ? 'activePayTypeGmv' : 'renewalPayTypeGmv';
  const a = current[key],
    b = baseline[key];
  if (!a || !b) return null;
  const rows = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort()
    .map((id) => ({ id, label: labels[id] ?? id, amount: (a[id] ?? 0) - (b[id] ?? 0), kind: 'revenue' as const }));
  const delta = current[metric] - baseline[metric],
    sum = rows.reduce((s, r) => s + r.amount, 0);
  // Keep any difference explicit; never distribute it among named categories.
  if (Math.abs(delta - sum) > 0.005)
    rows.push({ id: 'unclassified', label: '未分类差额', amount: delta - sum, kind: 'revenue' });
  return rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}
export function chainChanges(comparison: ChainComparison): HomeSource[] {
  if (!comparison.ready || !comparison.total) return [];
  const rows = comparison.factors
    .filter((f) => f.effect != null)
    .map((f) => ({ id: f.key, label: f.label, amount: f.effect!, kind: 'factor' as HomeSource['kind'] }));
  if (comparison.residual)
    rows.push({ id: 'residual', label: '未归因差额', amount: comparison.residual.effect, kind: 'residual' });
  return rows;
}
