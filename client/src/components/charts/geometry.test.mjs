import test from 'node:test';import assert from 'node:assert/strict';
import {chartTicks,businessTickIndices,weekendIndices,lineSegments,nextChartIndex,axisValue,relativeDifference} from './geometry.ts';
test('adaptive 4–5 nice ticks cover values with padding and avoid zero on positive narrow ranges',()=>{for(const values of[[80000,120000,140000],[1000,1010],[-100,-2],[5,5],[0,0],[.1,.3]]){const t=chartTicks(values);assert.ok(t.length>=4&&t.length<=5);assert.ok(t[0]<Math.min(...values));assert.ok(t.at(-1)>Math.max(...values));}assert.ok(chartTicks([90000,110000])[0]>0);assert.equal(axisValue(140000,'currency'),'$140K');});
test('daily ticks use Saturdays plus endpoints',()=>{const dates=Array.from({length:12},(_,i)=>`2026-10-${String(i+6).padStart(2,'0')}`);assert.deepEqual(businessTickIndices(dates),[0,4,11]);assert.deepEqual(weekendIndices(dates),[4,5,11]);});
test('missing points break paths and never connect across a gap',()=>{assert.deepEqual(lineSegments([10,null,20,NaN,0],i=>i,v=>v),['M 0 10','M 2 20','M 4 0']);});
test('keyboard bounds and Escape',()=>{assert.equal(nextChartIndex('ArrowLeft',0,3),0);assert.equal(nextChartIndex('End',0,3),2);assert.equal(nextChartIndex('Home',2,3),0);assert.equal(nextChartIndex('Escape',2,3),null);});

test('relative differences preserve units separately and handle zero or absent baselines',()=>{
 assert.equal(relativeDifference(120,100),'+20.0%');
 assert.equal(relativeDifference(.4948,.4677),'+5.8%');
 assert.equal(relativeDifference(80,100),'−20.0%');
 assert.equal(relativeDifference(0,100),'−100.0%');
 for(const baseline of [0,undefined,NaN]) assert.equal(relativeDifference(1,baseline),'—');
 assert.equal(relativeDifference(NaN,1),'—');
});
