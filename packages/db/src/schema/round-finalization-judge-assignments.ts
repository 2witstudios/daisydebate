import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { roundFinalizations } from './round-finalizations';
import { roundJudgeAssignments } from './round-judge-assignments';

/**
 * Exact slot versions selected by the terminal receipt; later reads never reselect a mutable panel.
 * Both assignment references cascade: assignment history can only be deleted
 * with its Round (`daisy_round_assignment_history_immutable`), and a Round's
 * delete must not depend on which of its two cascade paths (through
 * `round_finalizations` or `round_judge_assignments`) PostgreSQL fires first.
 */
export const roundFinalizationJudgeAssignments = pgTable(
  'round_finalization_judge_assignments',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => roundFinalizations.roundId, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    assignmentVersion: integer('assignment_version'),
    participantId: text('participant_id'),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.slot] }),
    index('round_finalization_judge_assignments_version_idx').on(
      table.roundId,
      table.slot,
      table.assignmentVersion,
      table.participantId,
    ),
    unique('round_finalization_judge_assignments_participant_unique').on(
      table.roundId,
      table.participantId,
    ),
    check(
      'round_finalization_judge_assignments_slot_check',
      sql`${table.slot}>=0 and (${table.assignmentVersion} is null or ${table.assignmentVersion}>0) and (${table.assignmentVersion} is not null or ${table.participantId} is null)`,
    ),
    foreignKey({
      name: 'round_finalization_judge_assignments_version_fk',
      columns: [table.roundId, table.slot, table.assignmentVersion],
      foreignColumns: [
        roundJudgeAssignments.roundId,
        roundJudgeAssignments.slot,
        roundJudgeAssignments.version,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'round_finalization_judge_assignments_occupant_fk',
      columns: [
        table.roundId,
        table.slot,
        table.assignmentVersion,
        table.participantId,
      ],
      foreignColumns: [
        roundJudgeAssignments.roundId,
        roundJudgeAssignments.slot,
        roundJudgeAssignments.version,
        roundJudgeAssignments.participantId,
      ],
    }).onDelete('cascade'),
  ],
);
