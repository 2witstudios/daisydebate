import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  broadcastFeedEndReasons,
  broadcastReleasePolicySchema,
  releaseSkipsSchema,
} from '@daisy/protocol';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  oneOf,
  timestampColumn,
} from './columns';
import { rounds } from './rounds';

/**
 * The delayed audience stream of one Round (ADR 0099). It is not a Recording
 * and nothing about the Round depends on it. `releasedThroughAt` is the durable
 * watermark the spectator timeline follows; `nextSegment` is the public sequence.
 */
export const broadcasts = pgTable(
  'broadcasts',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    /** Each Broadcast records its path, so a faster one can be added later. */
    deliveryPath: text('delivery_path').notNull().default('owned_hls'),
    releasePolicy: jsonbColumn(
      'release_policy',
      broadcastReleasePolicySchema,
    ).notNull(),
    /** Whether debaters may read this Broadcast's chat during the Round; off on ranked. */
    debatersReadChat: boolean('debaters_read_chat').notNull().default(false),
    /** Slow mode's seconds between one account's chat posts; 0 is off (WATCH-7). */
    chatSlowModeSeconds: integer('chat_slow_mode_seconds').notNull().default(0),
    /** SHA3-256 of the stage page's credential; the secret itself is never stored. */
    stageCredentialHash: text('stage_credential_hash'),
    egressId: text('egress_id'),
    egressStartedAt: timestampColumn('egress_started_at'),
    observerRevokedAt: timestampColumn('observer_revoked_at'),
    revocationFailures: integer('revocation_failures').notNull().default(0),
    nextSegment: integer('next_segment').notNull().default(0),
    /** Each Egress attempt holds under its own prefix, so a restart overwrites nothing. */
    egressGeneration: integer('egress_generation').notNull().default(0),
    /** Clips the worker gave up on after bounded retries: stated gaps, by capture time. */
    releaseSkips: jsonbColumn('release_skips', releaseSkipsSchema)
      .notNull()
      .default({ clips: [] }),
    /** The attempt the worker is releasing, and its position in that attempt's hold. */
    releasedGeneration: integer('released_generation').notNull().default(1),
    holdCursor: integer('hold_cursor').notNull().default(0),
    /** The public manifests say the stream ended; only then can it complete. */
    streamEndedAt: timestampColumn('stream_ended_at'),
    releasedThroughAt: timestampColumn('released_through_at'),
    /** The published audience state is gone and no pass need look at this Broadcast. */
    audienceStateWithdrawnAt: timestampColumn('audience_state_withdrawn_at'),
    finalMediaEndAt: timestampColumn('final_media_end_at'),
    stoppedAt: timestampColumn('stopped_at'),
    stopReason: text('stop_reason'),
    /**
     * An operator's stop also holds the video back from the audience. Removing or
     * taking down the Recording ends the feed alone: the Recording's own state hides
     * it, and a restore brings it back.
     */
    mediaWithheld: boolean('media_withheld').notNull().default(false),
    completedAt: timestampColumn('completed_at'),
    /** A stop reached this after it completed: its feed goes now, not after the grace. */
    feedWithdrawalRequestedAt: timestampColumn('feed_withdrawal_requested_at'),
    /** Every public object is deleted, so the official feed answers nothing. */
    feedWithdrawnAt: timestampColumn('feed_withdrawn_at'),
    /** One web instance reconciles a Broadcast at a time, so one Egress starts. */
    reconcileLeaseUntil: timestampColumn('reconcile_lease_until'),
    /** When the control plane last reached this Broadcast, by the database's clock. */
    controlHeartbeatAt: timestampColumn('control_heartbeat_at'),
    /** Nothing is due before this, so no release slot holds it until then. */
    releaseNotBefore: timestampColumn('release_not_before'),
    leaseEpoch: integer('lease_epoch').notNull().default(0),
    leaseOwner: text('lease_owner'),
    leaseUntil: timestampColumn('lease_until'),
    createdAt: createdAtColumn(),
    /**
     * The random name of its public object tree, set at open. The bucket is
     * public, so this, not the link, is what keeps an unlisted Broadcast unfound.
     */
    feedKey: text('feed_key').notNull(),
  },
  (table) => [
    uniqueIndex('broadcasts_round_unique').on(table.roundId),
    index('broadcasts_open_idx')
      .on(table.createdAt)
      .where(sql`${table.completedAt} is null`),
    index('broadcasts_feed_up_idx')
      .on(table.createdAt)
      .where(sql`${table.feedWithdrawnAt} is null`),
    check(
      'broadcasts_delivery_path_check',
      sql`${table.deliveryPath} in ('owned_hls')`,
    ),
    jsonbIsObject('broadcasts', table.releasePolicy),
    jsonbIsObject('broadcasts', table.releaseSkips),
    check(
      'broadcasts_release_policy_check',
      sql`${table.releasePolicy}->>'kind' = 'delay'`,
    ),
    check(
      'broadcasts_cursor_check',
      sql`${table.nextSegment} >= 0 and ${table.holdCursor} >= 0 and ${table.egressGeneration} >= 0 and ${table.releasedGeneration} >= 1 and ${table.revocationFailures} >= 0 and ${table.leaseEpoch} >= 0 and ${table.chatSlowModeSeconds} between 0 and 3600`,
    ),
    check(
      'broadcasts_lease_check',
      sql`(${table.leaseOwner} is null) = (${table.leaseUntil} is null)`,
    ),
    check(
      'broadcasts_stop_check',
      sql`(${table.stoppedAt} is null) = (${table.stopReason} is null)`,
    ),
    check(
      'broadcasts_withheld_check',
      sql`not ${table.mediaWithheld} or ${table.stoppedAt} is not null`,
    ),
    check(
      'broadcasts_stop_reason_check',
      sql`${table.stopReason} is null or ${oneOf(table.stopReason, broadcastFeedEndReasons)}`,
    ),
    /** It completes once its stream has ended for the audience, or it was stopped. */
    check(
      'broadcasts_completed_check',
      sql`${table.completedAt} is null or ${table.streamEndedAt} is not null or ${table.stoppedAt} is not null`,
    ),
    /** Only a finished or stopped Broadcast's feed is withdrawn. */
    check(
      'broadcasts_feed_withdrawn_check',
      sql`${table.feedWithdrawnAt} is null or ${table.completedAt} is not null or ${table.stoppedAt} is not null`,
    ),
    check(
      'broadcasts_egress_check',
      sql`${table.egressId} is null or ${table.egressStartedAt} is not null`,
    ),
  ],
);
