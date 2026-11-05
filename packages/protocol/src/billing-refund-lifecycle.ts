import { idSchema } from './primitives';
import {
  currentRefund,
  ownsRefundClaim,
  refundActionSchema,
  refundBounds,
  type RefundAction,
  type RefundContext,
  type RefundEvent,
  type RefundTransition,
  type RefundWork,
} from './billing-refund';
const at = Date.parse;
const refuse = { kind: 'refuse' } as const;

/** A known refund is read again even after success; later bank returns can reopen the obligation. */
export function nextRefundWork(
  action: RefundAction,
  context: RefundContext,
): RefundWork {
  if (!currentRefund(action, context)) return 'refuse';
  if (action.claim && at(context.now) < at(action.claim.expiresAt))
    return 'wait';
  const { state } = action;
  if (state.kind === 'ready') return 'create';
  if (state.kind === 'known') return 'retrieve';
  if (at(context.now) < at(state.retryAt)) return 'wait';
  return at(context.now) < at(state.startedAt) + refundBounds.creationMs
    ? 'create'
    : 'discover';
}
function changed(action: RefundAction): RefundTransition {
  const parsed = refundActionSchema.safeParse(action);
  return parsed.success ? { kind: 'changed', action: parsed.data } : refuse;
}
function claim(
  action: RefundAction,
  claimId: string,
  context: RefundContext,
): RefundTransition {
  const work = nextRefundWork(action, context);
  if (
    work === 'refuse' ||
    work === 'wait' ||
    !idSchema.safeParse(claimId).success ||
    action.claim?.id === claimId
  )
    return refuse;
  const state =
    action.state.kind === 'ready'
      ? {
          kind: 'unknown' as const,
          startedAt: context.now,
          retryAt: context.now,
          afterRefundId: null,
        }
      : action.state;
  const expiresAt = Math.min(
    at(context.now) + refundBounds.claimMs,
    work === 'create'
      ? at(state.startedAt) + refundBounds.creationMs
      : Infinity,
  );
  return changed({
    ...action,
    state,
    claim: {
      id: claimId,
      work,
      claimedAt: context.now,
      expiresAt: new Date(expiresAt).toISOString(),
    },
  });
}

function observed(
  action: RefundAction,
  event: Extract<RefundEvent, { kind: 'observe' }>,
  now: string,
): RefundTransition {
  const { state } = action;
  if (
    state.kind === 'ready' ||
    (state.kind === 'known' && state.refundId !== event.refundId)
  )
    return refuse;
  return changed({
    ...action,
    claim: null,
    state: {
      kind: 'known',
      startedAt: state.startedAt,
      refundId: event.refundId,
      status: event.status,
      observedAt: now,
    },
  });
}
function searched(
  action: RefundAction,
  event: Extract<RefundEvent, { kind: 'searched' }>,
  now: string,
): RefundTransition {
  const { state } = action;
  if (
    state.kind !== 'unknown' ||
    action.claim?.work !== 'discover' ||
    state.afterRefundId !== event.beforeRefundId ||
    (event.afterRefundId !== null &&
      event.afterRefundId === event.beforeRefundId)
  )
    return refuse;
  return changed({
    ...action,
    claim: null,
    state: {
      ...state,
      afterRefundId: event.afterRefundId,
      retryAt: new Date(at(now) + refundBounds.retryMs).toISOString(),
    },
  });
}

/** Lease loss never proves no refund; all observations require the exact current post-wait claim. */
export function advanceRefund(
  action: RefundAction,
  event: RefundEvent,
  context: RefundContext,
): RefundTransition {
  if (!currentRefund(action, context)) return refuse;
  if (event.kind === 'claim') return claim(action, event.claimId, context);
  if (!ownsRefundClaim(action, event.claimId, context)) return refuse;
  switch (event.kind) {
    case 'observe':
      return observed(action, event, context.now);
    case 'searched':
      return searched(action, event, context.now);
    case 'unresolved':
      return changed({
        ...action,
        claim: null,
        state:
          action.state.kind === 'unknown'
            ? {
                ...action.state,
                retryAt: new Date(
                  at(context.now) + refundBounds.retryMs,
                ).toISOString(),
              }
            : action.state,
      });
  }
}
