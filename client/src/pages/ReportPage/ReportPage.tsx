import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  LockKeyhole,
  RefreshCw,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@client/src/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@client/src/components/ui/tabs';
import { usePollocloudUser } from '@/hooks/use-pollocloud-user';
import { canManagePollocloudApp } from '@/lib/pollocloud';
import {
  generateReport,
  getLatestReport,
  getLatestReportGeneration,
  getReportHistory,
  listReportHistory,
} from '@client/src/api/report';
import type {
  Platform,
  ReportGenerationRequest,
  ReportGenerationStatus,
  ReportHistoryItem,
  ReportSummary,
} from '@shared/api.interface';
import {
  buildDefaultRequest,
  formatAnalysisWeekLabel,
  getReportPeriodKey,
  parseReportPeriodKey,
} from './report-page.utils';
import { ReportTask } from '@/components/dashboard/ReportTask';
import { copyAnalysis } from '@/components/dashboard/AnalysisWidgets';
import { ReportInsightArticle } from './ReportInsightRenderer';

const REPORT_POLL_INTERVAL_MS = 3000;

function normalizePlatform(value: string | null): Platform {
  return value === 'app' ? 'app' : 'web';
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const response = (error as { response?: { data?: unknown } }).response;
    const responseMessage = readErrorResponseMessage(response?.data);
    if (responseMessage) return responseMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

function readErrorResponseMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const body = data as {
    error?: { message?: unknown };
    message?: unknown;
  };
  if (typeof body.message === 'string') return body.message;
  if (Array.isArray(body.message)) return body.message.join('；');
  if (typeof body.error?.message === 'string') return body.error.message;
  return '';
}

function isSamePeriod(
  item: Pick<ReportHistoryItem, 'periodStart' | 'periodEnd'>,
  period: { periodStart: string; periodEnd: string },
): boolean {
  return (
    item.periodStart === period.periodStart &&
    item.periodEnd === period.periodEnd
  );
}

async function loadFirstAvailableHistoryReport(
  platform: Platform,
  historyItems: ReportHistoryItem[],
): Promise<{
  report: ReportSummary | null;
  historyItem: ReportHistoryItem | null;
}> {
  for (const item of historyItems) {
    try {
      const report = await getReportHistory({
        platform,
        periodStart: item.periodStart,
        periodEnd: item.periodEnd,
      });
      if (report) return { report, historyItem: item };
    } catch {
      continue;
    }
  }
  return { report: null, historyItem: null };
}

function findHistoryItemForReport(
  historyItems: ReportHistoryItem[],
  report: ReportSummary | null,
): ReportHistoryItem | null {
  if (!report) return null;
  return (
    historyItems.find((item) =>
      isSamePeriod(item, {
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
      }),
    ) ?? null
  );
}

