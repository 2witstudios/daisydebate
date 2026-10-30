import * as Sentry from '@sentry/nextjs';
import { scrubEvent } from '@daisy/observability';

/**
 * ADR 0037: one scrubbed initialization shared by this app's runtime
 * configs. Collection is off at the SDK level (Sentry 11's
 * `dataCollection`): no cookies, headers, query parameters, bodies, user
 * info, database payloads or stack-frame variables are gathered at all —
 * and every delivered event still runs the pure `scrubEvent` as
 * `beforeSend`. There is no session replay: replay is PostHog's, gated
 * separately (ADR 0036 §5). Returns whether the SDK initialized, so each
 * config file stays a pure gate on its own variable.
 */
export const initSentry = (input: {
  readonly dsn: string | undefined;
  readonly environment: string | undefined;
}): boolean => {
  if (!input.dsn) return false;
  Sentry.init({
    dsn: input.dsn,
    ...(input.environment ? { environment: input.environment } : {}),
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 1,
    beforeSend: (event) => scrubEvent(event),
  });
  return true;
};
