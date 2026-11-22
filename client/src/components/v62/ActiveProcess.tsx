import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  DashboardGmvAnomalyResponse,
  DashboardPlatform,
  GmvAnomalyMetric,
  OverviewTrendPoint,
} from '@shared/api.interface';
import { getChainComparison, type ChainComparison } from '@/api/chain-comparison';
import { getDashboardOverview } from '@/api/dashboard';
import { MonthlyIncomeChart } from '@/components/monthly-income-chart';
import { chainContextHref, paymentContextHref } from '@/components/dashboard/navigation';
import { chainChanges, paymentChanges } from '@shared/home-attribution';
import { shortDay } from '@shared/format';
import { shiftDay } from './trend-data';
import { Segment } from './primitives';
import { InfoTip, PanelState } from '../system';

export default function ActiveProcess({
  alerts,
  available,
  loading,
  date,
  platform,
  deviceType,
  metric,
  refreshToken,
  currentPoint,
  baselinePoint,
}: {
  alerts: DashboardGmvAnomalyResponse['alerts'];
  available: boolean;
  loading: boolean;
  date: string;
  platform: DashboardPlatform;
  deviceType?: 'ios' | 'android';
  metric: GmvAnomalyMetric;
  refreshToken: number;
  currentPoint?: OverviewTrendPoint;
  baselinePoint?: OverviewTrendPoint;
}) {
  const [mode, setMode] = useState<'payment' | 'chain'>('payment');
  const [retry, setRetry] = useState(0),
    [pairPending, setPairPending] = useState(false),
    [pairFailed, setPairFailed] = useState(false);
  const [loadedKey, setLoadedKey] = useState(''),
    [pairKey, setPairKey] = useState('');
  const [comparison, setComparison] = useState<ChainComparison | null>(null),
    [pending, setPending] = useState(false),
    [failed, setFailed] = useState(false);
  const [pair, setPair] = useState<[OverviewTrendPoint, OverviewTrendPoint] | null>(null);
  const alert =
    alerts.find((a) => a.metric === metric && a.window === 'week') ??
    alerts.find((a) => a.metric === metric) ??
    alerts[0];
  const baseline = alert?.baselinePeriod ?? shiftDay(date, -7),
    scope = alert?.platform ?? platform;
  const contextMetric = alert?.metric ?? metric,
    chainType = contextMetric === 'renewalGmv' ? 'renewal' : 'active';
  const differentScope = scope !== platform || baseline !== shiftDay(date, -7);
  const contextKey = `${deviceType || 'app'}:${scope}:${date}:${baseline}:${chainType}:${refreshToken}:${retry}`;
  useEffect(() => {
    if (!differentScope) {
      setPair(null);
      setPairPending(false);
      setPairFailed(false);
      return;
    }
    let live = true;
    setPair(null);
    setPairPending(true);
    setPairFailed(false);
    void getDashboardOverview({
      view: 'cards',
      platform: scope,
      deviceType: scope === platform ? deviceType : undefined,
      granularity: 'day',
      startDate: baseline < date ? baseline : date,
      endDate: date,
      cacheBust: refreshToken,
    })
      .then((data) => {
        const rows = data.payTypeTrend ?? data.trend,
          a = rows.find((r) => r.period === date),
          b = rows.find((r) => r.period === baseline);
        if (live) {
          setPairKey(contextKey);
          if (a && b) setPair([a, b]);
        }
      })
      .catch(() => {
        if (live) setPairFailed(true);
      })
      .finally(() => {
        if (live) setPairPending(false);
      });
    return () => {
      live = false;
    };
  }, [differentScope, contextKey]);
  const current = differentScope ? (pairKey === contextKey ? pair?.[0] : undefined) : currentPoint,
    previous = differentScope ? (pairKey === contextKey ? pair?.[1] : undefined) : baselinePoint;
  useEffect(() => {
    let live = true;
    setComparison(null);
    setFailed(false);
    setPending(true);
    void getChainComparison({
      platform: scope,
      deviceType: scope === platform ? deviceType : undefined,
      mode: 'day',
      analysis: date,
      baseline,
      chainType,
      revision: refreshToken,
    })
      .then((v) => {
        if (live) {
          setComparison(v);
          setLoadedKey(contextKey);
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      })
      .finally(() => {
        if (live) setPending(false);
      });
    return () => {
      live = false;
    };
  }, [contextKey]);
  const payments = paymentChanges(current, previous, contextMetric);
  const extras =
    contextMetric === 'totalGmv' && current && previous
      ? {
          renewal: current.renewalGmv - previous.renewalGmv,
          other:
            current.totalGmv -
            current.activeGmv -
            current.renewalGmv -
            (previous.totalGmv - previous.activeGmv - previous.renewalGmv),
        }
      : undefined;
  const sources =
    mode === 'payment' ? payments : comparison && loadedKey === contextKey ? chainChanges(comparison, extras) : null;
  const total =
    mode === 'payment'
      ? current && previous
        ? current[contextMetric] - previous[contextMetric]
        : null
      : loadedKey === contextKey && comparison?.ready && comparison.total
        ? comparison.total.delta + (extras?.renewal ?? 0) + (extras?.other ?? 0)
        : null;
  const chainHref = chainContextHref({
    platform: scope,
    analysisDate: date,
    baselineDate: baseline,
    chainType,
    deviceType,
  });
  return (
    <div className="home-attribution">
      <div className="home-source-header">
        <Segment<'payment' | 'chain'>
          label="变化来源"
          value={mode}
          onChange={setMode}
          items={[
            { value: 'payment', label: '付费类型' },
            { value: 'chain', label: '支付链路' },
          ]}
        />
        <InfoTip>
          金额为相应窗口的绝对 GMV 变化。支付链路使用线上 LMDI；未归因差额单列。弧长与贡献度均以净变化为基准，超过 100%
          时弧线封顶；正负方向由金额与颜色表达。净变化为零时不计算占比。不表示因果。大盘模式额外列出续订与其他收入，主动链路只分解主动付费。
        </InfoTip>
      </div>
      <div className="home-source-context">
        {scope === 'all' ? '全端' : scope === 'web' ? 'Web' : 'App'} ·{' '}
        {{ totalGmv: '大盘 GMV', activeGmv: '主动付费', renewalGmv: '自动续订' }[contextMetric]}
        <span>
          {shortDay(date)} / {shortDay(baseline)}
        </span>
      </div>
      {loading ||
      (mode === 'chain' && (pending || (loadedKey !== contextKey && !failed))) ||
      (mode === 'payment' && pairPending) ? (
        <PanelState state="loading" />
      ) : !sources || total == null || !sources.length ? (
        <PanelState
          state={(mode === 'chain' ? failed : pairFailed) ? 'error' : 'empty'}
          onRetry={() => setRetry((v) => v + 1)}
          reason={
            (mode === 'chain' ? failed : pairFailed)
              ? '变化来源读取失败，请重试'
              : mode === 'chain'
                ? comparison?.reason || '链路快照未覆盖该日期'
                : '付费类型快照未覆盖该日期'
          }
        />
      ) : (
        <MonthlyIncomeChart
          key={`${mode}:${date}:${scope}:${baseline}`}
          className="home-income-chart"
          title="变化来源"
          sourcesTitle="GMV 贡献"
          sourcesDescription=""
          summaryLabel="GMV 净变化"
          initialVisibleSources={3}
          sources={sources}
          value={total}
          netDelta={total}
          target={Math.abs(total)}
          targetLabel="净变化贡献度"
        />
      )}
      {!loading && !available && <span className="sys-meta">监测状态暂不可用</span>}
      <div className="home-source-links">
        <Link className={alert ? 'home-primary-link' : ''} to={chainHref}>
          {alert ? '在支付链路查看' : '支付链路'} ↗
        </Link>
        <Link to={paymentContextHref({ platform: scope, date, deviceType })}>付费类型 ↗</Link>
      </div>
    </div>
  );
}
