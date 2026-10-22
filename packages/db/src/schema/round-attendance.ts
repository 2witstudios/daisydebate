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
import { notBefore, oneOf, timestampColumn } from './columns';
import { actors } from './actors';
import { rounds } from './rounds';
import { roundCommands } from './round-commands';
import { roundSegments } from './round-segments';
import { roundParticipants } from './round-participants';

export const roundCheckIns = pgTable(
  'round_check_ins',
  {
    commandId: text('command_id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    segmentId: text('segment_id').notNull(),
    participantId: text('participant_id').notNull(),
    receivedAt: timestampColumn('received_at').notNull(),
  },
  (table) => [
    uniqueIndex('round_check_ins_first_stamp_unique').on(
      table.roundId,
      table.segmentId,
      table.participantId,
    ),
    foreignKey({
      name: 'round_check_ins_command_round_fk',
      columns: [table.commandId, table.roundId],
      foreignColumns: [roundCommands.commandId, roundCommands.roundId],
    }),
    foreignKey({
      name: 'round_check_ins_segment_round_fk',
      columns: [table.segmentId, table.roundId],
      foreignColumns: [roundSegments.id, roundSegments.roundId],
    }),
    foreignKey({
      name: 'round_check_ins_participant_round_fk',
      columns: [table.participantId, table.roundId],
      foreignColumns: [roundParticipants.id, roundParticipants.roundId],
    }),
    index('round_check_ins_command_round_idx').on(
      table.commandId,
      table.roundId,
    ),
    index('round_check_ins_segment_round_idx').on(
      table.segmentId,
      table.roundId,
    ),
    index('round_check_ins_participant_round_idx').on(
      table.participantId,
      table.roundId,
    ),
  ],
);
export const roundAttendanceAdjudications = pgTable(
  'round_attendance_adjudications',
  {
    segmentId: text('segment_id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    commandId: text('command_id').notNull(),
    decision: text('decision')
      .$type<'attended' | 'none' | 'forfeit' | 'abandoned'>()
      .notNull(),
    effectiveDeadline: timestampColumn('effective_deadline').notNull(),
    settledHorizon: timestampColumn('settled_horizon').notNull(),
  },
  (table) => [
    uniqueIndex('round_attendance_adjudications_command_unique').on(
      table.commandId,
    ),
    foreignKey({
      name: 'round_attendance_adjudications_command_round_fk',
      columns: [table.commandId, table.roundId],
      foreignColumns: [roundCommands.commandId, roundCommands.roundId],
    }),
    foreignKey({
      name: 'round_attendance_adjudications_segment_round_fk',
      columns: [table.segmentId, table.roundId],
      foreignColumns: [roundSegments.id, roundSegments.roundId],
    }),
    index('round_attendance_adjudications_command_round_idx').on(
      table.commandId,
      table.roundId,
    ),
    index('round_attendance_adjudications_segment_round_idx').on(
      table.segmentId,
      table.roundId,
    ),
    index('round_attendance_adjudications_round_idx').on(table.roundId),
    check(
      'round_attendance_adjudications_decision_check',
      oneOf(table.decision, ['attended', 'none', 'forfeit', 'abandoned']),
    ),
  ],
);
export const roundCheckInAttempts = pgTable(
  'round_check_in_attempts',
  {
    attemptId: text('attempt_id').primaryKey(),
    commandId: text('command_id').notNull(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    receivedAt: timestampColumn('received_at')
      .notNull()
      .default(sql`statement_timestamp()`),
    backendPid: integer('backend_pid').notNull(),
    backendStartedAt: timestampColumn('backend_started_at').notNull(),
    payloadDigest: text('payload_digest').notNull(),
    actorId: text('actor_id').references(() => actors.id),
    serviceId: text('service_id'),
    state: text('state')
      .$type<'pending' | 'committed' | 'aborted'>()
      .notNull()
      .default('pending'),
    resolvedAt: timestampColumn('resolved_at'),
  },
  (table) => [
    index('round_check_in_attempts_round_state_idx').on(
      table.roundId,
      table.state,
    ),
    index('round_check_in_attempts_pending_idx')
      .on(table.roundId, table.receivedAt)
      .where(sql`${table.state}='pending'`),
    index('round_check_in_attempts_command_round_idx').on(
      table.commandId,
      table.roundId,
    ),
    index('round_check_in_attempts_actor_idx').on(table.actorId),
    index('round_check_in_attempts_resolved_idx').on(table.resolvedAt),
    check(
      'round_check_in_attempts_state_check',
      oneOf(table.state, ['pending', 'committed', 'aborted']),
    ),
    check(
      'round_check_in_attempts_resolved_check',
      sql`(${table.state}='pending' and ${table.resolvedAt} is null) or (${table.state}<>'pending' and ${table.resolvedAt} is not null)`,
    ),
    check(
      'round_check_in_attempts_resolved_after_received',
      notBefore(table.resolvedAt, table.receivedAt),
    ),
    check('round_check_in_attempts_backend_check', sql`${table.backendPid}>0`),
    check(
      'round_check_in_attempts_digest_check',
      sql`${table.payloadDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'round_check_in_attempts_one_principal',
      sql`(${table.actorId} is null) <> (${table.serviceId} is null)`,
    ),
  ],
);
