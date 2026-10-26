import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
import { roundCommands } from './round-commands';
import { roundParticipants } from './round-participants';
import { roundSegments } from './round-segments';

/** Accepted floor authority, never reconstructed from current vendor grants. */
export const roundSpeakingIntervals = pgTable(
  'round_speaking_intervals',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id').notNull(),
    segmentId: text('segment_id').notNull(),
    roundParticipantId: text('round_participant_id').notNull(),
    startedAt: timestampColumn('started_at').notNull(),
    endedAt: timestampColumn('ended_at'),
    startedVersion: integer('started_version').notNull(),
    endedVersion: integer('ended_version'),
    startedCommandId: text('started_command_id'),
    endedCommandId: text('ended_command_id'),
  },
  (table) => [
    foreignKey({
      name: 'round_speaking_intervals_segment_round_fk',
      columns: [table.segmentId, table.roundId],
      foreignColumns: [roundSegments.id, roundSegments.roundId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'round_speaking_intervals_participant_round_fk',
      columns: [table.roundParticipantId, table.roundId],
      foreignColumns: [roundParticipants.id, roundParticipants.roundId],
    }).onDelete('no action'),
    foreignKey({
      name: 'round_speaking_intervals_started_command_round_fk',
      columns: [table.startedCommandId, table.roundId],
      foreignColumns: [roundCommands.commandId, roundCommands.roundId],
    }).onDelete('no action'),
    foreignKey({
      name: 'round_speaking_intervals_ended_command_round_fk',
      columns: [table.endedCommandId, table.roundId],
      foreignColumns: [roundCommands.commandId, roundCommands.roundId],
    }).onDelete('no action'),
    index('round_speaking_intervals_segment_round_idx').on(
      table.segmentId,
      table.roundId,
    ),
    index('round_speaking_intervals_participant_round_idx').on(
      table.roundParticipantId,
      table.roundId,
    ),
    index('round_speaking_intervals_history_idx').on(
      table.roundId,
      table.segmentId,
      table.roundParticipantId,
      table.startedAt,
    ),
    index('round_speaking_intervals_started_command_idx').on(
      table.startedCommandId,
      table.roundId,
    ),
    index('round_speaking_intervals_ended_command_idx').on(
      table.endedCommandId,
      table.roundId,
    ),
    check(
      'round_speaking_intervals_time_check',
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
    check(
      'round_speaking_intervals_version_check',
      sql`${table.startedVersion} > 0 and (${table.endedVersion} is null or ${table.endedVersion} >= ${table.startedVersion})`,
    ),
    check(
      'round_speaking_intervals_close_pair',
      sql`(${table.endedAt} is null) = (${table.endedVersion} is null)`,
    ),
    check(
      'round_speaking_intervals_ended_command_check',
      sql`${table.endedCommandId} is null or ${table.endedAt} is not null`,
    ),
  ],
);