const ReportPage = () => {
  const { trackReport } = useOutletContext<{ trackReport: (job: ReportGenerationStatus) => void }>();
  const { user, loading: accessLoading } = usePollocloudUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const platform = normalizePlatform(searchParams.get('platform'));
  const periodParam = searchParams.get('period');
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [history, setHistory] = useState<ReportHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generation, setGeneration] = useState<ReportGenerationStatus | null>(
    null,
  );
  useEffect(() => {
    setGeneration(null);
  }, [platform]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mergeHistoryItem = useCallback((nextReport: ReportSummary) => {
    setHistory((current) => {
      const nextItem: ReportHistoryItem = {
        platform: nextReport.platform,
        periodStart: nextReport.periodStart,
        periodEnd: nextReport.periodEnd,
        modelUsed: nextReport.modelUsed,
        degraded: nextReport.degraded,
        generatedAt: nextReport.generatedAt,
      };
      const next = current.filter(
        (item) =>
          getReportPeriodKey(item.periodStart, item.periodEnd) !==
          getReportPeriodKey(nextItem.periodStart, nextItem.periodEnd),
      );
      next.push(nextItem);
      return next.sort((a, b) => {
        const periodDiff = b.periodEnd.localeCompare(a.periodEnd);
        if (periodDiff !== 0) return periodDiff;
        return b.generatedAt.localeCompare(a.generatedAt);
      });
    });
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const settleGeneration = useCallback(
    (status: ReportGenerationStatus, notify = true): boolean => {
      setGeneration(status);
      trackReport(status);
      if (status.status === 'queued' || status.status === 'running') {
        setGenerating(true);
        return false;
      }
      stopPolling();
      setGenerating(false);
      if (status.status === 'success' && status.report) {
        const selectedPeriod = parseReportPeriodKey(periodParam);
        if (
          !selectedPeriod ||
          (selectedPeriod.periodStart === status.report.periodStart &&
            selectedPeriod.periodEnd === status.report.periodEnd)
        ) {
          setReport(status.report);
        }
        mergeHistoryItem(status.report);
        if (notify) toast.success('报告生成完成');
      } else {
        if (notify) {
          toast.error(`报告生成失败: ${status.errorMessage ?? '未知错误'}`);
        }
      }
      return true;
    },
    [mergeHistoryItem, periodParam, stopPolling, trackReport],
  );

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => {
      getLatestReportGeneration(platform)
        .then((status) => {
          if (status) settleGeneration(status);
        })
        .catch(() => undefined);
    }, REPORT_POLL_INTERVAL_MS);
  }, [platform, settleGeneration, stopPolling]);

  useEffect(() => {
    let cancelled = false;
    const loadLatest = async () => {
      stopPolling();
      setGenerating(false);
      setLoading(true);
      setHistoryLoading(true);
      setReport(null);
      try {
        const [historyItems, generation] = await Promise.all([
          listReportHistory(platform),
          getLatestReportGeneration(platform),
        ]);
        const selectedPeriod = parseReportPeriodKey(periodParam);
        let selectedReport: ReportSummary | null = null;
        let loadedHistoryItem: ReportHistoryItem | null = null;

        if (selectedPeriod) {
          const selectedHistoryItem = historyItems.find((item) =>
            isSamePeriod(item, selectedPeriod),
          );
          const candidates = selectedHistoryItem
            ? [
                selectedHistoryItem,
                ...historyItems.filter((item) => item !== selectedHistoryItem),
              ]
            : historyItems;
          const loaded = await loadFirstAvailableHistoryReport(
            platform,
            candidates,
          );
          selectedReport = loaded.report;
          loadedHistoryItem = loaded.historyItem;
          if (!selectedReport) {
            selectedReport = await getLatestReport(platform);
            loadedHistoryItem = findHistoryItemForReport(
              historyItems,
              selectedReport,
            );
          }
        } else {
          selectedReport = await getLatestReport(platform);
          loadedHistoryItem = findHistoryItemForReport(
            historyItems,
            selectedReport,
          );
          if (!selectedReport) {
            const loaded = await loadFirstAvailableHistoryReport(
              platform,
              historyItems,
            );
            selectedReport = loaded.report;
            loadedHistoryItem = loaded.historyItem;
          }
        }
        if (!cancelled) {
          setHistory(historyItems);
          setReport(selectedReport);
          if (selectedPeriod || periodParam) {
            const next = new URLSearchParams(searchParams);
            next.set('platform', platform);
            if (loadedHistoryItem) {
              const fallbackPeriodKey = getReportPeriodKey(
                loadedHistoryItem.periodStart,
                loadedHistoryItem.periodEnd,
              );
              if (fallbackPeriodKey !== periodParam) {
                next.set('period', fallbackPeriodKey);
                setSearchParams(next, { replace: true });
              }
            } else {
              next.delete('period');
              setSearchParams(next, { replace: true });
            }
          }
        }
        if (
          !cancelled &&
          generation &&
          (generation.status === 'queued' || generation.status === 'running')
        ) {
          const settled = settleGeneration(generation, false);
          if (!settled) startPolling();
        }
      } catch (error) {
        if (!cancelled) {
          setReport(null);
          const message = getErrorMessage(error);
          toast.error(`加载最近报告失败: ${message}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setHistoryLoading(false);
        }
      }
    };
    void loadLatest();
    return () => {
      cancelled = true;
    };
  }, [
    periodParam,
    platform,
    searchParams,
    setSearchParams,
    settleGeneration,
    startPolling,
    stopPolling,
  ]);

  useEffect(
    () => () => {
      stopPolling();
    },
    [stopPolling],
  );

  const handleRegenerate = useCallback(async () => {
    if (accessLoading || !canManagePollocloudApp(user)) return;
    setGenerating(true);
    try {
      const request: ReportGenerationRequest = buildDefaultRequest(platform);
      const status = await generateReport(request);
      const next = new URLSearchParams(searchParams);
      next.set('platform', platform);
      next.delete('period');
      setSearchParams(next, { replace: true });
      if (!settleGeneration(status)) {
        startPolling();
        toast.info('报告生成任务已启动');
      }
    } catch (error) {
      const message = getErrorMessage(error);
      toast.error(`报告生成失败: ${message}`);
      setGenerating(false);
    } finally {
      if (!pollRef.current) setGenerating(false);
    }
  }, [
    accessLoading,
    user,
    platform,
    searchParams,
    setSearchParams,
    settleGeneration,
    startPolling,
  ]);

  const isAdmin = canManagePollocloudApp(user);

  const handlePlatformChange = useCallback(
    (nextPlatform: string) => {
      if (nextPlatform !== 'web' && nextPlatform !== 'app') return;
      const next = new URLSearchParams(searchParams);
      next.set('platform', nextPlatform);
      next.delete('period');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handlePeriodChange = useCallback(
    (periodKey: string) => {
      const selected = history.find(
        (item) =>
          getReportPeriodKey(item.periodStart, item.periodEnd) === periodKey,
      );
      if (!selected) return;
      const next = new URLSearchParams(searchParams);
      next.set('platform', platform);
      next.set('period', periodKey);
      setSearchParams(next, { replace: true });
    },
    [history, platform, searchParams, setSearchParams],
  );

  const selectedPeriodKey = report
    ? getReportPeriodKey(report.periodStart, report.periodEnd)
    : '';

  return (
    <div>
      <div className="dashboard-content">
        <div className="dashboard-heading">
          <div>
            <h1>诊断报告</h1>
            <p>从核心结论到证据，回溯完整业务周的变化。</p>
          </div>
          {report && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => void copyAnalysis(report.markdown)}
            >
              <Copy size={14} />
              复制报告
            </Button>
          )}
        </div>
        <section className="rounded-3xl bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-gray-700 hover:bg-gray-100"
                asChild
              >
                <Link to="/">
                  <ArrowLeft className="size-4" />
                  返回看板
                </Link>
              </Button>
              <h1 className="text-base font-semibold tracking-tight text-gray-900">
                GMV诊断归因报告
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">业务周</span>
                <Select
                  value={selectedPeriodKey}
                  onValueChange={handlePeriodChange}
                  disabled={historyLoading || history.length === 0}
                >
                  <SelectTrigger className="h-10 min-w-[220px] rounded-full border-gray-200 bg-white text-gray-700 focus:ring-2 focus:ring-[#b8d0c8]">
                    <SelectValue placeholder="暂无历史报告" />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {history.map((item) => {
                      const key = getReportPeriodKey(
                        item.periodStart,
                        item.periodEnd,
                      );
                      return (
                        <SelectItem key={key} value={key}>
                          {formatAnalysisWeekLabel(
                            item.periodStart,
                            item.periodEnd,
                          )}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <Tabs value={platform} onValueChange={handlePlatformChange}>
                <TabsList className="h-10 rounded-full bg-gray-100 p-1">
                  <TabsTrigger
                    value="web"
                    className="rounded-full px-4 text-gray-600 data-[state=active]:bg-white data-[state=active]:text-[#34474c] data-[state=active]:shadow-sm focus-visible:ring-[#b8d0c8]"
                  >
                    Web 端
                  </TabsTrigger>
                  <TabsTrigger
                    value="app"
                    className="rounded-full px-4 text-gray-600 data-[state=active]:bg-white data-[state=active]:text-[#34474c] data-[state=active]:shadow-sm focus-visible:ring-[#b8d0c8]"
                  >
                    App 端
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Button
                onClick={() => void handleRegenerate()}
                disabled={generating || loading || !isAdmin}
                title={isAdmin ? undefined : '仅管理员可以生成诊断报告'}
                className="rounded-full bg-[#3f3f46] px-4 text-white hover:bg-[#2e2e34] focus-visible:ring-2 focus-visible:ring-[#d9b4eb]"
              >
                {accessLoading ? (
                  <RefreshCw className="animate-spin" />
                ) : isAdmin ? (
                  <RefreshCw className={generating ? 'animate-spin' : ''} />
                ) : (
                  <LockKeyhole />
                )}
                {generating
                  ? '生成中'
                  : accessLoading
                    ? '检查权限'
                    : isAdmin
                      ? '重新生成'
                      : '仅管理员可生成'}
              </Button>
            </div>
          </div>
        </section>

        <ReportTask job={generation} />
        {loading ? (
          <section className="rounded-3xl bg-white p-8 shadow-[0_24px_70px_rgba(15,23,42,0.05)]">
            <div className="animate-pulse">
              <div className="h-4 w-28 rounded-full bg-gray-100" />
              <div className="mt-5 h-12 w-80 max-w-full rounded-2xl bg-gray-100" />
              <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="h-36 rounded-2xl bg-gray-50" />
                <div className="h-36 rounded-2xl bg-gray-50" />
                <div className="h-36 rounded-2xl bg-gray-50" />
              </div>
              <div className="mt-6 space-y-3">
                <div className="h-3 w-full max-w-3xl rounded-full bg-gray-100" />
                <div className="h-3 w-2/3 rounded-full bg-gray-100" />
              </div>
            </div>
          </section>
        ) : !report ? (
          <section className="flex flex-col items-center justify-center gap-4 rounded-3xl bg-white px-6 py-24 shadow-[0_24px_70px_rgba(15,23,42,0.05)]">
            <FileText className="size-10 text-gray-400" />
            <div className="text-center">
              <p className="text-base font-medium text-gray-900">
                暂无诊断报告
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {isAdmin
                  ? '当前端口暂无报告，可基于最近完整业务周生成。'
                  : '当前端口暂无报告，请联系管理员生成。'}
              </p>
            </div>
            <Button
              onClick={() => void handleRegenerate()}
              disabled={generating || !isAdmin}
              title={isAdmin ? undefined : '仅管理员可以生成诊断报告'}
              className="rounded-full bg-[#3f3f46] px-4 text-white hover:bg-[#2e2e34] focus-visible:ring-2 focus-visible:ring-[#d9b4eb]"
            >
              {accessLoading ? (
                <RefreshCw className="animate-spin" />
              ) : isAdmin ? (
                <RefreshCw className={generating ? 'animate-spin' : ''} />
              ) : (
                <LockKeyhole />
              )}
              {generating
                ? '生成中'
                : accessLoading
                  ? '检查权限'
                  : isAdmin
                    ? '生成报告'
                    : '仅管理员可生成'}
            </Button>
          </section>
        ) : (
          <ReportInsightArticle report={report} />
        )}
      </div>
    </div>
  );
};

export default ReportPage;
