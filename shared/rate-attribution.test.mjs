import test from 'node:test';
import assert from 'node:assert/strict';
import { decomposeRate } from './rate-attribution.ts';

const atoms = (numerator, denominator) => ({ numerator, denominator });
const group = (key, n0, d0, n1, d1) => ({
  key,
  label: key,
  baseline: atoms(n0, d0),
  current: atoms(n1, d1),
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('independent payment/submission UV above 100% remains a defined rate and closes in two factors', () => {
  // Warehouse Web NEW users, 2026-11-13 → 2026-11-20; each UV is independently counted.
  const rows = [
    group('payinsider', 57, 440, 70, 408),
    group('stripe', 139, 1062, 203, 1415),
    group('unknown', 0, 2, 4, 3),
  ];
  const parent = { baseline: atoms(196, 1504), current: atoms(277, 1826) };
  for (const options of [{}, { separateUnresolved: true }]) {
    const result = decomposeRate(rows, parent, options);
    assert.equal(result.valid, true);
    close(result.groups[2].rate1, 4 / 3);
    close(result.structure * 100, -0.07591448976237247);
    close(result.efficiency * 100, 2.2137695851924497);
    close(result.structure + result.efficiency, 277 / 1826 - 196 / 1504);
    assert.equal(result.unresolved, 0);
  }
});

test('a parent independent-count ratio can exceed one without clipping or replacing counts', () => {
  const result = decomposeRate([group('a', 3, 2, 8, 4), group('b', 2, 3, 4, 2)], {
    baseline: atoms(5, 5),
    current: atoms(12, 6),
  });
  assert.equal(result.valid, true);
  assert.equal(result.currentRate, 2);
  close(result.structure + result.efficiency, 1);
});

test('real zero submission denominators retain undefined rates and explicit unresolved contribution', () => {
  const rows = [group('apple', 212, 308, 206, 308), group('web', 10, 21, 4, 11), group('unknown', 2, 0, 5, 0)];
  const parent = { baseline: atoms(224, 329), current: atoms(215, 319) };
  assert.equal(decomposeRate(rows, parent).valid, false);
  const result = decomposeRate(rows, parent, { separateUnresolved: true });
  assert.equal(result.valid, true);
  assert.equal(result.groups[2].rate0, null);
  assert.equal(result.groups[2].rate1, null);
  assert.equal(result.groups[2].structure, 0);
  assert.equal(result.groups[2].efficiency, 0);
  close(result.unresolved * 100, 0.9594953835599468);
  close(result.structure + result.efficiency + result.unresolved, 215 / 319 - 224 / 329);
});

test('empty entering/exiting groups do not get invented rates; invalid atoms and partitions remain blocked', () => {
  const entering = decomposeRate(
    [group('a', 5, 10, 6, 10), group('new', 0, 0, 2, 5)],
    {
      baseline: atoms(5, 10),
      current: atoms(8, 15),
    },
    { separateUnresolved: true },
  );
  assert.equal(entering.valid, true);
  assert.equal(entering.groups[1].rate0, null);
  close(entering.structure + entering.efficiency + entering.unresolved, 8 / 15 - 5 / 10);
  for (const value of [-1, NaN, Infinity]) {
    assert.equal(
      decomposeRate(
        [group('a', value, 10, 2, 10)],
        {
          baseline: atoms(value, 10),
          current: atoms(2, 10),
        },
        { separateUnresolved: true },
      ).valid,
      false,
    );
  }
  assert.equal(
    decomposeRate([group('a', 5, 10, 6, 10)], {
      baseline: atoms(5, 10),
      current: atoms(7, 10),
    }).valid,
    false,
  );
  assert.equal(
    decomposeRate(
      [group('a', 0, 0, 6, 10)],
      {
        baseline: atoms(0, 0),
        current: atoms(6, 10),
      },
      { separateUnresolved: true },
    ).valid,
    false,
  );
});
