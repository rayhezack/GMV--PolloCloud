import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { getDemoAttributions, getDemoCoverage, getDemoOverview, STATIC_DEMO_MODE } from '@/lib/demo-data';
import type {
  AppDeviceType,
  AttributionDimension,
  DashboardPlatform,
  DashboardAttributionsResponse,
  DashboardGmvCoverageResponse,
  DashboardOverviewResponse,
  Granularity,
  PaymentChainType,
  Platform,
  RenewalPlanTier,
  WorkbookPreviewResponse,
  WorkbookSheet,
} from '@shared/api.interface';

function buildQueryString(
  params: Record<string, string | number | undefined>,
): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export async function getGmvCoverage(): Promise<DashboardGmvCoverageResponse> {
  if (STATIC_DEMO_MODE) return getDemoCoverage();
  const response = await axiosForBackend({
    url: '/api/dashboard/gmv-coverage',
    method: 'GET',
  });
  return response.data as DashboardGmvCoverageResponse;
}

export async function getDashboardOverview(params: {
  platform: DashboardPlatform;
  deviceType?: AppDeviceType;
  granularity: Granularity;
  startDate: string;
  endDate: string;
  metricDate?: string;
  trendUserTag?: string;
  planTier?: RenewalPlanTier;
}): Promise<DashboardOverviewResponse> {
  if (STATIC_DEMO_MODE) return getDemoOverview(params.platform, params.startDate, params.endDate, params.granularity, params.trendUserTag, params.planTier);
  const response = await axiosForBackend({
    url: `/api/dashboard/overview${buildQueryString(params)}`,
    method: 'GET',
  });
  return response.data as DashboardOverviewResponse;
}

export async function getDashboardAttributions(params: {
  platform: DashboardPlatform;
  deviceType?: AppDeviceType;
  granularity: Granularity;
  dimension: AttributionDimension;
  startDate: string;
  endDate: string;
  baselinePeriod?: string;
  analysisPeriod?: string;
  creationTier?: string;
  userTag?: string;
  chainPath?: 'tier_to_chain' | 'tier_to_user_to_chain';
  chainType?: PaymentChainType;
  planTier?: RenewalPlanTier;
}): Promise<DashboardAttributionsResponse> {
  if (STATIC_DEMO_MODE) {
    return getDemoAttributions(params.dimension, params.platform, {
      creationTier: params.creationTier,
      userTag: params.userTag,
      chainType: params.chainType,
      planTier: params.planTier,
    });
  }
  const response = await axiosForBackend({
    url: `/api/dashboard/attributions${buildQueryString(params)}`,
    method: 'GET',
  });
  return response.data as DashboardAttributionsResponse;
}

export async function getWorkbookPreview(params: {
  sheet: WorkbookSheet;
  platform?: Platform;
  offset?: number;
  pageSize?: number;
}): Promise<WorkbookPreviewResponse> {
  if (STATIC_DEMO_MODE) {
    return { sheet: params.sheet, fields: [], items: [], total: 0, hasMore: false };
  }
  const response = await axiosForBackend({
    url: `/api/workbook-preview${buildQueryString({
      sheet: params.sheet,
      platform: params.platform,
      offset: params.offset ?? 0,
      pageSize: params.pageSize ?? 50,
    })}`,
    method: 'GET',
  });
  return response.data as WorkbookPreviewResponse;
}
