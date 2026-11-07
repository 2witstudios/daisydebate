import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  applyPaymentObservationRead,
  billingPaymentObservationSchema,
  unknownPaymentFacts,
  type BillingPaymentObservation,
  type OwnedPaymentObservation,
  type PaymentObservationContext,
} from '@daisy/protocol/billing';
import type { BoundedTransactionContext } from './transaction-context';
import { billingPaymentObservations } from './schema/billing-payment-observations';
import { billingRefundActions } from './schema/billing-refund-actions';
import { refundFromRow } from './billing-refund-authority';
import {
  paymentObservationFromRow,
  paymentObservationValues,
} from './billing-payment-observation-record';
import { linkObservedRefund } from './billing-observation-refund';
import { readDatabaseTime } from './database-clock';

/** Caller owns account/job fences; replay never refreshes an observation's recognition time. */
export async function writePaymentObservation(
  tx: BoundedTransactionContext,
  input: {
    readonly read: OwnedPaymentObservation;
    readonly context: PaymentObservationContext;
    readonly nextId: () => string;
  },
) {
  const { read } = input;
  const [existing] = await tx
    .select()
    .from(billingPaymentObservations)
    .where(
      and(
        eq(billingPaymentObservations.mode, read.mode),
        eq(
          billingPaymentObservations.vendorInvoicePaymentId,
          read.invoicePaymentId,
        ),
      ),
    )
    .for('update');
  const value = existing
    ? paymentObservationFromRow(existing)
    : newPaymentObservation(input);
  if (
    value.userId !== input.context.userId ||
    value.closedAt !== input.context.closedAt
  )
    return { kind: 'refuse' } as const;
  const action = await originalAction(tx, read);
  const now = (await readDatabaseTime(tx)).toISOString();
  const applied = applyPaymentObservationRead(
    value,
    read,
    { ...input.context, now },
    action ? refundFromRow(action) : undefined,
  );
  if (applied.kind !== 'recorded') return applied;
  // First recognition is the final post-lock sample, not the earlier candidate construction.
  const next = existing
    ? applied.observation
    : { ...applied.observation, createdAt: applied.observation.observedAt };
  const unchanged = Boolean(existing) && sameKnowledge(value, next);
  if (!unchanged) await persistPaymentObservation(tx, next, Boolean(existing));
  const linked = await linkObservedRefund(tx, next, input);
  return unchanged && linked === next
    ? ({ kind: 'unchanged', observation: value } as const)
    : ({ kind: 'recorded', observation: linked } as const);
}

function newPaymentObservation(
  input: Parameters<typeof writePaymentObservation>[1],
) {
  const { evidence: _evidence, ...identity } = input.read;
  void _evidence;
  return billingPaymentObservationSchema.parse({
    ...identity,
    id: input.nextId(),
    userId: input.context.userId,
    kind: 'payment',
    refundActionId: null,
    closedAt: input.context.closedAt,
    createdAt: input.context.now,
    observedAt: input.context.now,
    state: {
      kind: 'owed',
      reason: 'payment_unresolved',
      evidence: { kind: 'partial', facts: unknownPaymentFacts() },
    },
  });
}
function knowledge(value: BillingPaymentObservation) {
  return {
    source: value.source,
    state: value.state,
    refundActionId: value.kind === 'payment' ? value.refundActionId : null,
  };
}
function sameKnowledge(
  before: BillingPaymentObservation,
  after: BillingPaymentObservation,
) {
  return JSON.stringify(knowledge(before)) === JSON.stringify(knowledge(after));
}
async function originalAction(
  tx: BoundedTransactionContext,
  read: OwnedPaymentObservation,
) {
  if (read.evidence.kind !== 'verified') return null;
  const [action] = await tx
    .select()
    .from(billingRefundActions)
    .where(
      and(
        eq(billingRefundActions.mode, read.mode),
        eq(billingRefundActions.vendorChargeId, read.evidence.payment.chargeId),
      ),
    )
    .for('update');
  return action;
}

async function persistPaymentObservation(
  tx: BoundedTransactionContext,
  next: BillingPaymentObservation,
  existing: boolean,
) {
  if (existing) {
    await tx
      .update(billingPaymentObservations)
      .set({
        source: next.source,
        state: next.state,
        refundActionId: next.kind === 'payment' ? next.refundActionId : null,
        observedAt: new Date(next.observedAt),
      })
      .where(eq(billingPaymentObservations.id, next.id));
  } else {
    // A different closed account can race the same vendor identity; never adopt its row.
    const inserted = await tx
      .insert(billingPaymentObservations)
      .values(paymentObservationValues(next))
      .onConflictDoNothing()
      .returning({ id: billingPaymentObservations.id });
    if (inserted.length !== 1) throw createAppError('CONFLICT');
  }
}
