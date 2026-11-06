import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, index } from 'drizzle-orm/pg-core';
import { createdAtColumn, timestampColumn } from './columns';
import { users } from './users';
export const betaPreapprovals = pgTable(
  'beta_preapprovals',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    revision: integer('revision').notNull().default(1),
    claimedUserId: text('claimed_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    claimedAt: timestampColumn('claimed_at'),
    lastInvitedAt: timestampColumn('last_invited_at'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    check(
      'beta_preapprovals_email_normalized',
      sql`${t.email} = lower(btrim(${t.email})) and length(${t.email}) between 3 and 320`,
    ),
    check('beta_preapprovals_revision_positive', sql`${t.revision} > 0`),
    check(
      'beta_preapprovals_claim_check',
      sql`(${t.claimedUserId} is null) = (${t.claimedAt} is null)`,
    ),
    index('beta_preapprovals_claimed_idx').on(t.claimedUserId),
  ],
);
