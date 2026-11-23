import { Drawer, DrawerHeader } from '@astryxdesign/core/Drawer';
import { Selector } from '@astryxdesign/core/Selector';
import { DataTable, DivergingBar, InfoTip, DeltaBadge } from '@/components/system';

import { Segment, Definition } from '@/components/v62/primitives';
import { paymentMonthTrend } from './payment-history';
import { relativeChange, changeContributions } from '@/lib/metric-change';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';
import { getPaymentAnalysis, getPaymentTrend } from '@/api/dashboard';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatChartTooltipValue } from '@/lib/chart-tooltip-format';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { downloadCsv } from './AnalysisWidgets';
import {
  attributionModes,
  buildPaymentView,
  entityKey,
  entityLabel,
  money,
  percent,
  revenueScopes,
  signedMoney,
  type PaymentEntity,
  type PaymentGrouping,
  type RevenueScope,
  costRatioRelativeChange,
} from './payment-analysis.data';
import type {
  AppDeviceType,
  DashboardPlatform,
  GmvAttributionType,
  PaymentAnalysisResponse,
} from '@shared/api.interface';
import './payment-analysis.css';
import PaymentTrend from './PaymentTrend';
import { CashFlowAreaChart } from '@/components/cash-flow-area-chart';
import { FinancialTrendsChart } from '@/components/financial-trends-chart';
import { IncomeOverviewChart } from '@/components/finance-chart/IncomeOverviewChart';
import { PaymentShareDialog } from './PaymentShareDialog';
import { Search as BenchoSearch } from '@/components/bencho';
import PaymentDailyDetail from './PaymentDailyDetail';
import LoadingWave from './LoadingWave';
import { ModelBrand } from './ModelBrand';
import { IconBar } from '@/components/bencho/IconBar';
import { PaymentRegistrationTrend } from './PaymentRegistrationTrend';
import {
  registrationBreakdown,
  registrationDimensionLabels,
  registrationDimensions,
  type RegistrationDimension,
} from './payment-registration';

// Composition adapted from the user's Mebius Data Viz references:
// Revenue by Product Line (paired comparisons) and Profit Margin Analysis
// (compact linked time-series). All figures below come from ADS-backed facts.
const CHART_CONFIG = {
  baseline: { label: '基准期', color: '#b3a9e8' },
  analysis: { label: '分析期', color: '#533afd' },
  gmv: { label: 'GMV', color: '#533afd' },
  cost: { label: '模型成本', color: '#9b93cf' },
  share: { label: 'GMV 占比', color: '#533afd' },
};
const shortMoney = (value: number) =>
  Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(0)}k` : `$${value.toFixed(0)}`;
const PAGE_SIZE = 12;
type SortKey = 'gmv' | 'baseline' | 'change' | 'contribution' | 'cost' | 'costRatio';

function CostInfo() {
  return (
    <InfoTip label="模型成本口径">
      模型成本覆盖当日全部创作用户，不随付费类型筛选分摊。成本 / GMV
      以当前收入范围为分母，不能解释为利润率。模型成本按任务端、GMV 按付费端统计。
    </InfoTip>
  );
}

function Change({ value }: { value: number | null }) {
  return (
    <span className={`payment-change ${value == null || value === 0 ? '' : value > 0 ? 'is-up' : 'is-down'}`}>
      {value != null && value !== 0 && (value > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      {percent(value == null ? null : Math.abs(value))}
    </span>
  );
}

function RatioChange({ value }: { value: number | null }) {
  return (
    <span className="payment-change payment-cost-change">
      {value == null ? (
        '—'
      ) : (
        <>
          {value > 0 ? <ArrowUp size={12} /> : value < 0 ? <ArrowDown size={12} /> : null}
          {(Math.abs(value) * 100).toFixed(1)} pp
        </>
      )}
    </span>
  );
}

function RevenueTrend({
  trend,
  summaryTrend = trend,
  costs = false,
}: {
  trend: ReturnType<typeof buildPaymentView>['trend'];
  summaryTrend?: ReturnType<typeof buildPaymentView>['trend'];
  costs?: boolean;
}) {
  const [metric, setMetric] = useState('gmv');
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const selectedMetric = costs ? metric : 'gmv';
  const ratio = selectedMetric === 'ratio';
  const valuesFor = (rows: typeof trend) =>
    rows.map((p) => ({
      label: p.label,
      date: p.date,
      analysis:
        selectedMetric === 'cost'
          ? p.cost
          : ratio
            ? p.cost != null && p.analysis
              ? p.cost / p.analysis
              : null
            : p.analysis,
      baseline:
        selectedMetric === 'cost'
          ? p.baselineCost
          : ratio
            ? p.baselineCost != null && p.baseline
              ? p.baselineCost / p.baseline
              : null
            : p.baseline,
    }));
  const values = valuesFor(trend),
    summaryValues = valuesFor(summaryTrend);
  const observed = values.filter((p) => p.analysis != null);
  const firstComparable = observed.findIndex((p) => p.baseline != null);
  const comparison = firstComparable < 0 ? [] : observed.slice(firstComparable);
  const completeComparison = comparison.length > 0 && comparison.every((p) => p.baseline != null);
  const summaryObserved = summaryValues.filter((p) => p.analysis != null);
  const paired = summaryObserved.filter((p) => p.baseline != null);
  const sum = (rows: typeof trend, key: 'cost' | 'analysis' | 'baselineCost' | 'baseline') =>
    rows.reduce((total, p) => total + (p[key] ?? 0), 0);
  const ratioRows = summaryTrend.filter((p) => p.analysis != null && p.cost != null && p.analysis > 0);
  const comparableRatioRows = ratioRows.filter((p) => p.baseline != null && p.baselineCost != null && p.baseline > 0);
  const total = ratio
    ? sum(ratioRows, 'cost') / (sum(ratioRows, 'analysis') || 1)
    : summaryObserved.reduce((total, p) => total + p.analysis!, 0) / Math.max(1, summaryObserved.length);
  const change = ratio
    ? sum(comparableRatioRows, 'cost') / (sum(comparableRatioRows, 'analysis') || 1) -
      sum(comparableRatioRows, 'baselineCost') / (sum(comparableRatioRows, 'baseline') || 1)
    : paired.reduce((total, p) => total + p.analysis! - p.baseline!, 0) / Math.max(1, paired.length);
  return (
    <>
      <div ref={setPortalContainer} className="payment-detail-trend-toolbar">
        <Legend baseline={completeComparison} />
        {costs && (
          <Selector
            label="详情趋势指标"
            isLabelHidden
            variant="ghost"
            size="sm"
            value={selectedMetric}
            onChange={setMetric}
            options={[
              { value: 'gmv', label: 'GMV' },
              { value: 'cost', label: '模型成本' },
              { value: 'ratio', label: '成本 / GMV' },
            ]}
          />
        )}
      </div>
      <div className="payment-history-caption">
        <InfoTip label="周对比口径">
          周均与增量只比较分析周和基准周相同的已观测星期。下图为独立的最近 30 日走势；基准线取对应基准周期同日数据。
        </InfoTip>
      </div>
      <CashFlowAreaChart
        key={`${selectedMetric}:${values.map((p) => p.label).join(',')}`}
        className={`payment-detail-cash-flow${paired.length ? '' : ' has-no-comparison'}`}
        data-days={observed.length}
        title={`${ratio ? '成本占比' : selectedMetric === 'cost' ? '模型成本' : 'GMV'}逐日走势`}
        description=""
        icon={null}
        data={values.map((p) => ({ date: p.date, value: p.analysis ?? NaN }))}
        unit={ratio ? 'rate' : 'currency'}
        compare={values.flatMap((p) => (p.baseline == null ? [] : [p.baseline]))}
        compareIndices={values.flatMap((p, index) => (p.baseline == null ? [] : [index]))}
        compareLabel="基准同期值"
        totalLabel={ratio ? '分析周成本 / GMV' : '分析周日均'}
        total={total}
        changeLabel={ratio ? '较基准周' : '较基准周日均'}
        change={change}
        formatValue={ratio ? percent : money}
        formatChangeValue={
          ratio
            ? (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${(Math.abs(value) * 100).toFixed(2)}pp`
            : undefined
        }
        formatDate={(date, context) => (context === 'axis' ? date.slice(5).replace('-', '/') : date)}
        locale="zh-CN"
      />
    </>
  );
}

