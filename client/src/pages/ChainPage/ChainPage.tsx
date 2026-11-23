import ChainDiagnostics from '@/components/v62/ChainDiagnostics';
import { PageHeader, PanelState } from '@/components/system';
import LmdiTable from './LmdiTable';
import { ChainDetails } from './ChainDetails';
import { PopulationPicker } from './PopulationPicker';
import './chain.css';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getChainComparison, type ChainComparison } from '@/api/chain-comparison';
import { useDataCoverage } from '@/components/system/useDataCoverage';
import { getBusinessWeekStart } from '@shared/business-week';
import { preferredFactor } from '@shared/chain-comparison';
import { Segment, exportCsv } from '@/components/v62/primitives';
import PlatformSelect from '@/components/v62/PlatformSelect';
import ComparisonPicker from '@/components/v62/ComparisonPicker';
import { FactorTrend } from './FactorTrend';
import { revenueBuckets, shiftDay } from '@/components/v62/trend-data';
import type { OverviewTrendPoint } from '@shared/api.interface';
import { WorkbenchIcon } from '@/components/icons/WorkbenchIcon';

const valid = (value: string | null): value is string =>
  Boolean(
    value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value,
  );
export default function ChainPage() {
  const [params, setParams] = useSearchParams();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const update = (values: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        Object.entries(values).forEach(([key, value]) => (value == null ? next.delete(key) : next.set(key, value)));
        return next;
      },
      { replace: true },
    );
  const mode = params.get('mode') === 'day' ? 'day' : 'week';
  const chainType = params.get('chainType') === 'renewal' ? 'renewal' : 'active';
  const lifecycle = params.get('lifecycle') || undefined;
  const creationTier = lifecycle ? params.get('creationTier') || undefined : undefined;
  const planTier = params.get('planTier') || undefined;
  const platform = params.get('platform') === 'web' ? 'web' : params.get('platform') === 'app' ? 'app' : 'all';
  const deviceType =
    platform === 'app' && ['ios', 'android'].includes(params.get('deviceType') || '')
      ? (params.get('deviceType') as 'ios' | 'android')
      : undefined;
  const [revision, setRevision] = useState(0);
  const {
    coverage,
    loading: coverageLoading,
    error: coverageError,
  } = useDataCoverage(chainType === 'renewal' ? 'renewal' : 'chain', platform, deviceType, revision);
  const latest = coverage?.endDate || '';
  const fallback = latest && (mode === 'week' ? getBusinessWeekStart(latest) : latest);
  const analysisKey = mode === 'day' ? 'analysisDate' : 'analysisWeek',
    baselineKey = mode === 'day' ? 'baselineDate' : 'baselineWeek';
  const analysis = valid(params.get(analysisKey))
    ? mode === 'week'
      ? getBusinessWeekStart(params.get(analysisKey)!)
      : params.get(analysisKey)!
    : fallback;
  const baseline = valid(params.get(baselineKey))
    ? mode === 'week'
      ? getBusinessWeekStart(params.get(baselineKey)!)
      : params.get(baselineKey)!
    : analysis
      ? shiftDay(analysis, -7)
      : '';
  const [data, setData] = useState<ChainComparison | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  useEffect(() => {
    if (!analysis || !baseline) return;
    let live = true;
    setLoading(true);
    setError('');
    setData(null);
    void getChainComparison({
      platform,
      deviceType,
      mode,
      chainType,
      analysis,
      baseline,
      revision,
      lifecycle,
      creationTier,
      planTier,
    })
      .then((result) => {
        if (live) setData(result);
      })
      .catch((cause) => {
        if (live) setError(cause?.message || '链路读取失败');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [platform, deviceType, mode, chainType, analysis, baseline, revision, lifecycle, creationTier, planTier]);
  const factor = data ? preferredFactor(data.factors, params.get('factor')) : undefined;
  const trendEnd = analysis ? (mode === 'week' ? [shiftDay(analysis, 6), latest || analysis].sort()[0] : analysis) : '';
  const trend = useMemo(
    () =>
      factor && data && analysis && baseline && trendEnd
        ? revenueBuckets(
            data.trend.map(
              (row) =>
                ({
                  period: row.date,
                  totalGmv: row.values[factor.key] ?? NaN,
                  activeGmv: 0,
                  renewalGmv: 0,
                }) as OverviewTrendPoint,
            ),
            'totalGmv',
            [shiftDay(analysis, -29), baseline].sort()[0],
            trendEnd,
            granularity,
          )
        : [],
    [data, factor, analysis, baseline, trendEnd, granularity],
  );
  const choose = (key: string) => {
    update({ factor: key });
  };
  const exportRows = () => {
    if (!data) return;
    const scope = lifecycle
      ? (lifecycle === 'NEW' ? '新用户' : lifecycle === 'OLD' ? '老用户' : '注册未记录') +
        (creationTier ? ` / ${creationTier}` : '')
      : planTier || '全部';
    exportCsv(`Pollo-chain-${analysis}.csv`, [
      ['分析对象', '指标', '基准', '分析', 'GMV 贡献', '贡献度'],
      ...data.factors.map((item) => [scope, item.label, item.baseline, item.current, item.effect, item.contribution]),
      ...(data.residual
        ? [
            [
              scope,
              '未归因差额',
              data.residual.baseline,
              data.residual.current,
              data.residual.effect,
              data.residual.contribution,
            ],
          ]
        : []),
    ]);
  };
  return (
    <div
      className="v62-page v62-sheet-page chain-page"
      aria-busy={loading}
      data-dashboard-ready={!coverageLoading && !loading && Boolean(data?.ready) && !error && !coverageError}
    >
      <PageHeader
        title="支付链路"
        tools={
          <>
            <div className="chain-date-tools">
              <Segment
                label="对比方式"
                value={mode}
                onChange={(value) => update({ mode: value, factor: null, selectedDay: null })}
                items={[
                  { value: 'week', label: '业务周对比' },
                  { value: 'day', label: '单日对比' },
                ]}
              />
              {analysis && (
                <ComparisonPicker
                  compactDay
                  ordered
                  baseline={baseline}
                  analysis={analysis}
                  maxDate={latest}
                  mode={mode}
                  onChange={(dates) =>
                    update({ [analysisKey]: dates.analysis, [baselineKey]: dates.baseline, selectedDay: null })
                  }
                />
              )}
            </div>
            <PlatformSelect value={platform} onChange={(value) => update({ platform: value })} />
            <button className="v62-button" aria-label="刷新链路" onClick={() => setRevision((n) => n + 1)}>
              刷新
            </button>
            <Link className="v62-button" to="/report">
              <WorkbenchIcon name="文件夹" />
              诊断报告
            </Link>
          </>
        }
      />
      {coverageLoading || loading ? (
        <PanelState state="loading" />
      ) : error || coverageError ? (
        <PanelState state="error" reason={error || coverageError} onRetry={() => setRevision((n) => n + 1)} />
      ) : !data?.ready ? (
        <>
          <div className="chain-empty-tools">
            <Segment
              label="链路类型"
              value={chainType}
              onChange={(value) => update({ chainType: value, factor: null })}
              items={[
                { value: 'active', label: '主动付费' },
                { value: 'renewal', label: '自动续订' },
              ]}
            />
          </div>
          <PanelState state="empty" reason={data?.reason || '该日链路表或支付结果未被本地快照覆盖'} />
        </>
      ) : (
        <>
          <div className="chain-scope-toolbar">
            <Segment
              label="链路类型"
              value={chainType}
              onChange={(value) =>
                update({ chainType: value, lifecycle: null, creationTier: null, planTier: null, factor: null })
              }
              items={[
                { value: 'active', label: '主动付费' },
                { value: 'renewal', label: '自动续订' },
              ]}
            />
          </div>
          <PopulationPicker
            data={data}
            onSelect={(scope) =>
              update({
                lifecycle: scope.lifecycle || null,
                creationTier: scope.creationTier || null,
                planTier: scope.planTier || null,
                selectedDay: null,
              })
            }
          />
          <div className="chain-workspace">
            <LmdiTable data={data} factor={factor} onChoose={choose} onExport={() => setDetailsOpen(true)} />
            <FactorTrend
              factor={factor}
              chainType={chainType}
              buckets={trend}
              selectedDay={params.get('selectedDay') || analysis}
              onSelect={(date) => update({ selectedDay: date })}
              granularity={granularity}
              onGranularityChange={setGranularity}
            />
            {chainType === 'active' && (
              <ChainDiagnostics
                mode={mode}
                factorKey={factor?.key || 'activeUv'}
                platform={platform}
                deviceType={deviceType}
                baseline={baseline}
                analysis={analysis}
                revision={revision}
                lifecycle={lifecycle}
                creationTier={creationTier}
              />
            )}
          </div>
          <ChainDetails data={data} open={detailsOpen} onOpenChange={setDetailsOpen} onExport={exportRows} />
        </>
      )}
    </div>
  );
}
