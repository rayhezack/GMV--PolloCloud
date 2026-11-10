import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyDiagnosis, dailyComparison } from './daily-diagnosis.ts';
import { buildReportEvidence, selectProductActions } from './report-evidence.ts';
import { reportEvidenceQueries } from './report-evidence-loader.ts';
import { prepareReportData } from './report-data.ts';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';

const B='2026-10-30',D='2026-11-06';
const source=(rows=[],status='ok')=>({source:'fixture',status,readAt:'2026-11-09T00:00:00Z',complete:true,rows});
const signal=(window='week',values={})=>({platform:'web',metric:'totalGmv',period:D,baselinePeriod:window==='week'?B:'2026-11-05',window,direction:'down',change:470/530-1,threshold:-.10,currentDailyAvg:470,previousDailyAvg:530,historyCount:80,baselineWindow:'12_complete_weeks',...values});
function fixture(){
  const s=Object.fromEntries(['pay','funnel','breakdown','renewal','ads','creation','functions','actions'].map(k=>[k,source()]));
  for(const date of [B,'2026-11-02',D]){
    const before=date===B,mid=date==='2026-11-02',common={period:date,week_start:before?'2026-10-24':'2026-10-31',platform:'web'};
    for(const [tier,pay] of [['create_cnt_30d_0',before?10:4],['create_cnt_30d_[1,11)',before?10:12]]){
      for(const user_lifecycle of ['NEW','OLD']){
        const f={...common,creation_cnt_30d_label:tier,user_lifecycle,country_tier:'T1',active_uv:50,expose_uv:25,submit_uv:10,pay_uv:pay/2,gmv_usd:mid?99999:pay*10};
        s.funnel.rows.push(f);
        for(const [breakdown_type,breakdown_value] of [['SUBMIT_CHANNEL','stripe'],['EXPOSE_TYPE','active'],['EXPOSE_REASON','product_design']])s.breakdown.rows.push({...f,breakdown_type,breakdown_value});
      }
    }
    for(const [pay_category,pay_type,gmv_usd] of [['ACTIVE_PAYMENT','首订',before?420:340],['AUTO_RENEWAL','自动续订',before?100:120],['API','API',10]])s.pay.rows.push({...common,pay_category,pay_type,product_type:pay_category==='AUTO_RENEWAL'?'Pro':null,gmv_usd:mid?999999:gmv_usd});
    s.renewal.rows.push({...common,platform_type:'WEB',plan_tier:'PRO',plan_cycle:'MONTHLY',expire_user_cnt:100,renew_user_cnt:before?50:60,renew_amount_usd:before?100:120});
  }
  for(const k of ['ads','creation','functions'])s[k]=source([],'unavailable');
  return s;
}
test('comparison follows actual triggers, prioritizes weekly even when daily direction is opposite',()=>{
  assert.equal(dailyComparison([signal('day')]).baselineDate,'2026-11-05');
  assert.equal(dailyComparison([signal()]).baselineDate,B);
  const day=signal('day',{direction:'up',currentDailyAvg:470,previousDailyAvg:400,change:470/400-1,threshold:.10});
  const c=dailyComparison([day,signal()]);assert.equal(c.primary.window,'week');assert.equal(c.primary.direction,'down');assert.deepEqual(c.supplementary,[day]);
  assert.throws(()=>dailyComparison([signal(),signal()]),/重复/);
  assert.throws(()=>dailyComparison([signal(),signal('day',{metric:'activeGmv'})]),/同指标/);
  assert.throws(()=>dailyComparison([signal('day',{baselinePeriod:B})]),/真实比较/);
  assert.throws(()=>dailyComparison([signal('week',{change:-.01})]),/不一致/);
});
test('daily evidence uses only the two exact dates and creative tiers, preserving offsets and LMDI conservation',()=>{
  const e=buildDailyDiagnosis([signal()],{web:fixture()});
  assert.equal(prepareReportData(e),e);
  const p=e.platformEvidence[0].evidence;
  assert.deepEqual(p.window.days,{baseline:1,current:1});assert.equal(p.revenue.total.current,470);
  assert.equal(p.activeChain.lifecycle,undefined);assert.equal(p.activeChain.creationTiers.length,2);
  const [a,b]=p.activeChain.creationTiers;
  assert.equal(a.gmv.baseline,200);assert.equal(a.gmv.current,80);assert.equal(a.contribution,1.5);assert.equal(b.contribution,-.5);
  assert.equal(a.raw.baseline.active_uv,100);assert.equal(a.daily.length,4);
  assert.ok(Math.abs(a.lmdi.factors.find(f=>f.key==='chainPaySuccessRate').effectUsd+120)<1e-8);
  assert.equal(a.submitChannelPayRate.valid,true);assert.equal(a.submitChannelPayRate.effects.structurePp,0);
  assert.ok(p.checks.every(c=>c.passed));assert.ok(p.renewal.productTypes[0].lmdi.valid);
});
test('missing creative field and core dates fail; unknown labels stay explicit rather than being mapped to a known tier',()=>{
  const s=fixture();delete s.funnel.rows[0].creation_cnt_30d_label;
  assert.throws(()=>buildDailyDiagnosis([signal()],{web:s}),/创作分层/);
  const absent=fixture();absent.funnel.rows=absent.funnel.rows.filter(r=>r.period!==D);
  assert.throws(()=>buildDailyDiagnosis([signal()],{web:absent}),/缺少可比数据/);
  const unknown=fixture();for(const k of ['funnel','breakdown'])for(const row of unknown[k].rows)if(row.creation_cnt_30d_label==='create_cnt_30d_0')row.creation_cnt_30d_label=null;
  assert.ok(buildDailyDiagnosis([signal()],{web:unknown}).platformEvidence[0].evidence.activeChain.creationTiers.some(t=>t.key==='未知'));
});
test('trigger source cannot be silently substituted; core failed equations block the model input',()=>{
  const e=buildDailyDiagnosis([signal('week',{metric:'activeGmv'})],{web:fixture()});
  assert.throws(()=>prepareReportData(e),/未守恒/);
  const valid=buildDailyDiagnosis([signal()],{web:fixture()});valid.checks.push({id:'web.creationTier.current.gmv_usd',passed:false});
  assert.throws(()=>prepareReportData(valid),/未守恒/);
});
test('all-platform evidence retains both platforms and unallocated differences; routing remains the model decision',()=>{
  const e=buildDailyDiagnosis([signal('week',{platform:'all',currentDailyAvg:1000,previousDailyAvg:1200,change:1000/1200-1})],{web:fixture(),app:fixture()});
  assert.equal(e.platformEvidence.length,2);assert.equal(e.platformComparison.residual.baseline,140);assert.equal(e.platformComparison.residual.current,60);
  assert.equal(e.platformComparison.contributions[0].contribution,.3);assert.equal(e.selectedPlatform,undefined);assert.equal(e.routes,undefined);
});
test('daily SQL retains creative labels and does not alter the weekly SQL grouping',()=>{
  const w={platform:'web',startDate:B,endDate:D};
  const day=reportEvidenceQueries({...w,mode:'day'}),week=reportEvidenceQueries(w);
  for(const k of ['funnel','breakdown']){assert.match(day.find(q=>q.key===k).sql,/creation_cnt_30d_label/);assert.doesNotMatch(week.find(q=>q.key===k).sql,/creation_cnt_30d_label/);}
});
test('actions cover exactly four weeks through the anomaly day, prioritize baseline onward, exclude future and unknown platform',()=>{
  const rows=['2026-10-09','2026-10-10',B,D,'2026-11-07'].map((launch_time,i)=>({record_id:String(i),launch_time,action_type:'配置变更',platform:'web'}));
  rows.push({record_id:'unknown',launch_time:D,action_type:'优化',platform:null});
  const a=selectProductActions({platform:'web',startDate:B,endDate:D,mode:'day'},source(rows));
  assert.equal(a.searchStart,'2026-10-10');assert.deepEqual(a.eligible.map(r=>r.record_id),['1','2','3']);assert.deepEqual(a.eligible.map(r=>r.priorityWindow),[false,true,true]);
});

