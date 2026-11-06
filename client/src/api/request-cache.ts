/** Bounded session cache; identical in-flight reads share one network request. */
export function createRequestCache(ttlMs = 60_000, limit = 32) {
  const entries = new Map<string, { expires: number; request: Promise<unknown> }>();
  return {
    clear() { entries.clear(); },
    read<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && hit.expires > Date.now()) {
        entries.delete(key);
        entries.set(key, hit);
        return hit.request as Promise<T>;
      }
      const entry = { expires: Infinity, request: null as unknown as Promise<T> };
      entry.request = Promise.resolve().then(fetcher).then(value => {
        entry.expires = Date.now() + ttlMs;
        return value;
      }, error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > limit) entries.delete(entries.keys().next().value!);
      return entry.request;
    },
  };
}
