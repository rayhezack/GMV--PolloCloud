import type { ReportGenerationStatus } from '@shared/api.interface';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

const steps = [
  { key: 'queued', label: '排队' },
  { key: 'collect', label: '读取数据' },
  { key: 'model', label: '生成正文' },
  { key: 'write', label: '写入报告' },
];

export function ReportTask({ job }: { job: ReportGenerationStatus | null }) {
  if (!job) return null;
  const failed = job.status === 'failed';
  const success = job.status === 'success';
  const current = steps.findIndex((step) => step.key === job.stage);
  return (
    <section className="report-task" aria-label="报告生成状态" role="status">
      <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
        {failed ? (
          <AlertCircle size={16} />
        ) : success ? (
          <CheckCircle2 size={16} />
        ) : (
          <Loader2 size={16} className="animate-spin" />
        )}
        {failed
          ? '报告生成失败'
          : success
            ? '报告已生成'
            : `正在${steps[current]?.label ?? '处理'} · 可以切换页面继续分析`}
      </div>
      <p className="text-xs text-slate-500 mt-1">
        {job.platform.toUpperCase()} · {job.periodStart} — {job.periodEnd}
        {failed ? ` · ${job.errorMessage || '请稍后重试'}` : ''}
      </p>
      <ol className="task-steps">
        {steps.map((step, index) => (
          <li
            key={step.key}
            className="task-step"
            data-state={
              success || index < current
                ? 'done'
                : index === current
                  ? 'current'
                  : 'waiting'
            }
            aria-current={!success && index === current ? 'step' : undefined}
          >
            {index + 1}. {step.label}
            {success || index < current ? ' ✓' : ''}
          </li>
        ))}
      </ol>
    </section>
  );
}
