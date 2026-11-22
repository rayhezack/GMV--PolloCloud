/** Reopen the existing task monitor, including a previously dismissed run. */
export function openBackgroundTask(runId: string) {
  window.dispatchEvent(new CustomEvent('pollo-open-background-task', { detail: runId }));
}
