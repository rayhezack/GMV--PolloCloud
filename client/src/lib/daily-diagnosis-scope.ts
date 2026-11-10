import type { DashboardGmvAnomalyResponse, DashboardPlatform, DailyDiagnosisStatus } from '@shared/api.interface';

const order: DashboardPlatform[] = ['all', 'web', 'app'];

export function dailyDiagnosisScopes(alerts: DashboardGmvAnomalyResponse['alerts'], period: string): DashboardPlatform[] {
  const triggered = alerts.filter(alert => alert.period === period && alert.metric === 'totalGmv');
  return triggered.length ? order.filter(scope => scope === 'all' || triggered.some(alert => alert.platform === scope)) : [];
}

export function completedDailyDiagnosisScopes(scopes: DashboardPlatform[], statuses: Partial<Record<DashboardPlatform, DailyDiagnosisStatus>>, period: string): DashboardPlatform[] {
  return scopes.filter(scope => statuses[scope]?.period === period && statuses[scope]?.status === 'success' && statuses[scope]?.report?.periodEnd === period);
}
