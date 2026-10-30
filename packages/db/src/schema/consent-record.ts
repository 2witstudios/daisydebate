import { check, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { oneOf, timestampColumn } from './columns';

/** Latest optional processing choices; exported and deleted with the account. */
export const consentRecord = pgTable(
  'consent_record',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    necessary: text('necessary').notNull(),
    analytics: text('analytics').notNull(),
    replay: text('replay').notNull(),
    recordedAt: timestampColumn('recorded_at').notNull(),
  },
  (t) => [
    check('consent_record_version', sql`${t.version} = 1`),
    check('consent_record_necessary', sql`${t.necessary} = 'granted'`),
    check(
      'consent_record_analytics',
      oneOf(t.analytics, ['granted', 'denied', 'unanswered']),
    ),
    check(
      'consent_record_replay',
      oneOf(t.replay, ['granted', 'denied', 'unanswered']),
    ),
  ],
);
