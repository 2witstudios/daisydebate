import { initSentry } from './sentry-init';
import { sentryRelease } from './sentry-release';

/**
 * ADR 0037 § Configuration: the edge runtime's capture path, gated on the
 * same `SENTRY_DSN` as the server runtime. With it unset this file
 * initializes nothing and the edge makes no Sentry network call.
 */
initSentry({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT,
  release: sentryRelease(process.env.GIT_COMMIT),
  trustedOrigin: process.env.PUBLIC_APP_URL,
});
