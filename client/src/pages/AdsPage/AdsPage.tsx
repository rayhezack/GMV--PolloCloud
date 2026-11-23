import { useEffect, useState } from 'react';
import { Selector } from '@astryxdesign/core/Selector';
import { Search } from '@/components/bencho/Search';
import { getAdsOverview } from '@/api/dashboard';
import type { AdsOverviewResponse, AdsTrendPoint } from '@shared/api.interface';
import { OperationalHeader } from '@/components/system/OperationalHeader';
import { useOperationalWindow } from '@/components/system/useOperationalWindow';
import { DataTable, PanelHeader, PanelState, DivergingBar, DeltaBadge, KpiStrip, KpiItem } from '@/components/system';
import { FinanceOverviewAreaChart } from '@/components/finance-overview-area-chart';
import { WeekComparisonPicker } from '@/components/dashboard/WeekComparisonPicker';
import { shiftDay } from '@/components/v62/trend-data';
import { money, count, rate, shortDay } from '@shared/format';
import {
  dailyRoas,
  rankedCountries,
  adsBuckets,
  dailyLtv,
  ltvHorizons,
  type LtvHorizon,
  type AdsMetric,
  type Horizon,
} from './ads-data';
import { CohortPanel } from './CohortPanel';
import { CountryChannels } from './CountryChannels';
import '../operational-pages.css';
import '../ChainPage/chain.css';
import './ads.css';

