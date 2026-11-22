import { ArrowDownToLine } from 'lucide-react';
import type { ChainComparison } from '@shared/chain-comparison';
import { metricValue, metricChange, signedMoney, share } from '@shared/format';
import { Modal, DataTable, PeriodHeading } from '@/components/system';

export function ChainDetails({
  data,
  open,
  onOpenChange,
  onExport,
}: {
  data: ChainComparison;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: () => void;
}) {
  const rows = [
    ...data.factors.map((item) => ({ ...item, id: item.key, residual: false })),
    ...(data.residual
      ? [{ ...data.residual, id: 'residual', label: '未归因差额', unit: 'currency' as const, residual: true }]
      : []),
  ];
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="收入变化明细" width={960}>
      <div className="chain-detail-toolbar">
        <button type="button" className="v62-button" onClick={onExport} disabled={!rows.length}>
          <ArrowDownToLine size={16} />
          导出明细
        </button>
      </div>
      <div className="chain-detail-table">
        <DataTable
          rows={rows}
          columns={[
            { key: 'label', header: '过程指标', minWidth: 144, render: (row) => row.label },
            {
              key: 'baseline',
              header: <PeriodHeading label="基准期" dates={data.dates.baseline} mode={data.comparison.mode} />,
              numeric: true,
              minWidth: 100,
              render: (row) => metricValue(row.baseline, row.unit),
            },
            {
              key: 'current',
              header: <PeriodHeading label="分析期" dates={data.dates.analysis} mode={data.comparison.mode} />,
              numeric: true,
              minWidth: 100,
              render: (row) => metricValue(row.current, row.unit),
            },
            {
              key: 'change',
              header: '变化',
              numeric: true,
              minWidth: 100,
              render: (row) => (row.residual ? '—' : metricChange(row.baseline, row.current, row.unit)),
            },
            {
              key: 'effect',
              header: 'GMV 贡献',
              numeric: true,
              minWidth: 100,
              render: (row) => signedMoney(row.effect),
            },
            {
              key: 'share',
              header: '贡献度',
              numeric: true,
              minWidth: 100,
              render: (row) => share(row.contribution),
            },
          ]}
        />
      </div>
    </Modal>
  );
}
