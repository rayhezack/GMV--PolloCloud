import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentMonthTrend} from './payment-history.ts';
const date=i=>new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10);
const points=Array.from({length:65},(_,i)=>({period:date(i),gmvUsd:100+i,modelCostUsd:20+i}));
const history={points,series:[{key:'model',points}]};
test('monthly drawer uses 30 actual daily observations and date-aligned baseline instead of stretching a comparison week',()=>{
 const rows=paymentMonthTrend(history,'model','2026-10-24','2026-10-31');
 assert.equal(rows.length,30);assert.equal(rows[0].date,date(35));assert.equal(rows.at(-1).date,date(64));
 assert.equal(rows[0].analysis,135);assert.equal(rows[0].baseline,128);assert.equal(rows[0].cost,55);assert.equal(rows[0].baselineCost,48);
 assert.equal(rows.at(-1).analysis,164);
});
test('missing historical coverage stays absent and never becomes a fabricated zero baseline',()=>{
 const sparse={points:points.map((p,i)=>i<35?{...p,gmvUsd:null}:p),series:[{key:'model',points:points.slice(35)}]};
 const rows=paymentMonthTrend(sparse,'model','2026-10-24','2026-10-31');
 assert.equal(rows.length,30);assert.equal(rows[0].baseline,null);assert.equal(rows[6].baseline,null);assert.equal(rows[7].baseline,135);
 assert.deepEqual(paymentMonthTrend({points:[],series:[]},'model','2026-10-24','2026-10-31'),[]);
});
