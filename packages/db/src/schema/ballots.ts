import {
  ballotCitationsSchema,
  ballotFeedbackSchema,
  ballotRubricVersion,
  ballotScoresSchema,
  debateSides,
} from '@daisy/protocol';
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
import {
  createdAtColumn,
  jsonbColumn,
  jsonbColumnNullable,
  jsonbIsObject,
  oneOf,
  timestampColumn,
  updatedAtColumn,
} from './columns';
import { roundParticipants } from './round-participants';
import { rounds } from './rounds';
import { roundTranscriptFreezes } from './round-transcript-freezes';

/**
 * One ballot per judge seat (ADR 0058 §6): the contract's shape, decomposed
 * into columns a write path validates with the full `ballotSchema` before
 * filling. The deferred NO ACTION judge-seat FK means a seat carrying a ballot
 * cannot be deleted. Human and AI judges produce exactly this contract.
 */
export const ballots = pgTable(
  'ballots',
  {
    id: text('id').primaryKey(),
    judgeParticipantId: text('judge_participant_id').notNull(),
    /** The owning Round and the immutable transcript freeze the ballot judged. */
    roundId: text('round_id').notNull(),
    freezeRevision: integer('freeze_revision').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    /** The winner: a side. There are no draws (ADR 0058 §6, DEC-116). */
    winner: text('winner').notNull(),
    scores: jsonbColumn('scores', ballotScoresSchema).notNull(),
    reason: text('reason').notNull(),
    feedback: jsonbColumnNullable('feedback', ballotFeedbackSchema),
    citations: jsonbColumnNullable('citations', ballotCitationsSchema),
    submittedAt: timestampColumn('submitted_at').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('ballots_finalization_reference').on(
      table.id,
      table.roundId,
      table.freezeRevision,
    ),
    // Direct seat deletion is refused; the owning Round may erase its aggregate.
    foreignKey({
      name: 'ballots_judge_seat_fk',
      columns: [table.judgeParticipantId],
      foreignColumns: [roundParticipants.id],
    }),
    foreignKey({
      name: 'ballots_round_fk',
      columns: [table.roundId],
      foreignColumns: [rounds.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ballots_judge_round_fk',
      columns: [table.judgeParticipantId, table.roundId],
      foreignColumns: [roundParticipants.id, roundParticipants.roundId],
    }),
    foreignKey({
      name: 'ballots_freeze_revision_fk',
      columns: [table.roundId, table.freezeRevision],
      foreignColumns: [
        roundTranscriptFreezes.roundId,
        roundTranscriptFreezes.revision,
      ],
    }),
    index('ballots_judge_round_idx').on(
      table.judgeParticipantId,
      table.roundId,
    ),
    index('ballots_freeze_revision_idx').on(
      table.roundId,
      table.freezeRevision,
    ),
    check('ballots_freeze_revision_positive', sql`${table.freezeRevision} > 0`),
    uniqueIndex('ballots_id_judge_unique').on(
      table.id,
      table.judgeParticipantId,
    ),
    uniqueIndex('ballots_judge_seat_unique').on(table.judgeParticipantId),
    check('ballots_winner_check', oneOf(table.winner, debateSides)),
    check(
      'ballots_rubric_version_check',
      sql`${table.rubricVersion} = ${ballotRubricVersion}`,
    ),
    jsonbIsObject('ballots', table.scores),
    jsonbIsObject('ballots', table.feedback),
    jsonbIsObject('ballots', table.citations),
  ],
);
