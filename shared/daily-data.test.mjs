import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyDataPage, dailyDataParams } from './daily-data.ts';
const params={dataset:'ads',platform:'web',startDate:'2026-10-01',endDate:'2026-11-01',sort:'cost_usd',direction:'desc',page:1,pageSize:2};
test('daily explorer sorts numeric source values before pagination and preserves nulls',()=>{
  const rows=[{period:'2026-10-01',cost_usd:2,channel:'a',secret:'excluded'},{period:'2026-10-02',cost_usd:10,channel:'b'},{period:'2026-10-03',cost_usd:null,channel:'a'}];
  const result=dailyDataPage(rows,params);
  assert.deepEqual(result.items.map(r=>r.cost_usd),[10,2]);assert.equal('secret' in result.items[0],false);
  assert.equal(dailyDataPage(rows,{...params,page:2}).items[0].cost_usd,null);
  assert.equal(dailyDataPage(rows,{...params,search:'a'}).total,2);
});
test('daily explorer rejects arbitrary sources, dates, order fields and page sizes',()=>{
  const valid=new URLSearchParams({...params,page:'1',pageSize:'50'});
  assert.equal(dailyDataParams(valid).dataset,'ads');
  for(const [k,v] of [['dataset','users'],['startDate','2026-02-30'],['sort','cost_usd; DROP TABLE a'],['pageSize','999'],['platform','other']]){const query=new URLSearchParams(valid);query.set(k,v);assert.throws(()=>dailyDataParams(query));}
});
