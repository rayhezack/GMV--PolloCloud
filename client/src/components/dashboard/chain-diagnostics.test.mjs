import test from 'node:test';
import assert from 'node:assert/strict';
import { netChangeShare, decomposeRate, summarizeChanges, decomposeCount } from './chain-diagnostics.ts';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
const atoms = (numerator, denominator) => ({ numerator, denominator });
const segment = (key, b, c) => ({ key, label: key, baseline: atoms(...b), current: atoms(...c) });
const parent = rows => Object.fromEntries(['baseline', 'current'].map(side => [side, atoms(rows.reduce((s,r)=>s+r[side].numerator,0), rows.reduce((s,r)=>s+r[side].denominator,0))]));

test('declining effects drive a negative net and rising effects offset it; zero net has no share', () => {
  const s = summarizeChanges([{ label: 'T1', change: -1177.5 }, { label: 'T2', change: -564 }, { label: 'T3', change: -1119 }]);
  assert.equal(s.net, -2860.5); assert.equal(s.topEffect, -2296.5); close(Math.abs(s.topShare), 0.8028316727844782);
  assert.deepEqual([netChangeShare(-150, -100), netChangeShare(50, -100)], [1.5, -0.5]);
  assert.equal(netChangeShare(10, 0), null); assert.equal(netChangeShare(0, 0), null);
});

test('midpoint decomposition conserves an actual Simpson reversal; zero/entry/overlap are explicit', () => {
  const rows = [segment('high', [72,90], [9,10]), segment('low', [1,10], [18,90])];
  const d = decomposeRate(rows, parent(rows));
  assert.equal(d.valid, true); assert.equal(d.simpson, true); close(d.delta, -0.46); close(d.efficiency, 0.1); close(d.structure, -0.56);
  close(d.structure + d.efficiency, d.delta); close(netChangeShare(d.structure,d.delta)+netChangeShare(d.efficiency,d.delta),1);
  const entering = [segment('existing',[20,100],[10,50]),segment('new',[0,0],[30,50])];
  const e = decomposeRate(entering,parent(entering)); assert.equal(e.valid,false); assert.equal(e.simpson,false); assert.match(e.reason,/比率未定义/); assert.deepEqual(e.groups,[]);
  const zero = [segment('empty',[0,0],[1,10])]; assert.equal(decomposeRate(zero,parent(zero)).valid,false);
  assert.equal(decomposeRate(rows,{baseline:atoms(73,101),current:atoms(27,100)}).valid,false);
  const offset = [segment('a',[10,50],[20,50]),segment('b',[20,50],[10,50])];
  const o=decomposeRate(offset,parent(offset)); assert.equal(o.valid,true); close(o.delta,0); close(o.structure+o.efficiency,0); assert.equal(o.simpson,false);
});


test('low conversion share growth is a structural drag and centered effects conserve the rate', () => {
  const rows=[segment('high',[72,90],[64,80]),segment('low',[1,10],[2,20])];
  const d=decomposeRate(rows,parent(rows)); assert.equal(d.valid,true);
  close(d.efficiency,0); close(d.delta,-.07);
  assert.ok(d.groups.every(g=>g.structure<0)); close(d.structure,d.delta);
});

test('one newly observed channel stays separate without inventing a baseline rate', () => {
  const rows=[segment('unknown',[415,527],[435,542]),segment('payinsider',[821,5710],[843,5415]),segment('stripe',[1807,8630],[1939,8597]),segment('paypal',[0,0],[1,1])];
  assert.equal(decomposeRate(rows,parent(rows)).valid,false);
  const d=decomposeRate(rows,parent(rows),{separateUnresolved:true});assert.equal(d.valid,true);
  const paypal=d.groups.find(g=>g.key==='paypal');assert.equal(paypal.rate0,null);assert.equal(paypal.rate1,1);
  assert.equal(paypal.efficiency,0);assert.equal(paypal.structure,0);
  close(d.baselineRate,3043/14867);close(d.currentRate,3218/14555);
  close(d.efficiency+d.structure+d.unresolved,d.delta);
  assert.deepEqual(parent(d.groups),parent(rows));
});

