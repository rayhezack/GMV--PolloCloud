import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Menu,
  X,
  PanelLeft,
} from 'lucide-react';
import {
  DASHBOARD_VIEWS,
  dashboardHref,
  dashboardView,
} from './dashboard/navigation';
import './dashboard/dashboard.css';
import { ShieldCheck } from 'lucide-react';
import { usePollocloudUser } from '@/hooks/use-pollocloud-user';
import { canManagePollocloudApp } from '@/lib/pollocloud';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { executeReportGeneration, getLatestReportGeneration } from '@client/src/api/report';
import type { Platform, ReportGenerationStatus } from '@shared/api.interface';
import type { SyncRunStatus } from '@shared/api.interface';
import { executeSyncRun, getLatestSyncRun } from '@/api/sync';
import { ReportTask } from './dashboard/ReportTask';
import { pushToast, ToastStack } from './bencho/ToastStack';

const REPORT_GENERATION_KEEPALIVE_INTERVAL_MS = 10_000;
const REPORT_GENERATION_PLATFORMS: Platform[] = ['web', 'app'];
const SYNC_TOAST_SEEN_PREFIX = 'pollo-sync-toast-seen';

function shanghaiDate(value: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
    typeof value === 'string' ? new Date(value) : value,
  );
}

function shanghaiTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function LogoWatcher() {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const mark = ref.current;
    if (!mark) return;
    const follow = (event: PointerEvent) => {
      const box = mark.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (event.clientX - (box.left + box.width / 2)) / 90));
      const y = Math.max(-1, Math.min(1, (event.clientY - (box.top + box.height / 2)) / 90));
      mark.style.setProperty('--watch-x', `${x * 4}px`);
      mark.style.setProperty('--watch-y', `${y * 4}px`);
    };
    const reset = () => {
      mark.style.setProperty('--watch-x', '0px');
      mark.style.setProperty('--watch-y', '0px');
    };
    window.addEventListener('pointermove', follow, { passive: true });
    document.documentElement.addEventListener('pointerleave', reset);
    return () => {
      window.removeEventListener('pointermove', follow);
      document.documentElement.removeEventListener('pointerleave', reset);
    };
  }, []);
  return (
    <span ref={ref} className="dashboard-brand-mark logo-watcher" aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

const Layout = () => {
  const { user: userInfo, loading: accessLoading } = usePollocloudUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('pollo-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [jobs, setJobs] = useState<ReportGenerationStatus[]>([]);
  const [syncJob, setSyncJob] = useState<SyncRunStatus | null>(null);
  const executingJobs = useRef(new Set<string>());
  const executingSyncJobs = useRef(new Set<string>());
  const notifiedSyncDays = useRef(new Set<string>());
  useEffect(() => {
    if (!import.meta.env.DEV || !new URLSearchParams(window.location.search).has('toastTest')) return;
    pushToast({
      kind: 'success',
      title: '数据同步完成',
      body: '测试：已更新 1,248 条分析记录',
      detail: '完成时间：今天 09:30\n已从 MaxCompute 拉取并写入 D1，共更新 1,248 条分析记录。',
      href: '/?tab=data',
      linkLabel: '查看数据与口径',
    });
    pushToast({
      kind: 'warning',
      title: 'Web · 大盘 GMV 异动',
      body: '测试：最新业务周日均 +12.4%，超过阈值 +10.0%',
      detail: '分析周期：2026-10-10\n最新业务周日均 GMV 上升 12.4%，超过历史 p95 与 +10% 门槛。\n建议：先查看「GMV 趋势」Tab，再进入「付费类型」Tab 做下钻。',
      href: '/?tab=trend&platform=web&metric=activeGmv&analysisWeek=2026-10-10',
      linkLabel: '查看 GMV 趋势',
    });
  }, []);
  const trackReport = useCallback((job: ReportGenerationStatus) => { setJobs(current => [...current.filter(item => item.platform !== job.platform), job]); }, []);
  const trackSync = useCallback((job: SyncRunStatus) => { setSyncJob(job); }, []);
  useEffect(() => {
    if (!canManagePollocloudApp(userInfo)) return;
    for (const job of jobs) {
      if (job.status !== 'queued' || executingJobs.current.has(job.runId)) continue;
      executingJobs.current.add(job.runId);
      void executeReportGeneration(job.runId).catch(() => undefined).finally(() => {
        executingJobs.current.delete(job.runId);
        void getLatestReportGeneration(job.platform).then(latest => { if (latest) trackReport(latest); }).catch(() => undefined);
      });
    }
  }, [jobs, trackReport, userInfo]);
  useEffect(() => {
    if (!canManagePollocloudApp(userInfo) || syncJob?.status !== 'queued' || executingSyncJobs.current.has(syncJob.runId)) return;
    executingSyncJobs.current.add(syncJob.runId);
    const executeStages = async () => {
      let current: SyncRunStatus | null = syncJob;
      while (current?.status === 'queued') {
        await executeSyncRun(current.runId);
        current = await getLatestSyncRun();
        setSyncJob(current);
      }
    };
    void executeStages().catch(() => undefined).finally(() => {
      executingSyncJobs.current.delete(syncJob.runId);
      void getLatestSyncRun().then(latest => { if (latest) setSyncJob(latest); }).catch(() => undefined);
    });
  }, [syncJob, userInfo]);
  const location = useLocation();
  const currentView = dashboardView(location.pathname, location.search);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentView.id, location.pathname]);
  useEffect(() => {
    setSidebarOpen(false);
    setDockOpen(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        'pollo-sidebar-collapsed',
        String(sidebarCollapsed),
      );
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
  const isAdmin =
    !accessLoading && canManagePollocloudApp(userInfo);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    const refreshGenerationJobs = async () => {
      try {
        const latestJobs = await Promise.all(
          REPORT_GENERATION_PLATFORMS.map((item) =>
            getLatestReportGeneration(item),
          ),
        );
        if (!cancelled)
          setJobs(
            latestJobs.filter((job): job is ReportGenerationStatus =>
              Boolean(job),
            ),
          );
      } catch {
        if (cancelled) return;
      }
    };
    void refreshGenerationJobs();
    const timer = window.setInterval(
      refreshGenerationJobs,
      REPORT_GENERATION_KEEPALIVE_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!userInfo) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const job = await getLatestSyncRun();
        if (!cancelled) setSyncJob(job);
      } catch { /* The dock keeps its last known state until the next poll. */ }
    };
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [userInfo]);

  useEffect(() => {
    if (!userInfo || syncJob?.status !== 'success' || syncJob.skipped || !syncJob.finishedAt) return;
    const today = shanghaiDate(new Date());
    if (shanghaiDate(syncJob.finishedAt) !== today) return;
    const seenKey = `${SYNC_TOAST_SEEN_PREFIX}:${userInfo.userId}:${today}`;
    if (notifiedSyncDays.current.has(seenKey)) return;
    try {
      if (window.localStorage.getItem(seenKey)) {
        notifiedSyncDays.current.add(seenKey);
        return;
      }
      window.localStorage.setItem(seenKey, syncJob.runId);
    } catch {
      // The in-memory guard still prevents duplicate notifications in this tab.
    }
    notifiedSyncDays.current.add(seenKey);
    pushToast({
      kind: 'success',
      title: '数据同步完成',
      body: `已更新 ${syncJob.rowsSynced.toLocaleString('en-US')} 条分析记录`,
      detail: `完成时间：今天 ${shanghaiTime(syncJob.finishedAt)}\n数据已从 MaxCompute 拉取并写入 D1。`,
      href: '/?tab=data',
      linkLabel: '查看数据与口径',
    });
  }, [syncJob, userInfo]);

  const displayName = accessLoading ? '读取权限' : userInfo?.userName || 'Pollo Cloud';
  const avatarUrl = userInfo?.avatar;

  return (
    <div
      className="dashboard-shell"
      data-sidebar-collapsed={sidebarCollapsed || undefined}
    >
      <button
        className="sidebar-scrim"
        data-open={sidebarOpen}
        aria-label="关闭侧栏"
        tabIndex={sidebarOpen ? 0 : -1}
        onClick={() => setSidebarOpen(false)}
      />
      <aside
        className="dashboard-sidebar"
        data-open={sidebarOpen}
        aria-label="主导航"
      >
        <div className="sidebar-brand-row">
          <Link
            to={dashboardHref('trend', location.search)}
            className="dashboard-brand"
            aria-label="Pollo AI 分析首页"
          >
            <LogoWatcher />
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
        <nav aria-label="分析看板">
          <div className="sidebar-group-label">分析看板</div>
          {DASHBOARD_VIEWS.map((view, i) => (
            <div key={view.id}>
              {i === 4 && (
                <div className="sidebar-group-label mt-8">诊断与管理</div>
              )}
              <Link
                to={dashboardHref(view.id, location.search)}
                className="sidebar-link"
                aria-current={
                  currentView.id === view.id &&
                  !location.pathname.endsWith('/admin')
                    ? 'page'
                    : undefined
                }
              >
                {currentView.id === view.id &&
                  !location.pathname.endsWith('/admin') && (
                    <motion.span
                      className="sidebar-active"
                      layoutId="sidebar-active"
                      transition={
                        reducedMotion
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 450, damping: 38 }
                      }
                    />
                  )}
                <view.icon size={18} strokeWidth={1.7} />
                <span>{view.label}</span>
              </Link>
            </div>
          ))}
          <NavLink to="/permissions" className="sidebar-link">
            <ShieldCheck size={18} />
            <span>账号与权限</span>
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <Link
              to="/permissions"
              className="flex items-center gap-2 rounded-full px-1.5 py-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="账号与权限"
            >
              <Avatar className="size-7">
                {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
                <AvatarFallback className="text-xs bg-muted text-muted-foreground">
                  {displayName.slice(0, 1)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden md:inline text-sm text-foreground max-w-24 truncate">
                {displayName}
              </span>
            </Link>
          </div>
        </div>
      </aside>
      <nav
        className="dashboard-dock"
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
          <Link
            key={view.id}
            to={dashboardHref(view.id, location.search)}
            className="dock-link"
            aria-current={currentView.id === view.id ? 'page' : undefined}
            onMouseDown={(event) => event.currentTarget.blur()}
          >
            <span className="dock-label">{view.label}</span>
            <view.icon size={20} strokeWidth={1.8} />
            {currentView.id === view.id ? <i aria-hidden="true" /> : null}
          </Link>
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
        <main id="main-content">
          <Outlet context={{ trackReport, trackSync }} />
        </main>
      </div>
      {isAdmin && <ReportTask jobs={jobs} syncJob={syncJob} onTrackReport={trackReport} onTrackSync={trackSync} />}
      <ToastStack />
    </div>
  );
};

export default Layout;
