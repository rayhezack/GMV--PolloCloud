import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {REPORT_SKILL} from './report-skill.generated.ts';
const bundle=await build({entryPoints:['worker/report-jobs.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {generateMarkdown,executeReport}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const evidence=JSON.parse(await readFile('archives/report-pipeline-stage2-2026-11-08/app-evidence.json','utf8'));
function stream(markdown,finish='stop'){
  const payload=`data: ${JSON.stringify({choices:[{delta:{content:markdown},finish_reason:finish}]})}\n\ndata: [DONE]\n\n`;
  const bytes=new TextEncoder().encode(payload);
  return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=37)c.enqueue(bytes.slice(i,i+37));c.close();}}));
}
test('production sends exactly the bundled Skill and every prepared datum; returns model prose unchanged',async()=>{
  const original=globalThis.fetch;let calls=0;
  const modelText='# 模型自己组织的报告\n\n核心判断由模型撰写。\n\n<!-- 表格也由模型决定是否需要 -->\n';
  globalThis.fetch=async(url,options)=>{
    calls++;assert.equal(String(url),'https://fixture.local/chat/completions');
    const body=JSON.parse(options.body);
    assert.equal(body.messages[0].content,REPORT_SKILL,'no backend writing prompt');
    assert.equal(body.response_format,undefined,'no JSON writing contract');
    const input=JSON.parse(body.messages[1].content.split('\n')[1]);
    assert.deepEqual(input,evidence,'no country/function/action truncation or route selection');
    assert.doesNotMatch(body.messages[1].content,/summaryRequired|branchRequired|factIds|evidenceRefs/);
    return stream(modelText);
  };
  try{const stages=[];assert.equal(await generateMarkdown({KIMI_BASE_URL:'https://fixture.local',KIMI_API_KEY:'fixture'},evidence,'',async stage=>stages.push(stage)),modelText);assert.equal(calls,1);assert.deepEqual(stages,['model_accepted','model_streaming']);}finally{globalThis.fetch=original;}
});
test('only explicit human revision notes are forwarded; no automatic prose correction',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;const p=JSON.parse(options.body);assert.match(p.messages[1].content,/人工审阅意见：\n不要重复金额明细/);return stream('模型自行修订后的全文');};
  try{assert.equal(await generateMarkdown({KIMI_API_KEY:'fixture'},evidence,'不要重复金额明细'),'模型自行修订后的全文');assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('incomplete stream is rejected and a job never persists the partial report',async()=>{
  const original=globalThis.fetch;let writes=0;
  globalThis.fetch=async()=>stream('未完整正文','length');
  const DB={prepare(){return {bind(){return this;},async run(){return {};},async first(){return {status:'running'};}};}};
  const files=new Map();const STORAGE={async put(key,value){files.set(key,value);},async getText(key){return files.get(key);}};
  const job={runId:'fixture',platform:'app',periodStart:'2026-10-24',periodEnd:'2026-11-06',status:'running',stage:'collect',steps:['pay','chain','renewal','creative','analyze','model','write'].map(key=>({key,label:key,status:'waiting'}))};
  try{await assert.rejects(()=>generateMarkdown({KIMI_API_KEY:'fixture'},evidence),/未完整生成/);await executeReport({DB,STORAGE,KIMI_API_KEY:'fixture'},job,{collect:async()=>({evidence}),persist:async()=>{writes++;}});assert.equal(writes,0);assert.equal(job.status,'queued');assert.equal(job.recovery.continuations,1);}finally{globalThis.fetch=original;}
});
test('data conservation failure blocks the model call; provider errors redact credentials',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{type:'rate_limit_reached_error',message:'key sk-fixturePrivateCredential exceeded TPM'}}),{status:429});};
  try{const invalid=structuredClone(evidence);invalid.checks.push({id:'revenue.total.current',passed:false});await assert.rejects(()=>generateMarkdown({KIMI_API_KEY:'fixture'},invalid),/未守恒/);assert.equal(calls,0);await assert.rejects(()=>generateMarkdown({KIMI_API_KEY:'fixture'},evidence),e=>/429.*TPM/.test(e.message)&&!e.message.includes('sk-fixturePrivateCredential'));}finally{globalThis.fetch=original;}
});

test('retries transient 524 model gateway timeouts before failing',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return calls<3?new Response('',{status:524}):stream('恢复后的报告');};
  try{assert.equal(await generateMarkdown({KIMI_API_KEY:'fixture'},evidence),'恢复后的报告');assert.equal(calls,3);}finally{globalThis.fetch=original;}
});

