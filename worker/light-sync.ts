import type { SyncRunStatus } from '../shared/api.interface';

export const LIGHT_SYNC_DATASETS = ['renewal', 'ads', 'creation_chain'] as const;
export function isLightSyncGroup(job: Pick<SyncRunStatus, 'datasets' | 'startDate' | 'endDate'>) {
  return job.startDate === job.endDate && (job.datasets?.length ?? 0) > 1
    && job.datasets!.every(dataset => (LIGHT_SYNC_DATASETS as readonly string[]).includes(dataset));
}

/** Independent datasets share one task; renewal scopes remain sequential.
 * Each committed step is checkpointed. Failure never cancels sibling sources.
 */
export async function runLightSyncGroup(job: SyncRunStatus, execute: (key: string) => Promise<number>, save: () => Promise<void>) {
  let checkpoint = Promise.resolve();
  const persist = () => checkpoint = checkpoint.then(save);
  const units = LIGHT_SYNC_DATASETS.map(dataset => (job.steps ?? []).filter(step => step.key.endsWith(`-${dataset}`)));
  await Promise.all(units.map(async steps => {
    for (const step of steps) {
      if (step.status === 'success' || step.status === 'failed') continue;
      if (job.status === 'paused') break;
      step.status = 'running';
      step.detail = `${job.startDate} · 正在查询业务数据库`;
      await persist();
      if (job.status === 'paused') { step.status = 'waiting'; break; }
      try {
        const rows = await execute(step.key);
        job.rowsSynced += rows;
        step.status = 'success';
        step.detail = `已写入 ${rows.toLocaleString('en-US')} 条聚合记录`;
      } catch (error) {
        step.status = 'failed';
        step.detail = error instanceof Error ? error.message : String(error);
      }
      await persist();
    }
  }));
  const finish = job.steps?.find(step => step.key === 'finish');
  const failed = job.steps?.filter(step => step.status === 'failed') ?? [];
  if (job.status === 'paused') { await persist(); return; }
  if (failed.length) {
    job.status = 'failed';
    job.errorMessage = failed.map(step => `${step.label}：${step.detail}`).join('；');
    if (finish) { finish.status = 'failed'; finish.detail = '部分更新失败，成功数据已保留；重试仅处理失败项'; }
  } else {
    job.status = 'success';
    job.errorMessage = undefined;
    if (finish) { finish.status = 'success'; finish.detail = '所选轻量数据集已更新'; }
  }
  job.finishedAt = new Date().toISOString();
  await persist();
}
