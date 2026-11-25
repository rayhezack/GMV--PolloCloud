import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Execute the real hook through pending/resolved requests. Only React's hook
// scheduler and the API boundary are replaced; the coverage selection is real.
const runtime = `
  export const hooks = { states: [], effects: [], pending: [], requests: [], cursor: 0 };
  export function useState(initial) {
    const i = hooks.cursor++;
    if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], value => { hooks.states[i] = typeof value === 'function' ? value(hooks.states[i]) : value; }];
  }
  export function useEffect(effect, deps) {
    const i = hooks.cursor++, previous = hooks.effects[i];
    if (!previous || deps.some((value, n) => value !== previous.deps[n])) {
      previous?.cleanup?.();
      const entry = { deps };
      hooks.effects[i] = entry;
      hooks.pending.push(() => { entry.cleanup = effect(); });
    }
  }
  export const STATIC_DEMO_MODE = false;
  export function getDataCoverage(params) {
    return new Promise((resolve, reject) => hooks.requests.push({params, resolve, reject}));
  }
`;
const output = fileURLToPath(new URL(`.coverage-test-${process.pid}.mjs`, import.meta.url));
after(() => unlinkSync(output));
const source = readFileSync(new URL('./useDataCoverage.ts', import.meta.url), 'utf8');
await build({
  stdin: { contents: source + '\nexport { hooks } from "react";', loader: 'ts', resolveDir: process.cwd() },
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'hook-runtime',
      setup(plugin) {
        plugin.onResolve({ filter: /^(react|@\/api\/dashboard|@\/lib\/demo-data)$/ }, () => ({
          path: 'runtime',
          namespace: 'stub',
        }));
        plugin.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: runtime, loader: 'js' }));
      },
    },
  ],
});
const { useDataCoverage, hooks } = await import(pathToFileURL(output).href);
const coverage = { startDate: '2026-08-01', endDate: '2026-11-24' };
function reset() {
  Object.assign(hooks, { states: [], effects: [], pending: [], requests: [], cursor: 0 });
}
function render(platform = 'web', revision = 0, dataset = 'chain', deviceType) {
  hooks.cursor = 0;
  const value = useDataCoverage(dataset, platform, deviceType, revision);
  hooks.pending.splice(0).forEach((run) => run());
  return value;
}
async function resolve(request, value) {
  request.resolve(value);
  await Promise.resolve();
}

test('same-scope refresh retains valid dates throughout the pending request', async () => {
  reset();
  assert.equal(render().coverage, null);
  await resolve(hooks.requests.at(-1), coverage);
  assert.deepEqual(render().coverage, coverage);
  const pending = render('web', 1);
  assert.equal(pending.loading, true);
  assert.deepEqual(pending.coverage, coverage);
  assert.equal(pending.coverage.endDate, '2026-11-24');
  const updated = { ...coverage, endDate: '2026-11-25' };
  await resolve(hooks.requests.at(-1), updated);
  assert.deepEqual(render('web', 1), { coverage: updated, loading: false, error: '' });
});

test('refresh failure preserves dates and exposes a retryable error', async () => {
  reset();
  render();
  await resolve(hooks.requests.at(-1), coverage);
  render();
  render('web', 1);
  hooks.requests.at(-1).reject(new Error('network unavailable'));
  await new Promise((resolve) => setImmediate(resolve));
  const failed = render('web', 1);
  assert.deepEqual(failed.coverage, coverage);
  assert.equal(failed.loading, false);
  assert.ok(failed.error);
});

test('platform, dataset and device changes never reuse another scope’s dates', async () => {
  for (const next of [
    ['app', 1],
    ['web', 1, 'renewal'],
    ['app', 1, 'chain', 'ios'],
  ]) {
    reset();
    render();
    await resolve(hooks.requests.at(-1), coverage);
    render();
    assert.deepEqual(render(...next), { coverage: null, loading: true, error: '' });
  }
});

test('an older in-flight request cannot overwrite the current scope', async () => {
  reset();
  render();
  const previous = hooks.requests.at(-1);
  render('app', 1);
  const current = hooks.requests.at(-1);
  await resolve(previous, coverage);
  assert.equal(render('app', 1).coverage, null);
  const appCoverage = { startDate: '2026-10-01', endDate: '2026-11-20' };
  await resolve(current, appCoverage);
  assert.deepEqual(render('app', 1).coverage, appCoverage);
});
