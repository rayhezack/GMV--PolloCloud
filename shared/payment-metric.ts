export type PaymentMetric = 'gmv' | 'orders';
export const paymentMetricLabel = (metric: PaymentMetric) => metric === 'orders' ? '订单量' : 'GMV';
export function paymentValue(row: { gmvUsd: number | null; orderCount?: number | null }, metric: PaymentMetric) {
  return metric === 'orders' ? row.orderCount ?? null : row.gmvUsd;
}
export function formatPaymentValue(value: number | null | undefined, metric: PaymentMetric) {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', metric === 'orders'
    ? { maximumFractionDigits: 2 }
    : { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}
export const signedPaymentValue = (value: number, metric: PaymentMetric) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatPaymentValue(Math.abs(value), metric)}`;
