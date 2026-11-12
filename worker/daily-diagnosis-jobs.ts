import { deferDiagnoses, diagnosesSettling, claimDiagnosisExecution, releaseDiagnosisExecution, DIAGNOSIS_SETTLE_MS } from './diagnosis-dispatch';
import type { Env } from './index';
import { collectDailyDiagnosis, dailyComparison, type DailySignal } from './daily-diagnosis';
import { normalizeProductAction } from './report-evidence';
import { readProductActions } from './product-actions-store';
import { generateMarkdown, ModelInterruptedError } from './report-jobs';
import { prepareReportData } from './report-data';
import { REPORT_SKILL_SHA256 } from './report-skill.generated';
import type { DailyDiagnosisStatus, DashboardPlatform } from '../shared/api.interface';

type Evidence = Awaited<ReturnType<typeof collectDailyDiagnosis>>;
type Dependencies = {
  detect: (period?: string) => Promise<{ latestDay: string; alerts: DailySignal[]; monitoredPlatforms?: string[] }>;
  collect?: (signals: DailySignal[], overallContext?: boolean) => Promise<Evidence>;
  generate?: (evidence: Evidence) => Promise<string>;
};
type State = { platform: DashboardPlatform; period: string; baseline: string; active: number; status: DailyDiagnosisStatus['status']; input_hash: string; signals: string; current_report_id: string | null; error: string | null; updated_at: string };
type Job = { run_id: string; platform: DashboardPlatform; period: string; baseline: string; input_hash: string; evidence: string; status: string; markdown: string | null; model: string; finished_at: string | null; created_at: string; error: string | null; stage: string | null; progress_at: string | null; checkpoint: string | null; retry_count: number; continuation_count: number; next_attempt_at: number };
const now = () => new Date().toISOString();
const message = (e: unknown) => (e instanceof Error ? e.message : '日诊断失败').replace(/sk-[\w-]+/g, '[已隐藏密钥]').slice(0, 500);
function database(env: Env) { if (!env.DB) throw new Error('D1 未配置'); return env.DB; }
async function rows<T>(env: Env, sql: string, ...binds: unknown[]) { return (await database(env).prepare(sql).bind(...binds).all<T>()).results; }
async function run(env: Env, sql: string, ...binds: unknown[]) { await database(env).prepare(sql).bind(...binds).run(); }

// A complete Saturday–Friday report covers Friday's automatic daily diagnosis.
export const coveredByWeeklyDiagnosis = (period: string) => /^\d{4}-\d{2}-\d{2}$/.test(period) && new Date(period+'T00:00:00Z').getUTCDay() === 5;

const storagePrefix = 'daily-storage:';
async function saveContent(env: Env, key: string, content: string) {
  if (env.STORAGE) {
    await env.STORAGE.put(key,content,{contentType:key.endsWith('.json')?'application/json':'text/markdown; charset=utf-8'});
    return `${storagePrefix}${key}`;
  }
  // Small inline values keep existing histories and local tests readable.
  if (new TextEncoder().encode(content).length > 60000) throw new Error('完整诊断证据需要应用文件存储，当前未配置');
  return content;
}
async function readContent(env: Env, content: string) {
  if (!content.startsWith(storagePrefix)) return content;
  const text = await env.STORAGE?.getText(content.slice(storagePrefix.length));
  if (text == null) throw new Error('诊断存档文件暂不可用');
  return text;
}

/** Read timestamps and row order must not create new paid calls. Full evidence is retained separately. */
export async function dailyInputHash(evidence: unknown, model = 'kimi-k3') {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(v=>{const data=stable(v);return {data,key:JSON.stringify(data)};}).sort((a,b)=>a.key.localeCompare(b.key)).map(v=>v.data);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'readAt').sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
    return value;
  };
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([REPORT_SKILL_SHA256, model, stable(evidence)])));
  return Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join('');
}
export async function markDailyDiagnosisDirty(env: Env, delay = DIAGNOSIS_SETTLE_MS) {
  await deferDiagnoses(env, delay);
  await run(env, 'UPDATE daily_diagnosis_monitor SET revision=revision+1 WHERE id=1');
}
async function collect(env: Env, signals: DailySignal[], overallContext = false) {
  return collectDailyDiagnosis(signals, {
    query: (sql,...binds) => rows(env, sql,...binds),
    actions: async () => {
      const snapshot = await readProductActions(database(env));
      return { source:'D1/产品动作明细', status:snapshot.available?'ok':'unavailable', readAt:snapshot.readAt, complete:snapshot.available,
        rows:snapshot.records.map(record=>normalizeProductAction(record.fields,record.id)),
        provenance:{ warehouse:'pollo_da_product_action_details', recordScope:'all_records', hasMore:false } };
    },
  }, overallContext);
}

