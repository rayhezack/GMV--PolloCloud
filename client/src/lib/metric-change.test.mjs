import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeChange, changeContributions } from './metric-change.ts';

test('relative change handles growth, decline and zero baseline', () => {
  assert.equal(relativeChange(125, 100), .25);
  assert.equal(relativeChange(75, 100), -.25);
  assert.equal(relativeChange(20, 0), null);
});
test('contributions reconcile to the selected parent, including offsets and declines', () => {
  assert.deepEqual(changeContributions([{analysis:130,baseline:100},{analysis:90,baseline:100}]),[1.5,-.5]);
  assert.deepEqual(changeContributions([{analysis:70,baseline:100},{analysis:90,baseline:100}]),[.75,.25]);
  assert.deepEqual(changeContributions([{analysis:110,baseline:100},{analysis:90,baseline:100}]),[null,null]);
});
