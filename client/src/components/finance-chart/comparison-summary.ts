type Point = { time: number; value: number };

/** Compare only matching dates; a missing previous value is never a zero. */
export function comparisonSummary(actual: Point[], previous: Point[], index: number | null) {
  const byTime = new Map(previous.filter(p => Number.isFinite(p.value)).map(p => [p.time, p.value]));
  const paired = actual.filter(p => Number.isFinite(p.value) && byTime.has(p.time));
  const selected = index === null ? undefined : actual[index];
  const mean = (values: number[]) => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : undefined;
  const current = selected ? selected.value : mean((paired.length ? paired : actual).map(p => p.value));
  const baseline = selected ? byTime.get(selected.time) : mean(paired.map(p => byTime.get(p.time)!));
  const change = current !== undefined && baseline !== undefined && baseline !== 0
    ? (current - baseline) / Math.abs(baseline) * 100 : undefined;
  return { current, baseline, change, comparableCount: paired.length };
}
