/* 前后端共享的类型写在这里 */

export const PLATFORMS = ['web', 'app'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const DASHBOARD_PLATFORMS = ['all', ...PLATFORMS] as const;
export type DashboardPlatform = (typeof DASHBOARD_PLATFORMS)[number];

export const APP_DEVICE_TYPES = ['ios', 'android'] as const;
export type AppDeviceType = (typeof APP_DEVICE_TYPES)[number];

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const DATASET_KINDS = ['daily', 'weekly'] as const;
export type DatasetKind = (typeof DATASET_KINDS)[number];

export const SYNC_STAGES = ['pull', 'rollup', 'write'] as const;
export type SyncStage = (typeof SYNC_STAGES)[number];

export const WORKBOOK_SHEETS = [
  'run_log',
  'pay_type_daily',
  'pay_type_weekly',
  'chain_daily',
  'chain_weekly',
  'creative_daily',
  'creative_weekly',
  'renewal_daily',
  'latest_report',
  'report_history',
  'product_actions',
  'report_generation_jobs',
] as const;
export type WorkbookSheet = (typeof WORKBOOK_SHEETS)[number];

export const ATTRIBUTION_DIMENSIONS = [
  'pay_type',
  'chain',
  'creative',
] as const;
export type AttributionDimension = (typeof ATTRIBUTION_DIMENSIONS)[number];

export const GMV_ATTRIBUTION_TYPES = ['NONE', 'CREATION_MODE', 'MODEL', 'ACTUAL_MODEL'] as const;
export type GmvAttributionType = (typeof GMV_ATTRIBUTION_TYPES)[number];

export interface PaymentRevenuePoint {
  period: string;
  weekStart: string;
  attributionName: string;
  payCategory: 'ACTIVE_PAYMENT' | 'AUTO_RENEWAL' | 'API';
  payType: string;
  actualSupplier: string | null;
  actualProvider: string | null;
  gmvUsd: number;
}

export interface PaymentCostPoint {
  period: string;
  weekStart: string;
  attributionName: string;
  actualSupplier: string | null;
  actualProvider: string | null;
  modelCostUsd: number;
}

export interface PaymentAnalysisResponse {
  attributionType: GmvAttributionType;
  source: 'ads_v1' | 'legacy';
  availableAttributionTypes: GmvAttributionType[];
  comparison: AttributionComparisonWindow | null;
  revenues: PaymentRevenuePoint[];
  costs: PaymentCostPoint[];
  costAvailable: boolean;
  registration?: {
    rows: { period: string; weekStart: string; payType: string; userLifecycle: string; countryTier: string; regPlatform: string; sku: string; planTier: string; planCycle: string; creditAmount: string; previousSku: string; previousPlanTier: string; previousPlanCycle: string; previousCreditAmount: string; gmvUsd: number }[];
    verifiedPayTypes: string[];
  };
  registrationStatus?: 'available' | 'source_missing' | 'table_missing';
}

export interface PaymentRegistrationTrendResponse {
  startDate: string; endDate: string;
  points: { period: string; total: number | null; verified: boolean }[];
  rows: { period: string; userLifecycle: string; countryTier: string; regPlatform: string; sku: string; planTier: string; planCycle: string; creditAmount: string; previousSku: string; previousPlanTier: string; previousPlanCycle: string; previousCreditAmount: string; gmvUsd: number }[];
}

export const RENEWAL_PLAN_TIERS = ['LITE', 'PRO', 'ULTRA'] as const;
export type RenewalPlanTier = (typeof RENEWAL_PLAN_TIERS)[number];

export type PaymentChainType = 'active' | 'renewal';

export type ChainFunnelBreakdownType = 'EXPOSE_TYPE' | 'EXPOSE_REASON' | 'SUBMIT_CHANNEL' | 'PAYMENT_CHANNEL';

export interface ChainFunnelMetrics {
  activeUv: number;
  exposeUv: number;
  submitUv: number;
  payUv: number;
  gmvUsd: number;
  failOrders: number;
  failAmountUsd: number;
  exposeRate: number;
  submitRate: number;
  payRate: number;
  aov: number;
}

export interface ChainFunnelGroup {
  key: string;
  label: string;
  current: ChainFunnelMetrics;
  baseline: ChainFunnelMetrics;
  gmvChange: number;
  gmvContribution: number | null;
}

export interface ChainFunnelDriver {
  metricKey: 'activeUv' | 'exposeRate' | 'submitRate' | 'payRate' | 'aov';
  metric: string;
  current: number;
  baseline: number;
  change: number;
  wowChange: number | null;
  contribution: number | null;
}

export interface ChainFunnelResponse {
  comparisonDates?: { analysis: string[]; baseline: string[] };
  ready: boolean;
  source: 'pollo_da_chain_funnel' | 'legacy' | 'unavailable';
  comparison: AttributionComparisonWindow | null;
  totals: ChainFunnelGroup | null;
  drivers: ChainFunnelDriver[];
  tiers: ChainFunnelGroup[];
  lifecycles: ChainFunnelGroup[];
  countries: ChainFunnelGroup[];
  breakdowns: Record<ChainFunnelBreakdownType, ChainFunnelGroup[]>;
}

export interface AdsAggregate {
  costUsd: number;
  impressions: number;
  clicks: number;
  registerUsers: number;
  gmvD0: number;
  gmvD7: number | null;
  gmvD14: number;
  gmvD30: number;
  gmvD60: number;
  gmvD90: number;
  gmvD180: number;
  ctr: number;
  cpc: number;
  cpm: number;
  roasD30: number;
  roasByHorizon?: Record<"D0" | "D7" | "D30", number | null>;
}

export interface AdsTrendPoint {
  roasByHorizon?: Record<"D0" | "D7" | "D30", number | null>;
  period: string;
  costUsd: number;
  impressions: number;
  clicks: number;
  registerUsers: number;
  gmvD30: number;
  gmvD0: number;
  gmvD7: number | null;
}

export interface AdsChannelRow {
  key: string;
  label: string;
  current: AdsAggregate;
  baseline: AdsAggregate;
}

export interface AdsCohortMatrixRow {
  key: string;
  label: string;
  values: Array<{
    horizon: 'D0' | 'D14' | 'D30' | 'D60' | 'D90' | 'D180';
    value: number | null;
    gmvUsd: number;
    costUsd: number;
    registerUsers: number;
  }>;
}

export interface AdsCountryDetail {
  key: string;
  channels: Array<AdsChannelRow & { trend: AdsTrendPoint[] }>;
}

export interface AdsOverviewResponse {
  observedThrough?: string;
  comparisonDates?: { analysis: string[]; baseline: string[] };
  ready: boolean;
  source: 'pollo_da_ads_daily' | 'unavailable';
  comparison: AttributionComparisonWindow | null;
  totals: { current: AdsAggregate; baseline: AdsAggregate } | null;
  trend: AdsTrendPoint[];
  channels: AdsChannelRow[];
  countries: AdsChannelRow[];
  cohortMatrix: AdsCohortMatrixRow[];
  countryDetails?: AdsCountryDetail[];
}

export interface CreativeChainTrendPoint {
  period: string;
  validCreationTaskCnt: number | null;
  activity?: { activeUv: number; creationUv: number; creationTaskCnt: number };
  creationTaskCnt: number;
  creationUserCnt: number;
  successTaskCnt: number;
  successOutputCnt: number;
  adoptedTaskCnt: number;
  adoptedOutputCnt: number;
  d3CreationUserCnt: number | null;
  d7CreationUserCnt: number | null;
  d30CreationUserCnt: number | null;
  gmvUsd: number;
}

export interface CreativeFunctionRow {
  key: string;
  label: string;
  userType: string;
  payGmv30d: string;
  current: CreativeChainTrendPoint;
  baseline: CreativeChainTrendPoint;
  daily: CreativeChainTrendPoint[];
}

export interface CreativeOverviewResponse {
  observedThrough?: string;
  comparisonDates?: { analysis: string[]; baseline: string[] };
  ready: boolean;
  source: 'pollo_da_creation_chain' | 'unavailable';
  comparison: AttributionComparisonWindow | null;
  trend: CreativeChainTrendPoint[];
  functions: CreativeFunctionRow[];
}

/* ===== 同步链路 ===== */

export type SyncMode = 'latest_day' | 'latest_week' | 'full_refresh' | 'date_range';
export type SyncDataset = 'pay_type' | 'chain' | 'creative' | 'renewal';

export interface SyncRunRequest {
  mode?: SyncMode;
  startDate?: string;
  endDate?: string;
  platforms?: DashboardPlatform[];
  datasets?: SyncDataset[];
}

export interface SyncRunResponse {
  runId: string;
  mode?: SyncMode;
  startDate: string;
  endDate: string;
  platforms: DashboardPlatform[];
  status: 'queued' | 'running' | 'pausing' | 'paused' | 'success' | 'failed';
  rowsSynced: number;
  datasets?: SyncDataset[];
  skipped?: boolean;
  skipReason?: string;
  errorMessage?: string;
}

export interface SyncRunStatus {
  runId: string;
  currentDate?: string;
  mode?: SyncMode;
  status: 'queued' | 'running' | 'pausing' | 'paused' | 'success' | 'failed';
  stage: SyncStage;
  startDate: string;
  endDate: string;
  platforms: DashboardPlatform[];
  rowsSynced: number;
  datasets?: SyncDataset[];
  errorMessage?: string;
  startedAt: string;
  finishedAt?: string;
  heartbeatAt?: string;
  steps?: Array<{ key: string; label: string; status: 'waiting' | 'running' | 'success' | 'failed'; detail?: string }>;
  skipped?: boolean;
}

export interface SyncPlanMissingItem {
  sheet: WorkbookSheet;
  platform: DashboardPlatform;
  datasetKind: DatasetKind;
  expectedPeriod: string;
  recordCount: number;
}

export interface LatestWeekSyncPlan {
  mode: 'latest_week';
  startDate: string;
  endDate: string;
  platforms: DashboardPlatform[];
  alreadySynced: boolean;
  canSync: boolean;
  running: boolean;
  missingItems: SyncPlanMissingItem[];
  datasets?: SyncDataset[];
  fullRefreshRequired?: boolean;
}

export interface LatestDaySyncPlan {
  mode: 'latest_day';
  startDate: string;
  endDate: string;
  latestStoredDate: string | null;
  platforms: DashboardPlatform[];
  alreadySynced: boolean;
  canSync: boolean;
  running: boolean;
  missingItems: SyncPlanMissingItem[];
  datasets?: SyncDataset[];
  fullRefreshRequired?: boolean;
}

/* ===== 看板 ===== */

export interface OverviewTrendPoint {
  period: string;
  totalGmv: number;
  activeGmv: number;
  renewalGmv: number;
  expireUserCnt: number;
  renewalRate: number;
  renewalAov: number;
  activePayTypeGmv: Record<string, number>;
  totalPayTypeGmv?: Record<string, number>;
  renewalPayTypeGmv?: Record<string, number>;
  gmv: number;
  dau: number;
  paywallExposureRate: number;
  submitRate: number;
  payRate: number;
  aov: number;
}

export interface DashboardOverviewResponse {
  selectedPeriod: string;
  gmvTotal: number;
  gmvPrev: number;
  wowChange: number;
  dau: number;
  paywallExposureRate: number;
  submitRate: number;
  payRate: number;
  aov: number;
  trend: OverviewTrendPoint[];
  /** Daily GMV series sourced from pay_type_daily for the headline cards. */
  payTypeTrend?: OverviewTrendPoint[];
  cardTrend?: OverviewTrendPoint[];
}

export type GmvAnomalyMetric = 'totalGmv' | 'activeGmv' | 'renewalGmv';

export interface GmvAnomalyAlert {
  platform: DashboardPlatform;
  metric: GmvAnomalyMetric;
  period: string;
  baselinePeriod: string;
  window: 'day' | 'week';
  direction: 'up' | 'down';
  change: number;
  threshold: number;
  currentDailyAvg: number;
  previousDailyAvg: number;
  historyCount: number;
  baselineWindow: '12_complete_weeks';
}

export interface DashboardGmvAnomalyResponse {
  monitoredPlatforms?: DashboardPlatform[];
  latestWeek: string;
  latestDay: string;
  method: 'daily_and_weekly_rolling_p95_p05_min_10pct';
  alerts: GmvAnomalyAlert[];
}

export interface DashboardGmvCoverageWeek {
  period: string;
  payTypeDailyAvg: number;
  chainDailyAvg: number;
  unattributedDailyAvg: number;
  unattributedRate: number | null;
}

export interface DashboardGmvCoveragePlatform {
  platform: Platform;
  weeks: DashboardGmvCoverageWeek[];
  payTypeDailyAvg: number;
  chainDailyAvg: number;
  unattributedDailyAvg: number;
  unattributedRate: number | null;
}

export interface DashboardGmvCoverageResponse {
  weekCount: number;
  platforms: Record<Platform, DashboardGmvCoveragePlatform>;
}

export interface ChainAttributionDrill {
  path: ChainDrillPath;
  creationTier: string;
  userTag: string;
  chainType?: PaymentChainType;
  planTier?: RenewalPlanTier;
}

export type ChainDrillPath = 'tier_to_chain' | 'tier_to_user_to_chain';

export interface AttributionItem {
  key: string;
  value: number;
  previousValue: number;
  change: number;
  analysisDailyAvg: number;
  baselineDailyAvg: number;
  wowChange: number | null;
  contribution: number | null;
  metrics: Record<string, number>;
  previousMetrics: Record<string, number>;
}

export interface AttributionTrendPoint {
  period: string;
  [key: string]: string | number;
}

export interface AttributionComparisonWindow {
  baselinePeriod: string;
  analysisPeriod: string;
  periodDays: number;
  baselinePeriodDays?: number;
  analysisPeriodDays?: number;
}

export interface AttributionDriverItem {
  tier: string;
  userTag?: string;
  metricKey: string;
  metric: string;
  value: number;
  previousValue: number;
  change: number;
  wowChange: number | null;
  contribution: number | null;
}

export interface AttributionSection {
  title: string;
  description?: string;
  valueLabel: string;
  metricLabels: Record<string, string>;
  items: AttributionItem[];
}

export interface PaymentBreakdownRow {
  period: string;
  weekStart: string;
  payType: string;
  subscriptionTier?: string;
  functionName: string;
  userTag: string;
  gmvUsd: number;
}

export interface DashboardAttributionsResponse {
  dimension: AttributionDimension;
  valueLabel: string;
  comparison: AttributionComparisonWindow | null;
  metricLabels: Record<string, string>;
  items: AttributionItem[];
  sections?: AttributionSection[];
  paymentBreakdown?: PaymentBreakdownRow[];
  drivers?: AttributionDriverItem[];
  drill?: ChainAttributionDrill;
  trend: AttributionTrendPoint[];
}

export interface ChainTrendPoint {
  period: string;
  gmv: number;
  dau: number;
  paywallExposureRate: number;
  submitRate: number;
  payRate: number;
  aov: number;
}

export interface CreativeTrendPoint {
  period: string;
  activeUv: number;
  creationUv: number;
  creationTaskCnt: number;
  creationPenetrationRate: number;
  avgCreationTaskCntPerCreator: number;
}

/* ===== 原始表预览 ===== */

export interface WorkbookPreviewResponse {
  sheet: WorkbookSheet;
  fields: string[];
  items: Array<Record<string, string | number>>;
  total: number;
  hasMore: boolean;
}

/* ===== 诊断报告 ===== */

export interface ReportGenerationRequest {
  trigger?: 'manual' | 'scheduled' | 'anomaly';
  platform: Platform;
  granularity: Granularity;
  startDate: string;
  endDate: string;
}

export interface ReportSummary {
  platform: Platform;
  periodStart: string;
  periodEnd: string;
  modelUsed: string;
  degraded: boolean;
  markdown: string;
  generatedAt: string;
}

export interface PaymentTrendResponse {
  series: Array<{ key: string; label: string; points: Array<{period: string; gmvUsd: number | null; modelCostUsd?: number | null}> }>;

  granularity: 'day' | 'week' | 'month' | 'year';
  startDate: string;
  endDate: string;
  points: Array<{ period: string; gmvUsd: number | null; modelCostUsd: number | null; days: number; source: 'ads_v1' | 'legacy' | 'mixed' | null }>;
}

export type ReportHistoryItem = Omit<ReportSummary, 'markdown'>;

/** Daily diagnoses use a separate API and never overwrite weekly history. */
export type DailyDiagnosisReport = Omit<ReportSummary, 'platform'> & { platform: DashboardPlatform; runId: string };
export interface DailyDiagnosisStatus {
  platform: DashboardPlatform;
  period: string;
  baseline: string;
  status: 'waiting' | 'queued' | 'running' | 'success' | 'failed' | 'clear' | 'normal';
  updatedAt: string;
  error?: string;
  report?: DailyDiagnosisReport;
}

export interface ReportGenerationStatus {
  trigger?: 'manual' | 'scheduled' | 'anomaly';
  runId: string;
  platform: Platform;
  periodStart: string;
  periodEnd: string;
  status: 'queued' | 'running' | 'pausing' | 'paused' | 'success' | 'failed';
  stage: 'queued' | 'collect' | 'model' | 'write';
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
  report?: ReportSummary;
  heartbeatAt?: string;
  steps?: Array<{
    key: string;
    label: string;
    status: 'waiting' | 'running' | 'success' | 'failed';
    detail?: string;
  }>;
}

/* ===== 管理员成员 ===== */

export interface AdminMember {
  userId: string;
  name: string;
  avatar?: string;
  email?: string;
}

export interface AdminMembersResponse {
  members: AdminMember[];
  includesAppDevelopers: boolean;
}

export interface AddAdminMembersRequest {
  userIds: string[];
}

export interface RemoveAdminMemberResponse {
  removedUserId: string;
}
