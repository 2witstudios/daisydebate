import { z } from 'zod';
import { idSchema } from './primitives';
import { ownedInvoiceObservationSchema } from './billing-payment-observation-source';
import { ownedPaymentObservationSchema } from './billing-payment-observation-read';
import {
  observedClosurePaymentSchema,
  type BillingPaymentObservation,
} from './billing-payment-observation';

/** This comparison limit never caps the number of durable financial obligations retained. */
export const invoicePassLimit = 20;
const instant = z.iso.datetime({ precision: 3 });
const paymentId = z
  .string()
  .max(255)
  .regex(/^inpay_[A-Za-z0-9_]+$/);
export const invoicePassOwnerSchema = ownedInvoiceObservationSchema.extend({
  userId: idSchema,
  closedAt: instant,
  period: observedClosurePaymentSchema.shape.period.nullable(),
});
export type InvoicePassOwner = z.infer<typeof invoicePassOwnerSchema>;
const comparison = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('bounded'),
    reads: z.array(ownedPaymentObservationSchema).max(invoicePassLimit),
  }),
  z.strictObject({
    kind: z.literal('overflow'),
    prefix: z.array(ownedPaymentObservationSchema).length(invoicePassLimit),
    retainedCount: z
      .number()
      .int()
      .min(invoicePassLimit + 1)
      .max(Number.MAX_SAFE_INTEGER),
  }),
]);
const sourceRead = {
  passId: idSchema,
  jobId: idSchema,
  claimId: idSchema,
  startedAt: instant,
  observedAt: instant,
  owner: invoicePassOwnerSchema,
};
/** Constructed after one fresh unfiltered HEAD response; filters/cursors are not representable. */
export const invoicePassHeadSchema = z.strictObject({
  ...sourceRead,
  kind: z.literal('head'),
  request: z.strictObject({
    invoiceId: z
      .string()
      .max(255)
      .regex(/^in_[A-Za-z0-9_]+$/),
    limit: z.literal(invoicePassLimit),
  }),
  hasMore: z.boolean(),
  reads: z.array(ownedPaymentObservationSchema).max(invoicePassLimit),
});
export type InvoicePassHead = z.infer<typeof invoicePassHeadSchema>;
export const invoicePassInvoiceSchema = z.strictObject({
  ...sourceRead,
  kind: z.literal('invoice'),
});
export type InvoicePassInvoice = z.infer<typeof invoicePassInvoiceSchema>;
const base = {
  id: idSchema,
  jobId: idSchema,
  beganAt: instant,
  owner: invoicePassOwnerSchema,
  afterId: paymentId.nullable(),
  comparison,
};
const pass = z.discriminatedUnion('phase', [
  z.strictObject({ ...base, phase: z.literal('retaining') }),
  z.strictObject({ ...base, phase: z.literal('verify-head') }),
  z.strictObject({
    ...base,
    phase: z.literal('verify-invoice'),
    head: invoicePassHeadSchema,
  }),
]);
export type InvoicePass = z.infer<typeof pass>;
export const invoicePassSchema = pass.refine(
  (value) =>
    validPassTimes(value) &&
    validPassComparison(value) &&
    (value.phase !== 'verify-invoice' || validFinalHead(value)),
);
function validPassTimes(value: InvoicePass) {
  return (
    Date.parse(value.beganAt) >= Date.parse(value.owner.closedAt) &&
    (value.owner.source.kind !== 'purchase' ||
      Date.parse(value.owner.source.admittedAt) <=
        Date.parse(value.owner.closedAt))
  );
}
function validPassComparison(value: InvoicePass) {
  const reads =
    value.comparison.kind === 'bounded'
      ? value.comparison.reads
      : value.comparison.prefix;
  if (
    !reads.every(
      (read) =>
        sameInvoiceOwner(value.owner, read) &&
        sameInvoicePassSource(value.owner, read),
    )
  )
    return false;
  return value.comparison.kind === 'bounded'
    ? value.afterId === (reads.at(-1)?.invoicePaymentId ?? null)
    : value.afterId !== null;
}
export const invoicePassAuthoritySchema = z.strictObject({
  now: instant,
  jobId: idSchema,
  userId: idSchema,
  claim: z.strictObject({
    id: idSchema,
    claimedAt: instant,
    expiresAt: instant,
  }),
});
export type InvoicePassAuthority = z.infer<typeof invoicePassAuthoritySchema>;
export type InvoicePassEvent =
  | {
      readonly kind: 'retained';
      readonly beforeId: string | null;
      readonly read: unknown;
      readonly observation: BillingPaymentObservation;
      readonly more: boolean;
    }
  | { readonly kind: 'exhausted'; readonly beforeId: string | null }
  | {
      readonly kind: 'head';
      readonly receipt: unknown;
      readonly retained: readonly BillingPaymentObservation[];
    }
  | {
      readonly kind: 'invoice';
      readonly receipt: unknown;
      readonly observation: BillingPaymentObservation;
    };
export function sameInvoiceOwner(
  owner: InvoicePassOwner,
  read: {
    readonly mode: string;
    readonly customerId: string;
    readonly invoiceId: string;
  },
) {
  return (
    owner.mode === read.mode &&
    owner.customerId === read.customerId &&
    owner.invoiceId === read.invoiceId
  );
}

export function sameInvoicePassSource(
  owner: InvoicePassOwner,
  read: z.infer<typeof ownedPaymentObservationSchema>,
) {
  const period =
    read.evidence.kind === 'verified'
      ? read.evidence.payment.period
      : read.evidence.facts.period;
  return (
    JSON.stringify(owner.source) === JSON.stringify(read.source) &&
    (owner.period === null ||
      period === null ||
      JSON.stringify(owner.period) === JSON.stringify(period))
  );
}

function validFinalHead(
  value: Extract<InvoicePass, { phase: 'verify-invoice' }>,
) {
  return finalHeadBinding(value) && finalHeadMembership(value);
}
function finalHeadBinding(
  value: Extract<InvoicePass, { phase: 'verify-invoice' }>,
) {
  const head = value.head;
  return (
    head.passId === value.id &&
    head.jobId === value.jobId &&
    head.request.invoiceId === value.owner.invoiceId &&
    Date.parse(head.startedAt) >= Date.parse(value.beganAt) &&
    Date.parse(head.observedAt) >= Date.parse(head.startedAt) &&
    JSON.stringify(head.owner) === JSON.stringify(value.owner)
  );
}
function finalHeadMembership(
  value: Extract<InvoicePass, { phase: 'verify-invoice' }>,
) {
  const head = value.head;
  return (
    value.comparison.kind === 'bounded' &&
    value.owner.source.kind === 'purchase' &&
    value.owner.period !== null &&
    head.hasMore === false &&
    head.reads.length > 0 &&
    JSON.stringify(head.reads) === JSON.stringify(value.comparison.reads) &&
    new Set(head.reads.map((read) => read.invoicePaymentId)).size ===
      head.reads.length
  );
}
