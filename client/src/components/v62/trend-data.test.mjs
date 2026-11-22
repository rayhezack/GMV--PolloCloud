import test from 'node:test';
import assert from 'node:assert/strict';
import { revenueBuckets, cashFlowSeries } from './trend-data.ts';
const row = (period, totalGmv) => ({ period, totalGmv });
test('daily comparison uses exactly seven days earlier, including zero revenue', () => {
  const result = revenueBuckets(
    [row('2026-10-01', 0), row('2026-10-08', 10), row('2026-10-09', 20)],
    'totalGmv',
    '2026-10-08',
    '2026-10-09',
    'day',
  );
  assert.equal(result[0].baseline, 0);
  assert.equal(result[1].baseline, null);
});
test('weekly aggregation uses business Saturdays and does not silently drop missing reference days', () => {
  const rows = [row('2026-10-02', 10), row('2026-10-09', 20), row('2026-10-10', 40)];
  const result = revenueBuckets(rows, 'totalGmv', '2026-10-09', '2026-10-10', 'week');
  assert.deepEqual(
    result.map((r) => r.date),
    ['2026-10-03', '2026-10-10'],
  );
  assert.equal(result[0].baseline, 10);
  assert.equal(result[1].baseline, null);
});

import { trendDomain, trendAxisLabel } from './trend-data.ts';
test('line domain reveals variation while containing both comparison series', () => {
  const values = [1500, 1800, 1720, 1660];
  const [low, high] = trendDomain(values);
  assert.ok(low > 1000 && low < Math.min(...values));
  assert.ok(high > Math.max(...values));
});
test('constant, missing and zero-only lines have finite, non-degenerate domains', () => {
  for (const values of [[1800, 1800], [0, 0], [null, NaN], []]) {
    const [low, high] = trendDomain(values);
    assert.ok(Number.isFinite(low) && Number.isFinite(high) && high > low);
  }
});
test('count ticks retain enough precision to avoid repeated 2k labels', () => {
  const ticks = [1000, 1250, 1500, 1750, 2000];
  const labels = ticks.map((value) => trendAxisLabel(value, 250, 'count'));
  assert.equal(new Set(labels).size, ticks.length);
  assert.equal(trendAxisLabel(1500, 250, 'count'), '1.5K');
});
test('rate ticks distinguish small changes in percentage points', () => {
  assert.notEqual(trendAxisLabel(0.452, 0.002, 'rate'), trendAxisLabel(0.454, 0.002, 'rate'));
});

test('Cash Flow comparisons retain exact date positions, missing references and real zero', () => {
  const result = cashFlowSeries(
    [null, 0, null, 120].map((baseline, index) => ({ date: `2026-10-${10 + index}`, value: 100 + index, baseline })),
  );
  assert.deepEqual(result.compare, [0, 120]);
  assert.deepEqual(result.compareIndices, [1, 3]);
  assert.deepEqual(
    result.data.map((point) => point.date),
    ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'],
  );
});

test('missing daily values make an explicit gap and never a zero', () => {
  const result = revenueBuckets(
    [row('2026-10-06', 10), row('2026-10-08', 20)],
    'totalGmv',
    '2026-10-06',
    '2026-10-08',
    'day',
  );
  assert.equal(result.length, 3);
  assert.equal(result[1].date, '2026-10-07');
  assert.ok(Number.isNaN(result[1].value));
  assert.equal(result[1].baseline, null);
});
test('incomplete weekly buckets declare actual coverage', () => {
  const result = revenueBuckets(
    [row('2026-10-10', 10), row('2026-10-11', 30)],
    'totalGmv',
    '2026-10-10',
    '2026-10-11',
    'week',
  );
  assert.equal(result[0].partial, '2/7 天');
  assert.equal(result[0].value, 20);
});
