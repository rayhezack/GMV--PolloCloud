import test from 'node:test';
import assert from 'node:assert/strict';
import {chainGroupRows,groupedTierLabels,populationContribution} from './chain-display.ts';
const factor=(key,baseline,current,effect=1)=>({key,baseline,current,effect,contribution:.1,label:key,unit:'count'});
const group=(key,a,b,effect=1)=>({key,label:key.replace('NEW','新用户').replace('OLD','老用户'),baseline:100000,current:200000,factors:[factor('activeUv',a,b),factor('subExposeRate',.4,.5,effect)]});
test('country children sum to 100% within each lifecycle even when new and old changes offset', () => {
 const roots=[{key:'NEW',baseline:15111,current:10502},{key:'OLD',baseline:58294,current:60501}];
 const children={NEW:[{baseline:10558,current:7977},{baseline:3617,current:1974},{baseline:936,current:551}],OLD:[{baseline:30000,current:32500},{baseline:20000,current:19500},{baseline:8294,current:8501}]};
 for(const key of ['NEW','OLD']) {
   const shares=children[key].map(row=>populationContribution(row,roots,key));
   assert.ok(Math.abs(shares.reduce((sum,v)=>sum+v,0)-1)<1e-12);
 }
 assert.ok(Math.abs(populationContribution(children.NEW[0],roots,'NEW')-2581/4609)<1e-12);
 assert.ok(populationContribution(children.OLD[1],roots,'OLD')<0);
 assert.ok(Math.abs(roots.reduce((sum,row)=>sum+populationContribution(row,roots),0)-1)<1e-12);
});
test('zero parent delta is undefined even when the overall net change is nonzero', () => {
 const roots=[{key:'NEW',baseline:100,current:100},{key:'OLD',baseline:100,current:200}];
 assert.equal(populationContribution({baseline:60,current:80},roots,'NEW'),null);
 assert.equal(populationContribution({baseline:60,current:80},roots,'MISSING'),null);
});
test('small samples use population factor, strict <100 in both periods, never GMV',()=>{
 const rows=chainGroupRows([group('create_cnt_30d_0 × NEW',99,99),group('create_cnt_30d_0 × OLD',100,20),group('create_cnt_30d_[1,11) × NEW',50,200)],'subExposeRate','active');
 assert.deepEqual(rows.map(r=>r.small),[true,false,false]);
});
test('undefined factor contribution is folded and all raw groups remain available',()=>{
 const rows=chainGroupRows([group('create_cnt_30d_0 × OLD',1000,2000,null)],'subExposeRate','active');assert.equal(rows[0].small,true);assert.equal(rows[0].factor.effect,null);
});
test('visible strata labels group after filtering, NEW before OLD',()=>{
 const rows=chainGroupRows([group('create_cnt_30d_0 × OLD',500,500),group('create_cnt_30d_[1,11) × OLD',500,500),group('create_cnt_30d_0 × NEW',500,500)],'subExposeRate','active');
 const labels=groupedTierLabels(rows);assert.deepEqual(labels.map(r=>r.showTier),[true,false,true]);assert.equal(labels[0].lifecycle,'新用户');assert.equal(labels[1].lifecycle,'老用户');
});
test('renewal uses expiring population; unknown count does not masquerade as small',()=>{
 const g={key:'PRO',label:'PRO',baseline:10,current:20,factors:[factor('expireUserCnt',99,50),factor('renewalRate',.4,.5)]};assert.equal(chainGroupRows([g],'renewalRate','renewal')[0].small,true);
 assert.equal(chainGroupRows([{...g,factors:[factor('renewalRate',.4,.5)]}],'renewalRate','renewal')[0].small,false);
});
