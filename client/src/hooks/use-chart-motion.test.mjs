import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('./use-chart-motion.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('use-chart-motion.ts', source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'useChartEntrance');
const code = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function mount(options) {
  const calls = [];
  let cleanup;
  const dependencies = {
    useReducedMotion: () => false,
    useRef: (current) => ({ current }),
    useIsomorphicLayoutEffect: (effect) => {
      cleanup = effect();
    },
    createTimeline: () => ({ play: () => calls.push('play'), revert: () => calls.push('revert') }),
    IntersectionObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {
        this.callback([{ isIntersecting: true }]);
      }
      disconnect() {}
    },
  };
  const entrance = new Function(
    ...Object.keys(dependencies),
    `${code.replace(/^export /, '')}; return useChartEntrance;`,
  )(...Object.values(dependencies));
  entrance(
    { current: {} },
    () => {
      calls.push('build');
      return () => calls.push('cleanup');
    },
    options,
  );
  return { calls, unmount: () => cleanup?.() };
}

test('a default data chart mounts immediately without hiding its SVG for a reveal', () => {
  const chart = mount();
  assert.deepEqual(chart.calls, []);
  chart.unmount();
});

test('an explicitly requested decorative timeline still plays and cleans up', () => {
  const chart = mount({ mode: 'timeline' });
  assert.deepEqual(chart.calls, ['build', 'play']);
  chart.unmount();
  assert.deepEqual(chart.calls, ['build', 'play', 'revert', 'cleanup']);
});
