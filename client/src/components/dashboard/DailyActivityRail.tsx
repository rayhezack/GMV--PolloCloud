import { ProductActionStack } from '@/pages/OverviewPage/ProductActionStack';
import { HomeSignals } from '@/pages/OverviewPage/HomeSignals';
import { Modal, DataFreshness } from '../system';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { money, changePct } from '@shared/format';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';
import { getGmvAnomalies, getProductActions } from '@/api/dashboard';
import { getLatestSyncRun } from '@/api/sync';
import { getLatestReport } from '@/api/report';
import { getReportPeriodKey } from '@/pages/ReportPage/report-page.utils';
import { Button } from '@/components/ui/button';
import { LOCAL_DATA_WINDOW } from '@/lib/local-data-window';
import type {
  DashboardGmvAnomalyResponse,
  DashboardPlatform,
  Platform,
  ReportGenerationStatus,
  ReportSummary,
  SyncRunStatus,
} from '@shared/api.interface';
import type { ProductActionSource } from '@shared/product-actions';
import './daily-activity-rail.css';
import DailyReportStack from './DailyReportStack';
import { dailyDiagnosisScopes } from '@/lib/daily-diagnosis-scope';
import { Definition } from '@/components/v62/primitives';
import GmvCalendar from '@/components/v62/GmvCalendar';
import { shiftDay } from '@/components/v62/trend-data';
import type { OverviewTrendPoint, GmvAnomalyMetric } from '@shared/api.interface';
import { WorkbenchIcon } from '@/components/icons/WorkbenchIcon';
import { anomalyDashboardHref } from './navigation';

const dateOf = (date: string) => new Date(`${date}T12:00:00`);
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const shanghaiToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const shortDate = (date: string) => date.slice(5).replace('-', '/');
const statusLabels = {
  queued: '排队中',
  running: '生成中',
  pausing: '暂停中',
  paused: '已暂停',
  success: '已完成',
  failed: '失败',
};
const metricLabels = {
  totalGmv: '大盘 GMV',
  activeGmv: '主动付费',
  renewalGmv: '自动续订',
};
const platformLabels = { all: '全端', web: 'Web', app: 'App' };

