import { roundAnalysisReportSchema } from '@daisy/protocol';
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
import { roundParticipants } from './round-participants';
import { rounds } from './rounds';
import { roundTranscriptFreezes } from './round-transcript-freezes';

export const roundAnalysisStatuses = ['leased', 'succeeded', 'failed'] as const;

/**
 * One round analysis per debater seat of a completed Round (DEC-247): the
 * job and its report in one row, bound to the frozen transcript revision it
 * read. The row exists from its first claim; a lease bounds each paid
 * attempt and `attempts` caps them. Usage is kept here, since no Round seat
 * runs it. It never refers to a ballot.
 */
export const roundAnalyses = pgTable(
  'round_analyses',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    /** A seat belongs to one Round, so it keys the row on its own. */
    roundParticipantId: text('round_participant_id')
      .primaryKey()
      .references(() => roundParticipants.id, { onDelete: 'cascade' }),
    freezeRevision: integer('freeze_revision').notNull(),
    status: text('status')
      .$type<(typeof roundAnalysisStatuses)[number]>()
      .notNull(),
    attempts: integer('attempts').notNull(),
    leaseTokenDigest: text('lease_token_digest'),
    leaseExpiresAt: timestampColumn('lease_expires_at'),
    model: text('model').notNull(),
    /** The seat's report; it reaches only that seat's debater. */
    report: jsonbColumnNullable('report', roundAnalysisReportSchema),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    completedAt: timestampColumn('completed_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({
      name: 'round_analyses_freeze_revision_fk',
      columns: [table.roundId, table.freezeRevision],
      foreignColumns: [
        roundTranscriptFreezes.roundId,
        roundTranscriptFreezes.revision,
      ],
    }).onDelete('cascade'),
    jsonbIsObject('round_analyses', table.report),
    check(
      'round_analyses_status_check',
      oneOf(table.status, roundAnalysisStatuses),
    ),
    check(
      'round_analyses_attempts_check',
      sql`${table.attempts} > 0 and ${table.inputTokens} >= 0 and ${table.outputTokens} >= 0`,
    ),
    check(
      'round_analyses_lease_check',
      sql`(${table.status} = 'leased' and ${table.leaseTokenDigest} ~ '^[0-9a-f]{64}$' and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'leased' and ${table.leaseTokenDigest} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      'round_analyses_result_check',
      sql`(${table.status} = 'succeeded') = (${table.report} is not null) and (${table.status} = 'leased') = (${table.completedAt} is null)`,
    ),
    index('round_analyses_freeze_revision_idx').on(
      table.roundId,
      table.freezeRevision,
    ),
    index('round_analyses_participant_idx').on(
      table.roundParticipantId,
      table.completedAt,
    ),
    index('round_analyses_lease_idx').on(table.status, table.leaseExpiresAt),
    index('round_analyses_created_idx').on(table.createdAt),
  ],
);
