import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareReportData} from './report-data.ts';
test('both real platforms keep all countries, functions, daily evidence, action records and calculated precision',async()=>{
  for(const p of ['web','app']){
    const data=JSON.parse(await readFile(`archives/report-pipeline-stage2-2026-11-08/${p}-evidence.json`,'utf8'));
    const original=structuredClone(data),prepared=prepareReportData(data);
    assert.equal(prepared,data);assert.deepEqual(prepared,original);
    assert.ok(prepared.ads.countries.length>3);assert.ok(prepared.creation.functions.length>3);
    assert.ok(prepared.activeChain.lifecycle[0].daily.length>0);
    assert.ok(prepared.productActions.eligible.length>0);
    assert.equal(prepared.routes,undefined);assert.equal(prepared.facts,undefined);
  }
});
test('optional data gaps remain visible without blocking otherwise valid core data',async()=>{
  const data=JSON.parse(await readFile('archives/report-pipeline-stage2-2026-11-08/app-evidence.json','utf8'));
  data.checks.push({id:'creation.function.current',passed:false});data.gaps.push('optional source missing');
  assert.equal(prepareReportData(data),data);
  assert.throws(()=>prepareReportData({schemaVersion:1}),/新版数据/);
});
