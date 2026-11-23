import type { Waits } from '@daisy/clock';
import { passOf, pollWork } from '@daisy/worker';
import { HOUSEKEEPING_IDLE_MAX_MS } from '../../lib/worker-idle';
import type { App } from '../../server/app';
import { createBillingStripe, type BillingFetch } from './stripe-client';
import { createPurchaseReconciliation } from './purchase-reconciliation';
import { createCheckoutVendor, stripeCheckoutPort } from './checkout-vendor';
import { discoverCheckout } from './checkout-discovery';
import { workerFailures } from '../../server/recoverable-failure';

/** Only existing admitted attempts are inspected; creation stays in the explicit native member operation. */
export function startBillingPurchases(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly waits: Waits;
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
  const schedule = pollWork({
    pass: () => reconciliation.run().then(passOf),
    backoff: { busyMs: 5_000, idleMaxMs: HOUSEKEEPING_IDLE_MAX_MS },
    waits: input.waits,
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
