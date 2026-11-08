import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCompleteResult } from './complete-result.ts';

test('complete results and empty results preserve the original schema and values', async () => {
  for (const rows of [[], [['a,\n"b', null, '1']]]) {
    const result = { column_names: ['label', 'amount', 'source_row_count'], rows };
    assert.equal(await executeCompleteResult('SELECT ...', async () => result), result);
  }
});

test('missing, invalid and inconsistent count metadata are not reported as truncation', async () => {
  await assert.rejects(executeCompleteResult('SELECT ...', async () => ({column_names:['a'],rows:[[1]]})), /缺少 source_row_count/);
  for (const rows of [[['']], [[null]], [['not a count']], [[-1]], [[2],[3]], [[1],[1]]]) {
    await assert.rejects(executeCompleteResult('SELECT ...', async () => ({column_names:['source_row_count'],rows})), /总行数无效或不一致/);
  }
});

test('a 25,003-row result survives the 10,000-row REST preview cap with no loss, duplication or rounding', async () => {
  const rows = Array.from({length:25003},(_,index)=>[String(index).padStart(5,'0'),index%2?null:'123.123456789123456789',25003]);
  const columns=['key','amount','source_row_count'];let calls=0;
  const result = await executeCompleteResult('SET odps.sql.type.system.odps2=true;\nWITH a AS (SELECT ...) SELECT * FROM a;',async sql=>{
    if(calls++===0)return {column_names:columns,rows:rows.slice(0,10000)};
    assert.match(sql,/^SET odps.sql.type.system.odps2=true;/);
    assert.match(sql,/FROM \(WITH a AS/);
    const [,start,end]=/WHERE __sync_row_number > (\d+) AND __sync_row_number <= (\d+)/.exec(sql)!;
    return {column_names:[...columns,'__sync_row_number'],rows:rows.slice(Number(start),Number(end)).map((row,i)=>[...row,Number(start)+i+1]).reverse()};
  });
  assert.equal(calls,27);assert.deepEqual(result,{column_names:columns,rows});
});

test('a lower project cap is honored; broken pages and changing source counts never escape', async () => {
  for(const failure of ['none','count','missing','duplicate','schema']){
    let call=0;
    const run=executeCompleteResult('SELECT key, source_row_count FROM result',async()=>{
      if(call++===0)return {column_names:['key','source_row_count'],rows:[[1,4],[2,4]]};
      return {column_names:failure==='schema'?['other','source_row_count','__sync_row_number']:['key','source_row_count','__sync_row_number'],rows:failure==='missing'?[[1,4,1]]:failure==='count'?[[1,5,1],[2,5,2]]:failure==='duplicate'?[[1,4,1],[2,4,1]]:call===2?[[1,4,1],[2,4,2]]:[[3,4,3],[4,4,4]]};
    });
    if(failure==='none')assert.equal((await run).rows.length,4);
    else await assert.rejects(run,/分页/);
  }
});
