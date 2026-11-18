import { authorize } from '@daisy/auth/authorization';
import { createId } from '@paralleldrive/cuid2';
import type { App } from './app';
import { createBillingStripe, type BillingFetch } from './billing-stripe';
import {
  stripeHostingPort,
  type HostingDependencies,
} from '../features/hosting-purchases/checkout';

const held = new WeakMap<App, HostingDependencies>();

/**
 * The hosting purchases' resources (ADR 0149): the Tab store, the evaluator
 * and Stripe, which exists only when billing and both host event prices are
 * configured. One set per App.
 */
export function hostingPurchaseDependencies(
  app: App,
  fetch: BillingFetch,
): HostingDependencies {
  const existing = held.get(app);
  if (existing) return existing;
  const config = app.config.billing;
  const stripe = createBillingStripe(config, fetch);
  const dependencies: HostingDependencies = {
    store: app.database.tabCommands,
    authorize,
    vendor:
      config.kind === 'stripe' && config.hostEventPrices !== null && stripe
        ? {
            port: stripeHostingPort(stripe),
            prices: config.hostEventPrices,
            mode: config.mode,
          }
        : null,
    origin: () => app.auth().config.PUBLIC_APP_URL,
    newId: createId,
  };
  held.set(app, dependencies);
  return dependencies;
}
