import { RefreshButton } from '@/components/system/RefreshButton';
import './home.css';
import { PageHeader, PanelState, Modal } from '@/components/system';
import { day } from '@shared/format';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RevenueStructureDialog } from '@/components/dashboard/AnalysisWidgets';
import type {
  DashboardGmvAnomalyResponse,
  DashboardPlatform,
  GmvAnomalyMetric,
  OverviewTrendPoint,
} from '@shared/api.interface';
import { getDashboardOverview, invalidateDashboardCache } from '@/api/dashboard';
import { useDataCoverage } from '@/components/system/useDataCoverage';
import DateRangePicker from '@/components/dashboard/DashboardDateRangePicker';
import DailyActivityRail from '@/components/dashboard/DailyActivityRail';
import { WorkbenchIcon } from '@/components/icons/WorkbenchIcon';
import RevenueTrend from '@/components/v62/RevenueTrend';
import { HomeKpis } from './HomeKpis';
import { homeMetrics as metrics, homeBuckets, homeCalendarWindow, type HomeMetric } from './home-data';
import { FinanceOverviewAreaChart } from '@/components/finance-overview-area-chart';
import { count, rate } from '@shared/format';
import { revenueBuckets, shiftDay } from '@/components/v62/trend-data';
import PlatformSelect from '@/components/v62/PlatformSelect';
import ActiveProcess from '@/components/v62/ActiveProcess';
import { BudgetChart } from '@/components/budget-chart';
import { paymentComposition } from '@shared/home-attribution';

const compositionTones: Record<string, number> = {
  积分包: 72,
  自动续订: 60,
  首订: 49,
  套餐升级: 40,
  重置订阅周期: 32,
  API: 26,
  重新订阅: 20,
  套餐降级: 15,
};

const validDate = (value: string | null): value is string =>
  Boolean(
    value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value,
  );