export default function AdsPage() {
  const window = useOperationalWindow('ads');
  const { platform, dateRange, latest, revision, availableWeeks } = window;
  const weeks = window.weeks('ads');
  const [data, setData] = useState<AdsOverviewResponse | null>(null),
    [comparison, setComparison] = useState<AdsOverviewResponse | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [comparisonError, setComparisonError] = useState('');
  const [metric, setMetric] = useState<AdsMetric>('clicks'),
    [horizon, setHorizon] = useState<Horizon>('D0'),
    [ltvHorizon, setLtvHorizon] = useState<LtvHorizon>('D0'),
    [grain, setGrain] = useState<'day' | 'week' | 'month'>('day'),
    [countryMetric, setCountryMetric] = useState<'clicks' | 'costUsd' | 'registerUsers' | 'impressions'>('clicks'),
    [sort, setSort] = useState<'change' | 'scale'>('scale'),
    [search, setSearch] = useState(''),
    [channels, setChannels] = useState(false),
    [channelCountry, setChannelCountry] = useState('');
  useEffect(() => {
    if (!latest) return;
    let live = true;
    setLoading(true);
    setError('');
    setComparisonError('');
    setData(null);
    setComparison(null);
    Promise.all([
      getAdsOverview({
        platform,
        startDate: shiftDay(dateRange.startDate, -7),
        endDate: dateRange.endDate,
        baselinePeriod: weeks.baselineWeek,
        analysisPeriod: weeks.analysisWeek,
        cacheBust: revision,
      }).then((result) => {
        if (live) {
          setData(result);
          setLoading(false);
        }
        return result;
      }),
      getAdsOverview({
        platform,
        startDate: [weeks.baselineWeek, weeks.analysisWeek].sort()[0],
        endDate: shiftDay([weeks.baselineWeek, weeks.analysisWeek].sort().at(-1)!, 6),
        baselinePeriod: weeks.baselineWeek,
        analysisPeriod: weeks.analysisWeek,
        cacheBust: revision,
      }).catch(() => {
        if (live) setComparisonError('国家对比读取失败，请刷新重试');
        return null;
      }),
    ])
      .then(([a, b]) => {
        if (live) {
          setData(a);
          setComparison(b);
        }
      })
      .catch(() => {
        if (live) setError('广告数据读取失败');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [platform, dateRange.startDate, dateRange.endDate, latest, revision, weeks.baselineWeek, weeks.analysisWeek]);
  const asOf = data?.observedThrough || latest;
  const visible = (data?.trend || []).filter((p) => p.period >= dateRange.startDate && p.period <= dateRange.endDate);
  const selectedDay = window.params.get('adsSelectedDay') || visible.at(-1)?.period || dateRange.endDate;
  const point = visible.find((p) => p.period === selectedDay) || visible.at(-1);
  const previous = point ? data?.trend.find((p) => p.period === shiftDay(point.period, -7)) : undefined;
  const metrics = [
    {
      key: 'clicks',
      label: '点击量',
      unit: 'count' as const,
      format: count,
      value: (p: AdsTrendPoint) => p.clicks,
      info: '所选日广告点击次数，按来源口径汇总。',
    },
    {
      key: 'costUsd',
      label: '广告成本',
      unit: 'currency' as const,
      format: money,
      value: (p: AdsTrendPoint) => p.costUsd,
      info: '所选日投放成本，单位USD。',
    },
    {
      key: 'registerUsers',
      label: '注册用户',
      unit: 'count' as const,
      format: count,
      value: (p: AdsTrendPoint) => p.registerUsers,
      info: '广告归因注册用户，沿用来源口径。',
    },
    {
      key: 'roas',
      label: `${horizon} ROAS`,
      unit: 'count' as const,
      format: (n: number) => `${n.toFixed(2)}×`,
      value: (p: AdsTrendPoint) => dailyRoas(p, horizon, asOf),
      info: `同一注册Cohort的${horizon}累计GMV ÷ 获客成本。未成熟或数据缺失不计算。`,
    },
    {
      key: 'impressions',
      label: '展示量',
      unit: 'count' as const,
      format: count,
      value: (p: AdsTrendPoint) => p.impressions,
      info: '广告展示次数。',
    },
    {
      key: 'ctr',
      label: 'CTR',
      unit: 'rate' as const,
      format: rate,
      value: (p: AdsTrendPoint) => (p.impressions > 0 ? p.clicks / p.impressions : null),
      info: '点击量 / 展示量。',
    },
    {
      key: 'cpc',
      label: 'CPC',
      unit: 'currency' as const,
      format: (n: number) => `$${n.toFixed(2)}`,
      value: (p: AdsTrendPoint) => (p.clicks > 0 ? p.costUsd / p.clicks : null),
      info: '成本 / 点击量。',
    },
    {
      key: 'ltv',
      label: 'LTV',
      unit: 'currency' as const,
      format: (n: number) => `$${n.toFixed(2)}`,
      value: (p: AdsTrendPoint) => dailyLtv(p, ltvHorizon, asOf),
      info: `${ltvHorizon} 累计 GMV / 同一注册日的注册用户数。未到观察窗口不计算。`,
    },
    {
      key: 'cac',
      label: 'CAC',
      unit: 'currency' as const,
      format: (n: number) => `$${n.toFixed(2)}`,
      value: (p: AdsTrendPoint) => (p.registerUsers > 0 ? p.costUsd / p.registerUsers : null),
      info: '成本 / 注册用户。',
    },
  ];
  const selected = metrics.find((m) => m.key === metric)!;
  const trend = adsBuckets(
    data?.trend || [],
    metric,
    horizon,
    asOf,
    dateRange.startDate,
    dateRange.endDate,
    grain,
    ltvHorizon,
  );
  const core = ['clicks', 'cpc', 'costUsd', 'cac', 'ltv'].map((key) => metrics.find((m) => m.key === key)!);
  const table = comparison?.ready ? comparison : null;
  const days = table?.comparison?.analysisPeriodDays || 1,
    baseDays = table?.comparison?.baselinePeriodDays || 1;
  const totalChange = table?.totals
    ? table.totals.current[countryMetric] / days - table.totals.baseline[countryMetric] / baseDays
    : 0;
  const countries = rankedCountries(table?.countries || [], countryMetric, days, baseDays, sort, search);
  const rows = [
    ...(table?.totals ? [{ id: 'total', key: 'total', label: '合计', kind: 'total' as const, ...table.totals }] : []),
    ...countries.map((r) => ({ ...r, id: r.key, kind: 'row' as const })),
  ].map((r) => ({
    ...r,
    b: r.baseline[countryMetric] / baseDays,
    v: r.current[countryMetric] / days,
    d: r.current[countryMetric] / days - r.baseline[countryMetric] / baseDays,
  }));
  const scale = Math.max(
    0.00001,
    ...rows.filter((r) => r.id !== 'total').map((r) => Math.abs(totalChange === 0 ? 0 : r.d / totalChange)),
  );
  const countryFormat = countryMetric === 'costUsd' ? money : count;
  const request = {
    platform,
    startDate: [weeks.baselineWeek, weeks.analysisWeek].sort()[0],
    endDate: shiftDay([weeks.baselineWeek, weeks.analysisWeek].sort().at(-1)!, 6),
    baselinePeriod: weeks.baselineWeek,
    analysisPeriod: weeks.analysisWeek,
    cacheBust: revision,
  };
  return (
    <div
      className="v62-page v62-sheet-page operational-page ads-page"
      data-dashboard-ready={Boolean(data?.ready) && !error}
    >
      <OperationalHeader title="付费广告" window={window} loading={loading} />
      {error || window.error ? (
        <PanelState state="error" reason={error || window.error} onRetry={window.refresh} />
      ) : window.coverageLoading ? (
        <PanelState state="loading" />
      ) : !data && loading ? (
        <PanelState state="loading" />
      ) : !data?.ready ? (
        <PanelState state="empty" reason="所选日期暂无广告数据" />
      ) : (
        <>
          <section className="ads-core-kpis" aria-label="广告核心指标">
            <KpiStrip>
              {core.map((m) => {
                const value = point ? m.value(point) : null,
                  base = previous ? m.value(previous) : null;
                return (
                  <KpiItem
                    key={m.key}
                    label={m.label}
                    value={value == null ? '—' : m.format(value)}
                    change={value != null && base != null && base !== 0 ? value / base - 1 : null}
                    baseline={`${shortDay(point?.period)}${m.key === 'ltv' ? ` · ${ltvHorizon}` : ''} · 上周同日 ${base == null ? '—' : m.format(base)}`}
                    info={m.info}
                    selected={metric === m.key}
                    onSelect={() => setMetric(m.key as AdsMetric)}
                  />
                );
              })}
            </KpiStrip>
          </section>
          <div className="ads-overview-workspace">
            <section className="ops-trend ads-selected-trend">
              <div className="ads-trend-controls">
                <Selector
                  label="趋势指标"
                  isLabelHidden
                  variant="ghost"
                  size="sm"
                  value={metric}
                  onChange={(v) => setMetric(v as AdsMetric)}
                  options={metrics.map((m) => ({ value: m.key, label: m.label }))}
                />
                {metric === 'ltv' && <LtvWindow value={ltvHorizon} onChange={setLtvHorizon} />}
                {metric === 'roas' && (
                  <Selector
                    label="ROAS回收窗口"
                    isLabelHidden
                    variant="ghost"
                    size="sm"
                    value={horizon}
                    onChange={(v) => setHorizon(v as Horizon)}
                    options={['D0', 'D7', 'D30'].map((v) => ({ value: v, label: v }))}
                  />
                )}
              </div>

              <FinanceOverviewAreaChart
                title={selected.label}
                unit={selected.unit}
                showRelativeDifference={selected.key !== 'roas'}
                showSummary={false}
                plotHeight={360}
                unitLabel={selected.key === 'clicks' ? '次' : selected.key === 'roas' ? '倍' : undefined}
                formatValue={selected.format}
                buckets={trend}
                selectedDay={point?.period || selectedDay}
                onSelect={(date) => window.update({ adsSelectedDay: date })}
                granularity={grain}
                onGranularityChange={setGrain}
              />
            </section>
            <ChannelValueComparison
              channels={data.channelDaily || []}
              date={point?.period || selectedDay}
              horizon={ltvHorizon}
              onHorizon={setLtvHorizon}
              asOf={asOf}
            />
          </div>
          <CohortPanel
            data={data.cohortMatrix.filter((r) => r.key >= dateRange.startDate && r.key <= dateRange.endDate)}
            asOf={asOf}
          />
          <section className="ops-panel ads-country-panel">
            <PanelHeader
              title="国家对比"
              unit={countryMetric === 'costUsd' ? '日均 · USD' : '日均 · 次／人'}
              info={`分析：${table?.comparisonDates?.analysis.join('、') || '未覆盖'}；基准：${table?.comparisonDates?.baseline.join('、') || '未覆盖'}。按匹配业务日计算日均。贡献度=国家绝对变化/整体有符号净变化，条形方向表示绝对变化。未知国家置底。`}
              tools={
                <WeekComparisonPicker
                  availableEnd={asOf}
                  availableWeeks={availableWeeks}
                  {...weeks}
                  onWeekChange={(v) =>
                    window.update({
                      adsBaselineWeek: v.baselineWeek || weeks.baselineWeek,
                      adsAnalysisWeek: v.analysisWeek || weeks.analysisWeek,
                    })
                  }
                />
              }
            />
            <div className="ops-panel-controls">
              <Search placeholder="搜索国家" value={search} onChange={setSearch} />
              <Selector
                label="国家对比指标"
                isLabelHidden
                variant="ghost"
                size="sm"
                value={countryMetric}
                onChange={(v) => setCountryMetric(v as typeof countryMetric)}
                options={[
                  { value: 'clicks', label: '点击量' },
                  { value: 'costUsd', label: '广告成本' },
                  { value: 'impressions', label: '展示量' },
                  { value: 'registerUsers', label: '注册用户' },
                ]}
              />
              <Selector
                label="排序方式"
                isLabelHidden
                variant="ghost"
                size="sm"
                value={sort}
                onChange={(v) => setSort(v as typeof sort)}
                options={[
                  { value: 'change', label: '按变化排序' },
                  { value: 'scale', label: '按规模排序' },
                ]}
              />
            </div>
            {comparisonError && <PanelState state="error" reason={comparisonError} onRetry={window.refresh} />}
            {table ? (
              <DataTable
                rows={rows}
                stickyFirst
                columns={[
                  {
                    key: 'label',
                    minWidth: 140,
                    header: '国家',
                    render: (r) => (
                      <button
                        type="button"
                        className="ads-country-label"
                        disabled={r.id === 'total' || r.key === '__others__'}
                        aria-label={r.id === 'total' || r.key === '__others__' ? undefined : `分析${r.label}广告渠道`}
                        onClick={() => {
                          setChannelCountry(r.key);
                          setChannels(true);
                        }}
                      >
                        {/^[A-Z]{2}$/.test(r.key) && (
                          <img
                            src={`/assets/flags/${r.key.toLowerCase()}.svg`}
                            alt=""
                            width={22}
                            height={16}
                            loading="lazy"
                          />
                        )}
                        {r.label}
                      </button>
                    ),
                  },
                  { key: 'b', header: '基准周', numeric: true, render: (r) => countryFormat(r.b) },
                  { key: 'v', header: '分析周', numeric: true, render: (r) => countryFormat(r.v) },
                  {
                    key: 'd',
                    header: '绝对变化',
                    numeric: true,
                    render: (r) => (
                      <span data-effect={r.d < 0 ? 'negative' : 'positive'}>
                        {r.d >= 0 ? '+' : '−'}
                        {countryFormat(Math.abs(r.d))}
                      </span>
                    ),
                  },
                  {
                    key: 'change',
                    header: '较基准周',
                    numeric: true,
                    render: (r) => <DeltaBadge value={r.b !== 0 ? r.d / r.b : null} />,
                  },
                  {
                    key: 'contribution',
                    header: '变化贡献度',
                    numeric: true,
                    minWidth: 184,
                    render: (r) =>
                      r.id === 'total' ? (
                        totalChange === 0 ? (
                          '—'
                        ) : (
                          '100%'
                        )
                      ) : (
                        <DivergingBar
                          value={totalChange !== 0 ? r.d / totalChange : null}
                          effect={r.d}
                          scaleMax={scale}
                        />
                      ),
                  },
                ]}
              />
            ) : (
              <PanelState state="empty" reason="对比周暂无数据" />
            )}
          </section>
          <CountryChannels
            open={channels}
            initialCountry={channelCountry}
            comparisonDates={table?.comparisonDates}
            onOpenChange={setChannels}
            countries={table?.countries || []}
            request={request}
            asOf={asOf}
            days={days}
            baseDays={baseDays}
          />
        </>
      )}
    </div>
  );
}

function ChannelValueComparison({
  channels,
  date,
  horizon,
  onHorizon,
  asOf,
}: {
  channels: NonNullable<AdsOverviewResponse['channelDaily']>;
  date: string;
  horizon: LtvHorizon;
  onHorizon: (h: LtvHorizon) => void;
  asOf: string;
}) {
  const values = channels
    .map((channel) => {
      const p = channel.trend.find((p) => p.period === date);
      return {
        key: channel.key,
        label: channel.label,
        cac: p && p.registerUsers > 0 ? p.costUsd / p.registerUsers : null,
        ltv: p ? dailyLtv(p, horizon, asOf) : null,
      };
    })
    .filter((p) => p.cac != null || p.ltv != null)
    .sort((a, b) => (b.cac || 0) - (a.cac || 0));
  const max = Math.max(1, ...values.flatMap((p) => [p.cac || 0, p.ltv || 0]));
  return (
    <section className="ads-channel-values">
      <PanelHeader
        title="渠道 CAC / LTV"
        unit={shortDay(date)}
        info="同一注册日的成本与所选窗口累计 GMV，分别除以该渠道注册用户数；未成熟不显示回收值。LTV窗口同步至LTV指标与趋势，CAC不受影响。"
        tools={<LtvWindow value={horizon} onChange={onHorizon} />}
      />
      <div className="ads-channel-legend">
        <span>
          <i />
          CAC
        </span>
        <span>
          <i />
          {horizon} LTV
        </span>
      </div>
      {values.length ? (
        <div className="ads-channel-list">
          {values.map((p) => (
            <article key={p.key}>
              <strong>
                <ChannelIcon channel={p.key} />
                {p.label}
              </strong>
              {(['cac', 'ltv'] as const).map((key) => (
                <div className="ads-channel-bar" data-metric={key} key={key}>
                  <span>
                    <i style={{ width: `${((p[key] || 0) / max) * 100}%` }} />
                  </span>
                  <b>{p[key] == null ? '—' : `$${p[key]!.toFixed(2)}`}</b>
                </div>
              ))}
            </article>
          ))}
        </div>
      ) : (
        <PanelState state="empty" reason="当日无渠道注册数据" />
      )}
    </section>
  );
}

function LtvWindow({ value, onChange }: { value: LtvHorizon; onChange: (v: LtvHorizon) => void }) {
  return (
    <Selector
      label="LTV观察窗口"
      isLabelHidden
      variant="ghost"
      size="sm"
      value={value}
      onChange={(v) => onChange(v as LtvHorizon)}
      options={ltvHorizons.map((value) => ({ value, label: `${value} LTV` }))}
    />
  );
}
function ChannelIcon({ channel }: { channel: string }) {
  return (
    <img
      src={`/assets/channels/${channel.toLowerCase()}.svg`}
      alt=""
      width={20}
      height={20}
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = '/assets/channels/unknown.svg';
      }}
    />
  );
}
