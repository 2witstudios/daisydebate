import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, timestampColumn } from './columns';
import { rounds } from './rounds';
import { roundParticipants } from './round-participants';

/** One opaque SFU room per competitive Round; seats remain authoritative. */
export const mediaSessions = pgTable(
  'media_sessions',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    roomName: text('room_name').notNull(),
    createdAt: createdAtColumn(),
    endedAt: timestampColumn('ended_at'),
    reconcileEpoch: integer('reconcile_epoch').notNull().default(0),
    reconcileRequestVersion: integer('reconcile_request_version')
      .notNull()
      .default(0),
    reconcileRunningVersion: integer('reconcile_running_version')
      .notNull()
      .default(0),
    reconcileServedVersion: integer('reconcile_served_version')
      .notNull()
      .default(0),
    reconcileRequestedAt: timestampColumn('reconcile_requested_at'),
    reconcileStartedAt: timestampColumn('reconcile_started_at'),
    reconcileCompletedAt: timestampColumn('reconcile_completed_at'),
    reconcileLeaseUntil: timestampColumn('reconcile_lease_until'),
    reconcileOwner: text('reconcile_owner'),
    unsafeAt: timestampColumn('unsafe_at'),
    deletionRequestedAt: timestampColumn('deletion_requested_at'),
  },
  (table) => [
    uniqueIndex('media_sessions_round_unique').on(table.roundId),
    uniqueIndex('media_sessions_room_unique').on(table.roomName),
    uniqueIndex('media_sessions_id_round_unique').on(table.id, table.roundId),
    check(
      'media_sessions_reconcile_versions_check',
      sql`${table.reconcileEpoch} >= 0 and ${table.reconcileServedVersion} >= 0 and ${table.reconcileRunningVersion} >= ${table.reconcileServedVersion} and ${table.reconcileRequestVersion} >= ${table.reconcileRunningVersion}`,
    ),
    check(
      'media_sessions_reconcile_lease_check',
      sql`(${table.reconcileOwner} is null) = (${table.reconcileLeaseUntil} is null)`,
    ),
    check(
      'media_sessions_end_check',
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const mediaParticipants = pgTable(
  'media_participants',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    roundId: text('round_id').notNull(),
    roundParticipantId: text('round_participant_id').notNull(),
    identity: text('identity').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'media_participants_session_round_fk',
      columns: [table.sessionId, table.roundId],
      foreignColumns: [mediaSessions.id, mediaSessions.roundId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'media_participants_participant_round_fk',
      columns: [table.roundParticipantId, table.roundId],
      foreignColumns: [roundParticipants.id, roundParticipants.roundId],
    }).onDelete('no action'),
    uniqueIndex('media_participants_seat_unique').on(
      table.sessionId,
      table.roundParticipantId,
    ),
    uniqueIndex('media_participants_identity_unique').on(table.identity),
    index('media_participants_session_round_idx').on(
      table.sessionId,
      table.roundId,
    ),
    index('media_participants_participant_round_idx').on(
      table.roundParticipantId,
      table.roundId,
    ),
  ],
);
