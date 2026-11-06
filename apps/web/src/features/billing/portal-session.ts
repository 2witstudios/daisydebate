import type Stripe from 'stripe';
import { z } from 'zod';

type Customer = { readonly id: string; readonly mode: 'test' | 'live' };
type Subject = { readonly userId: string; readonly actorId: string };
type Parameters = {
  readonly customer: string;
  readonly configuration: string;
  readonly return_url: string;
};
const sessionSchema = z.object({
  id: z
    .string()
    .regex(/^bps_[A-Za-z0-9_]+$/)
    .max(255),
  object: z.literal('billing_portal.session'),
  customer: z.string(),
  configuration: z.string(),
  livemode: z.boolean(),
  return_url: z.string(),
  url: z.string().max(8192),
});
const unavailable = { kind: 'unavailable' } as const;

/** Management stays independent from purchase release; the customer reader owns account fencing. */
export function createPortalSession(input: {
  readonly mode: Customer['mode'];
  readonly configurationId: string;
  readonly returnOrigin: string;
  readonly customer: (subject: Subject) => Promise<Customer | null>;
  readonly create: (parameters: Parameters) => Promise<unknown>;
}) {
  return async (
    subject: Subject,
  ): Promise<
    { readonly kind: 'redirect'; readonly url: string } | typeof unavailable
  > => {
    const customer = await input.customer(subject);
    if (!customer || customer.mode !== input.mode) return unavailable;
    const parameters = {
      customer: customer.id,
      configuration: input.configurationId,
      return_url: `${input.returnOrigin}/settings/billing`,
    };
    let value: unknown;
    try {
      value = await input.create(parameters);
    } catch {
      return unavailable;
    }
    const parsed = sessionSchema.safeParse(value);
    if (!parsed.success) return unavailable;
    const session = parsed.data;
    if (
      session.customer !== customer.id ||
      session.configuration !== input.configurationId ||
      session.livemode !== (input.mode === 'live') ||
      session.return_url !== parameters.return_url ||
      !URL.canParse(session.url)
    )
      return unavailable;
    const url = new URL(session.url);
    if (
      url.origin !== 'https://billing.stripe.com' ||
      url.username !== '' ||
      url.password !== '' ||
      !(url.pathname === '/p/session' || url.pathname.startsWith('/p/session/'))
    )
      return unavailable;
    // No vendor I/O under the account lock; closure can win while it is in flight.
    const current = await input.customer(subject);
    return current?.id === customer.id && current.mode === customer.mode
      ? { kind: 'redirect', url: session.url }
      : unavailable;
  };
}

export const stripePortalPort =
  (stripe: Pick<Stripe, 'billingPortal'>) =>
  (parameters: Parameters): Promise<unknown> =>
    stripe.billingPortal.sessions.create(parameters, {
      apiVersion: '2026-10-28.endive',
      timeout: 5_000,
      maxNetworkRetries: 0,
    });
