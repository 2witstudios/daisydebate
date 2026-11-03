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
import { broadcastReleasePolicySchema } from '@daisy/protocol';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  timestampColumn,
} from './columns';
import { rounds } from './rounds';

/**
 * The delayed audience stream of one Round (ADR 0099). It is not a Recording
 * and nothing about the Round depends on it. `releasedThroughAt` is the durable
 * watermark the spectator timeline follows; `nextSegment` is the hold's cursor.
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
    releasedThroughAt: timestampColumn('released_through_at'),
    finalMediaEndAt: timestampColumn('final_media_end_at'),
    stoppedAt: timestampColumn('stopped_at'),
    stopReason: text('stop_reason'),
    completedAt: timestampColumn('completed_at'),
    /** One web instance reconciles a Broadcast at a time, so one Egress starts. */
    reconcileLeaseUntil: timestampColumn('reconcile_lease_until'),
    leaseEpoch: integer('lease_epoch').notNull().default(0),
    leaseOwner: text('lease_owner'),
    leaseUntil: timestampColumn('lease_until'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('broadcasts_round_unique').on(table.roundId),
    index('broadcasts_open_idx')
      .on(table.createdAt)
      .where(sql`${table.completedAt} is null`),
    check(
      'broadcasts_delivery_path_check',
      sql`${table.deliveryPath} in ('owned_hls')`,
    ),
    jsonbIsObject('broadcasts', table.releasePolicy),
    check(
      'broadcasts_release_policy_check',
      sql`${table.releasePolicy}->>'kind' in ('delay','round_end','at')`,
    ),
    check(
      'broadcasts_cursor_check',
      sql`${table.nextSegment} >= 0 and ${table.revocationFailures} >= 0 and ${table.leaseEpoch} >= 0 and ${table.chatSlowModeSeconds} between 0 and 3600`,
    ),
    check(
      'broadcasts_lease_check',
      sql`(${table.leaseOwner} is null) = (${table.leaseUntil} is null)`,
    ),
    check(
      'broadcasts_stop_check',
      sql`(${table.stoppedAt} is null) = (${table.stopReason} is null)`,
    ),
  ],
);
