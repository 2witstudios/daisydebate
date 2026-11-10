import { createAppError, errorCodeOf } from '@daisy/errors';
import { guarded } from '../../lib/sink-guard';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import type { LeaseLapse } from './lease-health';

/** One error-tracker route for the one instance condition. */
const ROUTE = 'web.service-lease.lapsed';

/**
 * How a persisting lapse reaches people (DAISY-WEB-9). The log line carries
 * why the lease is unproven and for how long; the error tracker gets one
 * error under one route, linked to the renewal failure when there was one,
 * since the reporter port carries no other fields (ADR 0037). Its code is
 * the failure's own, `INFRASTRUCTURE` when there is none.
 */
export const leaseLapseReport =
  (deps: {
    readonly logger: Pick<Logger, 'log'>;
    readonly reporter: ErrorReporter;
    readonly nextId: () => string;
  }) =>
  /** Whether the report reached anyone: its log line, the tracker, or both. */
  (lapse: LeaseLapse): boolean => {
    const failure =
      lapse.unproven.kind === 'renewal_failed' &&
      lapse.unproven.error instanceof Error
        ? lapse.unproven.error
        : undefined;
    // A typed refusal (another role holds the row) keeps its own code.
    const errorCode = errorCodeOf(failure, 'INFRASTRUCTURE');
    const logged = guarded(() =>
      deps.logger.log(
        'availability.lease_lapsing',
        {
          operation: 'availability.lease',
          errorCode,
          cause: lapse.unproven.kind,
          durationMs: Math.max(0, Math.round(lapse.lapsedMs)),
        },
        'Web service lease unproven',
      ),
    );
    const sent = guarded(() =>
      deps.reporter.capture(
        createAppError(errorCode, 'Web service lease lapsing', failure),
        { requestId: deps.nextId(), route: ROUTE, errorCode },
      ),
    );
    // Either reached someone; retrying would repeat what already went out.
    return logged || sent;
  };
