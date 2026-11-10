import { isCapacityRefusal } from '@daisy/db/capacity';
import { createAppError, isAppError } from '@daisy/errors';
import type { App } from './app';
import {
  createBillingEconomicsCollector,
  type EconomicsCollection,
  type EconomicsCollectionFailure,
} from '../features/billing/economics-collector';

import { raiseEconomicsSignals } from '../features/billing/economics-alert';
import {
  failureNotice,
  isFailureRaised,
  nothingRaised,
  collectFailureNotice,
  owedSignals,
  raisedIn,
  recordFailure,
  recordFeedMissingLogged,
  recordSignals,
  signalFailureNotice,
} from '../features/billing/economics-notice';
import { previousEconomicsMonth } from '../features/billing/economics-policy';
import { createBillingEconomicsFiles } from './billing-economics-files';
import { workerFailures } from './recoverable-failure';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../lib/worker-timers';

/** Every operation this worker reports under: a collection stage, or its own two. */
type EconomicsStage = EconomicsCollectionFailure | 'signal_failed' | 'collect';

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

/** A worker log line that never throws (ISSUE-789); it answers whether the line was written. */
function logSafely(
  app: App,
  event: 'billing.economics.unprovisioned' | 'billing.economics.feed_missing',
  message: string,
  cause?: string,
) {
  try {
    app.logger.log(
      event,
      { operation: 'billing.economics.collect', ...(cause ? { cause } : {}) },
      message,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * The log line's closed `cause`: which fixed check failed when the cause is
 * typed, otherwise the stage the worker's wrapper names
 * (`Billing_economics_<reason>`). Only a bare untyped error names nothing.
 */
export const economicsFailureCheck = (error: unknown) => {
  // The worker's wrapper carries the typed cause; otherwise a typed error names itself
  // (the collect path, or a wrapper whose cause is untyped names its stage).
  const cause = error instanceof Error ? error.cause : undefined;
  const typed = isAppError(cause)
    ? cause
    : isAppError(error)
      ? error
      : undefined;
  if (!typed) return undefined;
  // The logger's code kind starts with a letter and holds at most 80 characters.
  const check = typed.message
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^[^A-Za-z]+/, '')
    .slice(0, 80);
  return check === '' ? undefined : check;
};

/**
 * One bounded monthly collection per hourly tick, raising each signal once a
 * month and each failure once per regression, per process. Without a provisioned sink there is
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
    logSafely(
      app,
      'billing.economics.unprovisioned',
      'Private billing economics sink is not provisioned; collection is not running',
    );
    return { started: Promise.resolve(), stop: async () => undefined };
  }
  const collector = composeBillingEconomics(app, input.instanceId, directory);
  const failed = workerFailures(app, app.reporter)(
    'billing.economics.failed',
    'billing.economics',
    'Private billing economics remain incomplete',
    economicsFailureCheck,
  );
  let raised = nothingRaised;
  /** The last failure outside any collection that was reported, until one completes. */
  let collectFailure: string | null = null;
  /** Report a failure notice once until a report settles; only a failure the sink reported counts. */
  const reportOnce = (
    month: string,
    notice: string,
    error: unknown,
    stage: EconomicsStage,
  ) => {
    if (isFailureRaised(raised, month, notice)) return;
    if (failed(error, stage) === 'reported')
      raised = recordFailure(raised, month, notice);
  };
  const raise = (collection: EconomicsCollection) => {
    if (collection.kind === 'failed') {
      // A fixed per-stage message. The tracker's scrubber replaces exception text, so stages are told
      // apart there by the route; the message names the stage on the log line when the cause is untyped.
      const error = createAppError(
        collection.code,
        `Billing economics ${collection.reason}`,
        collection.cause,
      );
      // Capacity backpressure is bounded by the shared sink itself and is never a notice,
      // so it neither masks a later outage nor stops counting towards starvation.
      if (isCapacityRefusal(collection.cause))
        return void failed(error, collection.reason);
      return reportOnce(
        collection.month,
        failureNotice(collection),
        error,
        collection.reason,
      );
    }
    // A supplied feed re-arms the missing-feed line, so a feed that later disappears is logged.
    if (
      collection.feed === 'supplied' &&
      raisedIn(raised, collection.month).feedMissingLogged
    )
      raised = recordFeedMissingLogged(raised, collection.month, false);
    // Logged before any signal is raised, so a throwing reporter cannot keep the month quiet.
    if (
      collection.feed === 'missing' &&
      !raisedIn(raised, collection.month).feedMissingLogged
    ) {
      // Marked only once written, so a log sink that threw is retried next tick.
      if (
        logSafely(
          app,
          'billing.economics.feed_missing',
          'Private billing economics feed is missing for the month; the report stays incomplete',
          'feed_missing',
        )
      )
        raised = recordFeedMissingLogged(raised, collection.month, true);
    }
    const owed = owedSignals(raised, collection);
    const submitted = raiseEconomicsSignals(app.reporter, {
      month: collection.month,
      signals: owed,
    });
    if (submitted.kind === 'failed') {
      raised = recordSignals(raised, collection, {
        taken: owed.slice(0, submitted.submitted),
        settled: false,
      });
      return reportOnce(
        collection.month,
        signalFailureNotice(collection.month),
        createAppError(
          isAppError(submitted.cause) ? submitted.cause.code : 'INFRASTRUCTURE',
          'Billing economics signal_failed',
          submitted.cause,
        ),
        'signal_failed',
      );
    }
    raised = recordSignals(raised, collection, { taken: owed, settled: true });
  };
  return startSingleFlightWorker({
    timers: input.timers,
    everyMs: 3_600_000,
    // A failure outside any collection (an invalid clock, a defect) is reported once per
    // distinct problem until a collection completes again, never every hour.
    failed: (error) => {
      const notice = collectFailureNotice(error);
      if (collectFailure === notice) return;
      if (failed(error, 'collect') === 'reported') collectFailure = notice;
    },
    run: async () => {
      const window = previousEconomicsMonth(app.clock.now());
      if (!window)
        throw createAppError('VALIDATION', 'Billing economics clock invalid');
      raise(await collector.run(window));
      collectFailure = null;
    },
  });
}
