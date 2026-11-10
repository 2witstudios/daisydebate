import { isCapacityRefusal } from '@daisy/db/capacity';
import { createRefusal, type ErrorCode } from '@daisy/errors';
import type { BillingEconomicsRefusal } from '@daisy/protocol/billing-economics';
import type { App } from './app';
import {
  createBillingEconomicsCollector,
  type EconomicsCollection,
  type EconomicsCollectionFailure,
} from '../features/billing/economics-collector';

import { raiseEconomicsSignals } from '../features/billing/economics-alert';
import {
  innermostReason,
  typedCodeOr,
} from '../features/billing/economics-cause';
import {
  failureNotice,
  isFailureRaised,
  nothingRaised,
  collectCompleted,
  collectFailureNotice,
  isCollectRaised,
  recordCollect,
  owedSignals,
  raisedIn,
  recordFailure,
  recordFeedMissingLogged,
  recordSignals,
  signalFailureNotice,
} from '../features/billing/economics-notice';
import { previousEconomicsMonth } from '../features/billing/economics-policy';
import { createBillingEconomicsFiles } from './billing-economics-files';
import { workerFailures, type FailureVerdict } from './recoverable-failure';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../lib/worker-timers';

const reportedOnly: ReadonlySet<FailureVerdict> = new Set(['reported']);
const reportedOrLogged: ReadonlySet<FailureVerdict> = new Set([
  'reported',
  'logged',
]);

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

/** The closed word each stage's reported error carries (ADR 0102). */
const stageRefusal: Readonly<Record<EconomicsStage, BillingEconomicsRefusal>> =
  {
    sink_unavailable: 'economics-sink-unavailable',
    snapshot_failed: 'economics-snapshot-failed',
    snapshot_invalid: 'economics-snapshot-invalid',
    feed_unreadable: 'economics-feed-unreadable',
    feed_invalid: 'economics-feed-invalid',
    report_invalid: 'economics-report-invalid',
    report_failed: 'economics-report-failed',
    save_failed: 'economics-save-failed',
    signal_failed: 'economics-signal-failed',
    collect: 'economics-collect-failed',
  };

/** The error a stage reports: its own closed word, the code, and the caught error as cause. */
const stageError = (stage: EconomicsStage, code: ErrorCode, cause: unknown) =>
  createRefusal(code, stageRefusal[stage], `Billing economics ${stage}`, cause);

/**
 * The log line's closed `cause` (ADR 0102: a reason, never a message): the
 * innermost reason in the cause chain, so the actual fault is named (a
 * non-private directory met by the feed reader logs economics-sink-not-private),
 * otherwise the stage the reported error names. Only an error with no reason
 * anywhere names nothing.
 */
export const economicsFailureCheck = (error: unknown) => innermostReason(error);

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
  /**
   * Report a failure notice once until a report settles. It counts as raised
   * once the sink answers one of `settles`: normally only `reported`; where the
   * tracker is itself what failed (signal_failed), its log line is the only
   * channel left, so `logged` settles it too.
   */
  const reportOnce = (
    month: string,
    notice: string,
    error: unknown,
    stage: EconomicsStage,
    settles: ReadonlySet<FailureVerdict> = reportedOnly,
  ) => {
    if (isFailureRaised(raised, month, notice)) return;
    if (settles.has(failed(error, stage)))
      raised = recordFailure(raised, month, notice);
  };
  // Every reader of a cause goes through the safe chain (economics-cause), so a hostile error
  // cannot make raising throw; no unreadable fallback is needed.
  const raise = (collection: EconomicsCollection) =>
    collection.kind === 'failed'
      ? raiseFailure(collection)
      : raiseReport(collection);
  const raiseFailure = (
    collection: Extract<EconomicsCollection, { readonly kind: 'failed' }>,
  ) => {
    // The tracker's scrubber replaces exception text, so stages are told apart there by route;
    // the stage's closed word names it on the log line when the cause carries none.
    const error = stageError(
      collection.reason,
      collection.code,
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
  };
  const raiseReport = (
    collection: Extract<EconomicsCollection, { readonly kind: 'reported' }>,
  ) => {
    // The missing-feed line: logged once per absence, before any signal is raised, so a throwing
    // reporter cannot keep the month quiet. A supplied feed re-arms it; a line the log sink refused
    // is retried next tick.
    const logged = raisedIn(raised, collection.month).feedMissingLogged;
    const nowLogged =
      collection.feed === 'supplied'
        ? false
        : logged ||
          logSafely(
            app,
            'billing.economics.feed_missing',
            'Private billing economics feed is missing for the month; the report stays incomplete',
            'economics-feed-missing',
          );
    if (nowLogged !== logged)
      raised = recordFeedMissingLogged(raised, collection.month, nowLogged);
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
        stageError(
          'signal_failed',
          typedCodeOr(submitted.cause, 'INFRASTRUCTURE'),
          submitted.cause,
        ),
        'signal_failed',
        reportedOrLogged,
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
      // Never throws (ISSUE-789): the notice is read through the safe chain.
      const notice = collectFailureNotice(error);
      if (isCollectRaised(raised, notice)) return;
      // An error that names no check of its own is wrapped, so the line names its stage.
      const named =
        innermostReason(error) !== undefined
          ? error
          : stageError('collect', typedCodeOr(error, 'INTERNAL'), error);
      if (failed(named, 'collect') === 'reported')
        raised = recordCollect(raised, notice);
    },
    run: async () => {
      const window = previousEconomicsMonth(app.clock.now());
      if (!window)
        throw createRefusal(
          'INTERNAL',
          'economics-clock-invalid',
          'Billing economics clock invalid',
        );
      raise(await collector.run(window));
      // Only once raising returned: a defect while raising is still a collect failure, once.
      raised = collectCompleted(raised);
    },
  });
}
