import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentMonthTrend,paymentShareTrend} from './payment-history.ts';
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
test('share trend uses exactly 30 calendar dates ending at the latest observed day, not the future week end',()=>{
 const totals=points.map(p=>({...p,days:1}));
 const h={points:[...totals,{period:date(65),gmvUsd:null,days:0}],series:[{key:'renew',points:[...points].reverse().map(p=>({...p,gmvUsd:p.gmvUsd*.3}))}]};
 const rows=paymentShareTrend(h,'renew');
 assert.equal(rows.length,30);assert.equal(rows[0].date,date(35));assert.equal(rows.at(-1).date,date(64));
 assert.equal(rows[0].gmv,135*.3);assert.equal(rows[0].totalGmv,135);assert.equal(rows[0].share,.3);
});
test('daily shares reconcile to 100% and use the scoped daily denominator, not a monthly average',()=>{
 const h={points:points.map(p=>({...p,days:1})),series:[{key:'a',points:points.map((p,i)=>({...p,gmvUsd:i%2 ? p.gmvUsd*.2 : p.gmvUsd*.7}))},{key:'b',points:points.map((p,i)=>({...p,gmvUsd:i%2 ? p.gmvUsd*.8 : p.gmvUsd*.3}))}]};
 const a=paymentShareTrend(h,'a'),b=paymentShareTrend(h,'b');
 a.forEach((p,i)=>assert.ok(Math.abs(p.share+b[i].share-1)<1e-12));
 assert.equal(a[0].share,.2);assert.equal(a[1].share,.7);
});
test('missing coverage and zero denominators stay unavailable; a recorded zero numerator is a real zero share',()=>{
 const h={points:[{period:'2026-11-07',gmvUsd:100,days:1},{period:'2026-11-06',gmvUsd:0,days:1},{period:'2026-11-05',gmvUsd:null,days:0}],series:[{key:'a',points:[{period:'2026-11-07',gmvUsd:0},{period:'2026-11-06',gmvUsd:0},{period:'2026-11-05',gmvUsd:0}]}]};
 const rows=paymentShareTrend(h,'a');
 assert.equal(rows.at(-1).share,0);assert.equal(rows.at(-2).share,null);assert.equal(rows.at(-3).gmv,null);assert.equal(rows[0].share,null);
 assert.deepEqual(paymentShareTrend(h,'missing'),[]);
});
