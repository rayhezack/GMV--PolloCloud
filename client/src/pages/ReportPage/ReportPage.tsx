import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { FileText, RefreshCw, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { usePollocloudUser } from '@/hooks/use-pollocloud-user';
import { canManagePollocloudApp } from '@/lib/pollocloud';
import { generateReport, getLatestReportGeneration, getReportHistory, listReportHistory } from '@/api/report';
import type { Platform, ReportGenerationStatus, ReportHistoryItem, ReportSummary } from '@shared/api.interface';
import { CreateMenu } from '@/components/bencho';
import type { CreateMenuScope } from '@/components/bencho';
import { buildDefaultRequest, getReportPeriodKey, parseReportPeriodKey, reportWeekOptions } from './report-page.utils';
import { ReportWeekSelect } from './ReportWeekSelect';
import { copyAnalysis } from '@/components/dashboard/AnalysisWidgets';
import { ReportInsightArticle } from './ReportInsightRenderer';

export default function ReportPage() {
  const { trackReport } = useOutletContext<{ trackReport: (job: ReportGenerationStatus) => void }>();
  const { user, loading: accessLoading } = usePollocloudUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const platform: Platform = searchParams.get('platform') === 'app' ? 'app' : 'web';
  const defaults = buildDefaultRequest(platform);
  const period = parseReportPeriodKey(searchParams.get('period')) ?? { periodStart: defaults.startDate, periodEnd: defaults.endDate };
  const { periodStart, periodEnd } = period;
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [history, setHistory] = useState<ReportHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [generation, setGeneration] = useState<ReportGenerationStatus | null>(null);
  const [pollError, setPollError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const isAdmin = canManagePollocloudApp(user);
  const weeks = useMemo(() => reportWeekOptions(history), [history]);
  const generationPending = ['queued', 'running', 'pausing', 'paused'].includes(generation?.status ?? '');
  const generating = submitting || ['queued', 'running', 'pausing'].includes(generation?.status ?? '');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReport(null);
    setLoadError('');
    void Promise.all([listReportHistory(platform), getReportHistory({ platform, periodStart, periodEnd })])
      .then(([items, detail]) => { if (!cancelled) { setHistory(items); setReport(detail); } })
      .catch(error => { if (!cancelled) setLoadError(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [platform, periodStart, periodEnd, reload]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setGeneration(null);
    const refresh = async () => {
      try {
        const job = await getLatestReportGeneration(platform);
        if (cancelled) return;
        setGeneration(job);
        setPollError('');
        if (job) trackReport(job);
        if (job?.status === 'success' && job.report?.periodStart === periodStart && job.report.periodEnd === periodEnd) setReport(job.report);
      } catch {
        if (!cancelled) setPollError('暂时无法查询进度，正在重试。');
      } finally {
        if (!cancelled) timer = setTimeout(refresh, 3000);
      }
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [platform, periodStart, periodEnd, trackReport]);

  const generate = async (scope: CreateMenuScope) => {
    if (!isAdmin || generating) return;
    if (report && !window.confirm('当前业务周已有报告，确认重新生成吗？')) return;
    setSubmitting(true);
    try {
      const platforms: Platform[] = scope === 'both' ? ['web', 'app'] : [scope];
      const jobs = await Promise.all(platforms.map(target => generateReport({ platform: target, granularity: 'week', startDate: periodStart, endDate: periodEnd })));
      const selectedJob = jobs.find(job => job.platform === platform) ?? jobs[0];
      setGeneration(selectedJob);
      jobs.forEach(trackReport);
      toast.info(scope === 'both' ? 'Web 和 App 报告已并行启动' : `${scope === 'web' ? 'Web' : 'App'} 报告生成任务已启动`);
    } catch (error) { toast.error(error instanceof Error ? error.message : '报告生成失败'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="dashboard-content report-reading-page">
      <div className="dashboard-heading">
        <div><h1>诊断报告</h1><p>从核心结论到证据，回溯业务周的变化。</p></div>
        <div className="report-heading-actions">
          <ReportWeekSelect weeks={weeks} value={getReportPeriodKey(periodStart, periodEnd)} onValueChange={value => {
            const next = new URLSearchParams(searchParams); next.set('period', value); setSearchParams(next);
          }} />
          <CreateMenu
            busy={generating}
            disabled={generationPending || loading || Boolean(loadError) || accessLoading || !isAdmin}
            onSelect={scope => void generate(scope)}
          />
          {report && <Button variant="ghost" size="sm" className="report-copy-button rounded-xl" onClick={() => void copyAnalysis(report.markdown)}><Copy size={14} />复制报告</Button>}
        </div>
      </div>
      {pollError && <p className="text-sm text-muted-foreground" role="status">{pollError}</p>}
      {loading ? <section className="report-empty" role="status"><RefreshCw className="animate-spin" />正在读取报告</section>
        : loadError ? <section className="report-empty" role="alert"><p>{loadError}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>重试</Button></section>
          : report ? <ReportInsightArticle report={report} />
            : <section className="report-empty"><FileText size={32} /><strong>该业务周暂无报告</strong><p>{isAdmin ? '选择业务周后，点击「生成」即可创建报告。' : '请联系管理员生成该业务周的报告。'}</p></section>}
    </div>
  );
}
