// Read-only integration checks against the migrated local snapshot.
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
await Promise.all([
 build({entryPoints:['worker/index.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/pollo-payment-worker.mjs'}),
 build({entryPoints:['client/src/components/dashboard/payment-analysis.data.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/pollo-payment-data.mjs'}),
]);
const {default:worker}=await import('/tmp/pollo-payment-worker.mjs?'+Date.now());
const {buildPaymentView,buildPaymentDailyRows,buildPaymentDailyPivot}=await import('/tmp/pollo-payment-data.mjs?'+Date.now());
const database=new DatabaseSync('archives/middle-table-20261104/local-preview.sqlite',{readOnly:true});
// This archived fixture predates the single-copy migration and retains physical
// Web/App mirrors. Give it the same read contract without rewriting the archive.
database.exec('CREATE TEMP VIEW IF NOT EXISTS pollo_da_fact_rows_read AS SELECT * FROM main.pollo_da_fact_rows');
// Match the production D1 parameter limit; native SQLite permits far more.
const DB={prepare(sql){let args=[];return {bind(...v){assert(v.length<=100,`D1 bind limit exceeded: ${v.length}`);args=v;return this;},async all(){return {results:database.prepare(sql).all(...args)};},async first(){return database.prepare(sql).get(...args)||null;},async run(){throw new Error('Read-only test');}};}};
const ctx={waitUntil(p){p.catch(()=>{});}};
const near=(a,b,label)=>assert(Math.abs(a-b)<.00001,`${label}: ${a} != ${b}`);
async function get(route,params){const response=await worker.fetch(new Request('https://local/api/dashboard/'+route+'?'+new URLSearchParams(params)),{DB},ctx);const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}
const weeks={baselinePeriod:'2026-10-17',analysisPeriod:'2026-10-24'};
for(const platform of ['web','app','all']) {
 const source=database.prepare("SELECT pay_category,SUM(gmv_usd) total FROM pollo_da_fact_rows WHERE dataset='pay_type' AND platform=? AND period BETWEEN '2026-10-17' AND '2026-10-30' AND attribution_type='NONE' AND pay_type<>'汇总' GROUP BY pay_category").all(platform);
 for(const attributionType of ['NONE','CREATION_MODE','MODEL','ACTUAL_MODEL']) {
  const data=await get('payment-analysis',{platform,attributionType,...weeks});
  for(const category of ['ACTIVE_PAYMENT','AUTO_RENEWAL','API'])near(data.revenues.filter(r=>r.payCategory===category).reduce((n,r)=>n+r.gmvUsd,0),source.find(r=>r.pay_category===category)?.total||0,platform+'/'+attributionType+'/'+category);
  for(const scope of ['ALL','ACTIVE_PAYMENT','AUTO_RENEWAL','API']) {
   const view=buildPaymentView(data,scope,attributionType==='NONE'?'payType':'attributionName');
   near(view.items.reduce((n,r)=>n+r.gmv,0),view.total.gmv,'entity GMV');
   const days=buildPaymentDailyRows(data,scope,attributionType==='NONE'?'payType':'attributionName');
   const pivot=buildPaymentDailyPivot(days);near(pivot.rows.reduce((n,r)=>n+r.values.reduce((a,v)=>a+(v||0),0),0),days.reduce((n,r)=>n+r.gmv,0),'pivot conservation');
   near(days.reduce((n,r)=>n+r.gmv,0),data.revenues.filter(r=>scope==='ALL'||r.payCategory===scope).reduce((n,r)=>n+r.gmvUsd,0),'daily export GMV');
   if(data.costAvailable) {
    near(view.items.reduce((n,r)=>n+(r.cost||0),0),view.total.cost,'entity cost');
    near(days.reduce((n,r)=>n+(r.cost||0),0),data.costs.reduce((n,r)=>n+r.modelCostUsd,0),'daily export cost');
   }
  }
  if(data.costAvailable) {
   const expected=database.prepare("SELECT SUM(model_cost_usd) total FROM pollo_da_fact_rows WHERE dataset='pay_type' AND platform=? AND period BETWEEN '2026-10-17' AND '2026-10-30' AND attribution_type=? AND pay_category='汇总' AND pay_type='汇总'").get(platform,attributionType).total;
   near(data.costs.reduce((n,r)=>n+r.modelCostUsd,0),expected,'cost source');
   if(attributionType==='ACTUAL_MODEL')for(const group of ['actualSupplier','actualProvider'])near(buildPaymentView(data,'ALL',group).items.reduce((n,r)=>n+(r.cost||0),0),buildPaymentView(data,'ALL','attributionName').total.cost,'supplier/provider cost');
  }
  console.log('PASS',platform,attributionType,'revenue / cost / daily export');
 }
}
for(const mode of ['NONE','CREATION_MODE','MODEL','ACTUAL_MODEL'])for(const granularity of ['day','week','month']) {
 const hasModels=['MODEL','ACTUAL_MODEL'].includes(mode);
 const data=await get('payment-trend',{platform:'web',attributionType:mode,granularity,analysisPeriod:weeks.analysisPeriod,income:'ALL'});
 assert.equal(data.points.length,granularity==='day'?30:12);
 for(const [i,p] of data.points.entries())near(data.series.reduce((n,s)=>n+(s.points[i].gmvUsd||0),0),p.gmvUsd||0,'series conservation');
 const expected=database.prepare("SELECT SUM(gmv_usd) total FROM pollo_da_fact_rows WHERE dataset='pay_type' AND platform='web' AND period BETWEEN ? AND ? AND attribution_type='NONE' AND pay_type<>'汇总' AND pay_category IN ('ACTIVE_PAYMENT','AUTO_RENEWAL','API')").get(mode==='NONE'?data.startDate:data.startDate<'2026-10-01'?'2026-10-01':data.startDate,data.endDate).total;
 const adsOnly=data.points.filter(p=>p.source==='ads_v1');
 // Full ADS windows are independently conserved; legacy coverage is checked below.
 if(hasModels||data.startDate>='2026-10-01')near(data.points.reduce((n,r)=>n+(r.gmvUsd||0),0),expected,'trend '+mode+'/'+granularity);
 if(hasModels)assert(data.points.filter(p=>!p.days).every(p=>p.gmvUsd===null&&p.modelCostUsd===null));
 console.log('PASS trend',mode,granularity,'buckets',data.points.length,'ADS buckets',adsOnly.length);
}
for(const attributionType of ['CREATION_MODE','MODEL','ACTUAL_MODEL'])for(const groupBy of attributionType==='ACTUAL_MODEL'?['payType','attributionName','actualSupplier','actualProvider']:['payType','attributionName']) {
 const d=await get('payment-trend',{platform:'web',attributionType,granularity:'week',analysisPeriod:weeks.analysisPeriod,income:'ALL',groupBy});
 d.points.forEach((p,i)=>near(d.series.reduce((n,s)=>n+(s.points[i].gmvUsd||0),0),p.gmvUsd||0,'grouped trend '+groupBy));
 if(groupBy==='payType')assert(d.series.some(s=>s.key==='首订'),'pay type grouping returns payment types');
}
const legacy=await get('payment-analysis',{platform:'web',attributionType:'MODEL',baselinePeriod:'2026-09-05',analysisPeriod:'2026-09-12'});
assert(!legacy.costAvailable&&!legacy.availableAttributionTypes.includes('MODEL')&&!legacy.revenues.length);
const empty=await get('payment-analysis',{platform:'web',attributionType:'NONE',baselinePeriod:'2027-01-02',analysisPeriod:'2027-01-09'});assert.equal(empty.comparison,null);
const fixture={attributionType:'MODEL',source:'ads_v1',availableAttributionTypes:['MODEL'],costAvailable:true,comparison:{baselinePeriod:'2026-10-17',analysisPeriod:'2026-10-24',baselinePeriodDays:1,analysisPeriodDays:1,periodDays:1},revenues:[{period:'2026-10-24',weekStart:'2026-10-24',attributionName:'paid',payCategory:'ACTIVE_PAYMENT',payType:'首订',gmvUsd:10}],costs:[{period:'2026-10-24',weekStart:'2026-10-24',attributionName:'cost-only',modelCostUsd:25},{period:'2026-10-24',weekStart:'2026-10-24',attributionName:'paid',modelCostUsd:20}]};
const view=buildPaymentView(fixture,'ALL','attributionName');assert.equal(view.items.find(r=>r.key==='cost-only').costRatio,null);assert.equal(view.items.find(r=>r.key==='paid').costRatio,2);assert.equal(view.total.cost,45);assert.equal(buildPaymentView(fixture,'ALL','payType').items[0].cost,null);
assert(view.trend.every(p=>!p.label.includes('T00')));
console.log('PASS historical/no-data/cost-only/ratio/date edge cases');
database.close();
