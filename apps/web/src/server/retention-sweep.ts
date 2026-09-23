import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * One store the sweep prunes: `purge` deletes at most `limit` rows that are
 * due at `now` (the run's clock reading) and returns how many went. The
 * sweep calls it up to `maxBatches` times per run; a larger backlog drains
 * over later runs.
 */
export type RetentionTarget = {
  readonly name: string;
  readonly batchSize: number;
  readonly maxBatches: number;
  readonly purge: (input: {
    readonly now: string;
    readonly limit: number;
  }) => Promise<number>;
};

export type RetentionResult = {
  readonly operation: string;
  readonly ok: boolean;
  readonly deleted: number;
  readonly batches: number;
};

type Batch = { readonly before: string; readonly limit: number };

/** The UTC ISO cutoff `windowMs` before `now`; an unusable clock throws. */
const cutoff = (now: string, windowMs: number) => {
  const at = Date.parse(now);
  if (Number.isNaN(at)) throw new Error('Unusable clock value');
  return new Date(at - windowMs).toISOString();
};

/**
 * The retention policy (ISSUE-8 AC5), one row per store. The database
 * cutoffs come from the injected clock; Redis scores by its own `TIME`
 * (ADR 0033 §1.1), so its sweep takes no cutoff.
 */
export function retentionTargets({
  database,
  redis,
}: {
  readonly database: {
    readonly purgeExpiredVerifications: (batch: Batch) => Promise<number>;
    readonly purgeExpiredOutboxEvents: (batch: Batch) => Promise<number>;
    readonly purgeExpiredEmailDeliveryEvents: (batch: Batch) => Promise<number>;
    readonly purgeExpiredEmailDeliveries: (batch: Batch) => Promise<number>;
  };
  readonly redis: {
    readonly sweepOnlinePresence: (limit: number) => Promise<number>;
  };
}): readonly RetentionTarget[] {
  return [
    /** AUTH-7.5a: expired rows are kept for a 24-hour grace before deletion. */
    {
      name: 'retention.verification',
      batchSize: 500,
      maxBatches: 20,
      purge: ({ now, limit }) =>
        database.purgeExpiredVerifications({
          before: cutoff(now, DAY_MS),
          limit,
        }),
    },
    /**
     * RT-2.2: the delivery log is kept 24 hours. Batches are smaller than
     * the others because the outbox is write-heavy (every announced write
     * inserts a row) and each delete batch is its own autocommitted
     * statement whose duration holds back `pg_snapshot_xmin` for the whole
     * cluster while it runs (`drainOutbox` depends on that watermark to
     * find a row final). Throughput bound: one hourly run must delete at
     * least the rows that became eligible since the last run. Sized for 10
     * rows/s (36,000 rows/hour): 200 batches of 200 is 40,000 rows per run
     * (~11.1 rows/s). A sustained rate above that never drains; raise the
     * batches, the batch size or the run frequency together if it does.
     */
    {
      name: 'retention.outbox',
      batchSize: 200,
      maxBatches: 200,
      purge: ({ now, limit }) =>
        database.purgeExpiredOutboxEvents({
          before: cutoff(now, DAY_MS),
          limit,
        }),
    },
    /** ADR 0025: webhook dedupe rows are kept 30 days after receipt. */
    {
      name: 'retention.email_delivery_event',
      batchSize: 500,
      maxBatches: 20,
      purge: ({ now, limit }) =>
        database.purgeExpiredEmailDeliveryEvents({
          before: cutoff(now, 30 * DAY_MS),
          limit,
        }),
    },
    /**
     * ADR 0025: delivery diagnostics are kept 30 days after their last
     * status change. Suppressions are never pruned.
     */
    {
      name: 'retention.email_delivery',
      batchSize: 500,
      maxBatches: 20,
      purge: ({ now, limit }) =>
        database.purgeExpiredEmailDeliveries({
          before: cutoff(now, 30 * DAY_MS),
          limit,
        }),
    },
    /**
     * ADR 0033: the online set's lapsed members, which reads filter but
     * never delete. Redis is expendable, so a failure here only leaves
     * stale members for the next run. 1000 is the adapter's per-call cap.
     */
    {
      name: 'retention.presence_online',
      batchSize: 1000,
      maxBatches: 50,
      purge: ({ limit }) => redis.sweepOnlinePresence(limit),
    },
  ];
}

/**
 * The one bounded, idempotent retention sweep (ISSUE-8 AC5): each target in
 * turn, in batches of its `batchSize` until a short batch or its
 * `maxBatches`, with one clock reading per run. A failing target is logged
 * and the sweep moves to the next, so one broken store never stops the
 * others. Only counts and a stable error code are logged, never row
 * content or the error.
 */
export function createRetentionSweep({
  targets,
  clock,
  logger,
}: {
  readonly targets: readonly RetentionTarget[];
  readonly clock: Clock;
  readonly logger: Logger;
}) {
  let stopped = false;
  const sweepTarget = async (
    target: RetentionTarget,
    now: string,
  ): Promise<RetentionResult> => {
    const operation = target.name;
    let deleted = 0;
    let batches = 0;
    try {
      while (!stopped && batches < target.maxBatches) {
        const count = await target.purge({ now, limit: target.batchSize });
        batches += 1;
        deleted += count;
        if (count < target.batchSize) break;
      }
    } catch {
      logger.log(
        'retention.sweep.failed',
        { operation, errorCode: 'INFRASTRUCTURE' },
        'Retention sweep failed',
      );
      return { operation, ok: false, deleted, batches };
    }
    logger.log(
      'retention.sweep.completed',
      { operation, deleted, batches },
      'Retention sweep completed',
    );
    return { operation, ok: true, deleted, batches };
  };
  return {
    /** Ends a run between batches so shutdown never closes a pool under it. */
    stop: () => {
      stopped = true;
    },
    async run(): Promise<readonly RetentionResult[]> {
      const now = clock.now();
      const results: RetentionResult[] = [];
      for (const target of targets) {
        if (stopped) break;
        results.push(await sweepTarget(target, now));
      }
      return results;
    },
  };
}

export type Timers = {
  readonly setInterval: (tick: () => unknown, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};

/**
 * Hourly schedule inside the existing server process (no new service).
 * Every instance runs it; that is safe because every batch is race-free
 * (`SKIP LOCKED`, one atomic Lua op). A tick that arrives while this
 * process is still sweeping is skipped.
 */
export function startRetentionSweep({
  sweep,
  timers,
  intervalMs = HOUR_MS,
  runOnStart = false,
}: {
  readonly sweep: {
    readonly run: () => Promise<readonly RetentionResult[]>;
    readonly stop: () => void;
  };
  readonly timers: Timers;
  readonly intervalMs?: number;
  /** Also sweep once now: processes restarted more often than hourly still prune. */
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
      sweep.stop();
      await current;
    },
  };
}
