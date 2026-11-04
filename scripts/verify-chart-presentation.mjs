import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {mkdir,unlink} from 'node:fs/promises';
import path from 'node:path';
for(const [entry,out] of [['client/src/lib/chart-tooltip-format.ts','format'],['client/src/components/finance-chart/series.ts','series'],['client/src/components/dashboard/payment-analysis.data.ts','data'],['worker/index.ts','worker']]) await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:`/tmp/pollo-chart-${out}.mjs`});
const {formatChartTooltipValue: value,formatChartTooltipChange: change}=await import('/tmp/pollo-chart-format.mjs');
assert.equal(value(1234.56,'currency'),'$1,235');assert.equal(value(12.6,'count'),'13');assert.equal(value(.4701,'ratio'),'47.0%');assert.equal(change(.0158,'ratio'),'+1.6 个百分点');assert.equal(change(-124.8,'currency'),'−$125');
const {niceTicks}=await import('/tmp/pollo-chart-series.mjs');assert.equal(niceTicks(0,90000)[0],0);assert(niceTicks(60000,80000)[0]>0);assert(niceTicks(.44,.49)[0]>.4);
const {buildPaymentView,percent}=await import('/tmp/pollo-chart-data.mjs');assert.equal(percent(.37),'37.0%');assert.equal(percent(0),'0.0%');
const db=new DatabaseSync('archives/middle-table-20261104/local-preview.sqlite',{readOnly:true});
const DB={prepare(sql){let args=[];return {bind(...a){args=a;return this;},async all(){return {results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args)||null;},async run(){throw Error('Read only');}};}};
const {default:worker}=await import('/tmp/pollo-chart-worker.mjs');
const get=async(route,params)=>{const r=await worker.fetch(new Request('http://local/api/dashboard/'+route+'?'+new URLSearchParams(params)),{DB},{waitUntil(){}});assert.equal(r.status,200);return r.json();};
const daily=await get('overview',{platform:'web',startDate:'2026-10-01',endDate:'2026-10-30',granularity:'day'});
const monthly=await get('overview',{platform:'web',startDate:'2026-10-01',endDate:'2026-10-30',granularity:'month'});
assert.equal(monthly.trend.length,1);assert.equal(monthly.trend[0].period,'2026-10-01');const near=(a,b)=>assert(Math.abs(a-b)<1e-6,`${a} != ${b}`);
near(monthly.payTypeTrend[0].totalGmv,daily.payTypeTrend.reduce((n,r)=>n+r.totalGmv,0)/daily.payTypeTrend.length);
// Grain changes group the same date window, including its partial first/last buckets.
const windowParams={platform:'web',startDate:'2026-09-28',endDate:'2026-10-30'};
const windowDays=await get('overview',{...windowParams,granularity:'day'});
for(const granularity of ['week','month']) {
 const grouped=await get('overview',{...windowParams,granularity});
 const bucket=date=>{
  if(granularity==='month')return date.slice(0,7)+'-01';
  const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+1)%7);return d.toISOString().slice(0,10);
 };
 const expected=new Map();
 for(const row of windowDays.trend){const key=bucket(row.period);expected.set(key,[...(expected.get(key)||[]),row]);}
 assert.deepEqual(grouped.trend.map(r=>r.period),[...expected.keys()]);
 assert(grouped.trend.length<windowDays.trend.length);
 for(const row of grouped.trend){const days=expected.get(row.period);near(row.activeGmv,days.reduce((n,r)=>n+r.activeGmv,0)/days.length);near(row.dau,days.reduce((n,r)=>n+r.dau,0)/days.length);}
}
for(const mode of ['MODEL','ACTUAL_MODEL']) {
 const data=await get('payment-analysis',{platform:'web',attributionType:mode,baselinePeriod:'2026-10-17',analysisPeriod:'2026-10-24'});
 const view=buildPaymentView(data,'ACTIVE_PAYMENT','attributionName');
 for(const r of [...view.items,view.total]) {
  if(r.baselineCost)near(r.costChangeRate,(r.cost-r.baselineCost)/r.baselineCost);
  if(r.baseline&&r.gmv)near(r.costRatioChange,r.cost/r.gmv-r.baselineCost/r.baseline);
 }
 const entity=view.items.find(r=>r.cost&&r.baselineCost&&r.baseline&&r.gmv);
 const detail=buildPaymentView(data,'ACTIVE_PAYMENT','attributionName',entity.key);
 near(detail.trend.reduce((n,p)=>n+(p.baselineCost||0),0)/7,entity.baselineCost);
 near(detail.trend.reduce((n,p)=>n+(p.cost||0),0)/7,entity.cost);
}
db.close();
const renderPath=path.resolve('node_modules/.cache/verify-finance-presentation.cjs');
await mkdir(path.dirname(renderPath),{recursive:true});
try {
 await build({stdin:{contents:`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {GlobalFinanceMarketComboChart} from './client/src/components/finance-chart/GlobalFinanceMarketComboChart'; export const html=renderToStaticMarkup(<GlobalFinanceMarketComboChart variant="line" period="month" defaultIndex={0} locale="en-US" actualLabel="GMV" data={{actual:[{date:'2026-10-01',value:12345}]}} />);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',alias:{'@':path.resolve('client/src')},outfile:renderPath});
 const html=createRequire(import.meta.url)(renderPath).html;
 assert.match(html,/data-slot="global-finance-market-combo-chart-single-point"/);
 assert.match(html,/data-slot="global-finance-market-combo-chart-single-point"[^>]*fill="#533afd"/);
 assert.match(html,/aria-valuenow="0"/);
 assert.match(html,/Oct 1, 2026/);
 assert(!html.includes('NaN'));
} finally {await unlink(renderPath).catch(()=>{});}
console.log('PASS tooltip units/precision, dynamic vs zero axes, monthly daily averages, cost change, ratio pp, detail cost alignment, visible single-point chart and selected tooltip');
