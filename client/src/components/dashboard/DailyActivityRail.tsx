import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { zhCN } from "date-fns/locale";
import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";
import {
  getGmvAnomalies,
  getProductActions,
} from "@/api/dashboard";
import { getLatestSyncRun } from "@/api/sync";
import { getLatestReport } from "@/api/report";
import { getReportPeriodKey } from "@/pages/ReportPage/report-page.utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { LOCAL_DATA_WINDOW } from "@/lib/local-data-window";
import type {
  DashboardGmvAnomalyResponse,
  DashboardPlatform,
  Platform,
  ReportGenerationStatus,
  ReportSummary,
  SyncRunStatus,
} from "@shared/api.interface";
import type { ProductActionSource } from "@shared/product-actions";
import "./daily-activity-rail.css";
import DailyReportStack from "./DailyReportStack";
import DashboardDatePicker from "./DashboardDatePicker";
import { dailyDiagnosisScopes } from "@/lib/daily-diagnosis-scope";

const dateOf = (date: string) => new Date(`${date}T12:00:00`);
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const shanghaiToday = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
    new Date(),
  );
const shortDate = (date: string) => date.slice(5).replace("-", "/");
const statusLabels = {
  queued: "排队中",
  running: "生成中",
  pausing: "暂停中",
  paused: "已暂停",
  success: "已完成",
  failed: "失败",
};
const metricLabels = {
  totalGmv: "大盘 GMV",
  activeGmv: "主动付费",
  renewalGmv: "自动续订",
};
const platformLabels = { all: "全端", web: "Web", app: "App" };

