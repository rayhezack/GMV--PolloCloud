import { useSyncExternalStore } from 'react';
export type Activity = { id: string; title: string; body?: string; href?: string; read?: boolean };
const key = 'pollo-activity-v1';
let items: Activity[] = [];
try {
  items = JSON.parse(localStorage.getItem(key) || '[]');
  if (!Array.isArray(items)) items = [];
  items = [
    ...new Map(
      items
        .filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string')
        .map((item) => {
          const id = item.id.startsWith('anomaly:') ? item.id.split(':').slice(0, 2).join(':') : item.id;
          return [id, { ...item, id }] as const;
        }),
    ).values(),
  ];
} catch {
  /* Storage is optional. */
}
const listeners = new Set<() => void>();
function commit(next: Activity[]) {
  items = next.slice(0, 100);
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* Keep in memory. */
  }
  listeners.forEach((fn) => fn());
}
export function publishActivity(item: Activity) {
  if (items.some((existing) => existing.id === item.id)) return;
  commit([item, ...items]);
}
export function readActivities() {
  commit(items.map((item) => ({ ...item, read: true })));
}
export function activitySnapshot() {
  return items;
}
export function useActivities() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => items,
  );
}
const message = (title: string) => publishActivity({ id: `message:${Date.now()}:${title}`, title });
export const toast = { info: message, success: message, error: message, warning: message };
