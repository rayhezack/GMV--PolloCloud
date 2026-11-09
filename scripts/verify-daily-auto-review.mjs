// Replays real 11/08 evidence against a copy of the local review database. No network or model calls.
import assert from 'node:assert/strict';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
const root = 'archives/daily-auto-2026-11-08';
await copyFile('.local-data/daily-auto-review.sqlite', '.local-data/daily-auto-regression.sqlite');
const db = new DatabaseSync('.local-data/daily-auto-regression.sqlite');
const prepare = sql => {
  const stmt = db.prepare(sql);
  const bound = (values = []) => ({ bind: (...v) => bound(v), all: async () => ({ results: stmt.all(...values) }), first: async () => stmt.get(...values) || null, run: async () => stmt.run(...values) });
  return bound();
};
const env = { DB: { prepare }, KIMI_MODEL: 'kimi-k3' };
const compiled = await build({ entryPoints: ['worker/daily-diagnosis-jobs.ts'], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { tickDailyDiagnoses, markDailyDiagnosisDirty, getDailyDiagnosis } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
try {
  assert.equal(db.prepare("SELECT count(*) n FROM daily_diagnosis_jobs WHERE status IN ('running','queued')").get().n, 0, 'Wait for real generation to finish');
  const detection = JSON.parse(await readFile(`${root}/detected.json`, 'utf8'));
  const count = () => db.prepare('SELECT count(*) n FROM daily_diagnosis_jobs').get().n;
  const previous = Object.fromEntries(await Promise.all(['all','web','app'].map(async p => [p, await getDailyDiagnosis(env,p,'2026-11-08')])));
  let modelCalls = 0;
  const dependencies = {
    detect: async () => detection,
    collect: async signals => JSON.parse(db.prepare("SELECT evidence FROM daily_diagnosis_jobs WHERE platform=? AND status='success' ORDER BY created_at DESC,rowid DESC LIMIT 1").get(signals[0].platform).evidence),
    generate: async () => { modelCalls++; throw Error('Repeated input must not call the model'); },
  };
  const before = count();
  await markDailyDiagnosisDirty(env);
  await tickDailyDiagnoses(env, dependencies);
  const reused = {};
  for (const p of ['all','web']) {
    const state = await getDailyDiagnosis(env,p,'2026-11-08');
    assert.equal(state.status,'success');
    assert.equal(state.report.runId,previous[p].report.runId);
    assert.equal(state.report.markdown,previous[p].report.markdown);
    reused[p] = state.report.runId;
  }
  assert.equal((await getDailyDiagnosis(env,'app','2026-11-08')).status,'normal');
  assert.equal(count(),before);assert.equal(modelCalls,0);
  await markDailyDiagnosisDirty(env);
  await tickDailyDiagnoses(env,{...dependencies,detect:async()=>({...detection,alerts:[]})});
  for(const p of ['all','web']) {
    const state=await getDailyDiagnosis(env,p,'2026-11-08');
    assert.equal(state.status,'clear');assert.equal(state.report.runId,reused[p]);
    assert.ok(state.report.generatedAt);
  }
  assert.equal(count(),before);assert.equal(modelCalls,0);
  const receipt={date:'2026-11-08',checkedAt:new Date().toISOString(),database:'local copy only',reused,historyJobs:before,jobsAdded:0,modelCalls,clearRetainsHistory:true,appUntriggered:true};
  await writeFile(`${root}/same-input-regression.json`,JSON.stringify(receipt,null,2));
  console.log(receipt);
} finally { db.close(); }
