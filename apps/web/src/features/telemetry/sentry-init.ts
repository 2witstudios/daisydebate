import * as Sentry from '@sentry/nextjs';
import {
  sampleTrace,
  routineSpanFilters,
  tracePropagationTargets,
  scrubEvent,
  scrubSpan,
} from '@daisy/observability';

/**
 * ADR 0037: one scrubbed initialization shared by this app's runtime
 * configs. Collection is off at the SDK level (Sentry 11's
 * `dataCollection`): no cookies, headers, query parameters, bodies, user
 * info, database payloads or stack-frame variables are gathered at all —
 * and every delivered event still runs the pure `scrubEvent` as
 * `beforeSend`, and every streamed span the pure `scrubSpan`. There is no session replay: replay is PostHog's, gated
 * separately (ADR 0036 §5). Returns whether the SDK initialized, so each
 * config file stays a pure gate on its own variable.
 */
export const initSentry = (input: {
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
  // Dynamic sampling metadata is outside beforeSendSpan and may copy a URL-bearing root name.
  Sentry.getClient()?.on('beforeEnvelope', (envelope) => {
    const trace = envelope[0].trace;
    if (typeof trace === 'object' && trace !== null)
      Reflect.deleteProperty(trace, 'transaction');
  });
  return true;
};

/** Each network call stays in its own suppressed async scope; normal requests regain their context. */
export const fetchWithoutTracing = (
  url: string,
  init: RequestInit,
  fetch: (url: string, init: RequestInit) => Promise<Response>,
): Promise<Response> => Sentry.suppressTracing(() => fetch(url, init));
