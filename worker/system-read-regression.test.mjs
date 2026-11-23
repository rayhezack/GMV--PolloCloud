import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'system-read-'));
const bundle = join(directory, 'worker.mjs');
buildSync({
  entryPoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  logLevel: 'silent',
});
const { default: worker } = await import(pathToFileURL(bundle).href);
after(() => rmSync(directory, { recursive: true, force: true }));

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const name of [
    '0009_pollo_da_analytics.sql',
    '0010_pay_type_subscription_tier.sql',
    '0011_middle_table_dimensions.sql',
    '0012_ads_daily.sql',
    '0013_creation_chain.sql',
    '0015_payment_registration.sql',
    '0018_payment_product_dimensions.sql',
    '0022_single_payment_facts.sql',
    '0024_dashboard_payment_result_index.sql',
  ])
    db.exec(readFileSync(new URL(`../db/${name}`, import.meta.url), 'utf8'));
  const calls = [];
  const adapter = {
    prepare(sql) {
      let binds = [];
      return {
        bind(...values) {
          binds = values;
          return this;
        },
        async all() {
          const rows = db.prepare(sql).all(...binds);
          calls.push({ sql, binds, count: rows.length, bytes: JSON.stringify(rows).length });
          return { results: rows };
        },
        async first() {
          return db.prepare(sql).get(...binds) ?? null;
        },
        async run() {
          return db.prepare(sql).run(...binds);
        },
      };
    },
  };
  const request = async (path, params) => {
    const response = await worker.fetch(
      new Request(`https://local/api/dashboard/${path}?${new URLSearchParams(params)}`),
      { DB: adapter },
      { waitUntil() {} },
    );
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const insert =
    db.prepare(`INSERT INTO pollo_da_fact_rows(dataset,source_record_id,period,week_start,platform,device_type,dataset_kind,attribution_type,pay_category,pay_type,gmv_usd,order_equivalent,fields_json,updated_at)
    VALUES('pay_type',?,?,?,'all',?,'daily',?,'ACTIVE_PAYMENT',?,?,?, ?,0)`);
  let id = 0;
  const fact = (date, device = 'web', type = 'NONE', amount = 10, payType = '首订', week = '2026-10-31') =>
    insert.run(
      String(++id),
      date,
      week,
      device,
      type,
      payType,
      amount,
      amount / 10,
      JSON.stringify({ hidden: 'x'.repeat(2000) }),
    );
  return { db, request, calls, fact };
}

