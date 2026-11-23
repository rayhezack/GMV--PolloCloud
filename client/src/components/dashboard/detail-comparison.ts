import type { PaymentAnalysisResponse } from '../../../../shared/api.interface';
import { shiftDay } from '../../components/v62/trend-data.ts';

export const toggleComparisonDay = (current: string | null, date: string) => (current === date ? null : date);

/** Exact observed dates, never a whole week's average or a synthetic zero for an absent day. */
export function paymentDayComparison(data: PaymentAnalysisResponse, analysis: string): PaymentAnalysisResponse | null {
  const baseline = shiftDay(analysis, -7);
  if (![baseline, analysis].every((date) => data.revenues.some((row) => row.period === date))) return null;
  const selected = (period: string) => period === analysis || period === baseline;
  return {
    ...data,
    comparison: {
      baselinePeriod: baseline,
      analysisPeriod: analysis,
      baselinePeriodDays: 1,
      analysisPeriodDays: 1,
      periodDays: 1,
    },
    revenues: data.revenues.filter((row) => selected(row.period)).map((row) => ({ ...row, weekStart: row.period })),
    costs: data.costs.filter((row) => selected(row.period)).map((row) => ({ ...row, weekStart: row.period })),
    registration: data.registration && {
      ...data.registration,
      rows: data.registration.rows
        .filter((row) => selected(row.period))
        .map((row) => ({ ...row, weekStart: row.period })),
    },
  };
}
