import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentChanges, chainChanges, paymentComposition } from './home-attribution.ts';
import { calendarColor, CALENDAR_CHANGE_THRESHOLDS } from './calendar-display.ts';
const sum=rows=>rows.reduce((n,r)=>n+r.amount,0);
test('daily composition reconciles to the same GMV total and merges category aliases',()=>{
 const result=paymentComposition({totalGmv:120.5,totalPayTypeGmv:{subscription:40,'首订':10.5,credit_pack:30,renewal:40}});
 assert.equal(result.total,120.5);assert.equal(sum(result.items),120.5);
 assert.deepEqual(result.items.map(r=>[r.label,r.amount]),[['首订',50.5],['自动续订',40],['积分包',30]]);
});
test('composition preserves source discrepancy and negative amounts without rescaling named categories',()=>{
 const result=paymentComposition({totalGmv:100,totalPayTypeGmv:{'首订':70,'积分包':40}});
 assert.equal(sum(result.items),100);assert.equal(result.items.find(r=>r.id==='首订').amount,70);
 assert.equal(result.items.find(r=>r.id==='未分类差额').amount,-10);
 const negative=paymentComposition({totalGmv:50,totalPayTypeGmv:{'首订':60,'套餐降级':-10}});
 assert.equal(sum(negative.items),50);assert.equal(negative.items.find(r=>r.id==='套餐降级').amount,-10);
});
test('missing composition stays missing and zero revenue does not manufacture category amounts',()=>{
 assert.equal(paymentComposition(),null);
 assert.equal(paymentComposition({totalGmv:100}),null);
 assert.equal(paymentComposition({totalGmv:100,totalPayTypeGmv:{'首订':NaN}}),null);
 assert.deepEqual(paymentComposition({totalGmv:0,totalPayTypeGmv:{'首订':0}}),{total:0,items:[]});
});
test('payment changes reconcile categories including negative and unclassified amounts',()=>{
 const a={totalGmv:150,totalPayTypeGmv:{'首订':100,'积分包':40}},b={totalGmv:100,totalPayTypeGmv:{'首订':80,'积分包':25}};
 const rows=paymentChanges(a,b);assert.equal(sum(rows),50);assert.equal(rows.find(r=>r.id==='积分包').amount,15);assert.equal(rows.find(r=>r.id==='unclassified').amount,15);
 const negatives=paymentChanges(b,a);assert.equal(sum(negatives),-50);assert.equal(negatives.find(r=>r.id==='unclassified').amount,-15);
});
test('category disappearance and new categories are differences, missing snapshot stays missing',()=>{
 assert.equal(paymentChanges(),null);assert.equal(paymentChanges({totalGmv:10},{totalGmv:3}),null);
 const rows=paymentChanges({totalGmv:8,totalPayTypeGmv:{A:8}},{totalGmv:7,totalPayTypeGmv:{B:7}});
 assert.equal(sum(rows),1);assert.equal(rows.find(r=>r.id==='B').amount,-7);
});
test('active and renewal use their own pay-type maps without replacing missing coverage',()=>{
 const a={activeGmv:12,renewalGmv:4,activePayTypeGmv:{'首订':12},renewalPayTypeGmv:{'LITE':4}},b={activeGmv:10,renewalGmv:6,activePayTypeGmv:{'首订':10},renewalPayTypeGmv:{LITE:6}};
 assert.equal(sum(paymentChanges(a,b,'activeGmv')),2);assert.equal(sum(paymentChanges(a,b,'renewalGmv')),-2);
});
test('LMDI source list preserves all factors, residual, signed amounts and total-GMV extras',()=>{
 const comparison={ready:true,total:{delta:5},factors:[{key:'a',label:'DAU',effect:20},{key:'b',label:'曝光率',effect:-12}],residual:{effect:-3}};
 const rows=chainChanges(comparison);assert.equal(sum(rows),5);assert.equal(rows.find(r=>r.kind==='residual').amount,-3);
 assert.equal(sum(chainChanges(comparison,{renewal:-2,other:4})),7);assert.deepEqual(chainChanges({ready:false}),[]);
});
test('zero net change keeps opposing contributions and residual',()=>{
 const rows=chainChanges({ready:true,total:{delta:0},factors:[{key:'a',label:'A',effect:10},{key:'b',label:'B',effect:-10}],residual:{effect:0}});
 assert.equal(sum(rows),0);assert.equal(rows.length,3);
});
test('calendar color boundaries are stable and symmetric, missing comparison stays neutral',()=>{
 assert.deepEqual(CALENDAR_CHANGE_THRESHOLDS,[.05,.10,.20]);
 for(const [v,level]of [[.049,'0'],[.05,'pos-1'],[.099,'pos-1'],[.10,'pos-2'],[.199,'pos-2'],[.20,'pos-3'],[-.2,'neg-3'],[-.1,'neg-2'],[-.05,'neg-1']])assert.equal(calendarColor(100,[0,200],v,'change'),`var(--div-${level})`);
 for(const v of [null,NaN,Infinity])assert.equal(calendarColor(100,[0,200],v,'change'),'var(--div-0)');
 assert.equal(calendarColor(0,[0,100],null,'amount'),'var(--seq-1)');assert.equal(calendarColor(100,[0,100],null,'amount'),'var(--seq-5)');assert.equal(calendarColor(5,[5,5],null,'amount'),'var(--seq-3)');
});
