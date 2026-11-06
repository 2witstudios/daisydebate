import { createAppError } from '@daisy/errors';
import {
  ownedPaymentObservationSchema,
  invoicePassHeadSchema,
  invoicePassInvoiceSchema,
  type CleanupInvoiceStep,
  type InvoicePass,
  type InvoicePassEvent,
  type BillingPaymentObservation,
} from '@daisy/protocol/billing';
import type { BoundedTransactionContext } from './transaction-context';
import type { cleanupFacts } from './billing-cleanup-authority';
import { writePaymentObservation } from './billing-payment-observation-write';
import {
  verifyInvoicePassOwner,
  type lockInvoiceExecution,
} from './billing-invoice-pass-authority';
import {
  retainInvoiceWitness,
  rearmInvoiceWitness,
} from './billing-invoice-observation';
/** Producer input contains no caller-supplied retained-row authority. */
export type CleanupInvoiceRequest =
  | Extract<CleanupInvoiceStep, { kind: 'start' }>
  | {
      readonly kind: 'advance';
      readonly event:
        | {
            readonly kind: 'retained';
            readonly beforeId: string | null;
            readonly read: unknown;
            readonly more: boolean;
          }
        | { readonly kind: 'head'; readonly receipt: unknown }
        | { readonly kind: 'invoice'; readonly receipt: unknown }
        | { readonly kind: 'exhausted'; readonly beforeId: string | null };
    };
export async function retainPassRead(
  tx: BoundedTransactionContext,
  event: Extract<CleanupInvoiceRequest, { kind: 'advance' }>['event'],
  witness: BillingPaymentObservation,
  current: InvoicePass | null,
  context: {
    readonly userId: string;
    readonly closedAt: string;
    readonly now: string;
  },
  nextId: () => string,
  route: Awaited<ReturnType<typeof cleanupFacts>>['route'],
): Promise<InvoicePassEvent> {
  if (!current) throw createAppError('CONFLICT');
  if (event.kind === 'retained') {
    const read = ownedPaymentObservationSchema.parse(event.read);
    await requireReadOwner(tx, current, read, route);
    const retained = await writePaymentObservation(tx, {
      read,
      context,
      nextId,
    });
    if (retained.kind === 'refuse') throw createAppError('CONFLICT');
    return { ...event, read, observation: retained.observation };
  }
  if (event.kind === 'head') {
    const receipt = invoicePassHeadSchema.parse(event.receipt);
    const retained: BillingPaymentObservation[] = [];
    for (const read of receipt.reads) {
      await requireReadOwner(tx, current, read, route);
      const result = await writePaymentObservation(tx, {
        read,
        context,
        nextId,
      });
      if (result.kind === 'refuse') throw createAppError('CONFLICT');
      retained.push(result.observation);
    }
    return { kind: 'head', receipt, retained };
  }
  if (event.kind === 'invoice') return { ...event, observation: witness };
  return event;
}
async function requireReadOwner(
  tx: BoundedTransactionContext,
  current: InvoicePass,
  read: import('@daisy/protocol/billing').OwnedPaymentObservation,
  route: Awaited<ReturnType<typeof cleanupFacts>>['route'],
) {
  if (
    read.mode !== current.owner.mode ||
    read.customerId !== current.owner.customerId ||
    read.invoiceId !== current.owner.invoiceId ||
    !(await verifyInvoicePassOwner(
      tx,
      { ...current.owner, source: read.source },
      route,
    ))
  )
    throw createAppError('CONFLICT');
}

export async function retainInvoiceStep(
  tx: BoundedTransactionContext,
  step: CleanupInvoiceRequest,
  admitted: NonNullable<Awaited<ReturnType<typeof lockInvoiceExecution>>>,
  nextId: () => string,
) {
  const { current, owner, context, facts } = admitted;
  const sourceOwner =
    step.kind === 'advance' && step.event.kind === 'invoice'
      ? invoicePassInvoiceSchema.parse(step.event.receipt).owner
      : step.kind === 'advance' && step.event.kind === 'head'
        ? invoicePassHeadSchema.parse(step.event.receipt).owner
        : owner;
  if (
    !(await verifyInvoicePassOwner(
      tx,
      { ...owner, source: sourceOwner.source },
      facts.route,
    ))
  )
    throw createAppError('CONFLICT');
  const retainedWitness = await retainInvoiceWitness(tx, {
    read: {
      mode: sourceOwner.mode,
      customerId: sourceOwner.customerId,
      invoiceId: sourceOwner.invoiceId,
      source: sourceOwner.source,
    },
    context,
    nextId: nextId,
  });
  const witness =
    step.kind === 'start'
      ? await rearmInvoiceWitness(tx, retainedWitness)
      : retainedWitness;
  if (step.kind === 'start') return { step, witness };
  const event = await retainPassRead(
    tx,
    step.event,
    witness,
    current,
    context,
    nextId,
    facts.route,
  );
  return { step: { kind: 'advance' as const, event }, witness };
}
