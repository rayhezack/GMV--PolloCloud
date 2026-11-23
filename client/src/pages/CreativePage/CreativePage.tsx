import { useEffect, useState } from 'react';
import { Selector } from '@astryxdesign/core/Selector';
import { getCreativeOverview, getDashboardAttributions } from '@/api/dashboard';
import type { CreativeOverviewResponse, DashboardAttributionsResponse } from '@shared/api.interface';
import { OperationalHeader } from '@/components/system/OperationalHeader';
import { useOperationalWindow } from '@/components/system/useOperationalWindow';
import { DataTable, KpiStrip, KpiItem, PanelHeader, PanelState, InfoTip, DeltaBadge } from '@/components/system';
import { WeekComparisonPicker } from '@/components/dashboard/WeekComparisonPicker';
import { FinanceOverviewAreaChart } from '@/components/finance-overview-area-chart';
import { Segment } from '@/components/v62/primitives';
import { shiftDay, revenueBuckets } from '@/components/v62/trend-data';
import { CREATION_TIER_ORDER } from '@shared/chain-comparison';
import { count, metricValue } from '@shared/format';
import {
  creativeMetrics,
  withRates,
  combine,
  creativeWeeklyPoint,
  type CreativeMetric,
  type CreativePoint,
} from './creative-data';
import '../operational-pages.css';
import '../ChainPage/chain.css';

