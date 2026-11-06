import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { CHAIN_FACTOR_KEYS, chainDriverEffects, lmdiDriverEffects } from './chain-attribution.ts';

const close = (actual, expected, scale = Math.max(1, Math.abs(expected))) =>
  assert.ok(Math.abs(actual - expected) <= 2e-12 * scale, `${actual} != ${expected}`);
const product = values => values.reduce((total, value) => total * value, 1);
const decompose = (previous, current) => {
  const keys = previous.map((_, i) => `x${i}`);
  const record = values => Object.fromEntries(keys.map((key, i) => [key, values[i]]));
  return Object.values(lmdiDriverEffects(record(previous), record(current), keys));
};
const conserved = (previous, current) => {
  const effects = decompose(previous, current);
  const delta = product(current) - product(previous);
  const scale = Math.max(1, Math.abs(delta), ...effects.map(Math.abs));
  assert.ok(effects.every(Number.isFinite));
  close(effects.reduce((sum, value) => sum + value, 0), delta, scale);
  const reversed = decompose(current, previous);
  effects.forEach((effect, i) => close(effect, -reversed[i], scale));
  return effects;
};

test('positive effects use the logarithmic mean, not a permutation average', () => {
  const effects = conserved([2, 3], [4, 9]);
  const mean = 30 / Math.log(6);
  close(effects[0], mean * Math.log(2));
  close(effects[1], mean * Math.log(3));
  assert.ok(Math.abs(effects[0] - 12) > 0.1); // Shapley would allocate 12 and 18.
});

test('unchanged totals preserve signed offsets; unchanged factors have zero effect', () => {
  const effects = conserved([2, 8, 3], [4, 4, 3]);
  close(effects[0], 48 * Math.log(2));
  close(effects[1], -48 * Math.log(2));
  assert.equal(effects[2], 0);
  assert.deepEqual(decompose([2, 8], [2, 8]), [0, 0]);
});

test('a single changing factor receives the full increase or decrease', () => {
  conserved([2, 3, 5], [2, 6, 5]).forEach((effect, i) => close(effect, [0, 30, 0][i]));
  const effects = conserved([2, 3, 5], [2, 1, 5]);
  close(effects[1], -20);
  close(decompose([1], [1 + Number.EPSILON])[0], Number.EPSILON, Number.EPSILON);
});

test('zero-to-positive and positive-to-zero allocate only to zero-period factors', () => {
  assert.deepEqual(conserved([0, 2, 0], [3, 4, 5]), [30, 0, 30]);
  assert.deepEqual(conserved([3, 4, 5], [0, 2, 0]), [-30, 0, -30]);
  assert.deepEqual(conserved([2, 0, 3], [4, 5, 6]), [0, 120, 0]);
});

test('two zero-total periods have zero limiting effects, including moved zeros', () => {
  assert.deepEqual(conserved([0, 2, 3], [2, 0, 4]), [0, 0, 0]);
  assert.deepEqual(conserved([0, 2, 0], [0, 4, 5]), [0, 0, 0]);
  assert.deepEqual(conserved([0, 0, 0], [0, 0, 0]), [0, 0, 0]);
});

test('explicit zero rule agrees with the common-epsilon positive LMDI limit', () => {
  for (const [previous, current] of [
    [[0, 2, 0], [3, 4, 5]],
    [[3, 4, 5], [0, 2, 0]],
    [[0, 2, 3], [2, 0, 4]],
    [[0, 2, 0], [0, 4, 5]],
  ]) {
    const limit = decompose(previous, current);
    const approximate = epsilon => decompose(
      previous.map(value => value || epsilon), current.map(value => value || epsilon),
    );
    const errors = [1e-8, 1e-40, 1e-120].map(epsilon =>
      Math.max(...approximate(epsilon).map((value, i) => Math.abs(value - limit[i]))),
    );
    assert.ok(errors[2] < errors[1] && errors[1] < errors[0]);
    assert.ok(errors[2] < 0.2);
  }
});