/** Called only by the backend scheduler. A persisted lease serializes detectors and model calls. */
export async function tickDailyDiagnoses(env: Env, dependencies: Dependencies, manual?: { platform: DashboardPlatform; period: string }) {
  const lease = crypto.randomUUID(), clock = Date.now();
  const today = new Date(clock+8*3600000).toISOString().slice(0,10);
  const automaticPeriod = new Date(clock+8*3600000-86400000).toISOString().slice(0,10);
  const targetPeriod = manual?.period ?? automaticPeriod;
  const claim = await rows<{revision:number;checked_revision:number;checked_day:string;checked_version:string;retry_pending:number}>(env,
    'UPDATE daily_diagnosis_monitor SET lease_id=?,lease_until=? WHERE id=1 AND lease_until<? RETURNING revision,checked_revision,checked_day,checked_version,retry_pending', lease,clock+15*60000,clock);
  if (!claim.length) return { status:'busy' };
  const snapshot = claim[0], revision = snapshot.revision;
  try {
    // Expired automatic work must not consume a new day's model lane. Manual
    // historical reruns remain explicit; never remove completed report history.
    await run(env,"UPDATE daily_diagnosis_jobs SET status='superseded',finished_at=? WHERE requested_by='automatic' AND period<>? AND status IN ('queued','running')",now(),automaticPeriod);
    await run(env,`UPDATE daily_diagnosis_state SET status=CASE WHEN current_report_id IS NOT NULL THEN 'success' ELSE 'waiting' END,error=NULL,updated_at=?
      WHERE period<>? AND status IN ('queued','running') AND NOT EXISTS(SELECT 1 FROM daily_diagnosis_jobs j WHERE j.platform=daily_diagnosis_state.platform AND j.period=daily_diagnosis_state.period AND j.status IN ('queued','running'))`,now(),automaticPeriod);
    // Recover writes interrupted between job persistence and state publication.
    const latestJob = `(SELECT j.status FROM daily_diagnosis_jobs j WHERE j.platform=daily_diagnosis_state.platform AND j.period=daily_diagnosis_state.period AND j.input_hash=daily_diagnosis_state.input_hash ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1)`;
    await run(env, `UPDATE daily_diagnosis_state SET status=${latestJob},
      current_report_id=COALESCE((SELECT j.run_id FROM daily_diagnosis_jobs j WHERE j.platform=daily_diagnosis_state.platform AND j.period=daily_diagnosis_state.period AND j.input_hash=daily_diagnosis_state.input_hash AND j.status='success' ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1),current_report_id),
      error=(SELECT j.error FROM daily_diagnosis_jobs j WHERE j.platform=daily_diagnosis_state.platform AND j.period=daily_diagnosis_state.period AND j.input_hash=daily_diagnosis_state.input_hash ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1)
      WHERE status='running' AND ${latestJob} IN ('success','failed')`);
    await run(env, `UPDATE daily_diagnosis_jobs SET status='superseded' WHERE status='queued' AND NOT EXISTS(SELECT 1 FROM daily_diagnosis_state s WHERE s.platform=daily_diagnosis_jobs.platform AND s.period=daily_diagnosis_jobs.period AND s.input_hash=daily_diagnosis_jobs.input_hash AND s.active=1)`);
    // This monitor lease can be acquired only after the previous executor has
    // released it or expired. Recover its persisted checkpoint with bounded retries.
    for (const interrupted of await rows<Job>(env,"SELECT * FROM daily_diagnosis_jobs WHERE status='running'")) {
      const retry = interrupted.retry_count < 2 && interrupted.continuation_count < 6;
      const status = retry ? 'queued' : 'failed';
      const error = retry ? '执行中断，已安排恢复' : '生成执行中断，自动恢复次数已用完';
      await run(env,"UPDATE daily_diagnosis_jobs SET status=?,stage=?,retry_count=retry_count+1,next_attempt_at=?,error=?,progress_at=?,finished_at=? WHERE run_id=?",status,retry ? interrupted.checkpoint ? 'continuing' : 'retry_wait' : interrupted.stage,Date.now()+60000,error,now(),retry?null:now(),interrupted.run_id);
      await run(env,"UPDATE daily_diagnosis_state SET status=?,error=?,updated_at=? WHERE platform=? AND period=? AND input_hash=?",status,error,now(),interrupted.platform,interrupted.period,interrupted.input_hash);
    }
    // Publishing a multi-source refresh is not an atomic snapshot. Wait for the sync job to finish.
    const syncing = await rows(env, "SELECT run_id FROM sync_jobs WHERE status IN ('queued','running','pausing') LIMIT 1");
    if (syncing.length || (!manual && await diagnosesSettling(env))) return { status:'waiting_data' };
    // Retire only unstarted automatic Friday work, including checkpoint retries.
    // Keep successful histories, manual requests and active executors intact.
    await run(env, "UPDATE daily_diagnosis_jobs SET status='superseded' WHERE status='queued' AND requested_by='automatic' AND strftime('%w',period)='5'");
    await run(env, `UPDATE daily_diagnosis_state SET status='weekly',error=NULL,updated_at=?
      WHERE strftime('%w',period)='5' AND current_report_id IS NULL AND status IN ('queued','waiting','failed')
      AND NOT EXISTS(SELECT 1 FROM daily_diagnosis_jobs j WHERE j.platform=daily_diagnosis_state.platform AND j.period=daily_diagnosis_state.period AND (j.status IN ('queued','running') OR j.requested_by='manual'))`,now());
    const version = `${REPORT_SKILL_SHA256}:${env.KIMI_MODEL || 'kimi-k3'}:overall-companion-v1:weekly-coverage-v1`;
    if (revision !== snapshot.checked_revision || snapshot.checked_day !== today || snapshot.checked_version !== version || snapshot.retry_pending) {
      const detection = await dependencies.detect(targetPeriod);
      if (detection.latestDay !== targetPeriod) {
        for (const platform of ['all','web','app']) await run(env,`INSERT INTO daily_diagnosis_state(platform,period,active,status,error,updated_at) VALUES(?,?,0,'waiting',?,?) ON CONFLICT(platform,period) DO UPDATE SET status=CASE WHEN current_report_id IS NOT NULL THEN 'success' ELSE 'waiting' END,error=excluded.error,updated_at=excluded.updated_at`,platform,targetPeriod,`${targetPeriod} 监测数据未就绪；不会回退到历史日期自动诊断`,now());
        return {status:'waiting_data'};
      }
      const signals = detection.alerts.filter(s=>s.metric==='totalGmv');
      for (const platform of ['all','web','app'] as const) {
        if (manual && targetPeriod !== automaticPeriod && platform !== manual.platform) continue;
        const ownSignals = signals.filter(s=>s.platform===platform && s.period===detection.latestDay);
        const clientSignals = signals.filter(s=>s.platform!=='all' && s.period===detection.latestDay);
        const companion = platform==='all' && !ownSignals.length && clientSignals.length>0;
        // Keep one client's validated comparison (week first) as the context anchor.
        const anchor = clientSignals.find(s=>s.window==='week') ?? clientSignals[0];
        const selected = companion ? clientSignals.filter(s=>s.platform===anchor.platform) : ownSignals;
        if (!companion && detection.monitoredPlatforms && !detection.monitoredPlatforms.includes(platform)) {
          await run(env, `INSERT INTO daily_diagnosis_state(platform,period,active,status,error,updated_at) VALUES(?,?,0,'waiting',?,?) ON CONFLICT(platform,period) DO UPDATE SET status='waiting',error=excluded.error,updated_at=excluded.updated_at`,platform,detection.latestDay,'历史监测样本或比较日不完整，暂不能判断异动',now());
          await run(env,"UPDATE daily_diagnosis_jobs SET status='superseded' WHERE platform=? AND period=? AND status='queued'",platform,detection.latestDay);
          continue;
        }
        if (!selected.length) {
          await run(env, `INSERT INTO daily_diagnosis_state(platform,period,active,status,updated_at) VALUES(?,?,0,'normal',?) ON CONFLICT(platform,period) DO UPDATE SET active=0,status=CASE WHEN daily_diagnosis_state.active=1 OR daily_diagnosis_state.current_report_id IS NOT NULL THEN 'clear' ELSE 'normal' END,error=NULL,updated_at=excluded.updated_at`,platform,detection.latestDay,now());
          await run(env,"UPDATE daily_diagnosis_jobs SET status='superseded' WHERE platform=? AND period=? AND status='queued'",platform,detection.latestDay);
          continue;
        }
        const comparison = dailyComparison(selected);
        const existing = (await rows<State>(env,'SELECT * FROM daily_diagnosis_state WHERE platform=? AND period=?',platform,comparison.date))[0];
        // Automatic diagnosis is once per platform/day, even if later source
        // corrections or model/skill revisions change the evidence fingerprint.
        if (!manual && existing?.current_report_id) {
          const latest = (await rows<{requested_by:string}>(env,'SELECT requested_by FROM daily_diagnosis_jobs WHERE platform=? AND period=? ORDER BY created_at DESC,rowid DESC LIMIT 1',platform,comparison.date))[0];
          if (latest?.requested_by === 'manual') continue;
          await run(env,"UPDATE daily_diagnosis_jobs SET status='superseded' WHERE platform=? AND period=? AND requested_by='automatic' AND status='queued'",platform,comparison.date);
          await run(env,"UPDATE daily_diagnosis_state SET status='success',error=NULL WHERE platform=? AND period=?",platform,comparison.date);
          continue;
        }
        if (coveredByWeeklyDiagnosis(comparison.date) && !(manual?.platform === platform && manual.period === comparison.date)) {
          const explicit = await rows(env,"SELECT run_id FROM daily_diagnosis_jobs WHERE platform=? AND period=? AND requested_by='manual' LIMIT 1",platform,comparison.date);
          if (explicit.length) continue;
          if (!existing?.current_report_id) await run(env,`INSERT INTO daily_diagnosis_state(platform,period,baseline,active,status,signals,updated_at) VALUES(?,?,?,1,'weekly',?,?) ON CONFLICT(platform,period) DO UPDATE SET baseline=excluded.baseline,active=1,status='weekly',signals=excluded.signals,error=NULL,updated_at=excluded.updated_at`,platform,comparison.date,comparison.baselineDate,JSON.stringify(selected),now());
          continue;
        }
        try {
          const evidence = prepareReportData(await (dependencies.collect ?? ((s,context)=>collect(env,s,context)))(selected,companion));
          if (companion && !['web','app'].every(scope=>evidence.platformEvidence.some(item=>item.platform===scope))) throw new Error('大盘诊断需要 Web 与 App 的完整证据，等待补刷');
          for (const item of evidence.platformEvidence) {
            for (const key of ['pay','funnel','renewal'] as const) {
              const source = item.evidence.sources[key];
              if (!source.complete) throw new Error(`${item.platform || platform} · ${source.source || key} 缺少可比数据：${source.missing?.join('、') || source.error || '读取失败'}；请在数据与口径页处理，诊断不会自动同步数据`);
            }
          }
          const hash = await dailyInputHash(evidence,env.KIMI_MODEL);
          if (existing?.input_hash !== hash) {
            const cached = (await rows<Job>(env,"SELECT * FROM daily_diagnosis_jobs WHERE platform=? AND period=? AND input_hash=? AND status='success' ORDER BY finished_at DESC,rowid DESC LIMIT 1",platform,comparison.date,hash))[0];
            if (cached) {
              await run(env,"UPDATE daily_diagnosis_jobs SET status='superseded' WHERE platform=? AND period=? AND status='queued'",platform,comparison.date);
              await run(env,`INSERT INTO daily_diagnosis_state(platform,period,baseline,active,status,input_hash,signals,current_report_id,updated_at) VALUES(?,?,?,1,'success',?,?,?,?) ON CONFLICT(platform,period) DO UPDATE SET baseline=excluded.baseline,active=1,status='success',input_hash=excluded.input_hash,signals=excluded.signals,current_report_id=excluded.current_report_id,error=NULL,updated_at=excluded.updated_at`,platform,comparison.date,comparison.baselineDate,hash,JSON.stringify(selected),cached.run_id,now());
              continue;
            }
          }
          if (existing?.input_hash === hash) {
            const last = (await rows<Job>(env,'SELECT * FROM daily_diagnosis_jobs WHERE platform=? AND period=? AND input_hash=? ORDER BY created_at DESC,rowid DESC LIMIT 1',platform,comparison.date,hash))[0];
            if (last && ['queued','running','success','failed'].includes(last.status)) {
              await run(env,'UPDATE daily_diagnosis_state SET active=1,status=?,signals=?,error=?,updated_at=? WHERE platform=? AND period=?',last.status,JSON.stringify(selected),last.error,now(),platform,comparison.date);
              continue;
            }
          }
          await run(env,"UPDATE daily_diagnosis_jobs SET status='superseded' WHERE platform=? AND period=? AND status='queued'",platform,comparison.date);
          const id=crypto.randomUUID();
          const storedEvidence = await saveContent(env,`daily-diagnoses/evidence/${hash}.json`,JSON.stringify(evidence));
          await run(env,`INSERT INTO daily_diagnosis_jobs(run_id,platform,period,baseline,input_hash,evidence,status,requested_by,created_at) VALUES(?,?,?,?,?,?,'queued',?,?)`,id,platform,comparison.date,comparison.baselineDate,hash,storedEvidence,manual?.platform===platform && manual.period===comparison.date?'manual':'automatic',now());
          await run(env,`INSERT INTO daily_diagnosis_state(platform,period,baseline,active,status,input_hash,signals,updated_at) VALUES(?,?,?,1,'queued',?,?,?) ON CONFLICT(platform,period) DO UPDATE SET baseline=excluded.baseline,active=1,status='queued',input_hash=excluded.input_hash,signals=excluded.signals,error=NULL,updated_at=excluded.updated_at`,platform,comparison.date,comparison.baselineDate,hash,JSON.stringify(selected),now());
        } catch(e) {
          await run(env,"UPDATE daily_diagnosis_jobs SET status='superseded' WHERE platform=? AND period=? AND status='queued'",platform,comparison.date);
          await run(env,`INSERT INTO daily_diagnosis_state(platform,period,baseline,active,status,signals,error,updated_at) VALUES(?,?,?,1,'waiting',?,?,?) ON CONFLICT(platform,period) DO UPDATE SET active=1,status='waiting',signals=excluded.signals,error=excluded.error,updated_at=excluded.updated_at`,platform,comparison.date,comparison.baselineDate,JSON.stringify(selected),message(e),now());
          // Keep revision dirty so incomplete source data is retried, never silently cleared.
        }
      }
      const changed = (await rows<{revision:number}>(env,'SELECT revision FROM daily_diagnosis_monitor WHERE id=1'))[0].revision !== revision;
      if (changed) return {status:'data_changed'};
      const waiting = await rows(env,"SELECT platform FROM daily_diagnosis_state WHERE period=? AND status='waiting'",detection.latestDay);
      if (targetPeriod === automaticPeriod) await run(env,'UPDATE daily_diagnosis_monitor SET checked_revision=?,checked_day=?,checked_at=?,checked_version=?,retry_pending=?,last_error=NULL WHERE id=1 AND lease_id=?',revision,today,now(),version,waiting.length?1:0,lease);
    }
    const job = (await rows<Job>(env,`SELECT j.* FROM daily_diagnosis_jobs j JOIN daily_diagnosis_state s ON s.platform=j.platform AND s.period=j.period AND s.input_hash=j.input_hash WHERE j.status='queued' AND j.next_attempt_at<=${clock} AND s.active=1 ${manual ? 'AND j.platform=? AND j.period=?' : "AND (j.period=? OR j.requested_by='manual')"} ORDER BY CASE WHEN j.requested_by='manual' THEN 0 ELSE 1 END,j.created_at,j.rowid LIMIT 1`, ...(manual ? [manual.platform, manual.period] : [targetPeriod])))[0];
    if (!job) return {status:'idle'};
    const execution = await claimDiagnosisExecution(env, 'anomaly', Boolean(manual));
    if (!execution) return { status: 'waiting_report' };
    try {
      await run(env,"UPDATE daily_diagnosis_jobs SET status='running',stage='loading_evidence',progress_at=? WHERE run_id=?",now(),job.run_id);
      await run(env,"UPDATE daily_diagnosis_state SET status='running',error=NULL,updated_at=? WHERE platform=? AND period=? AND input_hash=?",now(),job.platform,job.period,job.input_hash);
      try {
        if (!env.KIMI_API_KEY && !dependencies.generate) throw new Error('日诊断模型未配置');
        const evidence = prepareReportData(JSON.parse(await readContent(env,job.evidence)));
        let checkpoint = job.checkpoint ? await readContent(env, job.checkpoint) : '';
        const progress = async (stage: string, partial?: string) => {
          if (partial && partial !== checkpoint) {
            checkpoint = partial;
            const stored = await saveContent(env,`daily-diagnoses/checkpoints/${job.run_id}.md`,partial);
            await run(env,'UPDATE daily_diagnosis_jobs SET checkpoint=? WHERE run_id=?',stored,job.run_id);
          }
          await run(env,'UPDATE daily_diagnosis_jobs SET stage=?,progress_at=? WHERE run_id=?',stage,now(),job.run_id);
        };
        await progress('calling_model');
        const markdown = await (dependencies.generate ?? (e=>generateMarkdown(env,e,'',progress,{prefix:checkpoint,timeBudgetMs:manual ? 540000 : 210000})))(evidence);
        await progress('saving_report');
        const storedMarkdown = await saveContent(env,`daily-diagnoses/reports/${job.run_id}.md`,markdown);
        await run(env,"UPDATE daily_diagnosis_jobs SET status='success',stage='complete',error=NULL,markdown=?,model=?,finished_at=? WHERE run_id=?",storedMarkdown,env.KIMI_MODEL||'kimi-k3',now(),job.run_id);
        // Changes arriving during generation invalidate publication, while retaining the historical result.
        await run(env,`UPDATE daily_diagnosis_state SET current_report_id=?,status=CASE WHEN (SELECT revision FROM daily_diagnosis_monitor WHERE id=1)=? THEN 'success' ELSE 'waiting' END,updated_at=? WHERE platform=? AND period=? AND active=1 AND input_hash=?`,job.run_id,revision,now(),job.platform,job.period,job.input_hash);
      } catch(e) {
        // Automatic attempts finish before the platform cron deadline. Manual streams
        // can keep their request open longer; neither path publishes anything but complete
        // model output is published; transport failures retain evidence and partial prose.
        const partial = e instanceof ModelInterruptedError ? e.partial : '';
        const previous = job.checkpoint ? await readContent(env,job.checkpoint) : '';
        const advanced = partial.length > previous.length;
        const recoverable = e instanceof ModelInterruptedError && e.retryable && (advanced ? job.continuation_count < 6 : job.retry_count < 2);
        const stored = partial ? await saveContent(env,`daily-diagnoses/checkpoints/${job.run_id}.md`,partial) : job.checkpoint;
        const nextStatus = recoverable ? 'queued' : 'failed';
        const stage = recoverable ? advanced ? 'continuing' : 'retry_wait' : null;
        await run(env,"UPDATE daily_diagnosis_jobs SET status=?,stage=COALESCE(?,stage),checkpoint=?,retry_count=retry_count+?,continuation_count=continuation_count+?,next_attempt_at=?,error=?,progress_at=?,finished_at=? WHERE run_id=?",
          nextStatus,stage,stored,advanced?0:1,advanced?1:0,recoverable?Date.now()+60000:0,message(e),now(),recoverable?null:now(),job.run_id);
        await run(env,"UPDATE daily_diagnosis_state SET status=?,error=?,updated_at=? WHERE platform=? AND period=? AND input_hash=?",nextStatus,message(e),now(),job.platform,job.period,job.input_hash);
      }
    } finally { await releaseDiagnosisExecution(env, execution); }
    return {status:'processed',runId:job.run_id};
  } catch(e) {
    await run(env,'UPDATE daily_diagnosis_monitor SET last_error=? WHERE id=1',message(e));
    throw e;
  } finally {
    await run(env,'UPDATE daily_diagnosis_monitor SET lease_id=NULL,lease_until=0 WHERE id=1 AND lease_id=?',lease);
  }
}


