import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationBreakdown } from './payment-registration.ts';

const data = {
  comparison: { analysisPeriod:'2026-10-31', baselinePeriod:'2026-10-24' },
  revenues: [
    { weekStart:'2026-10-31', period:'2026-10-31' },
    { weekStart:'2026-10-24', period:'2026-10-24' },
  ],
  registration: {
    verifiedPayTypes:['renewal'],
    rows: [
      { payType:'renewal', weekStart:'2026-10-31', period:'2026-10-31', userLifecycle:'OLD', regCountry:'US', gmvUsd:120 },
      { payType:'renewal', weekStart:'2026-10-24', period:'2026-10-24', userLifecycle:'OLD', regCountry:'US', gmvUsd:100 },
      { payType:'upgrade', weekStart:'2026-10-31', period:'2026-10-31', userLifecycle:'NEW', regCountry:'JP', gmvUsd:999 },
    ],
  },
};

for (const dimension of ['userLifecycle','regCountry']) {
  test(`${dimension}: unverified registration money never enters contribution analysis`, () => {
    assert.equal(registrationBreakdown(data,'upgrade',dimension), null);
    assert.equal(registrationBreakdown({...data,registration:undefined},'renewal',dimension), null);
    assert.equal(registrationBreakdown({...data,comparison:undefined},'renewal',dimension), null);
    assert.equal(registrationBreakdown({...data,registration:{...data.registration,verifiedPayTypes:[]}},'renewal',dimension), null);
  });
  test(`${dimension}: verified payment types use only matched comparison days`, () => {
    const result = registrationBreakdown(data,'renewal',dimension);
    assert.deepEqual(result,[{key:dimension==='userLifecycle'?'老用户':'US',baseline:100,analysis:120}]);
    assert.equal(registrationBreakdown({...data,revenues:[data.revenues[0]]},'renewal',dimension),null);
  });
}
