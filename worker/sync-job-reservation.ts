/** Return only a persisted job, including the winner of a concurrent insert. */
export async function reserveSyncJob<T>(insert: () => Promise<T | null>, active: () => Promise<T | null>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const inserted = await insert();
    if (inserted) return inserted;
    const winner = await active();
    if (winner) return winner;
    // The winning job may have finished between the insert and lookup.
  }
  throw new Error('同步任务创建竞争，请稍后重试');
}
