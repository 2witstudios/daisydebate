import type { Clock } from '@daisy/clock';
import type { EventName, Logger } from '@daisy/logger';

const HOUR_MS = 3_600_000;

export type RetentionSweepResult = {
  readonly ok: boolean;
  readonly deleted: number;
  readonly batches: number;
};

/**
 * Bounded, idempotent retention sweep shared by every background purge
 * (AUTH-7.5a's verification cleanup, RT-2.2's outbox cleanup): delete rows
 * older than `now - retentionMs` in batches of `batchSize`, up to
 * `maxBatches` per run (a larger backlog drains over later runs), and
 * report counts only through the caller's own event names, never row
 * content.
 */
export function createRetentionSweep({
  purge,
  clock,
  logger,
  retentionMs,
  batchSize = 500,
  maxBatches = 20,
  completedEvent,
  failedEvent,
  operation,
}: {
  readonly purge: (input: {
    readonly before: string;
    readonly limit: number;
  }) => Promise<number>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly retentionMs: number;
  readonly batchSize?: number;
  readonly maxBatches?: number;
  readonly completedEvent: EventName;
  readonly failedEvent: EventName;
  readonly operation: string;
}) {
  let stopped = false;
  return {
    /** Ends a run between batches so shutdown never closes the pool under it. */
    stop: () => {
      stopped = true;
    },
    async run(): Promise<RetentionSweepResult> {
      let deleted = 0;
      let batches = 0;
      try {
        const before = new Date(
          Date.parse(clock.now()) - retentionMs,
        ).toISOString();
        while (!stopped && batches < maxBatches) {
          const count = await purge({ before, limit: batchSize });
          batches += 1;
          deleted += count;
          if (count < batchSize) break;
        }
      } catch {
        logger.log(
          failedEvent,
          { operation, errorCode: 'INFRASTRUCTURE' },
          'Retention sweep failed',
        );
        return { ok: false, deleted, batches };
      }
      logger.log(
        completedEvent,
        { operation, deleted, batches },
        'Retention sweep completed',
      );
      return { ok: true, deleted, batches };
    },
  };
}

export type Timers = {
  readonly setInterval: (tick: () => unknown, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};

/**
 * Hourly schedule inside the existing server process (no new service).
 * Every instance runs it; that is safe because the purge is race-free. A tick
 * that arrives while this process is still cleaning is skipped.
 */
export function startRetentionSweep({
  sweep,
  timers,
  intervalMs = HOUR_MS,
  runOnStart = false,
}: {
  readonly sweep: {
    readonly run: () => Promise<RetentionSweepResult>;
    readonly stop?: () => void;
  };
  readonly timers: Timers;
  readonly intervalMs?: number;
  /** Also clean once now: processes restarted more often than hourly still purge. */
  readonly runOnStart?: boolean;
}) {
  let stopped = false;
  let current: Promise<unknown> | undefined;
  const tick = () => {
    if (stopped || current) return undefined;
    const run = sweep.run().finally(() => {
      current = undefined;
    });
    current = run;
    return run;
  };
  const handle = timers.setInterval(tick, intervalMs);
  return {
    /** The start-up run, when `runOnStart` is set. */
    initial: runOnStart ? tick() : undefined,
    /** Stops scheduling and resolves once any run in progress has ended. */
    stop: async () => {
      stopped = true;
      timers.clearInterval(handle);
      sweep.stop?.();
      await current;
    },
  };
}
