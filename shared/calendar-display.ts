export const CALENDAR_CHANGE_THRESHOLDS = [0.05, 0.1, 0.2] as const;
export function calendarColor(
  value: number,
  range: [number, number],
  change: number | null,
  mode: 'amount' | 'change',
) {
  if (mode === 'amount') {
    const [lo, hi] = range;
    const level = hi === lo ? 3 : Math.max(1, Math.min(5, 1 + Math.floor(((value - lo) / (hi - lo)) * 5)));
    return `var(--seq-${level})`;
  }
  if (change == null || !Number.isFinite(change) || Math.abs(change) < CALENDAR_CHANGE_THRESHOLDS[0])
    return 'var(--div-0)';
  const level =
    Math.abs(change) < CALENDAR_CHANGE_THRESHOLDS[1] ? 1 : Math.abs(change) < CALENDAR_CHANGE_THRESHOLDS[2] ? 2 : 3;
  return `var(--div-${change < 0 ? 'neg' : 'pos'}-${level})`;
}

/** Calendar rows run Monday–Sunday; missing and out-of-range dates never become buttons. */
export function calendarDates(start: string, end: string, latest = end) {
  const shift = (date: string, days: number) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const through = [end, latest].sort()[0];
  if (!start || !through || start > through) return { dates: [] as (string | null)[], rows: 0, truncated: false };
  const monday = (date: string) => shift(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
  const first = monday(start),
    visible = first;
  const dates: (string | null)[] = [];
  for (let date = visible; date <= through; date = shift(date, 1))
    dates.push(date >= start && date <= through ? date : null);
  return { dates, rows: Math.ceil(dates.length / 7), truncated: first < visible };
}

/** The peak is selected only from visible observations; ties prefer the latest day. */
export function calendarPeak(values: ReadonlyMap<string, number | null | undefined>, dates: readonly string[]) {
  let peak: { date: string; value: number } | null = null;
  for (const date of dates) {
    const value = values.get(date);
    if (value == null || !Number.isFinite(value)) continue;
    if (!peak || value > peak.value || (value === peak.value && date > peak.date)) peak = { date, value };
  }
  return peak;
}
