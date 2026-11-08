import { useId, useMemo, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { WalletCards, BadgePercent, UserRoundPlus, Workflow, RotateCw, Info, Music2, NotebookPen, CalendarDays, Plus } from 'lucide-react';
import { tightLineTicks } from '@/lib/chart-series';
import { CashBalanceChart } from '@/components/cash-balance-chart';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { revenueActionEvents, type RevenueMetric, type ProductActionSource, type RevenueEvent } from '@shared/product-actions';
import type { OverviewTrendPoint } from '@shared/api.interface';
import './revenue-action-chart.css';

const icons = { pricing: BadgePercent, payment: WalletCards, registration: UserRoundPlus, creation: Workflow, renewal: RotateCw, other: NotebookPen };
const actionIcon = (action: {title: string; kind: keyof typeof icons}) => /音乐|music/i.test(action.title) ? Music2 : icons[action.kind];
const timeOf = (date: string) => Date.parse(`${date}T00:00:00Z`);
const signedPercent = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(2)}%`;

export function RevenueActionInfo({title, source, period}: {title: string; source: ProductActionSource | null; period: string}) {
  return <Popover><PopoverTrigger asChild><button type="button" className="revenue-event-info" aria-label={`${title} 图表与产品动作口径`}><Info size={13} /></button></PopoverTrigger>
    <PopoverContent className="revenue-event-method" side="bottom" align="end">
      <strong>WoW · 较上周同日</strong>
      <p>WoW =（当日 GMV − 7 天前同日 GMV）÷ 7 天前同日 GMV。基准日无数据或 GMV 为 0 时不显示变化幅度。</p>
      {/^\d{4}-\d{2}-\d{2}$/.test(period) && <p>当前对比：{period} 与 {new Date(Date.parse(`${period}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10)}。</p>}
      <p>斜纹带表示展示日期内 GMV 的第 25 至 75 百分位区间。</p>
      <strong>产品动作标注</strong>
      <p>日环比或同星期周同比超出前 12 个完整业务周的 P95 / P05，且涨跌至少 10% 时标注；每张卡最多 4 个日期。</p>
      <p>浮层展示当前端当日全部动作；全端视图覆盖全部端。</p>
      {source?.lastSyncError && source.available && <p role="status">产品动作最近一次同步失败，当前展示上次成功入仓的数据（{source.readAt}）。</p>}
      {!source?.available && <p role="status">{source ? '产品动作暂不可用，请刷新重试。' : '正在读取产品动作…'}</p>}
    </PopoverContent>
  </Popover>;
}

export function RevenueActionChart({ rows, visibleRows, metric, color, title, platform, source, focusPeriod }: {
  rows: OverviewTrendPoint[]; visibleRows: OverviewTrendPoint[]; metric: RevenueMetric;
  color: string; title: string; platform: string; source: ProductActionSource | null;
  focusPeriod?: string | null;
}) {
  const [selectedEvent, setSelectedEvent] = useState<RevenueEvent | null>(null);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const detailId = useId();
  const reducedMotion = useReducedMotion();
  const start = visibleRows[0]?.period ?? '', end = visibleRows.at(-1)?.period ?? '';
  const events = useMemo(() => revenueActionEvents(rows, source?.actions ?? [], metric, platform, start, end), [rows, source, metric, platform, start, end]);
  const data = useMemo(() => visibleRows.filter(row => row[metric] != null && Number.isFinite(row[metric])).map(row => ({time: timeOf(row.period), value: Number(row[metric])})), [visibleRows, metric]);
  const ticks = useMemo(() => tightLineTicks(data.map(p => p.value)), [data]);
  const range = useMemo<[number, number] | null>(() => {
    if (data.length < 2) return null;
    const values = data.map(p => p.value).sort((a,b) => a-b);
    const quantile = (q: number) => { const pos = (values.length-1)*q, lo = Math.floor(pos), hi = Math.ceil(pos); return values[lo]+(values[hi]-values[lo])*(pos-lo); };
    const low = quantile(.25), high = quantile(.75);
    return high > low ? [low, high] : null;
  }, [data]);
  const transactions = useMemo(() => events.map(event => {
    return { id: event.date, time: timeOf(event.date), amount: 0, label: `${event.date} 产品动作`, icon: <CalendarDays size={13} />, tone: 'blue' as const };
  }), [events]);
  return <div className="revenue-action-chart" style={{'--revenue-line': color} as CSSProperties}>
    <CashBalanceChart chartOnly eventTimeline plotHeight={155} title={`${title} 日趋势`} data={data} range={range} ticks={ticks} summary={[]}
      focusTime={focusPeriod ? timeOf(focusPeriod) : undefined}
      transactions={transactions} locale="en-US" currency="USD"
      formatTime={(time, context) => context === 'axis' ? new Date(time).toISOString().slice(5, 10).replace('-', '/') : new Date(time).toISOString().slice(0, 10)}
      onTransactionClick={transaction => {
        setExpandedAction(null);
        setSelectedEvent(events.find(event => event.date === transaction.id) ?? null);
      }}
    />
    <Dialog open={selectedEvent !== null} onOpenChange={open => { if (!open) setSelectedEvent(null); }}>
      <DialogContent className="revenue-event-dialog">
        <DialogHeader><DialogTitle>{selectedEvent?.date} · 产品动作</DialogTitle>
          <DialogDescription>{title} {selectedEvent?.comparison === 'week' ? '较上周同日' : '较前一日'} {selectedEvent && signedPercent(selectedEvent.change)} · {platform === 'web' ? 'Web' : platform === 'app' ? 'App' : '全端'} 当日动作</DialogDescription>
        </DialogHeader>
        <div className="revenue-event-list">{selectedEvent?.actions.map(action => {
          const Icon = actionIcon(action);
          const expanded = expandedAction === action.id;
          const contentId = `${detailId}-${action.id}`;
          return <article key={action.id} data-expanded={expanded || undefined}>
            <h3><button type="button" className="revenue-event-trigger" aria-expanded={expanded} aria-controls={contentId}
              onClick={() => setExpandedAction(expanded ? null : action.id)}>
              <span className="revenue-event-list-icon"><Icon size={17} /></span>
              <span className="revenue-event-title">{action.title}</span>
              <motion.span className="revenue-event-toggle" aria-hidden animate={{rotate: expanded ? 45 : 0}}
                transition={reducedMotion ? {duration: 0} : {type: 'spring', stiffness: 380, damping: 24}}><Plus size={16} /></motion.span>
            </button></h3>
            <AnimatePresence initial={false}>
              {expanded && <motion.div key="detail" id={contentId} className="revenue-event-detail" role="region" aria-label={action.title}
                initial={{height: 0, opacity: 0}} animate={{height: 'auto', opacity: 1}} exit={{height: 0, opacity: 0}}
                transition={reducedMotion ? {duration: 0} : {height: {type: 'spring', stiffness: 340, damping: 27, mass: .8}, opacity: {duration: .18}}}>
                <div><p>{action.description}</p><small>{action.platform === 'web' ? 'Web' : action.platform === 'app' ? 'App' : action.platform || '未标注端'}{action.version ? ` · ${action.version}` : ''}{action.actionType ? ` · ${action.actionType}` : ''}{action.source ? ` · ${action.source}` : ''}</small></div>
              </motion.div>}
            </AnimatePresence>
          </article>;
        })}</div>
        <p className="revenue-event-caveat">来源：产品动作明细 · 上线日期</p>
      </DialogContent>
    </Dialog>
  </div>;
}
