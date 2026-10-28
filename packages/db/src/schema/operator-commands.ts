import { operatorCommandResultSchema } from '@daisy/protocol/operator';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAtColumn, jsonbColumn, jsonbIsObject } from './columns';
import { users } from './users';

/**
 * Durable operator command identity (ADR 0076, ADR 0079): one receipt per
 * accepted signed operator command, no-ops included, written with the change
 * it records. Append-only for the runtime role. `action` names the command,
 * and `result` is that action's closed, non-personal result; the action's
 * owner writes and reads it.
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
    result: jsonbColumn('result', operatorCommandResultSchema).notNull(),
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
