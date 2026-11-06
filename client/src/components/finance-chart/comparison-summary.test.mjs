import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonSummary } from './comparison-summary.ts';

test('range and selected-day summaries use the same comparable dates; gaps and zero baselines remain explicit', () => {
  const actual = [{time: 1, value: 1000}, {time: 2, value: 20}, {time: 3, value: 30}];
  const baseline = [{time: 2, value: 10}, {time: 3, value: 15}];
  assert.deepEqual(comparisonSummary(actual, baseline, null), {current: 25, baseline: 12.5, change: 100, comparableCount: 2});
  assert.deepEqual(comparisonSummary(actual, baseline, 0), {current: 1000, baseline: undefined, change: undefined, comparableCount: 2});
  assert.deepEqual(comparisonSummary(actual, baseline, 2), {current: 30, baseline: 15, change: 100, comparableCount: 2});
  assert.equal(comparisonSummary([{time: 1, value: 10}], [{time: 1, value: 0}], 0).change, undefined);
  assert.deepEqual(comparisonSummary([], [], null), {current: undefined, baseline: undefined, change: undefined, comparableCount: 0});
});
