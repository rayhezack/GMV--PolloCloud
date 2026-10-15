import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { BarChart3, CalendarRange, Check, ChevronDown, Copy, Expand, Info, LineChart, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { ActionNode, PullToRefresh } from '@/components/bencho';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
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
import { dashboardHref } from './navigation';

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

const TREND_RANGE_OPTIONS = [
  { value: 7, label: '近一周' },
  { value: 30, label: '近一个月' },
  { value: 90, label: '近一个季度' },
] as const;

function formatTrendDate(period: string) {
  return period.length >= 10 ? period.slice(5).replace('-', '/') : period;
}

function resolveTrendDialogYAxisDomain(
  rows: OverviewTrendPoint[],
  metric: RevenueMetric | null,
): [number, number] {
  const key = metric ?? 'totalGmv';
  const values = rows
    .map((row) => Number(row[key] ?? 0))
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

export function RevenueCards({
  items,
  loading,
  period,
  trend = [],
  dailyTrend = [],
  granularity = 'day',
  headlineStartDate,
  headlineEndDate,
}: {
  items: AttributionItem[];
  loading: boolean;
  period: string;
  trend?: OverviewTrendPoint[];
  dailyTrend?: OverviewTrendPoint[];
  granularity?: Granularity;
  analysisWeek?: string;
  baselineWeek?: string;
  headlineStartDate?: string;
  headlineEndDate?: string;
}) {
  const { search } = useLocation();
  const [trendDays, setTrendDays] = useState<Record<RevenueMetric, number>>({
    totalGmv: 30,
    activeGmv: 30,
    renewalGmv: 30,
  });
  const [chartTypes, setChartTypes] = useState<Record<RevenueMetric, 'bar' | 'line'>>({
    totalGmv: 'bar',
    activeGmv: 'bar',
    renewalGmv: 'bar',
  });
  const [expandedMetric, setExpandedMetric] = useState<RevenueMetric | null>(null);
  const [drillOpen, setDrillOpen] = useState(false);
  const [activePayType, setActivePayType] = useState('整体');
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
  const valueOf = (row: OverviewTrendPoint, metric: RevenueMetric) =>
    metric === 'activeGmv' && activePayType !== '整体'
      ? Number(row.activePayTypeGmv?.[activePayType] ?? 0)
      : Number(row[metric] ?? 0);
  const payTypeOptions = [
    '整体',
    ...Array.from(
      new Set(sourceRows.flatMap((row) => Object.keys(row.activePayTypeGmv ?? {}))),
    ).filter((key) => key !== '整体'),
  ];
  const definitions = [
    { key: '大盘 GMV', metric: 'totalGmv' as const, color: '#5B3FF2' },
    { key: '主动付费', metric: 'activeGmv' as const, color: '#25243D' },
    { key: '自动续订', metric: 'renewalGmv' as const, color: '#9B93CF' },
  ];
  const cards = definitions.map((definition) => ({
    ...definition,
    latestValue: latestRows.length ? valueOf(latestRows[latestRows.length - 1], definition.metric) : null,
    latestPeriod: latestRows.at(-1)?.period ?? period,
    previousValue: latestRows.at(-1)
      ? valueOf(
          comparisonRows.find((row) => row.period === addDays(latestRows.at(-1)!.period, -7)) ??
            ({} as OverviewTrendPoint),
          definition.metric,
        )
      : null,
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
        // Weekly card data already represents the complete selected window.
        // Do not apply the per-card 30-day slice, or a long global range would
        // silently lose all but the latest month.
        const miniRows = granularity === 'week'
          ? cardRows
          : rangeRows(cardRows, selectedDays, item.metric);
        const chartType = chartTypes[item.metric];
        return (
          <ActionNode
            key={item.key}
            className={cn(
              'revenue-card',
              !loading && item.latestValue !== null && 'revenue-card-ready',
              i === 0 && 'revenue-card-primary',
            )}
            rangeOptions={[...TREND_RANGE_OPTIONS]}
            selectedRange={selectedDays}
            onRangeChange={(value) => {
              setTrendDays((current) => ({ ...current, [item.metric]: value }));
            }}
            rangeIcon={CalendarRange}
            rangeLabel="选择趋势范围"
            actions={[
              {
                id: 'copy',
                label: '复制数值',
                Icon: Copy,
                onSelect: () =>
                  void copyAnalysis(
                    `${item.key} · ${item.latestPeriod} · ${money(item.latestValue ?? 0)}`,
                  ),
              },
              {
                id: 'definition',
                label: '查看指标口径',
                Icon: Info,
                href: dashboardHref('data', search),
              },
              ...(item.metric === 'activeGmv'
                ? [{
                    id: 'drilldown',
                    label: '切换主动付费类型',
                    Icon: ChevronDown,
                    onSelect: () => setDrillOpen((current) => !current),
                  }]
                : []),
              {
                id: 'chart-type',
                label: chartType === 'bar' ? '切换为折线图' : '切换为柱状图',
                Icon: chartType === 'bar' ? LineChart : BarChart3,
                onSelect: () =>
                  setChartTypes((current) => ({
                    ...current,
                    [item.metric]: chartType === 'bar' ? 'line' : 'bar',
                  })),
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
              <span>
                {item.key}
                {item.metric === 'activeGmv' && activePayType !== '整体' ? (
                  <span className="text-[11px] opacity-65"> · {activePayType}</span>
                ) : null}
              </span>
            </div>
            <motion.div
              className="revenue-card-body"
              data-picker={item.metric === 'activeGmv' && drillOpen || undefined}
              initial={false}
              animate={{ minHeight: item.metric === 'activeGmv' && drillOpen ? 202 : 148 }}
              transition={{ type: 'spring', duration: 0.42, bounce: 0.1 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {item.metric === 'activeGmv' && drillOpen ? (
                  <motion.div
                    key="picker"
                    className="revenue-drill-panel"
                    role="group"
                    aria-label="主动付费类型"
                    initial={{ opacity: 0, y: 9 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -7 }}
                    transition={{ duration: 0.18 }}
                  >
                    <div className="revenue-drill-heading">
                      <span>主动付费类型</span>
                      <button type="button" aria-label="关闭类型选择" onClick={() => setDrillOpen(false)}><X size={14} /></button>
                    </div>
                    {payTypeOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={activePayType === option}
                        onClick={() => {
                          setActivePayType(option);
                          setDrillOpen(false);
                        }}
                      >
                        <span>{option}</span>
                        {activePayType === option ? <Check size={14} aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </motion.div>
                ) : (
                  <motion.div
                    key={`${item.metric}-${item.metric === 'activeGmv' ? activePayType : 'overall'}`}
                    className="revenue-card-face"
                    initial={{ opacity: 0, y: 7 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -7 }}
                    transition={{ duration: 0.19 }}
                  >
                    <div>
                      <div className="revenue-number">
                        {loading || item.latestValue === null ? '—' : money(item.latestValue)}
                      </div>
                      <div className="revenue-date">{item.latestPeriod}</div>
                      <div className="revenue-foot">
                        <span className={change !== null && change < 0 ? 'text-red-600' : 'text-emerald-700'}>
                          {loading || change === null
                            ? '—'
                            : `${change >= 0 ? '↑' : '↓'} ${Math.abs(change * 100).toFixed(2)}% WoW`}
                        </span>
                      </div>
                    </div>
                    <MiniTrendBars
                      rows={miniRows}
                      metric={item.metric}
                      color={item.color}
                      formatValue={money}
                      label={`${item.key}近一个月${granularity === 'week' ? '周' : '日'}趋势`}
                      chartType={chartType}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </ActionNode>
        );
      })}
      <TrendDialog
        metric={expandedMetric}
        rows={granularity === 'week'
          ? (dailyTrend.length ? dailyTrend : trend)
          : rangeRows(
              dailyTrend.length ? dailyTrend : trend,
              expandedMetric ? trendDays[expandedMetric] : 30,
              expandedMetric ?? 'totalGmv',
            )}
        definitions={definitions}
        onClose={() => setExpandedMetric(null)}
      />
    </div>
  );
}

function TrendDialog({
  metric,
  rows,
  definitions,
  onClose,
}: {
  metric: RevenueMetric | null;
  rows: OverviewTrendPoint[];
  definitions: Array<{ key: string; metric: RevenueMetric; color: string }>;
  onClose: () => void;
}) {
  const definition = definitions.find((item) => item.metric === metric);
  const title = definition?.key ?? '趋势';
  const money = (value: number) => '$' + Math.round(value).toLocaleString('en-US');
  const yAxisDomain = resolveTrendDialogYAxisDomain(rows, metric);
  return (
    <Dialog open={metric !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl border-[#e7e7ef] bg-white p-6">
        <DialogHeader>
          <DialogTitle>{title}趋势</DialogTitle>
          <DialogDescription>按当前范围展示日趋势；近一个季度自动按业务周聚合。</DialogDescription>
        </DialogHeader>
        <div className="h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 12, right: 20, left: 4, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="#ececf3" />
              <XAxis dataKey="period" tickLine={false} axisLine={false} tickFormatter={formatTrendDate} />
              <YAxis domain={yAxisDomain} tickLine={false} axisLine={false} tickFormatter={(value) => money(Number(value))} width={78} />
              <Tooltip
                labelFormatter={(label) => formatTrendDate(String(label))}
                formatter={(value) => [money(Number(value)), title]}
              />
              <Area
                type="monotone"
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

function MiniTrendBars({
  rows,
  metric,
  color,
  formatValue,
  label,
  chartType,
}: {
  rows: OverviewTrendPoint[];
  metric: RevenueMetric;
  color: string;
  formatValue: (value: number) => string;
  label: string;
  chartType: 'bar' | 'line';
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const downRef = useRef(false);
  const values = useMemo(() => rows.map((row) => Number(row[metric] ?? 0)), [metric, rows]);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, min + 1);
  const spread = Math.max(max - min, 1);
  const hoveredValue = hovered === null ? null : values[hovered];
  if (chartType === 'line') {
    return (
      <div className="revenue-mini-chart" aria-label={label}>
        <PullToRefresh
          rows={rows.map((row) => ({ period: row.period, value: Number(row[metric] ?? 0) }))}
          color={color}
          formatValue={formatValue}
          formatDate={formatTrendDate}
          ariaLabel={label}
        />
      </div>
    );
  }
  const at = (clientX: number) => {
    const bounds = rowRef.current?.getBoundingClientRect();
    if (!bounds || !bounds.width || !values.length) return null;
    const index = Math.floor(((clientX - bounds.left) / bounds.width) * values.length);
    return Math.min(values.length - 1, Math.max(0, index));
  };
  const track = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' && !downRef.current) return;
    setHovered(at(event.clientX));
  };
  return (
    <div className="revenue-mini-chart" aria-label={label}>
      {hoveredValue !== null ? (
        <span className="revenue-mini-value">
          <strong>{formatValue(hoveredValue)}</strong>
          <span>{rows[hovered ?? 0] ? formatTrendDate(rows[hovered ?? 0].period) : ''}</span>
        </span>
      ) : null}
      <div
        ref={rowRef}
        className="revenue-mini-bars"
        role="img"
        aria-label={label}
        onPointerDown={(event) => {
          downRef.current = true;
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* scripted press */ }
          setHovered(at(event.clientX));
        }}
        onPointerMove={track}
        onPointerUp={() => { downRef.current = false; setHovered(null); }}
        onPointerCancel={() => { downRef.current = false; setHovered(null); }}
        onPointerLeave={() => { if (!downRef.current) setHovered(null); }}
      >
        {values.map((value, index) => (
          <span
            key={rows[index]?.period ?? index}
            className="revenue-mini-bar"
            data-hovered={hovered === index}
            style={{
              height: `${18 + ((value - min) / spread) * 82}%`,
              backgroundColor: color,
              '--bar-index': index,
            } as CSSProperties}
          />
        ))}
      </div>
    </div>
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
                <span className={cn('contribution-value contribution-wow', (item.wowChange ?? 0) < 0 ? 'text-red-600' : 'text-emerald-700')}>
                  {formatPercent(item.wowChange)}
                </span>
                <strong className={cn('contribution-value', (item.contribution ?? 0) < 0 ? 'text-red-600' : 'text-emerald-700')}>
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
