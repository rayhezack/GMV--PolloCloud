import { apiRequest } from '@/lib/pollocloud';
import type { DailyDiagnosisStatus, DashboardPlatform } from '@shared/api.interface';
export async function getDailyDiagnosis(platform: DashboardPlatform, period?: string) {
  const params = new URLSearchParams({platform});
  if (period) params.set('period',period);
  return (await apiRequest<DailyDiagnosisStatus>(`/api/daily-diagnosis?${params}`)).data as DailyDiagnosisStatus;
}
export async function regenerateDailyDiagnosis(platform: DashboardPlatform, period: string) {
  return (await apiRequest<DailyDiagnosisStatus>(`/api/daily-diagnosis?${new URLSearchParams({platform,period})}`,{method:'POST'})).data as DailyDiagnosisStatus;
}