test('five-factor chain wrapper conserves every pair of zero masks (1,024 cases)', () => {
  for (let baselineMask = 0; baselineMask < 32; baselineMask++) {
    for (let currentMask = 0; currentMask < 32; currentMask++) {
      const previous = [1000, 0.5, 0.3, 0.8, 20].map((v, i) => baselineMask & (1 << i) ? 0 : v);
      const current = [900, 0.6, 0.2, 0.9, 30].map((v, i) => currentMask & (1 << i) ? 0 : v);
      const effects = conserved(previous, current);
      const record = values => Object.fromEntries(CHAIN_FACTOR_KEYS.map((key, i) => [key, values[i]]));
      const before = record(previous), after = record(current);
      assert.deepEqual(Object.values(chainDriverEffects(before, after)), effects);
      assert.deepEqual(before, record(previous));
      assert.deepEqual(after, record(current));
    }
  }
});

test('positive cases conserve, reverse signs, and preserve factor-order invariance (1,000 cases)', () => {
  let state = 13;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 1000; i++) {
    const previous = Array.from({ length: 5 }, () => Math.exp(random() * 20 - 10));
    const current = previous.map(value => value * Math.exp(random() * 6 - 3));
    const effects = conserved(previous, current);
    const reordered = decompose(previous.toReversed(), current.toReversed()).toReversed();
    effects.forEach((effect, index) => close(effect, reordered[index], Math.max(1, Math.abs(effect))));
  }
});

test('near-equal products, extreme ratios, and intermediate overflow stay finite', () => {
  const effects = conserved([1000, 0.5, 0.3, 0.8, 20], [1000 + 1e-9, 0.5, 0.3, 0.8, 20]);
  assert.ok(effects[0] > 0);
  const extreme = decompose([1e-250, 1e250], [1e250, 1e-250]);
  close(extreme[0], 500 * Math.log(10));
  close(extreme[1], -500 * Math.log(10));
  const overflow = decompose([1e200, 1e200, 1e-200], [1e200, 1e200, 2e-200]);
  assert.ok(overflow.every(Number.isFinite));
  close(overflow[2], 1e200, 1e200);
});

test('rejects negative, missing, nonfinite factors and unrepresentable products', () => {
  for (const value of [-1, NaN, Infinity, -Infinity, undefined, null, '2']) {
    assert.throws(() => lmdiDriverEffects({ x: value }, { x: 1 }, ['x']), /finite and nonnegative/);
    assert.throws(() => lmdiDriverEffects({ x: 1 }, { x: value }, ['x']), /finite and nonnegative/);
  }
  assert.throws(() => lmdiDriverEffects({}, {}, []), /distinct, nonempty/);
  assert.throws(() => lmdiDriverEffects({ x: 1 }, { x: 2 }, ['x', 'x']), /distinct, nonempty/);
  assert.throws(() => decompose([1e308, 1e308], [1, 1]), /product/);
  assert.throws(() => decompose([1e-300, 1e-300], [1, 1]), /product/);
  // Invalid factors must not be hidden by an earlier zero.
  assert.throws(() => decompose([0, -1], [0, 1]), /finite and nonnegative/);
});

test('actual renewalDriverEffects implementation delegates to the same LMDI kernel', async () => {
  // Execute the actual worker wrapper without loading DB/report/network dependencies.
  const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && node.name?.text === 'renewalDriverEffects') ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(d =>
      ts.isIdentifier(d.name) && d.name.text === 'RENEWAL_DRIVER_DEFINITIONS')),
  );
  assert.equal(declarations.length, 2);
  const js = ts.transpileModule(declarations.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const renewal = new Function('lmdiDriverEffects', `${js}\nreturn renewalDriverEffects;`)(lmdiDriverEffects);
  const previous = { expireUserCnt: 100, renewalRate: 0.5, renewalAov: 20 };
  const current = { expireUserCnt: 80, renewalRate: 0.6, renewalAov: 25 };
  const keys = Object.keys(previous);
  assert.deepEqual(renewal(previous, current), lmdiDriverEffects(previous, current, keys));
  close(Object.values(renewal(previous, current)).reduce((sum, value) => sum + value, 0), 200);
  assert.deepEqual(renewal({ expireUserCnt: 100, renewalRate: 0, renewalAov: 0 }, current), {
    expireUserCnt: 0, renewalRate: 600, renewalAov: 600,
  });
  assert.throws(() => renewal(previous, { ...current, renewalRate: -1 }), /finite and nonnegative/);
});
