import { initSentry } from './sentry-init';

/**
 * ADR 0037 § Configuration: `NEXT_PUBLIC_SENTRY_DSN` gates the browser
 * capture only and is inlined into the client bundle at build time. With it
 * unset the browser makes no Sentry network call, even if the server DSN
 * is set. There is no session replay here: replay is PostHog's, gated
 * separately on consent (ADR 0036 §5).
 */
initSentry({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT,
});
