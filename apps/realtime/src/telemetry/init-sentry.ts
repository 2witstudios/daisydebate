import * as Sentry from '@sentry/bun';
import {
  sampleTrace,
  routineSpanFilters,
  tracePropagationTargets,
  scrubEvent,
  scrubSpan,
} from '@daisy/observability';

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
  readonly trustedOrigin?: string | undefined;
  readonly drawTraceSample?: () => number;
  readonly transport?: NonNullable<
    Parameters<typeof Sentry.init>[0]
  >['transport'];
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
    ...(input.transport ? { transport: input.transport } : {}),
    tracesSampler: (context) => {
      const rate = sampleTrace(context);
      const draw =
        input.drawTraceSample?.() ??
        crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
      return draw >= 0 && draw < rate ? 1 : 0;
    },
    traceLifecycle: 'stream',
    ignoreSpans: routineSpanFilters,
    tracePropagationTargets: tracePropagationTargets(input.trustedOrigin),
    sampleRate: 1,
    beforeSend: (event) => scrubEvent(event),
    beforeSendSpan: (span) => scrubSpan(span),
  });
  Sentry.getClient()?.on('beforeEnvelope', (envelope) => {
    if (envelope[0].trace) delete envelope[0].trace.transaction;
  });
  return true;
};