const names: Record<string, string> = {
  create_cnt_30d_0: '近30日未创作',
  'create_cnt_30d_[1,11)': '近30日 1–10 次',
  'create_cnt_30d_[11,31)': '近30日 11–30 次',
  'create_cnt_30d_[31,101)': '近30日 31–100 次',
  'create_cnt_30d_[101,+inf)': '近30日 101+ 次',
};
const metricUnit = (key: string) => (key.endsWith('Rate') ? 'rate' : 'count');
export default function CreativePage() {
  const window = useOperationalWindow('creative');
  const { platform, deviceType, dateRange, latest, revision, availableWeeks } = window;
  const featureWeeks = window.weeks('creative'),
    tierWeeks = window.weeks('creativeTier');
  const [chain, setChain] = useState<CreativeOverviewResponse | null>(null),
    [tiers, setTiers] = useState<DashboardAttributionsResponse | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [tierError, setTierError] = useState('');
  const [functionsLoading, setFunctionsLoading] = useState(false);
  const [functionsError, setFunctionsError] = useState('');
  const [metric, setMetric] = useState('creationUserCnt'),
    [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day'),
    [horizon, setHorizon] = useState('3');
  const [feature, setFeature] = useState('__overall__'),
    [user, setUser] = useState('all'),
    [payGroup, setPayGroup] = useState('all'),
    [payTier, setPayTier] = useState('all'),
    [mode, setMode] = useState('day'),
    [tierMetric, setTierMetric] = useState('activeUv');
  useEffect(() => {
    if (!latest) return;
    let live = true;
    setLoading(true);
    setError('');
    setFunctionsLoading(true);
    setFunctionsError('');
    const request = {
      platform,
      deviceType,
      startDate: [shiftDay(dateRange.startDate, -7), featureWeeks.baselineWeek, featureWeeks.analysisWeek].sort()[0],
      endDate: [dateRange.endDate, shiftDay(featureWeeks.analysisWeek, 6), shiftDay(featureWeeks.baselineWeek, 6)]
        .sort()
        .at(-1)!,
      baselinePeriod: featureWeeks.baselineWeek,
      analysisPeriod: featureWeeks.analysisWeek,
      cacheBust: revision,
    };
    void getCreativeOverview({ ...request, view: 'summary' })
      .then(async (summary) => {
        if (!live) return;
        setChain(summary);
        setLoading(false);
        if (!summary.ready) return;
        try {
          const full = await getCreativeOverview(request);
          if (live && full.ready) setChain(full);
          else if (live) setFunctionsError('功能明细暂不可用，请刷新重试');
        } catch {
          if (live) setFunctionsError('功能明细读取失败，请刷新重试');
        }
      })
      .catch(() => {
        if (live) setError('创作数据读取失败');
      })
      .finally(() => {
        if (live) {
          setLoading(false);
          setFunctionsLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [
    platform,
    deviceType,
    dateRange.startDate,
    dateRange.endDate,
    latest,
    revision,
    featureWeeks.baselineWeek,
    featureWeeks.analysisWeek,
  ]);
  useEffect(() => {
    if (!latest) return;
    let live = true;
    setTiers(null);
    setTierError('');
    void getDashboardAttributions({
      platform,
      deviceType,
      granularity: 'week',
      dimension: 'creative',
      startDate: [tierWeeks.baselineWeek, tierWeeks.analysisWeek].sort()[0],
      endDate: shiftDay([tierWeeks.baselineWeek, tierWeeks.analysisWeek].sort().at(-1)!, 6),
      baselinePeriod: tierWeeks.baselineWeek,
      analysisPeriod: tierWeeks.analysisWeek,
      cacheBust: revision,
    })
      .then((result) => {
        if (live) setTiers(result);
      })
      .catch(() => {
        if (live) setTierError('创作分层读取失败，请刷新重试');
      });
    return () => {
      live = false;
    };
  }, [platform, deviceType, latest, revision, tierWeeks.baselineWeek, tierWeeks.analysisWeek]);
  const asOf = chain?.observedThrough || latest;
  const all = [...(chain?.trend || [])].sort((a, b) => a.period.localeCompare(b.period)).map((p) => withRates(p, asOf));
  const visible = all.filter((p) => p.period >= dateRange.startDate && p.period <= dateRange.endDate);
  const selectedMetric = creativeMetrics.find((m) => m.key === metric)!;
  const selectedDay = window.params.get('creativeSelectedDay') || visible.at(-1)?.period || dateRange.endDate;
  const selectedPoint = visible.find((p) => p.period === selectedDay) || visible.at(-1);
  const selectedIndex = selectedPoint ? all.findIndex((p) => p.period === selectedPoint.period) : -1;
  const kpis = [
    creativeMetrics[0],
    creativeMetrics[1],
    { ...creativeMetrics.find((m) => m.key === `d${horizon}Rate`)!, label: `D${horizon} 创作留存率` },
    creativeMetrics.find((m) => m.key === 'adoptionRate')!,
  ];
  const trend = revenueBuckets(
    all.map((p) => ({ period: p.period, totalGmv: p[selectedMetric.key] ?? NaN, activeGmv: 0, renewalGmv: 0 })),
    'totalGmv',
    dateRange.startDate,
    dateRange.endDate,
    granularity,
  );
  const functions = (chain?.functions || []).filter((f) => f.label !== '未归因');
  const featureNames = [...new Set(functions.map((f) => f.label))];
  const users = [...new Set(functions.map((f) => f.userType))];
  const tiersByPay = [...new Set(functions.map((f) => f.payGmv30d))].filter((t) => t !== '未付费');
  const filtered = functions.filter(
    (f) =>
      (feature === '__overall__' || f.label === feature) &&
      (user === 'all' || f.userType === user) &&
      (payGroup === 'all' ||
        (payGroup === 'unpaid'
          ? f.payGmv30d === '未付费'
          : f.payGmv30d !== '未付费' && (payTier === 'all' || f.payGmv30d === payTier))),
  );
  const days = [...new Set(filtered.flatMap((f) => f.daily.map((p) => p.period)))]
    .filter((d) => d >= dateRange.startDate && d <= dateRange.endDate)
    .sort()
    .reverse();
  const daily =
    feature === '__overall__'
      ? [...visible].reverse()
      : days.map((d) =>
          combine(
            filtered.flatMap((f) => f.daily.filter((p) => p.period === d)),
            d,
            asOf,
          ),
        );
  const columns = [
    ...creativeMetrics.filter((m) => ['creationUserCnt', 'creationTaskCnt', 'validCreationTaskCnt'].includes(m.key)),
    { key: 'successTaskCnt', label: '成功任务', format: count },
    ...creativeMetrics.filter((m) => ['requestRate', 'successRate', 'adoptionRate'].includes(m.key)),
    ...creativeMetrics.filter((m) => m.key.startsWith('d')),
  ] as CreativeMetric[];
  const weekPoint = (name: string, side: 'analysis' | 'baseline') => {
    const period = side === 'analysis' ? featureWeeks.analysisWeek : featureWeeks.baselineWeek;
    const dates = chain?.comparisonDates?.[side];
    const points = filtered
      .filter((f) => f.label === name)
      .flatMap((f) => f.daily)
      .filter((p) => (dates ? dates.includes(p.period) : p.period >= period && p.period <= shiftDay(period, 6)));
    return creativeWeeklyPoint(points, period, asOf, dates?.length || new Set(points.map((p) => p.period)).size);
  };
  const weekTools = (kind: 'feature' | 'tier') => (
    <WeekComparisonPicker
      availableEnd={asOf}
      availableWeeks={availableWeeks}
      {...(kind === 'tier' ? tierWeeks : featureWeeks)}
      onWeekChange={(v) =>
        window.update(
          kind === 'tier'
            ? {
                creativeTierBaselineWeek: v.baselineWeek || tierWeeks.baselineWeek,
                creativeTierAnalysisWeek: v.analysisWeek || tierWeeks.analysisWeek,
              }
            : {
                creativeBaselineWeek: v.baselineWeek || featureWeeks.baselineWeek,
                creativeAnalysisWeek: v.analysisWeek || featureWeeks.analysisWeek,
              },
        )
      }
    />
  );
  const numberCell = (p: CreativePoint, m: CreativeMetric) => {
    const value = p[m.key];
    const retention = m.key.match(/^d(3|7|30)/);
    const immature = retention && (Date.parse(asOf) - Date.parse(p.period)) / 86400000 < Number(retention[1]);
    return immature ? (
      <span className="ops-immature" aria-label="未成熟">
        <InfoTip label="未成熟">{`D${retention[1]} 留存尚未成熟`}</InfoTip>
      </span>
    ) : value == null ? (
      '—'
    ) : (
      m.format(value)
    );
  };
  return (
    <div className="v62-page v62-sheet-page operational-page" data-dashboard-ready={Boolean(chain?.ready) && !error}>
      <OperationalHeader title="创作积极性" window={window} loading={loading} />
      {error || window.error ? (
        <PanelState state="error" reason={error || window.error} onRetry={window.refresh} />
      ) : window.coverageLoading ? (
        <PanelState state="loading" />
      ) : !chain && loading ? (
        <PanelState state="loading" />
      ) : !chain?.ready ? (
        <PanelState state="empty" reason="所选日期暂无创作数据" />
      ) : (
        <>
          <KpiStrip>
            {kpis.map((m, i) => {
              const point =
                i === 2
                  ? all
                      .slice(0, selectedIndex + 1)
                      .filter((p) => p.period >= dateRange.startDate && p[m.key] != null)
                      .at(-1)
                  : selectedPoint;
              const previous = all.find((p) => p.period === shiftDay(point?.period || asOf, -7));
              const value = point?.[m.key],
                base = previous?.[m.key];
              const delta =
                value == null || base == null
                  ? null
                  : m.key.endsWith('Rate')
                    ? value - base
                    : base !== 0
                      ? (value - base) / base
                      : null;
              return (
                <KpiItem
                  key={m.key}
                  label={m.label}
                  value={value == null ? '—' : m.format(value)}
                  change={delta}
                  unit={m.key.endsWith('Rate') ? 'pp' : 'pct'}
                  info={m.formula}
                  baseline={`${point?.period || '—'} · 上周同日 ${base == null ? '—' : m.format(base)}`}
                  selected={metric === m.key}
                  onSelect={() => setMetric(m.key)}
                  actions={
                    i === 2 ? (
                      <Selector
                        label="创作留存窗口"
                        isLabelHidden
                        size="sm"
                        variant="ghost"
                        value={horizon}
                        onChange={setHorizon}
                        options={['3', '7', '30'].map((v) => ({ value: v, label: `D${v}` }))}
                      />
                    ) : undefined
                  }
                />
              );
            })}
          </KpiStrip>
          <div className="ops-primary-grid">
            <section className="ops-trend">
              <div className="ops-trend-selector">
                <Selector
                  label="创作趋势指标"
                  width="max-content"
                  isLabelHidden
                  variant="ghost"
                  size="sm"
                  value={metric}
                  onChange={setMetric}
                  options={creativeMetrics.map((m) => ({ value: m.key, label: m.label }))}
                />
              </div>
              <FinanceOverviewAreaChart
                title={selectedMetric.label}
                unit={metricUnit(metric)}
                unitLabel={
                  metric === 'avgCreationTaskCntPerCreator' ? '次／人' : metric.includes('Task') ? '次' : undefined
                }
                formatValue={selectedMetric.format}
                buckets={trend}
                selectedDay={selectedDay}
                onSelect={(date) => window.update({ creativeSelectedDay: date })}
                granularity={granularity}
                onGranularityChange={setGranularity}
              />
            </section>
            <section className="ops-panel">
              <PanelHeader
                title="创作分层"
                info="按分析期开始前30日创作次数分层，人数按相同业务日取日均，比率使用原子人数合计后计算。"
                tools={
                  <Selector
                    label="分层指标"
                    isLabelHidden
                    size="sm"
                    variant="ghost"
                    value={tierMetric}
                    onChange={setTierMetric}
                    options={['activeUv', 'creationUv', 'creationPenetrationRate', 'avgCreationTaskCntPerCreator'].map(
                      (v, i) => ({ value: v, label: ['活跃用户', '创作用户', '创作渗透率', '人均任务数'][i] }),
                    )}
                  />
                }
              />
              <div className="ops-panel-controls">{weekTools('tier')}</div>
              {!tiers && (
                <PanelState
                  state={tierError ? 'error' : 'loading'}
                  reason={tierError || undefined}
                  onRetry={window.refresh}
                />
              )}
              <DataTable
                rows={[...(tiers?.items || [])]
                  .sort(
                    (a, b) =>
                      (CREATION_TIER_ORDER as readonly string[]).indexOf(a.key) -
                      (CREATION_TIER_ORDER as readonly string[]).indexOf(b.key),
                  )
                  .map((item) => {
                    const value = (p: Record<string, number>) =>
                      tierMetric === 'creationPenetrationRate'
                        ? p.activeUv > 0
                          ? p.creationUv / p.activeUv
                          : null
                        : tierMetric === 'avgCreationTaskCntPerCreator'
                          ? p.activeUv > 0
                            ? p.creationTaskCnt / p.activeUv
                            : null
                          : (p[tierMetric] ?? null);
                    return {
                      id: item.key,
                      label: names[item.key] || item.key,
                      b: value(item.previousMetrics),
                      v: value(item.metrics),
                    };
                  })}
                columns={[
                  { key: 'label', header: '创作次数', minWidth: 124, render: (r) => r.label },
                  {
                    key: 'b',
                    minWidth: 72,
                    header: '基准期',
                    numeric: true,
                    render: (r) =>
                      tierMetric === 'avgCreationTaskCntPerCreator'
                        ? r.b?.toFixed(2) || '—'
                        : metricValue(r.b, metricUnit(tierMetric)),
                  },
                  {
                    key: 'v',
                    minWidth: 72,
                    header: '分析期',
                    numeric: true,
                    render: (r) =>
                      tierMetric === 'avgCreationTaskCntPerCreator'
                        ? r.v?.toFixed(2) || '—'
                        : metricValue(r.v, metricUnit(tierMetric)),
                  },
                  {
                    key: 'delta',
                    minWidth: 86,
                    header: '较基准周',
                    numeric: true,
                    render: (r) => (
                      <DeltaBadge value={r.b != null && r.b !== 0 && r.v != null ? (r.v - r.b) / r.b : null} />
                    ),
                  },
                ]}
              />
            </section>
          </div>
          <section className="ops-panel ops-feature">
            {(functionsLoading || functionsError) && (
              <PanelState
                state={functionsError ? 'error' : 'loading'}
                reason={functionsError || undefined}
                onRetry={window.refresh}
              />
            )}
            <PanelHeader
              title={`功能表现 · ${mode === 'week' ? '全部功能' : feature === '__overall__' ? '汇总' : feature}`}
              tools={
                <Segment
                  label="功能表现粒度"
                  value={mode}
                  onChange={setMode}
                  items={[
                    { value: 'day', label: '日' },
                    { value: 'week', label: '周对比' },
                  ]}
                />
              }
            />
            <div className="ops-panel-controls">
              {mode === 'day' && (
                <Selector
                  label="创作功能"
                  isLabelHidden
                  variant="ghost"
                  size="sm"
                  value={feature}
                  onChange={(v) => {
                    setFeature(v);
                    if (v === '__overall__') {
                      setUser('all');
                      setPayGroup('all');
                      setPayTier('all');
                    }
                  }}
                  options={[
                    { value: '__overall__', label: '汇总' },
                    ...featureNames.map((v) => ({ value: v, label: v })),
                  ]}
                />
              )}
              <Selector
                label="注册用户类型"
                isLabelHidden
                variant="ghost"
                size="sm"
                isDisabled={mode === 'day' && feature === '__overall__'}
                value={user}
                onChange={setUser}
                options={[
                  { value: 'all', label: '全部用户' },
                  ...users.map((v) => ({ value: v, label: v === 'NEW' ? '新用户' : v === 'OLD' ? '老用户' : v })),
                ]}
              />
              <Selector
                label="历史付费分组"
                isLabelHidden
                variant="ghost"
                size="sm"
                isDisabled={mode === 'day' && feature === '__overall__'}
                value={payGroup}
                onChange={(v) => {
                  setPayGroup(v);
                  setPayTier('all');
                }}
                options={[
                  { value: 'all', label: '全部付费分层' },
                  { value: 'unpaid', label: '未付费' },
                  { value: 'paid', label: '已付费' },
                ]}
              />
              {payGroup === 'paid' && (
                <Selector
                  label="付费金额分层"
                  isLabelHidden
                  variant="ghost"
                  size="sm"
                  value={payTier}
                  onChange={setPayTier}
                  options={[
                    { value: 'all', label: '全部金额区间' },
                    ...tiersByPay.map((v) => ({ value: v, label: v })),
                  ]}
                />
              )}
              <InfoTip>历史付费分层沿用滚动30日累计付费金额（USD），不代表当前日期收入。人数跨功能不可相加。</InfoTip>
              {mode === 'week' && weekTools('feature')}
            </div>
            <div className="ops-feature-scroll">
              <table className="ops-feature-table">
                <thead>
                  <tr>
                    <th rowSpan={2}>{mode === 'day' ? '日期' : '功能'}</th>
                    <th colSpan={4}>规模</th>
                    <th colSpan={3}>转化</th>
                    <th colSpan={6}>留存</th>
                  </tr>
                  <tr>
                    {columns.map((m) => (
                      <th key={m.key}>
                        {m.label}
                        {m.formula && <InfoTip label={`${m.label}口径`}>{m.formula}</InfoTip>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mode === 'day'
                    ? daily.map((p) => (
                        <tr key={p.period}>
                          <th>{p.period}</th>
                          {columns.map((m) => (
                            <td key={m.key}>{numberCell(p, m)}</td>
                          ))}
                        </tr>
                      ))
                    : featureNames.map((name) => {
                        const p = weekPoint(name, 'analysis'),
                          b = weekPoint(name, 'baseline');
                        return (
                          <tr key={name}>
                            <th>{name}</th>
                            {columns.map((m) => (
                              <td key={m.key}>
                                <div>{numberCell(p, m)}</div>
                                <DeltaBadge
                                  value={
                                    b[m.key] != null && p[m.key] != null
                                      ? m.key.endsWith('Rate')
                                        ? p[m.key]! - b[m.key]!
                                        : b[m.key] !== 0
                                          ? (p[m.key]! - b[m.key]!) / b[m.key]!
                                          : null
                                      : null
                                  }
                                  unit={m.key.endsWith('Rate') ? 'pp' : 'pct'}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