test('stored coverage survives running, failed and cancelled syncs and remains dataset/scope specific', async () => {
  const { db, request, calls, fact } = fixture();
  try {
    db.exec('CREATE TABLE sync_jobs(status TEXT,payload TEXT,created_at TEXT)');
    fact('2026-10-06');
    fact('2026-11-04');
    fact('2026-11-05', 'ios');
    fact('2026-11-08', 'web', 'MODEL');
    for (const [date, scope] of [
      ['2026-10-01', '汇总'],
      ['2026-11-01', '汇总'],
      ['2026-11-03', 'WEB'],
    ])
      db.prepare(
        `INSERT INTO pollo_da_creation_overall_daily(period,week_start,week_end,platform_type,creation_task_cnt,creation_user_cnt,success_task_cnt,success_output_cnt,adopted_task_cnt,adopted_output_cnt,gmv_usd,updated_at) VALUES(?,'2026-10-31','2026-11-06',?,1,1,1,1,1,1,1,0)`,
      ).run(date, scope);
    for (const [date, scope] of [
      ['2026-10-09', 'web'],
      ['2026-11-02', 'app'],
    ])
      db.prepare(
        `INSERT INTO pollo_da_ads_daily(period,week_start,week_end,platform,channel,country,cost_usd,impressions,clicks,register_user_cnt,gmv_d0,updated_at) VALUES(?,'2026-10-31','2026-11-06',?,'Google','US',1,1,1,1,1,0)`,
      ).run(date, scope);
    for (const status of ['running', 'failed', 'cancelled']) {
      db.prepare('INSERT INTO sync_jobs VALUES(?,?,?)').run(status, '{}', '2026-11-09');
      assert.deepEqual(await request('data-coverage', { dataset: 'pay_type', platform: 'all' }), {
        startDate: '2026-10-06',
        endDate: '2026-11-05',
      });
      assert.deepEqual(await request('data-coverage', { dataset: 'pay_type', platform: 'web' }), {
        startDate: '2026-10-06',
        endDate: '2026-11-04',
      });
      assert.deepEqual(await request('data-coverage', { dataset: 'creation_chain', platform: 'all' }), {
        startDate: '2026-10-01',
        endDate: '2026-11-01',
      });
      assert.deepEqual(await request('data-coverage', { dataset: 'ads', platform: 'all' }), {
        startDate: '2026-10-09',
        endDate: '2026-11-02',
      });
    }
    assert.deepEqual(await request('data-coverage', { dataset: 'pay_type', platform: 'app', deviceType: 'ios' }), {
      startDate: '2026-11-05',
      endDate: '2026-11-05',
    });
    assert.equal(await request('data-coverage', { dataset: 'pay_type', platform: 'app', deviceType: 'android' }), null);
    assert.deepEqual(await request('data-coverage', { dataset: 'creation_chain', platform: 'web' }), {
      startDate: '2026-11-03',
      endDate: '2026-11-03',
    });
    assert.ok(
      calls.every(
        (c) => !c.sql.includes('sync_jobs') && c.count <= 1 && /ORDER BY period (ASC|DESC) LIMIT 1/.test(c.sql),
      ),
    );
    const payment = calls.find((c) => c.sql.includes('dataset=?'));
    assert.ok(
      db
        .prepare(`EXPLAIN QUERY PLAN ${payment.sql}`)
        .all(...payment.binds)
        .some((r) => r.detail.includes('pollo_da_payment_result_period')),
    );
  } finally {
    db.close();
  }
});

test('payment analysis bounds row transport and loads only the requested registration subtype', async () => {
  const { db, request, calls, fact } = fixture();
  try {
    for (const [date, week] of [
      ['2026-10-27', '2026-10-24'],
      ['2026-11-03', '2026-10-31'],
    ]) {
      for (let n = 0; n < 2000; n++) fact(date, 'web', 'NONE', 0.01, '首订', week);
      fact(date, 'web', 'NONE', 5, '积分包', week);
      fact(date, 'web', 'MODEL', 99999, '首订', week);
      for (const [type, amount] of [
        ['首订', 20],
        ['积分包', 5],
      ])
        db.prepare(
          `INSERT INTO pollo_da_payment_registration(period,week_start,platform,device_type,pay_type,user_lifecycle,country_tier,gmv_usd) VALUES(?,?,'web','web',?,'OLD','T1',?)`,
        ).run(date, week, type, amount);
    }
    const params = { platform: 'web', baselinePeriod: '2026-10-24', analysisPeriod: '2026-10-31' };
    const main = await request('payment-analysis', params);
    assert.equal(main.source, 'ads_v1');
    assert.equal(main.comparison.analysisPeriodDays, 1);
    assert.ok(Math.abs(main.revenues.reduce((sum, r) => sum + r.gmvUsd, 0) - 50) < 1e-7);
    assert.ok(!calls.some((c) => c.sql.includes('pollo_da_payment_registration')));
    assert.ok(calls.every((c) => !c.sql.includes('fields_json') && c.count <= 4 && c.bytes < 3000));
    const detail = await request('payment-analysis', { ...params, registrationPayType: '首订' });
    assert.deepEqual(detail.registration.verifiedPayTypes, ['首订']);
    assert.equal(detail.registration.rows.length, 2);
    assert.ok(detail.registration.rows.every((r) => r.payType === '首订'));
    const query = calls.find((c) => c.sql.includes('pollo_da_payment_registration'));
    assert.match(query.sql, /period BETWEEN \? AND \?/);
    assert.ok(query.binds.includes('首订'));
    assert.deepEqual(detail.revenues, main.revenues);
  } finally {
    db.close();
  }
});

