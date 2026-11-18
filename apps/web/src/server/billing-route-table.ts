import type { App } from './app';
import type { composeBillingRoutes } from '../features/billing/native-composition';
import type { composeClubs } from '../features/clubs/composition';
import type { BillingFetch } from './billing-stripe';
import type { OperationName } from '../features/ops/operation-names';
import { handleOperation } from './http';

type BillingRoutes = ReturnType<typeof composeBillingRoutes> & {
  readonly clubs: ReturnType<typeof composeClubs>;
};
export type BillingRouteLoader = () => Promise<{
  readonly billingRoutes: (app: App, fetch: BillingFetch) => BillingRoutes;
}>;

/** The process that owns App also owns Billing's complete error/member boundary. */
export function createLazyBillingRoutes(
  app: App,
  fetch: BillingFetch,
  load: BillingRouteLoader,
) {
  let held: Promise<BillingRoutes> | undefined;
  const bind =
    (
      operation: OperationName,
      pick: (routes: BillingRoutes) => (request: Request) => Promise<Response>,
    ) =>
    async (request: Request) => {
      let routes: BillingRoutes;
      try {
        held ??= load().then((module) => module.billingRoutes(app, fetch));
        routes = await held;
      } catch (error) {
        return handleOperation(
          app.logger,
          request,
          operation,
          async () => {
            throw error;
          },
          app.reporter,
        );
      }
      return pick(routes)(request);
    };
  return {
    checkout: {
      POST: bind('billing.checkout', (routes) => routes.checkout.POST),
    },
    portal: { POST: bind('billing.portal', (routes) => routes.portal.POST) },
    settings: {
      GET: bind('billing.settings', (routes) => routes.settings.GET),
    },
    /** Club seats (ADR 0148): they hold the Stripe client, so they load with billing. */
    clubs: {
      create: bind('clubs.create', (routes) => routes.clubs.create),
      seats: {
        GET: bind('clubs.seats.read', (routes) => routes.clubs.seats.GET),
        POST: bind('clubs.seats.command', (routes) => routes.clubs.seats.POST),
      },
      billing: {
        GET: bind('clubs.billing.read', (routes) => routes.clubs.billing.GET),
        checkout: bind(
          'clubs.billing.checkout',
          (routes) => routes.clubs.billing.checkout,
        ),
        portal: bind(
          'clubs.billing.portal',
          (routes) => routes.clubs.billing.portal,
        ),
        seats: bind(
          'clubs.billing.seats',
          (routes) => routes.clubs.billing.seats,
        ),
      },
      invitation: {
        GET: bind(
          'clubs.invitation.read',
          (routes) => routes.clubs.invitation.GET,
        ),
        POST: bind(
          'clubs.invitation.answer',
          (routes) => routes.clubs.invitation.POST,
        ),
      },
    },
  };
}
