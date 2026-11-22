import { count } from '@shared/format';
import type { CreativeChainTrendPoint } from '@shared/api.interface';
const creativeNumber = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const creativeCompact = count;
const creativePct = (n: number) => `${(n * 100).toFixed(2)}%`;
const creativeRatio = (n: number | null | undefined, d: number | null | undefined) =>
  n != null && d != null && d > 0 ? n / d : null;
const creativeWeekBefore = (period: string) => new Date(Date.parse(period) - 7 * 86400000).toISOString().slice(0, 10);
export const creativeAtomicKeys = [
  'creationUserCnt',
  'creationTaskCnt',
  'validCreationTaskCnt',
  'successTaskCnt',
  'successOutputCnt',
  'adoptedTaskCnt',
  'adoptedOutputCnt',
  'd3CreationUserCnt',
  'd7CreationUserCnt',
  'd30CreationUserCnt',
] as const;
type CreativeAtomicKey = (typeof creativeAtomicKeys)[number];
type CreativeRateKey =
  | 'creationPenetrationRate'
  | 'avgCreationTaskCntPerCreator'
  | 'requestRate'
  | 'successRate'
  | 'adoptionRate'
  | 'd3Rate'
  | 'd7Rate'
  | 'd30Rate';
type CreativeInput = {
  period: CreativeChainTrendPoint['period'];
  activity?: { activeUv: number | null; creationUv: number | null; creationTaskCnt: number | null } | null;
} & Partial<Record<CreativeAtomicKey, number | null>>;
export type CreativePoint = { period: string } & Record<CreativeAtomicKey | CreativeRateKey, number | null>;
export type CreativeMetric = {
  key: Exclude<keyof CreativePoint, 'period'>;
  label: string;
  format: (n: number) => string;
  formula?: string;
};
export const creativeMetrics: CreativeMetric[] = [
  {
    key: 'creationPenetrationRate',
    label: '创作渗透率',
    format: creativePct,
    formula: '活跃人群中的创作 UV / 活跃 UV；分子与分母来自同一日、同一活跃人群。',
  },
  {
    key: 'avgCreationTaskCntPerCreator',
    label: '人均创作任务数',
    format: creativeNumber,
    formula: '活跃人群的创作任务数 / 活跃 UV；按活跃用户计算，与诊断报告一致。',
  },
  {
    key: 'creationUserCnt',
    label: '创作用户',
    format: creativeCompact,
    formula: '整体按用户去重；同一用户可使用多个功能，功能行的人数不可相加为整体人数。',
  },
  { key: 'creationTaskCnt', label: '创作任务', format: creativeCompact },
  { key: 'validCreationTaskCnt', label: '已请求任务', format: creativeCompact },
  {
    key: 'requestRate',
    label: '请求率',
    format: creativePct,
    formula: '已请求任务数 / 创作任务数；已请求任务指已提交模型请求的创作任务。',
  },
  { key: 'successRate', label: '任务成功率', format: creativePct, formula: '成功任务数 / 创作任务数' },
  { key: 'adoptionRate', label: '任务采纳率', format: creativePct, formula: '采纳任务数 / 成功任务数' },
  ...([3, 7, 30] as const).map((horizon) => ({
    key: `d${horizon}Rate` as const,
    label: `D${horizon} 创作留存率`,
    format: creativePct,
    formula: `D${horizon} 留存用户数 / 对应创作日用户数；仅统计截至数据观测日已满 ${horizon} 天且留存数据完整的创作日。周值为留存用户合计 / 对应创作用户合计。`,
  })),
  ...([3, 7, 30] as const).map((horizon) => ({
    key: `d${horizon}CreationUserCnt` as const,
    label: `D${horizon} 留存用户`,
    format: creativeCompact,
    formula: '整体按用户去重；同一用户可使用多个功能，功能行的留存人数不可相加为整体人数。',
  })),
];
export function withRates(p: CreativeInput, asOf: string): CreativePoint {
  const values = Object.fromEntries(creativeAtomicKeys.map((key) => [key, p[key] ?? null])) as Record<
    CreativeAtomicKey,
    number | null
  >;
  const age = (Date.parse(asOf) - Date.parse(p.period)) / 86400000;
  for (const horizon of [3, 7, 30] as const) if (!(age >= horizon)) values[`d${horizon}CreationUserCnt`] = null;
  return {
    ...values,
    period: p.period,
    creationPenetrationRate: creativeRatio(p.activity?.creationUv, p.activity?.activeUv),
    avgCreationTaskCntPerCreator: creativeRatio(p.activity?.creationTaskCnt, p.activity?.activeUv),
    requestRate: creativeRatio(values.validCreationTaskCnt, values.creationTaskCnt),
    successRate: creativeRatio(values.successTaskCnt, values.creationTaskCnt),
    adoptionRate: creativeRatio(values.adoptedTaskCnt, values.successTaskCnt),
    d3Rate: creativeRatio(values.d3CreationUserCnt, values.creationUserCnt),
    d7Rate: creativeRatio(values.d7CreationUserCnt, values.creationUserCnt),
    d30Rate: creativeRatio(values.d30CreationUserCnt, values.creationUserCnt),
  };
}
export function combine(points: CreativeInput[], period: string, asOf: string): CreativePoint {
  const values = Object.fromEntries(
    creativeAtomicKeys.map((key) => [
      key,
      points.length && points.every((p) => p[key] != null) ? points.reduce((sum, p) => sum + p[key]!, 0) : null,
    ]),
  );
  return withRates({ ...values, period }, asOf);
}
export function creativeWeeklyPoint(
  points: CreativeInput[],
  period: string,
  asOf: string,
  days: number,
): CreativePoint {
  // Combine each date first so a missing segment cannot become a partial retention numerator.
  const daily = [...new Set(points.map((p) => p.period))].map((day) =>
    combine(
      points.filter((p) => p.period === day),
      day,
      asOf,
    ),
  );
  const result = combine(daily, period, asOf);
  for (const key of creativeAtomicKeys) if (result[key] != null) result[key] = days > 0 ? result[key]! / days : null;
  for (const horizon of [3, 7, 30] as const) {
    const key = `d${horizon}CreationUserCnt` as const,
      rateKey = `d${horizon}Rate` as const;
    const eligible = daily.filter((p) => p[key] != null && p.creationUserCnt != null);
    const retained = eligible.reduce((sum, p) => sum + p[key]!, 0),
      creators = eligible.reduce((sum, p) => sum + p.creationUserCnt!, 0);
    result[key] = eligible.length ? retained / eligible.length : null;
    result[rateKey] = creativeRatio(eligible.length ? retained : null, creators);
  }
  return result;
}
