import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ReportGenerationStatus } from '@shared/api.interface';
import { CheckCircle2, Loader2, AlertCircle, Circle, ChevronUp, ChevronDown, X, ArrowUpRight } from 'lucide-react';
import { formatAnalysisWeekLabel, formatGeneratedAt, getReportPeriodKey } from '@/pages/ReportPage/report-page.utils';

export function ReportTask({ jobs }: { jobs: ReportGenerationStatus[] }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState('');
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [openedAt] = useState(() => new Date().toISOString());
  const observed = useRef(new Set<string>());
  const location = useLocation();
  const lastLocation = useRef(location.key);
  const active = (job: ReportGenerationStatus) => job.status === 'queued' || job.status === 'running';
  useEffect(() => {
    jobs.filter(active).forEach(job => observed.current.add(job.runId));
    if (lastLocation.current !== location.key) {
      setDismissed(current => [...new Set([...current, ...jobs.filter(job => !active(job)).map(job => job.runId)])]);
      setExpanded(false);
      lastLocation.current = location.key;
    }
  }, [jobs, location.key]);
  const visible = jobs.filter(job => !dismissed.includes(job.runId) && (active(job) || observed.current.has(job.runId) || job.startedAt >= openedAt));
  const job = visible.find(item => item.runId === selected) ?? visible.find(active) ?? [...visible].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!job) return null;
  const steps = job.steps ?? [];
  const done = steps.filter(step => step.status === 'success').length;
  const progress = steps.length ? Math.round(done / steps.length * 100) : 0;
  const label = job.status === 'failed' ? '报告生成失败' : job.status === 'success' ? '报告已生成' : '报告生成中';
  const StatusIcon = job.status === 'failed' ? AlertCircle : job.status === 'success' ? CheckCircle2 : Loader2;
  return (
    <aside className="report-task-dock" aria-label="报告任务" data-expanded={expanded}>
      {expanded && <section id="report-task-details" className="report-task-details">
        <header><strong>报告任务</strong><button type="button" aria-label="收起任务详情" onClick={() => setExpanded(false)}><ChevronDown size={18} /></button></header>
        {visible.length > 1 && <div className="report-task-platforms">{visible.map(item => <button type="button" key={item.runId} aria-pressed={item.runId === job.runId} onClick={() => setSelected(item.runId)}>{item.platform === 'web' ? 'Web' : 'App'}</button>)}</div>}
        <p className="report-task-period">{job.platform === 'web' ? 'Web' : 'App'} · {formatAnalysisWeekLabel(job.periodStart, job.periodEnd)}</p>
        <ol className="report-task-list">
          {steps.map(step => <li key={step.key} data-state={step.status}>
            {step.status === 'success' ? <CheckCircle2 size={16} /> : step.status === 'failed' ? <AlertCircle size={16} /> : step.status === 'running' ? <Loader2 size={16} className="animate-spin" /> : <Circle size={16} />}
            <div><div className="report-task-line"><span>{step.label}</span><small>{step.status === 'success' ? '已完成' : step.status === 'running' ? '处理中' : step.status === 'failed' ? '失败' : '等待'}</small></div>
              {step.status === 'running' && <div className="report-step-progress is-running" />}
              {step.detail && <p>{step.detail}</p>}
            </div>
          </li>)}
        </ol>
        <footer>
          {job.status === 'failed' && <p role="alert">{job.errorMessage}</p>}
          <span>更新于 {formatGeneratedAt(job.heartbeatAt || job.finishedAt || job.startedAt)}</span>
          <Link to={`/report?platform=${job.platform}&period=${getReportPeriodKey(job.periodStart, job.periodEnd)}`}>{job.status === 'success' ? '查看报告' : job.status === 'failed' ? '返回报告重试' : '前往报告'}<ArrowUpRight size={14} /></Link>
        </footer>
      </section>}
      <div className="report-task-summary" data-state={job.status}>
        <button className="report-task-toggle" type="button" aria-expanded={expanded} aria-controls="report-task-details" onClick={() => setExpanded(value => !value)}>
          <StatusIcon size={18} className={active(job) ? 'animate-spin' : ''} />
          <span><strong>{label}</strong><small>{active(job) ? `${done} / ${steps.length} 步骤 · 点击查看进度` : `${job.platform === 'web' ? 'Web' : 'App'} · 点击查看详情`}</small></span>
          {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        {!active(job) && <button className="report-task-dismiss" type="button" aria-label="关闭任务提醒" onClick={() => setDismissed(current => [...current, job.runId])}><X size={16} /></button>}
        <div className="report-progress" role="progressbar" aria-label="报告已完成步骤" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div>
      </div>
    </aside>
  );
}
