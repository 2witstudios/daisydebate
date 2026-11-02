import { chosenStatuses } from '@daisy/protocol';
import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { contactActorColumn } from './contacts';

/**
 * The status a member chose (ADR 0098). No row means `online`. `offline` is
 * appearing offline: nobody else sees them, and nothing says they chose it.
 */
export const presenceSettings = pgTable(
  'presence_settings',
  {
    actorId: contactActorColumn('actor_id').primaryKey(),
    status: text('status').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    check(
      'presence_settings_status_check',
      oneOf(table.status, chosenStatuses),
    ),
  ],
);
