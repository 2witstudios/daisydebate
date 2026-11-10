import { createAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import type { LeaseLapse } from './lease-health';

/** One error-tracker route for the one instance condition. */
const ROUTE = 'web.service-lease.lapsed';

/**
 * How a persisting lapse reaches people (DAISY-WEB-9). The log line carries
 * why the lease is unproven and for how long; the error tracker gets one
 * `INFRASTRUCTURE` error under one route, linked to the renewal failure when
 * there was one, since the reporter port carries no other fields (ADR 0037).
 */
export const leaseLapseReport =
  (deps: {
    readonly logger: Pick<Logger, 'log'>;
    readonly reporter: ErrorReporter;
    readonly nextId: () => string;
  }) =>
  (lapse: LeaseLapse): void => {
    try {
      deps.logger.log(
        'availability.lease_lapsing',
        {
          operation: 'availability.lease',
          cause: lapse.unproven.kind,
          durationMs: Math.max(0, Math.round(lapse.lapsedMs)),
        },
        'Web service lease unproven',
      );
    } catch {
      /* A log that fails never costs the report. */
    }
    const failure =
      lapse.unproven.kind === 'renewal_failed' &&
      lapse.unproven.error instanceof Error
        ? lapse.unproven.error
        : undefined;
    deps.reporter.capture(
      createAppError('INFRASTRUCTURE', 'Web service lease lapsing', failure),
      {
        requestId: deps.nextId(),
        route: ROUTE,
        errorCode: 'INFRASTRUCTURE',
      },
    );
  };
