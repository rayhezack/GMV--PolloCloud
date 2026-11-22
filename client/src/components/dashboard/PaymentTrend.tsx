import { chartTicks } from '@/components/charts/geometry';
import { entityColor } from '@shared/chart-colors';
import { paymentWeekBands, paymentTrendUnit } from '@shared/comparison-display';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { getPaymentTrend } from '@/api/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InvestmentPerformanceChart } from '@/components/investment-performance-chart';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { money } from '@shared/format';
import type { AppDeviceType, DashboardPlatform, GmvAttributionType, PaymentTrendResponse } from '@shared/api.interface';
import { entityLabel, type PaymentGrouping, type RevenueScope } from './payment-analysis.data';
import LoadingWave from './LoadingWave';
import { Segment } from '@/components/v62/primitives';

const ranges = { day: '近 30 天', week: '近 30 天', month: '近 30 天' };
export default function PaymentTrend({
  platform,
  deviceType,
  analysisPeriod,
  baselinePeriod,
  mode,
  scope,
  grouping,
  refreshToken,
  onDataChange,
  highlightedEntity,
}: {
  platform: DashboardPlatform;
  deviceType?: AppDeviceType;
  analysisPeriod: string;
  baselinePeriod: string;
  mode: GmvAttributionType;
  scope: RevenueScope;
  grouping: PaymentGrouping;
  refreshToken: number;
  onDataChange?: (data: PaymentTrendResponse | null) => void;
  highlightedEntity?: string | null;
}) {
  const [params, setParams] = useSearchParams();
  const granularity = (
    ['day', 'week', 'month', 'year'].includes(params.get('paymentGranularity') || '')
      ? params.get('paymentGranularity')
      : 'day'
  ) as PaymentTrendResponse['granularity'];
  const [data, setData] = useState<PaymentTrendResponse | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState('');
  const [legendHighlight, setLegendHighlight] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    onDataChange?.(null);
    void getPaymentTrend({
      platform,
      deviceType,
      analysisPeriod,
      attributionType: mode,
      granularity,
      income: scope,
      groupBy: grouping,
      cacheBust: refreshToken || retry || undefined,
    })
      .then((d) => {
        if (active) {
          setData(d);
          onDataChange?.(d);
          setSelected((old) =>
            old.filter((key) => d.series.some((s) => s.key === key)).length
              ? old.filter((key) => d.series.some((s) => s.key === key))
              : d.series.slice(0, 4).map((s) => s.key),
          );
        }
      })
      .catch((e) => {
        if (active) setError(e?.response?.data?.error || '趋势读取失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [platform, deviceType, analysisPeriod, mode, scope, grouping, granularity, refreshToken, retry]);
  const shown = (data?.series || []).filter((s) => selected.includes(s.key));
  // Keep every bucket and omit only missing readings; the chart breaks lines at those observations.
  const points = (data?.points || []).map((point, i) => ({
    date: point.period,
    values: Object.fromEntries(
      shown.flatMap((series) => {
        const value = series.points[i]?.gmvUsd;
        return value == null || !point.days ? [] : [[series.key, value / point.days]];
      }),
    ),
  }));
  const chartSeries = shown.map((series) => ({
    key: series.key,
    label: entityLabel(series.label),
    color: entityColor(entityLabel(series.label)),
  }));
  const ticks = chartTicks(points.flatMap((point) => Object.values(point.values)));
  const title =
    grouping === 'payType'
      ? '付费类型趋势'
      : grouping === 'actualSupplier'
        ? '渠道商趋势'
        : grouping === 'actualProvider'
          ? '厂商趋势'
          : mode === 'CREATION_MODE'
            ? '创作功能趋势'
            : mode === 'MODEL'
              ? '创作模型趋势'
              : '调用模型趋势';
  const toggle = (key: string) =>
    setSelected((current) =>
      current.includes(key) ? (current.length > 1 ? current.filter((k) => k !== key) : current) : [...current, key],
    );
  return (
    <Card className="payment-viz-card payment-revenue-card">
      <CardHeader className="payment-viz-head">
        <div>
          <CardTitle>{title}</CardTitle>
          <span className="payment-baseline">
            {paymentTrendUnit(
              granularity,
              ranges[granularity as keyof typeof ranges],
              (data?.endDate ?? analysisPeriod).slice(0, 4),
            )}
          </span>
        </div>
        <Segment
          label="趋势颗粒度"
          value={granularity}
          items={
            [
              { value: 'day', label: '日' },
              { value: 'week', label: '周' },
              { value: 'month', label: '月' },
              { value: 'year', label: '年' },
            ] as const
          }
          onChange={(value) =>
            setParams(
              (p) => {
                const next = new URLSearchParams(p);
                next.set('paymentGranularity', value);
                return next;
              },
              { replace: true },
            )
          }
        />
      </CardHeader>
      <CardContent className="payment-viz-content">
        <div className="payment-series-toolbar">
          <div className="payment-series-legend">
            {shown.map((s, i) => (
              <button
                type="button"
                key={s.key}
                aria-label={`突出显示${entityLabel(s.label)}`}
                onPointerEnter={() => setLegendHighlight(s.key)}
                onPointerLeave={() => setLegendHighlight(null)}
                onFocus={() => setLegendHighlight(s.key)}
                onBlur={() => setLegendHighlight(null)}
                onClick={() => toggle(s.key)}
              >
                <i style={{ background: entityColor(entityLabel(s.label)) }} />
                {entityLabel(s.label)}
              </button>
            ))}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="选择趋势类型">
                选择类型
                <ChevronDown size={12} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="payment-series-menu">
              <input
                aria-label="搜索趋势类型"
                placeholder="搜索类型"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div>
                {(data?.series || [])
                  .filter((s) => entityLabel(s.label).toLowerCase().includes(search.toLowerCase()))
                  .map((s) => (
                    <label key={s.key}>
                      <input type="checkbox" checked={selected.includes(s.key)} onChange={() => toggle(s.key)} />
                      {entityLabel(s.label)}
                    </label>
                  ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {loading ? (
          <div className="payment-line-chart payment-trend-loading" role="status" aria-label="正在读取趋势">
            <LoadingWave />
          </div>
        ) : error ? (
          <div className="payment-trend-state" role="alert">
            {error}
            <Button variant="ghost" onClick={() => setRetry((v) => v + 1)}>
              重试
            </Button>
          </div>
        ) : !data?.points.some((p) => p.days) ? (
          <div className="payment-trend-state">暂无数据</div>
        ) : (
          <InvestmentPerformanceChart
            key={`${mode}-${scope}-${grouping}-${granularity}`}
            title={title}
            series={chartSeries}
            data={points}
            ticks={ticks}
            plotHeight={224}
            highlightedSeries={
              legendHighlight ?? shown.find((s) => s.key === highlightedEntity || s.label === highlightedEntity)?.key
            }
            formatValue={money}
            formatAxis={(value) =>
              new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                notation: 'compact',
                maximumFractionDigits: 0,
              }).format(value)
            }
            formatDate={(date, context) =>
              granularity === 'year'
                ? context === 'axis'
                  ? `${+date.slice(5, 7)}月`
                  : `${date.slice(0, 4)}年${+date.slice(5, 7)}月 · 日均`
                : context === 'axis'
                  ? date.slice(5, 10).replace('-', '/')
                  : date
            }
            bands={
              granularity === 'day'
                ? paymentWeekBands(
                    points.map((p) => p.date),
                    baselinePeriod,
                    analysisPeriod,
                    data.endDate,
                  )
                : []
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
