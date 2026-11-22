import './home.css';
import { PageHeader, PanelState, Modal } from '@/components/system';
import { day } from '@shared/format';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { RevenueStructureDialog } from '@/components/dashboard/AnalysisWidgets';
import type {
  DashboardGmvAnomalyResponse,
  DashboardPlatform,
  GmvAnomalyMetric,
  OverviewTrendPoint,
} from '@shared/api.interface';
import { getDashboardOverview, invalidateDashboardCache } from '@/api/dashboard';
import { getLatestSyncRun } from '@/api/sync';
import { LOCAL_REVENUE_WINDOW } from '@/lib/local-data-window';
import { STATIC_DEMO_MODE } from '@/lib/demo-data';
import DateRangePicker from '@/components/dashboard/DashboardDateRangePicker';
import DailyActivityRail from '@/components/dashboard/DailyActivityRail';
import { WorkbenchIcon } from '@/components/icons/WorkbenchIcon';
import RevenueTrend from '@/components/v62/RevenueTrend';
import { HomeKpis } from './HomeKpis';
import { homeMetrics as metrics, homeBuckets, type HomeMetric } from './home-data';
import { FinanceOverviewAreaChart } from '@/components/finance-overview-area-chart';
import { count, rate } from '@shared/format';
import { revenueBuckets, shiftDay } from '@/components/v62/trend-data';
import PlatformSelect from '@/components/v62/PlatformSelect';
import ActiveProcess from '@/components/v62/ActiveProcess';
import { BudgetChart } from '@/components/budget-chart';
import { paymentComposition } from '@shared/home-attribution';
import { entityColor } from '@shared/chart-colors';

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
  const initialCoverage = STATIC_DEMO_MODE ? { startDate: '2026-01-01', endDate: '2026-10-09' } : LOCAL_REVENUE_WINDOW;
  const [coverage, setCoverage] = useState(initialCoverage);
  const [rows, setRows] = useState<OverviewTrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
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
  useEffect(() => {
    if (initialCoverage) return;
    let live = true;
    void getLatestSyncRun()
      .then((sync) => {
        if (live && sync?.status === 'success') setCoverage({ startDate: '2026-01-01', endDate: sync.endDate });
      })
      .catch(() => {
        if (live) setError('最新可用日期读取失败，请刷新重试');
      });
    return () => {
      live = false;
    };
  }, []);
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
  useEffect(() => {
    if (!startDate || !endDate) return;
    let live = true;
    setLoading(true);
    setError('');
    setRows([]);
    void getDashboardOverview({
      view: 'cards',
      includeRenewal: 'true',
      platform,
      deviceType,
      granularity: 'day',
      startDate: shiftDay(startDate, -7),
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
  }, [platform, deviceType, startDate, endDate, revision]);
  const visibleDays = rows.filter((row) => row.period >= startDate && row.period <= endDate);
  const candidate = params.get('focusPeriod') || params.get('selectedDay');
  const selectedDay = rows.some((row) => row.period === candidate && row.period >= startDate && row.period <= endDate)
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
      loading={loading}
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
            <button
              type="button"
              className="v62-icon-button"
              aria-label="刷新数据"
              disabled={loading}
              onClick={() => {
                invalidateDashboardCache();
                setRevision((value) => value + 1);
              }}
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
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
    <div className="v62-page v62-sheet-page" data-page="gmv-trend">
      {!endDate ? (
        <>
          {header()}
          <PanelState
            state={error ? 'error' : 'loading'}
            reason={error || undefined}
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
          calendarRows={rows}
          calendarMetric={financialMetric}
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
                loading={loading}
              />
            )}
            {loading ? (
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
                  color: item.id === '未分类差额' ? 'var(--residual)' : entityColor(item.id),
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
