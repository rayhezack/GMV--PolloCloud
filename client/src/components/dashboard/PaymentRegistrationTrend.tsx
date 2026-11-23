import type { PaymentMetric } from '@shared/payment-metric';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPaymentRegistrationTrend } from '@/api/dashboard';
import type {
  AppDeviceType,
  DashboardPlatform,
  PaymentAnalysisResponse,
  PaymentRegistrationTrendResponse,
} from '@shared/api.interface';
import type { buildPaymentView } from './payment-analysis.data';
import { registrationLayerTrend, type RegistrationDimension } from './payment-registration';

type Trend = NonNullable<ReturnType<typeof buildPaymentView>>['trend'];
const shift = (date: string, days: number) =>
  new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
export function PaymentRegistrationTrend({
  data,
  payType,
  dimension,
  layer,
  platform,
  deviceType,
  refreshToken,
  renderTrend,
  comparisonDay,
  metric = 'gmv',
}: {
  data: PaymentAnalysisResponse;
  payType: string;
  dimension: RegistrationDimension;
  layer: string;
  platform: DashboardPlatform;
  deviceType?: AppDeviceType;
  refreshToken: number;
  renderTrend: (trend: Trend, summary: Trend) => ReactNode;
  comparisonDay?: string | null;
  metric?: PaymentMetric;
}) {
  const [history, setHistory] = useState<PaymentRegistrationTrendResponse | null>(null),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  const analysis = data.comparison?.analysisPeriod ?? '',
    baseline = data.comparison?.baselinePeriod ?? '';
  const displayEnd =
    data.revenues
      .filter((row) => row.weekStart === analysis)
      .map((row) => row.period)
      .sort()
      .at(-1) ?? shift(analysis, 6);
  const gap = Math.round((Date.parse(analysis) - Date.parse(baseline)) / 86400000);
  useEffect(() => {
    if (!analysis || !Number.isFinite(gap)) return;
    let active = true;
    setHistory(null);
    setError(false);
    const startDate = [shift(displayEnd, -29), shift(displayEnd, -29 - Math.max(7, gap))].sort()[0],
      endDate = [displayEnd, shift(displayEnd, -gap)].sort().at(-1)!;
    void getPaymentRegistrationTrend({
      platform,
      deviceType,
      payType,
      startDate,
      endDate,
      cacheBust: refreshToken || retry || undefined,
    })
      .then((result) => {
        if (active) setHistory(result);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [analysis, displayEnd, gap, payType, platform, deviceType, refreshToken, retry]);
  const trend = useMemo(
    () => (history ? registrationLayerTrend(history, dimension, layer, comparisonDay ? 7 : gap, displayEnd, metric) : null),
    [history, dimension, layer, gap, displayEnd, Boolean(comparisonDay), metric],
  );
  const summary = useMemo(
    () => (trend ?? []).filter((point) => point.date >= analysis && point.date <= shift(analysis, 6)),
    [trend, analysis],
  );
  if (!trend)
    return (
      <div className="payment-history-loading" role="status">
        {error ? (
          <>
            <span>分层趋势读取失败</span>
            <button type="button" onClick={() => setRetry((value) => value + 1)}>
              重新加载
            </button>
          </>
        ) : (
          '正在读取分层趋势…'
        )}
      </div>
    );
  if (!summary.length || !trend.some((point) => point.analysis != null))
    return (
      <p className="payment-registration-note" role="status">
        所选分层缺少可核对的趋势数据，暂不展示。
      </p>
    );
  return <>{renderTrend(trend, summary)}</>;
}
