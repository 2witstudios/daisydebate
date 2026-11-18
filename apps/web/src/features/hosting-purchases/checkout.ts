import type Stripe from 'stripe';
import { z } from 'zod';
import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import type { BillingConfig } from '@daisy/config';
import type {
  TabStore,
  TournamentHostingAccount,
  TournamentHostingPurchaseRow,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import {
  hostingOffers,
  type PaidHostingTier,
} from '@daisy/protocol/lobby/hosting-tier';
import { hostLobbyResource } from '../tab/operations/host-lobby-resource';
import { CommandDenied } from '../tab/commands/run-command';
import type { TabPrincipal } from '../tab/tab-principal';
import {
  hostingCheckoutParameters,
  observeHostingSession,
  verifiedHostingPrice,
  type HostingCheckoutPurchase,
  type HostingSessionObservation,
} from './checkout-session';
import { hostingAccountView, type HostingAccountView } from './hosting-account';

/** The four Stripe calls hosting makes; a fake stands in for it in tests. */
export type HostingStripePort = {
  readonly retrievePrice: (priceId: string) => Promise<unknown>;
  readonly createSession: (
    parameters: Stripe.Checkout.SessionCreateParams,
    idempotencyKey: string,
  ) => Promise<unknown>;
  readonly retrieveSession: (sessionId: string) => Promise<unknown>;
  readonly expireSession: (sessionId: string) => Promise<unknown>;
};

export function stripeHostingPort(
  stripe: Pick<Stripe, 'checkout' | 'prices'>,
): HostingStripePort {
  const options = {
    apiVersion: '2026-10-28.endive',
    timeout: 5_000,
    maxNetworkRetries: 0,
  } as const;
  const expand = ['payment_intent.latest_charge'];
  return {
    retrievePrice: (id) => stripe.prices.retrieve(id, {}, options),
    createSession: (parameters, idempotencyKey) =>
      stripe.checkout.sessions.create(parameters, {
        ...options,
        idempotencyKey,
      }),
    retrieveSession: (id) =>
      stripe.checkout.sessions.retrieve(id, { expand }, options),
    expireSession: (id) => stripe.checkout.sessions.expire(id, {}, options),
  };
}

type HostEventPrices = NonNullable<
  Extract<BillingConfig, { kind: 'stripe' }>['hostEventPrices']
>;
export type HostingDependencies = {
  readonly store: Pick<
    TabStore,
    'tournamentHosting' | 'tournamentHostingSettlement' | 'hostedTournaments'
  >;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  /** Null where billing or the host event prices are not configured. */
  readonly vendor: {
    readonly port: HostingStripePort;
    readonly prices: HostEventPrices;
    readonly mode: 'test' | 'live';
  } | null;
  readonly origin: () => string;
  readonly newId: () => string;
};

const asCheckout = (
  row: TournamentHostingPurchaseRow,
): HostingCheckoutPurchase => ({
  id: row.id,
  lobbyId: row.lobbyId,
  tier: row.tier,
  amount: row.amount,
  mode: row.mode,
  vendorSessionId: row.vendorSessionId,
});

/** Only the tournament's own managers see or buy its hosting. */
const managed = (
  dependencies: HostingDependencies,
  principal: TabPrincipal,
  account: TournamentHostingAccount | null,
): account is TournamentHostingAccount => {
  if (!account) return false;
  try {
    return dependencies.authorize({
      principal,
      capability: 'lobby.setup.manage',
      resource: hostLobbyResource(
        account.lobby,
        account.authorization.organization,
        account.ownerActorId,
      ),
      context: {
        account: account.authorization.account,
        grants: account.authorization.grants,
        now: account.checkedAt,
      },
    }).allow;
  } catch (error) {
    if (error instanceof CommandDenied) return false;
    throw error;
  }
};

/** A host's view of one tournament's hosting; null when they do not manage it. */
export const readHostingAccount =
  (dependencies: HostingDependencies) =>
  (principal: TabPrincipal, lobbyId: string): Promise<HostingAccountView | null> =>
    dependencies.store.tournamentHosting(
      { viewerUserId: principal.userId, lobbyId },
      async (account) =>
        managed(dependencies, principal, account)
          ? hostingAccountView(account, account.checkedAt)
          : null,
    );

/**
 * Settles one purchase from the session Stripe holds for it. The session is
 * retrieved outside the transaction; every write is guarded by the purchase
 * still being open, so a repeat (webhook, return page) changes nothing.
 */
export const settleHostingPurchase =
  (dependencies: HostingDependencies) =>
  async (target: {
    readonly lobbyId: string;
    readonly purchaseId: string;
  }): Promise<HostingSessionObservation | null> => {
    const vendor = dependencies.vendor;
    if (!vendor) return null;
    const purchase = await dependencies.store.tournamentHostingSettlement(
      target,
      async (row) => row,
    );
    if (
      !purchase ||
      purchase.state !== 'open' ||
      purchase.mode !== vendor.mode ||
      purchase.vendorSessionId === null
    )
      return null;
    const observed = observeHostingSession(
      asCheckout(purchase),
      await vendor.port.retrieveSession(purchase.vendorSessionId),
    );
    await dependencies.store.tournamentHostingSettlement(
      target,
      async (_row, writes) => {
        if (observed.kind === 'paid')
          await writes.paid(purchase.id, {
            vendorPaymentIntentId: observed.vendorPaymentIntentId,
            receiptUrl: observed.receiptUrl,
          });
        if (observed.kind === 'expired') await writes.expired(purchase.id);
      },
    );
    return observed;
  };

export type HostingCheckoutDestination =
  | { readonly kind: 'redirect'; readonly url: string }
  | { readonly kind: 'held' }
  | { readonly kind: 'unavailable' };

const createdSessionSchema = z.object({
  id: z
    .string()
    .regex(/^cs_(test|live)_[A-Za-z0-9]+$/)
    .max(255),
  url: z.string().startsWith('https://').max(8192),
});

/**
 * Starts (or resumes) a one-time payment that moves one tournament up to
 * `target`. The amount is decided here from the tier held, never sent by
 * the form; a payment already open for the same move is resumed.
 */
export const startHostingCheckout =
  (dependencies: HostingDependencies) =>
  async (
    principal: TabPrincipal,
    lobbyId: string,
    target: PaidHostingTier,
  ): Promise<HostingCheckoutDestination> => {
    const vendor = dependencies.vendor;
    if (!vendor) return { kind: 'unavailable' };
    const settle = settleHostingPurchase(dependencies);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const step = await dependencies.store.tournamentHosting(
        { viewerUserId: principal.userId, lobbyId },
        async (account, writes) => {
          if (!managed(dependencies, principal, account))
            throw createAppError('NOT_FOUND');
          const view = hostingAccountView(account, account.checkedAt);
          const owed = view.upgrades.find((option) => option.tier === target);
          const open = account.purchases.find((row) => row.state === 'open');
          if (open) return { kind: 'resolve-open' as const, open, owed, view };
          if (!owed) return { kind: 'held' as const };
          const row = {
            id: dependencies.newId(),
            payerUserId: principal.userId,
            tier: target,
            amount: owed.owed,
            mode: vendor.mode,
          };
          return { kind: 'create' as const, row, view };
        },
      );
      if (step.kind === 'held') return step;
      if (step.kind === 'resolve-open') {
        const { open, owed } = step;
        const same =
          owed !== undefined &&
          open.tier === target &&
          open.amount === owed.owed &&
          open.payerUserId === principal.userId &&
          open.mode === vendor.mode;
        if (same && open.vendorSessionId === null)
          return createSession(dependencies, vendor, asCheckout(open), step.view);
        if (same) {
          const observed = await settle({ lobbyId, purchaseId: open.id });
          if (observed?.kind === 'open' && observed.url)
            return { kind: 'redirect', url: observed.url };
          if (observed?.kind === 'mismatch' || observed === null)
            return { kind: 'unavailable' };
          continue;
        }
        // Another move is open: close it at Stripe first, so it can never be
        // paid after Daisy stopped waiting for it.
        if (open.vendorSessionId !== null && open.mode === vendor.mode) {
          const observed = await settle({ lobbyId, purchaseId: open.id });
          if (observed?.kind === 'open')
            await vendor.port
              .expireSession(open.vendorSessionId)
              .catch(() => null);
          if (observed?.kind === 'open') {
            const again = await settle({ lobbyId, purchaseId: open.id });
            if (again?.kind === 'open') return { kind: 'unavailable' };
          }
          if (observed?.kind === 'mismatch' || observed === null)
            return { kind: 'unavailable' };
        } else {
          await dependencies.store.tournamentHostingSettlement(
            { lobbyId, purchaseId: open.id },
            (_row, writes) => writes.expired(open.id),
          );
        }
        continue;
      }
      await dependencies.store.tournamentHosting(
        { viewerUserId: principal.userId, lobbyId },
        (_account, writes) => writes.open(step.row),
      );
      return createSession(
        dependencies,
        vendor,
        { ...step.row, lobbyId, vendorSessionId: null },
        step.view,
      );
    }
    return { kind: 'unavailable' };
  };

