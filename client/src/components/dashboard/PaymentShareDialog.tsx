import { useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { NetWorthChart } from '@/components/net-worth-chart';
import { niceTicks } from '@/lib/chart-series';
import type { PaymentTrendResponse } from '@shared/api.interface';
import { downloadCsv } from './AnalysisWidgets';
import { paymentShareTrend } from './payment-history';
import LoadingWave from './LoadingWave';

const formatShare = (value: number | null) => value == null ? '—' : `${(value * 100).toFixed(2)}%`;
const formatTick = (value: number) => `${+(value * 100).toFixed(2)}%`;
const formatDate = (date: string, context: 'axis' | 'tooltip') => context === 'axis' ? date.slice(5).replace('-', '/') : date;

export function PaymentShareDialog({ entity, label, history, error, context, onClose, onRetry }: {
  entity: string | null;
  label: string;
  history: PaymentTrendResponse | null;
  error: boolean;
  context: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const rows = useMemo(() => entity && history ? paymentShareTrend(history, entity) : [], [entity, history]);
  const points = useMemo(() => rows.map(row => ({ date: row.date, value: row.share })), [rows]);
  const ticks = useMemo(() => niceTicks(0, Math.max(.01, ...rows.map(row => row.share ?? 0)), 5), [rows]);
  const latest = rows.at(-1);
  const exportRows = () => downloadCsv(`${label}-GMV占比-${rows[0].date}-${latest!.date}.csv`, [
    ['日期', '付费类型', '筛选范围', '类型GMV(USD)', '范围总GMV(USD)', 'GMV占比'],
    ...rows.map(row => [row.date, label, context, row.gmv ?? '', row.totalGmv ?? '', row.share ?? '']),
  ]);
  return <Dialog open={entity != null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="payment-share-dialog">
      <DialogTitle className="sr-only">{label} GMV 占比趋势</DialogTitle>
      <DialogDescription className="sr-only">近 30 天日颗粒度。每日占比为该类型 GMV 除以当前筛选范围当日总 GMV。{context}</DialogDescription>
      {error ? <div className="payment-share-status" role="alert">占比趋势读取失败<Button variant="ghost" onClick={onRetry}>重新加载</Button></div>
        : !history ? <div className="payment-share-status" role="status"><LoadingWave label="正在读取占比趋势" /></div>
        : !latest ? <div className="payment-share-status">此范围暂无占比数据</div>
        : <NetWorthChart
            key={entity!}
            title={`${label} · GMV 占比`}
            data={points}
            ticks={ticks}
            total={latest.share}
            totalLabel={`最新日 · ${latest.date}　近 30 天 · ${context}`}
            formatValue={formatShare}
            formatTick={formatTick}
            formatDate={formatDate}
            viewDataLabel="导出明细"
            onViewDataClick={exportRows}
            locale="zh-CN"
          />}
    </DialogContent>
  </Dialog>;
}
