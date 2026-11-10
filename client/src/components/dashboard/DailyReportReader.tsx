import { ReportInsightArticle } from '@/pages/ReportPage/ReportInsightRenderer';
import type { DailyDiagnosisReport } from '@shared/api.interface';

export default function DailyReportReader({ report, mode = 'day' }: { report: DailyDiagnosisReport; mode?: 'day' | 'week' }) {
  return <ReportInsightArticle report={report} mode={mode} />;
}
