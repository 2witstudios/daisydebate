import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import {
  jsonbColumn,
  jsonbIsObject,
  jsonObjectSchema,
  oneOf,
  timestampColumn,
} from './columns';
import { roundParticipants } from './round-participants';

/** What the AI process on a seat was doing for one execution. */
export const agentRunKinds = [
  'speech',
  'cross_ex',
  'tts',
  'stt',
  'judging',
] as const;

/**
 * One row per AI execution on a seat (ADR 0058 §8): the model and provider
 * it ran with, its configuration, and what it consumed. AI runtime state
 * belongs to the run, not to an AI-specific round. Replaces the five model
 * columns and four usage counters the AI stack used to carry.
 */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    roundParticipantId: text('round_participant_id')
      .notNull()
      .references(() => roundParticipants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    model: text('model'),
    provider: text('provider').notNull(),
    configurationSnapshot: jsonbColumn(
      'configuration_snapshot',
      jsonObjectSchema,
    )
      .notNull()
      .default({}),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    characters: integer('characters').notNull().default(0),
    requests: integer('requests').notNull().default(0),
    startedAt: timestampColumn('started_at').notNull(),
    endedAt: timestampColumn('ended_at'),
  },
  (table) => [
    index('agent_runs_participant_kind_idx').on(
      table.roundParticipantId,
      table.kind,
    ),
    index('agent_runs_started_idx').on(table.startedAt),
    check('agent_runs_kind_check', oneOf(table.kind, agentRunKinds)),
    check(
      'agent_runs_usage_nonnegative',
      sql`${table.inputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.characters} >= 0 and ${table.requests} >= 0`,
    ),
    jsonbIsObject('agent_runs', table.configurationSnapshot),
  ],
);
