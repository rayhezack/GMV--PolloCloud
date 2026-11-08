import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

test('dashboard action API reads only the published D1 snapshot, including when Base is offline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'product-actions-api-'));
  const sqlite = new DatabaseSync(':memory:');
  const originalFetch = globalThis.fetch;
  try {
    sqlite.exec(readFileSync(new URL('../db/0019_product_action_details.sql', import.meta.url), 'utf8'));
    sqlite.prepare('INSERT INTO pollo_da_product_action_details (snapshot_id,source_record_id,fields_json,updated_at) VALUES (?,?,?,?)')
      .run('published','source-1', JSON.stringify({ 更新点: 'Web 发布', 上线时间: '2026-11-03', 端: 'web' }), 1794000000000);
    sqlite.exec("UPDATE product_action_sync_state SET active_snapshot='published',row_count=1,synced_at=1794000000000,last_error='Base offline' WHERE id=1");
    const db = { prepare(sql) {
      let args = [];
      return { bind(...a) { args = a; return this; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async run() { throw Error('Dashboard must not write'); } };
    } };
    const bundle = join(directory, 'worker.mjs');
    buildSync({ entryPoints: [new URL('./index.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
    globalThis.fetch = async () => { throw Error('Interactive request must not call Base'); };
    const { default: worker } = await import(pathToFileURL(bundle).href);
    const response = await worker.fetch(new Request('https://example.com/api/dashboard/product-actions'), { DB: db }, { waitUntil() {} });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.available, true);
    assert.equal(body.source, 'D1');
    assert.equal(body.lastSyncError, 'Base offline');
    assert.equal(body.actions[0].title, 'Web 发布');
    assert.equal(body.actions[0].date, '2026-11-03');
    assert.equal(body.readAt, new Date(1794000000000).toISOString());
  } finally { globalThis.fetch = originalFetch; sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
});
