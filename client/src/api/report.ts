import { apiRequest } from '@/lib/pollocloud';
import { STATIC_DEMO_MODE } from '@/lib/demo-data';
import type {
  Platform,
  ReportGenerationRequest,
  ReportGenerationStatus,
  ReportHistoryItem,
  ReportSummary,
} from '@shared/api.interface';

export async function generateReport(
  req: ReportGenerationRequest,
): Promise<ReportGenerationStatus> {
  if (STATIC_DEMO_MODE) throw new Error('示例数据模式不支持生成报告');
  const response = await apiRequest<ReportGenerationStatus>('/api/report-generations', {
    method: 'POST',
    body: JSON.stringify(req),
  });
  return response.data as ReportGenerationStatus;
}

export async function getLatestReport(
  platform?: Platform,
): Promise<ReportSummary | null> {
  if (STATIC_DEMO_MODE) return null;
  const query = platform ? `?platform=${platform}` : '';
  const response = await apiRequest<ReportSummary | null>(`/api/report-latest${query}`);
  return (response.data ?? null) as ReportSummary | null;
}

export async function getLatestReportGeneration(
  platform?: Platform,
): Promise<ReportGenerationStatus | null> {
  if (STATIC_DEMO_MODE) return null;
  const query = platform ? `?platform=${platform}` : '';
  const response = await apiRequest<ReportGenerationStatus | null>(`/api/report-generations/latest${query}`);
  return (response.data ?? null) as ReportGenerationStatus | null;
}

export async function listReportHistory(
  platform?: Platform,
): Promise<ReportHistoryItem[]> {
  if (STATIC_DEMO_MODE) return [];
  const query = platform ? `?platform=${platform}` : '';
  const response = await apiRequest<ReportHistoryItem[]>(`/api/report-history${query}`);
  return (response.data ?? []) as ReportHistoryItem[];
}

export async function getReportHistory(params: {
  platform: Platform;
  periodStart: string;
  periodEnd: string;
}): Promise<ReportSummary | null> {
  if (STATIC_DEMO_MODE) return null;
  const query = new URLSearchParams({
    platform: params.platform,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
  });
  const response = await apiRequest<ReportSummary | null>(`/api/report-history/detail?${query.toString()}`);
  return (response.data ?? null) as ReportSummary | null;
}
