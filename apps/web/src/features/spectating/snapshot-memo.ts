/**
 * One origin read per Round per interval, whoever asks, so a viewer count
 * reaches the database as one reader even with no CDN in front. Failures are
 * not kept. Nothing here is per viewer, and no caller answers from it before
 * deciding who is asking, so sharing it is safe.
 */
export const createSnapshotMemo = <T>(options: {
  readonly nowMs: () => number;
  readonly ttlMs: number;
  readonly maxEntries: number;
}) => {
  const entries = new Map<
    string,
    { readonly until: number; readonly value: Promise<T> }
  >();
  return (key: string, read: () => Promise<T>): Promise<T> => {
    const nowMs = options.nowMs();
    const held = entries.get(key);
    if (held && held.until > nowMs) return held.value;
    if (entries.size >= options.maxEntries) entries.clear();
    const value = read();
    entries.set(key, { until: nowMs + options.ttlMs, value });
    value.catch(() => entries.delete(key));
    return value;
  };
};
