import test from 'node:test';
import assert from 'node:assert/strict';
import { netChangeShare, directionShare, decomposeRate, summarizeChanges, comparableChannels, decomposeCount } from './chain-diagnostics.ts';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
const atoms = (numerator, denominator) => ({ numerator, denominator });
const segment = (key, b, c) => ({ key, label: key, baseline: atoms(...b), current: atoms(...c) });
const parent = rows => Object.fromEntries(['baseline', 'current'].map(side => [side, atoms(rows.reduce((s,r)=>s+r[side].numerator,0), rows.reduce((s,r)=>s+r[side].denominator,0))]));

test('negative net keeps drags negative and offsetting lifts positive; zero net has no share', () => {
  const s = summarizeChanges([{ label: 'T1', change: -1177.5 }, { label: 'T2', change: -564 }, { label: 'T3', change: -1119 }]);
  assert.equal(s.net, -2860.5); assert.equal(s.topEffect, -2296.5); close(Math.abs(s.topShare), 0.8028316727844782);
  assert.deepEqual([directionShare(-150, -100), directionShare(50, -100)], [-1.5, 0.5]);
  assert.equal(directionShare(10, 0), null); assert.equal(directionShare(0, 0), null);
});

test('midpoint decomposition conserves an actual Simpson reversal; zero/entry/overlap are explicit', () => {
  const rows = [segment('high', [72,90], [9,10]), segment('low', [1,10], [18,90])];
  const d = decomposeRate(rows, parent(rows));
  assert.equal(d.valid, true); assert.equal(d.simpson, true); close(d.delta, -0.46); close(d.efficiency, 0.1); close(d.structure, -0.56);
  close(d.structure + d.efficiency, d.delta); close(directionShare(d.structure,d.delta)+directionShare(d.efficiency,d.delta),-1);
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

test('actual submission channel cohorts preserve all users when a single-period channel is pooled', () => {
  const rows=[segment('unknown',[415,527],[435,542]),segment('payinsider',[821,5710],[843,5415]),segment('stripe',[1807,8630],[1939,8597]),segment('paypal',[0,0],[1,1])];
  assert.equal(decomposeRate(rows,parent(rows)).valid,false);
  const grouped=comparableChannels(rows); assert.deepEqual(grouped.pooled,['unknown','paypal']);
  const d=decomposeRate(grouped.rows,parent(rows)); assert.equal(d.valid,true);
  close(d.baselineRate,3043/14867);close(d.currentRate,3218/14555);close(d.efficiency+d.structure,d.delta);
  assert.deepEqual(parent(grouped.rows),parent(rows));
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
