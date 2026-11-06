// Input UV is a daily average; rates and AOV are ratios of period totals.
export const CHAIN_FACTOR_KEYS = ['activeUv', 'subExposeRate', 'subSubmitRate', 'chainPaySuccessRate', 'chainArppu'] as const;
export type ChainFactors = Record<typeof CHAIN_FACTOR_KEYS[number], number>;

// log(a / b) without overflowing the ratio or cancelling nearly equal logs.
function logRatio(a: number, b: number): number {
  const relativeChange = (a - b) / b;
  return Math.abs(relativeChange) < 0.5 ? Math.log1p(relativeChange) : Math.log(a) - Math.log(b);
}

/** Additive LMDI for Y = product(factors): effect_i = L(Y1, Y0) * log(x1_i / x0_i).
 * Zero convention: replace every zero with the same epsilon and take epsilon -> 0+.
 * With one zero-total period, only its zero factors receive the delta, equally.
 * With two zero-total periods every effect tends to zero, even if zero factors differ.
 * These are accounting effects under that limit convention, not causal estimates.
 */
export function lmdiDriverEffects<K extends string>(
  previous: Record<K, number>, current: Record<K, number>, keys: readonly K[],
): Record<K, number> {
  if (!keys.length || new Set(keys).size !== keys.length) {
    throw new RangeError('LMDI requires distinct, nonempty factor keys');
  }
  for (const key of keys) {
    for (const value of [previous[key], current[key]]) {
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`LMDI factor ${key} must be finite and nonnegative`);
      }
    }
  }
  const effects = Object.fromEntries(keys.map(key => [key, 0])) as Record<K, number>;
  const previousZeros = keys.filter(key => previous[key] === 0);
  const currentZeros = keys.filter(key => current[key] === 0);
  const product = (factors: Record<K, number>, zeros: readonly K[]) => {
    if (zeros.length) return 0;
    let value = keys.reduce((total, key) => total * factors[key], 1);
    // Recover when only the intermediate products overflow/underflow.
    if (!Number.isFinite(value) || value === 0) {
      value = Math.exp(keys.reduce((total, key) => total + Math.log(factors[key]), 0));
    }
    if (!Number.isFinite(value) || value === 0) {
      throw new RangeError('LMDI positive product is outside the finite positive number range');
    }
    return value;
  };
  const y0 = product(previous, previousZeros), y1 = product(current, currentZeros);
  if (previousZeros.length || currentZeros.length) {
    if (previousZeros.length && currentZeros.length) return effects;
    const zeros = previousZeros.length ? previousZeros : currentZeros;
    zeros.forEach(key => { effects[key] = (y1 - y0) / zeros.length; });
    return effects;
  }
  // L(y, y) = y, including unchanged totals with offsetting factor changes.
  const mean = y1 === y0 ? y0 : (y1 - y0) / logRatio(y1, y0);
  for (const key of keys) {
    effects[key] = mean * logRatio(current[key], previous[key]);
    if (!Number.isFinite(effects[key])) throw new RangeError(`LMDI effect ${key} is not finite`);
  }
  return effects;
}

export function chainDriverEffects(previous: ChainFactors, current: ChainFactors): ChainFactors {
  return lmdiDriverEffects(previous, current, CHAIN_FACTOR_KEYS);
}
