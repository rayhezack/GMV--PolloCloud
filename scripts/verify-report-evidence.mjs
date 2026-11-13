// Local only: executes the production SQL plan through SELECT-only remote reads,
// then runs the same loader/builder as the Worker without calling a model or saving a report.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { reportEvidenceQueries, loadReportSources } from '../worker/report-evidence-loader.ts';
import { buildReportEvidence, normalizeProductAction } from '../worker/report-evidence.ts';

const execute = promisify(execFile);
const root = new URL('../archives/report-pipeline-stage2-2026-11-08/', import.meta.url);
await mkdir(root, { recursive: true });
const fresh = process.argv.includes('--refresh');
const readAt = new Date().toISOString();
let actionSource;
try {
  const manifest = JSON.parse(await readFile(new URL('product-actions.manifest.json', root), 'utf8'));
  const rows = (await readFile(new URL('product-actions.ndjson', root), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (manifest.has_more !== false || rows.length !== manifest.records_count || manifest.timezone !== 'Asia/Shanghai' || !manifest.columns['上线时间'] || !manifest.columns['端']) throw new Error('动作范围或字段不完整');
  actionSource = { source: '飞书 Base/产品动作明细/SUN WEN user', status: 'ok', readAt: (await stat(new URL('product-actions.manifest.json', root))).mtime.toISOString(), complete: true, rows: rows.map(row => normalizeProductAction(row)), provenance: { baseToken: manifest.base_token, tableId: manifest.table_id, revision: manifest.rev, recordScope: manifest.query_context.record_scope, timezone: manifest.timezone, hasMore: manifest.has_more } };
  await writeFile(new URL('product-actions.source.json', root), JSON.stringify(actionSource, null, 2) + '\n');
}
catch { actionSource = { source: '飞书 Base/产品动作明细', status: 'unavailable', readAt, complete: false, rows: [], error: 'SUN WEN CLI来源尚未取得；未用其他账号或旧缓存替代' }; }
const summaries = [];
for (const platform of ['web', 'app']) {
  const window = { platform, startDate: '2026-10-24', endDate: '2026-11-06' };
  const queries = reportEvidenceQueries(window);
  const receipts = [];
  const loaded = await loadReportSources(window, {
    query: async (sql, ...binds) => {
      const query = queries.find(q => q.sql === sql && JSON.stringify(q.binds) === JSON.stringify(binds));
      if (!query || !sql.startsWith('SELECT ') || sql.includes(';')) throw new Error('Only the production SELECT plan is allowed');
      const key = `${platform}-${query.key}`;
      let payload;
      const path = new URL(`${key}.source.json`, root);
      if (fresh) {
        let i = 0;
        const rendered = sql.replace(/\?/g, () => `'${binds[i++].replaceAll("'", "''")}'`);
        await writeFile(new URL(`${key}.sql`, root), rendered + '\n');
        const { stdout } = await execute('pollocloud', ['db', 'execute', '--name', 'pollo-ai', '--command', rendered, '--json'], { env: { ...process.env, NODE_USE_ENV_PROXY: '1' }, timeout: 120000, maxBuffer: 24 * 1024 * 1024 });
        const result = JSON.parse(stdout.slice(stdout.indexOf('[')))[0];
        if (!result.success || result.meta.rows_written !== 0) throw new Error('Read-only receipt failed');
        payload = { source: query.source, status: 'ok', readAt: new Date().toISOString(), rows: result.results, rowsWritten: result.meta.rows_written };
        await writeFile(path, JSON.stringify(payload, null, 2) + '\n');
      } else payload = JSON.parse(await readFile(path, 'utf8'));
      receipts.push({ key: query.key, source: payload.source, readAt: payload.readAt, rows: payload.rows.length, rowsWritten: payload.rowsWritten, sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex') });
      return payload.rows;
    },
    actions: async () => actionSource,
  });
  // Preserve the actual extraction timestamp rather than the replay time.
  for (const receipt of receipts) loaded[receipt.key].readAt = receipt.readAt;
  const evidence = buildReportEvidence(window, loaded);
  await writeFile(new URL(`${platform}-evidence.json`, root), JSON.stringify(evidence, null, 2) + '\n');
  await writeFile(new URL(`${platform}-receipts.json`, root), JSON.stringify(receipts, null, 2) + '\n');
  const summary = { platform, revenue: evidence.revenue.total.movement, categories: evidence.revenue.items.map(r => r.movement), lifecycle: evidence.activeChain.lifecycle.map(r => ({ label: r.label, gmv: r.gmv.movement, core: r.lmdi.sameDirection.slice(0,2) })), renewal: evidence.renewal.gmv.movement, checks: { passed: evidence.checks.filter(c=>c.passed).length, failed: evidence.checks.filter(c=>!c.passed) }, sources: evidence.sources, actions: { complete: evidence.productActions.complete, eligible: evidence.productActions.eligible.length, excluded: evidence.productActions.excluded.length }, gaps: evidence.gaps };
  summaries.push(summary);
  console.log(JSON.stringify(summary, null, 2));
}
await writeFile(new URL('verification.json', root), JSON.stringify(summaries, null, 2) + '\n');
// Acceptance for this fixed real-data window requires complete extraction and
// valid equations. Unmatured retention is an explicit gap, not a failed equation.
const failures = summaries.flatMap(summary => [
  ...summary.checks.failed.map(check => `${summary.platform}: ${JSON.stringify(check)}`),
  ...Object.entries(summary.sources).filter(([, source]) => !source.complete).map(([key]) => `${summary.platform}: incomplete ${key}`),
  ...(!summary.actions.complete ? [`${summary.platform}: incomplete product actions`] : []),
]);
if (failures.length) throw new Error(`Real-data evidence acceptance failed:\n${failures.join('\n')}`);
