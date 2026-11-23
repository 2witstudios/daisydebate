import { sql } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { mailJobChecks, mailJobColumns, timestampColumn } from './columns';
import { users } from './users';

export const messagingUnreadEmailErrorCodes = [
  'delivery',
  'delivery-unknown',
  'suppressed',
  'recipient-gone',
  'not-owed',
  'unconfigured',
] as const;

/**
 * One member's email about messages they have not read (ADR 0144), owned by
 * Messaging: a message to them queues it, and each later one pushes its send
 * back to a quiet time after itself, never past a longest wait after the
 * first. At send time it counts the conversations still unread, and is
 * cancelled `not-owed` when none are. It holds no address, body, sender or
 * conversation: the email says only how many conversations wait. At most one
 * is queued per member. `id` is the provider idempotency key.
 */
export const messagingUnreadEmails = pgTable(
  'messaging_unread_emails',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** When its first unread message arrived: the longest wait counts from here. */
    firstOwedAt: timestampColumn('first_owed_at').notNull(),
    ...mailJobColumns<typeof messagingUnreadEmailErrorCodes>(),
  },
  (table) => [
    uniqueIndex('messaging_unread_emails_one_queued')
      .on(table.userId)
      .where(sql`${table.state} = 'queued'`),
    index('messaging_unread_emails_due_idx').on(
      table.state,
      table.nextAttemptAt,
    ),
    index('messaging_unread_emails_user_idx').on(
      table.userId,
      table.completedAt,
    ),
    index('messaging_unread_emails_completed_idx').on(table.completedAt),
    ...mailJobChecks(
      'messaging_unread_emails',
      table,
      messagingUnreadEmailErrorCodes,
    ),
  ],
);