export default function OverviewPage() {
  const [params, setParams] = useSearchParams();
  const platform: DashboardPlatform = ['all', 'web', 'app'].includes(params.get('platform') || '')
    ? (params.get('platform') as DashboardPlatform)
    : 'all';
  const deviceType =
    platform === 'app' && ['ios', 'android'].includes(params.get('deviceType') || '')
      ? (params.get('deviceType') as 'ios' | 'android')
      : undefined;
  const metric: HomeMetric = metrics.some((item) => item.key === params.get('metric'))
    ? (params.get('metric') as HomeMetric)
    : 'totalGmv';
  const granularity = ['day', 'week', 'month'].includes(params.get('granularity') || '')
    ? (params.get('granularity') as 'day' | 'week' | 'month')
    : 'day';

  const rowsScope = useRef('');
  const [rows, setRows] = useState<OverviewTrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const {
    coverage,
    loading: coverageLoading,
    error: coverageError,
  } = useDataCoverage('pay_type', platform, deviceType, revision);
  const [structureMetric, setStructureMetric] = useState<GmvAnomalyMetric | null>(null);
  const [expandedMetric, setExpandedMetric] = useState<HomeMetric | null>(null);
  const [orders, setOrders] = useState<Partial<Record<HomeMetric, boolean>>>({});
  const [monitor, setMonitor] = useState<DashboardGmvAnomalyResponse | null>(null);
  const update = useCallback(
    (values: Record<string, string | undefined>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          Object.entries(values).forEach(([key, value]) => (value == null ? next.delete(key) : next.set(key, value)));
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const defaultEnd = coverage?.endDate || '';
  const clamp = (date: string) =>
    coverage
      ? date < coverage.startDate
        ? coverage.startDate
        : date > coverage.endDate
          ? coverage.endDate
          : date
      : date;
  const endDate = clamp(validDate(params.get('trendEndDate')) ? params.get('trendEndDate')! : defaultEnd);
  const requestedStart = validDate(params.get('trendStartDate'))
    ? params.get('trendStartDate')!
    : endDate
      ? shiftDay(endDate, -29)
      : '';
  const startDate = clamp(requestedStart > endDate ? endDate : requestedStart);
  const calendarWindow = homeCalendarWindow(
    startDate,
    endDate,
    validDate(params.get('trendStartDate')) || validDate(params.get('trendEndDate')),
  );
  const readStart = [startDate, calendarWindow.startDate].sort()[0];
  useEffect(() => {
    if (!readStart || !endDate) return;
    let live = true;
    setLoading(true);
    setError('');
    const scope = [platform,deviceType,readStart,endDate].join('|');
    if (rowsScope.current !== scope) setRows([]);
    rowsScope.current = scope;
    void getDashboardOverview({
      view: 'cards',
      includeRenewal: 'true',
      platform,
      deviceType,
      granularity: 'day',
      startDate: shiftDay(readStart, -7),
      endDate,
      cacheBust: revision,
    })
      .then((value) => {
        if (live) setRows(value.payTypeTrend ?? value.trend);
      })
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : '趋势数据读取失败');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [platform, deviceType, readStart, endDate, revision]);
  const visibleDays = rows.filter((row) => row.period >= startDate && row.period <= endDate);
  const candidate = params.get('focusPeriod') || params.get('selectedDay');
  const selectedDay = rows.some(
    (row) => row.period === candidate && row.period >= calendarWindow.startDate && row.period <= endDate,
  )
    ? candidate!
    : visibleDays.at(-1)?.period || endDate;
  const current = rows.find((row) => row.period === selectedDay);
  const composition = useMemo(() => paymentComposition(current), [current]);
  const previous = selectedDay ? rows.find((row) => row.period === shiftDay(selectedDay, -7)) : undefined;
  const selectedMetric = metrics.find((item) => item.key === metric)!;
  const buckets = useMemo(
    () => homeBuckets(rows, metric, Boolean(orders[metric]), startDate, endDate, granularity),
    [rows, metric, orders, startDate, endDate, granularity],
  );
  const selectDay = useCallback(
    (date: string) =>
      update({
        selectedDay: date,
        focusPeriod: undefined,
        focusMetric: undefined,
        focusPlatform: undefined,
        focusWindow: undefined,
      }),
    [update],
  );
  const financialMetric = metric === 'renewalRate' ? 'renewalGmv' : metric;
  const selectedTitle = orders[metric]
    ? metric === 'totalGmv'
      ? '大盘订单量'
      : '主动付费订单量'
    : selectedMetric.label;
  const kpis = (
    <HomeKpis
      rows={visibleDays}
      current={current}
      previous={previous}
      selectedDay={selectedDay}
      metric={metric}
      orders={orders}
      onOrders={(key) => {
        setOrders((old) => ({ ...old, [key]: !old[key] }));
        update({ metric: key });
      }}
      onSelect={(key) => update({ metric: key })}
      onStructure={setStructureMetric}
      onExpand={setExpandedMetric}
      loading={loading && !rows.length}
      error={error}
      onRetry={() => setRevision((v) => v + 1)}
    />
  );
  const header = (freshness?: React.ReactNode) => (
    <>
      <PageHeader
        title="GMV 趋势"
        tools={
          <>
            {freshness}
            {coverage && startDate && endDate && (
              <DateRangePicker
                selectedRange={{ startDate, endDate }}
                availableRange={coverage}
                onRangeChange={(range) =>
                  update({
                    trendStartDate: range.startDate,
                    trendEndDate: range.endDate,
                    selectedDay: undefined,
                    focusPeriod: undefined,
                  })
                }
              />
            )}
            <PlatformSelect value={platform} onChange={(value) => update({ platform: value })} />
            <RefreshButton loading={loading || coverageLoading} onRefresh={() => { setLoading(true); invalidateDashboardCache(); setRevision(value => value + 1); }} label="刷新数据" />
            <Link
              className="v62-icon-button"
              aria-label="诊断报告"
              to={`/report?platform=${platform === 'all' ? 'web' : platform}`}
            >
              <WorkbenchIcon name="file-chart" />
            </Link>
          </>
        }
      />
      {kpis}
    </>
  );
  return (
    <div
      className="v62-page v62-sheet-page"
      data-page="gmv-trend"
      data-dashboard-ready={!loading && rows.length > 0 && !error}
    >
      {!endDate ? (
        <>
          {header()}
          <PanelState
            state={error || coverageError ? 'error' : coverageLoading ? 'loading' : 'empty'}
            reason={error || coverageError || (!coverageLoading ? '暂无付费数据' : undefined)}
            onRetry={() => setRevision((v) => v + 1)}
          />
        </>
      ) : (
        <DailyActivityRail
          renderHeader={header}
          platform={platform}
          deviceType={deviceType}
          refreshToken={revision}
          selectedDay={selectedDay}
          onSelectedDayChange={selectDay}
          trendWindow={{ startDate, endDate }}
          calendarWindow={calendarWindow}
          calendarRows={rows}
          onMonitoringChange={(value) => setMonitor(deviceType ? null : value)}
          renderProcess={(state) => (
            <ActiveProcess
              {...state}
              alerts={deviceType ? [] : state.alerts}
              date={selectedDay}
              platform={platform}
              deviceType={deviceType}
              metric={financialMetric}
              refreshToken={revision}
              currentPoint={current}
              baselinePoint={previous}
            />
          )}
        >
          <div className="home-trend-stack">
            {metric === 'renewalRate' || orders[metric] ? (
              <FinanceOverviewAreaChart
                title={selectedTitle}
                plotHeight={380}
                showSummary={false}
                unit={metric === 'renewalRate' ? 'rate' : 'count'}
                unitLabel={metric === 'renewalRate' ? '%' : '订单当量'}
                formatValue={metric === 'renewalRate' ? rate : count}
                buckets={buckets}
                selectedDay={selectedDay}
                onSelect={selectDay}
                granularity={granularity}
                onGranularityChange={(value) => update({ granularity: value })}
              />
            ) : (
              <RevenueTrend
                plotHeight={380}
                compact
                cashFlow
                title={selectedTitle}
                buckets={buckets}
                selectedDay={selectedDay}
                onSelect={selectDay}
                granularity={granularity}
                onGranularityChange={(value) => update({ granularity: value })}
                onFullRange={() => update({ trendStartDate: coverage?.startDate, trendEndDate: coverage?.endDate })}
                anomalyDates={[
                  ...(monitor?.anomalyDates ?? []),
                  ...(monitor?.alerts ?? []).map((alert) => alert.period),
                ]}
                loading={loading && !rows.length}
              />
            )}
            {loading && !rows.length ? (
              <div className="home-composition-state">
                <PanelState state="loading" />
              </div>
            ) : composition ? (
              <BudgetChart
                title="大盘 GMV 构成"
                date={selectedDay}
                total={composition.total}
                segments={composition.items.map((item) => ({
                  ...item,
                  color:
                    item.id === '未分类差额'
                      ? 'var(--residual)'
                      : `color-mix(in srgb, var(--series-1) ${compositionTones[item.id] ?? 35}%, var(--surface))`,
                }))}
              />
            ) : (
              <div className="home-composition-state">
                <PanelState state={error ? 'error' : 'empty'} reason={error || '当日付费类型构成未覆盖'} />
              </div>
            )}
          </div>
        </DailyActivityRail>
      )}
      <Modal
        open={expandedMetric != null}
        onOpenChange={(open) => {
          if (!open) setExpandedMetric(null);
        }}
        title={`${metrics.find((m) => m.key === expandedMetric)?.label || ''}趋势`}
        width={920}
      >
        {expandedMetric && (
          <FinanceOverviewAreaChart
            title={metrics.find((m) => m.key === expandedMetric)!.label}
            plotHeight={340}
            showSummary={false}
            unit={expandedMetric === 'renewalRate' ? 'rate' : orders[expandedMetric] ? 'count' : 'currency'}
            buckets={homeBuckets(
              rows,
              expandedMetric,
              Boolean(orders[expandedMetric]),
              startDate,
              endDate,
              granularity,
            )}
            selectedDay={selectedDay}
            onSelect={selectDay}
            granularity={granularity}
            onGranularityChange={(value) => update({ granularity: value })}
          />
        )}
      </Modal>
      <RevenueStructureDialog
        metric={structureMetric}
        items={[]}
        definitions={metrics
          .filter((item) => item.key !== 'renewalRate')
          .map((item) => ({ key: item.label, metric: item.key, color: 'var(--v62-accent)' }))}
        currentPoint={current}
        baselinePoint={previous}
        daily
        onClose={() => setStructureMetric(null)}
      />
    </div>
  );
}
