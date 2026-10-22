import { isTransactionCapacityRefusal } from '@daisy/db';
import { isAppError } from '@daisy/errors';
import type { EventName, Logger } from '@daisy/logger';
import { noopErrorReporter, type ErrorReporter } from '@daisy/observability';
import type { App } from './app';

/**
 * Admission backpressure a worker stage absorbs silently before it counts as
 * starvation: the shared pool admits few writers, so a burst of background
 * work is refused and retried on the next tick (ISSUE-431). A starved stage
 * ticking every 500ms or faster exceeds this within one window.
 */
export const CAPACITY_DEFERRAL_LIMIT = 8;
export const CAPACITY_WINDOW_MS = 10_000;

/**
 * A background worker's recoverable failure: the log line names the stage
 * and the error's own code; only the scrubbed reporter sees the raw error
 * (ADR 0037). An untyped error carries no trustworthy code, so it is INTERNAL.
 * Capacity refusals are deferrals, reported once per window past the bound.
 */
export function recoverableFailure(input: {
  readonly logger: Pick<Logger, 'log'>;
  readonly reporter: ErrorReporter;
  readonly nextId: () => string;
  readonly isCapacity: (error: unknown) => boolean;
  readonly nowMs: () => number;
  readonly event: EventName;
  readonly operation: string;
  readonly message: string;
}) {
  const deferrals = new Map<string, number[]>();
  const report = (error: unknown, operation: string) => {
    const errorCode = isAppError(error) ? error.code : 'INTERNAL';
    input.logger.log(input.event, { operation, errorCode }, input.message);
    input.reporter.capture(error, {
      requestId: input.nextId(),
      route: operation,
      errorCode,
    });
  };
  return (error: unknown, stage: string) => {
    const operation = `${input.operation}.${stage}`;
    if (!input.isCapacity(error)) return report(error, operation);
    const now = input.nowMs();
    const recent = (deferrals.get(stage) ?? []).filter(
      (at) => now - at < CAPACITY_WINDOW_MS,
    );
    recent.push(now);
    if (recent.length <= CAPACITY_DEFERRAL_LIMIT)
      return void deferrals.set(stage, recent);
    deferrals.set(stage, []);
    report(error, `${operation}.capacity`);
  };
}

/** The process's worker failure sinks: its logger, clock and ids, with real pool backpressure. */
export const workerFailures =
  (app: App, reporter: ErrorReporter = noopErrorReporter) =>
  (event: EventName, operation: string, message: string) =>
    recoverableFailure({
      logger: app.logger,
      reporter,
      nextId: () => app.ids.next(),
      isCapacity: isTransactionCapacityRefusal,
      nowMs: () => Date.parse(app.clock.now()),
      event,
      operation,
      message,
    });
