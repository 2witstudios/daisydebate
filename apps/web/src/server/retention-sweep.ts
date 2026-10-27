import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import type { ProvisionalLinkPurposes } from '@daisy/db';

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
  provisionalLinks,
}: {
  /** The link purposes the abandoned-account sweep clears; no hash key. */
  readonly provisionalLinks: ProvisionalLinkPurposes;
  readonly database: {
    readonly purgeExpiredVerifications: (batch: Batch) => Promise<number>;
    readonly purgeExpiredOutboxEvents: (batch: Batch) => Promise<number>;
    readonly purgeExpiredEmailDeliveryEvents: (batch: Batch) => Promise<number>;
    readonly purgeExpiredEmailDeliveries: (batch: Batch) => Promise<number>;
    readonly purgeExpiredMailIntents: (batch: Batch) => Promise<number>;
    readonly purgeExpiredRoomCommands: (batch: Batch) => Promise<number>;
    readonly purgeExpiredRoundCommands: (batch: Batch) => Promise<number>;
    readonly purgeExpiredRoundCheckInAttempts: (
      batch: Batch,
    ) => Promise<number>;
    readonly purgeExpiredServiceInstances: (batch: Batch) => Promise<number>;
    readonly purgeExpiredAvailabilitySamples: (batch: Batch) => Promise<number>;
    readonly purgeExpiredProvisionalUsers: (
      batch: Batch & ProvisionalLinkPurposes,
    ) => Promise<number>;
    readonly purgeExpiredSessions: (batch: Batch) => Promise<number>;
    readonly purgeExpiredUtterances: (batch: Batch) => Promise<number>;
    readonly clearExpiredPendingBallots: (batch: Batch) => Promise<number>;
    readonly purgeExpiredRoundFeedback: (batch: Batch) => Promise<number>;
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
    /**
     * AUTH-7.5: a session is deleted the instant it is revoked
     * (`revokeOtherSessions`, `revokeSessionUnlessAddressHeld`), so this
     * sweep only ever finds sessions that ran to their own `expires_at` and
     * were never signed out of; it keeps the same 24-hour grace as
     * verification rows.
     */
    {
      name: 'retention.session',
      batchSize: 500,
      maxBatches: 20,
      purge: ({ now, limit }) =>
        database.purgeExpiredSessions({
          before: cutoff(now, DAY_MS),
          limit,
        }),
    },
    // ISSUE-660(b), orchestrator policy: abandoned accounts expire after 24h.
    {
      name: 'retention.provisional_user',
      batchSize: 50,
      maxBatches: 20,
      purge: ({ now, limit }) =>
        database.purgeExpiredProvisionalUsers({
          before: cutoff(now, DAY_MS),
          limit,
          ...provisionalLinks,
        }),
    },
    // ADR0059/DEC-81: accepted command receipts dedupe for 24 hours.
    ...dailyTargets(database),
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
    /** ADR 0075: sent, failed and cancelled mail intents are kept 30 days. */
    {
      name: 'retention.mail_intents',
      batchSize: 500,
      maxBatches: 20,
      purge: ({ now, limit }) =>
        database.purgeExpiredMailIntents({
          before: cutoff(now, 30 * DAY_MS),
          limit,
        }),
    },
    /**
     * DEC-101 and DEC-89 (ISSUE-498): private transcript lines, cached AI
     * judging responses and AI coaching (ADR 0071) are kept 180 days. A
     * cleared response fails its job (DEC-223).
     */
    ...(
      [
        ['utterances', database.purgeExpiredUtterances],
        ['pending_ballots', database.clearExpiredPendingBallots],
        ['round_feedback', database.purgeExpiredRoundFeedback],
      ] as const
    ).map(([name, purge]) => ({
      name: `retention.${name}`,
      batchSize: 500,
      maxBatches: 20,
      purge: ({ now, limit }: { now: string; limit: number }) =>
        purge({ before: cutoff(now, 180 * DAY_MS), limit }),
    })),
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
  waitUntilReady,
}: {
  readonly sweep: {
    readonly run: () => Promise<readonly RetentionResult[]>;
    readonly stop: () => void;
  };
  readonly timers: Timers;
  readonly intervalMs?: number;
  /** Also sweep once now: processes restarted more often than hourly still prune. */
  readonly runOnStart?: boolean;
  /**
   * Resolves true once the start-up run's dependencies are reachable
   * (ISSUE-146): a freshly started Fly machine's Redis connection is not
   * necessarily ready the instant this process starts listening, so
   * `runOnStart`'s one run waits here instead of logging a spurious
   * `retention.sweep.failed` on every cold boot. Resolving false or
   * rejecting means the dependencies never became reachable: the start-up
   * run is skipped and the next hourly tick sweeps instead. Omitted, the
   * start-up run fires synchronously. Ignored when `runOnStart` is false;
   * the hourly schedule never waits on it. Reserves `current` for the whole wait, so a timer
   * tick that arrives during it is skipped rather than racing the start-up
   * run.
   */
  readonly waitUntilReady?: () => Promise<boolean>;
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
  let initial: Promise<unknown> | undefined;
  if (runOnStart) {
    if (waitUntilReady) {
      const started = waitUntilReady()
        .catch(() => false)
        .then((ready) => {
          current = undefined;
          return ready ? tick() : undefined;
        });
      current = started;
      initial = started;
    } else {
      initial = tick();
    }
  }
  return {
    /** The start-up run, when `runOnStart` is set. */
    initial,
    /** Stops scheduling and resolves once any run in progress has ended. */
    stop: async () => {
      stopped = true;
      timers.clearInterval(handle);
      sweep.stop();
      await current;
    },
  };
}

const dailyTargets = (database: {
  purgeExpiredRoomCommands: (batch: Batch) => Promise<number>;
  purgeExpiredRoundCommands: (batch: Batch) => Promise<number>;
  readonly purgeExpiredRoundCheckInAttempts: (batch: Batch) => Promise<number>;
  purgeExpiredServiceInstances: (batch: Batch) => Promise<number>;
  purgeExpiredAvailabilitySamples: (batch: Batch) => Promise<number>;
}): readonly RetentionTarget[] =>
  (
    [
      ['room_commands', database.purgeExpiredRoomCommands],
      ['round_commands', database.purgeExpiredRoundCommands],
      ['round_check_in_attempts', database.purgeExpiredRoundCheckInAttempts],
      ['service_instances', database.purgeExpiredServiceInstances],
      ['availability_samples', database.purgeExpiredAvailabilitySamples],
    ] as const
  ).map(([name, purge]) => ({
    name: `retention.${name}`,
    batchSize: 500,
    maxBatches: 20,
    purge: ({ now, limit }) => purge({ before: cutoff(now, DAY_MS), limit }),
  }));
