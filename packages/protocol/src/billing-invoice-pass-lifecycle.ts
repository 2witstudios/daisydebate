import {
  headRetention,
  readRetention,
  readInvoicePassWitness,
} from './billing-invoice-pass-evidence';
import {
  ownedPaymentObservationSchema,
  type OwnedPaymentObservation,
} from './billing-payment-observation-read';
import {
  invoicePassSchema,
  invoicePassOwnerSchema,
  invoicePassAuthoritySchema,
  invoicePassHeadSchema,
  invoicePassInvoiceSchema,
  invoicePassLimit,
  sameInvoiceOwner,
  sameInvoicePassSource,
  type InvoicePass,
  type InvoicePassAuthority,
  type InvoicePassEvent,
} from './billing-invoice-pass';
const refuse = { kind: 'refuse' } as const;
type Reason =
  | 'source_changed'
  | 'zero_membership'
  | 'multipage_continuity'
  | 'membership_changed'
  | 'source_unknown'
  | 'invoice_changed'
  | 'conflicting_evidence';
const defer = (reason: Reason) => ({ kind: 'defer', reason }) as const;
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function advanced(value: InvoicePass) {
  const parsed = invoicePassSchema.safeParse(value);
  return parsed.success
    ? ({ kind: 'advanced', pass: parsed.data } as const)
    : refuse;
}

