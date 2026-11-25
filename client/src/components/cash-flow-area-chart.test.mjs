import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { alignPolylines, areaPath, linePath, smoothPath, valueAt } from '../lib/chart-series.ts';

// Run the real morph effect with a controllable animation clock. Resizing a
// percentage axis must cancel the old, wider animation before it can finish.
function loadMorph(file, component) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === component).body;
  const callback = body.statements.find(
    (node) =>
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(ast) === 'useIsomorphicLayoutEffect' &&
      node.expression.arguments[0].getText(ast).includes('lastData.current'),
  ).expression.arguments[0];
  const code = ts.transpileModule(callback.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return (values) =>
    new Function(...Object.keys(values), `return (${code.replace(/;\s*$/, '')})();`)(...Object.values(values));
}
const effect = loadMorph('./cash-flow-area-chart.tsx', 'CashFlowAreaChart');
const element = () => ({
  attrs: {},
  setAttribute(k, v) {
    this.attrs[k] = v;
  },
});

test('expanded revenue action charts also retire a morph when the plot resizes', () => {
  const effect = loadMorph('./cash-balance-chart.tsx', 'CashBalanceChart');
  const path = element();
  const wide = [
      { x: 0, y: 100 },
      { x: 624, y: 150 },
    ],
    narrow = [
      { x: 0, y: 100 },
      { x: 596, y: 150 },
    ];
  const animations = [];
  const context = {
    lastData: { current: { key: 'old', line: wide, band: null } },
    dataKey: 'new',
    line: wide,
    band: null,
    width: 624,
    PLOT_HEIGHT: 240,
    reduced: false,
    morph: { current: null },
    lineRef: { current: path },
    bandRef: { current: null },
    alignPolylines,
    smoothPath,
    animate(state, options) {
      const a = {
        cancelled: false,
        cancel() {
          this.cancelled = true;
        },
        finish() {
          if (!this.cancelled) options.onComplete();
        },
      };
      animations.push(a);
      return a;
    },
  };
  const cleanup = effect(context);
  path.setAttribute('d', smoothPath(narrow));
  if (typeof cleanup === 'function') cleanup();
  effect({ ...context, line: narrow, width: 596 });
  animations.forEach((a) => a.finish());
  assert.equal(path.attrs.d, smoothPath(narrow));
  assert.ok(animations[0].cancelled);
});

test('axis width changes cannot be overwritten by a running data morph', () => {
  const path = element(),
    area = element(),
    grey = element(),
    fill = element();
  const animations = [];
  const dot = {
    style: {
      translate: '',
      removeProperty(name) {
        delete this[name];
      },
    },
    parentElement: { dataset: { series: 'current' } },
  };
  const wide = [
    { x: 12, y: 100 },
    { x: 612, y: 150 },
  ];
  const narrow = [
    { x: 12, y: 100 },
    { x: 584, y: 150 },
  ];
  const context = {
    lastData: {
      current: {
        key: 'old',
        current: [
          { x: 12, y: 80 },
          { x: 612, y: 120 },
        ],
        previous: wide,
        fillTop: 81,
        width: 624,
        height: 240,
      },
    },
    dataKey: 'new',
    current: wide,
    previous: wide,
    fillTop: 101,
    width: 624,
    plotHeight: 240,
    morph: { current: null },
    lineRef: { current: path },
    areaRef: { current: area },
    compareRef: { current: grey },
    fillRef: { current: fill },
    all: () => [dot],
    reduced: false,
    gapped: false,
    cursorX: 612,
    compareY: undefined,
    currentY: 150,
    alignPolylines,
    areaPath,
    linePath,
    gappedLine: linePath,
    gappedArea: (points, height) => areaPath(points, height, 1),
    valueAt,
    AREA_OFFSET: 1,
    PLOT_HEIGHT: 240,
    animate(state, options) {
      const animation = {
        cancelled: false,
        cancel() {
          this.cancelled = true;
        },
        finish() {
          if (!this.cancelled) {
            options.onUpdate();
            options.onComplete();
          }
        },
      };
      animations.push(animation);
      return animation;
    },
  };
  const cleanup = effect(context);
  // React commits the new geometry when ResizeObserver sees wider rate labels.
  path.setAttribute('d', linePath(narrow));
  if (typeof cleanup === 'function') cleanup();
  effect({ ...context, current: narrow, previous: narrow, width: 596, cursorX: 584 });
  animations.forEach((animation) => animation.finish());
  assert.equal(path.attrs.d, linePath(narrow));
  assert.ok(animations[0].cancelled, 'old animation must not keep writing obsolete coordinates');
  assert.equal(dot.style.translate, undefined, 'cancelled morph must release its marker displacement');
});
