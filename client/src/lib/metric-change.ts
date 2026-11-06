/** Relative growth is undefined for an empty baseline, including 0 → 0. */
export const relativeChange = (current: number, baseline: number): number | null =>
  baseline === 0 ? null : (current - baseline) / Math.abs(baseline);

/** Signed share of the selected parent's net change; opposing rows offset it. */
export function changeContributions(rows: readonly { analysis: number; baseline: number }[]): (number | null)[] {
  const net = rows.reduce((sum, row) => sum + row.analysis - row.baseline, 0);
  const magnitude = rows.reduce((sum, row) => sum + Math.abs(row.analysis - row.baseline), 0);
  return rows.map(row => Math.abs(net) <= Math.max(1, magnitude) * 1e-12 ? null : (row.analysis - row.baseline) / net);
}
