import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { transcriptionRecoveryContexts } from './transcription-recovery';
/** Conservative paid-call admission, not proof that the vendor received or billed a request. No candidate text. */
export const transcriptionRecoveryAttempts = pgTable(
  'transcription_recovery_attempts',
  {
    contextId: text('context_id')
      .notNull()
      .references(() => transcriptionRecoveryContexts.id, {
        onDelete: 'cascade',
      }),
    claimEpoch: integer('claim_epoch').notNull(),
    ordinal: integer('ordinal').notNull(),
    outcome: text('outcome')
      .$type<
        | 'admitted'
        | 'candidate'
        | 'provider_failure'
        | 'quality_review'
        | 'uncertain'
      >()
      .notNull(),
    admittedAt: timestampColumn('admitted_at').notNull(),
    completedAt: timestampColumn('completed_at'),
    candidateDigest: text('candidate_digest'),
    candidateBytes: integer('candidate_bytes'),
  },
  (table) => [
    primaryKey({ columns: [table.contextId, table.claimEpoch] }),
    unique('transcription_recovery_attempt_ordinal_unique').on(
      table.contextId,
      table.ordinal,
    ),
    index('transcription_recovery_attempt_context_idx').on(table.contextId),
    check(
      'transcription_recovery_attempt_bounds_check',
      sql`${table.claimEpoch}>0 and ${table.ordinal} between 1 and 64`,
    ),
    check(
      'transcription_recovery_attempt_outcome_check',
      oneOf(table.outcome, [
        'admitted',
        'candidate',
        'provider_failure',
        'quality_review',
        'uncertain',
      ]),
    ),
    check(
      'transcription_recovery_attempt_candidate_check',
      sql`(${table.candidateDigest} is null and ${table.candidateBytes} is null and ${table.outcome} not in ('candidate','quality_review')) or (${table.candidateDigest} is not null and ${table.candidateDigest} ~ '^[a-f0-9]{64}$' and ${table.candidateBytes} is not null and ${table.candidateBytes} between 0 and 65536 and ${table.outcome} in ('candidate','quality_review','uncertain'))`,
    ),
    check(
      'transcription_recovery_attempt_time_check',
      sql`(${table.outcome}='admitted' and ${table.completedAt} is null) or (${table.outcome}<>'admitted' and ${table.completedAt} is not null and ${table.completedAt}>=${table.admittedAt})`,
    ),
  ],
);
