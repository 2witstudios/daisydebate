import * as Sentry from '@sentry/bun';
import { scrubEvent } from '@daisy/observability';

/**
 * ADR 0037: this process's scrubbed initialization, gated on its own
 * `SENTRY_DSN` from its own environment (a separate deployment from
 * apps/web). Collection is off at the SDK level (Sentry 11's
 * `dataCollection`): no cookies, headers, query parameters, bodies, user
 * info or database payloads are gathered, and every delivered event still
 * runs the pure `scrubEvent` as `beforeSend`. There is no session replay:
 * this process has no browser surface. Returns whether the SDK
 * initialized, so the composition edge stays a pure gate.
 */
export const initRealtimeSentry = (input: {
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
