import { DivergingBar } from '../system/DivergingBar.tsx';
import { signedMoney } from '../../../../shared/format.ts';
import { contributionScales, type ChainComparison } from '../../../../shared/chain-comparison.ts';

export function TotalContribution({ delta }: { delta: number }) {
  return <td data-tone={delta < 0 ? 'negative' : delta > 0 ? 'positive' : undefined}>{signedMoney(delta)}</td>;
}
export function TotalShare() {
  return <td className="v62-total-share">100%</td>;
}
export { ContributionReading };
function ContributionReading({
  value,
  effect,
  max,
  variant = 'root',
}: {
  value: number | null;
  effect: number | null;
  max: number;
  variant?: 'root' | 'child' | 'residual';
}) {
  return <DivergingBar value={value} effect={effect} scaleMax={max} variant={variant} />;
}
export function childScale(data: Pick<ChainComparison, 'factors' | 'groups' | 'residual'>, key: string) {
  return contributionScales(data, key).child;
}
