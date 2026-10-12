import { apiRequest } from '@/lib/pollocloud';
import { getDemoSyncRun, STATIC_DEMO_MODE } from '@/lib/demo-data';
import type {
  LatestDaySyncPlan,
  LatestWeekSyncPlan,
  SyncRunRequest,
  SyncRunResponse,
  SyncRunStatus,
} from '@shared/api.interface';

export async function executeSyncRun(runId: string): Promise<void> {
  await apiRequest('/api/sync-runs/run', { method: 'POST', body: JSON.stringify({ runId }) });
}

export async function pauseSyncRun(runId: string): Promise<SyncRunStatus> {
  const response = await apiRequest<SyncRunStatus>('/api/sync-runs/pause', {
    method: 'POST', body: JSON.stringify({ runId }),
  });
  return response.data as SyncRunStatus;
}

export async function resumeSyncRun(runId: string): Promise<SyncRunStatus> {
  const response = await apiRequest<SyncRunStatus>('/api/sync-runs/resume', {
    method: 'POST', body: JSON.stringify({ runId }),
  });
  return response.data as SyncRunStatus;
}

export async function createSyncRun(
  req: SyncRunRequest,
): Promise<SyncRunResponse> {
  if (STATIC_DEMO_MODE) {
    return {
      runId: 'demo-sync',
      mode: req.mode ?? 'latest_day',
      startDate: '2026-10-09',
      endDate: '2026-10-09',
      platforms: req.platforms ?? ['all', 'web', 'app'],
      status: 'success',
      rowsSynced: 420,
      skipped: true,
      skipReason: '示例数据无需同步',
    };
  }
  const response = await apiRequest<SyncRunResponse>('/api/sync-runs', {
    method: 'POST',
    body: JSON.stringify(req),
  });
  return response.data as SyncRunResponse;
}

export async function retrySyncRun(runId: string): Promise<SyncRunStatus> {
  if (STATIC_DEMO_MODE) return getDemoSyncRun();
  const response = await apiRequest<SyncRunStatus>('/api/sync-runs/retry', {
    method: 'POST',
    body: JSON.stringify({ runId }),
  });
  return response.data as SyncRunStatus;
}

export async function getLatestSyncRun(): Promise<SyncRunStatus | null> {
  if (STATIC_DEMO_MODE) return getDemoSyncRun();
  const response = await apiRequest<SyncRunStatus | null>('/api/sync-runs/latest');
  return response.data as SyncRunStatus | null;
}

export async function getLatestWeekSyncPlan(): Promise<LatestWeekSyncPlan> {
  if (STATIC_DEMO_MODE) {
    return {
      mode: 'latest_week',
      startDate: '2026-10-03',
      endDate: '2026-10-09',
      platforms: ['all', 'web', 'app'],
      alreadySynced: true,
      canSync: false,
      running: false,
      missingItems: [],
    };
  }
  const response = await apiRequest<LatestWeekSyncPlan>('/api/sync-runs/latest-week-plan');
  return response.data as LatestWeekSyncPlan;
}

export async function getLatestDaySyncPlan(): Promise<LatestDaySyncPlan> {
  if (STATIC_DEMO_MODE) {
    return {
      mode: 'latest_day',
      startDate: '2026-10-09',
      endDate: '2026-10-09',
      latestStoredDate: '2026-10-09',
      platforms: ['all', 'web', 'app'],
      alreadySynced: true,
      canSync: false,
      running: false,
      missingItems: [],
    };
  }
  const response = await apiRequest<LatestDaySyncPlan>('/api/sync-runs/latest-day-plan');
  return response.data as LatestDaySyncPlan;
}
