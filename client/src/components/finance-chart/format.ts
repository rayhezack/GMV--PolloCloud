type Options = Intl.NumberFormatOptions & {
  locale?: string;
  currency?: string;
};
export function formatCompactCurrency(
  value: number,
  { locale = "en-US", currency = "USD", ...rest }: Options = {},
) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
    ...rest,
  }).format(value);
}
export function formatCurrency(
  value: number,
  { locale = "en-US", currency = "USD", ...rest }: Options = {},
) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    ...rest,
  }).format(value);
}
export function formatPercent(
  value: number,
  { locale = "en-US", ...rest }: Options = {},
) {
  return new Intl.NumberFormat(locale, rest).format(value) + "%";
}
export function formatTime(
  time: number,
  options: Intl.DateTimeFormatOptions,
  locale = "en-US",
) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    ...options,
  }).format(time);
}
