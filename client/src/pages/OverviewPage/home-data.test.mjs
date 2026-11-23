import test from 'node:test';
import assert from 'node:assert/strict';
import { homeBuckets, homeValue, homeCalendarWindow } from './home-data.ts';
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

test('calendar defaults to a quarter independently of the trend and follows an explicitly chosen range', () => {
  assert.deepEqual(homeCalendarWindow('2026-10-06', '2026-11-04', false), {
    startDate: '2026-08-03',
    endDate: '2026-11-04',
  });
  assert.deepEqual(homeCalendarWindow('2026-07-05', '2026-11-04', true), {
    startDate: '2026-07-05',
    endDate: '2026-11-04',
  });
  assert.deepEqual(homeCalendarWindow('2026-10-28', '2026-11-04', true), {
    startDate: '2026-10-28',
    endDate: '2026-11-04',
  });
});

test('default quarter expands backwards through Monday, including the missing top-left day',()=>{
 assert.deepEqual(homeCalendarWindow('2026-10-24','2026-11-22',false),{startDate:'2026-08-24',endDate:'2026-11-22'});
 for(let offset=0;offset<7;offset++) {
  const end=new Date(Date.UTC(2026,10,22+offset)).toISOString().slice(0,10);
  const result=homeCalendarWindow('',end,false);
  assert.equal(new Date(result.startDate+'T00:00:00Z').getUTCDay(),1);
  const length=(Date.parse(end)-Date.parse(result.startDate))/86400000+1;
  assert.ok(length>=90&&length<=96);
 }
});
