import { getDataCoverage } from '@/api/dashboard';
import { DAILY_DATASETS, type DailyDataset } from '@shared/daily-data';
import { EyeTracker } from './bencho/EyeTracker';
import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Menu, X, PanelLeft } from 'lucide-react';
import { DASHBOARD_VIEWS, dashboardHref, dashboardView } from './dashboard/navigation';
import './dashboard/dashboard.css';
import { WorkspaceHeader } from './v62/WorkspaceHeader';
import './v62/v62.css';
import { WorkbenchIcon } from './icons/WorkbenchIcon';
import { usePollocloudUser } from '@/hooks/use-pollocloud-user';
import { canManagePollocloudApp } from '@/lib/pollocloud';
import { executeReportGeneration, getLatestReportGeneration } from '@client/src/api/report';
import type { Platform, ReportGenerationStatus } from '@shared/api.interface';
import { getDailyDiagnosis } from '@/api/daily-diagnosis';
import type { DailyDiagnosisStatus, SyncRunStatus } from '@shared/api.interface';
import { executeSyncRun, getLatestSyncRun } from '@/api/sync';
import { ReportTask } from './dashboard/ReportTask';

const REPORT_GENERATION_KEEPALIVE_INTERVAL_MS = 10_000;
const REPORT_GENERATION_PLATFORMS: Platform[] = ['web', 'app'];
const SYNC_TICKS = 26;
const Layout = () => {
  const location = useLocation();
  // Start the cheap date lookup while the selected page chunk is downloading.
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const view = dashboardView(location.pathname, location.search).id;
    const dataset =
      view === 'ads'
        ? 'ads'
        : view === 'creative'
          ? 'creation_chain'
          : view === 'chain'
            ? p.get('chainType') === 'renewal'
              ? 'renewal'
              : 'chain'
            : view === 'details'
              ? p.get('dataset') || 'pay_type'
              : view === 'trend' || view === 'payment'
                ? 'pay_type'
                : '';
    if (!Object.prototype.hasOwnProperty.call(DAILY_DATASETS, dataset)) return;
    const platform = p.get('platform') === 'app' ? 'app' : p.get('platform') === 'web' ? 'web' : 'all';
    const deviceType =
      !['ads', 'details'].includes(view) && platform === 'app' && ['ios', 'android'].includes(p.get('deviceType') || '')
        ? (p.get('deviceType') as 'ios' | 'android')
        : undefined;
    void getDataCoverage({ dataset: dataset as DailyDataset, platform, deviceType, cacheBust: 0 }).catch(
      () => undefined,
    );
  }, [location.pathname, location.search]);
  useEffect(() => {
    const header = document.querySelector('.dashboard-content > .dashboard-heading');
    if (!header) return;
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty(
        '--dashboard-sticky-height',
        `${entry.target.getBoundingClientRect().height}px`,
      );
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, [location.pathname, location.search]);
  const { user: userInfo, loading: accessLoading } = usePollocloudUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [jobs, setJobs] = useState<ReportGenerationStatus[]>([]);
  const [dailyJobs, setDailyJobs] = useState<DailyDiagnosisStatus[]>([]);
  const dailyJobsRef = useRef<DailyDiagnosisStatus[]>([]);
  useEffect(() => {
    dailyJobsRef.current = dailyJobs;
  }, [dailyJobs]);
  const trackDaily = useCallback((job: DailyDiagnosisStatus) => {
    setDailyJobs((current) => [
      ...current.filter((item) => item.platform !== job.platform || item.period !== job.period),
      job,
    ]);
  }, []);
  const [syncJob, setSyncJob] = useState<SyncRunStatus | null>(null);
  const executingJobs = useRef(new Set<string>());
  const executingSyncJobs = useRef(new Set<string>());
  const trackReport = useCallback((job: ReportGenerationStatus) => {
    setJobs((current) => [...current.filter((item) => item.platform !== job.platform), job]);
  }, []);
  const trackSync = useCallback((job: SyncRunStatus) => {
    setSyncJob(job);
  }, []);
  useEffect(() => {
    if (!canManagePollocloudApp(userInfo)) return;
    const timers: number[] = [];
    for (const job of jobs) {
      if (job.status !== 'queued' || executingJobs.current.has(job.runId)) continue;
      timers.push(
        window.setTimeout(
          () => {
            if (executingJobs.current.has(job.runId)) return;
            executingJobs.current.add(job.runId);
            void executeReportGeneration(job.runId)
              .catch(() => undefined)
              .finally(() => {
                executingJobs.current.delete(job.runId);
                void getLatestReportGeneration(job.platform)
                  .then((latest) => {
                    if (latest) trackReport(latest);
                  })
                  .catch(() => undefined);
              });
          },
          Math.max(0, (job.nextAttemptAt || 0) - Date.now()),
        ),
      );
    }
    return () => timers.forEach(window.clearTimeout);
  }, [jobs, trackReport, userInfo]);
  useEffect(() => {
    if (
      !canManagePollocloudApp(userInfo) ||
      syncJob?.trigger !== 'manual' ||
      syncJob.status !== 'queued' ||
      executingSyncJobs.current.has(syncJob.runId)
    )
      return;
    executingSyncJobs.current.add(syncJob.runId);
    const executeStages = async () => {
      let current: SyncRunStatus | null = syncJob;
      while (current?.runId === syncJob.runId && current.trigger === 'manual' && current.status === 'queued') {
        await executeSyncRun(current.runId);
        current = await getLatestSyncRun();
        setSyncJob(current);
      }
    };
    void executeStages()
      .catch(() => undefined)
      .finally(() => {
        executingSyncJobs.current.delete(syncJob.runId);
        void getLatestSyncRun()
          .then((latest) => {
            if (latest) setSyncJob(latest);
          })
          .catch(() => undefined);
      });
  }, [syncJob, userInfo]);
  const currentView = dashboardView(location.pathname, location.search);
  const isDashboardRoute = !/\/(admin|permissions)\/?$/.test(location.pathname);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector('.dashboard-main')?.scrollTo({ top: 0 });
  }, [currentView.id, location.pathname]);
  useEffect(() => {
    setSidebarOpen(false);
    setDockOpen(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    try {
      window.localStorage.setItem('pollo-compact-nav-expanded', String(!sidebarCollapsed));
    } catch {
      // Local storage is optional; the layout remains usable without it.
    }
  }, [sidebarCollapsed]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [sidebarOpen]);
  const isAdmin = !accessLoading && canManagePollocloudApp(userInfo);

  useEffect(() => {
    if (!userInfo) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const refreshGenerationJobs = async () => {
      let active = false;
      try {
        const latestJobs = await Promise.all(
          REPORT_GENERATION_PLATFORMS.map((item) => getLatestReportGeneration(item)),
        );
        active = latestJobs.some((job) => job && ['queued', 'running', 'waiting'].includes(job.status));
        if (!cancelled) setJobs(latestJobs.filter((job): job is ReportGenerationStatus => Boolean(job)));
      } catch {
        if (cancelled) return;
      } finally {
        if (!cancelled)
          timer = window.setTimeout(
            refreshGenerationJobs,
            active && document.visibilityState === 'visible' ? REPORT_GENERATION_KEEPALIVE_INTERVAL_MS : 60_000,
          );
      }
    };
    timer = window.setTimeout(refreshGenerationJobs, 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userInfo]);

  useEffect(() => {
    if (!userInfo) return;
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      let active = false;
      try {
        const job = await getLatestSyncRun();
        active = Boolean(job && ['queued', 'running', 'pausing'].includes(job.status));
        if (!cancelled) setSyncJob(job);
      } catch {
        /* The dock keeps its last known state until the next poll. */
      } finally {
        if (!cancelled)
          timer = window.setTimeout(refresh, active && document.visibilityState === 'visible' ? 3000 : 60_000);
      }
    };
    timer = window.setTimeout(refresh, 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userInfo]);

  useEffect(() => {
    if (!userInfo) return;
    let cancelled = false;
    let timer: number;
    const refresh = async () => {
      const requests = (['all', 'web', 'app'] as const).map((scope) => getDailyDiagnosis(scope, undefined, true));
      for (const item of dailyJobsRef.current) {
        if (['queued', 'running', 'waiting'].includes(item.status) && item.period)
          requests.push(getDailyDiagnosis(item.platform, item.period, true));
      }
      const results = await Promise.allSettled(requests);
      if (cancelled) return;
      results.forEach((result) => {
        if (result.status === 'fulfilled') trackDaily(result.value);
      });
      const active = dailyJobsRef.current.some((job) => ['queued', 'running', 'waiting'].includes(job.status));
      timer = window.setTimeout(refresh, active && document.visibilityState === 'visible' ? 5000 : 60_000);
    };
    timer = window.setTimeout(refresh, 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userInfo, trackDaily]);

  const displayName = accessLoading ? '读取权限' : userInfo?.userName || 'Pollo Cloud';
  const syncSteps = syncJob?.steps ?? [];
  const syncProgress = !syncJob
    ? 0
    : syncJob.status === 'success'
      ? 1
      : syncSteps.length
        ? syncSteps.filter((step) => step.status === 'success').length / syncSteps.length
        : 0;
  const syncTicksFilled = Math.round(syncProgress * SYNC_TICKS);
  const syncStatusLabel = !syncJob
    ? '—'
    : {
        queued: '排队中',
        running: '同步中',
        pausing: '暂停中',
        paused: '已暂停',
        success: '已完成',
        failed: '失败',
        cancelled: '已取消',
      }[syncJob.status];
  const avatarUrl = userInfo?.avatar;

  return (
    <div className="dashboard-shell v62-shell" data-sidebar-collapsed={sidebarCollapsed || undefined}>
      <button
        className="sidebar-scrim"
        data-open={sidebarOpen}
        aria-label="关闭侧栏"
        tabIndex={sidebarOpen ? 0 : -1}
        onClick={() => setSidebarOpen(false)}
      />
      <aside
        className="dashboard-sidebar"
        inert={sidebarCollapsed && !sidebarOpen ? true : undefined}
        data-open={sidebarOpen}
        aria-label="主导航"
      >
        <div className="sidebar-brand-row">
          <Link to={dashboardHref('trend', location.search)} className="dashboard-brand" aria-label="Pollo AI 分析首页">
            <EyeTracker size={36} eyeScale={1.65} eyeHeight={1.2} within=".dashboard-shell" interactive={false} />
            <span>
              Pollo AI<small>GMV ANALYTICS</small>
            </span>
          </Link>
          <button
            type="button"
            className="sidebar-collapse-button"
            aria-label="收起导航"
            title="收起导航"
            onClick={() => setSidebarCollapsed(true)}
          >
            <PanelLeft size={18} strokeWidth={1.8} />
            <span>收起导航</span>
          </button>
        </div>
        <button
          className="mobile-menu-button absolute right-2 top-2 p-2"
          aria-label="关闭菜单"
          onClick={() => setSidebarOpen(false)}
        >
          <X size={18} />
        </button>
        <nav aria-label="分析工作台">
          <div className="sidebar-group-label">分析工作台</div>
          {DASHBOARD_VIEWS.map((view, i) => (
            <div key={view.id}>
              {view.id === 'report' && <div className="sidebar-group-label mt-8">诊断与管理</div>}
              <Link
                to={dashboardHref(view.id, location.search)}
                className="sidebar-link"
                aria-current={currentView.id === view.id && isDashboardRoute ? 'page' : undefined}
              >
                {currentView.id === view.id && isDashboardRoute && (
                  <motion.span
                    className="sidebar-active"
                    layoutId="sidebar-active"
                    transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 450, damping: 38 }}
                  />
                )}
                <WorkbenchIcon name={view.icon} active={isDashboardRoute && currentView.id === view.id} />
                <span>{view.label}</span>
              </Link>
            </div>
          ))}
          <NavLink to="/permissions" className="sidebar-link">
            <WorkbenchIcon name="shield-check" active={location.pathname.endsWith('/permissions')} />
            <span>账号与权限</span>
          </NavLink>
        </nav>
      </aside>
      <nav
        className="dashboard-dock"
        inert={!sidebarCollapsed ? true : undefined}
        data-expanded={dockOpen || undefined}
        aria-label="折叠导航"
        onPointerEnter={() => setDockOpen(true)}
        onPointerLeave={() => setDockOpen(false)}
        onFocusCapture={() => setDockOpen(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDockOpen(false);
        }}
      >
        {DASHBOARD_VIEWS.map((view) => (
          <Fragment key={view.id}>
            {view.id === 'report' && <span className="dock-group-divider" role="separator" aria-label="诊断与管理" />}
            <Link
              to={dashboardHref(view.id, location.search)}
              className="dock-link"
              aria-current={currentView.id === view.id ? 'page' : undefined}
              onMouseDown={(event) => event.currentTarget.blur()}
            >
              <span className="dock-label">{view.label}</span>
              <WorkbenchIcon name={view.icon} active={currentView.id === view.id} />
              {currentView.id === view.id ? <i aria-hidden="true" /> : null}
            </Link>
          </Fragment>
        ))}
        <button
          type="button"
          className="dock-expand-button"
          aria-label="展开导航"
          title="展开导航"
          onClick={() => setSidebarCollapsed(false)}
        >
          <PanelLeft size={18} strokeWidth={1.8} />
        </button>
      </nav>
      <div className="dashboard-main">
        <div className="dashboard-mobile-toolbar">
          <button
            className="mobile-menu-button"
            aria-label="打开菜单"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
        </div>
        <WorkspaceHeader
          title={
            location.pathname.endsWith('/permissions')
              ? '账号与权限'
              : location.pathname.endsWith('/admin')
                ? '管理后台'
                : currentView.label
          }
          management={!isDashboardRoute || ['report', 'data'].includes(currentView.id)}
          displayName={displayName}
          avatarUrl={avatarUrl}
          search={location.search}
          sync={syncJob}
          jobs={jobs}
          dailyJobs={dailyJobs}
        />
        <main id="main-content">
          <Suspense
            fallback={
              <div className="px-8 py-12 text-sm text-muted-foreground" role="status">
                正在打开页面…
              </div>
            }
          >
            <Outlet context={{ trackReport, trackSync, trackDaily, dailyJobs, jobs, syncJob, canManage: isAdmin }} />
          </Suspense>
        </main>
      </div>
      {isAdmin && (
        <ReportTask
          jobs={jobs}
          syncJob={syncJob}
          dailyJobs={dailyJobs}
          onTrackDaily={trackDaily}
          onTrackReport={trackReport}
          onTrackSync={trackSync}
        />
      )}
    </div>
  );
};

export default Layout;
