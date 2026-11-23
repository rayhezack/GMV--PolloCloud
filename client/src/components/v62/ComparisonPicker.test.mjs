import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Exercise the real comparison component with the same strict ISO parser used
// by its date fields. Lightweight UI wrappers keep this independent of a DOM.
const stubs = {
  '@/components/dashboard/DashboardDatePicker': `
    import {parseDate} from '@internationalized/date';
    export default function DateField({date,maxDate}) {
      return <span data-date={parseDate(date).toString()} data-max={parseDate(maxDate).toString()} />;
    }`,
  '@/components/dashboard/WeekComparisonPicker': `
    export const WeekComparisonPicker = ({analysisWeek,baselineWeek}) =>
      <span data-analysis={analysisWeek} data-baseline={baselineWeek} />;`,
  '@/lib/local-data-window': 'export const LOCAL_DATA_WINDOW = null;',
  './primitives': 'export const Definition = ({children}) => <small>{children}</small>;',
  '@astryxdesign/core/Popover': 'export const Popover = ({children,content}) => <div>{children}{content}</div>;',
  '@/components/icons/WorkbenchIcon': 'export const WorkbenchIcon = () => null;',
};
const output = fileURLToPath(new URL(`.comparison-picker-${process.pid}.mjs`, import.meta.url));
after(() => unlinkSync(output));
await build({
  entryPoints: [fileURLToPath(new URL('./ComparisonPicker.tsx', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  jsx: 'automatic',
  plugins: [
    {
      name: 'ui-wrappers',
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, (args) =>
          args.path in stubs
            ? { path: args.path, namespace: 'stub' }
            : args.namespace === 'stub'
              ? { path: args.path, external: true }
              : undefined,
        );
        plugin.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'jsx' }));
      },
    },
  ],
});
const { default: ComparisonPicker } = await import(pathToFileURL(output).href);
const props = { analysis: '2026-11-22', baseline: '2026-11-15', maxDate: '2026-11-22', mode: 'day', onChange() {} };
const render = (values) => renderToStaticMarkup(React.createElement(ComparisonPicker, { ...props, ...values }));

for (const mode of ['day', 'week']) {
  for (const missing of ['analysis', 'baseline', 'maxDate']) {
    test(`${mode}: waits for ${missing} before mounting comparison controls`, () => {
      assert.equal(render({ mode, [missing]: '' }), '');
    });
  }
}
test('day: restores both real ISO date fields when coverage arrives, inline and compact', () => {
  for (const compactDay of [false, true]) {
    assert.equal(render({ compactDay, maxDate: '' }), '');
    const html = render({ compactDay });
    assert.match(html, /data-date="2026-11-22"/);
    assert.match(html, /data-date="2026-11-15"/);
    assert.match(html, /data-max="2026-11-22"/);
  }
});
test('week: retains the requested business weeks once coverage is ready', () => {
  const html = render({ mode: 'week', analysis: '2026-11-21', baseline: '2026-11-14' });
  assert.match(html, /data-analysis="2026-11-21"/);
  assert.match(html, /data-baseline="2026-11-14"/);
});
