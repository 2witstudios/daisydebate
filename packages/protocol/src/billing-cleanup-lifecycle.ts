import { z } from 'zod';
import { idSchema } from './primitives';
import { advanceCleanupScan, nextTurn } from './billing-cleanup-scans';
import { advanceInvoiceIdentityDebt } from './billing-invoice-identity-debt';
import { advanceCleanupInvoiceIdentity } from './billing-cleanup-invoice-identity';
import {
  billingCleanupSchema,
  cleanupBounds,
  cleanupWork,
  cleanupWorkSchema,
  currentCleanup,
  type CleanupWork,
  type CleanupContext,
  type CleanupEvent,
  type CleanupState,
} from './billing-cleanup';
const idle = { kind: 'idle' } as const;
const at = Date.parse;
type Active = Exclude<CleanupState, { kind: 'acknowledged' }>;
export type CleanupTransition =
  | {
      readonly kind: 'claimed' | 'progress' | 'failure' | 'complete';
      readonly state: CleanupState;
    }
  | typeof idle;
function result(
  kind: Exclude<CleanupTransition['kind'], 'idle'>,
  state: CleanupState,
): CleanupTransition {
  const parsed = billingCleanupSchema.safeParse(state);
  return parsed.success ? { kind, state: parsed.data } : idle;
}
export function ownsCleanupClaim(
  value: CleanupState,
  claimId: string,
  expectedWork: CleanupWork,
  context: CleanupContext,
) {
  if (!currentCleanup(value, context) || value.kind === 'acknowledged')
    return false;
  const work = cleanupWorkSchema.safeParse(expectedWork);
  return (
    value.claim !== null &&
    value.claim.id === claimId &&
    at(context.now) >= at(value.claim.claimedAt) &&
    at(context.now) < at(value.claim.expiresAt) &&
    work.success &&
    JSON.stringify(work.data) === JSON.stringify(cleanupWork(value))
  );
}
function claim(value: Active, claimId: string, now: string): CleanupTransition {
  if (
    !idSchema.safeParse(claimId).success ||
    at(now) < at(value.retryAt) ||
    (value.claim &&
      (value.claim.id === claimId || at(now) < at(value.claim.expiresAt)))
  )
    return idle;
  return result('claimed', {
    ...value,
    claim: {
      id: claimId,
      claimedAt: now,
      expiresAt: new Date(at(now) + cleanupBounds.claimMs).toISOString(),
    },
  });
}
function failure(value: Active, retryAt: string, now: string) {
  if (
    !z.iso.datetime({ precision: 3 }).safeParse(retryAt).success ||
    at(retryAt) <= at(now) ||
    at(retryAt) > at(now) + 3_600_000
  )
    return idle;
  const work = cleanupWork(value);
  const invoiceDebt =
    value.kind === 'scanning'
      ? work?.kind === 'invoice-identity'
        ? advanceInvoiceIdentityDebt(value.invoiceDebt, {
            kind: 'identity-failed',
            id: work.invoiceId,
          })!
        : value.turn === 'observations'
          ? advanceInvoiceIdentityDebt(value.invoiceDebt, {
              kind: 'observation-step',
            })!
          : value.invoiceDebt
      : { kind: 'none' as const };
  return result('failure', {
    ...value,
    ...(value.kind === 'scanning'
      ? { invoiceDebt, turn: nextTurn(value.turn, value.scans, invoiceDebt)! }
      : {}),
    claim: null,
    retryAt,
  });
}

function noEffects(context: CleanupContext) {
  const facts = context.effects;
  return (
    facts !== undefined &&
    facts.owedFinancialEffects === false &&
    [
      facts.mappedCustomers,
      facts.possiblePurchases,
      facts.retainedFinancialRoutes,
    ].every((count) => count === 0)
  );
}
function completed(
  jobId: string,
  now: string,
  outcome: 'vendor-deleted' | 'no-vendor-effects',
) {
  return result('complete', {
    kind: 'acknowledged',
    outcome,
    jobId,
    checkedAt: now,
    nextAt: new Date(at(now) + cleanupBounds.recheckMs).toISOString(),
  });
}

/** A progress commit consumes one exact claim and yields; silence never completes an obligation. */
export function advanceCleanup(
  value: CleanupState,
  event: CleanupEvent,
  context: CleanupContext,
): CleanupTransition {
  if (!currentCleanup(value, context) || value.kind === 'acknowledged')
    return idle;
  if (event.kind === 'claim') return claim(value, event.claimId, context.now);
  if (!ownsCleanupClaim(value, event.claimId, event.work, context)) return idle;
  return applyClaimedOutcome(value, event, context);
}

function applyClaimedOutcome(
  value: Active,
  event: Exclude<CleanupEvent, { kind: 'claim' }>,
  context: CleanupContext,
): CleanupTransition {
  if (!identityOutcomeAllowed(event)) return idle;
  if (event.kind === 'failure')
    return failure(value, event.retryAt, context.now);
  if (event.kind === 'deleted' || event.kind === 'no-effects')
    return terminal(value, event, context);
  if (value.kind !== 'scanning') return idle;
  if (event.kind === 'invoice-identity-retained') {
    const next = advanceCleanupInvoiceIdentity(value, event, context);
    return next ? result('progress', next) : idle;
  }
  const next = advanceCleanupScan(value, event, context);
  return next ? result('progress', next) : idle;
}
function identityOutcomeAllowed(
  event: Exclude<CleanupEvent, { kind: 'claim' }>,
) {
  return (
    event.work.kind !== 'invoice-identity' ||
    event.kind === 'failure' ||
    event.kind === 'invoice-identity-retained'
  );
}
function terminal(
  value: Active,
  event: Extract<CleanupEvent, { kind: 'deleted' | 'no-effects' }>,
  context: CleanupContext,
) {
  if (value.kind === 'scanning' && value.invoiceDebt.kind === 'owed')
    return idle;
  if (event.kind === 'deleted')
    return value.kind === 'deleting' &&
      context.effects?.owedFinancialEffects === false
      ? completed(value.jobId, context.now, 'vendor-deleted')
      : idle;
  return noEffects(context)
    ? completed(value.jobId, context.now, 'no-vendor-effects')
    : idle;
}
