import { type ChainComparison, type ChainFactor, contributionScales, residualWarning } from '@shared/chain-comparison';
import { metricValue, metricChange, signedMoney } from '@shared/format';
import { DataTable, DivergingBar, InfoTip, PanelHeader, PeriodHeading } from '@/components/system';
import { Table2 } from 'lucide-react';

type Props = {
  data: ChainComparison;
  factor?: ChainFactor;
  onChoose: (key: string) => void;
  onExport: () => void;
};
export default function LmdiTable({ data, factor, onChoose, onExport }: Props) {
  const { mode, chainType } = data.comparison;
  const scales = contributionScales(data, factor?.key || '');
  const roots = [
    {
      id: 'total',
      kind: 'total' as const,
      label:
        data.comparison.lifecycle || data.comparison.planTier
          ? '所选人群 GMV'
          : chainType === 'active'
            ? '主动付费 GMV'
            : '自动续订 GMV',
      unit: 'currency' as const,
      baseline: data.total!.baseline,
      current: data.total!.current,
      effect: data.total!.delta,
      contribution: data.total!.delta === 0 ? null : 1,
    },
    ...data.factors.map((f) => ({ ...f, id: f.key, kind: 'row' as const })),
    ...(data.residual
      ? [
          {
            id: 'residual',
            kind: 'residual' as const,
            label: '未归因差额',
            unit: 'currency' as const,
            ...data.residual,
          },
        ]
      : []),
  ];
  const explanation = (
    <>
      主动付费：DAU × 付费墙曝光率 × 付费墙提交率 × 提交支付率 × 客单价。自动续订：到期用户数 × 续订率 ×
      续订客单价。沿用线上加法 LMDI。贡献度 = GMV 贡献 ÷ 当前所选人群的有符号净变化；净变化为零时显示
      —。未归因差额为支付结果 GMV 与链路串联 GMV
      的差额，不分摊给因子。周比较按相同业务日取日均。点击过程指标查看对应趋势。
    </>
  );
  return (
    <section className="chain-lmdi-panel">
      <PanelHeader
        title="收入变化拆解"
        unit={`${mode === 'week' ? '日均' : '单日'} · USD`}
        info={explanation}
        tools={
          <button className="v62-icon-button" aria-label="导出收入变化明细" onClick={onExport}>
            <Table2 size={17} strokeWidth={1.7} />
          </button>
        }
      />
      {residualWarning(data) && (
        <span className="v62-explain-warning">
          因子仅解释部分变化
          <InfoTip>
            未归因贡献绝对值 ≥ {0.5} ×
            因子贡献绝对值之和。该标签衡量变化中的可解释程度；与数据口径页的四周水平占比不同。
          </InfoTip>
        </span>
      )}
      <DataTable
        rows={roots}
        columns={[
          {
            key: 'label',
            minWidth: 136,
            header: '过程指标',
            render: (r) =>
              r.kind === 'row' ? (
                <button
                  className="chain-factor"
                  data-selected={r.id === factor?.key}
                  aria-pressed={r.id === factor?.key}
                  onClick={() => onChoose(r.id)}
                >
                  {r.label}
                </button>
              ) : (
                <span>
                  {r.label}
                  {r.kind === 'residual' && (
                    <InfoTip>支付结果 GMV − 链路串联 GMV；未归因贡献与因子贡献之和等于支付结果 GMV 净变化。</InfoTip>
                  )}
                </span>
              ),
          },
          {
            key: 'baseline',
            header: <PeriodHeading label="基准期" dates={data.dates.baseline} mode={mode} />,
            numeric: true,
            minWidth: 80,
            render: (r) => metricValue(r.baseline, r.unit),
          },
          {
            key: 'current',
            header: <PeriodHeading label="分析期" dates={data.dates.analysis} mode={mode} />,
            numeric: true,
            minWidth: 80,
            render: (r) => metricValue(r.current, r.unit),
          },
          {
            key: 'change',
            header: '变化',
            numeric: true,
            minWidth: 80,
            render: (r) => (r.kind === 'residual' ? '—' : metricChange(r.baseline, r.current, r.unit)),
          },
          {
            key: 'effect',
            header: 'GMV 贡献',
            numeric: true,
            minWidth: 80,
            render: (r) => (
              <span
                data-effect={
                  r.kind === 'residual'
                    ? 'residual'
                    : r.effect == null
                      ? 'neutral'
                      : r.effect < 0
                        ? 'negative'
                        : 'positive'
                }
              >
                {signedMoney(r.effect)}
              </span>
            ),
          },
          {
            key: 'share',
            header: '贡献度',
            numeric: true,
            minWidth: 140,
            render: (r) =>
              r.kind === 'total' ? (
                <span className="v62-total-share">{data.total!.delta === 0 ? '—' : '100%'}</span>
              ) : (
                <DivergingBar
                  effect={r.effect}
                  value={r.contribution}
                  scaleMax={scales.root}
                  variant={r.kind === 'residual' ? 'residual' : 'root'}
                />
              ),
          },
        ]}
      />
    </section>
  );
}
