// Fixed, user-approved two-week local verification. Remote access is SELECT-only;
// only pay/renewal snapshots are refreshed. Other evidence retains its original readAt.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { reportEvidenceQueries } from '../worker/report-evidence-loader.ts';
import { buildReportEvidence } from '../worker/report-evidence.ts';
import { prepareReportData } from '../worker/report-data.ts';

const root = new URL('../archives/renewal-product-review-2026-11-09/', import.meta.url);
const original = new URL('../archives/report-pipeline-stage2-2026-11-08/', import.meta.url);
const execute = promisify(execFile);
const refresh = process.argv.includes('--refresh');
await mkdir(new URL('sources/', root), { recursive: true });
const save = (name, data) => writeFile(new URL(name, root), JSON.stringify(data, null, 2) + '\n');
await copyFile(new URL('product-actions.source.json', original), new URL('sources/product-actions.source.json', root));
const results = [];
for (const platform of ['web', 'app']) {
  const window = { platform, startDate: '2026-10-24', endDate: '2026-11-06' };
  const sources = { actions: JSON.parse(await readFile(new URL('sources/product-actions.source.json', root), 'utf8')) };
  const receipts = [];
  for (const q of reportEvidenceQueries(window)) {
    const name = `${platform}-${q.key}.source.json`;
    const freshDimensions = ['pay', 'renewal'].includes(q.key);
    if (refresh && freshDimensions) {
      assert.match(q.sql, /^SELECT /);
      assert.ok(!q.sql.includes(';'));
      let i = 0;
      const sql = q.sql.replaceAll('?', () => `'${q.binds[i++].replaceAll("'", "''")}'`);
      const { stdout } = await execute('pollocloud', ['db', 'execute', '--name', 'pollo-ai', '--command', sql, '--json'], {
        env: { ...process.env, NODE_USE_ENV_PROXY: '1' }, maxBuffer: 24 * 1024 * 1024, timeout: 120000,
      });
      const response = JSON.parse(stdout.slice(stdout.indexOf('[')));
      assert.ok(response.length > 0 && response.every(part => part.success && part.meta.rows_written === 0));
      await save(`sources/${name}`, { source: q.source, status: 'ok', readAt: new Date().toISOString(), rows: response.flatMap(part => part.results), rowsWritten: response.reduce((n, part) => n + part.meta.rows_written, 0), provenance: { sql, metadata: response.map(part => part.meta) } });
    } else if (!freshDimensions) await copyFile(new URL(name, original), new URL(`sources/${name}`, root));
    const raw = await readFile(new URL(`sources/${name}`, root), 'utf8');
    sources[q.key] = JSON.parse(raw);
    assert.equal(sources[q.key].rowsWritten, 0);
    receipts.push({ key: q.key, readAt: sources[q.key].readAt, rows: sources[q.key].rows.length, sha256: createHash('sha256').update(raw).digest('hex') });
  }
  assert.ok(sources.pay.rows.filter(r => r.pay_category === 'AUTO_RENEWAL').every(r => Object.hasOwn(r, 'product_type')));
  assert.ok(sources.renewal.rows.every(r => Object.hasOwn(r, 'plan_tier')));
  const evidence = prepareReportData(buildReportEvidence(window, sources));
  assert.deepEqual(evidence.checks.filter(c => !c.passed), []);
  const previousSources = { ...sources, pay: JSON.parse(await readFile(new URL(`${platform}-pay.source.json`, original), 'utf8')), renewal: JSON.parse(await readFile(new URL(`${platform}-renewal.source.json`, original), 'utf8')) };
  const previous = buildReportEvidence(window, previousSources);
  assert.deepEqual({ ...evidence.activeChain, coverage: undefined }, { ...previous.activeChain, coverage: undefined });
  for (const side of ['baseline', 'current']) {
    assert.ok(Math.abs(evidence.revenue.total[side] - previous.revenue.total[side]) < 1e-7);
    for (let i = 0; i < evidence.revenue.items.length; i++) assert.ok(Math.abs(evidence.revenue.items[i][side] - previous.revenue.items[i][side]) < 1e-7);
    assert.ok(Math.abs(evidence.renewal.gmv[side] - previous.renewal.gmv[side]) < 1e-7);
  }
  await save(`${platform}-evidence.json`, evidence);
  results.push({ platform, window, checks: evidence.checks.length, failedChecks: [], receipts, unchangedActiveChain: true, sourceTotalsMatchPrevious: true, resultTypes: evidence.revenue.renewalTypes, resultTypeRanking: evidence.revenue.renewalTypeRanking, chainTypes: evidence.renewal.productTypes, modelCalls: 0, remoteRowsWritten: 0 });
}
await save('verification.json', results);
console.log(JSON.stringify(results.map(r => ({ platform: r.platform, checks: r.checks, resultTypes: r.resultTypes.map(t => t.key), chainTypes: r.chainTypes.map(t => t.key), unchangedActiveChain: r.unchangedActiveChain, remoteRowsWritten: r.remoteRowsWritten })), null, 2));
