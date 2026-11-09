import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const dir = mkdtempSync(join(tmpdir(), 'sync-backfill-test-'));
const outfile = join(dir, 'worker.mjs');
buildSync({ stdin: { contents: readFileSync(new URL('./index.ts', import.meta.url), 'utf8') + '\nexport {syncPlan, createSyncRun, newSyncJob, runBaseSyncStep, replaceFactRange, stageSyncRows};', resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' });
const worker = await import(pathToFileURL(outfile).href);
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE pollo_da_chain_funnel(period TEXT, platform TEXT); CREATE TABLE pollo_da_chain_breakdown(period TEXT, platform TEXT)');
  for (const file of readdirSync(new URL('../db/', import.meta.url)).filter(n => n.endsWith('.sql') && !n.startsWith('0020_') && !n.startsWith('0021_')).sort()) db.exec(readFileSync(new URL(`../db/${file}`, import.meta.url), 'utf8'));
  const queries = [];
  const adapter = {
    prepare(sql) {
      queries.push(sql);
      const statement = { sql, args: [], bind(...args) { this.args = args; return this; },
        async first() { return db.prepare(sql).get(...this.args) ?? null; },
        async all() { return { results: db.prepare(sql).all(...this.args) }; },
        async run() { return { meta: db.prepare(sql).run(...this.args) }; },
      };
      return statement;
    },
    async batch(statements) {
      db.exec('BEGIN');
      try { for (const s of statements) db.prepare(s.sql).run(...s.args); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, env: { DB: adapter }, queries };
}
const request = body => new Request('https://test/api/sync-runs', { method: 'POST', body: JSON.stringify(body) });
function seed(db, dataset, period, platform, device = null) {
  db.prepare("INSERT INTO pollo_da_fact_rows(dataset,source_record_id,period,platform,device_type,attribution_type,pay_category,pay_type,fields_json,updated_at) VALUES(?,?,?,?,?,'NONE','ACTIVE_PAYMENT','首订','{}',0)")
    .run(dataset, `${period}:${platform}:${device}`, period, platform, device);
}

test('precheck uses indexed physical dates and SQL coverage, including virtual Web/App and unknown devices', async () => {
  const { db, env, queries } = fixture();
  try {
    const day = new Date(Date.now() + 8 * 3600000 - 86400000).toISOString().slice(0, 10);
    for (const device of ['web', 'ios', 'unknown']) seed(db, 'pay_type', day, 'all', device);
    const plan = await (await worker.syncPlan(env, 'latest_day', ['pay_type'])).json();
    assert.equal(plan.alreadySynced, true);
    assert.deepEqual(plan.missingItems, []);
    assert.ok(!queries.some(q => q.includes('pollo_da_fact_rows_read')));
    assert.ok(!queries.some(q => /SELECT \* FROM/.test(q)));
    db.exec("DELETE FROM pollo_da_fact_rows WHERE device_type='ios'");
    const partial = await (await worker.syncPlan(env, 'latest_day', ['pay_type'])).json();
    assert.deepEqual(partial.missingItems.map(i => i.platform), ['app']);
  } finally { db.close(); }
});

test('explicit existing and absent dates both create a refresh; invalid dates never reserve a job', async () => {
  const { db, env, queries } = fixture();
  try {
    seed(db, 'creative', '2026-10-20', 'web');
    for (const date of ['2026-10-20', '2026-10-21']) {
      const response = await worker.createSyncRun(env, request({ mode: 'date_range', startDate: date, endDate: date, datasets: ['creative'], platforms: ['web'] }));
      assert.equal(response.status, 200);
      const job = await response.json();
      assert.equal(job.status, 'queued');
      assert.equal(job.skipped, undefined);
      assert.equal(job.currentDate, date);
      assert.equal(job.startDate, date);
      db.exec('DELETE FROM sync_jobs');
    }
    for (const [startDate, endDate] of [['2026-02-30', '2026-03-01'], ['2026-10-21','2026-10-20'], ['2027-01-01','2027-01-01'], ['', '2026-10-20']]) {
      const response = await worker.createSyncRun(env, request({ mode: 'date_range', startDate, endDate }));
      assert.equal(response.status, 400);
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sync_jobs').get().n, 0);
    assert.ok(!queries.some(q => q.includes('MAX(period)')));
  } finally { db.close(); }
});

test('day refresh replaces existing rows, inserts missing days, keeps neighboring days and rolls back a failed write', async () => {
  const { db, env } = fixture();
  try {
    seed(db, 'creative', '2026-10-19', 'web');
    seed(db, 'creative', '2026-10-20', 'web');
    const rows = [{ period: '2026-10-20', platform: 'web', active_uv: 123 }];
    await worker.replaceFactRange(env, 'creative', 'web', '2026-10-20', '2026-10-20', rows);
    await worker.replaceFactRange(env, 'creative', 'web', '2026-10-20', '2026-10-20', rows);
    await worker.replaceFactRange(env, 'creative', 'web', '2026-10-21', '2026-10-21', [{ ...rows[0], period: '2026-10-21' }]);
    assert.deepEqual(db.prepare('SELECT period,COUNT(*) n,MAX(active_uv) uv FROM pollo_da_fact_rows GROUP BY period ORDER BY period').all().map(r => [r.period,r.n,r.uv]), [['2026-10-19',1,null],['2026-10-20',1,123],['2026-10-21',1,123]]);
    db.exec("CREATE TRIGGER fail_test BEFORE INSERT ON pollo_da_fact_rows WHEN NEW.active_uv=999 BEGIN SELECT RAISE(ABORT,'write failed'); END");
    await assert.rejects(() => worker.replaceFactRange(env, 'creative', 'web', '2026-10-20', '2026-10-20', [{ ...rows[0], active_uv: 999 }]), /write failed/);
    assert.equal(db.prepare("SELECT active_uv FROM pollo_da_fact_rows WHERE period='2026-10-20'").get().active_uv,123);
    await assert.rejects(() => worker.replaceFactRange(env, 'creative', 'web', '2026-10-20', '2026-10-20', []), /保留原数据/);
  } finally { db.close(); }
});

test('range cursor checkpoints each completed day and writes only the current day', async () => {
  const { db, env } = fixture();
  try {
    const job = worker.newSyncJob('date_range','2026-10-20','2026-10-21',['web'],['creative']);
    job.status = 'running'; job.steps[0].status = 'success'; job.writtenSteps = ['web-creative']; job.rowsSynced = 12;
    db.prepare("INSERT INTO sync_jobs VALUES(?,'running',?,0,0)").run(job.runId, JSON.stringify(job));
    await worker.stageSyncRows(env, job.runId, 'web-creative', [{ period:'2026-10-20',platform:'web',active_uv:100 }]);
    await worker.runBaseSyncStep(env, job);
    const saved = JSON.parse(db.prepare('SELECT payload FROM sync_jobs').get().payload);
    assert.equal(saved.currentDate,'2026-10-21'); assert.equal(saved.completedRows,12); assert.equal(saved.status,'queued');
    assert.equal(saved.steps[0].status,'waiting'); assert.deepEqual(saved.writtenSteps,[]);
    seed(db,'creative','2026-10-20','web');
    saved.status = 'running'; saved.steps[0].status='success';
    await worker.stageSyncRows(env, job.runId, 'web-creative', [{ period:'2026-10-21',platform:'web',active_uv:200 }]);
    await worker.runBaseSyncStep(env, saved);
    assert.equal(saved.rowsSynced,13); assert.equal(saved.currentDate,'2026-10-21');
    assert.deepEqual(db.prepare('SELECT period,active_uv FROM pollo_da_fact_rows ORDER BY period').all().map(r=>[r.period,r.active_uv]), [['2026-10-20',null],['2026-10-21',200]]);
  } finally { db.close(); }
});
