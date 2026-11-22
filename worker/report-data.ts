import type { buildReportEvidence } from './report-evidence';

type Evidence = ReturnType<typeof buildReportEvidence>;

/** Data readiness only. No metric selection, analytic routing, prose or output contract. */
export function prepareReportData<T>(value: T): T {
  const data = value as unknown as { schemaVersion: number; mode?: string; platformEvidence?: Array<{ evidence: Evidence }>; checks: Evidence['checks'] };
  if (!data || ![2, 3].includes(data.schemaVersion) || !Array.isArray(data.checks)) {
    throw new Error('报告缺少新版数据与测算结果');
  }
  if (data.schemaVersion === 3) {
    if (data.mode !== 'day' || !data.platformEvidence?.length) throw new Error('日诊断缺少实际分端证据');
    for (const item of data.platformEvidence) prepareReportData(item.evidence);
  }
  const failures = data.checks.filter(check => !check.passed && (
    /^(?:(?:web|app)\.)?(?:revenue|lifecycle|creationTier)\./.test(check.id) || check.id === 'trigger.source' || check.id.endsWith('.lmdi')
  ));
  if (failures.length) throw new Error('核心收入或金额分解未守恒，不能使用本次数据生成报告');
  // Preserve every prepared group, function, ad country and source record.
  return value;
}
