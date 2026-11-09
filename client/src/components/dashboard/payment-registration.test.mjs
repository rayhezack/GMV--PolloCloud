import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationBreakdown,registrationLabel,registrationDimensions,registrationLayerTrend,formatRegistrationSku } from './payment-registration.ts';

const data = {
  comparison: { analysisPeriod:'2026-10-31', baselinePeriod:'2026-10-24' },
  revenues: [
    { weekStart:'2026-10-31', period:'2026-10-31' },
    { weekStart:'2026-10-24', period:'2026-10-24' },
  ],
  registration: {
    verifiedPayTypes:['renewal'],
    rows: [
      { payType:'renewal', weekStart:'2026-10-31', period:'2026-10-31', userLifecycle:'OLD', countryTier:'T1',regPlatform:'IOS', gmvUsd:120 },
      { payType:'renewal', weekStart:'2026-10-24', period:'2026-10-24', userLifecycle:'OLD', countryTier:'T1',regPlatform:'IOS', gmvUsd:100 },
      { payType:'upgrade', weekStart:'2026-10-31', period:'2026-10-31', userLifecycle:'NEW', countryTier:'T2', gmvUsd:999 },
    ],
  },
};

for (const dimension of ['userLifecycle','countryTier','regPlatform']) {
  test(`${dimension}: unverified registration money never enters contribution analysis`, () => {
    assert.equal(registrationBreakdown(data,'upgrade',dimension), null);
    assert.equal(registrationBreakdown({...data,registration:undefined},'renewal',dimension), null);
    assert.equal(registrationBreakdown({...data,comparison:undefined},'renewal',dimension), null);
    assert.equal(registrationBreakdown({...data,registration:{...data.registration,verifiedPayTypes:[]}},'renewal',dimension), null);
  });
  test(`${dimension}: verified payment types use only matched comparison days`, () => {
    const result = registrationBreakdown(data,'renewal',dimension);
    assert.deepEqual(result,[{key:dimension==='userLifecycle'?'老用户':dimension==='countryTier'?'T1':'iOS',baseline:100,analysis:120}]);
    assert.equal(registrationBreakdown({...data,revenues:[data.revenues[0]]},'renewal',dimension),null);
  });
  test(`${dimension}: missing source rows are not synthesized from payment totals`, () => {
    assert.equal(registrationBreakdown({...data,registration:{verifiedPayTypes:['renewal'],rows:[]}},'renewal',dimension),null);
    assert.equal(registrationBreakdown({...data,registration:{verifiedPayTypes:[],rows:[]}},'renewal',dimension),null);
  });
}


test('business dimensions distinguish actual SKU, upgrade credits and cycle resets without raw underscores',()=>{
  const row={sku:'Pro_月订_2000',previousSku:'Pro_月订_800',creditAmount:'2000',planCycle:'月订',previousPlanCycle:'月订'};
  assert.equal(registrationDimensions('自动续订')[0],'sku');
  assert.equal(registrationDimensions('套餐升级')[0],'upgradeCombination');
  assert.equal(registrationDimensions('积分包')[0],'creditAmount');
  assert.equal(registrationDimensions('重置订阅周期')[0],'cycleTransition');
  assert.equal(registrationDimensions('首订')[0],'userLifecycle');
  assert.equal(registrationLabel(row,'upgradeCombination'),'Pro · 800 积分 · 月付 → Pro · 2,000 积分 · 月付');
  assert.equal(registrationLabel(row,'creditAmount'),'2,000 积分');
  assert.equal(registrationLabel(row,'cycleTransition'),'月付内重置');
  assert.equal(registrationLabel({...row,planCycle:'年订'},'cycleTransition'),'月付 → 年付');
  assert.match(registrationLabel({...row,previousSku:'UNKNOWN'},'upgradeCombination'),/^变更前未知 →/);
  assert.equal(formatRegistrationSku('lite_800_monthly'),'lite 800 月付');
});

test('single-layer trend preserves analysis/baseline totals, baseline-only segments, unknowns and gaps',()=>{
  const rows=[
    ...['T1','T2','T3','T1','T2','T3'].map((countryTier,i)=>({period:'2026-10-20',countryTier,regPlatform:'WEB',userLifecycle:'OLD',gmvUsd:10+i})),
    {period:'2026-10-13',countryTier:'T2',regPlatform:'UNKNOWN',userLifecycle:'NEW',gmvUsd:25},
  ];
  const history={points:[{period:'2026-10-13',total:25,verified:true},{period:'2026-10-20',total:75,verified:true},{period:'2026-10-21',total:90,verified:false},{period:'2026-10-22',total:null,verified:false}],rows};
  for(const dimension of ['countryTier','regPlatform','userLifecycle']) {
    const keys=[...new Set(rows.map(row=>registrationLabel(row,dimension)))];
    const series=keys.map(key=>registrationLayerTrend(history,dimension,key,7,'2026-10-22'));
    assert.equal(series.reduce((sum,points)=>sum+points.find(p=>p.date==='2026-10-20').analysis,0),75);
    assert.equal(series.reduce((sum,points)=>sum+points.find(p=>p.date==='2026-10-20').baseline,0),25);
    assert.ok(series.every(points=>points.filter(p=>p.date>='2026-10-21').every(p=>p.analysis===null)));
  }
  const unknown=registrationLayerTrend(history,'regPlatform','未知',7,'2026-10-22');
  assert.equal(unknown.find(p=>p.date==='2026-10-20').baseline,25);
});
