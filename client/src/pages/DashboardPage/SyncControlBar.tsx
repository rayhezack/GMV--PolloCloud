import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@client/src/components/ui/alert-dialog';
import { Badge } from '@client/src/components/ui/badge';
import { usePollocloudUser } from '@/hooks/use-pollocloud-user';
import { canManagePollocloudApp } from '@/lib/pollocloud';
import { Button } from '@client/src/components/ui/button';
import {
  createSyncRun,
  getLatestDaySyncPlan,
  getLatestSyncRun,
} from '@client/src/api/sync';
import type {
  LatestDaySyncPlan,
  SyncRunResponse,
  SyncRunStatus,
  WorkbookSheet,
} from '@shared/api.interface';

const POLL_INTERVAL_MS = 2000;
const SYNC_SURFACE_CLASS =
  'rounded-3xl bg-white p-6 shadow-[0_18px_45px_rgba(15,23,42,0.04)] md:p-8';
const SYNC_PILL_CLASS =
  'rounded-full border border-gray-200 bg-white text-gray-700 shadow-none transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-600';

const SHEET_LABELS: Record<WorkbookSheet, string> = {
  run_log: '运行日志',
  pay_type_daily: '付费类型日表',
  pay_type_weekly: '付费类型周表',
  chain_daily: '支付链路日表',
  chain_weekly: '支付链路周表',
  creative_daily: '创作积极性日表',
  creative_weekly: '创作积极性周表',
  renewal_daily: '自动续订日表',
  latest_report: '最新诊断报告',
  report_history: '历史诊断报告',
  product_actions: '产品动作明细',
  report_generation_jobs: '报告生成任务',
};

function statusFromResponse(response: SyncRunResponse): SyncRunStatus {
  return {
    runId: response.runId,
    status: response.status,
    stage: ['running', 'queued', 'pausing', 'paused'].includes(response.status) ? 'pull' : 'write',
    startDate: response.startDate,
    endDate: response.endDate,
    platforms: response.platforms,
    rowsSynced: response.rowsSynced,
    errorMessage: response.errorMessage,
    startedAt: new Date().toISOString(),
    finishedAt:
      ['running', 'queued', 'pausing', 'paused'].includes(response.status) ? undefined : new Date().toISOString(),
    skipped: response.skipped,
  };
}

