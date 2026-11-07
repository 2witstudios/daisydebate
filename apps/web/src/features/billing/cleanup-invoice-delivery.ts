import { hasObservationConflict } from './cleanup-observation-conflict';
import type { Database } from '@daisy/db';
import {
  invoicePassOwnerSchema,
  type InvoicePass,
  type OwnedInvoiceObservation,
} from '@daisy/protocol/billing';
import { observeClosureInvoice } from './closure-payment';
import { readCleanupInvoiceIdentity } from './cleanup-invoice-identity';
import type { CleanupDeliveryRequest } from './cleanup-delivery-request';
import type { createInvoicePassReader } from './invoice-pass-reader';
import type { CleanupVendorPort } from './cleanup-vendor';
type Store = Pick<
  ReturnType<Database['billingCleanup']>,
  | 'inspect'
  | 'selectedObservation'
  | 'retainObservation'
  | 'record'
  | 'recordInvoices'
  | 'recordPayments'
  | 'frozenOffer'
  | 'invoicePassStep'
>;
type Resources = {
  readonly store: Store;
  readonly port: Pick<CleanupVendorPort, 'invoice'>;
  readonly readPass: ReturnType<typeof createInvoicePassReader>;
  readonly mode: 'test' | 'live';
  readonly nextId: () => string;
  readonly running: () => boolean;
};
type Current = Extract<
  Awaited<ReturnType<Store['inspect']>>,
  { kind: 'current' }
>;

/** Every retained member and bounded final receipt uses the same current execution-owned invoice pass. */
export function createCleanupInvoiceDelivery(input: Resources) {
  return async (request: CleanupDeliveryRequest) => {
    const selected = await invoiceSelection(input.store, request);
    if (selected.kind === 'unhandled') return 'unhandled' as const;
    if (selected.kind === 'idle' || !input.running()) return 'idle' as const;
    if (selected.kind === 'conflict')
      return input.store.retainObservation(
        request.jobId,
        request.claimId,
        request.work,
      );
    const current = await input.store.inspect(
      request.jobId,
      request.claimId,
      request.work,
    );
    if (current.kind !== 'current') return 'idle' as const;
    const work = request.work;
    if (work.kind !== 'scan' || work.scan.kind !== 'selected')
      return 'idle' as const;
    const pass =
      work.scan.detail.kind === 'invoice-payments'
        ? work.scan.detail.pass
        : null;
    return pass
      ? advanceCurrent(input, request, current, selected.invoiceId, pass)
      : startCurrent(input, request, current, selected.invoiceId);
  };
}
async function invoiceSelection(store: Store, request: CleanupDeliveryRequest) {
  const { work } = request;
  if (work.kind !== 'scan' || work.scan.kind !== 'selected')
    return { kind: 'unhandled' } as const;
  if (work.lane === 'invoices')
    return { kind: 'invoice' as const, invoiceId: work.scan.id };
  if (work.lane !== 'observations') return { kind: 'unhandled' } as const;
  const selected = await store.selectedObservation(
    request.jobId,
    request.claimId,
    work,
  );
  if (selected.kind !== 'observation') return { kind: 'idle' } as const;
  const row = selected.observation;
  if (row.kind !== 'invoice') return { kind: 'unhandled' } as const;
  if (hasObservationConflict(row)) return { kind: 'conflict' } as const;
  return { kind: 'invoice' as const, invoiceId: row.invoiceId };
}
const failure = (input: Resources, request: CleanupDeliveryRequest) =>
  input.store.record(request.jobId, {
    kind: 'failure',
    claimId: request.claimId,
    work: request.work,
    retryAt: request.retryAt,
  });
