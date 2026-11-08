import { RevenueActionChart, RevenueActionInfo } from './RevenueActionChart';
import { getProductActions } from '@/api/dashboard';
import type { ProductActionSource } from '@shared/product-actions';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowDownToLine, BarChart3, Expand } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { ActionNode } from '@/components/bencho';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ExpensesChart, type ExpensesCategory, type ExpensesPeriod } from '@/components/expenses-chart';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import type { AttributionItem, Granularity, OverviewTrendPoint } from '@shared/api.interface';
import { getBusinessWeekStart } from '@shared/business-week';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export async function copyAnalysis(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('已复制');
  } catch {
    toast.error('复制失败，请重试');
  }
}

export function downloadCsv(
  filename: string,
  rows: Array<Array<string | number>>,
) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value);
          const safe = /^[=+@\t\r]/.test(text) ? `'${text}` : text;
          return `"${safe.replace(/"/g, '""')}"`;
        })
        .join(','),
    )
    .join('\r\n');
  const url = URL.createObjectURL(
    new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type RevenueMetric = 'totalGmv' | 'activeGmv' | 'renewalGmv';
export type RevenueHeadlineSummary = Partial<Record<RevenueMetric, { current: number; baseline: number; period: string }>>;

function formatTrendDate(period: string) {
  return period.length >= 10 ? period.slice(5).replace('-', '/') : period;
}

function resolveTrendDialogYAxisDomain(
  rows: Array<Partial<Record<RevenueMetric, number | null>>>,
  metric: RevenueMetric | null,
): [number, number] {
  const key = metric ?? 'totalGmv';
  const values = rows
    .filter((row) => row[key] != null)
    .map((row) => Number(row[key]))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return [0, 1];

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = Math.max(maxValue - minValue, Math.abs(maxValue) * 0.04, 1);
  const padding = span * 0.2;
  const lower = minValue >= 0 ? Math.max(0, minValue - padding) : minValue - padding;
  const upper = maxValue + padding;

  return lower === upper ? [lower - 1, upper + 1] : [lower, upper];
}

function rangeRows(
  rows: OverviewTrendPoint[],
  days: number,
  metric: RevenueMetric,
) {
  const selected = rows.slice(-days);
  if (days !== 90) return selected;
  const grouped = new Map<string, OverviewTrendPoint[]>();
  selected.forEach((row) => {
    const week = getBusinessWeekStart(row.period);
    const bucket = grouped.get(week) ?? [];
    bucket.push(row);
    grouped.set(week, bucket);
  });
  return [...grouped.entries()].map(([period, bucket]) => ({
    ...bucket[0],
    period,
    [metric]: bucket.reduce((sum, row) => sum + Number(row[metric] ?? 0), 0) / bucket.length,
  }));
}

function selectCardTrendRows(
  rows: OverviewTrendPoint[],
  days: number,
  metric: RevenueMetric,
  granularity: Granularity,
) {
  if (granularity !== 'week') return rangeRows(rows, days, metric);
  return rows.slice(-Math.max(1, Math.ceil(days / 7)));
}

export function RevenueCards({
  items,
  summary,
  structureItems = {},
  loading,
  period,
  trend = [],
  dailyTrend = [],
  zoomTrend = [],
  granularity = 'day',
  headlineStartDate,
  headlineEndDate,
}: {
  items: AttributionItem[];
  summary?: RevenueHeadlineSummary;
  structureItems?: Partial<Record<RevenueMetric, AttributionItem[]>>;
  loading: boolean;
  period: string;
  trend?: OverviewTrendPoint[];
  dailyTrend?: OverviewTrendPoint[];
  zoomTrend?: OverviewTrendPoint[];
  granularity?: Granularity;
  analysisWeek?: string;
  baselineWeek?: string;
  headlineStartDate?: string;
  headlineEndDate?: string;
}) {
  const { search } = useLocation();
  const trendDays: Record<RevenueMetric, number> = { totalGmv: 30, activeGmv: 30, renewalGmv: 30 };
  const [expandedMetric, setExpandedMetric] = useState<RevenueMetric | null>(null);
  const [exportMetric, setExportMetric] = useState<RevenueMetric | null>(null);
  const [structureMetric, setStructureMetric] = useState<RevenueMetric | null>(null);
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const focusMetricParam = searchParams.get('focusMetric');
  const focusMetric: RevenueMetric | null = focusMetricParam === 'totalGmv' || focusMetricParam === 'activeGmv' || focusMetricParam === 'renewalGmv'
    ? focusMetricParam
    : null;
  const focusPeriod = searchParams.get('focusPeriod') || searchParams.get('metricDate');
  const selectedPlatform = searchParams.get('platform') || 'all';
  const focusPlatform = searchParams.get('focusPlatform');
  const focusApplies = !focusPlatform || focusPlatform === selectedPlatform;
  const focusHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusMetric || !focusPeriod || loading || !focusApplies) {
      document.querySelectorAll('.revenue-card-focus').forEach((card) => card.classList.remove('revenue-card-focus'));
      return;
    }
    const focusKey = `${focusMetric}:${focusPeriod}`;
    if (focusHandledRef.current === focusKey) return;
    const card = document.querySelector<HTMLElement>(`.revenue-card-focus-${focusMetric}`);
    if (!card) return;
    focusHandledRef.current = focusKey;
    const bounds = card.getBoundingClientRect();
    const viewportBottom = window.innerHeight || document.documentElement.clientHeight;
    if (bounds.top < 12 || bounds.bottom > viewportBottom - 12) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
    card.classList.remove('revenue-card-focus');
    void card.offsetWidth;
    card.classList.add('revenue-card-focus');
    const timer = window.setTimeout(() => card.classList.remove('revenue-card-focus'), 2600);
    return () => window.clearTimeout(timer);
  }, [dailyTrend.length, focusApplies, focusMetric, focusPeriod, items.length, loading, trend.length]);
  const [actionSource, setActionSource] = useState<ProductActionSource | null>(null);
  useEffect(() => {
    let live = true;
    getProductActions().then(source => { if (live) setActionSource(source); }).catch(() => {
      if (live) setActionSource({actions: [], available: false, readAt: ''});
    });
    return () => { live = false; };
  }, [dailyTrend, selectedPlatform]);
  if (!trend.length && !items.length && !loading) return null;
  const addDays = (value: string, days: number) => {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const sourceRows = dailyTrend.length ? dailyTrend : trend;
  const comparisonRows = trend.length ? trend : sourceRows;
  const headlineRows = sourceRows.filter((row) =>
    (!headlineStartDate || row.period >= headlineStartDate) &&
    (!headlineEndDate || row.period <= headlineEndDate),
  );
  const latestRows = headlineRows.length ? headlineRows : sourceRows;
  const valueOf = (row: OverviewTrendPoint, metric: RevenueMetric) => Number(row[metric] ?? 0);
  const definitions = [
    { key: '大盘 GMV', metric: 'totalGmv' as const, color: '#5B3FF2' },
    { key: '主动付费', metric: 'activeGmv' as const, color: '#25243D' },
    { key: '自动续订', metric: 'renewalGmv' as const, color: '#9B93CF' },
  ];
  const cards = definitions.map((definition) => ({
    ...definition,
    latestValue: latestRows.length ? valueOf(latestRows[latestRows.length - 1], definition.metric) : summary?.[definition.metric]?.current ?? null,
    latestPeriod: latestRows.at(-1)?.period ?? summary?.[definition.metric]?.period ?? period,
    previousValue: latestRows.at(-1)
      ? valueOf(
          comparisonRows.find((row) => row.period === addDays(latestRows.at(-1)!.period, -7)) ??
            ({} as OverviewTrendPoint),
          definition.metric,
        )
      : summary?.[definition.metric]?.baseline ?? null,
  }));
  const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
  return (
    <div className="revenue-cards" aria-busy={loading}>
      {cards.map((item, i) => {
        const change = item.previousValue
          ? item.latestValue === null
            ? null
            : item.latestValue / item.previousValue - 1
          : null;
        const selectedDays = trendDays[item.metric];
        const cardRows = sourceRows.map((row) => ({ ...row, activeGmv: valueOf(row, 'activeGmv') }));
        // Keep the card's quick range independent from the global trend range.
        // Weekly source rows are sliced by business-week count in the helper.
        const miniRows = selectCardTrendRows(cardRows, selectedDays, item.metric, granularity);
        return (
          <ActionNode
            key={item.key}
            className={cn(
              'revenue-card',
              `revenue-card-focus-${item.metric}`,
              !loading && item.latestValue !== null && 'revenue-card-ready',
              i === 0 && 'revenue-card-primary',
            )}
            actions={[
              {
                id: 'export',
                label: '导出数据',
                Icon: ArrowDownToLine,
                onSelect: () => setExportMetric(item.metric),
              },
              {
                id: 'structure',
                label: item.metric === 'totalGmv'
                  ? '查看 GMV 构成'
                  : item.metric === 'activeGmv'
                    ? '查看主动付费构成'
                    : '查看自动续订构成',
                Icon: BarChart3,
                onSelect: () => setStructureMetric(item.metric),
              },
              {
                id: 'expand',
                label: '放大查看趋势',
                Icon: Expand,
                onSelect: () => setExpandedMetric(item.metric),
              },
            ]}
          >
            <div className="revenue-label">
              <span>{item.key}</span>
            </div>
            <motion.div
              className="revenue-card-body"
              initial={false}
              animate={{ minHeight: 148 }}
              transition={{ type: 'spring', duration: 0.42, bounce: 0.1 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                    key={item.metric}
                    className="revenue-card-face"
                    initial={{ opacity: 0, y: 7 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -7 }}
                    transition={{ duration: 0.19 }}
                  >
                    <div>
                      <div className="revenue-number-with-info">
                        <div className="revenue-number">
                          {loading || item.latestValue === null ? '—' : money(item.latestValue)}
                        </div>
                        <RevenueActionInfo title={item.key} source={actionSource} period={item.latestPeriod} />
                      </div>
                      <div className="revenue-date">{item.latestPeriod}</div>
                      <div className="revenue-foot">
                        <span className={change !== null && change < 0 ? 'text-destructive' : 'text-emerald-700'}>
                          {loading || change === null
                            ? '—'
                            : `${change >= 0 ? '↑' : '↓'} ${Math.abs(change * 100).toFixed(2)}% WoW`}
                        </span>
                      </div>
                    </div>
                    <RevenueActionChart rows={sourceRows} visibleRows={miniRows} metric={item.metric}
                      color={item.color} title={item.key} platform={selectedPlatform} source={actionSource} />
                </motion.div>
              </AnimatePresence>
            </motion.div>
          </ActionNode>
        );
      })}
      <Sheet open={exportMetric !== null} onOpenChange={(open) => { if (!open) setExportMetric(null); }}>
        <SheetContent className="payment-daily-sheet">
          <SheetHeader>
            <SheetTitle>{definitions.find((item) => item.metric === exportMetric)?.key ?? 'GMV'}明细</SheetTitle>
            <SheetDescription>按日期查看及导出趋势数据</SheetDescription>
          </SheetHeader>
          {exportMetric && (() => {
            const cardRows = sourceRows.map((row) => ({ ...row, activeGmv: valueOf(row, 'activeGmv') }));
            const rows = selectCardTrendRows(cardRows, trendDays[exportMetric], exportMetric, granularity)
              .map((row) => ({ period: row.period, value: Number(row[exportMetric] ?? 0) }));
            const title = definitions.find((item) => item.metric === exportMetric)?.key ?? 'GMV';
            const periodLabel = granularity === 'week' || trendDays[exportMetric] === 90 ? '业务周起始日' : '日期';
            return <>
              <div className="payment-daily-toolbar">
                <Button variant="ghost" disabled={!rows.length} onClick={() => downloadCsv(`Pollo-${title}-明细.csv`, [[periodLabel, `${title}_USD`], ...rows.map((row) => [row.period, row.value])])}>
                  <ArrowDownToLine size={14} />导出 CSV
                </Button>
              </div>
              <div className="payment-daily-table">
                <table className="w-full text-left text-sm"><thead><tr><th className="p-2">{periodLabel}</th><th className="p-2 text-right">{title} / USD</th></tr></thead><tbody>{rows.map((row) => <tr key={row.period} className="border-b border-slate-100"><td className="p-2">{row.period}</td><td className="p-2 text-right tabular-nums">{money(row.value)}</td></tr>)}</tbody></table>
              </div>
            </>;
          })()}
        </SheetContent>
      </Sheet>
      <TrendDialog
        metric={expandedMetric}
        rows={(zoomTrend.length ? zoomTrend : sourceRows).map((row) => ({ ...row, activeGmv: valueOf(row, 'activeGmv') }))}
        startDate={headlineStartDate}
        endDate={headlineEndDate}
        definitions={definitions}
        onClose={() => setExpandedMetric(null)}
      />
      <RevenueStructureDialog
        metric={structureMetric}
        items={structureMetric ? structureItems[structureMetric] ?? [] : []}
        definitions={definitions}
        currentPoint={latestRows.at(-1)}
        baselinePoint={latestRows.at(-1) ? comparisonRows.find(row => row.period === addDays(latestRows.at(-1)!.period, -7)) : undefined}
        daily={granularity === 'day'}
        onClose={() => setStructureMetric(null)}
      />
    </div>
  );
}

type DialogTrendGrain = 'day' | 'week' | 'month';

function aggregateDialogTrend(rows: OverviewTrendPoint[], metric: RevenueMetric, grain: DialogTrendGrain) {
  const grouped = new Map<string, OverviewTrendPoint[]>();
  for (const row of rows) {
    const period = grain === 'week' ? getBusinessWeekStart(row.period)
      : grain === 'month' ? row.period.slice(0, 7) : row.period;
    const bucket = grouped.get(period) ?? [];
    bucket.push(row);
    grouped.set(period, bucket);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, bucket]) => {
    const dates = [...new Set(bucket.map((row) => row.period))].sort();
    return {
      ...bucket[0],
      period,
      coverage: dates.length === 1 ? dates[0] : `${dates[0]} 至 ${dates.at(-1)}`,
      days: dates.length,
      [metric]: bucket.reduce((sum, row) => sum + Number(row[metric] ?? 0), 0) / dates.length,
    };
  });
}

