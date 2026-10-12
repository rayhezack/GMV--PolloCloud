import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReportGenerationStatus, SyncRunStatus } from '@shared/api.interface';
import { CheckCircle2, Loader2, AlertCircle, Circle, ChevronUp, ChevronDown, X, ArrowUpRight, RotateCcw } from 'lucide-react';
import { formatAnalysisWeekLabel, formatGeneratedAt, getReportPeriodKey } from '@/pages/ReportPage/report-page.utils';
import { generateReport } from '@/api/report';
import { retrySyncRun } from '@/api/sync';
import { toast } from 'sonner';

type Step = { key: string; label: string; status: 'waiting' | 'running' | 'success' | 'failed'; detail?: string };
type Task = {
  id: string;
  kind: 'report' | 'sync';
  name: string;
  context: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  startedAt: string;
  updatedAt: string;
  steps: Step[];
  errorMessage?: string;
  href: string;
};

const DISMISSED_TASKS_KEY = 'pollo-dismissed-task-runs';

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
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState('');
  const [dismissed, setDismissed] = useState(readDismissedTasks);
  const [retrying, setRetrying] = useState('');
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
  const active = (task: Task) => task.status === 'queued' || task.status === 'running';
  const visible = tasks.filter(task => !dismissed.includes(task.id));
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
  const job = visible.find(item => item.id === selected) ?? visible.filter(active).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
    ?? [...visible].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!job) return null;
  const done = job.steps.filter(step => step.status === 'success').length;
  const progress = job.steps.length ? Math.round(done / job.steps.length * 100) : job.status === 'success' ? 100 : 0;
  const label = job.kind === 'sync'
    ? job.status === 'failed' ? '数据同步失败' : job.status === 'success' ? '数据已同步' : '数据同步中'
    : job.status === 'failed' ? '报告生成失败' : job.status === 'success' ? '报告已生成' : '报告生成中';
  const StatusIcon = job.status === 'failed' ? AlertCircle : job.status === 'success' ? CheckCircle2 : Loader2;
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
  return (
    <aside className="report-task-dock" aria-label="后台任务" data-expanded={expanded}>
      {expanded && <section id="report-task-details" className="report-task-details">
        <header><strong>{job.kind === 'sync' ? '数据同步任务' : '报告任务'}</strong><button type="button" aria-label="收起任务详情" onClick={() => setExpanded(false)}><ChevronDown size={18} /></button></header>
        {visible.length > 1 && <div className="report-task-platforms">{visible.map(item => <button type="button" key={item.id} aria-pressed={item.id === job.id} onClick={() => setSelected(item.id)}>{item.name}</button>)}</div>}
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
            {!active(job) && <button type="button" onClick={() => void rerun()} disabled={retrying === job.id}><RotateCcw size={14} className={retrying === job.id ? 'animate-spin' : ''} />{retrying === job.id ? '启动中' : '重新运行'}</button>}
            <Link to={job.href}>{job.kind === 'sync' ? '查看数据与口径' : job.status === 'success' ? '查看报告' : '前往报告'}<ArrowUpRight size={14} /></Link>
          </div>
        </footer>
      </section>}
      <div className="report-task-summary" data-state={job.status}>
        <button className="report-task-toggle" type="button" aria-expanded={expanded} aria-controls="report-task-details" onClick={() => setExpanded(value => !value)}>
          <StatusIcon size={18} className={active(job) ? 'animate-spin' : ''} />
          <span><strong>{label}</strong><small>{active(job) ? `${done} / ${job.steps.length} 步骤 · 点击查看进度` : `${job.name} · 点击查看详情`}</small></span>
          {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <button className="report-task-dismiss" type="button" aria-label="关闭任务提醒" onClick={() => setDismissed(current => [...new Set([...current, job.id])])}><X size={16} /></button>
        <div className="report-progress" role="progressbar" aria-label="任务已完成步骤" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div>
      </div>
    </aside>
  );
}
