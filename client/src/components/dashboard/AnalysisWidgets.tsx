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
import { aggregateRevenueTrend, type RevenueGrain } from '@shared/revenue-trend';

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

export function RevenueCards({
  items,
  structureItems = {},
  loading,
  period,
  trend = [],
  dailyTrend = [],
  granularity = 'day',
  headlineStartDate,
  headlineEndDate,
}: {
  items: AttributionItem[];
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
  const { search, key: navigationKey } = useLocation();
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
      focusHandledRef.current = null;
      return;
    }
    const focusKey = `${navigationKey}:${selectedPlatform}:${focusMetric}:${focusPeriod}`;
    if (focusHandledRef.current === focusKey) return;
    const card = document.querySelector<HTMLElement>(`.revenue-card-focus-${focusMetric}`);
    if (!card) return;
    focusHandledRef.current = focusKey;
    const bounds = card.getBoundingClientRect();
    const viewportBottom = window.innerHeight || document.documentElement.clientHeight;
    if (bounds.top < 12 || bounds.bottom > viewportBottom - 12) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
  }, [dailyTrend.length, focusApplies, focusMetric, focusPeriod, items.length, loading, navigationKey, selectedPlatform, trend.length]);
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
  const headlineRows = sourceRows.filter(row => (!headlineStartDate || row.period >= headlineStartDate) && (!headlineEndDate || row.period <= headlineEndDate));
  const valueOf = (row: OverviewTrendPoint, metric: RevenueMetric) => Number(row[metric] ?? 0);
  const previousByDate = new Map(sourceRows.map(row => [row.period, row]));
  const definitions = [
    { key: '大盘 GMV', metric: 'totalGmv' as const, color: '#5B3FF2' },
    { key: '主动付费', metric: 'activeGmv' as const, color: '#25243D' },
    { key: '自动续订', metric: 'renewalGmv' as const, color: '#9B93CF' },
  ];
  const cards = definitions.map((definition) => ({
    ...definition,
    latestValue: headlineRows.length ? valueOf(headlineRows.at(-1)!, definition.metric) : null,
    latestPeriod: headlineRows.at(-1)?.period ?? period,
    previousValue: headlineRows.length ? previousByDate.get(addDays(headlineRows.at(-1)!.period, -7))?.[definition.metric] ?? null : null,
  }));
  const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
  return (
    <div className="revenue-cards" aria-busy={loading}>
      {cards.map((item, i) => {
        const change = item.previousValue && item.latestValue !== null
          ? item.latestValue / item.previousValue - 1 : null;
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
                      <div className="revenue-date">{headlineRows.length ? item.latestPeriod : '—'}</div>
                      <div className="revenue-foot">
                        <span className={change !== null && change < 0 ? 'text-destructive' : 'text-emerald-700'}>
                          {loading || change === null
                            ? '—'
                            : `${change >= 0 ? '↑' : '↓'} ${Math.abs(change * 100).toFixed(2)}% WoW`}
                        </span>
                      </div>
                    </div>
                    <RevenueActionChart rows={sourceRows} visibleRows={headlineRows} metric={item.metric}
                      focusPeriod={!loading && focusApplies && focusMetric === item.metric ? focusPeriod : null}
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
            const rows = headlineRows
              .map((row) => ({ period: row.period, value: Number(row[exportMetric] ?? 0) }));
            const title = definitions.find((item) => item.metric === exportMetric)?.key ?? 'GMV';
            const periodLabel = granularity === 'week' ? '业务周起始日' : '日期';
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
        rows={headlineRows}
        platform={selectedPlatform}
        source={actionSource}
        startDate={headlineStartDate}
        endDate={headlineEndDate}
        definitions={definitions}
        onClose={() => setExpandedMetric(null)}
      />
      <RevenueStructureDialog
        metric={structureMetric}
        items={structureMetric ? structureItems[structureMetric] ?? [] : []}
        definitions={definitions}
        currentPoint={headlineRows.at(-1)}
        baselinePoint={headlineRows.at(-1) ? previousByDate.get(addDays(headlineRows.at(-1)!.period, -7)) : undefined}
        daily={granularity === 'day'}
        onClose={() => setStructureMetric(null)}
      />
    </div>
  );
}

function TrendDialog({ metric, rows, startDate, endDate, definitions, platform, source, onClose }: {
  metric: RevenueMetric | null;
  rows: OverviewTrendPoint[];
  startDate?: string;
  endDate?: string;
  definitions: Array<{ key: string; metric: RevenueMetric; color: string }>;
  platform: string;
  source: ProductActionSource | null;
  onClose: () => void;
}) {
  const definition = definitions.find(item => item.metric === metric);
  const title = definition?.key ?? 'GMV';
  const [grain, setGrain] = useState<RevenueGrain>('day');
  useEffect(() => { if (metric) setGrain('day'); }, [metric]);
  const chartRows = useMemo(() => aggregateRevenueTrend(rows, metric ?? 'totalGmv', grain), [rows, metric, grain]);
  const last = chartRows.at(-1);
  return <Dialog open={metric !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="revenue-trend-dialog">
      <DialogHeader className="pr-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DialogTitle>{title}</DialogTitle>
          <div className="payment-trend-mode" role="group" aria-label="趋势粒度">
            {(['day', 'week', 'month'] as const).map(value => <button key={value} type="button" aria-pressed={grain === value} onClick={() => setGrain(value)}>
              {{day: '日', week: '周', month: '月'}[value]}
            </button>)}
          </div>
        </div>
        <DialogDescription>{startDate ?? rows[0]?.period} – {endDate ?? rows.at(-1)?.period} · {{day: '日趋势', week: '业务周日均', month: '月份日均'}[grain]}</DialogDescription>
      </DialogHeader>
      <div className="revenue-trend-value tabular-nums">{last ? '$' + Math.round(Number(last[metric ?? 'totalGmv'])).toLocaleString('en-US') : '—'}</div>
      {metric && <RevenueActionChart key={`${metric}:${grain}`} rows={rows} visibleRows={chartRows} metric={metric} color={definition?.color ?? '#5B3FF2'} title={title} platform={platform} source={source} plotHeight={360} grain={grain} buckets={chartRows} />}
    </DialogContent>
  </Dialog>;
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