async function createSession(
  dependencies: HostingDependencies,
  vendor: NonNullable<HostingDependencies['vendor']>,
  purchase: HostingCheckoutPurchase,
  view: HostingAccountView,
): Promise<HostingCheckoutDestination> {
  const price = verifiedHostingPrice(
    purchase.tier,
    vendor.mode,
    await vendor.port
      .retrievePrice(vendor.prices[purchase.tier])
      .catch(() => null),
  );
  if (!price) return { kind: 'unavailable' };
  const base = `${dependencies.origin()}/host/tournaments/${encodeURIComponent(view.handle)}`;
  const parameters = hostingCheckoutParameters(
    purchase,
    purchase.amount === hostingOffers[purchase.tier].unitAmount
      ? { kind: 'price', id: price.id }
      : { kind: 'difference', product: price.product },
    {
      successUrl: `${base}/billing?purchase=${purchase.id}`,
      cancelUrl: `${base}/upgrade`,
    },
  );
  const created = createdSessionSchema.safeParse(
    await vendor.port
      .createSession(parameters, `daisy-hosting-purchase-${purchase.id}`)
      .catch(() => null),
  );
  if (!created.success) return { kind: 'unavailable' };
  await dependencies.store.tournamentHostingSettlement(
    { lobbyId: purchase.lobbyId, purchaseId: purchase.id },
    (_row, writes) => writes.recordSession(purchase.id, created.data.id),
  );
  return { kind: 'redirect', url: created.data.url };
}
