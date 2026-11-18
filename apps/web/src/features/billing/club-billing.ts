import type Stripe from 'stripe';
import { z } from 'zod';
import type { Clock } from '@daisy/clock';
import type { ClubBillingConfig } from '@daisy/config';
import type { ClubSeatAnswer, Database } from '@daisy/db';
import { clubSeatBounds } from '@daisy/protocol/club-seats';
import { createCheckoutVendor, type CheckoutPort } from './checkout-vendor';
import {
  discoverCheckout,
  type CheckoutSearchPort,
} from './checkout-discovery';
import { createPurchaseFlow, type PurchaseDestination } from './purchase-flow';
import { createPortalSession } from './portal-session';
import { clubSubscriptionSchema } from './club-subscription-facts';

type Subject = { readonly userId: string; readonly actorId: string };
type PurchaseStore = ReturnType<Database['billingPurchases']>;
type MemberStore = ReturnType<Database['billingMember']>;
type SeatStore = ReturnType<Database['clubSeats']>;
type PortalCreate = Parameters<typeof createPortalSession>[0]['create'];

/** Stripe calls a Club plan makes beyond Premium's: its subscription and invoices. */
export type ClubPlanPort = {
  readonly subscription: (id: string) => Promise<unknown>;
  readonly updateSeats: (
    id: string,
    parameters: Stripe.SubscriptionUpdateParams,
    idempotencyKey: string,
  ) => Promise<unknown>;
  readonly invoices: (
    customer: string,
    subscription: string,
  ) => Promise<unknown>;
};

const options = {
  apiVersion: '2026-10-28.endive',
  timeout: 5_000,
  maxNetworkRetries: 0,
} as const;

export const stripeClubPlanPort = (
  stripe: Pick<Stripe, 'subscriptions' | 'invoices'>,
): ClubPlanPort => ({
  subscription: (id) => stripe.subscriptions.retrieve(id, {}, options),
  updateSeats: (id, parameters, idempotencyKey) =>
    stripe.subscriptions.update(id, parameters, { ...options, idempotencyKey }),
  invoices: (customer, subscription) =>
    stripe.invoices.list({ customer, subscription, limit: 12 }, options),
});

const invoiceRow = z.object({
  id: z.string().regex(/^in_[A-Za-z0-9_]+$/),
  created: z.number().int().nonnegative(),
  currency: z.literal('usd'),
  status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']),
  billing_reason: z.string().nullable(),
  total: z.number().int(),
  customer: z.string(),
  livemode: z.boolean(),
});
const invoicePage = z.object({
  object: z.literal('list'),
  data: z.array(z.unknown()).max(12),
});
export type ClubInvoiceRow = {
  readonly id: string;
  readonly date: string;
  readonly kind: 'renewal' | 'seat-change' | 'other';
  readonly totalMinor: number;
  readonly status: 'paid' | 'open' | 'void' | 'uncollectible' | 'draft';
};

/** A Stripe card failure on an immediate proration: the seats were not added. */
const paymentFailed = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { type?: unknown }).type === 'StripeCardError' ||
    (error as { code?: unknown }).code === 'card_declined' ||
    (error as { statusCode?: unknown }).statusCode === 402);

export type SeatChangeAnswer =
  | Exclude<ClubSeatAnswer, { kind: 'seat-count-ready' }>
  | { readonly kind: 'payment-failed' }
  | { readonly kind: 'unavailable' };

/**
 * Club billing (ADR 0148): Checkout for N seats, the Club portal, the
 * invoice list and in-app seat changes. A seat increase charges its
 * proration at once and only lands once paid (`always_invoice` +
 * `error_if_incomplete`), so Stripe's quantity is always paid seats; a
 * decrease releases the named seats first, then lowers the quantity with
 * no credit. Neither writes access: the webhook's verified observation does.
 */
