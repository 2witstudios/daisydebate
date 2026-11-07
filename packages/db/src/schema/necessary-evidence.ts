import { sql } from 'drizzle-orm';
import { captureEvidenceSpeakerSchema } from '@daisy/protocol';
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  oneOf,
  timestampColumn,
  jsonbColumnNullable,
  jsonbIsObject,
} from './columns';
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
    /** Null means original subjects were not proven; never infer them from a successor cast. */
    originalSubjectActorIds: text('original_subject_actor_ids').array(),
    /** Null is unproven, never a current-cast backfill. */
    originalSpeaker: jsonbColumnNullable(
      'original_speaker',
      captureEvidenceSpeakerSchema,
    ),
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
    /** Original custody route, committed before acquisition; timestamps alone indicate a key receipt. */
    authorityId: text('authority_id'),
    receivedAt: timestampColumn('received_at'),
    expiresAt: timestampColumn('expires_at'),
    /** DB admission instant, exposed only after the atomic payload transaction commits. */
    payloadAcceptedAt: timestampColumn('payload_accepted_at'),
    ciphertext: encryptedBytes('ciphertext'),
    nonce: encryptedBytes('nonce'),
    tag: encryptedBytes('tag'),
    executionWorkerId: text('execution_worker_id'),
    executionEpoch: integer('execution_epoch').notNull().default(0),
    leaseDigest: text('lease_digest'),
    leaseExpiresAt: timestampColumn('lease_expires_at'),
    nextAttemptAt: timestampColumn('next_attempt_at').notNull().defaultNow(),
    lastClaimedAt: timestampColumn('last_claimed_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    jsonbIsObject('necessary_evidence', table.originalSpeaker),
    index('necessary_evidence_round_idx').on(table.roundId),
    index('necessary_evidence_original_round_idx').on(table.originalRoundId),
    index('necessary_evidence_subjects_idx').using(
      'gin',
      table.originalSubjectActorIds,
    ),
    check(
      'necessary_evidence_speaker_check',
      sql`${table.originalSpeaker} is null or (jsonb_typeof(${table.originalSpeaker})='object' and octet_length(${table.originalSpeaker}::text)<=512)`,
    ),
    check(
      'necessary_evidence_subjects_check',
      sql`${table.originalSubjectActorIds} is null or (
      cardinality(${table.originalSubjectActorIds}) between 0 and 257 and (cardinality(${table.originalSubjectActorIds})=0 or (
        array_ndims(${table.originalSubjectActorIds})=1 and array_lower(${table.originalSubjectActorIds},1)=1
        and array_position(${table.originalSubjectActorIds},null) is null
        and array_to_string(${table.originalSubjectActorIds},',') ~ '^[a-z0-9]{24}(,[a-z0-9]{24})*$'
      )))`,
    ),
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
      'necessary_evidence_authority_check',
      sql`${table.authorityId} is null or ${table.authorityId} ~ '^[a-z0-9]{24}$'`,
    ),
    check(
      'necessary_evidence_receipt_check',
      sql`(
    ${table.receivedAt} is null and ${table.expiresAt} is null
  ) or (
    ${table.authorityId} is not null and ${table.receivedAt} is not null and ${table.expiresAt} is not null
    and ${table.expiresAt}=${table.receivedAt}+interval '168 hours'
  )`,
    ),
    check(
      'necessary_evidence_acceptance_check',
      sql`(${table.state}<>'retained' or ${table.payloadAcceptedAt} is not null)
      and (${table.payloadAcceptedAt} is null or (${table.receivedAt} is not null
      and ${table.payloadAcceptedAt}>=${table.receivedAt} and ${table.payloadAcceptedAt}<${table.expiresAt}))`,
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
      'necessary_evidence_execution_worker_check',
      sql`${table.executionWorkerId} is null or ${table.executionWorkerId} ~ '^[a-z0-9]{24}$'`,
    ),
    check(
      'necessary_evidence_lease_check',
      sql`(${table.leaseDigest} is null) = (${table.leaseExpiresAt} is null)`,
    ),
  ],
);
