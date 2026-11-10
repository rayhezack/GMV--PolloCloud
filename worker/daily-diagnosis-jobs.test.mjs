import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { REPORT_SKILL_SHA256 } from './report-skill.generated.ts';
const bundle=await build({entryPoints:['worker/daily-diagnosis-jobs.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {tickDailyDiagnoses,getDailyDiagnosis,regenerateDailyDiagnosis,markDailyDiagnosisDirty,dailyInputHash}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const sql=await readFile('db/0025_daily_diagnoses.sql','utf8') + await readFile('db/0027_diagnosis_dispatch.sql','utf8') + await readFile('db/0029_daily_diagnosis_recovery.sql','utf8');
const day='2026-11-08';
function setup(){
 const db=new DatabaseSync(':memory:');db.exec(sql);db.exec('CREATE TABLE sync_jobs(run_id TEXT,status TEXT)');
 const prepare=sql=>{const statement=db.prepare(sql);const bound=(values=[])=>({bind:(...v)=>bound(v),all:async()=>({results:statement.all(...values)}),first:async()=>statement.get(...values)||null,run:async()=>statement.run(...values)});return bound();};
 return {db,env:{DB:{prepare}}};
}
function signal(platform='web',window='day'){return {platform,period:day,metric:'totalGmv',window,baselinePeriod:window==='day'?'2026-11-07':'2026-11-01',direction:'down',change:-.2,threshold:-.1,currentDailyAvg:80,previousDailyAvg:100,historyCount:84,baselineWindow:'12_complete_weeks'};}
// The default fixture has only Web evidence; overall context must wait for App.
function evidence(n=80){return {schemaVersion:3,mode:'day',checks:[],comparison:{date:day,amount:n},platformEvidence:[{evidence:{schemaVersion:2,checks:[],sources:Object.fromEntries(['pay','funnel','renewal'].map(k=>[k,{complete:true,readAt:new Date().toISOString()}]))}}]};}
function deps(overrides={}){return {detect:async()=>({latestDay:day,alerts:[signal()]}),collect:async()=>evidence(),generate:async()=> '# 日诊断\n\n**模型原文，禁止程序拼写。**\n\n## 原因诊断\n\n1. **已知边界：** 待检查。',...overrides};}
test('backend tick creates report without any browser request; repeated refresh reuses exact model output',async()=>{
 const {db,env}=setup();let calls=0;const d=deps({generate:async()=>{calls++;return '**原文**\n\n|数|值|\n|--|--|\n|a|b|';}});
 await tickDailyDiagnoses(env,d);assert.equal(calls,1);let s=await getDailyDiagnosis(env,'web');assert.equal(s.status,'success');assert.equal(s.report.markdown,'**原文**\n\n|数|值|\n|--|--|\n|a|b|');
 await markDailyDiagnosisDirty(env,0);await tickDailyDiagnoses(env,d);assert.equal(calls,1);assert.equal(db.prepare('SELECT count(*) n FROM daily_diagnosis_jobs').get().n,1);
});
test('large real-sized evidence and model prose use storage, D1 values remain small and retries read identical evidence',async()=>{
 const {env,db}=setup();const objects=new Map();env.STORAGE={put:async(k,v)=>{objects.set(k,v);},getText:async k=>objects.get(k)??null};
 const e=evidence();e.longData='数'.repeat(500000);const prose='完整原文'.repeat(20000);let calls=0;
 const d=deps({collect:async()=>e,generate:async input=>{calls++;assert.deepEqual(input,e);return prose;}});
 await tickDailyDiagnoses(env,d);
 const job=db.prepare('SELECT evidence,markdown FROM daily_diagnosis_jobs').get();
 assert.ok(job.evidence.startsWith('daily-storage:'));assert.ok(job.markdown.startsWith('daily-storage:'));
 assert.ok(job.evidence.length<200&&job.markdown.length<200);assert.equal((await getDailyDiagnosis(env,'web')).report.markdown,prose);
 await markDailyDiagnosisDirty(env,0);await tickDailyDiagnoses(env,d);assert.equal(calls,1);
 await regenerateDailyDiagnosis(env,'web',day);await tickDailyDiagnoses(env,d);assert.equal(calls,2);assert.equal((await getDailyDiagnosis(env,'web')).report.markdown,prose);
});
test('missing storage defers oversized evidence without a partial D1 row or model call',async()=>{
 const {env,db}=setup();const e=evidence();e.longData='x'.repeat(70000);let calls=0;
 await tickDailyDiagnoses(env,deps({collect:async()=>e,generate:async()=>{calls++;return 'bad';}}));
 assert.equal(calls,0);assert.equal(db.prepare('SELECT count(*) n FROM daily_diagnosis_jobs').get().n,0);
 assert.equal((await getDailyDiagnosis(env,'web')).status,'waiting');assert.match((await getDailyDiagnosis(env,'web')).error,/文件存储/);
});
test('changed input generates one new history version, failed generation permits manual retry',async()=>{
 const {env,db}=setup();let n=80,calls=0,fail=false;const d=deps({collect:async()=>evidence(n),generate:async()=>{calls++;if(fail)throw Error('model offline');return `report ${n}`;}});
 await tickDailyDiagnoses(env,d);n=79;fail=true;await markDailyDiagnosisDirty(env,0);await tickDailyDiagnoses(env,d);assert.equal((await getDailyDiagnosis(env,'web')).status,'failed');
 await markDailyDiagnosisDirty(env,0);await tickDailyDiagnoses(env,d);assert.equal(calls,2,'unchanged failure does not auto retry paid call');
 fail=false;await regenerateDailyDiagnosis(env,'web',day);await Promise.all([regenerateDailyDiagnosis(env,'web',day),regenerateDailyDiagnosis(env,'web',day)]);await tickDailyDiagnoses(env,d);assert.equal(calls,3);assert.equal((await getDailyDiagnosis(env,'web')).report.markdown,'report 79');assert.equal(db.prepare('SELECT count(*) n FROM daily_diagnosis_jobs').get().n,3);
});
test('concurrent cron calls are serialized, refresh during generation never publishes stale report as current',async()=>{
 const {env}=setup();let release;const gate=new Promise(r=>release=r);let started;const ready=new Promise(r=>started=r);let calls=0;
 const d=deps({generate:async()=>{calls++;started();await gate;return 'old version';}});const first=tickDailyDiagnoses(env,d);await ready;
 assert.equal((await tickDailyDiagnoses(env,d)).status,'busy');await markDailyDiagnosisDirty(env,0);release();await first;assert.equal((await getDailyDiagnosis(env,'web')).status,'waiting');assert.equal(calls,1);
 await tickDailyDiagnoses(env,deps());assert.equal((await getDailyDiagnosis(env,'web')).status,'success');assert.equal((await getDailyDiagnosis(env,'web')).report.markdown,'old version');
});
test('cleared anomaly retains dated historical result; revenue subtypes never independently trigger',async()=>{
 const {env,db}=setup();await tickDailyDiagnoses(env,deps());await markDailyDiagnosisDirty(env,0);
 await tickDailyDiagnoses(env,deps({detect:async()=>({latestDay:day,alerts:[{...signal(),metric:'activeGmv'}]}),generate:async()=>{throw Error('must not call');}}));
 const s=await getDailyDiagnosis(env,'web');assert.equal(s.status,'clear');assert.ok(s.report.generatedAt);assert.equal(db.prepare('SELECT count(*) n FROM daily_diagnosis_jobs').get().n,1);
 await assert.rejects(regenerateDailyDiagnosis(env,'web',day),/未触发/);
});
test('incomplete source or sync in progress defers model, never treats missing data as cleared',async()=>{
 const {env,db}=setup();let calls=0;const d=deps({collect:async()=>{const e=evidence();e.platformEvidence[0].evidence.sources.renewal.complete=false;return e;},generate:async()=>{calls++;return 'bad';}});
 await tickDailyDiagnoses(env,d);assert.equal((await getDailyDiagnosis(env,'web')).status,'waiting');assert.equal(calls,0);
 db.exec("INSERT INTO sync_jobs VALUES('sync','running')");assert.equal((await tickDailyDiagnoses(env,deps())).status,'waiting_data');
});
test('both signals use prior-week baseline and only one queued report per scope, all/web/app are separate',async()=>{
 const {env,db}=setup();await tickDailyDiagnoses(env,deps({detect:async()=>({latestDay:day,alerts:['all','web','app'].flatMap(p=>[signal(p),signal(p,'week')])})}));
 assert.equal(db.prepare('SELECT count(*) n FROM daily_diagnosis_jobs').get().n,3);assert.ok(db.prepare('SELECT baseline FROM daily_diagnosis_jobs').all().every(r=>r.baseline==='2026-11-01'));
 await tickDailyDiagnoses(env,deps());await tickDailyDiagnoses(env,deps());for(const p of ['all','web','app'])assert.equal((await getDailyDiagnosis(env,p)).status,'success');
});
test('expired executor recovers with backoff and a finite retry budget',async()=>{
 const {env,db}=setup();await tickDailyDiagnoses(env,deps());await regenerateDailyDiagnosis(env,'web',day);
 for(let i=0;i<3;i++){
  db.exec("UPDATE daily_diagnosis_jobs SET status='running' WHERE status='queued'; UPDATE daily_diagnosis_state SET status='running' WHERE platform='web'");
  await tickDailyDiagnoses(env,deps({generate:async()=>{throw Error('backoff must not dispatch');}}));
  assert.equal((await getDailyDiagnosis(env,'web')).status,i<2?'queued':'failed');
 }
});
test('fingerprint ignores read timestamps and SQL row order, detects actual amounts and Skill/model version',async()=>{
 const a={readAt:'one',rows:[{country:'US',n:1},{country:'GB',n:2}]},b={readAt:'two',rows:[{country:'GB',n:2},{country:'US',n:1}]};
 assert.equal(await dailyInputHash(a),await dailyInputHash(b));b.rows[0].n=3;assert.notEqual(await dailyInputHash(a),await dailyInputHash(b));assert.notEqual(await dailyInputHash(a,'m1'),await dailyInputHash(a,'m2'));
});
test('interrupted publication recovers successful raw report without another model call',async()=>{
 const {env,db}=setup();await tickDailyDiagnoses(env,deps());db.exec("UPDATE daily_diagnosis_state SET status='running',current_report_id=NULL WHERE platform='web'");
 await tickDailyDiagnoses(env,deps({generate:async()=>{throw Error('no duplicate');}}));const s=await getDailyDiagnosis(env,'web');assert.equal(s.status,'success');assert.ok(s.report.markdown);
});
test('missing historical monitor scope is not marked clear',async()=>{
 const {env}=setup();await tickDailyDiagnoses(env,deps({detect:async()=>({latestDay:day,alerts:[],monitoredPlatforms:['all']})}));assert.equal((await getDailyDiagnosis(env,'web')).status,'waiting');
});
test('actual cron HTTP route invokes the model without a dashboard visit; GET remains read-only',async()=>{
 const {env,db}=setup();const b=await build({entryPoints:['worker/index.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});const {default:worker}=await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
 const stamp=new Date().toISOString(),today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),input=JSON.stringify(evidence());
 db.prepare('UPDATE daily_diagnosis_monitor SET checked_revision=revision,checked_day=?,checked_version=?').run(today,`${REPORT_SKILL_SHA256}:kimi-k3:overall-companion-v1`);
 db.prepare("INSERT INTO daily_diagnosis_jobs(run_id,platform,period,baseline,input_hash,evidence,status,requested_by,created_at) VALUES('http','web',?,'2026-11-01','hash',?,'queued','automatic',?)").run(day,input,stamp);
 db.prepare("INSERT INTO daily_diagnosis_state(platform,period,baseline,active,status,input_hash,updated_at) VALUES('web',?,'2026-11-01',1,'queued','hash',?)").run(day,stamp);
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response(`data: ${JSON.stringify({choices:[{delta:{content:'**HTTP模型原文**'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);};
 const tasks=[],context={waitUntil:p=>tasks.push(p)};
 try{
  const denied=await worker.fetch(new Request('http://local/api/cron/daily-diagnoses'),env,context);assert.equal(denied.status,403);assert.equal(calls,0);
  const response=await worker.fetch(new Request('http://local/api/cron/reports',{headers:{'x-pollocloud-trigger':'cron','x-pollocloud-scheduled-time':'2026-11-09T16:00:00Z'}}),{...env,KIMI_API_KEY:'fixture'},context);assert.equal((await response.json()).status,'processed');await Promise.all(tasks);assert.equal(calls,1);
  const read=await worker.fetch(new Request('http://local/api/daily-diagnosis?platform=web&period=2026-11-08'),env,context);assert.equal((await read.json()).report.markdown,'**HTTP模型原文**');assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test('shared report schedule keeps five cron entries and preserves every Shanghai weekly slot',async()=>{
 const b=await build({entryPoints:['worker/index.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
 const {weeklyReportPlatformAt}=await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
 const config=JSON.parse(await readFile('pollocloud.json','utf8'));assert.equal(config.cron.length,5);
 assert.ok(config.cron.some(c=>c.path==='/api/cron/reports'&&c.schedule==='*/5 * * * *'));
 for(let hour=0;hour<24;hour++)for(let minute=0;minute<60;minute+=5){
  const saturday=new Date(Date.UTC(2026,10,14,hour-8,minute));
  assert.equal(weeklyReportPlatformAt(saturday),minute===0?'web':minute===10?'app':null);
  const friday=new Date(Date.UTC(2026,10,13,hour-8,minute));assert.equal(weeklyReportPlatformAt(friday),null);
 }
});
test('data returning to a previously diagnosed input reuses that historical version',async()=>{
 const {env,db}=setup();let n=80,calls=0;const d=deps({collect:async()=>evidence(n),generate:async()=>{calls++;return `version ${n}`;}});
 await tickDailyDiagnoses(env,d);n=79;await markDailyDiagnosisDirty(env,0);await tickDailyDiagnoses(env,d);n=80;await markDailyDiagnosisDirty(env,0);await tickDailyDiagnoses(env,d);
 assert.equal(calls,2);assert.equal((await getDailyDiagnosis(env,'web')).report.markdown,'version 80');assert.equal(db.prepare('SELECT count(*) n FROM daily_diagnosis_jobs').get().n,2);
});
test('actual manual HTTP mutation checks identity and only queues; it never invokes the model',async()=>{
 const {env}=setup();await tickDailyDiagnoses(env,deps());
 const b=await build({entryPoints:['worker/index.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});const {default:worker}=await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
 const original=globalThis.fetch;let authCalls=0;globalThis.fetch=async url=>{authCalls++;assert.match(String(url),/_pollocloud\/me/);return new Response('{}',{status:401});};
 try{
 const context={waitUntil:()=>{}},url='http://local/api/daily-diagnosis?platform=web&period=2026-11-08';
 assert.equal((await worker.fetch(new Request(url,{method:'POST'}),env,context)).status,401);
 const {POLLOCLOUD_APP_OWNER_ID}=await import('../shared/auth.constants.ts');
 const queued=await worker.fetch(new Request(url,{method:'POST',headers:{'x-pollocloud-user-id':POLLOCLOUD_APP_OWNER_ID}}),env,context);assert.equal((await queued.json()).status,'queued');assert.equal(authCalls,1);
 }finally{globalThis.fetch=original;}
});
test('one scope with insufficient history does not stop another scope generating',async()=>{
 const {env}=setup();await tickDailyDiagnoses(env,deps({detect:async()=>({latestDay:day,alerts:[signal()],monitoredPlatforms:['web']})}));assert.equal((await getDailyDiagnosis(env,'web')).status,'success');assert.equal((await getDailyDiagnosis(env,'app')).status,'waiting');
});
test('an interrupted failure publication is not masked by an older successful manual report',async()=>{
 const {env,db}=setup();await tickDailyDiagnoses(env,deps());await regenerateDailyDiagnosis(env,'web',day);
 db.exec("UPDATE daily_diagnosis_jobs SET status='failed',error='failure saved first' WHERE status='queued'; UPDATE daily_diagnosis_state SET status='running' WHERE platform='web'");
 await tickDailyDiagnoses(env,deps());const s=await getDailyDiagnosis(env,'web');assert.equal(s.status,'failed');assert.equal(s.error,'failure saved first');assert.ok(s.report.markdown);
});

test('source refresh waits five minutes; repeated refresh restarts the buffer and reads never bypass it',async()=>{
 const {env,db}=setup();let calls=0;
 await markDailyDiagnosisDirty(env);
 const first=db.prepare('SELECT not_before FROM diagnosis_dispatch').get().not_before;
 assert.ok(first>=Date.now()+299000);
 assert.equal((await tickDailyDiagnoses(env,deps({generate:async()=>{calls++;return 'bad';}}))).status,'waiting_data');
 await getDailyDiagnosis(env,'web');assert.equal(calls,0);
 db.prepare('UPDATE diagnosis_dispatch SET not_before=?').run(Date.now()-1);
 await markDailyDiagnosisDirty(env);
 assert.ok(db.prepare('SELECT not_before FROM diagnosis_dispatch').get().not_before>=first);
 db.prepare('UPDATE diagnosis_dispatch SET not_before=?').run(Date.now()-1);
 await tickDailyDiagnoses(env,deps({generate:async()=>{calls++;return 'ready';}}));assert.equal(calls,1);
});

test('weekly and anomaly model calls share an atomic lane; weekly work yields to dirty data and pending diagnoses',async()=>{
 const {env,db}=setup();
 const b=await build({entryPoints:['worker/diagnosis-dispatch.ts'],bundle:true,platform:'node',format:'esm',write:false});
 const {claimDiagnosisExecution,releaseDiagnosisExecution}=await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
 assert.equal(await claimDiagnosisExecution(env,'weekly'),null,'initial anomaly detection has priority');
 await tickDailyDiagnoses(env,deps());
 const weekly=await claimDiagnosisExecution(env,'weekly');assert.ok(weekly);
 assert.equal(await claimDiagnosisExecution(env,'anomaly'),null,'cannot overlap an already dispatched model call');
 await releaseDiagnosisExecution(env,weekly);
 await regenerateDailyDiagnosis(env,'web',day);
 assert.equal(await claimDiagnosisExecution(env,'weekly'),null,'queued anomaly takes priority');
 await tickDailyDiagnoses(env,deps());
 const next=await claimDiagnosisExecution(env,'weekly');assert.ok(next);
 await releaseDiagnosisExecution(env,next);
 assert.equal(db.prepare('SELECT count(*) n FROM daily_diagnosis_jobs').get().n,2);
});

test('a successful anomaly weekly report suppresses the same scheduled cycle; failed paid calls are not retried automatically',async()=>{
 const {env,db}=setup();db.exec(await readFile('db/0003_report_jobs.sql','utf8'));
 const b=await build({entryPoints:['worker/index.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
 const {queueWeeklyReport}=await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
 const payload={periodStart:'2026-10-24',periodEnd:'2026-11-06',trigger:'anomaly'};
 db.prepare('INSERT INTO report_jobs VALUES(?,?,?,?,?,?)').run('completed','web','success',JSON.stringify(payload),1,1);
 assert.equal((await queueWeeklyReport(env,'web','2026-11-06')).status,'success');
 assert.equal((await queueWeeklyReport(env,'web','2026-11-06')).status,'success');
 db.prepare('INSERT INTO report_jobs VALUES(?,?,?,?,?,?)').run('failed','app','failed',JSON.stringify(payload),1,1);
 assert.equal((await queueWeeklyReport(env,'app','2026-11-06')).status,'failed');
 assert.equal(db.prepare('SELECT count(*) n FROM report_jobs').get().n,2,'no replacement or duplicate paid jobs');
});

test('manual dispatch starts only the selected queued scope, bypasses automatic buffer and never duplicates a job', async()=>{
 const {env,db}=setup();
 // Prepare both actual anomaly scopes without dispatching a model yet.
 const token=await import('node:crypto').then(m=>m.randomUUID());
 db.prepare('UPDATE diagnosis_dispatch SET lease_id=?,lease_until=?').run(token,Date.now()+60000);
 const d=deps({detect:async()=>({latestDay:day,alerts:[signal('all'),signal('app')]})});
 assert.equal((await tickDailyDiagnoses(env,d)).status,'waiting_report');
 await markDailyDiagnosisDirty(env);
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 db.prepare('UPDATE daily_diagnosis_monitor SET checked_revision=revision,checked_day=?,checked_version=?').run(today,`${REPORT_SKILL_SHA256}:kimi-k3:overall-companion-v1`);
 db.exec('UPDATE diagnosis_dispatch SET lease_until=0');
 await regenerateDailyDiagnosis(env,'app',day);
 await regenerateDailyDiagnosis(env,'app',day);
 assert.equal(db.prepare('SELECT count(*) n FROM daily_diagnosis_jobs').get().n,2);
 let calls=0;
 assert.equal((await tickDailyDiagnoses(env,{...d,generate:async()=>{calls++;return 'manual app';}},{platform:'app',period:day})).status,'processed');
 assert.equal(calls,1);assert.equal((await getDailyDiagnosis(env,'app',day)).status,'success');
 assert.equal((await getDailyDiagnosis(env,'all',day)).status,'queued');
 assert.equal((await tickDailyDiagnoses(env,d)).status,'waiting_data','automatic work still respects buffer');
 db.exec("INSERT INTO sync_jobs VALUES('refresh','running')");
 assert.equal((await tickDailyDiagnoses(env,d,{platform:'all',period:day})).status,'waiting_data','manual work cannot use a partially published refresh');
});

test('cache-only invalidation never resets the diagnosis buffer or revision',async()=>{
 const {env,db}=setup();
 const b=await build({entryPoints:['worker/index.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
 const {invalidateDashboardCache}=await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
 db.exec('CREATE TABLE dashboard_response_cache(key TEXT)');
 const before=db.prepare('SELECT revision FROM daily_diagnosis_monitor').get().revision;
 await invalidateDashboardCache(env,true);
 const ready=db.prepare('SELECT not_before FROM diagnosis_dispatch').get().not_before;
 await invalidateDashboardCache(env);await invalidateDashboardCache(env);
 assert.equal(db.prepare('SELECT revision FROM daily_diagnosis_monitor').get().revision,before+1);
 assert.equal(db.prepare('SELECT not_before FROM diagnosis_dispatch').get().not_before,ready);
});

test('manual run HTTP endpoint authenticates and completes exactly one existing queued diagnosis',async()=>{
 const {env,db}=setup();
 const stamp=new Date().toISOString(),today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 db.prepare('UPDATE daily_diagnosis_monitor SET checked_revision=revision,checked_day=?,checked_version=?').run(today,`${REPORT_SKILL_SHA256}:kimi-k3:overall-companion-v1`);
 db.prepare("INSERT INTO daily_diagnosis_jobs(run_id,platform,period,baseline,input_hash,evidence,status,requested_by,created_at) VALUES('manual-http','web',?,'2026-11-01','hash',?,'queued','automatic',?)").run(day,JSON.stringify(evidence()),stamp);
 db.prepare("INSERT INTO daily_diagnosis_state(platform,period,baseline,active,status,input_hash,updated_at) VALUES('web',?,'2026-11-01',1,'queued','hash',?)").run(day,stamp);
 const b=await build({entryPoints:['worker/index.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
 const {default:worker}=await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
 const {POLLOCLOUD_APP_OWNER_ID}=await import('../shared/auth.constants.ts');
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(`data: ${JSON.stringify({choices:[{delta:{content:'manual raw report'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);};
 try{
  const tasks=[],context={waitUntil:p=>tasks.push(p)};
  const response=await worker.fetch(new Request(`http://local/api/daily-diagnosis/run?platform=web&period=${day}`,{method:'POST',headers:{'x-pollocloud-user-id':POLLOCLOUD_APP_OWNER_ID}}),{...env,KIMI_API_KEY:'fixture'},context);
  const result=await response.json();await Promise.all(tasks);
  assert.equal(result.status,'success');assert.equal(result.report.markdown,'manual raw report');assert.equal(calls,1);
  assert.equal(db.prepare('SELECT count(*) n FROM daily_diagnosis_jobs').get().n,1);
 }finally{globalThis.fetch=original;}
});

test('truncated model output checkpoints and continues the same task without publishing a partial report',async()=>{
 const {env,db}=setup();env.KIMI_API_KEY='fixture';let calls=0;
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,options)=>{
  const body=JSON.parse(options.body);calls++;
  if(calls===1)return new Response(`data: ${JSON.stringify({choices:[{delta:{content:'# 诊断\n\n前半段。'}}]})}\n\n`);
  assert.equal(body.messages[2].role,'assistant');assert.equal(body.messages[2].content,'# 诊断\n\n前半段。');
  return new Response(`data: ${JSON.stringify({choices:[{delta:{content:'\n\n后半段。'},finish_reason:'stop'}]})}\n\n`);
 };
 try{
  const d=deps({generate:undefined});await tickDailyDiagnoses(env,d);
  let s=await getDailyDiagnosis(env,'web',day);assert.equal(s.status,'queued');assert.equal(s.report,undefined);assert.equal(s.task.stage,'continuing');assert.ok(s.task.nextAttemptAt);
  const id=s.task.runId;db.exec('UPDATE daily_diagnosis_jobs SET next_attempt_at=0');await tickDailyDiagnoses(env,d);
  s=await getDailyDiagnosis(env,'web',day);assert.equal(s.status,'success');assert.equal(s.task.runId,id);assert.equal(s.report.markdown,'# 诊断\n\n前半段。\n\n后半段。');
  assert.equal(s.task.steps.filter(x=>x.status==='success').length,4);assert.equal(db.prepare('SELECT count(*) n FROM daily_diagnosis_jobs').get().n,1);
  assert.equal((await getDailyDiagnosis(env,'web',day,true)).report,undefined,'task polling never rereads report prose');
 }finally{globalThis.fetch=original;}
});
test('transient model failures retry twice with backoff, then expose the persisted error rather than looping forever',async()=>{
 const {env,db}=setup();env.KIMI_API_KEY='fixture';const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('',{status:520});};
 try{
  const d=deps({generate:undefined});await tickDailyDiagnoses(env,d);
  assert.equal((await getDailyDiagnosis(env,'web',day)).task.stage,'retry_wait');
  await tickDailyDiagnoses(env,d);assert.equal(calls,1,'backoff must be respected');
  db.exec('UPDATE daily_diagnosis_jobs SET next_attempt_at=0');await tickDailyDiagnoses(env,d);
  db.exec('UPDATE daily_diagnosis_jobs SET next_attempt_at=0');await tickDailyDiagnoses(env,d);
  const s=await getDailyDiagnosis(env,'web',day);assert.equal(s.status,'failed');assert.match(s.error,/520/);assert.equal(calls,3);
  await markDailyDiagnosisDirty(env,0);await tickDailyDiagnoses(env,d);assert.match((await getDailyDiagnosis(env,'web',day)).error,/520/);assert.equal(calls,3);
 }finally{globalThis.fetch=original;}
});
test('Web success and 大盘 failure retain independent task and report states without adding App',async()=>{
 const {env}=setup();const d=deps({detect:async()=>({latestDay:day,alerts:[signal('all'),signal('web')]}),generate:async()=>{throw Error('all model failed');}});
 await tickDailyDiagnoses(env,d);await tickDailyDiagnoses(env,{...d,generate:async()=> 'Web complete'});
 assert.equal((await getDailyDiagnosis(env,'all',day)).status,'failed');
 assert.equal((await getDailyDiagnosis(env,'web',day)).report.markdown,'Web complete');
 assert.equal((await getDailyDiagnosis(env,'app',day)).report,undefined);
 const [a,b]=await Promise.all([regenerateDailyDiagnosis(env,'all',day),regenerateDailyDiagnosis(env,'all',day)]);assert.equal(a.task.runId,b.task.runId);
});


test('cron response waits for the persisted diagnosis, rather than returning early streaming headers',async()=>{
 const {env,db}=setup();const stamp=new Date().toISOString(),today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 db.prepare('UPDATE daily_diagnosis_monitor SET checked_revision=revision,checked_day=?,checked_version=?').run(today,`${REPORT_SKILL_SHA256}:kimi-k3:overall-companion-v1`);
 db.prepare("INSERT INTO daily_diagnosis_jobs(run_id,platform,period,baseline,input_hash,evidence,status,requested_by,created_at) VALUES('await-cron','web',?,'2026-11-01','hash',?,'queued','automatic',?)").run(day,JSON.stringify(evidence()),stamp);
 db.prepare("INSERT INTO daily_diagnosis_state(platform,period,baseline,active,status,input_hash,updated_at) VALUES('web',?,'2026-11-01',1,'queued','hash',?)").run(day,stamp);
 const b=await build({entryPoints:['worker/index.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});const {default:worker}=await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
 const original=globalThis.fetch;let release,started;
 const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 globalThis.fetch=async()=>{started();await gate;return new Response(`data: ${JSON.stringify({choices:[{delta:{content:'finished'},finish_reason:'stop'}]})}\n\n`);};
 try{
  let responded=false;const response=worker.fetch(new Request('http://local/api/cron/reports',{headers:{'x-pollocloud-trigger':'cron','x-pollocloud-scheduled-time':'2026-11-10T00:00:00Z'}}),{...env,KIMI_API_KEY:'fixture'},{waitUntil:()=>{}}).then(r=>{responded=true;return r;});
  await ready;assert.equal(responded,false);release();assert.equal((await (await response).json()).status,'processed');assert.equal((await getDailyDiagnosis(env,'web',day)).status,'success');
 }finally{globalThis.fetch=original;release();}
});

for (const clients of [['web'], ['app'], ['web','app']]) {
 test(`client-only anomalies queue overall plus ${clients.join('+')}, reuse completed reports`,async()=>{
  const {env,db}=setup();let calls=0;
  const d=deps({detect:async()=>({latestDay:day,alerts:clients.map(p=>signal(p)),monitoredPlatforms:clients}),
    collect:async(signals,overall)=>{const e=evidence();e.comparison={...e.comparison,platform:overall?'all':signals[0].platform};
      e.platformEvidence=(overall?['web','app']:[signals[0].platform]).map(platform=>({platform,evidence:e.platformEvidence[0].evidence}));return e;},
    generate:async()=>{calls++;return 'complete original report';}});
  for(let i=0;i<clients.length+1;i++)await tickDailyDiagnoses(env,d);
  assert.equal(calls,clients.length+1);
  assert.deepEqual(db.prepare('SELECT platform FROM daily_diagnosis_jobs ORDER BY platform').all().map(r=>r.platform),['all',...clients].sort());
  for(const scope of ['all',...clients])assert.equal((await getDailyDiagnosis(env,scope,day)).status,'success');
  await markDailyDiagnosisDirty(env,0);await tickDailyDiagnoses(env,d);assert.equal(calls,clients.length+1,'no duplicate paid calls');
 });
}
test('missing overall sources keep the companion visible as waiting without blocking the anomalous client',async()=>{
 const {env}=setup();await tickDailyDiagnoses(env,deps());
 assert.equal((await getDailyDiagnosis(env,'web',day)).status,'success');
 assert.equal((await getDailyDiagnosis(env,'all',day)).status,'waiting');
 assert.match((await getDailyDiagnosis(env,'all',day)).error,/Web.*App/);
});
