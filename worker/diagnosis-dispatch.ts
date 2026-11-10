import type { Env } from './index';

export const DIAGNOSIS_SETTLE_MS = 5 * 60 * 1000;
const LEASE_MS = 15 * 60 * 1000;

export async function deferDiagnoses(env: Env, delay = DIAGNOSIS_SETTLE_MS) {
  await env.DB!.prepare('UPDATE diagnosis_dispatch SET not_before=MAX(not_before,?) WHERE id=1')
    .bind(Date.now() + delay).run();
}
export async function diagnosesSettling(env: Env) {
  const row = await env.DB!.prepare('SELECT not_before FROM diagnosis_dispatch WHERE id=1').first<{ not_before: number }>();
  return Boolean(row && row.not_before > Date.now());
}

/** Atomic, shared model lane. Weekly work yields to pending anomaly work. */
export async function claimDiagnosisExecution(env: Env, priority: 'anomaly' | 'weekly') {
  const token = crypto.randomUUID(), clock = Date.now();
  const weeklyGuard = priority === 'weekly' ? `AND NOT EXISTS(SELECT 1 FROM daily_diagnosis_monitor WHERE revision<>checked_revision)
    AND NOT EXISTS(SELECT 1 FROM daily_diagnosis_jobs WHERE status IN ('queued','running'))` : '';
  const row = await env.DB!.prepare(`UPDATE diagnosis_dispatch SET lease_id=?,lease_until=? WHERE id=1 AND lease_until<? AND not_before<=? ${weeklyGuard} RETURNING lease_id`)
    .bind(token, clock + LEASE_MS, clock, clock).first();
  return row ? token : null;
}
export async function renewDiagnosisExecution(env: Env, token: string) {
  await env.DB!.prepare('UPDATE diagnosis_dispatch SET lease_until=? WHERE id=1 AND lease_id=?').bind(Date.now() + LEASE_MS, token).run();
}
export async function releaseDiagnosisExecution(env: Env, token: string) {
  await env.DB!.prepare('UPDATE diagnosis_dispatch SET lease_id=NULL,lease_until=0 WHERE id=1 AND lease_id=?').bind(token).run();
}
