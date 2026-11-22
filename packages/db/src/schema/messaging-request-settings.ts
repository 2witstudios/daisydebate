import { messageRequestSettings } from '@daisy/protocol/messaging/social';
import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { oneOf, updatedAtColumn } from './columns';
import { users } from './users';

/**
 * Who may send a member a new message request (decision 90, ADR 0160). A
 * member with no row takes requests from everyone. The setting gates new
 * requests only; it never closes a conversation already accepted.
 */
export const messagingRequestSettings = pgTable(
  'messaging_request_settings',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    setting: text('setting').notNull(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    check(
      'messaging_request_settings_setting',
      oneOf(table.setting, messageRequestSettings),
    ),
  ],
);
