import { z } from 'zod';
import type { Clock } from '@daisy/clock';
import {
  ownedInvoiceObservationSchema,
  ownedPaymentObservationSchema,
} from '@daisy/protocol/billing';
import {
  observeClosurePayment,
  observeClosurePaymentChronology,
} from './closure-payment';
import {
  expandedClosurePaymentParts,
  type ClosurePaymentReadPort,
} from './closure-payment-reader';
const vendorId = (prefix: string) =>
  z
    .string()
    .max(255)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
const ref = (prefix: string) =>
  z.union([
    vendorId(prefix),
    z.object({ id: vendorId(prefix) }).transform((x) => x.id),
  ]);
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const seconds = z.number().int().nonnegative().max(253_402_300_799);
const payment = z.object({
  id: vendorId('inpay'),
  object: z.literal('invoice_payment'),
  livemode: z.boolean(),
  invoice: z.object({
    id: vendorId('in'),
    object: z.literal('invoice'),
    customer: ref('cus'),
    livemode: z.boolean(),
  }),
  status: z.enum(['paid', 'open', 'canceled']),
  amount_paid: minor.nullable().optional(),
  status_transitions: z.object({ paid_at: seconds.nullable() }),
});
const unavailable = { kind: 'unavailable' } as const;

/** Partial positive facts stay financial observations; failed/mismatched reads supply no absence or money authority. */
export function createPaymentObservationReader(input: {
  readonly port: ClosurePaymentReadPort;
  readonly clock: Clock;
  readonly mode: 'test' | 'live';
}) {
  return async (request: {
    readonly invoice: unknown;
    readonly paymentId: string;
    readonly closedAt: string;
  }) => {
    const invoice = ownedInvoiceObservationSchema.safeParse(request.invoice);
    if (
      !invoice.success ||
      invoice.data.mode !== input.mode ||
      !vendorId('inpay').safeParse(request.paymentId).success ||
      !z.iso.datetime({ precision: 3 }).safeParse(request.closedAt).success
    )
      return unavailable;
    try {
      const raw = await input.port.payment(request.paymentId);
      return normalizePaymentObservation(raw, {
        invoice: invoice.data,
        paymentId: request.paymentId,
        closedAt: request.closedAt,
        now: input.clock.now(),
      });
    } catch {
      return unavailable;
    }
  };
}
function normalizePaymentObservation(
  raw: unknown,
  request: {
    readonly invoice: ReturnType<typeof ownedInvoiceObservationSchema.parse>;
    readonly paymentId: string;
    readonly closedAt: string;
    readonly now: string;
  },
) {
  const parsed = payment.safeParse(raw);
  if (!parsed.success) return unavailable;
  const value = parsed.data,
    invoice = request.invoice;
  if (!ownsPaymentRead(value, request)) return unavailable;
  const parts = expandedClosurePaymentParts(raw, request.paymentId);
  const facts = {
    status: value.status,
    paidAtSeconds: value.status_transitions.paid_at,
    amountPaidMinor: value.amount_paid ?? null,
    charge: partialCharge(parts, invoice),
    period: null,
  };
  const evidence = paymentEvidence(raw, request, parts, facts);
  const read = ownedPaymentObservationSchema.safeParse({
    ...invoice,
    invoicePaymentId: request.paymentId,
    evidence,
  });
  return read.success
    ? ({ kind: 'read', read: read.data } as const)
    : unavailable;
}
function ownsPaymentRead(
  value: z.infer<typeof payment>,
  request: Parameters<typeof normalizePaymentObservation>[1],
) {
  const invoice = request.invoice;
  return (
    value.id === request.paymentId &&
    value.invoice.id === invoice.invoiceId &&
    value.invoice.customer === invoice.customerId &&
    value.livemode === (invoice.mode === 'live') &&
    value.invoice.livemode === value.livemode
  );
}
function paymentEvidence(
  raw: unknown,
  request: Parameters<typeof normalizePaymentObservation>[1],
  parts: ReturnType<typeof expandedClosurePaymentParts>,
  facts: {
    readonly status: 'paid' | 'open' | 'canceled';
    readonly paidAtSeconds: number | null;
    readonly amountPaidMinor: number | null;
    readonly charge: ReturnType<typeof partialCharge>;
    readonly period: null;
  },
) {
  const invoice = request.invoice;
  const source = invoice.source;
  const owner =
    source.kind === 'purchase'
      ? {
          mode: invoice.mode,
          customerId: invoice.customerId,
          priceId: source.priceId,
          vendorSubscriptionId: source.vendorSubscriptionId,
        }
      : null;
  const full =
    parts && owner
      ? observeClosurePayment({
          ...parts,
          owner,
          closedAt: request.closedAt,
          now: request.now,
        })
      : null;
  const chronology = owner
    ? observeClosurePaymentChronology({
        owner,
        invoiceId: invoice.invoiceId,
        invoicePaymentId: request.paymentId,
        invoice: (raw as { invoice: unknown }).invoice,
        invoicePayment: raw,
      })
    : null;
  const evidence =
    full?.kind === 'refund'
      ? {
          kind: 'verified',
          payment: {
            ...full.payment,
            priceId: source.priceId,
            invoicePaymentId: request.paymentId,
          },
        }
      : chronology?.kind === 'chronology'
        ? { kind: 'chronology', proof: chronology.proof, facts }
        : { kind: 'partial', facts };
  return evidence;
}
const charge = z.object({
  id: vendorId('ch'),
  object: z.literal('charge'),
  customer: ref('cus'),
  livemode: z.boolean(),
  paid: z.boolean(),
  amount_captured: minor,
  currency: z.string().regex(/^[a-z]{3}$/),
  payment_intent: ref('pi').nullable(),
});
const intent = z.object({
  id: vendorId('pi'),
  object: z.literal('payment_intent'),
  customer: ref('cus'),
  livemode: z.boolean(),
  latest_charge: ref('ch'),
});
function partialCharge(
  parts: ReturnType<typeof expandedClosurePaymentParts>,
  invoice: ReturnType<typeof ownedInvoiceObservationSchema.parse>,
) {
  const unknown = { kind: 'unresolved' } as const;
  if (!parts) return unknown;
  const parsed = charge.safeParse(parts.charge);
  if (
    !parsed.success ||
    parsed.data.customer !== invoice.customerId ||
    parsed.data.livemode !== (invoice.mode === 'live')
  )
    return unknown;
  const value = parsed.data;
  if (!ownsChargeIntent(value, parts.paymentIntent)) return unknown;
  return {
    kind: 'observed',
    id: value.id,
    paid: value.paid,
    capturedMinor: value.amount_captured,
    currency: value.currency,
  } as const;
}

function ownsChargeIntent(
  value: z.infer<typeof charge>,
  paymentIntent: unknown,
) {
  if (paymentIntent === null) return value.payment_intent === null;
  const linked = intent.safeParse(paymentIntent);
  return (
    linked.success &&
    linked.data.id === value.payment_intent &&
    linked.data.latest_charge === value.id &&
    linked.data.customer === value.customer &&
    linked.data.livemode === value.livemode
  );
}
