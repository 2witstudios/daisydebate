import { toPublicError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';

/** A request failure as the protocol answers it. */
export type PublicFailure = ReturnType<typeof toPublicError>;

/**
 * ADR 0037: a failure goes to the error tracker only when someone must look
 * at it, which means a 5xx or an invariant violation. A client-class refusal
 * (AUTHORIZATION, NOT_FOUND, VALIDATION and the like) is the operation
 * answering as designed, never a fault in the system.
 */
export const isReportedFailure = (failure: PublicFailure): boolean =>
  failure.status >= 500 || failure.body.error.invariantId !== undefined;

/**
 * A failure Next reports from rendering a page or running a route
 * (`onRequestError`). The log line carries the error's own public code (an
 * untyped error is INTERNAL) and never its message. The raw error reaches only
 * the scrubbed reporter, and only when `isReportedFailure` holds. A failing
 * reporter never fails the hook (the ISSUE-789 rule).
 */
export function reportRequestError(input: {
  readonly error: unknown;
  readonly requestId: string | undefined;
  readonly route: string;
  readonly logger: Pick<Logger, 'log'>;
  readonly reporter: ErrorReporter;
}): void {
  const failure = toPublicError(input.error, input.requestId ?? 'unknown');
  const errorCode = failure.body.error.code;
  input.logger.log(
    'request.unhandled',
    {
      operation: 'request.unhandled',
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      route: input.route,
      errorCode,
    },
    'Unhandled request failure',
  );
  if (!isReportedFailure(failure)) return;
  try {
    input.reporter.capture(input.error, {
      requestId: input.requestId ?? 'unknown',
      route: input.route,
      errorCode,
    });
  } catch {
    /* Reporting is best-effort at the request boundary. */
  }
}
