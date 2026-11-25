import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('./use-chart-motion.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('use-chart-motion.ts', source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'useChartEntrance');
const code = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function mount(options, reduced = false) {
  const calls = [];
  const plot = {
    style: {
      clipPath: '',
      removeProperty() {
        this.clipPath = '';
      },
    },
    matches: () => false,
    getBoundingClientRect: () => ({ width: 600, height: 224 }),
  };
  let cleanup;
  let complete;
  const dependencies = {
    useReducedMotion: () => reduced,
    useRef: (current) => ({ current }),
    useIsomorphicLayoutEffect: (effect) => {
      cleanup = effect();
    },
    createTimeline: () => ({
      duration: 1900,
      seek: () => calls.push('seek'),
      play: () => calls.push('play'),
      revert: () => calls.push('revert'),
    }),
    animate: (targets, params) => {
      calls.push('reveal');
      complete = () => params.onComplete({ targets });
      return { cancel: () => calls.push('cancel') };
    },
    releaseStyles:
      () =>
      ({ targets }) =>
        targets.forEach((target) => target.style.removeProperty('clip-path')),
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
    { current: { querySelectorAll: () => [plot] } },
    () => {
      calls.push('build');
      return () => calls.push('cleanup');
    },
    options,
  );
  return { calls, plot, finishReveal: () => complete?.(), unmount: () => cleanup?.() };
}

test('a data chart reveals by default and releases the clipping when complete', () => {
  const chart = mount();
  assert.deepEqual(chart.calls, ['build', 'seek', 'revert', 'cleanup', 'reveal']);
  assert.equal(chart.plot.style.clipPath, 'inset(0 100% 0 0)');
  chart.finishReveal();
  assert.equal(chart.plot.style.clipPath, '');
  chart.unmount();
});

test('unmounting during reveal removes clipping and cancels the animation', () => {
  const chart = mount();
  chart.unmount();
  assert.equal(chart.plot.style.clipPath, '');
  assert.equal(chart.calls.at(-1), 'cancel');
});

test('reduced motion shows the complete chart without a reveal', () => {
  const chart = mount(undefined, true);
  assert.deepEqual(chart.calls, ['build', 'seek', 'revert', 'cleanup']);
  assert.equal(chart.plot.style.clipPath, '');
});

test('an explicitly requested decorative timeline still plays and cleans up', () => {
  const chart = mount({ mode: 'timeline' });
  assert.deepEqual(chart.calls, ['build', 'play']);
  chart.unmount();
  assert.deepEqual(chart.calls, ['build', 'play', 'revert', 'cleanup']);
});
