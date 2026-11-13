// Reproduce the local, explicitly selected two-week diagnostic examples.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chainDriverEffects } from '../worker/chain-attribution.ts';
import { decomposeRate, decomposeCount } from '../client/src/components/dashboard/chain-diagnostics.ts';

const root = new URL('../archives/diagnosis-skill-2026-11-08/', import.meta.url);
const names = ['funnel', 'breakdown', 'ads', 'creation', 'creation-functions', 'pay-type'];
const snapshots = await Promise.all(names.map(async name => {
  const raw = await readFile(new URL(`${name}.json`, root), 'utf8');
  return [name, JSON.parse(raw), createHash('sha256').update(raw).digest('hex')];
}));
const data = Object.fromEntries(snapshots.map(([name, rows]) => [name, rows]));
const weeks = ['2026-10-24', '2026-10-31'];
const sum = (rows, key) => rows.reduce((n, row) => n + Number(row[key] ?? 0), 0);
const close = (a, b) => assert.ok(Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const slice = (rows, week) => rows.filter(row => row.week_start === week);
const total = rows => Object.fromEntries(['active_uv','expose_uv','submit_uv','pay_uv','gmv_usd'].map(key => [key, sum(rows, key)]));
const pair = rows => ({ baseline: total(slice(rows, weeks[0])), current: total(slice(rows, weeks[1])) });
const factors = r => ({ activeUv: r.active_uv / 7, subExposeRate: r.expose_uv / r.active_uv, subSubmitRate: r.submit_uv / r.expose_uv, chainPaySuccessRate: r.pay_uv / r.submit_uv, chainArppu: r.gmv_usd / r.pay_uv });
const atoms = (row, numerator, denominator) => ({ numerator: row[numerator], denominator: row[denominator] });
const ratio = (rows, groups, numerator, denominator, separateUnresolved = false) => {
  const parent = pair(rows);
  const segments = [...new Set(groups.map(row => row.group))].map(key => {
    const values = pair(groups.filter(row => row.group === key));
    return { key, label: key, baseline: atoms(values.baseline, numerator, denominator), current: atoms(values.current, numerator, denominator) };
  });
  const result = decomposeRate(segments, { baseline: atoms(parent.baseline, numerator, denominator), current: atoms(parent.current, numerator, denominator) }, { separateUnresolved });
  if (result.valid) close(result.structure + result.efficiency + result.unresolved, result.delta);
  return result;
};
for (const name of ['funnel','breakdown','ads','creation','pay-type']) {
  const dates = [...new Set(data[name].map(row => row.period))].sort();
  assert.equal(dates.length, 14, `${name} must cover 14 calendar days`);
  assert.equal(dates[0], '2026-10-24'); assert.equal(dates.at(-1), '2026-11-06');
}
const scopes = [];
const scopeDefinitions = ['web','app','all'].flatMap(platform => ['all','NEW','OLD'].map(lifecycle => ({ platform, lifecycle, countryTier: 'all' })));
scopeDefinitions.push({ platform: 'app', lifecycle: 'OLD', countryTier: 'T2' });
for (const { platform, lifecycle, countryTier } of scopeDefinitions) {
  const applies = row => (platform === 'all' || row.platform === platform) && (lifecycle === 'all' || row.user_lifecycle === lifecycle) && (countryTier === 'all' || row.country_tier === countryTier);
  const rows = data.funnel.filter(applies), breakdowns = data.breakdown.filter(applies);
  for (const week of weeks) assert.equal(new Set(slice(rows, week).map(row => row.period)).size, 7);
  const values = pair(rows);
  const effects = chainDriverEffects(factors(values.baseline), factors(values.current));
  const delta = (values.current.gmv_usd - values.baseline.gmv_usd) / 7;
  close(Object.values(effects).reduce((n, value) => n + value, 0), delta);
  const countryGroups = rows.map(row => ({ ...row, group: row.country_tier || '未知' }));
  const channelGroups = breakdowns.filter(row => row.breakdown_type === 'SUBMIT_CHANNEL').map(row => ({ ...row, group: /^(unknown|未知|未记录|null|undefined)?$/i.test(row.breakdown_value.trim()) ? '未知' : row.breakdown_value.trim() }));
  const countryRates = Object.fromEntries([['expose','expose_uv','active_uv'],['submit','submit_uv','expose_uv'],['pay','pay_uv','submit_uv']].map(([name,n,d]) => [name,ratio(rows,countryGroups,n,d)]));
  const channels = ratio(rows, channelGroups, 'pay_uv', 'submit_uv', true);
  assert.ok(channels.valid, `${platform}/${lifecycle}: ${channels.reason}`);
  const counts = (groups, metric) => decomposeCount([...new Set(groups.map(row => row.group))].map(key => ({ key, label: key, baseline: sum(slice(groups.filter(row => row.group === key), weeks[0]),metric)/7, current: sum(slice(groups.filter(row => row.group === key), weeks[1]),metric)/7 })), { baseline: values.baseline[metric]/7, current: values.current[metric]/7 });
  const dauCountries = counts(countryGroups, 'active_uv'); assert.ok(dauCountries.valid);
  const exposures = Object.fromEntries(['EXPOSE_TYPE','EXPOSE_REASON'].map(type => {
    const result = counts(breakdowns.filter(row => row.breakdown_type === type).map(row => ({ ...row, group: row.breakdown_value })), 'expose_uv');
    assert.ok(result.valid, `${platform}/${lifecycle}/${type} does not reconcile`); return [type,result];
  }));
  scopes.push({ platform, lifecycle, countryTier, totals: values, lmdi: { delta, effects }, countryRates, channels, dauCountries, exposures });
}
// Lifecycle is the first additive split; unknown rows must reconcile too.
const lifecycleResults = ['web','app','all'].map(platform => {
  const rows = data.funnel.filter(row => platform === 'all' || row.platform === platform);
  const groups = ['NEW','OLD','未知'].map(lifecycle => {
    const values = pair(rows.filter(row => (row.user_lifecycle || '未知') === lifecycle));
    return { lifecycle, ...values, dailyGmvDelta: (values.current.gmv_usd - values.baseline.gmv_usd) / 7 };
  });
  const parent = pair(rows);
  for (const side of ['baseline','current']) for (const metric of Object.keys(parent[side])) {
    close(groups.reduce((n, group) => n + group[side][metric], 0), parent[side][metric]);
  }
  const delta = (parent.current.gmv_usd - parent.baseline.gmv_usd) / 7;
  close(groups.reduce((n, group) => n + group.dailyGmvDelta, 0), delta);
  return { platform, groups: groups.map(group => ({ ...group, contribution: Math.abs(delta) > 1e-10 ? group.dailyGmvDelta / delta : null })) };
});
for (const platform of ['WEB','ANDROID','IOS','汇总']) for (const week of weeks) {
  const parent = data.creation.filter(row => row.platform_type === platform && row.week_start === week);
  const functions = data['creation-functions'].filter(row => row.platform_type === platform && row.week_start === week);
  for (const metric of ['creation_task_cnt','valid_creation_task_cnt','success_task_cnt','adopted_task_cnt']) {
    close(sum(parent,metric), sum(functions,metric));
  }
}
// Mapping was explicitly confirmed by the user for 2026-10-24 through 2026-11-06.
const t1 = new Set('US GB DE FR JP CA AU IT ES NL CH SE NO DK FI BE AT NZ IE KR SG LU BR MX AR CL CN HK'.split(' '));
const t3 = new Set('IN ID RU DZ PK PH'.split(' '));
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
function normalizeCountry(raw) {
  const code = String(raw ?? '').trim().toUpperCase();
  if (code === 'UK') return 'GB';
  if (!/^[A-Z]{2}$/.test(code) || code === 'ZZ' || !regionNames.of(code)) return '未知';
  return code;
}
const tier = country => country === '未知' ? '未知' : t1.has(country) ? 'T1' : t3.has(country) ? 'T3' : 'T2';
assert.equal(normalizeCountry('UK'), 'GB'); assert.equal(normalizeCountry('ZZ'), '未知'); assert.equal(normalizeCountry(''), '未知');
const ads = data.ads.map(row => ({ ...row, platform: row.platform.toLowerCase(), country: normalizeCountry(row.country) }));
const adsSummaries = ['web','app','all'].map(platform => {
  const rows = ads.filter(row => platform === 'all' || row.platform === platform);
  const grouped = field => [...new Set(rows.map(row => field(row)))].map(key => ({ key, ...Object.fromEntries(weeks.map(week => [week,Object.fromEntries(['clicks','impressions','cost_usd','register_user_cnt'].map(metric => [metric,sum(rows.filter(row => row.week_start === week && field(row) === key), metric)]))])) }));
  const totals = grouped(() => 'all')[0];
  const tiers = grouped(row => tier(row.country)), countries = grouped(row => row.country);
  for (const week of weeks) for (const metric of ['clicks','impressions','cost_usd','register_user_cnt']) {
    close(sum(tiers.map(row => row[week]),metric), totals[week][metric]);
    close(sum(countries.map(row => row[week]),metric), totals[week][metric]);
  }
  return { platform, totals, tiers, countries };
});
const payment = ['web','app','all'].map(platform => ({ platform, weeks: weeks.map(week => ({ week, types: data['pay-type'].filter(row => row.platform === platform && row.week_start === week).reduce((acc,row) => { const key = `${row.pay_category}/${row.pay_type}`;acc[key]=(acc[key]??0)+row.gmv_usd/7;return acc; },{}) })) }));
const creation = ['WEB','汇总'].map(platform => ({ platform, weeks: weeks.map(week => {
  const rows = data.creation.filter(row => row.platform_type === platform && row.week_start === week);
  assert.equal(rows.length,7);
  return { week, days: rows.length, ...Object.fromEntries(['creation_task_cnt','valid_creation_task_cnt','creation_user_cnt','success_task_cnt','success_output_cnt','adopted_task_cnt','adopted_output_cnt','d3_creation_user_cnt','d7_creation_user_cnt','d30_creation_user_cnt'].map(metric => [metric,rows.every(row => row[metric] != null) ? sum(rows,metric) : null])) };
}) }));
const result = { window: { baseline: ['2026-10-24','2026-10-30'], analysis: ['2026-10-31','2026-11-06'] }, snapshotSha256: Object.fromEntries(snapshots.map(([name,,hash]) => [name,hash])), mapping: { confirmedBy: 'user screenshot and explicit confirmation in this chat', validFor: ['2026-10-24','2026-11-06'], t1: [...t1], t3: [...t3], alias: { UK: 'GB' }, unknown: 'missing or unrecognized countries including ZZ; never assigned to T2' }, scopes, lifecycleResults, ads: adsSummaries, payment, creation };
await writeFile(new URL('verified-analysis.json', root), JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({ lifecycleResults, scopes: scopes.map(s => ({ platform:s.platform,lifecycle:s.lifecycle,countryTier:s.countryTier,gmvDelta:s.lmdi.delta,payRate:s.channels.delta,channelEfficiency:s.channels.efficiency,channelStructure:s.channels.structure,countryEfficiency:s.countryRates.pay.efficiency,countryStructure:s.countryRates.pay.structure })), checks:'PASS: 14-day coverage, 10 LMDI scopes, rate conservation, exposure/DAU partitions, country mapping and ads conservation, lifecycle reconciliation, creation task partitions', creation },null,2));