function dailyTask(job: Job): NonNullable<DailyDiagnosisStatus['task']> {
  const stage = job.stage || 'queued';
  const keys = ['loading_evidence','calling_model','model_accepted','saving_report'];
  const index = stage === 'complete' ? 4 : stage === 'model_streaming' || stage === 'continuing' ? 2 : stage === 'retry_wait' ? 1 : Math.max(0,keys.indexOf(stage));
  return {
    runId:job.run_id,status:job.status as 'queued'|'running'|'success'|'failed',startedAt:job.created_at,
    updatedAt:job.finished_at||job.progress_at||job.created_at,finishedAt:job.finished_at||undefined,
    stage,errorMessage:job.error||undefined,retryCount:job.retry_count||0,
    nextAttemptAt:job.next_attempt_at ? new Date(job.next_attempt_at).toISOString() : undefined,
    steps:['读取诊断证据','请求诊断模型','生成诊断正文','保存报告'].map((label,i)=>({key:keys[i],label,
      status:job.status==='success'||i<index?'success':i===index?job.status==='failed'?'failed':job.status==='running'?'running':'waiting':'waiting',
      detail:i===index ? stage==='continuing'?'已保存正文，等待继续生成':stage==='retry_wait'?`模型连接异常，等待自动重试（${job.retry_count}/2）`:job.status==='queued'?'等待数据稳定或其他诊断任务完成':undefined : undefined})),
  };
}

