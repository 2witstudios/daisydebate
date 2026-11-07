import { advanceCleanup, ownsCleanupClaim } from './billing-cleanup-lifecycle';
import { progressCleanupScan } from './billing-cleanup-scans';
import {
  startInvoicePass,
  advanceInvoicePass,
} from './billing-invoice-pass-lifecycle';
import type {
  InvoicePassEvent,
  InvoicePassOwner,
  InvoicePassAuthority,
  InvoicePass,
} from './billing-invoice-pass';
import type { BillingPaymentObservation } from './billing-payment-observation';
import {
  billingCleanupSchema,
  type CleanupState,
  type CleanupWork,
  type CleanupContext,
} from './billing-cleanup';
const idle = { kind: 'idle' } as const;
export type CleanupInvoiceStep =
  | {
      readonly kind: 'start';
      readonly passId: string;
      readonly owner: InvoicePassOwner;
    }
  | { readonly kind: 'advance'; readonly event: InvoicePassEvent };

/** Only the current owned invoice frame hosts pass authority; financial persistence remains the transaction owner's responsibility. */
export function advanceCleanupInvoicePass(
  state: CleanupState,
  input: {
    readonly claimId: string;
    readonly work: CleanupWork;
    readonly step: CleanupInvoiceStep;
    readonly witness: BillingPaymentObservation;
  },
  context: CleanupContext,
) {
  const selected = ownedInvoiceFrame(state, input, context);
  if (
    !selected ||
    state.kind !== 'scanning' ||
    !state.claim ||
    !context.observationOwner
  )
    return idle;
  const authority = {
    now: context.now,
    jobId: context.jobId,
    userId: context.observationOwner.userId,
    claim: state.claim,
  };
  const current =
    selected.detail.kind === 'invoice-payments' ? selected.detail.pass : null;
  const result = applyStep(current, input.step, authority);
  if (result.kind === 'refuse') return idle;
  // Sticky history never bypasses the new event's own identity/evidence refusal above.
  if (result.kind === 'defer' || conflictingInvoice(input.witness))
    return retainSelected(state, input, context);
  if (result.kind === 'covered') return result;
  const next = progressCleanupScan(
    state,
    { ...selected, detail: { kind: 'invoice-payments', pass: result.pass } },
    context,
  );
  return guardedProgress(next);
}
function ownedInvoiceFrame(
  state: CleanupState,
  input: {
    readonly claimId: string;
    readonly work: CleanupWork;
    readonly step: CleanupInvoiceStep;
    readonly witness: BillingPaymentObservation;
  },
  context: CleanupContext,
) {
  if (
    input.work.kind !== 'scan' ||
    !ownsCleanupClaim(state, input.claimId, input.work, context) ||
    state.kind !== 'scanning' ||
    !context.observationOwner
  )
    return null;
  const scan = state.scans[state.turn],
    witness = input.witness;
  if (!matchingWitness(state.turn, scan, witness, context.observationOwner))
    return null;
  if (scan.kind !== 'selected') return null;
  const owner = stepOwner(scan, input.step);
  if (!owner || !matchingOwner(owner, witness)) return null;
  return scan;
}

function applyStep(
  current: InvoicePass | null,
  step: CleanupInvoiceStep,
  authority: InvoicePassAuthority,
) {
  if (step.kind === 'start')
    return current === null
      ? startInvoicePass(step.passId, step.owner, authority)
      : ({ kind: 'refuse' } as const);
  return current === null
    ? ({ kind: 'refuse' } as const)
    : advanceInvoicePass(current, step.event, authority);
}
function matchingWitness(
  lane: string,
  scan: import('./billing-cleanup').CleanupScan,
  witness: BillingPaymentObservation,
  owner: { readonly userId: string; readonly closedAt: string },
) {
  if (
    scan.kind !== 'selected' ||
    witness.kind !== 'invoice' ||
    witness.userId !== owner.userId ||
    witness.closedAt !== owner.closedAt
  )
    return false;
  return lane === 'invoices'
    ? scan.id === witness.invoiceId
    : lane === 'observations' && scan.id === witness.id;
}
function matchingOwner(
  owner: InvoicePassOwner,
  witness: BillingPaymentObservation,
) {
  return (
    owner.userId === witness.userId &&
    owner.closedAt === witness.closedAt &&
    owner.mode === witness.mode &&
    owner.customerId === witness.customerId &&
    owner.invoiceId === witness.invoiceId
  );
}

function stepOwner(
  scan: Extract<import('./billing-cleanup').CleanupScan, { kind: 'selected' }>,
  step: CleanupInvoiceStep,
) {
  if (step.kind === 'start') return step.owner;
  return scan.detail.kind === 'invoice-payments'
    ? scan.detail.pass?.owner
    : null;
}

function conflictingInvoice(witness: BillingPaymentObservation) {
  return (
    witness.state.kind === 'owed' &&
    witness.state.reason === 'conflicting_evidence'
  );
}
function retainSelected(
  state: CleanupState,
  input: {
    readonly claimId: string;
    readonly work: CleanupWork;
    readonly witness: BillingPaymentObservation;
  },
  context: CleanupContext,
) {
  return advanceCleanup(
    state,
    {
      kind: 'retained',
      claimId: input.claimId,
      work: input.work,
      observation: input.witness,
    },
    context,
  );
}

function guardedProgress(state: CleanupState | null) {
  const parsed = billingCleanupSchema.safeParse(state);
  return parsed.success
    ? { kind: 'progress' as const, state: parsed.data }
    : idle;
}
