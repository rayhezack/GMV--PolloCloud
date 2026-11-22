import { useEffect, useState } from 'react';
import { getPaymentTrend } from '@/api/dashboard';
import type { DashboardPlatform, GmvAttributionType, PaymentTrendResponse } from '@shared/api.interface';
import { StackedBars } from '@/components/bencho/StackedBars';
import { entityLabel, type PaymentGrouping, type RevenueScope } from '@/components/dashboard/payment-analysis.data';
import { Definition, usd } from './primitives';
import { shiftDay } from './trend-data';
const colors = [
  'var(--v62-category-1)',
  'var(--v62-category-2)',
  'var(--v62-category-3)',
  'var(--v62-category-4)',
  'var(--v62-category-other)',
];
export default function PaymentComposition({
  platform,
  analysisPeriod,
  mode,
  scope,
  grouping,
  refreshToken,
  highlight,
}: {
  platform: DashboardPlatform;
  analysisPeriod: string;
  mode: GmvAttributionType;
  scope: RevenueScope;
  grouping: PaymentGrouping;
  refreshToken: number;
  highlight: string | null;
}) {
  const [data, setData] = useState<PaymentTrendResponse | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setError('');
    setData(null);
    void getPaymentTrend({
      platform,
      analysisPeriod,
      attributionType: mode,
      income: scope,
      groupBy: grouping,
      granularity: 'week',
      startDate: shiftDay(analysisPeriod, -49),
      endDate: shiftDay(analysisPeriod, 6),
      cacheBust: refreshToken,
    })
      .then((value) => {
        if (live) setData(value);
      })
      .catch(() => {
        if (live) setError('构成数据不可用');
      });
    return () => {
      live = false;
    };
  }, [platform, analysisPeriod, mode, scope, grouping, refreshToken]);
  const top = data?.series.slice(0, 4) || [],
    other = data?.series.slice(4) || [];
  const categories = [...top.map((item) => entityLabel(item.key)), ...(other.length ? ['其他'] : [])];
  const rows = (data?.points || [])
    .filter((point) => point.days > 0 && point.gmvUsd != null)
    .map((point) => ({
      label: `${point.period} — ${shiftDay(point.period, 6)} · ${point.days} 天`,
      short: point.period.slice(5).replace('-', '/'),
      values: [
        ...top.map((series) => (series.points.find((row) => row.period === point.period)?.gmvUsd || 0) / point.days),
        ...(other.length
          ? [
              other.reduce(
                (sum, series) => sum + (series.points.find((row) => row.period === point.period)?.gmvUsd || 0),
                0,
              ) / point.days,
            ]
          : []),
      ],
    }));
  const highlightIndex = highlight
    ? top.some((series) => series.key === highlight)
      ? top.findIndex((series) => series.key === highlight)
      : other.some((series) => series.key === highlight)
        ? 4
        : -1
    : -1;
  return (
    <section className="v62-composition">
      <header className="v62-panel-head">
        <h2>
          收入构成<span className="v62-unit">业务周日均 · USD</span>
          <Definition>
            最近 8 个业务周，按各周实际有数据天数计算日均；不完整周不补零。前四项按整个窗口 GMV
            排序，其余合并为其他。无数据周不画柱。各归因模式独立计算，不能相加。
          </Definition>
        </h2>
        <div className="v62-composition-legend">
          {categories.map((label, i) => (
            <span key={label} data-muted={highlightIndex >= 0 && highlightIndex !== i}>
              <i style={{ background: colors[i] }} />
              {label}
            </span>
          ))}
        </div>
      </header>
      {error ? (
        <div className="v62-state">{error}</div>
      ) : !data ? (
        <div className="v62-state" role="status">
          正在读取构成
        </div>
      ) : !rows.length ? (
        <div className="v62-state">暂无构成数据</div>
      ) : (
        <StackedBars
          data={rows}
          categories={categories}
          colors={colors.slice(0, categories.length)}
          highlightedCategory={highlightIndex < 0 ? null : highlightIndex}
          gap={4}
          formatValue={usd}
          ariaLabel="近八个业务周收入构成"
        />
      )}
    </section>
  );
}
