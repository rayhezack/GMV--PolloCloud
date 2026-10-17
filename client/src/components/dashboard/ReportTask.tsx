import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ReportGenerationStatus, SyncRunStatus } from '@shared/api.interface';
import { CheckCircle2, Loader2, AlertCircle, Circle, ChevronUp, ChevronDown, X, ArrowUpRight, RotateCcw, Pause, Play, PauseCircle } from 'lucide-react';
import { formatAnalysisWeekLabel, formatGeneratedAt, getReportPeriodKey } from '@/pages/ReportPage/report-page.utils';
import { generateReport, pauseReportGeneration, resumeReportGeneration } from '@/api/report';
import { pauseSyncRun, resumeSyncRun, retrySyncRun } from '@/api/sync';
import { toast } from 'sonner';
import { pushToast } from '@/components/bencho/ToastStack';

type Step = { key: string; label: string; status: 'waiting' | 'running' | 'success' | 'failed'; detail?: string };
type Task = {
  id: string;
  kind: 'report' | 'sync';
  name: string;
  context: string;
  status: 'queued' | 'running' | 'pausing' | 'paused' | 'success' | 'failed';
  startedAt: string;
  updatedAt: string;
  steps: Step[];
  errorMessage?: string;
  href: string;
};

const DISMISSED_TASKS_KEY = 'pollo-dismissed-task-runs';

const isActiveStatus = (status: Task['status']) => ['queued', 'running', 'pausing', 'paused'].includes(status);

