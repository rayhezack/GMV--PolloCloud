/** A daily start is separate from bounded continuations; a tick never starts a new batch. */
export type RefreshBatch = { day: string; tasks: string[]; cursor: number; status: 'running' | 'success' | 'failed'; error?: string };
export async function advanceDailyRefresh(batch: RefreshBatch, execute: (task: string) => Promise<boolean>, save: (batch: RefreshBatch) => Promise<void>, budgetMs = 110000) {
  if (batch.status !== 'running') return batch;
  const deadline = Date.now() + budgetMs;
  try {
    do {
      const done = await execute(batch.tasks[batch.cursor]);
      if (done) batch.cursor++;
      if (batch.cursor === batch.tasks.length) batch.status = 'success';
      await save(batch);
      if (!done) break;
    } while (batch.status === 'running' && Date.now() < deadline);
  } catch (error) {
    batch.status = 'failed'; batch.error = error instanceof Error ? error.message : String(error);
    await save(batch);
  }
  return batch;
}
