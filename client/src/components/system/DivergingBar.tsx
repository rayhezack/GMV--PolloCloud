import { share } from '../../../../shared/format.ts';
/** <DivergingBar value={.5968} effect={-2085} scaleMax={1}/> points left despite positive share. */
export function DivergingBar({
  value,
  effect,
  scaleMax,
  variant = 'root',
  label,
}: {
  value: number | null;
  effect: number | null;
  scaleMax: number;
  variant?: 'root' | 'child' | 'residual';
  label?: string;
}) {
  const negative = effect != null && effect < 0;
  const width =
    value == null || !Number.isFinite(value) || scaleMax <= 0 ? 0 : Math.min(1, Math.abs(value) / scaleMax) * 50;
  return (
    <div className="sys-diverging" data-variant={variant}>
      <span className="sys-diverging-track" aria-hidden="true">
        <i
          style={{ width: `${width}%`, left: negative ? undefined : '50%', right: negative ? '50%' : undefined }}
          data-tone={effect == null || effect === 0 ? 'neutral' : negative ? 'negative' : 'positive'}
        />
      </span>
      <b>{label ?? share(value)}</b>
    </div>
  );
}
