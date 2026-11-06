/** Positive means a lift, negative means a drag, even when net change is negative. */
export function directionShare(effect: number, net: number): number | null {
  return Math.abs(net) > 1e-10 ? effect / Math.abs(net) : null;
}

/** Share of the net change: positive for a driver, negative for an offset. */
export function netChangeShare(effect: number, net: number): number | null {
  return Math.abs(net) > 1e-10 ? effect / net : null;
}

export type RateAtoms = { numerator: number; denominator: number };
export type RateSegment = { key: string; label: string; baseline: RateAtoms; current: RateAtoms };
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, Math.max(Math.abs(a), Math.abs(b)) * 1e-9);
const total = (rows: RateSegment[], side: 'baseline' | 'current', key: keyof RateAtoms) => rows.reduce((n, r) => n + r[side][key], 0);

/** Exact centered midpoint identity: ΔR = Σ Δweight × (mean(rate) − mean(parent rate)) + Σ Δrate × mean(weight). */
export function decomposeRate(rows: RateSegment[], parent: { baseline: RateAtoms; current: RateAtoms }) {
  const rate = (a: RateAtoms) => a.denominator > 0 ? a.numerator / a.denominator : null;
  const baselineRate = rate(parent.baseline), currentRate = rate(parent.current);
  const delta = baselineRate != null && currentRate != null ? currentRate - baselineRate : null;
  const invalidAtoms = (a: RateAtoms) => !Number.isFinite(a.numerator) || !Number.isFinite(a.denominator) || a.numerator < 0 || a.denominator < 0 || a.numerator > a.denominator;
  let reason = '';
  if (!rows.length) reason = '暂无分组数据。';
  else if ([parent, ...rows].some(r => invalidAtoms(r.baseline) || invalidAtoms(r.current))) reason = '分子分母不满足有效漏斗关系，不计算比率分解。';
  else if (baselineRate == null || currentRate == null) reason = '基准期或分析期分母为 0，比率不可比，不计算结构与效率。';
  else if (rows.some(row => row.baseline.denominator === 0 || row.current.denominator === 0)) reason = '存在新增、退出或空分组，一期组内比率未定义；不支持结构与效率分解。';
  else if (['baseline', 'current'].some(side => ['numerator', 'denominator'].some(key => !near(total(rows, side as 'baseline' | 'current', key as keyof RateAtoms), parent[side as 'baseline' | 'current'][key as keyof RateAtoms])))) reason = '分组人数与父层不守恒，可能存在交叉或覆盖缺口；仅展示原子人数。';
  const centerRate = baselineRate != null && currentRate != null ? (baselineRate + currentRate) / 2 : 0;
  const groups = rows.map(row => {
    const rate0 = rate(row.baseline), rate1 = rate(row.current);
    const w0 = parent.baseline.denominator > 0 ? row.baseline.denominator / parent.baseline.denominator : 0;
    const w1 = parent.current.denominator > 0 ? row.current.denominator / parent.current.denominator : 0;
    return { ...row, rate0, rate1, w0, w1, structure: rate0 != null && rate1 != null ? (w1 - w0) * ((rate1 + rate0) / 2 - centerRate) : 0, efficiency: rate0 != null && rate1 != null ? (rate1 - rate0) * (w1 + w0) / 2 : 0, absent: rate0 == null || rate1 == null };
  });
  // No partial effects escape when a group rate is undefined or the partition fails.
  if (reason) return { valid: false, reason, baselineRate, currentRate, delta, structure: 0, efficiency: 0, groups: [], simpson: false };
  const structure = groups.reduce((s, g) => s + g.structure, 0), efficiency = groups.reduce((s, g) => s + g.efficiency, 0);
  if (!reason && delta != null && !near(structure + efficiency, delta)) reason = '分解未通过守恒校验，暂不展示贡献。';
  // A strict reversal requires comparable, nonempty strata, all moving against
  // the aggregate. A decomposition or a single opposing stratum is insufficient.
  const simpson = !reason && delta != null && Math.abs(delta) > 1e-10 && groups.length > 1 && groups.every(g => !g.absent && (g.rate1! - g.rate0!) * Math.sign(delta) < -1e-10);
  return { valid: !reason, reason, baselineRate, currentRate, delta, structure, efficiency, groups, simpson };
}

export function summarizeChanges(rows: { label: string; change: number }[]) {
  const net = rows.reduce((s, r) => s + r.change, 0);
  const drags = rows.filter(r => r.change < -1e-10).sort((a, b) => a.change - b.change);
  const lifts = rows.filter(r => r.change > 1e-10).sort((a, b) => b.change - a.change);
  const leading = net < 0 ? drags : lifts;
  const top = leading.slice(0, 2);
  return { net, drags, lifts, top, topEffect: top.reduce((s, r) => s + r.change, 0), topShare: directionShare(top.reduce((s, r) => s + r.change, 0), net) };
}

/** Keep channel cohorts comparable without inventing a rate for an absent channel.
 * Sparse channels are pooled with the explicit unrecorded channel, preserving
 * every numerator and denominator in both periods. */
export function comparableChannels(rows: RateSegment[]) {
  const sparse = rows.filter(row => !row.baseline.denominator || !row.current.denominator);
  if (!sparse.length) return { rows, pooled: [] as string[] };
  const pooled = rows.filter(row => sparse.includes(row) || /^(未知|unknown|未记录)$/i.test(row.key));
  const stable = rows.filter(row => !pooled.includes(row));
  const sum = (side: 'baseline' | 'current'): RateAtoms => ({ numerator: total(pooled, side, 'numerator'), denominator: total(pooled, side, 'denominator') });
  const labels = pooled.map(row => row.label);
  return { rows: [...stable, { key: '__other_channels__', label: `其他（${labels.join('、')}）`, baseline: sum('baseline'), current: sum('current') }], pooled: labels };
}

/** Count attribution is valid only for an exhaustive, exclusive partition. */
export function decomposeCount(rows: { key: string; label: string; baseline: number; current: number }[], parent: { baseline: number; current: number }) {
  const valid = rows.length > 0 && rows.every(row => [row.baseline, row.current].every(n => Number.isFinite(n) && n >= 0))
    && near(rows.reduce((n, row) => n + row.baseline, 0), parent.baseline)
    && near(rows.reduce((n, row) => n + row.current, 0), parent.current);
  const delta = parent.current - parent.baseline;
  return { valid, delta, groups: rows.map(row => ({ ...row, change: row.current - row.baseline, contribution: valid ? directionShare(row.current - row.baseline, delta) : null })) };
}
