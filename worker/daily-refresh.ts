/** A tick continues persisted work; failures are isolated and never auto-retried. */
export class RefreshPausedError extends Error {}
export type RefreshBatch = {
  day: string; tasks: string[]; cursor: number; status: 'running' | 'success' | 'failed'; error?: string;
  completed?: string[]; errors?: Record<string, string>;
};
export async function advanceDailyRefresh(batch: RefreshBatch, execute: (task: string) => Promise<boolean>, save: (batch: RefreshBatch) => Promise<void>, budgetMs = 110000) {
  if (batch.status !== 'running') return batch;
  const deadline = Date.now() + budgetMs;
  batch.completed ??= batch.tasks.slice(0, batch.cursor);
  batch.errors ??= {};
  do {
    const task = batch.tasks[batch.cursor];
    if (!task) break;
    if (batch.completed.includes(task)) { batch.cursor++; continue; }
    let done: boolean;
    try {
      done = await execute(task);
      if (done) { batch.completed.push(task); delete batch.errors[task]; }
    } catch (error) {
      if (error instanceof RefreshPausedError) {
        batch.status = 'failed'; batch.error = error.message; await save(batch); return batch;
      }
      batch.errors[task] = error instanceof Error ? error.message : String(error);
      done = true;
    }
    if (done) batch.cursor++;
    await save(batch);
    if (!done) return batch;
  } while (batch.cursor < batch.tasks.length && Date.now() < deadline);
  if (batch.cursor === batch.tasks.length) {
    batch.status = Object.keys(batch.errors).length ? 'failed' : 'success';
    batch.error = Object.entries(batch.errors).map(([task, message]) => `${task}: ${message}`).join('; ') || undefined;
    await save(batch);
  }
  return batch;
}
