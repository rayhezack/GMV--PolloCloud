import { ArrowDownToLine } from 'lucide-react';
import { Modal, DataTable, PeriodHeading, InfoTip } from '@/components/system';
import { decomposeRate, netChangeShare } from '@shared/rate-attribution';
import { rate, changePp, share } from '@shared/format';
import { exportCsv } from '@/components/v62/primitives';

export function RateAnalysisDetails({
  open,
  onOpenChange,
  result,
  metric,
  dimension,
  dates,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  result: ReturnType<typeof decomposeRate>;
  metric: string;
  dimension: string;
  dates?: { baseline: string[]; analysis: string[] };
}) {
  const submission = metric === '付费墙提交率';
  const efficiency = submission ? '提交效率' : '支付效率',
    structure = submission ? '曝光结构' : '提交结构';
  const population = submission ? '曝光' : '提交';
  const rows = result.groups.map((r) => ({ ...r, id: r.key }));
  const download = () =>
    exportCsv(`Pollo-${metric}-${dimension}-Shapley.csv`, [
      [
        '指标',
        '维度',
        '分组',
        '基准期日期',
        '分析期日期',
        `基准${metric}`,
        `分析${metric}`,
        `基准${submission ? '提交' : '支付'}人数`,
        `分析${submission ? '提交' : '支付'}人数`,
        `基准${population}人数`,
        `分析${population}人数`,
        `基准${population}占比`,
        `分析${population}占比`,
        `${efficiency}贡献(pp)`,
        `${structure}贡献(pp)`,
        '未归因(pp)',
        '总体变化贡献占比',
      ],
      ...rows.map((r) => [
        metric,
        dimension,
        r.label,
        dates?.baseline.join(' / ') || '',
        dates?.analysis.join(' / ') || '',
        r.rate0,
        r.rate1,
        r.baseline.numerator,
        r.current.numerator,
        r.baseline.denominator,
        r.current.denominator,
        r.w0,
        r.w1,
        r.efficiency * 100,
        r.structure * 100,
        r.unresolvedEffect * 100,
        netChangeShare(r.efficiency + r.structure + r.unresolvedEffect, result.delta || 0),
      ]),
    ]);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`${metric} · ${dimension}分析明细`} width={1160}>
      <div className="chain-detail-toolbar">
        <button className="v62-button" type="button" onClick={download}>
          <ArrowDownToLine size={16} />
          导出明细
        </button>
      </div>
      <div className="rate-analysis-summary">
        {[
          { label: `基准${metric}`, value: rate(result.baselineRate) },
          { label: `分析${metric}`, value: rate(result.currentRate) },
          { label: `${efficiency}贡献`, value: changePp(result.efficiency) },
          { label: `${structure}贡献`, value: changePp(result.structure) },
          { label: '未归因', value: changePp(result.unresolved) },
        ].map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <b>{item.value}</b>
          </div>
        ))}
      </div>
      <div className="rate-analysis-table">
        <DataTable
          rows={rows}
          columns={[
            { key: 'label', header: dimension, minWidth: 86, render: (r) => r.label },
            {
              key: 'rate0',
              header: <PeriodHeading label={`基准期${metric}`} dates={dates?.baseline} />,
              numeric: true,
              minWidth: 112,
              render: (r) => rate(r.rate0),
            },
            {
              key: 'rate1',
              header: <PeriodHeading label={`分析期${metric}`} dates={dates?.analysis} />,
              numeric: true,
              minWidth: 112,
              render: (r) => rate(r.rate1),
            },
            { key: 'w0', header: `基准期${population}占比`, numeric: true, minWidth: 100, render: (r) => rate(r.w0) },
            { key: 'w1', header: `分析期${population}占比`, numeric: true, minWidth: 100, render: (r) => rate(r.w1) },
            {
              key: 'efficiency',
              header: `${efficiency} · pp`,
              numeric: true,
              minWidth: 100,
              render: (r) => changePp(r.efficiency),
            },
            {
              key: 'structure',
              header: `${structure} · pp`,
              numeric: true,
              minWidth: 100,
              render: (r) => changePp(r.structure),
            },
            {
              key: 'unresolved',
              header: '未归因 · pp',
              numeric: true,
              minWidth: 84,
              render: (r) => changePp(r.unresolvedEffect),
            },
            {
              key: 'share',
              header: (
                <>
                  变化贡献度{' '}
                  <InfoTip>
                    Shapley
                    2-factor：效率、结构与未归因之和占整体净变化的比例；负数表示抵消，净变化为零时不计算。新增、退出或不可比分组单列未归因，导出保留源精度。
                  </InfoTip>
                </>
              ),
              numeric: true,
              minWidth: 94,
              render: (r) => share(netChangeShare(r.efficiency + r.structure + r.unresolvedEffect, result.delta || 0)),
            },
          ]}
        />
      </div>
    </Modal>
  );
}
