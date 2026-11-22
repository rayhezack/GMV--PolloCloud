import test from 'node:test';
import assert from 'node:assert/strict';
import { homeBuckets, homeValue } from './home-data.ts';
const p = (period, expireUserCnt, renewUserCnt) => ({
  period,
  expireUserCnt,
  renewUserCnt,
  renewalRate: renewUserCnt / expireUserCnt,
  totalGmv: 100,
  activeGmv: 70,
  renewalGmv: 30,
  totalOrders: 12.5,
  activeOrders: 8.5,
});
test('home renewal rate uses summed users across days and preserves pp semantics', () => {
  const rows = [p('2026-10-24', 100, 30), p('2026-10-25', 10, 9)];
  assert.equal(homeBuckets(rows, 'renewalRate', false, '2026-10-24', '2026-10-25', 'week')[0].value, 39 / 110);
  assert.equal(homeValue(rows[0], 'totalGmv', true), 12.5);
  assert.equal(homeValue(rows[0], 'activeGmv', true), 8.5);
  assert.equal(homeValue({ ...rows[0], totalOrders: null }, 'totalGmv', true), null);
});
test('missing renewal data or zero eligible users never becomes a zero rate', () => {
  const rows = [p('2026-10-24', 100, 30), { ...p('2026-10-25', 10, 9), renewalRate: null }];
  assert.ok(Number.isNaN(homeBuckets(rows, 'renewalRate', false, '2026-10-24', '2026-10-25', 'week')[0].value));
  assert.ok(
    Number.isNaN(
      homeBuckets([p('2026-10-24', 0, 0)], 'renewalRate', false, '2026-10-24', '2026-10-24', 'day')[0].value,
    ),
  );
});