function recoveryFixture(){
  const files=new Map(), saved=[];
  const DB={prepare(){return {bind(){return this;},async run(){return {};},async first(){return {status:'running'};}};}};
  const STORAGE={async put(key,value){files.set(key,value);},async getText(key){return files.get(key);}};
  const job={runId:'recovery',platform:'app',periodStart:'2026-10-24',periodEnd:'2026-11-06',status:'running',stage:'collect',steps:['pay','chain','renewal','creative','analyze','model','write'].map(key=>({key,label:key,status:'waiting'}))};
  return {env:{DB,STORAGE,KIMI_API_KEY:'fixture'},job,saved};
}
test('weekly interruption survives reload, resumes the same evidence and publishes only a completed report',async()=>{
  const original=globalThis.fetch;const {env,job,saved}=recoveryFixture();let collections=0;
  const deps={collect:async()=>{collections++;return {evidence};},persist:async report=>saved.push(report)};
  globalThis.fetch=async()=>stream('# 已生成正文\n','length');
  try{
    await executeReport(env,job,deps);
    assert.equal(job.status,'queued');assert.equal(saved.length,0);assert.ok(job.nextAttemptAt>Date.now());
    const resumed=JSON.parse(JSON.stringify(job));
    globalThis.fetch=async(_url,options)=>{
      const body=JSON.parse(options.body);
      assert.equal(body.messages[2].content,'# 已生成正文\n');
      assert.deepEqual(JSON.parse(body.messages[1].content.split('\n')[1]),evidence);
      return stream('完成的后半段');
    };
    await executeReport(env,resumed,deps);
    assert.equal(collections,1);assert.equal(resumed.status,'success');assert.equal(resumed.recovery,undefined);
    assert.equal(saved[0].markdown,'# 已生成正文\n完成的后半段');
  }finally{globalThis.fetch=original;}
});
test('transient model errors have bounded automatic retries; configuration and data errors fail without retry',async()=>{
  const original=globalThis.fetch;let writes=0;
  const deps={collect:async()=>({evidence}),persist:async()=>{writes++;}};
  try{
    const {env,job}=recoveryFixture();
    globalThis.fetch=async()=>new Response('{}',{status:503});
    for(let i=0;i<3;i++)await executeReport(env,job,deps);
    assert.equal(job.status,'failed');assert.equal(job.recovery.retries,2);assert.equal(writes,0);
    const permanent=recoveryFixture();globalThis.fetch=async()=>new Response('{}',{status:401});
    await executeReport(permanent.env,permanent.job,deps);
    assert.equal(permanent.job.status,'failed');assert.equal(permanent.job.recovery.retries,0);
    const invalid=recoveryFixture();const bad=structuredClone(evidence);bad.checks.push({id:'revenue.total.current',passed:false});
    let calls=0;globalThis.fetch=async()=>{calls++;return stream('不应生成');};
    await executeReport(invalid.env,invalid.job,{...deps,collect:async()=>({evidence:bad})});
    assert.equal(invalid.job.status,'failed');assert.match(invalid.job.errorMessage,/未守恒/);assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});

test('interrupted weekly jobs recover with finite attempts; pause requests remain paused',async()=>{
  const {DatabaseSync}=await import('node:sqlite');const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE report_jobs(run_id TEXT PRIMARY KEY,platform TEXT,status TEXT,payload TEXT,created_at INTEGER,updated_at INTEGER)');
  const DB={prepare(sql){let values=[];return {bind(...args){values=args;return this;},async run(){return sqlite.prepare(sql).run(...values);},async all(){return {results:sqlite.prepare(sql).all(...values)};},async first(){return sqlite.prepare(sql).get(...values)||null;}};}};
  const {reportGenerations}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const {job}=recoveryFixture();
  for(const [id,status] of [['lost','running'],['pause','pausing']]){
    const value={...job,runId:id,status};
    sqlite.prepare('INSERT INTO report_jobs VALUES(?,?,?,?,?,?)').run(id,'app',status,JSON.stringify(value),0,0);
  }
  const env={DB};const deps={collect:async()=>{throw Error('must not collect on GET');},persist:async()=>{throw Error('must not publish on GET');}};
  try{
    for(let attempt=0;attempt<3;attempt++){
      await reportGenerations(env,new Request('https://fixture/api/report-generations/latest?platform=app'),deps);
      const row=sqlite.prepare("SELECT * FROM report_jobs WHERE run_id='lost'").get();
      assert.equal(row.status,attempt<2?'queued':'failed');
      assert.equal(JSON.parse(row.payload).recovery.retries,Math.min(2,attempt+1));
      if(attempt<2)sqlite.prepare("UPDATE report_jobs SET status='running',payload=json_set(payload,'$.status','running'),updated_at=0 WHERE run_id='lost'").run();
    }
    assert.equal(sqlite.prepare("SELECT status FROM report_jobs WHERE run_id='pause'").get().status,'paused');
  }finally{sqlite.close();}
});

test('weekly lane contention persists a retry deadline and early dispatch cannot claim or call the model',async()=>{
  const {env,job}=recoveryFixture();let modelCalls=0;
  env.DB={prepare(sql){return {bind(){return this;},async run(){return {};},async first(){return sql.includes('UPDATE diagnosis_dispatch')?null:{status:'running'};}};}};
  const original=globalThis.fetch;globalThis.fetch=async()=>{modelCalls++;return stream('should not call');};
  try{
    await executeReport(env,job,{collect:async()=>{throw Error('should not collect');},persist:async()=>{throw Error('should not publish');}});
    assert.equal(job.status,'queued');assert.ok(job.nextAttemptAt>Date.now());assert.equal(modelCalls,0);
    const {DatabaseSync}=await import('node:sqlite');const sqlite=new DatabaseSync(':memory:');
    sqlite.exec('CREATE TABLE report_jobs(run_id TEXT PRIMARY KEY,platform TEXT,status TEXT,payload TEXT,created_at INTEGER,updated_at INTEGER)');
    sqlite.prepare('INSERT INTO report_jobs VALUES(?,?,?,?,?,?)').run(job.runId,'app','queued',JSON.stringify(job),Date.now(),Date.now());
    const DB={prepare(sql){let values=[];return {bind(...args){values=args;return this;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async first(){return sqlite.prepare(sql).get(...values)||null;}};}};
    const {reportGenerations}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    const response=await reportGenerations({DB},new Request('https://fixture/api/report-generations/run',{method:'POST',body:JSON.stringify({runId:job.runId})}),{});
    assert.equal(response.status,200);assert.equal(sqlite.prepare('SELECT status FROM report_jobs').get().status,'queued');assert.equal(modelCalls,0);sqlite.close();
  }finally{globalThis.fetch=original;}
});

test('explicit retry resumes failed transport checkpoint rather than discarding completed prose',async()=>{
  const {DatabaseSync}=await import('node:sqlite');const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE report_jobs(run_id TEXT PRIMARY KEY,platform TEXT,status TEXT,payload TEXT,created_at INTEGER,updated_at INTEGER)');
  const {job}=recoveryFixture();job.status='failed';job.recovery={evidence:'weekly-storage:evidence',checkpoint:'weekly-storage:checkpoint',retries:2,continuations:1,lastError:'timeout'};job.errorMessage='timeout';
  sqlite.prepare('INSERT INTO report_jobs VALUES(?,?,?,?,?,?)').run(job.runId,'app','failed',JSON.stringify(job),Date.now(),Date.now());
  const DB={prepare(sql){let values=[];return {bind(...args){values=args;return this;},async run(){return sqlite.prepare(sql).run(...values);},async all(){return {results:sqlite.prepare(sql).all(...values)};},async first(){return sqlite.prepare(sql).get(...values)||null;}};}};
  const {reportGenerations}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  try{
    const response=await reportGenerations({DB,KIMI_API_KEY:'fixture'},new Request('https://fixture/api/report-generations',{method:'POST',body:JSON.stringify({platform:'app',granularity:'week',startDate:job.periodStart,endDate:job.periodEnd})}),{});
    assert.equal(response.status,202);const resumed=await response.json();
    assert.equal(resumed.runId,job.runId);assert.equal(resumed.status,'queued');assert.equal(resumed.recovery.checkpoint,job.recovery.checkpoint);assert.equal(resumed.recovery.retries,0);assert.equal(resumed.errorMessage,undefined);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM report_jobs').get().n,1);
  }finally{sqlite.close();}
});

test('reasoning-only interruption preserves Kimi assistant history and counts as progress before any prose exists',async()=>{
  const original=globalThis.fetch;const {env,job,saved}=recoveryFixture();let collected=0;
  const deps={collect:async()=>{collected++;return {evidence};},persist:async report=>saved.push(report)};
  const reasoning='fixture private analysis context';
  globalThis.fetch=async()=>new Response(`data: ${JSON.stringify({choices:[{delta:{reasoning_content:reasoning},finish_reason:'length'}]})}\n\ndata: [DONE]\n\n`);
  try{
    await executeReport(env,job,deps);
    assert.equal(job.status,'queued');assert.equal(job.recovery.continuations,1);assert.equal(job.recovery.retries,0);assert.equal(saved.length,0);
    const resumed=JSON.parse(JSON.stringify(job));
    globalThis.fetch=async(_url,options)=>{
      const body=JSON.parse(options.body);
      assert.deepEqual(body.messages[2],{role:'assistant',content:'',reasoning_content:reasoning});
      assert.equal(body.messages[3].role,'user');
      return stream('# 完整诊断正文');
    };
    await executeReport(env,resumed,deps);
    assert.equal(resumed.status,'success');assert.equal(collected,1);assert.equal(saved[0].markdown,'# 完整诊断正文');assert.ok(!saved[0].markdown.includes(reasoning));
  }finally{globalThis.fetch=original;}
});
