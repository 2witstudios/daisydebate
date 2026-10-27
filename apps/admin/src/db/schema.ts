/**
 * The admin app's own database (ADR 0076): operators, their passkeys and
 * sessions, and the hash-chained audit log. Nothing here references the
 * participant database; `daisy_admin_app` may only INSERT and SELECT the
 * audit tables (granted in the baseline migration).
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Date mode: drizzle's string mode relabels the driver's Date with the host
// offset (see packages/db columns.ts); the edge converts to UTC ISO.
const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });
const inList = (column: string, values: readonly string[]) =>
  sql.raw(`"${column}" in (${values.map((value) => `'${value}'`).join(', ')})`);

export const operatorRoles = ['owner', 'operator'] as const;
export const enrollmentModes = ['initial', 'additional', 'replace'] as const;
export const challengePurposes = ['register', 'authenticate'] as const;
export const auditKinds = [
  'enrollment.issued',
  'operator.enrolled',
  'auth.success',
  'auth.failure',
  'access.denied',
  'credential.revoked',
  'session.revoked',
] as const;

/** Closed detail vocabulary: never free text, never a credential. */
export const auditDetails = [
  'initial',
  'additional',
  'replace',
  'rate_limited',
  'challenge_invalid',
  'enrollment_invalid',
  'credential_unknown',
  'credential_duplicate',
  'verification_failed',
  'counter_regressed',
  'operator_disabled',
  'session_expired',
  'session_idle',
  'signed_out',
  'rotated',
  'replaced',
  'role',
  'approval_missing',
] as const;
export const operators = pgTable(
  'operators',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull(),
    createdAt: at('created_at').notNull(),
    disabledAt: at('disabled_at'),
    revision: integer('revision').notNull().default(1),
  },
  (table) => [
    check('operators_role_check', inList('role', operatorRoles)),
    check('operators_revision_positive', sql`${table.revision} >= 1`),
    // Exactly one active owner: the CLI refuses a second one.
    uniqueIndex('operators_one_active_owner')
      .on(table.role)
      .where(sql`${table.role} = 'owner' and ${table.disabledAt} is null`),
  ],
);

const operatorRef = () =>
  text('operator_id')
    .notNull()
    .references(() => operators.id, { onDelete: 'restrict' });

export const operatorCredentials = pgTable(
  'operator_credentials',
  {
    id: text('id').primaryKey(),
    operatorId: operatorRef(),
    credentialId: text('credential_id').notNull(),
    publicKey: text('public_key').notNull(),
    signCount: bigint('sign_count', { mode: 'number' }).notNull(),
    transports: text('transports').array().notNull(),
    backedUp: boolean('backed_up').notNull(),
    createdAt: at('created_at').notNull(),
    revokedAt: at('revoked_at'),
  },
  (table) => [
    uniqueIndex('operator_credentials_credential_id_unique').on(
      table.credentialId,
    ),
    index('operator_credentials_operator_idx').on(table.operatorId),
  ],
);

export const operatorEnrollments = pgTable(
  'operator_enrollments',
  {
    id: text('id').primaryKey(),
    operatorId: operatorRef(),
    tokenHash: text('token_hash').notNull(),
    mode: text('mode').notNull(),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    consumedAt: at('consumed_at'),
    revokedAt: at('revoked_at'),
  },
  (table) => [
    check('operator_enrollments_mode_check', inList('mode', enrollmentModes)),
    uniqueIndex('operator_enrollments_token_hash_unique').on(table.tokenHash),
    index('operator_enrollments_operator_idx').on(table.operatorId),
  ],
);

export const operatorChallenges = pgTable(
  'operator_challenges',
  {
    id: text('id').primaryKey(),
    purpose: text('purpose').notNull(),
    enrollmentId: text('enrollment_id').references(
      () => operatorEnrollments.id,
      { onDelete: 'restrict' },
    ),
    challengeHash: text('challenge_hash').notNull(),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    consumedAt: at('consumed_at'),
  },
  (table) => [
    check(
      'operator_challenges_purpose_check',
      inList('purpose', challengePurposes),
    ),
    // A register challenge is bound to one enrollment; a sign-in one to none.
    check(
      'operator_challenges_binding_check',
      sql`(${table.purpose} = 'register') = (${table.enrollmentId} is not null)`,
    ),
    uniqueIndex('operator_challenges_challenge_hash_unique').on(
      table.challengeHash,
    ),
    index('operator_challenges_enrollment_idx').on(table.enrollmentId),
  ],
);

export const operatorSessions = pgTable(
  'operator_sessions',
  {
    id: text('id').primaryKey(),
    operatorId: operatorRef(),
    tokenHash: text('token_hash').notNull(),
    createdAt: at('created_at').notNull(),
    lastSeenAt: at('last_seen_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    revokedAt: at('revoked_at'),
  },
  (table) => [
    uniqueIndex('operator_sessions_token_hash_unique').on(table.tokenHash),
    index('operator_sessions_operator_idx').on(table.operatorId),
  ],
);

/** Failed-authentication counts per (purpose, keyed IP digest, window). */
export const authAttempts = pgTable(
  'auth_attempts',
  {
    bucket: text('bucket').primaryKey(),
    count: integer('count').notNull(),
    windowStart: at('window_start').notNull(),
  },
  (table) => [
    check('auth_attempts_count_positive', sql`${table.count} >= 1`),
    index('auth_attempts_window_idx').on(table.windowStart),
  ],
);

/** Append-only for the runtime role; `hash` chains every row to the last. */
export const auditEvents = pgTable(
  'audit_events',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey(),
    id: text('id').notNull(),
    kind: text('kind').notNull(),
    operatorId: text('operator_id'),
    commandId: text('command_id'),
    targetUserId: text('target_user_id'),
    outcome: text('outcome'),
    detail: text('detail'),
    at: at('at').notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (table) => [
    check('audit_events_kind_check', inList('kind', auditKinds)),
    check(
      'audit_events_detail_check',
      sql`${table.detail} is null or ${inList('detail', auditDetails)}`,
    ),
    check('audit_events_seq_positive', sql`${table.seq} >= 1`),
    uniqueIndex('audit_events_id_unique').on(table.id),
  ],
);

/** The `prev_hash` the oldest retained row chains from, written on prune. */
export const chainCheckpoints = pgTable('chain_checkpoints', {
  seq: bigint('seq', { mode: 'number' }).primaryKey(),
  hash: text('hash').notNull(),
  at: at('at').notNull(),
});
