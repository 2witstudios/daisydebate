import { createAppError } from '@daisy/errors';
import type { App } from './app';
import {
  createBillingEconomicsCollector,
  type EconomicsCollection,
} from '../features/billing/economics-collector';
import { raiseEconomicsSignals } from '../features/billing/economics-alert';
import { economicsNotice } from '../features/billing/economics-notice';
import { previousEconomicsMonth } from '../features/billing/economics-policy';
import { createBillingEconomicsFiles } from './billing-economics-files';
import { workerFailures } from './recoverable-failure';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../lib/worker-timers';

/** The current-service source and a provisioned private sink; absent inputs never become measured zero. */
export function composeBillingEconomics(
  app: App,
  instanceId: string,
  directory: string,
) {
  const files = createBillingEconomicsFiles({
    directory,
    nextId: () => app.ids.next(),
    now: () => app.clock.now(),
  });
  return createBillingEconomicsCollector({
    store: app.database.billingEconomics(instanceId),
    feed: files.feed,
    save: (report) => files.save(report),
    now: () => app.clock.now(),
  });
}

/**
 * One bounded monthly collection per hourly tick, raising each distinct
 * outcome for a month once per process. Without a provisioned sink there is
 * nowhere to keep a report, so the worker does not run and raises nothing
 * (ADR 0101); the process logs that once.
 */
export function startBillingEconomics(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly timers: WorkerTimers;
}) {
  const { app } = input;
  const directory = app.config.BILLING_ECONOMICS_DIRECTORY;
  if (directory === undefined) {
    app.logger.log(
      'billing.economics.unprovisioned',
      { operation: 'billing.economics.collect' },
      'Private billing economics sink is not provisioned; collection is not running',
    );
    return { started: Promise.resolve(), stop: async () => undefined };
  }
  const collector = composeBillingEconomics(app, input.instanceId, directory);
  const failed = workerFailures(app, app.reporter)(
    'billing.economics.failed',
    'billing.economics',
    'Private billing economics remain incomplete',
  );
  let raised: string | null = null;
  const raise = (collection: EconomicsCollection) => {
    const notice = economicsNotice(collection);
    if (notice === raised) return;
    if (collection.kind === 'failed') {
      failed(collection.cause, collection.reason);
      raised = notice;
      return;
    }
    const submitted = raiseEconomicsSignals(app.reporter, collection);
    if (submitted.kind === 'failed')
      return failed(submitted.cause, 'signal_failed');
    if (collection.feed === 'missing')
      app.logger.log(
        'billing.economics.feed_missing',
        { operation: 'billing.economics.collect', cause: 'feed_missing' },
        'Private billing economics feed is missing for the month; the report stays incomplete',
      );
    raised = notice;
  };
  return startSingleFlightWorker({
    timers: input.timers,
    everyMs: 3_600_000,
    failed: (error) => failed(error, 'collect'),
    run: async () => {
      const window = previousEconomicsMonth(app.clock.now());
      if (!window) throw createAppError('VALIDATION');
      raise(await collector.run(window));
    },
  });
}
