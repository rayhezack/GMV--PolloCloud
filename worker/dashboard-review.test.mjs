import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const bundle = await build({
  stdin: {
    contents: readFileSync('worker/index.ts', 'utf8') + '\nexport { chainFunnel, paymentTrend };',
    resolveDir: process.cwd() + '/worker',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const { chainFunnel, paymentTrend } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE pollo_da_chain_funnel(period TEXT,week_start TEXT,platform TEXT,device_type TEXT,country_tier TEXT,user_lifecycle TEXT,creation_cnt_30d_label TEXT,active_uv REAL,paywall_expose_uv REAL,paywall_submit_uv REAL,pay_uv REAL,gmv_usd REAL,pay_fail_order_cnt REAL,pay_fail_amount_usd REAL);
 CREATE TABLE pollo_da_chain_breakdown(period TEXT,week_start TEXT,platform TEXT,device_type TEXT,user_lifecycle TEXT,creation_cnt_30d_label TEXT,breakdown_type TEXT,breakdown_value TEXT,expose_uv REAL,submit_uv REAL,pay_uv REAL,gmv_usd REAL);
 CREATE TABLE pollo_da_fact_rows(period TEXT,week_start TEXT,platform TEXT,device_type TEXT,dataset TEXT,dataset_kind TEXT,attribution_type TEXT,pay_category TEXT,pay_type TEXT,gmv_usd REAL,function_name TEXT,user_tag TEXT,subscription_tier TEXT,attribution_name TEXT,actual_supplier TEXT,actual_provider TEXT,model_cost_usd REAL);`);
  const cols = db.prepare('PRAGMA table_info(pollo_da_fact_rows)').all().map(c => c.name);
  db.exec(`CREATE VIEW pollo_da_fact_rows_read AS SELECT * FROM pollo_da_fact_rows UNION ALL SELECT ${cols.map(c => c === 'platform' ? "CASE WHEN device_type='web' THEN 'web' ELSE 'app' END AS platform" : c).join(',')} FROM pollo_da_fact_rows WHERE platform='all' AND device_type IN ('web','ios','android')`);
  const prepare = (sql) => {
    const st = db.prepare(sql);
    const bound = (args = []) => ({
      bind: (...a) => bound(a),
      all: async () => ({ results: st.all(...args) }),
      first: async () => st.get(...args),
    });
    return bound();
  };
  return { db, env: { DB: { prepare } } };
}
const request = (params) => new Request('https://local/test?' + new URLSearchParams(params));
test('single-day diagnostics select only the exact dates including same-week comparisons, scopes, countries and channels', async () => {
  const { db, env } = fixture();
  for (const [date, week, n] of [
    ['2026-10-27', '2026-10-24', 100],
    ['2026-11-03', '2026-10-31', 200],
    ['2026-11-02', '2026-10-31', 900],
  ]) {
    for (const [life, factor] of [
      ['NEW', 1],
      ['OLD', 2],
    ]) {
      db.prepare('INSERT INTO pollo_da_chain_funnel VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
        date,
        week,
        'web',
        'web',
        'T1',
        life,
        'tier',
        n * factor,
        50 * factor,
        20 * factor,
        10 * factor,
        n * factor,
        0,
        0,
      );
      db.prepare('INSERT INTO pollo_da_chain_breakdown VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(
        date,
        week,
        'web',
        'web',
        life,
        'tier',
        'SUBMIT_CHANNEL',
        'Stripe',
        50 * factor,
        20 * factor,
        10 * factor,
        n * factor,
      );
    }
  }
  const params = {
    platform: 'web',
    mode: 'day',
    startDate: '2026-10-27',
    endDate: '2026-11-03',
    baselinePeriod: '2026-10-27',
    analysisPeriod: '2026-11-03',
  };
  const data = await (await chainFunnel(env, request(params))).json();
  assert.equal(data.ready, true);
  assert.deepEqual(data.comparisonDates, { baseline: ['2026-10-27'], analysis: ['2026-11-03'] });
  assert.equal(data.totals.current.activeUv, 600);
  assert.equal(data.totals.baseline.activeUv, 300);
  assert.equal(data.totals.current.aov, 20);
  assert.equal(data.countries[0].current.aov, 20);
  assert.equal(data.breakdowns.SUBMIT_CHANNEL[0].current.payRate, 0.5);
  const scoped = await (
    await chainFunnel(env, request({ ...params, userLifecycle: 'NEW', creationTier: 'tier' }))
  ).json();
  assert.equal(scoped.totals.current.activeUv, 200);
  const sameWeek = await (
    await chainFunnel(env, request({ ...params, startDate: '2026-11-02', baselinePeriod: '2026-11-02' }))
  ).json();
  assert.equal(sameWeek.ready, true);
  assert.equal(sameWeek.totals.baseline.activeUv, 2700);
  const week = await (
    await chainFunnel(
      env,
      request({
        ...params,
        mode: 'week',
        startDate: '2026-10-24',
        endDate: '2026-11-06',
        baselinePeriod: '2026-10-24',
        analysisPeriod: '2026-10-31',
      }),
    )
  ).json();
  assert.equal(week.ready, true);
  assert.equal(week.totals.current.activeUv, 600);
  assert.equal(week.comparison.analysisPeriodDays, 1);
  db.close();
});
test('payment trends use the latest source date, preserve missing days and never extend into future weeks', async () => {
  const { db, env } = fixture();
  for (const [date, kind] of [
    ['2026-10-06', 'NONE'],
    ['2026-11-04', 'NONE'],
    ['2026-11-05', 'MODEL'],
  ])
    db.prepare(
      'INSERT INTO pollo_da_fact_rows(period,week_start,platform,dataset,dataset_kind,attribution_type,pay_category,pay_type,gmv_usd) VALUES(?,?,?,?,?,?,?,?,?)',
    ).run(date, '2026-10-31', 'all', 'pay_type', 'daily', kind, 'ACTIVE_PAYMENT', '首订', 100);
  const p = { platform: 'all', analysisPeriod: '2026-10-31' };
  const data = await (await paymentTrend(env, request(p))).json();
  assert.equal(data.startDate, '2026-10-06');
  assert.equal(data.endDate, '2026-11-04');
  assert.equal(data.points.length, 30);
  assert.equal(data.points[1].gmvUsd, null);
  assert.equal(data.points.at(-1).gmvUsd, 100);
  const future = await (await paymentTrend(env, request({ ...p, endDate: '2026-11-06' }))).json();
  assert.equal(future.endDate, '2026-11-04');
  assert.equal(future.points.length, 30);
  db.close();
});
