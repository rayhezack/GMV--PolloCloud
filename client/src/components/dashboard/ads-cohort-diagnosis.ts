/** Compare recovery and acquisition cost for the same registration cohort. */
export function diagnoseCohort(input: { period: string; horizon: string; asOf: string; available: boolean; gmvUsd: number; costUsd: number; registerUsers: number }) {
  const { gmvUsd, costUsd, registerUsers } = input;
  const horizon = /^D(\d+)$/.exec(input.horizon);
  const age = (Date.parse(input.asOf) - Date.parse(input.period)) / 86400000;
  const mature = !!horizon && Number.isFinite(age) && age >= Number(horizon[1]);
  const valid = [gmvUsd, costUsd, registerUsers].every(n => Number.isFinite(n) && n >= 0);
  const cac = valid && registerUsers > 0 ? costUsd / registerUsers : null;
  const ltv = valid && mature && input.available && registerUsers > 0 ? gmvUsd / registerUsers : null;
  const status = !mature ? 'immature' : !valid || !input.available ? 'unavailable' : registerUsers === 0 ? 'no-users' : costUsd === 0 ? 'no-cost' : gmvUsd > costUsd ? 'covered' : gmvUsd === costUsd ? 'breakeven' : 'shortfall';
  const comparable = status === 'covered' || status === 'breakeven' || status === 'shortfall';
  return { status, ltv, cac, coverage: comparable ? gmvUsd / costUsd : null, perUserGap: comparable ? (gmvUsd - costUsd) / registerUsers : null, totalGap: comparable ? gmvUsd - costUsd : null };
}
