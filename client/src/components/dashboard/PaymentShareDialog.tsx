import { PaymentMetricSwitch } from './PaymentMetricSwitch';
import { paymentMetricLabel, type PaymentMetric } from '@shared/payment-metric';
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Segment } from '@/components/v62/primitives';
import { Button } from '@/components/ui/button';
import { NetWorthChart } from '@/components/net-worth-chart';
import { getPaymentTrend } from '@/api/dashboard';
import { niceTicks } from '@/lib/chart-series';
import type { AppDeviceType, DashboardPlatform, PaymentTrendResponse } from '@shared/api.interface';
import { downloadCsv } from './AnalysisWidgets';
import { latestPaymentDate, paymentShareTrend, type PaymentShareRange } from './payment-history';
import LoadingWave from './LoadingWave';

const formatShare = (value: number | null) => (value == null ? '—' : `${(value * 100).toFixed(2)}%`);
const formatTick = (value: number) => `${+(value * 100).toFixed(2)}%`;
const ranges = [
  { value: 'week', label: '周', description: '近两周 · 日颗粒度' },
  { value: 'month', label: '月', description: '近一个月 · 业务周日均' },
  { value: 'year', label: '年', description: '当年 · 月日均' },
] as const;

export function PaymentShareDialog({
  entity,
  initialMetric = 'gmv',
  allowOrders = false,
  label,
  history,
  error,
  context,
  platform,
  deviceType,
  analysisPeriod,
  scope,
  refreshToken,
  onClose,
  onRetry,
}: {
  entity: string | null;
  initialMetric?: PaymentMetric;
  allowOrders?: boolean;
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
  const [metric, setMetric] = useState<PaymentMetric>(initialMetric);
  const metricLabel = paymentMetricLabel(metric);
  const [range, setRange] = useState<PaymentShareRange>('month');
  const [yearHistory, setYearHistory] = useState<PaymentTrendResponse | null>(null);
  const [yearError, setYearError] = useState(false),
    [retry, setRetry] = useState(0);
  const endDate = history ? latestPaymentDate(history) : undefined;
  const open = entity != null;
  useEffect(() => {
    setRange('month');
    setMetric(initialMetric);
  }, [entity, initialMetric]);
  useEffect(() => {
    setYearHistory(null);
    setYearError(false);
  }, [platform, deviceType, endDate, scope, refreshToken]);
  useEffect(() => {
    if (!open || range !== 'year' || !endDate || yearHistory) return;
    let active = true;
    setYearError(false);
    void getPaymentTrend({
      platform,
      deviceType,
      analysisPeriod,
      attributionType: 'NONE',
      income: scope,
      groupBy: 'payType',
      granularity: 'day',
      startDate: `${endDate.slice(0, 4)}-01-01`,
      endDate,
      cacheBust: refreshToken || retry || undefined,
    })
      .then((result) => {
        if (active) setYearHistory(result);
      })
      .catch(() => {
        if (active) setYearError(true);
      });
    return () => {
      active = false;
    };
  }, [open, range, endDate, platform, deviceType, analysisPeriod, scope, refreshToken, retry, yearHistory]);
  const source = range === 'year' ? yearHistory : history;
  const failed = range === 'year' ? yearError : error;
  const rows = useMemo(
    () => (entity && source ? paymentShareTrend(source, entity, range, metric) : []),
    [entity, source, range, metric],
  );
  const points = useMemo(() => rows.map((row) => ({ date: row.date, value: row.share })), [rows]);
  const ticks = useMemo(() => niceTicks(0, Math.max(0.01, ...rows.map((row) => row.share ?? 0)), 5), [rows]);
  const latest = rows.at(-1);
  const missingDays = rows.reduce((sum, row) => sum + row.missingDays, 0);
  const rangeLabel = ranges.find((item) => item.value === range)!.description;
  const controls = (
    <div className="payment-share-controls">{allowOrders && <PaymentMetricSwitch label="占比分析指标" value={metric} onChange={setMetric} />}<Segment
      label="占比趋势范围"
      value={range}
      items={ranges}
      onChange={(value) => setRange(value as PaymentShareRange)}
    /></div>
  );
  const formatDate = (date: string, position: 'axis' | 'tooltip') => {
    const row = rows.find((row) => row.date === date)!;
    return position === 'axis'
      ? range === 'year'
        ? `${+date.slice(5, 7)}月`
        : date.slice(5).replace('-', '/')
      : row.startDate === row.endDate
        ? row.startDate.slice(5).replace('-', '/')
        : `${row.startDate.slice(5).replace('-', '/')}–${row.endDate.slice(5).replace('-', '/')}`;
  };
  const exportRows = () =>
    downloadCsv(`${label}-${metricLabel}占比-${range}-${rows[0].startDate}-${latest!.endDate}.csv`, [
      [
        '周期起点',
        '范围开始',
        '范围结束',
        '天数',
        '缺失天数',
        '付费类型',
        '筛选范围',
        `类型日均${metricLabel}`,
        `范围日均总${metricLabel}`,
        `${metricLabel}占比`,
      ],
      ...rows.map((row) => [
        row.date,
        row.startDate,
        row.endDate,
        row.days,
        row.missingDays,
        label,
        context,
        row.dailyGmv ?? '',
        row.dailyTotalGmv ?? '',
        row.share ?? '',
      ]),
    ]);
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="payment-share-dialog">
        <DialogTitle className="sr-only">{label} {metricLabel} 占比趋势</DialogTitle>
        <DialogDescription className="sr-only">
          {rangeLabel}。占比为所示周期内该类型日均{metricLabel} 除以当前筛选范围日均总{metricLabel}；首尾周期仅计算范围内已到达的日期。
          {context}
        </DialogDescription>
        <NetWorthChart
          key={entity}
          title={`${label} · ${metricLabel} 占比`}
          headerActions={controls}
          grainLabel={range === 'week' ? '日颗粒度' : range === 'month' ? '业务周日均' : '月日均'}
          bodyContent={
            failed || !source || !latest ? (
              <div className="payment-share-status" role={failed ? 'alert' : 'status'}>
                {failed ? (
                  <>
                    占比趋势读取失败
                    <Button
                      variant="ghost"
                      onClick={() => (range === 'year' ? setRetry((value) => value + 1) : onRetry())}
                    >
                      重新加载
                    </Button>
                  </>
                ) : !source ? (
                  <LoadingWave label="正在读取占比趋势" />
                ) : (
                  '此范围暂无占比数据'
                )}
              </div>
            ) : undefined
          }
          data={points}
          ticks={ticks}
          total={latest?.share ?? null}
          totalLabel={range === 'week' ? '最新日占比' : range === 'month' ? '最新周占比' : '最新月占比'}
          infoContent={
            <>
              <strong>占比口径</strong>
              <p>
                {rangeLabel} · {context}
              </p>
              <p>
                {rows[0]?.startDate} — {latest?.endDate}
              </p>
              <p>占比 = 同期类型日均{metricLabel} ÷ 范围日均总{metricLabel}。</p>
              {range !== 'week' && (
                <p>
                  {range === 'month' ? '业务周为周六至周五。' : '按自然月汇总。'}
                  首尾周期仅计算所选范围内已到达的日期，不含未来日期。
                </p>
              )}
              <p>上方数值为最新{range === 'week' ? '一天' : range === 'month' ? '业务周' : '月份'}的占比。</p>
            </>
          }
          formatValue={formatShare}
          formatTick={formatTick}
          formatDate={formatDate}
          viewDataLabel="导出明细"
          onViewDataClick={latest ? exportRows : undefined}
          locale="zh-CN"
        />
        {missingDays > 0 && (
          <p className="payment-share-coverage" role="status">
            所选范围缺少 {missingDays} 天数据，涉及的周期留空。
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
