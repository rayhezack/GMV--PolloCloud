import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalyticsClient } from './analytics.client.ts';

test('uses the private binding and reads MaxCompute results past the 10,000-row page', async () => {
  const calls: string[] = [];
  let submittedSql = '';
  const analytics = {
    async fetch(url: string, init?: RequestInit) {
      calls.push(url);
      if (url.endsWith('/v1/maxcompute/jobs')) {
        submittedSql = JSON.parse(String(init?.body)).sql;
        return new Response(JSON.stringify({ instance_id: 'job-1' }));
      }
      if (url.endsWith('/v1/maxcompute/jobs/job-1')) return new Response(JSON.stringify({ status: 'success' }));
      if (url.includes('offset=0')) {
        return new Response(JSON.stringify({ columns: ['id', 'source_row_count'], rows: Array.from({ length: 10_000 }, (_, id) => ({ id, source_row_count: 10_001 })) }));
      }
      return new Response(JSON.stringify({ rows: [{ id: 10_000, source_row_count: 10_001 }] }));
    },
  };
  const client = new AnalyticsClient({ ANALYTICS: analytics });
  (client as unknown as { sleep: () => Promise<void> }).sleep = async () => undefined;

  const result = await client.executeCompleteSql('SET odps.sql.type.system.odps2=true;\nSET foo=bar;\nSELECT 1');

  assert.equal(result.rows.length, 10_001);
  assert.deepEqual(result.column_names, ['id', 'source_row_count']);
  assert.equal(submittedSql, 'SELECT 1');
  assert.deepEqual(calls, [
    'https://data/v1/maxcompute/jobs',
    'https://data/v1/maxcompute/jobs/job-1',
    'https://data/v1/maxcompute/jobs/job-1/result?offset=0&limit=10000',
    'https://data/v1/maxcompute/jobs/job-1/result?offset=10000&limit=10000',
  ]);
});

test('normalizes synchronous Hologres object rows', async () => {
  const analytics = {
    async fetch(url: string) {
      assert.equal(url, 'https://data/v1/hologres/query');
      return new Response(JSON.stringify({ rows: [{ value: 1 }], columns: ['value'] }));
    },
  };
  const result = await new AnalyticsClient({ ANALYTICS: analytics }).holoQuery('SELECT $1', [1]);
  assert.deepEqual(result, { column_names: ['value'], rows: [[1]] });
});

test('retries an eventually consistent MaxCompute result page', async () => {
  let resultAttempts = 0;
  const analytics = {
    async fetch(url: string) {
      if (url.endsWith('/v1/maxcompute/jobs')) return new Response(JSON.stringify({ instance_id: 'job-2' }));
      if (url.endsWith('/v1/maxcompute/jobs/job-2')) return new Response(JSON.stringify({ status: 'terminated' }));
      resultAttempts += 1;
      if (resultAttempts === 1) throw new Error('ANALYTICS /v1/maxcompute/jobs/job-2/result?offset=0&limit=10000 409: {"error":"NOT_READY"}');
      return new Response(JSON.stringify({ columns: ['source_row_count'], rows: [[1]] }));
    },
  };
  const client = new AnalyticsClient({ ANALYTICS: analytics });
  (client as unknown as { sleep: () => Promise<void> }).sleep = async () => undefined;
  const result = await client.executeSql('SELECT 1');
  assert.deepEqual(result, { column_names: ['source_row_count'], rows: [[1]] });
  assert.equal(resultAttempts, 2);
});
