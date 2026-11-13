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
buildSync({ stdin: { contents: readFileSync(new URL('./index.ts', import.meta.url), 'utf8') + '\nexport {syncPlan, createSyncRun, newSyncJob, runBaseSyncStep, replaceFactRange, stageSyncRows, saveSyncJob, controlSyncRun, runScheduledSync, executeSyncRun, retrySyncRun};', resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' });
const worker = await import(pathToFileURL(outfile).href);
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE pollo_da_chain_funnel(period TEXT, platform TEXT); CREATE TABLE pollo_da_chain_breakdown(period TEXT, platform TEXT)');
  for (const file of readdirSync(new URL('../db/', import.meta.url)).filter(n => n.endsWith('.sql') && !n.startsWith('0020_') && !n.startsWith('0021_') && !n.startsWith('0026_')).sort()) db.exec(readFileSync(new URL(`../db/${file}`, import.meta.url), 'utf8'));
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
test('scheduled continuation reuses the same job after success or failure instead of creating another pull', async () => {
  const { db, env } = fixture();
  const key='2026-11-11:creative:2026-11-10', body={mode:'date_range',startDate:'2026-11-10',endDate:'2026-11-10',datasets:['creative']};
  const first=await (await worker.createSyncRun(env,request(body),key)).json();
  assert.equal(first.trigger,'scheduled');
  for (const status of ['queued','success','failed']) {
    db.prepare('UPDATE sync_jobs SET status=?,payload=?').run(status,JSON.stringify({...first,status}));
    const again=await (await worker.createSyncRun(env,request(body),key)).json();
    assert.equal(again.runId,first.runId);assert.equal(again.status,status);
  }
  assert.equal(db.prepare('SELECT count(*) n FROM sync_jobs').get().n,1);
  db.close();
});
test('batch recovers a previously successful creative publication without any source request', async () => {
  const { db, env } = fixture();let calls=0;const original=globalThis.fetch;
  globalThis.fetch=async()=>{calls++;throw Error('must not pull');};
  try {
    const job=worker.newSyncJob('date_range','2026-11-10','2026-11-10',['all','web','app'],['creative']);job.status='success';
    db.prepare("INSERT INTO sync_jobs VALUES(?,'success',?,?,?)").run(job.runId,JSON.stringify(job),Date.parse('2026-11-11T02:00:00Z'),Date.now());
    for(let i=0;i<3;i++)assert.equal((await worker.runScheduledSync(env,['creative'],'2026-11-10','2026-11-11')).runId,job.runId);
    assert.equal(calls,0);assert.equal(db.prepare('SELECT count(*) n FROM sync_jobs').get().n,1);
  } finally {globalThis.fetch=original;db.close();}
});
test('browser polling cannot execute a scheduled or legacy job; explicit resume transfers ownership', async () => {
  const { db, env } = fixture();
  const job=worker.newSyncJob('date_range','2026-11-10','2026-11-10',['all','web','app'],['creative']);job.trigger='scheduled';
  db.prepare("INSERT INTO sync_jobs VALUES(?,'queued',?,?,?)").run(job.runId,JSON.stringify(job),Date.now(),Date.now());
  await (await worker.executeSyncRun(env,request({runId:job.runId}))).text();
  assert.equal(db.prepare('SELECT status FROM sync_jobs').get().status,'queued');
  await worker.controlSyncRun(env,request({runId:job.runId}),'pause');
  const resumed=await (await worker.controlSyncRun(env,request({runId:job.runId}),'resume')).json();assert.equal(resumed.trigger,'manual');
  db.close();
});

test('cancel is terminal for queued, running, and paused jobs and cannot be resumed', async () => {
  const { db, env } = fixture();
  try {
    const job = worker.newSyncJob('date_range','2026-11-10','2026-11-10',['all','web','app'],['creative']);
    db.prepare("INSERT INTO sync_jobs VALUES(?,'paused',?,?,?)").run(job.runId, JSON.stringify({...job,status:'paused'}), Date.now(), Date.now());
    const response = await worker.controlSyncRun(env, request({runId:job.runId}), 'cancel');
    const cancelled = await response.json();
    assert.equal(cancelled.status, 'cancelled');
    assert.match(cancelled.errorMessage, /已完成的数据保留/);
    assert.equal(db.prepare('SELECT status FROM sync_jobs WHERE run_id=?').get(job.runId).status, 'cancelled');
    const resume = await worker.controlSyncRun(env, request({runId:job.runId}), 'resume');
    assert.equal(resume.status, 409);
    const execute = await (await worker.executeSyncRun(env, request({runId:job.runId}))).text();
    assert.match(execute, /已结束/);
  } finally { db.close(); }
});
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


test('pause is durable across queued/running writes and resume keeps the same cursor', async()=>{
 const {db,env}=fixture();
 const job=worker.newSyncJob('date_range','2026-10-20','2026-10-20',['web'],['creative']);
 job.status='running';job.stage='write';job.writtenSteps=['web-creative'];job.rowsSynced=12;
 db.prepare("INSERT INTO sync_jobs VALUES(?,'running',?,0,0)").run(job.runId,JSON.stringify(job));
 const pause=await worker.controlSyncRun(env,request({runId:job.runId}),'pause');assert.equal((await pause.json()).status,'pausing');
 job.status='queued';await worker.saveSyncJob(env,job);
 assert.equal(job.status,'paused');
 const saved=JSON.parse(db.prepare('SELECT payload FROM sync_jobs').get().payload);
 assert.deepEqual(saved.writtenSteps,['web-creative']);assert.equal(saved.rowsSynced,12);
 const resumed=await (await worker.controlSyncRun(env,request({runId:job.runId}),'resume')).json();
 assert.equal(resumed.status,'queued');assert.equal(resumed.runId,job.runId);assert.deepEqual(resumed.writtenSteps,['web-creative']);
 await worker.controlSyncRun(env,request({runId:job.runId}),'pause');
 await worker.runBaseSyncStep(env,{...resumed,status:'running'});
 assert.equal(db.prepare('SELECT status FROM sync_jobs').get().status,'paused');
 db.close();
});


test('selected dataset/date creates only its own steps and refuses invalid scopes', async () => {
  const {db,env}=fixture();
  try {
    for(const dataset of ['creative','creation_chain','ads','pay_type','chain','renewal']) {
      const response=await worker.createSyncRun(env,request({mode:'date_range',startDate:'2026-11-10',endDate:'2026-11-10',datasets:[dataset]}));
      assert.equal(response.status,200);
      const job=await response.json();
      assert.deepEqual(job.datasets,[dataset]);
      assert.equal(job.startDate,'2026-11-10');assert.equal(job.endDate,'2026-11-10');
      assert.ok(job.steps.filter(step=>step.key!=='finish').every(step=>step.key.endsWith(`-${dataset}`)));
      if(['creation_chain','ads','pay_type','chain'].includes(dataset))assert.equal(job.steps.length,2);
      // Selecting another source cannot silently return this unrelated job.
      assert.equal((await worker.createSyncRun(env,request({mode:'date_range',startDate:'2026-11-10',endDate:'2026-11-10',datasets:['renewal']}))).status,409);
      db.prepare("UPDATE sync_jobs SET status='success',payload=json_set(payload,'$.status','success') WHERE run_id=?").run(job.runId);
    }
    const count=db.prepare('SELECT count(*) n FROM sync_jobs').get().n;
    for(const body of [
      {datasets:['typo']},{datasets:[]},{datasets:['creation_chain','creative']},
      {datasets:['ads'],startDate:'2026-11-09'},
    ]) {
      const response=await worker.createSyncRun(env,request({mode:'date_range',startDate:'2026-11-10',endDate:'2026-11-10',...body}));
      assert.equal(response.status,400);
    }
    assert.equal(db.prepare('SELECT count(*) n FROM sync_jobs').get().n,count);
  } finally {db.close();}
});

test('creation chain resumes from an already published step without pulling again', async () => {
  const {db,env}=fixture();let calls=0;const original=globalThis.fetch;
  globalThis.fetch=async()=>{calls++;throw Error('must not pull');};
  try {
    const job=worker.newSyncJob('date_range','2026-11-10','2026-11-10',['all','web','app'],['creation_chain']);
    job.steps[0].status='success';job.rowsSynced=17;
    db.prepare("INSERT INTO sync_jobs VALUES(?,'running',?,?,?)").run(job.runId,JSON.stringify(job),Date.now(),Date.now());
    await worker.runBaseSyncStep(env,job);
    assert.equal(job.status,'success');assert.equal(job.rowsSynced,17);assert.equal(calls,0);
    assert.equal(db.prepare('SELECT status FROM sync_jobs').get().status,'success');
  } finally {globalThis.fetch=original;db.close();}
});


test('light datasets create one task; retry preserves committed steps and ownership', async () => {
  const {db,env}=fixture();
  try {
    const response=await worker.createSyncRun(env,request({mode:'date_range',startDate:'2026-11-10',endDate:'2026-11-10',datasets:['renewal','ads','creation_chain']}),'2026-11-11:renewal,ads,creation_chain:2026-11-10');
    assert.equal(response.status,200);const job=await response.json();
    assert.equal(job.steps.length,6);
    assert.deepEqual(job.steps.map(s=>s.key),['all-renewal','all-ads','all-creation_chain','web-renewal','app-renewal','finish']);
    job.status='failed';job.rowsSynced=500;
    job.steps.find(s=>s.key==='all-ads').status='success';
    db.prepare("UPDATE sync_jobs SET status='failed',payload=? WHERE run_id=?").run(JSON.stringify(job),job.runId);
    const retry=await (await worker.retrySyncRun(env,request({runId:job.runId}))).json();
    assert.equal(retry.rowsSynced,500);assert.equal(retry.scheduledKey,job.scheduledKey);
    assert.equal(retry.steps.find(s=>s.key==='all-ads').status,'success');
    assert.equal(retry.steps.find(s=>s.key==='all-renewal').status,'waiting');
    assert.equal((await (await worker.createSyncRun(env,request({}),job.scheduledKey)).json()).runId,retry.runId);
  } finally {db.close();}
});
