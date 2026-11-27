import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDates, calendarPeak} from './calendar-display.ts';
test('date range reads Monday–Sunday with October 6 on Tuesday, not under a week-start label',()=>{
 const {dates,rows}=calendarDates('2026-10-06','2026-11-30','2026-11-04');
 assert.equal(rows,5);assert.equal(dates[0],null);assert.equal(dates[1],'2026-10-06');
 assert.equal(dates[27],'2026-11-01');assert.equal(dates[28],'2026-11-02');
 assert.equal(dates[30],'2026-11-04');assert.equal(dates.length,31);
 assert.equal(dates.filter(Boolean).length,30);
});
test('partial final weeks stop at the last available day without future placeholders',()=>{
 for(let day=23;day<=29;day++){
  const end=`2026-11-${day}`;
  const {dates,rows}=calendarDates('2026-08-24','2026-11-30',end);
  assert.equal(dates.at(-1),end);
  assert.ok(dates.every(date=>date!=null && date<=end));
  assert.equal(rows,14);
  assert.equal(dates.length,92+day-23);
 }
});
test('calendar preserves the entire selected range, missing range and year boundary positions',()=>{
 assert.equal(calendarDates('2026-11-05','2026-11-04').rows,0);
 const long=calendarDates('2025-01-01','2026-11-04');assert.equal(long.dates.find(Boolean),'2025-01-01');assert.equal(long.dates.filter(Boolean).at(-1),'2026-11-04');assert.equal(long.truncated,false);
 const year=calendarDates('2026-12-31','2027-01-02');assert.equal(year.dates[3],'2026-12-31');assert.equal(year.dates[4],'2027-01-01');
});

test('four-month selection includes every selected date',()=>{
 const result=calendarDates('2026-07-05','2026-11-04');
 assert.equal(result.dates.filter(Boolean).length,123);assert.equal(result.dates.find(Boolean),'2026-07-05');
});

test('peak considers only visible finite observations, keeping zero and preferring the latest tie',()=>{
 const values=new Map([['2026-11-01',999],['2026-11-02',0],['2026-11-03',null],['2026-11-04',8],['2026-11-05',8],['2026-11-06',NaN]]);
 assert.deepEqual(calendarPeak(values,['2026-11-02']),{date:'2026-11-02',value:0});
 assert.deepEqual(calendarPeak(values,['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06']),{date:'2026-11-05',value:8});
 assert.equal(calendarPeak(values,['2026-11-03','2026-11-06','2026-11-07']),null);
});
test('GMV and order-count peaks are computed from their own observations, never estimated from money',()=>{
 const rows=[{date:'2026-11-03',gmv:90,orders:2},{date:'2026-11-04',gmv:80,orders:3},{date:'2026-11-05',gmv:100,orders:null}];
 const dates=rows.map(r=>r.date);
 assert.equal(calendarPeak(new Map(rows.map(r=>[r.date,r.gmv])),dates).date,'2026-11-05');
 assert.equal(calendarPeak(new Map(rows.map(r=>[r.date,r.orders])),dates).date,'2026-11-04');
});
