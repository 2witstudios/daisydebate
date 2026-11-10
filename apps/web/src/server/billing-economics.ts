import { createAppError } from '@daisy/errors';
import type { App } from './app';
import {
  createBillingEconomicsCollector,
  type EconomicsCollection,
} from '../features/billing/economics-collector';
import { raiseEconomicsSignals } from '../features/billing/economics-alert';
import {
  nothingRaised,
  raisedFor,
  recordRaised,
} from '../features/billing/economics-notice';
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
    sink: files.sink,
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
  let raised = nothingRaised;
  const raise = (collection: EconomicsCollection) => {
    const prior = raisedFor(raised, collection);
    if (collection.kind === 'failed') {
      if (prior?.failureReported) return;
      // Only a failure the sink reported settles; a deferred capacity refusal stays news.
      const verdict = failed(
        createAppError(
          collection.reason === 'feed_invalid'
            ? 'VALIDATION'
            : 'INFRASTRUCTURE',
          undefined,
          collection.cause,
        ),
        collection.reason,
      );
      if (verdict === 'reported')
        raised = recordRaised(raised, collection, {
          owed: [],
          failureReported: true,
        });
      return;
    }
    if (prior?.owed.length === 0) return;
    const owed = prior?.owed ?? collection.signals;
    const submitted = raiseEconomicsSignals(app.reporter, {
      month: collection.month,
      signals: owed,
    });
    if (submitted.kind === 'failed') {
      const verdict = prior?.failureReported
        ? 'reported'
        : failed(
            createAppError('INFRASTRUCTURE', undefined, submitted.cause),
            'signal_failed',
          );
      raised = recordRaised(raised, collection, {
        owed: owed.slice(submitted.submitted),
        failureReported: verdict === 'reported',
      });
      return;
    }
    // Record before logging: a throwing logger must not make the next tick re-send these signals.
    raised = recordRaised(raised, collection, {
      owed: [],
      failureReported: false,
    });
    if (collection.feed === 'missing')
      app.logger.log(
        'billing.economics.feed_missing',
        { operation: 'billing.economics.collect', cause: 'feed_missing' },
        'Private billing economics feed is missing for the month; the report stays incomplete',
      );
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
