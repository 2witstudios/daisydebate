import {
  betaAccessCommandResultSchema,
  betaAccessProvenances,
  betaAccessStates,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  oneOf,
  timestampColumn,
} from './columns';
import { users } from './users';

/**
 * An account's beta access (ADR 0075): one typed row per account that
 * claimed a username, created in the claim's transaction. Erasure deletes
 * the row, so a tombstone has no beta state. `revision` is the expected
 * revision operator commands carry.
 */
export const accountBetaAccess = pgTable(
  'account_beta_access',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    revision: integer('revision').notNull().default(1),
    requestedAt: timestampColumn('requested_at').notNull(),
    decidedAt: timestampColumn('decided_at'),
    provenance: text('provenance').notNull(),
  },
  (table) => [
    check(
      'account_beta_access_state_check',
      oneOf(table.state, betaAccessStates),
    ),
    check(
      'account_beta_access_provenance_check',
      oneOf(table.provenance, betaAccessProvenances),
    ),
    check('account_beta_access_revision_positive', sql`${table.revision} > 0`),
    check(
      'account_beta_access_decided_check',
      sql`(${table.state} = 'pending') = (${table.decidedAt} is null)`,
    ),
    index('account_beta_access_listing_idx').on(
      table.state,
      table.requestedAt,
      table.userId,
    ),
  ],
);

/**
 * The participant-side beta access audit (ADR 0075): append-only. The
 * runtime role may insert and read but never update or delete it.
 * `principal` is `signup`, `migration:<name>` or `operator:<service>/<ref>`.
 * Every beta foreign key cascades only because no production path deletes a
 * `users` row (erasure tombstones it, ADR 0029); test cleanups do.
 */
export const accountAccessEvents = pgTable(
  'account_access_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    commandId: text('command_id'),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    revision: integer('revision').notNull(),
    principal: text('principal').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    check(
      'account_access_events_from_check',
      sql`${table.fromState} is null or ${oneOf(table.fromState, betaAccessStates)}`,
    ),
    check(
      'account_access_events_to_check',
      oneOf(table.toState, betaAccessStates),
    ),
    check(
      'account_access_events_principal_check',
      sql`${table.principal} ~ '^(signup|migration:[a-z0-9_]+|operator:[a-z0-9-]+/[a-z0-9]{24})$'`,
    ),
    index('account_access_events_user_idx').on(table.userId, table.createdAt),
  ],
);

/**
 * Durable operator command identity (ADR 0076): one receipt per accepted
 * command, no-ops included, written with the change it records. Append-only
 * for the runtime role. `result` is the closed, non-personal command result.
 */
export const operatorCommandReceipts = pgTable(
  'operator_command_receipts',
  {
    commandId: text('command_id').primaryKey(),
    serviceId: text('service_id').notNull(),
    operatorRef: text('operator_ref').notNull(),
    action: text('action').notNull(),
    targetUserId: text('target_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestDigest: text('request_digest').notNull(),
    result: jsonbColumn('result', betaAccessCommandResultSchema).notNull(),
    adminAuditHead: text('admin_audit_head').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    check(
      'operator_command_receipts_digest_check',
      sql`${table.requestDigest} ~ '^[0-9a-f]{64}$' and ${table.adminAuditHead} ~ '^[0-9a-f]{64}$'`,
    ),
    jsonbIsObject('operator_command_receipts', table.result),
    index('operator_command_receipts_target_idx').on(table.targetUserId),
    index('operator_command_receipts_created_idx').on(table.createdAt),
  ],
);
