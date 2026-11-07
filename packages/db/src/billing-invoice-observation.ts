import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  billingPaymentObservationSchema,
  retainPaymentObservationSource,
  type OwnedInvoiceObservation,
  type PaymentObservationContext,
} from '@daisy/protocol/billing';
import type { BoundedTransactionContext } from './transaction-context';
import { billingPaymentObservations } from './schema/billing-payment-observations';
import {
  paymentObservationFromRow,
  paymentObservationValues,
} from './billing-payment-observation-record';
import { readDatabaseTime } from './database-clock';

/** Caller owns canonical account/job authority; its progress and this exact witness share the transaction. */
export async function retainInvoiceWitness(
  tx: BoundedTransactionContext,
  input: {
    readonly read: OwnedInvoiceObservation;
    readonly context: PaymentObservationContext;
    readonly nextId: () => string;
  },
) {
  const { read, context } = input;
  const fresh = billingPaymentObservationSchema.parse({
    ...read,
    id: input.nextId(),
    userId: context.userId,
    kind: 'invoice',
    closedAt: context.closedAt,
    createdAt: context.now,
    observedAt: context.now,
    state: { kind: 'owed', reason: 'enumeration_unavailable' },
  });
  await tx
    .insert(billingPaymentObservations)
    .values(paymentObservationValues(fresh))
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(billingPaymentObservations)
    .where(
      and(
        eq(billingPaymentObservations.mode, fresh.mode),
        eq(billingPaymentObservations.vendorInvoiceId, fresh.invoiceId),
        eq(billingPaymentObservations.kind, 'invoice'),
      ),
    )
    .for('update');
  if (!row) throw createAppError('CONFLICT');
  const retained = paymentObservationFromRow(row);
  if (
    retained.userId !== context.userId ||
    retained.customerId !== read.customerId ||
    retained.closedAt !== context.closedAt
  )
    throw createAppError('CONFLICT');
  const now = (await readDatabaseTime(tx)).toISOString();
  const merged = retainPaymentObservationSource(retained, read.source, {
    ...context,
    now,
  });
  if (merged.kind !== 'recorded') throw createAppError('CONFLICT');
  if (
    JSON.stringify({ source: retained.source, state: retained.state }) ===
    JSON.stringify({
      source: merged.observation.source,
      state: merged.observation.state,
    })
  )
    return retained;
  await tx
    .update(billingPaymentObservations)
    .set({
      source: merged.observation.source,
      state: merged.observation.state,
      observedAt: new Date(merged.observation.observedAt),
    })
    .where(eq(billingPaymentObservations.id, retained.id));
  return merged.observation;
}

/** A new execution pass retires historical enumeration coverage without changing financial observations. */
export async function rearmInvoiceWitness(
  tx: BoundedTransactionContext,
  value: Awaited<ReturnType<typeof retainInvoiceWitness>>,
) {
  if (value.kind !== 'invoice' || value.state.kind !== 'resolved') return value;
  const now = await readDatabaseTime(tx);
  const next = billingPaymentObservationSchema.parse({
    ...value,
    observedAt: now.toISOString(),
    state: { kind: 'owed', reason: 'enumeration_unavailable' },
  });
  await tx
    .update(billingPaymentObservations)
    .set({ state: next.state, observedAt: now })
    .where(eq(billingPaymentObservations.id, value.id));
  return next;
}
