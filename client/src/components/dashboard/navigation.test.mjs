import test from 'node:test';
import assert from 'node:assert/strict';
import { anomalyDashboardHref } from './navigation.ts';

const alert = { platform: 'web', metric: 'totalGmv', period: '2026-11-08', window: 'day' };
const paramsOf = (href) => new URL(href, 'https://example.test').searchParams;

test('anomaly navigation brings an excluded date into the visible chart window', () => {
  for (const range of [
    { startDate: '2026-10-06', endDate: '2026-11-04' },
    { startDate: '2026-11-09', endDate: '2026-11-09' },
  ]) {
    const params = paramsOf(anomalyDashboardHref('?tab=trend&platform=all&deviceType=ios&metric=activeGmv', alert, range));
    assert.equal(params.get('trendStartDate'), '2026-10-10');
    assert.equal(params.get('trendEndDate'), alert.period);
    assert.equal(params.get('focusPeriod'), alert.period);
    assert.equal(params.get('focusMetric'), 'totalGmv');
    assert.equal(params.get('platform'), 'web');
    assert.equal(params.get('metric'), 'activeGmv');
    assert.equal(params.get('deviceType'), null);
  }
});

test('an anomaly already visible keeps the chosen chart range and comparison settings', () => {
  const search = '?trendStartDate=2026-11-01&trendEndDate=2026-11-09&baselineWeek=2026-10-24&analysisWeek=2026-10-31';
  const params = paramsOf(anomalyDashboardHref(search, {...alert, window:'week'}, {startDate:'2026-11-01',endDate:'2026-11-09'}));
  assert.equal(params.get('trendStartDate'), '2026-11-01');
  assert.equal(params.get('trendEndDate'), '2026-11-09');
  assert.equal(params.get('baselineWeek'), '2026-10-24');
  assert.equal(params.get('analysisWeek'), '2026-10-31');
  assert.equal(params.get('focusWindow'), 'week');
});
