import { isCapacityRefusal } from '@daisy/db/capacity';
import { createRefusal, isAppError, type ErrorCode } from '@daisy/errors';
import type { RefusalReason } from '@daisy/protocol';
import type { BillingEconomicsRefusal } from '@daisy/protocol/billing-economics';
import type { App } from './app';
import {
  createBillingEconomicsCollector,
  type EconomicsCollection,
  type EconomicsCollectionFailure,
  typedCodeOr,
} from '../features/billing/economics-collector';

import { raiseEconomicsSignals } from '../features/billing/economics-alert';
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
import { workerFailures } from './recoverable-failure';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../lib/worker-timers';

const reportedOnly: ReadonlySet<string> = new Set(['reported']);
const reportedOrLogged: ReadonlySet<string> = new Set(['reported', 'logged']);

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
export const economicsFailureCheck = (error: unknown) => {
  // The innermost reason names the actual fault; outer ones say where it was met.
  let named: RefusalReason | undefined;
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (isAppError(current) && current.reason) named = current.reason;
    current = current.cause;
  }
  return named;
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
    settles: ReadonlySet<string> = reportedOnly,
  ) => {
    if (isFailureRaised(raised, month, notice)) return;
    if (settles.has(failed(error, stage)))
      raised = recordFailure(raised, month, notice);
  };
  const raise = (collection: EconomicsCollection) => {
    if (collection.kind !== 'failed') return raiseReport(collection);
    try {
      raiseFailure(collection);
    } catch {
      // A hostile cause (a throwing getter) still reports its stage, never as `collect`, once.
      reportOnce(
        collection.month,
        `${collection.month}:${collection.reason}:unreadable`,
        stageError(collection.reason, collection.code, undefined),
        collection.reason,
      );
    }
  };
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
      // Never throws (ISSUE-789): reading a hostile error falls back to the stage's own error.
      try {
        const notice = collectFailureNotice(error);
        if (isCollectRaised(raised, notice)) return;
        // An error that names no check is wrapped, so the line names its stage.
        const named =
          isAppError(error) && error.reason
            ? error
            : stageError('collect', typedCodeOr(error, 'INTERNAL'), error);
        if (failed(named, 'collect') === 'reported')
          raised = recordCollect(raised, notice);
      } catch {
        // Unreadable, but still once until a collection completes.
        if (isCollectRaised(raised, 'collect:unreadable')) return;
        if (
          failed(stageError('collect', 'INTERNAL', undefined), 'collect') ===
          'reported'
        )
          raised = recordCollect(raised, 'collect:unreadable');
      }
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
