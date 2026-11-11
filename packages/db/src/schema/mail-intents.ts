import { sql } from 'drizzle-orm';
import { check, index, pgTable, text } from 'drizzle-orm/pg-core';
import {
  mailJobChecks,
  mailJobColumns,
  oneOf,
  timestampColumn,
} from './columns';
import { users } from './users';
import { betaPreapprovals } from './beta-preapprovals';

export const mailIntentPurposes = [
  'beta-invitation',
  'beta-approved',
  'beta-requests-digest',
] as const;
export const mailIntentErrorCodes = [
  'delivery',
  'delivery-unknown',
  'suppressed',
  'recipient-gone',
  'unconfigured',
  'not-owed',
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
    preapprovalId: text('preapproval_id').references(
      () => betaPreapprovals.id,
      { onDelete: 'set null' },
    ),
    dedupeKey: text('dedupe_key').notNull().unique(),
    /** A digest's UTC window start: the accounts it counts joined in this window. */
    windowStart: timestampColumn('window_start'),
    ...mailJobColumns(),
  },
  (table) => [
    check(
      'mail_intents_purpose_check',
      oneOf(table.purpose, mailIntentPurposes),
    ),
    check(
      'mail_intents_preapproval_recipient_check',
      sql`(${table.purpose} = 'beta-invitation' and (${table.preapprovalId} is not null or ${table.state} in ('sent', 'failed', 'cancelled'))) or (${table.purpose} <> 'beta-invitation' and ${table.preapprovalId} is null)`,
    ),
    check(
      'mail_intents_recipient_check',
      sql`(${table.purpose} = 'beta-approved') = (${table.recipientUserId} is not null)`,
    ),
    check(
      'mail_intents_window_check',
      sql`(${table.purpose} = 'beta-requests-digest') = (${table.windowStart} is not null)`,
    ),
    ...mailJobChecks('mail_intents', table, mailIntentErrorCodes),
    index('mail_intents_preapproval_idx').on(table.preapprovalId),
    index('mail_intents_due_idx').on(table.state, table.nextAttemptAt),
    index('mail_intents_recipient_idx').on(table.recipientUserId),
    index('mail_intents_completed_idx').on(table.completedAt),
  ],
);
