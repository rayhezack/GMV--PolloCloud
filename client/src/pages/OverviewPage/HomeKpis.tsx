import { ArrowLeftRight, BarChart3, ChartNoAxesCombined, CreditCard, Expand, Percent, Repeat2 } from 'lucide-react';
import { ActionNode } from '@/components/bencho/ActionNode';
import { KpiStrip, KpiItem, PanelState } from '@/components/system';
import { count, day, money, rate } from '@shared/format';
import type { GmvAnomalyMetric, OverviewTrendPoint } from '@shared/api.interface';
import { homeMetrics, homeValue, type HomeMetric } from './home-data';
export function HomeKpis({
  rows,
  current,
  previous,
  selectedDay,
  metric,
  orders,
  onOrders,
  onSelect,
  onStructure,
  onExpand,
  loading,
  error,
  onRetry,
}: {
  rows: OverviewTrendPoint[];
  current?: OverviewTrendPoint;
  previous?: OverviewTrendPoint;
  selectedDay: string;
  metric: HomeMetric;
  orders: Partial<Record<HomeMetric, boolean>>;
  onOrders: (key: HomeMetric) => void;
  onSelect: (key: HomeMetric) => void;
  onStructure: (key: GmvAnomalyMetric) => void;
  onExpand: (key: HomeMetric) => void;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  return (
    <>
      <div className="home-kpis" aria-label="当日核心指标" aria-busy={loading}>
        {loading ? (
          <PanelState state="loading" />
        ) : error ? (
          <PanelState state="error" reason={error} onRetry={onRetry} />
        ) : (
          <KpiStrip>
            {homeMetrics.map((item, i) => {
              const isOrders = Boolean(orders[item.key]),
                isRate = item.key === 'renewalRate';
              const value = homeValue(current, item.key, isOrders),
                baseline = homeValue(previous, item.key, isOrders);
              const format = isRate ? rate : isOrders ? count : money;
              const label = isOrders ? (item.key === 'totalGmv' ? '大盘订单量' : '主动付费订单量') : item.label;
              const Icons = [ChartNoAxesCombined, CreditCard, Repeat2, Percent],
                Icon = Icons[i];
              const canOrder =
                item.key === 'totalGmv'
                  ? rows.some((p) => p.totalOrders != null)
                  : item.key === 'activeGmv' && rows.some((p) => p.activeOrders != null);
              return (
                <ActionNode
                  className="home-kpi-node"
                  showTrigger
                  key={item.key}
                  ariaLabel={`${label}操作`}
                  actions={[
                    ...(!isRate && !isOrders
                      ? [
                          {
                            id: 'structure',
                            label: `查看${label}构成`,
                            Icon: BarChart3,
                            onSelect: () => onStructure(item.key as GmvAnomalyMetric),
                          },
                        ]
                      : []),
                    { id: 'expand', label: `放大${label}趋势`, Icon: Expand, onSelect: () => onExpand(item.key) },
                    ...(canOrder
                      ? [
                          {
                            id: 'measure',
                            label: isOrders ? '切换 GMV 金额' : '切换订单量（订单当量）',
                            Icon: ArrowLeftRight,
                            onSelect: () => onOrders(item.key),
                          },
                        ]
                      : []),
                  ]}
                >
                  <KpiItem
                    label={label}
                    icon={<Icon size={15} />}
                    value={format(value)}
                    change={
                      value == null || baseline == null
                        ? null
                        : isRate
                          ? value - baseline
                          : baseline === 0
                            ? null
                            : value / baseline - 1
                    }
                    unit={isRate ? 'pp' : 'pct'}
                    baseline={`${day(selectedDay)}${isOrders ? ' · 订单当量' : ''} · 上周同日 ${format(baseline)}`}
                    info={item.tip}
                    selected={metric === item.key}
                    onSelect={() => onSelect(item.key)}
                  />
                </ActionNode>
              );
            })}
          </KpiStrip>
        )}
      </div>
    </>
  );
}
