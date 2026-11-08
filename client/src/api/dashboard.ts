import type { ProductActionSource } from '@shared/product-actions';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { createRequestCache } from './request-cache';
import { getDemoAttributions, getDemoCoverage, getDemoOverview, STATIC_DEMO_MODE } from '@/lib/demo-data';
import type {
  AppDeviceType,
  AttributionDimension,
  DashboardPlatform,
  DashboardAttributionsResponse,
  DashboardGmvCoverageResponse,
  DashboardGmvAnomalyResponse,
  DashboardOverviewResponse,
  ChainFunnelResponse,
  AdsOverviewResponse,
  CreativeOverviewResponse,
  Granularity,
  GmvAttributionType,
  PaymentAnalysisResponse,
  PaymentTrendResponse,
  PaymentChainType,
  Platform,
  RenewalPlanTier,
  WorkbookPreviewResponse,
  WorkbookSheet,
} from '@shared/api.interface';

const dashboardReads = createRequestCache();
export function invalidateDashboardCache() { dashboardReads.clear(); }

function readDashboard<T>(url: string): Promise<{ data: T }> {
  const [path, query] = url.split('?');
  const params = new URLSearchParams(query);
  params.sort();
  const key = `${path}?${params}`;
  return dashboardReads.read(key, () => axiosForBackend({ url, method: 'GET' }));
}

export async function getAdsOverview(params: {
  platform: DashboardPlatform;
  deviceType?: AppDeviceType;
  startDate: string;
  endDate: string;
  baselinePeriod: string;
  analysisPeriod: string;
  country?: string;
  cacheBust?: number;
}): Promise<AdsOverviewResponse> {
  const response = await readDashboard<AdsOverviewResponse>(`/api/dashboard/ads-overview${buildQueryString(params)}`);
  return response.data as AdsOverviewResponse;
}

export async function getCreativeOverview(params: {
  platform: DashboardPlatform;
  startDate: string;
  endDate: string;
  baselinePeriod: string;
  analysisPeriod: string;
  cacheBust?: number;
}): Promise<CreativeOverviewResponse> {
  const response = await readDashboard<CreativeOverviewResponse>(`/api/dashboard/creative-overview${buildQueryString(params)}`);
  return response.data as CreativeOverviewResponse;
}

export async function getChainFunnel(params: {
  platform: DashboardPlatform;
  deviceType?: AppDeviceType;
  startDate: string;
  endDate: string;
  baselinePeriod: string;
  analysisPeriod: string;
  creationTier?: string;
  userLifecycle?: string;
  cacheBust?: number;
}): Promise<ChainFunnelResponse> {
  const response = await readDashboard<ChainFunnelResponse>(`/api/dashboard/chain-funnel${buildQueryString(params)}`);
  return response.data as ChainFunnelResponse;
}

export async function getPaymentTrend(params: {platform:DashboardPlatform;deviceType?:AppDeviceType;analysisPeriod:string;attributionType:GmvAttributionType;granularity:'day'|'week'|'month';income:string;groupBy?:string;startDate?:string;endDate?:string;cacheBust?:number}):Promise<PaymentTrendResponse> {
  const response=await readDashboard<PaymentTrendResponse>(`/api/dashboard/payment-trend${buildQueryString(params)}`);
  return response.data;
}

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

export async function getPaymentAnalysis(params: {
  platform: DashboardPlatform;
  deviceType?: AppDeviceType;
  baselinePeriod: string;
  analysisPeriod: string;
  attributionType: GmvAttributionType;
  cacheBust?: number;
}): Promise<PaymentAnalysisResponse> {
  const response = await readDashboard<PaymentAnalysisResponse>(`/api/dashboard/payment-analysis${buildQueryString(params)}`);
  return response.data as PaymentAnalysisResponse;
}

export async function getGmvCoverage(): Promise<DashboardGmvCoverageResponse> {
  if (STATIC_DEMO_MODE) return getDemoCoverage();
  const response = await readDashboard('/api/dashboard/gmv-coverage');
  return response.data as DashboardGmvCoverageResponse;
}

export async function getGmvAnomalies(): Promise<DashboardGmvAnomalyResponse> {
  if (STATIC_DEMO_MODE) return { latestWeek: '', latestDay: '', method: 'daily_and_weekly_rolling_p95_p05_min_10pct', alerts: [] };
  const response = await readDashboard('/api/dashboard/gmv-anomalies');
  return response.data as DashboardGmvAnomalyResponse;
}

export async function getDashboardOverview(params: {
  platform: DashboardPlatform;
  deviceType?: AppDeviceType;
  granularity: Granularity;
  startDate: string;
  endDate: string;
  metricDate?: string;
  trendUserTag?: string;
  trendCountryTier?: string;
  planTier?: RenewalPlanTier;
  cacheBust?: number;
}): Promise<DashboardOverviewResponse> {
  if (STATIC_DEMO_MODE) return getDemoOverview(params.platform, params.startDate, params.endDate, params.granularity, params.trendUserTag, params.planTier);
  const response = await readDashboard(`/api/dashboard/overview${buildQueryString(params)}`);
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
  cacheBust?: number;
}): Promise<DashboardAttributionsResponse> {
  if (STATIC_DEMO_MODE) {
    return getDemoAttributions(params.dimension, params.platform, {
      creationTier: params.creationTier,
      userTag: params.userTag,
      chainType: params.chainType,
      planTier: params.planTier,
    });
  }
  const response = await readDashboard(`/api/dashboard/attributions${buildQueryString(params)}`);
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

export async function getProductActions(): Promise<ProductActionSource> {
  return (await readDashboard<ProductActionSource>('/api/dashboard/product-actions')).data;
}
