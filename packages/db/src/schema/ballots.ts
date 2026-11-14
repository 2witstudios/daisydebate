import {
  ballotScoresRecordSchema,
  daisyBallotDefinitionIds,
  type SideKey,
} from '@daisy/protocol';
import { z } from 'zod';
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
  isSideKeyOrNull,
  jsonbArrayColumnNullable,
  jsonbColumnNullable,
  jsonbIsObject,
  oneOf,
  timestampColumn,
  updatedAtColumn,
} from './columns';
import { ballotDefinitionVersions } from './ballot-definitions';
import { roundParticipants } from './round-participants';
import { rounds } from './rounds';
import { roundTranscriptFreezes } from './round-transcript-freezes';
import { bothOrNeither } from './tenant-keys';

/** What a ballot decided (TAB-6.11): a win, a tie, a double loss, or places. */
export const ballotDecisions = [
  'win',
  'tie',
  'double_loss',
  'ranking',
] as const;
export type BallotDecisionColumn = (typeof ballotDecisions)[number];

/** Feedback per subject (a side key or a round participant id). */
const ballotFeedbackColumnSchema = z.record(z.string(), z.string());
/** Citations per subject, a criterion's or the subject's own. */
const citationSchema = z.strictObject({ turn: z.string(), note: z.string() });
const ballotCitationsColumnSchema = z.record(
  z.string(),
  z.union([citationSchema, z.record(z.string(), citationSchema)]),
);
const ballotRankingColumnSchema = z
  .array(z.array(z.string().min(1)).min(1))
  .min(1);

/**
 * One ballot per judge seat (ADR 0058 §6): the contract's shape, decomposed
 * into columns a write path validates with the Round's own `ballotSchemaFor`
 * before filling. The deferred NO ACTION judge-seat FK means a seat carrying a ballot
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
    /** The Daisy ballot definition answered (`key@revision`); null for a host's. */
    rubricVersion: text('rubric_version'),
    /** What the ballot decided; a win names its side in `winner`. */
    decision: text('decision')
      .$type<BallotDecisionColumn>()
      .notNull()
      .default('win'),
    /** The winning side, exactly when the decision is a win (DEC-116). */
    winner: text('winner').$type<SideKey>(),
    /** A ranking ballot's places, best first, exactly when it ranks. */
    ranking: jsonbArrayColumnNullable('ranking', ballotRankingColumnSchema),
    /** Points per subject; null for a definition that gives none. */
    scores: jsonbColumnNullable('scores', ballotScoresRecordSchema),
    reason: text('reason').notNull(),
    feedback: jsonbColumnNullable('feedback', ballotFeedbackColumnSchema),
    citations: jsonbColumnNullable('citations', ballotCitationsColumnSchema),
    submittedAt: timestampColumn('submitted_at').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    /** The ballot definition answered; null is the Daisy ballot. */
    ballotDefinitionId: text('ballot_definition_id'),
    ballotDefinitionVersion: integer('ballot_definition_version'),
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
    index('ballots_ballot_definition_idx').on(
      table.ballotDefinitionId,
      table.ballotDefinitionVersion,
    ),
    foreignKey({
      name: 'ballots_ballot_definition_fk',
      columns: [table.ballotDefinitionId, table.ballotDefinitionVersion],
      foreignColumns: [
        ballotDefinitionVersions.ballotDefinitionId,
        ballotDefinitionVersions.version,
      ],
    }).onDelete('restrict'),
    bothOrNeither(
      'ballots_ballot_definition_complete',
      table.ballotDefinitionId,
      table.ballotDefinitionVersion,
    ),
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
    check('ballots_decision_check', oneOf(table.decision, ballotDecisions)),
    check(
      'ballots_winner_check',
      sql`(${table.winner} is not null) = (${table.decision} = 'win') and (${isSideKeyOrNull(table.winner)})`,
    ),
    check(
      'ballots_ranking_check',
      sql`(${table.ranking} is not null) = (${table.decision} = 'ranking') and (${table.ranking} is null or jsonb_typeof(${table.ranking}) = 'array')`,
    ),
    // A Daisy ballot names its definition here; a host's pins its version above.
    check(
      'ballots_daisy_definition_check',
      sql`(${table.ballotDefinitionId} is null) = (${table.rubricVersion} is not null)`,
    ),
    check(
      'ballots_rubric_version_check',
      // Every version stays readable; writes validate the Round's own (ADR 0125).
      sql`${table.rubricVersion} is null or ${oneOf(table.rubricVersion, daisyBallotDefinitionIds)}`,
    ),
    jsonbIsObject('ballots', table.scores),
    jsonbIsObject('ballots', table.feedback),
    jsonbIsObject('ballots', table.citations),
  ],
);
