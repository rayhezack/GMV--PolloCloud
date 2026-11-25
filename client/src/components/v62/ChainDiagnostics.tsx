import { useEffect, useState } from 'react';
import { getChainFunnel } from '@/api/dashboard';
import type { ChainFunnelResponse, ChainFunnelMetrics, DashboardPlatform } from '@shared/api.interface';
import { decomposeCount, decomposeRate } from '@/components/dashboard/chain-diagnostics';
import { DataTable, PanelHeader, PanelState, InfoTip, PeriodHeading } from '../system';
import { count, share, money, signedMoney } from '@shared/format';
import { shiftDay } from './trend-data';
import { CountConclusion, RateConclusion } from '@/pages/ChainPage/DiagnosticConclusion';
import { Segment } from './primitives';
import { RateAnalysisDetails } from '@/pages/ChainPage/RateAnalysisDetails';
import { Table2 } from 'lucide-react';

const diagnosticCount = (value: number) =>
  value > 0 && value < 1
    ? value < 0.01
      ? '<0.01'
      : value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : count(value);
export default function ChainDiagnostics({
  factorKey,
  mode = 'week',
  platform,
  deviceType,
  baseline,
  analysis,
  revision,
  lifecycle,
  creationTier,
  countryTier,
}: {
  factorKey: string;
  mode?: 'day' | 'week';
  platform: DashboardPlatform;
  deviceType?: 'ios' | 'android';
  baseline: string;
  analysis: string;
  revision: number;
  lifecycle?: string;
  creationTier?: string;
  countryTier?: string;
}) {
  const [data, setData] = useState<ChainFunnelResponse | null>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const [payDimension, setPayDimension] = useState<'channel' | 'country'>('channel');
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    setError('');
    if (!baseline || !analysis) return;
    void getChainFunnel({
      mode,
      platform,
      deviceType,
      baselinePeriod: baseline,
      analysisPeriod: analysis,
      startDate: baseline,
      endDate: mode === 'day' ? analysis : shiftDay(analysis, 6),
      cacheBust: revision + retry,
      userLifecycle: lifecycle,
      creationTier,
      countryTier,
    })
      .then((value) => {
        if (live) setData(value);
      })
      .catch(() => {
        if (live) setError('下钻诊断暂不可用');
      });
    return () => {
      live = false;
    };
  }, [mode, platform, deviceType, baseline, analysis, revision, retry, lifecycle, creationTier, countryTier]);
  const dimension =
    factorKey === 'subExposeRate' ? 'exposure' : factorKey === 'chainPaySuccessRate' ? payDimension : 'country';
  const submission = factorKey === 'subSubmitRate';
  const paySuccess = factorKey === 'chainPaySuccessRate';
  const aov = factorKey === 'chainArppu';
  const isRate = paySuccess || submission;
  const dimensionLabel = dimension === 'channel' ? '渠道' : '国家层级';
  const metricLabel = submission ? '付费墙提交率' : '提交支付率';
  const title =
    dimension === 'exposure'
      ? '曝光原因'
      : dimension === 'channel'
        ? '支付渠道'
        : submission
          ? '提交转化 · 国家分层'
          : paySuccess
            ? '支付转化 · 国家分层'
            : aov
              ? '客单价 · 国家分层'
              : '国家活跃人数';
  const rows =
    dimension === 'country'
      ? data?.countries || []
      : data?.breakdowns[dimension === 'exposure' ? 'EXPOSE_REASON' : 'SUBMIT_CHANNEL'] || [];
  const atom = (value: ChainFunnelMetrics) =>
    paySuccess
      ? { numerator: value.payUv, denominator: value.submitUv }
      : { numerator: value.submitUv, denominator: value.exposeUv };
  const parent = data?.totals;
  const result = parent
    ? isRate
      ? decomposeRate(
          rows.map((row) => ({
            key: row.key,
            label: row.label,
            baseline: atom(row.baseline),
            current: atom(row.current),
          })),
          { baseline: atom(parent.baseline), current: atom(parent.current) },
          { separateUnresolved: true },
        )
      : decomposeCount(
          rows.map((row) => ({
            key: row.key,
            label: row.label,
            baseline: dimension === 'country' ? row.baseline.activeUv : row.baseline.exposeUv,
            current: dimension === 'country' ? row.current.activeUv : row.current.exposeUv,
          })),
          {
            baseline: dimension === 'country' ? parent.baseline.activeUv : parent.baseline.exposeUv,
            current: dimension === 'country' ? parent.current.activeUv : parent.current.exposeUv,
          },
        )
    : null;
  const exposureName = (key: string) =>
    ({
      insufficient_credits: '积分不足',
      insufficient_permission: '权限不足',
      product_design: '产品设计触发',
      active: '主动打开',
      passive: '被动触发',
      unknown: '未记录',
      __MULTI__: '多种触发（去重）',
    })[key] || key;
  return (
    <section className="v62-diagnostics">
      <PanelHeader
        title={title}
        info={
          submission
            ? '付费墙提交率 = 提交人数 / 曝光人数。按曝光人群的国家分布变化与各国家层级的提交效率拆分，影响单位为百分点。'
            : paySuccess
              ? `提交支付率 = 支付人数 / 提交人数。支付效率指各${dimensionLabel}内的提交支付率；提交结构指各${dimensionLabel}提交人数占全部提交人数的比例。将总体提交支付率变化拆分为支付效率变化与提交结构变化，不可比分组单列未归因影响。`
              : aov
                ? '客单价 = GMV / 支付 UV。各国家客单价变化不直接等于整体收入贡献。'
                : dimension === 'exposure'
                  ? '按触发原因拆分曝光 UV；同期人数变化不代表产品动作的因果效果。'
                  : '按国家层级拆分活跃 UV，变化贡献度以活跃人数净变化为分母。'
        }
        titleTools={
          isRate && (
            <button
              type="button"
              className="v62-button"
              disabled={!result || !result.valid || !('efficiency' in result)}
              onClick={() => setDetailsOpen(true)}
            >
              <Table2 size={16} aria-hidden="true" />
              分析明细
            </button>
          )
        }
        tools={
          paySuccess && (
            <Segment<'channel' | 'country'>
              variant="liquid"
              label="提交支付率下钻维度"
              value={payDimension}
              onChange={setPayDimension}
              items={[
                { value: 'channel', label: '渠道', icon: 'link' },
                { value: 'country', label: '国家', icon: 'workspace' },
              ]}
            />
          )
        }
      />
      {error ? (
        <PanelState state="error" reason={error} onRetry={() => setRetry((n) => n + 1)} />
      ) : !data ? (
        <PanelState state="loading" />
      ) : !data.ready || !result || !rows.length ? (
        <PanelState state="empty" reason="当前维度未被快照覆盖" />
      ) : aov ? (
        <AovDiagnostic rows={rows} />
      ) : isRate && 'efficiency' in result ? (
        <>
          <DataTable
            rows={result.groups.map((r) => ({ ...r, id: r.key }))}
            columns={[
              {
                key: 'label',
                minWidth: 64,
                header: dimensionLabel,
                render: (r) => r.label || '未记录',
              },
              {
                key: 'baseline',
                minWidth: 150,
                header: <PeriodHeading label="基准期" dates={data.comparisonDates?.baseline} mode={mode} />,
                numeric: true,
                render: (r) => (
                  <span
                    className="chain-channel-atom"
                    title={`${metricLabel}：${diagnosticCount(r.baseline.numerator)} / ${diagnosticCount(r.baseline.denominator)}`}
                  >
                    <b>{r.rate0 == null ? '—' : `${(r.rate0 * 100).toFixed(2)}%`}</b>
                    <small>
                      {submission ? '曝光结构' : '提交结构'} {(r.w0 * 100).toFixed(2)}%
                    </small>
                  </span>
                ),
              },
              {
                key: 'current',
                minWidth: 150,
                header: <PeriodHeading label="分析期" dates={data.comparisonDates?.analysis} mode={mode} />,
                numeric: true,
                render: (r) => (
                  <span
                    className="chain-channel-atom"
                    title={`${metricLabel}：${diagnosticCount(r.current.numerator)} / ${diagnosticCount(r.current.denominator)}`}
                  >
                    <b>{r.rate1 == null ? '—' : `${(r.rate1 * 100).toFixed(2)}%`}</b>
                    <small>
                      {submission ? '曝光结构' : '提交结构'} {(r.w1 * 100).toFixed(2)}%
                    </small>
                  </span>
                ),
              },
              {
                key: 'effects',
                minWidth: 110,
                header: '总体变化贡献 · pp',
                numeric: true,
                render: (r) => (
                  <span className="chain-channel-atom">
                    <span>
                      {submission ? '提交效率' : '支付效率'} {(r.efficiency * 100).toFixed(2)}
                    </span>
                    <span>
                      {submission ? '曝光结构' : '提交结构'} {(r.structure * 100).toFixed(2)}
                    </span>
                    {Math.abs(r.unresolvedEffect) > 1e-10 && (
                      <span>未归因 {(r.unresolvedEffect * 100).toFixed(2)}</span>
                    )}
                  </span>
                ),
              },
            ]}
          />
          <RateConclusion
            result={result}
            metric={submission ? '付费墙提交率' : '提交支付率'}
            dimension={dimensionLabel}
          />
          <RateAnalysisDetails
            open={detailsOpen}
            onOpenChange={setDetailsOpen}
            result={result}
            metric={metricLabel}
            dimension={dimensionLabel}
            dates={data.comparisonDates}
            mode={mode}
          />
        </>
      ) : (
        'groups' in result &&
        'valid' in result && (
          <>
            <DataTable
              rows={rows.map((row) => {
                const before = dimension === 'country' ? row.baseline.activeUv : row.baseline.exposeUv,
                  after = dimension === 'country' ? row.current.activeUv : row.current.exposeUv;
                const total = parent
                  ? dimension === 'country'
                    ? parent.current.activeUv - parent.baseline.activeUv
                    : parent.current.exposeUv - parent.baseline.exposeUv
                  : 0;
                return {
                  id: row.key,
                  label: exposureName(row.label),
                  before,
                  after,
                  delta: after - before,
                  contribution: result.valid && total !== 0 ? (after - before) / total : null,
                };
              }).sort((a, b) => b.before - a.before || a.label.localeCompare(b.label))}
              columns={[
                {
                  key: 'label',
                  minWidth: 72,
                  header: dimension === 'country' ? '国家层级' : '曝光原因',
                  render: (r) => r.label,
                },
                { key: 'before', minWidth: 66, header: '基准 UV', numeric: true, render: (r) => count(r.before) },
                { key: 'after', minWidth: 66, header: '分析 UV', numeric: true, render: (r) => count(r.after) },
                {
                  key: 'delta',
                  minWidth: 72,
                  header: '变化 UV',
                  numeric: true,
                  render: (r) => `${r.delta >= 0 ? '+' : '−'}${count(Math.abs(r.delta))}`,
                },
                {
                  key: 'contribution',
                  minWidth: 88,
                  header: '变化贡献度',
                  numeric: true,
                  render: (r) => share(r.contribution),
                },
              ]}
            />
            <CountConclusion
              result={{ ...result, groups: result.groups.map((row) => ({ ...row, label: exposureName(row.label) })) }}
              label={dimension === 'country' ? '活跃人数' : '曝光人数'}
              dimension={dimension === 'country' ? 'country' : 'exposure'}
            />
          </>
        )
      )}
    </section>
  );
}

