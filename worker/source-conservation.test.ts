import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { assertCreationConservation, assertPaymentModeConservation } from './source-conservation.ts';

const mode = (attribution_type: string, gmv_usd: number) => ({
  period: '2026-11-06', platform: 'all', device_type: 'web', pay_type: '首订', attribution_type, gmv_usd,
});

test('creation conserves every additive metric while allowing overlapping function UV', () => {
  const row = {period:'2026-11-06',platform_type:'WEB',creation_task_cnt:10,valid_creation_task_cnt:9,success_task_cnt:8,success_output_cnt:12,adopted_task_cnt:4,adopted_output_cnt:5,gmv_usd:10.000001,creation_user_cnt:6};
  const child = {...row,creation_task_cnt:5,valid_creation_task_cnt:4,success_task_cnt:3,success_output_cnt:5,adopted_task_cnt:1,adopted_output_cnt:2,gmv_usd:4,creation_user_cnt:5};
  const sibling = {...row,creation_task_cnt:5,valid_creation_task_cnt:5,success_task_cnt:5,success_output_cnt:7,adopted_task_cnt:3,adopted_output_cnt:3,gmv_usd:6.000001,creation_user_cnt:5};
  assert.doesNotThrow(() => assertCreationConservation([row],[child,sibling]));
  for (const field of ['creation_task_cnt','valid_creation_task_cnt','success_task_cnt','success_output_cnt','adopted_task_cnt','adopted_output_cnt','gmv_usd'] as const) {
    assert.throws(() => assertCreationConservation([row],[child,{...sibling,[field]:sibling[field]+(field==='gmv_usd'?.000001:1)}]), /不守恒/);
  }
  assert.throws(() => assertCreationConservation([row,row],[child,sibling]), /重复/);
  assert.throws(() => assertCreationConservation([row],[{...child,platform_type:'IOS'}]), /缺少/);
});

test('payment modes conserve to the cent and reject a one-cent drift', () => {
  const rows = ['NONE', 'CREATION_MODE', 'MODEL', 'ACTUAL_MODEL'].map(name => mode(name, 100.01));
  assert.doesNotThrow(() => assertPaymentModeConservation(rows));
  assert.throws(() => assertPaymentModeConservation([...rows.slice(0, 3), mode('ACTUAL_MODEL', 100)]), /不守恒/);
});
