import { captureException } from '@sentry/bun';
import type { ErrorReporter } from '@daisy/observability';

/**
 * ADR 0037: realtime's scrubbed raw-error destination, the same port
 * apps/web implements with its own vendor package. It captures nothing
 * until `initRealtimeSentry` initialized the SDK with `SENTRY_DSN`;
 * uninitialized, the vendor call is inert.
 */
export const realtimeErrorReporter = (): ErrorReporter => ({
  capture: (error, context) => {
    // The per-request id rides in `extra` (never an unbounded tag); route
    // and code are bounded vocabularies and may be indexed.
    void captureException(error, {
      tags: { route: context.route, errorCode: context.errorCode },
      extra: { requestId: context.requestId },
      ...(context.userId ? { user: { id: context.userId } } : {}),
    });
  },
});
