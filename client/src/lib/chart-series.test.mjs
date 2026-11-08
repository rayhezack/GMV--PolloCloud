import test from 'node:test';
import assert from 'node:assert/strict';
import { tightLineTicks } from './chart-series.ts';

test('line axes preserve observed GMV variation without forcing a zero origin', () => {
  for (const [min,max] of [[87338,118302],[58400,86934],[22100,35200],[.0012,.0018]]) {
    const ticks=tightLineTicks([min,max]);
    assert.ok(ticks[0] <= min && ticks.at(-1) >= max);
    assert.ok(ticks[0] > 0);
    assert.ok((max-min)/(ticks.at(-1)-ticks[0]) >= .7);
    assert.ok(ticks.length >= 4 && ticks.length <= 8);
    assert.ok(ticks.every((tick,i)=>i===0 || tick>ticks[i-1]));
  }
});

test('flat, zero, missing and negative series retain finite usable axes', () => {
  for (const values of [[100,100],[0,0],[],[NaN,Infinity],[-40,-10]]) {
    const ticks=tightLineTicks(values);
    assert.ok(ticks.length>=2);
    assert.ok(ticks.every(Number.isFinite));
    assert.ok(ticks.at(-1)>ticks[0]);
    for (const value of values.filter(Number.isFinite)) assert.ok(value>=ticks[0] && value<=ticks.at(-1));
  }
});
