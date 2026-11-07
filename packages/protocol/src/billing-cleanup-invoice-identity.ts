import { currentPaymentObservation } from './billing-payment-observation';
import { advanceInvoiceIdentityDebt } from './billing-invoice-identity-debt';
import { nextTurn } from './billing-cleanup-scans';
import {
  cleanupBounds,
  type CleanupContext,
  type CleanupEvent,
  type CleanupState,
} from './billing-cleanup';

/** Exact retained invoice routing retires only identity debt, never payment/action debt. */
export function advanceCleanupInvoiceIdentity(
  value: Extract<CleanupState, { kind: 'scanning' }>,
  event: Extract<CleanupEvent, { kind: 'invoice-identity-retained' }>,
  context: CleanupContext,
): CleanupState | null {
  const owner = context.observationOwner;
  if (
    !owner ||
    value.turn !== 'observations' ||
    event.work.kind !== 'invoice-identity' ||
    event.observation.kind !== 'invoice' ||
    event.observation.invoiceId !== event.work.invoiceId ||
    event.observation.state.kind !== 'owed' ||
    !currentPaymentObservation(event.observation, {
      ...owner,
      now: context.now,
    })
  )
    return null;
  const invoiceDebt = advanceInvoiceIdentityDebt(value.invoiceDebt, {
    kind: 'identity-retained',
    id: event.work.invoiceId,
  });
  if (!invoiceDebt) return null;
  const turn = nextTurn(value.turn, value.scans, invoiceDebt);
  const retryAt = new Date(
    Date.parse(context.now) + cleanupBounds.progressMs,
  ).toISOString();
  // All execution heads restart when only retained obligations remain; nothing resolves them here.
  if (!turn)
    return {
      ...value,
      invoiceDebt,
      claim: null,
      retryAt,
      turn: 'purchases',
      scans: {
        purchases: { kind: 'page', afterId: null },
        subscriptions: { kind: 'page', afterId: null },
        invoices: { kind: 'page', afterId: null },
        refunds: { kind: 'page', afterId: null },
        observations: { kind: 'page', afterId: null },
      },
    };
  return { ...value, invoiceDebt, turn, claim: null, retryAt };
}
