import { isCapacityRefusal } from '@daisy/db/capacity';
import { createRefusal, errorCodeOf, isAppError } from '@daisy/errors';
import { guarded } from '@daisy/observability';
import type { BillingEconomicsRefusal } from '@daisy/protocol/billing-economics';
import type { App } from './app';
import {
  createBillingEconomicsCollector,
  economicsFailureCode,
  type EconomicsCollection,
} from '../features/billing/economics-collector';
import { raiseEconomicsSignals } from '../features/billing/economics-alert';
import {
  isRaised,
  nothingRaised,
  owedSignals,
  recordRaised,
  recordReport,
  type EconomicsReason,
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
    store: app.database.billingEconomics(instanceId),
    feed: files.feed,
    save: (report) => files.save(report),
    now: () => app.clock.now(),
  });
}

/** The closed word each reason's reported error carries (ADR 0102). */
const reasonWord: Readonly<
  Record<EconomicsReason | 'collect', BillingEconomicsRefusal>
> = {
  snapshot_failed: 'economics-snapshot-failed',
  feed_unreadable: 'economics-feed-unreadable',
  feed_invalid: 'economics-feed-invalid',
  report_failed: 'economics-report-failed',
  save_failed: 'economics-save-failed',
  feed_missing: 'economics-feed-missing',
  collect: 'economics-collect-failed',
};

/** The innermost closed refusal reason of a cause chain, the actual fault, for the log line's `cause`. */
function innermostReason(error: unknown) {
  let reason: string | undefined;
  for (
    let link = error, depth = 0;
    link instanceof Error && depth < 16;
    link = link.cause, depth++
  )
    if (isAppError(link) && link.reason !== undefined) reason = link.reason;
  return reason;
}

/**
 * One bounded monthly collection per hourly tick (ADR 0101). Without a
 * provisioned sink there is nowhere to keep a report, so the worker does not
 * start and the process logs that once. With one, each failure is raised once
 * per month and reason, and again only after a report settles.
 */
export function startBillingEconomics(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly timers: WorkerTimers;
}) {
  const { app } = input;
  const log = (
    event: 'billing.economics.unprovisioned' | 'billing.economics.feed_missing',
    message: string,
    cause?: BillingEconomicsRefusal,
  ) =>
    guarded(() =>
      app.logger.log(
        event,
        { operation: 'billing.economics.collect', ...(cause ? { cause } : {}) },
        message,
      ),
    );
  const directory = app.config.BILLING_ECONOMICS_DIRECTORY;
  if (directory === undefined) {
    log(
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
    innermostReason,
  );
  /** The reported error: the reason's closed word and code, keeping the caught error as cause. */
  const reasonError = (
    reason: Exclude<EconomicsReason, 'feed_missing'> | 'collect',
    cause: unknown,
  ) =>
    createRefusal(
      errorCodeOf(
        cause,
        reason === 'collect' ? 'INTERNAL' : economicsFailureCode[reason],
      ),
      reasonWord[reason],
      `Billing economics ${reason}`,
      cause,
    );
  let raised = nothingRaised;
  let collectRaised = false;
  const raiseOnce = (
    month: string,
    reason: Exclude<EconomicsReason, 'feed_missing'>,
    cause: unknown,
  ) => {
    if (isRaised(raised, month, reason)) return;
    failed(reasonError(reason, cause), reason);
    raised = recordRaised(raised, month, reason);
  };
  const raise = (collection: EconomicsCollection) => {
    const { month } = collection;
    if (collection.kind === 'failed') {
      // Capacity backpressure is bounded by the shared sink itself, so it never starts a streak.
      if (isCapacityRefusal(collection.cause))
        return failed(
          reasonError(collection.reason, collection.cause),
          collection.reason,
        );
      return raiseOnce(month, collection.reason, collection.cause);
    }
    if (
      collection.feed === 'missing' &&
      !isRaised(raised, month, 'feed_missing')
    ) {
      log(
        'billing.economics.feed_missing',
        'Private billing economics feed is missing for the month; the report stays incomplete',
        reasonWord.feed_missing,
      );
      raised = recordRaised(raised, month, 'feed_missing');
    }
    const owed = owedSignals(raised, collection);
    const submitted = raiseEconomicsSignals(app.reporter, {
      month,
      signals: owed,
    });
    const settled = submitted.kind === 'submitted';
    raised = recordReport(raised, collection, {
      taken: settled ? owed : owed.slice(0, submitted.submitted),
      settled,
    });
    if (!settled) raiseOnce(month, 'report_failed', submitted.cause);
  };
  return startSingleFlightWorker({
    timers: input.timers,
    everyMs: 3_600_000,
    // A failure outside any collection (an invalid clock, a defect) is raised once until a run completes.
    failed: (error) => {
      if (collectRaised) return;
      failed(
        isAppError(error) ? error : reasonError('collect', error),
        'collect',
      );
      collectRaised = true;
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
      collectRaised = false;
    },
  });
}
