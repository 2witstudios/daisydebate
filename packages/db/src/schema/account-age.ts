import { sql } from 'drizzle-orm';
import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { users } from './users';
import { timestampColumn, versionColumn, versionPositive } from './columns';
/** WAIT-4.1a: collection is separately held; the source is private personal data. */
export const accountAge = pgTable(
  'account_age',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'restrict' }),
    birthMonth: text('birth_month').notNull(),
    version: versionColumn(),
    recordedAt: timestampColumn('recorded_at').notNull(),
  },
  (table) => [
    versionPositive('account_age', table.version),
    check(
      'account_age_birth_month_shape',
      sql`${table.birthMonth} ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'`,
    ),
  ],
);