function matchingPass(
  pass: InvoicePass,
  current: Current,
  invoiceId: string,
  mode: Resources['mode'],
) {
  const route = current.facts.route;
  return (
    route.kind === 'owned' &&
    route.mode === mode &&
    pass.owner.mode === mode &&
    pass.owner.customerId === route.customerId &&
    pass.owner.invoiceId === invoiceId &&
    pass.owner.userId === current.userId &&
    pass.owner.closedAt === current.closedAt
  );
}
async function advanceCurrent(
  input: Resources,
  request: CleanupDeliveryRequest,
  current: Current,
  invoiceId: string,
  pass: InvoicePass,
) {
  if (!matchingPass(pass, current, invoiceId, input.mode))
    return failure(input, request);
  if (!input.running()) return 'idle' as const;
  const read = await input.readPass(pass, request.claimId);
  if (!input.running()) return 'idle' as const;
  if (read.kind === 'incomplete')
    return retainIncompletePayments(input, request, current.userId, read.reads);
  if (read.kind !== 'advance') return failure(input, request);
  const result = await input.store.invoicePassStep(
    request.jobId,
    request.claimId,
    request.work,
    { kind: 'advance', event: read.event },
  );
  if (result !== 'idle' || !input.running()) return result;
  return retainLatePayments(input, current.userId, read.event);
}
/** Positive owned facts survive a failed page; only the independent writer may reopen the job. */
async function retainIncompletePayments(
  input: Resources,
  request: CleanupDeliveryRequest,
  userId: string,
  reads: Extract<
    Awaited<ReturnType<Resources['readPass']>>,
    { kind: 'incomplete' }
  >['reads'],
) {
  const retained = await input.store.recordPayments(userId, reads);
  if (retained === 'refuse' || !input.running()) return 'idle' as const;
  const result = await failure(input, request);
  return result === 'idle' && retained === 'recorded'
    ? ('reopened' as const)
    : result;
}
async function retainLatePayments(
  input: Resources,
  userId: string,
  event: Extract<
    Awaited<ReturnType<Resources['readPass']>>,
    { kind: 'advance' }
  >['event'],
) {
  const reads =
    event.kind === 'retained'
      ? [event.read]
      : event.kind === 'head'
        ? event.receipt.reads
        : [];
  if (reads.length === 0) return 'idle' as const;
  const retained = await input.store.recordPayments(userId, reads);
  return retained === 'recorded' ? ('reopened' as const) : ('idle' as const);
}
async function startCurrent(
  input: Resources,
  request: CleanupDeliveryRequest,
  current: Current,
  invoiceId: string,
) {
  const route = current.facts.route;
  if (route.kind !== 'owned' || route.mode !== input.mode)
    return failure(input, request);
  if (!input.running()) return 'idle' as const;
  let raw: unknown;
  try {
    raw = await input.port.invoice(invoiceId);
  } catch {
    return input.running() ? failure(input, request) : ('idle' as const);
  }
  if (!input.running()) return 'idle' as const;
  const read = readCleanupInvoiceIdentity(
    { mode: route.mode, customerId: route.customerId },
    raw,
  );
  if (!read || read.invoiceId !== invoiceId) return failure(input, request);
  return startOwnedInvoice(input, request, current, read, raw);
}
async function startOwnedInvoice(
  input: Resources,
  request: CleanupDeliveryRequest,
  current: Current,
  read: OwnedInvoiceObservation,
  raw: unknown,
) {
  const retained = await input.store.recordInvoices(current.userId, [read]);
  if (retained === 'recorded') return 'reopened' as const;
  if (retained === 'refuse' || !input.running()) return 'idle' as const;
  const owner = await invoiceOwner(input, request, current, read, raw);
  if (!owner) return failure(input, request);
  if (!input.running()) return 'idle' as const;
  return input.store.invoicePassStep(
    request.jobId,
    request.claimId,
    request.work,
    { kind: 'start', passId: input.nextId(), owner },
  );
}
async function invoiceOwner(
  input: Resources,
  request: CleanupDeliveryRequest,
  current: Current,
  read: OwnedInvoiceObservation,
  raw: unknown,
) {
  const subscriptionId = read.source.vendorSubscriptionId;
  const frozen =
    subscriptionId === null
      ? null
      : await input.store.frozenOffer(
          request.jobId,
          request.claimId,
          request.work,
          subscriptionId,
        );
  return observedOwner(input.mode, current, read, raw, frozen);
}
function observedOwner(
  mode: Resources['mode'],
  current: Current,
  read: OwnedInvoiceObservation,
  raw: unknown,
  frozen: Awaited<ReturnType<Store['frozenOffer']>> | null,
) {
  const known =
    frozen?.kind === 'owned' && frozen.owner.mode === mode ? frozen : null;
  const observation = known
    ? observeClosureInvoice({ owner: known.owner, invoice: raw })
    : null;
  const owner = invoicePassOwnerSchema.safeParse({
    ...read,
    userId: current.userId,
    closedAt: current.closedAt,
    source: known?.source ?? read.source,
    period: observation?.kind === 'invoice' ? observation.period : null,
  });
  return owner.success ? owner.data : null;
}
