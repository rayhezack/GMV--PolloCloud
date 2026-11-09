// Regression for D1's 100 bind limit, independent of the local data snapshot.
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

await build({ entryPoints: ['worker/payment-analysis-sql.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '/tmp/pollo-payment-sql.mjs' });
const { paymentAnalysisSql } = await import('/tmp/pollo-payment-sql.mjs?' + Date.now());
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE pollo_da_fact_rows (
  dataset TEXT, period TEXT, week_start TEXT, platform TEXT, device_type TEXT,
  metric_version TEXT, attribution_type TEXT, attribution_name TEXT,
  actual_supplier TEXT, actual_provider TEXT, pay_category TEXT, pay_type TEXT,
  function_name TEXT, user_tag TEXT, subscription_tier TEXT,
  gmv_usd REAL, model_cost_usd REAL
)`);
db.exec('CREATE VIEW pollo_da_fact_rows_read AS SELECT * FROM pollo_da_fact_rows');
const insert = db.prepare('INSERT INTO pollo_da_fact_rows VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
const dates = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10));
for (const date of dates) for (const mode of ['NONE', 'CREATION_MODE', 'MODEL', 'ACTUAL_MODEL', null]) {
  for (const device of ['desktop', 'mobile']) for (const platform of ['web', 'app']) {
    const row = ['pay_type', date, date, platform, device, mode ? 'ads_v1' : null, mode, 'model', 'supplier', 'provider'];
    insert.run(...row, 'ACTIVE_PAYMENT', '首订', 'function', 'new', null, 10, 0);
    insert.run(...row, '汇总', '汇总', null, null, null, 0, 3);
  }
}

let cases = 0;
for (const selected of [dates, dates.filter((_, i) => i % 3 !== 0), [dates[0], dates[364]], []]) {
  for (const attributionType of ['NONE', 'CREATION_MODE', 'MODEL', 'ACTUAL_MODEL']) {
    for (const legacy of [false, true]) for (const measure of ['revenue', 'cost']) {
      for (const dailyOnly of [false, true]) {
        const scope = { dates: selected, platform: 'web', deviceType: 'desktop', attributionType, legacy };
        const query = paymentAnalysisSql(scope, measure, dailyOnly);
        assert(query.binds.length <= 100, 'Query exceeds D1 parameter limit');
        const actual = db.prepare(query.sql).all(...query.binds);
        // Execute the previous per-date predicate with native SQLite's higher
        // limit to prove the new predicate preserves rows and amounts exactly.
        const referenceSql = query.sql.replace('period IN (SELECT value FROM json_each(?))', `period IN (${selected.map(() => '?').join(',')})`);
        const expected = db.prepare(referenceSql).all(...selected, ...query.binds.slice(1));
        assert.deepEqual(actual, expected);
        assert.equal(new Set(actual.map(row => row.period)).size, selected.length);
        cases++;
      }
    }
  }
}
db.close();
console.log(`PASS ${cases} SQL cases: 365-day, sparse and empty date sets; all attribution modes; revenue/cost; exact row and amount conservation`);
