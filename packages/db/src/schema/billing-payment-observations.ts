import {
  billingPaymentObservationStateSchema,
  paymentObservationSourceSchema,
} from '@daisy/protocol/billing';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonbColumn, jsonbIsObject, oneOf, timestampColumn } from './columns';
import { users } from './users';
import { billingRefundActions } from './billing-refund-actions';
import {
  paymentObservationSourceCheck,
  paymentObservationStateCheck,
} from './billing-payment-observation-checks';

/** Retained financial observations carry no execution claim or refund creation authority. */
export const billingPaymentObservations = pgTable(
  'billing_payment_observations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    mode: text('mode').notNull(),
    vendorCustomerId: text('vendor_customer_id').notNull(),
    vendorInvoiceId: text('vendor_invoice_id').notNull(),
    kind: text('kind').notNull(),
    vendorInvoicePaymentId: text('vendor_invoice_payment_id'),
    refundActionId: text('refund_action_id').references(
      () => billingRefundActions.id,
      { onDelete: 'restrict' },
    ),
    source: jsonbColumn('source', paymentObservationSourceSchema).notNull(),
    state: jsonbColumn('state', billingPaymentObservationStateSchema).notNull(),
    closedAt: timestampColumn('closed_at').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    observedAt: timestampColumn('observed_at').notNull(),
  },
  (table) => [
    uniqueIndex('billing_payment_observations_invoice_unique')
      .on(table.mode, table.vendorInvoiceId)
      .where(sql`${table.kind}='invoice'`),
    uniqueIndex('billing_payment_observations_payment_unique')
      .on(table.mode, table.vendorInvoicePaymentId)
      .where(sql`${table.kind}='payment'`),
    index('billing_payment_observations_user_idx').on(table.userId, table.id),
    index('billing_payment_observations_route_idx').on(
      table.mode,
      table.vendorCustomerId,
      table.id,
    ),
    index('billing_payment_observations_invoice_idx').on(
      table.mode,
      table.vendorInvoiceId,
      table.id,
    ),
    index('billing_payment_observations_refund_idx').on(table.refundActionId),
    check(
      'billing_payment_observations_mode_check',
      oneOf(table.mode, ['test', 'live']),
    ),
    check(
      'billing_payment_observations_identity_check',
      sql`coalesce(${table.id} ~ '^[a-z0-9]{24}$'
      and ${table.vendorCustomerId} ~ '^cus_[A-Za-z0-9_]+$' and length(${table.vendorCustomerId})<=255
      and ${table.vendorInvoiceId} ~ '^in_[A-Za-z0-9_]+$' and length(${table.vendorInvoiceId})<=255
      and case ${table.kind} when 'invoice' then ${table.vendorInvoicePaymentId} is null and ${table.refundActionId} is null
        when 'payment' then ${table.vendorInvoicePaymentId} ~ '^inpay_[A-Za-z0-9_]+$' and length(${table.vendorInvoicePaymentId})<=255
        else false end,false)`,
    ),
    check(
      'billing_payment_observations_time_check',
      sql`${table.closedAt}<=${table.createdAt} and ${table.createdAt}<=${table.observedAt}`,
    ),
    jsonbIsObject('billing_payment_observations', table.source),
    jsonbIsObject('billing_payment_observations', table.state),
    check(
      'billing_payment_observations_source_check',
      paymentObservationSourceCheck(table),
    ),
    check(
      'billing_payment_observations_state_check',
      paymentObservationStateCheck(table),
    ),
  ],
);
