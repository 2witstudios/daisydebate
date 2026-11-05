import Stripe from 'stripe';
import { z } from 'zod';

const eventTypes = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.deleted',
] as const;

const envelope = z.object({
  id: z
    .string()
    .regex(/^evt_[A-Za-z0-9]+$/)
    .max(255),
  object: z.literal('event'),
  livemode: z.boolean(),
  type: z.string().max(128),
  data: z.object({ object: z.unknown() }),
});
const customerId = z
  .string()
  .regex(/^cus_[A-Za-z0-9]+$/)
  .max(255);
const customerReference = z
  .object({ customer: customerId })
  .transform((value) => value.customer);
const deletedCustomer = z
  .object({ id: customerId, object: z.literal('customer') })
  .transform((value) => value.id);
const eventType = z.enum(eventTypes);

/** Persist the hint, never the raw body or an entitlement asserted by it. */
export type BillingWebhookHint = {
  readonly eventId: string;
  readonly customerId: string;
  readonly eventType: (typeof eventTypes)[number];
};

type Verification =
  | { readonly kind: 'accepted'; readonly hint: BillingWebhookHint }
  | { readonly kind: 'ignored' | 'rejected' };

function synchronizationHint(
  verified: unknown,
  mode: 'test' | 'live',
): Verification {
  const parsed = envelope.safeParse(verified);
  if (!parsed.success || parsed.data.livemode !== (mode === 'live'))
    return { kind: 'rejected' };
  const type = eventType.safeParse(parsed.data.type);
  if (!type.success) return { kind: 'ignored' };
  const target = (
    type.data === 'customer.deleted' ? deletedCustomer : customerReference
  ).safeParse(parsed.data.data.object);
  if (!target.success) return { kind: 'rejected' };
  return {
    kind: 'accepted',
    hint: {
      eventId: parsed.data.id,
      customerId: target.data,
      eventType: type.data,
    },
  };
}

/** Stripe checks old signatures; also refuse ambiguous or far-future timestamps. */
function freshDelivery(signature: string, receivedAt: number) {
  const timestamps = signature
    .split(',')
    .filter((part) => part.startsWith('t='));
  if (timestamps.length !== 1 || !/^t=[0-9]+$/.test(timestamps[0]!))
    return false;
  const timestamp = Number(timestamps[0]!.slice(2));
  return (
    Number.isSafeInteger(timestamp) &&
    Math.abs(Math.floor(receivedAt / 1000) - timestamp) <= 300
  );
}

export async function verifyBillingWebhook({
  body,
  signature,
  secret,
  mode,
  receivedAt,
}: {
  readonly body: Uint8Array;
  readonly signature: string;
  readonly secret: string;
  readonly mode: 'test' | 'live';
  readonly receivedAt: number;
}): Promise<Verification> {
  if (
    body.byteLength > 256 * 1024 ||
    signature.length > 4096 ||
    !Number.isSafeInteger(receivedAt) ||
    receivedAt <= 0 ||
    !freshDelivery(signature, receivedAt)
  )
    return { kind: 'rejected' };
  try {
    const verified = await Stripe.webhooks.constructEventAsync(
      body,
      signature,
      secret,
      300,
      undefined,
      receivedAt,
    );
    return synchronizationHint(verified, mode);
  } catch {
    // SDK errors can hold the entire payload and signature; neither leaves this boundary.
    return { kind: 'rejected' };
  }
}
