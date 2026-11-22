import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChainComparison, comparisonParams, readChainComparison } from './chain-comparison.ts';
const params = { platform: 'web', mode: 'day', baseline: '2026-10-27', analysis: '2026-11-03', chainType: 'active' };
const row = (period, gmv, extra = {}) => ({
  period,
  platform: 'web',
  creation_cnt_30d_label: 'create_cnt_30d_0',
  user_lifecycle: 'OLD',
  active_uv: 100,
  paywall_expose_uv: 50,
  paywall_submit_uv: 20,
  pay_uv: 10,
  gmv_usd: gmv,
  ...extra,
});
const pay = [
  { period: params.baseline, gmv_usd: 230 },
  { period: params.analysis, gmv_usd: 340 },
];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} ≠ ${b}`);
test('single-day LMDI selects exact dates and preserves the pay/chain residual', () => {
  const data = buildChainComparison(
    params,
    [row(params.baseline, 200), row(params.analysis, 300), row('2026-10-28', 999999)],
    pay,
  );
  assert.equal(data.ready, true);
  assert.equal(data.total.delta, 110);
  close(data.factors.reduce((n, f) => n + f.effect, 0) + data.residual.effect, 110);
  close(data.residual.effect, 10);
  assert.equal(data.factors.length, 5);
  assert.equal(data.groups[0].factors[4].contribution, 100 / 110);
  assert.deepEqual(data.dates, { baseline: [params.baseline], analysis: [params.analysis] });
});
test('missing date, platform or atomic value cannot become a zero baseline', () => {
  assert.equal(buildChainComparison(params, [row(params.analysis, 300)], pay).ready, false);
  assert.equal(
    buildChainComparison({ ...params, platform: 'all' }, [row(params.baseline, 200), row(params.analysis, 300)], pay)
      .ready,
    false,
  );
  assert.equal(
    buildChainComparison(params, [row(params.baseline, 200, { active_uv: null }), row(params.analysis, 300)], pay)
      .ready,
    false,
  );
  assert.equal(
    buildChainComparison(params, [row(params.baseline, 200, { pay_uv: 0 }), row(params.analysis, 300)], pay).ready,
    false,
  );
});
test('signed root delta is the denominator, with zero-net change explicitly undefined', () => {
  const falling = [
    { period: params.baseline, gmv_usd: 400 },
    { period: params.analysis, gmv_usd: 300 },
  ];
  const data = buildChainComparison(params, [row(params.baseline, 200), row(params.analysis, 300)], falling);
  close(data.factors[4].contribution, -1);
  close(data.residual.contribution, 2);
  const flat = buildChainComparison(
    params,
    [row(params.baseline, 200), row(params.analysis, 300)],
    pay.map((p) => ({ ...p, gmv_usd: 300 })),
  );
  assert.ok(flat.factors.every((f) => f.contribution === null));
  assert.equal(flat.residual.contribution, null);
});
test('partial business weeks use the same observed weekdays on both sides', () => {
  const p = { ...params, mode: 'week', baseline: '2026-10-24', analysis: '2026-10-31' };
  const source = [row('2026-10-24', 200), row('2026-10-25', 1000), row('2026-10-31', 300)];
  const data = buildChainComparison(
    p,
    source,
    source.map((r) => ({ period: r.period, gmv_usd: r.gmv_usd })),
  );
  assert.deepEqual(data.dates, { baseline: ['2026-10-24'], analysis: ['2026-10-31'] });
  assert.equal(data.total.delta, 100);
});
test('renewal uses three factors and preserves result-vs-process difference', () => {
  const p = { ...params, chainType: 'renewal' };
  const rows = [
    { period: p.baseline, platform: 'web', expire_user_cnt: 100, renew_user_cnt: 50, renew_amount_usd: 200 },
    { period: p.analysis, platform: 'web', expire_user_cnt: 120, renew_user_cnt: 60, renew_amount_usd: 300 },
  ];
  const data = buildChainComparison(p, rows, pay);
  assert.equal(data.ready, true);
  assert.equal(data.factors.length, 3);
  close(data.factors.reduce((n, f) => n + f.effect, 0) + data.residual.effect, 110);
});
test('comparison parameters reject impossible dates, reversed dates, and non-Saturday weeks', () => {
  for (const query of [
    'baseline=2026-02-30&analysis=2026-03-10&mode=day',
    'baseline=2026-11-03&analysis=2026-10-27',
    'baseline=2026-10-27&analysis=2026-11-03',
  ])
    assert.throws(() => comparisonParams(new URLSearchParams(query)), /无效|周六/);
});
test('read queries keep the pay result scope and selected process source independent', async () => {
  const queries = [];
  await readChainComparison({ ...params, platform: 'all' }, async (sql, ...binds) => {
    queries.push({ sql, binds });
    return [];
  });
  assert.match(queries[0].sql, /pollo_da_chain_funnel/);
  assert.deepEqual(queries[0].binds.slice(-2), ['web', 'app']);
  assert.match(queries[1].sql, /attribution_type='NONE'/);
  assert.equal(queries[1].binds[1], 'all');
});

test('lifecycle parents aggregate atoms before rates and decompose independently of creation children', () => {
  const source = [
    row(params.baseline, 100, {
      user_lifecycle: 'NEW',
      active_uv: 100,
      paywall_expose_uv: 50,
      paywall_submit_uv: 20,
      pay_uv: 10,
    }),
    row(params.baseline, 300, {
      user_lifecycle: 'NEW',
      creation_cnt_30d_label: 'create_cnt_30d_[1,11)',
      active_uv: 900,
      paywall_expose_uv: 90,
      paywall_submit_uv: 30,
      pay_uv: 15,
    }),
    row(params.analysis, 240, {
      user_lifecycle: 'NEW',
      active_uv: 200,
      paywall_expose_uv: 120,
      paywall_submit_uv: 40,
      pay_uv: 20,
    }),
    row(params.analysis, 180, {
      user_lifecycle: 'NEW',
      creation_cnt_30d_label: 'create_cnt_30d_[1,11)',
      active_uv: 300,
      paywall_expose_uv: 30,
      paywall_submit_uv: 15,
      pay_uv: 10,
    }),
    row(params.baseline, 200),
    row(params.analysis, 250),
  ];
  const actual = buildChainComparison(params, source, [
    { period: params.baseline, gmv_usd: 650 },
    { period: params.analysis, gmv_usd: 720 },
  ]);
  assert.equal(actual.ready, true);
  assert.deepEqual(
    actual.lifecycleGroups.map((g) => g.key),
    ['NEW', 'OLD'],
  );
  const parent = actual.lifecycleGroups[0];
  close(parent.factors.find((f) => f.key === 'activeUv').baseline, 1000);
  close(parent.factors.find((f) => f.key === 'subExposeRate').baseline, 0.14);
  close(parent.factors.find((f) => f.key === 'subExposeRate').current, 0.3);
  close(
    parent.factors.reduce((n, f) => n + f.effect, 0),
    20,
  );
  close(
    parent.factors.find((f) => f.key === 'subExposeRate').contribution,
    parent.factors.find((f) => f.key === 'subExposeRate').effect / 70,
  );
  assert.notEqual(
    parent.factors.find((f) => f.key === 'subExposeRate').effect,
    actual.groups
      .filter((g) => g.key.endsWith(' × NEW'))
      .reduce((n, g) => n + g.factors.find((f) => f.key === 'subExposeRate').effect, 0),
  );
});

test('population selection recomputes own five factors, denominator and daily trend', () => {
  const source = [
    row(params.baseline, 200),
    row(params.analysis, 300),
    row(params.baseline, 50, { user_lifecycle: 'NEW', active_uv: 300 }),
    row(params.analysis, 40, { user_lifecycle: 'NEW', active_uv: 500 }),
  ];
  const scoped = buildChainComparison({ ...params, lifecycle: 'NEW' }, source, pay);
  assert.equal(scoped.ready, true);
  assert.equal(scoped.total.baseline, 50);
  assert.equal(scoped.total.current, 40);
  close(
    scoped.factors.reduce((n, f) => n + f.effect, 0),
    -10,
  );
  close(
    scoped.factors.reduce((n, f) => n + f.contribution, 0),
    1,
  );
  assert.equal(scoped.residual, null);
  assert.equal(scoped.factors[0].baseline, 300);
  assert.equal(scoped.factors[0].current, 500);
  assert.equal(scoped.trend.find((r) => r.date === params.analysis).values.activeUv, 500);
  assert.equal(scoped.lifecycleGroups.length, 2);
});
test('creation selection stays inside its selected lifecycle and cannot borrow another group', () => {
  const tier = 'create_cnt_30d_[1,11)';
  const source = [
    row(params.baseline, 200),
    row(params.analysis, 300),
    row(params.baseline, 30, { creation_cnt_30d_label: tier }),
    row(params.analysis, 70, { creation_cnt_30d_label: tier }),
  ];
  const scoped = buildChainComparison({ ...params, lifecycle: 'OLD', creationTier: tier }, source, pay);
  assert.equal(scoped.total.delta, 40);
  close(
    scoped.factors.reduce((n, f) => n + f.effect, 0),
    40,
  );
  assert.equal(buildChainComparison({ ...params, lifecycle: 'NEW' }, source, pay).ready, false);
  assert.throws(
    () =>
      comparisonParams(
        new URLSearchParams(
          'mode=day&baseline=2026-10-27&analysis=2026-11-03&creationTier=' + encodeURIComponent(tier),
        ),
      ),
    /注册人群/,
  );
});

test('device drilldown applies to process and pay queries, including renewal platform atoms', async () => {
  for (const chainType of ['active', 'renewal']) {
    const queries = [];
    await readChainComparison({ ...params, platform: 'app', deviceType: 'ios', chainType }, async (sql, ...binds) => {
      queries.push({ sql, binds });
      return [];
    });
    assert.match(queries[0].sql, chainType === 'active' ? /device_type = \?/ : /platform_type = \?/);
    assert.ok(queries[0].binds.includes(chainType === 'active' ? 'ios' : 'IOS'));
    assert.match(queries[1].sql, /device_type = \?/);
    assert.ok(queries[1].binds.includes('ios'));
  }
  for (const query of ['platform=web&deviceType=ios', 'platform=app&deviceType=invalid'])
    assert.throws(
      () => comparisonParams(new URLSearchParams('mode=day&baseline=2026-10-27&analysis=2026-11-03&' + query)),
      /无效/,
    );
});

test('sparse population drilldown inherits parent dates and daily means, including a missing platform stratum', () => {
  const p = { ...params, platform: 'all', mode: 'week', baseline: '2026-10-24', analysis: '2026-10-31' };
  const days = ['2026-10-24', '2026-10-25', '2026-10-31', '2026-11-01'];
  const rows = days.flatMap((day) => [row(day, 100), row(day, 100, { platform: 'app' })]);
  rows.push(
    row(days[0], 40, { user_lifecycle: 'NEW' }),
    row(days[2], 60, { user_lifecycle: 'NEW' }),
    row(days[3], 40, { user_lifecycle: 'NEW' }),
  );
  const payments = days.map((period) => ({
    period,
    gmv_usd: rows.filter((r) => r.period === period).reduce((s, r) => s + r.gmv_usd, 0),
  }));
  const full = buildChainComparison(p, rows, payments);
  const scoped = buildChainComparison({ ...p, lifecycle: 'NEW' }, rows, payments);
  const group = full.lifecycleGroups.find((g) => g.key === 'NEW');
  assert.equal(scoped.ready, true);
  assert.deepEqual(scoped.dates, full.dates);
  close(scoped.total.baseline, group.baseline);
  close(scoped.total.current, group.current);
  close(scoped.total.baseline, 20);
  close(scoped.total.current, 50);
  close(
    scoped.factors.reduce((s, f) => s + f.effect, 0),
    30,
  );
});

test('sparse renewal plan uses the parent matched day denominator', () => {
  const p = { ...params, mode: 'week', baseline: '2026-10-24', analysis: '2026-10-31', chainType: 'renewal' };
  const days = ['2026-10-24', '2026-10-25', '2026-10-31', '2026-11-01'];
  const atom = (period, plan_tier, renew_amount_usd) => ({
    period,
    platform: 'web',
    plan_tier,
    expire_user_cnt: 100,
    renew_user_cnt: 50,
    renew_amount_usd,
  });
  const rows = days.map((day) => atom(day, 'PRO', 100));
  rows.push(atom(days[0], 'LITE', 40), atom(days[2], 'LITE', 60), atom(days[3], 'LITE', 40));
  const payments = days.map((period) => ({
    period,
    gmv_usd: rows.filter((r) => r.period === period).reduce((s, r) => s + r.renew_amount_usd, 0),
  }));
  const full = buildChainComparison(p, rows, payments),
    scoped = buildChainComparison({ ...p, planTier: 'LITE' }, rows, payments);
  const group = full.groups.find((g) => g.key === 'LITE');
  assert.equal(scoped.ready, true);
  assert.deepEqual(scoped.dates, full.dates);
  close(scoped.total.baseline, group.baseline);
  close(scoped.total.current, group.current);
  close(
    scoped.factors.reduce((s, f) => s + f.effect, 0),
    30,
  );
});

test('stored unknown lifecycle labels use the API-supported UNKNOWN key', () => {
  const rows = [
    row(params.baseline, 40, { user_lifecycle: '未知' }),
    row(params.analysis, 70, { user_lifecycle: null }),
    row(params.baseline, 200),
    row(params.analysis, 300),
  ];
  const full = buildChainComparison(params, rows, pay);
  assert.equal(full.lifecycleGroups.find((g) => g.label === '未知').key, 'UNKNOWN');
  const selectedParams = comparisonParams(new URLSearchParams({ ...params, lifecycle: 'UNKNOWN' }));
  const scoped = buildChainComparison(selectedParams, rows, pay);
  assert.equal(scoped.ready, true);
  close(scoped.total.baseline, 40);
  close(scoped.total.current, 70);
});