test('payment explorer aggregates hidden product slices, preserves totals/nulls and excludes model allocations', async () => {
  const { db, request, calls, fact } = fixture();
  try {
    for (let n = 0; n < 3000; n++) fact('2026-11-03', 'web', 'NONE', 0.01);
    fact('2026-11-03', 'web', 'MODEL', 99999);
    fact('2026-11-03', 'ios', 'NONE', 5);
    db.exec("UPDATE pollo_da_fact_rows SET order_equivalent=NULL WHERE source_record_id='1'");
    const result = await request('daily-data', {
      dataset: 'pay_type',
      platform: 'all',
      startDate: '2026-10-06',
      endDate: '2026-11-04',
      pageSize: '50',
    });
    assert.equal(result.total, 2);
    assert.ok(Math.abs(result.items.reduce((sum, r) => sum + r.gmv_usd, 0) - 35) < 1e-7);
    assert.equal(result.items.find((r) => r.device_type === 'web').order_equivalent, null);
    assert.ok(calls.every((c) => !c.sql.includes('fields_json') && c.count <= 2));
    const web = await request('daily-data', {
      dataset: 'pay_type',
      platform: 'web',
      startDate: '2026-11-03',
      endDate: '2026-11-03',
    });
    assert.equal(web.total, 1);
    assert.ok(Math.abs(web.items[0].gmv_usd - 30) < 1e-7);
  } finally {
    db.close();
  }
});

test('creative summary conserves the main trend without reading function partitions', async () => {
  const { db, request, calls } = fixture();
  try {
    for (const [date, week, tasks] of [
      ['2026-10-27', '2026-10-24', 100],
      ['2026-11-03', '2026-10-31', 140],
    ])
      db.prepare(
        `INSERT INTO pollo_da_creation_overall_daily(period,week_start,week_end,platform_type,creation_task_cnt,creation_user_cnt,success_task_cnt,success_output_cnt,adopted_task_cnt,adopted_output_cnt,gmv_usd,updated_at) VALUES(?,?,'2026-11-06','汇总',?,10,80,80,40,40,1,0)`,
      ).run(date, week, tasks);
    const params = {
      platform: 'all',
      startDate: '2026-10-24',
      endDate: '2026-11-06',
      baselinePeriod: '2026-10-24',
      analysisPeriod: '2026-10-31',
    };
    const summary = await request('creative-overview', { ...params, view: 'summary' });
    assert.equal(summary.ready, true);
    assert.deepEqual(
      summary.trend.map((p) => p.creationTaskCnt),
      [100, 140],
    );
    assert.ok(!calls.some((c) => c.sql.includes('pollo_da_creation_function_daily')));
    const full = await request('creative-overview', params);
    assert.deepEqual(full.trend, summary.trend);
    assert.deepEqual(full.comparison, summary.comparison);
  } finally {
    db.close();
  }
});

test('headline renewal aggregation preserves selected device users without transporting hidden fields', async () => {
  const { db, request, calls, fact } = fixture();
  try {
    fact('2026-11-03', 'ios');
    for (const [type, expire, renew] of [
      ['APP', 300, 150],
      ['IOS', 100, 60],
      ['ANDROID', 200, 90],
    ])
      db.prepare(
        `INSERT INTO pollo_da_fact_rows(dataset,source_record_id,period,week_start,platform,dataset_kind,platform_type,expire_user_cnt,renew_user_cnt,renew_amount_usd,fields_json,updated_at) VALUES('renewal',?,'2026-11-03','2026-10-31','app','daily',?,?,?,10,'{}',0)`,
      ).run(type, type, expire, renew);
    const params = {
      view: 'cards',
      includeRenewal: 'true',
      platform: 'app',
      granularity: 'day',
      startDate: '2026-11-03',
      endDate: '2026-11-03',
    };
    const app = await request('overview', params);
    const ios = await request('overview', { ...params, deviceType: 'ios' });
    assert.deepEqual(await request('data-coverage', { dataset: 'renewal', platform: 'app', deviceType: 'ios' }), {
      startDate: '2026-11-03',
      endDate: '2026-11-03',
    });
    assert.deepEqual([app.payTypeTrend[0].expireUserCnt, app.payTypeTrend[0].renewalRate], [300, 0.5]);
    assert.deepEqual([ios.payTypeTrend[0].expireUserCnt, ios.payTypeTrend[0].renewalRate], [100, 0.6]);
    assert.ok(calls.filter((c) => c.sql.includes("dataset='renewal'")).every((c) => !c.sql.includes('fields_json')));
  } finally {
    db.close();
  }
});

