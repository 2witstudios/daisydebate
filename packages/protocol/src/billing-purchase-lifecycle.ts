import { idSchema } from './primitives';
import {
  currentPurchase,
  purchaseBounds,
  purchaseSchema,
  purchaseSessionExpiry,
  type Purchase,
  type PurchaseContext,
  type PurchaseEvent,
  type PurchaseObservation,
  type PurchaseState,
  type PurchaseTransition,
  type PurchaseWork,
} from './billing-purchase';
const at = Date.parse;
const refuse = { kind: 'refuse' } as const;
const unchanged = { kind: 'unchanged' } as const;

/** A gate disable is intentionally absent: this is recovery of an already admitted identity. */
export function nextPurchaseWork(
  purchase: Purchase,
  context: PurchaseContext,
): PurchaseWork {
  if (!currentPurchase(purchase, context)) return 'refuse';
  const { state } = purchase;
  if (state.kind === 'abandoned') return 'none';
  if (context.authority === 'closed')
    return state.kind === 'admitted' ? 'abandon' : 'cleanup';
  return activeWork(purchase, context.now);
}

function recoveryWork(
  purchase: Purchase,
  now: number,
  dueAt: string,
): PurchaseWork {
  if (now < at(dueAt)) return 'wait';
  return now < at(purchase.admittedAt) + purchaseBounds.creationMs
    ? 'create'
    : 'discover';
}

function activeWork(purchase: Purchase, instant: string): PurchaseWork {
  const { state } = purchase;
  const now = at(instant);
  switch (state.kind) {
    case 'admitted':
      return now < at(purchase.admittedAt) + purchaseBounds.creationMs
        ? 'create'
        : 'abandon';
    case 'creating':
      return recoveryWork(purchase, now, state.claim.expiresAt);
    case 'unknown':
      return recoveryWork(purchase, now, state.retryAt);
    case 'open':
      return now < purchaseSessionExpiry(purchase) * 1000
        ? 'retrieve'
        : 'expire';
    case 'complete':
      return 'synchronize';
    case 'expired':
    case 'abandoned':
      return 'none';
  }
}

function terminalObservation(
  state: Extract<PurchaseState, { kind: 'complete' | 'expired' }>,
  observed: PurchaseObservation,
): PurchaseTransition {
  if (observed.kind === 'open') return unchanged;
  if (state.kind !== observed.kind || state.customerId !== observed.customerId)
    return refuse;
  if (
    state.kind === 'complete' &&
    observed.kind === 'complete' &&
    state.subscriptionId !== observed.subscriptionId
  )
    return refuse;
  return unchanged;
}

function changed(purchase: Purchase, state: PurchaseState): PurchaseTransition {
  const parsed = purchaseSchema.safeParse({ ...purchase, state });
  return parsed.success
    ? { kind: 'changed', state: parsed.data.state }
    : refuse;
}
function claim(
  purchase: Purchase,
  claimId: string,
  context: PurchaseContext,
): PurchaseTransition {
  if (
    nextPurchaseWork(purchase, context) !== 'create' ||
    !idSchema.safeParse(claimId).success
  )
    return refuse;
  const { state } = purchase;
  if (state.kind === 'creating' && state.claim.id === claimId) return refuse;
  return changed(purchase, {
    kind: 'creating',
    startedAt: 'startedAt' in state ? state.startedAt : context.now,
    claim: {
      id: claimId,
      claimedAt: context.now,
      expiresAt: new Date(
        Math.min(
          at(context.now) + purchaseBounds.claimMs,
          at(purchase.admittedAt) + purchaseBounds.creationMs,
        ),
      ).toISOString(),
    },
  });
}
function unknown(
  purchase: Purchase,
  claimId: string,
  context: PurchaseContext,
): PurchaseTransition {
  const { state } = purchase;
  if (
    state.kind !== 'creating' ||
    state.claim.id !== claimId ||
    at(context.now) >= at(state.claim.expiresAt)
  )
    return refuse;
  return changed(purchase, {
    kind: 'unknown',
    startedAt: state.startedAt,
    retryAt: new Date(at(context.now) + purchaseBounds.retryMs).toISOString(),
  });
}

/** Only the vendor boundary supplies observations after validating frozen offer/mode/ownership. */
function observe(
  purchase: Purchase,
  observed: PurchaseObservation,
): PurchaseTransition {
  const { state } = purchase;
  if (!('startedAt' in state)) return refuse;
  if ('sessionId' in state && state.sessionId !== observed.id) return refuse;
  if (state.kind === 'complete' || state.kind === 'expired')
    return terminalObservation(state, observed);
  if (
    'customerId' in state &&
    state.customerId !== null &&
    state.customerId !== observed.customerId
  )
    return refuse;
  const next = {
    kind: observed.kind,
    startedAt: state.startedAt,
    sessionId: observed.id,
    customerId: observed.customerId,
  };
  return changed(
    purchase,
    observed.kind === 'complete'
      ? {
          ...next,
          kind: 'complete',
          customerId: observed.customerId,
          subscriptionId: observed.subscriptionId,
        }
      : { ...next, kind: observed.kind },
  );
}

/** Possible execution is permanent evidence; clocks and missing replies never release it. */
export function advancePurchase(
  purchase: Purchase,
  event: PurchaseEvent,
  context: PurchaseContext,
): PurchaseTransition {
  if (!currentPurchase(purchase, context)) return refuse;
  switch (event.kind) {
    case 'claim':
      return claim(purchase, event.claimId, context);
    case 'unknown':
      return unknown(purchase, event.claimId, context);
    case 'observe':
      return observe(purchase, event.session);
    case 'abandon':
      return nextPurchaseWork(purchase, context) === 'abandon'
        ? changed(purchase, { kind: 'abandoned', abandonedAt: context.now })
        : refuse;
  }
}
