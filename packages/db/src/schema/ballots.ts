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
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbColumnNullable,
  jsonbIsObject,
  notBefore,
  oneOf,
  timestampColumn,
} from './columns';
import { actors } from './actors';
import { roundParticipants } from './round-participants';

export const ballotStatuses = ['submitted', 'voided'] as const;

/**
 * One ballot per judge seat (ADR 0058 §6): the contract's shape, decomposed
 * into columns a write path validates with the full `ballotSchema` before
 * filling. The judge-seat FK is RESTRICT — a seat carrying a submitted
 * ballot cannot be deleted; retirement is voiding, which records who and
 * when. Human and AI judges produce exactly this contract.
 */
export const ballots = pgTable(
  'ballots',
  {
    id: text('id').primaryKey(),
    judgeParticipantId: text('judge_participant_id').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    /** The winner: a side. There are no draws (ADR 0058 §6, DEC-116). */
    winner: text('winner').notNull(),
    scores: jsonbColumn('scores', ballotScoresSchema).notNull(),
    reason: text('reason').notNull(),
    feedback: jsonbColumnNullable('feedback', ballotFeedbackSchema),
    citations: jsonbColumnNullable('citations', ballotCitationsSchema),
    status: text('status').notNull(),
    submittedAt: timestampColumn('submitted_at').notNull(),
    voidedAt: timestampColumn('voided_at'),
    voidedByActorId: text('voided_by_actor_id'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    // RESTRICT: a seat carrying a submitted ballot cannot be deleted.
    foreignKey({
      name: 'ballots_judge_seat_fk',
      columns: [table.judgeParticipantId],
      foreignColumns: [roundParticipants.id],
    }),
    foreignKey({
      name: 'ballots_voided_by_actor_fk',
      columns: [table.voidedByActorId],
      foreignColumns: [actors.id],
    }).onDelete('restrict'),
    uniqueIndex('ballots_judge_seat_unique').on(table.judgeParticipantId),
    index('ballots_voided_by_actor_idx').on(table.voidedByActorId),
    check('ballots_status_check', oneOf(table.status, ballotStatuses)),
    check('ballots_winner_check', oneOf(table.winner, debateSides)),
    check(
      'ballots_rubric_version_check',
      sql`${table.rubricVersion} = ${ballotRubricVersion}`,
    ),
    check(
      'ballots_voided_fields_check',
      sql`(${table.status} = 'voided' and ${table.voidedAt} is not null and ${table.voidedByActorId} is not null) or (${table.status} <> 'voided' and ${table.voidedAt} is null and ${table.voidedByActorId} is null)`,
    ),
    check(
      'ballots_voided_after_submitted',
      notBefore(table.voidedAt, table.submittedAt),
    ),
    jsonbIsObject('ballots', table.scores),
  ],
);
