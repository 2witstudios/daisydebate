import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';

const HOUR_MS = 3_600_000;
/** AUTH-7.5: expired rows are kept for a 24-hour grace before deletion. */
const GRACE_MS = 24 * HOUR_MS;
const OPERATION = 'auth.cleanup.verification';

type CleanupResult = {
  readonly ok: boolean;
  readonly deleted: number;
  readonly batches: number;
};

/**
 * Bounded, idempotent retention of expired verification records. Each run
 * deletes at most `batchSize * maxBatches` rows (a larger backlog drains over
 * later runs), only rows expired before `now - grace`, and reports counts and
 * stable event names only: never an address, token or database error.
 */
export function createVerificationCleanup({
  purge,
  clock,
  logger,
  graceMs = GRACE_MS,
  batchSize = 500,
  maxBatches = 20,
}: {
  readonly purge: (input: {
    readonly before: string;
    readonly limit: number;
  }) => Promise<number>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly graceMs?: number;
  readonly batchSize?: number;
  readonly maxBatches?: number;
}) {
  return {
    async run(): Promise<CleanupResult> {
      const before = new Date(Date.parse(clock.now()) - graceMs).toISOString();
      let deleted = 0;
      let batches = 0;
      try {
        while (batches < maxBatches) {
          const count = await purge({ before, limit: batchSize });
          batches += 1;
          deleted += count;
          if (count < batchSize) break;
        }
      } catch {
        logger.log(
          'auth.cleanup.failed',
          { operation: OPERATION, errorCode: 'INFRASTRUCTURE' },
          'Verification cleanup failed',
        );
        return { ok: false, deleted: 0, batches: 0 };
      }
      logger.log(
        'auth.cleanup.completed',
        { operation: OPERATION, deleted, batches },
        'Verification cleanup completed',
      );
      return { ok: true, deleted, batches };
    },
  };
}

type Timers = {
  readonly setInterval: (tick: () => unknown, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};

/**
 * Hourly schedule inside the existing server process (no new service).
 * Every instance runs it; that is safe because the purge is race-free. A tick
 * that arrives while this process is still cleaning is skipped.
 */
export function startVerificationCleanup({
  cleanup,
  timers,
  intervalMs = HOUR_MS,
}: {
  readonly cleanup: { readonly run: () => Promise<CleanupResult> };
  readonly timers: Timers;
  readonly intervalMs?: number;
}) {
  let running = false;
  const handle = timers.setInterval(() => {
    if (running) return undefined;
    running = true;
    // Returned so callers (and tests) can await the run; timers ignore it.
    return cleanup.run().finally(() => {
      running = false;
    });
  }, intervalMs);
  return { stop: () => timers.clearInterval(handle) };
}
