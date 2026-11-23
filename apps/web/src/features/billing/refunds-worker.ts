import type { Waits } from '@daisy/clock';
import { passOf, pollWork } from '@daisy/worker';
import { HOUSEKEEPING_IDLE_MAX_MS } from '../../lib/worker-idle';
import type { App } from '../../server/app';
import { createBillingStripe, type BillingFetch } from './stripe-client';
import { createRefundReconciliation } from './refund-reconciliation';
import { createRefundVendor, stripeRefundPort } from './refund-vendor';
import { workerFailures } from '../../server/recoverable-failure';

/** Original-action repair runs independently of customer mappings and privacy-job completion. */
export function startBillingRefunds(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly waits: Waits;
  readonly fetch: BillingFetch;
}) {
  const { app } = input;
  if (app.config.billing.kind === 'disabled') return null;
  const stripe = createBillingStripe(app.config.billing, input.fetch);
  if (!stripe) return null;
  const failed = workerFailures(app, app.reporter)(
    'billing.refund.failed',
    'billing.refund',
    'Original billing refund obligation remains unresolved',
  );
  const reconciliation = createRefundReconciliation({
    mode: app.config.billing.mode,
    store: app.database.billingRefunds(input.instanceId),
    vendor: createRefundVendor({
      mode: app.config.billing.mode,
      clock: app.clock,
      port: stripeRefundPort(stripe),
    }),
    failed,
  });
  const schedule = pollWork({
    pass: () => reconciliation.run().then(passOf),
    backoff: { busyMs: 5_000, idleMaxMs: HOUSEKEEPING_IDLE_MAX_MS },
    waits: input.waits,
    failed: (error) => failed(error, 'tick'),
  });
  return {
    started: schedule.started,
    stop() {
      reconciliation.stop();
      return schedule.stop();
    },
  };
}
