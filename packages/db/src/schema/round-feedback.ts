import { ballotFeedbackSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumnNullable,
  jsonbIsObject,
  oneOf,
  timestampColumn,
} from './columns';
import { rounds } from './rounds';
import { roundTranscriptFreezes } from './round-transcript-freezes';

export const roundFeedbackStatuses = ['leased', 'succeeded', 'failed'] as const;

/**
 * One AI coaching pass per completed Round no AI ballot already coached
 * (ADR 0071): the job and its result in one row, bound to the frozen
 * transcript revision it coached. The row exists from its
 * first claim; a lease bounds each paid attempt and `attempts` caps them.
 * Usage is kept here, since no Round seat runs it.
 */
export const roundFeedback = pgTable(
  'round_feedback',
  {
    roundId: text('round_id')
      .primaryKey()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    freezeRevision: integer('freeze_revision').notNull(),
    status: text('status')
      .$type<(typeof roundFeedbackStatuses)[number]>()
      .notNull(),
    attempts: integer('attempts').notNull(),
    leaseTokenDigest: text('lease_token_digest'),
    leaseExpiresAt: timestampColumn('lease_expires_at'),
    model: text('model').notNull(),
    /** Per-side coaching; each side's text reaches only that side's debater. */
    feedback: jsonbColumnNullable('feedback', ballotFeedbackSchema),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    completedAt: timestampColumn('completed_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({
      name: 'round_feedback_freeze_revision_fk',
      columns: [table.roundId, table.freezeRevision],
      foreignColumns: [
        roundTranscriptFreezes.roundId,
        roundTranscriptFreezes.revision,
      ],
    }).onDelete('cascade'),
    jsonbIsObject('round_feedback', table.feedback),
    check(
      'round_feedback_status_check',
      oneOf(table.status, roundFeedbackStatuses),
    ),
    check(
      'round_feedback_attempts_check',
      sql`${table.attempts} > 0 and ${table.inputTokens} >= 0 and ${table.outputTokens} >= 0`,
    ),
    check(
      'round_feedback_lease_check',
      sql`(${table.status} = 'leased' and ${table.leaseTokenDigest} ~ '^[0-9a-f]{64}$' and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'leased' and ${table.leaseTokenDigest} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      'round_feedback_result_check',
      sql`(${table.status} = 'succeeded') = (${table.feedback} is not null) and (${table.status} = 'leased') = (${table.completedAt} is null)`,
    ),
    index('round_feedback_lease_idx').on(table.status, table.leaseExpiresAt),
    index('round_feedback_created_idx').on(table.createdAt),
  ],
);
