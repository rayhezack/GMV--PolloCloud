import { FinanceOverviewAreaChart } from '@/components/finance-overview-area-chart';
import type { ChainFactor } from '@shared/chain-comparison';
import type { TrendBucket } from '@/components/v62/trend-data';
export function FactorTrend({
  factor,
  chainType,
  buckets,
  selectedDay,
  onSelect,
  granularity,
  onGranularityChange,
}: {
  factor?: ChainFactor;
  chainType: 'active' | 'renewal';
  buckets: TrendBucket[];
  selectedDay: string;
  onSelect: (date: string) => void;
  granularity: 'day' | 'week' | 'month';
  onGranularityChange: (value: 'day' | 'week' | 'month') => void;
}) {
  return (
    <aside className="chain-evidence" aria-label="因子趋势">
      {factor && (
        <FinanceOverviewAreaChart
          plotHeight={chainType === 'active' ? 300 : 200}
          title={factor.label}
          unit={factor.unit}
          buckets={buckets}
          selectedDay={selectedDay}
          onSelect={onSelect}
          granularity={granularity}
          onGranularityChange={onGranularityChange}
        />
      )}
    </aside>
  );
}
