import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import {
  oneOf,
  timestampColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { debateParticipants } from './debate-participants';
import { debates } from './debates';

export const ballotDecisions = ['affirmative', 'negative', 'draw'] as const;
export const ballotStatuses = ['submitted', 'voided'] as const;

/**
 * One ballot per judge seat: `participant_id` is unique. That the seat is a
 * judge is a domain invariant. Voiding keeps the row and records who and
 * when; the CHECK ties both to the status.
 */
export const ballots = pgTable(
  'ballots',
  {
    id: text('id').primaryKey(),
    debateId: text('debate_id')
      .notNull()
      .references(() => debates.id, { onDelete: 'cascade' }),
    /** Bound to `debate_id` by the composite key below, never on its own. */
    participantId: text('participant_id').notNull(),
    decision: text('decision').notNull(),
    scores: jsonb('scores').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull(),
    submittedAt: timestampColumn('submitted_at').notNull(),
    voidedAt: timestampColumn('voided_at'),
    voidedByActorId: text('voided_by_actor_id').references(() => actors.id, {
      onDelete: 'restrict',
    }),
    version: versionColumn(),
  },
  (table) => [
    /**
     * The seat must belong to this ballot's debate: two independent keys
     * would accept debate A with a seat from debate B, and either cascade
     * could then remove the ballot.
     */
    foreignKey({
      name: 'ballots_participant_in_debate_fk',
      columns: [table.debateId, table.participantId],
      foreignColumns: [debateParticipants.debateId, debateParticipants.id],
    }).onDelete('cascade'),
    uniqueIndex('ballots_participant_unique').on(table.participantId),
    check('ballots_decision_check', oneOf(table.decision, ballotDecisions)),
    check('ballots_status_check', oneOf(table.status, ballotStatuses)),
    check(
      'ballots_voided_fields_check',
      sql`(${table.status} = 'voided' and ${table.voidedAt} is not null and ${table.voidedByActorId} is not null) or (${table.status} <> 'voided' and ${table.voidedAt} is null and ${table.voidedByActorId} is null)`,
    ),
    versionPositive('ballots', table.version),
  ],
);
