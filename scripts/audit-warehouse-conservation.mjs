/** Source-only conservation review. Never opens a dashboard database or uses cached dashboard values. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { lmdiDriverEffects } from '../worker/chain-attribution.ts';
import { decomposeRate } from '../shared/rate-attribution.ts';
const dir = process.argv[2] || 'design-review/warehouse-conservation-2026-11-22';
const sources = Object.fromEntries(
  [
    'chain',
    'payment-orders',
    'payment-attribution',
    'ads',
    'creative',
    'renewal',
    'payment-transitions',
    'model-cost',
  ].map((name) => {
    const p = JSON.parse(readFileSync(`${dir}/${name}.json`));
    const sha = createHash('sha256')
      .update(readFileSync(`${dir}/${name}.sql`, 'utf8').trim())
      .digest('hex');
    if (
      sha !== p.sqlSha256 ||
      p.rowCount !== p.data.length ||
      !p.sqlRowCountVerified ||
      p.data.some((r) => Number(r.source_row_count) !== p.rowCount)
    )
      throw Error(`Incomplete or mismatched fresh evidence: ${name}`);
    return [name, p];
  }),
);
const checks = {},
  failures = [],
  exceptions = [],
  samples = [],
  gmvScopeDifferences = [],
  uvOverlaps = [],
  lmdiRecords = [],
  shapleyRecords = [],
  checkLines = ['check,context,actual,expected,difference,tolerance,status\n'];
const csv = (x) => JSON.stringify(String(x ?? ''));
const lmdiStats = { active: { calculated: 0, undefined: 0 }, renewal: { calculated: 0, undefined: 0 } };
const number = (x) => (x == null ? 0 : Number(x));
const sum = (rows, field) => rows.reduce((a, r) => a + number(r[field]), 0);
const key = (row, fields) => JSON.stringify(fields.map((f) => row[f] ?? 'UNKNOWN'));
const group = (rows, fields) => {
  const map = new Map();
  for (const r of rows) {
    const k = key(r, fields);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
};
const eq = (name, context, actual, expected, tolerance = 1e-7) => {
  const item = (checks[name] ??= { cases: 0, failures: 0, maxAbsoluteError: 0 });
  item.cases++;
  const err = Math.abs(actual - expected);
  if (Number.isFinite(err)) item.maxAbsoluteError = Math.max(item.maxAbsoluteError, err);
  checkLines.push(
    [
      name,
      context,
      actual,
      expected,
      actual - expected,
      tolerance,
      Number.isFinite(err) && err <= tolerance ? 'PASS' : 'DIFFERENCE',
    ]
      .map(csv)
      .join(',') + '\n',
  );
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || err > tolerance) {
    item.failures++;
    failures.push({ name, context, actual, expected, error: err });
  }
};
const dates = Array.from({ length: 14 }, (_, i) => `2026-11-${String(i + 8).padStart(2, '0')}`);
for (const [name, p] of Object.entries(sources))
  for (const date of dates) eq('date_coverage', `${name}/${date}`, Number(p.data.some((r) => r.period === date)), 1, 0);
const chain = sources.chain.data,
  roots = chain.filter((r) => r.dimension === 'parent');
const atoms = ['active_uv', 'expose_uv', 'submit_uv', 'pay_uv', 'gmv_usd'];
for (const root of roots) {
  const rows = chain.filter((r) => r.period === root.period && r.scope === root.scope);
  for (const dimension of ['country', 'lifecycle', 'creation', 'device', 'full'])
    for (const f of atoms)
      eq(
        'chain_dimension_partition',
        `${root.period}/${root.scope}/${dimension}/${f}`,
        sum(
          rows.filter((r) => r.dimension === dimension),
          f,
        ),
        number(root[f]),
        f === 'gmv_usd' ? 1e-7 : 0,
      );
  for (const [d, fields] of [
    ['expose_type', ['expose_uv', 'pay_uv', 'gmv_usd']],
    ['expose_reason', ['expose_uv', 'pay_uv', 'gmv_usd']],
    ['submit_channel', ['submit_uv', 'pay_uv', 'gmv_usd']],
    ['payment_channel', ['pay_uv', 'gmv_usd']],
  ])
    for (const f of fields)
      eq(
        'chain_event_dimension_partition',
        `${root.period}/${root.scope}/${d}/${f}`,
        sum(
          rows.filter((r) => r.dimension === d),
          f,
        ),
        number(root[f]),
        f === 'gmv_usd' ? 1e-7 : 0,
      );
  for (const life of rows.filter((r) => r.dimension === 'lifecycle'))
    for (const d of ['country_lifecycle', 'creation_lifecycle', 'submit_channel_lifecycle'])
      for (const f of d.startsWith('submit') ? ['submit_uv', 'pay_uv', 'gmv_usd'] : atoms)
        eq(
          'chain_nested_partition',
          `${root.period}/${root.scope}/${life.key1}/${d}/${f}`,
          sum(
            rows.filter((r) => r.dimension === d && r.key2 === life.key1),
            f,
          ),
          number(life[f]),
          f === 'gmv_usd' ? 1e-7 : 0,
        );
}
for (const day of dates)
  for (const f of atoms) {
    const entries = roots.filter((r) => r.period === day);
    eq(
      'chain_platform_partition',
      `${day}/${f}`,
      sum(
        entries.filter((r) => ['web', 'app'].includes(r.scope)),
        f,
      ),
      sum(
        entries.filter((r) => r.scope === 'all'),
        f,
      ),
      f === 'gmv_usd' ? 1e-7 : 0,
    );
  }

const orders = sources['payment-orders'].data,
  attribution = sources['payment-attribution'].data;
const orderRoots = orders.filter((r) => r.dimension === 'parent');
for (const root of orderRoots) {
  const rows = orders.filter((r) => r.period === root.period && r.device_type === root.device_type);
  for (const f of ['gmv_usd', 'order_count'])
    eq(
      'payment_order_pay_type',
      `${root.period}/${root.device_type}/${f}`,
      sum(
        rows.filter((r) => r.dimension === 'pay_type'),
        f,
      ),
      number(root[f]),
      f === 'gmv_usd' ? 1e-7 : 0,
    );
  for (const type of rows.filter((r) => r.dimension === 'pay_type'))
    for (const dim of [
      'user_lifecycle',
      'country_tier',
      'reg_platform',
      'sku',
      'plan_tier',
      'plan_cycle',
      'credit_amount',
    ])
      for (const f of ['gmv_usd', 'order_count'])
        eq(
          'payment_order_nested_dimensions',
          `${root.period}/${root.device_type}/${type.key1}/${dim}/${f}`,
          sum(
            rows.filter((r) => r.dimension === dim && r.parent_type === type.key1),
            f,
          ),
          number(type[f]),
          f === 'gmv_usd' ? 1e-7 : 0,
        );
}
const attRoots = attribution.filter((r) => r.dimension === 'parent');
for (const root of attRoots) {
  const rows = attribution.filter(
    (r) =>
      r.period === root.period && r.device_type === root.device_type && r.attribution_type === root.attribution_type,
  );
  const context = `${root.period}/${root.device_type}/${root.attribution_type}`;
  for (const f of ['gmv_usd', 'order_equivalent'])
    eq(
      'payment_attribution_pay_type',
      `${context}/${f}`,
      sum(
        rows.filter((r) => r.dimension === 'pay_type'),
        f,
      ),
      number(root[f]),
    );
  for (const type of rows.filter((r) => r.dimension === 'pay_type'))
    for (const dim of ['attribution_name', 'actual_supplier', 'actual_provider', 'product_type', 'product_type_lv2'])
      for (const f of ['gmv_usd', 'order_equivalent'])
        eq(
          'payment_attribution_nested_dimensions',
          `${context}/${type.key1}/${dim}/${f}`,
          sum(
            rows.filter((r) => r.dimension === dim && r.parent_type === type.key1),
            f,
          ),
          number(type[f]),
        );
}
for (const [k, rows] of group(attRoots, ['period', 'device_type'])) {
  eq('payment_attribution_modes_present', k, rows.length, 4, 0);
  const order = orderRoots.find((r) => r.period === rows[0].period && r.device_type === rows[0].device_type);
  const ref = rows.find((r) => r.attribution_type === 'NONE');
  for (const r of rows) {
    eq('payment_four_mode_gmv', `${k}/${r.attribution_type}`, number(r.gmv_usd), number(ref?.gmv_usd));
    eq(
      'payment_four_mode_orders',
      `${k}/${r.attribution_type}`,
      number(r.order_equivalent),
      number(ref?.order_equivalent),
    );
    if (order) {
      eq('warehouse_ads_vs_dwd_payment_gmv', `${k}/${r.attribution_type}`, number(r.gmv_usd), number(order.gmv_usd));
      eq(
        'warehouse_ads_vs_dwd_payment_orders',
        `${k}/${r.attribution_type}`,
        number(r.order_equivalent),
        number(order.order_count),
      );
    }
  }
}

const ads = sources.ads.data;
const adFields = [
  'cost_usd',
  'impressions',
  'clicks',
  'register_user_cnt',
  'gmv_d0',
  'gmv_d14',
  'gmv_d30',
  'gmv_d60',
  'gmv_d90',
  'gmv_d180',
];
for (const root of ads.filter((r) => r.dimension === 'parent')) {
  const rows = ads.filter((r) => r.period === root.period && r.platform === root.platform);
  for (const dim of ['country', 'channel', 'country_channel'])
    for (const f of adFields) {
      const children = rows.filter((r) => r.dimension === dim);
      eq(
        'ads_dimension_partition',
        `${root.period}/${root.platform}/${dim}/${f}`,
        sum(children, f),
        number(root[f]),
        ['impressions', 'clicks', 'register_user_cnt'].includes(f) ? 0 : 1e-6,
      );
    }
  for (const country of rows.filter((r) => r.dimension === 'country'))
    for (const f of adFields)
      eq(
        'ads_country_channel_partition',
        `${root.period}/${root.platform}/${country.key1}/${f}`,
        sum(
          rows.filter((r) => r.dimension === 'country_channel' && r.key1 === country.key1),
          f,
        ),
        number(country[f]),
        ['impressions', 'clicks', 'register_user_cnt'].includes(f) ? 0 : 1e-6,
      );
  // Derived ratios use a common denominator, not a mean or sum of country rates.
  for (const [metric, n, d] of [
    ['CTR', 'clicks', 'impressions'],
    ['CPC', 'cost_usd', 'clicks'],
    ['CAC', 'cost_usd', 'register_user_cnt'],
    ['D0 LTV', 'gmv_d0', 'register_user_cnt'],
    ['D0 ROAS', 'gmv_d0', 'cost_usd'],
  ])
    if (number(root[d]) > 0) {
      const entries = rows.filter((r) => r.dimension === 'country');
      const weighted = entries.reduce((v, r) => v + number(r[n]) / number(root[d]), 0);
      eq(
        'ads_derived_ratio_reaggregation',
        `${root.period}/${root.platform}/${metric}`,
        weighted,
        number(root[n]) / number(root[d]),
        1e-12,
      );
    }
}

const creative = sources.creative.data,
  summary = '汇总';
const creativeDims = ['creation_mode', 'user_type', 'pay_gmv_usd_30d'];
const additiveCreation = [
  'creation_task_cnt',
  'valid_creation_task_cnt',
  'success_task_cnt',
  'success_output_cnt',
  'adopted_task_cnt',
  'adopted_output_cnt',
  'gmv_usd',
];
const cube = (name, rows, dimensions, fields, uvFields = []) => {
  const indexes = Object.fromEntries(
    dimensions.map((d) => [
      d,
      group(
        rows,
        dimensions.filter((f) => f !== d),
      ),
    ]),
  );
  for (const parent of rows)
    for (const d of dimensions)
      if (parent[d] === summary) {
        const entries =
          indexes[d].get(
            key(
              parent,
              dimensions.filter((f) => f !== d),
            ),
          ) ?? [];
        const children = entries.filter((r) => r[d] !== summary);
        if (!children.length) {
          exceptions.push({ type: `${name}_no_child_rows`, period: parent.period, dimension: d, parent });
          continue;
        }
        const context = key(parent, ['period', 'platform_type', ...dimensions]) + `/${d}`;
        for (const f of fields) {
          if (name === 'renewal' && f !== 'gmv_usd') {
            const parentUv = number(parent[f]),
              childSum = sum(children, f),
              maxChild = Math.max(...children.map((r) => number(r[f])));
            eq(
              'renewal_uv_union_bounds',
              `${context}/${f}`,
              Number(maxChild <= parentUv && parentUv <= childSum),
              1,
              0,
            );
            if (childSum !== parentUv)
              uvOverlaps.push({ context, field: f, parentUv, childSum, overlap: childSum - parentUv });
          } else
            eq(
              `${name}_native_summary_vs_detail`,
              `${context}/${f}`,
              sum(children, f),
              number(parent[f]),
              f === 'gmv_usd' ? 1e-6 : 0,
            );
        }
        // NEW/OLD and spend tiers are disjoint within fixed function; functions themselves have overlapping UV.
        if (name === 'creative' && d !== 'creation_mode')
          for (const f of uvFields)
            if (parent[f] != null && children.every((r) => r[f] != null))
              eq('creative_disjoint_uv_partition', `${context}/${f}`, sum(children, f), number(parent[f]), 0);
      }
};
// Group each day/platform cube independently so detail is never added to its own summary.
for (const [, rows] of group(creative, ['period', 'platform_type']))
  cube('creative', rows, creativeDims, additiveCreation, [
    'creation_user_cnt',
    'd3_creation_user_cnt',
    'd7_creation_user_cnt',
    'd30_creation_user_cnt',
  ]);
for (const [, rows] of group(creative, ['period', 'creation_mode', 'user_type', 'pay_gmv_usd_30d'])) {
  const parent = rows.find((r) => r.platform_type === summary);
  if (!parent) continue;
  for (const f of additiveCreation)
    eq(
      'creative_platform_summary',
      `${key(parent, ['period', 'creation_mode', 'user_type', 'pay_gmv_usd_30d'])}/${f}`,
      sum(
        rows.filter((r) => r.platform_type !== summary),
        f,
      ),
      number(parent[f]),
      f === 'gmv_usd' ? 1e-6 : 0,
    );
}
const renewal = sources.renewal.data;
for (const [, rows] of group(renewal, ['period', 'platform_type']))
  cube(
    'renewal',
    rows,
    ['plan_tier', 'plan_cycle', 'borderline_tag'],
    ['expire_user_cnt', 'renew_user_cnt', 'gmv_usd'],
  );
for (const [, rows] of group(renewal, ['period', 'plan_tier', 'plan_cycle', 'borderline_tag'])) {
  const parent = rows.find((r) => r.platform_type === summary),
    app = rows.find((r) => r.platform_type === 'APP');
  if (parent)
    for (const f of ['expire_user_cnt', 'renew_user_cnt', 'gmv_usd']) {
      const children = rows.filter((r) => ['WEB', 'APP', '未知'].includes(r.platform_type));
      const context = key(parent, ['period', 'plan_tier', 'plan_cycle', 'borderline_tag']) + `/${f}`;
      if (f === 'gmv_usd') eq('renewal_platform_gmv_summary', context, sum(children, f), number(parent[f]), 1e-6);
      else {
        const childSum = sum(children, f),
          parentUv = number(parent[f]);
        eq(
          'renewal_platform_uv_union_bounds',
          context,
          Number(Math.max(...children.map((r) => number(r[f]))) <= parentUv && parentUv <= childSum),
          1,
          0,
        );
        if (childSum !== parentUv)
          uvOverlaps.push({ context, field: f, parentUv, childSum, overlap: childSum - parentUv });
      }
    }
  if (app)
    for (const f of ['expire_user_cnt', 'renew_user_cnt', 'gmv_usd'])
      eq(
        'renewal_app_device_summary',
        `${key(app, ['period', 'plan_tier', 'plan_cycle', 'borderline_tag'])}/${f}`,
        sum(
          rows.filter((r) => ['IOS', 'ANDROID'].includes(r.platform_type)),
          f,
        ),
        number(app[f]),
        f === 'gmv_usd' ? 1e-6 : 0,
      );
}

const windows = [
  ...dates.slice(7).map((day, i) => ({ label: `${dates[i]}→${day}`, baseline: [dates[i]], current: [day] })),
  { label: '11/08–11/14→11/15–11/21', baseline: dates.slice(0, 7), current: dates.slice(7) },
];
const aggregate = (rows, fields) => Object.fromEntries(fields.map((f) => [f, sum(rows, f)]));
function lmdi(name, context, before, after, count) {
  const toFactors = (a) =>
    name === 'active'
      ? {
          active: a.active_uv / count,
          expose: a.expose_uv / a.active_uv,
          submit: a.submit_uv / a.expose_uv,
          pay: a.pay_uv / a.submit_uv,
          aov: a.gmv_usd / a.pay_uv,
        }
      : {
          expire: a.expire_user_cnt / count,
          renewal: a.renew_user_cnt / a.expire_user_cnt,
          aov: a.gmv_usd / a.renew_user_cnt,
        };
  const b = toFactors(before),
    a = toFactors(after),
    keys = Object.keys(b);
  if ([...Object.values(a), ...Object.values(b)].some((v) => !Number.isFinite(v) || v < 0)) {
    lmdiStats[name].undefined++;
    exceptions.push({ type: 'lmdi_undefined_factor', name, context, baseline: before, current: after });
    return;
  }
  lmdiStats[name].calculated++;
  for (const [side, factors, total] of [
    ['baseline', b, before.gmv_usd / count],
    ['current', a, after.gmv_usd / count],
  ])
    eq(
      'lmdi_factor_product',
      `${name}/${context}/${side}`,
      Object.values(factors).reduce((v, x) => v * x, 1),
      total,
      1e-6,
    );
  const effects = lmdiDriverEffects(b, a, keys),
    delta = (after.gmv_usd - before.gmv_usd) / count;
  lmdiRecords.push({
    name,
    context,
    days: count,
    baselineGmv: before.gmv_usd / count,
    currentGmv: after.gmv_usd / count,
    delta,
    effectSum: Object.values(effects).reduce((v, x) => v + x, 0),
    effects,
    baselineFactors: b,
    currentFactors: a,
  });
  eq(
    'lmdi_process_delta',
    `${name}/${context}`,
    Object.values(effects).reduce((v, x) => v + x, 0),
    delta,
    1e-6,
  );
  if (
    before.gmv_usd > 0 &&
    after.gmv_usd > 0 &&
    Object.values(a).every((v) => v > 0) &&
    Object.values(b).every((v) => v > 0)
  ) {
    const y0 = before.gmv_usd / count,
      y1 = after.gmv_usd / count;
    const logMean = Math.abs(y1 - y0) < 1e-10 ? y0 : (y1 - y0) / (Math.log(y1) - Math.log(y0));
    for (const k of keys)
      eq(
        'lmdi_independent_reference',
        `${name}/${context}/${k}`,
        effects[k],
        logMean * (Math.log(a[k]) - Math.log(b[k])),
        1e-6,
      );
  }
  if (context.includes('/parent/'))
    samples.push({
      type: 'lmdi',
      context,
      baselineGmv: before.gmv_usd / count,
      currentGmv: after.gmv_usd / count,
      delta,
      effects,
    });
}
for (const scope of ['all', 'web', 'app', 'ios', 'android'])
  for (const window of windows) {
    const rows = chain.filter((r) => r.scope === scope);
    for (const dim of ['parent', 'country', 'lifecycle', 'creation', 'full'])
      for (const [k, entries] of group(
        rows.filter((r) => r.dimension === dim),
        ['key1', 'key2', 'key3'],
      )) {
        const b = aggregate(
            entries.filter((r) => window.baseline.includes(r.period)),
            atoms,
          ),
          a = aggregate(
            entries.filter((r) => window.current.includes(r.period)),
            atoms,
          );
        lmdi('active', `${scope}/${dim}/${k}/${window.label}`, b, a, window.baseline.length);
      }
    // Rate identities on the same fresh parent and dimensional atoms.
    const populations = ['ALL', ...new Set(rows.filter((r) => r.dimension === 'lifecycle').map((r) => r.key1))];
    for (const population of populations) {
      const parentRows = rows.filter((r) =>
        population === 'ALL' ? r.dimension === 'parent' : r.dimension === 'lifecycle' && r.key1 === population,
      );
      for (const dim of ['country', 'creation', 'submit_channel']) {
        const dimension =
          population === 'ALL'
            ? dim
            : {
                country: 'country_lifecycle',
                creation: 'creation_lifecycle',
                submit_channel: 'submit_channel_lifecycle',
              }[dim];
        const childRows = rows.filter(
          (r) => r.dimension === dimension && (population === 'ALL' || r.key2 === population),
        );
        for (const metric of dim === 'submit_channel' ? ['pay'] : ['pay', 'submit']) {
          const n = metric === 'pay' ? 'pay_uv' : 'submit_uv',
            d = metric === 'pay' ? 'submit_uv' : 'expose_uv';
          const atom = (r, days) => ({
            numerator: sum(
              r.filter((x) => days.includes(x.period)),
              n,
            ),
            denominator: sum(
              r.filter((x) => days.includes(x.period)),
              d,
            ),
          });
          const parent = { baseline: atom(parentRows, window.baseline), current: atom(parentRows, window.current) };
          const segments = [...group(childRows, ['key1'])].map(([key, entries]) => ({
            key,
            label: key,
            baseline: atom(entries, window.baseline),
            current: atom(entries, window.current),
          }));
          const context = `${scope}/${population}/${dim}/${metric}/${window.label}`;
          for (const side of ['baseline', 'current'])
            for (const field of ['numerator', 'denominator'])
              eq(
                'rate_atoms_partition',
                `${context}/${side}/${field}`,
                segments.reduce((v, r) => v + r[side][field], 0),
                parent[side][field],
                0,
              );
          if (!parent.baseline.denominator || !parent.current.denominator) {
            exceptions.push({ type: 'shapley_parent_zero_denominator', context, parent });
            continue;
          }
          // Independent direct two-factor formula where every group rate is defined.
          const undefinedGroups = segments.filter((r) => !r.baseline.denominator || !r.current.denominator);
          const overOneGroups = segments.filter(
            (r) => r.baseline.numerator > r.baseline.denominator || r.current.numerator > r.current.denominator,
          );
          const result = decomposeRate(segments, parent, { separateUnresolved: true });
          const delta =
            parent.current.numerator / parent.current.denominator -
            parent.baseline.numerator / parent.baseline.denominator;
          shapleyRecords.push({
            context,
            parent,
            segments,
            valid: result.valid,
            deltaPp: delta * 100,
            structurePp: result.structure * 100,
            efficiencyPp: result.efficiency * 100,
            unresolvedPp: result.unresolved * 100,
            undefinedGroups,
            overOneGroups,
          });
          if (!result.valid) {
            exceptions.push({
              type: 'shapley_runtime_unavailable',
              context,
              parent,
              reason: result.reason,
              undefinedGroups,
            });
            continue;
          }
          eq(
            'shapley_total_with_explicit_unresolved',
            context,
            result.structure + result.efficiency + result.unresolved,
            delta,
            1e-12,
          );
          if (undefinedGroups.length) {
            exceptions.push({
              type: 'shapley_undefined_group',
              context,
              parent,
              deltaPp: delta * 100,
              structurePp: result.structure * 100,
              efficiencyPp: result.efficiency * 100,
              unresolvedPp: result.unresolved * 100,
              groups: undefinedGroups,
            });
            continue;
          }
          let structure = 0,
            efficiency = 0;
          for (const r of segments) {
            const r0 = r.baseline.numerator / r.baseline.denominator,
              r1 = r.current.numerator / r.current.denominator,
              w0 = r.baseline.denominator / parent.baseline.denominator,
              w1 = r.current.denominator / parent.current.denominator;
            structure += ((w1 - w0) * (r1 + r0)) / 2;
            efficiency += ((r1 - r0) * (w1 + w0)) / 2;
          }
          eq('shapley_warehouse_two_factor_identity', context, structure + efficiency, delta, 1e-12);
          eq('shapley_runtime_two_factor', context, result.structure + result.efficiency, delta, 1e-12);
          if (overOneGroups.length)
            samples.push({
              type: 'shapley_rate_above_one',
              context,
              parent,
              groups: overOneGroups,
              deltaPp: delta * 100,
              referenceStructurePp: structure * 100,
              referenceEfficiencyPp: efficiency * 100,
              runtimeStructurePp: result.structure * 100,
              runtimeEfficiencyPp: result.efficiency * 100,
              runtimeUnresolvedPp: result.unresolved * 100,
            });
          eq('shapley_independent_structure', context, result.structure, structure, 1e-12);
          eq('shapley_independent_efficiency', context, result.efficiency, efficiency, 1e-12);
        }
      }
    }
  }
for (const scope of ['all', 'WEB', 'APP', 'IOS', 'ANDROID'])
  for (const window of windows) {
    const rows = renewal.filter(
      (r) => r.borderline_tag === summary && r.platform_type === (scope === 'all' ? summary : scope),
    );
    for (const dim of ['parent', 'plan_tier', 'plan_cycle']) {
      const native = rows.filter((r) =>
        dim === 'parent'
          ? r.plan_tier === summary && r.plan_cycle === summary
          : dim === 'plan_tier'
            ? r.plan_tier !== summary && r.plan_cycle === summary
            : r.plan_tier === summary && r.plan_cycle !== summary,
      );
      for (const [k, entries] of group(native, dim === 'parent' ? [] : [dim]))
        lmdi(
          'renewal',
          `${scope}/${dim}/${k}/${window.label}`,
          aggregate(
            entries.filter((r) => window.baseline.includes(r.period)),
            ['expire_user_cnt', 'renew_user_cnt', 'gmv_usd'],
          ),
          aggregate(
            entries.filter((r) => window.current.includes(r.period)),
            ['expire_user_cnt', 'renew_user_cnt', 'gmv_usd'],
          ),
          window.baseline.length,
        );
    }
  }
for (const root of roots) {
  const types = attribution.filter(
    (r) =>
      r.period === root.period &&
      r.attribution_type === 'NONE' &&
      r.dimension === 'pay_type' &&
      r.key1 !== '自动续订' &&
      (root.scope === 'all' ||
        (root.scope === 'web'
          ? r.device_type === 'web'
          : root.scope === 'app'
            ? ['ios', 'android'].includes(r.device_type)
            : r.device_type === root.scope)),
  );
  const resultGmv = sum(types, 'gmv_usd');
  gmvScopeDifferences.push({
    period: root.period,
    scope: root.scope,
    resultActiveGmv: resultGmv,
    chainGmv: number(root.gmv_usd),
    scopeDifference: resultGmv - number(root.gmv_usd),
  });
}
// Actual history joins are compared back to the independent unjoined DWD controls.
const transitions = sources['payment-transitions'].data;
for (const root of transitions.filter((r) => r.dimension === 'joined_parent')) {
  const ref = orders.find(
    (r) =>
      r.period === root.period &&
      r.device_type === root.device_type &&
      r.dimension === 'pay_type' &&
      r.key1 === root.pay_type,
  );
  eq(
    'payment_history_join_no_fanout',
    key(root, ['period', 'device_type', 'pay_type']),
    number(root.gmv_usd),
    number(ref?.gmv_usd),
    1e-7,
  );
  for (const dim of ['previous_sku', 'previous_plan_tier', 'previous_plan_cycle', 'previous_credit_amount'])
    eq(
      'payment_transition_dimension',
      `${key(root, ['period', 'device_type', 'pay_type'])}/${dim}`,
      sum(
        transitions.filter(
          (r) =>
            r.period === root.period &&
            r.device_type === root.device_type &&
            r.pay_type === root.pay_type &&
            r.dimension === dim,
        ),
        'gmv_usd',
      ),
      number(root.gmv_usd),
      1e-7,
    );
}
const costs = sources['model-cost'].data;
for (const root of costs.filter((r) => r.dimension === 'parent'))
  for (const dim of ['attribution_name', 'actual_supplier', 'actual_provider'])
    eq(
      'model_cost_dimension',
      `${key(root, ['period', 'device_type', 'attribution_type'])}/${dim}`,
      sum(
        costs.filter(
          (r) =>
            r.period === root.period &&
            r.device_type === root.device_type &&
            r.attribution_type === root.attribution_type &&
            r.dimension === dim,
        ),
        'model_cost_usd',
      ),
      number(root.model_cost_usd),
      1e-7,
    );
const output = {
  sourceOnly: true,
  start: dates[0],
  end: dates.at(-1),
  sources: Object.fromEntries(
    Object.entries(sources).map(([k, p]) => [
      k,
      { rows: p.rowCount, sqlSha256: p.sqlSha256, streamCompletedAtUtc: p.streamCompletedAtUtc },
    ]),
  ),
  checks,
  failures,
  exceptions,
  samples,
  gmvScopeDifferences,
  uvOverlaps,
  lmdiRecords,
  shapleyRecords,
  lmdiStats,
  summary: {
    assertions: Object.values(checks).reduce((v, r) => v + r.cases, 0),
    failures: failures.length,
    exceptions: exceptions.length,
    exceptionTypes: Object.fromEntries([...group(exceptions, ['type'])].map(([k, v]) => [JSON.parse(k)[0], v.length])),
  },
};
writeFileSync(`${dir}/all-checks.csv.gz`, gzipSync(checkLines.join('')));
writeFileSync(`${dir}/results.json`, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ summary: output.summary, checks, firstFailures: failures.slice(0, 12) }, null, 2));
process.exitCode = failures.length ? 1 : 0;
