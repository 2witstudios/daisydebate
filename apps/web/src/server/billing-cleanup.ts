import type { App } from './app';
import { createBillingStripe, type BillingFetch } from './billing-stripe';
import { privacyJobRetryAt } from './privacy-jobs';
import { workerFailures } from './recoverable-failure';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../lib/worker-timers';
import { createScheduledWorker } from '../features/ops/scheduled-worker';
import { createBillingCleanupDelivery } from '../features/billing/cleanup-delivery';
import { createCleanupRechecks } from '../features/billing/cleanup-rechecks';
import { stripeCleanupPort } from '../features/billing/cleanup-vendor';
import { createInvoicePassReader } from '../features/billing/invoice-pass-reader';
import { createPaymentObservationReader } from '../features/billing/payment-observation-reader';
import { stripeClosurePaymentReadPort } from '../features/billing/closure-payment-reader';

/** Stripe delivery never enters generic Promise<void> erasure. Free closure remains operational without Stripe keys. */
export function startBillingCleanup(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly timers: WorkerTimers;
  readonly fetch: BillingFetch;
}) {
  const { app } = input,
    store = app.database.billingCleanup(input.instanceId);
  const stripe = createBillingStripe(app.config.billing, input.fetch);
  const port = stripe ? stripeCleanupPort(stripe) : null;
  const vendor =
    stripe && port && app.config.billing.kind === 'stripe'
      ? {
          mode: app.config.billing.mode,
          port,
          readPass: createInvoicePassReader({
            port,
            clock: app.clock,
            mode: app.config.billing.mode,
          }),
          readPayment: createPaymentObservationReader({
            port: stripeClosurePaymentReadPort(stripe),
            clock: app.clock,
            mode: app.config.billing.mode,
          }),
        }
      : null;
  const failed = workerFailures(app, app.reporter)(
    'billing.cleanup.failed',
    'billing.cleanup',
    'Closed-account billing cleanup remains owed',
  );
  const delivery = createBillingCleanupDelivery({
    store,
    vendor,
    nextId: () => app.ids.next(),
    retryAt: privacyJobRetryAt,
  });
  const rechecks = createCleanupRechecks({
    store,
    failed: (error, stage) => failed(error, `recheck_${stage}`),
  });
  let stopped = false;
  let counts = { deleted: 0, retried: 0 };
  const run = async () => {
    if (stopped) return;
    const jobs = await app.database.duePrivacyJobs({
      now: app.clock.now(),
      limit: 3,
      vendors: ['stripe'],
    });
    for (const job of jobs) {
      if (stopped) return;
      try {
        const result = await delivery.deliver(job.id);
        if (result === 'complete')
          counts = { ...counts, deleted: counts.deleted + 1 };
        if (result === 'failure')
          counts = { ...counts, retried: counts.retried + 1 };
      } catch (error) {
        if (!stopped) failed(error, 'delivery');
      }
    }
  };
  const health = createScheduledWorker({
    name: 'billing_cleanup',
    clock: app.clock,
    logger: app.logger,
    pass: async () => {
      try {
        const owed = await app.database.owedPrivacyJobs({
          vendors: ['stripe'],
        });
        const measured = { ...counts, owed };
        counts = { deleted: 0, retried: 0 };
        return measured;
      } catch (error) {
        if (!stopped) failed(error, 'health');
        throw error;
      }
    },
  });
  const schedule = startSingleFlightWorker({
    run,
    everyMs: 1000,
    timers: input.timers,
    failed: (error) => {
      if (!stopped) failed(error, 'due');
    },
  });
  // Health and acknowledged-job revisits have their own bounded minute cadence; empty queues do not emit 1Hz heartbeats.
  const monitoring = startSingleFlightWorker({
    run: async () => {
      if (stopped) return;
      await rechecks.run();
      if (!stopped) await health.run();
    },
    everyMs: 60000,
    timers: input.timers,
    failed: (error) => {
      if (!stopped) failed(error, 'monitor');
    },
  });
  return {
    started: Promise.all([schedule.started, monitoring.started]),
    async stop() {
      stopped = true;
      delivery.stop();
      rechecks.stop();
      await Promise.all([schedule.stop(), monitoring.stop()]);
    },
  };
}