test('screenshot regression: unrecorded paid UV with zero submissions does not block Stripe/PayInsider diagnosis',()=>{
  const rows=[segment('stripe',[106,1127],[100,1401]),segment('payinsider',[101,963],[75,935]),segment('unknown',[1,0],[1,0])];
  const d=decomposeRate(rows,parent(rows),{separateUnresolved:true});assert.equal(d.valid,true);
  close(d.baselineRate,208/2090);close(d.currentRate,176/2336);
  assert.ok(d.efficiency<0);assert.ok(d.structure<0);
  const missing=d.groups.find(g=>g.key==='unknown');assert.equal(missing.rate0,null);assert.equal(missing.rate1,null);
  assert.equal(missing.structure,0);assert.equal(missing.efficiency,0);
  close(missing.unresolvedEffect,1/2336-1/2090);
  close(d.efficiency+d.structure+d.unresolved,d.delta);
  close(netChangeShare(d.efficiency,d.delta)+netChangeShare(d.structure,d.delta)+netChangeShare(d.unresolved,d.delta),1);
  assert.deepEqual(parent(d.groups),parent(rows));
});

test('invalid channel rate and exit are reconciled separately, not zero-filled or discarded',()=>{
  const rows=[segment('stable',[20,100],[18,90]),segment('unmatched',[5,0],[7,3]),segment('exiting',[2,10],[0,0])];
  const d=decomposeRate(rows,parent(rows),{separateUnresolved:true});assert.equal(d.valid,true);
  assert.equal(d.groups.find(g=>g.key==='unmatched').rate1,null);
  assert.equal(d.groups.find(g=>g.key==='exiting').rate1,null);
  close(d.efficiency+d.structure+d.unresolved,d.delta);
  assert.equal(d.simpson,false);
  assert.equal(decomposeRate(rows,{baseline:atoms(27,111),current:atoms(25,93)},{separateUnresolved:true}).valid,false);
  const invalid=[segment('bad',[-1,100],[1,100])];assert.equal(decomposeRate(invalid,parent(invalid),{separateUnresolved:true}).valid,false);
});

test('exposure reason counts conserve parent UV and preserve offsetting signed contributions', () => {
  const rows=[['unrecorded',26254,23739],['credits',62349,41123],['permission',17219,14467],['design',44761,74309]].map(([key,baseline,current])=>({key,label:key,baseline:baseline/4,current:current/4}));
  const d=decomposeCount(rows,{baseline:150583/4,current:153638/4});assert.equal(d.valid,true);close(d.delta,763.75);
  close(d.groups.reduce((s,g)=>s+g.contribution,0),1);
  assert.ok(d.groups.find(g=>g.key==='credits').contribution<0);
  assert.ok(d.groups.find(g=>g.key==='design').contribution>1);
  assert.equal(decomposeCount(rows,{baseline:150583/4,current:100}).valid,false);
});

test('DAU contributions follow the net change: declining groups drive a decline, growing groups offset it',()=>{
  const effects=[-1178,-564,-1119],net=effects.reduce((sum,effect)=>sum+effect,0);
  assert.ok(effects.every(effect=>netChangeShare(effect,net)>0));
  close(effects.reduce((sum,effect)=>sum+netChangeShare(effect,net),0),1);
  close(netChangeShare(-150,-100),1.5);close(netChangeShare(50,-100),-.5);
  assert.equal(netChangeShare(10,0),null);
});

test('every rate effect can be negative while every contribution to the decline is positive',()=>{
  const rows=[segment('T1',[760.79,4656],[518.02,3442]),segment('T2',[172.24,3196],[188.49,3510]),segment('T3',[62.29,2148],[46.94,3048])];
  const d=decomposeRate(rows,parent(rows));assert.equal(d.valid,true);assert.ok(d.delta<0);
  assert.ok(d.efficiency<0);assert.ok(d.structure<0);
  assert.ok(d.groups.every(g=>g.efficiency<0 && g.structure<0));
  close(d.groups.reduce((sum,g)=>sum+netChangeShare(g.efficiency,d.delta)+netChangeShare(g.structure,d.delta),0),1);
});

test('weekly channel effects equal the average of both Shapley factor orders',()=>{
  const rows=[segment('stripe',[3083,14857],[3523,15971]),segment('payinsider',[1381,9618],[1414,8044])];
  const d=decomposeRate(rows,parent(rows));assert.equal(d.valid,true);
  const hybrid10=d.groups.reduce((sum,g)=>sum+g.w1*g.rate0,0);
  const hybrid01=d.groups.reduce((sum,g)=>sum+g.w0*g.rate1,0);
  close(d.structure,((hybrid10-d.baselineRate)+(d.currentRate-hybrid01))/2);
  close(d.efficiency,((hybrid01-d.baselineRate)+(d.currentRate-hybrid10))/2);
  close(netChangeShare(d.structure,d.delta)+netChangeShare(d.efficiency,d.delta),1);
});
