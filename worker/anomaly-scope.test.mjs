import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
const bundle = await build({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { gmvAnomalies } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const day = '2026-11-24';
const shift = (date, n) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);

test('one live detector keeps each calendar scoped while returning all signals for diagnosis', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE pollo_da_fact_rows(dataset,period,week_start,platform,gmv_usd,dataset_kind,attribution_type,pay_category,pay_type);
    CREATE VIEW pollo_da_fact_rows_read AS SELECT * FROM pollo_da_fact_rows;
    CREATE TABLE pollo_da_chain_funnel(period);
    CREATE TABLE daily_diagnosis_state(period,platform,active,signals);`);
  const insert = db.prepare(
    "INSERT INTO pollo_da_fact_rows VALUES('pay_type',?,?,?,?,'daily','NONE','ACTIVE_PAYMENT','首订')",
  );
  for (let i = 0; i < 110; i++) {
    const period = shift(day, -i);
    const week = shift(period, -((new Date(period).getUTCDay() + 1) % 7));
    const web = i === 0 ? 50 : i % 2 ? 80 : 20;
    const all = i === 0 ? 89 : 100;
    for (const [platform, value] of [
      ['all', all],
      ['web', web],
      ['app', all - web],
    ])
      insert.run(period, week, platform, value);
  }
  db.prepare('INSERT INTO pollo_da_chain_funnel VALUES(?)').run(day);
  db.prepare("INSERT INTO pollo_da_fact_rows(dataset,period) VALUES('renewal',?)").run(day);
  const state = db.prepare('INSERT INTO daily_diagnosis_state VALUES(?,?,1,?)');
  const historical = shift(day, -3),
    companion = shift(day, -4);
  state.run(historical, 'web', JSON.stringify([{ platform: 'web', period: historical, metric: 'totalGmv' }]));
  state.run(historical, 'all', JSON.stringify([{ platform: 'all', period: historical, metric: 'totalGmv' }]));
  state.run(companion, 'all', JSON.stringify([{ platform: 'app', period: companion, metric: 'totalGmv' }]));
  // Simulate a stale latest Web record as well as an actual overall anomaly.
  state.run(day, 'web', JSON.stringify([{ platform: 'web', period: day, metric: 'totalGmv' }]));
  const DB = {
    prepare(sql) {
      let binds = [];
      return {
        bind(...v) {
          binds = v;
          return this;
        },
        async first() {
          return db.prepare(sql).get(...binds);
        },
        async all() {
          return { results: db.prepare(sql).all(...binds) };
        },
      };
    },
  };
  try {
    const all = await (await gmvAnomalies({ DB }, day, 'all')).json();
    const web = await (await gmvAnomalies({ DB }, day, 'web')).json();
    const app = await (await gmvAnomalies({ DB }, day, 'app')).json();
    assert.ok(all.alerts.length > 0);
    assert.ok(all.alerts.every((alert) => alert.platform === 'all'));
    assert.deepEqual(web.alerts, all.alerts, 'background diagnosis still receives complete cross-platform signals');
    assert.deepEqual(all.anomalyDates, [historical, day]);
    assert.deepEqual(web.anomalyDates, [historical]);
    assert.deepEqual(app.anomalyDates, []);
    assert.ok(!all.anomalyDates.includes(companion), 'a companion diagnosis is not an overall anomaly');
  } finally {
    db.close();
  }
});
