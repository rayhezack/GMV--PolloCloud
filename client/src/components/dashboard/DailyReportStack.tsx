import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getReportHistory } from '@/api/report';
import { useOutletContext } from 'react-router-dom';
import { openBackgroundTask } from '@/lib/background-task';
import { getDailyDiagnosis, regenerateDailyDiagnosis, runDailyDiagnosis } from '@/api/daily-diagnosis';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { DailyDiagnosisStatus, DashboardPlatform } from '@shared/api.interface';
import { completedDailyDiagnosisScopes } from '@/lib/daily-diagnosis-scope';
import './daily-report-stack.css';

const Reader = lazy(() => import('./DailyReportReader'));
const labels = { waiting: '等待完整数据', queued: '已加入诊断队列', running: '正在生成诊断', success: '查看日诊断', failed: '诊断失败', clear: '异动已解除', normal: '当日未触发异动' };
const platformLabels = { all: '大盘', web: 'Web', app: 'App' };
const platformOrder: DashboardPlatform[] = ['all', 'web', 'app'];

export default function DailyReportStack({ platform, platforms, period, refreshToken, canManage = false, mode = 'day' }: {
  platform: DashboardPlatform; platforms: DashboardPlatform[]; period: string; refreshToken: number; canManage?: boolean; mode?: 'day' | 'week';
}) {
  const { trackDaily } = useOutletContext<{ trackDaily: (job: DailyDiagnosisStatus) => void }>();
  const weekly = mode === 'week';
  const title = weekly ? '周诊断' : '日诊断';
  const dayOfWeek = new Date(`${period}T00:00:00Z`).getUTCDay();
  const weekEnd = period ? new Date(Date.parse(period) - ((dayOfWeek + 2) % 7) * 86400000).toISOString().slice(0, 10) : '';
  const weekStart = weekEnd ? new Date(Date.parse(weekEnd) - 13 * 86400000).toISOString().slice(0, 10) : '';
  // Only request scopes that actually triggered an anomaly on this day.
  const scopeKey = (weekly ? ['web', 'app'] : platformOrder.filter(scope => platforms.includes(scope))).join(',');
  const [statuses, setStatuses] = useState<Partial<Record<DashboardPlatform, DailyDiagnosisStatus>>>({});
  const [errors, setErrors] = useState<Partial<Record<DashboardPlatform, string>>>({});
  const [selected, setSelected] = useState(platform);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [focused, setFocused] = useState(false);
  const coverRef = useRef<HTMLButtonElement>(null);
  const expanded = hovered || pinned || focused;
  const [submitting, setSubmitting] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let inFlight = false;
    const scopes = scopeKey ? scopeKey.split(',') as DashboardPlatform[] : [];
    let pending = scopes;
    const load = async () => {
      if (inFlight || !active || !period || !pending.length) return;
      if (document.hidden) return;
      inFlight = true;
      const requested = pending;
      try {
        const results = await Promise.allSettled(requested.map(async scope => {
          if (!weekly) return getDailyDiagnosis(scope, period);
          const report = await getReportHistory({ platform: scope as 'web' | 'app', periodStart: weekStart, periodEnd: weekEnd });
          return { platform: scope, period, baseline: weekStart, status: report && report.periodEnd === weekEnd && !report.degraded ? 'success' : 'normal', updatedAt: report?.generatedAt || '', report: report ? { ...report, runId: `week:${scope}:${weekEnd}` } : undefined } as DailyDiagnosisStatus;
        }));
        if (!active) return;
        const next: Partial<Record<DashboardPlatform, DailyDiagnosisStatus>> = {};
        const failures: Partial<Record<DashboardPlatform, string>> = {};
        pending = [];
        results.forEach((result, index) => {
          const scope = requested[index];
          if (result.status === 'rejected') { failures[scope] = `${title}暂不可用`; pending.push(scope); return; }
          // A saved report from another date must not enter today's stack.
          if (result.value.period !== period) { failures[scope] = '当日报告暂不可用'; return; }
          next[scope] = result.value;
          if (!weekly) trackDaily(result.value);
          failures[scope] = '';
          if (!weekly && ['waiting', 'queued', 'running'].includes(result.value.status)) pending.push(scope);
        });
        setStatuses(current => ({ ...current, ...next }));
        setErrors(current => ({ ...current, ...failures }));
      } finally {
        inFlight = false;
        if (active && pending.length) { window.clearTimeout(timer); timer = window.setTimeout(load, 15000); }
      }
    };
    const onVisible = () => { if (!document.hidden) { window.clearTimeout(timer); void load(); } };
    void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [scopeKey, period, refreshToken, retryToken, weekly, weekStart, weekEnd, title, trackDaily]);

  const scopes = weekly ? ['web', 'app'] as DashboardPlatform[] : platformOrder.filter(scope => platforms.includes(scope));
  const completed = (weekly ? scopes.filter(scope => statuses[scope]?.status === 'success' && statuses[scope]?.report?.periodEnd === weekEnd) : completedDailyDiagnosisScopes(scopes, statuses, period)).filter(scope => !errors[scope]);
  const currentScope = scopes.includes(selected) ? selected : scopes.includes(platform) ? platform : scopes[0] ?? platform;
  const status = statuses[currentScope];
  const error = errors[currentScope] || '';
  const report = status?.report?.periodEnd === (weekly ? weekEnd : period) ? status.report : undefined;
  const outdated = Boolean(report && status?.status !== 'success');
  const label = error || (weekly ? report ? '查看周诊断' : '本周暂无已完成报告' : status ? labels[status.status] : scopes.length ? '读取日诊断…' : '当日未触发诊断');
  const papers = [...completed].sort((a, b) => Number(a === platform) - Number(b === platform));
  const regenerate = async (scope = currentScope) => {
    const source = statuses[scope];
    if (!source?.period || submitting) return;
    setSubmitting(true);
    try {
      const queued = await regenerateDailyDiagnosis(scope, source.period);
      setStatuses(current => ({ ...current, [scope]: queued }));
      trackDaily(queued);
      if (queued.task) openBackgroundTask(queued.task.runId);
      setErrors(current => ({ ...current, [scope]: '' }));
      setRetryToken(value => value + 1);
      // Submission ends here. The existing task monitor polls persisted progress;
      // keeping the dispatch response open is never the button's loading state.
      void runDailyDiagnosis(scope, source.period, queued.task?.runId).then(next => {
        setStatuses(current => ({ ...current, [scope]: next }));
        trackDaily(next);
        setRetryToken(value => value + 1);
      }).catch(() => { setRetryToken(value => value + 1); });
    } catch (cause) { setErrors(current => ({ ...current, [scope]: cause instanceof Error ? cause.message : '提交失败' })); }
    finally { setSubmitting(false); }
  };
  return <Sheet open={open} onOpenChange={setOpen}>
    <div className="daily-report-stack" data-expanded={completed.length > 0 && expanded} data-count={papers.length} role="group" aria-label={weekly ? '周诊断报告' : '当日异动诊断报告'}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={event => setFocused((event.target as HTMLElement).matches(':focus-visible'))} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false); }}
      onKeyDown={event => { if (event.key === 'Escape') { setPinned(false); setHovered(false); setFocused(false); } }}>
      <button ref={coverRef} type="button" className="daily-report-cover" aria-expanded={papers.length > 0 && expanded} aria-controls="daily-report-papers" onClick={() => papers.length ? setPinned(value => !value) : setOpen(true)} aria-label={`${title}，${papers.length ? `${papers.length}份报告，展开选择` : label}`}>
        <span className="daily-report-cover-heading"><strong>{title}</strong><time dateTime={weekly ? weekEnd : period}>{period ? (weekly ? weekEnd : period).slice(5).replace('-', '/') : '—'}</time></span>
        <span className="daily-report-cover-count">{papers.length ? <><b>{papers.length}</b> 份报告</> : label}</span>
      </button>
      <div id="daily-report-papers" className="daily-report-papers">
        {papers.map((scope, index) => <button key={scope} type="button" className="daily-report-paper" data-layer={papers.length - index} tabIndex={expanded ? 0 : -1} onClick={() => { setSelected(scope); setOpen(true); }} aria-label={`打开${platformLabels[scope]} ${weekly ? weekEnd : period} ${title}`}>
          <span className="daily-report-paper-title">{platformLabels[scope]} · {title}</span>
          <span className="daily-report-paper-lines" aria-hidden="true"><i /><i /><i /><i /></span>
        </button>)}
      </div>
    </div>
    {!weekly && canManage && <div className="daily-report-tasks">
      {scopes.map(scope => {
        const item = statuses[scope];
        if (!item || item.status === 'success') return null;
        return <div key={scope}>
          <span>{platformLabels[scope]} · {labels[item.status]}</span>
          <div>
            {item.task && <button type="button" onClick={() => { trackDaily(item); openBackgroundTask(item.task!.runId); }}>查看进度</button>}
            {['failed','waiting'].includes(item.status) && <button type="button" disabled={submitting} onClick={() => void regenerate(scope)}>{submitting ? '提交中' : item.status === 'failed' ? '重试' : '手动诊断'}</button>}
          </div>
          {errors[scope] && <p role="alert">{errors[scope]}</p>}
        </div>;
      })}
    </div>}
    <SheetContent className="daily-report-sheet" side="right" onCloseAutoFocus={event => { event.preventDefault(); coverRef.current?.focus(); }}>
      <SheetHeader>
        <SheetTitle>{platformLabels[currentScope]} · {title}</SheetTitle>
        <SheetDescription>{(weekly ? weekEnd : period) || '最新完整日'}{report ? ` · 对比 ${report.periodStart}` : ''}{outdated ? ' · 历史版本' : ''}</SheetDescription>
        {scopes.length > 1 && <div className="daily-report-switch" role="group" aria-label="切换诊断报告">{scopes.map(scope => <button type="button" key={scope} aria-pressed={scope === currentScope} onClick={() => setSelected(scope)}>{platformLabels[scope]}</button>)}</div>}
      </SheetHeader>
      <div className="daily-report-sheet-body">
        {(error || !report || outdated) && <div className="daily-report-state" role="status"><strong>{label}</strong>{status?.task && !weekly && <Button variant="ghost" size="sm" onClick={() => { setOpen(false); trackDaily(status); openBackgroundTask(status.task!.runId); }}>查看任务进度</Button>}{status?.error && <p>{status.error}</p>}{error && <Button variant="ghost" size="sm" onClick={() => setRetryToken(value => value + 1)}>重新读取</Button>}</div>}
        {report && open && <Suspense fallback={<p role="status" className="daily-muted">正在打开报告…</p>}><Reader report={report} mode={mode} /></Suspense>}
      </div>
      {!weekly && canManage && status && ['failed', 'success'].includes(status.status) && <div className="daily-report-sheet-footer"><Button variant="ghost" size="sm" disabled={submitting} onClick={() => void regenerate()}><RefreshCw size={14} />{submitting ? '提交中…' : status.status === 'failed' ? '重试诊断' : '重新生成'}</Button></div>}
    </SheetContent>
  </Sheet>;
}
