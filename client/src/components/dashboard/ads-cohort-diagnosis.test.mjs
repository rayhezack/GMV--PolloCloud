import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseCohort } from './ads-cohort-diagnosis.ts';
const sample={period:'2026-08-12',horizon:'D30',asOf:'2026-11-06',available:true,gmvUsd:19990,costUsd:36671,registerUsers:22857};
test('same-cohort LTV/CAC matches GMV/cost and exposes the recovery gap',()=>{
  const d=diagnoseCohort(sample);
  assert.equal(d.status,'shortfall');
  assert.equal(d.ltv,19990/22857);assert.equal(d.cac,36671/22857);
  assert.ok(Math.abs(d.ltv/d.cac-d.coverage)<1e-12);
  assert.equal(d.totalGap,-16681);assert.equal(d.perUserGap,-16681/22857);
});
test('maturity and missing source data take precedence over apparent recovery',()=>{
  for(const input of [{...sample,asOf:'2026-08-20'},{...sample,available:false}]) {
    const d=diagnoseCohort(input); assert.equal(d.ltv,null);assert.equal(d.coverage,null);
  }
  assert.equal(diagnoseCohort({...sample,asOf:'2026-09-11'}).status,'shortfall');
});
test('zero users and zero cost cannot manufacture a payback verdict',()=>{
  const users=diagnoseCohort({...sample,registerUsers:0});assert.equal(users.status,'no-users');assert.equal(users.cac,null);assert.equal(users.ltv,null);
  const cost=diagnoseCohort({...sample,costUsd:0});assert.equal(cost.status,'no-cost');assert.equal(cost.coverage,null);
});
test('payback verdict uses raw atoms rather than rounded LTV/CAC',()=>{
  assert.equal(diagnoseCohort({...sample,costUsd:19990}).status,'breakeven');
  assert.equal(diagnoseCohort({...sample,costUsd:19989.99}).status,'covered');
  assert.equal(diagnoseCohort({...sample,costUsd:19990.01}).status,'shortfall');
});
