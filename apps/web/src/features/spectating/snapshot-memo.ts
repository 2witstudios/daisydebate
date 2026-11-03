/**
 * One origin read per Round per interval, whoever asks, so a viewer count
 * reaches the database as one reader even with no CDN in front. A failure is not
 * kept unless `keepsFailure` says so: a refused read holds for its interval, so a
 * crowd on a full lane asks it once rather than once each. Nothing here is per
 * viewer, and no caller answers from it before deciding who is asking, so sharing
 * it is safe. A held answer is only ever older than the instant it is served at,
 * so it can never run ahead of the release rule its read applied.
 */
export const createSnapshotMemo = <T>(options: {
  readonly nowMs: () => number;
  readonly ttlMs: number;
  readonly maxEntries: number;
  readonly keepsFailure?: (error: unknown) => boolean;
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
    const entry = { until: nowMs + options.ttlMs, value };
    entries.set(key, entry);
    value.catch((error: unknown) => {
      if (entries.get(key) === entry && !options.keepsFailure?.(error))
        entries.delete(key);
    });
    return value;
  };
};
