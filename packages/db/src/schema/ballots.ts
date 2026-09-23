import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  jsonObjectSchema,
  notBefore,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { debateParticipants } from './debate-participants';
import { debates } from './debates';

export const ballotDecisions = ['affirmative', 'negative', 'draw'] as const;
export const ballotStatuses = ['submitted', 'voided'] as const;

/**
 * One ballot per judge seat: `(debate_id, judge_actor_id)` is unique and
 * references the seat. That the seat is a judge is a domain invariant.
 * Voiding keeps the row and records who and when; the CHECK ties both to
 * the status.
 */
export const ballots = pgTable(
  'ballots',
  {
    id: text('id').primaryKey(),
    debateId: text('debate_id')
      .notNull()
      .references(() => debates.id, { onDelete: 'cascade' }),
    /** Bound to `debate_id` by the composite key below, never on its own. */
    judgeActorId: text('judge_actor_id').notNull(),
    decision: text('decision').notNull(),
    scores: jsonbColumn('scores', jsonObjectSchema).notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull(),
    submittedAt: timestampColumn('submitted_at').notNull(),
    voidedAt: timestampColumn('voided_at'),
    voidedByActorId: text('voided_by_actor_id').references(() => actors.id, {
      onDelete: 'restrict',
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    /**
     * The seat must belong to this ballot's debate: two independent keys
     * would accept debate A with a seat from debate B, and either cascade
     * could then remove the ballot.
     */
    foreignKey({
      name: 'ballots_judge_seat_fk',
      columns: [table.debateId, table.judgeActorId],
      foreignColumns: [debateParticipants.debateId, debateParticipants.actorId],
    }).onDelete('cascade'),
    uniqueIndex('ballots_judge_seat_unique').on(
      table.debateId,
      table.judgeActorId,
    ),
    index('ballots_voided_by_actor_idx').on(table.voidedByActorId),
    check('ballots_decision_check', oneOf(table.decision, ballotDecisions)),
    check('ballots_status_check', oneOf(table.status, ballotStatuses)),
    check(
      'ballots_voided_fields_check',
      sql`(${table.status} = 'voided' and ${table.voidedAt} is not null and ${table.voidedByActorId} is not null) or (${table.status} <> 'voided' and ${table.voidedAt} is null and ${table.voidedByActorId} is null)`,
    ),
    check(
      'ballots_voided_after_submitted',
      notBefore(table.voidedAt, table.submittedAt),
    ),
    jsonbIsObject('ballots', table.scores),
    versionPositive('ballots', table.version),
  ],
);
