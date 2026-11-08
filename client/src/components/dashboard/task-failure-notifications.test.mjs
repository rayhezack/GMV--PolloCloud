import assert from 'node:assert/strict';
import test from 'node:test';
import { claimFailureNotification } from './task-failure-notifications.ts';

const store = () => {
  const data = new Map();
  return {getItem:(key)=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);}};
};
const event = (status, minute, errorMessage='MaxCompute 结果被截断') => ({kind:'sync',status,errorMessage,startedAt:'2026-11-08T00:00:00Z',updatedAt:`2026-11-08T00:${String(minute).padStart(2,'0')}:00Z`});

test('identical errors across retries and runs notify once, until recovery',()=>{
  const s=store();
  assert.equal(claimFailureNotification(event('failed',1),s),true);
  assert.equal(claimFailureNotification(event('failed',2),s),false);
  assert.equal(claimFailureNotification(event('failed',3),s),false);
  assert.equal(claimFailureNotification(event('success',2),s),false); // stale success cannot reset a newer failure
  assert.equal(claimFailureNotification(event('failed',4),s),false);
  assert.equal(claimFailureNotification(event('success',5),s),false);
  assert.equal(claimFailureNotification(event('failed',6),s),true);
});

test('distinct errors/kinds notify independently and whitespace does not duplicate an error',()=>{
  const s=store();
  assert.equal(claimFailureNotification(event('failed',1,'网络错误'),s),true);
  assert.equal(claimFailureNotification(event('failed',2,' 网络错误  '),s),false);
  assert.equal(claimFailureNotification(event('failed',3,'字段缺失'),s),true);
  assert.equal(claimFailureNotification({...event('failed',4,'网络错误'),kind:'report'},s),true);
  claimFailureNotification(event('success',5),s);
  assert.equal(claimFailureNotification({...event('failed',6,'网络错误'),kind:'report'},s),false);
});

test('an unrelated successful data source does not restart duplicate errors',()=>{
  const s=store(),scoped=(status,minute,scope)=>({...event(status,minute),recoveryScopes:[scope]});
  assert.equal(claimFailureNotification(scoped('failed',1,'creative'),s),true);
  assert.equal(claimFailureNotification(scoped('failed',2,'renewal'),s),false);
  claimFailureNotification(scoped('success',3,'chain'),s);
  assert.equal(claimFailureNotification(scoped('failed',4,'creative'),s),false);
  claimFailureNotification(scoped('success',5,'creative'),s);
  assert.equal(claimFailureNotification(scoped('failed',6,'renewal'),s),false);
  claimFailureNotification({...event('success',7),recoveryScopes:['creative','renewal']},s);
  assert.equal(claimFailureNotification(scoped('failed',8,'creative'),s),true);
});