export default function DailyActivityRail({
  platform,
  deviceType,
  refreshToken,
  trendWindow,
  selectedDay,
  onSelectedDayChange,
  onMonitoringChange,
  onActionsChange,
  children,
  renderProcess,
  calendarRows,
  calendarWindow = trendWindow,
  calendarMetric,
  renderHeader,
}: {
  platform: DashboardPlatform;
  deviceType?: 'ios' | 'android';
  refreshToken: number;
  trendWindow: { startDate: string; endDate: string };
  selectedDay?: string;
  onSelectedDayChange?: (date: string) => void;
  onMonitoringChange?: (value: DashboardGmvAnomalyResponse | null) => void;
  onActionsChange?: (value: ProductActionSource | null) => void;
  calendarWindow?: { startDate: string; endDate: string };
  calendarRows?: OverviewTrendPoint[];
  calendarMetric?: GmvAnomalyMetric;
  children?: ReactNode;
  renderHeader?: (freshness: ReactNode) => ReactNode;
  renderProcess?: (state: {
    alerts: DashboardGmvAnomalyResponse['alerts'];
    available: boolean;
    loading: boolean;
  }) => ReactNode;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { jobs, syncJob, canManage } = useOutletContext<{
    jobs: ReportGenerationStatus[];
    syncJob: SyncRunStatus | null;
    canManage?: boolean;
  }>();
  const [actions, setActions] = useState<ProductActionSource | null>(null);
  const [anomalies, setAnomalies] = useState<DashboardGmvAnomalyResponse | null>(null);
  const [reportMode, setReportMode] = useState<'day' | 'week'>('day');
  const [monitorDate, setMonitorDate] = useState<string | null>(null);
  const [latestMonitorDate, setLatestMonitorDate] = useState('');
  const [syncSnapshot, setSyncSnapshot] = useState<SyncRunStatus | null>(null);
  const sync = syncJob ?? syncSnapshot;
  const syncRevision = syncJob?.status === 'success' ? `${syncJob.runId}:${syncJob.finishedAt}` : '';
  const reportRevision = jobs
    .map((job) => `${job.runId}:${job.status}:${job.finishedAt}`)
    .sort()
    .join('|');
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportErrors, setReportErrors] = useState<Platform[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [syncLoading, setSyncLoading] = useState(true);
  const [month, setMonth] = useState<Date>();
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  useEffect(() => {
    let live = true;
    setErrors([]);
    const failed = (label: string) => {
      if (live) setErrors((current) => [...current, label]);
    };
    // Publish each independent source as it arrives. A slow actions read must
    // never hold back monitoring or data freshness.
    void getProductActions()
      .then((value) => {
        if (live) setActions(value);
      })
      .catch(() => failed('产品动作'))
      .finally(() => {
        if (live) setActionsLoading(false);
      });
    void getLatestSyncRun()
      .then((value) => {
        if (live) setSyncSnapshot(value);
      })
      .catch(() => failed('数据更新'))
      .finally(() => {
        if (live) setSyncLoading(false);
      });
    return () => {
      live = false;
    };
  }, [refreshToken, syncRevision]);
  useEffect(() => {
    let live = true;
    setReportsLoading(true);
    const platforms: Platform[] = ['web', 'app'];
    void Promise.allSettled(platforms.map(getLatestReport)).then((results) => {
      if (!live) return;
      setReports((current) =>
        platforms.flatMap((item, index) => {
          const result = results[index];
          const report =
            result.status === 'fulfilled' ? result.value : current.find((report) => report.platform === item);
          return report ? [report] : [];
        }),
      );
      setReportErrors(platforms.filter((_, index) => results[index].status === 'rejected'));
      setReportsLoading(false);
    });
    return () => {
      live = false;
    };
  }, [refreshToken, reportRevision]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setAnomalies(null);
    setErrors((current) => current.filter((label) => label !== '异动监测'));
    void getGmvAnomalies(syncRevision || undefined, selectedDay || monitorDate || undefined, platform)
      .then((value) => {
        if (!live) return;
        setAnomalies(value);
        if (!monitorDate) setLatestMonitorDate(value.latestDay);
      })
      .catch(() => {
        if (live) setErrors((current) => [...current, '异动监测']);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [refreshToken, syncRevision, monitorDate, selectedDay, platform]);
  useEffect(() => {
    onMonitoringChange?.(deviceType ? null : anomalies);
  }, [anomalies, deviceType, onMonitoringChange]);
  useEffect(() => {
    onActionsChange?.(actions);
  }, [actions, onActionsChange]);
  useEffect(() => {
    if (selectedDay) setMonth(dateOf(selectedDay));
  }, [selectedDay]);
  const latestDate =
    selectedDay ||
    monitorDate ||
    anomalies?.latestDay ||
    LOCAL_DATA_WINDOW?.endDate ||
    (sync?.status === 'success' ? sync.endDate : '');
  const monitorAvailable = Boolean(
    !deviceType &&
    anomalies?.latestDay &&
    (!anomalies.monitoredPlatforms || anomalies.monitoredPlatforms.includes(platform)),
  );
  const diagnosisPlatforms = dailyDiagnosisScopes(anomalies?.alerts ?? [], latestDate);
  const latestDataDate =
    [sync?.status === 'success' ? sync.endDate : '', LOCAL_DATA_WINDOW?.endDate || '', latestMonitorDate]
      .sort()
      .at(-1) || '';
  const calendarMonth = month ?? dateOf(latestDate || shanghaiToday());
  const filteredActions = useMemo(
    () => [
      ...new Map(
        (actions?.actions ?? [])
          .filter((action) => platform === 'all' || action.platform.split('/').includes(platform))
          .map((action) => [action.id, action]),
      ).values(),
    ],
    [actions, platform],
  );
  const actionDates = useMemo(() => new Set(filteredActions.map((action) => action.date)), [filteredActions]);
  const anomalyDates = useMemo(
    () => new Set([...(anomalies?.anomalyDates ?? []), ...(anomalies?.alerts ?? []).map((alert) => alert.period)]),
    [anomalies],
  );
  const selectedActions = filteredActions.filter(
    (action) => action.date === (selectedDay || (selectedDate ? dateKey(selectedDate) : '')),
  );
  const alerts = (deviceType ? [] : (anomalies?.alerts ?? [])).filter(
    (alert) => alert.period === latestDate && (platform === 'all' || alert.platform === platform),
  );
  const signals = [
    ...new Map(
      [...alerts]
        .sort((a, b) => Number(a.window === 'week') - Number(b.window === 'week'))
        .map((alert) => [`${alert.platform}:${alert.metric}:${alert.period}`, alert]),
    ).values(),
  ].sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const focusedAlert = alerts.find(
    (alert) =>
      alert.metric === searchParams.get('focusMetric') &&
      alert.platform === searchParams.get('focusPlatform') &&
      alert.period === searchParams.get('focusPeriod') &&
      alert.window ===
        (searchParams.get('focusWindow') ||
          signals.find((signal) => signal.metric === alert.metric && signal.platform === alert.platform)?.window),
  );
  const primarySignal = focusedAlert ?? signals.find((signal) => signal.platform === platform) ?? signals[0];
  const clearGuidance = () => {
    const next = new URLSearchParams(searchParams);
    ['focusMetric', 'focusPlatform', 'focusPeriod', 'focusWindow'].forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  };
  const latestAction = [...filteredActions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .find((action) => action.date <= shanghaiToday());
  const reportHref = (reportPlatform = platform === 'all' ? 'web' : platform) => `/report?platform=${reportPlatform}`;
  const reportPlatforms: Platform[] = platform === 'all' ? ['web', 'app'] : [platform];
  const showDate = (date: Date) => {
    setSelectedDate(date);
    setActionsOpen(true);
  };
  const anomalyHref = (alert: (typeof alerts)[number]) =>
    anomalyDashboardHref(searchParams.toString(), alert, trendWindow);
  return (
    <aside
      className="daily-rail v62-home-sheet"
      aria-label="每日动态"
      aria-busy={loading}
      data-focus-metric={focusedAlert?.metric}
    >
      {renderHeader?.(<DataFreshness date={latestDataDate} onClick={() => setUpdatesOpen(true)} />)}
      <div className="v62-home-main">
        {children}
        <section className="daily-bento home-calendar-panel" aria-label="收入日历">
          {calendarRows && onSelectedDayChange ? (
            <GmvCalendar
              rows={calendarRows}
              metric={calendarMetric || 'totalGmv'}
              latest={trendWindow.endDate}
              selected={latestDate}
              onSelect={onSelectedDayChange}
              actions={actionDates}
              productActions={filteredActions}
              actionsStatus={actionsLoading ? 'loading' : actions?.available ? 'ready' : 'unavailable'}
              actionCounts={
                new Map([...actionDates].map((date) => [date, filteredActions.filter((a) => a.date === date).length]))
              }
              anomalies={deviceType ? new Set() : anomalyDates}
              start={calendarWindow.startDate}
              end={calendarWindow.endDate}
            />
          ) : (
            <div />
          )}
        </section>
      </div>
      <div className="v62-home-rail">
        <HomeSignals
          latestDate={latestDate}
          signals={signals}
          loading={loading}
          monitorAvailable={monitorAvailable}
          onDetails={() => setAlertsOpen(true)}
          anomalyHref={anomalyHref}
          renderProcess={renderProcess}
          primarySignal={primarySignal}
          diagnosis={
            <div className="v62-calendar-diagnosis" aria-label="诊断报告">
              <DailyReportStack
                key={`${focusedAlert?.platform ?? platform}:${latestDate}:${reportMode}`}
                mode={reportMode}
                platform={focusedAlert?.platform ?? platform}
                platforms={diagnosisPlatforms}
                period={latestDate}
                refreshToken={refreshToken}
                canManage={canManage}
              />
              <button
                type="button"
                className="v62-week-report-button"
                onClick={() => setReportMode((value) => (value === 'day' ? 'week' : 'day'))}
              >
                <WorkbenchIcon name="file-chart" />
                {reportMode === 'day' ? '周诊断报告' : '返回日诊断'}
              </button>
            </div>
          }
        />
        <div className="v62-day-actions">
          <header>
            <h3 id="daily-calendar-title">产品动作</h3>
            <span className="home-activity-date">
              <WorkbenchIcon name="日历" />
              {shortDate(latestDate)}{' '}
              {new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(dateOf(latestDate))}
            </span>
            <Definition>同期产品动作是排查线索，不直接认定为 GMV 变化的原因。</Definition>
          </header>
          {selectedActions.length ? (
            <ProductActionStack key={platform} date={latestDate} actions={selectedActions} />
          ) : (
            <p className="daily-muted">
              {actionsLoading ? '读取中' : actions?.available ? '当日无产品动作' : '产品动作源暂不可用'}
            </p>
          )}
        </div>
      </div>
      {!!errors.length && (
        <p className="daily-source-error" role="status">
          {errors.join('、')}读取失败，可通过顶部刷新重试。
        </p>
      )}
      <Modal
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title={`${selectedDay || (selectedDate ? dateKey(selectedDate) : '')} · 产品动作`}
        description={`${platformLabels[platform]} · 按上线日期查看记录`}
      >
        <div className="daily-action-list">
          {selectedActions.map((action) => (
            <details key={action.id}>
              <summary>
                <span>{action.title}</span>
                <span aria-hidden>＋</span>
              </summary>
              <p>{action.description || '暂无补充说明'}</p>
              <small>
                {action.platform || '未标注端'}
                {action.version ? ` · ${action.version}` : ''}
              </small>
            </details>
          ))}
        </div>
        {!selectedActions.length && (
          <p role="status" className="daily-muted">
            {loading
              ? '正在读取产品动作…'
              : !actions?.available
                ? '产品动作源暂不可用，请稍后刷新。'
                : '当日暂无产品动作记录'}
          </p>
        )}
        <p className="daily-muted">来源：产品动作明细 · 上线日期</p>
      </Modal>
      <Modal
        open={alertsOpen}
        onOpenChange={setAlertsOpen}
        title={`异动监测 · ${latestDate || '最新可用日'}`}
        description="基于较前一日与上周同日变化的监测结果"
      >
        <div className="daily-detail-signals">
          {alerts.map((alert) => (
            <Link
              key={`${alert.platform}:${alert.metric}:${alert.window}`}
              to={anomalyHref(alert)}
              onClick={() => setAlertsOpen(false)}
            >
              <span>
                {platformLabels[alert.platform]} · {metricLabels[alert.metric]}
                <small>
                  {alert.period} vs {alert.baselinePeriod} · {alert.window === 'day' ? '较前一日' : '上周同日'}
                </small>
              </span>
              <b>
                {alert.change < 0 ? '下降' : '上升'} {Math.abs(alert.change * 100).toFixed(2)}%{' '}
                <ArrowUpRight size={14} />
              </b>
            </Link>
          ))}
        </div>
        {!alerts.length && <p className="daily-muted">当前端的当日未触发异动阈值。</p>}
        <p className="daily-muted">异常阈值使用前 12 个完整业务周的历史分位数，最低变化幅度为 10%。</p>
      </Modal>
      <Modal
        open={updatesOpen}
        onOpenChange={setUpdatesOpen}
        title="更新记录"
        description="数据覆盖、同步任务与报告更新"
      >
        <dl className="daily-update-detail">
          <div>
            <dt>本地可用范围</dt>
            <dd>
              {LOCAL_DATA_WINDOW ? `${LOCAL_DATA_WINDOW.startDate} — ${LOCAL_DATA_WINDOW.endDate}` : '使用服务端数据'}
            </dd>
          </div>
          <div>
            <dt>最近同步</dt>
            <dd>{sync ? `${sync.startDate} — ${sync.endDate} · ${statusLabels[sync.status]}` : '暂无可用同步记录'}</dd>
          </div>
          <div>
            <dt>产品动作入仓时间</dt>
            <dd>{actions?.readAt || '暂不可用'}</dd>
          </div>
          {sync?.errorMessage && (
            <div>
              <dt>同步提示</dt>
              <dd>{sync.errorMessage}</dd>
            </div>
          )}
          {reportPlatforms.map((item) => {
            const report = reports.find((report) => report.platform === item);
            const job = jobs.find((job) => job.platform === item);
            return (
              <div key={item}>
                <dt>{platformLabels[item]} 报告</dt>
                <dd>
                  {job?.status === 'failed' && <p>{job.errorMessage || '报告生成失败'}</p>}
                  {report ? (
                    <Link to={`${reportHref(item)}&period=${getReportPeriodKey(report.periodStart, report.periodEnd)}`}>
                      {report.periodStart} — {report.periodEnd} ·{' '}
                      {new Intl.DateTimeFormat('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                        dateStyle: 'short',
                        timeStyle: 'short',
                        hour12: false,
                      }).format(new Date(report.generatedAt))}
                      <ArrowUpRight size={12} className="inline ml-1" />
                    </Link>
                  ) : reportErrors.includes(item) ? (
                    '暂不可用'
                  ) : (
                    '暂无已生成报告'
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
        <Button variant="secondary" asChild>
          <Link to="/?tab=data">
            查看数据与口径
            <ArrowUpRight size={14} />
          </Link>
        </Button>
      </Modal>
    </aside>
  );
}