export default function DailyActivityRail({
  platform,
  refreshToken,
}: {
  platform: DashboardPlatform;
  refreshToken: number;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { jobs, syncJob, canManage } = useOutletContext<{
    jobs: ReportGenerationStatus[];
    syncJob: SyncRunStatus | null;
    canManage?: boolean;
  }>();
  const [actions, setActions] = useState<ProductActionSource | null>(null);
  const [anomalies, setAnomalies] =
    useState<DashboardGmvAnomalyResponse | null>(null);
  const [reportMode, setReportMode] = useState<'day' | 'week'>('day');
  const [monitorDate, setMonitorDate] = useState<string | null>(null);
  const [latestMonitorDate, setLatestMonitorDate] = useState('');
  const [syncSnapshot, setSyncSnapshot] = useState<SyncRunStatus | null>(null);
  const sync = syncJob ?? syncSnapshot;
  const syncRevision =
    syncJob?.status === "success"
      ? `${syncJob.runId}:${syncJob.finishedAt}`
      : "";
  const reportRevision = jobs
    .map((job) => `${job.runId}:${job.status}:${job.finishedAt}`)
    .sort()
    .join("|");
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
    const failed = (label: string) => { if (live) setErrors(current => [...current, label]); };
    // Publish each independent source as it arrives. A slow actions read must
    // never hold back monitoring or data freshness.
    void getProductActions().then(value => { if (live) setActions(value); })
      .catch(() => failed('产品动作')).finally(() => { if (live) setActionsLoading(false); });
    void getLatestSyncRun().then(value => { if (live) setSyncSnapshot(value); })
      .catch(() => failed('数据更新')).finally(() => { if (live) setSyncLoading(false); });
    return () => {
      live = false;
    };
  }, [refreshToken, syncRevision]);
  useEffect(() => {
    let live = true;
    setReportsLoading(true);
    const platforms: Platform[] = ["web", "app"];
    void Promise.allSettled(platforms.map(getLatestReport)).then((results) => {
      if (!live) return;
      setReports((current) =>
        platforms.flatMap((item, index) => {
          const result = results[index];
          const report =
            result.status === "fulfilled"
              ? result.value
              : current.find((report) => report.platform === item);
          return report ? [report] : [];
        }),
      );
      setReportErrors(
        platforms.filter((_, index) => results[index].status === "rejected"),
      );
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
    setErrors(current => current.filter(label => label !== '异动监测'));
    void getGmvAnomalies(syncRevision || undefined, monitorDate || undefined)
      .then(value => {
        if (!live) return;
        setAnomalies(value);
        if (!monitorDate) setLatestMonitorDate(value.latestDay);
      }).catch(() => { if (live) setErrors(current => [...current, '异动监测']); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [refreshToken, syncRevision, monitorDate]);
  const latestDate =
    monitorDate ||
    anomalies?.latestDay ||
    LOCAL_DATA_WINDOW?.endDate ||
    (sync?.status === "success" ? sync.endDate : "");
  const monitorAvailable = Boolean(anomalies?.latestDay && (!anomalies.monitoredPlatforms || anomalies.monitoredPlatforms.includes(platform)));
  const diagnosisPlatforms = dailyDiagnosisScopes(anomalies?.alerts ?? [], latestDate);
  const latestDataDate =
    [
      sync?.status === "success" ? sync.endDate : "",
      LOCAL_DATA_WINDOW?.endDate || "",
      latestMonitorDate,
    ]
      .sort()
      .at(-1) || "";
  const calendarMonth = month ?? dateOf(latestDate || shanghaiToday());
  const filteredActions = useMemo(
    () => [
      ...new Map(
        (actions?.actions ?? [])
          .filter(
            (action) =>
              platform === "all" ||
              action.platform.split("/").includes(platform),
          )
          .map((action) => [action.id, action]),
      ).values(),
    ],
    [actions, platform],
  );
  const actionDates = useMemo(
    () => new Set(filteredActions.map((action) => action.date)),
    [filteredActions],
  );
  const selectedActions = filteredActions.filter(
    (action) => action.date === (selectedDate ? dateKey(selectedDate) : ""),
  );
  const alerts = (anomalies?.alerts ?? []).filter(
    (alert) => alert.metric === "totalGmv" && (platform === "all" || alert.platform === platform),
  );
  const signals = [
    ...new Map(
      [...alerts]
        .sort((a, b) => Number(a.window === "week") - Number(b.window === "week"))
        .map((alert) => [
          `${alert.platform}:${alert.metric}:${alert.period}`,
          alert,
        ]),
    ).values(),
  ].sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const focusedAlert = alerts.find(
    (alert) =>
      alert.metric === searchParams.get("focusMetric") &&
      alert.platform === searchParams.get("focusPlatform") &&
      alert.period === searchParams.get("focusPeriod") &&
      alert.window ===
        (searchParams.get("focusWindow") ||
          signals.find(
            (signal) =>
              signal.metric === alert.metric &&
              signal.platform === alert.platform,
          )?.window),
  );
  const clearGuidance = () => {
    const next = new URLSearchParams(searchParams);
    ["focusMetric", "focusPlatform", "focusPeriod", "focusWindow"].forEach(
      (key) => next.delete(key),
    );
    setSearchParams(next, { replace: true });
  };
  const money = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  const latestAction = [...filteredActions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .find((action) => action.date <= shanghaiToday());
  const reportHref = (reportPlatform = platform === "all" ? "web" : platform) =>
    `/report?platform=${reportPlatform}`;
  const reportPlatforms: Platform[] =
    platform === "all" ? ["web", "app"] : [platform];
  const showDate = (date: Date) => {
    setSelectedDate(date);
    setActionsOpen(true);
  };
  const anomalyHref = (alert: (typeof alerts)[number]) =>
    `/?${new URLSearchParams({ tab: "trend", platform: alert.platform, granularity: "day", focusMetric: alert.metric, focusPlatform: alert.platform, focusPeriod: alert.period, focusWindow: alert.window })}`;
  return (
    <aside
      className="daily-rail"
      aria-label="每日动态"
      aria-busy={loading}
      data-focus-metric={focusedAlert?.metric}
    >
      <section
        className="daily-bento daily-bento-anomaly"
        aria-labelledby="daily-anomaly-title"
      >
        <div className="daily-rail-heading">
          <h2 id="daily-anomaly-title">每日动态</h2>
          {latestDate && <DashboardDatePicker date={latestDate} maxDate={latestMonitorDate || latestDataDate || shanghaiToday()} label="异动日期" compact
            onDateChange={date => { clearGuidance(); setMonitorDate(date === latestMonitorDate ? null : date); }} onValidityChange={() => {}} /> }
        </div>
        <div className="daily-anomaly-headline">
          <strong>
            {loading ? "—" : monitorAvailable ? signals.length : "—"}
          </strong>
          <span>
            {loading ? "读取中" : monitorAvailable ? "项异动" : "等待监测数据"}
          </span>
        </div>
        <div className="daily-signal-list">
          {signals.slice(0, 3).map((alert) => (
            <Link
              key={`${alert.platform}:${alert.metric}`}
              to={anomalyHref(alert)}
              className="daily-signal-row"
            >
              <span>
                {platformLabels[alert.platform]} · {metricLabels[alert.metric]}
                <small>
                  {alert.window === "day" ? "较前一日" : "较上周同日"}
                </small>
              </span>
              <b data-direction={alert.direction}>
                {alert.direction === "down" ? (
                  <ArrowDownRight size={14} />
                ) : (
                  <ArrowUpRight size={14} />
                )}
                {Math.abs(alert.change * 100).toFixed(1)}%
              </b>
            </Link>
          ))}
        </div>
        {focusedAlert && (
          <div className="daily-signal-guide" role="status">
            <dl>
              <div>
                <dt>{shortDate(focusedAlert.baselinePeriod)}</dt>
                <dd>{money(focusedAlert.previousDailyAvg)}</dd>
              </div>
              <span aria-hidden>→</span>
              <div>
                <dt>{shortDate(focusedAlert.period)}</dt>
                <dd>{money(focusedAlert.currentDailyAvg)}</dd>
              </div>
            </dl>
            <div className="daily-guide-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMonth(dateOf(focusedAlert.period));
                  showDate(dateOf(focusedAlert.period));
                }}
              >
                当日产品动作
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/?tab=payment&platform=${focusedAlert.platform}`}>
                  周度付费拆解
                </Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={clearGuidance}>
                收起
              </Button>
            </div>
          </div>
        )}
        {!loading && !signals.length && (
          <p className="daily-muted">
            {monitorAvailable
              ? "当日未触发异动阈值。"
              : "暂无完整监测数据，请稍后刷新。"}
          </p>
        )}
        <Button
          className="daily-monitor-link"
          variant="ghost"
          size="sm"
          onClick={() => setAlertsOpen(true)}
          disabled={loading || !monitorAvailable}
        >
          查看监测详情
        </Button>
        <DailyReportStack key={`${focusedAlert?.platform ?? platform}:${latestDate}:${reportMode}`} mode={reportMode} platform={focusedAlert?.platform ?? platform} platforms={diagnosisPlatforms} period={latestDate} refreshToken={refreshToken} canManage={canManage} />
        <footer>
          <button type="button" onClick={() => setReportMode(value => value === 'day' ? 'week' : 'day')}>
            {reportMode === 'day' ? '周诊断报告' : '返回日诊断'}
          </button>
        </footer>
      </section>
      <section
        className="daily-bento daily-update"
        aria-labelledby="daily-update-title"
      >
        <header>
          <h3 id="daily-update-title">更新通知</h3>
        </header>
        <div className="daily-update-date">
          <strong>{latestDataDate ? shortDate(latestDataDate) : "—"}</strong>
          <span>最新可用日期</span>
        </div>
        <div className="daily-key-value">
          <span>同步状态</span>
          <b>
            {syncLoading
              ? "读取中"
              : sync
                ? sync.skipped
                  ? "已是最新"
                  : sync.status === "running"
                    ? "同步中"
                    : statusLabels[sync.status]
                : errors.includes("数据更新")
                  ? "暂不可用"
                  : "暂无任务"}
          </b>
        </div>
        {sync && (
          <div className="daily-update-message" role="status">
            {sync.status === "failed"
              ? sync.errorMessage || "同步失败"
              : sync.status === "success"
                ? `${sync.skipped ? "无需更新" : `已更新 ${sync.rowsSynced.toLocaleString("en-US")} 条`} · ${shortDate(sync.endDate)}`
                : `${shortDate(sync.startDate)} — ${shortDate(sync.endDate)}`}
          </div>
        )}
        <div className="daily-key-value">
          <span>产品动作</span>
          <b>
            {actionsLoading ? "读取中" : actions?.available ? "已入仓" : "暂不可用"}
          </b>
        </div>
        <div
          className="daily-report-updates"
          aria-label="报告更新"
          aria-live="polite"
        >
          {reportPlatforms.map((item) => {
            const report = reports.find((report) => report.platform === item);
            const job = jobs.find((job) => job.platform === item);
            const newerReport =
              report &&
              job &&
              ["success", "failed"].includes(job.status) &&
              Date.parse(report.generatedAt) >
                Date.parse(job.finishedAt || job.startedAt);
            const currentJob = newerReport ? undefined : job;
            const periodStart = currentJob?.periodStart || report?.periodStart;
            const periodEnd = currentJob?.periodEnd || report?.periodEnd;
            const updatedAt = currentJob
              ? currentJob.finishedAt || currentJob.startedAt
              : report?.generatedAt;
            const href =
              periodStart && periodEnd
                ? `${reportHref(item)}&period=${getReportPeriodKey(periodStart, periodEnd)}`
                : reportHref(item);
            return (
              <Link key={item} className="daily-report-update" to={href}>
                <span className="daily-report-update-heading">
                  <span>{platformLabels[item]} 报告</span>
                  <b>
                    {currentJob
                      ? currentJob.status === "success"
                        ? "已更新"
                        : statusLabels[currentJob.status]
                      : reportsLoading
                        ? "读取中"
                        : report
                          ? "已更新"
                          : reportErrors.includes(item)
                            ? "暂不可用"
                            : "暂无更新"}
                  </b>
                </span>
                {periodStart && periodEnd && (
                  <small>
                    {shortDate(periodStart)} — {shortDate(periodEnd)}
                    {updatedAt && (
                      <time dateTime={updatedAt}>
                        {new Intl.DateTimeFormat("zh-CN", {
                          timeZone: "Asia/Shanghai",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        }).format(new Date(updatedAt))}
                      </time>
                    )}
                  </small>
                )}
                {currentJob?.status === "failed" && currentJob.errorMessage && (
                  <small className="daily-update-message">
                    {currentJob.errorMessage}
                  </small>
                )}
              </Link>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="daily-text-button"
          onClick={() => setUpdatesOpen(true)}
        >
          查看更新记录
        </Button>
      </section>
      <section
        className="daily-bento daily-calendar-card"
        aria-labelledby="daily-calendar-title"
      >
        <header>
          <h3 id="daily-calendar-title">产品日历</h3>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="产品日历说明">
                <Info size={14} />
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              <strong>产品动作 · 上线日期</strong>
              <p className="text-xs mt-2 leading-relaxed">
                带圆点的日期有当前端的产品动作。点击日期查看全部记录；同期动作不代表
                GMV 变化的原因。
              </p>
              {actions?.lastSyncError && (
                <p className="text-xs mt-2">
                  最近同步失败，当前使用上次成功入仓的记录。
                </p>
              )}
            </PopoverContent>
          </Popover>
        </header>
        <Calendar
          mode="single"
          required
          locale={zhCN}
          weekStartsOn={1}
          month={calendarMonth}
          onMonthChange={setMonth}
          selected={selectedDate}
          onSelect={showDate}
          modifiers={{ action: (date) => actionDates.has(dateKey(date)) }}
          modifiersClassNames={{ action: "daily-has-action" }}
          className="daily-calendar"
        />
        <div className="daily-calendar-footer">
          <span className="daily-calendar-legend">
            <i />
            产品动作
          </span>
          {actionsLoading ? (
            <span>读取中</span>
          ) : !actions?.available ? (
            <span>动作源暂不可用</span>
          ) : (
            <span>按{platformLabels[platform]}显示</span>
          )}
        </div>
        {latestAction && (
          <button
            type="button"
            className="daily-latest-action"
            onClick={() => {
              setMonth(dateOf(latestAction.date));
              showDate(dateOf(latestAction.date));
            }}
          >
            <span>{shortDate(latestAction.date)}</span>
            <b>{latestAction.title}</b>
          </button>
        )}
      </section>
      {!!errors.length && (
        <p className="daily-source-error" role="status">
          {errors.join("、")}读取失败，可通过顶部刷新重试。
        </p>
      )}
      <Dialog open={actionsOpen} onOpenChange={setActionsOpen}>
        <DialogContent className="revenue-event-dialog daily-action-dialog">
          <DialogHeader>
            <DialogTitle>
              {selectedDate ? dateKey(selectedDate) : ""} · 产品动作
            </DialogTitle>
            <DialogDescription>
              {platformLabels[platform]} · 按上线日期查看记录
            </DialogDescription>
          </DialogHeader>
          <div className="daily-action-list">
            {selectedActions.map((action) => (
              <details key={action.id}>
                <summary>
                  <span>{action.title}</span>
                  <span aria-hidden>＋</span>
                </summary>
                <p>{action.description || "暂无补充说明"}</p>
                <small>
                  {action.platform || "未标注端"}
                  {action.version ? ` · ${action.version}` : ""}
                </small>
              </details>
            ))}
          </div>
          {!selectedActions.length && (
            <p role="status" className="daily-muted">
              {loading
                ? "正在读取产品动作…"
                : !actions?.available
                  ? "产品动作源暂不可用，请稍后刷新。"
                  : "当日暂无产品动作记录"}
            </p>
          )}
          <p className="daily-muted">来源：产品动作明细 · 上线日期</p>
        </DialogContent>
      </Dialog>
      <Dialog open={alertsOpen} onOpenChange={setAlertsOpen}>
        <DialogContent className="daily-detail-dialog">
          <DialogHeader>
            <DialogTitle>异动监测 · {latestDate || "最新可用日"}</DialogTitle>
            <DialogDescription>
              监测结果基于日环比与上周同日变化，尚非 AI 原因诊断。
            </DialogDescription>
          </DialogHeader>
          <div className="daily-detail-signals">
            {alerts.map((alert) => (
              <Link
                key={`${alert.platform}:${alert.metric}:${alert.window}`}
                to={anomalyHref(alert)}
                onClick={() => setAlertsOpen(false)}
              >
                <span>
                  {platformLabels[alert.platform]} ·{" "}
                  {metricLabels[alert.metric]}
                  <small>
                    {alert.period} vs {alert.baselinePeriod} ·{" "}
                    {alert.window === "day" ? "日环比" : "上周同日"}
                  </small>
                </span>
                <b>
                  {alert.change < 0 ? "下降" : "上升"}{" "}
                  {Math.abs(alert.change * 100).toFixed(2)}%{" "}
                  <ArrowUpRight size={14} />
                </b>
              </Link>
            ))}
          </div>
          {!alerts.length && (
            <p className="daily-muted">当前端的当日未触发异动阈值。</p>
          )}
          <p className="daily-muted">
            异常阈值使用前 12 个完整业务周的历史分位数，最低变化幅度为 10%。
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={updatesOpen} onOpenChange={setUpdatesOpen}>
        <DialogContent className="daily-detail-dialog">
          <DialogHeader>
            <DialogTitle>更新记录</DialogTitle>
            <DialogDescription>
              当前数据覆盖、同步任务与报告更新
            </DialogDescription>
          </DialogHeader>
          <dl className="daily-update-detail">
            <div>
              <dt>本地可用范围</dt>
              <dd>
                {LOCAL_DATA_WINDOW
                  ? `${LOCAL_DATA_WINDOW.startDate} — ${LOCAL_DATA_WINDOW.endDate}`
                  : "使用服务端数据"}
              </dd>
            </div>
            <div>
              <dt>最近同步</dt>
              <dd>
                {sync
                  ? `${sync.startDate} — ${sync.endDate} · ${statusLabels[sync.status]}`
                  : "暂无可用同步记录"}
              </dd>
            </div>
            <div>
              <dt>产品动作入仓时间</dt>
              <dd>{actions?.readAt || "暂不可用"}</dd>
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
                    {job?.status === "failed" && (
                      <p>{job.errorMessage || "报告生成失败"}</p>
                    )}
                    {report ? (
                      <Link
                        to={`${reportHref(item)}&period=${getReportPeriodKey(report.periodStart, report.periodEnd)}`}
                      >
                        {report.periodStart} — {report.periodEnd} ·{" "}
                        {new Intl.DateTimeFormat("zh-CN", {
                          timeZone: "Asia/Shanghai",
                          dateStyle: "short",
                          timeStyle: "short",
                          hour12: false,
                        }).format(new Date(report.generatedAt))}
                        <ArrowUpRight size={12} className="inline ml-1" />
                      </Link>
                    ) : reportErrors.includes(item) ? (
                      "暂不可用"
                    ) : (
                      "暂无已生成报告"
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
        </DialogContent>
      </Dialog>
    </aside>
  );
}
