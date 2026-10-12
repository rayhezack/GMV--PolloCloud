import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileText, RefreshCw, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePollocloudUser } from '@/hooks/use-pollocloud-user';
import { canManagePollocloudApp } from '@/lib/pollocloud';
import { generateReport, getLatestReportGeneration, getReportHistory, listReportHistory } from '@/api/report';
import type { Platform, ReportGenerationStatus, ReportHistoryItem, ReportSummary } from '@shared/api.interface';
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
  const matchesSelection = (item: ReportHistoryItem | ReportSummary) => item.platform === platform && item.periodStart === periodStart && item.periodEnd === periodEnd;
  const hasReport = Boolean(report && matchesSelection(report)) || history.some(matchesSelection);

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

  const generate = async () => {
    if (!isAdmin || generating) return;
    setSubmitting(true);
    try {
      const job = await generateReport({ platform, granularity: 'week', startDate: periodStart, endDate: periodEnd });
      setGeneration(job);
      trackReport(job);
      toast.info('报告生成任务已启动');
    } catch (error) { toast.error(error instanceof Error ? error.message : '报告生成失败'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="dashboard-content report-reading-page">
      <div className="dashboard-heading">
        <div><h1>诊断报告</h1><p>从核心结论到证据，回溯完整业务周的变化。</p></div>
        {report && <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void copyAnalysis(report.markdown)}><Copy size={14} />复制报告</Button>}
      </div>
      <section className="report-controls">
        <Button variant="ghost" size="sm" className="rounded-full" asChild><Link to="/"><ArrowLeft className="size-4" />返回看板</Link></Button>
        <div className="report-controls-actions">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">业务周</span>
            <ReportWeekSelect weeks={weeks} value={getReportPeriodKey(periodStart, periodEnd)} onValueChange={value => {
              const next = new URLSearchParams(searchParams); next.set('period', value); setSearchParams(next);
            }} />
          </div>
          <Tabs value={platform} onValueChange={value => { const next = new URLSearchParams(searchParams); next.set('platform', value); setSearchParams(next); }}>
            <TabsList className="rounded-full"><TabsTrigger value="web" className="rounded-full">Web 端</TabsTrigger><TabsTrigger value="app" className="rounded-full">App 端</TabsTrigger></TabsList>
          </Tabs>
          <Button onClick={() => void generate()} disabled={generationPending || loading || Boolean(loadError) || accessLoading || !isAdmin} className="rounded-full" title={isAdmin ? undefined : '仅管理员和协作者可以生成报告'}>
            <RefreshCw size={16} className={generating ? 'animate-spin' : ''} />{generation?.status === 'paused' ? '已暂停' : generation?.status === 'pausing' ? '暂停中' : generating ? '生成中' : hasReport ? '重新生成' : '生成'}
          </Button>
        </div>
      </section>
      {pollError && <p className="text-sm text-muted-foreground" role="status">{pollError}</p>}
      {loading ? <section className="report-empty" role="status"><RefreshCw className="animate-spin" />正在读取报告</section>
        : loadError ? <section className="report-empty" role="alert"><p>{loadError}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>重试</Button></section>
          : report ? <ReportInsightArticle report={report} />
            : <section className="report-empty"><FileText size={32} /><strong>该业务周暂无报告</strong><p>{isAdmin ? '选择业务周后，点击「生成」即可创建报告。' : '请联系管理员生成该业务周的报告。'}</p></section>}
    </div>
  );
}