function formatPlatforms(plan: LatestDaySyncPlan | null): string {
  return plan?.platforms.join(' + ') || 'web + app';
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

const SyncControlBar = ({ onSyncSettled }: { onSyncSettled?: () => void }) => {
  const { trackSync } = useOutletContext<{ trackSync: (job: SyncRunStatus) => void }>();
  const { user, loading: accessLoading } = usePollocloudUser();
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<SyncRunStatus | null>(null);
  const [plan, setPlan] = useState<LatestDaySyncPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshPlan = useCallback(async () => {
    setPlanLoading(true);
    try {
      const nextPlan = await getLatestDaySyncPlan();
      setPlan(nextPlan);
      setErrorMsg('');
    } catch (error) {
      setPlan(null);
      setErrorMsg(error instanceof Error ? error.message : '同步计划检查失败');
    } finally {
      setPlanLoading(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => {
      getLatestSyncRun()
        .then((latest: SyncRunStatus | null) => {
          if (latest) { setStatus(latest); trackSync(latest); }
          if (latest && !['running', 'queued', 'pausing'].includes(latest.status)) {
            stopPolling();
            setSyncing(false);
            void refreshPlan();
            onSyncSettled?.();
          }
        })
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
  }, [onSyncSettled, refreshPlan, stopPolling, trackSync]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getLatestSyncRun(), getLatestDaySyncPlan()])
      .then(([latestResult, planResult]) => {
        if (cancelled) return;
        if (latestResult.status === 'fulfilled' && latestResult.value) {
          setStatus(latestResult.value);
          trackSync(latestResult.value);
          if (['running', 'queued', 'pausing'].includes(latestResult.value.status)) {
            setSyncing(true);
            startPolling();
          }
        }
        if (planResult.status === 'fulfilled') {
          setPlan(planResult.value);
        } else {
          setErrorMsg(
            planResult.reason instanceof Error
              ? planResult.reason.message
              : '同步计划检查失败',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPlanLoading(false);
      });
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [startPolling, stopPolling, trackSync]);

  const handleSync = useCallback(async () => {
    if (syncing || !plan?.canSync || accessLoading) return;
    if (!canManagePollocloudApp(user)) return;
    setSyncing(true);
    setErrorMsg('');
    setStatus(null);
    let startedAsync = false;
    try {
      const response = await createSyncRun({
        mode: 'latest_day',
        platforms: plan.platforms,
      });
      if (['running', 'queued', 'pausing'].includes(response.status)) {
        startedAsync = true;
        const latest = await getLatestSyncRun().catch(() => null);
        const started = latest?.runId === response.runId ? latest : statusFromResponse(response);
        setStatus(started);
        trackSync(started);
        startPolling();
        toast.info('同步任务已启动');
        return;
      }
      stopPolling();
      const latest = await getLatestSyncRun().catch(() => null);
      const finalStatus: SyncRunStatus =
        latest && latest.runId === response.runId
          ? latest
          : statusFromResponse(response);
      setStatus(finalStatus);
      trackSync(finalStatus);
      await refreshPlan();
      if (response.skipped) {
        toast.info(response.skipReason ?? '最新日期已入库，已跳过拉取');
      } else if (response.status === 'success') {
        toast.success(`同步完成 · 共处理 ${response.rowsSynced} 行`);
      } else {
        setErrorMsg(response.errorMessage ?? '同步失败，请稍后重试');
        toast.error('同步失败');
      }
    } catch (error) {
      stopPolling();
      const message = getErrorMessage(error);
      setErrorMsg(message);
      toast.error(`同步请求失败: ${message}`);
    } finally {
      if (!startedAsync) {
        setSyncing(false);
        onSyncSettled?.();
      }
    }
  }, [
    user,
    accessLoading,
    onSyncSettled,
    plan,
    refreshPlan,
    startPolling,
    stopPolling,
    syncing,
    trackSync,
  ]);

  const running =
    syncing || ['queued', 'running', 'pausing', 'paused'].includes(status?.status ?? '') || Boolean(plan?.running);
  const isAdmin = canManagePollocloudApp(user);
  const canSync = isAdmin && Boolean(plan?.canSync) && !running && !planLoading;
  const planStatusLabel = planLoading
    ? '检查中'
    : plan?.alreadySynced
      ? '最新日期已入库'
      : plan
        ? `待补 ${plan.missingItems.length} 项`
        : '检查失败';

  return (
    <section data-ai-section-type="card-stat" className={SYNC_SURFACE_CLASS}>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">同步模式</span>
          <div className="flex h-8 min-w-[164px] items-center gap-2 rounded-full border border-gray-200 bg-white px-3 text-sm text-foreground">
            <ShieldCheck className="size-3.5 text-primary" />
            最新可用日期
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">同步区间</span>
          <div className="flex h-8 min-w-[214px] items-center rounded-full border border-gray-200 bg-white px-3 font-mono text-sm text-muted-foreground">
            {plan ? `${plan.startDate} ~ ${plan.endDate}` : '-'}
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">入库预检</span>
          <div className="flex h-8 items-center gap-2 text-sm text-foreground">
            <Badge variant="outline" className="rounded-full bg-gray-50">
              {planStatusLabel}
            </Badge>
            <Badge
              variant="outline"
              className="rounded-full bg-gray-50 text-muted-foreground"
            >
              {accessLoading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : isAdmin ? (
                <ShieldCheck className="size-3 text-primary" />
              ) : (
                <LockKeyhole className="size-3" />
              )}
              {accessLoading ? '检查权限' : isAdmin ? '管理员' : '只读'}
            </Badge>
            <span className="font-mono text-muted-foreground">
              {formatPlatforms(plan)}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className={`${SYNC_PILL_CLASS} h-8 px-4`}
          disabled={running || planLoading}
          onClick={() => {
            void refreshPlan();
          }}
        >
          <RefreshCw
            className={`size-3.5 ${planLoading ? 'animate-spin' : ''}`}
          />
          检查
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              data-ai-section-type="button"
              size="sm"
              className="h-8 rounded-full px-4 focus-visible:ring-2 focus-visible:ring-blue-600"
              disabled={!canSync}
              title={isAdmin ? undefined : '仅管理员可以同步数据'}
            >
              {running || accessLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : !isAdmin ? (
                <LockKeyhole className="size-3.5" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {running
                ? '同步中'
                : accessLoading
                  ? '检查权限'
                  : isAdmin
                    ? '同步最新日期'
                    : '仅管理员可同步'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认拉取最新数据</AlertDialogTitle>
              <AlertDialogDescription>
                系统会先完成全部 MaxCompute 查询并暂存结果；确认全部成功后，
                再统一替换 Base 中对应日期的数据。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-3 rounded-2xl bg-gray-50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">数据库已有数据至</span>
                <span className="font-mono text-foreground">
                  {plan?.latestStoredDate ?? '暂无已入库日期'}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">本次拉取日期</span>
                <span className="font-mono text-foreground">
                  {plan ? `${plan.startDate} ~ ${plan.endDate}` : '-'}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">同步端口</span>
                <span className="font-mono text-foreground">
                  {formatPlatforms(plan)}
                </span>
              </div>
              <div>
                <div className="text-muted-foreground">本次待更新</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {plan?.missingItems.slice(0, 8).map((item) => (
                    <Badge
                      key={`${item.platform}-${item.sheet}`}
                      variant="outline"
                      className="rounded-full bg-white"
                    >
                      {item.platform} · {SHEET_LABELS[item.sheet]}
                    </Badge>
                  ))}
                  {plan && plan.missingItems.length > 8 ? (
                    <Badge variant="outline" className="rounded-full bg-white">
                      +{plan.missingItems.length - 8}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                disabled={!canSync}
                onClick={() => {
                  void handleSync();
                }}
              >
                确认同步
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {errorMsg && <p className="mt-3 text-xs text-destructive" role="alert">{errorMsg}</p>}
    </section>
  );
};

export default SyncControlBar;
