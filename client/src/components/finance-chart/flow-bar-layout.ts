/** Size bars by calendar slots, including dates with no comparison or a zero delta. */
export function flowBarLayout(times: number[], width: number, maximum = 32) {
  const ordered = [...new Set(times)].sort((a,b) => a-b);
  const start = ordered[0] ?? 0;
  const end = ordered.at(-1) ?? start;
  const gaps = ordered.slice(1).map((time, index) => time-ordered[index]);
  const step = gaps.length ? Math.min(...gaps) : 1;
  const slots = end > start ? (end-start)/step + 1 : 1;
  const slotWidth = width/slots;
  return { inset:slotWidth/2, width:Math.min(maximum,slotWidth*.62) };
}

/** Measure height from zero before applying the baseline's visual inset.
 * Tiny nonzero deltas need 3px to remain visible beside the GMV-scale lines;
 * their real values stay untouched for tooltips and exports. Zero stays flat.
 */
export function flowBarTop(value: number, y: (value: number) => number, bottom: number) {
  if (value === 0) return bottom;
  const height = Math.max(3, Math.abs(y(Math.abs(value)) - y(0)));
  return bottom - Math.min(bottom, height);
}

/** Keep both observed endpoints visible and reserve space between date labels. */
export function endpointLabels<T extends { key: string; time: number; x: number; unit: string }>(
  candidates: T[], first: T, last: T, spacing = 76,
): (T & { align: 'start' | 'center' | 'end' })[] {
  if (first.time === last.time) return [{ ...first, align: 'center' }];
  const labels: (T & { align: 'start' | 'center' | 'end' })[] = [{ ...first, align: 'start' }];
  for (const label of candidates) {
    if (label.time <= first.time || label.time >= last.time) continue;
    if (label.x - labels.at(-1)!.x >= spacing && last.x - label.x >= spacing)
      labels.push({ ...label, align: 'center' });
  }
  return [...labels, { ...last, align: 'end' }];
}

/** Label actual daily dates or bucket starts, using only the selected grain. */
export function bucketLabels(times: number[], x: (time: number) => number, period: string) {
  const unit = period === 'month' || period === 'monthly' ? 'month' : period === 'week' || period === 'weekly' ? 'week' : 'day';
  const candidates = times.map(time => ({key:String(time),time,x:x(time),unit}));
  return candidates.length ? endpointLabels(candidates,candidates[0],candidates[candidates.length-1],90) : [];
}
