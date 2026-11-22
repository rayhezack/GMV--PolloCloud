import { ChartCard } from '@/components/ui/chart-card';
import { CashFlowAreaChart } from '@/components/cash-flow-area-chart';
import { PanelHeader, PanelState } from '@/components/system';
import { Segment } from '@/components/v62/primitives';
import { metricChange, metricValue } from '@shared/format';
import { cashFlowSeries, type TrendBucket } from '@/components/v62/trend-data';
import type { ChartUnit } from '@/components/charts/geometry';

type Props = {
  showSummary?: boolean;
  showRelativeDifference?: boolean;
  plotHeight?: number;
  title: string;
  unit: ChartUnit;
  unitLabel?: string;
  formatValue?: (value: number) => string;
  buckets: TrendBucket[];
  granularity: 'day' | 'week' | 'month';
  onGranularityChange: (value: 'day' | 'week' | 'month') => void;
  selectedDay: string;
  onSelect: (date: string) => void;
};
/** Business controls around the shared mebius Cash Flow Area chart. */
export function FinanceOverviewAreaChart({
  title,
  showRelativeDifference = true,
  showSummary = true,
  plotHeight = 240,
  unit,
  unitLabel,
  formatValue,
  buckets,
  granularity,
  onGranularityChange,
  selectedDay,
  onSelect,
}: Props) {
  const daily = granularity === 'day';
  const chosen = buckets.findIndex((b) => b.dates.includes(selectedDay));
  const index = chosen < 0 ? buckets.length - 1 : chosen;
  const current = buckets[index];
  const series = cashFlowSeries(buckets);
  const display = (value: number | null | undefined) =>
    value != null && Number.isFinite(value) ? (formatValue?.(value) ?? metricValue(value, unit)) : '—';
  return (
    <ChartCard className="chain-finance-chart" aria-label={`${title}趋势`}>
      <PanelHeader
        title={title}
        unit={`${daily ? '日值' : '日均'} · ${unitLabel ?? (unit === 'rate' ? '%' : unit === 'count' ? '人' : 'USD')}`}
        info="日：当日值与上周同日；周、月：按实际覆盖日期取日均。缺失日期断线。"
        tools={
          <Segment
            label="趋势粒度"
            value={granularity}
            onChange={onGranularityChange}
            items={[
              { value: 'day', label: '日' },
              { value: 'week', label: '周' },
              { value: 'month', label: '月' },
            ]}
          />
        }
      />
      {buckets.some((b) => Number.isFinite(b.value)) ? (
        <>
          <div className="chain-finance-legend">
            <span>
              <i />
              {daily ? '当日' : '日均'}
            </span>
            {daily && (
              <span>
                <i className="reference" />
                上周同日
              </span>
            )}
          </div>
          <CashFlowAreaChart
            title={`${title}趋势`}
            data={series.data}
            compare={daily ? series.compare : []}
            compareIndices={daily ? series.compareIndices : []}
            index={index}
            onIndexChange={(next) => onSelect(buckets[next].selectedDate)}
            showSummary={false}
            plotHeight={plotHeight}
            unit={unit}
            showRelativeDifference={showRelativeDifference}
            formatValue={formatValue}
            daily={daily}
            compareLabel="上周同日"
            partialLabels={Object.fromEntries(buckets.flatMap((b, i) => (b.partial ? [[i, b.partial]] : [])))}
            formatDate={(date, context) =>
              context === 'axis' ? date.slice(5).replace('-', '/') : date.slice(5).replace('-', '/')
            }
          />
          {showSummary && (
            <div className="chain-finance-summary">
              <div>
                <span>
                  {current?.date.slice(5).replace('-', '/')} · {daily ? '当日' : '日均'}
                </span>
                <strong>{display(current?.value)}</strong>
              </div>
              {daily && (
                <>
                  <div>
                    <span>上周同日</span>
                    <b>{display(current?.baseline)}</b>
                  </div>
                  <div>
                    <span>变化</span>
                    <b>{metricChange(current?.baseline, current?.value, unit)}</b>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <PanelState state="empty" reason="该日期无数据或快照未覆盖" />
      )}
    </ChartCard>
  );
}
