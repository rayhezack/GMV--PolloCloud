import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Canonical warehouse aggregates only. Never merge an older D1 payment snapshot
// into the refreshed result: its identities omitted SKU and overwrote amounts.
export async function backfillLocalRevenueHistory(directory, options = {}) {
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = options.endDate ? null : JSON.parse(await readFile(manifestPath, 'utf8'));
  const end = options.endDate ?? manifest.endDate;
  const start = shift(end, -89);
  // The earliest displayed day also needs twelve complete prior weeks and
  // their week-over-week denominators; this history stays outside the picker.
  const baselineStart = shift(start, -98);
  const database = options.database ?? path.join(directory, 'dashboard.sqlite');
  for (const script of ['refresh-payment-results.py', 'backfill-payment-registration.py']) {
    const { stdout } = await exec('/usr/bin/python3', [path.join(root, 'scripts', script), '--start', script === 'refresh-payment-results.py' ? baselineStart : start, '--end', end, '--database', database, '--apply-local'], { maxBuffer: 4 * 1024 * 1024, timeout: 30 * 60 * 1000 });
    console.log(stdout.trim());
  }
  const db = new DatabaseSync(database);
  try {
    const coverage = db.prepare("SELECT platform, COUNT(*) AS rows, COUNT(DISTINCT period) AS days, SUM(gmv_usd) AS gmv FROM pollo_da_fact_rows WHERE dataset='pay_type' AND attribution_type='NONE' AND pay_type<>'汇总' GROUP BY platform").all();
    if (!coverage.length || coverage.some(row => row.days < 188)) throw new Error('季度付费结果及异动基准期不足188天');
    if (manifest) {
      manifest.revenueHistoryStartDate = start;
      manifest.revenueBaselineStartDate = baselineStart;
      manifest.revenueHistoryCoverage = coverage;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    }
    return { start, baselineStart, coverage };
  } finally { db.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await backfillLocalRevenueHistory(fileURLToPath(new URL('../.local-data/', import.meta.url)));
}
