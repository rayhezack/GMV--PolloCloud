import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAnomalyDates } from './anomaly-dates.ts';

test('latest calendar anomaly follows the live detector instead of stale diagnosis state', () => {
  assert.deepEqual(
    mergeAnomalyDates(['2026-11-02', '2026-11-03'], '2026-11-03', []),
    ['2026-11-02'],
  );
  assert.deepEqual(
    mergeAnomalyDates(['2026-11-02'], '2026-11-03', [{ period: '2026-11-03' }]),
    ['2026-11-02', '2026-11-03'],
  );
});
