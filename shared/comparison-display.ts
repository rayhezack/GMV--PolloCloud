const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function availableWeek(week: string, availableEnd?: string) {
  const fullEnd = shift(week, 6);
  const end = availableEnd && availableEnd < fullEnd ? availableEnd : fullEnd;
  const days = Math.max(0, Math.min(7, Math.round((Date.parse(end) - Date.parse(week)) / 86400000) + 1));
  return { end, days, partial: days < 7, label: `${week.slice(5).replace('-', '/')} – ${end.slice(5).replace('-', '/')}` };
}
export function calendarWeeks(start: string, end: string, latest: string = end) {
  const through = [end, latest].sort()[0];
  if (!start || !through || start > through) return { columns: [], truncated: false };
  const weekOf = (date: string) => shift(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 1) % 7));
  const last = weekOf(through), first = weekOf(start), cutoff = shift(last, -25 * 7);
  const visibleStart = [first, cutoff].sort().at(-1)!;
  const columns: { week: string; month: string | null; dates: (string | null)[] }[] = [];
  for (let week = visibleStart; week <= last; week = shift(week, 7)) {
    const dates = Array.from({ length: 7 }, (_, i) => shift(week, i));
    const firstOfMonth = dates.find(d => d.endsWith('-01') && d >= start && d <= through);
    columns.push({ week, month: firstOfMonth ? `${Number(firstOfMonth.slice(5, 7))} 月` : null, dates: dates.map(d => d >= start && d <= through ? d : null) });
  }
  return { columns, truncated: first < visibleStart };
}
export function paymentWeekBands(periods: string[], baseline: string, analysis: string, latest?: string) {
  return [{ kind: 'baseline', label: '基准', start: baseline }, { kind: 'analysis', label: '分析', start: analysis }].flatMap(band => {
    const end = availableWeek(band.start, latest).end;
    const inside = periods.filter(p => p >= band.start && p <= end);
    return inside.length ? [{ ...band, from: inside[0], to: inside.at(-1)! }] : [];
  });
}
export function paymentTrendUnit(granularity: string, window: string, year: string) {
  return granularity === 'year' ? `${year} 年 · 月日均 GMV` : `日均值 · ${window}`;
}
