import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAtColumn, oneOf, timestampColumn } from './columns';
import { users } from './users';

export const mailIntentPurposes = [
  'beta-approved',
  'beta-requests-digest',
] as const;
export const mailIntentStates = [
  'queued',
  'leased',
  'sent',
  'failed',
  'cancelled',
] as const;

/**
 * Durable mail to send (ADR 0075): written in the transaction that decides
 * the mail is owed, sent later by the web mail worker under a lease. It
 * never stores an address or body; the recipient is resolved at send time,
 * so an erased account's intent is cancelled, not delivered. `id` is the
 * provider idempotency key, so a send retried after a crash is not doubled.
 */
export const mailIntents = pgTable(
  'mail_intents',
  {
    id: text('id').primaryKey(),
    purpose: text('purpose').notNull(),
    recipientUserId: text('recipient_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    dedupeKey: text('dedupe_key').notNull().unique(),
    /** A digest's UTC window start: the accounts it counts joined in this window. */
    windowStart: timestampColumn('window_start'),
    state: text('state').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    leaseTokenDigest: text('lease_token_digest'),
    leaseExpiresAt: timestampColumn('lease_expires_at'),
    nextAttemptAt: timestampColumn('next_attempt_at').notNull(),
    lastErrorCode: text('last_error_code'),
    createdAt: createdAtColumn(),
    completedAt: timestampColumn('completed_at'),
  },
  (table) => [
    check(
      'mail_intents_purpose_check',
      oneOf(table.purpose, mailIntentPurposes),
    ),
    check('mail_intents_state_check', oneOf(table.state, mailIntentStates)),
    check(
      'mail_intents_recipient_check',
      sql`(${table.purpose} = 'beta-approved') = (${table.recipientUserId} is not null)`,
    ),
    check(
      'mail_intents_window_check',
      sql`(${table.purpose} = 'beta-requests-digest') = (${table.windowStart} is not null)`,
    ),
    check('mail_intents_attempts_check', sql`${table.attempts} >= 0`),
    check(
      'mail_intents_lease_check',
      sql`(${table.state} = 'leased') = (${table.leaseTokenDigest} is not null and ${table.leaseExpiresAt} is not null) and (${table.leaseTokenDigest} is null or ${table.leaseTokenDigest} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      'mail_intents_completed_check',
      sql`(${table.state} in ('sent', 'failed', 'cancelled')) = (${table.completedAt} is not null)`,
    ),
    check(
      'mail_intents_error_check',
      sql`${table.lastErrorCode} is null or ${table.lastErrorCode} in ('delivery', 'suppressed', 'recipient-gone', 'unconfigured', 'not-owed')`,
    ),
    index('mail_intents_due_idx').on(table.state, table.nextAttemptAt),
    index('mail_intents_recipient_idx').on(table.recipientUserId),
    index('mail_intents_completed_idx').on(table.completedAt),
  ],
);
