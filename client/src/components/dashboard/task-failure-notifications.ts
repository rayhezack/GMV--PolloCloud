type FailureStore = Pick<Storage, 'getItem' | 'setItem'>;
type Event = { kind: 'sync' | 'report'; status: string; errorMessage?: string; startedAt: string; updatedAt: string; recoveryScopes?: string[] };
const KEY = 'pollo-task-failure-episodes';
let memory: Record<string, { kind: string; scopes: Record<string, number> }> = {};

/** A failure episode spans retries/runs until a later successful completion. */
export function claimFailureNotification(event: Event, storage: FailureStore): boolean {
  let episodes = memory;
  try { episodes = JSON.parse(storage.getItem(KEY) || '{}'); } catch { /* memory still deduplicates when storage is unavailable */ }
  if (!episodes || typeof episodes !== 'object' || Array.isArray(episodes)) episodes = {};
  const at = Date.parse(event.updatedAt || event.startedAt);
  const scopes = event.recoveryScopes?.length ? event.recoveryScopes : [event.kind];
  let notify = false;
  if (event.status === 'success') {
    for (const [key, failure] of Object.entries(episodes)) {
      if (failure.kind !== event.kind) continue;
      for (const scope of scopes) {
        if (at >= failure.scopes?.[scope]) delete failure.scopes[scope];
      }
      if (!Object.keys(failure.scopes ?? {}).length) delete episodes[key];
    }
  } else if (event.status === 'failed') {
    const message = (event.errorMessage || '任务执行失败，请打开任务详情查看').replace(/\s+/g, ' ').trim();
    const key = `${event.kind}:${message}`;
    notify = !episodes[key];
    const failures = episodes[key]?.scopes ?? {};
    for (const scope of scopes) failures[scope] = Math.max(at, failures[scope] ?? 0);
    episodes[key] = { kind: event.kind, scopes: failures };
  }
  memory = episodes;
  try { storage.setItem(KEY, JSON.stringify(episodes)); } catch { /* optional persistence */ }
  return notify;
}
