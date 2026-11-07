import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';

/** Signature-verified hints only. Raw payloads and customer contact data never enter this inbox. */
export const billingWebhookEvents = pgTable(
  'billing_webhook_events',
  {
    id: text('id').primaryKey(),
    vendorEventId: text('vendor_event_id').notNull(),
    vendorCustomerId: text('vendor_customer_id').notNull(),
    mode: text('mode').notNull(),
    receivedAt: timestampColumn('received_at').notNull().defaultNow(),
    notifiedAt: timestampColumn('notified_at'),
  },
  (table) => [
    uniqueIndex('billing_webhook_events_vendor_unique').on(
      table.mode,
      table.vendorEventId,
    ),
    index('billing_webhook_events_customer_idx').on(
      table.mode,
      table.vendorCustomerId,
    ),
    index('billing_webhook_events_pending_idx')
      .on(table.id)
      .where(sql`${table.notifiedAt} is null`),
    index('billing_webhook_events_retention_idx').on(
      table.receivedAt,
      table.id,
    ),
    check(
      'billing_webhook_events_mode_check',
      oneOf(table.mode, ['test', 'live']),
    ),
    check(
      'billing_webhook_events_identity_check',
      sql`${table.vendorEventId} ~ '^evt_[A-Za-z0-9]+$' and length(${table.vendorEventId})<=255 and ${table.vendorCustomerId} ~ '^cus_[A-Za-z0-9]+$' and length(${table.vendorCustomerId})<=255`,
    ),
    check(
      'billing_webhook_events_notification_check',
      sql`${table.notifiedAt} is null or ${table.notifiedAt} >= ${table.receivedAt}`,
    ),
  ],
);
