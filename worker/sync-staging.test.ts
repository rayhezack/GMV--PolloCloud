import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeStagingChunks } from './sync-staging.ts';

test('splits a 135 KB aggregate result below the database field limit without losing rows', () => {
  const rows = Array.from({ length: 250 }, (_, index) => ({ index, label: '付费类型'.repeat(55) }));
  assert.ok(Buffer.byteLength(JSON.stringify(rows), 'utf8') > 64 * 1024);
  const chunks = serializeStagingChunks(rows);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(({ payload }) => Buffer.byteLength(payload, 'utf8') <= 60 * 1024));
  assert.deepEqual(chunks.flatMap(({ payload }) => JSON.parse(payload)), rows);
  assert.equal(chunks.reduce((total, chunk) => total + chunk.rowCount, 0), rows.length);
});

test('preserves the empty result and rejects an individual oversized row', () => {
  assert.deepEqual(serializeStagingChunks([]), [{ payload: '[]', rowCount: 0 }]);
  assert.throws(() => serializeStagingChunks([{ value: 'x'.repeat(60 * 1024) }]), /单行超过/);
});
