import { useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { Modal, DataTable } from '@/components/system';
import { Segment, exportCsv } from '@/components/v62/primitives';
import { count, money, rate } from '@shared/format';
import type { OverviewTrendPoint } from '@shared/api.interface';
import { homeMetrics, homeValue, type HomeMetric } from './home-data';

export function HomeMetricDetails({
  metric,
  rows,
  orders,
  onClose,
}: {
  metric: HomeMetric | null;
  rows: OverviewTrendPoint[];
  orders: boolean;
  onClose: () => void;
}) {
  const [shape, setShape] = useState<'long' | 'wide'>('long');
  const label = orders
    ? metric === 'totalGmv'
      ? '大盘订单量'
      : '主动付费订单量'
    : homeMetrics.find((item) => item.key === metric)?.label || '';
  const format = metric === 'renewalRate' ? rate : orders ? count : money;
  const values = metric
    ? [...rows]
        .sort((a, b) => b.period.localeCompare(a.period))
        .map((row) => ({ id: row.period, date: row.period, value: homeValue(row, metric, orders) }))
    : [];
  const download = () =>
    exportCsv(
      `Pollo-${label}-${shape}.csv`,
      shape === 'long'
        ? [['日期', label], ...values.map((row) => [row.date, row.value])]
        : [
            ['指标', ...values.map((row) => row.date)],
            [label, ...values.map((row) => row.value)],
          ],
    );
  return (
    <Modal
      open={metric != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`${label}逐日明细`}
    >
      <div className="home-detail-toolbar">
        <Segment
          label="明细表形状"
          value={shape}
          onChange={(value) => setShape(value as 'long' | 'wide')}
          items={[
            { value: 'long', label: '长表' },
            { value: 'wide', label: '宽表' },
          ]}
        />
        <button type="button" className="v62-button" onClick={download} disabled={!values.length}>
          <ArrowDownToLine size={16} />
          导出{shape === 'long' ? '长表' : '宽表'}
        </button>
      </div>
      {shape === 'long' ? (
        <DataTable
          rows={values}
          columns={[
            { key: 'date', header: '日期', render: (row) => row.date },
            { key: 'value', header: label, numeric: true, render: (row) => format(row.value) },
          ]}
        />
      ) : (
        <DataTable
          rows={[{ id: 'metric' }]}
          columns={[
            { key: 'label', header: '指标', minWidth: 130, render: () => label },
            ...values.map((row) => ({
              key: row.date,
              header: row.date,
              minWidth: 120,
              numeric: true,
              render: () => format(row.value),
            })),
          ]}
        />
      )}
    </Modal>
  );
}
