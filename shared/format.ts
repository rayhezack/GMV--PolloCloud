/** Display only. Never use rounded display values in attribution calculations. */
type Numeric = number | null | undefined;
const valid = (v: Numeric): v is number => v != null && Number.isFinite(v);
const number = (v: number, digits = 0) =>
  v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
export const count = (v: Numeric) => (valid(v) ? number(Math.round(v)) : '—');
export const money = (v: Numeric) => (valid(v) ? `${v < 0 ? '−' : ''}$${number(Math.round(Math.abs(v)))}` : '—');
export function countCompact(v: Numeric): string {
  if (!valid(v)) return '—';
  const n = Math.abs(v),
    unit = n >= 1e6 ? 'M' : n >= 1e3 ? 'K' : '';
  return unit ? `${v < 0 ? '−' : ''}${+(n / (unit === 'M' ? 1e6 : 1e3)).toFixed(2)}${unit}` : count(v);
}
export const moneyCompact = (v: Numeric) => (valid(v) ? `${v < 0 ? '−' : ''}$${countCompact(Math.abs(v))}` : '—');
export const rate = (v: Numeric) => (valid(v) ? `${number(v * 100, 2)}%` : '—');
export const changePct = (v: Numeric) =>
  valid(v) ? `${v > 0 ? '↗ ' : v < 0 ? '↘ ' : ''}${number(Math.abs(v) * 100, 1)}%` : '—';
export const changePp = (v: Numeric) =>
  valid(v) ? `${v > 0 ? '↗ ' : v < 0 ? '↘ ' : ''}${number(Math.abs(v) * 100, 2)} pp` : '—';
export const signedMoney = (v: Numeric) => (valid(v) ? `${sign(v)}$${number(Math.round(Math.abs(v)))}` : '—');
export const share = (v: Numeric, digits = 1) => (valid(v) ? `${sign(v)}${number(Math.abs(v) * 100, digits)}%` : '—');
/** Plain signed values for analysis detail columns; rate differences remain percentage points. */
export const signedPp = (v: Numeric, digits = 2) =>
  valid(v) ? `${sign(v)}${number(Math.abs(v) * 100, digits)} pp` : '—';
export function metricDifference(before: Numeric, after: Numeric, unit: 'currency' | 'count' | 'rate'): string {
  if (!valid(before) || !valid(after)) return '—';
  const difference = after - before;
  return unit === 'rate'
    ? signedPp(difference)
    : unit === 'currency'
      ? signedMoney(difference)
      : `${sign(difference)}${number(Math.abs(difference))}`;
}
const validDay = (d: string | null | undefined): d is string =>
  Boolean(
    d &&
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    Number.isFinite(Date.parse(d)) &&
    new Date(d).toISOString().slice(0, 10) === d,
  );
export const shortDay = (d: string | null | undefined) => (validDay(d) ? d.slice(5).replace('-', '/') : '—');
export const day = (d: string | null | undefined) =>
  validDay(d) ? `${shortDay(d)} 周${'日一二三四五六'[new Date(d + 'T00:00:00Z').getUTCDay()]}` : '—';
export const range = (a: string | null | undefined, b: string | null | undefined) =>
  validDay(a) && validDay(b)
    ? a.slice(0, 4) === b.slice(0, 4)
      ? `${shortDay(a)}–${shortDay(b)}`
      : `${a.replace(/-/g, '/')}–${b.replace(/-/g, '/')}`
    : '—';
/** Unit dispatch; display rounding never feeds calculations. */
export const metricValue = (v: Numeric, unit: 'currency' | 'count' | 'rate') =>
  unit === 'currency' ? money(v) : unit === 'rate' ? rate(v) : count(v);
export const metricChange = (before: Numeric, after: Numeric, unit: 'currency' | 'count' | 'rate') =>
  !valid(before) || !valid(after)
    ? '—'
    : unit === 'rate'
      ? changePp(after - before)
      : before === 0
        ? '—'
        : changePct((after - before) / before);
