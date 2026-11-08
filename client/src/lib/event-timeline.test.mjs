import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutEventTiles} from './event-timeline.ts';

test('dense events keep their dates and do not overlap at wide or narrow widths',()=>{
  const times=[90,10,11,12,13,14,50];
  for(const width of [240,120]){
    const {positions,height}=layoutEventTiles(times,0,100,width);
    assert.equal(positions.length,times.length);
    assert.ok(height>24);
    positions.forEach((p,i)=>{
      assert.equal(p.left,Math.round(times[i]/100*width-12));
      assert.ok(p.top>=0&&p.top+24<=height);
      positions.slice(i+1).forEach(q=>assert.ok(Math.abs(p.top-q.top)>=32||Math.abs(p.left-q.left)>=32));
    });
  }
});
test('sparse events retain the existing single row',()=>{
  const layout=layoutEventTiles([0,50,100],0,100,240);
  assert.equal(layout.height,24);
  assert.ok(layout.positions.every(p=>p.top===0));
  assert.deepEqual(layoutEventTiles([],0,100,240),{height:24,positions:[]});
});
