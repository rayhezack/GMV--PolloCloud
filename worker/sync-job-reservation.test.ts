import assert from 'node:assert/strict';
import test from 'node:test';
import { reserveSyncJob } from './sync-job-reservation.ts';

test('concurrent creators both return the one persisted job', async () => {
  let persisted: { runId: string } | null = null;
  const create = (runId: string) => reserveSyncJob(async () => {
    if (persisted) return null;
    persisted = { runId };
    return persisted;
  }, async () => persisted);
  const results = await Promise.all([create('creative'), create('renewal')]);
  assert.deepEqual(results, [{ runId: 'creative' }, { runId: 'creative' }]);
});

test('retries when the concurrent winner finishes before lookup', async () => {
  let attempts = 0;
  const result = await reserveSyncJob(async () => ++attempts === 1 ? null : { runId: 'persisted' }, async () => null);
  assert.deepEqual(result, { runId: 'persisted' });
  assert.equal(attempts, 2);
});
