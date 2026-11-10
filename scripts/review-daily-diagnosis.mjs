// Local review only. Database operations are SELECT-only; generated reports are never persisted remotely.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { reportEvidenceQueries } from '../worker/report-evidence-loader.ts';
import { buildDailyDiagnosis } from '../worker/daily-diagnosis.ts';
import { prepareReportData } from '../worker/report-data.ts';
import { REPORT_SKILL_SHA256 } from '../worker/report-skill.generated.ts';
import { parse } from 'dotenv';

const execute = promisify(execFile), args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = resolve(option('--output') || 'archives/daily-diagnosis-review-2026-11-09');
const asOf = option('--as-of') || '2026-11-06';
const hash = data => createHash('sha256').update(data).digest('hex');
await mkdir(`${root}/sources`, { recursive: true });
const save = (name, data) => writeFile(`${root}/${name}`, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
const receipts = [];
const snapshot = option('--local-db') ? new DatabaseSync(resolve(option('--local-db')), { readOnly: true }) : null;
const snapshotManifest = snapshot ? JSON.parse(await readFile('.local-data/manifest.json', 'utf8')) : null;
let readView;
async function rawQuery(sql) {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql) || sql.includes(';')) throw new Error('仅允许单条只读查询');
  const id = hash(sql), filename = `${root}/sources/query-${id}.json`;
  if (snapshot) { const rows = snapshot.prepare(sql).all(); const receipt = { readAt: snapshotManifest.generatedAt, rows: rows.length, rowsWritten: 0, source: resolve(option('--local-db')), historicalSnapshot: true }; receipts.push({ hash: id, ...receipt }); await writeFile(filename, JSON.stringify({sql,rows,receipt})); return rows; }
  try { const cached = JSON.parse(await readFile(filename, 'utf8')); receipts.push({ hash: id, cached: true, ...cached.receipt }); return cached.rows; } catch {}
  let stdout;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { ({ stdout } = await execute('pollocloud', ['db','execute','--name','pollo-ai','--command',sql,'--json'], { env: { ...process.env, NODE_USE_ENV_PROXY: '1' }, timeout: 120000, maxBuffer: 128 * 1024 * 1024 })); break; }
    catch (error) { if (attempt === 2) throw new Error(`只读查询失败 ${id.slice(0,12)}: ${String(error.stderr || error.message).slice(-350)}`); console.log('Retry read', id.slice(0,12), attempt + 1); }
  }
  const payload = JSON.parse(stdout.slice(stdout.indexOf('[')));
  if (!payload.length || !payload.every(p => p.success && p.meta.rows_written === 0)) throw new Error('数据库只读凭据核验失败');
  const rows = payload.flatMap(p => p.results), receipt = { readAt: new Date().toISOString(), rows: rows.length, rowsWritten: 0 };
  await writeFile(filename, JSON.stringify({ sql, rows, receipt }));
  receipts.push({ hash: id, cached: false, ...receipt });
  return rows;
}
async function query(sql, ...binds) {
  let i = 0;
  let rendered = sql.replaceAll('?', () => `'${String(binds[i++]).replaceAll("'", "''")}'`);
  if (i !== binds.length) throw new Error('查询参数数量不匹配');
  if (snapshot) rendered = rendered.replaceAll('pollo_da_fact_rows_read', 'pollo_da_fact_rows');
  if (!snapshot && rendered.includes('pollo_da_fact_rows_read')) {
    if (!readView) {
      const [row] = await rawQuery("SELECT sql FROM sqlite_master WHERE name='pollo_da_fact_rows_read'");
      if (!row?.sql.includes(' UNION ALL SELECT ')) throw new Error('缺少可核对的支付读取视图定义');
      const definition = row.sql.slice(row.sql.indexOf(' AS ') + 4);
      const second = definition.split(' UNION ALL SELECT ')[1].split(' FROM pollo_da_fact_rows ')[0];
      // SELECT * becomes invalid when base-table columns are added. Retain the
      // published view's named projection and both WHERE clauses, without a DB write.
      const firstColumns = second.replace(/CASE WHEN device_type='web' THEN 'web' ELSE 'app' END AS platform/, '"platform"');
      if (!/^("\w+"\s*,?)+$/.test(firstColumns)) throw new Error('视图投影不是可验证的字段列表');
      readView = definition.replace('SELECT * FROM', `SELECT ${firstColumns} FROM`);
      await save('read-view-compatibility.json', { original: row.sql, localCte: readView, scope: 'local SELECT only; same named columns and original predicates', remoteRowsWritten: 0 });
    }
    rendered = rendered.replaceAll('FROM pollo_da_fact_rows_read', `FROM (${readView}) AS pollo_da_fact_rows_read`);
  }
  return rawQuery(rendered);
}
const DB = { prepare(sql) { let binds = []; return { bind(...values) { binds = values; return this; }, async all() { return { results: await query(sql, ...binds) }; }, async first() { return (await query(sql, ...binds))[0] ?? null; }, run() { throw new Error('本地诊断禁止数据库写入'); } }; } };
async function main() {
  const bundle = await build({ entryPoints: ['worker/index.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
  const { gmvAnomalies } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const detected = await (await gmvAnomalies({ DB }, asOf)).json();
  await save('detected.json', detected);
  console.log('Detector:', detected.latestDay, 'signals:', detected.alerts.length);
  if (!detected.alerts.length) throw new Error('该日未触发既有规则，不伪造异动；请检查其他真实候选日期');
  const signal = detected.alerts.find(s => s.platform === (option('--platform') || 'all') && s.metric === (option('--metric') || 'totalGmv'));
  if (!signal) throw new Error('指定端/指标未触发；已保存真实信号，需据此选择有效对象');
  const signals = detected.alerts.filter(s => s.platform === signal.platform && s.metric === signal.metric);
  const primary = signals.find(s => s.window === 'week') || signal;
  const platforms = signal.platform === 'all' ? ['web','app'] : [signal.platform];
  const sources = {};
  for (const platform of platforms) {
    sources[platform] = {};
    const window = { platform, startDate: primary.baselinePeriod, endDate: signal.period, mode: 'day' };
    for (const q of reportEvidenceQueries(window)) {
      if (snapshot && ['pay','renewal'].includes(q.key)) {
        const file = `archives/renewal-product-review-2026-11-09/sources/${platform}-${q.key}.source.json`;
        const saved = JSON.parse(await readFile(file, 'utf8'));
        if (saved.rowsWritten !== 0) throw new Error('历史来源只读凭据无效');
        sources[platform][q.key] = { ...saved, rows: saved.rows.filter(r => r.period >= window.startDate && r.period <= window.endDate), replaySource: file };
        // Newer product dimensions may be replayed only when daily totals match
        // the detector's historical canonical source on both comparison dates.
        if (q.key === 'pay') for (const date of [window.startDate,window.endDate]) {
          const [old] = await query("SELECT SUM(gmv_usd) AS gmv FROM pollo_da_fact_rows WHERE dataset='pay_type' AND platform=? AND period=? AND (attribution_type IS NULL OR (attribution_type='NONE' AND pay_category IN ('ACTIVE_PAYMENT','AUTO_RENEWAL','API') AND pay_type<>'汇总'))",platform,date);
          const total = saved.rows.filter(r => r.period === date).reduce((n,r) => n + r.gmv_usd, 0);
          if (Math.abs(total - old.gmv) > 1e-6) throw new Error('历史支付快照与补充产品类型快照金额不一致，不能拼接');
        }
      } else {
        const rows = await query(q.sql, ...q.binds);
        sources[platform][q.key] = { source: q.source, status: 'ok', readAt: receipts.at(-1).readAt, rows, rowsWritten: 0 };
      }
      await save(`sources/${platform}-${q.key}.source.json`, sources[platform][q.key]);
    }
    // Historical review snapshot, preserving the actual SUN WEN extraction time.
    sources[platform].actions = JSON.parse(await readFile('archives/renewal-product-review-2026-11-09/sources/product-actions.source.json', 'utf8'));
    await save(`sources/${platform}-actions.source.json`, sources[platform].actions);
  }
  const evidence = buildDailyDiagnosis(signals, sources);
  prepareReportData(evidence);
  await save('evidence.json', evidence);
  await save('verification.json', { asOf, historicalSnapshot: Boolean(snapshot), snapshotManifest, scope: signal.platform, metric: signal.metric, checks: evidence.checks.length, failedChecks: evidence.checks.filter(c => !c.passed), receipts, remoteRowsWritten: 0, skillSha256: REPORT_SKILL_SHA256, rawEvidenceOnly: true });
  console.log('Evidence:', evidence.checks.length, 'checks;', evidence.checks.filter(c => !c.passed).length, 'failures');
  if (!args.includes('--generate')) return;
  const config = option('--config') ? parse(await readFile(option('--config'), 'utf8')) : {};
  const env = Object.fromEntries(['KIMI_API_KEY','KIMI_BASE_URL','KIMI_MODEL'].map(k => [k, process.env[k] || config[k]]));
  if (!env.KIMI_API_KEY) throw new Error('缺少已授权模型的本地配置');
  const generator = await build({ entryPoints: ['worker/report-jobs.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
  const { generateMarkdown } = await import(`data:text/javascript;base64,${Buffer.from(generator.outputFiles[0].text).toString('base64')}`);
  const originalFetch = globalThis.fetch;
  let modelContent = '', modelFinish = '', actualModel = '', modelUsage;
  const captures = [];
  globalThis.fetch = async (url, options) => {
    const expected = `${(env.KIMI_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/+$/, '')}/chat/completions`;
    if (String(url) !== expected || options.method !== 'POST') throw new Error('仅允许指定的模型生成接口');
    await save('model-request.json', JSON.parse(options.body)); // Never store authorization headers.
    const response = await originalFetch(url, options);
    captures.push((async () => {
      if (!response.ok) return;
      const text = await response.clone().text();
      for (const line of text.split(/\r?\n/)) if (line.startsWith('data:') && line.slice(5).trim() !== '[DONE]') {
        const payload = JSON.parse(line.slice(5));
        modelContent += payload.choices?.[0]?.delta?.content || '';
        modelFinish = payload.choices?.[0]?.finish_reason || modelFinish;
        actualModel = payload.model || actualModel;
        modelUsage = payload.usage || modelUsage;
      }
      await save('model-raw-response.md', modelContent);
    })());
    return response;
  };
  try {
    console.log('Real model generation started');
    const markdown = await generateMarkdown(env, evidence);
    await Promise.all(captures);
    if (modelContent !== markdown || modelFinish !== 'stop') throw new Error('交付文本与模型原文不一致或流式未结束');
    await save('模型完整诊断.md', markdown);
    await save('model-receipt.json', { actualModel, finish: modelFinish, usage: modelUsage, markdownSha256: hash(markdown), requestEvidenceSha256: hash(JSON.stringify(evidence)), unchangedModelOutput: true, reportPersistenceCalls: 0, status: 'generated-awaiting-semantic-review' });
    console.log('Generated complete model report; semantic review required');
  } catch (error) {
    await Promise.allSettled(captures);
    await save('model-failure.json', { actualModel, finish: modelFinish, usage: modelUsage, partialContentSha256: hash(modelContent), error: String(error.message).replace(/sk-[A-Za-z0-9_-]+/g, '[已隐藏密钥]'), reportPersistenceCalls: 0, status: 'incomplete-not-delivered' });
    throw error;
  } finally { globalThis.fetch = originalFetch; await Promise.allSettled(captures); }
}
main().catch(error => { console.error(String(error.message).replace(/sk-[A-Za-z0-9_-]+/g,'[已隐藏密钥]')); process.exitCode = 1; });
