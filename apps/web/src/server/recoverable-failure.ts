import { isServiceLeaseLapse } from '@daisy/db/service-lease';
import { isCapacityRefusal } from '@daisy/db/capacity';
import { isAppError } from '@daisy/errors';
import type { EventName, Logger } from '@daisy/logger';
import { noopErrorReporter, type ErrorReporter } from '@daisy/observability';
import type { App } from './app';

/**
 * Admission backpressure a worker stage absorbs silently before it counts as
 * starvation: the shared pool admits few writers, so a burst of background
 * work is refused and retried on a later tick (ISSUE-431). Counting refusals
 * rather than a time window reports a starved stage at any cadence.
 */
const CAPACITY_DEFERRAL_LIMIT = 8;

/**
 * A background worker's recoverable failure: the log line names the stage
 * and the error's own code; only the scrubbed reporter sees the raw error
 * (ADR 0037). An untyped error carries no trustworthy code, so it is INTERNAL.
 * Capacity refusals are deferrals: each refusal past the bound is reported,
 * and the count for that stage starts again. A lapsed web service lease is
 * only logged here: it is the instance's condition, so `leaseLapsed` hands it
 * to the instance's one lease state, which reports it once it persists.
 */
export function recoverableFailure(input: {
  readonly logger: Pick<Logger, 'log'>;
  readonly reporter: ErrorReporter;
  readonly nextId: () => string;
  readonly isCapacity: (error: unknown) => boolean;
  /** Hands a lease lapse to the instance's lease state (DAISY-WEB-9). */
  readonly leaseLapsed: (error: unknown) => void;
  readonly event: EventName;
  readonly operation: string;
  readonly message: string;
  /** A fixed code naming why the work failed, read from a typed error. */
  readonly cause?: (error: unknown) => string | undefined;
}) {
  const deferrals = new Map<string, number>();
  /** One sink step; a step that throws never stops the next or its caller. */
  const attempt = (step: () => void) => {
    try {
      step();
    } catch {
      /* A failing sink is never its caller's fault (ISSUE-789). */
    }
  };
  const log = (error: unknown, operation: string, cause?: string) => {
    const errorCode = isAppError(error) ? error.code : 'INTERNAL';
    attempt(() => {
      input.logger.log(
        input.event,
        { operation, errorCode, ...(cause ? { cause } : {}) },
        input.message,
      );
    });
  };
  const report = (error: unknown, operation: string) => {
    const errorCode = isAppError(error) ? error.code : 'INTERNAL';
    let cause: string | undefined;
    // A cause reader that throws costs only the cause, never the log line.
    attempt(() => {
      cause = input.cause?.(error);
    });
    log(error, operation, cause);
    attempt(() =>
      input.reporter.capture(error, {
        requestId: input.nextId(),
        route: operation,
        errorCode,
      }),
    );
  };
  /**
   * Never throws, so no worker promise ever rejects because reporting its
   * failure failed (ISSUE-789).
   */
  return (error: unknown, stage: string) => {
    const operation = `${input.operation}.${stage}`;
    if (isServiceLeaseLapse(error)) {
      log(error, `${operation}.lease`, 'service-lease-lapsed');
      return attempt(() => input.leaseLapsed(error));
    }
    let capacity = false;
    attempt(() => {
      capacity = input.isCapacity(error);
    });
    if (!capacity) return report(error, operation);
    const deferred = (deferrals.get(stage) ?? 0) + 1;
    if (deferred <= CAPACITY_DEFERRAL_LIMIT)
      return void deferrals.set(stage, deferred);
    deferrals.set(stage, 0);
    report(error, `${operation}.capacity`);
  };
}

/** The process's worker failure sinks: its logger, clock and ids, with real pool backpressure. */
export const workerFailures =
  (app: App, reporter: ErrorReporter = noopErrorReporter) =>
  (
    event: EventName,
    operation: string,
    message: string,
    cause?: (error: unknown) => string | undefined,
  ) =>
    recoverableFailure({
      logger: app.logger,
      reporter,
      nextId: () => app.ids.next(),
      isCapacity: isCapacityRefusal,
      leaseLapsed: app.serviceLease.lapseRefused,
      event,
      operation,
      message,
      ...(cause ? { cause } : {}),
    });
