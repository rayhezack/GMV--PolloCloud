import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAnomalyDates } from './anomaly-dates.ts';

test('latest calendar anomaly follows the live detector instead of stale diagnosis state', () => {
  assert.deepEqual(mergeAnomalyDates(['2026-11-02', '2026-11-03'], '2026-11-03', [], 'web'), ['2026-11-02']);
  assert.deepEqual(
    mergeAnomalyDates(['2026-11-02'], '2026-11-03', [{ period: '2026-11-03', platform: 'web' }], 'web'),
    ['2026-11-02', '2026-11-03'],
  );
});

test('an overall anomaly cannot mark the Web or App calendar', () => {
  const alerts = [{ period: '2026-11-24', platform: 'all' }];
  assert.deepEqual(mergeAnomalyDates([], '2026-11-24', alerts, 'web'), []);
  assert.deepEqual(mergeAnomalyDates([], '2026-11-24', alerts, 'app'), []);
  assert.deepEqual(mergeAnomalyDates([], '2026-11-24', alerts, 'all'), ['2026-11-24']);
});

test('a client-only anomaly does not mark the overall series as anomalous', () => {
  const alerts = [{ period: '2026-11-24', platform: 'app' }];
  assert.deepEqual(mergeAnomalyDates([], '2026-11-24', alerts, 'all'), []);
  assert.deepEqual(mergeAnomalyDates([], '2026-11-24', alerts, 'web'), []);
  assert.deepEqual(mergeAnomalyDates([], '2026-11-24', alerts, 'app'), ['2026-11-24']);
});