export function createClubBilling(input: {
  /** Absent while Club billing is not configured: every vendor act is unavailable. */
  readonly vendor: {
    readonly mode: 'test' | 'live';
    readonly club: ClubBillingConfig;
    readonly checkout: CheckoutPort & CheckoutSearchPort;
    readonly portal: PortalCreate;
    readonly plan: ClubPlanPort;
  } | null;
  readonly clock: Clock;
  readonly returnOrigin: string;
  readonly purchases: PurchaseStore;
  readonly member: MemberStore;
  readonly seats: SeatStore;
}) {
  const config = input.vendor;
  const unavailable = { kind: 'unavailable' } as const;
  /** One bounded purchase step for this club's seat count, fenced by the club's billing owner. */
  const flowFor = (
    active: NonNullable<typeof config>,
    organizationId: string,
    quantity: number,
  ) =>
    createPurchaseFlow({
      admit: (subject) =>
        input.purchases.admit(
          { ...subject, organizationId },
          {
            mode: active.mode,
            priceId: active.club.seatPriceId,
            quantity,
            returnOrigin: input.returnOrigin,
          },
        ),
      store: input.purchases,
      vendor: createCheckoutVendor({
        port: active.checkout,
        clock: input.clock,
        mode: active.mode,
      }),
      discover: (purchase) =>
        discoverCheckout(
          { port: active.checkout, mode: active.mode },
          purchase,
        ),
    });

  return {
    async checkout(
      subject: Subject,
      organizationId: string,
      seats: number,
    ): Promise<PurchaseDestination | typeof unavailable> {
      if (
        !Number.isSafeInteger(seats) ||
        seats < 1 ||
        seats > clubSeatBounds.maxSeats
      )
        return unavailable;
      return config
        ? flowFor(config, organizationId, seats)({ ...subject, organizationId })
        : unavailable;
    },

    portal(subject: Subject, organizationId: string) {
      if (!config) return Promise.resolve(unavailable);
      return createPortalSession({
        mode: config.mode,
        configurationId: config.club.portalConfigurationId,
        returnOrigin: input.returnOrigin,
        returnPath: `/clubs/${organizationId}/billing`,
        customer: () =>
          input.member.portalCustomer({ ...subject, organizationId }),
        create: config.portal,
      })(subject);
    },

    async changeSeats(
      subject: Subject,
      organizationId: string,
      seatCount: number,
      release: {
        readonly seats: readonly string[];
        readonly invitations: readonly string[];
      },
    ): Promise<SeatChangeAnswer> {
      if (!config) return unavailable;
      const ready = await input.seats.command(subject, organizationId, {
        kind: 'prepare-seat-count',
        seatCount,
        release,
      });
      if (ready.kind !== 'seat-count-ready') return ready;
      if (ready.mode !== config.mode) return unavailable;
      if (ready.seatCount === ready.currentSeatCount)
        return { kind: 'changed' };
      const current = clubSubscriptionSchema.safeParse(
        await config.plan.subscription(ready.vendorSubscriptionId),
      );
      if (
        !current.success ||
        current.data.customer !== ready.vendorCustomerId ||
        current.data.items.data[0]!.price.id !== config.club.seatPriceId ||
        current.data.livemode !== (config.mode === 'live')
      )
        return unavailable;
      const item = current.data.items.data[0]!;
      const increase = ready.seatCount > item.quantity;
      try {
        await config.plan.updateSeats(
          ready.vendorSubscriptionId,
          {
            items: [{ id: item.id, quantity: ready.seatCount }],
            proration_behavior: increase ? 'always_invoice' : 'none',
            ...(increase ? { payment_behavior: 'error_if_incomplete' } : {}),
          },
          `club-seats:${ready.vendorSubscriptionId}:${item.quantity}:${ready.seatCount}`,
        );
      } catch (error) {
        if (paymentFailed(error)) return { kind: 'payment-failed' };
        throw error;
      }
      return { kind: 'changed' };
    },

    async invoices(
      subject: Subject,
      organizationId: string,
      vendorSubscriptionId: string,
    ): Promise<readonly ClubInvoiceRow[]> {
      if (!config) return [];
      const customer = await input.member.portalCustomer({
        ...subject,
        organizationId,
      });
      if (!customer || customer.mode !== config.mode) return [];
      let page: unknown;
      try {
        page = await config.plan.invoices(customer.id, vendorSubscriptionId);
      } catch {
        return [];
      }
      const parsed = invoicePage.safeParse(page);
      if (!parsed.success) return [];
      return parsed.data.data.flatMap((value) => {
        const row = invoiceRow.safeParse(value);
        if (
          !row.success ||
          row.data.customer !== customer.id ||
          row.data.livemode !== (config.mode === 'live')
        )
          return [];
        return [
          {
            id: row.data.id,
            date: new Date(row.data.created * 1000).toISOString(),
            kind:
              row.data.billing_reason === 'subscription_update'
                ? ('seat-change' as const)
                : row.data.billing_reason === 'subscription_cycle' ||
                    row.data.billing_reason === 'subscription_create'
                  ? ('renewal' as const)
                  : ('other' as const),
            totalMinor: row.data.total,
            status: row.data.status,
          },
        ];
      });
    },
  };
}