function Legend({ costs = false, baseline = true }: { costs?: boolean; baseline?: boolean }) {
  return (
    <div className="payment-chart-legend">
      <span>
        <i />
        分析期
      </span>
      {baseline && (
        <span>
          <i className="is-baseline" />
          基准期
        </span>
      )}
      {costs && (
        <span>
          <i className="is-cost" />
          模型成本
        </span>
      )}
    </div>
  );
}

export default function PaymentAnalysis({
  platform,
  deviceType,
  baselinePeriod,
  analysisPeriod,
  refreshToken,
  onLoadingChange,
}: {
  platform: DashboardPlatform;
  deviceType?: AppDeviceType;
  baselinePeriod: string;
  analysisPeriod: string;
  refreshToken: number;
  onLoadingChange: (value: boolean) => void;
}) {
  const [params, setParams] = useSearchParams();
  const liquidId = useId();
  const reducedMotion = useReducedMotion();
  const [bubblePressed, setBubblePressed] = useState(false);
  const glassFilterId = `payment-glass-${liquidId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const mode = attributionModes.find((m) => m.value === params.get('attributionType'))?.value || 'NONE';
  const scope: RevenueScope = revenueScopes.find((s) => s.value === params.get('income'))?.value || 'ALL';
  const modeLabel = attributionModes.find((m) => m.value === mode)!.dimension;
  const groups: { value: PaymentGrouping; label: string }[] =
    mode === 'NONE'
      ? [{ value: 'payType', label: '付费类型' }]
      : [
          { value: 'attributionName', label: modeLabel },
          ...(mode === 'ACTUAL_MODEL'
            ? [
                { value: 'actualSupplier' as const, label: '渠道商' },
                { value: 'actualProvider' as const, label: '厂商' },
              ]
            : []),
        ];
  const grouping: PaymentGrouping = groups.find((g) => g.value === params.get('groupBy'))?.value || groups[0].value;
  const dimension = groups.find((g) => g.value === grouping)!.label;
  const [highlight, setHighlight] = useState<string | null>(null);
  const [data, setData] = useState<PaymentAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: 'gmv',
    descending: true,
  });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const openDetail = (key: string) => {
    setSelected(key);
    setRegistrationLayer(null);
    setRegistrationDimension(registrationDimensions(key)[0]);
    setDetailOpen(true);
  };
  const [shareSelected, setShareSelected] = useState<string | null>(null);
  const [registrationLayer, setRegistrationLayer] = useState<string | null>(null);
  const [registrationDimension, setRegistrationDimension] = useState<RegistrationDimension>('userLifecycle');
  const [registrationData, setRegistrationData] = useState<PaymentAnalysisResponse | null>(null);
  const [registrationError, setRegistrationError] = useState(false);
  useEffect(() => {
    setRegistrationData(null);
    setRegistrationError(false);
    if (!detailOpen || !selected || mode !== 'NONE' || grouping !== 'payType') return;
    let live = true;
    void getPaymentAnalysis({
      platform,
      deviceType,
      baselinePeriod,
      analysisPeriod,
      attributionType: mode,
      registrationPayType: selected,
      cacheBust: refreshToken || retry || undefined,
    })
      .then((result) => {
        if (live) setRegistrationData(result);
      })
      .catch(() => {
        if (live) setRegistrationError(true);
      });
    return () => {
      live = false;
    };
  }, [detailOpen, selected, mode, grouping, platform, deviceType, baselinePeriod, analysisPeriod, refreshToken, retry]);

  const [showInsight, setShowInsight] = useState(false);
  const update = (updates: Record<string, string | undefined>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(updates)) value == null ? next.delete(key) : next.set(key, value);
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const request = getPaymentAnalysis({
      platform,
      deviceType,
      baselinePeriod,
      analysisPeriod,
      attributionType: mode,
      cacheBust: refreshToken || retry || undefined,
    });
    void request
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause) => {
        if (!cancelled) {
          setData(null);
          setError(cause?.response?.data?.error || cause?.message || '数据读取失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform, deviceType, baselinePeriod, analysisPeriod, mode, refreshToken, retry]);
  useEffect(() => {
    onLoadingChange(loading);
  }, [loading, onLoadingChange]);
  useEffect(() => {
    setPage(0);
    setSelected(null);
    setDetailOpen(false);
    setShareSelected(null);
    setQuery('');
    setShowInsight(false);
  }, [mode, scope, grouping, platform, deviceType, baselinePeriod, analysisPeriod]);
  const view = useMemo(() => (data ? buildPaymentView(data, scope, grouping) : null), [data, scope, grouping]);
  const contributionScale = Math.max(
    Number.EPSILON,
    ...(view?.items || []).map((item) => Math.abs(item.contribution || 0)),
  );
  const detail = useMemo(
    () => (data && selected ? buildPaymentView(data, scope, grouping, selected) : null),
    [data, scope, grouping, selected],
  );
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedItem = view?.items.find((item) => item.key === selected);
  const filtered = useMemo(() => {
    const items = (view?.items || []).filter((r) =>
      entityLabel(r.key).toLowerCase().includes(query.trim().toLowerCase()),
    );
    return [...items].sort((a, b) => {
      const x =
          sort.key === 'cost' ? a.costChangeRate : sort.key === 'costRatio' ? costRatioRelativeChange(a) : a[sort.key],
        y =
          sort.key === 'cost' ? b.costChangeRate : sort.key === 'costRatio' ? costRatioRelativeChange(b) : b[sort.key];
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return (sort.descending ? y - x : x - y) || a.key.localeCompare(b.key);
    });
  }, [view, query, sort]);
  const insight = useMemo(() => {
    if (!view) return null;
    const total = view.total;
    const direction = total.change > 0 ? '上涨' : total.change < 0 ? '下跌' : '持平';
    const sameDirection = view.items
      .filter((item) => item.contribution != null && item.contribution > 0 && item.change * total.change > 0)
      .sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0));
    const offsets = view.items
      .filter((item) => item.change * total.change < 0)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const rate = total.baseline
      ? `${total.change >= 0 ? '+' : ''}${((total.change / total.baseline) * 100).toFixed(1)}%`
      : '—';
    return {
      total,
      direction,
      rate,
      scopeLabel: revenueScopes.find((item) => item.value === scope)?.label,
      drivers: sameDirection.slice(0, 2),
      offset: offsets[0],
      summary: `本周${revenueScopes.find((item) => item.value === scope)?.label || '全部收入'}日均 GMV ${money(total.gmv)}，较基准周${direction}${signedMoney(total.change)}（${rate}）。${sameDirection[0] ? `核心驱动是${entityLabel(sameDirection[0].key)}，贡献${percent(sameDirection[0].contribution)}（${money(sameDirection[0].baseline)} → ${money(sameDirection[0].gmv)}，${signedMoney(sameDirection[0].change)}）。` : '当前维度没有可识别的同向核心驱动。'}${sameDirection[1] ? `次要驱动是${entityLabel(sameDirection[1].key)}，贡献${percent(sameDirection[1].contribution)}（${signedMoney(sameDirection[1].change)}）。` : ''}${offsets[0] ? `主要抵消项是${entityLabel(offsets[0].key)}，${signedMoney(offsets[0].change)}。` : ''}`,
    };
  }, [view, scope]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visiblePage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE);
  const supported = data?.availableAttributionTypes.includes(mode);
  const showCosts = Boolean(data?.costAvailable);
  const entityCosts = showCosts && grouping !== 'payType';
  const costView = useMemo(
    () =>
      data && showCosts ? buildPaymentView(data, scope, grouping === 'payType' ? 'attributionName' : grouping) : null,
    [data, scope, grouping, showCosts],
  );
  const chartItems = showCosts
    ? [...(costView?.items || [])].sort((a, b) => (b.cost || 0) - (a.cost || 0))
    : [...(view?.items || [])].sort((a, b) => b.gmv - a.gmv);
  const [costPeriod, setCostPeriod] = useState('month');
  const observedThrough = data?.revenues
    .map((row) => row.period)
    .sort()
    .at(-1);
  const [costHistory, setCostHistory] = useState<import('@shared/api.interface').PaymentTrendResponse | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyRetry, setHistoryRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setCostHistory(null);
    setHistoryError(false);
    if (!showCosts && !detailOpen) return;
    const weekEnd = new Date(Date.parse(analysisPeriod + 'T00:00:00Z') + 6 * 86400000).toISOString().slice(0, 10);
    const endDate = [weekEnd, observedThrough || weekEnd].sort()[0];
    const offset = Math.abs(Date.parse(analysisPeriod) - Date.parse(baselinePeriod)) / 86400000;
    const startDate = new Date(Date.parse(endDate + 'T00:00:00Z') - (29 + offset) * 86400000)
      .toISOString()
      .slice(0, 10);
    void getPaymentTrend({
      platform,
      deviceType,
      analysisPeriod,
      attributionType: mode,
      income: scope,
      groupBy: grouping,
      granularity: 'day',
      startDate,
      endDate,
      cacheBust: refreshToken || undefined,
    })
      .then((result) => {
        if (active) setCostHistory(result);
      })
      .catch(() => {
        if (active) setHistoryError(true);
      });
    return () => {
      active = false;
    };
  }, [
    platform,
    deviceType,
    analysisPeriod,
    baselinePeriod,
    observedThrough,
    mode,
    scope,
    grouping,
    refreshToken,
    historyRetry,
    showCosts,
    detailOpen,
  ]);
  const monthTrend = useMemo(
    () => (costHistory && selected ? paymentMonthTrend(costHistory, selected, baselinePeriod, analysisPeriod) : null),
    [costHistory, selected, baselinePeriod, analysisPeriod],
  );
  const costDaily = useMemo(() => {
    if (!data?.costAvailable) return [];
    if (costHistory)
      return costHistory.points
        .filter((p) => p.period >= new Date(Date.parse(costHistory.endDate) - 29 * 86400000).toISOString().slice(0, 10))
        .flatMap((p) =>
          p.gmvUsd != null && p.modelCostUsd != null
            ? [{ date: p.period, inflow: p.gmvUsd, outflow: p.modelCostUsd }]
            : [],
        );
    const points = new Map<string, { date: string; inflow: number; outflow: number }>();
    const point = (date: string) => {
      if (!points.has(date)) points.set(date, { date, inflow: 0, outflow: 0 });
      return points.get(date)!;
    };
    for (const row of data.revenues)
      if (scope === 'ALL' || row.payCategory === scope) point(row.period).inflow += row.gmvUsd;
    for (const row of data.costs) point(row.period).outflow += row.modelCostUsd;
    return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [data, scope, costHistory]);
  const costPeriods = useMemo(() => {
    const end = Date.parse((costDaily.at(-1)?.date ?? analysisPeriod) + 'T00:00:00Z');
    return [
      { value: 'month', label: '月', days: 30 },
      { value: 'quarter', label: '季度', days: 90 },
    ].map((period) => ({
      ...period,
      data: costDaily.filter((point) => Date.parse(point.date + 'T00:00:00Z') >= end - (period.days - 1) * 86400000),
    }));
  }, [costDaily, analysisPeriod]);
  const shownCostPeriod = costPeriods.find((period) => period.value === costPeriod)!;
  const costCoverage = shownCostPeriod.data.length
    ? `${shownCostPeriod.data[0].date.slice(5).replace('-', '/')}–${shownCostPeriod.data.at(-1)!.date.slice(5).replace('-', '/')} · ${shownCostPeriod.data.length} 日${shownCostPeriod.data.length < shownCostPeriod.days ? '可用数据' : ''}`
    : '此范围暂无数据';
  const sortBy = (key: SortKey) => {
    setSort((old) => ({
      key,
      descending: old.key === key ? !old.descending : true,
    }));
    setPage(0);
  };
  const header = (label: string, key: SortKey) => (
    <button type="button" onClick={() => sortBy(key)} className="payment-sort">
      {label}
      {sort.key === key ? sort.descending ? <ArrowDown size={12} /> : <ArrowUp size={12} /> : <ArrowUpDown size={12} />}
    </button>
  );
  const exportRows = () =>
    downloadCsv(`GMV-${mode}-${analysisPeriod}.csv`, [
      [
        '名称',
        '基准期日均GMV',
        '分析期日均GMV',
        '日均变化',
        '变化率',
        '贡献度',
        '日均模型成本',
        '成本/GMV',
        '基准期日均模型成本',
        '模型成本变化率',
        '成本占比变化(百分点)',
      ],
      ...filtered.map((r) => [
        entityLabel(r.key),
        r.baseline,
        r.gmv,
        r.change,
        r.changeRate ?? '',
        r.contribution ?? '',
        r.cost ?? '',
        r.costRatio ?? '',
        r.baselineCost ?? '',
        r.costChangeRate ?? '',
        r.costRatioChange == null ? '' : r.costRatioChange * 100,
      ]),
    ]);
  const detailTypes = useMemo(() => {
    if (!data || !selected) return [];
    const analysisOffsets = new Set(
      data.revenues
        .filter((r) => r.weekStart === analysisPeriod)
        .map((r) => Date.parse(r.period) - Date.parse(r.weekStart)),
    );
    const values = new Map<string, { baseline: number; analysis: number }>();
    for (const r of data.revenues) {
      if (
        entityKey(r, grouping) !== selected ||
        (scope !== 'ALL' && r.payCategory !== scope) ||
        !analysisOffsets.has(Date.parse(r.period) - Date.parse(r.weekStart))
      )
        continue;
      const detailKey =
        grouping === 'actualSupplier' || grouping === 'actualProvider' ? r.attributionName || '未归因' : r.payType;
      const v = values.get(detailKey) || { baseline: 0, analysis: 0 };
      if (r.weekStart === baselinePeriod) v.baseline += r.gmvUsd;
      if (r.weekStart === analysisPeriod) v.analysis += r.gmvUsd;
      values.set(detailKey, v);
    }
    return [...values]
      .map(([key, v]) => ({
        key,
        baseline: v.baseline / (data.comparison?.baselinePeriodDays || 7),
        analysis: v.analysis / (data.comparison?.analysisPeriodDays || 7),
      }))
      .sort((a, b) => b.analysis - a.analysis);
  }, [data, selected, grouping, scope, analysisPeriod, baselinePeriod]);
  const detailContributions = changeContributions(detailTypes);
  const registrationRows = useMemo(
    () =>
      registrationData && selected ? registrationBreakdown(registrationData, selected, registrationDimension) : null,
    [registrationData, selected, registrationDimension],
  );
  const registrationContributions = changeContributions(registrationRows ?? []);

  return (
    <div
      className="payment-bento"
      aria-busy={loading}
      data-dashboard-ready={!loading && Boolean(data?.revenues.length) && !error}
    >
      <Tabs value={mode} onValueChange={(value) => update({ attributionType: value, groupBy: undefined })}>
        <div className="payment-bento-toolbar">
          <Segment
            label="GMV 归因模式"
            variant="icons"
            value={mode}
            onChange={(value) => update({ attributionType: value, groupBy: undefined })}
            items={attributionModes.map((item, index) => ({
              ...item,
              icon: (['chart-pie', 'blocks', 'cpu', 'workflow'] as const)[index],
            }))}
          />
          <Selector
            label="收入范围"
            isLabelHidden
            variant="ghost"
            size="sm"
            value={scope}
            options={revenueScopes}
            onChange={(value) => update({ income: value })}
          />
        </div>
        <TabsContent key={mode} value={mode} className="payment-bento-content">
          {loading ? (
            <div className="payment-loading payment-loading-wave" role="status" aria-label="正在读取归因数据">
              <LoadingWave label="正在读取归因数据" />
            </div>
          ) : error ? (
            <div className="payment-state" role="alert">
              <h2>暂时无法读取数据</h2>
              <p>{error}</p>
              <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
                重新加载
              </Button>
            </div>
          ) : !supported ? (
            <div className="payment-state">
              <h2>这个日期还没有模型归因数据</h2>
              <p>模型归因从 2026 年 10 月 1 日起提供。此前历史数据可查看大盘汇总和创作模式。</p>
              <Button variant="outline" onClick={() => update({ attributionType: 'NONE', groupBy: undefined })}>
                查看大盘汇总
              </Button>
            </div>
          ) : !view || !data?.comparison ? (
            <div className="payment-state">
              <h2>当前业务周没有足够的数据</h2>
              <p>请在右上角选择有数据的基准周和分析周。</p>
            </div>
          ) : (
            <>
              {data.source === 'legacy' && (
                <div className="payment-history-note">历史口径 · 2026 年 1—9 月保留旧数据</div>
              )}
              <div className="payment-bento-charts">
                <PaymentTrend
                  grouping={grouping}
                  platform={platform}
                  deviceType={deviceType}
                  analysisPeriod={analysisPeriod}
                  baselinePeriod={baselinePeriod}
                  mode={mode}
                  scope={scope}
                  refreshToken={refreshToken}
                  highlightedEntity={highlight}
                />
                {showCosts ? (
                  <FinancialTrendsChart
                    key={`${mode}-${scope}-${refreshToken}`}
                    className="payment-financial-trends"
                    title="收入与模型成本"
                    locale="zh-CN"
                    totalLabel="全量模型成本 · 分析周日均"
                    summaryValue={view.total.cost ?? 0}
                    inflowLabel="GMV"
                    outflowLabel="全量模型成本"
                    formatSpan={(start) => new Date(start).toISOString().slice(0, 10)}
                    formatTooltipExtra={(bucket) => (
                      <div className="payment-financial-ratio">
                        <span>成本 / GMV</span>
                        <strong>{bucket.inflow > 0 ? percent(bucket.outflow / bucket.inflow) : '—'}</strong>
                      </div>
                    )}
                    periods={costPeriods}
                    period={costPeriod}
                    onPeriodChange={setCostPeriod}
                    coverageLabel={costCoverage}
                  />
                ) : (
                  <Card className="payment-viz-card payment-comparison-card">
                    <CardHeader className="payment-viz-head">
                      <div>
                        <CardTitle>
                          GMV 分布<InfoTip label="GMV 分布口径">分析期同业务日日均 GMV，单位 USD。</InfoTip>
                        </CardTitle>
                        <div className="payment-viz-reading">
                          <strong>{money(view.total.gmv)}</strong>
                          <span className="payment-distribution-change">较基准周</span>
                          <Change value={view.total.changeRate} />
                        </div>
                        <span className="payment-baseline">{dimension}</span>
                      </div>
                    </CardHeader>
                    <CardContent className="payment-viz-content">
                      <IncomeOverviewChart
                        key={`${mode}-${scope}-${grouping}`}
                        periods={chartItems.map((item) => ({
                          id: item.key,
                          label: entityLabel(item.key),
                          amount: item.gmv,
                        }))}
                        total={view.total.gmv}
                        onOpen={grouping === 'payType' ? setShareSelected : openDetail}
                        openLabel={grouping === 'payType' ? '占比趋势' : '明细'}
                      />
                    </CardContent>
                  </Card>
                )}
              </div>

              <Card className="payment-viz-card payment-table-card">
                <CardHeader className="payment-table-head">
                  <div className="payment-table-title">
                    <CardTitle>
                      归因明细
                      <InfoTip label="归因明细口径">
                        分析期与基准期按相同业务日对齐，金额取日均，单位 USD。贡献度 = 该项 GMV 变化 ÷ 总 GMV
                        净变化；总变化为零时不计算。正负方向由 GMV 变化决定。
                      </InfoTip>
                    </CardTitle>
                  </div>
                  <div className="payment-table-actions">
                    <Button
                      hidden
                      variant="ghost"
                      size="sm"
                      className="payment-insight-trigger no-default-hover-elevate no-default-active-elevate"
                      aria-expanded={showInsight}
                      aria-controls="payment-insight"
                      onClick={() => setShowInsight((value) => !value)}
                    >
                      Get Insight
                    </Button>
                    {groups.length > 1 && (
                      <Selector
                        label="下钻维度"
                        isLabelHidden
                        size="sm"
                        variant="ghost"
                        value={grouping}
                        onChange={(value) => update({ groupBy: value })}
                        options={groups}
                      />
                    )}
                    <BenchoSearch
                      value={query}
                      onChange={(value) => {
                        setQuery(value);
                        setPage(0);
                      }}
                      placeholder={`搜索${dimension}`}
                      width={224}
                    />
                    <ButtonGroup>
                      <PaymentDailyDetail
                        data={data}
                        scope={scope}
                        grouping={grouping}
                        query={query}
                        dimension={dimension}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={exportRows}
                        disabled={!filtered.length}
                        aria-label="导出归因明细 CSV"
                        title="导出周对比 CSV"
                      >
                        <ArrowDownToLine size={16} />
                      </Button>
                    </ButtonGroup>
                  </div>
                </CardHeader>
                {showInsight && insight && (
                  <section
                    id="payment-insight"
                    className="payment-insight"
                    role="region"
                    aria-label="本周 GMV 归因洞察"
                  >
                    <div className="payment-insight-copy">
                      <div>
                        <span className="payment-insight-label">本周 GMV 归因洞察</span>
                        <p>{insight.summary}</p>
                      </div>
                    </div>
                  </section>
                )}
                <CardContent className="payment-table-content">
                  <DataTable
                    rows={[
                      { ...view.total, key: 'total', id: 'total', kind: 'total' as const },
                      ...shown.map((row) => ({ ...row, id: row.key, kind: 'row' as const })),
                    ]}
                    stickyFirst
                    onRowHover={(row) => setHighlight(row?.kind === 'row' ? row.key : null)}
                    columns={[
                      {
                        key: 'entity',
                        header: dimension,
                        minWidth: 180,
                        render: (r) =>
                          r.kind === 'total' ? (
                            '合计'
                          ) : (
                            <button
                              type="button"
                              className="payment-entity"
                              onClick={(event) => {
                                detailTriggerRef.current = event.currentTarget;
                                openDetail(r.key);
                              }}
                              title={entityLabel(r.key)}
                            >
                              {(mode === 'MODEL' || mode === 'ACTUAL_MODEL') && grouping !== 'payType' && (
                                <ModelBrand
                                  model={r.key}
                                  kind={
                                    grouping === 'actualSupplier'
                                      ? 'supplier'
                                      : grouping === 'actualProvider'
                                        ? 'provider'
                                        : 'model'
                                  }
                                />
                              )}
                              <span className="payment-entity-label">{entityLabel(r.key)}</span>
                              <ChevronRight size={13} />
                            </button>
                          ),
                      },
                      {
                        key: 'gmv',
                        header: header('分析周 GMV', 'gmv'),
                        numeric: true,
                        minWidth: 130,
                        render: (r) => money(r.gmv),
                      },
                      {
                        key: 'baseline',
                        header: header('基准周 GMV', 'baseline'),
                        numeric: true,
                        minWidth: 130,
                        render: (r) => <span className="payment-muted-cell">{money(r.baseline)}</span>,
                      },
                      {
                        key: 'change',
                        header: header('变化', 'change'),
                        numeric: true,
                        minWidth: 120,
                        render: (r) => signedMoney(r.change),
                      },
                      {
                        key: 'changeRate',
                        header: '较基准周',
                        numeric: true,
                        minWidth: 100,
                        render: (r) => <DeltaBadge value={r.changeRate} />,
                      },
                      {
                        key: 'contribution',
                        header: header('贡献度', 'contribution'),
                        numeric: true,
                        minWidth: 184,
                        render: (r) =>
                          r.kind === 'total' ? (
                            view.total.change !== 0 ? (
                              '100%'
                            ) : (
                              '—'
                            )
                          ) : (
                            <DivergingBar value={r.contribution} effect={r.change} scaleMax={contributionScale} />
                          ),
                      },
                      ...(showCosts
                        ? [
                            {
                              key: 'cost',
                              header: header('模型成本变化', 'cost'),
                              numeric: true,
                              minWidth: 130,
                              render: (r: PaymentEntity & { kind?: string }) => (
                                <span
                                  title={`基准期 ${r.baselineCost == null ? '—' : money(r.baselineCost)}；分析期 ${r.cost == null ? '—' : money(r.cost)}`}
                                >
                                  <DeltaBadge value={r.costChangeRate} />
                                </span>
                              ),
                            },
                            {
                              key: 'costRatio',
                              header: (
                                <span className="payment-ratio-heading">
                                  {header('成本占比变化', 'costRatio')}
                                  <CostInfo />
                                </span>
                              ),
                              numeric: true,
                              minWidth: 120,
                              render: (r: PaymentEntity & { kind?: string }) => (
                                <span
                                  title={`成本 / GMV 相对变化；基准期 ${percent(r.baselineCost != null && r.baseline !== 0 ? r.baselineCost / r.baseline : null)}；分析期 ${percent(r.costRatio)}`}
                                >
                                  <DeltaBadge value={costRatioRelativeChange(r)} />
                                </span>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />

                  {!filtered.length && (
                    <div className="payment-no-matches">
                      {query ? `没有匹配“${query}”的${dimension}` : '当前收入范围没有归因明细'}
                    </div>
                  )}
                </CardContent>
                <div className="payment-table-footer">
                  <span>
                    {filtered.length ? visiblePage * PAGE_SIZE + 1 : 0}–
                    {Math.min((visiblePage + 1) * PAGE_SIZE, filtered.length)} / {filtered.length}
                  </span>
                  <div>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={visiblePage === 0}
                      onClick={() => setPage(visiblePage - 1)}
                      aria-label="上一页"
                    >
                      <ChevronLeft size={15} />
                    </Button>
                    <span>
                      {visiblePage + 1} / {pageCount}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={visiblePage >= pageCount - 1}
                      onClick={() => setPage(visiblePage + 1)}
                      aria-label="下一页"
                    >
                      <ChevronRight size={15} />
                    </Button>
                  </div>
                </div>
              </Card>
              <PaymentShareDialog
                entity={shareSelected}
                label={shareSelected ? entityLabel(shareSelected) : ''}
                history={costHistory}
                platform={platform}
                deviceType={deviceType}
                analysisPeriod={analysisPeriod}
                scope={scope}
                refreshToken={refreshToken}
                error={historyError}
                context={`${platform === 'web' ? 'Web 端' : platform === 'app' ? (deviceType === 'ios' ? 'iOS' : deviceType === 'android' ? 'Android' : 'App 端') : '全端'} · ${revenueScopes.find((item) => item.value === scope)!.label}`}
                onClose={() => setShareSelected(null)}
                onRetry={() => setHistoryRetry((value) => value + 1)}
              />
              <Drawer
                isOpen={detailOpen && Boolean(selectedItem)}
                onOpenChange={setDetailOpen}
                label="收入归因明细"
                width={680}
                padding={0}
              >
                <div className="payment-detail-sheet">
                  <DrawerHeader
                    onOpenChange={setDetailOpen}
                    title={
                      <span className="payment-brand-label">
                        {selectedItem && (mode === 'MODEL' || mode === 'ACTUAL_MODEL') && grouping !== 'payType' && (
                          <ModelBrand
                            model={selectedItem.key}
                            kind={
                              grouping === 'actualSupplier'
                                ? 'supplier'
                                : grouping === 'actualProvider'
                                  ? 'provider'
                                  : 'model'
                            }
                          />
                        )}
                        <span ref={detailTitleRef} tabIndex={-1} data-autofocus>
                          {registrationLayer ?? (selectedItem ? entityLabel(selectedItem.key) : '收入明细')}
                        </span>
                      </span>
                    }
                  />
                  {registrationLayer && (
                    <button type="button" className="payment-layer-back" onClick={() => setRegistrationLayer(null)}>
                      ‹ 返回付费贡献分析
                    </button>
                  )}
                  {selectedItem && detail && (
                    <>
                      {entityCosts && (
                        <div className="payment-detail-metrics">
                          <div>
                            <span>GMV</span>
                            <strong>{money(selectedItem.gmv)}</strong>
                            <Change value={selectedItem.changeRate} />
                          </div>
                          {entityCosts && (
                            <>
                              <div>
                                <span>
                                  模型成本 <CostInfo />
                                </span>
                                <strong>{money(selectedItem.cost || 0)}</strong>
                                <Change value={selectedItem.costChangeRate} />
                              </div>
                              <div>
                                <span>成本 / GMV</span>
                                <strong>{percent(selectedItem.costRatio)}</strong>
                                <RatioChange value={selectedItem.costRatioChange} />
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      {registrationLayer && selected ? (
                        <PaymentRegistrationTrend
                          data={data}
                          payType={selected}
                          dimension={registrationDimension}
                          layer={registrationLayer}
                          platform={platform}
                          deviceType={deviceType}
                          refreshToken={refreshToken}
                          renderTrend={(trend, summary) => <RevenueTrend trend={trend} summaryTrend={summary} />}
                        />
                      ) : monthTrend?.length ? (
                        <RevenueTrend trend={monthTrend} summaryTrend={detail.trend} costs={entityCosts} />
                      ) : (
                        <div className="payment-history-loading" role="status">
                          {historyError ? (
                            <>
                              <span>月度走势读取失败</span>
                              <button type="button" onClick={() => setHistoryRetry((value) => value + 1)}>
                                重新加载
                              </button>
                            </>
                          ) : costHistory ? (
                            '此范围暂无趋势数据'
                          ) : (
                            '正在读取近一个月走势…'
                          )}
                        </div>
                      )}
                      {mode === 'NONE' && grouping === 'payType' && !registrationLayer && (
                        <section className="payment-detail-types payment-registration">
                          <header>
                            <h3>付费贡献分析</h3>
                            {mode === 'NONE' && grouping === 'payType' && (
                              <Segment
                                label="付费下钻维度"
                                value={registrationDimension}
                                onChange={(value) => setRegistrationDimension(value as RegistrationDimension)}
                                items={registrationDimensions(selected ?? '').map((value) => ({
                                  value,
                                  label: registrationDimensionLabels[value],
                                }))}
                              />
                            )}
                          </header>
                          {registrationRows ? (
                            <Definition label="付费下钻口径">
                              {registrationDimension === 'regPlatform'
                                ? '注册端取自支付订单；页面筛选按支付端，可据此区分同端与跨端付费。'
                                : ['upgradeCombination', 'cycleTransition'].includes(registrationDimension)
                                  ? '变更前取同一订阅、同一支付端的上一笔有效实付；无法关联时保留未知。拆分金额已按日、付费类型核对。'
                                  : ['sku', 'creditAmount'].includes(registrationDimension)
                                    ? 'SKU 与积分额度取自支付订单；拆分金额已按日、付费类型核对。'
                                    : '国家层级按数仓 T1/T2/T3 映射（清单外及未知归 T2），注册新老按账户注册日期计算；拆分金额已按日、付费类型核对。'}
                            </Definition>
                          ) : null}
                          {registrationRows ? (
                            <DataTable
                              rows={registrationRows.map((row, index) => ({
                                ...row,
                                id: row.key,
                                contribution: registrationContributions[index],
                              }))}
                              columns={[
                                {
                                  key: 'entity',
                                  header: registrationDimensionLabels[registrationDimension],
                                  render: (r) => (
                                    <button
                                      type="button"
                                      className="payment-entity"
                                      onClick={() => {
                                        setRegistrationLayer(r.key);
                                        detailTitleRef.current?.closest('dialog')?.scrollTo({ top: 0 });
                                      }}
                                    >
                                      <span className="payment-entity-label">{r.key}</span>
                                      <ChevronRight size={13} />
                                    </button>
                                  ),
                                },
                                {
                                  key: 'analysis',
                                  header: '分析周日均',
                                  numeric: true,
                                  render: (r) => money(r.analysis),
                                },
                                {
                                  key: 'change',
                                  header: '变化',
                                  numeric: true,
                                  render: (r) => (
                                    <div>
                                      {signedMoney(r.analysis - r.baseline)}
                                      <DeltaBadge value={relativeChange(r.analysis, r.baseline)} />
                                    </div>
                                  ),
                                },
                                {
                                  key: 'contribution',
                                  header: '贡献度',
                                  numeric: true,
                                  minWidth: 184,
                                  render: (r) => (
                                    <DivergingBar
                                      value={r.contribution}
                                      effect={r.analysis - r.baseline}
                                      scaleMax={Math.max(
                                        Number.EPSILON,
                                        ...registrationContributions.map((value) => Math.abs(value ?? 0)),
                                      )}
                                    />
                                  ),
                                },
                              ]}
                            />
                          ) : (
                            <p role="status">
                              {registrationError
                                ? '付费下钻读取失败，请关闭后重试。'
                                : !registrationData
                                  ? '正在读取付费下钻…'
                                  : registrationData.registrationStatus === 'table_missing'
                                    ? '注册明细 D1 表缺失，无法下钻；请检查数据同步。'
                                    : registrationData.registrationStatus === 'source_missing'
                                      ? '所选日期缺少支付订单注册明细，无法下钻；请检查数据同步。'
                                      : data.source === 'legacy'
                                        ? '历史口径没有可核对的注册明细，无法下钻。'
                                        : '此付费类型的注册明细缺失或与归因表按日金额不一致，无法下钻；请核对数据源。'}
                            </p>
                          )}
                          {registrationRows && (
                            <Definition label="付费下钻口径">
                              {registrationDimension === 'userLifecycle' ? '新用户指所在业务周内注册；' : ''}贡献度 =
                              该分层日均变化 ÷ 此付费类型日均总变化，抵消整体变化的分层为负。
                            </Definition>
                          )}
                        </section>
                      )}
                      {grouping !== 'payType' && (
                        <div className="payment-detail-types">
                          <h3>
                            {grouping === 'actualSupplier' || grouping === 'actualProvider'
                              ? '调用模型构成'
                              : '付费构成'}
                          </h3>
                          <DataTable
                            rows={detailTypes.map((row, index) => ({
                              ...row,
                              id: row.key,
                              contribution: detailContributions[index],
                            }))}
                            columns={[
                              {
                                key: 'entity',
                                header:
                                  grouping === 'actualSupplier' || grouping === 'actualProvider'
                                    ? '调用模型'
                                    : '付费类型',
                                render: (r) => (
                                  <span className="payment-brand-label">
                                    {(grouping === 'actualSupplier' || grouping === 'actualProvider') && (
                                      <ModelBrand model={r.key} />
                                    )}
                                    <span>{r.key}</span>
                                  </span>
                                ),
                              },
                              {
                                key: 'analysis',
                                header: '分析周日均',
                                numeric: true,
                                render: (r) => money(r.analysis),
                              },
                              {
                                key: 'change',
                                header: '变化',
                                numeric: true,
                                render: (r) => (
                                  <div>
                                    {signedMoney(r.analysis - r.baseline)}
                                    <DeltaBadge value={relativeChange(r.analysis, r.baseline)} />
                                  </div>
                                ),
                              },
                              {
                                key: 'contribution',
                                header: '贡献度',
                                numeric: true,
                                minWidth: 184,
                                render: (r) => (
                                  <DivergingBar
                                    value={r.contribution}
                                    effect={r.analysis - r.baseline}
                                    scaleMax={Math.max(
                                      Number.EPSILON,
                                      ...detailContributions.map((value) => Math.abs(value ?? 0)),
                                    )}
                                  />
                                ),
                              },
                            ]}
                          />

                          {!detailTypes.length && <p>该模型尚无归因收入。</p>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Drawer>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
