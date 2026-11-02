/**
 * One scan of the online set per web process per second (ADR 0098): every
 * browser re-reads after a ring, and they all need the same ids. Concurrent
 * callers share the scan in flight. A failure is not kept.
 */
export function cachedScan(
  read: () => Promise<readonly string[]>,
  nowMs: () => number,
  ttlMs = 1_000,
) {
  let cached: {
    readonly at: number;
    readonly ids: Promise<readonly string[]>;
  } | null = null;
  return () => {
    const now = nowMs();
    if (cached && now - cached.at < ttlMs) return cached.ids;
    const ids = read();
    const entry = { at: now, ids };
    cached = entry;
    ids.catch(() => {
      if (cached === entry) cached = null;
    });
    return ids;
  };
}
