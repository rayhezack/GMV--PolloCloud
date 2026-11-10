import { apiRequest } from '@/lib/pollocloud';
import type { DailyDiagnosisStatus, DashboardPlatform } from '@shared/api.interface';

const pending = new Map<string, Promise<DailyDiagnosisStatus>>();
export function getDailyDiagnosis(platform: DashboardPlatform, period?: string) {
  const params = new URLSearchParams({ platform });
  if (period) params.set('period', period);
  const url = `/api/daily-diagnosis?${params}`;
  const existing = pending.get(url);
  if (existing) return existing;
  const request = apiRequest<DailyDiagnosisStatus>(url).then(({ data }) => {
    if (!data || typeof data !== 'object' || !['waiting','queued','running','success','failed','clear','normal'].includes(data.status)) throw new Error('日报服务暂不可用');
    return data;
  }).finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}

export async function regenerateDailyDiagnosis(platform: DashboardPlatform, period: string) {
  return (await apiRequest<DailyDiagnosisStatus>(`/api/daily-diagnosis?${new URLSearchParams({ platform, period })}`, { method: 'POST' })).data;
}
