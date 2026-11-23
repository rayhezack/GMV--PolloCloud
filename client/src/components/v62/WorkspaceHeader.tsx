import { Search, useSearchSpring } from '@/components/bencho/Search';
import { getGmvAnomalies } from '@/api/dashboard';
import { useEffect, useState, useRef, type CSSProperties } from 'react';
import { publishActivity, readActivities, useActivities } from '@/lib/activity-notifications';
import { Link } from 'react-router-dom';
import { WorkbenchIcon } from '@/components/icons/WorkbenchIcon';
import { DASHBOARD_VIEWS, dashboardHref } from '@/components/dashboard/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronRight } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { STATIC_DEMO_MODE } from '@/lib/demo-data';
import type { DailyDiagnosisStatus, ReportGenerationStatus, SyncRunStatus } from '@shared/api.interface';

export function WorkspaceHeader({
  title,
  management,
  displayName,
  avatarUrl,
  search,
  sync,
  jobs,
  dailyJobs,
}: {
  title: string;
  management: boolean;
  displayName: string;
  avatarUrl?: string;
  search: string;
  sync: SyncRunStatus | null;
  jobs: ReportGenerationStatus[];
  dailyJobs: DailyDiagnosisStatus[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchHost = useRef<HTMLDivElement>(null);
  const still =
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const arrival = useSearchSpring(open ? 100 : 0, still, 20);
  const results = DASHBOARD_VIEWS.filter((view) => view.label.toLowerCase().includes(query.trim().toLowerCase()));
  const activities = useActivities();
  const unread = activities.filter((item) => !item.read).length;
  useEffect(() => {
    if (sync && ['success', 'failed'].includes(sync.status))
      publishActivity({
        id: `sync:${sync.runId}:${sync.status}`,
        title: sync.status === 'success' ? '数据更新完成' : '数据更新失败',
        body: sync.endDate,
        href: '/?tab=data',
      });
    jobs.forEach((job) => {
      if (['success', 'failed'].includes(job.status))
        publishActivity({
          id: `report:${job.runId}:${job.status}`,
          title: `${job.platform === 'web' ? 'Web' : 'App'} 报告${job.status === 'success' ? '更新完成' : '生成失败'}`,
          body: `${job.periodStart} – ${job.periodEnd}`,
          href: `/report?platform=${job.platform}`,
        });
    });
    dailyJobs.forEach((job) => {
      if (job.status === 'success' && job.report)
        publishActivity({
          id: `daily:${job.report.runId}`,
          title: `${job.period} 日诊断完成`,
          href: `/?tab=trend&platform=${job.platform}&selectedDay=${job.period}`,
        });
    });
  }, [sync, jobs, dailyJobs]);
  useEffect(() => {
    let live = true;
    void getGmvAnomalies(undefined, undefined, 'all')
      .then((data) => {
        if (!live) return;
        const recent = data.alerts.filter((alert) => alert.period === data.latestDay);
        if (recent.length)
          publishActivity({
            id: `anomaly:${data.latestDay}`,
            title: `${data.latestDay.slice(5).replace('-', '/')} · ${recent.length} 项异动`,
            href: `/?tab=trend&platform=all&selectedDay=${data.latestDay}`,
          });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [sync?.runId, sync?.status]);
  return (
    <header className="v62-workspace-header">
      <nav className="v62-breadcrumb" aria-label="当前位置">
        <WorkbenchIcon name={management ? '文件夹' : 'workspace'} />
        <span>{management ? '诊断与管理' : '分析工作台'}</span>
        <ChevronRight size={14} aria-hidden="true" />
        <b aria-current="page">{title}</b>
      </nav>
      {STATIC_DEMO_MODE && <span className="v62-preview-tag">示例数据</span>}
      <div className="v62-header-actions">
        <div ref={searchHost} className="v62-header-search">
          <Search
            alwaysOpen
            width={260}
            placeholder="搜索分析页面…"
            value={query}
            onActivate={() => setOpen(true)}
            onChange={(value) => {
              setQuery(value);
              setOpen(true);
            }}
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button className="v62-icon-button v62-notification-button" aria-label={`更新通知，${unread} 条未读`}>
              <WorkbenchIcon name="bell" />
              {unread > 0 && <span className="activity-unread-dot" aria-hidden="true" />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="v62-notifications">
            <div className="activity-heading">
              <h2>动态</h2>
              <button className="v62-button" onClick={readActivities} disabled={!unread}>
                全部已读
              </button>
            </div>
            {!activities.length && <p>暂无动态</p>}
            <div className="activity-list">
              {activities.map((item) => (
                <div className="activity-item" key={item.id} data-unread={!item.read}>
                  {item.href ? <Link to={item.href}>{item.title}</Link> : <strong>{item.title}</strong>}
                  {item.body && <p>{item.body}</p>}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Link
          to="/permissions"
          className="v62-account-button"
          aria-label={`个人账号：${displayName}`}
          title={displayName}
        >
          <Avatar className="v62-account-avatar">
            {avatarUrl && <AvatarImage src={avatarUrl} />}
            <AvatarFallback>{displayName.slice(0, 1)}</AvatarFallback>
          </Avatar>
        </Link>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="v62-search-dialog"
          style={{ '--search-arrival': arrival / 100 } as CSSProperties}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            searchHost.current?.querySelector('input')?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>搜索页面</DialogTitle>
            <DialogDescription className="sr-only">输入页面名称，选择要打开的页面。</DialogDescription>
          </DialogHeader>
          <input
            aria-label="页面名称"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索分析页面…"
          />
          <div className="v62-search-results">
            {!results.length && <p className="v62-search-empty">未找到匹配页面</p>}
            {results.map((view) => (
              <Link
                className="v62-search-result"
                key={view.id}
                to={dashboardHref(view.id, search)}
                onClick={() => setOpen(false)}
              >
                <WorkbenchIcon name={view.icon} />
                {view.label}
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
