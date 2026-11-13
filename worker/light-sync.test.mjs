import test from 'node:test';
import assert from 'node:assert/strict';
import { isLightSyncGroup, runLightSyncGroup } from './light-sync.ts';

function job() {
  return {datasets:['renewal','ads','creation_chain'],startDate:'2026-11-12',endDate:'2026-11-12',status:'running',rowsSynced:0,
    steps:['all-renewal','web-renewal','app-renewal','all-ads','all-creation_chain','finish'].map(key=>({key,label:key,status:'waiting'}))};
}
test('only bounded single-day light groups qualify; expensive sources stay separate',()=>{
  assert.equal(isLightSyncGroup(job()),true);
  assert.equal(isLightSyncGroup({...job(),datasets:['pay_type','ads']}),false);
  assert.equal(isLightSyncGroup({...job(),datasets:['creative','ads']}),false);
  assert.equal(isLightSyncGroup({...job(),endDate:'2026-11-13'}),false);
});
test('independent sources run concurrently, failure retains sibling commits, resume skips success',async()=>{
  const j=job(),calls=[],snapshots=[];let active=0,peak=0;const activeScopes=new Set();
  await runLightSyncGroup(j,async key=>{
    calls.push(key);peak=Math.max(peak,++active);
    if(key.endsWith('-renewal')){assert.equal(activeScopes.size,0);activeScopes.add(key);}
    await new Promise(resolve=>setTimeout(resolve,5));
    active--;activeScopes.delete(key);
    if(key==='web-renewal')throw Error('source unavailable');
    return 10;
  },async()=>{snapshots.push(structuredClone(j));});
  assert.equal(peak,3);assert.equal(j.status,'failed');assert.equal(j.rowsSynced,40);
  assert.equal(j.steps.find(s=>s.key==='all-ads').status,'success');
  assert.match(j.errorMessage,/web-renewal.*source unavailable/);
  assert.ok(snapshots.some(s=>s.steps.some(step=>step.key==='all-ads'&&step.status==='success')));
  j.status='running';j.steps.forEach(s=>{if(s.status==='failed')s.status='waiting'});
  const retried=[];
  await runLightSyncGroup(j,async key=>{retried.push(key);return 10},async()=>{});
  assert.equal(j.status,'success');assert.equal(j.rowsSynced,50);assert.deepEqual(retried,['web-renewal']);
});
test('pause prevents further renewal scopes and does not mark unfinished work successful',async()=>{
  const j=job(),calls=[];
  await runLightSyncGroup(j,async key=>{calls.push(key);j.status='paused';return 1},async()=>{});
  assert.equal(j.status,'paused');assert.ok(!calls.includes('web-renewal'));assert.equal(j.steps.at(-1).status,'waiting');
});
