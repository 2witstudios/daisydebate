import { currentPaymentObservation } from './billing-payment-observation';
import {
  advanceInvoiceIdentityDebt,
  type InvoiceIdentityDebt,
} from './billing-invoice-identity-debt';
import {
  cleanupBounds,
  cleanupLanes,
  startCleanup,
  type CleanupState,
  type CleanupLane,
  type CleanupScan,
  type CleanupEvent,
  type CleanupContext,
} from './billing-cleanup';
export function nextTurn(
  turn: CleanupLane,
  scans: Extract<CleanupState, { kind: 'scanning' }>['scans'],
  debt: InvoiceIdentityDebt = { kind: 'none' },
) {
  const index = cleanupLanes.indexOf(turn);
  for (let offset = 1; offset <= cleanupLanes.length; offset++) {
    const lane = cleanupLanes[(index + offset) % cleanupLanes.length]!;
    if (
      scans[lane].kind !== 'complete' ||
      (lane === 'observations' && debt.kind === 'owed')
    )
      return lane;
  }
  return null;
}
export function progressCleanupScan(
  value: Extract<CleanupState, { kind: 'scanning' }>,
  scan: CleanupScan,
  context: CleanupContext,
): CleanupState | null {
  const scans = { ...value.scans, [value.turn]: scan };
  const invoiceDebt =
    value.turn === 'observations'
      ? advanceInvoiceIdentityDebt(value.invoiceDebt, {
          kind: 'observation-step',
        })!
      : value.invoiceDebt;
  const turn = nextTurn(value.turn, scans, invoiceDebt);
  const retryAt = new Date(
    Date.parse(context.now) + cleanupBounds.progressMs,
  ).toISOString();
  if (
    invoiceDebt.kind === 'owed' &&
    cleanupLanes.every((lane) => scans[lane].kind === 'complete')
  )
    return startCleanup(value.jobId, retryAt, invoiceDebt);
  if (turn) return { ...value, scans, invoiceDebt, turn, retryAt, claim: null };
  if (context.effects?.owedFinancialEffects === undefined) return null;
  return context.effects.owedFinancialEffects
    ? startCleanup(value.jobId, retryAt)
    : {
        version: 2,
        kind: 'deleting',
        jobId: value.jobId,
        retryAt,
        claim: null,
      };
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
        ? { kind: 'invoice-payments', pass: null }
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
  context: CleanupContext,
) {
  const before = value.scans[value.turn];
  if (before.kind !== 'page' || !validPage(event, before.afterId)) return null;
  const [first, ...rest] = event.ids;
  const scan: CleanupScan =
    first === undefined
      ? { kind: 'complete' }
      : selected(first, rest, event.ids.at(-1)!, event.more, value.turn);
  return progressCleanupScan(value, scan, context);
}
function advanceSelected(
  value: Extract<CleanupState, { kind: 'scanning' }>,
  context: CleanupContext,
) {
  const before = value.scans[value.turn];
  if (before.kind !== 'selected') return null;
  const [first, ...rest] = before.rest;
  const scan: CleanupScan =
    first !== undefined
      ? selected(first, rest, before.lastId, before.more, value.turn)
      : before.more
        ? { kind: 'page', afterId: before.lastId }
        : { kind: 'complete' };
  return progressCleanupScan(value, scan, context);
}
export function advanceCleanupScan(
  value: Extract<CleanupState, { kind: 'scanning' }>,
  event: Extract<CleanupEvent, { kind: 'page' | 'resolved' | 'retained' }>,
  context: CleanupContext,
): CleanupState | null {
  switch (event.kind) {
    case 'page':
      return page(value, event, context);
    case 'resolved':
      return value.turn === 'invoices' || value.turn === 'observations'
        ? null
        : advanceSelected(value, context);
    case 'retained':
      return retained(value, event, context);
  }
}

function retained(
  value: Extract<CleanupState, { kind: 'scanning' }>,
  event: Extract<CleanupEvent, { kind: 'retained' }>,
  context: CleanupContext,
) {
  const owner = context.observationOwner;
  const scan = value.scans[value.turn];
  if (
    !owner ||
    !currentPaymentObservation(event.observation, {
      ...owner,
      now: context.now,
    })
  )
    return null;
  if (
    scan.kind !== 'selected' ||
    !(
      (value.turn === 'invoices' &&
        event.observation.kind === 'invoice' &&
        event.observation.invoiceId === scan.id) ||
      (value.turn === 'observations' && event.observation.id === scan.id)
    )
  )
    return null;
  return advanceSelected(value, context);
}
