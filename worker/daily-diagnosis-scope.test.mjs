import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../client/src/lib/daily-diagnosis-scope.ts', import.meta.url), 'utf8');
const api = {};
new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(api);
const period = '2026-11-08';
const saved = (platform, date = period, status = 'success') => ({ platform, period: date, status, report: { periodEnd: date } });

test('today’s stack includes only triggered scopes, even when another scope has a saved report', () => {
  const scopes = api.dailyDiagnosisScopes([
    { platform: 'all', period }, { platform: 'web', period }, { platform: 'web', period },
    { platform: 'app', period: '2026-11-07' },
  ], period);
  assert.deepEqual(scopes, ['all', 'web']);
  assert.deepEqual(api.completedDailyDiagnosisScopes(scopes, { all: saved('all'), web: saved('web'), app: saved('app') }, period), ['all', 'web']);
});

test('unfinished or historical reports never count as completed reports for today', () => {
  assert.deepEqual(api.completedDailyDiagnosisScopes(['all', 'web', 'app'], {
    all: saved('all'), web: saved('web', period, 'running'), app: saved('app', '2026-11-07'),
  }, period), ['all']);
  assert.deepEqual(api.dailyDiagnosisScopes([], period), []);
});
