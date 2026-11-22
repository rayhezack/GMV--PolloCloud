import test from 'node:test';
import assert from 'node:assert/strict';
import {chainGroupRows,groupedTierLabels} from './chain-display.ts';
const factor=(key,baseline,current,effect=1)=>({key,baseline,current,effect,contribution:.1,label:key,unit:'count'});
const group=(key,a,b,effect=1)=>({key,label:key.replace('NEW','新用户').replace('OLD','老用户'),baseline:100000,current:200000,factors:[factor('activeUv',a,b),factor('subExposeRate',.4,.5,effect)]});
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
