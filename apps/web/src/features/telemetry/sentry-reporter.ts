import { captureException } from '@sentry/nextjs';
import type { ErrorReporter } from '@daisy/observability';

/**
 * The vendor call the adapter binds, as a parameter so the mapping from the
 * `ErrorReporter` port to the vendor shape is testable without loading the
 * SDK (ADR 0037). `requestId` rides in `extra`: it is per-request, so a tag
 * would be an unbounded index; `route` and `errorCode` are bounded
 * vocabularies and may be indexed.
 */
export type VendorCapture = (
  error: unknown,
  context: {
    tags: {
      route: string;
      errorCode: string;
    };
    extra: { requestId: string };
    user?: { readonly id: string };
  },
) => unknown;

/** The one port→vendor mapping both Sentry runtimes of this app share. */
export const reporterFrom = (capture: VendorCapture): ErrorReporter =>
  Object.freeze({
    capture: (error, context) => {
      capture(error, {
        tags: { route: context.route, errorCode: context.errorCode },
        extra: { requestId: context.requestId },
        ...(context.userId ? { user: { id: context.userId } } : {}),
      });
    },
  });

/**
 * ADR 0037: this app's scrubbed raw-error destination. It captures nothing
 * until a runtime config file initializes the SDK with its DSN
 * (`sentry.server.config.ts`, `sentry.edge.config.ts`,
 * `sentry.client.config.ts`); uninitialized, the vendor call is inert.
 */
export const createSentryErrorReporter = (): ErrorReporter =>
  reporterFrom((error, context) => void captureException(error, context));