test('payment day comparison selects exact dates, verifies slices only on those dates, and preserves week requests', async () => {
  const { db, request, fact } = fixture();
  try {
    for (const [date,week,amount] of [
      ['2026-10-27','2026-10-24',100], ['2026-11-03','2026-10-31',150],
      ['2026-10-28','2026-10-24',900], ['2026-11-04','2026-10-31',5000],
    ]) {
      fact(date,'web','NONE',amount,'自动续订',week);
      fact(date,'ios','NONE',99999,'自动续订',week);
      fact(date,'web','MODEL',amount,'自动续订',week);
      db.prepare(`INSERT INTO pollo_da_fact_rows(dataset,source_record_id,period,week_start,platform,device_type,dataset_kind,attribution_type,pay_category,pay_type,attribution_name,model_cost_usd,fields_json,updated_at)
        VALUES('pay_type',?,?,?,'all','web','daily','MODEL','汇总','汇总','seedance-2-5',?,'{}',0)`).run('cost-'+date,date,week,amount/5);
      db.prepare(`INSERT INTO pollo_da_payment_registration(period,week_start,platform,device_type,pay_type,user_lifecycle,country_tier,sku,gmv_usd)
        VALUES(?,?,'web','web','自动续订','OLD','T1','Pro_月订_800',?)`).run(date,week,date.endsWith('04') ? 1 : amount);
    }
    const params={platform:'web',baselinePeriod:'2026-10-27',analysisPeriod:'2026-11-03',mode:'day',registrationPayType:'自动续订'};
    const day=await request('payment-analysis',params);
    assert.equal(day.comparison.analysisPeriodDays,1);
    assert.equal(day.comparison.baselinePeriodDays,1);
    assert.deepEqual(day.revenues.map(r=>[r.period,r.weekStart,r.gmvUsd]),[
      ['2026-10-27','2026-10-27',100],['2026-11-03','2026-11-03',150],
    ]);
    assert.deepEqual(day.registration.verifiedPayTypes,['自动续订']);
    assert.equal(day.registration.rows.reduce((sum,r)=>sum+r.gmvUsd,0),250);
    assert.ok(day.registration.rows.every(r=>r.weekStart===r.period));
    const week=await request('payment-analysis',{...params,mode:'week',baselinePeriod:'2026-10-24',analysisPeriod:'2026-10-31'});
    assert.equal(week.comparison.analysisPeriodDays,2);
    assert.equal(week.revenues.length,4);
    assert.deepEqual(week.registration.verifiedPayTypes,[]);
    const missing=await request('payment-analysis',{...params,baselinePeriod:'2026-10-26'});
    assert.equal(missing.comparison,null);
    assert.ok(!missing.revenues.some(r=>r.period==='2026-10-26'));
    const model=await request('payment-analysis',{...params,attributionType:'MODEL'});
    assert.equal(model.revenues.reduce((sum,r)=>sum+r.gmvUsd,0),250);
    assert.deepEqual(model.costs.map(r=>[r.weekStart,r.modelCostUsd]),[['2026-10-27',20],['2026-11-03',30]]);
  } finally { db.close(); }
});
