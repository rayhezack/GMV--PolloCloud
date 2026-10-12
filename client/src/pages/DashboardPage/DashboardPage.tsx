import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import dayjs from 'dayjs';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion';
import {
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Info,
  LayoutDashboard,
  Loader2,
  Minus,
  Monitor,
  RefreshCw,
  Route,
  SlidersHorizontal,
  Smartphone,
  TrendingDown,
  TrendingUp,
  UsersRound,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { flushSync } from 'react-dom';
import { FileText } from 'lucide-react';
import { CanvasToolbar } from '@/components/bencho';
import {
  RevenueCards,
  ContributionBars,
  downloadCsv,
} from '@/components/dashboard/AnalysisWidgets';
import {
  dashboardView,
  dashboardHref,
} from '@/components/dashboard/navigation';
import {
  CartesianGrid,
  Line,
  LineChart,
  type TooltipProps,
  XAxis,
  YAxis,
} from 'recharts';
import { dashboardApi } from '@client/src/api';
import { getLatestSyncRun } from '@client/src/api/sync';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from '@client/src/components/ui/chart';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@client/src/components/ui/empty';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@client/src/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@client/src/components/ui/table';
import { cn } from '@client/src/lib/utils';
import {
  getBusinessWeekStart,
  getLatestCompleteFriday,
} from '@shared/business-week';
import type {
  AppDeviceType,
  AttributionDriverItem,
  AttributionItem,
  AttributionSection,
  DashboardAttributionsResponse,
  DashboardGmvCoveragePlatform,
  DashboardGmvCoverageResponse,
  DashboardPlatform,
  DashboardOverviewResponse,
  Granularity,
  OverviewTrendPoint,
  PaymentChainType,
  Platform,
  RenewalPlanTier,
  SyncRunStatus,
} from '@shared/api.interface';
import SyncControlBar from './SyncControlBar';

gsap.registerPlugin(useGSAP);

const WINDOW_DAYS = 27;
const DEFAULT_TREND_POINTS = WINDOW_DAYS + 1;
const WEEK_DAYS = 7;
const TREND_DATA_START_DATE = '2026-01-01';

const PLATFORM_LABELS: Record<DashboardPlatform, string> = {
  all: '全端汇总',
  web: 'Web 端',
  app: 'App 端',
};

type DeviceFilter = 'all' | AppDeviceType;
type PlanTierFilter = 'all' | RenewalPlanTier;

const PLAN_TIER_OPTIONS: Array<{ value: PlanTierFilter; label: string }> = [
  { value: 'all', label: '全部套餐' },
  { value: 'LITE', label: 'Lite' },
  { value: 'PRO', label: 'Pro' },
  { value: 'ULTRA', label: 'Ultra' },
];

const DEVICE_FILTER_OPTIONS: Array<{
  value: DeviceFilter;
  label: string;
}> = [
  { value: 'all', label: '全部' },
  { value: 'ios', label: 'iOS' },
  { value: 'android', label: 'Android' },
];

type TrendMetricKey =
  | 'activeGmv'
  | 'dau'
  | 'paywallExposureRate'
  | 'submitRate'
  | 'payRate'
  | 'aov'
  | 'renewalGmv'
  | 'expireUserCnt'
  | 'renewalRate'
  | 'renewalAov';

type TrendMetricSpec = {
  key: TrendMetricKey;
  label: string;
  valueLabel: string;
  color: string;
  format: (value: number) => string;
};

type TrendChartPoint = {
  period: string;
  value: number;
  previousWeekValue?: number;
};

type TrendChartDataPoint = TrendChartPoint &
  Record<string, string | number | undefined>;

type TrendSeriesSpec = {
  key: string;
  label: string;
  valueLabel: string;
  color: string;
  format: (value: number) => string;
  sourceKey?: keyof OverviewTrendPoint;
};

type TrendRange = {
  startIndex: number;
  endIndex: number;
};

const ACTIVE_PAYMENT_TREND_METRICS: TrendMetricSpec[] = [
  {
    key: 'activeGmv',
    label: '主动付费GMV',
    valueLabel: '主动付费GMV',
    color: '#5B3FF2',
    format: (value) => formatCurrency(value),
  },
  {
    key: 'dau',
    label: 'DAU',
    valueLabel: 'DAU',
    color: '#5B3FF2',
    format: formatCompactNumber,
  },
  {
    key: 'paywallExposureRate',
    label: '付费墙曝光率',
    valueLabel: '曝光率',
    color: '#5B3FF2',
    format: formatPercent,
  },
  {
    key: 'submitRate',
    label: '付费墙提交率',
    valueLabel: '提交率',
    color: '#5B3FF2',
    format: formatPercent,
  },
  {
    key: 'payRate',
    label: '提交支付率',
    valueLabel: '提交支付率',
    color: '#5B3FF2',
    format: formatPercent,
  },
  {
    key: 'aov',
    label: '客单价',
    valueLabel: '客单价',
    color: '#5B3FF2',
    format: (value) => formatCurrency(value, false),
  },
];

const RENEWAL_TREND_METRICS: TrendMetricSpec[] = [
  {
    key: 'renewalGmv',
    label: '续订 GMV',
    valueLabel: '续订 GMV',
    color: '#5B3FF2',
    format: (value) => formatCurrency(value),
  },
  {
    key: 'expireUserCnt',
    label: '到期用户数',
    valueLabel: '到期用户数',
    color: '#5B3FF2',
    format: formatCompactNumber,
  },
  {
    key: 'renewalRate',
    label: '续订率',
    valueLabel: '续订率',
    color: '#5B3FF2',
    format: formatPercent,
  },
  {
    key: 'renewalAov',
    label: '续订客单价',
    valueLabel: '续订客单价',
    color: '#5B3FF2',
    format: (value) => formatCurrency(value, false),
  },
];

const TREND_NAV_METRICS = [
  ...ACTIVE_PAYMENT_TREND_METRICS,
  ...RENEWAL_TREND_METRICS,
];

function isRenewalTrendMetric(value: TrendMetricKey): boolean {
  return RENEWAL_TREND_METRICS.some((metric) => metric.key === value);
}

const CREATIVE_METRICS = [
  'activeUv',
  'creationUv',
  'creationTaskCnt',
  'creationPenetrationRate',
  'avgCreationTaskCntPerCreator',
] as const;
type CreativeMetricKey = (typeof CREATIVE_METRICS)[number];

const CREATIVE_TIER_LABELS: Record<string, string> = {
  create_cnt_30d_0: '近30日未创作',
  'create_cnt_30d_[1,11)': '近30日 1-10 次',
  'create_cnt_30d_[11,31)': '近30日 11-30 次',
  'create_cnt_30d_[31,101)': '近30日 31-100 次',
  'create_cnt_30d_[101,+inf)': '近30日 101+ 次',
};

const USER_TAG_OPTIONS = [
  { value: 'all', label: '全部用户' },
  { value: '新用户', label: '新用户' },
  { value: '老用户', label: '老用户' },
  { value: '未知', label: '未知' },
] as const;

const SURFACE_CARD_CLASS = 'dashboard-panel';
const SELECT_TRIGGER_CLASS =
  'rounded-full border-transparent bg-white text-gray-700 shadow-none transition-colors enabled:hover:bg-gray-50 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-[#5b3ff2] data-[state=open]:border-transparent';
const SUBSURFACE_CLASS = 'rounded-2xl bg-white p-2';
const FILTER_LABEL_CLASS = 'text-[11px] font-medium text-gray-500';
const FILTER_PILL_CLASS =
  'inline-flex h-9 items-center rounded-full border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-none transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50';

type DashboardLoadKey =
  | 'overview'
  | 'coverage'
  | 'payType'
  | 'chain'
  | 'creative'
  | 'sync';

const INITIAL_LOADING_STATE: Record<DashboardLoadKey, boolean> = {
  overview: false,
  coverage: false,
  payType: false,
  chain: false,
  creative: false,
  sync: false,
};

const LOAD_ERROR_LABELS: Record<DashboardLoadKey, string> = {
  overview: '趋势',
  coverage: '口径差异',
  payType: '付费类型',
  chain: '支付链路',
  creative: '创作积极性',
  sync: '同步状态',
};

const CHAIN_METRIC_DEFINITIONS = [
  { label: '付费墙曝光率', formula: '付费墙曝光UV / DAU' },
  { label: '付费墙提交率', formula: '付费墙支付提交UV / 付费墙曝光UV' },
  { label: '提交支付率', formula: '支付UV / 付费墙支付提交UV' },
  { label: '客单价', formula: '主动付费GMV / 支付UV' },
] as const;

const RENEWAL_METRIC_DEFINITIONS = [
  { label: '续订率', formula: '续订用户数 / 到期用户数' },
  { label: '续订客单价', formula: '续订金额 / 续订用户数' },
] as const;

function isUserTag(
  value: string | null,
): value is '新用户' | '老用户' | '未知' {
  return value === '新用户' || value === '老用户' || value === '未知';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildViewWindow(): {
  startDate: string;
  endDate: string;
} {
  const endDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  return { startDate: '1970-01-01', endDate };
}

function getTrendYearOptions(): string[] {
  const startYear = dayjs(TREND_DATA_START_DATE).year();
  const endYear = dayjs().subtract(1, 'day').year();
  return Array.from(
    { length: Math.max(0, endYear - startYear + 1) },
    (_, index) => String(startYear + index),
  );
}

function getTrendMonthOptions(year: string): string[] {
  const latestDate = dayjs().subtract(1, 'day');
  const startDate = dayjs(TREND_DATA_START_DATE);
  const selectedYear = Number(year);
  if (!Number.isInteger(selectedYear)) return [];

  const startMonth =
    selectedYear === startDate.year() ? startDate.month() + 1 : 1;
  const endMonth =
    selectedYear === latestDate.year() ? latestDate.month() + 1 : 12;
  if (endMonth < startMonth) return [];
  return Array.from({ length: endMonth - startMonth + 1 }, (_, index) =>
    String(startMonth + index).padStart(2, '0'),
  );
}

function isTrendYearParam(value: string | null): value is string {
  return Boolean(value && getTrendYearOptions().includes(value));
}

function isTrendMonthParam(
  value: string | null,
  year: string,
): value is string {
  return Boolean(value && getTrendMonthOptions(year).includes(value));
}

function isTrendEndMonthParam(
  value: string | null,
  year: string,
  startMonth: string,
): value is string {
  if (!isTrendMonthParam(value, year)) return false;
  return Number(value) >= Number(startMonth);
}

function resolveTrendWindow(
  year: string,
  startMonth: string,
  endMonth: string,
): {
  startDate: string;
  endDate: string;
} {
  const defaultWindow = buildViewWindow();
  if (!year) return defaultWindow;

  const latestDate = dayjs(defaultWindow.endDate);
  const rawStartDate = startMonth
    ? dayjs(`${year}-${startMonth}-01`)
    : dayjs(`${year}-01-01`);
  const rawEndDate = endMonth
    ? dayjs(`${year}-${endMonth}-01`).endOf('month')
    : dayjs(`${year}-12-31`);
  const minStartDate = dayjs(TREND_DATA_START_DATE);
  const startDate = rawStartDate.isBefore(minStartDate)
    ? minStartDate
    : rawStartDate;
  const endDate = rawEndDate.isAfter(latestDate) ? latestDate : rawEndDate;

  return {
    startDate: startDate.format('YYYY-MM-DD'),
    endDate: endDate.format('YYYY-MM-DD'),
  };
}

function resolveTrendSourceWindow(
  window: { startDate: string; endDate: string },
  granularity: Granularity,
): { startDate: string; endDate: string } {
  if (granularity !== 'day') return window;

  const minStartDate = dayjs(TREND_DATA_START_DATE);
  const paddedStartDate = dayjs(window.startDate).subtract(WEEK_DAYS, 'day');
  return {
    startDate: (paddedStartDate.isBefore(minStartDate)
      ? minStartDate
      : paddedStartDate
    ).format('YYYY-MM-DD'),
    endDate: window.endDate,
  };
}

function getDefaultWeekSelection(): {
  baselineWeek: string;
  analysisWeek: string;
} {
  const analysisWeek = getBusinessWeekStart(
    dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
  );
  return {
    baselineWeek: dayjs(analysisWeek)
      .subtract(WEEK_DAYS, 'day')
      .format('YYYY-MM-DD'),
    analysisWeek,
  };
}

function isValidDateParam(value: string | null): value is string {
  return Boolean(
    value &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    dayjs(value).format('YYYY-MM-DD') === value,
  );
}

function isSelectableWeekParam(value: string | null): value is string {
  const currentWeek = getBusinessWeekStart(
    dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
  );
  return Boolean(
    isValidDateParam(value) &&
    value === getBusinessWeekStart(value) &&
    value >= getBusinessWeekStart(TREND_DATA_START_DATE) &&
    value <= currentWeek,
  );
}

function isIncompleteAttributionWeek(weekStart: string): boolean {
  return (
    isValidDateParam(weekStart) &&
    weekStart > getBusinessWeekStart(getLatestCompleteFriday())
  );
}

function isPartialComparison(
  comparison: DashboardAttributionsResponse['comparison'] | null | undefined,
): boolean {
  return Boolean(
    comparison &&
    ((comparison.baselinePeriodDays ?? comparison.periodDays) < WEEK_DAYS ||
      (comparison.analysisPeriodDays ?? comparison.periodDays) < WEEK_DAYS),
  );
}

function getChangeColumnLabel(
  comparison: DashboardAttributionsResponse['comparison'] | null | undefined,
): string {
  return isPartialComparison(comparison) ? '同期变化' : '周环比';
}

function normalizeTrendMetricKey(value: string | null): TrendMetricKey {
  if (value === 'gmv' || value === 'totalGmv') return 'activeGmv';
  return TREND_NAV_METRICS.some((metric) => metric.key === value)
    ? (value as TrendMetricKey)
    : 'activeGmv';
}

function isChainTrendMetric(value: TrendMetricKey): boolean {
  return [
    'dau',
    'paywallExposureRate',
    'submitRate',
    'payRate',
    'aov',
  ].includes(value);
}

function supportsTrendUserTag(value: TrendMetricKey): boolean {
  return value === 'activeGmv' || isChainTrendMetric(value);
}

function formatCompactNumber(value: number): string {
  if (Math.abs(value) < 10000) return formatInteger(value);
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDecimal(value: number, fractionDigits = 2): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function formatCurrency(value: number, compact = true): string {
  if (!Number.isFinite(value)) return '$0';
  if (!compact) return `$${formatDecimal(value)}`;
  const magnitude = Math.abs(value);
  if (magnitude >= 10000) {
    const sign = value < 0 ? '-' : '';
    return `${sign}$${formatDecimal(magnitude / 10000)}万`;
  }
  const sign = value < 0 ? '-' : '';
  return `${sign}$${formatInteger(magnitude)}`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00%';
  return `${(value * 100).toFixed(2)}%`;
}

function formatSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function getCachedRequest<T>(
  cache: Map<string, Promise<unknown>>,
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key) as Promise<T> | undefined;
  if (cached) return cached;

  const request = fetcher().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, request as Promise<unknown>);
  return request;
}

function getTrendSeriesValue(
  row: OverviewTrendPoint,
  series: TrendSeriesSpec,
): number {
  if (!series.sourceKey) return 0;
  const value = row[series.sourceKey];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function buildTrendSeries(
  metric: TrendMetricSpec,
): TrendSeriesSpec[] {
  return [
    {
      key: 'series0',
      label: metric.label,
      valueLabel: metric.valueLabel,
      color: metric.color,
      format: metric.format,
      sourceKey: metric.key as keyof OverviewTrendPoint,
    },
  ];
}

function getTrendMetricValue(
  row: OverviewTrendPoint,
  metric: TrendMetricSpec,
): number {
  const value = row[metric.key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function TrendTooltipContent({
  active,
  label,
  payload,
  series,
  showPreviousWeekComparison,
  compact = false,
}: TooltipProps<number, string> & {
  series: TrendSeriesSpec[];
  showPreviousWeekComparison: boolean;
  compact?: boolean;
}) {
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload as TrendChartDataPoint | undefined;

  if (compact && series.length === 1) {
    const item = series[0];
    const currentValue = Number(row?.[item.key]);
    const previousValue = Number(row?.[`${item.key}PreviousWeekValue`]);
    const previousWeekChange =
      Number.isFinite(currentValue) &&
      Number.isFinite(previousValue) &&
      previousValue !== 0
        ? currentValue / previousValue - 1
        : null;

    return (
      <div className="grid min-w-[8rem] gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-[11px] leading-none text-gray-600 shadow-none">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-gray-900">{String(label)}</span>
          <span className="font-mono text-gray-900">
            {item.format(Number.isFinite(currentValue) ? currentValue : 0)}
          </span>
        </div>
        {showPreviousWeekComparison &&
        Number.isFinite(previousWeekChange ?? NaN) ? (
          <div className="flex items-center justify-between gap-3">
            <span>较上周同日</span>
            <span className="font-mono text-gray-900">
              {formatSignedPercent(previousWeekChange)}
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="trend-tooltip">
      <div className="trend-tooltip-date">{String(label)}</div>
      <div className="grid gap-1">
        {series.map((item) => {
          const currentValue = Number(row?.[item.key]);
          const previousValue = Number(row?.[`${item.key}PreviousWeekValue`]);
          const previousWeekChange =
            Number.isFinite(currentValue) &&
            Number.isFinite(previousValue) &&
            previousValue !== 0
              ? currentValue / previousValue - 1
              : null;
          return (
            <div key={item.key} className="trend-tooltip-row">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="truncate">{item.valueLabel}</span>
              </span>
              <span className="font-mono text-gray-900">
                {item.format(Number.isFinite(currentValue) ? currentValue : 0)}
              </span>
              {showPreviousWeekComparison && series.length === 1 ? (
                <span className="font-mono text-gray-500">
                  {formatSignedPercent(previousWeekChange)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatPeriod(value: string, granularity: Granularity): string {
  if (!value) return '-';
  return granularity === 'day' ? value.slice(5) : value.slice(5);
}

function resolveTrendRange(
  data: TrendChartPoint[],
  startDate: string | null,
  endDate: string | null,
): TrendRange {
  if (data.length === 0) return { startIndex: 0, endIndex: 0 };
  const lastIndex = data.length - 1;
  const defaultStartIndex = Math.max(0, data.length - DEFAULT_TREND_POINTS);
  const startIndex = isValidDateParam(startDate)
    ? data.findIndex((row) => row.period >= startDate)
    : defaultStartIndex;
  const endIndex = isValidDateParam(endDate)
    ? findLastIndex(data, (row) => row.period <= endDate)
    : lastIndex;
  const normalizedStartIndex =
    startIndex >= 0 ? Math.min(startIndex, lastIndex) : defaultStartIndex;
  const normalizedEndIndex =
    endIndex >= normalizedStartIndex
      ? Math.min(endIndex, lastIndex)
      : lastIndex;
  return {
    startIndex: normalizedStartIndex,
    endIndex: normalizedEndIndex,
  };
}

function resolveTrendYAxisDomain(
  data: TrendChartDataPoint[],
  keys: string[],
): [number, number] {
  const values = data
    .flatMap((row) => keys.map((key) => row[key]))
    .filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    );
  if (values.length === 0) return [0, 1];

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = maxValue - minValue;
  const padding =
    span > 0 ? span * 0.15 : Math.max(Math.abs(maxValue) * 0.08, 1);
  const lower =
    minValue >= 0 ? Math.max(0, minValue - padding) : minValue - padding;
  const upper = maxValue + padding;

  return lower === upper ? [lower - 1, upper + 1] : [lower, upper];
}

function clampIndex(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function indexToPercent(index: number, lastIndex: number): number {
  if (lastIndex <= 0) return 0;
  return (index / lastIndex) * 100;
}

function findLastIndex<T>(
  values: T[],
  predicate: (value: T) => boolean,
): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) return index;
  }
  return -1;
}

function formatContributionValue(value: number, valueLabel: string): string {
  if (valueLabel.includes('GMV')) return formatCurrency(value);
  return formatDecimal(value);
}

function formatMetricByKey(key: string, value: number): string {
  if (key.endsWith('Rate')) return formatPercent(value);
  if (key === 'chainArppu' || key === 'renewalAov') return formatCurrency(value, false);
  if (key === 'avgCreationTaskCntPerCreator') return formatDecimal(value);
  if (key.includes('Uv') || key.includes('Cnt') || key === 'activeUv') {
    return formatCompactNumber(value);
  }
  return formatDecimal(value);
}

function formatSignedMetricByKey(key: string, value: number): string {
  if (!Number.isFinite(value)) return '-';
  const prefix = value >= 0 ? '+' : '-';
  const magnitude = Math.abs(value);
  if (key.endsWith('Rate')) return `${prefix}${(magnitude * 100).toFixed(2)}pp`;
  if (key === 'chainArppu' || key === 'renewalAov')
    return `${prefix}${formatCurrency(magnitude, false)}`;
  if (key === 'avgCreationTaskCntPerCreator') {
    return `${prefix}${formatDecimal(magnitude)}`;
  }
  if (key.includes('Uv') || key.includes('Cnt') || key === 'activeUv') {
    return `${prefix}${formatCompactNumber(magnitude)}`;
  }
  return `${prefix}${formatDecimal(magnitude)}`;
}

function formatWeekRange(weekStart: string, periodDays = WEEK_DAYS): string {
  if (!isValidDateParam(weekStart)) return weekStart || '-';
  const endOffset = Math.max(0, Math.min(periodDays, WEEK_DAYS) - 1);
  return `${weekStart} ~ ${dayjs(weekStart).add(endOffset, 'day').format('MM-DD')}`;
}

function formatShortWeekRange(
  weekStart: string,
  periodDays = WEEK_DAYS,
): string {
  if (!isValidDateParam(weekStart)) return weekStart || '-';
  const endOffset = Math.max(0, Math.min(periodDays, WEEK_DAYS) - 1);
  return `${dayjs(weekStart).format('MM/DD')} - ${dayjs(weekStart)
    .add(endOffset, 'day')
    .format('MM/DD')}`;
}

function formatDateRangeLabel(range: {
  startDate: string;
  endDate: string;
}): string {
  return `${range.startDate} ~ ${range.endDate}`;
}

function formatComparisonWindow(
  comparison: DashboardAttributionsResponse['comparison'] | null | undefined,
  fallbackBaselineWeek: string,
  fallbackAnalysisWeek: string,
): string {
  if (!comparison) {
    return `${formatWeekRange(fallbackBaselineWeek)} vs ${formatWeekRange(
      fallbackAnalysisWeek,
    )}`;
  }
  const baselineDays = comparison.baselinePeriodDays ?? comparison.periodDays;
  const analysisDays = comparison.analysisPeriodDays ?? comparison.periodDays;
  return `${formatWeekRange(
    comparison.baselinePeriod,
    baselineDays,
  )} vs ${formatWeekRange(comparison.analysisPeriod, analysisDays)}`;
}

function formatComparisonMode(
  comparison: DashboardAttributionsResponse['comparison'] | null | undefined,
): string {
  if (!comparison) return '按业务周日均对比';
  if (isPartialComparison(comparison)) {
    return `业务周进行中：按 ${
      comparison.analysisPeriodDays ?? comparison.periodDays
    } 个同期业务日进行日均对比`;
  }
  return '完整业务周日均对比';
}

function formatTierLabel(key: string): string {
  if (key === 'all') return '全部创作分层';
  return CREATIVE_TIER_LABELS[key] ?? key;
}

function getCreativeMetricValue(
  item: AttributionItem,
  metricKey: CreativeMetricKey,
  source: 'current' | 'previous',
): number {
  const metrics = source === 'current' ? item.metrics : item.previousMetrics;
  return metrics[metricKey] ?? 0;
}

function aggregateCreativeMetrics(
  items: AttributionItem[],
  source: 'current' | 'previous',
): Record<CreativeMetricKey, number> {
  const totals = items.reduce(
    (acc, item) => ({
      activeUv: acc.activeUv + getCreativeMetricValue(item, 'activeUv', source),
      creationUv:
        acc.creationUv + getCreativeMetricValue(item, 'creationUv', source),
      creationTaskCnt:
        acc.creationTaskCnt +
        getCreativeMetricValue(item, 'creationTaskCnt', source),
    }),
    {
      activeUv: 0,
      creationUv: 0,
      creationTaskCnt: 0,
    },
  );
  return {
    ...totals,
    creationPenetrationRate:
      totals.activeUv > 0 ? totals.creationUv / totals.activeUv : 0,
    avgCreationTaskCntPerCreator:
      totals.activeUv > 0 ? totals.creationTaskCnt / totals.activeUv : 0,
  };
}

function EmptyBlock({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Empty className="min-h-[220px] rounded-2xl bg-gray-50">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BarChart3 className="size-5 text-primary" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function LoadingBlock({ title }: { title: string }) {
  return (
    <Empty className="min-h-[220px] rounded-2xl bg-gray-50">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Loader2 className="size-5 animate-spin text-primary" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>正在读取业务数据库数据。</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function GmvCoverageExplanation({
  data,
  loading,
  error,
}: {
  data: DashboardGmvCoverageResponse | null;
  loading: boolean;
  error?: string;
}) {
  const platformRows = data
    ? (['web', 'app'] as Platform[]).map((platform) => data.platforms[platform])
    : [];

  return (
    <article className="dashboard-methodology">
      <aside className="dashboard-methodology-rail">
        <span>数据口径</span>
        <nav aria-label="数据口径目录">
          <a href="#method-window">统计窗口</a>
          <a href="#method-active">主动付费</a>
          <a href="#method-renewal">自动续订</a>
          <a href="#method-payment">支付与归因</a>
          <a href="#method-creative">创作分层</a>
          <a href="#method-coverage">覆盖差异</a>
        </nav>
      </aside>
      <div className="dashboard-methodology-body">
        <header className="dashboard-methodology-header">
          <Info size={20} aria-hidden="true" />
          <h2>口径说明</h2>
        </header>
        <section id="method-window" className="dashboard-methodology-section">
          <h3>统计窗口</h3>
          <p>归因表按各分析页的业务周选择器比较；单指标趋势使用独立趋势窗口。</p>
          <p>覆盖差异使用最近四个完整业务周的数据，每周先计算日均。</p>
        </section>
        <section id="method-active" className="dashboard-methodology-section">
          <h3>主动付费 GMV</h3>
          <p className="dashboard-methodology-formula">主动付费 GMV = DAU × 付费墙曝光率 × 付费墙提交率 × 提交支付率 × 客单价</p>
          <dl className="dashboard-methodology-definitions">
            {CHAIN_METRIC_DEFINITIONS.map((item) => (
              <div key={item.label}><dt>{item.label}</dt><dd>{item.formula}</dd></div>
            ))}
          </dl>
        </section>
        <section id="method-renewal" className="dashboard-methodology-section">
          <h3>自动续订 GMV</h3>
          <p className="dashboard-methodology-formula">续订 GMV = 到期用户数 × 续订率 × 续订客单价</p>
          <dl className="dashboard-methodology-definitions">
            {RENEWAL_METRIC_DEFINITIONS.map((item) => (
              <div key={item.label}><dt>{item.label}</dt><dd>{item.formula}</dd></div>
            ))}
          </dl>
        </section>
        <section id="method-payment" className="dashboard-methodology-section">
          <h3>支付结果与链路归因</h3>
          <dl className="dashboard-methodology-definitions">
            <div><dt>付费类型表</dt><dd>主动付费支付记录直接汇总，作为 GMV 结果口径。</dd></div>
            <div><dt>大盘 GMV</dt><dd>不统计 API Credits 订单。</dd></div>
            <div><dt>支付链路表</dt><dd>从 DAU 出发，按访问、曝光、提交、支付的时间戳顺序归因。</dd></div>
            <div><dt>差额含义</dt><dd>支付记录未能被行为时间顺序串联的主动付费 GMV。</dd></div>
          </dl>
        </section>
        <section id="method-creative" className="dashboard-methodology-section">
          <h3>创作积极性与分层</h3>
          <dl className="dashboard-methodology-definitions">
            <div><dt>创作积极性</dt><dd>创作 UV、任务数按业务日均展示，渗透率为创作 UV ÷ 活跃 UV，不计算贡献度。</dd></div>
            <div><dt>创作分层</dt><dd>按分析期开始前 30 日的创作次数划分；“分析期前 30 日无创作用户”仅表示该窗口内创作次数为 0，创作 UV、创作渗透率等指标统计的是这批用户在分析期内的行为。</dd></div>
          </dl>
        </section>
        <section id="method-coverage" className="dashboard-methodology-section">
          <h3>GMV 覆盖差异</h3>
          <p>支付结果表与链路归因表按 Web、App 分别对齐比较。</p>
          <div className="dashboard-methodology-coverage">
            {loading ? (
              <p className="dashboard-methodology-status">正在计算最近四个完整业务周的 GMV 覆盖差异…</p>
            ) : error ? (
              <p className="dashboard-methodology-status text-destructive">口径差异暂时无法读取：{error}</p>
            ) : platformRows.length === 0 ? (
              <p className="dashboard-methodology-status">暂无最近四个共同业务周数据。</p>
            ) : (
              <div className="dashboard-coverage-table">
                <div className="hidden grid-cols-[minmax(76px,0.45fr)_repeat(4,minmax(0,1fr))] gap-3 px-2 py-2 text-xs text-muted-foreground md:grid">
                  <div>端口</div>
                  <div>付费类型表，四周日均</div>
                  <div>链路归因表，四周日均</div>
                  <div>未归因差额，四周日均</div>
                  <div>未归因占比</div>
                </div>
                <div className="flex flex-1 flex-col divide-y divide-gray-100">
                  {platformRows.map((summary) => (
                    <GmvCoverageRow key={summary.platform} summary={summary} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </article>
  );
}

function GmvCoverageRow({
  summary,
}: {
  summary: DashboardGmvCoveragePlatform;
}) {
  const platformLabel = summary.platform === 'web' ? 'Web 端' : 'App 端';
  return (
    <div className="grid flex-1 gap-4 px-3 py-4 md:grid-cols-[minmax(90px,0.5fr)_repeat(4,minmax(0,1fr))] md:items-center">
      <div className="font-medium text-foreground">{platformLabel}</div>
      <CoverageValue
        label="付费类型表，四周日均"
        value={formatCurrency(summary.payTypeDailyAvg)}
      />
      <CoverageValue
        label="链路归因表，四周日均"
        value={formatCurrency(summary.chainDailyAvg)}
      />
      <CoverageValue
        label="未归因差额，四周日均"
        value={formatCurrency(summary.unattributedDailyAvg)}
        tone={summary.unattributedDailyAvg > 0 ? 'muted' : 'positive'}
      />
      <CoverageValue
        label="未归因占比"
        value={
          summary.unattributedRate === null
            ? '-'
            : formatPercent(summary.unattributedRate)
        }
        tone="accent"
      />
    </div>
  );
}

function CoverageValue({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'positive' | 'accent';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 md:block">
      <div className="text-xs text-muted-foreground md:hidden">{label}</div>
      <div
        className={cn(
          'font-mono text-sm tabular-nums',
          tone === 'accent' && 'text-primary',
          tone === 'positive' && 'text-emerald-600',
          tone === 'muted' && 'text-foreground',
          tone === 'default' && 'text-foreground',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function PageSection({
  title,
  description,
  action,
  fullBleed = false,
  className,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  fullBleed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn(SURFACE_CARD_CLASS, fullBleed && 'md:p-8', className)}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">
            {title}
          </h2>
          {description ? (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function MetricTrendChart({
  data,
  metricControls,
  granularity,
  onGranularityChange,
  metric,
  rangeStartDate,
  rangeEndDate,
  onRangeChange,
}: {
  data: OverviewTrendPoint[];
  metricControls: ReactNode;
  granularity: Granularity;
  onGranularityChange: (value: Granularity) => void;
  metric: TrendMetricSpec;
  rangeStartDate: string | null;
  rangeEndDate: string | null;
  onRangeChange: (range: { startDate: string; endDate: string }) => void;
}) {
  const [showData, setShowData] = useState(false);
  const reducedMotion = useReducedMotion();
  const chartPanRef = useRef<HTMLDivElement | null>(null);
  const chartPanStateRef = useRef<{
    pointerId: number;
    startX: number;
    startIndex: number;
    endIndex: number;
    pointWidth: number;
  } | null>(null);
  const [isChartPanning, setIsChartPanning] = useState(false);
  const series = useMemo(() => buildTrendSeries(metric), [metric]);
  const [hiddenSeriesKeys, setHiddenSeriesKeys] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    setHiddenSeriesKeys(new Set());
  }, [series]);
  const visibleSeries = useMemo(
    () => series.filter((item) => !hiddenSeriesKeys.has(item.key)),
    [hiddenSeriesKeys, series],
  );
  const toggleSeriesVisibility = useCallback(
    (key: string) => {
      setHiddenSeriesKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) {
          next.delete(key);
          return next;
        }
        const currentVisibleCount = series.filter(
          (item) => !current.has(item.key),
        ).length;
        if (currentVisibleCount <= 1) return current;
        next.add(key);
        return next;
      });
    },
    [series],
  );
  const chartData = useMemo(() => {
    const valueBySeriesPeriod = series.map((item) => ({
      series: item,
      values: new Map(
        data.map((row) => [row.period, getTrendSeriesValue(row, item)]),
      ),
    }));
    const headlineValueByPeriod = new Map(
      data.map((row) => [row.period, getTrendMetricValue(row, metric)]),
    );
    return data.map((row) => {
      const previousWeekPeriod = dayjs(row.period)
        .subtract(WEEK_DAYS, 'day')
        .format('YYYY-MM-DD');
      const point: TrendChartDataPoint = {
        period: row.period,
        value: getTrendMetricValue(row, metric),
        valuePreviousWeekValue:
          granularity === 'day'
            ? headlineValueByPeriod.get(previousWeekPeriod)
            : undefined,
      };
      for (const { series: item, values } of valueBySeriesPeriod) {
        const currentValue = getTrendSeriesValue(row, item);
        point[item.key] = currentValue;
        point[`${item.key}PreviousWeekValue`] =
          granularity === 'day' ? values.get(previousWeekPeriod) : undefined;
      }
      return point;
    });
  }, [data, granularity, metric, series]);
  const trendRange = resolveTrendRange(chartData, rangeStartDate, rangeEndDate);
  const visibleData = chartData.slice(
    trendRange.startIndex,
    trendRange.endIndex + 1,
  );
  const yAxisKeys = visibleSeries.map((item) => item.key);
  const yAxisDomain = resolveTrendYAxisDomain(visibleData, yAxisKeys);
  const canPanChart = chartData.length > visibleData.length;
  const commitRangeByIndex = useCallback(
    (startIndex: number, endIndex: number) => {
      const start = chartData[startIndex];
      const end = chartData[endIndex];
      if (!start || !end) return;
      onRangeChange({ startDate: start.period, endDate: end.period });
    },
    [chartData, onRangeChange],
  );
  const beginChartPan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!canPanChart || (event.pointerType === 'mouse' && event.button !== 0))
        return;
      const bounds = chartPanRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const selectedPoints = Math.max(1, visibleData.length - 1);
      chartPanStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startIndex: trendRange.startIndex,
        endIndex: trendRange.endIndex,
        pointWidth: bounds.width / selectedPoints,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsChartPanning(true);
    },
    [
      canPanChart,
      trendRange.endIndex,
      trendRange.startIndex,
      visibleData.length,
    ],
  );
  const moveChartPan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = chartPanStateRef.current;
      if (!state) return;
      event.preventDefault();
      const deltaIndex = Math.round(
        (state.startX - event.clientX) / state.pointWidth,
      );
      if (deltaIndex === 0) return;
      const lastIndex = chartData.length - 1;
      const span = state.endIndex - state.startIndex;
      const nextStartIndex = clampIndex(
        state.startIndex + deltaIndex,
        0,
        lastIndex - span,
      );
      const nextEndIndex = nextStartIndex + span;
      if (
        nextStartIndex === trendRange.startIndex &&
        nextEndIndex === trendRange.endIndex
      )
        return;
      commitRangeByIndex(nextStartIndex, nextEndIndex);
    },
    [
      chartData.length,
      commitRangeByIndex,
      trendRange.endIndex,
      trendRange.startIndex,
    ],
  );
  const endChartPan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = chartPanStateRef.current;
      if (!state) return;
      if (event.currentTarget.hasPointerCapture(state.pointerId)) {
        event.currentTarget.releasePointerCapture(state.pointerId);
      }
      chartPanStateRef.current = null;
      setIsChartPanning(false);
    },
    [],
  );
  const latest = visibleData.at(-1);
  const previous = visibleData.at(-2);
  const primarySeries = visibleSeries[0] ?? series[0];
  const latestValue = Number(latest?.value);
  const previousComparisonValue =
    granularity === 'day'
      ? Number(latest?.valuePreviousWeekValue)
      : Number(previous?.value);
  const comparisonValue =
    Number.isFinite(previousComparisonValue) && previousComparisonValue > 0
      ? previousComparisonValue
      : null;
  const change =
    latest && comparisonValue && Number.isFinite(latestValue)
      ? (latestValue - comparisonValue) / comparisonValue
      : null;
  const chartConfig = series.reduce<ChartConfig>((config, item) => {
    config[item.key] = {
      label: item.label,
      color: item.color,
    };
    config[`${item.key}PreviousWeekValue`] = {
      label: `上周同日${item.label}`,
      color: '#94A3B8',
    };
    return config;
  }, {});
  const valueContext = granularity === 'week' ? '最近一周日均' : '最近一日';
  const changeContext = 'WoW';

  const controls = (
    <div className="trend-control-row">
      {metricControls}
      <div className="chart-toolbar">
        <CanvasToolbar
          granularity={granularity}
          onGranularityChange={onGranularityChange}
          onResetRange={() => commitRangeByIndex(0, chartData.length - 1)}
          showData={showData}
          onToggleData={() => setShowData((value) => !value)}
          onExport={() => downloadCsv(
            `Pollo-${metric.label}-${visibleData[0]?.period}.csv`,
            [
              ['日期', ...visibleSeries.map((item) => item.label)],
              ...visibleData.map((row) => [row.period, ...visibleSeries.map((item) => Number(row[item.key]))]),
            ],
          )}
        />
      </div>
    </div>
  );

  if (data.length === 0) {
    return <div className="grid min-w-0 gap-4">{controls}<EmptyBlock title="暂无趋势" description="当前窗口没有可展示的时间序列。" /></div>;
  }

  return (
    <div className="grid min-w-0 gap-4">
      {controls}
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 py-1">
        <div className="min-w-[220px]">
          <div className="sr-only">当前指标</div>
          <div className="sr-only">{metric.label}</div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {series.map((item) => {
                const hidden = hiddenSeriesKeys.has(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={!hidden}
                    aria-label={`${hidden ? '显示' : '隐藏'}${item.label}`}
                    data-trend-series={item.key}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-1.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
                      hidden
                        ? 'text-gray-400 hover:bg-gray-100'
                        : 'text-gray-600 hover:bg-white',
                    )}
                    onClick={() => toggleSeriesVisibility(item.key)}
                  >
                    <span
                      className={cn(
                        'h-0.5 w-6 rounded-full transition-colors',
                        hidden && 'bg-gray-300',
                      )}
                      style={{ backgroundColor: hidden ? undefined : item.color }}
                    />
                    {item.label}
                  </button>
                );
              })}
            </div>
        </div>
        <div className="trend-summary-tools">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">{valueContext}</div>
            <div className="mt-1 text-base font-medium tabular-nums text-primary">
              {latest && Number.isFinite(latestValue)
                ? metric.format(latestValue)
                : '-'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {changeContext} {formatSignedPercent(change)}
            </div>
          </div>
        </div>
      </div>
      <div
        ref={chartPanRef}
        className={cn(
          'min-w-0 touch-none rounded-2xl bg-white py-2',
          canPanChart && (isChartPanning ? 'cursor-grabbing' : 'cursor-grab'),
        )}
        onPointerDown={beginChartPan}
        onPointerMove={moveChartPan}
        onPointerUp={endChartPan}
        onPointerCancel={endChartPan}
      >
          <ChartContainer config={chartConfig} className="h-[320px] w-full">
            <LineChart
              data={visibleData}
              margin={{ left: 4, right: 16, top: 12, bottom: 4 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="#ECECF3"
                strokeDasharray="0"
              />
              <XAxis
                dataKey="period"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                minTickGap={26}
                tick={{ fill: '#747487', fontSize: 12 }}
                tickFormatter={(value: string) =>
                  formatPeriod(value, granularity)
                }
              />
              <YAxis
                domain={yAxisDomain}
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                tick={{ fill: '#747487', fontSize: 12 }}
                tickFormatter={(value: number) => primarySeries.format(value)}
                width={72}
              />
              <ChartTooltip
                cursor={{ stroke: '#9B93CF', strokeDasharray: '3 3' }}
                content={
                  <TrendTooltipContent
                    series={visibleSeries}
                    showPreviousWeekComparison={false}
                  />
                }
              />
              {visibleSeries.map((item) => (
                <Line
                  key={`${metric.key}-${granularity}-${item.key}`}
                  dataKey={item.key}
                  type="monotone"
                  stroke={item.color}
                  strokeWidth={visibleSeries.length === 1 ? 3 : 2.5}
                  dot={false}
                  activeDot={{ r: 5 }}
                  isAnimationActive={!reducedMotion}
                  animationBegin={280}
                  animationDuration={850}
                />
              ))}
            </LineChart>
          </ChartContainer>
      </div>
      {showData && (
        <div className="chart-data dashboard-enter">
          <table>
            <caption className="sr-only">当前可视范围的趋势数据</caption>
            <thead>
              <tr>
                <th>日期</th>
                {visibleSeries.map((item) => (
                  <th key={item.key}>{item.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleData.map((row) => (
                <tr key={row.period}>
                  <td>{row.period}</td>
                  {visibleSeries.map((item) => (
                    <td key={item.key}>{item.format(Number(row[item.key]))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AnimatedPopoverContent({
  children,
  className,
  align = 'end',
}: {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'center' | 'end';
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      if (!panelRef.current) return;
      gsap.fromTo(
        panelRef.current,
        { opacity: 0, y: 4 },
        { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out' },
      );
    },
    { scope: panelRef },
  );

  return (
    <PopoverContent
      align={align}
      className={cn(
        'w-auto rounded-2xl border border-[#E5E7EB] bg-white p-0 shadow-none data-[state=closed]:animate-none data-[state=open]:animate-none',
        className,
      )}
    >
      <div ref={panelRef}>{children}</div>
    </PopoverContent>
  );
}

function MetricTabs({
  value,
  onChange,
  trendUserTag,
  onTrendUserTagChange,
  planTier,
  onPlanTierChange,
}: {
  value: TrendMetricKey;
  onChange: (value: TrendMetricKey) => void;
  trendUserTag?: '新用户' | '老用户' | '未知';
  onTrendUserTagChange: (value: string) => void;
  planTier: PlanTierFilter;
  onPlanTierChange: (value: PlanTierFilter) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [openSection, setOpenSection] = useState<
    'activePayment' | 'renewal' | 'user' | 'planTier'
  >('activePayment');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activeMetric =
    TREND_NAV_METRICS.find((item) => item.key === value) ?? TREND_NAV_METRICS[0];
  useEffect(() => {
    if (!expanded) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [expanded]);
  return (
    <div
      ref={menuRef}
      className={cn('metric-menu', expanded && 'metric-menu-expanded')}
    >
      <button
        type="button"
        className="metric-menu-trigger"
        aria-expanded={expanded}
        aria-controls="metric-menu-options"
        onClick={() => setExpanded((current) => !current)}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span>{activeMetric.label}{trendUserTag && supportsTrendUserTag(value) ? ` · ${trendUserTag}` : ''}</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            id="metric-menu-options"
            className="metric-menu-options"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <button type="button" className="metric-menu-heading" aria-expanded={openSection === 'activePayment'} onClick={() => setOpenSection('activePayment')}>
              <SlidersHorizontal size={14} />主动付费<ChevronDown size={13} />
            </button>
            <AnimatePresence initial={false}>
              {openSection === 'activePayment' && (
                <motion.div className="metric-menu-list" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24 }}>
                  {ACTIVE_PAYMENT_TREND_METRICS.map((metric) => (
                    <button key={metric.key} type="button" data-trend-metric={metric.key} aria-pressed={metric.key === value} className="metric-menu-option" onClick={() => { onChange(metric.key); setExpanded(false); }}>
                      {metric.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            <button type="button" className="metric-menu-heading" aria-expanded={openSection === 'renewal'} onClick={() => setOpenSection('renewal')}>
              <RefreshCw size={14} />自动续订<ChevronDown size={13} />
            </button>
            <AnimatePresence initial={false}>
              {openSection === 'renewal' && (
                <motion.div className="metric-menu-list" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24 }}>
                  {RENEWAL_TREND_METRICS.map((metric) => (
                    <button key={metric.key} type="button" data-trend-metric={metric.key} aria-pressed={metric.key === value} className="metric-menu-option" onClick={() => { onChange(metric.key); setExpanded(false); }}>
                      {metric.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            {isRenewalTrendMetric(value) && (
              <>
                <button type="button" className="metric-menu-heading" aria-expanded={openSection === 'planTier'} onClick={() => setOpenSection('planTier')}>
                  <BarChart3 size={14} />订阅类型<ChevronDown size={13} />
                </button>
                <AnimatePresence initial={false}>
                  {openSection === 'planTier' && (
                    <motion.div className="metric-menu-list" role="group" aria-label="订阅类型" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24 }}>
                      {PLAN_TIER_OPTIONS.map((option) => (
                        <button key={option.value} type="button" className="metric-menu-option" aria-pressed={planTier === option.value} onClick={() => { onPlanTierChange(option.value); setExpanded(false); }}>
                          {option.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
            {supportsTrendUserTag(value) && (
              <>
                <button type="button" className="metric-menu-heading" aria-expanded={openSection === 'user'} onClick={() => setOpenSection('user')}>
                  <UsersRound size={14} />用户维度<ChevronDown size={13} />
                </button>
                <AnimatePresence initial={false}>
                  {openSection === 'user' && (
                    <motion.div className="metric-menu-list" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24 }}>
                      {USER_TAG_OPTIONS.map((option) => (
                        <button key={option.value} type="button" className="metric-menu-option" aria-pressed={(trendUserTag ?? 'all') === option.value} onClick={() => { onTrendUserTagChange(option.value); setExpanded(false); }}>
                          {option.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DateRangePicker({
  selectedRange,
  onRangeChange,
}: {
  selectedRange: { startDate: string; endDate: string };
  onRangeChange: (range: { startDate: string; endDate: string }) => void;
}) {
  const latestDate = dayjs().subtract(1, 'day').startOf('day');
  const minimumDate = dayjs(TREND_DATA_START_DATE).startOf('day');
  const [calendarMonth, setCalendarMonth] = useState(() =>
    dayjs(selectedRange.startDate).startOf('month'),
  );
  const [draftStart, setDraftStart] = useState(selectedRange.startDate);
  const [draftEnd, setDraftEnd] = useState(selectedRange.endDate);
  const [selecting, setSelecting] = useState<'start' | 'end'>('start');
  const [open, setOpen] = useState(false);
  const dragOriginRef = useRef<string | null>(null);
  const dragPendingRef = useRef(false);
  const dragActiveRef = useRef(false);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    setDraftStart(selectedRange.startDate);
    setDraftEnd(selectedRange.endDate);
    setCalendarMonth(dayjs(selectedRange.startDate).startOf('month'));
    setSelecting('start');
  }, [selectedRange.endDate, selectedRange.startDate]);

  useEffect(() => {
    const finishOutsideCalendar = () => {
      dragPendingRef.current = false;
      dragActiveRef.current = false;
      dragOriginRef.current = null;
    };
    document.addEventListener('pointerup', finishOutsideCalendar);
    return () => document.removeEventListener('pointerup', finishOutsideCalendar);
  }, []);

  const calendarDays = useMemo(() => {
    const first = calendarMonth.startOf('month');
    const calendarStart = first.subtract(first.day(), 'day');
    return Array.from({ length: 42 }, (_, index) =>
      calendarStart.add(index, 'day'),
    );
  }, [calendarMonth]);

  const commitRange = (startDate: string, endDate: string) => {
    setDraftStart(startDate);
    setDraftEnd(endDate);
    onRangeChange({ startDate, endDate });
    setOpen(false);
  };

  const chooseDate = (date: dayjs.Dayjs) => {
    if (date.isBefore(minimumDate) || date.isAfter(latestDate)) return;
    const value = date.format('YYYY-MM-DD');
    if (selecting === 'start') {
      setDraftStart(value);
      setDraftEnd('');
      setSelecting('end');
      return;
    }
    commitRange(
      value < draftStart ? value : draftStart,
      value < draftStart ? draftStart : value,
    );
    setSelecting('start');
  };

  const beginDateDrag = (date: dayjs.Dayjs) => {
    if (date.isBefore(minimumDate) || date.isAfter(latestDate)) return;
    const value = date.format('YYYY-MM-DD');
    dragOriginRef.current = selecting === 'end' ? draftStart : value;
    dragPendingRef.current = true;
    dragActiveRef.current = false;
    suppressClickRef.current = false;
  };

  const previewDateDrag = (date: dayjs.Dayjs) => {
    if (!dragPendingRef.current || !dragOriginRef.current) return;
    if (date.isBefore(minimumDate) || date.isAfter(latestDate)) return;
    const value = date.format('YYYY-MM-DD');
    if (value === dragOriginRef.current) return;
    dragActiveRef.current = true;
    suppressClickRef.current = true;
    if (selecting === 'start') {
      setDraftStart(dragOriginRef.current);
    }
    setDraftEnd(value);
  };

  const finishDateDrag = (date: dayjs.Dayjs) => {
    if (!dragPendingRef.current || !dragActiveRef.current || !dragOriginRef.current) return;
    const origin = dragOriginRef.current;
    const value = date.format('YYYY-MM-DD');
    dragPendingRef.current = false;
    dragActiveRef.current = false;
    dragOriginRef.current = null;
    if (!suppressClickRef.current || value === origin) return;
    const [startDate, endDate] = value < origin ? [value, origin] : [origin, value];
    commitRange(startDate, endDate);
    setSelecting('start');
  };

  const chooseQuickRange = (days: number) => {
    const end = latestDate;
    const start = end.subtract(days - 1, 'day').isBefore(minimumDate)
      ? minimumDate
      : end.subtract(days - 1, 'day');
    commitRange(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'));
    setSelecting('start');
    setCalendarMonth(start.startOf('month'));
  };

  const rangeDays = Math.max(1, dayjs(draftEnd || draftStart).diff(draftStart, 'day') + 1);
  const selectedRangeDays = Math.max(
    1,
    dayjs(selectedRange.endDate).diff(selectedRange.startDate, 'day') + 1,
  );
  const formatRangeBadge = (days: number) =>
    days === 90 ? '近一个季度' : days === 30 ? '近一个月' : days === 7 ? '近一周' : `${days}日`;
  const rangeBadge =
    selecting === 'end' ? '选择结束日期' : formatRangeBadge(rangeDays);

  return (
    <div className="date-range-controls flex flex-wrap items-end justify-end gap-2">
        <Popover
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) return;
            setDraftStart(selectedRange.startDate);
            setDraftEnd(selectedRange.endDate);
            setCalendarMonth(dayjs(selectedRange.startDate).startOf('month'));
            setSelecting('start');
          }}
        >
          <PopoverTrigger asChild>
            <button type="button" className="date-range-trigger">
              <span>
                <small>趋势日期</small>
                {formatDateRangeLabel(selectedRange)}
              </span>
              <span className="date-range-trigger-badge">
                {formatRangeBadge(selectedRangeDays)}
              </span>
            </button>
          </PopoverTrigger>
          <AnimatedPopoverContent className="date-range-popover" align="end">
            <div className="date-range-sheet">
              <div className="date-range-sheet-header">
                <strong>趋势日期</strong>
                <span>{rangeBadge}</span>
              </div>
              <div className="date-range-summary">
                <div data-active={selecting === 'start'}>
                  <small>开始</small>
                  <strong>{dayjs(draftStart).format('MM月DD日')}</strong>
                </div>
                <div data-active={selecting === 'end'}>
                  <small>结束</small>
                  <strong>{draftEnd ? dayjs(draftEnd).format('MM月DD日') : '请选择'}</strong>
                </div>
              </div>
              <div className="date-range-calendar-header">
                <button
                  type="button"
                  aria-label="上一个月"
                  disabled={!calendarMonth.isAfter(minimumDate, 'month')}
                  onClick={() => setCalendarMonth((current) => current.subtract(1, 'month'))}
                >
                  <ChevronLeft size={16} />
                </button>
                <strong>{calendarMonth.format('YYYY年 M月')}</strong>
                <button
                  type="button"
                  aria-label="下一个月"
                  disabled={!calendarMonth.isBefore(latestDate, 'month')}
                  onClick={() => setCalendarMonth((current) => current.add(1, 'month'))}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="date-range-weekdays">
                {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="date-range-days">
                {calendarDays.map((date) => {
                  const value = date.format('YYYY-MM-DD');
                  const disabled = date.isBefore(minimumDate) || date.isAfter(latestDate);
                  const boundary = value === draftStart || (Boolean(draftEnd) && value === draftEnd);
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={disabled}
                      aria-label={date.format('YYYY年M月D日')}
                      aria-pressed={boundary}
                      className={cn(
                        'date-range-day',
                        date.month() !== calendarMonth.month() && 'is-outside',
                        boundary && 'is-boundary',
                        draftStart && draftEnd && value >= draftStart && value <= draftEnd && 'is-in-range',
                      )}
                      onPointerDown={() => beginDateDrag(date)}
                      onPointerEnter={() => previewDateDrag(date)}
                      onPointerUp={() => finishDateDrag(date)}
                      onClick={() => {
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          return;
                        }
                        chooseDate(date);
                      }}
                    >
                      {date.date()}
                    </button>
                  );
                })}
              </div>
              <div className="date-range-quick-actions" aria-label="快捷范围">
                {[
                  { days: 7, label: '近一周' },
                  { days: 30, label: '近一个月' },
                  { days: 90, label: '近一个季度' },
                ].map((option) => (
                  <button
                    key={option.days}
                    type="button"
                    className={cn(
                      rangeDays === option.days && 'is-active',
                    )}
                    onClick={() => chooseQuickRange(option.days)}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="date-range-clear"
                  onClick={() => {
                    const startDate = minimumDate.format('YYYY-MM-DD');
                    const endDate = latestDate.format('YYYY-MM-DD');
                    commitRange(startDate, endDate);
                    setSelecting('start');
                    setCalendarMonth(latestDate.startOf('month'));
                  }}
                >
                  清除
                </button>
              </div>
            </div>
          </AnimatedPopoverContent>
        </Popover>
    </div>
  );
}

function GlobalDashboardControls({
  platform,
  onPlatformChange,
  onAppDeviceChange,
  deviceType,
  loading,
  onRefresh,
}: {
  platform: DashboardPlatform;
  onPlatformChange: (value: DashboardPlatform) => void;
  onAppDeviceChange: (value: DeviceFilter) => void;
  deviceType: DeviceFilter;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [platformOpen, setPlatformOpen] = useState(false);
  const [pendingPlatform, setPendingPlatform] = useState<DashboardPlatform>(platform);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => setPendingPlatform(platform), [platform]);
  useEffect(() => {
    if (!platformOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) {
        setPlatformOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [platformOpen]);

  return (
    <div ref={controlsRef} className="icon-control-bar" aria-label="看板工具">
      <div className="icon-control-wrap">
        <button
          type="button"
          className="icon-control"
          aria-expanded={platformOpen}
          aria-label={`端类型：${PLATFORM_LABELS[pendingPlatform]}`}
          title="端类型"
          onClick={() => setPlatformOpen((open) => !open)}
        >
          {pendingPlatform === 'all' ? <LayoutDashboard size={17} /> : pendingPlatform === 'web' ? <Monitor size={17} /> : <Smartphone size={17} />}
          <span className="icon-control-tooltip">端类型</span>
        </button>
        {platformOpen ? (
          <div className="icon-control-popover" role="menu" aria-label="端类型选择">
            <div className="icon-control-popover-title">端类型</div>
            {(['all', 'web', 'app'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={pendingPlatform === value}
                className={cn('icon-control-option', pendingPlatform === value && 'is-active')}
                onClick={() => {
                  setPendingPlatform(value);
                  if (value !== 'app') {
                    onPlatformChange(value);
                    setPlatformOpen(false);
                  }
                }}
              >
                {value === 'all' ? <LayoutDashboard size={15} /> : value === 'web' ? <Monitor size={15} /> : <Smartphone size={15} />}
                {PLATFORM_LABELS[value]}
              </button>
            ))}
            {pendingPlatform === 'app' ? (
              <div className="icon-control-submenu">
                <span>设备</span>
                {DEVICE_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={cn('icon-control-option', deviceType === option.value && 'is-active')}
                    onClick={() => {
                      onAppDeviceChange(option.value);
                      setPlatformOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="icon-control"
        aria-label="刷新数据"
        title="刷新数据"
        onClick={onRefresh}
        disabled={loading}
      >
        <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        <span className="icon-control-tooltip">刷新数据</span>
      </button>
    </div>
  );
}

function DashboardFilters({
  metric,
  onMetricChange,
  trendUserTag,
  onTrendUserTagChange,
  planTier,
  onPlanTierChange,
}: {
  metric: TrendMetricKey;
  onMetricChange: (value: TrendMetricKey) => void;
  trendUserTag?: '新用户' | '老用户' | '未知';
  onTrendUserTagChange: (value: string) => void;
  planTier: PlanTierFilter;
  onPlanTierChange: (value: PlanTierFilter) => void;
}) {
  return (
    <div className="min-w-0">
      <MetricTabs value={metric} onChange={onMetricChange} trendUserTag={trendUserTag} onTrendUserTagChange={onTrendUserTagChange} planTier={planTier} onPlanTierChange={onPlanTierChange} />
    </div>
  );
}

function WeekPickerPopover({
  label,
  selectedWeek,
  disabledWeek,
  weeks,
  onWeekChange,
}: {
  label: string;
  selectedWeek: string;
  disabledWeek: string;
  weeks: string[];
  onWeekChange: (week: string) => void;
}) {
  const [panelMonth, setPanelMonth] = useState(() =>
    dayjs(isValidDateParam(selectedWeek) ? selectedWeek : undefined).startOf(
      'month',
    ),
  );
  const [hoveredWeek, setHoveredWeek] = useState<string | null>(null);
  const enabledWeeks = useMemo(() => new Set(weeks), [weeks]);
  const calendarDays = useMemo(() => {
    const monthStart = panelMonth.startOf('month');
    const start = monthStart.subtract(monthStart.day(), 'day');
    return Array.from({ length: 42 }, (_, index) => start.add(index, 'day'));
  }, [panelMonth]);
  const selectedWeekEnd = dayjs(selectedWeek)
    .add(WEEK_DAYS - 1, 'day')
    .format('YYYY-MM-DD');

  useEffect(() => {
    if (isValidDateParam(selectedWeek)) {
      setPanelMonth(dayjs(selectedWeek).startOf('month'));
    }
  }, [selectedWeek]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            FILTER_PILL_CLASS,
            'min-w-[178px] justify-between gap-3 px-4 font-mono text-xs tabular-nums',
          )}
        >
          <span className="font-sans text-xs text-gray-500">{label}</span>
          <span>{formatShortWeekRange(selectedWeek)}</span>
        </button>
      </PopoverTrigger>
      <AnimatedPopoverContent className="date-range-popover week-picker-popover" align="end">
        <div className="date-range-sheet">
          <div className="date-range-sheet-header">
            <strong>{label}</strong>
            <span>仅业务周</span>
          </div>
          <div className="date-range-calendar-header">
            <button
              type="button"
              aria-label="上一个月"
              className="rounded-full text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              onClick={() =>
                setPanelMonth((current) => current.subtract(1, 'month'))
              }
            >
              <ChevronLeft size={16} />
            </button>
            <strong>
              {panelMonth.format('YYYY年 M月')}
            </strong>
            <button
              type="button"
              aria-label="下一个月"
              className="rounded-full text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              onClick={() =>
                setPanelMonth((current) => current.add(1, 'month'))
              }
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="date-range-weekdays">
            {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div
            className="date-range-days"
            onMouseLeave={() => setHoveredWeek(null)}
          >
            {calendarDays.map((day) => {
              const dayValue = day.format('YYYY-MM-DD');
              const weekStart = getBusinessWeekStart(dayValue);
              const inPanelMonth = day.month() === panelMonth.month();
              const isEnabled =
                (enabledWeeks.size === 0 || enabledWeeks.has(weekStart)) &&
                weekStart !== disabledWeek;
              const isSelected = weekStart === selectedWeek;
              const isHovered = hoveredWeek === weekStart;
              const weekEnd = dayjs(weekStart).add(WEEK_DAYS - 1, 'day').format('YYYY-MM-DD');
              const isBoundary = isSelected && (dayValue === weekStart || dayValue === weekEnd);
              const isIncomplete = isIncompleteAttributionWeek(weekStart);
              return (
                <button
                  key={dayValue}
                  type="button"
                  disabled={!isEnabled}
                  className={cn(
                    'date-range-day',
                    !inPanelMonth && 'is-outside',
                    (isHovered || isSelected) && 'is-in-range',
                    isBoundary && 'is-boundary',
                    !isEnabled && 'cursor-not-allowed opacity-30',
                  )}
                  onMouseEnter={() => setHoveredWeek(weekStart)}
                  onClick={() => onWeekChange(weekStart)}
                  title={
                    isIncomplete
                      ? `${formatWeekRange(weekStart)}（进行中）`
                      : formatWeekRange(weekStart)
                  }
                >
                  {day.date()}
                </button>
              );
            })}
          </div>
          <div className="date-range-summary">
            <span>已选业务周</span>
            <strong className="font-mono">
              {dayjs(selectedWeek).format('MM/DD')} -{' '}
              {dayjs(selectedWeekEnd).format('MM/DD')}
            </strong>
          </div>
        </div>
      </AnimatedPopoverContent>
    </Popover>
  );
}

function WeekComparisonSelector({
  baselineWeek,
  analysisWeek,
  comparison,
  weeks,
  onChange,
  chainType,
  onChainTypeChange,
  planTier,
  onPlanTierChange,
}: {
  baselineWeek: string;
  analysisWeek: string;
  comparison: DashboardAttributionsResponse['comparison'] | null;
  weeks: string[];
  onChange: (updates: { baselineWeek?: string; analysisWeek?: string }) => void;
  chainType?: PaymentChainType;
  onChainTypeChange?: (value: PaymentChainType) => void;
  planTier?: PlanTierFilter;
  onPlanTierChange?: (value: PlanTierFilter) => void;
}) {
  const options =
    weeks.length > 0
      ? [...new Set(weeks)].sort()
      : [baselineWeek, analysisWeek].filter(Boolean).sort();
  return (
    <section className="dashboard-panel !py-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-5">
          {chainType && onChainTypeChange ? (
            <div className="chain-type-filter">
              <span>支付链路</span>
              <div role="group" aria-label="支付链路类型">
                {([
                  ['active', '主动付费'],
                  ['renewal', '自动续订'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={chainType === value}
                    onClick={() => onChainTypeChange(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {chainType === 'renewal' && planTier && onPlanTierChange ? (
            <div className="chain-type-filter">
              <span>订阅类型</span>
              <div role="group" aria-label="订阅类型">
                {PLAN_TIER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={planTier === option.value}
                    onClick={() => onPlanTierChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div>
          <div
            className="text-xs text-slate-500"
            title="未结束业务周按截至昨日的已发生业务日对比上周同期；完整周按全周日均对比。"
          >
            归因业务周 · 周六至周五
          </div>
          <div className="mt-1 text-[11px] text-blue-700">
            {formatComparisonMode(comparison)}
          </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <WeekPickerPopover
            label="基准周"
            selectedWeek={baselineWeek}
            disabledWeek={analysisWeek}
            weeks={options}
            onWeekChange={(value) => onChange({ baselineWeek: value })}
          />
          <WeekPickerPopover
            label="分析周"
            selectedWeek={analysisWeek}
            disabledWeek={baselineWeek}
            weeks={options}
            onWeekChange={(value) => onChange({ analysisWeek: value })}
          />
        </div>
      </div>
    </section>
  );
}

function ContributionTable({
  section,
  comparison,
  selectedKey,
  onSelectItem,
  expandedSection,
  expandedSelectedKey,
  onSelectExpandedItem,
  onClearExpandedSelection,
  onOpenChainAttribution,
}: {
  section: AttributionSection;
  comparison: DashboardAttributionsResponse['comparison'];
  selectedKey?: string;
  onSelectItem?: (key: string) => void;
  expandedSection?: AttributionSection | null;
  expandedSelectedKey?: string;
  onSelectExpandedItem?: (key: string) => void;
  onClearExpandedSelection?: () => void;
  onOpenChainAttribution?: (chainType: PaymentChainType) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  if (section.items.length === 0) {
    return (
      <EmptyBlock
        title="暂无归因数据"
        description="当前比较窗口内没有可展示的归因结果。"
      />
    );
  }

  const changeLabel = getChangeColumnLabel(comparison);
  const isPrimary = section.title.includes('一级');
  const analysisTotal = section.items.reduce((total, item) => total + item.analysisDailyAvg, 0);
  const baselineTotal = section.items.reduce((total, item) => total + item.baselineDailyAvg, 0);
  const totalWowChange = baselineTotal
    ? (analysisTotal - baselineTotal) / baselineTotal
    : null;
  const firstShare = analysisTotal ? section.items[0].analysisDailyAvg / analysisTotal * 100 : 0;
  return (
    <div className="payment-section">
      <div className="payment-section-heading">
        <SectionHeaderLine title={section.title} description={section.description} />
        <button type="button" onClick={() => setShowDetails((current) => !current)}>{showDetails ? '返回概览' : '查看明细'}<ChevronRight size={15} aria-hidden="true" /></button>
      </div>
      <AnimatePresence mode="wait" initial={false}>
      {showDetails ? (
      <motion.div key="details" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.24 }}>
      <div className="hidden overflow-hidden rounded-2xl bg-white lg:block">
        <Table className="dashboard-data-table w-full table-fixed [&_th]:whitespace-normal">
          <TableHeader className="[&_tr]:border-gray-100">
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="w-[26%]">指标</TableHead>
              <TableHead className="w-[21%] text-right">
                基准期日均值
                <div className="text-[11px] font-normal text-muted-foreground">
                  {comparison?.baselinePeriod ?? '-'}
                </div>
              </TableHead>
              <TableHead className="w-[21%] text-right">
                分析期日均值
                <div className="text-[11px] font-normal text-muted-foreground">
                  {comparison?.analysisPeriod ?? '-'}
                </div>
              </TableHead>
              <TableHead className="w-[13%] text-right">
                {changeLabel}
              </TableHead>
              <TableHead className="w-[13%] text-right">贡献度</TableHead>
              {onSelectItem ? (
                <TableHead className="w-[6%] text-right">下钻</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.items.flatMap((item) => {
              const isSelected = item.key === selectedKey;
              const rows = [
                <ContributionRow
                  key={item.key}
                  item={item}
                  valueLabel={section.valueLabel}
                  selected={isSelected}
                  onSelect={onSelectItem}
                />,
              ];
              if (isSelected && expandedSection) {
                rows.push(
                  <TableRow
                    key={`${item.key}-expanded`}
                    className="border-0 hover:bg-transparent"
                  >
                    <TableCell colSpan={onSelectItem ? 6 : 5} className="p-0">
                      <InlineContributionTable
                        section={expandedSection}
                        comparison={comparison}
                        selectedKey={expandedSelectedKey}
                        onSelectItem={onSelectExpandedItem}
                        onClearSelection={onClearExpandedSelection}
                      />
                    </TableCell>
                  </TableRow>,
                );
              }
              return rows;
            })}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 lg:hidden">
        {section.items.map((item) => {
          const isSelected = item.key === selectedKey;
          return (
            <div key={item.key} className="rounded-2xl bg-gray-50">
              <ContributionMobileRow
                item={item}
                valueLabel={section.valueLabel}
                changeLabel={changeLabel}
                selected={isSelected}
                onSelect={onSelectItem}
              />
              {isSelected && expandedSection ? (
                <InlineContributionTable
                  section={expandedSection}
                  comparison={comparison}
                  selectedKey={expandedSelectedKey}
                  onSelectItem={onSelectExpandedItem}
                  onClearSelection={onClearExpandedSelection}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      </motion.div>
      ) : (
      <motion.div key="summary" className={cn('payment-summary', isPrimary && 'payment-summary-primary')} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.24 }}>
        {isPrimary && (
          <div className="payment-donut-wrap">
            <div className="payment-donut-graphic">
              <svg className="payment-donut" viewBox="0 0 160 160" role="img" aria-label="分析期日均 GMV 付费类型结构">
                <circle className="payment-donut-base" cx="80" cy="80" r="61" fill="none" strokeWidth="18" />
                {section.items.slice(0, 2).map((item, index) => {
                  const share = analysisTotal ? item.analysisDailyAvg / analysisTotal * 100 : 0;
                  return (
                    <circle
                      key={item.key}
                      className="payment-donut-segment"
                      data-index={index}
                      data-active={hoveredSegment === index}
                      cx="80" cy="80" r="61" fill="none" strokeWidth="18" pathLength="100"
                      strokeDasharray={`${share} ${100 - share}`}
                      strokeDashoffset={index === 0 ? 0 : 100 - firstShare}
                      transform="rotate(-90 80 80)"
                      aria-label={`${item.key}，分析期日均 ${formatContributionValue(item.analysisDailyAvg, section.valueLabel)}，占比 ${share.toFixed(1)}%`}
                      onMouseEnter={() => setHoveredSegment(index)}
                      onMouseLeave={() => setHoveredSegment(null)}
                    />
                  );
                })}
              </svg>
              {hoveredSegment !== null && section.items[hoveredSegment] && (
                <div className="payment-donut-tooltip" role="tooltip">
                  <strong>{section.items[hoveredSegment].key}</strong>
                  <span>{formatContributionValue(section.items[hoveredSegment].analysisDailyAvg, section.valueLabel)} · {analysisTotal ? (section.items[hoveredSegment].analysisDailyAvg / analysisTotal * 100).toFixed(1) : '0.0'}%</span>
                </div>
              )}
            </div>
            <div className="payment-donut-copy">
              <span>分析期日均 GMV</span>
              <div className="payment-donut-total">
                <strong>{formatContributionValue(analysisTotal, section.valueLabel)}</strong>
                <span>周环比 {formatSignedPercent(totalWowChange)}</span>
              </div>
              <small>基准期 {formatContributionValue(baselineTotal, section.valueLabel)}</small>
              <div className="payment-donut-legend">
                {section.items.map((item, index) => <span key={item.key}><i data-index={index} />{item.key} {analysisTotal ? (item.analysisDailyAvg / analysisTotal * 100).toFixed(0) : 0}%</span>)}
              </div>
            </div>
          </div>
        )}
        <div className="payment-summary-items">
          {section.items.map((item, index) => {
            const contribution = item.contribution ?? 0;
            const wowChange = item.wowChange ?? 0;
            const itemChainType: PaymentChainType = item.key.includes('续订') ? 'renewal' : 'active';
            return (
              <div key={item.key} className="payment-summary-item">
                <div className="payment-summary-item-head" data-index={index}>
                  <span>{item.key}</span>
                  {isPrimary && onOpenChainAttribution ? (
                    <motion.button
                      type="button"
                      className="payment-chain-link"
                      onClick={() => onOpenChainAttribution(itemChainType)}
                      whileHover={{ x: 2 }}
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.16 }}
                      aria-label={`查看${item.key}链路归因`}
                    >
                      <Route size={13} aria-hidden="true" />
                      <span>链路归因</span>
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </motion.button>
                  ) : null}
                </div>
                <div className="payment-summary-item-body">
                  <div className="payment-summary-main">
                    <strong>{formatContributionValue(item.analysisDailyAvg, section.valueLabel)}</strong>
                    <span className={cn('payment-summary-wow', wowChange > 0 && 'is-positive', wowChange < 0 && 'is-negative')}>
                      {wowChange > 0 ? <TrendingUp size={14} aria-hidden="true" /> : wowChange < 0 ? <TrendingDown size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
                      <span>周环比</span>
                      <b>{formatSignedPercent(item.wowChange)}</b>
                    </span>
                  </div>
                  <div className="payment-summary-baseline">基准期 {formatContributionValue(item.baselineDailyAvg, section.valueLabel)}</div>
                  <span className="payment-summary-track"><span className={contribution < 0 ? 'is-negative' : ''} style={{ width: `${Math.min(100, Math.abs(contribution) * 100)}%` }} /></span>
                  <div className="payment-summary-contribution">
                    <span>贡献度</span>
                    <span className={cn('payment-summary-contribution-value', contribution < 0 ? 'is-negative' : 'is-positive')}>{formatSignedPercent(item.contribution)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

function ContributionMobileRow({
  item,
  valueLabel,
  changeLabel,
  selected,
  onSelect,
}: {
  item: AttributionItem;
  valueLabel: string;
  changeLabel: string;
  selected?: boolean;
  onSelect?: (key: string) => void;
}) {
  const label = item.key.startsWith('create_cnt_30d_')
    ? formatTierLabel(item.key)
    : item.key;
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-left">
          {onSelect ? (
            <span
              className={cn(
                'inline-flex size-5 shrink-0 items-center justify-center rounded-full border',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-transparent',
              )}
              aria-hidden="true"
            >
              <Check className="size-3" />
            </span>
          ) : null}
          <span className="truncate font-medium text-foreground">{label}</span>
        </div>
        {onSelect ? (
          <span className="shrink-0 text-xs text-primary">
            {selected ? '收起下钻' : '点击下钻'}
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-left">
        <div>
          <div className="text-[11px] text-muted-foreground">基准期日均值</div>
          <div className="mt-1 font-mono text-sm text-muted-foreground">
            {formatContributionValue(item.baselineDailyAvg, valueLabel)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">分析期日均值</div>
          <div className="mt-1 font-mono text-sm text-foreground">
            {formatContributionValue(item.analysisDailyAvg, valueLabel)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">{changeLabel}</div>
          <div className="mt-1 text-sm text-foreground">
            {formatSignedPercent(item.wowChange)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">贡献度</div>
          <div
            className={cn(
              'mt-1 font-mono text-sm',
              (item.contribution ?? 0) >= 0
                ? 'text-success'
                : 'text-destructive',
            )}
          >
            {formatSignedPercent(item.contribution)}
          </div>
        </div>
      </div>
    </>
  );

  if (!onSelect) {
    return <div className="px-4 py-4">{content}</div>;
  }
  return (
    <button
      type="button"
      className={cn(
        'w-full rounded-2xl px-4 py-4 text-left transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-inset',
        selected && 'bg-blue-50',
      )}
      aria-pressed={selected}
      onClick={() => onSelect(item.key)}
    >
      {content}
    </button>
  );
}

function InlineContributionTable({
  section,
  comparison,
  selectedKey,
  onSelectItem,
  onClearSelection,
}: {
  section: AttributionSection;
  comparison: DashboardAttributionsResponse['comparison'];
  selectedKey?: string;
  onSelectItem?: (key: string) => void;
  onClearSelection?: () => void;
}) {
  if (section.items.length === 0) {
    return (
      <div className="px-4 py-5 md:px-6">
        <div className={cn(SUBSURFACE_CLASS, 'text-sm text-muted-foreground')}>
          当前分层暂无可用的用户类型数据。
        </div>
      </div>
    );
  }

  const changeLabel = getChangeColumnLabel(comparison);

  return (
    <div className="px-4 py-5 md:px-6" data-testid="chain-user-drilldown">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-primary">
            当前分层继续下钻
          </div>
          <div className="mt-1 text-base font-medium text-foreground">
            新老用户 GMV 贡献
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-full border border-gray-200 px-4 py-1.5 text-gray-700 hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-600"
          onClick={onClearSelection}
        >
          全部用户
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {section.items.map((item) => {
          const selected = item.key === selectedKey;
          return (
            <button
              key={item.key}
              type="button"
              className={cn(
                'group rounded-2xl bg-gray-50 p-6 text-left transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
                selected && 'ring-2 ring-blue-600',
              )}
              aria-pressed={selected}
              onClick={() => onSelectItem?.(item.key)}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-foreground">{formatTierLabel(item.key)}</span>
                {selected ? <Check className="size-4 text-primary" /> : null}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] text-muted-foreground">
                    基准期日均值
                  </div>
                  <div className="mt-1 font-mono text-sm text-muted-foreground">
                    {formatContributionValue(
                      item.baselineDailyAvg,
                      section.valueLabel,
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">
                    分析期日均值
                  </div>
                  <div className="mt-1 font-mono text-sm text-foreground">
                    {formatContributionValue(
                      item.analysisDailyAvg,
                      section.valueLabel,
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">
                    {changeLabel}
                  </div>
                  <div className="mt-1 text-sm text-foreground">
                    {formatSignedPercent(item.wowChange)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">
                    贡献度
                  </div>
                  <div
                    className={cn(
                      'mt-1 font-mono text-sm',
                      (item.contribution ?? 0) >= 0
                        ? 'text-success'
                        : 'text-destructive',
                    )}
                  >
                    {formatSignedPercent(item.contribution)}
                  </div>
                </div>
              </div>
              <span className="mt-4 inline-flex rounded-full border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-700 transition-colors group-hover:bg-gray-100">
                查看该用户类型链路
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChainUserList({
  section,
  selected,
  onSelect,
}: {
  section: AttributionSection;
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="chain-user-list" aria-label="新老用户 GMV 贡献">
      <button type="button" className="chain-user-row" aria-pressed={selected === 'all'} onClick={() => onSelect('all')}>
        <span>全部用户</span><span>—</span><span>—</span><span>—</span><strong>整体</strong>
      </button>
      {section.items.map((item) => {
        const delta = item.analysisDailyAvg - item.baselineDailyAvg;
        return (
          <button key={item.key} type="button" className="chain-user-row" aria-pressed={selected === item.key} onClick={() => onSelect(item.key)}>
            <span>{formatTierLabel(item.key)}</span>
            <span>{formatContributionValue(item.baselineDailyAvg, section.valueLabel)}</span>
            <span>{formatContributionValue(item.analysisDailyAvg, section.valueLabel)}</span>
            <span>{delta >= 0 ? '+' : '−'}{formatContributionValue(Math.abs(delta), section.valueLabel)}</span>
            <strong className={(item.contribution ?? 0) < 0 ? 'text-red-600' : 'text-emerald-700'}>{formatSignedPercent(item.contribution)}</strong>
          </button>
        );
      })}
    </div>
  );
}

function ContributionRow({
  item,
  valueLabel,
  selected,
  onSelect,
}: {
  item: AttributionItem;
  valueLabel: string;
  selected?: boolean;
  onSelect?: (key: string) => void;
}) {
  const label = item.key.startsWith('create_cnt_30d_')
    ? formatTierLabel(item.key)
    : item.key;
  return (
    <TableRow
      data-selected={selected || undefined}
      aria-selected={selected}
      className={cn(
        'border-gray-100 hover:bg-gray-50',
        onSelect ? 'cursor-pointer' : undefined,
        selected && 'bg-blue-50',
      )}
      tabIndex={onSelect ? 0 : undefined}
      onClick={() => onSelect?.(item.key)}
      onKeyDown={(event) => {
        if (onSelect && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onSelect(item.key);
        }
      }}
    >
      <TableCell className="font-medium text-foreground">
        <div className="flex items-center gap-2">
          {onSelect ? (
            <span
              className={cn(
                'inline-flex size-5 shrink-0 items-center justify-center rounded-full border',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-transparent',
              )}
              aria-hidden="true"
            >
              <Check className="size-3" />
            </span>
          ) : null}
          <span>{label}</span>
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-sm text-muted-foreground">
        {formatContributionValue(item.baselineDailyAvg, valueLabel)}
      </TableCell>
      <TableCell className="text-right font-mono text-sm text-foreground">
        {formatContributionValue(item.analysisDailyAvg, valueLabel)}
      </TableCell>
      <TableCell className="text-right text-sm text-foreground">
        {formatSignedPercent(item.wowChange)}
      </TableCell>
      <TableCell
        className={cn(
          'text-right font-mono text-sm',
          (item.contribution ?? 0) >= 0 ? 'text-success' : 'text-destructive',
        )}
      >
        {formatSignedPercent(item.contribution)}
      </TableCell>
      {onSelect ? (
        <TableCell className="text-right text-xs text-primary">
          {selected ? '收起' : '查看'}
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function DriverTable({
  drivers,
  comparison,
  outcomeType,
}: {
  drivers: AttributionDriverItem[];
  comparison: DashboardAttributionsResponse['comparison'];
  outcomeType: PaymentChainType;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const channelRef = useRef<HTMLDivElement | null>(null);
  const channelsVisible = useInView(channelRef, { once: true, amount: 0.2 });
  if (drivers.length === 0) {
    return (
      <EmptyBlock
        title="暂无链路拆解"
        description="当前比较窗口内没有可展示的链路驱动指标。"
      />
    );
  }

  const changeLabel = getChangeColumnLabel(comparison);
  const maxAbsoluteContribution = Math.max(...drivers.map((driver) => Math.abs(driver.contribution ?? 0)), 0.01);
  const outcomeDefinition = outcomeType === 'renewal'
    ? { label: '自动续订 GMV', keys: ['expireUserCnt', 'renewalRate', 'renewalAov'] }
    : { label: '主动付费 GMV', keys: ['activeUv', 'subExposeRate', 'subSubmitRate', 'chainPaySuccessRate', 'chainArppu'] };
  const outcomeFactors = outcomeDefinition.keys.map((key) => drivers.find((driver) => driver.metricKey === key));
  const outcome = outcomeFactors.every((factor) => factor !== undefined)
    ? {
        value: outcomeFactors.reduce((product, factor) => product * factor!.value, 1),
        previousValue: outcomeFactors.reduce((product, factor) => product * factor!.previousValue, 1),
      }
    : null;
  const outcomeChange = outcome ? outcome.value - outcome.previousValue : 0;
  const outcomeWow = outcome && outcome.previousValue > 0
    ? outcomeChange / outcome.previousValue
    : null;

  return (
    <div className="driver-panel">
      <div className="driver-panel-header">
        <strong>归因贡献度</strong>
        <button type="button" onClick={() => setShowDetails((current) => !current)} aria-label={showDetails ? '返回归因条形图' : '查看链路明细'}>
          {showDetails ? '返回图表' : '查看明细'}
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
      <AnimatePresence mode="wait" initial={false}>
      {!showDetails ? (
      <motion.div key="bars" initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 14 }} transition={{ duration: 0.24 }}>
      <div ref={channelRef} className={cn('driver-channels', channelsVisible && 'is-revealed')} role="table" aria-label="链路指标归因贡献度">
        <div className="driver-channel-head" role="row">
          <span role="columnheader">指标</span>
          <span role="columnheader">分析期日均值</span>
          <span role="columnheader">周环比</span>
          <span role="columnheader">贡献度</span>
          <span role="columnheader">贡献度对比</span>
        </div>
        {outcome && (
          <div className="driver-channel driver-channel-outcome" role="row">
            <strong className="driver-channel-label" role="cell">{outcomeDefinition.label}</strong>
            <strong className="driver-channel-value" role="cell">{formatCurrency(outcome.value)}</strong>
            <strong className={cn('driver-channel-wow', outcomeChange < 0 ? 'is-negative' : 'is-positive')} role="cell">{formatSignedPercent(outcomeWow)}</strong>
            <span className="driver-channel-outcome-tag" role="cell">结果指标</span>
            <span className="driver-channel-baseline" role="cell">基准期日均 {formatCurrency(outcome.previousValue)}</span>
          </div>
        )}
        {drivers.map((driver, index) => {
          const contribution = driver.contribution ?? 0;
          const width = Math.abs(contribution) / maxAbsoluteContribution * 50;
          return (
            <div
              key={`${driver.tier}-${driver.userTag}-${driver.metricKey}`}
              className="driver-channel"
              role="row"
              style={{
                '--channel-index': index,
                '--channel-color': contribution < 0 ? '#C4515B' : '#5B3FF2',
              } as React.CSSProperties}
            >
              <span className="driver-channel-label" role="cell">{driver.metric}</span>
              <strong className="driver-channel-value" role="cell">{formatMetricByKey(driver.metricKey, driver.value)}</strong>
              <span className="driver-channel-wow" role="cell">{formatSignedPercent(driver.wowChange)}</span>
              <strong className={cn('driver-channel-contribution', contribution < 0 ? 'is-negative' : 'is-positive')} role="cell">{formatSignedPercent(driver.contribution)}</strong>
              <span className="driver-channel-track" role="cell" tabIndex={0} aria-describedby={`driver-tip-${index}`}>
                <span className={cn('driver-channel-fill', contribution < 0 && 'is-negative')} style={{ width: `${width}%` }} />
                <span className="driver-channel-tooltip" id={`driver-tip-${index}`} role="tooltip">
                  <span>贡献度 {formatSignedPercent(driver.contribution)}</span>
                </span>
              </span>
            </div>
          );
        })}
      </div>
      </motion.div>
      ) : (
      <motion.div key="details" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.24 }}>
      <div className="driver-detail-list">
        <div className="driver-detail-caption">
          <span>链路指标明细</span>
          <span>{comparison?.baselinePeriod ?? '-'} → {comparison?.analysisPeriod ?? '-'}</span>
        </div>
        {outcome && (
          <div className="driver-detail-row driver-detail-outcome">
            <div className="driver-detail-main"><strong>{outcomeDefinition.label}</strong><span>基准期 {formatCurrency(outcome.previousValue)}</span></div>
            <div className="driver-detail-result"><strong>{formatCurrency(outcome.value)}</strong><span>增量 {outcomeChange >= 0 ? '+' : ''}{formatCurrency(outcomeChange)} · {changeLabel} {formatSignedPercent(outcomeWow)}</span></div>
            <div className="driver-detail-outcome-tag">结果指标</div>
          </div>
        )}
        {drivers.map((driver) => (
          <div
            key={`${driver.tier}-${driver.userTag}-${driver.metricKey}`}
            className="driver-detail-row"
          >
            <div className="driver-detail-main">
              <strong>{driver.metric}</strong>
              <span>基准期 {formatMetricByKey(driver.metricKey, driver.previousValue)}</span>
            </div>
            <div className="driver-detail-result">
              <strong>{formatMetricByKey(driver.metricKey, driver.value)}</strong>
              <span>增量 {formatSignedMetricByKey(driver.metricKey, driver.change)} · {changeLabel} {formatSignedPercent(driver.wowChange)}</span>
            </div>
            <div className={cn('driver-detail-contribution', (driver.contribution ?? 0) < 0 ? 'is-negative' : 'is-positive')}>
              <span>贡献度</span><strong>{formatSignedPercent(driver.contribution)}</strong>
            </div>
          </div>
        ))}
      </div>
      </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

function CreativeMetricsTable({
  data,
}: {
  data: DashboardAttributionsResponse;
}) {
  if (data.items.length === 0) {
    return (
      <EmptyBlock
        title="暂无创作数据"
        description="当前比较窗口内没有创作分层的原子指标。"
      />
    );
  }

  const currentTotals = aggregateCreativeMetrics(data.items, 'current');
  const previousTotals = aggregateCreativeMetrics(data.items, 'previous');
  const changeLabel = getChangeColumnLabel(data.comparison);

  return (
    <div className="grid min-w-0 gap-7 [&>*]:min-w-0">
      <div>
        <SectionHeaderLine
          title="总体创作积极性"
          description="先看全量用户的创作活跃变化，再下钻到创作分层。"
          count={CREATIVE_METRICS.length}
        />
        <div className="overflow-hidden rounded-2xl bg-white">
          <Table className="dashboard-data-table min-w-[760px]">
            <TableHeader className="[&_tr]:border-gray-100">
              <TableRow className="bg-gray-50 hover:bg-gray-50">
                <TableHead>指标</TableHead>
                <TableHead className="text-right">
                  基准期值
                  <div className="text-[11px] font-normal text-muted-foreground">
                    {data.comparison?.baselinePeriod ?? '-'}
                  </div>
                </TableHead>
                <TableHead className="text-right">
                  分析期值
                  <div className="text-[11px] font-normal text-muted-foreground">
                    {data.comparison?.analysisPeriod ?? '-'}
                  </div>
                </TableHead>
                <TableHead className="text-right">{changeLabel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CREATIVE_METRICS.map((metricKey) => {
                const previousValue = previousTotals[metricKey];
                const value = currentTotals[metricKey];
                const change = value - previousValue;
                const wowChange =
                  previousValue > 0 ? change / previousValue : null;
                return (
                  <TableRow
                    key={metricKey}
                    className="border-gray-100 hover:bg-gray-50"
                  >
                    <TableCell className="font-medium text-foreground">
                      {data.metricLabels[metricKey] ?? metricKey}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {formatMetricByKey(metricKey, previousValue)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-foreground">
                      {formatMetricByKey(metricKey, value)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-foreground">
                      {formatSignedPercent(wowChange)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div>
        <SectionHeaderLine
          title="创作分层"
          description="每行展示分析期值，括号内为相对基准期的变化。"
          count={data.items.length}
        />
        <div className="max-h-[620px] overflow-auto rounded-2xl bg-white">
          <Table className="dashboard-data-table min-w-[1020px]">
            <TableHeader className="[&_tr]:border-gray-100">
              <TableRow className="bg-gray-50 hover:bg-gray-50">
                <TableHead>创作分层</TableHead>
                {CREATIVE_METRICS.map((metricKey) => (
                  <TableHead key={metricKey} className="text-right">
                    {data.metricLabels[metricKey] ?? metricKey}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => (
                <TableRow
                  key={item.key}
                  className="border-gray-100 hover:bg-gray-50"
                >
                  <TableCell className="font-medium text-foreground">
                    {formatTierLabel(item.key)}
                  </TableCell>
                  {CREATIVE_METRICS.map((metricKey) => {
                    const previousValue = getCreativeMetricValue(
                      item,
                      metricKey,
                      'previous',
                    );
                    const value = getCreativeMetricValue(
                      item,
                      metricKey,
                      'current',
                    );
                    const change = value - previousValue;
                    const wowChange =
                      previousValue > 0 ? change / previousValue : null;
                    return (
                      <TableCell
                        key={metricKey}
                        className="text-right font-mono text-sm"
                      >
                        <div className="text-foreground">
                          {formatMetricByKey(metricKey, value)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {formatSignedPercent(wowChange)}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function SectionHeaderLine({
  title,
  description,
  count,
  hint,
  badge,
}: {
  title: string;
  description?: string;
  count?: number;
  hint?: string;
  badge?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-medium text-gray-900">{title}</h3>
          {badge}
          {hint ? (
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              {hint}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {typeof count === 'number' ? (
        <Badge variant="outline" className="rounded-full bg-gray-50">
          {count} 项
        </Badge>
      ) : null}
    </div>
  );
}

const DashboardPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = dashboardView('/', searchParams.toString());
  const activeTab = view.id;
  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(
    null,
  );
  const [cardTrend, setCardTrend] = useState<OverviewTrendPoint[]>([]);
  const [gmvCoverage, setGmvCoverage] =
    useState<DashboardGmvCoverageResponse | null>(null);
  const [attributions, setAttributions] = useState<{
    payType: DashboardAttributionsResponse | null;
    chain: DashboardAttributionsResponse | null;
    creative: DashboardAttributionsResponse | null;
  }>({
    payType: null,
    chain: null,
    creative: null,
  });
  const [syncRun, setSyncRun] = useState<SyncRunStatus | null>(null);
  const [loadingBySection, setLoadingBySection] = useState<
    Record<DashboardLoadKey, boolean>
  >({ ...INITIAL_LOADING_STATE });
  const [loadErrors, setLoadErrors] = useState<
    Partial<Record<DashboardLoadKey, string>>
  >({});
  const [refreshToken, setRefreshToken] = useState(0);
  const requestCacheRef = useRef<Map<string, Promise<unknown>>>(new Map());

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const defaultWeeks = getDefaultWeekSelection();
    let changed = false;
    if (!next.get('platform')) {
      next.set('platform', 'web');
      changed = true;
    }
    if (!next.get('granularity')) {
      next.set('granularity', 'day');
      changed = true;
    }
    if (!next.get('metric') || ['totalGmv', 'gmv'].includes(next.get('metric')!)) {
      next.set('metric', 'activeGmv');
      changed = true;
    }
    const deviceType = next.get('deviceType');
    if (
      (next.get('platform') !== 'app' && deviceType) ||
      (deviceType && deviceType !== 'ios' && deviceType !== 'android')
    ) {
      next.delete('deviceType');
      changed = true;
    }
    if (next.has('trendDrill')) {
      next.delete('trendDrill');
      changed = true;
    }
    const baselineWeek = next.get('baselineWeek');
    const analysisWeek = next.get('analysisWeek');
    const hasValidComparison =
      isSelectableWeekParam(baselineWeek) &&
      isSelectableWeekParam(analysisWeek) &&
      baselineWeek !== analysisWeek;
    if (!hasValidComparison) {
      next.set('baselineWeek', defaultWeeks.baselineWeek);
      changed = true;
      next.set('analysisWeek', defaultWeeks.analysisWeek);
      changed = true;
    }
    if (changed) {
      startTransition(() => setSearchParams(next, { replace: true }));
    }
  }, [searchParams, setSearchParams]);

  const platform = (
    searchParams.get('platform') === 'all'
      ? 'all'
      : searchParams.get('platform') === 'app'
        ? 'app'
        : 'web'
  ) as DashboardPlatform;
  const deviceTypeParam = searchParams.get('deviceType');
  const deviceType: DeviceFilter =
    platform === 'app' &&
    (deviceTypeParam === 'ios' || deviceTypeParam === 'android')
      ? deviceTypeParam
      : 'all';
  const effectiveDeviceType = deviceType === 'all' ? undefined : deviceType;
  const granularity = (
    searchParams.get('granularity') === 'day' ? 'day' : 'week'
  ) as Granularity;
  const trendMetricKey = normalizeTrendMetricKey(searchParams.get('metric'));
  const trendMetric =
    TREND_NAV_METRICS.find((metric) => metric.key === trendMetricKey) ??
    TREND_NAV_METRICS[0];
  const planTierParam = searchParams.get('planTier')?.toUpperCase();
  const planTier: PlanTierFilter =
    planTierParam === 'LITE' || planTierParam === 'PRO' || planTierParam === 'ULTRA'
      ? planTierParam
      : 'all';
  const chainType: PaymentChainType =
    searchParams.get('chainType') === 'renewal' ? 'renewal' : 'active';
  const defaultWeeks = useMemo(() => getDefaultWeekSelection(), []);
  const baselineWeekParam = searchParams.get('baselineWeek');
  const analysisWeekParam = searchParams.get('analysisWeek');
  const baselineWeek = isSelectableWeekParam(baselineWeekParam)
    ? baselineWeekParam
    : defaultWeeks.baselineWeek;
  const analysisWeek = isSelectableWeekParam(analysisWeekParam)
    ? analysisWeekParam
    : defaultWeeks.analysisWeek;
  const creationTierParam = searchParams.get('creationTier');
  const creationTier =
    creationTierParam &&
    (creationTierParam === 'all' ||
      Object.prototype.hasOwnProperty.call(
        CREATIVE_TIER_LABELS,
        creationTierParam,
      ))
      ? creationTierParam
      : undefined;
  const chainUserTagParam = isUserTag(searchParams.get('userTag'))
    ? searchParams.get('userTag')
    : 'all';
  const trendUserTagParam = searchParams.get('trendUserTag');
  const trendUserTag = isUserTag(trendUserTagParam)
    ? trendUserTagParam
    : undefined;
  const effectiveTrendUserTag = supportsTrendUserTag(trendMetric.key)
    ? trendUserTag
    : undefined;
  const trendYearOptions = useMemo(() => getTrendYearOptions(), []);
  const trendYearParam = searchParams.get('trendYear');
  const defaultTrendYear = trendYearOptions[trendYearOptions.length - 1] ?? '';
  const trendYear = isTrendYearParam(trendYearParam)
    ? trendYearParam
    : defaultTrendYear;
  const trendMonthOptions = useMemo(
    () => (trendYear ? getTrendMonthOptions(trendYear) : []),
    [trendYear],
  );
  const defaultTrendEndMonth =
    trendMonthOptions[trendMonthOptions.length - 1] ?? '';
  const defaultTrendMonth =
    trendMonthOptions[Math.max(0, trendMonthOptions.length - 2)] ?? '';
  const trendMonthParam = searchParams.get('trendMonth');
  const trendMonth =
    trendYear && isTrendMonthParam(trendMonthParam, trendYear)
      ? trendMonthParam
      : defaultTrendMonth;
  const trendEndMonthParam = searchParams.get('trendEndMonth');
  const trendEndMonth =
    trendYear && isTrendEndMonthParam(trendEndMonthParam, trendYear, trendMonth)
      ? trendEndMonthParam
      : defaultTrendEndMonth;
  const trendStartDate = searchParams.get('trendStartDate');
  const trendEndDate = searchParams.get('trendEndDate');
  const trendWindow = useMemo(
    () => resolveTrendWindow(trendYear, trendMonth, trendEndMonth),
    [trendEndMonth, trendMonth, trendYear],
  );
  const attributionWindow = useMemo(() => {
    const startDate = baselineWeek < analysisWeek ? baselineWeek : analysisWeek;
    const lastWeek = baselineWeek < analysisWeek ? analysisWeek : baselineWeek;
    return {
      startDate,
      endDate: dayjs(lastWeek).add(6, 'day').format('YYYY-MM-DD'),
    };
  }, [analysisWeek, baselineWeek]);
  const hasTrendCalendarFilter = Boolean(trendYear);
  const effectiveTrendStartDate =
    trendStartDate ?? (hasTrendCalendarFilter ? trendWindow.startDate : null);
  const effectiveTrendEndDate =
    trendEndDate ?? (hasTrendCalendarFilter ? trendWindow.endDate : null);
  const selectedTrendWindow = useMemo(
    () => {
      const start = isValidDateParam(effectiveTrendStartDate)
        ? effectiveTrendStartDate
        : trendWindow.startDate;
      const end = isValidDateParam(effectiveTrendEndDate)
        ? effectiveTrendEndDate
        : trendWindow.endDate;
      return {
        startDate: start <= end ? start : end,
        endDate: start <= end ? end : start,
      };
    },
    [effectiveTrendEndDate, effectiveTrendStartDate, trendWindow],
  );
  const trendSourceWindow = useMemo(
    () => resolveTrendSourceWindow(selectedTrendWindow, granularity),
    [granularity, selectedTrendWindow],
  );
  const cardTrendWindow = selectedTrendWindow;

  const updateSearchParam = useCallback(
    (
      key:
        | 'platform'
        | 'deviceType'
        | 'granularity'
        | 'metric'
        | 'baselineWeek'
        | 'analysisWeek'
        | 'creationTier'
        | 'userTag'
        | 'trendUserTag'
        | 'planTier'
        | 'chainType'
        | 'trendYear'
        | 'trendMonth'
        | 'trendEndMonth'
        | 'trendStartDate'
        | 'trendEndDate',
      value: string,
    ) => {
      const next = new URLSearchParams(searchParams);
      if (value === '') next.delete(key);
      else next.set(key, value);
      startTransition(() => setSearchParams(next, { replace: true }));
    },
    [searchParams, setSearchParams],
  );

  const updateSearchParams = useCallback(
    (updates: Record<string, string | undefined>, clear: string[] = []) => {
      const next = new URLSearchParams(searchParams);
      clear.forEach((key) => next.delete(key));
      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined) next.delete(key);
        else next.set(key, value);
      });
      startTransition(() => setSearchParams(next, { replace: true }));
    },
    [searchParams, setSearchParams],
  );

  const openChainAttribution = useCallback(
    (nextChainType: PaymentChainType) => {
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'chain');
      if (nextChainType === 'renewal') next.set('chainType', 'renewal');
      else next.delete('chainType');
      ['creationTier', 'userTag', 'planTier'].forEach((key) => next.delete(key));

      const commitNavigation = () => {
        flushSync(() => setSearchParams(next, { replace: true }));
      };
      const transitionDocument = document as Document & {
        startViewTransition?: (callback: () => void) => unknown;
      };
      if (transitionDocument.startViewTransition) {
        transitionDocument.startViewTransition(commitNavigation);
      } else {
        commitNavigation();
      }
    },
    [searchParams, setSearchParams],
  );

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const updateTrendRange = useCallback(
    (range: { startDate: string; endDate: string }) => {
      updateSearchParams({
        trendStartDate: range.startDate,
        trendEndDate: range.endDate,
      });
    },
    [updateSearchParams],
  );

  const setSectionLoading = useCallback(
    (key: DashboardLoadKey, value: boolean) => {
      setLoadingBySection((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const setSectionError = useCallback(
    (key: DashboardLoadKey, value?: string) => {
      setLoadErrors((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  useEffect(() => {
    requestCacheRef.current.clear();
  }, [refreshToken]);

  useEffect(() => {
    if (activeTab !== 'trend') {
      setSectionLoading('overview', false);
      return;
    }
    let cancelled = false;
    setSectionLoading('overview', true);
    setSectionError('overview');
    const requestWindow = trendSourceWindow;
    const cacheKey = [
      'overview',
      platform,
      effectiveDeviceType ?? 'all',
      granularity,
      requestWindow.startDate,
      requestWindow.endDate,
      effectiveTrendUserTag ?? 'all',
      isRenewalTrendMetric(trendMetric.key) ? planTier : 'all',
    ].join('|');

    void getCachedRequest(requestCacheRef.current, cacheKey, () =>
      dashboardApi.getDashboardOverview({
        platform,
        deviceType: effectiveDeviceType,
        granularity,
        startDate: requestWindow.startDate,
        endDate: requestWindow.endDate,
        trendUserTag: effectiveTrendUserTag,
        planTier:
          isRenewalTrendMetric(trendMetric.key) && planTier !== 'all'
            ? planTier
            : undefined,
      }),
    )
      .then((response) => {
        if (!cancelled) {
          setOverview(response);
          if (granularity === 'day') {
            setCardTrend((response.cardTrend ?? response.trend).filter((row) =>
              row.period >= selectedTrendWindow.startDate && row.period <= selectedTrendWindow.endDate,
            ));
          }
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setOverview(null);
          setSectionError('overview', getErrorMessage(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setSectionLoading('overview', false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    granularity,
    effectiveDeviceType,
    platform,
    refreshToken,
    setSectionError,
    setSectionLoading,
    trendSourceWindow.endDate,
    trendSourceWindow.startDate,
    effectiveTrendUserTag,
    planTier,
    trendMetric.key,
    selectedTrendWindow.startDate,
    selectedTrendWindow.endDate,
  ]);

  /* The headline cards always need daily bars, even when the main trend
     chart is grouped by week. Keep this request separate so changing the
     chart grain cannot collapse the cards to a handful of bars. */
  useEffect(() => {
    if (activeTab !== 'trend' || granularity === 'day') return;
    let cancelled = false;
    const cacheKey = [
      'overview',
      platform,
      effectiveDeviceType ?? 'all',
      'day',
      cardTrendWindow.startDate,
      cardTrendWindow.endDate,
      'all',
      'all',
    ].join('|');

    void getCachedRequest(requestCacheRef.current, cacheKey, () =>
      dashboardApi.getDashboardOverview({
        platform,
        deviceType: effectiveDeviceType,
        granularity: 'day',
        startDate: cardTrendWindow.startDate,
        endDate: cardTrendWindow.endDate,
      }),
    )
      .then((response) => {
        if (!cancelled) setCardTrend(response.cardTrend ?? response.trend);
      })
      .catch(() => {
        if (!cancelled) setCardTrend([]);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    effectiveDeviceType,
    granularity,
    platform,
    refreshToken,
    cardTrendWindow.endDate,
    cardTrendWindow.startDate,
  ]);

  useEffect(() => {
    if (activeTab !== 'data') {
      setSectionLoading('coverage', false);
      return;
    }
    let cancelled = false;
    setSectionLoading('coverage', true);
    setSectionError('coverage');

    void getCachedRequest(requestCacheRef.current, 'coverage', () =>
      dashboardApi.getGmvCoverage(),
    )
      .then((response) => {
        if (!cancelled) setGmvCoverage(response);
      })
      .catch((cause) => {
        if (!cancelled) {
          setGmvCoverage(null);
          setSectionError('coverage', getErrorMessage(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setSectionLoading('coverage', false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, refreshToken, setSectionError, setSectionLoading]);

  useEffect(() => {
    if (activeTab !== 'payment') {
      setSectionLoading('payType', false);
      return;
    }
    let cancelled = false;
    setSectionLoading('payType', true);
    setSectionError('payType');
    const cacheKey = [
      'attribution',
      platform,
      effectiveDeviceType ?? 'all',
      attributionWindow.startDate,
      attributionWindow.endDate,
      baselineWeek,
      analysisWeek,
      'pay_type',
    ].join('|');

    void getCachedRequest(requestCacheRef.current, cacheKey, () =>
      dashboardApi.getDashboardAttributions({
        platform,
        deviceType: effectiveDeviceType,
        granularity: 'week',
        dimension: 'pay_type',
        startDate: attributionWindow.startDate,
        endDate: attributionWindow.endDate,
        baselinePeriod: baselineWeek,
        analysisPeriod: analysisWeek,
      }),
    )
      .then((response) => {
        if (!cancelled) {
          setAttributions((current) => ({ ...current, payType: response }));
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setAttributions((current) => ({ ...current, payType: null }));
          setSectionError('payType', getErrorMessage(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setSectionLoading('payType', false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    attributionWindow.endDate,
    attributionWindow.startDate,
    analysisWeek,
    baselineWeek,
    effectiveDeviceType,
    platform,
    refreshToken,
    setSectionError,
    setSectionLoading,
  ]);

  useEffect(() => {
    if (activeTab !== 'creative') {
      setSectionLoading('creative', false);
      return;
    }
    let cancelled = false;
    setSectionLoading('creative', true);
    setSectionError('creative');
    const cacheKey = [
      'attribution',
      platform,
      attributionWindow.startDate,
      attributionWindow.endDate,
      baselineWeek,
      analysisWeek,
      'creative',
    ].join('|');

    void getCachedRequest(requestCacheRef.current, cacheKey, () =>
      dashboardApi.getDashboardAttributions({
        platform,
        granularity: 'week',
        dimension: 'creative',
        startDate: attributionWindow.startDate,
        endDate: attributionWindow.endDate,
        baselinePeriod: baselineWeek,
        analysisPeriod: analysisWeek,
      }),
    )
      .then((response) => {
        if (!cancelled) {
          setAttributions((current) => ({ ...current, creative: response }));
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setAttributions((current) => ({ ...current, creative: null }));
          setSectionError('creative', getErrorMessage(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setSectionLoading('creative', false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    attributionWindow.endDate,
    attributionWindow.startDate,
    analysisWeek,
    baselineWeek,
    platform,
    refreshToken,
    setSectionError,
    setSectionLoading,
  ]);

  useEffect(() => {
    if (activeTab !== 'chain') {
      setSectionLoading('chain', false);
      return;
    }
    let cancelled = false;
    setSectionLoading('chain', true);
    setSectionError('chain');
    const chainUserTag =
      creationTier && creationTier !== 'all' && chainUserTagParam !== 'all' ? chainUserTagParam : '';
    const cacheKey = [
      'attribution',
      platform,
      effectiveDeviceType ?? 'all',
      attributionWindow.startDate,
      attributionWindow.endDate,
      baselineWeek,
      analysisWeek,
      'chain',
      chainType,
      chainType === 'active' ? creationTier ?? '' : '',
      chainType === 'active' ? chainUserTag : '',
      chainType === 'renewal' ? planTier : 'all',
    ].join('|');

    void getCachedRequest(requestCacheRef.current, cacheKey, () =>
      dashboardApi.getDashboardAttributions({
        platform,
        deviceType: effectiveDeviceType,
        granularity: 'week',
        dimension: 'chain',
        startDate: attributionWindow.startDate,
        endDate: attributionWindow.endDate,
        baselinePeriod: baselineWeek,
        analysisPeriod: analysisWeek,
        chainPath: 'tier_to_user_to_chain',
        chainType,
        planTier:
          chainType === 'renewal' && planTier !== 'all' ? planTier : undefined,
        creationTier: chainType === 'active' ? creationTier : undefined,
        userTag:
          chainType === 'active' ? chainUserTag || undefined : undefined,
      }),
    )
      .then((response) => {
        if (!cancelled) {
          setAttributions((current) => ({ ...current, chain: response }));
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setAttributions((current) => ({ ...current, chain: null }));
          setSectionError('chain', getErrorMessage(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setSectionLoading('chain', false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    attributionWindow.endDate,
    attributionWindow.startDate,
    analysisWeek,
    baselineWeek,
    chainUserTagParam,
    chainType,
    creationTier,
    effectiveDeviceType,
    platform,
    planTier,
    refreshToken,
    setSectionError,
    setSectionLoading,
  ]);

  useEffect(() => {
    if (activeTab !== 'data') {
      setSectionLoading('sync', false);
      return;
    }
    let cancelled = false;
    setSectionLoading('sync', true);
    setSectionError('sync');
    void getCachedRequest(requestCacheRef.current, 'sync', () =>
      getLatestSyncRun(),
    )
      .then((response) => {
        if (!cancelled) setSyncRun(response);
      })
      .catch((cause) => {
        if (!cancelled) {
          setSyncRun(null);
          setSectionError('sync', getErrorMessage(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setSectionLoading('sync', false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, refreshToken, setSectionError, setSectionLoading]);

  const activeLoadKeys: DashboardLoadKey[] =
    activeTab === 'trend'
      ? ['overview']
      : activeTab === 'payment'
        ? ['payType']
        : activeTab === 'chain'
          ? ['chain']
          : activeTab === 'creative'
            ? ['creative']
            : activeTab === 'data'
              ? ['coverage', 'sync']
              : [];
  const loading = activeLoadKeys.some((key) => loadingBySection[key]);
  const error = activeLoadKeys
    .filter((key) => loadErrors[key])
    .map((key) => `${LOAD_ERROR_LABELS[key]}：${loadErrors[key]}`)
    .join('；');

  const paySections = attributions.payType?.sections?.length
    ? attributions.payType.sections
    : attributions.payType
      ? [
          {
            title: '一级付费类型贡献',
            valueLabel: attributions.payType.valueLabel,
            metricLabels: attributions.payType.metricLabels,
            items: attributions.payType.items,
          },
        ]
      : [];
  const chainSection = attributions.chain?.sections?.[0] ?? null;
  const chainUserTypeSection = attributions.chain?.sections?.[1] ?? null;
  const isRenewalChain = chainType === 'renewal';
  const activeCreationTier =
    creationTier ?? attributions.chain?.drill?.creationTier ?? 'all';
  const activeChainUserTag = activeCreationTier !== 'all' ? chainUserTagParam : 'all';
  const activeChainUserLabel =
    activeChainUserTag === 'all' || activeChainUserTag === '全部'
      ? '全部用户'
      : activeChainUserTag;
  const chainDrivers = attributions.chain?.drivers ?? [];
  const activeChainDriverDescription =
    isRenewalChain
      ? undefined
      : activeCreationTier === 'all'
      ? `主动付费整体 - ${activeChainUserLabel}，DAU、转化率、客单价按同一用户类型联动展示。`
      : `${formatTierLabel(activeCreationTier)} - ${activeChainUserLabel}，DAU、转化率、客单价按同一用户类型联动展示。`;
  const activeComparison =
    attributions.payType?.comparison ??
    attributions.chain?.comparison ??
    attributions.creative?.comparison ??
    null;
  const availableWeeks = useMemo(
    () => {
      const first = dayjs(getBusinessWeekStart(TREND_DATA_START_DATE));
      const latest = dayjs(getBusinessWeekStart(dayjs().subtract(1, 'day').format('YYYY-MM-DD')));
      const weeks: string[] = [];
      for (let week = first; !week.isAfter(latest); week = week.add(WEEK_DAYS, 'day')) {
        weeks.push(week.format('YYYY-MM-DD'));
      }
      return weeks;
    },
    [],
  );

  return (
    <div className="dashboard-content">
      <div className="dashboard-heading">
        <div>
          <h1>{view.label}</h1>
          <p>{view.description}</p>
        </div>
        <div className="dashboard-action-bar">
          {activeTab === 'trend' ? (
            <DateRangePicker
              selectedRange={selectedTrendWindow}
              onRangeChange={updateTrendRange}
            />
          ) : null}
          <GlobalDashboardControls
            platform={platform}
            onPlatformChange={(value) =>
              updateSearchParams(
                { platform: value },
                value !== 'app' ? ['deviceType'] : [],
              )
            }
            onAppDeviceChange={(value) =>
              updateSearchParams({
                platform: 'app',
                deviceType: value === 'all' ? undefined : value,
              })
            }
            deviceType={deviceType}
            loading={loading}
            onRefresh={refresh}
          />
          <Link
            to={dashboardHref('report', searchParams.toString())}
            className="icon-control"
            aria-label="查看报告"
            title="查看报告"
          >
            <FileText size={17} />
            <span className="icon-control-tooltip">查看报告</span>
          </Link>
        </div>
      </div>
      {['payment', 'chain', 'creative'].includes(activeTab) && (
        <WeekComparisonSelector
          baselineWeek={baselineWeek}
          analysisWeek={analysisWeek}
          comparison={activeComparison}
          weeks={availableWeeks}
          onChange={(updates) => updateSearchParams(updates)}
          chainType={activeTab === 'chain' ? chainType : undefined}
          onChainTypeChange={activeTab === 'chain' ? (value) =>
            updateSearchParams(
              { chainType: value === 'active' ? undefined : value },
              ['creationTier', 'userTag'],
            ) : undefined}
          planTier={activeTab === 'chain' ? planTier : undefined}
          onPlanTierChange={activeTab === 'chain' ? (value) =>
            updateSearchParam('planTier', value === 'all' ? '' : value) : undefined}
        />
      )}
      {activeTab === 'trend' && (
        <>
          <RevenueCards
            items={paySections[0]?.items ?? []}
            loading={!cardTrend.length && loadingBySection.overview}
            period={formatWeekRange(analysisWeek)}
            trend={cardTrend}
            dailyTrend={cardTrend}
            granularity={granularity}
            analysisWeek={analysisWeek}
            baselineWeek={baselineWeek}
            headlineStartDate={selectedTrendWindow.startDate}
            headlineEndDate={selectedTrendWindow.endDate}
          />
        </>
      )}
      {activeTab === 'data' && (
        <>
          <SyncControlBar onSyncSettled={refresh} />
          <GmvCoverageExplanation
            data={gmvCoverage}
            loading={loadingBySection.coverage}
            error={loadErrors.coverage}
          />
        </>
      )}
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {activeTab === 'trend' && (
        <div className="dashboard-enter" key="trend">
          <PageSection
            title="收入趋势"
            description="查看收入及付费链路指标的变化。"
          >
            <div className="grid min-w-0 gap-4">
              {loadingBySection.overview && !overview ? (
                <LoadingBlock title="趋势加载中" />
              ) : (
                <MetricTrendChart
                  data={overview?.trend ?? []}
                  metricControls={<DashboardFilters
                    metric={trendMetric.key}
                    onMetricChange={(value) => updateSearchParams(
                      { metric: value, trendUserTag: undefined },
                      isRenewalTrendMetric(value) ? [] : ['planTier'],
                    )}
                    trendUserTag={trendUserTag}
                    onTrendUserTagChange={(value) => updateSearchParam('trendUserTag', value === 'all' ? '' : value)}
                    planTier={planTier}
                    onPlanTierChange={(value) => updateSearchParam('planTier', value === 'all' ? '' : value)}
                  />}
                  granularity={granularity}
                  onGranularityChange={(value) => updateSearchParam('granularity', value)}
                  metric={trendMetric}
                  rangeStartDate={selectedTrendWindow.startDate}
                  rangeEndDate={selectedTrendWindow.endDate}
                  onRangeChange={updateTrendRange}
                />
              )}
            </div>
          </PageSection>
        </div>
      )}

      {activeTab === 'payment' && (
        <div className="dashboard-enter" key="payment">
          <PageSection
            title="付费类型"
            description="一级只看主动付费与自动续订；主动付费内部拆首订、积分包、套餐升级、重新订阅等结果类型。"
          >
            {loadingBySection.payType ? (
              <LoadingBlock title="付费类型加载中" />
            ) : paySections.length > 0 ? (
              <div className="grid min-w-0 gap-8 [&>*]:min-w-0">
                {paySections.map((section) => (
                  <div key={section.title}>
                    <ContributionTable
                      section={section}
                      comparison={attributions.payType?.comparison ?? null}
                      onOpenChainAttribution={section.title.includes('一级') ? openChainAttribution : undefined}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyBlock
                title="暂无付费类型数据"
                description="当前比较窗口内没有一级付费类型汇总。"
              />
            )}
          </PageSection>
        </div>
      )}

      {activeTab === 'chain' && (
        <div className="dashboard-enter" key="chain">
          <PageSection
            title={isRenewalChain ? '自动续订归因' : '支付链路 x 创作分层'}
            description={isRenewalChain
              ? '比较到期用户数、续订率和续订客单价对续订 GMV 变化的贡献。'
              : '先看整体支付链路；点击创作分层行，原位展开新老用户并联动下方链路。'}
            fullBleed
          >
            {!attributions.chain && loadingBySection.chain ? (
              <LoadingBlock title="支付链路加载中" />
            ) : attributions.chain && (isRenewalChain || chainSection) ? (
              <div
                className={cn(
                  'grid min-w-0 gap-8 transition-opacity [&>*]:min-w-0',
                  loadingBySection.chain && 'opacity-60',
                )}
                aria-busy={loadingBySection.chain}
              >
                {!isRenewalChain && chainSection ? <div className={SUBSURFACE_CLASS}>
                  <ContributionBars
                    items={chainSection.items}
                    selected={activeCreationTier}
                    formatLabel={formatTierLabel}
                    label="创作分层增量贡献"
                    onSelect={(key) =>
                      updateSearchParams(
                        {
                          creationTier:
                            key === activeCreationTier ? 'all' : key,
                        },
                        ['userTag'],
                      )
                    }
                    expandedContent={chainUserTypeSection ? (
                      <ChainUserList
                        section={chainUserTypeSection}
                        selected={activeChainUserTag}
                        onSelect={(key) => updateSearchParam('userTag', key === 'all' ? '' : key)}
                      />
                    ) : null}
                  />
                </div> : null}
                <div className="min-w-0">
                  <SectionHeaderLine
                    title={isRenewalChain ? '自动续订因子拆解' : '支付链路指标拆解'}
                    description={activeChainDriverDescription}
                    badge={!isRenewalChain ? (
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
                        链路指标
                      </span>
                    ) : undefined}
                    count={isRenewalChain || activeCreationTier !== 'all' ? chainDrivers.length : undefined}
                  />
                  <DriverTable
                    drivers={chainDrivers}
                    comparison={attributions.chain.comparison}
                    outcomeType={chainType}
                  />
                </div>
              </div>
            ) : (
              <EmptyBlock
                title="暂无支付链路数据"
                description={isRenewalChain
                  ? '当前比较窗口内没有自动续订数据。'
                  : '当前比较窗口内没有创作分层链路汇总。'}
              />
            )}
          </PageSection>
        </div>
      )}

      {activeTab === 'creative' && (
        <div className="dashboard-enter" key="creative">
          <PageSection
            title="创作积极性"
            description={
              platform === 'app' && effectiveDeviceType
                ? '创作表暂无设备维度，本模块展示 App 整体口径。'
                : '查看活跃、创作数量与渗透变化，计算口径见“数据与口径”。'
            }
          >
            {loadingBySection.creative ? (
              <LoadingBlock title="创作积极性加载中" />
            ) : attributions.creative ? (
              <CreativeMetricsTable data={attributions.creative} />
            ) : (
              <EmptyBlock
                title="暂无创作数据"
                description="当前比较窗口内没有创作积极性汇总。"
              />
            )}
          </PageSection>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
