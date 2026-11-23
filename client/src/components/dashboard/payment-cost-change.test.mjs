import test from 'node:test';
import assert from 'node:assert/strict';
import { costRatioRelativeChange } from './payment-analysis.data.ts';
test('cost share column reports relative movement rather than the percentage-point difference', () => {
  assert.ok(Math.abs(costRatioRelativeChange({ costRatio: 0.3, baselineCost: 20, baseline: 100 }) - 0.5) < 1e-12);
  assert.equal(costRatioRelativeChange({ costRatio: 0, baselineCost: 20, baseline: 100 }), -1);
  assert.equal(costRatioRelativeChange({ costRatio: 0.3, baselineCost: 0, baseline: 100 }), null);
  assert.equal(costRatioRelativeChange({ costRatio: null, baselineCost: 20, baseline: 100 }), null);
});
