import test from 'node:test';
import assert from 'node:assert/strict';
import { readDailyData } from './daily-data.ts';
const params=(dataset)=>new URLSearchParams({dataset,platform:'web',startDate:'2026-10-01',endDate:'2026-10-31'});
test('daily explorer uses enriched chain rows and keeps country/device dimensions',async()=>{
  const result=await readDailyData(params('chain'),async()=>{throw Error('unexpected source')},async(table,scope)=>{
    assert.equal(table,'chain_daily');assert.equal(scope.platform,'web');
    return [{period:'2026-10-03',device_type:'web',country_tier:'T1',dataset_kind:'daily',active_uv:12.5},{period:'2026-10-03',dataset_kind:'weekly',active_uv:90}];
  });
  assert.equal(result.total,1);assert.equal(result.items[0].active_uv,12.5);assert.equal(result.items[0].country_tier,'T1');assert.equal(result.items[0].device_type,'web');
});
test('source queries are read-only, bounded and parameterized',async()=>{
  const calls=[];
  await readDailyData(params('ads'),async(sql,...binds)=>{calls.push({sql,binds});return []},async()=>{throw Error('wrong source')});
  assert.equal(calls.length,1);assert.match(calls[0].sql,/^SELECT /);assert.match(calls[0].sql,/period BETWEEN \? AND \?/);assert.deepEqual(calls[0].binds,['2026-10-01','2026-10-31','web']);
  await assert.rejects(()=>readDailyData(params('run_log'),async()=>{throw Error('must validate first')},async()=>[]),/筛选无效/);
});
test('creation tasks preserve unavailable request counts as null',async()=>{
  const calls=[];
  await readDailyData(params('creation_chain'),async(sql)=>{calls.push(sql);return []},async()=>[]);
  assert.match(calls[1],/NULL AS valid_creation_task_cnt/);assert.match(calls[1],/platform_type='WEB'/);
});
