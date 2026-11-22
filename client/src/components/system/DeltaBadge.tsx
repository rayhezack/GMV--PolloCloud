import { changePct, changePp } from '../../../../shared/format';
/** <DeltaBadge value={.199}/>; ratios use unit="pp". */
export function DeltaBadge({ value, unit = 'pct' }: { value: number | null | undefined; unit?: 'pct' | 'pp' }) {
  const tone =
    value == null || !Number.isFinite(value) || value === 0 ? 'neutral' : value > 0 ? 'positive' : 'negative';
  return (
    <span className="sys-delta v62-delta" data-tone={tone}>
      {unit === 'pp' ? changePp(value) : changePct(value)}
    </span>
  );
}
