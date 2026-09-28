/**
 * Polls `health` until it answers true or `maxAttempts` is spent, sleeping
 * `intervalMs` between attempts. Used by the retention sweep's start-up run
 * (ISSUE-146): a scale-to-zero Fly machine's Redis connection is not
 * necessarily ready the instant the process starts listening, so the first
 * sweep waits for it instead of logging a spurious `retention.sweep.failed`.
 * A `health` rejection counts as not-yet-ready, never a thrown failure.
 */
export async function waitForHealthy({
  health,
  sleep,
  maxAttempts = 40,
  intervalMs = 250,
}: {
  readonly health: () => Promise<boolean>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly maxAttempts?: number;
  readonly intervalMs?: number;
}): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await health().catch(() => false)) return true;
    if (attempt < maxAttempts - 1) await sleep(intervalMs);
  }
  return false;
}
