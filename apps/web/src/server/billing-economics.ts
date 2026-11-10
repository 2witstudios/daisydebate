import { createAppError } from '@daisy/errors';
import type { App } from './app';
import {
  createBillingEconomicsCollector,
  type EconomicsCollection,
} from '../features/billing/economics-collector';
import { raiseEconomicsSignals } from '../features/billing/economics-alert';
import {
  isFailureRaised,
  nothingRaised,
  recordFailure,
  recordReport,
  reportProgress,
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
    try {
      app.logger.log(
        'billing.economics.unprovisioned',
        { operation: 'billing.economics.collect' },
        'Private billing economics sink is not provisioned; collection is not running',
      );
    } catch {
      /* A failing log sink never aborts process startup (ISSUE-789). */
    }
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
    if (collection.kind === 'failed') {
      if (isFailureRaised(raised, collection)) return;
      // Only a failure the sink reported settles; deferred or unrecorded stays news.
      const verdict = failed(
        createAppError(
          collection.reason === 'feed_invalid' ||
            collection.reason === 'snapshot_invalid' ||
            collection.reason === 'report_invalid'
            ? 'VALIDATION'
            : 'INFRASTRUCTURE',
          undefined,
          collection.cause,
        ),
        collection.reason,
      );
      if (verdict === 'reported') raised = recordFailure(raised, collection);
      return;
    }
    const prior = reportProgress(raised, collection);
    if (prior?.owed.length === 0) {
      // Already raised this month; settling again still re-arms the month's failures.
      raised = recordReport(raised, collection, prior);
      return;
    }
    const owed = prior?.owed ?? collection.signals;
    const submitted = raiseEconomicsSignals(app.reporter, {
      month: collection.month,
      signals: owed,
    });
    if (submitted.kind === 'failed') {
      const verdict = prior?.signalFailureReported
        ? 'reported'
        : failed(
            createAppError('INFRASTRUCTURE', undefined, submitted.cause),
            'signal_failed',
          );
      raised = recordReport(raised, collection, {
        owed: owed.slice(submitted.submitted),
        signalFailureReported: verdict === 'reported',
      });
      return;
    }
    // Record before logging: a throwing logger must not make the next tick re-send these signals.
    raised = recordReport(raised, collection, {
      owed: [],
      signalFailureReported: false,
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
