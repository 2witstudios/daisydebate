import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import type { ProvisionalLinkPurposes } from '@daisy/db';
import { MODERATION_RECORD_RETENTION_MS } from '../features/moderation/retention';

const DAY_MS = 86_400_000;

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
  /** False when the last batch was full at `maxBatches`: due rows remain. */
  readonly drained: boolean;
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
    readonly purgeExpiredChallenges: (batch: {
      readonly now: string;
      readonly limit: number;
    }) => Promise<number>;
    readonly purgeErasedModeration: (batch: Batch) => Promise<number>;
    readonly purgeClosedReports: (batch: {
      readonly now: string;
      readonly limit: number;
    }) => Promise<number>;
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
    readonly purgeExpiredRoundAnalyses: (batch: Batch) => Promise<number>;
    readonly purgeExpiredSocialDeclines: (batch: Batch) => Promise<number>;
    readonly purgeExpiredSocialRequests: (batch: Batch) => Promise<number>;
    readonly purgeReadNotifications: (batch: Batch) => Promise<number>;
    readonly purgeExpiredWatchHistory: (batch: Batch) => Promise<number>;
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
     * DEC-101 and DEC-89 (ISSUE-498): private transcript lines and cached AI
     * judging responses are kept 180 days. A cleared response fails its job
     * (DEC-223). Round analyses keep the same window as the transcript they
     * read, under their own target.
     */
    ...(
      [
        ['utterances', database.purgeExpiredUtterances],
        ['pending_ballots', database.clearExpiredPendingBallots],
        ['round_analyses', database.purgeExpiredRoundAnalyses],
      ] as const
    ).map(([name, purge]) => ({
      name: `retention.${name}`,
      batchSize: 500,
      maxBatches: 20,
      purge: ({ now, limit }: { now: string; limit: number }) =>
        purge({ before: cutoff(now, 180 * DAY_MS), limit }),
    })),
    /**
     * DEC-251: a decline row stops counting and blocking at its own
     * `expires_at` (the policy window after its last decline), so the cutoff
     * is the run's clock itself.
     */
    {
      name: 'retention.social_declines',
      batchSize: 500,
      maxBatches: 20,
      purge: ({ now, limit }) =>
        database.purgeExpiredSocialDeclines({ before: cutoff(now, 0), limit }),
    },
    /**
     * DEC-259 (open): the request budget looks back one day at most, so an older
     * request row is never counted again.
     */
    {
      name: 'retention.social_requests',
      batchSize: 500,
      maxBatches: 20,
      purge: ({ now, limit }) =>
        database.purgeExpiredSocialRequests({
          before: cutoff(now, DAY_MS),
          limit,
        }),
    },
    /** WATCH-12: a notification goes 90 days after it is read. */
    {
      name: 'retention.notifications',
      batchSize: 1000,
      maxBatches: 20,
      purge: ({ now, limit }) =>
        database.purgeReadNotifications({
          before: cutoff(now, 90 * DAY_MS),
          limit,
        }),
    },
    /** SPECT-1.4: a Round leaves watch history a year after the last visit. */
    {
      name: 'retention.watch_history',
      batchSize: 1000,
      maxBatches: 20,
      purge: ({ now, limit }) =>
        database.purgeExpiredWatchHistory({
          before: cutoff(now, 365 * DAY_MS),
          limit,
        }),
    },
    /** Offers past their time; the list already ignores them (ADR 0103). */
    {
      name: 'retention.challenges',
      batchSize: 1000,
      maxBatches: 50,
      purge: ({ now, limit }) =>
        database.purgeExpiredChallenges({ now: cutoff(now, 0), limit }),
    },
    /** Closed reports past their proposed evidence retention (DEC-298). */
    {
      name: 'retention.reports',
      batchSize: 1000,
      maxBatches: 50,
      purge: ({ now, limit }) =>
        database.purgeClosedReports({ now: cutoff(now, 0), limit }),
    },
    /** An erased account's sanctions past their proposed retention. */
    {
      name: 'retention.moderation',
      batchSize: 1000,
      maxBatches: 50,
      purge: ({ now, limit }) =>
        database.purgeErasedModeration({
          before: cutoff(now, MODERATION_RECORD_RETENTION_MS),
          limit,
        }),
    },
    /**
     * ADR 0033: the online set's lapsed members, which reads filter but
     * never delete. Redis is expendable, so a failure here costs only stale
     * members until the next run, yet that run still did not complete. 1000
     * is the adapter's per-call cap.
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
 *
 * `retention.run.completed` is the run's own outcome and the only event the
 * `cleanup_missed` marker reads (ISSUE-1007): logged once, and only when
 * every target succeeded and drained and shutdown cut nothing short. A target
 * that stops at `maxBatches` still has due rows, so that run did not complete.
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
    let drained = false;
    try {
      while (!stopped && batches < target.maxBatches) {
        const count = await target.purge({ now, limit: target.batchSize });
        batches += 1;
        deleted += count;
        drained = count < target.batchSize;
        if (drained) break;
      }
    } catch {
      logger.log(
        'retention.sweep.failed',
        { operation, errorCode: 'INFRASTRUCTURE' },
        'Retention sweep failed',
      );
      return { operation, ok: false, drained: false, deleted, batches };
    }
    logger.log(
      'retention.sweep.completed',
      { operation, deleted, batches },
      'Retention sweep completed',
    );
    return { operation, ok: true, drained, deleted, batches };
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
      if (!stopped && results.every(({ ok, drained }) => ok && drained))
        logger.log(
          'retention.run.completed',
          { deleted: results.reduce((sum, { deleted }) => sum + deleted, 0) },
          'Retention run completed',
        );
      return results;
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