export async function getDailyDiagnosis(env: Env, platform: DashboardPlatform, period?: string, taskOnly = false): Promise<DailyDiagnosisStatus> {
  const state = (await rows<State>(env,`SELECT * FROM daily_diagnosis_state WHERE platform=? ${period?'AND period=?':''} ORDER BY period DESC LIMIT 1`,platform,...(period?[period]:[])))[0];
  const monitor = (await rows<{revision:number;checked_revision:number;last_error:string|null}>(env,'SELECT revision,checked_revision,last_error FROM daily_diagnosis_monitor WHERE id=1'))[0];
  if (!state) return {platform,period:period||'',baseline:'',status:'waiting',error:monitor?.last_error||undefined,updatedAt:''};
  const latest = (await rows<Job>(env,'SELECT * FROM daily_diagnosis_jobs WHERE platform=? AND period=? AND input_hash=? ORDER BY created_at DESC,rowid DESC LIMIT 1',platform,state.period,state.input_hash))[0];
  const report = !taskOnly && state.current_report_id ? (await rows<Job>(env,'SELECT * FROM daily_diagnosis_jobs WHERE run_id=?',state.current_report_id))[0] : undefined;
  return {platform,period:state.period,baseline:state.baseline, status:state.status,
    error:state.error||(latest?.status!=='superseded'?latest?.error:null)||monitor.last_error||undefined,updatedAt:state.updated_at,
    task: latest && latest.status !== 'superseded' ? dailyTask(latest) : undefined,
    report:report?.markdown?{runId:report.run_id,platform,periodStart:report.baseline,periodEnd:report.period,markdown:await readContent(env,report.markdown),modelUsed:report.model,degraded:false,generatedAt:report.finished_at!}:undefined};
}
export async function regenerateDailyDiagnosis(env: Env, platform: DashboardPlatform, period: string) {
  const state = (await rows<State>(env,'SELECT * FROM daily_diagnosis_state WHERE platform=? AND period=?',platform,period))[0];
  if (!state?.active) throw new Error('该日当前未触发 GMV 异动');
  if (state.status === 'running') return getDailyDiagnosis(env,platform,period);
  if (state.status === 'queued') {
    await run(env, "UPDATE daily_diagnosis_jobs SET requested_by='manual',next_attempt_at=0 WHERE platform=? AND period=? AND status='queued'", platform, period);
    return getDailyDiagnosis(env,platform,period);
  }
  if (state.status==='weekly') { await markDailyDiagnosisDirty(env,0); return getDailyDiagnosis(env,platform,period); }
  if (state.status==='waiting') { await markDailyDiagnosisDirty(env,0); return getDailyDiagnosis(env,platform,period); }
  const previous = (await rows<Job>(env,'SELECT * FROM daily_diagnosis_jobs WHERE platform=? AND period=? AND input_hash=? ORDER BY created_at DESC,rowid DESC LIMIT 1',platform,period,state.input_hash))[0];
  if (!previous) throw new Error('缺少完整日诊断数据，等待补刷');
  await run(env,`INSERT OR IGNORE INTO daily_diagnosis_jobs(run_id,platform,period,baseline,input_hash,evidence,status,requested_by,created_at) VALUES(?,?,?,?,?,?,'queued','manual',?)`,crypto.randomUUID(),platform,period,previous.baseline,previous.input_hash,previous.evidence,now());
  await run(env,"UPDATE daily_diagnosis_state SET status='queued',error=NULL,updated_at=? WHERE platform=? AND period=?",now(),platform,period);
  return getDailyDiagnosis(env,platform,period);
}
