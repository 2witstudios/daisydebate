import { eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  advanceCleanup,
  recordInvoiceEnumeration,
  headRetention,
  ownsCleanupClaim,
  type InvoicePass,
  type CleanupWork,
  type BillingPaymentObservation,
} from '@daisy/protocol/billing';
import type { BoundedTransactionContext } from './transaction-context';
import { cleanupFacts, cleanupContext } from './billing-cleanup-authority';
import { currentPassMembers } from './billing-invoice-pass-authority';
import { billingPaymentObservations } from './schema/billing-payment-observations';
import { paymentObservationValues } from './billing-payment-observation-record';
export async function finishInvoice(
  tx: BoundedTransactionContext,
  input: {
    readonly state: Parameters<typeof advanceCleanup>[0];
    readonly work: CleanupWork;
    readonly claimId: string;
    readonly witness: BillingPaymentObservation;
    readonly current: InvoicePass | null;
    readonly coverage: unknown;
    readonly context: Parameters<typeof advanceCleanup>[2];
  },
) {
  const { current, context } = input;
  if (
    current?.phase !== 'verify-invoice' ||
    !context.observationOwner ||
    input.state.kind === 'acknowledged' ||
    !input.state.claim
  )
    throw createAppError('CONFLICT');
  const members = await currentPassMembers(tx, current);
  const facts = await cleanupFacts(tx, context.observationOwner.userId);
  const finalContext = {
    ...(await cleanupContext(tx, context.jobId, facts.effects)),
    observationOwner: context.observationOwner,
  };
  const authority = {
    now: finalContext.now,
    jobId: context.jobId,
    userId: context.observationOwner.userId,
    claim: input.state.claim,
  };
  if (
    headRetention(current.owner, current.head.reads, members, authority) !==
      'retained' ||
    !ownsCleanupClaim(input.state, input.claimId, input.work, finalContext)
  )
    throw createAppError('CONFLICT');
  const result = recordInvoiceEnumeration(input.witness, input.coverage, {
    ...context.observationOwner,
    now: finalContext.now,
  });
  if (result.kind !== 'recorded') throw createAppError('CONFLICT');
  await tx
    .update(billingPaymentObservations)
    .set(paymentObservationValues(result.observation))
    .where(eq(billingPaymentObservations.id, result.observation.id));
  return advanceCleanup(
    input.state,
    {
      kind: 'retained',
      claimId: input.claimId,
      work: input.work,
      observation: result.observation,
    },
    finalContext,
  );
}