function AovDiagnostic({ rows }: { rows: ChainFunnelResponse['countries'] }) {
  const values = rows.map((row) => ({
    id: row.key,
    label: row.label,
    baseline: row.baseline.payUv > 0 ? row.baseline.gmvUsd / row.baseline.payUv : null,
    current: row.current.payUv > 0 ? row.current.gmvUsd / row.current.payUv : null,
    baselineUv: row.baseline.payUv,
    currentUv: row.current.payUv,
  }));
  const changed = values
    .filter((r) => r.baseline != null && r.current != null)
    .sort((a, b) => Math.abs(b.current! - b.baseline!) - Math.abs(a.current! - a.baseline!))[0];
  return (
    <>
      <DataTable
        rows={values}
        columns={[
          { key: 'label', minWidth: 72, header: '国家层级', render: (r) => r.label },
          {
            key: 'baseline',
            minWidth: 84,
            header: '基准客单价',
            numeric: true,
            render: (r) => (r.baseline == null ? '—' : money(r.baseline)),
          },
          {
            key: 'current',
            minWidth: 84,
            header: '分析客单价',
            numeric: true,
            render: (r) => (r.current == null ? '—' : money(r.current)),
          },
          {
            key: 'delta',
            minWidth: 72,
            header: '变化',
            numeric: true,
            render: (r) => (r.current == null || r.baseline == null ? '—' : signedMoney(r.current - r.baseline)),
          },
          {
            key: 'uv',
            minWidth: 84,
            header: '支付 UV',
            numeric: true,
            render: (r) => (
              <span className="chain-channel-atom">
                <span>{count(r.baselineUv)}</span>
                <span>{count(r.currentUv)}</span>
              </span>
            ),
          },
        ]}
      />
      <aside className="chain-reading" aria-label="客单价诊断结论">
        <strong>{changed ? `${changed.label}的客单价变化最明显` : '当前缺少可比的支付人群'}</strong>
        {changed && (
          <p>
            {changed.label}从 {money(changed.baseline!)} 变为 {money(changed.current!)}，同期支付人数从{' '}
            {count(changed.baselineUv)} 变为 {count(changed.currentUv)}
            。国家客单价和人群占比都可能影响整体结果；应结合付费类型及套餐结构核查，当前分层差值不能直接视为整体贡献。
          </p>
        )}
      </aside>
    </>
  );
}
