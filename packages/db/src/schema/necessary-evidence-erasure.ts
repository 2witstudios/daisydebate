import { sql } from 'drizzle-orm';
import { pgTable, text, integer, check, index } from 'drizzle-orm/pg-core';
import { timestampColumn, oneOf } from './columns';
/** Evidence-owned erasure propagation/routing outlives aggregates until confirmed anti-resurrection retirement. */
export const necessaryEvidenceErasureRequests = pgTable(
  'necessary_evidence_erasure_requests',
  {
    actorId: text('actor_id').primaryKey(),
    userId: text('user_id').notNull(),
    requestedAt: timestampColumn('requested_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    phase: text('phase')
      .$type<'pending' | 'propagated'>()
      .notNull()
      .default('pending'),
    propagatedAt: timestampColumn('propagated_at'),
    nextAttemptAt: timestampColumn('next_attempt_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    lastClaimedAt: timestampColumn('last_claimed_at'),
    attempts: integer('attempts').notNull().default(0),
    executionWorkerId: text('execution_worker_id'),
    executionEpoch: integer('execution_epoch').notNull().default(0),
    leaseDigest: text('lease_digest'),
    leaseExpiresAt: timestampColumn('lease_expires_at'),
  },
  (table) => [
    index('necessary_evidence_erasure_due_idx').on(
      table.nextAttemptAt,
      table.actorId,
    ),
    check(
      'necessary_evidence_erasure_ids_check',
      sql`${table.actorId} ~ '^[a-z0-9]{24}$' and ${table.userId} ~ '^[a-z0-9]{24}$' and (${table.executionWorkerId} is null or ${table.executionWorkerId} ~ '^[a-z0-9]{24}$')`,
    ),
    check(
      'necessary_evidence_erasure_phase_check',
      oneOf(table.phase, ['pending', 'propagated']),
    ),
    check(
      'necessary_evidence_erasure_propagation_check',
      sql`(${table.phase}='propagated')=(${table.propagatedAt} is not null)`,
    ),
    check(
      'necessary_evidence_erasure_execution_check',
      sql`${table.attempts}>=0 and ${table.executionEpoch}>=0 and ((${table.leaseDigest} is null)=(${table.leaseExpiresAt} is null)) and (${table.leaseDigest} is null or ${table.leaseDigest} ~ '^[a-f0-9]{64}$')`,
    ),
  ],
);
