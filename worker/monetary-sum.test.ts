import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sumMicroDollars } from './monetary-sum.ts';

test('money total is independent of drilldown grouping order at half a cent', () => {
  const countries = [[9469.17, 0.004], [0.001]];
  const total = sumMicroDollars(countries.flat());
  const byCountry = sumMicroDollars(countries.map(sumMicroDollars));
  assert.equal(total, 9469.175);
  assert.equal(byCountry, total);
  assert.equal(Math.round(total * 100), Math.round(byCountry * 100));
});
