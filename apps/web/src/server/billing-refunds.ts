import type { App } from './app';
import { createBillingStripe, type BillingFetch } from './billing-stripe';
import { createRefundReconciliation } from '../features/billing/refund-reconciliation';
import {
  createRefundVendor,
  stripeRefundPort,
} from '../features/billing/refund-vendor';
import { workerFailures } from './recoverable-failure';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../lib/worker-timers';

/** Original-action repair runs independently of customer mappings and privacy-job completion. */
export function startBillingRefunds(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly timers: WorkerTimers;
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
  const schedule = startSingleFlightWorker({
    run: () => reconciliation.run(),
    everyMs: 5_000,
    timers: input.timers,
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
