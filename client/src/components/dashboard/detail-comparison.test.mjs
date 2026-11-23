import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentDayComparison, toggleComparisonDay } from './detail-comparison.ts';
import { registrationBreakdown } from './payment-registration.ts';

const row = (period, weekStart, gmvUsd) => ({ period, weekStart, gmvUsd, payType: '自动续订', sku: 'Pro_月订_800' });
const data = {
  comparison: {
    analysisPeriod: '2026-10-31',
    baselinePeriod: '2026-10-24',
    analysisPeriodDays: 2,
    baselinePeriodDays: 2,
  },
  revenues: [
    row('2026-10-27', '2026-10-24', 100),
    row('2026-11-03', '2026-10-31', 150),
    row('2026-10-28', '2026-10-24', 900),
    row('2026-11-04', '2026-10-31', 5000),
  ],
  costs: [],
  registration: {
    verifiedPayTypes: ['自动续订'],
    rows: [row('2026-10-27', '2026-10-24', 100), row('2026-11-03', '2026-10-31', 150)],
  },
};
test('day selection toggles back to weekly, and selecting another day replaces the comparison', () => {
  assert.equal(toggleComparisonDay(null, '2026-11-03'), '2026-11-03');
  assert.equal(toggleComparisonDay('2026-11-03', '2026-11-03'), null);
  assert.equal(toggleComparisonDay('2026-11-03', '2026-11-04'), '2026-11-04');
});
test('selected-day slices use exact day amounts, preserve SKU identity and do not mutate the week', () => {
  const day = paymentDayComparison(data, '2026-11-03');
  assert.deepEqual(registrationBreakdown(day, '自动续订', 'sku'), [
    { key: 'Pro · 800 积分 · 月付', baseline: 100, analysis: 150 },
  ]);
  assert.equal(data.revenues.length, 4);
  assert.equal(data.comparison.analysisPeriodDays, 2);
  assert.equal(
    day.revenues.reduce((sum, r) => sum + r.gmvUsd, 0),
    250,
  );
});
test('missing comparison days stay unavailable, including a complete absence of the parent source', () => {
  assert.equal(paymentDayComparison(data, '2026-11-02'), null);
  assert.equal(paymentDayComparison({ ...data, revenues: [] }, '2026-11-03'), null);
});
