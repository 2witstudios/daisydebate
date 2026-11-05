import { flagStates } from '@daisy/protocol/flags';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, oneOf, timestampColumn } from './columns';
import { users } from './users';

/** One revision serializes every state or targeting change for a flag. */
export const releaseFlags = pgTable(
  'release_flags',
  {
    key: text('key').primaryKey(),
    state: text('state').notNull(),
    revision: integer('revision').notNull(),
  },
  (table) => [
    check(
      'release_flags_key_check',
      sql`${table.key} ~ '^[a-z][a-z0-9-]{1,63}$'`,
    ),
    check('release_flags_state_check', oneOf(table.state, flagStates)),
    check('release_flags_revision_check', sql`${table.revision} > 0`),
  ],
);

export const flagAccountOverrides = pgTable(
  'flag_account_overrides',
  {
    key: text('key')
      .notNull()
      .references(() => releaseFlags.key),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull(),
    expiresAt: timestampColumn('expires_at').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.userId] }),
    index('flag_account_overrides_user_idx').on(table.userId),
    index('flag_account_overrides_expiry_idx').on(table.expiresAt),
    check(
      'flag_account_overrides_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

/** Append-only at runtime; no target account or override value in this audit. */
export const flagChangeEvents = pgTable(
  'flag_change_events',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    revision: integer('revision').notNull(),
    commandId: text('command_id').notNull(),
    change: text('change').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    check(
      'flag_change_events_change_check',
      oneOf(table.change, ['state', 'override']),
    ),
    check('flag_change_events_revision_check', sql`${table.revision} > 0`),
    index('flag_change_events_key_idx').on(table.key, table.revision),
    index('flag_change_events_created_idx').on(table.createdAt),
  ],
);
