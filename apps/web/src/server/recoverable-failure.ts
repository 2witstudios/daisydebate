import { isCapacityRefusal } from '@daisy/db/capacity';
import { isAppError } from '@daisy/errors';
import type { EventName, Logger } from '@daisy/logger';
import { noopErrorReporter, type ErrorReporter } from '@daisy/observability';
import type { App } from './app';

/**
 * The deferrals of one kind a worker stage absorbs before they count as
 * persistent: the shared pool admits few writers, so a burst of background
 * work is refused and retried on a later tick (ISSUE-431). Counting deferrals
 * rather than a time window reports a starved stage at any cadence.
 */
const DEFERRAL_LIMIT = 8;

/**
 * A recoverable failure expected to clear by itself. `capacity`: the pool
 * refused admission. `service-lease-lapsed`: this instance's own web lease
 * was not current for a moment, so its maintenance authority refused
 * (DAISY-WEB-9); the next renewal restores it.
 */
type Deferral = 'capacity' | 'service-lease-lapsed';

const deferralOf = (
  error: unknown,
  isCapacity: (error: unknown) => boolean,
): Deferral | undefined => {
  if (isAppError(error) && error.reason === 'service-lease-lapsed')
    return 'service-lease-lapsed';
  return isCapacity(error) ? 'capacity' : undefined;
};

/** The operation suffix a deferral's log line and report carry. */
const deferralRoute: Readonly<Record<Deferral, string>> = {
  capacity: 'capacity',
  'service-lease-lapsed': 'lease',
};

/**
 * A background worker's recoverable failure: the log line names the stage
 * and the error's own code; only the scrubbed reporter sees the raw error
 * (ADR 0037). An untyped error carries no trustworthy code, so it is INTERNAL.
 * A deferral counts per kind and stage, and each one past the bound is
 * reported, after which that count starts again. Capacity refusals are
 * silent within the bound; a lease lapse logs every occurrence and is
 * reported only once lapses persist.
 */
export function recoverableFailure(input: {
  readonly logger: Pick<Logger, 'log'>;
  readonly reporter: ErrorReporter;
  readonly nextId: () => string;
  readonly isCapacity: (error: unknown) => boolean;
  readonly event: EventName;
  readonly operation: string;
  readonly message: string;
  /** A fixed code naming why the work failed, read from a typed error. */
  readonly cause?: (error: unknown) => string | undefined;
}) {
  const deferrals = new Map<`${Deferral}:${string}`, number>();
  /** One sink step; a step that throws never stops the next or its caller. */
  const attempt = (step: () => void) => {
    try {
      step();
    } catch {
      /* A failing sink is never its caller's fault (ISSUE-789). */
    }
  };
  const codeOf = (error: unknown) =>
    isAppError(error) ? error.code : 'INTERNAL';
  const log = (error: unknown, operation: string, fixed?: string) => {
    let cause = fixed;
    // A cause reader that throws costs only the cause, never the log line.
    if (cause === undefined)
      attempt(() => {
        cause = input.cause?.(error);
      });
    attempt(() => {
      input.logger.log(
        input.event,
        { operation, errorCode: codeOf(error), ...(cause ? { cause } : {}) },
        input.message,
      );
    });
  };
  const capture = (error: unknown, operation: string) =>
    attempt(() =>
      input.reporter.capture(error, {
        requestId: input.nextId(),
        route: operation,
        errorCode: codeOf(error),
      }),
    );
  /** Whether this deferral is past its bound, which starts the count again. */
  const persisted = (kind: Deferral, stage: string) => {
    const key = `${kind}:${stage}` as const;
    const count = (deferrals.get(key) ?? 0) + 1;
    deferrals.set(key, count > DEFERRAL_LIMIT ? 0 : count);
    return count > DEFERRAL_LIMIT;
  };
  /**
   * Never throws, so no worker promise ever rejects because reporting its
   * failure failed (ISSUE-789).
   */
  return (error: unknown, stage: string) => {
    const operation = `${input.operation}.${stage}`;
    let kind: Deferral | undefined;
    attempt(() => {
      kind = deferralOf(error, input.isCapacity);
    });
    if (kind === undefined) {
      log(error, operation);
      return capture(error, operation);
    }
    const route = `${operation}.${deferralRoute[kind]}`;
    const report = persisted(kind, stage);
    if (kind === 'service-lease-lapsed') log(error, route, kind);
    else if (report) log(error, route);
    if (report) capture(error, route);
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
      event,
      operation,
      message,
      ...(cause ? { cause } : {}),
    });
