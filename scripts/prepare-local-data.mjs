import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backfillLocalRevenueHistory } from './backfill-local-revenue-history.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.local-data');
const exec = promisify(execFile);
const tables = [
  'pollo_da_fact_rows', 'pollo_da_chain_funnel', 'pollo_da_chain_breakdown',
  'pollo_da_ads_daily', 'pollo_da_creation_overall_daily', 'pollo_da_creation_function_daily',
  'pollo_da_reports', 'pollo_da_product_actions',
  'pollo_da_product_action_details', 'product_action_sync_state',
];
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
async function query(sql) {
  for (let attempt = 0; ; attempt++) {
    try {
      const { stdout } = await exec('pollocloud', ['db', 'execute', '--name', 'pollo-ai', '--command', sql, '--json'], {
        maxBuffer: 128 * 1024 * 1024, timeout: 120000,
        env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
      });
      const payload = JSON.parse(stdout.slice(stdout.indexOf('[')));
      if (!payload.every((part) => part.success)) throw new Error('数据快照读取失败');
      return payload.flatMap((part) => part.results ?? []);
    } catch (error) {
      if (attempt === 2) throw error;
      console.log(`重试快照读取 (${attempt + 1}/2)`);
    }
  }
}

await mkdir(directory, { recursive: true });
const [{ period: endDate }] = await query("SELECT MIN(period) AS period FROM (SELECT MAX(period) AS period FROM pollo_da_fact_rows WHERE dataset='pay_type' UNION ALL SELECT MAX(period) FROM pollo_da_ads_daily UNION ALL SELECT MAX(period) FROM pollo_da_creation_overall_daily)");
if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('缺少有效的最新数据日期');
const startDate = shift(endDate, -29);
const schema = await query(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name IN (${tables.map((name) => `'${name}'`).join(',')}) AND sql IS NOT NULL ORDER BY type DESC`);
const missing = tables.filter((name) => !schema.some((row) => row.type === 'table' && row.name === name));
if (missing.length) throw new Error(`远端缺少数据表：${missing.join(', ')}`);
const tempPath = path.join(directory, `dashboard-${process.pid}.sqlite`);
let db = new DatabaseSync(tempPath);
db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=OFF;');
for (const row of schema) db.exec(row.sql);
db.exec(await readFile(path.join(root, 'db/0002_dashboard_response_cache.sql'), 'utf8'));
db.exec(await readFile(path.join(root, 'db/0003_report_jobs.sql'), 'utf8'));
db.exec(await readFile(path.join(root, 'db/0004_sync_jobs.sql'), 'utf8'));
for (const migration of ['0015_payment_registration.sql','0016_chain_sync_stage.sql','0017_payment_sync_stage.sql']) db.exec(await readFile(path.join(root,'db',migration),'utf8'));
const statements = new Map();
for (const table of tables) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  statements.set(table, { columns, insert: db.prepare(`INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`) });
}
function insertRows(table, rows) {
  const { columns, insert } = statements.get(table);
  db.exec('BEGIN');
  try {
    for (const row of rows) insert.run(...columns.map((column) => row[column] ?? null));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
const jobs = [];
for (const table of tables) {
  if (table === 'pollo_da_fact_rows') {
    // Payments are freshly aggregated below; chain readers use enriched tables.
    // Retain legacy sources only where no equivalent replacement exists.
    for (const dataset of ['creative', 'renewal']) {
      const size = 30;
      for (let first = startDate; first <= endDate; first = shift(first, size)) {
        const last = [shift(first, size - 1), endDate].sort()[0];
        jobs.push({ table, where: `dataset = '${dataset}' AND period BETWEEN '${first}' AND '${last}'` });
      }
    }
    continue;
  }
  if (table === 'pollo_da_product_action_details' || table === 'product_action_sync_state') {
    jobs.push({ table, where: '1=1' });
    continue;
  }
  const field = table === 'pollo_da_reports' ? 'period_end' : table === 'pollo_da_product_actions' ? 'stat_date' : 'period';
  jobs.push({ table, where: `${field} BETWEEN '${startDate}' AND '${endDate}'` });
}
let cursor = 0;
try {
  // Bound remote reads happen once here. Tab switches only read SQLite.
  const results = await Promise.allSettled(Array.from({ length: 4 }, async () => {
    while (cursor < jobs.length) {
      const { table, where } = jobs[cursor++];
      let count = 0;
      for (let offset = 0; ; offset += 1000) {
        const sql = `SELECT * FROM ${table} WHERE ${where} ORDER BY rowid LIMIT 1000 OFFSET ${offset}`;
        const cachePath = path.join(directory, createHash('sha256').update(sql).digest('hex') + '.json');
        let rows;
        if (process.argv.includes('--resume')) {
          try { rows = JSON.parse(await readFile(cachePath, 'utf8')); } catch {}
        }
        rows ??= await query(sql);
        await writeFile(cachePath, JSON.stringify(rows));
        insertRows(table, rows);
        count += rows.length;
        if (rows.length < 1000) break;
      }
      console.log(`${table}: ${count} rows (${where})`);
    }
  }));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  db.close();
  const history = await backfillLocalRevenueHistory(directory, { database: tempPath, endDate });
  db = new DatabaseSync(tempPath);
  // The warehouse enrichment is aggregate-only; absent dates remain NULL.
  for (const kind of ['overall', 'function']) {
    const table = `pollo_da_creation_${kind}_daily`;
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === 'valid_creation_task_cnt')) db.exec(`ALTER TABLE ${table} ADD COLUMN valid_creation_task_cnt INTEGER`);
  }
  const enrichmentPath = path.join(root, 'archives/creation-chain-backfill/valid-tasks-20261006-20261104.json');
  try {
    const enrichment = JSON.parse(await readFile(enrichmentPath, 'utf8'));
    const overall = db.prepare('UPDATE pollo_da_creation_overall_daily SET valid_creation_task_cnt=? WHERE period=? AND platform_type=?');
    const detail = db.prepare('UPDATE pollo_da_creation_function_daily SET valid_creation_task_cnt=? WHERE period=? AND platform_type=? AND creation_mode=? AND user_type=? AND pay_gmv_usd_30d=?');
    db.exec('BEGIN');
    for (const row of enrichment) {
      if (row.creation_mode === '汇总' && row.user_type === '汇总' && row.pay_gmv_usd_30d === '汇总') overall.run(row.valid_creation_task_cnt, row.period.slice(0,10), row.platform_type);
      else detail.run(row.valid_creation_task_cnt, row.period.slice(0,10), row.platform_type, row.creation_mode, row.user_type, row.pay_gmv_usd_30d);
    }
    db.exec('COMMIT');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  db.exec('ANALYZE');
  const coverage = Object.fromEntries(tables.map((table) => {
    if (table === 'pollo_da_product_action_details' || table === 'product_action_sync_state') return [table, db.prepare(`SELECT COUNT(*) AS rows FROM ${table}`).get()];
    const field = table === 'pollo_da_reports' ? 'period_end' : table === 'pollo_da_product_actions' ? 'stat_date' : 'period';
    return [table, db.prepare(`SELECT COUNT(*) AS rows, MIN(${field}) AS firstDate, MAX(${field}) AS lastDate FROM ${table}`).get()];
  }));
  const factCoverage = db.prepare('SELECT dataset, COUNT(DISTINCT period) AS days FROM pollo_da_fact_rows GROUP BY dataset').all();
  if (!['pay_type', 'creative', 'renewal'].every((dataset) => factCoverage.some((row) => row.dataset === dataset && row.days >= 30))) {
    throw new Error(`基础数据不足30天：${JSON.stringify(factCoverage)}`);
  }
  db.close();
  try { await copyFile(path.join(directory,'dashboard.sqlite'), path.join(directory,`dashboard-before-prepare-${Date.now()}.sqlite`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(tempPath, path.join(directory, 'dashboard.sqlite'));
  const manifest = { startDate, endDate, generatedAt: new Date().toISOString(), coverage, revenueHistoryStartDate: history.start, revenueHistoryCoverage: history.coverage };
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`本地数据已准备：${startDate} ~ ${endDate}`);
} catch (error) {
  try { db.close(); } catch {}
  throw error;
}
