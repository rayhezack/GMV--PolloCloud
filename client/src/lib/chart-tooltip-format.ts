export type ChartValueUnit = "currency" | "count" | "ratio";

export function formatChartTooltipValue(value: number, unit: ChartValueUnit) {
  if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
  return new Intl.NumberFormat("en-US", {
    ...(unit === "currency" ? { style: "currency", currency: "USD" } : {}),
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatChartTooltipChange(value: number, unit: ChartValueUnit) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const amount = unit === "ratio"
    ? `${(Math.abs(value) * 100).toFixed(1)} 个百分点`
    : formatChartTooltipValue(Math.abs(value), unit);
  return sign + amount;
}