function readDismissedTasks(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(DISMISSED_TASKS_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function ReportTask({
  jobs,
  syncJob,
  onTrackReport,
  onTrackSync,
}: {
  jobs: ReportGenerationStatus[];
  syncJob: SyncRunStatus | null;
  onTrackReport: (job: ReportGenerationStatus) => void;
  onTrackSync: (job: SyncRunStatus) => void;
}) {
  const location = useLocation();
  const dockRef = useRef<HTMLElement>(null);
  const [expandedTaskId, setExpandedTaskId] = useState('');
  const [selected, setSelected] = useState('');
  const [dismissed, setDismissed] = useState(readDismissedTasks);
  const [retrying, setRetrying] = useState('');
  const previousStatuses = useRef(new Map<string, Task['status']>());
  const tasks: Task[] = [
    ...jobs.map(job => ({
      id: job.runId, kind: 'report' as const, name: `报告 · ${job.platform === 'web' ? 'Web' : 'App'}`,
      context: `${job.platform === 'web' ? 'Web' : 'App'} · ${formatAnalysisWeekLabel(job.periodStart, job.periodEnd)}`,
      status: job.status, startedAt: job.startedAt, updatedAt: job.heartbeatAt || job.finishedAt || job.startedAt,
      steps: job.steps ?? [], errorMessage: job.errorMessage,
      href: `/report?platform=${job.platform}&period=${getReportPeriodKey(job.periodStart, job.periodEnd)}`,
    })),
    ...(syncJob ? [{
      id: syncJob.runId, kind: 'sync' as const, name: '数据同步',
      context: `${syncJob.platforms.map(item => item === 'web' ? 'Web' : 'App').join(' + ')} · ${syncJob.startDate} ~ ${syncJob.endDate}`,
      status: syncJob.status, startedAt: syncJob.startedAt, updatedAt: syncJob.heartbeatAt || syncJob.finishedAt || syncJob.startedAt,
      steps: syncJob.steps ?? [], errorMessage: syncJob.errorMessage, href: '/?tab=data',
    }] : []),
  ];
  const active = (task: Task) => ['queued', 'running', 'pausing', 'paused'].includes(task.status);
  const executing = (task: Task) => ['queued', 'running', 'pausing'].includes(task.status);
  const visible = tasks.filter(task => !dismissed.includes(task.id));
  const job = visible.find(item => item.id === selected) ?? visible.filter(active).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
    ?? [...visible].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  // The selected report tab and the visibility of the task details are separate
  // states. Switching tabs must replace the details without collapsing the dock.
  const expanded = Boolean(job && expandedTaskId);
  useEffect(() => {
    const nextStatuses = new Map(tasks.map(task => [task.id, task.status]));
    const cleanupTimers: number[] = [];
    for (const task of tasks) {
      const previous = previousStatuses.current.get(task.id);
      if (!previous && !isActiveStatus(task.status)) {
        // A completed task may be the first state returned after a page reload.
        // Give a fresh completion a short reading window, then remove it too.
        const age = Date.now() - Date.parse(task.updatedAt);
        const timer = window.setTimeout(() => {
          setDismissed(current => current.includes(task.id) ? current : [...current, task.id]);
        }, Math.max(1000, 3500 - Math.max(0, age)));
        cleanupTimers.push(timer);
        continue;
      }
      if (!previous || !isActiveStatus(previous) || isActiveStatus(task.status)) continue;
      const failed = task.status === 'failed';
      pushToast({
        kind: failed ? 'error' : 'success',
        title: task.kind === 'sync' ? (failed ? '数据同步失败' : '数据同步完成') : (failed ? '诊断报告生成失败' : '诊断报告已生成'),
        body: failed ? (task.errorMessage || '任务执行失败，请打开任务详情查看') : task.context,
      });
      const delay = failed ? 6500 : 4000;
      const timer = window.setTimeout(() => {
        setExpandedTaskId(current => current === task.id ? '' : current);
        setDismissed(current => current.includes(task.id) ? current : [...current, task.id]);
      }, delay);
      cleanupTimers.push(timer);
    }
    previousStatuses.current = nextStatuses;
    return () => cleanupTimers.forEach(timer => window.clearTimeout(timer));
  }, [jobs, syncJob]);
  useEffect(() => {
    try {
      window.localStorage.setItem(DISMISSED_TASKS_KEY, JSON.stringify(dismissed));
    } catch {
      // The task dock still works when local storage is unavailable.
    }
  }, [dismissed]);
  useEffect(() => {
    setSelected(current => {
      const currentTask = visible.find(task => task.id === current);
      const latestActive = visible.filter(active).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (latestActive && (!currentTask || !active(currentTask) || latestActive.startedAt > currentTask.startedAt)) return latestActive.id;
      return currentTask?.id ?? [...visible].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.id ?? '';
    });
  }, [jobs, syncJob, dismissed]);
  useEffect(() => {
    setExpandedTaskId('');
  }, [location.pathname, location.search]);
  useEffect(() => {
    if (!expanded) return undefined;
    const collapseOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && dockRef.current?.contains(target)) return;
      setExpandedTaskId('');
    };
    document.addEventListener('pointerdown', collapseOutside);
    return () => document.removeEventListener('pointerdown', collapseOutside);
  }, [expanded]);
  if (!job) return null;
  const done = job.steps.filter(step => step.status === 'success').length;
  const progress = job.steps.length ? Math.round(done / job.steps.length * 100) : job.status === 'success' ? 100 : 0;
  const label = job.kind === 'sync'
    ? job.status === 'failed' ? '数据同步失败' : job.status === 'success' ? '数据已同步' : job.status === 'paused' ? '数据同步已暂停' : job.status === 'pausing' ? '数据同步暂停中' : '数据同步中'
    : job.status === 'failed' ? '报告生成失败' : job.status === 'success' ? '报告已生成' : job.status === 'paused' ? '报告生成已暂停' : job.status === 'pausing' ? '报告生成暂停中' : '报告生成中';
  const StatusIcon = job.status === 'failed' ? AlertCircle : job.status === 'success' ? CheckCircle2 : job.status === 'paused' ? PauseCircle : Loader2;
  const rerun = async () => {
    if (active(job) || retrying) return;
    setRetrying(job.id);
    try {
      if (job.kind === 'report') {
        const source = jobs.find(item => item.runId === job.id);
        if (!source) throw new Error('未找到原报告任务');
        const next = await generateReport({ platform: source.platform, granularity: 'week', startDate: source.periodStart, endDate: source.periodEnd });
        onTrackReport(next);
        setSelected(next.runId);
        toast.info('报告任务已重新启动');
      } else {
        const next = await retrySyncRun(job.id);
        onTrackSync(next);
        setSelected(next.runId);
        toast.info('数据同步任务已重新启动');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '任务重新运行失败');
    } finally {
      setRetrying('');
    }
  };
  const pauseOrResume = async () => {
    if (retrying || job.status === 'pausing') return;
    setRetrying(job.id);
    try {
      const next = job.kind === 'report'
        ? job.status === 'paused' ? await resumeReportGeneration(job.id) : await pauseReportGeneration(job.id)
        : job.status === 'paused' ? await resumeSyncRun(job.id) : await pauseSyncRun(job.id);
      if (job.kind === 'report') onTrackReport(next as ReportGenerationStatus);
      else onTrackSync(next as SyncRunStatus);
      toast.info(job.status === 'paused' ? '任务已继续运行' : next.status === 'paused' ? '任务已暂停' : '将在当前阶段完成后暂停');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '任务状态更新失败');
    } finally {
      setRetrying('');
    }
  };
  return (
    <aside ref={dockRef} className="report-task-dock" aria-label="后台任务" data-expanded={expanded}>
      {expanded && <section id="report-task-details" className="report-task-details">
        <header><strong>{job.kind === 'sync' ? '数据同步任务' : '报告任务'}</strong><button type="button" aria-label="收起任务详情" onClick={() => setExpandedTaskId('')}><ChevronDown size={18} /></button></header>
        {visible.length > 1 && <div className="report-task-platforms">{visible.map(item => <button type="button" key={item.id} aria-pressed={item.id === job.id} onClick={() => { setSelected(item.id); setExpandedTaskId(item.id); }}>{item.name}</button>)}</div>}
        <p className="report-task-period">{job.context}</p>
        <ol className="report-task-list">
          {job.steps.map(step => <li key={step.key} data-state={step.status}>
            {step.status === 'success' ? <CheckCircle2 size={16} /> : step.status === 'failed' ? <AlertCircle size={16} /> : step.status === 'running' ? <Loader2 size={16} className="animate-spin" /> : <Circle size={16} />}
            <div><div className="report-task-line"><span>{step.label}</span><small>{step.status === 'success' ? '已完成' : step.status === 'running' ? '处理中' : step.status === 'failed' ? '失败' : '等待'}</small></div>
              {step.status === 'running' && <div className="report-step-progress is-running" />}
              {step.detail && <p>{step.detail}</p>}
            </div>
          </li>)}
        </ol>
        <footer>
          {job.status === 'failed' && <p role="alert">{job.errorMessage}</p>}
          <span>更新于 {formatGeneratedAt(job.updatedAt)}</span>
          <div className="report-task-actions">
            {active(job) && <button type="button" onClick={() => void pauseOrResume()} disabled={retrying === job.id || job.status === 'pausing'}>
              {job.status === 'paused' ? <Play size={14} /> : <Pause size={14} />}
              {retrying === job.id ? '处理中' : job.status === 'paused' ? '继续运行' : job.status === 'pausing' ? '暂停中' : '暂停'}
            </button>}
            {!active(job) && <button type="button" onClick={() => void rerun()} disabled={retrying === job.id}><RotateCcw size={14} className={retrying === job.id ? 'animate-spin' : ''} />{retrying === job.id ? '启动中' : '重新运行'}</button>}
            {job.kind !== 'sync' && (
              <Link to={job.href}>{job.status === 'success' ? '查看报告' : '前往报告'}<ArrowUpRight size={14} /></Link>
            )}
          </div>
        </footer>
      </section>}
      <div className="report-task-summary" data-state={job.status}>
        <button className="report-task-toggle" type="button" aria-expanded={expanded} aria-controls="report-task-details" onClick={() => setExpandedTaskId(current => current === job.id ? '' : job.id)}>
          <StatusIcon size={18} className={executing(job) ? 'animate-spin' : ''} />
          <span><strong>{label}</strong><small>{active(job) ? `${done} / ${job.steps.length} 步骤 · 点击查看进度` : `${job.name} · 点击查看详情`}</small></span>
          {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        {active(job) && <button className="report-task-control" type="button" aria-label={job.status === 'paused' ? '继续运行任务' : '暂停任务'} title={job.status === 'paused' ? '继续运行' : '暂停'} disabled={retrying === job.id || job.status === 'pausing'} onClick={() => void pauseOrResume()}>
          {job.status === 'paused' ? <Play size={16} /> : <Pause size={16} />}
        </button>}
        <button className="report-task-dismiss" type="button" aria-label="关闭任务提醒" onClick={() => { setExpandedTaskId(''); setDismissed(current => [...new Set([...current, job.id])]); }}><X size={16} /></button>
        <div className="report-progress" role="progressbar" aria-label="任务已完成步骤" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div>
      </div>
    </aside>
  );
}
