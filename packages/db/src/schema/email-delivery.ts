import {
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

/**
 * Diagnostic mail state. Recipients appear only as a keyed hash and provider
 * webhook payloads are never stored: only message/event IDs and safe status.
 */
export const emailDeliveries = pgTable(
  'email_delivery',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    providerMessageId: text('provider_message_id').notNull(),
    recipientHash: text('recipient_hash').notNull(),
    status: text('status').notNull(),
    /** Monotonic: an out-of-order event can never lower it. */
    statusRank: smallint('status_rank').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('email_delivery_provider_message_unique').on(
      table.providerMessageId,
    ),
    index('email_delivery_recipient_idx').on(table.recipientHash),
  ],
);

/** Webhook event dedupe; rows are retained 30 days (AUTH-7.5). */
export const emailDeliveryEvents = pgTable(
  'email_delivery_event',
  {
    providerEventId: text('provider_event_id').primaryKey(),
    providerMessageId: text('provider_message_id').notNull(),
    receivedAt: timestamp('received_at', {
      withTimezone: true,
      mode: 'string',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('email_delivery_event_received_idx').on(table.receivedAt)],
);

/** Hard bounces and complaints stop automatic resend loops. */
export const emailSuppressions = pgTable('email_suppression', {
  recipientHash: text('recipient_hash').primaryKey(),
  reason: text('reason').notNull(),
  providerMessageId: text('provider_message_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});
