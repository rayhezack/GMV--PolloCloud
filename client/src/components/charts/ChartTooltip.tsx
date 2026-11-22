import { money, count, rate, signedMoney, changePct, changePp, day } from '../../../../shared/format';
import type { ChartUnit } from './geometry';
import './charts.css';
/** Same rows for Mebius and custom SVG charts; no missing-value imputation. */
export function ChartTooltip({
  date,
  value,
  baseline,
  unit = 'currency',
  partial,
  baselineLabel = '上周同日',
  formatValue,
}: {
  date: string;
  value: number | null;
  baseline: number | null;
  unit?: ChartUnit;
  partial?: string;
  baselineLabel?: string;
  formatValue?: (value: number) => string;
}) {
  const valid = value != null && Number.isFinite(value),
    paired = valid && baseline != null && Number.isFinite(baseline);
  const show = (value: number | null) =>
    value != null && Number.isFinite(value) && formatValue ? formatValue(value) : defaultShow(value);
  const defaultShow = unit === 'currency' ? money : unit === 'rate' ? rate : count;
  const delta = paired ? value! - baseline! : null;
  const showDelta =
    delta == null
      ? '—'
      : unit === 'currency'
        ? signedMoney(delta)
        : unit === 'rate'
          ? changePp(delta)
          : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${count(Math.abs(delta))}`;
  return (
    <div className="chart-tooltip-content">
      <b>{day(date)}</b>
      <span>
        本期<strong>{show(value)}</strong>
      </span>
      <span>
        {baselineLabel}
        <strong>{show(baseline)}</strong>
      </span>
      <span>
        差值
        <strong data-tone={delta == null || delta === 0 ? 'neutral' : delta > 0 ? 'positive' : 'negative'}>
          {showDelta}
        </strong>
      </span>
      <span>
        变化率<strong>{paired && baseline !== 0 ? changePct(delta! / baseline!) : '—'}</strong>
      </span>
      {partial && <small>{partial}</small>}
    </div>
  );
}
