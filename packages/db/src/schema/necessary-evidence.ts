import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, oneOf, timestampColumn } from './columns';
import { rounds } from './rounds';

const encryptedBytes = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});
/** Evidence-owned intent precedes custody. Routing survives aggregate erasure until confirmed cleanup. */
export const necessaryEvidence = pgTable(
  'necessary_evidence',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id').references(() => rounds.id, {
      onDelete: 'set null',
    }),
    // Original scope is routing/provenance, not a successor's capture authority.
    originalRoundId: text('original_round_id').notNull(),
    sessionId: text('session_id').notNull(),
    segmentId: text('segment_id').notNull(),
    roundParticipantId: text('round_participant_id').notNull(),
    workerId: text('worker_id').notNull(),
    captureEpoch: integer('capture_epoch').notNull(),
    bindingDigest: text('binding_digest').notNull(),
    state: text('state')
      .$type<'acquiring' | 'retained' | 'retiring' | 'retired'>()
      .notNull()
      .default('acquiring'),
    retirementReason: text('retirement_reason').$type<
      'settled' | 'erased' | 'expired' | 'unreceived'
    >(),
    /** Reserved before custody, released only once payload is cleared and work is fenced. */
    reservedBytes: integer('reserved_bytes').notNull(),
    authorityId: text('authority_id'),
    receivedAt: timestampColumn('received_at'),
    expiresAt: timestampColumn('expires_at'),
    ciphertext: encryptedBytes('ciphertext'),
    nonce: encryptedBytes('nonce'),
    tag: encryptedBytes('tag'),
    executionEpoch: integer('execution_epoch').notNull().default(0),
    leaseDigest: text('lease_digest'),
    leaseExpiresAt: timestampColumn('lease_expires_at'),
    nextAttemptAt: timestampColumn('next_attempt_at').notNull().defaultNow(),
    lastClaimedAt: timestampColumn('last_claimed_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('necessary_evidence_round_idx').on(table.roundId),
    index('necessary_evidence_due_idx').on(table.nextAttemptAt, table.id),
    check(
      'necessary_evidence_state_check',
      oneOf(table.state, ['acquiring', 'retained', 'retiring', 'retired']),
    ),
    check(
      'necessary_evidence_retirement_check',
      sql`(${table.state} in ('retiring','retired')) = (${table.retirementReason} is not null)`,
    ),
    check(
      'necessary_evidence_reason_check',
      sql`${table.retirementReason} is null or ${table.retirementReason} in ('settled','erased','expired','unreceived')`,
    ),
    check(
      'necessary_evidence_bounds_check',
      sql`${table.captureEpoch}>0 and ${table.executionEpoch}>=0 and ${table.reservedBytes} between 0 and 65536`,
    ),
    check(
      'necessary_evidence_binding_check',
      sql`${table.bindingDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'necessary_evidence_receipt_check',
      sql`(
    ${table.authorityId} is null and ${table.receivedAt} is null and ${table.expiresAt} is null
  ) or (
    ${table.authorityId} is not null and ${table.receivedAt} is not null and ${table.expiresAt} is not null
    and ${table.expiresAt}=${table.receivedAt}+interval '168 hours'
  )`,
    ),
    check(
      'necessary_evidence_payload_check',
      sql`(
    ${table.state}='retained' and ${table.roundId} is not null and ${table.authorityId} is not null
    and ${table.ciphertext} is not null and octet_length(${table.ciphertext}) between 1 and 65536
    and ${table.reservedBytes}=octet_length(${table.ciphertext})
    and ${table.nonce} is not null and octet_length(${table.nonce})=12
    and ${table.tag} is not null and octet_length(${table.tag})=16
  ) or (
    ${table.state}<>'retained' and ${table.ciphertext} is null and ${table.nonce} is null and ${table.tag} is null
    and ((${table.state}='acquiring' and ${table.reservedBytes}>0) or (${table.state} in ('retiring','retired') and ${table.reservedBytes}=0))
  )`,
    ),
    check(
      'necessary_evidence_round_binding_check',
      sql`${table.roundId} is null or ${table.roundId}=${table.originalRoundId}`,
    ),
    check(
      'necessary_evidence_lease_check',
      sql`(${table.leaseDigest} is null) = (${table.leaseExpiresAt} is null)`,
    ),
  ],
);
