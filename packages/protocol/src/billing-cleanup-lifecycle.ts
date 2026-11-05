import { z } from 'zod';
import { idSchema } from './primitives';
import {
  billingCleanupSchema,
  cleanupBounds,
  cleanupLanes,
  cleanupWork,
  cleanupWorkSchema,
  currentCleanup,
  type CleanupWork,
  type CleanupContext,
  type CleanupEvent,
  type CleanupLane,
  type CleanupScan,
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
function nextTurn(
  turn: CleanupLane,
  scans: Extract<CleanupState, { kind: 'scanning' }>['scans'],
) {
  const index = cleanupLanes.indexOf(turn);
  for (let offset = 1; offset <= cleanupLanes.length; offset++) {
    const lane = cleanupLanes[(index + offset) % cleanupLanes.length]!;
    if (scans[lane].kind !== 'complete') return lane;
  }
  return null;
}
function progressed(
  value: Extract<CleanupState, { kind: 'scanning' }>,
  scan: CleanupScan,
  now: string,
) {
  const scans = { ...value.scans, [value.turn]: scan };
  const turn = nextTurn(value.turn, scans);
  const retryAt = new Date(at(now) + cleanupBounds.progressMs).toISOString();
  return result(
    'progress',
    turn
      ? { ...value, scans, turn, retryAt, claim: null }
      : { kind: 'deleting', jobId: value.jobId, retryAt, claim: null },
  );
}
function selected(
  id: string,
  rest: string[],
  lastId: string,
  more: boolean,
  lane: CleanupLane,
): CleanupScan {
  return {
    kind: 'selected',
    id,
    rest,
    lastId,
    more,
    detail:
      lane === 'invoices'
        ? { kind: 'invoice-payments', afterId: null }
        : { kind: 'resource' },
  };
}
function validPage(
  event: Extract<CleanupEvent, { kind: 'page' }>,
  afterId: string | null,
) {
  return (
    Array.isArray(event.ids) &&
    event.ids.length <= cleanupBounds.maxPage &&
    typeof event.more === 'boolean' &&
    new Set(event.ids).size === event.ids.length &&
    !event.ids.includes(afterId ?? '') &&
    !(event.ids.length === 0 && event.more)
  );
}
function page(
  value: Extract<CleanupState, { kind: 'scanning' }>,
  event: Extract<CleanupEvent, { kind: 'page' }>,
  now: string,
) {
  const before = value.scans[value.turn];
  if (before.kind !== 'page' || !validPage(event, before.afterId)) return idle;
  const [first, ...rest] = event.ids;
  const scan: CleanupScan =
    first === undefined
      ? { kind: 'complete' }
      : selected(first, rest, event.ids.at(-1)!, event.more, value.turn);
  return progressed(value, scan, now);
}
function resolved(
  value: Extract<CleanupState, { kind: 'scanning' }>,
  now: string,
) {
  const before = value.scans[value.turn];
  if (before.kind !== 'selected') return idle;
  const [first, ...rest] = before.rest;
  const scan: CleanupScan =
    first !== undefined
      ? selected(first, rest, before.lastId, before.more, value.turn)
      : before.more
        ? { kind: 'page', afterId: before.lastId }
        : { kind: 'complete' };
  return progressed(value, scan, now);
}
function payments(
  value: Extract<CleanupState, { kind: 'scanning' }>,
  event: Extract<CleanupEvent, { kind: 'payments' }>,
  now: string,
) {
  const before = value.scans[value.turn];
  if (
    value.turn !== 'invoices' ||
    before.kind !== 'selected' ||
    before.detail.kind !== 'invoice-payments' ||
    before.detail.afterId !== event.beforeId
  )
    return idle;
  if (event.exhausted)
    return event.afterId === null ? resolved(value, now) : idle;
  if (event.afterId === null || event.afterId === event.beforeId) return idle;
  return progressed(
    value,
    { ...before, detail: { kind: 'invoice-payments', afterId: event.afterId } },
    now,
  );
}
function failure(value: Active, retryAt: string, now: string) {
  if (
    !z.iso.datetime({ precision: 3 }).safeParse(retryAt).success ||
    at(retryAt) <= at(now) ||
    at(retryAt) > at(now) + 3_600_000
  )
    return idle;
  return result('failure', { ...value, claim: null, retryAt });
}

function noEffects(context: CleanupContext) {
  const facts = context.effects;
  return (
    facts !== undefined &&
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
  if (event.kind === 'failure')
    return failure(value, event.retryAt, context.now);
  if (event.kind === 'deleted' || event.kind === 'no-effects')
    return terminal(value, event, context);
  if (value.kind !== 'scanning') return idle;
  return advanceScanning(value, event, context.now);
}
function terminal(
  value: Active,
  event: Extract<CleanupEvent, { kind: 'deleted' | 'no-effects' }>,
  context: CleanupContext,
) {
  if (event.kind === 'deleted')
    return value.kind === 'deleting'
      ? completed(value.jobId, context.now, 'vendor-deleted')
      : idle;
  return noEffects(context)
    ? completed(value.jobId, context.now, 'no-vendor-effects')
    : idle;
}
function advanceScanning(
  value: Extract<CleanupState, { kind: 'scanning' }>,
  event: Extract<CleanupEvent, { kind: 'page' | 'payments' | 'resolved' }>,
  now: string,
): CleanupTransition {
  switch (event.kind) {
    case 'page':
      return page(value, event, now);
    case 'payments':
      return payments(value, event, now);
    case 'resolved':
      return value.turn === 'invoices' ? idle : resolved(value, now);
  }
}
