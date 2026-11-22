import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDates} from './calendar-display.ts';
test('date range reads Monday–Sunday with October 6 on Tuesday, not under a week-start label',()=>{
 const {dates,rows}=calendarDates('2026-10-06','2026-11-30','2026-11-04');
 assert.equal(rows,5);assert.equal(dates[0],null);assert.equal(dates[1],'2026-10-06');
 assert.equal(dates[27],'2026-11-01');assert.equal(dates[28],'2026-11-02');
 assert.equal(dates[30],'2026-11-04');assert.deepEqual(dates.slice(31),[null,null,null,null]);
 assert.equal(dates.filter(Boolean).length,30);
});
test('calendar retains 26-week cap, missing range and year boundary positions',()=>{
 assert.equal(calendarDates('2026-11-05','2026-11-04').rows,0);
 const long=calendarDates('2025-01-01','2026-11-04');assert.equal(long.rows,26);assert.equal(long.truncated,true);
 const year=calendarDates('2026-12-31','2027-01-02');assert.equal(year.dates[3],'2026-12-31');assert.equal(year.dates[4],'2027-01-01');
});
