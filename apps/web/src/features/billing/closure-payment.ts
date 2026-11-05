import { z } from 'zod';
import {
  closurePaymentDisposition,
  type RefundAction,
} from '@daisy/protocol/billing';
import { invoiceSchema } from './subscription-vendor-facts';

const vendorId = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`))
    .max(255);
const reference = (prefix: string) =>
  z.union([
    vendorId(prefix),
    z.object({ id: vendorId(prefix) }).transform((value) => value.id),
  ]);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const seconds = z.number().int().nonnegative().max(253_402_300_799);
const instant = z.iso.datetime({ precision: 3 });
const ownerSchema = z.strictObject({
  mode: z.enum(['test', 'live']),
  customerId: vendorId('cus'),
  vendorSubscriptionId: vendorId('sub'),
  priceId: vendorId('price'),
});
export function readClosurePaymentOwner(value: unknown) {
  const parsed = ownerSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
const allocationSchema = z
  .object({
    id: vendorId('inpay'),
    object: z.literal('invoice_payment'),
    invoice: reference('in'),
    livemode: z.boolean(),
    currency: z.literal('usd'),
    status: z.literal('paid'),
    amount_paid: money.positive(),
    amount_requested: money.positive(),
    status_transitions: z.object({ paid_at: seconds, canceled_at: z.null() }),
    payment: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('payment_intent'),
        payment_intent: reference('pi'),
      }),
      z.object({ type: z.literal('charge'), charge: reference('ch') }),
    ]),
  })
  .refine((value) => value.amount_paid <= value.amount_requested);
const chargeSchema = z
  .object({
    id: vendorId('ch'),
    object: z.literal('charge'),
    customer: reference('cus'),
    livemode: z.boolean(),
    currency: z.literal('usd'),
    paid: z.literal(true),
    captured: z.literal(true),
    status: z.literal('succeeded'),
    amount: money.positive(),
    amount_captured: money.positive(),
    payment_intent: reference('pi').nullable(),
  })
  .refine((value) => value.amount_captured <= value.amount);
const intentSchema = z.object({
  id: vendorId('pi'),
  object: z.literal('payment_intent'),
  customer: reference('cus'),
  livemode: z.boolean(),
  currency: z.literal('usd'),
  status: z.literal('succeeded'),
  amount_received: money.positive(),
  latest_charge: reference('ch'),
});
const factsSchema = z.strictObject({
  owner: ownerSchema,
  closedAt: instant,
  now: instant,
  invoice: invoiceSchema.extend({ amount_paid: money }),
  invoicePayment: allocationSchema,
  charge: chargeSchema,
  paymentIntent: intentSchema.nullable(),
});
type Facts = z.infer<typeof factsSchema>;
type Payment = Pick<
  RefundAction,
  | 'mode'
  | 'customerId'
  | 'chargeId'
  | 'invoiceId'
  | 'vendorSubscriptionId'
  | 'amountMinor'
  | 'currency'
  | 'paidAtSeconds'
  | 'period'
>;
type Observation =
  | { readonly kind: 'refund'; readonly payment: Payment }
  | { readonly kind: 'pre-closure' | 'unresolved' };

function ownsInvoice(facts: Facts) {
  const { owner, invoice } = facts;
  const line = invoice.lines.data[0]!;
  return (
    invoice.customer === owner.customerId &&
    invoice.livemode === (owner.mode === 'live') &&
    line.livemode === invoice.livemode &&
    line.amount === 1000 &&
    invoice.parent.subscription_details.subscription ===
      owner.vendorSubscriptionId &&
    line.parent.subscription_item_details.subscription ===
      owner.vendorSubscriptionId &&
    line.pricing.price_details.price === owner.priceId
  );
}
function ownsCharge(facts: Facts) {
  const { owner, invoice, invoicePayment: allocation, charge } = facts;
  return (
    charge.customer === owner.customerId &&
    charge.livemode === (owner.mode === 'live') &&
    allocation.livemode === charge.livemode &&
    allocation.invoice === invoice.id &&
    allocation.amount_paid <= invoice.amount_paid &&
    allocation.amount_paid === charge.amount_captured
  );
}
function matchesPayment(facts: Facts) {
  const { invoicePayment: allocation, charge, paymentIntent: intent } = facts;
  const payment = allocation.payment;
  if (payment.type === 'charge')
    return (
      payment.charge === charge.id &&
      charge.payment_intent === null &&
      intent === null
    );
  return (
    intent !== null &&
    payment.payment_intent === intent.id &&
    charge.payment_intent === intent.id &&
    intent.customer === charge.customer &&
    intent.livemode === charge.livemode &&
    intent.latest_charge === charge.id &&
    intent.amount_received === allocation.amount_paid
  );
}

/** Only a verified whole-charge allocation identifies an automatic closure refund; ambiguity remains owed. */
export function observeClosurePayment(input: {
  readonly owner: unknown;
  readonly closedAt: string;
  readonly now: string;
  readonly invoice: unknown;
  readonly invoicePayment: unknown;
  readonly charge: unknown;
  readonly paymentIntent: unknown;
}): Observation {
  const parsed = factsSchema.safeParse(input);
  if (!parsed.success) return { kind: 'unresolved' };
  const facts = parsed.data;
  if (!ownsInvoice(facts) || !ownsCharge(facts) || !matchesPayment(facts))
    return { kind: 'unresolved' };
  const period = facts.invoice.lines.data[0]!.period;
  if (
    !seconds.safeParse(period.start).success ||
    !seconds.safeParse(period.end).success
  )
    return { kind: 'unresolved' };
  const paidAtSeconds = facts.invoicePayment.status_transitions.paid_at;
  const kind = closurePaymentDisposition({
    closedAt: facts.closedAt,
    now: facts.now,
    paidAtSeconds,
  });
  if (kind !== 'refund') return { kind };
  return {
    kind,
    payment: {
      mode: facts.owner.mode,
      customerId: facts.owner.customerId,
      chargeId: facts.charge.id,
      invoiceId: facts.invoice.id,
      vendorSubscriptionId: facts.owner.vendorSubscriptionId,
      amountMinor: facts.invoicePayment.amount_paid,
      currency: 'usd',
      paidAtSeconds,
      period: {
        startsAt: new Date(period.start * 1000).toISOString(),
        endsAt: new Date(period.end * 1000).toISOString(),
      },
    },
  };
}
