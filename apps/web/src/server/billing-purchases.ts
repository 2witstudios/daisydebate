import type { App } from './app';
import { createBillingStripe, type BillingFetch } from './billing-stripe';
import { createPurchaseReconciliation } from '../features/billing/purchase-reconciliation';
import {
  createCheckoutVendor,
  stripeCheckoutPort,
} from '../features/billing/checkout-vendor';
import { discoverCheckout } from '../features/billing/checkout-discovery';
import { workerFailures } from './recoverable-failure';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../lib/worker-timers';

/** Only existing admitted attempts are inspected; creation stays in the explicit native member operation. */
export function startBillingPurchases(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly timers: WorkerTimers;
  readonly fetch: BillingFetch;
}) {
  const { app } = input;
  if (app.config.billing.kind === 'disabled') return null;
  const stripe = createBillingStripe(app.config.billing, input.fetch);
  if (!stripe) return null;
  const mode = app.config.billing.mode;
  const port = stripeCheckoutPort(stripe);
  const failed = workerFailures(app, app.reporter)(
    'billing.purchase.failed',
    'billing.purchase',
    'Original billing purchase outcome remains unresolved',
  );
  const reconciliation = createPurchaseReconciliation({
    mode,
    store: app.database.billingPurchaseRecovery(input.instanceId),
    vendor: createCheckoutVendor({ mode, clock: app.clock, port }),
    discover: (purchase) => discoverCheckout({ port, mode }, purchase),
    failed,
  });
  const schedule = startSingleFlightWorker({
    run: () => reconciliation.run(),
    everyMs: 5_000,
    timers: input.timers,
    failed: (error) => failed(error, 'discover'),
  });
  return {
    started: schedule.started,
    stop() {
      reconciliation.stop();
      return schedule.stop();
    },
  };
}