/** Caller supplies the already-owned current job/claim; no ambient IDs, clock or vendor authority. */
export function startInvoicePass(
  id: string,
  owner: unknown,
  context: InvoicePassAuthority,
) {
  const parsed = invoicePassOwnerSchema.safeParse(owner);
  if (
    !parsed.success ||
    !currentAuthority(context) ||
    parsed.data.userId !== context.userId
  )
    return refuse;
  return advanced({
    id,
    jobId: context.jobId,
    beganAt: context.now,
    owner: parsed.data,
    phase: 'retaining',
    afterId: null,
    comparison: { kind: 'bounded', reads: [] },
  });
}
function currentAuthority(context: InvoicePassAuthority) {
  return (
    invoicePassAuthoritySchema.safeParse(context).success &&
    Date.parse(context.now) >= Date.parse(context.claim.claimedAt) &&
    Date.parse(context.now) < Date.parse(context.claim.expiresAt)
  );
}
/** Coverage concerns enumeration only. Financial unknowns/actions remain durable and are rechecked by the host operation. */
export function advanceInvoicePass(
  value: InvoicePass,
  event: InvoicePassEvent,
  context: InvoicePassAuthority,
) {
  if (
    !invoicePassSchema.safeParse(value).success ||
    !currentAuthority(context) ||
    value.jobId !== context.jobId ||
    value.owner.userId !== context.userId ||
    Date.parse(context.now) < Date.parse(value.beganAt)
  )
    return refuse;
  if (event.kind === 'retained') return retained(value, event, context);
  if (event.kind === 'exhausted') return exhausted(value, event.beforeId);
  if (event.kind === 'head') return head(value, event, context);
  return invoice(value, event, context);
}
function retained(
  value: InvoicePass,
  event: Extract<InvoicePassEvent, { kind: 'retained' }>,
  context: InvoicePassAuthority,
) {
  if (
    value.phase !== 'retaining' ||
    event.beforeId !== value.afterId ||
    typeof event.more !== 'boolean'
  )
    return refuse;
  const parsed = ownedPaymentObservationSchema.safeParse(event.read);
  if (!parsed.success) return refuse;
  const read = parsed.data;
  if (
    !sameInvoiceOwner(value.owner, read) ||
    read.invoicePaymentId === value.afterId
  )
    return refuse;
  const retention = readRetention(
    value.owner,
    read,
    event.observation,
    context,
  );
  const disposition = retentionDisposition(retention);
  if (disposition) return disposition;
  if (!sameInvoicePassSource(value.owner, read)) return defer('source_changed');
  const comparison = append(value.comparison, read);
  return advanced({
    ...value,
    phase: event.more ? 'retaining' : 'verify-head',
    afterId: read.invoicePaymentId,
    comparison,
  });
}
function append(
  value: InvoicePass['comparison'],
  read: OwnedPaymentObservation,
): InvoicePass['comparison'] {
  if (value.kind === 'overflow')
    return { ...value, retainedCount: value.retainedCount + 1 };
  return value.reads.length < invoicePassLimit
    ? { kind: 'bounded', reads: [...value.reads, read] }
    : {
        kind: 'overflow',
        prefix: value.reads,
        retainedCount: invoicePassLimit + 1,
      };
}
function exhausted(value: InvoicePass, beforeId: string | null) {
  if (value.phase !== 'retaining' || beforeId !== value.afterId) return refuse;
  return value.afterId === null
    ? defer('zero_membership')
    : advanced({ ...value, phase: 'verify-head' });
}
function freshReceipt(
  value: InvoicePass,
  receipt: {
    readonly passId: string;
    readonly jobId: string;
    readonly claimId: string;
    readonly startedAt: string;
    readonly observedAt: string;
  },
  context: InvoicePassAuthority,
) {
  return (
    receipt.passId === value.id &&
    receipt.jobId === value.jobId &&
    receipt.claimId === context.claim.id &&
    Date.parse(receipt.startedAt) >= Date.parse(context.claim.claimedAt) &&
    Date.parse(receipt.observedAt) >= Date.parse(receipt.startedAt) &&
    Date.parse(receipt.observedAt) <= Date.parse(context.now)
  );
}
function head(
  value: InvoicePass,
  event: Extract<InvoicePassEvent, { kind: 'head' }>,
  context: InvoicePassAuthority,
) {
  if (value.phase !== 'verify-head') return refuse;
  const parsed = invoicePassHeadSchema.safeParse(event.receipt);
  if (!parsed.success) return refuse;
  const receipt = parsed.data;
  if (
    !freshReceipt(value, receipt, context) ||
    !sameInvoiceOwner(value.owner, receipt.owner) ||
    receipt.request.invoiceId !== value.owner.invoiceId
  )
    return refuse;
  const retention = headRetention(
    value.owner,
    receipt.reads,
    event.retained,
    context,
  );
  const disposition = retentionDisposition(retention);
  if (disposition) return disposition;
  return classifyHead(value, receipt);
}
function classifyHead(
  value: InvoicePass,
  receipt: import('./billing-invoice-pass').InvoicePassHead,
) {
  if (!equal(value.owner, receipt.owner)) return defer('source_changed');
  if (receipt.reads.length === 0) return defer('zero_membership');
  if (receipt.hasMore || value.comparison.kind === 'overflow')
    return defer('multipage_continuity');
  if (!equal(receipt.reads, value.comparison.reads))
    return defer('membership_changed');
  if (value.owner.source.kind !== 'purchase' || value.owner.period === null)
    return defer('source_unknown');
  return advanced({ ...value, phase: 'verify-invoice', head: receipt });
}
function invoice(
  value: InvoicePass,
  event: Extract<InvoicePassEvent, { kind: 'invoice' }>,
  context: InvoicePassAuthority,
) {
  if (value.phase !== 'verify-invoice') return refuse;
  const parsed = invoicePassInvoiceSchema.safeParse(event.receipt);
  if (!parsed.success) return refuse;
  const receipt = parsed.data;
  if (!freshInvoiceReceipt(value, receipt, context)) return refuse;
  const retained = readInvoicePassWitness(
    value.owner,
    receipt.owner.source,
    event.observation,
    context,
  );
  if (!retained) return refuse;
  if (conflicting(retained.state)) return defer('conflicting_evidence');
  if (!equal(value.owner, receipt.owner)) return defer('invoice_changed');
  if (
    value.comparison.kind !== 'bounded' ||
    value.comparison.reads.length === 0 ||
    value.afterId === null
  )
    return refuse;
  return {
    kind: 'covered',
    coverage: {
      kind: 'complete',
      mode: value.owner.mode,
      customerId: value.owner.customerId,
      invoiceId: value.owner.invoiceId,
      paymentCount: value.comparison.reads.length,
      lastPaymentId: value.afterId,
    },
  } as const;
}

function retentionDisposition(retention: 'missing' | 'conflict' | 'retained') {
  if (retention === 'missing') return refuse;
  if (retention === 'conflict') return defer('conflicting_evidence');
  return null;
}
function conflicting(state: {
  readonly kind: string;
  readonly reason?: string;
}) {
  return state.kind === 'owed' && state.reason === 'conflicting_evidence';
}

function freshInvoiceReceipt(
  value: Extract<InvoicePass, { phase: 'verify-invoice' }>,
  receipt: import('./billing-invoice-pass').InvoicePassInvoice,
  context: InvoicePassAuthority,
) {
  return (
    freshReceipt(value, receipt, context) &&
    sameInvoiceOwner(value.owner, receipt.owner) &&
    Date.parse(receipt.startedAt) >= Date.parse(value.head.observedAt)
  );
}
