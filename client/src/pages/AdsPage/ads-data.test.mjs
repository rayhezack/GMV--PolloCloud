import test from 'node:test';
import assert from 'node:assert/strict';
import { cohortRows, rankedCountries } from './ads-data.ts';
const row = (key, gmv, users, cost, value = 1) => ({
  key,
  label: key,
  values: [
    { horizon: 'D0', gmvUsd: gmv, registerUsers: users, costUsd: cost, value },
    { horizon: 'D14', gmvUsd: gmv * 2, registerUsers: users, costUsd: cost, value },
  ],
});
test('weekly cohort ratios divide summed atoms rather than averaging daily ratios', () => {
  const source = [row('2026-10-24', 20, 2, 10), row('2026-10-25', 90, 30, 90)];
  const ltv = cohortRows(source, 'week', 'ltv', '2026-11-04')[0];
  assert.equal(ltv.values[0].value, 110 / 32);
  assert.equal(ltv.values[1].value, null);
  assert.equal(cohortRows(source, 'week', 'roas', '2026-11-04')[0].values[0].value, 1.1);
  assert.equal(ltv.observedEnd, '2026-10-25');
});
test('mature cohort with missing recovery remains unavailable, not partial or zero', () => {
  const source = [row('2026-10-24', 20, 2, 10), row('2026-10-25', 90, 30, 90, null)];
  assert.equal(cohortRows(source, 'week', 'ltv', '2026-12-31')[0].values[0].value, null);
});
test('country top20 and others conserve additive values and put unknown last', () => {
  const input = Array.from({ length: 24 }, (_, i) => ({
    key: String(i),
    label: `国${i}`,
    baseline: { clicks: i, costUsd: i, impressions: i, registerUsers: i },
    current: { clicks: i * 3, costUsd: i * 4, impressions: i * 5, registerUsers: i },
  }));
  input.push({ key: 'unknown', label: '未知', baseline: { clicks: 1000 }, current: { clicks: 2000 } });
  const result = rankedCountries(input, 'clicks', 1, 1, 'change', '');
  assert.equal(result.length, 22);
  assert.equal(result.at(-1).key, 'unknown');
  assert.equal(result.at(-2).label, '其他 4 国');
  assert.equal(
    result.reduce((n, r) => n + r.current.clicks, 0),
    input.reduce((n, r) => n + r.current.clicks, 0),
  );
});

const { adsBuckets, dailyLtv } = await import('./ads-data.ts');
const daily = (period, cost, users, clicks, gmv) => ({
  period,
  costUsd: cost,
  registerUsers: users,
  clicks,
  impressions: clicks * 10,
  gmvD0: gmv,
  gmvD30: gmv * 2,
  gmvD7: null,
  ltvByHorizon: { D0: gmv / users, D30: (gmv * 2) / users },
});
test('trend CAC, CPC and LTV divide summed atoms, never average ratios', () => {
  const rows = [daily('2026-10-24', 20, 2, 4, 10), daily('2026-10-25', 90, 30, 30, 60)];
  assert.equal(adsBuckets(rows, 'cac', 'D0', '2026-12-01', '2026-10-24', '2026-10-25', 'week')[0].value, 110 / 32);
  assert.equal(adsBuckets(rows, 'cpc', 'D0', '2026-12-01', '2026-10-24', '2026-10-25', 'week')[0].value, 110 / 34);
  assert.equal(
    adsBuckets(rows, 'ltv', 'D0', '2026-12-01', '2026-10-24', '2026-10-25', 'week', 'D30')[0].value,
    140 / 32,
  );
});
test('LTV windows hide immature and explicitly missing values, and absent dates never throw', () => {
  const p = daily('2026-11-04', 20, 10, 30, 10);
  assert.equal(dailyLtv(p, 'D30', '2026-11-04'), null);
  assert.equal(dailyLtv({ ...p, ltvByHorizon: { D0: null } }, 'D0', '2026-11-04'), null);
  const buckets = adsBuckets([p], 'ltv', 'D0', '2026-11-04', '2026-11-03', '2026-11-04', 'day');
  assert.ok(Number.isNaN(buckets[0].value));
  assert.equal(buckets[1].baseline, null);
});
