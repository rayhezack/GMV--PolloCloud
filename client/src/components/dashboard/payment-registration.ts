import type { PaymentAnalysisResponse } from '../../../../shared/api.interface';

export function registrationBreakdown(data: PaymentAnalysisResponse, payType: string, dimension: 'userLifecycle' | 'regCountry') {
  if (!data.comparison || !data.registration?.verifiedPayTypes.includes(payType)) return null;
  const { analysisPeriod, baselinePeriod } = data.comparison;
  const offsets = (week: string) => new Set(data.revenues.filter(row => row.weekStart === week).map(row => Date.parse(row.period) - Date.parse(week)));
  const analysisOffsets = offsets(analysisPeriod), baselineOffsets = offsets(baselinePeriod);
  const matched = new Set([...analysisOffsets].filter(offset => baselineOffsets.has(offset)));
  if (!matched.size) return null;
  const groups = new Map<string, { key: string; baseline: number; analysis: number }>();
  for (const row of data.registration.rows) {
    if (row.payType !== payType || ![analysisPeriod, baselinePeriod].includes(row.weekStart) || !matched.has(Date.parse(row.period) - Date.parse(row.weekStart))) continue;
    const key = dimension === 'userLifecycle' ? ({NEW:'新用户',OLD:'老用户'}[row.userLifecycle] ?? '未知') : row.regCountry || '未知';
    const group = groups.get(key) ?? { key, baseline:0, analysis:0 };
    group[row.weekStart === analysisPeriod ? 'analysis' : 'baseline'] += row.gmvUsd / matched.size;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a,b) => b.analysis-a.analysis || a.key.localeCompare(b.key));
}