test('actual existing detector reproduces P95/P05 and minimum 10% thresholds; retrospective cutoff preserves current behavior',async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE pollo_da_fact_rows(dataset,period,week_start,platform,platform_type,gmv_usd,renew_amount_usd,attribution_type,pay_category,pay_type); CREATE VIEW pollo_da_fact_rows_read AS SELECT * FROM pollo_da_fact_rows; CREATE TABLE pollo_da_chain_funnel(period,week_start,platform,device_type,creation_cnt_30d_label,active_uv,paywall_expose_uv,paywall_submit_uv,pay_uv,gmv_usd,user_lifecycle);`);
  db.exec("ALTER TABLE pollo_da_fact_rows ADD COLUMN dataset_kind TEXT DEFAULT 'daily'");
  const insert=db.prepare('INSERT INTO pollo_da_fact_rows(dataset,period,week_start,platform,platform_type,gmv_usd,renew_amount_usd,attribution_type,pay_category,pay_type) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const chain=db.prepare('INSERT INTO pollo_da_chain_funnel VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for(let i=0;i<100;i++){
    const date=new Date(Date.parse(D)-i*86400000).toISOString().slice(0,10);
    const offset=(new Date(date).getUTCDay()+1)%7,week=new Date(Date.parse(date)-offset*86400000).toISOString().slice(0,10);
    for(const platform of ['all','web','app']){
      const value=(platform==='all'?2:1)*(i===0?130:100);
      insert.run('pay_type',date,week,platform,platform==='web'?'WEB':'APP',value,null,'NONE','ACTIVE_PAYMENT','首订');
      insert.run('renewal',date,week,platform,platform==='web'?'WEB':'APP',null,value,null,null,null);
    }
    for(const platform of ['web','app'])chain.run(date,week,platform,platform,'create_cnt_30d_0',100,50,20,10,i===0?130:100,'OLD');
  }
  const DB={prepare(sql){let binds=[];return{bind(...v){binds=v;return this;},async first(){return db.prepare(sql).get(...binds);},async all(){return{results:db.prepare(sql).all(...binds)};}};}};
  const bundle=await build({entryPoints:['worker/index.ts'],bundle:true,platform:'node',format:'esm',write:false});
  const {gmvAnomalies,default:worker}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  try{
    const now=await(await gmvAnomalies({DB})).json(),historical=await(await gmvAnomalies({DB},D)).json();
    assert.deepEqual(now,historical);
    const alerts=now.alerts.filter(s=>s.platform==='web'&&s.metric==='totalGmv');
    assert.equal(alerts.length,2);assert.ok(alerts.every(s=>s.threshold===.10&&Math.abs(s.change-.30)<1e-10));
    assert.ok((await(await gmvAnomalies({DB},'2026-11-05')).json()).alerts.length===0);
    const tasks=[],context={waitUntil:p=>tasks.push(p)};
    const historicalResponse=await worker.fetch(new Request('https://fixture.local/api/dashboard/gmv-anomalies?asOfDate=2026-11-05'),{DB},context);
    const historicalBody=await historicalResponse.json();
    assert.equal(historicalBody.latestDay,'2026-11-05');assert.equal(historicalBody.alerts.length,0);
    const invalid=await worker.fetch(new Request('https://fixture.local/api/dashboard/gmv-anomalies?asOfDate=2026-02-30'),{DB},context);
    assert.equal(invalid.status,400);await Promise.allSettled(tasks);
  } finally{db.close();}
});

test('daily model call receives every prepared platform datum and returns its complete prose verbatim',async()=>{
  const e=buildDailyDiagnosis([signal()],{web:fixture()});
  const bundle=await build({entryPoints:['worker/report-jobs.ts'],bundle:true,platform:'node',format:'esm',write:false});
  const {generateMarkdown}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const original=globalThis.fetch,text='# 日诊断\n\n**这是模型完整撰写的判断。**\n';
  globalThis.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);
    assert.deepEqual(JSON.parse(body.messages[1].content.split('\n')[1]),JSON.parse(JSON.stringify(e)));
    assert.match(body.messages[0].content,/日 GMV 异动诊断/);
    return new Response(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
  };
  try{assert.equal(await generateMarkdown({KIMI_API_KEY:'fixture'},e),text);}finally{globalThis.fetch=original;}
});
