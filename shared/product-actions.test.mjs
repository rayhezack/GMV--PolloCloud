import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChartActions, productActionDate, revenueActionEvents } from './product-actions.ts';
const shift = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`)+n*86400000).toISOString().slice(0,10);
const record = (overrides = {}) => ({id:'r1',fields:{'上线时间':'2026-10-20','更新点':'Cinema 上线并提供四折活动','说明':'降低创作积分成本','端':['web'],'类型':['新增功能'],...overrides}});
const action = (date='2026-10-20', platform='web', kind='pricing', id='r1') => ({...normalizeChartActions([record()])[0],date,platform,kind,id});
const rows = () => Array.from({length:132},(_,i)=>({period:shift('2026-07-01',i),totalGmv:100,activeGmv:100,renewalGmv:100}));

test('release dates use Shanghai calendar day; statistics day is never a substitute',()=>{
  assert.equal(productActionDate('2026-10-19T18:00:00Z'),'2026-10-20');
  assert.equal(productActionDate(Date.parse('2026-10-19T18:00:00Z')),'2026-10-20');
  assert.equal(productActionDate('2026-02-30'),null);
  assert.equal(normalizeChartActions([record({'上线时间':null,'统计日':'2026-10-20'})]).length,0);
  assert.equal(normalizeChartActions([record({'合入时间':'2026-10-19'})])[0].date,'2026-10-20');
});
test('dated technical changes and version releases remain in the factual day log',()=>{
  assert.equal(normalizeChartActions([record({'更新点':'SSRF 安全凭证加固'})]).length,1);
  assert.equal(normalizeChartActions([record({'类型':['版本发布']})]).length,1);
  assert.equal(normalizeChartActions([record()])[0].kind,'pricing');
});
test('one node groups same-date actions and deduplicates duplicate source records',()=>{
  const data=rows();data.find(r=>r.period==='2026-10-20').totalGmv=150;
  const actions=[action(),action('2026-10-20','web','pricing','r1'),{...action('2026-10-20','web','payment','other'),title:'UPI 支付优先级调整'}];
  const result=revenueActionEvents(data,actions,'totalGmv','web','2026-10-09','2026-11-07');
  assert.equal(result.length,1); assert.equal(result[0].actions.length,2);assert.equal(result[0].change,.5);
});
test('ordinary dates stay unmarked; actions follow platform without filtering by assumed revenue impact',()=>{
  const data=rows();data.find(r=>r.period==='2026-10-20').totalGmv=109;
  assert.equal(revenueActionEvents(data,[action()],'totalGmv','web','2026-10-09','2026-11-07').length,0);
  data.find(r=>r.period==='2026-10-20').totalGmv=160;
  assert.equal(revenueActionEvents(data,[action('2026-10-21')],'totalGmv','web','2026-10-20','2026-10-20').length,0);
  assert.equal(revenueActionEvents(data,[action('2026-10-20','app')],'totalGmv','web','2026-10-09','2026-11-07').length,0);
  data.find(r=>r.period==='2026-10-20').renewalGmv=160;
  assert.equal(revenueActionEvents(data,[action('2026-10-20','web','creation')],'renewalGmv','web','2026-10-09','2026-11-07').length,1);
  const mixed = [action(), action('2026-10-20','app','other','app'), action('2026-10-20','web/app','other','both')];
  assert.deepEqual(revenueActionEvents(data,mixed,'totalGmv','web','2026-10-09','2026-11-07')[0].actions.map(a=>a.id),['r1','both']);
  assert.deepEqual(revenueActionEvents(data,mixed,'totalGmv','app','2026-10-09','2026-11-07')[0].actions.map(a=>a.id),['app','both']);
  assert.equal(revenueActionEvents(data,mixed,'totalGmv','all','2026-10-09','2026-11-07')[0].actions.length,3);
});
test('missing values are not zero and incomplete historical weeks cannot manufacture an anomaly',()=>{
  const data=rows();data.find(r=>r.period==='2026-10-20').totalGmv=null;
  assert.equal(revenueActionEvents(data,[action()],'totalGmv','web','2026-10-09','2026-11-07').length,0);
  data.find(r=>r.period==='2026-10-20').totalGmv=0;
  assert.equal(revenueActionEvents(data,[action()],'totalGmv','web','2026-10-09','2026-11-07')[0].change,-1);
  data.find(r=>r.period==='2026-10-20').totalGmv=150;
  assert.equal(revenueActionEvents(data.filter(r=>r.period!=='2026-09-04'),[action()],'totalGmv','web','2026-10-09','2026-11-07').length,0);
});
test('thresholds are learned from prior weeks only and icons have spacing and a hard cap',()=>{
  const data=rows(), actions=[];
  for(let i=0;i<30;i+=2){const date=shift('2026-10-09',i);data.find(r=>r.period===date).totalGmv=500;actions.push(action(date,'web','pricing',String(i)));}
  const result=revenueActionEvents(data,actions,'totalGmv','web','2026-10-09','2026-11-07');
  assert.ok(result.length>0&&result.length<=4);
  for(let i=1;i<result.length;i++)assert.ok(Date.parse(result[i].date)-Date.parse(result[i-1].date)>=3*86400000);
  const original=rows();original.find(r=>r.period==='2026-10-20').totalGmv=150;
  const before=revenueActionEvents(original,[action()],'totalGmv','web','2026-10-09','2026-11-07');
  original.filter(r=>r.period>'2026-10-20').forEach(r=>r.totalGmv=10000);
  assert.deepEqual(revenueActionEvents(original,[action()],'totalGmv','web','2026-10-09','2026-11-07'),before);
});

test('the full lookback marks both rises and falls near the start of a visible quarter',()=>{
  const data=Array.from({length:188},(_,i)=>({period:shift('2026-05-01',i),totalGmv:100}));
  data.find(r=>r.period==='2026-08-10').totalGmv=150;
  data.find(r=>r.period==='2026-08-14').totalGmv=50;
  const actions=[action('2026-08-10'),action('2026-08-14','web','payment','fall')];
  const result=revenueActionEvents(data,actions,'totalGmv','web','2026-08-07','2026-11-04');
  assert.deepEqual(result.map(e=>[e.date,Math.sign(e.change)]),[['2026-08-10',1],['2026-08-14',-1]]);
  assert.equal(revenueActionEvents(data.filter(r=>r.period>='2026-08-07'),actions,'totalGmv','web','2026-08-07','2026-11-04').length,0);
});
