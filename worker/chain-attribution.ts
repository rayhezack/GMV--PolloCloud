// Same full-permutation decomposition as the original Miaoda report service.
// Input UV is a daily average; rates and AOV are ratios of period totals.
export const CHAIN_FACTOR_KEYS = ['activeUv', 'subExposeRate', 'subSubmitRate', 'chainPaySuccessRate', 'chainArppu'] as const;
export type ChainFactors = Record<typeof CHAIN_FACTOR_KEYS[number], number>;
function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  return values.flatMap((key, i) => permutations(values.filter((_, j) => j !== i)).map(rest => [key, ...rest]));
}
const orders = permutations([...CHAIN_FACTOR_KEYS]);
export function chainDriverEffects(previous: ChainFactors, current: ChainFactors): ChainFactors {
  const effects = Object.fromEntries(CHAIN_FACTOR_KEYS.map(key => [key, 0])) as ChainFactors;
  const product = (state: ChainFactors) => CHAIN_FACTOR_KEYS.reduce((value, key) => value * state[key], 1);
  for (const order of orders) {
    const state = { ...previous };
    for (const key of order) {
      const before = product(state);
      state[key] = current[key];
      effects[key] += product(state) - before;
    }
  }
  CHAIN_FACTOR_KEYS.forEach(key => { effects[key] /= orders.length; });
  return effects;
}
