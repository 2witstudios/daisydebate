import { and, eq, inArray } from 'drizzle-orm';
import {
  ownedPaymentObservationSchema,
  invoicePassHeadSchema,
  invoicePassInvoiceSchema,
  invoicePassOwnerSchema,
  ownsCleanupClaim,
  type InvoicePass,
  type InvoicePassOwner,
  type CleanupWork,
} from '@daisy/protocol/billing';
import type { BoundedTransactionContext } from './transaction-context';
import {
  lockCleanupJob,
  cleanupFacts,
  cleanupContext,
} from './billing-cleanup-authority';
import type { CleanupInvoiceRequest } from './billing-invoice-pass-retention';
import { billingPaymentObservations } from './schema/billing-payment-observations';
import { paymentObservationFromRow } from './billing-payment-observation-record';
import { readFrozenBillingOffer } from './billing-frozen-offer';

/** Frozen historical offer ownership is checked against durable purchase facts, never today's configured price. */
export async function verifyInvoicePassOwner(
  tx: BoundedTransactionContext,
  owner: InvoicePassOwner,
  route: Awaited<ReturnType<typeof cleanupFacts>>['route'],
) {
  if (
    route.kind !== 'owned' ||
    route.mode !== owner.mode ||
    route.customerId !== owner.customerId
  )
    return false;
  if (owner.source.kind !== 'purchase') return true;
  const source = owner.source;
  const original = await readFrozenBillingOffer(tx, {
    userId: owner.userId,
    mode: owner.mode,
    customerId: owner.customerId,
    vendorSubscriptionId: source.vendorSubscriptionId,
  });
  return (
    original !== null &&
    original.purchaseId === source.purchaseId &&
    original.priceId === source.priceId &&
    original.admittedAt === source.admittedAt
  );
}
/** Only the complete bounded HEAD members are loaded; historical invoice membership is never scanned here. */
export async function currentPassMembers(
  tx: BoundedTransactionContext,
  pass: Extract<InvoicePass, { phase: 'verify-invoice' }>,
) {
  const ids = pass.head.reads.map((read) => read.invoicePaymentId);
  if (ids.length === 0 || ids.length > 20) return [];
  const rows = await tx
    .select()
    .from(billingPaymentObservations)
    .where(
      and(
        eq(billingPaymentObservations.userId, pass.owner.userId),
        eq(billingPaymentObservations.mode, pass.owner.mode),
        eq(billingPaymentObservations.vendorCustomerId, pass.owner.customerId),
        eq(billingPaymentObservations.vendorInvoiceId, pass.owner.invoiceId),
        eq(billingPaymentObservations.kind, 'payment'),
        inArray(billingPaymentObservations.vendorInvoicePaymentId, ids),
      ),
    )
    .for('update');
  return rows.map(paymentObservationFromRow);
}

export function stepMatchesInvoice(
  work: CleanupWork,
  current: InvoicePass | null,
  owner: import('@daisy/protocol/billing').InvoicePassOwner,
  step: CleanupInvoiceRequest,
) {
  if (work.kind !== 'scan' || work.scan.kind !== 'selected') return false;
  if (work.lane === 'invoices' && work.scan.id !== owner.invoiceId)
    return false;
  if (work.lane !== 'invoices' && work.lane !== 'observations') return false;
  if (step.kind === 'start') return current === null;
  if (!current) return false;
  return eventMatchesOwner(step.event, owner);
}
function eventMatchesOwner(
  event: Extract<CleanupInvoiceRequest, { kind: 'advance' }>['event'],
  owner: InvoicePassOwner,
) {
  if (event.kind === 'exhausted') return true;
  const read =
    event.kind === 'retained'
      ? ownedPaymentObservationSchema.safeParse(event.read)
      : event.kind === 'head'
        ? invoicePassHeadSchema.safeParse(event.receipt)
        : invoicePassInvoiceSchema.safeParse(event.receipt);
  if (!read.success) return false;
  const binding = 'owner' in read.data ? read.data.owner : read.data;
  return (
    binding.mode === owner.mode &&
    binding.customerId === owner.customerId &&
    binding.invoiceId === owner.invoiceId
  );
}

export async function lockInvoiceExecution(
  tx: BoundedTransactionContext,
  jobId: string,
  claimId: string,
  work: CleanupWork,
  step: CleanupInvoiceRequest,
) {
  const locked = await lockCleanupJob(tx, jobId);
  if (!locked?.state) return null;
  const facts = await cleanupFacts(tx, locked.userId);
  const before = await cleanupContext(tx, jobId, facts.effects);
  if (!ownsCleanupClaim(locked.state, claimId, work, before)) return null;
  const current = passFromWork(work);
  const owner =
    step.kind === 'start'
      ? invoicePassOwnerSchema.parse(step.owner)
      : current?.owner;
  if (!owner || !matchesClosedOwner(owner, locked)) return null;
  if (!stepMatchesInvoice(work, current, owner, step)) return null;
  if (!(await verifyInvoicePassOwner(tx, owner, facts.route))) return null;
  const context = {
    userId: locked.userId,
    closedAt: locked.closedAt,
    now: before.now,
  };
  return {
    locked: { ...locked, state: locked.state },
    facts,
    current,
    owner,
    context,
  };
}
function passFromWork(work: CleanupWork): InvoicePass | null {
  return work.kind === 'scan' &&
    work.scan.kind === 'selected' &&
    work.scan.detail.kind === 'invoice-payments'
    ? work.scan.detail.pass
    : null;
}

function matchesClosedOwner(
  owner: InvoicePassOwner,
  locked: { readonly userId: string; readonly closedAt: string },
) {
  return owner.userId === locked.userId && owner.closedAt === locked.closedAt;
}
