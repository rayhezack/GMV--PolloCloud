/** Reconcile frozen live atoms through the current Worker and Shapley code. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { readChainComparison } from '../worker/chain-comparison.ts';
import { decomposeRate } from '../shared/rate-attribution.ts';
import { paymentComposition, paymentChanges } from '../shared/home-attribution.ts';
import {
  registrationBreakdown,
  registrationDimensions,
} from '../client/src/components/dashboard/payment-registration.ts';

const [filename, outputDir] = process.argv.slice(2);
if (!filename || !outputDir)
  throw new Error(
    'Usage: node --experimental-strip-types scripts/audit-dashboard-accuracy.mjs snapshot.sqlite evidence-dir',
  );
const manifest = JSON.parse(readFileSync(filename.replace(/\.sqlite$/, '.manifest.json'), 'utf8'));
if (createHash('sha256').update(readFileSync(filename)).digest('hex') !== manifest.sha256)
  throw new Error('Snapshot hash mismatch');
const db = new DatabaseSync(filename, { readOnly: true });
const sql = (statement, ...args) => db.prepare(statement).all(...args);
const query = async (statement, ...args) => sql(statement, ...args);
const tables = Object.fromEntries(Object.keys(manifest.tables).map((t) => [t, sql(`SELECT * FROM ${t}`)]));
const checks = new Map(),
  warnings = [],
  residuals = [],
  unavailable = [];
if (!manifest.remoteRowCounts && manifest.rowCountContract !== 'per-query COUNT verified')
  throw new Error('Snapshot has no verified row-count contract');
function check(name, context, actual, expected, tolerance = 1e-8) {
  const result = checks.get(name) ?? { cases: 0, failures: 0, maxAbsoluteError: 0, samples: [] };
  result.cases++;
  const error = Math.abs(actual - expected);
  result.maxAbsoluteError = Math.max(result.maxAbsoluteError, Number.isFinite(error) ? error : 0);
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || error > tolerance) {
    result.failures++;
    if (result.samples.length < 8) result.samples.push({ context, actual, expected, error });
  }
  checks.set(name, result);
}
const sum = (rows, field) => rows.reduce((n, r) => n + Number(r[field] ?? 0), 0);
const key = (r, fields) => JSON.stringify(fields.map((f) => r[f] ?? 'UNKNOWN'));
function group(rows, fields) {
  const groups = new Map();
  for (const row of rows) {
    const k = key(row, fields);
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  return groups;
}
const shift = (day, n) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
const dates = Array.from({ length: (Date.parse(manifest.end) - Date.parse(manifest.start)) / 86400000 + 1 }, (_, i) =>
  shift(manifest.start, i),
);
for (const [table, rows] of Object.entries(tables)) {
  if (manifest.remoteRowCounts) check('snapshot_not_truncated', table, rows.length, manifest.remoteRowCounts[table], 0);
  for (const day of dates)
    check('source_date_coverage', `${table}/${day}`, Number(rows.some((r) => r.period === day)), 1, 0);
}
const facts = tables.pollo_da_fact_rows_read;
const payments = facts.filter((r) => r.dataset === 'pay_type' && r.pay_type !== '汇总');
for (const r of payments)
  check(
    'payment_valid_amount',
    key(r, ['period', 'platform', 'pay_type']),
    Number(r.gmv_usd != null && Number.isFinite(r.gmv_usd) && r.gmv_usd >= 0),
    1,
    0,
  );
const paymentGrain = [
  'period',
  'platform',
  'device_type',
  'pay_category',
  'pay_type',
  'product_type',
  'product_type_lv2',
];
for (const [k, rows] of group(payments, paymentGrain)) {
  const modes = group(rows, ['attribution_type']);
  check('payment_four_modes_present', k, modes.size, 4, 0);
  const reference = sum(
    rows.filter((r) => r.attribution_type === 'NONE'),
    'gmv_usd',
  );
  for (const [mode, entries] of modes)
    check('payment_mode_amount_conservation', `${k}/${mode}`, sum(entries, 'gmv_usd'), reference, 1e-7);
}
for (const [k, rows] of group(payments, paymentGrain.filter((f) => f !== 'platform').concat('attribution_type'))) {
  check(
    'payment_platform_conservation',
    k,
    sum(
      rows.filter((r) => r.platform === 'all'),
      'gmv_usd',
    ),
    sum(
      rows.filter((r) => r.platform !== 'all'),
      'gmv_usd',
    ),
    1e-7,
  );
}
const registration = tables.pollo_da_payment_registration;
for (const scope of [
  { platform: 'all' },
  { platform: 'web' },
  { platform: 'app' },
  { platform: 'app', deviceType: 'ios' },
  { platform: 'app', deviceType: 'android' },
]) {
  const points = dates.map((period) => {
    const rows = payments.filter(
      (r) =>
        r.period === period &&
        r.platform === scope.platform &&
        r.attribution_type === 'NONE' &&
        (!scope.deviceType || r.device_type === scope.deviceType),
    );
    const totalPayTypeGmv = Object.fromEntries(
      [...group(rows, ['pay_type'])].map(([, g]) => [g[0].pay_type, sum(g, 'gmv_usd')]),
    );
    return { period, totalGmv: sum(rows, 'gmv_usd'), totalPayTypeGmv };
  });
  for (const point of points) {
    const composition = paymentComposition(point);
    check(
      'home_daily_composition',
      JSON.stringify({ ...scope, period: point.period }),
      composition?.items.reduce((s, r) => s + r.amount, 0) ?? NaN,
      point.totalGmv,
      1e-7,
    );
  }
  for (let i = 7; i < points.length; i++)
    check(
      'home_category_delta',
      JSON.stringify({ ...scope, period: points[i].period }),
      paymentChanges(points[i], points[i - 7]).reduce((s, r) => s + r.amount, 0),
      points[i].totalGmv - points[i - 7].totalGmv,
      1e-7,
    );
}
const moneyKeys = ['period', 'device_type', 'pay_type'];
const parents = group(
  payments.filter((r) => r.attribution_type === 'NONE' && r.platform === 'all'),
  moneyKeys,
);
const children = group(registration, moneyKeys);
for (const k of new Set([...parents.keys(), ...children.keys()])) {
  check(
    'payment_registration_conservation',
    k,
    sum(children.get(k) ?? [], 'gmv_usd'),
    sum(parents.get(k) ?? [], 'gmv_usd'),
    1e-6,
  );
}
const funnel = tables.pollo_da_chain_funnel,
  breakdown = tables.pollo_da_chain_breakdown;
const chainKeys = ['period', 'platform', 'device_type', 'country_tier', 'user_lifecycle', 'creation_cnt_30d_label'];
const chainParents = group(funnel, chainKeys);
const chainChildren = group(breakdown, chainKeys);
for (const [k, entries] of chainChildren) check('chain_no_orphan_breakdown', k, Number(chainParents.has(k)), 1, 0);
for (const [k, rows] of chainParents) {
  check('chain_unique_parent', k, rows.length, 1, 0);
  for (const type of ['EXPOSE_TYPE', 'EXPOSE_REASON', 'SUBMIT_CHANNEL', 'PAYMENT_CHANNEL']) {
    const entries = (chainChildren.get(k) ?? []).filter((r) => r.breakdown_type === type);
    for (const field of ['gmv_usd', 'pay_uv'])
      check(
        'chain_source_partition',
        `${k}/${type}/${field}`,
        sum(entries, field),
        sum(rows, field),
        field === 'gmv_usd' ? 1e-7 : 0,
      );
    if (type.startsWith('EXPOSE_'))
      check(
        'chain_source_partition',
        `${k}/${type}/exposure`,
        sum(entries, 'expose_uv'),
        sum(rows, 'paywall_expose_uv'),
        0,
      );
    if (type === 'SUBMIT_CHANNEL')
      check(
        'chain_source_partition',
        `${k}/${type}/submission`,
        sum(entries, 'submit_uv'),
        sum(rows, 'paywall_submit_uv'),
        0,
      );
  }
}
for (const r of funnel) {
  for (const field of ['active_uv', 'paywall_expose_uv', 'paywall_submit_uv', 'pay_uv', 'gmv_usd'])
    check(
      'chain_valid_atoms',
      `${key(r, chainKeys)}/${field}`,
      Number(r[field] != null && Number.isFinite(r[field]) && r[field] >= 0),
      1,
      0,
    );
}
const creativeFields = [
  'creation_task_cnt',
  'valid_creation_task_cnt',
  'success_task_cnt',
  'success_output_cnt',
  'adopted_task_cnt',
  'adopted_output_cnt',
  'gmv_usd',
];
const creativeParents = group(tables.pollo_da_creation_overall_daily, ['period', 'platform_type']);
const creativeChildren = group(tables.pollo_da_creation_function_daily, ['period', 'platform_type']);
for (const k of new Set([...creativeParents.keys(), ...creativeChildren.keys()])) {
  for (const field of creativeFields)
    check(
      'creative_additive_conservation',
      `${k}/${field}`,
      sum(creativeChildren.get(k) ?? [], field),
      sum(creativeParents.get(k) ?? [], field),
      field === 'gmv_usd' ? 1e-6 : 0,
    );
}

function warehouse(name) {
  const path = join(outputDir, `warehouse-${name}.json`);
  if (!existsSync(path)) throw new Error(`Missing independent warehouse evidence: ${path}`);
  const payload = JSON.parse(readFileSync(path, 'utf8'));
  if (!payload.success || payload.truncated || !payload.data?.length || payload.data.length !== payload.rowCount)
    throw new Error(`Incomplete warehouse result: ${name}`);
  return payload.data;
}
function parity(name, stored, upstream, dimensions, fields) {
  const left = group(stored, dimensions),
    right = group(upstream, dimensions);
  for (const k of new Set([...left.keys(), ...right.keys()])) {
    check(`warehouse_${name}_key_coverage`, k, Number(left.has(k) && right.has(k)), 1, 0);
    for (const field of fields)
      check(
        `warehouse_${name}_parity`,
        `${k}/${field}`,
        sum(left.get(k) ?? [], field),
        sum(right.get(k) ?? [], field),
        /gmv|cost|amount/.test(field) ? 1e-6 : 1e-8,
      );
  }
}
parity(
  'payment',
  payments.filter((r) => r.platform === 'all'),
  warehouse('payment'),
  ['period', 'device_type', 'attribution_type'],
  ['gmv_usd', 'order_equivalent'],
);
const upstreamChain = warehouse('chain');
parity(
  'chain_funnel',
  funnel,
  upstreamChain.filter((r) => r.source_kind === 'funnel'),
  ['period', 'platform', 'device_type'],
  ['active_uv', 'paywall_expose_uv', 'paywall_submit_uv', 'pay_uv', 'gmv_usd'],
);
parity(
  'chain_breakdown',
  breakdown,
  upstreamChain.filter((r) => r.source_kind === 'breakdown'),
  ['period', 'platform', 'device_type', 'breakdown_type'],
  ['expose_uv', 'submit_uv', 'pay_uv', 'gmv_usd'],
);
parity(
  'ads',
  tables.pollo_da_ads_daily.map((r) => ({ ...r, platform: String(r.platform).toUpperCase() })),
  warehouse('ads'),
  ['period', 'platform'],
  ['cost_usd', 'impressions', 'clicks', 'register_user_cnt', 'gmv_d0'],
);
const upstreamCreative = warehouse('creative');
for (const kind of ['overall', 'function'])
  parity(
    `creative_${kind}`,
    tables[`pollo_da_creation_${kind}_daily`],
    upstreamCreative.filter((r) => r.source_kind === kind),
    ['period', 'platform_type'],
    creativeFields,
  );

// Run the actual current API in a local process with a read-only DB adapter.
// Cache persistence is explicitly disabled; no sync/report routes are invoked.
const directory = mkdtempSync(join(tmpdir(), 'accuracy-worker-'));
buildSync({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(directory, 'worker.mjs'),
  logLevel: 'silent',
});
const { default: worker } = await import(pathToFileURL(join(directory, 'worker.mjs')).href);
const adapter = {
  prepare(statement) {
    let args = [];
    return {
      bind(...a) {
        args = a;
        return this;
      },
      async all() {
        return { results: sql(statement, ...args) };
      },
      async first() {
        return sql(statement, ...args)[0] ?? null;
      },
      async run() {
        throw new Error('Accuracy snapshot is read-only');
      },
    };
  },
};
async function api(endpoint, params) {
  const response = await worker.fetch(
    new Request(`https://audit.invalid/api/dashboard/${endpoint}?${new URLSearchParams(params)}`),
    { DB: adapter },
    {
      waitUntil(p) {
        p.catch(() => {});
      },
    },
  );
  const data = await response.json();
  check('api_http_success', endpoint, response.status, 200, 0);
  return data;
}
const scopes = [
  { platform: 'all' },
  { platform: 'web' },
  { platform: 'app' },
  { platform: 'app', deviceType: 'ios' },
  { platform: 'app', deviceType: 'android' },
];
for (const scope of scopes) {
  const data = await api('payment-analysis', {
    ...scope,
    baselinePeriod: '2026-11-07',
    analysisPeriod: '2026-11-14',
    attributionType: 'NONE',
  });
  check('payment_api_comparison_available', JSON.stringify(scope), Number(Boolean(data.comparison)), 1, 0);
  if (!data.comparison) continue;
  const comparison = data.comparison;
  const offsets = (week) =>
    new Set(
      data.revenues
        .filter((r) => r.weekStart === week)
        .map((r) => (Date.parse(r.period) - Date.parse(week)) / 86400000),
    );
  const b = offsets(comparison.baselinePeriod),
    a = offsets(comparison.analysisPeriod);
  const matched = [...a].filter((offset) => b.has(offset));
  for (const type of new Set(data.revenues.map((r) => r.payType))) {
    for (const dimension of registrationDimensions(type)) {
      const entries = registrationBreakdown(data, type, dimension);
      const context = JSON.stringify({ ...scope, type, dimension });
      check('payment_api_drilldown_verified', context, Number(Boolean(entries)), 1, 0);
      if (!entries) continue;
      for (const side of ['baseline', 'analysis']) {
        const week = comparison[`${side}Period`];
        const total =
          data.revenues
            .filter(
              (r) =>
                r.payType === type &&
                r.weekStart === week &&
                matched.includes((Date.parse(r.period) - Date.parse(week)) / 86400000),
            )
            .reduce((s, r) => s + r.gmvUsd, 0) / matched.length;
        check('payment_ui_drilldown_conservation', `${context}/${side}`, sum(entries, side), total, 1e-7);
      }
    }
  }
}
const windows = [
  ...dates.slice(7).map((analysis) => ({ mode: 'day', baseline: shift(analysis, -7), analysis })),
  { mode: 'week', baseline: '2026-11-07', analysis: '2026-11-14' },
  { mode: 'week', baseline: '2026-11-14', analysis: '2026-11-21' },
];
for (const scope of scopes)
  for (const chainType of ['active', 'renewal'])
    for (const window of windows) {
      const params = { ...scope, chainType, ...window };
      const context = JSON.stringify(params);
      const data = await readChainComparison(params, query);
      if (!data.ready) {
        unavailable.push({ context, reason: data.reason });
        continue;
      }
      const effects = data.factors.reduce((n, f) => n + f.effect, 0);
      const atomField = chainType === 'active' ? 'gmv_usd' : 'renew_amount_usd';
      const rows =
        chainType === 'active'
          ? funnel.filter(
              (r) =>
                (scope.platform === 'all' || r.platform === scope.platform) &&
                (!scope.deviceType || r.device_type === scope.deviceType),
            )
          : facts.filter(
              (r) =>
                r.dataset === 'renewal' &&
                (scope.platform === 'all' ? ['web', 'app'].includes(r.platform) : r.platform === scope.platform) &&
                (scope.deviceType
                  ? r.platform_type === scope.deviceType.toUpperCase()
                  : r.platform_type === (r.platform === 'web' ? 'WEB' : 'APP')),
            );
      const amount = (side) =>
        sum(
          rows.filter((r) => data.dates[side].includes(r.period)),
          atomField,
        ) / data.dates[side].length;
      check('lmdi_process_delta', context, effects, amount('analysis') - amount('baseline'), 1e-7);
      check(
        'lmdi_result_delta_with_explicit_residual',
        context,
        effects + data.residual.effect,
        data.total.delta,
        1e-7,
      );
      for (const side of ['baseline', 'current']) {
        const product = data.factors.reduce((n, f) => n * f[side], 1);
        check(
          'chain_factor_product_identity',
          `${context}/${side}`,
          product,
          amount(side === 'baseline' ? 'baseline' : 'analysis'),
          1e-7,
        );
        check(
          'chain_dimension_gmv',
          `${context}/${side}`,
          data.groups.reduce((n, g) => n + g[side], 0),
          product,
          1e-7,
        );
        if (chainType === 'active')
          check(
            'chain_lifecycle_gmv',
            `${context}/${side}`,
            data.lifecycleGroups.reduce((n, g) => n + g[side], 0),
            product,
            1e-7,
          );
      }
      residuals.push({
        params,
        dates: data.dates,
        resultDelta: data.total.delta,
        processDelta: effects,
        residual: data.residual,
      });
      const groups = chainType === 'active' ? data.lifecycleGroups : data.groups;
      for (const g of groups) {
        const endpoint = await api('chain-comparison', {
          ...params,
          ...(chainType === 'active' ? { lifecycle: g.key } : { planTier: g.key }),
        });
        check('selected_group_api_accepts_key', `${context}/${g.key}`, Number(!endpoint.error), 1, 0);
        const selected = await readChainComparison(
          { ...params, ...(chainType === 'active' ? { lifecycle: g.key } : { planTier: g.key }) },
          query,
        );
        if (!selected.ready) {
          unavailable.push({ context: `${context}/${g.key}`, reason: selected.reason });
          continue;
        }
        for (const side of ['baseline', 'current'])
          check(
            'selected_group_matches_parent_row',
            `${context}/${g.key}/${side}`,
            selected.total[side],
            g[side],
            1e-7,
          );
        check(
          'selected_group_effects',
          `${context}/${g.key}`,
          selected.factors.reduce((n, f) => n + f.effect, 0),
          g.current - g.baseline,
          1e-7,
        );
      }
    }
for (const scope of scopes)
  for (const pair of [
    ['2026-11-07', '2026-11-14'],
    ['2026-11-14', '2026-11-21'],
  ]) {
    const base = {
      ...scope,
      startDate: manifest.start,
      endDate: manifest.end,
      baselinePeriod: pair[0],
      analysisPeriod: pair[1],
    };
    const root = await api('chain-funnel', base);
    check('chain_funnel_api_ready', JSON.stringify(base), Number(root.ready), 1, 0);
    if (!root.ready) continue;
    const populations = [{}, ...root.lifecycles.map((g) => ({ userLifecycle: g.key }))];
    for (const population of populations) {
      const data = Object.keys(population).length ? await api('chain-funnel', { ...base, ...population }) : root;
      if (!data.ready) {
        unavailable.push({ context: JSON.stringify({ ...base, ...population }), reason: 'chain-funnel not ready' });
        continue;
      }
      for (const [dimension, entries] of Object.entries({
        country: data.countries,
        channel: data.breakdowns.SUBMIT_CHANNEL,
      })) {
        for (const metric of dimension === 'channel' ? ['pay'] : ['pay', 'submit']) {
          const atom = (v) => ({
            numerator: v[metric === 'pay' ? 'payUv' : 'submitUv'],
            denominator: v[metric === 'pay' ? 'submitUv' : 'exposeUv'],
          });
          const result = decomposeRate(
            entries.map((r) => ({ key: r.key, label: r.label, baseline: atom(r.baseline), current: atom(r.current) })),
            { baseline: atom(data.totals.baseline), current: atom(data.totals.current) },
            { separateUnresolved: true },
          );
          const context = JSON.stringify({ ...base, ...population, dimension, metric });
          if (!result.valid) {
            unavailable.push({ context, reason: result.reason });
            continue;
          }
          check(
            'shapley_api_rate_conservation',
            context,
            result.structure + result.efficiency + result.unresolved,
            result.delta,
            1e-12,
          );
          check('shapley_two_factor_only', context, result.structure + result.efficiency, result.delta, 1e-12);
          if (Math.abs(result.unresolved) > 1e-12)
            warnings.push({
              type: 'shapley_unresolved',
              context,
              deltaPp: result.delta * 100,
              structurePp: result.structure * 100,
              efficiencyPp: result.efficiency * 100,
              unresolvedPp: result.unresolved * 100,
              undefinedGroups: result.groups
                .filter((g) => g.absent)
                .map((g) => ({
                  key: g.key,
                  baseline: g.baseline,
                  current: g.current,
                  unresolvedPp: g.unresolvedEffect * 100,
                })),
            });
        }
      }
      for (const dimension of ['countries', 'lifecycles', 'tiers'])
        for (const side of ['baseline', 'current'])
          for (const field of ['activeUv', 'exposeUv', 'submitUv', 'payUv', 'gmvUsd'])
            check(
              'chain_funnel_api_dimension',
              JSON.stringify({ ...base, ...population, dimension, side, field }),
              sum(
                data[dimension].map((r) => r[side]),
                field,
              ),
              data.totals[side][field],
              1e-7,
            );
    }
  }
for (const platform of ['all', 'web', 'app']) {
  const params = {
    platform,
    startDate: manifest.start,
    endDate: manifest.end,
    baselinePeriod: '2026-11-07',
    analysisPeriod: '2026-11-14',
  };
  const data = await api('ads-overview', params);
  check('ads_api_ready', platform, Number(data.ready), 1, 0);
  if (!data.ready) continue;
  for (const dimension of ['countries', 'channels'])
    for (const side of ['baseline', 'current'])
      for (const field of ['impressions', 'clicks', 'registerUsers', 'costUsd', 'gmvD0'])
        check(
          'ads_api_additive_conservation',
          `${platform}/${dimension}/${side}/${field}`,
          sum(
            data[dimension].map((r) => r[side]),
            field,
          ),
          data.totals[side][field],
          1e-6,
        );
  for (const point of data.trend) {
    for (const horizon of [0, 14, 30, 60, 90, 180]) {
      const age = (Date.parse(data.observedThrough) - Date.parse(point.period)) / 86400000;
      if (age < horizon)
        check(
          'ads_immature_ltv_hidden',
          `${platform}/${point.period}/D${horizon}`,
          Number(point.ltvByHorizon[`D${horizon}`] === null),
          1,
          0,
        );
    }
  }
  for (const side of ['baseline', 'current']) {
    const a = data.totals[side];
    check('ads_weighted_ctr', `${platform}/${side}`, a.ctr, a.clicks / a.impressions, 1e-12);
    check('ads_weighted_cpc', `${platform}/${side}`, a.cpc, a.costUsd / a.clicks, 1e-12);
  }
}
const summary = {
  source: manifest,
  generatedAt: new Date().toISOString(),
  codeSha256: Object.fromEntries(
    [
      'worker/index.ts',
      'worker/chain-comparison.ts',
      'worker/chain-attribution.ts',
      'shared/rate-attribution.ts',
      'shared/home-attribution.ts',
      'client/src/components/dashboard/payment-registration.ts',
      'scripts/audit-dashboard-accuracy.mjs',
    ].map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
  ),
  checks: Object.fromEntries(checks),
  failureCount: [...checks.values()].reduce((n, c) => n + c.failures, 0),
  caseCount: [...checks.values()].reduce((n, c) => n + c.cases, 0),
  warnings,
  unavailable,
  residuals,
  limitations: [
    'Warehouse parity covers daily platform/device atoms; registration/SKU joins are reconciled to stored payment results, not independently rebuilt from all historical orders.',
    'Payment capture aggregates model allocations at product grain; individual model-name/provider allocations and payment UV are not preserved.',
    'Business-week 11/07–11/13 is limited to captured 11/08–11/13; matched weekdays only. No absent day is represented as a complete week.',
  ],
};
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'results.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      cases: summary.caseCount,
      failures: summary.failureCount,
      checks: summary.checks,
      unavailable: unavailable.length,
      warnings: warnings.length,
    },
    null,
    2,
  ),
);
db.close();
rmSync(directory, { recursive: true, force: true });
process.exitCode = summary.failureCount ? 1 : 0;
