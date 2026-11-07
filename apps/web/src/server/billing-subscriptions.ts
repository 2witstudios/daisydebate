import { subscriptionGrants } from '@daisy/auth/authorization';
import type { App } from './app';
import { createBillingStripe, type BillingFetch } from './billing-stripe';
import { createSubscriptionReconciliation } from '../features/billing/subscription-reconciliation';
import { stripeSubscriptionReadPort } from '../features/billing/subscription-reader';
import { createSubscriptionStalenessCollection } from '../features/billing/subscription-staleness-service';
import {
  recordDisabledSubscriptionFreshness,
  subscriptionStalenessObserver,
} from './billing-subscription-staleness';
import { workerFailures } from './recoverable-failure';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../lib/worker-timers';

/** Scheduled repair uses original claim offers and current service authority, independently of the purchase flag. */
export function startBillingSubscriptions(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly timers: WorkerTimers;
  readonly fetch: BillingFetch;
}) {
  const { app } = input;
  if (app.config.billing.kind === 'disabled') {
    recordDisabledSubscriptionFreshness(app);
    return null;
  }
  const stripe = createBillingStripe(app.config.billing, input.fetch);
  if (!stripe) return null;
  const failed = workerFailures(app, app.reporter)(
    'billing.subscription.failed',
    'billing.subscription',
    'Billing subscription reconciliation remains owed',
  );
  const reconciliation = createSubscriptionReconciliation({
    mode: app.config.billing.mode,
    store: app.database.billingSynchronization(
      input.instanceId,
      subscriptionGrants,
    ),
    vendor: stripeSubscriptionReadPort(stripe),
    failed,
  });
  const staleness = createSubscriptionStalenessCollection({
    mode: app.config.billing.mode,
    store: app.database.billingSubscriptionStaleness(input.instanceId),
    ...subscriptionStalenessObserver(app, failed),
  });
  const schedule = startSingleFlightWorker({
    run: async () => {
      try {
        await reconciliation.run();
      } finally {
        await staleness.run();
      }
    },
    everyMs: 5_000,
    timers: input.timers,
    failed: (error) => failed(error, 'tick'),
  });
  return {
    started: schedule.started,
    stop() {
      reconciliation.stop();
      staleness.stop();
      return schedule.stop();
    },
  };
}
