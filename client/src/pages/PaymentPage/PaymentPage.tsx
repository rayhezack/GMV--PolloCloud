import { PageHeader, PanelState } from '@/components/system';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PaymentAnalysis from '@/components/dashboard/PaymentAnalysis';
import ComparisonPicker from '@/components/v62/ComparisonPicker';
import PlatformSelect from '@/components/v62/PlatformSelect';
import { WorkbenchIcon } from '@/components/icons/WorkbenchIcon';
import { useDataCoverage } from '@/components/system/useDataCoverage';
import { getBusinessWeekStart } from '@shared/business-week';
import { shiftDay } from '@/components/v62/trend-data';
export default function PaymentPage() {
  const [params, setParams] = useSearchParams(),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(false);
  const platform = params.get('platform') === 'app' ? 'app' : params.get('platform') === 'web' ? 'web' : 'all';
  const deviceType =
    platform === 'app' && ['ios', 'android'].includes(params.get('deviceType') || '')
      ? (params.get('deviceType') as 'ios' | 'android')
      : undefined;
  const {
    coverage,
    loading: coverageLoading,
    error: coverageError,
  } = useDataCoverage('pay_type', platform, deviceType, refresh);
  const latest = coverage?.endDate || '';
  const valid = (date: string | null) => date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
  const analysis = valid(params.get('analysisWeek'))
    ? getBusinessWeekStart(params.get('analysisWeek')!)
    : latest
      ? getBusinessWeekStart(latest)
      : '';
  const baseline = getBusinessWeekStart(
    valid(params.get('baselineWeek')) ? params.get('baselineWeek')! : analysis ? shiftDay(analysis, -7) : '2026-01-01',
  );
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
            {latest && (
              <ComparisonPicker
                baseline={baseline}
                analysis={analysis}
                maxDate={latest || analysis}
                mode="week"
                onChange={(value) => update({ analysisWeek: value.analysis, baselineWeek: value.baseline })}
              />
            )}
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
      {coverageError ? (
        <PanelState state="error" reason={coverageError} onRetry={() => setRefresh((v) => v + 1)} />
      ) : coverageLoading ? (
        <PanelState state="loading" />
      ) : !latest ? (
        <PanelState state="empty" reason="暂无付费数据" />
      ) : (
        <PaymentAnalysis
          platform={platform}
          deviceType={deviceType}
          baselinePeriod={baseline}
          analysisPeriod={analysis}
          refreshToken={refresh}
          onLoadingChange={setLoading}
        />
      )}
    </div>
  );
}
