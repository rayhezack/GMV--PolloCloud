import { useEffect, useId, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { NetWorthChart } from '@/components/net-worth-chart';
import { getPaymentTrend } from '@/api/dashboard';
import { niceTicks } from '@/lib/chart-series';
import type { AppDeviceType, DashboardPlatform, PaymentTrendResponse } from '@shared/api.interface';
import { downloadCsv } from './AnalysisWidgets';
import { latestPaymentDate, paymentShareTrend, type PaymentShareRange } from './payment-history';
import LoadingWave from './LoadingWave';
import { formatChartTooltipValue } from '@/lib/chart-tooltip-format';

const formatShare = (value: number | null) => value == null ? '—' : `${(value * 100).toFixed(2)}%`;
const formatTick = (value: number) => `${+(value * 100).toFixed(2)}%`;
const ranges = [
  {value: 'week', label: '周', description: '近两周 · 日颗粒度'},
  {value: 'month', label: '月', description: '近一个月 · 业务周日均'},
  {value: 'year', label: '年', description: '当年 · 月日均'},
] as const;

export function PaymentShareDialog({ entity, label, history, error, context, platform, deviceType, analysisPeriod, scope, refreshToken, onClose, onRetry }: {
  entity: string | null;
  label: string;
  history: PaymentTrendResponse | null;
  error: boolean;
  context: string;
  platform: DashboardPlatform;
  deviceType?: AppDeviceType;
  analysisPeriod: string;
  scope: string;
  refreshToken: number;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [range, setRange] = useState<PaymentShareRange>('month');
  const [yearHistory, setYearHistory] = useState<PaymentTrendResponse | null>(null);
  const [yearError, setYearError] = useState(false), [retry, setRetry] = useState(0);
  const liquidId = useId(), reducedMotion = useReducedMotion();
  const [bubblePressed, setBubblePressed] = useState(false);
  const glassFilterId = `share-glass-${liquidId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const endDate = history ? latestPaymentDate(history) : undefined;
  const open = entity != null;
  useEffect(() => { setRange('month'); }, [entity]);
  useEffect(() => {
    setYearHistory(null);
    setYearError(false);
  }, [platform, deviceType, endDate, scope, refreshToken]);
  useEffect(() => {
    if (!open || range !== 'year' || !endDate || yearHistory) return;
    let active = true;
    setYearError(false);
    void getPaymentTrend({platform, deviceType, analysisPeriod, attributionType: 'NONE', income: scope, groupBy: 'payType', granularity: 'day', startDate: `${endDate.slice(0, 4)}-01-01`, endDate, cacheBust: refreshToken || retry || undefined})
      .then(result => { if (active) setYearHistory(result); })
      .catch(() => { if (active) setYearError(true); });
    return () => { active = false; };
  }, [open, range, endDate, platform, deviceType, analysisPeriod, scope, refreshToken, retry, yearHistory]);
  const source = range === 'year' ? yearHistory : history;
  const failed = range === 'year' ? yearError : error;
  const rows = useMemo(() => entity && source ? paymentShareTrend(source, entity, range) : [], [entity, source, range]);
  const points = useMemo(() => rows.map(row => ({ date: row.date, value: row.share })), [rows]);
  const ticks = useMemo(() => niceTicks(0, Math.max(.01, ...rows.map(row => row.share ?? 0)), 5), [rows]);
  const latest = rows.at(-1);
  const missingDays = rows.reduce((sum, row) => sum + row.missingDays, 0);
  const rangeLabel = ranges.find(item => item.value === range)!.description;
  const controls = <Tabs value={range} onValueChange={value => setRange(value as PaymentShareRange)}>
    <TabsList className="payment-attribution-tabs payment-share-range" aria-label="占比趋势范围"
      onPointerDown={() => setBubblePressed(true)} onPointerUp={() => setBubblePressed(false)} onPointerCancel={() => setBubblePressed(false)} onPointerLeave={() => setBubblePressed(false)}>
      <svg className="payment-glass-defs" aria-hidden="true" width="0" height="0"><defs><filter id={glassFilterId} x="-15%" y="-40%" width="130%" height="180%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency=".012 .025" numOctaves="1" seed="8" result="glass" />
        <feDisplacementMap in="SourceGraphic" in2="glass" scale="7" xChannelSelector="R" yChannelSelector="G" />
      </filter></defs></svg>
      {ranges.map(item => <TabsTrigger key={item.value} value={item.value} aria-label={item.description}>
        {range === item.value && <motion.span aria-hidden="true" className="payment-tab-pill" layoutId={liquidId} transition={reducedMotion ? {duration: 0} : {type: 'spring', stiffness: 360, damping: 26, mass: .75}}>
          <motion.span className="payment-tab-bubble" initial={false}
            style={{backdropFilter: `url(#${glassFilterId}) blur(3px) saturate(115%)`, WebkitBackdropFilter: 'blur(3px) saturate(115%)'}}
            animate={reducedMotion ? {scaleX: 1, scaleY: 1, rotate: 0} : bubblePressed ? {scaleX: 1.07, scaleY: 1.16, rotate: -1} : {scaleX: [1.07, .97, 1.025, 1], scaleY: [1.16, .94, 1.04, 1], rotate: [-1, 1.2, -.5, 0]}}
            transition={reducedMotion ? {duration: 0} : bubblePressed ? {duration: .13} : {duration: .5, times: [0, .4, .72, 1], ease: 'easeOut'}} />
        </motion.span>}
        <span className="payment-tab-label">{item.label}</span>
      </TabsTrigger>)}
    </TabsList>
  </Tabs>;
  const formatDate = (date: string, position: 'axis' | 'tooltip') => {
    const row = rows.find(row => row.date === date)!;
    return position === 'axis' ? range === 'year' ? `${+date.slice(5, 7)}月` : date.slice(5).replace('-', '/')
      : row.startDate === row.endDate ? row.startDate : `${row.startDate} — ${row.endDate}`;
  };
  const exportRows = () => downloadCsv(`${label}-GMV占比-${range}-${rows[0].startDate}-${latest!.endDate}.csv`, [
    ['周期起点', '范围开始', '范围结束', '天数', '缺失天数', '付费类型', '筛选范围', '类型日均GMV(USD)', '范围日均总GMV(USD)', 'GMV占比'],
    ...rows.map(row => [row.date, row.startDate, row.endDate, row.days, row.missingDays, label, context, row.dailyGmv ?? '', row.dailyTotalGmv ?? '', row.share ?? '']),
  ]);
  return <Dialog open={open} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="payment-share-dialog">
      <DialogTitle className="sr-only">{label} GMV 占比趋势</DialogTitle>
      <DialogDescription className="sr-only">{rangeLabel}。占比为所示周期内该类型日均 GMV 除以当前筛选范围日均总 GMV；首尾周期仅计算范围内已到达的日期。{context}</DialogDescription>
      <NetWorthChart
          key={entity}
          title={`${label} · GMV 占比`}
          headerActions={controls}
          grainLabel={range === 'week' ? '日颗粒度' : range === 'month' ? '业务周日均' : '月日均'}
          bodyContent={failed || !source || !latest ? <div className="payment-share-status" role={failed ? 'alert' : 'status'}>
            {failed ? <>占比趋势读取失败<Button variant="ghost" onClick={() => range === 'year' ? setRetry(value => value + 1) : onRetry()}>重新加载</Button></>
              : !source ? <LoadingWave label="正在读取占比趋势" /> : '此范围暂无占比数据'}
          </div> : undefined}
          data={points}
          ticks={ticks}
          total={latest?.share ?? null}
          totalLabel={range === 'week' ? '最新日占比' : range === 'month' ? '最新周占比' : '最新月占比'}
          infoContent={<>
            <strong>占比口径</strong>
            <p>{rangeLabel} · {context}</p>
            <p>{rows[0]?.startDate} — {latest?.endDate}</p>
            <p>占比 = 同期类型日均 GMV ÷ 范围日均总 GMV。</p>
            {range !== 'week' && <p>{range === 'month' ? '业务周为周六至周五。' : '按自然月汇总。'}首尾周期仅计算所选范围内已到达的日期，不含未来日期。</p>}
            <p>上方数值为最新{range === 'week' ? '一天' : range === 'month' ? '业务周' : '月份'}的占比。</p>
          </>}
          formatTooltipDetail={point => {
            const value = rows.find(row => row.date === point.date)?.dailyGmv;
            return `${range === 'week' ? 'GMV' : '日均 GMV'} ${value == null ? '—' : formatChartTooltipValue(value, 'currency')}`;
          }}
          formatValue={formatShare}
          formatTick={formatTick}
          formatDate={formatDate}
          viewDataLabel="导出明细"
          onViewDataClick={latest ? exportRows : undefined}
          locale="zh-CN"
        />
      {missingDays > 0 && <p className="payment-share-coverage" role="status">所选范围缺少 {missingDays} 天数据，涉及的周期留空。</p>}
    </DialogContent>
  </Dialog>;
}
