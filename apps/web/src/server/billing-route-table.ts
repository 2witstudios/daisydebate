import type { App } from './app';
import type { composeBillingRoutes } from '../features/billing/native-composition';
import type { BillingFetch } from './billing-stripe';
import type { OperationName } from '../features/ops/operation-names';
import { handleOperation } from './http';

type BillingRoutes = ReturnType<typeof composeBillingRoutes>;
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
  };
}
