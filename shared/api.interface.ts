/* 前后端共享的类型写在这里 */

export const PLATFORMS = ['web', 'app'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const APP_DEVICE_TYPES = ['ios', 'android'] as const;
export type AppDeviceType = (typeof APP_DEVICE_TYPES)[number];

export const GRANULARITIES = ['day', 'week'] as const;
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

export const RENEWAL_PLAN_TIERS = ['LITE', 'PRO', 'ULTRA'] as const;
export type RenewalPlanTier = (typeof RENEWAL_PLAN_TIERS)[number];

export type PaymentChainType = 'active' | 'renewal';

/* ===== 同步链路 ===== */

export type SyncMode = 'latest_day' | 'latest_week';

export interface SyncRunRequest {
  mode?: SyncMode;
  platforms?: Platform[];
}

export interface SyncRunResponse {
  runId: string;
  mode?: SyncMode;
  startDate: string;
  endDate: string;
  platforms: Platform[];
  status: 'queued' | 'running' | 'success' | 'failed';
  rowsSynced: number;
  skipped?: boolean;
  skipReason?: string;
  errorMessage?: string;
}

export interface SyncRunStatus {
  runId: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  stage: SyncStage;
  startDate: string;
  endDate: string;
  platforms: Platform[];
  rowsSynced: number;
  errorMessage?: string;
  startedAt: string;
  finishedAt?: string;
  heartbeatAt?: string;
  steps?: Array<{ key: string; label: string; status: 'waiting' | 'running' | 'success' | 'failed'; detail?: string }>;
  skipped?: boolean;
}

export interface SyncPlanMissingItem {
  sheet: WorkbookSheet;
  platform: Platform;
  datasetKind: DatasetKind;
  expectedPeriod: string;
  recordCount: number;
}

export interface LatestWeekSyncPlan {
  mode: 'latest_week';
  startDate: string;
  endDate: string;
  platforms: Platform[];
  alreadySynced: boolean;
  canSync: boolean;
  running: boolean;
  missingItems: SyncPlanMissingItem[];
}

export interface LatestDaySyncPlan {
  mode: 'latest_day';
  startDate: string;
  endDate: string;
  latestStoredDate: string | null;
  platforms: Platform[];
  alreadySynced: boolean;
  canSync: boolean;
  running: boolean;
  missingItems: SyncPlanMissingItem[];
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
  cardTrend?: OverviewTrendPoint[];
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

export interface DashboardAttributionsResponse {
  dimension: AttributionDimension;
  valueLabel: string;
  comparison: AttributionComparisonWindow | null;
  metricLabels: Record<string, string>;
  items: AttributionItem[];
  sections?: AttributionSection[];
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

export type ReportHistoryItem = Omit<ReportSummary, 'markdown'>;

export interface ReportGenerationStatus {
  runId: string;
  platform: Platform;
  periodStart: string;
  periodEnd: string;
  status: 'queued' | 'running' | 'success' | 'failed';
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
