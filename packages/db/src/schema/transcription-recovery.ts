import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, oneOf, timestampColumn } from './columns';
import { rounds } from './rounds';
import { necessaryEvidence } from './necessary-evidence';

/** Private recognition work. No provisional text, PCM or provider reply is stored here. */
export const transcriptionRecoveryContexts = pgTable(
  'transcription_recovery_contexts',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    segmentId: text('segment_id').notNull(),
    roundParticipantId: text('round_participant_id').notNull(),
    sourceKey: text('source_key').notNull(),
    startOffsetMs: integer('start_offset_ms').notNull(),
    durationMs: integer('duration_ms').notNull(),
    firstSequence: bigint('first_sequence', { mode: 'number' }).notNull(),
    lastSequence: bigint('last_sequence', { mode: 'number' }).notNull(),
    units: integer('units').notNull(),
    status: text('status')
      .$type<
        | 'collecting'
        | 'queued'
        | 'leased'
        | 'retry'
        | 'blocked'
        | 'selected'
        | 'erased'
        | 'expired'
      >()
      .notNull(),
    lastSourceAt: timestampColumn('last_source_at').notNull(),
    nextAttemptAt: timestampColumn('next_attempt_at').notNull().defaultNow(),
    lastClaimedAt: timestampColumn('last_claimed_at'),
    claimEpoch: integer('claim_epoch').notNull().default(0),
    workerId: text('worker_id'),
    leaseDigest: text('lease_digest'),
    leaseExpiresAt: timestampColumn('lease_expires_at'),
    attempts: integer('attempts').notNull().default(0),
    model: text('model'),
    policyDigest: text('policy_digest'),
    blockedReason: text('blocked_reason').$type<
      'provider' | 'budget' | 'quality' | 'privacy' | 'expired' | 'unreceived'
    >(),
    selectedRevision: integer('selected_revision'),
    selectedDigest: text('selected_digest'),
    selectedAt: timestampColumn('selected_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('transcription_recovery_round_idx').on(table.roundId),
    index('transcription_recovery_source_idx').on(
      table.sourceKey,
      table.createdAt,
    ),
    index('transcription_recovery_due_idx').on(table.nextAttemptAt, table.id),
    check(
      'transcription_recovery_status_check',
      oneOf(table.status, [
        'collecting',
        'queued',
        'leased',
        'retry',
        'blocked',
        'selected',
        'erased',
        'expired',
      ]),
    ),
    check(
      'transcription_recovery_source_check',
      sql`${table.sourceKey} ~ '^[a-f0-9]{64}$' and ${table.startOffsetMs}>=0 and ${table.durationMs} between 10 and 30000 and ${table.durationMs}%10=0 and ${table.units} between 1 and 128 and ${table.firstSequence}>=0 and ${table.lastSequence}>=${table.firstSequence} and ${table.lastSequence}<=9007199254740991 and (${table.lastSequence}::bigint-${table.firstSequence}+1)*10=${table.durationMs}`,
    ),
    check(
      'transcription_recovery_claim_check',
      sql`${table.claimEpoch}>=0 and ${table.attempts}>=0 and (
    (${table.status}='leased' and ${table.workerId} is not null and ${table.leaseDigest} is not null and ${table.leaseDigest} ~ '^[a-f0-9]{64}$' and ${table.leaseExpiresAt} is not null and ${table.claimEpoch}>0)
    or (${table.status}<>'leased' and ${table.leaseDigest} is null and ${table.leaseExpiresAt} is null))`,
    ),
    check(
      'transcription_recovery_model_check',
      sql`(${table.model} is null and ${table.policyDigest} is null and ${table.attempts}=0) or (${table.model} is not null and octet_length(${table.model}) between 1 and 256 and ${table.policyDigest} is not null and ${table.policyDigest} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'transcription_recovery_blocked_check',
      sql`(${table.status}='blocked')=(${table.blockedReason} is not null) and (${table.blockedReason} is null or ${oneOf(table.blockedReason, ['provider', 'budget', 'quality', 'privacy', 'expired', 'unreceived'])})`,
    ),
    check(
      'transcription_recovery_selection_check',
      sql`(${table.status}='selected' and ${table.selectedRevision} is not null and ${table.selectedRevision}>=0 and ${table.selectedDigest} is not null and ${table.selectedDigest} ~ '^[a-f0-9]{64}$' and ${table.selectedAt} is not null) or (${table.status}<>'selected' and ${table.selectedRevision} is null and ${table.selectedDigest} is null and ${table.selectedAt} is null)`,
    ),
  ],
);

/** Immutable original units, each ingested once. Context boundaries never rewrite their capture authority. */
export const transcriptionRecoverySources = pgTable(
  'transcription_recovery_sources',
  {
    evidenceId: text('evidence_id')
      .primaryKey()
      .references(() => necessaryEvidence.id, { onDelete: 'cascade' }),
    contextId: text('context_id')
      .notNull()
      .references(() => transcriptionRecoveryContexts.id, {
        onDelete: 'cascade',
      }),
    // Actual metadata enrollment only; historical NULL is never invented service history.
    enrolledAt: timestampColumn('enrolled_at'),
    sourceKey: text('source_key').notNull(),
    startOffsetMs: integer('start_offset_ms').notNull(),
    durationMs: integer('duration_ms').notNull(),
    firstSequence: bigint('first_sequence', { mode: 'number' }).notNull(),
    lastSequence: bigint('last_sequence', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('transcription_recovery_sources_context_idx').on(table.contextId),
    index('transcription_recovery_sources_run_idx').on(
      table.sourceKey,
      table.firstSequence,
    ),
    check(
      'transcription_recovery_sources_bounds_check',
      sql`${table.sourceKey} ~ '^[a-f0-9]{64}$' and ${table.startOffsetMs}>=0 and ${table.durationMs} between 10 and 30000 and ${table.durationMs}%10=0 and ${table.firstSequence}>=0 and ${table.lastSequence}>=${table.firstSequence} and ${table.lastSequence}<=9007199254740991 and (${table.lastSequence}::bigint-${table.firstSequence}+1)*10=${table.durationMs}`,
    ),
  ],
);
