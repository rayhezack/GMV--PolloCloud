import { PageHeader } from '@/components/system';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PaymentAnalysis from '@/components/dashboard/PaymentAnalysis';
import ComparisonPicker from '@/components/v62/ComparisonPicker';
import PlatformSelect from '@/components/v62/PlatformSelect';
import { WorkbenchIcon } from '@/components/icons/WorkbenchIcon';
import { getLatestSyncRun } from '@/api/sync';
import { getBusinessWeekStart } from '@shared/business-week';
import { shiftDay } from '@/components/v62/trend-data';
import { LOCAL_DATA_WINDOW } from '@/lib/local-data-window';
import { STATIC_DEMO_MODE } from '@/lib/demo-data';
export default function PaymentPage() {
  const [params, setParams] = useSearchParams(),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(false);
  const [latest, setLatest] = useState(STATIC_DEMO_MODE ? '2026-10-09' : LOCAL_DATA_WINDOW?.endDate || '');
  useEffect(() => {
    if (latest) return;
    let live = true;
    void getLatestSyncRun()
      .then((run) => {
        if (live && run?.status === 'success') setLatest(run.endDate);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [latest]);
  const valid = (date: string | null) => date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
  const analysis = getBusinessWeekStart(
    valid(params.get('analysisWeek')) ? params.get('analysisWeek')! : latest || '2026-10-03',
  );
  const baseline = getBusinessWeekStart(
    valid(params.get('baselineWeek')) ? params.get('baselineWeek')! : shiftDay(analysis, -7),
  );
  const platform = params.get('platform') === 'app' ? 'app' : params.get('platform') === 'web' ? 'web' : 'all';
  const deviceType = platform === 'app' && ['ios', 'android'].includes(params.get('deviceType') || '') ? params.get('deviceType') as 'ios' | 'android' : undefined;
  const update = (values: Record<string, string>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        Object.entries(values).forEach(([key, value]) => next.set(key, value));
        return next;
      },
      { replace: true },
    );
  return (
    <div className="v62-page v62-sheet-page v62-payment-page">
      <PageHeader
        title="付费类型"
        tools={
          <>
            <ComparisonPicker
              baseline={baseline}
              analysis={analysis}
              maxDate={latest || analysis}
              mode="week"
              onChange={(value) => update({ analysisWeek: value.analysis, baselineWeek: value.baseline })}
            />
            <PlatformSelect value={platform} onChange={(value) => update({ platform: value })} />
            <button
              className="v62-icon-button"
              aria-label="刷新付费类型"
              disabled={loading}
              onClick={() => setRefresh((value) => value + 1)}
            >
              刷新
            </button>
            <Link className="v62-button" to="/report">
              <WorkbenchIcon name="文件夹" />
              诊断报告
            </Link>
          </>
        }
      />
      <PaymentAnalysis
        platform={platform}
        deviceType={deviceType}
        baselinePeriod={baseline}
        analysisPeriod={analysis}
        refreshToken={refresh}
        onLoadingChange={setLoading}
      />
    </div>
  );
}
