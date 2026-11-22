import type { Env } from './index';

/** One successful refresh per statistical date per Shanghai day; retry failures hourly. */
export async function claimSourceRefresh(env: Env, source: 'creation' | 'ads', period: string, clock = Date.now()) {
  const day = new Date(clock + 8 * 3600000).toISOString().slice(0, 10);
  const row = await env.DB!.prepare(`INSERT INTO source_refresh_state(source,period,refreshed_day,status,attempted_at)
    VALUES(?,?,?,'running',?) ON CONFLICT(source,period) DO UPDATE SET
    refreshed_day=excluded.refreshed_day,status='running',attempted_at=excluded.attempted_at
    WHERE source_refresh_state.attempted_at<=? AND
      (source_refresh_state.status<>'success' OR source_refresh_state.refreshed_day<>excluded.refreshed_day)
    RETURNING attempted_at`).bind(source, period, day, clock, clock - 3600000).first<{attempted_at:number}>();
  return row?.attempted_at ?? null;
}
export async function finishSourceRefresh(env: Env, source: 'creation' | 'ads', period: string, attempt: number, success: boolean) {
  await env.DB!.prepare('UPDATE source_refresh_state SET status=? WHERE source=? AND period=? AND attempted_at=?')
    .bind(success ? 'success' : 'waiting', source, period, attempt).run();
}