function TrendDialog({
  metric,
  rows,
  startDate,
  endDate,
  definitions,
  onClose,
}: {
  metric: RevenueMetric | null;
  rows: OverviewTrendPoint[];
  startDate?: string;
  endDate?: string;
  definitions: Array<{ key: string; metric: RevenueMetric; color: string }>;
  onClose: () => void;
}) {
  const definition = definitions.find((item) => item.metric === metric);
  const title = definition?.key ?? '趋势';
  const money = (value: number) => '$' + Math.round(value).toLocaleString('en-US');
  const [grain, setGrain] = useState<DialogTrendGrain>('day');
  const [rangeDays, setRangeDays] = useState<30 | 90>(30);
  const rangeEnd = endDate ?? rows.at(-1)?.period;
  const rangeStart = rangeEnd ? new Date(Date.parse(`${rangeEnd}T00:00:00Z`) - (rangeDays - 1) * 86400000).toISOString().slice(0, 10) : undefined;
  const chartRows = useMemo(() => {
    const selected = rows.filter(row => (!rangeStart || row.period >= rangeStart) && (!rangeEnd || row.period <= rangeEnd));
    const aggregated = aggregateDialogTrend(selected, metric ?? 'totalGmv', grain);
    if (!rangeStart || !rangeEnd) return aggregated;
    const byPeriod = new Map(aggregated.map(row => [row.period, row]));
    const periods = new Set<string>();
    for (let time = Date.parse(`${rangeStart}T00:00:00Z`); time <= Date.parse(`${rangeEnd}T00:00:00Z`); time += 86400000) {
      const date = new Date(time).toISOString().slice(0, 10);
      periods.add(grain === 'week' ? getBusinessWeekStart(date) : grain === 'month' ? date.slice(0, 7) : date);
    }
    return [...periods].map(period => byPeriod.get(period) ?? {period, coverage: period, days: 0, totalGmv: null, activeGmv: null, renewalGmv: null});
  }, [grain, metric, rangeEnd, rangeStart, rows]);
  const yAxisDomain = resolveTrendDialogYAxisDomain(chartRows, metric);
  return (
    <Dialog open={metric !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl border-[#e7e7ef] bg-white p-6">
        <DialogHeader className="pr-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DialogTitle>{title}趋势</DialogTitle>
            <div className="revenue-dialog-controls">
              <div className="payment-trend-mode revenue-dialog-range" role="group" aria-label="放大趋势范围">
                {([30, 90] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={rangeDays === value} onClick={() => setRangeDays(value)}>
                    {value === 30 ? '近一个月' : '近一个季度'}
                  </button>
                ))}
              </div>
              <div className="payment-trend-mode revenue-dialog-grain" role="group" aria-label="趋势粒度">
                {(['day', 'week', 'month'] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={grain === value} onClick={() => setGrain(value)}>
                    {{ day: '日', week: '周', month: '月' }[value]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogDescription>
            按{{ day: '日', week: '业务周', month: '自然月' }[grain]}展示日均 GMV{rangeStart && rangeEnd ? `：${rangeStart} 至 ${rangeEnd}` : '。'}
          </DialogDescription>
        </DialogHeader>
        <div className="h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartRows} margin={{ top: 12, right: 20, left: 4, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="#ececf3" />
              <XAxis dataKey="period" tickLine={false} axisLine={false} tickFormatter={formatTrendDate} />
              <YAxis domain={yAxisDomain} tickLine={false} axisLine={false} tickFormatter={(value) => money(Number(value))} width={78} />
              <Tooltip
                cursor={{ stroke: '#e7e7ef', strokeDasharray: '4 4' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length || !payload[0].payload.days) return null;
                  const point = payload[0].payload as typeof chartRows[number];
                  return (
                    <div className="trend-tooltip revenue-dialog-tooltip">
                      <div className="trend-tooltip-date">{point.coverage}</div>
                      <div className="revenue-dialog-tooltip-row">
                        <i style={{ background: definition?.color ?? '#5B3FF2' }} />
                        <span>{title}日均 GMV</span>
                        <strong>{money(Number(point[metric ?? 'totalGmv']))}</strong>
                      </div>
                      {grain !== 'day' && <small>按 {point.days} 天计算日均</small>}
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                connectNulls={false}
                dataKey={metric ?? 'totalGmv'}
                stroke={definition?.color ?? '#5B3FF2'}
                fill={definition?.color ?? '#5B3FF2'}
                fillOpacity={0.16}
                strokeWidth={2.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RevenueStructureDialog({
  metric,
  items,
  definitions,
  currentPoint, baselinePoint, daily,
  onClose,
}: {
  metric: RevenueMetric | null;
  items: AttributionItem[];
  currentPoint?: OverviewTrendPoint;
  baselinePoint?: OverviewTrendPoint;
  daily: boolean;
  definitions: Array<{ key: string; metric: RevenueMetric; color: string }>;
  onClose: () => void;
}) {
  const title = `${definitions.find(item => item.metric === metric)?.key ?? 'GMV'}构成`;
  const colors: ExpensesCategory['color'][] = ['purple', 'blue', 'green', 'orange', 'yellow', 'teal'];
  const mapFor = (point?: OverviewTrendPoint) => !point || !metric ? undefined : metric === 'totalGmv' ? point.totalPayTypeGmv : metric === 'activeGmv' ? point.activePayTypeGmv : point.renewalPayTypeGmv;
  const current = mapFor(currentPoint) ?? Object.fromEntries(items.map(item => [item.key, item.analysisDailyAvg]));
  const baseline = mapFor(baselinePoint) ?? (currentPoint ? undefined : Object.fromEntries(items.map(item => [item.key, item.baselineDailyAvg])));
  const keys = [...new Set([...Object.keys(current), ...Object.keys(baseline ?? {})])];
  const categories: ExpensesCategory[] = keys.map((key, i) => ({ id: key, label: key, color: colors[i % colors.length] }));
  const periods: ExpensesPeriod[] = [
    { value: 'analysis', label: currentPoint?.period ?? '分析周', values: current, previous: baseline ? Object.values(baseline).reduce((sum, value) => sum + value, 0) : undefined, changeLabel: '较上周同期' },
    ...(baseline ? [{ value: 'baseline', label: baselinePoint?.period ?? '基准周', values: baseline }] : []),
  ];
  return (
    <Dialog open={metric !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="revenue-structure-dialog" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {keys.length ? <ExpensesChart key={metric} title={title} totalLabel={daily ? "GMV" : "日均 GMV"} categories={categories} periods={periods} defaultPeriod="analysis" currency="USD" locale="zh-CN" /> : <div className="revenue-structure-empty">暂无构成数据</div>}
      </DialogContent>
    </Dialog>
  );
}

export function ContributionBars({
  items,
  onSelect,
  selected,
  label = '增量贡献',
  formatLabel = (v: string) => v,
  expandedContent,
}: {
  items: AttributionItem[];
  onSelect?: (key: string) => void;
  selected?: string;
  label?: string;
  formatLabel?: (value: string) => string;
  expandedContent?: ReactNode;
}) {
  if (!items.length) return null;
  const formatValue = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`;
  const formatPercent = (value: number | null | undefined) =>
    value == null ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
  return (
    <div className="contribution-viz">
      <div className="contribution-table" role="table" aria-label={label}>
        <div className="contribution-table-head" role="row">
          <span>维度</span>
          <span>基准期日均</span>
          <span>分析期日均</span>
          <span>日均增量</span>
          <span>周环比</span>
          <span>贡献度</span>
        </div>
        {items.map((item) => {
          const delta = item.analysisDailyAvg - item.baselineDailyAvg;
          return (
            <div key={item.key}>
              <button className="contribution-bar-row contribution-table-row" aria-pressed={onSelect ? selected === item.key : undefined} onClick={() => onSelect?.(item.key)}>
                <span className="contribution-channel-label">{formatLabel(item.key)}</span>
                <span className="contribution-value contribution-baseline">{formatValue(item.baselineDailyAvg)}</span>
                <span className="contribution-value contribution-analysis">{formatValue(item.analysisDailyAvg)}</span>
                <span className="contribution-value">{delta >= 0 ? '+' : '−'}{formatValue(Math.abs(delta))}</span>
                <span className={cn('contribution-value contribution-wow', (item.wowChange ?? 0) < 0 ? 'text-destructive' : 'text-emerald-700')}>
                  {formatPercent(item.wowChange)}
                </span>
                <strong className={cn('contribution-value', (item.contribution ?? 0) < 0 ? 'text-destructive' : 'text-emerald-700')}>
                  {formatPercent(item.contribution)}
                </strong>
              </button>
              <AnimatePresence initial={false}>
                {selected === item.key && expandedContent && (
                  <motion.div className="contribution-inline-drill" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
                    {expandedContent}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
