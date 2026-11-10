import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { encodeDashboardCache, decodeDashboardCache } from './dashboard-cache.ts';

test('large Unicode histories fit the 64 KiB cache value limit and old JSON remains readable', async () => {
  const payload = JSON.stringify(Array.from({ length: 130 }, (_, day) => ({ day, '自动续订': 123456.789, labels: '产品动作、套餐升级、重新订阅'.repeat(50) })));
  assert.ok(new TextEncoder().encode(payload).length > 64 * 1024);
  const encoded = await encodeDashboardCache(payload);
  assert.ok(new TextEncoder().encode(encoded).length < 64 * 1024);
  assert.equal(await decodeDashboardCache(encoded), payload);
  assert.equal(await decodeDashboardCache('{"old":true}'), '{"old":true}');
});

test('headline requests preserve single-copy scopes and exclude model rows without reading diagnostic tables', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dashboard-performance-'));
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const name of ['0002_dashboard_response_cache.sql', '0009_pollo_da_analytics.sql', '0010_pay_type_subscription_tier.sql', '0011_middle_table_dimensions.sql', '0018_payment_product_dimensions.sql', '0022_single_payment_facts.sql', '0024_dashboard_payment_result_index.sql']) sqlite.exec(readFileSync(new URL(`../db/${name}`, import.meta.url), 'utf8'));
    const insert = sqlite.prepare(`INSERT INTO pollo_da_fact_rows(dataset,source_record_id,period,week_start,platform,device_type,pay_type,pay_category,attribution_type,gmv_usd,fields_json,updated_at) VALUES ('pay_type',?,'2026-11-03','2026-10-31','all',?,?,?,?,?,'{}',0)`);
    for (const [device, active, renewal] of [['web',100,20], ['ios',40,10], ['android',30,5], ['unknown',7,2]]) {
      insert.run(`${device}-active`,device,'首订','ACTIVE_PAYMENT','NONE',active);
      insert.run(`${device}-renewal`,device,'自动续订','AUTO_RENEWAL','NONE',renewal);
      insert.run(`${device}-model`,device,'首订','ACTIVE_PAYMENT','MODEL',999999);
    }
    const bundle = join(directory, 'worker.mjs');
    buildSync({ entryPoints: [new URL('./index.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
    const { default: worker } = await import(pathToFileURL(bundle).href);
    const sqls = [], writes = [];
    const db = { prepare(sql) {
      sqls.push(sql);
      let args = [];
      return { bind(...values) { args = values; return this; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async run() { return sqlite.prepare(sql).run(...args); } };
    } };
    for (const [platform, device, total, active, renewal] of [['all','',214,177,37], ['web','',120,100,20], ['app','',85,70,15], ['app','ios',50,40,10]]) {
      const response = await worker.fetch(new Request(`https://example.com/api/dashboard/overview?view=cards&platform=${platform}&deviceType=${device}&granularity=day&startDate=2026-11-03&endDate=2026-11-03`), { DB: db }, { waitUntil(promise) { writes.push(promise); } });
      assert.equal(response.status, 200);
      const { payTypeTrend: [point] } = await response.json();
      assert.deepEqual([point.totalGmv,point.activeGmv,point.renewalGmv], [total,active,renewal]);
      const attributionUrl = `https://example.com/api/dashboard/attributions?dimension=pay_type&platform=${platform}&deviceType=${device}&startDate=2026-10-31&endDate=2026-11-06&baselinePeriod=2026-10-31&analysisPeriod=2026-10-31`;
      const context = { waitUntil(promise) { writes.push(promise); } };
      const full = await (await worker.fetch(new Request(attributionUrl), { DB: db }, context)).json();
      const summaryStart = sqls.length;
      const summary = await (await worker.fetch(new Request(`${attributionUrl}&view=summary`), { DB: db }, context)).json();
      const { paymentBreakdown, ...expectedSummary } = full;
      assert.deepEqual(summary, expectedSummary);
      assert.ok(!sqls.slice(summaryStart).some(sql => sql.includes('actual_supplier')));
    }
    await Promise.all(writes);
    assert.ok(!sqls.some(sql => /FROM pollo_da_chain|dataset = 'renewal'/.test(sql)));
    const query = sqls.find(sql => sql.includes('SUM(gmv_usd)'));
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all('2026-11-03','2026-11-03','all');
    assert.ok(plan.some(row => row.detail.includes('pollo_da_payment_result_period')));
  } finally { sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
});
