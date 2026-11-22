/** Stable entity assignment; never select a color by rank. */
export const ENTITY_SERIES: Readonly<Record<string, number>> = {
  积分包: 1,
  自动续订: 3,
  首订: 4,
  套餐升级: 5,
  重置订阅周期: 2,
  重新订阅: 6,
  API: 2,
  套餐降级: 6,
  其他: 6,
  multi2video: 1,
  ref2video: 3,
  Agent: 4,
  multi2image: 5,
  ImageToVideo: 2,
};
export const entityColor = (key: string) => {
  // Unknown entities are neutral. Other model/supplier names keep a stable hue
  // across rank changes and filtering, even if not in the named product map.
  const neutral = /^(未知|未归因|其他|unknown|not_attributed)/i.test(key);
  const hash = Array.from(key).reduce((value, letter) => (value * 31 + letter.codePointAt(0)!) >>> 0, 0);
  return `var(--series-${ENTITY_SERIES[key] ?? (neutral ? 6 : (hash % 5) + 1)})`;
};
