import { chosenStatuses } from '@daisy/protocol';
import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { contactActorColumn } from './contacts';

/**
 * The status a member chose (ADR 0103). No row means `online`. `appearing_offline` is
 * appearing offline: nobody else sees them, and nothing says they chose it.
 */
export const presenceSettings = pgTable(
  'presence_settings',
  {
    actorId: contactActorColumn('actor_id').primaryKey(),
    chosenStatus: text('chosen_status').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    check(
      'presence_settings_chosen_status_check',
      oneOf(table.chosenStatus, chosenStatuses),
    ),
  ],
);
