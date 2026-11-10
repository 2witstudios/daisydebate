import { createAppError, errorCodeOf } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import type { LeaseLapse } from './lease-health';

/** One error-tracker route for the one instance condition. */
const ROUTE = 'web.service-lease.lapsed';

/** The renewal failure behind a lapse, when it is an Error a tracker can link. */
const failureOf = (lapse: LeaseLapse) =>
  lapse.unproven.kind === 'renewal_failed' &&
  lapse.unproven.error instanceof Error
    ? lapse.unproven.error
    : undefined;

/**
 * How a persisting lapse reaches people (DAISY-WEB-9), on two channels the
 * availability loop delivers and counts apart. The log line carries why the
 * lease is unproven and for how long; the error tracker gets one error under
 * one route, linked to the renewal failure when there was one, since the
 * reporter port carries no other fields (ADR 0037). Both carry the failure's
 * own code, `INFRASTRUCTURE` when there is none. Each throws when it could not
 * deliver, so the loop tries that channel again.
 */
export const leaseLapseReport = (deps: {
  readonly logger: Pick<Logger, 'log'>;
  readonly reporter: ErrorReporter;
  readonly nextId: () => string;
}) => ({
  log: (lapse: LeaseLapse): void =>
    deps.logger.log(
      'availability.lease_lapsing',
      {
        operation: 'availability.lease',
        errorCode: errorCodeOf(failureOf(lapse), 'INFRASTRUCTURE'),
        cause: lapse.unproven.kind,
        durationMs: Math.max(0, Math.round(lapse.lapsedMs)),
      },
      'Web service lease unproven',
    ),
  report: (lapse: LeaseLapse): void => {
    const failure = failureOf(lapse);
    const errorCode = errorCodeOf(failure, 'INFRASTRUCTURE');
    deps.reporter.capture(
      createAppError(errorCode, 'Web service lease lapsing', failure),
      { requestId: deps.nextId(), route: ROUTE, errorCode },
    );
  },
});
