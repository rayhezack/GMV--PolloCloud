import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'revenue-trend-'));
const out=join(dir,'trend.mjs');
buildSync({entryPoints:['shared/revenue-trend.ts'],bundle:true,platform:'node',format:'esm',outfile:out,logLevel:'silent'});
const {aggregateRevenueTrend}=await import(pathToFileURL(out).href);
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
const row=(period,totalGmv)=>({period,totalGmv,activeGmv:totalGmv,renewalGmv:totalGmv});
test('business weeks start Saturday and average observations rather than sums or calendar week',()=>{
 const result=aggregateRevenueTrend([row('2026-11-06',70),row('2026-11-07',100),row('2026-11-08',200)],'totalGmv','week');
 assert.deepEqual(result.map(p=>[p.period,p.totalGmv,p.days]),[['2026-10-31',70,1],['2026-11-07',150,2]]);
 assert.equal(result[1].coverage,'2026-11-07 至 2026-11-08');assert.equal(result[1].partial,true);
});
test('month daily means preserve zero, exclude nulls, deduplicate dates and separate years',()=>{
 const result=aggregateRevenueTrend([row('2026-10-31',100),row('2026-11-01',0),row('2026-11-02',100),row('2026-11-02',200),row('2026-11-03',null),row('2026-11-04',NaN),row('2027-11-01',40)],'totalGmv','month');
 assert.deepEqual(result.map(p=>[p.period,p.totalGmv,p.days]),[['2026-10-01',100,1],['2026-11-01',100,2],['2027-11-01',40,1]]);
 assert.equal(aggregateRevenueTrend([],'totalGmv','month').length,0);
});
test('day view retains exact daily values; complete weeks are identified correctly',()=>{
 const rows=Array.from({length:7},(_,i)=>row(`2026-11-${String(7+i).padStart(2,'0')}`,i*10));
 assert.deepEqual(aggregateRevenueTrend(rows,'activeGmv','day').map(p=>p.activeGmv),[0,10,20,30,40,50,60]);
 const week=aggregateRevenueTrend(rows,'activeGmv','week')[0];assert.equal(week.activeGmv,30);assert.equal(week.partial,false);
});
