import { pgTable, text } from 'drizzle-orm/pg-core';
import { users } from './users';
import { timestampColumn } from './columns';

/**
 * The Terms version a member accepted at the age step, and when (WAIT-4.6,
 * DEC-244). Private personal data, deleted with the account.
 */
export const accountTerms = pgTable('account_terms', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'restrict' }),
  termsVersion: text('terms_version').notNull(),
  acceptedAt: timestampColumn('accepted_at').notNull(),
});
