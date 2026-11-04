// Integration check against the local migrated snapshot, never the production DB.
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
await build({entryPoints:[process.env.POLLO_WORKER_PATH || 'worker/index.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/pollo-worker-verification.mjs'});
const {default: worker} = await import('/tmp/pollo-worker-verification.mjs?'+Date.now());
const database = new DatabaseSync('archives/middle-table-20261104/local-preview.sqlite');
const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async all(){return {results:database.prepare(sql).all(...args)};},async first(){return database.prepare(sql).get(...args)||null;},async run(){return database.prepare(sql).run(...args);}};}};
const context={waitUntil(p){p.catch(()=>{});}};
async function get(path){const r=await worker.fetch(new Request('https://local'+path),{DB},context);const data=await r.json();return {status:r.status,data};}
for (const platform of ['web','app','all']) {
  for (const dimension of ['pay_type','chain']) {
    for(const mode of dimension==='pay_type'?['CREATION_MODE','MODEL','ACTUAL_MODEL']:['CREATION_MODE']) {
      const r=await get(`/api/dashboard/attributions?platform=${platform}&dimension=${dimension}&startDate=2026-10-17&endDate=2026-10-30&baselinePeriod=2026-10-17&analysisPeriod=2026-10-24&attributionType=${mode}`);
      assert.equal(r.status,200,JSON.stringify(r.data));assert(r.data.items.length>0);
      if(dimension==='pay_type'){
        assert(r.data.paymentBreakdown.length>0,mode);
        assert(r.data.paymentBreakdown.every(row=>row.attributionType===mode));
        // Every mode must sum to the same active-payment GMV for the comparison window.
        const expected=database.prepare("SELECT SUM(gmv_usd) total FROM pollo_da_fact_rows WHERE dataset='pay_type' AND platform=? AND period BETWEEN '2026-10-17' AND '2026-10-30' AND attribution_type='NONE' AND pay_category='ACTIVE_PAYMENT' AND pay_type<>'汇总'").get(platform).total;
        const actual=r.data.paymentBreakdown.reduce((total,row)=>total+row.gmvUsd,0);
        assert(Math.abs(actual-expected)<0.00001,`${platform}/${mode}: ${actual} vs ${expected}`);
      }
      console.log('PASS',platform,dimension,mode);
    }
  }
}
const mixed=await get('/api/dashboard/attributions?platform=web&dimension=pay_type&startDate=2026-09-19&endDate=2026-10-09&baselinePeriod=2026-09-19&analysisPeriod=2026-10-03');
assert.equal(mixed.status,500);assert.match(mixed.data.error||mixed.data.message||JSON.stringify(mixed.data),/新旧口径/);
console.log('PASS mixed-version comparison rejected');
database.close();
