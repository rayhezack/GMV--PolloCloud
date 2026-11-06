import test from 'node:test';
import assert from 'node:assert/strict';
import {flowBarLayout} from './flow-bar-layout.ts';

test('daily bars fit at both edges and leave the same gap at narrow and wide sizes',()=>{
  const times=Array.from({length:30},(_,i)=>i*86400000);
  for(const width of [280,720,1200]) {
    const bars=flowBarLayout(times,width);
    const centers=times.map(t=>bars.inset+t/times.at(-1)*(width-2*bars.inset));
    assert.ok(centers[0]-bars.width/2>=0);
    assert.ok(centers.at(-1)+bars.width/2<=width);
    const gaps=centers.slice(1).map((x,i)=>x-centers[i]-bars.width);
    assert.ok(Math.min(...gaps)>0);
    assert.ok(Math.max(...gaps)-Math.min(...gaps)<1e-9);
  }
});

test('missing early or interior comparisons do not move calendar bar slots', () => {
  const times = Array.from({length: 30}, (_, i) => i * 86400000);
  for (const width of [160, 280, 720]) {
    const slots = flowBarLayout(times, width);
    const x = time => slots.inset + time / times.at(-1) * (width - 2 * slots.inset);
    for (const t of times.slice(7).filter((_, i) => i !== 3)) {
      assert.ok(x(t) - slots.width / 2 >= 0);
      assert.ok(x(t) + slots.width / 2 <= width);
    }
  }
});

const {endpointLabels} = await import('./flow-bar-layout.ts');
test('non-Monday endpoints always show and interior ticks leave room for them', () => {
  for (const width of [160, 280, 720]) {
    const first = {key:'first',time:0,x:8,unit:'day'};
    const last = {key:'last',time:29,x:width-8,unit:'day'};
    const candidates = Array.from({length:30}, (_, i) => ({key:String(i), time:i,x:8+i/29*(width-16),unit:'day'}));
    const labels = endpointLabels(candidates,first,last);
    assert.equal(labels[0].time,0);
    assert.equal(labels.at(-1).time,29);
    assert.equal(labels[0].align,'start');
    assert.equal(labels.at(-1).align,'end');
    assert.equal(new Set(labels.map(label=>label.time)).size,labels.length);
    for(let i=1;i<labels.length-1;i++) assert.ok(labels[i].x-labels[i-1].x>=76);
    if(labels.length>2) assert.ok(last.x-labels.at(-2).x>=76);
  }
});
test('a single observed date has one centered label', () => {
  const point={key:'one',time:0,x:100,unit:'day'};
  assert.deepEqual(endpointLabels([],point,point),[{...point,align:'center'}]);
});
