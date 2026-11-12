import {
  mediaRoomRotationCauses,
  type MediaRoomRotationCause,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, oneOf, timestampColumn } from './columns';
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
    /** Whether the last pass finished its work; the recovery tick retries one that did not. */
    reconcileLastPassClean: boolean('reconcile_last_pass_clean')
      .notNull()
      .default(true),
    reconcileLeaseUntil: timestampColumn('reconcile_lease_until'),
    reconcileOwner: text('reconcile_owner'),
    unsafeAt: timestampColumn('unsafe_at'),
    deletionRequestedAt: timestampColumn('deletion_requested_at'),
    /** The last pass that read the room saw the capture agent in it. */
    roomSawCapture: boolean('room_saw_capture').notNull().default(false),
    /** LiveKit's id for the room when last occupied: a new id means the node was lost. */
    roomOccupiedSid: text('room_occupied_sid'),
    /** When the session took the post-round call's own room (ADR 0126). */
    postRoundCallOpenedAt: timestampColumn('post_round_call_opened_at'),
    /** Since when a pass has read the post-round call's room empty; null while occupied. */
    roomVacantSince: timestampColumn('room_vacant_since'),
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

/**
 * When a session moved to a fresh room (a revoked seat), since `room_name` only
 * holds the current one. Recording reads it to state the dropout (REC-1.2).
 */
export const mediaRoomRotations = pgTable(
  'media_room_rotations',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    rotatedAt: timestampColumn('rotated_at').notNull(),
    /** Why the session moved, as its room's fate said. Read by the incident feature. */
    cause: text('cause').$type<MediaRoomRotationCause>().notNull(),
  },
  (table) => [
    index('media_room_rotations_round_idx').on(table.roundId),
    check(
      'media_room_rotations_cause_check',
      oneOf(table.cause, mediaRoomRotationCauses),
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
